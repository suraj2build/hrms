/**
 * Demo fixtures — rich Indian-context sample data for DEMO MODE.
 *
 * All data here is fictional and exists purely to make the portal feel alive
 * when the app runs with no backend (`VITE_DEMO_MODE=true`). Names, salaries,
 * statutory numbers (PF/ESI/PT/UAN/PAN) are illustrative only.
 *
 * The shapes mirror the real API responses (see src/types and the consuming
 * pages). The resolver (resolver.ts) maps endpoints onto these structures.
 */

import type {
  Profile,
  Tenant,
  Department,
  Designation,
  Grade,
  EmployeeListItem,
  Employee,
  FullProfile,
  DashboardStats,
} from '@/types'

// ── Constants ───────────────────────────────────────────────────────────────

export const DEMO_TENANT_ID = 'demo-tenant'
export const DEMO_USER_ID = 'demo-user-0001'
/** The employee the demo "logged-in" user maps to (Priya Sharma, CHRO). */
export const DEMO_SELF_EMPLOYEE_ID = 'emp-0001'

const NOW = new Date()
const ISO = (d: Date) => d.toISOString()
const DAY = (d: Date) => d.toISOString().slice(0, 10)

function daysAgo(n: number): Date {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d
}

// ── Tenant + Profile ──────────────────────────────────────────────────────────

export const demoTenant: Tenant = {
  id: DEMO_TENANT_ID,
  name: 'Saar Technologies Pvt Ltd',
  slug: 'saar-technologies',
  plan: 'enterprise',
  industry: 'Information Technology',
  size_range: '201-500',
  country: 'IN',
  settings: { currency: 'INR', timezone: 'Asia/Kolkata' },
  created_at: ISO(daysAgo(900)),
}

export const demoProfile: Profile = {
  id: DEMO_USER_ID,
  tenant_id: DEMO_TENANT_ID,
  employee_id: DEMO_SELF_EMPLOYEE_ID,
  role: 'super_admin',
  full_name: 'Priya Sharma',
  is_active: true,
  created_at: ISO(daysAgo(900)),
}

// ── Org structure ───────────────────────────────────────────────────────────

export const demoDepartments: Department[] = [
  { id: 'dept-eng', tenant_id: DEMO_TENANT_ID, name: 'Engineering', code: 'ENG', created_at: ISO(daysAgo(800)) },
  { id: 'dept-sales', tenant_id: DEMO_TENANT_ID, name: 'Sales', code: 'SAL', created_at: ISO(daysAgo(800)) },
  { id: 'dept-hr', tenant_id: DEMO_TENANT_ID, name: 'HR', code: 'HR', created_at: ISO(daysAgo(800)) },
  { id: 'dept-fin', tenant_id: DEMO_TENANT_ID, name: 'Finance', code: 'FIN', created_at: ISO(daysAgo(800)) },
  { id: 'dept-ops', tenant_id: DEMO_TENANT_ID, name: 'Operations', code: 'OPS', created_at: ISO(daysAgo(800)) },
]

export const demoDesignations: Designation[] = [
  { id: 'desig-chro', tenant_id: DEMO_TENANT_ID, name: 'Chief Human Resources Officer', created_at: ISO(daysAgo(800)) },
  { id: 'desig-em', tenant_id: DEMO_TENANT_ID, name: 'Engineering Manager', created_at: ISO(daysAgo(800)) },
  { id: 'desig-sse', tenant_id: DEMO_TENANT_ID, name: 'Senior Software Engineer', created_at: ISO(daysAgo(800)) },
  { id: 'desig-se', tenant_id: DEMO_TENANT_ID, name: 'Software Engineer', created_at: ISO(daysAgo(800)) },
  { id: 'desig-sm', tenant_id: DEMO_TENANT_ID, name: 'Sales Manager', created_at: ISO(daysAgo(800)) },
  { id: 'desig-bde', tenant_id: DEMO_TENANT_ID, name: 'Business Development Executive', created_at: ISO(daysAgo(800)) },
  { id: 'desig-hrbp', tenant_id: DEMO_TENANT_ID, name: 'HR Business Partner', created_at: ISO(daysAgo(800)) },
  { id: 'desig-fa', tenant_id: DEMO_TENANT_ID, name: 'Finance Analyst', created_at: ISO(daysAgo(800)) },
  { id: 'desig-am', tenant_id: DEMO_TENANT_ID, name: 'Accounts Manager', created_at: ISO(daysAgo(800)) },
  { id: 'desig-ops', tenant_id: DEMO_TENANT_ID, name: 'Operations Executive', created_at: ISO(daysAgo(800)) },
]

export const demoGrades: Grade[] = [
  { id: 'grade-l5', tenant_id: DEMO_TENANT_ID, name: 'L5 — Leadership', code: 'L5', min_salary: 3500000, max_salary: 6000000, created_at: ISO(daysAgo(800)) },
  { id: 'grade-l4', tenant_id: DEMO_TENANT_ID, name: 'L4 — Manager', code: 'L4', min_salary: 1800000, max_salary: 3200000, created_at: ISO(daysAgo(800)) },
  { id: 'grade-l3', tenant_id: DEMO_TENANT_ID, name: 'L3 — Senior', code: 'L3', min_salary: 1200000, max_salary: 2200000, created_at: ISO(daysAgo(800)) },
  { id: 'grade-l2', tenant_id: DEMO_TENANT_ID, name: 'L2 — Associate', code: 'L2', min_salary: 600000, max_salary: 1200000, created_at: ISO(daysAgo(800)) },
  { id: 'grade-l1', tenant_id: DEMO_TENANT_ID, name: 'L1 — Entry', code: 'L1', min_salary: 350000, max_salary: 650000, created_at: ISO(daysAgo(800)) },
]

// ── Work locations / sites ─────────────────────────────────────────────────────

