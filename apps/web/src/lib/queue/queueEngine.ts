/**
 * lib/queue/queueEngine.ts — Phase UX-7 Operational Queue Engine
 * Pure functions — no React hooks, no side effects.
 */

import type {
  OperationalQueueItem,
  QueueGroup,
  QueueMode,
  QueueSection,
  QueueSeverity,
  QueueSLAMetrics,
  SmartRecommendation,
  TodaysMissionData,
  BulkActionType,
} from './types'
import { QUEUE_MODE_META } from './types'

// ── Raw source interfaces ───────────────────────────────────────────────────

// All fields that come from API responses are treated as optional to survive
// schema drift, partial responses, and API field-name mismatches at runtime.
// Core id + employee_id are string | undefined — items missing both are skipped.
interface RawAnomalyItem {
  id?: string
  employee_id?: string
  employee_name?: string
  // field-name aliases: real API may use 'type' instead of 'anomaly_type'
  anomaly_type?: string
  type?: string
  // real API may use 'attendance_date' / 'anomaly_date'
  date?: string
  attendance_date?: string
  anomaly_date?: string
  shift_id?: string
  site_id?: string
  site_name?: string
  severity?: string
  description?: string
}

interface RawCorrectionItem {
  id?: string
  employee_id?: string
  employee_name?: string
  status?: string
  correction_type?: string
  // real API may use 'created_at'
  requested_at?: string
  created_at?: string
  site_id?: string
}

interface RawRegItem {
  id?: string
  employee_id?: string
  employee_name?: string
  status?: string
  // real API may use 'attendance_date' / 'request_date'
  date?: string
  request_date?: string
  attendance_date?: string
  site_id?: string
  site_name?: string
}

interface RawRevisionItem {
  id?: string
  employee_id?: string
  status?: string
  revision_type?: string
  // real API may use 'effective_from'
  effective_date?: string
  effective_from?: string
  new_ctc_annual?: number
}

interface RawLeaveCollision {
  id?: string
  employee_id?: string
  employee_name?: string
  // real API may use 'date' / 'conflict_date'
  leave_date?: string
  date?: string
  conflict_date?: string
  conflict_type?: string
  site_id?: string
}

interface RawRosterGap {
  id?: string
  site_id?: string
  site_name?: string
  shift_id?: string
  gap_date?: string
  unassigned_count?: number
}

