/**
 * EssOnboarding — /ess/onboarding
 *
 * O4: Employee-facing self-service onboarding workspace.
 *
 * This is purely an experience layer. It consumes existing services and adds
 * NO new business logic, workflow engine, or onboarding status model:
 *   - Readiness + Trust  → ReadinessCard            (GET /employees/:id/readiness)
 *   - Tasks / Checklist  → existing checklist API   (GET/PATCH /onboarding/employees/:id/...)
 *   - Documents          → onboarding-status API    (GET /employees/:id/onboarding-status)
 *   - Timeline           → LifecycleTimeline         (GET /employees/:id/onboarding-timeline)
 *
 * The employee actions only their own items; everything else is read-only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2, CheckCircle2, Circle, FileText, Milestone,
  PartyPopper, ClipboardList, Lock, FileCheck2, FileClock, FileX2,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { ReadinessCard }      from '@/components/onboarding/ReadinessCard'
import { LifecycleTimeline }  from '@/components/onboarding/LifecycleTimeline'

// ── Types (mirror existing API shapes) ────────────────────────────────────────

interface ChecklistTask {
  id:               string
  title:            string
  description:      string | null
  is_mandatory:     boolean
  sort_order:       number
  category:         string | null
  assigned_to_role: string | null
  status:           string
  notes:            string | null
  completed_at:     string | null
}

interface Checklist {
  id:                      string
  employee_id:             string
  status:                  string
  start_date:              string | null
  target_completion_date:  string | null
  completed_at:            string | null
  employee_onboarding_tasks: ChecklistTask[]
}

interface OnboardingStatusDoc {
  id:                string
  document_type:     string
  extraction_status: string
  uploaded_at:       string | null
}

interface OnboardingStatus {
  session:   { id: string; status: string } | null
  draft:     { id: string; status: string } | null
  documents: { total: number; extracted: number; failed: number; items: OnboardingStatusDoc[] }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOC_TYPE_LABEL: Record<string, string> = {
  cv: 'CV / Resume', resume: 'Resume',
  pan: 'PAN card', aadhaar: 'Aadhaar', passport: 'Passport',
  cheque: 'Cancelled cheque', bank_proof: 'Bank proof',
  photo: 'Passport photo', offer_letter: 'Offer letter',
  experience_letter: 'Experience letter', relieving_letter: 'Relieving letter',
  salary_slip: 'Salary slip', driving_license: 'Driving licence',
}

function docLabel(t: string): string {
  return DOC_TYPE_LABEL[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Tasks the employee themselves can action vs. tasks owned by another team. */
function isEmployeeActionable(role: string | null): boolean {
  if (!role) return true
  const r = role.toLowerCase()
  return r === 'employee' || r === 'self' || r === 'candidate' || r === 'new_hire'
}

// ── Tasks section ─────────────────────────────────────────────────────────────

function TaskRow({
  task, employeeId,
}: { task: ChecklistTask; employeeId: string }) {
  const qc = useQueryClient()
  const actionable = isEmployeeActionable(task.assigned_to_role)
  const done       = task.status === 'completed' || task.status === 'skipped'

  const mutation = useMutation({
    mutationFn: (next: 'completed' | 'pending') =>
      api.patch(`/onboarding/employees/${employeeId}/tasks/${task.id}`, { status: next }),
    onSuccess: () => {
      // Completing a task moves readiness + timeline — refresh those too.
      qc.invalidateQueries({ queryKey: ['ess-onboarding-checklist', employeeId] })
      qc.invalidateQueries({ queryKey: ['readiness', employeeId] })
      qc.invalidateQueries({ queryKey: ['lifecycle-timeline', employeeId] })
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not update task'),
  })

  const toggle = () => {
    if (!actionable) return
    mutation.mutate(done ? 'pending' : 'completed')
  }

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5',
      done && 'bg-muted/40',
    )}>
      <button
        onClick={toggle}
        disabled={!actionable || mutation.isPending}
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
        className={cn(
          'mt-0.5 shrink-0 transition-colors',
          actionable ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        {mutation.isPending
          ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          : done
          ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          : actionable
          ? <Circle className="h-5 w-5 text-muted-foreground hover:text-[#2E6FE6]" />
          : <Lock className="h-4 w-4 text-muted-foreground/60 mt-0.5" />
        }
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(
            'text-sm font-medium',
            done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}>
            {task.title}
          </span>
          {task.is_mandatory && !done && (
            <Badge variant="warning" className="text-[10px] py-0">Required</Badge>
          )}
          {task.category && (
            <Badge variant="secondary" className="text-[10px] py-0">{task.category}</Badge>
          )}
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
        )}
        {!actionable && (
          <p className="text-[11px] text-muted-foreground/70 mt-1 flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Handled by your {task.assigned_to_role} team
            {done && ' — done'}
          </p>
        )}
      </div>
    </div>
  )
}

