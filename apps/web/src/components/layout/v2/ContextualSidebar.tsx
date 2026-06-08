/**
 * ContextualSidebar — Domain-contextual left sidebar for AdminShell V2.
 *
 * Shows nav groups and items for the currently active domain.
 * Collapses to icon-rail (52px) via useUIStore.sidebarCollapsed.
 *
 * Features:
 *   · Group expand/collapse persisted to sessionStorage per domain
 *   · Active item highlighted (primary bg)
 *   · Collapsed: icon-only with tooltip via `title` attribute
 *   · Badge counts via TanStack Query workspace stats
 */

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, PanelLeftClose, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { getDomainForPath, getVisibleDomain, getExecutiveDomainForPath, type Domain, type DomainNavGroup } from './nav-config'

// ── Types ─────────────────────────────────────────────────────────────────────

// Colored icon container tokens — one accent per domain
const DOMAIN_ICON_COLORS: Record<string, { bg: string; text: string }> = {
  'home':         { bg: 'bg-slate-100',   text: 'text-slate-500'   },
  'workforce':    { bg: 'bg-indigo-50',   text: 'text-indigo-600'  },
  'attendance':   { bg: 'bg-amber-50',    text: 'text-amber-600'   },
  'leave':        { bg: 'bg-emerald-50',  text: 'text-emerald-600' },
  'payroll':      { bg: 'bg-violet-50',   text: 'text-violet-600'  },
  'compliance':   { bg: 'bg-rose-50',     text: 'text-rose-600'    },
  'operations':   { bg: 'bg-sky-50',      text: 'text-sky-600'     },
  'reports':      { bg: 'bg-blue-50',     text: 'text-blue-600'    },
  'advanced-ops': { bg: 'bg-fuchsia-50',  text: 'text-fuchsia-600' },
  'setup':        { bg: 'bg-slate-100',   text: 'text-slate-500'   },
}

const SESSION_KEY = (domainId: string) => `sidebar-v2-expanded-${domainId}`

function loadExpanded(domainId: string, groups: DomainNavGroup[]): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(domainId))
    if (raw) {
      const parsed: string[] = JSON.parse(raw)
      return new Set(parsed)
    }
  } catch { /* ignore */ }
  // Default: expand all groups
  return new Set(groups.map(g => g.label))
}

function saveExpanded(domainId: string, expanded: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_KEY(domainId), JSON.stringify([...expanded]))
  } catch { /* ignore */ }
}

// ── NavGroup component ────────────────────────────────────────────────────────

interface NavGroupProps {
  group:      DomainNavGroup
  expanded:   boolean
  collapsed:  boolean   // sidebar icon-rail mode
  pathname:   string
  search:     string    // location.search (e.g. "?tab=work-locations")
  onToggle:   () => void
  domainId:   string
}

