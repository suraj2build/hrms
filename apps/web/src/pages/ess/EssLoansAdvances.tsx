/**
 * EssLoansAdvances — /ess/loans
 *
 * Employee self-service page for salary advance and loan requests.
 * Flow: Employee applies → Manager approves → HR final approval → Deductions start
 */

import { useState }         from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, ChevronDown, ChevronRight, Wallet, CreditCard,
  Clock, CheckCircle, XCircle, AlertCircle, Loader2,
  CalendarDays, TrendingDown,
} from 'lucide-react'
import { cn }               from '@/lib/utils'
import { api }              from '@/lib/api/client'
import { Input }            from '@/components/ui/input'
import { Button }           from '@/components/ui/button'
import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { ApprovalChainStepper } from '@/components/approvals/ApprovalChainStepper'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdvanceRequest {
  id:               string
  requested_amount: number
  approved_amount:  number | null
  purpose:          string
  recovery_months:  number
  status:           string
  requested_date:   string
  submitted_via_ess: boolean
}

interface LoanRequest {
  id:                 string
  loan_type:          string
  principal_amount:   number
  disbursed_amount:   number | null
  interest_rate_pct:  number
  tenure_months:      number
  emi_amount:         number
  outstanding_balance: number
  status:             string
  purpose:            string | null
  first_emi_month:    string | null
  submitted_via_ess:  boolean
}

interface RecoverySchedule {
  id:               string
  recovery_month:   string
  scheduled_amount: number
  status:           string
}

interface LoanSchedule {
  id:                  string
  installment_number:  number
  due_month:           string
  emi_amount:          number
  principal_component: number
  interest_component:  number
  outstanding_balance: number
  status:              string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LOAN_TYPES = ['personal', 'housing', 'vehicle', 'education', 'emergency', 'other'] as const

function fmtINR(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function computeEMI(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return Math.round((principal / months) * 100) / 100
  const r = annualRate / 100 / 12
  return Math.round((principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1) * 100) / 100
}

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pending_manager: { label: 'Pending Manager',  color: 'text-warning bg-warning/10 border-warning/30',   Icon: Clock         },
  pending_hr:      { label: 'Pending HR',       color: 'text-info bg-info/10 border-info/30',         Icon: Clock         },
  pending:         { label: 'Pending HR',       color: 'text-info bg-info/10 border-info/30',         Icon: Clock         },
  approved:        { label: 'Approved',         color: 'text-success bg-success/10 border-success/30',      Icon: CheckCircle   },
  rejected:        { label: 'Rejected',         color: 'text-destructive bg-destructive/10 border-destructive/30',            Icon: XCircle       },
  disbursed:       { label: 'Disbursed',        color: 'text-primary bg-primary/10 border-primary/30',   Icon: CheckCircle   },
  recovering:      { label: 'Recovering',       color: 'text-accent-violet bg-accent-violet/10 border-accent-violet/30',   Icon: TrendingDown  },
  fully_recovered: { label: 'Fully Recovered',  color: 'text-muted-foreground bg-muted border-border',      Icon: CheckCircle   },
  active:          { label: 'Active — EMI',     color: 'text-accent-violet bg-accent-violet/10 border-accent-violet/30',   Icon: TrendingDown  },
  foreclosed:      { label: 'Foreclosed',       color: 'text-muted-foreground bg-muted border-border',      Icon: CheckCircle   },
  completed:       { label: 'Completed',        color: 'text-muted-foreground bg-muted border-border',      Icon: CheckCircle   },
  cancelled:       { label: 'Cancelled',        color: 'text-destructive bg-destructive/10 border-destructive/20',            Icon: XCircle       },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: 'text-muted-foreground bg-muted border-border', Icon: AlertCircle }
  const { Icon } = cfg
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.color)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  )
}

const WORKFLOW_STEPS = [
  { key: ['pending_manager'],                 label: 'Manager Review'  },
  { key: ['pending_hr', 'pending'],           label: 'HR Review'       },
  { key: ['approved'],                        label: 'Approved'        },
  { key: ['disbursed', 'active', 'recovering', 'fully_recovered', 'completed', 'foreclosed'], label: 'Active' },
]

