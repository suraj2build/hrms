/**
 * UAT Certification Workspace — /admin/intelligence/uat-certification
 *
 * Enterprise-readiness certification tool. Drives the per-module UAT
 * checklist from the readiness audit. Sign-off state (pass/fail/na + note)
 * is persisted server-side in uat_certification_marks (migration 420) —
 * the reviewer identity is the authenticated caller who wrote the mark
 * (updated_by), not a free-text field. Survives a cleared browser or a
 * different device, and gives HR an audit trail of who certified what.
 */
import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2, XCircle, MinusCircle, Circle, ShieldCheck, Download, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'

type Status = 'pending' | 'pass' | 'fail' | 'na'

interface CheckItem { id: string; text: string }
interface ModuleSpec { key: string; label: string; items: CheckItem[] }

// ── Checklist (from Enterprise Readiness audit §12) ──────────────────────────
const MODULES: ModuleSpec[] = [
  { key: 'employee_master', label: 'Employee Master', items: [
    { id: 'em1', text: 'List loads, paginates, and respects all filters; clearing filters resets.' },
    { id: 'em2', text: 'List-level error state renders on fetch failure (no silent empty).' },
    { id: 'em3', text: 'Row opens profile via mouse AND keyboard (Enter/Space).' },
    { id: 'em4', text: 'Create/edit employee saves and reflects in list immediately.' },
    { id: 'em5', text: 'Export / Saved Views / Grid toggle functional OR clearly disabled.' },
    { id: 'em6', text: 'Dark mode renders correctly (no white cards on dark canvas).' },
  ]},
  { key: 'attendance', label: 'Attendance', items: [
    { id: 'at1', text: 'Muster roll, daily ops, regularisation, anomalies/exceptions load with real data.' },
    { id: 'at2', text: 'Regularisation request submits and appears in the manager/admin queue.' },
    { id: 'at3', text: 'Confidence values render with a single consistent indicator and legend.' },
    { id: 'at4', text: 'No duplicate destinations (Muster reachable from one canonical place).' },
    { id: 'at5', text: 'PolicyConflicts / periods / upload reachable from nav (not deep-link only).' },
  ]},
  { key: 'leave', label: 'Leave', items: [
    { id: 'lv1', text: 'Apply Leave from ESS/Manager/dashboard reaches the apply form in ≤2 taps.' },
    { id: 'lv2', text: 'Balance, ledger, accrual, approvals load; submitted request hits approver queue.' },
    { id: 'lv3', text: 'Approve/reject updates balance and reflects in employee view.' },
    { id: 'lv4', text: 'Optional holidays selectable; collision/governance views load.' },
  ]},
  { key: 'payroll', label: 'Payroll', items: [
    { id: 'pr1', text: 'Run console processes a cycle; blockers/explain pages resolve for a real run.' },
    { id: 'pr2', text: 'Validation, Reconciliation, Finalization, Payout Reconciliation, Statutory Dashboard reachable + load.' },
    { id: 'pr3', text: 'Statutory (EPF/ESI/PTAX/TDS) screens render correct period data.' },
    { id: 'pr4', text: 'No fabricated/placeholder chart data anywhere in the run flow.' },
  ]},
  { key: 'compensation', label: 'Compensation', items: [
    { id: 'cm1', text: 'CTC summary, components, revisions load and reconcile with payslip net-pay.' },
    { id: 'cm2', text: 'Comp-off, advances, loans, reimbursements, variable-pay, arrears all load.' },
    { id: 'cm3', text: 'ESS compensation page shows full breakdown moved off the dashboard.' },
  ]},
  { key: 'assets', label: 'Assets', items: [
    { id: 'as1', text: 'Asset list and Asset Categories master load and are reachable from Setup nav.' },
    { id: 'as2', text: 'Assets-at-risk signal in WorkforceCommand/ActionCenter ties to real records.' },
  ]},
  { key: 'onboarding', label: 'Onboarding', items: [
    { id: 'on1', text: 'Pre-join token flow + document upload completes end-to-end.' },
    { id: 'on2', text: 'Module/session review route resolves; stalled-onboarding KPI links to records.' },
    { id: 'on3', text: 'New-joiner signal visible to managers (ManagerInsights mounted).' },
  ]},
  { key: 'separation', label: 'Separation', items: [
    { id: 'sp1', text: 'Separation lifecycle screen loads; on-notice/pending-separation KPIs tie to records.' },
    { id: 'sp2', text: 'Asset-separation overlap surfaces consistently (one source of truth).' },
  ]},
  { key: 'executive_intelligence', label: 'Executive Intelligence', items: [
    { id: 'ex1', text: 'One canonical executive surface; no orphan/duplicate landings reachable.' },
    { id: 'ex2', text: 'Persona switch (CEO/CHRO) reframes same data; no contradictory numbers.' },
    { id: 'ex3', text: 'Every headline metric shows a delta + threshold/benchmark legend + as-of period.' },
    { id: 'ex4', text: 'Trends render as charts; tables available as drill-down.' },
    { id: 'ex5', text: 'Insight cards open ExplainabilityDrawer with summary/factors/actions.' },
  ]},
  { key: 'cross_cutting', label: 'Cross-cutting (gate for all)', items: [
    { id: 'cc1', text: 'No dead nav links; every nav item resolves to a real screen.' },
    { id: 'cc2', text: 'Dark mode consistent on all high-traffic screens.' },
    { id: 'cc3', text: 'Mobile: sidebar collapses to drawer; usable at 375px; modals scroll internally.' },
    { id: 'cc4', text: 'Loading/empty/error states present and consistent on every list/query.' },
    { id: 'cc5', text: 'Keyboard + screen-reader operable for nav, buttons, table row actions.' },
  ]},
]

