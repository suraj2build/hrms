/**
 * AdminSidebar — Enterprise grouped navigation sidebar.
 *
 * Architecture:
 *   · 12 collapsible groups driven by navigation.config.ts (single source of truth)
 *   · Auto-expands the group that contains the active route
 *   · Persists expanded state in sessionStorage
 *   · Collapsed mode shows icon-only; tooltip via `title` attribute
 *   · Live badge counts for Anomalies and Corrections
 *
 * Design rules: design-system tokens only — no raw hex / bg-gray-*.
 */
import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown, Inbox } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn }           from '@/lib/utils'
import { LogoMark }     from '@/components/brand/Logo'
import { useUIStore }   from '@/stores/uiStore'
import { api }          from '@/lib/api/client'
import { Button }       from '@/components/ui/button'
import {
  ADMIN_GROUPS,
  ADMIN_NAV_ITEMS,
  type NavItem,
  type NavGroup,
} from '@/config/navigation.config'

// ── Badge count queries ────────────────────────────────────────────────────────

function useSidebarBadges() {
  const { data: anomalyResp } = useQuery<{ total?: number; data?: unknown[] }>({
    queryKey:       ['sidebar-anomaly-count'],
    queryFn:        () => api.get('/attendance/anomalies?resolved=false&limit=1'),
    staleTime:      5 * 60_000,
    retry:          false,
    refetchInterval: 5 * 60_000,
  })
  const { data: correctionsResp } = useQuery<{ total?: number }>({
    queryKey:       ['sidebar-corrections-count'],
    queryFn:        () => api.get('/attendance/corrections?status=pending&limit=1'),
    staleTime:      5 * 60_000,
    retry:          false,
    refetchInterval: 5 * 60_000,
  })

  return {
    Anomalies:   anomalyResp?.total ?? (Array.isArray(anomalyResp?.data) ? (anomalyResp!.data as unknown[]).length : 0),
    Corrections: correctionsResp?.total ?? 0,
  }
}

// ── Session-persisted expanded groups ─────────────────────────────────────────

const STORAGE_KEY = 'admin_sidebar_expanded'

