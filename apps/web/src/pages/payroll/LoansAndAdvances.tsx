/**
 * LoansAndAdvances — /admin/payroll/advances
 *
 * Unified HR management center for salary advances and employee loans.
 * Replaces AdvanceSalary.tsx and LoanManagement.tsx.
 *
 * Tabs:
 *   Advances      — request lifecycle, recovery schedule, pause/resume
 *   Loans         — loan lifecycle, amortization schedule, foreclose
 *   Recovery Calendar — month-by-month deduction preview
 */

import { useState, useMemo }                        from 'react'
import { useQuery, useMutation, useQueryClient }    from '@tanstack/react-query'
import {
  Loader2, Plus, RefreshCw, CheckCircle2, XCircle,
  DollarSign, ChevronDown, ChevronRight, Banknote,
  CalendarClock, TrendingDown, Pause, Play, AlertTriangle,
  Landmark, CreditCard, Calculator, Users, ArrowRight,
} from 'lucide-react'
import { cn }                    from '@/lib/utils'
import { SubTabs }               from '@/components/ui/SubTabs'
import { api }                   from '@/lib/api/client'
import { useAuthStore }          from '@/stores/authStore'
import { PageContainer }         from '@/components/layout/PageContainer'
import { PageHeader }            from '@/components/layout/PageHeader'
import { Button }                from '@/components/ui/button'
import { Badge }                 from '@/components/ui/badge'
import { Input }                 from '@/components/ui/input'
import { DateInput }             from '@/components/ui/date-input'
import { EmployeeSelector }      from '@/components/filters/EmployeeSelector'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdvanceRequest {
  id:                 string
  employee_id:        string
  requested_amount:   number
  approved_amount:    number | null
  recovery_months:    number
  purpose:            string | null
  status:             string
  is_recovery_paused: boolean
  disbursed_date:     string | null
  disbursed_amount:   number | null
  created_at:         string
  employees?: { first_name: string; last_name: string; employee_code: string }
}

interface RecoverySchedule {
  id:               string
  advance_id:       string
  recovery_month:   string
  scheduled_amount: number
  actual_amount:    number | null
  status:           string
  payroll_run_id:   string | null
  recovered_at:     string | null
}

interface EmployeeLoan {
  id:                  string
  employee_id:         string
  loan_type:           string
  principal_amount:    number
  interest_rate_pct:   number
  tenure_months:       number
  emi_amount:          number
  disbursed_date:      string | null
  first_emi_month:     string | null
  status:              string
  is_emi_paused:       boolean
  outstanding_balance: number
  foreclosure_amount:  number | null
  created_at:          string
  employees?: { first_name: string; last_name: string; employee_code: string }
}

