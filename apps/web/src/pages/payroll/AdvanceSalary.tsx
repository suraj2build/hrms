/**
 * AdvanceSalary — /admin/payroll/advances
 *
 * HR admin view: manage salary advance requests and recovery schedules.
 * Access: admin only (super_admin, hr_admin).
 */

import { useState }                                from 'react'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Loader2, RefreshCw, CheckCircle2, XCircle,
  DollarSign, Search,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import { DateInput }      from '@/components/ui/date-input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast }          from 'sonner'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdvanceRequest {
  id:                string
  employee_id:       string
  requested_amount:  number
  approved_amount:   number | null
  recovery_months:   number
  purpose:           string | null
  status:            'pending' | 'approved' | 'rejected' | 'disbursed' | 'closed'
  disbursement_date: string | null
  created_at:        string
  employee_name?:    string
  employee_code?:    string
}

interface RecoverySchedule {
  id:               string
  advance_id:       string
  recovery_month:   string
  scheduled_amount: number
  recovered_amount: number
  status:           'pending' | 'recovered' | 'waived'
  recovered_at:     string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'warning' | 'success' | 'destructive' | 'secondary' | 'outline'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'destructive',
  disbursed: 'outline',
  closed:    'secondary',
}

const RECOVERY_BADGE: Record<string, 'warning' | 'success' | 'secondary'> = {
  pending:   'warning',
  recovered: 'success',
  waived:    'secondary',
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const s = d
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ApproveDialog({
  open,
  advance,
  onClose,
}: {
  open: boolean
  advance: AdvanceRequest | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [approvedAmount, setApprovedAmount]     = useState('')
  const [recoveryMonths, setRecoveryMonths]     = useState('12')
  const [disbursementDate, setDisbursementDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/payroll/advances/${advance!.id}/approve`, {
        approved_amount:   Number(approvedAmount),
        recovery_months:   Number(recoveryMonths),
        disbursement_date: disbursementDate,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      onClose()
      toast.success('Advance approved', { description: `₹${Number(approvedAmount).toLocaleString('en-IN')} over ${recoveryMonths} months` })
    },
    onError: (e: Error) => toast.error('Failed to approve advance', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve Advance Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {advance && (
            <p className="text-sm text-muted-foreground">
              Employee: <span className="text-foreground font-medium">{advance.employee_name ?? advance.employee_id}</span>
              {advance.employee_code && (
                <span className="ml-2 text-muted-foreground">({advance.employee_code})</span>
              )}
            </p>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Approved Amount (₹)</label>
            <Input
              type="number"
              value={approvedAmount}
              onChange={e => setApprovedAmount(e.target.value)}
              placeholder={advance ? String(advance.requested_amount) : ''}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Recovery Months (1–24)</label>
            <Input
              type="number"
              min={1}
              max={24}
              value={recoveryMonths}
              onChange={e => setRecoveryMonths(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Disbursement Date</label>
            <DateInput
              value={disbursementDate}
              onChange={setDisbursementDate}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!approvedAmount || !disbursementDate || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({
  open,
  advance,
  onClose,
}: {
  open: boolean
  advance: AdvanceRequest | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/payroll/advances/${advance!.id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      onClose()
      setReason('')
      toast.success('Advance request rejected')
    },
    onError: (e: Error) => toast.error('Failed to reject request', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Advance Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Rejection Reason</label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Enter reason..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => mutation.mutate()}
              disabled={!reason || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AdvanceSalary() {
  const { profile }   = useAuthStore()
  const isAdmin       = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc            = useQueryClient()

  const [approveTarget, setApproveTarget]   = useState<AdvanceRequest | null>(null)
  const [rejectTarget, setRejectTarget]     = useState<AdvanceRequest | null>(null)
  const [advanceId, setAdvanceId]           = useState('')
  const [loadedAdvanceId, setLoadedAdvanceId] = useState<string | null>(null)

  // Requests
  const { data: advances = [], isLoading, refetch } = useQuery<AdvanceRequest[]>({
    queryKey: ['advances'],
    queryFn:  () => api.get('/payroll/advances').then((r: any) => r.data),
  })

  // Recovery schedule
  const { data: schedule = [], isLoading: schedLoading } = useQuery<RecoverySchedule[]>({
    queryKey: ['advance-schedule', loadedAdvanceId],
    queryFn:  () =>
      api.get(`/payroll/advances/${loadedAdvanceId}/schedule`).then((r: any) => r.data),
    enabled: !!loadedAdvanceId,
  })

  const disburseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/advances/${id}/disburse`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      toast.success('Advance marked as disbursed')
    },
    onError: (e: Error) => toast.error('Failed to disburse advance', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Advance Salary"
        subtitle="Manage salary advance requests and recovery schedules"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      <Tabs defaultValue="requests">
        <TabsList className="mb-4">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="recovery">Recovery Schedule</TabsTrigger>
        </TabsList>

        {/* ── Requests Tab ── */}
        <TabsContent value="requests">
          <SectionCard title="Advance Requests">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : advances.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <DollarSign className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No advance requests found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Employee</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Requested</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Approved</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Months</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Purpose</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Status</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Created</th>
                      {isAdmin && <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {advances.map(adv => (
                      <tr key={adv.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-foreground">
                            {adv.employee_name ?? adv.employee_id}
                          </div>
                          {adv.employee_code && (
                            <div className="text-xs text-muted-foreground">{adv.employee_code}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(adv.requested_amount)}</td>
                        <td className="py-3 px-4 text-right text-foreground">
                          {adv.approved_amount != null ? fmt(adv.approved_amount) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right text-foreground">{adv.recovery_months}</td>
                        <td className="py-3 px-4 text-muted-foreground max-w-[160px] truncate">
                          {adv.purpose ?? '—'}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={STATUS_BADGE[adv.status] ?? 'secondary'}>
                            {adv.status.charAt(0).toUpperCase() + adv.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{fmtDate(adv.created_at)}</td>
                        {isAdmin && (
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {adv.status === 'pending' && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setApproveTarget(adv)}>
                                    <CheckCircle2 className="h-3 w-3" /> Approve
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setRejectTarget(adv)}>
                                    <XCircle className="h-3 w-3" /> Reject
                                  </Button>
                                </>
                              )}
                              {adv.status === 'approved' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={disburseMutation.isPending} onClick={() => disburseMutation.mutate(adv.id)}>
                                  <DollarSign className="h-3 w-3" /> Mark Disbursed
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
        </TabsContent>

        {/* ── Recovery Schedule Tab ── */}
        <TabsContent value="recovery">
          <SectionCard title="Recovery Schedule">
            <div className="flex items-center gap-3 mb-6">
              <Input
                className="max-w-xs"
                placeholder="Enter Advance ID (UUID)"
                value={advanceId}
                onChange={e => setAdvanceId(e.target.value)}
              />
              <Button variant="outline" onClick={() => setLoadedAdvanceId(advanceId.trim())} disabled={!advanceId.trim()}>
                <Search className="mr-2 h-4 w-4" /> Load
              </Button>
            </div>

            {!loadedAdvanceId ? (
              <p className="text-sm text-muted-foreground">Enter an Advance ID above and click Load.</p>
            ) : schedLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : schedule.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <Search className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No recovery records found for this advance.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Month</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Scheduled</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Recovered</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Status</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Recovered At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map(row => (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-foreground">{row.recovery_month}</td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(row.scheduled_amount)}</td>
                        <td className="py-3 px-4 text-right text-foreground">{fmt(row.recovered_amount)}</td>
                        <td className="py-3 px-4">
                          <Badge variant={RECOVERY_BADGE[row.status] ?? 'secondary'}>
                            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{fmtDate(row.recovered_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ApproveDialog
        open={!!approveTarget}
        advance={approveTarget}
        onClose={() => setApproveTarget(null)}
      />
      <RejectDialog
        open={!!rejectTarget}
        advance={rejectTarget}
        onClose={() => setRejectTarget(null)}
      />
    </PageContainer>
  )
}
