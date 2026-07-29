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
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const SELECT_COLS =
  'id, name, location, timezone, state_code, site_type, city, region, zone, default_roster_id, default_rotation_policy_id, default_leave_policy_id, default_shift_id, holiday_group_id, created_at'

const schema = z.object({
  name:                        z.string().min(1, 'Name is required').max(120),
  location:                    z.string().max(255).optional(),
  timezone:                    z.string().max(100).default('Asia/Kolkata'),
  /** migration 166 — state code (ISO 3166-2 sub-region) for PT/LWF jurisdiction */
  state_code:                  z.string().max(3).optional().nullable(),
  /** migration 248 — retail/geography dimensions for site-disaggregated KPIs (R5) */
  site_type:                   z.string().max(40).optional().nullable(),
  city:                        z.string().max(120).optional().nullable(),
  region:                      z.string().max(80).optional().nullable(),
  zone:                        z.string().max(80).optional().nullable(),
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

  // ── migration 275 — Site master expansion ──────────────────────────────────
  // Grouping FKs: state_id = statutory axis, cluster_id = operational axis.
  state_id:                    z.string().uuid().optional().nullable(),
  cluster_id:                  z.string().uuid().optional().nullable(),
  cost_center_id:              z.string().uuid().optional().nullable(),
  parent_site_id:              z.string().uuid().optional().nullable(),
  // Identity & lifecycle
  short_name:                  z.string().max(80).optional().nullable(),
  status:                      z.enum(['active', 'inactive']).optional(),
  opening_date:                z.string().optional().nullable(),
  // Structured address & geo
  address_line1:               z.string().max(255).optional().nullable(),
  address_line2:               z.string().max(255).optional().nullable(),
  district:                    z.string().max(120).optional().nullable(),
  pincode:                     z.string().max(12).optional().nullable(),
  country:                     z.string().max(80).optional().nullable(),
  latitude:                    z.number().min(-90).max(90).optional().nullable(),
  longitude:                   z.number().min(-180).max(180).optional().nullable(),
  geofence_radius_m:           z.number().int().nonnegative().optional().nullable(),
  // India statutory registration IDs
  gstin:                       z.string().max(20).optional().nullable(),
  pf_registration_no:          z.string().max(40).optional().nullable(),
  esi_registration_no:         z.string().max(40).optional().nullable(),
  pt_registration_no:          z.string().max(40).optional().nullable(),
  lwf_registration_no:         z.string().max(40).optional().nullable(),
  shops_estab_reg_no:          z.string().max(60).optional().nullable(),
  factory_license_no:          z.string().max(60).optional().nullable(),
  // Operations
  contact_person:              z.string().max(120).optional().nullable(),
  contact_phone:               z.string().max(30).optional().nullable(),
  contact_email:               z.string().email().max(160).optional().nullable(),
  sanctioned_headcount:        z.number().int().nonnegative().optional().nullable(),
})

/**
 * Migration-275 columns. Like the legacy 166/217/248 fields, these are stripped
 * from the write payload when null/undefined so an insert/update never references
 * a column that a not-yet-migrated environment lacks. Values are re-added below
 * only when provided.
 */
const EXPANSION_KEYS = [
  'state_id', 'cluster_id', 'cost_center_id', 'parent_site_id',
  'short_name', 'status', 'opening_date',
  'address_line1', 'address_line2', 'district', 'pincode', 'country',
  'latitude', 'longitude', 'geofence_radius_m',
  'gstin', 'pf_registration_no', 'esi_registration_no', 'pt_registration_no',
  'lwf_registration_no', 'shops_estab_reg_no', 'factory_license_no',
  'contact_person', 'contact_phone', 'contact_email', 'sanctioned_headcount',
] as const

const MAX_PARENT_DEPTH = 20   // maximum parent_site_id chain depth before aborting cycle check

