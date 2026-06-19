/**
 * ManagerRegularisationQueue — /admin/attendance/regularisation
 *
 * Dual-role view:
 *   HR Admin / Super Admin → GET /attendance/regularisation/pending (all tenant)
 *   Manager                → GET /attendance/regularisation/team    (direct reports only)
 *
 * Features:
 *   · Bulk select + approve / reject
 *   · Period countdown banner
 *   · SLA breach indicators
 *   · Reject dialog with reason
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckSquare, XSquare, Clock, AlertTriangle,
  Loader2,
  CheckCircle2, XCircle, Search,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { cn }            from '@/lib/utils'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { toast }         from 'sonner'
import { RegularisationPolicyCard } from './RegularisationPolicyCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegItem {
  id:                  string
  date:                string
  regularization_type: string | null
  reason:              string
  status:              string
  sla_deadline:        string | null
  sla_breached:        boolean
  hours_remaining:     number | null
  created_at:          string
  employee_id:         string | null
  employee_name:       string | null
  employee_code:       string | null
}

interface BulkResult {
  approved?: number
  rejected?: number
  summary?: { approved?: number; rejected?: number }
}

const TYPE_LABELS: Record<string, string> = {
  missed_punch:    'Missed Punch',
  forgot_checkout: 'Forgot Checkout',
  onsite_duty:     'Onsite Duty',
  biometric_issue: 'Biometric Issue',
  client_visit:    'Client Visit',
  wfh:             'WFH',
  field_work:      'Field Work',
  system_issue:    'System Issue',
  check_in:        'Check-In',
  check_out:       'Check-Out',
  both:            'Both Punches',
  absence:         'Absence',
  other:           'Other',
}

function fmtDate(s: string) {
  const d = new Date(s + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const W = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  if (isNaN(d.getTime())) return '—'
  return `${W[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

// ── ManagerRegularisationQueue ─────────────────────────────────────────────────

export default function ManagerRegularisationQueue() {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()
  const isHrAdmin   = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [rejectOpen,   setRejectOpen]   = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [search,       setSearch]       = useState('')

  // ── Data ──────────────────────────────────────────────────────────────────────
  const endpoint = isHrAdmin
    ? '/attendance/regularisation/pending'
    : '/attendance/regularisation/team'

  const { data, isLoading, error } = useQuery<RegItem[] | { data: RegItem[] }>({
    queryKey: ['reg-queue', isHrAdmin],
    queryFn:  () => api.get(endpoint),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const items: RegItem[] = useMemo(() => {
    if (!data) return []
    if (Array.isArray(data)) return data
    if (Array.isArray(data.data)) return data.data
    return []
  }, [data])

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(r =>
      r.employee_name?.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      r.reason?.toLowerCase().includes(q) ||
      r.date?.includes(q)
    )
  }, [items, search])

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reg-queue'] })
    qc.invalidateQueries({ queryKey: ['reg-pending'] })
  }

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<BulkResult>('/attendance/regularisation/bulk-approve', { ids }),
    onSuccess: (res) => {
      const s = res?.summary ?? res
      toast.success(`Approved ${s?.approved ?? selected.size} request${(s?.approved ?? 0) !== 1 ? 's' : ''}`)
      setSelected(new Set())
      invalidate()
    },
    onError: () => toast.error('Bulk approve failed'),
  })

  const bulkRejectMutation = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      api.post<BulkResult>('/attendance/regularisation/bulk-reject', { ids, rejection_reason: reason || undefined }),
    onSuccess: (res) => {
      const s = res?.summary ?? res
      toast.success(`Rejected ${s?.rejected ?? selected.size} request${(s?.rejected ?? 0) !== 1 ? 's' : ''}`)
      setSelected(new Set())
      setRejectOpen(false)
      setRejectReason('')
      invalidate()
    },
    onError: () => toast.error('Bulk reject failed'),
  })

  const singleApproveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: () => { toast.success('Approved'); invalidate() },
    onError:   () => toast.error('Approve failed'),
  })

  const singleRejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/attendance/regularisation/${id}/reject`, { rejection_reason: reason || undefined }),
    onSuccess: () => { toast.success('Rejected'); invalidate() },
    onError:   () => toast.error('Reject failed'),
  })

  // ── Selection helpers ─────────────────────────────────────────────────────────
  const allSelected  = filtered.length > 0 && filtered.every(r => selected.has(r.id))
  const someSelected = filtered.some(r => selected.has(r.id))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(r => r.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedIds = [...selected]

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {isHrAdmin ? 'All Regularisation Requests' : 'Team Regularisation Queue'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isHrAdmin
              ? 'Pending attendance corrections across the organisation'
              : 'Pending corrections from your direct reports'}
          </p>
        </div>

        {/* Bulk action strip — shown only when rows selected */}
        {someSelected && (
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2">
            <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-success border-success/30 hover:bg-success/5"
              disabled={bulkApproveMutation.isPending}
              onClick={() => bulkApproveMutation.mutate(selectedIds)}
            >
              {bulkApproveMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <CheckSquare className="h-3 w-3 mr-1" />
              }
              Approve All
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => setRejectOpen(true)}
            >
              <XSquare className="h-3 w-3 mr-1" />
              Reject All
            </Button>
          </div>
        )}
      </div>

      {/* ── Regularisation policy (HR admin only) ───────────────── */}
      {isHrAdmin && (
        <div className="mb-4">
          <RegularisationPolicyCard />
        </div>
      )}

      {/* ── Search bar ──────────────────────────────────────────── */}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-8 text-sm"
          placeholder="Search name, code, date…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-card shadow-card overflow-hidden">

        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
          <input
            type="checkbox"
            className="rounded"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = !allSelected && someSelected }}
            onChange={toggleAll}
          />
          <span className="flex-1">Employee</span>
          <span className="w-24">Date</span>
          <span className="w-32 hidden md:block">Type</span>
          <span className="w-48 hidden lg:block">Reason</span>
          <span className="w-20">SLA</span>
          <span className="w-28 text-right">Actions</span>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading requests…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center justify-center py-12 gap-2 text-destructive/70">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">Failed to load — please refresh</span>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <CheckCircle2 className="h-10 w-10 text-success/40" />
            <p className="text-sm font-medium text-muted-foreground">
              {search ? 'No results match your search' : 'No pending regularisations — all clear!'}
            </p>
          </div>
        )}

        {/* Rows */}
        {filtered.map(row => {
          const isChecked = selected.has(row.id)
          const isSlaBreached = row.sla_breached || (row.hours_remaining != null && row.hours_remaining < 0)
          const isSlaUrgent   = !isSlaBreached && row.hours_remaining != null && row.hours_remaining < 12

          return (
            <div
              key={row.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors',
                isChecked ? 'bg-primary/[0.04]' : 'hover:bg-muted/30',
              )}
            >
              <input
                type="checkbox"
                className="rounded"
                checked={isChecked}
                onChange={() => toggleOne(row.id)}
              />

              {/* Employee */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {row.employee_name ?? '—'}
                </p>
                <p className="text-[10.5px] text-muted-foreground">{row.employee_code}</p>
              </div>

              {/* Date */}
              <div className="w-24 shrink-0">
                <p className="text-[11.5px] font-medium text-foreground">{fmtDate(row.date)}</p>
              </div>

              {/* Type */}
              <div className="w-32 shrink-0 hidden md:block">
                <Badge variant="secondary" className="text-[10px] font-medium capitalize">
                  {TYPE_LABELS[row.regularization_type ?? ''] ?? row.regularization_type ?? 'General'}
                </Badge>
              </div>

              {/* Reason */}
              <div className="w-48 shrink-0 hidden lg:block">
                <p className="text-[11.5px] text-muted-foreground truncate" title={row.reason}>
                  {row.reason}
                </p>
              </div>

              {/* SLA */}
              <div className="w-20 shrink-0">
                {isSlaBreached ? (
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-destructive bg-destructive/8 rounded-full px-2 py-0.5">
                    <AlertTriangle className="h-2.5 w-2.5" /> BREACHED
                  </span>
                ) : isSlaUrgent ? (
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-warning bg-warning/8 rounded-full px-2 py-0.5">
                    <Clock className="h-2.5 w-2.5" /> {row.hours_remaining}h
                  </span>
                ) : (
                  <span className="text-[10.5px] text-muted-foreground">
                    {row.hours_remaining != null ? `${row.hours_remaining}h` : '—'}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="w-28 shrink-0 flex items-center justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px] text-success hover:bg-success/8 hover:text-success"
                  disabled={singleApproveMutation.isPending}
                  onClick={() => singleApproveMutation.mutate(row.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/8 hover:text-destructive"
                  disabled={singleRejectMutation.isPending}
                  onClick={() => singleRejectMutation.mutate({ id: row.id, reason: '' })}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )
        })}

        {/* Footer summary */}
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-2.5 bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{filtered.length} request{filtered.length !== 1 ? 's' : ''} pending</span>
            {selected.size > 0 && <span>{selected.size} selected</span>}
          </div>
        )}
      </div>

      {/* ── Bulk Reject Dialog ───────────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject {selected.size} Request{selected.size !== 1 ? 's' : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Optionally provide a reason. Employees will be notified.
            </p>
            <textarea
              className="w-full rounded-lg border border-border bg-background p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              rows={3}
              placeholder="Rejection reason (optional)…"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkRejectMutation.isPending}
              onClick={() => bulkRejectMutation.mutate({ ids: selectedIds, reason: rejectReason })}
            >
              {bulkRejectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Reject All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
