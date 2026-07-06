// ── Universal Master Import Framework — Row Validator ────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import { MASTER_TEMPLATES } from './templates.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RowError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidatedRow {
  rowNumber: number
  originalData: Record<string, string>
  normalizedData: Record<string, unknown>
  errors: RowError[]
  warnings: RowError[]
  isValid: boolean
  isDuplicate?: boolean
}

export interface ValidationResult {
  totalRows: number
  validRows: number
  invalidRows: number
  duplicateRows: number
  rows: ValidatedRow[]
  summary: {
    errorCategories: Record<string, number>
    missingRequired: string[]
    invalidEnums: string[]
    duplicateFields: string[]
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/
const DATE_REGEX  = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX  = /^\d{2}:\d{2}$/

function parseBoolean(val: string): boolean | null {
  const v = val.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return null
}

function parseNumber(val: string): number | null {
  const n = parseFloat(val.trim())
  return isNaN(n) ? null : n
}

// ── Lookup helpers (resolve code → UUID, stored in normalizedData) ────────────

/** Split an array into chunks of at most `size` elements. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

/**
 * Resolve a set of employee_codes to { code → employee_id } map.
 * Chunked into batches of 500 to stay under PostgREST's default max-rows limit.
 */
async function resolveEmployeeCodes(
  supabase: SupabaseClient,
  tenantId: string,
  codes: string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map()
  const result = new Map<string, string>()
  for (const chunk of chunkArray(codes, 500)) {
    const { data } = await supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', tenantId)
      .in('employee_code', chunk)
      .limit(500)
    if (data) {
      for (const r of data as any[]) {
        result.set(String(r.employee_code).toUpperCase(), r.id as string)
      }
    }
  }
  return result
}

/**
 * Resolve a set of code values from any tenant-scoped table to { code → id } map.
 * Chunked into batches of 500 to stay under PostgREST's default max-rows limit.
 */
async function resolveCodeToId(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  codeColumn: string,
  codes: string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map()
  const result = new Map<string, string>()
  for (const chunk of chunkArray(codes, 500)) {
    const { data } = await supabase
      .from(table)
      .select(`id, ${codeColumn}`)
      .eq('tenant_id', tenantId)
      .in(codeColumn, chunk)
      .limit(500)
    if (data) {
      for (const r of data as any[]) {
        result.set(String(r[codeColumn] ?? '').toUpperCase(), r.id as string)
      }
    }
  }
  return result
}

/**
 * Resolve a set of emails to { email → { id, code } } for conflict detection.
 * Chunked into batches of 500 to stay under PostgREST's default max-rows limit.
 */
async function resolveEmployeesByEmail(
  supabase: SupabaseClient,
  tenantId: string,
  emails: string[],
): Promise<Map<string, { id: string; code: string }>> {
  if (emails.length === 0) return new Map()
  const result = new Map<string, { id: string; code: string }>()
  for (const chunk of chunkArray(emails, 500)) {
    const { data } = await supabase
      .from('employees')
      .select('id, email, employee_code')
      .eq('tenant_id', tenantId)
      .in('email', chunk)
      .limit(500)
    if (data) {
      for (const r of data as any[]) {
        result.set(String(r.email ?? '').toLowerCase(), {
          id:   r.id   as string,
          code: String(r.employee_code ?? ''),
        })
      }
    }
  }
  return result
}

// ── Per-type normalisers & validators ─────────────────────────────────────────

function validateEmployee(
  rowNumber: number,
  raw: Record<string, string>,
  batchCodes: Set<string>,
): ValidatedRow {
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  // Trim all values first
  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) {
    d[k] = (raw[k] ?? '').trim()
  }

  // employee_code — required, uppercase
  if (!d.employee_code) {
    errors.push({ field: 'employee_code', message: 'Employee code is required', severity: 'error' })
  } else {
    norm.employee_code = d.employee_code.toUpperCase()
  }

  // first_name — required
  if (!d.first_name) {
    errors.push({ field: 'first_name', message: 'First name is required', severity: 'error' })
  } else {
    norm.first_name = d.first_name
  }

  // last_name — required
  if (!d.last_name) {
    errors.push({ field: 'last_name', message: 'Last name is required', severity: 'error' })
  } else {
    norm.last_name = d.last_name
  }

  // email — required, valid format, lowercase
  if (!d.email) {
    errors.push({ field: 'email', message: 'Email is required', severity: 'error' })
  } else if (!EMAIL_REGEX.test(d.email)) {
    errors.push({ field: 'email', message: `Invalid email format: "${d.email}"`, severity: 'error' })
  } else {
    norm.email = d.email.toLowerCase()
  }

  // phone — optional
  if (d.phone) norm.phone = d.phone

  // joining_date — required, YYYY-MM-DD
  if (!d.joining_date) {
    errors.push({ field: 'joining_date', message: 'Joining date is required', severity: 'error' })
  } else if (!DATE_REGEX.test(d.joining_date) || isNaN(Date.parse(d.joining_date))) {
    errors.push({ field: 'joining_date', message: `Invalid date format "${d.joining_date}" — expected YYYY-MM-DD`, severity: 'error' })
  } else {
    norm.joining_date = d.joining_date
  }

  // employment_type — required, enum
  const empTypeValues = ['permanent', 'contract', 'intern', 'probation', 'consultant']
  if (!d.employment_type) {
    errors.push({ field: 'employment_type', message: 'Employment type is required', severity: 'error' })
  } else if (!empTypeValues.includes(d.employment_type.toLowerCase())) {
    errors.push({
      field: 'employment_type',
      message: `Invalid employment_type "${d.employment_type}". Allowed: ${empTypeValues.join(', ')}`,
      severity: 'error',
    })
  } else {
    norm.employment_type = d.employment_type.toLowerCase()
  }

  // status — optional enum, default active
  if (d.status) {
    if (!['active', 'inactive'].includes(d.status.toLowerCase())) {
      errors.push({
        field: 'status',
        message: `Invalid status "${d.status}". Allowed: active, inactive`,
        severity: 'error',
      })
    } else {
      norm.status = d.status.toLowerCase()
    }
  } else {
    norm.status = 'active'
  }

  // optional reference codes (warn if present — DB existence check done later)
  if (d.department_code)       norm.department_code       = d.department_code
  if (d.designation_code)      norm.designation_code      = d.designation_code
  if (d.grade_code)            norm.grade_code            = d.grade_code
  if (d.manager_employee_code) norm.manager_employee_code = d.manager_employee_code
  if (d.work_location_code)    norm.work_location_code    = d.work_location_code

  // pan_number — optional, uppercase
  if (d.pan_number) norm.pan_number = d.pan_number.toUpperCase()

  // uan_number — optional
  if (d.uan_number) norm.uan_number = d.uan_number

  // Batch-level duplicate check
  let isDuplicate = false
  if (norm.employee_code) {
    const code = norm.employee_code as string
    if (batchCodes.has(code)) {
      errors.push({
        field: 'employee_code',
        message: `Duplicate employee_code "${code}" within this import batch`,
        severity: 'error',
      })
      isDuplicate = true
    } else {
      batchCodes.add(code)
    }
  }

  return {
    rowNumber,
    originalData: raw,
    normalizedData: norm,
    errors,
    warnings,
    isValid: errors.length === 0,
    isDuplicate,
  }
}

function validateGenericMaster(
  rowNumber: number,
  raw: Record<string, string>,
  masterType: string,
  batchCodes: Set<string>,
): ValidatedRow {
  const spec = MASTER_TEMPLATES[masterType]
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) {
    d[k] = (raw[k] ?? '').trim()
  }

