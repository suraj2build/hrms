/**
 * EmployeeSidebar — flat, non-collapsible enterprise ESS navigation.
 * Section headings are static labels; only the whole sidebar collapses to icon-rail.
 */

import { useMemo, useEffect } from 'react'
import { Link, useLocation }  from 'react-router-dom'
import { useQuery }           from '@tanstack/react-query'
import {
  LayoutDashboard,
  Rocket,
  CalendarDays,
  CalendarOff,
  Scale,
  Receipt,
  CreditCard,
  FileText,
  Mail,
  CheckSquare,
  Inbox,
  Users,
  HelpCircle,
  LifeBuoy,
  BookMarked,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HeadphonesIcon,
  ShieldCheck,
  BarChart3,
  ArrowUpRight,
  Calculator,
  ScrollText,
  Wallet,
  LogOut,
  Package,
  Home,
  PartyPopper,
  Megaphone,
} from 'lucide-react'
import { cn }            from '@/lib/utils'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { useUIStore }    from '@/stores/uiStore'
import { useAuthStore }  from '@/stores/authStore'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useNavGroupCollapse } from '@/hooks/useNavGroupCollapse'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  icon:  React.ComponentType<{ className?: string }>
  href:  string
  exact?: boolean
  badge?: number
}

interface NavGroup {
  label:   string
  items:   NavItem[]
}

// ── Navigation config (base — badge counts injected dynamically) ──────────────

const BASE_GROUPS: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { label: 'Home',           icon: Home,            href: '/ess/home',      exact: true },
      { label: 'FlowDesk',      icon: Inbox,           href: '/ess/flowdesk'               },
      { label: 'Community',     icon: Megaphone,       href: '/ess/community'              },
      { label: 'Recognition',   icon: PartyPopper,     href: '/ess/recognition'            },
      { label: 'My Onboarding', icon: Rocket,          href: '/ess/onboarding'             }, // shown only during/after onboarding journey
      // "My Insights" (operational center) removed from employee nav — the
      // attendance-operations style command center is not relevant for ESS.
    ],
  },
  {
    label: 'Attendance & Leave',
    items: [
      { label: 'My Attendance',     icon: CalendarDays, href: '/ess/attendance',      exact: true },
      { label: 'Leave & Comp-Off',  icon: Scale,        href: '/ess/leave/balance'                   },
      { label: "Who's Off",         icon: Users,        href: '/ess/whos-off'                        },
      { label: 'Company Holidays',  icon: CalendarDays, href: '/ess/company-holidays'                 },
      { label: 'Optional Holidays', icon: CalendarOff,  href: '/ess/optional-holidays'               },
      { label: 'Work From Home',    icon: Home,         href: '/ess/wfh'                              },
      { label: 'Approvals',         icon: CheckSquare,  href: '/ess/approvals'                             }, // manager-only
    ],
  },
  {
    // Tax Planner / IT Statement / YTD / TDS Recovery / HRA / Previous Employer
    // are consolidated into the single "Tax & Declarations" hub (/ess/salary).
    label: 'Pay, Tax & Benefits',
    items: [
      { label: 'Pay & Compensation', icon: Receipt,     href: '/ess/compensation'   },
      { label: 'Tax & Declarations', icon: Calculator,  href: '/ess/salary'         },
      { label: 'Reimbursements',     icon: CreditCard,  href: '/ess/reimbursements' },
      { label: 'Loans & Advances',   icon: Wallet,      href: '/ess/loans'          },
      { label: 'Flexible Benefits',  icon: ScrollText,  href: '/ess/fbp'            },
      { label: 'Benefits',           icon: ShieldCheck, href: '/ess/benefits'       },
    ],
  },
  {
    label: 'Documents & Support',
    items: [
      { label: 'My Assets',    icon: Package,        href: '/ess/assets'      },
      { label: 'My Documents', icon: FileText,       href: '/ess/documents'   },
      { label: 'Letters',      icon: Mail,           href: '/ess/letters'     },
      { label: 'Resignation & Exit', icon: LogOut,   href: '/ess/separation'  },
      { label: 'My Team',      icon: Users,          href: '/ess/team'        }, // manager-only
      { label: 'Policies',     icon: BookMarked,     href: '/ess/policies'    },
      { label: 'How-To Guides', icon: HelpCircle,    href: '/ess/runbooks'    },
      { label: 'HR Support',   icon: HeadphonesIcon, href: '/ess/hr-support'  },
      { label: 'Helpdesk',     icon: LifeBuoy,       href: '/ess/issues'      },
    ],
  },
]

// ── Manager quick-access items (rendered only for manager+ roles) ──────────────

