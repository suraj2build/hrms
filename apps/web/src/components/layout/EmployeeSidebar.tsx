/**
 * EmployeeSidebar — ESS 2.0 Experience Cloud rail.
 *
 * Layout (matches ESS_EXPERIENCE_CLOUD.md §2):
 *   PILLARS (always visible, prominent): Home · Community · FlowDesk · Team · Rewards
 *   ── Services ──────────────────────────────────────────────────────────────
 *   Work (collapsible)  · Pay (collapsible)  · Documents (collapsible)  · Me (collapsible)
 *   ── Manager (role-gated) ─────────────────────────────────────────────────
 *   Console shortcut + team management links
 */

import { useMemo, useEffect } from 'react'
import { Link, useLocation }  from 'react-router-dom'
import { useQuery }           from '@tanstack/react-query'
import {
  Home, Users, Inbox, Trophy, Megaphone, Bell, Sparkles,
  CalendarDays, CalendarOff, Scale, Clock,
  Receipt, Calculator, CreditCard, Wallet, ScrollText, ShieldCheck,
  FileText, Mail, Package, BookMarked, HelpCircle, HeadphonesIcon,
  UserCircle, Rocket, LogOut,
  LayoutDashboard, CheckSquare, BarChart3, ArrowUpRight,
  ChevronDown, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { cn }            from '@/lib/utils'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { useUIStore }    from '@/stores/uiStore'
import { useAuthStore }  from '@/stores/authStore'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useNavGroupCollapse } from '@/hooks/useNavGroupCollapse'
import { SidebarSearchButton } from '@/components/search/SidebarSearchButton'
import { useCommandPalette } from '@/components/operational/CommandPalette'

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

// ── Pillar rail (top section — always expanded, no collapsible header) ─────────

const PILLARS: NavItem[] = [
  { label: 'Home',        icon: Home,      href: '/ess/home',        exact: true },
  { label: 'My Attention',icon: Bell,      href: '/ess/attention'                },
  { label: 'My Growth',   icon: Rocket,    href: '/ess/identity'                 },
  { label: 'Assistant',   icon: Sparkles,  href: '/ess/assistant'                },
  { label: 'Community',   icon: Megaphone, href: '/ess/company'                  },
  { label: 'FlowDesk',    icon: Inbox,     href: '/ess/flowdesk'                 },
  { label: 'Team',        icon: Users,     href: '/ess/team'                     },
  { label: 'Rewards',     icon: Trophy,    href: '/ess/recognition'              },
]

// Manager-only pillar items — hidden for pure employee
const MANAGER_ONLY_PILLAR_HREFS = new Set(['/ess/team'])

// ── Services groups (collapsible, below divider) ───────────────────────────────

const SERVICE_GROUPS: NavGroup[] = [
  {
    label: 'Work',
    items: [
      { label: 'My Attendance',     icon: CalendarDays, href: '/ess/attendance',        exact: true },
      { label: 'Leave & Comp-Off',  icon: Scale,        href: '/ess/leave/balance'                  },
      { label: 'Who\'s Off',        icon: Users,        href: '/ess/whos-off'                       },
      { label: 'Company Holidays',  icon: CalendarDays, href: '/ess/company-holidays'               },
      { label: 'Optional Holidays', icon: CalendarOff,  href: '/ess/optional-holidays'              },
      { label: 'Work From Home',    icon: Home,         href: '/ess/wfh'                            },
      { label: 'Approvals',         icon: CheckSquare,  href: '/ess/approvals'                      }, // manager-only
    ],
  },
  {
    label: 'Pay',
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
    label: 'Documents',
    items: [
      { label: 'My Documents', icon: FileText,       href: '/ess/documents' },
      { label: 'Letters',      icon: Mail,           href: '/ess/letters'   },
      { label: 'My Assets',    icon: Package,        href: '/ess/assets'    },
      { label: 'Policies',     icon: BookMarked,     href: '/ess/policies'  },
      { label: 'How-To Guides',icon: HelpCircle,     href: '/ess/runbooks'  },
    ],
  },
  {
    label: 'Me',
    items: [
      { label: 'My Profile',        icon: UserCircle,     href: '/ess/profile'     },
      { label: 'My Onboarding',     icon: Rocket,         href: '/ess/onboarding'  }, // shown only when applicable
      { label: 'Resignation & Exit',icon: LogOut,         href: '/ess/separation'  },
      { label: 'HR Support',        icon: HeadphonesIcon, href: '/ess/hr-support'  },
      { label: 'Helpdesk',          icon: Clock,          href: '/ess/issues'      },
    ],
  },
]

const MANAGER_ONLY_SERVICE_HREFS = new Set(['/ess/approvals', '/ess/whos-off'])

// ── Manager quick-access items ─────────────────────────────────────────────────

