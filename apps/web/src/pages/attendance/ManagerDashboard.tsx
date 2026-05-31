/**
 * ManagerDashboard — Unified Approval Inbox
 *
 * Managers are approvers and supervisors, NOT system operators.
 *
 * Primary experience:
 *   1. Pending Requests — unified approval inbox (leave + regularizations + future types)
 *   2. Team Attendance  — compact status strip
 *   3. Team Availability — at-a-glance leave/absence snapshot
 *
 * Removed: KPI dashboards, operational analytics, admin configuration,
 *          compliance tooling, bulk checkbox machinery, complex queue states.
 *
 * Tabs: Active | Closed
 * Card actions: Approve · Reject · Send Back · View Details
 * Terminology: Attendance Regularization (never "Correction")
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate }                           from 'react-router-dom'
import { createPortal }                          from 'react-dom'
import { toast }                                 from 'sonner'
import {
  CheckCircle2, XCircle, Clock, CalendarDays, AlertTriangle,
  RefreshCw, Loader2, Inbox,
  Users, ArrowRight, X, MessageSquare,
  CalendarClock, FileText, Send, RotateCcw,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type RequestType   = 'leave' | 'regularization' | 'overtime' | 'comp_off' | 'shift_change'
type RequestStatus = 'pending' | 'approved' | 'rejected' | 'sent_back'
type FilterType    = 'all' | RequestType
type ActiveTab     = 'active' | 'closed'

interface UnifiedRequest {
  id:                   string
  type:                 RequestType
  status:               RequestStatus
  employeeId:           string
  employeeName:         string
  employeeCode:         string
  department?:          string
  fromDate:             string
  toDate:               string
  dayCount?:            number
  reason:               string | null
  createdAt:            string
  // leave-specific
  leaveTypeName?:       string
  // regularization-specific
  regularizationType?:  string
  requestedCheckIn?:    string | null
  requestedCheckOut?:   string | null
}

interface TeamMember {
  employee_id:   string
  employee_code: string
  name:          string
  status:        string
  work_hours:    number
  late_minutes:  number
  check_in:      string | null
  check_out:     string | null
}

interface TodaySummary {
  present: number; late: number; absent: number
  leave: number; not_marked: number; total: number
}

interface DashboardData {
  manager_employee_id: string | null
  date:                string
  team_members:        TeamMember[]
  today_summary:       TodaySummary
  pending: {
    leave_requests:  Array<{
      id: string; from_date: string; to_date: string; computed_days: number
      reason: string | null; created_at: string
      leave_types:  { id: string; name: string } | null
      employees:    { id: string; first_name: string; last_name: string; employee_code: string; department?: string } | null
    }>
    regularisations: Array<{
      id: string; date: string; reason: string; created_at: string
      regularization_type?: string | null
      requested_check_in:  string | null
      requested_check_out: string | null
      employees: { id: string; first_name: string; last_name: string; employee_code: string } | null
    }>
  }
  anomalies: { count: number }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REG_TYPE_LABEL: Record<string, string> = {
  missed_punch:    'Missed Punch',
  forgot_checkout: 'Forgot Check-out',
  onsite_duty:     'Onsite Duty',
  biometric_issue: 'Biometric Issue',
  client_visit:    'Client Visit',
  wfh:             'Work from Home',
  field_work:      'Field Work',
  system_issue:    'System Issue',
}

const TYPE_LABEL: Record<RequestType, string> = {
  leave:        'Leave',
  regularization: 'Regularization',
  overtime:     'Overtime',
  comp_off:     'Comp-off',
  shift_change: 'Shift Change',
}

const TYPE_COLOR: Record<RequestType, string> = {
  leave:         'bg-info/12 text-info border-info/25',
  regularization:'bg-warning/12 text-warning border-warning/25',
  overtime:      'bg-purple-500/12 text-purple-600 border-purple-500/25',
  comp_off:      'bg-teal-500/12 text-teal-600 border-teal-500/25',
  shift_change:  'bg-muted/60 text-muted-foreground border-border/40',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeSLA(createdAt: string) {
  const ageH = (Date.now() - new Date(createdAt).getTime()) / 3_600_000
  const breach   = ageH >= 24
  const critical = ageH >= 48
  const label =
    ageH < 1    ? 'just now'
    : !breach   ? `${Math.floor(ageH)}h ago`
    : !critical ? `${Math.floor(ageH)}h — overdue`
    :             `${Math.floor(ageH / 24)}d — urgent`
  return { hours: Math.floor(ageH), breach, critical, label }
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDateRange(from: string, to: string, days?: number): string {
  if (from === to) return fmtDate(from)
  return `${fmtDate(from)} – ${fmtDate(to)}${days ? ` (${days}d)` : ''}`
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ── SLA Badge ──────────────────────────────────────────────────────────────────

function SLABadge({ createdAt }: { createdAt: string }) {
  const sla = computeSLA(createdAt)
  if (!sla.breach) {
    return <span className="text-[10px] text-muted-foreground/60">{sla.label}</span>
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border',
      sla.critical
        ? 'bg-destructive/10 text-destructive border-destructive/20'
        : 'bg-warning/10 text-warning border-warning/20',
    )}>
      <AlertTriangle className="h-2.5 w-2.5" />
      {sla.label}
    </span>
  )
}

// ── Request Type Badge ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: RequestType }) {
  return (
    <span className={cn(
      'inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide',
      TYPE_COLOR[type],
    )}>
      {TYPE_LABEL[type]}
    </span>
  )
}

// ── Request Card ──────────────────────────────────────────────────────────────

interface RequestCardProps {
  req:           UnifiedRequest
  actionId:      string | null
  sendBackId:    string | null
  sendBackReason:string
  onSendBackReasonChange: (v: string) => void
  onApprove:     (id: string, type: RequestType) => void
  onReject:      (id: string, type: RequestType) => void
  onSendBack:    (id: string, type: RequestType) => void
  onSendBackConfirm: (id: string, type: RequestType) => void
  onSendBackCancel:  () => void
  onDetails:     (req: UnifiedRequest) => void
  approvePending:boolean
  rejectPending: boolean
  sendBackPending:boolean
}

function RequestCard({
  req, actionId, sendBackId, sendBackReason,
  onSendBackReasonChange,
  onApprove, onReject, onSendBack, onSendBackConfirm, onSendBackCancel,
  onDetails, approvePending, rejectPending, sendBackPending,
}: RequestCardProps) {
  const sla    = computeSLA(req.createdAt)
  const busy   = actionId === req.id && (approvePending || rejectPending || sendBackPending)
  const isSendBack = sendBackId === req.id

  return (
    <div className={cn(
      'rounded-xl border bg-card p-4 space-y-3 transition-all',
      busy   && 'opacity-60 pointer-events-none',
      sla.critical && 'border-destructive/25',
      !sla.critical && sla.breach && 'border-warning/25',
      !sla.breach && 'border-border/60',
    )}>
      {/* Row 1: Employee + type + SLA */}
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-primary/12 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
          {initials(req.employeeName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground leading-none">{req.employeeName}</span>
            <span className="text-[10px] text-muted-foreground font-mono">#{req.employeeCode}</span>
            {req.department && (
              <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">{req.department}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <TypeBadge type={req.type} />
            {req.type === 'regularization' && req.regularizationType && (
              <span className="text-[10px] text-muted-foreground">
                {REG_TYPE_LABEL[req.regularizationType] ?? req.regularizationType}
              </span>
            )}
            {req.type === 'leave' && req.leaveTypeName && (
              <span className="text-[10px] text-muted-foreground">{req.leaveTypeName}</span>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 text-right space-y-1">
          <SLABadge createdAt={req.createdAt} />
        </div>
      </div>

      {/* Row 2: Dates + reason */}
      <div className="pl-11 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
          <span className="font-medium text-foreground">
            {fmtDateRange(req.fromDate, req.toDate, req.dayCount)}
          </span>
          {req.type === 'regularization' && (req.requestedCheckIn || req.requestedCheckOut) && (
            <span className="text-muted-foreground">
              · In: {fmtTime(req.requestedCheckIn ?? null)} Out: {fmtTime(req.requestedCheckOut ?? null)}
            </span>
          )}
        </div>

        {req.reason && (
          <p className="text-xs text-muted-foreground line-clamp-2 italic">
            "{req.reason}"
          </p>
        )}
      </div>

      {/* Row 3: Actions */}
      <div className="pl-11 flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          className="h-7 text-xs px-3 min-w-[72px]"
          disabled={busy}
          onClick={() => onApprove(req.id, req.type)}
        >
          {busy && approvePending && actionId === req.id
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <><CheckCircle2 className="h-3 w-3 mr-1" />Approve</>}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-3 border-destructive/30 text-destructive hover:bg-destructive/8 min-w-[60px]"
          disabled={busy}
          onClick={() => onReject(req.id, req.type)}
        >
          {busy && rejectPending && actionId === req.id
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <><XCircle className="h-3 w-3 mr-1" />Reject</>}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs px-2.5 text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => onSendBack(req.id, req.type)}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Send Back
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs px-2.5 text-primary hover:text-primary/80 ml-auto"
          onClick={() => onDetails(req)}
        >
          View Details
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>

      {/* Send Back inline prompt */}
      {isSendBack && (
        <div className="pl-11 space-y-2 pt-1">
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
            <p className="text-xs font-medium text-warning flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Send Back for Revision
            </p>
            <textarea
              className="w-full text-xs rounded-md border border-input bg-background px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
              rows={2}
              placeholder="Tell the employee what needs to be revised…"
              value={sendBackReason}
              onChange={e => onSendBackReasonChange(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[11px] px-2.5 border-warning/40 text-warning hover:bg-warning/10"
                disabled={!sendBackReason.trim() || sendBackPending}
                onClick={() => onSendBackConfirm(req.id, req.type)}
              >
                {sendBackPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <><Send className="h-3 w-3 mr-1" />Confirm</>}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] px-2"
                onClick={onSendBackCancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Closed Request Card (read-only) ────────────────────────────────────────────

function ClosedCard({ req }: { req: UnifiedRequest }) {
  const decided = req.status === 'approved'
    ? <span className="text-[10px] font-semibold text-success">Approved</span>
    : req.status === 'sent_back'
      ? <span className="text-[10px] font-semibold text-warning">Sent Back</span>
      : <span className="text-[10px] font-semibold text-destructive">Rejected</span>

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 p-4 flex items-start gap-3 opacity-80">
      <div className="w-8 h-8 rounded-full bg-muted/60 text-muted-foreground flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
        {initials(req.employeeName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{req.employeeName}</span>
          <span className="text-[10px] text-muted-foreground font-mono">#{req.employeeCode}</span>
          <TypeBadge type={req.type} />
          {decided}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {fmtDateRange(req.fromDate, req.toDate, req.dayCount)}
          {req.reason && ` · "${req.reason}"`}
        </p>
      </div>
    </div>
  )
}

// ── Request Detail Drawer ─────────────────────────────────────────────────────

interface DetailDrawerProps {
  req:       UnifiedRequest | null
  open:      boolean
  onClose:   () => void
  onApprove: (id: string, type: RequestType) => void
  onReject:  (id: string, type: RequestType) => void
  actionId:  string | null
  approvePending: boolean
  rejectPending:  boolean
}

function RequestDetailDrawer({
  req, open, onClose, onApprove, onReject, actionId, approvePending, rejectPending,
}: DetailDrawerProps) {
  const [managerNote, setManagerNote] = useState('')
  const busy = !!req && actionId === req.id && (approvePending || rejectPending)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, busy, onClose])

  if (!req) return null

  const sla = computeSLA(req.createdAt)

  return createPortal(
    <div className={cn(
      'fixed inset-0 z-[200] flex',
      !open && 'pointer-events-none',
    )}>
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={() => !busy && onClose()}
      />

      {/* Drawer */}
      <div className={cn(
        'absolute right-0 top-0 bottom-0 w-full sm:w-[420px] bg-card border-l border-border/60 flex flex-col shadow-2xl transition-transform duration-250 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/12 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials(req.employeeName)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight truncate">{req.employeeName}</p>
              <p className="text-[10px] text-muted-foreground font-mono">#{req.employeeCode}</p>
            </div>
          </div>
          <button
            onClick={() => !busy && onClose()}
            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Request summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <TypeBadge type={req.type} />
              <SLABadge createdAt={req.createdAt} />
            </div>

            <div className="rounded-lg bg-muted/30 border border-border/40 p-3.5 space-y-2.5">
              {req.type === 'leave' && (
                <>
                  <Row label="Leave Type"    value={req.leaveTypeName ?? '—'} />
                  <Row label="Duration"      value={fmtDateRange(req.fromDate, req.toDate, req.dayCount)} />
                </>
              )}
              {req.type === 'regularization' && (
                <>
                  <Row label="Date"               value={fmtDate(req.fromDate)} />
                  <Row label="Regularization Type" value={req.regularizationType ? (REG_TYPE_LABEL[req.regularizationType] ?? req.regularizationType) : '—'} />
                  {(req.requestedCheckIn || req.requestedCheckOut) && (
                    <Row label="Requested Punches"
                      value={`In: ${fmtTime(req.requestedCheckIn ?? null)}  ·  Out: ${fmtTime(req.requestedCheckOut ?? null)}`}
                    />
                  )}
                </>
              )}
              <Row label="Submitted" value={(() => { const _d = new Date(req.createdAt); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; if (isNaN(_d.getTime())) return '—'; const _hr = String(_d.getHours()).padStart(2,'0'); const _mn = String(_d.getMinutes()).padStart(2,'0'); return `${String(_d.getDate()).padStart(2,'0')}-${_M[_d.getMonth()]}-${_d.getFullYear()} ${_hr}:${_mn}` })()} />
            </div>

            {req.reason && (
              <div className="rounded-lg bg-muted/20 border border-border/30 px-3.5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Reason</p>
                <p className="text-xs text-foreground leading-relaxed">"{req.reason}"</p>
              </div>
            )}
          </div>

          {/* SLA context */}
          {sla.breach && (
            <div className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3.5 py-3',
              sla.critical
                ? 'border-destructive/25 bg-destructive/5'
                : 'border-warning/25 bg-warning/5',
            )}>
              <AlertTriangle className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', sla.critical ? 'text-destructive' : 'text-warning')} />
              <div className="text-xs">
                <p className={cn('font-semibold', sla.critical ? 'text-destructive' : 'text-warning')}>
                  {sla.critical ? 'Urgent — SLA critically overdue' : 'Overdue — manager SLA breached'}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  This request has been waiting {sla.label}. Pending requests older than 24h are escalated to HR.
                </p>
              </div>
            </div>
          )}

          {/* Manager note */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              Manager Note (optional)
            </label>
            <textarea
              className="w-full text-xs rounded-md border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
              rows={3}
              placeholder="Add context or instructions for the employee…"
              value={managerNote}
              onChange={e => setManagerNote(e.target.value)}
            />
          </div>

          {/* Useful links */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Quick Links</p>
            <div className="space-y-1">
              <DrawerLink
                icon={FileText}
                label="View full employee profile"
                href={`/admin/employees/${req.employeeId}`}
              />
              {req.type === 'regularization' && (
                <DrawerLink
                  icon={CalendarClock}
                  label="View attendance forensics"
                  href={`/admin/attendance/forensics?employeeId=${req.employeeId}&date=${req.fromDate}`}
                />
              )}
            </div>
          </div>

        </div>

        {/* Footer actions */}
        <div className="flex-shrink-0 border-t border-border/50 px-5 py-4 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              className="flex-1 gap-1.5"
              disabled={busy}
              onClick={() => onApprove(req.id, req.type)}
            >
              {busy && approvePending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><CheckCircle2 className="h-3.5 w-3.5" />Approve</>}
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/8"
              disabled={busy}
              onClick={() => onReject(req.id, req.type)}
            >
              {busy && rejectPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><XCircle className="h-3.5 w-3.5" />Reject</>}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/60 text-center">
            Actions are final — contact HR admin to reverse an approved request.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Drawer helpers ─────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

function DrawerLink({
  icon: Icon, label, href,
}: { icon: React.ElementType; label: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors py-1 group"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 group-hover:text-primary transition-colors" />
      {label}
      <ArrowRight className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}

// ── Team Availability Strip ────────────────────────────────────────────────────

function TeamStrip({ members, summary, isLoading }: {
  members:   TeamMember[]
  summary?:  TodaySummary
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading team…</span>
      </div>
    )
  }
  if (!summary || members.length === 0) return null

  const metrics = [
    { label: 'Present',    value: summary.present,    color: 'text-success'            },
    { label: 'Late',       value: summary.late,       color: 'text-warning',  dim: summary.late === 0      },
    { label: 'Absent',     value: summary.absent,     color: 'text-destructive', dim: summary.absent === 0  },
    { label: 'On Leave',   value: summary.leave,      color: 'text-info',     dim: summary.leave === 0     },
    { label: 'Not Marked', value: summary.not_marked, color: 'text-muted-foreground', dim: summary.not_marked === 0 },
  ]

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium">Team Today</span>
          <span className="text-muted-foreground/50">·</span>
          <span>{summary.total} member{summary.total !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="flex divide-x divide-border/30">
        {metrics.map(m => (
          <div
            key={m.label}
            className={cn('flex-1 flex flex-col items-center py-2.5 gap-0.5', m.dim && 'opacity-40')}
          >
            <span className={cn('text-base font-bold tabular-nums leading-none', m.color)}>{m.value}</span>
            <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/60 mt-0.5">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 animate-pulse space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-36 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
        </div>
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
      <div className="pl-11 space-y-1.5">
        <div className="h-3 w-48 rounded bg-muted" />
        <div className="h-3 w-64 rounded bg-muted opacity-60" />
      </div>
      <div className="pl-11 flex gap-2">
        <div className="h-7 w-20 rounded-md bg-muted" />
        <div className="h-7 w-16 rounded-md bg-muted" />
        <div className="h-7 w-20 rounded-md bg-muted" />
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ManagerDashboard() {
  const qc       = useQueryClient()
  const navigate = useNavigate()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab,     setActiveTab]     = useState<ActiveTab>('active')
  const [filterType,    setFilterType]    = useState<FilterType>('all')
  const [actionId,      setActionId]      = useState<string | null>(null)
  const [drawerReq,     setDrawerReq]     = useState<UnifiedRequest | null>(null)
  const [drawerOpen,    setDrawerOpen]    = useState(false)
  const [sendBackId,    setSendBackId]    = useState<string | null>(null)
  const [sendBackReason, setSendBackReason] = useState('')
  const [dismissedIds,  setDismissedIds]  = useState<Set<string>>(new Set())
  const [fadingIds,     setFadingIds]     = useState<Set<string>>(new Set())

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DashboardData>({
    queryKey:        ['manager-dashboard', today],
    queryFn:         () => api.get(`/manager/dashboard?date=${today}`),
    staleTime:       5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  const { data: closedData, isLoading: closedLoading } = useQuery<{ data: UnifiedRequest[] }>({
    queryKey: ['manager-closed-requests'],
    queryFn:  () => api.get('/manager/requests?status=approved,rejected&limit=50'),
    enabled:  activeTab === 'closed',
    staleTime: 2 * 60_000,
  })

  // ── Derive unified request list ───────────────────────────────────────────
  const allPending = useMemo((): UnifiedRequest[] => {
    if (!data) return []
    const leave: UnifiedRequest[] = (data.pending.leave_requests ?? []).map(lr => ({
      id:           lr.id,
      type:         'leave' as const,
      status:       'pending' as const,
      employeeId:   lr.employees?.id ?? '',
      employeeName: lr.employees ? `${lr.employees.first_name} ${lr.employees.last_name}` : '—',
      employeeCode: lr.employees?.employee_code ?? '',
      department:   lr.employees?.department,
      fromDate:     lr.from_date,
      toDate:       lr.to_date,
      dayCount:     lr.computed_days,
      reason:       lr.reason,
      createdAt:    lr.created_at,
      leaveTypeName: lr.leave_types?.name,
    }))
    const regs: UnifiedRequest[] = (data.pending.regularisations ?? []).map(reg => ({
      id:                  reg.id,
      type:                'regularization' as const,
      status:              'pending' as const,
      employeeId:          reg.employees?.id ?? '',
      employeeName:        reg.employees ? `${reg.employees.first_name} ${reg.employees.last_name}` : '—',
      employeeCode:        reg.employees?.employee_code ?? '',
      fromDate:            reg.date,
      toDate:              reg.date,
      reason:              reg.reason,
      createdAt:           reg.created_at,
      regularizationType:  reg.regularization_type ?? undefined,
      requestedCheckIn:    reg.requested_check_in,
      requestedCheckOut:   reg.requested_check_out,
    }))
    // Sort by SLA breach first, then creation time
    return [...leave, ...regs].sort((a, b) => {
      const ageA = Date.now() - new Date(a.createdAt).getTime()
      const ageB = Date.now() - new Date(b.createdAt).getTime()
      return ageB - ageA
    })
  }, [data])

  const visiblePending = useMemo(() =>
    allPending.filter(r => !dismissedIds.has(r.id)),
    [allPending, dismissedIds],
  )

  const filteredPending = useMemo(() =>
    filterType === 'all' ? visiblePending : visiblePending.filter(r => r.type === filterType),
    [visiblePending, filterType],
  )

  const pendingCount = visiblePending.length

  // ── Optimistic dismiss helpers ────────────────────────────────────────────
  function dismissWithFade(id: string) {
    setFadingIds(prev => new Set([...prev, id]))
    setTimeout(() => {
      setDismissedIds(prev => new Set([...prev, id]))
      setFadingIds(prev => { const n = new Set(prev); n.delete(id); return n })
      if (drawerOpen && drawerReq?.id === id) setDrawerOpen(false)
    }, 220)
  }

  function cancelFade(id: string) {
    setFadingIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const approveLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/approve`, {}),
    onSuccess: (_d, id) => {
      dismissWithFade(id); setActionId(null)
      toast.success('Leave approved')
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id); setActionId(null)
      toast.error(err.message || 'Failed to approve leave')
    },
  })

  const rejectLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/reject`, {}),
    onSuccess: (_d, id) => {
      dismissWithFade(id); setActionId(null)
      toast.success('Leave rejected')
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id); setActionId(null)
      toast.error(err.message || 'Failed to reject leave')
    },
  })

  const approveRegMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: (_d, id) => {
      dismissWithFade(id); setActionId(null)
      toast.success('Regularization approved')
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id); setActionId(null)
      toast.error(err.message || 'Failed to approve regularization')
    },
  })

  const rejectRegMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/attendance/regularisation/${id}/reject`, { reason }),
    onSuccess: (_d, { id }) => {
      dismissWithFade(id); setActionId(null)
      setSendBackId(null); setSendBackReason('')
      toast.success('Regularization rejected')
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, { id }) => {
      cancelFade(id); setActionId(null)
      toast.error(err.message || 'Failed to reject regularization')
    },
  })

  // ── Action handlers ───────────────────────────────────────────────────────
  function handleApprove(id: string, type: RequestType) {
    setActionId(id)
    if (type === 'leave')          approveLeaveMutation.mutate(id)
    else if (type === 'regularization') approveRegMutation.mutate(id)
    else toast.info('Approval not yet supported for this request type')
  }

  function handleReject(id: string, type: RequestType) {
    setActionId(id)
    if (type === 'leave')          rejectLeaveMutation.mutate(id)
    else if (type === 'regularization') rejectRegMutation.mutate({ id })
    else toast.info('Rejection not yet supported for this request type')
  }

  function handleSendBack(id: string, _type: RequestType) {
    setSendBackId(id)
    setSendBackReason('')
  }

  function handleSendBackConfirm(id: string, type: RequestType) {
    setActionId(id)
    if (type === 'leave')
      rejectLeaveMutation.mutate(id)   // fallback: reject with reason in future
    else if (type === 'regularization')
      rejectRegMutation.mutate({ id, reason: `Sent back: ${sendBackReason.trim()}` })
    else {
      setSendBackId(null); setSendBackReason('')
      toast.info('Send back not yet supported for this type')
    }
  }

  function handleSendBackCancel() {
    setSendBackId(null)
    setSendBackReason('')
  }

  function openDrawer(req: UnifiedRequest) {
    setDrawerReq(req)
    setDrawerOpen(true)
  }

  // ── Filter tabs config ────────────────────────────────────────────────────
  const filterTabs: { key: FilterType; label: string; count?: number }[] = [
    { key: 'all',            label: 'All',             count: visiblePending.length },
    { key: 'leave',          label: 'Leave',           count: visiblePending.filter(r => r.type === 'leave').length },
    { key: 'regularization', label: 'Regularization',  count: visiblePending.filter(r => r.type === 'regularization').length },
    { key: 'overtime',       label: 'Overtime' },
    { key: 'comp_off',       label: 'Comp-off' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Pending Requests"
        subtitle="Your approval inbox — leave, regularizations and team requests"
        actions={
          <div className="flex items-center gap-2">
            {isFetching && !isLoading && (
              <span className="text-[10px] text-muted-foreground/50 hidden sm:block">Refreshing…</span>
            )}
            <Button
              size="sm" variant="ghost" className="h-8 px-2"
              onClick={() => refetch()} disabled={isFetching}
              title="Refresh inbox"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 px-2 text-xs"
              onClick={() => navigate('/admin/employees')}
            >
              <Users className="h-3.5 w-3.5 mr-1" />Team
            </Button>
          </div>
        }
      />

      {/* Action required banner */}
      {!isLoading && pendingCount > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-primary/8 border border-primary/20">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Inbox className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {pendingCount} request{pendingCount !== 1 ? 's' : ''} require your approval
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {visiblePending.filter(r => r.type === 'leave').length > 0 &&
                `${visiblePending.filter(r => r.type === 'leave').length} leave`}
              {visiblePending.filter(r => r.type === 'leave').length > 0 &&
               visiblePending.filter(r => r.type === 'regularization').length > 0 && ' · '}
              {visiblePending.filter(r => r.type === 'regularization').length > 0 &&
                `${visiblePending.filter(r => r.type === 'regularization').length} regularization${visiblePending.filter(r => r.type === 'regularization').length !== 1 ? 's' : ''}`}
            </p>
          </div>
          {visiblePending.some(r => computeSLA(r.createdAt).breach) && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-warning bg-warning/10 border border-warning/20 rounded-full px-2 py-1 flex-shrink-0">
              <AlertTriangle className="h-3 w-3" />
              SLA breached
            </span>
          )}
        </div>
      )}

      {/* Team availability strip */}
      <TeamStrip
        members={data?.team_members ?? []}
        summary={data?.today_summary}
        isLoading={isLoading}
      />

      {/* Active / Closed tabs + Type filter */}
      <div className="space-y-3">
        {/* Tab row */}
        <div className="flex items-center gap-1 border-b border-border/50">
          {(['active', 'closed'] as ActiveTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab === 'active' ? `Active${pendingCount > 0 ? ` (${pendingCount})` : ''}` : 'Closed'}
            </button>
          ))}
        </div>

        {/* Type filter (active tab only) */}
        {activeTab === 'active' && (
          <div className="flex items-center gap-1 flex-wrap">
            {filterTabs.map(ft => (
              <button
                key={ft.key}
                onClick={() => setFilterType(ft.key)}
                className={cn(
                  'inline-flex items-center gap-1 text-xs rounded-full px-3 py-1 border font-medium transition-all',
                  filterType === ft.key
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground bg-transparent',
                )}
              >
                {ft.label}
                {ft.count !== undefined && ft.count > 0 && (
                  <span className={cn(
                    'text-[10px] rounded-full px-1.5 py-0 font-bold',
                    filterType === ft.key ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    {ft.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── ACTIVE TAB ──────────────────────────────────────────────────────────── */}
      {activeTab === 'active' && (
        <div className="space-y-3">
          {isLoading && (
            <>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </>
          )}

          {isError && (
            <SectionCard>
              <div className="flex flex-col items-center gap-3 py-12">
                <AlertTriangle className="h-7 w-7 text-destructive/50" />
                <p className="text-sm font-medium text-foreground">Failed to load requests</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Retry
                </Button>
              </div>
            </SectionCard>
          )}

          {!isLoading && !isError && filteredPending.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 text-success/40" />
              <p className="text-sm font-semibold text-foreground">
                {filterType === 'all' ? 'All caught up!' : `No pending ${TYPE_LABEL[filterType as RequestType] ?? filterType} requests`}
              </p>
              <p className="text-xs text-center max-w-xs">
                {filterType === 'all'
                  ? 'No pending requests right now. New requests will appear here automatically.'
                  : 'Try switching to All to see other request types.'}
              </p>
            </div>
          )}

          {!isLoading && !isError && filteredPending.map(req => (
            <div
              key={req.id}
              className={cn(
                'transition-opacity duration-200',
                fadingIds.has(req.id) && 'opacity-0 pointer-events-none',
              )}
            >
              <RequestCard
                req={req}
                actionId={actionId}
                sendBackId={sendBackId}
                sendBackReason={sendBackReason}
                onSendBackReasonChange={setSendBackReason}
                onApprove={handleApprove}
                onReject={handleReject}
                onSendBack={handleSendBack}
                onSendBackConfirm={handleSendBackConfirm}
                onSendBackCancel={handleSendBackCancel}
                onDetails={openDrawer}
                approvePending={approveLeaveMutation.isPending || approveRegMutation.isPending}
                rejectPending={rejectLeaveMutation.isPending || rejectRegMutation.isPending}
                sendBackPending={rejectRegMutation.isPending || rejectLeaveMutation.isPending}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── CLOSED TAB ──────────────────────────────────────────────────────────── */}
      {activeTab === 'closed' && (
        <div className="space-y-2.5">
          {closedLoading && (
            <><CardSkeleton /><CardSkeleton /></>
          )}

          {!closedLoading && (!closedData?.data || closedData.data.length === 0) && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Clock className="h-9 w-9 opacity-30" />
              <p className="text-sm font-semibold text-foreground">No closed requests</p>
              <p className="text-xs text-center max-w-xs">
                Approved and rejected requests will appear here once history is available.
              </p>
            </div>
          )}

          {!closedLoading && closedData?.data && closedData.data.map(req => (
            <ClosedCard key={req.id} req={req} />
          ))}
        </div>
      )}

      {/* ── Anomaly note ────────────────────────────────────────────────────── */}
      {!isLoading && (data?.anomalies?.count ?? 0) > 0 && (
        <div
          className="flex items-center gap-3 p-3.5 rounded-xl bg-warning/8 border border-warning/20 cursor-pointer hover:bg-warning/12 transition-colors"
          onClick={() => navigate('/admin/attendance/anomalies')}
        >
          <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
          <p className="text-xs font-medium text-warning flex-1">
            {data!.anomalies.count} attendance anomal{data!.anomalies.count === 1 ? 'y' : 'ies'} detected — resolve before payroll close
          </p>
          <ArrowRight className="h-3.5 w-3.5 text-warning/60 flex-shrink-0" />
        </div>
      )}

      {/* ── Request Detail Drawer ─────────────────────────────────────────── */}
      <RequestDetailDrawer
        req={drawerReq}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onApprove={handleApprove}
        onReject={handleReject}
        actionId={actionId}
        approvePending={approveLeaveMutation.isPending || approveRegMutation.isPending}
        rejectPending={rejectLeaveMutation.isPending || rejectRegMutation.isPending}
      />
    </PageContainer>
  )
}