export interface RawSources {
  anomalies?:   RawAnomalyItem[]
  corrections?: RawCorrectionItem[]
  regs?:        RawRegItem[]
  revisions?:   RawRevisionItem[]
  collisions?:  RawLeaveCollision[]
  rosterGaps?:  RawRosterGap[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<QueueSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

function parseSeverity(raw?: string): QueueSeverity {
  if (raw === 'critical' || raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'info') {
    return raw
  }
  return 'medium'
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)
}

function isOverdue(item: Pick<OperationalQueueItem, 'sla_deadline' | 'due_at'>): boolean {
  const deadline = item.sla_deadline ?? item.due_at
  if (!deadline) return false
  return new Date(deadline) < new Date()
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

// ── normalizeToQueueItems ────────────────────────────────────────────────────

export function normalizeToQueueItems(sources: RawSources): OperationalQueueItem[] {
  const items: OperationalQueueItem[] = []
  const now = new Date()

  // Anomalies
  for (const a of sources.anomalies ?? []) {
    // Skip malformed items missing core identity fields
    const aId = a.id ?? ''
    const aEmpId = a.employee_id ?? ''
    if (!aId || !aEmpId) continue

    // Field-name alias resolution
    const anomalyType = a.anomaly_type ?? a.type ?? ''
    const anomalyDate = a.date ?? a.attendance_date ?? a.anomaly_date ?? new Date().toISOString().slice(0, 10)

    let section: QueueSection = 'needs_review'
    let queueType: OperationalQueueItem['queue_type'] = 'attendance_anomaly'
    const payrollBlocking = false
    let groupKey: string | undefined

    if (anomalyType === 'missing_punch') {
      section = 'missing_punches'
      queueType = 'missing_punch'
      if (a.site_id) groupKey = `site:${a.site_id}:${anomalyDate}`
    } else if (anomalyType === 'ot_spike') {
      section = 'ot_verification'
      queueType = 'ot_verification'
    } else if (anomalyType === 'biometric_failure') {
      section = 'needs_review'
      queueType = 'biometric_failure'
    }

    const severity = parseSeverity(a.severity)
    const overdue = isOverdue({ sla_deadline: undefined, due_at: undefined })
    const typeLabel = anomalyType ? anomalyType.replace(/_/g, ' ') : 'attendance anomaly'

    items.push({
      id: aId,
      queue_type: queueType,
      severity,
      section,
      employee_id: aEmpId,
      employee_name: a.employee_name,
      site_id: a.site_id,
      site_name: a.site_name,
      title: `${typeLabel} — ${anomalyDate}`,
      reason: a.description ?? `Anomaly detected: ${typeLabel}`,
      action_required: 'Review and resolve attendance anomaly',
      payroll_blocking: payrollBlocking,
      estimated_resolution_time: 5,
      related_entities: a.shift_id
        ? [{ type: 'shift', id: a.shift_id, label: `Shift ${a.shift_id}` }]
        : [],
      workflow_target: '/admin/my-work-queue',
      created_at: anomalyDate,
      overdue,
      group_key: groupKey,
      status: 'open',
    })
  }

  // Corrections
  for (const c of sources.corrections ?? []) {
    const cId = c.id ?? ''
    const cEmpId = c.employee_id ?? ''
    if (!cId || !cEmpId) continue

    const isCritical = c.status === 'disputed'
    const severity: QueueSeverity = isCritical ? 'critical' : 'medium'
    const overdue = isOverdue({ sla_deadline: undefined, due_at: undefined })
    const createdAt = c.requested_at ?? c.created_at ?? new Date().toISOString()

    items.push({
      id: cId,
      queue_type: 'correction_pending',
      severity,
      section: 'needs_review',
      employee_id: cEmpId,
      employee_name: c.employee_name,
      site_id: c.site_id,
      title: `Correction ${c.correction_type ?? 'pending'} — ${c.employee_name ?? cEmpId}`,
      reason: isCritical ? 'Correction is disputed and requires immediate attention' : 'Attendance correction awaiting approval',
      action_required: 'Review and approve or reject the correction',
      payroll_blocking: false,
      estimated_resolution_time: 10,
      related_entities: [],
      workflow_target: '/admin/my-work-queue',
      created_at: createdAt,
      overdue,
      status: 'open',
    })
  }

  // Regularisation requests
  for (const r of sources.regs ?? []) {
    const rId = r.id ?? ''
    const rEmpId = r.employee_id ?? ''
    if (!rId || !rEmpId) continue

    const regDateStr = r.date ?? r.request_date ?? r.attendance_date ?? new Date().toISOString().slice(0, 10)
    const regDate = new Date(regDateStr)
    const ageDays = isNaN(regDate.getTime()) ? 0 : daysBetween(regDate, now)
    const payrollBlocking = ageDays > 3

    const severity: QueueSeverity = payrollBlocking ? 'high' : 'medium'
    const overdue = isOverdue({ sla_deadline: undefined, due_at: undefined })

    items.push({
      id: rId,
      queue_type: 'regularisation_pending',
      severity,
      section: 'missing_punches',
      employee_id: rEmpId,
      employee_name: r.employee_name,
      site_id: r.site_id,
      site_name: r.site_name,
      title: `Regularisation pending — ${regDateStr}`,
      reason: `Employee attendance regularisation has been pending for ${Math.floor(ageDays)} day(s)`,
      action_required: payrollBlocking ? 'Approve immediately to unblock payroll' : 'Review and approve regularisation',
      payroll_blocking: payrollBlocking,
      estimated_resolution_time: 5,
      related_entities: [],
      workflow_target: '/admin/my-work-queue',
      created_at: regDateStr,
      overdue,
      status: 'open',
    })
  }

  // Payroll revisions
  for (const v of sources.revisions ?? []) {
    const vId = v.id ?? ''
    const vEmpId = v.employee_id ?? ''
    if (!vId || !vEmpId) continue

    const revType = v.revision_type ?? 'revision'
    const effDate = v.effective_date ?? v.effective_from ?? new Date().toISOString().slice(0, 10)
    const overdue = isOverdue({ sla_deadline: undefined, due_at: undefined })

    items.push({
      id: vId,
      queue_type: 'payroll_blocker',
      severity: 'high',
      section: 'needs_review',
      employee_id: vEmpId,
      title: `Payroll revision — ${revType}`,
      reason: `Pending payroll revision (${revType}) effective ${effDate}`,
      action_required: 'Approve revision to unblock payroll processing',
      payroll_blocking: true,
      estimated_resolution_time: 15,
      related_entities: [],
      workflow_target: '/admin/payroll/center',
      created_at: effDate,
      overdue,
      status: 'open',
    })
  }

  // Leave collisions
  for (const col of sources.collisions ?? []) {
    const colId = col.id ?? ''
    const colEmpId = col.employee_id ?? ''
    if (!colId || !colEmpId) continue

    const leaveDate = col.leave_date ?? col.date ?? col.conflict_date ?? new Date().toISOString().slice(0, 10)
    const overdue = isOverdue({ sla_deadline: undefined, due_at: undefined })

    items.push({
      id: colId,
      queue_type: 'leave_conflict',
      severity: 'medium',
      section: 'leave_conflicts',
      employee_id: colEmpId,
      employee_name: col.employee_name,
      site_id: col.site_id,
      title: `Leave conflict — ${leaveDate}`,
      reason: col.conflict_type ?? 'Leave request conflicts with attendance record',
      action_required: 'Review leave and attendance records to resolve conflict',
      payroll_blocking: false,
      estimated_resolution_time: 10,
      related_entities: [],
      workflow_target: '/admin/my-work-queue',
      created_at: leaveDate,
      overdue,
      status: 'open',
    })
  }

  // Roster gaps
  for (const g of sources.rosterGaps ?? []) {
    const gId = g.id ?? ''
    const gSiteId = g.site_id ?? ''
    if (!gId) continue

    const gapDate = g.gap_date ?? new Date().toISOString().slice(0, 10)
    const overdue = isOverdue({ sla_deadline: undefined, due_at: undefined })

    items.push({
      id: gId,
      queue_type: 'roster_gap',
      severity: 'medium',
      section: 'shift_conflicts',
      employee_id: '',
      site_id: gSiteId || undefined,
      site_name: g.site_name,
      title: `Roster gap — ${g.site_name ?? gSiteId} on ${gapDate}`,
      reason: `${g.unassigned_count ?? 1} unassigned slot(s) on ${gapDate}`,
      action_required: 'Assign employees to fill roster gap',
      payroll_blocking: false,
      estimated_resolution_time: 20,
      related_entities: g.shift_id
        ? [{ type: 'shift', id: g.shift_id, label: `Shift ${g.shift_id}` }]
        : [],
      workflow_target: '/admin/roster',
      created_at: gapDate,
      overdue,
      status: 'open',
    })
  }

  return items
}

// ── autoHideFilter ───────────────────────────────────────────────────────────

export function autoHideFilter(
  items: OperationalQueueItem[],
  mode: QueueMode,
): OperationalQueueItem[] {
  const config = QUEUE_MODE_META[mode]
  const threshold = SEVERITY_ORDER[config.autoHideThreshold]

  // De-duplicate: same employee_id + same queue_type + same date within 2 min
  const seen = new Map<string, OperationalQueueItem>()
  for (const item of items) {
    const dateKey = item.created_at.slice(0, 10)
    const dedupeKey = `${item.employee_id}:${item.queue_type}:${dateKey}`
    const existing = seen.get(dedupeKey)
    if (!existing) {
      seen.set(dedupeKey, item)
    } else {
      // Keep the latest
      const existingTime = new Date(existing.created_at).getTime()
      const itemTime = new Date(item.created_at).getTime()
      const diffMs = Math.abs(itemTime - existingTime)
      if (diffMs <= 2 * 60 * 1000 && itemTime > existingTime) {
        seen.set(dedupeKey, item)
      } else if (diffMs > 2 * 60 * 1000) {
        // Different time window — keep both by using full key
        seen.set(`${dedupeKey}:${item.id}`, item)
      }
    }
  }

  return Array.from(seen.values()).filter(item => {
    // Always hide resolved/dismissed
    if (item.status === 'resolved' || item.status === 'dismissed') return false

    // Move info non-blocking to safe_to_ignore (don't hide unless threshold filters it)
    const itemSeverityOrder = SEVERITY_ORDER[item.severity]
    if (itemSeverityOrder < threshold && !item.payroll_blocking) return false

    return true
  })
}

// ── applyModeFilter ──────────────────────────────────────────────────────────

export function applyModeFilter(
  items: OperationalQueueItem[],
  mode: QueueMode,
): OperationalQueueItem[] {
  return autoHideFilter(items, mode)
}

// ── prioritizeItems ──────────────────────────────────────────────────────────

function computeScore(item: OperationalQueueItem, mode: QueueMode): number {
  const severityScore =
    item.severity === 'critical' ? 400 :
    item.severity === 'high' ? 200 :
    item.severity === 'medium' ? 100 :
    item.severity === 'low' ? 50 : 0

  const dueAt = item.due_at ?? item.sla_deadline
  let dueScore = 0
  if (dueAt) {
    const daysUntil = daysBetween(new Date(), new Date(dueAt))
    if (daysUntil <= 1) dueScore = 150
    else if (daysUntil <= 3) dueScore = 75
  }

  let base =
    (item.payroll_blocking ? 1000 : 0) +
    severityScore +
    (item.overdue ? 300 : 0) +
    dueScore +
    (item.related_entities.length * 10)

  if (mode === 'payroll_week' && item.payroll_blocking) {
    base = base * 1.5
  }

  return base
}

export function prioritizeItems(
  items: OperationalQueueItem[],
  mode: QueueMode,
): OperationalQueueItem[] {
  return [...items].sort((a, b) => computeScore(b, mode) - computeScore(a, mode))
}

// ── groupQueueItems ──────────────────────────────────────────────────────────

export function groupQueueItems(items: OperationalQueueItem[]): QueueGroup[] {
  // Group by group_key if present
  const groupMap = new Map<string, OperationalQueueItem[]>()

  for (const item of items) {
    const key = item.group_key ?? `singleton:${item.id}`
    const arr = groupMap.get(key) ?? []
    arr.push(item)
    groupMap.set(key, arr)
  }

  const groups: QueueGroup[] = []

  for (const [key, groupItems] of groupMap.entries()) {
    if (key.startsWith('singleton:')) {
      // Each item gets its own "group" of 1
      for (const item of groupItems) {
        groups.push({
          key: `singleton:${item.id}`,
          label: item.title,
          items: [item],
          payroll_blocking_count: item.payroll_blocking ? 1 : 0,
          can_bulk_action: false,
        })
      }
      continue
    }

    const payrollBlockingCount = groupItems.filter(i => i.payroll_blocking).length

    // Determine group type
    const firstItem = groupItems[0]
    let label = `${groupItems.length} items`
    let canBulkAction = false
    let suggestedAction: string | undefined
    let bulkActionType: BulkActionType | undefined

    if (key.startsWith('site:')) {
      // site:siteId:date
      const siteName = firstItem.site_name ?? firstItem.site_id ?? 'Unknown site'
      const qType = firstItem.queue_type.replace(/_/g, ' ')
      label = `${groupItems.length} ${qType} at ${siteName}`
    }

    // OT verification same shift
    if (
      firstItem.queue_type === 'ot_verification' &&
      firstItem.related_entities.some(e => e.type === 'shift')
    ) {
      const shiftEntity = firstItem.related_entities.find(e => e.type === 'shift')
      label = `OT cluster: ${shiftEntity?.label ?? 'shift'} (${groupItems.length} employees)`
      suggestedAction = 'bulk approve OT'
      canBulkAction = true
      bulkActionType = 'approve'
    }

    // Low-risk non-blocking group
    if (
      groupItems.every(i => !i.payroll_blocking) &&
      groupItems.every(i => i.severity === 'low')
    ) {
      const qType = firstItem.queue_type.replace(/_/g, ' ')
      label = `${groupItems.length} low-risk ${qType}`
      canBulkAction = true
      bulkActionType = 'approve'
    }

    groups.push({
      key,
      label,
      items: groupItems,
      payroll_blocking_count: payrollBlockingCount,
      can_bulk_action: canBulkAction,
      suggested_action: suggestedAction,
      bulk_action_type: bulkActionType,
    })
  }

  return groups
}

// ── generateRecommendations ──────────────────────────────────────────────────

export function generateRecommendations(groups: QueueGroup[]): SmartRecommendation[] {
  const recs: SmartRecommendation[] = []

  // Flatten all items
  const allItems = groups.flatMap(g => g.items)

  // Rule 1: >= 5 same-site missing_punch all severity <= 'low'
  const siteMissingMap = new Map<string, OperationalQueueItem[]>()
  for (const item of allItems) {
    if (
      item.queue_type === 'missing_punch' &&
      (item.severity === 'low' || item.severity === 'info') &&
      item.site_id
    ) {
      const arr = siteMissingMap.get(item.site_id) ?? []
      arr.push(item)
      siteMissingMap.set(item.site_id, arr)
    }
  }
  for (const [, siteItems] of siteMissingMap.entries()) {
    if (siteItems.length >= 5) {
      recs.push({
        id: `rec-safe-punch-${siteItems[0].site_id}`,
        text: `These ${siteItems.length} punches are safe for auto-approval`,
        action_label: 'Approve All',
        action_type: 'approve',
        affected_ids: siteItems.map(i => i.id),
        confidence: 85,
      })
    }
  }

  // Rule 2: any site with >= 3 payroll_blocking items
  const siteBlockerMap = new Map<string, OperationalQueueItem[]>()
  for (const item of allItems) {
    if (item.payroll_blocking && item.site_id) {
      const arr = siteBlockerMap.get(item.site_id) ?? []
      arr.push(item)
      siteBlockerMap.set(item.site_id, arr)
    }
  }
  for (const [siteId, siteItems] of siteBlockerMap.entries()) {
    if (siteItems.length >= 3) {
      const siteName = siteItems[0].site_name ?? siteId
      recs.push({
        id: `rec-payroll-site-${siteId}`,
        text: `Resolve ${siteName} first to unblock payroll`,
        action_label: 'Go to Site',
        action_type: 'escalate',
        affected_ids: siteItems.map(i => i.id),
        confidence: 95,
      })
    }
  }

  // Rule 3: >= 3 ot_verification sharing same shift
  const shiftOtMap = new Map<string, OperationalQueueItem[]>()
  for (const item of allItems) {
    if (item.queue_type === 'ot_verification') {
      const shiftEntity = item.related_entities.find(e => e.type === 'shift')
      if (shiftEntity) {
        const arr = shiftOtMap.get(shiftEntity.id) ?? []
        arr.push(item)
        shiftOtMap.set(shiftEntity.id, arr)
      }
    }
  }
  for (const [, shiftItems] of shiftOtMap.entries()) {
    if (shiftItems.length >= 3) {
      recs.push({
        id: `rec-ot-cluster-${shiftItems[0].id}`,
        text: `This OT cluster likely caused by roster mismatch`,
        action_label: 'Approve OT',
        action_type: 'approve',
        affected_ids: shiftItems.map(i => i.id),
        confidence: 75,
      })
    }
  }

  // Rule 4: >= 5 regularisation_pending from same employee_id
  const empRegMap = new Map<string, OperationalQueueItem[]>()
  for (const item of allItems) {
    if (item.queue_type === 'regularisation_pending') {
      const arr = empRegMap.get(item.employee_id) ?? []
      arr.push(item)
      empRegMap.set(item.employee_id, arr)
    }
  }
  for (const [empId, empItems] of empRegMap.entries()) {
    if (empItems.length >= 5) {
      const empName = empItems[0].employee_name ?? empId
      recs.push({
        id: `rec-recurring-${empId}`,
        text: `Employee ${empName} has recurring attendance issues`,
        action_label: 'Escalate',
        action_type: 'escalate',
        affected_ids: empItems.map(i => i.id),
        confidence: 80,
      })
    }
  }

  // Rule 5: >= 10 compliance_risks all low severity
  const lowComplianceItems = allItems.filter(
    i => i.section === 'compliance_risks' && i.severity === 'low',
  )
  if (lowComplianceItems.length >= 10) {
    recs.push({
      id: 'rec-compliance-dismiss',
      text: `These ${lowComplianceItems.length} compliance flags are low-risk — safe to dismiss`,
      action_label: 'Dismiss All',
      action_type: 'reject',
      affected_ids: lowComplianceItems.map(i => i.id),
      confidence: 70,
    })
  }

  return recs
}

// ── computeSLAMetrics ────────────────────────────────────────────────────────

export function computeSLAMetrics(items: OperationalQueueItem[]): QueueSLAMetrics {
  const nonSafeItems = items.filter(i => i.section !== 'safe_to_ignore')

  const avgResolutionTime =
    nonSafeItems.length > 0
      ? nonSafeItems.reduce((sum, i) => sum + i.estimated_resolution_time, 0) / nonSafeItems.length
      : 0

  const overdueCount = items.filter(i => i.overdue).length
  const payrollBlockersOverdue = items.filter(i => i.overdue && i.payroll_blocking).length

  const siteResponsiveness: Record<string, number> = {}
  for (const item of items) {
    if (item.overdue && item.site_id) {
      siteResponsiveness[item.site_id] = (siteResponsiveness[item.site_id] ?? 0) + 1
    }
  }

  return {
    avg_resolution_time_mins: Math.round(avgResolutionTime),
    overdue_count: overdueCount,
    payroll_blockers_overdue: payrollBlockersOverdue,
    site_responsiveness: siteResponsiveness,
  }
}

// ── computeTodaysMission ─────────────────────────────────────────────────────

export function computeTodaysMission(
  items: OperationalQueueItem[],
  mode: QueueMode,
): TodaysMissionData {
  const blockersRemaining = items.filter(i => i.payroll_blocking && i.status === 'open').length
  const sla = computeSLAMetrics(items)
  const overdueCount = sla.overdue_count

  const estimatedPayrollReadiness = Math.max(
    0,
    100 - blockersRemaining * 10 - overdueCount * 5,
  )

  const actionsRequiredToday = items.filter(i => i.due_at && isToday(i.due_at)).length

  // Urgent sites: >= 2 critical/high items
  const siteSeverityMap = new Map<string, number>()
  for (const item of items) {
    if (
      item.site_id &&
      (item.severity === 'critical' || item.severity === 'high')
    ) {
      siteSeverityMap.set(item.site_id, (siteSeverityMap.get(item.site_id) ?? 0) + 1)
    }
  }
  const urgentSites: string[] = []
  for (const [siteId, count] of siteSeverityMap.entries()) {
    if (count >= 2) {
      // Try to get site name
      const siteItem = items.find(i => i.site_id === siteId)
      urgentSites.push(siteItem?.site_name ?? siteId)
    }
  }

  const slaRisks = items.filter(i => i.overdue).map(i => i.title)

  return {
    blockers_remaining: blockersRemaining,
    estimated_payroll_readiness: estimatedPayrollReadiness,
    actions_required_today: actionsRequiredToday,
    urgent_sites: urgentSites,
    sla_risks: slaRisks,
    queue_mode: mode,
  }
}
