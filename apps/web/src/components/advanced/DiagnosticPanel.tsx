/**
 * DiagnosticPanel — inline expandable "Why was this flagged?" section.
 * Rendered inline within a queue item card (NOT a Sheet).
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OperationalQueueItem, QueueType } from '@/lib/queue/types'

// ── Props ──────────────────────────────────────────────────────────────────

export interface DiagnosticPanelProps {
  item:             OperationalQueueItem
  defaultOpen?:     boolean
  onExplainClick?:  () => void
}

// ── Diagnose meta ──────────────────────────────────────────────────────────

const DIAGNOSE_META: Record<QueueType, {
  confidence_pct: number
  how_detected:   string
  typical_cause:  string
}> = {
  missing_punch: {
    confidence_pct: 95,
    how_detected:   'Daily attendance sweep',
    typical_cause:  'Forgot to punch out or biometric failure',
  },
  ot_verification: {
    confidence_pct: 90,
    how_detected:   'Post-shift hours calculation',
    typical_cause:  'Genuine OT or missed punch',
  },
  shift_conflict: {
    confidence_pct: 98,
    how_detected:   'Roster overlap detection',
    typical_cause:  'Manual roster edit error',
  },
  leave_conflict: {
    confidence_pct: 92,
    how_detected:   'Leave vs attendance cross-check',
    typical_cause:  'Leave approved after shift assigned',
  },
  payroll_blocker: {
    confidence_pct: 99,
    how_detected:   'Pre-run readiness check',
    typical_cause:  'Unresolved anomaly or pending revision',
  },
  compliance_risk: {
    confidence_pct: 75,
    how_detected:   'Policy engine nightly scan',
    typical_cause:  'Hours limit or mandatory rest violation',
  },
  attendance_anomaly: {
    confidence_pct: 70,
    how_detected:   'Statistical deviation analysis',
    typical_cause:  'Equipment malfunction or genuine anomaly',
  },
  correction_pending: {
    confidence_pct: 100,
    how_detected:   'Manual submission',
    typical_cause:  'Punch error or payroll adjustment',
  },
  regularisation_pending: {
    confidence_pct: 100,
    how_detected:   'ESS manual submission',
    typical_cause:  'WFH, client visit, or field work',
  },
  roster_gap: {
    confidence_pct: 97,
    how_detected:   'Roster coverage check',
    typical_cause:  'Employee absence or scheduling gap',
  },
  biometric_failure: {
    confidence_pct: 88,
    how_detected:   'Device health + record gap analysis',
    typical_cause:  'Device offline or fingerprint not enrolled',
  },
  duplicate_entry: {
    confidence_pct: 90,
    how_detected:   'Duplicate detection on id+type+timestamp',
    typical_cause:  'Double biometric tap or sync replay',
  },
}

// ── Main component ─────────────────────────────────────────────────────────

export function DiagnosticPanel({
  item,
  defaultOpen = false,
  onExplainClick,
}: DiagnosticPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const meta = DIAGNOSE_META[item.queue_type]

  return (
    <div className="border-t border-border/60 mt-2">
      {/* Toggle row */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center gap-1 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-medium">🔍 Diagnose</span>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="flex flex-col gap-2 pb-2 pt-0.5" style={{ minHeight: 120 }}>

          {/* Confidence bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-16 shrink-0">Confidence</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary transition-all"
                style={{ width: `${meta.confidence_pct}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
              {meta.confidence_pct}%
            </span>
          </div>

          {/* Detected via */}
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">Detected via:</span>{' '}
            {meta.how_detected}
          </p>

          {/* Typical cause */}
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">Typical cause:</span>{' '}
            {meta.typical_cause}
          </p>

          {/* Related entities badge */}
          {item.related_entities.length > 0 && (
            <span className={cn(
              'w-fit inline-flex items-center rounded-full px-2 py-0.5',
              'bg-secondary text-secondary-foreground border border-border',
              'text-[10px] font-medium',
            )}>
              Related: {item.related_entities.length} {item.related_entities.length === 1 ? 'entity' : 'entities'}
            </span>
          )}

          {/* Explain in detail link */}
          {onExplainClick && (
            <button
              type="button"
              onClick={onExplainClick}
              className="w-fit text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
            >
              Explain in detail →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
