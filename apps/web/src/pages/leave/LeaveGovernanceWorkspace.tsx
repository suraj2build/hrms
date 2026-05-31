/**
 * LeaveGovernanceWorkspace — /admin/leave/governance
 *
 * Enterprise leave governance extensions workspace.
 * Manages the features added in migration 155 + 156 + 158:
 *
 *   Tab 1 — Important Date Types
 *     Configure event types (birthday, marriage anniversary, custom).
 *     System types are shown read-only; custom types can be added/edited/deleted.
 *
 *   Tab 2 — Event Grants
 *     View the log of event-triggered leave grants.
 *     Read-only audit view: granted / expired / cancelled rows with employee + type details.
 *
 *   Tab 3 — Session Analytics
 *     Aggregated stats for leave requests by session type.
 *
 *   Tab 4 — Ledger Audit
 *     Admin review of leave_balance_ledger entries per employee.
 *
 *   Tab 5 — Reconciliation
 *     Leave reconciliation run results from the scheduler autonomy engine.
 *
 * Access: hr_admin and super_admin only.
 * Design: design-system tokens only.
 */

import React, { useState, useMemo, useEffect, useRef }       from 'react'
import { useQuery, useMutation, useQueryClient }              from '@tanstack/react-query'
import { toast }                                              from 'sonner'
import {
  CalendarHeart, Gift, Plus, Pencil, Trash2,
  Loader2, ShieldCheck, Power, Info,
  BadgeCheck, XCircle, AlertCircle,
  BarChart2, BookOpen, RefreshCw, Search,
  ChevronDown, ChevronRight, Pause, Lock, TrendingUp, Layers,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { Label }          from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DateType {
  id:          string
  code:        string
  name:        string
  description: string | null
  is_system:   boolean
  is_active:   boolean
  created_at:  string
}

interface EventGrant {
  id:            string
  employee_id:   string
  leave_type_id: string
  date_type_id:  string
  event_year:    number
  grant_date:    string
  days_granted:  number
  expiry_date:   string | null
  status:        'active' | 'used' | 'expired' | 'cancelled'
  // joins
  employees?:             { first_name: string; last_name: string; employee_code: string } | null
  leave_types?:           { name: string } | null
  important_date_types?:  { name: string; code: string } | null
}

interface DateTypeForm {
  code:        string
  name:        string
  description: string
  is_active:   boolean
}

// ── Session Analytics types ───────────────────────────────────────────────────

interface SessionAnalyticsRow {
  leave_type_name: string
  full_day:        number
  first_half:      number
  second_half:     number
  cross_session:   number
}

interface SessionAnalyticsSummary {
  total_requests:     number
  half_day_count:     number
  cross_session_count: number
  hourly_count:       number
  by_type:            SessionAnalyticsRow[]
}

// ── Ledger types ──────────────────────────────────────────────────────────────

type LedgerTxnType =
  | 'accrual'
  | 'carry_forward'
  | 'manual_credit'
  | 'deduction'
  | 'encashment'
  | 'expiry'
  | 'opening_balance'
  | 'event_grant'
  | 'reversal'
  | 'payroll_adjustment'
  | 'correction'
  | 'lop_recovery'

interface LedgerEntry {
  id:             string
  transaction_date: string
  leave_type_name: string
  txn_type:       LedgerTxnType
  days:           number
  balance_after:  number
  notes:          string | null
}

// ── Reconciliation types ──────────────────────────────────────────────────────

interface ReconciliationRun {
  id:                 string
  run_date:           string
  year:               number
  trigger:            string
  issues_found:       number
  employees_checked:  number
  severity:           'ok' | 'low' | 'medium' | 'high' | 'critical'
  report_data:        {
    issue_breakdown?: {
      critical?: number
      high?:     number
      medium?:   number
      low?:      number
    }
    details?: Array<{
      employee_id:   string
      employee_name: string
      issue_type:    string
      description:   string
      severity:      string
    }>
  } | null
}

// ── Lifecycle Analytics Tab ────────────────────────────────────────────────────

interface ActiveFreezeItem {
  id:            string
  employee_id:   string
  leave_type_id: string | null
  freeze_from:   string
  freeze_to:     string | null
  reason:        string
  status:        string
  employees?:    { first_name: string; last_name: string; employee_code: string } | null
  leave_types?:  { name: string } | null
}

interface HeldCreditSummary {
  employee_id:       string
  leave_type_id:     string
  total_held_days:   number
  earliest_release:  string | null
  release_trigger:   string | null
  employees?:        { first_name: string; last_name: string; employee_code: string } | null
  leave_types?:      { name: string } | null
}

function LifecycleAnalyticsTab() {
  const { profile } = useAuthStore()
  const tenantId    = (profile as any)?.tenant_id ?? ''

  // Active freezes across tenant
  const { data: freezeData, isLoading: freezeLoading } = useQuery<{ data: ActiveFreezeItem[] }>({
    queryKey:  ['lifecycle-active-freezes', tenantId],
    queryFn:   () => api.get('/leave/lifecycle/all-freezes'),
    staleTime: 60_000,
    retry:     false,
  })

  // Held credits summary — use the ledger query with held filter
  const { data: heldData, isLoading: heldLoading } = useQuery({
    queryKey:  ['lifecycle-held-credits', tenantId],
    queryFn:   () => api.get('/leave/lifecycle/held-credits-summary'),
    staleTime: 60_000,
    retry:     false,
  })

  const activeFreezes = (freezeData?.data ?? []).filter(f => f.status === 'active')
  const heldCredits   = (heldData as any)?.data ?? []
  const totalFrozen   = activeFreezes.length
  const totalHeld     = (heldCredits as HeldCreditSummary[]).reduce((s: number, r: HeldCreditSummary) => s + (r.total_held_days ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: 'Active Freezes',
            value: totalFrozen,
            icon:  Pause,
            cls:   totalFrozen > 0 ? 'text-warning' : 'text-success',
            desc:  'Employees with accrual suspended',
          },
          {
            label: 'Held Credit Days',
            value: totalHeld.toFixed(1),
            icon:  Lock,
            cls:   'text-info',
            desc:  'Days posted but not yet consumable',
          },
          {
            label: 'Tier Policies Active',
            value: '—',
            icon:  TrendingUp,
            cls:   'text-primary',
            desc:  'Leave types with service-tier rates',
          },
        ].map(({ label, value, icon: Icon, cls, desc }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
            <div className={cn('p-2 rounded-lg bg-muted/50', cls)}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className={cn('font-display text-2xl font-bold tabular-nums', cls)}>{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Active freezes table */}
      <SectionCard
        title="Active Accrual Freezes"
        icon={<Pause className="h-4 w-4 text-muted-foreground" />}
        description="Employees whose accruals are currently suspended. Freeze mode determines whether missed credits will be replayed on unfreeze."
      >
        {freezeLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading…
          </div>
        ) : activeFreezes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Pause className="h-8 w-8 opacity-20" />
            <p className="text-sm font-medium text-foreground">No active freezes</p>
            <p className="text-xs">All employee accruals are running normally.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Employee</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Leave Type</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">From</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">To</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Reason</th>
                </tr>
              </thead>
              <tbody>
                {activeFreezes.map(f => (
                  <tr key={f.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 pr-4">
                      <div className="text-xs font-medium">
                        {f.employees
                          ? `${f.employees.first_name} ${f.employees.last_name}`
                          : f.employee_id.slice(0, 8) + '…'}
                      </div>
                      {f.employees && (
                        <div className="text-[10px] text-muted-foreground">{f.employees.employee_code}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {f.leave_types?.name ?? (
                        <span className="text-muted-foreground italic">All types</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs tabular-nums">{f.freeze_from}</td>
                    <td className="py-2.5 pr-4 text-xs tabular-nums">
                      {f.freeze_to ?? <span className="text-warning">Open-ended</span>}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                      {f.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Held credits table */}
      <SectionCard
        title="Held Credits (Pending Release)"
        icon={<Lock className="h-4 w-4 text-muted-foreground" />}
        description="Accrual credits that have been posted to the ledger but are not yet consumable. These will be released automatically when the trigger condition is met."
      >
        {heldLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading…
          </div>
        ) : heldCredits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Lock className="h-8 w-8 opacity-20" />
            <p className="text-sm font-medium text-foreground">No held credits</p>
            <p className="text-xs">All accrued credits are immediately consumable.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Employee</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Leave Type</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground text-right">Held Days</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Release Trigger</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Earliest Release</th>
                </tr>
              </thead>
              <tbody>
                {(heldCredits as HeldCreditSummary[]).map((hc, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 pr-4">
                      <div className="text-xs font-medium">
                        {hc.employees
                          ? `${hc.employees.first_name} ${hc.employees.last_name}`
                          : hc.employee_id.slice(0, 8) + '…'}
                      </div>
                      {hc.employees && (
                        <div className="text-[10px] text-muted-foreground">{hc.employees.employee_code}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">{hc.leave_types?.name ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-xs tabular-nums font-semibold text-info text-right">
                      +{hc.total_held_days}d
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground capitalize">
                      {(hc.release_trigger ?? 'immediate').replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 text-xs tabular-nums">
                      {hc.earliest_release ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          Lifecycle governance controls are configured per policy rule in the Leave Policy setup.
          Freezes can be created per-employee from the employee record. Tiers are managed via
          the policy rules API.
        </span>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Status badge ──────────────────────────────────────────────────────────────

function GrantStatusBadge({ status }: { status: EventGrant['status'] }) {
  const map: Record<EventGrant['status'], { label: string; className: string }> = {
    active:    { label: 'Active',    className: 'bg-success/10 text-success border-success/20' },
    used:      { label: 'Used',      className: 'bg-muted text-muted-foreground' },
    expired:   { label: 'Expired',   className: 'bg-warning/10 text-warning border-warning/20' },
    cancelled: { label: 'Cancelled', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  }
  const { label, className } = map[status] ?? map.active
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', className)}>
      {label}
    </Badge>
  )
}

// ── Ledger txn type badge ─────────────────────────────────────────────────────

const TXN_BADGE_CLASS: Record<LedgerTxnType, string> = {
  accrual:            'bg-green-100 text-green-700 border-green-200',
  carry_forward:      'bg-blue-100 text-blue-700 border-blue-200',
  manual_credit:      'bg-sky-100 text-sky-700 border-sky-200',
  deduction:          'bg-red-100 text-red-700 border-red-200',
  encashment:         'bg-emerald-100 text-emerald-700 border-emerald-200',
  expiry:             'bg-gray-100 text-gray-600 border-gray-200',
  opening_balance:    'bg-indigo-100 text-indigo-700 border-indigo-200',
  event_grant:        'bg-purple-100 text-purple-700 border-purple-200',
  reversal:           'bg-orange-100 text-orange-700 border-orange-200',
  payroll_adjustment: 'bg-amber-100 text-amber-700 border-amber-200',
  correction:         'bg-rose-100 text-rose-700 border-rose-200',
  lop_recovery:       'bg-pink-100 text-pink-700 border-pink-200',
}

function TxnTypeBadge({ type }: { type: LedgerTxnType }) {
  return (
    <Badge
      variant="outline"
      className={cn('text-xs font-medium capitalize', TXN_BADGE_CLASS[type] ?? 'bg-muted text-muted-foreground')}
    >
      {type.replace(/_/g, ' ')}
    </Badge>
  )
}

// ── Reconciliation severity badge ─────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: ReconciliationRun['severity'] }) {
  const map: Record<ReconciliationRun['severity'], { label: string; className: string }> = {
    ok:       { label: 'OK',       className: 'bg-success/10 text-success border-success/20' },
    low:      { label: 'Low',      className: 'bg-blue-100 text-blue-700 border-blue-200' },
    medium:   { label: 'Medium',   className: 'bg-warning/10 text-warning border-warning/20' },
    high:     { label: 'High',     className: 'bg-orange-100 text-orange-700 border-orange-200' },
    critical: { label: 'Critical', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  }
  const { label, className } = map[severity] ?? map.ok
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', className)}>
      {label}
    </Badge>
  )
}

// ── useDebounce ───────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── ALL_TXN_TYPES ─────────────────────────────────────────────────────────────

const ALL_TXN_TYPES: LedgerTxnType[] = [
  'accrual', 'carry_forward', 'manual_credit', 'deduction', 'encashment',
  'expiry', 'opening_balance', 'event_grant', 'reversal', 'payroll_adjustment',
  'correction', 'lop_recovery',
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LeaveGovernanceWorkspace() {
  const { profile } = useAuthStore()
  const isAdmin  = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc       = useQueryClient()

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: dtData, isLoading: dtLoading } = useQuery({
    queryKey: ['important-date-types'],
    queryFn:  () =>
      api.get('/masters/important-date-types?include_inactive=true').then((r: any) => r.data as DateType[]),
  })

  const { data: grantsData, isLoading: grantsLoading } = useQuery({
    queryKey: ['leave-event-grants'],
    queryFn:  () =>
      api.get('/leave/event-grants').then((r: any) => (r.data?.data ?? r.data ?? []) as EventGrant[]),
    // Gracefully handle 404 if the endpoint isn't wired yet
    retry: false,
  })

  const dateTypes = dtData ?? []
  const grants    = grantsData ?? []

  // ── Dialog state ──────────────────────────────────────────────────────────

  const [dialog, setDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; item: DateType }
    | null
  >(null)

  const emptyForm = (): DateTypeForm => ({
    code:        '',
    name:        '',
    description: '',
    is_active:   true,
  })

  const [form, setForm] = useState<DateTypeForm>(emptyForm())

  function openCreate() {
    setForm(emptyForm())
    setDialog({ mode: 'create' })
  }

  function openEdit(item: DateType) {
    setForm({
      code:        item.code,
      name:        item.name,
      description: item.description ?? '',
      is_active:   item.is_active,
    })
    setDialog({ mode: 'edit', item })
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (f: DateTypeForm) =>
      api.post('/masters/important-date-types', {
        code:        f.code,
        name:        f.name,
        description: f.description || undefined,
        is_active:   f.is_active,
      }),
    onSuccess: () => {
      toast.success('Date type created')
      qc.invalidateQueries({ queryKey: ['important-date-types'] })
      setDialog(null)
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Failed to create date type'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, f }: { id: string; f: DateTypeForm }) =>
      api.put(`/masters/important-date-types/${id}`, {
        name:        f.name,
        description: f.description || null,
        is_active:   f.is_active,
      }),
    onSuccess: () => {
      toast.success('Date type updated')
      qc.invalidateQueries({ queryKey: ['important-date-types'] })
      setDialog(null)
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Failed to update date type'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/masters/important-date-types/${id}`),
    onSuccess: () => {
      toast.success('Date type deleted')
      qc.invalidateQueries({ queryKey: ['important-date-types'] })
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Failed to delete date type'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/masters/important-date-types/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['important-date-types'] }),
    onError:   () => toast.error('Failed to toggle status'),
  })

  // ── Form helpers ──────────────────────────────────────────────────────────

  function handleSubmit() {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required')
      return
    }
    if (dialog?.mode === 'create') {
      createMut.mutate(form)
    } else if (dialog?.mode === 'edit') {
      updateMut.mutate({ id: dialog.item.id, f: form })
    }
  }

  const isMutating = createMut.isPending || updateMut.isPending

  // ── Grant stats ───────────────────────────────────────────────────────────

  const grantStats = useMemo(() => ({
    total:    grants.length,
    active:   grants.filter(g => g.status === 'active').length,
    expired:  grants.filter(g => g.status === 'expired').length,
    used:     grants.filter(g => g.status === 'used').length,
  }), [grants])

  // ── Session Analytics ─────────────────────────────────────────────────────

  const { data: analyticsData, isLoading: analyticsLoading, isError: analyticsError } = useQuery<SessionAnalyticsSummary>({
    queryKey: ['leave-session-analytics'],
    queryFn:  () =>
      api.get('/leave/governance/session-analytics').then((r: any) => (r.data?.data ?? r.data) as SessionAnalyticsSummary),
    retry: false,
  })

  // ── Ledger Audit ──────────────────────────────────────────────────────────

  const [employeeSearch, setEmployeeSearch]     = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string } | null>(null)
  const [txnTypeFilter, setTxnTypeFilter]       = useState<LedgerTxnType | ''>('')

  const debouncedSearch = useDebounce(employeeSearch, 350)

  const { data: empSearchData, isLoading: empSearchLoading } = useQuery<Array<{ id: string; first_name: string; last_name: string; employee_code: string }>>({
    queryKey: ['employee-search-ledger', debouncedSearch],
    queryFn:  () =>
      api.get(`/employees?search=${encodeURIComponent(debouncedSearch)}&limit=10`)
        .then((r: any) => r.data.data),
    enabled: debouncedSearch.length >= 2 && !selectedEmployee,
    retry:   false,
  })

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<LedgerEntry[]>({
    queryKey: ['leave-ledger', selectedEmployee?.id, txnTypeFilter],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (txnTypeFilter) params.set('txn_type', txnTypeFilter)
      return api.get(`/attendance/leave/ledger/${selectedEmployee!.id}?${params.toString()}`)
        .then((r: any) => r.data.data as LedgerEntry[])
    },
    enabled: !!selectedEmployee,
    retry:   false,
  })

  const ledgerEntries = ledgerData ?? []
  const [showEmpDropdown, setShowEmpDropdown] = useState(false)
  const empSearchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debouncedSearch.length >= 2 && !selectedEmployee) setShowEmpDropdown(true)
    else setShowEmpDropdown(false)
  }, [debouncedSearch, selectedEmployee])

  // ── Reconciliation ────────────────────────────────────────────────────────

  const { data: reconcData, isLoading: reconcLoading } = useQuery<ReconciliationRun[]>({
    queryKey: ['leave-reconciliation'],
    queryFn:  () =>
      api.get('/leave/scheduler/reconciliation?limit=30')
        .then((r: any) => (r.data?.data ?? r.data ?? []) as ReconciliationRun[]),
    retry: false,
  })
  const reconcRuns = reconcData ?? []

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Leave Governance"
        subtitle="Configure event-triggered leave grants and manage important date types"
        actions={<CalendarHeart className="h-5 w-5 text-muted-foreground" />}
      />

      {/* Governance model callout */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 mb-4 flex gap-3">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How event-triggered leave works</p>
          <p>
            Leave policy rules can be linked to an important date type (e.g. birthday).
            The automation engine runs daily and automatically grants configured days to
            employees on their event date — no manual action required.
          </p>
          <p className="text-xs mt-1">
            Configure: <strong>Leave Policy Rule</strong> → set <em>Event Trigger</em> to an important date type
            and specify <em>Grant Days</em> and <em>Validity Days</em>. Then ensure employees have their
            dates recorded in their employee profile.
          </p>
        </div>
      </div>

      <Tabs defaultValue="date-types">
        <TabsList className="mb-4">
          <TabsTrigger value="date-types">
            <CalendarHeart className="h-3.5 w-3.5 mr-1.5" />
            Important Date Types
          </TabsTrigger>
          <TabsTrigger value="event-grants">
            <Gift className="h-3.5 w-3.5 mr-1.5" />
            Event Grants
            {grantStats.active > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {grantStats.active}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="session-analytics">
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
            Session Analytics
          </TabsTrigger>
          <TabsTrigger value="ledger-audit">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Ledger Audit
          </TabsTrigger>
          <TabsTrigger value="reconciliation">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reconciliation
          </TabsTrigger>
          <TabsTrigger value="lifecycle">
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Lifecycle
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Important Date Types ──────────────────────────────── */}
        <TabsContent value="date-types">
          <SectionCard
            title="Important Date Types"
            description="Define the event types employees can have on their profiles. System types cannot be deleted but can be disabled."
            action={
              isAdmin ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Type
                </Button>
              ) : undefined
            }
          >
            {dtLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading…
              </div>
            ) : dateTypes.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No important date types configured.
                {isAdmin && (
                  <button
                    className="ml-1 text-primary underline-offset-2 hover:underline"
                    onClick={openCreate}
                  >
                    Add the first one
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {dateTypes.map(dt => (
                  <div
                    key={dt.id}
                    className={cn(
                      'flex items-start gap-3 py-3 px-1',
                      !dt.is_active && 'opacity-50',
                    )}
                  >
                    {/* Icon */}
                    <div className={cn(
                      'mt-0.5 flex h-8 w-8 items-center justify-center rounded-md shrink-0',
                      dt.is_active ? 'bg-primary/10' : 'bg-muted',
                    )}>
                      <CalendarHeart className={cn(
                        'h-4 w-4',
                        dt.is_active ? 'text-primary' : 'text-muted-foreground',
                      )} />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{dt.name}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                          {dt.code}
                        </code>
                        {dt.is_system && (
                          <Badge variant="outline" className="text-xs gap-1 py-0">
                            <ShieldCheck className="h-3 w-3" />
                            System
                          </Badge>
                        )}
                        {!dt.is_active && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Disabled
                          </Badge>
                        )}
                      </div>
                      {dt.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{dt.description}</p>
                      )}
                    </div>

                    {/* Actions */}
                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Toggle active */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={dt.is_active ? 'Disable' : 'Enable'}
                          onClick={() => toggleMut.mutate({ id: dt.id, is_active: !dt.is_active })}
                        >
                          <Power className={cn(
                            'h-3.5 w-3.5',
                            dt.is_active ? 'text-success' : 'text-muted-foreground',
                          )} />
                        </Button>

                        {/* Edit */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(dt)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        {/* Delete (custom types only) */}
                        {!dt.is_system && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Delete "${dt.name}"? This cannot be undone.`)) {
                                deleteMut.mutate(dt.id)
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Tab 2: Event Grants ───────────────────────────────────────── */}
        <TabsContent value="event-grants">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Grants',  value: grantStats.total,   icon: Gift,       color: 'text-primary' },
              { label: 'Active',        value: grantStats.active,  icon: BadgeCheck, color: 'text-success' },
              { label: 'Expired',       value: grantStats.expired, icon: XCircle,    color: 'text-warning' },
              { label: 'Used',          value: grantStats.used,    icon: AlertCircle, color: 'text-muted-foreground' },
            ].map(s => (
              <div key={s.label} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
                <s.icon className={cn('h-4 w-4 shrink-0', s.color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-display text-lg font-semibold">{s.value}</p>
                </div>
              </div>
            ))}
          </div>

          <SectionCard
            title="Event Grant Log"
            description="Automatically granted leave days triggered by employee important dates. Read-only audit trail."
          >
            {grantsLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading…
              </div>
            ) : grants.length === 0 ? (
              <div className="py-12 text-center">
                <Gift className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No event grants yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Grants are created automatically when the daily scheduler detects
                  employees with matching birthdays or anniversaries.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Employee</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Event</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Leave Type</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Year</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Days</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Grant Date</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Expires</th>
                      <th className="pb-2 font-medium text-muted-foreground text-xs">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {grants.map(g => (
                      <tr key={g.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 pr-4">
                          <div className="font-medium text-xs">
                            {g.employees
                              ? `${g.employees.first_name} ${g.employees.last_name}`
                              : g.employee_id.slice(0, 8)}
                          </div>
                          {g.employees?.employee_code && (
                            <div className="text-xs text-muted-foreground">{g.employees.employee_code}</div>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-xs">
                          {g.important_date_types?.name ?? g.date_type_id.slice(0, 8)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs">
                          {g.leave_types?.name ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs tabular-nums">{g.event_year}</td>
                        <td className="py-2.5 pr-4 text-xs tabular-nums font-medium">{g.days_granted}d</td>
                        <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                          {fmtDate(g.grant_date)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                          {g.expiry_date ? fmtDate(g.expiry_date) : '—'}
                        </td>
                        <td className="py-2.5">
                          <GrantStatusBadge status={g.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Tab 3: Session Analytics ──────────────────────────────────── */}
        <TabsContent value="session-analytics">
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading session analytics…
            </div>
          ) : analyticsError || !analyticsData ? (
            <SectionCard
              title="Session Analytics"
              description="Aggregated breakdown of leave requests by session type — this year"
            >
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                <BarChart2 className="h-10 w-10 opacity-20" />
                <p className="text-sm font-medium text-foreground">Coming soon</p>
                <p className="text-xs text-center max-w-xs">
                  Session analytics will be available once the{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">GET /leave/governance/session-analytics</code>{' '}
                  endpoint is wired. The data structure is ready.
                </p>
              </div>
            </SectionCard>
          ) : (
            <>
              {/* Summary stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Total Requests (this year)', value: analyticsData.total_requests,      color: 'text-primary' },
                  { label: 'Half-Day',                   value: analyticsData.half_day_count,      color: 'text-blue-600' },
                  { label: 'Cross-Session',              value: analyticsData.cross_session_count, color: 'text-warning' },
                  { label: 'Hourly',                     value: analyticsData.hourly_count,        color: 'text-purple-600' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={cn('font-display text-2xl font-semibold mt-1', s.color)}>{s.value}</p>
                  </div>
                ))}
              </div>

              <SectionCard
                title="By Leave Type"
                description="Full-day, first-half, second-half, and cross-session counts per leave type"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Leave Type</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Full Day</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">First Half</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Second Half</th>
                        <th className="pb-2 font-medium text-muted-foreground text-xs text-right">Cross-Session</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(analyticsData.by_type ?? []).map(row => (
                        <tr key={row.leave_type_name} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 pr-4 text-sm font-medium">{row.leave_type_name}</td>
                          <td className="py-2.5 pr-4 text-xs tabular-nums text-right">{row.full_day}</td>
                          <td className="py-2.5 pr-4 text-xs tabular-nums text-right">{row.first_half}</td>
                          <td className="py-2.5 pr-4 text-xs tabular-nums text-right">{row.second_half}</td>
                          <td className="py-2.5 text-xs tabular-nums text-right">{row.cross_session}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </TabsContent>

        {/* ── Tab 4: Ledger Audit ───────────────────────────────────────── */}
        <TabsContent value="ledger-audit">
          <SectionCard
            title="Leave Balance Ledger"
            description="View the detailed transaction history for any employee's leave balance."
          >
            {/* Search + filter controls */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              {/* Employee search */}
              <div className="relative flex-1" ref={empSearchRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search employee by name or code…"
                  className="pl-9 pr-8"
                  value={selectedEmployee ? selectedEmployee.name : employeeSearch}
                  onChange={e => {
                    setEmployeeSearch(e.target.value)
                    setSelectedEmployee(null)
                  }}
                />
                {selectedEmployee && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setSelectedEmployee(null); setEmployeeSearch('') }}
                    type="button"
                    aria-label="Clear employee"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                )}
                {/* Dropdown */}
                {showEmpDropdown && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-md overflow-hidden">
                    {empSearchLoading ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Searching…
                      </div>
                    ) : (empSearchData ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No employees found.</div>
                    ) : (
                      (empSearchData ?? []).map(emp => (
                        <button
                          key={emp.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                          onClick={() => {
                            setSelectedEmployee({
                              id:   emp.id,
                              name: `${emp.first_name} ${emp.last_name} (${emp.employee_code})`,
                            })
                            setShowEmpDropdown(false)
                          }}
                        >
                          <span className="font-medium">{emp.first_name} {emp.last_name}</span>
                          <span className="text-xs text-muted-foreground font-mono">{emp.employee_code}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Txn type filter */}
              <select
                value={txnTypeFilter}
                onChange={e => setTxnTypeFilter(e.target.value as LedgerTxnType | '')}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-52"
              >
                <option value="">All transaction types</option>
                {ALL_TXN_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {/* Table */}
            {!selectedEmployee ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <BookOpen className="h-8 w-8 opacity-20" />
                <p className="text-sm">Search for an employee to view their ledger.</p>
              </div>
            ) : ledgerLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading ledger…
              </div>
            ) : ledgerEntries.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No ledger entries found for this employee
                {txnTypeFilter ? ` with type "${txnTypeFilter.replace(/_/g, ' ')}"` : ''}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Date</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Leave Type</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Transaction Type</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Days</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Balance After</th>
                      <th className="pb-2 font-medium text-muted-foreground text-xs">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ledgerEntries.map(entry => (
                      <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 pr-4 text-xs text-muted-foreground tabular-nums">
                          {fmtDate(entry.transaction_date)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-medium">{entry.leave_type_name}</td>
                        <td className="py-2.5 pr-4">
                          <TxnTypeBadge type={entry.txn_type} />
                        </td>
                        <td className={cn(
                          'py-2.5 pr-4 text-xs tabular-nums font-semibold text-right',
                          entry.days > 0 ? 'text-success' : entry.days < 0 ? 'text-destructive' : 'text-muted-foreground',
                        )}>
                          {entry.days > 0 ? `+${entry.days}` : entry.days}
                        </td>
                        <td className="py-2.5 pr-4 text-xs tabular-nums text-right font-medium">
                          {entry.balance_after}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground max-w-xs truncate">
                          {entry.notes ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Tab 5: Reconciliation ─────────────────────────────────────── */}
        <TabsContent value="reconciliation">
          <SectionCard
            title="Reconciliation Runs"
            description="Nightly leave balance reconciliation results from the scheduler autonomy engine. Last 30 runs."
          >
            {reconcLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading…
              </div>
            ) : reconcRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                <RefreshCw className="h-8 w-8 opacity-20" />
                <p className="text-sm font-medium text-foreground">No reconciliation runs yet</p>
                <p className="text-xs text-center max-w-xs">
                  The nightly scheduler will populate this automatically. Runs are triggered at midnight
                  and after any bulk leave processing operations.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-3 font-medium text-muted-foreground text-xs w-4" />
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Run Date</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Year</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Trigger</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs text-right">Employees</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-xs">Issues Found</th>
                      <th className="pb-2 font-medium text-muted-foreground text-xs">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconcRuns.map(run => {
                      const isExpanded = expandedRunId === run.id
                      const breakdown  = run.report_data?.issue_breakdown
                      const details    = run.report_data?.details ?? []
                      return (
                        <React.Fragment key={run.id}>
                          <tr
                            className={cn(
                              'border-b border-border hover:bg-muted/30 transition-colors cursor-pointer',
                              isExpanded && 'bg-muted/20',
                            )}
                            onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                          >
                            <td className="py-2.5 pr-3 text-muted-foreground">
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />
                              }
                            </td>
                            <td className="py-2.5 pr-4 text-xs tabular-nums">
                              {fmtDate(run.run_date)}
                            </td>
                            <td className="py-2.5 pr-4 text-xs tabular-nums">{run.year}</td>
                            <td className="py-2.5 pr-4 text-xs">
                              <span className="capitalize">{run.trigger.replace(/_/g, ' ')}</span>
                            </td>
                            <td className="py-2.5 pr-4 text-xs tabular-nums text-right">
                              {run.employees_checked}
                            </td>
                            <td className="py-2.5 pr-4">
                              {run.issues_found === 0 ? (
                                <span className="text-xs text-success font-medium">None</span>
                              ) : (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-medium">{run.issues_found}</span>
                                  {breakdown && (
                                    <div className="flex gap-1">
                                      {breakdown.critical ? (
                                        <span className="text-[10px] font-medium text-destructive">{breakdown.critical}×C</span>
                                      ) : null}
                                      {breakdown.high ? (
                                        <span className="text-[10px] font-medium text-orange-600">{breakdown.high}×H</span>
                                      ) : null}
                                      {breakdown.medium ? (
                                        <span className="text-[10px] font-medium text-warning">{breakdown.medium}×M</span>
                                      ) : null}
                                      {breakdown.low ? (
                                        <span className="text-[10px] font-medium text-blue-600">{breakdown.low}×L</span>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5">
                              <SeverityBadge severity={run.severity} />
                            </td>
                          </tr>
                          {/* Expanded detail row */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} className="bg-muted/10 px-4 py-3 border-b border-border">
                                {details.length === 0 ? (
                                  <p className="text-xs text-muted-foreground py-2">
                                    No issue details available for this run.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                      Issue Breakdown
                                    </p>
                                    <div className="rounded-md border border-border overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-border bg-muted/30 text-left">
                                            <th className="px-3 py-1.5 font-medium text-muted-foreground">Employee</th>
                                            <th className="px-3 py-1.5 font-medium text-muted-foreground">Issue Type</th>
                                            <th className="px-3 py-1.5 font-medium text-muted-foreground">Description</th>
                                            <th className="px-3 py-1.5 font-medium text-muted-foreground">Severity</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                          {details.map((d, i) => (
                                            <tr key={i} className="hover:bg-muted/20">
                                              <td className="px-3 py-1.5 font-medium">{d.employee_name}</td>
                                              <td className="px-3 py-1.5 capitalize">{d.issue_type.replace(/_/g, ' ')}</td>
                                              <td className="px-3 py-1.5 text-muted-foreground">{d.description}</td>
                                              <td className="px-3 py-1.5">
                                                <SeverityBadge severity={d.severity as ReconciliationRun['severity']} />
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Tab 6: Entitlement Lifecycle ────────────────────────────────── */}
        <TabsContent value="lifecycle">
          <LifecycleAnalyticsTab />
        </TabsContent>
      </Tabs>

      {/* ── Create / Edit dialog ────────────────────────────────────────────── */}
      <Dialog open={!!dialog} onOpenChange={() => setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'create' ? 'Add Important Date Type' : 'Edit Date Type'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'create'
                ? 'Create a custom event type that can be assigned to employees and linked to leave policy rules.'
                : 'Update the name, description, or active status of this date type.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Code — only for create */}
            {dialog?.mode === 'create' && (
              <div className="space-y-1.5">
                <Label htmlFor="dt-code">
                  Code <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="dt-code"
                  placeholder="e.g. work_anniversary"
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase, underscores only. Cannot be changed after creation.
                </p>
              </div>
            )}
            {dialog?.mode === 'edit' && (
              <div className="space-y-1.5">
                <Label>Code</Label>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-muted-foreground">
                  {(dialog as { mode: 'edit'; item: DateType }).item.code}
                </div>
                <p className="text-xs text-muted-foreground">Code cannot be changed after creation.</p>
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="dt-name">
                Display Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dt-name"
                placeholder="e.g. Work Anniversary"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="dt-desc">Description</Label>
              <textarea
                id="dt-desc"
                placeholder="Optional description shown in the employee profile…"
                rows={2}
                value={form.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm(p => ({ ...p, description: e.target.value }))}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                role="switch"
                aria-checked={form.is_active}
                onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                className={cn(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  form.is_active ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              >
                <span className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  form.is_active ? 'translate-x-4.5' : 'translate-x-0.5',
                )} />
              </button>
              <Label className="cursor-pointer" onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}>
                {form.is_active ? 'Active' : 'Disabled'}
              </Label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isMutating}>
              {isMutating && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {dialog?.mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
