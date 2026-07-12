#!/usr/bin/env node
/**
 * seed-enterprise.mjs — CognixHR EAC enterprise dataset generator.
 *
 * Generates a realistic enterprise with 6-level hierarchy, compensation,
 * leave balances, 3 months of attendance history, and EAC scenario mix:
 *   - 8%  employees on notice (L5/L6)
 *   - 5%  employees on probation (L6)
 *   - 12% employees on night-shift schedule (9 hrs + overtime)
 *   - 15% employees with salary revision history (two comp records)
 *
 * Required env vars:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key (bypasses RLS)
 *   SEED_TENANT_ID            UUID of the tenant to populate
 *
 * Optional:
 *   SEED_COUNT              Target employee count (default 1000, max 5000)
 *   SEED_ATTENDANCE_MONTHS  Months of attendance history (default 3, max 6)
 *   SEED_CLEAR              'true' → delete existing SE* seed data first
 */

import { randomUUID } from 'node:crypto'

// ── Config ─────────────────────────────────────────────────────────────────────
const BASE    = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const TID     = process.env.SEED_TENANT_ID ?? ''
const COUNT   = Math.min(5000, Math.max(10, +(process.env.SEED_COUNT ?? '1000')))
const ATT_MON = Math.min(6,    Math.max(1,  +(process.env.SEED_ATTENDANCE_MONTHS ?? '3')))
const CLEAR   = process.env.SEED_CLEAR === 'true'
const BATCH   = 500

function die(msg) { console.error(`[seed] FATAL: ${msg}`); process.exit(1) }
if (!BASE) die('SUPABASE_URL is required')
if (!KEY)  die('SUPABASE_SERVICE_ROLE_KEY is required')
if (!TID)  die('SEED_TENANT_ID is required')