const MANAGER_QUICK_ITEMS: NavItem[] = [
  { label: 'Manager Console', icon: LayoutDashboard, href: '/manager/dashboard',       exact: true },
  { label: 'Team Attendance', icon: CalendarDays,    href: '/manager/team/attendance'              },
  { label: 'Approvals',       icon: CheckSquare,     href: '/manager/approvals'                    },
  { label: 'Team Reports',    icon: BarChart3,        href: '/manager/reports/team'                },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function isActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href || pathname === item.href + '/'
  return pathname.startsWith(item.href)
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

function useHasOnboarding(employeeId: string | null): boolean {
  const { data } = useQuery({
    queryKey:  ['sb-onboarding-status', employeeId],
    queryFn:   () => api.get<{ data: unknown | null }>(`/employees/${employeeId}/onboarding-status`).then(r => r.data),
    enabled:   !!employeeId,
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
    queryFn:  () => api.get<{ data: Array<{ status: string }> }>('/payroll/reimbursements/my').then(r => r.data),
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
  const { profile }     = useAuthStore()
  const employeeId      = profile?.employee_id ?? null
  const location        = useLocation()
  const pendingCount    = usePendingCount(employeeId)
  const hasOnboarding   = useHasOnboarding(employeeId)
  const { open: openSearch } = useCommandPalette()

  useEffect(() => { setMobileNavOpen(false) }, [location.pathname, setMobileNavOpen])

  const hasManagerRole = profile?.role === 'manager' || profile?.role === 'hr_admin' || profile?.role === 'super_admin'
  const isManager      = hasManagerRole && activeRole !== 'employee'

  // Visible pillars (filter team for non-managers)
  const visiblePillars = useMemo(
    () => PILLARS.filter(p => !MANAGER_ONLY_PILLAR_HREFS.has(p.href) || isManager),
    [isManager],
  )

  // Service groups with filtering + live badge injection
  const GROUPS = useMemo((): NavGroup[] =>
    SERVICE_GROUPS
      .map(g => ({
        ...g,
        items: g.items
          .filter(item => !MANAGER_ONLY_SERVICE_HREFS.has(item.href) || isManager)
          .filter(item => item.href !== '/ess/onboarding' || hasOnboarding)
          .map(item =>
            item.href === '/ess/approvals'
              ? { ...item, badge: pendingCount > 0 ? pendingCount : undefined }
              : item
          ),
      }))
      .filter(g => g.items.length > 0),
    [pendingCount, isManager, hasOnboarding],
  )

  // Service group collapse — active group open by default
  const activeServiceGroup = useMemo(
    () => GROUPS.find(g => g.items.some(i => isActive(i, location.pathname)))?.label,
    [GROUPS, location.pathname],
  )
  const { expanded, toggle } = useNavGroupCollapse('ess-svc', activeServiceGroup)
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
        {/* ── Logo ─────────────────────────────────────────────────── */}
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

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">

          {/* ── Pillars (always visible, no collapse header) ────────── */}
          <div className="space-y-0.5">
            {visiblePillars.map(item => {
              const active = isActive(item, location.pathname)
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    sidebarCollapsed && 'justify-center px-0 w-10 mx-auto',
                  )}
                >
                  <item.icon className={cn('flex-shrink-0', sidebarCollapsed ? 'h-5 w-5' : 'h-[18px] w-[18px]')} />
                  {!sidebarCollapsed && <span className="flex-1 truncate">{item.label}</span>}
                </Link>
              )
            })}
          </div>

          {/* ── Services divider ─────────────────────────────────────── */}
          <div className="pt-3 pb-1">
            {sidebarCollapsed
              ? <div className="border-t border-sidebar-border mx-1" />
              : (
                <div className="flex items-center gap-2 px-2.5">
                  <div className="flex-1 border-t border-sidebar-border" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/40 select-none">Services</span>
                  <div className="flex-1 border-t border-sidebar-border" />
                </div>
              )
            }
          </div>

          {/* ── Service groups (collapsible) ─────────────────────────── */}
          {GROUPS.map(group => (
            <div key={group.label}>
              {!sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => toggle(group.label)}
                  className={cn(
                    'flex items-center justify-between w-full gap-2 px-3 py-1.5 rounded-md transition-colors select-none',
                    'text-xs font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50',
                  )}
                >
                  <span className="truncate">{group.label}</span>
                  {isGroupOpen(group.label)
                    ? <ChevronDown className="h-3 w-3 shrink-0" />
                    : <ChevronRight className="h-3 w-3 shrink-0" />}
                </button>
              )}

              {(sidebarCollapsed || isGroupOpen(group.label)) && (
                <div className={cn('space-y-0.5', !sidebarCollapsed && 'mt-0.5 ml-1')}>
                  {group.items.map(item => {
                    const active = isActive(item, location.pathname)
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors',
                          active
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                          sidebarCollapsed && 'justify-center px-0 w-10 mx-auto',
                        )}
                      >
                        <item.icon
                          className={cn(
                            'flex-shrink-0',
                            sidebarCollapsed ? 'h-5 w-5' : 'h-3.5 w-3.5',
                            active ? 'opacity-100' : 'opacity-60',
                          )}
                        />
                        {!sidebarCollapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {!!item.badge && item.badge > 0 && (
                              <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-bold tabular-nums leading-none">
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

          {/* ── Manager section ─────────────────────────────────────── */}
          {isManager && (
            <div className="pt-3">
              <div className={cn('border-t border-sidebar-border mb-2', sidebarCollapsed ? 'mx-1' : 'mx-1')} />
              {!sidebarCollapsed && (
                <p className="px-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-warning/70 select-none">
                  Manager
                </p>
              )}
              {MANAGER_QUICK_ITEMS.map(item => {
                const active = isActive(item, location.pathname)
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors',
                      active
                        ? 'bg-warning text-white font-medium'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                      sidebarCollapsed && 'justify-center px-0 w-10 mx-auto',
                    )}
                  >
                    <item.icon className={cn('flex-shrink-0', sidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4', active ? 'opacity-100' : 'opacity-70')} />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.href === '/manager/dashboard' && !active && (
                          <ArrowUpRight className="h-3 w-3 opacity-40 flex-shrink-0" />
                        )}
                      </>
                    )}
                  </Link>
                )
              })}
            </div>
          )}

        </nav>

        {/* ── Search (opens ⌘K palette) ────────────────────────────────── */}
        <div className={cn(
          'border-t border-sidebar-border flex-shrink-0',
          sidebarCollapsed ? 'px-2 py-2' : 'px-3 py-2',
        )}>
          <SidebarSearchButton onClick={openSearch} collapsed={sidebarCollapsed} />
        </div>

        {/* ── Collapse toggle ──────────────────────────────────────────── */}
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
