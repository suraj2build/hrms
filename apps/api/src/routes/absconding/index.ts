/**
 * Absconding Case Management routes — /absconding/*
 *
 * All endpoints require HR admin role or above.
 * CHRO-only endpoint: POST /:caseId/approve-termination
 *
 * Endpoints:
 *   GET  /absconding/cases                        — queue with filters
 *   GET  /absconding/cases/:caseId                — case detail
 *   GET  /absconding/cases/:caseId/communications — communication log
 *   POST /absconding/cases/:caseId/letters        — generate WL1/WL2/termination
 *   POST /absconding/cases/:caseId/communications — add manual comm log entry
 *   PATCH /absconding/cases/:caseId/status        — HR override (resolve/close)
 *   POST /absconding/cases/:caseId/approve-termination — CHRO approval
 *   GET  /absconding/dashboard                    — summary stats
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

// absconding_cases.response_channel CHECK (migration 323) — the ground truth
// for valid channel values. absconding_communications.channel has no CHECK
// (free text), but constraining input here keeps both tables consistent.
const RESPONSE_CHANNELS = ['email', 'whatsapp', 'in_person', 'letter', 'phone'] as const
import {
  sendWarningLetter1,
  sendWarningLetter2,
  flagForTermination,
  processTermination,
  resolveCase,
  scanAndEscalate,
} from '../../lib/absconding-engine.js'

// Fresh audit finding: 'second_escalation' (the Day-5 escalation rung set by
// absconding-engine.ts's scanAndEscalate()/escalateSecond()) was missing from
// both lists — ?status=second_escalation 400'd, and the dashboard's
// total_open/avg_ua_days silently excluded every case sitting at that stage.
const OPEN_STATUSES = ['flagged', 'second_escalation', 'wl1_sent', 'wl2_sent', 'termination_pending'] as const
const ALL_STATUSES  = [...OPEN_STATUSES, 'terminated', 'resolved', 'closed'] as const

export default async function abscondingRoutes(fastify: FastifyInstance) {
  const hrAuth   = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }
  const chroAuth = { preHandler: [fastify.authenticate, requireRole('owner', 'chro', 'hr_admin')] }

  // ── GET /absconding/cases ─────────────────────────────────────────────────

  fastify.get('/cases', hrAuth, async (req: any, reply) => {
    const qs = z.object({
      status: z.enum([...ALL_STATUSES, 'all']).optional().default('all'),
      page:   z.coerce.number().int().min(1).optional().default(1),
      limit:  z.coerce.number().int().min(1).max(100).optional().default(20),
      search: z.string().optional(),
    }).safeParse(req.query)

    if (!qs.success) return reply.code(400).send({ error: 'VALIDATION', message: qs.error.issues[0].message })
    const { status, page, limit, search } = qs.data
    const offset = (page - 1) * limit

    let q = fastify.supabase
      .from('absconding_cases')
      .select(`
        id, status, first_ua_date, last_ua_date, ua_days_count,
        wl1_sent_at, wl2_sent_at, chro_approval_required,
        created_at, updated_at,
        employee:employees!employee_id(
          id, employee_code, first_name, last_name, status,
          department:departments!department_id(name),
          designation:designations(name)
        ),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url)
      `)
      .eq('tenant_id', req.tenantId)
      .order('updated_at', { ascending: false }) as any

    if (status !== 'all') q = q.eq('status', status)

    // Fresh audit finding: search was previously applied in-memory AFTER
    // .range(offset, offset+limit-1) had already paginated at the DB layer —
    // a matching case outside the current page was invisible, and `total`
    // reflected the unfiltered count instead of the search-matched count.
    // Fetch the full (tenant+status-filtered) set, search-filter, THEN
    // paginate in JS — absconding_cases is a small, bounded compliance
    // dataset, so this mirrors the same fetch-all-then-filter pattern
    // already used for the /datasets/leave and /datasets/separation
    // endpoints.
    let allRows: any[]
    try {
      allRows = await fetchAllRows((from, to) => (q as any).range(from, to))
    } catch (error: any) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch absconding cases')
    }

    let rows = allRows
    if (search) {
      const term = search.toLowerCase()
      rows = rows.filter((r: any) => {
        const emp = r.employee
        return (
          emp?.first_name?.toLowerCase().includes(term) ||
          emp?.last_name?.toLowerCase().includes(term) ||
          emp?.employee_code?.toLowerCase().includes(term)
        )
      })
    }

    const total = rows.length
    const paged = rows.slice(offset, offset + limit)

    return reply.send({ data: paged, total, page, limit })
  })

  // ── GET /absconding/dashboard ─────────────────────────────────────────────

  fastify.get('/dashboard', hrAuth, async (req: any, reply) => {
    const { data: cases, error: casesErr } = await fastify.supabase
      .from('absconding_cases')
      .select('status, created_at, first_ua_date, ua_days_count')
      .eq('tenant_id', req.tenantId)

    if (casesErr) return serverError(req, reply, casesErr, ErrorCode.QUERY_FAILED, 'Failed to fetch absconding dashboard')

    const all = (cases ?? []) as { status: string; created_at: string; first_ua_date: string; ua_days_count: number }[]

    const counts: Record<string, number> = {}
    for (const s of ALL_STATUSES) counts[s] = 0
    for (const c of all) counts[c.status] = (counts[c.status] ?? 0) + 1

    const openCases = all.filter(c => OPEN_STATUSES.includes(c.status as any))
    const avgDays = openCases.length
      ? Math.round(openCases.reduce((s, c) => s + (c.ua_days_count ?? 0), 0) / openCases.length)
      : 0

    // Cases opened in last 30 days
    const thirtyAgo = new Date()
    thirtyAgo.setDate(thirtyAgo.getDate() - 30)
    const recentCount = all.filter(c => new Date(c.created_at) >= thirtyAgo).length

    return reply.send({
      data: {
        counts,
        total_open:  OPEN_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0),
        avg_ua_days: avgDays,
        opened_30d:  recentCount,
      },
    })
  })

  // ── GET /absconding/cases/:caseId ─────────────────────────────────────────

  fastify.get('/cases/:caseId', hrAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('absconding_cases')
      .select(`
        *,
        employee:employees!employee_id(
          id, employee_code, first_name, last_name, status, joining_date, email,
          phone, personal_email,
          department:departments!department_id(name),
          designation:designations(name),
          manager:employees!manager_id(first_name, last_name)
        ),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url),
        chro_profile:profiles!chro_approved_by(id, full_name)
      `)
      .eq('id', req.params.caseId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch absconding case')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Case not found')
    return reply.send({ data })
  })

  // ── GET /absconding/cases/:caseId/communications ──────────────────────────

  fastify.get('/cases/:caseId/communications', hrAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('absconding_communications')
      .select(`
        id, comm_type, direction, subject, body, channel, created_at, metadata,
        sent_by_profile:profiles!sent_by(id, full_name, avatar_url)
      `)
      .eq('case_id', req.params.caseId)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: true })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch case communications')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /absconding/cases/:caseId/letters ────────────────────────────────

  fastify.post('/cases/:caseId/letters', hrAuth, async (req: any, reply) => {
    const parsed = z.object({
      letter_type: z.enum(['wl1', 'wl2', 'termination']),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    try {
      const { caseId } = req.params
      if (parsed.data.letter_type === 'wl1') {
        await sendWarningLetter1(fastify.supabase, caseId, req.tenantId, req.userId)
      } else if (parsed.data.letter_type === 'wl2') {
        await sendWarningLetter2(fastify.supabase, caseId, req.tenantId, req.userId)
      } else {
        await flagForTermination(fastify.supabase, caseId, req.tenantId, req.userId)
      }
      return reply.code(201).send({ success: true })
    } catch (e: any) {
      return reply.code(422).send({ error: 'ACTION_FAILED', message: e.message })
    }
  })

  // ── POST /absconding/cases/:caseId/communications ─────────────────────────

  fastify.post('/cases/:caseId/communications', hrAuth, async (req: any, reply) => {
    const parsed = z.object({
      comm_type: z.enum(['email_sent', 'whatsapp_sent', 'call_attempted', 'employee_response', 'hr_note']),
      direction: z.enum(['outbound', 'inbound', 'internal']),
      subject:   z.string().optional(),
      body:      z.string().min(1),
      channel:   z.enum(RESPONSE_CHANNELS).optional(),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Verify the case belongs to this tenant before attaching anything to it —
    // unlike every other case-mutating action in this file (warning letters,
    // flag-for-termination, resolve), this was the one route that never
    // re-fetched the case with a tenant filter, so a caller-supplied caseId
    // from another tenant would otherwise insert a communication record (and,
    // for employee_response, silently no-op an unchecked cross-tenant UPDATE)
    // against a case this tenant doesn't own.
    const { data: caseRow } = await fastify.supabase
      .from('absconding_cases')
      .select('id')
      .eq('id', req.params.caseId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!caseRow) return notFound(reply, 'CASE_NOT_FOUND', 'Case not found')

    // If employee responded, record it on the case too
    if (parsed.data.comm_type === 'employee_response') {
      const { error: caseUpdateErr } = await fastify.supabase
        .from('absconding_cases')
        .update({
          employee_response:    parsed.data.body,
          employee_response_at: new Date().toISOString(),
          response_channel:     parsed.data.channel,
        })
        .eq('id', req.params.caseId)
        .eq('tenant_id', req.tenantId)

      if (caseUpdateErr) {
        return serverError(req, reply, caseUpdateErr, ErrorCode.UPDATE_FAILED, 'Failed to record employee response on case')
      }
    }

    const { data, error } = await fastify.supabase
      .from('absconding_communications')
      .insert({
        ...parsed.data,
        case_id:   req.params.caseId,
        tenant_id: req.tenantId,
        sent_by:   req.userId,
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to record communication')
    return reply.code(201).send({ data })
  })

  // ── PATCH /absconding/cases/:caseId/status ────────────────────────────────

  fastify.patch('/cases/:caseId/status', hrAuth, async (req: any, reply) => {
    const parsed = z.object({
      status:  z.enum(['resolved', 'closed']),
      remarks: z.string().min(1),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    try {
      await resolveCase(
        fastify.supabase,
        req.params.caseId,
        req.tenantId,
        req.userId,
        parsed.data.remarks,
        parsed.data.status,
      )
      return reply.send({ success: true })
    } catch (e: any) {
      return reply.code(422).send({ error: 'ACTION_FAILED', message: e.message })
    }
  })

  // ── POST /absconding/cases/:caseId/approve-termination ───────────────────

  fastify.post('/cases/:caseId/approve-termination', chroAuth, async (req: any, reply) => {
    const parsed = z.object({
      approved: z.boolean(),
      remarks:  z.string().min(1),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    try {
      await processTermination(
        fastify.supabase,
        req.params.caseId,
        req.tenantId,
        req.userId,
        parsed.data.approved,
        parsed.data.remarks,
      )
      return reply.send({ success: true })
    } catch (e: any) {
      return reply.code(422).send({ error: 'ACTION_FAILED', message: e.message })
    }
  })

  // ── POST /absconding/scan (internal — manual trigger) ─────────────────────
  // Protected by HR admin auth; primarily used for testing + manual runs.

  fastify.post('/scan', hrAuth, async (req: any, reply) => {
    try {
      const result = await scanAndEscalate(fastify.supabase, req.tenantId)
      return reply.send({ data: result })
    } catch (e: any) {
      return serverError(req, reply, e, ErrorCode.COMPUTE_FAILED, 'Absconding scan failed')
    }
  })

  // ── POST /absconding/run-auto-escalation ──────────────────────────────────
  // Was previously a second, hand-rolled copy of the Day 3/7/14/21 escalation
  // ladder that computed "today" from the server's own UTC clock (not the
  // tenant's timezone — the ISSUE-154 class this exact engine was already
  // fixed for elsewhere) and, worse, flipped a case straight to 'wl1_sent'/
  // 'wl2_sent' without ever calling sendWarningLetter1/2 — no letter PDF, no
  // `letters` row, no ref_number — while logging a communications entry that
  // falsely claimed a warning letter was generated. That let a case reach
  // 'termination_pending' → CHRO-approved termination despite the employee
  // never having legally received either warning letter, and the unconditioned
  // status update (no `.eq('status', c.status)` precondition) meant two
  // concurrent runs could double-process the same case. Delegate to the same
  // scanAndEscalate() the cron job and /scan use — it re-derives tenant-local
  // "today", drives the real WL1/WL2/termination-flag functions, and folds
  // its own preconditions into each write.
  fastify.post('/run-auto-escalation', hrAuth, async (req: any, reply) => {
    try {
      const result = await scanAndEscalate(fastify.supabase, req.tenantId)
      return reply.send({
        data: {
          processed:       result.cases_scanned,
          escalated_count: result.cases_wl1 + result.cases_wl2 + result.cases_term,
          detail:          result,
        },
      })
    } catch (e: any) {
      return serverError(req, reply, e, ErrorCode.COMPUTE_FAILED, 'Auto-escalation failed')
    }
  })

  // ── GET /absconding/cases/:caseId/letters/:letterId/download ─────────────

  fastify.get('/cases/:caseId/letters/:letterId/download', hrAuth, async (req: any, reply) => {
    const { caseId, letterId } = req.params as { caseId: string; letterId: string }

    const { data: letter, error } = await fastify.supabase
      .from('letters')
      .select('pdf_url, template_code, employee_id')
      .eq('id', letterId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error || !letter) return reply.code(404).send({ error: 'Letter not found' })

    // Verify the letter belongs to the case
    const { data: caseRow } = await fastify.supabase
      .from('absconding_cases')
      .select('employee_id')
      .eq('id', caseId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!caseRow || (caseRow as any).employee_id !== (letter as any).employee_id) {
      return reply.code(403).send({ error: 'Letter does not belong to this case' })
    }

    const pdfUrl = (letter as any).pdf_url
    if (!pdfUrl) {
      return reply.code(404).send({ error: 'PDF not generated for this letter', template_code: (letter as any).template_code })
    }

    return reply.send({ data: { pdf_url: pdfUrl } })
  })

  // ── PATCH /absconding/cases/:caseId/asset-recovery ───────────────────────

  fastify.patch('/cases/:caseId/asset-recovery', hrAuth, async (req: any, reply) => {
    const { caseId } = req.params as { caseId: string }
    const { required, notes } = req.body as { required?: boolean; notes?: string }

    const update: Record<string, unknown> = {}
    if (required !== undefined) update.asset_recovery_required = required
    if (notes !== undefined)    update.asset_recovery_notes = notes

    if (Object.keys(update).length === 0) return reply.code(400).send({ error: 'Nothing to update' })

    const { data, error } = await fastify.supabase
      .from('absconding_cases')
      .update(update)
      .eq('id', caseId)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update asset recovery status')
    if (!data) return notFound(reply, 'CASE_NOT_FOUND', 'Case not found')
    return reply.send({ data: { updated: true } })
  })
}
