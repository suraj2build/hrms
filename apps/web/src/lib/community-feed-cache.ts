/**
 * Shared cache-invalidation helper for the Community feed.
 *
 * The same /community/feed data is cached under four independent query keys
 * across desktop + mobile, feed + home-teaser surfaces:
 *   community-feed        — EssCommunity.tsx (desktop Community page)
 *   mobile-community-feed — MobileCommunity.tsx (phone Community screen)
 *   community-home        — EmployeeDashboard.tsx (desktop Home teaser)
 *   mobile-home-community — MobileHome.tsx (phone Home teaser)
 *
 * Every mutation that changes feed content (post, react, comment, wish,
 * moderate/pin/hide/remove) must invalidate all four, or one surface keeps
 * showing stale data after the action succeeds elsewhere. A predicate match
 * on the key prefix is used instead of listing exact keys so a renamed or
 * newly-added feed-adjacent query key is covered automatically.
 */
import type { QueryClient } from '@tanstack/react-query'

export function invalidateCommunityFeeds(qc: QueryClient): void {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0]
      return typeof k === 'string' && (k.includes('community') || k.includes('feed') || k.includes('home'))
    },
  })
}
