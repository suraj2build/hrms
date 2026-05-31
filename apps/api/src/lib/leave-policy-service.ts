/**
 * LeavePolicyService
 *
 * Resolves the effective leave policy rule for an employee using a priority
 * chain.  The chain is evaluated once per resolution call, then memoised by
 * the caller for the duration of a request.
 *
 * Priority (highest → lowest):
 *   1. employee        — explicit assignment on this employee
 *   2. department      — employee's current department (from job_history)
 *   3. work_location   — employee's current work location (from job_history)
 *   4. default         — the one named policy flagged is_default = true
 *   5. legacy          — leave_policies table (one-per-leave-type, pre-054)
 *
 * Enhancement summary (migration 055):
 *   • Step 1 — Resolve response includes resolved_from (assignment.id),
 *               source_id (winning scope_id), priority_rank (1-5), and an
 *               optional evaluated_candidates debug array.
 *   • Step 2 — Assignments and rules are filtered by effective date window.
 *               All resolve functions accept an optional `asOf` date
 *               (defaults to today).
 *   • Step 3 — site-level resolution uses work_location_id from job_history
 *               (verified — already the same column, no separate site_id).
 *   • Step 4 — Eligibility (tenure, employment_type) is evaluated per rule
 *               and attached as `eligible` + `eligibility_reason` flags.
 *               Resolution is NOT blocked — callers decide how to respond.
 *
 * Exported surface:
 *   PolicyRule                        — canonical rule shape (with eligibility)
 *   PolicyCandidate                   — debug shape for evaluated_candidates
 *   PolicyResolution                  — full resolution result
 *   resolveEffectivePolicyRule        — one leave_type for one employee
 *   resolveAllPolicyRules             — all leave_types for one employee (Map)
 *   resolveEffectivePolicyForEmployee — all rules + metadata (used by API)
 *   leavePoliciesFromLegacy           — convert legacy leave_policies rows
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { persistEvaluationLog } from './policy-governance.js'

// ── Canonical rule shape ───────────────────────────────────────────────────────

export interface PolicyRule {
  id:                     string
  policy_id:              string | null   // null for legacy source
  policy_name:            string
  leave_type_id:          string
  leave_type_name:        string
  accrual_type:           'monthly' | 'quarterly' | 'yearly' | 'upfront'
  accrual_days_per_year:  number
  max_accrual_balance:    number | null
  eligibility_days:       number
  prorate_on_joining:     boolean
  carry_forward_enabled:  boolean
  carry_forward_max_days: number | null
  expiry_days:            number | null
  max_consecutive_days:   number | null
  min_gap_days:           number
  year_type:              'calendar' | 'financial'
  /**
   * Which priority level supplied this rule.
   *   'employee'      — direct employee assignment
   *   'department'    — matched via employee's department
   *   'work_location' — matched via employee's work location / site
   *   'default'       — the default named policy
   *   'legacy'        — leave_policies (pre-engine) table
   */
  source: 'employee_override' | 'employee' | 'department' | 'work_location' | 'site' | 'site_default' | 'default' | 'legacy'

  // ── Step 1 additions ──────────────────────────────────────────────────────
  /** UUID of the leave_policy_assignments row that provided this rule.
   *  Null for legacy-sourced rules (no assignment row). */
  resolved_from:  string | null
  /** scope_id of the winning assignment (employee UUID, department UUID, etc.).
   *  Null for 'default' scope and for legacy rules. */
  source_id:      string | null
  /** Numeric priority rank: 1=employee, 2=department, 3=work_location,
   *  4=default, 5=legacy. Lower number = higher priority. */
  priority_rank:  1 | 2 | 3 | 4 | 5

  // ── Step 4 additions ──────────────────────────────────────────────────────
  /** Whether the employee meets all eligibility criteria for this rule.
   *  Non-blocking — callers decide whether to reject or just warn. */
  eligible:             boolean
  /** Human-readable reason when eligible = false.  Null when eligible = true. */
  eligibility_reason:   string | null
}

// ── Debug shape for evaluated_candidates ──────────────────────────────────────

export interface PolicyCandidate {
  scope_type:    string
  scope_id:      string | null
  priority:      number
  matched:       boolean
  policy_id:     string | null
  assignment_id: string | null
}

// ── Internal DB row shapes ─────────────────────────────────────────────────────

