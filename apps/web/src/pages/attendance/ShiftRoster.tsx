/**
 * ShiftRoster — /roster
 *
 * Visual shift roster management for HR admins.
 *
 * Features:
 *   · Monthly calendar grid: employees (rows) × days (columns)
 *   · Location filter to narrow the employee list
 *   · Each cell shows the effective shift — roster override (blue) or
 *     standing shift (muted). Empty cells show a dashed placeholder.
 *   · Click any cell → inline shift selector (select element)
 *   · "Clear override" option removes a roster row (standing shift stays)
 *   · Bulk assign panel: select employees + date range + shift → apply
 *   · Week preset buttons to quickly fill date range in bulk panel
 *   · Copy Previous Week to replicate overrides from the prior 7 days
 *
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useRef, useEffect }                  from 'react'
import { useQuery, useMutation, useQueryClient }        from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, ShieldAlert, Loader2,
  CalendarClock, Users, RefreshCw, Copy, Upload,
  AlertTriangle, CheckCircle2, GitBranch,
  Flame, BarChart3, TrendingUp, Info,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { PeriodLockBanner } from '@/components/layout/PeriodLockBanner'
import { Badge }            from '@/components/ui/badge'
import { Button }           from '@/components/ui/button'
import { DateInput }        from '@/components/ui/date-input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { toast }            from 'sonner'
import { cn }               from '@/lib/utils'
import { usePeriodLock }    from '@/hooks/usePeriodLock'
import { ForensicsDrawer } from '@/components/operational/ForensicsDrawer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkLocation {
  id:   string
  name: string
}

interface Employee {
  id:            string
  employee_code: string
  name:          string
  work_location: WorkLocation | null
}

interface Shift {
  id:         string
  name:       string
  code:       string
  start_time: string
  end_time:   string
}

interface RosterRow {
  id:          string
  employee_id: string
  date:        string
  shift_id:    string
}

interface StandingRow {
  employee_id: string
  shift_id:    string
}

interface RosterData {
  month:     string
  employees: Employee[]
  shifts:    Shift[]
  roster:    RosterRow[]
  standing:  StandingRow[]
  /** Rotation-resolved master shift per employee per day: { empId: { 'YYYY-MM-DD': shiftId } } */
  master_by_day?: Record<string, Record<string, string>>
  /** Weekly-off (rest) days per employee per day, incl. alternate Saturdays. */
  rest_by_day?: Record<string, Record<string, boolean>>
}

// ── Roster template types ─────────────────────────────────────────────────────

interface RosterTemplate {
  id:           string
  name:         string
  cycle_days:   number
  pattern_json: { weekly_off_days: number[] }
}

// ── CSV preview types ──────────────────────────────────────────────────────────

interface CsvPreviewRow {
  line:          number   // 1-indexed data-row number (excludes header)
  employee_code: string
  date:          string
  shift_code:    string
  valid:         boolean
  error?:        string
}

