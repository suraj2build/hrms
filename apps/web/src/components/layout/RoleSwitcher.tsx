/**
 * RoleSwitcher — Workspace Context Switcher
 *
 * Lets admin users switch between three workspace contexts:
 *
 *   Admin Portal          → full HR management access (default for all admin roles)
 *   Manager Workspace     → operational team view; requires selecting a manager identity
 *   Employee Self Service → employee worklife hub; requires selecting an employee
 *
 * Rules:
 *   employee role   → no switcher (single workspace)
 *   manager role    → Admin Portal + Employee Self Service (they already are a manager)
 *   hr_admin / super_admin → all three workspaces
 *
 * Identity selection opens an inline searchable dialog scoped to the workspace.
 * Selected identities are stored in uiStore (session-only — not localStorage).
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState, useEffect, useRef }  from 'react'
import { useNavigate }                  from 'react-router-dom'
import { useQuery }                     from '@tanstack/react-query'
import {
  ShieldCheck, Users, User2, ChevronDown,
  Search, Loader2, ArrowLeft,
} from 'lucide-react'
import { useAuthStore }  from '@/stores/authStore'
import { useUIStore }    from '@/stores/uiStore'
import { api }           from '@/lib/api/client'
import type { UserRole } from '@/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { cn }     from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkspaceId = 'admin' | 'manager' | 'employee'

interface Workspace {
  id:          WorkspaceId
  label:       string
  description: string
  icon:        React.ComponentType<{ className?: string }>
}

interface EmployeeOption {
  id:            string
  first_name:    string
  last_name:     string
  employee_code: string
}

// ── Workspace definitions ─────────────────────────────────────────────────────

const WORKSPACES: Workspace[] = [
  {
    id:          'admin',
    label:       'Admin Portal',
    description: 'Full HR management access',
    icon:        ShieldCheck,
  },
  {
    id:          'manager',
    label:       'Manager Workspace',
    description: 'Team approvals & operational view',
    icon:        Users,
  },
  {
    id:          'employee',
    label:       'Employee Self Service',
    description: 'Employee worklife hub & self-service',
    icon:        User2,
  },
]

// Returns the workspace IDs available to a given role.
function getAccessibleWorkspaces(role: UserRole): WorkspaceId[] {
  if (role === 'employee') return []
  if (role === 'manager')  return []   // sidebar covers all navigation; no switcher needed
  // super_admin / hr_admin
  return ['admin', 'manager', 'employee']
}

// Derives the active workspace ID from uiStore state.
// Real manager users default to 'manager' — they never need to resolve to 'admin'.
function resolveActiveWorkspace(activeRole: UserRole | null, realRole: UserRole): WorkspaceId {
  if (activeRole === 'employee') return 'employee'
  if (activeRole === 'manager' || realRole === 'manager') return 'manager'
  return 'admin'
}

// ── Identity Picker Dialog ────────────────────────────────────────────────────

function IdentityPickerDialog({
  open,
  title,
  description,
  onClose,
  onSelect,
}: {
  open:        boolean
  title:       string
  description: string
  onClose:     () => void
  onSelect:    (emp: EmployeeOption) => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedSearch(search), 280)
    return () => clearTimeout(timerRef.current)
  }, [search])

  // Reset search when dialog opens
  useEffect(() => {
    if (open) { setSearch(''); setDebouncedSearch('') }
  }, [open])

  const { data, isFetching } = useQuery({
    queryKey: ['employee-options', debouncedSearch],
    queryFn:  () =>
      api.get<{ data: EmployeeOption[] }>(
        `/employees/options?search=${encodeURIComponent(debouncedSearch)}&limit=25`
      ).then((r: { data: EmployeeOption[] }) => r),
    enabled:   open,
    staleTime: 60_000,
  })

  const options = data?.data ?? []

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-9 text-sm"
              placeholder="Search by name or employee ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {isFetching && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto px-2 pb-3">
          {options.length === 0 && !isFetching && (
            <p className="text-center text-xs text-muted-foreground py-6">
              {debouncedSearch ? 'No employees found' : 'Start typing to search'}
            </p>
          )}

          {options.map((emp) => (
            <button
              key={emp.id}
              onClick={() => { onSelect(emp); onClose() }}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                'hover:bg-muted/60 active:bg-muted transition-colors',
              )}
            >
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-semibold text-primary uppercase">
                  {emp.first_name[0]}{emp.last_name[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-none truncate">
                  {emp.first_name} {emp.last_name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{emp.employee_code}</p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── RoleSwitcher ──────────────────────────────────────────────────────────────

export function RoleSwitcher() {
  const { profile } = useAuthStore()
  const {
    activeRole,
    setActiveRole,
    setImpersonatedEmployee,
    setImpersonatedManager,
    clearWorkspaceContext,
  } = useUIStore()
  const navigate = useNavigate()

  // Picker dialog state
  const [pickerFor, setPickerFor] = useState<'employee' | 'manager' | null>(null)

  if (!profile) return null

  const realRole   = profile.role
  const accessible = getAccessibleWorkspaces(realRole)
  if (accessible.length === 0) return null

  const activeWorkspace = resolveActiveWorkspace(activeRole, realRole)

  // Visible workspaces: only accessible ones (ordered by WORKSPACES array)
  const visible = WORKSPACES.filter(w => accessible.includes(w.id))

  // ── Trigger chip label / styling ──────────────────────────────────────────

  const ActiveIcon = WORKSPACES.find(w => w.id === activeWorkspace)?.icon ?? ShieldCheck

  const chipStyle = {
    admin:    'border-border text-foreground hover:bg-muted/60',
    manager:  'border-warning/40 bg-warning/5 text-warning hover:bg-warning/10',
    employee: 'border-info/40 bg-info/5 text-info hover:bg-info/10',
  }[activeWorkspace]

  const chipLabel = {
    admin:    'Admin Portal',
    manager:  'Manager Workspace',
    employee: 'Employee Self Service',
  }[activeWorkspace]

  // ── Workspace selection handler ───────────────────────────────────────────

  function handleSelect(ws: WorkspaceId) {
    if (ws === 'admin') {
      clearWorkspaceContext()
      navigate('/admin/dashboard')
      return
    }

    if (ws === 'employee') {
      // Manager users impersonating themselves don't need a picker — they ARE the employee.
      // But managers selecting ESS should also pick which employee (could be their subordinate).
      // Open picker for all roles.
      setPickerFor('employee')
      return
    }

    if (ws === 'manager') {
      // Only hr_admin / super_admin can select the Manager Workspace (to impersonate a manager).
      // Real manager users never see 'manager' as a selectable option — they're already there.
      setPickerFor('manager')
    }
  }

  // ── Employee selected ─────────────────────────────────────────────────────

  function handleEmployeeSelected(emp: EmployeeOption) {
    const identity = {
      id:   emp.id,
      name: `${emp.first_name} ${emp.last_name}`,
      code: emp.employee_code,
    }
    setImpersonatedEmployee(identity)
    setImpersonatedManager(null)
    setActiveRole('employee')
    // Navigate to ESS shell — ESS experience lives in EssShell, not AdminShell
    navigate('/ess/dashboard')
  }

  // ── Manager selected ──────────────────────────────────────────────────────

  function handleManagerSelected(mgr: EmployeeOption) {
    const identity = {
      id:   mgr.id,
      name: `${mgr.first_name} ${mgr.last_name}`,
      code: mgr.employee_code,
    }
    setImpersonatedManager(identity)
    setImpersonatedEmployee(null)
    setActiveRole('manager')
    // Navigate to Manager shell — Manager experience lives in ManagerShell, not AdminShell
    navigate('/manager/dashboard')
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Trigger + Dropdown ──────────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-8 gap-1.5 text-xs font-medium hidden sm:flex', chipStyle)}
          >
            <ActiveIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="max-w-[120px] truncate">{chipLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-60 flex-shrink-0" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64 p-1.5">
          <p className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Switch Workspace
          </p>

          {visible.map((ws) => {
            const WsIcon    = ws.icon
            const isActive  = activeWorkspace === ws.id

            const activeStyle = {
              admin:    'bg-primary/8 border-primary/20',
              manager:  'bg-warning/8 border-warning/20',
              employee: 'bg-info/8 border-info/20',
            }[ws.id]

            const iconStyle = {
              admin:    isActive ? 'bg-primary/15 text-primary'  : 'bg-muted text-muted-foreground',
              manager:  isActive ? 'bg-warning/15 text-warning'  : 'bg-muted text-muted-foreground',
              employee: isActive ? 'bg-info/15 text-info'        : 'bg-muted text-muted-foreground',
            }[ws.id]

            const labelStyle = {
              admin:    isActive ? 'text-primary'  : 'text-foreground',
              manager:  isActive ? 'text-warning'  : 'text-foreground',
              employee: isActive ? 'text-info'     : 'text-foreground',
            }[ws.id]

            return (
              <button
                key={ws.id}
                onClick={() => handleSelect(ws.id)}
                className={cn(
                  'w-full flex items-start gap-2.5 px-2.5 py-2.5 rounded-lg text-left transition-colors',
                  'hover:bg-muted/60',
                  isActive && cn('border', activeStyle),
                )}
              >
                <div className={cn(
                  'h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5',
                  iconStyle,
                )}>
                  <WsIcon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('text-sm font-medium leading-none', labelStyle)}>
                      {ws.label}
                    </span>
                    {isActive && (
                      <span className={cn(
                        'text-[9px] rounded-full px-1.5 py-0.5 font-semibold leading-none',
                        {
                          admin:    'bg-primary/15 text-primary',
                          manager:  'bg-warning/15 text-warning',
                          employee: 'bg-info/15 text-info',
                        }[ws.id],
                      )}>
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5 truncate">
                    {ws.description}
                  </p>
                </div>
              </button>
            )
          })}

          {/* Reset to Admin Portal — shown only when not in admin workspace */}
          {activeWorkspace !== 'admin' && (
            <>
              <div className="h-px bg-border mx-2 my-1.5" />
              <button
                onClick={() => { clearWorkspaceContext(); navigate('/admin/dashboard') }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Admin Portal
              </button>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Identity Picker Dialogs ─────────────────────────────────────── */}
      <IdentityPickerDialog
        open={pickerFor === 'employee'}
        title="Select Employee"
        description="Choose the employee whose self-service view you want to preview."
        onClose={() => setPickerFor(null)}
        onSelect={handleEmployeeSelected}
      />

      <IdentityPickerDialog
        open={pickerFor === 'manager'}
        title="Select Manager"
        description="Choose the manager whose workspace you want to view as."
        onClose={() => setPickerFor(null)}
        onSelect={handleManagerSelected}
      />
    </>
  )
}
