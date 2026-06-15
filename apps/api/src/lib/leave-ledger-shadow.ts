/**
 * Leave Ledger Shadow-Read Instrumentation (C6 Phase 1)
 *
 * While LEAVE_LEDGER_AUTHORITATIVE is still OFF (the cache is the served
 * source of truth), this module passively compares each balance read against
 * the authoritative ledger sum and records any divergence into
 * leave_ledger_drift_log. The goal is to PROVE — under real production
 * activity, over a multi-week window — that ledger and cache stay in lockstep
 * before any read-path cutover.
 *
 * Contract:
 *   • Fire-and-forget: never throws, never blocks, never alters the response.
 *   • Gated behind LEAVE_LEDGER_SHADOW (default OFF). Enabling is an env-config
 *     action in the target environment, not a code change.
 *   • Drift tolerance is 0.01 day (rounding noise below this is ignored).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const DRIFT_TOLERANCE = 0.01

export function isLeaveLedgerShadowEnabled(): boolean {
  return process.env.LEAVE_LEDGER_SHADOW === 'true'
}

export interface CacheBalanceRow {
  leave_type_id: string
  balance:       number
}

interface MinimalLogger {
  warn: (obj: unknown, msg?: string) => void
}

/**
 * Compare the cached balances against Σ(ledger non-expired days) for the same
 * employee+year and record any drift > tolerance. Best-effort; swallows all
 * errors so a balance read is never affected.
 */
export async function recordShadowDrift(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  year:       number,
  cacheRows:  CacheBalanceRow[],
  logger:     MinimalLogger,
  source:     'balance_read' | 'reconciliation_sweep' = 'balance_read',
): Promise<void> {
  try {
    const { data: ledgerRows, error } = await supabase
      .from('leave_accrual_ledger')
      .select('leave_type_id, days')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('year', year)
      .eq('is_expired', false)

    if (error) {
      logger.warn({ err: error, tenant_id: tenantId, employee_id: employeeId }, 'shadow drift: ledger fetch failed (non-fatal)')
      return
    }

    // Σ ledger days per leave_type.
    const ledgerSum = new Map<string, number>()
    for (const r of (ledgerRows ?? []) as Array<{ leave_type_id: string; days: number }>) {
      ledgerSum.set(r.leave_type_id, (ledgerSum.get(r.leave_type_id) ?? 0) + Number(r.days))
    }

    const cacheByType = new Map<string, number>()
    for (const r of cacheRows) cacheByType.set(r.leave_type_id, Number(r.balance))

    const keys = new Set<string>([...ledgerSum.keys(), ...cacheByType.keys()])
    const drifts: Array<Record<string, unknown>> = []
    for (const k of keys) {
      const led      = ledgerSum.get(k) ?? 0
      const hasCache = cacheByType.has(k)
      const cache    = cacheByType.get(k) ?? 0
      if (Math.abs(led - cache) > DRIFT_TOLERANCE) {
        drifts.push({
          tenant_id:      tenantId,
          employee_id:    employeeId,
          leave_type_id:  k,
          year,
          cache_balance:  hasCache ? cache : null,
          ledger_balance: Math.round(led * 100) / 100,
          delta:          Math.round((led - cache) * 100) / 100,
          source,
        })
      }
    }

    if (drifts.length > 0) {
      // Structured log (alertable) — stable `event` discriminator.
      logger.warn(
        { event: 'leave_ledger_drift', tenant_id: tenantId, employee_id: employeeId, year, count: drifts.length, drifts },
        'leave ledger/cache drift detected (shadow)',
      )
      await supabase.from('leave_ledger_drift_log').insert(drifts)
    }
  } catch (err) {
    logger.warn({ err }, 'shadow drift comparison failed (non-fatal)')
  }
}
