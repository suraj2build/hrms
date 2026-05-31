/**
 * PayrollForensics — /admin/payroll/forensics
 *
 * Four-tab forensic workspace:
 *   1. Timeline     — append-only audit log of every payroll event
 *   2. Snapshots    — immutable snapshot manifest per finalized run
 *   3. Replay       — run a replay session and inspect variance
 *   4. Integrity    — verify SHA-256 hashes against stored blobs
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }   from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Search, Filter, RefreshCw,
  Play, CheckCircle2, XCircle, AlertTriangle,
  Lock, Unlock, RotateCcw, Loader2,
  Calendar, ChevronDown, ChevronRight,
  ShieldAlert, DollarSign, FileText, Zap,
  Database, Shield, GitBranch,
  Hash, TrendingDown, TrendingUp,
  BookOpen, Scale,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ForensicEvent {
  id:            string
  run_id:        string | null
  event_type:    string
  employee_id:   string | null
  month:         string | null
  payload:       Record<string, unknown> | null
  error_details: Record<string, unknown> | null
  created_at:    string
  payroll_runs:  { month: string; status: string } | null
  employees:     { employee_code: string; profiles: { full_name: string } | null } | null
}

interface RunSnapshot {
  id:                       string
  run_id:                   string
  month:                    string
  snapshot_version:         number
  integrity_hash:           string
  replayable:               boolean
  formula_engine_version:   number
  validation_engine_version: number
  created_at:               string
  employee_count:           number
}

interface ReplayVarianceEntry {
  employee_id:          string
  employee_code:        string
  employee_name:        string
  original_net_pay:     number
  replayed_net_pay:     number
  variance_amount:      number
  variance_pct:         number
  original_gross:       number
  replayed_gross:       number
  variance_reason:      string
  changed_dependencies: string[]
}

interface ReplayResult {
  run_id:            string
  replay_type:       string
  total_employees:   number
  matched:           number
  diverged:          number
  variance_detected: boolean
  employee_diffs:    ReplayVarianceEntry[]
  replayed_at:       string
}

interface ReplaySession {
  id:               string
  replay_type:      string
  triggered_at:     string
  result_status:    string
  variance_detected: boolean
  variance_summary: Record<string, number> | null
  completed_at:     string | null
}

interface PayrollRun {
  id:    string
  month: string
  status: string
  snapshot_id: string | null
}

// ── Event type config ──────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, {
  label:   string
  icon:    React.ReactNode
  color:   string
  variant: 'success' | 'destructive' | 'warning' | 'secondary' | 'outline' | 'info'
}> = {
  run_started:              { label: 'Run Started',           icon: <Play className="h-3 w-3" />,          color: 'text-info',            variant: 'secondary' },
  run_completed:            { label: 'Run Completed',          icon: <CheckCircle2 className="h-3 w-3" />,  color: 'text-success',         variant: 'success' },
  run_finalized:            { label: 'Finalized',              icon: <Lock className="h-3 w-3" />,          color: 'text-success',         variant: 'success' },
  run_rolled_back:          { label: 'Rolled Back',            icon: <RotateCcw className="h-3 w-3" />,     color: 'text-warning',         variant: 'warning' },
  run_frozen:               { label: 'Month Frozen',           icon: <Lock className="h-3 w-3" />,          color: 'text-info',            variant: 'secondary' },
  run_unfrozen:             { label: 'Month Unfrozen',         icon: <Unlock className="h-3 w-3" />,        color: 'text-warning',         variant: 'warning' },
  dry_run_completed:        { label: 'Dry Run',                icon: <Zap className="h-3 w-3" />,           color: 'text-muted-foreground', variant: 'outline' },
  slip_computed:            { label: 'Slip Computed',          icon: <FileText className="h-3 w-3" />,      color: 'text-success',         variant: 'success' },
  slip_insert_failed:       { label: 'Slip Insert Failed',     icon: <XCircle className="h-3 w-3" />,       color: 'text-destructive',     variant: 'destructive' },
  validation_failed:        { label: 'Validation Failed',      icon: <AlertTriangle className="h-3 w-3" />, color: 'text-destructive',     variant: 'destructive' },
  data_fetch_failed:        { label: 'Data Fetch Failed',      icon: <AlertTriangle className="h-3 w-3" />, color: 'text-destructive',     variant: 'destructive' },
  compensation_missing:     { label: 'Compensation Missing',   icon: <ShieldAlert className="h-3 w-3" />,   color: 'text-warning',         variant: 'warning' },
  compensation_invalid:     { label: 'Compensation Invalid',   icon: <ShieldAlert className="h-3 w-3" />,   color: 'text-warning',         variant: 'warning' },
  blocker_resolved:         { label: 'Blocker Resolved',       icon: <CheckCircle2 className="h-3 w-3" />,  color: 'text-success',         variant: 'success' },
  approval_submitted:       { label: 'Approval Submitted',     icon: <FileText className="h-3 w-3" />,      color: 'text-info',            variant: 'secondary' },
  approval_approved:        { label: 'Approved',               icon: <CheckCircle2 className="h-3 w-3" />,  color: 'text-success',         variant: 'success' },
  approval_rejected:        { label: 'Rejected',               icon: <XCircle className="h-3 w-3" />,       color: 'text-destructive',     variant: 'destructive' },
  slip_regenerated:         { label: 'Slip Regenerated',       icon: <RefreshCw className="h-3 w-3" />,     color: 'text-info',            variant: 'secondary' },
  payout_initiated:         { label: 'Payout Initiated',       icon: <DollarSign className="h-3 w-3" />,    color: 'text-success',         variant: 'success' },
  payout_failed:            { label: 'Payout Failed',          icon: <XCircle className="h-3 w-3" />,       color: 'text-destructive',     variant: 'destructive' },
  payout_reversed:          { label: 'Payout Reversed',        icon: <RotateCcw className="h-3 w-3" />,     color: 'text-warning',         variant: 'warning' },
  override_applied:         { label: 'Override Applied',       icon: <ShieldAlert className="h-3 w-3" />,   color: 'text-warning',         variant: 'warning' },
  snapshot_created:         { label: 'Snapshot Created',       icon: <Database className="h-3 w-3" />,      color: 'text-success',         variant: 'success' },
  snapshot_verified:        { label: 'Integrity Verified',     icon: <Shield className="h-3 w-3" />,        color: 'text-success',         variant: 'success' },
  snapshot_integrity_failed:{ label: 'Integrity FAILED',       icon: <Shield className="h-3 w-3" />,        color: 'text-destructive',     variant: 'destructive' },
  replay_completed:         { label: 'Replay Completed',       icon: <GitBranch className="h-3 w-3" />,     color: 'text-success',         variant: 'success' },
  replay_variance_found:    { label: 'Replay Variance',        icon: <GitBranch className="h-3 w-3" />,     color: 'text-warning',         variant: 'warning' },
}

const EVENT_CATEGORIES = [
  { key: 'all',       label: 'All Events' },
  { key: 'run',       label: 'Run Lifecycle',   events: ['run_started', 'run_completed', 'run_finalized', 'run_rolled_back', 'dry_run_completed'] },
  { key: 'freeze',    label: 'Freeze/Unfreeze', events: ['run_frozen', 'run_unfrozen'] },
  { key: 'failures',  label: 'Failures',        events: ['slip_insert_failed', 'validation_failed', 'data_fetch_failed', 'compensation_missing', 'compensation_invalid'] },
  { key: 'approvals', label: 'Approvals',       events: ['approval_submitted', 'approval_approved', 'approval_rejected', 'blocker_resolved'] },
  { key: 'payouts',   label: 'Payouts',         events: ['payout_initiated', 'payout_failed', 'payout_reversed'] },
  { key: 'overrides', label: 'Overrides',       events: ['override_applied'] },
  { key: 'snapshot',  label: 'Snapshots',       events: ['snapshot_created', 'snapshot_verified', 'snapshot_integrity_failed', 'replay_completed', 'replay_variance_found'] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(s: string) {
  const iso = s
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}
function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

// ── Timeline Event Row ─────────────────────────────────────────────────────────

function EventRow({ event }: { event: ForensicEvent }) {
  const [expanded, setExpanded] = useState(false)
  const cfg  = EVENT_CONFIG[event.event_type] ?? { label: event.event_type, icon: <Activity className="h-3 w-3" />, color: 'text-muted-foreground', variant: 'outline' as const }
  const empName  = event.employees?.profiles?.full_name ?? null
  const empCode  = event.employees?.employee_code ?? null
  const runMonth = event.payroll_runs?.month ?? event.month ?? null
  const hasPayload = event.payload && Object.keys(event.payload).length > 0
  const hasError   = event.error_details && Object.keys(event.error_details).length > 0

  return (
    <div className="flex gap-3 group">
      <div className="flex flex-col items-center">
        <div className={cn('flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center', cfg.color,
          event.event_type.includes('fail') || event.event_type.includes('reject') ? 'border-destructive/40 bg-destructive/10'
            : event.event_type.includes('frozen') || event.event_type.includes('override') ? 'border-warning/40 bg-warning/10'
            : event.event_type.includes('snapshot') || event.event_type.includes('replay') ? 'border-info/40 bg-info/10'
            : 'border-success/30 bg-success/5',
        )}>
          {cfg.icon}
        </div>
        <div className="w-px flex-1 bg-border/40 mt-1" />
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <button className="w-full text-left" onClick={() => setExpanded(v => !v)}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={cfg.variant as any} className="rounded-full text-[9px] gap-1">{cfg.icon}{cfg.label}</Badge>
              {runMonth && <span className="text-xs text-muted-foreground">{fmtMonth(runMonth)}</span>}
              {empName  && <span className="text-xs text-foreground font-medium">{empName}</span>}
              {empCode  && <span className="text-[10px] text-muted-foreground font-mono">{empCode}</span>}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtDateTime(event.created_at)}</span>
              {(hasPayload || hasError) && (expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />)}
            </div>
          </div>
        </button>
        {expanded && (hasPayload || hasError) && (
          <div className="mt-2 space-y-2">
            {hasPayload && (
              <div className="rounded-md bg-muted/30 border border-border/50 p-2">
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Payload</p>
                <pre className="text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">{JSON.stringify(event.payload, null, 2)}</pre>
              </div>
            )}
            {hasError && (
              <div className="rounded-md bg-destructive/5 border border-destructive/20 p-2">
                <p className="text-[10px] font-semibold text-destructive mb-1">Error Details</p>
                <pre className="text-[10px] text-destructive overflow-x-auto whitespace-pre-wrap">{JSON.stringify(event.error_details, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Snapshot Card ─────────────────────────────────────────────────────────────

function SnapshotCard({ snap }: { snap: RunSnapshot; run?: PayrollRun }) {
  return (
    <div className="p-4 rounded-xl border border-border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-info" />
          <span className="text-sm font-semibold">{fmtMonth(snap.month)}</span>
        </div>
        {snap.replayable
          ? <Badge variant="outline" className="text-success border-success/40 text-[9px] rounded-full gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Replayable</Badge>
          : <Badge variant="outline" className="text-muted-foreground border-border text-[9px] rounded-full">Archived</Badge>
        }
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Run</span>
          <span className="font-mono text-[10px] text-muted-foreground">{snap.run_id.slice(0, 8)}…</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Employees</span>
          <span className="font-medium tabular-nums">{snap.employee_count}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Snapshot v</span>
          <span className="font-mono text-[10px]">v{snap.snapshot_version}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Formula engine</span>
          <span className="font-mono text-[10px]">v{snap.formula_engine_version}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Validation engine</span>
          <span className="font-mono text-[10px]">v{snap.validation_engine_version}</span>
        </div>
        <div className="h-px bg-border/50 my-1" />
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Integrity hash</span>
          <span className="font-mono text-[9px] text-muted-foreground/70 truncate max-w-[120px]" title={snap.integrity_hash}>
            {snap.integrity_hash ? snap.integrity_hash.slice(0, 12) + '…' : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Created</span>
          <span className="text-[10px]">{fmtDateTime(snap.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Replay Variance Row ────────────────────────────────────────────────────────

function VarianceRow({ entry }: { entry: ReplayVarianceEntry }) {
  const pct = Math.abs(entry.variance_pct)
  return (
    <tr className="border-b border-border/50 hover:bg-muted/20">
      <td className="px-4 py-2.5">
        <div className="font-medium text-xs">{entry.employee_name || '—'}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{entry.employee_code}</div>
      </td>
      <td className="px-4 py-2.5 tabular-nums text-xs">{fmtCurrency(entry.original_net_pay)}</td>
      <td className="px-4 py-2.5 tabular-nums text-xs">{fmtCurrency(entry.replayed_net_pay)}</td>
      <td className={cn('px-4 py-2.5 tabular-nums text-xs font-semibold', entry.variance_amount > 0 ? 'text-success' : 'text-destructive')}>
        {entry.variance_amount >= 0 ? '+' : ''}{fmtCurrency(entry.variance_amount)}
        <span className="text-[9px] ml-1 opacity-70">({pct.toFixed(1)}%)</span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex gap-1 flex-wrap">
          {entry.changed_dependencies.map(d => (
            <Badge key={d} variant="outline" className="text-[8px] rounded-full">{d}</Badge>
          ))}
          {entry.changed_dependencies.length === 0 && (
            <span className="text-[10px] text-muted-foreground">unknown</span>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollForensics() {
  const [activeTab, setActiveTab]         = useState<'timeline' | 'snapshots' | 'replay' | 'integrity' | 'ledger'>('timeline')
  const [category, setCategory]           = useState('all')
  const [search, setSearch]               = useState('')
  const [monthFilter, setMonthFilter]     = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined)
  const [replayType, setReplayType]       = useState<'dry_replay' | 'variance_replay' | 'audit_replay'>('audit_replay')
  const [replayResult, setReplayResult]   = useState<ReplayResult | null>(null)
  const [integrityResult, setIntegrityResult] = useState<{ valid: boolean; stored_hash: string; computed_hash: string; employee_count: number } | null>(null)

  const queryClient = useQueryClient()

  // ── Runs list ──────────────────────────────────────────────────────────────
  const { data: runsRaw } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-forensics'],
    queryFn:  () => api.get('/payroll/runs?limit=24'),
    staleTime: 60_000,
  })
  const runs      = runsRaw?.data ?? []
  const finalRuns = runs.filter(r => r.status === 'finalized')

  // ── Timeline events ────────────────────────────────────────────────────────
  const { data: eventsRaw, isLoading: eventsLoading, refetch: refetchEvents } = useQuery<{ data: ForensicEvent[]; total: number }>({
    queryKey: ['payroll-forensics', monthFilter],
    queryFn:  () => {
      const params = new URLSearchParams({ limit: '200' })
      if (monthFilter) params.set('month', monthFilter)
      return api.get(`/payroll/forensics?${params}`)
    },
    staleTime: 30_000,
    enabled: activeTab === 'timeline',
  })
  const allEvents = eventsRaw?.data ?? []
  const total     = eventsRaw?.total ?? 0

  // ── Snapshot for selected run ──────────────────────────────────────────────
  const { data: snapshotRaw, isLoading: snapLoading } = useQuery<{ data: RunSnapshot }>({
    queryKey: ['run-snapshot', selectedRunId],
    queryFn:  () => api.get(`/payroll/runs/${selectedRunId}/snapshot`),
    enabled:  !!selectedRunId && (activeTab === 'snapshots' || activeTab === 'replay' || activeTab === 'integrity'),
    staleTime: 60_000,
  })
  const snapshot = snapshotRaw?.data ?? null

  // ── Ledger data ────────────────────────────────────────────────────────────
  const { data: ledgerRaw, isLoading: ledgerLoading } = useQuery<{ data: Array<{
    id: string; ledger_month: string; ledger_type: string; ledger_status: string
    total_debit: number; total_credit: number; integrity_hash: string | null
    posted_at: string | null; created_at: string
  }> }>({
    queryKey: ['forensics-ledger', selectedRunId],
    queryFn:  () => api.get(`/payroll/runs/${selectedRunId}/ledger`),
    enabled:  !!selectedRunId && activeTab === 'ledger',
    staleTime: 30_000,
  })
  const forensicsLedgers = ledgerRaw?.data ?? []

  // ── GL summary ─────────────────────────────────────────────────────────────
  const { data: glEntryRaw, isLoading: glEntryLoading } = useQuery<{ data: Array<{
    id: string; entry_type: string; gl_account_code: string; gl_account_name: string
    debit_amount: number; credit_amount: number; description: string
    accounting_date: string; journal_reference: string | null
  }>; total: number }>({
    queryKey: ['forensics-ledger-entries', selectedRunId],
    queryFn:  () => {
      const ledgerId = forensicsLedgers[0]?.id
      return ledgerId ? api.get(`/payroll/ledgers/${ledgerId}/entries?limit=100`) : Promise.resolve({ data: [], total: 0 })
    },
    enabled:  !!selectedRunId && activeTab === 'ledger' && forensicsLedgers.length > 0,
    staleTime: 60_000,
  })
  const glEntries = glEntryRaw?.data ?? []

  // ── Replay sessions ────────────────────────────────────────────────────────
  const { data: sessionsRaw, isLoading: sessionsLoading } = useQuery<{ data: ReplaySession[] }>({
    queryKey: ['replay-sessions', selectedRunId],
    queryFn:  () => api.get(`/payroll/runs/${selectedRunId}/replay-sessions`),
    enabled:  !!selectedRunId && activeTab === 'replay',
    staleTime: 30_000,
  })
  const replaySessions = sessionsRaw?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────
  const replayMutation = useMutation({
    mutationFn: ({ runId, type }: { runId: string; type: string }) =>
      api.post(`/payroll/runs/${runId}/replay`, { replay_type: type }),
    onSuccess: (res: any) => {
      setReplayResult(res.data)
      queryClient.invalidateQueries({ queryKey: ['replay-sessions', selectedRunId] })
      if (res.data?.variance_detected) {
        toast.warning(`Replay complete — ${res.data.diverged} employees show variance`)
      } else {
        toast.success(`Replay complete — all ${res.data?.total_employees} employees match`)
      }
    },
    onError: () => toast.error('Replay failed'),
  })

  const verifyMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/payroll/runs/${runId}/verify-integrity`, {}),
    onSuccess: (res: any) => {
      setIntegrityResult(res.data)
      if (res.data?.valid) {
        toast.success('Integrity verified — snapshot is intact')
      } else {
        toast.error('INTEGRITY FAILURE — snapshot hash mismatch detected!')
      }
    },
    onError: () => toast.error('Integrity verification failed'),
  })

  // ── Filtered events ────────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    let events = allEvents
    if (category !== 'all') {
      const cat = EVENT_CATEGORIES.find(c => c.key === category)
      if (cat?.events) events = events.filter(e => cat.events!.includes(e.event_type))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      events = events.filter(e =>
        e.event_type.includes(q) ||
        (e.employees?.profiles?.full_name ?? '').toLowerCase().includes(q) ||
        (e.employees?.employee_code ?? '').toLowerCase().includes(q) ||
        (e.month ?? '').includes(q),
      )
    }
    return events
  }, [allEvents, category, search])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const failureCount  = allEvents.filter(e => e.event_type.includes('fail') || e.event_type.includes('reject')).length
  const overrideCount = allEvents.filter(e => e.event_type === 'override_applied').length
  const finalizeCount = allEvents.filter(e => e.event_type === 'run_finalized').length
  const freezeCount   = allEvents.filter(e => e.event_type === 'run_frozen' || e.event_type === 'run_unfrozen').length
  const snapCount     = allEvents.filter(e => e.event_type === 'snapshot_created').length

  const TABS = [
    { key: 'timeline',  label: 'Timeline',   icon: <Activity className="h-3.5 w-3.5" /> },
    { key: 'snapshots', label: 'Snapshots',  icon: <Database className="h-3.5 w-3.5" /> },
    { key: 'replay',    label: 'Replay',     icon: <GitBranch className="h-3.5 w-3.5" /> },
    { key: 'integrity', label: 'Integrity',  icon: <Hash className="h-3.5 w-3.5" /> },
    { key: 'ledger',    label: 'Ledger',     icon: <BookOpen className="h-3.5 w-3.5" /> },
  ] as const

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Forensics"
        subtitle="Immutable audit trail · Snapshot registry · Deterministic replay · Integrity verification"
        actions={
          <Button size="sm" variant="outline" onClick={() => { refetchEvents(); queryClient.invalidateQueries({ queryKey: ['run-snapshot'] }) }} disabled={eventsLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', eventsLoading && 'animate-spin')} />Refresh
          </Button>
        }
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { label: 'Total Events',     value: total,                         color: '' },
          { label: 'Failures',         value: failureCount,                  color: failureCount > 0 ? 'text-destructive' : 'text-success' },
          { label: 'Finalizations',    value: finalizeCount,                 color: '' },
          { label: 'Freeze/Override',  value: freezeCount + overrideCount,   color: (freezeCount + overrideCount) > 0 ? 'text-warning' : '' },
          { label: 'Snapshots',        value: snapCount,                     color: 'text-info' },
        ].map(k => (
          <div key={k.label} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-card">
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
            <p className={cn('text-xl font-bold tabular-nums', k.color, eventsLoading && 'animate-pulse text-muted-foreground/30')}>
              {eventsLoading ? '—' : k.value}
            </p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border border-border rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              activeTab === t.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Timeline ── */}
      {activeTab === 'timeline' && (
        <>
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <button onClick={() => setMonthFilter('')} className={cn('flex-shrink-0 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors', !monthFilter ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>All Months</button>
              {runs.map(r => (
                <button key={r.month} onClick={() => setMonthFilter(r.month)} className={cn('flex-shrink-0 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors', monthFilter === r.month ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                  {fmtMonth(r.month)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mr-1" />
              {EVENT_CATEGORIES.map(c => (
                <button key={c.key} onClick={() => setCategory(c.key)} className={cn('flex-shrink-0 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors', category === c.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8 h-8 text-xs" placeholder="Search event type, employee name, month…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          <SectionCard title={`Audit Timeline (${filteredEvents.length})`} icon={<Activity className="h-4 w-4" />} description="Append-only forensic log — immutable record of all payroll events">
            <div className="p-4">
              {eventsLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
              ) : filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-muted-foreground"><Activity className="h-8 w-8 opacity-30" /><p className="text-sm">No events match this filter</p></div>
              ) : (
                <div>{filteredEvents.map(event => <EventRow key={event.id} event={event} />)}</div>
              )}
            </div>
          </SectionCard>
        </>
      )}

      {/* ── Tab: Snapshots ── */}
      {activeTab === 'snapshots' && (
        <div className="space-y-4">
          <SectionCard title="Run Selector" icon={<Database className="h-4 w-4" />} description="Select a finalized run to inspect its immutable snapshot">
            <div className="p-4 flex flex-wrap gap-2">
              {finalRuns.length === 0 && <p className="text-xs text-muted-foreground">No finalized runs found</p>}
              {finalRuns.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRunId(r.id)}
                  className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}
                >
                  {fmtMonth(r.month)}
                  {r.snapshot_id ? <span className="ml-1 opacity-60">📸</span> : <span className="ml-1 opacity-40">○</span>}
                </button>
              ))}
            </div>
          </SectionCard>

          {selectedRunId && (
            snapLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm p-6"><Loader2 className="h-4 w-4 animate-spin" />Loading snapshot…</div>
            ) : snapshot ? (
              <div className="space-y-4">
                <SectionCard title="Snapshot Manifest" icon={<Database className="h-4 w-4" />} description="Top-level immutable metadata for this finalized run">
                  <div className="p-4">
                    <SnapshotCard snap={snapshot} run={finalRuns.find(r => r.id === selectedRunId)!} />
                  </div>
                </SectionCard>

                <SectionCard title="Dependency Summary" icon={<Shield className="h-4 w-4" />} description="What was captured in this snapshot">
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {[
                      { label: 'Attendance snapshot', desc: `Daily attendance rows for all ${snapshot.employee_count} employees — payable days, LOP, OT` },
                      { label: 'Compensation snapshot', desc: 'Active CTC, component definitions, effective_from date at time of finalization' },
                      { label: 'Formula snapshot', desc: `Engine v${snapshot.formula_engine_version} — all expression strings and resolved values` },
                      { label: 'Statutory snapshot', desc: 'PF, ESI, PT slabs, TDS config as they existed at run time' },
                      { label: 'Validation snapshot', desc: `Engine v${snapshot.validation_engine_version} — enabled rules, severity, thresholds` },
                      { label: 'Integrity hash', desc: `SHA-256 of combined sorted employee blobs — ${snapshot.integrity_hash.slice(0, 8)}…` },
                    ].map(item => (
                      <div key={item.label} className="p-3 rounded-lg border border-border bg-muted/10">
                        <div className="flex items-center gap-1.5 mb-1">
                          <CheckCircle2 className="h-3 w-3 text-success" />
                          <span className="font-semibold">{item.label}</span>
                        </div>
                        <p className="text-muted-foreground text-[10px]">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
                <Database className="h-8 w-8 opacity-30" />
                <p className="text-sm">No snapshot found — this run was finalized before snapshot engine deployment</p>
              </div>
            )
          )}
        </div>
      )}

      {/* ── Tab: Replay ── */}
      {activeTab === 'replay' && (
        <div className="space-y-4">
          <SectionCard title="Run Replay" icon={<GitBranch className="h-4 w-4" />} description="Replay a finalized run using only snapshot data — never queries live tables">
            <div className="p-4 space-y-4">
              {/* Run selector */}
              <div>
                <p className="text-xs font-medium mb-2">Select run</p>
                <div className="flex flex-wrap gap-2">
                  {finalRuns.map(r => (
                    <button key={r.id} onClick={() => { setSelectedRunId(r.id); setReplayResult(null) }}
                      className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                      {fmtMonth(r.month)}{r.snapshot_id ? ' 📸' : ' ⚠️'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Replay mode */}
              <div>
                <p className="text-xs font-medium mb-2">Replay mode</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: 'audit_replay',    label: 'Audit Replay',    desc: 'Full reconstruction for audit purposes' },
                    { key: 'variance_replay', label: 'Variance Replay', desc: 'Compare historical vs current engine' },
                    { key: 'dry_replay',      label: 'Dry Replay',      desc: 'Compute only — no DB write' },
                  ] as const).map(m => (
                    <button key={m.key} onClick={() => setReplayType(m.key)}
                      className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', replayType === m.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}
                      title={m.desc}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                size="sm"
                disabled={!selectedRunId || replayMutation.isPending}
                onClick={() => selectedRunId && replayMutation.mutate({ runId: selectedRunId, type: replayType })}
              >
                {replayMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running Replay…</> : <><Play className="h-3.5 w-3.5 mr-1.5" />Run Replay</>}
              </Button>
            </div>
          </SectionCard>

          {/* Replay result */}
          {replayResult && (
            <SectionCard title="Replay Result" icon={<GitBranch className="h-4 w-4" />} description={`${replayResult.replay_type} · ${fmtDateTime(replayResult.replayed_at)}`}>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total employees', value: replayResult.total_employees, color: '' },
                    { label: 'Matched',          value: replayResult.matched,          color: 'text-success' },
                    { label: 'Diverged',         value: replayResult.diverged,         color: replayResult.diverged > 0 ? 'text-destructive' : 'text-success' },
                    { label: 'Status',           value: replayResult.variance_detected ? 'VARIANCE' : 'CLEAN', color: replayResult.variance_detected ? 'text-warning' : 'text-success' },
                  ].map(k => (
                    <div key={k.label} className="p-3 rounded-lg border border-border bg-card">
                      <p className="text-[10px] text-muted-foreground">{k.label}</p>
                      <p className={cn('text-lg font-bold tabular-nums', k.color)}>{k.value}</p>
                    </div>
                  ))}
                </div>

                {replayResult.diverged > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2 text-destructive">Variance Details ({replayResult.diverged} employees)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            {['Employee', 'Original Net', 'Replayed Net', 'Variance', 'Changed Deps'].map(h => (
                              <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {replayResult.employee_diffs.map(entry => <VarianceRow key={entry.employee_id} entry={entry} />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {replayResult.diverged === 0 && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-success/5 border border-success/30">
                    <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-success">Deterministic Replay — Perfect Match</p>
                      <p className="text-xs text-muted-foreground mt-0.5">All {replayResult.total_employees} employees reproduced bit-identical results from snapshot data.</p>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Prior sessions */}
          {selectedRunId && (
            <SectionCard title="Replay History" icon={<Activity className="h-4 w-4" />} description="All replay sessions for this run">
              <div className="divide-y divide-border">
                {sessionsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm p-4"><Loader2 className="h-3 w-3 animate-spin" />Loading sessions…</div>
                ) : replaySessions.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">No replay sessions yet</div>
                ) : (
                  replaySessions.map(s => (
                    <div key={s.id} className="flex items-center justify-between px-4 py-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="rounded-full text-[9px]">{s.replay_type.replace('_', ' ')}</Badge>
                        <span className="text-muted-foreground">{fmtDateTime(s.triggered_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.variance_detected
                          ? <Badge variant="outline" className="text-warning border-warning/40 text-[9px] rounded-full gap-1"><TrendingDown className="h-2.5 w-2.5" />{s.variance_summary?.diverged ?? '?'} diff</Badge>
                          : <Badge variant="outline" className="text-success border-success/40 text-[9px] rounded-full gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Clean</Badge>
                        }
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Tab: Integrity ── */}
      {activeTab === 'integrity' && (
        <div className="space-y-4">
          <SectionCard title="Integrity Verification" icon={<Hash className="h-4 w-4" />} description="Recompute snapshot hash and compare to stored value — detects silent data mutation">
            <div className="p-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Each finalized payroll snapshot stores a SHA-256 digest computed over all employee
                input blobs (attendance, compensation, formulas, statutory config). Clicking <strong>Verify</strong> re-hashes
                the stored data and compares it to the persisted value. Any mismatch indicates that
                snapshot data was mutated after finalization.
              </p>

              <div className="flex flex-wrap gap-2">
                {finalRuns.map(r => (
                  <button key={r.id} onClick={() => { setSelectedRunId(r.id); setIntegrityResult(null) }}
                    className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                    {fmtMonth(r.month)}{r.snapshot_id ? ' 📸' : ' ⚠️'}
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={!selectedRunId || verifyMutation.isPending}
                onClick={() => selectedRunId && verifyMutation.mutate(selectedRunId)}
              >
                {verifyMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Verifying…</> : <><Shield className="h-3.5 w-3.5 mr-1.5" />Verify Integrity</>}
              </Button>
            </div>
          </SectionCard>

          {integrityResult && (
            <SectionCard
              title={integrityResult.valid ? 'Integrity Verified ✓' : 'INTEGRITY FAILURE ✗'}
              icon={integrityResult.valid ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
              description={`${integrityResult.employee_count} employee snapshot blobs hashed`}
            >
              <div className="p-4 space-y-3">
                <div className={cn('flex items-center gap-3 p-3 rounded-lg border', integrityResult.valid ? 'bg-success/5 border-success/30' : 'bg-destructive/5 border-destructive/30')}>
                  {integrityResult.valid
                    ? <><CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" /><div><p className="text-sm font-semibold text-success">Snapshot Intact</p><p className="text-xs text-muted-foreground mt-0.5">Hash matches — no mutation detected since finalization</p></div></>
                    : <><XCircle className="h-5 w-5 text-destructive flex-shrink-0" /><div><p className="text-sm font-semibold text-destructive">Hash Mismatch — Data Corrupted</p><p className="text-xs text-muted-foreground mt-0.5">Stored hash does not match recomputed hash. Snapshot data has been altered after finalization.</p></div></>
                  }
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex gap-3 items-start">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Stored hash</span>
                    <code className={cn('font-mono text-[10px] break-all', integrityResult.valid ? 'text-success' : 'text-destructive')}>{integrityResult.stored_hash || '—'}</code>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Computed hash</span>
                    <code className={cn('font-mono text-[10px] break-all', integrityResult.valid ? 'text-success' : 'text-warning')}>{integrityResult.computed_hash || '—'}</code>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Algorithm</span>
                    <code className="font-mono text-[10px]">SHA-256 / deterministic JSON sort</code>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="text-muted-foreground w-28 flex-shrink-0">Employees</span>
                    <code className="font-mono text-[10px]">{integrityResult.employee_count}</code>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Immutability enforcement notice */}
          <SectionCard title="Immutability Enforcement" icon={<Lock className="h-4 w-4" />} description="What is and isn't allowed after finalization">
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1.5">
                <p className="font-semibold text-success flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" />Permitted</p>
                {['Read snapshot data', 'Verify integrity hash', 'Run replay sessions', 'Export snapshot for audit'].map(a => (
                  <div key={a} className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />{a}</div>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-destructive flex items-center gap-1.5"><TrendingDown className="h-3.5 w-3.5" />Prohibited</p>
                {['Edit snapshot blobs', 'Delete employee snapshots', 'Regenerate snapshots silently', 'Overwrite integrity hash'].map(a => (
                  <div key={a} className="flex items-center gap-1.5 text-muted-foreground"><XCircle className="h-3 w-3 text-destructive flex-shrink-0" />{a}</div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
      )}
      {/* ── Tab: Ledger ── */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <SectionCard title="Run Selector" icon={<BookOpen className="h-4 w-4" />} description="Select a finalized run to inspect its accounting ledger">
            <div className="p-4 flex flex-wrap gap-2">
              {finalRuns.length === 0 && <p className="text-xs text-muted-foreground">No finalized runs found</p>}
              {finalRuns.map(r => (
                <button key={r.id} onClick={() => setSelectedRunId(r.id)}
                  className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                  {fmtMonth(r.month)}
                </button>
              ))}
            </div>
          </SectionCard>

          {selectedRunId && (
            ledgerLoading ? (
              <div className="flex gap-2 text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin" />Loading ledger…</div>
            ) : forensicsLedgers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground">
                <BookOpen className="h-8 w-8 opacity-30" />
                <p className="text-sm">No ledger for this run. Go to <strong>Accounting Center</strong> to generate one.</p>
              </div>
            ) : (
              <>
                {/* Ledger manifests */}
                <SectionCard title="Ledger Registry" icon={<Scale className="h-4 w-4" />} description="All ledgers for this run (payroll, accrual, reversals)">
                  <div className="divide-y divide-border">
                    {forensicsLedgers.map(l => {
                      const balanced = Math.abs((l.total_debit ?? 0) - (l.total_credit ?? 0)) < 0.01
                      return (
                        <div key={l.id} className="flex items-center justify-between px-4 py-3 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{fmtMonth(l.ledger_month)}</span>
                            <Badge variant="outline" className="text-[9px] rounded-full">{l.ledger_type}</Badge>
                            <Badge variant="outline" className={cn('text-[9px] rounded-full', l.ledger_status === 'posted' ? 'text-success border-success/40' : l.ledger_status === 'reversed' ? 'text-destructive border-destructive/40' : 'text-muted-foreground border-border')}>
                              {l.ledger_status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={cn('font-mono', balanced ? 'text-success' : 'text-destructive')}>
                              {balanced ? '✓ balanced' : '⚠ imbalanced'}
                            </span>
                            <span className="tabular-nums">{fmtCurrency(l.total_credit ?? 0)}</span>
                            <span className="font-mono text-[9px] text-muted-foreground/60">{l.integrity_hash?.slice(0, 8) ?? '—'}…</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </SectionCard>

                {/* Journal entries preview */}
                <SectionCard title="Journal Entries (latest ledger)" icon={<FileText className="h-4 w-4" />} description="Double-entry accounting rows — first 100 entries">
                  {glEntryLoading ? (
                    <div className="flex gap-2 text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin" />Loading entries…</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            {['Date','Journal Ref','GL Code','Account','Debit','Credit','Description'].map(h => (
                              <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {glEntries.map(e => (
                            <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="px-3 py-2 text-[10px] text-muted-foreground">{e.accounting_date}</td>
                              <td className="px-3 py-2 font-mono text-[9px] text-muted-foreground">{e.journal_reference ?? '—'}</td>
                              <td className="px-3 py-2 font-mono text-[10px]">{e.gl_account_code}</td>
                              <td className="px-3 py-2 max-w-[120px] truncate">{e.gl_account_name}</td>
                              <td className="px-3 py-2 tabular-nums text-destructive/80">{e.debit_amount > 0 ? fmtCurrency(e.debit_amount) : '—'}</td>
                              <td className="px-3 py-2 tabular-nums text-success/80">{e.credit_amount > 0 ? fmtCurrency(e.credit_amount) : '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground text-[10px] max-w-[160px] truncate">{e.description}</td>
                            </tr>
                          ))}
                          {glEntries.length === 0 && (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No entries</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SectionCard>
              </>
            )
          )}
        </div>
      )}
    </PageContainer>
  )
}
