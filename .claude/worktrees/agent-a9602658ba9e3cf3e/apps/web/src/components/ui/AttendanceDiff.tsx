/**
 * AttendanceDiff — reusable explainability diff component.
 *
 * Shows human-readable before → after for any attendance field change.
 * Used in: Corrections, Leave recalculations, Retroactive recomputes,
 *          Policy simulations, Payroll readiness changes, Audit log.
 *
 * Design rules: design-system tokens only — no raw hex / bg-gray-*.
 */
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export type DiffField =
  | 'status'
  | 'work_hours'
  | 'late_minutes'
  | 'overtime_minutes'
  | 'payable_days'
  | 'day_fraction'
  | 'shift'
  | 'is_payable'
  | 'check_in'
  | 'check_out'
  | 'lop_days'
  | 'custom'

export interface DiffEntry {
  field:      DiffField
  /** Human-readable label (overrides auto-label from field name) */
  label?:     string
  before:     string | number | boolean | null
  after:      string | number | boolean | null
  /** If provided, shows a payroll impact note alongside this diff */
  payrollImpact?: string
}

export interface AttendanceDiffProps {
  /** List of field changes to display */
  entries:    DiffEntry[]
  /** Show side-by-side layout (default: vertical stacked list) */
  layout?:    'stacked' | 'grid'
  /** Compact single-line variant for dense tables */
  compact?:   boolean
  className?: string
}

// ── Status display config ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'; label: string }> = {
  present:    { variant: 'success',     label: 'Present' },
  late:       { variant: 'warning',     label: 'Late' },
  absent:     { variant: 'destructive', label: 'Absent' },
  half_day:   { variant: 'secondary',   label: 'Half Day' },
  leave:      { variant: 'outline',     label: 'Leave' },
  holiday:    { variant: 'outline',     label: 'Holiday' },
  weekend:    { variant: 'outline',     label: 'Weekend' },
  weekly_off: { variant: 'outline',     label: 'Weekly Off' },
}

function StatusChip({ value }: { value: string | number | boolean | null }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-muted-foreground/50 italic">—</span>
  }
  const str    = String(value)
  const config = STATUS_CONFIG[str.toLowerCase()]
  if (config) {
    return (
      <Badge variant={config.variant} className="rounded-full text-[10px] px-2 py-0 h-5">
        {config.label}
      </Badge>
    )
  }
  return <span className="text-xs font-medium text-foreground">{str}</span>
}

// ── Auto field labels ──────────────────────────────────────────────────────────

const FIELD_LABELS: Record<DiffField, string> = {
  status:             'Attendance Status',
  work_hours:         'Work Hours',
  late_minutes:       'Late (min)',
  overtime_minutes:   'OT (min)',
  payable_days:       'Payable Days',
  day_fraction:       'Day Fraction',
  shift:              'Shift',
  is_payable:         'Payable',
  check_in:           'Check-in',
  check_out:          'Check-out',
  lop_days:           'LOP Days',
  custom:             'Change',
}

// ── Trend indicator ────────────────────────────────────────────────────────────

function TrendIcon({ field, before, after }: Pick<DiffEntry, 'field' | 'before' | 'after'>) {
  const numericFields: DiffField[] = ['work_hours', 'overtime_minutes', 'payable_days', 'day_fraction']
  const decreaseFields: DiffField[] = ['late_minutes', 'lop_days']

  if (before === after || before === null || after === null) return null

  const num = numericFields.includes(field)
  const dec = decreaseFields.includes(field)

  if (num || dec) {
    const bNum = Number(before)
    const aNum = Number(after)
    if (isNaN(bNum) || isNaN(aNum)) return null
    const improved = num ? aNum > bNum : aNum < bNum
    return improved
      ? <TrendingUp  className="h-3 w-3 text-success flex-shrink-0" />
      : <TrendingDown className="h-3 w-3 text-destructive flex-shrink-0" />
  }
  return null
}

// ── Value renderer ─────────────────────────────────────────────────────────────

function DiffValue({ field, value }: { field: DiffField; value: string | number | boolean | null }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-muted-foreground/40 italic">none</span>
  }

  if (field === 'status') return <StatusChip value={value} />

  if (field === 'is_payable') {
    return (
      <Badge
        variant={value ? 'success' : 'secondary'}
        className="rounded-full text-[10px] px-2 py-0 h-5"
      >
        {value ? 'Payable' : 'Non-payable'}
      </Badge>
    )
  }

  if (field === 'work_hours') {
    return <span className="text-xs font-semibold tabular-nums text-foreground">{Number(value).toFixed(1)}h</span>
  }

  if (field === 'day_fraction') {
    return <span className="text-xs font-semibold tabular-nums text-foreground">{Number(value).toFixed(1)}</span>
  }

  if (field === 'late_minutes' || field === 'overtime_minutes') {
    const n = Number(value)
    return <span className={cn('text-xs font-semibold tabular-nums', n > 0 && field === 'late_minutes' ? 'text-warning' : 'text-foreground')}>{n} min</span>
  }

  return <span className="text-xs font-medium text-foreground">{String(value)}</span>
}

// ── Single diff row ────────────────────────────────────────────────────────────

