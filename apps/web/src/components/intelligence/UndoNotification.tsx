/**
 * UndoNotification.tsx — Fixed-position bottom notification strip for undo actions (Phase UX-5)
 */

import { useState, useEffect } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UndoEntry } from '@/lib/intelligence/types'

export interface UndoNotificationProps {
  entries:   UndoEntry[]
  onUndo:    (entry: UndoEntry) => Promise<void>
  onDismiss: (id: string) => void
}

interface CountdownCardProps {
  entry:     UndoEntry
  onUndo:    (entry: UndoEntry) => Promise<void>
  onDismiss: (id: string) => void
}

function formatSeconds(secs: number): string {
  if (secs <= 0) return '0s'
  if (secs > 60) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m ${s}s`
  }
  return `${secs}s`
}

function CountdownCard({ entry, onUndo, onDismiss }: CountdownCardProps) {
  const [seconds, setSeconds] = useState<number>(() =>
    Math.max(0, Math.round((new Date(entry.expiresAt).getTime() - Date.now()) / 1000)),
  )

  useEffect(() => {
    if (seconds <= 0) {
      onDismiss(entry.id)
      return
    }

    const interval = setInterval(() => {
      setSeconds(prev => {
        const next = prev - 1
        if (next <= 0) {
          clearInterval(interval)
          onDismiss(entry.id)
          return 0
        }
        return next
      })
    }, 1000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally only run once on mount

  if (seconds <= 0) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card shadow-lg px-3 py-2.5">
      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{entry.label}</p>
        <p className="text-[10px] text-muted-foreground">
          {entry.affectedCount} records · expires in {formatSeconds(seconds)}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-xs flex-shrink-0"
        onClick={() => onUndo(entry)}
      >
        Undo
      </Button>
      <button
        className="text-muted-foreground/50 hover:text-muted-foreground p-0.5"
        onClick={() => onDismiss(entry.id)}
        aria-label="Dismiss undo notification"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function UndoNotification({ entries, onUndo, onDismiss }: UndoNotificationProps) {
  if (entries.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {entries.map(entry => (
        <CountdownCard
          key={entry.id}
          entry={entry}
          onUndo={onUndo}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  )
}