function loadExpanded(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function saveExpanded(ids: Set<string>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

function groupIdForRoute(pathname: string): string | null {
  // Find the nav item whose route best matches the current pathname
  let bestMatch: NavItem | null = null
  let bestLen = 0
  for (const item of ADMIN_NAV_ITEMS) {
    if (item.exact) {
      if (pathname === item.route || pathname === item.route + '/') {
        if (item.route.length > bestLen) { bestMatch = item; bestLen = item.route.length }
      }
    } else {
      if (pathname.startsWith(item.route) && item.route.length > bestLen) {
        bestMatch = item; bestLen = item.route.length
      }
    }
  }
  return bestMatch?.groupId ?? null
}

// ── Item active check ──────────────────────────────────────────────────────────

function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.route || pathname === item.route + '/'
  return pathname.startsWith(item.route)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function NavItemRow({
  item,
  collapsed,
  badge,
  inGroup,
}: {
  item:      NavItem
  collapsed: boolean
  badge:     number
  inGroup:   boolean
}) {
  const location = useLocation()
  const active   = isItemActive(item, location.pathname)

  return (
    <Link
      to={item.route}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md text-sm transition-colors',
        inGroup ? 'py-[7px]' : 'py-1.5',
        !collapsed && 'border-l-[3px] pl-[9px] pr-2.5',
        collapsed  && 'justify-center px-2 py-2',
        active && !collapsed && 'bg-primary/[0.12] text-foreground font-medium border-primary',
        active && collapsed  && 'bg-primary/[0.12] text-foreground font-medium ring-1 ring-primary/25',
        !active && !collapsed && 'text-muted-foreground/75 border-transparent hover:bg-sidebar-accent hover:text-foreground',
        !active && collapsed  && 'text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground',
      )}
    >
      <item.icon className={cn(
        'h-[15px] w-[15px] flex-shrink-0 transition-colors',
        active ? 'text-primary' : 'text-muted-foreground/55',
      )} />
      {!collapsed && (
        <>
          <span className="flex-1 text-[13px] leading-none truncate">{item.label}</span>
          {badge > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold tabular-nums leading-none">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
      {collapsed && badge > 0 && (
        <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </Link>
  )
}

function GroupSection({
  group,
  items,
  badges,
  expanded,
  onToggle,
  collapsed: sidebarCollapsed,
}: {
  group:    NavGroup
  items:    NavItem[]
  badges:   Record<string, number>
  expanded: boolean
  onToggle: (id: string) => void
  collapsed: boolean
}) {
  // Total badge count for the group (shown on collapsed header)
  const totalBadge = items.reduce((acc, item) => acc + (item.badge ? (badges[item.badge] ?? 0) : 0), 0)

  if (items.length === 0) return null

  return (
    <div className="mt-2">
      {/* Group header — click to expand/collapse */}
      <button
        type="button"
        onClick={() => onToggle(group.id)}
        title={sidebarCollapsed ? group.label : undefined}
        className={cn(
          'w-full flex items-center transition-colors rounded-md',
          sidebarCollapsed
            ? 'justify-center px-2 py-2 hover:bg-sidebar-accent'
            : 'px-1 py-1 hover:bg-muted/20 gap-2',
        )}
      >
        {sidebarCollapsed ? (
          <div className="relative">
            <group.icon className="h-[15px] w-[15px] text-muted-foreground/55" />
            {totalBadge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </div>
        ) : (
          <>
            <group.icon className="h-[13px] w-[13px] text-muted-foreground/50 flex-shrink-0" />
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60 select-none leading-none text-left truncate">
              {group.label}
            </span>
            {totalBadge > 0 && !expanded && (
              <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold tabular-nums leading-none mr-1">
                {totalBadge > 99 ? '99+' : totalBadge}
              </span>
            )}
            <ChevronDown className={cn(
              'h-3 w-3 text-muted-foreground/40 flex-shrink-0 transition-transform duration-200',
              expanded && 'rotate-180',
            )} />
          </>
        )}
      </button>

      {/* Group items — shown when expanded (or in collapsed sidebar: always visible on hover) */}
      {(expanded || sidebarCollapsed) && (
        <div className={cn(
          'space-y-0.5',
          !sidebarCollapsed && cn('rounded-lg p-1 mt-0.5', group.accentClass ?? 'bg-muted/[0.15]'),
        )}>
          {items.map(item => (
            <NavItemRow
              key={item.id}
              item={item}
              collapsed={sidebarCollapsed}
              badge={item.badge ? (badges[item.badge] ?? 0) : 0}
              inGroup={!sidebarCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AdminSidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const location  = useLocation()
  const badges    = useSidebarBadges()

  // ── Expanded group state ───────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const stored    = loadExpanded()
    const activeGid = groupIdForRoute(location.pathname)

    // Bootstrap: use stored state, but always ensure active group is expanded
    const initial = stored.size > 0 ? stored : new Set(
      ADMIN_GROUPS.filter(g => g.defaultExpanded).map(g => g.id)
    )
    if (activeGid) initial.add(activeGid)
    return initial
  })

  // Auto-expand when navigation changes (clicking deep links, etc.)
  useEffect(() => {
    const gid = groupIdForRoute(location.pathname)
    if (gid) {
      setExpanded(prev => {
        if (prev.has(gid)) return prev
        const next = new Set(prev)
        next.add(gid)
        saveExpanded(next)
        return next
      })
    }
  }, [location.pathname])

  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveExpanded(next)
      return next
    })
  }, [])

  // ── Group items lookup ─────────────────────────────────────────────────────
  function itemsForGroup(groupId: string): NavItem[] {
    return ADMIN_NAV_ITEMS.filter(item => item.groupId === groupId)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex-shrink-0',
        sidebarCollapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Logo ── */}
      <div className={cn(
        'flex items-center h-14 px-4 border-b border-sidebar-border flex-shrink-0',
        sidebarCollapsed && 'justify-center px-2',
      )}>
        {sidebarCollapsed ? (
          <LogoMark size={32} />
        ) : (
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <div>
              <p className="text-[13px] font-bold text-foreground leading-none tracking-tight">Emvora</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-none">Admin Portal</p>
            </div>
          </div>
        )}
      </div>

      {/* Approval Inbox shortcut — always visible above groups */}
      <div className={cn('px-2 pt-2', sidebarCollapsed && 'flex justify-center')}>
        <Link
          to="/admin/approvals/inbox"
          title={sidebarCollapsed ? 'Approval Inbox' : undefined}
          className={cn(
            'flex items-center gap-2 rounded-md text-sm transition-colors',
            isItemActive({ route: '/admin/approvals/inbox', exact: false } as NavItem, location.pathname)
              ? 'bg-primary/[0.12] text-foreground font-medium'
              : 'text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground',
            !sidebarCollapsed && 'px-2 py-1.5',
            sidebarCollapsed  && 'px-2 py-2 justify-center',
          )}
        >
          <Inbox className={cn(
            'h-[15px] w-[15px] flex-shrink-0',
            isItemActive({ route: '/admin/approvals/inbox', exact: false } as NavItem, location.pathname)
              ? 'text-primary' : 'text-muted-foreground/55',
          )} />
          {!sidebarCollapsed && (
            <span className="text-[13px] leading-none">Approval Inbox</span>
          )}
        </Link>
      </div>

      {/* Main grouped nav ── */}
      <nav className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5">
        {ADMIN_GROUPS.map(group => (
          <GroupSection
            key={group.id}
            group={group}
            items={itemsForGroup(group.id)}
            badges={badges}
            expanded={expanded.has(group.id)}
            onToggle={toggle}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Bottom collapse toggle ── */}
      <div className="px-2 pt-2 pb-1.5 border-t border-sidebar-border flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className={cn(
            'w-full h-7 text-muted-foreground/40 hover:text-muted-foreground',
            sidebarCollapsed && 'justify-center',
          )}
        >
          {sidebarCollapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronLeft  className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </aside>
  )
}
