/**
 * ForensicsDrawer
 *
 * Right-side slide-over panel that embeds the full attendance forensics
 * timeline for a specific employee + date without leaving the current page.
 *
 * Usage:
 *   const [target, setTarget] = useState<{ employeeId: string; date: string } | null>(null)
 *
 *   <ForensicsDrawer target={target} onClose={() => setTarget(null)} />
 *   <Button onClick={() => setTarget({ employeeId, date })}>View Timeline</Button>
 */
import { useQuery }    from '@tanstack/react-query'
import {
  Clock, Wifi, AlarmClock, CalendarDays, ShieldCheck,
  ClipboardEdit, ClipboardCheck, XCircle, CheckCircle2,
  Zap, Terminal, Info, GitBranch, User, ChevronDown, ChevronUp,
  ExternalLink, Upload, RefreshCw,
} from 'lucide-react'
import { Link }        from 'react-router-dom'
import { useState }    from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody,
} from '@/components/ui/sheet'
import { Badge }       from '@/components/ui/badge'
import { api }         from '@/lib/api/client'
import { forensicsUrl } from '@/lib/operational-links'
import { cn }          from '@/lib/utils'

// ── Types (subset of full forensics API response) ────────────────────────────

interface TimelineEvent {
  time:     string | null
  type:     string
  label:    string
  detail:   string | null
  actor:    string | null
  severity: 'info' | 'success' | 'warning' | 'error' | 'neutral'
  meta:     Record<string, unknown>
}

interface DailyRecord {
  status:           string
  work_hours:       number
  late_minutes:     number
  overtime_minutes: number
  is_payable:       boolean
}

interface ForensicsResponse {
  employee:     { id: string; name: string; code: string }
  date:         string
  // Unified provenance fields
  source_type:  'biometric' | 'csv_upload' | 'mixed' | 'none'
  computed_source: string | null
  daily_record: DailyRecord | null
  timeline:     TimelineEvent[]
  // Pipeline A (biometric)
  raw_punches:  Array<{ id: string; punch_time: string; direction: string | null }>
  // Pipeline B (CSV upload)
  csv_punches:  Array<{ id: string; punched_at: string; direction: string | null; source: string }>
  corrections:  Array<{ id: string; status: string; reason: string | null; created_at: string }>
}

// ── Severity styling ──────────────────────────────────────────────────────────

const SEVERITY: Record<string, { dot: string; icon: string; bg: string }> = {
  success: { dot: 'bg-success',              icon: 'text-success',     bg: 'bg-success/10 border-success/20' },
  info:    { dot: 'bg-info',                 icon: 'text-info',        bg: 'bg-info/10 border-info/20' },
  warning: { dot: 'bg-warning',              icon: 'text-warning',     bg: 'bg-warning/10 border-warning/20' },
  error:   { dot: 'bg-destructive',          icon: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20' },
  neutral: { dot: 'bg-muted-foreground/30',  icon: 'text-muted-foreground', bg: 'bg-muted/30 border-border/40' },
}

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  half_day:   'secondary',
  leave:      'outline',
  holiday:    'outline',
  weekend:    'outline',
  weekly_off: 'outline',
}

