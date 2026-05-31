export { DashboardShell, DashboardGrid, DashboardMain, DashboardRail } from './DashboardShell'
export { DashboardSection } from './DashboardSection'
export { MetricCard, MetricRow } from './MetricCard'
export { ActivityList } from './ActivityList'
export { ActionQueue } from './ActionQueue'
export { ScheduleCard } from './ScheduleCard'
export { InsightChart } from './InsightChart'
export { EmptyWorkspaceState } from './EmptyWorkspaceState'

export type { MetricCardProps } from './MetricCard'
export type { ActivityItem } from './ActivityList'
export type { ActionQueueItem } from './ActionQueue'
export type { ShiftInfo } from './ScheduleCard'

// ── Visual Primitives (V2 dashboard system) ──────────────────────────────────
export {
  OperationalKPICard,
  InfoBanner,
  SectionHeader,
  OperationalSurface,
  AlertRow,
  ActivityRow,
  QuickActionRow,
  OperationalTable,
  RailSection,
  PriorityItem,
  DeadlineItem,
  HealthRow,
  HelpfulLink,
} from './primitives'

export type {
  OperationalVariant,
  OperationalKPICardProps,
  AlertRowProps,
  ActivityRowProps,
  QuickActionRowProps,
  OpsTableColumn,
  OpsTableProps,
  PriorityItemProps,
  DeadlineItemProps,
  HealthRowProps,
  HelpfulLinkProps,
} from './primitives'
