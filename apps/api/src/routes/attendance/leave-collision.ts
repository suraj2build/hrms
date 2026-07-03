/**
 * Leave Collision Routes
 *
 * GET  /leave/collision/preview          — preview collision analysis for a date range
 * GET  /leave/collision/log              — audit log of collision resolutions
 * POST /leave/collision/log/:id/resolve  — acknowledge/dismiss a collision log entry
 * GET  /leave/optional-holidays          — list optional holidays available for employee
 * POST /leave/optional-holidays/select   — employee selects an optional holiday
 * DELETE /leave/optional-holidays/:id    — remove selection
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  computeCollision,
  resolveCollisionPolicy,
} from '../../lib/collision-engine.js'
import { resolveEmployeeOrgContext } from '../../lib/org-context.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function leaveCollisionRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /leave/collision/preview ────────────────────────────────────────
  // Returns a collision analysis for a proposed leave range.
  // Used by the frontend LeaveApply page to show a preview before submission.
  fastify.get('/leave/collision/preview', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id:   z.string().uuid(),
      leave_type_id: z.string().uuid(),
      from_date:     z.string().regex(dateRe),
      to_date:       z.string().regex(dateRe),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { employee_id, leave_type_id, from_date, to_date } = parsed.data

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Resolve collision policy
    const policy = await resolveCollisionPolicy(fastify.supabase, req.tenantId, leave_type_id)

    // Compute collision
    const result = await computeCollision(
      fastify.supabase, req.tenantId, employee_id, from_date, to_date, policy,
    )

    return reply.send({ data: { policy, ...result } })
  })

  // ── GET /leave/collision/log ────────────────────────────────────────────
  fastify.get('/leave/collision/log', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      employee_id:        z.string().uuid().optional(),
      from:               z.string().regex(dateRe).optional(),
      to:                 z.string().regex(dateRe).optional(),
      limit:              z.coerce.number().int().min(1).max(200).default(100),
      offset:             z.coerce.number().int().min(0).default(0),
      show_acknowledged:  z.enum(['true', 'false']).optional().default('false'),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { employee_id, from, to, limit, offset, show_acknowledged } = parsed.data

    let q = fastify.supabase
      .from('leave_collision_log')
      .select(`
        id, collision_date, collision_type, resolution, original_status, resolved_status,
        acknowledged_at, created_at,
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    // By default hide acknowledged entries (dismissed from the operations dashboard)
    if (show_acknowledged !== 'true') {
      q = q.is('acknowledged_at', null)
    }

    if (employee_id) q = q.eq('employee_id', employee_id)
    if (from)        q = q.gte('collision_date', from)
    if (to)          q = q.lte('collision_date', to)

    const { data, error, count } = await q
    if (error) {
      // Table may not exist yet in this deployment — return empty rather than 500
      // so the operational work queue degrades gracefully
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return reply.send({ data: [], total: 0, limit, offset })
      }
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch collision log' })
    }

    const rows = (data ?? []).map((r: any) => ({
      id:               r.id,
      collision_date:   r.collision_date,
      collision_type:   r.collision_type,
      resolution:       r.resolution,
      original_status:  r.original_status,
      resolved_status:  r.resolved_status,
      acknowledged_at:  r.acknowledged_at ?? null,
      created_at:       r.created_at,
      employee_name:    r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
      employee_code:    r.employees?.employee_code ?? null,
    }))

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── POST /leave/collision/log/:id/resolve ───────────────────────────────
  // HR admin acknowledges/dismisses a collision log entry.
  // The record is retained for audit; acknowledged_at is set so it no longer
  // appears in the default (unfiltered) log view.
  fastify.post('/leave/collision/log/:id/resolve', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    // Verify the entry belongs to this tenant
    const { data: entry, error: fetchErr } = await fastify.supabase
      .from('leave_collision_log')
      .select('id, acknowledged_at')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: fetchErr.message })
    if (!entry)   return reply.code(404).send({ error: 'NOT_FOUND', message: 'Collision log entry not found' })

    // Idempotent — already acknowledged is fine
    if (entry.acknowledged_at) {
      return reply.send({ message: 'Already acknowledged', acknowledged_at: entry.acknowledged_at })
    }

    const now = new Date().toISOString()
    const { error: updateErr } = await fastify.supabase
      .from('leave_collision_log')
      .update({ acknowledged_at: now, acknowledged_by: req.userId })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })

    return reply.send({ message: 'Collision entry acknowledged', acknowledged_at: now })
  })

  // ── GET /leave/optional-holidays ────────────────────────────────────────
  // List optional holidays for the current year that the employee can choose from.
  fastify.get('/leave/optional-holidays', auth, async (req: any, reply) => {
    const year = new Date().getFullYear()

    // Get the pool for this tenant/year
    const { data: pool } = await fastify.supabase
      .from('optional_holiday_pool')
      .select('id, year, holiday_calendar(id, date, name, holiday_type)')
      .eq('tenant_id', req.tenantId)
      .eq('year', year)
      .order('year')

    // Get employee's selections
    let employeeId: string | null = null
    const { data: profData } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .maybeSingle()
    employeeId = profData?.employee_id ?? null

    let selectedPoolIds: Set<string> = new Set()
    if (employeeId) {
      const { data: selections } = await fastify.supabase
        .from('employee_optional_holidays')
        .select('pool_id')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
      selectedPoolIds = new Set((selections ?? []).map((s: any) => s.pool_id))
    }

    const items = (pool ?? []).map((p: any) => ({
      pool_id:      p.id,
      year:         p.year,
      holiday:      p.holiday_calendar,
      is_selected:  selectedPoolIds.has(p.id),
    }))

    return reply.send({ data: items })
  })

  // ── GET /leave/holidays ─────────────────────────────────────────────────
  // ESS: the employee's applicable COMPANY holiday calendar for a year.
  // Resolves the employee's org context and returns only the mandatory
  // holidays (is_optional=false) that apply to them, honoring the
  // location > site > group > global applicability chain (same rules the
  // attendance/payroll engines use). Optional holidays have their own page.
  fastify.get('/leave/holidays', auth, async (req: any, reply) => {
    const year = Number((req.query as Record<string, string>)?.year ?? new Date().getFullYear())
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Invalid year' })
    }
    const yStart = `${year}-01-01`
    const yEnd   = `${year}-12-31`

    // Resolve the employee (if the profile is linked).
    const { data: profData } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .maybeSingle()
    const employeeId: string | null = profData?.employee_id ?? null

    // Org context (site / location / holiday-group). Defaults to all-null
    // (global-only) when there is no linked employee.
    const ctx = employeeId
      ? await resolveEmployeeOrgContext(fastify.supabase, req.tenantId, employeeId, `${year}-06-01`)
      : { site_id: null, work_location_id: null, site_holiday_group_id: null }

    const { data: rows, error } = await fastify.supabase
      .from('holiday_calendar')
      .select('id, date, name, holiday_type, is_optional, site_id, location_id, holiday_group_id')
      .eq('tenant_id', req.tenantId)
      .eq('is_optional', false)
      .gte('date', yStart)
      .lte('date', yEnd)
      .order('date')

    if (error) {
      req.log.error({ err: error }, 'ess holidays list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch holidays' })
    }

    // Applicability + per-date priority (location > site > group > global).
    const rank = (h: any) =>
      h.location_id      ? 4
      : h.site_id         ? 3
      : h.holiday_group_id ? 2
      : 1
    const applies = (h: any) =>
      (!h.site_id && !h.location_id && !h.holiday_group_id) ||
      (ctx.site_id && h.site_id === ctx.site_id) ||
      (ctx.work_location_id && h.location_id === ctx.work_location_id) ||
      (ctx.site_holiday_group_id && h.holiday_group_id === ctx.site_holiday_group_id)

    const byDate = new Map<string, any>()
    for (const h of (rows ?? [])) {
      if (!applies(h)) continue
      const cur = byDate.get(h.date)
      if (!cur || rank(h) > rank(cur)) byDate.set(h.date, h)
    }

    const data = [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((h) => ({ id: h.id, date: h.date, name: h.name, holiday_type: h.holiday_type }))

    return reply.send({ data, year })
  })

  // ── POST /leave/optional-holidays/select ───────────────────────────────
  // Employee selects an optional holiday
  fastify.post('/leave/optional-holidays/select', auth, async (req: any, reply) => {
    const schema = z.object({ pool_id: z.string().uuid() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: profData } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .maybeSingle()

    if (!profData?.employee_id) {
      return reply.code(422).send({ error: 'NO_EMPLOYEE', message: 'Profile not linked to an employee' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_optional_holidays')
      .insert({
        tenant_id:   req.tenantId,
        employee_id: profData.employee_id,
        pool_id:     parsed.data.pool_id,
      })
      .select('id, pool_id, selected_at')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'ALREADY_SELECTED', message: 'Already selected' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to select holiday' })
    }

    return reply.code(201).send({ data })
  })

  // ── DELETE /leave/optional-holidays/:poolId ─────────────────────────────
  // Employee removes their optional holiday selection
  fastify.delete('/leave/optional-holidays/:poolId', auth, async (req: any, reply) => {
    const { poolId } = req.params as { poolId: string }

    const { data: profData } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .maybeSingle()

    if (!profData?.employee_id) {
      return reply.code(422).send({ error: 'NO_EMPLOYEE', message: 'Profile not linked to an employee' })
    }

    const { error } = await fastify.supabase
      .from('employee_optional_holidays')
      .delete()
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profData.employee_id)
      .eq('pool_id', poolId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to remove selection' })
    return reply.code(204).send()
  })

  // ── HR: GET /leave/optional-holidays/pool ─────────────────────────────────
  // List the pool for a given year (defaults to current year), with selection counts.
  fastify.get('/leave/optional-holidays/pool', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const year = Number((req.query as Record<string, string>).year ?? new Date().getFullYear())

    const { data: pool, error } = await fastify.supabase
      .from('optional_holiday_pool')
      .select(`
        id, year,
        holiday_calendar(id, date, name, holiday_type)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('year', year)
      .order('id')

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch pool' })

    // Count employee selections per pool entry
    const poolIds = (pool ?? []).map((p: any) => p.id)
    let selCounts: Record<string, number> = {}
    if (poolIds.length) {
      const { data: sels } = await fastify.supabase
        .from('employee_optional_holidays')
        .select('pool_id')
        .eq('tenant_id', req.tenantId)
        .in('pool_id', poolIds)
      for (const s of (sels ?? []) as Array<{ pool_id: string }>) {
        selCounts[s.pool_id] = (selCounts[s.pool_id] ?? 0) + 1
      }
    }

    const items = (pool ?? []).map((p: any) => ({
      pool_id:         p.id,
      year:            p.year,
      holiday:         p.holiday_calendar,
      selection_count: selCounts[p.id] ?? 0,
    }))

    return reply.send({ data: items, year })
  })

  // ── HR: POST /leave/optional-holidays/pool ───────────────────────────────
  // Add a holiday to the optional pool.
  fastify.post('/leave/optional-holidays/pool', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const schema = z.object({
      holiday_id: z.string().uuid(),
      year:       z.number().int().min(2000).max(2100).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const year = parsed.data.year ?? new Date().getFullYear()

    const { data, error } = await fastify.supabase
      .from('optional_holiday_pool')
      .insert({ tenant_id: req.tenantId, holiday_id: parsed.data.holiday_id, year })
      .select('id, year, holiday_id')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'Holiday already in pool' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to add to pool' })
    }
    return reply.code(201).send({ data })
  })

  // ── HR: DELETE /leave/optional-holidays/pool/:poolId ─────────────────────
  // Remove a holiday from the pool (also removes all employee selections for it).
  fastify.delete('/leave/optional-holidays/pool/:poolId', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const { poolId } = req.params as { poolId: string }

    const { error } = await fastify.supabase
      .from('optional_holiday_pool')
      .delete()
      .eq('id', poolId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to remove from pool' })
    return reply.code(204).send()
  })
}