  // Check required fields
  for (const col of spec.columns) {
    const val = d[col.key] ?? ''
    if (col.required && !val) {
      errors.push({ field: col.key, message: `${col.label} is required`, severity: 'error' })
      continue
    }
    if (!val) continue

    if (col.type === 'date') {
      if (!DATE_REGEX.test(val) || isNaN(Date.parse(val))) {
        errors.push({
          field: col.key,
          message: `Invalid date format "${val}" for ${col.label} — expected YYYY-MM-DD`,
          severity: 'error',
        })
      } else {
        norm[col.key] = val
      }
    } else if (col.type === 'boolean') {
      const bv = parseBoolean(val)
      if (bv === null) {
        errors.push({
          field: col.key,
          message: `Invalid boolean "${val}" for ${col.label} — use true or false`,
          severity: 'error',
        })
      } else {
        norm[col.key] = bv
      }
    } else if (col.type === 'number') {
      const nv = parseNumber(val)
      if (nv === null) {
        errors.push({
          field: col.key,
          message: `Invalid number "${val}" for ${col.label}`,
          severity: 'error',
        })
      } else {
        norm[col.key] = nv
      }
    } else if (col.type === 'enum' && col.enumValues) {
      if (!col.enumValues.includes(val.toLowerCase())) {
        errors.push({
          field: col.key,
          message: `Invalid value "${val}" for ${col.label}. Allowed: ${col.enumValues.join(', ')}`,
          severity: 'error',
        })
      } else {
        norm[col.key] = val.toLowerCase()
      }
    } else {
      // string — special time format check for shifts
      if (masterType === 'shifts' && (col.key === 'start_time' || col.key === 'end_time')) {
        if (!TIME_REGEX.test(val)) {
          errors.push({
            field: col.key,
            message: `Invalid time format "${val}" for ${col.label} — expected HH:MM`,
            severity: 'error',
          })
        } else {
          norm[col.key] = val
        }
      } else {
        norm[col.key] = val
      }
    }
  }

  // Batch duplicate check on 'code' or 'name' (leave_types uses name,
  // employee_bank_details keys on employee_code)
  const uniqueKey =
    masterType === 'leave_types' ? 'name' :
    masterType === 'holiday_groups' ? 'name' :
    masterType === 'employee_bank_details' ? 'employee_code' :
    'code'
  const codeVal = (d[uniqueKey] ?? '').toUpperCase()
  let isDuplicate = false
  if (codeVal) {
    if (batchCodes.has(codeVal)) {
      errors.push({
        field: uniqueKey,
        message: `Duplicate ${uniqueKey} "${d[uniqueKey]}" within this import batch`,
        severity: 'error',
      })
      isDuplicate = true
    } else {
      batchCodes.add(codeVal)
    }
  }

  return {
    rowNumber,
    originalData: raw,
    normalizedData: norm,
    errors,
    warnings,
    isValid: errors.length === 0,
    isDuplicate,
  }
}

// ── Enterprise import validators ─────────────────────────────────────────────

function validateEmployeeCompensation(
  rowNumber: number,
  raw: Record<string, string>,
  batchKeys: Set<string>,
): ValidatedRow {
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) d[k] = (raw[k] ?? '').trim()

  // employee_code — required, uppercase
  if (!d.employee_code) {
    errors.push({ field: 'employee_code', message: 'Employee code is required', severity: 'error' })
  } else {
    norm.employee_code = d.employee_code.toUpperCase()
  }

  // effective_from — required, YYYY-MM-DD
  if (!d.effective_from) {
    errors.push({ field: 'effective_from', message: 'Effective from date is required', severity: 'error' })
  } else if (!DATE_REGEX.test(d.effective_from) || isNaN(Date.parse(d.effective_from))) {
    errors.push({
      field: 'effective_from',
      message: `Invalid date format "${d.effective_from}" — expected YYYY-MM-DD`,
      severity: 'error',
    })
  } else {
    norm.effective_from = d.effective_from
  }

  // ctc_annual — required, positive number
  if (!d.ctc_annual) {
    errors.push({ field: 'ctc_annual', message: 'CTC Annual is required', severity: 'error' })
  } else {
    const ctc = parseNumber(d.ctc_annual)
    if (ctc === null || ctc <= 0) {
      errors.push({ field: 'ctc_annual', message: `Invalid CTC "${d.ctc_annual}" — must be a positive number`, severity: 'error' })
    } else {
      norm.ctc_annual = ctc
    }
  }

  // salary_structure_code — optional
  if (d.salary_structure_code) norm.salary_structure_code = d.salary_structure_code

  // notes — optional
  if (d.notes) norm.notes = d.notes

  // Batch duplicate check: same employee_code + effective_from pair
  const batchKey = `${(norm.employee_code as string) ?? ''}|${(norm.effective_from as string) ?? ''}`
  let isDuplicate = false
  if (norm.employee_code && norm.effective_from) {
    if (batchKeys.has(batchKey)) {
      errors.push({
        field: 'employee_code',
        message: `Duplicate employee_code + effective_from "${d.employee_code} / ${d.effective_from}" within this batch`,
        severity: 'error',
      })
      isDuplicate = true
    } else {
      batchKeys.add(batchKey)
    }
  }

  return { rowNumber, originalData: raw, normalizedData: norm, errors, warnings, isValid: errors.length === 0, isDuplicate }
}

