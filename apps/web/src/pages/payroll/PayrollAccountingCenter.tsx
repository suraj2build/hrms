/**
 * PayrollAccountingCenter — /admin/payroll/accounting
 *
 * Enterprise financial dashboard for payroll accounting:
 *   - KPI strip: total liability, unpaid obligations, statutory liabilities,
 *     payout completion %, imbalance alerts
 *   - GL Account balances table
 *   - Ledger registry per run (with post/reverse actions)
 *   - Cost-center / department burden view
 *   - ERP export controls (CSV, Tally, SAP, Zoho, QuickBooks)
 *
 * All accounting data derives from payroll_run_snapshots — never live tables.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }    from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Scale, CheckCircle2, AlertTriangle,
  RefreshCw, Loader2, TrendingUp,
  Building2, Download, FileText, RotateCcw,
  DollarSign, Upload, Camera,
  Hash, BadgeCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { api, ApiError } from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountingSummary {
  total_payroll_liability:  number
  pending_payout_amount:    number
  failed_payout_count:      number
  payout_completion_pct:    number
  imbalanced_ledger_count:  number
  total_ledger_count:       number
  posted_ledger_count:      number
  recent_ledgers:           FinancialLedger[]
}

interface FinancialLedger {
  id:                  string
  ledger_month:        string
  ledger_type:         string
  ledger_status:       string
  total_debit:         number
  total_credit:        number
  currency:            string
  integrity_hash:      string | null
  posted_at:           string | null
  reverses_ledger_id:  string | null
  notes:               string | null
  created_at:          string
  run_id?:             string
}

interface GLSummaryRow {
  code:        string
  name:        string
  category:    string
  totalDebit:  number
  totalCredit: number
  balance:     number
}

interface CostAllocationRow {
  employee_id:     string
  department_id:   string | null
  department_name: string | null
  gross_pay:       number
  net_pay:         number
  employer_burden: number
  statutory_burden: number
  overtime_cost:   number
  total_cost:      number
  allocation_pct:  number
}

interface PayrollRun {
  id:    string
  month: string
  status: string
}

interface GLMapping {
  id:             string
  component_code: string | null
  component_type: string
  debit_gl_code:  string
  debit_gl_name:  string
  credit_gl_code: string
  credit_gl_name: string
  is_active:      boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}
function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}
function fmtDate(d: string) {
  const s = d
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

const LEDGER_STATUS_COLORS: Record<string, string> = {
  draft:             'text-muted-foreground border-border',
  balanced:          'text-info border-info/40',
  pending_approval:  'text-warning border-warning/40',
  posted:            'text-success border-success/40',
  reversed:          'text-destructive border-destructive/40',
  archived:          'text-muted-foreground border-border',
}

const GL_CATEGORY_COLORS: Record<string, string> = {
  expense:  'text-destructive',
  liability: 'text-warning',
  asset:    'text-success',
  equity:   'text-info',
}

// ── Ledger Row ─────────────────────────────────────────────────────────────────

function LedgerRow({
  ledger,
  onPost,
  onReverse,
  onExport,
  isPosting,
  isReversing,
}: {
  ledger:      FinancialLedger
  onPost:      (id: string) => void
  onReverse:   (id: string) => void
  onExport:    (id: string, fmt: string) => void
  isPosting:   boolean
  isReversing: boolean
}) {
  const [showExport, setShowExport] = useState(false)
  const balanced = Math.abs((ledger.total_debit ?? 0) - (ledger.total_credit ?? 0)) < 0.01

  return (
    <div className="border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold">{fmtMonth(ledger.ledger_month)}</span>
            <Badge variant="outline" className={cn('text-[9px] rounded-full', LEDGER_STATUS_COLORS[ledger.ledger_status] ?? '')}>
              {ledger.ledger_status}
            </Badge>
            <Badge variant="outline" className="text-[9px] rounded-full text-muted-foreground border-border">
              {ledger.ledger_type}
            </Badge>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">{ledger.id.slice(0, 8)}…</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {ledger.ledger_status === 'balanced' && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onPost(ledger.id)} disabled={isPosting}>
              {isPosting ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
              <span className="ml-1">Post</span>
            </Button>
          )}
          {ledger.ledger_status === 'posted' && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/40" onClick={() => onReverse(ledger.id)} disabled={isReversing}>
              {isReversing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              <span className="ml-1">Reverse</span>
            </Button>
          )}
          <div className="relative">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowExport(v => !v)}>
              <Download className="h-3 w-3 mr-1" />Export {showExport ? '▲' : '▼'}
            </Button>
            {showExport && (
              <div className="absolute right-0 top-8 z-10 bg-card border border-border rounded-lg shadow-md p-1 min-w-[160px]">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Voucher</p>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#2E6FE6]/10 text-[#2E6FE6] font-medium rounded"
                  onClick={() => { onExport(ledger.id, 'xlsx'); setShowExport(false) }}>
                  📊 Voucher Excel (Cost Centre)
                </button>
                <div className="border-t border-border my-1" />
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ERP Formats</p>
                {(['csv','tally','sap','zoho','quickbooks'] as const).map(fmt => (
                  <button key={fmt} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 rounded"
                    onClick={() => { onExport(ledger.id, fmt); setShowExport(false) }}>
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground text-[10px]">Total Debit</p>
          <p className="font-mono font-medium">{fmtCurrency(ledger.total_debit ?? 0)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">Total Credit</p>
          <p className="font-mono font-medium">{fmtCurrency(ledger.total_credit ?? 0)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">Balance</p>
          <p className={cn('font-mono font-semibold', balanced ? 'text-success' : 'text-destructive')}>
            {balanced ? '✓ Balanced' : `⚠ ${fmtCurrency(Math.abs((ledger.total_debit ?? 0) - (ledger.total_credit ?? 0)))}`}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">Hash</p>
          <p className="font-mono text-[9px] text-muted-foreground/60">{ledger.integrity_hash?.slice(0, 10) ?? '—'}…</p>
        </div>
      </div>

      {ledger.posted_at && (
        <p className="text-[10px] text-muted-foreground">Posted {fmtDate(ledger.posted_at)}</p>
      )}
      {ledger.reverses_ledger_id && (
        <p className="text-[10px] text-warning">↩ Reversal of ledger {ledger.reverses_ledger_id.slice(0, 8)}…</p>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview',      label: 'Overview',    icon: <Scale className="h-3.5 w-3.5" /> },
  { key: 'ledgers',       label: 'Ledgers',     icon: <BookOpen className="h-3.5 w-3.5" /> },
  { key: 'gl-accounts',  label: 'GL Accounts', icon: <Hash className="h-3.5 w-3.5" /> },
  { key: 'cost-centers', label: 'Cost Centers', icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: 'gl-mappings',  label: 'GL Mappings', icon: <FileText className="h-3.5 w-3.5" /> },
] as const

export function PayrollAccountingCenter() {
  const [activeTab, setActiveTab]         = useState<typeof TABS[number]['key']>('overview')
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined)
  const [reverseReason, setReverseReason] = useState('')
  const [reverseLedgerId, setReverseLedgerId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: summaryRaw, isLoading: sumLoading, refetch } = useQuery<{ data: AccountingSummary }>({
    queryKey: ['accounting-summary'],
    queryFn:  () => api.get('/payroll/accounting/summary?months=6'),
    staleTime: 60_000,
  })
  const summary = summaryRaw?.data ?? null

  const { data: runsRaw } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-accounting'],
    queryFn:  () => api.get('/payroll/runs?limit=12'),
    staleTime: 60_000,
  })
  const runs      = (runsRaw?.data ?? [])
  const finalRuns = runs.filter(r => r.status === 'finalized')

  const { data: glSummaryRaw, isLoading: glLoading } = useQuery<{ data: GLSummaryRow[] }>({
    queryKey: ['gl-summary'],
    queryFn:  () => api.get('/payroll/accounting/gl-summary'),
    staleTime: 60_000,
    enabled:  activeTab === 'gl-accounts',
  })
  const glRows = glSummaryRaw?.data ?? []

  const { data: ledgersRaw, isLoading: ledgersLoading } = useQuery<{ data: FinancialLedger[] }>({
    queryKey: ['run-ledger', selectedRunId],
    queryFn:  () => api.get(`/payroll/runs/${selectedRunId}/ledger`),
    enabled:  !!selectedRunId && activeTab === 'ledgers',
    staleTime: 30_000,
  })
  const ledgers = ledgersRaw?.data ?? []

  const { data: costAllRaw, isLoading: costLoading } = useQuery<{ data: CostAllocationRow[] }>({
    queryKey: ['cost-allocations', selectedRunId],
    queryFn:  () => api.get(`/payroll/runs/${selectedRunId}/cost-allocations`),
    enabled:  !!selectedRunId && activeTab === 'cost-centers',
    staleTime: 60_000,
  })
  const costRows = useMemo(() => costAllRaw?.data ?? [], [costAllRaw])

  const { data: glMappingsRaw } = useQuery<{ data: GLMapping[] }>({
    queryKey: ['gl-mappings'],
    queryFn:  () => api.get('/payroll/gl-mappings'),
    staleTime: 300_000,
    enabled:  activeTab === 'gl-mappings',
  })
  const glMappings = glMappingsRaw?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────
  const generateLedgerMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/payroll/runs/${runId}/ledger`, { ledger_type: 'payroll' }),
    onSuccess: () => {
      toast.success('Financial ledger generated')
      queryClient.invalidateQueries({ queryKey: ['run-ledger', selectedRunId] })
      queryClient.invalidateQueries({ queryKey: ['accounting-summary'] })
    },
    onError: (e: unknown) => {
      // 409 SNAPSHOT_REQUIRED is actionable: the run has no immutable snapshot to
      // derive accounting from (usually because it isn't finalized). Show the
      // precise backend guidance instead of a generic failure.
      if (e instanceof ApiError && e.statusCode === 409 && e.error === 'SNAPSHOT_REQUIRED') {
        toast.error(e.message ?? 'Generate the payroll snapshot first', {
          description: 'Finalize the run, then use “Generate Snapshot”.',
        })
        return
      }
      toast.error(e instanceof Error ? e.message : 'Failed to generate ledger')
    },
  })

  const generateSnapshotMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/payroll/runs/${runId}/snapshot`, {}),
    onSuccess: () => {
      toast.success('Payroll snapshot generated')
      queryClient.invalidateQueries({ queryKey: ['run-ledger', selectedRunId] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not generate snapshot — finalize the run first'),
  })

  const postLedgerMutation = useMutation({
    mutationFn: (ledgerId: string) => api.post(`/payroll/ledgers/${ledgerId}/post`, {}),
    onSuccess: () => {
      toast.success('Ledger posted')
      queryClient.invalidateQueries({ queryKey: ['run-ledger', selectedRunId] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Post failed'),
  })

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/payroll/ledgers/${id}/reverse`, { reason }),
    onSuccess: () => {
      toast.success('Ledger reversed')
      setReverseLedgerId(null)
      setReverseReason('')
      queryClient.invalidateQueries({ queryKey: ['run-ledger', selectedRunId] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Reversal failed'),
  })

  const seedMappingsMutation = useMutation({
    mutationFn: () => api.post('/payroll/gl-mappings/seed', {}),
    onSuccess: () => {
      toast.success('Default GL mappings seeded')
      queryClient.invalidateQueries({ queryKey: ['gl-mappings'] })
    },
    onError: () => toast.error('Seeding failed'),
  })

  function handleExport(ledgerId: string, format: string) {
    window.open(`/api/payroll/ledgers/${ledgerId}/export?format=${format}`, '_blank')
  }

  // ── Dept breakdown for cost centers ───────────────────────────────────────
  const deptBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; totalCost: number; headcount: number; employerBurden: number }>()
    for (const r of costRows) {
      const key = r.department_name ?? 'Unassigned'
      const prev = map.get(key) ?? { name: key, totalCost: 0, headcount: 0, employerBurden: 0 }
      map.set(key, { name: key, totalCost: prev.totalCost + r.total_cost, headcount: prev.headcount + 1, employerBurden: prev.employerBurden + r.employer_burden })
    }
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost)
  }, [costRows])

  const totalRunCost = deptBreakdown.reduce((s, d) => s + d.totalCost, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Accounting Center"
        subtitle="Double-entry ledgers · GL mapping · Cost centers · ERP exports · Payout reconciliation"
        actions={
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={sumLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', sumLoading && 'animate-spin')} />Refresh
          </Button>
        }
      />

      {/* Imbalance alert */}
      {summary && summary.imbalanced_ledger_count > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">{summary.imbalanced_ledger_count} unbalanced ledger{summary.imbalanced_ledger_count > 1 ? 's' : ''}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ledgers with mismatched debit/credit totals must be fixed before posting.</p>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { label: 'Total Liability',   value: summary ? fmtCurrency(summary.total_payroll_liability) : '—',  color: 'text-warning',     icon: <Scale className="h-4 w-4 text-warning" /> },
          { label: 'Pending Payout',    value: summary ? fmtCurrency(summary.pending_payout_amount) : '—',   color: summary?.pending_payout_amount ? 'text-warning' : '',  icon: <DollarSign className="h-4 w-4 text-warning" /> },
          { label: 'Payout Complete',   value: summary ? `${summary.payout_completion_pct}%` : '—',          color: summary?.payout_completion_pct === 100 ? 'text-success' : 'text-info', icon: <CheckCircle2 className="h-4 w-4" /> },
          { label: 'Failed Payouts',    value: summary?.failed_payout_count ?? '—',                          color: (summary?.failed_payout_count ?? 0) > 0 ? 'text-destructive' : '', icon: <AlertTriangle className="h-4 w-4" /> },
          { label: 'Posted Ledgers',    value: `${summary?.posted_ledger_count ?? '—'} / ${summary?.total_ledger_count ?? '—'}`, color: '', icon: <BookOpen className="h-4 w-4" /> },
        ].map(k => (
          <div key={k.label} className="flex flex-col gap-1.5 p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-1.5">{k.icon}<p className="text-[10px] text-muted-foreground">{k.label}</p></div>
            <p className={cn('text-lg font-bold tabular-nums', k.color, sumLoading && 'animate-pulse text-muted-foreground/30')}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border border-border rounded-lg p-1 w-fit overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              activeTab === t.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="Recent Ledgers" icon={<BookOpen className="h-4 w-4" />} description="Last 6 financial ledgers across all runs">
            <div className="divide-y divide-border">
              {sumLoading ? <div className="p-4 text-muted-foreground text-sm flex gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
               : (summary?.recent_ledgers ?? []).length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">No ledgers yet. Select a finalized run on the Ledgers tab to generate one.</div>
               ) : (summary?.recent_ledgers ?? []).map(l => (
                <div key={l.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{fmtMonth(l.ledger_month)}</span>
                    <Badge variant="outline" className={cn('text-[9px] rounded-full', LEDGER_STATUS_COLORS[l.ledger_status] ?? '')}>
                      {l.ledger_status}
                    </Badge>
                  </div>
                  <span className="tabular-nums font-mono">{fmtCurrency(l.total_credit ?? 0)}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Accounting Principles" icon={<Scale className="h-4 w-4" />} description="How this system derives financial records">
            <div className="p-4 space-y-2 text-xs">
              {[
                { dr: 'Salary Expense (5000)',             cr: 'Payroll Payable (2100)',  note: 'Gross pay per employee' },
                { dr: 'Payroll Payable (2100)',             cr: 'EPF Employee (2110)',     note: 'PF employee deduction' },
                { dr: 'Employer PF Expense (5100)',         cr: 'EPF Employer (2111)',     note: 'Employer PF contribution' },
                { dr: 'Payroll Payable (2100)',             cr: 'TDS Payable (2130)',      note: 'TDS deduction' },
                { dr: 'Payroll Payable (2100)',             cr: 'Bank Account (1100)',     note: 'Net pay disbursement' },
                { dr: 'Salary Expense (5000)',              cr: 'Payroll Accrual (2105)', note: 'Month-end accrual' },
              ].map(e => (
                <div key={e.cr} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <span className="text-destructive/80 font-mono text-[10px]">Dr {e.dr}</span>
                  <span className="text-success/80 font-mono text-[10px]">Cr {e.cr}</span>
                  <span className="text-muted-foreground text-[9px]">{e.note}</span>
                </div>
              ))}
              <div className="mt-3 p-2 rounded bg-muted/20 text-[10px] text-muted-foreground">
                ∑ Debit == ∑ Credit enforced before posting. Imbalanced ledgers cannot be posted.
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Ledgers ── */}
      {activeTab === 'ledgers' && (
        <div className="space-y-4">
          {/* Run selector */}
          <SectionCard title="Select Run" icon={<BookOpen className="h-4 w-4" />} description="Choose a finalized run to view or generate its financial ledger">
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {finalRuns.map(r => (
                  <button key={r.id} onClick={() => setSelectedRunId(r.id)}
                    className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                    {fmtMonth(r.month)}
                  </button>
                ))}
              </div>
              {selectedRunId && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => generateSnapshotMutation.mutate(selectedRunId)} disabled={generateSnapshotMutation.isPending}>
                    {generateSnapshotMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Camera className="h-3.5 w-3.5 mr-1.5" />}
                    Generate Snapshot
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => generateLedgerMutation.mutate(selectedRunId)} disabled={generateLedgerMutation.isPending}>
                    {generateLedgerMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                    Generate Ledger from Snapshot
                  </Button>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Reversal dialog */}
          {reverseLedgerId && (
            <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-3">
              <p className="text-sm font-semibold text-destructive">Reverse Ledger {reverseLedgerId.slice(0, 8)}…</p>
              <p className="text-xs text-muted-foreground">A mirror entry set will be created. The original ledger will be marked as reversed. This action cannot be undone.</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-8 px-3 text-xs rounded-md border border-border bg-background"
                  placeholder="Reversal reason (required)"
                  value={reverseReason}
                  onChange={e => setReverseReason(e.target.value)}
                />
                <Button size="sm" variant="destructive" disabled={reverseReason.length < 5 || reverseMutation.isPending}
                  onClick={() => reverseMutation.mutate({ id: reverseLedgerId, reason: reverseReason })}>
                  {reverseMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm Reversal'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setReverseLedgerId(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Ledger cards */}
          {selectedRunId && (
            ledgersLoading ? (
              <div className="flex gap-2 text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin" />Loading ledgers…</div>
            ) : ledgers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground">
                <BookOpen className="h-8 w-8 opacity-30" />
                <p className="text-sm">No ledger yet — click "Generate Ledger from Snapshot" above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {ledgers.map(l => (
                  <LedgerRow
                    key={l.id}
                    ledger={l}
                    onPost={postLedgerMutation.mutate}
                    onReverse={(id) => { setReverseLedgerId(id); setReverseReason('') }}
                    onExport={handleExport}
                    isPosting={postLedgerMutation.isPending}
                    isReversing={reverseMutation.isPending}
                  />
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* ── GL Accounts ── */}
      {activeTab === 'gl-accounts' && (
        <SectionCard title="GL Account Balances" icon={<Hash className="h-4 w-4" />} description="Aggregate debit/credit and net balance per GL account across all posted ledgers">
          <div className="overflow-x-auto">
            {glLoading ? (
              <div className="flex gap-2 text-muted-foreground text-sm p-4"><Loader2 className="h-4 w-4 animate-spin" />Loading GL accounts…</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['GL Code','Account Name','Category','Total Debit','Total Credit','Net Balance'].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {glRows.map(row => (
                    <tr key={row.code} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-[10px]">{row.code}</td>
                      <td className="px-4 py-2.5 font-medium">{row.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={cn('text-[9px] rounded-full', GL_CATEGORY_COLORS[row.category] ?? '')}>{row.category}</Badge>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(row.totalDebit)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(row.totalCredit)}</td>
                      <td className={cn('px-4 py-2.5 tabular-nums font-semibold', row.balance > 0 ? 'text-success' : row.balance < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        {row.balance >= 0 ? '+' : ''}{fmtCurrency(row.balance)}
                      </td>
                    </tr>
                  ))}
                  {glRows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No GL entries yet. Generate a ledger first.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Cost Centers ── */}
      {activeTab === 'cost-centers' && (
        <div className="space-y-4">
          <SectionCard title="Run Selector" icon={<Building2 className="h-4 w-4" />} description="Select a run with a generated ledger">
            <div className="p-4 flex flex-wrap gap-2">
              {finalRuns.map(r => (
                <button key={r.id} onClick={() => setSelectedRunId(r.id)}
                  className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', selectedRunId === r.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40')}>
                  {fmtMonth(r.month)}
                </button>
              ))}
            </div>
          </SectionCard>

          {selectedRunId && (
            <>
              {/* Dept summary */}
              <SectionCard title="Department Cost Breakdown" icon={<Building2 className="h-4 w-4" />} description="Total employment cost (gross + employer burden) by department">
                <div className="p-4 space-y-2">
                  {costLoading ? <div className="flex gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
                   : deptBreakdown.length === 0 ? <p className="text-xs text-muted-foreground">No cost allocation data. Generate ledger first.</p>
                   : deptBreakdown.map(dept => {
                    const pct = totalRunCost > 0 ? (dept.totalCost / totalRunCost) * 100 : 0
                    return (
                      <div key={dept.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{dept.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{dept.headcount} employees</span>
                            <span className="font-mono tabular-nums">{fmtCurrency(dept.totalCost)}</span>
                            <span className="text-muted-foreground text-[10px]">{pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>

              {/* Employee allocations */}
              <SectionCard title="Employee Cost Allocations" icon={<TrendingUp className="h-4 w-4" />} description="Per-employee breakdown including employer burden and overtime">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {['Department','Gross Pay','Net Pay','Employer Burden','Statutory','OT','Total Cost','Share %'].map(h => (
                          <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {costRows.map((r, i) => (
                        <tr key={r.employee_id + i} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2">{r.department_name ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-2 tabular-nums">{fmtCurrency(r.gross_pay)}</td>
                          <td className="px-4 py-2 tabular-nums">{fmtCurrency(r.net_pay)}</td>
                          <td className="px-4 py-2 tabular-nums text-warning">{fmtCurrency(r.employer_burden)}</td>
                          <td className="px-4 py-2 tabular-nums">{fmtCurrency(r.statutory_burden)}</td>
                          <td className="px-4 py-2 tabular-nums">{fmtCurrency(r.overtime_cost)}</td>
                          <td className="px-4 py-2 tabular-nums font-semibold">{fmtCurrency(r.total_cost)}</td>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">{r.allocation_pct?.toFixed(2)}%</td>
                        </tr>
                      ))}
                      {costRows.length === 0 && !costLoading && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No allocations. Generate a ledger first.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* ── GL Mappings ── */}
      {activeTab === 'gl-mappings' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => seedMappingsMutation.mutate()} disabled={seedMappingsMutation.isPending}>
              {seedMappingsMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
              Seed Default Mappings
            </Button>
          </div>
          <SectionCard title="Component → GL Account Mappings" icon={<FileText className="h-4 w-4" />} description="Maps each salary component to its debit and credit GL accounts">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Component Code','Type','Debit GL','Debit Name','Credit GL','Credit Name','Active'].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {glMappings.map((m) => (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-[10px]">{m.component_code ?? <span className="text-muted-foreground italic">default</span>}</td>
                      <td className="px-4 py-2"><Badge variant="outline" className="text-[9px] rounded-full">{m.component_type}</Badge></td>
                      <td className="px-4 py-2 font-mono text-[10px] text-destructive">{m.debit_gl_code}</td>
                      <td className="px-4 py-2 text-muted-foreground">{m.debit_gl_name}</td>
                      <td className="px-4 py-2 font-mono text-[10px] text-success">{m.credit_gl_code}</td>
                      <td className="px-4 py-2 text-muted-foreground">{m.credit_gl_name}</td>
                      <td className="px-4 py-2">{m.is_active ? <CheckCircle2 className="h-3 w-3 text-success" /> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                  {glMappings.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No mappings. Click "Seed Default Mappings" to populate.</td></tr>}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}
    </PageContainer>
  )
}
