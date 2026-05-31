/**
 * useActivityStream.ts — Polling hook for the unified operational activity feed
 * Phase UX-4
 *
 * Fetches data from five independent API endpoints in parallel, normalises
 * each payload via `normalizeActivitySources`, and re-fetches every 30 s.
 * Filtering is applied in a separate memo so allEvents never re-computes on
 * filter changes; only the derived `events` slice re-evaluates.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useCallback } from 'react'
import { api } from '@/lib/api/client'
import { normalizeActivitySources, filterEvents } from './normalizer'
import type { EventFilters, ActivityStreamState } from './types'

// ── Query key ─────────────────────────────────────────────────────────────────

const ACTIVITY_STREAM_KEY = ['activity-stream'] as const

// ── Raw fetch result shape ────────────────────────────────────────────────────

interface RawActivityData {
  anomalies:       unknown[]
  corrections:     unknown[]
  regularisations: unknown[]
  revisions:       unknown[]
  lastRun:         unknown | null
  fetchedAt:       string
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetch and continuously refresh the unified operational activity stream.
 *
 * @param filters - Optional filter dimensions; changing filters does NOT
 *   trigger a re-fetch — only the local derived `events` list is recomputed.
 *
 * @returns An `ActivityStreamState` object containing the filtered event list,
 *   the full unfiltered list, loading state, last-updated timestamp, and a
 *   `refresh` callback for on-demand re-fetches.
 */
export function useActivityStream(filters: EventFilters = {}): ActivityStreamState {
  const queryClient = useQueryClient()

  // ── Data fetch ─────────────────────────────────────────────────────────────

  const { data: rawData, isLoading } = useQuery<RawActivityData>({
    queryKey: ACTIVITY_STREAM_KEY,
    queryFn:  async (): Promise<RawActivityData> => {
      const [anomaliesRes, correctionsRes, regRes, revisionsRes, lastRunRes] =
        await Promise.allSettled([
          api
            .get<{ data: unknown[] }>('/attendance/anomalies?resolved=false&limit=100')
            .then(r => r.data ?? [])
            .catch((): unknown[] => []),

          api
            .get<{ data: unknown[] }>('/attendance/corrections?status=pending&limit=100')
            .then(r => r.data ?? [])
            .catch((): unknown[] => []),

          api
            .get<{ data: unknown[] }>('/attendance/regularisation/pending')
            .then(r => r.data ?? [])
            .catch((): unknown[] => []),

          api
            .get<{ data: unknown[] }>('/payroll/revisions?status=pending&limit=100')
            .then(r => r.data ?? [])
            .catch((): unknown[] => []),

          api
            .get<{ run: unknown }>('/attendance/process/last')
            .then(r => r.run ?? null)
            .catch((): null => null),
        ])

      return {
        anomalies:       anomaliesRes.status       === 'fulfilled' ? anomaliesRes.value       : [],
        corrections:     correctionsRes.status     === 'fulfilled' ? correctionsRes.value     : [],
        regularisations: regRes.status             === 'fulfilled' ? regRes.value             : [],
        revisions:       revisionsRes.status       === 'fulfilled' ? revisionsRes.value       : [],
        lastRun:         lastRunRes.status         === 'fulfilled' ? lastRunRes.value         : null,
        fetchedAt:       new Date().toISOString(),
      }
    },
    staleTime:       25_000,   // 25 s — data is fresh; no background re-fetch within window
    refetchInterval: 30_000,   // 30 s polling
  })

  // ── Normalise all events — only recomputes when rawData changes ────────────

  const allEvents = useMemo(() => {
    if (!rawData) return []
    return normalizeActivitySources({
      anomalies:       rawData.anomalies,
      corrections:     rawData.corrections,
      regularisations: rawData.regularisations,
      revisions:       rawData.revisions,
      lastRun:         rawData.lastRun,
    })
  }, [rawData])

  // ── Apply filters — recomputes when allEvents OR filters change ────────────

  const events = useMemo(
    () => filterEvents(allEvents, filters),
    [allEvents, filters],
  )

  // ── Derived metadata ───────────────────────────────────────────────────────

  const lastUpdated = useMemo(
    () => (rawData?.fetchedAt ? new Date(rawData.fetchedAt) : null),
    [rawData],
  )

  // ── Imperative refresh ─────────────────────────────────────────────────────

  /** Invalidate the query cache and trigger an immediate re-fetch. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ACTIVITY_STREAM_KEY })
  }, [queryClient])

  // ── Return ─────────────────────────────────────────────────────────────────

  return { events, allEvents, isLoading, lastUpdated, refresh }
}
