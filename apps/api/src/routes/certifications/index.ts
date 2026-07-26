/**
 * Certification Governance Routes — /certifications/*
 *
 * Manages employee certifications, licenses, professional credentials.
 *
 * GET  /certifications          — list (filterable by employee_id, type, status, expiring_in)
 * POST /certifications          — create
 * PUT  /certifications/:id      — update
 * DELETE /certifications/:id    — delete
 * GET  /certifications/expiring — certifications expiring within N days
 * GET  /certifications/stats    — summary counts by type/status
 *
 * Access: hr_admin/super_admin for write; authenticated for own employee read.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

export default async function certificationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!HR_ADMIN_ROLES.includes(req.userRole)) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
        }
      },
    ],
  }

  // ── GET /certifications ───────────────────────────────────────────────────

  fastify.get('/certifications', auth, async (req: any, reply) => {
    const q = z.object({
      employee_id:  z.string().uuid().optional(),
      cert_type:    z.enum(['certification','license','credential','membership']).optional(),
      status:       z.enum(['active','expired','revoked','pending']).optional(),
      expiring_in:  z.coerce.number().int().min(1).max(365).optional(),
      search:       z.string().optional(),
      limit:        z.coerce.number().int().min(1).max(200).default(100),
      offset:       z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { employee_id, cert_type, status, expiring_in, search, limit, offset } = parsed.data

    const isHr = HR_ADMIN_ROLES.includes(req.userRole)

    let query = fastify.supabase
      .from('employee_certifications')
      .select(`
        *,
        employees!inner(id, employee_code, profiles!profile_id(full_name))
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('expiry_date', { ascending: true, nullsFirst: false })

    if (!isHr) {
      const { data: emp } = await fastify.supabase
        .from('profiles').select('id:employee_id').eq('id', req.userId).eq('tenant_id', req.tenantId).maybeSingle()
      if (!emp) return reply.code(403).send({ error: 'FORBIDDEN' })
      query = query.eq('employee_id', (emp as any).id)
    } else if (employee_id) {
      query = query.eq('employee_id', employee_id)
    }

    if (cert_type) query = query.eq('cert_type', cert_type)
    if (status)    query = query.eq('status', status)
    if (search)    query = query.ilike('cert_name', `%${search}%`)

    if (expiring_in) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() + expiring_in)
      query = query
        .not('expiry_date', 'is', null)
        .lte('expiry_date', cutoff.toISOString().split('T')[0])
        .gte('expiry_date', new Date().toISOString().split('T')[0])
    }

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /certifications/expiring ──────────────────────────────────────────

  fastify.get('/certifications/expiring', hrAuth, async (req: any, reply) => {
    const { days = '30' } = req.query as Record<string, string>
    const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365)

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + n)
    const today = new Date().toISOString().split('T')[0]
    const cutoffStr = cutoff.toISOString().split('T')[0]

    let records: any[]
    try {
      records = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_certifications')
          .select('*, employees(id, employee_code, profiles!profile_id(full_name))')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .not('expiry_date', 'is', null)
          .gte('expiry_date', today)
          .lte('expiry_date', cutoffStr)
          .order('expiry_date', { ascending: true })
          .range(from, to)
      ) as any[]
    } catch (err: any) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: err.message })
    }

    const today_d = new Date(today)
    const enriched = records.map(r => ({
      ...r,
      days_remaining: Math.ceil((new Date(r.expiry_date).getTime() - today_d.getTime()) / 86400000),
    }))

    return reply.send({ data: enriched, days_window: n })
  })

  // ── GET /certifications/stats ─────────────────────────────────────────────

  fastify.get('/certifications/stats', hrAuth, async (req: any, reply) => {
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_certifications')
          .select('cert_type, status, expiry_date')
          .eq('tenant_id', req.tenantId)
          .range(from, to)
      ) as any[]
    } catch (err: any) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: err.message })
    }
    const today = new Date()
    const in30  = new Date(); in30.setDate(today.getDate() + 30)
    const in90  = new Date(); in90.setDate(today.getDate() + 90)

    const byType:   Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    let expiring30 = 0, expiring90 = 0

    for (const r of rows) {
      byType[r.cert_type]   = (byType[r.cert_type]   ?? 0) + 1
      byStatus[r.status]    = (byStatus[r.status]     ?? 0) + 1
      if (r.status === 'active' && r.expiry_date) {
        const d = new Date(r.expiry_date)
        if (d >= today && d <= in30) expiring30++
        if (d >= today && d <= in90) expiring90++
      }
    }

    return reply.send({
      total: rows.length,
      by_type:   byType,
      by_status: byStatus,
      expiring_30d: expiring30,
      expiring_90d: expiring90,
    })
  })

  // ── POST /certifications ──────────────────────────────────────────────────

  fastify.post('/certifications', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      employee_id:  z.string().uuid(),
      cert_name:    z.string().min(1),
      cert_type:    z.enum(['certification','license','credential','membership']).default('certification'),
      issuing_body: z.string().optional().nullable(),
      cert_number:  z.string().optional().nullable(),
      issue_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      expiry_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      status:       z.enum(['active','expired','revoked','pending']).default('active'),
      document_url: z.string().optional().nullable(),
      notes:        z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // employee_id is a raw UUID from the request body — the FK only requires
    // the employee to exist somewhere, not in this tenant. Without this check
    // an HR admin who obtains a foreign tenant's employee UUID could attach a
    // certification to it; the tenant-scoped GET routes below join `employees`
    // unfiltered, so that employee's name/code would then leak back on every
    // subsequent list/expiring/stats call for this tenant.
    const { data: emp } = await fastify.supabase
      .from('employees').select('id').eq('id', parsed.data.employee_id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found for this tenant' })

    const now = new Date().toISOString().split('T')[0]
    let status = parsed.data.status
    if (status === 'active' && parsed.data.expiry_date && parsed.data.expiry_date < now) {
      status = 'expired'
    }

    const { data, error } = await fastify.supabase
      .from('employee_certifications')
      .insert({ ...parsed.data, status, tenant_id: req.tenantId, created_by: req.userId })
      .select('*, employees(id, employee_code, profiles!profile_id(full_name))')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'Certification already exists for this employee' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /certifications/:id ───────────────────────────────────────────────

  fastify.put('/certifications/:id', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      cert_name:    z.string().min(1).optional(),
      cert_type:    z.enum(['certification','license','credential','membership']).optional(),
      issuing_body: z.string().optional().nullable(),
      cert_number:  z.string().optional().nullable(),
      issue_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      expiry_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      status:       z.enum(['active','expired','revoked','pending']).optional(),
      document_url: z.string().optional().nullable(),
      notes:        z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('employee_certifications')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Certification updated' })
  })

  // ── DELETE /certifications/:id ────────────────────────────────────────────

  fastify.delete('/certifications/:id', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('employee_certifications')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.send({ message: 'Certification deleted' })
  })
}
