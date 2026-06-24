/**
 * Recruitment & ATS Routes  — /recruitment/*
 *
 * Pipeline Stages  GET/POST/PUT/DELETE /recruitment/pipeline/stages
 * Requisitions     GET/POST/PUT /recruitment/requisitions + workflow actions
 * Candidates       GET/POST/PUT /recruitment/candidates
 * Applications     GET/POST/PUT /recruitment/applications + stage moves
 * Stats            GET /recruitment/stats
 *
 * Access: hr_admin / super_admin for write; all authenticated for read.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { logAction }    from '../../lib/audit-service.js'
import { notifyHrAdmins } from '../../lib/notify.js'
import {
  sendEmail,
  applicationReceivedEmail,
  applicationShortlistedEmail,
  interviewScheduledEmail,
  panelInterviewNotificationEmail,
  offerExtendedEmail,
  applicationRejectedEmail,
} from '../../lib/email-service.js'

// Fetch candidate name/email + job title + company name for a given application
async function getAppEmailCtx(
  supabase:  any,
  tenantId:  string,
  appId:     string,
): Promise<{ candidateName: string; candidateEmail: string; jobTitle: string; companyName: string } | null> {
  try {
    const [{ data: app }, { data: tenant }] = await Promise.all([
      supabase
        .from('applications')
        .select('candidates(first_name,last_name,email), job_requisitions(title)')
        .eq('id', appId)
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .single(),
    ])
    if (!app) return null
    const cand = app.candidates
    return {
      candidateName:  `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`.trim() || 'Candidate',
      candidateEmail: cand?.email ?? '',
      jobTitle:       app.job_requisitions?.title ?? 'Position',
      companyName:    tenant?.name ?? 'Our Company',
    }
  } catch { return null }
}

// Create the pre-joinee invitation for a hired application (shared by the manual
// "initiate preboarding" action and the automatic offer-acceptance flow).
async function createPreJoineeFromApp(
  fastify: any,
  tenantId: string,
  applicationId: string,
  opts: { joining_date: string; designation?: string | null; department?: string | null; invited_by?: string | null },
): Promise<{ ok: true; invitation_id: string; already?: boolean } | { ok: false; code: number; message: string }> {
  const { data: app } = await fastify.supabase
    .from('applications')
    .select(`id, pre_joinee_invitation_id, tenant_id,
             candidates(id, first_name, last_name, email, phone),
             job_requisitions(title, departments(name))`)
    .eq('id', applicationId)
    .eq('tenant_id', tenantId)
    .single()

  if (!app) return { ok: false, code: 404, message: 'Application not found' }
  if (app.pre_joinee_invitation_id) {
    return { ok: true, invitation_id: app.pre_joinee_invitation_id, already: true }
  }

  const cand = app.candidates
  const reqn = app.job_requisitions
  const token = randomUUID()

  const { data: invitation, error } = await fastify.supabase
    .from('pre_joinee_invitations')
    .insert({
      tenant_id:             tenantId,
      first_name:            cand?.first_name ?? '',
      last_name:             cand?.last_name  ?? '',
      email:                 cand?.email      ?? '',
      phone:                 cand?.phone      ?? null,
      designation:           opts.designation ?? reqn?.title ?? null,
      department:            opts.department  ?? reqn?.departments?.name ?? null,
      joining_date:          opts.joining_date,
      source_application_id: applicationId,
      source_candidate_id:   cand?.id ?? null,
      invited_by:            opts.invited_by ?? null,
      token,
      expires_at:            new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .select('id, token')
    .single()

  if (error || !invitation) return { ok: false, code: 500, message: error?.message ?? 'Failed to create invitation' }

  await fastify.supabase
    .from('applications')
    .update({ pre_joinee_invitation_id: invitation.id, preboarding_initiated_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('tenant_id', tenantId)

  // Fire the pre-join invite email (best-effort).
  void (async () => {
    try {
      const { preJoineeInviteEmail, sendEmail, APP_PUBLIC_URL } = await import('../../lib/email-service.js')
      const { data: tenant } = await fastify.supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle()
      if (cand?.email) {
        await sendEmail({
          to: cand.email,
          ...preJoineeInviteEmail({
            candidateName: `${cand.first_name ?? ''} ${cand.last_name ?? ''}`.trim(),
            joiningDate:   opts.joining_date,
            inviteUrl:     `${APP_PUBLIC_URL}/pre-join/${invitation.token}`,
            companyName:   tenant?.name ?? 'our company',
          }),
        })
      }
    } catch { /* non-throwing */ }
  })()

  return { ok: true, invitation_id: invitation.id }
}

const HR_ADMIN_ROLES = ['super_admin', 'hr_admin'] as const

