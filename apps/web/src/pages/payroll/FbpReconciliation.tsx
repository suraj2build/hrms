/**
 * FbpReconciliation — /admin/payroll/fbp
 *
 * HR quarterly FBP reconciliation: review submitted bills (approve/reject),
 * compute paid-vs-bills → taxable per employee·component, and lock the quarter
 * (which freezes the taxable figure that flows into TDS).
 *
 * Access: hr_admin / super_admin.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { EmployeeLabel } from '@/components/employee/EmployeeLabel'
import {
  Landmark, Loader2, ShieldAlert, Check, X, Lock, RefreshCw, Receipt, Paperclip,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { getSignedUrl }  from '@/lib/supabase-storage'
import { cn }            from '@/lib/utils'

interface ReconRow {
  employee_id: string
  component_code: string
  component_name: string
  paid_amount: number
  proof_amount: number
  exemption_limit: number | null
  taxable_amount: number
  status: 'pending' | 'locked'
}
interface Submission {
  id: string
  amount: number
  approved_amount: number | null
  description: string | null
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  financial_year: string
  quarter: number
  salary_components: { name: string; code: string } | null
  employees: { first_name: string; last_name: string; employee_code: string } | null
}

function currentFY(): string {
  const d = new Date()
  const y = d.getFullYear(), m = d.getMonth() + 1
  const start = m >= 4 ? y : y - 1
  return `${start}-${String(start + 1).slice(2)}`
}
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`

export function FbpReconciliation() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [fy, setFy] = useState(currentFY())
  const [quarter, setQuarter] = useState(1)

  const reconQ = useQuery<{ data: { rows: ReconRow[]; total_taxable: number } }>({
    queryKey: ['fbp-recon', fy, quarter],
    queryFn:  () => api.get(`/payroll/fbp/reconciliation?financial_year=${fy}&quarter=${quarter}`),
    enabled:  isAdmin,
  })
  const rows = reconQ.data?.data?.rows ?? []
  const totalTaxable = reconQ.data?.data?.total_taxable ?? 0
  const anyLocked = rows.some(r => r.status === 'locked')

  const subsQ = useQuery<{ data: Submission[] }>({
    queryKey: ['fbp-subs', fy, quarter],
    queryFn:  () => api.get(`/payroll/fbp/submissions?status=submitted&financial_year=${fy}&quarter=${quarter}`),
    enabled:  isAdmin,
  })
  const submissions = subsQ.data?.data ?? []

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['fbp-recon'] })
    qc.invalidateQueries({ queryKey: ['fbp-subs'] })
  }

  const approve = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.post(`/payroll/fbp/submissions/${id}/approve`, { approved_amount: amount }),
    onSuccess: () => { toast.success('Bill approved'); refresh() },
    onError: (e: Error) => toast.error('Approve failed', { description: e.message }),
  })
  const reject = useMutation({
    mutationFn: (id: string) =>
      api.post(`/payroll/fbp/submissions/${id}/reject`, { rejection_reason: 'Rejected by HR' }),
    onSuccess: () => { toast.success('Bill rejected'); refresh() },
    onError: (e: Error) => toast.error('Reject failed', { description: e.message }),
  })
  const lock = useMutation({
    mutationFn: () => api.post<{ data: { locked: number } }>('/payroll/fbp/reconciliation/lock', { financial_year: fy, quarter }),
    onSuccess: (res) => { toast.success(`Quarter locked (${res?.data?.locked ?? 0} rows). Taxable now flows to TDS.`); refresh() },
    onError: (e: Error) => toast.error('Lock failed', { description: e.message }),
  })

  // Open each uploaded bill for a submission in a new tab via a short-lived signed URL.
  async function viewBills(submissionId: string) {
    try {
      const res = await api.get<{ data: Array<{ storage_path: string }> }>(`/payroll/fbp/submissions/${submissionId}/attachments`)
      const atts = res?.data ?? []
      if (atts.length === 0) { toast.info('No bills attached to this submission'); return }
      for (const a of atts) {
        const url = await getSignedUrl(a.storage_path)
        window.open(url, '_blank', 'noopener')
      }
    } catch (e: unknown) {
      toast.error('Could not open bills', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  if (!isAdmin) {
    return (
      <PageContainer><SectionCard>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
        </div>
      </SectionCard></PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="FBP Reconciliation"
        subtitle="Year-to-date reconciliation of flexible-benefit allowances paid vs bills submitted — the shortfall becomes taxable and flows to TDS when locked."
        actions={
          <div className="flex items-center gap-2">
            <Input value={fy} onChange={e => setFy(e.target.value)} className="h-8 w-24 text-xs" placeholder="2026-27" />
            <select value={quarter} onChange={e => setQuarter(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              <option value={1}>Q1 (Apr–Jun)</option>
              <option value={2}>Q2 (Jul–Sep)</option>
              <option value={3}>Q3 (Oct–Dec)</option>
              <option value={4}>Q4 (Jan–Mar)</option>
            </select>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Recompute
            </Button>
          </div>
        }
      />

      {/* Pending submissions to approve */}
      <SectionCard title="Bills Awaiting Approval" icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
        description="Approve or reject submitted bills before locking the quarter.">
        {subsQ.isLoading ? (
          <div className="py-6 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No bills awaiting approval for this quarter.</p>
        ) : (
          <div className="space-y-2">
            {submissions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {s.employees ? `${s.employees.first_name} ${s.employees.last_name}` : '—'}
                    <span className="text-xs text-muted-foreground ml-2">{s.salary_components?.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{inr(s.amount)} claimed{s.description ? ` · ${s.description}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => viewBills(s.id)}>
                    <Paperclip className="h-3 w-3 mr-1" /> Bills
                  </Button>
                  <Button size="sm" className="h-7 text-xs" disabled={approve.isPending}
                    onClick={() => approve.mutate({ id: s.id, amount: s.amount })}>
                    <Check className="h-3 w-3 mr-1" /> Approve {inr(s.amount)}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                    disabled={reject.isPending} onClick={() => reject.mutate(s.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Reconciliation table */}
      <SectionCard
        title={`Reconciliation — ${fy} Q${quarter}`}
        icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Total taxable:
              <span className="font-semibold text-foreground ml-1">{inr(totalTaxable)}</span>
            </span>
            <Button size="sm" disabled={lock.isPending || rows.length === 0 || anyLocked}
              onClick={() => lock.mutate()}>
              {lock.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Lock className="h-3.5 w-3.5 mr-1.5" />}
              {anyLocked ? 'Locked' : 'Lock Quarter'}
            </Button>
          </div>
        }
      >
        {reconQ.isLoading ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No reimbursement components paid in this quarter. Mark components as “Reimbursement (FBP)” and finalize payroll first.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground text-xs">
                  <th className="px-3 pb-2 font-medium">Employee</th>
                  <th className="px-3 pb-2 font-medium">Component</th>
                  <th className="px-3 pb-2 font-medium text-right">Paid (YTD)</th>
                  <th className="px-3 pb-2 font-medium text-right">Bills (YTD)</th>
                  <th className="px-3 pb-2 font-medium text-right">Taxable (YTD)</th>
                  <th className="px-3 pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.employee_id}-${r.component_code}-${i}`} className="border-b border-border/50">
                    <td className="px-3 py-2 text-xs text-muted-foreground"><EmployeeLabel id={r.employee_id} /></td>
                    <td className="px-3 py-2">{r.component_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(r.paid_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(r.proof_amount)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums font-semibold',
                      r.taxable_amount > 0 ? 'text-warning' : 'text-success')}>
                      {inr(r.taxable_amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