interface CsvPreviewState {
  raw:   string           // original text, sent to backend on confirm
  rows:  CsvPreviewRow[]  // up to 20 preview rows
  total: number           // total data-row count in file
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse CSV text client-side.  Returns preview of first 20 data rows. */
function parseCsvPreview(text: string): CsvPreviewState {
  const lines     = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const dataLines = lines.slice(1)   // skip header
  const rows: CsvPreviewRow[] = []

  dataLines.slice(0, 20).forEach((l, i) => {
    const parts = l.split(',').map((s) => s.trim())
    const [employee_code = '', date = '', shift_code = ''] = parts

    let error: string | undefined
    if (!employee_code || !date || !shift_code) {
      error = 'Missing required columns'
    } else if (!DATE_RE.test(date)) {
      error = `Invalid date format — expected YYYY-MM-DD`
    }

    rows.push({
      line:          i + 1,
      employee_code,
      date,
      shift_code,
      valid:         !error,
      error,
    })
  })

  return { raw: text, rows, total: dataLines.length }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthStart(y: number, m: number) {
  return new Date(y, m, 1).toISOString().slice(0, 10)
}

function monthEnd(y: number, m: number) {
  return new Date(y, m + 1, 0).toISOString().slice(0, 10)
}

function allDaysInMonth(y: number, m: number): string[] {
  const days: string[] = []
  const cur = new Date(y, m, 1)
  while (cur.getMonth() === m) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

/** Advance a YYYY-MM-DD string by n days. */
function shiftDate(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Build Mon-Sun week presets that fall within the given month. */
function buildWeekPresets(y: number, m: number): Array<{ label: string; from: string; to: string }> {
  const first = new Date(y, m, 1)
  const last  = new Date(y, m + 1, 0)
  const presets: Array<{ label: string; from: string; to: string }> = []

  // Find first Monday on or after the 1st of the month
  const cur = new Date(first)
  while (cur.getDay() !== 1) cur.setDate(cur.getDate() + 1)

  let weekNum = 1
  while (cur <= last) {
    const from = cur.toISOString().slice(0, 10)
    const toD  = new Date(cur)
    toD.setDate(toD.getDate() + 6)
    const to = (toD > last ? last : toD).toISOString().slice(0, 10)
    presets.push({ label: `Week ${weekNum}`, from, to })
    cur.setDate(cur.getDate() + 7)
    weekNum++
  }
  return presets
}

const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function fmtTime(t: string | null) {
  if (!t) return ''
  return t.slice(0, 5)  // "HH:MM" from "HH:MM:SS"
}

// ── RosterCell ─────────────────────────────────────────────────────────────────

interface RosterCellProps {
  shift:      Shift | null
  isOverride: boolean
  isRest?:    boolean
  shifts:     Shift[]
  onAssign:   (shiftId: string) => void
  onClear:    () => void
  loading:    boolean
  readOnly?:  boolean
}

function RosterCell({ shift, isOverride, isRest = false, shifts, onAssign, onClear, loading, readOnly = false }: RosterCellProps) {
  const [open, setOpen] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)

  function handleClick() {
    if (readOnly) return
    setOpen(true)
    setTimeout(() => selectRef.current?.focus(), 0)
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setOpen(false)
    if (val === '__clear__') { onClear(); return }
    if (val && val !== '__none__') onAssign(val)
  }

  if (loading) {
    return (
      <div className="w-[52px] h-[30px] flex items-center justify-center">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // In read-only mode, show the shift pill without an interactive dropdown
  if (readOnly) {
    if (!shift) {
      return (
        <div className={cn('w-[52px] h-[30px] rounded border border-dashed border-border text-[10px] flex items-center justify-center',
          isRest ? 'text-muted-foreground/60 bg-muted/20' : 'text-muted-foreground/30')}>
          {isRest ? 'Off' : '—'}
        </div>
      )
    }
    const label = shift.code || shift.name.slice(0, 4).toUpperCase()
    return (
      <div
        title={`${shift.name} · ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}${isOverride ? ' · day override' : ' · from master'}`}
        className={cn(
          'w-[52px] h-[30px] rounded text-[10px] font-semibold truncate px-1 flex items-center justify-center',
          isOverride
            ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
            : 'bg-muted/50 text-foreground/70 border border-dashed border-border',
        )}
      >
        {label}
      </div>
    )
  }

  if (open) {
    return (
      <select
        ref={selectRef}
        className="w-[52px] h-[30px] text-[10px] rounded border border-primary/40 bg-card text-foreground cursor-pointer outline-none"
        defaultValue={shift?.id ?? '__none__'}
        onChange={handleChange}
        onBlur={() => setOpen(false)}
      >
        <option value="__none__">—</option>
        {shifts.map((s) => (
          <option key={s.id} value={s.id}>{s.code || s.name.slice(0, 4)}</option>
        ))}
        {shift && <option value="__clear__">✕ Clear</option>}
      </select>
    )
  }

  if (!shift) {
    return (
      <button
        type="button"
        title={isRest ? 'Weekly off (per roster) — click to assign a shift for this day' : 'Click to assign shift'}
        onClick={handleClick}
        className={cn('w-[52px] h-[30px] rounded border border-dashed border-border transition-colors text-[10px] flex items-center justify-center',
          isRest ? 'text-muted-foreground/60 bg-muted/20 hover:border-primary/40 hover:text-primary' : 'text-muted-foreground/40 hover:border-primary/40 hover:text-primary')}
      >
        {isRest ? 'Off' : '+'}
      </button>
    )
  }

  const label = shift.code || shift.name.slice(0, 4).toUpperCase()
  return (
    <button
      type="button"
      title={isOverride
        ? `${shift.name} · ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}\nDay override — click to change`
        : `${shift.name} · ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}\nFrom master assignment — click to override for this day`}
      onClick={handleClick}
      className={cn(
        'w-[52px] h-[30px] rounded text-[10px] font-semibold transition-colors truncate px-1',
        isOverride
          ? 'bg-primary/15 text-primary ring-1 ring-primary/30 hover:bg-primary/25'
          // Master/standing shift: legible, with a dashed ring so it reads as
          // an inherited default (not a blank cell, not a day-override).
          : 'bg-muted/50 text-foreground/70 border border-dashed border-border hover:bg-muted',
      )}
    >
      {label}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ShiftRoster() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [viewDate,       setViewDate]       = useState(() => new Date())
  const [locationFilter, setLocationFilter] = useState('')
  const [bulkMode,       setBulkMode]       = useState(false)
  const [templateMode,   setTemplateMode]   = useState(false)
  const [bulkForm,       setBulkForm]       = useState({
    fromDate:    '',
    toDate:      '',
    shiftId:     '',
    selectAll:   false,
  })
  const [bulkSelected,       setBulkSelected]       = useState<Set<string>>(new Set())
  const [actionKey,          setActionKey]           = useState<string | null>(null)
  const [bulkLoading,        setBulkLoading]         = useState(false)
  const [bulkError,          setBulkError]           = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templatePreviewOpen, setTemplatePreviewOpen] = useState(false)
  const [csvPreview,    setCsvPreview]    = useState<CsvPreviewState | null>(null)
  const [csvUploading,  setCsvUploading]  = useState(false)
  const [csvResult,     setCsvResult]     = useState<{ inserted: number; errors: Array<{ line: number; message: string }> } | null>(null)
  const [forensicsTarget, setForensicsTarget] = useState<{
    employeeId: string; date: string; employeeName?: string
  } | null>(null)

  const queryClient = useQueryClient()

  // Auto-dismiss CSV result banner after 6 seconds
  useEffect(() => {
    if (!csvResult) return
    const t = setTimeout(() => setCsvResult(null), 6_000)
    return () => clearTimeout(t)
  }, [csvResult])

  const year     = viewDate.getFullYear()
  const month    = viewDate.getMonth()
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthLabel = (() => { const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${_M[month]}-${year}` })()
  const days       = allDaysInMonth(year, month)
  const todayStr   = new Date().toISOString().slice(0, 10)
  const weekPresets = buildWeekPresets(year, month)

  // ── Period lock ────────────────────────────────────────────────────────────
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(monthStr)

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<RosterData>({
    queryKey: ['roster', monthStr],
    queryFn:  () => api.get<RosterData>(`/attendance/roster?month=${monthStr}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: templatesData } = useQuery<{ data: RosterTemplate[] }>({
    queryKey: ['roster-templates'],
    queryFn:  () => api.get<{ data: RosterTemplate[] }>('/masters/rosters'),
    enabled:  isAdmin,
    staleTime: 300_000,
  })
  const rosterTemplates = templatesData?.data ?? []

  // ── Derived lookup maps ────────────────────────────────────────────────────
  const rosterMap = new Map<string, RosterRow>(
    (data?.roster ?? []).map((r) => [`${r.employee_id}:${r.date}`, r])
  )
  const standingMap = new Map<string, string>(
    (data?.standing ?? []).map((s) => [s.employee_id, s.shift_id])
  )
  // Rotation-resolved master shift per employee/day (roster-based employees).
  const masterByDay = data?.master_by_day ?? {}
  const restByDay   = data?.rest_by_day ?? {}
  const masterShiftFor = (empId: string, date: string): string | undefined =>
    standingMap.get(empId) ?? masterByDay[empId]?.[date]
  const isRestDay = (empId: string, date: string): boolean => !!restByDay[empId]?.[date]
  const shiftMap = new Map<string, Shift>(
    (data?.shifts ?? []).map((s) => [s.id, s])
  )
  const allEmployees = data?.employees ?? []
  const shifts       = data?.shifts    ?? []

  // Filter employees by location
  const employees = locationFilter
    ? allEmployees.filter(e => e.work_location?.id === locationFilter)
    : allEmployees

  // Unique locations from roster data
  const locations: WorkLocation[] = Array.from(
    new Map(
      allEmployees
        .filter(e => e.work_location)
        .map(e => [e.work_location!.id, e.work_location!])
    ).values()
  )

  // ── Coverage analytics ─────────────────────────────────────────────────────
  // For each date: how many visible employees have any shift assigned.
  // Used for staffing-gap indicators in day headers and the summary row.
  const coverageByDate = new Map<string, number>()
  for (const d of days) {
    let assigned = 0
    for (const emp of employees) {
      const rosterRow        = rosterMap.get(`${emp.id}:${d}`)
      const effectiveShiftId = rosterRow?.shift_id ?? masterShiftFor(emp.id, d)
      if (effectiveShiftId) assigned++
    }
    coverageByDate.set(d, assigned)
  }

  // Dates with zero assigned employees (excluding weekends)
  const gapDays = employees.length > 0
    ? days.filter((d) => {
        const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
        const isWeekend = dow === 0 || dow === 6
        return !isWeekend && (coverageByDate.get(d) ?? 0) === 0
      })
    : []

  // ── Coverage intelligence: month-level stats ───────────────────────────────
  const workdays = days.filter((d) => {
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
    return dow !== 0 && dow !== 6
  })
  const totalEmp     = employees.length
  const fullCovCount = totalEmp > 0
    ? workdays.filter((d) => (coverageByDate.get(d) ?? 0) === totalEmp).length
    : 0
  const partialCount = totalEmp > 0
    ? workdays.filter((d) => {
        const n = coverageByDate.get(d) ?? 0
        return n > 0 && n < totalEmp
      }).length
    : 0
  const overallCovPct = workdays.length > 0 && totalEmp > 0
    ? Math.round(
        workdays.reduce((sum, d) => sum + (coverageByDate.get(d) ?? 0), 0)
        / (workdays.length * totalEmp)
        * 100,
      )
    : 0

  // ── Fatigue analysis: employees with > 5 consecutive assigned days ─────────
  interface FatigueWarning {
    employee: Employee
    streak:   number
    from:     string
    to:       string
  }
  const fatigueWarnings: FatigueWarning[] = []
  if (employees.length > 0 && days.length > 0) {
    for (const emp of employees) {
      let cur = 0; let streakStart = ''; let maxStreak = 0
      let maxFrom = ''; let maxTo = ''
      for (const d of days) {
        const rKey  = `${emp.id}:${d}`
        const hasShift = !!(rosterMap.get(rKey)?.shift_id ?? masterShiftFor(emp.id, d))
        if (hasShift) {
          if (cur === 0) streakStart = d
          cur++
          if (cur > maxStreak) { maxStreak = cur; maxFrom = streakStart; maxTo = d }
        } else {
          cur = 0
        }
      }
      if (maxStreak > 5) fatigueWarnings.push({ employee: emp, streak: maxStreak, from: maxFrom, to: maxTo })
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const assignMutation = useMutation({
    mutationFn: (payload: { employee_id: string; date: string; shift_id: string }) =>
      api.post<{ data: RosterRow }>('/attendance/roster/assign', payload),
    onMutate: (v) => setActionKey(`${v.employee_id}:${v.date}`),
    onSettled: () => {
      setActionKey(null)
      queryClient.invalidateQueries({ queryKey: ['roster', monthStr] })
    },
    onError: (e: Error) => toast.error('Failed to assign shift', { description: e.message }),
  })

  const clearMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/roster/${id}`),
    onSettled: () => {
      setActionKey(null)
      queryClient.invalidateQueries({ queryKey: ['roster', monthStr] })
    },
    onError: (e: Error) => toast.error('Failed to clear shift override', { description: e.message }),
  })

  async function handleBulkApply() {
    if (!bulkForm.shiftId || bulkSelected.size === 0 || !bulkForm.fromDate || !bulkForm.toDate) {
      setBulkError('Select employees, a date range, and a shift.')
      return
    }
    setBulkLoading(true)
    setBulkError('')
    try {
      await api.post('/attendance/roster/bulk', {
        employee_ids: [...bulkSelected],
        from_date:    bulkForm.fromDate,
        to_date:      bulkForm.toDate,
        shift_id:     bulkForm.shiftId,
      })
      queryClient.invalidateQueries({ queryKey: ['roster', monthStr] })
      setBulkMode(false)
      setBulkSelected(new Set())
      setBulkForm({ fromDate: '', toDate: '', shiftId: '', selectAll: false })
    } catch (e: unknown) {
      setBulkError((e as Error).message ?? 'Bulk assign failed')
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleCopyPrevWeek() {
    if (bulkSelected.size === 0) {
      setBulkError('Select at least one employee to copy shifts for.')
      return
    }
    if (!bulkForm.fromDate) {
      setBulkError('Select a "From" date first to identify the target week.')
      return
    }
    // Rewind to Monday of the week containing fromDate
    const targetMon = new Date(`${bulkForm.fromDate}T12:00:00.000Z`)
    while (targetMon.getUTCDay() !== 1) targetMon.setUTCDate(targetMon.getUTCDate() - 1)
    const toWeekStart   = targetMon.toISOString().slice(0, 10)
    const fromWeekStart = shiftDate(toWeekStart, -7)

    setBulkLoading(true)
    setBulkError('')
    try {
      const result = await api.post<{ message: string; rows_copied: number }>(
        '/attendance/roster/copy-week',
        {
          from_week_start: fromWeekStart,
          to_week_start:   toWeekStart,
          employee_ids:    [...bulkSelected],
        },
      )
      queryClient.invalidateQueries({ queryKey: ['roster', monthStr] })
      if (result.rows_copied === 0) {
        setBulkError('No roster overrides found in the previous week to copy.')
      }
    } catch (e: unknown) {
      setBulkError((e as Error).message ?? 'Copy failed')
    } finally {
      setBulkLoading(false)
    }
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  /** Expand a template's pattern across [fromDate, toDate] and return work-day dates. */
  function expandTemplateWorkDays(template: RosterTemplate, fromDate: string, toDate: string): string[] {
    const offDays = new Set(template.pattern_json.weekly_off_days ?? [])
    const result: string[] = []
    const cur = new Date(`${fromDate}T12:00:00.000Z`)
    const end = new Date(`${toDate}T12:00:00.000Z`)
    while (cur <= end) {
      const dow = cur.getUTCDay()  // 0=Sun…6=Sat
      if (!offDays.has(dow)) result.push(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return result
  }

  async function handleApplyTemplate() {
    const template = rosterTemplates.find(t => t.id === selectedTemplateId)
    if (!template) { setBulkError('Select a roster template.'); return }
    if (!bulkForm.shiftId) { setBulkError('Select a shift for work days.'); return }
    if (bulkSelected.size === 0) { setBulkError('Select at least one employee.'); return }
    if (!bulkForm.fromDate || !bulkForm.toDate) { setBulkError('Select a date range.'); return }

    setBulkLoading(true)
    setBulkError('')
    try {
      const workDays = expandTemplateWorkDays(template, bulkForm.fromDate, bulkForm.toDate)
      if (workDays.length === 0) {
        setBulkError('No work days in the selected range (all days are weekly-off for this template).')
        return
      }
      // Assign the shift for each employee × each work day using the bulk endpoint.
      // Split into chunks by date range segments isn't needed — /bulk accepts employee_ids + from/to + shift_id.
      // Since we need to skip off days, we make one call per contiguous work-day segment,
      // or alternatively assign day-by-day.  For simplicity, assign all at once but only
      // for work days by calling the bulk endpoint once per work-day date.
      // Better: /bulk assigns ALL days in range.  We instead call assign for each work day individually
      // if the range has off-days, or call /bulk for the full range if no off-days.
      // Assign the selected shift to every work day individually.
      // Using one call per work day keeps the logic simple and correct
      // regardless of how many weekly-off gaps exist in the template.
      await Promise.all(
        workDays.map((workDay) =>
          api.post('/attendance/roster/bulk', {
            employee_ids: [...bulkSelected],
            from_date:    workDay,
            to_date:      workDay,
            shift_id:     bulkForm.shiftId,
          }),
        ),
      )

      queryClient.invalidateQueries({ queryKey: ['roster', monthStr] })
      setTemplatePreviewOpen(false)
      setTemplateMode(false)
      setBulkSelected(new Set())
      setBulkForm({ fromDate: '', toDate: '', shiftId: '', selectAll: false })
      setSelectedTemplateId('')
    } catch (e: unknown) {
      setBulkError((e as Error).message ?? 'Template apply failed')
    } finally {
      setBulkLoading(false)
    }
  }

  // Preview rows: [employee name, date, day-type]
  interface TemplatePreviewEntry {
    date:    string
    dow:     number
    isOff:   boolean
  }

  function buildTemplatePreview(): TemplatePreviewEntry[] {
    const template = rosterTemplates.find(t => t.id === selectedTemplateId)
    if (!template || !bulkForm.fromDate || !bulkForm.toDate) return []
    const offDays = new Set(template.pattern_json.weekly_off_days ?? [])
    const entries: TemplatePreviewEntry[] = []
    const cur = new Date(`${bulkForm.fromDate}T12:00:00.000Z`)
    const end = new Date(`${bulkForm.toDate}T12:00:00.000Z`)
    while (cur <= end) {
      const dow = cur.getUTCDay()
      entries.push({ date: cur.toISOString().slice(0, 10), dow, isOff: offDays.has(dow) })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return entries
  }

  function toggleBulkEmployee(id: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── CSV upload — parse → preview dialog → confirm → send ──────────────────
  const csvInputRef = useRef<HTMLInputElement>(null)

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setCsvResult(null)
    setCsvPreview(parseCsvPreview(text))
    e.target.value = ''   // reset so the same file can be re-selected
  }

  async function confirmCsvUpload() {
    if (!csvPreview) return
    setCsvUploading(true)
    try {
      const result = await api.post<{ rows_inserted: number; errors: Array<{ line: number; message: string }> }>(
        '/attendance/roster/csv',
        { csv_content: csvPreview.raw, allow_partial: false },
      )
      queryClient.invalidateQueries({ queryKey: ['roster', monthStr] })
      setCsvResult({ inserted: result.rows_inserted, errors: result.errors ?? [] })
      setCsvPreview(null)   // close preview, show result
    } catch (err: unknown) {
      // 422 VALIDATION_ERRORS: backend returns structured errors
      const apiErr = err as { message?: string; errors?: Array<{ line: number; message: string }> }
      setCsvResult({
        inserted: 0,
        errors:   apiErr.errors ?? [{ line: 0, message: apiErr.message ?? 'Upload failed' }],
      })
      setCsvPreview(null)
    } finally {
      setCsvUploading(false)
    }
  }

  function toggleSelectAll() {
    if (bulkSelected.size === employees.length) {
      setBulkSelected(new Set())
      setBulkForm((p) => ({ ...p, selectAll: false }))
    } else {
      setBulkSelected(new Set(employees.map((e) => e.id)))
      setBulkForm((p) => ({ ...p, selectAll: true }))
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Shift & Roster', href: '/admin/shift-master' }, { label: 'Roster Planner' }]}
        title="Roster Planner"
        subtitle="Date-specific shift overrides — on top of each employee's master assignment"
      />

      {isAdmin && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
          <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <span>
            Cells already reflect each employee's <span className="font-medium text-foreground">master shift</span>
            {' '}(set on their profile → Shift &amp; Roster). You only need this planner to <span className="font-medium text-foreground">override a specific day</span> —
            rotating shifts or one-off changes. For a fixed daily shift, nothing needs to be assigned here; the master drives attendance.
          </span>
        </div>
      )}

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can manage shift rosters.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <div className="space-y-4">
          {/* ── Bulk assign panel ─────────────────────────────────────────── */}
          {bulkMode && (
            <SectionCard
              title="Bulk Assignment"
              icon={<Users className="h-4 w-4 text-muted-foreground" />}
              action={
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBulkMode(false)}>
                  Cancel
                </Button>
              }
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Employee selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Employees ({bulkSelected.size}/{employees.length})
                    </p>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={toggleSelectAll}
                    >
                      {bulkSelected.size === employees.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {employees.map((emp) => (
                      <label key={emp.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(emp.id)}
                          onChange={() => toggleBulkEmployee(emp.id)}
                          className="accent-primary"
                        />
                        <span className="text-xs text-foreground group-hover:text-primary transition-colors">
                          {emp.name}
                          <span className="text-muted-foreground ml-1">({emp.employee_code})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Date range + week presets */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Date Range
                  </p>

                  {/* Week preset buttons */}
                  {weekPresets.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {weekPresets.map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setBulkForm(p => ({ ...p, fromDate: preset.from, toDate: preset.to }))}
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded border border-border bg-muted/30',
                            'hover:bg-muted text-muted-foreground hover:text-foreground transition-colors',
                            bulkForm.fromDate === preset.from && bulkForm.toDate === preset.to &&
                              'border-primary/40 bg-primary/10 text-primary',
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground">From</label>
                      <DateInput
                        className="h-8 text-xs mt-0.5"
                        value={bulkForm.fromDate}
                        min={monthStart(year, month)}
                        max={monthEnd(year, month)}
                        onChange={(v) => setBulkForm((p) => ({ ...p, fromDate: v }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">To</label>
                      <DateInput
                        className="h-8 text-xs mt-0.5"
                        value={bulkForm.toDate}
                        min={bulkForm.fromDate || monthStart(year, month)}
                        max={monthEnd(year, month)}
                        onChange={(v) => setBulkForm((p) => ({ ...p, toDate: v }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Shift selection + apply */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Shift
                  </p>
                  <select
                    className="w-full h-8 text-xs rounded-md border border-input bg-card text-foreground px-2 outline-none focus:ring-2 ring-primary/50"
                    value={bulkForm.shiftId}
                    onChange={(e) => setBulkForm((p) => ({ ...p, shiftId: e.target.value }))}
                  >
                    <option value="">Select shift…</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({fmtTime(s.start_time)}–{fmtTime(s.end_time)})
                      </option>
                    ))}
                  </select>

                  {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}

                  <Button
                    className="w-full h-8 text-xs"
                    disabled={bulkLoading || bulkSelected.size === 0 || periodLocked}
                    onClick={handleBulkApply}
                  >
                    {bulkLoading
                      ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Applying…</>
                      : `Assign to ${bulkSelected.size} employee${bulkSelected.size !== 1 ? 's' : ''}`}
                  </Button>

                  {/* Copy previous week */}
                  <Button
                    variant="outline"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={bulkLoading || bulkSelected.size === 0}
                    onClick={handleCopyPrevWeek}
                    title="Copy roster overrides from the previous week to the week containing the 'From' date"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Previous Week
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}

          {/* ── Apply Template panel ──────────────────────────────────────── */}
          {templateMode && (
            <SectionCard
              title="Apply Roster Template"
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
              action={
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTemplateMode(false)}>
                  Cancel
                </Button>
              }
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Employee selection — same as bulk panel */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Employees ({bulkSelected.size}/{employees.length})
                    </p>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={toggleSelectAll}
                    >
                      {bulkSelected.size === employees.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {employees.map((emp) => (
                      <label key={emp.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(emp.id)}
                          onChange={() => toggleBulkEmployee(emp.id)}
                          className="accent-primary"
                        />
                        <span className="text-xs text-foreground group-hover:text-primary transition-colors">
                          {emp.name}
                          <span className="text-muted-foreground ml-1">({emp.employee_code})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Template + date range */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Template
                    </p>
                    {rosterTemplates.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        No roster templates found. Create templates in Masters → Roster Templates.
                      </p>
                    ) : (
                      <select
                        className="w-full h-8 text-xs rounded-md border border-input bg-card text-foreground px-2 outline-none focus:ring-2 ring-primary/50"
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                      >
                        <option value="">Select template…</option>
                        {rosterTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.cycle_days}-day cycle)
                          </option>
                        ))}
                      </select>
                    )}
                    {selectedTemplateId && (() => {
                      const t = rosterTemplates.find(r => r.id === selectedTemplateId)
                      if (!t) return null
                      const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                      const offNames  = (t.pattern_json.weekly_off_days ?? []).map(d => DOW_NAMES[d]).join(', ')
                      return (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Weekly off: {offNames || 'none'}
                        </p>
                      )
                    })()}
                  </div>

                  {/* Week presets + date range */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Date Range
                    </p>
                    {weekPresets.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {weekPresets.map(preset => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setBulkForm(p => ({ ...p, fromDate: preset.from, toDate: preset.to }))}
                            className={cn(
                              'text-[10px] px-2 py-0.5 rounded border border-border bg-muted/30',
                              'hover:bg-muted text-muted-foreground hover:text-foreground transition-colors',
                              bulkForm.fromDate === preset.from && bulkForm.toDate === preset.to &&
                                'border-primary/40 bg-primary/10 text-primary',
                            )}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-muted-foreground">From</label>
                        <DateInput
                          className="h-8 text-xs mt-0.5"
                          value={bulkForm.fromDate}
                          min={monthStart(year, month)}
                          max={monthEnd(year, month)}
                          onChange={(v) => setBulkForm((p) => ({ ...p, fromDate: v }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">To</label>
                        <DateInput
                          className="h-8 text-xs mt-0.5"
                          value={bulkForm.toDate}
                          min={bulkForm.fromDate || monthStart(year, month)}
                          max={monthEnd(year, month)}
                          onChange={(v) => setBulkForm((p) => ({ ...p, toDate: v }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Shift + preview + apply */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Shift for Work Days
                    </p>
                    <select
                      className="w-full h-8 text-xs rounded-md border border-input bg-card text-foreground px-2 outline-none focus:ring-2 ring-primary/50"
                      value={bulkForm.shiftId}
                      onChange={(e) => setBulkForm((p) => ({ ...p, shiftId: e.target.value }))}
                    >
                      <option value="">Select shift…</option>
                      {shifts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({fmtTime(s.start_time)}–{fmtTime(s.end_time)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}

                  <Button
                    variant="outline"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={!selectedTemplateId || !bulkForm.fromDate || !bulkForm.toDate || !bulkForm.shiftId || bulkSelected.size === 0}
                    onClick={() => setTemplatePreviewOpen(true)}
                  >
                    Preview Schedule
                  </Button>

                  <Button
                    className="w-full h-8 text-xs"
                    disabled={bulkLoading || !selectedTemplateId || !bulkForm.shiftId || bulkSelected.size === 0 || !bulkForm.fromDate || !bulkForm.toDate}
                    onClick={handleApplyTemplate}
                  >
                    {bulkLoading
                      ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Applying…</>
                      : `Apply to ${bulkSelected.size} employee${bulkSelected.size !== 1 ? 's' : ''}`}
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}

          {/* ── Roster grid ────────────────────────────────────────────────── */}
          <SectionCard
            title={monthLabel}
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-1.5">
                {/* Location filter */}
                {locations.length > 0 && (
                  <select
                    value={locationFilter}
                    onChange={e => setLocationFilter(e.target.value)}
                    className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                  >
                    <option value="">All Locations</option>
                    {locations.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                )}
                <div className="w-px h-4 bg-border" />
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { setBulkMode((v) => !v); setTemplateMode(false) }}>
                  <Users className="h-3.5 w-3.5" />
                  Bulk Assign
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { setTemplateMode((v) => !v); setBulkMode(false) }}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  Apply Template
                </Button>
                <div className="w-px h-4 bg-border mx-0.5" />
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => setViewDate(new Date(year, month - 1, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => setViewDate(new Date(year, month + 1, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvUpload}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Upload roster CSV (columns: employee_code,date,shift_code)"
                  onClick={() => csvInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
          >
            {/* Period lock banner */}
            {periodState !== 'OPEN' && (
              <div className="px-4 pt-3 pb-0">
                <PeriodLockBanner state={periodState} month={monthStr} />
              </div>
            )}

            {isLoading && (
              <div className="overflow-x-auto -mx-1 px-4 pb-4">
                <div className="space-y-1 pt-3">
                  {/* Header skeleton */}
                  <div className="flex gap-0.5">
                    <div className="min-w-[160px] h-8 rounded bg-muted animate-pulse" />
                    {Array.from({ length: 15 }).map((_, i) => (
                      <div key={i} className="w-[52px] h-8 rounded bg-muted/60 animate-pulse" />
                    ))}
                  </div>
                  {/* Row skeletons */}
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex gap-0.5">
                      <div className="min-w-[160px] h-[46px] rounded bg-muted/40 animate-pulse" />
                      {Array.from({ length: 15 }).map((_, j) => (
                        <div key={j} className="w-[52px] h-[46px] rounded bg-muted/30 animate-pulse" />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isError && (
              <div className="flex flex-col items-center gap-2 py-12">
                <p className="text-sm text-destructive">Failed to load roster data</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
              </div>
            )}
            {!isLoading && !isError && (
              <>
                {employees.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    {locationFilter ? 'No employees at this location.' : 'No active employees found.'}
                  </p>
                )}
                {employees.length > 0 && (
                  <>
                  {/* ── Coverage Intelligence Panel ──────────────────────── */}
                  <div className="mb-3 space-y-2">
                    {/* Month stats bar */}
                    <div className="flex flex-wrap items-center gap-3 px-1 py-2 rounded-md bg-muted/30 border border-border/50 text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <BarChart3 className="h-3.5 w-3.5" />
                        <span className="font-semibold text-foreground">Coverage Intelligence</span>
                      </div>
                      <div className="w-px h-4 bg-border hidden sm:block" />
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Work days:</span>
                        <span className="font-medium text-foreground tabular-nums">{workdays.length}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-success/60" />
                        <span className="text-muted-foreground">Full:</span>
                        <span className="font-medium text-success tabular-nums">{fullCovCount}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-warning/60" />
                        <span className="text-muted-foreground">Partial:</span>
                        <span className="font-medium text-warning tabular-nums">{partialCount}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-sm bg-destructive/60" />
                        <span className="text-muted-foreground">Gaps:</span>
                        <span className="font-medium text-destructive tabular-nums">{gapDays.length}</span>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Overall:</span>
                        <span className={cn(
                          'font-semibold tabular-nums',
                          overallCovPct === 100 ? 'text-success'
                          : overallCovPct >= 75  ? 'text-success/80'
                          : overallCovPct >= 50  ? 'text-warning'
                          : 'text-destructive',
                        )}>
                          {overallCovPct}%
                        </span>
                      </div>
                    </div>

                    {/* Fatigue warnings */}
                    {fatigueWarnings.length > 0 && (
                      <div className="flex flex-wrap items-start gap-2 rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs">
                        <div className="flex items-center gap-1.5 text-warning font-semibold flex-shrink-0">
                          <Flame className="h-3.5 w-3.5" />
                          Fatigue risk — {fatigueWarnings.length} employee{fatigueWarnings.length !== 1 ? 's' : ''} with {'>'}5 consecutive days:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {fatigueWarnings.map(fw => (
                            <span
                              key={fw.employee.id}
                              title={`${fw.streak} consecutive days (${fw.from} → ${fw.to})`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-warning/15 text-warning border border-warning/20 text-[10px] font-medium cursor-default"
                            >
                              {fw.employee.name}
                              <span className="opacity-70 ml-0.5">{fw.streak}d</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto -mx-1">
                    <table className="text-xs border-separate border-spacing-0">
                      <thead>
                        <tr>
                          {/* Sticky employee column header */}
                          <th className="sticky left-0 z-20 bg-card border-b border-border text-left px-3 py-2 min-w-[160px] max-w-[200px] whitespace-nowrap text-muted-foreground font-semibold shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                            Employee
                          </th>
                          {/* Day headers */}
                          {days.map((d) => {
                            const dow       = new Date(`${d}T12:00:00.000Z`).getUTCDay()
                            const isWeekend = dow === 0 || dow === 6
                            const isToday   = d === todayStr
                            const assigned  = coverageByDate.get(d) ?? 0
                            const total     = employees.length
                            // Coverage chip: destructive = 0, warning = <50%, success = ≥50%
                            const chipCls   = total === 0 || isWeekend
                              ? ''
                              : assigned === 0
                                ? 'bg-destructive/20 text-destructive'
                                : assigned < total / 2
                                  ? 'bg-warning/20 text-warning'
                                  : 'bg-success/10 text-success'
                            return (
                              <th
                                key={d}
                                title={total > 0 && !isWeekend ? `${assigned}/${total} employees assigned` : undefined}
                                className={cn(
                                  'border-b border-border text-center py-1.5 w-[52px] min-w-[52px]',
                                  isWeekend ? 'text-muted-foreground/60 bg-muted/30' : 'text-muted-foreground',
                                  isToday   && 'text-primary font-bold bg-primary/5',
                                )}
                              >
                                <div>{String(new Date(`${d}T12:00:00Z`).getUTCDate())}</div>
                                <div className="text-[9px] font-normal">{DOW_SHORT[dow]}</div>
                                {/* Coverage chip */}
                                {total > 0 && !isWeekend && (
                                  <div className={cn('text-[8px] mt-0.5 rounded-sm px-0.5 leading-tight tabular-nums', chipCls)}>
                                    {assigned}/{total}
                                  </div>
                                )}
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {employees.map((emp, eIdx) => (
                          <tr
                            key={emp.id}
                            className={cn(eIdx % 2 === 0 ? 'bg-card' : 'bg-muted/20', 'hover:bg-primary/[0.04] transition-colors group')}
                          >
                            {/* Sticky employee name cell */}
                            <td className={cn(
                              'sticky left-0 z-10 border-b border-border/50 px-3 py-1.5 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
                              eIdx % 2 === 0 ? 'bg-card' : 'bg-muted/20',
                              'group-hover:bg-primary/[0.04]',
                            )}>
                              <div className="flex items-center gap-1.5">
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground leading-tight truncate max-w-[160px]">
                                    {emp.name}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">{emp.employee_code}</p>
                                </div>
                                <button
                                  className="opacity-0 group-hover:opacity-100 h-5 w-5 rounded flex-shrink-0 text-info hover:bg-info/10 flex items-center justify-center transition-opacity"
                                  title={`View ${emp.name}'s attendance timeline`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setForensicsTarget({ employeeId: emp.id, date: todayStr, employeeName: emp.name })
                                  }}
                                >
                                  <GitBranch className="h-3 w-3" />
                                </button>
                              </div>
                            </td>

                            {/* Day cells */}
                            {days.map((d) => {
                              const key        = `${emp.id}:${d}`
                              const rosterRow  = rosterMap.get(key)
                              const effectiveShiftId = rosterRow?.shift_id ?? masterShiftFor(emp.id, d)
                              const shift      = effectiveShiftId ? (shiftMap.get(effectiveShiftId) ?? null) : null
                              const isOverride = !!rosterRow
                              const isBusy     = actionKey === key
                              const dow        = new Date(`${d}T12:00:00.000Z`).getUTCDay()
                              const isWeekend  = dow === 0 || dow === 6
                              const isToday    = d === todayStr

                              return (
                                <td
                                  key={d}
                                  className={cn(
                                    'border-b border-border/50 px-0.5 py-1.5 text-center align-middle',
                                    isWeekend && 'bg-muted/15',
                                    isToday   && 'bg-primary/5',
                                  )}
                                >
                                  <RosterCell
                                    shift={shift}
                                    isOverride={isOverride}
                                    isRest={!shift && isRestDay(emp.id, d)}
                                    shifts={shifts}
                                    loading={isBusy}
                                    readOnly={periodLocked}
                                    onAssign={(sid) => {
                                      setActionKey(key)
                                      assignMutation.mutate({ employee_id: emp.id, date: d, shift_id: sid })
                                    }}
                                    onClear={() => {
                                      if (rosterRow) {
                                        setActionKey(key)
                                        clearMutation.mutate(rosterRow.id)
                                      }
                                    }}
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>

                      {/* Coverage summary footer */}
                      <tfoot>
                        <tr className="bg-muted/40 border-t border-border">
                          <td className={cn(
                            'sticky left-0 z-10 bg-muted/40 px-3 py-1 text-[10px] font-semibold text-muted-foreground',
                            'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
                          )}>
                            Coverage
                          </td>
                          {days.map((d) => {
                            const dow       = new Date(`${d}T12:00:00.000Z`).getUTCDay()
                            const isWeekend = dow === 0 || dow === 6
                            const assigned  = coverageByDate.get(d) ?? 0
                            const total     = employees.length
                            if (isWeekend || total === 0) {
                              return (
                                <td key={d} className="text-center px-0.5 py-1 text-[9px] text-muted-foreground/40">—</td>
                              )
                            }
                            const pct    = Math.round((assigned / total) * 100)
                            const cellCls = assigned === 0
                              ? 'text-destructive font-semibold'
                              : assigned < total / 2
                                ? 'text-warning'
                                : 'text-success'
                            return (
                              <td
                                key={d}
                                title={`${assigned}/${total} assigned (${pct}%)`}
                                className={cn('text-center px-0.5 py-1 text-[9px] tabular-nums', cellCls)}
                              >
                                {assigned === total ? '✓' : `${pct}%`}
                              </td>
                            )
                          })}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  </>
                )}

                {/* Staffing gap alert */}
                {gapDays.length > 0 && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Staffing gaps detected:</span>
                      {' '}no employees assigned on{' '}
                      {gapDays.slice(0, 5).map((d, i) => (
                        <span key={d}>
                          {i > 0 && ', '}
                          {(() => { const _d = new Date(`${d}T12:00:00Z`); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` })()}
                        </span>
                      ))}
                      {gapDays.length > 5 && ` and ${gapDays.length - 5} more`}.
                    </div>
                  </div>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-7 h-4 rounded bg-muted/50 border border-dashed border-border" />
                    From master (standing shift)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-7 h-4 rounded bg-primary/15 ring-1 ring-primary/30" />
                    Day override
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-7 h-4 rounded border border-dashed border-border" />
                    No shift assigned
                  </span>
                  <span className="ml-auto text-[10px]">
                    Cells pre-fill from the employee's master shift — click only to override a specific day
                  </span>
                </div>

                {/* Shift key */}
                {shifts.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Shift Key</p>
                    <div className="flex flex-wrap gap-1.5">
                      {shifts.map((s) => (
                        <Badge key={s.id} variant="outline" className="text-[10px] font-mono rounded-sm">
                          {s.code || s.name.slice(0, 4)} — {s.name} ({fmtTime(s.start_time)}–{fmtTime(s.end_time)})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>
      )}
      {/* ── CSV Upload result banner ──────────────────────────────────── */}
      {csvResult && (
        <div className={cn(
          'fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border p-4 shadow-lg text-sm',
          csvResult.errors.length === 0
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-destructive/10 border-destructive/30 text-destructive',
        )}>
          <div className="flex items-start gap-2">
            {csvResult.errors.length === 0
              ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              {csvResult.inserted > 0 && (
                <p className="font-medium">{csvResult.inserted} roster row{csvResult.inserted !== 1 ? 's' : ''} uploaded</p>
              )}
              {csvResult.errors.length > 0 && (
                <>
                  <p className="font-medium">{csvResult.errors.length} validation error{csvResult.errors.length !== 1 ? 's' : ''} — nothing inserted</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {csvResult.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e.line > 0 ? `Row ${e.line}: ` : ''}{e.message}</li>
                    ))}
                    {csvResult.errors.length > 5 && <li>…and {csvResult.errors.length - 5} more</li>}
                  </ul>
                </>
              )}
            </div>
            <button type="button" className="text-current opacity-60 hover:opacity-100 ml-1" onClick={() => setCsvResult(null)}>✕</button>
          </div>
        </div>
      )}

      {/* ── Template Preview Dialog ──────────────────────────────────── */}
      <Dialog open={templatePreviewOpen} onOpenChange={(o) => { if (!o && !bulkLoading) setTemplatePreviewOpen(false) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Template Preview
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const template  = rosterTemplates.find(t => t.id === selectedTemplateId)
            const entries   = buildTemplatePreview()
            const shift     = shifts.find(s => s.id === bulkForm.shiftId)
            const workCount = entries.filter(e => !e.isOff).length
            const offCount  = entries.filter(e => e.isOff).length
            const DOW_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            return (
              <>
                {template && (
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Template: <strong className="text-foreground">{template.name}</strong></span>
                    {shift && <span>Shift: <strong className="text-foreground">{shift.name}</strong></span>}
                    <span className="text-success">{workCount} work day{workCount !== 1 ? 's' : ''}</span>
                    <span className="text-muted-foreground">{offCount} day{offCount !== 1 ? 's' : ''} off</span>
                    <span>{bulkSelected.size} employee{bulkSelected.size !== 1 ? 's' : ''}</span>
                  </div>
                )}

                <div className="overflow-auto max-h-72 rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {['Date', 'Day', 'Type', 'Shift'].map((h) => (
                          <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground border-b border-border">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr
                          key={entry.date}
                          className={cn(
                            'border-b border-border/50 last:border-0',
                            entry.isOff && 'opacity-50',
                          )}
                        >
                          <td className="px-3 py-1.5 font-mono">{entry.date}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{DOW_SHORT_NAMES[entry.dow]}</td>
                          <td className="px-3 py-1.5">
                            {entry.isOff
                              ? <Badge variant="secondary" className="text-[10px] rounded-full">Off</Badge>
                              : <Badge variant="success" className="text-[10px] rounded-full">Work</Badge>}
                          </td>
                          <td className="px-3 py-1.5">
                            {entry.isOff
                              ? <span className="text-muted-foreground">—</span>
                              : shift
                                ? <span className="font-medium">{shift.name}</span>
                                : <span className="text-muted-foreground italic">No shift selected</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Work days will be assigned the selected shift. Off days will not receive a roster entry.
                  Existing overrides on those dates will remain unchanged.
                </p>
              </>
            )
          })()}

          <DialogFooter>
            <Button variant="outline" className="h-8 text-xs" onClick={() => setTemplatePreviewOpen(false)} disabled={bulkLoading}>
              Back
            </Button>
            <Button
              className="h-8 text-xs"
              disabled={bulkLoading}
              onClick={handleApplyTemplate}
            >
              {bulkLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Applying…</>
                : `Apply to ${bulkSelected.size} employee${bulkSelected.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CSV Preview Dialog ────────────────────────────────────────── */}
      <Dialog open={!!csvPreview} onOpenChange={(o) => { if (!o && !csvUploading) setCsvPreview(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Upload className="h-4 w-4 text-muted-foreground" />
              CSV Preview — Shift Roster
            </DialogTitle>
          </DialogHeader>

          {csvPreview && (
            <>
              <p className="text-xs text-muted-foreground">
                {csvPreview.total > 20
                  ? `Showing first 20 of ${csvPreview.total} data rows. All rows will be validated server-side.`
                  : `${csvPreview.total} data row${csvPreview.total !== 1 ? 's' : ''} found.`}
              </p>

              {/* Client-side error summary */}
              {csvPreview.rows.some((r) => !r.valid) && (
                <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {csvPreview.rows.filter((r) => !r.valid).length} row(s) have format errors. Fix the CSV file and re-upload.
                </div>
              )}

              {/* Preview table */}
              <div className="overflow-auto max-h-72 rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      {['Row', 'Employee Code', 'Date', 'Shift Code', 'Status'].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground border-b border-border">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.rows.map((row) => (
                      <tr
                        key={row.line}
                        className={cn(
                          'border-b border-border/50 last:border-0',
                          !row.valid && 'bg-destructive/5',
                        )}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground">{row.line}</td>
                        <td className="px-3 py-1.5 font-mono">{row.employee_code || <span className="text-destructive italic">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono">{row.date || <span className="text-destructive italic">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono">{row.shift_code || <span className="text-destructive italic">—</span>}</td>
                        <td className="px-3 py-1.5">
                          {row.valid
                            ? <Badge variant="success" className="text-[10px] rounded-full">OK</Badge>
                            : <span className="text-destructive text-[10px]">{row.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Expected CSV format: <code className="font-mono bg-muted px-1 rounded">employee_code,date,shift_code</code> (header row required).
                Unknown codes will be reported as errors by the server.
              </p>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" className="h-8 text-xs" onClick={() => setCsvPreview(null)} disabled={csvUploading}>
              Cancel
            </Button>
            <Button
              className="h-8 text-xs"
              disabled={csvUploading || (csvPreview?.rows.some((r) => !r.valid) ?? false)}
              onClick={confirmCsvUpload}
            >
              {csvUploading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</>
                : `Upload ${csvPreview?.total ?? 0} row${(csvPreview?.total ?? 0) !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Forensics / Attendance Timeline Drawer ───────────────────── */}
      <ForensicsDrawer
        target={forensicsTarget}
        onClose={() => setForensicsTarget(null)}
      />
    </PageContainer>
  )
}