function WorkflowTracker({ status }: { status: string }) {
  const currentStep = WORKFLOW_STEPS.findIndex(s => s.key.includes(status))
  const isRejected = status === 'rejected' || status === 'cancelled'

  if (isRejected) {
    return (
      <div className="flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        <span>Request rejected</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {WORKFLOW_STEPS.map((step, idx) => {
        const done    = currentStep > idx
        const current = currentStep === idx
        return (
          <div key={step.label} className="flex items-center gap-1">
            {idx > 0 && <div className={cn('h-px w-4 flex-shrink-0', done ? 'bg-primary' : 'bg-border')} />}
            <div className={cn(
              'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium border',
              done    ? 'bg-primary/10 border-primary/30 text-primary'         :
              current ? 'bg-primary text-primary-foreground border-primary'    :
                        'bg-muted border-border text-muted-foreground',
            )}>
              {done && <CheckCircle className="h-2 w-2" />}
              {step.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── New Advance Dialog ────────────────────────────────────────────────────────

function NewAdvanceForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount]     = useState('')
  const [months, setMonths]     = useState('3')
  const [purpose, setPurpose]   = useState('')

  const monthly = amount && months ? fmtINR(Math.round(Number(amount) / Number(months))) : '—'

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/ess/advances', {
      requested_amount: Number(amount),
      recovery_months:  Number(months),
      purpose,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ess-advances'] })
      onClose()
    },
  })

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Request Salary Advance</p>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Amount (₹)</label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" className="mt-0.5" />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Recovery months (1–12)</label>
          <Input type="number" min={1} max={12} value={months} onChange={e => setMonths(e.target.value)} className="mt-0.5" />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Purpose</label>
        <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Medical emergency, travel, education…" className="mt-0.5" />
      </div>

      {amount && months && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Monthly deduction: <span className="font-semibold text-foreground">{monthly}</span> × {months} months
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          onClick={() => mutation.mutate()}
          disabled={!amount || !months || !purpose || mutation.isPending}
          size="sm"
          className="flex-1"
        >
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Submit Request'}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-destructive">{(mutation.error instanceof Error ? mutation.error.message : null) ?? 'Failed to submit'}</p>
      )}
    </div>
  )
}

// ── New Loan Form ──────────────────────────────────────────────────────────────

function NewLoanForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [loanType, setLoanType] = useState<string>('personal')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate]           = useState('0')
  const [tenure, setTenure]       = useState('12')
  const [purpose, setPurpose]     = useState('')

  const p = Number(principal), r = Number(rate), t = Number(tenure)
  const emi = p && t ? computeEMI(p, r, t) : 0
  const totalInterest = emi && t ? Math.max(0, Math.round((emi * t - p) * 100) / 100) : 0

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/ess/loans', {
      loan_type:         loanType,
      principal_amount:  p,
      interest_rate_pct: r,
      tenure_months:     t,
      purpose:           purpose || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ess-loans'] })
      onClose()
    },
  })

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Request a Loan</p>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Loan type</label>
          <select
            value={loanType}
            onChange={e => setLoanType(e.target.value)}
            className="mt-0.5 w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            {LOAN_TYPES.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Principal (₹)</label>
          <Input type="number" value={principal} onChange={e => setPrincipal(e.target.value)} placeholder="100000" className="mt-0.5" />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Interest rate (% p.a.)</label>
          <Input type="number" min={0} max={36} step={0.1} value={rate} onChange={e => setRate(e.target.value)} placeholder="0 for interest-free" className="mt-0.5" />
        </div>
        <div>
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tenure (months)</label>
          <Input type="number" min={1} max={120} value={tenure} onChange={e => setTenure(e.target.value)} className="mt-0.5" />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Purpose (optional)</label>
        <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Vehicle purchase, home repair…" className="mt-0.5" />
      </div>

      {emi > 0 && (
        <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 px-3 py-2">
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Monthly EMI</p>
            <p className="text-sm font-bold text-foreground">{fmtINR(emi)}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Total Interest</p>
            <p className="text-sm font-semibold text-foreground">{fmtINR(totalInterest)}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Total Payable</p>
            <p className="text-sm font-semibold text-foreground">{fmtINR(Math.round(emi * t * 100) / 100)}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          onClick={() => mutation.mutate()}
          disabled={!principal || !tenure || mutation.isPending}
          size="sm"
          className="flex-1"
        >
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Submit Request'}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-destructive">{(mutation.error instanceof Error ? mutation.error.message : null) ?? 'Failed to submit'}</p>
      )}
    </div>
  )
}

// ── Advance Schedule Row ──────────────────────────────────────────────────────

