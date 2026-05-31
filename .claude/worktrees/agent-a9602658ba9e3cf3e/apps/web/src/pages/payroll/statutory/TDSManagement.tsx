/**
 * TDSManagement — /admin/payroll/statutory/tds
 *
 * HR admin page for managing TDS: tax declarations (verify/reject),
 * proof submissions (approve/reject), and TDS projections.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, XCircle, FileText, Receipt,
  TrendingUp,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
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
import { toast }          from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaxDeclarationItem {
  id: string
  employee_id: string
  financial_year: string
  declaration_type: string
  section_code: string
  declared_amount: number
  status: 'pending' | 'verified' | 'rejected'
  employee_name?: string
  employee_code?: string
}

interface TDSProjection {
  id: string
  employee_id: string
  financial_year: string
  month: string
  projected_tds: number
  actual_tds: number | null
  regime: 'old' | 'new'
  employee_name?: string
}

interface ProofSubmission {
  id: string
  declaration_id: string
  proof_type: string
  claimed_amount: number
  status: 'pending' | 'approved' | 'rejected'
  employee_name?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function currentFY(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${String(year + 1).slice(2)}`
}

const DECLARATION_STATUS_BADGE: Record<string, string> = {
  pending:  'warning',
  verified: 'success',
  rejected: 'destructive',
}

const PROOF_STATUS_BADGE: Record<string, string> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
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
              Rejection Reason
            </label>
            <Input
              placeholder="Enter reason for rejection…"
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
  const [rejectTarget, setRejectTarget] = useState<TaxDeclarationItem | null>(null)

  const {
    data: declarations,
    isLoading,
    isError,
  } = useQuery<TaxDeclarationItem[]>({
    queryKey: ['tds-declarations', financialYear],
    queryFn:  () => api.get(`/payroll/statutory/tds/declarations?financial_year=${financialYear}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    staleTime: 30_000,
  })

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.put(`/payroll/statutory/tds/declarations/${id}/verify`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds-declarations', financialYear] })
      toast.success('Declaration verified')
    },
    onError: (e: any) => toast.error('Verification failed', { description: (e as any)?.message }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.put(`/payroll/statutory/tds/declarations/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      setRejectTarget(null)
      qc.invalidateQueries({ queryKey: ['tds-declarations', financialYear] })
      toast.success('Declaration rejected')
    },
    onError: (e: any) => toast.error('Rejection failed', { description: (e as any)?.message }),
  })

  if (isLoading) return <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
  if (isError)   return (
    <div className="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" />
      Failed to load declarations.
    </div>
  )

  const list = Array.isArray(declarations) ? declarations : []

  if (list.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Section</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Declaration Type</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Declared Amount</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Status</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map(d => (
              <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <p className="text-xs font-medium">{d.employee_name ?? '—'}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{d.employee_code ?? ''}</p>
                </td>
                <td className="px-3 py-2 text-xs font-mono font-semibold">{d.section_code}</td>
                <td className="px-3 py-2 text-xs capitalize">{d.declaration_type}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(d.declared_amount)}</td>
                <td className="px-3 py-2">
                  <Badge
                    variant={(DECLARATION_STATUS_BADGE[d.status] ?? 'secondary') as any}
                    className="rounded-full text-[10px] capitalize"
                  >
                    {d.status}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {d.status === 'pending' && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 text-success border-success/30 hover:bg-success/10"
                        disabled={verifyMutation.isPending && verifyMutation.variables === d.id}
                        onClick={() => verifyMutation.mutate(d.id)}
                      >
                        {verifyMutation.isPending && verifyMutation.variables === d.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <CheckCircle2 className="h-3 w-3" />
                        }
                        Verify
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
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejectTarget && (
        <RejectDialog
          title={`Reject Declaration — ${rejectTarget.section_code}`}
          isPending={rejectMutation.isPending}
          onConfirm={reason => rejectMutation.mutate({ id: rejectTarget.id, reason })}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </>
  )
}

// ── ProofSubmissionsTab ───────────────────────────────────────────────────────

function ProofSubmissionsTab({ financialYear }: { financialYear: string }) {
  const qc = useQueryClient()
  const [rejectTarget, setRejectTarget] = useState<ProofSubmission | null>(null)

  const {
    data: proofs,
    isLoading,
    isError,
  } = useQuery<ProofSubmission[]>({
    queryKey: ['tds-proofs', financialYear],
    queryFn:  () => api.get(`/payroll/statutory/tds/proofs?financial_year=${financialYear}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    staleTime: 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/payroll/statutory/tds/proofs/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds-proofs', financialYear] })
      toast.success('Proof submission approved')
    },
    onError: (e: any) => toast.error('Approval failed', { description: (e as any)?.message }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.put(`/payroll/statutory/tds/proofs/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      setRejectTarget(null)
      qc.invalidateQueries({ queryKey: ['tds-proofs', financialYear] })
      toast.success('Proof submission rejected')
    },
    onError: (e: any) => toast.error('Rejection failed', { description: (e as any)?.message }),
  })

  if (isLoading) return <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
  if (isError)   return (
    <div className="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" />
      Failed to load proof submissions.
    </div>
  )

  const list = Array.isArray(proofs) ? proofs : []

  if (list.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Proof Type</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Claimed Amount</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Status</th>
              <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-3 py-2 text-xs font-medium">{p.employee_name ?? '—'}</td>
                <td className="px-3 py-2 text-xs capitalize">{p.proof_type}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(p.claimed_amount)}</td>
                <td className="px-3 py-2">
                  <Badge
                    variant={(PROOF_STATUS_BADGE[p.status] ?? 'secondary') as any}
                    className="rounded-full text-[10px] capitalize"
                  >
                    {p.status}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {p.status === 'pending' && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 text-success border-success/30 hover:bg-success/10"
                        disabled={approveMutation.isPending && approveMutation.variables === p.id}
                        onClick={() => approveMutation.mutate(p.id)}
                      >
                        {approveMutation.isPending && approveMutation.variables === p.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <CheckCircle2 className="h-3 w-3" />
                        }
                        Approve
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

      {rejectTarget && (
        <RejectDialog
          title={`Reject Proof — ${rejectTarget.proof_type}`}
          isPending={rejectMutation.isPending}
          onConfirm={reason => rejectMutation.mutate({ id: rejectTarget.id, reason })}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </>
  )
}

// ── TDSProjectionsTab ─────────────────────────────────────────────────────────

function TDSProjectionsTab({ selectedMonth }: { selectedMonth: string }) {
  const {
    data: projections,
    isLoading,
    isError,
  } = useQuery<TDSProjection[]>({
    queryKey: ['tds-projections', selectedMonth],
    queryFn:  () => api.get(`/payroll/statutory/tds/projections?month=${selectedMonth}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    staleTime: 30_000,
  })

  if (isLoading) return <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
  if (isError)   return (
    <div className="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle className="h-3.5 w-3.5" />
      Failed to load TDS projections.
    </div>
  )

  const list = Array.isArray(projections) ? projections : []

  if (list.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee</th>
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Regime</th>
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Projected TDS</th>
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Actual TDS</th>
            <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Diff</th>
          </tr>
        </thead>
        <tbody>
          {list.map(p => {
            const diff = p.actual_tds != null ? p.actual_tds - p.projected_tds : null
            return (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <p className="text-xs font-medium">{p.employee_name ?? '—'}</p>
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant={p.regime === 'new' ? 'success' : 'secondary'}
                    className="rounded-full text-[10px] capitalize"
                  >
                    {p.regime}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(p.projected_tds)}</td>
                <td className="px-3 py-2 text-xs font-mono">
                  {p.actual_tds != null ? fmtCurrency(p.actual_tds) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className={cn(
                  'px-3 py-2 text-xs font-mono font-semibold',
                  diff == null
                    ? 'text-muted-foreground'
                    : diff > 0 ? 'text-destructive' : diff < 0 ? 'text-success' : 'text-muted-foreground',
                )}>
                  {diff == null
                    ? '—'
                    : diff === 0 ? '—' : diff > 0 ? `+${fmtCurrency(diff)}` : fmtCurrency(diff)
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabId = 'declarations' | 'proofs' | 'projections'

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'declarations', label: 'Declarations',     icon: FileText   },
  { id: 'proofs',       label: 'Proof Submissions', icon: Receipt    },
  { id: 'projections',  label: 'TDS Projections',  icon: TrendingUp },
]

export function TDSManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const todayYM       = new Date().toISOString().slice(0, 7)
  const [activeTab, setActiveTab]       = useState<TabId>('declarations')
  const [financialYear, setFinancialYear] = useState(currentFY())
  const [selectedMonth, setSelectedMonth] = useState(todayYM)

  // ── Guard ─────────────────────────────────────────────────────────────────────
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
        subtitle="Manage tax declarations, proof submissions, and TDS projections"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

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