// ── REST helpers ───────────────────────────────────────────────────────────────
const HDRS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function ins(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const res = await fetch(`${BASE}/rest/v1/${table}`, {
      method:  'POST',
      headers: { ...HDRS, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body:    JSON.stringify(chunk),
    })
    if (!res.ok) die(`ins(${table}) HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    if (rows.length > BATCH) process.stdout.write(`\r    ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}  `)
  }
  if (rows.length > BATCH) console.log()
}

async function del(table, qs) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${qs}`, { method: 'DELETE', headers: HDRS })
  if (!res.ok && res.status !== 404) die(`del(${table}) HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

// ── Utilities ──────────────────────────────────────────────────────────────────
const pick    = arr      => arr[Math.floor(Math.random() * arr.length)]
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const between = (a, b)   => a + Math.random() * (b - a)
const roundCTC = n       => Math.round(n / 12000) * 12000  // monthly divisible by 1000
const r2 = n             => Math.round(n * 100) / 100

// ── Data constants ─────────────────────────────────────────────────────────────
const MALE_NAMES   = ['Rahul','Amit','Vikram','Suresh','Ankit','Rohit','Rajesh','Sanjay','Manish','Arun','Deepak','Vijay','Naveen','Ashish','Ajay','Sachin','Nikhil','Akash','Gaurav','Varun','Ravi','Mohit','Vivek','Harish','Hemant','Sundar','Pavan','Manoj','Tarun','Lalit','Dinesh','Gopal','Umesh','Rakesh','Mahesh','Girish','Kamal','Dilip','Pratik','Surendra','Neeraj','Vikas','Sameer','Siddharth','Chetan','Yogesh','Naresh','Abhijit','Kiran','Sandeep']
const FEMALE_NAMES = ['Priya','Sunita','Rekha','Anita','Kavita','Pooja','Meena','Deepa','Sudha','Nita','Shalini','Neha','Anjali','Divya','Ritu','Swati','Shweta','Pallavi','Smita','Sneha','Seema','Asha','Komal','Nisha','Radha','Usha','Latha','Geetha','Savitha','Jyothi','Mamata','Nandini','Vidya','Chitra','Bindu','Padma','Rani','Sushma','Rohini','Ananya','Shreya','Tanu','Monika','Preeti','Kusum','Nalini','Ambika','Saritha','Revathi','Lalitha']
const LAST_NAMES   = ['Sharma','Verma','Singh','Kumar','Patel','Gupta','Mehta','Shah','Joshi','Nair','Pillai','Reddy','Rao','Iyer','Menon','Banerjee','Chatterjee','Ghosh','Mukherjee','Das','Bose','Roy','Sinha','Mishra','Tiwari','Pandey','Dubey','Yadav','Maurya','Jain','Agarwal','Mittal','Goel','Kapoor','Malhotra','Chopra','Khanna','Arora','Batra','Sethi','Bajaj','Saxena','Srivastava','Tripathi','Shukla','Dwivedi','Chaudhary','Rawat','Thakur','Kashyap']

// Pyramid ratios (sum ≈ 1)
function levelCounts(total) {
  // L1: exec, L2: directors, L3: sr mgrs, L4: mgrs, L5: seniors, L6: associates
  const ratios = [0.001, 0.004, 0.015, 0.05, 0.18, 0.75]
  const raw    = ratios.map(r => Math.max(1, Math.round(total * r)))
  raw[5]       = total - raw.slice(0, 5).reduce((a, b) => a + b, 0)
  return raw
}

const GRADES = [
  { id: randomUUID(), code: 'SE-L1', name: 'Executive',      level_order: 1, ctc_min: 10000000, ctc_max: 30000000 },
  { id: randomUUID(), code: 'SE-L2', name: 'Director/VP',    level_order: 2, ctc_min:  5000000, ctc_max: 10000000 },
  { id: randomUUID(), code: 'SE-L3', name: 'Senior Manager', level_order: 3, ctc_min:  2500000, ctc_max:  5000000 },
  { id: randomUUID(), code: 'SE-L4', name: 'Manager',        level_order: 4, ctc_min:  1200000, ctc_max:  2500000 },
  { id: randomUUID(), code: 'SE-L5', name: 'Senior',         level_order: 5, ctc_min:   600000, ctc_max:  1200000 },
  { id: randomUUID(), code: 'SE-L6', name: 'Associate',      level_order: 6, ctc_min:   300000, ctc_max:   600000 },
]

const DIVISIONS = [
  { id: randomUUID(), code: 'SE-ENG', name: 'Engineering',       slug: 'se-engineering'    },
  { id: randomUUID(), code: 'SE-HR',  name: 'Human Resources',   slug: 'se-human-resources'},
  { id: randomUUID(), code: 'SE-FIN', name: 'Finance',           slug: 'se-finance'        },
  { id: randomUUID(), code: 'SE-SAL', name: 'Sales & Marketing', slug: 'se-sales-marketing'},
  { id: randomUUID(), code: 'SE-OPS', name: 'Operations',        slug: 'se-operations'     },
]

const WORK_LOCS = [
  { id: randomUUID(), code: 'SE-MUM', name: 'Mumbai HQ',           city: 'Mumbai',    state: 'Maharashtra' },
  { id: randomUUID(), code: 'SE-DEL', name: 'Delhi NCR Office',    city: 'Gurugram',  state: 'Haryana'     },
  { id: randomUUID(), code: 'SE-BLR', name: 'Bengaluru Tech Park', city: 'Bengaluru', state: 'Karnataka'   },
  { id: randomUUID(), code: 'SE-HYD', name: 'Hyderabad Centre',    city: 'Hyderabad', state: 'Telangana'   },
  { id: randomUUID(), code: 'SE-CHN', name: 'Chennai Office',      city: 'Chennai',   state: 'Tamil Nadu'  },
]

const DESIG_BY_LEVEL = [
  ['Chief Executive Officer','Chief Technology Officer','Chief Financial Officer','Chief People Officer','Chief Operating Officer'],
  ['VP Engineering','VP Human Resources','VP Finance','VP Sales','Director Operations'],
  ['Senior Engineering Manager','Senior HR Manager','Senior Finance Manager','Senior Sales Manager','Senior Operations Manager'],
  ['Engineering Manager','HR Manager','Finance Manager','Sales Manager','Operations Manager'],
  ['Senior Software Engineer','Senior HR Executive','Senior Accountant','Senior Sales Executive','Senior Operations Executive'],
  ['Software Engineer','HR Executive','Accountant','Sales Executive','Operations Executive'],
]

const EMP_TYPES = ['permanent','permanent','permanent','permanent','contract','probation']

const LEAVE_TYPES = [
  { id: randomUUID(), name: 'Casual Leave',  balance: 12 },
  { id: randomUUID(), name: 'Sick Leave',    balance: 12 },
  { id: randomUUID(), name: 'Earned Leave',  balance: 18 },
]

const COMP_IDS = {
  BASIC:   randomUUID(),
  HRA:     randomUUID(),
  SPECIAL: randomUUID(),
  PF_EE:   randomUUID(),
  PF_ER:   randomUUID(),
}

// ── EAC scenario mix ───────────────────────────────────────────────────────────
const SCENARIO = {
  ON_NOTICE_L6:  0.08,  // 8%  of L6 employees → status: on_notice
  ON_NOTICE_L5:  0.08,  // 8%  of L5 employees → status: on_notice
  PROBATION_L6:  0.05,  // 5%  of L6 employees → employment_type: probation
  NIGHT_SHIFT:   0.12,  // 12% of employees → 9 hr shifts with overtime
  SAL_REVISION:  0.15,  // 15% of active employees → prior lower-CTC comp record
}

const ATT_TABLE = [
  { status: 'present',  work_hours: 8.0, is_payable: true,  day_fraction: 1.0, w: 80 },
  { status: 'late',     work_hours: 7.0, is_payable: true,  day_fraction: 1.0, w:  5 },
  { status: 'half_day', work_hours: 4.0, is_payable: true,  day_fraction: 0.5, w:  5 },
  { status: 'leave',    work_hours: 0.0, is_payable: true,  day_fraction: 1.0, w:  5 },
  { status: 'absent',   work_hours: 0.0, is_payable: false, day_fraction: 0.0, w:  5 },
]
const ATT_TABLE_NIGHT = [
  { status: 'present',  work_hours: 9.0, is_payable: true,  day_fraction: 1.0, w: 85 },
  { status: 'late',     work_hours: 8.0, is_payable: true,  day_fraction: 1.0, w:  5 },
  { status: 'half_day', work_hours: 4.5, is_payable: true,  day_fraction: 0.5, w:  3 },
  { status: 'leave',    work_hours: 0.0, is_payable: true,  day_fraction: 1.0, w:  4 },
  { status: 'absent',   work_hours: 0.0, is_payable: false, day_fraction: 0.0, w:  3 },
]
const W_TOTAL       = ATT_TABLE.reduce((s, a)       => s + a.w, 0)
const W_TOTAL_NIGHT = ATT_TABLE_NIGHT.reduce((s, a) => s + a.w, 0)
function pickAtt(night = false) {
  const table = night ? ATT_TABLE_NIGHT : ATT_TABLE
  const total = night ? W_TOTAL_NIGHT   : W_TOTAL
  let r = Math.random() * total
  for (const a of table) { r -= a.w; if (r <= 0) return a }
  return table[0]
}

function buildDates(months) {
  const end   = new Date(); end.setDate(end.getDate() - 1)
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1)
  const dates = []
  const d     = new Date(start)
  while (d <= end) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const sep = '─'.repeat(60)
  console.log('CognixHR Enterprise Seed — EAC Edition')
  console.log(`Tenant: ${TID}`)
  console.log(`Target: ${COUNT} employees | Attendance: ${ATT_MON} months`)
  console.log(sep)

  // ── Clear ────────────────────────────────────────────────────────────────────
  if (CLEAR) {
    console.log('Clearing SE* seed data...')
    await del('employees',       `tenant_id=eq.${TID}&employee_code=like.SE*`)
    await del('leave_types',     `tenant_id=eq.${TID}&name=in.(Casual Leave,Sick Leave,Earned Leave)`)
    await del('salary_components', `tenant_id=eq.${TID}&code=like.SE-*`)
    await del('grades',          `tenant_id=eq.${TID}&code=like.SE-*`)
    await del('designations',    `tenant_id=eq.${TID}&level=like.L*&name=like.*Engineer*`)
    await del('departments',     `tenant_id=eq.${TID}&code=like.SE-*`)
    await del('work_locations',  `tenant_id=eq.${TID}&code=like.SE-*`)
    console.log('  Done\n')
  }

  // ── 1. Org structure ─────────────────────────────────────────────────────────
  console.log('1. Org structure')

  await ins('work_locations', WORK_LOCS.map(({ id, code, name, city, state }) => ({
    id, tenant_id: TID, code, name, city, state, country: 'India', is_active: true,
  })))
  console.log(`   work_locations: ${WORK_LOCS.length}`)

  await ins('grades', GRADES.map(({ id, code, name, level_order, ctc_min, ctc_max }) => ({
    id, tenant_id: TID, code, name, level_order,
    ctc_min_annual: ctc_min, ctc_max_annual: ctc_max, is_active: true,
  })))
  console.log(`   grades: ${GRADES.length}`)

  await ins('departments', DIVISIONS.map(({ id, code, name, slug }) => ({
    id, tenant_id: TID, code, name, slug, is_active: true,
  })))
  const subDepts = DIVISIONS.flatMap(div =>
    ['North','South','East','West'].map(sfx => ({
      id: randomUUID(), tenant_id: TID,
      code: `${div.code}-${sfx.slice(0,1)}`,
      name: `${div.name} ${sfx}`,
      slug: `${div.slug}-${sfx.toLowerCase()}`,
      parent_id: div.id, is_active: true,
    }))
  )
  await ins('departments', subDepts)
  console.log(`   departments: ${DIVISIONS.length + subDepts.length}`)

  const designations = DESIG_BY_LEVEL.flatMap((titles, li) =>
    titles.map(name => ({
      id: randomUUID(), tenant_id: TID,
      code: `L${li + 1}-${name.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase()}`,
      name, level: `L${li + 1}`,
    }))
  )
  await ins('designations', designations)
  console.log(`   designations: ${designations.length}`)

  // ── 2. Salary components ──────────────────────────────────────────────────────
  console.log('\n2. Salary components')
  await ins('salary_components', [
    { id: COMP_IDS.BASIC,   tenant_id: TID, code: 'SE-BASIC',   name: 'Basic Salary',         component_type: 'earning',               is_taxable: true,  is_pf_applicable: true,  display_order: 1, is_basic: true,  is_active: true },
    { id: COMP_IDS.HRA,     tenant_id: TID, code: 'SE-HRA',     name: 'House Rent Allowance', component_type: 'earning',               is_taxable: true,  is_pf_applicable: false, display_order: 2, is_basic: false, is_active: true },
    { id: COMP_IDS.SPECIAL, tenant_id: TID, code: 'SE-SPECIAL', name: 'Special Allowance',    component_type: 'earning',               is_taxable: true,  is_pf_applicable: false, display_order: 3, is_basic: false, is_active: true },
    { id: COMP_IDS.PF_EE,   tenant_id: TID, code: 'SE-PF-EE',   name: 'PF Employee',          component_type: 'deduction',             is_taxable: false, is_pf_applicable: true,  display_order: 4, is_basic: false, is_active: true },
    { id: COMP_IDS.PF_ER,   tenant_id: TID, code: 'SE-PF-ER',   name: 'PF Employer',          component_type: 'employer_contribution', is_taxable: false, is_pf_applicable: true,  display_order: 5, is_basic: false, is_active: true },
  ])
  console.log('   salary_components: 5')

  // ── 3. Leave types ────────────────────────────────────────────────────────────
  console.log('\n3. Leave types')
  await ins('leave_types', LEAVE_TYPES.map(({ id, name }) => ({
    id, tenant_id: TID, name, is_paid: true, is_active: true,
  })))
  console.log(`   leave_types: ${LEAVE_TYPES.length}`)

  // ── 4. Employees ──────────────────────────────────────────────────────────────
  console.log('\n4. Employees')

  const counts   = levelCounts(COUNT)
  const byLevel  = counts.map(n => Array.from({ length: n }, () => randomUUID()))
  const desigByL = DESIG_BY_LEVEL.map((_, li) => designations.filter(d => d.level === `L${li + 1}`))

  function managerId(li, ei) {
    if (li === 0) return null
    const pool = byLevel[li - 1]
    return pool[ei % pool.length]
  }

  // Pre-compute scenario cutoffs per level
  const onNoticeCutoff = [0, 0, 0, 0,
    Math.floor(counts[4] * SCENARIO.ON_NOTICE_L5),  // L5
    Math.floor(counts[5] * SCENARIO.ON_NOTICE_L6),  // L6
  ]
  const probationCutoff = [0, 0, 0, 0, 0,
    onNoticeCutoff[5] + Math.floor(counts[5] * SCENARIO.PROBATION_L6),
  ]

  const joiningBase = new Date('2019-01-01').getTime()

  const empRows    = []
  const jobRows    = []
  const compMeta   = []   // { empId, compId, ctcAnnual, basicMon, hraMon, specMon, pfMon, joinDate, isNightShift, isSalRevision }
  const nightShiftIds = new Set()
  let   seq        = 1
  let   scenarioCounts = { onNotice: 0, probation: 0, nightShift: 0, salRevision: 0 }

  for (let li = 0; li < 6; li++) {
    for (let ei = 0; ei < counts[li]; ei++) {
      const id         = byLevel[li][ei]
      const isFemale   = Math.random() < 0.4
      const firstName  = isFemale ? pick(FEMALE_NAMES) : pick(MALE_NAMES)
      const lastName   = pick(LAST_NAMES)
      const code       = `SE${String(seq).padStart(5, '0')}`
      const email      = `${firstName.toLowerCase()}${seq}@seed.test`
      const grade      = GRADES[li]
      const desig      = pick(desigByL[li])
      const subDept    = subDepts[(seq + li) % subDepts.length]
      const loc        = WORK_LOCS[(seq) % WORK_LOCS.length]
      const mgr        = managerId(li, ei)
      const ctcAnnual  = roundCTC(between(grade.ctc_min, grade.ctc_max))
      const ctcMon     = ctcAnnual / 12
      const basicMon   = r2(ctcMon * 0.40)
      const hraMon     = r2(basicMon * 0.50)
      const pfMon      = r2(basicMon * 0.12)
      const specMon    = r2(ctcMon - basicMon - hraMon)
      const compId     = randomUUID()
      // Backdated joining: L1-L3 execs joined 3-6 years ago; L5/L6 1-3 years ago
      const joiningSpan = li < 3 ? 5 * 365 * 86400000 : 3 * 365 * 86400000
      const joinMs     = joiningBase + Math.random() * joiningSpan
      const joinDate   = new Date(joinMs).toISOString().slice(0, 10)

      // ── Scenario: employee status ──
      let empStatus = 'active'
      if ((li === 5 && ei < onNoticeCutoff[5]) || (li === 4 && ei < onNoticeCutoff[4])) {
        empStatus = 'on_notice'
        scenarioCounts.onNotice++
      }

      // ── Scenario: employment type ──
      let empType
      if (li === 0) {
        empType = 'permanent'
      } else if (li === 5 && ei >= onNoticeCutoff[5] && ei < probationCutoff[5]) {
        empType = 'probation'
        scenarioCounts.probation++
      } else {
        empType = pick(EMP_TYPES)
      }

      // ── Scenario: night shift (random 12%) ──
      const isNightShift = Math.random() < SCENARIO.NIGHT_SHIFT
      if (isNightShift) { nightShiftIds.add(id); scenarioCounts.nightShift++ }

      // ── Scenario: salary revision (15% of active employees) ──
      const isSalRevision = empStatus === 'active' && Math.random() < SCENARIO.SAL_REVISION
      if (isSalRevision) scenarioCounts.salRevision++

      empRows.push({
        id, tenant_id: TID,
        employee_code: code,
        first_name: firstName, last_name: lastName, email,
        joining_date: joinDate, status: empStatus,
        work_location_id: loc.id, manager_id: mgr,
      })

      jobRows.push({
        id: randomUUID(), tenant_id: TID, employee_id: id,
        department_id: subDept.id, designation_id: desig.id,
        grade_id: grade.id, work_location_id: loc.id,
        employment_type: empType,
        effective_from: joinDate, is_current: true,
        reason_for_change: 'Initial Hire',
      })

      compMeta.push({ empId: id, compId, ctcAnnual, basicMon, hraMon, specMon, pfMon, joinDate, isSalRevision })
      seq++
    }
  }

  process.stdout.write('    employees: inserting...')
  await ins('employees', empRows)
  console.log(`    employees: ${empRows.length}`)

  process.stdout.write('    job_history: inserting...')
  await ins('job_history', jobRows)
  console.log(`    job_history: ${jobRows.length}`)

  // ── 5. Compensations ──────────────────────────────────────────────────────────
  console.log('\n5. Compensations')

  // For salary-revision employees: insert a prior inactive record first, then the active one.
  const compRows = []
  const priorCompMeta = []  // prior (inactive) records for revision employees

  for (const cm of compMeta) {
    if (cm.isSalRevision) {
      // Prior record: ~80% of current CTC, effective from join date, now inactive
      const priorCTC     = roundCTC(cm.ctcAnnual * (0.75 + Math.random() * 0.10))
      const priorMon     = priorCTC / 12
      const priorBasic   = r2(priorMon * 0.40)
      const priorHRA     = r2(priorBasic * 0.50)
      const priorPF      = r2(priorBasic * 0.12)
      const priorSpec    = r2(priorMon - priorBasic - priorHRA)
      const priorId      = randomUUID()
      // Revision effective 12-18 months after joining
      const revisionMs   = new Date(cm.joinDate).getTime() + (365 + randInt(0, 180)) * 86400000
      const revisionDate = new Date(revisionMs).toISOString().slice(0, 10)
      compRows.push({ id: priorId, tenant_id: TID, employee_id: cm.empId, salary_structure_id: null, effective_from: cm.joinDate, is_active: false, ctc_annual: priorCTC })
      priorCompMeta.push({ compId: priorId, basicMon: priorBasic, hraMon: priorHRA, specMon: priorSpec, pfMon: priorPF })
      // Current active record is effective from revision date
      compRows.push({ id: cm.compId, tenant_id: TID, employee_id: cm.empId, salary_structure_id: null, effective_from: revisionDate, is_active: true, ctc_annual: cm.ctcAnnual })
    } else {
      compRows.push({ id: cm.compId, tenant_id: TID, employee_id: cm.empId, salary_structure_id: null, effective_from: cm.joinDate, is_active: true, ctc_annual: cm.ctcAnnual })
    }
  }
  await ins('employee_compensations', compRows)
  console.log(`   employee_compensations: ${compRows.length} (incl. ${priorCompMeta.length} prior/revision records)`)

  const compComponents = compMeta.flatMap(({ compId, basicMon, hraMon, specMon, pfMon }) => [
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.BASIC,   calculation_type: 'pct_of_ctc',   value: 40, computed_monthly: basicMon, computed_annual: r2(basicMon * 12), sequence: 1 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.HRA,     calculation_type: 'pct_of_basic', value: 50, computed_monthly: hraMon,   computed_annual: r2(hraMon * 12),   sequence: 2 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.SPECIAL, calculation_type: 'balance',      value:  0, computed_monthly: specMon,  computed_annual: r2(specMon * 12),  sequence: 3 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.PF_EE,   calculation_type: 'pct_of_basic', value: 12, computed_monthly: pfMon,    computed_annual: r2(pfMon * 12),    sequence: 4 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.PF_ER,   calculation_type: 'pct_of_basic', value: 12, computed_monthly: pfMon,    computed_annual: r2(pfMon * 12),    sequence: 5 },
  ])
  // Also add components for prior (inactive) comp records
  const priorComponents = priorCompMeta.flatMap(({ compId, basicMon, hraMon, specMon, pfMon }) => [
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.BASIC,   calculation_type: 'pct_of_ctc',   value: 40, computed_monthly: basicMon, computed_annual: r2(basicMon * 12), sequence: 1 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.HRA,     calculation_type: 'pct_of_basic', value: 50, computed_monthly: hraMon,   computed_annual: r2(hraMon * 12),   sequence: 2 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.SPECIAL, calculation_type: 'balance',      value:  0, computed_monthly: specMon,  computed_annual: r2(specMon * 12),  sequence: 3 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.PF_EE,   calculation_type: 'pct_of_basic', value: 12, computed_monthly: pfMon,    computed_annual: r2(pfMon * 12),    sequence: 4 },
    { id: randomUUID(), tenant_id: TID, compensation_id: compId, salary_component_id: COMP_IDS.PF_ER,   calculation_type: 'pct_of_basic', value: 12, computed_monthly: pfMon,    computed_annual: r2(pfMon * 12),    sequence: 5 },
  ])
  await ins('employee_compensation_components', [...compComponents, ...priorComponents])
  console.log(`   employee_compensation_components: ${compComponents.length + priorComponents.length}`)

  // ── 6. Leave balances ─────────────────────────────────────────────────────────
  console.log('\n6. Leave balances')
  const year = new Date().getFullYear()
  const leaveRows = empRows.flatMap(emp =>
    LEAVE_TYPES.map(lt => ({
      id: randomUUID(), tenant_id: TID,
      employee_id: emp.id, leave_type_id: lt.id,
      year, balance: lt.balance,
    }))
  )
  await ins('employee_leave_balance', leaveRows)
  console.log(`   employee_leave_balance: ${leaveRows.length}`)

  // ── 7. Attendance ─────────────────────────────────────────────────────────────
  console.log('\n7. Attendance')
  const dates     = buildDates(ATT_MON)
  const totalAtt  = empRows.length * dates.length
  console.log(`   ${empRows.length} employees × ${dates.length} days = ${totalAtt.toLocaleString()} rows`)

  const attBuf = []
  let   attDone = 0

  async function flush(force = false) {
    while (attBuf.length >= BATCH || (force && attBuf.length > 0)) {
      const chunk = attBuf.splice(0, BATCH)
      const res = await fetch(`${BASE}/rest/v1/attendance_daily`, {
        method:  'POST',
        headers: { ...HDRS, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body:    JSON.stringify(chunk),
      })
      if (!res.ok) die(`att insert HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      attDone += chunk.length
      process.stdout.write(`\r   attendance_daily: ${attDone.toLocaleString()}/${totalAtt.toLocaleString()}  `)
    }
  }

  for (const emp of empRows) {
    const night = nightShiftIds.has(emp.id)
    for (const date of dates) {
      const a = pickAtt(night)
      attBuf.push({
        id: randomUUID(), tenant_id: TID, employee_id: emp.id, date,
        status: a.status, work_hours: a.work_hours,
        is_payable: a.is_payable, day_fraction: a.day_fraction,
        late_minutes:     a.status === 'late' ? randInt(5, 60) : 0,
        overtime_minutes: night && a.status === 'present' ? randInt(30, 120) : 0,
        confidence_score: 100, confidence_level: 'high',
      })
    }
    await flush()
  }
  await flush(true)
  console.log()

  // ── Summary ───────────────────────────────────────────────────────────────────
  const lvlLabels = ['L1 Exec','L2 Director','L3 Sr Manager','L4 Manager','L5 Senior','L6 Associate']
  console.log('\n' + sep)
  console.log('✓  Enterprise seed complete')
  console.log(`   Tenant:              ${TID}`)
  console.log(`   Employees:           ${empRows.length.toLocaleString()}`)
  counts.forEach((n, i) => console.log(`     ${lvlLabels[i].padEnd(18)} ${n}`))
  console.log(`   Compensations:       ${compRows.length.toLocaleString()} (${priorCompMeta.length} revision records)`)
  console.log(`   Components:          ${(compComponents.length + priorComponents.length).toLocaleString()}`)
  console.log(`   Leave balances:      ${leaveRows.length.toLocaleString()}`)
  console.log(`   Attendance rows:     ${attDone.toLocaleString()}`)
  console.log(`   Date range:          ${dates[0]} → ${dates[dates.length - 1]}`)
  console.log()
  console.log('   EAC scenario mix:')
  console.log(`     On notice:         ${scenarioCounts.onNotice}  (${(scenarioCounts.onNotice / empRows.length * 100).toFixed(1)}%)`)
  console.log(`     Probation:         ${scenarioCounts.probation}  (${(scenarioCounts.probation / empRows.length * 100).toFixed(1)}%)`)
  console.log(`     Night shift:       ${scenarioCounts.nightShift}  (${(scenarioCounts.nightShift / empRows.length * 100).toFixed(1)}%)`)
  console.log(`     Salary revision:   ${scenarioCounts.salRevision}  (${(scenarioCounts.salRevision / empRows.length * 100).toFixed(1)}%)`)
  console.log()
}

main().catch(e => { console.error('[seed] Fatal:', e.message); process.exit(1) })
