/**
 * Employee360Tab — read-only "Profile Intelligence" panel inside the Employee Profile.
 * Additive; never replaces existing profile sections. Shape matches the real
 * GET /intelligence/employee/:id/360 response. No business logic.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Loader2, ChevronDown, ChevronUp, Brain,
  DollarSign, LogOut, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { LifecycleTimeline } from '@/components/onboarding/LifecycleTimeline'
import { ReadinessCard }    from '@/components/onboarding/ReadinessCard'
import { TrustSummary }     from '@/components/trust/TrustSummary'

// ── Types ──────────────────────────────────────────────────────────────────────

interface LeaveBalance { leave_type: string; balance: number; used: number }

interface Employee360Data {
  employee: {
    id: string; name: string; code?: string | null; status: string
    joining_date?: string | null; tenure_days?: number | null
    department_id?: string | null; designation?: string | null
  }
  compliance: {
    probation_due: boolean
    separation_stage: string | null
    assets_assigned: number
    assets?: Array<{ id: string; name?: string; asset_code?: string }>
  }
  compensation: { ctc_annual: number; effective_from: string } | null
  leave: { balances: LeaveBalance[] } | null
  attendance_signal: unknown | null
  onboarding: { status: string; completed_at: string | null } | null
  summary: string
  generated_at: string
  sources: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function tenureLabel(days?: number | null): string | null {
  if (days == null) return null
  if (days < 60) return `${days} days`
  const months = Math.floor(days / 30)
  if (months < 24) return `${months} months`
  return `${(days / 365).toFixed(1)} years`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function Employee360Tab({ employeeId }: { employeeId: string }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['employee-360', employeeId],
    queryFn: () => api.get<{ data: Employee360Data }>(`/intelligence/employee/${employeeId}/360`).then(r => r.data),
    enabled: !!employeeId,
    staleTime: 60_000,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading profile intelligence…
    </div>
  )
  if (isError) return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Failed to load insights: {error instanceof Error ? error.message : 'Unknown error'}
    </div>
  )
  if (!data) return null

  const emp         = data.employee
  const tenure      = tenureLabel(emp.tenure_days)
  const inSeparation = !!data.compliance.separation_stage
  const probationDue = emp.status === 'active' && data.compliance.probation_due

  return (
    <div className="space-y-4">

      {/* ── Separation alert ───────────────────────────────────────────────── */}
      {inSeparation && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/6 px-4 py-3">
          <LogOut className="h-4 w-4 text-destructive shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-destructive">Separation in Progress</p>
            <p className="text-xs text-destructive/70 capitalize">{data.compliance.separation_stage!.replace(/_/g, ' ')}</p>
          </div>
        </div>
      )}

      {/* ── Probation alert ────────────────────────────────────────────────── */}
      {probationDue && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/6 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm font-semibold text-warning">Probation confirmation due</p>
        </div>
      )}

      {/* ── AI Summary ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">AI Summary</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pb-4">
          <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>
          {data.sources?.length > 0 && (
            <>
              <button
                onClick={() => setSourcesOpen(v => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Data sources
              </button>
              {sourcesOpen && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {data.sources.map((s, i) => (
                    <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted">{s}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Key signals grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          {
            label: 'Status',
            content: (
              <Badge
                variant={
                  emp.status === 'active'    ? 'success'     :
                  emp.status === 'separated' ? 'destructive' : 'secondary'
                }
                className="capitalize text-[10px] rounded-full"
              >
                {emp.status.replace(/_/g, ' ')}
              </Badge>
            ),
          },
          {
            label:   'Tenure',
            content: <span className="text-sm font-semibold text-foreground">{tenure ?? '—'}</span>,
          },
          {
            label:   'Probation',
            content: probationDue
              ? <Badge variant="warning" className="text-[10px] rounded-full">Due</Badge>
              : <span className="text-sm font-semibold text-muted-foreground">Confirmed</span>,
          },
          {
            label:   'Assets',
            content: <span className="text-2xl font-bold tabular-nums text-foreground">{data.compliance.assets_assigned}</span>,
          },
        ] as const).map(({ label, content }) => (
          <div key={label} className="rounded-xl border border-border bg-card px-3 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            {content}
          </div>
        ))}
      </div>

      {/* ── Compensation ───────────────────────────────────────────────────── */}
      {data.compensation && (
        <Card>
          <CardContent className="flex items-center justify-between pt-4 pb-4">
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Annual CTC</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                ₹{Number(data.compensation.ctc_annual).toLocaleString('en-IN')}
              </p>
              <p className="text-[10px] text-muted-foreground">Effective {data.compensation.effective_from}</p>
            </div>
            <DollarSign className="h-10 w-10 text-muted-foreground/15 shrink-0" />
          </CardContent>
        </Card>
      )}

      {/* ── Leave balances ─────────────────────────────────────────────────── */}
      {data.leave?.balances && data.leave.balances.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Leave Balances</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {data.leave.balances.map((lb, i) => {
              const total   = lb.used + lb.balance
              const usedPct = total > 0 ? Math.round((lb.used / total) * 100) : 0
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{lb.leave_type}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {lb.balance} left · {lb.used} used
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        usedPct > 80 ? 'bg-destructive' : usedPct > 50 ? 'bg-warning' : 'bg-success',
                      )}
                      style={{ width: `${usedPct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Onboarding Readiness ───────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Onboarding Readiness</p>
        <ReadinessCard employeeId={employeeId} />
      </div>

      {/* ── Trust Intelligence ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trust Intelligence</p>
        <TrustSummary employeeId={employeeId} />
      </div>

      {/* ── Journey Timeline ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Journey Timeline</p>
        <LifecycleTimeline employeeId={employeeId} hideProgressBar={false} />
      </div>

      <p className="text-[10px] text-muted-foreground/60">
        Generated {new Date(data.generated_at).toLocaleString()} · {data.sources?.join(' · ') || 'employees'}
      </p>
    </div>
  )
}

export default Employee360Tab
