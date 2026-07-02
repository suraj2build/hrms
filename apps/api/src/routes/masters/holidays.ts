/**
 * /masters/holidays
 *
 * CRUD for the holiday_calendar table.
 * Registered under the /masters prefix → full paths:
 *   GET    /masters/holidays          list for tenant (optionally filtered by year / site_id)
 *   POST   /masters/holidays          create  (hr_admin / super_admin)
 *   DELETE /masters/holidays/:id      delete  (hr_admin / super_admin)
 *
 * Query params (GET):
 *   year     — 4-digit year (e.g. 2025) — filters date >= YYYY-01-01 AND <= YYYY-12-31
 *              omit to return all holidays for the tenant
 *   site_id  — UUID — return only site-scoped holidays for that site
 *              omit to return all (global + site-scoped)
 *
 * Holiday applicability (migration 058 adds site_id):
 *   · site_id IS NULL AND location_id IS NULL → global (all employees)
 *   · site_id IS NOT NULL → site-scoped
 *   · location_id IS NOT NULL → location-scoped (legacy)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CENTRAL_HOLIDAYS_BY_YEAR, SUPPORTED_HOLIDAY_YEARS } from '../../lib/standard-holidays.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const createSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  name:        z.string().min(1, 'Name is required').max(120),
  is_optional: z.boolean().optional().default(false),
  site_id:     z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  // Holiday group applicability (NULL = all-India / applies to everyone)
  holiday_group_id: z.string().uuid().optional().nullable(),
})

const querySchema = z.object({
  year:    z.coerce.number().int().min(2000).max(2100).optional(),
  site_id: z.string().uuid().optional(),
})

export default async function holidaysRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /masters/holidays ─────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    }

    let query = fastify.supabase
      .from('holiday_calendar')
      .select('id, date, name, is_optional, site_id, location_id, holiday_group_id, created_at')
      .eq('tenant_id', req.tenantId)
      .order('date', { ascending: true })

    if (parsed.data.year) {
      const y = parsed.data.year
      query = query
        .gte('date', `${y}-01-01`)
        .lte('date', `${y}-12-31`)
    }

    // When site_id filter is provided, return only that site's holidays + global ones
    if (parsed.data.site_id) {
      query = query.or(`site_id.eq.${parsed.data.site_id},site_id.is.null`)
    }

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // ── POST /masters/holidays ────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
    }

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('holiday_calendar')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select('id, date, name, is_optional, site_id, location_id, holiday_group_id, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  // ── POST /masters/holidays/seed-standard ──────────────────────────────────
  // Load the Government of India CENTRAL gazetted holidays for the given year(s)
  // (default 2026 & 2027). Idempotent — existing dates (UNIQUE tenant_id,date)
  // are preserved. Seeded as global (holiday_group_id NULL → applies to all).
  fastify.post('/seed-standard', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
    }

    const bodySchema = z.object({
      years: z.array(z.number().int()).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    }

    const years = (parsed.data.years && parsed.data.years.length > 0)
      ? parsed.data.years.filter(y => SUPPORTED_HOLIDAY_YEARS.includes(y))
      : SUPPORTED_HOLIDAY_YEARS

    const rows = years.flatMap(y => (CENTRAL_HOLIDAYS_BY_YEAR[y] ?? []).map(h => ({
      tenant_id:   req.tenantId,
      date:        h.date,
      name:        h.name,
      is_optional: false,
    })))

    if (rows.length === 0) {
      return reply.send({ data: { created: 0, skipped: 0, total: 0, years } })
    }

    const { data, error } = await fastify.supabase
      .from('holiday_calendar')
      .upsert(rows, { onConflict: 'tenant_id,date', ignoreDuplicates: true })
      .select('id')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const created = (data as Array<{ id: string }> | null)?.length ?? 0
    return reply.code(201).send({ data: { created, skipped: rows.length - created, total: rows.length, years } })
  })

  // ── PATCH /masters/holidays/:id ───────────────────────────────────────────
  // Edit an existing holiday (date / name / optional flag / group / site).
  fastify.patch('/:id', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
    }

    const parsed = createSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'No fields to update' })
    }

    const { data, error } = await fastify.supabase
      .from('holiday_calendar')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id, date, name, is_optional, site_id, location_id, holiday_group_id, created_at')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A holiday already exists on that date' })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Holiday not found' })
    return reply.send(data)
  })

  // ── GET /masters/holidays/group-matrix ────────────────────────────────────
  // Returns the full holiday × group assignment matrix for a year.
  // Response: { holidays: Holiday[], groups: Group[], assignments: { holiday_id, group_id }[] }
  fastify.get('/group-matrix', auth, async (req: any, reply) => {
    const { year } = (req.query ?? {}) as { year?: string }
    const y = year ? parseInt(year) : new Date().getFullYear()

    const [hResult, gResult, aResult] = await Promise.all([
      fastify.supabase
        .from('holiday_calendar')
        .select('id, date, name, is_optional, holiday_group_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', `${y}-01-01`)
        .lte('date', `${y}-12-31`)
        .order('date', { ascending: true }),
      fastify.supabase
        .from('roster_holiday_groups')
        .select('id, name, code, state_code, is_active')
        .eq('tenant_id', req.tenantId)
        .order('name', { ascending: true }),
      fastify.supabase
        .from('holiday_group_assignments')
        .select('holiday_id, group_id')
        .eq('tenant_id', req.tenantId),
    ])

    return reply.send({
      holidays:    hResult.data   ?? [],
      groups:      gResult.data   ?? [],
      assignments: aResult.data   ?? [],
    })
  })

  // ── POST /masters/holidays/group-assignments ───────────────────────────────
  // Set the complete group assignment for a holiday (replaces existing).
  // Body: { holiday_id: string, group_ids: string[] }
  // Also syncs holiday_calendar.holiday_group_id to group_ids[0] for backward compat.
  fastify.post('/group-assignments', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
    }
    const schema = z.object({
      holiday_id: z.string().uuid(),
      group_ids:  z.array(z.string().uuid()),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { holiday_id, group_ids } = parsed.data

    // Delete existing assignments for this holiday, then insert the new set
    await fastify.supabase
      .from('holiday_group_assignments')
      .delete()
      .eq('holiday_id', holiday_id)
      .eq('tenant_id', req.tenantId)

    if (group_ids.length > 0) {
      const rows = group_ids.map(gid => ({ tenant_id: req.tenantId, holiday_id, group_id: gid }))
      const { error } = await fastify.supabase
        .from('holiday_group_assignments')
        .insert(rows)
      if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    // Sync legacy single-FK for backward compat (first group or NULL)
    await fastify.supabase
      .from('holiday_calendar')
      .update({ holiday_group_id: group_ids[0] ?? null })
      .eq('id', holiday_id)
      .eq('tenant_id', req.tenantId)

    return reply.send({ holiday_id, group_ids })
  })

  // ── DELETE /masters/holidays/:id ──────────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
    }

    const { error } = await fastify.supabase
      .from('holiday_calendar')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
