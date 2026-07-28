import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Receipt, Plus, Trash2, SendHorizonal } from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge, badgeVariants } from '@/components/ui/badge'
import type { VariantProps } from 'class-variance-authority'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { api } from '@/lib/api/client'
import { useOpenOnParam } from '@/lib/runbooks/useOpenOnParam'

type BadgeVariant = VariantProps<typeof badgeVariants>['variant']

interface ReimbCategory {
  id: string
  name: string
  code: string
  max_amount: number | null
  requires_receipt: boolean
  is_taxable: boolean
}

interface MyReimbClaim {
  id: string
  category_id: string
  claim_month: string
  claimed_amount: number
  approved_amount: number | null
  description: string | null
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'paid'
  submitted_at: string | null
  created_at: string
  category_name?: string
}

type ClaimStatus = MyReimbClaim['status']

function statusVariant(status: ClaimStatus): BadgeVariant {
  switch (status) {
    case 'draft': return 'secondary'
    case 'submitted': return 'info'
    case 'under_review': return 'warning'
    case 'approved': return 'success'
    case 'rejected': return 'destructive'
    case 'paid': return 'outline'
    default: return 'secondary'
  }
}

function statusLabel(status: ClaimStatus): string {
  return status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

interface ClaimForm {
  category_id: string
  claim_month: string
  claimed_amount: string
  description: string
}

const defaultForm: ClaimForm = {
  category_id: '',
  claim_month: '',
  claimed_amount: '',
  description: '',
}

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function EssReimbursements() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<ClaimForm>({ ...defaultForm, claim_month: getCurrentMonth() })

  // Runbook deep-link (?new=1) auto-opens the create-claim dialog.
  useOpenOnParam('new', () => openDialog())

  const { data: categories = [] } = useQuery<ReimbCategory[]>({
    queryKey: ['reimbursements', 'categories'],
    queryFn: () => api.get<{ data: ReimbCategory[] }>('/payroll/reimbursements/categories').then(r => r.data),
  })

  const { data: claims = [], isLoading } = useQuery<MyReimbClaim[]>({
    queryKey: ['reimbursements', 'my'],
    queryFn: () => api.get<{ data: MyReimbClaim[] }>('/payroll/reimbursements/my').then(r => r.data),
  })

  const createClaim = useMutation({
    mutationFn: (body: { category_id: string; claim_month: string; claimed_amount: number; description: string }) =>
      api.post('/payroll/reimbursements/my', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements', 'my'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-reimb'] })
      closeDialog()
      toast.success('Reimbursement claim created')
    },
    onError: (e: Error) => toast.error('Failed to create claim', { description: e.message }),
  })

  const submitClaim = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reimbursements/my/${id}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements', 'my'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-reimb'] })
      toast.success('Claim submitted for approval')
    },
    onError: (e: Error) => toast.error('Submission failed', { description: e.message }),
  })

  const cancelClaim = useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/reimbursements/my/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements', 'my'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-reimb'] })
      toast.success('Claim cancelled')
    },
    onError: (e: Error) => toast.error('Failed to cancel claim', { description: e.message }),
  })

  const stats = useMemo(() => ({
    total: claims.length,
    pending: claims.filter(c => c.status === 'submitted' || c.status === 'under_review').length,
    approvedSum: claims
      .filter(c => c.status === 'approved' || c.status === 'paid')
      .reduce((sum, c) => sum + (c.approved_amount ?? c.claimed_amount), 0),
  }), [claims])

  function openDialog() {
    setForm({ ...defaultForm, claim_month: getCurrentMonth(), category_id: categories[0]?.id ?? '' })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setForm({ ...defaultForm, claim_month: getCurrentMonth() })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createClaim.mutate({
      category_id: form.category_id,
      claim_month: form.claim_month,
      claimed_amount: parseFloat(form.claimed_amount),
      description: form.description,
    })
  }

  const selectedCategory = categories.find(c => c.id === form.category_id)

  // Group claims by month
  const claimsByMonth = useMemo(() => {
    const map: Record<string, MyReimbClaim[]> = {}
    for (const claim of claims) {
      if (!map[claim.claim_month]) map[claim.claim_month] = []
      map[claim.claim_month].push(claim)
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
  }, [claims])

  return (
    <PageContainer>
      <PageHeader
        title="Reimbursements"
        subtitle="Submit and track your expense reimbursement claims"
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4 mr-1" />
            New Claim
          </Button>
        }
      />

      {/* Stats Row */}
      <div className="mb-6">
        <MetricRow cols={3}>
          <MetricCard label="My Claims" value={stats.total} variant="info" />
          <MetricCard label="Pending Approval" value={stats.pending} variant="warning" />
          <MetricCard
            label="Total Approved"
            value={`₹${stats.approvedSum.toLocaleString('en-IN')}`}
            variant="success"
          />
        </MetricRow>
      </div>

      {/* Claims List */}
      {isLoading ? (
        <p className="text-muted-foreground text-sm py-8">Loading claims…</p>
      ) : claims.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Receipt className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No reimbursement claims yet</p>
          <Button size="sm" variant="outline" onClick={openDialog}>
            <Plus className="h-4 w-4 mr-1" />
            Create your first claim
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {claimsByMonth.map(([month, monthClaims]) => (
            <SectionCard
              key={month}
              title={(() => { const d=new Date(month.slice(0,7)+'-01T12:00:00Z'); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()}
            >
              <div className="space-y-3">
                {monthClaims.map(claim => (
                  <div
                    key={claim.id}
                    className="border border-border rounded-lg p-4 bg-muted/10 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">
                          {claim.category_name ?? categories.find(c => c.id === claim.category_id)?.name ?? 'Unknown Category'}
                        </p>
                        <Badge variant={statusVariant(claim.status)}>
                          {statusLabel(claim.status)}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-foreground">
                          ₹{claim.claimed_amount.toLocaleString('en-IN')}
                          <span className="text-xs text-muted-foreground font-normal ml-1">claimed</span>
                        </p>
                        {claim.approved_amount !== null && (
                          <p className="text-xs text-success">
                            ₹{claim.approved_amount.toLocaleString('en-IN')} approved
                          </p>
                        )}
                      </div>
                    </div>

                    {claim.description && (
                      <p className="text-xs text-muted-foreground mb-3">{claim.description}</p>
                    )}

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {claim.submitted_at
                          ? `Submitted ${(() => { const d=new Date(claim.submitted_at.length===10?claim.submitted_at+'T12:00:00Z':claim.submitted_at); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()}`
                          : `Created ${(() => { const d=new Date(claim.created_at.length===10?claim.created_at+'T12:00:00Z':claim.created_at); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()}`}
                      </p>

                      <div className="flex gap-2">
                        {claim.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => submitClaim.mutate(claim.id)}
                            disabled={submitClaim.isPending}
                          >
                            <SendHorizonal className="h-3.5 w-3.5 mr-1" />
                            Submit
                          </Button>
                        )}
                        {(claim.status === 'draft' || claim.status === 'submitted') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cancelClaim.mutate(claim.id)}
                            disabled={cancelClaim.isPending}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* New Claim Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Reimbursement Claim</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Category *</label>
              <select
                value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                required
              >
                <option value="">Select a category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.max_amount ? ` (max ₹${c.max_amount.toLocaleString('en-IN')})` : ''}
                  </option>
                ))}
              </select>
              {selectedCategory && (
                <div className="mt-1 flex items-center gap-2">
                  {selectedCategory.requires_receipt && (
                    <span className="text-xs text-warning">Receipt required</span>
                  )}
                  {selectedCategory.is_taxable && (
                    <span className="text-xs text-muted-foreground">Taxable</span>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Claim Month *</label>
              <Input
                type="month"
                value={form.claim_month}
                onChange={e => setForm(f => ({ ...f, claim_month: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Claimed Amount (₹) *
                {selectedCategory?.max_amount && (
                  <span className="text-muted-foreground font-normal ml-1">
                    — max ₹{selectedCategory.max_amount.toLocaleString('en-IN')}
                  </span>
                )}
              </label>
              <Input
                type="number"
                min="1"
                step="0.01"
                max={selectedCategory?.max_amount ?? undefined}
                value={form.claimed_amount}
                onChange={e => setForm(f => ({ ...f, claimed_amount: e.target.value }))}
                placeholder="e.g. 1500"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of the expense…"
                rows={3}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={createClaim.isPending}>
                Create Claim
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