interface DbPolicyRule {
  id:                              string
  policy_id:                       string
  leave_type_id:                   string
  accrual_type:                    string
  accrual_days_per_year:           number
  max_accrual_balance:             number | null
  eligibility_days:                number
  prorate_on_joining:              boolean
  carry_forward_enabled:           boolean
  carry_forward_max_days:          number | null
  expiry_days:                     number | null
  max_consecutive_days:            number | null
  min_gap_days:                    number
  effective_from:                  string | null  // Step 2
  effective_to:                    string | null  // Step 2
  eligibility_min_tenure_days:     number         // Step 4
  eligibility_employment_types:    string[]       // Step 4
}

interface DbLegacyPolicy {
  id:                     string
  leave_type_id:          string
  accrual_type:           string
  accrual_days_per_year:  number
  max_accrual_balance:    number | null
  eligibility_days:       number
  prorate_on_joining:     boolean
  carry_forward_enabled:  boolean
  carry_forward_max_days: number | null
  year_type:              string
  expiry_days:            number | null
}

// ── Employee job context (one DB query shared across resolvers) ────────────────

interface EmployeeJobContext {
  department_id:              string | null
  work_location_id:           string | null
  joining_date:               string | null   // Step 4 — for tenure check
  employment_type:            string | null   // Step 4 — for employment-type check
  // Leave Governance (migration 156)
  site_id:                    string | null   // employee's site — used for 'site' scope assignment
  leave_policy_override_id:   string | null   // employees.leave_policy_override_id — highest priority
  site_default_leave_policy_id: string | null // sites.default_leave_policy_id — FK fallback
}

// ── Published policy ID set (governance gate) ─────────────────────────────────

/**
 * Fetch the set of policy IDs that are currently in 'published' status.
 * Used to filter out draft/review/archived policies from resolution.
 */
async function fetchPublishedPolicyIds(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from('leave_policy_masters')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'published')
  return new Set(((data as Array<{ id: string }>) ?? []).map(r => r.id))
}

