/**
 * payroll-compensation-coverage.ts
 *
 * Pre-run audit: checks that every active employee has a payroll-ready
 * compensation record (active, non-future-dated, non-zero CTC, with ≥1
 * earning component that has a non-zero computed amount).
 *
 * No I/O in the query logic — all DB calls are in buildCompensationCoverageAudit().
 * Pure analysis functions (analyseEmployee, summarise) are exported for testing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CoverageIssueType =
  | 'missing_compensation'
  | 'future_dated'
  | 'zero_ctc'
  | 'no_components'
  | 'invalid_components'

export interface CoverageIssue {
  employee_id:   string
  employee_code: string
  employee_name: string
  issue:         CoverageIssueType
  /** Human-readable explanation of the issue */
  detail:        string
  /** CTA route for the operator to fix it */
  remediation:   string
}

export interface CompensationCoverageAudit {
  /** Total active employees in the tenant */
  total_active_employees:              number
  /** Employees with an is_active=true compensation record */
  employees_with_active_compensation:  number
  /** Employees with no active compensation at all */
  employees_missing_compensation:      number
  /** Employees whose compensation is future-dated (not yet payroll-active) */
  employees_future_dated:              number
  /** Employees with ctc_annual ≤ 0 */
  employees_zero_ctc:                  number
  /** Employees with zero component rows */
  employees_with_no_components:        number
  /** Employees with computed_monthly = 0 or NaN on all earning components */
  employees_with_invalid_components:   number
  /** (employees_with_active_compensation / total_active_employees) × 100, clamped 0–100 */
  coverage_percent:                    number
  /**
   * True only when:
   *   - zero missing compensation
   *   - zero zero-CTC
   *   - zero no-components
   *   - zero invalid-components
   * Future-dated records are a WARNING, not a blocker (they won't be picked up
   * by the payroll engine's effective_from guard, so the run can proceed with
   * the previously active record).
   */
  ready_for_payroll:                   boolean
  /** All per-employee issues for display in the UI */
  issues:                              CoverageIssue[]
  /** ISO date this audit was computed (YYYY-MM-DD) */
  as_of:                               string
}

// ── Internal types (DB row shapes) ───────────────────────────────────────────

interface RawEmployee {
  id:            string
  employee_code: string
  first_name:    string
  last_name:     string
}

interface RawCompensation {
  id:             string
  employee_id:    string
  ctc_annual:     number
  ctc_monthly:    number
  effective_from: string
}

interface RawComponent {
  compensation_id:    string
  salary_component_id: string
  computed_monthly:   number | null
}

interface RawSalaryComponent {
  id:             string
  component_type: string
}

// ── Core audit function ───────────────────────────────────────────────────────

/**
 * Build a full compensation coverage audit for the tenant.
 *
 * Runs four focused queries (employees, active compensations, salary component types, components) and
 * produces a structured audit result ready for the API response and UI card.
 *
 * @throws Error when any DB query fails — caller should catch and return 500.
 */
