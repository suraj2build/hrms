/**
 * Reimbursements — /admin/payroll/reimbursements
 *
 * HR admin view: manage reimbursement claims and categories.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState }                                from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, Plus, CheckCircle2,
  XCircle, FileText,
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
import { toast }          from 'sonner'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReimbCategory {
  id:               string
  name:             string
  code:             string
  max_amount:       number | null
  requires_receipt: boolean
  is_taxable:       boolean
  is_active:        boolean
}

interface ReimbClaim {
  id:              string
  employee_id:     string
  category_id:     string
  claim_month:     string
  claimed_amount:  number
  approved_amount: number | null
  description:     string | null
  status:          'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'paid'
  submitted_at:    string | null
  created_at:      string
  employee_name?:  string
  category_name?:  string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'secondary' | 'outline' | 'warning' | 'success' | 'destructive'> = {
  draft:        'secondary',
  submitted:    'outline',
  under_review: 'warning',
  approved:     'success',
  rejected:     'destructive',
  paid:         'outline',
}

const STATUS_OPTS = ['All', 'submitted', 'under_review', 'approved', 'rejected', 'paid']

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

// ── Review Dialog ──────────────────────────────────────────────────────────────

function ReviewDialog({
  open,
  claim,
  onClose,
}: {
  open: boolean
  claim: ReimbClaim | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [approvedAmount, setApprovedAmount] = useState('')
  const [reviewNotes, setReviewNotes]       = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/payroll/reimbursements/${claim!.id}/review`, {
        approved_amount: Number(approvedAmount),
        review_notes:    reviewNotes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements'] })
      toast.success('Claim reviewed')
      onClose()
      setApprovedAmount('')
      setReviewNotes('')
    },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review Reimbursement Claim</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {claim && (
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Employee: <span className="text-foreground font-medium">{claim.employee_name ?? claim.employee_id}</span></p>
              <p>Category: <span className="text-foreground">{claim.category_name ?? claim.category_id}</span></p>
              <p>Claimed: <span className="text-foreground">{fmt(claim.claimed_amount)}</span></p>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Approved Amount (₹)</label>
            <Input
              type="number"
              value={approvedAmount}
              onChange={e => setApprovedAmount(e.target.value)}
              placeholder={claim ? String(claim.claimed_amount) : ''}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Review Notes</label>
            <Input value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Optional notes..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!approvedAmount || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Reject Claim Dialog ────────────────────────────────────────────────────────

function RejectClaimDialog({
  open,
  claim,
  onClose,
}: {
  open: boolean
  claim: ReimbClaim | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/payroll/reimbursements/${claim!.id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements'] })
      toast.success('Claim rejected')
      onClose()
      setReason('')
    },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject Claim</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Rejection Reason</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Enter reason..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" onClick={() => mutation.mutate()} disabled={!reason || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Add Category Dialog ────────────────────────────────────────────────────────

function AddCategoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name:             '',
    code:             '',
    max_amount:       '',
    requires_receipt: false,
    is_taxable:       false,
    is_active:        true,
  })

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/reimbursements/categories', {
        ...form,
        max_amount: form.max_amount ? Number(form.max_amount) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimb-categories'] })
      toast.success('Category added')
      onClose()
      setForm({ name: '', code: '', max_amount: '', requires_receipt: false, is_taxable: false, is_active: true })
    },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const Toggle = ({ field, label }: { field: string; label: string }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={form[field as keyof typeof form] as boolean}
        onChange={e => set(field, e.target.checked)}
        className="h-4 w-4 rounded border-border"
      />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Reimbursement Category</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Medical" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Code</label>
            <Input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. MEDICAL" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Max Amount (₹) — leave blank for unlimited</label>
            <Input type="number" value={form.max_amount} onChange={e => set('max_amount', e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <Toggle field="requires_receipt" label="Requires Receipt" />
            <Toggle field="is_taxable" label="Is Taxable" />
            <Toggle field="is_active" label="Is Active" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!form.name || !form.code || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Category
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function Reimbursements() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [activeTab, setActiveTab]         = useState<'claims' | 'categories'>('claims')
  const [statusFilter, setStatusFilter]   = useState('All')
  const [reviewTarget, setReviewTarget]   = useState<ReimbClaim | null>(null)
  const [rejectTarget, setRejectTarget]   = useState<ReimbClaim | null>(null)
  const [showAddCat, setShowAddCat]       = useState(false)

  const { data: claims = [], isLoading: claimsLoading, refetch } = useQuery<ReimbClaim[]>({
    queryKey: ['reimbursements', statusFilter],
    queryFn:  () => {
      const qs = statusFilter !== 'All' ? `?status=${statusFilter}` : ''
      return api.get(`/payroll/reimbursements${qs}`).then((r: any) => r.data)
    },
  })

  const { data: categories = [], isLoading: catsLoading } = useQuery<ReimbCategory[]>({
    queryKey: ['reimb-categories'],
    queryFn:  () => api.get('/payroll/reimbursements/categories').then((r: any) => r.data),
    enabled:  activeTab === 'categories',
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reimbursements/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements'] })
      toast.success('Reimbursement claim approved')
    },
    onError: (e: Error) => toast.error('Approval failed', { description: e.message }),
  })

  const payMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/reimbursements/${id}/pay`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reimbursements'] })
      toast.success('Claim marked as paid')
    },
    onError: (e: Error) => toast.error('Failed to mark as paid', { description: e.message }),
  })

  const tabs = [
    { key: 'claims',     label: 'Claims' },
    { key: 'categories', label: 'Categories' },
  ] as const

  return (
    <PageContainer>
      <PageHeader
        title="Reimbursements"
        subtitle="Manage employee reimbursement claims and categories"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            {isAdmin && activeTab === 'categories' && (
              <Button size="sm" onClick={() => setShowAddCat(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add Category
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

      {/* ── Claims Tab ── */}
      {activeTab === 'claims' && (
        <SectionCard title="Reimbursement Claims">
          {/* Filter */}
          <div className="mb-4">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {STATUS_OPTS.map(s => (
                <option key={s} value={s}>
                  {s === 'All' ? 'All Statuses' : s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>

          {claimsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : claims.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No claims found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Employee</th>
                    <th className="text-left py-3 px-4 font-medium">Category</th>
                    <th className="text-left py-3 px-4 font-medium">Month</th>
                    <th className="text-right py-3 px-4 font-medium">Claimed</th>
                    <th className="text-right py-3 px-4 font-medium">Approved</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    {isAdmin && <th className="text-left py-3 px-4 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {claims.map(claim => (
                    <tr key={claim.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">
                          {claim.employee_name ?? claim.employee_id}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-foreground">
                        {claim.category_name ?? claim.category_id}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{claim.claim_month}</td>
                      <td className="py-3 px-4 text-right text-foreground">{fmt(claim.claimed_amount)}</td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {claim.approved_amount != null ? fmt(claim.approved_amount) : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={STATUS_BADGE[claim.status] ?? 'secondary'}>
                          {claim.status.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
                        </Badge>
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {(claim.status === 'submitted' || claim.status === 'under_review') && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => setReviewTarget(claim)}>
                                  <FileText className="mr-1 h-3 w-3" /> Review
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={approveMutation.isPending}
                                  onClick={() => approveMutation.mutate(claim.id)}
                                >
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setRejectTarget(claim)}>
                                  <XCircle className="mr-1 h-3 w-3" /> Reject
                                </Button>
                              </>
                            )}
                            {claim.status === 'approved' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={payMutation.isPending}
                                onClick={() => payMutation.mutate(claim.id)}
                              >
                                Mark Paid
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Categories Tab ── */}
      {activeTab === 'categories' && (
        <SectionCard title="Reimbursement Categories">
          {catsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No categories configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Name</th>
                    <th className="text-left py-3 px-4 font-medium">Code</th>
                    <th className="text-right py-3 px-4 font-medium">Max Amount</th>
                    <th className="text-left py-3 px-4 font-medium">Requires Receipt</th>
                    <th className="text-left py-3 px-4 font-medium">Taxable</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map(cat => (
                    <tr key={cat.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-4 font-medium text-foreground">{cat.name}</td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{cat.code}</td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {cat.max_amount != null ? fmt(cat.max_amount) : 'Unlimited'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={cat.requires_receipt ? 'warning' : 'secondary'}>
                          {cat.requires_receipt ? 'Yes' : 'No'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={cat.is_taxable ? 'destructive' : 'secondary'}>
                          {cat.is_taxable ? 'Taxable' : 'Non-taxable'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={cat.is_active ? 'success' : 'secondary'}>
                          {cat.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Dialogs */}
      <ReviewDialog open={!!reviewTarget} claim={reviewTarget} onClose={() => setReviewTarget(null)} />
      <RejectClaimDialog open={!!rejectTarget} claim={rejectTarget} onClose={() => setRejectTarget(null)} />
      <AddCategoryDialog open={showAddCat} onClose={() => setShowAddCat(false)} />
    </PageContainer>
  )
}
