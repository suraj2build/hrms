/**
 * LeaveAccrualLedger — /leave/ledger
 *
 * Shows leave accrual / credit history from `leave_accrual_ledger`.
 * Works in two modes:
 *  · ESS mode  — employee sees their own ledger (auto-resolved from profile)
 *  · Admin mode — HR admin can look up any employee via EmployeeSelector (search by name or code)
 *
 * Columns: Accrual Date | Leave Type | Accrual Type | Days | Expires On | Expired | Notes
 * Filters: Leave Type (select), Year (select), Accrual Type (select)
 * Pagination: limit/offset-based (50 per page)
 *
 * Design: design-system tokens only — no raw colours.
 */

import { useState }                                      from 'react'
import { useQuery, keepPreviousData }                    from '@tanstack/react-query'
import {
  BookOpen,
  AlertTriangle,
  Search,
  ArrowRight,
}                                                        from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import {
  DataTable,
  TableToolbar,
  PaginationBar,
  EmptyTableState,
}                         from '@/components/table'
import type { DataTableColumn } from '@/components/table'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LedgerLeaveType {
  id:      string
  name:    string
  is_paid: boolean
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
  leave_types:  LedgerLeaveType | null
}

interface LedgerResponse {
  data:   LedgerRow[]
  total:  number
  limit:  number
  offset: number
}

interface BalanceRow {
  id:           string
  leave_type_id: string
  balance:       number
  year:          number
  leave_types:   LedgerLeaveType | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LIMIT = 50

const ACCRUAL_TYPES = [
  { value: '',               label: 'All Types' },
  { value: 'monthly',        label: 'Monthly' },
  { value: 'yearly',         label: 'Yearly' },
  { value: 'upfront',        label: 'Upfront' },
  { value: 'carry_forward',  label: 'Carry Forward' },
  { value: 'co_grant',       label: 'Comp Off' },
  { value: 'manual',         label: 'Manual' },
  { value: 'adjustment',     label: 'Adjustment' },
]

const ACCRUAL_BADGE: Record<string, string> = {
  monthly:       'bg-info/15 text-info',
  yearly:        'bg-primary/15 text-primary',
  upfront:       'bg-success/15 text-success',
  carry_forward: 'bg-warning/15 text-warning',
  co_grant:      'bg-accent/20 text-accent-foreground',
  manual:        'bg-muted text-muted-foreground',
  adjustment:    'bg-muted text-muted-foreground',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null): string {
  if (!dateStr) return '—'
  const s = dateStr
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function buildYears(): number[] {
  const cur = new Date().getFullYear()
  return [cur + 1, cur, cur - 1, cur - 2, cur - 3]
}

// ── Column definitions ────────────────────────────────────────────────────────

const LEDGER_COLUMNS: DataTableColumn<LedgerRow>[] = [
  {
    id:       'accrual_date',
    header:   'Accrual Date',
    minWidth: '110px',
    cell: (row) => (
      <div className={cn(row.is_expired && 'opacity-50')}>
        <div className="text-xs tabular-nums whitespace-nowrap">{fmt(row.accrued_on)}</div>
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
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
            ACCRUAL_BADGE[row.accrual_type] ?? 'bg-muted text-muted-foreground',
          )}
        >
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
              {fmt(row.expires_on)}
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
    header:   'Expired',
    minWidth: '70px',
    cell: (row) => (
      <div className={cn(row.is_expired && 'opacity-50')}>
        {row.is_expired ? (
          <Badge variant="destructive" className="rounded-full text-[9px]">Expired</Badge>
        ) : (
          <Badge variant="success" className="rounded-full text-[9px]">Active</Badge>
        )}
      </div>
    ),
  },
  {
    id:       'notes',
    header:   'Notes',
    minWidth: '160px',
    className: 'max-w-[200px]',
    cell: (row) => (
      <div className={cn('text-xs text-muted-foreground truncate', row.is_expired && 'opacity-50')}>
        {row.notes ?? '—'}
      </div>
    ),
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function LeaveAccrualLedger() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  // Admin mode: HR can look up any employee by UUID
  const [empIdInput,   setEmpIdInput]   = useState('')
  const [appliedEmpId, setAppliedEmpId] = useState<string | null>(null)

  // For ESS, use own employee_id from profile
  const essEmployeeId = profile?.employee_id ?? null
  const targetEmpId   = isAdmin ? appliedEmpId : essEmployeeId

  // Filters
  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [year,        setYear]        = useState('')
  const [accrualType, setAccrualType] = useState('')
  const [offset,      setOffset]      = useState(0)

  // ── Leave balance summary ──────────────────────────────────────────────────
  const { data: balanceResp } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave-balance', targetEmpId],
    queryFn:  () => api.get(`/attendance/leave/balance/${targetEmpId}`),
    enabled:  !!targetEmpId,
    staleTime: 30_000,
  })
  const balances = balanceResp?.data ?? []

  // ── Leave types (for filter dropdown) ─────────────────────────────────────
  // Derived from balance rows + ledger rows — no extra API call needed
  const uniqueLeaveTypes = Array.from(
    new Map(
      balances
        .filter(b => b.leave_types)
        .map(b => [b.leave_types!.id, b.leave_types!])
    ).values()
  )

  // ── Ledger query ──────────────────────────────────────────────────────────
  const params = new URLSearchParams()
  if (leaveTypeId) params.set('leave_type_id', leaveTypeId)
  if (year)        params.set('year',          year)
  if (accrualType) params.set('accrual_type',  accrualType)
  params.set('limit',  String(LIMIT))
  params.set('offset', String(offset))

