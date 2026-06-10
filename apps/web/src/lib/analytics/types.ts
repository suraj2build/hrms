/**
 * Analytics Studio — shared types and dataset catalog.
 * No external imports — pure TypeScript declarations.
 */

export type DatasetId =
  | 'payroll'
  | 'headcount'
  | 'attendance'
  | 'employees'
  | 'leave'
  | 'compensation'
  | 'separation'

export type DimensionId =
  | 'department'
  | 'employment_type'
  | 'time'
  | 'location'
  | 'designation'
  | 'grade'
  | 'gender'
  | 'leave_type'
  | 'exit_type'

export type ChartTypeId = 'bar' | 'trend' | 'donut' | 'table' | 'heatmap'
export type TimeRangeId = 'current_month' | 'last_3m' | 'last_6m' | 'last_12m'

export type MeasureId =
  // Payroll
  | 'gross_cost'
  | 'net_cost'
  | 'avg_salary'
  // Headcount / employees
  | 'headcount'
  | 'joiners'
  | 'exits'
  | 'net_change'
  | 'avg_tenure_months'
  | 'on_probation'
  | 'confirmed'
  // Attendance
  | 'attendance_pct'
  | 'lop_days'
  // Leave
  | 'leave_days'
  | 'request_count'
  | 'avg_days_per_employee'
  // Compensation
  | 'total_ctc'
  | 'avg_ctc'
  // Separation
  | 'avg_notice_days'
  | 'avg_tenure_at_exit'

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
  labelIds?:    string[]   // UUIDs parallel to labels (for drill-through filter)
  series:       ChartSeries[]
  format:       'currency' | 'percent' | 'number'
  measureLabel: string
  isEmpty:      boolean
}

export interface DrillStep {
  dimensionId:    DimensionId
  dimensionValue: string  // UUID / key of the clicked segment
  dimensionLabel: string  // display name shown in breadcrumb
}

/** When drilling into dimension X, advance to this next dimension automatically */
export const DRILL_NEXT: Partial<Record<DimensionId, DimensionId>> = {
  department:      'designation',
  location:        'department',
  grade:           'designation',
  designation:     'grade',
  gender:          'department',
  employment_type: 'department',
  leave_type:      'department',
  exit_type:       'department',
}

