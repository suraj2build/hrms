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
  'workforce':    { bg: 'bg-indigo-50',   text: 'text-indigo-600'  },
  'attendance':   { bg: 'bg-amber-50',    text: 'text-amber-600'   },
  'leave':        { bg: 'bg-emerald-50',  text: 'text-emerald-600' },
  'payroll':      { bg: 'bg-violet-50',   text: 'text-violet-600'  },
  'compliance':   { bg: 'bg-rose-50',     text: 'text-rose-600'    },
  'operations':   { bg: 'bg-sky-50',      text: 'text-sky-600'     },
  'reports':      { bg: 'bg-blue-50',     text: 'text-blue-600'    },
  'advanced-ops': { bg: 'bg-fuchsia-50',  text: 'text-fuchsia-600' },
  'setup':        { bg: 'bg-slate-100',   text: 'text-slate-500'   },
  // Executive Mode domains
  'exec-intelligence': { bg: 'bg-primary/10', text: 'text-primary'    },
  'exec-reports':      { bg: 'bg-blue-50',    text: 'text-blue-600'   },
  'exec-workforce':    { bg: 'bg-indigo-50',  text: 'text-indigo-600' },
}

// v3: groups collapsed by default (bumped from v2 so old "expanded" caches are ignored)
const SESSION_KEY = (domainId: string) => `sidebar-v3-collapsed-${domainId}`

function loadExpanded(domainId: string, _groups: DomainNavGroup[]): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(domainId))
    if (raw) {
      const parsed: string[] = JSON.parse(raw)
      return new Set(parsed)
    }
  } catch { /* ignore */ }
  // Default: all groups collapsed — the user expands what they need.
  return new Set<string>()
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
          className={cn(
            'flex items-center justify-between w-full gap-2 px-3 py-2 mt-1 rounded-md border transition-colors select-none',
            'text-xs font-bold uppercase tracking-wide text-primary',
            expanded
              ? 'bg-primary/[0.12] border-primary/25 hover:bg-primary/15'
              : 'bg-primary/[0.06] border-primary/15 hover:bg-primary/[0.12]',
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn('h-3.5 w-1 rounded-full shrink-0', expanded ? 'bg-primary' : 'bg-primary/50')} />
            <span className="truncate">{group.label}</span>
          </span>
          {expanded
            ? <ChevronDown className="h-4 w-4 shrink-0 text-primary" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-primary/70" />
          }
        </button>
      )}

      {/* Items */}
      {(expanded || collapsed) && (
        <div className={cn('space-y-0.5', !collapsed && 'px-2 mt-1.5')}>
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
                    // Selected row mirrors the top bar's 3D recipe: navy gradient fill,
                    // white content, inset top-highlight + bottom-shade and a soft colored
                    // drop shadow so it reads as the same raised pill as the header.
                    ? 'bg-[image:var(--gradient-nav)] text-white font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.20),inset_0_-1px_0_0_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(26,77,143,0.55)]'
                    : 'text-sidebar-foreground/75 hover:bg-muted/60 hover:text-sidebar-foreground',
                )}
              >
                {/* Colored icon container — goes white-on-translucent when the
                    row is selected, matching the top bar's chips. */}
                <span
                  className={cn(
                    'flex items-center justify-center rounded-md flex-shrink-0 transition-opacity',
                    collapsed ? 'h-7 w-7' : 'h-6 w-6',
                    isActive
                      ? 'bg-white/15 text-white opacity-100'
                      : cn(iconColors.bg, iconColors.text, 'opacity-75'),
                  )}
                >
                  <item.icon className={collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                </span>
                {!collapsed && (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {!collapsed && item.badge && (
                  <span className={cn(
                    'text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                    isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                  )}>
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
        <div className="flex items-center gap-2 h-12 px-4 border-b border-primary/20 bg-primary/5 flex-shrink-0">
          <domain.icon className="h-[18px] w-[18px] text-primary flex-shrink-0" />
          <p className="text-[15px] font-bold text-primary truncate tracking-tight">{domain.label}</p>
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
      <nav className="flex-1 overflow-y-auto pt-4 pb-3 space-y-2.5">
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
