/**
 * EssSeparation — /ess/separation
 *
 * Resignation & Exit (Program 4 · P4.3). The employee can submit ONE resignation
 * request and then track the whole exit: approval status, lifecycle stage,
 * department clearances, full & final settlement, and the company assets they
 * still hold and must return.
 *
 * Reuses the existing separation tables + HR workflow. The request lands as a
 * pending, employee-initiated row that HR drives forward — no new state machine.
 */

import { useState }                    from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                       from 'sonner'
import {
  LogOut, CalendarClock, ClipboardCheck, Wallet, Laptop,
  Loader2, AlertTriangle, CheckCircle2, Clock, XCircle, Info, Send,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Textarea }      from '@/components/ui/textarea'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { ExitInterviewForm } from '@/components/separation/ExitInterviewForm'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Separation {
  id: string
  separation_type: string
  initiated_by: string
  lifecycle_stage: string
  approval_status: string
  notice_date: string | null
  last_working_date: string | null
  exit_reason: string | null
  remarks: string | null
  clearance_done: boolean
}

interface Clearance {
  id: string; department: string; status: string; remarks: string | null; cleared_at: string | null
}

interface FfSummary {
  id: string; status: string; net_payable: number | null
  approved_at: string | null; paid_at: string | null
  leave_encashment_amount: number | null; gratuity_amount: number | null; notice_period_deduction: number | null
}

interface AssetItem {
  id: string; asset_code: string | null; name: string; serial_number: string | null; status: string; notes: string | null
}

interface SeparationResponse { data: Separation | null; clearances: Clearance[]; ff: FfSummary | null }

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function cap(s: string | null | undefined) {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const LIFECYCLE_STAGES = ['initiated', 'notice_period', 'clearance', 'fnf', 'relieving', 'relieved', 'archived'] as const
const STAGE_LABEL: Record<string, string> = {
  initiated: 'Submitted', notice_period: 'Notice Period', clearance: 'Clearance',
  fnf: 'Full & Final', relieving: 'Relieving', relieved: 'Relieved', archived: 'Archived',
}

const APPROVAL_VARIANT: Record<string, 'warning' | 'success' | 'destructive'> = {
  pending: 'warning', approved: 'success', rejected: 'destructive',
}

const CLEARANCE_VARIANT: Record<string, 'warning' | 'success' | 'destructive'> = {
  pending: 'warning', cleared: 'success', rejected: 'destructive',
}

const FF_VARIANT: Record<string, 'secondary' | 'success' | 'warning'> = {
  draft: 'warning', approved: 'success', paid: 'success',
}

// ── Lifecycle progress ───────────────────────────────────────────────────────────

function LifecycleProgress({ stage }: { stage: string }) {
  const currentIdx = Math.max(0, LIFECYCLE_STAGES.indexOf(stage as typeof LIFECYCLE_STAGES[number]))
  // Hide the terminal 'archived' from the employee-facing track for clarity.
  const visible = LIFECYCLE_STAGES.filter(s => s !== 'archived')
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {visible.map((s, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <div className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium whitespace-nowrap border',
              active ? 'bg-primary/10 border-primary/30 text-primary'
              : done ? 'bg-success/10 border-success/30 text-success'
              : 'bg-muted/40 border-border text-muted-foreground',
            )}>
              {done ? <CheckCircle2 className="h-3 w-3" /> : active ? <Clock className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
              {STAGE_LABEL[s]}
            </div>
            {i < visible.length - 1 && <div className={cn('h-px w-3', done ? 'bg-success/40' : 'bg-border')} />}
          </div>
        )
      })}
    </div>
  )
}

// ── Resignation form ─────────────────────────────────────────────────────────────

function ResignationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [lwd, setLwd]       = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [confirm, setConfirm] = useState(false)

  const mut = useMutation({
    mutationFn: () => api.post('/ess/me/separation', { last_working_date: lwd, exit_reason: reason, remarks: remarks || undefined }),
    onSuccess: () => { toast.success('Resignation submitted', { description: 'HR has been notified and will be in touch.' }); onSubmitted() },
    onError: (e: Error) => toast.error('Could not submit', { description: e.message }),
  })

  return (
    <SectionCard
      title="Submit Resignation"
      description="Once submitted, HR is notified and will guide you through notice period, clearances and your full & final settlement."
      icon={<LogOut className="h-4 w-4 text-muted-foreground" />}
    >
      <div className="space-y-3 max-w-2xl">
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          Submitting a resignation is a significant step. Your proposed last working day is subject to your notice period and HR approval.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Proposed last working day *</label>
            <Input type="date" className="h-9 text-sm" value={lwd} onChange={e => setLwd(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reason for leaving *</label>
          <Textarea rows={3} placeholder="Briefly tell us why you're moving on…" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Additional remarks (optional)</label>
          <Textarea rows={2} placeholder="Anything else HR should know" value={remarks} onChange={e => setRemarks(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
          I understand this initiates my exit process and notifies HR.
        </label>
        <div className="flex justify-end">
          <Button onClick={() => mut.mutate()} disabled={!lwd || !reason || !confirm || mut.isPending}>
            {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Submit Resignation
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

// ── Asset obligations ─────────────────────────────────────────────────────────────

function AssetObligations() {
  const { data, isLoading } = useQuery<{ data: AssetItem[]; outstanding_count: number }>({
    queryKey: ['ess-me-assets'],
    queryFn:  () => api.get('/ess/me/assets'),
  })
  const assets = data?.data ?? []

  return (
    <SectionCard
      title="Asset Obligations"
      description="Company assets currently assigned to you. Assigned items must be returned to HR/IT as part of clearance."
      icon={<Laptop className="h-4 w-4 text-muted-foreground" />}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading assets…</div>
      ) : assets.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" /> No company assets are assigned to you.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {assets.map(a => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {a.asset_code ? `${a.asset_code} · ` : ''}{a.serial_number ? `SN ${a.serial_number}` : 'No serial'}
                    </p>
                  </div>
                  <Badge variant={a.status === 'assigned' ? 'warning' : 'secondary'} className="rounded-full text-[10px] capitalize shrink-0">
                    {a.status === 'assigned' ? 'To return' : cap(a.status)}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ── Tracking view ─────────────────────────────────────────────────────────────────

function SeparationTracking({ sep, clearances, ff }: { sep: Separation; clearances: Clearance[]; ff: FfSummary | null }) {
  const { profile } = useAuthStore()
  const employeeId = profile?.employee_id ?? null
  const clearedCount = clearances.filter(c => c.status === 'cleared').length

  return (
    <div className="space-y-4">
      {/* Status header */}
      <SectionCard
        title="Exit Status"
        icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
        action={
          <Badge variant={APPROVAL_VARIANT[sep.approval_status] ?? 'secondary'} className="rounded-full text-[10px] capitalize">
            {sep.approval_status === 'pending' ? 'Awaiting HR' : cap(sep.approval_status)}
          </Badge>
        }
      >
        <div className="space-y-4">
          <LifecycleProgress stage={sep.lifecycle_stage} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type</p>
              <p className="text-sm font-medium capitalize">{cap(sep.separation_type)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Notice date</p>
              <p className="text-sm font-medium">{fmtDate(sep.notice_date)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Last working day</p>
              <p className="text-sm font-medium">{fmtDate(sep.last_working_date)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stage</p>
              <p className="text-sm font-medium">{STAGE_LABEL[sep.lifecycle_stage] ?? cap(sep.lifecycle_stage)}</p>
            </div>
          </div>
          {sep.exit_reason && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Your reason</p>
              <p className="text-sm text-foreground">{sep.exit_reason}</p>
            </div>
          )}
          {sep.approval_status === 'rejected' && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              Your resignation request was not accepted. Please speak with HR for next steps.
            </div>
          )}
        </div>
      </SectionCard>

      {/* Clearances */}
      <SectionCard
        title="Clearances"
        description="Department sign-offs required before relieving."
        icon={<ClipboardCheck className="h-4 w-4 text-muted-foreground" />}
        action={clearances.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{clearedCount}/{clearances.length} cleared</span>}
      >
        {clearances.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No clearances have been set up yet. HR will add these during your notice period.</p>
        ) : (
          <div className="space-y-2">
            {clearances.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{cap(c.department)}</p>
                  {c.remarks && <p className="text-[11px] text-muted-foreground truncate">{c.remarks}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.cleared_at && <span className="text-[10px] text-muted-foreground">{fmtDate(c.cleared_at)}</span>}
                  <Badge variant={CLEARANCE_VARIANT[c.status] ?? 'secondary'} className="rounded-full text-[10px] capitalize">{cap(c.status)}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Exit Interview */}
      {employeeId && (
        <SectionCard
          title="Exit Interview"
          description="Your candid feedback helps us improve. This is shared only with HR."
          icon={<ClipboardCheck className="h-4 w-4 text-muted-foreground" />}
        >
          <ExitInterviewForm employeeId={employeeId} />
        </SectionCard>
      )}

      {/* Full & Final */}
      <SectionCard
        title="Full & Final Settlement"
        description="Your final settlement, computed and approved by HR/Finance."
        icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
        action={ff && <Badge variant={FF_VARIANT[ff.status] ?? 'secondary'} className="rounded-full text-[10px] capitalize">{cap(ff.status)}</Badge>}
      >
        {!ff ? (
          <p className="text-sm text-muted-foreground py-2">Your full & final settlement will be prepared by HR closer to your last working day.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Net payable</p>
              <p className="text-base font-bold text-foreground tabular-nums">{fmtCurrency(ff.net_payable)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Leave encashment</p>
              <p className="text-sm font-medium tabular-nums">{fmtCurrency(ff.leave_encashment_amount)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Gratuity</p>
              <p className="text-sm font-medium tabular-nums">{fmtCurrency(ff.gratuity_amount)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Notice deduction</p>
              <p className="text-sm font-medium tabular-nums">{fmtCurrency(ff.notice_period_deduction)}</p>
            </div>
            {ff.paid_at && (
              <div className="space-y-0.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Paid on</p>
                <p className="text-sm font-medium">{fmtDate(ff.paid_at)}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <AssetObligations />
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────────

export function EssSeparation() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const employeeId = profile?.employee_id ?? null

  const { data, isLoading } = useQuery<SeparationResponse>({
    queryKey: ['ess-me-separation', employeeId],
    queryFn:  () => api.get('/ess/me/separation'),
    enabled:  !!employeeId,
  })

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="Resignation & Exit" subtitle="Submit and track your exit" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader title="Resignation & Exit" subtitle="Submit your resignation and track clearances, settlement and asset returns" />

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : data?.data ? (
        <SeparationTracking sep={data.data} clearances={data.clearances} ff={data.ff} />
      ) : (
        <div className="space-y-4">
          <ResignationForm onSubmitted={() => qc.invalidateQueries({ queryKey: ['ess-me-separation', employeeId] })} />
          <AssetObligations />
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
            <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
            <span>Not ready to resign? You can still review the company assets assigned to you above. Submitting a resignation notifies HR and begins your formal exit process.</span>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