interface MarkRow {
  item_id: string
  status: Status
  note: string | null
  updated_by: string | null
  updated_by_name: string | null
  updated_at: string
}

const STATUS_META: Record<Status, { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
  pending: { icon: Circle,       cls: 'text-muted-foreground', label: 'Pending' },
  pass:    { icon: CheckCircle2, cls: 'text-success',      label: 'Pass' },
  fail:    { icon: XCircle,      cls: 'text-destructive',          label: 'Fail' },
  na:      { icon: MinusCircle,  cls: 'text-muted-foreground', label: 'N/A' },
}

export function UATCertification() {
  const qc = useQueryClient()
  const tenant = useAuthStore(s => s.tenant)
  const tenantId = tenant?.id ?? 'default'

  const marksQuery = useQuery<{ data: MarkRow[] }>({
    queryKey: ['uat-certification', tenantId],
    queryFn:  () => api.get('/intelligence/uat-certification'),
  })

  const marks = useMemo(() => {
    const m: Record<string, MarkRow> = {}
    for (const row of marksQuery.data?.data ?? []) m[row.item_id] = row
    return m
  }, [marksQuery.data])

  // Local draft buffer for the note field so typing doesn't fire a request
  // per keystroke — committed on blur.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const row of marksQuery.data?.data ?? []) next[row.item_id] = row.note ?? ''
    setNoteDrafts(next)
  }, [marksQuery.data])

  const updateMutation = useMutation({
    mutationFn: ({ itemId, status, note }: { itemId: string; status: Status; note?: string | null }) =>
      api.put<MarkRow>(`/intelligence/uat-certification/${itemId}`, { status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uat-certification', tenantId] }),
  })

  const resetMutation = useMutation({
    mutationFn: () => api.delete('/intelligence/uat-certification'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uat-certification', tenantId] }),
  })

  const cycleStatus = useCallback((id: string) => {
    const order: Status[] = ['pending', 'pass', 'fail', 'na']
    const cur = marks[id]?.status ?? 'pending'
    const nextStatus = order[(order.indexOf(cur) + 1) % order.length]
    updateMutation.mutate({ itemId: id, status: nextStatus, note: marks[id]?.note ?? null })
  }, [marks, updateMutation])

  const commitNote = useCallback((id: string) => {
    const note = noteDrafts[id] ?? ''
    if ((marks[id]?.note ?? '') === note) return // unchanged — skip the request
    updateMutation.mutate({ itemId: id, status: marks[id]?.status ?? 'pending', note: note || null })
  }, [noteDrafts, marks, updateMutation])

  const totals = useMemo(() => {
    const all = MODULES.flatMap(m => m.items)
    const counts = { total: all.length, pass: 0, fail: 0, na: 0, pending: 0 }
    for (const it of all) {
      const st = marks[it.id]?.status ?? 'pending'
      counts[st]++
    }
    const decided = counts.pass + counts.fail + counts.na
    const pct = Math.round((decided / counts.total) * 100)
    const certified = counts.fail === 0 && counts.pending === 0
    return { ...counts, decided, pct, certified }
  }, [marks])

  function moduleStats(m: ModuleSpec) {
    let pass = 0, fail = 0, pending = 0, na = 0
    for (const it of m.items) {
      const st = marks[it.id]?.status ?? 'pending'
      if (st === 'pass') pass++; else if (st === 'fail') fail++; else if (st === 'na') na++; else pending++
    }
    return { pass, fail, pending, na, total: m.items.length }
  }

  function reset() {
    if (!confirm('Reset all UAT certification marks for this tenant? This clears every reviewer\'s sign-off.')) return
    resetMutation.mutate()
  }

  function exportReport() {
    const lines: string[] = [`UAT Certification — ${tenant?.name ?? tenantId}`, `Generated: ${new Date().toISOString()}`, `Overall: ${totals.pass} pass / ${totals.fail} fail / ${totals.na} N/A / ${totals.pending} pending (${totals.pct}% reviewed)`, '']
    for (const m of MODULES) {
      lines.push(`## ${m.label}`)
      for (const it of m.items) {
        const s = marks[it.id]
        lines.push(`- [${(s?.status ?? 'pending').toUpperCase()}] ${it.text}${s?.updated_by_name ? ` — ${s.updated_by_name}` : ''}${s?.note ? ` (${s.note})` : ''}`)
      }
      lines.push('')
    }
    navigator.clipboard?.writeText(lines.join('\n'))
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] text-white p-5 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> UAT Certification Workspace</h1>
          <p className="text-sm text-white/80">Per-module enterprise-readiness sign-off for {tenant?.name ?? 'this tenant'}. Marks are recorded against your account.</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.pass} pass</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.fail} fail</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.pending} pending</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.pct}% reviewed</span>
            {totals.certified && <span className="px-2 py-0.5 rounded-full bg-success text-success-foreground font-semibold">✓ CERTIFIED</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={exportReport}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Copy report
          </Button>
          <Button size="sm" variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={reset} disabled={resetMutation.isPending}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
          </Button>
        </div>
      </div>

      {marksQuery.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Failed to load certification marks. <Button size="sm" variant="outline" className="ml-auto" onClick={() => marksQuery.refetch()}>Retry</Button>
        </div>
      ) : marksQuery.isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading certification state…</div>
      ) : (
        <>
          {/* Overall progress bar */}
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] transition-all" style={{ width: `${totals.pct}%` }} />
          </div>

          {/* Modules */}
          {MODULES.map(m => {
            const st = moduleStats(m)
            const moduleCertified = st.fail === 0 && st.pending === 0
            return (
              <div key={m.key} className="rounded-lg border border-border bg-card">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{m.label}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-success">{st.pass}✓</span>
                    {st.fail > 0 && <span className="text-destructive">{st.fail}✗</span>}
                    {st.pending > 0 && <span>{st.pending} pending</span>}
                    {moduleCertified && <span className="px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">certified</span>}
                  </div>
                </div>
                <div className="divide-y divide-border/50">
                  {m.items.map(it => {
                    const s = marks[it.id]
                    const status = s?.status ?? 'pending'
                    const Meta = STATUS_META[status]
                    const Icon = Meta.icon
                    return (
                      <div key={it.id} className="px-4 py-2.5 flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => cycleStatus(it.id)}
                          disabled={updateMutation.isPending}
                          title="Click to cycle: pending → pass → fail → N/A"
                          className={`mt-0.5 flex-shrink-0 ${Meta.cls} disabled:opacity-50`}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">{it.text}</p>
                          {(status === 'pass' || status === 'fail') && (
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              {s?.updated_by_name && (
                                <span className="text-[11px] text-muted-foreground">
                                  Signed off by <span className="font-medium text-foreground">{s.updated_by_name}</span>
                                </span>
                              )}
                              <input
                                value={noteDrafts[it.id] ?? ''}
                                onChange={e => setNoteDrafts(d => ({ ...d, [it.id]: e.target.value }))}
                                onBlur={() => commitNote(it.id)}
                                placeholder="Note (optional)"
                                className="text-xs rounded border border-border bg-background px-2 py-1 flex-1 min-w-[160px]"
                              />
                            </div>
                          )}
                        </div>
                        <span className={`text-[11px] font-medium flex-shrink-0 ${Meta.cls}`}>{Meta.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Certification marks are recorded server-side against the signing-in reviewer's account — they are not a system of record for employee, payroll, or any operational data.
      </p>
    </PageContainer>
  )
}

export default UATCertification
