/**
 * Data Explorer — surface configuration (metadata-driven).
 *
 * Each surface maps to a CANONICAL dataset endpoint (no duplicate APIs).
 * Dimensions drive the endpoint's `group_by`; metric columns map to fields the
 * canonical response already returns. The drill chain reuses the R3.3 filter_*
 * params. No business logic lives here — only presentation metadata.
 */

export type SurfaceId =
  | 'people'
  | 'payroll'
  | 'attendance'
  | 'leave'
  | 'separation'
  | 'assets'

export type MetricFormat = 'number' | 'currency' | 'percent'

/** How a surface's date window maps to API params */
export type ParamStyle = 'from_to' | 'month' | 'none'

export interface MetricCol {
  id:     string          // field name in the canonical row
  label:  string
  format: MetricFormat
}

export interface ExplorerDimension {
  id:           string    // value for ?group_by=
  label:        string
  /** API param name to pass this dimension's value as a drill filter (if drillable) */
  filterParam?: string
  /** Which canonical array key holds the rows for this dimension */
  rowsKey:      'by_group' | 'by_department'
  /** Field on each row that holds the group's id/key */
  keyField:     string
  /** Field on each row that holds the display label */
  labelField:   string
}

export interface SurfaceConfig {
  id:          SurfaceId
  label:       string
  endpoint:    string          // canonical dataset endpoint
  paramStyle:  ParamStyle
  dimensions:  ExplorerDimension[]
  metrics:     MetricCol[]
  /** ordered drill chain of dimension ids; last step → employee list (if supported) */
  drillChain:  string[]
  /** whether the terminal drill resolves to an employee list via /employees */
  drillToEmployees: boolean
}

// Common dimension factories ----------------------------------------------------

const byGroup = (id: string, label: string, filterParam?: string): ExplorerDimension => ({
  id, label, filterParam, rowsKey: 'by_group', keyField: 'key', labelField: 'label',
})

const byDept = (filterParam = 'filter_department_id'): ExplorerDimension => ({
  id: 'department', label: 'Department', filterParam,
  rowsKey: 'by_department', keyField: 'department_id', labelField: 'name',
})

