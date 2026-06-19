/**
 * NextSteps — the prioritised "what to do next" queue for the onboarding workspace.
 *
 * This is an aggregation view, not a new data source: it pulls the most pressing
 * items across existing services (open tasks, documents needing attention,
 * readiness blockers, action notifications) into one ranked list so a new hire
 * always knows the single next thing to do — Deel/Rippling style.
 */

import { useMemo } from 'react'
import {
  CheckCircle2, Circle, Loader2, FileWarning, Bell, ArrowRight, Sparkles, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  isEmployeeActionable, isTaskDone, docLabel, useToggleTask,
  type ChecklistTask, type OnboardingStatusDoc, type OnboardingNotification,
} from './onboarding-data'

type StepKind = 'task' | 'document' | 'blocker' | 'notification'

interface Step {
  key:        string
  kind:       StepKind
  priority:   number          // lower = more urgent
  title:      string
  hint?:      string
  task?:      ChecklistTask
  onClick?:   () => void
  ctaLabel?:  string
}

interface NextStepsProps {
  employeeId:    string
  tasks:         ChecklistTask[]
  docs:          OnboardingStatusDoc[]
  blockingItems: string[]
  notifications: OnboardingNotification[]
  onOpenTab:     (tab: string) => void
  onNavigate:    (link: string) => void
}

export function NextSteps({
  employeeId, tasks, docs, blockingItems, notifications, onOpenTab, onNavigate,
}: NextStepsProps) {
  const toggle = useToggleTask(employeeId)

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = []

    // 1. Documents that failed extraction / need re-checking (employee can't fix
    //    inline here, but should know — points them at the Documents tab).
    docs
      .filter(d => d.extraction_status === 'failed' || d.extraction_status === 'rejected')
      .forEach(d => out.push({
        key: `doc-${d.id}`, kind: 'document', priority: 0,
        title: `${docLabel(d.document_type)} needs attention`,
        hint: 'Your HR team may ask you to re-share this document.',
        ctaLabel: 'View documents', onClick: () => onOpenTab('documents'),
      }))

    // 2. Mandatory tasks the employee owns — actionable inline.
    tasks
      .filter(t => isEmployeeActionable(t.assigned_to_role) && !isTaskDone(t.status) && t.is_mandatory)
      .forEach(t => out.push({
        key: `task-${t.id}`, kind: 'task', priority: 1,
        title: t.title, hint: t.description ?? undefined, task: t,
      }))

    // 3. Action-required inbox items with a navigation target.
    notifications
      .filter(n => n.status === 'unread' && n.item_type === 'action_required' && n.action_route)
      .slice(0, 3)
      .forEach(n => out.push({
        key: `notif-${n.id}`, kind: 'notification', priority: 2,
        title: n.title, hint: n.summary,
        ctaLabel: n.action_label ?? 'Open', onClick: () => onNavigate(n.action_route as string),
      }))

    // 4. Optional tasks the employee owns.
    tasks
      .filter(t => isEmployeeActionable(t.assigned_to_role) && !isTaskDone(t.status) && !t.is_mandatory)
      .forEach(t => out.push({
        key: `task-${t.id}`, kind: 'task', priority: 3,
        title: t.title, hint: t.description ?? undefined, task: t,
      }))

    // 5. Readiness blockers not already represented by a concrete task/doc above.
    if (out.length === 0) {
      blockingItems.slice(0, 3).forEach((text, i) => out.push({
        key: `block-${i}`, kind: 'blocker', priority: 4, title: text,
        ctaLabel: 'See readiness', onClick: () => onOpenTab('overview'),
      }))
    }

    return out.sort((a, b) => a.priority - b.priority).slice(0, 5)
  }, [tasks, docs, blockingItems, notifications, onOpenTab, onNavigate])

  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-6 text-center">
        <Sparkles className="mx-auto mb-2 h-7 w-7 text-success" />
        <p className="text-sm font-semibold text-success">You’re all caught up</p>
        <p className="mt-0.5 text-xs text-success/80">
          Nothing needs your attention right now. Nice work!
        </p>
      </div>
    )
  }

  const completeTask = (task: ChecklistTask) => {
    toggle.mutate(
      { taskId: task.id, next: 'completed' },
      {
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not update task'),
        onSuccess: () => toast.success('Nice — one less thing to do'),
      },
    )
  }

  return (
    <div className="space-y-2">
      {steps.map(step => (
        <div
          key={step.key}
          className="flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-[#2E6FE6]/40"
        >
          <StepIcon kind={step.kind} pending={!!step.task && toggle.isPending && toggle.variables?.taskId === step.task.id} />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            {step.hint && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{step.hint}</p>}
          </div>

          {step.task ? (
            <button
              onClick={() => completeTask(step.task as ChecklistTask)}
              disabled={toggle.isPending}
              className="shrink-0 rounded-lg bg-[#2E6FE6] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1A4D8F] disabled:opacity-50"
            >
              Mark done
            </button>
          ) : step.onClick ? (
            <button
              onClick={step.onClick}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {step.ctaLabel} <ArrowRight className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function StepIcon({ kind, pending }: { kind: StepKind; pending: boolean }) {
  if (pending) return <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
  const cls = 'mt-0.5 h-5 w-5 shrink-0'
  switch (kind) {
    case 'task':         return <Circle className={cn(cls, 'text-[#2E6FE6]')} />
    case 'document':     return <FileWarning className={cn(cls, 'text-amber-500')} />
    case 'notification': return <Bell className={cn(cls, 'text-[#2E6FE6]')} />
    case 'blocker':      return <AlertTriangle className={cn(cls, 'text-red-500')} />
    default:             return <CheckCircle2 className={cls} />
  }
}

export default NextSteps
