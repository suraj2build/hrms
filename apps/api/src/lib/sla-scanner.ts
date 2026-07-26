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
import { ENTITY_WORKFLOW_MAP, type EntityType } from './workflow-service.js'
import { durableQueue }       from './durable-queue.js'
import { fetchAllRows }       from './supabase-paginate.js'

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

// ── Auto-approve pass (P2.2) ────────────────────────────────────────────────────
/**
 * Honour `approval_workflow_config.auto_approve_after_hours` for stale instances.
 *
 * SAFETY: this only AUTO-ADVANCES intermediate levels — it never auto-finalizes
 * the underlying entity. A robot must not deduct leave balance or credit pay
 * unattended, so the FINAL level always needs a human (final-level breaches still
 * get the SLA-breach notification below). For a multi-level chain this means a
 * dawdling intermediate approver is skipped after the configured window; the next
 * level is then notified to act.
 *
 * "Time at current level" is the instance's updated_at (bumped each advance by the
 * 053 trigger), so each level gets its own fresh auto-approve window.
 */
async function autoAdvanceStaleInstances(
  supabase:     SupabaseClient,
  tenantId:     string,
  hrProfileIds: string[],
): Promise<void> {
  const systemActor = hrProfileIds[0]   // proxy actor for the auto_approved action row
  if (!systemActor) return

  const { data: instances } = await supabase
    .from('approval_instances')
    .select('id, entity_type, current_level, total_levels, updated_at')
    .eq('tenant_id', tenantId)
    .is('final_approved', null)

  // Amount-routed workflows (reimbursement/loan/advance) build their chain by
  // filtering levels on min_amount, so the instance's current_level is an index into
  // the FILTERED chain — not the raw config level. Auto-advancing those by raw level
  // would skip/misread the finance tier, so they are excluded here (auto-approving a
  // finance approval purely on elapsed time is undesirable anyway). Time-off
  // workflows are unfiltered, so current_level == raw level and the lookup is exact.
  const AMOUNT_ROUTED = new Set(['reimbursement', 'loan', 'advance'])

  for (const inst of (instances ?? []) as any[]) {
    // Final level is never auto-finalized — only intermediate levels auto-advance.
    if (inst.current_level >= inst.total_levels) continue

    const workflowType = ENTITY_WORKFLOW_MAP[inst.entity_type as EntityType]
    if (!workflowType) continue
    if (AMOUNT_ROUTED.has(workflowType)) continue

    const { data: cfg } = await supabase
      .from('approval_workflow_config')
      .select('auto_approve_after_hours')
      .eq('tenant_id', tenantId)
      .eq('workflow_type', workflowType)
      .eq('level', inst.current_level)
      .eq('is_active', true)
      .maybeSingle()

    const hrs = (cfg as { auto_approve_after_hours: number | null } | null)?.auto_approve_after_hours
    if (!hrs) continue

    const ageHrs = (Date.now() - new Date(inst.updated_at).getTime()) / 3_600_000
    if (ageHrs < hrs) continue

    const nextLevel = inst.current_level + 1
    // Advance FIRST, conditional on the level we read — so a concurrent scanner /
    // a manual approval that already moved the instance makes this a no-op (0 rows)
    // and we skip recording a duplicate auto_approved action.
    const { data: advanced } = await supabase
      .from('approval_instances')
      .update({ current_level: nextLevel })
      .eq('id', inst.id)
      .eq('tenant_id', tenantId)
      .eq('current_level', inst.current_level)
      .is('final_approved', null)
      .select('id')
    if (!advanced || advanced.length === 0) continue   // someone else moved it — skip

    await supabase.from('approval_actions').insert({
      tenant_id:   tenantId,
      instance_id: inst.id,
      level:       inst.current_level,
      action:      'auto_approved',
      actor_id:    systemActor,
      comments:    `Auto-advanced after ${hrs}h without action (SLA auto-approve).`,
    })

    const dedupeKey = `auto-advance:${inst.id}:${inst.current_level}`
    if (!notifiedIds.has(dedupeKey)) {
      await writeNotifications(
        supabase, tenantId, hrProfileIds,
        'Approval auto-advanced',
        `A ${workflowType.replace('_', ' ')} approval auto-advanced from level ${inst.current_level} to ${nextLevel} after ${hrs}h without action.`,
        '/admin/approvals/workflows',
        inst.id,
      ).catch(() => void 0)
      notifiedIds.add(dedupeKey)
    }
  }
}

// ── Scanner ───────────────────────────────────────────────────────────────────

