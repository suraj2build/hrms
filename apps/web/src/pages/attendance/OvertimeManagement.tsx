/**
 * OvertimeManagement — /admin/overtime
 *
 * Admin page for managing overtime policies, employee assignments,
 * and reviewing/approving OT requests.
 *
 * Tabs:
 *  1. Requests    — pending + recent OT requests with approve/reject
 *  2. Policies    — create/edit/delete OT policies
 *  3. Assignments — assign policies to employees
 */

import { useState }           from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Clock, CheckCircle2, XCircle, ShieldAlert,
  Plus, Pencil, Trash2, ChevronDown, ChevronUp,
  Settings, Users, Loader2, RefreshCw,
} from 'lucide-react'

import { PageContainer }   from '@/components/layout/PageContainer'
import { PageHeader }      from '@/components/layout/PageHeader'
import { SectionCard }     from '@/components/layout/SectionCard'
import { Badge }           from '@/components/ui/badge'
import { Button }          from '@/components/ui/button'
import { Input }           from '@/components/ui/input'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { api }             from '@/lib/api/client'
import { useAuthStore }    from '@/stores/authStore'
import { cn }              from '@/lib/utils'
import { toast }           from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type OtStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED'
type CalcMode = 'threshold' | 'shift_end' | 'fixed_rate'
type RateType = 'flat' | 'multiplier'

interface OtPolicy {
  id:                     string
  name:                   string
  description:            string | null
  calculation_mode:       CalcMode
  ot_start_after_minutes: number
  daily_ot_cap_minutes:   number | null
  weekly_ot_cap_minutes:  number | null
  monthly_ot_cap_minutes: number | null
  requires_approval:      boolean
  auto_approve_below_min: number | null
  rate_type:              RateType
  extra_rate:             number
  weekend_rate:           number | null
  holiday_rate:           number | null
  rounding_minutes:       number
  is_default:             boolean
  is_active:              boolean
}

interface OtRequest {
  id:               string
  employee_id:      string
  attendance_date:  string
  raw_ot_minutes:   number
  requested_minutes:number
  approved_minutes: number | null
  status:           OtStatus
  notes:            string | null
  created_at:       string
  employee_name:    string | null
  employee_code:    string | null
}

interface PolicyFormState {
  name:                     string
  description:              string
  calculation_mode:         CalcMode
  ot_start_after_minutes:   string
  daily_ot_cap_minutes:     string
  requires_approval:        boolean
  auto_approve_below_min:   string
  rate_type:                RateType
  extra_rate:               string
  weekend_rate:             string
  holiday_rate:             string
  rounding_minutes:         string
  is_default:               boolean
}

const DEFAULT_POLICY_FORM: PolicyFormState = {
  name:                   '',
  description:            '',
  calculation_mode:       'threshold',
  ot_start_after_minutes: '30',
  daily_ot_cap_minutes:   '240',
  requires_approval:      true,
  auto_approve_below_min: '',
  rate_type:              'multiplier',
  extra_rate:             '1.5',
  weekend_rate:           '2',
  holiday_rate:           '2',
  rounding_minutes:       '15',
  is_default:             false,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<OtStatus, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  PENDING:      'warning',
  APPROVED:     'success',
  REJECTED:     'destructive',
  AUTO_APPROVED:'success',
}

const STATUS_LABEL: Record<OtStatus, string> = {
  PENDING:      'Pending',
  APPROVED:     'Approved',
  REJECTED:     'Rejected',
  AUTO_APPROVED:'Auto-Approved',
}