// Work locations — two mapped to sites, one left unassigned (governance-gap demo).
export const demoWorkLocations = [
  { id: 'loc-blr', tenant_id: DEMO_TENANT_ID, name: 'Bengaluru HQ', code: 'BLR', site_id: 'site-blr', city: 'Bengaluru', state: 'Karnataka', country: 'India', pincode: '560103', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'loc-mum', tenant_id: DEMO_TENANT_ID, name: 'Mumbai Office', code: 'MUM', site_id: 'site-mum', city: 'Mumbai', state: 'Maharashtra', country: 'India', pincode: '400051', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'loc-del', tenant_id: DEMO_TENANT_ID, name: 'Delhi NCR Office', code: 'DEL', site_id: null, city: 'New Delhi', state: 'Delhi', country: 'India', pincode: '110019', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
]

// Clusters — regional grouping of sites.
export const demoClusters = [
  { id: 'cluster-south', tenant_id: DEMO_TENANT_ID, name: 'South Cluster', created_at: ISO(daysAgo(800)) },
  { id: 'cluster-west',  tenant_id: DEMO_TENANT_ID, name: 'West Cluster',  created_at: ISO(daysAgo(800)) },
]

// Sites — two mapped to clusters with governance defaults; one left unmapped.
export const demoSites = [
  { id: 'site-blr', tenant_id: DEMO_TENANT_ID, name: 'Bengaluru HQ', code: 'BLR', short_name: 'BLR', location: 'Bengaluru, Karnataka', timezone: 'Asia/Kolkata', city: 'Bengaluru', state: 'Karnataka', state_code: 'KA', cluster_id: 'cluster-south', region: 'South', zone: 'South', site_type: 'HQ', sanctioned_headcount: 60, default_roster_id: 'ros-std', default_rotation_policy_id: 'rot-std', default_leave_policy_id: null, holiday_group_id: null, is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'site-mum', tenant_id: DEMO_TENANT_ID, name: 'Mumbai Office', code: 'MUM', short_name: 'MUM', location: 'Mumbai, Maharashtra', timezone: 'Asia/Kolkata', city: 'Mumbai', state: 'Maharashtra', state_code: 'MH', cluster_id: 'cluster-west', region: 'West', zone: 'West', site_type: 'branch', sanctioned_headcount: 30, default_roster_id: 'ros-std', default_rotation_policy_id: 'rot-std', default_leave_policy_id: null, holiday_group_id: null, is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'site-del', tenant_id: DEMO_TENANT_ID, name: 'Delhi NCR Office', code: 'DEL', short_name: 'DEL', location: 'New Delhi, Delhi', timezone: 'Asia/Kolkata', city: 'New Delhi', state: 'Delhi', state_code: 'DL', cluster_id: null, region: 'North', zone: 'North', site_type: 'branch', sanctioned_headcount: 20, default_roster_id: null, default_rotation_policy_id: null, default_leave_policy_id: null, holiday_group_id: null, is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
]

export const demoRosters = [
  { id: 'ros-std', tenant_id: DEMO_TENANT_ID, name: 'Standard 5-Day Week', code: 'STD5', created_at: ISO(daysAgo(800)) },
  { id: 'ros-6day', tenant_id: DEMO_TENANT_ID, name: '6-Day Week', code: 'STD6', created_at: ISO(daysAgo(800)) },
]

export const demoRotationPolicies = [
  { id: 'rot-std', tenant_id: DEMO_TENANT_ID, name: 'General Shift', code: 'GEN', created_at: ISO(daysAgo(800)) },
  { id: 'rot-3shift', tenant_id: DEMO_TENANT_ID, name: '3-Shift Rotation', code: 'ROT3', created_at: ISO(daysAgo(800)) },
]

export const demoCostCenters = [
  { id: 'cc-eng', tenant_id: DEMO_TENANT_ID, name: 'Engineering', code: 'CC-ENG', description: 'Product & platform engineering', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'cc-sales', tenant_id: DEMO_TENANT_ID, name: 'Sales & Marketing', code: 'CC-SAL', description: 'Revenue org', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'cc-ga', tenant_id: DEMO_TENANT_ID, name: 'G&A', code: 'CC-GA', description: 'General & administrative', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
]

// ── Employee roster ─────────────────────────────────────────────────────────

interface DemoEmpSeed {
  id: string
  code: string
  first: string
  last: string
  deptId: string
  desigId: string
  gradeId: string
  locId: string
  gender: 'male' | 'female'
  joined: number // days ago
  managerId?: string
  status?: 'active' | 'on_notice'
  ctc: number // annual INR
  empType?: 'permanent' | 'contract' | 'intern' | 'probation'
}

const SEEDS: DemoEmpSeed[] = [
  { id: 'emp-0001', code: 'SAAR001', first: 'Priya', last: 'Sharma', deptId: 'dept-hr', desigId: 'desig-chro', gradeId: 'grade-l5', locId: 'loc-blr', gender: 'female', joined: 1850, ctc: 5400000 },
  { id: 'emp-0002', code: 'SAAR002', first: 'Rahul', last: 'Verma', deptId: 'dept-eng', desigId: 'desig-em', gradeId: 'grade-l4', locId: 'loc-blr', gender: 'male', joined: 1500, managerId: 'emp-0001', ctc: 3000000 },
  { id: 'emp-0003', code: 'SAAR003', first: 'Ananya', last: 'Iyer', deptId: 'dept-eng', desigId: 'desig-sse', gradeId: 'grade-l3', locId: 'loc-blr', gender: 'female', joined: 1100, managerId: 'emp-0002', ctc: 2100000 },
  { id: 'emp-0004', code: 'SAAR004', first: 'Vikram', last: 'Singh', deptId: 'dept-eng', desigId: 'desig-sse', gradeId: 'grade-l3', locId: 'loc-mum', gender: 'male', joined: 980, managerId: 'emp-0002', ctc: 1950000 },
  { id: 'emp-0005', code: 'SAAR005', first: 'Sneha', last: 'Reddy', deptId: 'dept-eng', desigId: 'desig-se', gradeId: 'grade-l2', locId: 'loc-blr', gender: 'female', joined: 540, managerId: 'emp-0002', ctc: 1100000 },
  { id: 'emp-0006', code: 'SAAR006', first: 'Arjun', last: 'Nair', deptId: 'dept-eng', desigId: 'desig-se', gradeId: 'grade-l2', locId: 'loc-blr', gender: 'male', joined: 320, managerId: 'emp-0002', ctc: 980000, empType: 'probation' },
  { id: 'emp-0007', code: 'SAAR007', first: 'Kavya', last: 'Menon', deptId: 'dept-sales', desigId: 'desig-sm', gradeId: 'grade-l4', locId: 'loc-mum', gender: 'female', joined: 1400, managerId: 'emp-0001', ctc: 2800000 },
  { id: 'emp-0008', code: 'SAAR008', first: 'Rohan', last: 'Gupta', deptId: 'dept-sales', desigId: 'desig-bde', gradeId: 'grade-l2', locId: 'loc-del', gender: 'male', joined: 700, managerId: 'emp-0007', ctc: 850000 },
  { id: 'emp-0009', code: 'SAAR009', first: 'Meera', last: 'Joshi', deptId: 'dept-sales', desigId: 'desig-bde', gradeId: 'grade-l2', locId: 'loc-mum', gender: 'female', joined: 410, managerId: 'emp-0007', ctc: 780000 },
  { id: 'emp-0010', code: 'SAAR010', first: 'Aditya', last: 'Kulkarni', deptId: 'dept-sales', desigId: 'desig-bde', gradeId: 'grade-l1', locId: 'loc-del', gender: 'male', joined: 150, managerId: 'emp-0007', ctc: 560000, empType: 'probation' },
  { id: 'emp-0011', code: 'SAAR011', first: 'Divya', last: 'Pillai', deptId: 'dept-hr', desigId: 'desig-hrbp', gradeId: 'grade-l3', locId: 'loc-blr', gender: 'female', joined: 1200, managerId: 'emp-0001', ctc: 1600000 },
  { id: 'emp-0012', code: 'SAAR012', first: 'Karthik', last: 'Rao', deptId: 'dept-hr', desigId: 'desig-hrbp', gradeId: 'grade-l2', locId: 'loc-mum', gender: 'male', joined: 600, managerId: 'emp-0011', ctc: 1050000 },
  { id: 'emp-0013', code: 'SAAR013', first: 'Pooja', last: 'Desai', deptId: 'dept-fin', desigId: 'desig-am', gradeId: 'grade-l4', locId: 'loc-blr', gender: 'female', joined: 1600, managerId: 'emp-0001', ctc: 2400000 },
  { id: 'emp-0014', code: 'SAAR014', first: 'Suresh', last: 'Patel', deptId: 'dept-fin', desigId: 'desig-fa', gradeId: 'grade-l2', locId: 'loc-blr', gender: 'male', joined: 880, managerId: 'emp-0013', ctc: 1150000 },
  { id: 'emp-0015', code: 'SAAR015', first: 'Lakshmi', last: 'Krishnan', deptId: 'dept-fin', desigId: 'desig-fa', gradeId: 'grade-l2', locId: 'loc-del', gender: 'female', joined: 460, managerId: 'emp-0013', ctc: 990000 },
  { id: 'emp-0016', code: 'SAAR016', first: 'Manish', last: 'Agarwal', deptId: 'dept-ops', desigId: 'desig-ops', gradeId: 'grade-l2', locId: 'loc-del', gender: 'male', joined: 720, managerId: 'emp-0001', ctc: 820000 },
  { id: 'emp-0017', code: 'SAAR017', first: 'Ritu', last: 'Chauhan', deptId: 'dept-ops', desigId: 'desig-ops', gradeId: 'grade-l1', locId: 'loc-mum', gender: 'female', joined: 95, managerId: 'emp-0016', ctc: 540000, empType: 'probation' },
  { id: 'emp-0018', code: 'SAAR018', first: 'Sandeep', last: 'Mishra', deptId: 'dept-eng', desigId: 'desig-se', gradeId: 'grade-l2', locId: 'loc-blr', gender: 'male', joined: 280, managerId: 'emp-0002', ctc: 1080000 },
  { id: 'emp-0019', code: 'SAAR019', first: 'Neha', last: 'Bhatt', deptId: 'dept-eng', desigId: 'desig-se', gradeId: 'grade-l2', locId: 'loc-mum', gender: 'female', joined: 350, managerId: 'emp-0002', ctc: 1020000 },
  { id: 'emp-0020', code: 'SAAR020', first: 'Gaurav', last: 'Malhotra', deptId: 'dept-sales', desigId: 'desig-bde', gradeId: 'grade-l1', locId: 'loc-del', gender: 'male', joined: 60, managerId: 'emp-0007', ctc: 520000, empType: 'probation' },
  { id: 'emp-0021', code: 'SAAR021', first: 'Shreya', last: 'Banerjee', deptId: 'dept-eng', desigId: 'desig-sse', gradeId: 'grade-l3', locId: 'loc-blr', gender: 'female', joined: 1300, managerId: 'emp-0002', ctc: 2050000 },
  { id: 'emp-0022', code: 'SAAR022', first: 'Imran', last: 'Khan', deptId: 'dept-eng', desigId: 'desig-se', gradeId: 'grade-l2', locId: 'loc-blr', gender: 'male', joined: 240, managerId: 'emp-0002', ctc: 1000000, status: 'on_notice' },
]

const deptName = (id: string) => demoDepartments.find(d => d.id === id)!.name
const desigName = (id: string) => demoDesignations.find(d => d.id === id)!.name
const gradeName = (id: string) => demoGrades.find(g => g.id === id)!.name
const loc = (id: string) => demoWorkLocations.find(l => l.id === id)!

function emailOf(s: DemoEmpSeed): string {
  return `${s.first.toLowerCase()}.${s.last.toLowerCase()}@saartech.in`
}
function phoneOf(i: number): string {
  return `+91 9${String(800000000 + i * 13577).slice(0, 9)}`
}

// ── Employee list items ─────────────────────────────────────────────────────

export const demoEmployeeList: EmployeeListItem[] = SEEDS.map((s, i) => ({
  id: s.id,
  employee_code: s.code,
  first_name: s.first,
  last_name: s.last,
  email: emailOf(s),
  phone: phoneOf(i),
  status: s.status ?? 'active',
  joining_date: DAY(daysAgo(s.joined)),
  created_at: ISO(daysAgo(s.joined)),
  department: { id: s.deptId, name: deptName(s.deptId) },
  designation: { id: s.desigId, name: desigName(s.desigId) },
  personal_info: { profile_photo: undefined, gender: s.gender },
  current_job: { employment_type: s.empType ?? 'permanent' },
  work_location: { id: s.locId, name: loc(s.locId).name, city: loc(s.locId).city },
  user_account: { status: 'active', role: s.deptId === 'dept-hr' ? 'hr_admin' : 'employee' },
}))

// ── Full employee object (lean GET /employees/:id) ──────────────────────────

export function demoEmployee(id: string): Employee {
  const s = SEEDS.find(e => e.id === id) ?? SEEDS[0]
  const i = SEEDS.indexOf(s)
  const mgr = s.managerId ? SEEDS.find(e => e.id === s.managerId) : undefined
  return {
    id: s.id,
    tenant_id: DEMO_TENANT_ID,
    employee_code: s.code,
    first_name: s.first,
    last_name: s.last,
    email: emailOf(s),
    phone: phoneOf(i),
    joining_date: DAY(daysAgo(s.joined)),
    status: s.status ?? 'active',
    work_location_id: s.locId,
    created_at: ISO(daysAgo(s.joined)),
    updated_at: ISO(daysAgo(2)),
    department: { id: s.deptId, name: deptName(s.deptId) },
    designation: { id: s.desigId, name: desigName(s.desigId) },
    grade: { id: s.gradeId, name: gradeName(s.gradeId) },
    manager: mgr
      ? { id: mgr.id, first_name: mgr.first, last_name: mgr.last, employee_code: mgr.code }
      : undefined,
  }
}

// ── Compensation breakdown (Indian salary structure) ────────────────────────

export interface DemoCompComponent {
  code: string
  name: string
  type: 'earning' | 'deduction' | 'employer_contribution'
  computed_monthly: number
  monthly_amount: number
  annual_amount: number
  calculation_type: 'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross'
  value: number
  sequence: number
}

/** Build a realistic India CTC breakdown (Basic/HRA/PF/PT/TDS etc.) from annual CTC. */
export function demoCompensation(ctcAnnual: number) {
  const monthlyCtc = Math.round(ctcAnnual / 12)
  const basic = Math.round(monthlyCtc * 0.4)
  const hra = Math.round(basic * 0.5)
  const special = Math.round(monthlyCtc * 0.25)
  const conveyance = 1600
  const lta = Math.round(monthlyCtc * 0.05)
  const pfEmployee = Math.min(Math.round(basic * 0.12), 1800)
  const pfEmployer = pfEmployee
  const pt = monthlyCtc > 25000 ? 200 : 150
  const tds = Math.round(monthlyCtc * 0.08)
  const esiApplicable = monthlyCtc <= 21000
  const esiEmployee = esiApplicable ? Math.round(monthlyCtc * 0.0075) : 0
  const esiEmployer = esiApplicable ? Math.round(monthlyCtc * 0.0325) : 0

  const components: DemoCompComponent[] = [
    { code: 'BASIC', name: 'Basic Salary', type: 'earning', computed_monthly: basic, monthly_amount: basic, annual_amount: basic * 12, calculation_type: 'pct_of_ctc', value: 40, sequence: 1 },
    { code: 'HRA', name: 'House Rent Allowance', type: 'earning', computed_monthly: hra, monthly_amount: hra, annual_amount: hra * 12, calculation_type: 'pct_of_basic', value: 50, sequence: 2 },
    { code: 'CONV', name: 'Conveyance Allowance', type: 'earning', computed_monthly: conveyance, monthly_amount: conveyance, annual_amount: conveyance * 12, calculation_type: 'fixed', value: conveyance, sequence: 3 },
    { code: 'LTA', name: 'Leave Travel Allowance', type: 'earning', computed_monthly: lta, monthly_amount: lta, annual_amount: lta * 12, calculation_type: 'pct_of_ctc', value: 5, sequence: 4 },
    { code: 'SPECIAL', name: 'Special Allowance', type: 'earning', computed_monthly: special, monthly_amount: special, annual_amount: special * 12, calculation_type: 'pct_of_ctc', value: 25, sequence: 5 },
    { code: 'PF_EE', name: 'Provident Fund (Employee)', type: 'deduction', computed_monthly: pfEmployee, monthly_amount: pfEmployee, annual_amount: pfEmployee * 12, calculation_type: 'pct_of_basic', value: 12, sequence: 6 },
    { code: 'PT', name: 'Professional Tax', type: 'deduction', computed_monthly: pt, monthly_amount: pt, annual_amount: pt * 12, calculation_type: 'fixed', value: pt, sequence: 7 },
    { code: 'TDS', name: 'TDS (Income Tax)', type: 'deduction', computed_monthly: tds, monthly_amount: tds, annual_amount: tds * 12, calculation_type: 'fixed', value: tds, sequence: 8 },
    { code: 'PF_ER', name: 'Provident Fund (Employer)', type: 'employer_contribution', computed_monthly: pfEmployer, monthly_amount: pfEmployer, annual_amount: pfEmployer * 12, calculation_type: 'pct_of_basic', value: 12, sequence: 9 },
  ]
  if (esiApplicable) {
    components.push(
      { code: 'ESI_EE', name: 'ESI (Employee)', type: 'deduction', computed_monthly: esiEmployee, monthly_amount: esiEmployee, annual_amount: esiEmployee * 12, calculation_type: 'pct_of_gross', value: 0.75, sequence: 10 },
      { code: 'ESI_ER', name: 'ESI (Employer)', type: 'employer_contribution', computed_monthly: esiEmployer, monthly_amount: esiEmployer, annual_amount: esiEmployer * 12, calculation_type: 'pct_of_gross', value: 3.25, sequence: 11 },
    )
  }
  return { monthlyCtc, components }
}

/** Active compensation response — GET /employees/:id/compensation. */
export function demoActiveComp(id: string) {
  const s = SEEDS.find(e => e.id === id) ?? SEEDS[0]
  const { monthlyCtc, components } = demoCompensation(s.ctc)
  return {
    id: `comp-${id}`,
    ctc_annual: s.ctc,
    ctc_monthly: monthlyCtc,
    effective_from: DAY(daysAgo(s.joined)),
    components: components.map(c => ({
      code: c.code,
      name: c.name,
      type: c.type,
      computed_monthly: c.computed_monthly,
    })),
  }
}

// ── Statutory / bank info ─────────────────────────────────────────────────────

function panOf(s: DemoEmpSeed): string {
  const a = (s.first[0] + s.last[0] + 'PS').toUpperCase().slice(0, 5).padEnd(5, 'X')
  const code = String(1000 + SEEDS.indexOf(s) * 7).slice(0, 4)
  return `${a}${code}K`
}

// ── Full profile (GET /employees/:id/full-profile) ──────────────────────────

export function demoFullProfile(id: string): FullProfile {
  const s = SEEDS.find(e => e.id === id) ?? SEEDS[0]
  const i = SEEDS.indexOf(s)
  const mgr = s.managerId ? SEEDS.find(e => e.id === s.managerId) : undefined
  const l = loc(s.locId)
  const { monthlyCtc, components } = demoCompensation(s.ctc)
  const emp = demoEmployee(id)

  return {
    employee: emp,
    personal_info: {
      id: `pi-${id}`,
      tenant_id: DEMO_TENANT_ID,
      employee_id: id,
      gender: s.gender,
      dob: DAY(daysAgo(11000 + i * 120)),
      marital_status: i % 3 === 0 ? 'single' : 'married',
      blood_group: ['O+', 'B+', 'A+', 'AB+'][i % 4],
      nationality: 'Indian',
      physically_handicapped: false,
      created_at: ISO(daysAgo(s.joined)),
      updated_at: ISO(daysAgo(5)),
    },
    job_info: {
      id: `job-${id}`,
      employment_type: s.empType ?? 'permanent',
      effective_from: DAY(daysAgo(s.joined)),
      department: { id: s.deptId, name: deptName(s.deptId), code: demoDepartments.find(d => d.id === s.deptId)!.code },
      designation: { id: s.desigId, name: desigName(s.desigId) },
      grade: { id: s.gradeId, name: gradeName(s.gradeId), code: demoGrades.find(g => g.id === s.gradeId)!.code },
      work_location: { id: l.id, name: l.name, city: l.city },
      cost_center: null,
      shift: { id: 'shift-gen', name: 'General Shift', code: 'GEN' },
      manager: mgr ? { id: mgr.id, full_name: `${mgr.first} ${mgr.last}`, employee_code: mgr.code } : null,
    },
    compensation: {
      id: `comp-${id}`,
      ctc_annual: s.ctc,
      ctc_monthly: monthlyCtc,
      effective_from: DAY(daysAgo(s.joined)),
      structure: { id: 'struct-std', name: 'Standard India Structure', code: 'STD-IN' },
      components: components.map(c => ({
        id: `cc-${id}-${c.code}`,
        name: c.name,
        code: c.code,
        component_type: c.type,
        calculation_type: c.calculation_type,
        value: c.value,
        monthly_amount: c.monthly_amount,
        annual_amount: c.annual_amount,
        sequence: c.sequence,
      })),
    },
    addresses: [
      {
        id: `addr-${id}`,
        tenant_id: DEMO_TENANT_ID,
        employee_id: id,
        address_type: 'current',
        line1: `${12 + i}, ${['MG Road', 'Brigade Road', 'Koramangala', 'Andheri East', 'Connaught Place'][i % 5]}`,
        city: l.city,
        state: l.state,
        country: 'India',
        pincode: l.pincode,
        created_at: ISO(daysAgo(s.joined)),
        updated_at: ISO(daysAgo(s.joined)),
      },
    ],
    emergency_contacts: [
      {
        id: `ec-${id}`,
        tenant_id: DEMO_TENANT_ID,
        employee_id: id,
        name: `${['Ramesh', 'Sunita', 'Anil', 'Geeta'][i % 4]} ${s.last}`,
        relationship: i % 2 === 0 ? 'Spouse' : 'Parent',
        phone: phoneOf(i + 100),
        is_primary: true,
        created_at: ISO(daysAgo(s.joined)),
        updated_at: ISO(daysAgo(s.joined)),
      },
    ],
    bank_statutory: {
      id: `bs-${id}`,
      bank_name: ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank'][i % 4],
      account_number_masked: `XXXXXX${String(4000 + i).slice(-4)}`,
      ifsc: ['HDFC0001234', 'ICIC0005678', 'SBIN0009012', 'UTIB0003456'][i % 4],
      branch: l.city,
      account_type: 'salary',
      pan: panOf(s),
      aadhaar_masked: `XXXX-XXXX-${String(1000 + i * 7).slice(-4)}`,
      uan: `1001${String(20000000 + i * 137).slice(0, 8)}`,
      pf_number: `KN/BNG/${String(123450 + i)}/000/${String(1000 + i)}`,
      esi_number: monthlyCtc <= 21000 ? `31${String(10000000 + i * 99).slice(0, 15)}` : undefined,
      pt_applicable: true,
      lwf_applicable: true,
      tax_regime: i % 2 === 0 ? 'new' : 'old',
    },
  }
}

// ── Dashboard / analytics stats ─────────────────────────────────────────────

export function demoDashboardStats(): DashboardStats {
  const total = SEEDS.length
  const active = SEEDS.filter(s => (s.status ?? 'active') === 'active').length
  const deptCounts = demoDepartments.map(d => ({
    name: d.name,
    count: SEEDS.filter(s => s.deptId === d.id).length,
  }))
  return {
    total_employees: total,
    active_employees: active,
    new_joiners_this_month: SEEDS.filter(s => s.joined <= 30).length,
    separations_this_month: 1,
    department_breakdown: deptCounts,
    employment_type_breakdown: [
      { type: 'permanent', count: SEEDS.filter(s => (s.empType ?? 'permanent') === 'permanent').length },
      { type: 'probation', count: SEEDS.filter(s => s.empType === 'probation').length },
    ],
  }
}

// ── Attendance ──────────────────────────────────────────────────────────────

/** Build daily attendance rows for an employee for the given inclusive range. */
export function demoAttendanceRange(employeeId: string, from: string, to: string) {
  const s = SEEDS.find(e => e.id === employeeId) ?? SEEDS[0]
  const fromD = new Date(from + 'T00:00:00Z')
  const toD = new Date(to + 'T00:00:00Z')
  const daily: Array<Record<string, unknown>> = []
  const logs: Array<Record<string, unknown>> = []
  let present = 0, absent = 0, late = 0, hoursSum = 0, counted = 0
  const todayStr = DAY(NOW)

  for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = DAY(d)
    const dow = d.getUTCDay()
    if (dateStr > todayStr) continue
    const seed = (d.getUTCDate() + employeeId.charCodeAt(employeeId.length - 1)) % 10
    let status: string
    let workHours = 0
    let lateMin = 0
    let checkIn: string | null = null
    let checkOut: string | null = null

    if (dow === 0 || dow === 6) {
      status = 'weekly_off'
    } else if (seed === 3) {
      status = 'leave'
    } else if (seed === 7) {
      status = 'absent'
      absent++
    } else {
      const isLate = seed === 5
      status = isLate ? 'late' : 'present'
      workHours = isLate ? 7.5 : 8.5 + (seed % 3) * 0.25
      lateMin = isLate ? 35 : 0
      checkIn = isLate ? '09:35' : '09:02'
      checkOut = '18:15'
      present++
      if (isLate) late++
      hoursSum += workHours
      counted++
    }

    daily.push({
      id: `att-${employeeId}-${dateStr}`,
      date: dateStr,
      status,
      work_hours: workHours,
      late_minutes: lateMin,
      overtime_minutes: 0,
      shift_name: 'General Shift',
    })
    if (checkIn) {
      logs.push({ id: `log-${employeeId}-${dateStr}`, date: dateStr, check_in: checkIn, check_out: checkOut })
    }
  }

  return {
    employee: { id: s.id, name: `${s.first} ${s.last}`, employee_code: s.code },
    range: { from, to },
    summary: {
      total_days: daily.length,
      present,
      absent,
      late,
      avg_hours: counted ? Math.round((hoursSum / counted) * 10) / 10 : 0,
    },
    daily,
    logs,
  }
}

// ── Leave ──────────────────────────────────────────────────────────────────

export const demoLeaveTypes = [
  { id: 'lt-cl', tenant_id: DEMO_TENANT_ID, name: 'Casual Leave', code: 'CL', is_paid: true, max_days: 12, is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'lt-sl', tenant_id: DEMO_TENANT_ID, name: 'Sick Leave', code: 'SL', is_paid: true, max_days: 12, is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'lt-el', tenant_id: DEMO_TENANT_ID, name: 'Earned Leave', code: 'EL', is_paid: true, max_days: 21, is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'lt-ml', tenant_id: DEMO_TENANT_ID, name: 'Maternity Leave', code: 'ML', is_paid: true, max_days: 182, is_active: true, created_at: ISO(daysAgo(800)) },
]

export function demoLeaveBalances() {
  return [
    { id: 'lb-cl', leave_type_id: 'lt-cl', balance: 7.5, used: 4.5, leave_types: { name: 'Casual Leave', is_paid: true, max_days: 12 } },
    { id: 'lb-sl', leave_type_id: 'lt-sl', balance: 9, used: 3, leave_types: { name: 'Sick Leave', is_paid: true, max_days: 12 } },
    { id: 'lb-el', leave_type_id: 'lt-el', balance: 14, used: 7, leave_types: { name: 'Earned Leave', is_paid: true, max_days: 21 } },
  ]
}

export function demoMyLeaveRequests() {
  return [
    { id: 'lr-1', from_date: DAY(daysAgo(-5)), to_date: DAY(daysAgo(-3)), status: 'pending', computed_days: 3, reason: 'Family function', created_at: ISO(daysAgo(2)), leave_types: { id: 'lt-cl', name: 'Casual Leave' } },
    { id: 'lr-2', from_date: DAY(daysAgo(20)), to_date: DAY(daysAgo(20)), status: 'approved', computed_days: 1, reason: 'Personal work', created_at: ISO(daysAgo(25)), leave_types: { id: 'lt-cl', name: 'Casual Leave' } },
    { id: 'lr-3', from_date: DAY(daysAgo(45)), to_date: DAY(daysAgo(43)), status: 'approved', computed_days: 3, reason: 'Fever', created_at: ISO(daysAgo(48)), leave_types: { id: 'lt-sl', name: 'Sick Leave' } },
  ]
}

// ── Holidays ────────────────────────────────────────────────────────────────

export function demoHolidays(year: number) {
  const mk = (m: number, d: number, name: string, type = 'public') => ({
    id: `hol-${year}-${m}-${d}`,
    date: `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    name,
    holiday_type: type,
  })
  return [
    mk(1, 26, 'Republic Day'),
    mk(3, 14, 'Holi'),
    mk(4, 14, 'Dr. Ambedkar Jayanti'),
    mk(5, 1, 'May Day'),
    mk(8, 15, 'Independence Day'),
    mk(10, 2, 'Gandhi Jayanti'),
    mk(10, 20, 'Diwali', 'public'),
    mk(11, 1, 'Kannada Rajyotsava', 'optional'),
    mk(12, 25, 'Christmas'),
  ]
}

// ── Payroll ─────────────────────────────────────────────────────────────────

export function demoMyPayslips() {
  const slips: Array<Record<string, unknown>> = []
  const s = SEEDS[0]
  const { monthlyCtc } = demoCompensation(s.ctc)
  for (let i = 0; i < 6; i++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const gross = Math.round(monthlyCtc * 0.92)
    const deductions = Math.round(gross * 0.18)
    const lopDays = i === 2 ? 1 : 0
    const lopAmount = lopDays ? Math.round(gross / 30) : 0
    slips.push({
      slip_id: `slip-${month}`,
      month,
      gross_pay: gross,
      lop_amount: lopAmount,
      total_deductions: deductions,
      net_pay: gross - deductions - lopAmount,
      lop_days: lopDays,
      payable_days: 30 - lopDays,
      total_working_days: 30,
      overtime_hours: i === 1 ? 6 : 0,
      status: 'finalized',
      held_reason: null,
      warning: null,
      credit_date: `${month}-28`,
    })
  }
  return slips
}

export function demoPayrollRuns() {
  const runs: Array<Record<string, unknown>> = []
  for (let i = 0; i < 4; i++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const gross = 4250000 + i * 35000
    runs.push({
      id: `run-${month}`,
      month,
      status: i === 0 ? 'draft' : 'finalized',
      employee_count: SEEDS.length,
      total_gross: gross,
      total_net: Math.round(gross * 0.82),
      finalized_at: i === 0 ? null : ISO(new Date(d.getFullYear(), d.getMonth(), 28)),
      created_at: ISO(new Date(d.getFullYear(), d.getMonth(), 25)),
    })
  }
  return runs
}

// ── Control Center / operational health ─────────────────────────────────────

export function demoOperationalHealth() {
  const total = SEEDS.length
  const active = SEEDS.filter(s => (s.status ?? 'active') === 'active').length
  const runs = demoPayrollRuns()
  return {
    timestamp: ISO(NOW),
    overall_health: 'healthy',
    attendance_freshness: {
      health: 'healthy',
      total_active_employees: active,
      employees_with_data: active - 1,
      employees_stale: 1,
      employees_missing: 0,
      unprocessed_raw_logs: 12,
      oldest_unprocessed_hours: 3,
      hours_since_last_run: 2,
      last_processing_run_at: ISO(daysAgo(0)),
    },
    reconciliation: {
      attendance: { critical: 0, error: 1, warning: 2, info: 3, total: 6 },
      leave: { critical: 0, error: 0, warning: 1, info: 1, total: 2 },
    },
    scheduler: {
      health: 'healthy',
      heartbeats: demoSchedulerRows().map(r => ({
        scheduler_name: r.scheduler_name,
        status: r.status,
        tick_count: r.tick_count,
        last_error: r.last_error ?? null,
        age_seconds: r.age_seconds,
        is_stale: r.is_stale,
      })),
    },
    durable_queue: { pending: 4, running: 1, dead: 0 },
    payroll: {
      current_month: String(runs[0].month),
      current_run: {
        id: String(runs[0].id),
        status: String(runs[0].status),
        employee_count: total,
        total_gross: Number(runs[0].total_gross),
        total_net: Number(runs[0].total_net),
        finalized_at: null,
        created_at: String(runs[0].created_at),
      },
      prev_month: String(runs[1].month),
      prev_run: { id: String(runs[1].id), status: 'finalized', finalized_at: String(runs[1].finalized_at) },
    },
    platform: { status: 'healthy', uptime_seconds: 864000 },
  }
}

export function demoSchedulerRows() {
  return [
    { scheduler_name: 'leave_scheduler', last_heartbeat_at: ISO(daysAgo(0)), status: 'alive', tick_count: 14820, is_stale: false, age_seconds: 18, last_error: null },
    { scheduler_name: 'attendance_scheduler', last_heartbeat_at: ISO(daysAgo(0)), status: 'running', tick_count: 22140, is_stale: false, age_seconds: 5, last_error: null },
    { scheduler_name: 'payroll_scheduler', last_heartbeat_at: ISO(daysAgo(0)), status: 'alive', tick_count: 980, is_stale: false, age_seconds: 42, last_error: null },
    { scheduler_name: 'accrual', last_heartbeat_at: ISO(daysAgo(0)), status: 'alive', tick_count: 365, is_stale: false, age_seconds: 120, last_error: null },
    { scheduler_name: 'reconciliation', last_heartbeat_at: ISO(daysAgo(0)), status: 'alive', tick_count: 7300, is_stale: false, age_seconds: 60, last_error: null },
  ]
}

export function demoExceptionsSummary() {
  return {
    total: 9,
    open: 6,
    by_severity: { critical: 0, high: 2, medium: 3, low: 4 },
    by_category: { missing_punch: 3, late: 4, early_out: 2 },
  }
}

export function demoReconciliationOpen() {
  return [
    { id: 'rec-1', issue_type: 'attendance_payroll_mismatch', severity: 'warning', description: 'Payable days mismatch for 2 employees', created_at: ISO(daysAgo(1)), resolved: false },
    { id: 'rec-2', issue_type: 'leave_balance_drift', severity: 'low', description: 'Leave ledger drift on 1 account', created_at: ISO(daysAgo(2)), resolved: false },
  ]
}

export function demoEventLog() {
  return [
    { id: 'ev-1', event_type: 'payroll_finalized', created_at: ISO(daysAgo(1)), status: 'success', metadata: {} },
    { id: 'ev-2', event_type: 'scheduler_restarted', created_at: ISO(daysAgo(2)), status: 'info', metadata: {} },
    { id: 'ev-3', event_type: 'carry_forward', created_at: ISO(daysAgo(3)), status: 'success', metadata: {} },
    { id: 'ev-4', event_type: 'anomaly_detected', created_at: ISO(daysAgo(3)), status: 'warning', metadata: {} },
    { id: 'ev-5', event_type: 'freeze_lifted', created_at: ISO(daysAgo(5)), status: 'info', metadata: {} },
  ]
}

export function demoRegularisationPending() {
  return [
    { id: 'reg-1', employee_name: 'Arjun Nair', employee_code: 'SAAR006', date: DAY(daysAgo(4)), reason: 'Forgot to punch out after client meeting', status: 'pending', created_at: ISO(daysAgo(3)) },
    { id: 'reg-2', employee_name: 'Sneha Reddy', employee_code: 'SAAR005', date: DAY(daysAgo(6)), reason: 'Biometric not captured at gate', status: 'pending', created_at: ISO(daysAgo(5)) },
  ]
}

export function demoLastRun() {
  return {
    id: 'run-att-last',
    status: 'completed',
    completed_at: ISO(daysAgo(0)),
    started_at: ISO(NOW),
    processed_count: SEEDS.length,
    error_message: null,
    duration_ms: 4200,
  }
}

/** Muster roll — GET /attendance/muster?month=YYYY-MM. */
export function demoMuster(month: string) {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const todayStr = DAY(NOW)
  const employees = SEEDS.slice(0, 12).map(s => {
    const days: Array<{ date: string; status: string | null; work_hours: number }> = []
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const dateStr = `${month}-${String(dd).padStart(2, '0')}`
      const dow = new Date(y, m - 1, dd).getDay()
      let status: string | null
      let wh = 0
      if (dateStr > todayStr) status = null
      else if (dow === 0 || dow === 6) status = 'weekly_off'
      else {
        const seed = (dd + s.code.charCodeAt(s.code.length - 1)) % 10
        if (seed === 7) status = 'absent'
        else if (seed === 3) status = 'leave'
        else { status = 'present'; wh = 8.5 }
      }
      days.push({ date: dateStr, status, work_hours: wh })
    }
    return { employee_id: s.id, name: `${s.first} ${s.last}`, days }
  })
  return { month, employees }
}

// ── Payroll run slips (summary list for admin slip-list panel) ──────────────

export function demoPayrollRunSlips(runId: string) {
  const runs = demoPayrollRuns()
  const runIdx = runs.findIndex(r => r.id === runId)
  const run = runs[runIdx] ?? runs[0]
  const month = String(run.month)
  return SEEDS.map(s => {
    const { monthlyCtc, components } = demoCompensation(s.ctc)
    const gross = Math.round(monthlyCtc * 0.92)
    const deductions = Math.round(gross * 0.18)
    const empContribs = Math.round(monthlyCtc * 0.135)
    return {
      slip_id: `slip-${s.id}-${month}`,
      employee_id: s.id,
      employee_name: `${s.first} ${s.last}`,
      employee_code: s.code,
      month,
      total_working_days: 26,
      payable_days: 26,
      lop_days: 0,
      overtime_hours: 0,
      ctc_monthly: monthlyCtc,
      gross_pay: gross,
      lop_amount: 0,
      total_deductions: deductions,
      net_pay: gross - deductions,
      employer_contributions: empContribs,
      status: run.status === 'draft' ? 'draft' : 'finalized',
      held_reason: null,
      warning: null,
      component_breakdown: components.map((c, idx) => ({
        salary_component_id: `sc-${c.code}-${s.id}`,
        name: c.name,
        code: c.code,
        component_type: c.type,
        calc_type: c.calculation_type,
        value: c.value,
        monthly_amount: c.monthly_amount,
        annual_amount: c.annual_amount,
        sequence: idx + 1,
      })),
    }
  })
}

/** Full payslip detail for a specific slip ID. */
export function demoPayrollSlipDetail(slipId: string) {
  // Parse emp ID from slip ID pattern slip-emp-XXXX-YYYY-MM
  const empMatch = slipId.match(/slip-(emp-\d+)-(\d{4}-\d{2})/)
  const empId = empMatch?.[1] ?? 'emp-0001'
  const month = empMatch?.[2] ?? new Date().toISOString().slice(0, 7)
  const s = SEEDS.find(e => e.id === empId) ?? SEEDS[0]
  const { monthlyCtc, components } = demoCompensation(s.ctc)
  const gross = Math.round(monthlyCtc * 0.92)
  const deductions = Math.round(gross * 0.18)
  const empContribs = Math.round(monthlyCtc * 0.135)
  return {
    slip_id: slipId,
    employee_id: s.id,
    employee_name: `${s.first} ${s.last}`,
    employee_code: s.code,
    month,
    total_working_days: 26,
    payable_days: 26,
    lop_days: 0,
    overtime_hours: 0,
    ctc_monthly: monthlyCtc,
    gross_pay: gross,
    lop_amount: 0,
    total_deductions: deductions,
    net_pay: gross - deductions,
    employer_contributions: empContribs,
    status: 'finalized',
    held_reason: null,
    warning: null,
    credit_date: `${month}-28`,
    component_breakdown: components.map((c, idx) => ({
      salary_component_id: `sc-${c.code}-${s.id}`,
      name: c.name,
      code: c.code,
      component_type: c.type,
      calc_type: c.calculation_type,
      value: c.value,
      monthly_amount: c.monthly_amount,
      annual_amount: c.annual_amount,
      sequence: idx + 1,
    })),
  }
}

/** Month-over-month variance report for a payroll run. */
export function demoVarianceReport(runId: string) {
  const runs = demoPayrollRuns()
  const idx = runs.findIndex(r => r.id === runId)
  const curr = runs[idx] ?? runs[0]
  const prev = runs[idx + 1] ?? runs[1]
  const grossChange = Number(curr.total_gross) - Number(prev.total_gross)
  const netChange   = Number(curr.total_net)   - Number(prev.total_net)
  return {
    has_previous: true,
    current_month: String(curr.month),
    previous_month: String(prev.month),
    summary: {
      gross_change:       grossChange,
      gross_change_pct:   Math.round((grossChange / Number(prev.total_gross)) * 1000) / 10,
      net_change:         netChange,
      net_change_pct:     Math.round((netChange / Number(prev.total_net)) * 1000) / 10,
      employees_changed:  3,
      total_employees:    SEEDS.length,
      total_current_net:  Number(curr.total_net),
      total_prev_net:     Number(prev.total_net),
    },
    employees: SEEDS.slice(0, 5).map(s => {
      const { monthlyCtc, components } = demoCompensation(s.ctc)
      const gross = Math.round(monthlyCtc * 0.92)
      const ded   = Math.round(gross * 0.18)
      const net   = gross - ded
      return {
        employee_id:   s.id,
        employee_name: `${s.first} ${s.last}`,
        employee_code: s.code,
        is_new: false,
        current:  { gross_pay: gross,   net_pay: net,   lop_days: 0, lop_amount: 0, payable_days: 26, total_deductions: ded },
        previous: { gross_pay: gross - 2000, net_pay: net - 1600, lop_days: 0, lop_amount: 0, payable_days: 26, total_deductions: ded - 400 },
        diff: { gross_pay: 2000, net_pay: 1600, lop_days: 0 },
        component_breakdown: components.map(c => ({ code: c.code, name: c.name, component_type: c.type })),
      }
    }),
  }
}

/** Payroll run detail (single run). */
export function demoPayrollRunDetail(runId: string) {
  const runs = demoPayrollRuns()
  return runs.find(r => r.id === runId) ?? runs[0]
}

export const demoShifts = [
  { id: 'shift-gen', tenant_id: DEMO_TENANT_ID, name: 'General Shift', code: 'GEN', start_time: '09:00', end_time: '18:00', duration_hours: 9, is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'shift-early', tenant_id: DEMO_TENANT_ID, name: 'Early Shift', code: 'EARLY', start_time: '07:00', end_time: '16:00', duration_hours: 9, is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'shift-night', tenant_id: DEMO_TENANT_ID, name: 'Night Shift', code: 'NIGHT', start_time: '22:00', end_time: '07:00', duration_hours: 9, is_active: true, created_at: ISO(daysAgo(800)) },
]

// ── Generic master list helpers ─────────────────────────────────────────────

export const demoIdentityTypes = [
  { id: 'it-aadhaar', tenant_id: DEMO_TENANT_ID, name: 'Aadhaar', code: 'AADHAAR', is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'it-pan', tenant_id: DEMO_TENANT_ID, name: 'PAN', code: 'PAN', is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'it-dl', tenant_id: DEMO_TENANT_ID, name: 'Driving Licence', code: 'DL', is_active: true, created_at: ISO(daysAgo(800)) },
]

export const demoRelationshipTypes = [
  { id: 'rt-spouse', tenant_id: DEMO_TENANT_ID, name: 'Spouse', code: 'SPOUSE', is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'rt-father', tenant_id: DEMO_TENANT_ID, name: 'Father', code: 'FATHER', is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'rt-mother', tenant_id: DEMO_TENANT_ID, name: 'Mother', code: 'MOTHER', is_active: true, created_at: ISO(daysAgo(800)) },
  { id: 'rt-child', tenant_id: DEMO_TENANT_ID, name: 'Child', code: 'CHILD', is_active: true, created_at: ISO(daysAgo(800)) },
]

// ── Attendance ops / pipeline (flat shapes; pages read fields directly) ───────

const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

export function demoAttendanceOpsStats() {
  const n = demoEmployeeList.length
  return {
    unresolved_anomalies: 0,
    pending_corrections: 0,
    staffing_pressure: 0,
    overnight_issues: 0,
    confidence_warnings: 0,
    recompute_backlog: 0,
    payroll_continuity_gaps: 0,
    is_processing: false,
    active_period_month: CURRENT_MONTH,
    active_period_summary: {
      active_month: CURRENT_MONTH,
      is_historical: false,
      present: n - 2,
      late: 1,
      absent: 1,
      half_day: 0,
      leave: 1,
      payable_days: n * 22,
      lop_days: 0,
      missing_punch: 0,
      total_employees: n,
    },
    today_snapshot: {
      snapshot_date: new Date().toISOString().slice(0, 10),
      present:  n - 2,
      late:     1,
      absent:   1,
      half_day: 0,
      on_leave: 1,
      wfh:      0,
      total:    n,
    },
  }
}

export function demoPipelineStats() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    raw_log_count_30d: 0,
    processing_runs_30d: 22,
    last_batch_run_date: today,
    last_batch_ran_at: ISO(daysAgo(0)),
    batch_employees_last: demoEmployeeList.length,
    batch_last_error: null,
    punch_log_count_30d: demoEmployeeList.length * 22,
    csv_employees_30d: demoEmployeeList.length,
    daily_rows_from_csv: demoEmployeeList.length * 22,
    csv_date_range: { from: `${CURRENT_MONTH}-01`, to: today },
    upload_count_30d: 3,
    last_upload_at: ISO(daysAgo(1)),
    active_source: 'csv' as const,
  }
}

export function demoProcessStatus() {
  return { is_running: false, started_at: null, started_by: null, lock_ttl_seconds: null }
}

// Processing runs history (Operational Health).
export function demoProcessRuns() {
  return [0, 1, 2, 3, 4].map(i => ({
    id: `run-att-${i}`,
    status: 'completed',
    completed_at: ISO(daysAgo(i)),
    started_at: ISO(daysAgo(i)),
    processed_count: SEEDS.length,
    skipped_count: 0,
    incomplete_count: 0,
    error_message: null,
    duration_ms: 4000 + i * 120,
  }))
}

// Attendance AI intelligence — returned BOTH flat and wrapped (.data) so
// OperationalHealth (flat) and WorkforceIntelligence (.data) both work.
export function demoAttendanceIntelligence() {
  const summary = {
    at_risk_count: 1,
    open_anomalies: 0,
    avg_risk_score: 22,
    computed_at: new Date().toISOString(),
  }
  const at_risk = [
    {
      employee_id: demoEmployeeList[5].id,
      name: `${demoEmployeeList[5].first_name} ${demoEmployeeList[5].last_name}`,
      employee_code: demoEmployeeList[5].employee_code,
      risk_score: 42,
      reasons: ['2 late arrivals in last 14 days'],
      anomaly_count: 0,
      flag_types: ['punctuality'] as string[],
    },
  ]
  const last14 = Array.from({ length: 14 }, (_, k) => {
    const d = DAY(daysAgo(13 - k))
    return { date: d, open: 0, resolved: k % 5 === 0 ? 1 : 0, total: k % 5 === 0 ? 1 : 0 }
  })
  const trends = {
    daily: last14,
    anomaly_by_type: { late_arrival: 3, missing_punch: 1 } as Record<string, number>,
    anomaly_by_severity: { low: 3, medium: 1 } as Record<string, number>,
  }
  const patterns = {
    repeat_offenders: [] as typeof at_risk,
    top_anomaly_types: [
      { type: 'late_arrival', count: 3, pct: 75 },
      { type: 'missing_punch', count: 1, pct: 25 },
    ],
  }
  return { summary, at_risk, trends, patterns, data: { summary, at_risk, trends, patterns }, cached: true, computed_at: new Date().toISOString() }
}

export function demoUploadHealth() {
  return {
    status: 'healthy' as const,
    summary: {
      total_last_30d: 3,
      completed: 3,
      failed: 0,
      orphaned: 0,
      partial_failures: 0,
      replay_uploads: 0,
    },
    recent_failures: [] as Array<{ id: string; file_name: string | null; created_at: string; error_message: string | null; result_summary: Record<string, unknown> | null }>,
    stale_uploads: [] as Array<{ id: string; file_name: string | null; created_at: string }>,
    last_successful_upload: ISO(daysAgo(1)),
  }
}

export function demoUploadSessions() {
  const mk = (i: number, name: string, total: number, ok: number, fail: number) => ({
    id: `ups-${i}`,
    status: fail > 0 ? 'completed_with_errors' : 'completed',
    file_name: name,
    file_size: 12000 + i * 800,
    created_at: ISO(daysAgo(i * 7 + 1)),
    result_summary: { total_rows: total, success_rows: ok, failed_rows: fail, is_replay: false },
  })
  return [
    mk(0, 'attendance_jun_2026.csv', demoEmployeeList.length * 22, demoEmployeeList.length * 22, 0),
    mk(1, 'attendance_may_2026.csv', demoEmployeeList.length * 21, demoEmployeeList.length * 21, 0),
    mk(2, 'attendance_apr_2026.csv', demoEmployeeList.length * 22, demoEmployeeList.length * 22, 0),
  ]
}

// ── Leave governance ─────────────────────────────────────────────────────────

export function demoSessionAnalytics() {
  return {
    total_requests: 48,
    half_day_count: 6,
    cross_session_count: 2,
    hourly_count: 3,
    by_type: [
      { leave_type_name: 'Casual Leave', full_day: 14, first_half: 2, second_half: 2, cross_session: 0 },
      { leave_type_name: 'Sick Leave',   full_day: 11, first_half: 2, second_half: 1, cross_session: 1 },
      { leave_type_name: 'Earned Leave', full_day: 12, first_half: 0, second_half: 0, cross_session: 1 },
      { leave_type_name: 'Comp Off',     full_day: 3,  first_half: 1, second_half: 0, cross_session: 0 },
    ],
  }
}

// Paginated "My leave requests" — richer history with mixed statuses.
export function demoMyLeaveRequestsPaged(page: number, limit: number, status?: string) {
  const lt = (id: string, name: string, is_paid = true) => ({ id, name, is_paid })
  const all = [
    { id: 'lr-01', leave_type_id: 'lt-cl', from_date: DAY(daysAgo(-6)), to_date: DAY(daysAgo(-4)), computed_days: 3, half_day: false, status: 'PENDING',   reason: 'Sister’s wedding', rejection_reason: null, created_at: ISO(daysAgo(1)),  leave_types: lt('lt-cl', 'Casual Leave') },
    { id: 'lr-02', leave_type_id: 'lt-sl', from_date: DAY(daysAgo(4)),  to_date: DAY(daysAgo(4)),  computed_days: 0.5, half_day: true,  status: 'APPROVED',  reason: 'Doctor appointment', rejection_reason: null, created_at: ISO(daysAgo(6)),  leave_types: lt('lt-sl', 'Sick Leave') },
    { id: 'lr-03', leave_type_id: 'lt-el', from_date: DAY(daysAgo(28)), to_date: DAY(daysAgo(24)), computed_days: 5, half_day: false, status: 'APPROVED',  reason: 'Goa vacation', rejection_reason: null, created_at: ISO(daysAgo(35)), leave_types: lt('lt-el', 'Earned Leave') },
    { id: 'lr-04', leave_type_id: 'lt-cl', from_date: DAY(daysAgo(40)), to_date: DAY(daysAgo(40)), computed_days: 1, half_day: false, status: 'APPROVED',  reason: 'Personal work', rejection_reason: null, created_at: ISO(daysAgo(44)), leave_types: lt('lt-cl', 'Casual Leave') },
    { id: 'lr-05', leave_type_id: 'lt-sl', from_date: DAY(daysAgo(55)), to_date: DAY(daysAgo(53)), computed_days: 3, half_day: false, status: 'APPROVED',  reason: 'Viral fever', rejection_reason: null, created_at: ISO(daysAgo(58)), leave_types: lt('lt-sl', 'Sick Leave') },
    { id: 'lr-06', leave_type_id: 'lt-cl', from_date: DAY(daysAgo(62)), to_date: DAY(daysAgo(61)), computed_days: 2, half_day: false, status: 'REJECTED',  reason: 'Out of town', rejection_reason: 'Team release week — please re-plan', created_at: ISO(daysAgo(66)), leave_types: lt('lt-cl', 'Casual Leave') },
    { id: 'lr-07', leave_type_id: 'lt-el', from_date: DAY(daysAgo(80)), to_date: DAY(daysAgo(78)), computed_days: 3, half_day: false, status: 'CANCELLED', reason: 'Plans changed', rejection_reason: null, created_at: ISO(daysAgo(85)), leave_types: lt('lt-el', 'Earned Leave') },
    { id: 'lr-08', leave_type_id: 'lt-el', from_date: DAY(daysAgo(95)), to_date: DAY(daysAgo(91)), computed_days: 5, half_day: false, status: 'APPROVED',  reason: 'Festival break', rejection_reason: null, created_at: ISO(daysAgo(100)), leave_types: lt('lt-el', 'Earned Leave') },
  ]
  const filtered = status ? all.filter(r => r.status === status) : all
  const start = (Math.max(1, page) - 1) * limit
  const slice = filtered.slice(start, start + limit)
  return { data: slice, pagination: { page: Math.max(1, page), limit, total: filtered.length, has_more: start + limit < filtered.length } }
}

// Attendance change audit trail.
export function demoAttendanceAudit() {
  const pick = (i: number) => demoEmployeeList[i % demoEmployeeList.length]
  const mk = (i: number, before: string | null, after: string, source: string, byIdx: number) => {
    const e = pick(i)
    const by = demoEmployeeList[byIdx]
    return {
      id: `aud-${i}`,
      date: DAY(daysAgo(i)),
      source,
      before_status: before,
      after_status: after,
      created_at: ISO(daysAgo(i)),
      employee_name: `${e.first_name} ${e.last_name}`,
      employee_code: e.employee_code,
      changed_by_name: `${by.first_name} ${by.last_name}`,
    }
  }
  return [
    mk(0, 'absent',  'present',  'regularisation', 0),
    mk(1, null,      'present',  'biometric',      2),
    mk(2, 'absent',  'leave',    'leave_approval', 0),
    mk(3, 'present', 'half_day', 'correction',     10),
    mk(4, null,      'present',  'csv_upload',     0),
    mk(5, 'late',    'present',  'regularisation', 6),
    mk(6, null,      'present',  'biometric',      2),
    mk(7, 'absent',  'present',  'correction',     0),
  ]
}

// Hired pipeline (preboarding tracking).
export function demoHiredPipeline() {
  const mk = (
    id: string, first: string, last: string, email: string, title: string, reqTitle: string, dept: string,
    offer: number, joinDaysAhead: number, pjStatus: string | null, invitationId: string | null, submitted: boolean,
  ) => ({
    id, status: 'hired', offer_amount: offer,
    expected_joining: DAY(daysAgo(-joinDaysAhead)),
    preboarding_initiated_at: invitationId ? ISO(daysAgo(7)) : null,
    pre_joinee_invitation_id: invitationId,
    created_at: ISO(daysAgo(20)), updated_at: ISO(daysAgo(3)),
    candidates: { id: `cand-${id}`, first_name: first, last_name: last, email, phone: '+91 98xxxxxx12', current_title: title },
    job_requisitions: { id: `req-${id}`, title: reqTitle, departments: { name: dept } },
    pre_joinee: pjStatus ? { id: `pj-${id}`, status: pjStatus, joining_date: DAY(daysAgo(-joinDaysAhead)), submitted_at: submitted ? ISO(daysAgo(2)) : null } : null,
  })
  return [
    mk('h1', 'Nandini', 'Gupta',  'nandini.gupta@example.in',  'DevOps Engineer',     'Senior Software Engineer', 'Engineering', 2100000, 21, 'submitted', 'inv-h1', true),
    mk('h2', 'Arjun',   'Rampal', 'arjun.rampal@example.in',   'UX/UI Designer',      'Senior Software Engineer', 'Engineering', 1850000, 30, 'pending',   'inv-h2', false),
    mk('h3', 'Farhan',  'Qureshi','farhan.qureshi@example.in', 'Finance Analyst',     'Finance Analyst',          'Finance',     1150000, 14, 'approved',  'inv-h3', true),
    mk('h4', 'Ishita',  'Roy',    'ishita.roy@example.in',     'Sales Executive',     'Sales Manager',            'Sales',       900000,  45, null,        null,    false),
  ]
}

// Event-based leave grants (festival/birthday etc.).
export function demoEventGrants() {
  const e1 = demoEmployeeList[2], e2 = demoEmployeeList[6], e3 = demoEmployeeList[11]
  const mk = (id: string, e: typeof e1, days: number, status: string, dt: string) => ({
    id, employee_id: e.id, leave_type_id: 'lt-cl', date_type_id: 'dt-fest',
    event_year: new Date().getFullYear(), grant_date: DAY(daysAgo(30)), days_granted: days,
    expiry_date: DAY(daysAgo(-90)), status,
    employees: { first_name: e.first_name, last_name: e.last_name, employee_code: e.employee_code },
    leave_types: { name: 'Casual Leave' },
    important_date_types: { name: dt, code: dt.slice(0, 4).toUpperCase() },
  })
  return [
    mk('eg-1', e1, 1, 'active', 'Festival'),
    mk('eg-2', e2, 1, 'used',   'Birthday'),
    mk('eg-3', e3, 1, 'active', 'Work Anniversary'),
  ]
}

export function demoReconciliationRuns() {
  return [
    { id: 'rec-1', run_date: ISO(daysAgo(1)),  year: new Date().getFullYear(), trigger: 'scheduled', issues_found: 0, employees_checked: demoEmployeeList.length, severity: 'ok' as const, report_data: { issue_breakdown: { critical: 0, high: 0, medium: 0, low: 0 }, details: [] } },
    { id: 'rec-2', run_date: ISO(daysAgo(8)),  year: new Date().getFullYear(), trigger: 'scheduled', issues_found: 1, employees_checked: demoEmployeeList.length, severity: 'low' as const, report_data: { issue_breakdown: { critical: 0, high: 0, medium: 0, low: 1 }, details: [{ employee_id: demoEmployeeList[5].id, employee_name: `${demoEmployeeList[5].first_name} ${demoEmployeeList[5].last_name}`, issue_type: 'balance_drift', description: 'Carry-forward rounding of 0.5 day', severity: 'low' }] } },
    { id: 'rec-3', run_date: ISO(daysAgo(31)), year: new Date().getFullYear(), trigger: 'manual',    issues_found: 0, employees_checked: demoEmployeeList.length, severity: 'ok' as const, report_data: { issue_breakdown: { critical: 0, high: 0, medium: 0, low: 0 }, details: [] } },
  ]
}

// Workforce Command observations.
export function demoWorkforceCommandData() {
  const n = demoEmployeeList.length
  return {
    summary: 'Workforce is stable. One probation review is due this week and one employee is serving notice.',
    critical_count: 0,
    high_count: 1,
    observations: [
      {
        id: 'obs-1', category: 'onboarding', severity: 'medium' as const,
        title: 'Probation review due', body: 'Arjun Nair completes probation in 6 days. Schedule the confirmation review and update status.',
        source_records: [{ table: 'employees', count: 1, sample: 'SAAR006' }], generated_at: new Date().toISOString(),
      },
      {
        id: 'obs-2', category: 'separation', severity: 'high' as const,
        title: 'Notice period in progress', body: 'Imran Khan is on notice. Initiate asset recovery and knowledge transfer checklist.',
        source_records: [{ table: 'separations', count: 1, sample: 'SAAR022' }], generated_at: new Date().toISOString(),
      },
      {
        id: 'obs-3', category: 'attendance', severity: 'info' as const,
        title: 'Attendance healthy', body: `${n - 2} of ${n} employees are present today with no open anomalies.`,
        source_records: [{ table: 'attendance_daily', count: n }], generated_at: new Date().toISOString(),
      },
    ],
    kpis: {
      on_notice: 1, stalled_onboarding: 0, pending_separations: 1,
      assets_at_risk: 0, probation_due: 1, active_headcount: n, joiners_this_month: 1,
    } as Record<string, number | string | null>,
    generated_at: new Date().toISOString(),
  }
}

// Action Center suggestions.
export function demoActionObservations() {
  return [
    { id: 'ac-1', event_type: 'new_hire',           title: 'New joiner this week', suggestion: 'Aditya Kulkarni joined Sales. Confirm asset allocation and induction schedule.', source_table: 'employees',  source_count: 1, generated_at: new Date().toISOString() },
    { id: 'ac-2', event_type: 'on_notice',          title: 'Employee on notice',    suggestion: 'Imran Khan is serving notice. Plan backfill and start clearance.', source_table: 'separations', source_count: 1, generated_at: new Date().toISOString() },
    { id: 'ac-3', event_type: 'asset_assigned',     title: 'Assets pending return', suggestion: 'Review assets assigned to employees in separation to avoid overlap.', source_table: 'assets', source_count: 2, generated_at: new Date().toISOString() },
  ]
}

// ── Compliance / statutory ───────────────────────────────────────────────────

export function demoComplianceStatsModule(covered: number) {
  return {
    employees_covered: covered,
    employees_missing: 0,
    filing_gaps: 0,
    computation_errors: 0,
    next_deadline: null as string | null,
    days_to_deadline: null as number | null,
    is_ready: true,
  }
}

export function demoComplianceStats() {
  const n = demoEmployeeList.length
  return {
    epf:  demoComplianceStatsModule(n),
    esi:  demoComplianceStatsModule(0),
    ptax: demoComplianceStatsModule(n),
    tds:  demoComplianceStatsModule(n),
    total_filing_gaps: 0,
    total_coverage_gaps: 0,
    total_computation_errors: 0,
    critical_deadline_days: null as number | null,
  }
}

export function demoStatutoryData() {
  const n = demoEmployeeList.length
  const epfRemit = Math.round(n * 3600)
  const ptaxAmt  = n * 200
  const tdsAmt   = Math.round(n * 4200)
  return {
    coverage: {
      epf:  { enrolled: n, missing_uan: 0, has_registration: true },
      esi:  { eligible: 0, has_registration: true },
      ptax: { enrolled: n, states: ['Karnataka', 'Maharashtra'], missing_registrations: [] as string[] },
      tds:  { employees_with_tds: n, missing_pan: 0 },
      lwf:  { enrolled: n, states: ['Karnataka', 'Maharashtra'] },
      payroll: { finalized: n, total: n, all_finalized: true },
    },
    totals: {
      epf:  { total_remittance: epfRemit },
      esi:  { total_remittance: 0 },
      ptax: { amount: ptaxAmt },
      tds:  { total_deducted: tdsAmt },
      lwf:  { total_remittance: n * 20 },
      grand_total: epfRemit + ptaxAmt + tdsAmt + n * 20,
    },
    readiness: { overall: true, issues: [] as string[] },
  }
}

export function demoStatutoryExceptions() {
  const n = demoEmployeeList.length
  return {
    summary: { total_employees: n, complete: n, incomplete: 0, completeness_pct: 100 },
    by_field: [] as Array<{ field: string; label: string; missing: number }>,
    employees: [] as Array<{ id: string; employee_code: string; name: string; department: string; missing: string[] }>,
  }
}

export function demoExecutiveCompliance() {
  return {
    open_duplicates: 0,
    compliance_risk_score: 18,
    risk_status: 'low' as const,
    posture_components: {
      trust:         { score: 92, weight: 0.25 },
      compliance:    { score: 96, weight: 0.25 },
      governance:    { score: 90, weight: 0.15 },
      security:      { score: 94, weight: 0.15 },
      privacy:       { score: 95, weight: 0.10 },
      certification: { score: 88, weight: 0.10 },
    },
    trust_distribution: { high: demoEmployeeList.length - 2, medium: 2, low: 0 },
    trust_trend: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map((month, i) => ({
      month, avg_score: 88 + i,
    })),
  }
}

export function demoComplianceCalendar() {
  const mk = (id: string, label: string, type: string, jur: string, due: string, status: string, days: number) => ({
    id, compliance_type: type, label,
    jurisdiction: jur, period: CURRENT_MONTH, period_label: 'This month',
    due_date: due, status, days_to_due: days, filed_at: null as string | null, reference: null as string | null,
  })
  const y = new Date().getFullYear()
  const mo = String(new Date().getMonth() + 1).padStart(2, '0')
  const data = [
    mk('cal-epf', 'EPF ECR filing', 'EPF', 'Central', `${y}-${mo}-15`, 'upcoming', 9),
    mk('cal-esi', 'ESI contribution', 'ESI', 'Central', `${y}-${mo}-15`, 'upcoming', 9),
    mk('cal-pt',  'Professional Tax remittance', 'PT', 'Karnataka', `${y}-${mo}-20`, 'upcoming', 14),
    mk('cal-tds', 'TDS deposit (Form 26Q)', 'TDS', 'Central', `${y}-${mo}-07`, 'due_soon', 2),
  ]
  return {
    data,
    counts: { upcoming: 3, due_soon: 1, overdue: 0, completed: 0 },
  }
}

// ── Recruitment analytics (GET /recruitment/analytics) ──────────────────────
export function demoRecruitmentAnalytics() {
  return {
    funnel: { applied: 142, screening: 68, interviewing: 31, offer: 12, hired: 8, rejected: 54, withdrawn: 9 },
    avg_time_to_hire:  24,
    avg_time_to_offer: 18,
    requisitions: { draft: 3, open: 11, on_hold: 2, filled: 7, cancelled: 1 },
    interviews:   { scheduled: 9, completed: 47, cancelled: 4, no_show: 3 },
    pass_rate: 62,
    source_breakdown: [
      { source: 'referral', count: 38 },
      { source: 'linkedin', count: 34 },
      { source: 'naukri',   count: 29 },
      { source: 'portal',   count: 21 },
      { source: 'direct',   count: 14 },
      { source: 'agency',   count: 6 },
    ],
    recent_30d_applications: 37,
    total_applications: 142,
    total_requisitions: 24,
  }
}

// ── Interviewer calibration (GET /recruitment/analytics/interviewers) ───────
export function demoInterviewerAnalytics() {
  const interviewers = demoEmployeeList.slice(0, 5).map((e, i) => ({
    interviewer_id: e.id,
    name: `${e.first_name} ${e.last_name}`,
    scored_count:    [18, 14, 11, 9, 6][i],
    avg_overall:     [3.8, 4.1, 3.4, 3.9, 3.6][i],
    leniency:        [0.2, 0.7, -0.6, 0.1, -0.3][i],
    consistency:     [0.82, 0.74, 0.69, 0.88, 0.71][i],
    positive_rate:   [0.55, 0.71, 0.36, 0.6, 0.5][i],
    recommendations: {
      strong_yes: [3, 5, 1, 4, 2][i],
      yes:        [7, 5, 3, 4, 2][i],
      no:         [6, 3, 5, 1, 2][i],
      strong_no:  [2, 1, 2, 0, 0][i],
    },
    hire_accuracy:   [0.78, 0.66, 0.7, 0.81, 0.6][i],
    reject_accuracy: [0.72, 0.6, 0.75, 0.69, 0.58][i],
    decisions_with_outcome: [12, 9, 8, 7, 4][i],
  }))
  const criteria = [
    { criterion: 'technical_skills', avg_hired: 4.2, avg_rejected: 2.6, lift: 1.6, sample_hired: 8, sample_rejected: 22 },
    { criterion: 'problem_solving',  avg_hired: 4.0, avg_rejected: 2.8, lift: 1.2, sample_hired: 8, sample_rejected: 22 },
    { criterion: 'communication',    avg_hired: 3.8, avg_rejected: 3.1, lift: 0.7, sample_hired: 8, sample_rejected: 22 },
    { criterion: 'culture_fit',      avg_hired: 4.1, avg_rejected: 3.3, lift: 0.8, sample_hired: 8, sample_rejected: 22 },
    { criterion: 'leadership',       avg_hired: 3.6, avg_rejected: 3.0, lift: 0.6, sample_hired: 5, sample_rejected: 14 },
  ]
  return {
    cohort_avg_overall: 3.7,
    total_scores: 58,
    interviewers,
    criteria,
    agreement: { multi_scorer_rounds: 14, avg_score_spread: 0.62, unanimous_rate: 0.57 },
  }
}

// ── Executive snapshots (GET /executive/ceo|chro|workforce|financial|trends) ─
const EXEC_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

export function demoExecCeo() {
  return {
    data: {
      employee_count: 22, joiners_30d: 3, exits_30d: 1,
      net_headcount_change: 2, attendance_rate: 94.6, absence_rate: 5.4,
      payroll_cost_current: 4820000, payroll_net_current: 3960000, avg_cost_per_employee: 219000,
      open_exceptions: 4, open_incidents: 1, pending_revisions: 2, total_attention_items: 7,
      narrative: 'Workforce steady at 22 active employees — 3 joiners and 1 exit in the last 30 days. Attendance is healthy at 94.6% and payroll is on track at ₹48.2L gross this month, with 4 open exceptions to clear.',
    },
  }
}

export function demoExecChro() {
  return {
    data: {
      gender_distribution: { Male: 13, Female: 9 },
      employment_type_distribution: { permanent: 19, contract: 2, intern: 1 },
      leave_utilization_pct: 58, trust_high_risk: 2,
      narrative: 'Leave utilisation sits at 58% of entitlement with diversity at 41% women. Two employees are flagged high-risk by trust scoring; 82% of the workforce is identity-verified.',
      trust_verified: 18, trust_total: 22, trust_verification_pct: 82,
      pending_revisions: 2, approved_revisions: 5,
      recruitment_active: true,
      hiring_funnel: { applied: 142, screening: 68, interviewing: 31, offer: 12, hired: 8 },
      offers_extended: 12, offers_accepted: 8, offer_acceptance_rate: 67,
      avg_time_to_offer: 18, avg_time_to_hire: 24, open_requisitions: 11,
    },
  }
}

export function demoExecWorkforce() {
  return {
    data: {
      employee_count: 22,
      monthly_trends: EXEC_MONTHS.map((month, i) => ({ month, joiners: [2, 1, 3, 1, 2, 3][i], exits: [1, 0, 1, 1, 0, 1][i], net: [1, 1, 2, 0, 2, 2][i] })),
      dept_distribution: [
        { dept: 'Engineering', count: 8, pct: 36 },
        { dept: 'Sales',       count: 4, pct: 18 },
        { dept: 'Finance',     count: 3, pct: 14 },
        { dept: 'HR',          count: 3, pct: 14 },
        { dept: 'Operations',  count: 2, pct: 9 },
        { dept: 'Marketing',   count: 2, pct: 9 },
      ],
      employment_type_distribution: [
        { type: 'Permanent', count: 19, pct: 86 },
        { type: 'Contract',  count: 2,  pct: 9 },
        { type: 'Intern',    count: 1,  pct: 5 },
      ],
      gender_distribution: { Male: 13, Female: 9 },
      total_joiners_period: 12, total_exits_period: 4,
    },
  }
}

export function demoExecFinancial() {
  return {
    data: {
      payroll_current_gross: 4820000, payroll_current_net: 3960000, payroll_mom_change: 3.2,
      payroll_cost_trend: EXEC_MONTHS.map((month, i) => ({ month, total_gross: 4400000 + i * 90000, employee_count: 18 + i, avg_cost_per_head: Math.round((4400000 + i * 90000) / (18 + i)) })),
      dept_cost_breakdown: [
        { dept: 'Engineering', headcount: 8, total_gross: 2280000, total_net: 1870000, ot_cost: 48000 },
        { dept: 'Sales',       headcount: 4, total_gross: 940000,  total_net: 760000,  ot_cost: 22000 },
        { dept: 'Finance',     headcount: 3, total_gross: 620000,  total_net: 510000,  ot_cost: 8000 },
        { dept: 'HR',          headcount: 3, total_gross: 540000,  total_net: 450000,  ot_cost: 4000 },
        { dept: 'Operations',  headcount: 2, total_gross: 240000,  total_net: 200000,  ot_cost: 12000 },
        { dept: 'Marketing',   headcount: 2, total_gross: 200000,  total_net: 170000,  ot_cost: 3000 },
      ],
      component_mix: { month: '2026-06', fixed_pay: 3620000, variable_pay: 480000, statutory_cost: 420000, ot_cost: 97000, employee_deductions: 860000, gross_total: 4820000, has_data: true },
    },
  }
}

export function demoExecTrends() {
  return {
    data: {
      months: EXEC_MONTHS.map((month, i) => ({
        month, attendance_rate: [93.1, 94.0, 92.8, 95.2, 94.1, 94.6][i],
        leave_days_approved: [14, 18, 22, 12, 16, 19][i],
        payroll_gross: 4400000 + i * 90000, payroll_headcount: 18 + i,
        joiners: [2, 1, 3, 1, 2, 3][i], exits: [1, 0, 1, 1, 0, 1][i], net_headcount: 18 + i + [1, 1, 2, 0, 2, 2][i],
      })),
    },
  }
}

// ── Attendance confidence summary (GET /attendance/confidence/summary) ──────
export function demoAttendanceConfidenceSummary() {
  return {
    avg_score: 82.4,
    employees_at_risk: 3,
    level_distribution: [
      { level: 'high',     count: 14 },
      { level: 'medium',   count: 5 },
      { level: 'low',      count: 2 },
      { level: 'critical', count: 1 },
    ],
  }
}

// ── Attendance risk summary (GET /attendance/risk/summary) ──────────────────
export function demoAttendanceRiskSummary() {
  return {
    avg_risk_score: 28.5,
    high_risk_count: 3,
    employees_by_level: [
      { level: 'critical', count: 1 },
      { level: 'high',     count: 2 },
      { level: 'medium',   count: 5 },
      { level: 'low',      count: 14 },
    ],
  }
}

// ── Privacy / DPDP health (GET /governance/privacy/health) ──────────────────
export function demoPrivacyHealth() {
  return {
    erasure_requests:      { open: 2, breached_sla: 0, completed: 11, total: 13 },
    flagged_pii_access_30d: 0,
    control_health:        { total: 24, implemented: 18, verified: 14, in_progress: 4, not_started: 2, waived: 0 },
  }
}

// ── Security posture (GET /security/health) ─────────────────────────────────
export function demoSecurityHealth() {
  return {
    alerts_30d:      { total: 17, open: 3, critical_open: 0, high_open: 1, resolved: 14, avg_mtta_sec: 1860, avg_mttr_sec: 18420 },
    events_7d:       { total: 342, by_severity: { critical: 0, high: 4, medium: 23, low: 315 } },
    detection_rules: { total: 28, enabled: 25 },
  }
}

// ── Payroll accounting summary (GET /payroll/accounting/summary) ────────────
export function demoPayrollAccountingSummary() {
  return {
    total_payroll_liability: 4820000,
    pending_payout_amount:   0,
    failed_payout_count:     0,
    payout_completion_pct:   100,
    imbalanced_ledger_count: 0,
    total_ledger_count:      6,
    posted_ledger_count:     6,
    recent_ledgers:          [],
  }
}

// ── Payroll run snapshot (GET /payroll/runs/:id/snapshot) ───────────────────
export function demoPayrollRunSnapshot(runId: string) {
  return {
    id: `snap-${runId}`,
    run_id: runId,
    month: '2026-06',
    snapshot_version: 3,
    integrity_hash: 'a7f3c9e21b84d6f05c1e9a2b7d4f8e60c3a591b2d8e4f7a0c6b9d2e5f1a3c8b7',
    replayable: true,
    formula_engine_version: 4,
    validation_engine_version: 2,
    created_at: new Date(daysAgo(8)).toISOString(),
    employee_count: 22,
  }
}

// ── Statutory state config (GET /payroll/statutory/{ptax,lwf}/states) ───────
// Returned as BARE ARRAYS — EmployeeProfile iterates them with for…of.
export function demoPtaxStates() {
  return [
    { state_code: 'MH', state_name: 'Maharashtra',    enabled: true },
    { state_code: 'KA', state_name: 'Karnataka',      enabled: true },
    { state_code: 'WB', state_name: 'West Bengal',    enabled: true },
    { state_code: 'TN', state_name: 'Tamil Nadu',     enabled: true },
    { state_code: 'TG', state_name: 'Telangana',      enabled: true },
    { state_code: 'AP', state_name: 'Andhra Pradesh', enabled: true },
    { state_code: 'GJ', state_name: 'Gujarat',        enabled: true },
    { state_code: 'MP', state_name: 'Madhya Pradesh', enabled: true },
    { state_code: 'KL', state_name: 'Kerala',         enabled: false },
    { state_code: 'OR', state_name: 'Odisha',         enabled: false },
  ]
}
export function demoLwfStates() {
  return [
    { state_code: 'MH', state_name: 'Maharashtra',    enabled: true },
    { state_code: 'KA', state_name: 'Karnataka',      enabled: true },
    { state_code: 'TN', state_name: 'Tamil Nadu',     enabled: true },
    { state_code: 'GJ', state_name: 'Gujarat',        enabled: true },
    { state_code: 'TG', state_name: 'Telangana',      enabled: true },
    { state_code: 'AP', state_name: 'Andhra Pradesh', enabled: true },
    { state_code: 'WB', state_name: 'West Bengal',    enabled: true },
    { state_code: 'HR', state_name: 'Haryana',        enabled: false },
    { state_code: 'MP', state_name: 'Madhya Pradesh', enabled: false },
    { state_code: 'KL', state_name: 'Kerala',         enabled: false },
  ]
}

// ── Recruitment — pipeline stages ─────────────────────────────────────────────
export function demoRecruitmentPipelineStages() {
  return [
    { id: 'stage-applied',   name: 'Applied',             color: '#64748b', stage_order: 1, stage_type: 'applied' },
    { id: 'stage-screening', name: 'Screening',           color: '#3b82f6', stage_order: 2, stage_type: 'screening' },
    { id: 'stage-interview', name: 'Technical Interview', color: '#8b5cf6', stage_order: 3, stage_type: 'interview' },
    { id: 'stage-offer',     name: 'Offer',               color: '#f59e0b', stage_order: 4, stage_type: 'offer' },
    { id: 'stage-hired',     name: 'Hired',               color: '#10b981', stage_order: 5, stage_type: 'hired' },
  ]
}

// ── Recruitment — job requisitions ────────────────────────────────────────────
export function demoRecruitmentRequisitions() {
  return [
    { id: 'req-001', title: 'Senior Software Engineer', department_id: 'dept-eng', departments: { id: 'dept-eng', name: 'Engineering' }, location: 'Bengaluru', employment_type: 'full_time', openings: 2, status: 'open', target_date: DAY(daysAgo(-30)), applicant_count: 7, raised_by_profile: { id: DEMO_USER_ID, full_name: 'Priya Sharma' }, jd_text: 'We are looking for a Senior Software Engineer with 5+ years of experience in distributed systems and cloud-native architectures. Must have strong TypeScript/Node.js skills.', required_skills: ['TypeScript', 'Node.js', 'AWS', 'PostgreSQL', 'System Design'], min_experience: 5, max_experience: 10, salary_min: 1800000, salary_max: 2800000, created_at: ISO(daysAgo(60)) },
    { id: 'req-002', title: 'Sales Manager', department_id: 'dept-sales', departments: { id: 'dept-sales', name: 'Sales' }, location: 'Mumbai', employment_type: 'full_time', openings: 1, status: 'open', target_date: DAY(daysAgo(-15)), applicant_count: 3, raised_by_profile: { id: DEMO_USER_ID, full_name: 'Priya Sharma' }, jd_text: 'Seeking an experienced Sales Manager to lead our Mumbai team. 6+ years in B2B SaaS sales, proven track record of ₹5Cr+ annual quota.', required_skills: ['B2B Sales', 'SaaS', 'CRM', 'Negotiation', 'Team Management'], min_experience: 6, max_experience: 12, salary_min: 2200000, salary_max: 3200000, created_at: ISO(daysAgo(45)) },
    { id: 'req-003', title: 'HR Business Partner', department_id: 'dept-hr', departments: { id: 'dept-hr', name: 'HR' }, location: 'Bengaluru', employment_type: 'full_time', openings: 1, status: 'open', target_date: DAY(daysAgo(-20)), applicant_count: 2, raised_by_profile: { id: DEMO_USER_ID, full_name: 'Priya Sharma' }, jd_text: 'HRBP to support Engineering and Product teams. 4-7 years in HR, strong understanding of talent management, L&D, and employee relations in a tech startup context.', required_skills: ['HRBP', 'Talent Management', 'L&D', 'Employee Relations'], min_experience: 4, max_experience: 7, salary_min: 1400000, salary_max: 1900000, created_at: ISO(daysAgo(35)) },
    { id: 'req-004', title: 'Finance Analyst', department_id: 'dept-fin', departments: { id: 'dept-fin', name: 'Finance' }, location: 'Bengaluru', employment_type: 'full_time', openings: 1, status: 'filled', target_date: DAY(daysAgo(30)), applicant_count: 5, raised_by_profile: { id: DEMO_USER_ID, full_name: 'Priya Sharma' }, jd_text: 'Finance Analyst for FP&A and management reporting. CA/CMA preferred, 3-5 years in finance analysis.', required_skills: ['FP&A', 'Excel', 'Tally', 'MIS Reporting', 'GST'], min_experience: 3, max_experience: 5, salary_min: 900000, salary_max: 1300000, created_at: ISO(daysAgo(90)) },
    { id: 'req-005', title: 'Operations Executive', department_id: 'dept-ops', departments: { id: 'dept-ops', name: 'Operations' }, location: 'Delhi NCR', employment_type: 'full_time', openings: 1, status: 'on_hold', target_date: DAY(daysAgo(-10)), applicant_count: 0, raised_by_profile: { id: DEMO_USER_ID, full_name: 'Priya Sharma' }, jd_text: 'Operations Executive to manage vendor relationships and supply chain.', required_skills: ['Vendor Management', 'Supply Chain', 'MS Office'], min_experience: 2, max_experience: 5, salary_min: 600000, salary_max: 900000, created_at: ISO(daysAgo(40)) },
    { id: 'req-006', title: 'Software Engineer', department_id: 'dept-eng', departments: { id: 'dept-eng', name: 'Engineering' }, location: 'Bengaluru / Remote', employment_type: 'full_time', openings: 3, status: 'open', target_date: DAY(daysAgo(-25)), applicant_count: 4, raised_by_profile: { id: 'emp-0002', full_name: 'Rahul Verma' }, jd_text: 'Software Engineers for our platform team. 2-5 years experience, proficiency in React, TypeScript, and REST API design.', required_skills: ['React', 'TypeScript', 'REST APIs', 'Git', 'SQL'], min_experience: 2, max_experience: 5, salary_min: 900000, salary_max: 1600000, created_at: ISO(daysAgo(50)) },
    { id: 'req-007', title: 'Business Development Executive', department_id: 'dept-sales', departments: { id: 'dept-sales', name: 'Sales' }, location: 'Mumbai / Delhi', employment_type: 'full_time', openings: 2, status: 'open', target_date: DAY(daysAgo(-20)), applicant_count: 3, raised_by_profile: { id: 'emp-0007', full_name: 'Kavya Menon' }, jd_text: 'BDE to drive new business acquisition in SMB and mid-market segment. 1-3 years sales experience.', required_skills: ['Lead Generation', 'Cold Calling', 'CRM', 'B2B Sales'], min_experience: 1, max_experience: 3, salary_min: 600000, salary_max: 900000, created_at: ISO(daysAgo(30)) },
    { id: 'req-008', title: 'Product Designer (UX)', department_id: 'dept-eng', departments: { id: 'dept-eng', name: 'Engineering' }, location: 'Bengaluru', employment_type: 'full_time', openings: 1, status: 'draft', target_date: null, applicant_count: 0, raised_by_profile: { id: 'emp-0002', full_name: 'Rahul Verma' }, jd_text: null, required_skills: null, min_experience: 3, max_experience: 7, salary_min: null, salary_max: null, created_at: ISO(daysAgo(5)) },
  ]
}

// ── Recruitment — candidates ───────────────────────────────────────────────────
export function demoRecruitmentCandidates() {
  const seeds = [
    { id: 'cand-001', first: 'Arjun',    last: 'Mehta',         company: 'Flipkart',      title: 'Software Engineer',              exp: 5, source: 'referral' },
    { id: 'cand-002', first: 'Prerna',   last: 'Agarwal',       company: 'Swiggy',        title: 'HR Manager',                     exp: 3, source: 'linkedin' },
    { id: 'cand-003', first: 'Rohan',    last: 'Bose',          company: 'Infosys',       title: 'Senior Software Engineer',       exp: 7, source: 'naukri' },
    { id: 'cand-004', first: 'Aditi',    last: 'Chatterjee',    company: 'Wipro',         title: 'Software Engineer',              exp: 4, source: 'portal' },
    { id: 'cand-005', first: 'Saurabh',  last: 'Tiwari',        company: 'Amazon',        title: 'Senior SDE',                     exp: 6, source: 'linkedin' },
    { id: 'cand-006', first: 'Divya',    last: 'Nambiar',       company: 'Freshdesk',     title: 'Business Development Executive', exp: 2, source: 'referral' },
    { id: 'cand-007', first: 'Kunal',    last: 'Sharma',        company: 'Microsoft',     title: 'Principal Engineer',             exp: 8, source: 'direct' },
    { id: 'cand-008', first: 'Pooja',    last: 'Kapoor',        company: 'TCS',           title: 'Software Engineer',              exp: 5, source: 'naukri' },
    { id: 'cand-009', first: 'Ravi',     last: 'Krishnamurthy', company: 'IBM',           title: 'Sales Executive',                exp: 3, source: 'agency' },
    { id: 'cand-010', first: 'Shreya',   last: 'Jain',          company: 'Oracle',        title: 'Software Engineer',              exp: 4, source: 'linkedin' },
    { id: 'cand-011', first: 'Vivek',    last: 'Pandey',        company: 'HCL',           title: 'Business Development Manager',   exp: 6, source: 'portal' },
    { id: 'cand-012', first: 'Anita',    last: 'Desai',         company: 'Razorpay',      title: 'HR Executive',                   exp: 2, source: 'referral' },
    { id: 'cand-013', first: 'Manish',   last: 'Oberoi',        company: 'Paytm',         title: 'Business Development Manager',   exp: 5, source: 'naukri' },
    { id: 'cand-014', first: 'Simran',   last: 'Kaur',          company: 'Mindtree',      title: 'Sales Manager',                  exp: 3, source: 'direct' },
    { id: 'cand-015', first: 'Abhishek', last: 'Saxena',        company: 'Accenture',     title: 'Senior Engineer',                exp: 7, source: 'linkedin' },
    { id: 'cand-016', first: 'Kavitha',  last: 'Nair',          company: 'Zoho',          title: 'Software Engineer',              exp: 4, source: 'referral' },
    { id: 'cand-017', first: 'Ritesh',   last: 'Yadav',         company: 'Tech Mahindra', title: 'Senior Engineer',                exp: 5, source: 'naukri' },
    { id: 'cand-018', first: 'Neha',     last: 'Singhania',     company: 'Capgemini',     title: 'Sales Manager',                  exp: 6, source: 'agency' },
  ]
  return seeds.map((c, i) => ({
    id: c.id, first_name: c.first, last_name: c.last,
    email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@gmail.com`,
    phone: `+91 9${String(700000000 + i * 17391).slice(0, 9)}`,
    current_company: c.company, current_title: c.title, total_experience: c.exp, source: c.source,
    linkedin_url: `https://linkedin.com/in/${c.first.toLowerCase()}-${c.last.toLowerCase()}`,
    resume_url: null as string | null, notes: null as string | null, created_at: ISO(daysAgo(60 - i * 3)),
  }))
}

// ── Recruitment — applications (Kanban + candidate detail) ────────────────────
export function demoRecruitmentApplications() {
  const stages = Object.fromEntries(demoRecruitmentPipelineStages().map(s => [s.id, s]))
  const reqs   = Object.fromEntries(demoRecruitmentRequisitions().map(r => [r.id, r]))
  const cands  = Object.fromEntries(demoRecruitmentCandidates().map(c => [c.id, c]))
  const rows: { appId: string; candId: string; reqId: string; stageId: string; status: string; score: number | null; ago: number }[] = [
    { appId: 'app-001', candId: 'cand-001', reqId: 'req-001', stageId: 'stage-interview', status: 'interviewing', score: 7.8, ago: 40 },
    { appId: 'app-002', candId: 'cand-002', reqId: 'req-003', stageId: 'stage-screening', status: 'screening',    score: null, ago: 22 },
    { appId: 'app-003', candId: 'cand-003', reqId: 'req-001', stageId: 'stage-offer',     status: 'offer',        score: 8.5, ago: 55 },
    { appId: 'app-004', candId: 'cand-004', reqId: 'req-006', stageId: 'stage-applied',   status: 'applied',      score: null, ago: 15 },
    { appId: 'app-005', candId: 'cand-005', reqId: 'req-001', stageId: 'stage-hired',     status: 'hired',        score: 9.2, ago: 65 },
    { appId: 'app-006', candId: 'cand-006', reqId: 'req-007', stageId: 'stage-screening', status: 'screening',    score: null, ago: 18 },
    { appId: 'app-007', candId: 'cand-007', reqId: 'req-001', stageId: 'stage-offer',     status: 'offer',        score: 8.8, ago: 50 },
    { appId: 'app-008', candId: 'cand-008', reqId: 'req-006', stageId: 'stage-applied',   status: 'applied',      score: null, ago: 12 },
    { appId: 'app-009', candId: 'cand-009', reqId: 'req-002', stageId: 'stage-interview', status: 'interviewing', score: 6.9, ago: 30 },
    { appId: 'app-010', candId: 'cand-010', reqId: 'req-006', stageId: 'stage-screening', status: 'screening',    score: null, ago: 20 },
    { appId: 'app-011', candId: 'cand-011', reqId: 'req-007', stageId: 'stage-applied',   status: 'applied',      score: null, ago: 10 },
    { appId: 'app-012', candId: 'cand-012', reqId: 'req-003', stageId: 'stage-interview', status: 'interviewing', score: 7.4, ago: 28 },
    { appId: 'app-013', candId: 'cand-013', reqId: 'req-007', stageId: 'stage-hired',     status: 'hired',        score: 8.1, ago: 45 },
    { appId: 'app-014', candId: 'cand-014', reqId: 'req-002', stageId: 'stage-screening', status: 'screening',    score: null, ago: 25 },
    { appId: 'app-015', candId: 'cand-015', reqId: 'req-006', stageId: 'stage-interview', status: 'interviewing', score: 8.0, ago: 35 },
    { appId: 'app-016', candId: 'cand-016', reqId: 'req-006', stageId: 'stage-applied',   status: 'applied',      score: null, ago: 8 },
    { appId: 'app-017', candId: 'cand-017', reqId: 'req-001', stageId: 'stage-applied',   status: 'applied',      score: null, ago: 7 },
    { appId: 'app-018', candId: 'cand-018', reqId: 'req-002', stageId: 'stage-offer',     status: 'offer',        score: 7.6, ago: 38 },
  ]
  return rows.map(r => {
    const c = cands[r.candId]
    return {
      id: r.appId, requisition_id: r.reqId, status: r.status, stage_id: r.stageId, overall_score: r.score,
      created_at: ISO(daysAgo(r.ago)),
      candidates: { id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email, current_company: c.current_company, current_title: c.current_title, source: c.source, total_experience: c.total_experience },
      job_requisitions: reqs[r.reqId] ? { id: r.reqId, title: reqs[r.reqId].title } : null,
      recruitment_pipeline_stages: stages[r.stageId] ?? null,
    }
  })
}

// ── Recruitment — interview rounds ────────────────────────────────────────────
export function demoRecruitmentInterviews() {
  const tomorrow = new Date(NOW); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0)
  const dayAfter = new Date(NOW); dayAfter.setDate(dayAfter.getDate() + 2); dayAfter.setHours(14, 0, 0, 0)
  const p1 = [{ interviewer_id: 'emp-0002', profiles: { id: 'emp-0002', full_name: 'Rahul Verma' } }, { interviewer_id: 'emp-0003', profiles: { id: 'emp-0003', full_name: 'Ananya Iyer' } }]
  const p2 = [{ interviewer_id: 'emp-0001', profiles: { id: 'emp-0001', full_name: 'Priya Sharma' } }, { interviewer_id: 'emp-0011', profiles: { id: 'emp-0011', full_name: 'Divya Pillai' } }]
  const p3 = [{ interviewer_id: 'emp-0007', profiles: { id: 'emp-0007', full_name: 'Kavya Menon' } }]
  const appStub = (appId: string, status: string, cId: string, cFirst: string, cLast: string, cEmail: string, cCompany: string, reqId: string, reqTitle: string) =>
    ({ id: appId, status, candidates: { id: cId, first_name: cFirst, last_name: cLast, email: cEmail, current_company: cCompany }, job_requisitions: { id: reqId, title: reqTitle } })
  return [
    { id: 'ivr-001', application_id: 'app-001', round_number: 1, title: 'Technical Screen', interview_type: 'video', scheduled_at: ISO(daysAgo(30)), duration_mins: 60, meet_link: 'https://meet.google.com/demo-001', status: 'completed', notes: 'Strong DSA skills; good system design thinking. Recommend round 2.', created_at: ISO(daysAgo(35)), applications: appStub('app-001', 'interviewing', 'cand-001', 'Arjun', 'Mehta', 'arjun.mehta@gmail.com', 'Flipkart', 'req-001', 'Senior Software Engineer'), interview_panel: p1 },
    { id: 'ivr-002', application_id: 'app-001', round_number: 2, title: 'System Design', interview_type: 'video', scheduled_at: tomorrow.toISOString(), duration_mins: 90, meet_link: 'https://meet.google.com/demo-002', status: 'scheduled', notes: null, created_at: ISO(daysAgo(10)), applications: appStub('app-001', 'interviewing', 'cand-001', 'Arjun', 'Mehta', 'arjun.mehta@gmail.com', 'Flipkart', 'req-001', 'Senior Software Engineer'), interview_panel: p1 },
    { id: 'ivr-003', application_id: 'app-009', round_number: 1, title: 'Sales Aptitude & Role-play', interview_type: 'video', scheduled_at: ISO(daysAgo(20)), duration_mins: 45, meet_link: null, status: 'completed', notes: 'Decent pitch; needs improvement in objection handling.', created_at: ISO(daysAgo(25)), applications: appStub('app-009', 'interviewing', 'cand-009', 'Ravi', 'Krishnamurthy', 'ravi.k@gmail.com', 'IBM', 'req-002', 'Sales Manager'), interview_panel: p3 },
    { id: 'ivr-004', application_id: 'app-012', round_number: 1, title: 'HR Competency Interview', interview_type: 'video', scheduled_at: ISO(daysAgo(18)), duration_mins: 60, meet_link: 'https://meet.google.com/demo-004', status: 'completed', notes: 'Strong domain knowledge; excellent stakeholder management examples.', created_at: ISO(daysAgo(22)), applications: appStub('app-012', 'interviewing', 'cand-012', 'Anita', 'Desai', 'anita.desai@gmail.com', 'Razorpay', 'req-003', 'HR Business Partner'), interview_panel: p2 },
    { id: 'ivr-005', application_id: 'app-015', round_number: 1, title: 'Technical Screen', interview_type: 'video', scheduled_at: ISO(daysAgo(22)), duration_mins: 60, meet_link: 'https://meet.google.com/demo-005', status: 'completed', notes: 'Excellent React/TypeScript skills. Strong candidate.', created_at: ISO(daysAgo(28)), applications: appStub('app-015', 'interviewing', 'cand-015', 'Abhishek', 'Saxena', 'abhishek.s@gmail.com', 'Accenture', 'req-006', 'Software Engineer'), interview_panel: p1 },
    { id: 'ivr-006', application_id: 'app-015', round_number: 2, title: 'Live Coding Challenge', interview_type: 'in_person', scheduled_at: dayAfter.toISOString(), duration_mins: 120, meet_link: null, status: 'scheduled', notes: null, created_at: ISO(daysAgo(5)), applications: appStub('app-015', 'interviewing', 'cand-015', 'Abhishek', 'Saxena', 'abhishek.s@gmail.com', 'Accenture', 'req-006', 'Software Engineer'), interview_panel: p1 },
  ]
}