// Approvals now lives in Attendance & Leave group; My Team in Documents & Support.
// "Who's Off" (team leave calendar) is a manager-facing view — a plain employee
// should not see colleagues' absence patterns (relevance + DPDP privacy).
// All three stay in the ESS nav structure but are filtered out for non-managers.
const MANAGER_ONLY_HREFS = new Set(['/ess/approvals', '/ess/team', '/ess/whos-off'])

const MANAGER_QUICK_ITEMS: NavItem[] = [
  { label: 'Manager Console', icon: LayoutDashboard, href: '/manager/dashboard', exact: true },
  { label: 'Team Attendance', icon: CalendarDays,    href: '/manager/team/attendance'         },
  { label: 'Approvals',       icon: CheckSquare,     href: '/manager/approvals'               },
  { label: 'Loan Approvals',  icon: Wallet,          href: '/manager/loans-approvals'         },
  { label: 'Team Reports',    icon: BarChart3,        href: '/manager/reports/team'            },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function isActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href || pathname === item.href + '/'
  return pathname.startsWith(item.href)
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Pending badge hook ────────────────────────────────────────────────────────

/**
 * Whether to surface the "My Onboarding" nav item.
 * True only when this employee actually came through the onboarding flow
 * (onboarding-status returns a linked record) — keeps the nav clean for
 * directly-created / tenured staff who have no onboarding journey.
 */
function useHasOnboarding(employeeId: string | null): boolean {
  const { data } = useQuery({
    queryKey: ['sb-onboarding-status', employeeId],
    queryFn:  () => api.get<{ data: unknown | null }>(`/employees/${employeeId}/onboarding-status`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime: 5 * 60_000,
  })
  return data != null
}

function usePendingCount(employeeId: string | null) {
  const { data: leaveData }   = useQuery<{ data: Array<{ status: string }> }>({
    queryKey: ['sb-leave', employeeId],
    queryFn:  () => api.get('/attendance/leave/my'),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })
  const { data: corrData }    = useQuery<{ data: Array<{ status: string }> }>({
    queryKey: ['sb-corr', employeeId],
    queryFn:  () => api.get('/attendance/corrections/my?limit=50'),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })
  const { data: reimbData }   = useQuery<Array<{ status: string }>>({
    queryKey: ['sb-reimb', employeeId],
    queryFn:  () => api.get<{ data: Array<{ status: string }> }>('/payroll/reimbursements/my').then((r) => r.data),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })
  const { data: compOffData } = useQuery<{ data: Array<{ status: string }> }>({
    queryKey: ['sb-compoff', employeeId],
    queryFn:  () => api.get('/attendance/comp-off'),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  return useMemo(() => {
    const pending = (arr: Array<{ status: string }>, test: (s: string) => boolean) =>
      arr.filter(r => test(r.status)).length
    return (
      pending(leaveData?.data   ?? [], s => s === 'pending') +
      pending(corrData?.data    ?? [], s => s === 'pending' || s === 'processing') +
      pending(reimbData         ?? [], s => s === 'draft' || s === 'submitted' || s === 'under_review') +
      pending(compOffData?.data ?? [], s => s === 'pending')
    )
  }, [leaveData, corrData, reimbData, compOffData])
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EmployeeSidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen, activeRole } = useUIStore()
  const { profile }  = useAuthStore()
  const employeeId   = profile?.employee_id ?? null
  const location     = useLocation()
  const pendingCount = usePendingCount(employeeId)
  const hasOnboarding = useHasOnboarding(employeeId)

  // Close the mobile drawer on navigation
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname, setMobileNavOpen])

  // Manager-only nav items — hidden for pure employee role.
  // Also hidden when an admin/manager is *previewing* the Employee Self Service
  // workspace (activeRole === 'employee'): the preview should reflect the true
  // employee experience, not the previewer's elevated permissions.
  const hasManagerRole = profile?.role === 'manager' || profile?.role === 'hr_admin' || profile?.role === 'super_admin'
  const isManager = hasManagerRole && activeRole !== 'employee'

  // Filter manager-only items; inject live badge into Approvals
  const GROUPS = useMemo((): NavGroup[] =>
    BASE_GROUPS
      .map(g => ({
        ...g,
        items: g.items
          .filter(item => !MANAGER_ONLY_HREFS.has(item.href) || isManager)
          // Onboarding nav only for employees with an onboarding journey
          .filter(item => item.href !== '/ess/onboarding' || hasOnboarding)
          .map(item =>
            item.href === '/ess/approvals'
              ? { ...item, badge: pendingCount > 0 ? pendingCount : undefined }
              : item
          ),
      }))
      // Drop groups that become empty after filtering
      .filter(g => g.items.length > 0),
    [pendingCount, isManager, hasOnboarding]
  )

  // Collapsible groups — collapsed by default; the group holding the active
  // route stays open, and manual toggles persist for the session.
  const activeGroup = useMemo(
    () => GROUPS.find(g => g.items.some(i => isActive(i, location.pathname)))?.label,
    [GROUPS, location.pathname],
  )
  const { expanded, toggle } = useNavGroupCollapse('ess', activeGroup)
  // Purely driven by the expanded set so every group (incl. the active one) can
  // be collapsed. Groups start collapsed; activeGroup seeds the initial open set.
  const isGroupOpen = (label: string) => expanded.has(label)

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
            <p className="text-[10px] text-sidebar-foreground/65 mt-1">Employee Portal</p>
          </div>
        )}
      </div>

      {/* ── Nav groups ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>

            {/* Group label — click to expand/collapse */}
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => toggle(group.label)}
                className={cn(
                  'flex items-center justify-between w-full gap-2 px-3 py-2 rounded-md border transition-colors select-none',
                  'text-xs font-bold uppercase tracking-wide text-primary',
                  isGroupOpen(group.label)
                    ? 'bg-primary/[0.12] border-primary/25 hover:bg-primary/15'
                    : 'bg-primary/[0.06] border-primary/15 hover:bg-primary/[0.12]',
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={cn('h-3.5 w-1 rounded-full shrink-0', isGroupOpen(group.label) ? 'bg-primary' : 'bg-primary/50')} />
                  <span className="truncate">{group.label}</span>
                </span>
                {isGroupOpen(group.label)
                  ? <ChevronDown className="h-4 w-4 shrink-0 text-primary" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-primary/70" />}
              </button>
            )}

            {/* Items — hidden when collapsed (always shown in icon-rail mode) */}
            {(sidebarCollapsed || isGroupOpen(group.label)) && (
            <div className={cn('space-y-0.5', !sidebarCollapsed && 'mt-1.5')}>
            {group.items.map(item => {
              const active = isActive(item, location.pathname)
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    sidebarCollapsed && 'justify-center px-0 w-10 mx-auto',
                  )}
                >
                  <item.icon
                    className={cn(
                      'flex-shrink-0',
                      sidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4',
                      active ? 'opacity-100' : 'opacity-70',
                    )}
                  />
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 truncate">{item.label}</span>
                      {!!item.badge && item.badge > 0 && (
                        <span className="text-[10px] bg-primary-foreground/20 rounded-full px-1.5 py-0.5 font-semibold tabular-nums leading-none">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )
            })}
            </div>
            )}

          </div>
        ))}

        {/* ── Manager section — only for manager/hr_admin/super_admin ──── */}
        {isManager && (
          <div className="mt-3">
            {/* Divider */}
            <div className={cn(
              'border-t border-sidebar-border mb-2',
              sidebarCollapsed ? 'mx-1' : 'mx-1',
            )} />

            {!sidebarCollapsed && (
              <div className="flex items-center gap-1.5 px-2.5 pb-1">
                <ShieldCheck className="h-3 w-3 text-warning/80" />
                <p className="text-[9px] font-bold uppercase tracking-widest text-warning/80 select-none">
                  Manager
                </p>
              </div>
            )}

            {MANAGER_QUICK_ITEMS.map(item => {
              const active = isActive(item, location.pathname)
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                    active
                      ? 'bg-warning text-white font-medium'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    sidebarCollapsed && 'justify-center px-0 w-10 mx-auto',
                  )}
                >
                  <item.icon
                    className={cn(
                      'flex-shrink-0',
                      sidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4',
                      active ? 'opacity-100' : 'opacity-70',
                    )}
                  />
                  {!sidebarCollapsed && (
                    <span className="flex-1 truncate">{item.label}</span>
                  )}
                  {!sidebarCollapsed && item.href === '/manager/dashboard' && !active && (
                    <ArrowUpRight className="h-3 w-3 opacity-40 flex-shrink-0" />
                  )}
                </Link>
              )
            })}
          </div>
        )}

      </nav>

      {/* ── Need Help? ───────────────────────────────────────────────────── */}
      {!sidebarCollapsed && (
        <div className="mx-3 mb-3 p-3 rounded-xl bg-primary/10 border border-primary/15">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <HelpCircle className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-sidebar-foreground">Need Help?</p>
              <p className="text-[10px] text-sidebar-foreground/65">Contact HR Support</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Collapse toggle (desktop only) ─────────────────────────────────── */}
      <div className={cn('p-2 border-t border-sidebar-border flex-shrink-0 hidden lg:block', sidebarCollapsed && 'lg:flex lg:justify-center')}>
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
            : <><ChevronLeft className="h-4 w-4" /><span>Collapse</span></>
          }
        </Button>
      </div>
    </aside>
   </>
  )
}
