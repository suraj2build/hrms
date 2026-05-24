// ── Universal Master Import Framework — Template Definitions ─────────────────

export interface ColumnSpec {
  key: string
  label: string
  required: boolean
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum'
  enumValues?: string[]
  example: string
  description: string
}

export interface TemplateSpec {
  label: string
  columns: ColumnSpec[]
  sampleRows: Array<Record<string, string>>
}

export const MASTER_TEMPLATES: Record<string, TemplateSpec> = {
  employees: {
    label: 'Employees',
    columns: [
      {
        key: 'employee_code',
        label: 'Employee Code',
        required: true,
        type: 'string',
        example: 'EMP001',
        description: 'Unique identifier for the employee (e.g. EMP001). Will be uppercased.',
      },
      {
        key: 'first_name',
        label: 'First Name',
        required: true,
        type: 'string',
        example: 'Rahul',
        description: 'Employee first name.',
      },
      {
        key: 'last_name',
        label: 'Last Name',
        required: true,
        type: 'string',
        example: 'Sharma',
        description: 'Employee last name.',
      },
      {
        key: 'email',
        label: 'Email',
        required: true,
        type: 'string',
        example: 'rahul.sharma@company.com',
        description: 'Valid work email address. Will be lowercased.',
      },
      {
        key: 'phone',
        label: 'Phone',
        required: false,
        type: 'string',
        example: '9876543210',
        description: 'Contact phone number (optional).',
      },
      {
        key: 'joining_date',
        label: 'Joining Date',
        required: true,
        type: 'date',
        example: '2024-01-15',
        description: 'Date of joining in YYYY-MM-DD format.',
      },
      {
        key: 'employment_type',
        label: 'Employment Type',
        required: true,
        type: 'enum',
        enumValues: ['permanent', 'contract', 'intern', 'probation', 'consultant'],
        example: 'permanent',
        description: 'One of: permanent, contract, intern, probation, consultant.',
      },
      {
        key: 'status',
        label: 'Status',
        required: false,
        type: 'enum',
        enumValues: ['active', 'inactive'],
        example: 'active',
        description: 'Employee status. Defaults to active if blank.',
      },
      {
        key: 'department_code',
        label: 'Department Code',
        required: false,
        type: 'string',
        example: 'DEPT-ENG',
        description: 'Code of an existing department. Warning if not found.',
      },
      {
        key: 'designation_code',
        label: 'Designation Code',
        required: false,
        type: 'string',
        example: 'DESIG-SDE',
        description: 'Code of an existing designation. Warning if not found.',
      },
      {
        key: 'grade_code',
        label: 'Grade Code',
        required: false,
        type: 'string',
        example: 'GRADE-L3',
        description: 'Code of an existing grade (optional).',
      },
      {
        key: 'manager_employee_code',
        label: 'Manager Employee Code',
        required: false,
        type: 'string',
        example: 'EMP010',
        description: 'Employee code of the reporting manager (optional).',
      },
      {
        key: 'work_location_code',
        label: 'Work Location Code',
        required: false,
        type: 'string',
        example: 'LOC-BLR',
        description: 'Code of an existing work location (optional).',
      },
      {
        key: 'pan_number',
        label: 'PAN Number',
        required: false,
        type: 'string',
        example: 'ABCDE1234F',
        description: 'Permanent Account Number. Will be uppercased.',
      },
      {
        key: 'uan_number',
        label: 'UAN Number',
        required: false,
        type: 'string',
        example: '101234567890',
        description: 'Universal Account Number for PF (optional).',
      },
    ],
    sampleRows: [
      {
        employee_code: 'EMP001',
        first_name: 'Rahul',
        last_name: 'Sharma',
        email: 'rahul.sharma@company.com',
        phone: '9876543210',
        joining_date: '2024-01-15',
        employment_type: 'permanent',
        status: 'active',
        department_code: 'DEPT-ENG',
        designation_code: 'DESIG-SDE',
        grade_code: 'GRADE-L3',
        manager_employee_code: 'EMP010',
        work_location_code: 'LOC-BLR',
        pan_number: 'ABCDE1234F',
        uan_number: '101234567890',
      },
      {
        employee_code: 'EMP002',
        first_name: 'Priya',
        last_name: 'Nair',
        email: 'priya.nair@company.com',
        phone: '9123456789',
        joining_date: '2024-03-01',
        employment_type: 'contract',
        status: 'active',
        department_code: 'DEPT-HR',
        designation_code: 'DESIG-HRBP',
        grade_code: '',
        manager_employee_code: '',
        work_location_code: 'LOC-MUM',
        pan_number: '',
        uan_number: '',
      },
    ],
  },

  shifts: {
    label: 'Shifts',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'SHIFT-GEN',
        description: 'Unique code for the shift.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'General Shift',
        description: 'Display name of the shift.',
      },
      {
        key: 'start_time',
        label: 'Start Time (HH:MM)',
        required: true,
        type: 'string',
        example: '09:00',
        description: 'Shift start time in HH:MM (24-hour) format.',
      },
      {
        key: 'end_time',
        label: 'End Time (HH:MM)',
        required: true,
        type: 'string',
        example: '18:00',
        description: 'Shift end time in HH:MM (24-hour) format.',
      },
      {
        key: 'grace_minutes',
        label: 'Grace Minutes',
        required: false,
        type: 'number',
        example: '15',
        description: 'Late arrival grace period in minutes. Defaults to 0.',
      },
      {
        key: 'is_night_shift',
        label: 'Is Night Shift',
        required: false,
        type: 'boolean',
        example: 'false',
        description: 'true or false. Set true for overnight shifts.',
      },
      // NOTE: weekly_off_days removed from shift template.
      // Weekly-off days belong to Roster templates, not Shifts.
      // Configure weekly-off patterns using the Rosters CSV template instead.
    ],
    sampleRows: [
      {
        code: 'SHIFT-GEN',
        name: 'General Shift',
        start_time: '09:00',
        end_time: '18:00',
        grace_minutes: '15',
        is_night_shift: 'false',
      },
      {
        code: 'SHIFT-NIGHT',
        name: 'Night Shift',
        start_time: '22:00',
        end_time: '06:00',
        grace_minutes: '10',
        is_night_shift: 'true',
      },
    ],
  },

  departments: {
    label: 'Departments',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'DEPT-ENG',
        description: 'Unique department code.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Engineering',
        description: 'Department display name.',
      },
      {
        key: 'parent_code',
        label: 'Parent Department Code',
        required: false,
        type: 'string',
        example: 'DEPT-TECH',
        description: 'Code of the parent department for nested hierarchies (optional).',
      },
    ],
    sampleRows: [
      { code: 'DEPT-TECH', name: 'Technology', parent_code: '' },
      { code: 'DEPT-ENG', name: 'Engineering', parent_code: 'DEPT-TECH' },
    ],
  },

  designations: {
    label: 'Designations',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'DESIG-SDE',
        description: 'Unique designation code.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Software Development Engineer',
        description: 'Designation display name.',
      },
      {
        key: 'department_code',
        label: 'Department Code',
        required: false,
        type: 'string',
        example: 'DEPT-ENG',
        description: 'Associated department code (optional).',
      },
      {
        key: 'level',
        label: 'Level',
        required: false,
        type: 'string',
        example: 'L3',
        description: 'Designation level or band (optional).',
      },
    ],
    sampleRows: [
      { code: 'DESIG-SDE', name: 'Software Development Engineer', department_code: 'DEPT-ENG', level: 'L3' },
      { code: 'DESIG-HRBP', name: 'HR Business Partner', department_code: 'DEPT-HR', level: 'M1' },
    ],
  },

  work_locations: {
    label: 'Work Locations',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'LOC-BLR',
        description: 'Unique work location code.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Bengaluru Office',
        description: 'Work location display name.',
      },
      {
        key: 'city',
        label: 'City',
        required: false,
        type: 'string',
        example: 'Bengaluru',
        description: 'City name.',
      },
      {
        key: 'state',
        label: 'State',
        required: false,
        type: 'string',
        example: 'Karnataka',
        description: 'State name.',
      },
      {
        key: 'country',
        label: 'Country',
        required: false,
        type: 'string',
        example: 'India',
        description: 'Country name.',
      },
      {
        key: 'pincode',
        label: 'Pincode',
        required: false,
        type: 'string',
        example: '560001',
        description: 'Postal/PIN code.',
      },
    ],
    sampleRows: [
      { code: 'LOC-BLR', name: 'Bengaluru Office', city: 'Bengaluru', state: 'Karnataka', country: 'India', pincode: '560001' },
      { code: 'LOC-MUM', name: 'Mumbai Office', city: 'Mumbai', state: 'Maharashtra', country: 'India', pincode: '400001' },
    ],
  },

  cost_centers: {
    label: 'Cost Centers',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'CC-ENG',
        description: 'Unique cost center code.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Engineering Cost Center',
        description: 'Cost center display name.',
      },
      {
        key: 'description',
        label: 'Description',
        required: false,
        type: 'string',
        example: 'Covers all engineering teams',
        description: 'Optional description for the cost center.',
      },
    ],
    sampleRows: [
      { code: 'CC-ENG', name: 'Engineering Cost Center', description: 'Covers all engineering teams' },
      { code: 'CC-SALES', name: 'Sales Cost Center', description: 'Covers the sales function' },
    ],
  },

  salary_components: {
    label: 'Salary Components',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'SC-BASIC',
        description: 'Unique salary component code.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Basic Salary',
        description: 'Component display name.',
      },
      {
        key: 'component_type',
        label: 'Component Type',
        required: true,
        type: 'enum',
        enumValues: ['earning', 'deduction', 'employer_contribution'],
        example: 'earning',
        description: 'One of: earning, deduction, employer_contribution.',
      },
      {
        key: 'is_taxable',
        label: 'Is Taxable',
        required: false,
        type: 'boolean',
        example: 'true',
        description: 'true or false. Whether this component is taxable.',
      },
      {
        key: 'is_pf_applicable',
        label: 'Is PF Applicable',
        required: false,
        type: 'boolean',
        example: 'true',
        description: 'true or false. Whether PF is applicable on this component.',
      },
      {
        key: 'is_esi_applicable',
        label: 'Is ESI Applicable',
        required: false,
        type: 'boolean',
        example: 'false',
        description: 'true or false. Whether ESI is applicable on this component.',
      },
    ],
    sampleRows: [
      {
        code: 'SC-BASIC',
        name: 'Basic Salary',
        component_type: 'earning',
        is_taxable: 'true',
        is_pf_applicable: 'true',
        is_esi_applicable: 'false',
      },
      {
        code: 'SC-PF-EE',
        name: 'PF Employee Contribution',
        component_type: 'deduction',
        is_taxable: 'false',
        is_pf_applicable: 'true',
        is_esi_applicable: 'false',
      },
    ],
  },

  leave_types: {
    label: 'Leave Types',
    columns: [
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Annual Leave',
        description: 'Leave type name (must be unique within tenant).',
      },
      {
        key: 'is_paid',
        label: 'Is Paid',
        required: false,
        type: 'boolean',
        example: 'true',
        description: 'true or false. Whether the leave is paid.',
      },
      {
        key: 'allow_sandwich',
        label: 'Allow Sandwich',
        required: false,
        type: 'boolean',
        example: 'false',
        description: 'true or false. Whether weekends/holidays between leave days are counted.',
      },
    ],
    sampleRows: [
      { name: 'Annual Leave', is_paid: 'true', allow_sandwich: 'false' },
      { name: 'Sick Leave', is_paid: 'true', allow_sandwich: 'true' },
    ],
  },

  holiday_calendar: {
    label: 'Holiday Calendar',
    columns: [
      {
        key: 'date',
        label: 'Date (YYYY-MM-DD)',
        required: true,
        type: 'date',
        example: '2025-01-26',
        description: 'Holiday date in YYYY-MM-DD format.',
      },
      {
        key: 'name',
        label: 'Holiday Name',
        required: true,
        type: 'string',
        example: 'Republic Day',
        description: 'Name of the holiday.',
      },
      {
        key: 'holiday_type',
        label: 'Holiday Type',
        required: false,
        type: 'enum',
        enumValues: ['national', 'restricted', 'optional'],
        example: 'national',
        description: 'One of: national, restricted, optional.',
      },
    ],
    sampleRows: [
      { date: '2025-01-26', name: 'Republic Day', holiday_type: 'national' },
      { date: '2025-08-15', name: 'Independence Day', holiday_type: 'national' },
    ],
  },
}

