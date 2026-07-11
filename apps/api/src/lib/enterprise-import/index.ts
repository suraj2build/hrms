// ── Enterprise Import Framework ───────────────────────────────────────────────
// Platform-level workbook parsing, metadata validation, and master resolution.
// Designed for reuse across all master-driven import types: employee salary,
// variable pay, bonus, FBP, assets, and any future workbook-based import.
//
// Dependency rule (enforced, never break):
//   This package must NEVER import from payroll-specific modules.
//   Payroll (and every other domain) consumes this package — not the reverse.

export type { WorkbookManifest, MasterMapping }        from './workbook-manifest.js'
export type { WorkbookDescriptor, WorkbookSheet }       from './workbook-descriptor.js'
export type { ResolvedColumn, EntityLookup }            from './master-column-resolver.js'
export type { MetadataResolverOptions }                 from './metadata-resolver.js'
export type { ImportContext }                           from './import-context.js'
export type { ReferenceIntegrityOptions, ActiveEntityLookup } from './reference-integrity-validator.js'

export {
  WorkbookParseError,
  MetadataValidationError,
  MasterResolutionError,
  ReferenceIntegrityError,
  WORKBOOK_ERROR_CODES,
}                                                       from './workbook-errors.js'
export type { WorkbookErrorCode, IntegrityViolation }   from './workbook-errors.js'

export { parseWorkbook }                                from './workbook-parser.js'
export { resolveMetadata }                              from './metadata-resolver.js'
export { resolveMasterColumns }                         from './master-column-resolver.js'
export { validateReferenceIntegrity }                   from './reference-integrity-validator.js'
