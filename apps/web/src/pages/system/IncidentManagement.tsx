/**
 * IncidentManagement — /system/incidents
 *
 * Admin-only workspace for managing workforce operations incident lifecycle:
 * creation, assignment, escalation, resolution, and comment threading.
 *
 * Access: hr_admin, super_admin only.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, AlertTriangle, Clock, CheckCircle2,
  Loader2, ChevronRight, MessageSquare, UserCheck,
  ArrowUpCircle, XCircle,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import { toast }          from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type IncidentSeverity =
  | 'low' | 'medium' | 'high' | 'critical'

type IncidentStatus =
  | 'open' | 'investigating' | 'escalated' | 'mitigating'
  | 'resolved' | 'closed' | 'false_positive'

type IncidentType =
  | 'payroll_impact' | 'staffing_shortage' | 'attendance_integrity'
  | 'system_failure' | 'compliance_breach' | 'roster_conflict'
  | 'data_anomaly' | 'other'

interface IncidentSummary {
  open_count:             number
  sla_breached_count:     number
  total_this_week:        number
  avg_resolution_hours:   number
}

interface IncidentListItem {
  id:                   string
  title:                string
  description:          string
  severity:             IncidentSeverity
  status:               IncidentStatus
  incident_type:        IncidentType
  payroll_impact_amount: number | null
  created_at:           string
  assigned_to:          string | null
  assigned_to_name:     string | null
}

interface TimelineEvent {
  id:          string
  event_type:  string
  actor_name:  string
  description: string
  created_at:  string
}

interface IncidentComment {
  id:           string
  author_name:  string
  body:         string
  created_at:   string
}

interface IncidentDetail extends IncidentListItem {
  employee_id:         string | null
  employee_name:       string | null
  department:          string | null
  affected_employees:  number | null
  sla_target_hours:    number | null
  sla_breached:        boolean
  tags:                string[]
  timeline:            TimelineEvent[]
  comments:            IncidentComment[]
}

interface IncidentListResponse {
  data:  IncidentListItem[]
  total: number
}

// ── Filters ────────────────────────────────────────────────────────────────────

interface Filters {
  status:        string
  severity:      string
  incident_type: string
}

const INITIAL_FILTERS: Filters = { status: '', severity: '', incident_type: '' }

const STATUSES: IncidentStatus[] = [
  'open', 'investigating', 'escalated', 'mitigating',
  'resolved', 'closed', 'false_positive',
]

const SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical']

const INCIDENT_TYPES: IncidentType[] = [
  'payroll_impact', 'staffing_shortage', 'attendance_integrity',
  'system_failure', 'compliance_breach', 'roster_conflict',
  'data_anomaly', 'other',
]

// ── Badge helpers ──────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const SEVERITY_VARIANT: Record<IncidentSeverity, BadgeVariant> = {
  low:      'secondary',
  medium:   'warning',
  high:     'destructive',
  critical: 'destructive',
}

const SEVERITY_BORDER: Record<IncidentSeverity, string> = {
  low:      'border-l-4 border-l-blue-400',
  medium:   'border-l-4 border-l-amber-400',
  high:     'border-l-4 border-l-orange-500',
  critical: 'border-l-4 border-l-red-500',
}

const STATUS_VARIANT: Record<IncidentStatus, BadgeVariant> = {
  open:           'warning',
  investigating:  'default',
  escalated:      'destructive',
  mitigating:     'warning',
  resolved:       'success',
  closed:         'outline',
  false_positive: 'secondary',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function humanLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n)
}

// ── Summary card ───────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon: Icon, variant = 'neutral',
}: {
  label:    string
  value:    number | string
  icon:     React.ComponentType<{ className?: string }>
  variant?: 'neutral' | 'warning' | 'destructive' | 'success'
}) {
  const valueColor: Record<string, string> = {
    neutral:     'text-foreground',
    warning:     'text-warning',
    destructive: 'text-destructive',
    success:     'text-success',
  }
  const iconColor: Record<string, string> = {
    neutral:     'text-muted-foreground',
    warning:     'text-warning',
    destructive: 'text-destructive',
    success:     'text-success',
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-start justify-between">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          {label}
        </p>
        <p className={cn('text-2xl font-bold', valueColor[variant])}>{value}</p>
      </div>
      <Icon className={cn('h-5 w-5 mt-0.5', iconColor[variant])} />
    </div>
  )
}

// ── Create Incident Dialog ─────────────────────────────────────────────────────

interface CreateIncidentDialogProps {
  open:    boolean
  onClose: () => void
}

function CreateIncidentDialog({ open, onClose }: CreateIncidentDialogProps) {
  const qc = useQueryClient()

  const [form, setForm] = useState({
    incident_type:        '' as IncidentType | '',
    severity:             '' as IncidentSeverity | '',
    title:                '',
    description:          '',
    employee_id:          '',
    payroll_impact_amount: '',
    sla_target_hours:     '',
    tags:                 '',
  })

  const createMutation = useMutation<unknown, Error, typeof form>({
    mutationFn: (body) => {
      const payload: Record<string, unknown> = {
        incident_type: body.incident_type,
        severity:      body.severity,
        title:         body.title,
        description:   body.description,
      }
      if (body.employee_id)          payload.employee_id           = body.employee_id
      if (body.payroll_impact_amount) payload.payroll_impact_amount = Number(body.payroll_impact_amount)
      if (body.sla_target_hours)     payload.sla_target_hours      = Number(body.sla_target_hours)
      if (body.tags)                 payload.tags                  = body.tags.split(',').map(t => t.trim()).filter(Boolean)
      return api.post('/system/incidents', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident-list'] })
      qc.invalidateQueries({ queryKey: ['incident-summary'] })
      onClose()
      setForm({
        incident_type: '', severity: '', title: '', description: '',
        employee_id: '', payroll_impact_amount: '', sla_target_hours: '', tags: '',
      })
      toast.success('Incident created')
    },
    onError: (e: Error) => toast.error('Failed to create incident', { description: e.message }),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const valid = !!form.incident_type && !!form.severity && !!form.title && !!form.description

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Incident</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* incident_type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Incident Type *</label>
            <select
              value={form.incident_type}
              onChange={set('incident_type')}
              className="flex w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">Select type…</option>
              {INCIDENT_TYPES.map(t => (
                <option key={t} value={t}>{humanLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* severity */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Severity *</label>
            <select
              value={form.severity}
              onChange={set('severity')}
              className="flex w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">Select severity…</option>
              {SEVERITIES.map(s => (
                <option key={s} value={s}>{humanLabel(s)}</option>
              ))}
            </select>
          </div>

          {/* title */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Title *</label>
            <input
              value={form.title}
              onChange={set('title')}
              placeholder="Short descriptive title"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {/* description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description *</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={3}
              placeholder="Describe the incident in detail…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>

          {/* optional fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Employee ID (opt)</label>
              <input
                value={form.employee_id}
                onChange={set('employee_id')}
                placeholder="UUID"
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Payroll Impact (opt)</label>
              <input
                type="number"
                value={form.payroll_impact_amount}
                onChange={set('payroll_impact_amount')}
                placeholder="Amount"
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">SLA Hours (opt)</label>
              <input
                type="number"
                value={form.sla_target_hours}
                onChange={set('sla_target_hours')}
                placeholder="e.g. 24"
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Tags (opt, comma-sep)</label>
              <input
                value={form.tags}
                onChange={set('tags')}
                placeholder="payroll, q1, shift-a"
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-xs text-destructive">Failed to create incident. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!valid || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Creating…</>
                : 'Create Incident'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Escalate Dialog ────────────────────────────────────────────────────────────

function EscalateDialog({
  open, incidentId, onClose,
}: { open: boolean; incidentId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [escalateTo, setEscalateTo] = useState('')
  const [reason, setReason]         = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/system/incidents/${incidentId}/escalate`, { escalate_to: escalateTo, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      qc.invalidateQueries({ queryKey: ['incident-list'] })
      onClose()
      setEscalateTo('')
      setReason('')
      toast.success('Incident escalated')
    },
    onError: (e: Error) => toast.error('Escalation failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Escalate Incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Escalate To (Employee ID)</label>
            <input
              value={escalateTo}
              onChange={e => setEscalateTo(e.target.value)}
              placeholder="UUID"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this being escalated?"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>
          {mutation.isError && (
            <p className="text-xs text-destructive">Escalation failed. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!escalateTo || !reason || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Escalating…</>
                : 'Escalate'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Resolve Dialog ─────────────────────────────────────────────────────────────

function ResolveDialog({
  open, incidentId, onClose,
}: { open: boolean; incidentId: string; onClose: () => void }) {
  const qc              = useQueryClient()
  const [note, setNote] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/system/incidents/${incidentId}/resolve`, { resolution_note: note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      qc.invalidateQueries({ queryKey: ['incident-list'] })
      qc.invalidateQueries({ queryKey: ['incident-summary'] })
      onClose()
      setNote('')
      toast.success('Incident resolved')
    },
    onError: (e: Error) => toast.error('Failed to resolve incident', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Resolve Incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Resolution Note</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              placeholder="Describe how the incident was resolved…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>
          {mutation.isError && (
            <p className="text-xs text-destructive">Resolution failed. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!note || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Resolving…</>
                : 'Resolve'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

interface DetailPanelProps {
  incidentId: string
  onClear:    () => void
}

function DetailPanel({ incidentId, onClear }: DetailPanelProps) {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()

  const [showEscalate, setShowEscalate] = useState(false)
  const [showResolve,  setShowResolve]  = useState(false)
  const [commentBody,  setCommentBody]  = useState('')

  const { data, isLoading, isError } = useQuery<{ data: IncidentDetail }>({
    queryKey: ['incident-detail', incidentId],
    queryFn:  () => api.get(`/system/incidents/${incidentId}`),
    staleTime: 30_000,
  })

  const assignMutation = useMutation({
    mutationFn: () =>
      api.put(`/system/incidents/${incidentId}`, { assigned_to: profile?.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      qc.invalidateQueries({ queryKey: ['incident-list'] })
      toast.success('Incident assigned to you')
    },
    onError: (e: Error) => toast.error('Failed to assign incident', { description: e.message }),
  })

  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      api.post(`/system/incidents/${incidentId}/comments`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident-detail', incidentId] })
      setCommentBody('')
      toast.success('Comment posted')
    },
    onError: (e: Error) => toast.error('Failed to post comment', { description: e.message }),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (isError || !data?.data) {
    return (
      <div className="flex flex-col items-center py-12 gap-2">
        <p className="text-sm text-destructive">Failed to load incident.</p>
        <Button size="sm" variant="outline" onClick={onClear}>Close</Button>
      </div>
    )
  }

  const inc = data.data

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={SEVERITY_VARIANT[inc.severity]} className="rounded-full text-[10px] px-2 capitalize">
              {inc.severity}
            </Badge>
            <Badge variant={STATUS_VARIANT[inc.status]} className="rounded-full text-[10px] px-2 capitalize">
              {humanLabel(inc.status)}
            </Badge>
            <Badge variant="outline" className="rounded-full text-[10px] px-2">
              {humanLabel(inc.incident_type)}
            </Badge>
          </div>
          <p className="text-sm font-semibold text-foreground leading-tight">{inc.title}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed">{inc.description}</p>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {[
          { label: 'Employee',          value: inc.employee_name ?? '—' },
          { label: 'Department',        value: inc.department ?? '—' },
          {
            label: 'Payroll Impact',
            value: inc.payroll_impact_amount != null
              ? fmtCurrency(inc.payroll_impact_amount)
              : '—',
          },
          { label: 'Affected Employees', value: inc.affected_employees ?? '—' },
          { label: 'SLA Target',         value: inc.sla_target_hours ? `${inc.sla_target_hours}h` : '—' },
          { label: 'Assigned To',        value: inc.assigned_to_name ?? 'Unassigned' },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className="text-xs text-foreground mt-0.5">{value}</p>
          </div>
        ))}

        {/* SLA breached badge */}
        <div>
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">SLA Breached</p>
          <div className="mt-0.5">
            {inc.sla_breached
              ? <Badge variant="destructive" className="rounded-full text-[10px] px-2">Yes</Badge>
              : <Badge variant="success"     className="rounded-full text-[10px] px-2">No</Badge>
            }
          </div>
        </div>
      </div>

      {/* Tags */}
      {inc.tags && inc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {inc.tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Admin actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          disabled={assignMutation.isPending}
          onClick={() => assignMutation.mutate()}
        >
          {assignMutation.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <UserCheck className="h-3 w-3" />
          }
          Assign to Me
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => setShowEscalate(true)}
        >
          <ArrowUpCircle className="h-3 w-3" />
          Escalate
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setShowResolve(true)}
        >
          <CheckCircle2 className="h-3 w-3" />
          Resolve
        </Button>
      </div>

      {/* Timeline */}
      {inc.timeline && inc.timeline.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Timeline
          </p>
          <div className="space-y-0">
            {inc.timeline.map((ev, idx) => (
              <div key={ev.id} className="flex gap-3">
                {/* vertical line */}
                <div className="flex flex-col items-center">
                  <div className="h-2.5 w-2.5 rounded-full bg-primary/70 mt-1 shrink-0" />
                  {idx < inc.timeline.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1" />
                  )}
                </div>
                <div className="pb-4 min-w-0">
                  <p className="text-xs font-medium text-foreground">{humanLabel(ev.event_type)}</p>
                  <p className="text-[10px] text-muted-foreground">{ev.description}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {ev.actor_name} · {fmtDateTime(ev.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3" />
          Comments {inc.comments && inc.comments.length > 0 && `(${inc.comments.length})`}
        </p>

        {inc.comments && inc.comments.length > 0 && (
          <div className="space-y-2 mb-3">
            {inc.comments.map(c => (
              <div
                key={c.id}
                className="rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground">{c.author_name}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtDateTime(c.created_at)}</p>
                </div>
                <p className="text-xs text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <textarea
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            rows={2}
            placeholder="Add a comment…"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!commentBody.trim() || commentMutation.isPending}
            onClick={() => commentMutation.mutate(commentBody.trim())}
          >
            {commentMutation.isPending
              ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Posting…</>
              : 'Post Comment'
            }
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      <EscalateDialog
        open={showEscalate}
        incidentId={incidentId}
        onClose={() => setShowEscalate(false)}
      />
      <ResolveDialog
        open={showResolve}
        incidentId={incidentId}
        onClose={() => setShowResolve(false)}
      />
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function IncidentManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [filters,      setFilters]      = useState<Filters>(INITIAL_FILTERS)
  const [applied,      setApplied]      = useState<Filters>(INITIAL_FILTERS)
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [showCreate,   setShowCreate]   = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: summaryData, isLoading: summaryLoading } = useQuery<{ data: IncidentSummary }>({
    queryKey: ['incident-summary'],
    queryFn:  () => api.get('/system/incidents/summary'),
    staleTime: 60_000,
    enabled: isAdmin,
  })

  const { data: listData, isLoading: listLoading, isError, refetch } =
    useQuery<IncidentListResponse>({
      queryKey: ['incident-list', applied],
      queryFn:  () => {
        const params = new URLSearchParams({ limit: '50', offset: '0' })
        if (applied.status)        params.set('status',        applied.status)
        if (applied.severity)      params.set('severity',      applied.severity)
        if (applied.incident_type) params.set('incident_type', applied.incident_type)
        return api.get<IncidentListResponse>(`/system/incidents?${params}`)
      },
      staleTime: 30_000,
      enabled: isAdmin,
    })

  const summary  = summaryData?.data
  const rows     = listData?.data  ?? []
  const total    = listData?.total ?? 0

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Incident Management"
          subtitle="Workforce operations incident lifecycle and resolution"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-16 gap-2 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Access restricted</p>
            <p className="text-xs text-muted-foreground/60">
              This workspace is available to HR administrators only.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Incident Management"
        subtitle="Workforce operations incident lifecycle and resolution"
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Create Incident
          </Button>
        }
      />

      {/* ── Summary cards ── */}
      {summaryLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading summary…
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Open"
            value={summary?.open_count ?? 0}
            icon={ShieldAlert}
            variant={(summary?.open_count ?? 0) > 0 ? 'destructive' : 'neutral'}
          />
          <SummaryCard
            label="SLA Breached"
            value={summary?.sla_breached_count ?? 0}
            icon={Clock}
            variant={(summary?.sla_breached_count ?? 0) > 0 ? 'destructive' : 'neutral'}
          />
          <SummaryCard
            label="This Week"
            value={summary?.total_this_week ?? 0}
            icon={AlertTriangle}
            variant="neutral"
          />
          <SummaryCard
            label="Avg Resolution (hrs)"
            value={summary?.avg_resolution_hours != null
              ? summary.avg_resolution_hours.toFixed(1)
              : '—'
            }
            icon={CheckCircle2}
            variant="neutral"
          />
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* ── Left: incident list ── */}
        <div className="lg:col-span-2 space-y-3">
          <SectionCard
            title={`Incidents${total ? ` (${total})` : ''}`}
            icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
            noPadding
          >
            {/* Filter bar */}
            <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border">
              {/* Status */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Status</label>
                <select
                  value={filters.status}
                  onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                  className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">All Statuses</option>
                  {STATUSES.map(s => (
                    <option key={s} value={s}>{humanLabel(s)}</option>
                  ))}
                </select>
              </div>

              {/* Severity */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Severity</label>
                <select
                  value={filters.severity}
                  onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}
                  className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">All Severities</option>
                  {SEVERITIES.map(s => (
                    <option key={s} value={s}>{humanLabel(s)}</option>
                  ))}
                </select>
              </div>

              {/* Incident Type */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Type</label>
                <select
                  value={filters.incident_type}
                  onChange={e => setFilters(f => ({ ...f, incident_type: e.target.value }))}
                  className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">All Types</option>
                  {INCIDENT_TYPES.map(t => (
                    <option key={t} value={t}>{humanLabel(t)}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setApplied({ ...filters })}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => { setFilters(INITIAL_FILTERS); setApplied(INITIAL_FILTERS) }}
                >
                  Clear
                </Button>
              </div>
            </div>

            {/* List */}
            <div className="px-4 pb-4 pt-3 space-y-2">
              {listLoading && (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading incidents…</span>
                </div>
              )}

              {isError && (
                <div className="flex flex-col items-center gap-2 py-10">
                  <p className="text-sm text-destructive">Failed to load incidents.</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                </div>
              )}

              {!listLoading && !isError && rows.length === 0 && (
                <div className="flex flex-col items-center py-12 gap-2 text-center">
                  <CheckCircle2 className="h-8 w-8 text-success opacity-60" />
                  <p className="text-sm font-medium text-foreground">No incidents found</p>
                  <p className="text-xs text-muted-foreground">Adjust filters or create a new incident.</p>
                </div>
              )}

              {!listLoading && !isError && rows.map(inc => (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => setSelectedId(inc.id === selectedId ? null : inc.id)}
                  className={cn(
                    'w-full text-left rounded-lg border p-3 transition-colors hover:bg-muted/20',
                    selectedId === inc.id
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border bg-card',
                    SEVERITY_BORDER[inc.severity],
                  )}
                >
                  {/* Top badges */}
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <Badge
                      variant={SEVERITY_VARIANT[inc.severity]}
                      className="rounded-full text-[10px] px-2 capitalize"
                    >
                      {inc.severity}
                    </Badge>
                    <Badge
                      variant={STATUS_VARIANT[inc.status]}
                      className="rounded-full text-[10px] px-2 capitalize"
                    >
                      {humanLabel(inc.status)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] px-2"
                    >
                      {humanLabel(inc.incident_type)}
                    </Badge>
                  </div>

                  {/* Title */}
                  <p className="text-sm font-semibold text-foreground leading-tight mb-1">
                    {inc.title}
                  </p>

                  {/* Description */}
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {inc.description}
                  </p>

                  {/* Footer row */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground/70">
                        {fmtDateTime(inc.created_at)}
                      </span>
                      {inc.assigned_to_name && (
                        <span className="text-[10px] text-muted-foreground">
                          → {inc.assigned_to_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {inc.payroll_impact_amount != null && (
                        <span className="text-[10px] font-medium text-destructive">
                          {fmtCurrency(inc.payroll_impact_amount)}
                        </span>
                      )}
                      <ChevronRight className={cn(
                        'h-3.5 w-3.5 text-muted-foreground transition-transform',
                        selectedId === inc.id && 'rotate-90',
                      )} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* ── Right: detail panel ── */}
        <div className="lg:col-span-1">
          <SectionCard
            title={selectedId ? 'Incident Detail' : 'Details'}
            icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
          >
            {!selectedId ? (
              <div className="flex flex-col items-center py-12 gap-2 text-center">
                <ShieldAlert className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">Select an incident to view details</p>
              </div>
            ) : (
              <DetailPanel
                incidentId={selectedId}
                onClear={() => setSelectedId(null)}
              />
            )}
          </SectionCard>
        </div>
      </div>

      {/* Create dialog */}
      <CreateIncidentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </PageContainer>
  )
}
