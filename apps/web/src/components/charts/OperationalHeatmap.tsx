/**
 * OperationalHeatmap.tsx — CSS grid heatmap for 4 operational density patterns
 * Phase UX-4
 *
 * Types:
 *   anomaly_density      — attendance_anomaly + missing_punch by [dayOfWeek][hour]
 *   ot_concentration     — ot_spike + fatigue_risk by [dayOfWeek][hour]
 *   absenteeism          — missing_punch by [date (last 14 days)][severity]
 *   shift_coverage_risk  — shift_unassigned + roster_change by [dayOfWeek][hour]
 */

import { useMemo, useState } from 'react'
import { cn }                from '@/lib/utils'
import { useActivityStream } from '@/lib/activity/useActivityStream'
import type { OperationalActivityEvent, EventSeverity } from '@/lib/activity/types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface OperationalHeatmapProps {
  type:         'anomaly_density' | 'ot_concentration' | 'absenteeism' | 'shift_coverage_risk'
  title?:       string
  description?: string
  height?:      number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const HOURS        = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const SEVERITIES: EventSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

function getLast14Dates(): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

// ── Intensity colour ───────────────────────────────────────────────────────────

function intensityColor(value: number, max: number): string {
  if (max === 0) return 'bg-muted/30'
  const pct = value / max
  if (pct === 0)   return 'bg-muted/20'
  if (pct < 0.25)  return 'bg-info/20'
  if (pct < 0.50)  return 'bg-warning/30'
  if (pct < 0.75)  return 'bg-accent-coral/50'
  return 'bg-destructive/70'
}

// ── Grid derivations ───────────────────────────────────────────────────────────

/** Build a [dayOfWeek 0-6][hour 0-23] count matrix */
function buildDayHourMatrix(events: OperationalActivityEvent[]): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const e of events) {
    const d = new Date(e.timestamp)
    matrix[d.getDay()][d.getHours()]++
  }
  return matrix
}

interface DayHourGrid {
  rows: string[]
  cols: string[]
  matrix: number[][]
  max: number
}

function buildDayHourGrid(events: OperationalActivityEvent[]): DayHourGrid {
  const matrix = buildDayHourMatrix(events)
  const max    = Math.max(0, ...matrix.flat())
  return { rows: [...DAYS_OF_WEEK], cols: HOURS, matrix, max }
}

interface DateSeverityGrid {
  rows:   string[]
  cols:   string[]
  matrix: number[][]
  max:    number
}

/** Build a [date (last 14)][severity] count matrix */
function buildAbsenteeismGrid(events: OperationalActivityEvent[]): DateSeverityGrid {
  const dates   = getLast14Dates()
  const matrix  = dates.map(() => new Array<number>(SEVERITIES.length).fill(0))
  for (const e of events) {
    const dayIdx = dates.indexOf(e.timestamp.slice(0, 10))
    const sevIdx = SEVERITIES.indexOf(e.severity)
    if (dayIdx !== -1 && sevIdx !== -1) {
      matrix[dayIdx][sevIdx]++
    }
  }
  const max = Math.max(0, ...matrix.flat())
  return { rows: dates.map(d => d.slice(5)), cols: SEVERITIES, matrix, max }
}

// ── Tooltip state ──────────────────────────────────────────────────────────────

