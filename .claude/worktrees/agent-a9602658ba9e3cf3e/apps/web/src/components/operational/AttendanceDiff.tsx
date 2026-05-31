/**
 * AttendanceDiff — before/after attendance state visualizer.
 *
 * Shows a human-readable diff of what changed between two attendance states,
 * with payroll impact indicators and severity highlighting.
 *
 * Usage:
 *   <AttendanceDiff
 *     before={{ status: 'absent', work_hours: 0, late_minutes: 0, is_payable: false }}
 *     after={{ status: 'present', work_hours: 8.5, late_minutes: 0, is_payable: true }}
 *   />
 */
import { TrendingUp, TrendingDown, Minus, AlertTriangle, DollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn }    from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttendanceSnapshot {
  status?:          string | null
  work_hours?:      number | null
  late_minutes?:    number | null
  overtime_minutes?: number | null
  is_payable?:      boolean | null
  day_fraction?:    number | null
  shift_name?:      string | null
  leave_type?:      string | null
}

interface FieldDiff {
  field:       string
  label:       string
  before:      string | number | boolean | null
  after:       string | number | boolean | null
  direction:   'improved' | 'degraded' | 'neutral' | 'changed'
  payrollImpact?: boolean
}

// ── Badge variants ─────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  half_day:   'secondary',
  leave:      'outline',
  holiday:    'outline',
  weekend:    'outline',
  weekly_off: 'outline',
}

// "improved" from HR perspective: absent→anything, late→present, 0 payable→1 payable
const STATUS_RANK: Record<string, number> = {
  present: 5, late: 4, half_day: 3, leave: 3, holiday: 3, weekend: 2, weekly_off: 2, absent: 1,
}

function statusDirection(b: string | null, a: string | null): FieldDiff['direction'] {
  if (b === a) return 'neutral'
  const rb = STATUS_RANK[b ?? ''] ?? 0
  const ra = STATUS_RANK[a ?? ''] ?? 0
  if (ra > rb) return 'improved'
  if (ra < rb) return 'degraded'
  return 'changed'
}

function numericDirection(b: number | null, a: number | null, higherIsBetter = true): FieldDiff['direction'] {
  if (b === a) return 'neutral'
  const bv = b ?? 0, av = a ?? 0
  if (av > bv) return higherIsBetter ? 'improved' : 'degraded'
  return higherIsBetter ? 'degraded' : 'improved'
}

function boolDirection(b: boolean | null, a: boolean | null, trueIsBetter = true): FieldDiff['direction'] {
  if (b === a) return 'neutral'
  if (a === true) return trueIsBetter ? 'improved' : 'degraded'
  return trueIsBetter ? 'degraded' : 'improved'
}

// ── Diff calculation ──────────────────────────────────────────────────────────

function buildDiffs(before: AttendanceSnapshot, after: AttendanceSnapshot): FieldDiff[] {
  const diffs: FieldDiff[] = []

  // Status
  const bStatus = before.status ?? null
  const aStatus = after.status ?? null
  if (bStatus !== aStatus) {
    diffs.push({
      field: 'status', label: 'Status',
      before: bStatus, after: aStatus,
      direction: statusDirection(bStatus, aStatus),
      payrollImpact: true,
    })
  }

  // Work hours
  const bh = before.work_hours ?? 0, ah = after.work_hours ?? 0
  if (Math.abs(bh - ah) > 0.01) {
    diffs.push({
      field: 'work_hours', label: 'Work Hours',
      before: `${bh}h`, after: `${ah}h`,
      direction: numericDirection(bh, ah),
    })
  }

  // Late minutes
  const bl = before.late_minutes ?? 0, al = after.late_minutes ?? 0
  if (Math.abs(bl - al) > 0) {
    diffs.push({
      field: 'late_minutes', label: 'Late Minutes',
      before: `${bl}m`, after: `${al}m`,
      direction: numericDirection(bl, al, false), // lower is better
    })
  }

  // Overtime
  const bo = before.overtime_minutes ?? 0, ao = after.overtime_minutes ?? 0
  if (Math.abs(bo - ao) > 0) {
    diffs.push({
      field: 'overtime_minutes', label: 'Overtime',
      before: `${bo}m`, after: `${ao}m`,
      direction: numericDirection(bo, ao),
      payrollImpact: true,
    })
  }

  // Payable
  if (before.is_payable !== after.is_payable) {
    diffs.push({
      field: 'is_payable', label: 'Payable Day',
      before: before.is_payable ?? false, after: after.is_payable ?? false,
      direction: boolDirection(before.is_payable ?? false, after.is_payable ?? false),
      payrollImpact: true,
    })
  }

  // Day fraction
  const bf = before.day_fraction ?? 0, af = after.day_fraction ?? 0
  if (Math.abs(bf - af) > 0.01) {
    diffs.push({
      field: 'day_fraction', label: 'Day Fraction',
      before: bf, after: af,
      direction: numericDirection(bf, af),
      payrollImpact: true,
    })
  }

  // Shift
  if (before.shift_name !== after.shift_name && (before.shift_name || after.shift_name)) {
    diffs.push({
      field: 'shift_name', label: 'Shift',
      before: before.shift_name ?? '—', after: after.shift_name ?? '—',
      direction: 'changed',
    })
  }

  // Leave type
  if (before.leave_type !== after.leave_type && (before.leave_type || after.leave_type)) {
    diffs.push({
      field: 'leave_type', label: 'Leave Type',
      before: before.leave_type ?? '—', after: after.leave_type ?? '—',
      direction: 'changed',
    })
  }

  return diffs
}

