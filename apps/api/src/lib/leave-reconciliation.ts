/**
 * Leave Reconciliation Engine
 *
 * Detects drift between the leave accrual ledger and the balance summary table:
 *
 *   leave_accrual_ledger        — authoritative per-grant audit trail
 *   employee_leave_balance      — denormalized balance summary (what UI/payroll reads)
 *
 * Issue types detected:
 *
 *   balance_drift
 *     SUM(ledger.days) for the year ≠ employee_leave_balance.balance.
 *     Indicates a missed write, a partial rollback, or manual DB edit.
 *     Drift tolerance: ±0.05 days (floating-point rounding grace).
 *
 *   missing_balance_row
 *     Ledger has positive credits for an employee+type+year but no
 *     employee_leave_balance row exists. Balance reads as zero — wrong.
 *
 *   negative_balance
 *     employee_leave_balance.balance < 0. Policy violation; payroll
 *     may compute incorrect LOP for leave taken beyond entitlement.
 *
 *   orphan_balance_row
 *     employee_leave_balance row exists (balance > 0) but no ledger
 *     entries exist for that employee+type+year. Unaudited manual insert.
 *
 *   expired_co_not_deducted
 *     leave_accrual_ledger rows with is_expired=true but the corresponding
 *     employee_leave_balance hasn't been reduced (balance > ledger net).
 *
 *   future_expiry_risk
 *     CO grants (accrual_type='co_grant') expiring within EXPIRY_WARN_DAYS
 *     that have not yet been marked expired. Early warning for admins.
 *
 *   replay_drift
 *     The replay engine reconstructed balance for a leave type differs from
 *     the stored employee_leave_balance by more than DRIFT_TOLERANCE. This
 *     indicates that the ledger write history is internally inconsistent
 *     (e.g. a credit was written to leave_accrual_ledger but the running
 *     balance in leave_balance_ledger was not updated, or vice-versa).
 *     Detected via `detectBalanceDrift()` in leave-replay-engine.
 *
 * All checks are read-only. Issues are written to leave_reconciliation_issues.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { detectBalanceDrift }  from './leave-replay-engine.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Drift tolerance in days — differences below this are rounding noise. */
const DRIFT_TOLERANCE = 0.05

/** Warn about CO grants expiring within this many days. */
const EXPIRY_WARN_DAYS = 7

/** Max issues per run. */
const MAX_ISSUES = 2_000

// ── Types ──────────────────────────────────────────────────────────────────────

export type LeaveIssueType =
  | 'balance_drift'
  | 'missing_balance_row'
  | 'negative_balance'
  | 'orphan_balance_row'
  | 'expired_co_not_deducted'
  | 'future_expiry_risk'
  | 'replay_drift'

export type LeaveIssueSeverity = 'info' | 'warning' | 'error' | 'critical'

interface LeaveIssue {
  issue_type:     LeaveIssueType
  severity:       LeaveIssueSeverity
  employee_id:    string
  leave_type_id:  string
  year:           number
  ledger_sum:     number | null
  balance_value:  number | null
  drift_days:     number | null
  detail:         Record<string, unknown>
  suggestion:     string
}

