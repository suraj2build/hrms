/* eslint-disable react-refresh/only-export-components -- co-locates the EXPLANATIONS lookup table with the panel component it documents; not a hot-reload boundary */
/**
 * ExplainIssuePanel — contextual forensics Sheet panel.
 * Replaces standalone forensics/replay pages; triggered from queue item cards
 * and EmployeeResolutionWorkspace.
 */

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SEVERITY_META } from '@/lib/queue/types'
import type { OperationalQueueItem, QueueType } from '@/lib/queue/types'

// ── Props ──────────────────────────────────────────────────────────────────

export interface ExplainIssuePanelProps {
  open:              boolean
  onClose:           () => void
  item:              OperationalQueueItem | null
  onOpenEmployee?:   (employeeId: string) => void
}

// ── Time helper ────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Explainability lookup ──────────────────────────────────────────────────

export const EXPLANATIONS: Record<QueueType, {
  why: string
  how_detected: string
  confidence: string
  typical_cause: string
}> = {
  missing_punch: {
    why: 'Employee has no punch-out record for this work period',
    how_detected: 'Daily attendance sweep compares expected vs actual punches',
    confidence: 'High (>95%)',
    typical_cause: 'Forgot to punch out, biometric failure, or shift extension',
  },
  ot_verification: {
    why: 'Total hours exceed the configured overtime threshold for this shift',
    how_detected: 'Post-shift hours calculation against shift definition + policy',
    confidence: 'High (>90%)',
    typical_cause: 'Genuine overtime, roster error, or missed punch creating phantom hours',
  },
  shift_conflict: {
    why: 'Employee is assigned to overlapping shifts or an unresourced shift period',
    how_detected: 'Roster assignment overlap detection run nightly',
    confidence: 'Very High (>98%)',
    typical_cause: 'Manual roster edit, bulk shift assignment error, or roster template bug',
  },
  leave_conflict: {
    why: 'Approved leave overlaps with recorded attendance or shift assignment',
    how_detected: 'Cross-check between leave approvals and attendance/roster on the same date',
    confidence: 'High (>92%)',
    typical_cause: 'Leave approved after shift assigned, or attendance recorded on a leave day',
  },
  payroll_blocker: {
    why: 'This record must be resolved before payroll can be frozen for this period',
    how_detected: 'Pre-run payroll readiness check',
    confidence: 'Critical',
    typical_cause: 'Unresolved attendance anomaly, pending revision, or open correction request',
  },
  compliance_risk: {
    why: 'A regulatory or company policy threshold has been exceeded or is at risk',
    how_detected: 'Policy engine nightly scan against statutory and company rule sets',
    confidence: 'Medium (>75%)',
    typical_cause: 'Working hours limit, mandatory rest violation, or statutory contribution gap',
  },
  attendance_anomaly: {
    why: 'Attendance record shows a pattern that deviates from expected behavior',
    how_detected: 'Statistical deviation from employee baseline and site norms',
    confidence: 'Medium (>70%)',
    typical_cause: 'Equipment malfunction, policy change not reflected in system, or genuine anomaly',
  },
  correction_pending: {
    why: 'An attendance correction has been submitted and is awaiting approval',
    how_detected: 'Correction request submitted by employee or HR',
    confidence: 'N/A (manual submission)',
    typical_cause: 'Punch error, roster change, or payroll adjustment request',
  },
  regularisation_pending: {
    why: 'Employee has requested regularisation for a missing or incorrect attendance record',
    how_detected: 'Regularisation request submitted via ESS portal',
    confidence: 'N/A (manual submission)',
    typical_cause: 'Work-from-home, client visit, or field work not captured by biometric',
  },
  roster_gap: {
    why: 'A shift period has no assigned employee coverage at this site',
    how_detected: 'Daily roster coverage check against minimum staffing requirements',
    confidence: 'Very High (>97%)',
    typical_cause: 'Employee absence, roster not updated after resignation, or bulk scheduling gap',
  },
  biometric_failure: {
    why: 'Biometric device failed to capture a valid punch record',
    how_detected: 'Device health monitoring + attendance record gap analysis',
    confidence: 'High (>88%)',
    typical_cause: 'Device offline, fingerprint not enrolled, or network connectivity issue',
  },
  duplicate_entry: {
    why: 'Multiple records for the same event exist, creating data inconsistency',
    how_detected: 'Duplicate detection on employee_id + event_type + timestamp (within 5 min window)',
    confidence: 'High (>90%)',
    typical_cause: 'Double tap on biometric device, data sync replay, or manual entry after device capture',
  },
}

