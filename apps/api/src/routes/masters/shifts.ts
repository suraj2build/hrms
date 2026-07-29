import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { z } from 'zod'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:           z.string().min(1, 'Name is required'),
  code:           z.string().optional(),
  start_time:     z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Invalid time format (HH:MM)'),
  end_time:       z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Invalid time format (HH:MM)'),
  work_hours:     z.number().min(0).max(24).optional(),
  grace_minutes:  z.number().int().min(0).max(120).optional().default(15),
  is_night_shift: z.boolean().optional().default(false),
  is_active:      z.boolean().optional().default(true),
  // weekly_off_days was removed from shifts — weekly-off belongs to Roster entities only.
  // This field is intentionally omitted to enforce the architectural separation.
})

export default async function shiftsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch shifts')
    return reply.send({ data })
  })

  fastify.post('/', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('shifts')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create shift')
    return reply.code(201).send(data)
  })

  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('shifts')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update shift')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Shift not found' })
    return reply.send(data)
  })

  fastify.delete('/:id', hrAdminAuth, async (req: any, reply) => {
    const id = req.params.id as string

    // Usage guard (mirrors grades/sites/etc.). employee_shifts and shift_roster
    // FK shifts with ON DELETE RESTRICT (a raw delete would surface as a 500);
    // job_history FKs with ON DELETE SET NULL (a delete would silently orphan
    // historical shift attribution). Block the delete when referenced and offer
    // soft-deactivation instead.
    const [emp, roster, hist] = await Promise.all([
      fastify.supabase.from('employee_shifts').select('id', { count: 'exact', head: true })
        .eq('shift_id', id).eq('tenant_id', req.tenantId),
      fastify.supabase.from('shift_roster').select('id', { count: 'exact', head: true })
        .eq('shift_id', id).eq('tenant_id', req.tenantId),
      fastify.supabase.from('job_history').select('id', { count: 'exact', head: true })
        .eq('shift_id', id).eq('tenant_id', req.tenantId),
    ])
    if (emp.error) return serverError(req, reply, emp.error, ErrorCode.QUERY_FAILED, 'Failed to check shift usage')
    if (roster.error) return serverError(req, reply, roster.error, ErrorCode.QUERY_FAILED, 'Failed to check shift usage')
    if (hist.error) return serverError(req, reply, hist.error, ErrorCode.QUERY_FAILED, 'Failed to check shift usage')
    const usageCount = (emp.count ?? 0) + (roster.count ?? 0) + (hist.count ?? 0)
    if (usageCount > 0) {
      return reply.code(409).send({
        error:      'IN_USE',
        usageCount,
        message:    `Shift is referenced by ${usageCount} record${usageCount !== 1 ? 's' : ''} ` +
                    `(assignments, rosters, or history). Deactivate it (set is_active=false) instead of deleting.`,
      })
    }

    const { error } = await fastify.supabase
      .from('shifts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (error) {
      // 23503 = FK violation (a reference created between the check and the delete).
      if ((error as any).code === '23503') {
        return reply.code(409).send({ error: 'IN_USE', message: 'Shift is in use and cannot be deleted. Deactivate it instead.' })
      }
      return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete shift')
    }
    return reply.code(204).send()
  })
}
