/**
 * ManagerPersonaToggle — compact segmented "Employee / Manager" switch.
 *
 * Shown only inside the Manager Console (/manager/*) for users who actually
 * hold a manager identity. It lets a manager flip the LEFT NAVIGATION between
 * their own self-service (Employee) and their team operations (Manager) instead
 * of stacking both personas in one long sidebar.
 *
 * The active persona is DERIVED from the route — `/manager/self/*` ⇒ Employee,
 * everything else under `/manager` ⇒ Manager — so the toggle, the sidebar and
 * the URL can never desync, and switching never remounts the shell (both
 * personas already live inside ManagerShell).
 *
 * Colour language matches the sidebar active pills: Employee = primary (blue),
 * Manager = warning (amber).
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { User2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'

type Persona = 'employee' | 'manager'

const OPTIONS: { id: Persona; label: string; icon: React.ComponentType<{ className?: string }>; href: string }[] = [
  { id: 'employee', label: 'Employee', icon: User2, href: '/manager/self/dashboard' },
  { id: 'manager',  label: 'Manager',  icon: Users, href: '/manager/dashboard'      },
]

export function ManagerPersonaToggle() {
  const { profile }  = useAuthStore()
  const activeRole   = useUIStore((s) => s.activeRole)
  const location     = useLocation()
  const navigate     = useNavigate()

  // Only inside the Manager Console, only for manager identities.
  const inManagerConsole = location.pathname.startsWith('/manager')
  const isManager = profile?.role === 'manager' || activeRole === 'manager'
  if (!inManagerConsole || !isManager) return null

  const persona: Persona = location.pathname.startsWith('/manager/self') ? 'employee' : 'manager'

  return (
    <div
      role="tablist"
      aria-label="Switch between Employee and Manager view"
      className="hidden sm:inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = persona === o.id
        const isEmp  = o.id === 'employee'
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${o.label} view`}
            onClick={() => { if (!active) navigate(o.href) }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-medium transition-colors',
              active
                ? isEmp
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-warning text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <o.icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
