// ── Enterprise Import Framework — Error Types ─────────────────────────────────
// Typed errors for workbook parsing, metadata validation, and master resolution.
// Domain-agnostic: no payroll or salary-specific imports.

export const WORKBOOK_ERROR_CODES = {
  METADATA_SHEET_MISSING:       'METADATA_SHEET_MISSING',
  METADATA_CORRUPTED:           'METADATA_CORRUPTED',
  MANIFEST_FIELD_MISSING:       'MANIFEST_FIELD_MISSING',
  MAPPINGS_INVALID:             'MAPPINGS_INVALID',
  DATA_SHEET_NOT_FOUND:         'DATA_SHEET_NOT_FOUND',
  SCHEMA_VERSION_UNSUPPORTED:   'SCHEMA_VERSION_UNSUPPORTED',
  WORKBOOK_TYPE_MISMATCH:       'WORKBOOK_TYPE_MISMATCH',
  TENANT_MISMATCH:              'TENANT_MISMATCH',
  MASTER_HASH_MISMATCH:         'MASTER_HASH_MISMATCH',
  SIGNATURE_INVALID:            'SIGNATURE_INVALID',
  ENTITY_NOT_FOUND:             'ENTITY_NOT_FOUND',
  REFERENCE_INTEGRITY_FAILED:   'REFERENCE_INTEGRITY_FAILED',
} as const

export type WorkbookErrorCode = (typeof WORKBOOK_ERROR_CODES)[keyof typeof WORKBOOK_ERROR_CODES]

export class WorkbookParseError extends Error {
  readonly code: WorkbookErrorCode
  constructor(code: WorkbookErrorCode, message: string) {
    super(message)
    this.name = 'WorkbookParseError'
    this.code = code
  }
}

export class MetadataValidationError extends Error {
  readonly code: WorkbookErrorCode
  constructor(code: WorkbookErrorCode, message: string) {
    super(message)
    this.name = 'MetadataValidationError'
    this.code = code
  }
}

export class MasterResolutionError extends Error {
  readonly code: WorkbookErrorCode
  readonly details: Record<string, unknown>
  constructor(code: WorkbookErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name    = 'MasterResolutionError'
    this.code    = code
    this.details = details
  }
}

export interface IntegrityViolation {
  stage:   'structure' | 'manifest' | 'reference'
  code:    string
  message: string
}

export class ReferenceIntegrityError extends Error {
  readonly code:       WorkbookErrorCode
  readonly violations: IntegrityViolation[]
  constructor(violations: IntegrityViolation[]) {
    const summary = violations.map(v => v.message).join(' | ')
    super(`Reference integrity failed (${violations.length} violation(s)): ${summary}`)
    this.name       = 'ReferenceIntegrityError'
    this.code       = WORKBOOK_ERROR_CODES.REFERENCE_INTEGRITY_FAILED
    this.violations = violations
  }
}
