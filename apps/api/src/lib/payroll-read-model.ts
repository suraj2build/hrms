/**
 * payroll-read-model.ts
 *
 * Canonical payroll read model.
 *
 * Provides three pure functions that compute a deterministic, machine-readable
 * visibility state for any payroll slip or run.  No I/O — pure computation
 * given the data already fetched by the route layer.
 *
 * Functions:
 *   buildPayrollVisibilityState(slip, run)
 *     → PayrollVisibilityState
 *     Computes whether a slip is visible, to whom, and why.
 *
 *   buildEmployeePayslipView(slip, run, employee?)
 *     → EmployeePayslipView
 *     Enriches a raw payroll_slips row with run context and visibility.
 *
 *   buildPayrollRunSummary(run, slips)
 *     → PayrollRunSummary
 *     Enriches a payroll_runs row with per-slip visibility counts.
 *
 * Visibility reason contract:
 *   'finalized'      — slip finalized; fully visible to employee + admin
 *   'draft'          — slip in draft run; admin-only (all employees succeeded)
 *   'partial_failed' — slip succeeded; some peers failed in same run; admin-only
 *   'run_failed'     — entire run failed; no slip should logically exist
 *   'missing_slip'   — no slip row found for this employee+month combination
 *   'held'           — slip exists but is held; admin must release before finalization
 *   'not_finalized'  — employee-facing label when slip exists but run is not finalized
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** Deterministic machine-readable reason for a slip's visibility state. */
export type PayrollVisibilityReason =
  | 'finalized'       // slip is finalized — employee + admin can see it
  | 'draft'           // all employees in run succeeded; awaiting finalization
  | 'partial_failed'  // slip succeeded but run has failed peers
  | 'run_failed'      // whole run failed — slip should not exist (guard)
  | 'missing_slip'    // no slip row found for this employee + month
  | 'held'            // slip is held; not yet releasable to employee
  | 'not_finalized'   // employee-facing: slip exists but not yet finalized

export interface PayrollVisibilityState {
  /** True when the slip content should be rendered (applies to admin or employee) */
  visible:          boolean
  /** True for hr_admin and super_admin regardless of slip/run status */
  admin_visible:    boolean
  /** True when the slip is finalized and belongs to the requesting employee */
  employee_visible: boolean
  /** Canonical reason code for why the slip has this visibility state */
  reason:           PayrollVisibilityReason
  /** Human-readable label suitable for display in admin UIs */
  label:            string
}

/** Enriched payroll slip row — used in both admin and ESS API responses */
export interface EmployeePayslipView {
  slip_id:               string
  employee_id:           string
  employee_name:         string | null
  employee_code:         string | null
  month:                 string
  run_id:                string
  run_status:            string
  gross_pay:             number
  net_pay:               number
  lop_days:              number
  lop_amount:            number
  payable_days:          number
  total_working_days:    number
  overtime_hours:        number
  ctc_monthly:           number
  total_deductions:      number
  employer_contributions:number
  component_breakdown:   unknown[]
  /** Slip-level status — 'draft' | 'finalized' | 'held' */
  status:                string
  held_reason:           string | null
  /** Engine-generated warning (e.g. no attendance data found) */
  warning:               string | null
  visibility:            PayrollVisibilityState
}

/** Enriched payroll run with per-slip visibility breakdown */
export interface PayrollRunSummary {
  run_id:            string
  month:             string
  run_status:        string
  employee_count:    number
  total_gross:       number
  total_net:         number
  total_deductions:  number
  total_lop_amount:  number
  error_message:     string | null
  created_at:        string
  finalized_at:      string | null
  /** Count of slips by visibility state */
  visibility_counts: {
    finalized:       number
    draft:           number
    partial_failed:  number
    held:            number
    run_failed:      number
  }
  /** True when at least one slip has a non-null warning */
  has_warnings:      boolean
}

// ── buildPayrollVisibilityState ───────────────────────────────────────────────

const VISIBILITY_LABELS: Record<PayrollVisibilityReason, string> = {
  finalized:       'Finalized — visible to employee',
  draft:           'Draft — pending finalization (admin only)',
  partial_failed:  'Partial run — some employees failed (admin only)',
  run_failed:      'Run failed — no valid slip produced',
  missing_slip:    'No slip found for this employee and month',
  held:            'Held — admin must release before finalization',
  not_finalized:   'Not yet finalized',
}

/**
 * Compute the visibility state for a payroll slip.
 *
 * @param slip  Raw payroll_slips row (or null if no slip exists)
 * @param run   Raw payroll_runs row associated with the slip (or null)
 */
