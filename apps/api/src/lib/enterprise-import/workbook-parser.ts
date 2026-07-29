// ── Enterprise Import Framework — WorkbookParser ──────────────────────────────
// Parses an XLSX buffer into a WorkbookDescriptor.
// Domain-agnostic: no payroll or salary-specific imports.

import ExcelJS                                              from 'exceljs'
import type { WorkbookDescriptor, WorkbookSheet }          from './workbook-descriptor.js'
import type { WorkbookManifest, MasterMapping }            from './workbook-manifest.js'
import { WorkbookParseError, WORKBOOK_ERROR_CODES }        from './workbook-errors.js'

const METADATA_SHEET_NAME = 'CognixHR_Metadata'

// Default known data-sheet names across all workbook types.
// Callers may override via expectedDataSheets.
const DEFAULT_DATA_SHEETS = new Set(['Employee Upload', 'Salary Component Upload'])

/**
 * Parse an XLSX buffer into a WorkbookDescriptor.
 *
 * @param buffer            Raw XLSX file bytes
 * @param expectedDataSheets Optional list of valid data-sheet names (defaults to built-ins)
 *
 * Throws WorkbookParseError for any structural problem:
 *   - Missing or empty CognixHR_Metadata sheet
 *   - Missing required v2 manifest fields
 *   - Malformed components JSON
 *   - No data sheet found
 */
