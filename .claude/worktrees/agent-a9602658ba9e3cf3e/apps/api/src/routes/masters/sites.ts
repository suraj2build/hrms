/**
 * Sites CRUD — /masters/sites
 *
 * A "site" is a named physical location (branch / campus / floor) with its
 * own timezone.  Sites scope holidays and drive multi-location attendance.
 *
 * GET    /masters/sites        — list all sites for the tenant
 * POST   /masters/sites        — create a new site (hr_admin / super_admin)
 * PUT    /masters/sites/:id    — update a site   (hr_admin / super_admin)
 * DELETE /masters/sites/:id    — delete a site   (hr_admin / super_admin)
 *
 * Note: deleting a site that has employees or holidays linked will fail if
 * ON DELETE RESTRICT is used; migration 057 uses ON DELETE SET NULL for
 * both holiday_calendar.site_id and employees.site_id, so deletions are safe.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const schema = z.object({
  name:              z.string().min(1, 'Name is required').max(120),
  location:          z.string().max(255).optional(),
  timezone:          z.string().max(100).default('Asia/Kolkata'),
  default_roster_id: z.string().uuid().optional().nullable(),
  /**
   * Default shift for employees at this site who have no personal shift assignment.
   * Used as the 3rd-priority fallback in attendance processing after
   * shift_roster (override) and employee_shifts (standing assignment).
   * Added by migration 112.
   */
  default_shift_id:  z.string().uuid().optional().nullable(),
})

export default async function sitesRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
          return reply.code(403).send({
            error:   'FORBIDDEN',
            message: 'HR admin access required',
          })
        }
      },
    ],
  }

  // ── GET /masters/sites ────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('sites')
      .select('id, name, location, timezone, default_roster_id, default_shift_id, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/sites ───────────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Validate default_roster_id belongs to this tenant
    if (parsed.data.default_roster_id) {
      const { data: roster } = await fastify.supabase
        .from('rosters')
        .select('id')
        .eq('id', parsed.data.default_roster_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!roster) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Roster not found in your organisation',
          field:   'default_roster_id',
        })
      }
    }

    // Validate default_shift_id belongs to this tenant
    if (parsed.data.default_shift_id) {
      const { data: shift } = await fastify.supabase
        .from('shifts')
        .select('id')
        .eq('id', parsed.data.default_shift_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!shift) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Shift not found in your organisation',
          field:   'default_shift_id',
        })
      }
    }

    const { data, error } = await fastify.supabase
      .from('sites')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select('id, name, location, timezone, default_roster_id, default_shift_id, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A site named "${parsed.data.name}" already exists`,
        })
      }
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/sites/:id ────────────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Validate default_roster_id belongs to this tenant (only when supplied)
    if (parsed.data.default_roster_id) {
      const { data: roster } = await fastify.supabase
        .from('rosters')
        .select('id')
        .eq('id', parsed.data.default_roster_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!roster) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Roster not found in your organisation',
          field:   'default_roster_id',
        })
      }
    }

    // Validate default_shift_id belongs to this tenant (only when supplied)
    if (parsed.data.default_shift_id) {
      const { data: shift } = await fastify.supabase
        .from('shifts')
        .select('id')
        .eq('id', parsed.data.default_shift_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!shift) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Shift not found in your organisation',
          field:   'default_shift_id',
        })
      }
    }

    const { data, error } = await fastify.supabase
      .from('sites')
      .update(parsed.data)
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, location, timezone, default_roster_id, default_shift_id, created_at')
      .single()

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Site not found' })
    }

    return reply.send({ data })
  })

  // ── DELETE /masters/sites/:id ─────────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('sites')
      .delete()
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(204).send()
  })
}
