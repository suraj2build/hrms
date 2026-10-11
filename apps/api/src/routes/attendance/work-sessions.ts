/**
 * work-sessions.ts — Attendance Session Intelligence & Temporal Ownership Engine
 *
 * Phase 16 API routes for work session management, anomaly detection,
 * cross-midnight resolution, payroll locking, and OT heatmaps.
 *
 * All routes require HR Admin or Super Admin role.
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import {
  buildDaySessionReport,
  buildMonthSessionBatch,
  detectMonthAnomalies,
  pairPunches,
  resolveAttendanceBusinessDate,
} from '../../lib/work-session-engine.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

// ── Body schemas ─────────────────────────────────────────────────────────────

const PairSessionsBodySchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
})

const LockSessionBodySchema = z.object({
  payroll_run_id: z.string().uuid().optional(),
})

// ── Auth helpers ──────────────────────────────────────────────────────────────


// ── Month range helper ────────────────────────────────────────────────────────

function monthRange(month: string): { start: string; end: string } {
  const start = `${month}-01`
  // Last day: first day of next month minus one day
  const [year, mon] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, mon, 0)) // mon is 1-based; Date.UTC(y, m, 0) = last day of month m-1
  const dd = String(lastDay.getUTCDate()).padStart(2, '0')
  const mm = String(lastDay.getUTCMonth() + 1).padStart(2, '0')
  const end = `${lastDay.getUTCFullYear()}-${mm}-${dd}`
  return { start, end }
}

/**
 * Attach employee_name + employee_code to rows keyed by employee_id, so the UI
 * shows a human identifier (name · CODE) instead of a raw UUID. work_sessions /
 * work_session_anomalies do not store these, so resolve them from employees.
 */
