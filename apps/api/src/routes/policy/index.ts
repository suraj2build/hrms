/**
 * Policy KB routes — /policies
 *
 * HR-authored company policy documents with employee acknowledgement tracking.
 *
 * Employee endpoints (fastify.authenticate):
 *   GET  /                 — published policies (with per-employee ack status)
 *   GET  /search?q=...     — full-text search across published policies
 *   POST /ask              — RAG Q&A: AI answer with policy citations
 *   GET  /:id              — single policy with full content + ack status
 *   POST /:id/ack          — employee acknowledges a policy
 *
 * Admin endpoints (hr_admin / super_admin):
 *   GET  /admin/list       — all policies regardless of status
 *   GET  /admin/qa-logs    — employee Q&A history
 *   GET  /admin/:id/acks   — per-policy acknowledgement stats
 *   POST /                 — create policy (status: draft)
 *   PUT  /:id              — update policy fields
 *   POST /:id/publish      — publish + notify employees who must ack
 *   POST /:id/archive      — archive a published/draft policy
 */

import { z } from 'zod'
import Anthropic          from '@anthropic-ai/sdk'
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction }                   from '../../lib/audit-service.js'
import { notify }                      from '../../lib/notify.js'
import { fetchAllRows }                from '../../lib/supabase-paginate.js'
import { WhatsAppProvider }            from '../../lib/whatsapp-provider.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'

// ── Body schemas ─────────────────────────────────────────────────────────────

const AskPolicySchema = z.object({
  question: z.string().min(1, 'question is required'),
  language: z.string().optional(),
})

// hr_policies.category CHECK constraint (migration 341) — the ground truth
// for valid categories. Distinct from helpdesk_tickets.category (migration
// 337), which separately allows 'posh'/'compliance' — those are NOT valid
// here.
const POLICY_CATEGORIES = ['leave', 'compensation', 'conduct', 'recruitment', 'learning', 'health', 'it', 'other', 'attendance', 'notice_period', 'payroll', 'faq'] as const

const CreatePolicySchema = z.object({
  title: z.string().min(1, 'title is required'),
  category: z.enum(POLICY_CATEGORIES).optional(),
  description: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  file_url: z.string().optional().nullable(),
  requires_acknowledgement: z.boolean().optional(),
  effective_from: z.string().optional().nullable(),
  is_mandatory: z.boolean().optional(),
})

const UpdatePolicySchema = z.object({
  title: z.string().optional(),
  category: z.enum(POLICY_CATEGORIES).optional(),
  description: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  file_url: z.string().optional().nullable(),
  requires_acknowledgement: z.boolean().optional(),
  effective_from: z.string().optional().nullable(),
  is_mandatory: z.boolean().optional(),
})

