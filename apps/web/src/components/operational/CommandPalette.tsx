/**
 * CommandPalette — global ⌘K / Ctrl+K accelerator.
 *
 * Role-aware fuzzy search across:
 *   - Quick Actions  — operational shortcuts (approve leave, file correction, etc.)
 *   - Employees      — live employee name + code search (admin only)
 *   - Navigate       — all 48+ navigation targets
 *   - Recent         — last 8 operations from sessionStorage
 *
 * Usage:
 *   // Mount once in AppShell
 *   <CommandPaletteProvider>
 *     <AppShell />
 *   </CommandPaletteProvider>
 *
 *   // Open programmatically
 *   const { open } = useCommandPalette()
 *   <Button onClick={open}>⌘K</Button>
 */
import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Clock, Users, CalendarDays, ClipboardEdit, GitBranch,
  AlarmClock, LayoutGrid, ShieldCheck, FileSearch, AlertTriangle,
  BarChart2, Settings, Zap, Target, X, CheckCircle2, PlusCircle,
  UserCheck, CreditCard, RefreshCw, Database, Activity, BookOpen,
  ArrowRight, History, Map as MapIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useBasePath }  from '@/lib/routing'
import { cn }           from '@/lib/utils'

// ── Context ───────────────────────────────────────────────────────────────────

interface CommandPaletteContext {
  isOpen: boolean
  open:   () => void
  close:  () => void
  toggle: () => void
}

const Ctx = createContext<CommandPaletteContext>({
  isOpen: false,
  open:   () => {},
  close:  () => {},
  toggle: () => {},
})

