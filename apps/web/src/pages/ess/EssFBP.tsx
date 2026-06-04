/**
 * EssFBP — /ess/fbp
 *
 * Employee self-service: submit bills for flexible-benefit (reimbursement)
 * allowances each quarter. The allowance is paid monthly; bills you submit are
 * reconciled by HR — the un-billed portion becomes taxable.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Receipt, Loader2, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'

interface RComponent { id: string; name: string; code: string; is_reimbursement?: boolean }
interface Submission {
  id: string
  amount: number
  approved_amount: number | null
  description: string | null
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  financial_year: string
  quarter: number
  salary_components: { name: string; code: string } | null
}

function currentFY(): string {
  const d = new Date()
  const y = d.getFullYear(), m = d.getMonth() + 1
  const start = m >= 4 ? y : y - 1
  return `${start}-${String(start + 1).slice(2)}`
}
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`
const STATUS_CLS: Record<string, string> = {
  draft: 'text-muted-foreground', submitted: 'text-info',
  approved: 'text-success', rejected: 'text-destructive',
}

export function EssFBP() {
  const qc = useQueryClient()
  const [fy, setFy] = useState(currentFY())
  const [quarter, setQuarter] = useState(1)
  const [componentId, setComponentId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  const compQ = useQuery<{ data: RComponent[] }>({
    queryKey: ['ess-fbp-components'],
    queryFn:  () => api.get('/masters/salary-components').then((r: any) => {
      const raw = Array.isArray(r?.data) ? r.data : (r?.data?.data ?? r ?? [])
      return { data: (raw as RComponent[]).filter(c => c.is_reimbursement) }
    }),
    staleTime: 120_000,
  })
  const components = compQ.data?.data ?? []

  const subsQ = useQuery<{ data: Submission[] }>({
    queryKey: ['ess-fbp-my'],
    queryFn:  () => api.get('/payroll/fbp/my'),
  })
  const submissions = subsQ.data?.data ?? []

  const create = useMutation({
    mutationFn: (body: object) => api.post('/payroll/fbp/my', body),
    onSuccess: (res: any) => {
      // Auto-submit the freshly created draft so HR sees it immediately.
      const id = res?.data?.id
      if (id) submitOne.mutate(id)
      else { toast.success('Bill saved'); reset() }
    },
    onError: (e: Error) => toast.error('Failed to save', { description: e.message }),
  })
  const submitOne = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/fbp/my/${id}/submit`, {}),
    onSuccess: () => { toast.success('Bill submitted to HR'); reset(); qc.invalidateQueries({ queryKey: ['ess-fbp-my'] }) },
    onError: (e: Error) => toast.error('Submit failed', { description: e.message }),
  })

  function reset() { setComponentId(''); setAmount(''); setDescription('') }
  function handleSubmit() {
    if (!componentId || !amount || Number(amount) <= 0) { toast.error('Pick a component and enter an amount'); return }
    create.mutate({
      salary_component_id: componentId,
      financial_year: fy,
      quarter,
      amount: Number(amount),
      description: description || undefined,
    })
  }

  return (
    <PageContainer>
      <PageHeader
        title="Flexible Benefits — Submit Bills"
        subtitle="Your FBP allowances are paid monthly. Submit bills each quarter — the un-billed portion becomes taxable."
      />

      <SectionCard title="Submit a Bill" icon={<Receipt className="h-4 w-4 text-muted-foreground" />}>
        {components.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No flexible-benefit components are configured for you yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Component</label>
              <select value={componentId} onChange={e => setComponentId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">Select…</option>
                {components.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">FY</label>
              <Input value={fy} onChange={e => setFy(e.target.value)} placeholder="2026-27" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Quarter</label>
              <select value={quarter} onChange={e => setQuarter(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value={1}>Q1 (Apr–Jun)</option>
                <option value={2}>Q2 (Jul–Sep)</option>
                <option value={3}>Q3 (Oct–Dec)</option>
                <option value={4}>Q4 (Jan–Mar)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Bill Amount (₹)</label>
              <Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Apr–Jun fuel" />
            </div>
          </div>
        )}
        {components.length > 0 && (
          <div className="mt-4">
            <Button size="sm" onClick={handleSubmit} disabled={create.isPending || submitOne.isPending}>
              {(create.isPending || submitOne.isPending)
                ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                : <Send className="h-4 w-4 mr-1.5" />}
              Submit Bill
            </Button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="My Submissions" icon={<Plus className="h-4 w-4 text-muted-foreground" />}>
        {subsQ.isLoading ? (
          <div className="py-6 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No submissions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground text-xs">
                  <th className="px-3 pb-2 font-medium">Component</th>
                  <th className="px-3 pb-2 font-medium">Period</th>
                  <th className="px-3 pb-2 font-medium text-right">Amount</th>
                  <th className="px-3 pb-2 font-medium text-right">Approved</th>
                  <th className="px-3 pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map(s => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="px-3 py-2">{s.salary_components?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{s.financial_year} Q{s.quarter}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(s.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.approved_amount != null ? inr(s.approved_amount) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Badge variant="secondary" className={`text-[10px] ${STATUS_CLS[s.status] ?? ''}`}>{s.status}</Badge>
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
