/**
 * PayrollValidation — /admin/payroll/validation
 *
 * Pre-run validation engine — configure rules, run validation, view results.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Play, Eye, Loader2,
  XCircle, AlertTriangle, Info,
  ToggleLeft, ToggleRight,
  Search, CheckCircle2, Filter,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast }        from 'sonner'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }           from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationRule {
  id: string
  rule_code: string
  rule_name: string
  description: string | null
  severity: 'error' | 'warning' | 'info'
  is_active: boolean
  rule_config: Record<string, unknown>
}

interface ValidationRun {
  id: string
  payroll_month: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  completed_at: string | null
  total_employees: number
  passed_count: number
  failed_count: number
  warning_count: number
}

interface ValidationResult {
  id: string
  rule_id: string
  employee_id: string
  severity: string
  message: string
  resolved: boolean
  employee_name?: string
  rule_name?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function duration(started: string, completed: string | null) {
  if (!completed) return '—'
  const ms = new Date(completed).getTime() - new Date(started).getTime()
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m ${secs % 60}s`
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    error:   { cls: 'text-destructive border-border', label: 'Error'   },
    warning: { cls: 'text-warning border-border',     label: 'Warning' },
    info:    { cls: 'text-info border-border',        label: 'Info'    },
  }
  const cfg = map[severity] ?? { cls: 'text-muted-foreground border-border', label: severity }
  return <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'error')   return <XCircle      className="h-4 w-4 text-destructive" />
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-warning"     />
  return                             <Info          className="h-4 w-4 text-info"         />
}

function RunStatusBadge({ status }: { status: ValidationRun['status'] }) {
  const map = {
    running:   { cls: 'text-info border-border',        label: 'Running'   },
    completed: { cls: 'text-success border-border',     label: 'Completed' },
    failed:    { cls: 'text-destructive border-border', label: 'Failed'    },
  }
  const { cls, label } = map[status]
  return <Badge variant="outline" className={cls}>{label}</Badge>
}

// ── Results Dialog ────────────────────────────────────────────────────────────

function ResultsDialog({
  run,
  open,
  onOpenChange,
}: {
  run: ValidationRun | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all')

  const { data: results, isLoading } = useQuery<ValidationResult[]>({
    queryKey: ['validation-results', run?.id],
    queryFn: () => api.get(`/payroll/validation/runs/${run!.id}/results`).then((r: any) => r.data),
    enabled: !!run && open,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ resultId, resolved }: { resultId: string; resolved: boolean }) =>
      api.put(`/payroll/validation/results/${resultId}`, { resolved }).then((r: any) => r.data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['validation-results', run?.id] })
      toast.success(vars.resolved ? 'Issue marked as resolved' : 'Issue reopened')
    },
    onError: (e: Error) => toast.error('Failed to update issue status', { description: e.message }),
  })

  if (!run) return null

  const filtered = severityFilter === 'all' ? results ?? [] : (results ?? []).filter(r => r.severity === severityFilter)

  const errorCount   = (results ?? []).filter(r => r.severity === 'error').length
  const warningCount = (results ?? []).filter(r => r.severity === 'warning').length
  const infoCount    = (results ?? []).filter(r => r.severity === 'info').length
  const unresolvedCount = (results ?? []).filter(r => !r.resolved).length

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setSeverityFilter('all'); onOpenChange(v) }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Validation Results — {run.payroll_month}</DialogTitle>
        </DialogHeader>
        <div className="pt-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading results…
            </div>
          ) : !results?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results found for this run.</p>
          ) : (
            <>
              {/* Severity summary + filter tabs */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  {([
                    { key: 'all',     label: `All (${results.length})`,        cls: 'text-foreground' },
                    { key: 'error',   label: `Errors (${errorCount})`,         cls: errorCount   > 0 ? 'text-destructive' : 'text-muted-foreground' },
                    { key: 'warning', label: `Warnings (${warningCount})`,     cls: warningCount > 0 ? 'text-warning'     : 'text-muted-foreground' },
                    { key: 'info',    label: `Info (${infoCount})`,            cls: 'text-info' },
                  ] as const).map(({ key, label, cls }) => (
                    <button
                      key={key}
                      onClick={() => setSeverityFilter(key)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                        severityFilter === key
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : `border-border bg-transparent ${cls} hover:bg-muted/40`,
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {unresolvedCount > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    <span className="text-warning font-medium">{unresolvedCount}</span> unresolved
                  </span>
                )}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 pb-3 font-medium">Employee</th>
                    <th className="px-3 pb-3 font-medium">Rule</th>
                    <th className="px-3 pb-3 font-medium">Severity</th>
                    <th className="px-3 pb-3 font-medium">Message</th>
                    <th className="px-3 pb-3 font-medium">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No {severityFilter !== 'all' ? severityFilter : ''} results.
                      </td>
                    </tr>
                  ) : filtered.map(r => (
                    <tr key={r.id} className={cn('border-b border-border transition-colors', r.resolved ? 'opacity-50' : 'hover:bg-muted/40')}>
                      <td className="px-3 py-2.5 text-foreground">{r.employee_name ?? r.employee_id}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.rule_name ?? r.rule_id}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <SeverityIcon severity={r.severity} />
                          <SeverityBadge severity={r.severity} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-foreground max-w-[280px]">
                        <p className="truncate" title={r.message}>{r.message}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => toggleMutation.mutate({ resultId: r.id, resolved: !r.resolved })}
                          disabled={toggleMutation.isPending}
                          className="focus:outline-none"
                          title={r.resolved ? 'Mark unresolved' : 'Mark resolved'}
                        >
                          {r.resolved
                            ? <ToggleRight className="h-5 w-5 text-success" />
                            : <ToggleLeft  className="h-5 w-5 text-muted-foreground" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Run Validation Dialog ─────────────────────────────────────────────────────

function RunValidationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (m: string) => api.post('/payroll/validation/run', { month: m }).then((r: any) => r.data),
    onSuccess: (_data, m) => {
      queryClient.invalidateQueries({ queryKey: ['validation-runs'] })
      onOpenChange(false)
      setMonth('')
      setError(null)
      toast.success('Validation run started', { description: m })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message
      setError(msg ?? 'Failed to start validation run.')
      toast.error('Failed to start validation run', { description: msg ?? undefined })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!month) { setError('Month is required.'); return }
    mutation.mutate(month)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setMonth(''); setError(null) } onOpenChange(v) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Run Validation</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Payroll Month <span className="text-destructive">*</span></label>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running…</>
                : <><Play className="mr-2 h-4 w-4" />Run</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Validation Rules Tab ──────────────────────────────────────────────────────

function ValidationRulesTab() {
  const queryClient = useQueryClient()
  const [ruleSearch,      setRuleSearch]      = useState('')
  const [severityFilter,  setSeverityFilter]  = useState<'all' | 'error' | 'warning' | 'info'>('all')

  const { data: rules, isLoading } = useQuery<ValidationRule[]>({
    queryKey: ['validation-rules'],
    queryFn: () => api.get('/payroll/validation/rules').then((r: any) => r.data),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/payroll/validation/rules/${id}`, { is_active }).then((r: any) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['validation-rules'] }),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading rules…
    </div>
  )

  if (!rules?.length) return (
    <p className="py-10 text-center text-sm text-muted-foreground">No validation rules configured.</p>
  )

  // Derived counters
  const activeCount   = rules.filter(r => r.is_active).length
  const errorCount    = rules.filter(r => r.severity === 'error'   && r.is_active).length
  const warningCount  = rules.filter(r => r.severity === 'warning' && r.is_active).length
  const infoCount     = rules.filter(r => r.severity === 'info'    && r.is_active).length

  const filtered = rules.filter(r => {
    const q = ruleSearch.toLowerCase()
    const matchSearch = !q || r.rule_name.toLowerCase().includes(q) || r.rule_code.toLowerCase().includes(q)
    const matchSev    = severityFilter === 'all' || r.severity === severityFilter
    return matchSearch && matchSev
  })

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{activeCount}</span> of {rules.length} rules active
        </span>
        <span className="text-muted-foreground/40">·</span>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <XCircle className="h-3 w-3" />{errorCount} error-type
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />{warningCount} warning-type
          </span>
        )}
        {infoCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-info">
            <Info className="h-3 w-3" />{infoCount} info-type
          </span>
        )}
        {activeCount === rules.length && (
          <span className="flex items-center gap-1 text-xs text-success ml-1">
            <CheckCircle2 className="h-3 w-3" />All rules active
          </span>
        )}
      </div>

      {/* Search + severity filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search rules…"
            value={ruleSearch}
            onChange={e => setRuleSearch(e.target.value)}
            className="h-8 text-xs pl-7"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value as typeof severityFilter)}
            className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
          >
            <option value="all">All Severity</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 pb-3 font-medium">Code</th>
              <th className="px-4 pb-3 font-medium">Name</th>
              <th className="px-4 pb-3 font-medium">Severity</th>
              <th className="px-4 pb-3 font-medium">Active</th>
              <th className="px-4 pb-3 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No rules match your filter.
                </td>
              </tr>
            ) : filtered.map(rule => (
              <tr key={rule.id} className={cn('border-b border-border transition-colors', !rule.is_active ? 'opacity-50' : 'hover:bg-muted/40')}>
                <td className="px-4 py-3 font-mono text-muted-foreground">{rule.rule_code}</td>
                <td className="px-4 py-3 font-medium text-foreground">{rule.rule_name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <SeverityIcon severity={rule.severity} />
                    <SeverityBadge severity={rule.severity} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                    disabled={toggleMutation.isPending}
                    className="focus:outline-none"
                    title={rule.is_active ? 'Disable rule' : 'Enable rule'}
                  >
                    {rule.is_active
                      ? <ToggleRight className="h-5 w-5 text-success" />
                      : <ToggleLeft  className="h-5 w-5 text-muted-foreground" />}
                  </button>
                </td>
                <td className="px-4 py-3 text-muted-foreground max-w-[300px]">
                  <p className="truncate" title={rule.description ?? undefined}>{rule.description ?? '—'}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Run History Tab ───────────────────────────────────────────────────────────

function RunHistoryTab() {
  const [runDialogOpen, setRunDialogOpen]   = useState(false)
  const [selectedRun, setSelectedRun]       = useState<ValidationRun | null>(null)
  const [resultsOpen, setResultsOpen]       = useState(false)

  const { data: runs, isLoading } = useQuery<ValidationRun[]>({
    queryKey: ['validation-runs'],
    queryFn: () => api.get('/payroll/validation/runs').then((r: any) => r.data),
  })

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setRunDialogOpen(true)} className="gap-2">
          <Play className="h-4 w-4" /> Run Validation
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading history…
        </div>
      ) : !runs?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No validation runs found. Run your first validation above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 pb-3 font-medium">Month</th>
                <th className="px-4 pb-3 font-medium">Status</th>
                <th className="px-4 pb-3 font-medium">Started</th>
                <th className="px-4 pb-3 font-medium">Duration</th>
                <th className="px-4 pb-3 font-medium text-right">Employees</th>
                <th className="px-4 pb-3 font-medium text-right">
                  <span className="text-success">Passed</span>
                </th>
                <th className="px-4 pb-3 font-medium text-right">
                  <span className="text-destructive">Failed</span>
                </th>
                <th className="px-4 pb-3 font-medium text-right">
                  <span className="text-warning">Warnings</span>
                </th>
                <th className="px-4 pb-3 font-medium text-right">Pass Rate</th>
                <th className="px-4 pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const passRate = run.total_employees > 0
                  ? Math.round((run.passed_count / run.total_employees) * 100)
                  : null
                return (
                <tr key={run.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-foreground">{run.payroll_month}</td>
                  <td className="px-4 py-3"><RunStatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(run.started_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{duration(run.started_at, run.completed_at)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{run.total_employees}</td>
                  <td className="px-4 py-3 text-right text-success font-medium">{run.passed_count}</td>
                  <td className="px-4 py-3 text-right text-destructive font-medium">{run.failed_count}</td>
                  <td className="px-4 py-3 text-right text-warning font-medium">{run.warning_count}</td>
                  <td className="px-4 py-3 text-right">
                    {passRate !== null ? (
                      <span className={cn(
                        'text-sm font-semibold tabular-nums',
                        passRate === 100 ? 'text-success' : passRate >= 80 ? 'text-warning' : 'text-destructive',
                      )}>
                        {passRate}%
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-muted-foreground"
                      disabled={run.status === 'running'}
                      onClick={() => { setSelectedRun(run); setResultsOpen(true) }}
                    >
                      <Eye className="h-4 w-4" /> View Results
                    </Button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <RunValidationDialog open={runDialogOpen} onOpenChange={setRunDialogOpen} />
      <ResultsDialog
        run={selectedRun}
        open={resultsOpen}
        onOpenChange={v => { if (!v) setSelectedRun(null); setResultsOpen(v) }}
      />
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PayrollValidation() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [activeTab, setActiveTab] = useState<'rules' | 'history'>('rules')

  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              You do not have permission to access Payroll Validation. Contact your HR administrator.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Validation"
        subtitle="Configure validation rules and run pre-payroll checks across all employees"
      />

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {([
          { id: 'rules'   as const, label: 'Validation Rules' },
          { id: 'history' as const, label: 'Run History'      },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <SectionCard>
        {activeTab === 'rules'   && <ValidationRulesTab />}
        {activeTab === 'history' && <RunHistoryTab />}
      </SectionCard>
    </PageContainer>
  )
}
