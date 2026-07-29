/**
 * rotation-policies.ts
 *
 * CRUD + impact + duplicate endpoints for the Enterprise Rotation Policy
 * Governance module.
 *
 * Routes (all prefixed /masters/rotation-policies):
 *   GET    /              — list all policies for tenant
 *   POST   /              — create policy (with optional rules)
 *   GET    /:id           — single policy with rules + shifts
 *   PUT    /:id           — update policy metadata + rules (full replace)
 *   DELETE /:id           — delete (only if no employees/sites reference it)
 *   GET    /:id/impact    — sites and employee counts that use this policy
 *   POST   /:id/duplicate — clone policy
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CONDITION_TYPES = [
  'weekday_working',
  'saturday_working',
  'sunday_working',
  'half_day',
  'holiday_working',
] as const

const ruleSchema = z.object({
  condition_type: z.enum(CONDITION_TYPES),
  shift_id:       z.string().uuid('shift_id must be a valid UUID'),
  sort_order:     z.number().int().min(0).optional().default(0),
})

const policySchema = z.object({
  name:        z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  is_active:   z.boolean().optional().default(true),
  rules:       z.array(ruleSchema).optional().default([]),
})

// ── Columns to select ─────────────────────────────────────────────────────────

const POLICY_COLS = 'id, tenant_id, name, description, is_active, created_at, updated_at'

// rotation_policy_rules.shift_id only FKs to shifts(id) — no tenant compound
// key (migration 153_rotation_policies.sql) — so the DB alone won't stop a
// caller attaching another tenant's shift to their own rotation policy.
// Verify every rule's shift_id belongs to this tenant before insert.
async function allShiftsBelongToTenant(fastify: any, tenantId: string, shiftIds: string[]): Promise<boolean> {
  if (shiftIds.length === 0) return true
  const uniqueIds = [...new Set(shiftIds)]
  const { data } = await fastify.supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', uniqueIds)
  return (data?.length ?? 0) === uniqueIds.length
}

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function rotationPoliciesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET / — list ─────────────────────────────────────────────────────────────

  fastify.get('/', auth, async (req: any, reply) => {
    const { show_inactive } = req.query as { show_inactive?: string }

    let q = fastify.supabase
      .from('rotation_policies')
      .select(POLICY_COLS)
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (show_inactive !== 'true') q = q.eq('is_active', true)

    const { data: policies, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch rotation policies')

    if (!policies || policies.length === 0) return reply.send({ data: [] })

    // Attach rule counts per policy
    const policyIds = policies.map((p: any) => p.id)
    const { data: rules } = await fastify.supabase
      .from('rotation_policy_rules')
      .select('rotation_policy_id, condition_type')
      .in('rotation_policy_id', policyIds)

    const ruleMap = new Map<string, number>()
    for (const r of rules ?? []) {
      const rid = (r as any).rotation_policy_id
      ruleMap.set(rid, (ruleMap.get(rid) ?? 0) + 1)
    }

    // Attach employee and site counts. Paginated — feeds the
    // employee_count/site_count badges shown for every policy; an unbounded
    // scan would silently undercount for a tenant with more than 1000
    // matching employees/sites.
    const empRows = await fetchAllRows<{ rotation_policy_id: string | null }>((from, to) =>
      fastify.supabase
        .from('employees')
        .select('rotation_policy_id')
        .eq('tenant_id', req.tenantId)
        .in('rotation_policy_id', policyIds)
        .range(from, to),
    )

    const empMap = new Map<string, number>()
    for (const e of empRows ?? []) {
      const pid = (e as any).rotation_policy_id
      empMap.set(pid, (empMap.get(pid) ?? 0) + 1)
    }

    const siteRows = await fetchAllRows<{ default_rotation_policy_id: string | null }>((from, to) =>
      fastify.supabase
        .from('sites')
        .select('default_rotation_policy_id')
        .eq('tenant_id', req.tenantId)
        .in('default_rotation_policy_id', policyIds)
        .range(from, to),
    )

    const siteMap = new Map<string, number>()
    for (const s of siteRows ?? []) {
      const pid = (s as any).default_rotation_policy_id
      siteMap.set(pid, (siteMap.get(pid) ?? 0) + 1)
    }

    const enriched = policies.map((p: any) => ({
      ...p,
      rule_count:      ruleMap.get(p.id) ?? 0,
      employee_count:  empMap.get(p.id) ?? 0,
      site_count:      siteMap.get(p.id) ?? 0,
    }))

    return reply.send({ data: enriched })
  })

  // ── POST / — create ───────────────────────────────────────────────────────────

  fastify.post('/', hrAdminAuth, async (req: any, reply) => {
    const parsed = policySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { rules, ...meta } = parsed.data

    const { data: policy, error: pe } = await fastify.supabase
      .from('rotation_policies')
      .insert({ ...meta, tenant_id: req.tenantId })
      .select(POLICY_COLS)
      .single()

    if (pe) {
      if (pe.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A policy with this name already exists' })
      return serverError(req, reply, pe, ErrorCode.INSERT_FAILED, 'Failed to create rotation policy')
    }

    // Insert rules if provided
    if (rules.length > 0) {
      if (!(await allShiftsBelongToTenant(fastify, req.tenantId, rules.map(r => r.shift_id)))) {
        return reply.code(404).send({ error: 'INVALID_SHIFT', message: 'One or more shifts were not found in your organisation' })
      }
      const ruleRows = rules.map((r) => ({
        ...r,
        rotation_policy_id: (policy as any).id,
        tenant_id:          req.tenantId,
      }))
      const { error: re } = await fastify.supabase
        .from('rotation_policy_rules')
        .insert(ruleRows)
      if (re) return serverError(req, reply, re, ErrorCode.INSERT_FAILED, 'Failed to create rotation policy rules')
    }

    return reply.code(201).send(policy)
  })

  // ── GET /:id — single policy with rules ───────────────────────────────────────

  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data: policy, error: pe } = await fastify.supabase
      .from('rotation_policies')
      .select(POLICY_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (pe) return serverError(req, reply, pe, ErrorCode.QUERY_FAILED, 'Failed to fetch rotation policy')
    if (!policy) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })

    const { data: rules } = await fastify.supabase
      .from('rotation_policy_rules')
      .select(`
        id, condition_type, sort_order, created_at,
        shift_id,
        shifts!rotation_policy_rules_shift_id_fkey (
          id, name, code, start_time, end_time, grace_minutes, is_night_shift, is_active
        )
      `)
      .eq('rotation_policy_id', req.params.id)
      .order('sort_order', { ascending: true })

    return reply.send({ data: { ...policy, rules: rules ?? [] } })
  })

  // ── PUT /:id — full update (metadata + rules) ─────────────────────────────────

  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = policySchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { rules, ...meta } = parsed.data

    // The metadata UPDATE below is the only place that normally checks the
    // policy id belongs to this tenant, but it's skipped when the body is
    // rules-only. Without this check, a caller could attach new rule rows
    // (via the insert further down) to another tenant's rotation policy by
    // supplying its id in the URL — a cross-tenant write, not just a read.
    const { data: owned } = await fastify.supabase
      .from('rotation_policies').select('id').eq('id', req.params.id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!owned) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })

    // Update metadata
    if (Object.keys(meta).length > 0) {
      const { data, error } = await fastify.supabase
        .from('rotation_policies')
        .update(meta)
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .select(POLICY_COLS)
        .maybeSingle()
      if (error) {
        if (error.code === '23505')
          return reply.code(409).send({ error: 'DUPLICATE', message: 'A policy with this name already exists' })
        return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update rotation policy')
      }
      if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }

    // Replace rules if provided — TEMPORAL versioning (AHI-3). Instead of
    // deleting history (which retroactively rewrote past attendance recomputes),
    // close the currently-open versions as of yesterday and insert the new set
    // effective today. Past dates continue to resolve to the version that was in
    // effect then.
    if (Array.isArray(rules)) {
      // Validate before mutating anything below, so a bad shift_id doesn't
      // close out the previous rule versions and then fail the insert,
      // leaving the policy with no active rules at all.
      if (rules.length > 0 && !(await allShiftsBelongToTenant(fastify, req.tenantId, rules.map(r => r.shift_id)))) {
        return reply.code(404).send({ error: 'INVALID_SHIFT', message: 'One or more shifts were not found in your organisation' })
      }

      const today     = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

      const { error: closeErr } = await fastify.supabase
        .from('rotation_policy_rules')
        .update({ effective_to: yesterday })
        .eq('rotation_policy_id', req.params.id)
        // Tenant isolation: when the body carries only `rules` (no metadata),
        // the tenant-scoped metadata UPDATE above is skipped, so this is the
        // only write touching a foreign policy id. Scope it to the caller's
        // tenant so it can't close another tenant's open rule versions.
        .eq('tenant_id', req.tenantId)
        .is('effective_to', null)
      if (closeErr) return serverError(req, reply, closeErr, ErrorCode.UPDATE_FAILED, 'Failed to close previous rotation policy rule versions')

      if (rules.length > 0) {
        const ruleRows = rules.map((r) => ({
          ...r,
          rotation_policy_id: req.params.id,
          tenant_id:          req.tenantId,
          effective_from:     today,
          effective_to:       null,
        }))
        const { error: re } = await fastify.supabase
          .from('rotation_policy_rules')
          .insert(ruleRows)
        if (re) return serverError(req, reply, re, ErrorCode.INSERT_FAILED, 'Failed to create updated rotation policy rules')
      }
    }

    // Return updated policy with rules
    const { data: updated } = await fastify.supabase
      .from('rotation_policies')
      .select(POLICY_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()

    const { data: updatedRules } = await fastify.supabase
      .from('rotation_policy_rules')
      .select(`
        id, condition_type, sort_order, created_at,
        shift_id,
        shifts!rotation_policy_rules_shift_id_fkey (
          id, name, code, start_time, end_time, grace_minutes, is_night_shift, is_active
        )
      `)
      .eq('rotation_policy_id', req.params.id)
      .order('sort_order', { ascending: true })

    return reply.send({ data: { ...updated, rules: updatedRules ?? [] } })
  })

  // ── DELETE /:id ────────────────────────────────────────────────────────────────

  fastify.delete('/:id', hrAdminAuth, async (req: any, reply) => {
    // Safety check — refuse if any employees or sites reference this policy
    const { count: empCount, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('rotation_policy_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to check rotation policy usage')

    const { count: siteCount, error: siteErr } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('default_rotation_policy_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (siteErr) return serverError(req, reply, siteErr, ErrorCode.QUERY_FAILED, 'Failed to check rotation policy usage')

    const totalRefs = (empCount ?? 0) + (siteCount ?? 0)
    if (totalRefs > 0)
      return reply.code(409).send({
        error: 'REFERENCED',
        message: `Policy is used by ${empCount ?? 0} employee(s) and ${siteCount ?? 0} site(s). Unassign them first.`,
      })

    const { error } = await fastify.supabase
      .from('rotation_policies')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete rotation policy')
    return reply.code(204).send()
  })

  // ── GET /:id/impact ────────────────────────────────────────────────────────────

  fastify.get('/:id/impact', hrAdminAuth, async (req: any, reply) => {
    const pid = req.params.id as string

    // Paginated — a widely-used rotation policy's true employee list can
    // exceed 1000 rows for an enterprise tenant; an unbounded scan would
    // silently truncate the impact list before edit/delete.
    const [employees, sites] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_no:employee_code')
          .eq('tenant_id', req.tenantId)
          .eq('rotation_policy_id', pid)
          .eq('status', 'active')
          .order('last_name')
          .range(from, to),
      ),
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('sites')
          .select('id, name, code')
          .eq('tenant_id', req.tenantId)
          .eq('default_rotation_policy_id', pid)
          .order('name')
          .range(from, to),
      ),
    ])

    return reply.send({
      data: {
        employee_count: employees.length,
        site_count:     sites.length,
        employees:      employees.map((e: any) => ({
          id:           e.id,
          employee_no:  e.employee_no,
          display_name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
        })),
        sites,
      },
    })
  })

  // ── POST /:id/duplicate ────────────────────────────────────────────────────────

  fastify.post('/:id/duplicate', hrAdminAuth, async (req: any, reply) => {
    const { data: source, error: se } = await fastify.supabase
      .from('rotation_policies')
      .select(POLICY_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (se) return serverError(req, reply, se, ErrorCode.QUERY_FAILED, 'Failed to fetch source rotation policy')
    if (!source) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Source policy not found' })

    const s = source as {
      name: string
      description: string | null
      is_active: boolean
    }

    const { data: clone, error: ce } = await fastify.supabase
      .from('rotation_policies')
      .insert({
        tenant_id:   req.tenantId,
        name:        `${s.name} (Copy)`,
        description: s.description,
        is_active:   false,  // clones start inactive
      })
      .select(POLICY_COLS)
      .single()

    if (ce) {
      if (ce.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: '"(Copy)" name already exists — rename the original first' })
      return serverError(req, reply, ce, ErrorCode.INSERT_FAILED, 'Failed to duplicate rotation policy')
    }

    // Copy rules
    const { data: srcRules } = await fastify.supabase
      .from('rotation_policy_rules')
      .select('condition_type, shift_id, sort_order')
      .eq('rotation_policy_id', req.params.id)

    if (srcRules && srcRules.length > 0) {
      const cloneRules = srcRules.map((r: any) => ({
        rotation_policy_id: (clone as any).id,
        tenant_id:          req.tenantId,
        condition_type:     r.condition_type,
        shift_id:           r.shift_id,
        sort_order:         r.sort_order,
      }))
      const { error: cloneRuleErr } = await fastify.supabase.from('rotation_policy_rules').insert(cloneRules)
      if (cloneRuleErr) return serverError(req, reply, cloneRuleErr, ErrorCode.INSERT_FAILED, 'Policy duplicated but failed to clone its rules')
    }

    return reply.code(201).send(clone)
  })
}
