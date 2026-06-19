/**
 * ManagerTeamLifecycle — /manager/team/lifecycle  (Program 6A · P6.1)
 *
 * One workspace for a manager to run their team's employment lifecycle:
 *   1. Probation & Confirmation  — on probation / due / overdue (+ recommend)
 *   2. New Joiners               — joining date, readiness %, pending items
 *   3. Expiry Risks              — documents / identity / passport / visa / contract
 *   4. Separations               — notice / LWD / clearance + manager clearance action
 *
 * Everything is read from existing engines via GET /manager/team/lifecycle.
 * Confirmation is a RECOMMENDATION (notifies HR) — managers never confirm directly.
 * Manager clearance reuses the existing PATCH separation-clearances endpoint.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  UserCheck, UserPlus, CalendarClock, LogOut, Loader2, ShieldAlert,
  Send, Check, X, FileWarning,
} from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { cn }            from '@/lib/utils'

// ── Types (mirror GET /manager/team/lifecycle) ─────────────────────────────────

interface ProbationRow {
  employee_id: string; name: string; employee_code: string | null
  joining_date?: string | null; due_date?: string; days_to_due?: number
  bucket?: string; confirmation_state?: string
}
interface NewJoiner {
  employee_id: string; name: string; employee_code: string | null; joining_date: string
  readiness_pct: number | null; readiness_status: string | null; pending_items: number | null
}
interface ExpiryItem {
  id: string; category: string; employee_id: string; employee_name: string
  label: string; detail: string | null; due_date: string; days_to_due: number
  bucket: string; severity: string
}
interface Separation {
  employee_id: string; name: string; employee_code: string | null
  separation_type: string; notice_date: string | null; last_working_date: string | null
  exit_reason: string | null; lifecycle_stage: string; approval_status: string | null
  clearance_done: boolean
  manager_clearance: { id: string; status: string } | null
}
interface TrustRisk {
  employee_id: string; name: string; employee_code: string | null
  score: number | null; severity: string; reason: string | null
}
interface LifecycleData {
  manager_employee_id: string | null
  team_size: number
  probation: { on_probation: ProbationRow[]; confirmation_due: ProbationRow[]; confirmation_overdue: ProbationRow[] }
  new_joiners: NewJoiner[]
  expiry: { items: ExpiryItem[]; summary: { by_bucket: Record<string, number> } }
  separations: Separation[]
  trust_risks: TrustRisk[]
}

const fmtDate = (s?: string | null) => {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  if (isNaN(d.getTime())) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

const dueLabel = (days?: number) => {
  if (days == null) return ''
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'due today'
  return `in ${days}d`
}

const BUCKET_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  overdue: 'destructive', due_7: 'warning', due_30: 'secondary', due_90: 'secondary',
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function ManagerTeamLifecycle() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<LifecycleData>({
    queryKey: ['manager-team-lifecycle', 'full'],
    queryFn:  () => api.get('/manager/team/lifecycle?include_readiness=true'),
    staleTime: 120_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['manager-team-lifecycle'] })

  // Confirmation recommendation
  const recommendMut = useMutation({
    mutationFn: (employeeId: string) =>
      api.post('/manager/team/lifecycle/confirmation-recommend', { employee_id: employeeId }),
    onSuccess: () => toast.success('Confirmation recommended — sent to HR for review'),
    onError:   (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to send recommendation'),
  })

  // Manager clearance action (reuses existing separation-clearances endpoint)
  const clearanceMut = useMutation({
    mutationFn: (p: { employeeId: string; clearanceId: string; status: 'cleared' | 'rejected' }) =>
      api.patch(`/employees/${p.employeeId}/separation-clearances/${p.clearanceId}`, { status: p.status }),
    onSuccess: (_d, p) => { toast.success(`Manager clearance ${p.status}`); invalidate() },
    onError:   (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to update clearance'),
  })

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={[{ label: 'Manager' }, { label: 'Team Lifecycle' }]} title="Team Lifecycle" />
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </PageContainer>
    )
  }

  const d = data
  const probationRows: ProbationRow[] = d ? mergeProbation(d.probation) : []
  const expiryItems = d?.expiry.items ?? []
  const activeSeparations = (d?.separations ?? []).filter(
    s => s.lifecycle_stage !== 'relieved' && s.lifecycle_stage !== 'archived',
  )

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Manager' }, { label: 'Team Lifecycle' }]}
        title="Team Lifecycle"
        subtitle={`Probation, new joiners, expiry & separations for your ${d?.team_size ?? 0} team member${d?.team_size === 1 ? '' : 's'}`}
      />

      {/* Trust risk banner (P6.2 surfaced here too) */}
      {(d?.trust_risks?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <ShieldAlert className="h-4 w-4" /> {d!.trust_risks.length} team member{d!.trust_risks.length === 1 ? '' : 's'} flagged for trust risk
          </p>
          <div className="flex flex-wrap gap-2">
            {d!.trust_risks.map(t => (
              <div key={t.employee_id} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
                <span className="font-medium">{t.name}</span>
                <Badge variant={t.severity === 'critical' ? 'destructive' : 'warning'} className="ml-1.5 text-[9px]">{t.severity}</Badge>
                {t.reason && <span className="ml-1.5 text-muted-foreground">· {t.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 1. Probation & Confirmation ─────────────────────────────────────── */}
        <SectionCard title="Probation & Confirmation" icon={<UserCheck className="h-4 w-4 text-muted-foreground" />}>
          {probationRows.length === 0 ? (
            <Empty text="No team members on probation." />
          ) : (
            <div className="space-y-1.5">
              {probationRows.map(r => (
                <div key={r.employee_id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.due_date ? `Confirmation due ${fmtDate(r.due_date)} · ` : ''}
                      <span className={cn(r.confirmation_state === 'overdue' && 'text-destructive font-medium')}>
                        {r.days_to_due != null ? dueLabel(r.days_to_due) : 'on track'}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.confirmation_state === 'overdue' && <Badge variant="destructive" className="text-[9px]">Overdue</Badge>}
                    {r.confirmation_state === 'due'      && <Badge variant="warning" className="text-[9px]">Due</Badge>}
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      disabled={recommendMut.isPending}
                      onClick={() => recommendMut.mutate(r.employee_id)}>
                      <Send className="mr-1 h-3 w-3" /> Recommend
                    </Button>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground">
                Recommendations are sent to HR for confirmation — managers cannot confirm directly.
              </p>
            </div>
          )}
        </SectionCard>

        {/* ── 2. New Joiners ──────────────────────────────────────────────────── */}
        <SectionCard title="New Joiners" icon={<UserPlus className="h-4 w-4 text-muted-foreground" />}>
          {(d?.new_joiners.length ?? 0) === 0 ? (
            <Empty text="No new joiners in the last 90 days." />
          ) : (
            <div className="space-y-1.5">
              {d!.new_joiners.map(j => (
                <div key={j.employee_id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{j.name}</p>
                    <p className="text-[11px] text-muted-foreground">Joined {fmtDate(j.joining_date)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-right">
                    {j.readiness_pct != null ? (
                      <div>
                        <span className={cn('text-sm font-semibold tabular-nums',
                          j.readiness_status === 'ready' ? 'text-emerald-600'
                          : j.readiness_status === 'blocked' ? 'text-destructive' : 'text-amber-600')}>
                          {j.readiness_pct}%
                        </span>
                        <p className="text-[10px] text-muted-foreground">
                          {(j.pending_items ?? 0) > 0 ? `${j.pending_items} pending` : 'ready'}
                        </p>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No onboarding</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── 3. Expiry Risks ─────────────────────────────────────────────────── */}
        <SectionCard title="Expiry Risks" icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}>
          {expiryItems.length === 0 ? (
            <Empty text="No documents, identity or contracts expiring soon." />
          ) : (
            <div className="space-y-1.5">
              {expiryItems
                .sort((a, b) => a.days_to_due - b.days_to_due)
                .map(it => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{it.employee_name}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {it.category} · {it.label}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted-foreground">{fmtDate(it.due_date)}</span>
                      <Badge variant={BUCKET_VARIANT[it.bucket] ?? 'secondary'} className="text-[9px]">
                        {dueLabel(it.days_to_due)}
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </SectionCard>

        {/* ── 4. Separations + Manager Clearance ──────────────────────────────── */}
        <SectionCard title="Separations" icon={<LogOut className="h-4 w-4 text-muted-foreground" />}>
          {activeSeparations.length === 0 ? (
            <Empty text="No active separations in your team." />
          ) : (
            <div className="space-y-2">
              {activeSeparations.map(s => (
                <div key={s.employee_id} className="rounded-md border border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {s.separation_type?.replace(/_/g, ' ')} · LWD {fmtDate(s.last_working_date)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[9px] capitalize shrink-0">
                      {s.lifecycle_stage?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  {/* Manager clearance action */}
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                    <span className="text-[11px] text-muted-foreground">
                      Manager clearance:{' '}
                      <span className={cn('font-medium capitalize',
                        s.manager_clearance?.status === 'cleared' ? 'text-emerald-600'
                        : s.manager_clearance?.status === 'rejected' ? 'text-destructive' : 'text-amber-600')}>
                        {s.manager_clearance?.status ?? 'not required'}
                      </span>
                    </span>
                    {s.manager_clearance && s.manager_clearance.status === 'pending' && (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          disabled={clearanceMut.isPending}
                          onClick={() => clearanceMut.mutate({ employeeId: s.employee_id, clearanceId: s.manager_clearance!.id, status: 'cleared' })}>
                          <Check className="mr-1 h-3 w-3" /> Clear
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive"
                          disabled={clearanceMut.isPending}
                          onClick={() => clearanceMut.mutate({ employeeId: s.employee_id, clearanceId: s.manager_clearance!.id, status: 'rejected' })}>
                          <X className="mr-1 h-3 w-3" /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Merge probation lists into one deduped, prioritised view (overdue → due → on-track). */
function mergeProbation(p: LifecycleData['probation']): ProbationRow[] {
  const byId = new Map<string, ProbationRow>()
  for (const r of p.on_probation) byId.set(r.employee_id, { ...r })
  for (const r of p.confirmation_due) byId.set(r.employee_id, { ...byId.get(r.employee_id), ...r, confirmation_state: 'due' })
  for (const r of p.confirmation_overdue) byId.set(r.employee_id, { ...byId.get(r.employee_id), ...r, confirmation_state: 'overdue' })
  const order: Record<string, number> = { overdue: 0, due: 1, on_track: 2 }
  return [...byId.values()].sort((a, b) =>
    (order[a.confirmation_state ?? 'on_track'] ?? 2) - (order[b.confirmation_state ?? 'on_track'] ?? 2))
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-muted-foreground">
      <FileWarning className="h-6 w-6 opacity-30" />
      <p className="text-xs">{text}</p>
    </div>
  )
}
