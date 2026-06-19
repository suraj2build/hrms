/**
 * RosterPolicyEditor — /admin/masters/rosters/:id
 *
 * Enterprise Roster Policy Configuration Workspace.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  Header bar: name, description, code, save button, archive           │
 *   ├──────────────┬───────────────────────────────────┬───────────────────┤
 *   │  Left panel  │        7×5 Matrix (center)        │  Right panel      │
 *   │  Impact +    │  Week × Day grid — click to       │  Monthly calendar │
 *   │  Summary     │  cycle Working → Off → Half Day   │  preview          │
 *   └──────────────┴───────────────────────────────────┴───────────────────┘
 *
 * Routes:
 *   /admin/masters/rosters/new    — create mode (id === 'new')
 *   /admin/masters/rosters/:id    — edit mode
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams }                              from 'react-router-dom'
import { toast }                                               from 'sonner'
import { useQuery, useMutation, useQueryClient }               from '@tanstack/react-query'
import {
  ArrowLeft, Save, Archive, ArchiveRestore, Building2,
  Users, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight,
  Copy, Info,
} from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Badge }    from '@/components/ui/badge'
import { api }      from '@/lib/api/client'
import { cn }       from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type DayState = 'working' | 'off' | 'half_day'

interface WeekRow {
  mon: DayState; tue: DayState; wed: DayState; thu: DayState
  fri: DayState; sat: DayState; sun: DayState
}

interface PolicyMatrix {
  week1: WeekRow; week2: WeekRow; week3: WeekRow; week4: WeekRow; week5: WeekRow
}

interface RosterPolicy {
  id:           string
  name:         string
  code:         string | null
  description:  string | null
  cycle_days:   7 | 14 | 28
  pattern_json: {
    weekly_off_days: number[]
    matrix?:         PolicyMatrix
  }
  is_active:    boolean
  wo_credit_structure_id: string | null
  created_at:   string
  updated_at:   string | null
}

interface WoStructureOption {
  id:   string
  name: string
}

interface ImpactData {
  site_count:               number
  direct_employee_count:    number
  inherited_employee_count: number
  total_employee_count:     number
  sites: { id: string; name: string; code?: string }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEK_KEYS = ['week1', 'week2', 'week3', 'week4', 'week5'] as const
type WeekKey = typeof WEEK_KEYS[number]

const DAY_KEYS  = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type DayKey = typeof DAY_KEYS[number]

const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const DAY_LABELS_LONG: Record<DayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]


// ── Default factories ─────────────────────────────────────────────────────────

function defaultWeekRow(): WeekRow {
  return { mon: 'working', tue: 'working', wed: 'working', thu: 'working', fri: 'working', sat: 'off', sun: 'off' }
}

function defaultMatrix(): PolicyMatrix {
  return {
    week1: defaultWeekRow(),
    week2: defaultWeekRow(),
    week3: defaultWeekRow(),
    week4: defaultWeekRow(),
    week5: defaultWeekRow(),
  }
}

// ── State cycling ─────────────────────────────────────────────────────────────

function cycleState(s: DayState): DayState {
  if (s === 'working')  return 'off'
  if (s === 'off')      return 'half_day'
  return 'working'
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

/**
 * Given a date (year, month 0-indexed, day), returns which occurrence (1-5)
 * of that day-of-week it is within its month.
 * e.g. 2nd Saturday of the month → 2
 */
function getOccurrenceInMonth(year: number, month: number, day: number): number {
  const d = new Date(year, month, day)
  return Math.floor((d.getDate() - 1) / 7) + 1
}

/**
 * Returns the DayKey for a JS Date object.
 */
function jsDateToDayKey(d: Date): DayKey {
  const map: Record<number, DayKey> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' }
  return map[d.getDay()]
}

/**
 * Returns the DayState for a specific date based on the matrix.
 */
function getDayState(matrix: PolicyMatrix, date: Date): DayState {
  const occurrence = getOccurrenceInMonth(date.getFullYear(), date.getMonth(), date.getDate())
  const weekKey    = WEEK_KEYS[Math.min(occurrence - 1, 4)]  // cap at week5
  const dayKey     = jsDateToDayKey(date)
  return matrix[weekKey][dayKey]
}

// ── Policy summary generator ──────────────────────────────────────────────────