// ── Resolution paths ───────────────────────────────────────────────────────

const RESOLUTION_PATHS: Record<QueueType, string[]> = {
  missing_punch: [
    'Check if employee was present via manual register or manager confirmation',
    'If present: approve regularisation or correct punch time',
    'If absent: mark as absent and notify payroll',
  ],
  ot_verification: [
    'Verify with shift supervisor whether OT was authorized',
    'Check roster for unplanned shift extension',
    'If valid OT: approve in queue; if not: reject and flag for investigation',
  ],
  shift_conflict: [
    'Open Roster Workspace to view the conflicting assignment',
    'Reassign employee to correct shift or remove duplicate assignment',
    'Re-run roster coverage check after resolution',
  ],
  leave_conflict: [
    'Check if leave should override attendance or attendance should override leave',
    'If leave is valid: mark attendance record as leave day',
    'If attendance is valid: cancel or amend the leave request',
  ],
  payroll_blocker: [
    'This issue must be resolved before payroll can run',
    'Approve or reject the underlying record first',
    'Return to Payroll Control Center to re-run readiness check after resolution',
  ],
  compliance_risk: [
    'Review the specific compliance rule triggered (shown in reason field)',
    'If fixable: resolve the underlying attendance/roster issue',
    'If exception needed: document in compliance notes and escalate',
  ],
  attendance_anomaly: [
    'Review the attendance record in detail using employee profile',
    'Compare with biometric device logs if available',
    'Approve correction, regularize, or escalate for investigation',
  ],
  correction_pending: [
    'Review the submitted correction against original records',
    'Confirm with manager or supervisor if needed',
    'Approve if valid, reject with reason if not',
  ],
  regularisation_pending: [
    'Verify with manager that employee was working on this date',
    'Check leave balance for potential leave conversion',
    'Approve with appropriate attendance type or reject',
  ],
  roster_gap: [
    'Open Roster Workspace and assign an available employee',
    'If no employee available: escalate to branch manager',
    'Update staffing pool if this is a recurring gap',
  ],
  biometric_failure: [
    'Check device health status in System → Observability',
    'If device offline: manual attendance entry for affected period',
    'If fingerprint issue: update biometric enrollment via HR admin',
  ],
  duplicate_entry: [
    'Compare the duplicate records and identify the correct one',
    'Mark incorrect record for deletion (flag, do not delete directly)',
    'Escalate to system admin if sync issue is suspected',
  ],
}

// ── History entry type ─────────────────────────────────────────────────────

interface HistoryEntry {
  id: string
  created_at: string
  resolution_type: string
}

function toHistoryEntry(raw: unknown): HistoryEntry {
  const r = raw as Record<string, unknown>
  return {
    id:              String(r['id'] ?? ''),
    created_at:      String(r['created_at'] ?? r['date'] ?? ''),
    resolution_type: String(r['resolution_type'] ?? r['status'] ?? 'resolved'),
  }
}

// ── Main component ─────────────────────────────────────────────────────────