async function fetchJobContext(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<EmployeeJobContext> {
  // Fetch work location + department from current job_history row
  const { data: job } = await supabase
    .from('job_history')
    .select('department_id, work_location_id, employment_type')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('is_current',  true)
    .maybeSingle()

  // Fetch joining_date, site_id, and leave_policy_override_id from employees.
  // Also join to sites to get the site's default_leave_policy_id.
  const { data: emp } = await supabase
    .from('employees')
    .select(`
      joining_date,
      site_id,
      leave_policy_override_id,
      sites!employees_site_id_fkey (
        default_leave_policy_id
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('id',        employeeId)
    .maybeSingle()

  const empRow = emp as unknown as {
    joining_date:             string | null
    site_id:                  string | null
    leave_policy_override_id: string | null
    sites: { default_leave_policy_id: string | null } | null
  } | null

  return {
    department_id:               (job as any)?.department_id    ?? null,
    work_location_id:            (job as any)?.work_location_id ?? null,
    employment_type:             (job as any)?.employment_type  ?? null,
    joining_date:                empRow?.joining_date            ?? null,
    site_id:                     empRow?.site_id                 ?? null,
    leave_policy_override_id:    empRow?.leave_policy_override_id ?? null,
    site_default_leave_policy_id: empRow?.sites?.default_leave_policy_id ?? null,
  }
}

// ── Effective-date filter helper (Step 2) ─────────────────────────────────────

/**
 * Return true when a row with nullable effective_from / effective_to windows
 * is active on the given date.
 *
 * Rules:
 *   effective_from NULL  → no start restriction
 *   effective_to   NULL  → no end restriction
 *   date in [from, to]  → active
 */
function isActiveOn(
  from: string | null,
  to:   string | null,
  date: string,        // YYYY-MM-DD
): boolean {
  if (from && date < from) return false
  if (to   && date > to)   return false
  return true
}

// ── Assignment resolution ──────────────────────────────────────────────────────

interface ResolvedAssignment {
  policy_id:      string
  source:         PolicyRule['source']
  priority:       number
  assignment_id:  string          // Step 1 — resolved_from
  scope_id:       string | null   // Step 1 — source_id
}

/**
 * Find the policy_id that applies to this employee, using the priority chain.
 * Returns the best assignment or null when no named policy applies.
 *
 * @param asOf               YYYY-MM-DD used for effective-date filtering (Step 2)
 * @param publishedPolicyIds When provided, only assignments to published policies
 *                           are considered (governance gate — Phase 1).
 */
async function resolveAssignment(
  supabase:            SupabaseClient,
  tenantId:            string,
  employeeId:          string,
  ctx:                 EmployeeJobContext,
  asOf:                string,
  publishedPolicyIds?: Set<string>,
): Promise<ResolvedAssignment | null> {

  // ── Priority 0: employees.leave_policy_override_id (highest, direct FK) ──────
  // Bypasses the entire assignment lookup when set.
  if (ctx.leave_policy_override_id) {
    if (!publishedPolicyIds || publishedPolicyIds.has(ctx.leave_policy_override_id)) {
      return {
        policy_id:     ctx.leave_policy_override_id,
        source:        'employee_override',
        priority:      0,
        assignment_id: 'direct_fk',   // synthetic — not an assignment row
        scope_id:      employeeId,
      }
    }
  }

  // Collect all relevant scope candidates (highest priority first)
  const candidates: Array<{
    scope_type: string
    scope_id:   string | null
    priority:   number
  }> = [
    { scope_type: 'employee',      scope_id: employeeId,          priority: 1 },
    ...(ctx.department_id    ? [{ scope_type: 'department',    scope_id: ctx.department_id,    priority: 2 }] : []),
    ...(ctx.work_location_id ? [{ scope_type: 'work_location', scope_id: ctx.work_location_id, priority: 3 }] : []),
    // ── NEW (migration 156): site-level assignment ───────────────────────────
    ...(ctx.site_id ? [{ scope_type: 'site', scope_id: ctx.site_id, priority: 4 }] : []),
    { scope_type: 'default',       scope_id: null,                priority: 5 },
  ]

  // Fetch all assignments for this tenant that match any candidate scope_type.
  // We include effective_from / effective_to for Step 2 filtering.
  const { data: assignments, error } = await supabase
    .from('leave_policy_assignments')
    .select('id, policy_id, scope_type, scope_id, effective_from, effective_to')
    .eq('tenant_id', tenantId)
    .in('scope_type', candidates.map(c => c.scope_type))

  // Filter by effective date window (Step 2), then score by priority
  let best: ResolvedAssignment | null = null

  if (!error && assignments?.length) {
    for (const row of assignments as Array<{
      id: string
      policy_id: string
      scope_type: string
      scope_id: string | null
      effective_from: string | null
      effective_to: string | null
    }>) {
      // Step 2 — Skip assignments outside their effective window
      if (!isActiveOn(row.effective_from, row.effective_to, asOf)) continue

      // Governance gate — skip assignments pointing to non-published policies
      if (publishedPolicyIds && !publishedPolicyIds.has(row.policy_id)) continue

      // Match against our pre-built candidate list
      const match = candidates.find(
        c => c.scope_type === row.scope_type && c.scope_id === row.scope_id,
      )
      if (!match) continue

      if (!best || match.priority < best.priority) {
        best = {
          policy_id:     row.policy_id,
          source:        row.scope_type as PolicyRule['source'],
          priority:      match.priority,
          assignment_id: row.id,
          scope_id:      row.scope_id,
        }
      }
    }
  }

  if (best) return best

  // ── Priority 6: sites.default_leave_policy_id (FK fallback) ─────────────────
  // Used when no assignment-based match was found for this employee's site.
  if (ctx.site_default_leave_policy_id) {
    if (!publishedPolicyIds || publishedPolicyIds.has(ctx.site_default_leave_policy_id)) {
      return {
        policy_id:     ctx.site_default_leave_policy_id,
        source:        'site_default',
        priority:      6,
        assignment_id: 'site_fk',   // synthetic — not an assignment row
        scope_id:      ctx.site_id,
      }
    }
  }

  return null
}

// ── Policy rule loader ─────────────────────────────────────────────────────────

/**
 * Load all leave_policy_rules for a given policy_id, keyed by leave_type_id.
 * Filters by effective date window (Step 2).
 */
async function loadPolicyRules(
  supabase:  SupabaseClient,
  tenantId:  string,
  policyId:  string,
  asOf:      string,
): Promise<Map<string, DbPolicyRule>> {
  const { data } = await supabase
    .from('leave_policy_rules')
    .select(`
      id, policy_id, leave_type_id,
      accrual_type, accrual_days_per_year, max_accrual_balance,
      eligibility_days, prorate_on_joining,
      carry_forward_enabled, carry_forward_max_days,
      expiry_days, max_consecutive_days, min_gap_days,
      effective_from, effective_to,
      eligibility_min_tenure_days, eligibility_employment_types
    `)
    .eq('tenant_id', tenantId)
    .eq('policy_id', policyId)

  const map = new Map<string, DbPolicyRule>()
  for (const row of (data as DbPolicyRule[]) ?? []) {
    // Step 2 — skip rules outside their own effective window
    if (!isActiveOn(row.effective_from, row.effective_to, asOf)) continue
    map.set(row.leave_type_id, row)
  }
  return map
}

// ── Leave type name lookup ─────────────────────────────────────────────────────

async function loadLeaveTypeNames(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('leave_types')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  const map = new Map<string, string>()
  for (const row of (data as Array<{ id: string; name: string }>) ?? []) {
    map.set(row.id, row.name)
  }
  return map
}

// ── Eligibility evaluation (Step 4) ───────────────────────────────────────────

interface EligibilityEvaluation {
  eligible:           boolean
  eligibility_reason: string | null
}

/**
 * Evaluate whether an employee meets the eligibility criteria embedded in a
 * rule.  This is non-blocking — callers decide whether to surface it as an
 * error or a warning.
 *
 * Checks performed (in order; first failure wins):
 *   1. Minimum tenure (eligibility_min_tenure_days)
 *   2. Employment-type restriction (eligibility_employment_types)
 *
 * NOTE: The existing `eligibility_days` field on the rule controls the
 *       waiting period before first leave *accrual* (handled by entitlement
 *       service).  `eligibility_min_tenure_days` here is the minimum tenure
 *       required before the employee is allowed to *use* the leave.
 */
function evaluateEligibility(
  rule: Pick<DbPolicyRule, 'eligibility_min_tenure_days' | 'eligibility_employment_types'>,
  ctx:  EmployeeJobContext,
  asOf: string,
): EligibilityEvaluation {
  // 1. Tenure check
  if (rule.eligibility_min_tenure_days > 0 && ctx.joining_date) {
    const joiningMs = Date.parse(`${ctx.joining_date}T12:00:00.000Z`)
    const asOfMs    = Date.parse(`${asOf}T12:00:00.000Z`)
    const tenureDays = Math.floor((asOfMs - joiningMs) / 86_400_000)
    if (tenureDays < rule.eligibility_min_tenure_days) {
      return {
        eligible:           false,
        eligibility_reason: `Minimum tenure of ${rule.eligibility_min_tenure_days} days required (current: ${tenureDays} days).`,
      }
    }
  }

  // 2. Employment-type restriction
  if (
    rule.eligibility_employment_types.length > 0 &&
    ctx.employment_type &&
    !rule.eligibility_employment_types.includes(ctx.employment_type)
  ) {
    return {
      eligible:           false,
      eligibility_reason: `Leave not available for employment type "${ctx.employment_type}". ` +
                          `Eligible types: ${rule.eligibility_employment_types.join(', ')}.`,
    }
  }

  return { eligible: true, eligibility_reason: null }
}

// ── Public: resolve one rule ───────────────────────────────────────────────────

/**
 * Resolve the effective policy rule for a specific (employee, leave_type).
 *
 * @param asOf             YYYY-MM-DD to use for effective-date filtering (Step 2).
 *                         Defaults to today (UTC).
 * @param opts.persistLog  When true, write a row to policy_evaluation_log.
 * @param opts.triggerContext  The trigger label ('leave_apply', 'accrual', 'api', etc.).
 * @param opts.isSimulation   When true, marks the evaluation log row as simulation.
 *
 * Returns null only when neither a named policy nor a legacy policy exists
 * for this leave type.
 */
export async function resolveEffectivePolicyRule(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  asOf?:        string,
  opts?: {
    persistLog?:     boolean
    triggerContext?: string
    isSimulation?:   boolean
  },
): Promise<PolicyRule | null> {
  const effectiveAsOf = asOf ?? new Date().toISOString().slice(0, 10)

  const [ctx, leaveTypeNames, publishedPolicyIds] = await Promise.all([
    fetchJobContext(supabase, tenantId, employeeId),
    loadLeaveTypeNames(supabase, tenantId),
    fetchPublishedPolicyIds(supabase, tenantId),
  ])

  const assignment = await resolveAssignment(
    supabase, tenantId, employeeId, ctx, effectiveAsOf, publishedPolicyIds,
  )

  if (assignment) {
    const rules = await loadPolicyRules(supabase, tenantId, assignment.policy_id, effectiveAsOf)
    const rule  = rules.get(leaveTypeId)

    if (rule) {
      // Fetch policy name + year_type + version
      const { data: master } = await supabase
        .from('leave_policy_masters')
        .select('name, year_type, version')
        .eq('id', assignment.policy_id)
        .single()

      const eligibility = evaluateEligibility(rule, ctx, effectiveAsOf)
      const resolved = buildPolicyRule(rule, assignment, master as { name: string; year_type: string } | null, leaveTypeNames, eligibility)

      // Evaluation log (fire-and-forget)
      if (opts?.persistLog) {
        persistEvaluationLog(supabase, {
          tenantId,
          employeeId,
          leaveTypeId,
          evaluatedOn:        effectiveAsOf,
          triggerContext:     opts.triggerContext ?? 'api',
          policyId:           assignment.policy_id,
          policyName:         (master as any)?.name ?? null,
          policyVersion:      (master as any)?.version ?? null,
          ruleId:             rule.id,
          resolvedVia:        assignment.source,
          scopeId:            assignment.scope_id,
          priorityRank:       assignment.priority,
          eligible:           eligibility.eligible,
          eligibilityReason:  eligibility.eligibility_reason,
          evaluatedCandidates: [],
          isSimulation:       opts.isSimulation ?? false,
        }).catch(() => { /* non-fatal */ })
      }

      return resolved
    }
  }

  // Fall through to legacy leave_policies
  const legacyRule = await resolveLegacyRule(supabase, tenantId, leaveTypeId, leaveTypeNames)

  if (legacyRule && opts?.persistLog) {
    persistEvaluationLog(supabase, {
      tenantId,
      employeeId,
      leaveTypeId,
      evaluatedOn:        effectiveAsOf,
      triggerContext:     opts.triggerContext ?? 'api',
      policyId:           null,
      policyName:         'Default (legacy)',
      policyVersion:      null,
      ruleId:             legacyRule.id,
      resolvedVia:        'legacy',
      scopeId:            null,
      priorityRank:       5,
      eligible:           true,
      eligibilityReason:  null,
      evaluatedCandidates: [],
      isSimulation:       opts.isSimulation ?? false,
    }).catch(() => { /* non-fatal */ })
  }

  return legacyRule
}

// ── Public: resolve all rules for an employee ─────────────────────────────────

/**
 * Resolve policy rules for ALL leave types for an employee.
 *
 * @param asOf             YYYY-MM-DD for effective-date filtering (Step 2).
 * @param opts.persistLog  When true, write rows to policy_evaluation_log.
 * @param opts.triggerContext  The trigger label for all log rows.
 * @param opts.isSimulation   Marks all evaluation log rows as simulation.
 *
 * Algorithm:
 * 1. Determine the named policy via assignment resolution (published only).
 * 2. For each leave type, use the named policy rule if it exists.
 * 3. Fall back to legacy leave_policies for any leave_type not covered.
 * 4. Leave types with no policy at all are omitted from the map.
 */
export async function resolveAllPolicyRules(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  asOf?:      string,
  opts?: {
    persistLog?:     boolean
    triggerContext?: string
    isSimulation?:   boolean
  },
): Promise<Map<string, PolicyRule>> {
  const effectiveAsOf = asOf ?? new Date().toISOString().slice(0, 10)

  const [ctx, leaveTypeNames, publishedPolicyIds] = await Promise.all([
    fetchJobContext(supabase, tenantId, employeeId),
    loadLeaveTypeNames(supabase, tenantId),
    fetchPublishedPolicyIds(supabase, tenantId),
  ])

  const result = new Map<string, PolicyRule>()

  const assignment = await resolveAssignment(
    supabase, tenantId, employeeId, ctx, effectiveAsOf, publishedPolicyIds,
  )

  // Load named policy rules (if any assignment found)
  let namedRules  = new Map<string, DbPolicyRule>()
  let masterMeta: { name: string; year_type: string; version: number } | null = null

  if (assignment) {
    const [rules, master] = await Promise.all([
      loadPolicyRules(supabase, tenantId, assignment.policy_id, effectiveAsOf),
      supabase.from('leave_policy_masters')
        .select('name, year_type, version')
        .eq('id', assignment.policy_id)
        .single()
        .then(r => r.data as { name: string; year_type: string; version: number } | null),
    ])
    namedRules = rules
    masterMeta = master
  }

  // Populate from named policy rules
  for (const [ltId, rule] of namedRules) {
    const eligibility = evaluateEligibility(rule, ctx, effectiveAsOf)
    result.set(ltId, buildPolicyRule(rule, assignment!, masterMeta, leaveTypeNames, eligibility))

    // Evaluation log (fire-and-forget)
    if (opts?.persistLog) {
      persistEvaluationLog(supabase, {
        tenantId,
        employeeId,
        leaveTypeId:        ltId,
        evaluatedOn:        effectiveAsOf,
        triggerContext:     opts.triggerContext ?? 'api',
        policyId:           assignment!.policy_id,
        policyName:         masterMeta?.name ?? null,
        policyVersion:      masterMeta?.version ?? null,
        ruleId:             rule.id,
        resolvedVia:        assignment!.source,
        scopeId:            assignment!.scope_id,
        priorityRank:       assignment!.priority,
        eligible:           eligibility.eligible,
        eligibilityReason:  eligibility.eligibility_reason,
        evaluatedCandidates: [],
        isSimulation:       opts.isSimulation ?? false,
      }).catch(() => { /* non-fatal */ })
    }
  }

  // Gap-fill from legacy leave_policies
  const { data: legacy } = await supabase
    .from('leave_policies')
    .select(`
      id, leave_type_id,
      accrual_type, accrual_days_per_year, max_accrual_balance,
      eligibility_days, prorate_on_joining,
      carry_forward_enabled, carry_forward_max_days,
      year_type, expiry_days
    `)
    .eq('tenant_id', tenantId)

  for (const row of (legacy as DbLegacyPolicy[]) ?? []) {
    if (result.has(row.leave_type_id)) continue  // already covered by named policy
    const legacyRule = buildLegacyRule(row, leaveTypeNames)
    if (legacyRule) {
      result.set(row.leave_type_id, legacyRule)

      if (opts?.persistLog) {
        persistEvaluationLog(supabase, {
          tenantId,
          employeeId,
          leaveTypeId:        row.leave_type_id,
          evaluatedOn:        effectiveAsOf,
          triggerContext:     opts.triggerContext ?? 'api',
          policyId:           null,
          policyName:         'Default (legacy)',
          policyVersion:      null,
          ruleId:             row.id,
          resolvedVia:        'legacy',
          scopeId:            null,
          priorityRank:       5,
          eligible:           true,
          eligibilityReason:  null,
          evaluatedCandidates: [],
          isSimulation:       opts.isSimulation ?? false,
        }).catch(() => { /* non-fatal */ })
      }
    }
  }

  return result
}

// ── Public: full resolution with metadata (used by API endpoint) ───────────────

export interface PolicyResolution {
  employee_id:  string
  policy_id:    string | null
  policy_name:  string | null
  policy_version: number | null   // Version of the published policy at resolution time
  source:       PolicyRule['source'] | 'none'
  // Step 1 additions
  resolved_from:       string | null   // assignment UUID that matched
  source_id:           string | null   // winning scope_id
  priority_rank:       number | null   // 1-5
  // The resolved rules list
  rules:               PolicyRule[]
  // Optional debug field (Step 1) — only present when debug=true is requested
  evaluated_candidates?: PolicyCandidate[]
  // Governance additions
  is_simulation?: boolean
}

/**
 * @param opts.asOf            YYYY-MM-DD for effective-date filtering (Step 2).
 * @param opts.includeDebug    When true, attaches evaluated_candidates array (Step 1).
 * @param opts.persistLog      When true, write rows to policy_evaluation_log.
 * @param opts.triggerContext  Trigger label for evaluation log rows.
 * @param opts.isSimulation    Marks evaluation log rows as simulation (no side effects).
 */
export async function resolveEffectivePolicyForEmployee(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  opts?: {
    asOf?:           string
    includeDebug?:   boolean
    persistLog?:     boolean
    triggerContext?: string
    isSimulation?:   boolean
  },
): Promise<PolicyResolution> {
  const effectiveAsOf = opts?.asOf ?? new Date().toISOString().slice(0, 10)

  // ── Build candidate list for debug output (Step 1) ─────────────────────────
  const [ctx, leaveTypeNames, publishedPolicyIds] = await Promise.all([
    fetchJobContext(supabase, tenantId, employeeId),
    loadLeaveTypeNames(supabase, tenantId),
    fetchPublishedPolicyIds(supabase, tenantId),
  ])

  const candidateList: Array<{
    scope_type: string
    scope_id:   string | null
    priority:   number
  }> = [
    ...(ctx.leave_policy_override_id ? [{ scope_type: 'employee_override', scope_id: employeeId, priority: 0 }] : []),
    { scope_type: 'employee',      scope_id: employeeId,          priority: 1 },
    ...(ctx.department_id    ? [{ scope_type: 'department',    scope_id: ctx.department_id,    priority: 2 }] : []),
    ...(ctx.work_location_id ? [{ scope_type: 'work_location', scope_id: ctx.work_location_id, priority: 3 }] : []),
    ...(ctx.site_id          ? [{ scope_type: 'site',          scope_id: ctx.site_id,          priority: 4 }] : []),
    { scope_type: 'default',       scope_id: null,                priority: 5 },
    ...(ctx.site_default_leave_policy_id ? [{ scope_type: 'site_default', scope_id: ctx.site_id, priority: 6 }] : []),
  ]

  // Fetch assignments to build debug output independently of assignment resolution
  let debugAssignments: Array<{
    id:           string
    policy_id:    string
    scope_type:   string
    scope_id:     string | null
    effective_from: string | null
    effective_to:   string | null
  }> = []

  if (opts?.includeDebug) {
    const { data } = await supabase
      .from('leave_policy_assignments')
      .select('id, policy_id, scope_type, scope_id, effective_from, effective_to')
      .eq('tenant_id', tenantId)
      .in('scope_type', candidateList.map(c => c.scope_type))
    debugAssignments = (data ?? []) as typeof debugAssignments
  }

  // ── Re-use shared resolution logic ─────────────────────────────────────────
  const assignment = await resolveAssignment(
    supabase, tenantId, employeeId, ctx, effectiveAsOf, publishedPolicyIds,
  )

  // Load named policy rules (if any assignment found)
  let namedRules  = new Map<string, DbPolicyRule>()
  let masterMeta: { name: string; year_type: string; version: number } | null = null

  if (assignment) {
    const [rules, master] = await Promise.all([
      loadPolicyRules(supabase, tenantId, assignment.policy_id, effectiveAsOf),
      supabase.from('leave_policy_masters')
        .select('name, year_type, version')
        .eq('id', assignment.policy_id)
        .single()
        .then(r => r.data as { name: string; year_type: string; version: number } | null),
    ])
    namedRules = rules
    masterMeta = master
  }

  const result = new Map<string, PolicyRule>()

  for (const [ltId, rule] of namedRules) {
    const eligibility = evaluateEligibility(rule, ctx, effectiveAsOf)
    result.set(ltId, buildPolicyRule(rule, assignment!, masterMeta, leaveTypeNames, eligibility))

    if (opts?.persistLog) {
      persistEvaluationLog(supabase, {
        tenantId,
        employeeId,
        leaveTypeId:        ltId,
        evaluatedOn:        effectiveAsOf,
        triggerContext:     opts.triggerContext ?? 'api',
        policyId:           assignment!.policy_id,
        policyName:         masterMeta?.name ?? null,
        policyVersion:      masterMeta?.version ?? null,
        ruleId:             rule.id,
        resolvedVia:        assignment!.source,
        scopeId:            assignment!.scope_id,
        priorityRank:       assignment!.priority,
        eligible:           eligibility.eligible,
        eligibilityReason:  eligibility.eligibility_reason,
        evaluatedCandidates: [],
        isSimulation:       opts.isSimulation ?? false,
      }).catch(() => { /* non-fatal */ })
    }
  }

  // Gap-fill from legacy
  const { data: legacy } = await supabase
    .from('leave_policies')
    .select(`
      id, leave_type_id,
      accrual_type, accrual_days_per_year, max_accrual_balance,
      eligibility_days, prorate_on_joining,
      carry_forward_enabled, carry_forward_max_days,
      year_type, expiry_days
    `)
    .eq('tenant_id', tenantId)

  for (const row of (legacy as DbLegacyPolicy[]) ?? []) {
    if (result.has(row.leave_type_id)) continue
    const legacyRule = buildLegacyRule(row, leaveTypeNames)
    if (legacyRule) {
      result.set(row.leave_type_id, legacyRule)

      if (opts?.persistLog) {
        persistEvaluationLog(supabase, {
          tenantId,
          employeeId,
          leaveTypeId:        row.leave_type_id,
          evaluatedOn:        effectiveAsOf,
          triggerContext:     opts.triggerContext ?? 'api',
          policyId:           null,
          policyName:         'Default (legacy)',
          policyVersion:      null,
          ruleId:             row.id,
          resolvedVia:        'legacy',
          scopeId:            null,
          priorityRank:       5,
          eligible:           true,
          eligibilityReason:  null,
          evaluatedCandidates: [],
          isSimulation:       opts.isSimulation ?? false,
        }).catch(() => { /* non-fatal */ })
      }
    }
  }

  const rules       = [...result.values()]
  const firstNamed  = rules.find(r => r.source !== 'legacy')

  // Build evaluated_candidates for debug mode (Step 1)
  let evaluated_candidates: PolicyCandidate[] | undefined = undefined
  if (opts?.includeDebug) {
    evaluated_candidates = candidateList.map(c => {
      // Only consider assignments to published policies for debug output
      const hit = debugAssignments.find(
        a => a.scope_type === c.scope_type && a.scope_id === c.scope_id &&
             isActiveOn(a.effective_from, a.effective_to, effectiveAsOf) &&
             publishedPolicyIds.has(a.policy_id),
      )
      return {
        scope_type:    c.scope_type,
        scope_id:      c.scope_id,
        priority:      c.priority,
        matched:       !!hit,
        policy_id:     hit?.policy_id ?? null,
        assignment_id: hit?.id        ?? null,
      }
    })
  }

  return {
    employee_id:    employeeId,
    policy_id:      firstNamed?.policy_id   ?? null,
    policy_name:    firstNamed?.policy_name ?? null,
    policy_version: masterMeta?.version      ?? null,
    source:         firstNamed?.source       ?? (rules.length > 0 ? 'legacy' : 'none'),
    resolved_from:  assignment?.assignment_id ?? null,
    source_id:      assignment?.scope_id      ?? null,
    priority_rank:  assignment?.priority      ?? null,
    rules,
    is_simulation:  opts?.isSimulation ?? false,
    ...(evaluated_candidates !== undefined ? { evaluated_candidates } : {}),
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildPolicyRule(
  rule:         DbPolicyRule,
  assignment:   ResolvedAssignment,
  master:       { name: string; year_type: string; version?: number } | null,
  ltNames:      Map<string, string>,
  eligibility:  EligibilityEvaluation,
): PolicyRule {
  return {
    id:                     rule.id,
    policy_id:              rule.policy_id,
    policy_name:            master?.name ?? 'Unknown policy',
    leave_type_id:          rule.leave_type_id,
    leave_type_name:        ltNames.get(rule.leave_type_id) ?? rule.leave_type_id,
    accrual_type:           rule.accrual_type as PolicyRule['accrual_type'],
    accrual_days_per_year:  Number(rule.accrual_days_per_year),
    max_accrual_balance:    rule.max_accrual_balance != null ? Number(rule.max_accrual_balance) : null,
    eligibility_days:       rule.eligibility_days,
    prorate_on_joining:     rule.prorate_on_joining,
    carry_forward_enabled:  rule.carry_forward_enabled,
    carry_forward_max_days: rule.carry_forward_max_days != null ? Number(rule.carry_forward_max_days) : null,
    expiry_days:            rule.expiry_days ?? null,
    max_consecutive_days:   rule.max_consecutive_days ?? null,
    min_gap_days:           rule.min_gap_days,
    year_type:              (master?.year_type ?? 'calendar') as 'calendar' | 'financial',
    source:                 assignment.source,
    // Step 1
    resolved_from:          assignment.assignment_id,
    source_id:              assignment.scope_id,
    priority_rank:          assignment.priority as PolicyRule['priority_rank'],
    // Step 4
    eligible:               eligibility.eligible,
    eligibility_reason:     eligibility.eligibility_reason,
  }
}

async function resolveLegacyRule(
  supabase:     SupabaseClient,
  tenantId:     string,
  leaveTypeId:  string,
  ltNames:      Map<string, string>,
): Promise<PolicyRule | null> {
  const { data } = await supabase
    .from('leave_policies')
    .select(`
      id, leave_type_id,
      accrual_type, accrual_days_per_year, max_accrual_balance,
      eligibility_days, prorate_on_joining,
      carry_forward_enabled, carry_forward_max_days,
      year_type, expiry_days
    `)
    .eq('tenant_id',     tenantId)
    .eq('leave_type_id', leaveTypeId)
    .maybeSingle()

  if (!data) return null
  return buildLegacyRule(data as DbLegacyPolicy, ltNames)
}

function buildLegacyRule(
  row:     DbLegacyPolicy,
  ltNames: Map<string, string>,
): PolicyRule | null {
  return {
    id:                     row.id,
    policy_id:              null,
    policy_name:            'Default (legacy)',
    leave_type_id:          row.leave_type_id,
    leave_type_name:        ltNames.get(row.leave_type_id) ?? row.leave_type_id,
    accrual_type:           (row.accrual_type as PolicyRule['accrual_type']) ?? 'yearly',
    accrual_days_per_year:  Number(row.accrual_days_per_year),
    max_accrual_balance:    row.max_accrual_balance != null ? Number(row.max_accrual_balance) : null,
    eligibility_days:       row.eligibility_days ?? 0,
    prorate_on_joining:     row.prorate_on_joining ?? true,
    carry_forward_enabled:  row.carry_forward_enabled ?? false,
    carry_forward_max_days: row.carry_forward_max_days != null ? Number(row.carry_forward_max_days) : null,
    expiry_days:            row.expiry_days ?? null,
    max_consecutive_days:   null,
    min_gap_days:           0,
    year_type:              (row.year_type as 'calendar' | 'financial') ?? 'calendar',
    source:                 'legacy',
    // Step 1 — legacy rows have no assignment
    resolved_from:          null,
    source_id:              null,
    priority_rank:          5,
    // Step 4 — legacy rows have no eligibility guards
    eligible:               true,
    eligibility_reason:     null,
  }
}