export const SURFACES: SurfaceConfig[] = [
  {
    id: 'people', label: 'People', endpoint: '/datasets/employees', paramStyle: 'from_to',
    dimensions: [
      byGroup('department',      'Department',      'filter_department_id'),
      byGroup('location',        'Location',        'filter_location_id'),
      byGroup('designation',     'Designation',     'filter_designation_id'),
      byGroup('grade',           'Grade',           'filter_grade_id'),
      byGroup('gender',          'Gender',          'filter_gender'),
      byGroup('employment_type', 'Employment Type'),
    ],
    metrics: [
      { id: 'headcount',         label: 'Headcount',        format: 'number' },
      { id: 'new_joiners',       label: 'New Joiners',      format: 'number' },
      { id: 'confirmed',         label: 'Confirmed',        format: 'number' },
      { id: 'on_probation',      label: 'On Probation',     format: 'number' },
      { id: 'avg_tenure_months', label: 'Avg Tenure (mo.)', format: 'number' },
    ],
    drillChain: ['department', 'designation'],
    drillToEmployees: true,
  },
  {
    id: 'payroll', label: 'Payroll', endpoint: '/datasets/payroll-cost', paramStyle: 'month',
    dimensions: [
      byDept('filter_department_id'),
      byGroup('location',    'Location',    'filter_location_id'),
      byGroup('grade',       'Grade',       'filter_grade_id'),
      byGroup('designation', 'Designation', 'filter_designation_id'),
    ],
    metrics: [
      { id: 'headcount',      label: 'Headcount',   format: 'number'   },
      { id: 'gross',          label: 'Gross Cost',  format: 'currency' },
      { id: 'net',            label: 'Net Cost',    format: 'currency' },
      { id: 'cost_share_pct', label: 'Cost Share',  format: 'percent'  },
    ],
    drillChain: ['department', 'designation'],
    drillToEmployees: true,
  },
  {
    id: 'attendance', label: 'Attendance', endpoint: '/datasets/attendance', paramStyle: 'month',
    dimensions: [
      // attendance by_department rows use {key,label} (not {department_id,name})
      { id: 'department', label: 'Department', filterParam: 'filter_department_id',
        rowsKey: 'by_department', keyField: 'key', labelField: 'label' },
    ],
    metrics: [
      { id: 'employee_count',      label: 'Employees',     format: 'number'  },
      { id: 'avg_attendance_rate', label: 'Attendance %',  format: 'percent' },
      { id: 'absenteeism_pct',     label: 'Absenteeism %', format: 'percent' },
      { id: 'total_absent_days',   label: 'Absent Days',   format: 'number'  },
      { id: 'total_lop_days',      label: 'LOP Days',      format: 'number'  },
    ],
    drillChain: ['department'],
    drillToEmployees: true,
  },
  {
    id: 'leave', label: 'Leave', endpoint: '/datasets/leave', paramStyle: 'from_to',
    dimensions: [
      byGroup('leave_type',      'Leave Type'),
      byGroup('department',      'Department',      'filter_department_id'),
      byGroup('employment_type', 'Employment Type'),
    ],
    metrics: [
      { id: 'total_days',            label: 'Total Days',          format: 'number' },
      { id: 'request_count',         label: 'Requests',            format: 'number' },
      { id: 'unique_employees',      label: 'Employees',           format: 'number' },
      { id: 'avg_days_per_employee', label: 'Avg Days / Employee', format: 'number' },
    ],
    drillChain: ['department'],
    drillToEmployees: true,
  },
  {
    id: 'separation', label: 'Separation', endpoint: '/datasets/separation', paramStyle: 'from_to',
    dimensions: [
      byGroup('exit_type',  'Exit Type'),
      byGroup('department', 'Department', 'filter_department_id'),
      byGroup('location',   'Location',   'filter_location_id'),
    ],
    metrics: [
      { id: 'exits',                     label: 'Exits',                  format: 'number' },
      { id: 'avg_notice_days',           label: 'Avg Notice Days',        format: 'number' },
      { id: 'avg_tenure_at_exit_months', label: 'Avg Tenure at Exit',     format: 'number' },
    ],
    drillChain: ['department'],
    drillToEmployees: false,
  },
  {
    id: 'assets', label: 'Assets', endpoint: '/datasets/assets', paramStyle: 'none',
    dimensions: [
      byGroup('status',   'Status',   'filter_status'),
      byGroup('category', 'Category', 'filter_category_id'),
    ],
    metrics: [
      { id: 'asset_count',     label: 'Assets',       format: 'number'   },
      { id: 'total_value',     label: 'Total Value',  format: 'currency' },
      { id: 'avg_value',       label: 'Avg Value',    format: 'currency' },
      { id: 'assigned_count',  label: 'Assigned',     format: 'number'   },
      { id: 'utilisation_pct', label: 'Utilisation',  format: 'percent'  },
    ],
    drillChain: ['category', 'status'],
    drillToEmployees: false,
  },
]

export const DATE_RANGES = [
  { id: 'current_month', label: 'This Month'     },
  { id: 'last_3m',       label: 'Last 3 Months'  },
  { id: 'last_6m',       label: 'Last 6 Months'  },
  { id: 'last_12m',      label: 'Last 12 Months' },
] as const

export type DateRangeId = typeof DATE_RANGES[number]['id']

export type SummaryStat = 'count' | 'sum' | 'average' | 'median' | 'percentage'

export const SUMMARY_STATS: Array<{ id: SummaryStat; label: string }> = [
  { id: 'count',      label: 'Count'      },
  { id: 'sum',        label: 'Sum'        },
  { id: 'average',    label: 'Average'    },
  { id: 'median',     label: 'Median'     },
  { id: 'percentage', label: 'Percentage' },
]
