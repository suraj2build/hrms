/**
 * PayrollExplainabilityPanel — /admin/payroll/runs/:runId/explain
 *
 * Per-employee payslip explainability powered entirely from immutable snapshots.
 *
 * Shows for each employee:
 *   - Net pay derivation (earnings, deductions, LOP line-by-line)
 *   - Attendance basis (payable days, LOP, OT)
 *   - Compensation basis (effective revision, CTC, structure)
 *   - Statutory rules applied (PF, ESI, PT, TDS)
 *   - Formula engine version + validation ruleset version
 *   - Snapshot integrity hash prefix
 *
 * This panel NEVER queries live mutable tables — it is a pure read of
 * payroll_employee_snapshots which were frozen at finalization time.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }   from 'react'
import { useParams, Link }     from 'react-router-dom'
import { useQuery }             from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, Loader2, Search,
  Shield, Database, Hash, CheckCircle2,
  FileText, TrendingDown, AlertTriangle,
  Users, Calendar,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { cn, formatCurrency as fmtCurrency, fmtDate } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentLine {
  code:            string
  name:            string
  component_type:  string
  monthly_amount:  number
  calc_type:       string
}

interface AttendanceSnap {
  payable_days:   number
  lop_days:       number
  overtime_hours: number
  present_days:   number
  late_days:      number
  has_data:       boolean
  hash:           string
}

interface CompensationSnap {
  compensation_id: string
  effective_from:  string
  ctc_annual:      number
  ctc_monthly:     number
  salary_structure: string | null
  components:      ComponentLine[]
  hash:            string
}

interface StatutorySnap {
  pf:  { enabled: boolean; employee_rate_pct: number; employer_rate_pct: number; wage_ceiling: number | null }
  esi: { enabled: boolean; employee_rate_pct: number; employer_rate_pct: number; wage_ceiling: number | null }
  pt:  { enabled: boolean; state: string | null; slabs: Array<{ from: number; to: number | null; amount: number }> }
  tds: { enabled: boolean; default_rate: number; regime: string }
  hash: string
}

interface FormulaSnap {
  engine_version:     number
  component_formulas: Array<{ code: string; calc_type: string; value: number; resolved: number }>
  hash:               string
}

interface ValidationSnap {
  engine_version: number
  rules:          Array<{ rule_code: string; severity: string; enabled: boolean }>
  hash:           string
}

interface EmployeeSnapshot {
  id:                    string
  employee_id:           string
  employee_code:         string
  employee_name:         string
  gross_pay:             number
  deductions:            number
  net_pay:               number
  payable_days:          number
  lop_days:              number
  overtime_hours:        number
  computed_at:           string
  attendance_snapshot:   AttendanceSnap
  compensation_snapshot: CompensationSnap
  component_snapshot:    { components: ComponentLine[]; hash: string }
  statutory_snapshot:    StatutorySnap
  formula_snapshot:      FormulaSnap
  validation_snapshot:   ValidationSnap
}

interface RunSnapshot {
  id:                       string
  run_id:                   string
  month:                    string
  snapshot_version:         number
  integrity_hash:           string
  formula_engine_version:   number
  validation_engine_version: number
  created_at:               string
  employee_count:           number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(m: string) {
  const s = m.slice(0,7) + '-01T12:00:00Z'
  const d = new Date(s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Pay Derivation Bar ─────────────────────────────────────────────────────────

function PayDerivationLine({ label, amount, type }: { label: string; amount: number; type: 'earning' | 'deduction' | 'employer' | 'net' }) {
  const isNet  = type === 'net'
  const isDed  = type === 'deduction'

  return (
    <div className={cn('flex items-center justify-between py-1.5 px-3', isNet && 'bg-foreground/5 rounded-md font-semibold mt-1')}>
      <span className={cn('text-xs', isDed ? 'text-destructive/80' : isNet ? 'text-foreground' : 'text-foreground/80')}>
        {isDed ? '−' : type === 'earning' ? '+' : type === 'employer' ? '~' : '='} {label}
      </span>
      <span className={cn('text-xs font-mono tabular-nums', isDed ? 'text-destructive' : isNet ? 'text-foreground font-semibold' : 'text-foreground/70')}>
        {isDed ? '-' : ''}{fmtCurrency(Math.abs(amount))}
      </span>
    </div>
  )
}

// ── Employee Explain Card ─────────────────────────────────────────────────────

function EmployeeExplainCard({ snap }: { snap: EmployeeSnapshot }) {
  const [expanded, setExpanded] = useState(false)

  const earnings   = snap.component_snapshot?.components?.filter(c => c.component_type === 'earning')  ?? []
  const deductions = snap.component_snapshot?.components?.filter(c => c.component_type === 'deduction') ?? []
  const employers  = snap.component_snapshot?.components?.filter(c => c.component_type === 'employer_contribution') ?? []
  const lopAmount  = snap.gross_pay - snap.deductions > 0
    ? Math.max(0, snap.gross_pay - (snap.gross_pay - (snap.deductions - deductions.reduce((s, c) => s + c.monthly_amount, 0))))
    : 0

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-muted/40 flex items-center justify-center text-xs font-bold text-muted-foreground">
            {(snap.employee_name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="text-left">
            <p className="text-sm font-medium">{snap.employee_name || '—'}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{snap.employee_code}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-muted-foreground">Net Pay</p>
            <p className="text-sm font-bold tabular-nums">{fmtCurrency(snap.net_pay)}</p>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-muted-foreground">Gross</p>
            <p className="text-sm tabular-nums text-muted-foreground">{fmtCurrency(snap.gross_pay)}</p>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-muted-foreground">Days</p>
            <p className="text-sm tabular-nums">{snap.payable_days}</p>
          </div>
          {snap.net_pay === 0 && <Badge variant="outline" className="text-warning border-warning/40 text-[9px] rounded-full">Zero Net</Badge>}
          {snap.lop_days > 0 && <Badge variant="outline" className="text-destructive border-destructive/40 text-[9px] rounded-full">LOP {snap.lop_days}d</Badge>}
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/5 p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Pay Derivation ── */}
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pay Derivation</p>

            {earnings.map(c => (
              <PayDerivationLine key={c.code} label={c.name} amount={c.monthly_amount} type="earning" />
            ))}

            {deductions.map(c => (
              <PayDerivationLine key={c.code} label={c.name} amount={c.monthly_amount} type="deduction" />
            ))}

            {snap.lop_days > 0 && (
              <PayDerivationLine label={`LOP (${snap.lop_days} days)`} amount={lopAmount} type="deduction" />
            )}

            <div className="border-t border-border/50 mt-1" />
            <PayDerivationLine label="Net Pay" amount={snap.net_pay} type="net" />

            {employers.length > 0 && (
              <>
                <div className="border-t border-border/50 mt-2 pt-1">
                  <p className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wide">Employer Contributions (not deducted)</p>
                  {employers.map(c => (
                    <PayDerivationLine key={c.code} label={c.name} amount={c.monthly_amount} type="employer" />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Attendance Basis ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Attendance Basis</p>

            <div className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-2 text-xs">
              {[
                { label: 'Payable days',    value: snap.attendance_snapshot?.payable_days   ?? snap.payable_days,   color: 'text-success' },
                { label: 'LOP days',        value: snap.attendance_snapshot?.lop_days        ?? snap.lop_days,       color: snap.lop_days > 0 ? 'text-destructive' : 'text-muted-foreground' },
                { label: 'Present days',    value: snap.attendance_snapshot?.present_days    ?? '—',                 color: '' },
                { label: 'Late days',       value: snap.attendance_snapshot?.late_days       ?? '—',                 color: snap.attendance_snapshot?.late_days > 0 ? 'text-warning' : '' },
                { label: 'Overtime hours',  value: snap.attendance_snapshot?.overtime_hours  ?? snap.overtime_hours, color: '' },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={cn('font-medium tabular-nums', row.color)}>{row.value}</span>
                </div>
              ))}
              <div className="border-t border-border/50 pt-1 flex justify-between">
                <span className="text-muted-foreground">Data present</span>
                <span>{snap.attendance_snapshot?.has_data ? <CheckCircle2 className="h-3 w-3 text-success" /> : <AlertTriangle className="h-3 w-3 text-warning" />}</span>
              </div>
            </div>

            {/* Compensation basis */}
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-3">Compensation Basis</p>
            <div className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-2 text-xs">
              {[
                { label: 'CTC Annual',      value: fmtCurrency(snap.compensation_snapshot?.ctc_annual ?? 0) },
                { label: 'CTC Monthly',     value: fmtCurrency(snap.compensation_snapshot?.ctc_monthly ?? 0) },
                { label: 'Effective from',  value: snap.compensation_snapshot?.effective_from ? fmtDate(snap.compensation_snapshot.effective_from) : '—' },
                { label: 'Structure',       value: snap.compensation_snapshot?.salary_structure ?? 'Default' },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium">{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Rules & Hashes ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rules Applied</p>

            {/* Statutory */}
            <div className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-1.5 text-xs">
              {snap.statutory_snapshot?.pf?.enabled && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                  <span>PF @ {snap.statutory_snapshot.pf.employee_rate_pct}% employee / {snap.statutory_snapshot.pf.employer_rate_pct}% employer{snap.statutory_snapshot.pf.wage_ceiling ? ` (ceiling ₹${snap.statutory_snapshot.pf.wage_ceiling})` : ''}</span>
                </div>
              )}
              {snap.statutory_snapshot?.esi?.enabled && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                  <span>ESI @ {snap.statutory_snapshot.esi.employee_rate_pct}% employee{snap.statutory_snapshot.esi.wage_ceiling ? ` (ceiling ₹${snap.statutory_snapshot.esi.wage_ceiling})` : ''}</span>
                </div>
              )}
              {snap.statutory_snapshot?.pt?.enabled && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                  <span>PT — {snap.statutory_snapshot.pt.state ?? 'state'} slab ({snap.statutory_snapshot.pt.slabs?.length ?? 0} slabs)</span>
                </div>
              )}
              {snap.statutory_snapshot?.tds?.enabled && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                  <span>TDS @ {snap.statutory_snapshot.tds.default_rate}% ({snap.statutory_snapshot.tds.regime} regime)</span>
                </div>
              )}
              {!snap.statutory_snapshot?.pf?.enabled && !snap.statutory_snapshot?.esi?.enabled && !snap.statutory_snapshot?.pt?.enabled && !snap.statutory_snapshot?.tds?.enabled && (
                <p className="text-muted-foreground">No statutory deductions enabled</p>
              )}
            </div>

            {/* Validation ruleset */}
            <div className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Validation ruleset</span>
                <span className="font-mono text-[10px]">v{snap.validation_snapshot?.engine_version ?? 1}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active rules</span>
                <span className="font-mono text-[10px]">{snap.validation_snapshot?.rules?.filter(r => r.enabled).length ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Formula engine</span>
                <span className="font-mono text-[10px]">v{snap.formula_snapshot?.engine_version ?? 1}</span>
              </div>
            </div>

            {/* Integrity hashes */}
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 mt-2">Snapshot Hashes</p>
            <div className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-1.5 text-[9px] font-mono">
              {[
                { label: 'Attendance',    hash: snap.attendance_snapshot?.hash },
                { label: 'Compensation',  hash: snap.compensation_snapshot?.hash },
                { label: 'Statutory',     hash: snap.statutory_snapshot?.hash },
                { label: 'Formula',       hash: snap.formula_snapshot?.hash },
                { label: 'Validation',    hash: snap.validation_snapshot?.hash },
              ].map(h => (
                <div key={h.label} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{h.label}</span>
                  <span className="text-muted-foreground/60 truncate" title={h.hash ?? '—'}>{h.hash ? h.hash.slice(0, 10) + '…' : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollExplainabilityPanel() {
  const { runId } = useParams<{ runId: string }>()
  const [search, setSearch] = useState('')

  // Fetch snapshot manifest
  const { data: snapshotRaw, isLoading: snapLoading } = useQuery<{ data: RunSnapshot }>({
    queryKey: ['run-snapshot', runId],
    queryFn:  () => api.get(`/payroll/runs/${runId}/snapshot`),
    enabled:  !!runId,
    staleTime: 120_000,
  })
  const snapshot = snapshotRaw?.data ?? null

  // Fetch all employee snapshots — the endpoint caps `limit` at 100 (zod
  // `max(100)`), so a run with more employees requires paging through with
  // `offset` rather than requesting a single oversized page (which the
  // backend would reject outright with a 400).
  const { data: empRaw, isLoading: empLoading } = useQuery<{ data: EmployeeSnapshot[]; total: number }>({
    queryKey: ['snapshot-employees', runId],
    queryFn:  async () => {
      const pageSize = 100
      let offset = 0
      let total = 0
      const all: EmployeeSnapshot[] = []
      do {
        const page = await api.get<{ data: EmployeeSnapshot[]; total: number }>(
          `/payroll/runs/${runId}/snapshot/employees?limit=${pageSize}&offset=${offset}`,
        )
        all.push(...page.data)
        total = page.total
        offset += pageSize
      } while (offset < total)
      return { data: all, total }
    },
    enabled:  !!runId && !!snapshot,
    staleTime: 120_000,
  })
  const allEmps  = useMemo(() => empRaw?.data ?? [], [empRaw])
  const totalEmp = empRaw?.total ?? 0

  const isLoading = snapLoading || empLoading

  // Filter
  const filteredEmps = useMemo(() => {
    if (!search.trim()) return allEmps
    const q = search.toLowerCase()
    return allEmps.filter(e =>
      (e.employee_name ?? '').toLowerCase().includes(q) ||
      (e.employee_code ?? '').toLowerCase().includes(q),
    )
  }, [allEmps, search])

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Explainability"
        subtitle="Powered entirely from immutable snapshots — no live table reads"
        breadcrumb={[
          { label: 'Payroll', href: '/admin/payroll' },
          { label: 'Forensics', href: '/admin/payroll/forensics' },
          { label: 'Explainability' },
        ]}
        actions={
          <Link to="/admin/payroll/forensics">
            <Button size="sm" variant="outline">← Back to Forensics</Button>
          </Link>
        }
      />

      {/* Snapshot summary banner */}
      {snapshot && (
        <div className="mb-4 flex flex-wrap items-center gap-4 px-4 py-3 rounded-xl border border-info/30 bg-info/5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-info" />
            <span className="text-sm font-medium">{fmtMonth(snapshot.month)}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{snapshot.employee_count} employees</span>
            <span className="flex items-center gap-1"><Shield className="h-3 w-3" />Snapshot v{snapshot.snapshot_version}</span>
            <span className="flex items-center gap-1"><FileText className="h-3 w-3" />Formula engine v{snapshot.formula_engine_version}</span>
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Captured {fmtDate(snapshot.created_at)}</span>
            <span className="flex items-center gap-1 font-mono"><Hash className="h-3 w-3" />{snapshot.integrity_hash?.slice(0, 10) ?? '—'}…</span>
          </div>
        </div>
      )}

      {!snapshot && !isLoading && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5">
          <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-warning">No snapshot available</p>
            <p className="text-xs text-muted-foreground mt-0.5">This run was finalized before the snapshot engine was deployed. Explainability is not available for pre-snapshot runs.</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-9 text-xs"
          placeholder="Search employee name or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Employee list */}
      <SectionCard
        title={`Employee Payslip Explainability (${filteredEmps.length} of ${totalEmp})`}
        icon={<TrendingDown className="h-4 w-4" />}
        description="Expand any row to see the full pay derivation, attendance basis, compensation, statutory rules, and snapshot hashes"
      >
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />Loading employee snapshots…
            </div>
          ) : filteredEmps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-muted-foreground">
              <Database className="h-8 w-8 opacity-30" />
              <p className="text-sm">{search ? 'No employees match your search' : 'No employee snapshots found'}</p>
            </div>
          ) : (
            filteredEmps.map(snap => <EmployeeExplainCard key={snap.employee_id} snap={snap} />)
          )}
        </div>
      </SectionCard>

      {/* Immutability notice */}
      <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/20 border border-border/50">
        <Shield className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-[10px] text-muted-foreground">
          All data on this page is read from <strong>payroll_employee_snapshots</strong> — immutable blobs frozen at finalization time.
          No live compensation, attendance, statutory config, or formula data is queried.
          Snapshot integrity hash: <code className="font-mono">{snapshot?.integrity_hash?.slice(0, 16) ?? '—'}…</code>
        </p>
      </div>
    </PageContainer>
  )
}
