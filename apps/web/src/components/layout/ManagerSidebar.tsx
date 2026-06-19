/**
 * ManagerSidebar — Manager Console navigation sidebar.
 *
 * Two top-level sections:
 *   ─── EMPLOYEE (Self-Service) ────────────────────────────────────────────────
 *   Dashboard, My Attendance, Leave & Comp-Off, Pay & Comp, Tax Declarations,
 *   Reimbursements, My Documents, Policies, HR Support
 *   All links → /ess/*  (Employee Shell)
 *
 *   ─── MANAGER (Team Operations) ─────────────────────────────────────────────
 *   Team Dashboard, Team Attendance, Team Calendar, Team Roster, Approvals*,
 *   Leave Balances, Performance, Team Reports
 *   All links → /manager/*  (Manager Shell)
 *
 * * Approvals badge: live count from /approvals/pending
 *
 * Active color scheme:
 *   Employee section → primary (blue)  — signals "I'm viewing myself as an employee"
 *   Manager section  → amber           — signals "I'm managing my team"
 */

import { useMemo, useEffect } from 'react'
import { Link, useLocation }  from 'react-router-dom'
import { useQuery }           from '@tanstack/react-query'
import {
  LayoutDashboard,
  CalendarDays,
  Scale,
  Receipt,
  FileCheck,
  CreditCard,
  FileText,
  BookMarked,
  HeadphonesIcon,
  CheckSquare,
  TrendingUp,
  HelpCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  UserCircle2,
  ShieldCheck,
  Radio,
  Calculator,
  ScrollText,
  Wallet,
  IndianRupee,
  UserCog,
  Package,
  LifeBuoy,
  Coins,
} from 'lucide-react'
import { cn }         from '@/lib/utils'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { useUIStore } from '@/stores/uiStore'
import { api }        from '@/lib/api/client'
import { Button }     from '@/components/ui/button'
import { useNavGroupCollapse } from '@/hooks/useNavGroupCollapse'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label:  string
  icon:   React.ComponentType<{ className?: string }>
  href:   string
  exact?: boolean
  badge?: number
}

interface NavGroup {
  label: string
  items: NavItem[]
}

interface NavSection {
  /** Section identity — 'employee' uses primary color; 'manager' uses amber */
  type:    'employee' | 'manager'
  label:   string
  items?:  NavItem[]   // flat list (manager section)
  groups?: NavGroup[]  // grouped list (employee section)
}

// ── Static nav config ─────────────────────────────────────────────────────────

