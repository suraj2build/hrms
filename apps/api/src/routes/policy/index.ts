/**
 * Policy KB routes — /policies
 *
 * HR-authored company policy documents with employee acknowledgement tracking.
 *
 * Employee endpoints (fastify.authenticate):
 *   GET  /                 — published policies (with per-employee ack status)
 *   GET  /:id              — single policy with full content + ack status
 *   POST /:id/ack          — employee acknowledges a policy
 *
 * Admin endpoints (hr_admin / super_admin):
 *   GET  /admin/list       — all policies regardless of status
 *   GET  /admin/:id/acks   — per-policy acknowledgement stats
 *   POST /                 — create policy (status: draft)
 *   PUT  /:id              — update policy fields
 *   POST /:id/publish      — publish + notify employees who must ack
 *   POST /:id/archive      — archive a published/draft policy
 */

import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction }                   from '../../lib/audit-service.js'
import { notify }                      from '../../lib/notify.js'

export default async function policyRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function getEmployeeId(profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', profileId)
      .single()
    return data?.employee_id ?? null
  }

  // ── Employee: list published policies with ack status ─────────────────────

  fastify.get('/', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { category } = req.query as { category?: string }

    const q = supabase
      .from('hr_policies')
      .select('id, title, category, description, status, requires_acknowledgement, effective_from, published_at, version')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .order('category')
      .order('title')

    if (category) q.eq('category', category)

    const { data: policies, error } = await q
    if (error) return reply.status(500).send({ error: error.message })

    const employeeId = await getEmployeeId(req.user.id)
    const ackedIds = new Set<string>()

    if (employeeId) {
      const { data: acks } = await supabase
        .from('policy_acknowledgements')
        .select('policy_id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
      acks?.forEach(a => ackedIds.add(a.policy_id))
    }

    const result = (policies ?? []).map(p => ({
      ...p,
      ack_status: !p.requires_acknowledgement
        ? 'not_required'
        : ackedIds.has(p.id) ? 'acknowledged' : 'pending',
    }))

    return reply.send({ data: result })
  })

  // ── Admin: list all policies (draft + published + archived) ───────────────

  fastify.get('/admin/list', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { status } = req.query as { status?: string }

    const q = supabase
      .from('hr_policies')
      .select('id, title, category, description, status, requires_acknowledgement, effective_from, published_at, version, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (status) q.eq('status', status)

    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })

    // Attach ack counts for published policies
    const publishedIds = (data ?? []).filter(p => p.status === 'published').map(p => p.id)
    const ackCounts: Record<string, number> = {}
    if (publishedIds.length > 0) {
      const { data: counts } = await supabase
        .from('policy_acknowledgements')
        .select('policy_id')
        .eq('tenant_id', tenantId)
        .in('policy_id', publishedIds)
      ;(counts ?? []).forEach(c => {
        ackCounts[c.policy_id] = (ackCounts[c.policy_id] ?? 0) + 1
      })
    }

    const result = (data ?? []).map(p => ({
      ...p,
      ack_count: ackCounts[p.id] ?? 0,
    }))

    return reply.send({ data: result })
  })

  // ── Admin: ack stats for a policy ────────────────────────────────────────

  fastify.get('/admin/:id/acks', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }

    const [empResult, ackResult] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'on_leave']),
      supabase
        .from('policy_acknowledgements')
        .select('employee_id, acknowledged_at')
        .eq('tenant_id', tenantId)
        .eq('policy_id', id),
    ])

    const ackMap = new Map(
      (ackResult.data ?? []).map(a => [a.employee_id, a.acknowledged_at]),
    )

    const employees = (empResult.data ?? []).map(e => ({
      ...e,
      acknowledged:    ackMap.has(e.id),
      acknowledged_at: ackMap.get(e.id) ?? null,
    }))

    const total        = employees.length
    const acknowledged = employees.filter(e => e.acknowledged).length

    return reply.send({
      data: {
        total,
        acknowledged,
        pending: total - acknowledged,
        rate:    total > 0 ? Math.round((acknowledged / total) * 100) : 0,
        employees,
      },
    })
  })

  // ── Employee/Admin: get single policy ──────────────────────────────────────

  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const { data, error } = await supabase
      .from('hr_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single()

    if (error || !data) return reply.status(404).send({ error: 'Policy not found' })

    let ackStatus = 'not_required'
    if (data.requires_acknowledgement) {
      const employeeId = await getEmployeeId(req.user.id)
      if (employeeId) {
        const { data: ack } = await supabase
          .from('policy_acknowledgements')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('policy_id', id)
          .eq('employee_id', employeeId)
          .maybeSingle()
        ackStatus = ack ? 'acknowledged' : 'pending'
      }
    }

    return reply.send({ data: { ...data, ack_status: ackStatus } })
  })

  // ── Admin: create policy ──────────────────────────────────────────────────

  fastify.post('/', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const {
      title,
      category = 'other',
      description,
      content,
      file_url,
      requires_acknowledgement = false,
      effective_from,
    } = req.body as any

    if (!title?.trim()) return reply.status(400).send({ error: 'title is required' })

    const { data, error } = await supabase
      .from('hr_policies')
      .insert({
        tenant_id: tenantId,
        title:     title.trim(),
        category,
        description,
        content,
        file_url,
        requires_acknowledgement,
        effective_from: effective_from || null,
        created_by:     req.user.id,
        status:         'draft',
      })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    data.id,
      action:      'INSERT',
      performedBy: req.user.id,
      newData:     { title, category },
    })

    return reply.status(201).send({ data })
  })

  // ── Admin: update policy ──────────────────────────────────────────────────

  fastify.put('/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }
    const body     = req.body as Record<string, unknown>

    const allowed = [
      'title','category','description','content',
      'file_url','requires_acknowledgement','effective_from',
    ]
    const update: Record<string, unknown> = {}
    for (const k of allowed) {
      if (body[k] !== undefined) update[k] = body[k]
    }

    if (Object.keys(update).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' })
    }

    const { data, error } = await supabase
      .from('hr_policies')
      .update(update)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('id, title')
      .single()

    if (error) return reply.status(500).send({ error: error.message })

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.user.id,
      newData:     update,
    })

    return reply.send({ data })
  })

  // ── Admin: publish policy ─────────────────────────────────────────────────

  fastify.post('/:id/publish', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const { data: policy, error } = await supabase
      .from('hr_policies')
      .update({
        status:       'published',
        published_at: new Date().toISOString(),
        published_by: req.user.id,
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .not('status', 'eq', 'archived')
      .select('title, requires_acknowledgement')
      .single()

    if (error || !policy) {
      return reply.status(422).send({ error: error?.message ?? 'Policy not found or already archived' })
    }

    // Notify all active employees if acknowledgement is required
    if (policy.requires_acknowledgement) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('role', ['employee', 'manager', 'hr_admin', 'super_admin'])

      for (const p of profiles ?? []) {
        await notify(supabase, {
          tenantId,
          recipientId: p.id,
          item_type:   'general',
          title:       'Policy Acknowledgement Required',
          summary:     `Please read and acknowledge: ${policy.title}`,
          severity:    'info',
          entity_type: 'hr_policy',
          entity_id:   id,
          action_route: `/ess/policies?policy=${id}`,
          action_label: 'View & Acknowledge',
        })
      }
    }

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.user.id,
      newData:     { status: 'published' },
    })

    return reply.send({ data: { published: true, notified: policy.requires_acknowledgement } })
  })

  // ── Admin: archive policy ─────────────────────────────────────────────────

  fastify.post('/:id/archive', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const { error } = await supabase
      .from('hr_policies')
      .update({ status: 'archived' })
      .eq('tenant_id', tenantId)
      .eq('id', id)

    if (error) return reply.status(500).send({ error: error.message })

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.user.id,
      newData:     { status: 'archived' },
    })

    return reply.send({ data: { archived: true } })
  })

  // ── Employee: acknowledge policy ──────────────────────────────────────────

  fastify.post('/:id/ack', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const employeeId = await getEmployeeId(req.user.id)
    if (!employeeId) {
      return reply.status(400).send({ error: 'No employee profile linked to your account' })
    }

    // Verify the policy exists and requires ack
    const { data: policy, error: pErr } = await supabase
      .from('hr_policies')
      .select('requires_acknowledgement, status')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single()

    if (pErr || !policy) return reply.status(404).send({ error: 'Policy not found' })
    if (policy.status !== 'published') return reply.status(400).send({ error: 'Policy is not published' })

    const { error } = await supabase
      .from('policy_acknowledgements')
      .upsert(
        {
          tenant_id:      tenantId,
          policy_id:      id,
          employee_id:    employeeId,
          acknowledged_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,policy_id,employee_id' },
      )

    if (error) return reply.status(500).send({ error: error.message })

    return reply.send({ data: { acknowledged: true } })
  })
}
