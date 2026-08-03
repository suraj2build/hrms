/**
 * ManagerTeamRegularisation — P6.5
 *
 * Bulk regularisation workspace for managers. Shows pending attendance
 * correction requests from direct reports. Supports multi-select + bulk
 * approve / bulk reject.
 *
 * Backend security: bulk-approve and bulk-reject now verify direct-report
 * ownership server-side (P6.5 fix). Any unauthorized IDs return 403.
 *
 * Reuses:
 *   GET  /attendance/regularisation/team
 *   POST /attendance/regularisation/bulk-approve
 *   POST /attendance/regularisation/bulk-reject
 *   POST /attendance/regularisation/:id/approve (single)
 *   POST /attendance/regularisation/:id/reject  (single)
 */

import { useState, useRef }                      from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                                 from 'sonner'
import {
  ClipboardList, Check, X, RefreshCw, Loader2, AlertTriangle,
} from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { PromptDialog }  from '@/components/ui/ConfirmDialog'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegReq {
  id:                  string
  date:                string
  regularization_type: string | null
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  status:              string
  rejection_reason:    string | null
  sla_deadline:        string | null
  sla_breached:        boolean
  hours_remaining:     number | null
  created_at:          string
  employee_id:         string | null
  employee_name:       string | null
  employee_code:       string | null
}

interface BulkResult {
  results:  Array<{ id: string; ok: boolean; error?: string }>
  summary:  { approved?: number; rejected?: number; failed: number; total: number }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function typeLabel(t: string | null) {
  if (!t) return '—'
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerTeamRegularisation() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const qc = useQueryClient()

  const { data, isFetching, refetch } = useQuery<{ data: RegReq[]; total: number }>({
    queryKey: ['manager-team-regularisation'],
    queryFn:  () => api.get('/attendance/regularisation/team'),
    staleTime: 60_000,
  })

  const rows = data?.data ?? []

  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set())
    else setSelected(new Set(rows.map(r => r.id)))
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const bulkApproveKey = useRef(crypto.randomUUID())
  const bulkApproveMut = useMutation({
    mutationFn: (ids: string[]) => api.post('/attendance/regularisation/bulk-approve', { ids },
      { headers: { 'Idempotency-Key': bulkApproveKey.current } }) as Promise<BulkResult>,
    onSuccess:  (res: BulkResult) => {
      bulkApproveKey.current = crypto.randomUUID()
      const { approved = 0, failed, total } = res.summary
      toast.success(`Approved ${approved} of ${total}${failed > 0 ? ` · ${failed} failed` : ''}`)
      setSelected(new Set())
      // Same /attendance/regularisation/team data also backs the HR-admin
      // queue (['reg-pending']), the ESS approvals tracker
      // (['ess-approvals-corrections']), and the employee's own status page
      // (['regularization-my']) — invalidate all so they don't go stale.
      qc.invalidateQueries({ queryKey: ['manager-team-regularisation'] })
      qc.invalidateQueries({ queryKey: ['reg-pending'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      qc.invalidateQueries({ queryKey: ['regularization-my'] })
      // The manager sidebar's persistent "Approvals" badge count aggregates
      // pending regularisation (among others) under this separate key.
      qc.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Bulk approve failed'),
  })

  const bulkRejectKey = useRef(crypto.randomUUID())
  const bulkRejectMut = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason?: string }) =>
      api.post('/attendance/regularisation/bulk-reject', { ids, rejection_reason: reason || undefined },
        { headers: { 'Idempotency-Key': bulkRejectKey.current } }) as Promise<BulkResult>,
    onSuccess:  (res: BulkResult) => {
      bulkRejectKey.current = crypto.randomUUID()
      const { rejected = 0, failed, total } = res.summary
      toast.success(`Rejected ${rejected} of ${total}${failed > 0 ? ` · ${failed} failed` : ''}`)
      setSelected(new Set())
      setRejectDialogOpen(false)
      qc.invalidateQueries({ queryKey: ['manager-team-regularisation'] })
      qc.invalidateQueries({ queryKey: ['reg-pending'] })
      qc.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      qc.invalidateQueries({ queryKey: ['regularization-my'] })
      qc.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Bulk reject failed'),
  })

  const selectedIds = Array.from(selected)
  const isBusy = bulkApproveMut.isPending || bulkRejectMut.isPending

  return (
    <PageContainer>
      <PageHeader
        title="Team Regularisation"
        subtitle="Review and bulk-approve attendance correction requests from your team."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* Bulk action toolbar */}
      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === rows.length && rows.length > 0}
              onChange={toggleAll}
              className="h-4 w-4 rounded"
            />
            <span className="font-medium">
              {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
            </span>
          </label>

          {selected.size > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-success hover:bg-success/90"
                disabled={isBusy}
                onClick={() => bulkApproveMut.mutate(selectedIds)}
              >
                {bulkApproveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve {selected.size}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5"
                disabled={isBusy}
                onClick={() => setRejectDialogOpen(true)}
              >
                {bulkRejectMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Reject {selected.size}
              </Button>
            </>
          )}
        </div>
      )}

      <SectionCard>
        {isFetching && rows.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ClipboardList className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No pending regularisation requests</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 py-2 px-4" />
                  <th className="py-2 px-3">Employee</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Requested Time</th>
                  <th className="py-2 px-3">Reason</th>
                  <th className="py-2 px-3">SLA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer',
                      selected.has(r.id) && 'bg-primary/5',
                    )}
                    onClick={() => toggle(r.id)}
                  >
                    <td className="py-2.5 px-4">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        onClick={e => e.stopPropagation()}
                        className="h-4 w-4 rounded"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <p className="font-medium">{r.employee_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{r.employee_code}</p>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">{r.date}</td>
                    <td className="py-2.5 px-3">{typeLabel(r.regularization_type)}</td>
                    <td className="py-2.5 px-3 tabular-nums text-xs">
                      {r.requested_check_in && <span>In: {fmtTime(r.requested_check_in)}</span>}
                      {r.requested_check_in && r.requested_check_out && <span> · </span>}
                      {r.requested_check_out && <span>Out: {fmtTime(r.requested_check_out)}</span>}
                      {!r.requested_check_in && !r.requested_check_out && '—'}
                    </td>
                    <td className="py-2.5 px-3 max-w-[180px] truncate text-xs">{r.reason}</td>
                    <td className="py-2.5 px-3">
                      {r.sla_breached ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Breached
                        </span>
                      ) : r.hours_remaining != null ? (
                        <span className={cn('text-[11px] tabular-nums', r.hours_remaining <= 4 ? 'text-warning font-semibold' : 'text-muted-foreground')}>
                          {r.hours_remaining}h left
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Styled confirmation dialog — matches the HR-admin regularisation
          queue's (ManagerRegularisationQueue.tsx) reject flow
          (SYSCERT_AUDIT_2026-08-02.md High #19: this page previously used a
          native window.confirm() while the HR-admin queue used a styled
          dialog for the same action). */}
      <PromptDialog
        open={rejectDialogOpen}
        title={`Reject ${selected.size} Regularisation Request${selected.size !== 1 ? 's' : ''}`}
        placeholder="Rejection reason (optional)"
        onConfirm={reason => bulkRejectMut.mutate({ ids: selectedIds, reason: reason || undefined })}
        onCancel={() => setRejectDialogOpen(false)}
      />
    </PageContainer>
  )
}

export default ManagerTeamRegularisation
