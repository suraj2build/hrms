/**
 * TDSManagement — /admin/payroll/statutory/tds
 *
 * HR admin page for managing TDS: tax declarations (approve/reject),
 * proof verification, and TDS projections.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, XCircle, FileText, Receipt, TrendingUp,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SubTabs }       from '@/components/ui/SubTabs'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast }         from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { useStatutoryMonth } from '@/components/compliance/StatutoryMonthPicker'

// ── Types ─────────────────────────────────────────────────────────────────────

type DeclarationStatus =
  | 'draft' | 'declared' | 'submitted' | 'under_review'
  | 'approved' | 'rejected' | 'revision_requested'
  | 'locked' | 'payroll_applied' | 'archived'

type DocumentState = 'uploaded' | 'under_review' | 'verified' | 'rejected'

interface DeclarationProof {
  id: string
  file_name: string
  document_state: DocumentState
  uploaded_at: string
}

interface TaxDeclarationItem {
  id: string
  employee_id: string
  financial_year: string
  declaration_category: string
  section: string
  description: string
  declared_amount: number
  approved_amount: number | null
  status: DeclarationStatus
  rejection_reason: string | null
  declaration_proofs: DeclarationProof[]
  employees?: {
    employee_code: string
    profiles: Array<{ full_name: string }>
  }
}

interface TDSProjectionRow {
  id: string
  employee_id: string
  financial_year: string
  projection_month: string
  tds_this_month: number
  gross_income_projected: number
  taxable_income_projected: number
  regime: 'old' | 'new'
  employees?: {
    employee_code: string
    profiles: Array<{ full_name: string }>
  }
}

interface ProofRow {
  id: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  uploaded_at: string
  document_state: DocumentState
  verification_notes: string | null
  rejection_reason: string | null
  verified_at: string | null
  tax_declarations: {
    id: string
    declaration_category: string
    section: string
    declared_amount: number
    approved_amount: number | null
    financial_year: string
    employee_id: string
    employees: {
      employee_code: string
      profiles: Array<{ full_name: string }>
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n)
}

function currentFY(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${String(year + 1).slice(2)}`
}

const DECLARATION_STATUS_BADGE: Record<DeclarationStatus, string> = {
  draft:              'outline',
  declared:           'outline',
  submitted:          'secondary',
  under_review:       'secondary',
  approved:           'success',
  rejected:           'destructive',
  revision_requested: 'destructive',
  locked:             'secondary',
  payroll_applied:    'success',
  archived:           'outline',
}

const DOCUMENT_STATE_BADGE: Record<DocumentState, string> = {
  uploaded:     'outline',
  under_review: 'secondary',
  verified:     'success',
  rejected:     'destructive',
}

function empName(row: { employees?: { profiles: Array<{ full_name: string }> } } | undefined): string {
  return row?.employees?.profiles?.[0]?.full_name ?? '—'
}
function empCode(row: { employees?: { employee_code: string } } | undefined): string {
  return row?.employees?.employee_code ?? ''
}

// ── ApproveDialog ─────────────────────────────────────────────────────────────

function ApproveDialog({
  declaration,
  onConfirm,
  onClose,
  isPending,
}: {
  declaration: TaxDeclarationItem
  onConfirm: (approvedAmount: number, notes?: string) => void
  onClose: () => void
  isPending: boolean
}) {
  const [amount, setAmount] = useState(String(declaration.declared_amount))
  const [notes,  setNotes]  = useState('')

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Approve Declaration
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">
            Declared: {fmtCurrency(declaration.declared_amount)} — {declaration.section} / {declaration.description}
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Approved Amount (₹)
            </label>
            <Input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Enter the amount you approve. May be less than declared.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Notes (optional)
            </label>
            <Input
              placeholder="Any notes for the employee…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-8 text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 h-8 text-xs"
              disabled={isPending || !amount || Number(amount) < 0}
              onClick={() => onConfirm(Number(amount), notes || undefined)}
            >
              {isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Approving…</>
                : 'Approve'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── RejectDialog ──────────────────────────────────────────────────────────────

function RejectDialog({
  title,
  onConfirm,
  onClose,
  isPending,
}: {
  title: string
  onConfirm: (reason: string) => void
  onClose: () => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <XCircle className="h-4 w-4 text-destructive" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Reason
            </label>
            <Input
              placeholder="Enter reason…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-8 text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1 h-8 text-xs"
              disabled={isPending || !reason.trim()}
              onClick={() => onConfirm(reason.trim())}
            >
              {isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Rejecting…</>
                : 'Confirm Reject'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── DeclarationsTab ───────────────────────────────────────────────────────────

function DeclarationsTab({ financialYear }: { financialYear: string }) {
  const qc = useQueryClient()
  const [approveTarget, setApproveTarget] = useState<TaxDeclarationItem | null>(null)
  const [rejectTarget,  setRejectTarget]  = useState<TaxDeclarationItem | null>(null)
  const [statusFilter,  setStatusFilter]  = useState('')

  const { data: declarations, isLoading, isError } = useQuery<TaxDeclarationItem[]>({
    queryKey:  ['tds-declarations', financialYear, statusFilter],
    queryFn:   () => {
      const params = new URLSearchParams({ financial_year: financialYear })
      if (statusFilter) params.set('status', statusFilter)
      return api.get(`/payroll/statutory/tds/declarations?${params}`)
        .then((r: any) => Array.isArray(r?.data) ? r.data : [])
    },
    staleTime: 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, approved_amount, notes }: { id: string; approved_amount: number; notes?: string }) =>
      api.post(`/payroll/statutory/tds/declarations/${id}/approve`, { approved_amount, notes }),
    onSuccess: () => {
      setApproveTarget(null)
      qc.invalidateQueries({ queryKey: ['tds-declarations', financialYear] })
      toast.success('Declaration approved')
    },
    onError: (e: any) => toast.error('Approval failed', { description: e?.message }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, rejection_reason }: { id: string; rejection_reason: string }) =>
      api.post(`/payroll/statutory/tds/declarations/${id}/reject`, { rejection_reason }),
    onSuccess: () => {
      setRejectTarget(null)
      qc.invalidateQueries({ queryKey: ['tds-declarations', financialYear] })
      toast.success('Declaration rejected')
    },
    onError: (e: any) => toast.error('Rejection failed', { description: e?.message }),
  })

  const revisionMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.post(`/payroll/statutory/tds/declarations/${id}/request-revision`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds-declarations', financialYear] })
      toast.success('Revision requested — employee notified')
    },
    onError: (e: any) => toast.error('Failed to request revision', { description: e?.message }),
  })

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
  if (isError) return (
    <div className="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" />
      Failed to load declarations.
    </div>
  )

  const list = Array.isArray(declarations) ? declarations : []
  const reviewable = (d: TaxDeclarationItem) => d.status === 'submitted' || d.status === 'under_review'

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
        >
          <option value="">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="revision_requested">Needs Revision</option>
          <option value="payroll_applied">Payroll Applied</option>
        </select>
        {list.length > 0 && (
          <span className="text-xs text-muted-foreground">{list.length} record{list.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Category / Section</th>
                <th className="text-right text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Declared</th>
                <th className="text-right text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Approved</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Status</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Proofs</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(d => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <p className="text-xs font-medium">{empName(d)}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{empCode(d)}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-xs font-mono font-semibold">{d.declaration_category}</p>
                    <p className="text-[10px] text-muted-foreground">{d.section} — {d.description}</p>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-right">{fmtCurrency(d.declared_amount)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-right">
                    {d.approved_amount != null
                      ? <span className="text-success font-medium">{fmtCurrency(d.approved_amount)}</span>
                      : <span className="text-muted-foreground">—</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={(DECLARATION_STATUS_BADGE[d.status] ?? 'secondary') as any}
                      className="rounded-full text-[10px] capitalize"
                    >
                      {d.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {(d.declaration_proofs?.length ?? 0) === 0 ? (
                      <span className="text-[10px] text-muted-foreground">None</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {d.declaration_proofs?.filter(p => p.document_state === 'verified').length ?? 0} / {d.declaration_proofs?.length ?? 0} verified
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {reviewable(d) && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1 text-success border-success/30 hover:bg-success/10"
                          disabled={approveMutation.isPending}
                          onClick={() => setApproveTarget(d)}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => setRejectTarget(d)}
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1 text-warning border-warning/30 hover:bg-warning/10"
                          disabled={revisionMutation.isPending}
                          onClick={() => {
                            const notes = window.prompt('Reason for revision request (required):')
                            if (notes?.trim()) revisionMutation.mutate({ id: d.id, notes: notes.trim() })
                          }}
                        >
                          Revise
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveTarget && (
        <ApproveDialog
          declaration={approveTarget}
          isPending={approveMutation.isPending}
          onConfirm={(approvedAmount, notes) =>
            approveMutation.mutate({ id: approveTarget.id, approved_amount: approvedAmount, notes })
          }
          onClose={() => setApproveTarget(null)}
        />
      )}
      {rejectTarget && (
        <RejectDialog
          title={`Reject Declaration — ${rejectTarget.section}`}
          isPending={rejectMutation.isPending}
          onConfirm={reason => rejectMutation.mutate({ id: rejectTarget.id, rejection_reason: reason })}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </>
  )
}

// ── ProofSubmissionsTab ───────────────────────────────────────────────────────

function ProofSubmissionsTab({ financialYear }: { financialYear: string }) {
  const qc = useQueryClient()
  const [rejectTarget, setRejectTarget] = useState<ProofRow | null>(null)
  const [stateFilter,  setStateFilter]  = useState('uploaded')

  const { data: proofs, isLoading, isError } = useQuery<ProofRow[]>({
    queryKey:  ['tds-proofs', financialYear, stateFilter],
    queryFn:   () => {
      const params = new URLSearchParams({ financial_year: financialYear })
      if (stateFilter) params.set('document_state', stateFilter)
      return api.get(`/payroll/statutory/tds/proofs?${params}`)
        .then((r: any) => Array.isArray(r?.data) ? r.data : [])
    },
    staleTime: 30_000,
  })

  const verifyMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      api.post(`/payroll/statutory/tds/proofs/${id}/verify`, { verification_notes: notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds-proofs', financialYear] })
      toast.success('Proof verified')
    },
    onError: (e: any) => toast.error('Verification failed', { description: e?.message }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, rejection_reason }: { id: string; rejection_reason: string }) =>
      api.post(`/payroll/statutory/tds/proofs/${id}/reject`, { rejection_reason }),
    onSuccess: () => {
      setRejectTarget(null)
      qc.invalidateQueries({ queryKey: ['tds-proofs', financialYear] })
      toast.success('Proof rejected')
    },
    onError: (e: any) => toast.error('Rejection failed', { description: e?.message }),
  })

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
  if (isError) return (
    <div className="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" />
      Failed to load proof submissions.
    </div>
  )

  const list = Array.isArray(proofs) ? proofs : []

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          className="text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
        >
          <option value="">All States</option>
          <option value="uploaded">Uploaded (Pending)</option>
          <option value="under_review">Under Review</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        {list.length > 0 && (
          <span className="text-xs text-muted-foreground">{list.length} record{list.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">File</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Declaration</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">State</th>
                <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(p => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <p className="text-xs font-medium">{empName(p.tax_declarations)}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{empCode(p.tax_declarations)}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-xs font-medium max-w-[140px] truncate">{p.file_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {(() => { const _s = p.uploaded_at; const _dt = new Date(_s.length === 10 ? _s + 'T12:00:00Z' : _s); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_dt.getTime()) ? '—' : `${String(_dt.getUTCDate()).padStart(2,'0')}-${_M[_dt.getUTCMonth()]}-${_dt.getUTCFullYear()}` })()}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-xs font-mono font-semibold">{p.tax_declarations.declaration_category}</p>
                    <p className="text-[10px] text-muted-foreground">{p.tax_declarations.section}</p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={(DOCUMENT_STATE_BADGE[p.document_state] ?? 'secondary') as any}
                      className="rounded-full text-[10px] capitalize"
                    >
                      {p.document_state.replace('_', ' ')}
                    </Badge>
                    {p.rejection_reason && (
                      <p className="text-[10px] text-destructive mt-0.5 max-w-[140px] truncate">{p.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(p.document_state === 'uploaded' || p.document_state === 'under_review') && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1 text-success border-success/30 hover:bg-success/10"
                          disabled={verifyMutation.isPending && verifyMutation.variables?.id === p.id}
                          onClick={() => verifyMutation.mutate({ id: p.id })}
                        >
                          {verifyMutation.isPending && verifyMutation.variables?.id === p.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <CheckCircle2 className="h-3 w-3" />
                          }
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => setRejectTarget(p)}
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && (
        <RejectDialog
          title={`Reject Proof — ${rejectTarget.file_name}`}
          isPending={rejectMutation.isPending}
          onConfirm={reason => rejectMutation.mutate({ id: rejectTarget.id, rejection_reason: reason })}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </>
  )
}

// ── TDSProjectionsTab ─────────────────────────────────────────────────────────

function TDSProjectionsTab({ selectedMonth }: { selectedMonth: string }) {
  const { data: projections, isLoading, isError } = useQuery<TDSProjectionRow[]>({
    queryKey:  ['tds-projections', selectedMonth],
    queryFn:   () => api.get(`/payroll/statutory/tds/projections?month=${selectedMonth}`)
      .then((r: any) => Array.isArray(r?.data) ? r.data : []),
    staleTime: 30_000,
  })

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
  if (isError) return (
    <div className="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" />
      Failed to load TDS projections.
    </div>
  )

  const list = Array.isArray(projections) ? projections : []

  if (list.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No projections for this month.</div>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee</th>
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Regime</th>
            <th className="text-right text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Gross Income</th>
            <th className="text-right text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Taxable Income</th>
            <th className="text-right text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">TDS This Month</th>
          </tr>
        </thead>
        <tbody>
          {list.map(p => (
            <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="px-3 py-2">
                <p className="text-xs font-medium">{empName(p)}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{empCode(p)}</p>
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={p.regime === 'new' ? 'success' : 'secondary'}
                  className="rounded-full text-[10px] capitalize"
                >
                  {p.regime}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right text-xs font-mono">
                {fmtCurrency(p.gross_income_projected)}
              </td>
              <td className="px-3 py-2 text-right text-xs font-mono">
                {fmtCurrency(p.taxable_income_projected)}
              </td>
              <td className={cn(
                'px-3 py-2 text-right text-xs font-mono font-semibold',
                p.tds_this_month > 0 ? 'text-foreground' : 'text-muted-foreground',
              )}>
                {fmtCurrency(p.tds_this_month)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabId = 'declarations' | 'proofs' | 'projections'

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'declarations', label: 'Declarations',      icon: FileText   },
  { id: 'proofs',       label: 'Proof Submissions',  icon: Receipt    },
  { id: 'projections',  label: 'TDS Projections',   icon: TrendingUp },
]

export function TDSManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const todayYM         = new Date().toISOString().slice(0, 7)
  const [activeTab,      setActiveTab]       = useState<TabId>('declarations')
  const [financialYear,  setFinancialYear]   = useState(currentFY())
  const [selectedMonth,  setSelectedMonth]   = useStatutoryMonth()   // shared across Compliance tabs

  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard title="Access Restricted">
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm">Only HR admins can access TDS management.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['tds-declarations', financialYear] })
    qc.invalidateQueries({ queryKey: ['tds-proofs', financialYear] })
    qc.invalidateQueries({ queryKey: ['tds-projections', selectedMonth] })
  }

  return (
    <PageContainer>
      <PageHeader
        title="TDS Management"
        subtitle="Manage tax declarations, proof verification, and monthly TDS projections"
        actions={
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Tab Navigation */}
      <SubTabs<typeof activeTab>
        tabs={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab Content */}
      <SectionCard
        title={TABS.find(t => t.id === activeTab)?.label ?? ''}
        action={
          activeTab === 'projections' ? (
            <Input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="h-7 text-xs w-36"
            />
          ) : (
            <Input
              placeholder="FY e.g. 2025-26"
              value={financialYear}
              onChange={e => setFinancialYear(e.target.value)}
              className="h-7 text-xs w-28"
            />
          )
        }
      >
        {activeTab === 'declarations' && (
          <DeclarationsTab financialYear={financialYear} />
        )}
        {activeTab === 'proofs' && (
          <ProofSubmissionsTab financialYear={financialYear} />
        )}
        {activeTab === 'projections' && (
          <TDSProjectionsTab selectedMonth={selectedMonth} />
        )}
      </SectionCard>
    </PageContainer>
  )
}