// ── Recruitment — interviewers (GET /recruitment/interviewers) ────────────────
export function demoRecruitmentInterviewers() {
  return demoEmployeeList.slice(0, 8).map(e => ({
    id: e.id, full_name: `${e.first_name} ${e.last_name}`, role: e.user_account?.role ?? 'employee',
  }))
}

// ════════════════════════════════════════════════════════════════════════════
// ESS self-service, Manager/Approvals/Helpdesk, and Comp & Payroll lists
// (fills demo pages that previously returned empty)
// ════════════════════════════════════════════════════════════════════════════

// ── ESS › My Documents (GET /ess/me/documents) ──────────────────────────────
export function demoEssDocuments() {
  const mk = (id: string, name: string, doc_type: string, days: number) => ({
    id, name, doc_type, storage_path: `demo/${id}.pdf`, file_size: 184_320,
    mime_type: 'application/pdf', expires_at: null as string | null, is_own: true,
    signed_url: null as string | null, signed_url_expires_in: 3600, created_at: ISO(daysAgo(days)),
  })
  return [
    mk('doc-offer', 'Offer Letter.pdf', 'other', 540),
    mk('doc-pan', 'PAN Card.pdf', 'pan', 535),
    mk('doc-aadhaar', 'Aadhaar Card.pdf', 'aadhaar', 535),
    mk('doc-degree', 'Degree Certificate.pdf', 'certificate', 530),
  ]
}