function generateSummary(matrix: PolicyMatrix): string[] {
  const parts: string[] = []

  for (const day of DAY_KEYS) {
    const offWeeks: number[]     = []
    const halfWeeks: number[]    = []

    for (let wi = 0; wi < 5; wi++) {
      const state = matrix[WEEK_KEYS[wi]][day]
      if (state === 'off')      offWeeks.push(wi + 1)
      if (state === 'half_day') halfWeeks.push(wi + 1)
    }

    const label = DAY_LABELS_LONG[day]
    const ords  = ['1st', '2nd', '3rd', '4th', '5th']

    if (offWeeks.length === 5) {
      parts.push(`All ${label}s off`)
    } else if (offWeeks.length > 0) {
      if (offWeeks.length === 2 && offWeeks[0] === 2 && offWeeks[1] === 4) {
        parts.push(`2nd & 4th ${label}s off`)
      } else if (offWeeks.length === 2 && offWeeks[0] === 1 && offWeeks[1] === 3) {
        parts.push(`1st & 3rd ${label}s off`)
      } else {
        parts.push(`${offWeeks.map(w => ords[w - 1]).join(', ')} ${label}${offWeeks.length > 1 ? 's' : ''} off`)
      }
    }

    if (halfWeeks.length === 5) {
      parts.push(`All ${label}s half day`)
    } else if (halfWeeks.length > 0) {
      parts.push(`${halfWeeks.map(w => ords[w - 1]).join(', ')} ${label}${halfWeeks.length > 1 ? 's' : ''} half day`)
    }
  }

  return parts.length > 0 ? parts : ['All days working']
}

// ── MatrixCell ────────────────────────────────────────────────────────────────

function MatrixCell({
  state,
  isWeekend,
  onClick,
}: {
  state:     DayState
  isWeekend: boolean
  onClick:   () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-10 w-full rounded-lg border-2 transition-all duration-100 flex items-center justify-center text-[10px] font-semibold tracking-wide select-none focus:outline-none focus:ring-2 focus:ring-primary/40',
        state === 'working' && [
          'border-success bg-success text-success',
          'hover:bg-success hover:border-success',
          isWeekend && 'border-success/60 bg-success/50',
        ],
        state === 'off' && [
          'border-destructive bg-destructive text-destructive',
          'hover:bg-destructive hover:border-destructive',
        ],
        state === 'half_day' && [
          'border-warning bg-warning text-warning',
          'hover:bg-warning hover:border-warning',
        ],
      )}
    >
      {state === 'working'  && 'W'}
      {state === 'off'      && 'Off'}
      {state === 'half_day' && '½'}
    </button>
  )
}

// ── MatrixGrid ────────────────────────────────────────────────────────────────