export function useCommandPalette() {
  return useContext(Ctx)
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CommandItem = {
  id:        string
  label:     string
  sublabel?: string
  icon:      React.ComponentType<{ className?: string }>
  href?:     string
  action?:   () => void
  tags?:     string[]
  /** Controls which roles see this command */
  role?:     'admin' | 'manager' | 'employee' | 'all'
  group:     string
  /** Displayed badge beside the label */
  badge?:    string
}

// ── Group ordering — determines display priority ───────────────────────────

const GROUP_ORDER = ['Quick Actions', 'Recent', 'Employees', 'Navigate', 'ESS']

function sortGroups(groups: Array<{ group: string; items: CommandItem[] }>) {
  return groups.sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.group)
    const bi = GROUP_ORDER.indexOf(b.group)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

// ── Static navigation commands ─────────────────────────────────────────────────

function useStaticCommands(basePath: string): CommandItem[] {
  return [
    // ── Admin navigation
    { id: 'nav-dashboard',     label: 'Dashboard',              icon: LayoutGrid,    href: `${basePath}/dashboard`,              group: 'Navigate', role: 'admin', tags: ['home', 'overview'] },
    { id: 'nav-people',        label: 'People Directory',       icon: Users,         href: `${basePath}/employees`,              group: 'Navigate', role: 'admin', tags: ['employees', 'staff', 'hr'] },
    { id: 'nav-new-employee',  label: 'Add New Employee',       icon: PlusCircle,    href: `${basePath}/employees/new`,          group: 'Navigate', role: 'admin', tags: ['create', 'onboard', 'hire'] },
    { id: 'nav-attendance',    label: 'Attendance Overview',    icon: Clock,         href: `${basePath}/attendance`,             group: 'Navigate', role: 'admin', tags: ['attendance', 'processing'] },
    { id: 'nav-muster',        label: 'Muster Roll',            icon: BarChart2,     href: `${basePath}/attendance/muster`,      group: 'Navigate', role: 'admin', tags: ['muster', 'roll', 'monthly'] },
    { id: 'nav-roster',        label: 'Roster Planner',         icon: AlarmClock,    href: `${basePath}/roster`,                 group: 'Navigate', role: 'admin', tags: ['roster', 'shifts', 'schedule'] },
    { id: 'nav-corrections',   label: 'Attendance Corrections', icon: ClipboardEdit, href: `${basePath}/attendance/corrections`, group: 'Navigate', role: 'admin', tags: ['correction', 'fix', 'override'] },
    { id: 'nav-anomalies',     label: 'Attendance Anomalies',   icon: AlertTriangle, href: `${basePath}/attendance/anomalies`,   group: 'Navigate', role: 'admin', tags: ['anomaly', 'flag', 'issue', 'missing'] },
    { id: 'nav-audit',         label: 'Attendance Audit Log',   icon: FileSearch,    href: `${basePath}/attendance/audit`,       group: 'Navigate', role: 'admin', tags: ['audit', 'log', 'history', 'trail'] },
    { id: 'nav-forensics',     label: 'Attendance Forensics',   icon: Target,        href: `${basePath}/attendance/forensics`,   group: 'Navigate', role: 'admin', tags: ['forensics', 'investigate', 'deep', 'trace'] },
    { id: 'nav-intelligence',  label: 'Attendance Intelligence',icon: Activity,      href: `${basePath}/attendance/intelligence`,group: 'Navigate', role: 'admin', tags: ['intelligence', 'insights', 'patterns'] },
    { id: 'nav-period-locks',  label: 'Period Locks',           icon: ShieldCheck,   href: `${basePath}/attendance/period-locks`,group: 'Navigate', role: 'admin', tags: ['lock', 'period', 'freeze', 'close'] },
    { id: 'nav-overtime',      label: 'Overtime Management',    icon: Clock,         href: `${basePath}/overtime`,               group: 'Navigate', role: 'admin', tags: ['overtime', 'ot', 'extra hours'] },
    { id: 'nav-compoff',       label: 'Comp-Off Management',    icon: RefreshCw,     href: `${basePath}/comp-off`,               group: 'Navigate', role: 'admin', tags: ['comp-off', 'compensatory', 'day off'] },
    { id: 'nav-leave-requests',label: 'Leave Requests',         icon: CheckCircle2,  href: `${basePath}/leave-requests`,         group: 'Navigate', role: 'admin', tags: ['leave', 'approve', 'pending', 'requests'] },
    { id: 'nav-policy',        label: 'Leave Policy Engine',    icon: ShieldCheck,   href: `${basePath}/leave/policy-engine`,    group: 'Navigate', role: 'admin', tags: ['policy', 'engine', 'rules', 'simulation'] },
    { id: 'nav-leave-policy',  label: 'Leave Policies',         icon: GitBranch,     href: `${basePath}/leave-policy`,           group: 'Navigate', role: 'admin', tags: ['policy', 'leave', 'configure'] },
    { id: 'nav-leave-types',   label: 'Leave Types',            icon: CalendarDays,  href: `${basePath}/leave-types`,            group: 'Navigate', role: 'admin', tags: ['leave types', 'CL', 'SL', 'EL', 'config'] },
    { id: 'nav-leave-accrual', label: 'Leave Accrual',          icon: Database,      href: `${basePath}/leave/accrual`,          group: 'Navigate', role: 'admin', tags: ['accrual', 'balance', 'credit'] },
    { id: 'nav-holidays',      label: 'Holiday Calendar',       icon: CalendarDays,  href: `${basePath}/holidays`,               group: 'Navigate', role: 'admin', tags: ['holiday', 'calendar', 'national', 'optional'] },
    { id: 'nav-payroll',       label: 'Payroll Runs',           icon: CreditCard,    href: `${basePath}/payroll`,                group: 'Navigate', role: 'admin', tags: ['payroll', 'salary', 'run', 'slip'] },
    { id: 'nav-letters',       label: 'Letter Generation',      icon: BookOpen,      href: `${basePath}/letters`,                group: 'Navigate', role: 'admin', tags: ['letter', 'appointment', 'offer', 'generate'] },
    { id: 'nav-manager',       label: 'Manager Dashboard',      icon: LayoutGrid,    href: `${basePath}/manager-dashboard`,      group: 'Navigate', role: 'admin', tags: ['manager', 'team', 'dashboard'] },
    { id: 'nav-health',        label: 'Operational Health',     icon: Zap,           href: `${basePath}/operational-health`,     group: 'Navigate', role: 'admin', tags: ['health', 'system', 'operational', 'status'] },
    { id: 'nav-settings',      label: 'Settings',               icon: Settings,      href: `${basePath}/settings`,               group: 'Navigate', role: 'admin', tags: ['settings', 'config', 'preferences'] },
    { id: 'nav-leave-reports', label: 'Leave Reports',          icon: BarChart2,     href: `${basePath}/reports/leave`,          group: 'Navigate', role: 'admin', tags: ['reports', 'analytics', 'leave', 'summary'] },
    { id: 'nav-history',       label: 'Approval History',       icon: History,       href: `${basePath}/approval-history`,       group: 'Navigate', role: 'admin', tags: ['approval', 'history', 'workflow'] },
    { id: 'nav-reg-approval',  label: 'Regularisation Approval',icon: UserCheck,     href: `${basePath}/attendance/regularisation`, group: 'Navigate', role: 'admin', tags: ['regularisation', 'correction', 'approval'] },

    // ── ESS (all roles)
    { id: 'ess-att',           label: 'My Attendance',          icon: Clock,         href: '/ess/attendance',                    group: 'ESS', role: 'all', tags: ['my attendance', 'calendar', 'personal'] },
    { id: 'ess-leave',         label: 'My Leave Requests',      icon: CalendarDays,  href: '/ess/leave',                         group: 'ESS', role: 'all', tags: ['my leave', 'requests', 'applied'] },
    { id: 'ess-apply-leave',   label: 'Apply for Leave',        icon: PlusCircle,    href: '/ess/leave/apply',                   group: 'ESS', role: 'all', tags: ['apply leave', 'request leave', 'book leave'] },
    { id: 'ess-schedule',      label: 'My Schedule',            icon: AlarmClock,    href: '/ess/schedule',                      group: 'ESS', role: 'all', tags: ['my schedule', 'shift', 'roster'] },
    { id: 'ess-letters',       label: 'My Letters',             icon: BookOpen,      href: '/ess/letters',                       group: 'ESS', role: 'all', tags: ['my letters', 'documents', 'appointment'] },
    { id: 'ess-profile',       label: 'My Profile',             icon: Users,         href: '/ess/profile',                       group: 'ESS', role: 'all', tags: ['my profile', 'personal info'] },
    { id: 'ess-comp-off',      label: 'Apply Comp-Off',         icon: RefreshCw,     href: '/ess/comp-off',                      group: 'ESS', role: 'all', tags: ['comp-off', 'compensatory off'] },
  ]
}

// ── Quick Actions ─────────────────────────────────────────────────────────────
// Role-sensitive operational shortcuts — shown first when query matches.

function useQuickActions(basePath: string, role: string): CommandItem[] {
  const isAdmin   = ['super_admin', 'hr_admin'].includes(role)
  const isManager = role === 'manager'

  const adminActions: CommandItem[] = [
    {
      id: 'qa-process-att', label: 'Process Attendance',
      sublabel: 'Trigger batch attendance processing',
      icon: RefreshCw, href: `${basePath}/attendance`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['process', 'run', 'attendance', 'compute', 'batch'],
    },
    {
      id: 'qa-anomalies', label: 'Review Anomalies',
      sublabel: 'Open flagged attendance anomalies',
      icon: AlertTriangle, href: `${basePath}/attendance/anomalies`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['anomalies', 'flags', 'missing punch', 'resolve'],
    },
    {
      id: 'qa-approve-leave', label: 'Approve Leave Requests',
      sublabel: 'Pending leave queue for review',
      icon: CheckCircle2, href: `${basePath}/leave-requests`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['approve', 'leave', 'pending', 'requests'],
    },
    {
      id: 'qa-forensics', label: 'Investigate Attendance',
      sublabel: 'Deep-dive forensics for a specific day',
      icon: Target, href: `${basePath}/attendance/forensics`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['investigate', 'forensics', 'trace', 'debug'],
    },
    {
      id: 'qa-period-lock', label: 'Lock Attendance Period',
      sublabel: 'Freeze a month for payroll cutoff',
      icon: ShieldCheck, href: `${basePath}/attendance/period-locks`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['lock', 'period', 'freeze', 'payroll cutoff'],
    },
    {
      id: 'qa-payroll-blockers', label: 'Check Payroll Blockers',
      sublabel: 'View attendance issues blocking payroll',
      icon: AlertTriangle, href: `${basePath}/payroll`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['payroll', 'blockers', 'issues', 'pending'],
    },
    {
      id: 'qa-add-employee', label: 'Add New Employee',
      sublabel: 'Start onboarding a new hire',
      icon: PlusCircle, href: `${basePath}/employees/new`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['add employee', 'new hire', 'onboard', 'create'],
    },
    {
      id: 'qa-bulk-roster', label: 'Bulk Assign Shifts',
      sublabel: 'Open roster planner for bulk assignment',
      icon: MapIcon, href: `${basePath}/roster`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['bulk', 'assign', 'shift', 'roster'],
    },
    {
      id: 'qa-run-letter', label: 'Generate a Letter',
      sublabel: 'Create appointment, confirmation, or offer letter',
      icon: BookOpen, href: `${basePath}/letters`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['letter', 'generate', 'appointment', 'offer'],
    },
    {
      id: 'qa-reg-approval', label: 'Approve Corrections',
      sublabel: 'Review pending regularisation requests',
      icon: UserCheck, href: `${basePath}/attendance/regularisation`,
      group: 'Quick Actions', role: 'admin', badge: 'Admin',
      tags: ['regularisation', 'correction', 'approval', 'review'],
    },
  ]

  const managerActions: CommandItem[] = [
    {
      id: 'qa-mgr-leave', label: 'Review Team Leave',
      sublabel: 'Approve or reject leave for your team',
      icon: CheckCircle2, href: `${basePath}/leave-requests`,
      group: 'Quick Actions', role: 'manager', badge: 'Manager',
      tags: ['team leave', 'approve', 'pending'],
    },
    {
      id: 'qa-mgr-team', label: 'Team Attendance',
      sublabel: 'Check your team\'s attendance status',
      icon: Users, href: `${basePath}/manager-dashboard`,
      group: 'Quick Actions', role: 'manager', badge: 'Manager',
      tags: ['team', 'attendance', 'manager', 'dashboard'],
    },
  ]

  const essActions: CommandItem[] = [
    {
      id: 'qa-apply-leave', label: 'Apply for Leave',
      sublabel: 'Submit a new leave request',
      icon: CalendarDays, href: '/ess/leave/apply',
      group: 'Quick Actions', role: 'employee', badge: 'ESS',
      tags: ['apply', 'leave', 'request', 'book'],
    },
    {
      id: 'qa-comp-off', label: 'Request Comp-Off',
      sublabel: 'Claim compensatory off for overtime',
      icon: RefreshCw, href: '/ess/comp-off',
      group: 'Quick Actions', role: 'employee', badge: 'ESS',
      tags: ['comp off', 'compensatory', 'overtime'],
    },
  ]

  if (isAdmin)   return [...adminActions, ...essActions]
  if (isManager) return [...managerActions, ...essActions]
  return essActions
}

// ── Employee search ────────────────────────────────────────────────────────────

interface EmployeeOption {
  id:            string
  full_name:     string
  employee_code: string
}

function useEmployeeSearch(query: string, basePath: string, isAdmin: boolean): CommandItem[] {
  const { data } = useQuery<{ data: EmployeeOption[] }>({
    queryKey:  ['command-palette-employees'],
    queryFn:   () => api.get('/employees?limit=300&status=active'),
    enabled:   isAdmin,
    staleTime: 120_000,
  })

  if (!isAdmin || !query || query.length < 2) return []

  const lower = query.toLowerCase()
  return ((data?.data ?? []) as EmployeeOption[])
    .filter(e =>
      e.full_name?.toLowerCase().includes(lower) ||
      e.employee_code?.toLowerCase().includes(lower),
    )
    .slice(0, 6)
    .map(e => ({
      id:       `emp-${e.id}`,
      label:    e.full_name,
      sublabel: `Employee · ${e.employee_code}`,
      icon:     Users,
      href:     `${basePath}/employees/${e.id}`,
      group:    'Employees',
      role:     'admin' as const,
    }))
}

// ── Recent actions ─────────────────────────────────────────────────────────────

const RECENT_KEY = 'cmd_palette_recent_v2'
const MAX_RECENT  = 8

interface StoredRecent {
  id:       string
  label:    string
  sublabel?: string
  href?:    string
  group:    string
  iconName: string
  badge?:   string
}

// Icon name → component lookup (to survive JSON serialization)
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutGrid, Users, Clock, CalendarDays, ClipboardEdit, GitBranch,
  AlarmClock, ShieldCheck, FileSearch, AlertTriangle, BarChart2, Settings,
  Zap, Target, CheckCircle2, PlusCircle, UserCheck, CreditCard, RefreshCw,
  Database, Activity, BookOpen, ArrowRight, History, MapIcon,
}

