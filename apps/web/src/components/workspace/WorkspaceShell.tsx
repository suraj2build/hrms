/**
 * WorkspaceShell — Enterprise workspace container.
 *
 * Provides:
 *   · Sticky workspace header with title, subtitle, breadcrumbs
 *   · Grouped vertical contextual navigation (left panel, w-44)
 *   · URL-param driven active item (?tab=xxx)
 *   · Optional right intelligence panel slot
 *   · Operational command header slot
 *   · Design-token-only — no raw hex / bg-gray-*
 *
 * Navigation modes:
 *   navGroups  — preferred: grouped vertical nav (WorkspaceNavGroup[])
 *   tabs        — legacy: flat list rendered as ungrouped vertical nav
 */

import { useCallback, type ReactNode } from 'react'
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceNavItem {
  /** Unique key — written to ?tab= param */
  key:          string
  label:        string
  icon:         LucideIcon
  /** Rendered as the workspace content when active */
  content:      ReactNode
  /** Optional badge count shown beside the label */
  badge?:       number
  /** If true, item is shown but greyed out / non-clickable */
  disabled?:    boolean
  /** Short description for accessibility / tooltip */
  description?: string
}

export interface WorkspaceNavGroup {
  id:    string
  /** Group header label — shown as a small uppercase section title */
  label: string
  items: WorkspaceNavItem[]
}

/**
 * Legacy flat-tab shape kept for backward compat.
 * Pages that still pass `tabs` get a single ungrouped vertical list.
 */
export interface WorkspaceTab extends WorkspaceNavItem {
  secondary?: boolean
}

export interface BreadcrumbItem {
  label: string
  href?:  string
}

export interface WorkspaceShellProps {
  title:          string
  subtitle?:      string
  breadcrumbs?:   BreadcrumbItem[]
  /**
   * Grouped vertical contextual navigation.
   * Preferred for workspace pages — enables logical grouping and
   * scales naturally with operational depth.
   */
  navGroups?:     WorkspaceNavGroup[]
  /**
   * Legacy flat tab list — still supported.
   * Rendered as a single implicit group with no group header.
   */
  tabs?:          WorkspaceTab[]
  defaultTab:     string
  actions?:       ReactNode
  commandHeader?: ReactNode
  rightPanel?:    ReactNode
  className?:     string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkspaceShell({
  title,
  subtitle,
  breadcrumbs,
  navGroups,
  tabs,
  defaultTab,
  actions,
  commandHeader,
  rightPanel,
  className,
}: WorkspaceShellProps) {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()
  const location       = useLocation()

  // Flatten all items across groups for key-based lookup
  const allItems: WorkspaceNavItem[] = navGroups
    ? navGroups.flatMap(g => g.items)
    : (tabs ?? [])

  const raw    = searchParams.get('tab') ?? ''
  const active = allItems.find(t => t.key === raw) ? raw : defaultTab

  const setTab = useCallback((key: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', key)
    navigate(`${location.pathname}?${next.toString()}`, { replace: true })
  }, [navigate, searchParams, location.pathname])

  const activeItem = allItems.find(t => t.key === active) ?? allItems[0]

  // Build display groups — navGroups wins; tabs fall back to a single implicit group
  const displayGroups: WorkspaceNavGroup[] = navGroups
    ? navGroups
    : tabs
    ? [{ id: '_flat', label: '', items: tabs }]
    : []

  return (
    <div className={cn('flex flex-col min-h-0 flex-1', className)}>

      {/* ── Sticky workspace header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">

        {/* Breadcrumbs */}
        {(breadcrumbs && breadcrumbs.length > 0) && (
          <div className="flex items-center gap-1 px-6 pt-2.5 pb-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {crumb.href ? (
                  <Link
                    to={crumb.href}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{crumb.label}</span>
                )}
                {i < breadcrumbs.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                )}
              </span>
            ))}
          </div>
        )}

        {/* Title row */}
        <div className="flex items-start justify-between px-6 pt-1.5 pb-3">
          <div>
            <h1 className="text-[15px] font-semibold text-foreground leading-tight">{title}</h1>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0 ml-4 pt-0.5">
              {actions}
            </div>
          )}
        </div>

        {/* Command header (operational metrics strip) */}
        {commandHeader && (
          <div className="border-t border-border/40">
            {commandHeader}
          </div>
        )}
      </div>

      {/* ── Workspace body ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Contextual vertical navigation ──────────────────────────────── */}
        <nav
          aria-label="Workspace navigation"
          className="w-44 flex-shrink-0 border-r border-border/60 overflow-y-auto bg-muted/[0.03]"
        >
          <div className="py-3 px-2 space-y-4">
            {displayGroups.map(group => (
              <div key={group.id}>

                {/* Group header — omitted for implicit single flat group */}
                {group.label && (
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/45 select-none">
                    {group.label}
                  </p>
                )}

                {/* Nav items */}
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const isActive = item.key === active
                    return (
                      <button
                        key={item.key}
                        type="button"
                        disabled={item.disabled}
                        title={item.description}
                        onClick={() => !item.disabled && setTab(item.key)}
                        className={cn(
                          'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[12px] transition-colors text-left group',
                          isActive
                            ? 'bg-primary/[0.08] text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                          item.disabled && 'opacity-40 cursor-not-allowed',
                        )}
                      >
                        <item.icon className={cn(
                          'h-3.5 w-3.5 flex-shrink-0 transition-colors',
                          isActive
                            ? 'text-primary'
                            : 'text-muted-foreground/50 group-hover:text-muted-foreground',
                        )} />
                        <span className="truncate leading-none">{item.label}</span>
                        {(item.badge ?? 0) > 0 && (
                          <span className={cn(
                            'ml-auto text-[10px] rounded-full px-1.5 font-semibold tabular-nums leading-[1.6] flex-shrink-0',
                            isActive
                              ? 'bg-primary/15 text-primary'
                              : 'bg-muted text-muted-foreground',
                          )}>
                            {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* ── Main content area ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {activeItem?.content}
        </div>

        {/* ── Right intelligence panel ─────────────────────────────────────── */}
        {rightPanel && (
          <div className="w-72 flex-shrink-0 border-l border-border/60 overflow-y-auto p-4 bg-sidebar/30">
            {rightPanel}
          </div>
        )}
      </div>
    </div>
  )
}
