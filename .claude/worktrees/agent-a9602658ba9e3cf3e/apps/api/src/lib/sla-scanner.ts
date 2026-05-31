/**
 * SLA Scanner — Phase 6 Operational Automation
 *
 * Proactively scans for pending leave requests and attendance corrections
 * that have exceeded SLA thresholds without action.  Fires sla.breached events
 * (which write to audit_logs via event-bus-automation) AND writes in-app
 * notification rows directly so HR managers see the alert in the notification bell.
 *
 * Architecture:
 *   - Runs on an interval (SCAN_INTERVAL_MS — 4 hours default)
 *   - Queries leave_applications and attendance_regularisation for overdue items
 *   - Per-tenant HR profile lookup (super_admin / hr_admin)
 *   - Deduplicates within one process lifetime via an in-memory Set<string>
 *   - 5-minute warm-up delay at startup avoids hammering DB during restart
 *
 * Registration:
 *   Call registerSlaScanner(supabase) once at startup, AFTER the Supabase
 *   plugin is registered.  Wrapped in safeRegisterModule so failures are isolated.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { eventBus }           from './event-bus.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** How often the scanner runs (milliseconds). */
const SCAN_INTERVAL_MS = 4 * 60 * 60 * 1_000   // 4 hours

/** Leave approval SLA in hours — matches event-bus-automation constant. */
const LEAVE_SLA_HOURS = 48

/** Correction approval SLA in hours — matches event-bus-automation constant. */
const CORRECTION_SLA_HOURS = 24

/** Warm-up delay before the first scan fires. */
const WARMUP_MS = 5 * 60 * 1_000    // 5 minutes

// ── In-process deduplication ──────────────────────────────────────────────────
// Prevents re-notifying the same item within one process lifetime.
// Reset on process restart (acceptable — re-notification on restart is low-harm).

const notifiedIds = new Set<string>()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchHrProfileIds(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['super_admin', 'hr_admin'])
  return (data ?? []).map((r: { id: string }) => r.id)
}

async function writeNotifications(
  supabase:     SupabaseClient,
  tenantId:     string,
  recipientIds: string[],
  title:        string,
  body:         string,
  link:         string,
  eventId:      string,
): Promise<void> {
  if (!recipientIds.length) return
  const rows = recipientIds.map(recipientId => ({
    tenant_id:    tenantId,
    recipient_id: recipientId,
    title,
    body,
    link,
    is_read:  false,
    event_id: eventId,
  }))
  await supabase.from('notifications').insert(rows)
}

// ── Scanner ───────────────────────────────────────────────────────────────────

async function scan(supabase: SupabaseClient): Promise<void> {
  const cutoffLeave      = new Date(Date.now() - LEAVE_SLA_HOURS      * 3_600_000).toISOString()
  const cutoffCorrection = new Date(Date.now() - CORRECTION_SLA_HOURS * 3_600_000).toISOString()

  // All active tenants
  const { data: tenants } = await supabase.from('tenants').select('id')
  const tenantIds = (tenants ?? []).map((t: { id: string }) => t.id)

  for (const tenantId of tenantIds) {
    const hrProfileIds = await fetchHrProfileIds(supabase, tenantId).catch(() => [] as string[])
    if (!hrProfileIds.length) continue

    // ── 1. Overdue leave requests ──────────────────────────────────────────────
    const { data: overLeave } = await supabase
      .from('leave_applications')
      .select('id, employee_id, created_at, employees(first_name, last_name)')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .lt('created_at', cutoffLeave)

    for (const row of (overLeave ?? [])) {
      const dedupeKey = `leave:${row.id}`
      if (notifiedIds.has(dedupeKey)) continue

      const emp    = Array.isArray(row.employees) ? row.employees[0] : row.employees
      const name   = emp ? `${(emp as any).first_name} ${(emp as any).last_name}` : 'An employee'
      const elapsed = Math.round((Date.now() - new Date(row.created_at).getTime()) / 3_600_000)

      // Fire observable event (also writes to audit_logs via event-bus-automation)
      eventBus.emit({
        type:          'sla.breached',
        tenantId,
        correlationId: `sla-scan-leave-${row.id}`,
        payload: {
          tenantId,
          entityType:   'leave',
          entityId:     row.id,
          slaHours:     LEAVE_SLA_HOURS,
          elapsedHours: elapsed,
        },
      })

      // Write in-app notification to all HR managers for this tenant
      await writeNotifications(
        supabase, tenantId, hrProfileIds,
        'SLA Breach — Leave Request',
        `${name}'s leave request has been pending for ${elapsed} hours (SLA: ${LEAVE_SLA_HOURS}h). Please approve or reject.`,
        '/admin/approvals',
        row.id,
      ).catch(() => void 0)   // non-fatal

      notifiedIds.add(dedupeKey)
    }

    // ── 2. Overdue correction requests ─────────────────────────────────────────
    const { data: overCorr } = await supabase
      .from('attendance_regularisation')
      .select('id, employee_id, created_at, employees(first_name, last_name)')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .lt('created_at', cutoffCorrection)

    for (const row of (overCorr ?? [])) {
      const dedupeKey = `correction:${row.id}`
      if (notifiedIds.has(dedupeKey)) continue

      const emp    = Array.isArray(row.employees) ? row.employees[0] : row.employees
      const name   = emp ? `${(emp as any).first_name} ${(emp as any).last_name}` : 'An employee'
      const elapsed = Math.round((Date.now() - new Date(row.created_at).getTime()) / 3_600_000)

      eventBus.emit({
        type:          'sla.breached',
        tenantId,
        correlationId: `sla-scan-correction-${row.id}`,
        payload: {
          tenantId,
          entityType:   'correction',
          entityId:     row.id,
          slaHours:     CORRECTION_SLA_HOURS,
          elapsedHours: elapsed,
        },
      })

      await writeNotifications(
        supabase, tenantId, hrProfileIds,
        'SLA Breach — Attendance Correction',
        `${name}'s correction request has been pending for ${elapsed} hours (SLA: ${CORRECTION_SLA_HOURS}h). Please action it.`,
        '/admin/attendance/regularisation',
        row.id,
      ).catch(() => void 0)

      notifiedIds.add(dedupeKey)
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the SLA scanner with the given Supabase client.
 * Call once at server startup after the Supabase plugin is registered.
 * Wrapped in safeRegisterModule by the caller — this function must not throw.
 */
export function registerSlaScanner(supabase: SupabaseClient): void {
  // Warm-up delay — first scan fires after startup completes
  setTimeout(() => {
    scan(supabase).catch(e => console.error('[sla-scanner] initial scan error:', (e as Error).message))
    setInterval(
      () => scan(supabase).catch(e => console.error('[sla-scanner] scan error:', (e as Error).message)),
      SCAN_INTERVAL_MS,
    )
    console.log(`🔍 SLA scanner active — scanning every ${SCAN_INTERVAL_MS / 3_600_000}h`)
  }, WARMUP_MS)
}