function iconToName(icon: React.ComponentType<any>): string {
  return Object.entries(ICON_MAP).find(([, v]) => v === icon)?.[0] ?? 'ArrowRight'
}

function loadRecent(): CommandItem[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const stored: StoredRecent[] = JSON.parse(raw)
    return stored.map(s => ({
      ...s,
      icon:  ICON_MAP[s.iconName] ?? ArrowRight,
      group: 'Recent',
    }))
  } catch { return [] }
}

function saveRecent(item: CommandItem) {
  try {
    const stored: StoredRecent = {
      id:       item.id,
      label:    item.label,
      sublabel: item.sublabel,
      href:     item.href,
      group:    item.group,
      iconName: iconToName(item.icon),
      badge:    item.badge,
    }
    const existing = (() => {
      try {
        const raw = sessionStorage.getItem(RECENT_KEY)
        return raw ? (JSON.parse(raw) as StoredRecent[]) : []
      } catch { return [] }
    })().filter(r => r.id !== item.id)
    sessionStorage.setItem(RECENT_KEY, JSON.stringify([stored, ...existing].slice(0, MAX_RECENT)))
  } catch {}
}

// ── Fuzzy filter ──────────────────────────────────────────────────────────────

function fuzzyMatch(item: CommandItem, query: string): boolean {
  if (!query) return true
  const lower    = query.toLowerCase()
  const haystack = [item.label, item.sublabel ?? '', ...(item.tags ?? [])].join(' ').toLowerCase()
  // Substring match OR all chars present
  return haystack.includes(lower) || lower.split('').every(ch => haystack.includes(ch))
}

