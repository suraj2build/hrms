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
import { logAction }    from '../../lib/audit-service.js'
import { notifyHrAdmins } from '../../lib/notify.js'

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

  fastify.post('/requisitions', hrAdminAuth, async (req: any, reply) => {
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
        candidates(id, first_name, last_name, email, phone, current_company, current_title, source, total_experience),
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
    return reply.send({ message: 'Application rejected' })
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
}