function DiffRow({ entry, compact }: { entry: DiffEntry; compact?: boolean }) {
  const label  = entry.label ?? FIELD_LABELS[entry.field]
  const noChange = entry.before === entry.after

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground/60 flex-shrink-0">{label}:</span>
        <DiffValue field={entry.field} value={entry.before} />
        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40 flex-shrink-0" />
        <DiffValue field={entry.field} value={entry.after} />
        {!noChange && <TrendIcon {...entry} />}
      </div>
    )
  }

  return (
    <div className={cn(
      'flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0',
      noChange && 'opacity-50',
    )}>
      {/* Field label */}
      <div className="w-32 flex-shrink-0 pt-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      </div>

      {/* Before */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-muted-foreground/50 mb-0.5">Before</div>
        <DiffValue field={entry.field} value={entry.before} />
      </div>

      {/* Arrow */}
      <div className="flex items-center pt-4">
        {noChange
          ? <Minus className="h-3 w-3 text-muted-foreground/30" />
          : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        }
      </div>

      {/* After */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-muted-foreground/50 mb-0.5">After</div>
        <div className="flex items-center gap-1.5">
          <DiffValue field={entry.field} value={entry.after} />
          {!noChange && <TrendIcon {...entry} />}
        </div>
      </div>

      {/* Payroll impact note */}
      {entry.payrollImpact && !noChange && (
        <div className="text-[10px] text-warning bg-warning/10 rounded px-1.5 py-0.5 flex-shrink-0 max-w-[120px] text-center leading-tight">
          {entry.payrollImpact}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AttendanceDiff({ entries, layout = 'stacked', compact = false, className }: AttendanceDiffProps) {
  const changed = entries.filter(e => e.before !== e.after)
  const unchanged = entries.filter(e => e.before === e.after)

  if (entries.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground/50 italic py-2', className)}>
        No changes to display.
      </div>
    )
  }

  if (compact) {
    return (
      <div className={cn('flex flex-wrap gap-x-4 gap-y-1', className)}>
        {entries.map((entry, i) => <DiffRow key={i} entry={entry} compact />)}
      </div>
    )
  }

  if (layout === 'grid') {
    return (
      <div className={cn('grid grid-cols-2 gap-3', className)}>
        {entries.map((entry, i) => (
          <div key={i} className={cn(
            'rounded-lg border p-3 space-y-2',
            entry.before !== entry.after ? 'border-primary/20 bg-primary/[0.03]' : 'border-border/40 bg-muted/20',
          )}>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {entry.label ?? FIELD_LABELS[entry.field]}
            </div>
            <div className="flex items-center gap-2">
              <DiffValue field={entry.field} value={entry.before} />
              <ArrowRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
              <DiffValue field={entry.field} value={entry.after} />
              <TrendIcon {...entry} />
            </div>
            {entry.payrollImpact && entry.before !== entry.after && (
              <div className="text-[10px] text-warning">{entry.payrollImpact}</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Default: stacked
  return (
    <div className={cn('space-y-0', className)}>
      {changed.length > 0 && (
        <div>
          {changed.map((entry, i) => <DiffRow key={i} entry={entry} />)}
        </div>
      )}
      {unchanged.length > 0 && changed.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wide mb-2">
            Unchanged ({unchanged.length})
          </p>
          {unchanged.map((entry, i) => <DiffRow key={i} entry={entry} />)}
        </div>
      )}
      {unchanged.length > 0 && changed.length === 0 && (
        <div className="text-xs text-muted-foreground/60 italic py-2">No changes detected.</div>
      )}
    </div>
  )
}

// ── Utility: build diff entries from two attendance objects ────────────────────

export interface AttendanceSnapshot {
  status?:           string | null
  work_hours?:       number | null
  late_minutes?:     number | null
  overtime_minutes?: number | null
  is_payable?:       boolean | null
  day_fraction?:     number | null
  check_in?:         string | null
  check_out?:        string | null
}

/**
 * Build a DiffEntry[] from two attendance snapshots.
 * Only includes fields that differ.
 */
export function buildAttendanceDiff(
  before: AttendanceSnapshot,
  after:  AttendanceSnapshot,
  includeUnchanged = false,
): DiffEntry[] {
  const fields: Array<{ field: DiffField; payrollImpact?: string }> = [
    { field: 'status',           payrollImpact: 'Affects payable day' },
    { field: 'work_hours'                                               },
    { field: 'late_minutes'                                             },
    { field: 'overtime_minutes', payrollImpact: 'OT payout may change' },
    { field: 'is_payable',       payrollImpact: 'Direct LOP impact'    },
    { field: 'day_fraction'                                             },
    { field: 'check_in'                                                 },
    { field: 'check_out'                                                },
  ]

  const entries: DiffEntry[] = []
  for (const { field, payrollImpact } of fields) {
    const bVal = (before as Record<string, unknown>)[field] ?? null
    const aVal = (after  as Record<string, unknown>)[field] ?? null
    if (includeUnchanged || bVal !== aVal) {
      entries.push({
        field,
        before: bVal as DiffEntry['before'],
        after:  aVal as DiffEntry['after'],
        ...(payrollImpact && bVal !== aVal ? { payrollImpact } : {}),
      })
    }
  }
  return entries
}