export default async function policyRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }
  const ai     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function getEmployeeId(profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', profileId)
      .single()
    return data?.employee_id ?? null
  }

  // ── Employee: FTS search across published policies ───────────────────────

  fastify.get('/search', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { q } = req.query as { q?: string }

    if (!q?.trim() || q.trim().length < 2) {
      return reply.status(400).send({ error: 'q must be at least 2 characters' })
    }

    const { data, error } = await supabase.rpc('search_policies', {
      p_tenant_id: tenantId,
      p_query:     q.trim(),
      p_limit:     5,
    })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to search policies')

    return reply.send({ data: data ?? [] })
  })

  // ── Employee: RAG — AI-powered Q&A with policy citations ─────────────────

  fastify.post('/ask', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const parsed = AskPolicySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { question, language } = parsed.data

    const employeeId = await getEmployeeId(req.userId)

    // Detect language: explicit param > Hindi Devanagari script detection > English
    const isHindi = language === 'hi' || /[ऀ-ॿ]/.test(question)
    const lang    = isHindi ? 'Hindi' : 'English'

    // 1. FTS — find relevant published policies
    const { data: hits, error: searchErr } = await supabase.rpc('search_policies', {
      p_tenant_id: tenantId,
      p_query:     question.trim(),
      p_limit:     4,
    })
    if (searchErr) return serverError(req, reply, searchErr, ErrorCode.QUERY_FAILED, 'Failed to search policies')

    type HitRow = { id: string; title: string; category: string; content: string | null; snippet: string }
    const policies: HitRow[] = (hits ?? []) as HitRow[]

    // 2. Build context for the model
    const context = policies.length > 0
      ? policies.map(p =>
          `[POLICY: ${p.title} (${p.category})]\n${(p.content ?? p.snippet ?? '').slice(0, 2000)}`
        ).join('\n\n---\n\n')
      : 'No company policies found that are directly relevant to this question.'

    // 3. Call Claude
    const msg = await ai.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `You are a helpful HR assistant for CognixHR. Answer employee questions based ONLY on the company policies provided. Respond in ${lang}. Be concise, friendly, and specific. Quote the relevant policy clause when possible. If the answer is not clearly covered in the policies, say so honestly and suggest the employee contact HR directly.`,
      messages: [{
        role:    'user',
        content: `Company policies:\n\n${context}\n\n---\n\nEmployee question: ${question.trim()}\n\nProvide a clear, helpful answer based on the policies above.`,
      }],
    })

    const answer = msg.content[0]?.type === 'text'
      ? msg.content[0].text
      : 'Unable to generate an answer. Please contact HR directly.'

    const citedIds = policies.map(p => p.id)

    // 4. Log Q&A
    await supabase.from('policy_qa_logs').insert({
      tenant_id:        tenantId,
      employee_id:      employeeId,
      question:         question.trim(),
      answer,
      cited_policy_ids: citedIds,
      model_used:       'claude-haiku-4-5-20251001',
    })

    return reply.send({
      data: {
        answer,
        cited_policies: policies.map(p => ({ id: p.id, title: p.title, category: p.category })),
      },
    })
  })

  // ── Employee: list published policies with ack status ─────────────────────

  fastify.get('/', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { category } = req.query as { category?: string }

    let policies: any[]
    try {
      policies = await fetchAllRows((from, to) => {
        let q = supabase
          .from('hr_policies')
          .select('id, title, category, description, status, requires_acknowledgement, effective_from, published_at, version')
          .eq('tenant_id', tenantId)
          .eq('status', 'published')
          .order('category')
          .order('title')
        if (category) q = q.eq('category', category)
        return q.range(from, to)
      })
    } catch (err) {
      req.log.error({ err }, 'hr_policies list query failed')
      return reply.status(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch policies' })
    }

    const employeeId = await getEmployeeId(req.userId)
    const ackedIds = new Set<string>()

    if (employeeId) {
      const { data: acks } = await supabase
        .from('policy_acknowledgements')
        .select('policy_id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
      acks?.forEach(a => ackedIds.add(a.policy_id))
    }

    const result = policies.map(p => ({
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

    let data: any[]
    try {
      data = await fetchAllRows((from, to) => {
        let q = supabase
          .from('hr_policies')
          .select('id, title, category, description, status, requires_acknowledgement, effective_from, published_at, version, created_at, is_mandatory')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
        if (status) q = q.eq('status', status)
        return q.range(from, to)
      })
    } catch (err) {
      req.log.error({ err }, 'hr_policies admin list query failed')
      return reply.status(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch policies' })
    }

    // Attach ack counts for published policies
    const publishedIds = data.filter(p => p.status === 'published').map(p => p.id)
    const ackCounts: Record<string, number> = {}
    if (publishedIds.length > 0) {
      // Paginated — a plain .select() truncates at PostgREST's 1,000-row
      // ceiling once a mandatory-ack policy has been acked by more than
      // 1,000 employees, understating ack_count for large tenants.
      const counts = await fetchAllRows<{ policy_id: string }>((from, to) =>
        supabase
          .from('policy_acknowledgements')
          .select('policy_id')
          .eq('tenant_id', tenantId)
          .in('policy_id', publishedIds)
          .range(from, to),
      )
      counts.forEach(c => {
        ackCounts[c.policy_id] = (ackCounts[c.policy_id] ?? 0) + 1
      })
    }

    const result = data.map(p => ({
      ...p,
      ack_count: ackCounts[p.id] ?? 0,
    }))

    return reply.send({ data: result })
  })

  // ── Admin: Q&A logs — what employees asked ───────────────────────────────

  fastify.get('/admin/qa-logs', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { limit = 50 } = req.query as { limit?: number }

    const { data, error } = await supabase
      .from('policy_qa_logs')
      .select(`
        id, question, answer, cited_policy_ids, model_used, created_at,
        employees!employee_id(first_name, last_name, employee_code)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy Q&A logs')

    return reply.send({ data: data ?? [] })
  })

  // ── Admin: ack stats for a policy ────────────────────────────────────────

  fastify.get('/admin/:id/acks', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id } = req.params as { id: string }

    // employees and policy_acknowledgements are both paginated — an
    // unbounded .select() truncates at PostgREST's 1,000-row ceiling for a
    // large tenant, understating both total and acknowledged counts in the
    // ack-stats panel.
    const [empRows, ackRows] = await Promise.all([
      fetchAllRows<{ id: string; employee_code: string; first_name: string; last_name: string; work_location_id: string | null }>((from, to) =>
        supabase
          .from('employees')
          .select('id, employee_code, first_name, last_name, work_location_id')
          .eq('tenant_id', tenantId)
          .in('status', ['active', 'on_leave'])
          .range(from, to),
      ),
      fetchAllRows<{ employee_id: string; acknowledged_at: string }>((from, to) =>
        supabase
          .from('policy_acknowledgements')
          .select('employee_id, acknowledged_at')
          .eq('tenant_id', tenantId)
          .eq('policy_id', id)
          .range(from, to),
      ),
    ])

    const ackMap = new Map(
      ackRows.map(a => [a.employee_id, a.acknowledged_at]),
    )

    const employees = empRows.map(e => ({
      ...e,
      acknowledged:    ackMap.has(e.id),
      acknowledged_at: ackMap.get(e.id) ?? null,
    }))

    const total        = employees.length
    const acknowledged = employees.filter(e => e.acknowledged).length

    // Location breakdown
    const locationIds = [...new Set(employees.map(e => e.work_location_id).filter(Boolean))]
    const locationMap: Record<string, string> = {}
    if (locationIds.length > 0) {
      const { data: locs } = await supabase
        .from('work_locations')
        .select('id, name')
        .in('id', locationIds)
      ;(locs ?? []).forEach(l => { locationMap[l.id] = l.name })
    }

    const byLocation: Record<string, { name: string; total: number; acknowledged: number }> = {}
    for (const e of employees) {
      const locId = e.work_location_id ?? '__unassigned__'
      if (!byLocation[locId]) {
        byLocation[locId] = { name: locationMap[locId] ?? 'Unassigned', total: 0, acknowledged: 0 }
      }
      byLocation[locId].total++
      if (e.acknowledged) byLocation[locId].acknowledged++
    }

    const location_breakdown = Object.entries(byLocation).map(([id, v]) => ({
      location_id:  id === '__unassigned__' ? null : id,
      location_name: v.name,
      total:        v.total,
      acknowledged: v.acknowledged,
      pending:      v.total - v.acknowledged,
      rate:         v.total > 0 ? Math.round((v.acknowledged / v.total) * 100) : 0,
    }))

    return reply.send({
      data: {
        total,
        acknowledged,
        pending: total - acknowledged,
        rate:    total > 0 ? Math.round((acknowledged / total) * 100) : 0,
        employees,
        location_breakdown,
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
      const employeeId = await getEmployeeId(req.userId)
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
    const parsed = CreatePolicySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const {
      title,
      category = 'other',
      description,
      content,
      file_url,
      requires_acknowledgement = false,
      effective_from,
      is_mandatory = false,
    } = parsed.data

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
        is_mandatory,
        created_by:     req.userId,
        status:         'draft',
      })
      .select('id')
      .single()

    if (error) {
      req.log.error({ err: error, tenantId }, 'policy/create: insert failed')
      return reply.status(500).send({ error: 'INSERT_FAILED', message: 'Failed to create policy' })
    }

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    data.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { title, category },
    })

    return reply.status(201).send({ data })
  })

  // ── Admin: update policy ──────────────────────────────────────────────────

  fastify.put('/:id', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }
    const parsedBody = UpdatePolicySchema.safeParse(req.body)
    if (!parsedBody.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsedBody.error.issues[0]?.message ?? 'Invalid request body' })
    const body = parsedBody.data as Record<string, unknown>

    const allowed = [
      'title','category','description','content',
      'file_url','requires_acknowledgement','effective_from','is_mandatory',
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
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update policy')
    }
    if (!data) return notFound(reply, 'POLICY_NOT_FOUND', 'Policy not found')

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
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
        published_by: req.userId,
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
      // Paginated — an unbounded .select() truncates at PostgREST's 1,000-row
      // ceiling, silently excluding profiles past that cutoff from the
      // in-app notification (same class of bug already fixed for the
      // WhatsApp broadcast below).
      const profiles = await fetchAllRows<{ id: string }>((from, to) =>
        supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('role', ['employee', 'manager', 'hr_admin', 'super_admin'])
          .range(from, to),
      )

      for (const p of profiles) {
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

      // WhatsApp broadcast to all active employees with phone numbers.
      // Paginated — an unbounded .select() truncates at PostgREST's
      // 1,000-row ceiling, silently excluding employees past that cutoff
      // from the broadcast.
      const empPhones = await fetchAllRows<{ id: string; first_name: string | null; phone: string | null }>((from, to) =>
        supabase
          .from('employees')
          .select('id, first_name, phone')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .not('phone', 'is', null)
          .range(from, to),
      )

      const wa = new WhatsAppProvider(supabase)
      for (const emp of empPhones) {
        if (emp.phone) {
          try {
            await wa.sendTemplate(tenantId, emp.phone, 'policy_published', {
              name:  emp.first_name ?? 'Team',
              title: policy.title,
            })
          } catch (waErr) {
            // best-effort — a single employee's notification failure must not abort the loop
            fastify.log.warn({ err: waErr, employeeId: emp.id }, 'policy: WhatsApp notification failed — continuing broadcast')
          }
        }
      }
    }

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'published' },
    })

    return reply.send({ data: { published: true, notified: policy.requires_acknowledgement } })
  })

  // ── Admin: archive policy ─────────────────────────────────────────────────

  fastify.post('/:id/archive', hrAuth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const { data, error } = await supabase
      .from('hr_policies')
      .update({ status: 'archived' })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to archive policy')
    if (!data) return notFound(reply, 'POLICY_NOT_FOUND', 'Policy not found')

    await logAction(supabase, {
      tenantId,
      tableName:   'hr_policies',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'archived' },
    })

    return reply.send({ data: { archived: true } })
  })

  // ── Employee: acknowledge policy ──────────────────────────────────────────

  fastify.post('/:id/ack', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { id }   = req.params as { id: string }

    const employeeId = await getEmployeeId(req.userId)
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

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to acknowledge policy')

    return reply.send({ data: { acknowledged: true } })
  })
}