export function buildPayrollVisibilityState(
  slip: { status: string; held_reason?: string | null } | null,
  run:  { status: string } | null,
): PayrollVisibilityState {
  // ── No slip exists for this employee+month ──────────────────────────────────
  if (!slip) {
    return {
      visible:          false,
      admin_visible:    false,
      employee_visible: false,
      reason:           'missing_slip',
      label:            VISIBILITY_LABELS.missing_slip,
    }
  }

  const slipStatus = slip.status
  const runStatus  = run?.status ?? 'unknown'

  // ── Held slip ───────────────────────────────────────────────────────────────
  if (slipStatus === 'held') {
    return {
      visible:          true,
      admin_visible:    true,
      employee_visible: false,
      reason:           'held',
      label:            VISIBILITY_LABELS.held,
    }
  }

  // ── Finalized slip ──────────────────────────────────────────────────────────
  if (slipStatus === 'finalized') {
    return {
      visible:          true,
      admin_visible:    true,
      employee_visible: true,
      reason:           'finalized',
      label:            VISIBILITY_LABELS.finalized,
    }
  }

  // ── Draft slip — run-status–dependent ───────────────────────────────────────
  // (all remaining cases have slipStatus === 'draft')

  if (runStatus === 'failed') {
    // Entire run failed — a draft slip should not exist, but if it does, surface to admin only
    return {
      visible:          true,
      admin_visible:    true,
      employee_visible: false,
      reason:           'run_failed',
      label:            VISIBILITY_LABELS.run_failed,
    }
  }

  if (runStatus === 'partial_failed') {
    return {
      visible:          true,
      admin_visible:    true,
      employee_visible: false,
      reason:           'partial_failed',
      label:            VISIBILITY_LABELS.partial_failed,
    }
  }

  // draft or processing run with a draft slip
  return {
    visible:          true,
    admin_visible:    true,
    employee_visible: false,
    reason:           'draft',
    label:            VISIBILITY_LABELS.draft,
  }
}

// ── buildEmployeePayslipView ──────────────────────────────────────────────────

type RawSlip = {
  id:                    string
  employee_id:           string
  run_id:                string
  month:                 string
  gross_pay:             number
  net_pay:               number
  lop_days:              number
  lop_amount:            number
  payable_days:          number
  total_working_days:    number
  overtime_hours:        number
  ctc_monthly:           number
  total_deductions:      number
  employer_contributions:number
  component_breakdown:   unknown[]
  status:                string
  held_reason:           string | null
  warning:               string | null
}

type RawRun = {
  id:     string
  status: string
}

type RawEmployee = {
  first_name: string
  last_name:  string
  employee_code: string
} | null

/**
 * Enrich a raw payroll_slips DB row with run context and visibility state.
 * Pure — no I/O.
 */
export function buildEmployeePayslipView(
  slip:     RawSlip,
  run:      RawRun,
  employee: RawEmployee = null,
): EmployeePayslipView {
  const visibility = buildPayrollVisibilityState(slip, run)
  return {
    slip_id:               slip.id,
    employee_id:           slip.employee_id,
    employee_name:         employee ? `${employee.first_name} ${employee.last_name}` : null,
    employee_code:         employee?.employee_code ?? null,
    month:                 slip.month,
    run_id:                run.id,
    run_status:            run.status,
    gross_pay:             slip.gross_pay,
    net_pay:               slip.net_pay,
    lop_days:              slip.lop_days,
    lop_amount:            slip.lop_amount,
    payable_days:          slip.payable_days,
    total_working_days:    slip.total_working_days,
    overtime_hours:        slip.overtime_hours,
    ctc_monthly:           slip.ctc_monthly,
    total_deductions:      slip.total_deductions,
    employer_contributions:slip.employer_contributions,
    component_breakdown:   slip.component_breakdown ?? [],
    status:                slip.status,
    held_reason:           slip.held_reason,
    warning:               slip.warning,
    visibility,
  }
}

// ── buildPayrollRunSummary ────────────────────────────────────────────────────

type RawRunFull = {
  id:               string
  month:            string
  status:           string
  employee_count:   number
  total_gross:      number
  total_net:        number
  total_deductions: number
  total_lop_amount: number
  error_message:    string | null
  created_at:       string
  finalized_at:     string | null
}

type SlipForSummary = {
  status:     string
  warning:    string | null
  held_reason?: string | null
}

/**
 * Enrich a payroll_runs row with per-slip visibility counts.
 * Pure — no I/O.
 */
export function buildPayrollRunSummary(
  run:   RawRunFull,
  slips: SlipForSummary[],
): PayrollRunSummary {
  const counts = {
    finalized:      0,
    draft:          0,
    partial_failed: 0,
    held:           0,
    run_failed:     0,
  }

  for (const slip of slips) {
    const vis = buildPayrollVisibilityState(slip, run)
    if (vis.reason === 'finalized')      counts.finalized++
    else if (vis.reason === 'held')       counts.held++
    else if (vis.reason === 'run_failed') counts.run_failed++
    else if (vis.reason === 'partial_failed') counts.partial_failed++
    else counts.draft++
  }

  return {
    run_id:           run.id,
    month:            run.month,
    run_status:       run.status,
    employee_count:   run.employee_count,
    total_gross:      run.total_gross,
    total_net:        run.total_net,
    total_deductions: run.total_deductions,
    total_lop_amount: run.total_lop_amount,
    error_message:    run.error_message,
    created_at:       run.created_at,
    finalized_at:     run.finalized_at,
    visibility_counts: counts,
    has_warnings:     slips.some(s => !!s.warning),
  }
}
