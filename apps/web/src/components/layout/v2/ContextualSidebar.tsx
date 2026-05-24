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
import { ChevronDown, ChevronRight, PanelLeftClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { getDomainForPath, type Domain, type DomainNavGroup } from './nav-config'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  onToggle:   () => void
}

function NavGroupItem({ group, expanded, collapsed, pathname, onToggle }: NavGroupProps) {
  return (
    <div>
      {/* Group header — hidden in icon-rail mode */}
      {!collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-between w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors select-none"
        >
          {group.label}
          {expanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />
          }
        </button>
      )}

      {/* Items */}
      {(expanded || collapsed) && (
        <div className={cn('space-y-0.5', !collapsed && 'px-2')}>
          {group.items.map(item => {
            const isActive = item.exact
              ? pathname === item.route
              : pathname === item.route || pathname.startsWith(item.route + '/')

            return (
              <Link
                key={item.id}
                to={item.route}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg py-2 text-[13px] transition-colors',
                  collapsed ? 'justify-center px-0 w-9 mx-auto' : 'px-2.5',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <item.icon
                  className={cn(
                    'flex-shrink-0',
                    collapsed ? 'h-5 w-5' : 'h-4 w-4',
                    isActive ? 'opacity-100' : 'opacity-70',
                  )}
                />
                {!collapsed && (
                  <span className="flex-1 truncate">{item.label}</span>
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
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const location = useLocation()
  const domain: Domain | null = getDomainForPath(location.pathname)

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
      <aside
        className={cn(
          'flex flex-col h-full bg-sidebar border-r border-sidebar-border flex-shrink-0 transition-all duration-300',
          sidebarCollapsed ? 'w-[52px]' : 'w-[200px]',
        )}
      />
    )
  }

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-sidebar border-r border-sidebar-border flex-shrink-0 transition-all duration-300',
        sidebarCollapsed ? 'w-[52px]' : 'w-[200px]',
      )}
    >
      {/* ── Domain label header ──────────────────────────────────── */}
      {!sidebarCollapsed && (
        <div className="flex items-center gap-2 h-11 px-4 border-b border-sidebar-border flex-shrink-0">
          <domain.icon className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-sm font-semibold text-sidebar-foreground truncate">{domain.label}</p>
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
            onToggle={() => toggleGroup(group.label)}
          />
        ))}
      </nav>

      {/* ── Collapse toggle ──────────────────────────────────────── */}
      <div className={cn(
        'p-2 border-t border-sidebar-border flex-shrink-0',
        sidebarCollapsed && 'flex justify-center',
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
  )
}