// ── ESS › My Assets (GET /ess/me/assets) ─────────────────────────────────────
export function demoEssAssets() {
  const data = [
    { id: 'asset-1', asset_code: 'LAP-0042', name: 'MacBook Pro 14"', category_id: 'cat-laptop', serial_number: 'C02XX1234567', status: 'assigned', assigned_to: DEMO_SELF_EMPLOYEE_ID, notes: 'Issued on joining' },
    { id: 'asset-2', asset_code: 'PHN-0017', name: 'iPhone 14', category_id: 'cat-phone', serial_number: 'FK3YY7654321', status: 'assigned', assigned_to: DEMO_SELF_EMPLOYEE_ID, notes: 'Work phone' },
    { id: 'asset-3', asset_code: 'CRD-0088', name: 'Access Card', category_id: 'cat-card', serial_number: 'AC-88-2310', status: 'assigned', assigned_to: DEMO_SELF_EMPLOYEE_ID, notes: null },
  ]
  return { data, outstanding_count: data.filter(a => a.status === 'assigned').length }
}

// ── ESS › Expiring items (GET /ess/me/expiry) ────────────────────────────────
export function demoEssExpiry() {
  const data = [
    { id: 'exp-1', employee_id: DEMO_SELF_EMPLOYEE_ID, category: 'document', label: 'Passport', detail: 'Renew before expiry', due_date: DAY(daysAgo(-58)), days_to_due: 58, bucket: 'due_90' },
    { id: 'exp-2', employee_id: DEMO_SELF_EMPLOYEE_ID, category: 'certification', label: 'AWS Solutions Architect', detail: 'Recertification due', due_date: DAY(daysAgo(-24)), days_to_due: 24, bucket: 'due_30' },
  ]
  return {
    data,
    summary: { total: data.length, by_bucket: { overdue: 0, due_7: 0, due_30: 1, due_90: 1 } },
  }
}