function TasksSection({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ess-onboarding-checklist', employeeId],
    queryFn:  () => api.get<{ data: Checklist[] }>(`/onboarding/employees/${employeeId}/checklist`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your tasks…
      </div>
    )
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Could not load your onboarding tasks.
      </div>
    )
  }

  const checklist = (data ?? [])[0]
  const tasks = (checklist?.employee_onboarding_tasks ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)

  if (!checklist || tasks.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No onboarding tasks assigned yet. Your HR team will set these up.</p>
      </div>
    )
  }

  const mandatory      = tasks.filter(t => t.is_mandatory)
  const mandatoryDone  = mandatory.filter(t => t.status === 'completed' || t.status === 'skipped').length
  const pct            = mandatory.length > 0 ? Math.round((mandatoryDone / mandatory.length) * 100) : 100
  const myOpen         = tasks.filter(t => isEmployeeActionable(t.assigned_to_role) && t.status !== 'completed' && t.status !== 'skipped').length

  return (
    <div className="space-y-3">
      {/* Progress header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{mandatoryDone}/{mandatory.length} required complete</span>
          {myOpen > 0 && (
            <Badge variant="info" className="text-[10px] py-0">{myOpen} action{myOpen !== 1 ? 's' : ''} for you</Badge>
          )}
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', pct === 100 ? 'bg-emerald-500' : 'bg-[#2E6FE6]')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Task list */}
      <div className="space-y-2 pt-1">
        {tasks.map(t => (
          <TaskRow key={t.id} task={t} employeeId={employeeId} />
        ))}
      </div>
    </div>
  )
}

// ── Documents section ─────────────────────────────────────────────────────────

function DocStatusBadge({ status }: { status: string }) {
  if (status === 'completed' || status === 'extracted') {
    return <Badge variant="success" className="text-[10px] py-0 gap-1"><FileCheck2 className="h-3 w-3" />Verified</Badge>
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="text-[10px] py-0 gap-1"><FileX2 className="h-3 w-3" />Action needed</Badge>
  }
  return <Badge variant="secondary" className="text-[10px] py-0 gap-1"><FileClock className="h-3 w-3" />Processing</Badge>
}

function DocumentsSection({ docs }: { docs: OnboardingStatusDoc[] }) {
  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No documents on file yet.</p>
      </div>
    )
  }
  const sorted = docs.slice().sort((a, b) => docLabel(a.document_type).localeCompare(docLabel(b.document_type)))
  return (
    <div className="space-y-2">
      {sorted.map(d => (
        <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-foreground flex-1 min-w-0 truncate">{docLabel(d.document_type)}</span>
          <DocStatusBadge status={d.extraction_status} />
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground pt-1">
        Documents are reviewed by HR. If something needs attention, your HR team will reach out.
      </p>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, count, children,
}: { title: string; icon: React.ComponentType<{ className?: string }>; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#2E6FE6]" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {typeof count === 'number' && count > 0 && (
          <span className="text-xs text-muted-foreground">({count})</span>
        )}
      </div>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EssOnboarding() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null
  const firstName   = profile?.full_name?.split(' ')[0] ?? null

  const { data: status, isLoading } = useQuery({
    queryKey: ['ess-onboarding-status', employeeId],
    queryFn:  () => api.get<{ data: OnboardingStatus | null }>(`/employees/${employeeId}/onboarding-status`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  if (!employeeId) {
    return (
      <PageContainer size="medium">
        <PageHeader title="My Onboarding" subtitle="Your onboarding journey" />
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground text-center">
          Your account isn’t linked to an employee record yet. Please contact HR.
        </div>
      </PageContainer>
    )
  }

  if (isLoading) {
    return (
      <PageContainer size="medium">
        <PageHeader title="My Onboarding" subtitle="Your onboarding journey" />
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your onboarding workspace…
        </div>
      </PageContainer>
    )
  }

  const sessionComplete = status?.session?.status === 'employee_created' || status?.draft?.status === 'completed'
  const docs = status?.documents?.items ?? []

  return (
    <PageContainer size="medium" spacing="loose">
      <PageHeader
        breadcrumb={[{ label: 'Employee Portal' }, { label: 'Onboarding' }]}
        title={firstName ? `Welcome aboard, ${firstName}` : 'My Onboarding'}
        subtitle="Everything you need to get set up for your first days — in one place."
      />

      {/* Completed celebration banner */}
      {sessionComplete && (
        <div className="rounded-xl bg-gradient-to-r from-[#2E6FE6] to-[#15B8A6] px-5 py-4 text-white flex items-center gap-3">
          <PartyPopper className="h-6 w-6 shrink-0" />
          <div>
            <p className="font-semibold text-sm">You’re all set!</p>
            <p className="text-xs text-white/80 mt-0.5">Your onboarding is complete. Anything below is just for your reference.</p>
          </div>
        </div>
      )}

      {/* Readiness + Trust (engine-computed, explainable) */}
      <ReadinessCard employeeId={employeeId} />

      {/* Self-service tasks */}
      <Section title="Your Onboarding Checklist" icon={ClipboardList}>
        <TasksSection employeeId={employeeId} />
      </Section>

      {/* Documents */}
      <Section title="Your Documents" icon={FileText} count={docs.length}>
        <DocumentsSection docs={docs} />
      </Section>

      {/* Journey timeline */}
      <Section title="Your Journey" icon={Milestone}>
        <LifecycleTimeline employeeId={employeeId} />
      </Section>
    </PageContainer>
  )
}

export default EssOnboarding