interface LoanSchedule {
  id:                  string
  loan_id:             string
  installment_number:  number
  due_month:           string
  emi_amount:          number
  principal_component: number
  interest_component:  number
  outstanding_balance: number
  status:              string
  paid_at:             string | null
  payroll_run_id:      string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const dt = new Date(d.length === 10 ? `${d}T12:00:00Z` : d)
  if (isNaN(dt.getTime())) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

function empName(row: Pick<AdvanceRequest | EmployeeLoan, 'employees' | 'employee_id'>) {
  if (row.employees) return `${row.employees.first_name} ${row.employees.last_name}`
  return row.employee_id.slice(0, 8)
}

function empCode(row: Pick<AdvanceRequest | EmployeeLoan, 'employees'>) {
  return row.employees?.employee_code ?? null
}

function computeEMI(principal: number, annualRate: number, months: number): number {
  if (!principal || !months) return 0
  if (annualRate === 0) return Math.round((principal / months) * 100) / 100
  const r = annualRate / 100 / 12
  return Math.round((principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1) * 100) / 100
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const ADV_STATUS_BADGE: Record<string, string> = {
  pending:         'bg-amber-50 text-amber-700 border-amber-200',
  approved:        'bg-blue-50 text-blue-700 border-blue-200',
  rejected:        'bg-red-50 text-red-700 border-red-200',
  disbursed:       'bg-indigo-50 text-indigo-700 border-indigo-200',
  recovering:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  fully_recovered: 'bg-slate-50 text-slate-600 border-slate-200',
  cancelled:       'bg-slate-50 text-slate-500 border-slate-200',
}

const LOAN_STATUS_BADGE: Record<string, string> = {
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  approved:   'bg-blue-50 text-blue-700 border-blue-200',
  rejected:   'bg-red-50 text-red-700 border-red-200',
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  disbursed:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  foreclosed: 'bg-orange-50 text-orange-700 border-orange-200',
  completed:  'bg-slate-50 text-slate-600 border-slate-200',
  cancelled:  'bg-slate-50 text-slate-500 border-slate-200',
}

const SCHED_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  recovered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paid:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  skipped:   'bg-slate-50 text-slate-500 border-slate-200',
  adjusted:  'bg-slate-50 text-slate-500 border-slate-200',
}

function StatusPill({ status, map }: { status: string; map: Record<string, string> }) {
  const cls = map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200'
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border', cls)}>
      {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
    </span>
  )
}

function PayrollBadge({ active }: { active: boolean }) {
  if (!active) return <span className="text-[11px] text-muted-foreground">Manual</span>
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
      <TrendingDown className="h-2.5 w-2.5" /> Auto
    </span>
  )
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1 leading-none">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0', accent)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

// ── Approve Advance Dialog ─────────────────────────────────────────────────────

function ApproveAdvanceDialog({
  open, advance, onClose,
}: {
  open: boolean; advance: AdvanceRequest | null; onClose: () => void
}) {
  const qc = useQueryClient()
  const [approvedAmount, setApprovedAmount] = useState('')
  const [recoveryMonths, setRecoveryMonths] = useState('3')

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/advances/${advance!.id}/approve`, {
      approved_amount: Number(approvedAmount),
      recovery_months: Number(recoveryMonths),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      onClose()
      toast.success('Advance approved', {
        description: `${fmtINR(Number(approvedAmount))} over ${recoveryMonths} months`,
      })
    },
    onError: (e: Error) => toast.error('Approval failed', { description: e.message }),
  })

  const monthly = approvedAmount && recoveryMonths
    ? fmtINR(Math.round(Number(approvedAmount) / Number(recoveryMonths)))
    : null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Approve Advance Request</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          {advance && (
            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <p className="font-medium">{empName(advance)}</p>
              <p className="text-muted-foreground mt-0.5">Requested: {fmtINR(advance.requested_amount)}</p>
              {advance.purpose && <p className="text-muted-foreground mt-0.5">Purpose: {advance.purpose}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Approved Amount (₹)</label>
              <Input type="number" value={approvedAmount}
                onChange={e => setApprovedAmount(e.target.value)}
                placeholder={advance ? String(advance.requested_amount) : ''} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Recovery Months</label>
              <Input type="number" min={1} max={24} value={recoveryMonths}
                onChange={e => setRecoveryMonths(e.target.value)} />
            </div>
          </div>
          {monthly && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <Calculator className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
              Monthly deduction from salary: <span className="font-semibold text-blue-700 dark:text-blue-400 ml-1">{monthly}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()}
              disabled={!approvedAmount || !recoveryMonths || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve & Schedule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Reject Dialog ──────────────────────────────────────────────────────────────

function RejectDialog({
  open, id, type, onClose,
}: {
  open: boolean; id: string; type: 'advance' | 'loan'; onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(
      `/payroll/${type === 'advance' ? 'advances' : 'loans'}/${id}/reject`,
      { rejection_reason: reason },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [type === 'advance' ? 'advances' : 'loans'] })
      onClose()
      setReason('')
      toast.success(`${type === 'advance' ? 'Advance' : 'Loan'} request rejected`)
    },
    onError: (e: Error) => toast.error('Rejection failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {type === 'advance' ? 'Advance' : 'Loan'} Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reason for rejection</label>
            <Input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Enter reason…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => mutation.mutate()}
              disabled={!reason.trim() || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Disburse Advance Dialog ────────────────────────────────────────────────────

function DisburseAdvanceDialog({
  open, advance, onClose,
}: {
  open: boolean; advance: AdvanceRequest | null; onClose: () => void
}) {
  const qc = useQueryClient()
  const [disbursedDate, setDisbursedDate] = useState('')
  const [disbursedAmount, setDisbursedAmount] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/advances/${advance!.id}/disburse`, {
      disbursed_date: disbursedDate,
      disbursed_amount: Number(disbursedAmount),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      onClose()
      toast.success('Advance disbursed')
    },
    onError: (e: Error) => toast.error('Disbursal failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Mark Advance as Disbursed</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          {advance && (
            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <p className="font-medium">{empName(advance)}</p>
              <p className="text-muted-foreground mt-0.5">Approved: {fmtINR(advance.approved_amount ?? 0)}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Disbursement Date</label>
            <DateInput value={disbursedDate} onChange={setDisbursedDate} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Disbursed Amount (₹)</label>
            <Input type="number" value={disbursedAmount}
              onChange={e => setDisbursedAmount(e.target.value)}
              placeholder={advance?.approved_amount ? String(advance.approved_amount) : ''} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()}
              disabled={!disbursedDate || !disbursedAmount || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Disbursement
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── New Advance Dialog ─────────────────────────────────────────────────────────

function NewAdvanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [recoveryMonths, setRecoveryMonths] = useState('3')

  const monthly = amount && recoveryMonths
    ? fmtINR(Math.round(Number(amount) / Number(recoveryMonths)))
    : null

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/advances', {
      employee_id: employeeId,
      requested_amount: Number(amount),
      purpose,
      recovery_months: Number(recoveryMonths),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      onClose()
      setEmployeeId(''); setAmount(''); setPurpose(''); setRecoveryMonths('3')
      toast.success('Advance request created')
    },
    onError: (e: Error) => toast.error('Failed to create advance', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Salary Advance</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Employee</label>
            <EmployeeSelector
              value={employeeId}
              onChange={v => setEmployeeId(v as string)}
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount (₹)</label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Recovery Months</label>
              <Input type="number" min={1} max={24} value={recoveryMonths}
                onChange={e => setRecoveryMonths(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Purpose</label>
            <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Medical emergency, travel…" />
          </div>
          {monthly && (
            <div className="flex items-center gap-2 text-sm bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <Calculator className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
              <span className="text-muted-foreground">Monthly deduction:</span>
              <span className="font-semibold text-blue-700 dark:text-blue-400">{monthly}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()}
              disabled={!employeeId || !amount || !recoveryMonths || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── New Loan Dialog ────────────────────────────────────────────────────────────

const LOAN_TYPES = ['personal', 'housing', 'vehicle', 'education', 'emergency', 'other']

function NewLoanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [loanType, setLoanType] = useState('personal')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [tenure, setTenure] = useState('')
  const [purpose, setPurpose] = useState('')

  const emi = useMemo(() => {
    const p = Number(principal); const r = Number(rate); const t = Number(tenure)
    if (!p || !t) return null
    return computeEMI(p, r || 0, t)
  }, [principal, rate, tenure])

  const totalPayable = emi && tenure ? emi * Number(tenure) : null
  const totalInterest = totalPayable && principal ? totalPayable - Number(principal) : null

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/loans', {
      employee_id: employeeId,
      loan_type: loanType,
      principal_amount: Number(principal),
      interest_rate_pct: Number(rate) || 0,
      tenure_months: Number(tenure),
      purpose,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      onClose()
      setEmployeeId(''); setPrincipal(''); setRate(''); setTenure(''); setPurpose('')
      toast.success('Loan request created')
    },
    onError: (e: Error) => toast.error('Failed to create loan', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Employee Loan</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Employee</label>
            <EmployeeSelector value={employeeId} onChange={v => setEmployeeId(v as string)} className="w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Loan Type</label>
              <select value={loanType} onChange={e => setLoanType(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm">
                {LOAN_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Principal (₹)</label>
              <Input type="number" value={principal} onChange={e => setPrincipal(e.target.value)} placeholder="100000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Interest Rate % p.a.</label>
              <Input type="number" min={0} max={36} step={0.1} value={rate}
                onChange={e => setRate(e.target.value)} placeholder="0 for interest-free" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tenure (months)</label>
              <Input type="number" min={1} max={120} value={tenure}
                onChange={e => setTenure(e.target.value)} placeholder="12" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Purpose (optional)</label>
            <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Vehicle purchase, home repair…" />
          </div>

          {/* Live EMI calculator */}
          {emi !== null && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                <Calculator className="h-3.5 w-3.5" /> Loan Calculator
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">Monthly EMI</p>
                  <p className="text-sm font-bold text-foreground">{fmtINR(emi)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Total Interest</p>
                  <p className="text-sm font-bold text-foreground">{totalInterest !== null ? fmtINR(totalInterest) : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Total Payable</p>
                  <p className="text-sm font-bold text-foreground">{totalPayable !== null ? fmtINR(totalPayable) : '—'}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()}
              disabled={!employeeId || !principal || !tenure || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Disburse Loan Dialog ───────────────────────────────────────────────────────

function DisburseLoanDialog({
  open, loan, onClose,
}: {
  open: boolean; loan: EmployeeLoan | null; onClose: () => void
}) {
  const qc = useQueryClient()
  const [disbursedDate, setDisbursedDate] = useState('')
  const [disbursedAmount, setDisbursedAmount] = useState('')
  const [firstEmiMonth, setFirstEmiMonth] = useState(currentMonth())

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/loans/${loan!.id}/disburse`, {
      disbursed_date: disbursedDate,
      disbursed_amount: Number(disbursedAmount),
      first_emi_month: firstEmiMonth,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      onClose()
      toast.success('Loan disbursed', { description: `EMI starts from ${firstEmiMonth}` })
    },
    onError: (e: Error) => toast.error('Disbursal failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Disburse Loan</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          {loan && (
            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
              <p className="font-medium">{empName(loan)}</p>
              <p className="text-muted-foreground">Principal: {fmtINR(loan.principal_amount)} · EMI: {fmtINR(loan.emi_amount)}/mo</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Disbursement Date</label>
              <DateInput value={disbursedDate} onChange={setDisbursedDate} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Disbursed Amount (₹)</label>
              <Input type="number" value={disbursedAmount} onChange={e => setDisbursedAmount(e.target.value)}
                placeholder={loan?.principal_amount ? String(loan.principal_amount) : ''} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">First EMI Month</label>
            <Input type="month" value={firstEmiMonth} onChange={e => setFirstEmiMonth(e.target.value)}
              className="w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()}
              disabled={!disbursedDate || !disbursedAmount || !firstEmiMonth || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm & Generate Schedule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Foreclose Dialog ───────────────────────────────────────────────────────────

function ForecloseDialog({
  open, loan, onClose,
}: {
  open: boolean; loan: EmployeeLoan | null; onClose: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/loans/${loan!.id}/foreclose`, {
      foreclosure_amount: Number(amount),
      notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      onClose()
      toast.success('Loan foreclosed')
    },
    onError: (e: Error) => toast.error('Foreclosure failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Foreclose Loan</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          {loan && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-100">{empName(loan)}</p>
              <p className="text-amber-700 dark:text-amber-300 mt-0.5">Outstanding: {fmtINR(loan.outstanding_balance)}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Foreclosure Amount (₹)</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={loan?.outstanding_balance ? String(loan.outstanding_balance) : ''} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes (optional)</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for early closure…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => mutation.mutate()}
              disabled={!amount || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Foreclose Loan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Advance Schedule Drawer ────────────────────────────────────────────────────

function AdvanceScheduleRow({ advanceId, tenantId }: { advanceId: string; tenantId?: string }) {
  const { data, isLoading } = useQuery<{ data: RecoverySchedule[] }>({
    queryKey: ['advance-schedule', advanceId],
    queryFn: () => api.get(`/payroll/advances/${advanceId}/schedule`),
  })
  const rows = data?.data ?? []

  if (isLoading) return (
    <tr>
      <td colSpan={9} className="py-4 px-6 bg-muted/20">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading schedule…
        </div>
      </td>
    </tr>
  )

  const recovered = rows.filter(r => r.status === 'recovered').length

  return (
    <tr>
      <td colSpan={9} className="p-0">
        <div className="mx-4 mb-3 rounded-lg border border-border bg-muted/20">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recovery Schedule — {recovered}/{rows.length} recovered
            </p>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-3">No schedule generated yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Month</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Amount</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Recovered At</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border/30 last:border-0">
                    <td className="px-4 py-2 text-foreground">{row.recovery_month}</td>
                    <td className="px-4 py-2 text-right text-foreground">{fmtINR(row.scheduled_amount)}</td>
                    <td className="px-4 py-2">
                      <StatusPill status={row.status} map={SCHED_STATUS_BADGE} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {row.recovered_at ? fmtDate(row.recovered_at) : row.payroll_run_id ? 'Via payroll' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Loan Schedule Drawer ───────────────────────────────────────────────────────

function LoanScheduleRow({ loanId }: { loanId: string }) {
  const { data, isLoading } = useQuery<{ data: LoanSchedule[] }>({
    queryKey: ['loan-schedule', loanId],
    queryFn: () => api.get(`/payroll/loans/${loanId}/schedule`),
  })
  const rows = data?.data ?? []
  const paid = rows.filter(r => r.status === 'paid').length

  if (isLoading) return (
    <tr>
      <td colSpan={10} className="py-4 px-6 bg-muted/20">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading amortization schedule…
        </div>
      </td>
    </tr>
  )

  return (
    <tr>
      <td colSpan={10} className="p-0">
        <div className="mx-4 mb-3 rounded-lg border border-border bg-muted/20">
          <div className="px-4 py-2 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Amortization Schedule — {paid}/{rows.length} paid
            </p>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-3">No schedule generated yet. Disburse the loan to generate the amortization schedule.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">#</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Month</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">EMI</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Principal</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Interest</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Balance</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}
                      className={cn('border-b border-border/30 last:border-0',
                        row.status === 'paid' ? 'opacity-60' : '')}>
                      <td className="px-3 py-2 text-right text-muted-foreground">{row.installment_number}</td>
                      <td className="px-3 py-2 text-foreground font-medium">{row.due_month}</td>
                      <td className="px-3 py-2 text-right text-foreground">{fmtINR(row.emi_amount)}</td>
                      <td className="px-3 py-2 text-right text-foreground">{fmtINR(row.principal_component)}</td>
                      <td className="px-3 py-2 text-right text-amber-600">{fmtINR(row.interest_component)}</td>
                      <td className="px-3 py-2 text-right text-foreground">{fmtINR(row.outstanding_balance)}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={row.status} map={SCHED_STATUS_BADGE} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.paid_at ? fmtDate(row.paid_at) : row.payroll_run_id ? 'Via payroll' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Advances Tab ───────────────────────────────────────────────────────────────

function AdvancesTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient()
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<AdvanceRequest | null>(null)
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null)
  const [disburseTarget, setDisburseTarget] = useState<AdvanceRequest | null>(null)
  const [showNewAdvance, setShowNewAdvance] = useState(false)
  const [statusFilter, setStatusFilter]   = useState('all')
  const [search, setSearch]               = useState('')

  const { data, isLoading, refetch } = useQuery<{ data: AdvanceRequest[] }>({
    queryKey: ['advances'],
    queryFn: () => api.get('/payroll/advances'),
  })

  const pauseMutation = useMutation({
    mutationFn: ({ id, pause }: { id: string; pause: boolean }) =>
      api.post(`/payroll/advances/${id}/${pause ? 'pause' : 'resume'}`,
        pause ? { pause_reason: 'Paused by HR admin' } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      toast.success('Recovery status updated')
    },
    onError: (e: Error) => toast.error('Update failed', { description: e.message }),
  })

  const advances = useMemo(() => {
    let rows = data?.data ?? []
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        empName(r).toLowerCase().includes(q) ||
        (r.purpose ?? '').toLowerCase().includes(q) ||
        (r.employees?.employee_code ?? '').toLowerCase().includes(q),
      )
    }
    return rows
  }, [data?.data, statusFilter, search])

  const pending = (data?.data ?? []).filter(r => r.status === 'pending').length
  const active  = (data?.data ?? []).filter(r => ['disbursed','recovering'].includes(r.status)).length
  const totalOutstanding = (data?.data ?? [])
    .filter(r => ['disbursed','recovering'].includes(r.status))
    .reduce((s, r) => s + (r.approved_amount ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Pending Approval</p>
          <p className="text-xl font-bold text-foreground">{pending}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Active Recovery</p>
          <p className="text-xl font-bold text-foreground">{active}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Outstanding</p>
          <p className="text-xl font-bold text-foreground">{fmtINR(totalOutstanding)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search employee…" value={search}
          onChange={e => setSearch(e.target.value)} className="max-w-[200px] h-8 text-sm" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-3 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="disbursed">Disbursed</option>
          <option value="recovering">Recovering</option>
          <option value="fully_recovered">Fully Recovered</option>
          <option value="rejected">Rejected</option>
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowNewAdvance(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New Advance
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading advances…</span>
          </div>
        ) : advances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <DollarSign className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No advance requests found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-8 px-4 py-3" />
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Employee</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Requested</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Approved</th>
                <th className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Recovery</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Purpose</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Status</th>
                <th className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Payroll</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {advances.map(adv => (
                <>
                  <tr key={adv.id}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === adv.id ? null : adv.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="View recovery schedule"
                      >
                        {expandedId === adv.id
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground leading-tight">{empName(adv)}</div>
                      {empCode(adv) && <div className="text-xs text-muted-foreground">{empCode(adv)}</div>}
                    </td>
                    <td className="px-3 py-3 text-right text-foreground">{fmtINR(adv.requested_amount)}</td>
                    <td className="px-3 py-3 text-right text-foreground">
                      {adv.approved_amount != null ? fmtINR(adv.approved_amount) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center text-foreground">
                      <span className="text-xs">{adv.recovery_months}mo</span>
                      {adv.approved_amount && adv.recovery_months && (
                        <span className="block text-[10px] text-muted-foreground">
                          {fmtINR(Math.round(adv.approved_amount / adv.recovery_months))}/mo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground max-w-[140px] truncate text-xs">
                      {adv.purpose ?? '—'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusPill status={adv.status} map={ADV_STATUS_BADGE} />
                        {adv.is_recovery_paused && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                            <Pause className="h-2.5 w-2.5" /> Paused
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <PayrollBadge active={['disbursed','recovering'].includes(adv.status) && !adv.is_recovery_paused} />
                    </td>
                    <td className="px-3 py-3">
                      {isAdmin && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {adv.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                onClick={() => setApproveTarget(adv)}>
                                <CheckCircle2 className="h-3 w-3" /> Approve
                              </Button>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                                onClick={() => setRejectTarget(adv.id)}>
                                <XCircle className="h-3 w-3" /> Reject
                              </Button>
                            </>
                          )}
                          {adv.status === 'approved' && (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => setDisburseTarget(adv)}>
                              <Banknote className="h-3 w-3" /> Disburse
                            </Button>
                          )}
                          {['disbursed','recovering'].includes(adv.status) && (
                            <Button size="sm" variant="outline"
                              className={cn('h-7 text-xs gap-1',
                                adv.is_recovery_paused
                                  ? 'text-emerald-700 border-emerald-200'
                                  : 'text-amber-700 border-amber-200')}
                              onClick={() => pauseMutation.mutate({ id: adv.id, pause: !adv.is_recovery_paused })}>
                              {adv.is_recovery_paused
                                ? <><Play className="h-3 w-3" /> Resume</>
                                : <><Pause className="h-3 w-3" /> Pause</>}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === adv.id && (
                    <AdvanceScheduleRow key={`sched-${adv.id}`} advanceId={adv.id} />
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dialogs */}
      <ApproveAdvanceDialog open={!!approveTarget} advance={approveTarget} onClose={() => setApproveTarget(null)} />
      {rejectTarget && (
        <RejectDialog open={!!rejectTarget} id={rejectTarget} type="advance" onClose={() => setRejectTarget(null)} />
      )}
      <DisburseAdvanceDialog open={!!disburseTarget} advance={disburseTarget} onClose={() => setDisburseTarget(null)} />
      <NewAdvanceDialog open={showNewAdvance} onClose={() => setShowNewAdvance(false)} />
    </div>
  )
}

// ── Approve Loan Dialog ────────────────────────────────────────────────────────

function ApproveLoanDialog({ open, loan, onClose }: { open: boolean; loan: EmployeeLoan | null; onClose: () => void }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => api.post(`/payroll/loans/${loan!.id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      onClose()
      toast.success('Loan approved')
    },
    onError: (e: Error) => toast.error('Approval failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Approve Loan</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          {loan && (
            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
              <p className="font-medium">{empName(loan)}</p>
              <p className="text-muted-foreground">
                {loan.loan_type.charAt(0).toUpperCase() + loan.loan_type.slice(1)} loan · {fmtINR(loan.principal_amount)} · {loan.tenure_months} months
              </p>
              <p className="text-muted-foreground">EMI: <span className="font-medium text-foreground">{fmtINR(loan.emi_amount)}/month</span></p>
              {loan.interest_rate_pct > 0 && <p className="text-muted-foreground">Interest: {loan.interest_rate_pct}% p.a.</p>}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Approving this loan will not disburse funds. You can disburse and set the EMI start date in the next step.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve Loan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Loans Tab ──────────────────────────────────────────────────────────────────

function LoansTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient()
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<EmployeeLoan | null>(null)
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null)
  const [disburseTarget, setDisburseTarget] = useState<EmployeeLoan | null>(null)
  const [forecloseTarget, setForecloseTarget] = useState<EmployeeLoan | null>(null)
  const [showNewLoan, setShowNewLoan]     = useState(false)
  const [statusFilter, setStatusFilter]   = useState('all')
  const [typeFilter, setTypeFilter]       = useState('all')
  const [search, setSearch]               = useState('')

  const { data, isLoading, refetch } = useQuery<{ data: EmployeeLoan[] }>({
    queryKey: ['loans'],
    queryFn: () => api.get('/payroll/loans'),
  })

  const pauseMutation = useMutation({
    mutationFn: ({ id, pause }: { id: string; pause: boolean }) =>
      api.post(`/payroll/loans/${id}/${pause ? 'pause-emi' : 'resume-emi'}`,
        pause ? { pause_reason: 'Paused by HR admin' } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      toast.success('EMI status updated')
    },
    onError: (e: Error) => toast.error('Update failed', { description: e.message }),
  })

  const loans = useMemo(() => {
    let rows = data?.data ?? []
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter)
    if (typeFilter !== 'all') rows = rows.filter(r => r.loan_type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        empName(r).toLowerCase().includes(q) ||
        (r.employees?.employee_code ?? '').toLowerCase().includes(q),
      )
    }
    return rows
  }, [data?.data, statusFilter, typeFilter, search])

  const active     = (data?.data ?? []).filter(r => r.status === 'active').length
  const pending    = (data?.data ?? []).filter(r => r.status === 'pending').length
  const totalOutstanding = (data?.data ?? [])
    .filter(r => r.status === 'active')
    .reduce((s, r) => s + (r.outstanding_balance ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Pending Approval</p>
          <p className="text-xl font-bold text-foreground">{pending}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Active Loans</p>
          <p className="text-xl font-bold text-foreground">{active}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Outstanding</p>
          <p className="text-xl font-bold text-foreground">{fmtINR(totalOutstanding)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Search employee…" value={search}
          onChange={e => setSearch(e.target.value)} className="max-w-[200px] h-8 text-sm" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-3 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="foreclosed">Foreclosed</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-3 text-sm">
          <option value="all">All types</option>
          {LOAN_TYPES.map(t => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowNewLoan(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New Loan
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading loans…</span>
          </div>
        ) : loans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Landmark className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No loans found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-8 px-4 py-3" />
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Employee</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Type</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Principal</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Rate</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">EMI/mo</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Outstanding</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Status</th>
                <th className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Payroll</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loans.map(loan => (
                <>
                  <tr key={loan.id}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <button type="button"
                        onClick={() => setExpandedId(expandedId === loan.id ? null : loan.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors">
                        {expandedId === loan.id
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground leading-tight">{empName(loan)}</div>
                      {empCode(loan) && <div className="text-xs text-muted-foreground">{empCode(loan)}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="capitalize text-foreground">{loan.loan_type}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-foreground">{fmtINR(loan.principal_amount)}</td>
                    <td className="px-3 py-3 text-right text-foreground">
                      {loan.interest_rate_pct > 0 ? `${loan.interest_rate_pct}%` : 'Interest-free'}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-foreground">{fmtINR(loan.emi_amount)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn('font-medium', loan.outstanding_balance > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                        {fmtINR(loan.outstanding_balance)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusPill status={loan.status} map={LOAN_STATUS_BADGE} />
                        {loan.is_emi_paused && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                            <Pause className="h-2.5 w-2.5" /> EMI Paused
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <PayrollBadge active={loan.status === 'active' && !loan.is_emi_paused} />
                    </td>
                    <td className="px-3 py-3">
                      {isAdmin && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {loan.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                onClick={() => setApproveTarget(loan)}>
                                <CheckCircle2 className="h-3 w-3" /> Approve
                              </Button>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                                onClick={() => setRejectTarget(loan.id)}>
                                <XCircle className="h-3 w-3" /> Reject
                              </Button>
                            </>
                          )}
                          {loan.status === 'approved' && (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => setDisburseTarget(loan)}>
                              <Banknote className="h-3 w-3" /> Disburse
                            </Button>
                          )}
                          {loan.status === 'active' && (
                            <>
                              <Button size="sm" variant="outline"
                                className={cn('h-7 text-xs gap-1',
                                  loan.is_emi_paused
                                    ? 'text-emerald-700 border-emerald-200'
                                    : 'text-amber-700 border-amber-200')}
                                onClick={() => pauseMutation.mutate({ id: loan.id, pause: !loan.is_emi_paused })}>
                                {loan.is_emi_paused
                                  ? <><Play className="h-3 w-3" /> Resume EMI</>
                                  : <><Pause className="h-3 w-3" /> Pause EMI</>}
                              </Button>
                              <Button size="sm" variant="outline"
                                className="h-7 text-xs gap-1 text-orange-700 border-orange-200 hover:bg-orange-50"
                                onClick={() => setForecloseTarget(loan)}>
                                <AlertTriangle className="h-3 w-3" /> Foreclose
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === loan.id && <LoanScheduleRow key={`sched-${loan.id}`} loanId={loan.id} />}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Dialogs */}
      <ApproveLoanDialog open={!!approveTarget} loan={approveTarget} onClose={() => setApproveTarget(null)} />
      {rejectTarget && (
        <RejectDialog open={!!rejectTarget} id={rejectTarget} type="loan" onClose={() => setRejectTarget(null)} />
      )}
      <DisburseLoanDialog open={!!disburseTarget} loan={disburseTarget} onClose={() => setDisburseTarget(null)} />
      <ForecloseDialog open={!!forecloseTarget} loan={forecloseTarget} onClose={() => setForecloseTarget(null)} />
      <NewLoanDialog open={showNewLoan} onClose={() => setShowNewLoan(false)} />
    </div>
  )
}

// ── Recovery Calendar Tab ──────────────────────────────────────────────────────

function RecoveryCalendarTab() {
  const [month, setMonth] = useState(currentMonth())

  const { data: advData, isLoading: advLoading } = useQuery<{ data: any[]; month: string }>({
    queryKey: ['pending-recoveries', month],
    queryFn: () => api.get(`/payroll/advances/pending-recoveries/${month}`),
    enabled: !!month,
  })

  const { data: loanData, isLoading: loanLoading } = useQuery<{ data: any[]; month: string }>({
    queryKey: ['active-emis', month],
    queryFn: () => api.get(`/payroll/loans/active-emis/${month}`),
    enabled: !!month,
  })

  const advancesWithSchedules = (advData?.data ?? []).flatMap((adv: any) =>
    (adv.pending_schedules ?? []).map((s: any) => ({
      type: 'advance' as const,
      employee: adv.employees
        ? `${adv.employees.first_name} ${adv.employees.last_name}`
        : adv.employee_id,
      employee_code: adv.employees?.employee_code,
      label: 'Salary Advance Recovery',
      amount: s.scheduled_amount,
      status: s.status,
      payroll_run_id: s.payroll_run_id,
    })),
  )

  const loansWithEmis = (loanData?.data ?? []).flatMap((loan: any) =>
    (loan.pending_emis ?? []).map((s: any) => ({
      type: 'loan' as const,
      employee: loan.employees
        ? `${loan.employees.first_name} ${loan.employees.last_name}`
        : loan.employee_id,
      employee_code: loan.employees?.employee_code,
      label: `${(loan.loan_type ?? 'Loan').charAt(0).toUpperCase() + (loan.loan_type ?? '').slice(1)} Loan EMI #${s.installment_number}`,
      amount: s.emi_amount,
      status: s.status,
      payroll_run_id: s.payroll_run_id,
    })),
  )

  const allItems = [...advancesWithSchedules, ...loansWithEmis]
  const totalDeductions = allItems.reduce((s, r) => s + r.amount, 0)
  const isLoading = advLoading || loanLoading

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-foreground">Payroll Month</label>
        <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" />
        {allItems.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{allItems.length} deductions</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{fmtINR(totalDeductions)} total</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading deductions for {month}…</span>
        </div>
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-border bg-card">
          <CalendarClock className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No advance or loan deductions scheduled for {month}.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Deductions for {month}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5 text-primary" />
              Auto-deducted from salary via payroll run
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Employee</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Type</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Description</th>
                <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Amount</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {allItems.map((item, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{item.employee}</div>
                    {item.employee_code && <div className="text-xs text-muted-foreground">{item.employee_code}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {item.type === 'advance' ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        <DollarSign className="h-2.5 w-2.5" /> Advance
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        <Landmark className="h-2.5 w-2.5" /> Loan
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{item.label}</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtINR(item.amount)}</td>
                  <td className="px-4 py-3">
                    {item.payroll_run_id ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Deducted via payroll
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-700">
                        <CalendarClock className="h-3 w-3" /> Pending payroll run
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-foreground">Total Deductions</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-foreground">{fmtINR(totalDeductions)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type Tab = 'advances' | 'loans' | 'calendar'

export function LoansAndAdvances() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [tab, setTab] = useState<Tab>('advances')

  const TABS: Array<{ key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'advances', label: 'Salary Advances', icon: DollarSign },
    { key: 'loans',    label: 'Loans',           icon: Landmark    },
    { key: 'calendar', label: 'Recovery Calendar', icon: CalendarClock },
  ]

  // Top-level KPIs (cross-module)
  const { data: advData }  = useQuery<{ data: AdvanceRequest[] }>({ queryKey: ['advances'], queryFn: () => api.get('/payroll/advances') })
  const { data: loanData } = useQuery<{ data: EmployeeLoan[] }>({ queryKey: ['loans'], queryFn: () => api.get('/payroll/loans') })

  const advances = advData?.data ?? []
  const loans    = loanData?.data ?? []

  const pendingApprovals = [...advances.filter(a => a.status === 'pending'), ...loans.filter(l => l.status === 'pending')].length
  const activeAdvances   = advances.filter(a => ['disbursed','recovering'].includes(a.status)).length
  const activeLoans      = loans.filter(l => l.status === 'active').length
  const totalOutstanding = [
    ...advances.filter(a => ['disbursed','recovering'].includes(a.status)).map(a => a.approved_amount ?? 0),
    ...loans.filter(l => l.status === 'active').map(l => l.outstanding_balance),
  ].reduce((s, n) => s + n, 0)

  const thisMonthEmi = loans
    .filter(l => l.status === 'active' && !l.is_emi_paused)
    .reduce((s, l) => s + l.emi_amount, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Loans & Advances"
        subtitle="Manage employee salary advances and loans — auto-deducted from payroll"
        breadcrumb={[{ label: 'Payroll' }, { label: 'Loans & Advances' }]}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={AlertTriangle} label="Pending Approvals" value={String(pendingApprovals)}
          sub="requires action"
          accent={pendingApprovals > 0 ? 'bg-amber-100 text-amber-600' : 'bg-muted text-muted-foreground'} />
        <KpiCard icon={Users} label="Active (Adv + Loans)" value={String(activeAdvances + activeLoans)}
          sub={`${activeAdvances} advances · ${activeLoans} loans`}
          accent="bg-blue-100 text-blue-600" />
        <KpiCard icon={CreditCard} label="This Month EMI" value={fmtINR(thisMonthEmi)}
          sub="auto-deducted via payroll"
          accent="bg-primary/10 text-primary" />
        <KpiCard icon={Banknote} label="Total Outstanding" value={fmtINR(totalOutstanding)}
          sub="across advances + loans"
          accent="bg-violet-100 text-violet-600" />
      </div>

      {/* Tab nav */}
      <SubTabs<typeof tab>
        tabs={TABS.map(t => ({ id: t.key, label: t.label, icon: t.icon }))}
        value={tab}
        onChange={setTab}
        className="mb-6"
      />

      {tab === 'advances' && <AdvancesTab isAdmin={isAdmin} />}
      {tab === 'loans'    && <LoansTab isAdmin={isAdmin} />}
      {tab === 'calendar' && <RecoveryCalendarTab />}
    </PageContainer>
  )
}
