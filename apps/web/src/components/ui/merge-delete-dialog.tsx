/**
 * MergeDeleteDialog
 *
 * A reusable dialog for safe deletion of master data records.
 *
 * Flow:
 *  1. Dialog opens → fetches usage count from `usageUrl`
 *  2. If usage === 0 → shows simple "Are you sure?" confirm
 *  3. If usage > 0 → shows warning + required merge dropdown
 *     User must pick a target record before "Merge & Delete" is enabled
 *
 * Usage example:
 *   <MergeDeleteDialog
 *     open={!!deleteTarget}
 *     onOpenChange={(o) => !o && setDeleteTarget(null)}
 *     entityType="Department"
 *     entityName={deleteTarget?.name ?? ''}
 *     id={deleteTarget?.id ?? ''}
 *     usageUrl={`/departments/${deleteTarget?.id}/usage`}
 *     usageLabel="employee records"
 *     mergeOptions={departments.filter(d => d.id !== deleteTarget?.id)}
 *     onConfirm={(mergeTo) => deleteDept.mutate({ id: deleteTarget!.id, mergeTo })}
 *     isPending={deleteDept.isPending}
 *   />
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Trash2, GitMerge } from 'lucide-react'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export interface MergeOption {
  id:   string
  name: string
}

export interface MergeDeleteDialogProps {
  open:           boolean
  onOpenChange:   (open: boolean) => void
  /** Display label, e.g. "Department" */
  entityType:     string
  /** The name of the record being deleted */
  entityName:     string
  /** The UUID of the record being deleted */
  id:             string
  /** API path to fetch usage count, e.g. "/departments/123/usage" */
  usageUrl:       string
  /** Human-readable label for what uses this, e.g. "employee records" */
  usageLabel:     string
  /** List of same-type records to merge into (current id will be excluded by the caller) */
  mergeOptions:   MergeOption[]
  /** Called with undefined (plain delete) or a target UUID (merge then delete) */
  onConfirm:      (mergeTo?: string) => void
  isPending?:     boolean
}

export function MergeDeleteDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  id,
  usageUrl,
  usageLabel,
  mergeOptions,
  onConfirm,
  isPending,
}: MergeDeleteDialogProps) {
  const [mergeTo, setMergeTo] = useState<string>('')

  // Fetch usage when the dialog opens
  const { data: usageData, isLoading: usageLoading, isError: usageError } = useQuery<{ data: { total: number } }>({
    queryKey: ['usage', usageUrl],
    queryFn:  () => api.get(usageUrl),
    enabled:  open && !!id,
    staleTime: 0,
  })

  const usageCount = usageData?.data?.total ?? 0
  const hasUsage   = !usageLoading && usageCount > 0
  // A failed usage check must never be treated as "zero usage" — that would
  // silently downgrade a merge-required delete into an unguarded one for a
  // record that may actually be referenced by hundreds of rows. Block
  // confirmation entirely until the check succeeds.
  const canConfirm = !usageLoading && !usageError && (!hasUsage || !!mergeTo)

  function handleConfirm() {
    onConfirm(hasUsage && mergeTo ? mergeTo : undefined)
  }

  function handleOpenChange(o: boolean) {
    if (!o) setMergeTo('')
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Delete {entityType}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Usage loading state */}
          {usageLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking usage…
            </div>
          )}

          {/* Usage check failed — block confirmation rather than assume zero usage */}
          {usageError && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">
                Couldn't check whether {entityName} is still in use. Please close this dialog and try again.
              </p>
            </div>
          )}

          {/* No usage — simple confirm */}
          {!usageLoading && !usageError && !hasUsage && (
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground">"{entityName}"</span>?
              This action cannot be undone.
            </p>
          )}

          {/* Has usage — merge required */}
          {hasUsage && (
            <>
              <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/5 p-3">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {entityName} is used by {usageCount} {usageLabel}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    Select another {entityType.toLowerCase()} to reassign them before deleting.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <GitMerge className="h-3.5 w-3.5 text-muted-foreground" />
                  Merge into
                </label>
                <Select value={mergeTo} onValueChange={setMergeTo}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select a ${entityType.toLowerCase()}…`} />
                  </SelectTrigger>
                  <SelectContent>
                    {mergeOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm || isPending}
          >
            {isPending
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : hasUsage
                ? <GitMerge className="h-4 w-4 mr-2" />
                : <Trash2 className="h-4 w-4 mr-2" />
            }
            {hasUsage ? 'Merge & Delete' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
