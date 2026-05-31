import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlarmClock,
  CalendarClock,
  Clock,
  DollarSign,
  CalendarCheck,
  Users,
  Settings2,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ModuleEmptyStateProps {
  module:
    | 'shifts'
    | 'roster'
    | 'attendance'
    | 'payroll'
    | 'leave'
    | 'employees'
    | 'compliance'
  variant?: 'no-data' | 'not-configured' | 'no-permission' | 'coming-soon'
  className?: string
}

interface CtaConfig {
  label: string
  route: string
}

interface EmptyStateConfig {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  prerequisites?: string
  nextStep?: string
  cta?: CtaConfig
  secondaryCta?: CtaConfig
  helpLink?: string
}

function getConfig(
  module: ModuleEmptyStateProps['module'],
  variant: NonNullable<ModuleEmptyStateProps['variant']>
): EmptyStateConfig {
  // Per-module configurations
  if (module === 'shifts' && variant === 'not-configured') {
    return {
      icon: AlarmClock,
      title: 'No shifts defined yet',
      description: 'Set up shift timings to start scheduling your workforce.',
      nextStep: 'Define your first shift',
      cta: { label: 'Create Shift', route: '/admin/shift-master' },
    }
  }

  if (module === 'roster' && variant === 'not-configured') {
    return {
      icon: CalendarClock,
      title: 'Workforce governance not configured',
      description:
        'Set up a Roster Policy (weekly-off pattern) and Rotation Policy (shift mapping) for each site to enable attendance processing.',
      nextStep: 'Configure Roster Policy and Rotation Policy before running attendance',
      prerequisites: 'Requires: Shift Definitions · Roster Policy · Rotation Policy',
      cta: { label: 'Configure Roster Policy', route: '/admin/masters/rosters' },
    }
  }

  if (module === 'attendance' && variant === 'not-configured') {
    return {
      icon: Clock,
      title: 'Attendance not yet active',
      description:
        'Configure shifts and build the roster before attendance tracking begins.',
      prerequisites: 'Requires: Shifts → Rosters',
      cta: { label: 'Set Up Shifts', route: '/admin/shift-master' },
    }
  }

  if (module === 'payroll' && variant === 'not-configured') {
    return {
      icon: DollarSign,
      title: 'Payroll not configured',
      description:
        'Add salary components and employee compensation before running payroll.',
      prerequisites: 'Requires: Employees → Compensation',
      cta: {
        label: 'Configure Salary Components',
        route: '/admin/payroll/salary-components',
      },
    }
  }

  if (module === 'leave' && variant === 'not-configured') {
    return {
      icon: CalendarCheck,
      title: 'Leave policies not set up',
      description:
        'Define leave types and policies for your organization.',
      cta: { label: 'Create Leave Types', route: '/admin/leave-types' },
    }
  }

  if (module === 'employees' && variant === 'no-data') {
    return {
      icon: Users,
      title: 'No employees yet',
      description:
        'Import employee data or add employees manually to get started.',
      cta: { label: 'Add Employee', route: '/admin/employees/new' },
      secondaryCta: { label: 'Bulk Import', route: '/admin/import' },
    }
  }

  // Generic fallback (covers compliance, coming-soon, no-permission, and unmatched combos)
  const genericTitle =
    variant === 'no-permission'
      ? 'Access restricted'
      : variant === 'coming-soon'
      ? 'Coming soon'
      : 'Module not configured'

  const genericDescription =
    variant === 'no-permission'
      ? 'You do not have permission to view this module. Contact your administrator.'
      : variant === 'coming-soon'
      ? 'This feature is under development and will be available shortly.'
      : 'Complete the initial setup to start using this module.'

  return {
    icon: Settings2,
    title: genericTitle,
    description: genericDescription,
    helpLink: variant === 'not-configured' ? 'View setup guide →' : undefined,
  }
}

export function ModuleEmptyState({
  module,
  variant = 'not-configured',
  className,
}: ModuleEmptyStateProps) {
  const navigate = useNavigate()

  const config = getConfig(module, variant)
  const ModuleIcon = config.icon

  const handleCta = useCallback(
    (route: string) => {
      navigate(route)
    },
    [navigate]
  )

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-12 px-6 text-center',
        className
      )}
    >
      {/* Icon container */}
      <div className="rounded-full bg-muted p-4">
        <ModuleIcon className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
      </div>

      {/* Text */}
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">{config.title}</h3>
        <p className="text-xs text-muted-foreground">{config.description}</p>
      </div>

      {/* Prerequisites chips */}
      {config.prerequisites && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{config.prerequisites}</span>
        </div>
      )}

      {/* Next step hint */}
      {config.nextStep && (
        <p className="text-xs font-medium text-primary">{config.nextStep}</p>
      )}

      {/* CTAs */}
      {(config.cta || config.secondaryCta || config.helpLink) && (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {config.cta && (
            <Button
              size="sm"
              onClick={() => handleCta(config.cta!.route)}
              aria-label={config.cta.label}
            >
              {config.cta.label}
            </Button>
          )}
          {config.secondaryCta && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCta(config.secondaryCta!.route)}
              aria-label={config.secondaryCta.label}
            >
              {config.secondaryCta.label}
            </Button>
          )}
          {config.helpLink && (
            <button className="text-xs text-primary hover:underline">
              {config.helpLink}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
