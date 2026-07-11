// ── Enterprise Import Framework — ReferenceIntegrityValidator ────────────────
// Three-stage pre-import gate that validates column mappings before a single
// row is processed. Domain-agnostic: entity lookup is injected by the caller.
//
// Stage 1 — Structure:   mappings exist, count matches declared component_count
// Stage 2 — Manifest:    no duplicate entityIds, no duplicate positions,
//                        no null IDs, positions are positive and strictly ascending
// Stage 3 — Reference:   every entityId resolves to an active master record
//
// Throws ReferenceIntegrityError (carrying all violations) on any failure.
// All structure + manifest checks run before Stage 3 hits the DB.

import type { MasterMapping }                          from './workbook-manifest.js'
import type { ImportContext }                           from './import-context.js'
import { ReferenceIntegrityError, type IntegrityViolation } from './workbook-errors.js'

/**
 * Domain-provided entity lookup: given a list of entity UUIDs, return a Map
 * from entityId → T for every ID that is currently eligible (active, tenant-owned).
 * IDs not in the map are treated as unresolvable.
 */
export type ActiveEntityLookup<T = unknown> = (entityIds: string[]) => Promise<Map<string, T>>

export interface ReferenceIntegrityOptions<T = unknown> {
  context:               ImportContext
  /**
   * Declared component_count from workbook metadata.
   * When provided, mappings.length must match — catches truncated manifests.
   */
  expectedMappingCount?: number
  /**
   * Active entity lookup — injected by the caller so the validator stays
   * domain-agnostic. For salary upload: queries salary_components WHERE is_active.
   */
  lookupActiveEntities:  ActiveEntityLookup<T>
}

/**
 * Run the three-stage reference integrity pipeline on a set of MasterMappings.
 *
 * All structure and manifest checks (Stages 1–2) run first.
 * The DB lookup (Stage 3) is skipped if earlier stages produce violations.
 *
 * Throws ReferenceIntegrityError on any violation.
 * Returns void on clean pass.
 */
export async function validateReferenceIntegrity<T = unknown>(
  mappings: MasterMapping[],
  opts:     ReferenceIntegrityOptions<T>,
): Promise<void> {
  const violations: IntegrityViolation[] = []

  // ── Stage 1: Structure ────────────────────────────────────────────────────

  if (mappings.length === 0) {
    violations.push({
      stage:   'structure',
      code:    'NO_MAPPINGS',
      message: 'No column mappings found in the workbook manifest. Download a fresh template.',
    })
  }

  if (
    opts.expectedMappingCount !== undefined &&
    mappings.length !== opts.expectedMappingCount
  ) {
    violations.push({
      stage:   'structure',
      code:    'MAPPING_COUNT_MISMATCH',
      message:
        `Manifest declares ${opts.expectedMappingCount} component(s) ` +
        `but contains ${mappings.length} mapping(s). Download a fresh template.`,
    })
  }

  // ── Stage 2: Manifest Integrity ───────────────────────────────────────────

  const seenEntityIds = new Set<string>()
  const seenPositions = new Set<number>()
  let prevPosition    = -1

  for (const m of mappings) {
    // No null / empty entityId
    if (!m.entityId) {
      violations.push({
        stage:   'manifest',
        code:    'NULL_ENTITY_ID',
        message: `Mapping at position ${m.position} has a null or empty entityId.`,
      })
      continue
    }

    // No duplicate entityId
    if (seenEntityIds.has(m.entityId)) {
      violations.push({
        stage:   'manifest',
        code:    'DUPLICATE_ENTITY_ID',
        message: `Duplicate entityId for "${m.name}" (position ${m.position}) — ` +
                 'the same entity appears more than once in the manifest.',
      })
    } else {
      seenEntityIds.add(m.entityId)
    }

    // No duplicate position
    if (seenPositions.has(m.position)) {
      violations.push({
        stage:   'manifest',
        code:    'DUPLICATE_POSITION',
        message: `Duplicate column position ${m.position} in manifest.`,
      })
    } else {
      seenPositions.add(m.position)
    }

    // Position must be a positive integer
    if (!Number.isInteger(m.position) || m.position < 1) {
      violations.push({
        stage:   'manifest',
        code:    'INVALID_POSITION',
        message: `Invalid column position ${m.position} for "${m.name}" — must be a positive integer ≥ 1.`,
      })
    }

    // Positions must be strictly ascending (manifest is already sorted by parseWorkbook)
    if (m.position <= prevPosition) {
      violations.push({
        stage:   'manifest',
        code:    'POSITIONS_NOT_ASCENDING',
        message: `Column positions must be strictly ascending. ` +
                 `Position ${m.position} for "${m.name}" follows ${prevPosition}.`,
      })
    }
    prevPosition = m.position
  }

  // Fail fast: do not hit the DB when structure or manifest are broken.
  if (violations.length > 0) {
    throw new ReferenceIntegrityError(violations)
  }

  // ── Stage 3: DB Reference Validation ─────────────────────────────────────

  const entityIds = mappings.map(m => m.entityId)
  const entityMap = await opts.lookupActiveEntities(entityIds)

  for (const m of mappings) {
    if (!entityMap.has(m.entityId)) {
      violations.push({
        stage:   'reference',
        code:    'ENTITY_NOT_FOUND',
        message: `Component "${m.name}" (column ${m.position}) no longer exists or is inactive. ` +
                 'Download a fresh template.',
      })
    }
  }

  if (violations.length > 0) {
    throw new ReferenceIntegrityError(violations)
  }
}