function validateLeaveOpeningBalance(
  rowNumber: number,
  raw: Record<string, string>,
  batchKeys: Set<string>,
): ValidatedRow {
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) d[k] = (raw[k] ?? '').trim()

  // employee_code — required
  if (!d.employee_code) {
    errors.push({ field: 'employee_code', message: 'Employee code is required', severity: 'error' })
  } else {
    norm.employee_code = d.employee_code.toUpperCase()
  }

  // leave_type_name — required
  if (!d.leave_type_name) {
    errors.push({ field: 'leave_type_name', message: 'Leave type name is required', severity: 'error' })
  } else {
    norm.leave_type_name = d.leave_type_name
  }

  // balance — required, non-negative
  if (!d.balance) {
    errors.push({ field: 'balance', message: 'Balance is required', severity: 'error' })
  } else {
    const bal = parseNumber(d.balance)
    if (bal === null || bal < 0) {
      errors.push({ field: 'balance', message: `Invalid balance "${d.balance}" — must be a non-negative number`, severity: 'error' })
    } else {
      norm.balance = bal
    }
  }

  // year — optional, defaults to current year
  if (d.year) {
    const y = parseNumber(d.year)
    if (y === null || !Number.isInteger(y) || y < 2000 || y > 2100) {
      errors.push({ field: 'year', message: `Invalid year "${d.year}" — expected a 4-digit year`, severity: 'error' })
    } else {
      norm.year = y
    }
  } else {
    norm.year = new Date().getFullYear()
  }

  // carry_forward_balance — optional, defaults to 0
  if (d.carry_forward_balance) {
    const cf = parseNumber(d.carry_forward_balance)
    if (cf === null || cf < 0) {
      errors.push({ field: 'carry_forward_balance', message: `Invalid carry_forward_balance "${d.carry_forward_balance}"`, severity: 'error' })
    } else {
      norm.carry_forward_balance = cf
    }
  } else {
    norm.carry_forward_balance = 0
  }

  // Batch duplicate check: same employee + leave_type + year
  const batchKey = `${(norm.employee_code as string) ?? ''}|${(norm.leave_type_name as string) ?? ''}|${norm.year ?? ''}`
  let isDuplicate = false
  if (norm.employee_code && norm.leave_type_name) {
    if (batchKeys.has(batchKey)) {
      errors.push({
        field: 'employee_code',
        message: `Duplicate employee + leave type + year combination "${d.employee_code} / ${d.leave_type_name} / ${norm.year}" in this batch`,
        severity: 'error',
      })
      isDuplicate = true
    } else {
      batchKeys.add(batchKey)
    }
  }

  return { rowNumber, originalData: raw, normalizedData: norm, errors, warnings, isValid: errors.length === 0, isDuplicate }
}

function validateShiftAssignment(
  rowNumber: number,
  raw: Record<string, string>,
  batchKeys: Set<string>,
): ValidatedRow {
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) d[k] = (raw[k] ?? '').trim()

  // employee_code — required
  if (!d.employee_code) {
    errors.push({ field: 'employee_code', message: 'Employee code is required', severity: 'error' })
  } else {
    norm.employee_code = d.employee_code.toUpperCase()
  }

  // shift_code — required
  if (!d.shift_code) {
    errors.push({ field: 'shift_code', message: 'Shift code is required', severity: 'error' })
  } else {
    norm.shift_code = d.shift_code.toUpperCase()
  }

  // effective_from — required, YYYY-MM-DD
  if (!d.effective_from) {
    errors.push({ field: 'effective_from', message: 'Effective from date is required', severity: 'error' })
  } else if (!DATE_REGEX.test(d.effective_from) || isNaN(Date.parse(d.effective_from))) {
    errors.push({
      field: 'effective_from',
      message: `Invalid date format "${d.effective_from}" — expected YYYY-MM-DD`,
      severity: 'error',
    })
  } else {
    norm.effective_from = d.effective_from
  }

  // Batch duplicate: same employee + effective_from (one shift per employee per date)
  const batchKey = `${(norm.employee_code as string) ?? ''}|${(norm.effective_from as string) ?? ''}`
  let isDuplicate = false
  if (norm.employee_code && norm.effective_from) {
    if (batchKeys.has(batchKey)) {
      errors.push({
        field: 'employee_code',
        message: `Duplicate employee + effective_from "${d.employee_code} / ${d.effective_from}" in this batch — only one shift per employee per date allowed`,
        severity: 'error',
      })
      isDuplicate = true
    } else {
      batchKeys.add(batchKey)
    }
  }

  return { rowNumber, originalData: raw, normalizedData: norm, errors, warnings, isValid: errors.length === 0, isDuplicate }
}

// ── Rotation Policy validator (grouped multi-row: 1 row per condition rule) ────

const ROTATION_CONDITIONS = ['weekday_working', 'saturday_working', 'sunday_working', 'half_day', 'holiday_working']

function validateRotationPolicy(
  rowNumber: number,
  raw: Record<string, string>,
  batchKeys: Set<string>,
): ValidatedRow {
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) d[k] = (raw[k] ?? '').trim()

  // policy_name — required (group key)
  if (!d.policy_name) {
    errors.push({ field: 'policy_name', message: 'Policy name is required', severity: 'error' })
  } else {
    norm.policy_name = d.policy_name
  }

  // condition_type — required, enum
  if (!d.condition_type) {
    errors.push({ field: 'condition_type', message: 'Condition is required', severity: 'error' })
  } else {
    const ct = d.condition_type.toLowerCase().replace(/[\s-]+/g, '_')
    if (!ROTATION_CONDITIONS.includes(ct)) {
      errors.push({ field: 'condition_type', message: `Invalid condition "${d.condition_type}" — expected one of ${ROTATION_CONDITIONS.join(', ')}`, severity: 'error' })
    } else {
      norm.condition_type = ct
    }
  }

  // shift_code — required (resolved to shift_id in the DB-checks phase)
  if (!d.shift_code) {
    errors.push({ field: 'shift_code', message: 'Shift code is required', severity: 'error' })
  } else {
    norm.shift_code = d.shift_code.toUpperCase()
  }

  // description / is_active — policy-level (optional)
  if (d.description) norm.description = d.description
  if (d.is_active !== undefined && d.is_active !== '') {
    norm.is_active = /^(true|yes|1|y|active)$/i.test(d.is_active)
  }

  // sort_order — optional number
  if (d.sort_order) {
    const n = Number(d.sort_order)
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'sort_order', message: `Invalid sort order "${d.sort_order}"`, severity: 'error' })
    } else {
      norm.sort_order = Math.trunc(n)
    }
  }

  // Batch duplicate: one shift per (policy, condition) — UNIQUE(rotation_policy_id, condition_type)
  const batchKey = `${(norm.policy_name as string) ?? ''}|${(norm.condition_type as string) ?? ''}`
  if (norm.policy_name && norm.condition_type) {
    if (batchKeys.has(batchKey)) {
      errors.push({ field: 'condition_type', message: `Duplicate "${d.policy_name} / ${d.condition_type}" in this sheet — only one shift per condition per policy`, severity: 'error' })
    } else {
      batchKeys.add(batchKey)
    }
  }

  return { rowNumber, originalData: raw, normalizedData: norm, errors, warnings, isValid: errors.length === 0, isDuplicate: false }
}

// ── Compensation Revision validator ───────────────────────────────────────────