export async function buildCompensationCoverageAudit(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CompensationCoverageAudit> {
  const today = new Date().toISOString().slice(0, 10)

  // ── 1. Fetch all active employees (paginated — employees can exceed 1000 rows) ─
  const empList = await fetchAllRows<RawEmployee>((from, to) =>
    supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')
      .range(from, to) as any,
  )
  const total   = empList.length

  // Early-out: no active employees is a valid (trivially "ready") state
  if (total === 0) {
    return {
      total_active_employees:             0,
      employees_with_active_compensation: 0,
      employees_missing_compensation:     0,
      employees_future_dated:             0,
      employees_zero_ctc:                 0,
      employees_with_no_components:       0,
      employees_with_invalid_components:  0,
      coverage_percent:                   100,
      ready_for_payroll:                  true,
      issues:                             [],
      as_of:                              today,
    }
  }

  // ── 2. Fetch active compensations for all employees (batched to avoid URL limit) ──
  const empIds = empList.map(e => e.id)
  const CHUNK = 400

  const compList: RawCompensation[] = []
  for (let i = 0; i < empIds.length; i += CHUNK) {
    const { data, error: compErr } = await supabase
      // lint-query-ok: bounded by uidx_comp_one_active — max 1 active comp per employee, CHUNK=400 ≤ 1000 rows
      .from('employee_compensations')
      .select('id, employee_id, ctc_annual, ctc_monthly, effective_from')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('employee_id', empIds.slice(i, i + CHUNK))

    if (compErr) {
      throw new Error(`Coverage audit: failed to fetch compensations — ${compErr.message}`)
    }
    compList.push(...((data ?? []) as RawCompensation[]))
  }

  const compByEmp = new Map<string, RawCompensation>(compList.map(c => [c.employee_id, c]))

  // ── 3. Pre-fetch salary component type map (avoids fragile PostgREST FK join) ─
  // fetchAllRows is required — tenants with many salary templates can exceed 1000
  const salaryCompTypeMap = new Map<string, string>()
  {
    const scRows = await fetchAllRows<RawSalaryComponent>((from, to) =>
      supabase
        .from('salary_components')
        .select('id, component_type')
        .eq('tenant_id', tenantId)
        .order('id')
        .range(from, to) as any,
    )
    for (const sc of scRows) {
      salaryCompTypeMap.set(sc.id, sc.component_type)
    }
  }

  // ── 4. Fetch component stats for all found compensations (batched) ────────
  const componentCountByComp = new Map<string, number>()   // compensation_id → # rows
  const earningTotalByComp   = new Map<string, number>()   // compensation_id → sum computed_monthly of earnings
  const hasNaNByComp         = new Set<string>()           // compensation_ids with NaN/Infinity components

  if (compList.length > 0) {
    const compIds = compList.map(c => c.id)
    for (let i = 0; i < compIds.length; i += CHUNK) {
      // fetchAllRows prevents silent truncation: 400 compensations × ~20 components
      // easily exceeds the PostgREST max-rows=1000 ceiling per request.
      let components: RawComponent[]
      try {
        components = await fetchAllRows<RawComponent>((from, to) =>
          supabase
            .from('employee_compensation_components')
            .select('compensation_id, salary_component_id, computed_monthly')
            .in('compensation_id', compIds.slice(i, i + CHUNK))
            .order('compensation_id')
            .range(from, to) as any,
        )
      } catch {
        continue  // non-fatal — treated as no data for this chunk
      }

      for (const cc of components) {
        const cid = cc.compensation_id
        componentCountByComp.set(cid, (componentCountByComp.get(cid) ?? 0) + 1)

        const amt  = Number(cc.computed_monthly)
        const type = salaryCompTypeMap.get(cc.salary_component_id) ?? ''

        if (!Number.isFinite(amt) || Number.isNaN(amt)) {
          hasNaNByComp.add(cid)
          continue
        }
        if (type === 'earning') {
          earningTotalByComp.set(cid, (earningTotalByComp.get(cid) ?? 0) + amt)
        }
      }
    }
  }

  // ── 5. Analyse each employee ──────────────────────────────────────────────
  const issues: CoverageIssue[] = []

  let withComp         = 0
  let missingComp      = 0
  let futureDated      = 0
  let zeroCTC          = 0
  let noComponents     = 0
  let invalidComponents = 0

  for (const emp of empList) {
    const name = `${emp.first_name} ${emp.last_name}`.trim()
    const comp = compByEmp.get(emp.id)

    // ── No compensation at all ──────────────────────────────────────────────
    if (!comp) {
      missingComp++
      issues.push({
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        employee_name: name,
        issue:         'missing_compensation',
        detail:        'No active compensation record — employee cannot be included in payroll',
        remediation:   `/admin/workforce/employees/${emp.id}?section=compensation&sub=compensation`,
      })
      continue
    }

    withComp++

    // ── Future-dated (warning, not hard blocker) ────────────────────────────
    if (comp.effective_from > today) {
      futureDated++
      issues.push({
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        employee_name: name,
        issue:         'future_dated',
        detail:        `Compensation is future-dated (effective ${comp.effective_from}) — ` +
                       'payroll will use the previously active record if one exists',
        remediation:   `/admin/workforce/employees/${emp.id}?section=compensation&sub=compensation`,
      })
      // Future-dated is a warning — do not skip further checks on this record
    }

    // ── Zero / negative CTC ────────────────────────────────────────────────
    const ctcA = Number(comp.ctc_annual)
    if (!Number.isFinite(ctcA) || Number.isNaN(ctcA) || ctcA <= 0) {
      zeroCTC++
      issues.push({
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        employee_name: name,
        issue:         'zero_ctc',
        detail:        `Annual CTC is ${ctcA} — zero, negative, or invalid`,
        remediation:   `/admin/workforce/employees/${emp.id}?section=compensation&sub=compensation`,
      })
    }

    // ── No components ──────────────────────────────────────────────────────
    const compCount     = componentCountByComp.get(comp.id) ?? 0
    const earningTotal  = earningTotalByComp.get(comp.id)   ?? 0
    const hasNaN        = hasNaNByComp.has(comp.id)

    if (compCount === 0) {
      noComponents++
      issues.push({
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        employee_name: name,
        issue:         'no_components',
        detail:        'No salary components configured — gross pay will be ₹0',
        remediation:   `/admin/workforce/employees/${emp.id}?section=compensation&sub=compensation`,
      })
    } else if (hasNaN) {
      // NaN component amounts are a hard blocker (payroll NaN propagation)
      invalidComponents++
      issues.push({
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        employee_name: name,
        issue:         'invalid_components',
        detail:        'One or more components have NaN or Infinity computed amounts — fix the component formula',
        remediation:   `/admin/workforce/employees/${emp.id}?section=compensation&sub=compensation`,
      })
    } else if (earningTotal === 0 && ctcA > 0) {
      // Earning components all zero despite non-zero CTC is suspicious (likely misconfiguration)
      // We flag as invalid_components (gross_pay will be 0)
      invalidComponents++
      issues.push({
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        employee_name: name,
        issue:         'invalid_components',
        detail:        `All earning components compute to ₹0/month despite CTC ₹${ctcA.toLocaleString('en-IN')} — ` +
                       'check component formula values (pct_of_ctc/pct_of_basic must be 0–100)',
        remediation:   `/admin/workforce/employees/${emp.id}?section=compensation&sub=compensation`,
      })
    }
  }

  // ── Compute summary ───────────────────────────────────────────────────────
  const coveragePercent = total > 0
    ? Math.min(100, Math.round((withComp / total) * 100))
    : 100

  // Hard blockers: missing comp, zero ctc, no components, invalid components
  // Future-dated is a warning (payroll uses previous active record)
  const readyForPayroll =
    missingComp      === 0 &&
    zeroCTC          === 0 &&
    noComponents     === 0 &&
    invalidComponents === 0

  return {
    total_active_employees:             total,
    employees_with_active_compensation: withComp,
    employees_missing_compensation:     missingComp,
    employees_future_dated:             futureDated,
    employees_zero_ctc:                 zeroCTC,
    employees_with_no_components:       noComponents,
    employees_with_invalid_components:  invalidComponents,
    coverage_percent:                   coveragePercent,
    ready_for_payroll:                  readyForPayroll,
    issues,
    as_of:                              today,
  }
}