// ── Group utilities ────────────────────────────────────────────────────────────

function groupItems(items: CommandItem[]): Array<{ group: string; items: CommandItem[] }> {
  const map = new Map<string, CommandItem[]>()
  for (const item of items) {
    const arr = map.get(item.group) ?? []
    arr.push(item)
    map.set(item.group, arr)
  }
  return sortGroups([...map.entries()].map(([group, items]) => ({ group, items })))
}

// ── Palette dialog ─────────────────────────────────────────────────────────────

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const { profile }  = useAuthStore()
  const navigate     = useNavigate()
  const basePath     = useBasePath()
  const role         = profile?.role ?? 'employee'
  const isAdmin      = ['super_admin', 'hr_admin'].includes(role)
  const isAdminOrMgr = ['super_admin', 'hr_admin', 'manager'].includes(role)

  const [query,     setQuery]     = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const staticCommands  = useStaticCommands(basePath)
  const quickActions    = useQuickActions(basePath, role)
  const employeeResults = useEmployeeSearch(query, basePath, isAdmin)
  const recent          = loadRecent()

  // Determine which static/quick commands are role-visible
  function isVisible(cmd: CommandItem): boolean {
    if (!cmd.role || cmd.role === 'all') return true
    if (cmd.role === 'admin')    return isAdmin
    if (cmd.role === 'manager')  return isAdminOrMgr
    if (cmd.role === 'employee') return true
    return false
  }

  const filteredStatic = staticCommands.filter(cmd => isVisible(cmd) && fuzzyMatch(cmd, query))
  const filteredQuick  = quickActions.filter(cmd => isVisible(cmd) && (query ? fuzzyMatch(cmd, query) : true))

  // Build result list
  const allItems: CommandItem[] = query
    ? [
        ...filteredQuick.slice(0, 4),    // Quick Actions first when searching
        ...employeeResults,
        ...filteredStatic,
      ]
    : [
        // No query: show recent + top quick actions + few navigation targets
        ...recent.slice(0, 5),
        ...filteredQuick.slice(0, 5),
        ...filteredStatic.slice(0, 8),
      ]

  // Deduplicate by id
  const seen = new Set<string>()
  const deduped = allItems.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  const grouped   = groupItems(deduped)
  const flatItems = grouped.flatMap(g => g.items)

  useEffect(() => { setActiveIdx(0) }, [query])
  useEffect(() => { inputRef.current?.focus() }, [])

  function execute(item: CommandItem) {
    saveRecent(item)
    onClose()
    if (item.href)   navigate(item.href)
    if (item.action) item.action()
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flatItems.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { if (flatItems[activeIdx]) execute(flatItems[activeIdx]) }
    if (e.key === 'Escape')    { onClose() }
  }

  let globalIdx = 0

  return (
    <div className="flex flex-col max-h-[72vh]" onKeyDown={handleKey}>
      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search employees, actions, pages…"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-muted-foreground/60 hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground">
          esc
        </kbd>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto py-2">
        {flatItems.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-2 text-center">
            <Search className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No results for "{query}"</p>
            <p className="text-xs text-muted-foreground/60">Try employee name, action, or page name</p>
          </div>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group}>
              <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                {group}
              </p>
              {items.map(item => {
                const myIdx    = globalIdx++
                const isActive = myIdx === activeIdx
                return (
                  <button
                    key={item.id}
                    onClick={() => execute(item)}
                    onMouseEnter={() => setActiveIdx(myIdx)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <item.icon className={cn(
                      'h-4 w-4 flex-shrink-0',
                      isActive ? 'text-primary' : 'text-muted-foreground/60',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm leading-none truncate">{item.label}</p>
                        {item.badge && (
                          <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-primary/10 text-primary uppercase tracking-wide leading-none flex-shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.sublabel && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {item.sublabel}
                        </p>
                      )}
                    </div>
                    {group === 'Recent' && (
                      <Clock className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                    )}
                    {isActive && (
                      <ArrowRight className="h-3 w-3 text-primary/60 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">esc</kbd> close</span>
        </div>
        <span className="text-[10px] text-muted-foreground/40">
          {flatItems.length} result{flatItems.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

// ── Provider + public components ──────────────────────────────────────────────

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open   = useCallback(() => setIsOpen(true),      [])
  const close  = useCallback(() => setIsOpen(false),     [])
  const toggle = useCallback(() => setIsOpen(v => !v),   [])

  // Global keyboard shortcut: ⌘K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggle])

  return (
    <Ctx.Provider value={{ isOpen, open, close, toggle }}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="p-0 gap-0 max-w-xl overflow-hidden">
          <DialogTitle className="sr-only">Command Palette</DialogTitle>
          <PaletteDialog onClose={close} />
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}

/**
 * Trigger button — small "⌘K" pill for the top bar.
 */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  const { open } = useCommandPalette()
  return (
    <button
      onClick={open}
      className={cn(
        'hidden sm:flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 h-8 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
        className,
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search…</span>
      <kbd className="ml-1 flex items-center gap-0.5 text-[10px] opacity-60">
        <span>⌘</span><span>K</span>
      </kbd>
    </button>
  )
}
