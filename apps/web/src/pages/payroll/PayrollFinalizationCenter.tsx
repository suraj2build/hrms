/**
 * PayrollFinalizationCenter — /admin/payroll/finalize
 *
 * Finalization workspace: review totals, verify checklist, finalize run,
 * freeze month, rollback draft, export bank advice.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }                       from 'react'
import { useNavigate, Link }                       from 'react-router-dom'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Lock, Unlock, CheckCircle2, XCircle, AlertTriangle, Download,
  DollarSign, Users, TrendingDown, FileText,
  ShieldAlert, ChevronDown, ChevronRight, ArrowLeft,
  RotateCcw, Banknote, BadgeCheck, Scale,
  AlertCircle, Loader2,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import { toast }          from 'sonner'
import {
  StatCountChip,
  StatutoryValidationStrip,
  TooltipProvider,
  type StatutoryValidationItem,
} from '@/components/payroll/StatutoryBadges'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayrollRun {
  id:               string
  month:            string
  status:           'draft' | 'partial_failed' | 'processing' | 'finalized' | 'failed'
  employee_count:   number
  total_gross:      number
  total_deductions: number
  total_net:        number
  total_lop_amount: number
  error_message:    string | null
  failure_summary:  { total_failed: number; total_employees: number } | null
  created_at:       string
  finalized_at:     string | null
}

interface Blocker {
  id:       string
  status:   'open' | 'resolved'
  severity: string
  rule_code: string
  message:  string
  employee_name?: string
}

interface VarianceRow {
  employee_id:    string
  employee_name:  string
  employee_code:  string
  current_net:    number
  prev_net:       number
  delta_amount:   number
  delta_pct:      number
  flagged:        boolean
  reason:         string | null
}

interface SlipSummary {
  slip_id:       string
  employee_id:   string
  employee_name: string
  net_pay:       number
  gross_pay:     number
  status:        string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}
function fmtDate(s: string) {
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}
function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    draft:          { cls: 'bg-muted text-foreground',                     label: 'Draft' },
    partial_failed: { cls: 'bg-warning/20 text-warning border-warning/40', label: 'Partial' },
    processing:     { cls: 'bg-info/20 text-info border-info/40',          label: 'Processing' },
    finalized:      { cls: 'bg-success/20 text-success border-success/40', label: 'Finalized' },
    failed:         { cls: 'bg-destructive/20 text-destructive',           label: 'Failed' },
  }
  const c = map[status] ?? { cls: 'bg-muted', label: status }
  return <Badge variant="outline" className={cn('rounded-full text-[10px] capitalize', c.cls)}>{c.label}</Badge>
}

// ── Checklist ─────────────────────────────────────────────────────────────────

interface ChecklistItem {
  key:     string
  label:   string
  detail:  string
  pass:    boolean
  blocker: boolean
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3 rounded-lg border',
      item.pass ? 'bg-success/5 border-success/20' : item.blocker ? 'bg-destructive/5 border-destructive/20' : 'bg-warning/5 border-warning/20',
    )}>
      {item.pass
        ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
        : item.blocker
          ? <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          : <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{item.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollFinalizationCenter() {
  const navigate    = useNavigate()
  const queryClient  = useQueryClient()
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const isSuperAdmin = profile?.role === 'super_admin'

  // Guard: this page must never render for non-admin roles
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <ShieldAlert className="h-10 w-10 text-destructive/40" />
        <p className="text-sm text-muted-foreground font-medium">Access restricted to HR administrators.</p>
      </div>
    )
  }

  const [finalizeOpen,  setFinalizeOpen]  = useState(false)
  const [rollbackOpen,  setRollbackOpen]  = useState(false)
  const [freezeOpen,    setFreezeOpen]    = useState(false)
  const [unfreezeOpen,  setUnfreezeOpen]  = useState(false)
  const [rollbackReason, setRollbackReason] = useState('')
  const [freezeReason,   setFreezeReason]   = useState('')
  const [unfreezeReason, setUnfreezeReason] = useState('')
  const [forceFinalize,  setForceFinalize]  = useState(false)
  const [forceReason,    setForceReason]    = useState('')
  const [expandedVariance, setExpandedVariance] = useState(false)

  // Latest run
  const { data: runsRaw, isLoading: runsLoading } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-finalize'],
    queryFn:  () => api.get('/payroll/runs?limit=1'),
    staleTime: 30_000,
  })
  const run = runsRaw?.data?.[0] ?? null

  // Blockers for current run
  const { data: blockersRaw } = useQuery<{ data: Blocker[] }>({
    queryKey: ['payroll-blockers-finalize', run?.id],
    queryFn:  () => api.get(`/payroll/runs/${run!.id}/blockers`),
    enabled:  !!run?.id,
    staleTime: 15_000,
  })
  const openBlockers = (blockersRaw?.data ?? []).filter(b => b.status === 'open')

  // Variance for current run
  const { data: varianceRaw } = useQuery<{ data: VarianceRow[] }>({
    queryKey: ['payroll-variance-finalize', run?.id],
    queryFn:  () => api.get(`/payroll/runs/${run!.id}/variance`),
    enabled:  !!run?.id && run.status !== 'draft',
    staleTime: 60_000,
  })
  const varianceRows = varianceRaw?.data ?? []
  const flaggedVariance = varianceRows.filter(v => v.flagged)

  // Slips summary
  const { data: slipsRaw } = useQuery<{ data: SlipSummary[] }>({
    queryKey: ['payroll-slips-finalize', run?.id],
    queryFn:  () => api.get(`/payroll/runs/${run!.id}/slips`),
    enabled:  !!run?.id,
    staleTime: 60_000,
  })
  const slips       = slipsRaw?.data ?? []
  const heldSlips   = slips.filter(s => s.status === 'held')
  const zeroNetSlips = slips.filter(s => s.net_pay <= 0)

  // Freeze log
  const { data: freezeLogRaw } = useQuery<{ data: any[] }>({
    queryKey: ['freeze-log'],
    queryFn:  () => api.get('/payroll/freeze-log'),
    staleTime: 60_000,
  })
  const latestFreeze = freezeLogRaw?.data?.[0]
  const isFrozen     = latestFreeze?.action === 'freeze' && latestFreeze?.freeze_month === run?.month

  // ── Statutory intel — EPF & ESI operational counters ──────────────────────
  // Loaded lazily once we have a run; used in the statutory intel strip.
  const { data: epfContribRaw } = useQuery<{ data: any[] }>({
    queryKey: ['epf-contrib-finalize', run?.month],
    queryFn:  () => api.get(`/payroll/statutory/epf/contributions?month=${run!.month}`),
    enabled:  !!run?.month,
    staleTime: 120_000,
  })
  const { data: esiEligRaw } = useQuery<{ data: any[] }>({
    queryKey: ['esi-elig-finalize', run?.month],
    queryFn:  () => api.get('/payroll/statutory/esi/eligibility?active_only=true'),
    enabled:  !!run?.month,
    staleTime: 120_000,
  })

  const epfContribs = epfContribRaw?.data ?? []
  const esiEligRows = esiEligRaw?.data ?? []

  const pfCappedCount   = epfContribs.filter((r: any) => r.is_capped === true).length
  const pfActualCount   = epfContribs.filter((r: any) => r.is_capped === false).length

  // ESI continuation: rows where continuation_until is set and >= today
  const today = new Date().toISOString().slice(0, 10)
  const esiContinuationCount = esiEligRows.filter(
    (r: any) => r.continuation_until && r.continuation_until >= today,
  ).length

  const hasStatutoryIntel = epfContribs.length > 0 || esiEligRows.length > 0

  // Statutory validation strip items — shown before finalize
  const statutoryValidation: StatutoryValidationItem[] = run ? [
    {
      key:     'epf_computed',
      pass:    epfContribs.length > 0 || !run,
      message: 'EPF contributions not yet computed for this month — run EPF compute first.',
    },
    {
      key:     'esi_continuation',
      pass:    esiContinuationCount === 0,
      message: `${esiContinuationCount} employee${esiContinuationCount !== 1 ? 's' : ''} on ESI continuation — wages exceed threshold but contributions enforced through period end.`,
    },
  ].filter(i => !i.pass || i.key === 'epf_computed') : []

  // Clickable chip: expanded employee list
  const [expandedChip, setExpandedChip] = useState<'capped' | 'actual' | 'continuation' | null>(null)

  const cappedEmployees    = epfContribs.filter((r: any) => r.is_capped === true)
  const actualEmployees    = epfContribs.filter((r: any) => r.is_capped === false)
  const continuationEmps   = esiEligRows.filter(
    (r: any) => r.continuation_until && r.continuation_until >= today,
  )

  // ── Checklist computation ──────────────────────────────────────────────────
  const checklist = useMemo<ChecklistItem[]>(() => {
    if (!run) return []
    const failedCount = run.failure_summary?.total_failed ?? 0
    return [
      {
        key: 'run_status', label: 'Run not in failed state',
        detail: run.status === 'failed' ? 'Run failed — must re-run payroll' : `Run status: ${run.status}`,
        pass: run.status !== 'failed', blocker: true,
      },
      {
        key: 'no_blockers', label: 'No open blockers',
        detail: openBlockers.length > 0 ? `${openBlockers.length} unresolved blocker(s)` : 'All blockers resolved',
        pass: openBlockers.length === 0, blocker: true,
      },
      {
        key: 'no_failures', label: 'No failed employees',
        detail: failedCount > 0 ? `${failedCount} employee(s) failed computation` : 'All employees computed successfully',
        pass: failedCount === 0, blocker: false,
      },
      {
        key: 'variance', label: 'Variance anomalies reviewed',
        detail: flaggedVariance.length > 0 ? `${flaggedVariance.length} flagged variance(s) — verify before finalizing` : 'No anomalies detected',
        pass: flaggedVariance.length === 0, blocker: false,
      },
      {
        key: 'zero_net', label: 'No zero-net employees',
        detail: zeroNetSlips.length > 0 ? `${zeroNetSlips.length} employee(s) with ₹0 or negative net pay` : 'All net pays positive',
        pass: zeroNetSlips.length === 0, blocker: false,
      },
      {
        key: 'held', label: 'No held salary slips',
        detail: heldSlips.length > 0 ? `${heldSlips.length} slip(s) on hold` : 'No holds',
        pass: heldSlips.length === 0, blocker: false,
      },
    ]
  }, [run, openBlockers, flaggedVariance, zeroNetSlips, heldSlips])

  const hardBlockers  = checklist.filter(c => !c.pass && c.blocker)
  const canFinalize   = run && run.status !== 'finalized' && run.status !== 'failed' && run.status !== 'processing'
  const canRollback   = run && (run.status === 'draft' || run.status === 'partial_failed' || (run.status === 'finalized' && isSuperAdmin))

  // ── Mutations ──────────────────────────────────────────────────────────────
  const finalizeMutation = useMutation({
    mutationFn: () => api.post(`/payroll/runs/${run!.id}/finalize`, {
      force_finalize: forceFinalize,
      override_reason: forceFinalize ? forceReason : undefined,
    }),
    onSuccess: () => {
      toast.success('Payroll finalized successfully')
      setFinalizeOpen(false)
      queryClient.invalidateQueries({ queryKey: ['payroll-runs-finalize'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Finalization failed'),
  })

  const rollbackMutation = useMutation({
    mutationFn: () => api.post(`/payroll/runs/${run!.id}/rollback`, { reason: rollbackReason }),
    onSuccess: () => {
      toast.success('Run rolled back to draft')
      setRollbackOpen(false)
      setRollbackReason('')
      queryClient.invalidateQueries({ queryKey: ['payroll-runs-finalize'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Rollback failed'),
  })

  const freezeMutation = useMutation({
    mutationFn: () => api.post('/payroll/freeze-month', { month: run!.month, reason: freezeReason }),
    onSuccess: () => {
      toast.success(`${run!.month} frozen`)
      setFreezeOpen(false)
      setFreezeReason('')
      queryClient.invalidateQueries({ queryKey: ['freeze-log'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Freeze failed'),
  })

  const unfreezeMutation = useMutation({
    mutationFn: () => api.post('/payroll/unfreeze-month', { month: run!.month, reason: unfreezeReason }),
    onSuccess: () => {
      toast.success(`${run!.month} unfrozen`)
      setUnfreezeOpen(false)
      setUnfreezeReason('')
      queryClient.invalidateQueries({ queryKey: ['freeze-log'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Unfreeze failed'),
  })

  const exportMutation = useMutation({
    mutationFn: () => api.get(`/payroll/runs/${run!.id}/export`),
    onSuccess: (data: any) => {
      // Build CSV from export data
      const rows: string[][] = [['Employee Code', 'Employee Name', 'Account (Masked)', 'IFSC', 'Net Pay']]
      for (const s of (data?.data ?? [])) {
        rows.push([s.employee_code ?? '', s.employee_name ?? '', s.account_number_masked ?? '', s.ifsc_code ?? '', String(s.net_pay ?? 0)])
      }
      const csv = rows.map(r => r.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `bank-advice-${run!.month}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Bank advice exported')
    },
    onError: () => toast.error('Export failed'),
  })

  if (runsLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    )
  }

  if (!run) {
    return (
      <PageContainer>
        <PageHeader
          title="Payroll Finalization"
          subtitle="No payroll run found. Run payroll first."
        />
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No payroll runs exist for this tenant.</p>
          <Button size="sm" onClick={() => navigate('/admin/payroll')}>Go to Payroll Runs</Button>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Finalization"
        subtitle={`${fmtMonth(run.month)} · Finalize, freeze, and export payroll`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate('/admin/payroll')}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />Runs
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              <Download className="h-3.5 w-3.5 mr-1" />Export Bank Advice
            </Button>
            {!isFrozen && run.status === 'finalized' && (
              <Button size="sm" variant="outline" onClick={() => setFreezeOpen(true)}>
                <Lock className="h-3.5 w-3.5 mr-1" />Freeze Month
              </Button>
            )}
            {isFrozen && isSuperAdmin && (
              <Button size="sm" variant="outline" className="text-warning border-warning/50" onClick={() => setUnfreezeOpen(true)}>
                <Unlock className="h-3.5 w-3.5 mr-1" />Unfreeze
              </Button>
            )}
            {canRollback && (
              <Button size="sm" variant="outline" className="text-destructive border-destructive/50" onClick={() => setRollbackOpen(true)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />Rollback
              </Button>
            )}
            {canFinalize && run.status !== 'finalized' && (
              <Button
                size="sm"
                className={cn(hardBlockers.length > 0 ? 'opacity-70' : '')}
                onClick={() => setFinalizeOpen(true)}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Finalize Payroll
              </Button>
            )}
          </div>
        }
      />

      {/* Freeze Banner */}
      {isFrozen && (
        <div className="mb-4 flex items-center gap-2.5 px-4 py-3 rounded-lg border border-info/40 bg-info/5">
          <Lock className="h-4 w-4 text-info flex-shrink-0" />
          <span className="text-sm font-medium text-info">
            {fmtMonth(run.month)} is frozen — no edits, re-runs, or slip regenerations permitted.
            {isSuperAdmin && ' Super admin override available.'}
          </span>
        </div>
      )}

      {/* Run Header KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Employees', value: run.employee_count ?? 0, icon: <Users className="h-4 w-4" />, color: 'text-foreground' },
          { label: 'Gross Payout', value: fmtCurrency(run.total_gross ?? 0), icon: <DollarSign className="h-4 w-4" />, color: 'text-foreground' },
          { label: 'Total Deductions', value: fmtCurrency(run.total_deductions ?? 0), icon: <TrendingDown className="h-4 w-4" />, color: 'text-muted-foreground' },
          { label: 'Net Payout', value: fmtCurrency(run.total_net ?? 0), icon: <Banknote className="h-4 w-4" />, color: 'text-success' },
        ].map(k => (
          <div key={k.label} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">{k.icon}<span>{k.label}</span></div>
            <p className={cn('text-lg font-bold tabular-nums', k.color)}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Checklist + Variance */}
        <div className="lg:col-span-2 space-y-4">

          {/* Confirmation Checklist */}
          <SectionCard title="Finalization Checklist" icon={<BadgeCheck className="h-4 w-4" />}>
            <div className="space-y-2 p-4">
              {checklist.map(item => <ChecklistRow key={item.key} item={item} />)}
              {hardBlockers.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium">
                  {hardBlockers.length} blocker(s) must be resolved before finalization.
                  <Link to={`/admin/payroll/blockers/${run.id}`} className="ml-1 underline">Resolve now →</Link>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Variance Warnings */}
          {flaggedVariance.length > 0 && (
            <SectionCard
              title={`Variance Warnings (${flaggedVariance.length})`}
              icon={<AlertTriangle className="h-4 w-4 text-warning" />}
            >
              <div className="p-4 space-y-1">
                <button
                  className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 hover:text-foreground"
                  onClick={() => setExpandedVariance(v => !v)}
                >
                  {expandedVariance ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {expandedVariance ? 'Hide' : 'Show'} flagged employees
                </button>
                {expandedVariance && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          {['Employee', 'Prev Net', 'Current Net', 'Δ Amount', 'Δ %', 'Reason'].map(h => (
                            <th key={h} className="text-left px-2 py-1.5 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {flaggedVariance.map(v => (
                          <tr key={v.employee_id} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-2 py-2 font-medium">{v.employee_name}</td>
                            <td className="px-2 py-2 tabular-nums">{fmtCurrency(v.prev_net)}</td>
                            <td className="px-2 py-2 tabular-nums">{fmtCurrency(v.current_net)}</td>
                            <td className={cn('px-2 py-2 tabular-nums font-medium', v.delta_amount >= 0 ? 'text-success' : 'text-destructive')}>
                              {v.delta_amount >= 0 ? '+' : ''}{fmtCurrency(v.delta_amount)}
                            </td>
                            <td className={cn('px-2 py-2 tabular-nums', Math.abs(v.delta_pct) > 20 ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                              {v.delta_pct >= 0 ? '+' : ''}{v.delta_pct.toFixed(1)}%
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">{v.reason ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Blocked / zero-net slips */}
          {(heldSlips.length > 0 || zeroNetSlips.length > 0) && (
            <SectionCard title="Attention Required" icon={<AlertCircle className="h-4 w-4 text-warning" />}>
              <div className="p-4 space-y-2 text-xs">
                {heldSlips.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-md bg-warning/5 border border-warning/20">
                    <span className="font-medium text-warning">{heldSlips.length} slip(s) on hold</span>
                    <Badge variant="outline" className="text-warning border-warning/40">Held</Badge>
                  </div>
                )}
                {zeroNetSlips.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20">
                    <span className="font-medium text-destructive">{zeroNetSlips.length} employee(s) with ₹0 net pay</span>
                    <Badge variant="outline" className="text-destructive border-destructive/30">Zero Net</Badge>
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>

        {/* Right: Run Status + Actions */}
        <div className="space-y-4">
          <SectionCard title="Run Summary" icon={<Scale className="h-4 w-4" />}>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Status</span>
                <StatusBadge status={run.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Month</span>
                <span className="text-sm font-medium">{fmtMonth(run.month)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Created</span>
                <span className="text-xs">{fmtDate(run.created_at)}</span>
              </div>
              {run.finalized_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Finalized</span>
                  <span className="text-xs">{fmtDate(run.finalized_at)}</span>
                </div>
              )}
              {run.failure_summary && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Failed</span>
                  <span className="text-xs text-destructive font-medium">
                    {run.failure_summary.total_failed}/{run.failure_summary.total_employees}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">LOP Total</span>
                <span className="text-xs tabular-nums">{fmtCurrency(run.total_lop_amount ?? 0)}</span>
              </div>
              {isFrozen && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Lock className="h-3.5 w-3.5 text-info" />
                  <span className="text-xs text-info font-medium">Month frozen</span>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Statutory Intel — operational counters (click to expand) */}
          {hasStatutoryIntel && (
            <TooltipProvider>
            <SectionCard title="Statutory Intel" icon={<Scale className="h-4 w-4 text-muted-foreground" />}>
              <div className="p-4 space-y-3">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                  {run.month} · EPF & ESI snapshot
                </p>

                {/* Counter chips — click to reveal employee list */}
                <div className="grid grid-cols-2 gap-2">
                  {pfCappedCount > 0 && (
                    <StatCountChip
                      label="Capped PF"
                      count={pfCappedCount}
                      variant="default"
                      onClick={() => setExpandedChip(expandedChip === 'capped' ? null : 'capped')}
                    />
                  )}
                  {pfActualCount > 0 && (
                    <StatCountChip
                      label="Actual PF"
                      count={pfActualCount}
                      variant="blue"
                      onClick={() => setExpandedChip(expandedChip === 'actual' ? null : 'actual')}
                    />
                  )}
                  {esiContinuationCount > 0 && (
                    <StatCountChip
                      label="ESI Continuation"
                      count={esiContinuationCount}
                      variant="amber"
                      onClick={() => setExpandedChip(expandedChip === 'continuation' ? null : 'continuation')}
                    />
                  )}
                  {epfContribs.length > 0 && (
                    <StatCountChip
                      label="EPF Computed"
                      count={epfContribs.length}
                      variant="muted"
                    />
                  )}
                </div>

                {/* Expanded employee list — inline, no new page */}
                {expandedChip && (() => {
                  const rows =
                    expandedChip === 'capped'       ? cappedEmployees  :
                    expandedChip === 'actual'        ? actualEmployees  :
                    continuationEmps
                  const emptyMsg =
                    expandedChip === 'continuation'
                      ? 'No active continuation employees found.'
                      : 'No employees in this group.'
                  return (
                    <div className="rounded-md border border-border bg-background overflow-hidden">
                      <div className="px-2.5 py-1.5 border-b border-border bg-muted/30 flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {expandedChip === 'capped' ? 'Capped PF Employees' :
                           expandedChip === 'actual'  ? 'Actual PF Employees' :
                           'ESI Continuation Employees'}
                        </span>
                        <button
                          onClick={() => setExpandedChip(null)}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Close ×
                        </button>
                      </div>
                      {rows.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">{emptyMsg}</p>
                      ) : (
                        <div className="max-h-40 overflow-y-auto">
                          {rows.map((r: any, i: number) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 last:border-0">
                              <span className="text-xs font-medium">
                                {r.employees
                                  ? `${r.employees.first_name} ${r.employees.last_name}`
                                  : r.employee_name ?? r.employee_id?.slice(0, 8) ?? '—'}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {r.employees?.employee_code ?? r.employee_code ?? ''}
                                {expandedChip === 'continuation' && r.continuation_until && (
                                  <> · until {r.continuation_until}</>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Statutory validation strip */}
                {statutoryValidation.length > 0 && (
                  <StatutoryValidationStrip items={statutoryValidation} />
                )}
                {statutoryValidation.length === 0 && epfContribs.length > 0 && (
                  <StatutoryValidationStrip
                    items={[{ key: 'all_ok', pass: true, message: 'All statutory calculations validated.' }]}
                  />
                )}
              </div>
            </SectionCard>
            </TooltipProvider>
          )}

          <SectionCard title="Quick Actions" icon={<ShieldAlert className="h-4 w-4" />}>
            <div className="p-4 space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs"
                onClick={() => navigate(`/admin/payroll/blockers/${run.id}`)}>
                <ShieldAlert className="h-3.5 w-3.5 text-destructive" />Resolve Blockers ({openBlockers.length})
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs"
                onClick={() => navigate('/admin/payroll/validation')}>
                <BadgeCheck className="h-3.5 w-3.5 text-info" />Validation Center
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs"
                onClick={() => navigate('/admin/payroll/reconciliation')}>
                <Scale className="h-3.5 w-3.5" />Reconciliation
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs"
                onClick={() => navigate('/admin/payroll/forensics')}>
                <FileText className="h-3.5 w-3.5" />Audit Forensics
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Finalize Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize Payroll — {fmtMonth(run.month)}</DialogTitle>
            <DialogDescription>
              This will lock all salary slips and mark the run as finalized. Employees will be able to view their payslips.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {hardBlockers.length > 0 && !forceFinalize && (
              <div className="px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                {hardBlockers.length} hard blocker(s) detected. Enable force-finalize to proceed.
              </div>
            )}
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={forceFinalize} onChange={e => setForceFinalize(e.target.checked)} />
              <span className="text-sm">Force finalize (override attendance/blocker gates)</span>
            </label>
            {forceFinalize && (
              <Input placeholder="Override reason (required)" value={forceReason} onChange={e => setForceReason(e.target.value)} className="text-sm h-8" />
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setFinalizeOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={finalizeMutation.isPending || (forceFinalize && !forceReason.trim())}
                onClick={() => finalizeMutation.mutate()}>
                {finalizeMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Finalizing…</> : 'Confirm Finalize'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rollback Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Rollback Payroll Run</DialogTitle>
            <DialogDescription>
              This will delete all computed slips and reset the run to draft.
              {run.status === 'finalized' && ' Rolling back a finalized run requires super_admin. All visibility will be revoked.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Reason for rollback (optional)" value={rollbackReason}
              onChange={e => setRollbackReason(e.target.value)} className="text-sm h-8" />
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setRollbackOpen(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" disabled={rollbackMutation.isPending}
                onClick={() => rollbackMutation.mutate()}>
                {rollbackMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Rolling back…</> : 'Confirm Rollback'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Freeze Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={freezeOpen} onOpenChange={setFreezeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Freeze {fmtMonth(run.month)}</DialogTitle>
            <DialogDescription>
              Freezing prevents attendance edits, compensation changes, re-runs, and slip regenerations for this month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Reason for freeze (required)" value={freezeReason}
              onChange={e => setFreezeReason(e.target.value)} className="text-sm h-8" />
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setFreezeOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={freezeMutation.isPending || !freezeReason.trim()}
                onClick={() => freezeMutation.mutate()}>
                {freezeMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Freezing…</> : 'Freeze Month'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Unfreeze Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={unfreezeOpen} onOpenChange={setUnfreezeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-warning">Unfreeze {fmtMonth(run?.month ?? '')}</DialogTitle>
            <DialogDescription>
              Super admin override. Unfreezing allows edits and re-runs. All changes will be audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Override reason (required)" value={unfreezeReason}
              onChange={e => setUnfreezeReason(e.target.value)} className="text-sm h-8" />
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setUnfreezeOpen(false)}>Cancel</Button>
              <Button variant="outline" size="sm" className="border-warning text-warning" disabled={unfreezeMutation.isPending || !unfreezeReason.trim()}
                onClick={() => unfreezeMutation.mutate()}>
                {unfreezeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Unlock className="h-3.5 w-3.5 mr-1" />}
                Unfreeze Month
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
