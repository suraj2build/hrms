import { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, GitBranch, FileText, Settings,
  User, ChevronLeft, ChevronRight, Building2, BarChart3,
  Clock, Target, CalendarDays, CalendarRange, ClipboardCheck, CalendarClock,
  AlarmClock, UserCog, BookOpen, BarChart2, FileSearch, Inbox, PlusCircle, ListChecks, AlertTriangle,
  Settings2, Database, Upload, ClipboardEdit, PlayCircle, LayoutGrid,
  ShieldCheck, CalendarPlus, BadgeCheck, TrendingUp, Brain, GitMerge, CalendarCheck,
  DollarSign, Zap, Mail, ShieldAlert, Activity, FlaskConical, TrendingDown,
  Workflow, Globe, Server, Webhook, Layers, Flame, LineChart, Siren, KeyRound,
  FolderUp, UserPlus, ChevronDown, Scale, CreditCard,
  Receipt, PieChart, Banknote,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useBasePath } from '@/lib/routing'
import { Button } from '@/components/ui/button'

interface NavItem {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  permission?: string
  phase?: number
  exact?: boolean
}

interface NavSection {
  id: string
  label?: string
  collapsible?: boolean
  emphasis?: boolean
  quiet?: boolean
  separator?: boolean
  items: NavItem[]
}

function PhaseBadge({ phase }: { phase: number }) {
  return (
    <span className="text-[9px] font-medium bg-muted/50 text-muted-foreground/40 px-1.5 py-[2px] rounded-sm tracking-widest uppercase select-none">
      P{phase}
    </span>
  )
}

const COMING_SOON: NavItem[] = [
  { label: 'Performance', icon: Target,    href: '/performance', phase: 4 },
  { label: 'Analytics',   icon: BarChart3, href: '/analytics',   phase: 5 },
]