function validateCompensationRevision(
  rowNumber: number,
  raw: Record<string, string>,
  batchKeys: Set<string>,
): ValidatedRow {
  const errors: RowError[]   = []
  const warnings: RowError[] = []
  const norm: Record<string, unknown> = {}

  const d: Record<string, string> = {}
  for (const k of Object.keys(raw)) d[k] = (raw[k] ?? '').trim()

  // employee_code — required
  if (!d.employee_code) {
    errors.push({ field: 'employee_code', message: 'Employee code is required', severity: 'error' })
  } else {
    norm.employee_code = d.employee_code.toUpperCase()
  }

  // revision_type — required enum
  const REVISION_TYPES = ['increment','promotion','restructure','correction','transfer']
  if (!d.revision_type) {
    errors.push({ field: 'revision_type', message: 'Revision type is required', severity: 'error' })
  } else if (!REVISION_TYPES.includes(d.revision_type.toLowerCase())) {
    errors.push({
      field: 'revision_type',
      message: `Invalid revision_type "${d.revision_type}". Allowed: ${REVISION_TYPES.join(', ')}`,
      severity: 'error',
    })
  } else {
    norm.revision_type = d.revision_type.toLowerCase()
  }

  // effective_date — required YYYY-MM-DD
  if (!d.effective_date) {
    errors.push({ field: 'effective_date', message: 'Effective date is required', severity: 'error' })
  } else if (!DATE_REGEX.test(d.effective_date) || isNaN(Date.parse(d.effective_date))) {
    errors.push({ field: 'effective_date', message: `Invalid date "${d.effective_date}" — expected YYYY-MM-DD`, severity: 'error' })
  } else {
    norm.effective_date = d.effective_date
  }

  // new_ctc_annual — required positive number
  if (!d.new_ctc_annual) {
    errors.push({ field: 'new_ctc_annual', message: 'New annual CTC is required', severity: 'error' })
  } else {
    const ctc = parseNumber(d.new_ctc_annual)
    if (ctc === null || ctc <= 0) {
      errors.push({ field: 'new_ctc_annual', message: `Invalid CTC "${d.new_ctc_annual}" — must be a positive number`, severity: 'error' })
    } else {
      norm.new_ctc_annual = ctc
    }
  }

  // reason — required
  if (!d.reason) {
    errors.push({ field: 'reason', message: 'Reason is required', severity: 'error' })
  } else {
    norm.reason = d.reason
  }

  // notes — optional
  if (d.notes) norm.notes = d.notes

  // Batch duplicate: same employee + effective_date + revision_type (DB UNIQUE constraint)
  const batchKey = `${(norm.employee_code as string) ?? ''}|${(norm.effective_date as string) ?? ''}|${(norm.revision_type as string) ?? ''}`
  let isDuplicate = false
  if (norm.employee_code && norm.effective_date && norm.revision_type) {
    if (batchKeys.has(batchKey)) {
      errors.push({
        field: 'employee_code',
        message: `Duplicate employee + effective_date + revision_type in this batch — only one ${d.revision_type} revision per employee per date is allowed`,
        severity: 'error',
      })
      isDuplicate = true
    } else {
      batchKeys.add(batchKey)
    }
  }

  return { rowNumber, originalData: raw, normalizedData: norm, errors, warnings, isValid: errors.length === 0, isDuplicate }
}

// ── DB existence checks ───────────────────────────────────────────────────────

