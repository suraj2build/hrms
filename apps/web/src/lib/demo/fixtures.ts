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

export const demoWorkLocations = [
  { id: 'loc-blr', tenant_id: DEMO_TENANT_ID, name: 'Bengaluru HQ', code: 'BLR', city: 'Bengaluru', state: 'Karnataka', country: 'India', pincode: '560103', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'loc-mum', tenant_id: DEMO_TENANT_ID, name: 'Mumbai Office', code: 'MUM', city: 'Mumbai', state: 'Maharashtra', country: 'India', pincode: '400051', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'loc-del', tenant_id: DEMO_TENANT_ID, name: 'Delhi NCR Office', code: 'DEL', city: 'New Delhi', state: 'Delhi', country: 'India', pincode: '110019', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
]

export const demoSites = [
  { id: 'site-blr', tenant_id: DEMO_TENANT_ID, name: 'Bengaluru HQ', code: 'BLR', city: 'Bengaluru', state: 'Karnataka', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'site-mum', tenant_id: DEMO_TENANT_ID, name: 'Mumbai Office', code: 'MUM', city: 'Mumbai', state: 'Maharashtra', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
  { id: 'site-del', tenant_id: DEMO_TENANT_ID, name: 'Delhi NCR Office', code: 'DEL', city: 'New Delhi', state: 'Delhi', is_active: true, created_at: ISO(daysAgo(800)), updated_at: ISO(daysAgo(800)) },
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
