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

const createSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  name:        z.string().min(1, 'Name is required').max(120),
  is_optional: z.boolean().optional().default(false),
  site_id:     z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
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
      .select('id, date, name, is_optional, site_id, location_id, created_at')
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
    }

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('holiday_calendar')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select('id, date, name, is_optional, site_id, location_id, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  // ── DELETE /masters/holidays/:id ──────────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
