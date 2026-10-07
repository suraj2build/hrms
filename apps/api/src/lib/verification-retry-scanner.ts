/**
 * Verification Retry Scanner (PEND-29/76)
 *
 * Scans `verification_records` for degraded PAN/bank_account entries that
 * are due for another attempt (per verification-retry.service.ts's backoff
 * policy) and re-invokes the orchestrator with the employee's current PAN/
 * bank details — the same thing POST /trust/verifications/retry/:employeeId
 * already does for a manual retry, just run automatically on a schedule.
 *
 * Aadhaar is excluded — Aadhaar Act §8/DPDP Act require explicit consent per
 * verification action, which an unattended job cannot provide (see
 * verification-retry.service.ts's module doc).
 *
 * Architecture:
 *   - Runs on an interval (SCAN_INTERVAL_MS), enqueued through the durable
 *     queue (survives restarts, doesn't double-fire across replicas) —
 *     matching sla-scanner.ts/poll-scheduler.ts.
 *   - Retry state (retry_count/degraded_reason) lives on verification_records
 *     itself, written by verification-orchestrator.service.ts — no separate
 *     queue table.
 *
 * Registration:
 *   Call registerVerificationRetryScanner(supabase) once at startup, AFTER
 *   the Supabase plugin is registered. Wrapped in safeRegisterModule so
 *   failures are isolated.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { durableQueue }        from './durable-queue.js'
import { fetchAllRows }        from './supabase-paginate.js'
import { verificationOrchestrator } from '../platform/trust/orchestrator/verification-orchestrator.service.js'
import { AUTO_RETRY_TYPES, isDueForRetry } from '../platform/integrations/retry/verification-retry.service.js'
import { logger }              from './logger.js'

const SCAN_INTERVAL_MS = 5 * 60 * 1_000   // 5 minutes — within the 30s-5min backoff range
const WARMUP_MS        = 60_000           // 1 minute

interface DegradedRow {
  employee_id:        string
  tenant_id:           string
  verification_type:  'pan' | 'bank_account'
  retry_count:        number
  updated_at:          string
}

interface EmployeeBankStatutory {
  account_number: string | null
  ifsc_code:      string | null
  pan_number:     string | null
}

export async function scan(supabase: SupabaseClient): Promise<void> {
  const degraded = await fetchAllRows<DegradedRow>((from, to) =>
    supabase
      // lint-tenant-ok: deliberate cross-tenant background scan (polls every tenant's due retries on a schedule) — each row's own tenant_id is carried through and scoped correctly in the per-row orchestrator.verify() calls below
      .from('verification_records')
      .select('employee_id, tenant_id, verification_type, retry_count, updated_at')
      .eq('status', 'degraded')
      .in('verification_type', AUTO_RETRY_TYPES)
      .gt('retry_count', 0)
      .range(from, to),
  )

  const due = degraded.filter(r => isDueForRetry(r.retry_count, r.updated_at))
  if (!due.length) return

  // Batch-resolve current PAN/bank details for every due employee in one
  // query rather than one round-trip per row.
  const employeeIds = [...new Set(due.map(r => r.employee_id))]
  const details = await fetchAllRows<{ id: string; bank: EmployeeBankStatutory | EmployeeBankStatutory[] | null }>((from, to) =>
    supabase
      .from('employees')
      .select('id, bank:employee_bank_statutory(account_number, ifsc_code, pan_number)')
      .in('id', employeeIds)
      .range(from, to),
  )
  const byEmployeeId = new Map(
    details.map(d => [d.id, Array.isArray(d.bank) ? d.bank[0] : d.bank]),
  )

  for (const row of due) {
    const bs = byEmployeeId.get(row.employee_id)
    if (!bs) continue

    if (row.verification_type === 'pan' && bs.pan_number) {
      await verificationOrchestrator.verify({
        supabase,
        employee_id: row.employee_id,
        tenant_id:   row.tenant_id,
        pan:         bs.pan_number,
      }).catch(err => logger.error(
        { tenantId: row.tenant_id, employeeId: row.employee_id, verificationType: 'pan', err },
        '[verification-retry-scanner] retry failed',
      ))
    } else if (row.verification_type === 'bank_account' && bs.account_number && bs.ifsc_code) {
      await verificationOrchestrator.verify({
        supabase,
        employee_id:    row.employee_id,
        tenant_id:      row.tenant_id,
        account_number: bs.account_number,
        ifsc_code:      bs.ifsc_code,
      }).catch(err => logger.error(
        { tenantId: row.tenant_id, employeeId: row.employee_id, verificationType: 'bank_account', err },
        '[verification-retry-scanner] retry failed',
      ))
    }
  }
}

/**
 * Register the verification retry scanner with the given Supabase client.
 * Call once at server startup after the Supabase plugin is registered.
 * Wrapped in safeRegisterModule by the caller — this function must not throw.
 */
export function registerVerificationRetryScanner(_supabase: SupabaseClient): void {
  setTimeout(() => {
    const enqueue = () => {
      const key = `verification-retry-scan:${new Date().toISOString().slice(0, 16)}`
      durableQueue.enqueue('verification-retry-scan', {}, { idempotencyKey: key }).catch(
        e => logger.error({ err: e }, '[verification-retry-scanner] enqueue error'),
      )
    }
    enqueue()
    setInterval(enqueue, SCAN_INTERVAL_MS)
    console.log(`🔍 Verification retry scanner active — scanning every ${SCAN_INTERVAL_MS / 60_000}min`)
  }, WARMUP_MS)
}
