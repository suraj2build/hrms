/**
 * Workspace Stats Routes
 *
 * Aggregated operational statistics consumed by the four workspace
 * command headers and intelligence panels. Each endpoint is a single
 * fast parallel-query aggregation — no per-row processing.
 *
 * GET  /onboarding/stats          — WorkforceWorkspace command header
 * GET  /onboarding/events         — WorkforceWorkspace timeline
 * GET  /employees/overview        — WorkforceWorkspace secondary metrics
 * GET  /attendance/stats          — AttendanceWorkspace command header
 * GET  /attendance/events         — AttendanceWorkspace timeline
 * GET  /payroll/runs/stats        — PayrollWorkspace command header
 * GET  /payroll/events            — PayrollWorkspace timeline
 * GET  /payroll/compliance/stats  — StatutoryDashboard compliance header
 * GET  /payroll/reconciliation    — PayrollReconciliation page
 * GET  /ops/health                — OperationsWorkspace command header
 * GET  /ops/events                — OperationsWorkspace timeline
 */

import type { FastifyInstance } from 'fastify'
import type { SupabaseClient }  from '@supabase/supabase-js'
import { buildActivePeriodSummary, buildLatestDaySnapshot } from '../../lib/attendance-read-model.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate }  from '../../lib/org-context.js'

/**
 * "Today" in the tenant's own timezone, not the server's (UTC) clock —
 * otherwise near local midnight these HR-admin dashboards report the wrong
 * calendar day/month for staffing pressure, overnight issues, and payroll
 * variance/reconciliation default views (ISSUE-154 class).
 */
