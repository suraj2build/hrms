/**
 * useWorkspaceMemory — per-workspace localStorage persistence for tab state,
 * filters, column visibility, layout, and recent employees.
 *
 * Storage key: `ux3_ws_mem_${workspaceName}`
 * Writes are debounced 500 ms to avoid excessive localStorage thrashing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceMemory {
  activeTab?:         string
  filters?:           Record<string, unknown>
  columnVisibility?:  Record<string, boolean>
  recentEmployeeIds?: string[]
  layout?:            'default' | 'compact' | 'comfortable'
}

export interface UseWorkspaceMemoryReturn {
  memory:              WorkspaceMemory
  setActiveTab:        (tab: string) => void
  setFilters:          (filters: Record<string, unknown>) => void
  setColumnVisibility: (cols: Record<string, boolean>) => void
  addRecentEmployee:   (id: string) => void
  setLayout:           (layout: WorkspaceMemory['layout']) => void
  resetMemory:         () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const RECENT_MAX = 5

function storageKey(workspaceName: string): string {
  return `ux3_ws_mem_${workspaceName}`
}

function readFromStorage(workspaceName: string): WorkspaceMemory {
  try {
    const raw = localStorage.getItem(storageKey(workspaceName))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    // Return as-is — callers only read typed fields; extra keys are benign
    return parsed as WorkspaceMemory
  } catch {
    return {}
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWorkspaceMemory(workspaceName: string): UseWorkspaceMemoryReturn {
  const [memory, setMemory] = useState<WorkspaceMemory>(() =>
    readFromStorage(workspaceName),
  )

  // Re-read from storage whenever the workspace name changes
  useEffect(() => {
    setMemory(readFromStorage(workspaceName))
  }, [workspaceName])

  // ── Debounced persistence ──────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the latest not-yet-written value so an unmount mid-debounce can
  // flush it synchronously instead of just cancelling the timer and
  // silently discarding the update (e.g. the user navigates away from the
  // workspace within the 500ms window).
  const pendingRef = useRef<WorkspaceMemory | null>(null)

  const writeNow = useCallback(
    (next: WorkspaceMemory) => {
      try {
        localStorage.setItem(storageKey(workspaceName), JSON.stringify(next))
      } catch {
        // quota exceeded — silently ignore
      }
    },
    [workspaceName],
  )

  const persist = useCallback(
    (next: WorkspaceMemory) => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
      }
      pendingRef.current = next
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        pendingRef.current = null
        writeNow(next)
      }, 500)
    },
    [writeNow],
  )

  const update = useCallback(
    (patch: Partial<WorkspaceMemory>) => {
      setMemory(prev => {
        const next = { ...prev, ...patch }
        persist(next)
        return next
      })
    },
    [persist],
  )

  // ── Actions ────────────────────────────────────────────────────────────────
  const setActiveTab = useCallback(
    (tab: string) => update({ activeTab: tab }),
    [update],
  )

  const setFilters = useCallback(
    (filters: Record<string, unknown>) => update({ filters }),
    [update],
  )

  const setColumnVisibility = useCallback(
    (columnVisibility: Record<string, boolean>) => update({ columnVisibility }),
    [update],
  )

  const addRecentEmployee = useCallback(
    (id: string) => {
      setMemory(prev => {
        const existing = prev.recentEmployeeIds ?? []
        // Prepend, deduplicate, cap at RECENT_MAX
        const deduped = [id, ...existing.filter(e => e !== id)].slice(0, RECENT_MAX)
        const next = { ...prev, recentEmployeeIds: deduped }
        persist(next)
        return next
      })
    },
    [persist],
  )

  const setLayout = useCallback(
    (layout: WorkspaceMemory['layout']) => update({ layout }),
    [update],
  )

  const resetMemory = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    pendingRef.current = null
    try {
      localStorage.removeItem(storageKey(workspaceName))
    } catch {
      // silently ignore
    }
    setMemory({})
  }, [workspaceName])

  // ── Flush any pending debounced write on unmount ───────────────────────────
  // Cancelling the timer alone would silently drop the update if the user
  // navigates away within the 500ms debounce window.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        if (pendingRef.current !== null) writeNow(pendingRef.current)
      }
    },
    [writeNow],
  )

  return {
    memory,
    setActiveTab,
    setFilters,
    setColumnVisibility,
    addRecentEmployee,
    setLayout,
    resetMemory,
  }
}
