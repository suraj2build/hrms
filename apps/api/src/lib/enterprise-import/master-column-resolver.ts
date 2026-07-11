// ── Enterprise Import Framework — MasterColumnResolver ────────────────────────
// Generic resolver: maps column positions → master entity UUIDs → DB records.
// Domain-agnostic: the lookup function is injected by the caller (payroll, assets, etc.)

import type { MasterMapping }                       from './workbook-manifest.js'
import { MasterResolutionError, WORKBOOK_ERROR_CODES } from './workbook-errors.js'

/**
 * A successfully resolved column: the original mapping plus the DB record
 * the caller retrieved for mapping.entityId.
 *
 * T is the domain record type (e.g. ComponentMeta for salary, AssetCategory for assets).
 */
export interface ResolvedColumn<T> {
  mapping: MasterMapping
  record:  T
}

/**
 * Caller-provided lookup: given a list of entity UUIDs, return a Map from
 * entityId → T for every ID that exists and is eligible for import.
 *
 * IDs that are inactive, deleted, or otherwise ineligible must be OMITTED
 * from the returned map — the resolver treats missing IDs as unresolvable.
 */
export type EntityLookup<T> = (entityIds: string[]) => Promise<Map<string, T>>

/**
 * Resolve a list of MasterMappings to their current DB records.
 *
 * Throws MasterResolutionError if any entityId cannot be found (inactive,
 * deleted, or cross-tenant). This is a hard pre-import gate — no row is
 * processed until all columns resolve cleanly.
 */
export async function resolveMasterColumns<T>(
  mappings:       MasterMapping[],
  lookupEntities: EntityLookup<T>,
): Promise<ResolvedColumn<T>[]> {
  if (mappings.length === 0) return []

  const entityIds = mappings.map(m => m.entityId)
  const entityMap = await lookupEntities(entityIds)

  const missing:  MasterMapping[] = []
  const resolved: ResolvedColumn<T>[] = []

  for (const mapping of mappings) {
    const record = entityMap.get(mapping.entityId)
    if (record === undefined) {
      missing.push(mapping)
    } else {
      resolved.push({ mapping, record })
    }
  }

  if (missing.length > 0) {
    const names = missing
      .map(m => `"${m.name}" (column ${m.position}, id ${m.entityId})`)
      .join('; ')
    throw new MasterResolutionError(
      WORKBOOK_ERROR_CODES.ENTITY_NOT_FOUND,
      `${missing.length} entity/entities referenced in this workbook no longer exist ` +
      `in the master (inactive, deleted, or cross-tenant): ${names}. ` +
      'Download a fresh template.',
      { missingEntityIds: missing.map(m => m.entityId) },
    )
  }

  return resolved
}
