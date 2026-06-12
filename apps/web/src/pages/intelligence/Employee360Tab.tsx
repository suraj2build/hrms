/**
 * Employee360Tab — read-only "Insights" tab inside the Employee Profile.
 * Additive; never replaces existing profile sections. Shape matches the real
 * GET /intelligence/employee/:id/360 response. No business logic.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import {
  Loader2, ChevronDown, ChevronUp, Shield, Clock, Package,
  CalendarDays, Briefcase, LogOut, AlertTriangle,
} from 'lucide-react'
import { LifecycleTimeline } from '@/components/onboarding/LifecycleTimeline'

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

function tenureLabel(days?: number | null): string | null {
  if (days == null) return null
  if (days < 60) return `${days} days`
  const months = Math.floor(days / 30)
  if (months < 24) return `${months} months (${days} days)`
  return `${(days / 365).toFixed(1)} years`
}

function StatRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  )
}

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

  const emp = data.employee
  const tenure = tenureLabel(emp.tenure_days)
  const inSeparation = !!data.compliance.separation_stage

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Brand-consistent header */}
      <div className="rounded-lg bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] px-5 py-3 text-white">
        <h2 className="text-base font-semibold">Profile Intelligence</h2>
        <p className="text-xs text-white/75 mt-0.5">Read-only 360 view — derived live from operational records</p>
      </div>

      {/* Summary first */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>
        {data.sources?.length > 0 && (
          <>
            <button onClick={() => setSourcesOpen(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Why this summary?
            </button>
            {sourcesOpen && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {data.sources.map((s, i) => (
                  <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/5">{s}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Compliance */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Compliance</h3>
          <StatRow icon={Shield} label="Status">
            <Badge variant={emp.status === 'active' ? 'success' : emp.status === 'separated' ? 'destructive' : 'secondary'} className="capitalize">{emp.status.replace(/_/g, ' ')}</Badge>
          </StatRow>
          <StatRow icon={Clock} label="Tenure">{tenure ?? '—'}</StatRow>
          <StatRow icon={AlertTriangle} label="Probation">
            {emp.status === 'active' && data.compliance.probation_due
              ? <Badge variant="warning">Confirmation due</Badge>
              : <span className="text-muted-foreground">Not due</span>}
          </StatRow>
          <StatRow icon={Package} label="Assets assigned">{data.compliance.assets_assigned}</StatRow>
          {inSeparation && (
            <StatRow icon={LogOut} label="Separation">
              <Badge variant="destructive" className="capitalize">{data.compliance.separation_stage!.replace(/_/g, ' ')}</Badge>
            </StatRow>
          )}
        </div>

        {/* Role + compensation + onboarding */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Profile</h3>
          <StatRow icon={Briefcase} label="Employee code">{emp.code ?? '—'}</StatRow>
          <StatRow icon={CalendarDays} label="Joined">{emp.joining_date ?? '—'}</StatRow>
          {data.compensation && (
            <StatRow icon={Briefcase} label="CTC (annual)">₹{Number(data.compensation.ctc_annual).toLocaleString('en-IN')}</StatRow>
          )}
          {data.onboarding && (
            <StatRow icon={CalendarDays} label="Onboarding">
              <Badge variant="secondary" className="capitalize">{data.onboarding.status.replace(/_/g, ' ')}</Badge>
            </StatRow>
          )}
        </div>
      </div>

      {/* Leave balances */}
      {data.leave?.balances && data.leave.balances.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leave Balances</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs">
                  <th className="text-left py-1.5 pr-4 font-medium">Leave Type</th>
                  <th className="text-right py-1.5 px-3 font-medium">Used</th>
                  <th className="text-right py-1.5 pl-3 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.leave.balances.map((lb, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 text-foreground">{lb.leave_type}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{lb.used}</td>
                    <td className="py-2 pl-3 text-right font-medium text-foreground">{lb.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* O2 — Journey Timeline */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Journey Timeline</h3>
        <LifecycleTimeline employeeId={employeeId} hideProgressBar={false} />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Generated {new Date(data.generated_at).toLocaleString()} · sources: {data.sources?.join(' · ') || 'employees'}
      </p>
    </div>
  )
}

export default Employee360Tab
