// ── Enterprise Import Framework — WorkbookDescriptor ─────────────────────────
// The canonical output of WorkbookParser — a fully parsed, structured view of
// any enterprise import workbook. Domain-agnostic.

import type { WorkbookManifest, MasterMapping } from './workbook-manifest.js'

export type { WorkbookManifest, MasterMapping }

export interface WorkbookSheet {
  name:     string
  rowCount: number
}

/**
 * Returned by parseWorkbook(). Carries everything the downstream pipeline needs:
 *
 *   manifest  — identity and provenance; validated by MetadataResolver
 *   mappings  — column position → entityId; resolved by MasterColumnResolver
 *   rows      — raw cell values from the data sheet (ALL rows, including header)
 *   metadata  — every key→value pair from CognixHR_Metadata (for ad-hoc access)
 *
 * The pipeline never re-reads the XLSX file after parseWorkbook() returns.
 */
export interface WorkbookDescriptor {
  workbookId:    string
  workbookType:  string
  schemaVersion: number
  manifest:      WorkbookManifest
  mappings:      MasterMapping[]
  sheets:        WorkbookSheet[]
  dataSheet:     string                  // name of the data entry sheet
  rows:          unknown[][]             // raw cell values; index 0 = first row (may be header)
  metadata:      Record<string, string>  // all key→value pairs from CognixHR_Metadata
  warnings:      string[]
}
