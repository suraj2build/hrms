// ── Enterprise Import Framework — MetadataResolver ───────────────────────────
// Five-stage metadata validation pipeline.
// Domain-agnostic: callers inject domain callbacks (hash provider, tenant ID).
// Payroll must never be imported here — this is platform infrastructure.

import type { WorkbookManifest }                       from './workbook-manifest.js'
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
   * Domain-provided callback that returns the current master hash for this tenant.
   * Only called when manifest.masterHash is present (Stage 4).
   * Keeping this as a callback ensures the resolver stays domain-agnostic.
   */
  computeCurrentHash: () => Promise<string>
}

// djb2 hash — must match the implementation in salary-upload.ts generateSalaryUploadXlsx().
// IMPORTANT: changing this algorithm requires a SCHEMA_VERSION bump.
function djb2(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Run five metadata-validation stages against a WorkbookManifest.
 *
 * Stage 1 — Schema:     schemaVersion is in SUPPORTED_SCHEMA_VERSIONS
 * Stage 2 — Identity:   workbookType matches expectedWorkbookType
 * Stage 3 — Tenant:     tenantId matches the authenticated tenant
 * Stage 4 — Hash:       masterHash matches current master snapshot (skipped if empty)
 * Stage 5 — Signature:  signature matches recomputed djb2 checksum (skipped if empty)
 *
 * Accepts WorkbookManifest directly so callers with a full WorkbookDescriptor
 * pass descriptor.manifest, and callers working with legacy JSON manifests can
 * construct a WorkbookManifest without a full descriptor.
 *
 * Throws MetadataValidationError on any failed stage.
 */
export async function resolveMetadata(
  manifest: WorkbookManifest,
  opts:     MetadataResolverOptions,
): Promise<void> {
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
  if (manifest.workbookType && manifest.workbookType !== opts.expectedWorkbookType) {
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
        'Download a fresh template — the column layout no longer matches the current master.',
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
    if (manifest.signature !== djb2(sigPayload)) {
      throw new MetadataValidationError(
        WORKBOOK_ERROR_CODES.SIGNATURE_INVALID,
        'Workbook metadata signature is invalid — the metadata sheet may have been modified. ' +
        'Download a fresh template from CognixHR.',
      )
    }
  }
}
