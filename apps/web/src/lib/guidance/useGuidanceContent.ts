/**
 * useGuidanceContent — fetches tenant content overrides for a page key.
 * Degrades gracefully to [] (static content then applies).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { GuidanceModule, GuidanceContentRow } from './guidance-config'

export function useGuidanceContent(module: GuidanceModule, pageKey: string, enabled = true) {
  const { data } = useQuery({
    queryKey: ['guidance-content', module, pageKey],
    queryFn: () =>
      api.get<{ data: GuidanceContentRow[] }>(
        `/workspace/guidance/content?module=${encodeURIComponent(module)}&page_key=${encodeURIComponent(pageKey)}`,
      ).then(r => r.data),
    staleTime: 5 * 60_000,
    placeholderData: [],
    enabled,
  })
  return data ?? []
}
