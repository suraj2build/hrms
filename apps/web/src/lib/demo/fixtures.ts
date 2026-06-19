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
