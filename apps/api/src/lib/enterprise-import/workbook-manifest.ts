// ── Enterprise Import Framework — Manifest Types ──────────────────────────────
// Pure type definitions for the workbook manifest and column mappings.
// Domain-agnostic: no payroll or salary-specific imports.

/**
 * Canonical workbook identity and provenance — embedded in the CognixHR_Metadata
 * sheet at generation time. Validated by MetadataResolver before any row is processed.
 */
export interface WorkbookManifest {
  workbookId:       string   // UUID assigned at generation time
  workbookType:     string   // e.g. 'employee_salary_upload'
  tenantId:         string
  generatedBy:      string   // user ID of the person who downloaded the template
  generatedAt:      string   // ISO date string (YYYY-MM-DD)
  schemaVersion:    number   // bumped on breaking manifest changes
  generatorVersion: string   // '1.0.0' — semver of the generation code
  masterHash:       string   // fingerprint of the master data at generation time
  signature:        string   // djb2 checksum of canonical metadata fields
}

/**
 * One slot in the column manifest: maps a 1-based Excel column position to
 * a master entity UUID.
 *
 * entityId is deliberately named to stay generic:
 *   - employee_salary_upload → entityId = salary_component_id
 *   - asset_upload           → entityId = asset_category_id
 *   - variable_pay_upload    → entityId = variable_component_id
 *
 * name is carried for error messages only; it is NEVER used for resolution.
 * All resolution is positional: position → entityId → DB lookup.
 */
export interface MasterMapping {
  position: number   // 1-based Excel column index
  entityId: string   // UUID of the master entity
  code:     string   // human-readable code (for error messages)
  name:     string   // display name (for error messages only — not for resolution)
}
