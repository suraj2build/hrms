/**
 * salary-upload.ts
 *
 * Dynamic employee salary upload — template, validator, and importer.
 *
 * Unlike static master imports, this import type generates its template columns
 * at request time from the tenant's active salary_components.  HR fills in
 * monthly amounts only; component names, codes, and IDs are never exposed.
 *
 * Flow:
 *   GET  /import/templates/employee_salary_upload   → CSV with dynamic headers
 *   POST /import/validate  { masterType: 'employee_salary_upload', rows }
 *   POST /import/run       { masterType: 'employee_salary_upload', rows, ... }
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ValidationResult, ValidatedRow, RowError } from './validator.js'
import type { ImportMode } from './importer.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentMeta {
  id:             string
  name:           string
  code:           string
  component_type: string
}

// component_type ordering: earnings first, deductions second, employer last
const TYPE_ORDER: Record<string, number> = {
  earning:               0,
  deduction:             1,
  employer_contribution: 2,
}

const TYPE_LABELS: Record<string, string> = {
  earning:               'EARNINGS',
  deduction:             'DEDUCTIONS',
  employer_contribution: 'EMPLOYER CONTRIBUTIONS',
}

// Fixed columns — always present regardless of component master
const FIXED_KEYS = new Set([
  'employee_code', 'employee_name', 'effective_from', 'notes',
])

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// ── Active component loader ────────────────────────────────────────────────────

/**
 * Fetch all salary components for the tenant, ordered by type then name.
 * No is_active filter — all tenant components are included.
 */