export async function scan(supabase: SupabaseClient): Promise<void> {
  const cutoffLeave      = new Date(Date.now() - LEAVE_SLA_HOURS      * 3_600_000).toISOString()
  const cutoffCorrection = new Date(Date.now() - CORRECTION_SLA_HOURS * 3_600_000).toISOString()

  // All active tenants
  const tenants = await fetchAllRows<{ id: string }>((from, to) =>
    supabase.from('tenants').select('id').range(from, to),
  )
  const tenantIds = tenants.map(t => t.id)

  for (const tenantId of tenantIds) {
    const hrProfileIds = await fetchHrProfileIds(supabase, tenantId).catch(() => [] as string[])
    if (!hrProfileIds.length) continue

    // ── 0. Auto-advance stale multi-level instances (P2.2) ─────────────────────
    await autoAdvanceStaleInstances(supabase, tenantId, hrProfileIds).catch(() => void 0)

    // ── 1. Overdue leave requests ──────────────────────────────────────────────
    const { data: overLeave } = await supabase
      .from('leave_requests')
      .select('id, employee_id, created_at, employees(first_name, last_name)')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
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

    // ── 3. Overdue helpdesk tickets (ESS-05) ───────────────────────────────────
    // sla_due_at is set per-ticket from priority at creation. A ticket breaches
    // when now > sla_due_at and it is not yet resolved/closed. Stamp
    // sla_breached_at once so the admin queue can flag it.
    const nowIso = new Date().toISOString()
    const { data: overTickets } = await supabase
      .from('helpdesk_tickets')
      .select('id, subject, priority, sla_hours, sla_due_at, created_at, employees(first_name, last_name)')
      .eq('tenant_id', tenantId)
      .is('sla_breached_at', null)
      .not('status', 'in', '(resolved,closed)')
      .lt('sla_due_at', nowIso)

    for (const row of (overTickets ?? [])) {
      const dedupeKey = `helpdesk:${row.id}`
      if (notifiedIds.has(dedupeKey)) continue

      const emp     = Array.isArray(row.employees) ? row.employees[0] : row.employees
      const name    = emp ? `${(emp as any).first_name} ${(emp as any).last_name}` : 'An employee'
      const elapsed = Math.round((Date.now() - new Date(row.created_at).getTime()) / 3_600_000)

      // Stamp the breach so the queue can show a badge (best-effort).
      try {
        await supabase
          .from('helpdesk_tickets')
          .update({ sla_breached_at: nowIso })
          .eq('id', row.id)
          .eq('tenant_id', tenantId)
      } catch { /* non-fatal */ }

      eventBus.emit({
        type:          'sla.breached',
        tenantId,
        correlationId: `sla-scan-helpdesk-${row.id}`,
        payload: {
          tenantId,
          entityType:   'approval',   // closest existing entityType in the union
          entityId:     row.id,
          slaHours:     (row as any).sla_hours ?? 24,
          elapsedHours: elapsed,
        },
      })

      await writeNotifications(
        supabase, tenantId, hrProfileIds,
        'SLA Breach — Helpdesk Ticket',
        `${name}'s ticket "${(row as any).subject}" has breached its ${(row as any).sla_hours ?? 24}h SLA (open ${elapsed}h). Please action it.`,
        '/admin/helpdesk',
        row.id,
      ).catch(() => void 0)

      notifiedIds.add(dedupeKey)
    }

    // ── 4. Resolution-SLA breaches (ESS-05) ────────────────────────────────────
    // resolution_due_at is set per-ticket from priority at creation. A ticket
    // breaches its resolution SLA when now > resolution_due_at and it is still
    // open. Stamp resolution_breached_at once and alert HR.
    const { data: unresolved } = await supabase
      .from('helpdesk_tickets')
      .select('id, subject, resolution_due_at, created_at, employees(first_name, last_name)')
      .eq('tenant_id', tenantId)
      .is('resolution_breached_at', null)
      .not('resolution_due_at', 'is', null)
      .not('status', 'in', '(resolved,closed)')
      .lt('resolution_due_at', nowIso)

    for (const row of (unresolved ?? [])) {
      const dedupeKey = `helpdesk-res:${row.id}`
      if (notifiedIds.has(dedupeKey)) continue

      const emp     = Array.isArray(row.employees) ? row.employees[0] : row.employees
      const name    = emp ? `${(emp as any).first_name} ${(emp as any).last_name}` : 'An employee'
      const elapsed = Math.round((Date.now() - new Date(row.created_at).getTime()) / 3_600_000)

      try {
        await supabase
          .from('helpdesk_tickets')
          .update({ resolution_breached_at: nowIso })
          .eq('id', row.id)
          .eq('tenant_id', tenantId)
      } catch { /* non-fatal */ }

      await writeNotifications(
        supabase, tenantId, hrProfileIds,
        'Resolution SLA Breach — Helpdesk Ticket',
        `${name}'s ticket "${(row as any).subject}" has breached its resolution SLA (open ${elapsed}h). Please resolve it.`,
        '/admin/helpdesk',
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
    const enqueue = () => {
      const key = `sla-scan:${new Date().toISOString().slice(0, 13)}`
      durableQueue.enqueue('sla-scan', {}, { idempotencyKey: key }).catch(
        e => console.error('[sla-scanner] enqueue error:', (e as Error).message),
      )
    }
    enqueue()
    setInterval(enqueue, SCAN_INTERVAL_MS)
    console.log(`🔍 SLA scanner active — scanning every ${SCAN_INTERVAL_MS / 3_600_000}h`)
  }, WARMUP_MS)
}
