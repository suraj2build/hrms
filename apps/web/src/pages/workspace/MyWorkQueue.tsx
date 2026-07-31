/**
 * MyWorkQueue — Daily Operations
 *
 * One table. Four KPIs. Filter chips.
 * Scan unresolved payroll-impacting exceptions. Resolve them. Move on.
 *
 * Removed: section sidebar, lane groups, momentum bar, TodaysMission strip,
 *          smart recommendation chips, queue mode selector, SLA theater,
 *          orchestration language, AI narration.
 *
 * Kept:    severity indicators, search, quick actions, bulk bar,
 *          keyboard shortcuts, employee resolution drawer.
 */

import { useState, useMemo, useEffect } from 'react'
import { useNavigate }                   from 'react-router-dom'
import { cn }                            from '@/lib/utils'
import { useOperationalQueue }           from '@/lib/queue/useOperationalQueue'
import type { OperationalQueueItem }     from '@/lib/queue/types'
import { EmployeeResolutionWorkspace }   from '@/components/queue/EmployeeResolutionWorkspace'
import { MetricCard, MetricRow }         from '@/components/dashboard/MetricCard'
import {
  CheckCircle2, XCircle, AlarmClock, ChevronsUp, ArrowUpRight,
  Search, Keyboard, RefreshCw, Loader2, AlertCircle,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// ── Filter chips ───────────────────────────────────────────────────────────────

type FilterChip = 'all' | 'regularisations' | 'corrections' | 'revisions' | 'leave' | 'ignored'

const CHIPS: { id: FilterChip; label: string }[] = [
  { id: 'all',            label: 'All'             },
  { id: 'regularisations',label: 'Regularisations' },
  { id: 'corrections',    label: 'Corrections'     },
  { id: 'revisions',      label: 'Revisions'       },
  { id: 'leave',          label: 'Leave'           },
  { id: 'ignored',        label: 'Snoozed'         },
]

function matchChip(item: OperationalQueueItem, chip: FilterChip): boolean {
  if (chip === 'all')             return true
  if (chip === 'ignored')         return item.status === 'snoozed'
  if (chip === 'regularisations') return item.queue_type === 'regularisation_pending'
  if (chip === 'corrections')     return ['correction_pending', 'missing_punch', 'biometric_failure', 'duplicate_entry', 'shift_conflict', 'ot_verification'].includes(item.queue_type)
  if (chip === 'revisions')       return item.queue_type === 'payroll_blocker'
  if (chip === 'leave')           return ['leave_conflict', 'roster_gap'].includes(item.queue_type)
  return true
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const QUEUE_LABELS: Record<string, string> = {
  missing_punch:          'Missing Punch',
  ot_verification:        'OT Review',
  shift_conflict:         'Shift Conflict',
  leave_conflict:         'Leave Conflict',
  payroll_blocker:        'Payroll Block',
  compliance_risk:        'Compliance',
  attendance_anomaly:     'Anomaly',
  correction_pending:     'Correction',
  regularisation_pending: 'Regularisation',
  roster_gap:             'Roster Gap',
  biometric_failure:      'Biometric',
  duplicate_entry:        'Duplicate',
}

function ago(dateStr: string): string {
  const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
  if (min < 1)   return 'just now'
  if (min < 60)  return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr  < 24)  return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

// Severity → design token classes
const SEV_BAR: Record<string, string> = {
  critical: 'bg-destructive',
  high:     'bg-warning',
  medium:   'bg-primary',
  low:      'bg-muted-foreground/40',
  info:     'bg-muted-foreground/20',
  snoozed:  'bg-muted-foreground/20',
}
const SEV_BADGE: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
  high:     'bg-warning/10     text-warning     border-warning/20',
  medium:   'bg-primary/10     text-primary     border-primary/20',
  low:      'bg-muted/60       text-muted-foreground border-border',
  info:     'bg-muted/60       text-muted-foreground border-border',
  snoozed:  'bg-muted/60       text-muted-foreground border-border',
}

// ── TableRow ───────────────────────────────────────────────────────────────────

interface RowProps {
  item:           OperationalQueueItem
  isFocused:      boolean
  isSelected:     boolean
  anySelected:    boolean
  onToggleSelect: (id: string) => void
  onApprove:      (id: string) => void
  onReject:       (id: string) => void
  onSnooze:       (id: string) => void
  onEscalate:     (id: string) => void
  onFocus:        (id: string) => void
  onOpen:         (item: OperationalQueueItem) => void
}

// Per-type action labels so the button tells the user exactly what will happen
const APPROVE_LABEL: Record<string, string> = {
  attendance_anomaly:     'Resolve',
  regularisation_pending: 'Approve',
  correction_pending:     'Approve',
  payroll_blocker:        'Approve',
  leave_conflict:         'Acknowledge',
  ot_verification:        'Approve',
}
const REJECT_LABEL: Record<string, string> = {
  attendance_anomaly:     'Dismiss (LOP)',
  regularisation_pending: 'Reject',
  correction_pending:     'Reject',
  payroll_blocker:        'Reject',
  leave_conflict:         'Snooze',
  ot_verification:        'Reject',
}

function TableRow({
  item, isFocused, isSelected, anySelected,
  onToggleSelect, onApprove, onReject, onSnooze, onEscalate, onFocus, onOpen,
}: RowProps) {
  const navigate    = useNavigate()
  const issueLabel  = QUEUE_LABELS[item.queue_type] ?? item.queue_type.replace(/_/g, ' ')
  const approveLabel = APPROVE_LABEL[item.queue_type] ?? 'Approve'
  const rejectLabel  = REJECT_LABEL[item.queue_type]  ?? 'Reject'

  return (
    <tr
      tabIndex={0}
      onClick={() => { onFocus(item.id); onOpen(item) }}
      onFocus={() => onFocus(item.id)}
      className={cn(
        'group relative border-b border-border/50 transition-colors cursor-pointer',
        isFocused || isSelected ? 'bg-primary/[0.04]' : 'hover:bg-muted/20',
      )}
    >
      {/* Severity bar */}
      <td className="w-0 p-0 relative">
        <div className={cn('absolute inset-y-0 left-0 w-[3px]', SEV_BAR[item.severity] ?? SEV_BAR.info)} />
      </td>

      {/* Checkbox */}
      <td className="pl-5 pr-2 py-3 w-8">
        <input
          type="checkbox"
          className={cn(
            'h-3 w-3 accent-primary rounded cursor-pointer transition-opacity',
            anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50',
          )}
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          onClick={e => e.stopPropagation()}
          aria-label={`Select ${item.title}`}
        />
      </td>

      {/* Priority */}
      <td className="px-3 py-3 w-24 align-middle">
        <span className={cn(
          'inline-flex text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border font-mono',
          SEV_BADGE[item.severity] ?? SEV_BADGE.info,
        )}>
          {item.severity}
        </span>
        {item.overdue && (
          <div className="text-[9px] font-mono text-destructive mt-0.5">overdue</div>
        )}
      </td>

      {/* Employee */}
      <td className="px-3 py-3 align-middle">
        {item.employee_name ? (
          <div>
            <p className="text-sm font-medium text-foreground leading-snug">{item.employee_name}</p>
            {item.site_name && (
              <p className="text-xs text-muted-foreground mt-0.5">{item.site_name}</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">—</span>
        )}
      </td>

      {/* Issue */}
      <td className="px-3 py-3 max-w-[280px] align-middle">
        <p className="text-sm font-medium text-foreground truncate leading-snug">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.reason}</p>
        <span className="inline-block mt-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-px font-mono border border-border/50">
          {issueLabel}
        </span>
      </td>

      {/* Impact */}
      <td className="px-3 py-3 w-28 align-middle">
        {item.payroll_blocking ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2 py-0.5">
            ⚡ Blocking
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Pending Since */}
      <td className="px-3 py-3 w-28 align-middle">
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {ago(item.created_at)}
        </span>
      </td>

      {/* Action cluster */}
      <td className="px-3 py-3 w-36 align-middle" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-px bg-muted/30 rounded-lg border border-border/60 p-0.5 w-fit">
          <button
            type="button"
            title={approveLabel}
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-success hover:bg-success/10 transition-colors"
            onClick={() => onApprove(item.id)}
          >
            <CheckCircle2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            title={rejectLabel}
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
            onClick={() => onReject(item.id)}
          >
            <XCircle className="w-3 h-3" />
          </button>
          <div className="w-px h-3 bg-border mx-px" />
          <button
            type="button"
            title="Snooze"
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => onSnooze(item.id)}
          >
            <AlarmClock className="w-3 h-3" />
          </button>
          <button
            type="button"
            title="Escalate"
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-warning hover:bg-warning/10 transition-colors"
            onClick={() => onEscalate(item.id)}
          >
            <ChevronsUp className="w-3 h-3" />
          </button>
          <div className="w-px h-3 bg-border mx-px" />
          <button
            type="button"
            title="Open workflow"
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
            onClick={() => void navigate(item.workflow_target)}
          >
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── BulkActionBar ──────────────────────────────────────────────────────────────

interface BulkBarProps {
  selectedIds:   Set<string>
  onApproveAll:  () => void
  onRejectAll:   () => void
  onSnoozeAll:   () => void
  onEscalateAll: () => void
  onClear:       () => void
}

function BulkActionBar({ selectedIds, onApproveAll, onRejectAll, onSnoozeAll, onEscalateAll, onClear }: BulkBarProps) {
  if (selectedIds.size === 0) return null
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-foreground/95 backdrop-blur-sm border border-border/20 shadow-xl rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
      <span className="text-[11px] font-bold text-background font-mono">{selectedIds.size} selected</span>
      <div className="h-3.5 w-px bg-background/20" />
      <button type="button" onClick={onApproveAll}  className="h-6 px-2.5 text-[10px] font-semibold rounded-lg text-success bg-success/20 hover:bg-success/30 border border-success/30 flex items-center gap-1 transition-colors">
        <CheckCircle2 className="w-3 h-3" /> Approve All
      </button>
      <button type="button" onClick={onRejectAll}   className="h-6 px-2.5 text-[10px] font-semibold rounded-lg text-destructive bg-destructive/20 hover:bg-destructive/30 border border-destructive/30 flex items-center gap-1 transition-colors">
        <XCircle className="w-3 h-3" /> Reject All
      </button>
      <button type="button" onClick={onSnoozeAll}   className="h-6 px-2.5 text-[10px] font-semibold rounded-lg text-muted-foreground bg-muted hover:bg-muted/80 border border-border flex items-center gap-1 transition-colors">
        <AlarmClock className="w-3 h-3" /> Snooze
      </button>
      <button type="button" onClick={onEscalateAll} className="h-6 px-2.5 text-[10px] font-semibold rounded-lg text-warning bg-warning/20 hover:bg-warning/30 border border-warning/30 flex items-center gap-1 transition-colors">
        <ChevronsUp className="w-3 h-3" /> Escalate
      </button>
      <div className="h-3.5 w-px bg-background/20" />
      <button type="button" onClick={onClear} className="h-6 px-2.5 text-[10px] font-medium rounded-lg text-background/50 hover:text-background transition-colors">
        Clear
      </button>
    </div>
  )
}

// ── KeyboardShortcutHint ───────────────────────────────────────────────────────

function KeyboardShortcutHint() {
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed bottom-4 left-4 z-40">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full bg-card border shadow flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        title="Keyboard shortcuts"
      >
        <Keyboard className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 bg-card border shadow-lg rounded-xl p-4 w-56 text-xs space-y-1.5">
          <p className="font-semibold text-sm mb-2">Keyboard Shortcuts</p>
          {[
            ['j / ↓', 'Next item'],
            ['k / ↑', 'Prev item'],
            ['a',     'Approve focused'],
            ['r',     'Reject focused'],
            ['s',     'Snooze (24h)'],
            ['e',     'Escalate'],
            ['Space', 'Select / deselect'],
            ['Enter', 'Open employee panel'],
            ['Esc',   'Clear selection'],
          ].map(([key, desc]) => (
            <div key={key} className="flex justify-between">
              <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{key}</kbd>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── MyWorkQueue ────────────────────────────────────────────────────────────────

export function MyWorkQueue() {
  const {
    items,
    refresh,
    isLoading,
    bulkApprove,
    bulkReject,
    bulkSnooze,
    bulkEscalate,
    focusedId,
    setFocusedId,
    selectedIds,
    toggleSelected,
    clearSelected,
  } = useOperationalQueue()

  const [search,       setSearch]       = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterChip>('all')
  const [drawerEmpId,  setDrawerEmpId]  = useState<string | null>(null)
  const [drawerItem,   setDrawerItem]   = useState<OperationalQueueItem | null>(null)
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [cdlg, setCdlg] = useState<{ msg: string; act: () => void } | null>(null)

  // ── KPI counts ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const live = items.filter(i => i.status !== 'snoozed')
    return {
      payrollBlocking: live.filter(i => i.payroll_blocking).length,
      pendingApproval: live.filter(i => !i.payroll_blocking && (i.severity === 'critical' || i.severity === 'high')).length,
      needsReview:     live.filter(i => !i.payroll_blocking &&  i.severity !== 'critical' && i.severity !== 'high').length,
      ignoredToday:    items.filter(i => i.status === 'snoozed').length,
    }
  }, [items])

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const searchedItems = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.employee_name?.toLowerCase().includes(q) ?? false) ||
      (i.site_name?.toLowerCase().includes(q)     ?? false) ||
      i.reason.toLowerCase().includes(q),
    )
  }, [items, search])

  const filteredItems = useMemo(
    () => searchedItems.filter(i => matchChip(i, activeFilter)),
    [searchedItems, activeFilter],
  )

  // Chip counts (off search-filtered items so counts stay consistent)
  const chipCounts = useMemo(
    () => Object.fromEntries(CHIPS.map(c => [c.id, searchedItems.filter(i => matchChip(i, c.id)).length])) as Record<FilterChip, number>,
    [searchedItems],
  )

  // ── Drawer open ────────────────────────────────────────────────────────────
  function openItem(item: OperationalQueueItem) {
    setDrawerEmpId(item.employee_id)
    setDrawerItem(item)
    setDrawerOpen(true)
  }

  // Keyboard: Enter opens drawer for focused item
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === 'Enter' && focusedId) {
        const found = items.find(i => i.id === focusedId)
        if (found) openItem(found)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, items])

  const anySelected      = selectedIds.size > 0
  const selectedIdsArray = useMemo(() => Array.from(selectedIds), [selectedIds])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto px-5 py-5 space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[17px] font-bold text-foreground tracking-tight">Daily Operations</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pending regularisations, corrections, payroll revisions and leave conflicts awaiting approval.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search employee, issue…"
                className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52 placeholder:text-muted-foreground"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={isLoading}
              className="h-8 px-3 text-sm font-medium rounded-md bg-background border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isLoading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />
              }
              Refresh
            </button>
          </div>
        </div>

        {/* ── KPI strip ───────────────────────────────────────────────────── */}
        <MetricRow cols={4}>
          <MetricCard label="Payroll Blocking" value={kpis.payrollBlocking} variant={kpis.payrollBlocking > 0 ? 'destructive' : 'neutral'} />
          <MetricCard label="Pending Approval" value={kpis.pendingApproval} variant={kpis.pendingApproval > 0 ? 'warning' : 'neutral'} />
          <MetricCard label="Needs Review"     value={kpis.needsReview}     variant={kpis.needsReview > 0 ? 'info' : 'neutral'} />
          <MetricCard label="Ignored Today"    value={kpis.ignoredToday}    variant="neutral" />
        </MetricRow>

        {/* ── Filter chips ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {CHIPS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveFilter(id)}
              className={cn(
                'h-7 px-3 text-xs font-medium rounded-full border transition-colors',
                activeFilter === id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
              {chipCounts[id] > 0 && (
                <span className={cn(
                  'ml-1.5 text-[10px] font-mono tabular-nums',
                  activeFilter === id ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}>
                  {chipCounts[id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-0 p-0" />
                  <th className="w-8 px-5 py-2.5" />
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 w-24">Priority</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">Employee</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">Issue</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 w-28">Impact</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 w-28">Pending Since</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 w-36">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">Loading queue…</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        {items.length === 0 ? (
                          <>
                            <CheckCircle2 className="w-10 h-10 text-success/40" />
                            <p className="text-sm font-medium text-success">All clear — no unresolved exceptions.</p>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-8 h-8 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">No items match this filter.</p>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : filteredItems.map(item => (
                  <TableRow
                    key={item.id}
                    item={item}
                    isFocused={focusedId === item.id}
                    isSelected={selectedIds.has(item.id)}
                    anySelected={anySelected}
                    onToggleSelect={toggleSelected}
                    onApprove={id  => bulkApprove([id])}
                    onReject={id   => bulkReject([id])}
                    onSnooze={id   => bulkSnooze([id])}
                    onEscalate={id => bulkEscalate([id])}
                    onFocus={setFocusedId}
                    onOpen={openItem}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer count */}
          {!isLoading && filteredItems.length > 0 && (
            <div className="border-t border-border px-5 py-2.5 bg-muted/20">
              <p className="text-xs text-muted-foreground">
                {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
                {activeFilter !== 'all' && (
                  <span> · filtered by {CHIPS.find(c => c.id === activeFilter)?.label}</span>
                )}
              </p>
            </div>
          )}
        </div>

      </div>

      {/* Bulk bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        onApproveAll={() => {
          setCdlg({ msg: `Approve ${selectedIds.size} selected items?`, act: () => bulkApprove(selectedIdsArray) })
        }}
        onRejectAll={() => {
          setCdlg({ msg: `Reject ${selectedIds.size} selected items?`, act: () => bulkReject(selectedIdsArray) })
        }}
        onSnoozeAll={() => bulkSnooze(selectedIdsArray)}
        onEscalateAll={() => {
          setCdlg({ msg: `Escalate ${selectedIds.size} selected items?`, act: () => bulkEscalate(selectedIdsArray) })
        }}
        onClear={clearSelected}
      />

      {/* Keyboard hints */}
      <KeyboardShortcutHint />

      {/* Employee resolution drawer */}
      <EmployeeResolutionWorkspace
        employeeId={drawerEmpId}
        queueItem={drawerItem}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
          setDrawerItem(null)
          setDrawerEmpId(null)
        }}
        onSnooze={id => bulkSnooze([id])}
      />
      <ConfirmDialog open={!!cdlg} message={cdlg?.msg ?? ''} title="Confirm" confirmLabel="Confirm" onConfirm={() => { cdlg?.act(); setCdlg(null) }} onCancel={() => setCdlg(null)} />
    </div>
  )
}
