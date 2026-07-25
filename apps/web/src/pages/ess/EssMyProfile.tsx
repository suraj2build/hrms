/**
 * EssMyProfile — /ess/profile
 *
 * Employee Worklife Hub: identity-centered, workflow-first landing experience.
 *
 * Sections:
 *   1. Profile Hero     — avatar, name, ID, designation, dept, manager, location
 *   2. Status Strip     — today's attendance, leave balance, pending, comp-off, next holiday, payslip
 *   3. Primary Actions  — 5 prominent CTAs for core ESS workflows
 *   4. Tab Workspace    — Overview | Employment | Attendance | Leave | Payroll | Documents
 *
 * NOT an admin employee form. No payroll structures, compensation tabs, or salary details.
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState, useMemo }               from 'react'
import { Link, useNavigate }               from 'react-router-dom'
import { SignedImage }                     from '@/components/SignedImage'
import { useQuery, useQueryClient }        from '@tanstack/react-query'
import { toast }                           from 'sonner'
import {
  User, Briefcase, Phone, Mail, MapPin, Calendar,
  Building2, Award, Users, Edit2, Check, X,
  Loader2, AlertTriangle, ArrowRight, Clock,
  FileText, CalendarDays, Receipt,
  CheckCircle2, XCircle, CalendarOff, Gift,
  ChevronRight, Wallet, Download, TrendingUp,
  BookOpen, Shield, Star, Inbox,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { AadhaarVerifyCard } from '@/components/trust/AadhaarVerifyCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { MyPersonalTab } from './MyPersonalTab'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfileData {
  employee: {
    id:            string
    first_name:    string
    last_name:     string
    email:         string
    phone:         string | null
    employee_code: string
    joining_date:  string | null
    status:        string
  }
  personal_info: {
    gender:        string | null
    dob:           string | null
    blood_group:   string | null
    nationality:   string | null
    profile_photo: string | null
  } | null
  job_info: {
    employment_type: string
    effective_from:  string
    departments:     { name: string } | null
    designations:    { name: string } | null
    grades:          { name: string; code: string } | null
    work_locations:  { name: string; city: string } | null
    shifts:          { name: string } | null
    manager:         { first_name: string; last_name: string; employee_code: string } | null
  } | null
}

interface OperationalSummary {
  present_days:        number
  absent_days:         number
  late_days:           number
  lop_days:            number
  total_ot_hours:      number
  leave_balance_by_type: Array<{ leave_type_name: string | null; balance_days: number }>
  payroll_preview:     { lop_amount: number; ot_amount: number; estimated_net_payable: number }
  warnings:            string[]
}

interface LeaveRequest {
  id:             string
  status:         string
  leave_type?:    { name: string } | null
  from_date:      string
  to_date:        string
  days_requested: number
  reason:         string | null
  created_at:     string
  rejected_reason?: string | null
}

interface RegRequest {
  id:                  string
  status:              string
  regularization_type: string
  date:                string
  reason:              string | null
  created_at:          string
  rejected_reason?:    string | null
}

interface CompOffRecord {
  id:          string
  status:      string
  leave_days:  number
  work_date:   string
}

interface Payslip {
  id:          string
  month:       number
  year:        number
  net_pay:     number | null
  status:      string
  created_at:  string
}

interface Holiday {
  id:     string
  name:   string
  date:   string
  type?:  string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!s) return '—'
  if (opts) return new Date(`${s}T12:00:00Z`).toLocaleDateString([], opts)
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function cap(s: string | null | undefined) {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Tab definition ─────────────────────────────────────────────────────────────

type Tab = 'overview' | 'personal' | 'employment' | 'attendance' | 'leave' | 'payroll' | 'documents'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{className?: string}> }[] = [
  { id: 'overview',    label: 'Overview',    icon: Star       },
  { id: 'personal',    label: 'Personal',    icon: User       },
  { id: 'employment',  label: 'Employment',  icon: Briefcase  },
  { id: 'attendance',  label: 'Attendance',  icon: CalendarDays },
  { id: 'leave',       label: 'Leave',       icon: CalendarOff },
  { id: 'payroll',     label: 'Payroll',     icon: Wallet     },
  { id: 'documents',   label: 'Documents',   icon: FileText   },
]

// ── Inline phone edit ─────────────────────────────────────────────────────────

function PhoneEdit({ employeeId, current, onSaved }: { employeeId: string; current: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(current)
  const [saving,  setSaving]  = useState(false)

  function save() {
    setSaving(true)
    api.patch(`/employees/${employeeId}`, { phone: draft })
      .then(() => { toast.success('Phone updated'); setEditing(false); onSaved() })
      .catch((e: Error) => toast.error('Failed', { description: e.message }))
      .finally(() => setSaving(false))
  }

  if (!editing) return (
    <button
      onClick={() => { setDraft(current); setEditing(true) }}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground group transition-colors"
    >
      <span>{current || 'Add phone number'}</span>
      <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        className="h-6 text-xs w-36"
        autoFocus
        type="tel"
      />
      <button onClick={save} disabled={saving} className="p-0.5 rounded hover:bg-success/10">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-success" />}
      </button>
      <button onClick={() => setEditing(false)} className="p-0.5 rounded hover:bg-muted">
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}

// ── Profile Hero ──────────────────────────────────────────────────────────────

function ProfileHero({ data }: { data: ProfileData }) {
  const { employee: emp, personal_info: pers, job_info: job } = data
  const qc = useQueryClient()

  // Guard: emp may be undefined if the full-profile response shape changes
  if (!emp) return null

  const fullName  = `${emp.first_name} ${emp.last_name}`
  const initials  = `${emp.first_name[0] ?? ''}${emp.last_name[0] ?? ''}`.toUpperCase()
  const isActive  = emp.status === 'active'

  type MetaItem = { icon: React.ComponentType<{ className?: string }>; text: string }
  const metaItems: MetaItem[] = ([
    job?.designations?.name   && { icon: Award,     text: job.designations.name },
    job?.departments?.name    && { icon: Building2,  text: job.departments.name },
    job?.manager              && { icon: Users,      text: `${job.manager.first_name} ${job.manager.last_name}` },
    job?.work_locations       && { icon: MapPin,     text: `${job.work_locations.name}, ${job.work_locations.city}` },
    emp.joining_date          && { icon: Calendar,   text: `Joined ${fmtDate(emp.joining_date, { month: 'short', year: 'numeric' })}` },
  ].filter(Boolean) as MetaItem[])

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card mb-4">
      {/* Premium gradient banner */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/[0.12] via-primary/[0.05] to-transparent"
      />

      <div className="relative p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">

          {/* Avatar + live status dot */}
          <div className="relative flex-shrink-0">
            <SignedImage
              path={pers?.profile_photo}
              alt={fullName}
              className="w-24 h-24 rounded-2xl object-cover ring-4 ring-card shadow-elev-2"
              fallback={
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 ring-4 ring-card shadow-elev-2 flex items-center justify-center">
                  <span className="text-primary font-bold text-3xl font-display">{initials}</span>
                </div>
              }
            />
            <span
              title={emp.status}
              className={cn(
                'absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-[3px] border-card',
                isActive ? 'bg-success' : 'bg-muted-foreground',
              )}
            />
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold text-foreground leading-tight">{fullName}</h1>
              <Badge
                variant={isActive ? 'success' : 'secondary'}
                className="rounded-full text-[10px] capitalize"
              >
                {emp.status}
              </Badge>
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5 font-medium tabular-nums">{emp.employee_code}</p>
          </div>

          {/* Contact column */}
          <div className="flex flex-col gap-1.5 sm:items-end w-full sm:w-auto">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate max-w-[220px]">{emp.email}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3.5 w-3.5 flex-shrink-0" />
              <PhoneEdit
                employeeId={emp.id}
                current={emp.phone ?? ''}
                onSaved={() => qc.invalidateQueries({ queryKey: ['ess-my-profile'] })}
              />
            </div>
          </div>
        </div>

        {/* Meta chips */}
        {metaItems.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border/60">
            {metaItems.map((m, i) => (
              <div key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1">
                <m.icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground truncate max-w-[220px]">{m.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Quick Status Strip ────────────────────────────────────────────────────────

function QuickStatusStrip({
  summary,
  leaveRequests,
  regRequests,
  compOffs,
  payslips,
  holidays,
  summaryLoading,
}: {
  summary:       OperationalSummary | undefined
  leaveRequests: LeaveRequest[]
  regRequests:   RegRequest[]
  compOffs:      CompOffRecord[]
  payslips:      Payslip[]
  holidays:      Holiday[]
  summaryLoading: boolean
}) {
  const navigate = useNavigate()
  const today = todayIso()

  // Total leave balance (sum all types)
  const totalLeaveBalance = useMemo(() =>
    (summary?.leave_balance_by_type ?? []).reduce((acc, lb) => acc + lb.balance_days, 0),
    [summary]
  )

  // Pending count
  const pendingCount = useMemo(() => {
    const pendingLeave = leaveRequests.filter(r => r.status === 'pending').length
    const pendingReg   = regRequests.filter(r => r.status === 'pending').length
    return pendingLeave + pendingReg
  }, [leaveRequests, regRequests])

  // Comp-off balance (approved, not yet used)
  const compOffBalance = useMemo(() =>
    compOffs.filter(c => c.status === 'approved').reduce((acc, c) => acc + (c.leave_days ?? 0), 0),
    [compOffs]
  )

  // Next upcoming holiday
  const nextHoliday = useMemo(() =>
    holidays
      .filter(h => h.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [holidays, today]
  )

  // Latest payslip
  const latestSlip = payslips[0] ?? null

  return (
    <div className="mb-4">
      <MetricRow cols={3}>
        <MetricCard
          icon={CalendarDays}
          label="Present This Month"
          value={summaryLoading ? '…' : (summary?.present_days ?? 0)}
          subtitle={summary ? `${summary.late_days} late · ${summary.absent_days} absent` : undefined}
          variant="success"
          onClick={() => navigate('/ess/attendance')}
        />
        <MetricCard
          icon={BookOpen}
          label="Leave Balance"
          value={summaryLoading ? '…' : `${totalLeaveBalance}d`}
          subtitle={summary?.leave_balance_by_type[0]?.leave_type_name ?? undefined}
          variant="info"
          onClick={() => navigate('/ess/leave/balance')}
        />
        <MetricCard
          icon={Clock}
          label="Pending Requests"
          value={pendingCount}
          subtitle={pendingCount > 0 ? 'Awaiting approval' : 'All clear'}
          variant={pendingCount > 0 ? 'warning' : 'neutral'}
          onClick={() => navigate('/ess/approvals')}
        />
        <MetricCard
          icon={CalendarOff}
          label="Comp-off Balance"
          value={`${compOffBalance}d`}
          subtitle="Available to use"
          variant={compOffBalance > 0 ? 'success' : 'neutral'}
          onClick={() => navigate('/ess/comp-off')}
        />
        <MetricCard
          icon={Gift}
          label="Next Holiday"
          value={nextHoliday ? fmtDate(nextHoliday.date, { day: 'numeric', month: 'short' }) : '—'}
          subtitle={nextHoliday?.name ?? undefined}
          variant="info"
          onClick={() => navigate('/ess/optional-holidays')}
        />
        <MetricCard
          icon={Wallet}
          label="Latest Payslip"
          value={latestSlip ? `${MONTH_NAMES[(latestSlip.month ?? 1) - 1]} ${latestSlip.year}` : '—'}
          subtitle={latestSlip?.net_pay != null ? fmtCurrency(latestSlip.net_pay) : undefined}
          variant="info"
          onClick={() => navigate('/ess/payroll/my-slips')}
        />
      </MetricRow>
    </div>
  )
}

// ── Primary Actions ───────────────────────────────────────────────────────────

function PrimaryActions() {
  const navigate = useNavigate()

  const actions = [
    { label: 'Apply Leave',           icon: CalendarDays, href: '/ess/leave/apply',                   color: 'primary'  },
    { label: 'Raise Regularisation',  icon: Clock,        href: '/ess/attendance/regularization',      color: 'warning'  },
    { label: 'View Attendance',       icon: CalendarDays, href: '/ess/attendance',                     color: 'info'     },
    { label: 'Download Payslip',      icon: Download,     href: '/ess/payroll/my-slips',               color: 'success'  },
    { label: 'Reimbursements',        icon: Receipt,      href: '/ess/reimbursements',                 color: 'default'  },
  ] as const

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
      {actions.map(({ label, icon: Icon, href, color }) => (
        <button
          key={href}
          onClick={() => navigate(href)}
          className={cn(
            'flex flex-col items-center gap-2 p-3.5 rounded-xl border transition-all hover:scale-[1.02] active:scale-[0.98] text-center',
            color === 'primary' && 'bg-primary text-primary-foreground border-primary hover:bg-primary/90',
            color === 'warning' && 'bg-warning/10 text-warning border-warning/25 hover:bg-warning/15',
            color === 'info'    && 'bg-info/10 text-info border-info/25 hover:bg-info/15',
            color === 'success' && 'bg-success/10 text-success border-success/25 hover:bg-success/15',
            color === 'default' && 'bg-muted/30 text-foreground border-border hover:bg-muted/60',
          )}
        >
          <Icon className="h-5 w-5 flex-shrink-0" />
          <span className="text-xs font-semibold leading-tight">{label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Request Row ───────────────────────────────────────────────────────────────

function RequestRow({
  type, label, date, status, reason, rejectedReason,
}: {
  type:           string
  label:          string
  date:           string
  status:         string
  reason?:        string | null
  rejectedReason?: string | null
}) {
  const statusConfig: Record<string, { icon: React.ComponentType<{className?: string}>; cls: string; label: string }> = {
    pending:  { icon: Clock,         cls: 'text-warning',     label: 'Pending'  },
    approved: { icon: CheckCircle2,  cls: 'text-success',     label: 'Approved' },
    rejected: { icon: XCircle,       cls: 'text-destructive', label: 'Rejected' },
  }
  const cfg = statusConfig[status] ?? statusConfig['pending']
  const Icon = cfg.icon

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', {
        'bg-warning':     status === 'pending',
        'bg-success':     status === 'approved',
        'bg-destructive': status === 'rejected',
      })} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <div className="flex items-center gap-1">
            <Icon className={cn('h-3 w-3', cfg.cls)} />
            <span className={cn('text-[10px] font-semibold', cfg.cls)}>{cfg.label}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">{cap(type)} · {fmtDate(date, { day: 'numeric', month: 'short' })}</p>
        {reason && <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">"{reason}"</p>}
        {status === 'rejected' && rejectedReason && (
          <p className="text-[10px] text-destructive/80 mt-0.5 truncate">Reason: {rejectedReason}</p>
        )}
      </div>
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({
  leaveRequests,
  regRequests,
  warnings,
}: {
  leaveRequests: LeaveRequest[]
  regRequests:   RegRequest[]
  warnings:      string[]
}) {
  const allRequests = useMemo(() => {
    const leave = leaveRequests.map(r => ({
      id: r.id, type: r.leave_type?.name ?? 'Leave', kind: 'leave' as const,
      date: r.from_date, status: r.status, reason: r.reason,
      rejectedReason: r.rejected_reason ?? null,
      label: r.leave_type?.name ?? 'Leave Request',
      createdAt: r.created_at,
    }))
    const reg = regRequests.map(r => ({
      id: r.id, type: r.regularization_type, kind: 'regularization' as const,
      date: r.date, status: r.status, reason: r.reason,
      rejectedReason: r.rejected_reason ?? null,
      label: cap(r.regularization_type),
      createdAt: r.created_at,
    }))
    return [...leave, ...reg].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  }, [leaveRequests, regRequests])

  const pending  = allRequests.filter(r => r.status === 'pending')
  const rejected = allRequests.filter(r => r.status === 'rejected')
  const recent   = allRequests.filter(r => r.status !== 'pending').slice(0, 5)

  const empty = allRequests.length === 0

  return (
    <div className="space-y-4">

      {/* Warnings from operational summary */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="text-sm font-semibold text-warning">Attention Required</span>
          </div>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-foreground/80 pl-6">{w}</p>
          ))}
        </div>
      )}

      {/* Pending requests */}
      {pending.length > 0 && (
        <SectionCard title={`${pending.length} Pending Approval${pending.length > 1 ? 's' : ''}`} icon={<Clock className="h-4 w-4 text-warning" />}>
          {pending.map(r => (
            <RequestRow
              key={r.id}
              type={r.type}
              label={r.label}
              date={r.date}
              status={r.status}
              reason={r.reason}
            />
          ))}
          <div className="pt-2">
            <Link to="/ess/approvals" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all requests <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </SectionCard>
      )}

      {/* Rejected — needs attention */}
      {rejected.length > 0 && (
        <SectionCard title="Rejected Requests" icon={<XCircle className="h-4 w-4 text-destructive" />}>
          {rejected.slice(0, 3).map(r => (
            <RequestRow
              key={r.id}
              type={r.type}
              label={r.label}
              date={r.date}
              status={r.status}
              reason={r.reason}
              rejectedReason={r.rejectedReason}
            />
          ))}
        </SectionCard>
      )}

      {/* Recent history */}
      {recent.length > 0 && (
        <SectionCard title="Recent Activity" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
          {recent.map(r => (
            <RequestRow
              key={r.id}
              type={r.type}
              label={r.label}
              date={r.date}
              status={r.status}
              reason={r.reason}
            />
          ))}
        </SectionCard>
      )}

      {/* Empty state */}
      {empty && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Inbox className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No requests yet</p>
          <p className="text-xs">Use the actions above to apply for leave or raise regularization.</p>
        </div>
      )}

    </div>
  )
}

// ── Tab: Employment ───────────────────────────────────────────────────────────

function EmploymentTab({ data }: { data: ProfileData }) {
  const { employee: emp, personal_info: pers, job_info: job } = data

  function Field({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border/40 last:border-0">
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide flex-shrink-0 w-36">{label}</span>
        <span className="text-xs text-foreground text-right">{value || '—'}</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      <div className="rounded-md bg-muted/30 border border-border/50 px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
        <Shield className="h-3 w-3 flex-shrink-0" />
        Employment information is managed by HR. Contact HR to request changes.
      </div>

      <SectionCard title="Job Details" icon={<Briefcase className="h-4 w-4 text-muted-foreground" />}>
        <Field label="Designation"      value={job?.designations?.name ?? '—'} />
        <Field label="Department"       value={job?.departments?.name ?? '—'} />
        <Field label="Grade"            value={job?.grades ? `${job.grades.name} (${job.grades.code})` : '—'} />
        <Field label="Employment Type"  value={cap(job?.employment_type)} />
        <Field label="Work Location"    value={job?.work_locations ? `${job.work_locations.name}, ${job.work_locations.city}` : '—'} />
        <Field label="Shift"            value={job?.shifts?.name ?? '—'} />
        <Field label="Reporting Manager" value={job?.manager ? `${job.manager.first_name} ${job.manager.last_name} · ${job.manager.employee_code}` : '—'} />
        <Field label="Date of Joining"  value={fmtDate(emp.joining_date)} />
        <Field label="Job Effective From" value={fmtDate(job?.effective_from)} />
      </SectionCard>

      <SectionCard title="Personal Information" icon={<User className="h-4 w-4 text-muted-foreground" />}>
        <Field label="Full Name"    value={`${emp.first_name} ${emp.last_name}`} />
        <Field label="Employee ID"  value={emp.employee_code} />
        <Field label="Email"        value={emp.email} />
        <Field label="Gender"       value={cap(pers?.gender)} />
        <Field label="Date of Birth" value={fmtDate(pers?.dob)} />
        <Field label="Blood Group"  value={pers?.blood_group ?? '—'} />
        <Field label="Nationality"  value={cap(pers?.nationality)} />
      </SectionCard>

      {/* Self-service Aadhaar verification (consent-gated, Phase 1) */}
      <AadhaarVerifyCard employeeId={emp.id} self />

    </div>
  )
}

// ── Tab: Attendance ───────────────────────────────────────────────────────────

function AttendanceTab({ summary, summaryLoading }: { summary: OperationalSummary | undefined; summaryLoading: boolean }) {

  if (summaryLoading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  )

  if (!summary) return (
    <div className="text-center py-12 text-muted-foreground">
      <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-50" />
      <p className="text-sm">Unable to load attendance data.</p>
    </div>
  )

  const stats = [
    { label: 'Present Days',    value: summary.present_days,                      color: 'text-success',     bg: 'bg-success/10'  },
    { label: 'Absent Days',     value: summary.absent_days,                       color: 'text-destructive', bg: 'bg-destructive/8' },
    { label: 'Late Arrivals',   value: summary.late_days,                         color: 'text-warning',     bg: 'bg-warning/8'   },
    { label: 'LOP Days',        value: summary.lop_days,                          color: 'text-destructive', bg: 'bg-destructive/5' },
    { label: 'Overtime Hours',  value: `${(summary.total_ot_hours ?? 0).toFixed(1)}h`,   color: 'text-info',        bg: 'bg-info/8'      },
  ]

  return (
    <div className="space-y-4">

      {/* Month stats */}
      <SectionCard title="This Month" icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.map(s => (
            <div key={s.label} className={cn('rounded-lg p-3', s.bg)}>
              <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Payroll impact preview */}
      <SectionCard title="Estimated Payroll Impact" icon={<Wallet className="h-4 w-4 text-muted-foreground" />}>
        <div className="space-y-2">
          <div className="flex justify-between items-center py-1.5 border-b border-border/30">
            <span className="text-xs text-muted-foreground">LOP Deduction</span>
            <span className={cn('text-xs font-semibold', summary.payroll_preview.lop_amount > 0 ? 'text-destructive' : 'text-foreground')}>
              {summary.payroll_preview.lop_amount > 0 ? `-${fmtCurrency(summary.payroll_preview.lop_amount)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-border/30">
            <span className="text-xs text-muted-foreground">Overtime Earn</span>
            <span className={cn('text-xs font-semibold', summary.payroll_preview.ot_amount > 0 ? 'text-success' : 'text-foreground')}>
              {summary.payroll_preview.ot_amount > 0 ? `+${fmtCurrency(summary.payroll_preview.ot_amount)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center py-1.5">
            <span className="text-xs font-medium text-foreground">Est. Net Pay</span>
            <span className="text-sm font-bold text-foreground">
              {summary.payroll_preview.estimated_net_payable > 0 ? fmtCurrency(summary.payroll_preview.estimated_net_payable) : '—'}
            </span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-2">Estimated based on current month data. Actual payslip may vary.</p>
      </SectionCard>

      <div className="flex gap-2">
        <Link to="/ess/attendance" className="flex-1">
          <Button variant="outline" size="sm" className="w-full text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" /> Full Attendance Calendar
          </Button>
        </Link>
        <Link to="/ess/attendance/regularization" className="flex-1">
          <Button variant="outline" size="sm" className="w-full text-xs">
            <Clock className="h-3.5 w-3.5 mr-1.5" /> Raise Regularisation
          </Button>
        </Link>
      </div>

    </div>
  )
}

// ── Tab: Leave ────────────────────────────────────────────────────────────────

function LeaveTab({
  summary,
  leaveRequests,
  summaryLoading,
}: {
  summary:        OperationalSummary | undefined
  leaveRequests:  LeaveRequest[]
  summaryLoading: boolean
}) {
  return (
    <div className="space-y-4">

      {/* Leave balances */}
      <SectionCard title="Leave Balances" icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}>
        {summaryLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
        ) : (summary?.leave_balance_by_type ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No leave balances found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {(summary?.leave_balance_by_type ?? []).map((lb, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-3 bg-muted/20">
                <p className="text-lg font-bold text-foreground">{lb.balance_days}d</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-medium leading-tight">
                  {lb.leave_type_name ?? 'Leave Type'}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Recent leave requests */}
      <SectionCard
        title="Leave Requests"
        icon={<CalendarOff className="h-4 w-4 text-muted-foreground" />}
        action={<Link to="/ess/leave/apply" className="text-xs text-primary hover:underline">Apply Leave</Link>}
      >
        {leaveRequests.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No leave requests yet.</p>
        ) : (
          leaveRequests.slice(0, 8).map(r => (
            <RequestRow
              key={r.id}
              type={r.leave_type?.name ?? 'leave'}
              label={r.leave_type?.name ?? 'Leave Request'}
              date={r.from_date}
              status={r.status}
              reason={r.reason}
              rejectedReason={r.rejected_reason}
            />
          ))
        )}
        <div className="pt-2">
          <Link to="/ess/leave/balance" className="text-xs text-primary hover:underline flex items-center gap-1">
            View leave ledger <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </SectionCard>

    </div>
  )
}

// ── Tab: Payroll ──────────────────────────────────────────────────────────────

function PayrollTab({ payslips, slipsLoading }: { payslips: Payslip[]; slipsLoading: boolean }) {
  return (
    <div className="space-y-4">
      <SectionCard
        title="My Payslips"
        icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
        action={<Link to="/ess/payroll/my-slips" className="text-xs text-primary hover:underline">View all</Link>}
      >
        {slipsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
        ) : payslips.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No payslips available yet.</p>
        ) : (
          <div className="space-y-0">
            {payslips.slice(0, 6).map(slip => (
              <div key={slip.id} className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0 gap-4">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {MONTH_NAMES[(slip.month ?? 1) - 1]} {slip.year}
                  </p>
                  <p className="text-[10px] text-muted-foreground capitalize">{slip.status}</p>
                </div>
                <div className="flex items-center gap-3">
                  {slip.net_pay != null && (
                    <span className="text-sm font-bold text-foreground">{fmtCurrency(slip.net_pay)}</span>
                  )}
                  <Link to="/ess/payroll/my-slips">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-2 gap-2">
        <Link to="/ess/declarations">
          <div className="rounded-lg border border-border p-3 bg-muted/20 hover:bg-muted/40 transition-colors">
            <FileText className="h-4 w-4 text-muted-foreground mb-1.5" />
            <p className="text-xs font-semibold text-foreground">Tax Declarations</p>
            <p className="text-[10px] text-muted-foreground">Investment proofs &amp; declarations</p>
          </div>
        </Link>
        <Link to="/ess/reimbursements">
          <div className="rounded-lg border border-border p-3 bg-muted/20 hover:bg-muted/40 transition-colors">
            <Receipt className="h-4 w-4 text-muted-foreground mb-1.5" />
            <p className="text-xs font-semibold text-foreground">Reimbursements</p>
            <p className="text-[10px] text-muted-foreground">Expense claims &amp; status</p>
          </div>
        </Link>
        <Link to="/ess/compensation">
          <div className="rounded-lg border border-border p-3 bg-muted/20 hover:bg-muted/40 transition-colors">
            <TrendingUp className="h-4 w-4 text-muted-foreground mb-1.5" />
            <p className="text-xs font-semibold text-foreground">My Compensation</p>
            <p className="text-[10px] text-muted-foreground">Salary structure overview</p>
          </div>
        </Link>
        <Link to="/ess/comp-off">
          <div className="rounded-lg border border-border p-3 bg-muted/20 hover:bg-muted/40 transition-colors">
            <CalendarOff className="h-4 w-4 text-muted-foreground mb-1.5" />
            <p className="text-xs font-semibold text-foreground">Comp-off</p>
            <p className="text-[10px] text-muted-foreground">Compensatory leave balance</p>
          </div>
        </Link>
      </div>

    </div>
  )
}

// ── Tab: Documents ────────────────────────────────────────────────────────────

function DocumentsTab({ payslips, slipsLoading }: { payslips: Payslip[]; slipsLoading: boolean }) {
  const categories = [
    {
      icon: Wallet,
      label: 'Payslips',
      desc: 'Monthly salary slips',
      href: '/ess/payroll/my-slips',
      count: payslips.length,
      loading: slipsLoading,
    },
    {
      icon: FileText,
      label: 'Tax Documents',
      desc: 'Form 16, TDS certificates',
      href: '/ess/declarations',
      count: null,
      loading: false,
    },
    {
      icon: Mail,
      label: 'HR Letters',
      desc: 'Offer, experience, relieving letters',
      href: '/ess/letters',
      count: null,
      loading: false,
    },
    {
      icon: BookOpen,
      label: 'My Documents',
      desc: 'Uploaded identity & personal docs',
      href: '/ess/documents',
      count: null,
      loading: false,
    },
    {
      icon: Shield,
      label: 'Policies',
      desc: 'Company policies & handbooks',
      href: '/ess/policies',
      count: null,
      loading: false,
    },
  ]

  return (
    <div className="space-y-3">
      {categories.map(cat => {
        const Icon = cat.icon
        return (
          <Link key={cat.href} to={cat.href}>
            <div className="flex items-center gap-4 p-3.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-primary/25 transition-colors group">
              <div className="w-9 h-9 rounded-lg bg-background border border-border/60 flex items-center justify-center flex-shrink-0">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground">{cat.label}</p>
                <p className="text-[10px] text-muted-foreground">{cat.desc}</p>
              </div>
              {cat.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : cat.count != null ? (
                <span className="text-[10px] font-semibold bg-muted border border-border/60 rounded-full px-2 py-0.5 text-muted-foreground">
                  {cat.count}
                </span>
              ) : null}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

/**
 * employeeId prop — optional. When omitted, defaults to the authenticated
 * user's own employee_id. Pass explicitly to render another employee's hub
 * (e.g. admin impersonation via ProfilePlatform).
 */
export function EssMyProfile({ employeeId: propEmployeeId }: { employeeId?: string | null } = {}) {
  const { profile }   = useAuthStore()
  const employeeId    = propEmployeeId ?? profile?.employee_id ?? null
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: profileData, isLoading: profileLoading, isError: profileError } =
    useQuery<ProfileData>({
      queryKey: ['ess-my-profile', employeeId],
      queryFn:  () => api.get(`/employees/${employeeId}/full-profile`),
      enabled:  !!employeeId,
      staleTime: 5 * 60_000,
    })

  const { data: summaryData, isLoading: summaryLoading } =
    useQuery<OperationalSummary>({
      queryKey: ['ess-operational-summary'],
      queryFn:  () => api.get('/ess/operational-summary'),
      enabled:  !!employeeId,
      staleTime: 3 * 60_000,
    })

  // Canonical source is `leave_requests` (served by /leave/my-requests) — NOT
  // the legacy `leave_applications` behind /attendance/leave/my, where
  // submitted leave never appeared. Field names/casing differ from this
  // page's LeaveRequest shape (leave_types plural + rejection_reason +
  // status UPPERCASE) so they're mapped here rather than at every read site.
  const { data: leaveData } =
    useQuery<{ data: LeaveRequest[] }>({
      queryKey: ['ess-leave-my', employeeId],
      queryFn:  async () => {
        const res = await api.get('/leave/my-requests?limit=100') as {
          data: Array<{
            id: string; status: string; from_date: string; to_date: string
            computed_days?: number; calculated_days?: number
            reason: string | null; created_at: string
            rejection_reason?: string | null
            leave_types?: { name: string } | null
          }>
        }
        const rows: LeaveRequest[] = (res.data ?? []).map(r => ({
          id:              r.id,
          status:          String(r.status ?? '').toLowerCase(),
          leave_type:      r.leave_types ?? null,
          from_date:       r.from_date,
          to_date:         r.to_date,
          days_requested:  r.computed_days ?? r.calculated_days ?? 0,
          reason:          r.reason,
          created_at:      r.created_at,
          rejected_reason: r.rejection_reason ?? null,
        }))
        return { data: rows }
      },
      enabled:  !!employeeId,
      staleTime: 2 * 60_000,
    })

  const { data: regData } =
    useQuery<{ data: RegRequest[] }>({
      queryKey: ['ess-reg-my'],
      queryFn:  () => api.get('/attendance/regularisation/my'),
      enabled:  !!employeeId,
      staleTime: 2 * 60_000,
    })

  const { data: compOffData } =
    useQuery<{ data: CompOffRecord[] }>({
      queryKey: ['ess-comp-off'],
      queryFn:  () => api.get('/attendance/comp-off'),
      enabled:  !!employeeId,
      staleTime: 5 * 60_000,
    })

  const { data: slipsData, isLoading: slipsLoading } =
    useQuery<{ data: Payslip[] }>({
      queryKey: ['ess-my-slips'],
      queryFn:  () => api.get('/payroll/my-slips'),
      enabled:  !!employeeId,
      staleTime: 10 * 60_000,
    })

  const { data: holidaysData } =
    useQuery<Holiday[]>({
      queryKey: ['ess-holidays', new Date().getFullYear()],
      queryFn:  () => api.get<Holiday[] | { data?: Holiday[] }>(`/masters/holidays?year=${new Date().getFullYear()}`).then(r => Array.isArray(r) ? r : (r?.data ?? [])),
      enabled:  !!employeeId,
      staleTime: 60 * 60_000,
    })

  // ── Derived ────────────────────────────────────────────────────────────────

  const leaveRequests = leaveData?.data  ?? []
  const regRequests   = regData?.data    ?? []
  const compOffs      = compOffData?.data ?? []
  const payslips      = slipsData?.data  ?? []
  const holidays      = holidaysData     ?? []

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 text-warning opacity-60" />
          <p className="text-sm font-medium text-foreground">Profile not linked</p>
          <p className="text-xs text-center max-w-xs">Your account is not linked to an employee record. Please contact HR to set up your profile.</p>
        </div>
      </PageContainer>
    )
  }

  if (profileLoading) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your profile…</p>
        </div>
      </PageContainer>
    )
  }

  if (profileError || !profileData) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load profile. Please refresh.</p>
        </div>
      </PageContainer>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>

      {/* ── Profile hero ──────────────────────────────────────────────────── */}
      <ProfileHero data={profileData} />

      {/* ── Quick status strip ────────────────────────────────────────────── */}
      <QuickStatusStrip
        summary={summaryData}
        leaveRequests={leaveRequests}
        regRequests={regRequests}
        compOffs={compOffs}
        payslips={payslips}
        holidays={holidays}
        summaryLoading={summaryLoading}
      />

      {/* ── Primary actions ───────────────────────────────────────────────── */}
      <PrimaryActions />

      {/* ── Tab navigation ───────────────────────────────────────────────── */}
      <div className="mb-4 overflow-x-auto scrollbar-none">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/50 border border-border/60">
          {TABS.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap rounded-lg transition-all',
                  active
                    ? 'bg-card text-primary shadow-elev-1'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/60',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <OverviewTab
          leaveRequests={leaveRequests}
          regRequests={regRequests}
          warnings={summaryData?.warnings ?? []}
        />
      )}
      {activeTab === 'personal' && (
        <MyPersonalTab employeeId={employeeId} />
      )}
      {activeTab === 'employment' && (
        <EmploymentTab data={profileData} />
      )}
      {activeTab === 'attendance' && (
        <AttendanceTab summary={summaryData} summaryLoading={summaryLoading} />
      )}
      {activeTab === 'leave' && (
        <LeaveTab
          summary={summaryData}
          leaveRequests={leaveRequests}
          summaryLoading={summaryLoading}
        />
      )}
      {activeTab === 'payroll' && (
        <PayrollTab payslips={payslips} slipsLoading={slipsLoading} />
      )}
      {activeTab === 'documents' && (
        <DocumentsTab payslips={payslips} slipsLoading={slipsLoading} />
      )}

    </PageContainer>
  )
}
