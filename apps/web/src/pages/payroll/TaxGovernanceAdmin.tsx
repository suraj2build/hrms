/**
 * TaxGovernanceAdmin — /admin/payroll/tax-governance-admin
 *
 * Admin page for managing:
 *   - Previous employer declaration verifications
 *   - HRA declaration verifications
 *
 * Access: hr_admin and super_admin only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, Loader2, AlertCircle,
  Building2, Home, ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Label }         from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api }                from '@/lib/api/client'
import { useAuthStore }       from '@/stores/authStore'
import { cn }                 from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const CURRENT_FY = '2025-26'
const FY_OPTIONS = ['2025-26', '2024-25', '2023-24']

type RecordStatus = 'pending' | 'under_review' | 'verified' | 'rejected'

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all',          label: 'All Statuses' },
  { value: 'pending',      label: 'Pending' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'verified',     label: 'Verified' },
  { value: 'rejected',     label: 'Rejected' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrevEmployerAdmin {
  id: string
  financial_year: string
  employee_id: string
  employee_name: string
  employer_name: string
  employer_tan: string | null
  gross_income: number
  tds_deducted: number
  pf_deducted: number
  professional_tax: number
  status: RecordStatus
  rejection_reason: string | null
  created_at: string
}

interface HRAAdmin {
  id: string
  financial_year: string
  employee_id: string
  employee_name: string
  from_month: string
  to_month: string
  monthly_rent: number
  landlord_name: string | null
  landlord_pan: string | null
  city: string | null
  is_metro: boolean
  status: RecordStatus
  rejection_reason: string | null
  created_at: string
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RecordStatus }) {
  const map: Record<RecordStatus, { label: string; cls: string }> = {
    pending:      { label: 'Pending',      cls: 'bg-warning/15 text-warning border-warning/30' },
    under_review: { label: 'Under Review', cls: 'bg-info/15 text-info border-info/30' },
    verified:     { label: 'Verified',     cls: 'bg-success/15 text-success border-success/30' },
    rejected:     { label: 'Rejected',     cls: 'bg-destructive/15 text-destructive border-destructive/30' },
  }
  const { label, cls } = map[status] ?? map.pending
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', cls)}>
      {label}
    </Badge>
  )
}

// ── Month range helper ────────────────────────────────────────────────────────

function monthsBetween(from: string, to: string): number {
  if (!from || !to) return 0
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1)
}

// ── Reject dialog ─────────────────────────────────────────────────────────────

interface RejectTarget {
  id: string
  type: 'prev-employer' | 'hra'
}

function RejectDialog({
  target,
  onClose,
  onConfirm,
  isPending,
}: {
  target: RejectTarget | null
  onClose: () => void
  onConfirm: (id: string, type: RejectTarget['type'], reason: string) => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) { toast.error('Rejection reason is required.'); return }
    if (target) onConfirm(target.id, target.type, reason.trim())
  }

  return (
    <Dialog open={!!target} onOpenChange={open => { if (!open) { setReason(''); onClose() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject Declaration</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="reject_reason">
              Rejection Reason <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="reject_reason"
              placeholder="Enter the reason for rejection…"
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              rows={3}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setReason(''); onClose() }} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending} className="gap-2">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Previous Employer Tab ─────────────────────────────────────────────────────

function PrevEmployerTab({ fy }: { fy: string }) {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null)

  const queryUrl = `/payroll/statutory/tds/previous-employment/admin?financial_year=${fy}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`

  const { data: records = [], isLoading, isError } = useQuery<PrevEmployerAdmin[]>({
    queryKey: ['prev-employer-admin', fy, statusFilter],
    queryFn:  () => api.get(queryUrl),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['prev-employer-admin', fy, statusFilter] })

  const verifyMutation = useMutation({
    mutationFn: ({ id, status, rejection_reason }: { id: string; status: 'verified' | 'rejected'; rejection_reason?: string }) =>
      api.put(`/payroll/statutory/tds/previous-employment/${id}/verify`, { status, rejection_reason }),
    onSuccess: (_, vars) => {
      toast.success(vars.status === 'verified' ? 'Declaration verified.' : 'Declaration rejected.')
      invalidate()
      setRejectTarget(null)
    },
    onError: () => toast.error('Action failed. Please try again.'),
  })

  function handleVerify(id: string) {
    verifyMutation.mutate({ id, status: 'verified' })
  }

  function handleRejectConfirm(id: string, _type: RejectTarget['type'], reason: string) {
    verifyMutation.mutate({ id, status: 'rejected', rejection_reason: reason })
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-sm font-medium">Status</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading records…</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Failed to load records.</span>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <Building2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">No previous employer declarations found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Employee</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Employer Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">TAN</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Gross Income</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">TDS</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr className="border-b hover:bg-muted/30 transition-colors" key={r.id}>
                  <td className="px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{r.employee_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.employee_id}</p>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{r.employer_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {r.employer_tan ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.gross_income)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.tds_deducted)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={r.status} />
                      {r.status === 'rejected' && r.rejection_reason && (
                        <p className="text-xs text-destructive max-w-[160px] truncate" title={r.rejection_reason}>
                          {r.rejection_reason}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {(r.status === 'pending' || r.status === 'under_review') && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-success hover:text-success hover:bg-success/10 gap-1"
                          onClick={() => handleVerify(r.id)}
                          disabled={verifyMutation.isPending}
                          title="Verify"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Verify
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                          onClick={() => setRejectTarget({ id: r.id, type: 'prev-employer' })}
                          disabled={verifyMutation.isPending}
                          title="Reject"
                        >
                          <XCircle className="h-3.5 w-3.5" />
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

      <RejectDialog
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleRejectConfirm}
        isPending={verifyMutation.isPending}
      />
    </div>
  )
}

// ── HRA Tab ───────────────────────────────────────────────────────────────────

function HRATab({ fy }: { fy: string }) {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null)

  const queryUrl = `/payroll/statutory/tds/hra/admin?financial_year=${fy}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`

  const { data: records = [], isLoading, isError } = useQuery<HRAAdmin[]>({
    queryKey: ['hra-admin', fy, statusFilter],
    queryFn:  () => api.get(queryUrl),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['hra-admin', fy, statusFilter] })

  const verifyMutation = useMutation({
    mutationFn: ({ id, status, rejection_reason }: { id: string; status: 'verified' | 'rejected'; rejection_reason?: string }) =>
      api.put(`/payroll/statutory/tds/hra/${id}/verify`, { status, rejection_reason }),
    onSuccess: (_, vars) => {
      toast.success(vars.status === 'verified' ? 'HRA declaration verified.' : 'HRA declaration rejected.')
      invalidate()
      setRejectTarget(null)
    },
    onError: () => toast.error('Action failed. Please try again.'),
  })

  function handleVerify(id: string) {
    verifyMutation.mutate({ id, status: 'verified' })
  }

  function handleRejectConfirm(id: string, _type: RejectTarget['type'], reason: string) {
    verifyMutation.mutate({ id, status: 'rejected', rejection_reason: reason })
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-sm font-medium">Status</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading records…</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Failed to load records.</span>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <Home className="h-8 w-8 opacity-40" />
          <p className="text-sm">No HRA declarations found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Employee</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Landlord</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Monthly Rent</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Annual Rent</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">PAN</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">City</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const m = monthsBetween(r.from_month, r.to_month)
                const annual = r.monthly_rent * m
                return (
                  <tr className="border-b hover:bg-muted/30 transition-colors" key={r.id}>
                    <td className="px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{r.employee_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{r.employee_id}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm">{r.landlord_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.monthly_rent)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(annual)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.landlord_pan ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {r.city
                        ? `${r.city}${r.is_metro ? ' (Metro)' : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={r.status} />
                        {r.status === 'rejected' && r.rejection_reason && (
                          <p className="text-xs text-destructive max-w-[160px] truncate" title={r.rejection_reason}>
                            {r.rejection_reason}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {(r.status === 'pending' || r.status === 'under_review') && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-success hover:text-success hover:bg-success/10 gap-1"
                            onClick={() => handleVerify(r.id)}
                            disabled={verifyMutation.isPending}
                            title="Verify"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Verify
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                            onClick={() => setRejectTarget({ id: r.id, type: 'hra' })}
                            disabled={verifyMutation.isPending}
                            title="Reject"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <RejectDialog
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleRejectConfirm}
        isPending={verifyMutation.isPending}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TaxGovernanceAdmin() {
  const profile = useAuthStore(s => s.profile)
  const [fy, setFy] = useState(CURRENT_FY)

  const isAdmin = profile?.role === 'hr_admin' || profile?.role === 'super_admin'

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Tax Governance Admin"
          subtitle="Manage previous employer and HRA verifications."
        />
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <ShieldCheck className="h-10 w-10 opacity-30" />
          <p className="text-sm">You do not have permission to access this page.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Tax Governance Admin"
        subtitle="Review and verify previous employer declarations and HRA submissions from employees."
      />

      {/* FY selector */}
      <div className="flex items-center gap-3 mb-6">
        <Label className="text-sm font-medium whitespace-nowrap">Financial Year</Label>
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FY_OPTIONS.map(y => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="prev-employer" className="space-y-4">
        <TabsList>
          <TabsTrigger value="prev-employer" className="gap-2">
            <Building2 className="h-4 w-4" />
            Previous Employer Verifications
          </TabsTrigger>
          <TabsTrigger value="hra" className="gap-2">
            <Home className="h-4 w-4" />
            HRA Verifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prev-employer">
          <SectionCard title="Previous Employer Declarations" icon={<Building2 className="h-4 w-4" />}>
            <PrevEmployerTab fy={fy} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="hra">
          <SectionCard title="HRA Declarations" icon={<Home className="h-4 w-4" />}>
            <HRATab fy={fy} />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
