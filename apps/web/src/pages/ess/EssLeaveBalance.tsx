/**
 * EssLeaveBalance — /ess/leave/balance
 *
 * Combined Leave workspace for ESS with left-side grouped navigation:
 *   • Overview      — leave balance cards + recent applications
 *   • Accrual Ledger — monthly/yearly credit history
 *   • Comp-Off       — compensatory leave requests (merged from /ess/comp-off)
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useMemo, useState }                    from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                                from 'sonner'
import {
  CalendarDays, AlertTriangle,
  CheckCircle2, XCircle, Info, Plus, X,
  BookOpen, RefreshCw, CalendarPlus, CalendarRange,
  AlertCircle, Clock, Lock, Pause, Search,
  Calendar, Plane, Bookmark, ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { LeaveApply }        from '@/pages/attendance/LeaveApply'
import { PageContainer }     from '@/components/layout/PageContainer'
import { PageHeader }        from '@/components/layout/PageHeader'
import { SectionCard }       from '@/components/layout/SectionCard'
import { Badge }             from '@/components/ui/badge'
import { Button }            from '@/components/ui/button'
import {
  IntelligenceLoadingSkeleton,
} from '@/components/ui/intelligence/index.js'
import { api }               from '@/lib/api/client'
import { useAuthStore }      from '@/stores/authStore'
import { cn }                from '@/lib/utils'
import { SubTabs }           from '@/components/ui/SubTabs'
import {
  DataTable,
  TableToolbar,
  PaginationBar,
  EmptyTableState,
} from '@/components/table'
import type { DataTableColumn } from '@/components/table'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveTypeInfo {
  id:      string
  name:    string
  is_paid: boolean
}

interface BalanceRow {
  id:                 string
  leave_type_id:      string
  balance:            number
  year:               number
  annual_entitlement: number | null
  leave_types:        LeaveTypeInfo
}

interface LeaveApp {
  id:           string
  from_date:    string
  to_date:      string
  status:       string
  reason?:      string
  leave_types?: { name: string }
  created_at:   string
}

interface LedgerRow {
  id:           string
  accrual_type: string
  days:         number
  year:         number
  accrued_on:   string
  expires_on:   string | null
  is_expired:   boolean
  notes:        string | null
  leave_types:  LeaveTypeInfo | null
  // Lifecycle fields (present if migration 159 has run)
  accrual_earning_basis?:     string | null
  consumption_eligible_from?: string | null
  release_trigger?:           string | null
  cycle_period?:              string | null
}

interface HeldCreditRow {
  id:                        string
  leave_type_id:             string
  days:                      number
  cycle_period:              string | null
  release_trigger:           string | null
  consumption_eligible_from: string | null
  accrued_on:                string
  leave_types:               { id: string; name: string } | null
}

interface FreezeRow {
  id:          string
  leave_type_id: string | null
  freeze_from: string
  freeze_to:   string | null
  reason:      string
  status:      string
  leave_types?: { id: string; name: string } | null
}

interface LedgerResponse {
  data:   LedgerRow[]
  total:  number
  limit:  number
  offset: number
}

interface HolidayRow {
  id:          string
  date:        string
  name:        string
  is_optional: boolean
  site_id:     string | null
}

type CompOffStatus = 'pending' | 'approved' | 'rejected'
type WorkedReason  = 'holiday' | 'weekly_off'

interface CompOffRequest {
  id:             string
  worked_date:    string
  worked_reason:  WorkedReason
  days_to_credit: number
  status:         CompOffStatus
  notes:          string | null
  approved_at:    string | null
  created_at:     string
  leave_types?:   { id: string; name: string }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LEDGER_LIMIT = 50

const ACCRUAL_TYPES = [
  { value: '',                  label: 'All Types'        },
  { value: 'monthly',           label: 'Monthly'          },
  { value: 'quarterly',         label: 'Quarterly'        },
  { value: 'yearly',            label: 'Yearly'           },
  { value: 'upfront',           label: 'Upfront'          },
  { value: 'carry_forward',     label: 'Carry Forward'    },
  { value: 'co_grant',          label: 'Comp Off'         },
  { value: 'manual',            label: 'Manual'           },
  { value: 'adjustment',        label: 'Adjustment'       },
  { value: 'advance_accrual',   label: 'Advance'          },
  { value: 'earned_accrual',    label: 'Earned'           },
  { value: 'prorated_accrual',  label: 'Prorated'         },
  { value: 'release',           label: 'Release'          },
]

const RELEASE_TRIGGER_LABEL: Record<string, string> = {
  immediate:                  'Immediate',
  after_cycle_completion:     'After cycle ends',
  after_payroll_lock:         'After payroll lock',
  after_attendance_confirmation: 'After attendance confirmation',
  manual_release:             'Manual release',
  cycle_completion:           'Cycle completion',
}

const ACCRUAL_BADGE: Record<string, string> = {
  monthly:       'bg-info/15 text-info',
  yearly:        'bg-primary/15 text-primary',
  upfront:       'bg-success/15 text-success',
  carry_forward: 'bg-warning/15 text-warning',
  co_grant:      'bg-accent/20 text-accent-foreground',
  manual:        'bg-muted text-muted-foreground',
  adjustment:    'bg-muted text-muted-foreground',
}

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'destructive' | 'secondary' | 'outline'> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
}

const CO_STATUS_VARIANT: Record<CompOffStatus, 'warning' | 'success' | 'destructive'> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
}
const CO_STATUS_LABEL: Record<CompOffStatus, string> = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}
const CO_REASON_LABEL: Record<WorkedReason, string> = {
  holiday:    'Worked on Holiday',
  weekly_off: 'Worked on Weekly Off',
}

// ── Nav config ─────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'ledger' | 'compoff' | 'apply'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  const d = new Date(s + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function fmtDateShort(s: string | null) {
  if (!s) return '—'
  const d = new Date(s + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function fmtDateIN(d: string) {
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

function fmtDateReadable(s: string) {
  const d = new Date(s + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T12:00:00Z`)
  const b = new Date(`${to}T12:00:00Z`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

function buildYears(): number[] {
  const cur = new Date().getFullYear()
  return [cur + 1, cur, cur - 1, cur - 2, cur - 3]
}

function getDaysUntil(dateStr: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateStr}T00:00:00`)
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff <= 7)  return `In ${diff} days`
  return null
}

// ── Ledger columns ────────────────────────────────────────────────────────────

const LEDGER_COLUMNS: DataTableColumn<LedgerRow>[] = [
  {
    id:       'accrual_date',
    header:   'Accrual Date',
    minWidth: '110px',
    cell: (row) => (
      <div className={cn(row.is_expired && 'opacity-50')}>
        <div className="text-xs tabular-nums whitespace-nowrap">{fmtDateShort(row.accrued_on)}</div>
        <div className="text-[10px] text-muted-foreground">{row.year}</div>
      </div>
    ),
  },
  {
    id:       'leave_type',
    header:   'Leave Type',
    minWidth: '130px',
    cell: (row) => (
      <div className={cn('font-medium whitespace-nowrap', row.is_expired && 'opacity-50')}>
        {row.leave_types?.name ?? <span className="text-muted-foreground text-xs">—</span>}
        {row.leave_types && (
          <span className="ml-1.5">
            <Badge
              variant={row.leave_types.is_paid ? 'success' : 'secondary'}
              className="rounded-full text-[9px] px-1.5 py-0"
            >
              {row.leave_types.is_paid ? 'Paid' : 'Unpaid'}
            </Badge>
          </span>
        )}
      </div>
    ),
  },
  {
    id:       'accrual_type',
    header:   'Type',
    minWidth: '100px',
    cell: (row) => (
      <div className={cn(row.is_expired && 'opacity-50')}>
        <span className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
          ACCRUAL_BADGE[row.accrual_type] ?? 'bg-muted text-muted-foreground',
        )}>
          {ACCRUAL_TYPES.find(t => t.value === row.accrual_type)?.label ?? row.accrual_type}
        </span>
      </div>
    ),
  },
  {
    id:       'days',
    header:   'Days',
    minWidth: '60px',
    cell: (row) => (
      <div className={cn('tabular-nums font-semibold', row.is_expired && 'opacity-50')}>
        <span className={row.days < 0 ? 'text-destructive' : 'text-success'}>
          {row.days > 0 ? '+' : ''}{row.days}
        </span>
      </div>
    ),
  },
  {
    id:       'expires_on',
    header:   'Expires',
    minWidth: '110px',
    cell: (row) => {
      const expiringSoon =
        !row.is_expired &&
        row.expires_on != null &&
        new Date(row.expires_on).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000
      return (
        <div className={cn('text-xs tabular-nums whitespace-nowrap', row.is_expired && 'opacity-50')}>
          {row.expires_on ? (
            <span className={expiringSoon ? 'text-warning font-medium' : ''}>
              {fmtDateShort(row.expires_on)}
              {expiringSoon && <span className="ml-1 text-[9px]">⚠ soon</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      )
    },
  },
  {
    id:       'expired',
    header:   'Status',
    minWidth: '70px',
    cell: (row) => (
      row.is_expired
        ? <Badge variant="destructive" className="rounded-full text-[9px]">Expired</Badge>
        : <Badge variant="success"     className="rounded-full text-[9px]">Active</Badge>
    ),
  },
  {
    id:       'consumable',
    header:   'Available From',
    minWidth: '110px',
    cell: (row) => {
      const today = new Date().toISOString().slice(0, 10)
      const held  = row.consumption_eligible_from && row.consumption_eligible_from > today
      return held ? (
        <div className="flex items-center gap-1 text-xs text-warning">
          <Lock className="h-3 w-3" />
          {fmtDateShort(row.consumption_eligible_from!)}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )
    },
  },
  {
    id:        'notes',
    header:    'Notes',
    minWidth:  '160px',
    className: 'max-w-[200px]',
    cell: (row) => (
      <div className={cn('text-xs text-muted-foreground truncate', row.is_expired && 'opacity-50')}>
        {row.notes ?? '—'}
      </div>
    ),
  },
]

// ── Leave card color palette (cycles by index) ─────────────────────────────
const LEAVE_CARD_COLORS = [
  { topBar: 'bg-blue-500',    iconBg: 'bg-blue-100 dark:bg-blue-950/40',    iconText: 'text-blue-600 dark:text-blue-400',    bar: 'bg-blue-500'    },
  { topBar: 'bg-emerald-500', iconBg: 'bg-emerald-100 dark:bg-emerald-950/40', iconText: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  { topBar: 'bg-violet-500',  iconBg: 'bg-violet-100 dark:bg-violet-950/40',  iconText: 'text-violet-600 dark:text-violet-400',   bar: 'bg-violet-500'  },
  { topBar: 'bg-rose-500',    iconBg: 'bg-rose-100 dark:bg-rose-950/40',    iconText: 'text-rose-600 dark:text-rose-400',    bar: 'bg-rose-500'    },
  { topBar: 'bg-amber-500',   iconBg: 'bg-amber-100 dark:bg-amber-950/40',   iconText: 'text-amber-600 dark:text-amber-400',   bar: 'bg-amber-500'   },
  { topBar: 'bg-cyan-500',    iconBg: 'bg-cyan-100 dark:bg-cyan-950/40',    iconText: 'text-cyan-600 dark:text-cyan-400',    bar: 'bg-cyan-500'    },
] as const

// ── Main component ────────────────────────────────────────────────────────────

export function EssLeaveBalance() {
  const { profile }  = useAuthStore()
  const employeeId   = profile?.employee_id ?? null
  const queryClient  = useQueryClient()
  // Navigation state
  const [tab, setTab] = useState<TabKey>('overview')

  // Overview: selected balance card
  const [selectedBalanceId, setSelectedBalanceId] = useState<string | null>(null)

  // Overview: applications search + filter
  const [searchQuery,    setSearchQuery]    = useState('')
  const [appFilter,      setAppFilter]      = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  // ── Ledger filters ─────────────────────────────────────────────────────────
  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [ledgerYear,  setLedgerYear]  = useState('')
  const [accrualType, setAccrualType] = useState('')
  const [offset,      setOffset]      = useState(0)

  function applyFilter(fn: () => void) { fn(); setOffset(0) }

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: balData, isLoading: balLoading, isError: balError } = useQuery<{ data: BalanceRow[] }>({
    queryKey:  ['ess-leave-balance', employeeId],
    queryFn:   () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const { data: leaveData, isLoading: leaveLoading, isError: leaveError } = useQuery<{ data: LeaveApp[] }>({
    queryKey:  ['ess-leave-history', employeeId],
    queryFn:   () => api.get('/attendance/leave/my'),
    enabled:   !!employeeId,
    staleTime: 30_000,
  })

  // Holidays for the right panel
  const currentYear = new Date().getFullYear()
  const { data: holidaysData } = useQuery<{ data: HolidayRow[] }>({
    queryKey:  ['masters-holidays', currentYear],
    queryFn:   () => api.get(`/masters/holidays?year=${currentYear}`),
    enabled:   tab === 'overview',
    staleTime: 300_000,
    retry:     false,
  })

  const ledgerParams = new URLSearchParams()
  if (leaveTypeId) ledgerParams.set('leave_type_id', leaveTypeId)
  if (ledgerYear)  ledgerParams.set('year',          ledgerYear)
  if (accrualType) ledgerParams.set('accrual_type',  accrualType)
  ledgerParams.set('limit',  String(LEDGER_LIMIT))
  ledgerParams.set('offset', String(offset))

  const { data: ledgerData, isLoading: ledgerLoading, isError: ledgerError, refetch: refetchLedger } =
    useQuery<LedgerResponse>({
      queryKey:  ['ess-leave-ledger', employeeId, leaveTypeId, ledgerYear, accrualType, offset],
      queryFn:   () => api.get(`/attendance/leave/ledger/${employeeId}?${ledgerParams}`),
      enabled:   !!employeeId && tab === 'ledger',
      staleTime: 30_000,
    })

  const { data: compOffData, isLoading: compOffLoading, isError: compOffError } = useQuery<{ data: CompOffRequest[] }>({
    queryKey:  ['ess-compoff-my'],
    queryFn:   () => api.get('/attendance/comp-off'),
    enabled:   !!employeeId && tab === 'compoff',
    staleTime: 60_000,
  })

  // ── Lifecycle: held credits (credits posted but not yet consumable) ────────
  const { data: heldCreditsData } = useQuery<{ data: HeldCreditRow[] }>({
    queryKey:  ['ess-held-credits', employeeId],
    queryFn:   () => api.get(`/leave/lifecycle/held-credits/${employeeId}`),
    enabled:   !!employeeId && tab === 'overview',
    staleTime: 120_000,
  })

  // ── Lifecycle: active freezes ─────────────────────────────────────────────
  const { data: freezesData } = useQuery<{ data: FreezeRow[] }>({
    queryKey:  ['ess-leave-freezes', employeeId],
    queryFn:   () => api.get(`/leave/lifecycle/freeze/${employeeId}`),
    enabled:   !!employeeId && tab === 'overview',
    staleTime: 120_000,
    retry:     false,
  })

  // ── Mutation ───────────────────────────────────────────────────────────────

  const cancelLeaveMutation = useMutation({
    mutationFn: (leaveId: string) => api.post(`/leave/${leaveId}/cancel`),
    onSuccess: () => {
      toast.success('Leave request cancelled')
      queryClient.invalidateQueries({ queryKey: ['ess-leave-history', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['ess-leave-balance', employeeId] })
    },
    onError: () => toast.error('Failed to cancel leave request'),
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  const balances    = balData?.data   ?? []
  const allLeaves   = leaveData?.data ?? []
  const ledgerRows  = ledgerData?.data  ?? []
  const ledgerTotal = ledgerData?.total ?? 0
  const ledgerPage  = Math.floor(offset / LEDGER_LIMIT) + 1

  const heldCredits   = heldCreditsData?.data ?? []
  const totalHeldDays = useMemo(() =>
    heldCredits.reduce((s, r) => s + Number(r.days), 0),
    [heldCredits],
  )

  const activeFreezes = useMemo(() =>
    (freezesData?.data ?? []).filter(f => f.status === 'active'),
    [freezesData],
  )

  const coRequests    = compOffData?.data ?? []
  const coPending     = coRequests.filter(r => r.status === 'pending')
  const coApproved    = coRequests.filter(r => r.status === 'approved')
  const coTotalDays   = coApproved.reduce((s, r) => s + r.days_to_credit, 0)

  const totalBalance = useMemo(
    () => balances.filter(b => b.leave_types.is_paid).reduce((s, b) => s + b.balance, 0),
    [balances],
  )

  const totalApprovedDays = useMemo(
    () => allLeaves.filter(a => a.status === 'approved').reduce((s, a) => s + daysBetween(a.from_date, a.to_date), 0),
    [allLeaves],
  )

  const totalPendingDays = useMemo(
    () => allLeaves.filter(a => a.status === 'pending').reduce((s, a) => s + daysBetween(a.from_date, a.to_date), 0),
    [allLeaves],
  )

  // Upcoming holidays (non-optional, from today onwards, next 6)
  const today = new Date().toISOString().slice(0, 10)
  const upcomingHolidays = useMemo(() => {
    const all = holidaysData?.data ?? []
    return all
      .filter(h => !h.is_optional && h.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5)
  }, [holidaysData, today])

  const nextHoliday = upcomingHolidays[0] ?? null

  // Selected balance card
  const selectedBalance = useMemo(() => {
    if (!selectedBalanceId) return balances[0] ?? null
    return balances.find(b => b.id === selectedBalanceId) ?? balances[0] ?? null
  }, [selectedBalanceId, balances])

  // Filtered applications
  const filteredLeaves = useMemo(() => {
    const sorted = [...allLeaves].sort((a, b) => b.created_at.localeCompare(a.created_at))
    return sorted.filter(a => {
      const matchFilter = appFilter === 'all' || a.status === appFilter
      const matchSearch = !searchQuery ||
        (a.leave_types?.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.reason ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      return matchFilter && matchSearch
    })
  }, [allLeaves, appFilter, searchQuery])

  const uniqueLeaveTypes = useMemo(() => Array.from(
    new Map(
      balances.filter(b => b.leave_types).map(b => [b.leave_types.id, b.leave_types])
    ).values()
  ), [balances])

  const filterChips: Array<{ key: string; label: string }> = []
  if (leaveTypeId) {
    const lt = uniqueLeaveTypes.find(l => l.id === leaveTypeId)
    if (lt) filterChips.push({ key: 'leaveType', label: `Type: ${lt.name}` })
  }
  if (ledgerYear)  filterChips.push({ key: 'year',        label: `Year: ${ledgerYear}` })
  if (accrualType) {
    const at = ACCRUAL_TYPES.find(t => t.value === accrualType)
    if (at) filterChips.push({ key: 'accrualType', label: `Accrual: ${at.label}` })
  }
  function removeChip(key: string) {
    if (key === 'leaveType')   applyFilter(() => setLeaveTypeId(''))
    if (key === 'year')        applyFilter(() => setLedgerYear(''))
    if (key === 'accrualType') applyFilter(() => setAccrualType(''))
  }
  function clearAllChips() { setLeaveTypeId(''); setLedgerYear(''); setAccrualType(''); setOffset(0) }

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="My Leave" subtitle="Leave balances, applications, and accrual history" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Ledger toolbar ─────────────────────────────────────────────────────────

  const ledgerToolbarLeft = (
    <>
      <select
        value={leaveTypeId}
        onChange={e => applyFilter(() => setLeaveTypeId(e.target.value))}
        className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
      >
        <option value="">All Leave Types</option>
        {uniqueLeaveTypes.map(lt => (
          <option key={lt.id} value={lt.id}>{lt.name}</option>
        ))}
      </select>

      <select
        value={ledgerYear}
        onChange={e => applyFilter(() => setLedgerYear(e.target.value))}
        className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
      >
        <option value="">All Years</option>
        {buildYears().map(y => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>

      <select
        value={accrualType}
        onChange={e => applyFilter(() => setAccrualType(e.target.value))}
        className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
      >
        {ACCRUAL_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
    </>
  )

  const ledgerEmptyState = ledgerError ? (
    <div className="flex flex-col items-center py-8 gap-2 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">Failed to load ledger</p>
      <Button size="sm" variant="outline" onClick={() => refetchLedger()}>
        <RefreshCw className="h-3 w-3 mr-1.5" />Retry
      </Button>
    </div>
  ) : (
    <EmptyTableState
      preset="no-leave"
      description="No accrual entries found. Try adjusting the filters, or no leave credits have been issued yet."
    />
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="My Leave"
        subtitle="Leave balances, applications, and accrual history"
        actions={
          <Button
            onClick={() => setTab('apply')}
            className="gap-2 bg-gradient-to-r from-primary to-violet-600 hover:brightness-105 text-primary-foreground font-semibold shadow-sm hover:shadow transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            Apply for Leave
          </Button>
        }
      />

      {/* ── Horizontal tab bar ──────────────────────────────────────────────── */}
      <SubTabs<typeof tab>
        tabs={[
          { id: 'overview', label: 'Overview',       icon: CalendarDays },
          { id: 'ledger',   label: 'Accrual Ledger', icon: BookOpen     },
          { id: 'compoff',  label: 'Comp-Off',       icon: CalendarPlus },
        ]}
        value={tab}
        onChange={setTab}
        className="-mb-2"
        rightSlot={
          <button
            onClick={() => setTab('apply')}
            className={cn(
              'flex items-center gap-1.5 border-b-2 -mb-px px-3.5 py-2 text-[13px] font-medium transition-colors',
              tab === 'apply'
                ? 'border-primary text-primary'
                : 'border-transparent text-primary/70 hover:text-primary hover:border-primary/40',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Apply Leave
          </button>
        }
      />

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5 pt-4">

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION: OVERVIEW                                               */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {tab === 'overview' && (
            <>
              {/* ── Metrics Row ─────────────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                {/* Approved days */}
                <div className="bg-card ring-1 ring-black/5 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-11 h-11 bg-success/10 text-success rounded-xl flex items-center justify-center border border-success/20 shrink-0">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      Approved {new Date().getFullYear()}
                    </p>
                    <p className="text-xl font-bold font-display text-foreground mt-0.5">
                      {leaveLoading ? '—' : totalApprovedDays}{' '}
                      <span className="text-xs font-semibold text-muted-foreground font-sans">days taken</span>
                    </p>
                  </div>
                </div>

                {/* Pending days */}
                <div className="bg-card ring-1 ring-black/5 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-11 h-11 bg-primary/10 text-primary rounded-xl flex items-center justify-center border border-primary/20 shrink-0">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      Awaiting Signoff
                    </p>
                    <p className="text-xl font-bold font-display text-foreground mt-0.5">
                      {leaveLoading ? '—' : totalPendingDays}{' '}
                      <span className="text-xs font-semibold text-muted-foreground font-sans">days pending</span>
                    </p>
                  </div>
                </div>

                {/* Next holiday OR paid balance */}
                {nextHoliday ? (
                  <div className="bg-card ring-1 ring-black/5 rounded-2xl p-4 flex items-center gap-4">
                    <div className="w-11 h-11 bg-warning/10 text-warning rounded-xl flex items-center justify-center border border-warning/20 shrink-0">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                        Upcoming Holiday
                      </p>
                      <p className="text-sm font-bold font-display text-foreground mt-0.5 truncate">
                        {nextHoliday.name}
                      </p>
                      {(() => {
                        const rel = getDaysUntil(nextHoliday.date)
                        return (
                          <p className="text-[10px] text-warning font-semibold mt-0.5">
                            {rel ?? fmtDateReadable(nextHoliday.date)}
                          </p>
                        )
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="bg-card ring-1 ring-black/5 rounded-2xl p-4 flex items-center gap-4">
                    <div className="w-11 h-11 bg-info/10 text-info rounded-xl flex items-center justify-center border border-info/20 shrink-0">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                        Paid Balance
                      </p>
                      <p className="text-xl font-bold font-display text-foreground mt-0.5">
                        {balLoading ? '—' : totalBalance}{' '}
                        <span className="text-xs font-semibold text-muted-foreground font-sans">days left</span>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Main Split: Balances (8) + Holidays (4) ─────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                {/* Left 8: Balance Cards + Detail Panel */}
                <div className="lg:col-span-8 space-y-4">

                  {/* Section header */}
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-foreground text-sm tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-primary rounded-full" />
                      Allotted Balances &amp; Policies
                    </h3>
                    <span className="text-[10px] font-bold text-muted-foreground bg-card border border-border px-2.5 py-1 rounded-md">
                      FY{new Date().getFullYear()} ALLOCATIONS
                    </span>
                  </div>

                  {/* Balance cards grid */}
                  {balError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      Failed to load data. Please refresh and try again.
                    </div>
                  )}
                  {balLoading ? (
                    <IntelligenceLoadingSkeleton rows={3} cardHeight="h-28" />
                  ) : balances.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10">
                      <CalendarDays className="h-8 w-8 text-muted-foreground opacity-40" />
                      <p className="text-sm font-medium text-foreground">No balances configured</p>
                      <p className="text-xs text-muted-foreground text-center max-w-xs">
                        Your leave balances haven't been set up yet. Contact HR to configure your leave entitlements.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                      {balances.map((row, idx) => {
                        const isSelected = (selectedBalance?.id ?? balances[0]?.id) === row.id
                        const denominator = row.annual_entitlement && row.annual_entitlement > 0
                          ? row.annual_entitlement
                          : Math.max(row.balance, 1)
                        const used    = denominator - row.balance
                        const usedPct = Math.min(100, (used / denominator) * 100)
                        const low     = row.balance <= 3 && row.balance > 0
                        const empty   = row.balance === 0
                        const color   = LEAVE_CARD_COLORS[idx % LEAVE_CARD_COLORS.length]

                        return (
                          <div
                            key={row.id}
                            onClick={() => setSelectedBalanceId(row.id)}
                            className={cn(
                              'cursor-pointer rounded-2xl border overflow-hidden flex flex-col transition-all',
                              isSelected
                                ? 'border-primary shadow-md shadow-primary/10 ring-1 ring-primary/20'
                                : 'border-border bg-card hover:shadow-md hover:border-primary/20',
                            )}
                          >
                            {/* Colored top accent bar */}
                            <div className={cn('h-1 w-full flex-shrink-0', color.topBar)} />

                            <div className="p-4 flex flex-col gap-3 flex-1">
                              {/* Header: icon circle + name + paid badge */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                  <div className={cn(
                                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                                    color.iconBg,
                                  )}>
                                    <CalendarDays className={cn('h-4 w-4', color.iconText)} />
                                  </div>
                                  <span className="font-semibold text-xs text-foreground leading-tight">
                                    {row.leave_types.name}
                                  </span>
                                </div>
                                <span className={cn(
                                  'text-[9px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap',
                                  row.leave_types.is_paid
                                    ? 'bg-success/10 text-success'
                                    : 'bg-muted text-muted-foreground',
                                )}>
                                  {row.leave_types.is_paid ? 'Paid' : 'Unpaid'}
                                </span>
                              </div>

                              {/* Balance number */}
                              <div className="flex items-baseline gap-1.5">
                                <span className={cn(
                                  'text-3xl font-bold font-display leading-none',
                                  empty ? 'text-destructive' : low ? 'text-warning' : 'text-foreground',
                                )}>
                                  {row.balance}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-medium">
                                  available{row.annual_entitlement ? ` / ${row.annual_entitlement}` : ''}
                                </span>
                              </div>

                              {/* Progress bar + used label */}
                              <div className="space-y-1.5">
                                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all duration-500',
                                      empty ? 'bg-destructive/70' : low ? 'bg-warning' : color.bar,
                                    )}
                                    style={{ width: `${usedPct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  {used > 0 ? `${used} day${used !== 1 ? 's' : ''} used` : 'No days used yet'}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Selected balance detail panel */}
                  {selectedBalance && (
                    <div className="bg-card ring-1 ring-black/5 rounded-2xl p-5 space-y-4">
                      <div className="flex items-start justify-between border-b border-border/60 pb-3">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-primary uppercase tracking-widest leading-none block">
                            Balance Detail
                          </span>
                          <h4 className="font-bold font-display text-foreground text-sm">
                            {selectedBalance.leave_types.name}
                          </h4>
                        </div>
                        <div className="bg-muted/50 border border-border rounded-lg px-2.5 py-1 text-[10px] text-muted-foreground font-bold leading-none flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5 text-success" />
                          <span>HR Validated</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          {
                            label: 'Entitlement',
                            value: selectedBalance.annual_entitlement != null
                              ? `${selectedBalance.annual_entitlement}d`
                              : '—',
                            cls: 'text-foreground',
                          },
                          {
                            label: 'Remaining',
                            value: `${selectedBalance.balance}d`,
                            cls: selectedBalance.balance === 0
                              ? 'text-destructive'
                              : selectedBalance.balance <= 3
                              ? 'text-warning'
                              : 'text-success',
                          },
                          {
                            label: 'Used',
                            value: selectedBalance.annual_entitlement != null
                              ? `${Math.max(0, selectedBalance.annual_entitlement - selectedBalance.balance)}d`
                              : '—',
                            cls: 'text-foreground',
                          },
                          {
                            label: 'Type',
                            value: selectedBalance.leave_types.is_paid ? 'Paid' : 'Unpaid',
                            cls: selectedBalance.leave_types.is_paid ? 'text-success' : 'text-muted-foreground',
                          },
                        ].map(stat => (
                          <div
                            key={stat.label}
                            className="bg-muted/30 border border-border/50 p-3 rounded-xl flex flex-col gap-1"
                          >
                            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
                              {stat.label}
                            </span>
                            <span className={cn('font-bold font-display text-lg tabular-nums', stat.cls)}>
                              {stat.value}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                        <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>
                          Balances update after each approval. Carry-forward credits post at the start of the new financial year.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Active freeze warning */}
                  {activeFreezes.length > 0 && (
                    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-warning">
                        <Pause className="h-3.5 w-3.5" />
                        Accrual Freeze Active
                      </div>
                      {activeFreezes.map(f => (
                        <div key={f.id} className="text-xs text-muted-foreground pl-5 flex items-start gap-1.5">
                          <span className="text-warning">•</span>
                          <span>
                            {f.leave_types ? <strong>{f.leave_types.name}:</strong> : <strong>All leave types:</strong>}
                            {' '}{f.reason}
                            <span className="ml-1.5 text-[10px] opacity-70">
                              ({fmtDateShort(f.freeze_from)}
                              {f.freeze_to ? ` → ${fmtDateShort(f.freeze_to)}` : ' onwards'})
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Held credits */}
                  {heldCredits.length > 0 && (
                    <div className="bg-card ring-1 ring-black/5 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                          Pending Credits
                        </h4>
                        <span className="text-[10px] text-muted-foreground">
                          Credits posted but not yet available
                        </span>
                      </div>
                      <div className="rounded-md border border-info/20 bg-info/5 p-2.5 flex items-center gap-2 text-xs text-info">
                        <Info className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          <strong>{totalHeldDays} day{totalHeldDays !== 1 ? 's' : ''}</strong> accrued
                          — available once certain conditions are met.
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {heldCredits.map(hc => (
                          <div
                            key={hc.id}
                            className="flex items-center justify-between py-2 px-3 rounded-xl bg-muted/30 border border-border/50 text-xs"
                          >
                            <div>
                              <p className="font-medium text-foreground">
                                {hc.leave_types?.name ?? 'Leave'}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                Cycle: {hc.cycle_period ?? '—'}
                                {hc.release_trigger && (
                                  <span className="ml-1.5">
                                    · Releases {RELEASE_TRIGGER_LABEL[hc.release_trigger] ?? hc.release_trigger}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold tabular-nums text-info">+{hc.days}d</p>
                              {hc.consumption_eligible_from && (
                                <p className="text-[10px] text-muted-foreground">
                                  Available {fmtDateShort(hc.consumption_eligible_from)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right 4: Upcoming Holidays */}
                <div className="lg:col-span-4 bg-card ring-1 ring-black/5 rounded-2xl p-4 space-y-4">
                  <div className="border-b border-border/60 pb-3">
                    <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      Upcoming Holidays
                    </h3>
                    <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                      Approved company holidays for {currentYear}.
                    </p>
                  </div>

                  {upcomingHolidays.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground text-xs text-center">
                      <Calendar className="h-7 w-7 opacity-30" />
                      <span>No upcoming holidays found</span>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {upcomingHolidays.map(hol => {
                        const rel = getDaysUntil(hol.date)
                        const isSoon = rel === 'Today' || rel === 'Tomorrow' || (rel?.startsWith('In') ?? false)
                        return (
                          <div
                            key={hol.id}
                            className={cn(
                              'p-3 rounded-xl border flex justify-between items-center transition-colors',
                              isSoon
                                ? 'bg-warning/5 border-warning/30'
                                : 'bg-muted/30 border-border/50',
                            )}
                          >
                            <div className="space-y-0.5 min-w-0 flex-1 mr-2">
                              <p className={cn(
                                'text-xs font-bold truncate',
                                isSoon ? 'text-warning-foreground' : 'text-foreground',
                              )}>
                                {hol.name}
                              </p>
                              <p className="text-[10.5px] text-muted-foreground font-medium">
                                {fmtDateReadable(hol.date)}
                              </p>
                            </div>
                            {rel ? (
                              <span className={cn(
                                'text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-md border shrink-0',
                                rel === 'Today' || rel === 'Tomorrow'
                                  ? 'bg-warning/20 text-warning border-warning/30'
                                  : 'bg-muted text-muted-foreground border-border',
                              )}>
                                {rel}
                              </span>
                            ) : (
                              <span className="text-[9.5px] text-muted-foreground font-semibold uppercase shrink-0">
                                Gazetted
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Auto-skip note */}
                  <div className="p-3 bg-primary/5 border border-primary/15 rounded-xl flex items-start gap-2.5">
                    <Plane className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div className="text-[10px] leading-relaxed text-muted-foreground">
                      <p className="font-bold text-foreground uppercase tracking-wider text-[9px] mb-0.5">
                        Holiday Auto-Skip
                      </p>
                      <p>
                        The calendar automatically excludes official holidays from your leave count.
                        You're never billed for days that fall on gazetted holidays.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Applications Section ─────────────────────────────────── */}
              <div className="bg-card ring-1 ring-black/5 rounded-2xl p-5 space-y-4">

                {/* Section header + search + filter tabs */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
                  <div>
                    <h3 className="font-bold font-display text-foreground text-sm tracking-wide">
                      Recent Leave Submissions
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium">
                      Review progress or cancel pending requests.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search reason or type…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-8 pr-3 py-1.5 bg-muted/40 border border-border hover:border-primary/40 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:bg-background transition-colors w-[180px]"
                      />
                    </div>

                    {/* Filter tabs */}
                    <div className="flex items-center gap-1 bg-muted/50 border border-border rounded-xl p-1 text-[11px] font-bold">
                      {([
                        { id: 'all',      label: 'All'      },
                        { id: 'pending',  label: 'Pending'  },
                        { id: 'approved', label: 'Approved' },
                      ] as const).map(f => (
                        <button
                          key={f.id}
                          onClick={() => setAppFilter(f.id)}
                          className={cn(
                            'px-2.5 py-1 rounded-lg transition-colors',
                            appFilter === f.id
                              ? 'bg-background text-primary font-bold border border-border shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Applications list */}
                {leaveError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    Failed to load data. Please refresh and try again.
                  </div>
                )}
                {leaveLoading ? (
                  <IntelligenceLoadingSkeleton rows={3} cardHeight="h-16" />
                ) : filteredLeaves.length === 0 ? (
                  <div className="text-center py-10 border border-border rounded-xl bg-muted/30 space-y-2">
                    <Info className="h-7 w-7 text-muted-foreground mx-auto opacity-60" />
                    <p className="text-xs text-foreground font-bold">No applications matched</p>
                    <p className="text-[10px] text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
                      Try adjusting your search or filter, or click "Apply for Leave" to submit a new request.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredLeaves.map(r => (
                      <div
                        key={r.id}
                        className="bg-muted/30 border border-border/60 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/50 transition-colors"
                      >
                        {/* Left: type + dates */}
                        <div className="flex items-start gap-3.5">
                          <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center shrink-0">
                            <Bookmark className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-foreground">
                                {r.leave_types?.name ?? 'Leave'}
                              </span>
                              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {daysBetween(r.from_date, r.to_date)} day{daysBetween(r.from_date, r.to_date) !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-medium mt-0.5">
                              <span>{fmtDate(r.from_date)}</span>
                              {r.from_date !== r.to_date && (
                                <span> → {fmtDate(r.to_date)}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Middle: reason */}
                        {r.reason && (
                          <div className="flex-1 md:max-w-xs">
                            <p className="text-[11.5px] text-muted-foreground leading-relaxed line-clamp-2">
                              {r.reason}
                            </p>
                          </div>
                        )}

                        {/* Right: date + status + action */}
                        <div className="flex items-center justify-between md:justify-end gap-4">
                          <div className="text-left md:text-right">
                            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">
                              Submitted
                            </p>
                            <p className="text-xs font-bold text-foreground mt-0.5">
                              {fmtDate(r.created_at)}
                            </p>
                          </div>

                          {/* Status badge */}
                          {r.status === 'approved' && (
                            <span className="bg-success/10 text-success text-[10px] font-bold tracking-wider uppercase border border-success/20 px-3 py-1 rounded-full flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Approved
                            </span>
                          )}
                          {r.status === 'pending' && (
                            <span className="bg-warning/10 text-warning text-[10px] font-bold tracking-wider uppercase border border-warning/20 px-3 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                              <Clock className="h-3.5 w-3.5" />
                              Pending
                            </span>
                          )}
                          {r.status === 'rejected' && (
                            <span className="bg-destructive/10 text-destructive text-[10px] font-bold tracking-wider uppercase border border-destructive/20 px-3 py-1 rounded-full flex items-center gap-1.5">
                              <XCircle className="h-3.5 w-3.5" />
                              Rejected
                            </span>
                          )}
                          {r.status !== 'approved' && r.status !== 'pending' && r.status !== 'rejected' && (
                            <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'} className="rounded-full text-[10px] capitalize">
                              {r.status}
                            </Badge>
                          )}

                          {/* Cancel action */}
                          {r.status === 'pending' ? (
                            <button
                              onClick={() => cancelLeaveMutation.mutate(r.id)}
                              disabled={cancelLeaveMutation.isPending}
                              title="Cancel leave request"
                              className="p-1.5 text-muted-foreground hover:text-destructive bg-background hover:bg-destructive/5 border border-border hover:border-destructive/30 shadow-sm transition-colors rounded-xl disabled:opacity-40"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <div className="w-8" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION: ACCRUAL LEDGER                                         */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {tab === 'ledger' && (
            <>
              {/* Balance filter pills */}
              {balances.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] text-muted-foreground/60 mr-0.5">Filter by type:</span>
                  {balances.map(b => {
                    const isActive = leaveTypeId === b.leave_type_id
                    return (
                      <button
                        key={b.id}
                        onClick={() => applyFilter(() => setLeaveTypeId(isActive ? '' : b.leave_type_id))}
                        title={isActive ? 'Click to clear filter' : `Show ledger for ${b.leave_types?.name ?? 'this type'}`}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors',
                          isActive
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/[0.04]',
                        )}
                      >
                        <span className="font-medium">{b.leave_types?.name ?? '—'}</span>
                        <span className={cn('font-bold', b.balance <= 0 ? 'text-destructive' : isActive ? 'text-primary' : 'text-success')}>
                          {b.balance}d
                        </span>
                        <span className="text-muted-foreground text-[10px]">{b.year}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Ledger table */}
              <SectionCard
                title="Accrual History"
                icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
                noPadding
              >
                <TableToolbar
                  left={ledgerToolbarLeft}
                  filterChips={filterChips}
                  onRemoveChip={removeChip}
                  onClearAllChips={filterChips.length > 0 ? clearAllChips : undefined}
                />

                <DataTable<LedgerRow>
                  columns={LEDGER_COLUMNS}
                  data={ledgerError ? [] : ledgerRows}
                  getRowKey={row => row.id}
                  loading={ledgerLoading}
                  skeletonRows={8}
                  emptyState={ledgerEmptyState}
                />

                {!ledgerLoading && !ledgerError && ledgerTotal > 0 && (
                  <PaginationBar
                    total={ledgerTotal}
                    page={ledgerPage}
                    pageSize={LEDGER_LIMIT}
                    onPageChange={p => setOffset((p - 1) * LEDGER_LIMIT)}
                  />
                )}
              </SectionCard>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION: COMP-OFF                                               */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {tab === 'compoff' && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Pending Approval',  value: coPending.length,        icon: Clock,         cls: 'text-warning' },
                  { label: 'Total Days Earned',  value: `${coTotalDays}d`,       icon: CheckCircle2,  cls: 'text-success' },
                  { label: 'Total Requests',     value: coRequests.length,       icon: CalendarRange, cls: 'text-info'    },
                ].map(({ label, value, icon: Icon, cls }) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border bg-card p-3 flex items-center gap-3"
                  >
                    <div className={cn('p-2 rounded-lg bg-muted/50', cls)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className={cn('text-xl font-bold tabular-nums font-display', cls)}>{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Requests list */}
              <SectionCard
                title="My Comp-Off Requests"
                icon={<CalendarPlus className="h-4 w-4 text-muted-foreground" />}
              >
                {compOffError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    Failed to load data. Please refresh and try again.
                  </div>
                )}
                {compOffLoading ? (
                  <IntelligenceLoadingSkeleton rows={3} cardHeight="h-12" />
                ) : coRequests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <CalendarPlus className="h-10 w-10 opacity-30" />
                    <p className="text-sm font-medium text-foreground">No comp-off requests yet</p>
                    <p className="text-xs text-center max-w-sm">
                      When you work on a holiday or weekly-off day, HR will generate a comp-off request on your behalf.
                      Once approved, the days are credited to your leave balance.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {coRequests.map(req => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card"
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-sm font-medium text-foreground">{fmtDateIN(req.worked_date)}</p>
                            <p className="text-[11px] text-muted-foreground">{CO_REASON_LABEL[req.worked_reason]}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] rounded-full">
                            {req.days_to_credit === 0.5 ? 'Half Day' : `${req.days_to_credit} Day`}
                          </Badge>
                          {req.leave_types && (
                            <Badge variant="secondary" className="text-[10px] rounded-full">
                              {req.leave_types.name}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {req.status === 'approved' && req.approved_at && (
                            <span className="text-[10px] text-muted-foreground">
                              Approved {fmtDateIN(req.approved_at)}
                            </span>
                          )}
                          {req.status === 'pending' && (
                            <div className="flex items-center gap-1.5 text-[10px] text-warning">
                              <AlertCircle className="h-3 w-3" />
                              Awaiting HR approval
                            </div>
                          )}
                          <Badge variant={CO_STATUS_VARIANT[req.status]} className="text-[10px] rounded-full">
                            {CO_STATUS_LABEL[req.status]}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground">
                  <strong className="text-foreground">How comp-off works:</strong> When you work on a declared
                  holiday or your weekly-off day, HR generates a compensatory leave request. Once approved, the
                  days are automatically credited to your comp-off leave balance with a validity window per your
                  company policy.
                </div>
              </SectionCard>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SECTION: APPLY LEAVE (embedded full-width)                      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {tab === 'apply' && (
            <div className="h-[calc(100vh-220px)] min-h-[560px] -mx-0">
              <LeaveApply
                mode="sheet"
                onSuccess={() => {
                  setTab('overview')
                  queryClient.invalidateQueries({ queryKey: ['ess-leave-balance', employeeId] })
                  queryClient.invalidateQueries({ queryKey: ['ess-leave-history', employeeId] })
                }}
                onClose={() => setTab('overview')}
              />
            </div>
          )}

      </div>{/* end tab content */}
    </PageContainer>
  )
}
