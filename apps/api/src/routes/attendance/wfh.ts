/**
 * Proactive Work-From-Home requests.
 *   ESS:      POST/GET /attendance/wfh/my
 *   Approver: GET /attendance/wfh/pending, PATCH /attendance/wfh/:id/decide
 *             (HR sees all; a manager sees their direct reports).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isHrAdmin, resolveCallerEmployeeId } from '../../lib/manager-scope.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function dayCount(from: string, to: string): number {
  return Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1)
}
const empName = (e: any) => e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : null

export default async function wfhRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.post('/attendance/wfh/my', auth, async (req: any, reply) => {
    const empId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE', message: 'Profile not linked to an employee record' })
    const parsed = z.object({
      from_date: z.string().regex(DATE_RE), to_date: z.string().regex(DATE_RE),
      reason: z.string().max(1000).optional().nullable(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    if (parsed.data.to_date < parsed.data.from_date) return reply.code(400).send({ error: 'VALIDATION', message: 'to_date is before from_date' })

    const { data, error } = await fastify.supabase
      .from('wfh_requests')
      .insert({
        tenant_id: req.tenantId, employee_id: empId,
        from_date: parsed.data.from_date, to_date: parsed.data.to_date,
        days: dayCount(parsed.data.from_date, parsed.data.to_date),
        reason: parsed.data.reason ?? null, status: 'pending',
      })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send({ data })
  })

  fastify.get('/attendance/wfh/my', auth, async (req: any, reply) => {
    const empId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    if (!empId) return reply.send({ data: [] })
    const { data, error } = await fastify.supabase
      .from('wfh_requests').select('*').eq('tenant_id', req.tenantId).eq('employee_id', empId)
      .order('from_date', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.get('/attendance/wfh/pending', auth, async (req: any, reply) => {
    let q = fastify.supabase
      .from('wfh_requests')
      .select('*, employees(first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId).eq('status', 'pending').order('from_date')
    if (!isHrAdmin(req.userRole)) {
      const mgrId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!mgrId) return reply.send({ data: [] })
      const { data: reports } = await fastify.supabase
        .from('employees').select('id').eq('tenant_id', req.tenantId).eq('manager_id', mgrId)
      const ids = (reports ?? []).map((r: any) => r.id)
      if (!ids.length) return reply.send({ data: [] })
      q = q.in('employee_id', ids)
    }
    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: (data ?? []).map((r: any) => ({
      ...r, employee_name: empName(r.employees), employee_code: r.employees?.employee_code ?? null, employees: undefined,
    })) })
  })

  fastify.patch('/attendance/wfh/:id/decide', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ decision: z.enum(['approved', 'rejected']), remarks: z.string().max(1000).optional().nullable() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data: r } = await fastify.supabase
      .from('wfh_requests').select('id, employee_id, status').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Request not found' })
    if (r.status !== 'pending') return reply.code(409).send({ error: 'NOT_PENDING', message: 'Request already decided' })

    if (!isHrAdmin(req.userRole)) {
      const mgrId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      const { data: emp } = await fastify.supabase
        .from('employees').select('manager_id').eq('id', r.employee_id).eq('tenant_id', req.tenantId).maybeSingle()
      if (!mgrId || emp?.manager_id !== mgrId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not your team member' })
    }

    // Fold the 'pending' precondition into the UPDATE itself — the read
    // above is advisory only; without this, two concurrent decide calls
    // (e.g. a manager and HR admin both acting on the same request) could
    // both pass the read-check and the second would silently overwrite the
    // first's decision.
    const { data, error } = await fastify.supabase
      .from('wfh_requests')
      .update({ status: parsed.data.decision, decided_by: req.userId, decided_at: new Date().toISOString(), decision_remarks: parsed.data.remarks ?? null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', req.tenantId).eq('status', 'pending').select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to record WFH decision')
    if (!data) return reply.code(409).send({ error: 'NOT_PENDING', message: 'Request already decided' })
    return reply.send({ data })
  })
}