// Compute which collapsible section to auto-open based on current path.
// Called once on mount — uses window.location.pathname directly for initializer safety.
function computeInitialSections(): Set<string> {
  const p = window.location.pathname
  const set = new Set<string>()

  // Workforce
  if (p.includes('/onboarding') || p.includes('/import') ||
      p.includes('/analytics/workforce') || p.endsWith('/intelligence')) {
    set.add('workforce')
  }

  // Intelligence (more specific, check before attendance ops)
  if (p.includes('/attendance/forensics') || p.includes('/attendance/confidence') ||
      p.includes('/attendance/risk') || p.includes('/attendance/health-index') ||
      p.includes('/attendance/policy-conflicts') || p.includes('/attendance/simulate-policy') ||
      p.includes('/analytics/executive') || p.includes('/workforce/optimization') ||
      p.includes('/operational-health')) {
    set.add('intel')
  }

  // Attendance / Ops (general /attendance — exclude intel sub-paths already handled above)
  if ((p.includes('/attendance') &&
       !p.includes('/attendance/forensics') && !p.includes('/attendance/confidence') &&
       !p.includes('/attendance/risk') && !p.includes('/attendance/health-index') &&
       !p.includes('/attendance/policy-conflicts') && !p.includes('/attendance/simulate-policy') &&
       !p.includes('/attendance/upload')) ||
      p.includes('/overtime') || p.includes('/approvals/inbox')) {
    set.add('ops')
  }
  // Attendance center — ensure ops section opens
  if (p.includes('/attendance/center')) {
    set.add('ops')
  }

  // Roster
  if (p.includes('/shift-master') || p.includes('/employee-shifts') ||
      p.includes('/roster')) {
    set.add('roster')
  }

  // Leave
  if ((p.includes('/leave') && !p.includes('/ess')) || p.includes('/holidays') ||
      p.includes('/comp-off') || p.includes('/leave-types') ||
      p.includes('/leave-policy') || p.includes('/leave-jobs')) {
    set.add('leave')
  }

  // Payroll
  if (p.includes('/payroll') || p.includes('/payroll-readiness')) {
    set.add('payroll')
  }

  // System
  if (p.includes('/system/') || p.includes('/notifications/') ||
      p.includes('/approvals/governance')) {
    set.add('system')
  }

  // Setup & Config
  if (p.includes('/masters') || p.includes('/letters') ||
      p.includes('/attendance/upload') || p.includes('/settings') ||
      p.includes('/approvals/workflows')) {
    set.add('config')
  }

  return set
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { hasPermission } = useAuthStore()
  const basePath = useBasePath()
  const location = useLocation()

  // Collapsible section state — auto-opens section matching current route
  const [openSections, setOpenSections] = useState<Set<string>>(computeInitialSections)

  // Determine which section is "active" based on current route (most specific first)
  const activeSectionId = useMemo(() => {
    const p = location.pathname

    // Intelligence — check specific sub-paths first (before general /attendance catch)
    if (p.startsWith(`${basePath}/attendance/forensics`) ||
        p.startsWith(`${basePath}/attendance/confidence`) ||
        p.startsWith(`${basePath}/attendance/risk`) ||
        p.startsWith(`${basePath}/attendance/health-index`) ||
        p.startsWith(`${basePath}/attendance/policy-conflicts`) ||
        p.startsWith(`${basePath}/attendance/simulate-policy`) ||
        p.startsWith(`${basePath}/analytics/executive`) ||
        p.startsWith(`${basePath}/workforce/optimization`) ||
        p.startsWith(`${basePath}/operational-health`)) {
      return 'intel'
    }

    // Config — check /attendance/upload before general /attendance (ops)
    if (p.startsWith(`${basePath}/masters`) ||
        p.startsWith(`${basePath}/letters`) ||
        p === `${basePath}/attendance/upload` ||
        p.startsWith(`${basePath}/settings`) ||
        p.startsWith(`${basePath}/approvals/workflows`)) {
      return 'config'
    }

    // Workforce
    if (p.startsWith(`${basePath}/onboarding`) ||
        p.startsWith(`${basePath}/import`) ||
        p.startsWith(`${basePath}/analytics/workforce`) ||
        p === `${basePath}/intelligence`) {
      return 'workforce'
    }

    // Attendance (ops) — /attendance/center is ops (not intel), so include it explicitly
    if (p.startsWith(`${basePath}/attendance`) ||
        p.startsWith(`${basePath}/overtime`) ||
        p === `${basePath}/approvals/inbox`) {
      return 'ops'
    }

    // Roster
    if (p.startsWith(`${basePath}/shift-master`) ||
        p.startsWith(`${basePath}/employee-shifts`) ||
        p.startsWith(`${basePath}/roster`)) {
      return 'roster'
    }

    // Leave
    if (p.startsWith(`${basePath}/holidays`) ||
        p.startsWith(`${basePath}/leave`) ||
        p.startsWith(`${basePath}/comp-off`) ||
        p.startsWith(`${basePath}/leave-types`) ||
        p.startsWith(`${basePath}/leave-policy`) ||
        p.startsWith(`${basePath}/leave-jobs`)) {
      return 'leave'
    }

    // Payroll
    if (p.startsWith(`${basePath}/payroll`) ||
        p.startsWith(`${basePath}/payroll-readiness`)) {
      return 'payroll'
    }

    // System
    if (p.startsWith(`${basePath}/system`) ||
        p.startsWith(`${basePath}/notifications`) ||
        p.startsWith(`${basePath}/approvals/governance`)) {
      return 'system'
    }

    return null
  }, [location.pathname, basePath])

  // Auto-expand the section that contains the active route when navigating
  useEffect(() => {
    if (activeSectionId) {
      setOpenSections(prev => new Set([...prev, activeSectionId]))
    }
  }, [activeSectionId])

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const NAV_SECTIONS: NavSection[] = [
    // ── Global (no label, always visible) ────────────────────────────────────
    {
      id: 'global',
      items: [
        { label: 'Dashboard',    icon: LayoutDashboard, href: `${basePath}/dashboard`,   exact: true },
        { label: 'People',       icon: Users,           href: `${basePath}/employees`,    permission: 'employees:read' },
        { label: 'Organization', icon: GitBranch,       href: `${basePath}/organization`, permission: 'departments:read' },
        { label: 'Documents',    icon: FileText,        href: `${basePath}/documents`,    permission: 'documents:read' },
        { label: 'Reports',      icon: BarChart3,       href: `${basePath}/reports`,      permission: 'employees:read' },
      ],
    },

    // ── Workforce ─────────────────────────────────────────────────────────────
    {
      id:          'workforce',
      label:       'Workforce',
      collapsible: true,
      items: [
        { label: 'Onboarding',   icon: UserPlus,   href: `${basePath}/onboarding`,          permission: 'employees:write' },
        { label: 'Master Import',icon: FolderUp,   href: `${basePath}/import`,              permission: 'employees:write' },
        { label: 'Analytics',    icon: TrendingUp, href: `${basePath}/analytics/workforce`, permission: 'employees:read' },
        { label: 'Intelligence', icon: Brain,      href: `${basePath}/intelligence`,         permission: 'employees:read' },
      ],
    },

    // ── Attendance ────────────────────────────────────────────────────────────
    {
      id:          'ops',
      label:       'Attendance',
      collapsible: true,
      items: [
        { label: 'Att. Center',   icon: Zap,            href: `${basePath}/attendance/center`,           permission: 'employees:read' },
        { label: 'Processing',    icon: Clock,          href: `${basePath}/attendance`,                  permission: 'employees:read', exact: true },
        { label: 'Muster Roll',   icon: BarChart2,      href: `${basePath}/attendance/muster`,           permission: 'employees:read' },
        { label: 'Corrections',   icon: ClipboardEdit,  href: `${basePath}/attendance/corrections`,      permission: 'employees:write' },
        { label: 'Regularisation',icon: ClipboardCheck, href: `${basePath}/attendance/regularisation`,   permission: 'employees:write' },
        { label: 'Exceptions',    icon: ShieldAlert,    href: `${basePath}/attendance/exceptions`,       permission: 'employees:write' },
        { label: 'Anomalies',     icon: AlertTriangle,  href: `${basePath}/attendance/anomalies`,        permission: 'employees:read' },
        { label: 'Approval Inbox',icon: Inbox,          href: `${basePath}/approvals/inbox`,             permission: 'employees:read' },
        { label: 'Att. Policy',   icon: ShieldCheck,    href: `${basePath}/attendance/policy`,           permission: 'employees:write' },
        { label: 'Audit Log',     icon: FileSearch,     href: `${basePath}/attendance/audit`,            permission: 'employees:read' },
        { label: 'Overtime',      icon: Clock,          href: `${basePath}/overtime`,                    permission: 'employees:write' },
      ],
    },

    // ── Intelligence ─────────────────────────────────────────────────────────
    {
      id:          'intel',
      label:       'Intelligence',
      collapsible: true,
      quiet:       true,
      items: [
        { label: 'Forensics',       icon: Target,        href: `${basePath}/attendance/forensics`,         permission: 'employees:read' },
        { label: 'Op. Health',      icon: Zap,           href: `${basePath}/operational-health`,           permission: 'employees:read' },
        { label: 'Confidence',      icon: Activity,      href: `${basePath}/attendance/confidence`,        permission: 'employees:read' },
        { label: 'Risk Profiles',   icon: TrendingDown,  href: `${basePath}/attendance/risk`,              permission: 'employees:read' },
        { label: 'Health Index',    icon: BarChart3,     href: `${basePath}/attendance/health-index`,      permission: 'employees:read' },
        { label: 'Policy Conflicts',icon: AlertTriangle, href: `${basePath}/attendance/policy-conflicts`,  permission: 'employees:read' },
        { label: 'Simulate Policy', icon: FlaskConical,  href: `${basePath}/attendance/simulate-policy`,   permission: 'employees:write' },
        { label: 'Optimization',    icon: Layers,        href: `${basePath}/workforce/optimization`,       permission: 'employees:write' },
        { label: 'Executive Intel', icon: LineChart,     href: `${basePath}/analytics/executive`,          permission: 'employees:read' },
      ],
    },

    // ── Shift & Roster ────────────────────────────────────────────────────────
    {
      id:          'roster',
      label:       'Shift & Roster',
      collapsible: true,
      emphasis:    true,
      items: [
        { label: 'Shift Definitions', icon: AlarmClock,    href: `${basePath}/shift-master`,         permission: 'employees:write' },
        { label: 'Shift Overrides',    icon: UserCog,       href: `${basePath}/employee-shifts`,      permission: 'employees:write' },
        { label: 'Roster Planner',    icon: CalendarClock, href: `${basePath}/roster`,               permission: 'employees:write' },
        { label: 'Roster Intel',      icon: BarChart3,     href: `${basePath}/roster/intelligence`,  permission: 'employees:read' },
        { label: 'Manager View',      icon: LayoutGrid,    href: '/manager/dashboard',               permission: 'employees:read' },
      ],
    },

    // ── Leave ─────────────────────────────────────────────────────────────────
    {
      id:          'leave',
      label:       'Leave',
      collapsible: true,
      items: [
        { label: 'Holidays',     icon: CalendarRange, href: `${basePath}/holidays`,                  permission: 'employees:read' },
        { label: 'Leave Types',  icon: BookOpen,      href: `${basePath}/leave-types`,               permission: 'employees:write' },
        { label: 'Leave Policy', icon: Settings2,     href: `${basePath}/leave-policy`,              permission: 'employees:write' },
        { label: 'Leave Ledger', icon: ListChecks,    href: `${basePath}/leave/ledger`,              permission: 'employees:read' },
        { label: 'Accrual Rules',icon: TrendingUp,    href: `${basePath}/leave/accrual`,             permission: 'employees:write' },
        { label: 'Comp-Off',     icon: CalendarPlus,  href: `${basePath}/comp-off`,                  permission: 'employees:write' },
        { label: 'Optional Pool',icon: CalendarCheck, href: `${basePath}/leave/optional-holidays`,   permission: 'employees:write' },
        { label: 'Collision Log',icon: GitMerge,      href: `${basePath}/leave/collision-log`,       permission: 'employees:read' },
        { label: 'Policy Engine',icon: GitBranch,     href: `${basePath}/leave/policy-engine`,       permission: 'employees:write' },
        { label: 'Leave Jobs',   icon: PlayCircle,    href: `${basePath}/leave-jobs`,                permission: 'employees:write' },
      ],
    },

    // ── Payroll ───────────────────────────────────────────────────────────────
    {
      id:          'payroll',
      label:       'Payroll',
      collapsible: true,
      items: [
        { label: 'Payroll Center',   icon: Zap,            href: `${basePath}/payroll/center`,                  permission: 'employees:write' },
        { label: 'Payroll Runs',     icon: DollarSign,     href: `${basePath}/payroll`,                         permission: 'employees:write', exact: true },
        { label: 'Readiness',        icon: BadgeCheck,     href: `${basePath}/payroll-readiness`,               permission: 'employees:write' },
        { label: 'Validation',       icon: ClipboardCheck, href: `${basePath}/payroll/validation`,              permission: 'employees:write' },
        { label: 'Reconciliation',   icon: Scale,          href: `${basePath}/payroll/reconciliation`,          permission: 'employees:write' },
        { label: 'Governance',       icon: ShieldCheck,    href: `${basePath}/payroll/governance`,              permission: 'employees:write' },
        { label: 'Advances',         icon: CreditCard,     href: `${basePath}/payroll/advances`,                permission: 'employees:write' },
        { label: 'Loans',            icon: Banknote,       href: `${basePath}/payroll/loans`,                   permission: 'employees:write' },
        { label: 'Reimbursements',   icon: Receipt,        href: `${basePath}/payroll/reimbursements`,          permission: 'employees:write' },
        { label: 'Variable Pay',     icon: TrendingUp,     href: `${basePath}/payroll/variable-pay`,            permission: 'employees:write' },
        { label: 'Arrears',          icon: GitMerge,       href: `${basePath}/payroll/arrears`,                 permission: 'employees:write' },
        { label: 'Ledger',           icon: BookOpen,       href: `${basePath}/payroll/ledger`,                  permission: 'employees:write' },
        { label: 'Cost Intel',       icon: LineChart,      href: `${basePath}/payroll/cost-intelligence`,       permission: 'employees:read' },
        { label: 'Investigations',   icon: FileSearch,     href: `${basePath}/payroll/investigate`,             permission: 'employees:write' },
        { label: 'Forecast',         icon: BarChart3,      href: `${basePath}/payroll/forecast`,                permission: 'employees:write' },
        { label: 'Simulation',       icon: FlaskConical,   href: `${basePath}/payroll/simulation`,              permission: 'employees:write' },
        { label: 'Comp. Structures', icon: Layers,         href: `${basePath}/payroll/compensation`,            permission: 'employees:write' },
        { label: 'Comp. Revisions',  icon: BadgeCheck,     href: `${basePath}/payroll/compensation-revisions`,  permission: 'employees:write' },
        { label: 'Salary Comps.',    icon: PieChart,       href: `${basePath}/payroll/salary-components`,       permission: 'employees:write' },
        { label: 'Statutory',        icon: Building2,      href: `${basePath}/payroll/statutory-dashboard`,     permission: 'employees:write' },
      ],
    },

    // ── System ────────────────────────────────────────────────────────────────
    {
      id:          'system',
      label:       'System',
      collapsible: true,
      quiet:       true,
      items: [
        { label: 'Inbox',        icon: Inbox,      href: `${basePath}/notifications/inbox`,           permission: 'employees:read' },
        { label: 'Incidents',    icon: Siren,      href: `${basePath}/system/incidents`,              permission: 'employees:write' },
        { label: 'Orchestration',icon: Server,     href: `${basePath}/system/orchestration`,          permission: 'employees:write' },
        { label: 'Automations',  icon: PlayCircle, href: `${basePath}/system/automations`,            permission: 'employees:write' },
        { label: 'Observability',icon: Flame,      href: `${basePath}/system/observability`,          permission: 'employees:write' },
        { label: 'Event Gov.',   icon: Globe,      href: `${basePath}/system/event-governance`,       permission: 'employees:write' },
        { label: 'Webhooks',     icon: Webhook,    href: `${basePath}/system/webhooks`,               permission: 'employees:write' },
        { label: 'Integrations', icon: KeyRound,   href: `${basePath}/system/integrations`,           permission: 'employees:write' },
        { label: 'Governance',   icon: Workflow,   href: `${basePath}/approvals/governance-matrix`,   permission: 'employees:write' },
      ],
    },

    // ── Setup & Config ────────────────────────────────────────────────────────
    {
      id:          'config',
      label:       'Setup & Config',
      collapsible: true,
      quiet:       true,
      separator:   true,
      items: [
        { label: 'Masters',       icon: Database,     href: `${basePath}/masters`,                   permission: 'employees:write' },
        { label: 'Sites',         icon: Building2,    href: `${basePath}/masters/sites`,             permission: 'employees:read' },
        { label: 'Roster Templ.', icon: CalendarDays, href: `${basePath}/masters/rosters`,           permission: 'employees:read' },
        { label: 'Upload',        icon: Upload,       href: `${basePath}/attendance/upload`,         permission: 'employees:write' },
        { label: 'Letter Templ.', icon: Mail,         href: `${basePath}/letters`,                   permission: 'employees:write' },
        { label: 'Notif. Templ.', icon: Mail,         href: `${basePath}/notifications/templates`,   permission: 'employees:write' },
        { label: 'Workflows',     icon: Workflow,     href: `${basePath}/approvals/workflows`,       permission: 'employees:write' },
      ],
    },
  ]

  function isActive(item: NavItem) {
    if (item.exact) return location.pathname === item.href || location.pathname === item.href + '/'
    return location.pathname.startsWith(item.href)
  }

  function renderNavItem(item: NavItem) {
    if (item.permission && !hasPermission(item.permission)) return null
    const active = isActive(item)
    return (
      <Link
        key={item.href}
        to={item.href}
        title={sidebarCollapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md text-sm transition-colors py-1.5',
          !sidebarCollapsed && 'border-l-[2px] pl-2 pr-2',
          sidebarCollapsed  && 'justify-center px-1.5',
          active && !sidebarCollapsed && 'bg-primary/[0.1] text-foreground font-medium border-primary/70',
          active && sidebarCollapsed  && 'bg-primary/[0.1] text-foreground font-medium',
          !active && !sidebarCollapsed && 'text-muted-foreground/65 border-transparent hover:bg-sidebar-accent/60 hover:text-foreground',
          !active && sidebarCollapsed  && 'text-muted-foreground/65 hover:bg-sidebar-accent/60 hover:text-foreground',
        )}
      >
        <item.icon className={cn(
          'flex-shrink-0 transition-colors',
          sidebarCollapsed ? 'h-[15px] w-[15px]' : 'h-[13px] w-[13px]',
          active ? 'text-primary' : 'text-muted-foreground/45',
        )} />
        {!sidebarCollapsed && (
          <span className="text-[12px] leading-none truncate">{item.label}</span>
        )}
      </Link>
    )
  }

  function renderSection(section: NavSection) {
    const isGlobal      = section.id === 'global'
    const isCollapsible = section.collapsible && !sidebarCollapsed
    const isOpen        = !isCollapsible || openSections.has(section.id)

    // Count visible items (respecting permissions)
    const visibleItems = section.items.filter(i => !i.permission || hasPermission(i.permission))
    if (!isGlobal && visibleItems.length === 0) return null

    // Count active items inside this section (for collapsed-sidebar dot indicator)
    const hasActiveItem = visibleItems.some(isActive)

    return (
      <div key={section.id}>
        {/* Section header — only for labeled, non-global sections */}
        {section.label && !sidebarCollapsed && (
          isCollapsible ? (
            <button
              onClick={() => toggleSection(section.id)}
              className={cn(
                'flex items-center justify-between w-full px-1 mb-1 group',
                section.separator && 'mt-0',
              )}
            >
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-[0.09em] select-none leading-none transition-colors',
                section.emphasis ? 'text-foreground/60 group-hover:text-foreground/80' :
                section.quiet    ? 'text-muted-foreground/35 group-hover:text-muted-foreground/55' :
                                   'text-muted-foreground/50 group-hover:text-muted-foreground/70',
              )}>
                {section.label}
              </span>
              <ChevronDown className={cn(
                'h-2.5 w-2.5 transition-all duration-200 flex-shrink-0',
                section.emphasis ? 'text-foreground/40' :
                section.quiet    ? 'text-muted-foreground/25' :
                                   'text-muted-foreground/35',
                isOpen && 'rotate-180',
              )} />
            </button>
          ) : (
            <p className={cn(
              'text-[10px] font-semibold uppercase tracking-[0.09em] select-none leading-none px-1 mb-1',
              section.emphasis ? 'text-foreground/60' :
              section.quiet    ? 'text-muted-foreground/35' :
                                 'text-muted-foreground/50',
            )}>
              {section.label}
            </p>
          )
        )}

        {/* Items container */}
        {isOpen && (
          <div className={cn(
            'space-y-0',
            !sidebarCollapsed && section.label && !section.emphasis && !section.quiet && 'bg-muted/[0.12] rounded-md px-1 py-0.5',
            !sidebarCollapsed && section.emphasis && 'bg-primary/[0.06] rounded-md px-1 py-0.5',
            !sidebarCollapsed && section.quiet && 'bg-muted/[0.06] rounded-md px-1 py-0.5',
            isGlobal && 'pb-0.5',
          )}>
            {visibleItems.map(item => renderNavItem(item))}
          </div>
        )}

        {/* Collapsed sidebar: show a faint dot if this section has an active item */}
        {sidebarCollapsed && section.label && hasActiveItem && (
          <div className="flex justify-center my-0.5">
            <div className="h-1 w-1 rounded-full bg-primary/50" />
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex-shrink-0',
        sidebarCollapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center h-12 px-3 border-b border-sidebar-border flex-shrink-0',
        sidebarCollapsed && 'justify-center px-2',
      )}>
        {sidebarCollapsed ? (
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Building2 className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <Building2 className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-[12px] font-bold text-foreground leading-none tracking-tight">Cognix<span className="text-[#15B8A6]">HR</span></p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-none">HR Platform</p>
            </div>
          </div>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-2.5">
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.id}>
            {/* Divider before separator sections */}
            {section.separator && sIdx > 0 && (
              <div className={cn(
                'h-px bg-border/30 mb-2.5',
                sidebarCollapsed && 'mx-0.5',
              )} />
            )}
            {renderSection(section)}
          </div>
        ))}

        {/* Coming Soon */}
        <div>
          {!sidebarCollapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/22 select-none leading-none px-1 mb-1">
              Soon
            </p>
          )}
          <div className={cn(
            'space-y-0',
            !sidebarCollapsed && 'bg-muted/[0.04] rounded-md px-1 py-0.5',
          )}>
            {COMING_SOON.map(item => (
              <div
                key={item.href}
                title={sidebarCollapsed ? `${item.label} (Phase ${item.phase})` : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md text-sm opacity-30 cursor-not-allowed py-1.5',
                  !sidebarCollapsed && 'border-l-[2px] border-transparent pl-2 pr-2',
                  sidebarCollapsed  && 'justify-center px-1.5',
                )}
              >
                <item.icon className="h-[13px] w-[13px] flex-shrink-0 text-muted-foreground/45" />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 text-[12px] text-muted-foreground leading-none truncate">{item.label}</span>
                    {item.phase && <PhaseBadge phase={item.phase} />}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </nav>

      {/* Bottom: compact ESS shortcuts + Settings + collapse */}
      <div className={cn(
        'border-t border-sidebar-border flex-shrink-0 pt-1.5 pb-1',
        sidebarCollapsed ? 'px-1' : 'px-1.5',
      )}>
        {/* ESS quick-links */}
        {!sidebarCollapsed && (
          <p className="text-[9px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/30 select-none px-2 mb-1 leading-none">
            My Portal
          </p>
        )}
        {([
          { to: '/ess/attendance',       icon: CalendarDays, label: 'My Attendance', match: (p: string) => p.startsWith('/ess/attendance') },
          { to: '/ess/leave/apply',      icon: PlusCircle,   label: 'Apply Leave',   match: (p: string) => p === '/ess/leave/apply' },
          { to: '/ess/payroll/my-slips', icon: DollarSign,   label: 'My Payslips',   match: (p: string) => p.startsWith('/ess/payroll') },
          { to: '/ess/profile',          icon: User,         label: 'My Profile',    match: (p: string) => p.startsWith('/ess/profile') },
        ] as const).map(({ to, icon: Icon, label, match }) => {
          const active = match(location.pathname)
          return (
            <Link
              key={to}
              to={to}
              title={sidebarCollapsed ? label : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md py-1 text-sm transition-colors',
                !sidebarCollapsed && 'border-l-[2px] pl-2 pr-2',
                sidebarCollapsed  && 'justify-center px-1.5 py-1.5',
                active && !sidebarCollapsed && 'bg-primary/[0.1] text-foreground font-medium border-primary/70',
                active && sidebarCollapsed  && 'bg-primary/[0.1] text-foreground font-medium',
                !active && !sidebarCollapsed && 'text-muted-foreground/50 border-transparent hover:bg-sidebar-accent/60 hover:text-foreground',
                !active && sidebarCollapsed  && 'text-muted-foreground/50 hover:bg-sidebar-accent/60 hover:text-foreground',
              )}
            >
              <Icon className={cn(
                'flex-shrink-0 transition-colors',
                sidebarCollapsed ? 'h-[14px] w-[14px]' : 'h-[12px] w-[12px]',
                active ? 'text-primary' : 'text-muted-foreground/35',
              )} />
              {!sidebarCollapsed && <span className="text-[11px] leading-none">{label}</span>}
            </Link>
          )
        })}

        {/* Settings */}
        {hasPermission('settings:read') && (() => {
          const active = location.pathname.startsWith(`${basePath}/settings`)
          return (
            <Link
              to={`${basePath}/settings`}
              title={sidebarCollapsed ? 'Settings' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md py-1 text-sm transition-colors mt-0.5',
                !sidebarCollapsed && 'border-l-[2px] pl-2 pr-2',
                sidebarCollapsed  && 'justify-center px-1.5 py-1.5',
                active && !sidebarCollapsed && 'bg-primary/[0.1] text-foreground font-medium border-primary/70',
                active && sidebarCollapsed  && 'bg-primary/[0.1] text-foreground font-medium',
                !active && !sidebarCollapsed && 'text-muted-foreground/50 border-transparent hover:bg-sidebar-accent/60 hover:text-foreground',
                !active && sidebarCollapsed  && 'text-muted-foreground/50 hover:bg-sidebar-accent/60 hover:text-foreground',
              )}
            >
              <Settings className={cn(
                'flex-shrink-0 transition-colors',
                sidebarCollapsed ? 'h-[14px] w-[14px]' : 'h-[12px] w-[12px]',
                active ? 'text-primary' : 'text-muted-foreground/35',
              )} />
              {!sidebarCollapsed && <span className="text-[11px] leading-none">Settings</span>}
            </Link>
          )
        })()}

        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className={cn(
            'w-full h-6 mt-1.5 text-muted-foreground/30 hover:text-muted-foreground/60',
            sidebarCollapsed && 'justify-center',
          )}
        >
          {sidebarCollapsed
            ? <ChevronRight className="h-3 w-3" />
            : <ChevronLeft  className="h-3 w-3" />}
        </Button>
      </div>
    </aside>
  )
}
