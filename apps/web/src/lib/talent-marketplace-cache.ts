/**
 * Shared cache-invalidation helper for the Talent Marketplace.
 *
 * The same talent_roles / talent_interests data is cached under disjoint
 * query keys on the admin and employee sides:
 *   talent-roles          — AdminTalentMarketplace.tsx (HR role list + interest counts)
 *   talent-interests       — AdminTalentMarketplace.tsx (per-role interest list)
 *   talent-browse          — EssTalentMarketplace.tsx (employee-facing role list)
 *   talent-my-interests    — EssTalentMarketplace.tsx (employee's own applications)
 *
 * Neither side invalidated the other's keys: HR closing a role left the
 * employee's talent-browse cache showing it as open (and able to apply to
 * it), and an employee applying left HR's talent-roles interest_count stale.
 * A predicate match on the 'talent-' prefix is used instead of listing exact
 * keys so a renamed or newly-added talent-adjacent query key is covered
 * automatically.
 */
import type { QueryClient } from '@tanstack/react-query'

export function invalidateTalentMarketplace(qc: QueryClient): void {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0]
      return typeof k === 'string' && k.startsWith('talent-')
    },
  })
}
