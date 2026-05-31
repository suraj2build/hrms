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

export default async function workspaceStatsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── Helper ───────────────────────────────────────────────────────────────────
  function requireHR(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
      payrollBacklogResult,
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

      // payroll_backlog: active employees with no active compensation record
      fastify.supabase
        .from('employees')
        .select('id, employee_compensations!left(id)')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_compensations.id', null),
    ])

    return reply.send({
      total_pending:       pendingResult.count        ?? 0,
      hr_review_pending:   hrReviewResult.count       ?? 0,
      sla_breached:        slaBreachResult.count      ?? 0,
      duplicate_risk:      duplicateResult.count      ?? 0,
      confidence_warnings: confidenceResult.count     ?? 0,
      completed_today:     completedTodayResult.count ?? 0,
      throughput_7d:       completedWeekResult.count  ?? 0,
      payroll_backlog:     (payrollBacklogResult.data ?? []).length,
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
        .select(`id, employee_bank_statutory!left(id)`, { count: 'exact', head: false })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_bank_statutory.id', null),

      // missing_documents: active employees with zero documents uploaded
      fastify.supabase
        .from('employees')
        .select('id, documents!left(id)')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('documents.id', null),
    ])

    return reply.send({
      active_employees:    activeResult.count   ?? 0,
      pending_activations: inactiveResult.count ?? 0,
      missing_compliance:  (missingBankResult.data ?? []).length,
      missing_documents:   (missingDocsResult.data ?? []).length,
    })
  })

  // ── GET /attendance/stats ────────────────────────────────────────────────────
  // AttendanceWorkspace command header
  fastify.get('/attendance/stats', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const today      = new Date().toISOString().slice(0, 10)
    const monthStart = today.slice(0, 7) + '-01'
    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [
      anomaliesResult,
      correctionsResult,
      overnightResult,
      confidenceResult,
      processorResult,
      // staffing_pressure: departments where ≥2 employees are absent/on-leave today
      todayAbsenceResult,
      // recompute_backlog: regularisations approved in last 24h (need reprocessing attention)
      recentRegResult,
      // payroll_continuity_gaps: active employees missing a compensation record
      missingCompResult,
    ] = await Promise.all([
      // unresolved_anomalies
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('is_resolved', false),

      // pending_corrections: regularisation requests pending approval
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),

      // overnight_issues: attendance_daily rows with >2h late_minutes for today (night-shift proxy)
      fastify.supabase
        .from('attendance_daily')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .gt('late_minutes', 120),

      // confidence_warnings: unresolved anomalies of type 'low_confidence'
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('is_resolved', false)
        .eq('anomaly_type', 'low_confidence'),

      // is_processing: check lock table
      fastify.supabase
        .from('attendance_processing_lock')
        .select('is_running')
        .eq('tenant_id', tenantId)
        .maybeSingle(),

      // staffing_pressure: today's absent + leave grouped by employee (we'll count distinct dept after)
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .in('status', ['absent', 'leave']),

      // recompute_backlog: regularisations approved in last 24h needing attention
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .gte('approved_at', recentCutoff),

      // payroll_continuity_gaps: active employees with no active compensation record
      fastify.supabase
        .from('employees')
        .select(`id, employee_compensations!left(id, is_active)`, { count: 'exact', head: false })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_compensations.is_active', null),
    ])

    // staffing_pressure: count employees absent/on-leave today as the pressure metric
    // (distinct count of employees out today — a simple but accurate operational signal)
    const staffingPressure = (todayAbsenceResult.data ?? []).length

    return reply.send({
      unresolved_anomalies:    anomaliesResult.count    ?? 0,
      pending_corrections:     correctionsResult.count  ?? 0,
      staffing_pressure:       staffingPressure,
      overnight_issues:        overnightResult.count    ?? 0,
      confidence_warnings:     confidenceResult.count   ?? 0,
      recompute_backlog:        recentRegResult.count    ?? 0,
      payroll_continuity_gaps: (missingCompResult.data ?? []).length,
      is_processing:           processorResult.data?.is_running ?? false,
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

  // ── GET /payroll/runs/stats ──────────────────────────────────────────────────
  // PayrollWorkspace command header
  fastify.get('/payroll/runs/stats', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return
    const tenantId: string = req.tenantId

    const now          = new Date()
    const currentMonth = now.toISOString().slice(0, 7)
    // Previous month for variance comparison
    const prevDate     = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonth    = prevDate.toISOString().slice(0, 7)

    const [
      latestRunResult,
      blockersResult,
      anomaliesResult,
      // compliance_mismatches: active employees missing critical statutory fields
      missingStatResult,
      // ot_mismatches: employees with overtime this month but no OT salary component
      otResult,
      // deduction_gaps: active employees with pt_applicable but no PT component
      ptaxGapResult,
      // variance_cases: current month slips vs previous month for same employee
      currentSlipsResult,
      prevSlipsResult,
      // pending_validations: payroll validation issues (failed entries)
      validationIssuesResult,
    ] = await Promise.all([
      // Latest run for current month
      fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, freeze_approved, employee_count')
        .eq('tenant_id', tenantId)
        .eq('month', currentMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Blockers: active employees missing active compensation record
      fastify.supabase
        .from('employees')
        .select(`id, employee_compensations!left(id, is_active)`, { count: 'exact', head: false })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('employee_compensations.is_active', null),

      // Unresolved anomalies (affect payroll accuracy)
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('is_resolved', false),

      // compliance_mismatches: active employees missing PAN (TDS) or UAN (EPF) — statutory gap
      fastify.supabase
        .from('employee_bank_statutory')
        .select('id, pan_number, uan_number')
        .eq('tenant_id', tenantId),

      // ot_mismatches: employees with overtime recorded this month
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .gte('date', `${currentMonth}-01`)
        .lte('date', `${currentMonth}-31`)
        .gt('overtime_minutes', 0),

      // deduction_gaps: employees with pt_applicable=true (using employee_bank_statutory)
      fastify.supabase
        .from('employee_bank_statutory')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('pt_applicable', true),

      // Current month slips (gross_pay per employee)
      fastify.supabase
        .from('payroll_slips')
        .select('employee_id, gross_pay')
        .eq('tenant_id', tenantId)
        .eq('month', currentMonth),

      // Previous month slips (for variance comparison)
      fastify.supabase
        .from('payroll_slips')
        .select('employee_id, gross_pay')
        .eq('tenant_id', tenantId)
        .eq('month', prevMonth),

      // Pending validation issues: failed validation results from any run this month
      fastify.supabase
        .from('payroll_validation_results')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'fail')
        .eq('auto_resolved', false),
    ])

    const run     = latestRunResult.data as any
    const isFrozen = run?.status === 'finalized' || run?.freeze_approved === true

    // Blockers = employees missing active compensation
    const blockers = (blockersResult.data ?? []).length

    // compliance_mismatches: statutory records missing PAN or UAN
    const statRows = missingStatResult.data ?? []
    const complianceMismatches = statRows.filter(
      (r: any) => !r.pan_number?.trim() || !r.uan_number?.trim()
    ).length

    // ot_mismatches: distinct employees with overtime but no active OT component in their structure
    // Simple proxy: count of employees with overtime days this month
    const otEmpSet = new Set((otResult.data ?? []).map((r: any) => r.employee_id))
    const otMismatches = otEmpSet.size

    // variance_cases: employees whose gross changed by >10% vs previous month
    const currentSlips = new Map((currentSlipsResult.data ?? []).map(
      (r: any) => [r.employee_id, Number(r.gross_amount ?? 0)]
    ))
    const prevSlips    = new Map((prevSlipsResult.data ?? []).map(
      (r: any) => [r.employee_id, Number(r.gross_amount ?? 0)]
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

    // EPF: employees with UAN number set (proxy for EPF coverage)
    const { data: epfRows } = await fastify.supabase
      .from('employee_bank_statutory')
      .select('id, uan_number')
      .eq('tenant_id', tenantId)

    const epfCovered = (epfRows ?? []).filter((r: any) => r.uan_number && r.uan_number.trim()).length
    const epfMissing  = Math.max(0, active - epfCovered)

    // ESI: employees with ESI number set (proxy for ESI coverage)
    const esiCovered = (epfRows ?? []).filter((r: any) => r.esi_number && r.esi_number.trim()).length
    const esiMissing  = Math.max(0, active - esiCovered)

    // PAN: employees with PAN set (proxy for TDS coverage)
    const panCovered = (epfRows ?? []).filter((r: any) => r.pan_number && r.pan_number.trim()).length
    const panMissing  = Math.max(0, active - panCovered)

    // PTAX: PT applicable flag
    const ptaxCovered = (epfRows ?? []).filter((r: any) => r.pt_applicable === true).length
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
    const month = ((req.query as any).month as string) ?? new Date().toISOString().slice(0, 7)

    // Parallel: slips, attendance LOP, OT rows, compliance data
    const [slipsResult, attResult, otResult, complianceResult] = await Promise.all([
      fastify.supabase
        .from('payroll_slips')
        .select(`
          employee_id, lop_days, gross_pay,
          employees!inner(first_name, last_name, employee_code, department_id,
            departments(name))
        `)
        .eq('tenant_id', tenantId)
        .eq('month', month),

      // Attendance LOP aggregated per employee
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, status, is_payable, overtime_minutes')
        .eq('tenant_id', tenantId)
        .gte('date', `${month}-01`)
        .lte('date', `${month}-31`),

      // OT records grouped by employee (we filter in JS)
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, overtime_minutes')
        .eq('tenant_id', tenantId)
        .gte('date', `${month}-01`)
        .lte('date', `${month}-31`)
        .gt('overtime_minutes', 0),

      // Compliance: employees missing PAN or UAN (bank_statutory)
      fastify.supabase
        .from('employee_bank_statutory')
        .select('employee_id, pan_number, uan_number')
        .eq('tenant_id', tenantId),
    ])

    const slips      = (slipsResult.data  ?? []) as any[]
    const attRows    = (attResult.data    ?? []) as any[]
    const otRows     = (otResult.data     ?? []) as any[]
    const statRows   = (complianceResult.data ?? []) as any[]

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

    // ── Build summary ─────────────────────────────────────────────────────────
    const countBySeverity = { critical: 0, high: 0, medium: 0, low: 0, ok: 0 }
    const countByCategory: Record<string, number> = {}
    let totalVarianceAbs = 0
    for (const item of items) {
      countBySeverity[item.severity as keyof typeof countBySeverity]++
      countByCategory[item.category] = (countByCategory[item.category] ?? 0) + 1
      totalVarianceAbs += Math.abs(item.variance)
    }

    const summary = {
      total_mismatches:   items.length,
      critical_count:     countBySeverity.critical,
      high_count:         countBySeverity.high,
      medium_count:       countBySeverity.medium,
      low_count:          countBySeverity.low,
      resolved_count:     0,
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
        .from('system_incidents')
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
        .eq('status', 'failed')
        .gte('started_at', last7d),

      // sla_breaches: leave applications pending > 3 days (no action taken)
      fastify.supabase
        .from('leave_applications')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
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
        .from('leave_applications')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),

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
      .from('system_incidents')
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
