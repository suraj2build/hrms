/**
 * payroll-blocker-engine.ts
 *
 * Pure computation engine for payroll blocker classification.
 * No I/O — all DB operations happen in the route layer.
 *
 * Exports:
 *   classifyFailureRuleCode(stage, reason)
 *     → string  — maps a failure stage + reason to a validation rule code
 *
 *   buildPayrollBlockers(opts)
 *     → PayrollBlockerRow[]  — rows ready to insert into payroll_run_blockers
 *
 *   groupPayrollBlockers(blockers, rules)
 *     → PayrollBlockerGroup[]  — grouped view for the Resolution Center UI
 *
 *   computePayrollRunHealth(blockers)
 *     → PayrollRunHealth  — retry eligibility + severity counts
 *
 * Terminology:
 *   blocker  — a single per-employee failure record (maps to one table row)
 *   group    — blockers aggregated by rule_code (one card in the UI)
 *   health   — aggregate signal derived from all open blockers for a run
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FailedEmployeeInput {
  employee_id:   string
  employee_code: string
  failure_stage: string
  reason:        string
  details?:      Record<string, unknown>
}

export interface ValidationRuleInput {
  code:              string
  name:              string
  description:       string
  severity:          'critical' | 'warning' | 'info'
  blocking:          boolean
  enabled:           boolean
  stage:             string
  remediation_route: string | null
}

/** Shape of a row ready to insert into payroll_run_blockers */
export interface PayrollBlockerRow {
  tenant_id:   string
  run_id:      string
  employee_id: string
  rule_code:   string
  severity:    'critical' | 'warning' | 'info'
  blocking:    boolean
  stage:       string
  reason:      string
  message:     string
  metadata:    Record<string, unknown> | null
  status:      'open'
}

export interface BlockerEmployee {
  blocker_id:      string
  employee_id:     string
  employee_code:   string | null
  employee_name:   string | null
  reason:          string
  message:         string
  status:          'open' | 'resolved' | 'ignored'
  resolved_at:     string | null
  resolution_note: string | null
}

export interface PayrollBlockerGroup {
  rule_code:         string
  rule_name:         string
  rule_description:  string
  stage:             string
  stage_label:       string
  severity:          'critical' | 'warning' | 'info'
  blocking:          boolean
  remediation_route: string | null
  open_count:        number
  resolved_count:    number
  ignored_count:     number
  total_count:       number
  employees:         BlockerEmployee[]
}

export interface PayrollRunHealth {
  /** True only when zero critical+blocking blockers are still open */
  retry_eligible:       boolean
  /** True only when retry_eligible and all warnings resolved/ignored */
  finalize_eligible:    boolean
  critical_open:        number
  warning_open:         number
  info_open:            number
  critical_resolved:    number
  warning_resolved:     number
  total_open:           number
  total_resolved:       number
  total_ignored:        number
  /** Human-readable label for the Resolution Center header */
  health_label:         string
}

// ── Stage labels ──────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<string, string> = {
  data_fetch:             'Data Fetch',
  compensation_validation:'Compensation',
  computation:            'Computation',
  slip_validation:        'Slip Validation',
  db_insert:              'DB Insert',
  unexpected:             'Unexpected',
}

// ── Rule classification table ─────────────────────────────────────────────────
//
// Maps (failure_stage, reason_keywords) → rule_code.
// Evaluated in order — first match wins.
// Used at run time to produce rule_code without a DB lookup.

interface RuleClassification {
  patterns: RegExp[]
  ruleCode: string
}

