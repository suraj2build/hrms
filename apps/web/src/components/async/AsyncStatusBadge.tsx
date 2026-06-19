/* eslint-disable react-refresh/only-export-components -- co-locates isTerminalStatus/isFailureStatus helpers with the badge that shares their status enum */
/**
 * AsyncStatusBadge — unified status badge for all async workflow states.
 *
 * Maps every backend and frontend status enum to a consistent visual token:
 *
 *  Upload lifecycle:   pending | uploading | uploaded | processing | completed | failed | expired | orphaned
 *  Job queue:          queued  | running   | retrying | completed  | failed    | cancelled
 *  Payroll / import:   pending | processing | completed | failed
 *  Attendance recompute: queued | running | completed | failed
 *
 * All statuses map to exactly one of: success / warning / destructive / secondary / outline
 * Animates the spinner icon for in-progress states.
 */

import { Loader2, CheckCircle2, XCircle, Clock, Ban, RotateCcw } from 'lucide-react'
import { cn }    from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Union of all recognised async status values across backend enums. */
export type AsyncWorkflowStatus =
  // Upload session states
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'orphaned'
  // Job queue / durable queue
  | 'queued'
  | 'running'
  | 'retrying'
  | 'cancelled'
  // Payroll
  | 'draft'
  | 'approved'
  | 'finalized'
  | 'locked'
  // Reconciliation
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'escalated'

export interface AsyncStatusBadgeProps {
  status:    AsyncWorkflowStatus | string
  className?: string
  /** Show animated spinner for in-progress states. Default true. */
  animate?:  boolean
  /** Show an icon alongside the label. Default true. */
  showIcon?: boolean
}

// ── Config ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'

interface StatusConfig {
  label:     string
  variant:   BadgeVariant
  icon?:     React.ElementType
  spinning?: boolean
}

const STATUS_MAP: Record<string, StatusConfig> = {
  // ── In-progress states ──────────────────────────────────────────────
  pending: {
    label:   'Pending',
    variant: 'warning',
    icon:    Clock,
  },
  uploading: {
    label:   'Uploading',
    variant: 'warning',
    icon:    Loader2,
    spinning: true,
  },
  uploaded: {
    label:   'Uploaded',
    variant: 'secondary',
    icon:    CheckCircle2,
  },
  processing: {
    label:   'Processing',
    variant: 'warning',
    icon:    Loader2,
    spinning: true,
  },
  queued: {
    label:   'Queued',
    variant: 'secondary',
    icon:    Clock,
  },
  running: {
    label:   'Running',
    variant: 'warning',
    icon:    Loader2,
    spinning: true,
  },
  retrying: {
    label:   'Retrying',
    variant: 'warning',
    icon:    RotateCcw,
    spinning: true,
  },

  // ── Terminal success ────────────────────────────────────────────────
  completed: {
    label:   'Completed',
    variant: 'success',
    icon:    CheckCircle2,
  },
  resolved: {
    label:   'Resolved',
    variant: 'success',
    icon:    CheckCircle2,
  },
  approved: {
    label:   'Approved',
    variant: 'success',
    icon:    CheckCircle2,
  },
  finalized: {
    label:   'Finalized',
    variant: 'success',
    icon:    CheckCircle2,
  },
  locked: {
    label:   'Locked',
    variant: 'success',
    icon:    CheckCircle2,
  },

  // ── Intermediate acknowledged states ────────────────────────────────
  acknowledged: {
    label:   'Acknowledged',
    variant: 'secondary',
  },
  draft: {
    label:   'Draft',
    variant: 'secondary',
  },
  open: {
    label:   'Open',
    variant: 'outline',
  },
  cancelled: {
    label:   'Cancelled',
    variant: 'secondary',
    icon:    Ban,
  },

  // ── Terminal failure ────────────────────────────────────────────────
  failed: {
    label:   'Failed',
    variant: 'destructive',
    icon:    XCircle,
  },
  expired: {
    label:   'Expired',
    variant: 'destructive',
    icon:    XCircle,
  },
  orphaned: {
    label:   'Orphaned',
    variant: 'destructive',
    icon:    XCircle,
  },
  escalated: {
    label:   'Escalated',
    variant: 'destructive',
    icon:    XCircle,
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AsyncStatusBadge({
  status,
  className,
  animate   = true,
  showIcon  = true,
}: AsyncStatusBadgeProps) {
  const cfg = STATUS_MAP[status] ?? {
    label:   status,
    variant: 'secondary' as BadgeVariant,
  }

  const Icon     = showIcon ? cfg.icon : undefined
  const spinning = animate && cfg.spinning

  return (
    <Badge
      variant={cfg.variant}
      className={cn('rounded-full text-[10px] gap-1 capitalize', className)}
    >
      {Icon && (
        <Icon className={cn('h-2.5 w-2.5', spinning && 'animate-spin')} />
      )}
      {cfg.label}
    </Badge>
  )
}

/**
 * Returns true for statuses that indicate the operation is still in progress
 * and should be polled for updates.
 */
export function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'expired', 'orphaned', 'cancelled', 'resolved', 'finalized', 'locked'].includes(status)
}

/**
 * Returns true for statuses that represent a failure requiring operator attention.
 */
export function isFailureStatus(status: string): boolean {
  return ['failed', 'expired', 'orphaned', 'escalated'].includes(status)
}
