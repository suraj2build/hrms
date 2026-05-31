/**
 * useUndoLayer.ts — Undo stack for executed bulk actions (Phase UX-5)
 * Persists to localStorage. Provides a 10-minute undo window.
 */

import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import type { BulkActionResult, UndoEntry } from '@/lib/intelligence/types'

const STORAGE_KEY   = 'ux5_undo_history'
const UNDO_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export interface UseUndoLayerReturn {
  undoHistory:   UndoEntry[]
  addUndo:       (result: BulkActionResult) => void
  executeUndo:   (entry: UndoEntry) => Promise<void>
  dismissUndo:   (id: string) => void
  activeEntries: UndoEntry[]
}

function loadFromStorage(): UndoEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as UndoEntry[]
  } catch {
    return []
  }
}

function saveToStorage(entries: UndoEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage might be unavailable — fail silently
  }
}

export function useUndoLayer(): UseUndoLayerReturn {
  const queryClient = useQueryClient()
  const [history, setHistory] = useState<UndoEntry[]>(() => loadFromStorage())

  // Persist on every change
  useEffect(() => {
    saveToStorage(history)
  }, [history])

  // Clean expired entries every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHistory(prev => {
        const filtered = prev.filter(e => new Date(e.expiresAt) > new Date())
        return filtered.length !== prev.length ? filtered : prev
      })
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  const addUndo = useCallback((result: BulkActionResult) => {
    // Only offer undo when there are no partial failures
    if (result.failureCount !== 0) return

    const entry: UndoEntry = {
      id:            result.actionId,
      label:         result.label,
      executedAt:    result.executedAt,
      undoEndpoint:  result.undoEndpoint,
      undoBody:      result.undoBody,
      isReversible:  result.undoEndpoint !== undefined,
      affectedCount: result.successCount,
      expiresAt:     new Date(Date.now() + UNDO_WINDOW_MS).toISOString(),
    }

    setHistory(prev => {
      // Replace if the same actionId already exists
      const without = prev.filter(e => e.id !== entry.id)
      return [entry, ...without]
    })
  }, [])

  const executeUndo = useCallback(async (entry: UndoEntry) => {
    if (!entry.isReversible || !entry.undoEndpoint) return

    try {
      await api.post(entry.undoEndpoint, entry.undoBody ?? {})
      setHistory(prev => prev.filter(e => e.id !== entry.id))
      queryClient.invalidateQueries({ queryKey: ['activity-stream'] })
      toast.success(`Undone: ${entry.label}`)
    } catch {
      toast.error(`Failed to undo "${entry.label}"`)
    }
  }, [queryClient])

  const dismissUndo = useCallback((id: string) => {
    setHistory(prev => prev.filter(e => e.id !== id))
  }, [])

  const activeEntries = history.filter(e => new Date(e.expiresAt) > new Date())

  return { undoHistory: history, addUndo, executeUndo, dismissUndo, activeEntries }
}