const RULE_CLASSIFICATIONS: RuleClassification[] = [
  // Compensation missing — must come before COMP_INVALID to avoid false positives
  {
    patterns: [
      /no active compensation/i,
      /compensation.*not found/i,
      /employee cannot be included/i,
    ],
    ruleCode: 'COMP_MISSING',
  },
  // Compensation invalid values
  {
    patterns: [
      /ctc_monthly is negative/i,
      /ctc_monthly is nan/i,
      /ctc_annual is negative/i,
      /future.?dated/i,
      /compensation.*invalid/i,
      /bypassed.*asof/i,
    ],
    ruleCode: 'COMP_INVALID',
  },
  // Attendance completely missing
  {
    patterns: [
      /no attendance data/i,
      /attendance.*empty/i,
      /has_attendance_data.*false/i,
    ],
    ruleCode: 'ATTENDANCE_EMPTY',
  },
  // NaN anywhere in slip
  {
    patterns: [
      /is nan/i,
      /\bnan\b/i,
    ],
    ruleCode: 'PAYROLL_NAN',
  },
  // Infinity
  {
    patterns: [
      /infinity/i,
    ],
    ruleCode: 'INVALID_FORMULA',
  },
  // Negative net pay
  {
    patterns: [
      /net_pay is negative/i,
      /net pay.*negative/i,
    ],
    ruleCode: 'NEGATIVE_NET',
  },
  // Excessive LOP. Matches both the snake_case field name and the
  // human-readable "LOP days" phrasing runs.ts actually produces — found by
  // wiring this rule into a live caller for the first time (closing audit
  // finding G02): the original /lop_days.*exceed/i pattern requires a
  // literal underscore and never matched real "LOP days (X) exceed..."
  // text, silently falling through to the slip_validation stage fallback
  // (PAYROLL_NAN, critical, blocking) instead of this rule (warning,
  // non-blocking) — verified via a real payroll run, not assumed.
  {
    patterns: [
      /lop[\s_]?days.*exceed/i,
      /excessive lop/i,
    ],
    ruleCode: 'LOP_EXCESSIVE',
  },
  // TDS
  {
    patterns: [/\btds\b/i],
    ruleCode: 'TDS_INVALID',
  },
  // ESI
  {
    patterns: [/\besi\b/i],
    ruleCode: 'ESI_INVALID',
  },
  // PF / EPF
  {
    patterns: [/\bpf\b/i, /provident fund/i, /\bepf\b/i],
    ruleCode: 'PF_INVALID',
  },
]

// ── Default rule definitions ──────────────────────────────────────────────────
//
// Used when the DB table hasn't been seeded or a rule_code is unknown.
// Mirrors the seed data in migration 143 — keep in sync.

const DEFAULT_RULES: Record<string, Omit<ValidationRuleInput, 'enabled'>> = {
  COMP_MISSING: {
    code: 'COMP_MISSING',
    name: 'Compensation Missing',
    description: 'No active compensation record found for this employee.',
    severity: 'critical',
    blocking: true,
    stage: 'compensation_validation',
    remediation_route: '/admin/payroll/compensation',
  },
  COMP_INVALID: {
    code: 'COMP_INVALID',
    name: 'Compensation Invalid',
    description: 'Active compensation has invalid values (negative CTC, NaN, future-dated).',
    severity: 'critical',
    blocking: true,
    stage: 'compensation_validation',
    remediation_route: '/admin/payroll/compensation',
  },
  BANK_MISSING: {
    code: 'BANK_MISSING',
    name: 'Bank Account Missing',
    description: 'No verified bank account for salary disbursement.',
    severity: 'critical',
    blocking: true,
    stage: 'data_fetch',
    remediation_route: '/admin/employees',
  },
  ATTENDANCE_EMPTY: {
    code: 'ATTENDANCE_EMPTY',
    name: 'No Attendance Data',
    description: 'No attendance records found. Employee receives full pay (0 LOP).',
    severity: 'warning',
    blocking: false,
    stage: 'data_fetch',
    remediation_route: '/admin/attendance/muster-roll',
  },
  NEGATIVE_NET: {
    code: 'NEGATIVE_NET',
    name: 'Negative Net Pay',
    description: 'Computed net pay is negative after deductions.',
    severity: 'critical',
    blocking: true,
    stage: 'slip_validation',
    remediation_route: '/admin/payroll/simulation',
  },
  INVALID_FORMULA: {
    code: 'INVALID_FORMULA',
    name: 'Invalid Component Formula',
    description: 'A salary component produced NaN or Infinity.',
    severity: 'critical',
    blocking: true,
    stage: 'slip_validation',
    remediation_route: '/admin/payroll/salary-components',
  },
  LOP_EXCESSIVE: {
    code: 'LOP_EXCESSIVE',
    name: 'Excessive LOP Days',
    description: 'LOP days exceed total working days for the period.',
    severity: 'warning',
    blocking: false,
    stage: 'slip_validation',
    remediation_route: '/admin/attendance/muster-roll',
  },
  PAYROLL_NAN: {
    code: 'PAYROLL_NAN',
    name: 'Payroll NaN Value',
    description: 'One or more payroll fields computed as NaN.',
    severity: 'critical',
    blocking: true,
    stage: 'slip_validation',
    remediation_route: '/admin/payroll/simulation',
  },
  TDS_INVALID: {
    code: 'TDS_INVALID',
    name: 'Invalid TDS Calculation',
    description: 'TDS computation returned an invalid value.',
    severity: 'warning',
    blocking: false,
    stage: 'slip_validation',
    remediation_route: '/admin/payroll/statutory/tds',
  },
  ESI_INVALID: {
    code: 'ESI_INVALID',
    name: 'Invalid ESI Contribution',
    description: 'ESI contribution outside statutory rate range.',
    severity: 'warning',
    blocking: false,
    stage: 'slip_validation',
    remediation_route: '/admin/payroll/statutory/esi',
  },
  PF_INVALID: {
    code: 'PF_INVALID',
    name: 'Invalid PF Contribution',
    description: 'PF contribution outside statutory limits.',
    severity: 'warning',
    blocking: false,
    stage: 'slip_validation',
    remediation_route: '/admin/payroll/statutory/epf',
  },
  // Fallback for unknown failures
  UNKNOWN_FAILURE: {
    code: 'UNKNOWN_FAILURE',
    name: 'Unknown Failure',
    description: 'An unexpected error occurred during payroll computation.',
    severity: 'critical',
    blocking: true,
    stage: 'unexpected',
    remediation_route: null,
  },
}