export async function fetchActiveComponents(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ComponentMeta[]> {
  const { data, error } = await supabase
    .from('salary_components')
    .select('id, name, code, component_type')
    .eq('tenant_id', tenantId)
    .order('name')

  if (error) throw new Error(error.message)

  return ((data ?? []) as ComponentMeta[]).sort((a, b) => {
    const ao = TYPE_ORDER[a.component_type] ?? 99
    const bo = TYPE_ORDER[b.component_type] ?? 99
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  })
}

// ── Template generator ─────────────────────────────────────────────────────────

/**
 * Generate a CSV template from the tenant's active salary components.
 *
 * Comment rows (lines starting with #) are stripped by the frontend parser
 * for both CSV and XLSX uploads, so they serve as human guidance only.
 */
export function generateSalaryUploadCsv(
  components: ComponentMeta[],
  generatedOn: string,
): string {
  // Group by type for the section summary comment
  const byType: Record<string, ComponentMeta[]> = {}
  for (const c of components) {
    if (!byType[c.component_type]) byType[c.component_type] = []
    byType[c.component_type].push(c)
  }

  const sectionLines = Object.entries(TYPE_LABELS)
    .filter(([type]) => byType[type]?.length)
    .map(([type, label]) => `# ${label}: ${byType[type].map(c => c.name).join(' | ')}`)
    .join('\n')

  const fixedHeaders   = ['employee_code', 'employee_name', 'effective_from']
  const compHeaders    = components.map(c => c.name)
  const allHeaders     = [...fixedHeaders, ...compHeaders, 'notes']

  // Sample row — 10 000 for earnings, 0 for deductions (only representative)
  const sampleRow = [
    'EMP001',
    'Sample Employee',
    generatedOn,
    ...components.map(c =>
      c.component_type === 'deduction' ? '0' : '10000'
    ),
    '',
  ]

  const lines = [
    '# CognixHR — Employee Salary Upload Template',
    `# Generated from Salary Component Master on ${generatedOn}`,
    '# Do not rename, add, or remove columns.',
    '# Download a fresh template whenever you add components to the master.',
    '# Required: employee_code, effective_from   Optional: employee_name, notes',
    '#',
    sectionLines,
    '#',
    allHeaders.join(','),
    sampleRow.join(','),
  ]

  return lines.join('\n') + '\n'
}

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Validate rows from an employee salary upload file.
 *
 * Dynamic column matching:
 *   - Header keys arrive lowercase (frontend normaliseKey strips * and lowercases).
 *   - We build a lowercase lookup map from the tenant's salary_components names.
 *   - Unknown headers (not in the master) are rejected.
 *
 * For each row:
 *   - employee_code — required
 *   - effective_from — required, YYYY-MM-DD
 *   - Each component column — optional, non-negative number (empty = skip)
 *   - Unknown columns — error on every row where they appear
 *
 * DB checks (after row-level pass):
 *   - Resolves employee_code → employee_id
 *   - Marks isDuplicate = true when a row for the same employee + effective_from
 *     already exists in employee_compensations
 */
export async function validateSalaryUploadRows(
  supabase: SupabaseClient,
  tenantId: string,
  rows: Record<string, string>[],
): Promise<ValidationResult> {
  // Fetch active components once
  const components = await fetchActiveComponents(supabase, tenantId)

  // Build lowercase name → ComponentMeta lookup
  const compByLowercaseName = new Map<string, ComponentMeta>()
  for (const c of components) {
    compByLowercaseName.set(c.name.trim().toLowerCase(), c)
  }

  // Classify headers from the first row
  const firstRowKeys = rows.length > 0 ? Object.keys(rows[0]) : []
  const componentCols: Array<{ key: string; meta: ComponentMeta }> = []
  const unknownCols: string[] = []

  for (const key of firstRowKeys) {
    const lk = key.trim().toLowerCase()
    if (FIXED_KEYS.has(lk)) continue
    const meta = compByLowercaseName.get(lk)
    if (meta) {
      componentCols.push({ key, meta })
    } else {
      unknownCols.push(key)
    }
  }

  const validatedRows: ValidatedRow[] = []
  const batchKeys = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2  // row 1 = header
    const raw  = rows[i]
    const errors:   RowError[] = []
    const warnings: RowError[] = []
    const norm: Record<string, unknown> = {}

    // Unknown columns — report on every row so the per-row error table is useful
    for (const col of unknownCols) {
      errors.push({
        field:    col,
        message:  `Unknown component "${col}". Download the latest template — it is generated from your Salary Component Master.`,
        severity: 'error',
      })
    }

    const d: Record<string, string> = {}
    for (const k of Object.keys(raw)) d[k] = (raw[k] ?? '').trim()

    // employee_code — required
    if (!d.employee_code) {
      errors.push({ field: 'employee_code', message: 'Employee code is required', severity: 'error' })
    } else {
      norm.employee_code = d.employee_code.toUpperCase()
    }

    // effective_from — required, YYYY-MM-DD
    if (!d.effective_from) {
      errors.push({ field: 'effective_from', message: 'Effective from date is required (YYYY-MM-DD)', severity: 'error' })
    } else if (!DATE_REGEX.test(d.effective_from) || isNaN(Date.parse(d.effective_from))) {
      errors.push({
        field:    'effective_from',
        message:  `Invalid date "${d.effective_from}" — expected YYYY-MM-DD`,
        severity: 'error',
      })
    } else {
      norm.effective_from = d.effective_from
    }

    // Component columns — numeric, non-negative, empty = skip (0)
    const compAmounts: Record<string, number> = {}  // component_id → monthly amount
    for (const { key, meta } of componentCols) {
      const val = (d[key] ?? '').trim()
      if (!val || val === '') continue  // blank = skip (treat as 0 / not set)
      const n = parseFloat(val)
      if (isNaN(n) || n < 0) {
        errors.push({
          field:    key,
          message:  `Invalid amount "${val}" for "${meta.name}" — must be a non-negative number`,
          severity: 'error',
        })
      } else {
        compAmounts[meta.id] = n
      }
    }
    norm.components = compAmounts

    // notes — optional
    if (d.notes) norm.notes = d.notes

    // Batch dedup: one compensation per employee + effective_from pair
    let isDuplicate = false
    if (norm.employee_code && norm.effective_from) {
      const bk = `${norm.employee_code}|${norm.effective_from}`
      if (batchKeys.has(bk)) {
        errors.push({
          field:    'employee_code',
          message:  `Duplicate employee + effective_from "${d.employee_code} / ${d.effective_from}" in this batch`,
          severity: 'error',
        })
        isDuplicate = true
      } else {
        batchKeys.add(bk)
      }
    }

    validatedRows.push({
      rowNumber,
      originalData:   raw,
      normalizedData: norm,
      errors,
      warnings,
      isValid:     errors.length === 0,
      isDuplicate,
    })
  }

  // ── DB Checks ────────────────────────────────────────────────────────────────

  // 1. Resolve employee codes → UUIDs
  const empCodes = [
    ...new Set(
      validatedRows
        .filter(r => r.isValid && r.normalizedData.employee_code)
        .map(r => r.normalizedData.employee_code as string),
    ),
  ]

  const empCodeMap = new Map<string, string>()  // UPPER_CODE → employee_id
  for (let i = 0; i < empCodes.length; i += 500) {
    const chunk = empCodes.slice(i, i + 500)
    const { data } = await supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', tenantId)
      .in('employee_code', chunk)
    if (data) {
      for (const r of data as any[]) {
        empCodeMap.set(String(r.employee_code).toUpperCase(), r.id as string)
      }
    }
  }

  // 2. Check which employees already have an active compensation
  const resolvedIds = [...empCodeMap.values()]
  const existingCompSet = new Set<string>()  // employee_id
  if (resolvedIds.length > 0) {
    for (let i = 0; i < resolvedIds.length; i += 500) {
      const chunk = resolvedIds.slice(i, i + 500)
      const { data } = await supabase
        .from('employee_compensations')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('employee_id', chunk)
      if (data) {
        for (const r of data as any[]) existingCompSet.add(r.employee_id as string)
      }
    }
  }

  // 3. Apply DB check results to validated rows
  for (const vr of validatedRows) {
    if (!vr.isValid) continue
    const code  = vr.normalizedData.employee_code as string
    const empId = empCodeMap.get(code)
    if (!empId) {
      vr.errors.push({
        field:    'employee_code',
        message:  `Employee "${code}" not found in this tenant`,
        severity: 'error',
      })
      vr.isValid = false
    } else {
      vr.normalizedData.employee_id = empId
      // isDuplicate = already has active compensation → update path
      if (existingCompSet.has(empId)) {
        vr.isDuplicate = true
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  const validRows     = validatedRows.filter(r => r.isValid).length
  const invalidRows   = validatedRows.filter(r => !r.isValid).length
  const duplicateRows = validatedRows.filter(r => r.isDuplicate).length

  const errorCategories: Record<string, number> = {}
  const missingRequired: string[] = []
  for (const vr of validatedRows) {
    for (const e of vr.errors) {
      errorCategories[e.field] = (errorCategories[e.field] ?? 0) + 1
      if (e.message.includes('required') && !missingRequired.includes(e.field)) {
        missingRequired.push(e.field)
      }
    }
  }

  return {
    totalRows: validatedRows.length,
    validRows,
    invalidRows,
    duplicateRows,
    rows: validatedRows,
    summary: { errorCategories, missingRequired, invalidEnums: [], duplicateFields: [] },
  }
}

// ── Importer ──────────────────────────────────────────────────────────────────

/**
 * Import employee salary upload rows.
 *
 * For each valid row:
 *   1. Compute CTC annual = (earnings + employer_contributions) × 12.
 *   2. Insert employee_compensations with is_active=true.
 *      The DB trigger fn_close_prev_compensation auto-closes the old active row.
 *   3. Insert employee_compensation_components (one row per component with a value > 0).
 *
 * Requires a default salary structure (is_default=true) to exist in the tenant.
 * Returns early with a per-row error if none is found.
 */
export async function importSalaryUpload(
  supabase:  SupabaseClient,
  tenantId:  string,
  createdBy: string,
  validRows: ValidatedRow[],
  mode:      ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  let created = 0, updated = 0, failed = 0, skipped = 0

  if (validRows.length === 0) return { created, updated, failed, skipped }

  // Resolve default salary structure once
  const { data: defaultSS } = await supabase
    .from('salary_structures')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .maybeSingle()

  if (!defaultSS?.id) {
    const msg = 'No default salary structure found. Go to Payroll → Compensation Setup and mark one structure as default before uploading.'
    for (const vr of validRows) {
      vr.errors.push({ field: '_db', message: msg, severity: 'error' })
      vr.isValid = false
      failed++
    }
    return { created, updated, failed, skipped }
  }
  const structureId = defaultSS.id as string

  // Fetch component types for all components referenced by valid rows
  const allCompIds = [
    ...new Set(
      validRows.flatMap(vr => Object.keys((vr.normalizedData.components as Record<string, number>) ?? {}))
    ),
  ]
  const compTypeMap = new Map<string, string>()  // component_id → component_type
  if (allCompIds.length > 0) {
    for (let i = 0; i < allCompIds.length; i += 500) {
      const chunk = allCompIds.slice(i, i + 500)
      const { data } = await supabase
        .from('salary_components')
        .select('id, component_type')
        .eq('tenant_id', tenantId)
        .in('id', chunk)
      if (data) {
        for (const r of data as any[]) compTypeMap.set(r.id as string, r.component_type as string)
      }
    }
  }

  for (const vr of validRows) {
    const norm = vr.normalizedData
    try {
      if (mode === 'create_only' && vr.isDuplicate) { skipped++; continue }
      if (mode === 'update_only' && !vr.isDuplicate) { skipped++; continue }

      const employeeId    = norm.employee_id   as string
      const effectiveFrom = norm.effective_from as string
      const notes         = (norm.notes as string | undefined) ?? null
      const components    = (norm.components   as Record<string, number>) ?? {}

      // CTC = (earnings + employer_contributions) × 12
      // Deductions reduce take-home but are not added to CTC
      let ctcMonthly = 0
      for (const [compId, amount] of Object.entries(components)) {
        const compType = compTypeMap.get(compId)
        if (compType === 'earning' || compType === 'employer_contribution') {
          ctcMonthly += amount
        }
      }
      const ctcAnnual = Math.round(ctcMonthly * 12 * 100) / 100

      // Insert new compensation row (DB trigger closes the old active one)
      const { data: newComp, error: compErr } = await supabase
        .from('employee_compensations')
        .insert({
          tenant_id:           tenantId,
          employee_id:         employeeId,
          salary_structure_id: structureId,
          effective_from:      effectiveFrom,
          ctc_annual:          ctcAnnual,
          is_active:           true,
          notes,
          created_by:          createdBy,
        })
        .select('id')
        .single()

      if (compErr || !newComp) {
        throw new Error(compErr?.message ?? 'Failed to create compensation record')
      }
      const compId = newComp.id as string

      // Insert component rows for each non-zero amount
      const compRows = Object.entries(components)
        .filter(([, amount]) => amount > 0)
        .map(([salaryComponentId, amount], seq) => ({
          tenant_id:            tenantId,
          compensation_id:      compId,
          salary_component_id:  salaryComponentId,
          calculation_type:     'fixed',
          value:                amount,
          computed_monthly:     Math.round(amount * 100) / 100,
          computed_annual:      Math.round(amount * 12 * 100) / 100,
          sequence:             seq,
        }))

      if (compRows.length > 0) {
        const { error: ccErr } = await supabase
          .from('employee_compensation_components')
          .insert(compRows)
        if (ccErr) throw new Error(ccErr.message)
      }

      if (vr.isDuplicate) updated++
      else                created++
    } catch (err) {
      vr.errors.push({
        field:    '_db',
        message:  err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated, failed, skipped }
}

// ── Full job runner ────────────────────────────────────────────────────────────

export interface SalaryUploadResult {
  importJobId: string
  created:     number
  updated:     number
  failed:      number
  skipped:     number
  duration_ms: number
}

const BATCH_SIZE = 100

async function writeJobRows(
  supabase:    SupabaseClient,
  jobId:       string,
  tenantId:    string,
  rows:        ValidatedRow[],
  rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'>,
): Promise<void> {
  const payload = rows.map(vr => ({
    import_job_id: jobId,
    tenant_id:     tenantId,
    row_number:    vr.rowNumber,
    status:        rowStatuses[vr.rowNumber] ?? (vr.isValid ? 'skipped' : 'failed'),
    errors:        vr.errors.length   > 0 ? vr.errors   : null,
    warnings:      vr.warnings.length > 0 ? vr.warnings : null,
    row_data:      vr.originalData,
  }))

  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    const batch = payload.slice(i, i + BATCH_SIZE)
    await supabase.from('import_job_rows').insert(batch)
  }
}

/**
 * Run the full salary upload pipeline: create job record, validate, import,
 * update job counts, write row results.
 *
 * Mirrors the structure of runImport() in importer.ts so callers can use the
 * same job-tracking and progress-polling flow.
 */
export async function runSalaryUploadJob(
  supabase:      SupabaseClient,
  tenantId:      string,
  createdBy:     string,
  mode:          ImportMode,
  rows:          Record<string, string>[],
  fileName:      string,
  existingJobId: string,
): Promise<SalaryUploadResult> {
  const startedAt = Date.now()
  const jobId     = existingJobId

  try {
    // Validate
    const validation = await validateSalaryUploadRows(supabase, tenantId, rows)

    await supabase
      .from('import_jobs')
      .update({ valid_rows: validation.validRows, invalid_rows: validation.invalidRows })
      .eq('id', jobId)

    // validate_only — stop here
    if (mode === 'validate_only') {
      const rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'> = {}
      for (const vr of validation.rows) {
        rowStatuses[vr.rowNumber] = vr.isValid ? 'skipped' : 'failed'
      }
      await supabase
        .from('import_jobs')
        .update({ status: 'validated', duration_ms: Date.now() - startedAt })
        .eq('id', jobId)
      await writeJobRows(supabase, jobId, tenantId, validation.rows, rowStatuses)
      return {
        importJobId: jobId,
        created:     0,
        updated:     0,
        failed:      validation.invalidRows,
        skipped:     validation.validRows,
        duration_ms: Date.now() - startedAt,
      }
    }

    await supabase.from('import_jobs').update({ status: 'importing' }).eq('id', jobId)

    const rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'> = {}
    let totalFailed = validation.invalidRows
    let totalSkipped = 0

    for (const vr of validation.rows) {
      if (!vr.isValid) { rowStatuses[vr.rowNumber] = 'failed'; continue }
      if (mode === 'create_only' && vr.isDuplicate) { rowStatuses[vr.rowNumber] = 'skipped'; totalSkipped++; continue }
      if (mode === 'update_only' && !vr.isDuplicate) { rowStatuses[vr.rowNumber] = 'skipped'; totalSkipped++; continue }
    }

    const eligibleRows = validation.rows.filter(vr => {
      if (!vr.isValid) return false
      if (mode === 'create_only' && vr.isDuplicate) return false
      if (mode === 'update_only' && !vr.isDuplicate) return false
      return true
    })

    const result = await importSalaryUpload(supabase, tenantId, createdBy, eligibleRows, mode)

    // Populate row statuses from import results
    for (const vr of eligibleRows) {
      if (!vr.isValid) { rowStatuses[vr.rowNumber] = 'failed'; continue }
      if (vr.isDuplicate) rowStatuses[vr.rowNumber] = 'updated'
      else                rowStatuses[vr.rowNumber] = 'created'
    }

    totalFailed += result.failed
    totalSkipped += result.skipped
    const duration = Date.now() - startedAt

    await supabase
      .from('import_jobs')
      .update({
        status:       'completed',
        created_rows:  result.created,
        updated_rows:  result.updated,
        failed_rows:   totalFailed,
        skipped_rows:  totalSkipped,
        duration_ms:   duration,
        completed_at:  new Date().toISOString(),
      })
      .eq('id', jobId)

    await writeJobRows(supabase, jobId, tenantId, validation.rows, rowStatuses)

    return {
      importJobId: jobId,
      created:     result.created,
      updated:     result.updated,
      failed:      totalFailed,
      skipped:     totalSkipped,
      duration_ms: duration,
    }
  } catch (err) {
    await supabase
      .from('import_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', jobId)
    throw err
  }
}