async function tenantTodayStr(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

// `${month}-31` is an invalid date literal for the 5 of 12 months with fewer
// than 31 days (Feb, Apr, Jun, Sep, Nov) — Postgres has no lenient date
// parsing, so a bare .lte('date', `${month}-31`) throws for those months
// instead of just clamping. Compute the real last day of the month instead
// (matches the fix already applied in routes/payroll/arrears.ts).
function monthEndDate(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

export default async function workspaceStatsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── Helper ───────────────────────────────────────────────────────────────────
  function requireHR(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /onboarding/stats ────────────────────────────────────────────────────
  // WorkforceWorkspace command header: pending, HR review, SLA breaches, duplicates, etc.
  fastify.get('/onboarding/stats', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      pendingResult,
      hrReviewResult,
      slaBreachResult,
      duplicateResult,
      confidenceResult,
      completedTodayResult,
      completedWeekResult,
    ] = await Promise.all([
      // total_pending: any non-archived, non-completed session
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['draft_ready', 'hr_review', 'processing', 'pending']),

      // hr_review_pending: specifically awaiting HR action
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['draft_ready', 'hr_review']),

      // sla_breached: sessions older than 3 days still in review
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['draft_ready', 'hr_review'])
        .lt('created_at', new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()),

      // duplicate_risk: profiles with duplicate_risk set
      fastify.supabase
        .from('draft_employee_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .not('duplicate_risk', 'is', null),

      // confidence_warnings: profiles with overall_confidence < 0.7
      fastify.supabase
        .from('draft_employee_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .lt('overall_confidence', 0.7),

      // completed_today: sessions moved to employee_created today
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'employee_created')
        .gte('updated_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()),

      // throughput_7d: completed in the past week
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'employee_created')
        .gte('updated_at', weekAgo),

    ])

    // payroll_backlog: active employees with no active compensation record.
    // Paginated separately (fetchAllRows, not a plain .select()) — this query
    // filters on a joined table's null column, which can't combine with
    // count:exact/head:true the way the other stats above do, so it fetches
    // full rows and counts client-side. Left unpaginated, that count was
    // silently capped at PostgREST's 1,000-row ceiling for a large tenant.
    const payrollBacklogRows = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('employees')
        .select('id, employee_compensations!left(id)')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_compensations.id', null)
        .range(from, to),
    )

    return reply.send({
      total_pending:       pendingResult.count        ?? 0,
      hr_review_pending:   hrReviewResult.count       ?? 0,
      sla_breached:        slaBreachResult.count      ?? 0,
      duplicate_risk:      duplicateResult.count      ?? 0,
      confidence_warnings: confidenceResult.count     ?? 0,
      completed_today:     completedTodayResult.count ?? 0,
      throughput_7d:       completedWeekResult.count  ?? 0,
      payroll_backlog:     payrollBacklogRows.length,
    })
  })

  // ── GET /onboarding/events ───────────────────────────────────────────────────
  // WorkforceWorkspace intelligence timeline: recent onboarding events
  fastify.get('/onboarding/events', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId
    const limit = Math.min(Number((req.query as any).limit ?? 15), 50)

    const { data: sessions } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id, candidate_name, status, updated_at, created_at')
      .eq('tenant_id', tenantId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(limit)

    const severityMap: Record<string, string> = {
      employee_created: 'success',
      hr_review:        'warning',
      draft_ready:      'info',
      rejected:         'critical',
      processing:       'neutral',
    }

    const events = (sessions ?? []).map((s: any) => ({
      id:            s.id,
      event_type:    s.status,
      session_id:    s.id,
      employee_name: s.candidate_name,
      timestamp:     s.updated_at ?? s.created_at,
      severity:      severityMap[s.status] ?? 'neutral',
      detail:        `Session status: ${s.status}`,
    }))

    return reply.send({ data: events })
  })

  // ── GET /employees/overview ──────────────────────────────────────────────────
  // WorkforceWorkspace secondary metrics strip
  fastify.get('/employees/overview', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const [activeResult, inactiveResult, missingBankResult, missingDocsResult] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),

      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'inactive'),

      // missing_compliance: active employees without bank_statutory record
      fastify.supabase
        .from('employees')
        .select(`id, employee_bank_statutory!left(id)`, { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_bank_statutory.id', null),

      // missing_documents: active employees with zero documents uploaded
      fastify.supabase
        .from('employees')
        .select('id, documents!left(id)', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('documents.id', null),
    ])

    return reply.send({
      active_employees:    activeResult.count   ?? 0,
      pending_activations: inactiveResult.count ?? 0,
      missing_compliance:  missingBankResult.count ?? 0,
      missing_documents:   missingDocsResult.count ?? 0,
    })
  })

  // ── GET /attendance/stats ────────────────────────────────────────────────────
  // AttendanceWorkspace command header
  //
  // All attendance aggregation is delegated to buildActivePeriodSummary() which
  // internally calls buildMonthReadModel() — no inline status reducers here.
  // No date=today attendance queries — the active period is determined by the
  // most recent data in attendance_daily, not the current calendar date.
  fastify.get('/attendance/stats', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const today        = await tenantTodayStr(fastify.supabase, tenantId)
    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [
      anomaliesResult,
      correctionsResult,
      overnightResult,
      confidenceResult,
      processorResult,
      staffingPressureResult,
      recentRegResult,
      missingCompResult,
      activePeriodResult,
      daySnapshotResult,
    ] = await Promise.all([
      // unresolved_anomalies
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('resolved', false),

      // pending_corrections
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),

      // overnight_issues: late_minutes > 120 today (night-shift proxy — operational signal)
      fastify.supabase
        .from('attendance_daily')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .gt('late_minutes', 120),

      // confidence_warnings: low_confidence anomalies
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('resolved', false)
        .eq('type', 'low_confidence'),

      // is_processing: check lock table
      fastify.supabase
        .from('attendance_processing_lock')
        .select('is_running')
        .eq('tenant_id', tenantId)
        .maybeSingle(),

      // staffing_pressure: employees absent/on-leave in today's date
      // Returns 0 when data is historical (correct — no one is absent "today")
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .in('status', ['absent', 'leave']),

      // recompute_backlog: regularisations approved in last 24h
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .gte('approved_at', recentCutoff),

      // payroll_continuity_gaps: active employees with no active compensation
      fastify.supabase
        .from('employees')
        .select(`id, employee_compensations!left(id, is_active)`, { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_compensations.is_active', null),

      // ── CANONICAL ATTENDANCE AGGREGATION ────────────────────────────────────
      // Finds the most recent month with data, builds a full month read model,
      // returns ActivePeriodSummary.  This is the ONLY attendance count source
      // for all dashboard widgets.  Zero inline reducers.
      buildActivePeriodSummary(fastify.supabase, tenantId),
      // Live/"today" headcount snapshot (latest day with data) — drives the
      // AttendanceWorkspace Live tab so "Present Today" is a real headcount,
      // not a month-wide sum of present-days.
      buildLatestDaySnapshot(fastify.supabase, tenantId),
    ])

    const activePeriod = 'error' in activePeriodResult ? null : activePeriodResult
    const daySnapshot  = 'error' in daySnapshotResult ? null : daySnapshotResult

    return reply.send({
      // Operational metrics (action queue, processing health)
      unresolved_anomalies:    anomaliesResult.count    ?? 0,
      pending_corrections:     correctionsResult.count  ?? 0,
      staffing_pressure:       staffingPressureResult.count ?? 0,
      overnight_issues:        overnightResult.count    ?? 0,
      confidence_warnings:     confidenceResult.count   ?? 0,
      recompute_backlog:       recentRegResult.count    ?? 0,
      payroll_continuity_gaps: missingCompResult.count ?? 0,
      is_processing:           processorResult.data?.is_running ?? false,
      // Canonical attendance period — the ONLY source for all KPI widgets
      // Non-null unless there is a DB error.  is_historical=true when data is
      // from a past month (e.g., imported 2025 data viewed in 2026).
      active_period_summary:  activePeriod,
      active_period_month:    activePeriod?.active_month ?? null,
      // Per-day live headcount for the Workspace Live tab / "Present Today" KPI.
      today_snapshot:         daySnapshot,
    })
  })

  // ── GET /attendance/events ───────────────────────────────────────────────────
  // AttendanceWorkspace intelligence timeline
  fastify.get('/attendance/events', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId
    const limit = Math.min(Number((req.query as any).limit ?? 15), 50)

    const { data: auditRows } = await fastify.supabase
      .from('attendance_audit_log')
      .select(`
        id, date, source, after_status, created_at,
        employees!inner(first_name, last_name, employee_code)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit)

    const severityMap: Record<string, string> = {
      present:    'success',
      absent:     'critical',
      late:       'warning',
      leave:      'info',
      half_day:   'info',
    }

    const events = (auditRows ?? []).map((r: any) => ({
      id:            r.id,
      event_type:    `${r.source}_${r.after_status}`,
      employee_name: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
      timestamp:     r.created_at,
      severity:      severityMap[r.after_status] ?? 'neutral',
      detail:        `${r.date} · ${r.after_status} (${r.source})`,
    }))

    return reply.send({ data: events })
  })

  // ── GET /attendance/live-status ──────────────────────────────────────────────
  // Returns employees sorted by anomaly risk (late_minutes desc) for the most
  // recent date that has data.  Falls back to empty array if table is empty.
  fastify.get('/attendance/live-status', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId
    const limit = Math.min(Number((req.query as any).limit ?? 10), 50)

    try {
      // Find most recent date with data
      const { data: latestRow } = await fastify.supabase
        .from('attendance_daily')
        .select('date')
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!latestRow?.date) return reply.send({ data: [] })

      const { data: rows } = await fastify.supabase
        .from('attendance_daily')
        .select(`
          employee_id, status, late_minutes,
          employees!inner(first_name, last_name, employee_code)
        `)
        .eq('tenant_id', tenantId)
        .eq('date', latestRow.date)
        .order('late_minutes', { ascending: false })
        .limit(limit)

      const result = ((rows ?? []) as any[]).map(r => {
        const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
        return {
          employee_id:   r.employee_id,
          employee_name: emp ? `${emp.first_name} ${emp.last_name}` : r.employee_id,
          employee_code: emp?.employee_code ?? '',
          status:        r.status ?? 'unknown',
          anomaly_risk:  Math.min(100, Math.round((r.late_minutes ?? 0) / 2)),
        }
      })

      return reply.send({ data: result })
    } catch {
      return reply.send({ data: [] })
    }
  })

  // ── GET /payroll/runs/stats ──────────────────────────────────────────────────
  // PayrollWorkspace command header
  fastify.get('/payroll/runs/stats', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const todayStr     = await tenantTodayStr(fastify.supabase, tenantId)
    const currentMonth = todayStr.slice(0, 7)
    // Previous month for variance comparison
    const [curY, curM] = currentMonth.split('-').map(Number)
    const prevDate     = new Date(Date.UTC(curY, curM - 2, 1, 12))
    const prevMonth    = prevDate.toISOString().slice(0, 7)

    const [
      latestRunResult,
      blockersResult,
      anomaliesResult,
      // deduction_gaps: active employees with pt_applicable=true (using employee_bank_statutory)
      ptaxGapResult,
      // pending_validations: payroll validation issues (failed entries)
      validationIssuesResult,
    ] = await Promise.all([
      // Latest run for current month — intentionally .limit(1), not a full-dataset query
      fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, employee_count')
        .eq('tenant_id', tenantId)
        .eq('month', currentMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Blockers: active employees missing active compensation record.
      // Use count:exact + head:true — avoids fetching rows and the 1000-row PostgREST cap.
      fastify.supabase
        .from('employees')
        .select(`id, employee_compensations!left(id, is_active)`, { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_compensations.is_active', null),

      // Unresolved anomalies — already uses count:exact + head:true (correct)
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('resolved', false),

      // deduction_gaps: ACTIVE employees with pt_applicable=true — the join's
      // own comment already claimed this scope, but the query had no active
      // filter at all, inflating the count with terminated employees' stale
      // pt_applicable=true rows.
      fastify.supabase
        .from('employee_bank_statutory')
        .select('id, employees!inner(status)', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('pt_applicable', true)
        .eq('employees.status', 'active'),

      // Pending validation issues
      fastify.supabase
        .from('payroll_validation_results')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'fail')
        .eq('auto_resolved', false),
    ])

    // These three queries touch tables that exceed 1000 rows at scale — must use fetchAllRows.
    const [statRows, otRows, currentSlipsRows, prevSlipsRows] = await Promise.all([
      // compliance_mismatches: statutory records missing PAN or UAN
      fetchAllRows<{ id: string; pan_number: string | null; uan_number: string | null }>((from, to) =>
        fastify.supabase
          .from('employee_bank_statutory')
          .select('id, pan_number, uan_number')
          .eq('tenant_id', tenantId)
          .range(from, to)
      ),
      // ot_mismatches: distinct employees with overtime this month
      fetchAllRows<{ employee_id: string }>((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id')
          .eq('tenant_id', tenantId)
          .gte('date', `${currentMonth}-01`)
          .lte('date', monthEndDate(currentMonth))
          .gt('overtime_minutes', 0)
          .range(from, to)
      ),
      // Current month slips for variance comparison
      fetchAllRows<{ employee_id: string; gross_pay: number }>((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select('employee_id, gross_pay')
          .eq('tenant_id', tenantId)
          .eq('month', currentMonth)
          .range(from, to)
      ),
      // Previous month slips for variance comparison
      fetchAllRows<{ employee_id: string; gross_pay: number }>((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select('employee_id, gross_pay')
          .eq('tenant_id', tenantId)
          .eq('month', prevMonth)
          .range(from, to)
      ),
    ])

    const run     = latestRunResult.data as any
    const isFrozen = run?.status === 'finalized'

    // Blockers = employees missing active compensation (real count, not capped array length)
    const blockers = blockersResult.count ?? 0

    // compliance_mismatches: statutory records missing PAN or UAN
    const complianceMismatches = statRows.filter(
      (r) => !r.pan_number?.trim() || !r.uan_number?.trim()
    ).length

    // ot_mismatches: distinct employees with overtime days this month
    const otEmpSet = new Set(otRows.map((r) => r.employee_id))
    const otMismatches = otEmpSet.size

    // variance_cases: employees whose gross changed by >10% vs previous month
    const currentSlips = new Map(currentSlipsRows.map(
      (r) => [r.employee_id, Number(r.gross_pay ?? 0)]
    ))
    const prevSlips = new Map(prevSlipsRows.map(
      (r) => [r.employee_id, Number(r.gross_pay ?? 0)]
    ))
    let varianceCases = 0
    for (const [empId, currentGross] of currentSlips) {
      const prevGross = prevSlips.get(empId) ?? 0
      if (prevGross > 0 && Math.abs(currentGross - prevGross) / prevGross > 0.10) {
        varianceCases++
      }
    }

    return reply.send({
      blockers,
      failed_payouts:          0,  // requires bank disbursement tracking table
      compliance_mismatches:   complianceMismatches,
      reconciliation_open:     blockers > 0 ? blockers : 0,
      pending_validations:     (validationIssuesResult.count ?? 0) + blockers,
      is_frozen:               isFrozen,
      unresolved_anomalies:    anomaliesResult.count ?? 0,
      current_run_month:       currentMonth,
      ot_mismatches:           otMismatches,
      variance_cases:          varianceCases,
      failed_bank_transfers:   0,  // requires bank transfer log table
      deduction_gaps:          ptaxGapResult.count ?? 0,
    })
  })

  // ── GET /payroll/events ──────────────────────────────────────────────────────
  // PayrollWorkspace intelligence timeline
  fastify.get('/payroll/events', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId
    const limit = Math.min(Number((req.query as any).limit ?? 15), 50)

    const { data: runs } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(limit)

    const severityMap: Record<string, string> = {
      completed:  'success',
      finalized:  'success',
      processing: 'info',
      draft:      'neutral',
      failed:     'critical',
      error:      'critical',
    }

    const events = (runs ?? []).map((r: any) => ({
      id:            r.id,
      event_type:    `payroll_run_${r.status}`,
      employee_name: null,
      timestamp:     r.updated_at ?? r.created_at,
      severity:      severityMap[r.status] ?? 'neutral',
      detail:        `${r.month} · ${r.employee_count ?? 0} employees · ${r.status}`,
    }))

    return reply.send({ data: events })
  })

  // ── GET /payroll/compliance/stats ────────────────────────────────────────────
  // StatutoryDashboard compliance header
  fastify.get('/payroll/compliance/stats', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    // Count active employees for coverage baseline
    const { count: totalActive } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    const active = totalActive ?? 0

    // EPF/ESI/PAN/PTAX: fetch statutory rows for ACTIVE employees only (table
    // exceeds 1000 rows at scale). employee_bank_statutory rows persist for
    // terminated employees (no cascade beyond the employees FK itself), so
    // without this join a terminated employee's stale filled-in statutory
    // data would count toward *Covered while `active` (the denominator) only
    // counts active employees — inflating coverage and masking real gaps
    // among active staff (can even push *Missing = max(0, active - covered)
    // to 0 when it shouldn't be).
    const epfRows = await fetchAllRows<{
      id: string; uan_number: string | null; esi_number?: string | null
      pan_number?: string | null; pt_applicable?: boolean | null
    }>((from, to) =>
      fastify.supabase
        .from('employee_bank_statutory')
        .select('id, uan_number, esi_number, pan_number, pt_applicable, employees!inner(status)')
        .eq('tenant_id', tenantId)
        .eq('employees.status', 'active')
        .range(from, to)
    )

    const epfCovered = epfRows.filter((r) => r.uan_number && r.uan_number.trim()).length
    const epfMissing  = Math.max(0, active - epfCovered)

    // ESI: employees with ESI number set (proxy for ESI coverage)
    const esiCovered = epfRows.filter((r) => r.esi_number && r.esi_number.trim()).length
    const esiMissing  = Math.max(0, active - esiCovered)

    // PAN: employees with PAN set (proxy for TDS coverage)
    const panCovered = epfRows.filter((r) => r.pan_number && r.pan_number.trim()).length
    const panMissing  = Math.max(0, active - panCovered)

    // PTAX: PT applicable flag
    const ptaxCovered = epfRows.filter((r) => r.pt_applicable === true).length
    const ptaxMissing  = 0 // PTAX coverage depends on state rules, not employee count

    // EPF filing gaps: payroll runs this year that aren't finalized (proxy for unfiled challans)
    const currentYear = new Date().getFullYear()
    const { data: payrollRuns } = await fastify.supabase
      .from('payroll_runs')
      .select('month, status')
      .eq('tenant_id', tenantId)
      .gte('month', `${currentYear}-01`)
      .lte('month', `${currentYear}-12`)

    const filingGaps = (payrollRuns ?? []).filter((r: any) => r.status !== 'finalized').length

    const nextDeadline = new Date()
    nextDeadline.setDate(15) // EPF deadline is typically 15th of each month
    if (nextDeadline <= new Date()) nextDeadline.setMonth(nextDeadline.getMonth() + 1)
    const daysToDeadline = Math.ceil((nextDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

    const epfReady  = epfMissing === 0 && filingGaps === 0
    const esiReady  = esiMissing === 0
    const ptaxReady = ptaxMissing === 0
    const tdsReady  = panMissing === 0

    return reply.send({
      epf: {
        employees_covered:  epfCovered,
        employees_missing:  epfMissing,
        filing_gaps:        filingGaps,
        computation_errors: 0,
        next_deadline:      nextDeadline.toISOString().slice(0, 10),
        days_to_deadline:   daysToDeadline,
        is_ready:           epfReady,
      },
      esi: {
        employees_covered:  esiCovered,
        employees_missing:  esiMissing,
        filing_gaps:        0,
        computation_errors: 0,
        next_deadline:      nextDeadline.toISOString().slice(0, 10),
        days_to_deadline:   daysToDeadline,
        is_ready:           esiReady,
      },
      ptax: {
        employees_covered:  ptaxCovered,
        employees_missing:  ptaxMissing,
        filing_gaps:        0,
        computation_errors: 0,
        next_deadline:      null,
        days_to_deadline:   null,
        is_ready:           ptaxReady,
      },
      tds: {
        employees_covered:  panCovered,
        employees_missing:  panMissing,
        filing_gaps:        0,
        computation_errors: 0,
        next_deadline:      null,
        days_to_deadline:   null,
        is_ready:           tdsReady,
      },
      total_filing_gaps:        filingGaps,
      total_coverage_gaps:      epfMissing + esiMissing + panMissing,
      total_computation_errors: 0,
      critical_deadline_days:   daysToDeadline,
    })
  })

  // ── GET /payroll/reconciliation ──────────────────────────────────────────────
  // PayrollReconciliation page — produces { summary, items } shape
  fastify.get('/payroll/reconciliation', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId
    const month = ((req.query as any).month as string) ?? (await tenantTodayStr(fastify.supabase, tenantId)).slice(0, 7)

    // All five tables can exceed 1000 rows at scale — use fetchAllRows throughout.
    const [slips, attRows, otRows, statRows, actionRows] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select(`
            employee_id, lop_days, gross_pay,
            employees!inner(first_name, last_name, employee_code, department_id,
              departments(name))
          `)
          .eq('tenant_id', tenantId)
          .eq('month', month)
          .range(from, to)
      ),
      // Attendance LOP aggregated per employee
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, status, is_payable, overtime_minutes')
          .eq('tenant_id', tenantId)
          .gte('date', `${month}-01`)
          .lte('date', monthEndDate(month))
          .range(from, to)
      ),
      // OT records grouped by employee
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, overtime_minutes')
          .eq('tenant_id', tenantId)
          .gte('date', `${month}-01`)
          .lte('date', monthEndDate(month))
          .gt('overtime_minutes', 0)
          .range(from, to)
      ),
      // Compliance: employees missing PAN or UAN
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('employee_bank_statutory')
          .select('employee_id, pan_number, uan_number')
          .eq('tenant_id', tenantId)
          .range(from, to)
      ),
      // Persisted reconciliation actions for this month — latest action per item wins.
      fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('payroll_reconciliation_actions')
          .select('item_id, action_type, notes, actor_id, created_at')
          .eq('tenant_id', tenantId)
          .eq('month', month)
          .order('created_at', { ascending: false })
          .range(from, to)
      ),
    ])

    // ── Build latest-action map (item_id → latest persisted action) ───────────
    // Rows are already ordered DESC by created_at so the first row per item_id
    // is the most recent action.
    const ACTION_STATUS: Record<string, string> = {
      acknowledge: 'acknowledged',
      escalate:    'escalated',
      resolve:     'resolved',
    }
    const latestActionMap = new Map<string, { status: string; notes: string | null; actor_id: string | null; created_at: string }>()
    for (const row of actionRows) {
      if (!latestActionMap.has(row.item_id)) {
        latestActionMap.set(row.item_id, {
          status:     ACTION_STATUS[row.action_type] ?? 'open',
          notes:      row.notes ?? null,
          actor_id:   row.actor_id ?? null,
          created_at: row.created_at,
        })
      }
    }

    // ── Aggregate attendance per employee ─────────────────────────────────────
    const attLopMap = new Map<string, number>()
    const attOtMap  = new Map<string, number>()
    for (const row of attRows) {
      const empId = row.employee_id
      if (row.status === 'absent') {
        attLopMap.set(empId, (attLopMap.get(empId) ?? 0) + 1)
      }
    }
    for (const row of otRows) {
      attOtMap.set(row.employee_id, (attOtMap.get(row.employee_id) ?? 0) + Number(row.overtime_minutes ?? 0))
    }

    // Compliance lookup by employee
    const compMap = new Map<string, { pan: string | null; uan: string | null }>()
    for (const r of statRows) {
      compMap.set(r.employee_id, { pan: r.pan_number ?? null, uan: r.uan_number ?? null })
    }

    function severity(variance: number, pct: number): 'critical' | 'high' | 'medium' | 'low' {
      const absVar = Math.abs(variance)
      const absPct = Math.abs(pct)
      if (absVar >= 3 || absPct >= 20) return 'critical'
      if (absVar >= 1 || absPct >= 10) return 'high'
      if (absVar >= 0.5 || absPct >= 5) return 'medium'
      return 'low'
    }

    // ── Build reconciliation items ─────────────────────────────────────────────
    const items: any[] = []
    let itemIdx = 0

    for (const slip of slips) {
      const empId   = slip.employee_id
      const emp     = slip.employees ?? {}
      const name    = emp.first_name ? `${emp.first_name} ${emp.last_name}` : 'Unknown'
      const code    = emp.employee_code ?? ''
      const dept    = emp.departments?.name ?? ''
      const slipLop = Number(slip.lop_days ?? 0)
      const attLop  = attLopMap.get(empId) ?? 0

      // 1. LOP mismatch (attendance vs payroll slip)
      if (slipLop !== attLop) {
        const variance = slipLop - attLop
        const pct      = attLop > 0 ? (variance / attLop) * 100 : 100
        items.push({
          id:             `lop-${empId}-${itemIdx++}`,
          employee_id:    empId,
          employee_name:  name,
          employee_code:  code,
          department:     dept,
          category:       'attendance',
          description:    `LOP days: payroll shows ${slipLop} day${slipLop !== 1 ? 's' : ''}, attendance records ${attLop} day${attLop !== 1 ? 's' : ''}`,
          payroll_value:  slipLop,
          expected_value: attLop,
          variance:       parseFloat(variance.toFixed(2)),
          variance_pct:   parseFloat(pct.toFixed(1)),
          severity:       severity(variance, pct),
          status:         'open',
          month,
          notes:          null,
        })
      }

      // 2. OT present in attendance but payroll may not account for it
      const totalOtMinutes = attOtMap.get(empId) ?? 0
      if (totalOtMinutes >= 30) {
        const otHours = parseFloat((totalOtMinutes / 60).toFixed(2))
        items.push({
          id:             `ot-${empId}-${itemIdx++}`,
          employee_id:    empId,
          employee_name:  name,
          employee_code:  code,
          department:     dept,
          category:       'overtime',
          description:    `${otHours}h overtime recorded in attendance — verify payroll inclusion`,
          payroll_value:  0,
          expected_value: otHours,
          variance:       -otHours,
          variance_pct:   -100,
          severity:       otHours >= 8 ? 'high' : 'medium',
          status:         'open',
          month,
          notes:          null,
        })
      }

      // 3. Compliance gaps (PAN/UAN missing)
      const comp = compMap.get(empId)
      if (comp) {
        const missingFields: string[] = []
        if (!comp.pan?.trim()) missingFields.push('PAN')
        if (!comp.uan?.trim()) missingFields.push('UAN')
        if (missingFields.length > 0) {
          items.push({
            id:             `comp-${empId}-${itemIdx++}`,
            employee_id:    empId,
            employee_name:  name,
            employee_code:  code,
            department:     dept,
            category:       'compliance',
            description:    `Missing statutory identifier(s): ${missingFields.join(', ')} — TDS/EPF filing blocked`,
            payroll_value:  0,
            expected_value: missingFields.length,
            variance:       missingFields.length,
            variance_pct:   100,
            severity:       'high',
            status:         'open',
            month,
            notes:          null,
          })
        }
      }
    }

    // ── Enrich items with persisted lifecycle status ──────────────────────────
    // Overrides the computed 'open' default with the latest stored action for
    // each item. Also propagates the operator note and actor from the action row.
    for (const item of items) {
      const action = latestActionMap.get(item.id)
      if (action) {
        item.status     = action.status
        item.notes      = action.notes
        item.actor_id   = action.actor_id
        item.actioned_at = action.created_at
      }
    }

    // ── Build summary ─────────────────────────────────────────────────────────
    const countBySeverity = { critical: 0, high: 0, medium: 0, low: 0, ok: 0 }
    const countByCategory: Record<string, number> = {}
    let totalVarianceAbs = 0
    let resolvedCount    = 0
    for (const item of items) {
      countBySeverity[item.severity as keyof typeof countBySeverity]++
      countByCategory[item.category] = (countByCategory[item.category] ?? 0) + 1
      totalVarianceAbs += Math.abs(item.variance)
      if (item.status === 'resolved') resolvedCount++
    }

    const summary = {
      total_mismatches:   items.length,
      critical_count:     countBySeverity.critical,
      high_count:         countBySeverity.high,
      medium_count:       countBySeverity.medium,
      low_count:          countBySeverity.low,
      resolved_count:     resolvedCount,
      total_variance_abs: parseFloat(totalVarianceAbs.toFixed(2)),
      by_category:        countByCategory,
    }

    return reply.send({ summary, items })
  })

  // ── GET /ops/health ──────────────────────────────────────────────────────────
  // OperationsWorkspace command header
  fastify.get('/ops/health', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const escalationCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const last7d           = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      incidentsResult,
      inboxResult,
      jobFailuresResult,
      slaBreachLeaveResult,
      slaBreachRegResult,
      pendingLeaveResult,
      pendingRegResult,
    ] = await Promise.all([
      // Active incidents
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['open', 'investigating']),

      // Inbox pending
      fastify.supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('is_read', false),

      // job_failures: attendance processing runs that failed in last 7 days
      fastify.supabase
        .from('attendance_processing_runs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .not('error_message', 'is', null)
        .gte('started_at', last7d),

      // sla_breaches: leave requests pending > 3 days (no action taken)
      fastify.supabase
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'PENDING')
        .lte('created_at', escalationCutoff),

      // sla_breaches: regularisation requests pending > 3 days
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .lte('created_at', escalationCutoff),

      // pending_escalations: any pending leave this month (not necessarily stale)
      fastify.supabase
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'PENDING'),

      // pending_escalations: any pending regularisation
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),
    ])

    const slaBreaches       = (slaBreachLeaveResult.count ?? 0) + (slaBreachRegResult.count ?? 0)
    const pendingEscalations = (pendingLeaveResult.count ?? 0) + (pendingRegResult.count ?? 0)

    return reply.send({
      active_incidents:     incidentsResult.count   ?? 0,
      job_failures:         jobFailuresResult.count ?? 0,
      queue_pressure:       0,  // requires dedicated job queue metrics table
      sla_breaches:         slaBreaches,
      pending_escalations:  pendingEscalations,
      observability_alerts: 0,  // requires dedicated observability table
      inbox_pending:        inboxResult.count ?? 0,
      integration_errors:   0,  // requires integration event log table
      webhook_failures:     0,  // requires webhook delivery log table
    })
  })

  // ── GET /ops/events ──────────────────────────────────────────────────────────
  // OperationsWorkspace NOC timeline
  fastify.get('/ops/events', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId
    const limit = Math.min(Number((req.query as any).limit ?? 15), 50)

    const { data: incidents } = await fastify.supabase
      .from('operational_incidents')
      .select('id, title, severity, status, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(limit)

    const severityMap: Record<string, string> = {
      p1:       'critical',
      p2:       'critical',
      p3:       'warning',
      p4:       'info',
      critical: 'critical',
      high:     'warning',
      medium:   'info',
      low:      'neutral',
    }

    const events = (incidents ?? []).map((inc: any) => ({
      id:        inc.id,
      event_type: `incident_${inc.status}`,
      source:    'system_incidents',
      timestamp: inc.updated_at ?? inc.created_at,
      severity:  severityMap[inc.severity?.toLowerCase()] ?? 'neutral',
      detail:    inc.title ?? 'Incident',
    }))

    return reply.send({ data: events })
  })
}
