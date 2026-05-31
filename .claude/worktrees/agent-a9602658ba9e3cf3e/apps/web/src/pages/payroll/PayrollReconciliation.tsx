/**
 * PayrollReconciliation — Payroll Reconciliation Center
 *
 * Compares payroll output against:
 *   · Attendance (LOP / payable days)
 *   · Overtime
 *   · Reimbursements
 *   · Advances
 *   · Deductions
 *   · Compliance (EPF/ESI/TDS)
 *
 * Shows mismatch severity, employee drilldowns, and resolution workflows.
 */

import { useState }                                    from 'react'
import { useQuery, useMutation, useQueryClient }        from '@tanstack/react-query'
import {
  Scale, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, Search,
  Download, RefreshCw, Eye, TrendingDown,
  CheckCheck, ArrowUpRight,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { toast }         from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'ok'

interface ReconciliationItem {
  id:              string
  employee_id:     string
  employee_name:   string
  employee_code:   string
  department:      string
  category:        'attendance' | 'overtime' | 'reimbursement' | 'advance' | 'deduction' | 'compliance'
  description:     string
  payroll_value:   number
  expected_value:  number
  variance:        number
  variance_pct:    number
  severity:        Severity
  status:          'open' | 'acknowledged' | 'resolved' | 'escalated'
  month:           string
  notes:           string | null
}

interface ReconciliationSummary {
  total_mismatches:   number
  critical_count:     number
  high_count:         number
  medium_count:       number
  low_count:          number
  resolved_count:     number
  total_variance_abs: number
  by_category: Record<string, number>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<Severity, { label: string; variant: 'destructive' | 'warning' | 'secondary' | 'success' | 'outline' }> = {
  critical: { label: 'Critical', variant: 'destructive' },
  high:     { label: 'High',     variant: 'warning' },
  medium:   { label: 'Medium',   variant: 'secondary' },
  low:      { label: 'Low',      variant: 'outline' },
  ok:       { label: 'OK',       variant: 'success' },
}

const CATEGORY_LABELS: Record<string, string> = {
  attendance:    'Attendance',
  overtime:      'Overtime',
  reimbursement: 'Reimbursement',
  advance:       'Advance Recovery',
  deduction:     'Deductions',
  compliance:    'Compliance',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, colorClass }: {
  label: string; value: string | number; icon: typeof Scale; colorClass: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3">
      <div className={cn('rounded-md p-2 flex-shrink-0', colorClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide leading-none">{label}</p>
        <p className="text-xl font-bold text-foreground mt-1 tabular-nums leading-none">{value}</p>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PayrollReconciliation() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const queryClient = useQueryClient()

  const currentMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth]       = useState(currentMonth)
  const [search, setSearch]     = useState('')
  const [category, setCategory] = useState<string>('all')
  const [severity, setSeverity] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [actioningId, setActioningId] = useState<string | null>(null)

  // Fetch reconciliation data
  const { data, isLoading, refetch } = useQuery<{
    summary: ReconciliationSummary
    items:   ReconciliationItem[]
  }>({
    queryKey:  ['payroll-reconciliation', month],
    queryFn:   () => api.get(`/payroll/reconciliation?month=${month}`),
    staleTime: 60_000,
    enabled:   isAdmin,
    retry:     false,
  })

  // Acknowledge mutation
  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reconciliation/${id}/acknowledge`, {}),
    onMutate:   (id) => setActioningId(id),
    onSuccess:  () => toast.success('Discrepancy acknowledged'),
    onError:    (e: Error) => toast.error('Failed to acknowledge', { description: e.message }),
    onSettled:  () => { setActioningId(null); queryClient.invalidateQueries({ queryKey: ['payroll-reconciliation', month] }) },
  })

  // Escalate mutation
  const escalateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reconciliation/${id}/escalate`, {}),
    onMutate:   (id) => setActioningId(id),
    onSuccess:  () => toast.success('Discrepancy escalated'),
    onError:    (e: Error) => toast.error('Failed to escalate', { description: e.message }),
    onSettled:  () => { setActioningId(null); queryClient.invalidateQueries({ queryKey: ['payroll-reconciliation', month] }) },
  })

  const summary = data?.summary
  const items   = data?.items ?? []

  // Filter
  const filtered = items.filter(item => {
    const matchSearch   = !search || item.employee_name.toLowerCase().includes(search.toLowerCase()) || item.employee_code.toLowerCase().includes(search.toLowerCase())
    const matchCategory = category === 'all' || item.category === category
    const matchSeverity = severity === 'all' || item.severity === severity
    return matchSearch && matchCategory && matchSeverity
  })

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Scale className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Access restricted to HR Admin and Super Admin</p>
      </div>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Reconciliation"
        subtitle={`Variance analysis across attendance, overtime, deductions and compliance · ${month}`}
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Mismatches"
          value={summary?.total_mismatches ?? '—'}
          icon={Scale}
          colorClass="bg-muted text-muted-foreground"
        />
        <SummaryCard
          label="Critical / High"
          value={summary ? `${summary.critical_count} / ${summary.high_count}` : '—'}
          icon={AlertTriangle}
          colorClass="bg-destructive/10 text-destructive"
        />
        <SummaryCard
          label="Resolved"
          value={summary?.resolved_count ?? '—'}
          icon={CheckCircle2}
          colorClass="bg-success/10 text-success"
        />
        <SummaryCard
          label="Net Variance"
          value={summary ? fmt(summary.total_variance_abs) : '—'}
          icon={TrendingDown}
          colorClass="bg-warning/10 text-warning"
        />
      </div>

      {/* Category breakdown strip */}
      {summary && Object.keys(summary.by_category).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs font-medium text-muted-foreground">By category:</span>
          {Object.entries(summary.by_category).map(([cat, count]) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(prev => prev === cat ? 'all' : cat)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                category === cat
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {CATEGORY_LABELS[cat] ?? cat}
              <span className={cn(
                'tabular-nums font-bold',
                category === cat ? 'text-primary' : 'text-foreground',
              )}>{count}</span>
            </button>
          ))}
          {category !== 'all' && (
            <button
              type="button"
              onClick={() => setCategory('all')}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              clear
            </button>
          )}
        </div>
      )}

      {/* Filters + controls */}
      <SectionCard
        title="Reconciliation Items"
        icon={<Scale className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Download className="h-3 w-3" /> Export
            </Button>
          </div>
        }
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
          />
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search employee…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs pl-7"
            />
          </div>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
          >
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {/* Items list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-success/40 mb-3" />
            <p className="text-sm font-medium text-foreground">
              {items.length === 0 ? 'No reconciliation data for this month' : 'No items match your filters'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {items.length === 0
                ? 'Run payroll first to generate reconciliation data'
                : 'Try adjusting your filters'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(item => {
              const isOpen = expanded.has(item.id)
              const sc     = SEVERITY_CONFIG[item.severity]
              return (
                <div key={item.id} className="rounded-lg border border-border overflow-hidden">
                  {/* Row header */}
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="flex-shrink-0">
                      {isOpen
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{item.employee_name}</span>
                        <span className="text-xs text-muted-foreground">#{item.employee_code}</span>
                        {item.department && (
                          <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">{item.department}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Badge variant={CATEGORY_LABELS[item.category] ? 'outline' : 'secondary'} className="text-[10px] rounded-full">
                        {CATEGORY_LABELS[item.category] ?? item.category}
                      </Badge>
                      <Badge variant={sc.variant} className="text-[10px] rounded-full">
                        {sc.label}
                      </Badge>
                      <div className="text-right">
                        <div className={cn(
                          'text-sm font-semibold tabular-nums',
                          item.variance < 0 ? 'text-destructive' : 'text-success',
                        )}>
                          {item.variance < 0 ? '−' : '+'}{fmt(Math.abs(item.variance))}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {item.variance_pct > 0 ? '+' : ''}{item.variance_pct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="border-t border-border bg-muted/20 p-4 space-y-3">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Payroll Value</p>
                          <p className="font-semibold tabular-nums">{fmt(item.payroll_value)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Expected Value</p>
                          <p className="font-semibold tabular-nums">{fmt(item.expected_value)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Status</p>
                          <Badge variant={item.status === 'resolved' ? 'success' : item.status === 'escalated' ? 'destructive' : 'secondary'} className="text-[10px] rounded-full capitalize">
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                      {item.notes && (
                        <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">{item.notes}</div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                          <Eye className="h-3 w-3" /> View Payslip
                        </Button>
                        {item.status !== 'acknowledged' && item.status !== 'resolved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-success border-success/30 hover:bg-success/5"
                            disabled={actioningId === item.id || acknowledgeMutation.isPending}
                            onClick={() => acknowledgeMutation.mutate(item.id)}
                          >
                            <CheckCheck className="h-3 w-3" />
                            {actioningId === item.id && acknowledgeMutation.isPending ? 'Saving…' : 'Acknowledge'}
                          </Button>
                        )}
                        {item.status !== 'escalated' && item.status !== 'resolved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                            disabled={actioningId === item.id || escalateMutation.isPending}
                            onClick={() => escalateMutation.mutate(item.id)}
                          >
                            <ArrowUpRight className="h-3 w-3" />
                            {actioningId === item.id && escalateMutation.isPending ? 'Saving…' : 'Escalate'}
                          </Button>
                        )}
                        {(item.status === 'acknowledged' || item.status === 'escalated') && (
                          <Badge
                            variant={item.status === 'escalated' ? 'destructive' : 'success'}
                            className="rounded-full text-[10px] capitalize self-center"
                          >
                            {item.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

    </PageContainer>
  )
}