// ── CSV Generation ────────────────────────────────────────────────────────────

function escapeCsvField(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export function generateCSV(masterType: string): string {
  const spec = MASTER_TEMPLATES[masterType]
  if (!spec) return ''

  const lines: string[] = []

  // Instruction comment row (not a real data row — starts with #)
  const instructions = [
    `# HRMS Import Template: ${spec.label}`,
    `# Fields marked * are required. Do not modify the header row.`,
    `# Date fields must be in YYYY-MM-DD format. Boolean fields: true or false.`,
    `# Remove this comment row and any extra blank rows before importing.`,
  ]
  lines.push(...instructions)

  // Description row
  const descRow = spec.columns.map((c) => escapeCsvField(c.description))
  lines.push(`# ${descRow.join(',')}`)

  // Header row — mark required columns with *
  const headerRow = spec.columns.map((c) =>
    escapeCsvField(c.required ? `${c.key} *` : c.key),
  )
  lines.push(headerRow.join(','))

  // Sample data rows
  for (const row of spec.sampleRows) {
    const dataRow = spec.columns.map((c) => escapeCsvField(row[c.key] ?? ''))
    lines.push(dataRow.join(','))
  }

  return lines.join('\n')
}

export function getTemplateSpec(masterType: string): TemplateSpec | null {
  return MASTER_TEMPLATES[masterType] ?? null
}
