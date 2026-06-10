/**
 * StatutoryDashboard — Compliance Cockpit
 *
 * A real compliance overview (not a repeat of the left-nav module tabs):
 *   1. Health KPIs        — statutory liability, modules ready, open exceptions, ID completeness
 *   2. Liability breakdown — EPF / ESI / PTAX / TDS remittance value + avg / employee
 *   3. Exceptions & fixes  — every gap with a severity, a count and a corrective step + action
 *   4. Missing IDs         — employees missing PAN / UAN / Aadhaar / ESI / bank, drillable
 *
 * All numbers come from canonical endpoints:
 *   /payroll/compliance/stats          — per-module readiness (deadlines, gaps)
 *   /datasets/statutory?month=YYYY-MM   — totals, coverage, readiness issues
 *   /datasets/statutory/exceptions      — per-employee statutory-ID completeness
 */

import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Building2, ShieldCheck, MapPin, FileText, Wallet, Coins,
  AlertTriangle, Clock, CheckCircle2, ChevronRight,
  CreditCard, Gauge, ArrowUpRight, ListChecks,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'
import { useUIStore } from '@/stores/uiStore'
import { useStatutoryMonth, StatutoryMonthPicker } from '@/components/compliance/StatutoryMonthPicker'
import { PageHero, HeroStat } from '@/components/layout/PageHero'

// ── Types ───────────────────────────────────────────────────────────────────────

interface ModuleStatus {
  employees_covered: number
  employees_missing: number
  filing_gaps: number
  computation_errors: number
  next_deadline: string | null
  days_to_deadline: number | null
  is_ready: boolean
}
interface ComplianceStats {
  epf: ModuleStatus; esi: ModuleStatus; ptax: ModuleStatus; tds: ModuleStatus
  total_filing_gaps: number; total_coverage_gaps: number
  total_computation_errors: number; critical_deadline_days: number | null
}
interface StatutoryData {
  coverage: {
    epf:  { enrolled: number; missing_uan: number; has_registration: boolean }
    esi:  { eligible: number; has_registration: boolean }
    ptax: { enrolled: number; states: string[]; missing_registrations: string[] }
    tds:  { employees_with_tds: number; missing_pan: number }
    lwf:  { enrolled: number; states: string[] }
    payroll: { finalized: number; total: number; all_finalized: boolean }
  }
  totals: {
    epf:  { total_remittance: number }
    esi:  { total_remittance: number }
    ptax: { amount: number }
    tds:  { total_deducted: number }
    lwf:  { total_remittance: number }
    grand_total: number
  }
  readiness: { overall: boolean; issues: string[] }
}
interface ExceptionsData {
  summary: { total_employees: number; complete: number; incomplete: number; completeness_pct: number }
  by_field: Array<{ field: string; label: string; missing: number }>
  employees: Array<{ id: string; employee_code: string; name: string; department: string; missing: string[] }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => {
  const v = Number(n ?? 0)
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)} Cr`
  if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(2)} L`
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}
const num = (n: number) => Number(n ?? 0).toLocaleString('en-IN')

type Sev = 'critical' | 'warning' | 'success'
const SEV = {
  critical: { dot: 'bg-destructive', text: 'text-destructive', bg: 'bg-destructive/10', ring: 'ring-destructive/25' },
  warning:  { dot: 'bg-warning',     text: 'text-warning',     bg: 'bg-warning/10',     ring: 'ring-warning/25' },
  success:  { dot: 'bg-success',     text: 'text-success',     bg: 'bg-success/10',     ring: 'ring-success/25' },
} as const

// ── KPI card ─────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string
  icon: React.ElementType; tone?: Sev
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tone ? SEV[tone].bg : 'bg-muted')}>
          <Icon className={cn('h-3.5 w-3.5', tone ? SEV[tone].text : 'text-muted-foreground')} />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Module liability card ──────────────────────────────────────────────────────