async function checkExistingCodes(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  codeColumn: string,
  codes: string[],
): Promise<Set<string>> {
  if (codes.length === 0) return new Set()
  const result = new Set<string>()
  for (const chunk of chunkArray(codes, 500)) {
    const { data } = await supabase
      .from(table)
      .select(codeColumn)
      .eq('tenant_id', tenantId)
      .in(codeColumn, chunk)
      .limit(500)
    if (data) {
      for (const r of data as any[]) result.add(String(r[codeColumn] ?? '').toUpperCase())
    }
  }
  return result
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function validateImportRows(
  supabase: SupabaseClient,
  tenantId: string,
  masterType: string,
  rows: Record<string, string>[],
): Promise<ValidationResult> {
  const batchCodes = new Set<string>()
  const validatedRows: ValidatedRow[] = []

  // Per-row validation
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2 // row 1 = header, data starts at row 2
    let vr: ValidatedRow

    if (masterType === 'employees') {
      vr = validateEmployee(rowNumber, rows[i], batchCodes)
    } else if (masterType === 'employee_compensation') {
      vr = validateEmployeeCompensation(rowNumber, rows[i], batchCodes)
    } else if (masterType === 'leave_opening_balances') {
      vr = validateLeaveOpeningBalance(rowNumber, rows[i], batchCodes)
    } else if (masterType === 'shift_assignments') {
      vr = validateShiftAssignment(rowNumber, rows[i], batchCodes)
    } else if (masterType === 'compensation_revisions') {
      vr = validateCompensationRevision(rowNumber, rows[i], batchCodes)
    } else if (masterType === 'rotation_policies') {
      vr = validateRotationPolicy(rowNumber, rows[i], batchCodes)
    } else {
      const spec = MASTER_TEMPLATES[masterType]
      if (!spec) {
        vr = {
          rowNumber,
          originalData: rows[i],
          normalizedData: {},
          errors: [{ field: '_row', message: `Unknown master type: ${masterType}`, severity: 'error' }],
          warnings: [],
          isValid: false,
        }
      } else {
        vr = validateGenericMaster(rowNumber, rows[i], masterType, batchCodes)
      }
    }

    validatedRows.push(vr)
  }

  // ── DB Checks ────────────────────────────────────────────────────────────────

  if (masterType === 'employees') {
    // Collect all valid codes in the batch for DB lookups
    const codesInBatch = validatedRows
      .filter((r) => r.isValid && r.normalizedData.employee_code)
      .map((r) => (r.normalizedData.employee_code as string).toUpperCase())

    // Collect optional ref codes for batch UUID resolution
    const pick = (field: string) => [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData[field])
          .map((r) => r.normalizedData[field] as string),
      ),
    ]

    // Collect emails of valid rows for email-conflict detection
    const emailsInBatch = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.email)
          .map((r) => (r.normalizedData.email as string).toLowerCase()),
      ),
    ]

    // Resolve all lookups in parallel
    const [
      empCodeMap,
      deptIdMap,
      desgIdMap,
      gradeIdMap,
      locIdMap,
      mgrCodeMap,
      empEmailMap,
    ] = await Promise.all([
      resolveEmployeeCodes(supabase, tenantId, codesInBatch),
      resolveCodeToId(supabase, tenantId, 'departments',  'code', pick('department_code')),
      resolveCodeToId(supabase, tenantId, 'designations', 'code', pick('designation_code')),
      resolveCodeToId(supabase, tenantId, 'grades',       'code', pick('grade_code')),
      resolveCodeToId(supabase, tenantId, 'work_locations', 'code', pick('work_location_code')),
      resolveEmployeeCodes(supabase, tenantId, pick('manager_employee_code')),
      resolveEmployeesByEmail(supabase, tenantId, emailsInBatch),
    ])

    for (const vr of validatedRows) {
      if (!vr.isValid) continue

      // Mark duplicate & store employee_id (needed for update path in importer)
      const code = (vr.normalizedData.employee_code as string | undefined)?.toUpperCase()
      if (code) {
        const empId = empCodeMap.get(code)
        if (empId) {
          vr.isDuplicate = true
          vr.normalizedData.employee_id = empId
        }
      }

      // Email-based match: if code lookup didn't find a match but this email already
      // belongs to an existing employee (e.g. previously imported with an auto-code),
      // treat it as an update and carry the new code as the desired employee_code.
      // This supports migration workflows where old-system codes need to replace
      // auto-generated ones without deleting and re-importing the employee.
      if (!vr.isDuplicate && vr.normalizedData.email) {
        const email = (vr.normalizedData.email as string).toLowerCase()
        const conflict = empEmailMap.get(email)
        if (conflict) {
          const existingCode = conflict.code
          const providedCode = (vr.normalizedData.employee_code as string | undefined) ?? ''
          if (existingCode && providedCode && existingCode.toUpperCase() !== providedCode.toUpperCase()) {
            // Different code — update the employee and rename their code
            vr.isDuplicate = true
            vr.normalizedData.employee_id         = conflict.id
            vr.normalizedData.employee_code_changed = true
            vr.warnings.push({
              field:    'employee_code',
              message:  `Employee code will be updated from "${existingCode}" → "${providedCode}" (matched by email)`,
              severity: 'warning',
            })
          } else {
            // Same code or no code provided — normal email-conflict error
            vr.errors.push({
              field:    'email',
              message:  `Email "${email}" already belongs to employee ${existingCode} in this tenant. Update the employee_code in your CSV to "${existingCode}" so this row is treated as an update, or remove it if no change is needed.`,
              severity: 'error',
            })
            vr.isValid = false
          }
        }
      }

      // Resolve department_code → department_id
      const deptCode = vr.normalizedData.department_code as string | undefined
      if (deptCode) {
        const deptId = deptIdMap.get(deptCode.toUpperCase())
        if (deptId) {
          vr.normalizedData.department_id = deptId
        } else {
          vr.warnings.push({ field: 'department_code', message: `Department "${deptCode}" not found — will be ignored`, severity: 'warning' })
        }
      }

      // Resolve designation_code → designation_id
      const desgCode = vr.normalizedData.designation_code as string | undefined
      if (desgCode) {
        const desgId = desgIdMap.get(desgCode.toUpperCase())
        if (desgId) {
          vr.normalizedData.designation_id = desgId
        } else {
          vr.warnings.push({ field: 'designation_code', message: `Designation "${desgCode}" not found — will be ignored`, severity: 'warning' })
        }
      }

      // Resolve grade_code → grade_id
      const gradeCode = vr.normalizedData.grade_code as string | undefined
      if (gradeCode) {
        const gradeId = gradeIdMap.get(gradeCode.toUpperCase())
        if (gradeId) {
          vr.normalizedData.grade_id = gradeId
        } else {
          vr.warnings.push({ field: 'grade_code', message: `Grade "${gradeCode}" not found — will be ignored`, severity: 'warning' })
        }
      }

      // Resolve work_location_code → work_location_id
      const locCode = vr.normalizedData.work_location_code as string | undefined
      if (locCode) {
        const locId = locIdMap.get(locCode.toUpperCase())
        if (locId) {
          vr.normalizedData.work_location_id = locId
        } else {
          vr.warnings.push({ field: 'work_location_code', message: `Work location "${locCode}" not found — will be ignored`, severity: 'warning' })
        }
      }

      // Resolve manager_employee_code → manager_id
      const mgrCode = vr.normalizedData.manager_employee_code as string | undefined
      if (mgrCode) {
        const mgrId = mgrCodeMap.get(mgrCode.toUpperCase())
        if (mgrId) {
          vr.normalizedData.manager_id = mgrId
        } else {
          vr.warnings.push({ field: 'manager_employee_code', message: `Manager "${mgrCode}" not found — will be ignored`, severity: 'warning' })
        }
      }
    }
  } else if (masterType === 'employee_compensation') {
    // Validate employee_codes exist + resolve to UUIDs
    const empCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.employee_code)
          .map((r) => r.normalizedData.employee_code as string),
      ),
    ]
    const empCodeMap = await resolveEmployeeCodes(supabase, tenantId, empCodes)

    // Resolve salary_structure_codes (optional)
    const ssCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.salary_structure_code)
          .map((r) => r.normalizedData.salary_structure_code as string),
      ),
    ]
    let ssCodeMap = new Map<string, string>()
    if (ssCodes.length > 0) {
      const { data: ssData } = await supabase
        .from('salary_structures')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('code', ssCodes)
      if (ssData) {
        ssCodeMap = new Map((ssData as any[]).map((r) => [String(r.code).toUpperCase(), r.id as string]))
      }
    }

    for (const vr of validatedRows) {
      if (!vr.isValid) continue

      const code = vr.normalizedData.employee_code as string
      const empId = empCodeMap.get(code.toUpperCase())
      if (!empId) {
        vr.errors.push({ field: 'employee_code', message: `Employee "${code}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      // Store resolved UUID for importer
      vr.normalizedData.employee_id = empId

      const ssCode = vr.normalizedData.salary_structure_code as string | undefined
      if (ssCode) {
        const ssId = ssCodeMap.get(ssCode.toUpperCase())
        if (!ssId) {
          vr.warnings.push({ field: 'salary_structure_code', message: `Salary structure "${ssCode}" not found — salary_structure_id will be left blank (assign manually after import)`, severity: 'warning' })
          delete vr.normalizedData.salary_structure_code
        } else {
          vr.normalizedData.salary_structure_id = ssId
          delete vr.normalizedData.salary_structure_code
        }
      }

      // Check if an active compensation already exists for this employee + effective_from
      const { data: existingComp } = await supabase
        .from('employee_compensations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', empId)
        .eq('effective_from', vr.normalizedData.effective_from as string)
        .eq('is_active', true)
        .maybeSingle()

      if (existingComp) {
        vr.isDuplicate = true
        // Not an error — importer will deactivate old and create new (upsert semantics)
      }
    }
  } else if (masterType === 'leave_opening_balances') {
    // Resolve employee_codes
    const empCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.employee_code)
          .map((r) => r.normalizedData.employee_code as string),
      ),
    ]
    const empCodeMap = await resolveEmployeeCodes(supabase, tenantId, empCodes)

    // Resolve leave_type names
    const leaveTypeNames = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.leave_type_name)
          .map((r) => r.normalizedData.leave_type_name as string),
      ),
    ]
    let leaveTypeMap = new Map<string, string>()
    if (leaveTypeNames.length > 0) {
      const { data: ltData } = await supabase
        .from('leave_types')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('name', leaveTypeNames)
      if (ltData) {
        leaveTypeMap = new Map((ltData as any[]).map((r) => [String(r.name).toLowerCase(), r.id as string]))
      }
    }

    for (const vr of validatedRows) {
      if (!vr.isValid) continue

      const empCode = vr.normalizedData.employee_code as string
      const empId   = empCodeMap.get(empCode.toUpperCase())
      if (!empId) {
        vr.errors.push({ field: 'employee_code', message: `Employee "${empCode}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.employee_id = empId

      const ltName = vr.normalizedData.leave_type_name as string
      const ltId   = leaveTypeMap.get(ltName.toLowerCase())
      if (!ltId) {
        vr.errors.push({ field: 'leave_type_name', message: `Leave type "${ltName}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.leave_type_id = ltId

      // Check for existing balance (upsert will overwrite)
      const { data: existingBal } = await supabase
        .from('employee_leave_balance')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', empId)
        .eq('leave_type_id', ltId)
        .eq('year', vr.normalizedData.year as number)
        .maybeSingle()

      if (existingBal) {
        vr.isDuplicate = true // Will overwrite existing opening balance
      }
    }
  } else if (masterType === 'shift_assignments') {
    // Resolve employee_codes
    const empCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.employee_code)
          .map((r) => r.normalizedData.employee_code as string),
      ),
    ]
    const empCodeMap = await resolveEmployeeCodes(supabase, tenantId, empCodes)

    // Resolve shift_codes
    const shiftCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.shift_code)
          .map((r) => r.normalizedData.shift_code as string),
      ),
    ]
    let shiftCodeMap = new Map<string, string>()
    if (shiftCodes.length > 0) {
      const { data: shiftData } = await supabase
        .from('shifts')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('code', shiftCodes)
      if (shiftData) {
        shiftCodeMap = new Map((shiftData as any[]).map((r) => [String(r.code).toUpperCase(), r.id as string]))
      }
    }

    for (const vr of validatedRows) {
      if (!vr.isValid) continue

      const empCode = vr.normalizedData.employee_code as string
      const empId   = empCodeMap.get(empCode.toUpperCase())
      if (!empId) {
        vr.errors.push({ field: 'employee_code', message: `Employee "${empCode}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.employee_id = empId

      const shiftCode = vr.normalizedData.shift_code as string
      const shiftId   = shiftCodeMap.get(shiftCode.toUpperCase())
      if (!shiftId) {
        vr.errors.push({ field: 'shift_code', message: `Shift "${shiftCode}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.shift_id = shiftId

      // Check for existing assignment at the same effective_from (warn, will replace)
      const { data: existingAssign } = await supabase
        .from('employee_shifts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', empId)
        .eq('effective_from', vr.normalizedData.effective_from as string)
        .maybeSingle()

      if (existingAssign) {
        vr.isDuplicate = true // Will overwrite
      }
    }
  } else if (masterType === 'rotation_policies') {
    // Resolve shift_code → shift_id
    const shiftCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.shift_code)
          .map((r) => r.normalizedData.shift_code as string),
      ),
    ]
    let shiftCodeMap = new Map<string, string>()
    if (shiftCodes.length > 0) {
      const { data: shiftData } = await supabase
        .from('shifts')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('code', shiftCodes)
      if (shiftData) {
        shiftCodeMap = new Map((shiftData as any[]).map((r) => [String(r.code).toUpperCase(), r.id as string]))
      }
    }

    // Which policy names already exist → mark every row of that policy as duplicate (update path)
    const policyNames = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.policy_name)
          .map((r) => r.normalizedData.policy_name as string),
      ),
    ]
    const existingPolicies = new Set<string>()
    if (policyNames.length > 0) {
      const { data: polData } = await supabase
        .from('rotation_policies')
        .select('name')
        .eq('tenant_id', tenantId)
        .in('name', policyNames)
      if (polData) for (const r of polData as any[]) existingPolicies.add(String(r.name))
    }

    for (const vr of validatedRows) {
      if (!vr.isValid) continue
      const shiftCode = vr.normalizedData.shift_code as string
      const shiftId   = shiftCodeMap.get(shiftCode.toUpperCase())
      if (!shiftId) {
        vr.errors.push({ field: 'shift_code', message: `Shift "${shiftCode}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.shift_id = shiftId
      if (existingPolicies.has(vr.normalizedData.policy_name as string)) vr.isDuplicate = true
    }
  } else if (masterType === 'employee_bank_details') {
    // Resolve employee_code → employee_id
    const empCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.employee_code)
          .map((r) => r.normalizedData.employee_code as string),
      ),
    ]
    const empCodeMap = await resolveEmployeeCodes(supabase, tenantId, empCodes)

    // Flag rows whose employee already has a bank/statutory record (will update)
    const empIds = [...empCodeMap.values()]
    const existingBank = new Set<string>()
    if (empIds.length > 0) {
      const { data: bankRows } = await supabase
        .from('employee_bank_statutory')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .in('employee_id', empIds)
      if (bankRows) for (const r of bankRows as any[]) existingBank.add(r.employee_id as string)
    }

    for (const vr of validatedRows) {
      if (!vr.isValid) continue
      const empCode = vr.normalizedData.employee_code as string
      const empId   = empCodeMap.get(empCode.toUpperCase())
      if (!empId) {
        vr.errors.push({ field: 'employee_code', message: `Employee "${empCode}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.employee_id = empId
      if (existingBank.has(empId)) vr.isDuplicate = true // upsert will update
    }
  } else if (masterType === 'work_locations') {
    // ── Resolve optional site_code → site_id ────────────────────────────────
    // site_code maps to sites.code (added by migration 116).
    const siteCodesInBatch = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.site_code)
          .map((r) => (r.normalizedData.site_code as string).toUpperCase()),
      ),
    ]
    let siteCodeMap = new Map<string, string>()
    if (siteCodesInBatch.length > 0) {
      const { data: siteRows } = await supabase
        .from('sites')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('code', siteCodesInBatch)
      if (siteRows) {
        siteCodeMap = new Map(
          (siteRows as Array<{ id: string; code: string }>)
            .filter((s) => s.code)
            .map((s) => [s.code.toUpperCase(), s.id]),
        )
      }
    }

    for (const vr of validatedRows) {
      if (!vr.isValid) continue
      const siteCode = vr.normalizedData.site_code as string | undefined
      if (siteCode) {
        const siteId = siteCodeMap.get(siteCode.toUpperCase())
        if (siteId) {
          vr.normalizedData.site_id = siteId
        } else {
          vr.warnings.push({
            field:    'site_code',
            message:  `Site "${siteCode}" not found — work location will be created without a site assignment`,
            severity: 'warning',
          })
        }
      }
    }

    // Generic duplicate check (same as else-branch below)
    const codesInBatch = validatedRows
      .filter((r) => r.normalizedData.code)
      .map((r) => r.normalizedData.code as string)
    if (codesInBatch.length > 0) {
      const existingCodes = await checkExistingCodes(
        supabase, tenantId, 'work_locations', 'code', codesInBatch,
      )
      for (const vr of validatedRows) {
        if (!vr.isValid) continue
        const code = vr.normalizedData.code as string | undefined
        if (code && existingCodes.has(code.toUpperCase())) {
          vr.isDuplicate = true
        }
      }
    }

  } else if (masterType === 'compensation_revisions') {
    // Resolve employee_codes → employee_ids (required)
    const empCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.isValid && r.normalizedData.employee_code)
          .map((r) => r.normalizedData.employee_code as string),
      ),
    ]
    const empCodeMap = await resolveEmployeeCodes(supabase, tenantId, empCodes)

    for (const vr of validatedRows) {
      if (!vr.isValid) continue
      const code  = vr.normalizedData.employee_code as string
      const empId = empCodeMap.get(code.toUpperCase())
      if (!empId) {
        vr.errors.push({ field: 'employee_code', message: `Employee "${code}" not found`, severity: 'error' })
        vr.isValid = false
        continue
      }
      vr.normalizedData.employee_id = empId

      // Warn if a pending revision already exists for the same employee + effective_date
      const { data: existing } = await supabase
        .from('compensation_revisions')
        .select('id, status')
        .eq('tenant_id', tenantId)
        .eq('employee_id', empId)
        .eq('effective_date', vr.normalizedData.effective_date as string)
        .in('status', ['pending', 'approved'])
        .limit(1)
        .maybeSingle()

      if (existing) {
        vr.isDuplicate = true
        vr.warnings.push({
          field: 'effective_date',
          message: `A ${(existing as { status: string }).status} revision already exists for this employee on ${vr.normalizedData.effective_date} — will create an additional revision`,
          severity: 'warning',
        })
      }
    }
  } else {
    // Generic code-level DB check
    const uniqueKey = (masterType === 'leave_types' || masterType === 'holiday_groups') ? 'name' : 'code'
    const tableMap: Record<string, string> = {
      sites:                 'sites',
      states:                'states',
      clusters:              'clusters',
      shifts:                'shifts',
      rosters:               'rosters',
      departments:           'departments',
      designations:          'designations',
      work_locations:        'work_locations',
      cost_centers:          'cost_centers',
      salary_components:     'salary_components',
      leave_types:           'leave_types',
      holiday_calendar:      'holiday_calendar',
      // Enterprise operational masters
      grades:                'grades',
      payroll_groups:        'payroll_groups',
      employment_categories: 'employment_categories',
      statutory_groups:      'statutory_groups',
      asset_categories:      'asset_categories',
      // Payroll masters
      salary_structures:     'salary_structures',
      // Workforce planning
      positions:             'positions',
      // Reference data
      document_types:        'document_types',
      identity_types:        'identity_types',
      relationship_types:    'relationship_types',
      important_date_types:  'important_date_types',
      holiday_groups:        'holiday_groups',
    }
    const table = tableMap[masterType]

    if (table) {
      const codesInBatch = validatedRows
        .filter((r) => r.normalizedData[uniqueKey])
        .map((r) => r.normalizedData[uniqueKey] as string)

      if (codesInBatch.length > 0) {
        const existingCodes = await checkExistingCodes(
          supabase, tenantId, table, uniqueKey, codesInBatch,
        )
        for (const vr of validatedRows) {
          if (!vr.isValid) continue
          const val = (vr.normalizedData[uniqueKey] as string | undefined)
          if (val && existingCodes.has(val.toUpperCase())) {
            vr.isDuplicate = true
          }
        }
      }
    }

    // Designations: resolve department_code → department_id
    if (masterType === 'designations') {
      const deptCodes = [
        ...new Set(
          validatedRows
            .filter((r) => r.isValid && r.normalizedData.department_code)
            .map((r) => (r.normalizedData.department_code as string).toUpperCase()),
        ),
      ]
      if (deptCodes.length > 0) {
        const deptIdMap = await resolveCodeToId(
          supabase, tenantId, 'departments', 'code', deptCodes,
        )
        for (const vr of validatedRows) {
          if (!vr.isValid) continue
          const deptCode = vr.normalizedData.department_code as string | undefined
          if (deptCode) {
            const deptId = deptIdMap.get(deptCode.toUpperCase())
            if (deptId) {
              vr.normalizedData.department_id = deptId
            } else {
              vr.warnings.push({
                field: 'department_code',
                message: `Department "${deptCode}" not found — department will be ignored`,
                severity: 'warning',
              })
            }
          }
        }
      }
    }

    // Departments: resolve parent_code → parent_id (self-referential FK)
    if (masterType === 'departments') {
      const parentCodes = [
        ...new Set(
          validatedRows
            .filter((r) => r.isValid && r.normalizedData.parent_code)
            .map((r) => (r.normalizedData.parent_code as string).toUpperCase()),
        ),
      ]
      if (parentCodes.length > 0) {
        const parentIdMap = await resolveCodeToId(
          supabase, tenantId, 'departments', 'code', parentCodes,
        )
        for (const vr of validatedRows) {
          if (!vr.isValid) continue
          const parentCode = vr.normalizedData.parent_code as string | undefined
          if (parentCode) {
            const parentId = parentIdMap.get(parentCode.toUpperCase())
            if (parentId) {
              vr.normalizedData.parent_id = parentId
            } else {
              vr.warnings.push({
                field: 'parent_code',
                message: `Parent department "${parentCode}" not found — parent will be ignored`,
                severity: 'warning',
              })
            }
          }
        }
      }
    }

    // Sites: resolve state_code → state_id (states.code) and cluster_code → cluster_id
    if (masterType === 'sites') {
      const pick = (field: string) => [
        ...new Set(
          validatedRows
            .filter((r) => r.isValid && r.normalizedData[field])
            .map((r) => (r.normalizedData[field] as string).toUpperCase()),
        ),
      ]
      const [stateIdMap, clusterIdMap, costCenterIdMap, parentSiteIdMap] = await Promise.all([
        resolveCodeToId(supabase, tenantId, 'states',       'code', pick('state_code')),
        resolveCodeToId(supabase, tenantId, 'clusters',     'code', pick('cluster_code')),
        resolveCodeToId(supabase, tenantId, 'cost_centers', 'code', pick('cost_center_code')),
        resolveCodeToId(supabase, tenantId, 'sites',        'code', pick('parent_site_code')),
      ])
      for (const vr of validatedRows) {
        if (!vr.isValid) continue
        const stateCode = vr.normalizedData.state_code as string | undefined
        if (stateCode) {
          const stateId = stateIdMap.get(stateCode.toUpperCase())
          if (stateId) vr.normalizedData.state_id = stateId
          else vr.warnings.push({ field: 'state_code', message: `State "${stateCode}" not found — statutory state link will be left blank`, severity: 'warning' })
        }
        const clusterCode = vr.normalizedData.cluster_code as string | undefined
        if (clusterCode) {
          const clusterId = clusterIdMap.get(clusterCode.toUpperCase())
          if (clusterId) vr.normalizedData.cluster_id = clusterId
          else vr.warnings.push({ field: 'cluster_code', message: `Cluster "${clusterCode}" not found — cluster link will be left blank`, severity: 'warning' })
        }
        const costCenterCode = vr.normalizedData.cost_center_code as string | undefined
        if (costCenterCode) {
          const costCenterId = costCenterIdMap.get(costCenterCode.toUpperCase())
          if (costCenterId) vr.normalizedData.cost_center_id = costCenterId
          else vr.warnings.push({ field: 'cost_center_code', message: `Cost center "${costCenterCode}" not found — cost center link will be left blank`, severity: 'warning' })
        }
        const parentSiteCode = vr.normalizedData.parent_site_code as string | undefined
        if (parentSiteCode) {
          // Guard against a site pointing at itself as parent.
          const selfCode = (vr.normalizedData.code as string | undefined)?.toUpperCase()
          if (selfCode && parentSiteCode.toUpperCase() === selfCode) {
            vr.warnings.push({ field: 'parent_site_code', message: 'A site cannot be its own parent — parent will be left blank', severity: 'warning' })
          } else {
            const parentSiteId = parentSiteIdMap.get(parentSiteCode.toUpperCase())
            if (parentSiteId) vr.normalizedData.parent_site_id = parentSiteId
            else vr.warnings.push({ field: 'parent_site_code', message: `Parent site "${parentSiteCode}" not found — parent will be left blank`, severity: 'warning' })
          }
        }
      }
    }

    // Clusters: resolve parent_code → parent_cluster_id (self-ref) and manager_code → cluster_manager_id (employee)
    if (masterType === 'clusters') {
      const pick = (field: string) => [
        ...new Set(
          validatedRows
            .filter((r) => r.isValid && r.normalizedData[field])
            .map((r) => (r.normalizedData[field] as string).toUpperCase()),
        ),
      ]
      const [parentIdMap, managerIdMap] = await Promise.all([
        resolveCodeToId(supabase, tenantId, 'clusters', 'code', pick('parent_code')),
        resolveEmployeeCodes(supabase, tenantId, pick('manager_code')),
      ])
      for (const vr of validatedRows) {
        if (!vr.isValid) continue
        const parentCode = vr.normalizedData.parent_code as string | undefined
        if (parentCode) {
          const parentId = parentIdMap.get(parentCode.toUpperCase())
          if (parentId) vr.normalizedData.parent_cluster_id = parentId
          else vr.warnings.push({ field: 'parent_code', message: `Parent cluster "${parentCode}" not found — parent will be ignored`, severity: 'warning' })
        }
        const managerCode = vr.normalizedData.manager_code as string | undefined
        if (managerCode) {
          const managerId = managerIdMap.get(managerCode.toUpperCase())
          if (managerId) vr.normalizedData.cluster_manager_id = managerId
          else vr.warnings.push({ field: 'manager_code', message: `Manager "${managerCode}" not found — cluster manager will be left blank`, severity: 'warning' })
        }
      }
    }

    // Positions: resolve org-taxonomy codes → ids (all optional links).
    if (masterType === 'positions') {
      const pick = (field: string) => [
        ...new Set(
          validatedRows
            .filter((r) => r.isValid && r.normalizedData[field])
            .map((r) => (r.normalizedData[field] as string).toUpperCase()),
        ),
      ]
      const [deptMap, desigMap, gradeMap, siteMap, locMap, ccMap] = await Promise.all([
        resolveCodeToId(supabase, tenantId, 'departments',    'code', pick('department_code')),
        resolveCodeToId(supabase, tenantId, 'designations',   'code', pick('designation_code')),
        resolveCodeToId(supabase, tenantId, 'grades',         'code', pick('grade_code')),
        resolveCodeToId(supabase, tenantId, 'sites',          'code', pick('site_code')),
        resolveCodeToId(supabase, tenantId, 'work_locations', 'code', pick('work_location_code')),
        resolveCodeToId(supabase, tenantId, 'cost_centers',   'code', pick('cost_center_code')),
      ])
      const linkCode = (
        vr: ValidatedRow,
        codeField: string,
        idField: string,
        map: Map<string, string>,
        label: string,
      ) => {
        const code = vr.normalizedData[codeField] as string | undefined
        if (!code) return
        const id = map.get(code.toUpperCase())
        if (id) vr.normalizedData[idField] = id
        else vr.warnings.push({ field: codeField, message: `${label} "${code}" not found — link will be left blank`, severity: 'warning' })
      }
      for (const vr of validatedRows) {
        if (!vr.isValid) continue
        linkCode(vr, 'department_code',    'department_id',    deptMap,  'Department')
        linkCode(vr, 'designation_code',   'designation_id',   desigMap, 'Designation')
        linkCode(vr, 'grade_code',         'grade_id',         gradeMap, 'Grade')
        linkCode(vr, 'site_code',          'site_id',          siteMap,  'Site')
        linkCode(vr, 'work_location_code', 'work_location_id', locMap,   'Work location')
        linkCode(vr, 'cost_center_code',   'cost_center_id',   ccMap,    'Cost center')
      }
    }
  }

  // ── Aggregate summary ─────────────────────────────────────────────────────

  const totalRows     = validatedRows.length
  const invalidRows   = validatedRows.filter((r) => !r.isValid).length
  const duplicateRows = validatedRows.filter((r) => r.isDuplicate).length
  const validRows     = totalRows - invalidRows

  const errorCategories: Record<string, number> = {}
  const missingRequiredSet  = new Set<string>()
  const invalidEnumSet      = new Set<string>()
  const duplicateFieldSet   = new Set<string>()

  for (const vr of validatedRows) {
    for (const err of vr.errors) {
      errorCategories[err.field] = (errorCategories[err.field] ?? 0) + 1
      if (err.message.toLowerCase().includes('required')) {
        missingRequiredSet.add(err.field)
      }
      if (err.message.toLowerCase().includes('invalid') && err.message.toLowerCase().includes('allowed')) {
        invalidEnumSet.add(err.field)
      }
      if (err.message.toLowerCase().includes('duplicate')) {
        duplicateFieldSet.add(err.field)
      }
    }
  }

  return {
    totalRows,
    validRows,
    invalidRows,
    duplicateRows,
    rows: validatedRows,
    summary: {
      errorCategories,
      missingRequired:  Array.from(missingRequiredSet),
      invalidEnums:     Array.from(invalidEnumSet),
      duplicateFields:  Array.from(duplicateFieldSet),
    },
  }
}
