/**
 * ProbationConfirmations — /admin/employees/probation-confirmations
 *
 * HR admin decision queue for the Probation Confirmation workflow
 * (migration 439). A manager recommends confirm/extend with feedback via
 * /manager/team/lifecycle/confirmation-recommend; this page is where HR
 * makes the actual decision — confirming sets job_history.confirmation_date,
 * extending records a new due date instead of silently re-using the stale
 * formula-derived one.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Clock, CalendarClock, Filter, Loader2, UserCheck } from 'lucide-react'
import { api } from '@/lib/api/client'
import { cn, fmtDate } from '@/lib/utils'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DateInput } from '@/components/ui/date-input'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = 'pending_hr' | 'extended' | 'confirmed'

interface ProbationConfirmationRow {
  id: string
  employee_id: string
  employee_name: string | null
  employee_code: string | null
  due_date: string
  status: Status
  is_overdue: boolean
  manager_recommendation: 'confirm' | 'extend' | null
  manager_feedback: string | null
  manager_recommended_at: string | null
  manager_name: string | null
  hr_decision: 'confirm' | 'extend' | null
  hr_decision_notes: string | null
  extended_to_date: string | null
  decided_at: string | null
  decided_by_name: string | null
  version: number
}

const TABS: { key: Status; label: string }[] = [
  { key: 'pending_hr', label: 'Pending HR Decision' },
  { key: 'extended',   label: 'Extended' },
  { key: 'confirmed',  label: 'Confirmed' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProbationConfirmations() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Status>('pending_hr')
  const [decideTarget, setDecideTarget] = useState<ProbationConfirmationRow | null>(null)
  const [decision, setDecision] = useState<'confirm' | 'extend'>('confirm')
  const [extendedToDate, setExtendedToDate] = useState('')
  const [notes, setNotes] = useState('')

  const { data, isLoading } = useQuery<{ data: ProbationConfirmationRow[] }>({
    queryKey: ['probation-confirmations', activeTab],
    queryFn:  () => api.get(`/probation-confirmations?status=${activeTab}`),
    staleTime: 30_000,
  })
  const rows = data?.data ?? []

  const { data: pendingCountData } = useQuery<{ data: ProbationConfirmationRow[] }>({
    queryKey: ['probation-confirmations', 'pending_hr'],
    queryFn:  () => api.get('/probation-confirmations?status=pending_hr'),
    staleTime: 30_000,
    enabled:   activeTab !== 'pending_hr',
  })
  const pendingCount = activeTab === 'pending_hr' ? rows.length : (pendingCountData?.data.length ?? 0)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['probation-confirmations'] })
  const versionConflict = useVersionConflict([['probation-confirmations']])

  function openDecide(row: ProbationConfirmationRow) {
    setDecideTarget(row)
    setDecision(row.manager_recommendation ?? 'confirm')
    setExtendedToDate('')
    setNotes('')
  }

  const decideMut = useMutation({
    mutationFn: (row: ProbationConfirmationRow) =>
      api.patch(`/probation-confirmations/${row.id}/decide`, withExpectedVersion({
        decision,
        notes: notes.trim() || undefined,
        extended_to_date: decision === 'extend' ? extendedToDate : undefined,
      }, row)),
    onSuccess: () => {
      toast.success(decision === 'confirm' ? 'Employee confirmed' : 'Probation extended')
      invalidate()
      qc.invalidateQueries({ queryKey: ['manager-team-lifecycle'] })
      setDecideTarget(null)
    },
    onError: (e: unknown) => {
      if (e instanceof Error && versionConflict(e)) return
      toast.error('Failed to record decision', { description: e instanceof Error ? e.message : undefined })
    },
  })

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Employees', href: '/admin/employees' }, { label: 'Probation Confirmations' }]}
        title="Probation Confirmations"
        subtitle="Decide on manager-recommended confirmations and probation extensions"
      />

      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-lg mb-4 w-fit">
        <Filter className="h-3.5 w-3.5 text-muted-foreground ml-1.5 mr-0.5 flex-shrink-0" />
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5',
              activeTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.key === 'pending_hr' && pendingCount > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">{pendingCount}</Badge>
            )}
          </button>
        ))}
      </div>

      <SectionCard title={TABS.find(t => t.key === activeTab)?.label ?? ''} icon={<UserCheck className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center text-muted-foreground">
            <CheckCircle2 className="h-6 w-6 opacity-30" />
            <p className="text-sm">Nothing here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="rounded-lg border border-border px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.employee_name ?? r.employee_id.slice(0, 8)}
                      {r.employee_code && <span className="text-muted-foreground font-normal"> · {r.employee_code}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {r.status === 'extended' && r.extended_to_date
                        ? `Extended to ${fmtDate(r.extended_to_date)}`
                        : `Due ${fmtDate(r.due_date)}`}
                      {r.is_overdue && <Badge variant="destructive" className="text-[9px] ml-1">Overdue</Badge>}
                    </p>
                  </div>
                  {r.status === 'pending_hr' && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => openDecide(r)}>
                      Decide
                    </Button>
                  )}
                  {r.status === 'confirmed' && <Badge variant="secondary" className="text-[9px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Confirmed</Badge>}
                  {r.status === 'extended'  && <Badge variant="warning" className="text-[9px] gap-1"><CalendarClock className="h-2.5 w-2.5" /> Extended</Badge>}
                </div>
                {(r.manager_recommendation || r.manager_feedback) && (
                  <div className="text-[11px] bg-muted/30 rounded-md px-2 py-1.5">
                    <span className="font-medium">
                      {r.manager_name ?? 'Manager'} recommends {r.manager_recommendation === 'extend' ? 'extending' : 'confirming'}
                    </span>
                    {r.manager_feedback && <span className="text-muted-foreground"> — {r.manager_feedback}</span>}
                  </div>
                )}
                {r.hr_decision_notes && (
                  <div className="text-[11px] text-muted-foreground">
                    HR notes: {r.hr_decision_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Decide dialog */}
      <Dialog open={!!decideTarget} onOpenChange={(v) => { if (!v) setDecideTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decide — {decideTarget?.employee_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {decideTarget?.manager_feedback && (
              <div className="text-xs bg-muted/30 rounded-md px-2.5 py-2">
                <span className="font-medium">{decideTarget.manager_name ?? 'Manager'}'s feedback:</span>{' '}
                {decideTarget.manager_feedback}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={decision === 'confirm' ? 'default' : 'outline'}
                className="flex-1 gap-1.5" onClick={() => setDecision('confirm')}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
              </Button>
              <Button type="button" size="sm" variant={decision === 'extend' ? 'default' : 'outline'}
                className="flex-1 gap-1.5" onClick={() => setDecision('extend')}>
                <CalendarClock className="h-3.5 w-3.5" /> Extend
              </Button>
            </div>
            {decision === 'extend' && (
              <div className="space-y-1.5">
                <Label className="text-xs">New confirmation due date</Label>
                <DateInput value={extendedToDate} onChange={setExtendedToDate} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDecideTarget(null)}>Cancel</Button>
            <Button size="sm"
              disabled={decideMut.isPending || (decision === 'extend' && !extendedToDate)}
              onClick={() => decideTarget && decideMut.mutate(decideTarget)}>
              {decideMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {decision === 'confirm' ? 'Confirm Employee' : 'Extend Probation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
