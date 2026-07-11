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
 *   GET  /import/templates/employee_salary_upload   → XLSX with dynamic headers
 *   POST /import/validate  { masterType: 'employee_salary_upload', rows }
 *   POST /import/run       { masterType: 'employee_salary_upload', rows, ... }
 */

import { randomUUID }                          from 'crypto'
import type { SupabaseClient }                 from '@supabase/supabase-js'
import type { ValidationResult, ValidatedRow, RowError } from './validator.js'
import type { ImportMode }                     from './importer.js'
import { executeInChunks, writeImportErrors } from './chunk-executor.js'
import ExcelJS                                from 'exceljs'
import {
  resolveMetadata,
  validateReferenceIntegrity,
  MetadataValidationError,
  ReferenceIntegrityError,
  WORKBOOK_ERROR_CODES,
  type WorkbookManifest,
  type MasterMapping,
  type ImportContext,
} from '../enterprise-import/index.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentMeta {
  id:                  string
  name:                string
  code:                string
  component_type:      string
  display_order:       number | null
  is_active:           boolean
  is_variable?:        boolean | null
  is_basic?:           boolean | null
  affects_pf?:         boolean | null
  is_pt_applicable?:   boolean | null
  is_esi_applicable?:  boolean | null
  is_lwf_applicable?:  boolean | null
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

// Increment whenever the CSV/XLSX manifest format changes in a breaking way.
// v2: structured JSON component manifest, display_order-based column positions, strengthened hash.
const SCHEMA_VERSION = 2

// Fixed columns — always present regardless of component master
const FIXED_KEYS = new Set([
  'employee_code', 'employee_name', 'effective_from', 'notes',
])

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// ── Template version fingerprint ──────────────────────────────────────────────

/**
 * Compute a stable fingerprint of the active component set.
 * Used to detect stale templates (downloaded before a component was added/removed,
 * renamed, reordered, or had its type/active status changed).
 *
 * Algorithm: djb2 hash of sorted component IDs, each entry includes
 * display_order, component_type, and is_active so any structural change
 * to the master invalidates in-flight workbooks.
 */
export function computeTemplateVersion(components: ComponentMeta[]): string {
  const payload = [...components]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(c => `${c.id}|${c.display_order ?? ''}|${c.component_type}|${c.is_active}`)
    .join(',')
  let h = 5381
  for (let i = 0; i < payload.length; i++) {
    h = (((h << 5) + h) ^ payload.charCodeAt(i)) >>> 0
  }
  return `v${components.length}_${h.toString(16).padStart(8, '0')}`
}

// ── Component loaders ─────────────────────────────────────────────────────────

/**
 * Fetch active salary components for the tenant, ordered by type then name.
 * Only is_active = true components are included — used for template generation.
 */
