/**
 * lib/queue/useOperationalQueue.ts — Phase UX-7 Operational Queue Hook
 * TanStack Query v5, Promise.allSettled multi-fetch, localStorage mode persistence.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import type {
  OperationalQueueItem,
  QueueGroup,
  QueueMode,
  QueueSection,
  QueueSLAMetrics,
  SmartRecommendation,
  TodaysMissionData,
} from './types'
import { QUEUE_MODE_META } from './types'
import type { RawSources } from './queueEngine'
import {
  normalizeToQueueItems,
  groupQueueItems,
  applyModeFilter,
  prioritizeItems,
  generateRecommendations,
  computeSLAMetrics,
  computeTodaysMission,
} from './queueEngine'

const MODE_STORAGE_KEY = 'ux7_queue_mode'

function loadMode(): QueueMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    if (
      stored === 'daily_ops' ||
      stored === 'payroll_week' ||
      stored === 'audit_mode' ||
      stored === 'low_staffing'
    ) {
      return stored
    }
  } catch {
    // ignore
  }
  return 'daily_ops'
}

function saveMode(mode: QueueMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

// Type-guard for unknown API response arrays
function toArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  return []
}

async function fetchAllSources(): Promise<RawSources> {
  // Anomalies are intentionally NOT fetched here.
  // Raw attendance anomalies are not directly actionable by HR — the resolution
  // path is: employee submits regularisation → manager/HR approves that request.
  // Unresolved anomalies auto-LOP at period lock.
  // Anomaly monitoring is available at /admin/attendance/anomalies (dept view).
  const [correctionsResult, regsResult, revisionsResult, collisionsResult] =
    await Promise.allSettled([
      api.get<unknown>('/attendance/corrections?status=pending&limit=200'),
      api.get<unknown>('/attendance/regularisation/pending'),
      api.get<unknown>('/payroll/revisions?status=pending&limit=100'),
      api.get<unknown>('/leave/collision/log?limit=100'),
    ])

  function extractArray(result: PromiseSettledResult<unknown>): unknown[] {
    if (result.status === 'fulfilled') {
      const val = result.value
      if (Array.isArray(val)) return val
      if (val !== null && typeof val === 'object') {
        // Common patterns: { data: [] } or { items: [] } or { results: [] }
        const obj = val as Record<string, unknown>
        if (Array.isArray(obj['data'])) return toArray(obj['data'])
        if (Array.isArray(obj['items'])) return toArray(obj['items'])
        if (Array.isArray(obj['results'])) return toArray(obj['results'])
      }
    }
    return []
  }

  return {
    anomalies:   [],   // not fetched — see comment above
    corrections: extractArray(correctionsResult) as RawSources['corrections'],
    regs:        extractArray(regsResult)        as RawSources['regs'],
    revisions:   extractArray(revisionsResult)   as RawSources['revisions'],
    collisions:  extractArray(collisionsResult)  as RawSources['collisions'],
  }
}

export interface UseOperationalQueueReturn {
  items: OperationalQueueItem[]
  sections: Map<QueueSection, OperationalQueueItem[]>
  groups: QueueGroup[]
  recommendations: SmartRecommendation[]
  sla: QueueSLAMetrics
  mission: TodaysMissionData
  mode: QueueMode
  setMode: (mode: QueueMode) => void
  refresh: () => void
  isLoading: boolean
  bulkApprove: (ids: string[]) => void | Promise<void>
  bulkReject:  (ids: string[]) => void | Promise<void>
  bulkSnooze: (ids: string[]) => void
  bulkEscalate: (ids: string[]) => void
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  selectedIds: Set<string>
  toggleSelected: (id: string) => void
  clearSelected: () => void
}

export function useOperationalQueue(): UseOperationalQueueReturn {
  const queryClient = useQueryClient()
  const [mode, setModeState] = useState<QueueMode>(loadMode)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // client-side snooze overlay
  const [snoozedIds, setSnoozedIds] = useState<Map<string, string>>(new Map())

  const setMode = useCallback((m: QueueMode) => {
    setModeState(m)
    saveMode(m)
  }, [])

  const { data: rawSources, isLoading, refetch } = useQuery({
    queryKey: ['operational-queue'],
    queryFn: fetchAllSources,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  // Compute normalized + filtered + prioritized items
  const allNormalized = useMemo(() => {
    if (!rawSources) return []
    return normalizeToQueueItems(rawSources)
  }, [rawSources])

  // Apply client-side snooze overlay
  const withSnooze = useMemo<OperationalQueueItem[]>(() => {
    return allNormalized.map(item => {
      const snoozedUntil = snoozedIds.get(item.id)
      if (snoozedUntil) {
        return { ...item, status: 'snoozed' as const, snoozed_until: snoozedUntil }
      }
      return item
    })
  }, [allNormalized, snoozedIds])

  const filteredItems = useMemo(() => {
    return applyModeFilter(withSnooze, mode)
  }, [withSnooze, mode])

  const prioritizedItems = useMemo(() => {
    return prioritizeItems(filteredItems, mode)
  }, [filteredItems, mode])

  const sections = useMemo(() => {
    const map = new Map<QueueSection, OperationalQueueItem[]>()
    const order = QUEUE_MODE_META[mode].sectionOrder
    for (const sec of order) {
      map.set(sec, [])
    }
    for (const item of prioritizedItems) {
      const existing = map.get(item.section) ?? []
      existing.push(item)
      map.set(item.section, existing)
    }
    return map
  }, [prioritizedItems, mode])

  const groups = useMemo(() => {
    return groupQueueItems(prioritizedItems)
  }, [prioritizedItems])

  const recommendations = useMemo(() => {
    return generateRecommendations(groups)
  }, [groups])

  const sla = useMemo(() => {
    return computeSLAMetrics(prioritizedItems)
  }, [prioritizedItems])

  const mission = useMemo(() => {
    return computeTodaysMission(prioritizedItems, mode)
  }, [prioritizedItems, mode])

  // ── Type-aware bulk actions ──────────────────────────────────────────────
  //
  // Different queue_types route to different backend endpoints:
  //   attendance_anomaly     → Approve: /anomalies/bulk-resolve (HR directly resolves)
  //                            Reject:  client-side snooze (auto-LOP at period lock)
  //   regularisation_pending → Approve: /regularisation/bulk-approve
  //                            Reject:  /regularisation/bulk-reject
  //   correction_pending     → Approve/Reject: /corrections/:id/approve|reject (per-item)
  //   payroll_blocker        → Approve/Reject: /payroll/revisions/:id/approve|reject (per-item)
  //   leave_conflict         → Approve: /leave/collision/log/:id/resolve (acknowledge)
  //                            Reject:  client-side snooze
  //   roster_gap/other       → snooze only

  function getItemById(id: string): OperationalQueueItem | undefined {
    return allNormalized.find(i => i.id === id)
  }

  function groupByType(ids: string[]): Record<string, string[]> {
    const groups: Record<string, string[]> = {}
    for (const id of ids) {
      const item = getItemById(id)
      const type = item?.queue_type ?? 'unknown'
      ;(groups[type] = groups[type] ?? []).push(id)
    }
    return groups
  }

  const bulkApprove = useCallback(
    async (ids: string[]) => {
      const groups = groupByType(ids)
      const promises: Promise<unknown>[] = []

      // Anomalies → HR directly resolves
      if (groups['attendance_anomaly']?.length) {
        promises.push(
          api.post('/attendance/anomalies/bulk-resolve', { ids: groups['attendance_anomaly'] }),
        )
      }
      // Regularisations → approve
      if (groups['regularisation_pending']?.length) {
        promises.push(
          api.post('/attendance/regularisation/bulk-approve', { ids: groups['regularisation_pending'] }),
        )
      }
      // Corrections → per-item (no bulk approve endpoint)
      for (const id of groups['correction_pending'] ?? []) {
        promises.push(api.post(`/attendance/corrections/${id}/approve`))
      }
      // Payroll revisions → per-item
      for (const id of groups['payroll_blocker'] ?? []) {
        promises.push(api.post(`/payroll/revisions/${id}/approve`))
      }
      // Leave collisions → acknowledge collision log
      for (const id of groups['leave_conflict'] ?? []) {
        promises.push(api.post(`/leave/collision/log/${id}/resolve`))
      }

      const results = await Promise.allSettled(promises)
      const failed  = results.filter(r => r.status === 'rejected').length

      if (failed === 0) {
        toast.success(ids.length === 1 ? 'Item approved' : `${ids.length} items approved`)
      } else {
        toast.warning(`${ids.length - failed} approved, ${failed} failed`)
      }
      void queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      setSelectedIds(new Set())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allNormalized, queryClient],
  )

  const bulkReject = useCallback(
    async (ids: string[]) => {
      const groups = groupByType(ids)
      const promises: Promise<unknown>[] = []

      // Anomalies → no server action; snooze client-side (will auto-LOP at period lock)
      const anomalyIds = groups['attendance_anomaly'] ?? []
      if (anomalyIds.length) {
        const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        setSnoozedIds(prev => {
          const next = new Map(prev)
          for (const id of anomalyIds) next.set(id, until)
          return next
        })
      }
      // Regularisations → reject
      if (groups['regularisation_pending']?.length) {
        promises.push(
          api.post('/attendance/regularisation/bulk-reject', {
            ids:              groups['regularisation_pending'],
            rejection_reason: 'Rejected via work queue',
          }),
        )
      }
      // Corrections → per-item
      for (const id of groups['correction_pending'] ?? []) {
        promises.push(api.post(`/attendance/corrections/${id}/reject`, { rejection_reason: 'Rejected via work queue' }))
      }
      // Payroll revisions → per-item
      for (const id of groups['payroll_blocker'] ?? []) {
        promises.push(api.post(`/payroll/revisions/${id}/reject`, { rejection_reason: 'Rejected via work queue' }))
      }
      // Leave conflicts → snooze (can't reject a collision)
      const leaveIds = groups['leave_conflict'] ?? []
      if (leaveIds.length) {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        setSnoozedIds(prev => {
          const next = new Map(prev)
          for (const id of leaveIds) next.set(id, until)
          return next
        })
      }

      const results = await Promise.allSettled(promises)
      const failed  = results.filter(r => r.status === 'rejected').length

      if (failed === 0) {
        const nonSnoozeCount = ids.length - anomalyIds.length - leaveIds.length
        if (nonSnoozeCount > 0) {
          toast.success(nonSnoozeCount === 1 ? 'Item rejected' : `${nonSnoozeCount} items rejected`)
        }
        if (anomalyIds.length > 0) {
          toast.info(`${anomalyIds.length} anomal${anomalyIds.length > 1 ? 'ies' : 'y'} dismissed — will auto-LOP at period lock`)
        }
      } else {
        toast.warning(`${ids.length - failed} processed, ${failed} failed`)
      }
      void queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      setSelectedIds(new Set())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allNormalized, queryClient],
  )

  const escalateMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.post('/notifications/escalate', { item_ids: ids }),
    onSuccess: () => {
      toast.success('Items escalated successfully')
      void queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      setSelectedIds(new Set())
    },
    onError: () => {
      toast.error('Failed to escalate items')
    },
  })

  const bulkSnooze = useCallback(
    (ids: string[]) => {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      setSnoozedIds(prev => {
        const next = new Map(prev)
        for (const id of ids) {
          next.set(id, until)
        }
        return next
      })
      toast.success(`${ids.length} item(s) snoozed for 24 hours`)
      setSelectedIds(new Set())
    },
    [],
  )

  const bulkEscalate = useCallback(
    (ids: string[]) => {
      escalateMutation.mutate(ids)
    },
    [escalateMutation],
  )

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const clearSelected = useCallback(() => {
    setSelectedIds(new Set())
    setFocusedId(null)
  }, [])

  // ── Keyboard navigation ──────────────────────────────────────────────────

  const visibleItemsRef = useRef<OperationalQueueItem[]>([])
  visibleItemsRef.current = prioritizedItems

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in an input
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const items = visibleItemsRef.current
      const currentIndex = focusedId ? items.findIndex(i => i.id === focusedId) : -1

      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, items.length - 1)
          if (items[nextIndex]) setFocusedId(items[nextIndex].id)
          break
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault()
          const prevIndex = Math.max(currentIndex - 1, 0)
          if (items[prevIndex]) setFocusedId(items[prevIndex].id)
          break
        }
        case 'a': {
          if (focusedId) {
            e.preventDefault()
            bulkApprove([focusedId])
          }
          break
        }
        case 'r': {
          if (focusedId) {
            e.preventDefault()
            bulkReject([focusedId])
          }
          break
        }
        case 's': {
          if (focusedId) {
            e.preventDefault()
            bulkSnooze([focusedId])
          }
          break
        }
        case 'e': {
          if (focusedId) {
            e.preventDefault()
            bulkEscalate([focusedId])
          }
          break
        }
        case ' ': {
          if (focusedId) {
            e.preventDefault()
            toggleSelected(focusedId)
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          clearSelected()
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [focusedId, bulkApprove, bulkReject, bulkSnooze, bulkEscalate, toggleSelected, clearSelected])

  return {
    items: prioritizedItems,
    sections,
    groups,
    recommendations,
    sla,
    mission,
    mode,
    setMode,
    refresh,
    isLoading,
    bulkApprove,
    bulkReject,
    bulkSnooze,
    bulkEscalate,
    focusedId,
    setFocusedId,
    selectedIds,
    toggleSelected,
    clearSelected,
  }
}
