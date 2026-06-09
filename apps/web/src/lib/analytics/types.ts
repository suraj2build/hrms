/**
 * Analytics Studio — shared types and dataset catalog.
 * No external imports — pure TypeScript declarations.
 */

export type DatasetId   = 'payroll' | 'headcount' | 'attendance'
export type DimensionId = 'department' | 'employment_type' | 'time'
export type ChartTypeId = 'bar' | 'trend' | 'donut' | 'table' | 'heatmap'
export type TimeRangeId = 'current_month' | 'last_3m' | 'last_6m' | 'last_12m'

export type MeasureId =
  | 'gross_cost'
  | 'net_cost'
  | 'avg_salary'
  | 'headcount'
  | 'joiners'
  | 'exits'
  | 'net_change'
  | 'attendance_pct'
  | 'lop_days'

export interface AnalyticsQuery {
  dataset:   DatasetId
  dimension: DimensionId
  measure:   MeasureId
  timeRange: TimeRangeId
  chartType: ChartTypeId
}

export interface ChartSeries {
  name:   string
  color:  string
  values: number[]
}

export interface ChartData {
  labels:       string[]
  series:       ChartSeries[]
  format:       'currency' | 'percent' | 'number'
  measureLabel: string
  isEmpty:      boolean
}

export interface SavedView {
  id:      string
  name:    string
  query:   AnalyticsQuery
  savedAt: string
}

// ── Catalog ────────────────────────────────────────────────────────────────────

export interface MeasureOption {
  id:     MeasureId
  label:  string
  format: 'currency' | 'percent' | 'number'
}

export interface DimensionOption {
  id:       DimensionId
  label:    string
  measures: MeasureOption[]
}

export interface DatasetMeta {
  id:         DatasetId
  label:      string
  dimensions: DimensionOption[]
}

export const DATASET_CATALOG: DatasetMeta[] = [
  {
    id:    'payroll',
    label: 'Payroll',
    dimensions: [
      {
        id: 'department', label: 'Department',
        measures: [
          { id: 'gross_cost', label: 'Gross Cost',  format: 'currency' },
          { id: 'net_cost',   label: 'Net Cost',    format: 'currency' },
          { id: 'headcount',  label: 'Headcount',   format: 'number'   },
          { id: 'avg_salary', label: 'Avg Salary',  format: 'currency' },
        ],
      },
      {
        id: 'time', label: 'Over Time',
        measures: [
          { id: 'gross_cost', label: 'Gross Cost', format: 'currency' },
          { id: 'net_cost',   label: 'Net Cost',   format: 'currency' },
          { id: 'headcount',  label: 'Headcount',  format: 'number'   },
        ],
      },
    ],
  },
  {
    id:    'headcount',
    label: 'Headcount',
    dimensions: [
      {
        id: 'department', label: 'Department',
        measures: [
          { id: 'headcount', label: 'Active Headcount', format: 'number' },
          { id: 'joiners',   label: 'Joiners',          format: 'number' },
          { id: 'exits',     label: 'Exits',            format: 'number' },
        ],
      },
      {
        id: 'employment_type', label: 'Employment Type',
        measures: [
          { id: 'headcount', label: 'Headcount', format: 'number' },
        ],
      },
      {
        id: 'time', label: 'Over Time',
        measures: [
          { id: 'joiners',    label: 'Joiners',     format: 'number' },
          { id: 'exits',      label: 'Exits',       format: 'number' },
          { id: 'net_change', label: 'Net Change',  format: 'number' },
        ],
      },
    ],
  },
  {
    id:    'attendance',
    label: 'Attendance',
    dimensions: [
      {
        id: 'time', label: 'Over Time',
        measures: [
          { id: 'attendance_pct', label: 'Attendance Rate', format: 'percent' },
          { id: 'lop_days',       label: 'LOP Days',        format: 'number'  },
        ],
      },
    ],
  },
]

export const TIME_RANGES: Array<{ id: TimeRangeId; label: string }> = [
  { id: 'current_month', label: 'This Month'     },
  { id: 'last_3m',       label: 'Last 3 Months'  },
  { id: 'last_6m',       label: 'Last 6 Months'  },
  { id: 'last_12m',      label: 'Last 12 Months' },
]

export const DEFAULT_QUERY: AnalyticsQuery = {
  dataset:   'payroll',
  dimension: 'department',
  measure:   'gross_cost',
  timeRange: 'last_12m',
  chartType: 'trend',
}