function fmtMin(min: number | null): string {
  if (min === null || min === undefined) return '—'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmt(d: string) {
  const s = d
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

// ── Policy Dialog ─────────────────────────────────────────────────────────────

function PolicyDialog({
  open, onClose, editing,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  editing: OtPolicy | null
  onSaved: () => void
}) {
  const [form, setForm] = useState<PolicyFormState>(() =>
    editing ? {
      name:                   editing.name,
      description:            editing.description ?? '',
      calculation_mode:       editing.calculation_mode,
      ot_start_after_minutes: String(editing.ot_start_after_minutes),
      daily_ot_cap_minutes:   String(editing.daily_ot_cap_minutes ?? ''),
      requires_approval:      editing.requires_approval,
      auto_approve_below_min: String(editing.auto_approve_below_min ?? ''),
      rate_type:              editing.rate_type,
      extra_rate:             String(editing.extra_rate),
      weekend_rate:           String(editing.weekend_rate ?? ''),
      holiday_rate:           String(editing.holiday_rate ?? ''),
      rounding_minutes:       String(editing.rounding_minutes),
      is_default:             editing.is_default,
    } : { ...DEFAULT_POLICY_FORM }
  )
  const [err, setErr] = useState('')

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.put(`/overtime/policies/${editing.id}`, body)
        : api.post('/overtime/policies', body),
    onSuccess: () => {
      toast.success(editing ? 'OT policy updated' : 'OT policy created')
      onSaved()
      onClose()
    },
    onError: (e: Error) => {
      setErr(e.message)
      toast.error('Failed to save OT policy', { description: e.message })
    },
  })

  function handleSave() {
    setErr('')
    if (!form.name.trim()) { setErr('Name is required'); return }
    const body: Record<string, unknown> = {
      name:                   form.name.trim(),
      description:            form.description.trim() || null,
      calculation_mode:       form.calculation_mode,
      ot_start_after_minutes: parseInt(form.ot_start_after_minutes) || 30,
      daily_ot_cap_minutes:   form.daily_ot_cap_minutes ? parseInt(form.daily_ot_cap_minutes) : null,
      requires_approval:      form.requires_approval,
      auto_approve_below_min: form.auto_approve_below_min ? parseInt(form.auto_approve_below_min) : null,
      rate_type:              form.rate_type,
      extra_rate:             parseFloat(form.extra_rate) || 1.5,
      weekend_rate:           form.weekend_rate ? parseFloat(form.weekend_rate) : null,
      holiday_rate:           form.holiday_rate ? parseFloat(form.holiday_rate) : null,
      rounding_minutes:       parseInt(form.rounding_minutes) || 15,
      is_default:             form.is_default,
    }
    saveMutation.mutate(body)
  }

  const f = (k: keyof PolicyFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))
  const fb = (k: keyof PolicyFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.checked }))

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit OT Policy' : 'New OT Policy'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          {/* Name */}
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Policy Name *</label>
            <Input value={form.name} onChange={f('name')} placeholder="e.g. Factory Standard OT" className="h-8 text-xs" />
          </div>

          {/* Calc mode */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Calculation Mode</label>
            <select value={form.calculation_mode} onChange={f('calculation_mode')}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50">
              <option value="threshold">Threshold (after N minutes)</option>
              <option value="shift_end">From Shift End</option>
              <option value="fixed_rate">Fixed Rate (all hours)</option>
            </select>
          </div>

          {/* OT starts after */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">OT Starts After (minutes)</label>
            <Input type="number" min={0} value={form.ot_start_after_minutes} onChange={f('ot_start_after_minutes')} className="h-8 text-xs" />
          </div>

          {/* Daily cap */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Daily OT Cap (minutes, blank=no cap)</label>
            <Input type="number" min={0} value={form.daily_ot_cap_minutes} onChange={f('daily_ot_cap_minutes')} placeholder="240" className="h-8 text-xs" />
          </div>

          {/* Rounding */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Round to Nearest (minutes)</label>
            <Input type="number" min={1} value={form.rounding_minutes} onChange={f('rounding_minutes')} className="h-8 text-xs" />
          </div>

          {/* Rate type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Rate Type</label>
            <select value={form.rate_type} onChange={f('rate_type')}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50">
              <option value="multiplier">Multiplier (e.g. 1.5x)</option>
              <option value="flat">Flat (₹/hour)</option>
            </select>
          </div>

          {/* Extra rate */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Extra Rate ({form.rate_type === 'multiplier' ? 'multiplier' : '₹/hour'})
            </label>
            <Input type="number" step={0.25} min={1} value={form.extra_rate} onChange={f('extra_rate')} className="h-8 text-xs" />
          </div>

          {/* Weekend rate */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Weekend Rate (blank=use extra rate)</label>
            <Input type="number" step={0.25} min={1} value={form.weekend_rate} onChange={f('weekend_rate')} placeholder="2" className="h-8 text-xs" />
          </div>

          {/* Holiday rate */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Holiday Rate (blank=use extra rate)</label>
            <Input type="number" step={0.25} min={1} value={form.holiday_rate} onChange={f('holiday_rate')} placeholder="2" className="h-8 text-xs" />
          </div>

          {/* Approval settings */}
          <div className="col-span-2 flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.requires_approval} onChange={fb('requires_approval')} className="rounded" />
              Requires Approval
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.is_default} onChange={fb('is_default')} className="rounded" />
              Set as Tenant Default
            </label>
          </div>

          {form.requires_approval && (
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Auto-Approve Below (minutes, blank=never auto)</label>
              <Input type="number" min={0} value={form.auto_approve_below_min} onChange={f('auto_approve_below_min')} placeholder="30" className="h-8 text-xs" />
            </div>
          )}
        </div>

        {err && <p className="text-xs text-destructive mt-1">{err}</p>}

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            {editing ? 'Save Changes' : 'Create Policy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Requests Tab ──────────────────────────────────────────────────────────────

function RequestsTab() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<OtStatus | ''>('')
  const [actionRowId, setActionRowId]   = useState<string | null>(null)
  const [approveMinutes, setApproveMinutes] = useState<Record<string, string>>({})

  const { data, isLoading, refetch } = useQuery<{ data: OtRequest[]; total: number }>({
    queryKey: ['ot-requests', statusFilter],
    queryFn:  () => api.get(`/overtime/requests${statusFilter ? `?status=${statusFilter}` : ''}`),
    staleTime: 30_000,
  })
  const requests = data?.data ?? []

  const approveMutation = useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes?: number }) =>
      api.post(`/overtime/requests/${id}/approve`, minutes ? { approved_minutes: minutes } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ot-requests'] })
      setActionRowId(null)
      toast.success('Overtime request approved')
    },
    onError: (e: Error) => {
      setActionRowId(null)
      toast.error('Approval failed', { description: e.message })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/overtime/requests/${id}/reject`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ot-requests'] })
      setActionRowId(null)
      toast.success('Overtime request rejected')
    },
    onError: (e: Error) => {
      setActionRowId(null)
      toast.error('Rejection failed', { description: e.message })
    },
  })

  const pendingCount  = requests.filter(r => r.status === 'PENDING').length
  const approvedToday = requests.filter(r => r.status === 'APPROVED' || r.status === 'AUTO_APPROVED')
    .reduce((s, r) => s + (r.approved_minutes ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pending Approval', value: pendingCount, cls: 'text-warning' },
          { label: 'Approved (hours)', value: fmtMin(approvedToday), cls: 'text-success' },
          { label: 'Total Requests',   value: data?.total ?? 0, cls: 'text-info' },
        ].map(({ label, value, cls }) => (
          <SectionCard key={label}>
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className={cn('text-2xl font-bold', cls)}>{value}</p>
          </SectionCard>
        ))}
      </div>

      <SectionCard
        title="Overtime Requests"
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as OtStatus | '')}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none">
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="AUTO_APPROVED">Auto-Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Clock className="h-10 w-10 opacity-30" />
            <p className="text-sm">No OT requests found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Employee', 'Date', 'Raw OT', 'Requested', 'Approved', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const isActing = actionRowId === req.id
                  return (
                    <tr key={req.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{req.employee_name ?? '—'}</p>
                        <p className="text-[10px] text-muted-foreground">{req.employee_code}</p>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmt(req.attendance_date)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtMin(req.raw_ot_minutes)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtMin(req.requested_minutes)}</td>
                      <td className="px-3 py-2 tabular-nums text-success">{req.approved_minutes != null ? fmtMin(req.approved_minutes) : '—'}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_VARIANT[req.status]} className="rounded-full text-[10px]">
                          {STATUS_LABEL[req.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {req.status === 'PENDING' && (
                          <div className="flex items-center gap-1.5">
                            {!isActing ? (
                              <>
                                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-success border-success/30 hover:bg-success/10 hover:text-success"
                                  onClick={() => setActionRowId(req.id)}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />Review
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-destructive"
                                  disabled={rejectMutation.isPending}
                                  onClick={() => { setActionRowId(req.id); rejectMutation.mutate(req.id) }}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder={String(req.requested_minutes)}
                                  value={approveMinutes[req.id] ?? ''}
                                  onChange={e => setApproveMinutes(p => ({ ...p, [req.id]: e.target.value }))}
                                  className="h-6 w-20 text-[10px]"
                                />
                                <span className="text-[10px] text-muted-foreground">min</span>
                                <Button size="sm" className="h-6 text-[10px] px-2"
                                  disabled={approveMutation.isPending}
                                  onClick={() => approveMutation.mutate({
                                    id: req.id,
                                    minutes: approveMinutes[req.id] ? parseInt(approveMinutes[req.id]) : undefined,
                                  })}>
                                  {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1"
                                  onClick={() => setActionRowId(null)}>✕</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Policies Tab ──────────────────────────────────────────────────────────────

function PoliciesTab() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing,    setEditing]    = useState<OtPolicy | null>(null)
  const [expanded,   setExpanded]   = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ data: OtPolicy[] }>({
    queryKey: ['ot-policies'],
    queryFn:  () => api.get('/overtime/policies'),
    staleTime: 60_000,
  })
  const policies = data?.data ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/overtime/policies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ot-policies'] })
      toast.success('OT policy deleted')
    },
    onError: (e: Error) => toast.error('Failed to delete policy', { description: e.message }),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api.post(`/overtime/policies/${id}/set-default`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ot-policies'] })
      toast.success('Default OT policy updated')
    },
    onError: (e: Error) => toast.error('Failed to set default policy', { description: e.message }),
  })

  return (
    <div className="space-y-4">
      <SectionCard
        title="OT Policies"
        icon={<Settings className="h-4 w-4 text-muted-foreground" />}
        action={
          <Button size="sm" className="h-7 text-xs gap-1.5"
            onClick={() => { setEditing(null); setDialogOpen(true) }}>
            <Plus className="h-3.5 w-3.5" />New Policy
          </Button>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : policies.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
            <Settings className="h-10 w-10 opacity-30" />
            <p className="text-sm">No OT policies yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {policies.map(p => (
              <div key={p.id} className="rounded-lg border border-border overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded(prev => prev === p.id ? null : p.id)}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{p.name}</p>
                        {p.is_default && (
                          <Badge variant="secondary" className="text-[10px] rounded-full">Default</Badge>
                        )}
                        {!p.is_active && (
                          <Badge variant="outline" className="text-[10px] rounded-full text-muted-foreground">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {p.calculation_mode} · {fmtMin(p.ot_start_after_minutes)} threshold · {p.rate_type === 'multiplier' ? `${p.extra_rate}x` : `₹${p.extra_rate}/hr`} rate
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); setEditing(p); setDialogOpen(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!p.is_default && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                        onClick={e => { e.stopPropagation(); setDefaultMutation.mutate(p.id) }}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      disabled={deleteMutation.isPending}
                      onClick={e => { e.stopPropagation(); deleteMutation.mutate(p.id) }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    {expanded === p.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {expanded === p.id && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3 grid grid-cols-3 gap-3 text-xs">
                    {[
                      { label: 'Calculation Mode',  value: p.calculation_mode },
                      { label: 'OT After',           value: fmtMin(p.ot_start_after_minutes) },
                      { label: 'Daily Cap',          value: fmtMin(p.daily_ot_cap_minutes) },
                      { label: 'Weekly Cap',         value: fmtMin(p.weekly_ot_cap_minutes) },
                      { label: 'Monthly Cap',        value: fmtMin(p.monthly_ot_cap_minutes) },
                      { label: 'Requires Approval',  value: p.requires_approval ? 'Yes' : 'No' },
                      { label: 'Auto-Approve Below', value: fmtMin(p.auto_approve_below_min) },
                      { label: 'Rate Type',          value: p.rate_type },
                      { label: 'Extra Rate',         value: p.rate_type === 'multiplier' ? `${p.extra_rate}x` : `₹${p.extra_rate}/hr` },
                      { label: 'Weekend Rate',       value: p.weekend_rate ? (p.rate_type === 'multiplier' ? `${p.weekend_rate}x` : `₹${p.weekend_rate}/hr`) : '—' },
                      { label: 'Holiday Rate',       value: p.holiday_rate ? (p.rate_type === 'multiplier' ? `${p.holiday_rate}x` : `₹${p.holiday_rate}/hr`) : '—' },
                      { label: 'Rounding',           value: `${p.rounding_minutes} min` },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                        <p className="font-medium text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <PolicyDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
        editing={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ['ot-policies'] })}
      />
    </div>
  )
}

// ── Assignments Tab ───────────────────────────────────────────────────────────

function AssignmentsTab() {
  const qc = useQueryClient()
  const [empId, setEmpId]   = useState('')
  const [applied, setApplied] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [msg, setMsg]         = useState('')

  const { data: assignments, isLoading: loadingAss } = useQuery<{ data: Array<{ id: string; employee_id: string; policy_id: string; created_at: string }> }>({
    queryKey: ['ot-assignments', applied],
    queryFn:  () => api.get(`/overtime/employee-assignments?employee_id=${applied}`),
    enabled:  !!applied,
    staleTime: 30_000,
  })

  const { data: policiesData } = useQuery<{ data: OtPolicy[] }>({
    queryKey: ['ot-policies'],
    queryFn:  () => api.get('/overtime/policies'),
    staleTime: 60_000,
  })
  const policies = policiesData?.data ?? []

  const assignMutation = useMutation({
    mutationFn: (body: { employee_id: string; policy_id: string }) =>
      api.post('/overtime/employee-assignments', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ot-assignments'] })
      setMsg('Policy assigned successfully.')
      toast.success('OT policy assigned')
    },
    onError: (e: Error) => {
      setMsg(e.message)
      toast.error('Assignment failed', { description: e.message })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (employeeId: string) => api.delete(`/overtime/employee-assignments/${employeeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ot-assignments'] })
      setMsg('Assignment removed.')
      toast.success('OT policy assignment removed')
    },
    onError: (e: Error) => toast.error('Failed to remove assignment', { description: e.message }),
  })

  return (
    <div className="space-y-4">
      <SectionCard
        title="Employee Policy Assignments"
        icon={<Users className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Employee UUID"
            value={empId}
            onChange={e => setEmpId(e.target.value)}
            className="h-8 text-xs flex-1"
          />
          <Button className="h-8 text-xs" onClick={() => { setApplied(empId); setMsg('') }}>Load</Button>
        </div>

        {applied && (
          <>
            {loadingAss ? (
              <div className="flex items-center gap-1.5 py-3 text-muted-foreground text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
              </div>
            ) : (assignments?.data ?? []).length > 0 ? (
              <div className="mb-4 p-3 rounded-lg border border-border bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Current Assignment</p>
                  <p className="text-[11px] text-muted-foreground">
                    {policies.find(p => p.id === assignments?.data[0]?.policy_id)?.name ?? 'Unknown Policy'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(applied)}>
                  Remove
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mb-4">No policy assigned (uses tenant default).</p>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Assign Policy</p>
              <div className="flex gap-2">
                <select value={policyId} onChange={e => setPolicyId(e.target.value)}
                  className="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50">
                  <option value="">Select policy…</option>
                  {policies.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (Default)' : ''}</option>
                  ))}
                </select>
                <Button size="sm" className="h-8 text-xs"
                  disabled={!policyId || assignMutation.isPending}
                  onClick={() => assignMutation.mutate({ employee_id: applied, policy_id: policyId })}>
                  {assignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Assign'}
                </Button>
              </div>
            </div>
          </>
        )}

        {msg && (
          <p className={cn('text-xs mt-3', assignMutation.isError || removeMutation.isError ? 'text-destructive' : 'text-success')}>
            {msg}
          </p>
        )}
      </SectionCard>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function OvertimeManagement() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Overtime Management" subtitle="Manage OT policies, approvals, and employee assignments" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
            <p className="text-sm text-center max-w-sm">
              Overtime management requires HR Admin or Super Admin role.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Overtime Management"
        subtitle="Configure OT policies, review requests, and manage employee assignments"
      />

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList className="h-8">
          <TabsTrigger value="requests" className="text-xs h-7 gap-1.5">
            <Clock className="h-3.5 w-3.5" />OT Requests
          </TabsTrigger>
          <TabsTrigger value="policies" className="text-xs h-7 gap-1.5">
            <Settings className="h-3.5 w-3.5" />Policies
          </TabsTrigger>
          <TabsTrigger value="assignments" className="text-xs h-7 gap-1.5">
            <Users className="h-3.5 w-3.5" />Assignments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-4 mt-0">
          <RequestsTab />
        </TabsContent>

        <TabsContent value="policies" className="space-y-4 mt-0">
          <PoliciesTab />
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4 mt-0">
          <AssignmentsTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
