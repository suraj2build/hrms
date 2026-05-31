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
import { useNavigate }                                 from 'react-router-dom'
import { useQuery, useMutation, useQueryClient }        from '@tanstack/react-query'
import {
  Scale, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, Search,
  Download, RefreshCw, Eye, TrendingDown,
  CheckCheck, ArrowUpRight,
} from 'lucide-react'

import { PageContainer }          from '@/components/layout/PageContainer'
import { PageHeader }             from '@/components/layout/PageHeader'
import { SectionCard }            from '@/components/layout/SectionCard'
import { Button }                 from '@/components/ui/button'
import { Badge }                  from '@/components/ui/badge'
import { Input }                  from '@/components/ui/input'
import { OperationalErrorBanner } from '@/components/async'
import { toast }                  from 'sonner'
import { api }                    from '@/lib/api/client'
import { useAuthStore }           from '@/stores/authStore'
import { cn }                     from '@/lib/utils'

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
  actor_id:        string | null
  actioned_at:     string | null
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

/** Per-category remediation guidance shown to the operator in the expanded panel. */
const CATEGORY_REMEDIATION: Record<string, { steps: string[]; escalateTo: string }> = {
  attendance: {
    steps: [
      'Verify the employee\'s attendance records in the Attendance module for the payroll period.',
      'Check if any leaves were approved that affected LOP/payable days after payroll was generated.',
      'Re-run attendance recompute for the employee, then re-generate payroll if the variance was caused by stale data.',
    ],
    escalateTo: 'Attendance Administrator',
  },
  overtime: {
    steps: [
      'Cross-check approved overtime entries in the Overtime module for this employee and period.',
      'Confirm the overtime rate used in payroll matches the employee\'s compensation structure.',
      'If overtime was approved after payroll run, create an arrear entry to include it in the next cycle.',
    ],
    escalateTo: 'HR Admin / Payroll Manager',
  },
  reimbursement: {
    steps: [
      'Verify all approved reimbursement claims in the Reimbursements module for this pay period.',
      'Check if any claims were submitted or approved after payroll was finalized.',
      'Pending claims should be queued for inclusion in the next payroll cycle.',
    ],
    escalateTo: 'Finance / Accounts Team',
  },
  advance: {
    steps: [
      'Review the advance recovery schedule for this employee in Payroll → Advances.',
      'Confirm whether the recovery amount was correctly deducted per the agreed schedule.',
      'If the schedule changed, update it before the next payroll run.',
    ],
    escalateTo: 'Payroll Manager',
  },
  deduction: {
    steps: [
      'Review all configured deductions for this employee in their compensation record.',
      'Check if any deduction was added, removed, or modified after the payroll snapshot was taken.',
      'Correct the deduction configuration and re-generate or issue a supplementary payslip.',
    ],
    escalateTo: 'HR Admin',
  },
  compliance: {
    steps: [
      'Verify EPF / ESI / TDS calculations in Payroll → Statutory for this employee.',
      'Check if the employee\'s exemption status, salary bracket, or investment declarations changed mid-period.',
      'Ensure the correct tax regime and declarations are on file before the next payroll run.',
      'Escalate immediately for critical compliance mismatches — late corrections may attract penalties.',
    ],
    escalateTo: 'Compliance / Finance Team',
  },
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
  const navigate    = useNavigate()
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
  const { data, isLoading, isError, refetch } = useQuery<{
    summary: ReconciliationSummary
    items:   ReconciliationItem[]
  }>({
    queryKey:  ['payroll-reconciliation', month],
    queryFn:   () => api.get(`/payroll/reconciliation?month=${month}`),
    staleTime: 60_000,
    enabled:   isAdmin,
    retry:     false,
  })

  // Acknowledge mutation — passes ?month so the backend can scope the action row
  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reconciliation/${id}/acknowledge?month=${month}`, {}),
    onMutate:   (id) => setActioningId(id),
    onSuccess:  () => toast.success('Discrepancy acknowledged'),
    onError:    (e: Error) => toast.error('Failed to acknowledge', { description: e.message }),
    onSettled:  () => { setActioningId(null); queryClient.invalidateQueries({ queryKey: ['payroll-reconciliation', month] }) },
  })

  // Escalate mutation
  const escalateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reconciliation/${id}/escalate?month=${month}`, {}),
    onMutate:   (id) => setActioningId(id),
    onSuccess:  () => toast.success('Discrepancy escalated'),
    onError:    (e: Error) => toast.error('Failed to escalate', { description: e.message }),
    onSettled:  () => { setActioningId(null); queryClient.invalidateQueries({ queryKey: ['payroll-reconciliation', month] }) },
  })

  // Resolve mutation — terminal "done" state after remediation
  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reconciliation/${id}/resolve?month=${month}`, {}),
    onMutate:   (id) => setActioningId(id),
    onSuccess:  () => toast.success('Discrepancy marked as resolved'),
    onError:    (e: Error) => toast.error('Failed to resolve', { description: e.message }),
    onSettled:  () => { setActioningId(null); queryClient.invalidateQueries({ queryKey: ['payroll-reconciliation', month] }) },
  })

  const summary = data?.summary
  const items   = data?.items ?? []

  // CSV export of currently-filtered reconciliation items
  function handleExport() {
    if (!filtered.length) { toast.error('No items to export'); return }
    const header = ['Employee Code', 'Employee Name', 'Category', 'Severity', 'Description', 'Payroll Value', 'Expected Value', 'Variance', 'Variance %', 'Status', 'Month'].join(',')
    const rows = filtered.map(item => [
      item.employee_code,
      `"${item.employee_name}"`,
      CATEGORY_LABELS[item.category] ?? item.category,
      item.severity,
      `"${item.description.replace(/"/g, '""')}"`,
      item.payroll_value,
      item.expected_value,
      item.variance,
      item.variance_pct.toFixed(2),
      item.status,
      item.month,
    ].join(','))
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: `reconciliation-${month}.csv` })
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    toast.success(`Exported ${filtered.length} items`)
  }

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
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleExport} disabled={!filtered.length}>
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
        ) : isError ? (
          <OperationalErrorBanner
            error="Failed to load reconciliation data — the API may be temporarily unavailable."
            severity="high"
            remediationText="Retry in a few seconds. If the error persists, check system health in the Observability Console."
            onRetry={() => refetch()}
            escalation={{ label: 'Open Observability Console', href: '/admin/system/observability' }}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <CheckCircle2 className="h-10 w-10 text-success/40" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {items.length === 0 ? 'No reconciliation data for this month' : 'No items match your filters'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {items.length === 0
                  ? 'Run payroll first to generate reconciliation data'
                  : 'Try adjusting your filters'}
              </p>
            </div>
            {items.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 mt-1"
                onClick={() => navigate('/admin/payroll')}
              >
                Go to Payroll Runs →
              </Button>
            )}
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
                  {isOpen && (() => {
                    const remediation = CATEGORY_REMEDIATION[item.category]
                    return (
                      <div className="border-t border-border bg-muted/20 p-4 space-y-3">
                        {/* Value comparison */}
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
                            <Badge
                              variant={
                                item.status === 'resolved'   ? 'success' :
                                item.status === 'escalated'  ? 'destructive' :
                                item.status === 'acknowledged' ? 'secondary' : 'outline'
                              }
                              className="text-[10px] rounded-full capitalize"
                            >
                              {item.status}
                            </Badge>
                          </div>
                        </div>

                        {/* Operator notes */}
                        {item.notes && (
                          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 italic">
                            "{item.notes}"
                          </div>
                        )}

                        {/* Remediation guidance */}
                        {remediation && item.status !== 'resolved' && (
                          <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                            <p className="text-xs font-semibold text-warning mb-2">
                              Remediation Guide — {CATEGORY_LABELS[item.category] ?? item.category}
                            </p>
                            <ol className="list-decimal list-inside space-y-1">
                              {remediation.steps.map((step, i) => (
                                <li key={i} className="text-[11px] text-foreground/80 leading-relaxed">
                                  {step}
                                </li>
                              ))}
                            </ol>
                            {item.severity === 'critical' && (
                              <p className="mt-2 text-[11px] text-destructive font-medium">
                                ⚠ Critical severity — escalate to {remediation.escalateTo} immediately.
                              </p>
                            )}
                            {item.severity === 'high' && (
                              <p className="mt-2 text-[11px] text-warning/80">
                                Resolve before next payroll run. Escalate to {remediation.escalateTo} if unresolved.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => navigate(`/admin/payroll?month=${item.month}&employee=${item.employee_id}`)}
                          >
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
                              {actioningId === item.id && escalateMutation.isPending ? 'Saving…' : `Escalate to ${remediation?.escalateTo ?? 'Admin'}`}
                            </Button>
                          )}
                          {/* Resolve — available after acknowledge or escalate */}
                          {(item.status === 'acknowledged' || item.status === 'escalated') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-success border-success/30 hover:bg-success/5"
                              disabled={actioningId === item.id || resolveMutation.isPending}
                              onClick={() => resolveMutation.mutate(item.id)}
                            >
                              <CheckCheck className="h-3 w-3" />
                              {actioningId === item.id && resolveMutation.isPending ? 'Resolving…' : 'Mark Resolved'}
                            </Button>
                          )}
                          {item.status === 'resolved' && (
                            <Badge
                              variant="success"
                              className="rounded-full text-[10px] capitalize self-center"
                            >
                              ✓ Resolved
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

    </PageContainer>
  )
}
