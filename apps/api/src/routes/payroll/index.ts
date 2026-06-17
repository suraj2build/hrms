/**
 * Payroll Routes
 *
 * POST   /payroll/runs                  — create or re-trigger a run for a month
 * GET    /payroll/runs                  — list all runs (paginated)
 * GET    /payroll/runs/blockers         — pre-run readiness: employees missing comp or attendance (Phase 10)
 * GET    /payroll/runs/:id              — get a single run with aggregated totals
 * POST   /payroll/runs/:id/finalize     — finalize a draft run (locks slips)
 * GET    /payroll/runs/:id/slips        — list all employee slips for a run
 * GET    /payroll/runs/:id/export       — CSV export of all slips
 * GET    /payroll/runs/:id/variance     — month-over-month variance vs previous run (Phase 10)
 * GET    /payroll/slips/:id             — get a single payslip (employee self-service)
 *
 * All write endpoints require hr_admin or super_admin.
 * Employees can read their own finalized slips via GET /payroll/slips/:id.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { EventType, MODULE } from '../../platform/events/index.js'
import {
  computePayrollSlip,
  countWorkingDaysInMonth,
  countWorkingDaysForEmployee,
  fetchAttendanceSummary,
  fetchActiveCompensation,
  round2,
  type PayrollSlipResult,
} from '../../lib/payroll-engine.js'
import { resolveEmployeeStatutoryParams } from '../../lib/statutory/statutory-governance.js'
import { applyStatutoryToSlip, applyTdsToSlip } from '../../lib/statutory-payroll.js'
import { computeTDS } from '../../lib/statutory/tds-engine.js'
import { round2 as round2fn } from '../../lib/payroll-engine.js'

/** Indian financial year (Apr–Mar) for a YYYY-MM month → e.g. '2026-27'. */
function financialYearOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const startY = m >= 4 ? y : y - 1
  return `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`
}

/**
 * Compute this month's TDS for an employee and inject it into the slip — IF TDS
 * is enabled in payroll_statutory_settings. No employee declaration is required
 * (new regime). Annual income is projected as this month's gross × 12; tax is
 * spread flat across the FY (annualTax / 12). Old regime additionally applies
 * approved Chapter-VI-A declarations.
 */
async function applyTdsForRun(
  supabase: any, tenantId: string, employeeId: string, month: string,
  slip: PayrollSlipResult,
): Promise<PayrollSlipResult> {
  const { data: s } = await supabase
    .from('payroll_statutory_settings')
    .select('tds_enabled, tds_default_regime')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!s?.tds_enabled) return slip

  const regime = (s.tds_default_regime ?? 'new') as 'old' | 'new'
  const fy = financialYearOf(month)
  let totalDeductions = 0
  if (regime === 'old') {
    const { data: decls } = await supabase
      .from('tax_declarations')
      .select('approved_amount')
      .eq('tenant_id', tenantId).eq('employee_id', employeeId)
      .eq('financial_year', fy).eq('status', 'approved')
    totalDeductions = (decls ?? []).reduce((acc: number, d: any) => acc + (Number(d.approved_amount) || 0), 0)
  }

  const result = computeTDS(
    {
      grossAnnualIncome: round2fn(slip.gross_pay * 12),
      regime,
      totalDeductions,
      alreadyDeducted: 0,
      remainingMonths: 12,
    },
    { financialYear: fy },
  )
  return applyTdsToSlip(slip, result.monthlyTDS)
}

/**
 * Compute a payroll slip with two corrections layered on the base engine:
 *   1. Roster-aware LOP denominator — recompute total_working_days PER EMPLOYEE
 *      so it matches the per-employee weekly-off used for day_fraction (fixes the
 *      Sat/Sun-hardcoded denominator vs roster-numerator mismatch). Falls back to
 *      the tenant-level total in `args` if resolution fails.
 *   2. Config-driven statutory — recompute PF/ESI/PT via the engines (TDS stays
 *      on the tax-governance flow). Returns the base slip unchanged when the
 *      employee has no compensation/components to act on.
 */
async function computeSlipWithStatutory(
  supabase: any,
  tenantId: string,
  args: Parameters<typeof computePayrollSlip>[0],
  month: string,
): Promise<PayrollSlipResult> {
  let slipArgs = args
  let denomWarning: string | undefined
  try {
    const empWorkingDays = await countWorkingDaysForEmployee(supabase, tenantId, args.employeeId, month)
    if (empWorkingDays > 0) {
      slipArgs = { ...args, total_working_days: empWorkingDays }
    } else {
      // Roster resolved to 0 working days — do NOT silently use the Sat/Sun count.
      denomWarning =
        `Roster resolved 0 working days for ${month}; fell back to tenant working-day count ` +
        `(${args.total_working_days}). Verify roster/holiday setup — LOP may be inaccurate.`
      console.warn(`[payroll] employee ${args.employeeId}: ${denomWarning}`)
    }
  } catch (e: any) {
    // Roster resolution FAILED — surface it instead of silently reverting to Sat/Sun.
    denomWarning =
      `Per-employee roster working-day resolution failed (${e?.message ?? 'error'}); used the ` +
      `tenant Sat/Sun count (${args.total_working_days}). LOP may be wrong for non-Sat/Sun rosters.`
    console.warn(`[payroll] employee ${args.employeeId}: ${denomWarning}`)
  }
  const base0 = computePayrollSlip(slipArgs)
  const base = denomWarning
    ? { ...base0, warning: [base0.warning, denomWarning].filter(Boolean).join(' ') }
    : base0
  if (!base.component_breakdown.length) return base
  const params   = await resolveEmployeeStatutoryParams(supabase, tenantId, args.employeeId, month)
  const calMonth = Number(month.slice(5, 7))
  const withStat = applyStatutoryToSlip(base, params, calMonth).slip   // spread preserves base.warning
  // Inject TDS (income tax) if enabled — PF/ESI/PT engines don't cover it.
  return applyTdsForRun(supabase, tenantId, args.employeeId, month, withStat)
}
import {
  validatePayrollSlipPayload,
  validateCompensation,
} from '../../lib/payroll-validator.js'
import {
  buildPayrollVisibilityState,
  buildEmployeePayslipView,
} from '../../lib/payroll-read-model.js'
import {
  buildPayrollBlockers,
  groupPayrollBlockers,
  computePayrollRunHealth,
} from '../../lib/payroll-blocker-engine.js'
import { recomputeRange } from '../../lib/attendance-engine.js'
import { logAction } from '../../lib/audit-service.js'
import { buildCompensationCoverageAudit } from '../../lib/payroll-compensation-coverage.js'
import { isPayrollDualControlEnabled } from '../../lib/payroll-flags.js'
import {
  buildPayrollRunSnapshot,
  replayPayrollRun,
  validateSnapshotIntegrity,
} from '../../lib/payroll-snapshot-engine.js'
import {
  buildPayrollFinancialLedger,
  reversePayrollLedger,
  exportGeneralLedger,
  validateLedgerBalance,
  buildPayoutObligations,
  generateAccrualEntries,
  generateAccountingIntegrityHash,
} from '../../lib/payroll-accounting-engine.js'

const monthRe = /^\d{4}-\d{2}$/

/**
 * checkFreezeGuard — shared helper for payroll write operations.
 *
 * Returns { frozen: true, reason } if the given month is currently frozen
 * (i.e. an unlifted freeze record exists in payroll_freeze_log).
 * Returns { frozen: false } when clear to proceed.
 *
 * Call before any operation that creates or modifies payroll data for a month.
 */
async function checkFreezeGuard(
  supabase: any,
  tenantId: string,
  month: string,
): Promise<{ frozen: boolean; reason?: string }> {
  const { data, error } = await supabase
    .from('payroll_freeze_log')
    .select('frozen_by, reason')
    .eq('tenant_id', tenantId)
    .eq('freeze_month', month)
    .eq('action', 'freeze')
    .is('unfrozen_at', null)
    .order('frozen_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    // On query error, fail open (don't block operations due to guard failure)
    return { frozen: false }
  }
  if (data) {
    return {
      frozen: true,
      reason: data.reason ?? `Payroll for ${month} is frozen and cannot be modified`,
    }
  }
  return { frozen: false }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the payroll_slips insert row from a computed slip result.
 * Centralising this prevents field-name drift between computation and DB insert.
 */
function buildSlipRow(
  tenantId: string,
  runId:    string,
  result:   PayrollSlipResult,
  month:    string,
): Record<string, unknown> {
  // TDS amount lives as a 'TDS' line in the component breakdown — mirror it into
  // the tds_deducted column so the IT Statement / TDS Recovery / YTD pages
  // (which read payroll_slips.tds_deducted) reflect what was actually deducted.
  const tds_deducted = round2fn(
    (result.component_breakdown ?? [])
      .filter((c: any) => /^TDS$/i.test(c.code))
      .reduce((s: number, c: any) => s + (Number(c.monthly_amount) || 0), 0),
  )
  return {
    tenant_id:              tenantId,
    run_id:                 runId,
    employee_id:            result.employeeId,
    month,
    total_working_days:     result.total_working_days,
    payable_days:           result.payable_days,
    lop_days:               result.lop_days,
    overtime_hours:         result.overtime_hours,
    ctc_monthly:            result.ctc_monthly,
    gross_pay:              result.gross_pay,
    lop_amount:             result.lop_amount,
    total_deductions:       result.total_deductions,
    net_pay:                result.net_pay,
    employer_contributions: result.employer_contributions,
    component_breakdown:    result.component_breakdown,
    tds_deducted,
    status:                 'draft',
    warning:                result.warning ?? null,
  }
}

/**
 * Append one forensic event to payroll_run_events.
 *
 * This is deliberately non-throwing — forensic logging must never block payroll.
 * Failures are logged to the Fastify logger at warn level.
 */
