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

  // Batch duplicate check on 'code' or 'name' (leave_types uses name)
  const uniqueKey = masterType === 'leave_types' ? 'name' : 'code'
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

// ── DB existence checks ───────────────────────────────────────────────────────

async function checkExistingCodes(
  supabase: SupabaseClient,
  tenantId: string,
  table: string,
  codeColumn: string,
  codes: string[],
): Promise<Set<string>> {
  if (codes.length === 0) return new Set()
  const { data } = await supabase
    .from(table)
    .select(codeColumn)
    .eq('tenant_id', tenantId)
    .in(codeColumn, codes)
  if (!data) return new Set()
  return new Set((data as any[]).map((r) => String(r[codeColumn] ?? '').toUpperCase()))
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
    // Get all employee_codes that passed basic validation
    const codesInBatch = validatedRows
      .filter((r) => r.normalizedData.employee_code)
      .map((r) => (r.normalizedData.employee_code as string).toUpperCase())

    const existingEmployeeCodes = await checkExistingCodes(
      supabase, tenantId, 'employees', 'employee_code', codesInBatch,
    )

    // Collect ref codes for batch lookup
    const deptCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.normalizedData.department_code)
          .map((r) => r.normalizedData.department_code as string),
      ),
    ]
    const desgCodes = [
      ...new Set(
        validatedRows
          .filter((r) => r.normalizedData.designation_code)
          .map((r) => r.normalizedData.designation_code as string),
      ),
    ]

    const existingDeptCodes  = await checkExistingCodes(supabase, tenantId, 'departments',  'code', deptCodes)
    const existingDesgCodes  = await checkExistingCodes(supabase, tenantId, 'designations', 'code', desgCodes)

    for (const vr of validatedRows) {
      if (!vr.isValid) continue

      const code = (vr.normalizedData.employee_code as string | undefined)?.toUpperCase()
      if (code && existingEmployeeCodes.has(code)) {
        vr.isDuplicate = true
        // Not an error — caller uses mode to decide upsert vs skip
      }

      const deptCode = vr.normalizedData.department_code as string | undefined
      if (deptCode && !existingDeptCodes.has(deptCode.toUpperCase())) {
        vr.warnings.push({
          field: 'department_code',
          message: `Department "${deptCode}" not found — will be ignored`,
          severity: 'warning',
        })
      }

      const desgCode = vr.normalizedData.designation_code as string | undefined
      if (desgCode && !existingDesgCodes.has(desgCode.toUpperCase())) {
        vr.warnings.push({
          field: 'designation_code',
          message: `Designation "${desgCode}" not found — will be ignored`,
          severity: 'warning',
        })
      }
    }
  } else {
    // Generic code-level DB check
    const uniqueKey = masterType === 'leave_types' ? 'name' : 'code'
    const tableMap: Record<string, string> = {
      shifts:            'shifts',
      departments:       'departments',
      designations:      'designations',
      work_locations:    'work_locations',
      cost_centers:      'cost_centers',
      salary_components: 'salary_components',
      leave_types:       'leave_types',
      holiday_calendar:  'holiday_calendar',
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