function AdvanceScheduleRow({ advanceId }: { advanceId: string }) {
  const { data } = useQuery<{ data: RecoverySchedule[] }>({
    queryKey: ['ess-advance-schedule', advanceId],
    queryFn: () => api.get(`/payroll/ess/my-advances/${advanceId}/schedule`),
  })
  const schedules = data?.data ?? []
  if (schedules.length === 0) return <p className="text-xs text-muted-foreground p-2">No schedule yet</p>

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs border-collapse mt-1">
        <thead>
          <tr className="border-b border-border/60">
            <th className="p-1.5 text-left font-medium text-muted-foreground">Month</th>
            <th className="p-1.5 text-right font-medium text-muted-foreground">Amount</th>
            <th className="p-1.5 text-center font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map(s => (
            <tr key={s.id} className="border-b border-border/30">
              <td className="p-1.5 text-foreground">{s.recovery_month}</td>
              <td className="p-1.5 text-right tabular-nums text-foreground">{fmtINR(s.scheduled_amount)}</td>
              <td className="p-1.5 text-center">
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                  s.status === 'recovered' ? 'bg-success/15 text-success' :
                  s.status === 'pending'   ? 'bg-info/15 text-info'   :
                                            'bg-muted text-muted-foreground',
                )}>
                  {s.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Loan Schedule Row ─────────────────────────────────────────────────────────

function LoanScheduleRow({ loanId }: { loanId: string }) {
  const { data } = useQuery<{ data: LoanSchedule[] }>({
    queryKey: ['ess-loan-schedule', loanId],
    queryFn: () => api.get(`/payroll/ess/my-loans/${loanId}/schedule`),
  })
  const schedules = data?.data ?? []
  if (schedules.length === 0) return <p className="text-xs text-muted-foreground p-2">Schedule will appear after disbursement</p>

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs border-collapse mt-1">
        <thead>
          <tr className="border-b border-border/60">
            <th className="p-1.5 text-center font-medium text-muted-foreground">#</th>
            <th className="p-1.5 text-left font-medium text-muted-foreground">Month</th>
            <th className="p-1.5 text-right font-medium text-muted-foreground">EMI</th>
            <th className="p-1.5 text-right font-medium text-muted-foreground">Principal</th>
            <th className="p-1.5 text-right font-medium text-muted-foreground">Interest</th>
            <th className="p-1.5 text-right font-medium text-muted-foreground">Balance</th>
            <th className="p-1.5 text-center font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map(s => (
            <tr key={s.id} className="border-b border-border/30">
              <td className="p-1.5 text-center text-muted-foreground">{s.installment_number}</td>
              <td className="p-1.5 text-foreground">{s.due_month}</td>
              <td className="p-1.5 text-right tabular-nums">{fmtINR(s.emi_amount)}</td>
              <td className="p-1.5 text-right tabular-nums text-foreground">{fmtINR(s.principal_component)}</td>
              <td className="p-1.5 text-right tabular-nums text-muted-foreground">{fmtINR(s.interest_component)}</td>
              <td className="p-1.5 text-right tabular-nums text-muted-foreground">{fmtINR(s.outstanding_balance)}</td>
              <td className="p-1.5 text-center">
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                  s.status === 'paid'    ? 'bg-success/15 text-success' :
                  s.status === 'pending' ? 'bg-info/15 text-info'   :
                                          'bg-muted text-muted-foreground',
                )}>
                  {s.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Advance Card ──────────────────────────────────────────────────────────────

function AdvanceCard({ advance }: { advance: AdvanceRequest }) {
  const [expanded, setExpanded] = useState(false)
  const showSchedule = ['disbursed', 'recovering', 'fully_recovered'].includes(advance.status)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Wallet className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">
              Salary Advance — {fmtINR(advance.requested_amount)}
            </p>
            <StatusBadge status={advance.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{advance.purpose}</p>
          <div className="mt-1.5">
            <WorkflowTracker status={advance.status} />
          </div>
          <ApprovalChainStepper entityType="advance_salary" entityId={advance.id} className="mt-1.5" />
          <div className="flex items-center gap-4 mt-1.5 text-[10px] text-muted-foreground">
            <span>Applied {advance.requested_date}</span>
            <span>Recovery: {advance.recovery_months} months</span>
            {advance.approved_amount && <span>Approved: {fmtINR(advance.approved_amount)}</span>}
          </div>
        </div>
        {showSchedule && (
          <button
            onClick={() => setExpanded(p => !p)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
      {expanded && showSchedule && (
        <div className="border-t border-border/60 px-3 pb-2 pt-1">
          <AdvanceScheduleRow advanceId={advance.id} />
        </div>
      )}
    </div>
  )
}

// ── Loan Card ─────────────────────────────────────────────────────────────────

function LoanCard({ loan }: { loan: LoanRequest }) {
  const [expanded, setExpanded] = useState(false)
  const showSchedule = ['active', 'disbursed', 'foreclosed', 'completed'].includes(loan.status)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-2.5 flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
          <CreditCard className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">
              {cap(loan.loan_type)} Loan — {fmtINR(loan.principal_amount)}
            </p>
            <StatusBadge status={loan.status} />
          </div>
          {loan.purpose && <p className="text-xs text-muted-foreground mt-0.5 truncate">{loan.purpose}</p>}
          <div className="mt-1.5">
            <WorkflowTracker status={loan.status} />
          </div>
          <ApprovalChainStepper entityType="employee_loan" entityId={loan.id} className="mt-1.5" />
          <div className="flex items-center gap-4 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
            <span>{loan.tenure_months}mo · {loan.interest_rate_pct}% p.a.</span>
            <span>EMI: {fmtINR(loan.emi_amount)}/mo</span>
            {['active', 'disbursed'].includes(loan.status) && (
              <span>Outstanding: {fmtINR(loan.outstanding_balance)}</span>
            )}
            {loan.first_emi_month && <span>First EMI: {loan.first_emi_month}</span>}
          </div>
        </div>
        {showSchedule && (
          <button
            onClick={() => setExpanded(p => !p)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
      {expanded && showSchedule && (
        <div className="border-t border-border/60 px-3 pb-2 pt-1">
          <LoanScheduleRow loanId={loan.id} />
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function EssLoansAdvances() {
  const [showAdvanceForm, setShowAdvanceForm] = useState(false)
  const [showLoanForm, setShowLoanForm]       = useState(false)
  const [tab, setTab]                         = useState<'advances' | 'loans'>('advances')

  const { data: advancesData, isLoading: advLoading } = useQuery<{ data: AdvanceRequest[] }>({
    queryKey: ['ess-advances'],
    queryFn:  () => api.get('/payroll/ess/my-advances'),
  })

  const { data: loansData, isLoading: loanLoading } = useQuery<{ data: LoanRequest[] }>({
    queryKey: ['ess-loans'],
    queryFn:  () => api.get('/payroll/ess/my-loans'),
  })

  const advances = advancesData?.data ?? []
  const loans    = loansData?.data    ?? []

  const activeAdvances = advances.filter(a => ['disbursed', 'recovering'].includes(a.status)).length
  const activeLoans    = loans.filter(l => l.status === 'active').length
  const pendingCount   = advances.filter(a => ['pending_manager', 'pending_hr', 'pending'].includes(a.status)).length
                       + loans.filter(l => ['pending_manager', 'pending_hr', 'pending'].includes(l.status)).length
  const monthlyEMI     = loans.filter(l => l.status === 'active').reduce((s, l) => s + l.emi_amount, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Loans & Advances"
        subtitle="Apply for salary advances and loans — deductions are handled automatically through payroll"
        breadcrumb={[{ label: 'Loans & Advances' }]}
      />

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {[
          { label: 'Pending Approval', value: String(pendingCount), icon: Clock, color: 'text-warning bg-warning/10' },
          { label: 'Active Advances',  value: String(activeAdvances), icon: Wallet, color: 'text-info bg-info/10' },
          { label: 'Active Loans',     value: String(activeLoans),    icon: CreditCard, color: 'text-accent-violet bg-accent-violet/10' },
          { label: 'Monthly EMI',      value: monthlyEMI > 0 ? `₹${monthlyEMI.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—', icon: CalendarDays, color: 'text-primary bg-primary/10' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-center gap-2.5">
            <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md', color)}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
              <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Info banner ───────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <p>
          Your request is reviewed by your manager first, then by HR. Once approved and disbursed, deductions are
          automatically applied to your monthly payslip under <strong>Deductions</strong>.
        </p>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        {(['advances', 'loans'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
              tab === t ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'advances' ? `Salary Advances (${advances.length})` : `Loans (${loans.length})`}
          </button>
        ))}
      </div>

      {tab === 'advances' && (
        <div className="space-y-3">
          {!showAdvanceForm && (
            <button
              onClick={() => { setShowAdvanceForm(true); setShowLoanForm(false) }}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-primary/50 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Request a new salary advance
            </button>
          )}
          {showAdvanceForm && <NewAdvanceForm onClose={() => setShowAdvanceForm(false)} />}

          {advLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : advances.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <Wallet className="h-6 w-6 opacity-30" />
              <p className="text-sm">No advance requests yet</p>
            </div>
          ) : (
            advances.map(a => <AdvanceCard key={a.id} advance={a} />)
          )}
        </div>
      )}

      {tab === 'loans' && (
        <div className="space-y-3">
          {!showLoanForm && (
            <button
              onClick={() => { setShowLoanForm(true); setShowAdvanceForm(false) }}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-primary/50 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Request a new loan
            </button>
          )}
          {showLoanForm && <NewLoanForm onClose={() => setShowLoanForm(false)} />}

          {loanLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : loans.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <CreditCard className="h-6 w-6 opacity-30" />
              <p className="text-sm">No loan requests yet</p>
            </div>
          ) : (
            loans.map(l => <LoanCard key={l.id} loan={l} />)
          )}
        </div>
      )}
    </PageContainer>
  )
}
