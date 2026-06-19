/* eslint-disable react-refresh/only-export-components -- shared badge module that intentionally co-exports its explainer constants and types */
/**
 * StatutoryBadges — EPF & ESI status chips, explainers, tooltips, validation strip
 *
 * Shared across payroll preview, finalization center, and employee profile.
 *
 * Design contract:
 *   - Exceptions (override / continuation / threshold) → visually prominent
 *   - Standard eligible state → calm, neutral
 *   - Soft palette: blue-slate (info), emerald (compliance), amber (exception), slate (neutral)
 *   - Never add new pages, panels, or modals from here
 */

import * as RadixTooltip from '@radix-ui/react-tooltip'
import { Info, CheckCircle2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip primitives
// ─────────────────────────────────────────────────────────────────────────────

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <RadixTooltip.Provider delayDuration={200}>{children}</RadixTooltip.Provider>
}

/** Small info-icon that reveals a one-liner tooltip on hover. */
export function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>
        <span
          className={cn('inline-flex cursor-default', className)}
          aria-label={text}
        >
          <Info className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
        </span>
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="top"
          align="start"
          sideOffset={4}
          className={cn(
            'z-50 rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md',
            'text-[11px] text-popover-foreground leading-snug max-w-[220px]',
            'animate-in fade-in-0 zoom-in-95',
          )}
        >
          {text}
          <RadixTooltip.Arrow className="fill-border" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PF Mode chip
// ─────────────────────────────────────────────────────────────────────────────

export type PFMode = 'actual' | 'capped' | 'override'

