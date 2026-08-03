/**
 * BulkActionPanel.tsx — Bulk action queue with execution, progress and undo integration (Phase UX-5)
 */

import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import type { BulkActionItem, BulkActionResult } from '@/lib/intelligence/types'

export interface BulkActionPanelProps {
  actions:     BulkActionItem[]
  onComplete?: (results: BulkActionResult[]) => void
  compact?:    boolean
}

interface ExecuteResponse {
  success:     boolean
  count?:      number
  failed_ids?: string[]
}

export function BulkActionPanel({ actions, onComplete, compact = false }: BulkActionPanelProps) {
  const [executing, setExecuting]               = useState(false)
  const [results, setResults]                   = useState<BulkActionResult[]>([])
  const [confirmingAction, setConfirmingAction] = useState<BulkActionItem | null>(null)
  const [selectedIds, setSelectedIds]           = useState<Set<string>>(
    () => new Set(actions.map(a => a.id)),
  )
  const [expanded, setExpanded] = useState(false)

  const executeMutation = useMutation({
    mutationFn: (action: BulkActionItem) =>
      api.post<ExecuteResponse>(action.endpoint, action.body),
    onSuccess: (data, action) => {
      const result: BulkActionResult = {
        actionId:     action.id,
        actionType:   action.type,
        label:        action.label,
        successCount: data?.count ?? action.targetEntityIds.length,
        failureCount: data?.failed_ids?.length ?? 0,
        failedIds:    data?.failed_ids ?? [],
        executedAt:   new Date().toISOString(),
      }
      setResults(prev => {
        const updated = [...prev, result]
        onComplete?.(updated)
        return updated
      })
      toast.success(`${action.label}: ${result.successCount} records updated`)
    },
    onError: (_err, action) => {
      toast.error(`${action.label} failed — no changes made`)
    },
  })

  const handleExecute = useCallback(
    async (action: BulkActionItem) => {
      if (action.requiresConfirmation) {
        setConfirmingAction(action)
      } else {
        await executeMutation.mutateAsync(action)
      }
    },
    [executeMutation],
  )

  const handleConfirmExecute = useCallback(async () => {
    if (!confirmingAction) return
    const action = confirmingAction
    setConfirmingAction(null)
    await executeMutation.mutateAsync(action)
  }, [confirmingAction, executeMutation])

  const handleExecuteSelected = useCallback(async () => {
    const toExecute = actions.filter(a => selectedIds.has(a.id))
    if (toExecute.length === 0) return
    setExecuting(true)
    try {
      for (const action of toExecute) {
        if (action.requiresConfirmation) {
          // Skip actions that need confirmation in bulk run
          toast(`"${action.label}" requires manual confirmation — skipped`)
          continue
        }
        // mutateAsync rejects on failure even though onError already shows a
        // toast — without this catch, one failed action in the batch would
        // abort the loop (skipping every remaining selected action) and
        // leave the button permanently disabled, since the finally below
        // would never run without it either.
        try {
          await executeMutation.mutateAsync(action)
        } catch {
          // onError already surfaced the failure toast — continue the batch
        }
      }
    } finally {
      setExecuting(false)
    }
  }, [actions, selectedIds, executeMutation])

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

  const executedIds = new Set(results.map(r => r.actionId))
  const pendingActions = actions.filter(a => !executedIds.has(a.id))

  // ── Compact mode ─────────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Badge variant="outline" className="text-[10px]">
            {pendingActions.length} actions pending
          </Badge>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="space-y-2">
            {pendingActions.map(action => (
              <ActionItem
                key={action.id}
                action={action}
                selected={selectedIds.has(action.id)}
                onToggle={toggleSelected}
                onExecute={handleExecute}
                isPending={executeMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Full mode ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Action Queue</span>
            {pendingActions.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {pendingActions.length}
              </Badge>
            )}
          </div>
          {pendingActions.length > 0 && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleExecuteSelected}
              disabled={executing || executeMutation.isPending || selectedIds.size === 0}
            >
              {executing && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Execute Selected ({selectedIds.size})
            </Button>
          )}
        </div>

        {/* Action list */}
        {pendingActions.length > 0 ? (
          <div className="space-y-2">
            {pendingActions.map(action => (
              <ActionItem
                key={action.id}
                action={action}
                selected={selectedIds.has(action.id)}
                onToggle={toggleSelected}
                onExecute={handleExecute}
                isPending={executeMutation.isPending}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-3 text-center">
            All queued actions have been executed.
          </p>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Completed
            </p>
            {results.map(result => (
              <ResultRow key={result.actionId} result={result} />
            ))}
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmingAction !== null} onOpenChange={open => !open && setConfirmingAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
          </DialogHeader>
          {confirmingAction && (
            <div className="space-y-2 py-1">
              <p className="text-sm font-medium text-foreground">{confirmingAction.label}</p>
              <p className="text-xs text-muted-foreground">{confirmingAction.description}</p>
              <p className="text-xs text-muted-foreground">
                This will affect{' '}
                <span className="font-semibold text-foreground">
                  {confirmingAction.targetEntityIds.length} records
                </span>
                .
              </p>
              {!confirmingAction.isReversible && (
                <p className="text-xs text-destructive font-medium">
                  This action cannot be undone.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmingAction(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmExecute} disabled={executeMutation.isPending}>
              {executeMutation.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ActionItemProps {
  action:    BulkActionItem
  selected:  boolean
  onToggle:  (id: string) => void
  onExecute: (action: BulkActionItem) => void
  isPending: boolean
}

function ActionItem({ action, selected, onToggle, onExecute, isPending }: ActionItemProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border p-3',
        selected && 'border-primary/30 bg-primary/[0.03]',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(action.id)}
        className="mt-0.5 cursor-pointer"
        aria-label={`Select action: ${action.label}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground truncate">{action.label}</p>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {action.targetEntityIds.length} records
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{action.description}</p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {action.estimatedImpact.complianceRisk && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">
              Compliance: {action.estimatedImpact.complianceRisk}
            </span>
          )}
          {action.isReversible && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              Reversible
            </span>
          )}
          {action.requiresConfirmation && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Needs confirm
            </span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs flex-shrink-0"
        onClick={() => onExecute(action)}
        disabled={isPending}
      >
        Execute
      </Button>
    </div>
  )
}

interface ResultRowProps {
  result: BulkActionResult
}

function ResultRow({ result }: ResultRowProps) {
  const hasFailures = result.failureCount > 0

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
      {hasFailures ? (
        <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
      )}
      <span className="text-xs text-foreground truncate flex-1">{result.label}</span>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
        {result.successCount} ok
        {hasFailures && `, ${result.failureCount} failed`}
      </span>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {new Date(result.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}
