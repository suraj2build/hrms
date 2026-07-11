// ── Enterprise Import Framework ───────────────────────────────────────────────
// Platform-level workbook parsing, metadata validation, and master resolution.
// Import types are designed for reuse across: employee salary, variable pay,
// bonus, FBP, asset, and any future master-driven import type.
//
// Dependency rule: this package must NEVER import payroll-specific types or
// services. Payroll (and every other domain) consumes this package — not the
// reverse.

export type { WorkbookManifest, MasterMapping }   from './workbook-manifest.js'
export type { WorkbookDescriptor, WorkbookSheet }  from './workbook-descriptor.js'
export type { ResolvedColumn, EntityLookup }       from './master-column-resolver.js'
export type { MetadataResolverOptions }            from './metadata-resolver.js'

export {
  WorkbookParseError,
  MetadataValidationError,
  MasterResolutionError,
  WORKBOOK_ERROR_CODES,
}                                                  from './workbook-errors.js'
export type { WorkbookErrorCode }                  from './workbook-errors.js'

export { parseWorkbook }                           from './workbook-parser.js'
export { resolveMetadata }                         from './metadata-resolver.js'
export { resolveMasterColumns }                    from './master-column-resolver.js'