// ── ESS › Salary Advances (GET /payroll/ess/my-advances) ─────────────────────
export function demoEssAdvances() {
  return [
    { id: 'adv-1', requested_amount: 50000, approved_amount: 50000, purpose: 'Medical emergency', recovery_months: 5, status: 'recovering', requested_date: DAY(daysAgo(120)), submitted_via_ess: true },
    { id: 'adv-2', requested_amount: 30000, approved_amount: null, purpose: 'Home repair', recovery_months: 3, status: 'pending_manager', requested_date: DAY(daysAgo(4)), submitted_via_ess: true },
  ]
}

// ── ESS › Loans (GET /payroll/ess/my-loans) ──────────────────────────────────
export function demoEssLoans() {
  return [
    { id: 'loan-1', loan_type: 'personal', principal_amount: 200000, disbursed_amount: 200000, interest_rate_pct: 8, tenure_months: 24, emi_amount: 9050, outstanding_balance: 126700, status: 'recovering', purpose: 'Personal', first_emi_month: '2025-09', submitted_via_ess: true },
  ]
}

// ── ESS › Reimbursements (GET /payroll/reimbursements/my) ────────────────────
const REIMB_CATS = [
  { id: 'rc-travel', name: 'Travel', code: 'TRAVEL', category_type: 'travel' },
  { id: 'rc-internet', name: 'Internet & Telephone', code: 'NET', category_type: 'communication' },
  { id: 'rc-medical', name: 'Medical', code: 'MED', category_type: 'medical' },
]
export function demoEssReimbursements(status?: string) {
  const all = [
    { id: 'rmb-1', category_id: 'rc-travel', claim_month: new Date().toISOString().slice(0, 7), claimed_amount: 4200, approved_amount: 4200, description: 'Client visit cab fare', status: 'approved', submitted_at: ISO(daysAgo(12)), created_at: ISO(daysAgo(14)), reimbursement_categories: REIMB_CATS[0] },
    { id: 'rmb-2', category_id: 'rc-internet', claim_month: new Date().toISOString().slice(0, 7), claimed_amount: 1500, approved_amount: null, description: 'Broadband — June', status: 'submitted', submitted_at: ISO(daysAgo(3)), created_at: ISO(daysAgo(3)), reimbursement_categories: REIMB_CATS[1] },
    { id: 'rmb-3', category_id: 'rc-medical', claim_month: '2026-05', claimed_amount: 2800, approved_amount: 2800, description: 'Pharmacy bills', status: 'paid', submitted_at: ISO(daysAgo(40)), created_at: ISO(daysAgo(42)), reimbursement_categories: REIMB_CATS[2] },
  ]
  const data = status ? all.filter(r => r.status === status) : all
  return { data, total: data.length }
}