export default async function recruitmentRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!HR_ADMIN_ROLES.includes(req.userRole)) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
        }
      },
    ],
  }
  // Managers may RAISE requisitions (they land in 'draft' / pending HR approval);
  // HR admins still own the approve/hold/cancel workflow.
  const MANAGER_CREATE_ROLES = [...HR_ADMIN_ROLES, 'manager']
  const managerOrHrAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!MANAGER_CREATE_ROLES.includes(req.userRole)) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin access required' })
        }
      },
    ],
  }

  // ── Pipeline Stages ───────────────────────────────────────────────────────

  fastify.get('/pipeline/stages', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('recruitment_pipeline_stages')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('stage_order', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/pipeline/stages', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      name:        z.string().min(1),
      stage_order: z.number().int().min(1),
      stage_type:  z.enum(['applied','screening','assessment','technical','hr','final','offer','other']).default('other'),
      color:       z.string().default('#6B7280'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('recruitment_pipeline_stages')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  fastify.put('/pipeline/stages/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      name:        z.string().min(1).optional(),
      stage_order: z.number().int().min(1).optional(),
      stage_type:  z.enum(['applied','screening','assessment','technical','hr','final','offer','other']).optional(),
      color:       z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('recruitment_pipeline_stages')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Stage updated' })
  })

  fastify.delete('/pipeline/stages/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('recruitment_pipeline_stages')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('is_system', false)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.send({ message: 'Stage deleted' })
  })

  fastify.post('/pipeline/stages/seed', hrAdminAuth, async (req: any, reply) => {
    const defaults = [
      { name: 'Applied',         stage_order: 1, stage_type: 'applied',    color: '#6B7280', is_system: true },
      { name: 'Screening',       stage_order: 2, stage_type: 'screening',  color: '#3B82F6', is_system: true },
      { name: 'Technical Round', stage_order: 3, stage_type: 'technical',  color: '#8B5CF6', is_system: true },
      { name: 'HR Round',        stage_order: 4, stage_type: 'hr',         color: '#F59E0B', is_system: true },
      { name: 'Offer',           stage_order: 5, stage_type: 'offer',      color: '#10B981', is_system: true },
    ]

    const { data: existing } = await fastify.supabase
      .from('recruitment_pipeline_stages')
      .select('id')
      .eq('tenant_id', req.tenantId)

    if ((existing ?? []).length > 0) {
      return reply.code(409).send({ error: 'ALREADY_SEEDED', message: 'Pipeline stages already exist for this tenant' })
    }

    const { data, error } = await fastify.supabase
      .from('recruitment_pipeline_stages')
      .insert(defaults.map(s => ({ ...s, tenant_id: req.tenantId })))
      .select()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── Job Requisitions ──────────────────────────────────────────────────────

  fastify.get('/requisitions', auth, async (req: any, reply) => {
    const querySchema = z.object({
      status:        z.string().optional(),
      department_id: z.string().uuid().optional(),
      search:        z.string().optional(),
      limit:         z.coerce.number().int().min(1).max(200).default(50),
      offset:        z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('job_requisitions')
      .select(`
        *,
        departments(id, name),
        raised_by_profile:profiles!job_requisitions_raised_by_fkey(id, full_name),
        approved_by_profile:profiles!job_requisitions_approved_by_fkey(id, full_name)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.status)        q = q.eq('status', parsed.data.status)
    if (parsed.data.department_id) q = q.eq('department_id', parsed.data.department_id)
    if (parsed.data.search)        q = q.ilike('title', `%${parsed.data.search}%`)

    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Enrich with application counts
    const ids = (data ?? []).map((r: any) => r.id)
    let appCounts: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: counts } = await fastify.supabase
        .from('applications')
        .select('requisition_id')
        .eq('tenant_id', req.tenantId)
        .in('requisition_id', ids)
        .not('status', 'in', '("rejected","withdrawn")')

      for (const row of (counts ?? []) as any[]) {
        appCounts[row.requisition_id] = (appCounts[row.requisition_id] ?? 0) + 1
      }
    }

    const enriched = (data ?? []).map((r: any) => ({
      ...r,
      applicant_count: appCounts[r.id] ?? 0,
    }))

    return reply.send({ data: enriched, total: count ?? 0, limit: parsed.data.limit, offset: parsed.data.offset })
  })

  fastify.get('/requisitions/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('job_requisitions')
      .select(`
        *,
        departments(id, name),
        raised_by_profile:profiles!job_requisitions_raised_by_fkey(id, full_name),
        approved_by_profile:profiles!job_requisitions_approved_by_fkey(id, full_name)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Requisition not found' })

    const { count: appCount } = await fastify.supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('requisition_id', id)
      .eq('tenant_id', req.tenantId)

    return reply.send({ data: { ...(data as any), applicant_count: appCount ?? 0 } })
  })

  fastify.post('/requisitions', managerOrHrAuth, async (req: any, reply) => {
    const schema = z.object({
      title:           z.string().min(1),
      department_id:   z.string().uuid().optional().nullable(),
      location:        z.string().optional().nullable(),
      employment_type: z.enum(['full_time','part_time','contract','intern']).default('full_time'),
      openings:        z.number().int().min(1).default(1),
      jd_text:         z.string().optional().nullable(),
      required_skills: z.array(z.string()).optional().nullable(),
      min_experience:  z.number().min(0).optional().nullable(),
      max_experience:  z.number().min(0).optional().nullable(),
      salary_min:      z.number().min(0).optional().nullable(),
      salary_max:      z.number().min(0).optional().nullable(),
      target_date:     z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('job_requisitions')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        raised_by: req.userId,
        status:    'draft',
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'job_requisitions',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     parsed.data,
    })

    await notifyHrAdmins(fastify.supabase, {
      tenantId:     req.tenantId,
      senderId:     req.userId,
      item_type:    'general',
      title:        'New job requisition raised',
      summary:      `Requisition for "${parsed.data.title}" created and pending approval.`,
      severity:     'info',
      entity_type:  'job_requisition',
      entity_id:    (data as any).id,
      action_route: '/admin/recruitment/requisitions',
      action_label: 'View',
    })

    return reply.code(201).send({ data })
  })

  fastify.put('/requisitions/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      title:           z.string().min(1).optional(),
      department_id:   z.string().uuid().optional().nullable(),
      location:        z.string().optional().nullable(),
      employment_type: z.enum(['full_time','part_time','contract','intern']).optional(),
      openings:        z.number().int().min(1).optional(),
      jd_text:         z.string().optional().nullable(),
      required_skills: z.array(z.string()).optional().nullable(),
      min_experience:  z.number().min(0).optional().nullable(),
      max_experience:  z.number().min(0).optional().nullable(),
      salary_min:      z.number().min(0).optional().nullable(),
      salary_max:      z.number().min(0).optional().nullable(),
      target_date:     z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('job_requisitions')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Requisition not found' })
    if (!['draft', 'on_hold'].includes((existing as any).status)) {
      return reply.code(422).send({ error: 'INVALID_STATE', message: 'Only draft or on-hold requisitions can be edited' })
    }

    const { error } = await fastify.supabase
      .from('job_requisitions')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'job_requisitions',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data,
    })

    return reply.send({ message: 'Requisition updated' })
  })

  // Workflow transitions

  fastify.post('/requisitions/:id/approve', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: req_ } = await fastify.supabase
      .from('job_requisitions')
      .select('status, title')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!req_) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Requisition not found' })
    if ((req_ as any).status !== 'draft') return reply.code(422).send({ error: 'INVALID_STATE', message: 'Only draft requisitions can be approved' })

    const { error } = await fastify.supabase
      .from('job_requisitions')
      .update({ status: 'open', approved_by: req.userId, approved_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId, tableName: 'job_requisitions', recordId: id,
      action:      'UPDATE',     performedBy: req.userId,
      newData:     { status: 'open', approved_by: req.userId },
    })
    return reply.send({ message: 'Requisition approved and opened' })
  })

  // ── Multi-stage requisition approval ───────────────────────────────────────
  const DEFAULT_REQ_CHAIN = [
    { step_order: 1, label: 'Reporting Manager' },
    { step_order: 2, label: 'HR Head' },
    { step_order: 3, label: 'Finance Head' },
  ]

  // Submit a draft requisition into the approval chain (seeds the steps).
  fastify.post('/requisitions/:id/submit-approval', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data: r } = await fastify.supabase
      .from('job_requisitions').select('status').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Requisition not found' })
    if (r.status !== 'draft') return reply.code(422).send({ error: 'INVALID_STATE', message: 'Only draft requisitions can be submitted for approval' })

    // Reset any prior steps (e.g. resubmission after a rejection).
    await fastify.supabase.from('requisition_approvals').delete().eq('requisition_id', id).eq('tenant_id', req.tenantId)
    const rows = DEFAULT_REQ_CHAIN.map(s => ({ tenant_id: req.tenantId, requisition_id: id, step_order: s.step_order, label: s.label, status: 'pending' }))
    const { error } = await fastify.supabase.from('requisition_approvals').insert(rows)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send({ message: 'Submitted for approval', steps: rows.length })
  })

  // List a requisition's approval steps.
  fastify.get('/requisitions/:id/approvals', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('requisition_approvals').select('*').eq('requisition_id', id).eq('tenant_id', req.tenantId).order('step_order')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // Approve / reject the current (lowest-order pending) step.
  fastify.patch('/requisitions/approvals/:stepId/decide', hrAdminAuth, async (req: any, reply) => {
    const { stepId } = req.params as { stepId: string }
    const parsed = z.object({ decision: z.enum(['approved', 'rejected']), remarks: z.string().max(1000).optional().nullable() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data: step } = await fastify.supabase
      .from('requisition_approvals').select('*').eq('id', stepId).eq('tenant_id', req.tenantId).maybeSingle()
    if (!step) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Approval step not found' })
    if (step.status !== 'pending') return reply.code(409).send({ error: 'NOT_PENDING', message: 'Step already decided' })

    // Enforce sequential order: must be the lowest-order pending step.
    const { data: steps } = await fastify.supabase
      .from('requisition_approvals').select('id, step_order, status').eq('requisition_id', step.requisition_id).eq('tenant_id', req.tenantId).order('step_order')
    const firstPending = (steps ?? []).find((s: any) => s.status === 'pending')
    if (firstPending?.id !== stepId) return reply.code(409).send({ error: 'OUT_OF_ORDER', message: 'Earlier approval steps are still pending' })

    await fastify.supabase.from('requisition_approvals')
      .update({ status: parsed.data.decision, decided_by: req.userId, decided_at: new Date().toISOString(), remarks: parsed.data.remarks ?? null, updated_at: new Date().toISOString() })
      .eq('id', stepId).eq('tenant_id', req.tenantId)

    // Final approval opens the requisition; a rejection leaves it as draft.
    const remaining = (steps ?? []).filter((s: any) => s.id !== stepId && s.status === 'pending')
    if (parsed.data.decision === 'approved' && remaining.length === 0) {
      await fastify.supabase.from('job_requisitions')
        .update({ status: 'open', approved_by: req.userId, approved_at: new Date().toISOString() })
        .eq('id', step.requisition_id).eq('tenant_id', req.tenantId)
      return reply.send({ message: 'Final approval — requisition opened', opened: true })
    }
    return reply.send({ message: `Step ${parsed.data.decision}`, opened: false })
  })

  // ── Job-board postings (sourcing) ──────────────────────────────────────────
  // Manual tracking now; an automated connector can write the same rows once a
  // board's API credentials are configured in job_board_connectors.
  fastify.get('/requisitions/:id/postings', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('job_board_postings').select('*').eq('requisition_id', req.params.id).eq('tenant_id', req.tenantId).order('posted_at', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/requisitions/:id/postings', hrAdminAuth, async (req: any, reply) => {
    const parsed = z.object({
      board: z.string().min(1).max(40), external_url: z.string().max(500).optional().nullable(), external_ref: z.string().max(200).optional().nullable(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    const { data, error } = await fastify.supabase
      .from('job_board_postings')
      .insert({ tenant_id: req.tenantId, requisition_id: req.params.id, board: parsed.data.board, external_url: parsed.data.external_url ?? null, external_ref: parsed.data.external_ref ?? null, status: 'posted', posted_by: req.userId })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send({ data })
  })

  fastify.delete('/requisitions/postings/:postingId', hrAdminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('job_board_postings').delete().eq('id', req.params.postingId).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })


  fastify.post('/requisitions/:id/hold', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('job_requisitions')
      .update({ status: 'on_hold' })
      .eq('id', id).eq('tenant_id', req.tenantId)
      .in('status', ['open', 'draft'])

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'job_requisitions', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status: 'on_hold' } })
    return reply.send({ message: 'Requisition put on hold' })
  })

  fastify.post('/requisitions/:id/reopen', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('job_requisitions')
      .update({ status: 'open' })
      .eq('id', id).eq('tenant_id', req.tenantId)
      .in('status', ['on_hold', 'filled'])

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'job_requisitions', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status: 'open' } })
    return reply.send({ message: 'Requisition reopened' })
  })

  fastify.post('/requisitions/:id/cancel', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('job_requisitions')
      .update({ status: 'cancelled' })
      .eq('id', id).eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'job_requisitions', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status: 'cancelled' } })
    return reply.send({ message: 'Requisition cancelled' })
  })

  fastify.delete('/requisitions/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('job_requisitions').select('status').eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Requisition not found' })
    if ((existing as any).status !== 'draft') return reply.code(422).send({ error: 'INVALID_STATE', message: 'Only draft requisitions can be deleted' })

    const { error } = await fastify.supabase
      .from('job_requisitions').delete().eq('id', id).eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'job_requisitions', recordId: id, action: 'DELETE', performedBy: req.userId, newData: null })
    return reply.send({ message: 'Requisition deleted' })
  })

  // ── Candidates ────────────────────────────────────────────────────────────

  fastify.get('/candidates', auth, async (req: any, reply) => {
    const querySchema = z.object({
      search: z.string().optional(),
      source: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('candidates')
      .select('*', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.source) q = q.eq('source', parsed.data.source)
    if (parsed.data.search) q = q.or(`first_name.ilike.%${parsed.data.search}%,last_name.ilike.%${parsed.data.search}%,email.ilike.%${parsed.data.search}%`)

    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit: parsed.data.limit, offset: parsed.data.offset })
  })

  fastify.post('/candidates', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      first_name:        z.string().min(1),
      last_name:         z.string().min(1),
      email:             z.string().email(),
      phone:             z.string().optional().nullable(),
      resume_url:        z.string().optional().nullable(),
      linkedin_url:      z.string().optional().nullable(),
      current_company:   z.string().optional().nullable(),
      current_title:     z.string().optional().nullable(),
      total_experience:  z.number().min(0).optional().nullable(),
      source:            z.enum(['direct','referral','portal','agency','linkedin','naukri','indeed','other']).default('direct'),
      notes:             z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('candidates')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE_EMAIL', message: 'A candidate with this email already exists' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'candidates', recordId: (data as any).id, action: 'INSERT', performedBy: req.userId, newData: parsed.data })
    return reply.code(201).send({ data })
  })

  fastify.put('/candidates/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      first_name:       z.string().min(1).optional(),
      last_name:        z.string().min(1).optional(),
      phone:            z.string().optional().nullable(),
      resume_url:       z.string().optional().nullable(),
      linkedin_url:     z.string().optional().nullable(),
      current_company:  z.string().optional().nullable(),
      current_title:    z.string().optional().nullable(),
      total_experience: z.number().min(0).optional().nullable(),
      source:           z.enum(['direct','referral','portal','agency','linkedin','naukri','indeed','other']).optional(),
      notes:            z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('candidates')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'candidates', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: parsed.data })
    return reply.send({ message: 'Candidate updated' })
  })

  // ── Applications ──────────────────────────────────────────────────────────

  fastify.get('/applications', auth, async (req: any, reply) => {
    const querySchema = z.object({
      requisition_id: z.string().uuid().optional(),
      candidate_id:   z.string().uuid().optional(),
      status:         z.string().optional(),
      stage_id:       z.string().uuid().optional(),
      limit:          z.coerce.number().int().min(1).max(200).default(50),
      offset:         z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('applications')
      .select(`
        *,
        candidates(id, first_name, last_name, email, phone, resume_url, linkedin_url, notes, current_company, current_title, source, total_experience),
        job_requisitions(id, title, department_id),
        recruitment_pipeline_stages(id, name, color, stage_order)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.requisition_id) q = q.eq('requisition_id', parsed.data.requisition_id)
    if (parsed.data.candidate_id)   q = q.eq('candidate_id',   parsed.data.candidate_id)
    if (parsed.data.status)         q = q.eq('status',         parsed.data.status)
    if (parsed.data.stage_id)       q = q.eq('stage_id',       parsed.data.stage_id)

    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit: parsed.data.limit, offset: parsed.data.offset })
  })

  fastify.post('/applications', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      requisition_id: z.string().uuid(),
      candidate_id:   z.string().uuid(),
      stage_id:       z.string().uuid().optional().nullable(),
      overall_score:  z.number().int().min(1).max(10).optional().nullable(),
      assigned_to:    z.string().uuid().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('applications')
      .insert({ ...parsed.data, tenant_id: req.tenantId, status: 'applied' })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE_APPLICATION', message: 'This candidate has already applied to this requisition' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'applications', recordId: (data as any).id, action: 'INSERT', performedBy: req.userId, newData: parsed.data })

    // Fire application-received email to candidate (non-blocking)
    const appId = (data as any).id
    void (async () => {
      const ctx = await getAppEmailCtx(fastify.supabase, req.tenantId, appId)
      if (ctx?.candidateEmail) {
        const { APP_PUBLIC_URL } = await import('../../lib/email-service.js')
        const portalUrl = `${APP_PUBLIC_URL}/portal/candidate/${appId}`
        await sendEmail({ to: ctx.candidateEmail, ...applicationReceivedEmail({ ...ctx, portalUrl }) })
      }
    })()

    return reply.code(201).send({ data })
  })

  fastify.post('/applications/:id/move', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      stage_id: z.string().uuid(),
      status:   z.enum(['applied','screening','interviewing','offer','hired','rejected','withdrawn']).optional(),
      note:     z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('applications')
      .select('stage_id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Application not found' })

    const updatePayload: any = { stage_id: parsed.data.stage_id }
    if (parsed.data.status) updatePayload.status = parsed.data.status

    const { error } = await fastify.supabase
      .from('applications')
      .update(updatePayload)
      .eq('id', id).eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    // Log the move in activity trail
    await fastify.supabase
      .from('application_activity_log')
      .insert({
        tenant_id:      req.tenantId,
        application_id: id,
        from_stage_id:  (existing as any).stage_id,
        to_stage_id:    parsed.data.stage_id,
        from_status:    (existing as any).status,
        to_status:      parsed.data.status ?? (existing as any).status,
        actor_id:       req.userId,
        note:           parsed.data.note ?? null,
      })

    // Stage-change emails: shortlisted (screening) or offer extended (offer)
    void (async () => {
      try {
        const { data: stage } = await fastify.supabase
          .from('recruitment_pipeline_stages')
          .select('stage_type')
          .eq('id', parsed.data.stage_id)
          .single()
        const stageType = (stage as any)?.stage_type
        if (stageType !== 'screening' && stageType !== 'offer') return
        const ctx = await getAppEmailCtx(fastify.supabase, req.tenantId, id)
        if (!ctx?.candidateEmail) return
        const emailPayload = stageType === 'offer'
          ? offerExtendedEmail(ctx)
          : applicationShortlistedEmail(ctx)
        await sendEmail({ to: ctx.candidateEmail, ...emailPayload })
      } catch { /* non-throwing */ }
    })()

    return reply.send({ message: 'Application moved' })
  })

  fastify.post('/applications/:id/reject', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ rejection_reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('applications')
      .update({ status: 'rejected', rejection_reason: parsed.data.rejection_reason })
      .eq('id', id).eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'applications', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status: 'rejected', rejection_reason: parsed.data.rejection_reason } })

    // Rejection email to candidate (non-blocking)
    void (async () => {
      const ctx = await getAppEmailCtx(fastify.supabase, req.tenantId, id)
      if (ctx?.candidateEmail) await sendEmail({ to: ctx.candidateEmail, ...applicationRejectedEmail(ctx) })
    })()

    return reply.send({ message: 'Application rejected' })
  })

  // ── Hired Pipeline — initiate preboarding ────────────────────────────────

  fastify.get('/hired', hrAdminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      preboarding_status: z.enum(['pending','initiated','all']).default('all'),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('applications')
      .select(`
        id, status, offer_amount, expected_joining,
        preboarding_initiated_at, pre_joinee_invitation_id,
        created_at, updated_at,
        candidates(id, first_name, last_name, email, phone, current_title),
        job_requisitions(id, title, departments(name)),
        pre_joinee:pre_joinee_invitations!applications_pre_joinee_invitation_id_fkey(
          id, status, joining_date, submitted_at
        )
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('status', 'hired')
      .order('updated_at', { ascending: false })

    if (parsed.data.preboarding_status === 'pending') {
      q = q.is('pre_joinee_invitation_id', null)
    } else if (parsed.data.preboarding_status === 'initiated') {
      q = q.not('pre_joinee_invitation_id', 'is', null)
    }

    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Attach BGV status per application (for the pipeline badge / gate).
    const rows = data ?? []
    const appIds = rows.map((r: any) => r.id)
    const bgvByApp: Record<string, string> = {}
    if (appIds.length) {
      const { data: cases } = await fastify.supabase
        .from('bgv_cases').select('application_id, status').eq('tenant_id', req.tenantId).in('application_id', appIds)
      for (const c of cases ?? []) bgvByApp[(c as any).application_id] = (c as any).status
    }
    const enriched = rows.map((r: any) => ({ ...r, bgv_status: bgvByApp[r.id] ?? null }))

    return reply.send({ data: enriched, total: count ?? 0, limit: parsed.data.limit, offset: parsed.data.offset })
  })

  fastify.post('/applications/:id/initiate-preboarding', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      joining_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'joining_date must be YYYY-MM-DD'),
      designation:    z.string().optional().nullable(),
      department:     z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Fetch application + candidate data
    const { data: app } = await fastify.supabase
      .from('applications')
      .select(`
        id, status, offer_amount, expected_joining,
        pre_joinee_invitation_id, tenant_id,
        candidates(id, first_name, last_name, email, phone),
        job_requisitions(title, departments(name))
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!app) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Application not found' })
    if ((app as any).status !== 'hired') {
      return reply.code(422).send({ error: 'INVALID_STATE', message: 'Only hired applications can be moved to preboarding' })
    }
    if ((app as any).pre_joinee_invitation_id) {
      return reply.code(409).send({ error: 'ALREADY_INITIATED', message: 'Preboarding has already been initiated for this application' })
    }

    const result = await createPreJoineeFromApp(fastify, req.tenantId, id, {
      joining_date: parsed.data.joining_date,
      designation:  parsed.data.designation,
      department:   parsed.data.department,
      invited_by:   req.userId,
    })
    if (!result.ok) return reply.code(result.code).send({ error: 'INSERT_FAILED', message: result.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'applications',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { pre_joinee_invitation_id: result.invitation_id, preboarding_initiated_at: new Date().toISOString() },
    })

    return reply.code(201).send({
      data: { id: result.invitation_id },
      message: 'Preboarding initiated. Invitation email sent to candidate.',
    })
  })

  // ── Stats ─────────────────────────────────────────────────────────────────

  fastify.get('/stats', auth, async (req: any, reply) => {
    const [{ data: reqRows }, { data: appRows }] = await Promise.all([
      fastify.supabase
        .from('job_requisitions')
        .select('status')
        .eq('tenant_id', req.tenantId),
      fastify.supabase
        .from('applications')
        .select('status')
        .eq('tenant_id', req.tenantId),
    ])

    const reqStats = { draft: 0, open: 0, on_hold: 0, filled: 0, cancelled: 0, total: 0 }
    for (const r of (reqRows ?? []) as any[]) {
      reqStats[r.status as keyof typeof reqStats] = (reqStats[r.status as keyof typeof reqStats] ?? 0) + 1
      reqStats.total++
    }

    const appStats = { applied: 0, screening: 0, interviewing: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0, total: 0 }
    for (const a of (appRows ?? []) as any[]) {
      appStats[a.status as keyof typeof appStats] = (appStats[a.status as keyof typeof appStats] ?? 0) + 1
      appStats.total++
    }

    return reply.send({ requisitions: reqStats, applications: appStats })
  })

  // ── Analytics ─────────────────────────────────────────────────────────────

  fastify.get('/analytics', auth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const [
      { data: appRows },
      { data: reqRows },
      { data: interviewRows },
      { data: scoreRows },
      { data: sourceRows },
    ] = await Promise.all([
      fastify.supabase
        .from('applications')
        .select('status, created_at, updated_at')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('job_requisitions')
        .select('status')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('interview_rounds')
        .select('status')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('interview_scores')
        .select('recommendation')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('applications')
        .select('candidates(source)')
        .eq('tenant_id', tenantId),
    ])

    // Funnel + TAT
    const funnel = { applied: 0, screening: 0, interviewing: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 }
    const hireTimes: number[] = []
    const offerTimes: number[] = []
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    let recent30d = 0

    for (const a of (appRows ?? []) as any[]) {
      funnel[a.status as keyof typeof funnel] = (funnel[a.status as keyof typeof funnel] ?? 0) + 1
      const days = (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / 86400000
      if (a.status === 'hired') hireTimes.push(days)
      if (a.status === 'offer' || a.status === 'hired') offerTimes.push(days)
      if (a.created_at >= thirtyDaysAgo) recent30d++
    }

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null

    // Requisition breakdown
    const reqStats = { draft: 0, open: 0, on_hold: 0, filled: 0, cancelled: 0 }
    for (const r of (reqRows ?? []) as any[]) {
      reqStats[r.status as keyof typeof reqStats] = (reqStats[r.status as keyof typeof reqStats] ?? 0) + 1
    }

    // Interview stats
    const interviewStats = { scheduled: 0, completed: 0, cancelled: 0, no_show: 0 }
    for (const i of (interviewRows ?? []) as any[]) {
      interviewStats[i.status as keyof typeof interviewStats] = (interviewStats[i.status as keyof typeof interviewStats] ?? 0) + 1
    }

    // Interview pass rate from scorecards
    let positiveVotes = 0, totalVotes = 0
    for (const s of (scoreRows ?? []) as any[]) {
      if (!s.recommendation) continue
      totalVotes++
      if (s.recommendation === 'strong_yes' || s.recommendation === 'yes') positiveVotes++
    }
    const passRate = totalVotes > 0 ? Math.round((positiveVotes / totalVotes) * 100) : null

    // Source breakdown
    const sourceMap: Record<string, number> = {}
    for (const a of (sourceRows ?? []) as any[]) {
      const src = a.candidates?.source ?? 'direct'
      sourceMap[src] = (sourceMap[src] ?? 0) + 1
    }
    const sourceBreakdown = Object.entries(sourceMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)

    return reply.send({
      funnel,
      avg_time_to_hire:  avg(hireTimes),
      avg_time_to_offer: avg(offerTimes),
      requisitions:      reqStats,
      interviews:        interviewStats,
      pass_rate:         passRate,
      source_breakdown:  sourceBreakdown,
      recent_30d_applications: recent30d,
      total_applications:      (appRows ?? []).length,
      total_requisitions:      (reqRows ?? []).length,
    })
  })

  // ── GET /recruitment/analytics/interviewers ──────────────────────────────────
  // INT-06 depth: interviewer/panel calibration + per-criterion effectiveness.
  // Built entirely from existing interview_scores correlated with the final
  // application outcome (hired/rejected). No per-question data required.
  fastify.get('/analytics/interviewers', auth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const [{ data: scoreRows }, { data: roundRows }, { data: appRows }] = await Promise.all([
      fastify.supabase
        .from('interview_scores')
        .select('round_id, interviewer_id, technical_score, communication_score, culture_score, overall_score, recommendation, profiles:interviewer_id(full_name)')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('interview_rounds')
        .select('id, application_id')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('applications')
        .select('id, status')
        .eq('tenant_id', tenantId),
    ])

    const roundToApp = new Map<string, string>(((roundRows ?? []) as any[]).map(r => [r.id, r.application_id]))
    const appStatus  = new Map<string, string>(((appRows ?? []) as any[]).map(a => [a.id, a.status]))
    const scores = (scoreRows ?? []) as any[]

    const outcomeOf = (roundId: string): string | null => {
      const appId = roundToApp.get(roundId)
      return appId ? (appStatus.get(appId) ?? null) : null
    }
    const POSITIVE = new Set(['strong_yes', 'yes'])
    const NEGATIVE = new Set(['no', 'strong_no'])
    const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null
    const stddev = (a: number[]) => {
      if (a.length < 2) return null
      const m = a.reduce((s, v) => s + v, 0) / a.length
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
    }
    const r1 = (n: number | null) => (n === null ? null : +n.toFixed(1))
    const r2 = (n: number | null) => (n === null ? null : +n.toFixed(2))

    const cohortAvg = mean(scores.map(s => s.overall_score).filter((v): v is number => v != null))

    // ── Per-interviewer calibration ─────────────────────────────────────────
    type Acc = {
      name: string; overall: number[]; recs: Record<string, number>
      posTerminal: number; posHired: number; negTerminal: number; negRejected: number
    }
    const byInterviewer = new Map<string, Acc>()
    for (const s of scores) {
      const id = s.interviewer_id
      if (!byInterviewer.has(id)) {
        byInterviewer.set(id, {
          name: (Array.isArray(s.profiles) ? s.profiles[0]?.full_name : s.profiles?.full_name) ?? 'Interviewer',
          overall: [], recs: {}, posTerminal: 0, posHired: 0, negTerminal: 0, negRejected: 0,
        })
      }
      const acc = byInterviewer.get(id)!
      if (s.overall_score != null) acc.overall.push(s.overall_score)
      if (s.recommendation) acc.recs[s.recommendation] = (acc.recs[s.recommendation] ?? 0) + 1

      const outcome = outcomeOf(s.round_id)
      if (s.recommendation && POSITIVE.has(s.recommendation) && (outcome === 'hired' || outcome === 'rejected')) {
        acc.posTerminal++; if (outcome === 'hired') acc.posHired++
      }
      if (s.recommendation && NEGATIVE.has(s.recommendation) && (outcome === 'hired' || outcome === 'rejected')) {
        acc.negTerminal++; if (outcome === 'rejected') acc.negRejected++
      }
    }

    const interviewers = [...byInterviewer.entries()].map(([id, a]) => {
      const avgOverall = mean(a.overall)
      const totalRecs = Object.values(a.recs).reduce((s, v) => s + v, 0)
      const positive = (a.recs.strong_yes ?? 0) + (a.recs.yes ?? 0)
      return {
        interviewer_id: id,
        name:           a.name,
        scored_count:   a.overall.length,
        avg_overall:    r2(avgOverall),
        // leniency: how far above (+) / below (-) the cohort this interviewer scores
        leniency:       avgOverall != null && cohortAvg != null ? r2(avgOverall - cohortAvg) : null,
        // consistency: stddev of their overall scores (lower = more consistent)
        consistency:    r2(stddev(a.overall)),
        positive_rate:  totalRecs > 0 ? Math.round((positive / totalRecs) * 100) : null,
        recommendations: a.recs,
        // predictive accuracy vs. final outcome (only where outcome is terminal)
        hire_accuracy:   a.posTerminal > 0 ? Math.round((a.posHired / a.posTerminal) * 100) : null,
        reject_accuracy: a.negTerminal > 0 ? Math.round((a.negRejected / a.negTerminal) * 100) : null,
        decisions_with_outcome: a.posTerminal + a.negTerminal,
      }
    }).sort((x, y) => (y.scored_count - x.scored_count))

    // ── Per-criterion effectiveness (hired vs rejected separation) ───────────
    const CRITERIA = ['technical_score', 'communication_score', 'culture_score', 'overall_score'] as const
    const criteria = CRITERIA.map(key => {
      const hired: number[] = []
      const rejected: number[] = []
      for (const s of scores) {
        const v = s[key]
        if (v == null) continue
        const outcome = outcomeOf(s.round_id)
        if (outcome === 'hired') hired.push(v)
        else if (outcome === 'rejected') rejected.push(v)
      }
      const avgHired = mean(hired)
      const avgRejected = mean(rejected)
      return {
        criterion:     key.replace('_score', ''),
        avg_hired:     r1(avgHired),
        avg_rejected:  r1(avgRejected),
        // lift: how strongly this criterion separates hires from rejects (higher = more predictive)
        lift:          avgHired != null && avgRejected != null ? r1(avgHired - avgRejected) : null,
        sample_hired:   hired.length,
        sample_rejected: rejected.length,
      }
    })

    // ── Inter-rater agreement (rounds with ≥2 scorers) ──────────────────────
    const roundScores = new Map<string, { overall: number[]; recs: string[] }>()
    for (const s of scores) {
      if (!roundScores.has(s.round_id)) roundScores.set(s.round_id, { overall: [], recs: [] })
      const rs = roundScores.get(s.round_id)!
      if (s.overall_score != null) rs.overall.push(s.overall_score)
      if (s.recommendation) rs.recs.push(s.recommendation)
    }
    const spreads: number[] = []
    let multiRounds = 0, unanimousDir = 0
    for (const rs of roundScores.values()) {
      if (rs.overall.length >= 2) {
        spreads.push(Math.max(...rs.overall) - Math.min(...rs.overall))
      }
      if (rs.recs.length >= 2) {
        multiRounds++
        const dirs = new Set(rs.recs.map(r => POSITIVE.has(r) ? 'pos' : NEGATIVE.has(r) ? 'neg' : 'mid'))
        if (dirs.size === 1) unanimousDir++
      }
    }
    const agreement = {
      multi_scorer_rounds:   multiRounds,
      avg_score_spread:      r2(mean(spreads)),
      unanimous_rate:        multiRounds > 0 ? Math.round((unanimousDir / multiRounds) * 100) : null,
    }

    return reply.send({
      data: {
        cohort_avg_overall: r2(cohortAvg),
        total_scores:       scores.length,
        interviewers,
        criteria,
        agreement,
      },
    })
  })

  // ── Interviewers (profiles list for panel assignment) ─────────────────────

  fastify.get('/interviewers', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('profiles')
      .select('id, full_name, role, employees(id, employee_code, designations(title))')
      .eq('tenant_id', req.tenantId)
      .order('full_name', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── Interview Rounds ──────────────────────────────────────────────────────

  fastify.get('/interviews', auth, async (req: any, reply) => {
    const querySchema = z.object({
      application_id:  z.string().uuid().optional(),
      candidate_id:    z.string().uuid().optional(),
      requisition_id:  z.string().uuid().optional(),
      status:          z.string().optional(),
      from:            z.string().optional(),
      to:              z.string().optional(),
      limit:           z.coerce.number().int().min(1).max(200).default(50),
      offset:          z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('interview_rounds')
      .select(`
        *,
        applications(
          id, status,
          candidates(id, first_name, last_name, email, current_company, current_title),
          job_requisitions(id, title)
        ),
        interview_panel(interviewer_id, profiles:profiles(id, full_name))
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('scheduled_at', { ascending: true })

    if (parsed.data.status)         q = q.eq('status',         parsed.data.status)
    if (parsed.data.application_id) q = q.eq('application_id', parsed.data.application_id)
    if (parsed.data.from)           q = q.gte('scheduled_at',  parsed.data.from)
    if (parsed.data.to)             q = q.lte('scheduled_at',  parsed.data.to)

    // Candidate-level filter — need app IDs first
    if (parsed.data.candidate_id) {
      const { data: apps } = await fastify.supabase
        .from('applications')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .eq('candidate_id', parsed.data.candidate_id)
      const appIds = (apps ?? []).map((a: any) => a.id)
      if (appIds.length === 0) return reply.send({ data: [], total: 0 })
      q = q.in('id', appIds)
    }

    if (parsed.data.requisition_id) {
      const { data: apps } = await fastify.supabase
        .from('applications')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .eq('requisition_id', parsed.data.requisition_id)
      const appIds = (apps ?? []).map((a: any) => a.id)
      if (appIds.length === 0) return reply.send({ data: [], total: 0 })
      q = q.in('id', appIds)
    }

    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0, limit: parsed.data.limit, offset: parsed.data.offset })
  })

  fastify.get('/interviews/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('interview_rounds')
      .select(`
        *,
        applications(
          id, status, candidate_id,
          candidates(id, first_name, last_name, email, phone, current_company, current_title),
          job_requisitions(id, title)
        ),
        interview_panel(interviewer_id, profiles:profiles(id, full_name)),
        interview_scores(*)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Interview not found' })
    return reply.send({ data })
  })

  fastify.post('/interviews', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      application_id:  z.string().uuid(),
      stage_id:        z.string().uuid().optional().nullable(),
      round_number:    z.number().int().min(1).default(1),
      title:           z.string().optional().nullable(),
      interview_type:  z.enum(['video','phone','in_person','assignment']).default('video'),
      scheduled_at:    z.string().optional().nullable(),
      duration_mins:   z.number().int().min(15).max(480).default(60),
      meet_link:       z.string().optional().nullable(),
      notes:           z.string().optional().nullable(),
      interviewer_ids: z.array(z.string().uuid()).optional().default([]),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { interviewer_ids, ...roundData } = parsed.data

    const { data: round, error: roundErr } = await fastify.supabase
      .from('interview_rounds')
      .insert({
        ...roundData,
        tenant_id:  req.tenantId,
        status:     'scheduled',
        created_by: req.userId,
      })
      .select()
      .single()

    if (roundErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: roundErr.message })

    // Assign panel members
    if (interviewer_ids.length > 0) {
      await fastify.supabase
        .from('interview_panel')
        .insert(interviewer_ids.map(iid => ({
          tenant_id:      req.tenantId,
          round_id:       (round as any).id,
          interviewer_id: iid,
        })))
    }

    // Move application to interviewing status if still at applied/screening
    await fastify.supabase
      .from('applications')
      .update({ status: 'interviewing' })
      .eq('id', parsed.data.application_id)
      .eq('tenant_id', req.tenantId)
      .in('status', ['applied', 'screening'])

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'interview_rounds',
      recordId:    (round as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     roundData,
    })

    // Interview scheduled emails — candidate + all panel members (non-blocking)
    const roundId = (round as any).id
    void (async () => {
      try {
        const ctx = await getAppEmailCtx(fastify.supabase, req.tenantId, parsed.data.application_id)
        if (!ctx) return

        const emailOpts = {
          candidateName: ctx.candidateName,
          jobTitle:      ctx.jobTitle,
          companyName:   ctx.companyName,
          roundNumber:   parsed.data.round_number,
          roundTitle:    parsed.data.title ?? null,
          interviewType: parsed.data.interview_type,
          scheduledAt:   parsed.data.scheduled_at ?? null,
          durationMins:  parsed.data.duration_mins,
          meetLink:      parsed.data.meet_link ?? null,
        }

        // Email candidate
        if (ctx.candidateEmail) {
          await sendEmail({ to: ctx.candidateEmail, ...interviewScheduledEmail(emailOpts) })
        }

        // Email each panel member
        if (interviewer_ids.length > 0) {
          const { data: panelProfiles } = await fastify.supabase
            .from('profiles')
            .select('full_name, email')
            .in('id', interviewer_ids)
          for (const p of (panelProfiles ?? []) as any[]) {
            if (!p.email) continue
            await sendEmail({
              to: p.email,
              ...panelInterviewNotificationEmail({ ...emailOpts, panelName: p.full_name ?? 'Interviewer' }),
            })
          }
        }
      } catch { /* non-throwing */ }
    })()

    return reply.code(201).send({ data: round })
  })

  fastify.put('/interviews/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      title:           z.string().optional().nullable(),
      interview_type:  z.enum(['video','phone','in_person','assignment']).optional(),
      scheduled_at:    z.string().optional().nullable(),
      duration_mins:   z.number().int().min(15).max(480).optional(),
      meet_link:       z.string().optional().nullable(),
      notes:           z.string().optional().nullable(),
      interviewer_ids: z.array(z.string().uuid()).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { interviewer_ids, ...roundData } = parsed.data

    if (Object.keys(roundData).length > 0) {
      const { error } = await fastify.supabase
        .from('interview_rounds')
        .update(roundData)
        .eq('id', id)
        .eq('tenant_id', req.tenantId)

      if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    }

    // Replace panel if provided
    if (interviewer_ids !== undefined) {
      await fastify.supabase
        .from('interview_panel')
        .delete()
        .eq('round_id', id)
        .eq('tenant_id', req.tenantId)

      if (interviewer_ids.length > 0) {
        await fastify.supabase
          .from('interview_panel')
          .insert(interviewer_ids.map(iid => ({
            tenant_id:      req.tenantId,
            round_id:       id,
            interviewer_id: iid,
          })))
      }
    }

    return reply.send({ message: 'Interview updated' })
  })

  fastify.delete('/interviews/:id', hrAdminAuth, async (req: any, reply) => {
    const { data: existing } = await fastify.supabase
      .from('interview_rounds')
      .select('status')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Interview not found' })
    if ((existing as any).status !== 'scheduled') {
      return reply.code(422).send({ error: 'INVALID_STATE', message: 'Only scheduled interviews can be deleted' })
    }

    const { error } = await fastify.supabase
      .from('interview_rounds')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.send({ message: 'Interview deleted' })
  })

  // Status transitions

  async function transitionInterview(req: any, reply: any, status: string, requireScheduled = false) {
    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('interview_rounds')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Interview not found' })
    if (requireScheduled && (existing as any).status !== 'scheduled') {
      return reply.code(422).send({ error: 'INVALID_STATE', message: 'Interview is not in scheduled status' })
    }

    const { error } = await fastify.supabase
      .from('interview_rounds')
      .update({ status })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'interview_rounds', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status } })
    return reply.send({ message: `Interview marked as ${status}` })
  }

  fastify.post('/interviews/:id/complete', hrAdminAuth, async (req: any, reply) =>
    transitionInterview(req, reply, 'completed', true))

  fastify.post('/interviews/:id/cancel', hrAdminAuth, async (req: any, reply) =>
    transitionInterview(req, reply, 'cancelled', true))

  fastify.post('/interviews/:id/no-show', hrAdminAuth, async (req: any, reply) =>
    transitionInterview(req, reply, 'no_show', true))

  // ── Application Timeline ──────────────────────────────────────────────────

  fastify.get('/applications/:id/timeline', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const [{ data: rounds }, { data: activity }] = await Promise.all([
      fastify.supabase
        .from('interview_rounds')
        .select(`
          *,
          interview_panel(interviewer_id, profiles:profiles(id, full_name)),
          interview_scores(interviewer_id, overall_score, recommendation, submitted_at)
        `)
        .eq('application_id', id)
        .eq('tenant_id', req.tenantId)
        .order('round_number', { ascending: true }),
      fastify.supabase
        .from('application_activity_log')
        .select(`
          *,
          from_stage:recruitment_pipeline_stages!application_activity_log_from_stage_id_fkey(id, name, color),
          to_stage:recruitment_pipeline_stages!application_activity_log_to_stage_id_fkey(id, name, color),
          actor:profiles(id, full_name)
        `)
        .eq('application_id', id)
        .eq('tenant_id', req.tenantId)
        .order('created_at', { ascending: true }),
    ])

    return reply.send({ rounds: rounds ?? [], activity: activity ?? [] })
  })

  // ── Question Bank — Categories ────────────────────────────────────────────

  fastify.get('/question-bank/categories', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('qb_categories')
      .select('*, departments(id, name)')
      .eq('tenant_id', req.tenantId)
      .order('name', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/question-bank/categories', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      name:          z.string().min(1),
      department_id: z.string().uuid().optional().nullable(),
      category_type: z.enum(['technical','behavioural','domain','situational','general']).default('technical'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('qb_categories')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select('*, departments(id, name)')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A category with this name already exists' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  fastify.put('/question-bank/categories/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      name:          z.string().min(1).optional(),
      department_id: z.string().uuid().optional().nullable(),
      category_type: z.enum(['technical','behavioural','domain','situational','general']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('qb_categories')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Category updated' })
  })

  fastify.delete('/question-bank/categories/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('qb_categories')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.send({ message: 'Category deleted' })
  })

  // ── Question Bank — Items ─────────────────────────────────────────────────

  fastify.get('/question-bank/items', auth, async (req: any, reply) => {
    const querySchema = z.object({
      category_id: z.string().uuid().optional(),
      difficulty:  z.string().optional(),
      search:      z.string().optional(),
      is_active:   z.coerce.boolean().optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(100),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('qb_items')
      .select('*, qb_categories(id, name, category_type)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.category_id) q = q.eq('category_id', parsed.data.category_id)
    if (parsed.data.difficulty)  q = q.eq('difficulty',  parsed.data.difficulty)
    if (parsed.data.is_active !== undefined) q = q.eq('is_active', parsed.data.is_active)
    if (parsed.data.search) q = q.ilike('question', `%${parsed.data.search}%`)

    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  fastify.post('/question-bank/items', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      category_id:  z.string().uuid(),
      question:     z.string().min(1),
      model_answer: z.string().optional().nullable(),
      difficulty:   z.enum(['easy','medium','hard']).default('medium'),
      tags:         z.array(z.string()).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('qb_items')
      .insert({ ...parsed.data, tenant_id: req.tenantId, created_by: req.userId, is_active: true })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  fastify.put('/question-bank/items/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      question:     z.string().min(1).optional(),
      model_answer: z.string().optional().nullable(),
      difficulty:   z.enum(['easy','medium','hard']).optional(),
      tags:         z.array(z.string()).optional().nullable(),
      is_active:    z.boolean().optional(),
      category_id:  z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('qb_items')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Question updated' })
  })

  fastify.delete('/question-bank/items/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('qb_items')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.send({ message: 'Question deleted' })
  })

  // ── Scorecards ────────────────────────────────────────────────────────────

  fastify.get('/interviews/:id/scorecard', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: scores, error } = await fastify.supabase
      .from('interview_scores')
      .select('*, profiles:interviewer_id(id, full_name)')
      .eq('round_id', id)
      .eq('tenant_id', req.tenantId)
      .order('submitted_at', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Compute aggregate
    const rows = (scores ?? []) as any[]
    const agg = rows.length === 0 ? null : {
      technical_score:     +(rows.reduce((s, r) => s + (r.technical_score ?? 0), 0) / rows.filter(r => r.technical_score).length || 0).toFixed(1),
      communication_score: +(rows.reduce((s, r) => s + (r.communication_score ?? 0), 0) / rows.filter(r => r.communication_score).length || 0).toFixed(1),
      culture_score:       +(rows.reduce((s, r) => s + (r.culture_score ?? 0), 0) / rows.filter(r => r.culture_score).length || 0).toFixed(1),
      overall_score:       +(rows.reduce((s, r) => s + (r.overall_score ?? 0), 0) / rows.filter(r => r.overall_score).length || 0).toFixed(1),
      count: rows.length,
    }

    return reply.send({ data: scores ?? [], aggregate: agg })
  })

  fastify.post('/interviews/:id/scorecard', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      technical_score:     z.number().int().min(1).max(5).optional().nullable(),
      communication_score: z.number().int().min(1).max(5).optional().nullable(),
      culture_score:       z.number().int().min(1).max(5).optional().nullable(),
      overall_score:       z.number().int().min(1).max(5).optional().nullable(),
      recommendation:      z.enum(['strong_yes','yes','maybe','no','strong_no']).optional().nullable(),
      notes:               z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('interview_scores')
      .upsert({
        ...parsed.data,
        tenant_id:      req.tenantId,
        round_id:       id,
        interviewer_id: req.userId,
        submitted_at:   new Date().toISOString(),
      }, { onConflict: 'round_id,interviewer_id' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── Offer Letter Data ─────────────────────────────────────────────────────
  // Returns structured data for the frontend to render + print the offer letter.

  fastify.get('/offers/:appId', auth, async (req: any, reply) => {
    const { appId } = req.params as { appId: string }

    const { data: app } = await fastify.supabase
      .from('applications')
      .select(`
        id, status, created_at,
        candidates(first_name, last_name, email),
        job_requisitions(title, departments(name))
      `)
      .eq('id', appId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!app) return reply.code(404).send({ error: 'NOT_FOUND' })

    const { data: tenant } = await fastify.supabase
      .from('tenants').select('name').eq('id', req.tenantId).single()

    const cand = (app as any).candidates
    const reqn = (app as any).job_requisitions

    // Latest persisted offer (status/amount/dates) so the dialog reflects state.
    const { data: offer } = await fastify.supabase
      .from('recruitment_offer_letters')
      .select('id, status, offered_amount, joining_date, valid_until, accepted_at, declined_at')
      .eq('application_id', appId).eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    return reply.send({
      data: {
        id:              appId,
        status:          (app as any).status,
        candidate_name:  `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`.trim(),
        first_name:      cand?.first_name ?? '',
        candidate_email: cand?.email ?? '',
        job_title:       reqn?.title ?? '',
        department:      reqn?.departments?.name ?? '',
        company_name:    (tenant as any)?.name ?? '',
        applied_at:      (app as any).created_at,
        offer:           offer ?? null,
      },
    })
  })

  // Send the generated offer letter HTML to the candidate via email
  fastify.post('/offers/:appId/send', hrAdminAuth, async (req: any, reply) => {
    const { appId } = req.params as { appId: string }
    const { letter_html, recipient_email, job_title, company_name, offered_amount, joining_date, valid_until } = req.body as any

    if (!recipient_email || !letter_html) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'recipient_email and letter_html are required' })
    }

    // Verify app belongs to tenant (need candidate/requisition ids to persist the offer)
    const { data: app } = await fastify.supabase
      .from('applications').select('id, candidate_id, requisition_id').eq('id', appId).eq('tenant_id', req.tenantId).maybeSingle()
    if (!app) return reply.code(404).send({ error: 'NOT_FOUND' })

    const result = await sendEmail({
      to:      recipient_email,
      subject: `Offer Letter — ${job_title} at ${company_name}`,
      html:    letter_html,
    })

    if (!result.sent && !result.skipped) {
      return reply.code(500).send({ error: 'EMAIL_FAILED', message: result.error })
    }

    // Persist the offer + move the application to 'offer' when we have the
    // structured fields the candidate needs to accept (amount + joining date).
    const amount = offered_amount != null && offered_amount !== '' ? Number(offered_amount) : null
    const jdate  = typeof joining_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(joining_date) ? joining_date : null
    if (amount != null && Number.isFinite(amount) && jdate) {
      const { data: existing } = await fastify.supabase
        .from('recruitment_offer_letters')
        .select('id').eq('application_id', appId).eq('tenant_id', req.tenantId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      const row = {
        tenant_id: req.tenantId, application_id: appId,
        candidate_id: (app as any).candidate_id, requisition_id: (app as any).requisition_id,
        offered_amount: amount, joining_date: jdate, valid_until: valid_until || null,
        status: 'sent', html_content: letter_html, updated_at: new Date().toISOString(),
      }
      if (existing) await fastify.supabase.from('recruitment_offer_letters').update(row).eq('id', existing.id)
      else          await fastify.supabase.from('recruitment_offer_letters').insert(row)

      await fastify.supabase
        .from('applications')
        .update({ status: 'offer', offer_amount: amount, expected_joining: jdate, offer_date: new Date().toISOString().slice(0, 10) })
        .eq('id', appId).eq('tenant_id', req.tenantId)
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'applications',
      recordId:    appId,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { offer_letter_sent_to: recipient_email, offer_amount: amount, joining_date: jdate },
    })

    return reply.send({ sent: true })
  })

  // ── Background Verification (BGV) ──────────────────────────────────────────
  const BGV_CHECK_TYPES = ['identity', 'education', 'employment', 'criminal', 'address', 'reference'] as const

  // Get the BGV case + checks for an application (null if not initiated).
  fastify.get('/applications/:id/bgv', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data: bgvCase } = await fastify.supabase
      .from('bgv_cases').select('*').eq('application_id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!bgvCase) return reply.send({ data: null })
    const { data: checks } = await fastify.supabase
      .from('bgv_checks').select('*').eq('case_id', bgvCase.id).eq('tenant_id', req.tenantId).order('created_at')
    return reply.send({ data: { ...bgvCase, checks: checks ?? [] } })
  })

  // Initiate a BGV case (seeds the standard checks).
  fastify.post('/applications/:id/bgv/initiate', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      vendor:      z.string().optional().nullable(),
      check_types: z.array(z.enum(BGV_CHECK_TYPES)).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data: app } = await fastify.supabase
      .from('applications').select('id, candidate_id').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!app) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Application not found' })

    const { data: existing } = await fastify.supabase
      .from('bgv_cases').select('id').eq('application_id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (existing) return reply.code(409).send({ error: 'ALREADY_INITIATED', message: 'BGV has already been initiated for this application' })

    const { data: bgvCase, error: caseErr } = await fastify.supabase
      .from('bgv_cases')
      .insert({
        tenant_id: req.tenantId, application_id: id, candidate_id: (app as any).candidate_id,
        status: 'in_progress', vendor: parsed.data.vendor ?? null, initiated_by: req.userId,
      })
      .select().single()
    if (caseErr || !bgvCase) return reply.code(500).send({ error: 'DB_ERROR', message: caseErr?.message ?? 'Failed to open BGV case' })

    const types = parsed.data.check_types?.length ? parsed.data.check_types : BGV_CHECK_TYPES
    const rows = types.map(t => ({ tenant_id: req.tenantId, case_id: bgvCase.id, check_type: t, status: 'pending' }))
    await fastify.supabase.from('bgv_checks').insert(rows)

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'bgv_cases', recordId: bgvCase.id,
      action: 'INSERT', performedBy: req.userId, newData: { application_id: id, vendor: parsed.data.vendor ?? null },
    })

    const { data: checks } = await fastify.supabase
      .from('bgv_checks').select('*').eq('case_id', bgvCase.id).eq('tenant_id', req.tenantId).order('created_at')
    return reply.code(201).send({ data: { ...bgvCase, checks: checks ?? [] } })
  })

  // Update a single check (status, vendor ref, remarks, report document).
  fastify.patch('/bgv/checks/:checkId', hrAdminAuth, async (req: any, reply) => {
    const { checkId } = req.params as { checkId: string }
    const schema = z.object({
      status:        z.enum(['pending','initiated','in_progress','clear','flagged','not_applicable']).optional(),
      vendor_ref:    z.string().optional().nullable(),
      remarks:       z.string().optional().nullable(),
      document_path: z.string().optional().nullable(),
      document_name: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
    if (parsed.data.status === 'clear' || parsed.data.status === 'flagged') {
      patch.verified_by = req.userId
      patch.verified_at = new Date().toISOString()
    }
    const { data, error } = await fastify.supabase
      .from('bgv_checks').update(patch).eq('id', checkId).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Check not found' })
    return reply.send({ data })
  })

  // Finalize the case (clear / flagged), with an auto-suggested verdict.
  fastify.post('/bgv/cases/:caseId/finalize', hrAdminAuth, async (req: any, reply) => {
    const { caseId } = req.params as { caseId: string }
    const schema = z.object({
      status:          z.enum(['clear','flagged','cancelled']),
      overall_remarks: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('bgv_cases')
      .update({
        status: parsed.data.status, overall_remarks: parsed.data.overall_remarks ?? null,
        completed_at: parsed.data.status === 'cancelled' ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', caseId).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'BGV case not found' })
    return reply.send({ data })
  })

  // BGV dashboard list (cases + a check-status rollup) for HR.
  fastify.get('/bgv', hrAdminAuth, async (req: any, reply) => {
    const { data: cases } = await fastify.supabase
      .from('bgv_cases')
      .select(`*, applications(candidates(first_name, last_name), job_requisitions(title))`)
      .eq('tenant_id', req.tenantId).order('initiated_at', { ascending: false })
    const ids = (cases ?? []).map((c: any) => c.id)
    const byCase: Record<string, any[]> = {}
    if (ids.length) {
      const { data: checks } = await fastify.supabase
        .from('bgv_checks').select('case_id, check_type, status').eq('tenant_id', req.tenantId).in('case_id', ids)
      for (const ch of checks ?? []) (byCase[ch.case_id] ??= []).push(ch)
    }
    const rows = (cases ?? []).map((c: any) => {
      const cand = c.applications?.candidates
      return {
        id: c.id, application_id: c.application_id, status: c.status, vendor: c.vendor,
        initiated_at: c.initiated_at, completed_at: c.completed_at,
        candidate_name: `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`.trim(),
        job_title: c.applications?.job_requisitions?.title ?? '',
        checks: byCase[c.id] ?? [],
      }
    })
    return reply.send({ data: rows })
  })

  // ── Public Candidate Portal ───────────────────────────────────────────────
  // No authentication — application UUID acts as the access token.
  // Returns only safe public fields; no scores, notes, or rejection reasons.

  fastify.get('/portal/candidate/:appId', async (req: any, reply) => {
    const { appId } = req.params as { appId: string }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(appId)) return reply.code(404).send({ error: 'NOT_FOUND' })

    const { data: app } = await fastify.supabase
      .from('applications')
      .select(`
        id, status, created_at, tenant_id, stage_id,
        candidates(first_name, last_name),
        job_requisitions(title, departments(name))
      `)
      .eq('id', appId)
      .maybeSingle()

    if (!app) return reply.code(404).send({ error: 'NOT_FOUND' })

    const tenantId = (app as any).tenant_id

    const [{ data: tenant }, { data: stages }, { data: interviews }] = await Promise.all([
      fastify.supabase.from('tenants').select('name').eq('id', tenantId).single(),
      fastify.supabase
        .from('recruitment_pipeline_stages')
        .select('id, name, stage_type, stage_order, color')
        .eq('tenant_id', tenantId)
        .order('stage_order'),
      fastify.supabase
        .from('interview_rounds')
        .select('round_number, title, interview_type, scheduled_at, duration_mins, status')
        .eq('application_id', appId)
        .order('round_number'),
    ])

    const cand = (app as any).candidates
    const reqn = (app as any).job_requisitions

    // Surface a live offer (sent/accepted/declined) so the candidate can act on it.
    const { data: offer } = await fastify.supabase
      .from('recruitment_offer_letters')
      .select('id, status, offered_amount, joining_date, valid_until, html_content, accepted_at, declined_at')
      .eq('application_id', appId).eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    return reply.send({
      data: {
        id:               (app as any).id,
        status:           (app as any).status,
        applied_at:       (app as any).created_at,
        first_name:       cand?.first_name ?? '',
        candidate_name:   `${cand?.first_name ?? ''} ${cand?.last_name ?? ''}`.trim(),
        job_title:        reqn?.title ?? '',
        department:       reqn?.departments?.name ?? '',
        company_name:     (tenant as any)?.name ?? '',
        current_stage_id: (app as any).stage_id,
        stages:           stages ?? [],
        interviews:       (interviews ?? []).map((i: any) => ({
          round_number: i.round_number,
          title:        i.title,
          type:         i.interview_type,
          scheduled_at: i.scheduled_at,
          duration_mins: i.duration_mins,
          status:       i.status,
        })),
        offer: offer ? {
          id:             offer.id,
          status:         offer.status,
          offered_amount: offer.offered_amount,
          joining_date:   offer.joining_date,
          valid_until:    offer.valid_until,
          html_content:   offer.html_content,
          accepted_at:    offer.accepted_at,
          declined_at:    offer.declined_at,
        } : null,
      },
    })
  })

  // ── Public offer accept / decline (UUID = access token) ────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  async function loadPortalOffer(appId: string) {
    const { data: app } = await fastify.supabase
      .from('applications')
      .select('id, tenant_id, pre_joinee_invitation_id, job_requisitions(title, departments(name))')
      .eq('id', appId)
      .maybeSingle()
    if (!app) return null
    const { data: offer } = await fastify.supabase
      .from('recruitment_offer_letters')
      .select('id, status, joining_date, valid_until')
      .eq('application_id', appId).eq('tenant_id', (app as any).tenant_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return { app, offer }
  }

  fastify.post('/portal/candidate/:appId/offer/accept', async (req: any, reply) => {
    const { appId } = req.params as { appId: string }
    if (!UUID_RE.test(appId)) return reply.code(404).send({ error: 'NOT_FOUND' })

    const ctx = await loadPortalOffer(appId)
    if (!ctx || !ctx.offer) return reply.code(404).send({ error: 'NO_OFFER', message: 'No offer found for this application.' })
    if (ctx.offer.status === 'accepted') return reply.send({ ok: true, message: 'Offer already accepted.' })
    if (ctx.offer.status !== 'sent') {
      return reply.code(409).send({ error: 'NOT_ACTIONABLE', message: `This offer is ${ctx.offer.status} and can no longer be accepted.` })
    }
    if (ctx.offer.valid_until && new Date(ctx.offer.valid_until) < new Date(new Date().toISOString().slice(0, 10))) {
      return reply.code(410).send({ error: 'EXPIRED', message: 'This offer has expired. Please contact the recruiter.' })
    }

    const tenantId = (ctx.app as any).tenant_id
    const reqn = (ctx.app as any).job_requisitions
    const now = new Date().toISOString()

    await fastify.supabase.from('recruitment_offer_letters')
      .update({ status: 'accepted', accepted_at: now, updated_at: now }).eq('id', ctx.offer.id).eq('tenant_id', tenantId)
    await fastify.supabase.from('applications')
      .update({ status: 'hired', offer_accepted: true }).eq('id', appId).eq('tenant_id', tenantId)

    // Auto-create the pre-joinee invitation (closes recruitment → onboarding).
    const result = await createPreJoineeFromApp(fastify, tenantId, appId, {
      joining_date: ctx.offer.joining_date,
      designation:  reqn?.title ?? null,
      department:   reqn?.departments?.name ?? null,
      invited_by:   null,
    })

    return reply.send({
      ok: true,
      message: 'Offer accepted. Your onboarding link is on its way to your email.',
      preboarding: result.ok,
    })
  })

  fastify.post('/portal/candidate/:appId/offer/decline', async (req: any, reply) => {
    const { appId } = req.params as { appId: string }
    if (!UUID_RE.test(appId)) return reply.code(404).send({ error: 'NOT_FOUND' })

    const ctx = await loadPortalOffer(appId)
    if (!ctx || !ctx.offer) return reply.code(404).send({ error: 'NO_OFFER', message: 'No offer found for this application.' })
    if (ctx.offer.status === 'declined') return reply.send({ ok: true, message: 'Offer already declined.' })
    if (ctx.offer.status !== 'sent') {
      return reply.code(409).send({ error: 'NOT_ACTIONABLE', message: `This offer is ${ctx.offer.status} and can no longer be declined.` })
    }

    const tenantId = (ctx.app as any).tenant_id
    const now = new Date().toISOString()
    await fastify.supabase.from('recruitment_offer_letters')
      .update({ status: 'declined', declined_at: now, updated_at: now }).eq('id', ctx.offer.id).eq('tenant_id', tenantId)
    await fastify.supabase.from('applications')
      .update({ status: 'rejected', offer_accepted: false, rejection_reason: 'Offer declined by candidate' }).eq('id', appId).eq('tenant_id', tenantId)

    return reply.send({ ok: true, message: 'You have declined the offer. Thank you for letting us know.' })
  })
}
