import * as React from 'react'
import {
  ClipboardCheck,
  CalendarOff,
  CalendarClock,
  Clock,
  CheckSquare,
  Users,
  Search,
  FileX,
  ShieldCheck,
  FileSearch,
  BarChart2,
  type LucideIcon,
} from 'lucide-react'
export type EmptyTablePreset =
  | 'no-corrections'
  | 'no-leave'
  | 'no-roster'
  | 'no-shifts'
  | 'no-approvals'
  | 'no-employees'
  | 'no-results'
  | 'no-anomalies'
  | 'no-audit'
  | 'no-muster'
  | 'custom'

export interface EmptyTableStateProps {
  preset?:      EmptyTablePreset
  title?:       string
  description?: string
  action?:      React.ReactNode
  icon?:        React.ComponentType<{ className?: string }>
}

const PRESETS: Record<EmptyTablePreset, { icon: LucideIcon; title: string; description: string }> = {
  'no-corrections': {
    icon:        ClipboardCheck,
    title:       'No corrections found',
    description: 'All correction requests have been reviewed.',
  },
  'no-leave': {
    icon:        CalendarOff,
    title:       'No leave requests',
    description: 'No leave applications match the current filters.',
  },
  'no-roster': {
    icon:        CalendarClock,
    title:       'No roster assignments',
    description: 'No shifts have been assigned for this period.',
  },
  'no-shifts': {
    icon:        Clock,
    title:       'No shift assignments',
    description: 'No employees have shifts assigned.',
  },
  'no-approvals': {
    icon:        CheckSquare,
    title:       'No pending approvals',
    description: 'All items have been reviewed.',
  },
  'no-employees': {
    icon:        Users,
    title:       'No employees found',
    description: 'Try adjusting your search or filters.',
  },
  'no-results': {
    icon:        Search,
    title:       'No results',
    description: 'Try adjusting your filters or search term.',
  },
  'no-anomalies': {
    icon:        ShieldCheck,
    title:       'No anomalies detected',
    description: 'All attendance records look clean for the selected filters.',
  },
  'no-audit': {
    icon:        FileSearch,
    title:       'No audit entries',
    description: 'No attendance changes match the applied filters.',
  },
  'no-muster': {
    icon:        BarChart2,
    title:       'No attendance data',
    description: 'No records found for this period. Run attendance processing to populate the muster roll.',
  },
  'custom': {
    icon:        FileX,
    title:       'No data',
    description: 'Nothing to show here.',
  },
}

export function EmptyTableState({
  preset = 'custom',
  title,
  description,
  action,
  icon: IconOverride,
}: EmptyTableStateProps) {
  const preset_data = PRESETS[preset]
  const Icon        = IconOverride ?? preset_data.icon
  const resolvedTitle = title ?? preset_data.title
  const resolvedDesc  = description ?? preset_data.description

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      <Icon className="h-8 w-8 opacity-40" />
      <p className="text-sm font-medium text-foreground">{resolvedTitle}</p>
      <p className="text-xs text-muted-foreground text-center max-w-xs">{resolvedDesc}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
