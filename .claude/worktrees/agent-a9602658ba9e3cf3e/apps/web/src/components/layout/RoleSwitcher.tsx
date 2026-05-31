/**
 * RoleSwitcher
 *
 * Dropdown in the Topbar that lets admin users:
 *   • Switch between Admin Portal and ESS portal (all environments)
 *   • Preview the UI as different roles (DEV only — NOT real authorization)
 *
 * Rules:
 *   • employee role     → no switcher (only one portal available)
 *   • admin roles       → can switch to ESS Preview
 *   • DEV mode only     → can also preview as hr_admin, manager, employee
 *     within the admin portal to test RBAC-gated UI without touching the backend
 *
 * ⚠️  The role preview is PURELY a frontend rendering aid.
 *     API requests always use the real JWT and the real server-side role.
 *     This is guarded by import.meta.env.DEV — tree-shaken in production builds.
 */

import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight, ShieldCheck, User2, ChevronDown,
  Users, Briefcase, FlaskConical,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore }   from '@/stores/uiStore'
import { getBasePath, isAdminRole } from '@/lib/routing'
import type { UserRole } from '@/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Role labels ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  hr_admin:    'HR Admin',
  manager:     'Manager',
  employee:    'Employee',
}

function roleLabel(role: UserRole | null | undefined): string {
  if (!role) return 'Unknown'
  return ROLE_LABELS[role] ?? role
}

// ── Portal view type ──────────────────────────────────────────────────────────

interface PortalView {
  /** null = revert to real profile.role */
  role:        UserRole | null
  label:       string
  description: string
  icon:        React.ComponentType<{ className?: string }>
  /** If true, only shown in DEV mode */
  devOnly?:    boolean
}

// ── View builder ──────────────────────────────────────────────────────────────

function buildViews(realRole: UserRole): PortalView[] {
  if (realRole === 'employee') return []

  const views: PortalView[] = [
    {
      role:        null,
      label:       'Admin Portal',
      description: 'Manage people, attendance & leave',
      icon:        ShieldCheck,
    },
    {
      role:        'employee',
      label:       'ESS Preview',
      description: 'See the employee self-service portal',
      icon:        User2,
    },
  ]

  // ⚠️  Dev-only previews — tree-shaken in production via import.meta.env.DEV
  if (import.meta.env.DEV) {
    if (realRole === 'super_admin') {
      views.push(
        {
          role:        'hr_admin',
          label:       'Preview: HR Admin',
          description: 'Admin portal as hr_admin role',
          icon:        Users,
          devOnly:     true,
        },
        {
          role:        'manager',
          label:       'Preview: Manager',
          description: 'Admin portal as manager role',
          icon:        Briefcase,
          devOnly:     true,
        },
      )
    }
    if (['super_admin', 'hr_admin'].includes(realRole)) {
      views.push({
        role:        'employee',
        label:       'Preview: Employee',
        description: 'ESS portal as employee role',
        icon:        User2,
        devOnly:     true,
      })
    }
  }

  // De-dupe by role label (ESS Preview and Preview: Employee overlap for some roles)
  const seen = new Set<string>()
  return views.filter(v => {
    const key = `${v.role}:${v.devOnly ?? false}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RoleSwitcher() {
  const { profile }                = useAuthStore()
  const { activeRole, setActiveRole } = useUIStore()
  const navigate                   = useNavigate()

  if (!profile) return null

  const realRole = profile.role
  const views    = buildViews(realRole)

  if (views.length === 0) return null

  const effectiveRole = activeRole ?? realRole
  const isAdminView   = isAdminRole(effectiveRole)
  const isPreviewMode = activeRole !== null

  function handleSwitch(view: PortalView) {
    setActiveRole(view.role)
    const targetRole = view.role ?? realRole
    const path       = getBasePath(targetRole)
    // Stay in admin portal for dev role previews; only navigate for ESS switch
    if (view.devOnly) {
      // Reload current admin route — no navigation needed
      navigate('/admin/dashboard')
    } else {
      navigate(`${path}/dashboard`)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 text-xs font-medium hidden sm:flex',
            isPreviewMode && import.meta.env.DEV
              ? 'border-warning/40 text-warning hover:bg-warning/5'
              : isAdminView
                ? 'border-primary/30 text-primary hover:bg-primary/5'
                : 'border-info/30 text-info hover:bg-info/5',
          )}
        >
          {isPreviewMode && import.meta.env.DEV ? (
            <FlaskConical className="h-3.5 w-3.5" />
          ) : isAdminView ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <User2 className="h-3.5 w-3.5" />
          )}
          <span>
            {isPreviewMode && import.meta.env.DEV
              ? `As: ${roleLabel(activeRole)}`
              : isAdminView ? 'Admin' : 'ESS Preview'}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Signed in as{' '}
          <span className="font-semibold text-foreground">{roleLabel(realRole)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* ── Standard portal switch ──────────────────────────────────────── */}
        <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Switch Portal
        </p>

        {views
          .filter(v => !v.devOnly)
          .map((view) => {
            const isActive = activeRole === view.role || (view.role === null && activeRole === null)
            return (
              <DropdownMenuItem
                key={view.label}
                onClick={() => handleSwitch(view)}
                className={cn(
                  'flex items-start gap-2.5 py-2 cursor-pointer',
                  isActive && 'bg-primary/[0.08] text-primary focus:bg-primary/10 focus:text-primary',
                )}
              >
                <view.icon
                  className={cn(
                    'h-4 w-4 mt-0.5 flex-shrink-0',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{view.label}</span>
                    {isActive && (
                      <span className="text-[9px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold leading-none">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{view.description}</p>
                </div>
              </DropdownMenuItem>
            )
          })}

        {/* ── Dev-only role previews ──────────────────────────────────────── */}
        {import.meta.env.DEV && views.some(v => v.devOnly) && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-[10px] font-semibold text-warning/70 uppercase tracking-wider flex items-center gap-1">
              <FlaskConical className="h-2.5 w-2.5" />
              Dev Preview (UI only)
            </p>

            {views
              .filter(v => v.devOnly)
              .map((view) => {
                const isActive = activeRole === view.role
                return (
                  <DropdownMenuItem
                    key={view.label}
                    onClick={() => handleSwitch(view)}
                    className={cn(
                      'flex items-start gap-2.5 py-2 cursor-pointer',
                      isActive && 'bg-warning/[0.08] text-warning focus:bg-warning/10 focus:text-warning',
                    )}
                  >
                    <view.icon
                      className={cn(
                        'h-4 w-4 mt-0.5 flex-shrink-0',
                        isActive ? 'text-warning' : 'text-muted-foreground/60',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{view.label}</span>
                        {isActive && (
                          <span className="text-[9px] bg-warning/20 text-warning rounded-full px-1.5 py-0.5 font-semibold leading-none">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/60 truncate">{view.description}</p>
                    </div>
                  </DropdownMenuItem>
                )
              })}
          </>
        )}

        {/* ── Reset ──────────────────────────────────────────────────────── */}
        {activeRole !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-muted-foreground gap-2"
              onClick={() => {
                setActiveRole(null)
                navigate('/admin/dashboard')
              }}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Back to my real role
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