// ── Direction indicator ───────────────────────────────────────────────────────

function DirectionIcon({ direction }: { direction: FieldDiff['direction'] }) {
  if (direction === 'improved') return <TrendingUp  className="h-3 w-3 text-success flex-shrink-0" />
  if (direction === 'degraded') return <TrendingDown className="h-3 w-3 text-destructive flex-shrink-0" />
  if (direction === 'changed')  return <Minus        className="h-3 w-3 text-info flex-shrink-0" />
  return null
}

function valueBadge(val: string | number | boolean | null, field: string): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-muted-foreground/60 italic">—</span>
  if (field === 'status') {
    const v = String(val)
    const variant = STATUS_VARIANT[v] ?? 'secondary'
    return <Badge variant={variant} className="rounded-full text-[10px] capitalize">{v.replace('_', ' ')}</Badge>
  }
  if (typeof val === 'boolean') {
    return (
      <Badge variant={val ? 'success' : 'secondary'} className="rounded-full text-[10px]">
        {val ? 'Yes' : 'No'}
      </Badge>
    )
  }
  return <span className="font-mono text-xs text-foreground">{String(val)}</span>
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function PayrollImpactSummary({ diffs }: { diffs: FieldDiff[] }) {
  const payrollDiffs = diffs.filter(d => d.payrollImpact && d.direction !== 'neutral')
  if (payrollDiffs.length === 0) return null

  const hasImproved = payrollDiffs.some(d => d.direction === 'improved')
  const hasDegraded = payrollDiffs.some(d => d.direction === 'degraded')

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-md text-xs border',
      hasImproved && !hasDegraded ? 'bg-success/10 border-success/30 text-success' :
      hasDegraded && !hasImproved ? 'bg-destructive/10 border-destructive/30 text-destructive' :
      'bg-warning/10 border-warning/30 text-warning'
    )}>
      <DollarSign className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        Payroll impact:&nbsp;
        <strong>{payrollDiffs.map(d => d.label).join(', ')}</strong>&nbsp;changed
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AttendanceDiffProps {
  before:            AttendanceSnapshot | null
  after:             AttendanceSnapshot | null
  /** Label shown above the left column */
  beforeLabel?:      string
  /** Label shown above the right column */
  afterLabel?:       string
  /** Show payroll impact summary banner */
  showPayrollImpact?: boolean
  /** Show a "no changes" state if there are no diffs */
  showNoChanges?:    boolean
  className?:        string
}

