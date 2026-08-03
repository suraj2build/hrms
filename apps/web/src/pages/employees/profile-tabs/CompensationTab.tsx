/**
 * EmployeeProfile › Compensation tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { AlertTriangle, Banknote, DollarSign, Edit2, History, Info, Loader2, Plus, Trash2, TrendingUp, X } from 'lucide-react'
import {
  EmptySection, Grid2, KV, fmtDate, fmtMoney,
  type FullProfile, type RevisionRow, type CompComponentRow, type CompHistoryRow, type BadgeVariant, type Section,
} from './shared'

// ── Compensation Revision Drawer ──────────────────────────────────────────────

interface CompensationRevisionDrawerProps {
  revision:   RevisionRow | null
  currentCTC: number
  onClose:    () => void
  isAdmin:    boolean
  onApprove:  (id: string) => void
  onReject:   (id: string) => void
}

function CompensationRevisionDrawer({
  revision, currentCTC, onClose, isAdmin, onApprove, onReject,
}: CompensationRevisionDrawerProps) {
  if (!revision) return null

  const oldAnnual  = revision.before_ctc_annual ?? currentCTC
  const newAnnual  = revision.new_ctc_annual     ?? 0
  const delta      = newAnnual - oldAnnual
  const deltaMonthly = delta / 12
  const pct        = oldAnnual > 0 ? ((delta / oldAnnual) * 100).toFixed(1) : '0.0'
  const isUp       = delta >= 0

  const oldMonthly = oldAnnual / 12
  const newMonthly = newAnnual / 12
  const pfDelta    = Math.min(newMonthly, 15000) * 0.12 - Math.min(oldMonthly, 15000) * 0.12
  const esiEligible = newMonthly <= 21000

  const effectiveDateObj = revision.effective_date
    ? new Date(`${revision.effective_date.slice(0, 10)}T00:00:00`)
    : null
  const effectiveMonth = (() => {
    if (!effectiveDateObj) return '—'
    const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (isNaN(effectiveDateObj.getTime())) return '—'
    return `${_M[effectiveDateObj.getMonth()]}-${effectiveDateObj.getFullYear()}`
  })()

  const narrative = (() => {
    const pctNum = Math.abs(Number(pct))
    const dir    = isUp ? 'increase' : 'decrease'
    const pfNote = Math.abs(pfDelta) < 1 ? '' : ` PF employer contribution changes by ${fmtMoney(Math.abs(pfDelta))}/mo.`
    const esiNote = esiEligible ? ' ESI applicable at new CTC.' : ' ESI not applicable at new CTC.'
    return `${pctNum.toFixed(1)}% ${dir} from previous CTC. No compliance risk detected.${pfNote}${esiNote} Effective from ${effectiveMonth}.`
  })()

  const statusVariant =
    revision.status === 'approved' ? 'success' :
    revision.status === 'rejected' ? 'destructive' :
    revision.status === 'pending'  ? 'warning' : 'secondary'

  return (
    <Sheet open={!!revision} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent size="sm">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Revision Detail
          </SheetTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="rounded-full text-[10px] capitalize">
              {revision.revision_type ?? '—'}
            </Badge>
            <Badge variant={statusVariant as BadgeVariant} className="rounded-full text-[10px] capitalize">
              {revision.status ?? '—'}
            </Badge>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-4">

          {/* 1. What Changed */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">What Changed</p>
            <div className="flex items-center gap-2 text-sm">
              {revision.before_ctc_annual && (
                <>
                  <span className="tabular-nums text-muted-foreground">{fmtMoney(revision.before_ctc_annual)}</span>
                  <span className="text-muted-foreground">→</span>
                </>
              )}
              <span className="font-semibold tabular-nums">{fmtMoney(newAnnual)}</span>
              <span className={cn('text-xs font-semibold', isUp ? 'text-success' : 'text-destructive')}>
                {isUp ? '+' : ''}{pct}%
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Effective: <span className="font-medium text-foreground">{fmtDate(revision.effective_date)}</span>
            </p>
          </div>

          {/* 2. Financial Impact */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Financial Impact</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/30 p-2 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">Monthly Change</p>
                <p className={cn('text-sm font-bold tabular-nums', isUp ? 'text-success' : 'text-destructive')}>
                  {isUp ? '+' : ''}{fmtMoney(deltaMonthly)}/mo
                </p>
              </div>
              <div className="rounded-md bg-muted/30 p-2 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">Annual Change</p>
                <p className={cn('text-sm font-bold tabular-nums', isUp ? 'text-success' : 'text-destructive')}>
                  {isUp ? '+' : ''}{fmtMoney(delta)}/yr
                </p>
              </div>
            </div>
          </div>

          {/* 3. Payroll Impact */}
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Payroll Impact</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">PF Employer Delta</span>
                <span className={cn('font-medium tabular-nums', pfDelta >= 0 ? 'text-foreground' : 'text-destructive')}>
                  {pfDelta >= 0 ? '+' : ''}{fmtMoney(pfDelta)}/mo
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ESI Applicability</span>
                <Badge
                  variant={esiEligible ? 'success' : 'secondary'}
                  className="rounded-full text-[9px]"
                >
                  {esiEligible ? 'Eligible' : 'Not eligible'}
                </Badge>
              </div>
              {!esiEligible && (
                <p className="text-[10px] text-muted-foreground">Monthly CTC exceeds ₹21,000 limit.</p>
              )}
            </div>
          </div>

          {/* 4. Effective Cycle */}
          <div className="rounded-lg border bg-card p-3 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Effective Cycle</p>
            <p className="text-xs text-foreground">
              Effective from <span className="font-medium">{effectiveMonth}</span>. Will be included in the next payroll cycle after the effective date.
            </p>
          </div>

          {/* 5. Explainability */}
          <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Summary</p>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed">{narrative}</p>
          </div>

          {/* Reason / Notes */}
          {revision.reason && (
            <div className="text-xs space-y-0.5">
              <p className="text-muted-foreground font-semibold">Reason</p>
              <p className="text-foreground">{revision.reason}</p>
            </div>
          )}
          {revision.notes && (
            <div className="text-xs space-y-0.5">
              <p className="text-muted-foreground font-semibold">Notes</p>
              <p className="text-foreground">{revision.notes}</p>
            </div>
          )}

        </SheetBody>

        {isAdmin && revision.status === 'pending' && (
          <SheetFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => { onReject(revision.id); onClose() }}
            >
              Reject
            </Button>
            <Button
              size="sm"
              className="text-success-foreground bg-success hover:bg-success/90"
              onClick={() => { onApprove(revision.id); onClose() }}
            >
              Approve
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

interface CompensationTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
  comp: FullProfile['compensation'] | undefined
  setCdlg: (v: { msg: string; act: () => void } | null) => void
}

export function CompensationTab({ id, isAdmin, subTab, visited, comp, setCdlg }: CompensationTabProps) {
  const qc = useQueryClient()

  const { data: payrollRevisionsData, refetch: refetchRevisions } = useQuery<{ data: RevisionRow[] }>({
    queryKey: ['payroll-revisions', id],
    queryFn:  () => api.get(`/payroll/revisions?employee_id=${id}`),
    enabled:  !!id && visited.has('compensation') && isAdmin,
    staleTime: 60_000,
  })

  const { data: compensationHistoryData, refetch: refetchCompHistory } = useQuery<{ data: CompHistoryRow[] }>({
    queryKey: ['compensation-history', id],
    queryFn:  () => api.get(`/employees/${id}/compensation/history`),
    enabled:  !!id && visited.has('compensation'),
    staleTime: 60_000,
  })

  const today = new Date().toISOString().slice(0, 10)
  const [revisionOpen, setRevisionOpen]     = useState(false)
  const [rejectTarget, setRejectTarget]     = useState<string | null>(null)
  const [rejectReason, setRejectReason]     = useState('')
  const [drawerRevision, setDrawerRevision] = useState<RevisionRow | null>(null)
  const [revisionForm, setRevisionForm] = useState({
    revision_type:    'increment',
    effective_date:   today,
    reason:           '',
    new_ctc_annual:   '',
    notes:            '',
  })

  // Sent as Idempotency-Key on submit, mirroring PayrollRuns.tsx's pattern.
  // Rotated only after a successful submit, so a failed-then-retried click
  // (or network retry) reuses the same key instead of creating a duplicate
  // pending revision.
  const revisionIdempotencyKey = useRef(crypto.randomUUID())

  const pendingRevisions = (payrollRevisionsData?.data ?? []).filter(
    (r: RevisionRow) => !['approved', 'rejected', 'withdrawn'].includes(r.status ?? '')
  )

  const initiateRevisionMutation = useMutation({
    mutationFn: () => api.post('/payroll/revisions', {
      employee_id:       id,
      revision_type:     revisionForm.revision_type,
      effective_date:    revisionForm.effective_date,
      reason:            revisionForm.reason,
      new_ctc_annual:    Number(revisionForm.new_ctc_annual),
      before_ctc_annual: comp?.ctc_annual ?? undefined,
      notes:             revisionForm.notes || undefined,
    }, { headers: { 'Idempotency-Key': revisionIdempotencyKey.current } }),
    onSuccess: () => {
      toast.success('Revision initiated — pending approval')
      setRevisionOpen(false)
      setRevisionForm({ revision_type: 'increment', effective_date: today, reason: '', new_ctc_annual: '', notes: '' })
      revisionIdempotencyKey.current = crypto.randomUUID()
      refetchRevisions()
      // Same compensation_revisions row is also read by the admin Comp
      // Revisions queue and the manager compensation view under separate keys.
      qc.invalidateQueries({ queryKey: ['comp-revisions'] })
      qc.invalidateQueries({ queryKey: ['manager-team-comp'] })
      qc.invalidateQueries({ queryKey: ['manager-comp-history'] })
      qc.invalidateQueries({ queryKey: ['emp-compensation'] })
    },
    onError: (e: Error) => toast.error('Failed to initiate revision', { description: e.message }),
  })

  const approveRevisionMutation = useMutation({
    mutationFn: (revId: string) => api.post(`/payroll/revisions/${revId}/approve`),
    onSuccess: () => {
      toast.success('Revision approved')
      refetchRevisions()
      refetchCompHistory()
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['comp-revisions'] })
      qc.invalidateQueries({ queryKey: ['manager-team-comp'] })
      qc.invalidateQueries({ queryKey: ['manager-comp-history'] })
      qc.invalidateQueries({ queryKey: ['emp-compensation'] })
    },
    onError: (e: Error) => toast.error('Failed to approve revision', { description: e.message }),
  })

  const rejectRevisionMutation = useMutation({
    mutationFn: ({ revId, reason }: { revId: string; reason: string }) =>
      api.post(`/payroll/revisions/${revId}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      toast.success('Revision rejected')
      setRejectTarget(null)
      setRejectReason('')
      refetchRevisions()
      qc.invalidateQueries({ queryKey: ['comp-revisions'] })
      qc.invalidateQueries({ queryKey: ['manager-team-comp'] })
      qc.invalidateQueries({ queryKey: ['manager-comp-history'] })
      qc.invalidateQueries({ queryKey: ['emp-compensation'] })
    },
    onError: (e: Error) => toast.error('Failed to reject revision', { description: e.message }),
  })

  const [setupCompOpen, setSetupCompOpen] = useState(false)
  const [setupCompForm, setSetupCompForm] = useState({
    salary_structure_id: '',
    ctc_annual: '',
    effective_from: today,
    components: [{ salary_component_id: '', calculation_type: 'fixed', value: '' }] as Array<{
      salary_component_id: string; calculation_type: string; value: string
    }>,
  })
  // Set to true when user explicitly picks/changes a structure — triggers auto-load of defaults
  const pendingAutoLoadRef = useRef(false)

  const { data: salaryStructuresData } = useQuery<{ data: Array<{ id: string; name: string; code: string }> }>({
    queryKey: ['salary-structures-list'],
    queryFn:  () => api.get('/masters/salary-structures'),
    enabled:  setupCompOpen,
    staleTime: 120_000,
  })

  const { data: salaryComponentsData } = useQuery<{ data: Array<{ id: string; name: string; code: string; component_type: string }> }>({
    queryKey: ['salary-components-list'],
    queryFn:  () => api.get('/masters/salary-components'),
    enabled:  setupCompOpen,
    staleTime: 120_000,
  })

  // Auto-load structure component defaults when user picks a structure
  const { data: structureComponentsData } = useQuery<{
    data: Array<{ salary_component_id: string; calculation_type: string; default_value: number }>
  }>({
    queryKey: ['structure-components', setupCompForm.salary_structure_id],
    queryFn:  () => api.get(`/masters/salary-structures/${setupCompForm.salary_structure_id}/components`),
    enabled:  !!setupCompForm.salary_structure_id && setupCompOpen,
    staleTime: 120_000,
  })

  useEffect(() => {
    if (!pendingAutoLoadRef.current) return
    if (!structureComponentsData) return
    pendingAutoLoadRef.current = false
    const scs = structureComponentsData.data ?? []
    if (scs.length > 0) {
      setSetupCompForm(f => ({
        ...f,
        components: scs.map(c => ({
          salary_component_id: c.salary_component_id,
          calculation_type:    c.calculation_type ?? 'fixed',
          value:               String(c.default_value ?? ''),
        })),
      }))
    }
  }, [structureComponentsData])

  const deleteCompMutation = useMutation({
    mutationFn: (compId: string) => api.delete(`/employees/${id}/compensation/${compId}`),
    onSuccess: () => {
      toast.success('Compensation record deleted')
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['compensation-history', id] })
      // The manager's team view reads this same employee_compensations row
      // for ctc_annual under a separate cache key.
      qc.invalidateQueries({ queryKey: ['manager-team-comp'] })
      qc.invalidateQueries({ queryKey: ['manager-comp-history'] })
      qc.invalidateQueries({ queryKey: ['emp-compensation'] })
    },
    onError: (e: unknown) => toast.error('Delete failed', { description: e instanceof Error ? e.message : undefined }),
  })

  const setupCompMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/compensation`, {
      salary_structure_id: setupCompForm.salary_structure_id,
      ctc_annual:     Number(setupCompForm.ctc_annual),
      effective_from: setupCompForm.effective_from,
      components: setupCompForm.components
        // keep balance rows even though they carry no value (it's the residual)
        .filter(c => c.salary_component_id && (c.value || c.calculation_type === 'balance'))
        .map(c => ({
          salary_component_id: c.salary_component_id,
          calculation_type:    c.calculation_type,
          value:               c.calculation_type === 'balance' ? 0 : Number(c.value),
        })),
    }),
    onSuccess: () => {
      toast.success('Compensation configured successfully')
      setSetupCompOpen(false)
      setSetupCompForm({ salary_structure_id: '', ctc_annual: '', effective_from: today, components: [{ salary_component_id: '', calculation_type: 'fixed', value: '' }] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['compensation-history', id] })
      qc.invalidateQueries({ queryKey: ['manager-team-comp'] })
      qc.invalidateQueries({ queryKey: ['manager-comp-history'] })
      qc.invalidateQueries({ queryKey: ['emp-compensation'] })
    },
    onError: (e: Error) => toast.error('Failed to configure compensation', { description: e.message }),
  })

  return (
    <>
      {subTab === 'compensation' && (
        <div className="space-y-4">

        {/* A. Pending revision banner — admin only */}
        {isAdmin && pendingRevisions.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
              <span className="text-sm font-semibold text-warning">
                {pendingRevisions.length} pending revision{pendingRevisions.length > 1 ? 's' : ''} awaiting approval
              </span>
            </div>
            {pendingRevisions.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-background/60 rounded-lg px-3 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  <span className="capitalize font-medium">{(r.revision_type ?? '—').replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground mx-1.5">→</span>
                  <span className="font-semibold tabular-nums">{fmtMoney(r.new_ctc_annual)}</span>
                  <span className="text-muted-foreground ml-1.5">eff. {fmtDate(r.effective_date)}</span>
                  {r.reason && <span className="text-muted-foreground ml-1.5 truncate">· {r.reason}</span>}
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground"
                    onClick={() => setDrawerRevision(r)}>
                    View
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-success border-success/30 hover:bg-success/10"
                    disabled={approveRevisionMutation.isPending}
                    onClick={() => approveRevisionMutation.mutate(r.id)}
                  >
                    {approveRevisionMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => { setRejectTarget(r.id); setRejectReason('') }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* B. Compensation Snapshot card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                Compensation Snapshot
              </CardTitle>
              {isAdmin && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => {
                      pendingAutoLoadRef.current = false
                      setSetupCompForm(f => ({
                        ...f,
                        salary_structure_id: comp?.structure?.id ?? '',
                        ctc_annual:          comp?.ctc_annual ? String(comp.ctc_annual) : '',
                        effective_from:      today,
                        components:          comp?.components?.length
                          ? comp.components.map(c => ({
                              salary_component_id: c.salary_component_id ?? c.id,
                              calculation_type:    c.calculation_type ?? 'fixed',
                              value:               String(c.value),
                            }))
                          : [{ salary_component_id: '', calculation_type: 'fixed', value: '' }],
                      }))
                      setSetupCompOpen(true)
                    }}>
                    <Edit2 className="h-3.5 w-3.5" />{comp ? 'Edit' : 'Set Up'}
                  </Button>
                  {comp && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setRevisionOpen(true)}>
                      <TrendingUp className="h-3.5 w-3.5" />Initiate Revision
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!comp
              ? <EmptySection icon={DollarSign} title="No compensation configured" />
              : (
                <Grid2>
                  <KV label="Annual CTC"       value={fmtMoney(comp.ctc_annual)} />
                  <KV label="Monthly CTC"      value={fmtMoney(comp.ctc_monthly)} />
                  <KV label="Net Take-Home"    value={comp.totals ? fmtMoney(comp.totals.net_monthly) + '/mo' : undefined} />
                  <KV label="Salary Structure" value={comp.structure?.name} />
                  {comp.totals && (
                    <>
                      <KV label="Gross Monthly"  value={fmtMoney(comp.totals.gross_monthly)} />
                      <KV label="Basic Monthly"  value={fmtMoney(comp.totals.basic_monthly)} />
                    </>
                  )}
                </Grid2>
              )}

            {/* ── Full CTC structure breakup ─────────────────────────── */}
            {comp && Array.isArray(comp.components) && comp.components.length > 0 && (() => {
              const rateLabel = (c: CompComponentRow) =>
                c.calculation_type === 'balance'      ? 'Balance'
                : c.calculation_type === 'fixed'       ? 'Fixed'
                : c.calculation_type === 'pct_of_basic' ? `${c.value}% of Basic`
                : c.calculation_type === 'pct_of_ctc'   ? `${c.value}% of CTC`
                : c.calculation_type === 'pct_of_gross' ? `${c.value}% of Gross`
                : c.calculation_type
              const groups: Array<{ key: string; title: string }> = [
                { key: 'earning',                title: 'Earnings' },
                { key: 'deduction',              title: 'Deductions' },
                { key: 'employer_contribution',  title: 'Employer Contributions' },
              ]
              const t = comp.totals
              return (
                <div className="mt-5 rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="text-left  text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2">Component</th>
                        <th className="text-left  text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2">Rate</th>
                        <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2">Monthly</th>
                        <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2">Annual</th>
                      </tr>
                    </thead>
                    {groups.map(g => {
                      const rows = comp.components
                        .filter((c) => c.component_type === g.key)
                        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
                      if (rows.length === 0) return null
                      return (
                        <tbody key={g.key}>
                          <tr className="bg-muted/20">
                            <td colSpan={4} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{g.title}</td>
                          </tr>
                          {rows.map((c) => (
                            <tr key={c.id} className="border-b border-border/40">
                              <td className="px-3 py-2 text-foreground">
                                {c.name}{c.is_basic && <span className="ml-1.5 text-[9px] font-bold text-primary">BASIC</span>}
                              </td>
                              <td className="px-3 py-2 text-[11px] text-muted-foreground font-mono">{rateLabel(c)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.monthly_amount)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(c.annual_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      )
                    })}
                    {t && (
                      <tfoot className="border-t-2 border-border">
                        <tr>
                          <td className="px-3 py-2 text-[11px] font-semibold text-muted-foreground" colSpan={2}>Gross Earnings</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(t.gross_monthly)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(t.gross_annual)}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-[11px] text-muted-foreground" colSpan={2}>Employer Contributions</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(t.employer_contributions_monthly)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(t.employer_contributions_annual)}</td>
                        </tr>
                        <tr className="bg-primary/5">
                          <td className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-primary" colSpan={2}>Total CTC</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtMoney(Math.round((t.gross_monthly + t.employer_contributions_monthly) * 100) / 100)}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtMoney(Math.round((t.gross_annual + t.employer_contributions_annual) * 100) / 100)}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-[11px] text-muted-foreground" colSpan={2}>Net Take-Home</td>
                          <td className="px-3 py-2 text-right tabular-nums text-success">{fmtMoney(t.net_monthly)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-success">{fmtMoney(t.net_annual)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* C. Impact Preview Row — only if pending revisions */}
        {pendingRevisions.length > 0 && comp && (() => {
          const first      = pendingRevisions[0]
          const delta      = (first.new_ctc_annual ?? 0) - (comp.ctc_annual ?? 0)
          const monthly    = delta / 12
          const oldM       = (comp.ctc_annual ?? 0) / 12
          const newM       = (first.new_ctc_annual ?? 0) / 12
          const pfImpact   = Math.min(newM, 15000) * 0.12 - Math.min(oldM, 15000) * 0.12
          const isUp       = delta >= 0
          return (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                Pending Revision Impact Preview
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border border-t-[3px] border-t-primary bg-muted/20 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground">Monthly Change</p>
                  <p className={cn('text-sm font-bold tabular-nums', isUp ? 'text-success' : 'text-destructive')}>
                    {isUp ? '+' : ''}{fmtMoney(monthly)}/mo
                  </p>
                </div>
                <div className="rounded-xl border border-border border-t-[3px] border-t-primary bg-muted/20 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground">Annual Change</p>
                  <p className={cn('text-sm font-bold tabular-nums', isUp ? 'text-success' : 'text-destructive')}>
                    {isUp ? '+' : ''}{fmtMoney(delta)}/yr
                  </p>
                </div>
                <div className="rounded-xl border border-border border-t-[3px] border-t-primary bg-muted/20 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground">PF Employer</p>
                  <p className={cn('text-sm font-bold tabular-nums', pfImpact >= 0 ? 'text-foreground' : 'text-destructive')}>
                    {pfImpact >= 0 ? '+' : ''}{fmtMoney(pfImpact)}/mo
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* D. Revision Lifecycle Timeline — admin only */}
        {isAdmin && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Revision History
            </p>
            {!(payrollRevisionsData?.data?.length)
              ? (
                <div className="rounded-lg border bg-card p-4 text-center">
                  <TrendingUp className="h-5 w-5 mx-auto mb-1.5 opacity-20" />
                  <p className="text-xs text-muted-foreground">No revisions recorded yet.</p>
                </div>
              )
              : (
                <div className="pl-1">
                  {payrollRevisionsData!.data.map((r) => {
                    const statusVariant =
                      r.status === 'approved' ? 'success' :
                      r.status === 'rejected' ? 'destructive' :
                      r.status === 'pending'  ? 'warning' : 'secondary'
                    const dotBorder =
                      r.status === 'approved' ? 'border-success'     :
                      r.status === 'pending'  ? 'border-warning'     :
                      r.status === 'rejected' ? 'border-destructive' : 'border-muted-foreground/40'
                    const deltaPct = (r.before_ctc_annual && r.new_ctc_annual && r.before_ctc_annual > 0)
                      ? (((r.new_ctc_annual - r.before_ctc_annual) / r.before_ctc_annual) * 100).toFixed(1)
                      : null
                    return (
                      <div key={r.id} className="relative pl-6 pb-3 border-l-2 border-border/50 last:border-l-0">
                        <div className={cn(
                          'absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-background border-2',
                          dotBorder,
                        )} />
                        <div
                          className="rounded-lg border bg-card p-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setDrawerRevision(r)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium capitalize">{r.revision_type}</span>
                              <Badge variant={statusVariant as BadgeVariant} className="rounded-full text-[9px] capitalize">{r.status}</Badge>
                            </div>
                            <span className="text-[11px] text-muted-foreground">{fmtDate(r.effective_date)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            {r.before_ctc_annual && <span>{fmtMoney(r.before_ctc_annual)}</span>}
                            {r.before_ctc_annual && <span>→</span>}
                            <span className="font-medium text-foreground">{fmtMoney(r.new_ctc_annual)}</span>
                            {deltaPct && (
                              <span className={Number(deltaPct) >= 0 ? 'text-success' : 'text-destructive'}>
                                {Number(deltaPct) >= 0 ? '+' : ''}{deltaPct}%
                              </span>
                            )}
                          </div>
                          {r.reason && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{r.reason}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
          </div>
        )}

        {/* E. Compensation Records */}
        {(compensationHistoryData?.data?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                Compensation Records
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Effective From', 'To', 'Annual CTC', 'Monthly CTC', 'Status', ...(isAdmin ? [''] : [])].map((h, i) => (
                        <th key={h || `act-${i}`} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compensationHistoryData!.data.map((h) => (
                      <tr key={h.id} className={cn('border-b border-border/50 hover:bg-muted/20', h.is_active && 'bg-success/5')}>
                        <td className="px-4 py-2 whitespace-nowrap">{fmtDate(h.effective_from)}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{h.effective_to ? fmtDate(h.effective_to) : '—'}</td>
                        <td className="px-4 py-2 tabular-nums font-medium">{fmtMoney(h.ctc_annual)}</td>
                        <td className="px-4 py-2 tabular-nums">{fmtMoney(h.ctc_monthly)}</td>
                        <td className="px-4 py-2">
                          {h.is_active
                            ? <Badge variant="success" className="rounded-full text-[9px]">Active</Badge>
                            : <Badge variant="secondary" className="rounded-full text-[9px]">Closed</Badge>}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm" variant="ghost"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                              title="Delete compensation record"
                              disabled={deleteCompMutation.isPending}
                              onClick={() => {
                                setCdlg({ msg: `Delete the compensation record effective ${fmtDate(h.effective_from)} (CTC ${fmtMoney(h.ctc_annual)})?${h.is_active ? '\n\nThis is the ACTIVE record — the most recent remaining record will become active.' : ''}\n\nThis cannot be undone.`, act: () => deleteCompMutation.mutate(h.id) })
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* G. Compensation Revision Drawer */}
        <CompensationRevisionDrawer
          revision={drawerRevision}
          currentCTC={comp?.ctc_annual ?? 0}
          onClose={() => setDrawerRevision(null)}
          isAdmin={isAdmin}
          onApprove={(revId) => approveRevisionMutation.mutate(revId)}
          onReject={(revId) => { setRejectTarget(revId); setRejectReason('') }}
        />

        </div>
      )}

      <Dialog open={setupCompOpen} onOpenChange={setSetupCompOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{comp ? 'Edit Compensation' : 'Set Up Compensation'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
            {/* Salary Structure */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Salary Structure *</label>
              <select
                value={setupCompForm.salary_structure_id}
                onChange={e => {
                  pendingAutoLoadRef.current = true
                  setSetupCompForm(p => ({ ...p, salary_structure_id: e.target.value }))
                }}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">— Select a structure —</option>
                {(salaryStructuresData?.data ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            {/* Annual CTC */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Annual CTC *</label>
              <Input
                type="number"
                placeholder="e.g. 1200000"
                value={setupCompForm.ctc_annual}
                onChange={e => setSetupCompForm(p => ({ ...p, ctc_annual: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            {/* Effective From */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Effective From *</label>
              <DateInput
                value={setupCompForm.effective_from}
                onChange={v => setSetupCompForm(p => ({ ...p, effective_from: v }))}
                className="h-8 text-xs"
              />
              {setupCompForm.effective_from > today && (
                <p className="text-[10px] text-warning">Future-dated — payroll will use this from the effective date onwards</p>
              )}
            </div>
            {/* Components */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Salary Components *</label>
                <Button
                  type="button" size="sm" variant="ghost" className="h-6 text-[10px] gap-0.5 px-2"
                  onClick={() => setSetupCompForm(p => ({
                    ...p,
                    components: [...p.components, { salary_component_id: '', calculation_type: 'fixed', value: '' }],
                  }))}
                >
                  <Plus className="h-3 w-3" /> Add Row
                </Button>
              </div>
              {setupCompForm.components.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-muted/30 rounded-md p-1.5">
                  <select
                    value={row.salary_component_id}
                    onChange={e => setSetupCompForm(p => {
                      const cs = [...p.components]; cs[i] = { ...cs[i], salary_component_id: e.target.value }; return { ...p, components: cs }
                    })}
                    className="flex-1 h-7 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 ring-primary/50 min-w-0"
                  >
                    <option value="">Select component</option>
                    {(salaryComponentsData?.data ?? []).map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.component_type?.replace('_', ' ')})</option>
                    ))}
                  </select>
                  <select
                    value={row.calculation_type}
                    onChange={e => setSetupCompForm(p => {
                      const cs = [...p.components]; cs[i] = { ...cs[i], calculation_type: e.target.value }; return { ...p, components: cs }
                    })}
                    className="w-28 h-7 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 ring-primary/50 flex-shrink-0"
                  >
                    <option value="fixed">Fixed ₹/yr</option>
                    <option value="pct_of_ctc">% of CTC</option>
                    <option value="pct_of_basic">% of Basic</option>
                    <option value="pct_of_gross">% of Gross</option>
                    <option value="balance">Balance (residual)</option>
                  </select>
                  <Input
                    type="number"
                    placeholder={row.calculation_type === 'balance' ? 'auto' : row.calculation_type === 'fixed' ? '₹/yr' : '%'}
                    value={row.calculation_type === 'balance' ? '' : row.value}
                    disabled={row.calculation_type === 'balance'}
                    onChange={e => setSetupCompForm(p => {
                      const cs = [...p.components]; cs[i] = { ...cs[i], value: e.target.value }; return { ...p, components: cs }
                    })}
                    className="w-20 h-7 text-xs flex-shrink-0"
                  />
                  {setupCompForm.components.length > 1 && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive flex-shrink-0 p-0.5"
                      onClick={() => setSetupCompForm(p => ({ ...p, components: p.components.filter((_, j) => j !== i) }))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground pl-1">
                Fixed amounts in ₹/year. Percentages as 0–100 (e.g. Basic 40% of CTC → enter 40).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSetupCompOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={
                setupCompMutation.isPending ||
                !setupCompForm.salary_structure_id ||
                !setupCompForm.ctc_annual ||
                !setupCompForm.effective_from ||
                !setupCompForm.components.some(c => c.salary_component_id && c.value)
              }
              onClick={() => setupCompMutation.mutate()}
            >
              {setupCompMutation.isPending ? 'Saving…' : comp ? 'Update Compensation' : 'Set Up Compensation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {subTab === 'compensation' && (
        <div className="space-y-4">

          {/* Pending-revision banner intentionally omitted here — it is already
              rendered once at the top of the first Compensation block above.
              Rendering it again duplicated the banner on the same tab. */}

          {/* Revision History & Compensation History are rendered once in the
              primary Compensation block above — removed here to end the
              duplicate-render (they previously appeared twice on this tab). */}

          {/* ── Initiate Revision dialog ── */}
          {isAdmin && (
            <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    Initiate Compensation Revision
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-1">
                  {/* Revision type */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Revision Type</Label>
                    <Select value={revisionForm.revision_type} onValueChange={v => setRevisionForm(f => ({ ...f, revision_type: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[
                          { v: 'increment',    l: 'Increment'     },
                          { v: 'promotion',    l: 'Promotion'     },
                          { v: 'revision',     l: 'Revision'      },
                          { v: 'correction',   l: 'Correction'    },
                          { v: 'restructure',  l: 'Restructure'   },
                          { v: 'retro',        l: 'Retro Arrears' },
                        ].map(({ v, l }) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* New CTC */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">New Annual CTC <span className="text-destructive">*</span></Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      placeholder="e.g. 600000"
                      value={revisionForm.new_ctc_annual}
                      onChange={e => setRevisionForm(f => ({ ...f, new_ctc_annual: e.target.value }))}
                    />
                    {/* Delta preview */}
                    {revisionForm.new_ctc_annual && comp && (() => {
                      const newCTC  = Number(revisionForm.new_ctc_annual)
                      const delta   = newCTC - (comp.ctc_annual ?? 0)
                      const pct     = comp.ctc_annual > 0 ? ((delta / comp.ctc_annual) * 100).toFixed(1) : '—'
                      const isUp    = delta >= 0
                      return (
                        <p className={cn('text-[11px] mt-1', isUp ? 'text-success' : 'text-destructive')}>
                          {fmtMoney(comp.ctc_annual)} → {fmtMoney(newCTC)}
                          <span className="ml-1.5 font-semibold">({isUp ? '+' : ''}{fmtMoney(delta)} / {pct}%)</span>
                        </p>
                      )
                    })()}
                  </div>
                  {/* Effective date */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Effective Date <span className="text-destructive">*</span></Label>
                    <DateInput
                      className="h-8 text-xs"
                      value={revisionForm.effective_date}
                      onChange={v => setRevisionForm(f => ({ ...f, effective_date: v }))}
                    />
                    {revisionForm.effective_date > today && (
                      <p className="text-[10px] text-warning">Future revision — will be applied to payroll from {fmtDate(revisionForm.effective_date)}</p>
                    )}
                  </div>
                  {/* Reason */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. Annual increment 2025"
                      value={revisionForm.reason}
                      onChange={e => setRevisionForm(f => ({ ...f, reason: e.target.value }))}
                    />
                  </div>
                  {/* Notes */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="Additional context..."
                      value={revisionForm.notes}
                      onChange={e => setRevisionForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => setRevisionOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={!revisionForm.new_ctc_annual || !revisionForm.reason || initiateRevisionMutation.isPending}
                    onClick={() => initiateRevisionMutation.mutate()}
                  >
                    {initiateRevisionMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Submit for Approval
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

        </div>
      )}

      {/* ── Reject revision reason dialog ── */}
      <Dialog open={rejectTarget !== null} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">Provide a reason so the employee knows what to address.</p>
            <Input
              placeholder="e.g. Budget not approved for this cycle"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setRejectTarget(null); setRejectReason('') }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!rejectReason.trim() || rejectRevisionMutation.isPending}
              onClick={() => rejectRevisionMutation.mutate({ revId: rejectTarget!, reason: rejectReason.trim() })}
            >
              {rejectRevisionMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
