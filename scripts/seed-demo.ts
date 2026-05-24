/**
 * seed-demo.ts — Full HRMS demo data seed
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   TENANT_ID=11111111-1111-1111-1111-111111111111 \
 *   npx tsx scripts/seed-demo.ts
 *
 * The script is idempotent: it upserts where possible.
 * Run it against a local or staging Supabase project.
 *
 * Prerequisites (already in migrations):
 *   • Tenant row must exist (use TENANT_ID from migrations/008_seed.sql or create one)
 *   • Auth users must be created separately via Supabase Auth → profiles are inserted here
 */

import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.SUPABASE_URL     ?? 'http://127.0.0.1:54321'
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const TENANT_ID        = process.env.TENANT_ID        ?? '11111111-1111-1111-1111-111111111111'

if (!SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_SERVICE_KEY env var')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

// ── UUID helpers ──────────────────────────────────────────────────────────────

function u(n: number): string {
  return `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`
}

/** YYYY-MM-DD offset from today */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function todayStr(): string { return new Date().toISOString().slice(0, 10) }

// ── Fixed IDs ─────────────────────────────────────────────────────────────────

const DEPT   = { HR: u(101), TECH: u(102), OPS: u(103), FIN: u(104), FLOOR: u(105) }
const DESIG  = { MGR: u(201), SR_EXEC: u(202), EXEC: u(203), LEAD: u(204), STAFF: u(205) }
const GRADE  = { A: u(301), B: u(302), C: u(303), D: u(304) }
const SHIFT  = { MORNING: u(401), EVENING: u(402) }
const LEAVE  = { CL: u(501), SL: u(502), EL: u(503) }
const SALARY = { BASIC: u(601), HRA: u(602), CONV: u(603), TAX: u(604) }
const STRUCT = { STD: u(701) }

// Employee IDs
const EMPS = Array.from({ length: 10 }, (_, i) => u(1000 + i + 1))
// Profile IDs (one per employee — in real usage link to Supabase Auth user IDs)
const PROFS = Array.from({ length: 10 }, (_, i) => u(2000 + i + 1))

// ── Employee master data ──────────────────────────────────────────────────────

interface EmpSeed {
  id: string; profId: string; code: string; first: string; last: string
  email: string; role: string; dept: string; desig: string; grade: string
  type: string; joining: string
}

const EMP_DATA: EmpSeed[] = [
  { id: EMPS[0],  profId: PROFS[0],  code: 'EMP001', first: 'Priya',    last: 'Sharma',    email: 'priya@demo.hrms',    role: 'hr_admin',    dept: DEPT.HR,    desig: DESIG.MGR,     grade: GRADE.D, type: 'permanent',  joining: '2021-03-01' },
  { id: EMPS[1],  profId: PROFS[1],  code: 'EMP002', first: 'Arjun',    last: 'Mehta',     email: 'arjun@demo.hrms',    role: 'manager',     dept: DEPT.TECH,  desig: DESIG.LEAD,    grade: GRADE.C, type: 'permanent',  joining: '2020-07-15' },
  { id: EMPS[2],  profId: PROFS[2],  code: 'EMP003', first: 'Divya',    last: 'Nair',      email: 'divya@demo.hrms',    role: 'employee',    dept: DEPT.TECH,  desig: DESIG.SR_EXEC, grade: GRADE.B, type: 'permanent',  joining: '2022-01-10' },
  { id: EMPS[3],  profId: PROFS[3],  code: 'EMP004', first: 'Rahul',    last: 'Gupta',     email: 'rahul@demo.hrms',    role: 'employee',    dept: DEPT.OPS,   desig: DESIG.EXEC,    grade: GRADE.A, type: 'contract',   joining: '2023-04-01' },
  { id: EMPS[4],  profId: PROFS[4],  code: 'EMP005', first: 'Sneha',    last: 'Pillai',    email: 'sneha@demo.hrms',    role: 'employee',    dept: DEPT.FIN,   desig: DESIG.EXEC,    grade: GRADE.B, type: 'permanent',  joining: '2021-09-01' },
  { id: EMPS[5],  profId: PROFS[5],  code: 'EMP006', first: 'Karan',    last: 'Singh',     email: 'karan@demo.hrms',    role: 'employee',    dept: DEPT.FLOOR, desig: DESIG.STAFF,   grade: GRADE.A, type: 'probation',  joining: '2024-01-15' },
  { id: EMPS[6],  profId: PROFS[6],  code: 'EMP007', first: 'Meena',    last: 'Iyer',      email: 'meena@demo.hrms',    role: 'employee',    dept: DEPT.HR,    desig: DESIG.SR_EXEC, grade: GRADE.B, type: 'permanent',  joining: '2022-06-01' },
  { id: EMPS[7],  profId: PROFS[7],  code: 'EMP008', first: 'Rohit',    last: 'Verma',     email: 'rohit@demo.hrms',    role: 'employee',    dept: DEPT.OPS,   desig: DESIG.EXEC,    grade: GRADE.A, type: 'intern',     joining: '2024-06-01' },
  { id: EMPS[8],  profId: PROFS[8],  code: 'EMP009', first: 'Ananya',   last: 'Bose',      email: 'ananya@demo.hrms',   role: 'hr_admin',    dept: DEPT.HR,    desig: DESIG.SR_EXEC, grade: GRADE.C, type: 'permanent',  joining: '2019-11-01' },
  { id: EMPS[9],  profId: PROFS[9],  code: 'EMP010', first: 'Vikram',   last: 'Reddy',     email: 'vikram@demo.hrms',   role: 'employee',    dept: DEPT.TECH,  desig: DESIG.EXEC,    grade: GRADE.B, type: 'contract',   joining: '2023-08-01' },
]

// ── Attendance distribution for 7 days ───────────────────────────────────────

type AttStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave' | 'weekly_off'

const ATT_MATRIX: Record<number, AttStatus[]> = {
  // employee index → [day7ago, day6ago, …, yesterday, today]
  0: ['present', 'present', 'present', 'present', 'late',    'present', 'present'],
  1: ['present', 'present', 'absent',  'present', 'present', 'late',    'present'],
  2: ['present', 'late',    'present', 'leave',   'leave',   'present', 'present'],
  3: ['absent',  'present', 'present', 'present', 'half_day','present', 'absent' ],
  4: ['present', 'present', 'present', 'present', 'present', 'present', 'present'],
  5: ['present', 'absent',  'late',    'present', 'present', 'absent',  'present'],
  6: ['present', 'present', 'present', 'late',    'present', 'present', 'half_day'],
  7: ['absent',  'absent',  'present', 'present', 'present', 'present', 'present'],
  8: ['present', 'present', 'present', 'present', 'present', 'late',    'present'],
  9: ['present', 'present', 'late',    'absent',  'present', 'present', 'present'],
}

// ── Main seed ─────────────────────────────────────────────────────────────────

async function run() {
  console.log('🌱  Starting HRMS demo seed…')
  console.log(`    Tenant: ${TENANT_ID}`)
  console.log(`    Supabase: ${SUPABASE_URL}\n`)

  // ── 1. Departments ──────────────────────────────────────────────────────────
  console.log('1/10  Departments…')
  await sb.from('departments').upsert([
    { id: DEPT.HR,    tenant_id: TENANT_ID, name: 'Human Resources', code: 'HR'    },
    { id: DEPT.TECH,  tenant_id: TENANT_ID, name: 'Technology',      code: 'TECH'  },
    { id: DEPT.OPS,   tenant_id: TENANT_ID, name: 'Operations',      code: 'OPS'   },
    { id: DEPT.FIN,   tenant_id: TENANT_ID, name: 'Finance',         code: 'FIN'   },
    { id: DEPT.FLOOR, tenant_id: TENANT_ID, name: 'Retail Floor',    code: 'FLOOR' },
  ], { onConflict: 'id' })

  // ── 2. Designations ─────────────────────────────────────────────────────────
  console.log('2/10  Designations…')
  await sb.from('designations').upsert([
    { id: DESIG.MGR,     tenant_id: TENANT_ID, name: 'Store Manager',    level: 6 },
    { id: DESIG.SR_EXEC, tenant_id: TENANT_ID, name: 'Senior Executive', level: 4 },
    { id: DESIG.EXEC,    tenant_id: TENANT_ID, name: 'Executive',        level: 3 },
    { id: DESIG.LEAD,    tenant_id: TENANT_ID, name: 'Team Lead',        level: 5 },
    { id: DESIG.STAFF,   tenant_id: TENANT_ID, name: 'Floor Staff',      level: 2 },
  ], { onConflict: 'id' })

  // ── 3. Grades ───────────────────────────────────────────────────────────────
  console.log('3/10  Grades…')
  await sb.from('grades').upsert([
    { id: GRADE.A, tenant_id: TENANT_ID, name: 'Band A', code: 'A', min_salary: 200000,  max_salary: 400000  },
    { id: GRADE.B, tenant_id: TENANT_ID, name: 'Band B', code: 'B', min_salary: 400000,  max_salary: 700000  },
    { id: GRADE.C, tenant_id: TENANT_ID, name: 'Band C', code: 'C', min_salary: 700000,  max_salary: 1200000 },
    { id: GRADE.D, tenant_id: TENANT_ID, name: 'Band D', code: 'D', min_salary: 1200000, max_salary: 2000000 },
  ], { onConflict: 'id' })

  // ── 4. Shifts ───────────────────────────────────────────────────────────────
  console.log('4/10  Shifts…')
  await sb.from('shifts').upsert([
    {
      id: SHIFT.MORNING, tenant_id: TENANT_ID,
      name: 'Morning Shift', code: 'MS',
      start_time: '09:00:00', end_time: '18:00:00',
      work_hours: 9, grace_minutes: 15,
      is_night_shift: false, is_active: true,
      weekly_off_days: [0, 6],   // Sun + Sat
    },
    {
      id: SHIFT.EVENING, tenant_id: TENANT_ID,
      name: 'Evening Shift', code: 'ES',
      start_time: '14:00:00', end_time: '23:00:00',
      work_hours: 9, grace_minutes: 15,
      is_night_shift: false, is_active: true,
      weekly_off_days: [0, 6],
    },
  ], { onConflict: 'id' })

  // ── 5. Leave Types ──────────────────────────────────────────────────────────
  console.log('5/10  Leave types…')
  await sb.from('leave_types').upsert([
    { id: LEAVE.CL, tenant_id: TENANT_ID, name: 'Casual Leave',    is_paid: true,  allow_sandwich: false, is_active: true },
    { id: LEAVE.SL, tenant_id: TENANT_ID, name: 'Sick Leave',      is_paid: true,  allow_sandwich: false, is_active: true },
    { id: LEAVE.EL, tenant_id: TENANT_ID, name: 'Earned Leave',    is_paid: true,  allow_sandwich: true,  is_active: true },
  ], { onConflict: 'id' })

  // ── 6. Salary masters ───────────────────────────────────────────────────────
  console.log('6/10  Salary masters…')
  await sb.from('salary_components').upsert([
    { id: SALARY.BASIC, tenant_id: TENANT_ID, name: 'Basic Salary',     code: 'BASIC', component_type: 'earning',    is_taxable: true,  display_order: 1 },
    { id: SALARY.HRA,   tenant_id: TENANT_ID, name: 'HRA',              code: 'HRA',   component_type: 'earning',    is_taxable: false, display_order: 2 },
    { id: SALARY.CONV,  tenant_id: TENANT_ID, name: 'Conveyance',       code: 'CONV',  component_type: 'earning',    is_taxable: false, display_order: 3 },
    { id: SALARY.TAX,   tenant_id: TENANT_ID, name: 'Prof Tax',         code: 'PT',    component_type: 'deduction',  is_taxable: false, display_order: 10 },
  ], { onConflict: 'id' })

  await sb.from('salary_structures').upsert([
    { id: STRUCT.STD, tenant_id: TENANT_ID, name: 'Standard CTC', code: 'STD', is_active: true },
  ], { onConflict: 'id' })

  await sb.from('salary_structure_components').upsert([
    { salary_structure_id: STRUCT.STD, salary_component_id: SALARY.BASIC, calculation_type: 'pct_of_ctc', default_value: 50, sequence: 1 },
    { salary_structure_id: STRUCT.STD, salary_component_id: SALARY.HRA,   calculation_type: 'pct_of_ctc', default_value: 20, sequence: 2 },
    { salary_structure_id: STRUCT.STD, salary_component_id: SALARY.CONV,  calculation_type: 'fixed',       default_value: 1600, sequence: 3 },
    { salary_structure_id: STRUCT.STD, salary_component_id: SALARY.TAX,   calculation_type: 'fixed',       default_value: 200,  sequence: 10 },
  ], { onConflict: 'salary_structure_id,salary_component_id' })

  // ── 7. Employees + Profiles ─────────────────────────────────────────────────
  console.log('7/10  Employees + profiles…')
  for (const e of EMP_DATA) {
    // Employee row (lean)
    await sb.from('employees').upsert({
      id: e.id, tenant_id: TENANT_ID,
      employee_code: e.code, first_name: e.first, last_name: e.last,
      email: e.email, phone: `+9199${e.code.slice(3).padStart(8, '0')}`,
      joining_date: e.joining, status: 'active',
    }, { onConflict: 'id' })

    // Profile (without linking to a real auth user — useful for seeding only)
    await sb.from('profiles').upsert({
      id: e.profId, tenant_id: TENANT_ID,
      employee_id: e.id,
      full_name: `${e.first} ${e.last}`,
      role: e.role, is_active: true,
    }, { onConflict: 'id' })

    // Job history
    await sb.from('job_history').upsert({
      id: u(3000 + EMP_DATA.indexOf(e)),
      tenant_id: TENANT_ID, employee_id: e.id,
      department_id: e.dept, designation_id: e.desig, grade_id: e.grade,
      employment_type: e.type, effective_from: e.joining,
      is_current: true,
    }, { onConflict: 'id' })

    // Employee shifts
    await sb.from('employee_shifts').upsert({
      id: u(4000 + EMP_DATA.indexOf(e)),
      tenant_id: TENANT_ID, employee_id: e.id,
      shift_id: SHIFT.MORNING, effective_from: e.joining, is_current: true,
    }, { onConflict: 'id' })

    // Personal info
    const genders = ['male', 'female', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male']
    await sb.from('employee_personal_info').upsert({
      tenant_id: TENANT_ID, employee_id: e.id,
      gender: genders[EMP_DATA.indexOf(e)], nationality: 'Indian',
      blood_group: ['A+', 'B+', 'O+', 'AB+'][EMP_DATA.indexOf(e) % 4],
    }, { onConflict: 'tenant_id,employee_id' })

    // Leave balance (current year)
    const year = new Date().getFullYear()
    for (const lt of [LEAVE.CL, LEAVE.SL, LEAVE.EL]) {
      const balance = lt === LEAVE.EL ? 15 : lt === LEAVE.SL ? 10 : 12
      await sb.from('employee_leave_balance').upsert({
        tenant_id: TENANT_ID, employee_id: e.id,
        leave_type_id: lt, balance, year,
      }, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })
    }

    // Compensation (realistic CTC breakdown)
    const ctcMap: Record<string, number> = {
      [GRADE.A]: 360000, [GRADE.B]: 600000, [GRADE.C]: 900000, [GRADE.D]: 1800000,
    }
    const ctcAnnual   = ctcMap[e.grade]
    const ctcMonthly  = Math.round(ctcAnnual / 12)
    const compId      = u(5000 + EMP_DATA.indexOf(e))

    await sb.from('employee_compensations').upsert({
      id: compId, tenant_id: TENANT_ID, employee_id: e.id,
      salary_structure_id: STRUCT.STD,
      ctc_annual: ctcAnnual,
      effective_from: e.joining, is_active: true,
      notes: 'Initial CTC at joining', created_by: PROFS[0],
    }, { onConflict: 'id' })

    await sb.from('employee_compensation_components').upsert([
      { compensation_id: compId, salary_component_id: SALARY.BASIC, calculation_type: 'pct_of_ctc', value: 50,  computed_monthly: Math.round(ctcMonthly * 0.50), computed_annual: Math.round(ctcAnnual * 0.50), sequence: 1 },
      { compensation_id: compId, salary_component_id: SALARY.HRA,   calculation_type: 'pct_of_ctc', value: 20,  computed_monthly: Math.round(ctcMonthly * 0.20), computed_annual: Math.round(ctcAnnual * 0.20), sequence: 2 },
      { compensation_id: compId, salary_component_id: SALARY.CONV,  calculation_type: 'fixed',       value: 1600, computed_monthly: 1600, computed_annual: 19200, sequence: 3 },
      { compensation_id: compId, salary_component_id: SALARY.TAX,   calculation_type: 'fixed',       value: 200,  computed_monthly: 200,  computed_annual: 2400,  sequence: 10 },
    ], { onConflict: 'compensation_id,salary_component_id' })
  }

  // ── 8. Attendance (last 7 days) ─────────────────────────────────────────────
  console.log('8/10  Attendance records (7 days)…')
  const attRows: Record<string, unknown>[] = []

  for (let empIdx = 0; empIdx < 10; empIdx++) {
    const empId    = EMPS[empIdx]
    const statuses = ATT_MATRIX[empIdx]

    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
      const date   = daysAgo(dayOffset)
      const status = statuses[6 - dayOffset] ?? 'present'
      const workHrs = status === 'present' ? 8.5
                    : status === 'late'    ? 8.0
                    : status === 'half_day'? 4.5
                    : status === 'leave'   ? 0
                    : 0 // absent / weekly_off
      const lateMin = status === 'late' ? 20 + (empIdx * 5 % 30) : 0

      attRows.push({
        tenant_id: TENANT_ID, employee_id: empId, date,
        status, work_hours: workHrs, late_minutes: lateMin,
        overtime_minutes: workHrs > 9 ? 30 : 0,
        is_payable: ['present','late','half_day'].includes(status),
        day_fraction: status === 'half_day' ? 0.5 : ['present','late'].includes(status) ? 1.0 : 0,
      })
    }
  }
  const { error: attErr } = await sb.from('attendance_daily')
    .upsert(attRows, { onConflict: 'tenant_id,employee_id,date' })
  if (attErr) console.warn('   ⚠  attendance_daily:', attErr.message)

  // ── 9. Leave requests ───────────────────────────────────────────────────────
  console.log('9/10  Leave requests…')
  await sb.from('leave_applications').upsert([
    // Approved leave for Divya (EMP003) — 2 days ago to yesterday
    {
      id: u(6001), tenant_id: TENANT_ID, employee_id: EMPS[2],
      leave_type_id: LEAVE.CL,
      from_date: daysAgo(4), to_date: daysAgo(3),
      reason: 'Family function', status: 'approved',
      approved_by: PROFS[0], approved_at: new Date(Date.now() - 4 * 86400_000).toISOString(),
    },
    // Pending leave for Rahul (EMP004)
    {
      id: u(6002), tenant_id: TENANT_ID, employee_id: EMPS[3],
      leave_type_id: LEAVE.SL,
      from_date: daysAgo(1), to_date: todayStr(),
      reason: 'Not feeling well', status: 'pending',
    },
    // Pending leave for Karan (EMP006)
    {
      id: u(6003), tenant_id: TENANT_ID, employee_id: EMPS[5],
      leave_type_id: LEAVE.EL,
      from_date: daysAgo(2), to_date: daysAgo(1),
      reason: 'Personal work', status: 'pending',
    },
    // Approved leave for Rohit (EMP008) — absent pair
    {
      id: u(6004), tenant_id: TENANT_ID, employee_id: EMPS[7],
      leave_type_id: LEAVE.SL,
      from_date: daysAgo(6), to_date: daysAgo(5),
      reason: 'Medical', status: 'approved',
      approved_by: PROFS[0], approved_at: new Date(Date.now() - 6 * 86400_000).toISOString(),
    },
  ], { onConflict: 'id' })

  // ── 10. Anomalies ───────────────────────────────────────────────────────────
  console.log('10/10 Anomalies…')
  const anomalyRows: Record<string, unknown>[] = []
  const anomalyTypes = ['no_punch', 'missing_out', 'late'] as const

  // 2-3 anomalies for employees 2, 3, 5, 7 (those with absent / late days)
  const anomalyEmps = [1, 3, 5, 7] // employee indices
  for (const empIdx of anomalyEmps) {
    const empId = EMPS[empIdx]
    const count = 2 + (empIdx % 2)  // 2 or 3 anomalies per employee
    for (let k = 0; k < count; k++) {
      const date = daysAgo(k + 1)
      const type = anomalyTypes[(empIdx + k) % 3]
      anomalyRows.push({
        tenant_id: TENANT_ID, employee_id: empId, date,
        type,
        severity: type === 'no_punch' ? 'high' : type === 'missing_out' ? 'medium' : 'low',
        description: type === 'no_punch'    ? 'No attendance punches recorded for this working day.'
                   : type === 'missing_out' ? 'Check-in recorded but no check-out punch found.'
                   : `Employee arrived ${20 + k * 10} minutes after the allowed grace period.`,
        resolved: false,
      })
    }
  }

  const { error: anomErr } = await sb.from('attendance_anomalies')
    .upsert(anomalyRows, { onConflict: 'tenant_id,employee_id,date,type' })
  if (anomErr) console.warn('   ⚠  attendance_anomalies:', anomErr.message)

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\n✅  Seed complete!')
  console.log('   10 employees across 5 departments')
  console.log('    7 days of attendance (mixed statuses)')
  console.log('    4 leave applications (2 pending, 2 approved)')
  console.log('    ~10 attendance anomalies')
  console.log('   10 compensation records with realistic CTC breakdown\n')
  console.log('Next: create auth users in Supabase Auth and link profile IDs.')
}

run().catch((err) => {
  console.error('❌  Seed failed:', err)
  process.exit(1)
})