const BASE_SECTIONS: NavSection[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // EMPLOYEE — self-service items (link to /ess/*)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type:  'employee',
    label: 'Employee',
    // All /manager/self/* routes render ESS components inside the ManagerShell
    // so the sidebar and color scheme stay consistent.
    groups: [
      {
        label: 'Main',
        items: [
          { label: 'My Dashboard', icon: LayoutDashboard, href: '/manager/self/dashboard', exact: true },
        ],
      },
      {
        label: 'Attendance & Leave',
        items: [
          { label: 'My Attendance',    icon: CalendarDays, href: '/manager/self/attendance',   exact: true },
          { label: 'Leave & Comp-Off', icon: Scale,        href: '/manager/self/leave/balance'             },
          { label: 'Company Holidays', icon: CalendarDays, href: '/manager/self/company-holidays'          },
        ],
      },
      {
        label: 'Payroll & Tax',
        items: [
          { label: 'Pay & Comp',    icon: Receipt,    href: '/manager/self/compensation'               },
          { label: 'Tax Planner',   icon: Calculator, href: '/manager/self/salary/tax-planner'         },
          { label: 'IT Statement',  icon: ScrollText, href: '/manager/self/salary/it-statement'        },
          { label: 'YTD Statement', icon: TrendingUp, href: '/manager/self/salary/ytd'                 },
          { label: 'TDS Recovery',  icon: Receipt,    href: '/manager/self/salary/tds-recovery'        },
        ],
      },
      {
        label: 'Declarations & Claims',
        items: [
          { label: 'HRA Declaration',   icon: FileCheck,  href: '/manager/self/salary/hra'                      },
          { label: 'Previous Employer', icon: FileText,   href: '/manager/self/salary/previous-employer'        },
          { label: 'Reimbursements',    icon: CreditCard, href: '/manager/self/reimbursements'                  },
          { label: 'Loans & Advances',  icon: Wallet,     href: '/manager/self/loans'                           },
        ],
      },
      {
        label: 'Documents & Support',
        items: [
          { label: 'My Documents', icon: FileText,       href: '/manager/self/documents'   },
          { label: 'Policies',     icon: BookMarked,     href: '/manager/self/policies'    },
          { label: 'How-To Guides', icon: HelpCircle,    href: '/manager/self/runbooks'    },
          { label: 'HR Support',   icon: HeadphonesIcon, href: '/manager/self/hr-support'  },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MANAGER — team operations (link to /manager/*)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type:  'manager',
    label: 'Manager',
    groups: [
      {
        label: 'Team Overview',
        items: [
          { label: 'Team Dashboard',  icon: LayoutDashboard, href: '/manager/dashboard',      exact: true },
          { label: 'Who Is In',       icon: Radio,           href: '/manager/team/who-is-in'              },
          { label: 'Team Attendance', icon: CalendarDays,    href: '/manager/team/attendance'             },
          // Single Approvals entry — Leave, Regularisation, Overtime, Comp-Off and
          // Loans are now sub-tabs inside the Approval Inbox (routes still exist
          // for deep-links).
          { label: 'Approvals',       icon: CheckSquare,     href: '/manager/approvals'                   },
        ],
      },
      {
        label: 'Team Management',
        items: [
          { label: 'Team Lifecycle', icon: UserCog,  href: '/manager/team/lifecycle'      },
          { label: 'Leave Balances', icon: Scale,    href: '/manager/team/leave-balances' },
          { label: 'Team Assets',    icon: Package,  href: '/manager/team/assets'         },
          { label: 'Team Helpdesk',  icon: LifeBuoy, href: '/manager/team/helpdesk'       },
        ],
      },
      {
        label: 'Cost & Insights',
        items: [
          { label: 'Team Compensation', icon: IndianRupee, href: '/manager/team/compensation' },
          { label: 'Payroll Cost',      icon: Coins,       href: '/manager/team/payroll-cost' },
          { label: 'Performance',       icon: TrendingUp,  href: '/manager/team/performance'  },
        ],
      },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function isActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href || pathname === item.href + '/'
  return pathname.startsWith(item.href)
}

// ── Pending approvals count ───────────────────────────────────────────────────

function usePendingApprovalsCount() {
  const { data } = useQuery<{ data: unknown[] }>({
    queryKey: ['manager-pending-approvals-count'],
    queryFn:  () => api.get('/approvals/pending?limit=100'),
    staleTime: 60_000,
  })
  return (data?.data ?? []).length
}

// ── Item renderer (shared by flat + grouped layouts) ─────────────────────────

function renderNavItem(
  item: NavItem,
  sectionType: 'employee' | 'manager',
  pathname: string,
  collapsed: boolean,
) {
  const active = isActive(item, pathname)
  const isEmp  = sectionType === 'employee'
  return (
    <Link
      key={item.href}
      to={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
        active
          ? isEmp
            ? 'bg-primary text-primary-foreground font-medium'
            : 'bg-amber-500 text-white font-medium'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        collapsed && 'justify-center px-0 w-10 mx-auto',
      )}
    >
      <item.icon
        className={cn(
          'flex-shrink-0',
          collapsed ? 'h-5 w-5' : 'h-4 w-4',
          active ? 'opacity-100' : 'opacity-70',
        )}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {!!item.badge && item.badge > 0 && (
            <span className={cn(
              'text-[10px] rounded-full px-1.5 py-0.5 font-semibold tabular-nums leading-none',
              active ? 'bg-white/25 text-white' : 'bg-red-500 text-white',
            )}>
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  )
}

// ── ManagerSidebar ────────────────────────────────────────────────────────────

export function ManagerSidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const location     = useLocation()
  const pendingCount = usePendingApprovalsCount()

  useEffect(() => { setMobileNavOpen(false) }, [location.pathname, setMobileNavOpen])

  // Inject the live pending-approvals badge onto the Approvals item, wherever it
  // lives (flat items or grouped items).
  const SECTIONS = useMemo((): NavSection[] => {
    const withBadge = (item: NavItem): NavItem =>
      item.href === '/manager/approvals'
        ? { ...item, badge: pendingCount > 0 ? pendingCount : undefined }
        : item
    return BASE_SECTIONS.map(s => ({
      ...s,
      ...(s.items  && { items:  s.items.map(withBadge) }),
      ...(s.groups && { groups: s.groups.map(g => ({ ...g, items: g.items.map(withBadge) })) }),
    }))
  }, [pendingCount])

  // Collapsible nav — sections & groups collapsed by default; whichever holds the
  // active route is seeded open, and manual toggles persist for the session.
  const activeGroup = useMemo(() => {
    for (const s of SECTIONS) {
      const g = s.groups?.find(g => g.items.some(i => isActive(i, location.pathname)))
      if (g) return g.label
    }
    return undefined
  }, [SECTIONS, location.pathname])
  const activeSection = useMemo(() => {
    for (const s of SECTIONS) {
      const hit = s.groups?.some(g => g.items.some(i => isActive(i, location.pathname)))
        || s.items?.some(i => isActive(i, location.pathname))
      if (hit) return s.label
    }
    return undefined
  }, [SECTIONS, location.pathname])
  const { expanded, toggle } = useNavGroupCollapse('manager', [activeSection, activeGroup])
  // Purely driven by the expanded set so every group/section (incl. the active
  // one) can be collapsed. Groups start collapsed.
  const isOpen = (label: string, _activeLabel?: string) => expanded.has(label)

  return (
   <>
    {mobileNavOpen && (
      <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden />
    )}
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border flex-shrink-0',
        'fixed inset-y-0 left-0 z-50 w-[240px] transition-transform duration-300 lg:static lg:z-auto lg:transition-all',
        mobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0',
        sidebarCollapsed ? 'lg:w-[68px]' : 'lg:w-[220px]',
      )}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex items-center h-14 border-b border-sidebar-border flex-shrink-0',
          sidebarCollapsed ? 'justify-center px-0' : 'px-4 gap-2.5',
        )}
      >
        <LogoMark size={32} className="flex-shrink-0" />
        {!sidebarCollapsed && (
          <div className="leading-tight">
            <Wordmark height={15} />
            <p className="text-[10px] text-sidebar-foreground/65 mt-1">Manager Console</p>
          </div>
        )}
      </div>

      {/* ── Nav sections ─────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {SECTIONS.map((section, si) => (
          <div key={section.label} className={si > 0 ? 'mt-1' : ''}>

            {/* Section divider + label */}
            {si > 0 && (
              <div className={cn(
                'mt-3 mb-2',
                sidebarCollapsed ? 'mx-auto w-8 border-t border-sidebar-border' : 'mx-1 border-t border-sidebar-border',
              )} />
            )}

            {/* Section header — prominent band that toggles the whole section */}
            {!sidebarCollapsed && (() => {
              const mgr   = section.type === 'manager'
              const sOpen = isOpen(section.label)
              return (
                <button
                  type="button"
                  onClick={() => toggle(section.label)}
                  className={cn(
                    'flex items-center justify-between w-full gap-2 px-3 py-2 rounded-md border transition-colors select-none',
                    'text-[13px] font-bold uppercase tracking-wide',
                    mgr ? 'text-warning' : 'text-primary',
                    sOpen
                      ? (mgr ? 'bg-warning/15 border-warning/30 hover:bg-warning/20' : 'bg-primary/15 border-primary/25 hover:bg-primary/20')
                      : (mgr ? 'bg-warning/[0.08] border-warning/20 hover:bg-warning/15' : 'bg-primary/[0.08] border-primary/20 hover:bg-primary/15'),
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {mgr ? <ShieldCheck className="h-4 w-4 shrink-0" /> : <UserCircle2 className="h-4 w-4 shrink-0" />}
                    <span className="truncate">{section.label}</span>
                  </span>
                  {sOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                </button>
              )
            })()}

            {/* Sub-groups — nested under the section, shown when it is open */}
            {(sidebarCollapsed || isOpen(section.label)) && (
              <div className={cn(!sidebarCollapsed && 'mt-1.5 ml-2 space-y-1')}>
                {(section.groups ?? [{ label: '', items: section.items ?? [] }]).map((group, gi) => {
                  const mgr   = section.type === 'manager'
                  const gOpen = isOpen(group.label)
                  return (
                    <div key={group.label || 'flat'} className={gi > 0 ? 'mt-1' : ''}>
                      {!sidebarCollapsed && group.label && (
                        <button
                          type="button"
                          onClick={() => toggle(group.label)}
                          className={cn(
                            'flex items-center justify-between w-full gap-2 px-2.5 py-1.5 rounded-md border transition-colors select-none',
                            'text-[11px] font-bold uppercase tracking-wide',
                            mgr ? 'text-warning' : 'text-primary',
                            gOpen
                              ? (mgr ? 'bg-warning/15 border-warning/30 hover:bg-warning/20' : 'bg-primary/[0.12] border-primary/25 hover:bg-primary/15')
                              : (mgr ? 'bg-warning/[0.08] border-warning/20 hover:bg-warning/15' : 'bg-primary/[0.06] border-primary/15 hover:bg-primary/[0.12]'),
                          )}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={cn('h-3 w-1 rounded-full shrink-0', gOpen ? (mgr ? 'bg-warning' : 'bg-primary') : (mgr ? 'bg-warning/50' : 'bg-primary/50'))} />
                            <span className="truncate">{group.label}</span>
                          </span>
                          {gOpen
                            ? <ChevronDown className={cn('h-3.5 w-3.5 shrink-0', mgr ? 'text-warning' : 'text-primary')} />
                            : <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', mgr ? 'text-warning/70' : 'text-primary/70')} />}
                        </button>
                      )}
                      {(sidebarCollapsed || !group.label || gOpen) && (
                        <div className={cn('space-y-0.5', !sidebarCollapsed && group.label && 'mt-1')}>
                          {group.items.map(item => renderNavItem(item, section.type, location.pathname, sidebarCollapsed))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        ))}
      </nav>

      {/* ── Help card ────────────────────────────────────────────────────── */}
      {!sidebarCollapsed && (
        <div className="mx-3 mb-3 p-3 rounded-xl bg-warning/10 border border-warning/20">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-warning/15 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="h-3.5 w-3.5 text-warning" />
            </div>
            <div>
              <p className="text-xs font-semibold text-sidebar-foreground">Need Help?</p>
              <p className="text-[10px] text-sidebar-foreground/65">Contact HR Support</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Collapse toggle (desktop only) ─────────────────────────────────── */}
      <div className={cn(
        'p-2 border-t border-sidebar-border flex-shrink-0 hidden lg:block',
        sidebarCollapsed && 'lg:flex lg:justify-center',
      )}>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className={cn(
            'text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent',
            sidebarCollapsed ? 'h-8 w-8 p-0' : 'w-full h-8 justify-start gap-2 px-2.5 text-xs',
          )}
        >
          {sidebarCollapsed
            ? <ChevronRight className="h-4 w-4" />
            : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )
          }
        </Button>
      </div>
    </aside>
   </>
  )
}