export async function fetchActiveComponents(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ComponentMeta[]> {
  const { data, error } = await supabase
    .from('salary_components')
    .select('id, name, code, component_type, display_order, is_active, is_variable, is_basic, affects_pf, is_pt_applicable, is_esi_applicable, is_lwf_applicable')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('display_order', { ascending: true, nullsFirst: false })

  if (error) throw new Error(error.message)

  // In-memory stable sort: display_order → component_type → name
  // Preserves intended column order for tenants that have set display_order;
  // falls back to type-then-name for components without one.
  return ((data ?? []) as ComponentMeta[]).sort((a, b) => {
    const ado = a.display_order ?? 9999
    const bdo = b.display_order ?? 9999
    if (ado !== bdo) return ado - bdo
    const ao = TYPE_ORDER[a.component_type] ?? 99
    const bo = TYPE_ORDER[b.component_type] ?? 99
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  })
}


// ── Import Manifest ───────────────────────────────────────────────────────────

/**
 * Manifest embedded in the XLSX CognixHR_Metadata sheet at generation time.
 * The frontend sends it back on validate/run; the backend validates it to
 * prevent cross-tenant reuse, wrong file type, or broken schema versions.
 *
 * v1 fields are kept for backward compat with workbooks generated before v2.
 * v2 fields are added in schema version 2; the backend uses them in Phase 2+.
 * All values are strings on the wire (XLSX cell values).
 */
export interface SalaryManifest {
  // v1 — read by frontend parser and sent back on validate/run
  tenantId?:            string
  generatedBy?:         string
  importType?:          string
  schemaVersion?:       string
  expectedColumnCount?: string
  // v2 — additional fields present in workbooks generated by schema v2+
  workbookId?:          string
  componentHash?:       string
  componentCount?:      string
  manifestVersion?:     string
  workbookType?:        string
  generatorVersion?:    string
  generatedAt?:         string
  signature?:           string
  components?:          string  // JSON array: [{position, id, code, name}]
}

// ── Extended validation result ────────────────────────────────────────────────

export interface SalaryValidationResult extends ValidationResult {
  payrollEstimate: {
    monthly:  number
    annual:   number
    currency: 'INR'
  }
  templateOutdated:        boolean
  currentTemplateVersion:  string
}

// ── Template generator ─────────────────────────────────────────────────────────

/**
 * Generate a CSV template from the tenant's active salary components.
 *
 * Embeds the template version, ordered component IDs, and an import manifest
 * in comment rows so the frontend can:
 *   1. Detect a stale template on re-upload.
 *   2. Build a proper XLSX with a stable component-ID metadata sheet.
 *   3. Send the manifest back on validate/run so the backend can reject
 *      cross-tenant reuse and wrong-file-type uploads.
 *
 * Comment rows (lines starting with #) are stripped by the frontend parser.
 */
export function generateSalaryUploadCsv(
  components:  ComponentMeta[],
  generatedOn: string,
  tenantId?:   string,
  generatedBy?: string,
): string {
  const version = computeTemplateVersion(components)

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

  // Ordered component IDs — matches column order after the 3 fixed columns
  const compIds = components.map(c => c.id).join(',')

  // Sample row — 10 000 for earnings, 0 for deductions (representative only)
  const sampleRow = [
    'EMP001',
    'Sample Employee',
    generatedOn,
    ...components.map(c =>
      c.component_type === 'deduction' ? '0' : '10000'
    ),
    '',
  ]

  const manifestLines: string[] = [
    `# manifest_import_type: employee_salary_upload`,
    `# manifest_schema_version: ${SCHEMA_VERSION}`,
    `# manifest_expected_columns: ${components.length}`,
  ]
  if (tenantId)    manifestLines.push(`# manifest_tenant_id: ${tenantId}`)
  if (generatedBy) manifestLines.push(`# manifest_generated_by: ${generatedBy}`)

  const lines = [
    '# CognixHR — Employee Salary Upload Template',
    `# Generated from Salary Component Master on ${generatedOn}`,
    `# template_version: ${version}`,
    `# component_ids: ${compIds}`,
    ...manifestLines,
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

// ── Enterprise XLSX Template Generator ───────────────────────────────────────

const XL_NAVY  = 'FF1B3D6B'
const XL_BLUE  = 'FF2E6FE6'
const XL_RED   = 'FFDC2626'
const XL_TEAL  = 'FF15B8A6'
const XL_WHITE = 'FFFFFFFF'
const XL_LGREY = 'FFF1F5F9'

const COMP_TYPE_COLOR: Record<string, string> = {
  earning:               XL_BLUE,
  deduction:             XL_RED,
  employer_contribution: XL_TEAL,
}

function xlFill(argb: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function xlFont(overrides: Partial<ExcelJS.Font>): Partial<ExcelJS.Font> {
  return { name: 'Calibri', size: 10, ...overrides }
}

function titleRow(ws: ExcelJS.Worksheet, text: string, bg: string, fontSize = 16) {
  const r = ws.addRow([text])
  r.height = fontSize === 16 ? 40 : 24
  const c = r.getCell(1)
  c.value     = text
  c.font      = xlFont({ bold: true, color: { argb: XL_WHITE }, size: fontSize })
  c.fill      = xlFill(bg)
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }
  return r
}

function sectionHead(ws: ExcelJS.Worksheet, text: string) {
  ws.addRow([])
  const r = ws.addRow([text])
  r.height = 22
  const c = r.getCell(1)
  c.font      = xlFont({ bold: true, color: { argb: XL_WHITE }, size: 11 })
  c.fill      = xlFill(XL_BLUE)
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
}

function bodyLine(ws: ExcelJS.Worksheet, text: string) {
  const r = ws.addRow([text])
  r.height = 17
  r.getCell(1).font = xlFont({ size: 10 })
}

/**
 * Generate a 4-sheet enterprise XLSX workbook for the employee salary upload.
 *
 * Sheet 1 — Employee Upload  : data entry (first sheet, matched by name in the parser)
 * Sheet 2 — Instructions     : step-by-step guide + component summary
 * Sheet 3 — Component Master : read-only reference grouped by type
 * Sheet 4 — CognixHR_Metadata: hidden; carries manifest + stable component-ID mappings
 */
export async function generateSalaryUploadXlsx(
  components:   ComponentMeta[],
  generatedOn:  string,
  tenantId?:    string,
  generatedBy?: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator  = 'CognixHR'
  wb.created  = new Date()
  wb.modified = new Date()

  const version  = computeTemplateVersion(components)
  const earnings = components.filter(c => c.component_type === 'earning')
  const deducts  = components.filter(c => c.component_type === 'deduction')
  const employer = components.filter(c => c.component_type === 'employer_contribution')

  // ── Sheet 1: Employee Upload ──────────────────────────────────────────────
  const wsData = wb.addWorksheet('Employee Upload')

  // Rows 1-4: comment metadata (prefixed with # so the upload parser skips them)
  const commentLines = [
    `# CognixHR — Employee Salary Upload`,
    `# Template Version: ${version}  ·  Generated: ${generatedOn}  ·  Components: ${components.length}`,
    `# Earnings: ${earnings.length}  ·  Deductions: ${deducts.length}  ·  Employer Contributions: ${employer.length}`,
    `# ── Do not edit rows 1-4 or rename any column ──────────────────────────`,
  ]
  for (const text of commentLines) {
    const r = wsData.addRow([text])
    r.height = 14
    const c  = r.getCell(1)
    c.font      = xlFont({ italic: true, color: { argb: 'FF9CA3AF' }, size: 9 })
    c.alignment = { horizontal: 'left' }
  }

  // Row 5: column headers — navy for identity cols, type color for component cols
  const headerVals = [
    'Employee Code *',
    'Employee Name',
    'Effective From *',
    ...components.map(c => c.name),
    'Notes',
  ]
  const hRow = wsData.addRow(headerVals)
  hRow.height = 26
  hRow.eachCell((cell, colNo) => {
    const bg = (colNo >= 4 && colNo <= 3 + components.length)
      ? (COMP_TYPE_COLOR[components[colNo - 4].component_type] ?? XL_NAVY)
      : XL_NAVY
    cell.fill      = xlFill(bg)
    cell.font      = xlFont({ bold: true, color: { argb: XL_WHITE }, size: 11 })
    cell.alignment = { vertical: 'middle', horizontal: colNo <= 3 ? 'left' : 'center' }
    cell.border    = { bottom: { style: 'medium', color: { argb: XL_TEAL } } }
  })

  // Row 6: sample row (light grey, italic, to make it visually distinct)
  const sampleVals = [
    'EMP001',
    'Sample Employee',
    generatedOn,
    ...components.map(c => c.component_type === 'deduction' ? 0 : 10000),
    '',
  ]
  const sRow = wsData.addRow(sampleVals)
  sRow.height = 18
  sRow.eachCell(cell => {
    cell.fill      = xlFill(XL_LGREY)
    cell.font      = xlFont({ italic: true, color: { argb: 'FF6B7280' } })
    cell.alignment = { horizontal: 'left' }
  })

  // Rows 7-206: 200 blank data entry rows
  for (let i = 0; i < 200; i++) wsData.addRow([])

  // Column widths
  wsData.getColumn(1).width = 20   // Employee Code
  wsData.getColumn(2).width = 30   // Employee Name
  wsData.getColumn(3).width = 20   // Effective From
  for (let i = 4; i <= 3 + components.length; i++) wsData.getColumn(i).width = 16
  wsData.getColumn(4 + components.length).width = 26  // Notes

  // Freeze: rows 1-5 (ySplit=5), columns A-C (xSplit=3)
  wsData.views = [{ state: 'frozen', ySplit: 5, xSplit: 3, topLeftCell: 'D6', activeCell: 'A7' }]

  // ── Sheet 2: Instructions ─────────────────────────────────────────────────
  const wsInstr = wb.addWorksheet('Instructions')
  wsInstr.getColumn(1).width = 96

  titleRow(wsInstr, 'CognixHR — Employee Salary Upload', XL_NAVY, 16)
  titleRow(wsInstr, `Generated: ${generatedOn}  ·  Template Version: ${version}  ·  Components: ${components.length}`, XL_BLUE, 11)

  sectionHead(wsInstr, 'HOW TO USE THIS TEMPLATE')
  bodyLine(wsInstr, '1.  Go to the "Employee Upload" sheet (first tab).')
  bodyLine(wsInstr, '2.  Rows 1–4 are template metadata (greyed out). Do not edit them.')
  bodyLine(wsInstr, '3.  Row 5 is the column header. Do not rename, add, or remove any column.')
  bodyLine(wsInstr, '4.  Row 6 is a sample row — delete it or leave it (it will be skipped if the employee code does not exist).')
  bodyLine(wsInstr, '5.  Enter one employee per row starting from row 7:')
  bodyLine(wsInstr, '       Column A — Employee Code   (required — must match your HR master exactly)')
  bodyLine(wsInstr, '       Column B — Employee Name   (optional — for reference, not imported)')
  bodyLine(wsInstr, '       Column C — Effective From  (required — YYYY-MM-DD format, e.g. 2026-04-01)')
  bodyLine(wsInstr, '       Column D+ — Monthly amount for each salary component')
  bodyLine(wsInstr, '                   Enter 0 for deductions not applicable to this employee')
  bodyLine(wsInstr, '                   Leave blank or 0 for unused earning components')
  bodyLine(wsInstr, '       Last col — Notes  (optional — HR annotation only, not imported)')
  bodyLine(wsInstr, '6.  Save as .xlsx and upload via CognixHR → Import → Employee Salary Upload.')

  sectionHead(wsInstr, 'IMPORTANT NOTES')
  bodyLine(wsInstr, '•  This template is generated directly from your active Salary Component Master.')
  bodyLine(wsInstr, '•  If you add or deactivate components, download a fresh template. Stale templates are rejected on upload.')
  bodyLine(wsInstr, '•  One row = one employee on one effective date. Do not split across rows.')
  bodyLine(wsInstr, '•  Amounts should be monthly figures in Indian Rupees — numbers only, no commas or currency symbols.')
  bodyLine(wsInstr, '•  The "Component Master" sheet is read-only reference. Do not modify it.')

  sectionHead(wsInstr, 'COLUMN COLOUR KEY')
  bodyLine(wsInstr, '  ■ Navy blue   (columns A, B, C)  — Employee identity and effective date')
  bodyLine(wsInstr, '  ■ Royal blue  (earning columns)  — Earnings paid to the employee')
  bodyLine(wsInstr, '  ■ Red         (deduction columns) — Amounts deducted from employee gross')
  bodyLine(wsInstr, '  ■ Teal        (employer columns) — Employer statutory contributions')

  sectionHead(wsInstr, `ACTIVE COMPONENT SUMMARY  (${components.length} components)`)
  const typeGroups: [string, ComponentMeta[]][] = [
    ['EARNINGS', earnings],
    ['DEDUCTIONS', deducts],
    ['EMPLOYER CONTRIBUTIONS', employer],
  ]
  for (const [label, comps] of typeGroups) {
    if (!comps.length) continue
    wsInstr.addRow([])
    const gr = wsInstr.addRow([`${label}  (${comps.length})`])
    gr.getCell(1).font = xlFont({ bold: true, size: 10 })
    for (const c of comps) {
      bodyLine(wsInstr, `    ${c.code.padEnd(24)}${c.name}`)
    }
  }

  // ── Sheet 3: Component Master ─────────────────────────────────────────────
  const wsMaster = wb.addWorksheet('Component Master')

  const masterCols = ['Code', 'Component Name', 'Type', 'Variable', 'Is Basic', 'PF', 'PT', 'ESI', 'LWF']
  const masterWidths = [18, 38, 24, 10, 10, 8, 8, 8, 8]
  masterCols.forEach((_, i) => { wsMaster.getColumn(i + 1).width = masterWidths[i] })

  const tm1 = titleRow(wsMaster, 'Salary Component Master — Reference', XL_NAVY, 16)
  wsMaster.mergeCells(`A${tm1.number}:I${tm1.number}`)

  const tm2 = titleRow(wsMaster, `Active components as of ${generatedOn}  ·  Read only`, XL_BLUE, 11)
  wsMaster.mergeCells(`A${tm2.number}:I${tm2.number}`)

  const masterTypeGroups: [string, ComponentMeta[], string][] = [
    ['EARNINGS', earnings, XL_BLUE],
    ['DEDUCTIONS', deducts, XL_RED],
    ['EMPLOYER CONTRIBUTIONS', employer, XL_TEAL],
  ]

  for (const [groupLabel, comps, groupColor] of masterTypeGroups) {
    if (!comps.length) continue

    wsMaster.addRow([])  // spacer

    const gh = wsMaster.addRow([`${groupLabel}  (${comps.length})`])
    gh.height = 22
    const ghc = gh.getCell(1)
    ghc.font      = xlFont({ bold: true, color: { argb: XL_WHITE }, size: 11 })
    ghc.fill      = xlFill(groupColor)
    ghc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    wsMaster.mergeCells(`A${gh.number}:I${gh.number}`)

    const ch = wsMaster.addRow(masterCols)
    ch.height = 18
    ch.eachCell(cell => {
      cell.font      = xlFont({ bold: true, size: 10 })
      cell.fill      = xlFill(XL_LGREY)
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    })
    ch.getCell(1).alignment = { horizontal: 'left' }
    ch.getCell(2).alignment = { horizontal: 'left' }
    ch.getCell(3).alignment = { horizontal: 'left' }

    for (let i = 0; i < comps.length; i++) {
      const c   = comps[i]
      const yes = (v: boolean | null | undefined) => v ? '✓' : ''
      const dr  = wsMaster.addRow([
        c.code,
        c.name,
        TYPE_LABELS[c.component_type] ?? c.component_type,
        yes(c.is_variable),
        yes(c.is_basic),
        yes(c.affects_pf),
        yes(c.is_pt_applicable),
        yes(c.is_esi_applicable),
        yes(c.is_lwf_applicable),
      ])
      dr.height = 18
      if (i % 2 === 0) {
        dr.eachCell({ includeEmpty: true }, cell => { cell.fill = xlFill('FFFAFBFF') })
      }
      dr.eachCell(cell => {
        cell.font      = xlFont({ size: 10 })
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      })
      dr.getCell(1).alignment = { horizontal: 'left' }
      dr.getCell(2).alignment = { horizontal: 'left' }
      dr.getCell(3).alignment = { horizontal: 'left' }
    }
  }

  wsMaster.views = [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3' }]

  // ── Sheet 4: CognixHR_Metadata (hidden) ──────────────────────────────────
  const wsMeta = wb.addWorksheet('CognixHR_Metadata')
  wsMeta.state = 'veryHidden'

  const workbookId = randomUUID()

  // Structured JSON component manifest — position is 1-based Excel column index.
  // Fixed columns: A=1 (employee_code), B=2 (employee_name), C=3 (effective_from).
  // Component columns start at D=4.
  const componentsManifest = components.map((c, i) => ({
    position: i + 4,
    id:       c.id,
    code:     c.code,
    name:     c.name,
  }))

  // Deterministic workbook signature: djb2 of canonical metadata fields.
  // Detects tampering with the metadata sheet outside normal generation.
  const sigPayload = [tenantId ?? '', workbookId, String(SCHEMA_VERSION), version, generatedOn].join('|')
  let sigH = 5381
  for (let i = 0; i < sigPayload.length; i++) {
    sigH = (((sigH << 5) + sigH) ^ sigPayload.charCodeAt(i)) >>> 0
  }
  const signature = sigH.toString(16).padStart(8, '0')

  const manifestRows: string[][] = [
    ['key',                       'value'],
    // ── v2 canonical fields ───────────────────────────────────────────────
    ['manifest_version',          '2'],
    ['workbook_type',             'employee_salary_upload'],
    ['schema_version',            String(SCHEMA_VERSION)],
    ['component_count',           String(components.length)],
    ['component_hash',            version],
    ['generator_version',         '1.0.0'],
    ['generated_at',              generatedOn],
    ['workbook_id',               workbookId],
    ['signature',                 signature],
    ['product',                   'CognixHR'],
    // ── v1 keys kept for backward compat with frontend manifest parser ────
    ['template_version',          version],
    ['manifest_import_type',      'employee_salary_upload'],
    ['manifest_schema_version',   String(SCHEMA_VERSION)],
    ['manifest_expected_columns', String(components.length)],
    // ── structured component manifest (replaces scattered component_N rows)
    ['components',                JSON.stringify(componentsManifest)],
  ]
  if (tenantId) {
    manifestRows.push(['tenant_id',            tenantId])
    manifestRows.push(['manifest_tenant_id',   tenantId])   // backward compat
  }
  if (generatedBy) {
    manifestRows.push(['generated_by',          generatedBy])
    manifestRows.push(['manifest_generated_by', generatedBy])  // backward compat
  }

  for (const row of manifestRows) wsMeta.addRow(row)
  wsMeta.getColumn(1).width = 28
  wsMeta.getColumn(2).width = 120

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Validate rows from an employee salary upload file.
 *
 * Dynamic column matching:
 *   - Header keys arrive lowercase (frontend normaliseKey strips * and lowercases).
 *   - We build a lowercase lookup map from the tenant's active salary_components names.
 *   - Unknown headers → error; inactive headers → descriptive error (not "unknown").
 *
 * Optional templateVersion: compared against the current master fingerprint to
 * surface a stale-template warning in the UI before the user imports.
 *
 * Returns SalaryValidationResult which extends ValidationResult with:
 *   - payrollEstimate: sum of (earnings + employer_contribution) × 12 over valid rows
 *   - templateOutdated / currentTemplateVersion
 */
export async function validateSalaryUploadRows(
  supabase:         SupabaseClient,
  tenantId:         string,
  rows:             Record<string, string>[],
  templateVersion?: string,
  manifest?:        SalaryManifest,
  userId?:          string,
): Promise<SalaryValidationResult> {
  // ── Manifest validation (framework) ────────────────────────────────────────
  // Five-stage pipeline: schema → identity → tenant → hash → signature.
  // Stages 4 and 5 are skipped gracefully when the corresponding manifest
  // fields are absent (e.g. workbooks generated before v2 or without a hash).
  if (manifest) {
    const svRaw = manifest.schemaVersion ? parseInt(manifest.schemaVersion, 10) : NaN
    const workbookManifest: WorkbookManifest = {
      schemaVersion:    isNaN(svRaw) ? SCHEMA_VERSION : svRaw,
      tenantId:         manifest.tenantId,
      workbookType:     manifest.workbookType ?? manifest.importType,
      workbookId:       manifest.workbookId,
      masterHash:       manifest.componentHash,
      signature:        manifest.signature,
      generatedAt:      manifest.generatedAt,
      generatedBy:      manifest.generatedBy,
      generatorVersion: manifest.generatorVersion,
    }
    await resolveMetadata(workbookManifest, {
      tenantId,
      expectedWorkbookType: 'employee_salary_upload',
      computeCurrentHash:   async () => {
        const comps = await fetchActiveComponents(supabase, tenantId)
        return computeTemplateVersion(comps)
      },
    })
  }

  // ── Default salary structure prerequisite ──────────────────────────────────
  // Import cannot succeed without exactly one active default salary structure.
  // Check this early so validation fails with a clear action before any DB work.
  {
    const { data: defaultStructures, error: structErr } = await supabase
      .from('salary_structures')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .eq('is_active', true)

    if (!structErr) {
      const count = (defaultStructures ?? []).length
      if (count === 0) {
        throw new Error(
          'No default salary structure is configured. ' +
          'A default salary structure is required before employee compensation can be imported. ' +
          'Go to: Payroll → Salary Structures — create or mark one structure as Default, then validate again.',
        )
      }
      if (count > 1) {
        throw new Error(
          'Multiple default salary structures are configured. Exactly one default is required. ' +
          'Go to: Payroll → Salary Structures and ensure only one structure is set as Default.',
        )
      }
    }
  }

  // Fetch active components (template source of truth)
  const activeComponents = await fetchActiveComponents(supabase, tenantId)

  // ── Reference integrity validation (framework) ──────────────────────────────
  // Validates component column mappings from v2+ structured manifest before any
  // row is parsed. Only runs when the workbook includes a structured components
  // JSON (v2+). Malformed JSON is silently skipped — row-level validation will
  // surface the resulting errors naturally.
  if (manifest?.components) {
    let mappings: MasterMapping[] | null = null
    try {
      const raw = JSON.parse(manifest.components) as Array<{
        position: number; id: string; code: string; name: string
      }>
      mappings = raw.map(m => ({ position: m.position, entityId: m.id, code: m.code, name: m.name }))
    } catch {
      // malformed — skip
    }
    if (mappings) {
      const activeById = new Map(activeComponents.map(c => [c.id, c]))
      const ctx: ImportContext = {
        tenantId,
        userId:      userId ?? 'unknown',
        workbookType: 'employee_salary_upload',
        requestId:   randomUUID(),
        workbookId:  manifest.workbookId,
      }
      const countRaw = manifest.componentCount ? parseInt(manifest.componentCount, 10) : NaN
      await validateReferenceIntegrity<ComponentMeta>(mappings, {
        context:              ctx,
        expectedMappingCount: isNaN(countRaw) ? undefined : countRaw,
        lookupActiveEntities: async (ids) => {
          const result = new Map<string, ComponentMeta>()
          for (const id of ids) {
            const c = activeById.get(id)
            if (c) result.set(id, c)
          }
          return result
        },
      })
    }
  }

  // Phase 3: component manifest is mandatory — salary upload requires the v2 XLSX
  // template. v1 XLSX workbooks are rejected at resolveMetadata (Stage 1); CSV
  // uploads have no manifest. Without manifest.components there is no positional
  // mapping and we cannot safely process any component column.
  if (!manifest?.components) {
    throw new MetadataValidationError(
      WORKBOOK_ERROR_CODES.MANIFEST_FIELD_MISSING,
      'This file is missing the salary component manifest. ' +
      'Please upload the XLSX template downloaded from CognixHR — ' +
      'CSV and older template files are no longer accepted for salary data.',
    )
  }

  // Current template version
  const currentTemplateVersion = computeTemplateVersion(activeComponents)
  const templateOutdated = !!templateVersion && templateVersion !== currentTemplateVersion

  // Build component_id → component_type map for payroll estimate computation
  const compTypeById = new Map<string, string>()
  for (const c of activeComponents) {
    compTypeById.set(c.id, c.component_type)
  }

  // Build pure positional column map: 1-based Excel column position → entityId.
  // The frontend emits component columns with their 1-based position as the key
  // (e.g. "4" for column D). Column header text is never used for resolution —
  // users can rename, translate, or reformat headers without affecting imports.
  const manifestEntries = JSON.parse(manifest.components) as Array<{
    position: number; id: string; code: string; name: string
  }>
  const manifestByPosition = new Map<number, string>()  // 1-based position → entityId
  for (const m of manifestEntries) {
    manifestByPosition.set(m.position, m.id)
  }

  // Classify columns: fixed-name keys (employee_code etc.) are skipped;
  // numeric-string keys are 1-based column positions resolved via the manifest.
  const firstRowKeys = rows.length > 0 ? Object.keys(rows[0]) : []
  const componentCols: Array<{ key: string; entityId: string }> = []
  for (const key of firstRowKeys) {
    if (FIXED_KEYS.has(key)) continue
    const pos = parseInt(key, 10)
    if (Number.isInteger(pos) && pos > 0) {
      const entityId = manifestByPosition.get(pos)
      if (entityId) componentCols.push({ key, entityId })
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
    const compAmounts: Record<string, number> = {}  // entityId → monthly amount
    for (const { key, entityId } of componentCols) {
      const val = (d[key] ?? '').trim()
      if (!val || val === '') continue  // blank = skip (treat as not set)
      const n = parseFloat(val)
      if (isNaN(n) || n < 0) {
        errors.push({
          field:    key,
          message:  `Invalid amount "${val}" for "${key}" — must be a non-negative number`,
          severity: 'error',
        })
      } else {
        compAmounts[entityId] = n
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

  // 2. Check which employees already have an active compensation (fetch effective_from too)
  const resolvedIds = [...empCodeMap.values()]
  const existingCompMap = new Map<string, string>()  // employee_id → existing effective_from
  if (resolvedIds.length > 0) {
    for (let i = 0; i < resolvedIds.length; i += 500) {
      const chunk = resolvedIds.slice(i, i + 500)
      const { data } = await supabase
        .from('employee_compensations')
        .select('employee_id, effective_from')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('employee_id', chunk)
      if (data) {
        for (const r of data as any[]) {
          existingCompMap.set(r.employee_id as string, r.effective_from as string)
        }
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
      const existingEffectiveFrom = existingCompMap.get(empId)
      if (existingEffectiveFrom) {
        vr.isDuplicate = true
        // Back-dating warning: upload date is earlier than the current active package
        const uploadDate = vr.normalizedData.effective_from as string | undefined
        if (uploadDate && uploadDate < existingEffectiveFrom) {
          vr.warnings.push({
            field:    'effective_from',
            message:  `Employee already has an active package effective ${existingEffectiveFrom}. Uploading ${uploadDate} will back-date their compensation.`,
            severity: 'warning',
          })
        }
      }
    }
  }

  // ── Payroll estimate ──────────────────────────────────────────────────────────
  // Sum (earnings + employer_contribution) monthly amounts over all valid rows.
  // Mirrors the CTC computation in importSalaryUpload.

  let payrollMonthly = 0
  for (const vr of validatedRows) {
    if (!vr.isValid) continue
    const comps = (vr.normalizedData.components as Record<string, number>) ?? {}
    for (const [compId, amount] of Object.entries(comps)) {
      const ctype = compTypeById.get(compId)
      if (ctype === 'earning' || ctype === 'employer_contribution') {
        payrollMonthly += amount
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
    payrollEstimate: {
      monthly:  Math.round(payrollMonthly * 100) / 100,
      annual:   Math.round(payrollMonthly * 12 * 100) / 100,
      currency: 'INR',
    },
    templateOutdated,
    currentTemplateVersion,
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
  supabase:         SupabaseClient,
  tenantId:         string,
  createdBy:        string,
  mode:             ImportMode,
  rows:             Record<string, string>[],
  fileName:         string,
  existingJobId:    string,
  templateVersion?: string,
  manifest?:        SalaryManifest,
): Promise<SalaryUploadResult> {
  const startedAt = Date.now()
  const jobId     = existingJobId

  try {
    // Validate (templateVersion and manifest passed through for staleness/security checks)
    const validation = await validateSalaryUploadRows(supabase, tenantId, rows, templateVersion, manifest, createdBy)

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

    // Partition rows
    const invalidRows:  ValidatedRow[] = []
    const modeSkipped:  ValidatedRow[] = []
    const eligibleRows: ValidatedRow[] = []

    for (const vr of validation.rows) {
      if (!vr.isValid) { invalidRows.push(vr); continue }
      if (mode === 'create_only' && vr.isDuplicate) { modeSkipped.push(vr); continue }
      if (mode === 'update_only' && !vr.isDuplicate) { modeSkipped.push(vr); continue }
      eligibleRows.push(vr)
    }

    const result = await executeInChunks({
      supabase,
      tenantId,
      jobId,
      eligibleRows,
      invalidRows,
      skippedCount: modeSkipped.length,
      processChunk: (rows) => importSalaryUpload(supabase, tenantId, createdBy, rows, mode),
    })

    const duration = Date.now() - startedAt

    await supabase
      .from('import_jobs')
      .update({
        status:           'completed',
        processed_rows:   eligibleRows.length,
        created_rows:     result.created,
        updated_rows:     result.updated,
        failed_rows:      result.failed,
        skipped_rows:     result.skipped,
        duration_ms:      duration,
        completed_at:     new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return {
      importJobId: jobId,
      created:     result.created,
      updated:     result.updated,
      failed:      result.failed,
      skipped:     result.skipped,
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
