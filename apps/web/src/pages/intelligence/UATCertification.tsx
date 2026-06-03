/**
 * UAT Certification Workspace — /admin/intelligence/uat-certification
 *
 * Read-only enterprise-readiness certification tool. Drives the per-module
 * UAT checklist from the readiness audit. Sign-off state (pass/fail/na + notes
 * + owner) is persisted in localStorage — NO new API, NO new table, NO business
 * logic. Purely a certification surface for UAT sign-off.
 */
import { useState, useMemo, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2, XCircle, MinusCircle, Circle, ShieldCheck, Download, RotateCcw,
} from 'lucide-react'

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

interface ItemState { status: Status; owner?: string; note?: string }
type CertState = Record<string, ItemState>

const STORAGE_KEY = 'emvora-uat-certification'

function loadState(tenantId: string): CertState {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${tenantId}`)
    return raw ? (JSON.parse(raw) as CertState) : {}
  } catch { return {} }
}
function saveState(tenantId: string, s: CertState) {
  try { localStorage.setItem(`${STORAGE_KEY}:${tenantId}`, JSON.stringify(s)) } catch { /* ignore */ }
}

const STATUS_META: Record<Status, { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
  pending: { icon: Circle,       cls: 'text-muted-foreground', label: 'Pending' },
  pass:    { icon: CheckCircle2, cls: 'text-emerald-600',      label: 'Pass' },
  fail:    { icon: XCircle,      cls: 'text-red-600',          label: 'Fail' },
  na:      { icon: MinusCircle,  cls: 'text-muted-foreground', label: 'N/A' },
}

export function UATCertification() {
  const tenant = useAuthStore(s => s.tenant)
  const profile = useAuthStore(s => s.profile)
  const tenantId = tenant?.id ?? 'default'
  const [state, setState] = useState<CertState>(() => loadState(tenantId))

  const update = useCallback((id: string, patch: Partial<ItemState>) => {
    setState(prev => {
      const prevItem: ItemState = prev[id] ?? { status: 'pending' }
      const merged: ItemState = { ...prevItem, ...patch }
      const next = { ...prev, [id]: merged }
      saveState(tenantId, next)
      return next
    })
  }, [tenantId])

  const cycleStatus = useCallback((id: string) => {
    const order: Status[] = ['pending', 'pass', 'fail', 'na']
    const cur = state[id]?.status ?? 'pending'
    const nextStatus = order[(order.indexOf(cur) + 1) % order.length]
    update(id, { status: nextStatus, owner: nextStatus === 'pass' || nextStatus === 'fail' ? (state[id]?.owner ?? profile?.full_name ?? '') : state[id]?.owner })
  }, [state, update, profile])

  const totals = useMemo(() => {
    const all = MODULES.flatMap(m => m.items)
    const counts = { total: all.length, pass: 0, fail: 0, na: 0, pending: 0 }
    for (const it of all) {
      const st = state[it.id]?.status ?? 'pending'
      counts[st]++
    }
    const decided = counts.pass + counts.fail + counts.na
    const pct = Math.round((decided / counts.total) * 100)
    const certified = counts.fail === 0 && counts.pending === 0
    return { ...counts, decided, pct, certified }
  }, [state])

  function moduleStats(m: ModuleSpec) {
    let pass = 0, fail = 0, pending = 0, na = 0
    for (const it of m.items) {
      const st = state[it.id]?.status ?? 'pending'
      if (st === 'pass') pass++; else if (st === 'fail') fail++; else if (st === 'na') na++; else pending++
    }
    return { pass, fail, pending, na, total: m.items.length }
  }

  function reset() {
    if (!confirm('Reset all UAT certification marks for this tenant?')) return
    setState({}); saveState(tenantId, {})
  }

  function exportReport() {
    const lines: string[] = [`UAT Certification — ${tenant?.name ?? tenantId}`, `Generated: ${new Date().toISOString()}`, `Overall: ${totals.pass} pass / ${totals.fail} fail / ${totals.na} N/A / ${totals.pending} pending (${totals.pct}% reviewed)`, '']
    for (const m of MODULES) {
      lines.push(`## ${m.label}`)
      for (const it of m.items) {
        const s = state[it.id]
        lines.push(`- [${(s?.status ?? 'pending').toUpperCase()}] ${it.text}${s?.owner ? ` — ${s.owner}` : ''}${s?.note ? ` (${s.note})` : ''}`)
      }
      lines.push('')
    }
    navigator.clipboard?.writeText(lines.join('\n'))
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-5xl">
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] text-white p-5 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> UAT Certification Workspace</h1>
          <p className="text-sm text-white/80">Per-module enterprise-readiness sign-off. Marks are saved locally for {tenant?.name ?? 'this tenant'}.</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.pass} pass</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.fail} fail</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.pending} pending</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20">{totals.pct}% reviewed</span>
            {totals.certified && <span className="px-2 py-0.5 rounded-full bg-emerald-400/90 text-emerald-950 font-semibold">✓ CERTIFIED</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={exportReport}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Copy report
          </Button>
          <Button size="sm" variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset
          </Button>
        </div>
      </div>

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
                <span className="text-emerald-600">{st.pass}✓</span>
                {st.fail > 0 && <span className="text-red-600">{st.fail}✗</span>}
                {st.pending > 0 && <span>{st.pending} pending</span>}
                {moduleCertified && <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">certified</span>}
              </div>
            </div>
            <div className="divide-y divide-border/50">
              {m.items.map(it => {
                const s = state[it.id]
                const status = s?.status ?? 'pending'
                const Meta = STATUS_META[status]
                const Icon = Meta.icon
                return (
                  <div key={it.id} className="px-4 py-2.5 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => cycleStatus(it.id)}
                      title="Click to cycle: pending → pass → fail → N/A"
                      className={`mt-0.5 flex-shrink-0 ${Meta.cls}`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{it.text}</p>
                      {(status === 'pass' || status === 'fail') && (
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <input
                            value={s?.owner ?? ''}
                            onChange={e => update(it.id, { owner: e.target.value })}
                            placeholder="Sign-off owner"
                            className="text-xs rounded border border-border bg-background px-2 py-1 w-40"
                          />
                          <input
                            value={s?.note ?? ''}
                            onChange={e => update(it.id, { note: e.target.value })}
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

      <p className="text-[11px] text-muted-foreground">
        Certification marks are stored locally in this browser for audit convenience — they are not a system of record and never modify employee, payroll, or any operational data.
      </p>
    </div>
  )
}

export default UATCertification