function MatrixGrid({
  matrix,
  onChange,
}: {
  matrix:   PolicyMatrix
  onChange: (next: PolicyMatrix) => void
}) {
  function toggleCell(week: WeekKey, day: DayKey) {
    onChange({
      ...matrix,
      [week]: { ...matrix[week], [day]: cycleState(matrix[week][day]) },
    })
  }

  function setColumn(day: DayKey, state: DayState) {
    const next = { ...matrix }
    for (const wk of WEEK_KEYS) {
      next[wk] = { ...next[wk], [day]: state }
    }
    onChange(next)
  }

  function setRow(week: WeekKey, state: DayState) {
    onChange({ ...matrix, [week]: { mon: state, tue: state, wed: state, thu: state, fri: state, sat: state, sun: state } })
  }

  function copyWeek(srcWeek: WeekKey, dstWeek: WeekKey) {
    onChange({ ...matrix, [dstWeek]: { ...matrix[srcWeek] } })
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        {/* Column headers */}
        <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 mb-1">
          <div /> {/* row label spacer */}
          {DAY_KEYS.map(day => {
            const isWeekend = day === 'sat' || day === 'sun'
            // Determine majority state for column header
            const states = WEEK_KEYS.map(wk => matrix[wk][day])
            const allOff = states.every(s => s === 'off')
            const allWork = states.every(s => s === 'working')
            return (
              <div key={day} className="flex flex-col items-center gap-1">
                <span className={cn(
                  'text-[11px] font-semibold',
                  isWeekend ? 'text-primary' : 'text-muted-foreground',
                )}>
                  {DAY_LABELS[day]}
                </span>
                {/* Column bulk toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const next = allOff ? 'working' : 'off'
                    setColumn(day, next)
                  }}
                  title={`Set all ${DAY_LABELS_LONG[day]}s to ${allOff ? 'Working' : 'Off'}`}
                  className={cn(
                    'w-5 h-1.5 rounded-full transition-colors',
                    allOff   && 'bg-destructive',
                    allWork  && 'bg-success',
                    !allOff && !allWork && 'bg-warning',
                  )}
                />
              </div>
            )
          })}
        </div>

        {/* Matrix rows */}
        {WEEK_KEYS.map((wk, wi) => (
            <div key={wk} className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 mb-1 group/row">
              {/* Row label + actions */}
              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Week {wi + 1}
                  </span>
                  {/* Row reset to all-working */}
                  <button
                    type="button"
                    onClick={() => setRow(wk, 'working')}
                    title="Reset row to all Working"
                    className="opacity-0 group-hover/row:opacity-100 transition-opacity ml-auto"
                  >
                    <RefreshCw className="h-2.5 w-2.5 text-muted-foreground/50 hover:text-primary" />
                  </button>
                </div>
                {/* Copy from previous week */}
                {wi > 0 && (
                  <button
                    type="button"
                    onClick={() => copyWeek(WEEK_KEYS[wi - 1], wk)}
                    title={`Copy Week ${wi} pattern`}
                    className="opacity-0 group-hover/row:opacity-100 transition-opacity mt-0.5 flex items-center gap-0.5 text-[9px] text-muted-foreground/50 hover:text-primary"
                  >
                    <Copy className="h-2 w-2" />
                    Copy W{wi}
                  </button>
                )}
              </div>

              {DAY_KEYS.map(day => (
                <MatrixCell
                  key={day}
                  state={matrix[wk][day]}
                  isWeekend={day === 'sat' || day === 'sun'}
                  onClick={() => toggleCell(wk, day)}
                />
              ))}
            </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-success/10 border-2 border-success/30 flex items-center justify-center text-[9px] font-bold text-success">W</span>
            Working
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-destructive/10 border-2 border-destructive/30 flex items-center justify-center text-[9px] font-bold text-destructive">Off</span>
            Off
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-warning/10 border-2 border-warning/30 flex items-center justify-center text-[9px] font-bold text-warning">½</span>
            Half Day
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            Click any cell to cycle · Click column bar to toggle column
          </span>
        </div>
      </div>
    </div>
  )
}

// ── MonthlyPreview ────────────────────────────────────────────────────────────

function MonthlyPreview({ matrix }: { matrix: PolicyMatrix }) {
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay() // 0=Sun...6=Sat
  // Convert to Mon-first grid (Mon=0...Sun=6)
  const gridStart   = (firstDow + 6) % 7

  const cells: { date: number | null; state: DayState | null }[] = [
    ...Array.from({ length: gridStart }, () => ({ date: null, state: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d     = new Date(viewYear, viewMonth, i + 1)
      const state = getDayState(matrix, d)
      return { date: i + 1, state }
    }),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push({ date: null, state: null })

  // Summary counts
  const offCount  = cells.filter(c => c.state === 'off').length
  const halfCount = cells.filter(c => c.state === 'half_day').length
  const workCount = cells.filter(c => c.state === 'working').length

  return (
    <div className="flex flex-col gap-3">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-muted">
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <span className="text-xs font-semibold">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-muted">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div
            key={i}
            className={cn(
              'text-center text-[9px] font-bold py-0.5',
              i >= 5 ? 'text-primary' : 'text-muted-foreground/70',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => (
          <div
            key={i}
            className={cn(
              'aspect-square rounded text-[9px] flex items-center justify-center font-medium',
              !cell.date && 'invisible',
              cell.state === 'working'  && 'bg-success/15 text-success',
              cell.state === 'off'      && 'bg-destructive/15 text-destructive',
              cell.state === 'half_day' && 'bg-warning/20 text-warning',
            )}
          >
            {cell.date}
          </div>
        ))}
      </div>

      {/* Month stats */}
      <div className="grid grid-cols-3 gap-1 pt-2 border-t border-border/50">
        <div className="text-center">
          <div className="text-sm font-semibold text-success">{workCount}</div>
          <div className="text-[9px] text-muted-foreground">Working</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-destructive">{offCount}</div>
          <div className="text-[9px] text-muted-foreground">Off</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-warning">{halfCount}</div>
          <div className="text-[9px] text-muted-foreground">Half Day</div>
        </div>
      </div>
    </div>
  )
}

// ── RosterPolicyEditor ────────────────────────────────────────────────────────

export function RosterPolicyEditor() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const isNew     = id === 'new'

  // ── Form state ────────────────────────────────────────────────────────────
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [cycleDays,   setCycleDays]   = useState<7 | 14 | 28>(7)
  const [matrix,      setMatrix]      = useState<PolicyMatrix>(defaultMatrix)
  const [isActive,    setIsActive]    = useState(true)
  const [woStructureId, setWoStructureId] = useState<string | null>(null)
  const [isDirty,     setIsDirty]     = useState(false)

  // WO-credit structures available for tagging (retail floating weekly-off)
  const { data: woStructures = [] } = useQuery<WoStructureOption[]>({
    queryKey: ['wo-credit', 'structures', 'options'],
    queryFn:  () => api.get<{ data?: WoStructureOption[] }>('/attendance/wo-credit/structures').then((r) => (r.data ?? []).map((s) => ({ id: s.id, name: s.name }))),
    staleTime: 60_000,
  })

  // ── Load existing policy ──────────────────────────────────────────────────
  const { data: policyData, isLoading: policyLoading } = useQuery<{ data: RosterPolicy }>({
    queryKey: ['roster-policy', id],
    queryFn:  () => api.get(`/masters/rosters/${id}`),
    enabled:  !isNew && !!id,
    staleTime: 30_000,
  })

  useEffect(() => {
    const p = policyData?.data
    if (!p) return
    setName(p.name)
    setDescription(p.description ?? '')
    setCycleDays(p.cycle_days)
    setMatrix(p.pattern_json.matrix ?? defaultMatrix())
    setIsActive(p.is_active)
    setWoStructureId(p.wo_credit_structure_id ?? null)
    setIsDirty(false)
  }, [policyData])

  // ── Impact data ───────────────────────────────────────────────────────────
  const { data: impactData } = useQuery<{ data: ImpactData }>({
    queryKey: ['roster-impact', id],
    queryFn:  () => api.get(`/masters/rosters/${id}/impact`),
    enabled:  !isNew && !!id,
    staleTime: 60_000,
  })
  const impact = impactData?.data

  // ── Matrix change handler ─────────────────────────────────────────────────
  const handleMatrixChange = useCallback((next: PolicyMatrix) => {
    setMatrix(next)
    setIsDirty(true)
  }, [])

  // ── Summary lines ─────────────────────────────────────────────────────────
  const summaryLines = useMemo(() => generateSummary(matrix), [matrix])

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        name:         name.trim(),
        description:  description.trim() || null,
        cycle_days:   cycleDays,
        pattern_json: { matrix, weekly_off_days: [] },  // backend re-derives weekly_off_days
        is_active:    isActive,
        wo_credit_structure_id: woStructureId,
      }
      return isNew
        ? api.post<{ data?: { id?: string } }>('/masters/rosters', payload)
        : api.put<{ data?: { id?: string } }>(`/masters/rosters/${id}`, payload)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['roster-policies'] })
      qc.invalidateQueries({ queryKey: ['roster-policy', id] })
      toast.success(isNew ? 'Roster policy created' : 'Roster policy saved')
      setIsDirty(false)
      if (isNew && res?.data?.id) {
        navigate(`/admin/masters/rosters/${res.data.id}`, { replace: true })
      }
    },
    onError: (e: Error) => toast.error('Failed to save policy', { description: e.message }),
  })

  // ── Archive toggle mutation ───────────────────────────────────────────────
  const archiveMut = useMutation({
    mutationFn: () => api.put(`/masters/rosters/${id}`, { is_active: !isActive }),
    onSuccess: () => {
      const next = !isActive
      setIsActive(next)
      qc.invalidateQueries({ queryKey: ['roster-policies'] })
      toast.success(next ? 'Policy restored' : 'Policy archived')
    },
    onError: (e: Error) => toast.error('Failed to update status', { description: e.message }),
  })

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (!isNew && policyLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        Loading roster policy…
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-background border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Back */}
          <button
            type="button"
            onClick={() => navigate('/admin/masters/rosters')}
            className="mt-0.5 p-1 rounded hover:bg-muted transition-colors flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>

          {/* Title + description */}
          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <div className="flex flex-col gap-1">
              {/* Policy name */}
              <input
                value={name}
                onChange={e => { setName(e.target.value); setIsDirty(true) }}
                placeholder="Roster Policy Name"
                className="text-base font-semibold bg-transparent border-0 border-b border-transparent focus:border-border outline-none transition-colors w-full placeholder:text-muted-foreground/40"
              />
              {/* Description */}
              <input
                value={description}
                onChange={e => { setDescription(e.target.value); setIsDirty(true) }}
                placeholder="Add a description…"
                className="text-xs text-muted-foreground bg-transparent border-0 border-b border-transparent focus:border-border outline-none transition-colors w-full placeholder:text-muted-foreground/30"
              />
            </div>

            {/* Meta row: cycle, status */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Cycle selector */}
              <select
                value={cycleDays}
                onChange={e => { setCycleDays(Number(e.target.value) as 7 | 14 | 28); setIsDirty(true) }}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value={7}>7-day cycle</option>
                <option value={14}>14-day cycle</option>
                <option value={28}>28-day cycle</option>
              </select>

              {/* Status badge */}
              {!isNew && (
                <Badge
                  variant={isActive ? 'default' : 'outline'}
                  className={cn(
                    'rounded-full text-[10px] px-2',
                    isActive
                      ? 'bg-success/15 text-success border-success hover:bg-success/15'
                      : 'text-muted-foreground',
                  )}
                >
                  {isActive ? 'Active' : 'Archived'}
                </Badge>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isNew && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => archiveMut.mutate()}
                disabled={archiveMut.isPending}
                className="gap-1.5 text-xs"
              >
                {isActive
                  ? <><Archive className="h-3.5 w-3.5" />Archive</>
                  : <><ArchiveRestore className="h-3.5 w-3.5" />Restore</>
                }
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !name.trim()}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saveMut.isPending ? 'Saving…' : (isDirty ? 'Save Changes' : 'Save')}
            </Button>
          </div>
        </div>

        {/* Unsaved changes indicator */}
        {isDirty && (
          <div className="mt-2 ml-10 flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="h-3 w-3" />
            Unsaved changes
          </div>
        )}
      </div>

      {/* ── Three-column workspace ──────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <aside className="w-52 flex-shrink-0 border-r border-border overflow-y-auto bg-muted/20">
          <div className="p-3 space-y-4">

            {/* Impact summary */}
            {!isNew && impact && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                  Impact
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3" /> Sites
                    </span>
                    <span className="text-xs font-semibold">{impact.site_count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" /> Direct
                    </span>
                    <span className="text-xs font-semibold">{impact.direct_employee_count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" /> Via Site
                    </span>
                    <span className="text-xs font-semibold">{impact.inherited_employee_count}</span>
                  </div>
                  <div className="border-t border-border/50 pt-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium">Total employees</span>
                    <span className="text-xs font-bold text-primary">{impact.total_employee_count}</span>
                  </div>
                </div>
              </div>
            )}

            {/* New policy placeholder */}
            {isNew && (
              <div className="rounded-lg border border-dashed border-border/60 p-3">
                <p className="text-[10px] text-muted-foreground text-center">
                  Impact data available after saving
                </p>
              </div>
            )}

            {/* Assigned sites */}
            {!isNew && impact && impact.sites.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                  Assigned Sites
                </div>
                <div className="space-y-1">
                  {impact.sites.slice(0, 8).map(s => (
                    <div key={s.id} className="flex items-center gap-1.5 text-xs">
                      <Building2 className="h-2.5 w-2.5 text-muted-foreground/50 flex-shrink-0" />
                      <span className="truncate text-muted-foreground">{s.name}</span>
                    </div>
                  ))}
                  {impact.sites.length > 8 && (
                    <p className="text-[10px] text-muted-foreground/60">+{impact.sites.length - 8} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Weekly-off summary */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                Policy Summary
              </div>
              <div className="space-y-1">
                {summaryLines.map((line, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </div>

            {/* WO-credit structure (retail floating weekly-off) */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                Weekly-Off Credit
              </div>
              <select
                value={woStructureId ?? ''}
                onChange={e => { setWoStructureId(e.target.value || null); setIsDirty(true) }}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">Fixed weekly-off (normal)</option>
                {woStructures.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">
                Tag a structure to make employees on this roster earn weekly-offs from worked days (retail). They are excluded from Comp-Off.
              </p>
            </div>

            {/* Payroll note */}
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-2.5">
              <div className="flex items-start gap-1.5">
                <Info className="h-3 w-3 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-warning leading-relaxed">
                  Off days are excluded from payable days. Half days count as 0.5 days. Changes apply to the next payroll cycle.
                </div>
              </div>
            </div>

          </div>
        </aside>

        {/* ── Center: matrix ──────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto p-5 min-w-0">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">Weekly-Off Matrix</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure which occurrence of each day is working, off, or a half day.
              Rows = month occurrence (1st–5th). Columns = day of week.
            </p>
          </div>

          <MatrixGrid matrix={matrix} onChange={handleMatrixChange} />
        </main>

        {/* ── Right panel: monthly preview ────────────────────────────────── */}
        <aside className="w-56 flex-shrink-0 border-l border-border overflow-y-auto bg-muted/20">
          <div className="p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
              Monthly Preview
            </div>
            <MonthlyPreview matrix={matrix} />
          </div>
        </aside>

      </div>
    </div>
  )
}
