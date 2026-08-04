/**
 * PayrollValidation — /admin/payroll/validation
 *
 * Pre-run validation engine — configure rules, run validation, view results.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Play, Eye, Loader2,
  XCircle, AlertTriangle, Info,
  ToggleLeft, ToggleRight,
  Search, CheckCircle2, Filter,
  Lock, ShieldCheck,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SubTabs }       from '@/components/ui/SubTabs'
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
import { api, ApiError } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn, fmtDate, formatCurrency as fmtCurrency } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Matches payroll_validation_rules table (seeded via migration 143) */
interface ValidationRule {
  id:                  string
  code:                string
  name:                string
  description:         string | null
  severity:            'critical' | 'warning' | 'info'
  enabled:             boolean
  blocking:            boolean
  stage:               string | null
  remediation_route:   string | null
}

/** Matches PayrollRun shape returned by GET /payroll/runs */
interface PayrollRun {
  id:               string
  month:            string
  status:           'draft' | 'partial_failed' | 'processing' | 'finalized' | 'failed'
  employee_count:   number
  total_gross:      number
  total_net:        number
  failure_summary:  { total_failed: number; total_employees: number } | null
  created_at:       string
  finalized_at:     string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    critical: { cls: 'text-destructive border-border', label: 'Critical' },
    warning:  { cls: 'text-warning border-border',     label: 'Warning'  },
    info:     { cls: 'text-info border-border',        label: 'Info'     },
    // legacy alias kept for safety
    error:    { cls: 'text-destructive border-border', label: 'Error'    },
  }
  const cfg = map[severity] ?? { cls: 'text-muted-foreground border-border', label: severity }
  return <Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge>
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical' || severity === 'error')
    return <XCircle       className="h-4 w-4 text-destructive" />
  if (severity === 'warning')
    return <AlertTriangle className="h-4 w-4 text-warning"     />
  return       <Info      className="h-4 w-4 text-info"         />
}

function RunStatusBadge({ status }: { status: PayrollRun['status'] }) {
  const map: Record<PayrollRun['status'], { cls: string; label: string }> = {
    draft:           { cls: 'text-muted-foreground border-border', label: 'Draft'          },
    processing:      { cls: 'text-info border-border',             label: 'Processing'     },
    finalized:       { cls: 'text-success border-border',          label: 'Finalized'      },
    failed:          { cls: 'text-destructive border-border',      label: 'Failed'         },
    partial_failed:  { cls: 'text-warning border-border',          label: 'Partial Fail'   },
  }
  const { cls, label } = map[status] ?? { cls: 'text-muted-foreground border-border', label: status }
  return <Badge variant="outline" className={cls}>{label}</Badge>
}

// ── Run Validation Dialog ─────────────────────────────────────────────────────

function RunValidationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  // Default to current month (browser-local, not UTC — new Date().toISOString()
  // is a day behind local for timezones ahead of UTC like IST between midnight
  // and the UTC offset, which would pre-fill the wrong month on the 1st).
  const todayYM = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const [month, setMonth] = useState(todayYM)
  const [error, setError] = useState<string | null>(null)

  // Mirrors PayrollControlCenter.tsx's runPayrollMutation — sent as
  // Idempotency-Key so a double-click/network retry doesn't trigger a second
  // real payroll run for the same month.
  const runKey = useRef(crypto.randomUUID())

  const mutation = useMutation({
    // POST /payroll/runs returns a top-level object { run_id, month, ... } (no { data } wrapper).
    mutationFn: (m: string) =>
      api.post<{ run_id?: string; id?: string }>('/payroll/runs', { month: m }, {
        headers: { 'Idempotency-Key': runKey.current },
      }),
    onSuccess: (data, _m) => {
      runKey.current = crypto.randomUUID()
      queryClient.invalidateQueries({ queryKey: ['payroll-runs-history'] })
      onOpenChange(false)
      setMonth(todayYM)
      setError(null)
      const runId = data?.run_id ?? data?.id
      toast.success('Payroll run started', {
        description: `Month: ${_m}`,
        action: runId
          ? { label: 'View Run', onClick: () => navigate(`/admin/payroll`) }
          : undefined,
      })
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError
        ? e.message
        : (e as Error)?.message ?? 'Failed to start payroll run.'
      setError(msg)
      toast.error('Failed to start run', { description: msg })
    },
  })

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!month) { setError('Month is required.'); return }
    setError(null)
    mutation.mutate(month)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setMonth(todayYM); setError(null) } onOpenChange(v) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              Payroll Month <span className="text-destructive">*</span>
            </label>
            <Input
              type="month"
              value={month}
              onChange={e => { setMonth(e.target.value); setError(null) }}
            />
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
  const { profile } = useAuthStore()
  const isSuperAdmin = profile?.role === 'super_admin'

  const [ruleSearch,     setRuleSearch]     = useState('')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all')
  const [stageFilter,    setStageFilter]    = useState<'all' | string>('all')

  const { data: rules, isLoading } = useQuery<ValidationRule[]>({
    queryKey: ['validation-rules'],
    queryFn:  (): Promise<ValidationRule[]> =>
      api.get<{ data?: { data?: ValidationRule[] } | ValidationRule[] }>('/payroll/validation-rules').then(r => {
        const d = r.data
        if (Array.isArray(d)) return d
        return d?.data ?? []
      }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<{ data: unknown }>(`/payroll/validation-rules/${id}`, { enabled }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['validation-rules'] })
      toast.success('Rule updated')
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message
      toast.error('Failed to update rule', { description: msg })
    },
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading rules…
    </div>
  )

  if (!rules?.length) return (
    <div className="py-10 flex flex-col items-center gap-4 text-center">
      <ShieldAlert className="h-8 w-8 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium text-foreground">No validation rules configured yet.</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Default rules are seeded automatically. If none appear, run the database migration or contact your system administrator.
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-left max-w-md w-full">
        {[
          { code: 'COMP_MISSING',  label: 'Missing compensation',   desc: 'No active CTC record for employee' },
          { code: 'BANK_MISSING',  label: 'Missing bank account',   desc: 'No valid bank details on file' },
          { code: 'ATTEND_MISSING',label: 'Attendance incomplete',  desc: 'No attendance data for the period' },
          { code: 'NET_INVALID',   label: 'Invalid net pay',        desc: 'Net pay is zero or negative' },
        ].map(r => (
          <div key={r.code} className="p-3 rounded-md border border-border bg-muted/30 space-y-0.5">
            <p className="text-[10px] font-mono text-muted-foreground">{r.code}</p>
            <p className="text-xs font-medium text-foreground">{r.label}</p>
            <p className="text-[10px] text-muted-foreground/70">{r.desc}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/50">These rules and 7 others are seeded automatically via migration.</p>
    </div>
  )

  // Derived counters
  const enabledCount   = rules.filter(r => r.enabled).length
  const criticalCount  = rules.filter(r => r.severity === 'critical' && r.enabled).length
  const warningCount   = rules.filter(r => r.severity === 'warning'  && r.enabled).length
  const infoCount      = rules.filter(r => r.severity === 'info'     && r.enabled).length
  const blockingCount  = rules.filter(r => r.blocking && r.enabled).length

  // Available stages for filter
  const stages = Array.from(new Set(rules.map(r => r.stage).filter(Boolean))) as string[]

  const filtered = rules.filter(r => {
    const q           = ruleSearch.toLowerCase()
    const matchSearch = !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
    const matchSev    = severityFilter === 'all' || r.severity === severityFilter
    const matchStage  = stageFilter   === 'all' || r.stage === stageFilter
    return matchSearch && matchSev && matchStage
  })

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{enabledCount}</span> of {rules.length} rules enabled
        </span>
        <span className="text-muted-foreground/40">·</span>
        {criticalCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <XCircle className="h-3 w-3" />{criticalCount} critical
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />{warningCount} warning
          </span>
        )}
        {infoCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-info">
            <Info className="h-3 w-3" />{infoCount} info
          </span>
        )}
        {blockingCount > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1 text-xs text-destructive font-medium">
              <Lock className="h-3 w-3" />{blockingCount} blocking
            </span>
          </>
        )}
        {enabledCount === rules.length && (
          <span className="flex items-center gap-1 text-xs text-success ml-1">
            <CheckCircle2 className="h-3 w-3" />All rules enabled
          </span>
        )}
      </div>

      {/* Search + filters */}
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
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          {stages.length > 0 && (
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="all">All Stages</option>
              {stages.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 pb-3 font-medium">Code</th>
              <th className="px-4 pb-3 font-medium">Name</th>
              <th className="px-4 pb-3 font-medium">Severity</th>
              <th className="px-4 pb-3 font-medium">Stage</th>
              <th className="px-4 pb-3 font-medium">Blocking</th>
              <th className="px-4 pb-3 font-medium">Enabled</th>
              <th className="px-4 pb-3 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No rules match your filter.
                </td>
              </tr>
            ) : filtered.map(rule => (
              <tr
                key={rule.id}
                className={cn(
                  'border-b border-border transition-colors',
                  !rule.enabled ? 'opacity-50' : 'hover:bg-muted/40',
                )}
              >
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{rule.code}</td>
                <td className="px-4 py-3 font-medium text-foreground">{rule.name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <SeverityIcon severity={rule.severity} />
                    <SeverityBadge severity={rule.severity} />
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                  {rule.stage ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {rule.blocking ? (
                    <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                      <Lock className="h-3 w-3" /> Yes
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => {
                      if (!isSuperAdmin) {
                        toast.error('Only super admins can toggle rules')
                        return
                      }
                      toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })
                    }}
                    disabled={toggleMutation.isPending}
                    className="focus:outline-none"
                    title={
                      !isSuperAdmin
                        ? 'Super admin only'
                        : rule.enabled ? 'Disable rule' : 'Enable rule'
                    }
                  >
                    {rule.enabled
                      ? <ToggleRight className="h-5 w-5 text-success" />
                      : <ToggleLeft  className="h-5 w-5 text-muted-foreground" />}
                  </button>
                </td>
                <td className="px-4 py-3 text-muted-foreground max-w-[300px]">
                  <p className="truncate" title={rule.description ?? undefined}>
                    {rule.description ?? '—'}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isSuperAdmin && (
        <p className="text-xs text-muted-foreground text-right px-1">
          Rule toggles are restricted to super admins.
        </p>
      )}
    </div>
  )
}

// ── Run History Tab ───────────────────────────────────────────────────────────

function RunHistoryTab() {
  const navigate             = useNavigate()
  const [runDialogOpen, setRunDialogOpen] = useState(false)

  const { data: runs = [], isLoading } = useQuery<PayrollRun[]>({
    queryKey: ['payroll-runs-history'],
    queryFn:  () => api.get<{ data?: PayrollRun[] }>('/payroll/runs').then(r => r.data ?? []),
  })

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setRunDialogOpen(true)} className="gap-2">
          <Play className="h-4 w-4" /> Run Payroll
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading history…
        </div>
      ) : !runs?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No payroll runs found. Use the button above to start the first run.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 pb-3 font-medium">Month</th>
                <th className="px-4 pb-3 font-medium">Status</th>
                <th className="px-4 pb-3 font-medium">Started</th>
                <th className="px-4 pb-3 font-medium text-right">Employees</th>
                <th className="px-4 pb-3 font-medium text-right">Gross</th>
                <th className="px-4 pb-3 font-medium text-right">Net</th>
                <th className="px-4 pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-foreground">{run.month}</td>
                  <td className="px-4 py-3"><RunStatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(run.created_at)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{run.employee_count}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {run.total_gross > 0 ? fmtCurrency(run.total_gross) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground font-medium">
                    {run.total_net > 0 ? fmtCurrency(run.total_net) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {(run.status === 'failed' || run.status === 'partial_failed') ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() => navigate(`/admin/payroll/blockers/${run.id}`)}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Review Blockers
                          {run.failure_summary?.total_failed != null && (
                            <span className="ml-0.5 rounded-full bg-white/20 px-1 text-[9px] font-bold">
                              {run.failure_summary.total_failed}
                            </span>
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs text-muted-foreground"
                          onClick={() => navigate(`/admin/payroll`)}
                        >
                          <Eye className="h-3.5 w-3.5" /> View Slips
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RunValidationDialog open={runDialogOpen} onOpenChange={setRunDialogOpen} />
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
      <SubTabs<typeof activeTab>
        tabs={[
          { id: 'rules',   label: 'Validation Rules' },
          { id: 'history', label: 'Run History'      },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      <SectionCard>
        {activeTab === 'rules'   && <ValidationRulesTab />}
        {activeTab === 'history' && <RunHistoryTab />}
      </SectionCard>
    </PageContainer>
  )
}