function ModuleCard({ label, icon: Icon, amount, covered, ready, onOpen }: {
  label: string; icon: React.ElementType; amount: number
  covered: number; ready: boolean; onOpen: () => void
}) {
  const avg = covered > 0 ? amount / covered : 0
  return (
    <button
      onClick={onOpen}
      className="group rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', ready ? SEV.success.bg : SEV.warning.bg, ready ? SEV.success.text : SEV.warning.text)}>
          {ready ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
          {ready ? 'Ready' : 'Review'}
        </span>
      </div>
      <p className="mt-3 text-xl font-bold text-foreground tabular-nums">{inr(amount)}</p>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{num(covered)} employees</span>
        <span>avg {inr(avg)}</span>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Open module <ArrowUpRight className="h-3 w-3" />
      </div>
    </button>
  )
}

// ── Exception row ──────────────────────────────────────────────────────────────

interface Exception {
  sev: Sev; title: string; corrective: string; count?: number
  actionLabel?: string; onAction?: () => void
}

function ExceptionRow({ e }: { e: Exception }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className={cn('mt-1 h-2 w-2 flex-shrink-0 rounded-full', SEV[e.sev].dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-foreground">{e.title}</p>
          {typeof e.count === 'number' && (
            <span className={cn('rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums', SEV[e.sev].bg, SEV[e.sev].text)}>{e.count}</span>
          )}
        </div>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{e.corrective}</p>
      </div>
      {e.onAction && (
        <button
          onClick={e.onAction}
          className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
        >
          {e.actionLabel ?? 'Fix'} <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function StatutoryDashboard() {
  const navigate = useNavigate()
  const [month, setMonth] = useStatutoryMonth()
  const rawMonth = useUIStore(s => s.statutoryMonth)   // null until user/auto picks

  // Default the period to the latest finalized payroll month on first load only.
  const { data: anchor } = useQuery<{ month: string | null }>({
    queryKey:  ['payroll-anchor'],
    queryFn:   () => api.get('/datasets/payroll-cost/anchor'),
    staleTime: 5 * 60_000,
    retry:     false,
  })
  useEffect(() => {
    if (anchor?.month && rawMonth == null) setMonth(anchor.month)
  }, [anchor?.month, rawMonth, setMonth])

  const { data: stats }      = useQuery<ComplianceStats>({ queryKey: ['compliance-stats'], queryFn: () => api.get('/payroll/compliance/stats'), staleTime: 60_000, retry: false })
  const { data: statutory }  = useQuery<StatutoryData>({ queryKey: ['statutory-data', month], queryFn: () => api.get(`/datasets/statutory?month=${month}`), staleTime: 60_000, retry: false, enabled: !!month })
  const { data: exceptions } = useQuery<ExceptionsData>({ queryKey: ['statutory-exceptions'], queryFn: () => api.get('/datasets/statutory/exceptions'), staleTime: 60_000, retry: false })

  const go = (path: string) => () => navigate(path)

  // ── Derived: module readiness count ───────────────────────────────────────
  const modulesReady = useMemo(() => {
    if (!statutory) return { ready: 0, total: 5 }
    const c = statutory.coverage
    const flags = [
      c.epf.has_registration && c.epf.missing_uan === 0,
      c.esi.eligible === 0 || c.esi.has_registration,
      c.ptax.missing_registrations.length === 0,
      c.tds.missing_pan === 0,
      c.payroll.all_finalized,
    ]
    return { ready: flags.filter(Boolean).length, total: 5 }
  }, [statutory])

  // ── Derived: exceptions list with corrective steps ────────────────────────
  const exceptionList = useMemo<Exception[]>(() => {
    const out: Exception[] = []
    const c = statutory?.coverage

    if (c) {
      if (!c.payroll.all_finalized && c.payroll.total > 0) {
        out.push({ sev: 'critical', count: c.payroll.total - c.payroll.finalized,
          title: 'Payroll not finalized for this month',
          corrective: 'Finalize the payroll run so statutory contributions are locked before filing.',
          actionLabel: 'Payroll', onAction: go('/admin/payroll/center') })
      }
      if (!c.epf.has_registration) {
        out.push({ sev: 'critical', title: 'EPF registration not configured',
          corrective: 'Add your establishment EPF registration number in Setup before generating ECR.',
          actionLabel: 'EPF', onAction: go('/admin/payroll/statutory/epf') })
      }
      if (c.epf.missing_uan > 0) {
        out.push({ sev: 'critical', count: c.epf.missing_uan,
          title: 'Employees missing UAN',
          corrective: 'Capture UAN under Employee › Bank & Statutory — ECR rejects members without UAN.',
          actionLabel: 'EPF', onAction: go('/admin/payroll/statutory/epf') })
      }
      if (c.esi.eligible > 0 && !c.esi.has_registration) {
        out.push({ sev: 'critical', title: 'ESI registration not configured',
          corrective: 'Add the ESI code in Setup to file ESI returns for eligible employees.',
          actionLabel: 'ESI', onAction: go('/admin/payroll/statutory/esi') })
      }
      if (c.tds.missing_pan > 0) {
        out.push({ sev: 'critical', count: c.tds.missing_pan,
          title: 'TDS deducted but PAN missing',
          corrective: 'PAN is mandatory for 24Q — add it in Employee › Bank & Statutory or TDS is charged at 20%.',
          actionLabel: 'TDS', onAction: go('/admin/payroll/statutory/tds') })
      }
      if (c.ptax.missing_registrations.length > 0) {
        out.push({ sev: 'warning', count: c.ptax.missing_registrations.length,
          title: `PT registration missing for ${c.ptax.missing_registrations.join(', ')}`,
          corrective: 'Register the establishment for Professional Tax in the listed state(s).',
          actionLabel: 'Prof. Tax', onAction: go('/admin/payroll/statutory/ptax') })
      }
    }

    // Missing statutory-ID fields (people-data exceptions)
    for (const f of exceptions?.by_field ?? []) {
      if (f.missing > 0) {
        out.push({ sev: f.field === 'pan' || f.field === 'uan' ? 'critical' : 'warning', count: f.missing,
          title: `Employees missing ${f.label}`,
          corrective: 'Complete the identifier under Employee › Bank & Statutory.',
          actionLabel: 'View', onAction: () => document.getElementById('missing-ids')?.scrollIntoView({ behavior: 'smooth' }) })
      }
    }

    return out
  }, [statutory, exceptions]) // eslint-disable-line react-hooks/exhaustive-deps

  const grand = statutory?.totals.grand_total ?? 0
  const criticalDeadline = (stats?.critical_deadline_days ?? null) !== null && stats!.critical_deadline_days! <= 7
  const idPct = exceptions?.summary.completeness_pct ?? 0

  return (
    <div className="space-y-5">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Compliance"
        title="Compliance Cockpit"
        subtitle="Statutory health, liabilities and exceptions — at a glance"
        actions={
          <>
            <StatutoryMonthPicker />
            <button
              onClick={go('/admin/payroll/filing-pack')}
              className="gloss-sheen flex h-8 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <FileText className="h-3.5 w-3.5" /> Filing Pack
            </button>
          </>
        }
      >
        <HeroStat label="Statutory Liability" value={inr(grand)} sub="EPF + ESI + PT + TDS" icon={Wallet}
                  tone={grand > 0 ? 'success' : 'warning'} />
        <HeroStat label="Modules Ready" value={`${modulesReady.ready}/${modulesReady.total}`}
                  sub={statutory?.readiness.overall ? 'All clear to file' : 'Action needed'} icon={Gauge}
                  tone={modulesReady.ready === modulesReady.total ? 'success' : 'warning'} />
        <HeroStat label="Open Exceptions" value={num(exceptionList.length)} sub="Need a fix" icon={ListChecks}
                  tone={exceptionList.length === 0 ? 'success' : exceptionList.some(e => e.sev === 'critical') ? 'danger' : 'warning'} />
        <HeroStat label="ID Completeness" value={`${idPct}%`}
                  sub={exceptions ? `${num(exceptions.summary.complete)} of ${num(exceptions.summary.total_employees)}` : '—'} icon={CreditCard}
                  tone={idPct >= 99 ? 'success' : idPct >= 90 ? 'warning' : 'danger'} />
      </PageHero>

      {/* ── Deadline alert ───────────────────────────────────────────────── */}
      {criticalDeadline && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[12.5px] font-medium text-destructive">
          <Clock className="h-4 w-4 flex-shrink-0" />
          Statutory filing deadline in {stats!.critical_deadline_days} day{stats!.critical_deadline_days === 1 ? '' : 's'} — submit pending filings.
        </div>
      )}

      {/* ── Module liability breakdown ───────────────────────────────────── */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Statutory Liability by Module</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ModuleCard label="EPF"  icon={Building2}   amount={statutory?.totals.epf.total_remittance ?? 0} covered={statutory?.coverage.epf.enrolled ?? 0}        ready={!!statutory?.coverage.epf.has_registration && (statutory?.coverage.epf.missing_uan ?? 0) === 0} onOpen={go('/admin/payroll/statutory/epf')} />
          <ModuleCard label="ESI"  icon={ShieldCheck} amount={statutory?.totals.esi.total_remittance ?? 0} covered={statutory?.coverage.esi.eligible ?? 0}          ready={(statutory?.coverage.esi.eligible ?? 0) === 0 || !!statutory?.coverage.esi.has_registration} onOpen={go('/admin/payroll/statutory/esi')} />
          <ModuleCard label="PTAX" icon={MapPin}      amount={statutory?.totals.ptax.amount ?? 0}          covered={statutory?.coverage.ptax.enrolled ?? 0}        ready={(statutory?.coverage.ptax.missing_registrations.length ?? 0) === 0} onOpen={go('/admin/payroll/statutory/ptax')} />
          <ModuleCard label="TDS"  icon={FileText}    amount={statutory?.totals.tds.total_deducted ?? 0}   covered={statutory?.coverage.tds.employees_with_tds ?? 0} ready={(statutory?.coverage.tds.missing_pan ?? 0) === 0} onOpen={go('/admin/payroll/statutory/tds')} />
          <ModuleCard label="LWF"  icon={Coins}   amount={statutory?.totals.lwf.total_remittance ?? 0} covered={statutory?.coverage.lwf.enrolled ?? 0}         ready onOpen={go('/admin/payroll/statutory/lwf')} />
        </div>
      </div>

      {/* ── Exceptions & corrective actions ──────────────────────────────── */}
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          Exceptions &amp; Corrective Actions
          {exceptionList.length > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">{exceptionList.length}</span>
          )}
        </h2>
        {exceptionList.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 px-4 py-5 text-sm text-success">
            <CheckCircle2 className="h-5 w-5" /> No compliance exceptions for this period — you're ready to file.
          </div>
        ) : (
          <div className="space-y-2">
            {exceptionList.map((e, i) => <ExceptionRow key={i} e={e} />)}
          </div>
        )}
      </div>

      {/* ── Missing statutory IDs ────────────────────────────────────────── */}
      <div id="missing-ids">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CreditCard className="h-4 w-4 text-muted-foreground" /> Employees Missing Statutory IDs
          </h2>
          {exceptions && (
            <div className="flex flex-wrap items-center gap-1.5">
              {exceptions.by_field.map(f => (
                <span key={f.field} className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', f.missing > 0 ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>
                  {f.label}: {f.missing}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {!exceptions ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : exceptions.employees.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-success">
              <CheckCircle2 className="h-6 w-6" />
              <p className="text-sm">All active employees have complete statutory IDs</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <div className="border-b border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {num(exceptions.summary.incomplete)} of {num(exceptions.summary.total_employees)} employees have missing identifiers
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                    <th className="p-2.5 font-medium">Code</th>
                    <th className="p-2.5 font-medium">Employee</th>
                    <th className="p-2.5 font-medium">Department</th>
                    <th className="p-2.5 font-medium">Missing</th>
                    <th className="p-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.employees.map(e => (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-2.5 tabular-nums text-muted-foreground">{e.employee_code}</td>
                      <td className="p-2.5 font-medium text-foreground">{e.name}</td>
                      <td className="p-2.5 text-foreground/80">{e.department}</td>
                      <td className="p-2.5">
                        <div className="flex flex-wrap gap-1">
                          {e.missing.map(m => (
                            <span key={m} className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">{m}</span>
                          ))}
                        </div>
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          onClick={go(`/admin/employees/${e.id}`)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                        >
                          Fix <ChevronRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
