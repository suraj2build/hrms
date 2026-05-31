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

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function rotationPoliciesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

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
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

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

    // Attach employee and site counts
    const { data: empRows } = await fastify.supabase
      .from('employees')
      .select('rotation_policy_id')
      .eq('tenant_id', req.tenantId)
      .in('rotation_policy_id', policyIds)

    const empMap = new Map<string, number>()
    for (const e of empRows ?? []) {
      const pid = (e as any).rotation_policy_id
      empMap.set(pid, (empMap.get(pid) ?? 0) + 1)
    }

    const { data: siteRows } = await fastify.supabase
      .from('sites')
      .select('default_rotation_policy_id')
      .eq('tenant_id', req.tenantId)
      .in('default_rotation_policy_id', policyIds)

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

  fastify.post('/', auth, async (req: any, reply) => {
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
      return reply.code(500).send({ error: 'DB_ERROR', message: pe.message })
    }

    // Insert rules if provided
    if (rules.length > 0) {
      const ruleRows = rules.map((r) => ({
        ...r,
        rotation_policy_id: (policy as any).id,
        tenant_id:          req.tenantId,
      }))
      const { error: re } = await fastify.supabase
        .from('rotation_policy_rules')
        .insert(ruleRows)
      if (re) return reply.code(500).send({ error: 'DB_ERROR', message: re.message })
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

    if (pe) return reply.code(500).send({ error: 'DB_ERROR', message: pe.message })
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

  fastify.put('/:id', auth, async (req: any, reply) => {
    const parsed = policySchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { rules, ...meta } = parsed.data

    // Update metadata
    if (Object.keys(meta).length > 0) {
      const { data, error } = await fastify.supabase
        .from('rotation_policies')
        .update(meta)
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .select(POLICY_COLS)
        .single()
      if (error) {
        if (error.code === '23505')
          return reply.code(409).send({ error: 'DUPLICATE', message: 'A policy with this name already exists' })
        return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      }
      if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }

    // Replace rules if provided (delete all → re-insert)
    if (Array.isArray(rules)) {
      await fastify.supabase
        .from('rotation_policy_rules')
        .delete()
        .eq('rotation_policy_id', req.params.id)

      if (rules.length > 0) {
        const ruleRows = rules.map((r) => ({
          ...r,
          rotation_policy_id: req.params.id,
          tenant_id:          req.tenantId,
        }))
        const { error: re } = await fastify.supabase
          .from('rotation_policy_rules')
          .insert(ruleRows)
        if (re) return reply.code(500).send({ error: 'DB_ERROR', message: re.message })
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

  fastify.delete('/:id', auth, async (req: any, reply) => {
    // Safety check — refuse if any employees or sites reference this policy
    const { count: empCount } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('rotation_policy_id', req.params.id)
      .eq('tenant_id', req.tenantId)

    const { count: siteCount } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('default_rotation_policy_id', req.params.id)
      .eq('tenant_id', req.tenantId)

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

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /:id/impact ────────────────────────────────────────────────────────────

  fastify.get('/:id/impact', auth, async (req: any, reply) => {
    const pid = req.params.id as string

    const [empResult, siteResult] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id, display_name, employee_no')
        .eq('tenant_id', req.tenantId)
        .eq('rotation_policy_id', pid)
        .eq('is_active', true)
        .order('display_name'),
      fastify.supabase
        .from('sites')
        .select('id, name, code')
        .eq('tenant_id', req.tenantId)
        .eq('default_rotation_policy_id', pid)
        .order('name'),
    ])

    return reply.send({
      data: {
        employee_count: empResult.data?.length ?? 0,
        site_count:     siteResult.data?.length ?? 0,
        employees:      empResult.data  ?? [],
        sites:          siteResult.data ?? [],
      },
    })
  })

  // ── POST /:id/duplicate ────────────────────────────────────────────────────────

  fastify.post('/:id/duplicate', auth, async (req: any, reply) => {
    const { data: source, error: se } = await fastify.supabase
      .from('rotation_policies')
      .select(POLICY_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (se) return reply.code(500).send({ error: 'DB_ERROR', message: se.message })
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
      return reply.code(500).send({ error: 'DB_ERROR', message: ce.message })
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
      await fastify.supabase.from('rotation_policy_rules').insert(cloneRules)
    }

    return reply.code(201).send(clone)
  })
}
