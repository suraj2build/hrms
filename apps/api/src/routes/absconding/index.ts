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
import {
  sendWarningLetter1,
  sendWarningLetter2,
  flagForTermination,
  processTermination,
  resolveCase,
  scanAndEscalate,
} from '../../lib/absconding-engine.js'

const OPEN_STATUSES = ['flagged', 'wl1_sent', 'wl2_sent', 'termination_pending'] as const
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
          designation:positions!position_id(title)
        ),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status !== 'all') q = q.eq('status', status)

    // basic name search — filter in-memory if search provided (small sets)
    const { data, count, error } = await q

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    let rows = (data ?? []) as any[]
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

    return reply.send({ data: rows, total: count ?? 0, page, limit })
  })

  // ── GET /absconding/dashboard ─────────────────────────────────────────────

  fastify.get('/dashboard', hrAuth, async (req: any, reply) => {
    const { data: cases } = await fastify.supabase
      .from('absconding_cases')
      .select('status, created_at, first_ua_date, ua_days_count')
      .eq('tenant_id', req.tenantId)

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
      counts,
      total_open:    OPEN_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0),
      avg_ua_days:   avgDays,
      opened_30d:    recentCount,
    })
  })

  // ── GET /absconding/cases/:caseId ─────────────────────────────────────────

  fastify.get('/cases/:caseId', hrAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('absconding_cases')
      .select(`
        *,
        employee:employees!employee_id(
          id, employee_code, first_name, last_name, status, date_of_joining, work_email,
          personal_phone, personal_email,
          department:departments!department_id(name),
          designation:positions!position_id(title),
          manager:employees!manager_id(first_name, last_name)
        ),
        assigned_to_profile:profiles!assigned_to(id, full_name, avatar_url),
        chro_profile:profiles!chro_approved_by(id, full_name)
      `)
      .eq('id', req.params.caseId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Case not found' })
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

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
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
      channel:   z.string().optional(),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // If employee responded, record it on the case too
    if (parsed.data.comm_type === 'employee_response') {
      await fastify.supabase
        .from('absconding_cases')
        .update({
          employee_response:    parsed.data.body,
          employee_response_at: new Date().toISOString(),
          response_channel:     parsed.data.channel,
        })
        .eq('id', req.params.caseId)
        .eq('tenant_id', req.tenantId)
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

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
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
      return reply.code(500).send({ error: 'SCAN_FAILED', message: e.message })
    }
  })
}
