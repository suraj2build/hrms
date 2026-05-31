/**
 * Workspace component barrel.
 *
 * UX-2 design system additions:
 *   WorkspacePage          — full-page layout wrapper (header + kpis + tabs + content)
 *   WorkspaceHeader        — page-level header with breadcrumbs and actions slot
 *   WorkspaceKpiStrip      — enhanced KPI metric card grid (memoised)
 *   WorkspaceActions       — right-side toolbar action bar (refresh/export/filter/add)
 *   WorkspaceRightPanel    — collapsible right insight panel
 *   WorkspaceSectionCard   — standard section card with optional collapsible body
 *   WorkspaceEmptyState    — standardized empty state component
 *   WorkspaceLoadingSkeleton — extended loading skeleton (page/table/cards/kpi/form)
 *
 * UX-1 shared building blocks (unchanged):
 *   WorkspaceTabs          — horizontal tab bar (max 7, keyboard nav, badges)
 *   KpiStrip               — responsive KPI metric card grid
 *   WorkspaceToolbar       — standardized toolbar (search, filters, export, refresh, actions)
 *   WorkspaceSkeleton      — loading skeletons (table | cards | kpi | calendar | list)
 *   EmptyStateCard         — empty state with description, next-step hint, CTA
 *   WorkspaceShellV2       — master horizontal-tab workspace container (UX-1)
 *
 * Legacy (vertical nav, URL-param driven):
 *   WorkspaceShell         — existing vertical-nav workspace container
 */

// ── UX-2 exports ──────────────────────────────────────────────────────────────

export { WorkspacePage }             from './WorkspacePage'
export type { WorkspacePageProps }   from './WorkspacePage'

export { WorkspaceHeader }           from './WorkspaceHeader'
export type { WorkspaceHeaderProps, BreadcrumbEntry } from './WorkspaceHeader'

export { WorkspaceKpiStrip }         from './WorkspaceKpiStrip'
export type { WorkspaceKpiStripProps, KpiCardData } from './WorkspaceKpiStrip'

export { WorkspaceActions }          from './WorkspaceActions'
export type { WorkspaceActionsProps, BulkAction } from './WorkspaceActions'

export { WorkspaceRightPanel }       from './WorkspaceRightPanel'
export type { WorkspaceRightPanelProps } from './WorkspaceRightPanel'

export { WorkspaceSectionCard }      from './WorkspaceSectionCard'
export type { WorkspaceSectionCardProps } from './WorkspaceSectionCard'

export { WorkspaceEmptyState }       from './WorkspaceEmptyState'
export type {
  WorkspaceEmptyStateProps,
  WorkspaceEmptyStateAction,
  WorkspaceEmptyStateSecondaryAction,
} from './WorkspaceEmptyState'

export { WorkspaceLoadingSkeleton }  from './WorkspaceLoadingSkeleton'
export type { WorkspaceLoadingSkeletonProps } from './WorkspaceLoadingSkeleton'

// ── UX-1 exports (kept intact) ────────────────────────────────────────────────

export { WorkspaceTabs }             from './WorkspaceTabs'
export type { WorkspaceTab, WorkspaceTabsProps } from './WorkspaceTabs'

export { KpiStrip }                  from './KpiStrip'
export type { KpiCard, KpiStripProps } from './KpiStrip'

export { WorkspaceToolbar }          from './WorkspaceToolbar'
export type { WorkspaceToolbarProps } from './WorkspaceToolbar'

export { WorkspaceSkeleton }         from './WorkspaceSkeleton'
export type { WorkspaceSkeletonProps } from './WorkspaceSkeleton'

export { EmptyStateCard }            from './EmptyStateCard'
export type { EmptyStateCardProps }  from './EmptyStateCard'

export { WorkspaceShellV2 }          from './WorkspaceShellV2'
export type { WorkspaceShellV2Props } from './WorkspaceShellV2'

// ── Legacy (backward compat) ──────────────────────────────────────────────────

export {
  WorkspaceShell,
  type WorkspaceShellProps,
  type WorkspaceNavItem,
  type WorkspaceNavGroup,
  type WorkspaceTab as WorkspaceLegacyTab,
  type BreadcrumbItem,
} from './WorkspaceShell'