export async function parseWorkbook(
  buffer:              Buffer | ArrayBuffer,
  expectedDataSheets?: string[],
): Promise<WorkbookDescriptor> {
  const wb = new ExcelJS.Workbook()
  // ExcelJS @types predate Node 22 Buffer<T> — safe at runtime, skip type check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)

  // ── Stage 1: Locate and read CognixHR_Metadata sheet ─────────────────────
  const wsMeta = wb.getWorksheet(METADATA_SHEET_NAME)
  if (!wsMeta) {
    throw new WorkbookParseError(
      WORKBOOK_ERROR_CODES.METADATA_SHEET_MISSING,
      `This workbook is missing the "${METADATA_SHEET_NAME}" sheet. ` +
      'Download a fresh template from CognixHR.',
    )
  }

  const metadata: Record<string, string> = {}
  const warnings: string[] = []

  wsMeta.eachRow((row, rowNo) => {
    if (rowNo === 1) return  // header row (key | value)
    const key   = String(row.getCell(1).value ?? '').trim()
    const value = String(row.getCell(2).value ?? '').trim()
    if (key) metadata[key] = value
  })

  if (Object.keys(metadata).length === 0) {
    throw new WorkbookParseError(
      WORKBOOK_ERROR_CODES.METADATA_CORRUPTED,
      `The "${METADATA_SHEET_NAME}" sheet is empty or corrupted. Download a fresh template.`,
    )
  }

  // ── Stage 2: Parse WorkbookManifest ──────────────────────────────────────
  const get = (key: string): string | undefined => metadata[key] || undefined

  // v2 canonical keys — required
  const workbookId       = get('workbook_id')
  const workbookType     = get('workbook_type')
  const schemaVersionRaw = get('schema_version')

  const missing: string[] = []
  if (!workbookId)       missing.push('workbook_id')
  if (!workbookType)     missing.push('workbook_type')
  if (!schemaVersionRaw) missing.push('schema_version')

  if (missing.length > 0) {
    throw new WorkbookParseError(
      WORKBOOK_ERROR_CODES.MANIFEST_FIELD_MISSING,
      `Workbook is missing required v2 metadata fields: ${missing.join(', ')}. ` +
      'Download a fresh template — this file was generated before schema version 2.',
    )
  }

  const schemaVersion = parseInt(schemaVersionRaw!, 10)
  if (isNaN(schemaVersion)) {
    throw new WorkbookParseError(
      WORKBOOK_ERROR_CODES.METADATA_CORRUPTED,
      `Invalid schema_version "${schemaVersionRaw}" in metadata sheet.`,
    )
  }

  // Optional fields — fall back to v1 backward-compat keys where applicable
  const manifest: WorkbookManifest = {
    workbookId:       workbookId!,
    workbookType:     workbookType!,
    tenantId:         get('tenant_id')         ?? get('manifest_tenant_id')   ?? '',
    generatedBy:      get('generated_by')      ?? get('manifest_generated_by') ?? '',
    generatedAt:      get('generated_at')      ?? '',
    schemaVersion,
    generatorVersion: get('generator_version') ?? '',
    masterHash:       get('component_hash')    ?? get('template_version')     ?? '',
    signature:        get('signature')         ?? '',
  }

  // ── Stage 3: Parse MasterMappings from structured JSON ───────────────────
  const mappings: MasterMapping[] = []
  const componentsJson = get('components')

  if (componentsJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(componentsJson)
    } catch (err) {
      throw new WorkbookParseError(
        WORKBOOK_ERROR_CODES.MAPPINGS_INVALID,
        `Failed to parse components manifest JSON: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (!Array.isArray(parsed)) {
      throw new WorkbookParseError(
        WORKBOOK_ERROR_CODES.MAPPINGS_INVALID,
        'components manifest must be a JSON array.',
      )
    }
    for (const item of parsed) {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>).position === 'number' &&
        typeof (item as Record<string, unknown>).id       === 'string' &&
        typeof (item as Record<string, unknown>).code     === 'string' &&
        typeof (item as Record<string, unknown>).name     === 'string'
      ) {
        const entry = item as Record<string, unknown>
        mappings.push({
          position: entry.position as number,
          entityId: entry.id       as string,
          code:     entry.code     as string,
          name:     entry.name     as string,
        })
      } else {
        warnings.push(`Skipped malformed mapping entry: ${JSON.stringify(item)}`)
      }
    }
    mappings.sort((a, b) => a.position - b.position)
  } else {
    warnings.push(
      'No structured components manifest in metadata sheet. ' +
      'Re-download the template to get position-based column resolution.',
    )
  }

  // ── Stage 4: Enumerate sheets ─────────────────────────────────────────────
  const sheets: WorkbookSheet[] = []
  wb.eachSheet(ws => {
    sheets.push({ name: ws.name, rowCount: ws.rowCount })
  })

  // ── Stage 5: Locate data sheet ────────────────────────────────────────────
  const knownSheets = new Set(expectedDataSheets ?? [...DEFAULT_DATA_SHEETS])
  const dataSheetName =
    sheets.find(s => knownSheets.has(s.name))?.name ??
    sheets.find(s => s.name !== METADATA_SHEET_NAME)?.name

  if (!dataSheetName) {
    throw new WorkbookParseError(
      WORKBOOK_ERROR_CODES.DATA_SHEET_NOT_FOUND,
      'Could not locate the data entry sheet. Expected one of: ' +
      [...knownSheets].join(', '),
    )
  }

  // ── Stage 6: Read raw rows from data sheet ────────────────────────────────
  const wsData = wb.getWorksheet(dataSheetName)!
  // ExcelJS's row.eachCell({includeEmpty:true}) only iterates up to that
  // row's own cellCount (the highest column touched on THAT row), not the
  // worksheet's column count — a row whose trailing optional columns were
  // never clicked into produces a shorter array than a fully-populated row,
  // silently shifting any downstream 1-based column-position lookup. Pad
  // every row to the worksheet's full column count for consistent width.
  const columnCount = wsData.columnCount
  const rows: unknown[][] = []
  wsData.eachRow(row => {
    const values: unknown[] = []
    for (let col = 1; col <= columnCount; col++) {
      values.push(row.getCell(col).value ?? null)
    }
    rows.push(values)
  })

  return {
    workbookId:    workbookId!,
    workbookType:  workbookType!,
    schemaVersion,
    manifest,
    mappings,
    sheets,
    dataSheet: dataSheetName,
    rows,
    metadata,
    warnings,
  }
}
