/**
 * Sites CRUD — /masters/sites
 *
 * A "site" is a named physical location (branch / campus / floor) with its
 * own timezone.  Sites scope holidays and drive multi-location attendance.
 *
 * ── Workforce Governance (migration 154) ─────────────────────────────────────
 *
 * Each site now carries two governance defaults that ALL employees inherit:
 *
 *   default_roster_id            → Roster Policy (determines whether employee works)
 *   default_rotation_policy_id   → Rotation Policy (determines which shift applies)
 *   default_leave_policy_id      → Leave Policy FK fallback (migration 156)
 *
 * Employee-level overrides:
 *   employees.roster_id          → overrides site default_roster_id
 *   employees.rotation_policy_id → overrides site default_rotation_policy_id
 *
 * Legacy field (deprecated):
 *   default_shift_id             → was 3rd-priority fallback before rotation policies.
 *                                   Preserved read-only for backward compat.
 *
 * Routes:
 *   GET    /masters/sites        — list all sites for the tenant
 *   POST   /masters/sites        — create a new site (hr_admin / super_admin)
 *   PUT    /masters/sites/:id    — update a site   (hr_admin / super_admin)
 *   DELETE /masters/sites/:id    — delete a site   (hr_admin / super_admin)
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const SELECT_COLS =
  'id, name, location, timezone, state_code, default_roster_id, default_rotation_policy_id, default_leave_policy_id, default_shift_id, holiday_group_id, created_at'

const schema = z.object({
  name:                        z.string().min(1, 'Name is required').max(120),
  location:                    z.string().max(255).optional(),
  timezone:                    z.string().max(100).default('Asia/Kolkata'),
  /** migration 166 — state code (ISO 3166-2 sub-region) for PT/LWF jurisdiction */
  state_code:                  z.string().max(3).optional().nullable(),
  /** migration 217 — holiday group this site observes (NULL = all-India only) */
  holiday_group_id:            z.string().uuid().optional().nullable(),
  default_roster_id:           z.string().uuid().optional().nullable(),
  default_rotation_policy_id:  z.string().uuid().optional().nullable(),
  /** migration 156 — site-level default leave policy (FK fallback in resolution chain) */
  default_leave_policy_id:     z.string().uuid().optional().nullable(),
  /**
   * DEPRECATED (migration 154): Legacy default shift fallback.
   * Replaced by default_rotation_policy_id + rotation_policy_rules.
   * Accepted on write for backward compat only.
   */
  default_shift_id:            z.string().uuid().optional().nullable(),
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
  //
  // Resilient SELECT: we use '*' rather than an explicit column list so that a
  // column added to the schema before its migration has been applied in a given
  // environment (e.g. state_code from migration 166) can never blank the entire
  // Sites page. The frontend reads only the fields it needs and tolerates any
  // that are absent. '*' also surfaces `code` (migration 116), which the list
  // search filters on.
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('sites')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      req.log.error({ err: error }, 'GET /masters/sites failed')
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
          message: 'Roster policy not found in your organisation',
          field:   'default_roster_id',
        })
      }
    }

    // Validate default_rotation_policy_id belongs to this tenant
    if (parsed.data.default_rotation_policy_id) {
      const { data: rotPolicy } = await fastify.supabase
        .from('rotation_policies')
        .select('id')
        .eq('id', parsed.data.default_rotation_policy_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!rotPolicy) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Rotation policy not found in your organisation',
          field:   'default_rotation_policy_id',
        })
      }
    }

    // Validate default_leave_policy_id belongs to this tenant (migration 156)
    if (parsed.data.default_leave_policy_id) {
      const { data: leavePolicy } = await fastify.supabase
        .from('leave_policy_masters')
        .select('id')
        .eq('id', parsed.data.default_leave_policy_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!leavePolicy) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Leave policy not found in your organisation',
          field:   'default_leave_policy_id',
        })
      }
    }

    // Validate default_shift_id belongs to this tenant (deprecated field)
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
      .select('*')
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
          message: 'Roster policy not found in your organisation',
          field:   'default_roster_id',
        })
      }
    }

    // Validate default_rotation_policy_id belongs to this tenant (only when supplied)
    if (parsed.data.default_rotation_policy_id) {
      const { data: rotPolicy } = await fastify.supabase
        .from('rotation_policies')
        .select('id')
        .eq('id', parsed.data.default_rotation_policy_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!rotPolicy) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Rotation policy not found in your organisation',
          field:   'default_rotation_policy_id',
        })
      }
    }

    // Validate default_leave_policy_id belongs to this tenant (migration 156)
    if (parsed.data.default_leave_policy_id) {
      const { data: leavePolicy } = await fastify.supabase
        .from('leave_policy_masters')
        .select('id')
        .eq('id', parsed.data.default_leave_policy_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!leavePolicy) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Leave policy not found in your organisation',
          field:   'default_leave_policy_id',
        })
      }
    }

    // Validate default_shift_id belongs to this tenant (deprecated field)
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
      .select('*')
      .single()

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Site not found' })
    }

    return reply.send({ data })
  })

  // ── GET /masters/sites/:id/usage ─────────────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count, error } = await fastify.supabase
      .from('work_locations')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    return reply.send({ data: { work_locations: count ?? 0, total: count ?? 0 } })
  })

  // ── DELETE /masters/sites/:id ─────────────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { id } = (req.params as any)
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    // Validate merge_to is a UUID if provided
    if (mergeTo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mergeTo)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    const { count, error: countErr } = await fastify.supabase
      .from('work_locations')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check site usage' })

    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: `Site has ${usageCount} work location${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign them.`,
      })
    }

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('work_locations')
        .update({ site_id: mergeTo })
        .eq('site_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return reply.code(500).send({ error: 'REASSIGN_FAILED', message: reassignErr.message })
    }

    const { error } = await fastify.supabase
      .from('sites')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