async function attachEmployeeLabels(
  supabase: any,
  tenantId: string,
  rows: Array<Record<string, any>> | null,
): Promise<Array<Record<string, any>>> {
  const list = rows ?? []
  if (list.length === 0) return list
  const empIds = [...new Set(list.map((r) => r.employee_id as string).filter(Boolean))]
  if (empIds.length === 0) return list
  // Chunked: this is a shared helper with no guarantee callers pass a
  // bounded id list — can exceed a single .in() URL's safe size at scale.
  const empRows: any[] = []
  for (let i = 0; i < empIds.length; i += 100) {
    const chunkIds = empIds.slice(i, i + 100)
    const { data, error } = await supabase
      // lint-query-ok: chunkIds is a slice of 100 ids (loop above) — result is bounded to <=100 rows, well under the 1,000-row cap
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .in('id', chunkIds)
      .eq('tenant_id', tenantId)
    // A discarded error here previously rendered every row's employee_name/code
    // as null — indistinguishable from "no employee data" — instead of
    // surfacing the failure; throw so the caller's existing try/catch reports
    // a real 500 (both current call sites already wrap this in a try/catch).
    if (error) throw new Error(`attachEmployeeLabels: failed to fetch employees: ${error.message}`)
    if (data) empRows.push(...data)
  }
  const map = new Map<string, { name: string; code: string | null }>()
  for (const e of (empRows ?? []) as Array<{ id: string; first_name: string; last_name: string; employee_code: string | null }>) {
    map.set(e.id, { name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(), code: e.employee_code ?? null })
  }
  return list.map((r) => {
    const emp = map.get(r.employee_id as string)
    return { ...r, employee_name: emp?.name ?? null, employee_code: emp?.code ?? null }
  })
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function workSessionRoutes(fastify: FastifyInstance) {
  const supabase = (fastify as any).supabase
  const auth     = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!HR_ADMIN_ROLES.includes(req.userRole ?? '')) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /attendance/sessions ──────────────────────────────────────────────
  // List all work sessions for an employee for a given month.

  fastify.get('/attendance/sessions', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { employeeId, month } = req.query as { employeeId?: string; month?: string }
    const tenantId = req.tenantId as string

    if (!employeeId) return reply.code(400).send({ error: 'employeeId is required' })
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month (YYYY-MM) is required' })

    const { start, end } = monthRange(month)

    const { data, error } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .gte('attendance_date', start)
      .lte('attendance_date', end)
      .order('attendance_date', { ascending: true })
      .order('session_start', { ascending: true })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch work sessions')
    return reply.send({ data })
  })

  // ── GET /attendance/sessions/explain ──────────────────────────────────────
  // Full DaySessionReport for a single employee/date.

  fastify.get('/attendance/sessions/explain', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { employeeId, date } = req.query as { employeeId?: string; date?: string }
    const tenantId = req.tenantId as string

    if (!employeeId) return reply.code(400).send({ error: 'employeeId is required' })
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'date (YYYY-MM-DD) is required' })

    try {
      const report = await buildDaySessionReport(supabase, tenantId, employeeId, date)
      return reply.send({ data: report })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to build day session report')
    }
  })

  // ── GET /attendance/sessions/missing-punches ──────────────────────────────
  // Sessions where session_end IS NULL (incomplete / missing OUT punch).

  fastify.get('/attendance/sessions/missing-punches', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.query as { month?: string }
    const tenantId = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month (YYYY-MM) is required' })

    const { start, end } = monthRange(month)

    let sessions: any[]
    try {
      sessions = await fetchAllRows((from, to) =>
        supabase
          .from('work_sessions')
          .select(`
            id,
            employee_id,
            attendance_date,
            session_start,
            session_end,
            source,
            employees!inner ( first_name, last_name, employee_code )
          `)
          .eq('tenant_id', tenantId)
          .gte('attendance_date', start)
          .lte('attendance_date', end)
          .is('session_end', null)
          .order('attendance_date', { ascending: true })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch missing-punch sessions')
    }

    const result = (sessions ?? []).map((s: any) => ({
      employee_id:    s.employee_id,
      employee_name:  s.employees ? `${s.employees.first_name} ${s.employees.last_name}` : null,
      employee_code:  s.employees?.employee_code ?? null,
      date:           s.attendance_date,
      in_time:        s.session_start,
      out_time:       s.session_end,
      source:         s.source,
    }))

    return reply.send({ data: result })
  })

  // ── GET /attendance/sessions/cross-midnight ───────────────────────────────
  // Sessions that cross midnight.

  fastify.get('/attendance/sessions/cross-midnight', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.query as { month?: string }
    const tenantId = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month (YYYY-MM) is required' })

    const { start, end } = monthRange(month)

    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('work_sessions')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('is_cross_midnight', true)
          .gte('attendance_date', start)
          .lte('attendance_date', end)
          .order('session_start', { ascending: true })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch cross-midnight sessions')
    }
    return reply.send({ data: await attachEmployeeLabels(supabase, tenantId, data) })
  })

  // ── GET /attendance/sessions/locks ────────────────────────────────────────
  // Sessions locked for payroll.

  fastify.get('/attendance/sessions/locks', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.query as { month?: string }
    const tenantId = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month (YYYY-MM) is required' })

    const { start, end } = monthRange(month)

    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('work_sessions')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('payroll_locked', true)
          .gte('attendance_date', start)
          .lte('attendance_date', end)
          .order('attendance_date', { ascending: true })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch locked sessions')
    }
    return reply.send({ data: await attachEmployeeLabels(supabase, tenantId, data) })
  })

  // ── GET /attendance/sessions/ot-heatmap ───────────────────────────────────
  // Per-employee daily OT summary for a month.

  fastify.get('/attendance/sessions/ot-heatmap', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.query as { month?: string }
    const tenantId = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month (YYYY-MM) is required' })

    const { start, end } = monthRange(month)

    let sessions: any[]
    try {
      sessions = await fetchAllRows((from, to) =>
        supabase
          .from('work_sessions')
          .select(`
            employee_id,
            attendance_date,
            overtime_minutes,
            employees!inner ( first_name, last_name, employee_code )
          `)
          .eq('tenant_id', tenantId)
          .gte('attendance_date', start)
          .lte('attendance_date', end)
          .order('attendance_date', { ascending: true })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch OT heatmap sessions')
    }

    // Aggregate per employee
    const map = new Map<string, {
      employee_id: string
      employee_name: string | null
      employee_code: string | null
      daily_ot: Record<string, number>
      total_ot_minutes: number
    }>()

    for (const s of sessions ?? []) {
      const eid: string = s.employee_id
      const ot: number  = s.overtime_minutes ?? 0
      if (!map.has(eid)) {
        map.set(eid, {
          employee_id:   eid,
          employee_name: s.employees ? `${s.employees.first_name} ${s.employees.last_name}` : null,
          employee_code: s.employees?.employee_code ?? null,
          daily_ot:      {},
          total_ot_minutes: 0,
        })
      }
      const entry = map.get(eid)!
      const prev = entry.daily_ot[s.attendance_date] ?? 0
      entry.daily_ot[s.attendance_date] = prev + ot
      entry.total_ot_minutes += ot
    }

    const result = Array.from(map.values()).filter(e => e.total_ot_minutes > 0)
    return reply.send({ data: result })
  })

  // ── GET /attendance/sessions/compliance-risks ─────────────────────────────
  // Unresolved anomalies grouped by employee.

  fastify.get('/attendance/sessions/compliance-risks', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month } = req.query as { month?: string }
    const tenantId = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month (YYYY-MM) is required' })

    const { start, end } = monthRange(month)

    let anomalies: any[]
    try {
      anomalies = await fetchAllRows((from, to) =>
        supabase
          .from('work_session_anomalies')
          .select(`
            id,
            employee_id,
            anomaly_type,
            severity,
            session_id,
            punch_ids,
            detail,
            created_at,
            resolved,
            employees!inner ( first_name, last_name, employee_code )
          `)
          .eq('tenant_id', tenantId)
          .eq('resolved', false)
          .gte('created_at', `${start}T00:00:00.000Z`)
          .lte('created_at', `${end}T23:59:59.999Z`)
          .order('created_at', { ascending: false })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compliance-risk anomalies')
    }

    const map = new Map<string, {
      employee_id: string
      employee_name: string | null
      employee_code: string | null
      risk_count: number
      risks: unknown[]
    }>()

    for (const a of anomalies ?? []) {
      const eid: string = a.employee_id
      if (!map.has(eid)) {
        map.set(eid, {
          employee_id:   eid,
          employee_name: a.employees ? `${a.employees.first_name} ${a.employees.last_name}` : null,
          employee_code: a.employees?.employee_code ?? null,
          risk_count:    0,
          risks:         [],
        })
      }
      const entry = map.get(eid)!
      entry.risk_count += 1
      entry.risks.push(a)
    }

    return reply.send({ data: Array.from(map.values()) })
  })

  // ── POST /attendance/sessions/pair ────────────────────────────────────────
  // Trigger punch-pairing for an employee/date and upsert resulting sessions.

  fastify.post('/attendance/sessions/pair', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = PairSessionsBodySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { employee_id, date } = parsed.data
    const tenantId = req.tenantId as string

    let report: Awaited<ReturnType<typeof buildDaySessionReport>>
    try {
      report = await buildDaySessionReport(supabase, tenantId, employee_id, date)
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to build day session report')
    }

    // Build upsert payload from the day report's sessions
    const sessionRows = report.sessions.map((s: any) => ({
      employee_id,
      tenant_id:        tenantId,
      attendance_date:  s.attendance_date,
      session_start:    s.in_punch?.punch_time ?? null,
      session_end:      s.out_punch?.punch_time ?? null,
      work_minutes:     s.work_minutes,
      is_cross_midnight: s.is_cross_midnight,
      source:           s.source,
      source_punch_ids: s.in_punch
        ? [s.in_punch.id, ...(s.out_punch ? [s.out_punch.id] : [])]
        : [],
      overtime_minutes:    0,
      late_minutes:        0,
      early_exit_minutes:  0,
      shift_id:            report.ownership_decision?.shift_id ?? null,
      approval_status:     'auto',
      payroll_locked:      false,
      compliance_flags:    s.compliance_flags ?? {},
    }))

    let upsertError: any = null
    if (sessionRows.length > 0) {
      const { error } = await supabase
        .from('work_sessions')
        .upsert(sessionRows, {
          onConflict: 'employee_id,tenant_id,session_start',
          ignoreDuplicates: false,
        })
      upsertError = error
    }

    if (upsertError) return serverError(req, reply, upsertError, ErrorCode.UPDATE_FAILED, 'Failed to save work sessions')

    return reply.send({
      data: {
        sessions_created: sessionRows.length,
        anomalies:        report.anomalies?.length ?? 0,
      },
    })
  })

  // ── POST /attendance/sessions/:sessionId/lock ─────────────────────────────
  // Lock a session for payroll.

  fastify.post('/attendance/sessions/:sessionId/lock', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { sessionId } = req.params as { sessionId: string }
    const parsed = LockSessionBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { payroll_run_id } = parsed.data
    const tenantId = req.tenantId as string

    // Check current state for a friendly 404 vs 409 distinction — the
    // authoritative guard is the .eq('payroll_locked', false) folded into
    // the UPDATE's own WHERE clause below, so a concurrent lock request
    // can't race this pre-check and still land.
    const { data: existing, error: fetchError } = await supabase
      .from('work_sessions')
      .select('id, payroll_locked')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (fetchError) return serverError(req, reply, fetchError, ErrorCode.QUERY_FAILED, 'Failed to fetch session')
    if (!existing) return notFound(reply, 'SESSION_NOT_FOUND', 'Session not found')

    const updatePayload: Record<string, unknown> = {
      payroll_locked:    true,
      payroll_locked_at: new Date().toISOString(),
    }
    if (payroll_run_id !== undefined) updatePayload.payroll_run_id = payroll_run_id

    const { data: updated, error: updateError } = await supabase
      .from('work_sessions')
      .update(updatePayload)
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('payroll_locked', false)
      .select('id')
      .maybeSingle()

    if (updateError) return serverError(req, reply, updateError, ErrorCode.UPDATE_FAILED, 'Failed to lock session')
    if (!updated) return conflictError(reply, 'ALREADY_LOCKED', 'Session already locked')
    return reply.send({ data: { locked: true } })
  })

  // ── POST /attendance/sessions/:sessionId/unlock ───────────────────────────
  // Unlock a payroll-locked session.

  fastify.post('/attendance/sessions/:sessionId/unlock', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { sessionId } = req.params as { sessionId: string }
    const tenantId = req.tenantId as string

    // Check current state for a friendly 404 vs 409 distinction — the
    // authoritative guard is the .eq('payroll_locked', true) folded into
    // the UPDATE's own WHERE clause below.
    const { data: existing, error: fetchError } = await supabase
      .from('work_sessions')
      .select('id, payroll_locked')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (fetchError) return serverError(req, reply, fetchError, ErrorCode.QUERY_FAILED, 'Failed to fetch session')
    if (!existing) return notFound(reply, 'SESSION_NOT_FOUND', 'Session not found')

    const { data: updated, error: updateError } = await supabase
      .from('work_sessions')
      .update({
        payroll_locked:    false,
        payroll_locked_at: null,
        payroll_run_id:    null,
      })
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('payroll_locked', true)
      .select('id')
      .maybeSingle()

    if (updateError) return serverError(req, reply, updateError, ErrorCode.UPDATE_FAILED, 'Failed to unlock session')
    if (!updated) return conflictError(reply, 'NOT_LOCKED', 'Session is not locked')
    return reply.send({ data: { unlocked: true } })
  })

  // ── GET /work-session-anomalies ───────────────────────────────────────────
  // List anomalies for a month with optional filters, or free-text search.
  //
  // Query modes:
  //   1. Browse mode  — month=YYYY-MM required. Returns up to 200 rows with severity/resolved filters.
  //   2. Search mode  — q=<term> (≥3 chars). month is optional; limit capped at 20 for fast responses.
  //      Matches anomaly_type and employee_name (via joined employees table) using ilike.
  //
  // Tenant isolation is always enforced via .eq('tenant_id', tenantId).

  fastify.get('/work-session-anomalies', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { month, severity, resolved, q, limit: rawLimit } = req.query as {
      month?:    string
      severity?: string
      resolved?: string
      q?:        string
      limit?:    string
    }
    const tenantId  = req.tenantId as string
    const isSearch  = q && q.trim().length >= 1
    const pageLimit = isSearch
      ? Math.min(parseInt(rawLimit ?? '10', 10) || 10, 20)
      : Math.min(parseInt(rawLimit ?? '100', 10) || 100, 200)

    // Browse mode requires a valid month; search mode does not
    if (!isSearch) {
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return reply.code(400).send({ error: 'month (YYYY-MM) is required when q is not provided' })
      }
    }

    let query = supabase
      .from('work_session_anomalies')
      .select(
        'id, employee_id, anomaly_type, attendance_date, severity, resolved, created_at',
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(pageLimit)

    // Apply month range when present
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const { start, end } = monthRange(month)
      query = query
        .gte('created_at', `${start}T00:00:00.000Z`)
        .lte('created_at', `${end}T23:59:59.999Z`)
    }

    // Free-text search on anomaly_type (employee_name is not a stored column;
    // anomaly_type is an enum but ilike still works for partial-string matching)
    if (isSearch) {
      const term = `%${q!.trim()}%`
      query = query.ilike('anomaly_type', term)
    }

    if (severity) query = query.eq('severity', severity)

    if (resolved !== undefined) {
      const resolvedBool = resolved === 'true' || resolved === '1'
      query = query.eq('resolved', resolvedBool)
    }

    const { data, error } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch work session anomalies')

    // Always enrich with employee name + code so the UI shows a human identifier
    // (name · CODE) rather than a raw UUID. work_session_anomalies does not store
    // these, so resolve them from employees. `date` aliases attendance_date for
    // back-compat with existing callers.
    const rows = (data ?? []) as Array<Record<string, unknown>>
    if (rows.length > 0) {
      const empIds = [...new Set(rows.map((r) => r.employee_id as string).filter(Boolean))]
      const { data: empRows, error: empErr } = await supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .in('id', empIds)
        .eq('tenant_id', tenantId)
      if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to fetch work session anomalies')

      const empMap = new Map<string, { name: string; code: string | null }>()
      for (const e of (empRows ?? []) as Array<{ id: string; first_name: string; last_name: string; employee_code: string | null }>) {
        empMap.set(e.id, { name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(), code: e.employee_code ?? null })
      }

      const enriched = rows.map((r) => {
        const emp = empMap.get(r.employee_id as string)
        return {
          ...r,
          employee_name: emp?.name ?? null,
          employee_code: emp?.code ?? null,
          date:          r.attendance_date,
        }
      })
      return reply.send({ data: enriched })
    }

    return reply.send({ data: rows })
  })

  // ── POST /work-session-anomalies/:id/resolve ──────────────────────────────
  // Mark an anomaly as resolved.

  fastify.post('/work-session-anomalies/:id/resolve', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    const { resolution_note } = (req.body ?? {}) as { resolution_note?: string }
    const tenantId  = req.tenantId as string
    const userId    = req.userId as string

    const updatePayload: Record<string, unknown> = {
      resolved:    true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    }
    if (resolution_note !== undefined) updatePayload.resolution_note = resolution_note

    const { data, error } = await supabase
      .from('work_session_anomalies')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to resolve anomaly')
    if (!data) return notFound(reply, 'ANOMALY_NOT_FOUND', 'Work session anomaly not found')
    return reply.send({ data: { resolved: true } })
  })
}