// ── ESS › Variable Pay (GET /payroll/variable-pay/my) ────────────────────────
export function demoVariablePayMy() {
  const data = [
    { id: 'vp-1', amount: 75000, status: 'approved', performance_period: 'Q4 FY25', performance_notes: 'Exceeded targets', award_name: 'Quarterly Performance Bonus', award_type: 'bonus', is_taxable: true, batch_name: 'Q4 FY25 Bonus', payout_month: '2026-04', approved_at: ISO(daysAgo(70)), created_at: ISO(daysAgo(80)) },
    { id: 'vp-2', amount: 25000, status: 'approved', performance_period: 'FY25', performance_notes: 'Spot recognition', award_name: 'Spot Award', award_type: 'incentive', is_taxable: true, batch_name: 'Spot Awards', payout_month: '2026-02', approved_at: ISO(daysAgo(130)), created_at: ISO(daysAgo(135)) },
  ]
  return { data, total_awarded: data.reduce((s, v) => s + v.amount, 0) }
}

// ── ESS › Benefits / FBP ─────────────────────────────────────────────────────
export function demoBenefitPlans() {
  return [
    { id: 'bp-health', name: 'Group Health Insurance', plan_type: 'health', provider: 'Star Health', description: 'Family floater ₹5L cover', coverage_amount: 500000, employee_cost: 0, employer_cost: 12000, allows_dependents: true, enrollment_opens_at: DAY(daysAgo(20)), enrollment_closes_at: DAY(daysAgo(-15)), is_active: true, is_open: true },
    { id: 'bp-term', name: 'Term Life Insurance', plan_type: 'term_life', provider: 'HDFC Life', description: '3x annual CTC cover', coverage_amount: 5000000, employee_cost: 0, employer_cost: 6000, allows_dependents: false, enrollment_opens_at: DAY(daysAgo(20)), enrollment_closes_at: DAY(daysAgo(-15)), is_active: true, is_open: true },
    { id: 'bp-meal', name: 'Meal Card', plan_type: 'meal', provider: 'Sodexo', description: '₹2,200/month tax-free meal allowance', coverage_amount: 26400, employee_cost: 0, employer_cost: 0, allows_dependents: false, enrollment_opens_at: DAY(daysAgo(20)), enrollment_closes_at: DAY(daysAgo(-15)), is_active: true, is_open: true },
  ]
}
export function demoBenefitMy() {
  return [
    { id: 'be-1', plan_id: 'bp-health', status: 'enrolled', dependent_ids: ['dep-1', 'dep-2'], notes: null, enrolled_at: ISO(daysAgo(60)), updated_at: ISO(daysAgo(60)), benefit_plans: { name: 'Group Health Insurance', plan_type: 'health', coverage_amount: 500000, allows_dependents: true } },
    { id: 'be-2', plan_id: 'bp-term', status: 'enrolled', dependent_ids: [], notes: null, enrolled_at: ISO(daysAgo(60)), updated_at: ISO(daysAgo(60)), benefit_plans: { name: 'Term Life Insurance', plan_type: 'term_life', coverage_amount: 5000000, allows_dependents: false } },
  ]
}
export function demoBenefitDependents() {
  return [
    { id: 'dep-1', name: 'Aarav Sharma', dob: '2015-06-12', gender: 'male', relationship: 'Son' },
    { id: 'dep-2', name: 'Anjali Sharma', dob: '1988-03-22', gender: 'female', relationship: 'Spouse' },
  ]
}

