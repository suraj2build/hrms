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

  rosters: {
    label: 'Rosters (Weekly-Off Policies)',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'ROSTER-STD',
        description: 'Unique code for the roster / weekly-off policy.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Standard 5-Day Week',
        description: 'Display name of the roster policy.',
      },
      {
        key: 'description',
        label: 'Description',
        required: false,
        type: 'string',
        example: 'Mon-Fri working, weekend off',
        description: 'Optional description of the policy.',
      },
      {
        key: 'cycle_days',
        label: 'Cycle Days',
        required: false,
        type: 'enum',
        enumValues: ['7', '14', '28'],
        example: '7',
        description: 'Length of the repeating cycle: 7, 14 or 28 days. Defaults to 7.',
      },
      {
        key: 'weekly_off_days',
        label: 'Weekly Off Days',
        required: false,
        type: 'string',
        example: 'Sun,Sat',
        description: 'Comma-separated weekly-off days. Use names (Sun,Mon,Tue,Wed,Thu,Fri,Sat) or numbers (0=Sun … 6=Sat).',
      },
      {
        key: 'is_active',
        label: 'Is Active',
        required: false,
        type: 'boolean',
        example: 'true',
        description: 'true or false. Defaults to true.',
      },
    ],
    sampleRows: [
      {
        code: 'ROSTER-STD',
        name: 'Standard 5-Day Week',
        description: 'Mon-Fri working, weekend off',
        cycle_days: '7',
        weekly_off_days: 'Sun,Sat',
        is_active: 'true',
      },
      {
        code: 'ROSTER-6DAY',
        name: '6-Day Week (Sunday Off)',
        description: 'Mon-Sat working, Sunday off',
        cycle_days: '7',
        weekly_off_days: 'Sun',
        is_active: 'true',
      },
    ],
  },

  employee_bank_details: {
    label: 'Employee Bank & Statutory',
    columns: [
      {
        key: 'employee_code',
        label: 'Employee Code',
        required: true,
        type: 'string',
        example: 'EMP001',
        description: 'Existing employee code to attach bank/statutory details to.',
      },
      {
        key: 'bank_name',
        label: 'Bank Name',
        required: false,
        type: 'string',
        example: 'HDFC Bank',
        description: 'Name of the bank.',
      },
      {
        key: 'account_number',
        label: 'Account Number',
        required: false,
        type: 'string',
        example: '50100123456789',
        description: 'Salary account number.',
      },
      {
        key: 'ifsc_code',
        label: 'IFSC Code',
        required: false,
        type: 'string',
        example: 'HDFC0001234',
        description: '11-character IFSC of the branch.',
      },
      {
        key: 'branch_name',
        label: 'Branch Name',
        required: false,
        type: 'string',
        example: 'MG Road, Bengaluru',
        description: 'Branch where the account is held.',
      },
      {
        key: 'account_type',
        label: 'Account Type',
        required: false,
        type: 'enum',
        enumValues: ['savings', 'current', 'salary'],
        example: 'salary',
        description: 'savings, current or salary.',
      },
      {
        key: 'pan_number',
        label: 'PAN Number',
        required: false,
        type: 'string',
        example: 'ABCDE1234F',
        description: '10-character income-tax PAN.',
      },
      {
        key: 'uan_number',
        label: 'UAN Number',
        required: false,
        type: 'string',
        example: '100123456789',
        description: '12-digit EPFO Universal Account Number.',
      },
      {
        key: 'pf_number',
        label: 'PF Number',
        required: false,
        type: 'string',
        example: 'KN/BNG/0012345/000/0001234',
        description: 'EPF member ID, if applicable.',
      },
      {
        key: 'esi_number',
        label: 'ESI Number',
        required: false,
        type: 'string',
        example: '1234567890',
        description: '17-digit ESIC insurance number, if applicable.',
      },
      {
        key: 'tax_regime',
        label: 'Tax Regime',
        required: false,
        type: 'enum',
        enumValues: ['old', 'new'],
        example: 'new',
        description: 'Income-tax regime: old or new.',
      },
    ],
    sampleRows: [
      {
        employee_code: 'EMP001',
        bank_name: 'HDFC Bank',
        account_number: '50100123456789',
        ifsc_code: 'HDFC0001234',
        branch_name: 'MG Road, Bengaluru',
        account_type: 'salary',
        pan_number: 'ABCDE1234F',
        uan_number: '100123456789',
        pf_number: '',
        esi_number: '',
        tax_regime: 'new',
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

  sites: {
    label: 'Sites',
    columns: [
      // ── Identity ──────────────────────────────────────────────────────────
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'SITE-BLR',
        description: 'Unique site code used as a reference key for work locations.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Bengaluru Campus',
        description: 'Site display name.',
      },
      {
        key: 'short_name',
        label: 'Short Name',
        required: false,
        type: 'string',
        example: 'BLR',
        description: 'Short label/abbreviation for compact displays (optional).',
      },
      {
        key: 'site_type',
        label: 'Site Type',
        required: false,
        type: 'string',
        example: 'branch',
        description: 'head_office | branch | regional_office | warehouse | factory | retail_store | project_site.',
      },
      {
        key: 'status',
        label: 'Status',
        required: false,
        type: 'enum',
        enumValues: ['active', 'inactive'],
        example: 'active',
        description: 'Site lifecycle status. Defaults to active if blank.',
      },
      {
        key: 'opening_date',
        label: 'Opening Date (YYYY-MM-DD)',
        required: false,
        type: 'date',
        example: '2024-04-01',
        description: 'Date the site became operational (optional).',
      },
      // ── Grouping references (resolved from the related masters by code) ─────
      {
        key: 'state_code',
        label: 'State (GST) Code',
        required: false,
        type: 'string',
        example: '29',
        description: 'GST state code from the States master. Resolves to the statutory state link.',
      },
      {
        key: 'cluster_code',
        label: 'Cluster Code',
        required: false,
        type: 'string',
        example: 'CL-BLR-S',
        description: 'Code from the Clusters master (operational Region → Cluster → Site axis).',
      },
      {
        key: 'cost_center_code',
        label: 'Cost Center Code',
        required: false,
        type: 'string',
        example: 'CC-ENG',
        description: 'Code from the Cost Centers master to link this site to (optional).',
      },
      {
        key: 'parent_site_code',
        label: 'Parent Site Code',
        required: false,
        type: 'string',
        example: 'SITE-HO',
        description: 'Code of an existing site to nest this site under (optional).',
      },
      {
        key: 'region',
        label: 'Region',
        required: false,
        type: 'string',
        example: 'South',
        description: 'Free-text region grouping for roll-up reporting (optional).',
      },
      {
        key: 'zone',
        label: 'Zone',
        required: false,
        type: 'string',
        example: 'Zone 1',
        description: 'Free-text zone grouping for roll-up reporting (optional).',
      },
      // ── Address & geography ───────────────────────────────────────────────
      {
        key: 'location',
        label: 'Location',
        required: false,
        type: 'string',
        example: 'Bengaluru, Karnataka',
        description: 'City/region for display purposes.',
      },
      {
        key: 'address_line1',
        label: 'Address Line 1',
        required: false,
        type: 'string',
        example: '12 MG Road',
        description: 'First line of the postal address (optional).',
      },
      {
        key: 'address_line2',
        label: 'Address Line 2',
        required: false,
        type: 'string',
        example: 'Near Trinity Circle',
        description: 'Second line of the postal address (optional).',
      },
      {
        key: 'city',
        label: 'City',
        required: false,
        type: 'string',
        example: 'Bengaluru',
        description: 'City the site is located in (optional).',
      },
      {
        key: 'district',
        label: 'District',
        required: false,
        type: 'string',
        example: 'Bengaluru Urban',
        description: 'District / sub-region (optional).',
      },
      {
        key: 'pincode',
        label: 'Pincode',
        required: false,
        type: 'string',
        example: '560001',
        description: 'Postal PIN code (optional).',
      },
      {
        key: 'country',
        label: 'Country',
        required: false,
        type: 'string',
        example: 'India',
        description: 'Country name (optional).',
      },
      {
        key: 'timezone',
        label: 'Timezone',
        required: false,
        type: 'string',
        example: 'Asia/Kolkata',
        description: 'IANA timezone name. Defaults to Asia/Kolkata.',
      },
      {
        key: 'latitude',
        label: 'Latitude',
        required: false,
        type: 'number',
        example: '12.9716',
        description: 'Geo latitude in decimal degrees (-90 to 90) for geofencing (optional).',
      },
      {
        key: 'longitude',
        label: 'Longitude',
        required: false,
        type: 'number',
        example: '77.5946',
        description: 'Geo longitude in decimal degrees (-180 to 180) for geofencing (optional).',
      },
      {
        key: 'geofence_radius_m',
        label: 'Geofence Radius (m)',
        required: false,
        type: 'number',
        example: '200',
        description: 'Attendance geofence radius in metres (optional).',
      },
      // ── India statutory registration IDs ──────────────────────────────────
      {
        key: 'gstin',
        label: 'GSTIN',
        required: false,
        type: 'string',
        example: '29ABCDE1234F1Z5',
        description: 'GST Identification Number for this site (optional).',
      },
      {
        key: 'pf_registration_no',
        label: 'PF Registration No.',
        required: false,
        type: 'string',
        example: 'KN/BNG/0012345/000',
        description: 'EPF establishment registration number (optional).',
      },
      {
        key: 'esi_registration_no',
        label: 'ESI Registration No.',
        required: false,
        type: 'string',
        example: '53000123450000999',
        description: 'ESIC registration number (optional).',
      },
      {
        key: 'pt_registration_no',
        label: 'PT Registration No.',
        required: false,
        type: 'string',
        example: 'PT-29-0012345',
        description: 'Professional Tax registration number (optional).',
      },
      {
        key: 'lwf_registration_no',
        label: 'LWF Registration No.',
        required: false,
        type: 'string',
        example: 'LWF-KA-987654',
        description: 'Labour Welfare Fund registration number (optional).',
      },
      {
        key: 'shops_estab_reg_no',
        label: 'Shops & Estab. Reg. No.',
        required: false,
        type: 'string',
        example: 'SE/BLR/2024/12345',
        description: 'Shops & Establishment registration number (optional).',
      },
      {
        key: 'factory_license_no',
        label: 'Factory License No.',
        required: false,
        type: 'string',
        example: 'FL/KA/2024/0099',
        description: 'Factory licence number, for factory sites (optional).',
      },
      // ── Operations ────────────────────────────────────────────────────────
      {
        key: 'contact_person',
        label: 'Contact Person',
        required: false,
        type: 'string',
        example: 'Anita Rao',
        description: 'Primary site contact name (optional).',
      },
      {
        key: 'contact_phone',
        label: 'Contact Phone',
        required: false,
        type: 'string',
        example: '9876543210',
        description: 'Primary site contact phone (optional).',
      },
      {
        key: 'contact_email',
        label: 'Contact Email',
        required: false,
        type: 'string',
        example: 'blr.facility@company.com',
        description: 'Primary site contact email (optional).',
      },
      {
        key: 'sanctioned_headcount',
        label: 'Sanctioned Headcount',
        required: false,
        type: 'number',
        example: '150',
        description: 'Budgeted/sanctioned headcount for this site (optional).',
      },
    ],
    sampleRows: [
      {
        code: 'SITE-BLR', name: 'Bengaluru Campus', short_name: 'BLR', site_type: 'branch', status: 'active', opening_date: '2024-04-01',
        state_code: '29', cluster_code: 'CL-BLR-S', cost_center_code: 'CC-ENG', parent_site_code: '', region: 'South', zone: 'Zone 1',
        location: 'Bengaluru, Karnataka', address_line1: '12 MG Road', address_line2: 'Near Trinity Circle', city: 'Bengaluru', district: 'Bengaluru Urban', pincode: '560001', country: 'India', timezone: 'Asia/Kolkata',
        latitude: '12.9716', longitude: '77.5946', geofence_radius_m: '200',
        gstin: '29ABCDE1234F1Z5', pf_registration_no: 'KN/BNG/0012345/000', esi_registration_no: '53000123450000999', pt_registration_no: 'PT-29-0012345', lwf_registration_no: 'LWF-KA-987654', shops_estab_reg_no: 'SE/BLR/2024/12345', factory_license_no: '',
        contact_person: 'Anita Rao', contact_phone: '9876543210', contact_email: 'blr.facility@company.com', sanctioned_headcount: '150',
      },
      {
        code: 'SITE-MUM', name: 'Mumbai Office', short_name: 'MUM', site_type: 'head_office', status: 'active', opening_date: '',
        state_code: '27', cluster_code: '', cost_center_code: '', parent_site_code: '', region: 'West', zone: '',
        location: 'Mumbai, Maharashtra', address_line1: '', address_line2: '', city: 'Mumbai', district: '', pincode: '400001', country: 'India', timezone: 'Asia/Kolkata',
        latitude: '', longitude: '', geofence_radius_m: '',
        gstin: '', pf_registration_no: '', esi_registration_no: '', pt_registration_no: '', lwf_registration_no: '', shops_estab_reg_no: '', factory_license_no: '',
        contact_person: '', contact_phone: '', contact_email: '', sanctioned_headcount: '',
      },
    ],
  },

  states: {
    label: 'States',
    columns: [
      {
        key: 'code',
        label: 'GST State Code',
        required: true,
        type: 'string',
        example: '29',
        description: 'Two-digit GST (TIN) state code. Unique per organisation.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Karnataka',
        description: 'State / UT name.',
      },
      {
        key: 'region',
        label: 'Region',
        required: false,
        type: 'string',
        example: 'South',
        description: 'Free-text region grouping (optional).',
      },
      {
        key: 'pt_applicable',
        label: 'PT Applicable',
        required: false,
        type: 'boolean',
        example: 'true',
        description: 'Whether Professional Tax is levied in this state.',
      },
      {
        key: 'lwf_applicable',
        label: 'LWF Applicable',
        required: false,
        type: 'boolean',
        example: 'true',
        description: 'Whether Labour Welfare Fund contributions apply.',
      },
      {
        key: 'lwf_frequency',
        label: 'LWF Frequency',
        required: false,
        type: 'enum',
        enumValues: ['monthly', 'half_yearly', 'annual'],
        example: 'annual',
        description: 'LWF contribution frequency, if applicable.',
      },
    ],
    sampleRows: [
      { code: '29', name: 'Karnataka',   region: 'South', pt_applicable: 'true',  lwf_applicable: 'true',  lwf_frequency: 'annual' },
      { code: '07', name: 'Delhi',       region: 'North', pt_applicable: 'false', lwf_applicable: 'false', lwf_frequency: '' },
    ],
  },

  clusters: {
    label: 'Clusters',
    columns: [
      {
        key: 'code',
        label: 'Code',
        required: true,
        type: 'string',
        example: 'CL-BLR-S',
        description: 'Unique cluster code.',
      },
      {
        key: 'name',
        label: 'Name',
        required: true,
        type: 'string',
        example: 'Bengaluru South',
        description: 'Cluster display name.',
      },
      {
        key: 'region',
        label: 'Region',
        required: false,
        type: 'string',
        example: 'South',
        description: 'Free-text region for roll-ups (optional).',
      },
      {
        key: 'parent_code',
        label: 'Parent Cluster Code',
        required: false,
        type: 'string',
        example: 'CL-KA',
        description: 'Code of the parent cluster for multi-level grouping (optional).',
      },
      {
        key: 'manager_code',
        label: 'Cluster Manager (Employee Code)',
        required: false,
        type: 'string',
        example: 'EMP-1042',
        description: 'Employee code of the cluster/area manager (optional).',
      },
      {
        key: 'description',
        label: 'Description',
        required: false,
        type: 'string',
        example: 'South Bengaluru retail cluster',
        description: 'Free-text notes (optional).',
      },
    ],
    sampleRows: [
      { code: 'CL-KA',    name: 'Karnataka',       region: 'South', parent_code: '',      manager_code: '',         description: '' },
      { code: 'CL-BLR-S', name: 'Bengaluru South', region: 'South', parent_code: 'CL-KA', manager_code: 'EMP-1042', description: 'South Bengaluru retail cluster' },
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
        key: 'site_code',
        label: 'Site Code',
        required: false,
        type: 'string',
        example: 'SITE-BLR',
        description: 'Code of an existing site to link this work location to. Must match the code of a site already created in your organisation.',
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
      { code: 'LOC-BLR', name: 'Bengaluru Office', site_code: 'SITE-BLR', city: 'Bengaluru', state: 'Karnataka', country: 'India', pincode: '560001' },
      { code: 'LOC-MUM', name: 'Mumbai Office',    site_code: 'SITE-MUM', city: 'Mumbai',    state: 'Maharashtra', country: 'India', pincode: '400001' },
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

  // ── Enterprise onboarding imports ──────────────────────────────────────────

  employee_compensation: {
    label: 'Employee Compensation',
    columns: [
      {
        key: 'employee_code',
        label: 'Employee Code',
        required: true,
        type: 'string',
        example: 'EMP001',
        description: 'Employee code of an existing employee.',
      },
      {
        key: 'effective_from',
        label: 'Effective From (YYYY-MM-DD)',
        required: true,
        type: 'date',
        example: '2025-04-01',
        description: 'Date from which this compensation is effective (YYYY-MM-DD).',
      },
      {
        key: 'ctc_annual',
        label: 'CTC Annual',
        required: true,
        type: 'number',
        example: '600000',
        description: 'Annual Cost-to-Company in rupees (numeric, no commas).',
      },
      {
        key: 'salary_structure_code',
        label: 'Salary Structure Code',
        required: false,
        type: 'string',
        example: 'SS-DEFAULT',
        description: 'Code of an existing salary structure. Uses tenant default if blank.',
      },
      {
        key: 'notes',
        label: 'Notes',
        required: false,
        type: 'string',
        example: 'Annual revision FY2025',
        description: 'Optional notes about this compensation revision.',
      },
    ],
    sampleRows: [
      {
        employee_code: 'EMP001',
        effective_from: '2025-04-01',
        ctc_annual: '600000',
        salary_structure_code: 'SS-DEFAULT',
        notes: 'Annual revision FY2025',
      },
      {
        employee_code: 'EMP002',
        effective_from: '2025-04-01',
        ctc_annual: '480000',
        salary_structure_code: '',
        notes: '',
      },
    ],
  },

  leave_opening_balances: {
    label: 'Leave Opening Balances',
    columns: [
      {
        key: 'employee_code',
        label: 'Employee Code',
        required: true,
        type: 'string',
        example: 'EMP001',
        description: 'Employee code of an existing employee.',
      },
      {
        key: 'leave_type_name',
        label: 'Leave Type Name',
        required: true,
        type: 'string',
        example: 'Annual Leave',
        description: 'Exact name of an existing leave type.',
      },
      {
        key: 'balance',
        label: 'Balance (days)',
        required: true,
        type: 'number',
        example: '12',
        description: 'Opening balance in days (can be decimal, e.g. 0.5).',
      },
      {
        key: 'year',
        label: 'Year',
        required: false,
        type: 'number',
        example: '2025',
        description: 'Calendar year for this balance. Defaults to current year.',
      },
      {
        key: 'carry_forward_balance',
        label: 'Carry Forward Balance (days)',
        required: false,
        type: 'number',
        example: '3',
        description: 'Days carried forward from the previous year (optional, defaults to 0).',
      },
    ],
    sampleRows: [
      {
        employee_code: 'EMP001',
        leave_type_name: 'Annual Leave',
        balance: '12',
        year: '2025',
        carry_forward_balance: '3',
      },
      {
        employee_code: 'EMP001',
        leave_type_name: 'Sick Leave',
        balance: '6',
        year: '2025',
        carry_forward_balance: '0',
      },
    ],
  },

  shift_assignments: {
    label: 'Shift Assignments',
    columns: [
      {
        key: 'employee_code',
        label: 'Employee Code',
        required: true,
        type: 'string',
        example: 'EMP001',
        description: 'Employee code of an existing employee.',
      },
      {
        key: 'shift_code',
        label: 'Shift Code',
        required: true,
        type: 'string',
        example: 'SHIFT-GEN',
        description: 'Code of an existing shift.',
      },
      {
        key: 'effective_from',
        label: 'Effective From (YYYY-MM-DD)',
        required: true,
        type: 'date',
        example: '2025-04-01',
        description: 'Date from which this shift assignment takes effect (YYYY-MM-DD).',
      },
    ],
    sampleRows: [
      {
        employee_code: 'EMP001',
        shift_code: 'SHIFT-GEN',
        effective_from: '2025-04-01',
      },
      {
        employee_code: 'EMP002',
        shift_code: 'SHIFT-NIGHT',
        effective_from: '2025-04-01',
      },
    ],
  },

  // ── Enterprise Operational Masters ─────────────────────────────────────────

  grades: {
    label: 'Grades / Bands',
    columns: [
      { key: 'code',           label: 'Code',              required: true,  type: 'string', example: 'GRADE-L1',  description: 'Unique grade/band code. Will be uppercased.' },
      { key: 'name',           label: 'Name',              required: true,  type: 'string', example: 'Level 1',   description: 'Display name for the grade.' },
      { key: 'description',    label: 'Description',       required: false, type: 'string', example: 'Junior IC', description: 'Optional description of the grade.' },
      { key: 'level_order',    label: 'Level Order',       required: false, type: 'number', example: '1',         description: 'Numeric order for sorting grades (lower = junior).' },
      { key: 'ctc_min_annual', label: 'Min CTC (Annual)',  required: false, type: 'number', example: '300000',    description: 'Minimum annual CTC for this grade (optional).' },
      { key: 'ctc_max_annual', label: 'Max CTC (Annual)',  required: false, type: 'number', example: '600000',    description: 'Maximum annual CTC for this grade (optional).' },
    ],
    sampleRows: [
      { code: 'GRADE-L1', name: 'Level 1',   description: 'Junior IC',       level_order: '1', ctc_min_annual: '300000',  ctc_max_annual: '600000' },
      { code: 'GRADE-L2', name: 'Level 2',   description: 'Mid-level IC',    level_order: '2', ctc_min_annual: '600000',  ctc_max_annual: '1200000' },
      { code: 'GRADE-M1', name: 'Manager 1', description: 'First-line Mgr',  level_order: '3', ctc_min_annual: '1200000', ctc_max_annual: '2000000' },
    ],
  },

  payroll_groups: {
    label: 'Payroll Groups',
    columns: [
      { key: 'code',             label: 'Code',            required: true,  type: 'string',                               example: 'PG-MONTHLY',  description: 'Unique payroll group code. Will be uppercased.' },
      { key: 'name',             label: 'Name',            required: true,  type: 'string',                               example: 'Monthly Staff', description: 'Display name for the payroll group.' },
      { key: 'cycle_type',       label: 'Cycle Type',      required: false, type: 'enum', enumValues: ['monthly','biweekly','weekly'], example: 'monthly', description: 'Payroll frequency: monthly, biweekly, or weekly.' },
      { key: 'cycle_start_day',  label: 'Cycle Start Day', required: false, type: 'number',                               example: '1',           description: 'First day of the attendance period (1-28). Use 1 for calendar month, 21 for mid-month cycle.' },
      { key: 'cutoff_day',       label: 'Cutoff Day',      required: false, type: 'number',                               example: '25',          description: 'Last day of the attendance period (1-28). E.g. 20 for a 21→20 mid-month cycle.' },
      { key: 'payout_day',       label: 'Payout Day',      required: false, type: 'number',                               example: '1',           description: 'Day of month when salaries are disbursed (1-31).' },
      { key: 'currency_code',    label: 'Currency',        required: false, type: 'string',                               example: 'INR',         description: '3-letter ISO currency code. Defaults to INR.' },
    ],
    sampleRows: [
      { code: 'PG-MONTHLY',   name: 'Monthly Staff',    cycle_type: 'monthly', cycle_start_day: '1',  cutoff_day: '31', payout_day: '5',  currency_code: 'INR' },
      { code: 'PG-MIDMONTH',  name: 'Mid-Month Cycle',  cycle_type: 'monthly', cycle_start_day: '21', cutoff_day: '20', payout_day: '1',  currency_code: 'INR' },
      { code: 'PG-WEEKLY',    name: 'Weekly Field',     cycle_type: 'weekly',  cycle_start_day: '1',  cutoff_day: '5',  payout_day: '7',  currency_code: 'INR' },
    ],
  },

  employment_categories: {
    label: 'Employment Categories',
    columns: [
      { key: 'code',               label: 'Code',              required: true,  type: 'string',  example: 'EC-PERM',  description: 'Unique category code. Will be uppercased.' },
      { key: 'name',               label: 'Name',              required: true,  type: 'string',  example: 'Permanent Regular', description: 'Display name for the employment category.' },
      { key: 'description',        label: 'Description',       required: false, type: 'string',  example: '',         description: 'Optional description.' },
      { key: 'benefits_eligible',  label: 'Benefits Eligible', required: false, type: 'boolean', example: 'true',     description: 'Whether employees in this category are eligible for benefits.' },
      { key: 'pf_applicable',      label: 'PF Applicable',     required: false, type: 'boolean', example: 'true',     description: 'Whether PF deduction applies.' },
      { key: 'esi_applicable',     label: 'ESI Applicable',    required: false, type: 'boolean', example: 'true',     description: 'Whether ESI contribution applies.' },
      { key: 'notice_period_days', label: 'Notice Period (Days)', required: false, type: 'number', example: '30',     description: 'Standard notice period in days.' },
      { key: 'probation_days',     label: 'Probation (Days)',  required: false, type: 'number',  example: '90',       description: 'Probation period in days (0 = no probation).' },
    ],
    sampleRows: [
      { code: 'EC-PERM',     name: 'Permanent Regular',   benefits_eligible: 'true',  pf_applicable: 'true',  esi_applicable: 'true',  notice_period_days: '30', probation_days: '90' },
      { code: 'EC-CONTRACT', name: 'Fixed Term Contract', benefits_eligible: 'false', pf_applicable: 'true',  esi_applicable: 'true',  notice_period_days: '15', probation_days: '0' },
      { code: 'EC-INTERN',   name: 'Intern / Trainee',    benefits_eligible: 'false', pf_applicable: 'false', esi_applicable: 'false', notice_period_days: '7',  probation_days: '0' },
    ],
  },

  statutory_groups: {
    label: 'Statutory Groups',
    columns: [
      { key: 'code',             label: 'Code',              required: true,  type: 'string',  example: 'SG-MH',   description: 'Unique statutory group code. Will be uppercased.' },
      { key: 'name',             label: 'Name',              required: true,  type: 'string',  example: 'Maharashtra', description: 'Group display name (typically state/region).' },
      { key: 'state',            label: 'State',             required: false, type: 'string',  example: 'Maharashtra', description: 'State or region this group covers.' },
      { key: 'pf_enabled',       label: 'PF Enabled',        required: false, type: 'boolean', example: 'true',    description: 'Whether PF applies to employees in this group.' },
      { key: 'esi_enabled',      label: 'ESI Enabled',       required: false, type: 'boolean', example: 'true',    description: 'Whether ESI applies to employees in this group.' },
      { key: 'pt_enabled',       label: 'PT Enabled',        required: false, type: 'boolean', example: 'true',    description: 'Whether Professional Tax applies.' },
      { key: 'lwf_enabled',      label: 'LWF Enabled',       required: false, type: 'boolean', example: 'false',   description: 'Whether Labour Welfare Fund applies.' },
      { key: 'pf_wage_ceiling',  label: 'PF Wage Ceiling',   required: false, type: 'number',  example: '15000',   description: 'Monthly wage ceiling for PF computation (0 = uncapped).' },
      { key: 'esi_wage_ceiling', label: 'ESI Wage Ceiling',  required: false, type: 'number',  example: '21000',   description: 'Monthly gross ceiling for ESI applicability.' },
    ],
    sampleRows: [
      { code: 'SG-MH', name: 'Maharashtra', state: 'Maharashtra', pf_enabled: 'true', esi_enabled: 'true', pt_enabled: 'true',  lwf_enabled: 'false', pf_wage_ceiling: '15000', esi_wage_ceiling: '21000' },
      { code: 'SG-KA', name: 'Karnataka',   state: 'Karnataka',   pf_enabled: 'true', esi_enabled: 'true', pt_enabled: 'true',  lwf_enabled: 'true',  pf_wage_ceiling: '15000', esi_wage_ceiling: '21000' },
      { code: 'SG-DL', name: 'Delhi',       state: 'Delhi',       pf_enabled: 'true', esi_enabled: 'true', pt_enabled: 'false', lwf_enabled: 'false', pf_wage_ceiling: '15000', esi_wage_ceiling: '21000' },
    ],
  },

  asset_categories: {
    label: 'Asset Categories',
    columns: [
      { key: 'code',                label: 'Code',                required: true,  type: 'string', example: 'AC-LAPTOP', description: 'Unique asset category code. Will be uppercased.' },
      { key: 'name',                label: 'Name',                required: true,  type: 'string', example: 'Laptop',    description: 'Asset category display name.' },
      { key: 'description',         label: 'Description',         required: false, type: 'string', example: 'Company-issued laptops and notebooks', description: 'Optional description.' },
      { key: 'depreciation_method', label: 'Depreciation Method', required: false, type: 'enum', enumValues: ['straight_line','declining_balance','none'], example: 'straight_line', description: 'Depreciation method: straight_line, declining_balance, or none.' },
      { key: 'useful_life_years',   label: 'Useful Life (Years)', required: false, type: 'number', example: '3',         description: 'Expected useful life in years for depreciation.' },
      { key: 'requires_return',     label: 'Requires Return',     required: false, type: 'boolean', example: 'true',     description: 'Whether employees must return this asset on separation.' },
    ],
    sampleRows: [
      { code: 'AC-LAPTOP',  name: 'Laptop',          description: 'Company-issued laptops', depreciation_method: 'straight_line', useful_life_years: '3', requires_return: 'true' },
      { code: 'AC-MOBILE',  name: 'Mobile Phone',    description: 'Company mobile devices',  depreciation_method: 'straight_line', useful_life_years: '2', requires_return: 'true' },
      { code: 'AC-VEHICLE', name: 'Vehicle',         description: 'Company vehicles',        depreciation_method: 'declining_balance', useful_life_years: '5', requires_return: 'true' },
    ],
  },

  // ── Workforce Planning ────────────────────────────────────────────────────────

  holiday_groups: {
    label: 'Holiday Groups',
    columns: [
      { key: 'name',        label: 'Name',        required: true,  type: 'string',  example: 'North India', description: 'Holiday group display name (the unique key — re-importing the same name updates it).' },
      { key: 'code',        label: 'Code',        required: false, type: 'string',  example: 'HG-NORTH', description: 'Optional short code.' },
      { key: 'description', label: 'Description', required: false, type: 'string',  example: 'Holiday calendar for north-region sites', description: 'Optional description.' },
      { key: 'state_code',  label: 'State Code',  required: false, type: 'string',  example: 'IN-DL', description: 'Optional ISO 3166-2 region code this group maps to.' },
      { key: 'is_active',   label: 'Active',      required: false, type: 'boolean', example: 'true', description: 'Whether this group is active.' },
    ],
    sampleRows: [
      { name: 'North India', code: 'HG-NORTH', description: 'North-region holiday set', state_code: 'IN-DL', is_active: 'true' },
      { name: 'South India', code: 'HG-SOUTH', description: 'South-region holiday set', state_code: 'IN-KA', is_active: 'true' },
    ],
  },

  important_date_types: {
    label: 'Important Date Types',
    columns: [
      { key: 'code',        label: 'Code',        required: true,  type: 'string',  example: 'birthday', description: 'Unique code — lowercase letters, digits and underscores only (e.g. work_anniversary). Other characters are converted to underscores.' },
      { key: 'name',        label: 'Name',        required: true,  type: 'string',  example: 'Birthday', description: 'Display name for the date type.' },
      { key: 'description', label: 'Description', required: false, type: 'string',  example: 'Employee date of birth', description: 'Optional description.' },
      { key: 'is_active',   label: 'Active',      required: false, type: 'boolean', example: 'true', description: 'Whether this date type is active.' },
    ],
    sampleRows: [
      { code: 'birthday',         name: 'Birthday',         description: 'Employee date of birth', is_active: 'true' },
      { code: 'work_anniversary', name: 'Work Anniversary', description: 'Joining anniversary',    is_active: 'true' },
      { code: 'spouse_birthday',  name: 'Spouse Birthday',  description: '', is_active: 'true' },
    ],
  },

  rotation_policies: {
    label: 'Rotation Policies',
    columns: [
      { key: 'policy_name',    label: 'Policy Name',    required: true,  type: 'string', example: 'Retail 6-Day', description: 'Rotation policy name. Repeat the same name across rows to add multiple condition→shift rules to one policy.' },
      { key: 'description',    label: 'Description',    required: false, type: 'string', example: 'Store staff rotating roster', description: 'Policy-level description (taken from the first row of each policy).' },
      { key: 'is_active',      label: 'Active',         required: false, type: 'boolean', example: 'true', description: 'Whether the policy is active (policy-level).' },
      { key: 'condition_type', label: 'Condition',      required: true,  type: 'enum', enumValues: ['weekday_working','saturday_working','sunday_working','half_day','holiday_working'], example: 'weekday_working', description: 'Which day-condition this shift applies to. One row per condition.' },
      { key: 'shift_code',     label: 'Shift Code',     required: true,  type: 'string', example: 'GEN', description: 'Code of an existing Shift to apply for this condition.' },
      { key: 'sort_order',     label: 'Sort Order',     required: false, type: 'number', example: '0', description: 'Order of the rule within the policy.' },
    ],
    sampleRows: [
      { policy_name: 'Retail 6-Day', description: 'Store staff rotating roster', is_active: 'true', condition_type: 'weekday_working',  shift_code: 'GEN',  sort_order: '0' },
      { policy_name: 'Retail 6-Day', description: 'Store staff rotating roster', is_active: 'true', condition_type: 'saturday_working', shift_code: 'GEN',  sort_order: '1' },
      { policy_name: 'Retail 6-Day', description: 'Store staff rotating roster', is_active: 'true', condition_type: 'sunday_working',   shift_code: 'HALF', sort_order: '2' },
    ],
  },

  positions: {
    label: 'Positions (Sanctioned Strength)',
    columns: [
      { key: 'code',               label: 'Code',                    required: true,  type: 'string', example: 'ENG-SR-001',     description: 'Unique position code — the sanctioned slot identifier (used as the upload key).' },
      { key: 'title',              label: 'Title',                   required: true,  type: 'string', example: 'Senior Engineer', description: 'Position title (may differ from the designation label).' },
      { key: 'department_code',    label: 'Department Code',         required: false, type: 'string', example: 'DEPT-ENG',        description: 'Code of an existing department this slot sits in (optional).' },
      { key: 'designation_code',   label: 'Designation Code',        required: false, type: 'string', example: 'DESIG-SDE',       description: 'Code of an existing designation (optional).' },
      { key: 'grade_code',         label: 'Grade Code',              required: false, type: 'string', example: 'GRADE-L3',        description: 'Code of an existing grade / band (optional).' },
      { key: 'site_code',          label: 'Site Code',               required: false, type: 'string', example: 'SITE-BLR',        description: 'Code of an existing site (optional).' },
      { key: 'work_location_code', label: 'Work Location Code',      required: false, type: 'string', example: 'LOC-BLR',         description: 'Code of an existing work location (optional).' },
      { key: 'cost_center_code',   label: 'Cost Center Code',        required: false, type: 'string', example: 'CC-ENG',          description: 'Code of an existing cost center (optional).' },
      { key: 'sanctioned_count',   label: 'Sanctioned Count',        required: false, type: 'number', example: '3',               description: 'Authorised headcount for this slot (positive integer). Defaults to 1.' },
      { key: 'status',             label: 'Status',                  required: false, type: 'enum', enumValues: ['active', 'frozen', 'abolished'], example: 'active', description: 'Position status. Defaults to active.' },
      { key: 'effective_date',     label: 'Effective Date (YYYY-MM-DD)', required: false, type: 'date', example: '2025-04-01',  description: 'Date the slot was sanctioned. Defaults to today.' },
      { key: 'notes',              label: 'Notes',                   required: false, type: 'string', example: 'Backfill for attrition', description: 'Optional free-text notes.' },
    ],
    sampleRows: [
      { code: 'ENG-SR-001', title: 'Senior Engineer', department_code: 'DEPT-ENG', designation_code: 'DESIG-SDE', grade_code: 'GRADE-L3', site_code: 'SITE-BLR', work_location_code: 'LOC-BLR', cost_center_code: 'CC-ENG', sanctioned_count: '3', status: 'active', effective_date: '2025-04-01', notes: '' },
      { code: 'HR-MGR-001', title: 'HR Manager',      department_code: 'DEPT-HR',  designation_code: 'DESIG-HRBP', grade_code: 'GRADE-M1', site_code: 'SITE-MUM', work_location_code: 'LOC-MUM', cost_center_code: '',      sanctioned_count: '1', status: 'active', effective_date: '',           notes: '' },
    ],
  },

  // ── Payroll Masters ───────────────────────────────────────────────────────────

  salary_structures: {
    label: 'Salary Structures',
    columns: [
      { key: 'code',        label: 'Code',        required: true,  type: 'string',  example: 'SS-SENIOR',    description: 'Unique salary structure code. Will be uppercased.' },
      { key: 'name',        label: 'Name',        required: true,  type: 'string',  example: 'Senior Engineer Package', description: 'Display name for the salary structure.' },
      { key: 'description', label: 'Description', required: false, type: 'string',  example: 'Band L3-L4 CTC structure', description: 'Optional description.' },
      { key: 'is_default',  label: 'Is Default',  required: false, type: 'boolean', example: 'false', description: 'Set to true to make this the tenant-default structure. Only one may be default.' },
    ],
    sampleRows: [
      { code: 'SS-DEFAULT', name: 'Standard Package',   description: 'Default CTC structure', is_default: 'true' },
      { code: 'SS-SENIOR',  name: 'Senior Engineer',    description: 'Band L3-L4',            is_default: 'false' },
      { code: 'SS-MGMT',    name: 'Management Package', description: 'Manager band',          is_default: 'false' },
    ],
  },

  // ── Onboarding Governance ─────────────────────────────────────────────────────

  compensation_revisions: {
    label: 'Compensation Revisions',
    columns: [
      { key: 'employee_code',  label: 'Employee Code',   required: true,  type: 'string', example: 'EMP001', description: 'Employee code identifying the revision target.' },
      { key: 'revision_type',  label: 'Revision Type',   required: true,  type: 'enum',   enumValues: ['increment','promotion','restructure','correction','transfer'], example: 'increment', description: 'Type of compensation revision.' },
      { key: 'effective_date', label: 'Effective Date',  required: true,  type: 'date',   example: '2025-04-01', description: 'Date from which the new CTC takes effect (YYYY-MM-DD).' },
      { key: 'new_ctc_annual', label: 'New Annual CTC',  required: true,  type: 'number', example: '1200000', description: 'New annual CTC in rupees.' },
      { key: 'reason',         label: 'Reason',          required: true,  type: 'string', example: 'Annual increment cycle FY2025', description: 'Business reason for the revision.' },
      { key: 'notes',          label: 'Notes',           required: false, type: 'string', example: 'Approved in April review', description: 'Optional free-text notes.' },
    ],
    sampleRows: [
      { employee_code: 'EMP001', revision_type: 'increment',   effective_date: '2025-04-01', new_ctc_annual: '1200000', reason: 'Annual increment FY2025' },
      { employee_code: 'EMP002', revision_type: 'promotion',   effective_date: '2025-04-01', new_ctc_annual: '1800000', reason: 'Promotion to Senior Engineer' },
      { employee_code: 'EMP003', revision_type: 'correction',  effective_date: '2025-01-01', new_ctc_annual: '950000',  reason: 'Joining CTC correction' },
    ],
  },

  // ── Reference Data ─────────────────────────────────────────────────────────────

  document_types: {
    label: 'Document Types',
    columns: [
      { key: 'code',           label: 'Code',           required: true,  type: 'string',  example: 'DT-AADHAR',  description: 'Unique document type code. Will be uppercased.' },
      { key: 'name',           label: 'Name',           required: true,  type: 'string',  example: 'Aadhaar Card', description: 'Display name for the document type.' },
      { key: 'description',    label: 'Description',    required: false, type: 'string',  example: 'Government-issued identity', description: 'Optional description.' },
      { key: 'is_mandatory',   label: 'Is Mandatory',   required: false, type: 'boolean', example: 'true',       description: 'Whether this document is mandatory for all employees.' },
    ],
    sampleRows: [
      { code: 'DT-AADHAR', name: 'Aadhaar Card',   description: 'Govt identity (12-digit)',  is_mandatory: 'true' },
      { code: 'DT-PAN',    name: 'PAN Card',        description: 'Tax identity',             is_mandatory: 'true' },
      { code: 'DT-OFFER',  name: 'Offer Letter',    description: 'Signed offer letter',      is_mandatory: 'false' },
    ],
  },

  identity_types: {
    label: 'Identity Types',
    columns: [
      { key: 'code',        label: 'Code',        required: true,  type: 'string', example: 'ID-PASSPORT', description: 'Unique identity type code. Will be uppercased.' },
      { key: 'name',        label: 'Name',        required: true,  type: 'string', example: 'Passport',    description: 'Display name for the identity type.' },
      { key: 'description', label: 'Description', required: false, type: 'string', example: 'International travel document', description: 'Optional description.' },
    ],
    sampleRows: [
      { code: 'ID-PASSPORT', name: 'Passport',        description: 'International travel document' },
      { code: 'ID-DRIVING',  name: 'Driving Licence', description: 'State-issued driving licence' },
      { code: 'ID-VOTER',    name: 'Voter ID',         description: 'Election Commission card' },
    ],
  },

  relationship_types: {
    label: 'Relationship Types',
    columns: [
      { key: 'code', label: 'Code', required: true,  type: 'string', example: 'REL-SPOUSE',  description: 'Unique relationship type code. Will be uppercased.' },
      { key: 'name', label: 'Name', required: true,  type: 'string', example: 'Spouse',      description: 'Display name for the relationship type.' },
    ],
    sampleRows: [
      { code: 'REL-SPOUSE', name: 'Spouse' },
      { code: 'REL-FATHER', name: 'Father' },
      { code: 'REL-MOTHER', name: 'Mother' },
      { code: 'REL-SON',    name: 'Son' },
      { code: 'REL-DAUGHTER', name: 'Daughter' },
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