function iconForType(type: string): React.ComponentType<{ className?: string }> {
  const m: Record<string, React.ComponentType<{ className?: string }>> = {
    raw_punch:            Wifi,
    csv_punch:            Upload,
    recompute_job:        RefreshCw,
    session_paired:       Clock,
    shift_resolved:       AlarmClock,
    holiday:              CalendarDays,
    weekly_off:           CalendarDays,
    computation_result:   Terminal,
    leave_applied:        ClipboardEdit,
    leave_approved:       CheckCircle2,
    leave_rejected:       XCircle,
    correction_requested: ClipboardEdit,
    correction_approved:  ClipboardCheck,
    correction_rejected:  XCircle,
    status_change:        Zap,
    policy_evaluated:     ShieldCheck,
  }
  return m[type] ?? Info
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

// ── Timeline event row ────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: TimelineEvent }) {
  const [open, setOpen] = useState(false)
  const s   = SEVERITY[ev.severity] ?? SEVERITY.neutral
  const Icon = iconForType(ev.type)
  const hasMeta = Object.keys(ev.meta).length > 0

  return (
    <div className="relative flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className={cn('w-2 h-2 rounded-full ring-2 ring-background mt-[5px] flex-shrink-0', s.dot)} />
        <div className="w-px flex-1 bg-border/40 mt-1" style={{ minHeight: 10 }} />
      </div>
      <div className={cn('flex-1 mb-2.5 rounded-md border text-xs overflow-hidden', s.bg)}>
        <div className="flex items-start gap-2 p-2">
          <Icon className={cn('h-3 w-3 mt-0.5 flex-shrink-0', s.icon)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <p className="font-medium text-foreground leading-snug">{ev.label}</p>
              {ev.time && <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">{fmtTime(ev.time)}</span>}
            </div>
            {ev.detail && <p className="text-muted-foreground mt-0.5 leading-snug">{ev.detail}</p>}
            {ev.actor && ev.actor !== 'system' && ev.actor !== 'device' && ev.actor !== 'employee' && (
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <User className="h-2.5 w-2.5" />{ev.actor}
              </p>
            )}
          </div>
          {hasMeta && (
            <button onClick={() => setOpen(v => !v)} className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/60 flex-shrink-0">
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
        {open && hasMeta && (
          <div className="border-t border-border/30 px-2.5 py-1.5">
            <pre className="text-[10px] text-muted-foreground overflow-auto max-h-24 font-mono leading-relaxed">
              {JSON.stringify(ev.meta, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Filters ───────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'anomalies' | 'approvals' | 'policy'

function filterEvents(events: TimelineEvent[], mode: FilterMode): TimelineEvent[] {
  if (mode === 'all') return events
  if (mode === 'anomalies')
    return events.filter(e => ['raw_punch', 'csv_punch', 'session_paired', 'recompute_job', 'shift_resolved', 'computation_result', 'status_change'].includes(e.type) || e.severity === 'warning' || e.severity === 'error')
  if (mode === 'approvals')
    return events.filter(e => ['leave_applied', 'leave_approved', 'leave_rejected', 'correction_requested', 'correction_approved', 'correction_rejected'].includes(e.type))
  if (mode === 'policy')
    return events.filter(e => e.type === 'policy_evaluated')
  return events
}

// ── Main drawer ───────────────────────────────────────────────────────────────

interface ForensicsTarget {
  employeeId: string
  date:       string
  /** Optional: name shown in the header while loading */
  employeeName?: string
}

interface ForensicsDrawerProps {
  target:   ForensicsTarget | null
  onClose:  () => void
}

export function ForensicsDrawer({ target, onClose }: ForensicsDrawerProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  const { data, isLoading, isError } = useQuery<ForensicsResponse>({
    queryKey:  ['forensics-drawer', target?.employeeId, target?.date],
    queryFn:   () => api.get(`/attendance/forensics/${target!.employeeId}/${target!.date}`),
    enabled:   !!target,
    staleTime: 60_000,
  })

  const visibleEvents = data ? filterEvents(data.timeline, filterMode) : []

  const statusBadgeVariant = data?.daily_record?.status
    ? (STATUS_BADGE[data.daily_record.status] ?? 'secondary')
    : null

  return (
    <Sheet open={!!target} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent size="md">
        <SheetHeader>
          <div className="flex items-start justify-between pr-8">
            <div>
              <SheetTitle className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" />
                Attendance Forensics
              </SheetTitle>
              <SheetDescription>
                {target?.employeeName ?? 'Employee'} · {target?.date}
              </SheetDescription>
            </div>
            {data?.daily_record && statusBadgeVariant && (
              <Badge variant={statusBadgeVariant} className="rounded-full capitalize text-xs">
                {data.daily_record.status.replace('_', ' ')}
              </Badge>
            )}
          </div>

          {/* Daily metrics strip */}
          {data?.daily_record && (
            <div className="flex gap-3 mt-2 pt-2 border-t border-border/50">
              {[
                { l: 'Hours',   v: `${data.daily_record.work_hours}h` },
                { l: 'Late',    v: `${data.daily_record.late_minutes}m` },
                { l: 'OT',      v: `${data.daily_record.overtime_minutes}m` },
                { l: 'Payable', v: data.daily_record.is_payable ? 'Yes' : 'No' },
                // Show total punches across both pipelines — biometric + CSV
                {
                  l: data?.source_type === 'csv_upload' ? 'CSV Pnch'
                   : data?.source_type === 'biometric'  ? 'Dev Pnch'
                   : 'Punches',
                  v: (data?.raw_punches?.length ?? 0) + (data?.csv_punches?.length ?? 0),
                },
              ].map(({ l, v }) => (
                <div key={l} className="text-center">
                  <p className="text-[9px] text-muted-foreground">{l}</p>
                  <p className="text-xs font-semibold text-foreground">{v}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filter chips */}
          {data && data.timeline.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {(['all', 'anomalies', 'approvals', 'policy'] as FilterMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setFilterMode(m)}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize',
                    filterMode === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted',
                  )}
                >
                  {m === 'all' ? `All (${data.timeline.length})` : m}
                </button>
              ))}
            </div>
          )}
        </SheetHeader>

        <SheetBody>
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-3">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center py-12 gap-2 text-center">
              <XCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-destructive">Failed to load forensics data</p>
            </div>
          )}

          {data && visibleEvents.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-2 text-center">
              <Info className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No events match this filter.</p>
            </div>
          )}

          {data && visibleEvents.length > 0 && (
            <div className="pt-1">
              {visibleEvents.map((ev, i) => (
                <EventRow key={i} ev={ev} />
              ))}
              <div className="flex items-center gap-2 ml-[5px]">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/20 ring-2 ring-background" />
                <span className="text-[10px] text-muted-foreground/40">end of trace</span>
              </div>
            </div>
          )}
        </SheetBody>

        {/* Footer — deep link to full forensics page */}
        {target && (
          <div className="px-6 py-3 border-t border-border flex-shrink-0">
            <Link
              to={forensicsUrl(target.employeeId, target.date)}
              onClick={onClose}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open full forensics page
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