  const { data, isLoading, isError, refetch } = useQuery<LedgerResponse>({
    queryKey: ['leave-ledger', targetEmpId, leaveTypeId, year, accrualType, offset],
    queryFn:  () => api.get(`/attendance/leave/ledger/${targetEmpId}?${params}`),
    enabled:  !!targetEmpId,
    staleTime: 30_000,
    placeholderData: keepPreviousData, // ISSUE-155 — keep rows visible during page transitions
  })

  const rows  = data?.data  ?? []
  const total = data?.total ?? 0
  const page  = Math.floor(offset / LIMIT) + 1

  // ── Reset offset when filters change ──────────────────────────────────────
  function applyFilter(fn: () => void) {
    fn()
    setOffset(0)
  }

  // ── Filter chips ──────────────────────────────────────────────────────────
  const filterChips: Array<{ key: string; label: string }> = []
  if (leaveTypeId) {
    const lt = uniqueLeaveTypes.find(l => l.id === leaveTypeId)
    if (lt) filterChips.push({ key: 'leaveType', label: `Type: ${lt.name}` })
  }
  if (year)        filterChips.push({ key: 'year',        label: `Year: ${year}` })
  if (accrualType) {
    const at = ACCRUAL_TYPES.find(t => t.value === accrualType)
    if (at) filterChips.push({ key: 'accrualType', label: `Accrual: ${at.label}` })
  }

  function removeChip(key: string) {
    if (key === 'leaveType')  applyFilter(() => setLeaveTypeId(''))
    if (key === 'year')       applyFilter(() => setYear(''))
    if (key === 'accrualType') applyFilter(() => setAccrualType(''))
  }

  function clearAllChips() {
    setLeaveTypeId('')
    setYear('')
    setAccrualType('')
    setOffset(0)
  }

  // ── Toolbar left slot ──────────────────────────────────────────────────────
  const toolbarLeft = (
    <>
      {/* Leave Type filter */}
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

      {/* Year filter */}
      <select
        value={year}
        onChange={e => applyFilter(() => setYear(e.target.value))}
        className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
      >
        <option value="">All Years</option>
        {buildYears().map(y => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>

      {/* Accrual Type filter */}
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

  // ── Empty / error states for DataTable ────────────────────────────────────
  const emptyStateNode = isError ? (
    <div className="flex flex-col items-center py-8 gap-2 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">Failed to load ledger</p>
      <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
    </div>
  ) : (
    <EmptyTableState
      preset="no-leave"
      description="No accrual entries found. Try adjusting the filters, or no leave credits have been issued yet."
    />
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Leave Management', href: '/admin/leave' }, { label: 'Leave Ledger' }]}
        title="Leave Ledger"
        subtitle="History of leave credits, carry-forwards, and comp-off grants"
      />

      {/* Admin: Employee picker */}
      {isAdmin && (
        <SectionCard
          title="Employee Lookup"
          icon={<Search className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <EmployeeSelector
              className="flex-1 max-w-sm"
              placeholder="Search employee by name or code…"
              value={empIdInput}
              onChange={v => {
                const val = typeof v === 'string' ? v : (v[0] ?? '')
                setEmpIdInput(val)
                setAppliedEmpId(val || null)
                setOffset(0)
              }}
            />
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                setAppliedEmpId(empIdInput.trim() || null)
                setOffset(0)
              }}
              disabled={!empIdInput.trim()}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Load Ledger
            </Button>
            {appliedEmpId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => { setAppliedEmpId(null); setEmpIdInput('') }}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Search by employee name or code to load their leave ledger.
          </p>
        </SectionCard>
      )}

      {/* ESS: no employee linked */}
      {!isAdmin && !essEmployeeId && (
        <SectionCard>
          <div className="flex flex-col items-center py-8 gap-2 text-center">
            <AlertTriangle className="h-8 w-8 text-warning" />
            <p className="text-sm font-medium">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Your account is not linked to an employee record. Contact HR.</p>
          </div>
        </SectionCard>
      )}

      {/* Balance summary pills — click to filter ledger by that leave type */}
      {targetEmpId && balances.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-muted-foreground/60 mr-0.5">Balances:</span>
          {balances.map(b => {
            const isActive = leaveTypeId === b.leave_type_id
            return (
              <button
                key={b.id}
                onClick={() => applyFilter(() => setLeaveTypeId(isActive ? '' : b.leave_type_id))}
                title={isActive ? 'Click to clear filter' : `Filter ledger to ${b.leave_types?.name ?? 'this type'}`}
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
      {targetEmpId && (
        <SectionCard
          title="Accrual History"
          icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
          noPadding
        >
          <TableToolbar
            left={toolbarLeft}
            filterChips={filterChips}
            onRemoveChip={removeChip}
            onClearAllChips={filterChips.length > 0 ? clearAllChips : undefined}
          />

          <DataTable<LedgerRow>
            columns={LEDGER_COLUMNS}
            data={isError ? [] : rows}
            getRowKey={row => row.id}
            loading={isLoading}
            skeletonRows={8}
            emptyState={emptyStateNode}
          />

          {!isLoading && !isError && total > 0 && (
            <PaginationBar
              total={total}
              page={page}
              pageSize={LIMIT}
              onPageChange={p => setOffset((p - 1) * LIMIT)}
            />
          )}
        </SectionCard>
      )}

      {/* Admin: no employee selected yet */}
      {isAdmin && !appliedEmpId && (
        <SectionCard>
          <div className="flex flex-col items-center py-10 gap-2 text-center text-muted-foreground">
            <BookOpen className="h-7 w-7 opacity-25" />
            <p className="text-sm font-medium text-foreground">No employee selected</p>
            <p className="text-xs max-w-xs">
              Paste an employee ID above to view their leave accrual history, carry-forwards, and current balances.
            </p>
          </div>
        </SectionCard>
      )}
    </PageContainer>
  )
}
