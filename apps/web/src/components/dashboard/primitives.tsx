/**
 * Dashboard Primitives — Enterprise visual language v2.
 *
 * Designed to match the reference HRMS UI exactly:
 *   · KPI cards: white + shadow-card, icon chip, large value, ±% trend, sparkline
 *   · Alert rows: colored left border accent
 *   · Operational tables: clean enterprise styling
 *   · Right-rail sections: grouped with uppercase label
 *   · Info banners: left border accent strip
 *
 * Rules:
 *   · Colors via design tokens — no raw hex
 *   · card bg + shadow-card instead of just border
 *   · Radius: rounded-lg (8px)
 */

import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ExternalLink, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'
import {
  LineChart, Line, ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'
import { getChartColor } from '@/components/ui/chart'

// ── Shared types ──────────────────────────────────────────────────────────────

export type OperationalVariant = 'neutral' | 'success' | 'warning' | 'destructive' | 'info'

// ── OperationalKPICard ────────────────────────────────────────────────────────
// Matches reference: white card, icon chip top-right, value, label, ±% trend, sparkline

const KPI_ICON_STYLES: Record<OperationalVariant, { chip: string; icon: string; spark: string }> = {
  neutral:     { chip: 'bg-muted',              icon: 'text-muted-foreground', spark: 'chart1' },
  success:     { chip: 'bg-success/10',         icon: 'text-success',          spark: 'chart2' },
  warning:     { chip: 'bg-warning/10',         icon: 'text-warning',          spark: 'chart3' },
  destructive: { chip: 'bg-destructive/10',     icon: 'text-destructive',      spark: 'chart4' },
  info:        { chip: 'bg-info/10',            icon: 'text-info',             spark: 'chart5' },
}

// Top accent bar color per variant — 3px strip at card top edge
const KPI_ACCENT_BAR: Record<OperationalVariant, string> = {
  neutral:     'bg-muted-foreground/25',
  success:     'bg-success',
  warning:     'bg-warning',
  destructive: 'bg-destructive',
  info:        'bg-info',
}

export interface OperationalKPICardProps {
  label:      string
  value:      number | string
  icon:       React.ComponentType<{ className?: string }>
  variant?:   OperationalVariant
  trend?:     { value: number; label?: string }  // e.g. { value: 8.5, label: 'vs last month' }
  sparkData?: Array<{ v: number }>
  onClick?:   () => void
  className?: string
}

export function OperationalKPICard({
  label, value, icon: Icon, variant = 'neutral',
  trend, sparkData, onClick, className,
}: OperationalKPICardProps) {
  const s = KPI_ICON_STYLES[variant]
  const sparkColor = getChartColor(s.spark)
  const isUp = (trend?.value ?? 0) >= 0

  return (
    <div
      className={cn(
        'relative rounded-lg bg-card shadow-card overflow-hidden',
        onClick && 'cursor-pointer hover:shadow-card-md transition-shadow',
        className,
      )}
      onClick={onClick}
    >
      {/* 3px top accent bar — clipped by overflow-hidden on parent */}
      <div className={cn('absolute top-0 left-0 right-0 h-[3px]', KPI_ACCENT_BAR[variant])} />

      <div className="p-4 pb-3">
        {/* Row: label + icon chip */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-xs font-medium text-muted-foreground leading-tight">{label}</p>
          <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0', s.chip)}>
            <Icon className={cn('h-4 w-4', s.icon)} />
          </div>
        </div>

        {/* Value */}
        <p className="text-[26px] font-bold tabular-nums leading-none text-foreground">
          {value}
        </p>

        {/* Trend indicator */}
        {trend !== undefined && (
          <div className="flex items-center gap-1 mt-2">
            {isUp
              ? <TrendingUp   className="h-3 w-3 text-success flex-shrink-0" />
              : <TrendingDown className="h-3 w-3 text-destructive flex-shrink-0" />
            }
            <span className={cn(
              'text-xs font-semibold tabular-nums',
              isUp ? 'text-success' : 'text-destructive',
            )}>
              {isUp ? '+' : ''}{trend.value}%
            </span>
            {trend.label && (
              <span className="text-[11px] text-muted-foreground">{trend.label}</span>
            )}
          </div>
        )}
      </div>

      {/* Mini sparkline — line chart pinned to bottom */}
      {sparkData && sparkData.length > 2 && (
        <div className="h-[40px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={sparkColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Bottom padding when no sparkline */}
      {(!sparkData || sparkData.length <= 2) && <div className="pb-1" />}
    </div>
  )
}

// ── InfoBanner ────────────────────────────────────────────────────────────────
// Left-accent strip banner (matches reference info/status bar at page top)

const BANNER_BORDER: Record<string, string> = {
  info:        'border-l-info        bg-info/[0.05]        text-foreground',
  warning:     'border-l-warning     bg-warning/[0.06]     text-foreground',
  success:     'border-l-success     bg-success/[0.05]     text-foreground',
  destructive: 'border-l-destructive bg-destructive/[0.05] text-foreground',
}

interface InfoBannerProps {
  message:  string
  detail?:  string
  action?:  { label: string; onClick: () => void }
  onHide?:  () => void
  variant?: 'info' | 'warning' | 'success' | 'destructive'
}

export function InfoBanner({ message, detail, action, onHide, variant = 'info' }: InfoBannerProps) {
  return (
    <div className={cn(
      'flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-lg border-l-4 border border-border text-xs',
      BANNER_BORDER[variant],
    )}>
      <span className="flex-1 min-w-0">
        <span className="font-medium">{message}</span>
        {detail && <span className="text-muted-foreground ml-1.5">{detail}</span>}
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1 text-primary font-semibold hover:underline flex-shrink-0 text-xs"
        >
          {action.label}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
      {onHide && (
        <button
          type="button"
          onClick={onHide}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 text-xs font-medium"
        >
          Hide ×
        </button>
      )}
    </div>
  )
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title:     string
  subtitle?: string
  action?:   React.ReactNode
  className?: string
}

export function SectionHeader({ title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3 mb-3', className)}>
      <div>
        <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ── OperationalSurface ────────────────────────────────────────────────────────
// White card + shadow — the reference card surface

interface OperationalSurfaceProps {
  children:   React.ReactNode
  className?: string
  noPad?:     boolean
}

export function OperationalSurface({ children, className, noPad }: OperationalSurfaceProps) {
  return (
    <div className={cn(
      'rounded-lg bg-card shadow-card',
      !noPad && 'p-4',
      className,
    )}>
      {children}
    </div>
  )
}

// ── AlertRow ──────────────────────────────────────────────────────────────────
// Matches reference "Alerts & Attention" rows — severity dot + label + count chip

const ALERT_CHIP: Record<OperationalVariant, { dot: string; countBg: string; countText: string; hover: string }> = {
  neutral:     { dot: 'bg-muted-foreground', countBg: 'bg-muted',          countText: 'text-foreground',   hover: 'hover:bg-muted/50' },
  success:     { dot: 'bg-success',          countBg: 'bg-success/12',     countText: 'text-success',      hover: 'hover:bg-success/5' },
  warning:     { dot: 'bg-warning',          countBg: 'bg-warning/12',     countText: 'text-warning',      hover: 'hover:bg-warning/5' },
  destructive: { dot: 'bg-destructive',      countBg: 'bg-destructive/12', countText: 'text-destructive',  hover: 'hover:bg-destructive/5' },
  info:        { dot: 'bg-info',             countBg: 'bg-info/12',        countText: 'text-info',         hover: 'hover:bg-info/5' },
}

export interface AlertRowProps {
  icon:    React.ComponentType<{ className?: string }>
  label:   string
  count:   number
  variant: OperationalVariant
  href?:   string
}

export function AlertRow({ icon: Icon, label, count, variant, href }: AlertRowProps) {
  const s = ALERT_CHIP[variant]
  const inner = (
    <div className={cn(
      'flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors',
      href && cn(s.hover, 'cursor-pointer'),
    )}>
      <div className={cn('h-2 w-2 rounded-full flex-shrink-0', s.dot)} />
      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <span className="text-[13px] text-foreground/80 flex-1 truncate leading-none">{label}</span>
      <span className={cn(
        'text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md flex-shrink-0 min-w-[24px] text-center',
        s.countBg, s.countText,
      )}>
        {count}
      </span>
      {href && <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />}
    </div>
  )
  if (href) return <Link to={href}>{inner}</Link>
  return inner
}

// ── ActivityRow ───────────────────────────────────────────────────────────────

export interface ActivityRowProps {
  icon:     React.ComponentType<{ className?: string }>
  label:    string
  time:     string
  variant?: OperationalVariant
}

export function ActivityRow({ icon: Icon, label, time, variant = 'neutral' }: ActivityRowProps) {
  const iconColor: Record<OperationalVariant, string> = {
    neutral:     'text-muted-foreground',
    success:     'text-success',
    warning:     'text-warning',
    destructive: 'text-destructive',
    info:        'text-info',
  }
  return (
    <div className="flex items-center gap-3 py-2 text-xs border-b border-border/50 last:border-0">
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', iconColor[variant])} />
      <span className="flex-1 text-foreground/80 truncate">{label}</span>
      <span className="text-muted-foreground flex-shrink-0 tabular-nums">{time}</span>
    </div>
  )
}

// ── QuickActionRow ────────────────────────────────────────────────────────────

export interface QuickActionRowProps {
  icon:    React.ComponentType<{ className?: string }>
  label:   string
  detail?: string
  onClick: () => void
}

export function QuickActionRow({ icon: Icon, label, detail, onClick }: QuickActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full px-2 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left group"
    >
      <div className="h-7 w-7 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <span className="flex-1 text-[13px] text-foreground/80 group-hover:text-foreground transition-colors font-medium">
        {label}
      </span>
      {detail
        ? <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">{detail}</span>
        : <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      }
    </button>
  )
}

// ── OperationalTable ──────────────────────────────────────────────────────────
// Clean enterprise table — no zebra, subtle row hover + bottom dividers

export interface OpsTableColumn {
  header:     string
  key:        string
  render?:    (row: Record<string, unknown>) => React.ReactNode
  align?:     'left' | 'right' | 'center'
  width?:     string
  className?: string
}

export interface OpsTableProps {
  columns:     OpsTableColumn[]
  rows:        Record<string, unknown>[]
  rowKey:      (row: Record<string, unknown>) => string
  onRowClick?: (row: Record<string, unknown>) => void
  emptyText?:  string
  compact?:    boolean
}

export function OperationalTable({
  columns, rows, rowKey, onRowClick, emptyText = 'No records', compact = false,
}: OpsTableProps) {
  if (!rows.length) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        {emptyText}
      </div>
    )
  }
  const cellPy = compact ? 'py-2' : 'py-3'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map(col => (
              <th
                key={col.key}
                className={cn(
                  'pb-2.5 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap',
                  col.align === 'right'  ? 'text-right'  :
                  col.align === 'center' ? 'text-center' : 'text-left',
                  col.className,
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={rowKey(row)}
              className={cn(
                'border-b border-border/40 last:border-0',
                onRowClick && 'cursor-pointer hover:bg-muted/40 transition-colors',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={cn(
                    cellPy, 'px-3 text-sm',
                    col.align === 'right'  ? 'text-right'  :
                    col.align === 'center' ? 'text-center' : '',
                    col.className,
                  )}
                >
                  {col.render ? col.render(row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── RailSection ───────────────────────────────────────────────────────────────
// Right-rail section with divider and uppercase label

interface RailSectionProps {
  title:      string
  children:   React.ReactNode
  action?:    React.ReactNode
  className?: string
}

export function RailSection({ title, children, action, className }: RailSectionProps) {
  return (
    <div className={cn('py-3 px-3 border-b border-border/60 last:border-0', className)}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 select-none">
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── PriorityItem ──────────────────────────────────────────────────────────────
// Right-rail priority item: colored dot + label + count chip

export interface PriorityItemProps {
  label:   string
  count:   number
  variant: 'destructive' | 'warning' | 'info'
  href?:   string
}

const PRIORITY_CHIP = {
  destructive: { dot: 'bg-destructive', countBg: 'bg-destructive/10', countText: 'text-destructive' },
  warning:     { dot: 'bg-warning',     countBg: 'bg-warning/10',     countText: 'text-warning' },
  info:        { dot: 'bg-info',        countBg: 'bg-info/10',        countText: 'text-info' },
}

export function PriorityItem({ label, count, variant, href }: PriorityItemProps) {
  const s = PRIORITY_CHIP[variant]
  const inner = (
    <div className="flex items-center gap-2.5 py-1.5 px-1 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
      <div className={cn('h-2 w-2 rounded-full flex-shrink-0', s.dot)} />
      <span className="flex-1 text-[13px] text-foreground/80 truncate leading-none">{label}</span>
      <span className={cn(
        'text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md flex-shrink-0 min-w-[28px] text-center',
        s.countBg, s.countText,
      )}>
        {count}
      </span>
    </div>
  )
  if (href) return <Link to={href}>{inner}</Link>
  return inner
}

// ── DeadlineItem ──────────────────────────────────────────────────────────────

export interface DeadlineItemProps {
  icon:     React.ComponentType<{ className?: string }>
  label:    string
  date:     string
  urgency?: 'normal' | 'soon' | 'urgent'
}

export function DeadlineItem({ icon: Icon, label, date, urgency = 'normal' }: DeadlineItemProps) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="flex-shrink-0 h-7 w-7 rounded-md bg-muted flex items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-foreground/80 font-medium truncate leading-tight">{label}</p>
        <p className={cn('text-[11px] mt-0.5 tabular-nums', {
          'text-muted-foreground': urgency === 'normal',
          'text-warning font-medium':     urgency === 'soon',
          'text-destructive font-medium': urgency === 'urgent',
        })}>
          {date}
        </p>
      </div>
    </div>
  )
}

// ── HealthRow ─────────────────────────────────────────────────────────────────

export interface HealthRowProps {
  label:   string
  status:  'healthy' | 'degraded' | 'down' | 'unknown'
  detail?: string
}

const HEALTH_DOT = {
  healthy:  { dot: 'bg-success',          label: 'Healthy',  text: 'text-success' },
  degraded: { dot: 'bg-warning',          label: 'Degraded', text: 'text-warning' },
  down:     { dot: 'bg-destructive',      label: 'Down',     text: 'text-destructive' },
  unknown:  { dot: 'bg-muted-foreground', label: 'Unknown',  text: 'text-muted-foreground' },
}

export function HealthRow({ label, status, detail }: HealthRowProps) {
  const s = HEALTH_DOT[status]
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-foreground/80">{label}</span>
      {detail ? (
        <span className="text-[11px] text-muted-foreground tabular-nums">{detail}</span>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
          <span className={cn('text-[11px] font-semibold', s.text)}>{s.label}</span>
        </div>
      )}
    </div>
  )
}

// ── HelpfulLink ───────────────────────────────────────────────────────────────

export interface HelpfulLinkProps {
  icon:  React.ComponentType<{ className?: string }>
  label: string
  href:  string
}

export function HelpfulLink({ icon: Icon, label, href }: HelpfulLinkProps) {
  return (
    <Link
      to={href}
      className="flex items-center gap-2.5 py-1.5 px-1 rounded-md hover:bg-muted/50 transition-colors group"
    >
      <div className="h-6 w-6 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0">
        <Icon className="h-3 w-3 text-primary" />
      </div>
      <span className="flex-1 text-[13px] text-foreground/75 group-hover:text-foreground transition-colors truncate">
        {label}
      </span>
      <ExternalLink className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </Link>
  )
}