// ── classifyFailureRuleCode ───────────────────────────────────────────────────

/**
 * Map a failure stage + reason string to a validation rule code.
 *
 * Order: reason-keyword patterns first (more specific), then stage fallbacks.
 * Returns 'UNKNOWN_FAILURE' when no pattern matches.
 */
export function classifyFailureRuleCode(
  stage:  string,
  reason: string,
): string {
  // Keyword-pattern matching (reason-first, most specific)
  for (const cls of RULE_CLASSIFICATIONS) {
    if (cls.patterns.some(p => p.test(reason))) {
      return cls.ruleCode
    }
  }

  // Stage-level fallbacks when reason doesn't match any pattern
  switch (stage) {
    case 'compensation_validation': return 'COMP_MISSING'
    case 'data_fetch':              return 'ATTENDANCE_EMPTY'
    case 'slip_validation':         return 'PAYROLL_NAN'
    case 'db_insert':               return 'UNKNOWN_FAILURE'
    default:                        return 'UNKNOWN_FAILURE'
  }
}

// ── buildPayrollBlockers ──────────────────────────────────────────────────────

/**
 * Build payroll_run_blockers insert rows from a list of failed employees.
 *
 * @param tenantId          Tenant context
 * @param runId             The payroll run that produced these failures
 * @param failedEmployees   Per-employee failure records from the run handler
 * @param dbRules           Optional: validation rules from payroll_validation_rules table.
 *                          When provided, overrides severity/blocking from DEFAULT_RULES.
 */
export function buildPayrollBlockers(opts: {
  tenantId:        string
  runId:           string
  failedEmployees: FailedEmployeeInput[]
  dbRules?:        ValidationRuleInput[]
}): PayrollBlockerRow[] {
  const { tenantId, runId, failedEmployees, dbRules } = opts

  // Build a rule lookup map: code → merged rule (DB overrides defaults)
  const ruleMap = new Map<string, typeof DEFAULT_RULES[string]>()
  for (const [code, def] of Object.entries(DEFAULT_RULES)) {
    ruleMap.set(code, def)
  }
  if (dbRules) {
    for (const r of dbRules) {
      if (!r.enabled) continue  // skip disabled rules — don't create blockers for them
      ruleMap.set(r.code, r)
    }
  }

  const rows: PayrollBlockerRow[] = []

  for (const f of failedEmployees) {
    const ruleCode = classifyFailureRuleCode(f.failure_stage, f.reason)
    const rule     = ruleMap.get(ruleCode) ?? DEFAULT_RULES.UNKNOWN_FAILURE

    rows.push({
      tenant_id:   tenantId,
      run_id:      runId,
      employee_id: f.employee_id,
      rule_code:   ruleCode,
      severity:    rule.severity,
      blocking:    rule.blocking,
      stage:       f.failure_stage,
      reason:      f.reason,
      message:     buildBlockerMessage(ruleCode, rule.description, f.reason),
      metadata:    f.details ? { details: f.details } : null,
      status:      'open',
    })
  }

  return rows
}

/**
 * Build a human-readable message for the Resolution Center.
 * Strips raw DB error context not suitable for HR users.
 */