export function ExplainIssuePanel({
  open,
  onClose,
  item,
  onOpenEmployee,
}: ExplainIssuePanelProps) {
  const { data: historyRaw } = useQuery({
    queryKey: ['issue-history', item?.employee_id, item?.queue_type],
    queryFn:  () =>
      api
        .get<{ data?: unknown[] }>(`/attendance/anomalies?employee_id=${item!.employee_id}&type=${item!.queue_type}&limit=10&resolved=true`)
        .then(r => r),
    enabled:   !!item?.employee_id && open,
    staleTime: 60_000,
  })

  const historyItems: HistoryEntry[] = Array.isArray(historyRaw?.data)
    ? (historyRaw!.data as unknown[]).map(toHistoryEntry)
    : []

  const last30Days = historyItems.filter(h => {
    if (!h.created_at) return false
    const diffDays = (Date.now() - new Date(h.created_at).getTime()) / 86_400_000
    return diffDays <= 30
  })

  const recentCount = last30Days.length
  const lastThree   = historyItems.slice(0, 3)

  const explanation     = item ? EXPLANATIONS[item.queue_type] : null
  const resolutionSteps = item ? RESOLUTION_PATHS[item.queue_type] : []
  const meta            = item ? SEVERITY_META[item.severity] : null

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent className="w-[480px]">
        <SheetHeader>
          <SheetTitle>Explain This Issue</SheetTitle>
        </SheetHeader>

        <SheetBody>
          {!item ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No issue selected.</p>
          ) : (
            <div className="flex flex-col gap-5">

              {/* ── 1. Issue Summary Card ────────────────────────────── */}
              <div className={cn(
                'rounded border-l-4 px-4 py-3',
                meta?.border ?? 'border-border',
                meta?.bg ?? 'bg-muted/30',
              )}>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-foreground leading-snug flex-1">
                    {item.title}
                  </p>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {item.queue_type.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Detected {timeAgo(item.created_at)}
                </p>
                {item.overdue && item.due_at && (
                  <p className="text-[11px] text-warning font-medium mt-1">
                    ⚠ Overdue — {timeAgo(item.due_at)}
                  </p>
                )}
              </div>

              {/* ── 2. Why This Was Flagged ──────────────────────────── */}
              {explanation && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                    Why This Was Flagged
                  </p>
                  <div className="rounded border border-border bg-muted/20 px-4 py-3 flex flex-col gap-2">
                    <ExplainRow label="Why flagged"    value={explanation.why} />
                    <ExplainRow label="How detected"   value={explanation.how_detected} />
                    <ExplainRow label="Confidence"     value={explanation.confidence} />
                    <ExplainRow label="Typical cause"  value={explanation.typical_cause} />
                  </div>
                </div>
              )}

              {/* ── 3. Historical Context ────────────────────────────── */}
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                  Historical Context
                </p>

                {/* Recurrence metric chip */}
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-secondary border border-border px-2.5 py-1 text-[11px] font-medium text-foreground">
                    Recurrence: {recentCount} similar issue{recentCount !== 1 ? 's' : ''} in the past 30 days
                  </span>
                </div>

                {/* Recurring warning */}
                {recentCount > 3 && (
                  <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2">
                    <p className="text-[11px] text-warning font-medium">
                      ⚠ Recurring pattern detected — this employee has had {recentCount} similar issues recently.
                    </p>
                  </div>
                )}

                {/* Last 3 resolved */}
                {lastThree.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {lastThree.map(h => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between rounded border border-border bg-card px-3 py-1.5"
                      >
                        <span className="text-[11px] text-muted-foreground">
                          {h.created_at ? (() => { const _d = new Date(h.created_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}-${_d.getUTCFullYear()}` })() : '—'}
                        </span>
                        <span className="text-[11px] font-medium text-foreground capitalize">
                          {h.resolution_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No prior resolved issues found.</p>
                )}
              </div>

              {/* ── 4. Resolution Path ───────────────────────────────── */}
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                  Resolution Path
                </p>
                <ol className="flex flex-col gap-2">
                  {resolutionSteps.map((step, idx) => (
                    <li key={idx} className="flex gap-2.5 text-xs text-foreground leading-relaxed">
                      <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-semibold mt-0.5">
                        {idx + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

            </div>
          )}
        </SheetBody>

        <SheetFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {item && onOpenEmployee && (
            <Button size="sm" onClick={() => onOpenEmployee(item.employee_id)}>
              Open Employee Profile
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Sub-component ──────────────────────────────────────────────────────────

function ExplainRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-xs">
      <span className="text-muted-foreground font-medium">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}
