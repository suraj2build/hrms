/**
 * MyAttendance — /ess/attendance
 *
 * Enterprise attendance workspace: 2-column operational layout.
 *   Left (~70%): monthly heatmap calendar with status colours
 *   Right (~30%): Today's Summary, Recent Regularisations, Quick Actions, Guidelines
 *
 * Data: GET /attendance/:id, GET /attendance/regularisation/my, GET /masters/holidays
 * All mutations: attendance/regularisation workflow only — no separate corrections engine.
 */

import { useState, useMemo, useCallback, type ReactNode } from 'react'
import { createPortal }           from 'react-dom'
import { useNavigate }            from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Clock, AlertTriangle, CalendarDays,
  Loader2, WifiOff, RefreshCw, Download, FileEdit,
  LogIn, LogOut, TrendingUp, Timer, X, Info,
  CalendarCheck, Gift, Coffee, PlaneTakeoff,
  List, SlidersHorizontal, ArrowRight, CheckCircle2,
  FileText, Scale, Zap, SearchX, ClipboardCheck,
} from 'lucide-react'
import { toast }                  from 'sonner'
import { Badge }                  from '@/components/ui/badge'
import { Button }                 from '@/components/ui/button'
import { Input }                  from '@/components/ui/input'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { api }                    from '@/lib/api/client'
import { useAuthStore }           from '@/stores/authStore'
import { cn }                     from '@/lib/utils'
import { usePeriodLock }          from '@/hooks/usePeriodLock'

// ── Types ──────────────────────────────────────────────────────────────────────

type DailyStatus =
  | 'present' | 'late' | 'absent' | 'half_day'
  | 'holiday' | 'weekend' | 'weekly_off' | 'leave'
  | 'missing_punch' | 'early_out' | 'lop'

interface DailyRecord {
  id:               string
  date:             string
  work_hours:       number
  late_minutes:     number
  overtime_minutes: number
  status:           DailyStatus
  shift_name?:      string
  remarks?:         string
}

interface LogEntry {
  id:        string
  check_in:  string | null
  check_out: string | null
}

interface HolidayEntry {
  id:          string
  date:        string
  name:        string
  is_optional: boolean
}

interface ShiftInfo {
  name:            string
  start_time:      string   // "HH:MM:SS"
  end_time:        string
  grace_minutes:   number
  weekly_off_days: number[] // 0=Sun..6=Sat
}

interface RegularisationRequest {
  id:                  string
  date:                string
  regularization_type: string | null
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  status:              'pending' | 'approved' | 'rejected' | 'withdrawn'
  rejection_reason:    string | null
  created_at:          string
}

interface AttendanceResponse {
  employee: { id: string; name: string; employee_code: string }
  range:    { from: string; to: string }
  summary:  {
    total_days:  number
    present:     number
    absent:      number
    late:        number
    avg_hours:   number
    total_hours: number
  }
  daily: DailyRecord[]
  logs:  LogEntry[]
}

// ── Status constants ───────────────────────────────────────────────────────────

const CELL_STYLE: Partial<Record<DailyStatus, string>> = {
  present:       'bg-success/25 text-success',
  late:          'bg-warning/28 text-warning',
  absent:        'bg-destructive/22 text-destructive',
  half_day:      'bg-muted/60 text-muted-foreground',
  holiday:       'bg-accent/30 text-accent-foreground',
  weekend:       'bg-muted/25 text-muted-foreground/35',
  weekly_off:    'bg-muted/25 text-muted-foreground/35',
  leave:         'bg-info/22 text-info',
  missing_punch: 'bg-destructive/18 text-destructive',
  early_out:     'bg-warning/20 text-warning',
  lop:           'bg-destructive/28 text-destructive',
}

// 3-D gradient fills for heatmap cells
const CELL_3D: Partial<Record<DailyStatus, { bg: string; color: string; shadow: string }>> = {
  present:       { bg: 'linear-gradient(160deg,#d6f1e2,#b6e6cb)', color: '#0a6d4a', shadow: '0 3px 8px -2px rgba(16,185,129,.35),inset 0 1px 0 rgba(255,255,255,.65)' },
  late:          { bg: 'linear-gradient(160deg,#ffe5b8,#ffd187)', color: '#835500', shadow: '0 3px 8px -2px rgba(245,158,11,.35),inset 0 1px 0 rgba(255,255,255,.65)' },
  absent:        { bg: 'linear-gradient(160deg,#ffd9df,#ffb7c1)', color: '#a8233b', shadow: '0 3px 8px -2px rgba(244,63,94,.30),inset 0 1px 0 rgba(255,255,255,.65)' },
  lop:           { bg: 'linear-gradient(160deg,#ffd9df,#ffb7c1)', color: '#a8233b', shadow: '0 3px 8px -2px rgba(244,63,94,.30),inset 0 1px 0 rgba(255,255,255,.65)' },
  missing_punch: { bg: 'linear-gradient(160deg,#ffe0e6,#ffc5ce)', color: '#a8233b', shadow: '0 2px 6px -2px rgba(244,63,94,.25),inset 0 1px 0 rgba(255,255,255,.55)' },
  leave:         { bg: 'linear-gradient(160deg,#cfe8f7,#a9d6ee)', color: '#0b5b7b', shadow: '0 3px 8px -2px rgba(14,165,233,.30),inset 0 1px 0 rgba(255,255,255,.65)' },
  holiday:       { bg: 'repeating-linear-gradient(135deg,#efe7ff,#efe7ff 6px,#e6dcfd 6px,#e6dcfd 10px)', color: '#5b3eb5', shadow: '0 2px 6px -2px rgba(139,92,246,.25),inset 0 1px 0 rgba(255,255,255,.55)' },
  weekend:       { bg: '#eef0f7', color: '#b0b3c6', shadow: 'none' },
  weekly_off:    { bg: '#eef0f7', color: '#b0b3c6', shadow: 'none' },
  half_day:      { bg: 'linear-gradient(160deg,#e5e7f0,#d8dae8)', color: '#6b7280', shadow: '0 2px 6px -2px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.55)' },
  early_out:     { bg: 'linear-gradient(160deg,#ffe5b8,#ffd187)', color: '#835500', shadow: '0 3px 8px -2px rgba(245,158,11,.30),inset 0 1px 0 rgba(255,255,255,.65)' },
}

const STATUS_LABEL: Partial<Record<DailyStatus, string>> = {
  present:       'Present',
  late:          'Late In',
  absent:        'Absent',
  half_day:      'Half Day',
  holiday:       'Holiday',
  weekend:       'Weekend',
  weekly_off:    'Weekly Off',
  leave:         'On Leave',
  missing_punch: 'Missing Punch',
  early_out:     'Early Out',
  lop:           'Loss of Pay',
}

const STATUS_BADGE: Partial<Record<DailyStatus, 'success' | 'warning' | 'destructive' | 'outline' | 'secondary'>> = {
  present:       'success',
  late:          'warning',
  absent:        'destructive',
  half_day:      'secondary',
  holiday:       'outline',
  weekend:       'outline',
  weekly_off:    'outline',
  leave:         'outline',
  missing_punch: 'warning',
  early_out:     'warning',
  lop:           'destructive',
}

const STATUS_CODE: Partial<Record<DailyStatus, string>> = {
  late:          'L',
  absent:        'A',
  half_day:      'H',
  leave:         'OL',
  holiday:       'H',
  missing_punch: 'MP',
  early_out:     'EO',
  lop:           'LOP',
  present:       'P',
  weekly_off:    'WO',
  weekend:       'WO',
}

const EXCEPTION_STATUSES = new Set<DailyStatus>(['absent', 'missing_punch', 'early_out', 'lop'])

