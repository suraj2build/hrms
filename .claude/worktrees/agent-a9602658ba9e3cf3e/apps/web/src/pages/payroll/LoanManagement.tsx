/**
 * LoanManagement — /admin/payroll/loans
 *
 * HR admin view: manage employee loans and repayment schedules.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState }                                from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import { toast }          from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmployeeLoan {
  id:                  string
  employee_id:         string
  loan_type:           string
  principal_amount:    number
  interest_rate_pct:   number
  tenure_months:       number
  emi_amount:          number
  disbursement_date:   string
  status:              'active' | 'closed' | 'defaulted'
  total_paid:          number
  outstanding_balance: number
  employee_name?:      string
  employee_code?:      string
}

interface LoanSchedule {
  id:                   string
  loan_id:              string
  installment_number:   number
  due_month:            string
  emi_amount:           number
  principal_component:  number
  interest_component:   number
  closing_balance:      number
  status:               'pending' | 'paid' | 'overdue'
  paid_at:              string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'success' | 'secondary' | 'destructive'> = {
  active:    'success',
  closed:    'secondary',
  defaulted: 'destructive',
}

const SCHED_BADGE: Record<string, 'warning' | 'success' | 'destructive'> = {
  pending: 'warning',
  paid:    'success',
  overdue: 'destructive',
}

const LOAN_TYPES = ['personal', 'emergency', 'vehicle', 'education', 'other']

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ── New Loan Dialog ────────────────────────────────────────────────────────────

function NewLoanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_id:       '',
    loan_type:         'personal',
    principal_amount:  '',
    interest_rate_pct: '',
    tenure_months:     '',
    disbursement_date: '',
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/loans', {
        ...form,
        principal_amount:  Number(form.principal_amount),
        interest_rate_pct: Number(form.interest_rate_pct),
        tenure_months:     Number(form.tenure_months),
      }),
    onSuccess: () => {
      toast.success('Loan created')
      qc.invalidateQueries({ queryKey: ['loans'] })
      onClose()
      setForm({
        employee_id: '', loan_type: 'personal', principal_amount: '',
        interest_rate_pct: '', tenure_months: '', disbursement_date: '',
      })
    },
    onError: (e: Error) => {
      toast.error('Failed to create loan', { description: e.message })
    },
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.employee_id && form.principal_amount && form.interest_rate_pct &&
    form.tenure_months && form.disbursement_date

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Employee Loan</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Employee ID (UUID)</label>
            <Input value={form.employee_id} onChange={e => set('employee_id', e.target.value)} placeholder="uuid..." />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Loan Type</label>
            <select
              value={form.loan_type}
              onChange={e => set('loan_type', e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {LOAN_TYPES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Principal Amount (₹)</label>
            <Input type="number" value={form.principal_amount} onChange={e => set('principal_amount', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Interest Rate % (0–36)</label>
              <Input type="number" min={0} max={36} step={0.1} value={form.interest_rate_pct} onChange={e => set('interest_rate_pct', e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Tenure Months (1–120)</label>
              <Input type="number" min={1} max={120} value={form.tenure_months} onChange={e => set('tenure_months', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Disbursement Date</label>
            <Input type="date" value={form.disbursement_date} onChange={e => set('disbursement_date', e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Loan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Record Payment Dialog ──────────────────────────────────────────────────────

function RecordPaymentDialog({
  open,
  loanId,
  installmentId,
  onClose,
}: {
  open: boolean
  loanId: string
  installmentId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [paidAmount, setPaidAmount]   = useState('')
  const [paymentDate, setPaymentDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/payroll/loans/${loanId}/payments`, {
        installment_id: installmentId,
        paid_amount:    Number(paidAmount),
        payment_date:   paymentDate,
      }),
    onSuccess: () => {
      toast.success('Payment recorded')
      qc.invalidateQueries({ queryKey: ['loan-schedule', loanId] })
      onClose()
      setPaidAmount('')
      setPaymentDate('')
    },
    onError: (e: Error) => {
      toast.error('Failed to record payment', { description: e.message })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Amount Paid (₹)</label>
            <Input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Payment Date</label>
            <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!paidAmount || !paymentDate || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function LoanManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [activeTab, setActiveTab]           = useState<'loans' | 'schedule'>('loans')
  const [showNewLoan, setShowNewLoan]       = useState(false)
  const [selectedLoan, setSelectedLoan]     = useState<EmployeeLoan | null>(null)
  const [paymentTarget, setPaymentTarget]   = useState<{ loanId: string; installmentId: string } | null>(null)

  const { data: loans = [], isLoading, refetch } = useQuery<EmployeeLoan[]>({
    queryKey: ['loans'],
    queryFn:  () => api.get('/payroll/loans').then((r: any) => r.data),
  })

  const { data: schedule = [], isLoading: schedLoading } = useQuery<LoanSchedule[]>({
    queryKey: ['loan-schedule', selectedLoan?.id],
    queryFn:  () => api.get(`/payroll/loans/${selectedLoan!.id}/schedule`).then((r: any) => r.data),
    enabled:  !!selectedLoan,
  })

  const tabs = [
    { key: 'loans',    label: 'Loans' },
    { key: 'schedule', label: 'Repayment Schedule' },
  ] as const

  return (
    <PageContainer>
      <PageHeader
        title="Loan Management"
        subtitle="Manage employee loans and repayment schedules"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowNewLoan(true)}>
                <Plus className="mr-2 h-4 w-4" /> New Loan
              </Button>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Loans Tab ── */}
      {activeTab === 'loans' && (
        <SectionCard title="Employee Loans">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : loans.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No loans found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Employee</th>
                    <th className="text-left py-3 px-4 font-medium">Loan Type</th>
                    <th className="text-right py-3 px-4 font-medium">Principal</th>
                    <th className="text-right py-3 px-4 font-medium">Rate %</th>
                    <th className="text-right py-3 px-4 font-medium">Tenure</th>
                    <th className="text-right py-3 px-4 font-medium">EMI</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-right py-3 px-4 font-medium">Outstanding</th>
                    <th className="text-left py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map(loan => (
                    <tr key={loan.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">
                          {loan.employee_name ?? loan.employee_id}
                        </div>
                        {loan.employee_code && (
                          <div className="text-xs text-muted-foreground">{loan.employee_code}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-foreground capitalize">{loan.loan_type}</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(loan.principal_amount)}</td>
                      <td className="py-3 px-4 text-right text-foreground">{loan.interest_rate_pct}%</td>
                      <td className="py-3 px-4 text-right text-foreground">{loan.tenure_months}m</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(loan.emi_amount)}</td>
                      <td className="py-3 px-4">
                        <Badge variant={STATUS_BADGE[loan.status] ?? 'secondary'}>
                          {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(loan.outstanding_balance)}</td>
                      <td className="py-3 px-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedLoan(loan)
                            setActiveTab('schedule')
                          }}
                        >
                          View Schedule
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Schedule Tab ── */}
      {activeTab === 'schedule' && (
        <SectionCard
          title={
            selectedLoan
              ? `Repayment Schedule — ${selectedLoan.employee_name ?? selectedLoan.employee_id} (${selectedLoan.loan_type})`
              : 'Repayment Schedule'
          }
        >
          {!selectedLoan ? (
            <p className="text-muted-foreground py-6">
              Select a loan from the Loans tab to view its repayment schedule.
            </p>
          ) : schedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : schedule.length === 0 ? (
            <p className="text-muted-foreground py-6">No schedule records found.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">Principal</p>
                  <p className="text-sm font-medium text-foreground">{fmt(selectedLoan.principal_amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                  <p className="text-sm font-medium text-foreground">{fmt(selectedLoan.outstanding_balance)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Paid</p>
                  <p className="text-sm font-medium text-foreground">{fmt(selectedLoan.total_paid)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-right py-3 px-4 font-medium">#</th>
                      <th className="text-left py-3 px-4 font-medium">Month</th>
                      <th className="text-right py-3 px-4 font-medium">EMI</th>
                      <th className="text-right py-3 px-4 font-medium">Principal</th>
                      <th className="text-right py-3 px-4 font-medium">Interest</th>
                      <th className="text-right py-3 px-4 font-medium">Closing Bal.</th>
                      <th className="text-left py-3 px-4 font-medium">Status</th>
                      <th className="text-left py-3 px-4 font-medium">Paid At</th>
                      {isAdmin && <th className="text-left py-3 px-4 font-medium">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map(row => (
                      <tr key={row.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                        <td className="py-3 px-4 text-right text-muted-foreground">{row.installment_number}</td>
                        <td className="py-3 px-4 text-foreground">{row.due_month}</td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(row.emi_amount)}</td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(row.principal_component)}</td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(row.interest_component)}</td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(row.closing_balance)}</td>
                        <td className="py-3 px-4">
                          <Badge variant={SCHED_BADGE[row.status] ?? 'secondary'}>
                            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{fmtDate(row.paid_at)}</td>
                        {isAdmin && (
                          <td className="py-3 px-4">
                            {row.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setPaymentTarget({ loanId: selectedLoan.id, installmentId: row.id })
                                }
                              >
                                Record Payment
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {/* Dialogs */}
      <NewLoanDialog open={showNewLoan} onClose={() => setShowNewLoan(false)} />
      {paymentTarget && (
        <RecordPaymentDialog
          open={!!paymentTarget}
          loanId={paymentTarget.loanId}
          installmentId={paymentTarget.installmentId}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </PageContainer>
  )
}