// ── Manager › Team Leave Balances (GET /attendance/leave/team-balances) ──────
export function demoTeamLeaveBalances(includeLiability = false) {
  const teamIds = ['emp-0002', 'emp-0007', 'emp-0011', 'emp-0013', 'emp-0016', 'emp-0014']
  return teamIds.map((id, idx) => {
    const e = demoEmployeeList.find(x => x.id === id) ?? demoEmployeeList[idx]
    const comp = demoActiveComp(id)
    const dailyRate = Math.round(comp.ctc_monthly / 26)
    const bals = [
      { type: demoLeaveTypes[0], balance: 6 + (idx % 4) },
      { type: demoLeaveTypes[1], balance: 8 - (idx % 3) },
      { type: demoLeaveTypes[2], balance: 12 + (idx % 6) },
    ]
    return {
      employee: {
        id: e.id, first_name: e.first_name, last_name: e.last_name,
        employee_code: e.employee_code, department: { name: e.department?.name ?? '—' },
      },
      leave_balances: bals.map(b => ({
        leave_type_id: b.type.id, leave_type_name: b.type.name,
        balance: b.balance, accrued: b.balance + 3, is_paid: b.type.is_paid,
        ...(includeLiability ? { daily_rate: dailyRate, liability_value: Math.round(b.balance * dailyRate) } : {}),
      })),
    }
  })
}

// ── Manager/HR › Approvals inbox (GET /approvals/pending) ─────────────────────
export function demoApprovalsPending() {
  const emp = (id: string) => {
    const e = demoEmployeeList.find(x => x.id === id) ?? demoEmployeeList[0]
    return { id: e.id, first_name: e.first_name, last_name: e.last_name, employee_code: e.employee_code }
  }
  const leave_requests = [
    { id: 'lr-ap-1', from_date: DAY(daysAgo(-3)), to_date: DAY(daysAgo(-1)), computed_days: 3, half_day: false, reason: 'Family function', status: 'pending', created_at: ISO(daysAgo(1)), leave_types: { id: 'lt-cl', name: 'Casual Leave', is_paid: true }, employees: emp('emp-0006') },
    { id: 'lr-ap-2', from_date: DAY(daysAgo(-7)), to_date: DAY(daysAgo(-7)), computed_days: 1, half_day: true, reason: 'Medical appointment', status: 'pending', created_at: ISO(daysAgo(2)), leave_types: { id: 'lt-sl', name: 'Sick Leave', is_paid: true }, employees: emp('emp-0009') },
  ]
  const regularisations = [
    { id: 'reg-ap-1', date: DAY(daysAgo(4)), requested_check_in: '09:15', requested_check_out: '18:30', reason: 'Forgot to punch in', status: 'pending', created_at: ISO(daysAgo(3)), employees: emp('emp-0018') },
  ]
  return {
    leave_requests, regularisations,
    pagination: { page: 1, limit: 20, leave_total: leave_requests.length, reg_total: regularisations.length },
  }
}

// ── Helpdesk tickets (GET /helpdesk/tickets, /helpdesk/tickets/my) ────────────
export function demoHelpdeskTickets() {
  const mk = (id: string, subject: string, category: string, priority: string, status: string, days: number, breached = false) => ({
    id, ticket_number: `HD-${id.slice(-4)}`, subject,
    description: `${subject} — submitted via the employee helpdesk.`,
    category, priority, status, employee_id: DEMO_SELF_EMPLOYEE_ID,
    sla_hours: 24, sla_due_at: ISO(daysAgo(days - 1)), resolution_due_at: ISO(daysAgo(days - 1)),
    sla_breached: breached, created_at: ISO(daysAgo(days)), created_by: DEMO_USER_ID,
  })
  return [
    mk('tkt-1001', 'Payslip not visible for May', 'payroll', 'high', 'in_progress', 2),
    mk('tkt-1002', 'Update bank account details', 'hr_policy', 'medium', 'open', 1),
    mk('tkt-1003', 'Laptop running slow', 'it', 'low', 'awaiting_employee', 5),
    mk('tkt-1004', 'Leave balance mismatch', 'leave', 'high', 'resolved', 12, false),
  ]
}
export function demoHelpdeskTicket(id: string) {
  const t = demoHelpdeskTickets().find(x => x.id === id) ?? demoHelpdeskTickets()[0]
  return { ...t, assigned_to: 'emp-0011', updated_at: ISO(daysAgo(1)) }
}

// ── Masters › Salary Components (GET /masters/salary-components) ──────────────
export function demoSalaryComponents() {
  const mk = (id: string, name: string, code: string, component_type: string, opts: Record<string, unknown> = {}) => ({
    id, name, code, component_type,
    is_taxable: true, is_pf_applicable: false, is_esi_applicable: false,
    is_pt_applicable: false, is_lwf_applicable: false, is_variable: false, is_active: true,
    display_order: 0, default_calculation_type: 'fixed', default_value: 0,
    is_reimbursement: false, exemption_limit_annual: null,
    created_at: ISO(daysAgo(800)), ...opts,
  })
  return [
    mk('sc-basic', 'Basic Salary', 'BASIC', 'earning', { is_pf_applicable: true, is_esi_applicable: true, is_pt_applicable: true, default_calculation_type: 'pct_of_ctc', default_value: 40, display_order: 1 }),
    mk('sc-hra', 'House Rent Allowance', 'HRA', 'earning', { default_calculation_type: 'pct_of_basic', default_value: 50, display_order: 2 }),
    mk('sc-conv', 'Conveyance Allowance', 'CONV', 'earning', { default_value: 1600, display_order: 3 }),
    mk('sc-special', 'Special Allowance', 'SPL', 'earning', { default_calculation_type: 'pct_of_ctc', default_value: 25, display_order: 4 }),
    mk('sc-pf-ee', 'Provident Fund (Employee)', 'PF_EE', 'deduction', { is_taxable: false, is_pf_applicable: true, default_calculation_type: 'pct_of_basic', default_value: 12, display_order: 5 }),
    mk('sc-pt', 'Professional Tax', 'PT', 'deduction', { is_taxable: false, is_pt_applicable: true, default_value: 200, display_order: 6 }),
    mk('sc-pf-er', 'Provident Fund (Employer)', 'PF_ER', 'employer_contribution', { is_taxable: false, is_pf_applicable: true, default_calculation_type: 'pct_of_basic', default_value: 12, display_order: 7 }),
    mk('sc-gratuity', 'Gratuity', 'GRAT', 'employer_contribution', { is_taxable: false, default_calculation_type: 'pct_of_basic', default_value: 4.81, display_order: 8 }),
  ]
}