export function AttendanceDiff({
  before,
  after,
  beforeLabel   = 'Before',
  afterLabel    = 'After',
  showPayrollImpact = true,
  showNoChanges = false,
  className,
}: AttendanceDiffProps) {
  if (!before && !after) return null

  const safeBefore: AttendanceSnapshot = before ?? {}
  const safeAfter:  AttendanceSnapshot = after  ?? {}

  const diffs = buildDiffs(safeBefore, safeAfter)

  if (diffs.length === 0) {
    if (!showNoChanges) return null
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Minus className="h-3.5 w-3.5" />
        No attendance values changed.
      </div>
    )
  }

  const improvedCount = diffs.filter(d => d.direction === 'improved').length
  const degradedCount = diffs.filter(d => d.direction === 'degraded').length

  return (
    <div className={cn('space-y-3', className)}>
      {/* Summary badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">{diffs.length} change{diffs.length > 1 ? 's' : ''}</span>
        {improvedCount > 0 && (
          <Badge variant="success" className="rounded-full text-[10px] gap-1">
            <TrendingUp className="h-2.5 w-2.5" />
            {improvedCount} improved
          </Badge>
        )}
        {degradedCount > 0 && (
          <Badge variant="destructive" className="rounded-full text-[10px] gap-1">
            <TrendingDown className="h-2.5 w-2.5" />
            {degradedCount} degraded
          </Badge>
        )}
      </div>

      {/* Payroll impact */}
      {showPayrollImpact && <PayrollImpactSummary diffs={diffs} />}

      {/* Side-by-side diff table */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_20px_1fr] bg-muted/40 px-3 py-1.5 border-b border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{beforeLabel}</span>
          <span />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{afterLabel}</span>
        </div>

        {diffs.map(d => (
          <div
            key={d.field}
            className={cn(
              'grid grid-cols-[1fr_20px_1fr] px-3 py-2.5 border-b border-border/40 last:border-0 items-center gap-1',
              d.direction === 'improved' ? 'bg-success/5' :
              d.direction === 'degraded' ? 'bg-destructive/5' :
              d.direction === 'changed'  ? 'bg-info/5' : '',
            )}
          >
            {/* Before */}
            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{d.label}</p>
              {valueBadge(d.before, d.field)}
            </div>

            {/* Arrow + icon */}
            <div className="flex flex-col items-center justify-center gap-0.5">
              <DirectionIcon direction={d.direction} />
              {d.payrollImpact && d.direction !== 'neutral' && (
                <DollarSign className="h-2 w-2 text-muted-foreground/50" />
              )}
            </div>

            {/* After */}
            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{d.label}</p>
              {valueBadge(d.after, d.field)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Compact inline variant ────────────────────────────────────────────────────

/**
 * Compact inline display — just shows status change as "Absent → Present"
 * with a colored pill. Used in audit log rows etc.
 */
export function StatusChangePill({
  before,
  after,
  className,
}: {
  before: string | null
  after:  string | null
  className?: string
}) {
  const bv = before ? (STATUS_VARIANT[before] ?? 'secondary') : null
  const av = after  ? (STATUS_VARIANT[after]  ?? 'secondary') : null

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      {before && bv ? (
        <Badge variant={bv} className="rounded-full text-[10px] capitalize">{before.replace('_', ' ')}</Badge>
      ) : (
        <span className="text-muted-foreground/50 text-[10px]">—</span>
      )}
      <span className="text-muted-foreground">→</span>
      {after && av ? (
        <Badge variant={av} className="rounded-full text-[10px] capitalize">{after.replace('_', ' ')}</Badge>
      ) : (
        <span className="text-muted-foreground/50 text-[10px]">—</span>
      )}
    </div>
  )
}

/**
 * Inline anomaly warning banner — used in correction rows to show what
 * changed and whether it affects payroll.
 */
export function DiffWarningBanner({
  before, after, context,
}: {
  before: AttendanceSnapshot
  after:  AttendanceSnapshot
  context: string
}) {
  const diffs  = buildDiffs(before, after)
  const hasPayroll = diffs.some(d => d.payrollImpact && d.direction !== 'neutral')

  if (diffs.length === 0) return null

  return (
    <div className={cn(
      'flex items-start gap-2 rounded-md px-3 py-2 text-xs border',
      hasPayroll ? 'bg-warning/10 border-warning/30 text-warning' : 'bg-info/10 border-info/30 text-info'
    )}>
      {hasPayroll ? <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /> : <Minus className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />}
      <div>
        <span className="font-medium">{context}: </span>
        {diffs.map(d => `${d.label}: ${d.before ?? '—'} → ${d.after ?? '—'}`).join(' · ')}
        {hasPayroll && <span className="ml-1 font-medium">(payroll impact)</span>}
      </div>
    </div>
  )
}
