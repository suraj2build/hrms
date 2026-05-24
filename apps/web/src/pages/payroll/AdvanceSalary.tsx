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

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

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
            <Input
              type="date"
              value={disbursementDate}
              onChange={e => setDisbursementDate(e.target.value)}
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

  const [activeTab, setActiveTab]           = useState<'requests' | 'recovery'>('requests')
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

  const tabs = [
    { key: 'requests', label: 'Requests' },
    { key: 'recovery', label: 'Recovery Schedule' },
  ] as const

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

      {/* ── Requests Tab ── */}
      {activeTab === 'requests' && (
        <SectionCard title="Advance Requests">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : advances.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No advance requests found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Employee</th>
                    <th className="text-right py-3 px-4 font-medium">Requested</th>
                    <th className="text-right py-3 px-4 font-medium">Approved</th>
                    <th className="text-right py-3 px-4 font-medium">Months</th>
                    <th className="text-left py-3 px-4 font-medium">Purpose</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Created</th>
                    {isAdmin && <th className="text-left py-3 px-4 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {advances.map(adv => (
                    <tr key={adv.id} className="border-b border-border hover:bg-muted/40 transition-colors">
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
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setApproveTarget(adv)}
                                >
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRejectTarget(adv)}
                                >
                                  <XCircle className="mr-1 h-3 w-3" /> Reject
                                </Button>
                              </>
                            )}
                            {adv.status === 'approved' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={disburseMutation.isPending}
                                onClick={() => disburseMutation.mutate(adv.id)}
                              >
                                <DollarSign className="mr-1 h-3 w-3" /> Mark Disbursed
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

      {/* ── Recovery Schedule Tab ── */}
      {activeTab === 'recovery' && (
        <SectionCard title="Recovery Schedule">
          <div className="flex items-center gap-3 mb-6">
            <Input
              className="max-w-xs"
              placeholder="Enter Advance ID (UUID)"
              value={advanceId}
              onChange={e => setAdvanceId(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => setLoadedAdvanceId(advanceId.trim())}
              disabled={!advanceId.trim()}
            >
              <Search className="mr-2 h-4 w-4" /> Load
            </Button>
          </div>

          {!loadedAdvanceId ? (
            <p className="text-muted-foreground text-sm">Enter an Advance ID above and click Load.</p>
          ) : schedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : schedule.length === 0 ? (
            <p className="text-muted-foreground py-6">No recovery records found for this advance.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">Month</th>
                    <th className="text-right py-3 px-4 font-medium">Scheduled</th>
                    <th className="text-right py-3 px-4 font-medium">Recovered</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Recovered At</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map(row => (
                    <tr key={row.id} className="border-b border-border hover:bg-muted/40 transition-colors">
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
      )}

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
