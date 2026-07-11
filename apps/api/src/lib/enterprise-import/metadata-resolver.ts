// ── Enterprise Import Framework — MetadataResolver ───────────────────────────
// Five-stage metadata validation pipeline.
// Domain-agnostic: callers inject domain callbacks (hash provider, tenant ID).
// Payroll must never be imported here — this is platform infrastructure.

import type { WorkbookDescriptor }                  from './workbook-descriptor.js'
import { MetadataValidationError, WORKBOOK_ERROR_CODES } from './workbook-errors.js'

// Schema versions this runtime accepts. Reject everything else.
const SUPPORTED_SCHEMA_VERSIONS = [2]

export interface MetadataResolverOptions {
  /**
   * Authenticated tenant ID — validated against manifest.tenantId in Stage 3.
   */
  tenantId: string

  /**
   * The import type expected for this route — validated against manifest.workbookType
   * in Stage 2.
   */
  expectedWorkbookType: string

  /**
   * Domain-provided callback that returns the current master hash for this
   * tenant. MetadataResolver compares it to manifest.masterHash in Stage 4.
   *
   * Keeping this as a callback (not a DB query inside the resolver) ensures
   * the resolver stays domain-agnostic.
   */
  computeCurrentHash: () => Promise<string>
}

// djb2 hash — mirrors the implementation in salary-upload.ts.
// IMPORTANT: Any change here must be mirrored in generateSalaryUploadXlsx().
function djb2(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Run the five metadata-validation stages against a parsed WorkbookDescriptor.
 *
 * Stage 1 — Schema Validation:     schemaVersion is in SUPPORTED_SCHEMA_VERSIONS
 * Stage 2 — Identity Validation:   workbookType matches the expected import type
 * Stage 3 — Tenant Validation:     tenantId matches the authenticated tenant
 * Stage 4 — Master Hash Validation: masterHash matches current master snapshot
 * Stage 5 — Signature Validation:  signature matches recomputed djb2 checksum
 *
 * Returns the descriptor unchanged on success.
 * Throws MetadataValidationError on any failed stage.
 */
export async function resolveMetadata(
  descriptor: WorkbookDescriptor,
  opts:       MetadataResolverOptions,
): Promise<WorkbookDescriptor> {
  const { manifest } = descriptor

  // ── Stage 1: Schema Validation ────────────────────────────────────────────
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
    throw new MetadataValidationError(
      WORKBOOK_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      `Schema version ${manifest.schemaVersion} is not supported ` +
      `(supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}). ` +
      'Download a fresh template from CognixHR.',
    )
  }

  // ── Stage 2: Workbook Identity Validation ─────────────────────────────────
  if (manifest.workbookType !== opts.expectedWorkbookType) {
    throw new MetadataValidationError(
      WORKBOOK_ERROR_CODES.WORKBOOK_TYPE_MISMATCH,
      `This file is for import type "${manifest.workbookType}", ` +
      `not "${opts.expectedWorkbookType}". Upload the correct template file.`,
    )
  }

  // ── Stage 3: Tenant Validation ────────────────────────────────────────────
  if (manifest.tenantId && manifest.tenantId !== opts.tenantId) {
    throw new MetadataValidationError(
      WORKBOOK_ERROR_CODES.TENANT_MISMATCH,
      'This workbook was generated for a different tenant. ' +
      'Download a fresh template from your own CognixHR account.',
    )
  }

  // ── Stage 4: Master Hash Validation ──────────────────────────────────────
  if (manifest.masterHash) {
    const currentHash = await opts.computeCurrentHash()
    if (manifest.masterHash !== currentHash) {
      throw new MetadataValidationError(
        WORKBOOK_ERROR_CODES.MASTER_HASH_MISMATCH,
        'The master configuration has changed since this workbook was generated. ' +
        'Download a fresh template — the upload column layout no longer matches the current master.',
      )
    }
  }

  // ── Stage 5: Signature Validation ────────────────────────────────────────
  if (manifest.signature) {
    const sigPayload = [
      manifest.tenantId,
      manifest.workbookId,
      String(manifest.schemaVersion),
      manifest.masterHash,
      manifest.generatedAt,
    ].join('|')
    const expectedSig = djb2(sigPayload)

    if (manifest.signature !== expectedSig) {
      throw new MetadataValidationError(
        WORKBOOK_ERROR_CODES.SIGNATURE_INVALID,
        'Workbook metadata signature is invalid — the metadata sheet may have been modified. ' +
        'Download a fresh template from CognixHR.',
      )
    }
  }

  return descriptor
}