// ── Masters › Salary Structures (GET /masters/salary-structures) ─────────────
export function demoSalaryStructures() {
  const comps = demoSalaryComponents()
  const cmp = (code: string) => comps.find(c => c.code === code)!
  const line = (id: string, code: string, calculation_type: string, value: number, order: number) => ({
    id, salary_component_id: cmp(code).id, calculation_type, value, display_order: order,
    salary_components: { id: cmp(code).id, name: cmp(code).name, code: cmp(code).code, component_type: cmp(code).component_type },
  })
  return [
    {
      id: 'ss-staff', name: 'Standard Staff Structure', code: 'STD', is_active: true, created_at: ISO(daysAgo(700)),
      salary_structure_components: [
        line('ssc-1', 'BASIC', 'pct_of_ctc', 40, 1),
        line('ssc-2', 'HRA', 'pct_of_basic', 50, 2),
        line('ssc-3', 'CONV', 'fixed', 1600, 3),
        line('ssc-4', 'SPL', 'pct_of_ctc', 25, 4),
        line('ssc-5', 'PF_EE', 'pct_of_basic', 12, 5),
        line('ssc-6', 'PT', 'fixed', 200, 6),
      ],
    },
    {
      id: 'ss-lead', name: 'Leadership Structure', code: 'LEAD', is_active: true, created_at: ISO(daysAgo(700)),
      salary_structure_components: [
        line('ssc-7', 'BASIC', 'pct_of_ctc', 35, 1),
        line('ssc-8', 'HRA', 'pct_of_basic', 50, 2),
        line('ssc-9', 'SPL', 'pct_of_ctc', 30, 3),
        line('ssc-10', 'PF_EE', 'pct_of_basic', 12, 4),
      ],
    },
  ]
}

// ── Positions (GET /positions, /positions/summary) ───────────────────────────
export function demoPositions() {
  const ref = (id: string, name: string) => ({ id, name })
  const mk = (
    id: string, code: string, title: string, sanctioned: number, filled: number,
    desig: [string, string], grade: [string, string], dept: [string, string],
  ) => ({
    id, code, title, sanctioned_count: sanctioned, status: 'active',
    effective_date: DAY(daysAgo(400)), abolished_date: null, notes: null,
    designation_id: desig[0], grade_id: grade[0], department_id: dept[0],
    work_location_id: 'loc-blr', cost_center_id: null, site_id: 'site-blr',
    designations: ref(...desig), grades: ref(...grade), departments: ref(...dept),
    work_locations: ref('loc-blr', 'Bengaluru HQ'), sites: ref('site-blr', 'Bengaluru'),
    filled_count: filled, open_vacancies: Math.max(sanctioned - filled, 0), is_overfilled: filled > sanctioned,
  })
  return [
    mk('pos-1', 'POS-ENG-SSE', 'Senior Software Engineer', 6, 4, ['desig-sse', 'Senior Software Engineer'], ['grade-l3', 'L3 — Senior'], ['dept-eng', 'Engineering']),
    mk('pos-2', 'POS-ENG-SE', 'Software Engineer', 8, 8, ['desig-se', 'Software Engineer'], ['grade-l2', 'L2 — Associate'], ['dept-eng', 'Engineering']),
    mk('pos-3', 'POS-SAL-BDE', 'Business Development Executive', 5, 3, ['desig-bde', 'Business Development Executive'], ['grade-l2', 'L2 — Associate'], ['dept-sales', 'Sales']),
    mk('pos-4', 'POS-HR-HRBP', 'HR Business Partner', 2, 2, ['desig-hrbp', 'HR Business Partner'], ['grade-l3', 'L3 — Senior'], ['dept-hr', 'HR']),
    mk('pos-5', 'POS-FIN-FA', 'Finance Analyst', 3, 2, ['desig-fa', 'Finance Analyst'], ['grade-l2', 'L2 — Associate'], ['dept-fin', 'Finance']),
  ]
}
export function demoPositionsSummary() {
  const ps = demoPositions()
  const sanctioned = ps.reduce((s, p) => s + p.sanctioned_count, 0)
  const filled = ps.reduce((s, p) => s + p.filled_count, 0)
  const vacancies = ps.reduce((s, p) => s + p.open_vacancies, 0)
  const byDept: Record<string, { department: string; sanctioned: number; filled: number; vacancies: number }> = {}
  for (const p of ps) {
    const name = p.departments.name
    byDept[name] ??= { department: name, sanctioned: 0, filled: 0, vacancies: 0 }
    byDept[name].sanctioned += p.sanctioned_count
    byDept[name].filled += p.filled_count
    byDept[name].vacancies += p.open_vacancies
  }
  return {
    meta: { generated_at: ISO(NOW) },
    summary: {
      sanctioned_strength: sanctioned, filled_count: filled, total_vacancies: vacancies,
      open_positions: ps.filter(p => p.open_vacancies > 0).length,
      avg_vacancy_age_days: 38, vacancy_fill_rate: Math.round((filled / sanctioned) * 100),
    },
    by_department: Object.values(byDept),
  }
}

// ── Payroll › Compensation Ledger (GET /payroll/ledger/:employeeId) ──────────
export function demoPayrollLedger() {
  const data = [
    { id: 'pl-1', event_type: 'payroll_finalized', event_description: 'May 2026 payroll finalized', impact_type: 'neutral', impact_amount: 0, before_value: null, after_value: null, source_entity_type: 'payroll_run', source_entity_id: 'run-2026-05', created_at: ISO(daysAgo(22)), created_by_name: 'System' },
    { id: 'pl-2', event_type: 'ot_added', event_description: 'Overtime 4h added', impact_type: 'credit', impact_amount: 1800, before_value: null, after_value: null, source_entity_type: 'attendance', source_entity_id: 'att-1', created_at: ISO(daysAgo(25)), created_by_name: 'Manager' },
    { id: 'pl-3', event_type: 'leave_deducted', event_description: 'LOP 1 day applied', impact_type: 'debit', impact_amount: 2400, before_value: null, after_value: null, source_entity_type: 'leave', source_entity_id: 'lv-1', created_at: ISO(daysAgo(40)), created_by_name: 'System' },
  ]
  return { data, total: data.length }
}

// ── Compensation Revisions (GET /compensation/revisions) ─────────────────────
export function demoCompensationRevisions(status?: string) {
  const mk = (
    id: string, empId: string, revision_type: string, status: string,
    beforeCtc: number, newCtc: number, days: number,
  ) => {
    const e = demoEmployeeList.find(x => x.id === empId) ?? demoEmployeeList[0]
    const delta = newCtc - beforeCtc
    return {
      id, revision_type, effective_date: DAY(daysAgo(days - 30)), status,
      reason: revision_type === 'promotion' ? 'Promotion to next grade' : 'Annual increment cycle',
      submitted_at: ISO(daysAgo(days)), decided_at: status === 'pending' ? null : ISO(daysAgo(days - 5)),
      before_ctc_annual: beforeCtc, new_ctc_annual: newCtc,
      delta_amount: delta, delta_pct: Math.round((delta / beforeCtc) * 1000) / 10, retro_months: 0,
      employee: { id: e.id, name: `${e.first_name} ${e.last_name}`, code: e.employee_code },
      requested_by_name: 'Priya Sharma', approved_by_name: status === 'approved' ? 'Priya Sharma' : null,
    }
  }
  const all = [
    mk('rev-1', 'emp-0005', 'increment', 'approved', 1000000, 1100000, 60),
    mk('rev-2', 'emp-0006', 'promotion', 'pending', 980000, 1180000, 5),
    mk('rev-3', 'emp-0018', 'increment', 'approved', 980000, 1080000, 90),
    mk('rev-4', 'emp-0009', 'revision', 'rejected', 780000, 900000, 30),
  ]
  const data = status && status !== 'all' ? all.filter(r => r.status === status) : all
  return { data, total: data.length, limit: 50, offset: 0 }
}

// ── WFH requests ─────────────────────────────────────────────────────────────
export function demoWfhMine() {
  return [
    { id: 'wfh-1', from_date: DAY(daysAgo(-3)), to_date: DAY(daysAgo(-3)), days: 1, reason: 'Plumber visit', status: 'pending', decision_remarks: null },
    { id: 'wfh-2', from_date: DAY(daysAgo(10)), to_date: DAY(daysAgo(8)), days: 3, reason: 'Recovering from fever', status: 'approved', decision_remarks: 'Take care' },
  ]
}
export function demoWfhPending() {
  return [
    { id: 'wfh-3', from_date: DAY(daysAgo(-2)), to_date: DAY(daysAgo(-1)), days: 2, reason: 'Home internet install', status: 'pending', employee_name: 'Sneha Reddy', employee_code: 'SAAR005' },
    { id: 'wfh-4', from_date: DAY(daysAgo(-5)), to_date: DAY(daysAgo(-5)), days: 1, reason: 'Personal errand', status: 'pending', employee_name: 'Arjun Nair', employee_code: 'SAAR006' },
  ]
}

// ── Asset requests ───────────────────────────────────────────────────────────
export function demoAssetRequestsMine() {
  return [
    { id: 'areq-1', category_name: 'Laptop', item_name: null, reason: 'Current one is slow', status: 'fulfilled', requested_at: ISO(daysAgo(20)), decision_remarks: 'Allocated MacBook Pro' },
    { id: 'areq-2', category_name: null, item_name: 'External monitor', reason: 'Dual-screen setup', status: 'pending', requested_at: ISO(daysAgo(2)), decision_remarks: null },
  ]
}
export function demoAssetRequestsAll() {
  return [
    { id: 'areq-2', category_name: null, item_name: 'External monitor', reason: 'Dual-screen setup', status: 'pending', requested_at: ISO(daysAgo(2)), employee_name: 'Sneha Reddy', employee_code: 'SAAR005' },
    { id: 'areq-3', category_name: 'Headset', item_name: null, reason: 'For client calls', status: 'approved', requested_at: ISO(daysAgo(4)), employee_name: 'Arjun Nair', employee_code: 'SAAR006' },
    { id: 'areq-1', category_name: 'Laptop', item_name: null, reason: 'Current one is slow', status: 'fulfilled', requested_at: ISO(daysAgo(20)), employee_name: 'Imran Khan', employee_code: 'SAAR022' },
  ]
}

// ── Background verification (GET /recruitment/applications/:id/bgv) ──────────
export function demoBgvCase(appId: string) {
  const mk = (check_type: string, status: string, ref: string | null, remarks: string | null) =>
    ({ id: `bgvc-${appId}-${check_type}`, check_type, status, vendor_ref: ref, remarks })
  return {
    id: `bgv-${appId}`, application_id: appId, status: 'in_progress', vendor: 'AuthBridge',
    initiated_at: ISO(daysAgo(8)), completed_at: null, overall_remarks: null,
    checks: [
      mk('identity',   'clear',       'AB-IDN-2231', 'Aadhaar & PAN verified'),
      mk('education',  'clear',       'AB-EDU-2231', 'Degree confirmed with university'),
      mk('employment', 'in_progress', 'AB-EMP-2231', 'Awaiting previous employer response'),
      mk('criminal',   'clear',       'AB-CRM-2231', 'No records found'),
      mk('address',    'initiated',   null,          null),
      mk('reference',  'pending',     null,          null),
    ],
  }
}

// ── Recruitment offer (GET /recruitment/offers/:appId) ───────────────────────
export function demoRecruitmentOffer(appId: string) {
  return {
    id: appId, status: 'interviewing',
    candidate_name: 'Arjun Mehta', first_name: 'Arjun', candidate_email: 'arjun.mehta@gmail.com',
    job_title: 'Senior Software Engineer', department: 'Engineering', company_name: 'Saar Technologies Pvt Ltd',
    offer: null as unknown,
  }
}

// ── Exit interview (separation) ──────────────────────────────────────────────
const EXIT_QUESTIONS = [
  { id: 'eq-1', category: 'reason',       question_text: 'What is the primary reason for your departure?', response_type: 'single_choice', options: ['Better opportunity','Compensation & benefits','Work-life balance','Relationship with manager','Career growth','Relocation','Personal reasons','Other'], is_required: true,  display_order: 0 },
  { id: 'eq-2', category: 'job_role',     question_text: 'How satisfied were you with your role and responsibilities?', response_type: 'rating', options: [] as string[], is_required: true,  display_order: 1 },
  { id: 'eq-3', category: 'manager',      question_text: 'How would you rate your relationship with your manager?', response_type: 'rating', options: [] as string[], is_required: false, display_order: 2 },
  { id: 'eq-4', category: 'culture',      question_text: 'How would you rate the company culture and work environment?', response_type: 'rating', options: [] as string[], is_required: false, display_order: 3 },
  { id: 'eq-5', category: 'compensation', question_text: 'How satisfied were you with your compensation and benefits?', response_type: 'rating', options: [] as string[], is_required: false, display_order: 4 },
  { id: 'eq-6', category: 'growth',       question_text: 'Were there adequate opportunities for learning and growth?', response_type: 'rating', options: [] as string[], is_required: false, display_order: 5 },
  { id: 'eq-7', category: 'work_life',    question_text: 'How would you rate your work-life balance?', response_type: 'rating', options: [] as string[], is_required: false, display_order: 6 },
  { id: 'eq-8', category: 'other',        question_text: 'What did you like most about working here?', response_type: 'text', options: [] as string[], is_required: false, display_order: 7 },
  { id: 'eq-9', category: 'other',        question_text: 'What could we have done better?', response_type: 'text', options: [] as string[], is_required: false, display_order: 8 },
]
export function demoExitInterview(employeeId: string) {
  return {
    separation_id: `sep-${employeeId}`, status: 'not_started',
    overall_comments: null, would_recommend: null, submitted: false, submitted_date: null,
    template: { id: 'eit-1', name: 'Standard Exit Interview', is_active: true },
    questions: EXIT_QUESTIONS, responses: [] as unknown[],
  }
}
export function demoExitTemplate() {
  return { template: { id: 'eit-1', name: 'Standard Exit Interview', is_active: true }, questions: EXIT_QUESTIONS }
}
export function demoExitAnalytics() {
  return {
    total: 7, would_recommend_pct: 71,
    by_category: [
      { category: 'job_role',     avg_rating: 4.1, responses: 7 },
      { category: 'manager',      avg_rating: 3.6, responses: 7 },
      { category: 'culture',      avg_rating: 4.3, responses: 7 },
      { category: 'compensation', avg_rating: 2.9, responses: 7 },
      { category: 'growth',       avg_rating: 3.2, responses: 6 },
      { category: 'work_life',    avg_rating: 3.8, responses: 7 },
    ],
    top_reasons: [
      { reason: 'Better opportunity', count: 3 },
      { reason: 'Compensation & benefits', count: 2 },
      { reason: 'Career growth', count: 1 },
      { reason: 'Relocation', count: 1 },
    ],
  }
}

// ── Workforce › Expiry Management (GET /workforce/expiry) ─────────────────────
export function demoExpiryRegister() {
  const mk = (
    id: string, category: string, empId: string, label: string, detail: string,
    days: number, bucket: string, severity: string,
  ) => {
    const e = demoEmployeeList.find(x => x.id === empId) ?? demoEmployeeList[0]
    return {
      id, category, source_table: category, source_id: `${id}-src`,
      employee_id: e.id, employee_name: `${e.first_name} ${e.last_name}`, employee_code: e.employee_code,
      department_id: e.department?.id ?? null, department_name: e.department?.name ?? null,
      label, detail, due_date: DAY(daysAgo(-days)), days_to_due: days, bucket, severity,
    }
  }
  const data = [
    mk('exp-1', 'identity',      'emp-0006', 'Aadhaar verification', 'KYC re-verification due',     -3, 'overdue', 'high'),
    mk('exp-2', 'contract',      'emp-0010', 'Fixed-term contract',  'Contract end date approaching', 5, 'due_7',   'high'),
    mk('exp-3', 'probation',     'emp-0017', 'Probation confirmation', 'Confirmation review pending', 12, 'due_30',  'medium'),
    mk('exp-4', 'passport',      'emp-0007', 'Passport',             'Passport expiry',             26, 'due_30',  'medium'),
    mk('exp-5', 'certification', 'emp-0002', 'AWS Solutions Architect', 'Recertification due',      58, 'due_90',  'low'),
    mk('exp-6', 'document',      'emp-0013', 'Police verification',  'Document renewal',            80, 'due_90',  'low'),
  ]
  const by_bucket: Record<string, number> = { overdue: 0, due_7: 0, due_30: 0, due_90: 0 }
  for (const i of data) by_bucket[i.bucket] = (by_bucket[i.bucket] ?? 0) + 1
  return {
    data,
    summary: { total: data.length, by_bucket, by_category: {} },
    departments: demoDepartments.map(d => ({ id: d.id, name: d.name })),
  }
}