function NavGroupItem({ group, expanded, collapsed, pathname, search, onToggle, domainId }: NavGroupProps) {
  const iconColors = DOMAIN_ICON_COLORS[domainId] ?? { bg: 'bg-muted', text: 'text-foreground' }

  return (
    <div>
      {/* Group header — hidden in icon-rail mode */}
      {!collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-between w-full px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground/55 hover:text-muted-foreground transition-colors select-none"
        >
          {group.label}
          {expanded
            ? <ChevronDown className="h-3 w-3 opacity-60" />
            : <ChevronRight className="h-3 w-3 opacity-60" />
          }
        </button>
      )}

      {/* Items */}
      {(expanded || collapsed) && (
        <div className={cn('space-y-0.5', !collapsed && 'px-2')}>
          {group.items.map(item => {
            // Support routes with query params (e.g. "/admin/masters?tab=work-locations")
            const isActive = (() => {
              const qi = item.route.indexOf('?')
              if (qi !== -1) {
                const itemPath  = item.route.slice(0, qi)
                const itemQuery = item.route.slice(qi)   // includes '?'
                return pathname === itemPath && search === itemQuery
              }
              return item.exact
                ? pathname === item.route
                : pathname === item.route || pathname.startsWith(item.route + '/')
            })()

            return (
              <Link
                key={item.id}
                to={item.route}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center gap-2 rounded-lg py-1.5 text-[12.5px] transition-colors',
                  collapsed ? 'justify-center px-0 w-10 mx-auto' : 'px-1.5',
                  isActive
                    ? 'bg-primary/[0.12] text-primary font-semibold'
                    : 'text-sidebar-foreground/75 hover:bg-muted/60 hover:text-sidebar-foreground',
                )}
              >
                {/* Left active indicator pill */}
                {isActive && !collapsed && (
                  <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-full bg-primary" />
                )}

                {/* Colored icon container */}
                <span
                  className={cn(
                    'flex items-center justify-center rounded-md flex-shrink-0 transition-opacity',
                    collapsed ? 'h-7 w-7' : 'h-6 w-6',
                    iconColors.bg,
                    iconColors.text,
                    isActive ? 'opacity-100' : 'opacity-75',
                  )}
                >
                  <item.icon className={collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                </span>
                {!collapsed && (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {!collapsed && item.badge && (
                  <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── ContextualSidebar ─────────────────────────────────────────────────────────

export function ContextualSidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen, executiveMode } = useUIStore()
  const { profile } = useAuthStore()
  const location = useLocation()
  // In Executive Mode: use the curated exec-domain set (pre-filtered, no role filter needed).
  // In normal mode: find domain by path, then filter by role.
  const rawDomain = executiveMode
    ? getExecutiveDomainForPath(location.pathname)
    : getDomainForPath(location.pathname)
  const domain: Domain | null = rawDomain
    ? (executiveMode ? rawDomain : getVisibleDomain(rawDomain, profile?.role))
    : null

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname, location.search, setMobileNavOpen])

  // On mobile the drawer is full-width-ish (never icon-rail); on lg+ it respects collapse.
  // Wrapper classes: off-canvas under lg, static inline at lg+.
  const shellCls = cn(
    'flex flex-col h-full bg-sidebar border-r border-sidebar-border flex-shrink-0 transition-transform duration-300',
    'fixed inset-y-0 left-0 z-50 w-[244px] lg:static lg:z-auto lg:transition-all',
    mobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0',
    sidebarCollapsed ? 'lg:w-[52px]' : 'lg:w-[224px]',
  )

  // Track expanded groups per domain
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!domain) return new Set()
    return loadExpanded(domain.id, domain.groups)
  })

  // Re-init expanded state when domain changes
  useEffect(() => {
    if (!domain) return
    setExpanded(loadExpanded(domain.id, domain.groups))
  }, [domain?.id])

  function toggleGroup(label: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      if (domain) saveExpanded(domain.id, next)
      return next
    })
  }

  // No domain matched — render empty sidebar (shouldn't happen inside AdminShellV2)
  if (!domain) {
    return (
      <aside className={shellCls} />
    )
  }

  return (
   <>
    {/* Mobile backdrop */}
    {mobileNavOpen && (
      <div
        className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        onClick={() => setMobileNavOpen(false)}
        aria-hidden
      />
    )}
    <aside className={shellCls}>
      {/* ── Domain label header ──────────────────────────────────── */}
      {!sidebarCollapsed && (
        <div className="flex items-center gap-2 h-11 px-4 border-b border-sidebar-border flex-shrink-0">
          <domain.icon className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-sm font-semibold text-sidebar-foreground truncate">{domain.label}</p>
          {/* Mobile-only close */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="ml-auto lg:hidden text-muted-foreground hover:text-foreground"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {sidebarCollapsed && (
        <div className="flex items-center justify-center h-11 border-b border-sidebar-border flex-shrink-0">
          <domain.icon className="h-4 w-4 text-primary" />
        </div>
      )}

      {/* ── Nav groups ──────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-3">
        {domain.groups.map(group => (
          <NavGroupItem
            key={group.label}
            group={group}
            expanded={expanded.has(group.label)}
            collapsed={sidebarCollapsed}
            pathname={location.pathname}
            search={location.search}
            onToggle={() => toggleGroup(group.label)}
            domainId={domain.id}
          />
        ))}

      </nav>

      {/* ── Collapse toggle (desktop only) ───────────────────────── */}
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
            sidebarCollapsed
              ? 'h-8 w-8 p-0'
              : 'w-full h-8 justify-start gap-2 px-2.5 text-xs',
          )}
        >
          {sidebarCollapsed
            ? <ChevronRight className="h-4 w-4" />
            : <><PanelLeftClose className="h-4 w-4" /><span>Collapse</span></>
          }
        </Button>
      </div>
    </aside>
   </>
  )
}
