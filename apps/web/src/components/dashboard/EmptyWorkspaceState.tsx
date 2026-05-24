import { cn } from '@/lib/utils'
import { CheckCircle2, CalendarCheck, ClipboardCheck, Users, Bell } from 'lucide-react'

type WorkspaceContext =
  | 'no-approvals'
  | 'no-shifts'
  | 'no-corrections'
  | 'no-team'
  | 'no-alerts'
  | 'custom'

const PRESETS: Record<WorkspaceContext, { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }> = {
  'no-approvals':   { icon: CheckCircle2,    title: 'All caught up',          subtitle: 'No pending approvals at this time.' },
  'no-shifts':      { icon: CalendarCheck,   title: 'Schedule clear',         subtitle: 'No upcoming shift overrides.' },
  'no-corrections': { icon: ClipboardCheck,  title: 'No corrections pending', subtitle: 'All attendance corrections are resolved.' },
  'no-team':        { icon: Users,           title: 'No team data',           subtitle: 'Team attendance information is not available.' },
  'no-alerts':      { icon: Bell,            title: 'No alerts',              subtitle: 'No anomalies or system alerts detected.' },
  'custom':         { icon: CheckCircle2,    title: '',                       subtitle: '' },
}

interface EmptyWorkspaceStateProps {
  context?: WorkspaceContext
  /** Override title/subtitle/icon */
  icon?: React.ComponentType<{ className?: string }>
  title?: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyWorkspaceState({
  context = 'custom', icon, title, subtitle, action, className,
}: EmptyWorkspaceStateProps) {
  const preset = PRESETS[context]
  const Icon   = icon ?? preset.icon
  const t      = title ?? preset.title
  const s      = subtitle ?? preset.subtitle

  return (
    <div className={cn('flex items-center gap-2.5 px-1 py-2.5', className)}>
      <div className="h-6 w-6 rounded-full bg-muted/40 flex items-center justify-center flex-shrink-0">
        <Icon className="h-3 w-3 text-muted-foreground/40" />
      </div>
      <div className="min-w-0">
        {t && <p className="text-xs font-medium text-muted-foreground/60 leading-none">{t}</p>}
        {s && <p className="text-[11px] text-muted-foreground/40 mt-0.5 leading-snug">{s}</p>}
      </div>
      {action && <div className="ml-auto flex-shrink-0">{action}</div>}
    </div>
  )
}