/** Dimension → API filter param name */
export const DRILL_FILTER_PARAM: Partial<Record<DimensionId, string>> = {
  department:  'filter_department_id',
  location:    'filter_location_id',
  grade:       'filter_grade_id',
  designation: 'filter_designation_id',
  gender:      'filter_gender',
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
        id: 'location', label: 'Location',
        measures: [
          { id: 'gross_cost', label: 'Gross Cost', format: 'currency' },
          { id: 'net_cost',   label: 'Net Cost',   format: 'currency' },
          { id: 'headcount',  label: 'Headcount',  format: 'number'   },
        ],
      },
      {
        id: 'grade', label: 'Grade',
        measures: [
          { id: 'gross_cost', label: 'Gross Cost', format: 'currency' },
          { id: 'avg_salary', label: 'Avg Salary', format: 'currency' },
        ],
      },
      {
        id: 'designation', label: 'Designation',
        measures: [
          { id: 'gross_cost', label: 'Gross Cost', format: 'currency' },
          { id: 'headcount',  label: 'Headcount',  format: 'number'   },
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
        id: 'location', label: 'Location',
        measures: [
          { id: 'headcount', label: 'Headcount', format: 'number' },
          { id: 'joiners',   label: 'Joiners',   format: 'number' },
        ],
      },
      {
        id: 'grade', label: 'Grade',
        measures: [
          { id: 'headcount', label: 'Headcount', format: 'number' },
        ],
      },
      {
        id: 'gender', label: 'Gender',
        measures: [
          { id: 'headcount', label: 'Headcount', format: 'number' },
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
  // ── R3.1 New datasets ──────────────────────────────────────────────────────
  {
    id:    'employees',
    label: 'People',
    dimensions: [
      {
        id: 'department', label: 'Department',
        measures: [
          { id: 'headcount',         label: 'Headcount',        format: 'number' },
          { id: 'joiners',           label: 'New Joiners',      format: 'number' },
          { id: 'avg_tenure_months', label: 'Avg Tenure (mo.)', format: 'number' },
          { id: 'on_probation',      label: 'On Probation',     format: 'number' },
        ],
      },
      {
        id: 'location', label: 'Location',
        measures: [
          { id: 'headcount', label: 'Headcount',   format: 'number' },
          { id: 'joiners',   label: 'New Joiners', format: 'number' },
        ],
      },
      {
        id: 'designation', label: 'Designation',
        measures: [
          { id: 'headcount',         label: 'Headcount',        format: 'number' },
          { id: 'avg_tenure_months', label: 'Avg Tenure (mo.)', format: 'number' },
        ],
      },
      {
        id: 'grade', label: 'Grade',
        measures: [
          { id: 'headcount',    label: 'Headcount',    format: 'number' },
          { id: 'confirmed',    label: 'Confirmed',    format: 'number' },
          { id: 'on_probation', label: 'On Probation', format: 'number' },
        ],
      },
      {
        id: 'gender', label: 'Gender',
        measures: [
          { id: 'headcount', label: 'Headcount', format: 'number' },
        ],
      },
      {
        id: 'employment_type', label: 'Employment Type',
        measures: [
          { id: 'headcount', label: 'Headcount', format: 'number' },
        ],
      },
    ],
  },
  {
    id:    'leave',
    label: 'Leave',
    dimensions: [
      {
        id: 'leave_type', label: 'Leave Type',
        measures: [
          { id: 'leave_days',            label: 'Total Days',          format: 'number' },
          { id: 'request_count',         label: 'No. of Requests',     format: 'number' },
          { id: 'avg_days_per_employee', label: 'Avg Days / Employee', format: 'number' },
        ],
      },
      {
        id: 'department', label: 'Department',
        measures: [
          { id: 'leave_days',    label: 'Total Days',      format: 'number' },
          { id: 'request_count', label: 'No. of Requests', format: 'number' },
        ],
      },
      {
        id: 'employment_type', label: 'Employment Type',
        measures: [
          { id: 'leave_days', label: 'Total Days', format: 'number' },
        ],
      },
    ],
  },
  {
    id:    'compensation',
    label: 'Compensation',
    dimensions: [
      {
        id: 'department', label: 'Department',
        measures: [
          { id: 'total_ctc', label: 'Total CTC',   format: 'currency' },
          { id: 'avg_ctc',   label: 'Average CTC', format: 'currency' },
          { id: 'headcount', label: 'Headcount',   format: 'number'   },
        ],
      },
      {
        id: 'grade', label: 'Grade',
        measures: [
          { id: 'total_ctc', label: 'Total CTC',   format: 'currency' },
          { id: 'avg_ctc',   label: 'Average CTC', format: 'currency' },
        ],
      },
      {
        id: 'designation', label: 'Designation',
        measures: [
          { id: 'avg_ctc',   label: 'Average CTC', format: 'currency' },
          { id: 'headcount', label: 'Headcount',   format: 'number'   },
        ],
      },
      {
        id: 'location', label: 'Location',
        measures: [
          { id: 'total_ctc', label: 'Total CTC',   format: 'currency' },
          { id: 'avg_ctc',   label: 'Average CTC', format: 'currency' },
        ],
      },
    ],
  },
  {
    id:    'separation',
    label: 'Separation',
    dimensions: [
      {
        id: 'exit_type', label: 'Exit Type',
        measures: [
          { id: 'exits',             label: 'Exits',               format: 'number' },
          { id: 'avg_notice_days',   label: 'Avg Notice Days',     format: 'number' },
          { id: 'avg_tenure_at_exit', label: 'Avg Tenure at Exit (mo.)', format: 'number' },
        ],
      },
      {
        id: 'department', label: 'Department',
        measures: [
          { id: 'exits',           label: 'Exits',           format: 'number' },
          { id: 'avg_notice_days', label: 'Avg Notice Days', format: 'number' },
        ],
      },
      {
        id: 'location', label: 'Location',
        measures: [
          { id: 'exits', label: 'Exits', format: 'number' },
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
