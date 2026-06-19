/**
 * TasksPanel — the new hire's self-service onboarding checklist.
 *
 * Employees toggle the tasks they own; items owned by HR/IT are shown read-only
 * with a lock. Prop-driven (the page already fetched the checklist) so it shares
 * cache with the rest of the workspace.
 */

import {
  Loader2, CheckCircle2, Circle, Lock, ClipboardList,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  isEmployeeActionable, isTaskDone, useToggleTask,
  type ChecklistTask,
} from './onboarding-data'

function TaskRow({ task, employeeId }: { task: ChecklistTask; employeeId: string }) {
  const toggle     = useToggleTask(employeeId)
  const actionable = isEmployeeActionable(task.assigned_to_role)
  const done       = isTaskDone(task.status)
  const pending    = toggle.isPending && toggle.variables?.taskId === task.id

  const onToggle = () => {
    if (!actionable) return
    toggle.mutate(
      { taskId: task.id, next: done ? 'pending' : 'completed' },
      { onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not update task') },
    )
  }

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5',
      done && 'bg-muted/40',
    )}>
      <button
        onClick={onToggle}
        disabled={!actionable || pending}
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
        className={cn('mt-0.5 shrink-0 transition-colors', actionable ? 'cursor-pointer' : 'cursor-default')}
      >
        {pending
          ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          : done
          ? <CheckCircle2 className="h-5 w-5 text-success" />
          : actionable
          ? <Circle className="h-5 w-5 text-muted-foreground hover:text-[#2E6FE6]" />
          : <Lock className="mt-0.5 h-4 w-4 text-muted-foreground/60" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('text-sm font-medium', done ? 'text-muted-foreground line-through' : 'text-foreground')}>
            {task.title}
          </span>
          {task.is_mandatory && !done && <Badge variant="warning" className="py-0 text-[10px]">Required</Badge>}
          {task.category && <Badge variant="secondary" className="py-0 text-[10px]">{task.category}</Badge>}
        </div>
        {task.description && <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>}
        {!actionable && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <Lock className="h-3 w-3" />
            Handled by your {task.assigned_to_role} team{done && ' — done'}
          </p>
        )}
      </div>
    </div>
  )
}

interface TasksPanelProps {
  employeeId: string
  tasks:      ChecklistTask[]
  isLoading:  boolean
  isError:    boolean
  stats:      { mandatoryDone: number; mandatory: ChecklistTask[]; myOpen: ChecklistTask[]; pct: number }
}

export function TasksPanel({ employeeId, tasks, isLoading, isError, stats }: TasksPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
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
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <ClipboardList className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No onboarding tasks assigned yet. Your HR team will set these up.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{stats.mandatoryDone}/{stats.mandatory.length} required complete</span>
          {stats.myOpen.length > 0 && (
            <Badge variant="info" className="py-0 text-[10px]">
              {stats.myOpen.length} action{stats.myOpen.length !== 1 ? 's' : ''} for you
            </Badge>
          )}
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">{stats.pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn('h-full rounded-full transition-all duration-500', stats.pct === 100 ? 'bg-emerald-500' : 'bg-[#2E6FE6]')}
          style={{ width: `${stats.pct}%` }}
        />
      </div>

      <div className="space-y-2 pt-1">
        {tasks.map(t => <TaskRow key={t.id} task={t} employeeId={employeeId} />)}
      </div>
    </div>
  )
}

export default TasksPanel