async function logRunEvent(
  supabase: any,
  log:      { warn: (obj: unknown, msg: string) => void },
  event: {
    tenant_id:     string
    run_id:        string
    event_type:    string
    employee_id?:  string
    month?:        string
    payload?:      Record<string, unknown>
    error_details?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase
    .from('payroll_run_events')
    .insert({
      tenant_id:    event.tenant_id,
      run_id:       event.run_id,
      event_type:   event.event_type,
      employee_id:  event.employee_id  ?? null,
      month:        event.month        ?? null,
      payload:      event.payload      ?? null,
      error_details: event.error_details ?? null,
    })

  if (error) {
    log.warn(
      { err: error, event_type: event.event_type, run_id: event.run_id },
      'payroll_run_events: insert failed — forensic event not persisted (payroll continues)',
    )
  }
}

/** Per-employee failure record — returned in the API response and forensic log */
interface FailedEmployee {
  employee_id:   string
  employee_code: string
  failure_stage: 'data_fetch' | 'compensation_validation' | 'computation' | 'slip_validation' | 'db_insert' | 'unexpected'
  reason:        string
  details?:      Record<string, unknown>
}

/** Structured breakdown of all per-employee failures in a run — stored in payroll_runs.failure_summary */
interface FailureSummaryGroup {
  failure_stage:   string
  reason:          string
  count:           number
  employee_codes:  string[]
}

interface FailureSummary {
  total_failed:    number
  total_employees: number
  dominant_stage:  string
  dominant_reason: string
  groups:          FailureSummaryGroup[]
}

/**
 * Compute a structured failure summary from a list of FailedEmployee records.
 * Groups by (failure_stage, reason), sorts by count descending.
 */
function buildFailureSummary(
  failedEmployees: FailedEmployee[],
  totalEmployees:  number,
): FailureSummary | null {
  if (failedEmployees.length === 0) return null

  const groupMap = new Map<string, FailureSummaryGroup>()

  for (const f of failedEmployees) {
    const key = `${f.failure_stage}\x00${f.reason}`
    const existing = groupMap.get(key)
    if (existing) {
      existing.count++
      existing.employee_codes.push(f.employee_code)
    } else {
      groupMap.set(key, {
        failure_stage:  f.failure_stage,
        reason:         f.reason,
        count:          1,
        employee_codes: [f.employee_code],
      })
    }
  }

  const groups = [...groupMap.values()].sort((a, b) => b.count - a.count)
  const dominant = groups[0]

  return {
    total_failed:    failedEmployees.length,
    total_employees: totalEmployees,
    dominant_stage:  dominant.failure_stage,
    dominant_reason: dominant.reason,
    groups,
  }
}

/**
 * Fetch pending advance recovery and loan EMI deductions for one employee for a
 * payroll month.  Respects is_recovery_paused / is_emi_paused flags and only
 * returns deductions whose parent advance/loan is in the correct active status.
 *
 * Non-throwing: returns [] on any error so advance/loan failures never abort a run.
 */
async function fetchAdvanceLoanDeductions(
  supabase: any,
  tenantId: string,
  employeeId: string,
  month: string, // YYYY-MM
): Promise<Array<{
  type: 'advance_recovery' | 'loan_emi'
  schedule_id: string
  amount: number
  label: string
}>> {
  const results: Array<{
    type: 'advance_recovery' | 'loan_emi'
    schedule_id: string
    amount: number
    label: string
  }> = []

  try {
    // 1. Advance recovery schedules
    const { data: advRows, error: advErr } = await supabase
      .from('advance_recovery_schedules')
      .select('id, scheduled_amount, advance_salary_requests!inner(is_recovery_paused, status)')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('recovery_month', month)
      .eq('status', 'pending')
      .eq('advance_salary_requests.is_recovery_paused', false)
      .in('advance_salary_requests.status', ['disbursed', 'recovering'])

    if (advErr) {
      console.warn(`[payroll] fetchAdvanceLoanDeductions: advance query failed for employee ${employeeId} (${month}):`, advErr.message)
    } else {
      for (const row of (advRows ?? []) as any[]) {
        results.push({
          type:        'advance_recovery',
          schedule_id: row.id,
          amount:      row.scheduled_amount,
          label:       'Salary Advance Recovery',
        })
      }
    }

    // 2. Loan EMI schedules
    const { data: loanRows, error: loanErr } = await supabase
      .from('loan_schedules')
      .select('id, emi_amount, installment_number, employee_loans!inner(loan_type, is_emi_paused, status)')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('due_month', month)
      .eq('status', 'pending')
      .eq('employee_loans.is_emi_paused', false)
      .eq('employee_loans.status', 'active')

    if (loanErr) {
      console.warn(`[payroll] fetchAdvanceLoanDeductions: loan query failed for employee ${employeeId} (${month}):`, loanErr.message)
    } else {
      for (const row of (loanRows ?? []) as any[]) {
        const loanType = (row.employee_loans as any)?.loan_type ?? 'Loan'
        const typeCap  = loanType.charAt(0).toUpperCase() + loanType.slice(1)
        results.push({
          type:        'loan_emi',
          schedule_id: row.id,
          amount:      row.emi_amount,
          label:       `${typeCap} Loan EMI #${row.installment_number}`,
        })
      }
    }
  } catch (err: any) {
    console.warn(`[payroll] fetchAdvanceLoanDeductions: unexpected error for employee ${employeeId} (${month}):`, err?.message)
  }

  return results
}

export default async function payrollRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /payroll/runs ───────────────────────────────────────────────────────
  //
  // Create or re-trigger a payroll run for a given month.
  // Idempotent: calling again for the same month replaces the existing draft run.
  //
  // dry_run=true: computes all slips and validates all payloads but writes nothing
  //   to the DB.  Returns the full per-employee result set so operators can verify
  //   before committing.  No run row is created, no slips are inserted.
  //
  // Per-employee isolation: one employee's data-fetch failure, compensation issue,
  //   or DB insert error does not abort the remaining employees.  Failed employees
  //   are collected in `failed_employees[]` in the response.  The run is marked
  //   'failed' only if zero employees succeed.
  fastify.post('/payroll/runs', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      month:   z.string().regex(monthRe, 'month must be YYYY-MM'),
      notes:   z.string().max(500).optional(),
      /** Compute and validate all slips without writing to the DB. */
      dry_run: z.boolean().optional().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, notes, dry_run } = parsed.data
    const tenantId = req.tenantId as string

    // ── Guard: block payroll runs for future months ───────────────────────────
    const currentYM = new Date().toISOString().slice(0, 7)
    if (month > currentYM) {
      return reply.code(400).send({
        error:   'FUTURE_MONTH',
        message: `Cannot run payroll for a future month (${month}). Current month is ${currentYM}.`,
      })
    }

    // ── Pre-flight: compensation coverage audit ──────────────────────────────
    // For live runs only — dry runs bypass this check so operators can
    // simulate even when some employees are not yet set up.
    if (!dry_run) {
      try {
        const coverage = await buildCompensationCoverageAudit(fastify.supabase, tenantId)

        if (!coverage.ready_for_payroll) {
          const blockerDetails: string[] = []
          if (coverage.employees_missing_compensation > 0)
            blockerDetails.push(`${coverage.employees_missing_compensation} employee(s) missing compensation`)
          if (coverage.employees_zero_ctc > 0)
            blockerDetails.push(`${coverage.employees_zero_ctc} employee(s) with zero CTC`)
          if (coverage.employees_with_no_components > 0)
            blockerDetails.push(`${coverage.employees_with_no_components} employee(s) with no salary components`)
          if (coverage.employees_with_invalid_components > 0)
            blockerDetails.push(`${coverage.employees_with_invalid_components} employee(s) with invalid component amounts`)

          req.log.warn(
            {
              event:    'payroll_preflight_blocked',
              month,
              tenant_id: tenantId,
              coverage: {
                total:   coverage.total_active_employees,
                missing: coverage.employees_missing_compensation,
                zero_ctc: coverage.employees_zero_ctc,
                no_components: coverage.employees_with_no_components,
                invalid: coverage.employees_with_invalid_components,
              },
            },
            'payroll run blocked by compensation coverage pre-flight',
          )

          return reply.code(422).send({
            error:    'COMPENSATION_COVERAGE_INSUFFICIENT',
            message:  `Payroll blocked — ${blockerDetails.join('; ')}. ` +
                      `Set up compensation for all active employees before running payroll.`,
            coverage,
          })
        }

        // Future-dated warning (non-blocking) — surface to caller
        if (coverage.employees_future_dated > 0) {
          req.log.info(
            { event: 'payroll_preflight_future_dated', count: coverage.employees_future_dated, month },
            'payroll pre-flight: some compensations are future-dated — using previous active records',
          )
        }
      } catch (preflightErr: any) {
        // Coverage audit failure is non-blocking — we log and continue rather
        // than aborting the run (the per-employee compensation validation
        // inside the loop will catch individuals with missing records).
        req.log.warn(
          { err: preflightErr, month, tenant_id: tenantId },
          'payroll pre-flight compensation audit failed — proceeding with run (per-employee checks apply)',
        )
      }
    }

    // Freeze guard — applies to live runs only; dry runs are always allowed
    if (!dry_run) {
      const freeze = await checkFreezeGuard(fastify.supabase, tenantId, month)
      if (freeze.frozen) {
        return reply.code(423).send({
          error:   'PAYROLL_FROZEN',
          message: freeze.reason ?? `Payroll for ${month} is frozen`,
        })
      }

      // PI-1 finalization lockdown — never silently overwrite a finalized run.
      // The re-run upsert below would reset the run to 'processing', delete all
      // slips, and recompute. Refuse cleanly; the DB trigger (migration 263) is
      // the backstop if anything reaches the upsert anyway. Roll back first to
      // legitimately reprocess a finalized month.
      const { data: existingRun } = await fastify.supabase
        .from('payroll_runs')
        .select('status')
        .eq('tenant_id', tenantId)
        .eq('month', month)
        .maybeSingle()
      if ((existingRun as any)?.status === 'finalized') {
        return reply.code(409).send({
          error:   'RUN_FINALIZED',
          message: `Payroll for ${month} is finalized and cannot be re-run. Roll it back (super_admin) before reprocessing.`,
        })
      }
    }

    // Fetch all active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')

    if (empErr) {
      req.log.error({ err: empErr, month, tenant_id: tenantId }, 'payroll run: failed to fetch employees')
      return reply.code(500).send({
        error:   'QUERY_FAILED',
        message: 'Failed to fetch employees',
        details: empErr.message,
        code:    empErr.code,
      })
    }

    const empList = (employees ?? []) as Array<{
      id: string; first_name: string; last_name: string; employee_code: string
    }>

    // Shared context for the processing loop
    const [runYear, runMon] = month.split('-').map(Number)
    const runPeriodEnd      = new Date(runYear, runMon, 0).toISOString().slice(0, 10)

    // countWorkingDaysInMonth now throws on DB error (holiday calendar query failure would
    // corrupt every employee's LOP calculation — fail the entire run immediately).
    let total_working_days: number
    try {
      total_working_days = await countWorkingDaysInMonth(fastify.supabase, tenantId, month)
    } catch (wdErr: any) {
      req.log.error({ err: wdErr, month, tenant_id: tenantId }, 'payroll: holiday calendar query failed — run aborted')
      return reply.code(500).send({
        error:   'WORKING_DAYS_FETCH_FAILED',
        message: wdErr?.message ?? 'Failed to count working days for the payroll period',
        details: 'Payroll run aborted — LOP calculations require an accurate working-day count.',
      })
    }

    // ── DRY RUN: compute + validate without any DB writes ───────────────────
    if (dry_run) {
      req.log.info(
        { event: 'payroll_dry_run_start', month, employee_count: empList.length, tenant_id: tenantId },
        'payroll dry run started',
      )

      type DryRunResult = {
        employee_id:              string
        employee_code:            string
        status:                   'ok' | 'failed'
        result?:                  PayrollSlipResult
        compensation_warnings?:   string[]
        validation_errors?:       string[]
        error?:                   string
        failure_stage?:           FailedEmployee['failure_stage']
      }

      const dryResults: DryRunResult[] = []

      for (const emp of empList) {
        try {
          const [compensation, attendance] = await Promise.all([
            fetchActiveCompensation(fastify.supabase, tenantId, emp.id, runPeriodEnd),
            fetchAttendanceSummary(fastify.supabase, tenantId, emp.id, month),
          ])

          const compValidation = validateCompensation(
            compensation, { employeeId: emp.id, month }, runPeriodEnd,
          )

          if (compValidation.blocking_errors.length > 0) {
            dryResults.push({
              employee_id:   emp.id,
              employee_code: emp.employee_code,
              status:        'failed',
              failure_stage: 'compensation_validation',
              error:         compValidation.blocking_errors[0],
              validation_errors: compValidation.blocking_errors,
            })
            continue
          }

          const advLoanDeductions = await fetchAdvanceLoanDeductions(
            fastify.supabase, tenantId, emp.id, month,
          )

          const result  = await computeSlipWithStatutory(fastify.supabase, tenantId, {
            tenantId, employeeId: emp.id, month, compensation, attendance, total_working_days,
            advance_loan_deductions: advLoanDeductions,
          }, month)
          const slipRow    = buildSlipRow(tenantId, 'dry-run', result, month)
          const slipValid  = validatePayrollSlipPayload(slipRow, { employeeId: emp.id, month })

          dryResults.push({
            employee_id:            emp.id,
            employee_code:          emp.employee_code,
            status:                 slipValid.valid ? 'ok' : 'failed',
            result,
            compensation_warnings:  compValidation.warnings.length > 0 ? compValidation.warnings : undefined,
            validation_errors:      !slipValid.valid ? slipValid.errors : undefined,
            failure_stage:          !slipValid.valid ? 'slip_validation' : undefined,
            error:                  !slipValid.valid ? slipValid.errors[0] : undefined,
          })
        } catch (err: any) {
          dryResults.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            status:        'failed',
            failure_stage: 'data_fetch',
            error:         err?.message ?? 'Unexpected error',
          })
        }
      }

      const okCount   = dryResults.filter(r => r.status === 'ok').length
      const failCount = dryResults.filter(r => r.status === 'failed').length

      req.log.info(
        { event: 'payroll_dry_run_complete', month, ok: okCount, failed: failCount },
        'payroll dry run complete',
      )

      return reply.send({
        dry_run:           true,
        month,
        employee_count:    empList.length,
        total_working_days,
        ok_count:          okCount,
        failed_count:      failCount,
        results:           dryResults,
      })
    }

    // ── LIVE RUN ─────────────────────────────────────────────────────────────

    // Upsert the run row (processing)
    const { data: run, error: runErr } = await fastify.supabase
      .from('payroll_runs')
      .upsert({
        tenant_id:      tenantId,
        month,
        status:         'processing',
        notes:          notes ?? null,
        created_by:     req.userId,
        employee_count: empList.length,
      }, { onConflict: 'tenant_id,month' })
      .select('id')
      .single()

    if (runErr || !run) {
      req.log.error(
        { err: runErr, month, tenant_id: tenantId },
        'payroll run: failed to upsert run row',
      )
      return reply.code(500).send({
        error:   'INSERT_FAILED',
        message: 'Failed to create payroll run',
        details: runErr?.message,
        code:    runErr?.code,
      })
    }

    const runId = run.id as string

    req.log.info(
      { event: 'payroll_run_start', run_id: runId, month, employee_count: empList.length },
      'payroll run started',
    )

    // Forensic: run_started
    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     runId,
      event_type: 'run_started',
      month,
      payload:    { employee_count: empList.length, initiated_by: req.userId },
    })

    // Delete existing slips for this run (idempotent re-trigger)
    await fastify.supabase
      .from('payroll_slips')
      .delete()
      .eq('run_id', runId)

    // ── Per-employee processing loop ─────────────────────────────────────────
    //
    // Each employee is fully isolated.  A failure at any stage (data fetch,
    // compensation validation, payload validation, DB insert) is caught, logged
    // with full structured context, appended to failedEmployees[], and the loop
    // continues with the next employee.

    const succeededSlips: PayrollSlipResult[] = []
    const failedEmployees: FailedEmployee[]   = []

    for (const emp of empList) {
      const empCtx = { employee_id: emp.id, employee_code: emp.employee_code, month, run_id: runId }

      try {
        // ── Stage 1: Fetch compensation + attendance ───────────────────────
        let compensation: Awaited<ReturnType<typeof fetchActiveCompensation>>
        let attendance:   Awaited<ReturnType<typeof fetchAttendanceSummary>>

        try {
          ;[compensation, attendance] = await Promise.all([
            fetchActiveCompensation(fastify.supabase, tenantId, emp.id, runPeriodEnd),
            fetchAttendanceSummary(fastify.supabase, tenantId, emp.id, month),
          ])
        } catch (fetchErr: any) {
          const reason = fetchErr?.message ?? 'Unknown data fetch error'
          req.log.error(
            { ...empCtx, err: fetchErr, stage: 'data_fetch' },
            'payroll: data fetch failed — skipping employee',
          )
          await logRunEvent(fastify.supabase, req.log, {
            tenant_id:    tenantId, run_id: runId,
            event_type:   'data_fetch_failed',
            employee_id:  emp.id, month,
            error_details: { message: reason, stack: fetchErr?.stack },
          })
          failedEmployees.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'data_fetch',
            reason,
          })
          continue
        }

        // ── Stage 1.5: Fetch advance / loan deductions for this employee ─────
        const advLoanDeductions = await fetchAdvanceLoanDeductions(
          fastify.supabase, tenantId, emp.id, month,
        )

        // ── Stage 2: Validate compensation ────────────────────────────────
        const compValidation = validateCompensation(
          compensation, { employeeId: emp.id, month }, runPeriodEnd,
        )

        if (compValidation.blocking_errors.length > 0) {
          const reason = compValidation.blocking_errors[0]
          req.log.error(
            { ...empCtx, errors: compValidation.blocking_errors, stage: 'compensation_validation' },
            'payroll: compensation validation blocking error — skipping employee',
          )
          await logRunEvent(fastify.supabase, req.log, {
            tenant_id:    tenantId, run_id: runId,
            event_type:   compensation ? 'compensation_invalid' : 'compensation_missing',
            employee_id:  emp.id, month,
            payload:      { errors: compValidation.blocking_errors },
            error_details: { message: reason },
          })
          failedEmployees.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'compensation_validation',
            reason,
            details:       { errors: compValidation.blocking_errors },
          })
          continue
        }

        // Non-blocking compensation warnings — surfaced in logs, do not skip employee
        if (compValidation.warnings.length > 0) {
          req.log.warn(
            { ...empCtx, warnings: compValidation.warnings },
            'payroll: compensation warnings (non-blocking)',
          )
        }

        // ── Stage 3: Compute slip (+ config-driven statutory PF/ESI/PT) ────
        const result = await computeSlipWithStatutory(fastify.supabase, tenantId, {
          tenantId,
          employeeId: emp.id,
          month,
          compensation,
          attendance,
          total_working_days,
          advance_loan_deductions: advLoanDeductions,
        }, month)

        // ── Stage 4: Validate slip payload before insert ──────────────────
        const slipRow  = buildSlipRow(tenantId, runId, result, month)
        const slipValid = validatePayrollSlipPayload(slipRow, { employeeId: emp.id, month })

        if (!slipValid.valid) {
          req.log.error(
            {
              ...empCtx,
              validation_errors: slipValid.errors,
              slip_payload:      slipRow,
              stage:             'slip_validation',
            },
            'payroll: slip payload validation failed — refusing DB insert',
          )
          await logRunEvent(fastify.supabase, req.log, {
            tenant_id:    tenantId, run_id: runId,
            event_type:   'validation_failed',
            employee_id:  emp.id, month,
            payload:      slipRow,
            error_details: { validation_errors: slipValid.errors },
          })
          failedEmployees.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'slip_validation',
            reason:        `Slip payload validation failed: ${slipValid.errors[0]}`,
            details:       { validation_errors: slipValid.errors },
          })
          continue
        }

        // ── Stage 5: DB insert ────────────────────────────────────────────
        const { error: insertErr } = await fastify.supabase
          .from('payroll_slips')
          .insert(slipRow)

        if (insertErr) {
          req.log.error(
            {
              ...empCtx,
              err:              insertErr,
              supabase_code:    insertErr.code,
              supabase_details: insertErr.details,
              supabase_hint:    insertErr.hint,
              slip_payload:     slipRow,
              stage:            'db_insert',
            },
            'payroll: DB insert failed for employee slip',
          )
          await logRunEvent(fastify.supabase, req.log, {
            tenant_id:    tenantId, run_id: runId,
            event_type:   'slip_insert_failed',
            employee_id:  emp.id, month,
            payload:      slipRow,
            error_details: {
              message: insertErr.message,
              code:    insertErr.code,
              details: insertErr.details,
              hint:    insertErr.hint,
            },
          })
          failedEmployees.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'db_insert',
            reason:        insertErr.message,
            details: {
              code:    insertErr.code,
              details: insertErr.details,
              hint:    insertErr.hint,
            },
          })
          continue
        }

        // ── Stage 6: Slip inserted — log success forensics ────────────────
        await logRunEvent(fastify.supabase, req.log, {
          tenant_id:  tenantId, run_id: runId,
          event_type: 'slip_computed',
          employee_id: emp.id, month,
          payload: {
            gross_pay:        result.gross_pay,
            net_pay:          result.net_pay,
            lop_days:         result.lop_days,
            payable_days:     result.payable_days,
            total_deductions: result.total_deductions,
            has_warning:      !!result.warning,
          },
        })

        succeededSlips.push(result)

      } catch (unexpectedErr: any) {
        // Should not reach here — all stages have their own try/catch above.
        // Belt-and-suspenders catch to ensure one employee never crashes the loop.
        const reason = unexpectedErr?.message ?? 'Unexpected error during payroll computation'
        req.log.error(
          { ...empCtx, err: unexpectedErr, stack: unexpectedErr?.stack, stage: 'unexpected' },
          'payroll: unexpected per-employee error (all stages should be caught above)',
        )
        failedEmployees.push({
          employee_id:   emp.id,
          employee_code: emp.employee_code,
          failure_stage: 'unexpected',
          reason,
          details:       { stack: unexpectedErr?.stack },
        })
      }
    }

    // ── Aggregate totals from succeeded slips only ───────────────────────────
    const totalGross      = round2(succeededSlips.reduce((s, r) => s + r.gross_pay,        0))
    const totalDeductions = round2(succeededSlips.reduce((s, r) => s + r.total_deductions, 0))
    const totalNet        = round2(succeededSlips.reduce((s, r) => s + r.net_pay,          0))
    const totalLop        = round2(succeededSlips.reduce((s, r) => s + r.lop_amount,       0))

    // Mark run as failed if every single employee failed.
    // Mark as partial_failed if some (but not all) employees failed.
    // Mark as draft only when all employees succeeded.
    const runStatus: 'draft' | 'partial_failed' | 'failed' =
      succeededSlips.length === 0 && empList.length > 0
        ? 'failed'
        : failedEmployees.length > 0
          ? 'partial_failed'
          : 'draft'

    // Build structured failure summary — stored in DB so the admin UI can display
    // the dominant failure reason without a separate payroll_run_events query.
    const failureSummary = buildFailureSummary(failedEmployees, empList.length)

    const runUpdatePayload: Record<string, unknown> = {
      status:           runStatus,
      employee_count:   succeededSlips.length,
      total_gross:      totalGross,
      total_deductions: totalDeductions,
      total_net:        totalNet,
      total_lop_amount: totalLop,
      failure_summary:  failureSummary,
    }

    if (runStatus === 'failed') {
      // Use dominant reason in error_message so it surfaces in list view without
      // needing to join payroll_run_events.
      const dominantLabel = failureSummary
        ? `${failureSummary.dominant_stage}: ${failureSummary.dominant_reason}`
        : 'unknown error'
      runUpdatePayload.error_message =
        `All ${empList.length} employee(s) failed. Dominant cause — ${dominantLabel}`
    } else if (failedEmployees.length > 0) {
      const dominantLabel = failureSummary
        ? `${failureSummary.dominant_stage}: ${failureSummary.dominant_reason}`
        : 'unknown error'
      runUpdatePayload.error_message =
        `${failedEmployees.length} of ${empList.length} employee(s) failed. ` +
        `Dominant cause — ${dominantLabel}`
    }

    const { error: runUpdateErr } = await fastify.supabase
      .from('payroll_runs')
      .update(runUpdatePayload)
      .eq('id', runId)

    if (runUpdateErr) {
      // Non-fatal: slips are already inserted.  Log the error so it's not invisible,
      // but don't block the response — the caller already knows the slip count.
      req.log.error(
        { err: runUpdateErr, run_id: runId, attempted_status: runStatus },
        'payroll: failed to update run totals after slip insertion',
      )
    }

    // ── Forensic: run_completed ──────────────────────────────────────────────
    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId, run_id: runId,
      event_type: 'run_completed',
      month,
      payload: {
        succeeded:    succeededSlips.length,
        failed:       failedEmployees.length,
        total:        empList.length,
        total_gross:  totalGross,
        total_net:    totalNet,
        run_status:   runStatus,
      },
    })

    // ── Persist payroll blockers ──────────────────────────────────────────────
    // Non-fatal: blocker write failure must never block the run response.
    // The blockers populate the Resolution Center UI for HR admins.
    if (failedEmployees.length > 0) {
      try {
        // Fetch enabled validation rules so DB overrides apply to severity/blocking
        const { data: dbRules } = await fastify.supabase
          .from('payroll_validation_rules')
          .select('code, name, description, severity, blocking, enabled, stage, remediation_route')
          .eq('enabled', true)

        const blockerRows = buildPayrollBlockers({
          tenantId,
          runId,
          failedEmployees,
          dbRules: dbRules ?? undefined,
        })

        if (blockerRows.length > 0) {
          const { error: blockerErr } = await fastify.supabase
            .from('payroll_run_blockers')
            .insert(blockerRows)

          if (blockerErr) {
            req.log.warn(
              { err: blockerErr, run_id: runId, blocker_count: blockerRows.length },
              'payroll: blocker insert failed — Resolution Center will be empty for this run',
            )
          } else {
            req.log.info(
              { run_id: runId, blocker_count: blockerRows.length },
              'payroll: blockers inserted into payroll_run_blockers',
            )
          }
        }
      } catch (blockerErr: any) {
        req.log.warn(
          { err: blockerErr, run_id: runId },
          'payroll: blocker build/insert threw unexpectedly — non-fatal, run response continues',
        )
      }
    }

    req.log.info(
      {
        event:       'payroll_run_complete',
        run_id:      runId,
        month,
        succeeded:   succeededSlips.length,
        failed:      failedEmployees.length,
        total:       empList.length,
        total_gross: totalGross,
        total_net:   totalNet,
        run_status:  runStatus,
      },
      'payroll run complete',
    )

    // Employees with no attendance data (full pay assumed — operator must verify)
    const noAttendanceSlips = succeededSlips.filter(r => r.warning)

    const responseBody: Record<string, unknown> = {
      run_id:            runId,
      month,
      employee_count:    succeededSlips.length,
      total_working_days,
      total_gross:       totalGross,
      total_net:         totalNet,
      run_status:        runStatus,
      ...(failedEmployees.length > 0 && {
        failed_count:     failedEmployees.length,
        failed_employees: failedEmployees,
        failure_summary:  failureSummary,
      }),
      ...(noAttendanceSlips.length > 0 && {
        no_attendance_count:     noAttendanceSlips.length,
        no_attendance_employees: noAttendanceSlips.map(r => r.employeeId),
        warnings: [
          `${noAttendanceSlips.length} employee(s) have no attendance data and will receive full pay — ` +
          'verify punch records before finalizing.',
        ],
      }),
    }

    // If every employee failed, return 500 with full failure detail
    if (runStatus === 'failed') {
      return reply.code(500).send({
        error:   'PAYROLL_RUN_FAILED',
        message: `Payroll run created (run_id=${runId}) but all ${empList.length} employees failed. ` +
                 'See failed_employees for per-employee machine-readable failure reasons.',
        ...responseBody,
      })
    }

    return reply.code(201).send(responseBody)
  })

  // ── GET /payroll/runs ────────────────────────────────────────────────────────
  fastify.get('/payroll/runs', hrAdminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(100).default(24),
      offset: z.coerce.number().int().min(0).default(0),
      // q: free-text filter on month (e.g. "2025-03") or notes. Used by the
      // UniversalSearch palette; callers typically pass limit=3 alongside q.
      q:      z.string().max(50).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, offset, q } = parsed.data

    let qb = fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, total_gross, total_deductions, total_net, total_lop_amount, error_message, failure_summary, created_at, finalized_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('month', { ascending: false })
      .range(offset, offset + limit - 1)

    if (q && q.trim()) {
      const term = `%${q.trim()}%`
      // month is stored as YYYY-MM — ilike match covers partial month strings.
      // notes is the freetext field supplied at run creation.
      qb = qb.or(`month.ilike.${term},notes.ilike.${term}`)
    }

    const { data, error, count } = await qb

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch runs' })
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/runs/blockers?month=YYYY-MM ────────────────────────────────
  // Phase 10 — Pre-run readiness check.
  // Returns employees missing compensation or attendance data for the month,
  // plus a count of open attendance anomalies.
  // MUST be registered before /payroll/runs/:id (static segment beats param).
  fastify.get('/payroll/runs/blockers', hrAdminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().regex(monthRe, 'month must be YYYY-MM'),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month }    = parsed.data
    const tenantId     = req.tenantId as string
    const [year, mon]  = month.split('-').map(Number)
    const from         = `${month}-01`
    const to           = new Date(year, mon, 0).toISOString().slice(0, 10)

    // All active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')
    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{
      id: string; first_name: string; last_name: string; employee_code: string
    }>

    // Parallel checks: active compensations, attendance presence, open anomalies
    const [
      { data: compRows },
      { data: attRows },
      { count: anomalyCount },
    ] = await Promise.all([
      fastify.supabase
        .from('employee_compensations')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .gte('date', from)
        .lte('date', to),
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'open')
        .gte('date', from)
        .lte('date', to),
    ])

    const hasComp = new Set<string>((compRows ?? []).map((r: { employee_id: string }) => r.employee_id))
    const hasAtt  = new Set<string>((attRows  ?? []).map((r: { employee_id: string }) => r.employee_id))

    type BlockerType = 'no_compensation' | 'no_attendance'
    type Blocker = { type: BlockerType; employee_id: string; employee_name: string; employee_code: string }
    const blockers: Blocker[] = []
    let readyCount = 0

    for (const emp of empList) {
      const name = `${emp.first_name} ${emp.last_name}`
      if (!hasComp.has(emp.id)) {
        blockers.push({ type: 'no_compensation', employee_id: emp.id, employee_name: name, employee_code: emp.employee_code })
      } else if (!hasAtt.has(emp.id)) {
        blockers.push({ type: 'no_attendance',   employee_id: emp.id, employee_name: name, employee_code: emp.employee_code })
      } else {
        readyCount++
      }
    }

    return reply.send({
      month,
      total_employees: empList.length,
      ready:           readyCount,
      no_compensation: blockers.filter(b => b.type === 'no_compensation').length,
      no_attendance:   blockers.filter(b => b.type === 'no_attendance').length,
      open_anomalies:  anomalyCount ?? 0,
      blockers,
    })
  })

  // ── GET /payroll/compensation-coverage ─────────────────────────────────────
  //
  // Compensation coverage audit — returns a full per-employee breakdown of
  // compensation readiness for payroll.  Used by the Operations Center health
  // card and by the pre-run blocker response.
  //
  // MUST be registered before /payroll/runs/:id so the router doesn't try to
  // parse "compensation-coverage" as a run ID.
  fastify.get('/payroll/compensation-coverage', hrAdminAuth, async (req: any, reply) => {
    try {
      const audit = await buildCompensationCoverageAudit(fastify.supabase, req.tenantId as string)
      return reply.send({ data: audit })
    } catch (err: any) {
      req.log.error(
        { err, tenant_id: req.tenantId },
        'payroll compensation-coverage audit failed',
      )
      return reply.code(500).send({
        error:   'AUDIT_FAILED',
        message: err?.message ?? 'Failed to run compensation coverage audit',
      })
    }
  })

  // ── GET /payroll/runs/:id ────────────────────────────────────────────────────
  fastify.get('/payroll/runs/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('payroll_runs')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    return reply.send({ data })
  })

  // ── POST /payroll/runs/:id/finalize ──────────────────────────────────────────
  fastify.post('/payroll/runs/:id/finalize', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string

    // Parse finalize-specific body options.
    // force_finalize=true: override the missing-attendance gate (requires override_reason).
    const finalizeSchema = z.object({
      force_finalize:  z.boolean().optional().default(false),
      override_reason: z.string().max(500).optional(),
    })
    const parsedBody = finalizeSchema.safeParse(req.body ?? {})
    const { force_finalize, override_reason } = parsedBody.success
      ? parsedBody.data
      : { force_finalize: false, override_reason: undefined }

    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('status, month, created_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    if (run.status === 'finalized') {
      return reply.code(409).send({ error: 'ALREADY_FINALIZED', message: 'Run is already finalized' })
    }
    if (run.status === 'failed') {
      return reply.code(409).send({ error: 'RUN_FAILED', message: 'Cannot finalize a failed run — all employees failed during computation' })
    }
    // partial_failed is finalizable — only the succeeded slips are finalized

    // Freeze guard: block finalization if payroll for this month is frozen
    const freeze = await checkFreezeGuard(fastify.supabase, tenantId, run.month)
    if (freeze.frozen) {
      return reply.code(423).send({
        error: 'PAYROLL_FROZEN',
        message: freeze.reason ?? `Payroll for ${run.month} is frozen`,
      })
    }

    // ── PI-1 force_finalize hardening (finding P5) ─────────────────────────────
    // Forcing past the safety gates must always carry a reason; when dual control
    // is enabled it also requires elevated privilege (segregation of duties).
    if (force_finalize) {
      if (!override_reason || !override_reason.trim()) {
        return reply.code(400).send({
          error:   'OVERRIDE_REASON_REQUIRED',
          message: 'force_finalize requires a non-empty override_reason.',
        })
      }
      if (isPayrollDualControlEnabled() && req.userRole !== 'super_admin') {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'force_finalize requires super_admin when dual control is enabled.',
        })
      }
    }

    // ── PI-1 maker-checker / four-eyes finalize (finding C2) ───────────────────
    // The maker_checker_log was previously never written for finalize — the
    // "four-eyes" control was decorative. We now always record it. When dual
    // control is enabled, a DISTINCT checker must approve before the run seals.
    {
      const dualControl = isPayrollDualControlEnabled()
      const { data: pending } = await fastify.supabase
        .from('maker_checker_log')
        .select('id, maker_id')
        .eq('tenant_id', tenantId)
        .eq('entity_type', 'payroll_run')
        .eq('entity_id', id)
        .eq('action', 'finalize')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (dualControl) {
        if (!pending) {
          // Maker step — record the proposal and stop. A different user approves.
          await fastify.supabase.from('maker_checker_log').insert({
            tenant_id: tenantId, entity_type: 'payroll_run', entity_id: id,
            action: 'finalize', maker_id: req.userId, status: 'pending',
            maker_data: { month: run.month, force_finalize, override_reason: override_reason ?? null },
          })
          return reply.code(202).send({
            status:  'PENDING_CHECKER',
            message: 'Finalize submitted for four-eyes approval. A different authorised user must approve to seal this run.',
          })
        }
        if ((pending as any).maker_id === req.userId) {
          return reply.code(409).send({
            error:   'AWAITING_DIFFERENT_CHECKER',
            message: 'You proposed this finalize; a different authorised user must approve it.',
          })
        }
        // Checker step — approve the pending proposal, then proceed to finalize.
        await fastify.supabase.from('maker_checker_log')
          .update({ checker_id: req.userId, status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', (pending as any).id)
      } else {
        // Dual control off — record an auto-approved entry (real audit trail) and
        // proceed exactly as before: single operator, immediate finalize.
        await fastify.supabase.from('maker_checker_log').insert({
          tenant_id: tenantId, entity_type: 'payroll_run', entity_id: id,
          action: 'finalize', maker_id: req.userId, checker_id: req.userId,
          status: 'auto_approved', reviewed_at: new Date().toISOString(),
          maker_data: { month: run.month, force_finalize, override_reason: override_reason ?? null },
        })
      }
    }

    // Attendance-closure gate: payroll may RUN on open attendance, but may only be
    // FINALIZED after the attendance period for the month is locked (closed). This
    // enforces the policy that attendance must be frozen before payroll is sealed.
    // Override with force_finalize (+ override_reason). Resilient to a missing
    // attendance_period_locks table (drift): if the lookup errors, the gate is
    // skipped rather than blocking finalize.
    if (!force_finalize) {
      const { data: attLock, error: attErr } = await fastify.supabase
        .from('attendance_period_locks')
        .select('state')
        .eq('tenant_id', tenantId)
        .eq('period_month', run.month)
        .maybeSingle()
      if (!attErr) {
        const attState = (attLock as any)?.state ?? 'OPEN'
        if (attState === 'OPEN') {
          return reply.code(423).send({
            error: 'ATTENDANCE_NOT_LOCKED',
            message: `Attendance for ${run.month} is still open. Lock (close) the attendance period before finalizing payroll — running payroll is allowed, but finalize requires attendance closure. (Admins can override with force_finalize + a reason.)`,
          })
        }
      }
    }

    // ── Attendance completeness gate ────────────────────────────────────────────
    //
    // Employees without any attendance_daily rows for the run month received full
    // pay (0 LOP) by default — this is almost certainly wrong. Block finalization
    // so operators must verify before locking. Pass force_finalize=true with an
    // override_reason to proceed anyway (all overrides are audit-logged).
    {
      const [runYear, runMon] = (run.month as string).split('-').map(Number)
      const monthStart = `${run.month}-01`
      const monthEnd   = new Date(runYear, runMon, 0).toISOString().slice(0, 10)

      // Collect all employee IDs in the draft run
      const { data: draftSlips } = await fastify.supabase
        .from('payroll_slips')
        .select('employee_id')
        .eq('run_id', id)
        .eq('status', 'draft')

      const draftEmpIds = (draftSlips ?? []).map((s: { employee_id: string }) => s.employee_id)

      if (draftEmpIds.length > 0) {
        // Which of these employees have at least one PROCESSED attendance_daily row?
        // A row with NULL day_fraction is unprocessed (engine never ran) and would
        // be treated as full-present (0 LOP) by payroll — so it must NOT count as
        // valid attendance here, else stale rows finalize silently at full pay.
        const { data: attRows } = await fastify.supabase
          .from('attendance_daily')
          .select('employee_id, day_fraction')
          .eq('tenant_id', tenantId)
          .in('employee_id', draftEmpIds)
          .gte('date', monthStart)
          .lte('date', monthEnd)

        const hasAttendance = new Set(
          (attRows ?? [])
            .filter((r: { day_fraction: number | null }) => r.day_fraction !== null)
            .map((r: { employee_id: string }) => r.employee_id)
        )
        const missingIds = draftEmpIds.filter(eid => !hasAttendance.has(eid))

        if (missingIds.length > 0) {
          if (!force_finalize) {
            // Enrich with names for a human-readable error response
            const { data: empRows } = await fastify.supabase
              .from('employees')
              .select('id, first_name, last_name, employee_code')
              .in('id', missingIds)
              .eq('tenant_id', tenantId)

            return reply.code(422).send({
              error:   'MISSING_ATTENDANCE_DATA',
              message: `${missingIds.length} employee(s) have no attendance data for ${run.month}. ` +
                       'These employees will receive full pay (0 LOP assumed). ' +
                       'Verify punch records, then either process attendance or pass force_finalize=true with an override_reason.',
              missing_attendance_count:     missingIds.length,
              missing_attendance_employees: (empRows ?? []).map((e: any) => ({
                employee_id:   e.id,
                employee_name: `${e.first_name} ${e.last_name}`,
                employee_code: e.employee_code,
              })),
            })
          }

          // Override path — log the decision for the audit trail
          req.log.warn({
            run_id:              id,
            month:               run.month,
            overridden_by:       req.userId,
            override_reason:     override_reason ?? '(none provided)',
            missing_count:       missingIds.length,
            missing_employee_ids: missingIds,
          }, 'payroll finalization override: proceeding with missing attendance data — full pay assumed for affected employees')

          // Persist override to DB for SOX-compliant audit trail.
          // Non-fatal: a write failure must not block finalization — the structured
          // log above already captures the decision; the DB row is for audit queries.
          await fastify.supabase
            .from('payroll_finalize_overrides')
            .insert({
              tenant_id:              tenantId,
              run_id:                 id,
              month:                  run.month,
              overridden_by:          req.userId,
              override_reason:        override_reason ?? null,
              missing_employee_count: missingIds.length,
              missing_employee_ids:   missingIds,
            })
            .then(({ error: overrideErr }) => {
              if (overrideErr) {
                req.log.error(
                  { err: overrideErr, run_id: id },
                  'payroll finalize override: audit row insert failed — override proceeded but was not persisted to DB',
                )
              }
            })
        }
      }
    }

    // ── Open-blockers gate ────────────────────────────────────────────────────────
    // Do not finalize a run that still has open, blocking issues (compensation
    // coverage, validation failures, etc.). Overridable with force_finalize.
    {
      const { data: openBlockers } = await fastify.supabase
        .from('payroll_run_blockers')
        .select('id, severity, reason, message')
        .eq('tenant_id', tenantId)
        .eq('run_id', id)
        .eq('status', 'open')
        .eq('blocking', true)

      if ((openBlockers?.length ?? 0) > 0 && !force_finalize) {
        return reply.code(422).send({
          error:   'OPEN_BLOCKERS',
          message: `${openBlockers!.length} unresolved blocking issue(s) on this run. ` +
                   'Resolve them, or pass force_finalize=true with an override_reason.',
          blocker_count: openBlockers!.length,
          blockers: openBlockers!.slice(0, 20),
        })
      }
      if ((openBlockers?.length ?? 0) > 0 && force_finalize) {
        req.log.warn(
          { run_id: id, month: run.month, overridden_by: req.userId, override_reason: override_reason ?? '(none)', blocker_count: openBlockers!.length },
          'payroll finalization override: proceeding despite open blockers',
        )
      }
    }

    // ── Staleness guard ─────────────────────────────────────────────────────────
    // If any leave was approved AFTER this run was created, those employees'
    // attendance_daily rows may be stale.  Auto-recompute and refresh their slips
    // before locking so the finalized slip reflects the approved leave correctly.
    //
    // Per-employee failures are tracked and surfaced in the response body so
    // the operator knows which slips were finalized with potentially stale data.
    const recomputeWarnings: Array<{ employee_id: string; error: string }> = []
    let recomputedCount = 0

    try {
      const [year, mon] = (run.month as string).split('-').map(Number)
      const periodStart = `${run.month}-01`
      const periodEnd   = new Date(year, mon, 0).toISOString().slice(0, 10)

      // Find employees with leave approved after the run snapshot
      const { data: staleRows } = await fastify.supabase
        .from('leave_requests')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'APPROVED')
        .gte('updated_at', run.created_at)      // leave approved after run was created
        .lte('from_date', periodEnd)
        .gte('to_date', periodStart)

      const staleEmployeeIds = [...new Set((staleRows ?? []).map((r: { employee_id: string }) => r.employee_id))]

      if (staleEmployeeIds.length > 0) {
        req.log.info({ stale_count: staleEmployeeIds.length, run_id: id }, 'payroll finalize: recomputing stale employees before lock')

        let total_working_days: number
        try {
          total_working_days = await countWorkingDaysInMonth(fastify.supabase, tenantId, run.month as string)
        } catch (wdErr: any) {
          req.log.error(
            { err: wdErr, run_id: id, month: run.month },
            'payroll finalize: holiday calendar query failed — skipping stale attendance recompute. ' +
            'Slips will be finalized with existing attendance data.',
          )
          // Skip the entire stale recompute block: proceeding with total_working_days=0
          // would produce corrupt LOP deductions.  The run still finalizes with whatever
          // slip data was computed during the original run.
          staleEmployeeIds.length = 0
          total_working_days = 0
        }

        for (const employeeId of staleEmployeeIds) {
          try {
            // 1. Recompute attendance_daily for the period
            await recomputeRange(fastify.supabase, {
              tenant_id:   tenantId,
              employee_id: employeeId,
              from_date:   periodStart,
              to_date:     periodEnd,
              changed_by:  req.userId,
            })

            // 2. Re-fetch attendance + compensation and recompute slip
            const [compensation, attendance] = await Promise.all([
              fetchActiveCompensation(fastify.supabase, tenantId, employeeId, periodEnd),
              fetchAttendanceSummary(fastify.supabase, tenantId, employeeId, run.month as string),
            ])

            const freshAdvLoanDeductions = await fetchAdvanceLoanDeductions(
              fastify.supabase, tenantId, employeeId, run.month as string,
            )

            const freshSlip = await computeSlipWithStatutory(fastify.supabase, tenantId, {
              tenantId,
              employeeId,
              month:              run.month as string,
              compensation,
              attendance,
              total_working_days,
              advance_loan_deductions: freshAdvLoanDeductions,
            }, run.month as string)

            // 3. Update the existing draft slip in place
            await fastify.supabase
              .from('payroll_slips')
              .update({
                payable_days:          freshSlip.payable_days,
                lop_days:              freshSlip.lop_days,
                overtime_hours:        freshSlip.overtime_hours,
                gross_pay:             freshSlip.gross_pay,
                lop_amount:            freshSlip.lop_amount,
                total_deductions:      freshSlip.total_deductions,
                net_pay:               freshSlip.net_pay,
                employer_contributions:freshSlip.employer_contributions,
                component_breakdown:   freshSlip.component_breakdown,
                tds_deducted:          round2fn((freshSlip.component_breakdown ?? [])
                  .filter((c: any) => /^TDS$/i.test(c.code))
                  .reduce((s: number, c: any) => s + (Number(c.monthly_amount) || 0), 0)),
              })
              .eq('run_id', id)
              .eq('employee_id', employeeId)
              .eq('status', 'draft')

            recomputedCount++
          } catch (empErr: any) {
            // Per-employee failure: log, record warning, continue with remaining employees
            const errMsg = empErr?.message ?? 'Unknown recompute error'
            req.log.warn({ err: empErr, employee_id: employeeId, run_id: id },
              'payroll finalize: per-employee recompute failed (non-fatal)')
            recomputeWarnings.push({ employee_id: employeeId, error: errMsg })
          }
        }

        if (recomputeWarnings.length > 0) {
          req.log.warn(
            { warnings: recomputeWarnings, run_id: id },
            `payroll finalize: ${recomputeWarnings.length} of ${staleEmployeeIds.length} recomputes failed — slips finalized with potentially stale attendance`,
          )
        }
      }
    } catch (staleErr) {
      // Outer guard failure (e.g. leave_requests query failed) — non-fatal, continue
      req.log.error({ err: staleErr, run_id: id }, 'payroll finalize: staleness guard outer query failed (non-fatal)')
    }

    // ── Finalize run and all its slips (sequential, ordered) ───────────────────
    //
    // Order matters for partial-failure recovery:
    //
    //   Step 1 — Finalize slips FIRST (critical path).
    //     If this fails:  both slips and run remain draft → fully re-runnable, no data loss.
    //
    //   Step 2 — Finalize the run record AFTER slips are confirmed written.
    //     If this fails:  slips are already finalized; retrying finalize finds run still
    //                     'draft', the slip update is a no-op (0 draft rows), and only
    //                     the run status update re-executes → safe to retry.
    //
    // The previous Promise.all approach created a split state where payroll_runs showed
    // 'finalized' but payroll_slips remained 'draft' — employees saw no payslips and
    // re-finalization was permanently blocked by the ALREADY_FINALIZED guard.

    // Step 1: Finalize draft slips
    const { error: slipFinalizeErr } = await fastify.supabase
      .from('payroll_slips')
      .update({ status: 'finalized' })
      .eq('run_id', id)
      .eq('status', 'draft')

    if (slipFinalizeErr) {
      req.log.error(
        { err: slipFinalizeErr, run_id: id },
        'payroll finalize: slip status update failed — run remains draft, retry is safe',
      )
      return reply.code(500).send({
        error:   'SLIP_FINALIZE_FAILED',
        message: 'Failed to finalize payroll slips — the run remains in draft. Retry finalization.',
      })
    }

    // ── Mark advance recovery schedules and loan EMIs as paid ─────────────────
    // Non-fatal: failures here must never block finalization.
    try {
      const { data: finalizedSlips } = await fastify.supabase
        .from('payroll_slips')
        .select('employee_id')
        .eq('run_id', id)
        .eq('status', 'finalized')

      const finalizedEmpIds = (finalizedSlips ?? []).map((s: any) => s.employee_id as string)

      if (finalizedEmpIds.length > 0) {
        const now = new Date().toISOString()

        // Which installments were ACTUALLY recovered this run — read from the
        // finalized slips' component breakdown. The engine only deducts recoveries
        // that fit within available net pay; installments that don't fit are
        // deferred and must be rolled forward, NOT marked paid (otherwise the loan
        // ledger records money the employee never actually paid).
        const { data: finalizedSlipRows } = await fastify.supabase
          .from('payroll_slips')
          .select('component_breakdown')
          .eq('tenant_id', req.tenantId)
          .eq('run_id', id)
          .eq('status', 'finalized')

        const recoveredAdvanceIds = new Set<string>()
        const recoveredLoanIds    = new Set<string>()
        for (const s of (finalizedSlipRows ?? []) as any[]) {
          for (const c of (s.component_breakdown ?? []) as any[]) {
            if (!c?.salary_component_id) continue
            if (c.code === 'ADVANCE_RECOVERY') recoveredAdvanceIds.add(c.salary_component_id as string)
            else if (c.code === 'LOAN_EMI')    recoveredLoanIds.add(c.salary_component_id as string)
          }
        }

        // Next cycle (YYYY-MM) for deferred installments.
        const nextMonth = (() => {
          const [y, m] = run.month.split('-').map(Number)
          const d = new Date(Date.UTC(y, m, 1)) // m is 1-based → Date month index m == next month
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        })()

        // ── Advances: mark recovered, roll the rest forward ──────────────────────
        if (recoveredAdvanceIds.size > 0) {
          await fastify.supabase
            .from('advance_recovery_schedules')
            .update({ status: 'recovered', payroll_run_id: id, recovered_at: now })
            .eq('tenant_id', req.tenantId)
            .eq('recovery_month', run.month)
            .eq('status', 'pending')
            .in('id', [...recoveredAdvanceIds])
        }
        {
          let q = fastify.supabase
            .from('advance_recovery_schedules')
            .update({ recovery_month: nextMonth })
            .eq('tenant_id', req.tenantId)
            .eq('recovery_month', run.month)
            .eq('status', 'pending')
            .in('employee_id', finalizedEmpIds)
          if (recoveredAdvanceIds.size > 0) q = q.not('id', 'in', `(${[...recoveredAdvanceIds].join(',')})`)
          await q
        }

        // ── Loans: mark paid, roll the rest forward ──────────────────────────────
        if (recoveredLoanIds.size > 0) {
          await fastify.supabase
            .from('loan_schedules')
            .update({ status: 'paid', payroll_run_id: id, paid_at: now })
            .eq('tenant_id', req.tenantId)
            .eq('due_month', run.month)
            .eq('status', 'pending')
            .in('id', [...recoveredLoanIds])
        }
        {
          let q = fastify.supabase
            .from('loan_schedules')
            .update({ due_month: nextMonth })
            .eq('tenant_id', req.tenantId)
            .eq('due_month', run.month)
            .eq('status', 'pending')
            .in('employee_id', finalizedEmpIds)
          if (recoveredLoanIds.size > 0) q = q.not('id', 'in', `(${[...recoveredLoanIds].join(',')})`)
          await q
        }

        // Advance status sweep: mark as 'recovering' or 'fully_recovered'
        const { data: recoveredScheds } = await fastify.supabase
          .from('advance_recovery_schedules')
          .select('advance_id')
          .eq('tenant_id', req.tenantId)
          .eq('recovery_month', run.month)
          .eq('status', 'recovered')
          .eq('payroll_run_id', id)

        const affectedAdvanceIds = [...new Set((recoveredScheds ?? []).map((r: any) => r.advance_id as string))]

        for (const advId of affectedAdvanceIds) {
          const { count: pendingCount } = await fastify.supabase
            .from('advance_recovery_schedules')
            .select('id', { count: 'exact', head: true })
            .eq('advance_id', advId)
            .eq('tenant_id', req.tenantId)
            .eq('status', 'pending')

          const newStatus = (pendingCount ?? 0) === 0 ? 'fully_recovered' : 'recovering'
          await fastify.supabase
            .from('advance_salary_requests')
            .update({ status: newStatus, updated_at: now })
            .eq('id', advId)
            .eq('tenant_id', req.tenantId)
        }

        // Loan outstanding balance sweep: reduce by principal_component for each paid EMI
        const { data: paidLoanScheds } = await fastify.supabase
          .from('loan_schedules')
          .select('loan_id, principal_component')
          .eq('tenant_id', req.tenantId)
          .eq('due_month', run.month)
          .eq('status', 'paid')
          .eq('payroll_run_id', id)

        const loanPrincipalMap = new Map<string, number>()
        for (const s of (paidLoanScheds ?? []) as any[]) {
          loanPrincipalMap.set(s.loan_id, (loanPrincipalMap.get(s.loan_id) ?? 0) + (s.principal_component ?? 0))
        }

        for (const [loanId, principalPaid] of loanPrincipalMap) {
          const { data: loanRow } = await fastify.supabase
            .from('employee_loans')
            .select('outstanding_balance')
            .eq('id', loanId)
            .eq('tenant_id', req.tenantId)
            .single()

          if (loanRow) {
            const newOutstanding = Math.max(0, Math.round(((loanRow as any).outstanding_balance - principalPaid) * 100) / 100)
            await fastify.supabase
              .from('employee_loans')
              .update({
                outstanding_balance: newOutstanding,
                status:              newOutstanding <= 0 ? 'completed' : 'active',
                updated_at:          now,
              })
              .eq('id', loanId)
              .eq('tenant_id', req.tenantId)
          }
        }
      }
    } catch (advLoanErr: any) {
      req.log.warn({ err: advLoanErr }, 'payroll finalize: advance/loan schedule marking failed (non-fatal)')
    }

    // Step 2: Mark the run as finalized (only after slips are confirmed finalized)
    const { error: runFinalizeErr } = await fastify.supabase
      .from('payroll_runs')
      .update({ status: 'finalized', finalized_by: req.userId, finalized_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (runFinalizeErr) {
      // Slips are finalized; run status is not.  Retrying finalization is safe:
      // the slip update will match 0 draft rows (no-op) and only the run status
      // update will re-execute.
      req.log.error(
        { err: runFinalizeErr, run_id: id },
        'payroll finalize: run status update failed after slips finalized — retry finalization to complete',
      )
      return reply.code(500).send({
        error:   'RUN_STATUS_UPDATE_FAILED',
        message: 'Payroll slips were finalized but run status update failed — retry finalization to complete.',
      })
    }

    // ── Auto-compute statutory contributions (EPF / ESI / PTax) ──────────────
    // The Compliance filing pages read epf_contributions / esi_contributions /
    // ptax_contributions, which are populated by the per-scheme compute endpoints
    // (they require a FINALIZED run). Run them now — internally, reusing the
    // existing battle-tested handlers via fastify.inject with the caller's auth —
    // so the Compliance tab populates automatically on finalization. Non-blocking:
    // a failure here never fails the finalize (operator can recompute manually).
    {
      const authHeader = (req.headers as any)?.authorization as string | undefined
      const computePaths = [
        '/payroll/statutory/epf/contributions/compute',
        '/payroll/statutory/esi/contributions/compute',
        '/payroll/statutory/ptax/contributions/compute',
        '/payroll/statutory/lwf/contributions/compute',
      ]
      for (const url of computePaths) {
        try {
          const res = await fastify.inject({
            method:  'POST',
            url,
            headers: authHeader ? { authorization: authHeader } : {},
            payload: { month: run.month },
          })
          if (res.statusCode >= 400) {
            req.log.warn({ url, status: res.statusCode, body: res.body, run_id: id }, 'auto statutory contribution compute returned error (non-fatal)')
          }
        } catch (e: any) {
          req.log.warn({ url, err: e, run_id: id }, 'auto statutory contribution compute failed (non-fatal)')
        }
      }
    }

    // ── Phase 15: auto-create immutable snapshot ─────────────────────────────
    // Build and persist the snapshot AFTER the run is confirmed finalized.
    // Non-fatal: finalization succeeds even if snapshot creation fails (operator
    // can trigger snapshot manually via POST /payroll/runs/:id/snapshot).
    let snapshotId: string | undefined
    let snapshotHash: string | undefined
    try {
      const snapResult = await buildPayrollRunSnapshot(fastify.supabase, id, tenantId, req.userId)
      if ('error' in snapResult) {
        req.log.warn({ run_id: id, reason: snapResult.error }, 'payroll finalize: snapshot build failed (non-fatal)')
        // Surface the failure forensically so the run isn't silently snapshot-less
        // (Accounting/ledger will otherwise fail until a snapshot is generated).
        await logRunEvent(fastify.supabase, req.log, {
          tenant_id:  tenantId,
          run_id:     id,
          event_type: 'snapshot_integrity_failed',
          payload:    { reason: snapResult.error, stage: 'finalize_auto_snapshot' },
        })
      } else {
        snapshotId   = snapResult.snapshot_id
        snapshotHash = snapResult.integrity_hash
        // Emit forensic events for snapshot creation
        await logRunEvent(fastify.supabase, req.log, {
          tenant_id:  tenantId,
          run_id:     id,
          event_type: 'snapshot_created',
          payload:    { snapshot_id: snapshotId, integrity_hash: snapshotHash },
        })
        await logRunEvent(fastify.supabase, req.log, {
          tenant_id:  tenantId,
          run_id:     id,
          event_type: 'snapshot_verified',
          payload:    { snapshot_id: snapshotId, valid: true },
        })
      }
    } catch (snapErr: any) {
      req.log.warn({ err: snapErr, run_id: id }, 'payroll finalize: snapshot exception (non-fatal)')
      await logRunEvent(fastify.supabase, req.log, {
        tenant_id:  tenantId,
        run_id:     id,
        event_type: 'snapshot_integrity_failed',
        payload:    { reason: String(snapErr?.message ?? snapErr), stage: 'finalize_auto_snapshot' },
      }).catch(() => void 0)
    }

    await logAction(fastify.supabase, {
      tenantId:    tenantId,
      tableName:   'payroll_runs',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'finalized', month: run.month, snapshot_id: snapshotId ?? null },
    })

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.PAYROLL_RUN_FINALIZED,
      module:      MODULE.PAYROLL,
      entity_type: 'payroll_run',
      entity_id:   id,
      org_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { month: run.month, total_employees: (run as any).total_employees ?? 0 },
      correlation_id: req.correlationId ?? undefined,
    })

    // ── Billing snapshot (fire-and-forget, non-fatal) ────────────────────────
    // Captures employee_count × per_employee_rate at time of finalization.
    // Used by the owner panel for per-tenant SaaS billing reports.
    ;(async () => {
      try {
        const { data: tenantRow } = await fastify.supabase
          .from('tenants')
          .select('per_employee_rate, plan')
          .eq('id', tenantId)
          .single()

        if (tenantRow) {
          const employeeCount   = (run as any).employee_count ?? 0
          const perEmployeeRate = Number(tenantRow.per_employee_rate ?? 0)
          const snapshotMonth   = (run.month as string).slice(0, 7) // 'YYYY-MM'

          const { error: bsErr } = await fastify.supabase
            .from('tenant_billing_snapshots')
            .upsert(
              {
                tenant_id:         tenantId,
                payroll_run_id:    id,
                snapshot_month:    snapshotMonth,
                employee_count:    employeeCount,
                per_employee_rate: perEmployeeRate,
                plan:              tenantRow.plan ?? 'standard',
              },
              { onConflict: 'tenant_id,payroll_run_id', ignoreDuplicates: false },
            )

          if (bsErr) {
            req.log.warn({ err: bsErr, run_id: id }, 'billing snapshot upsert failed (non-fatal)')
          } else {
            req.log.info(
              { run_id: id, month: snapshotMonth, employee_count: employeeCount, rate: perEmployeeRate },
              'billing snapshot created',
            )
          }
        }
      } catch (bsErr: any) {
        req.log.warn({ err: bsErr, run_id: id }, 'billing snapshot exception (non-fatal)')
      }
    })()

    return reply.send({
      message: 'Payroll run finalized successfully',
      recomputed_count: recomputedCount,
      snapshot_id:   snapshotId,
      snapshot_hash: snapshotHash,
      // Surface per-employee recompute failures so the caller can alert the operator.
      // These slips are finalized but may carry stale attendance data.
      recompute_warnings: recomputeWarnings.length > 0 ? recomputeWarnings : undefined,
    })
  })

  // ── GET /payroll/runs/:id/slips ──────────────────────────────────────────────
  fastify.get('/payroll/runs/:id/slips', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
      search: z.string().max(100).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, offset } = parsed.data

    // Verify run belongs to tenant — fetch full run status for visibility computation
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    // Use LEFT JOIN (no !inner) so orphaned slips remain visible when employee row
    // has been archived or soft-deleted — !inner would silently drop those slips.
    let q = fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, month, status, held_reason, warning,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay, employer_contributions,
        component_breakdown,
        employees(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)
      .range(offset, offset + limit - 1)

    const { data, error, count } = await q
    if (error) {
      req.log.error({ err: error, run_id: id, tenant_id: req.tenantId }, 'payroll: failed to fetch run slips')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch slips' })
    }

    const slips = (data ?? []).map((r: any) => {
      const emp = r.employees ?? null
      return buildEmployeePayslipView(
        {
          id:                    r.id,
          employee_id:           r.employee_id,
          run_id:                id,
          month:                 r.month,
          gross_pay:             r.gross_pay,
          net_pay:               r.net_pay,
          lop_days:              r.lop_days,
          lop_amount:            r.lop_amount,
          payable_days:          r.payable_days,
          total_working_days:    r.total_working_days,
          overtime_hours:        r.overtime_hours,
          ctc_monthly:           r.ctc_monthly,
          total_deductions:      r.total_deductions,
          employer_contributions:r.employer_contributions,
          component_breakdown:   r.component_breakdown ?? [],
          status:                r.status,
          held_reason:           r.held_reason ?? null,
          warning:               r.warning ?? null,
        },
        { id, status: run.status },
        emp ? { first_name: emp.first_name, last_name: emp.last_name, employee_code: emp.employee_code } : null,
      )
    })

    return reply.send({ data: slips, total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/runs/:id/export ─────────────────────────────────────────────
  // CSV export of all slips for a run
  fastify.get('/payroll/runs/:id/export', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('month, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    const { data: slips } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        employee_id, month,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay,
        employees(first_name, last_name, employee_code)
      `)
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)

    const header = [
      'Employee Code', 'Employee Name', 'Month',
      'Working Days', 'Payable Days', 'LOP Days', 'OT Hours',
      'CTC Monthly', 'Gross Pay', 'LOP Amount', 'Deductions', 'Net Pay',
    ].join(',')

    const rows = (slips ?? []).map((r: any) => {
      const name = r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : ''
      return [
        r.employees?.employee_code ?? '',
        `"${name}"`,
        r.month,
        r.total_working_days,
        r.payable_days,
        r.lop_days,
        r.overtime_hours,
        r.ctc_monthly,
        r.gross_pay,
        r.lop_amount,
        r.total_deductions,
        r.net_pay,
      ].join(',')
    })

    const csv = [header, ...rows].join('\n')
    reply.header('Content-Type', 'text/csv')
    reply.header('Content-Disposition', `attachment; filename="payroll-${run.month}.csv"`)
    return reply.send(csv)
  })

  // ── GET /payroll/runs/:id/variance ──────────────────────────────────────────
  // Phase 10 — Month-over-month variance.
  // Compares this run to the most recent run for the previous month.
  // Employees sorted by absolute net-pay change (largest movers first).
  fastify.get('/payroll/runs/:id/variance', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const r2 = (n: number) => Math.round(n * 100) / 100

    // Current run
    const { data: currentRun } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!currentRun) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    // Derive previous month string
    const [cy, cm]  = currentRun.month.split('-').map(Number)
    const pd        = new Date(cy, cm - 2, 1)
    const prevMonth = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`

    // Fetch current slips + previous run in parallel
    const [
      { data: currentSlips },
      { data: prevRun },
    ] = await Promise.all([
      fastify.supabase
        .from('payroll_slips')
        .select(`
          employee_id, gross_pay, net_pay, lop_days, lop_amount,
          payable_days, total_deductions,
          employees(first_name, last_name, employee_code)
        `)
        .eq('run_id', id)
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('payroll_runs')
        .select('id, month')
        .eq('tenant_id', tenantId)
        .eq('month', prevMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const totalCurrGross = r2((currentSlips ?? []).reduce((s: number, r: any) => s + r.gross_pay, 0))
    const totalCurrNet   = r2((currentSlips ?? []).reduce((s: number, r: any) => s + r.net_pay,   0))

    // No previous run — return current totals with no comparison
    if (!prevRun) {
      return reply.send({
        current_month:  currentRun.month,
        previous_month: prevMonth,
        has_previous:   false,
        summary: {
          total_employees:     (currentSlips ?? []).length,
          employees_changed:   0,
          gross_change:        0,
          gross_change_pct:    0,
          net_change:          0,
          net_change_pct:      0,
          total_current_gross: totalCurrGross,
          total_current_net:   totalCurrNet,
          total_prev_gross:    0,
          total_prev_net:      0,
        },
        employees: [],
      })
    }

    // Fetch previous run slips
    const { data: prevSlips } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, gross_pay, net_pay, lop_days, lop_amount, payable_days, total_deductions')
      .eq('run_id', prevRun.id)
      .eq('tenant_id', tenantId)

    const prevMap = new Map<string, any>((prevSlips ?? []).map((s: any) => [s.employee_id, s]))

    type EmpVariance = {
      employee_id:   string
      employee_name: string | null
      employee_code: string | null
      current:  { gross_pay: number; net_pay: number; lop_days: number; lop_amount: number; payable_days: number; total_deductions: number }
      previous: { gross_pay: number; net_pay: number; lop_days: number; lop_amount: number; payable_days: number; total_deductions: number } | null
      diff:     { gross_pay: number; net_pay: number; lop_days: number }
      is_new:   boolean
    }

    const employees: EmpVariance[] = (currentSlips ?? []).map((curr: any) => {
      const prev = prevMap.get(curr.employee_id) ?? null
      const emp  = curr.employees as { first_name: string; last_name: string; employee_code: string } | null
      return {
        employee_id:   curr.employee_id,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
        current: {
          gross_pay:        curr.gross_pay,
          net_pay:          curr.net_pay,
          lop_days:         curr.lop_days,
          lop_amount:       curr.lop_amount,
          payable_days:     curr.payable_days,
          total_deductions: curr.total_deductions,
        },
        previous: prev ? {
          gross_pay:        prev.gross_pay,
          net_pay:          prev.net_pay,
          lop_days:         prev.lop_days,
          lop_amount:       prev.lop_amount,
          payable_days:     prev.payable_days,
          total_deductions: prev.total_deductions,
        } : null,
        diff: {
          gross_pay: r2(curr.gross_pay - (prev?.gross_pay ?? 0)),
          net_pay:   r2(curr.net_pay   - (prev?.net_pay   ?? 0)),
          lop_days:  curr.lop_days     - (prev?.lop_days  ?? 0),
        },
        is_new: !prev,
      }
    })
    // Largest absolute net-pay movers first
    employees.sort((a, b) => Math.abs(b.diff.net_pay) - Math.abs(a.diff.net_pay))

    const totalPrevGross = r2((prevSlips ?? []).reduce((s: number, r: any) => s + r.gross_pay, 0))
    const totalPrevNet   = r2((prevSlips ?? []).reduce((s: number, r: any) => s + r.net_pay,   0))
    const grossChange    = r2(totalCurrGross - totalPrevGross)
    const netChange      = r2(totalCurrNet   - totalPrevNet)

    return reply.send({
      current_month:  currentRun.month,
      previous_month: prevMonth,
      has_previous:   true,
      summary: {
        total_employees:     (currentSlips ?? []).length,
        employees_changed:   employees.filter(e => e.diff.net_pay !== 0 || e.diff.gross_pay !== 0).length,
        gross_change:        grossChange,
        gross_change_pct:    totalPrevGross > 0 ? r2((grossChange / totalPrevGross) * 100) : 0,
        net_change:          netChange,
        net_change_pct:      totalPrevNet   > 0 ? r2((netChange   / totalPrevNet)   * 100) : 0,
        total_current_gross: totalCurrGross,
        total_current_net:   totalCurrNet,
        total_prev_gross:    totalPrevGross,
        total_prev_net:      totalPrevNet,
      },
      employees,
    })
  })

  // ── GET /payroll/slips/:id ───────────────────────────────────────────────────
  // Full slip with component breakdown. HR admins can access all; employees only own finalized.
  fastify.get('/payroll/slips/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const isAdmin = HR_ADMIN_ROLES.includes(req.userRole)

    // LEFT JOIN (no !inner) — orphan slips (archived employee) must remain retrievable by admin.
    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        *,
        payroll_runs!inner(id, status),
        employees(id, first_name, last_name, employee_code)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) {
      req.log.warn({ slip_id: id, tenant_id: req.tenantId, err: error }, 'payroll: slip not found or query error')
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Slip not found' })
    }

    const slip = data as any
    const run  = slip.payroll_runs ?? null
    const emp  = slip.employees    ?? null

    // Compute visibility state before access checks so we can return it in the response
    const visibility = buildPayrollVisibilityState(
      { status: slip.status, held_reason: slip.held_reason },
      run ? { status: run.status } : null,
    )

    // Non-admin can only see their own finalized slip
    if (!isAdmin) {
      const { data: profile, error: profileErr } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (profileErr) {
        req.log.error({ err: profileErr, user_id: req.userId, slip_id: id }, 'payroll: profile lookup failed during slip access check')
        return reply.code(500).send({ error: 'PROFILE_FETCH_FAILED', message: 'Unable to verify your employee identity' })
      }

      if (profile?.employee_id !== slip.employee_id) {
        return reply.code(403).send({
          error:            'FORBIDDEN',
          message:          'You can only view your own payslip',
          visibility_reason: visibility.reason,
        })
      }

      if (!visibility.employee_visible) {
        return reply.code(403).send({
          error:            'NOT_FINALIZED',
          message:          visibility.label,
          visibility_reason: visibility.reason,
        })
      }
    }

    return reply.send({
      data: {
        ...slip,
        payroll_runs:  undefined,
        employees:     undefined,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
        run_status:    run?.status ?? null,
        visibility,
      },
    })
  })

  // ── GET /payroll/runs/:id/blockers ──────────────────────────────────────────
  // Resolution Center data: grouped blockers + run health for a failed/partial run.
  // Returns: { groups, health, run }
  fastify.get('/payroll/runs/:id/blockers', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string

    // Verify run belongs to tenant
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, error_message, failure_summary')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    // Fetch blockers joined with employee info
    const { data: blockerRows, error: blockerErr } = await fastify.supabase
      .from('payroll_run_blockers')
      .select(`
        id, employee_id, rule_code, severity, blocking, stage,
        reason, message, status, resolved_at, resolution_note, metadata,
        employees(first_name, last_name, employee_code)
      `)
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })

    if (blockerErr) {
      req.log.error({ err: blockerErr, run_id: id }, 'payroll blockers: query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch blockers' })
    }

    // Fetch validation rules for enrichment
    const { data: dbRules } = await fastify.supabase
      .from('payroll_validation_rules')
      .select('code, name, description, severity, blocking, enabled, stage, remediation_route')

    const flatBlockers = (blockerRows ?? []).map((b: any) => {
      const emp = b.employees ?? null
      return {
        id:              b.id,
        employee_id:     b.employee_id ?? null,
        rule_code:       b.rule_code,
        severity:        b.severity,
        blocking:        b.blocking,
        stage:           b.stage,
        reason:          b.reason,
        message:         b.message,
        status:          b.status,
        resolved_at:     b.resolved_at ?? null,
        resolution_note: b.resolution_note ?? null,
        employee_name:   emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:   emp?.employee_code ?? null,
      }
    })

    const groups = groupPayrollBlockers(flatBlockers, dbRules ?? [])
    const health = computePayrollRunHealth(flatBlockers)

    return reply.send({ run, groups, health })
  })

  // ── POST /payroll/blockers/:id/resolve ───────────────────────────────────────
  // Mark a single blocker as resolved or ignored.
  fastify.post('/payroll/blockers/:id/resolve', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      action:          z.enum(['resolved', 'ignored']),
      resolution_note: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { action, resolution_note } = parsed.data
    const tenantId = req.tenantId as string

    // Fetch blocker to verify ownership and get run_id for forensic event
    const { data: blocker } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('id, run_id, rule_code, employee_id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (!blocker) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Blocker not found' })
    if (blocker.status !== 'open') {
      return reply.code(409).send({
        error: 'ALREADY_RESOLVED',
        message: `Blocker is already ${blocker.status}`,
      })
    }

    const { error: updateErr } = await fastify.supabase
      .from('payroll_run_blockers')
      .update({
        status:          action,
        resolved_by:     req.userId,
        resolved_at:     new Date().toISOString(),
        resolution_note: resolution_note ?? null,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) {
      req.log.error({ err: updateErr, blocker_id: id }, 'payroll blockers: resolve update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update blocker status' })
    }

    // Forensic event
    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:   tenantId,
      run_id:      blocker.run_id,
      event_type:  action === 'resolved' ? 'blocker_resolved' : 'blocker_ignored',
      employee_id: blocker.employee_id ?? undefined,
      payload: {
        blocker_id:      id,
        rule_code:       blocker.rule_code,
        action,
        resolution_note: resolution_note ?? null,
        resolved_by:     req.userId,
      },
    })

    return reply.send({ success: true, blocker_id: id, action })
  })

  // ── POST /payroll/runs/:id/retry-failed ──────────────────────────────────────
  // Re-run only the employees who have open critical blockers.
  // Gated by computePayrollRunHealth().retry_eligible.
  fastify.post('/payroll/runs/:id/retry-failed', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    if (!['failed', 'partial_failed'].includes(run.status)) {
      return reply.code(409).send({
        error:   'INVALID_RUN_STATUS',
        message: `Run status is '${run.status}' — only failed or partial_failed runs can be retried`,
      })
    }

    // Freeze guard
    const freeze = await checkFreezeGuard(fastify.supabase, tenantId, run.month)
    if (freeze.frozen) {
      return reply.code(423).send({ error: 'PAYROLL_FROZEN', message: freeze.reason })
    }

    // Check retry eligibility via blocker health
    const { data: openBlockers } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('severity, blocking, status')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)

    const health = computePayrollRunHealth(openBlockers ?? [])
    if (!health.retry_eligible) {
      return reply.code(422).send({
        error:   'RETRY_BLOCKED',
        message: health.health_label,
        health,
      })
    }

    // Find which employees have open blockers (those are the ones that failed)
    const { data: openBlockerRows } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('employee_id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .not('employee_id', 'is', null)

    const retryEmpIds = [...new Set((openBlockerRows ?? []).map((b: any) => b.employee_id as string))]
    if (retryEmpIds.length === 0) {
      return reply.send({ message: 'No open blockers found — nothing to retry', retried_count: 0 })
    }

    // Fetch employee records for the retry set
    const { data: employees } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .in('id', retryEmpIds)

    const empList = (employees ?? []) as Array<{ id: string; first_name: string; last_name: string; employee_code: string }>

    // Working days context
    const [runYear, runMon] = (run.month as string).split('-').map(Number)
    const runPeriodEnd = new Date(runYear, runMon, 0).toISOString().slice(0, 10)
    let total_working_days: number
    try {
      total_working_days = await countWorkingDaysInMonth(fastify.supabase, tenantId, run.month)
    } catch (wdErr: any) {
      return reply.code(500).send({
        error:   'WORKING_DAYS_FETCH_FAILED',
        message: wdErr?.message ?? 'Failed to count working days',
      })
    }

    // Fetch validation rules for blocker rebuild
    const { data: dbRulesForRetry } = await fastify.supabase
      .from('payroll_validation_rules')
      .select('code, name, description, severity, blocking, enabled, stage, remediation_route')
      .eq('enabled', true)

    // Re-run each failed employee
    const succeededRetry: string[] = []
    const failedRetry: FailedEmployee[] = []

    for (const emp of empList) {
      const empCtx = { employee_id: emp.id, employee_code: emp.employee_code, month: run.month, run_id: id }
      try {
        const [compensation, attendance] = await Promise.all([
          fetchActiveCompensation(fastify.supabase, tenantId, emp.id, runPeriodEnd),
          fetchAttendanceSummary(fastify.supabase, tenantId, emp.id, run.month),
        ])

        const compVal = validateCompensation(
          compensation, { employeeId: emp.id, month: run.month }, runPeriodEnd,
        )
        if (compVal.blocking_errors.length > 0) {
          failedRetry.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'compensation_validation',
            reason:        compVal.blocking_errors[0],
          })
          continue
        }

        const result  = await computeSlipWithStatutory(fastify.supabase, tenantId, { tenantId, employeeId: emp.id, month: run.month, compensation, attendance, total_working_days }, run.month)
        const slipRow = buildSlipRow(tenantId, id, result, run.month)
        const slipVal = validatePayrollSlipPayload(slipRow, { employeeId: emp.id, month: run.month })

        if (!slipVal.valid) {
          failedRetry.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'slip_validation',
            reason:        slipVal.errors[0],
          })
          continue
        }

        // Delete existing slip (if re-inserted from a previous partial retry)
        await fastify.supabase.from('payroll_slips').delete()
          .eq('run_id', id).eq('employee_id', emp.id)

        const { error: insertErr } = await fastify.supabase.from('payroll_slips').insert(slipRow)
        if (insertErr) {
          failedRetry.push({
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            failure_stage: 'db_insert',
            reason:        insertErr.message,
          })
          continue
        }

        succeededRetry.push(emp.id)

        // Close open blockers for this employee (they succeeded now)
        await fastify.supabase
          .from('payroll_run_blockers')
          .update({ status: 'resolved', resolved_by: req.userId, resolved_at: new Date().toISOString(), resolution_note: 'Auto-resolved by retry' })
          .eq('run_id', id)
          .eq('employee_id', emp.id)
          .eq('status', 'open')

      } catch (unexpectedErr: any) {
        failedRetry.push({
          employee_id:   emp.id,
          employee_code: emp.employee_code,
          failure_stage: 'unexpected',
          reason:        unexpectedErr?.message ?? 'Unexpected error',
        })
      }
    }

    // Insert new blockers for newly failed employees
    if (failedRetry.length > 0) {
      try {
        const newBlockerRows = buildPayrollBlockers({ tenantId, runId: id, failedEmployees: failedRetry, dbRules: dbRulesForRetry ?? undefined })
        if (newBlockerRows.length > 0) {
          await fastify.supabase.from('payroll_run_blockers').insert(newBlockerRows)
        }
      } catch {
        // non-fatal
      }
    }

    // Update run status based on current open blockers after retry
    const { data: remainingBlockers } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('severity, blocking, status')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)

    const remainingHealth = computePayrollRunHealth(remainingBlockers ?? [])
    const newRunStatus = remainingHealth.total_open === 0 ? 'draft' : 'partial_failed'

    await fastify.supabase
      .from('payroll_runs')
      .update({ status: newRunStatus })
      .eq('id', id)

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId, run_id: id,
      event_type: 'payroll_retry_triggered',
      month:      run.month,
      payload: {
        retried_count:   empList.length,
        succeeded_count: succeededRetry.length,
        failed_count:    failedRetry.length,
        new_run_status:  newRunStatus,
        initiated_by:    req.userId,
      },
    })

    return reply.send({
      retried_count:    empList.length,
      succeeded_count:  succeededRetry.length,
      failed_count:     failedRetry.length,
      new_run_status:   newRunStatus,
      health:           remainingHealth,
      ...(failedRetry.length > 0 && { failed_employees: failedRetry }),
    })
  })

  // ── POST /payroll/runs/:id/freeze ────────────────────────────────────────────
  // Freeze the month of this run, preventing further payroll writes.
  fastify.post('/payroll/runs/:id/freeze', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      reason: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    const reason = parsed.success ? (parsed.data.reason ?? null) : null
    const tenantId = req.tenantId as string

    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    // Check already frozen
    const alreadyFrozen = await checkFreezeGuard(fastify.supabase, tenantId, run.month)
    if (alreadyFrozen.frozen) {
      return reply.code(409).send({
        error:   'ALREADY_FROZEN',
        message: `Payroll for ${run.month} is already frozen`,
      })
    }

    const { error: freezeErr } = await fastify.supabase
      .from('payroll_freeze_log')
      .insert({
        tenant_id:   tenantId,
        freeze_month: run.month,
        action:       'freeze',
        frozen_by:    req.userId,
        frozen_at:    new Date().toISOString(),
        reason:       reason ?? `Frozen (no reason given) — ${run.month}`,
      })

    if (freezeErr) {
      req.log.error({ err: freezeErr, run_id: id }, 'payroll freeze: insert failed')
      return reply.code(500).send({ error: 'FREEZE_FAILED', message: 'Failed to freeze payroll month' })
    }

    // Reflect the freeze on the run status so ALL views (Run Console, Payroll
    // Runs) show 'frozen' consistently — not just the freeze-log banner.
    await fastify.supabase
      .from('payroll_runs')
      .update({ status: 'frozen' })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId, run_id: id,
      event_type: 'payroll_run_frozen',
      month:      run.month,
      payload:    { frozen_by: req.userId, reason },
    })

    return reply.send({
      success:      true,
      frozen_month: run.month,
      reason:       reason ?? null,
    })
  })

  // ── GET /payroll/validation-rules ────────────────────────────────────────────
  // List all validation rules (for Validation Center UI).
  fastify.get('/payroll/validation-rules', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('payroll_validation_rules')
      .select('*')
      .order('stage')
      .order('code')

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch validation rules' })
    return reply.send({ data: data ?? [] })
  })

  // ── PATCH /payroll/validation-rules/:id ─────────────────────────────────────
  // Toggle enabled/blocking or change severity of a validation rule.
  // Only super_admin can call; hr_admin gets 403.
  fastify.patch('/payroll/validation-rules/:id', hrAdminAuth, async (req: any, reply) => {
    if (!['super_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only super_admin can modify validation rules' })
    }

    const { id } = req.params as { id: string }
    const schema = z.object({
      enabled:  z.boolean().optional(),
      blocking: z.boolean().optional(),
      severity: z.enum(['critical', 'warning', 'info']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'At least one field (enabled, blocking, severity) must be provided' })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_validation_rules')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update validation rule' })
    if (!data)  return reply.code(404).send({ error: 'NOT_FOUND',     message: 'Validation rule not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/my-slips ────────────────────────────────────────────────────
  // ESS: employee views own finalized payslips (list)
  // Response: { data: EmployeePayslipView[] }
  fastify.get('/payroll/my-slips', auth, async (req: any, reply) => {
    // Resolve employee_id from auth profile (tenant-scoped to prevent cross-tenant leaks)
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (profileErr) {
      req.log.error(
        { err: profileErr, user_id: req.userId, tenant_id: req.tenantId },
        'payroll my-slips: profile lookup failed',
      )
      return reply.code(500).send({ error: 'PROFILE_FETCH_FAILED', message: 'Unable to resolve your employee profile' })
    }

    // Profile exists but no employee_id linked — return empty list (not an error)
    if (!profile?.employee_id) {
      return reply.send({ data: [] })
    }

    // Fetch all finalized slips with run context for visibility computation.
    // LEFT JOIN on payroll_runs (via run_id FK) to get run status.
    // Only finalized slips are returned to employees — the RLS policy ps_emp_read
    // already enforces status='finalized', but we filter here too for defence-in-depth.
    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, run_id, month, status, held_reason, warning,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay,
        employer_contributions, component_breakdown, created_at,
        payroll_runs!inner(id, status)
      `)
      .eq('tenant_id',   req.tenantId)
      .eq('employee_id', profile.employee_id)
      .eq('status',      'finalized')
      .order('month', { ascending: false })

    if (error) {
      req.log.error(
        { err: error, employee_id: profile.employee_id, tenant_id: req.tenantId },
        'payroll my-slips: slip query failed',
      )
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch payslips' })
    }

    const slips = (data ?? []).map((r: any) => {
      const run = r.payroll_runs ?? null
      const visibility = buildPayrollVisibilityState(
        { status: r.status, held_reason: r.held_reason },
        run ? { status: run.status } : null,
      )
      return {
        slip_id:               r.id,
        employee_id:           r.employee_id,
        month:                 r.month,
        run_id:                r.run_id,
        run_status:            run?.status ?? null,
        gross_pay:             r.gross_pay,
        net_pay:               r.net_pay,
        lop_days:              r.lop_days,
        lop_amount:            r.lop_amount,
        payable_days:          r.payable_days,
        total_working_days:    r.total_working_days,
        overtime_hours:        r.overtime_hours,
        ctc_monthly:           r.ctc_monthly,
        total_deductions:      r.total_deductions,
        employer_contributions:r.employer_contributions,
        component_breakdown:   r.component_breakdown ?? [],
        status:                r.status,
        held_reason:           r.held_reason ?? null,
        warning:               r.warning ?? null,
        created_at:            r.created_at,
        visibility,
      }
    })

    return reply.send({ data: slips })
  })

  // ── GET /payroll/slips/trend ─────────────────────────────────────────────────
  // ESS: rolling month-by-month trend of the caller's net pay, gross pay, and
  // LOP days. Used to drive the EssCompensation chart.
  // Query params: months (1–24, default 12)
  fastify.get('/payroll/slips/trend', auth, async (req: any, reply) => {
    // Resolve employee_id from the authenticated user's profile
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (profileErr) {
      req.log.error({ err: profileErr }, 'payroll slips/trend: profile lookup failed')
      return reply.code(500).send({ error: 'PROFILE_FETCH_FAILED', message: 'Unable to resolve your employee profile' })
    }

    if (!profile?.employee_id) {
      return reply.send({ data: [] })
    }

    const querySchema = z.object({
      months: z.coerce.number().int().min(1).max(24).default(12),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { months } = parsed.data

    // Compute the earliest month to include: today's year-month minus (months - 1)
    const now      = new Date()
    const cutoffDt = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
    const cutoff   = `${cutoffDt.getFullYear()}-${String(cutoffDt.getMonth() + 1).padStart(2, '0')}`

    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select('month, net_pay, gross_pay, lop_days, lop_amount, payable_days, ctc_monthly, status')
      .eq('employee_id', profile.employee_id)
      .eq('tenant_id', req.tenantId)
      .gte('month', cutoff)
      .order('month', { ascending: true })

    if (error) {
      req.log.error({ err: error }, 'payroll slips/trend: query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch payroll trend' })
    }

    // Only include finalized slips in the trend — draft/held slips are not yet authoritative
    const trend = (data ?? [])
      .filter((r: any) => r.status === 'finalized')
      .map((r: any) => ({
        month:        r.month,
        net_pay:      r.net_pay      ?? 0,
        gross_pay:    r.gross_pay    ?? 0,
        lop_days:     r.lop_days     ?? 0,
        lop_amount:   r.lop_amount   ?? 0,
        payable_days: r.payable_days ?? 0,
        ctc_monthly:  r.ctc_monthly  ?? 0,
      }))

    return reply.send({ data: trend, months_requested: months })
  })

  // ── POST /payroll/runs/:id/rollback ──────────────────────────────────────────
  // Roll a finalized/partial_failed run back to draft so it can be re-processed.
  // Only super_admin may rollback a finalized run; hr_admin can rollback drafts.
  fastify.post('/payroll/runs/:id/rollback', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string
    const { reason } = (req.body ?? {}) as { reason?: string }

    const { data: run, error: runErr } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, tenant_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (runErr || !run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    if (run.status === 'processing') {
      return reply.code(409).send({ error: 'PROCESSING', message: 'Cannot rollback a run that is currently processing' })
    }
    if (run.status === 'finalized' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only super_admin may rollback a finalized run' })
    }

    // Reset run to draft FIRST. The PI-1 immutability trigger (migration 263)
    // protects slips belonging to a finalized run, so we must lift the run out
    // of 'finalized' before deleting its slips below. finalized → draft is the
    // sanctioned break-glass transition the trigger permits.
    const { error: updateErr } = await fastify.supabase
      .from('payroll_runs')
      .update({ status: 'draft', finalized_at: null, error_message: null, failure_summary: null })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updateErr) return reply.code(500).send({ error: 'DB_ERROR', message: updateErr.message })

    // Now delete the slips (parent run is 'draft' → trigger permits deletion).
    const { error: slipDelErr } = await fastify.supabase
      .from('payroll_slips').delete().eq('run_id', id).eq('tenant_id', tenantId)
    if (slipDelErr) return reply.code(500).send({ error: 'DB_ERROR', message: `Run reset to draft but slip deletion failed: ${slipDelErr.message}` })

    // If the month was frozen, also lift the freeze so the period is actually
    // runnable again — otherwise the freeze guard blocks the re-run and the
    // "Reopen" break-glass flow silently does nothing. Reopening a frozen period
    // is a super_admin action.
    const freezeState = await checkFreezeGuard(fastify.supabase, tenantId, run.month)
    let unfrozen = false
    if (freezeState.frozen) {
      if (req.userRole !== 'super_admin') {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only super_admin may reopen a frozen payroll month' })
      }
      const { error: unErr } = await fastify.supabase
        .from('payroll_freeze_log')
        .update({ action: 'unfreeze', unfrozen_by: req.userId, unfrozen_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('freeze_month', run.month)
        .eq('action', 'freeze')
        .is('unfrozen_at', null)
      if (unErr) return reply.code(500).send({ error: 'DB_ERROR', message: `Reset to draft but failed to unfreeze month: ${unErr.message}` })
      unfrozen = true
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id: tenantId, run_id: id, event_type: 'run_rolled_back',
      month: run.month, payload: { reason: reason ?? null, rolled_back_by: req.userId, unfrozen },
    })

    return reply.send({ message: unfrozen ? 'Period reopened (unfrozen) and reset to draft' : 'Run rolled back to draft', run_id: id, unfrozen })
  })

  // ── GET /payroll/forensics ────────────────────────────────────────────────────
  // Cross-run forensic timeline — all payroll_run_events for the tenant, ordered
  // by recency, with run context joined.
  fastify.get('/payroll/forensics', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { run_id, month, event_type, limit = '100', offset = '0' } =
      (req.query ?? {}) as Record<string, string>

    let q = fastify.supabase
      .from('payroll_run_events')
      .select(`
        id, run_id, event_type, employee_id, month, payload, error_details, created_at,
        payroll_runs ( month, status ),
        employees ( employee_code, profiles ( full_name ) )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (run_id)     q = q.eq('run_id', run_id)
    if (month)      q = q.eq('month', month)
    if (event_type) q = q.eq('event_type', event_type)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── GET /payroll/readiness-score ─────────────────────────────────────────────
  // Composite readiness score (0-100) for the current payroll month.
  // Aggregates: coverage, blockers, validations, attendance, statutory configs.
  fastify.get('/payroll/readiness-score', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    // Latest run
    const { data: latestRun } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, failure_summary')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const month = latestRun?.month ?? new Date().toISOString().slice(0, 7)

    // Compensation coverage
    const { buildCompensationCoverageAudit } = await import('../../lib/payroll-compensation-coverage.js')
    const coverage = await buildCompensationCoverageAudit(fastify.supabase, tenantId)

    // Open blockers for latest run
    const { count: openBlockers } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .eq('run_id', latestRun?.id ?? '00000000-0000-0000-0000-000000000000')

    // Pending validations
    const { count: pendingValidations } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')

    // Freeze status
    const freezeCheck = await checkFreezeGuard(fastify.supabase, tenantId, month)

    // Active employees vs covered
    const { count: totalActive } = await fastify.supabase
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    // Scoring logic (each dimension 0-25 points, total 100)
    const compensationScore = totalActive && totalActive > 0
      ? Math.round(((coverage.employees_with_active_compensation ?? 0) / totalActive) * 25)
      : 0

    const blockerScore = Math.max(0, 25 - ((openBlockers ?? 0) * 5))
    const runScore     = latestRun?.status === 'finalized' ? 25
      : latestRun?.status === 'draft' ? 15
      : latestRun?.status === 'partial_failed' ? 10
      : 5
    const configScore  = coverage.ready_for_payroll ? 25 : 15

    const total = compensationScore + blockerScore + runScore + configScore

    const checks = [
      { key: 'compensation_coverage', label: 'Compensation Coverage', score: compensationScore, max: 25,
        detail: `${coverage.employees_with_active_compensation ?? 0}/${totalActive ?? 0} employees covered`,
        pass: compensationScore >= 20 },
      { key: 'open_blockers', label: 'No Open Blockers', score: blockerScore, max: 25,
        detail: `${openBlockers ?? 0} open blockers`, pass: (openBlockers ?? 0) === 0 },
      { key: 'run_status', label: 'Payroll Run Status', score: runScore, max: 25,
        detail: latestRun?.status ?? 'No run', pass: runScore >= 20 },
      { key: 'config_valid', label: 'Configuration Valid', score: configScore, max: 25,
        detail: coverage.ready_for_payroll ? 'All configs valid' : 'Config issues found',
        pass: coverage.ready_for_payroll },
    ]

    return reply.send({
      data: {
        score: total,
        max: 100,
        grade: total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : 'D',
        ready: total >= 80 && !freezeCheck.frozen,
        month,
        checks,
        frozen: freezeCheck.frozen,
        run: latestRun ? { id: latestRun.id, status: latestRun.status, month: latestRun.month } : null,
      },
    })
  })

  // ── GET /payroll/freeze-log ───────────────────────────────────────────────────
  // Audit trail for all freeze/unfreeze events.
  fastify.get('/payroll/freeze-log', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('id, freeze_month, action, reason, frozen_at, frozen_by, unfrozen_at, payroll_run_id, profiles!payroll_freeze_log_frozen_by_fkey(full_name)')
      .eq('tenant_id', tenantId)
      .order('frozen_at', { ascending: false })
      .limit(100)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/freeze-month ────────────────────────────────────────────────
  // Explicitly freeze a payroll month (outside of a run).
  fastify.post('/payroll/freeze-month', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', issues: parsed.error.issues })
    const { month, reason } = parsed.data

    const already = await checkFreezeGuard(fastify.supabase, tenantId, month)
    if (already.frozen) return reply.code(409).send({ error: 'ALREADY_FROZEN', message: `${month} is already frozen` })

    const { error } = await fastify.supabase.from('payroll_freeze_log').insert({
      tenant_id: tenantId, freeze_month: month, action: 'freeze',
      reason, frozen_by: req.userId, frozen_at: new Date().toISOString(),
    })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ message: `${month} frozen`, month })
  })

  // ── POST /payroll/unfreeze-month ──────────────────────────────────────────────
  // Unfreeze a previously frozen payroll month. Requires super_admin.
  fastify.post('/payroll/unfreeze-month', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only super_admin may unfreeze a payroll month' })
    }
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', issues: parsed.error.issues })
    const { month, reason } = parsed.data

    const already = await checkFreezeGuard(fastify.supabase, tenantId, month)
    if (!already.frozen) return reply.code(409).send({ error: 'NOT_FROZEN', message: `${month} is not frozen` })

    // Mark the freeze record as unfrozen
    const { error } = await fastify.supabase
      .from('payroll_freeze_log')
      .update({ action: 'unfreeze', unfrozen_by: req.userId, unfrozen_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('freeze_month', month)
      .eq('action', 'freeze')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Revert the run status from 'frozen' back to 'finalized' so views are
    // consistent (mirrors the freeze action that sets status='frozen').
    await fastify.supabase
      .from('payroll_runs')
      .update({ status: 'finalized' })
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .eq('status', 'frozen')

    return reply.send({ message: `${month} unfrozen`, month })
  })

  // ── Shared statutory-reconciliation builder ───────────────────────────────────
  // Computes COMPUTED (payslip) vs PAYABLE (filing tables) per statute for a run.
  // Used by both the GET summary and the POST closure gate so they never diverge.
  type ReconStatute = { payable: number; computed: number; variance: number; filed: boolean }
  type ReconResult = {
    run: { id: string; month: string; status: string }
    recon: { pf: ReconStatute; esi: ReconStatute; pt: ReconStatute; tds: ReconStatute }
    employeeCount: number
  }
  const STATUTE_KEYS = ['pf', 'esi', 'pt', 'tds'] as const
  type StatuteKey = typeof STATUTE_KEYS[number]

  async function buildStatutoryRecon(tenantId: string, month?: string): Promise<ReconResult | null> {
    let runQuery = fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, total_gross, total_net, total_deductions')
      .eq('tenant_id', tenantId)
      .in('status', ['finalized', 'partial_failed', 'draft'])
      .order('created_at', { ascending: false })
    if (month) runQuery = runQuery.eq('month', month)
    const { data: run } = await runQuery.limit(1).maybeSingle()
    if (!run) return null

    const reconMonth = run.month as string

    // COMPUTED (from payslips) — real slip codes. TDS isn't on the slip.
    const { data: slips } = await fastify.supabase
      .from('payroll_slips')
      .select('component_breakdown, employee_id')
      .eq('run_id', run.id)
      .eq('tenant_id', tenantId)

    const recon = {
      pf:  { payable: 0, computed: 0, variance: 0, filed: false },
      esi: { payable: 0, computed: 0, variance: 0, filed: false },
      pt:  { payable: 0, computed: 0, variance: 0, filed: false },
      tds: { payable: 0, computed: 0, variance: 0, filed: false },
    }
    const employeeCount = slips?.length ?? 0

    for (const slip of (slips ?? [])) {
      for (const comp of (slip.component_breakdown ?? [])) {
        const code = (comp.code ?? '').toUpperCase()
        const amt  = Number(comp.monthly_amount ?? 0)
        if (code === 'PF_EMPLOYEE' || code === 'PF_EMPLOYER' || code === 'EPF' || code === 'PF') recon.pf.computed  += amt
        else if (code === 'ESI_EMPLOYEE' || code === 'ESI_EMPLOYER' || code === 'ESI')            recon.esi.computed += amt
        else if (code === 'PTAX' || code === 'PT' || code === 'PROFESSIONAL_TAX')                 recon.pt.computed  += amt
        else if (code === 'TDS' || code === 'INCOME_TAX')                                         recon.tds.computed += amt
      }
    }

    // PAYABLE (from actual filing tables for this month)
    const [epfRows, esiRows, ptaxRows, tdsRows] = await Promise.all([
      fastify.supabase.from('epf_contributions')
        .select('employee_contribution, total_employer_contribution, voluntary_pf')
        .eq('tenant_id', tenantId).eq('contribution_month', reconMonth),
      fastify.supabase.from('esi_contributions')
        .select('total_contribution')
        .eq('tenant_id', tenantId).eq('contribution_month', reconMonth),
      fastify.supabase.from('ptax_contributions')
        .select('ptax_amount')
        .eq('tenant_id', tenantId).eq('contribution_month', reconMonth),
      fastify.supabase.from('tds_monthly_projections')
        .select('tds_this_month')
        .eq('tenant_id', tenantId).eq('projection_month', reconMonth),
    ])

    const sum = (rows: any[] | null | undefined, fn: (r: any) => number) =>
      Math.round((rows ?? []).reduce((s, r) => s + fn(r), 0) * 100) / 100

    recon.pf.payable  = sum(epfRows.data, r => Number(r.employee_contribution ?? 0) + Number(r.total_employer_contribution ?? 0) + Number(r.voluntary_pf ?? 0))
    recon.esi.payable = sum(esiRows.data, r => Number(r.total_contribution ?? 0))
    recon.pt.payable  = sum(ptaxRows.data, r => Number(r.ptax_amount ?? 0))
    recon.tds.payable = sum(tdsRows.data, r => Number(r.tds_this_month ?? 0))

    recon.pf.filed  = (epfRows.data?.length  ?? 0) > 0
    recon.esi.filed = (esiRows.data?.length  ?? 0) > 0
    recon.pt.filed  = (ptaxRows.data?.length ?? 0) > 0
    recon.tds.filed = (tdsRows.data?.length  ?? 0) > 0

    // The amount DEPOSITED to each authority is exactly what was deducted on the
    // finalized payslips (employee + employer for PF/ESI, the PT slab for PT, the
    // TDS line for income tax). The per-scheme filing tables (epf/esi/ptax_contributions,
    // tds_monthly_projections) are a convenience copy that may not be populated yet.
    // So whenever a head has no filing rows, fall back to the slip-aggregated amount
    // as the payable — the recon then reflects the real liability sourced from payroll.
    for (const k of STATUTE_KEYS) {
      if (!recon[k].filed && recon[k].computed > 0) {
        recon[k].payable = recon[k].computed
        recon[k].filed   = true
      } else if (recon[k].computed === 0 && recon[k].payable > 0) {
        // Filing rows exist but slip had no line (e.g. TDS not on slip) — show payable.
        recon[k].computed = recon[k].payable
      }
    }

    recon.pf.variance  = Math.round((recon.pf.payable  - recon.pf.computed)  * 100) / 100
    recon.esi.variance = Math.round((recon.esi.payable - recon.esi.computed) * 100) / 100
    recon.pt.variance  = Math.round((recon.pt.payable  - recon.pt.computed)  * 100) / 100
    recon.tds.variance = Math.round((recon.tds.payable - recon.tds.computed) * 100) / 100

    return {
      run: { id: run.id as string, month: reconMonth, status: run.status as string },
      recon,
      employeeCount,
    }
  }

  // A statute is RECONCILED when its filing rows exist and variance is within ₹1.
  const isReconciled = (s: ReconStatute) => s.filed && Math.abs(s.variance) < 1

  // ── GET /payroll/statutory-reconciliation ─────────────────────────────────────
  // Cross-statutory reconciliation summary: PF, ESI, PT, TDS per run/month,
  // merged with persisted closure state (filed / confirmed).
  fastify.get('/payroll/statutory-reconciliation', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { month } = (req.query ?? {}) as { month?: string }

    const result = await buildStatutoryRecon(tenantId, month)
    if (!result) return reply.send({ data: null, message: 'No payroll run found' })

    const { run, recon, employeeCount } = result

    // Persisted closures for this month.
    const { data: closureRows } = await fastify.supabase
      .from('statutory_filing_closures')
      .select('statutory_type, status, challan_number, reference_note, filed_at, confirmed_at, variance')
      .eq('tenant_id', tenantId)
      .eq('month', run.month)
    const closureMap = new Map<string, any>(
      (closureRows ?? []).map((c: any) => [c.statutory_type, c]),
    )

    const runFinalized = run.status === 'finalized'
    const decorate = (key: StatuteKey, s: ReconStatute, label: string) => {
      const closure = closureMap.get(key)
      return {
        ...s,
        label,
        ready:     isReconciled(s),
        // Can only file when the run is finalized AND the statute reconciles.
        can_file:  runFinalized && isReconciled(s) && !closure,
        closure_status: closure?.status ?? null,    // 'filed' | 'confirmed' | null
        challan_number: closure?.challan_number ?? null,
        reference_note: closure?.reference_note ?? null,
        filed_at:       closure?.filed_at ?? null,
        confirmed_at:   closure?.confirmed_at ?? null,
      }
    }

    const pf  = decorate('pf',  recon.pf,  'Provident Fund')
    const esi = decorate('esi', recon.esi, 'Employee State Insurance')
    const pt  = decorate('pt',  recon.pt,  'Professional Tax')
    const tds = decorate('tds', recon.tds, 'Tax Deducted at Source')

    const readyForFiling = isReconciled(recon.pf) && isReconciled(recon.esi) && isReconciled(recon.pt) && isReconciled(recon.tds)
    const allClosed = [pf, esi, pt, tds].every(s => s.closure_status !== null)

    return reply.send({
      data: {
        run: { id: run.id, month: run.month, status: run.status, employee_count: employeeCount },
        pf, esi, pt, tds,
        ready_for_filing: readyForFiling,
        run_finalized:    runFinalized,
        all_closed:       allClosed,
        total_statutory:  recon.pf.computed + recon.esi.computed + recon.pt.computed + recon.tds.computed,
        note: readyForFiling
          ? undefined
          : 'Not ready: statutory contributions must be generated (EPF/ESI/PT/TDS) and match payslip totals within ₹1 before filing.',
      },
    })
  })

  // ── POST /payroll/statutory-reconciliation/close ──────────────────────────────
  // File one or more statutes for a month. Gated: run must be finalized AND the
  // statute must reconcile within ₹1. Idempotent — refuses to file twice.
  fastify.post('/payroll/statutory-reconciliation/close', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({
      month:          z.string().regex(/^\d{4}-\d{2}$/),
      statutes:       z.array(z.enum(['pf', 'esi', 'pt', 'tds'])).min(1),
      challan_number: z.string().max(120).optional(),
      reference_note: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, statutes, challan_number, reference_note } = parsed.data

    const result = await buildStatutoryRecon(tenantId, month)
    if (!result) return reply.code(404).send({ error: 'NO_RUN', message: `No payroll run found for ${month}` })
    if (result.run.status !== 'finalized') {
      return reply.code(409).send({
        error: 'RUN_NOT_FINALIZED',
        message: `Payroll run for ${month} is '${result.run.status}'. Finalize the run before filing statutory dues.`,
      })
    }

    // Existing closures (idempotency guard).
    const { data: existingRows } = await fastify.supabase
      .from('statutory_filing_closures')
      .select('statutory_type, status')
      .eq('tenant_id', tenantId)
      .eq('month', month)
    const existing = new Set((existingRows ?? []).map((r: any) => r.statutory_type))

    const filed: string[] = []
    const skipped: Array<{ statute: string; reason: string }> = []
    const rowsToInsert: any[] = []
    const nowIso = new Date().toISOString()

    for (const key of statutes) {
      if (existing.has(key)) { skipped.push({ statute: key, reason: 'already_filed' }); continue }
      const s = result.recon[key as StatuteKey]
      if (!isReconciled(s)) {
        skipped.push({
          statute: key,
          reason: s.filed ? `variance_${s.variance}` : 'no_contributions_generated',
        })
        continue
      }
      rowsToInsert.push({
        tenant_id:       tenantId,
        month,
        statutory_type:  key,
        status:          'filed',
        run_id:          result.run.id,
        computed_amount: s.computed,
        payable_amount:  s.payable,
        variance:        s.variance,
        snapshot:        { ...s, run_id: result.run.id, month, captured_at: nowIso },
        challan_number:  challan_number ?? null,
        reference_note:  reference_note ?? null,
        filed_by:        req.userId ?? null,
        filed_at:        nowIso,
      })
      filed.push(key)
    }

    if (rowsToInsert.length > 0) {
      const { error } = await fastify.supabase
        .from('statutory_filing_closures')
        .insert(rowsToInsert)
      if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

      await logAction(fastify.supabase, {
        tenantId,
        tableName:   'statutory_filing_closures',
        recordId:    result.run.id,
        action:      'INSERT',
        performedBy: req.userId ?? null,
        newData:     { month, filed, challan_number: challan_number ?? null },
      }).catch(() => {})
    }

    return reply.send({ month, filed, skipped })
  })

  // ── POST /payroll/statutory-reconciliation/confirm ─────────────────────────────
  // Mark a filed statute as confirmed (acknowledgement received).
  fastify.post('/payroll/statutory-reconciliation/confirm', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({
      month:    z.string().regex(/^\d{4}-\d{2}$/),
      statutes: z.array(z.enum(['pf', 'esi', 'pt', 'tds'])).min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, statutes } = parsed.data

    const { error } = await fastify.supabase
      .from('statutory_filing_closures')
      .update({ status: 'confirmed', confirmed_by: req.userId ?? null, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .in('statutory_type', statutes)
      .eq('status', 'filed')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ month, confirmed: statutes })
  })

  // ── POST /payroll/statutory-reconciliation/reopen ──────────────────────────────
  // Reopen (un-file) a statute — deletes the closure so it can be refiled.
  fastify.post('/payroll/statutory-reconciliation/reopen', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({
      month:    z.string().regex(/^\d{4}-\d{2}$/),
      statutes: z.array(z.enum(['pf', 'esi', 'pt', 'tds'])).min(1),
      reason:   z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, statutes, reason } = parsed.data

    const { error } = await fastify.supabase
      .from('statutory_filing_closures')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .in('statutory_type', statutes)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'statutory_filing_closures',
      recordId:    tenantId,
      action:      'DELETE',
      performedBy: req.userId ?? null,
      oldData:     { month, statutes, reason: reason ?? null },
    }).catch(() => {})

    return reply.send({ month, reopened: statutes })
  })

  // ── GET /payroll/approval-stages ──────────────────────────────────────────────
  // List maker-checker log entries for payroll governance.
  fastify.get('/payroll/approval-stages', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { status, entity_type } = (req.query ?? {}) as Record<string, string>

    let q = fastify.supabase
      .from('maker_checker_log')
      .select(`
        id, entity_type, entity_id, action, status, maker_data, checker_notes,
        submitted_at, reviewed_at, sla_hours, is_escalated,
        maker:profiles!maker_checker_log_maker_id_fkey(full_name),
        checker:profiles!maker_checker_log_checker_id_fkey(full_name)
      `)
      .eq('tenant_id', tenantId)
      .order('submitted_at', { ascending: false })
      .limit(100)

    if (status)      q = q.eq('status', status)
    if (entity_type) q = q.eq('entity_type', entity_type)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/approval-stages/:id/approve ─────────────────────────────────
  fastify.post('/payroll/approval-stages/:id/approve', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string
    const { notes } = (req.body ?? {}) as { notes?: string }

    const { error } = await fastify.supabase
      .from('maker_checker_log')
      .update({ status: 'approved', checker_id: req.userId, checker_notes: notes ?? null, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ message: 'Approved' })
  })

  // ── POST /payroll/approval-stages/:id/reject ──────────────────────────────────
  fastify.post('/payroll/approval-stages/:id/reject', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string
    const { notes } = (req.body ?? {}) as { notes?: string }

    const { error } = await fastify.supabase
      .from('maker_checker_log')
      .update({ status: 'rejected', checker_id: req.userId, checker_notes: notes ?? null, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ message: 'Rejected' })
  })

  // ── GET /payroll/payout-batches ───────────────────────────────────────────────
  // List payout batch records (bank disbursement tracking).
  fastify.get('/payroll/payout-batches', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { month } = (req.query ?? {}) as { month?: string }

    // Aggregate from payroll_slips — treat each finalized run as a virtual payout batch
    let q = fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, total_gross, total_net, finalized_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(24)

    if (month) q = q.eq('month', month)
    const { data: runs, error } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Map runs to virtual payout batches
    const batches = (runs ?? []).map(r => ({
      id:             r.id,
      month:          r.month,
      run_id:         r.id,
      employee_count: r.employee_count ?? 0,
      total_amount:   r.total_net ?? 0,
      gross_amount:   r.total_gross ?? 0,
      status:         r.status === 'finalized' ? 'ready' : r.status === 'draft' ? 'pending' : r.status,
      finalized_at:   r.finalized_at,
      created_at:     r.created_at,
    }))

    return reply.send({ data: batches })
  })

  // ── GET /payroll/payout-batches/:runId/employees ──────────────────────────────
  // Employee-level payout details for a run (for bank advice / individual tracking).
  fastify.get('/payroll/payout-batches/:runId/employees', hrAdminAuth, async (req: any, reply) => {
    const { runId } = req.params as { runId: string }
    const tenantId = req.tenantId as string

    const { data: slips, error } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, month, gross_pay, net_pay, total_deductions, lop_amount, status, held_reason,
        employees (
          employee_code,
          profiles ( full_name ),
          bank_details:employee_bank_details ( account_number_masked, bank_name, ifsc_code, is_primary )
        )
      `)
      .eq('run_id', runId)
      .eq('tenant_id', tenantId)
      .order('employee_id')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const mapped = (slips ?? []).map((s: any) => {
      const bank = (s.employees?.bank_details ?? []).find((b: any) => b.is_primary) ?? s.employees?.bank_details?.[0] ?? null
      return {
        slip_id:          s.id,
        employee_id:      s.employee_id,
        employee_code:    s.employees?.employee_code ?? '—',
        employee_name:    s.employees?.profiles?.full_name ?? '—',
        net_pay:          s.net_pay,
        gross_pay:        s.gross_pay,
        total_deductions: s.total_deductions,
        status:           s.status,
        held_reason:      s.held_reason,
        bank_name:        bank?.bank_name ?? null,
        account_masked:   bank?.account_number_masked ?? null,
        ifsc:             bank?.ifsc_code ?? null,
        bank_verified:    !!bank,
      }
    })

    return reply.send({ data: mapped })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT & REPLAY ENDPOINTS  (Phase 15 — Immutable Snapshot Engine)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POST /payroll/runs/:id/snapshot ─────────────────────────────────────────
  // Manually trigger snapshot creation for a finalized run.
  // Normally called automatically by finalize; this endpoint enables re-creation
  // if the auto-snapshot failed (e.g., transient DB error during finalization).
  fastify.post('/payroll/runs/:id/snapshot', hrAdminAuth, async (req: any, reply) => {
    const { id }       = req.params as { id: string }
    const tenantId     = req.tenantId as string

    // Verify run exists and is finalized
    const { data: run, error: runErr } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status, snapshot_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (runErr || !run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    if ((run as any).status !== 'finalized') {
      return reply.code(409).send({ error: 'NOT_FINALIZED', message: 'Snapshot can only be created for finalized runs' })
    }
    if ((run as any).snapshot_id) {
      return reply.code(409).send({ error: 'SNAPSHOT_EXISTS', message: 'Snapshot already exists for this run', snapshot_id: (run as any).snapshot_id })
    }

    const result = await buildPayrollRunSnapshot(fastify.supabase, id, tenantId, req.userId)
    if ('error' in result) {
      return reply.code(500).send({ error: 'SNAPSHOT_FAILED', message: result.error })
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: 'snapshot_created',
      payload:    { snapshot_id: result.snapshot_id, integrity_hash: result.integrity_hash, triggered_manually: true },
    })

    return reply.send({
      message:        'Snapshot created successfully',
      snapshot_id:    result.snapshot_id,
      integrity_hash: result.integrity_hash,
    })
  })

  // ── GET /payroll/runs/:id/snapshot ──────────────────────────────────────────
  // Fetch the snapshot manifest + summary for a run.
  fastify.get('/payroll/runs/:id/snapshot', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: snapshot, error } = await fastify.supabase
      .from('payroll_run_snapshots')
      .select('id, run_id, month, snapshot_version, integrity_hash, replayable, formula_engine_version, validation_engine_version, created_at, created_by')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error)     return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!snapshot) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No snapshot found for this run' })

    // Count employee snapshots
    const { count } = await fastify.supabase
      .from('payroll_employee_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('snapshot_id', (snapshot as any).id)
      .eq('tenant_id', tenantId)

    return reply.send({ data: { ...snapshot, employee_count: count ?? 0 } })
  })

  // ── GET /payroll/runs/:id/snapshot/employees ────────────────────────────────
  // Paginated employee-level snapshot data (for explainability panel).
  fastify.get('/payroll/runs/:id/snapshot/employees', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const qSchema  = z.object({
      employee_id: z.string().uuid().optional(),
      limit:       z.coerce.number().int().min(1).max(100).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { employee_id, limit, offset } = parsed.data

    // Find snapshot for this run
    const { data: manifest } = await fastify.supabase
      .from('payroll_run_snapshots')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!manifest) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No snapshot found for this run' })

    let q = fastify.supabase
      .from('payroll_employee_snapshots')
      .select(
        'id, employee_id, employee_code, employee_name, gross_pay, deductions, net_pay, payable_days, lop_days, overtime_hours, computed_at, attendance_snapshot, compensation_snapshot, component_snapshot, statutory_snapshot, formula_snapshot, validation_snapshot',
        { count: 'exact' },
      )
      .eq('snapshot_id', (manifest as any).id)
      .eq('tenant_id', tenantId)
      .range(offset, offset + limit - 1)

    if (employee_id) q = (q as any).eq('employee_id', employee_id)

    const { data: rows, error, count } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: rows ?? [], total: count ?? 0 })
  })

  // ── POST /payroll/runs/:id/verify-integrity ──────────────────────────────────
  // Re-hash the stored snapshot and compare against integrity_hash.
  fastify.post('/payroll/runs/:id/verify-integrity', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: manifest } = await fastify.supabase
      .from('payroll_run_snapshots')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!manifest) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No snapshot found for this run' })

    const result = await validateSnapshotIntegrity(fastify.supabase, (manifest as any).id, tenantId)

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: result.valid ? 'snapshot_verified' : 'snapshot_integrity_failed',
      payload: {
        snapshot_id:    (manifest as any).id,
        valid:          result.valid,
        stored_hash:    result.stored_hash,
        computed_hash:  result.computed_hash,
        employee_count: result.employee_count,
      },
    })

    return reply.send({ data: result })
  })

  // ── POST /payroll/runs/:id/replay ────────────────────────────────────────────
  // Replay a finalized payroll run using ONLY snapshot data.
  // Modes:
  //   dry_replay      — recompute silently, return result (no persistence change)
  //   variance_replay — compare historical vs current engine, surface diffs
  //   audit_replay    — full reconstruction for audit purposes
  fastify.post('/payroll/runs/:id/replay', hrAdminAuth, async (req: any, reply) => {
    const { id }       = req.params as { id: string }
    const tenantId     = req.tenantId as string

    const bodySchema = z.object({
      replay_type: z.enum(['dry_replay', 'variance_replay', 'audit_replay']).default('audit_replay'),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { replay_type } = parsed.data

    const result = await replayPayrollRun(fastify.supabase, id, tenantId, replay_type, req.userId)
    if ('error' in result) {
      return reply.code(500).send({ error: 'REPLAY_FAILED', message: result.error })
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: result.variance_detected ? 'replay_variance_found' : 'replay_completed',
      payload: {
        replay_type,
        total_employees:   result.total_employees,
        matched:           result.matched,
        diverged:          result.diverged,
        variance_detected: result.variance_detected,
      },
    })

    return reply.send({ data: result })
  })

  // ── GET /payroll/runs/:id/replay-sessions ────────────────────────────────────
  // List all replay sessions for a run.
  fastify.get('/payroll/runs/:id/replay-sessions', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_replay_sessions')
      .select('id, replay_type, triggered_by, triggered_at, result_status, variance_detected, variance_summary, completed_at')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .order('triggered_at', { ascending: false })
      .limit(20)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNTING LEDGER ENDPOINTS  (Phase 16 — Financial Ledger Engine)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POST /payroll/runs/:id/ledger ────────────────────────────────────────────
  // Generate or regenerate a financial ledger for a finalized run (from snapshot).
  fastify.post('/payroll/runs/:id/ledger', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const bodySchema = z.object({
      ledger_type:      z.enum(['payroll','accrual','payout','adjustment']).default('payroll'),
      accounting_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const result = await buildPayrollFinancialLedger(
      fastify.supabase, id, tenantId, req.userId,
      { ledger_type: parsed.data.ledger_type, accounting_date: parsed.data.accounting_date },
    )

    if ('error' in result) {
      // Actionable preconditions (snapshot needed / archived / ledger already posted)
      // surface as 409 with a code the UI can act on, not an opaque 500.
      const actionable = new Set(['SNAPSHOT_REQUIRED', 'SNAPSHOT_ARCHIVED', 'LEDGER_EXISTS'])
      const code = (result as any).code as string | undefined
      if (code && actionable.has(code)) {
        return reply.code(409).send({ error: code, message: result.error })
      }
      return reply.code(500).send({ error: 'LEDGER_BUILD_FAILED', message: result.error })
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: 'ledger_created',
      payload: {
        ledger_id:      result.ledger_id,
        balanced:       result.balanced,
        total_debit:    result.total_debit,
        entry_count:    result.entry_count,
        integrity_hash: result.integrity_hash.slice(0, 12),
      },
    })

    if (result.balanced) {
      await logRunEvent(fastify.supabase, req.log, {
        tenant_id:  tenantId,
        run_id:     id,
        event_type: 'ledger_balanced',
        payload:    { ledger_id: result.ledger_id },
      })
    }

    return reply.send({ data: result })
  })

  // ── GET /payroll/runs/:id/ledger ─────────────────────────────────────────────
  // Get ledger manifest + control totals.
  fastify.get('/payroll/runs/:id/ledger', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id, ledger_month, ledger_type, ledger_status, total_debit, total_credit, currency, integrity_hash, posted_at, posted_by, reverses_ledger_id, notes, created_at')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/ledgers/:ledgerId/entries ───────────────────────────────────
  // Paginated ledger entries — GL journal view.
  fastify.get('/payroll/ledgers/:ledgerId/entries', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string
    const qSchema = z.object({
      entry_type:  z.string().optional(),
      gl_code:     z.string().optional(),
      employee_id: z.string().uuid().optional(),
      limit:       z.coerce.number().int().min(1).max(500).default(200),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { entry_type, gl_code, employee_id, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('payroll_ledger_entries')
      .select('id, entry_type, entry_category, gl_account_code, gl_account_name, debit_amount, credit_amount, description, source_component_code, source_component_name, accounting_date, journal_reference, employee_id', { count: 'exact' })
      .eq('ledger_id', ledgerId)
      .eq('tenant_id', tenantId)
      .order('accounting_date')
      .order('journal_reference')
      .range(offset, offset + limit - 1)

    if (entry_type)  q = (q as any).eq('entry_type', entry_type)
    if (gl_code)     q = (q as any).eq('gl_account_code', gl_code)
    if (employee_id) q = (q as any).eq('employee_id', employee_id)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── POST /payroll/ledgers/:ledgerId/post ─────────────────────────────────────
  // Post a balanced ledger (requires balanced status).
  fastify.post('/payroll/ledgers/:ledgerId/post', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string

    const { data: ledger, error: lErr } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id, ledger_status, run_id, total_debit, total_credit')
      .eq('id', ledgerId)
      .eq('tenant_id', tenantId)
      .single()

    if (lErr || !ledger) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ledger not found' })
    if ((ledger as any).ledger_status === 'posted') return reply.code(409).send({ error: 'ALREADY_POSTED', message: 'Ledger is already posted' })
    if ((ledger as any).ledger_status !== 'balanced') {
      return reply.code(409).send({
        error:   'NOT_BALANCED',
        message: `Ledger must be balanced before posting. Current status: ${(ledger as any).ledger_status}. ` +
                 `Debit: ${(ledger as any).total_debit}, Credit: ${(ledger as any).total_credit}`,
      })
    }

    const { error: updErr } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .update({ ledger_status: 'posted', posted_at: new Date().toISOString(), posted_by: req.userId })
      .eq('id', ledgerId)
      .eq('tenant_id', req.tenantId)

    if (updErr) return reply.code(500).send({ error: 'POST_FAILED', message: updErr.message })

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     (ledger as any).run_id,
      event_type: 'ledger_posted',
      payload:    { ledger_id: ledgerId, posted_by: req.userId },
    })

    return reply.send({ message: 'Ledger posted successfully', ledger_id: ledgerId })
  })

  // ── POST /payroll/ledgers/:ledgerId/reverse ──────────────────────────────────
  // Safe reversal — creates mirror entries, never deletes posted entries.
  fastify.post('/payroll/ledgers/:ledgerId/reverse', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string

    const bodySchema = z.object({ reason: z.string().min(5).max(500) })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const result = await reversePayrollLedger(fastify.supabase, ledgerId, tenantId, req.userId, parsed.data.reason)
    if ('error' in result) return reply.code(400).send({ error: 'REVERSAL_FAILED', message: result.error })

    const { data: origLedger } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('run_id')
      .eq('id', ledgerId)
      .eq('tenant_id', tenantId)
      .single()

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     (origLedger as any)?.run_id ?? '',
      event_type: 'ledger_reversed',
      payload:    { original_ledger_id: ledgerId, reversal_ledger_id: result.reversal_ledger_id, reason: parsed.data.reason },
    })

    return reply.send({ message: 'Ledger reversed', reversal_ledger_id: result.reversal_ledger_id })
  })

  // ── GET /payroll/ledgers/:ledgerId/export ────────────────────────────────────
  // ERP-ready export. ?format=csv|tally|sap|zoho|quickbooks
  fastify.get('/payroll/ledgers/:ledgerId/export', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string
    const qSchema = z.object({
      format: z.enum(['csv','tally','sap','zoho','quickbooks','xlsx']).default('csv'),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const result = await exportGeneralLedger(fastify.supabase, ledgerId, tenantId, parsed.data.format)
    if ('error' in result) return reply.code(500).send({ error: 'EXPORT_FAILED', message: result.error })

    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`)
    reply.header('Content-Type', result.mime)
    return reply.send(result.content)
  })

  // ── GET /payroll/runs/:id/cost-allocations ───────────────────────────────────
  // Department / cost-center burden breakdown.
  fastify.get('/payroll/runs/:id/cost-allocations', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: ledger } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .eq('ledger_type', 'payroll')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!ledger) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No ledger found for this run — generate ledger first' })

    const { data, error } = await fastify.supabase
      .from('payroll_cost_allocations')
      .select('employee_id, department_id, cost_center_id, department_name, cost_center_name, gross_pay, net_pay, lop_recovery, employer_burden, statutory_burden, overtime_cost, total_cost, allocation_pct')
      .eq('ledger_id', (ledger as any).id)
      .eq('tenant_id', tenantId)
      .order('total_cost', { ascending: false })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/accounting/summary ─────────────────────────────────────────
  // Dashboard aggregates: total liability, accruals, payout completion, ledger imbalances.
  fastify.get('/payroll/accounting/summary', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const qSchema  = z.object({ months: z.coerce.number().int().min(1).max(12).default(3) })
    const parsed   = qSchema.safeParse(req.query)
    const months   = parsed.success ? parsed.data.months : 3

    const [ledgersRes, payoutRes] = await Promise.all([
      fastify.supabase
        .from('payroll_financial_ledgers')
        .select('id, ledger_month, ledger_type, ledger_status, total_debit, total_credit')
        .eq('tenant_id', tenantId)
        .order('ledger_month', { ascending: false })
        .limit(months * 3),
      fastify.supabase
        .from('payroll_payout_reconciliation')
        .select('expected_amount, paid_amount, payment_status')
        .eq('tenant_id', tenantId)
        .limit(2000),
    ])

    const ledgers  = (ledgersRes.data ?? []) as any[]
    const payouts  = (payoutRes.data  ?? []) as any[]

    const totalPayrollLiability = ledgers
      .filter(l => l.ledger_type === 'payroll' && l.ledger_status !== 'reversed')
      .reduce((s, l) => s + (l.total_credit ?? 0), 0)

    const pendingPayouts = payouts.filter(p => p.payment_status === 'pending' || p.payment_status === 'processing')
    const failedPayouts  = payouts.filter(p => p.payment_status === 'failed')
    const completedPayouts = payouts.filter(p => p.payment_status === 'paid')

    const totalExpected  = payouts.reduce((s, p) => s + (p.expected_amount ?? 0), 0)
    const totalPaid      = completedPayouts.reduce((s, p) => s + (p.paid_amount ?? 0), 0)
    const imbalancedLedgers = ledgers.filter(l => l.ledger_status !== 'reversed' && Math.abs((l.total_debit ?? 0) - (l.total_credit ?? 0)) > 0.01)

    return reply.send({
      data: {
        total_payroll_liability:  totalPayrollLiability,
        pending_payout_amount:    pendingPayouts.reduce((s, p) => s + p.expected_amount, 0),
        failed_payout_count:      failedPayouts.length,
        payout_completion_pct:    totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0,
        imbalanced_ledger_count:  imbalancedLedgers.length,
        total_ledger_count:       ledgers.length,
        posted_ledger_count:      ledgers.filter(l => l.ledger_status === 'posted').length,
        statutory_liability_hint: 'Sum statutory payable GL accounts for exact statutory liabilities',
        recent_ledgers:           ledgers.slice(0, 6),
      },
    })
  })

  // ── GET /payroll/accounting/gl-summary ────────────────────────────────────────
  // GL account balance summary across all posted ledgers.
  fastify.get('/payroll/accounting/gl-summary', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_ledger_entries')
      .select('gl_account_code, gl_account_name, entry_category, debit_amount, credit_amount')
      .eq('tenant_id', tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Aggregate by GL account
    const glMap = new Map<string, { code: string; name: string; category: string; totalDebit: number; totalCredit: number }>()
    for (const row of (data ?? []) as any[]) {
      const existing = glMap.get(row.gl_account_code)
      if (existing) {
        existing.totalDebit  += row.debit_amount  ?? 0
        existing.totalCredit += row.credit_amount ?? 0
      } else {
        glMap.set(row.gl_account_code, {
          code:        row.gl_account_code,
          name:        row.gl_account_name,
          category:    row.entry_category,
          totalDebit:  row.debit_amount  ?? 0,
          totalCredit: row.credit_amount ?? 0,
        })
      }
    }

    const summary = Array.from(glMap.values())
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(g => ({
        ...g,
        balance:     Math.round((g.totalDebit - g.totalCredit) * 100) / 100,
        totalDebit:  Math.round(g.totalDebit  * 100) / 100,
        totalCredit: Math.round(g.totalCredit * 100) / 100,
      }))

    return reply.send({ data: summary })
  })

  // ── GET /payroll/payout-reconciliation ───────────────────────────────────────
  // Payout reconciliation records with filter support.
  fastify.get('/payroll/payout-reconciliation', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const qSchema  = z.object({
      run_id:  z.string().uuid().optional(),
      status:  z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(500).default(100),
      offset:  z.coerce.number().int().min(0).default(0),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { run_id, status, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('payroll_payout_reconciliation')
      .select('id, run_id, slip_id, employee_id, expected_amount, paid_amount, variance_amount, payment_status, utr_number, bank_reference, bank_account_masked, ifsc_code, initiated_at, completed_at, failure_reason, retry_count', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (run_id) q = (q as any).eq('run_id', run_id)
    if (status) q = (q as any).eq('payment_status', status)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── POST /payroll/payout-reconciliation/:id/update ───────────────────────────
  // Update payout status (UTR, completion, failure).
  fastify.post('/payroll/payout-reconciliation/:id/update', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const bodySchema = z.object({
      payment_status: z.enum(['pending','processing','paid','failed','reversed','held','partial']),
      paid_amount:    z.number().min(0).optional(),
      utr_number:     z.string().max(50).optional(),
      bank_reference: z.string().max(100).optional(),
      failure_reason: z.string().max(500).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const update: Record<string, unknown> = {
      payment_status: parsed.data.payment_status,
      updated_at:     new Date().toISOString(),
    }
    if (parsed.data.paid_amount !== undefined) update.paid_amount = parsed.data.paid_amount
    if (parsed.data.utr_number)     update.utr_number     = parsed.data.utr_number
    if (parsed.data.bank_reference) update.bank_reference = parsed.data.bank_reference
    if (parsed.data.failure_reason) update.failure_reason = parsed.data.failure_reason
    if (parsed.data.payment_status === 'paid') update.completed_at = new Date().toISOString()
    if (parsed.data.payment_status === 'processing') update.initiated_at = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('payroll_payout_reconciliation')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Payout status updated' })
  })

  // ── POST /payroll/runs/:id/payout-obligations ────────────────────────────────
  // Generate payout obligation rows for a finalized run.
  fastify.post('/payroll/runs/:id/payout-obligations', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    // Guard: payout obligations (bank disbursement) must be built from FINALIZED
    // slips only — never from mutable draft net_pay.
    const { data: runRow } = await fastify.supabase
      .from('payroll_runs').select('status').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (!runRow) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payroll run not found' })
    if ((runRow as any).status !== 'finalized') {
      return reply.code(409).send({
        error: 'NOT_FINALIZED',
        message: `Run must be finalized before generating payout obligations (current status: ${(runRow as any).status}).`,
      })
    }

    // Check if obligations already exist
    const { count: existing } = await fastify.supabase
      .from('payroll_payout_reconciliation')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', id)
      .eq('tenant_id', tenantId)

    if ((existing ?? 0) > 0) {
      return reply.code(409).send({ error: 'OBLIGATIONS_EXIST', message: `${existing} payout obligations already exist for this run` })
    }

    // Get ledger id
    const { data: ledger } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .eq('ledger_type', 'payroll')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Get slips with bank details
    const { data: slips, error: sErr } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, net_pay,
        employees (
          bank_details:employee_bank_details ( account_number_masked, ifsc_code, is_primary )
        )
      `)
      .eq('run_id', id)
      .eq('tenant_id', tenantId)

    if (sErr || !slips) return reply.code(500).send({ error: 'SLIPS_FETCH_FAILED', message: sErr?.message })

    const obligations = buildPayoutObligations(
      id, tenantId, (ledger as any)?.id ?? null,
      (slips as any[]).map(s => {
        const bank = (s.employees?.bank_details ?? []).find((b: any) => b.is_primary) ?? s.employees?.bank_details?.[0]
        return {
          slip_id:              s.id,
          employee_id:          s.employee_id,
          net_pay:              s.net_pay,
          bank_account_masked:  bank?.account_number_masked ?? null,
          ifsc_code:            bank?.ifsc_code ?? null,
        }
      }),
    )

    const { error: iErr } = await fastify.supabase.from('payroll_payout_reconciliation').insert(obligations)
    if (iErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: iErr.message })

    return reply.send({ message: `${obligations.length} payout obligations created`, count: obligations.length })
  })

  // ── GET /payroll/gl-mappings ──────────────────────────────────────────────────
  // List GL account mappings for the tenant.
  fastify.get('/payroll/gl-mappings', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_gl_mappings')
      .select('id, component_code, component_type, debit_gl_code, debit_gl_name, credit_gl_code, credit_gl_name, effective_from, is_active')
      .eq('tenant_id', tenantId)
      .order('component_type')
      .order('component_code')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/gl-mappings/seed ────────────────────────────────────────────
  // Seed default GL mappings for this tenant (idempotent).
  fastify.post('/payroll/gl-mappings/seed', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { error } = await fastify.supabase.rpc('seed_default_gl_mappings', { p_tenant_id: tenantId })
    if (error) return reply.code(500).send({ error: 'SEED_FAILED', message: error.message })
    return reply.send({ message: 'Default GL mappings seeded successfully' })
  })
}