export interface LeaveReconciliationResult {
  run_id:            string
  tenant_id:         string
  reconcile_year:    number
  total_employees:   number
  drifted_employees: number
  total_issues:      number
  issue_breakdown:   Record<LeaveIssueType, number>
  duration_ms:       number
  issues_found:      number
  severity:          string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

async function flushLeaveIssues(
  supabase:  SupabaseClient,
  runId:     string,
  tenantId:  string,
  issues:    LeaveIssue[],
): Promise<void> {
  if (issues.length === 0) return
  const CHUNK = 200
  for (let i = 0; i < issues.length; i += CHUNK) {
    const chunk = issues.slice(i, i + CHUNK).map(iss => ({
      run_id:    runId,
      tenant_id: tenantId,
      ...iss,
    }))
    const { error } = await supabase
      .from('leave_reconciliation_issues')
      .insert(chunk)
    if (error) {
      console.error('[leave-reconciliation] issue flush error:', error.message)
    }
  }
}

// ── Main engine ────────────────────────────────────────────────────────────────

export async function runLeaveReconciliation(
  supabase:    SupabaseClient,
  tenantId:    string,
  year:        number,
  triggeredBy: string | null = null,
  source:      'manual' | 'scheduler' | 'api' = 'api',
): Promise<LeaveReconciliationResult> {
  const startMs = Date.now()

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from('leave_reconciliation_runs')
    .insert({
      tenant_id:      tenantId,
      status:         'running',
      reconcile_year: year,
      triggered_by:   triggeredBy,
      trigger_source: source,
    })
    .select('id')
    .single()

  if (runErr || !run) {
    throw new Error(`Failed to create leave reconciliation run: ${runErr?.message}`)
  }

  const runId = run.id as string

  try {
    const issues: LeaveIssue[] = []
    const today = new Date().toISOString().slice(0, 10)
    const warnCutoff = new Date(Date.now() + EXPIRY_WARN_DAYS * 86_400_000).toISOString().slice(0, 10)

    // ── Fetch all ledger rows for the year ──────────────────────────────────────
    const { data: ledgerRows, error: ledErr } = await supabase
      .from('leave_accrual_ledger')
      .select('employee_id, leave_type_id, year, days, accrual_type, is_expired, expires_on, accrued_on')
      .eq('tenant_id', tenantId)
      .eq('year', year)

    if (ledErr) throw new Error(`Ledger query failed: ${ledErr.message}`)

    // ── Fetch all balance rows for the year ─────────────────────────────────────
    const { data: balanceRows, error: balErr } = await supabase
      .from('employee_leave_balance')
      .select('employee_id, leave_type_id, year, balance')
      .eq('tenant_id', tenantId)
      .eq('year', year)

    if (balErr) throw new Error(`Balance query failed: ${balErr.message}`)

    // ── Build ledger aggregate map ──────────────────────────────────────────────
    // key: `${employee_id}|${leave_type_id}`
    type LedgerAgg = {
      sum:            number
      creditSum:      number  // only positive grants
      expiredSum:     number  // sum of expired grants (should be absent from balance)
      coGrantCount:   number
      upcomingExpiry: Array<{ id?: string; days: number; expires_on: string }>
    }
    const ledgerMap = new Map<string, LedgerAgg>()

    for (const row of (ledgerRows ?? []) as any[]) {
      const key = `${row.employee_id}|${row.leave_type_id}`
      const agg = ledgerMap.get(key) ?? {
        sum: 0, creditSum: 0, expiredSum: 0, coGrantCount: 0, upcomingExpiry: [],
      }
      agg.sum = round1(agg.sum + Number(row.days))
      if (Number(row.days) > 0) {
        agg.creditSum = round1(agg.creditSum + Number(row.days))
      }
      if (row.is_expired && Number(row.days) > 0) {
        agg.expiredSum = round1(agg.expiredSum + Number(row.days))
      }
      if (row.accrual_type === 'co_grant') {
        agg.coGrantCount++
        // Check for upcoming expiry
        if (
          !row.is_expired &&
          row.expires_on &&
          row.expires_on >= today &&
          row.expires_on <= warnCutoff
        ) {
          agg.upcomingExpiry.push({ days: Number(row.days), expires_on: row.expires_on })
        }
      }
      ledgerMap.set(key, agg)
    }

    // ── Build balance map ───────────────────────────────────────────────────────
    const balanceMap = new Map<string, number>()
    const balanceEmpTypes = new Set<string>()
    for (const row of (balanceRows ?? []) as any[]) {
      const key = `${row.employee_id}|${row.leave_type_id}`
      balanceMap.set(key, Number(row.balance))
      balanceEmpTypes.add(key)
    }

    // ── Check 1+2+5+6: ledger → balance comparisons ─────────────────────────────
    const driftedKeys = new Set<string>()

    for (const [key, agg] of ledgerMap) {
      if (issues.length >= MAX_ISSUES) break
      const [empId, ltId] = key.split('|')
      const balance = balanceMap.get(key)

      // Check 2: missing balance row
      if (balance === undefined) {
        if (agg.sum > 0) {
          issues.push({
            issue_type:    'missing_balance_row',
            severity:      'error',
            employee_id:   empId,
            leave_type_id: ltId,
            year,
            ledger_sum:    agg.sum,
            balance_value: null,
            drift_days:    agg.sum,
            detail: {
              ledger_net_sum:  agg.sum,
              credit_sum:      agg.creditSum,
            },
            suggestion: `No employee_leave_balance row found for employee ${empId}, leave_type ${ltId}, year ${year}, but ledger shows ${agg.sum} days. Insert a balance row with balance=${agg.sum} or run the accrual job to regenerate.`,
          })
          driftedKeys.add(empId)
        }
        continue
      }

      // Check 1: balance drift
      const drift = round1(agg.sum - balance)
      if (Math.abs(drift) > DRIFT_TOLERANCE) {
        issues.push({
          issue_type:    'balance_drift',
          severity:      Math.abs(drift) >= 1 ? 'error' : ('warning' as LeaveIssueSeverity),
          employee_id:   empId,
          leave_type_id: ltId,
          year,
          ledger_sum:    agg.sum,
          balance_value: balance,
          drift_days:    drift,
          detail: {
            ledger_net_sum: agg.sum,
            balance_value:  balance,
            drift_days:     drift,
            credit_sum:     agg.creditSum,
            expired_sum:    agg.expiredSum,
          },
          suggestion: `Ledger net sum (${agg.sum}) ≠ balance (${balance}) — drift of ${drift > 0 ? '+' : ''}${drift} days. ${
            drift > 0
              ? 'Balance is under-reported; a credit may have been written to the ledger without updating the balance row. Run the accrual job or manually UPDATE employee_leave_balance.'
              : 'Balance is over-reported; a deduction may have been applied to the balance without a matching ledger entry. Check leave approval history for missed ledger writes.'
          }`,
        })
        driftedKeys.add(empId)
      }

      // Check 5: expired CO not deducted
      if (agg.expiredSum > 0) {
        const expectedBalance = round1(agg.sum)  // ledger already includes expired as negatives via is_expired
        // If balance is higher than the ledger net (which includes expired deductions),
        // then the expiry deductions haven't been applied
        if (balance > round1(agg.sum) + DRIFT_TOLERANCE) {
          issues.push({
            issue_type:    'expired_co_not_deducted',
            severity:      'error',
            employee_id:   empId,
            leave_type_id: ltId,
            year,
            ledger_sum:    agg.sum,
            balance_value: balance,
            drift_days:    round1(balance - agg.sum),
            detail: {
              expired_sum:    agg.expiredSum,
              balance_value:  balance,
              ledger_net_sum: agg.sum,
            },
            suggestion: `${agg.expiredSum} days of CO grants are marked expired in the ledger but the balance (${balance}) hasn't been reduced. Run the CO expiry job (coExpiryJob) to apply deductions.`,
          })
          driftedKeys.add(empId)
        }
      }

      // Check 6: future expiry risk
      if (agg.upcomingExpiry.length > 0) {
        const totalExpiring = round1(agg.upcomingExpiry.reduce((s, e) => s + e.days, 0))
        issues.push({
          issue_type:    'future_expiry_risk',
          severity:      'info',
          employee_id:   empId,
          leave_type_id: ltId,
          year,
          ledger_sum:    agg.sum,
          balance_value: balance,
          drift_days:    null,
          detail: {
            expiring_grants:  agg.upcomingExpiry,
            total_expiring:   totalExpiring,
            warn_within_days: EXPIRY_WARN_DAYS,
          },
          suggestion: `${totalExpiring} CO days for employee ${empId} will expire within ${EXPIRY_WARN_DAYS} days. Notify the employee to use these days or the balance will be auto-reduced by the CO expiry scheduler.`,
        })
      }
    }

    // ── Check 3: negative balances ───────────────────────────────────────────────
    for (const [key, balance] of balanceMap) {
      if (issues.length >= MAX_ISSUES) break
      if (balance < 0) {
        const [empId, ltId] = key.split('|')
        issues.push({
          issue_type:    'negative_balance',
          severity:      'critical',
          employee_id:   empId,
          leave_type_id: ltId,
          year,
          ledger_sum:    ledgerMap.get(key)?.sum ?? null,
          balance_value: balance,
          drift_days:    balance,
          detail: { balance, ledger_net: ledgerMap.get(key)?.sum ?? null },
          suggestion: `Employee ${empId} has a negative leave balance (${balance} days) for leave_type ${ltId}, year ${year}. This may cause incorrect payroll LOP calculations. Investigate: was a leave approved without sufficient balance? Use an adjustment ledger entry to correct.`,
        })
        driftedKeys.add(empId)
      }
    }

    // ── Check 4: orphan balance rows ─────────────────────────────────────────────
    for (const key of balanceEmpTypes) {
      if (issues.length >= MAX_ISSUES) break
      if (!ledgerMap.has(key)) {
        const balance = balanceMap.get(key) ?? 0
        if (balance > 0) {
          const [empId, ltId] = key.split('|')
          issues.push({
            issue_type:    'orphan_balance_row',
            severity:      'warning',
            employee_id:   empId,
            leave_type_id: ltId,
            year,
            ledger_sum:    0,
            balance_value: balance,
            drift_days:    -balance,
            detail: { balance },
            suggestion: `employee_leave_balance shows ${balance} days for employee ${empId}, leave_type ${ltId}, year ${year}, but no ledger entries exist. This balance was likely inserted manually without a corresponding ledger audit row. Add an 'adjustment' ledger entry for auditability.`,
          })
        }
      }
    }

    // ── Check 7: replay drift ────────────────────────────────────────────────────
    // For each unique employee seen across ledger + balance tables, run the replay
    // engine and compare the reconstructed balance to the stored balance.
    // Only employees where the replay detects drift are reported — this is the
    // most expensive check (one async chain per employee) so it runs last.
    const replayEmployeeIds = new Set<string>([
      ...([...ledgerMap.keys()].map(k => k.split('|')[0])),
      ...([...balanceEmpTypes].map(k => k.split('|')[0])),
    ])

    const asOfToday = today  // already computed above
    for (const empId of replayEmployeeIds) {
      if (issues.length >= MAX_ISSUES) break
      try {
        const drifted = await detectBalanceDrift(supabase, tenantId, empId, year, asOfToday)
        for (const d of drifted) {
          issues.push({
            issue_type:    'replay_drift',
            severity:      Math.abs(d.drift) >= 1 ? 'error' : 'warning',
            employee_id:   d.employee_id,
            leave_type_id: d.leave_type_id,
            year:          d.year,
            ledger_sum:    d.reconstructed_balance,
            balance_value: d.stored_balance,
            drift_days:    round1(d.drift),
            detail: {
              reconstructed_balance: d.reconstructed_balance,
              stored_balance:        d.stored_balance,
              drift:                 d.drift,
              drift_pct:             d.drift_pct,
              drift_detail:          d.drift_detail,
            },
            suggestion: `Replay engine reconstructed balance (${d.reconstructed_balance}) differs from stored balance (${d.stored_balance}) by ${d.drift > 0 ? '+' : ''}${d.drift} days. ${d.drift_detail}. Cross-check ledger entries for this employee using the audit trail and run retroactive rebuild if needed.`,
          })
          driftedKeys.add(empId)
        }
      } catch {
        // Replay errors are non-fatal — the primary reconciliation still runs
      }
    }

    // ── Flush issues ─────────────────────────────────────────────────────────────
    await flushLeaveIssues(supabase, runId, tenantId, issues)

    // ── Breakdown ────────────────────────────────────────────────────────────────
    const breakdown: Record<string, number> = {}
    for (const iss of issues) {
      breakdown[iss.issue_type] = (breakdown[iss.issue_type] ?? 0) + 1
    }

    const totalEmployees = new Set<string>(
      [...ledgerMap.keys(), ...balanceEmpTypes].map(k => k.split('|')[0])
    ).size

    const durationMs = Date.now() - startMs

    await supabase
      .from('leave_reconciliation_runs')
      .update({
        status:            'completed',
        completed_at:      new Date().toISOString(),
        duration_ms:       durationMs,
        total_employees:   totalEmployees,
        drifted_employees: driftedKeys.size,
        total_issues:      issues.length,
        issue_breakdown:   breakdown,
      })
      .eq('id', runId)

    const criticalCount = issues.filter(i => i.severity === 'critical').length
    const errorCount    = issues.filter(i => i.severity === 'error').length
    const topSeverity   = criticalCount > 0 ? 'critical' : errorCount > 0 ? 'error' : issues.length > 0 ? 'warning' : 'none'

    return {
      run_id:            runId,
      tenant_id:         tenantId,
      reconcile_year:    year,
      total_employees:   totalEmployees,
      drifted_employees: driftedKeys.size,
      total_issues:      issues.length,
      issue_breakdown:   breakdown as Record<LeaveIssueType, number>,
      duration_ms:       durationMs,
      issues_found:      issues.length,
      severity:          topSeverity,
    }
  } catch (err: any) {
    await supabase
      .from('leave_reconciliation_runs')
      .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
      .eq('id', runId)
    throw err
  }
}
