/**
 * EmployeeSidebar — flat, non-collapsible enterprise ESS navigation.
 * Section headings are static labels; only the whole sidebar collapses to icon-rail.
 */

import { useMemo }             from 'react'
import { Link, useLocation }  from 'react-router-dom'
import { useQuery }           from '@tanstack/react-query'
import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  CalendarPlus,
  CalendarOff,
  CalendarClock,
  BookOpen,
  Scale,
  Receipt,
  DollarSign,
  FileCheck,
  CreditCard,
  FileText,
  Mail,
  Clock,
  CheckSquare,
  Users,
  Building2,
  HelpCircle,
  LifeBuoy,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  HeadphonesIcon,
} from 'lucide-react'
import { cn }            from '@/lib/utils'
import { useUIStore }    from '@/stores/uiStore'
import { useAuthStore }  from '@/stores/authStore'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'

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
      { label: 'Dashboard', icon: LayoutDashboard, href: '/ess/dashboard', exact: true },
    ],
  },
  {
    label: 'Attendance & Leave',
    items: [
      { label: 'My Attendance',       icon: CalendarDays,  href: '/ess/attendance',          exact: true },
      { label: 'My Schedule',         icon: CalendarClock, href: '/ess/schedule'                         },
      { label: 'Leave Balance',       icon: Scale,         href: '/ess/leave/balance'                    },
      { label: 'Apply Leave',         icon: CalendarPlus,  href: '/ess/leave/apply'                      },
      { label: 'Comp-Off',            icon: CalendarOff,   href: '/ess/comp-off'                         },
      { label: 'Attendance Calendar', icon: CalendarRange, href: '/ess/attendance/calendar'              },
      { label: 'Leave Ledger',        icon: BookOpen,      href: '/ess/leave/ledger'                     },
    ],
  },
  {
    label: 'Payroll & Tax',
    items: [
      { label: 'My Payslips',      icon: Receipt,    href: '/ess/payroll/my-slips' },
      { label: 'My Compensation',  icon: DollarSign, href: '/ess/compensation'     },
      { label: 'Tax Declarations', icon: FileCheck,  href: '/ess/declarations'     },
      { label: 'Reimbursements',   icon: CreditCard, href: '/ess/reimbursements'   },
    ],
  },
  {
    label: 'Documents',
    items: [
      { label: 'My Documents', icon: FileText, href: '/ess/documents' },
      { label: 'Letters',      icon: Mail,     href: '/ess/letters'   },
    ],
  },
  {
    label: 'Requests',
    items: [
      { label: 'Corrections',  icon: Clock,       href: '/ess/attendance/corrections' },
      { label: 'Approvals',    icon: CheckSquare, href: '/ess/approvals'              },
    ],
  },
  {
    label: 'Explore',
    items: [
      { label: 'Optional Holidays', icon: CalendarOff, href: '/ess/optional-holidays' },
      { label: 'My Team',           icon: Users,       href: '/ess/team'              },
      { label: 'Policies',          icon: BookMarked,  href: '/ess/policies'          },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'HR Support', icon: HeadphonesIcon, href: '/ess/hr-support' },
      { label: 'Helpdesk',   icon: LifeBuoy,       href: '/ess/issues'     },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function isActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href || pathname === item.href + '/'
  return pathname.startsWith(item.href)
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Pending badge hook ────────────────────────────────────────────────────────

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
    queryFn:  () => api.get('/payroll/reimbursements/my').then((r: any) => r.data),
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
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { profile }  = useAuthStore()
  const employeeId   = profile?.employee_id ?? null
  const location     = useLocation()
  const pendingCount = usePendingCount(employeeId)

  // Inject live badge count into the Approvals item
  const GROUPS = useMemo((): NavGroup[] =>
    BASE_GROUPS.map(g => ({
      ...g,
      items: g.items.map(item =>
        item.href === '/ess/approvals'
          ? { ...item, badge: pendingCount > 0 ? pendingCount : undefined }
          : item
      ),
    })), [pendingCount]
  )

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex-shrink-0',
        sidebarCollapsed ? 'w-[68px]' : 'w-[220px]',
      )}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex items-center h-14 border-b border-sidebar-border flex-shrink-0',
          sidebarCollapsed ? 'justify-center px-0' : 'px-4 gap-2.5',
        )}
      >
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <Building2 className="h-4 w-4 text-primary-foreground" />
        </div>
        {!sidebarCollapsed && (
          <div className="leading-tight">
            <p className="text-sm font-bold text-sidebar-foreground">HRMS</p>
            <p className="text-[10px] text-sidebar-foreground/65">Employee Portal</p>
          </div>
        )}
      </div>

      {/* ── Nav groups ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>

            {/* Group label — only when expanded */}
            {!sidebarCollapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/55 select-none">
                {group.label}
              </p>
            )}

            {/* Items */}
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
        ))}
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

      {/* ── Collapse toggle ───────────────────────────────────────────────── */}
      <div className={cn('p-2 border-t border-sidebar-border flex-shrink-0', sidebarCollapsed && 'flex justify-center')}>
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
  )
}