function buildBlockerMessage(
  ruleCode:    string,
  description: string,
  rawReason:   string,
): string {
  // For these rules, the description is already clear — don't append raw reason
  const DESCRIPTION_ONLY = new Set([
    'COMP_MISSING', 'BANK_MISSING', 'ATTENDANCE_EMPTY',
  ])
  if (DESCRIPTION_ONLY.has(ruleCode)) return description

  // For validation failures, show a cleaned version of the raw reason
  // Strip DB error codes, stack frames, and technical identifiers
  const cleaned = rawReason
    .replace(/\[code=[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)

  return cleaned || description
}

// ── groupPayrollBlockers ──────────────────────────────────────────────────────

/**
 * Group a flat list of blocker DB rows (already fetched with employee info)
 * into per-rule cards suitable for the Resolution Center.
 *
 * @param blockers  Rows from payroll_run_blockers (joined with employees)
 * @param dbRules   Rows from payroll_validation_rules for enrichment
 */
export function groupPayrollBlockers(
  blockers: Array<{
    id:              string
    employee_id:     string | null
    rule_code:       string
    severity:        'critical' | 'warning' | 'info'
    blocking:        boolean
    stage:           string
    reason:          string
    message:         string
    status:          'open' | 'resolved' | 'ignored'
    resolved_at:     string | null
    resolution_note: string | null
    // from join:
    employee_name?:  string | null
    employee_code?:  string | null
  }>,
  dbRules: ValidationRuleInput[],
): PayrollBlockerGroup[] {
  const ruleIndex = new Map(dbRules.map(r => [r.code, r]))

  // Group by rule_code
  const groupMap = new Map<string, PayrollBlockerGroup>()

  for (const b of blockers) {
    const dbRule = ruleIndex.get(b.rule_code)
    const defRule = DEFAULT_RULES[b.rule_code] ?? DEFAULT_RULES.UNKNOWN_FAILURE

    if (!groupMap.has(b.rule_code)) {
      groupMap.set(b.rule_code, {
        rule_code:         b.rule_code,
        rule_name:         dbRule?.name         ?? defRule.name,
        rule_description:  dbRule?.description  ?? defRule.description,
        stage:             b.stage,
        stage_label:       STAGE_LABELS[b.stage] ?? b.stage,
        severity:          b.severity,
        blocking:          b.blocking,
        remediation_route: dbRule?.remediation_route ?? defRule.remediation_route,
        open_count:     0,
        resolved_count: 0,
        ignored_count:  0,
        total_count:    0,
        employees:      [],
      })
    }

    const group = groupMap.get(b.rule_code)!
    group.total_count++
    if (b.status === 'open')     group.open_count++
    if (b.status === 'resolved') group.resolved_count++
    if (b.status === 'ignored')  group.ignored_count++

    group.employees.push({
      blocker_id:      b.id,
      employee_id:     b.employee_id ?? '',
      employee_code:   b.employee_code   ?? null,
      employee_name:   b.employee_name   ?? null,
      reason:          b.reason,
      message:         b.message,
      status:          b.status,
      resolved_at:     b.resolved_at,
      resolution_note: b.resolution_note,
    })
  }

  // Sort: critical first, then warning, then info; within severity: open first
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  return [...groupMap.values()].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    b.open_count - a.open_count
  )
}

// ── getBlockerResolutionActions ──────────────────────────────────────────────

export interface BlockerResolutionAction {
  /** Short action label for the UI button */
  label:        string
  /** URL to navigate to for resolution */
  href:         string
  /** Whether this action is auto-executable by the system (vs manual operator step) */
  auto:         boolean
  /** Description of what the action does */
  description:  string
}

/**
 * For a given rule code, return structured resolution actions that the
 * Resolution Center can render as actionable buttons or links.
 *
 * "auto" actions are those the system can perform without operator input
 * (e.g. "regenerate components").  "manual" actions require the operator
 * to navigate to a page and make a decision.
 */
export function getBlockerResolutionActions(
  ruleCode: string,
): BlockerResolutionAction[] {
  switch (ruleCode) {
    case 'COMP_MISSING':
      return [
        {
          label:       'Set Up Compensation',
          href:        '/admin/employees',
          auto:        false,
          description: 'Navigate to the employee profile and use "Set Up Compensation" to assign CTC and components.',
        },
      ]

    case 'COMP_INVALID':
      return [
        {
          label:       'Edit Compensation',
          href:        '/admin/employees',
          auto:        false,
          description: 'Open the employee profile, click "Edit Compensation", and correct the CTC or component values.',
        },
        {
          label:       'Comp. Revisions',
          href:        '/admin/payroll/compensation-revisions',
          auto:        false,
          description: 'Review pending compensation revisions that may have introduced invalid values.',
        },
      ]

    case 'BANK_MISSING':
      return [
        {
          label:       'Add Bank Details',
          href:        '/admin/employees',
          auto:        false,
          description: "Navigate to the employee's Bank & Statutory tab and add a verified bank account.",
        },
      ]

    case 'ATTENDANCE_EMPTY':
      return [
        {
          label:       'Muster Roll',
          href:        '/admin/attendance/muster-roll',
          auto:        false,
          description: 'Open the Muster Roll and verify attendance for the affected employees.',
        },
        {
          label:       'Recompute Attendance',
          href:        '/admin/attendance/muster-roll',
          auto:        true,
          description: 'Trigger attendance recomputation for the period to pick up any missing punch records.',
        },
      ]

    case 'NEGATIVE_NET':
      return [
        {
          label:       'Review Deductions',
          href:        '/admin/payroll/simulation',
          auto:        false,
          description: 'Use the Payroll Simulation to identify which deductions exceed gross earnings.',
        },
        {
          label:       'Edit Compensation',
          href:        '/admin/employees',
          auto:        false,
          description: 'Open the employee profile and remove or reduce deduction components.',
        },
      ]

    case 'PAYROLL_NAN':
    case 'INVALID_FORMULA':
      return [
        {
          label:       'Salary Components',
          href:        '/admin/payroll/salary-components',
          auto:        false,
          description: 'Review the salary component definitions for invalid formulas (0 base for pct_of_basic, etc.).',
        },
        {
          label:       'Dry Run',
          href:        '/admin/payroll',
          auto:        false,
          description: 'Run a dry-run payroll to pinpoint the component producing NaN.',
        },
      ]

    case 'LOP_EXCESSIVE':
      return [
        {
          label:       'Muster Roll',
          href:        '/admin/attendance/muster-roll',
          auto:        false,
          description: 'Verify attendance records — LOP days exceed working days for the period.',
        },
      ]

    case 'TDS_INVALID':
      return [
        {
          label:       'TDS Settings',
          href:        '/admin/payroll/statutory/tds',
          auto:        false,
          description: 'Review TDS computation settings for the affected employee.',
        },
      ]

    case 'ESI_INVALID':
      return [
        {
          label:       'ESI Management',
          href:        '/admin/payroll/statutory/esi',
          auto:        false,
          description: 'Review ESI eligibility and contribution rates.',
        },
      ]

    case 'PF_INVALID':
      return [
        {
          label:       'EPF Management',
          href:        '/admin/payroll/statutory/epf',
          auto:        false,
          description: 'Review EPF wage ceiling, contribution rates, and employee PF flags.',
        },
      ]

    default:
      return [
        {
          label:       'Investigate',
          href:        '/admin/payroll/investigate',
          auto:        false,
          description: 'Use the Payroll Investigation tool to diagnose this failure.',
        },
      ]
  }
}

// ── computePayrollRunHealth ───────────────────────────────────────────────────

/**
 * Compute retry/finalize eligibility and severity counts from open blockers.
 *
 * Retry is eligible when: zero critical+blocking blockers are still open.
 * Finalize is eligible when: retry_eligible AND zero warnings are still open.
 */
export function computePayrollRunHealth(
  blockers: Array<{
    severity: 'critical' | 'warning' | 'info'
    blocking: boolean
    status:   'open' | 'resolved' | 'ignored'
  }>,
): PayrollRunHealth {
  let critical_open    = 0
  let warning_open     = 0
  let info_open        = 0
  let critical_resolved = 0
  let warning_resolved  = 0
  let total_open       = 0
  let total_resolved   = 0
  let total_ignored    = 0

  for (const b of blockers) {
    if (b.status === 'resolved') {
      total_resolved++
      if (b.severity === 'critical') critical_resolved++
      if (b.severity === 'warning')  warning_resolved++
    } else if (b.status === 'ignored') {
      total_ignored++
    } else {
      // open
      total_open++
      if (b.severity === 'critical') critical_open++
      if (b.severity === 'warning')  warning_open++
      if (b.severity === 'info')     info_open++
    }
  }

  // Any open blocker with blocking=true prevents retry — severity is just a
  // display/coloring dimension and carries no DB-level guarantee of matching
  // blocking (a rule can be configured with severity='warning', blocking=true).
  const blocking_open = blockers.filter(
    b => b.status === 'open' && b.blocking,
  ).length

  const retry_eligible    = blocking_open === 0
  const finalize_eligible = retry_eligible && warning_open === 0

  const health_label =
    total_open === 0       ? 'All blockers resolved — ready to retry'
    : !retry_eligible      ? `${blocking_open} blocking issue${blocking_open !== 1 ? 's' : ''} must be resolved before retry`
    : warning_open > 0     ? `${warning_open} warning${warning_open !== 1 ? 's' : ''} pending — retry allowed`
                           : 'Ready to retry'

  return {
    retry_eligible,
    finalize_eligible,
    critical_open,
    warning_open,
    info_open,
    critical_resolved,
    warning_resolved,
    total_open,
    total_resolved,
    total_ignored,
    health_label,
  }
}