interface TooltipState {
  row:   string
  col:   string
  value: number
  x:     number
  y:     number
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OperationalHeatmap({
  type,
  title,
  description,
  height = 200,
}: OperationalHeatmapProps) {
  const { allEvents } = useActivityStream()
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // ── Derive grid ────────────────────────────────────────────────────────────

  const grid = useMemo(() => {
    switch (type) {
      case 'anomaly_density':
        return buildDayHourGrid(
          allEvents.filter(e => e.type === 'attendance_anomaly' || e.type === 'missing_punch'),
        )
      case 'ot_concentration':
        return buildDayHourGrid(
          allEvents.filter(e => e.type === 'ot_spike' || e.type === 'fatigue_risk'),
        )
      case 'absenteeism':
        return buildAbsenteeismGrid(
          allEvents.filter(e => e.type === 'missing_punch'),
        )
      case 'shift_coverage_risk':
        return buildDayHourGrid(
          allEvents.filter(e => e.type === 'shift_unassigned' || e.type === 'roster_change'),
        )
    }
  }, [type, allEvents])

  // ── Default titles ─────────────────────────────────────────────────────────

  const defaultTitle: Record<typeof type, string> = {
    anomaly_density:     'Anomaly Density',
    ot_concentration:    'OT Concentration',
    absenteeism:         'Absenteeism Pattern',
    shift_coverage_risk: 'Shift Coverage Risk',
  }
  const defaultDesc: Record<typeof type, string> = {
    anomaly_density:     'Attendance anomalies & missing punches by day & hour',
    ot_concentration:    'OT spikes & fatigue risk by day & hour',
    absenteeism:         'Missing punches by date & severity (last 14 days)',
    shift_coverage_risk: 'Unassigned shifts & roster changes by day & hour',
  }

  const displayTitle = title       ?? defaultTitle[type]
  const displayDesc  = description ?? defaultDesc[type]

  // ── Cell size: small for 24-col (hour) grids, larger for severity cols ─────

  const isHourGrid = type !== 'absenteeism'
  const cellSize   = isHourGrid ? 12 : 16

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
      style={{ minHeight: height }}
    >
      {/* Header */}
      <div>
        <p className="text-sm font-semibold text-foreground">{displayTitle}</p>
        <p className="text-xs text-muted-foreground">{displayDesc}</p>
      </div>

      {/* Grid area */}
      <div className="relative overflow-x-auto">
        <div className="flex gap-1.5 min-w-0">
          {/* Row labels */}
          <div
            className="flex flex-col gap-0.5 flex-shrink-0"
            style={{ marginTop: cellSize + 4 }} // offset to align with col labels row
          >
            {grid.rows.map(row => (
              <div
                key={row}
                className="text-[10px] text-muted-foreground flex items-center justify-end pr-1 leading-none"
                style={{ height: cellSize, minWidth: isHourGrid ? 28 : 44 }}
              >
                {row}
              </div>
            ))}
          </div>

          {/* Columns + cells */}
          <div className="flex flex-col gap-0.5 min-w-0">
            {/* Column headers */}
            <div className="flex gap-0.5" style={{ height: cellSize }}>
              {grid.cols.map((col, ci) => (
                <div
                  key={ci}
                  className="text-[9px] text-muted-foreground text-center leading-none flex items-center justify-center flex-shrink-0"
                  style={{ width: cellSize }}
                >
                  {/* Show every 3rd hour label for 24-col grids; show all for severity */}
                  {isHourGrid ? (Number(col) % 3 === 0 ? col : '') : col.slice(0, 3)}
                </div>
              ))}
            </div>

            {/* Data rows */}
            {grid.rows.map((row, ri) => (
              <div key={row} className="flex gap-0.5">
                {grid.cols.map((col, ci) => {
                  const val = grid.matrix[ri]?.[ci] ?? 0
                  return (
                    <div
                      key={ci}
                      className={cn(
                        'rounded-[2px] cursor-default transition-opacity hover:opacity-80 flex-shrink-0',
                        intensityColor(val, grid.max),
                      )}
                      style={{ width: cellSize, height: cellSize }}
                      onMouseEnter={ev => {
                        const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                        setTooltip({ row, col, value: val, x: rect.left, y: rect.top })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Hover tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none px-2 py-1.5 rounded-md shadow-md border border-border bg-card text-xs text-foreground"
            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
          >
            <span className="font-medium">{tooltip.row}</span>
            {' / '}
            <span className="font-medium">{tooltip.col}</span>
            {' — '}
            <span>{tooltip.value} event{tooltip.value !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-auto">
        <span className="text-[10px] text-muted-foreground">Low</span>
        {[0, 0.1, 0.3, 0.6, 1].map((pct, i) => (
          <div
            key={i}
            className={cn('rounded-[2px]', intensityColor(pct, 1))}
            style={{ width: 12, height: 12 }}
          />
        ))}
        <span className="text-[10px] text-muted-foreground">High</span>
      </div>
    </div>
  )
}