const PF_MODE_STYLES: Record<PFMode, { label: string; cls: string }> = {
  actual:   { label: 'Actual PF',  cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' },
  capped:   { label: 'Capped PF',  cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  override: { label: 'Override',   cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
}

/** One-liner "why" text shown beneath the badge as muted helper copy. */
export const PF_MODE_EXPLAIN: Record<PFMode, string> = {
  actual:   'PF calculated on full eligible wages.',
  capped:   'PF restricted to statutory wage ceiling.',
  override: 'Employee-level PF override differs from organisation policy.',
}

/** Tooltip copy used on info icons next to EPF headers. */
export const PF_MODE_TOOLTIP: Record<PFMode, string> = {
  actual:   'PF deducted on actual PF-eligible wages (Basic + DA). No ceiling applied.',
  capped:   'PF deducted on wages capped at the statutory ceiling (default ₹15,000). Employer EPS is always ceiling-capped.',
  override: 'An employee-level override is active — this employee\'s PF ceiling behaviour differs from the organisation default.',
}

export function PFModeBadge({ mode, className }: { mode: PFMode; className?: string }) {
  const { label, cls } = PF_MODE_STYLES[mode]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5',
        'text-[10px] font-semibold leading-none whitespace-nowrap',
        cls,
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Badge + one-liner muted explanation beneath it. */
export function PFModeWithExplain({ mode, className }: { mode: PFMode; className?: string }) {
  const isException = mode === 'override'
  return (
    <div className={cn('space-y-0.5', className)}>
      <PFModeBadge mode={mode} />
      <p className={cn(
        'text-[10px] leading-snug',
        isException ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-muted-foreground',
      )}>
        {PF_MODE_EXPLAIN[mode]}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ESI Status chip
// ─────────────────────────────────────────────────────────────────────────────

export type ESIStatusType = 'eligible' | 'not_applicable' | 'continuation' | 'exempt'

const ESI_STATUS_STYLES: Record<ESIStatusType, { label: string; cls: string }> = {
  eligible:       { label: 'ESI Eligible',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  not_applicable: { label: 'Not Applicable', cls: 'bg-muted text-muted-foreground border-border' },
  continuation:   { label: 'Continuation',   cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  exempt:         { label: 'Exempt',         cls: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' },
}

export const ESI_STATUS_EXPLAIN: Record<ESIStatusType, string> = {
  eligible:       'Gross wages within ₹21,000 threshold — normal ESI deduction applies.',
  not_applicable: 'Gross wages exceed ₹21,000 statutory threshold — no ESI this period.',
  continuation:   'Contribution continues until the current contribution period ends.',
  exempt:         'Employee is administratively exempt from ESI.',
}

export const ESI_STATUS_TOOLTIP: Record<ESIStatusType, string> = {
  eligible:       'ESI applies when gross wages are ≤ ₹21,000/month. Employee: 0.75%, Employer: 3.25%.',
  not_applicable: 'Wages crossed the ₹21,000 ceiling — ESI contributions stop from next contribution period.',
  continuation:   'ESIC contribution period rule: once enrolled in Apr–Sep or Oct–Mar, contributions continue through period end even if wages exceed the ceiling mid-period.',
  exempt:         'A statutory override marks this employee as ESI-exempt. No contribution is deducted.',
}

export function ESIStatusBadge({ status, className }: { status: ESIStatusType; className?: string }) {
  const { label, cls } = ESI_STATUS_STYLES[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5',
        'text-[10px] font-semibold leading-none whitespace-nowrap',
        cls,
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Badge + one-liner muted explanation beneath it. */
export function ESIStatusWithExplain({ status, className }: { status: ESIStatusType; className?: string }) {
  const isException = status === 'continuation' || status === 'not_applicable'
  return (
    <div className={cn('space-y-0.5', className)}>
      <ESIStatusBadge status={status} />
      <p className={cn(
        'text-[10px] leading-snug',
        isException ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-muted-foreground',
      )}>
        {ESI_STATUS_EXPLAIN[status]}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline explainer row
// ─────────────────────────────────────────────────────────────────────────────

export function StatutoryExplainer({
  label,
  value,
  muted,
  tooltip,
  className,
}: {
  label:    string
  value:    string
  muted?:   boolean
  tooltip?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between text-xs', className)}>
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <span className={cn('font-medium tabular-nums', muted && 'text-muted-foreground')}>{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact statutory summary strip (payroll preview top-of-section)
// ─────────────────────────────────────────────────────────────────────────────

/** Single-row compact summary: PF: Capped | ESI: Active | etc. */
export function StatutorySummaryStrip({
  items,
  className,
}: {
  items: Array<{ label: string; value: string; accent?: boolean }>
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3 flex-wrap', className)}>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1 text-[10px]">
          <span className="text-muted-foreground">{item.label}:</span>
          <span className={cn(
            'font-semibold',
            item.accent ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
          )}>
            {item.value}
          </span>
          {i < items.length - 1 && (
            <span className="text-border ml-1.5">·</span>
          )}
        </span>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational counter chip
// ─────────────────────────────────────────────────────────────────────────────

export function StatCountChip({
  label,
  count,
  variant  = 'default',
  onClick,
  className,
}: {
  label:    string
  count:    number
  variant?: 'default' | 'amber' | 'blue' | 'muted'
  onClick?: () => void
  className?: string
}) {
  const variantCls: Record<string, string> = {
    default: 'bg-muted/60 text-foreground border-border',
    amber:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    blue:    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    muted:   'bg-muted text-muted-foreground border-border',
  }
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5',
        variantCls[variant],
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity text-left',
        className,
      )}
    >
      <span className="text-base font-bold tabular-nums leading-none">{count}</span>
      <span className="text-[10px] font-medium leading-tight max-w-[80px]">{label}</span>
    </Tag>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Statutory validation strip (confidence indicator before finalize)
// ─────────────────────────────────────────────────────────────────────────────

export interface StatutoryValidationItem {
  key:     string
  pass:    boolean
  message: string        // e.g. "All statutory deductions validated"
}

/**
 * Compact strip shown before payroll finalization.
 * All-pass → single green "All statutory calculations validated" line.
 * Any-fail → amber warning lines for each exception.
 */
export function StatutoryValidationStrip({
  items,
  className,
}: {
  items:     StatutoryValidationItem[]
  className?: string
}) {
  if (items.length === 0) return null

  const allPass    = items.every(i => i.pass)
  const exceptions = items.filter(i => !i.pass)

  if (allPass) {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border border-success/20 bg-success/5',
        className,
      )}>
        <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
        <span className="text-xs text-success font-medium">All statutory calculations validated successfully.</span>
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 space-y-1', className)}>
      {exceptions.map(item => (
        <div key={item.key} className="flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
          <span className="text-xs text-warning">{item.message}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable empty state for statutory sections
// ─────────────────────────────────────────────────────────────────────────────

export function StatutoryEmptyNote({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('text-[11px] text-muted-foreground italic', className)}>{text}</p>
  )
}
