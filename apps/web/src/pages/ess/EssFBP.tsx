/**
 * EssFBP — /ess/fbp
 *
 * Employee self-service: submit bills for flexible-benefit (reimbursement)
 * allowances each quarter. The allowance is paid monthly; bills you submit are
 * reconciled by HR — the un-billed portion becomes taxable.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Receipt, Loader2, Plus, Send, Paperclip } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { uploadEmployeeFile } from '@/lib/supabase-storage'

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
interface ReconRow {
  id: string
  financial_year: string
  quarter: number
  paid_amount: number
  proof_amount: number
  exemption_limit: number | null
  taxable_amount: number
  status: string
  reconciled_at: string | null
  salary_components: { id: string; name: string; code: string } | null
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
  const { profile } = useAuthStore()
  const [fy, setFy] = useState(currentFY())
  const [quarter, setQuarter] = useState(1)
  const [componentId, setComponentId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)

  const compQ = useQuery<{ data: RComponent[] }>({
    queryKey: ['ess-fbp-components'],
    queryFn:  () => api.get<RComponent[] | { data?: RComponent[] | { data?: RComponent[] } }>('/masters/salary-components').then((r) => {
      const inner = Array.isArray(r) ? r : r?.data
      const raw = Array.isArray(inner) ? inner : (inner?.data ?? [])
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

  const reconQ = useQuery<{ data: { rows: ReconRow[]; total_taxable: number } }>({
    queryKey: ['ess-fbp-my-reconciliation'],
    queryFn:  () => api.get('/payroll/fbp/my/reconciliation'),
  })
  const reconRows = reconQ.data?.data?.rows ?? []
  const totalTaxable = reconQ.data?.data?.total_taxable ?? 0

  function reset() { setComponentId(''); setAmount(''); setDescription(''); setFiles([]) }

  // Upload each selected bill to storage, then record its metadata on the submission.
  async function uploadAttachments(submissionId: string) {
    if (files.length === 0) return
    if (!profile?.tenant_id || !profile?.employee_id) {
      toast.error('Profile not linked — cannot attach bills'); return
    }
    for (const file of files) {
      const path = await uploadEmployeeFile(profile.tenant_id, profile.employee_id, 'documents', file)
      await api.post(`/payroll/fbp/my/${submissionId}/attachments`, {
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || undefined,
        file_size_bytes: file.size,
      })
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      // 1) create draft → 2) upload + attach bills → 3) submit to HR
      const res = await api.post<{ data?: { id?: string } }>('/payroll/fbp/my', {
        salary_component_id: componentId,
        financial_year: fy,
        quarter,
        amount: Number(amount),
        description: description || undefined,
      })
      const id = res?.data?.id as string
      if (!id) throw new Error('Submission was not created')
      setUploading(true)
      try { await uploadAttachments(id) } finally { setUploading(false) }
      await api.post(`/payroll/fbp/my/${id}/submit`, {})
    },
    onSuccess: () => {
      toast.success('Bill submitted to HR')
      reset()
      qc.invalidateQueries({ queryKey: ['ess-fbp-my'] })
    },
    onError: (e: Error) => { setUploading(false); toast.error('Submit failed', { description: e.message }) },
  })

  function handleSubmit() {
    if (!componentId || !amount || Number(amount) <= 0) { toast.error('Pick a component and enter an amount'); return }
    submit.mutate()
  }
  const busy = submit.isPending || uploading

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
          <>
            {/* Bill attachments */}
            <div className="mt-4 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" /> Attach bills (PDF / image)
              </label>
              <input
                type="file" multiple accept="image/*,application/pdf"
                onChange={e => setFiles(Array.from(e.target.files ?? []))}
                className="block text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-muted/70"
              />
              {files.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {files.length} file{files.length !== 1 ? 's' : ''} selected: {files.map(f => f.name).join(', ')}
                </p>
              )}
            </div>

            <div className="mt-4">
              <Button size="sm" onClick={handleSubmit} disabled={busy}>
                {busy
                  ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  : <Send className="h-4 w-4 mr-1.5" />}
                {uploading ? 'Uploading bills…' : 'Submit Bill'}
              </Button>
            </div>
          </>
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

      <SectionCard
        title="Reconciliation Outcome"
        icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
      >
        {reconQ.isLoading ? (
          <div className="py-6 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : reconRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Not reconciled yet. Once HR reconciles the quarter, the un-billed (taxable) portion appears here.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground text-xs">
                    <th className="px-3 pb-2 font-medium">Component</th>
                    <th className="px-3 pb-2 font-medium">Period</th>
                    <th className="px-3 pb-2 font-medium text-right">Paid</th>
                    <th className="px-3 pb-2 font-medium text-right">Bills</th>
                    <th className="px-3 pb-2 font-medium text-right">Taxable</th>
                    <th className="px-3 pb-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reconRows.map(r => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="px-3 py-2">{r.salary_components?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.financial_year} Q{r.quarter}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(r.paid_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(r.proof_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{inr(r.taxable_amount)}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge variant="secondary" className="text-[10px] capitalize">{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Total taxable (added to your income for TDS): <span className="font-medium text-foreground tabular-nums">{inr(totalTaxable)}</span>
            </p>
          </>
        )}
      </SectionCard>
    </PageContainer>
  )
}
