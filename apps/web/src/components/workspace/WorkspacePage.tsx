/**
 * WorkspacePage — full-page layout wrapper for workspace pages.
 *
 * Composes WorkspaceHeader, WorkspaceKpiStrip, WorkspaceTabs, a main content
 * area, and an optional WorkspaceRightPanel into the standard UX-2 layout.
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │ WorkspaceHeader                 │
 *   ├─────────────────────────────────┤
 *   │ WorkspaceKpiStrip (optional)    │
 *   ├─────────────────────────────────┤
 *   │ WorkspaceTabs (optional)        │
 *   ├──────────────────────┬──────────┤
 *   │ <main> scrollable    │ Right    │
 *   │   {children}         │ Panel    │
 *   └──────────────────────┴──────────┘
 */

import * as React from 'react'
import { WorkspaceHeader }         from './WorkspaceHeader'
import { WorkspaceKpiStrip }       from './WorkspaceKpiStrip'
import { WorkspaceTabs }           from './WorkspaceTabs'
import { WorkspaceRightPanel }     from './WorkspaceRightPanel'
import { WorkspaceLoadingSkeleton } from './WorkspaceLoadingSkeleton'
import { cn }                      from '@/lib/utils'
import type { BreadcrumbEntry }    from './WorkspaceHeader'
import type { KpiCardData }        from './WorkspaceKpiStrip'
import type { WorkspaceTab }       from './WorkspaceTabs'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspacePageProps {
  // Header
  title:          string
  subtitle?:      string
  breadcrumbs?:   BreadcrumbEntry[]
  headerActions?: React.ReactNode

  // KPI strip
  kpis?:          KpiCardData[]
  kpisLoading?:   boolean

  // Tabs
  tabs?:          WorkspaceTab[]
  activeTab?:     string
  onTabChange?:   (id: string) => void

  // Right panel
  rightPanel?:    React.ReactNode

  // Content
  children:       React.ReactNode

  // Loading
  loading?:       boolean

  // Class overrides
  className?:     string
  contentClassName?: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export const WorkspacePage = React.memo(function WorkspacePage({
  title,
  subtitle,
  breadcrumbs,
  headerActions,
  kpis,
  kpisLoading   = false,
  tabs,
  activeTab,
  onTabChange,
  rightPanel,
  children,
  loading       = false,
  className,
  contentClassName,
}: WorkspacePageProps) {
  const hasKpis       = Boolean(kpis && kpis.length > 0)
  const hasTabs       = Boolean(tabs && tabs.length > 0 && activeTab !== undefined && onTabChange)
  const hasRightPanel = Boolean(rightPanel)

  // Memoised KPI strip to prevent unnecessary re-renders when only content changes
  const kpiStrip = React.useMemo(() => {
    if (!hasKpis || !kpis) return null
    return (
      <div className="px-6 py-3 border-b border-border">
        <WorkspaceKpiStrip
          items={kpis}
          loading={kpisLoading}
        />
      </div>
    )
  }, [hasKpis, kpis, kpisLoading])

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Header */}
      <WorkspaceHeader
        title={title}
        subtitle={subtitle}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      {/* KPI strip */}
      {kpiStrip}

      {/* Tab bar */}
      {hasTabs && (
        <WorkspaceTabs
          tabs={tabs!}
          active={activeTab!}
          onChange={onTabChange!}
        />
      )}

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main
          className={cn(
            'flex-1 overflow-y-auto px-6 py-4',
            contentClassName,
          )}
          aria-label={title}
        >
          {loading ? (
            <WorkspaceLoadingSkeleton variant="page" />
          ) : (
            children
          )}
        </main>

        {hasRightPanel && (
          <WorkspaceRightPanel>
            {rightPanel}
          </WorkspaceRightPanel>
        )}
      </div>
    </div>
  )
})

WorkspacePage.displayName = 'WorkspacePage'
