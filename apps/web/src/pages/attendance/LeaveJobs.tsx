/**
 * LeaveJobs — /admin/leave-jobs
 *
 * HR admin view to:
 *  • Inspect leave job run history (last 20 runs)
 *  • Manually trigger any leave job (monthly accrual, CO expiry,
 *    carry-forward, policy recalculate)
 *
 * Access: super_admin, hr_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PlayCircle, RefreshCw, ShieldAlert, Loader2,
  SearchX, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  CalendarClock,
} from 'lucide-react'

import { toast }          from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type JobType = 'monthly_accrual' | 'co_expiry' | 'carry_forward' | 'policy_recalculate'
type JobStatus = 'success' | 'error' | 'partial'

interface JobLog {
  id:           string
  job_type:     JobType
  status:       JobStatus
  started_at:   string
  completed_at: string | null
  duration_ms:  number | null
  params:       Record<string, unknown> | null
  result:       Record<string, unknown> | null
  error_msg:    string | null
}

interface TriggerResult {
  message: string
  data: {
    status:              string
    employees_processed: number
    total_days_credited: number
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const JOB_LABEL: Record<JobType, string> = {
  monthly_accrual:    'Monthly Accrual',
  co_expiry:          'CO Expiry',
  carry_forward:      'Carry Forward',
  policy_recalculate: 'Policy Recalculate',
}

const STATUS_ICON: Record<JobStatus, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
  error:   <XCircle      className="h-4 w-4 text-destructive" />,
  partial: <CheckCircle2 className="h-4 w-4 text-warning" />,
}

const STATUS_BADGE_VARIANT: Record<JobStatus, 'success' | 'destructive' | 'warning'> = {
  success: 'success',
  error:   'destructive',
  partial: 'warning',
}

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function JobRow({ job }: { job: JobLog }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-3 px-3">
          <div className="flex items-center gap-2">
            {STATUS_ICON[job.status] ?? null}
            <span className="font-medium text-foreground text-sm">
              {JOB_LABEL[job.job_type] ?? job.job_type}
            </span>
          </div>
        </td>
        <td className="py-3 px-3">
          <Badge
            variant={STATUS_BADGE_VARIANT[job.status] ?? 'secondary'}
            className="rounded-full text-[10px] capitalize"
          >
            {job.status}
          </Badge>
        </td>
        <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">
          {fmtDatetime(job.started_at)}
        </td>
        <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">
          {fmtDuration(job.duration_ms)}
        </td>
        <td className="py-3 px-3">
          {expanded
            ? <ChevronDown   className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight  className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border/50 bg-muted/20">
          <td colSpan={5} className="px-3 pb-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {job.params && (
                <div>
                  <p className="text-muted-foreground font-semibold mb-1 uppercase tracking-wide text-[10px]">
                    Parameters
                  </p>
                  <pre className="bg-muted rounded-md px-3 py-2 text-foreground overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(job.params, null, 2)}
                  </pre>
                </div>
              )}
              {job.result && (
                <div>
                  <p className="text-muted-foreground font-semibold mb-1 uppercase tracking-wide text-[10px]">
                    Result
                  </p>
                  <pre className="bg-muted rounded-md px-3 py-2 text-foreground overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </div>
              )}
              {job.error_msg && (
                <div className="sm:col-span-2">
                  <p className="text-destructive font-semibold mb-1 uppercase tracking-wide text-[10px]">
                    Error
                  </p>
                  <p className="text-destructive text-xs p-2 rounded-md bg-destructive/10 border border-destructive/20">
                    {job.error_msg}
                  </p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeaveJobs() {
  const { profile } = useAuthStore()
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const qc = useQueryClient()

  // ── Trigger form state ─────────────────────────────────────────────────────
  const now       = new Date()
  const curYear   = now.getFullYear()
  const curMonth  = now.getMonth() + 1  // 1-based

  const [accrualYear,  setAccrualYear]  = useState(String(curYear))
  const [accrualMonth, setAccrualMonth] = useState(String(curMonth))
  const [coAsOf,       setCoAsOf]       = useState('')
  const [cfFromYear,   setCfFromYear]   = useState(String(curYear - 1))
  const [cfToYear,     setCfToYear]     = useState(String(curYear))
  const [recalcLtId,   setRecalcLtId]  = useState('')
  const [recalcYear,   setRecalcYear]  = useState(String(curYear))

  const [resultMsg,   setResultMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [activeJob,   setActiveJob]   = useState<string | null>(null)

  // ── Job history query ──────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<{ data: JobLog[] }>({
    queryKey: ['leave-jobs'],
    queryFn:  () => api.get<{ data: JobLog[] }>('/leave/jobs'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const jobs = data?.data ?? []

  // ── Leave types (for recalculate form) ────────────────────────────────────
  const { data: ltData } = useQuery<{ data: Array<{ id: string; name: string; is_active: boolean }> }>({
    queryKey: ['leave-types-all'],
    queryFn:  () => api.get('/masters/leave-types'),
    enabled:  isAdmin,
    staleTime: 120_000,
  })
  const leaveTypes = (ltData?.data ?? []).filter((lt) => lt.is_active)

  // ── Trigger mutation ───────────────────────────────────────────────────────
  const triggerMutation = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body: Record<string, unknown> }) =>
      api.post<TriggerResult>(endpoint, body),
    onSuccess: (res) => {
      setResultMsg({ ok: true, text: res.message ?? 'Job completed successfully.' })
      setActiveJob(null)
      qc.invalidateQueries({ queryKey: ['leave-jobs'] })
      toast.success('Job completed', { description: res.message ?? 'Job ran successfully.' })
    },
    onError: (err: Error) => {
      setResultMsg({ ok: false, text: err.message ?? 'Job failed.' })
      setActiveJob(null)
      toast.error('Job failed', { description: err.message })
    },
  })

  function trigger(jobId: string, endpoint: string, body: Record<string, unknown>) {
    setActiveJob(jobId)
    setResultMsg(null)
    triggerMutation.mutate({ endpoint, body })
  }

  const isPending = triggerMutation.isPending

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Leave Jobs"
        subtitle="Manually trigger leave accrual, carry-forward, and other scheduled jobs"
      />

      {/* Access guard */}
      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can trigger leave jobs.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <>
          {/* ── Trigger panels ────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Monthly Accrual */}
            <SectionCard
              title="Monthly Accrual"
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Credits leave to all eligible employees for a specific month based on their leave policy.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Year</label>
                  <Input
                    type="number"
                    value={accrualYear}
                    min={2000}
                    max={2100}
                    onChange={(e) => setAccrualYear(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Month (1–12)</label>
                  <Input
                    type="number"
                    value={accrualMonth}
                    min={1}
                    max={12}
                    onChange={(e) => setAccrualMonth(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 w-full"
                disabled={isPending}
                onClick={() =>
                  trigger('monthly-accrual', '/leave/jobs/monthly-accrual', {
                    year:  parseInt(accrualYear),
                    month: parseInt(accrualMonth),
                  })
                }
              >
                {activeJob === 'monthly-accrual' && isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PlayCircle className="h-3.5 w-3.5" />}
                Run Monthly Accrual
              </Button>
            </SectionCard>

            {/* CO Expiry */}
            <SectionCard
              title="CO / Comp-off Expiry"
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Expires compensatory-off balances that have passed their validity window.
              </p>
              <div className="space-y-1 mb-3">
                <label className="text-xs font-medium text-muted-foreground">
                  As of date (leave blank for today)
                </label>
                <Input
                  type="date"
                  value={coAsOf}
                  onChange={(e) => setCoAsOf(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 w-full"
                disabled={isPending}
                onClick={() =>
                  trigger('co-expiry', '/leave/jobs/co-expiry', coAsOf ? { as_of: coAsOf } : {})
                }
              >
                {activeJob === 'co-expiry' && isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PlayCircle className="h-3.5 w-3.5" />}
                Run CO Expiry
              </Button>
            </SectionCard>

            {/* Carry Forward */}
            <SectionCard
              title="Year-End Carry Forward"
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Carries forward eligible leave balances from one year to the next per policy rules.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">From Year</label>
                  <Input
                    type="number"
                    value={cfFromYear}
                    min={2000}
                    max={2100}
                    onChange={(e) => { setCfFromYear(e.target.value); setCfToYear(String(parseInt(e.target.value) + 1)) }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">To Year</label>
                  <Input
                    type="number"
                    value={cfToYear}
                    min={2000}
                    max={2100}
                    onChange={(e) => setCfToYear(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 w-full"
                disabled={isPending}
                onClick={() =>
                  trigger('carry-forward', '/leave/jobs/carry-forward', {
                    from_year: parseInt(cfFromYear),
                    to_year:   parseInt(cfToYear),
                  })
                }
              >
                {activeJob === 'carry-forward' && isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PlayCircle className="h-3.5 w-3.5" />}
                Run Carry Forward
              </Button>
            </SectionCard>

            {/* Policy Recalculate */}
            <SectionCard
              title="Policy Recalculate"
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Recomputes all balances for a specific leave type and year based on the current policy settings.
              </p>
              <div className="space-y-1 mb-2">
                <label className="text-xs font-medium text-muted-foreground">Leave Type</label>
                <select
                  value={recalcLtId}
                  onChange={(e) => setRecalcLtId(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">Select leave type…</option>
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 mb-3">
                <label className="text-xs font-medium text-muted-foreground">Year</label>
                <Input
                  type="number"
                  value={recalcYear}
                  min={2000}
                  max={2100}
                  onChange={(e) => setRecalcYear(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 w-full"
                disabled={isPending || !recalcLtId}
                onClick={() =>
                  trigger('recalculate', '/leave/jobs/recalculate', {
                    leave_type_id: recalcLtId,
                    year:          parseInt(recalcYear),
                  })
                }
              >
                {activeJob === 'recalculate' && isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PlayCircle className="h-3.5 w-3.5" />}
                Run Recalculate
              </Button>
            </SectionCard>
          </div>

          {/* ── Result message ────────────────────────────────────────────── */}
          {resultMsg && (
            <div
              className={cn(
                'flex items-start gap-2 text-sm p-3 rounded-md border',
                resultMsg.ok
                  ? 'bg-success/10 border-success/30 text-success'
                  : 'bg-destructive/10 border-destructive/30 text-destructive',
              )}
            >
              {resultMsg.ok
                ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                : <XCircle      className="h-4 w-4 flex-shrink-0 mt-0.5" />}
              <span>{resultMsg.text}</span>
            </div>
          )}

          {/* ── Job history ───────────────────────────────────────────────── */}
          <SectionCard
            title="Recent Job Runs"
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                Refresh
              </Button>
            }
          >
            {isLoading && (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm">Loading job history…</p>
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-2 py-12">
                <p className="text-sm text-destructive">Failed to load job history</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
              </div>
            )}

            {!isLoading && !isError && jobs.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <SearchX className="h-7 w-7 opacity-40" />
                <p className="text-sm font-medium text-foreground">No job runs yet</p>
                <p className="text-xs">Trigger a job above to get started.</p>
              </div>
            )}

            {!isLoading && !isError && jobs.length > 0 && (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job', 'Status', 'Started', 'Duration', ''].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <JobRow key={job.id} job={job} />
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground px-1 mt-2">
                  Showing last {jobs.length} run{jobs.length !== 1 ? 's' : ''}. Click a row to expand details.
                </p>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