export default async function sitesRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          return reply.code(403).send({
            error:   'FORBIDDEN',
            message: 'HR admin access required',
          })
        }
      },
    ],
  }

  /**
   * Validate that each provided migration-275 grouping FK belongs to this tenant.
   * Returns an error descriptor on the first failure, or null when all are valid.
   */
  async function validateExpansionFks(
    data: Record<string, any>,
    tenantId: string,
    selfId?: string,
  ): Promise<{ field: string; message: string } | null> {
    const checks: Array<[string, string, string]> = [
      ['state_id',       'states',       'State'],
      ['cluster_id',     'clusters',     'Cluster'],
      ['cost_center_id', 'cost_centers', 'Cost center'],
      ['parent_site_id', 'sites',        'Parent site'],
    ]
    for (const [field, table, label] of checks) {
      const id = data[field]
      if (!id) continue
      if (field === 'parent_site_id' && id === selfId)
        return { field, message: 'A site cannot be its own parent' }
      const { data: row } = await fastify.supabase
        .from(table)
        .select('id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!row) return { field, message: `${label} not found in your organisation` }

      // Ancestor-chain walk (same gap class as departments/index.ts's
      // parent_id) — the direct self-parent check above only catches a
      // 1-hop cycle; without this, a longer cycle (set A's parent to B,
      // then B's parent to A) silently corrupts the site hierarchy.
      if (field === 'parent_site_id' && selfId) {
        let cursor: string | null = id
        let depth = 0
        while (cursor && depth < MAX_PARENT_DEPTH) {
          const { data: node } = await fastify.supabase
            .from('sites').select('parent_site_id').eq('id', cursor).eq('tenant_id', tenantId).maybeSingle()
          const nodeRow = node as { parent_site_id: string | null } | null
          if (!nodeRow) break
          cursor = nodeRow.parent_site_id
          depth++
          if (cursor === selfId) {
            return { field, message: 'Setting this parent would create a circular site hierarchy' }
          }
        }
      }
    }
    return null
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
    // PostgREST caps any single response at 1000 rows server-side — a plain
    // .select() silently truncated the Sites list for an enterprise tenant
    // with more than 1000 sites (the exact table this file's own roster/
    // rotation-policy siblings already call out as capable of exceeding it).
    const data = await fetchAllRows<any>((from, to) =>
      fastify.supabase
        .from('sites')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .order('name')
        .range(from, to),
    )
    return reply.send({ data })
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

    // Validate the new grouping FKs (migration 275) belong to this tenant.
    const fkErr = await validateExpansionFks(parsed.data, req.tenantId)
    if (fkErr) return reply.code(400).send({ error: 'VALIDATION', message: fkErr.message, field: fkErr.field })

    // Strip migration-dependent optional columns when null/undefined so the
    // insert never references a column that may not exist in older deployments
    // (166 → state_code, 217 → holiday_group_id, 248 → site dimensions, 275 → expansion).
    const { state_code, holiday_group_id, site_type, city, region, zone, ...rest } = parsed.data
    const coreInsert: Record<string, unknown> = { ...rest }
    for (const k of EXPANSION_KEYS) delete coreInsert[k]
    const insertPayload: Record<string, unknown> = { ...coreInsert, tenant_id: req.tenantId }
    if (state_code       != null) insertPayload.state_code       = state_code
    if (holiday_group_id != null) insertPayload.holiday_group_id = holiday_group_id
    if (site_type        != null) insertPayload.site_type        = site_type
    if (city             != null) insertPayload.city             = city
    if (region           != null) insertPayload.region           = region
    if (zone             != null) insertPayload.zone             = zone
    for (const k of EXPANSION_KEYS) {
      const v = (parsed.data as any)[k]
      if (v != null) insertPayload[k] = v
    }

    const { data, error } = await fastify.supabase
      .from('sites')
      .insert(insertPayload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A site named "${parsed.data.name}" already exists`,
        })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create site')
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

    // Validate the new grouping FKs (migration 275) belong to this tenant.
    const fkErr = await validateExpansionFks(parsed.data, req.tenantId, (req.params as any).id)
    if (fkErr) return reply.code(400).send({ error: 'VALIDATION', message: fkErr.message, field: fkErr.field })

    // Strip migration-dependent optional columns when null/undefined (same
    // resilience pattern as INSERT above — migration 166/217/248/275 may be absent).
    const { state_code, holiday_group_id, site_type, city, region, zone, ...rest } = parsed.data
    const coreUpdate: Record<string, unknown> = { ...rest }
    for (const k of EXPANSION_KEYS) delete coreUpdate[k]
    const updatePayload: Record<string, unknown> = { ...coreUpdate }
    if (state_code       != null) updatePayload.state_code       = state_code
    if (holiday_group_id != null) updatePayload.holiday_group_id = holiday_group_id
    if (site_type        != null) updatePayload.site_type        = site_type
    if (city             != null) updatePayload.city             = city
    if (region           != null) updatePayload.region           = region
    if (zone             != null) updatePayload.zone             = zone
    for (const k of EXPANSION_KEYS) {
      const v = (parsed.data as any)[k]
      if (v != null) updatePayload[k] = v
    }

    const { data, error } = await fastify.supabase
      .from('sites')
      .update(updatePayload)
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update site')
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

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch site usage')

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
    // merge_to === id would resolve to the record being deleted itself,
    // passing the tenant check below while every reassignment UPDATE
    // becomes a no-op and the record is deleted anyway — the referencing
    // FK (ON DELETE SET NULL) goes to NULL instead of the intended target.
    if (mergeTo === id) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to cannot be the same record being deleted' })
    }

    // merge_to must resolve to a site in this tenant — without this,
    // work_locations rows could be repointed at another tenant's site.
    if (mergeTo) {
      const { data: mergeTarget, error: mergeCheckErr } = await fastify.supabase
        .from('sites')
        .select('id')
        .eq('id', mergeTo)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (mergeCheckErr) return serverError(req, reply, mergeCheckErr, ErrorCode.QUERY_FAILED, 'Failed to verify merge target')
      if (!mergeTarget) return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must reference a site in your organisation' })
    }

    const { count, error: countErr } = await fastify.supabase
      .from('work_locations')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check site usage')

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
      if (reassignErr) return serverError(req, reply, reassignErr, ErrorCode.UPDATE_FAILED, 'Failed to reassign work locations to the merge target site')
    }

    const { error } = await fastify.supabase
      .from('sites')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete site')
    return reply.code(204).send()
  })
}
