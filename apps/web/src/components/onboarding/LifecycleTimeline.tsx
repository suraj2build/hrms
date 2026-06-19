/**
 * LifecycleTimeline.tsx — Phase O2: Canonical Employee Journey Timeline.
 *
 * Reusable component consumed by Employee 360, Employee Profile,
 * HR Workspace, and any future surface that needs an employee journey view.
 *
 * Props:
 *   sessionId  — load by onboarding session
 *   employeeId — load by employee (post-joining)
 * At least one must be provided.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldX,
  ClipboardList,
  UserCheck,
  Play,
  Cpu,
  Trophy,
  User,
  AlertTriangle,
  Info,
} from 'lucide-react'

// ── Types (mirrors backend TimelineItem) ──────────────────────────────────────

type TimelineCategory =
  | 'milestone'
  | 'action'
  | 'verification'
  | 'approval'
  | 'exception'
  | 'system'

type ReadinessDimension =
  | 'documents'
  | 'verification'
  | 'tasks'
  | 'approvals'
  | 'joining'
  | 'none'

type TimelineSeverity = 'info' | 'success' | 'warning' | 'critical'

interface TimelineItem {
  id:                  string
  occurred_at:         string
  event_type:          string
  title:               string
  description:         string | null
  actor_id:            string | null
  actor_name:          string | null
  source:              string
  category:            TimelineCategory
  severity:            TimelineSeverity
  readiness_dimension: ReadinessDimension
  is_milestone:        boolean
}

interface TimelineResult {
  items:       TimelineItem[]
  total:       number
  session_id:  string | null
  employee_id: string | null
}

// ── Visual metadata ───────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<TimelineCategory, React.ComponentType<{ className?: string }>> = {
  milestone:    Trophy,
  action:       Play,
  verification: ShieldCheck,
  approval:     UserCheck,
  exception:    ShieldX,
  system:       Cpu,
}

const SEVERITY_ICON: Record<TimelineSeverity, React.ComponentType<{ className?: string }>> = {
  info:     Info,
  success:  CheckCircle2,
  warning:  AlertTriangle,
  critical: XCircle,
}

const READINESS_LABEL: Record<ReadinessDimension, string | null> = {
  documents:    'Documents',
  verification: 'Verification',
  tasks:        'Tasks',
  approvals:    'Approvals',
  joining:      'Joining',
  none:         null,
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Individual timeline item ───────────────────────────────────────────────────

function TimelineEntry({ item, isLast }: { item: TimelineItem; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const CategoryIcon = CATEGORY_ICON[item.category]
  const SeverityIcon = SEVERITY_ICON[item.severity]
  const hasDetail    = Boolean(item.description || item.actor_name)
  const readLabel    = READINESS_LABEL[item.readiness_dimension]

  return (
    <div className="flex gap-3">
      {/* Spine + dot */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'mt-1 h-7 w-7 shrink-0 rounded-full flex items-center justify-center ring-2 ring-background',
            item.is_milestone
              ? 'bg-gradient-to-br from-[#2E6FE6] to-[#15B8A6]'
              : item.severity === 'critical' ? 'bg-destructive dark:bg-red-900/30'
              : item.severity === 'warning'  ? 'bg-warning dark:bg-amber-900/30'
              : item.severity === 'success'  ? 'bg-success dark:bg-emerald-900/30'
              : 'bg-muted',
          )}
        >
          {item.is_milestone
            ? <CategoryIcon className="h-3.5 w-3.5 text-white" />
            : <SeverityIcon className={cn(
                'h-3.5 w-3.5',
                item.severity === 'critical' ? 'text-destructive dark:text-red-400'
                : item.severity === 'warning'  ? 'text-warning dark:text-amber-400'
                : item.severity === 'success'  ? 'text-success dark:text-emerald-400'
                : 'text-info dark:text-blue-400',
              )} />
          }
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className={cn('pb-5 flex-1 min-w-0', isLast && 'pb-1')}>
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm leading-tight',
              item.is_milestone ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}>
              {item.title}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(item.occurred_at)}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {item.is_milestone && (
              <Badge variant="teal" className="text-[10px] py-0">Milestone</Badge>
            )}
            {readLabel && (
              <Badge variant="secondary" className="text-[10px] py-0">{readLabel}</Badge>
            )}
          </div>
        </div>

        {/* Expandable detail */}
        {hasDetail && (
          <>
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Hide detail' : 'Show detail'}
            </button>

            {expanded && (
              <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1 text-xs">
                {item.description && (
                  <p className="text-muted-foreground">{item.description}</p>
                )}
                {item.actor_name && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span>{item.actor_name}</span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 font-mono">
                  {item.event_type} · {item.source}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Milestone progress bar ────────────────────────────────────────────────────

const ORDERED_MILESTONES = [
  { event: 'onboarding.session.created',    label: 'Started'    },
  { event: 'onboarding.session.approved',   label: 'Approved'   },
  { event: 'onboarding.joining.completed',  label: 'Joined'     },
  { event: 'onboarding.checklist.completed',label: 'Onboarded'  },
]

function MilestoneBar({ items }: { items: TimelineItem[] }) {
  const achieved = new Set(items.map(i => i.event_type))
  let current = -1
  for (let i = ORDERED_MILESTONES.length - 1; i >= 0; i--) {
    if (achieved.has(ORDERED_MILESTONES[i].event)) { current = i; break }
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Journey progress</p>
      <div className="flex items-center gap-0">
        {ORDERED_MILESTONES.map((m, idx) => {
          const done    = achieved.has(m.event)
          const active  = idx === current + 1 && !done
          const isLast  = idx === ORDERED_MILESTONES.length - 1

          return (
            <div key={m.event} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={cn(
                  'h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors',
                  done
                    ? 'border-success bg-success'
                    : active
                    ? 'border-[#2E6FE6] bg-[#2E6FE6]/10'
                    : 'border-border bg-background',
                )}>
                  {done && <CheckCircle2 className="h-3 w-3 text-white" />}
                  {active && <div className="h-2 w-2 rounded-full bg-[#2E6FE6]" />}
                </div>
                <span className={cn(
                  'text-[9px] font-medium text-center whitespace-nowrap',
                  done    ? 'text-success dark:text-emerald-400'
                  : active ? 'text-[#2E6FE6]'
                  : 'text-muted-foreground',
                )}>{m.label}</span>
              </div>
              {!isLast && (
                <div className={cn(
                  'flex-1 h-px mx-1 mb-4 transition-colors',
                  done ? 'bg-success' : 'bg-border',
                )} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface LifecycleTimelineProps {
  sessionId?:  string
  employeeId?: string
  /** Suppress the milestone progress bar (useful when embedding inline) */
  hideProgressBar?: boolean
  className?: string
}

export function LifecycleTimeline({
  sessionId,
  employeeId,
  hideProgressBar = false,
  className,
}: LifecycleTimelineProps) {
  const enabled = Boolean(sessionId || employeeId)

  const queryUrl = sessionId
    ? `/onboarding/sessions/${sessionId}/timeline`
    : `/employees/${employeeId}/onboarding-timeline`

  const { data, isLoading, isError, error } = useQuery({
    queryKey:  ['lifecycle-timeline', sessionId ?? employeeId],
    queryFn:   () => api.get<{ data: TimelineResult }>(queryUrl).then(r => r.data),
    enabled,
    staleTime: 60_000,
  })

  if (!enabled) return null

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm', className)}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading journey timeline…
      </div>
    )
  }

  if (isError) {
    return (
      <div className={cn('rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive', className)}>
        Failed to load timeline: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border bg-muted/30 p-6 text-center', className)}>
        <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No journey events recorded yet.</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {!hideProgressBar && <MilestoneBar items={data.items} />}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Journey Events
          </h3>
          <span className="text-[11px] text-muted-foreground">{data.total} event{data.total !== 1 ? 's' : ''}</span>
        </div>

        <div className="space-y-0">
          {data.items.map((item, idx) => (
            <TimelineEntry
              key={item.id}
              item={item}
              isLast={idx === data.items.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default LifecycleTimeline