const REG_TYPES: { value: string; label: string }[] = [
  { value: 'missed_punch',    label: 'Missed Punch'      },
  { value: 'forgot_checkout', label: 'Forgot Check-out'  },
  { value: 'onsite_duty',     label: 'Onsite Duty'       },
  { value: 'biometric_issue', label: 'Biometric Issue'   },
  { value: 'client_visit',    label: 'Client Visit'      },
  { value: 'wfh',             label: 'Work from Home'    },
  { value: 'field_work',      label: 'Field Work'        },
  { value: 'system_issue',    label: 'System Issue'      },
]

const WEEKDAY_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function fmtWorkHours(hours: number): string {
  if (!hours || hours <= 0) return '—'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function fmtDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function fmtRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function buildCalendarDays(y: number, m: number): (number | null)[] {
  const dow      = new Date(y, m, 1).getDay()
  const firstDow = dow === 0 ? 6 : dow - 1
  const total    = new Date(y, m + 1, 0).getDate()
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

/** Build YYYY-MM-DD using local year/month — never runs through UTC to avoid midnight-shift bugs */
function monthStart(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}
function monthEnd(y: number, m: number) {
  const days = new Date(y, m + 1, 0).getDate()   // day-0 trick gives last day of month
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(days).padStart(2, '0')}`
}

function csvCell(value: string | number) {
  const s = String(value)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

// ── Portal tooltip ─────────────────────────────────────────────────────────────

interface TooltipData {
  dateStr:      string
  rec:          DailyRecord | null   // null for future days with no record yet
  firstLog?:    LogEntry
  lastLog?:     LogEntry
  isIncomplete: boolean
  holidays:     HolidayEntry[]
  shiftInfo?:   ShiftInfo | null
}

function AttTooltip({ data, x, y }: { data: TooltipData; x: number; y: number }) {
  const { dateStr, rec, firstLog, lastLog, isIncomplete, holidays, shiftInfo } = data
  const label    = rec ? (STATUS_LABEL[rec.status] ?? rec.status) : 'Upcoming'
  const isFuture = !rec
  const TW       = 220
  const TH       = shiftInfo ? 210 : 180
  const vW       = window.innerWidth
  let top        = y - TH - 8
  if (top < 8) top = y + 36
  let left       = x - TW / 2
  if (left < 8) left = 8
  if (left + TW > vW - 8) left = vW - TW - 8

  const toneText = isFuture ? 'text-muted-foreground' :
    rec!.status === 'absent'  ? 'text-destructive' :
    rec!.status === 'late'    ? 'text-warning'      :
    rec!.status === 'present' ? 'text-success'      : 'text-foreground'

  // Format shift time e.g. "09:00:00" → "09:00"
  const shiftTime = shiftInfo
    ? `${shiftInfo.start_time.slice(0, 5)} – ${shiftInfo.end_time.slice(0, 5)}`
    : null

  return createPortal(
    <div className="fixed z-[300] pointer-events-none" style={{ top, left, width: TW }}>
      <div className="rounded-xl border border-border bg-card/97 backdrop-blur-sm shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-3 pt-2.5 pb-2 border-b border-border/40">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">{fmtDateLabel(dateStr)}</p>
            <p className={cn('text-xs font-semibold mt-0.5', toneText)}>{label}</p>
            {holidays.length > 0 && <p className="text-[9px] text-accent-foreground mt-0.5">{holidays[0].name}</p>}
          </div>
          {!isFuture && rec && (
            <Badge variant={STATUS_BADGE[rec.status] ?? 'outline'} className="text-[9px] h-4 px-1.5 rounded-full shrink-0 mt-0.5">
              {(label ?? '').split(' ')[0]}
            </Badge>
          )}
        </div>
        <div className="px-3 py-2.5 space-y-2">
          {!isFuture && rec && (
            <>
              {(firstLog?.check_in || lastLog?.check_out) && (
                <div className="flex items-center gap-2">
                  <Clock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
                  <p className="text-xs font-semibold text-foreground">
                    {fmtTime(firstLog?.check_in ?? null)}&nbsp;–&nbsp;{fmtTime(lastLog?.check_out ?? null)}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {rec.work_hours > 0 && (
                  <div><p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Duration</p>
                  <p className="text-xs font-semibold text-primary">{fmtWorkHours(rec.work_hours)}</p></div>
                )}
                {rec.late_minutes > 0 && (
                  <div><p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Lateness</p>
                  <p className="text-xs font-semibold text-warning">{fmtDuration(rec.late_minutes)}</p></div>
                )}
              </div>
              {isIncomplete && (
                <div className="flex items-center gap-1 text-[9px] text-warning">
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" />Missing OUT punch
                </div>
              )}
            </>
          )}

          {/* Shift info — shown for all days */}
          {shiftInfo && (
            <div className={cn('flex items-center justify-between', !isFuture && rec && 'border-t border-border/25 pt-1.5')}>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Shift</p>
                <p className="text-[10px] font-semibold text-foreground leading-tight">{shiftInfo.name}</p>
                {shiftTime && <p className="text-[9px] text-muted-foreground">{shiftTime}</p>}
              </div>
              {shiftInfo.grace_minutes > 0 && (
                <div className="text-right">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Grace</p>
                  <p className="text-[9px] text-muted-foreground">{shiftInfo.grace_minutes}m</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Day detail modal ───────────────────────────────────────────────────────────

interface RegForm { regType: string; checkIn: string; checkOut: string; reason: string }

interface DayDetailModalProps {
  dateStr:      string
  rec:          DailyRecord | null
  logs:         LogEntry[]
  isIncomplete: boolean
  holidays:     HolidayEntry[]
  existingReg:  RegularisationRequest | null
  periodLocked: boolean
  regForm:      RegForm
  regError:     string
  submitting:   boolean
  onFormChange: (f: RegForm) => void
  onSubmit:     () => void
  onClose:      () => void
}

function DayDetailModal({
  dateStr, rec, logs, isIncomplete, holidays,
  existingReg, periodLocked,
  regForm, regError, submitting,
  onFormChange, onSubmit, onClose,
}: DayDetailModalProps) {
  const label = rec ? (STATUS_LABEL[rec.status] ?? rec.status) : 'No Record'

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full sm:max-w-[440px] bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex justify-center pt-3 pb-0 sm:hidden">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">{fmtDateLabel(dateStr)}</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{label}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {rec && <Badge variant={STATUS_BADGE[rec.status] ?? 'outline'} className="capitalize text-[10px]">{rec.status.replace(/_/g, ' ')}</Badge>}
            <button onClick={onClose} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 rounded" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[72vh]">
          {!rec ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center px-5">
              <CalendarDays className="h-8 w-8 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground">No attendance record for this day.</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {holidays.length > 0 && (
                <div className="space-y-0.5">
                  {holidays.map((h, i) => (
                    <p key={i} className={cn('text-xs font-semibold', h.is_optional ? 'text-accent-foreground/70' : 'text-accent-foreground')}>
                      {h.name}{h.is_optional ? ' (Optional)' : ''}
                    </p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Work Hours', value: fmtWorkHours(rec.work_hours),     color: rec.work_hours > 0 ? 'text-foreground' : 'text-muted-foreground/50' },
                  { label: 'Lateness',   value: fmtDuration(rec.late_minutes),    color: rec.late_minutes > 0 ? 'text-warning' : 'text-muted-foreground/50' },
                  { label: 'Overtime',   value: fmtDuration(rec.overtime_minutes), color: rec.overtime_minutes > 0 ? 'text-info' : 'text-muted-foreground/50' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-muted/40 border border-border/30 px-2.5 py-2 text-center">
                    <p className={cn('text-sm font-bold leading-snug', color)}>{value}</p>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5 uppercase font-semibold tracking-wider">{label}</p>
                  </div>
                ))}
              </div>

              {rec.shift_name && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">Shift</span>
                  <span className="font-medium">{rec.shift_name}</span>
                </div>
              )}

              {logs.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
                    Punch Timeline — {logs.length} session{logs.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-1.5">
                    {logs.map((log, i) => (
                      <div key={log.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', !log.check_out ? 'border-warning/30 bg-warning/5' : 'border-border/40 bg-muted/25')}>
                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <div className="w-2 h-2 rounded-full bg-success" />
                          <div className="w-px h-3 bg-border/50" />
                          <div className={cn('w-2 h-2 rounded-full', !log.check_out ? 'bg-warning' : 'bg-destructive/50')} />
                        </div>
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">In</p>
                            <p className="text-xs font-semibold">{fmtTime(log.check_in)}</p>
                          </div>
                          <div>
                            <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Out</p>
                            <p className={cn('text-xs font-semibold', !log.check_out && 'text-warning')}>
                              {!log.check_out ? 'Missing' : fmtTime(log.check_out)}
                            </p>
                          </div>
                        </div>
                        <span className="text-[9px] text-muted-foreground/40 shrink-0">#{i + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isIncomplete && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-warning">Missing OUT punch detected</p>
                    <p className="text-warning/70 mt-0.5">One or more sessions are missing an OUT punch.</p>
                  </div>
                </div>
              )}

              {rec && (rec.status === 'absent' || rec.status === 'lop') && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[10px] text-destructive font-medium">
                    {rec.status === 'lop' ? 'Loss of Pay applied — affects payroll' : 'Absent day — may affect payroll if unresolved'}
                  </p>
                </div>
              )}

              {existingReg ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border/40 text-xs">
                  <FileEdit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Regularisation request:</span>
                  <Badge variant={existingReg.status === 'pending' ? 'warning' : existingReg.status === 'approved' ? 'success' : 'destructive'} className="capitalize rounded-full text-[10px] px-1.5 py-0 ml-auto">
                    {existingReg.status}
                  </Badge>
                </div>
              ) : !periodLocked ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Request Regularisation</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Your manager will review and approve this request.</p>
                  </div>
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 block mb-1">
                        Regularisation Type <span className="text-destructive">*</span>
                      </label>
                      <select
                        className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                        value={regForm.regType}
                        onChange={(e) => onFormChange({ ...regForm, regType: e.target.value })}
                      >
                        <option value="">Select type…</option>
                        {REG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 block mb-1">Check-in (optional)</label>
                        <Input type="datetime-local" className="h-8 text-xs" value={regForm.checkIn} onChange={(e) => onFormChange({ ...regForm, checkIn: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 block mb-1">Check-out (optional)</label>
                        <Input type="datetime-local" className="h-8 text-xs" value={regForm.checkOut} onChange={(e) => onFormChange({ ...regForm, checkOut: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 block mb-1">
                        Reason <span className="text-destructive">*</span>
                      </label>
                      <Input className="h-8 text-xs" placeholder="Brief description…" value={regForm.reason} onChange={(e) => onFormChange({ ...regForm, reason: e.target.value })} />
                    </div>
                  </div>
                  {regError && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0" />{regError}</p>}
                  <Button size="sm" className="h-8 text-xs w-full" disabled={submitting || !regForm.reason.trim() || !regForm.regType} onClick={onSubmit}>
                    {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <FileEdit className="h-3 w-3 mr-1.5" />}
                    {submitting ? 'Submitting…' : 'Submit Regularisation Request'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/30 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Period is locked — regularisation requests are no longer accepted.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Calendar legend ────────────────────────────────────────────────────────────

function CalLegend() {
  const items = [
    { label: 'Present (9h+)',           dot: 'bg-success rounded-full'              },
    { label: 'Absent Exception',        dot: 'bg-destructive rounded-full'          },
    { label: 'Late / Incomplete Hours', dot: 'bg-warning rounded-full'              },
    { label: 'On Leave',                dot: 'bg-info rounded-full'                 },
    { label: 'Holidays',                dot: 'bg-accent-violet rounded-full'           },
    { label: 'Weekly Off (WO)',         dot: 'bg-muted-foreground/30 rounded-full'  },
    { label: 'Pending Audit',           dot: 'bg-warning/60 rounded-full ring-1 ring-warning/40' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3 border-t border-border/30 mt-2">
      {items.map(({ label, dot }) => (
        <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
          <span className={cn('w-2.5 h-2.5 shrink-0', dot)} />
          {label}
        </span>
      ))}
    </div>
  )
}

// ── Type‑safe insight chip ─────────────────────────────────────────────────────

type InsightTone = 'success' | 'warning' | 'info' | 'neutral'

function InsightChip({ icon, text, tone }: { icon: ReactNode; text: string; tone: InsightTone }) {
  const cls: Record<InsightTone, string> = {
    success: 'bg-success/10 border-success/20 text-success',
    warning: 'bg-warning/10 border-warning/20 text-warning',
    info:    'bg-info/10 border-info/20 text-info',
    neutral: 'bg-muted/60 border-border/40 text-muted-foreground',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 border leading-none', cls[tone])}>
      {icon}{text}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MyAttendance() {
  const { profile }  = useAuthStore()
  const navigate     = useNavigate()
  const employeeId   = profile?.employee_id ?? null

  const [viewDate,    setViewDate]    = useState(() => new Date())
  const [calView,     setCalView]     = useState<'month' | 'list'>('month')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [tooltip,     setTooltip]     = useState<{ data: TooltipData; x: number; y: number } | null>(null)
  const [regForm,     setRegForm]     = useState<RegForm>({ regType: '', checkIn: '', checkOut: '', reason: '' })
  const [regError,    setRegError]    = useState('')
  const [punchError,  setPunchError]  = useState('')
  const [activeTab,       setActiveTab]       = useState<'calendar' | 'requests'>('calendar')
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('')
  const [cancellingId,    setCancellingId]    = useState<string | null>(null)

  const queryClient = useQueryClient()

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const from  = monthStart(year, month)
  const to    = monthEnd(year, month)

  // Previous month for delta calc
  const prevYear  = month === 0 ? year - 1 : year
  const prevMonth = month === 0 ? 11 : month - 1
  const prevFrom  = monthStart(prevYear, prevMonth)
  const prevTo    = monthEnd(prevYear, prevMonth)

  const attMonth     = `${year}-${String(month + 1).padStart(2, '0')}`
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(attMonth)
  const monthLabel   = (() => { const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${_M[month]}-${year}` })()
  // Local date — toISOString() would give UTC and could be yesterday in UTC+ timezones
  const todayStr = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data, isLoading, isError, refetch } = useQuery<AttendanceResponse>({
    queryKey:  ['my-attendance', employeeId, from, to],
    queryFn:   () => api.get<AttendanceResponse>(`/attendance/${employeeId}?from=${from}&to=${to}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const { data: prevData } = useQuery<AttendanceResponse>({
    queryKey:  ['my-attendance', employeeId, prevFrom, prevTo],
    queryFn:   () => api.get<AttendanceResponse>(`/attendance/${employeeId}?from=${prevFrom}&to=${prevTo}`),
    enabled:   !!employeeId,
    staleTime: 10 * 60_000,
  })

  const { data: holidaysData } = useQuery<{ data: HolidayEntry[] }>({
    queryKey:  ['holidays', year],
    queryFn:   () => api.get<{ data: HolidayEntry[] }>(`/masters/holidays?year=${year}`),
    enabled:   !!employeeId,
    staleTime: 30_000,
  })

  // Shift assignment — for schedule preview in hover & future cells
  const { data: shiftHistResp } = useQuery<{ data: { is_current: boolean; shifts: ShiftInfo }[] }>({
    queryKey:  ['ess-shift-history', employeeId],
    queryFn:   () => api.get(`/masters/employee-shifts/${employeeId}/history`),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  const currentShift = useMemo<ShiftInfo | null>(() => {
    const assignments = shiftHistResp?.data ?? []
    const current = assignments.find(a => a.is_current)
    return current?.shifts ?? assignments[0]?.shifts ?? null
  }, [shiftHistResp])

  const { data: regResp, refetch: refetchReg } = useQuery<{ data: RegularisationRequest[]; total: number }>({
    queryKey:  ['regularisation-my', employeeId, from, to],
    queryFn:   () => api.get<{ data: RegularisationRequest[]; total: number }>(`/attendance/regularisation/my?from=${from}&to=${to}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  // Full-history query — only fires when My Requests tab is active
  const reqQParams = new URLSearchParams({ limit: '100' })
  if (reqStatusFilter) reqQParams.set('status', reqStatusFilter)
  const { data: allRegResp, isLoading: allRegLoading, refetch: refetchAllReg } = useQuery<{ data: RegularisationRequest[]; total: number }>({
    queryKey:  ['regularisation-all', employeeId, reqStatusFilter],
    queryFn:   () => api.get(`/attendance/regularisation/my?${reqQParams}`),
    enabled:   !!employeeId && activeTab === 'requests',
    staleTime: 30_000,
  })
  const allRegRows  = allRegResp?.data  ?? []
  const allRegTotal = allRegResp?.total ?? 0

  // ── Mutations ──────────────────────────────────────────────────────────────

  const { mutate: submitRegularization, isPending: submittingReg } = useMutation({
    mutationFn: (payload: {
      date: string; regularization_type: string
      requested_check_in: string | null; requested_check_out: string | null; reason: string
    }) => api.post('/attendance/regularisation', payload),
    onSuccess: () => {
      setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' })
      setRegError('')
      refetchReg()
      queryClient.invalidateQueries({ queryKey: ['my-attendance', employeeId, from, to] })
    },
    onError: (e: Error) => setRegError(e.message ?? 'Failed to submit'),
  })

  const { mutate: cancelRequest } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularisation-all', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['regularisation-my', employeeId] })
      setCancellingId(null)
      toast.success('Request withdrawn')
    },
    onError: (e: Error) => {
      setCancellingId(null)
      toast.error('Could not cancel request', { description: e.message })
    },
  })

  const { mutate: punch, isPending: punching } = useMutation({
    mutationFn: (direction: 'IN' | 'OUT') =>
      api.post<{ data: { id: string; direction: string; punched_at: string } }>('/attendance/punch', { direction, source: 'web' }),
    onSuccess: () => { setPunchError(''); queryClient.invalidateQueries({ queryKey: ['my-attendance', employeeId, from, to] }) },
    onError: (e: Error) => setPunchError(e.message ?? 'Punch failed'),
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const regData = useMemo(() => regResp?.data ?? [], [regResp])

  const daily = useMemo(() => data?.daily ?? [], [data?.daily])
  const logs  = useMemo(() => data?.logs  ?? [], [data?.logs])

  const dailyByDate = useMemo(() => new Map(daily.map(d => [d.date, d])), [daily])

  const logsByDate = useMemo(() => {
    const map = new Map<string, LogEntry[]>()
    for (const log of logs) {
      const d = log.check_in?.slice(0, 10) ?? log.check_out?.slice(0, 10)
      if (!d) continue
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(log)
    }
    return map
  }, [logs])

  const incompleteSet = useMemo(
    () => new Set(logs.filter(l => !l.check_out && l.check_in).map(l => l.check_in!.slice(0, 10))),
    [logs],
  )

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, HolidayEntry[]>()
    for (const h of holidaysData?.data ?? []) {
      const arr = map.get(h.date) ?? []
      arr.push(h)
      map.set(h.date, arr)
    }
    return map
  }, [holidaysData])

  const regByDate = useMemo(() => new Map((regData ?? []).map(r => [r.date, r])), [regData])

  const exceptionDays = useMemo(() => daily.filter(d => {
    if (d.date >= todayStr) return false
    if (!EXCEPTION_STATUSES.has(d.status) && !incompleteSet.has(d.date)) return false
    const ex = regByDate.get(d.date)
    if (ex && ex.status !== 'rejected') return false
    return true
  }), [daily, todayStr, incompleteSet, regByDate])

  const calendarDays = useMemo(() => buildCalendarDays(year, month), [year, month])

  // ── KPI summary ────────────────────────────────────────────────────────────

  const kpi = useMemo(() => {
    let present = 0, absent = 0, late = 0, leave = 0, weekly_off = 0, holiday = 0
    for (const d of daily) {
      switch (d.status) {
        case 'present':    present++;    break
        case 'late':       late++;       break
        case 'absent':     absent++;     break
        case 'leave':      leave++;      break
        case 'weekly_off':
        case 'weekend':    weekly_off++; break
        case 'holiday':    holiday++;    break
      }
    }
    present = Math.max(present, data?.summary?.present ?? 0)
    absent  = Math.max(absent,  data?.summary?.absent  ?? 0)
    late    = Math.max(late,    data?.summary?.late    ?? 0)

    const workingDays = present + absent + late
    const presentPct  = workingDays > 0 ? Math.round((present / workingDays) * 100) : 0

    // Previous month
    let pPresent = 0, pAbsent = 0, pLate = 0, pLeave = 0
    for (const d of prevData?.daily ?? []) {
      switch (d.status) {
        case 'present': pPresent++; break
        case 'late':    pLate++;    break
        case 'absent':  pAbsent++;  break
        case 'leave':   pLeave++;   break
      }
    }
    pPresent = Math.max(pPresent, prevData?.summary?.present ?? 0)
    pAbsent  = Math.max(pAbsent,  prevData?.summary?.absent  ?? 0)
    pLate    = Math.max(pLate,    prevData?.summary?.late    ?? 0)

    const pWorkDays  = pPresent + pAbsent + pLate
    const pPresentPct = pWorkDays > 0 ? Math.round((pPresent / pWorkDays) * 100) : 0

    return {
      presentPct,
      present,  absent,  late,  leave,  weekly_off, holiday,
      pPresentPct, pPresent, pAbsent, pLate, pLeave,
      hasPrev: (prevData?.daily?.length ?? 0) > 0,
    }
  }, [daily, data?.summary, prevData])

  // ── Today's data ───────────────────────────────────────────────────────────

  const todaySummary = useMemo(() => {
    const todayLogs = logs.filter(l => l.check_in?.startsWith(todayStr))
    const firstLog  = todayLogs[0] ?? null
    const lastLog   = todayLogs[todayLogs.length - 1] ?? null
    const todayRec  = dailyByDate.get(todayStr) ?? null
    const isIn      = lastLog?.check_in && !lastLog?.check_out
    const workMins  = todayRec?.work_hours ? todayRec.work_hours * 60 : 0
    return { todayLogs, firstLog, lastLog, todayRec, isIn, workMins }
  }, [logs, dailyByDate, todayStr])

  // ── Insights ───────────────────────────────────────────────────────────────

  const insights = useMemo(() => {
    const result: { icon: ReactNode; text: string; tone: InsightTone }[] = []
    const lateCount = daily.filter(d => d.status === 'late').length
    if (lateCount > 0) result.push({ icon: <Timer className="h-3 w-3" />, text: `${lateCount} late arrival${lateCount !== 1 ? 's' : ''} this month`, tone: lateCount >= 4 ? 'warning' : 'neutral' })

    let streak = 0
    const today = new Date(todayStr)
    for (let i = 0; i < 31; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i)
      if (d.getMonth() !== month || d.getFullYear() !== year) break
      const rec = dailyByDate.get(d.toISOString().slice(0, 10))
      if (!rec) break
      if (rec.status === 'present' || rec.status === 'late') streak++
      else break
    }
    if (streak >= 5) result.push({ icon: <TrendingUp className="h-3 w-3" />, text: `${streak}-day streak`, tone: streak >= 10 ? 'success' : 'info' })
    if (incompleteSet.size > 0) result.push({ icon: <AlertTriangle className="h-3 w-3" />, text: `${incompleteSet.size} missing punch${incompleteSet.size !== 1 ? 'es' : ''}`, tone: 'warning' })
    const todayDow = today.getDay(); const mo = todayDow === 0 ? -6 : 1 - todayDow
    const weekdays: string[] = []
    for (let i = 0; i <= Math.min(todayDow === 0 ? 6 : todayDow - 1, 4); i++) {
      const d = new Date(today); d.setDate(today.getDate() + mo + i)
      if (d <= today) weekdays.push(d.toISOString().slice(0, 10))
    }
    if (weekdays.length >= 3 && weekdays.every(ds => dailyByDate.get(ds)?.status !== 'absent'))
      result.push({ icon: <CheckCircle2 className="h-3 w-3" />, text: 'Perfect week so far', tone: 'success' })
    return result.slice(0, 3)
  }, [daily, dailyByDate, incompleteSet, todayStr, month, year])

  // ── Tooltip handlers ───────────────────────────────────────────────────────

  const handleCellEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>, dateStr: string) => {
    const rec        = dailyByDate.get(dateStr) ?? null
    const isFuture   = dateStr > todayStr
    // Show tooltip for cells with data, OR future cells when we have shift info
    if (!rec && (!isFuture || !currentShift)) return
    const rect    = e.currentTarget.getBoundingClientRect()
    const dayLogs = logsByDate.get(dateStr) ?? []
    setTooltip({
      data: {
        dateStr,
        rec,
        firstLog:     dayLogs[0],
        lastLog:      dayLogs[dayLogs.length - 1],
        isIncomplete: incompleteSet.has(dateStr),
        holidays:     holidaysByDate.get(dateStr) ?? [],
        shiftInfo:    currentShift,
      },
      x: rect.left + rect.width / 2,
      y: rect.top,
    })
  }, [dailyByDate, logsByDate, incompleteSet, holidaysByDate, todayStr, currentShift])

  const handleCellLeave = useCallback(() => setTooltip(null), [])

  // ── CSV export ─────────────────────────────────────────────────────────────

  function handleExport() {
    if (!daily.length) return
    const header = ['Date', 'Day', 'Status', 'Work Hours', 'Late (min)', 'Overtime (min)', 'Sessions']
    const rows = daily.map(d => {
      const dayLogs = logs.filter(l => l.check_in?.startsWith(d.date))
      const dow = new Date(`${d.date}T00:00:00`).toLocaleDateString('default', { weekday: 'short' })
      return [d.date, dow, d.status.replace('_', ' '), d.work_hours, d.late_minutes, d.overtime_minutes, dayLogs.length]
    })
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')
    const filename = `attendance-${from.slice(0, 7)}-${data?.employee?.employee_code ?? 'emp'}.csv`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Selected day ───────────────────────────────────────────────────────────

  const selRec        = selectedDay ? (dailyByDate.get(selectedDay) ?? null) : null
  const selLogs       = selectedDay ? (logsByDate.get(selectedDay) ?? []) : []
  const selIncomplete = selectedDay ? incompleteSet.has(selectedDay) : false
  const selHolidays   = selectedDay ? (holidaysByDate.get(selectedDay) ?? []) : []
  const selReg        = selectedDay ? (regByDate.get(selectedDay) ?? null) : null

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <div className="p-6 rounded-xl border border-border bg-card flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-7 w-7 text-warning/60" />
        <p className="text-sm font-semibold text-foreground">Profile not linked</p>
        <p className="text-xs text-muted-foreground max-w-xs">Contact HR to link your account to an employee record.</p>
      </div>
    )
  }

  // ── List view rows ─────────────────────────────────────────────────────────

  const listRows = daily.filter(d => d.date <= todayStr).sort((a, b) => b.date.localeCompare(a.date))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground tracking-tight flex items-center gap-2.5">
            <CalendarDays className="h-5 w-5 text-primary flex-shrink-0" />
            My Attendance
          </h1>
          <p className="text-xs text-muted-foreground leading-snug font-medium mt-0.5">
            Track your daily check-in times, exception audits, and regularisation approvals.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month nav */}
          <div className="flex items-center bg-card border border-border rounded-xl overflow-hidden shadow-sm px-2 py-1 select-none">
            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded"
              onClick={() => { setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null) }}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[11px] font-bold text-foreground px-3 min-w-[80px] text-center">{monthLabel}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded"
              onClick={() => { setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null) }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <button
            onClick={() => { setViewDate(new Date()); setSelectedDay(null) }}
            className="bg-card hover:bg-muted/50 border border-border text-foreground text-[11px] font-bold py-[7px] px-3 rounded-xl transition-all shadow-sm"
          >
            Today
          </button>
          <button
            onClick={() => {
              const first = exceptionDays[0]
              if (first) { setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' }); setRegError(''); setSelectedDay(first.date) }
              else setActiveTab('requests')
            }}
            className="bg-gradient-to-r from-primary to-accent-violet hover:brightness-105 text-primary-foreground font-semibold text-[11px] py-[7px] px-3.5 rounded-xl shadow-md transition-all flex items-center gap-1.5"
          >
            <FileEdit className="h-3.5 w-3.5" />
            Request Regularisation
          </button>
        </div>
      </div>

      {/* ── Tab switcher ────────────────────────────────────────────────── */}
      <div className="bg-muted/60 border border-border/50 p-1 rounded-xl flex items-center select-none text-xs font-semibold w-fit">
        <button
          onClick={() => setActiveTab('calendar')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-all',
            activeTab === 'calendar'
              ? 'bg-background text-primary shadow-sm border border-border/30'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarDays className="h-3 w-3" />
          Attendance Log
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-all',
            activeTab === 'requests'
              ? 'bg-background text-primary shadow-sm border border-border/30'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ClipboardCheck className="h-3 w-3" />
          My Requests
          {regData.filter(r => r.status === 'pending').length > 0 && (
            <span className="text-[9px] bg-warning text-warning-foreground rounded-full px-1.5 py-0.5 font-bold leading-none ml-0.5">
              {regData.filter(r => r.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {/* ── Attendance Log tab ───────────────────────────────────────────── */}
      {activeTab === 'calendar' && <>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <MetricRow cols={5}>
        <MetricCard
          label="Present"
          value={isLoading ? '—' : `${kpi.presentPct}%`}
          icon={CalendarCheck}
          variant="success"
          trend={kpi.hasPrev ? kpi.presentPct - kpi.pPresentPct : undefined}
        />
        <MetricCard
          label="Absent"
          value={isLoading ? '—' : kpi.absent}
          icon={CalendarDays}
          variant="destructive"
          trend={kpi.hasPrev ? kpi.absent - kpi.pAbsent : undefined}
        />
        <MetricCard
          label="Late"
          value={isLoading ? '—' : kpi.late}
          icon={Clock}
          variant="warning"
          trend={kpi.hasPrev ? kpi.late - kpi.pLate : undefined}
        />
        <MetricCard
          label="On Leave"
          value={isLoading ? '—' : kpi.leave}
          icon={PlaneTakeoff}
          variant="info"
          trend={kpi.hasPrev ? kpi.leave - kpi.pLeave : undefined}
        />
        <MetricCard
          label="Weekly Off"
          value={isLoading ? '—' : kpi.weekly_off}
          icon={Coffee}
          variant="neutral"
        />
        <MetricCard
          label="Holiday"
          value={isLoading ? '—' : kpi.holiday}
          icon={Gift}
          variant="info"
        />
      </MetricRow>

      {/* ── Exception banner ────────────────────────────────────────────── */}
      {!isLoading && exceptionDays.length > 0 && (
        <div className="bg-gradient-to-r from-warning/12 to-warning/5 border border-warning/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-warning text-white flex items-center justify-center shrink-0 shadow-sm shadow-warning/30">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground leading-snug">
                {exceptionDays.length} Attendance Exception Day{exceptionDays.length !== 1 ? 's' : ''} Require Regularisation
              </h4>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 font-medium">
                Unrecorded punches or exceptions detected on:{' '}
                <span className="font-bold text-foreground font-mono">
                  {exceptionDays.slice(0, 3).map(d => { const _d = new Date(`${d.date}T12:00:00Z`); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` }).join(', ')}
                  {exceptionDays.length > 3 ? ` +${exceptionDays.length - 3} more` : ''}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={() => { const f = exceptionDays[0]; if (f) { setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' }); setRegError(''); setSelectedDay(f.date) } }}
            className="bg-warning hover:bg-warning/90 text-white font-bold text-[10px] py-1.5 px-3.5 rounded-lg shadow-sm transition-colors shrink-0 self-start sm:self-auto"
          >
            View & Regularize
          </button>
        </div>
      )}

      {/* ── Period lock notice ───────────────────────────────────────────── */}
      {periodState !== 'OPEN' && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-muted/40 border border-border/50 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          This period is locked — regularisation requests are no longer accepted for {monthLabel}.
        </div>
      )}

      {/* ── Main 2-column layout ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 items-start">

        {/* ── LEFT: Attendance Calendar ─────────────────────────────────── */}
        <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-visible">
          {/* Calendar header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary flex-shrink-0" />
                <p className="text-sm font-bold text-foreground">Attendance Calendar Overview</p>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">
                Click any cell to view punch intervals and exception diagnostics.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border/50 rounded-lg px-2 py-1">
                <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground">Filter:</span>
                <select
                  className="text-[10px] font-semibold bg-transparent border-none outline-none text-foreground cursor-pointer"
                  defaultValue="all"
                >
                  <option value="all">All Days</option>
                </select>
              </div>
              <div className="flex rounded-lg border border-border/50 overflow-hidden">
                <button
                  onClick={() => setCalView('month')}
                  className={cn('flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                    calView === 'month' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  <CalendarDays className="h-3 w-3" />Month
                </button>
                <button
                  onClick={() => setCalView('list')}
                  className={cn('flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold transition-colors border-l border-border/50',
                    calView === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  <List className="h-3 w-3" />List
                </button>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                disabled={isLoading || !daily.length} onClick={handleExport} title="Export CSV">
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Insight chips */}
          {!isLoading && insights.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pt-1.5 pb-0">
              {insights.map((ins, i) => <InsightChip key={i} icon={ins.icon} text={ins.text} tone={ins.tone} />)}
            </div>
          )}

          {/* Calendar body */}
          <div className="px-2 pb-2 pt-1.5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading calendar…
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <WifiOff className="h-7 w-7 text-destructive/50" />
                <p className="text-sm text-muted-foreground">Could not load attendance data</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refetch()}>
                  <RefreshCw className="h-3 w-3 mr-1.5" />Retry
                </Button>
              </div>
            ) : calView === 'month' ? (
              <>
                {/* Weekday headers */}
                <div className="grid grid-cols-7 mb-1">
                  {WEEKDAY_FULL.map((d) => (
                    <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 py-1">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Day cells */}
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarDays.map((day, i) => {
                    if (day === null) return <div key={i} className="h-[88px]" aria-hidden />

                    const dateStr        = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const rec            = dailyByDate.get(dateStr)
                    const isToday        = dateStr === todayStr
                    const isSelected     = selectedDay === dateStr
                    const isFuture       = dateStr > todayStr
                    const isIncomplete   = incompleteSet.has(dateStr)
                    const hasExc         = exceptionDays.some(e => e.date === dateStr)
                    const futureDow      = isFuture ? new Date(dateStr + 'T00:00:00').getDay() : -1
                    const isFutureWO     = isFuture && !!currentShift?.weekly_off_days?.includes(futureDow)
                    const cell3d         = rec && !isToday ? CELL_3D[rec.status] : null
                    const dayLogs        = logsByDate.get(dateStr) ?? []
                    const checkInTs      = dayLogs[0]?.check_in ?? null

                    return (
                      <button
                        key={i}
                        type="button"
                        aria-label={`${dateStr}${rec ? `, ${STATUS_LABEL[rec.status]}` : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' })
                          setRegError('')
                          setSelectedDay(prev => prev === dateStr ? null : dateStr)
                        }}
                        onMouseEnter={(e) => handleCellEnter(e, dateStr)}
                        onMouseLeave={handleCellLeave}
                        style={cell3d ? {
                          background: cell3d.bg,
                          color:      cell3d.color,
                          boxShadow:  cell3d.shadow,
                        } : undefined}
                        className={cn(
                          'h-[88px] w-full rounded-2xl transition-all duration-100 flex flex-col items-start justify-between px-2.5 py-2 relative overflow-hidden',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          isToday && 'bg-primary text-primary-foreground shadow-lg shadow-primary/35',
                          !isToday && !cell3d && rec && CELL_STYLE[rec.status],
                          !isToday && !rec && !isFuture && 'bg-muted/20 text-muted-foreground/30 hover:bg-muted/35',
                          !isToday && isFuture && isFutureWO && 'bg-muted/25 text-muted-foreground/30',
                          !isToday && isFuture && !isFutureWO && 'bg-muted/10 text-muted-foreground/20',
                          isSelected && 'ring-2 ring-primary ring-offset-1',
                          !isToday && (rec || isFutureWO) && 'hover:translate-y-[-1px] hover:brightness-105 cursor-pointer',
                          isFuture && !rec && !isFutureWO && 'cursor-default',
                        )}
                      >
                        {/* Top row: day number + indicator */}
                        <div className="flex items-start justify-between w-full">
                          <span className={cn(
                            'text-sm font-bold leading-none',
                            isToday && 'text-primary-foreground',
                            isFuture && !isFutureWO && 'opacity-30',
                          )}>
                            {day}
                          </span>
                          {isToday ? (
                            <span className="text-[8px] font-bold bg-white/25 text-primary-foreground px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap">
                              Today
                            </span>
                          ) : (isIncomplete || hasExc) ? (
                            <span className="w-2 h-2 rounded-full bg-warning ring-1 ring-card flex-shrink-0 mt-0.5" />
                          ) : null}
                        </div>

                        {/* Center: main status / hours content */}
                        <div className="flex flex-col items-start w-full flex-1 justify-center py-0.5">
                          {isToday ? (
                            rec ? (
                              rec.work_hours > 0 ? (
                                <>
                                  <span className="text-[11px] font-bold font-display uppercase leading-none text-primary-foreground/95">
                                    {fmtWorkHours(rec.work_hours).toUpperCase()}
                                  </span>
                                  {checkInTs && (
                                    <span className="text-[9px] text-primary-foreground/60 mt-0.5 leading-none">
                                      {fmtTime(checkInTs)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-[10px] font-bold uppercase leading-none text-primary-foreground/90">
                                  {STATUS_LABEL[rec.status] ?? STATUS_CODE[rec.status] ?? 'WO'}
                                </span>
                              )
                            ) : null
                          ) : rec && !isFuture ? (
                            rec.work_hours > 0 ? (
                              <>
                                <span className="text-[11px] font-bold font-display uppercase leading-none truncate">
                                  {fmtWorkHours(rec.work_hours).toUpperCase()}
                                </span>
                                {checkInTs && (
                                  <span className="text-[9px] opacity-55 mt-0.5 leading-none">
                                    {fmtTime(checkInTs)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] font-bold uppercase leading-none truncate">
                                {STATUS_LABEL[rec.status] ?? STATUS_CODE[rec.status] ?? '–'}
                              </span>
                            )
                          ) : isFutureWO ? (
                            <span className="text-[10px] font-bold uppercase opacity-40">WO</span>
                          ) : null}
                        </div>
                      </button>
                    )
                  })}
                </div>

                <CalLegend />
              </>
            ) : (
              /* List view */
              <div className="space-y-0.5 max-h-[420px] overflow-y-auto">
                {listRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No attendance records for this month.</p>
                ) : listRows.map(d => {
                  const dayLogs    = logsByDate.get(d.date) ?? []
                  const firstIn    = dayLogs[0]?.check_in ?? null
                  const lastOut    = dayLogs[dayLogs.length - 1]?.check_out ?? null
                  const reg        = regByDate.get(d.date)
                  const dow        = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })

                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => { setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' }); setRegError(''); setSelectedDay(d.date) }}
                      className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors text-left"
                    >
                      <div className="w-8 text-center shrink-0">
                        <p className="text-xs font-bold text-foreground">{new Date(d.date + 'T00:00:00').getDate()}</p>
                        <p className="text-[9px] text-muted-foreground/60">{dow}</p>
                      </div>
                      <div className={cn('w-1.5 h-8 rounded-full shrink-0', CELL_STYLE[d.status]?.includes('success') ? 'bg-success' : CELL_STYLE[d.status]?.includes('warning') ? 'bg-warning' : CELL_STYLE[d.status]?.includes('destructive') ? 'bg-destructive' : CELL_STYLE[d.status]?.includes('info') ? 'bg-info' : 'bg-muted-foreground/20')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{STATUS_LABEL[d.status] ?? d.status}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {firstIn ? `${fmtTime(firstIn)} – ${fmtTime(lastOut)}` : '—'}
                          {d.work_hours > 0 && ` · ${fmtWorkHours(d.work_hours)}`}
                        </p>
                      </div>
                      {reg && (
                        <Badge variant={reg.status === 'pending' ? 'warning' : reg.status === 'approved' ? 'success' : 'destructive'} className="text-[9px] capitalize px-1.5 py-0 rounded-full">
                          {reg.status}
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Sidebar ────────────────────────────────────────────── */}
        <div className="space-y-2">

          {/* Today's Summary */}
          <div className="rounded-xl border border-border/70 bg-card shadow-sm p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-foreground">Today's Summary</p>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-muted-foreground">
                  {(() => { const _d = new Date(); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const _WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']; return `${_WD[_d.getDay()]}, ${String(_d.getDate()).padStart(2,'0')}-${_M[_d.getMonth()]}-${_d.getFullYear()}` })()}
                </p>
                {todaySummary.todayRec && (
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                    todaySummary.todayRec.status === 'present' ? 'bg-success/15 text-success' :
                    todaySummary.todayRec.status === 'late'    ? 'bg-warning/15 text-warning' :
                    todaySummary.todayRec.status === 'absent'  ? 'bg-destructive/15 text-destructive' :
                    'bg-muted text-muted-foreground'
                  )}>
                    {STATUS_LABEL[todaySummary.todayRec.status] ?? todaySummary.todayRec.status}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 mb-1.5">
              {[
                { label: 'In Time',  value: fmtTime(todaySummary.firstLog?.check_in ?? null),  icon: LogIn },
                { label: 'Out Time', value: fmtTime(todaySummary.lastLog?.check_out ?? null),  icon: LogOut },
                { label: 'Duration', value: todaySummary.todayRec ? fmtWorkHours(todaySummary.todayRec.work_hours) : '—', icon: Clock },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-md bg-muted/40 border border-border/30 px-1.5 py-1 text-center">
                  <Icon className="h-2.5 w-2.5 text-muted-foreground/60 mx-auto mb-0.5" />
                  <p className="text-[11px] font-bold text-foreground leading-none">{value}</p>
                  <p className="text-[8px] text-muted-foreground/55 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Punch buttons */}
            <div className="flex gap-1 mb-1">
              <Button size="sm" variant={todaySummary.isIn ? 'outline' : 'default'} className="flex-1 h-7 text-xs gap-1"
                disabled={!!todaySummary.isIn || punching} onClick={() => punch('IN')}>
                {punching ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                Punch In
              </Button>
              <Button size="sm" variant={todaySummary.isIn ? 'default' : 'outline'} className="flex-1 h-7 text-xs gap-1"
                disabled={!todaySummary.isIn || punching} onClick={() => punch('OUT')}>
                {punching ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                Punch Out
              </Button>
            </div>
            {punchError && <p className="text-[10px] text-destructive">{punchError}</p>}

            <button
              onClick={() => { setSelectedDay(todayStr) }}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium mt-1"
            >
              View Day Details <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {/* Recent Regularisation Requests */}
          <div className="rounded-xl border border-border/70 bg-card shadow-sm p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-foreground">Recent Regularisation Requests</p>
              <button onClick={() => setActiveTab('requests')} className="flex items-center gap-0.5 text-[10px] text-primary hover:underline font-medium">
                View all <ArrowRight className="h-2.5 w-2.5" />
              </button>
            </div>

            {(() => {
              const recent = (regData ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4)
              if (recent.length === 0) {
                return <p className="text-[11px] text-muted-foreground text-center py-3">No regularisation requests this month.</p>
              }
              const statusCls: Record<string, string> = {
                pending:   'bg-warning/15 text-warning border-warning/30',
                approved:  'bg-success/15 text-success border-success/30',
                rejected:  'bg-destructive/15 text-destructive border-destructive/30',
                withdrawn: 'bg-muted/50 text-muted-foreground border-border',
              }
              const regIcon: Record<string, ReactNode> = {
                pending:  <Clock className="h-3.5 w-3.5 text-warning" />,
                approved: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
                rejected: <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
              }
              return (
                <div className="space-y-1.5">
                  {recent.map(r => (
                    <div key={r.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/30 transition-colors">
                      <div className="shrink-0">{regIcon[r.status] ?? <FileEdit className="h-3 w-3 text-muted-foreground" />}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-foreground leading-tight">
                          {fmtDateLabel(r.date)}
                          {r.regularization_type && <span className="text-muted-foreground font-normal"> · {r.regularization_type.replace(/_/g, ' ')}</span>}
                        </p>
                        <p className="text-[9px] text-muted-foreground truncate">{r.reason}</p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className={cn('text-[8px] font-bold px-1 py-0.5 rounded border capitalize', statusCls[r.status] ?? 'bg-muted text-muted-foreground border-border')}>
                          {r.status}
                        </span>
                        <span className="text-[8px] text-muted-foreground/45">{fmtRelativeTime(r.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Quick Actions */}
          <div className="rounded-xl border border-border/70 bg-card shadow-sm p-2.5">
            <p className="text-[10px] font-semibold text-foreground mb-1.5 uppercase tracking-wide text-muted-foreground/70">Quick Actions</p>
            <div className="grid grid-cols-2 gap-1">
              {[
                { icon: FileEdit,     label: 'Regularise',    onClick: () => { const f = exceptionDays[0]; if (f) { setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' }); setSelectedDay(f.date) } else setActiveTab('requests') } },
                { icon: PlaneTakeoff, label: 'Apply Leave',   onClick: () => navigate('/ess/leave/balance') },
                { icon: CalendarCheck,label: 'Leave Balance', onClick: () => navigate('/ess/leave/balance') },
                { icon: Zap,          label: 'Comp-Off',      onClick: () => navigate('/ess/comp-off') },
                { icon: Scale,        label: 'Att. Policy',   onClick: () => navigate('/ess/policies') },
              ].map(({ icon: Icon, label, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-border/30 bg-muted/15 hover:bg-muted/50 hover:border-border/50 transition-all text-left"
                >
                  <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-2.5 w-2.5 text-primary" />
                  </div>
                  <p className="text-[10px] font-medium text-foreground leading-tight truncate">{label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Regularisation Guidelines */}
          <div className="rounded-xl border border-border/50 bg-muted/20 px-2.5 py-2 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-info/15 border border-info/20 flex items-center justify-center shrink-0">
              <FileText className="h-3 w-3 text-info" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-foreground">Submit within 7 days for faster approval.</p>
            </div>
            <button onClick={() => navigate('/ess/policies')} className="text-[10px] text-info hover:underline font-medium shrink-0">
              Policy
            </button>
          </div>

          {/* Exception Days Queue */}
          {!isLoading && exceptionDays.length > 0 && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/4 shadow-sm p-2.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <p className="text-xs font-semibold text-foreground">
                    Exception Queue
                    <span className="ml-1 text-[9px] font-bold bg-destructive/15 text-destructive px-1.5 py-0.5 rounded-full">{exceptionDays.length}</span>
                  </p>
                </div>
                <button
                  onClick={() => { const f = exceptionDays[0]; if (f) { setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' }); setRegError(''); setSelectedDay(f.date) } }}
                  className="text-[10px] text-destructive hover:underline font-bold shrink-0"
                >
                  Resolve All →
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {exceptionDays.slice(0, 8).map(d => (
                  <button
                    key={d.date}
                    onClick={() => { setRegForm({ regType: '', checkIn: '', checkOut: '', reason: '' }); setRegError(''); setSelectedDay(d.date) }}
                    className="px-2.5 py-1.5 bg-destructive/10 hover:bg-destructive/20 border border-destructive/25 text-destructive text-[9px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span className="font-mono">
                      {(() => { const _d = new Date(d.date + 'T12:00:00Z'); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` })()}
                    </span>
                    <span className="opacity-55 font-medium">
                      ({STATUS_LABEL[d.status]?.split(' ')[0] ?? 'Exc'})
                    </span>
                  </button>
                ))}
                {exceptionDays.length > 8 && (
                  <button
                    onClick={() => setActiveTab('requests')}
                    className="px-2.5 py-1.5 rounded-lg border border-border/50 bg-muted/40 hover:bg-muted/70 transition-all text-[9px] font-bold text-muted-foreground"
                  >
                    +{exceptionDays.length - 8} more
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* close Attendance Log tab */}
      </>}

      {/* ── My Requests tab ─────────────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">
                My Regularisation Requests{allRegTotal > 0 ? ` (${allRegTotal})` : ''}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                All requests — click a day in Attendance Log to raise a new one
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={reqStatusFilter}
                onChange={(e) => setReqStatusFilter(e.target.value)}
                className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">All status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
                onClick={() => refetchAllReg()} disabled={allRegLoading}>
                <RefreshCw className={cn('h-3.5 w-3.5', allRegLoading && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4">
            {allRegLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <p className="text-sm">Loading requests…</p>
              </div>
            ) : allRegRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <SearchX className="h-7 w-7 opacity-40" />
                <p className="text-sm font-medium text-foreground">
                  {reqStatusFilter ? 'No requests match this filter' : 'No regularisation requests yet'}
                </p>
                <p className="text-xs text-center max-w-xs">
                  {reqStatusFilter
                    ? 'Try clearing the filter to see all requests.'
                    : 'Click any exception day in the Attendance Log to raise a regularisation request.'}
                </p>
                {!reqStatusFilter && (
                  <Button size="sm" variant="outline" className="mt-1 h-7 text-xs gap-1.5"
                    onClick={() => setActiveTab('calendar')}>
                    <CalendarDays className="h-3 w-3" />
                    Go to Attendance Log
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden space-y-2.5">
                  {allRegRows.map((row) => (
                    <div
                      key={row.id}
                      className={cn(
                        'rounded-xl border bg-card p-4 text-xs space-y-3',
                        row.status === 'pending'  && 'border-warning/30',
                        row.status === 'approved' && 'border-success/30',
                        row.status === 'rejected' && 'border-destructive/30',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {fmtDateLabel(row.date)}
                        </div>
                        <Badge
                          variant={
                            row.status === 'pending'   ? 'warning'     :
                            row.status === 'approved'  ? 'success'     :
                            row.status === 'rejected'  ? 'destructive' : 'secondary'
                          }
                          className="rounded-full text-[10px] capitalize"
                        >
                          {row.status}
                        </Badge>
                      </div>
                      {row.regularization_type && (
                        <p className="text-muted-foreground capitalize">
                          {row.regularization_type.replace(/_/g, ' ')}
                        </p>
                      )}
                      <p className="text-muted-foreground line-clamp-2">{row.reason}</p>
                      {row.status === 'rejected' && row.rejection_reason && (
                        <p className="text-destructive">Rejected — {row.rejection_reason}</p>
                      )}
                      {row.status === 'pending' && (
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-muted-foreground">Awaiting manager review</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={cancellingId === row.id}
                            onClick={() => { setCancellingId(row.id); cancelRequest(row.id) }}
                          >
                            {cancellingId === row.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Withdraw'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Date', 'Type', 'Req. In', 'Req. Out', 'Reason', 'Status / Feedback', 'Submitted', ''].map(h => (
                          <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2.5 px-3 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allRegRows.map(row => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-foreground text-xs">
                              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              {fmtDateLabel(row.date)}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-xs font-medium text-foreground capitalize">
                            {row.regularization_type
                              ? row.regularization_type.replace(/_/g, ' ')
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground">{fmtTime(row.requested_check_in)}</td>
                          <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground">{fmtTime(row.requested_check_out)}</td>
                          <td className="py-3 px-3 max-w-[200px]">
                            <p className="text-foreground text-xs line-clamp-2">{row.reason}</p>
                          </td>
                          <td className="py-3 px-3">
                            <Badge
                              variant={
                                row.status === 'pending'   ? 'warning'     :
                                row.status === 'approved'  ? 'success'     :
                                row.status === 'rejected'  ? 'destructive' : 'secondary'
                              }
                              className="rounded-full text-[10px] capitalize whitespace-nowrap"
                            >
                              {row.status}
                            </Badge>
                            {row.status === 'rejected' && row.rejection_reason && (
                              <p className="text-[10px] text-destructive mt-1 max-w-[160px]">{row.rejection_reason}</p>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground">
                            {(() => { const _d = new Date(row.created_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` })()}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {row.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={cancellingId === row.id}
                                onClick={() => { setCancellingId(row.id); cancelRequest(row.id) }}
                              >
                                {cancellingId === row.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : 'Withdraw'}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted-foreground px-1">
                    <span>{allRegTotal} request{allRegTotal !== 1 ? 's' : ''}</span>
                    {allRegRows.filter(r => r.status === 'pending').length > 0 && (
                      <Badge variant="warning" className="rounded-full text-[10px]">
                        {allRegRows.filter(r => r.status === 'pending').length} awaiting review
                      </Badge>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Portals ─────────────────────────────────────────────────────── */}
      {tooltip && <AttTooltip data={tooltip.data} x={tooltip.x} y={tooltip.y} />}

      {selectedDay && (
        <DayDetailModal
          dateStr={selectedDay}
          rec={selRec}
          logs={selLogs}
          isIncomplete={selIncomplete}
          holidays={selHolidays}
          existingReg={selReg}
          periodLocked={periodLocked}
          regForm={regForm}
          regError={regError}
          submitting={submittingReg}
          onFormChange={setRegForm}
          onSubmit={() => {
            if (!selectedDay || !regForm.reason.trim() || !regForm.regType) return
            submitRegularization({
              date:                 selectedDay,
              regularization_type:  regForm.regType,
              requested_check_in:   regForm.checkIn  || null,
              requested_check_out:  regForm.checkOut || null,
              reason:               regForm.reason.trim(),
            })
          }}
          onClose={() => setSelectedDay(null)}
        />
      )}

    </div>
  )
}
