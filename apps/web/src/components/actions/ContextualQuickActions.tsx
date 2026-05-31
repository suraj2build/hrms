import React, { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  DollarSign,
  Lock,
  TrendingDown,
  UserCog,
  Brain,
  ClipboardCheck,
  AlertTriangle,
  Activity,
  UserPlus,
  CalendarCheck,
  CalendarClock,
  Upload,
  CheckSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ClipboardEdit is available in newer lucide versions; use a safe fallback alias
import { ClipboardEdit } from 'lucide-react'

interface QuickAction {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  route?: string
  action?: () => void
  variant?: 'default' | 'outline' | 'ghost'
  badge?: number
}

interface ContextualQuickActionsProps {
  layout?: 'grid' | 'list'
  compact?: boolean
  className?: string
}

function getActionsForPath(pathname: string): QuickAction[] {
  if (pathname.includes('/payroll')) {
    return [
      {
        id: 'run-payroll',
        label: 'Run Payroll',
        icon: DollarSign,
        route: '/admin/payroll',
      },
      {
        id: 'validate',
        label: 'Validate Readiness',
        icon: CheckSquare,
        route: '/admin/payroll-readiness',
      },
      {
        id: 'lock-payroll',
        label: 'Lock Period',
        icon: Lock,
        route: '/admin/attendance/periods',
      },
      {
        id: 'review-var',
        label: 'Review Variance',
        icon: TrendingDown,
        route: '/admin/payroll/variance',
      },
    ]
  }

  if (
    pathname.includes('/roster') ||
    pathname.includes('/masters/rosters') ||
    pathname.includes('/masters/rotation-policies') ||
    pathname.includes('/employee-shifts')
  ) {
    return [
      {
        id: 'roster-policies',
        label: 'Roster Policies',
        icon: CalendarClock,
        route: '/admin/masters/rosters',
      },
      {
        id: 'rotation-policies',
        label: 'Rotation Policies',
        icon: CalendarClock,
        route: '/admin/masters/rotation-policies',
      },
      {
        id: 'assign-shift',
        label: 'Shift Overrides',
        icon: UserCog,
        route: '/admin/employee-shifts',
      },
      {
        id: 'roster-intel',
        label: 'Roster Intelligence',
        icon: Brain,
        route: '/admin/roster/intelligence',
      },
    ]
  }

  if (pathname.includes('/attendance')) {
    return [
      {
        id: 'approve-punch',
        label: 'Approve Punches',
        icon: ClipboardCheck,
        route: '/admin/attendance/corrections',
      },
      {
        id: 'resolve-anom',
        label: 'Resolve Anomaly',
        icon: AlertTriangle,
        route: '/admin/attendance/anomalies',
      },
      {
        id: 'regularize',
        label: 'Regularize',
        icon: ClipboardEdit,
        route: '/admin/attendance/regularisation',
      },
      {
        id: 'session-intel',
        label: 'Session Intel',
        icon: Activity,
        route: '/admin/attendance/intelligence-center',
      },
    ]
  }

  // Default / global actions
  return [
    {
      id: 'new-employee',
      label: 'Add Employee',
      icon: UserPlus,
      route: '/admin/employees/new',
    },
    {
      id: 'leave-approvals',
      label: 'Leave Approvals',
      icon: CalendarCheck,
      route: '/admin/approvals/inbox',
    },
    {
      id: 'payroll-run',
      label: 'Run Payroll',
      icon: DollarSign,
      route: '/admin/payroll',
    },
    {
      id: 'upload',
      label: 'Upload Attendance',
      icon: Upload,
      route: '/admin/attendance/upload',
    },
  ]
}

function ContextualQuickActionsImpl({
  layout = 'grid',
  compact = false,
  className,
}: ContextualQuickActionsProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const actions = getActionsForPath(pathname)

  const handleClick = useCallback(
    (action: QuickAction) => {
      if (action.action) {
        action.action()
      } else if (action.route) {
        navigate(action.route)
      }
    },
    [navigate]
  )

  return (
    <div
      className={cn(
        'grid gap-2',
        layout === 'grid' ? 'grid-cols-2' : 'grid-cols-1',
        compact && 'gap-1',
        className
      )}
    >
      {actions.map((action) => {
        const ActionIcon = action.icon
        return (
          <button
            key={action.id}
            onClick={() => handleClick(action)}
            aria-label={action.label}
            className={cn(
              'relative flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground',
              'hover:bg-muted/60 hover:border-primary/30 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              layout === 'grid' && 'flex-col justify-center gap-1.5 p-3'
            )}
          >
            {typeof action.badge === 'number' && action.badge > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold"
                aria-label={`${action.badge} pending`}
              >
                {action.badge > 9 ? '9+' : action.badge}
              </span>
            )}
            <ActionIcon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <span className={cn('leading-tight', layout === 'grid' && 'text-center')}>
              {action.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export const ContextualQuickActions = React.memo(ContextualQuickActionsImpl)
