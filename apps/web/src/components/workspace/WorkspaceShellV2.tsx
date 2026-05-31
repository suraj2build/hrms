/**
 * WorkspaceShellV2 — UX-1 Navigation Simplification & Workspace Consolidation.
 *
 * A horizontal-tab-based workspace container that orchestrates:
 *   · PageHeader (title, subtitle, headerActions)
 *   · KpiStrip (optional, loading-aware)
 *   · WorkspaceTabs (optional horizontal tab bar)
 *   · WorkspaceToolbar (between tabs and content)
 *   · Main content area with optional right insight panel
 *
 * Replaces the vertical-nav WorkspaceShell for pages that use the new
 * UX-1 pattern. Existing pages continue to use WorkspaceShell unchanged.
 */

import * as React from 'react'
import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { KpiStrip }         from './KpiStrip'
import { WorkspaceTabs }    from './WorkspaceTabs'
import { WorkspaceToolbar } from './WorkspaceToolbar'
import { cn }               from '@/lib/utils'
import type { KpiCard }            from './KpiStrip'
import type { WorkspaceTab }       from './WorkspaceTabs'
import type { WorkspaceToolbarProps } from './WorkspaceToolbar'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceShellV2Props {
  /** Page title */
  title:          string
  /** Page subtitle */
  subtitle?:      string
  /** KPI metrics strip */
  kpis?:          KpiCard[]
  kpiCols?:       2 | 3 | 4 | 5 | 6
  kpiLoading?:    boolean
  /** Tab definitions */
  tabs?:          WorkspaceTab[]
  activeTab?:     string
  onTabChange?:   (key: string) => void
  /** Toolbar props */
  toolbar?:       WorkspaceToolbarProps
  /** Optional right-side insights panel */
  insightPanel?:  React.ReactNode
  /** Main content */
  children:       React.ReactNode
  /** Header right-slot (breadcrumb actions, etc.) */
  headerActions?: React.ReactNode
  className?:     string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkspaceShellV2({
  title,
  subtitle,
  kpis,
  kpiCols      = 4,
  kpiLoading   = false,
  tabs,
  activeTab,
  onTabChange,
  toolbar,
  insightPanel,
  children,
  headerActions,
  className,
}: WorkspaceShellV2Props) {
  const hasInsightPanel = Boolean(insightPanel)

  return (
    <PageContainer className={cn('', className)}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={headerActions}
      />

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      {kpis && kpis.length > 0 && (
        <KpiStrip
          cards={kpiLoading
            ? kpis.map(k => ({ ...k, loading: true }))
            : kpis
          }
          cols={kpiCols}
        />
      )}

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      {tabs && tabs.length > 0 && activeTab !== undefined && onTabChange && (
        <WorkspaceTabs
          tabs={tabs}
          active={activeTab}
          onChange={onTabChange}
        />
      )}

      {/* ── Toolbar (between tabs and content) ───────────────────────────── */}
      {toolbar && (
        <div className="mt-3">
          <WorkspaceToolbar {...toolbar} />
        </div>
      )}

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          hasInsightPanel
            ? 'grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4'
            : '',
        )}
      >
        {/* Content area */}
        <div className="min-h-[200px]">
          {children}
        </div>

        {/* Right insight panel */}
        {hasInsightPanel && (
          <div className="sticky top-4 self-start">
            {insightPanel}
          </div>
        )}
      </div>

    </PageContainer>
  )
}
