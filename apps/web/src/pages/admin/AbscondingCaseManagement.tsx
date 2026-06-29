import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Clock, CheckCircle2, XCircle, FileText,
  UserX, ChevronRight, Send, Phone, Mail, MessageSquare,
  Shield, Loader2, RefreshCw, Search, Filter, MoreHorizontal,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api/client'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SubTabs }        from '@/components/ui/SubTabs'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import { Textarea }       from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type CaseStatus =
  | 'flagged' | 'wl1_sent' | 'wl2_sent'
  | 'termination_pending' | 'terminated' | 'resolved' | 'closed'

type TabId = 'all' | 'flagged' | 'wl1_sent' | 'wl2_sent' | 'termination_pending' | 'resolved'

interface AbscondingCase {
  id: string
  status: CaseStatus
  first_ua_date: string
  last_ua_date: string | null
  ua_days_count: number
  wl1_sent_at: string | null
  wl2_sent_at: string | null
  chro_approval_required: boolean
  created_at: string
  updated_at: string
  employee: {
    id: string
    employee_code: string
    first_name: string
    last_name: string
    status: string
    date_of_joining: string
    work_email: string | null
    personal_phone: string | null
    department: { name: string } | null
    designation: { title: string } | null
    manager: { first_name: string; last_name: string } | null
  }
  assigned_to_profile: { id: string; full_name: string; avatar_url: string | null } | null
  chro_profile: { id: string; full_name: string } | null
  employee_response: string | null
  employee_response_at: string | null
  response_channel: string | null
  resolved_reason: string | null
}

interface CaseComm {
  id: string
  comm_type: string
  direction: 'outbound' | 'inbound' | 'internal'
  subject: string | null
  body: string | null
  channel: string | null
  created_at: string
  sent_by_profile: { id: string; full_name: string; avatar_url: string | null } | null
}

interface DashboardData {
  counts: Record<string, number>
  total_open: number
  avg_ua_days: number
  opened_30d: number
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CaseStatus, { label: string; color: string; icon: React.ElementType }> = {
  flagged:              { label: 'Flagged',             color: 'text-amber-600 bg-amber-50 border-amber-200',    icon: AlertTriangle },
  wl1_sent:             { label: 'WL1 Sent',            color: 'text-orange-600 bg-orange-50 border-orange-200', icon: FileText },
  wl2_sent:             { label: 'WL2 Sent (Final)',    color: 'text-red-600 bg-red-50 border-red-200',          icon: FileText },
  termination_pending:  { label: 'Pending Approval',    color: 'text-red-700 bg-red-100 border-red-300',         icon: Shield },
  terminated:           { label: 'Terminated',          color: 'text-muted-foreground bg-muted border-border',   icon: XCircle },
  resolved:             { label: 'Resolved',            color: 'text-green-700 bg-green-50 border-green-200',    icon: CheckCircle2 },
  closed:               { label: 'Closed',              color: 'text-muted-foreground bg-muted border-border',   icon: CheckCircle2 },
}

const COMM_ICONS: Record<string, React.ElementType> = {
  letter_generated: FileText,
  email_sent:       Mail,
  whatsapp_sent:    MessageSquare,
  call_attempted:   Phone,
  employee_response: UserX,
  hr_note:          MessageSquare,
  system_event:     Clock,
}

function StatusBadge({ status }: { status: CaseStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.flagged
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function empName(emp: AbscondingCase['employee']) {
  return `${emp.first_name} ${emp.last_name}`
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone = 'default' }: {
  label: string; value: number | string; sub?: string; tone?: 'default' | 'warn' | 'danger'
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4',
      tone === 'danger' ? 'border-red-200 bg-red-50' :
      tone === 'warn'   ? 'border-amber-200 bg-amber-50' :
      'border-border bg-card',
    )}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={cn(
        'mt-1 text-2xl font-bold',
        tone === 'danger' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-foreground',
      )}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AbscondingCaseManagement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab  = (searchParams.get('tab') as TabId | null) ?? 'all'
  const activeCaseId = searchParams.get('case')
  const [search, setSearch]   = React.useState('')
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [selectedCaseId, setSelectedCaseId] = React.useState<string | null>(activeCaseId)

  const qc = useQueryClient()

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', t)
    next.delete('case')
    setSearchParams(next, { replace: true })
  }

  function openCase(id: string) {
    setSelectedCaseId(id)
    setDetailOpen(true)
    const next = new URLSearchParams(searchParams)
    next.set('case', id)
    setSearchParams(next, { replace: true })
  }

  const statusFilter = activeTab === 'all' ? 'all' : activeTab

  // Dashboard stats
  const { data: dash } = useQuery<DashboardData>({
    queryKey: ['absconding-dashboard'],
    queryFn:  () => api.get<{ data: DashboardData }>('/absconding/dashboard').then(r => r.data),
  })

  // Case list
  const { data: listData, isLoading } = useQuery<{ data: AbscondingCase[]; total: number }>({
    queryKey: ['absconding-cases', statusFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (statusFilter !== 'all') qs.set('status', statusFilter)
      if (search) qs.set('search', search)
      qs.set('limit', '50')
      return api.get<{ data: AbscondingCase[]; total: number }>(`/absconding/cases?${qs.toString()}`)
    },
  })

  const cases = listData?.data ?? []

  const tabs: Array<{ id: TabId; label: string; badge?: number }> = [
    { id: 'all',                label: 'All Cases',      badge: dash?.total_open },
    { id: 'flagged',            label: 'Flagged',        badge: dash?.counts.flagged },
    { id: 'wl1_sent',           label: 'WL1 Sent',      badge: dash?.counts.wl1_sent },
    { id: 'wl2_sent',           label: 'WL2 Sent',      badge: dash?.counts.wl2_sent },
    { id: 'termination_pending',label: 'Pending CHRO',  badge: dash?.counts.termination_pending },
    { id: 'resolved',           label: 'Resolved' },
  ]

  const scanMutation = useMutation({
    mutationFn: () => api.post('/absconding/scan'),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['absconding-cases'] }); qc.invalidateQueries({ queryKey: ['absconding-dashboard'] }) },
  })

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        breadcrumb={[{ label: 'Admin' }, { label: 'Compliance' }]}
        title="Absconding Cases"
        subtitle="Track and manage employees absent without authorisation"
        actions={
          <Button
            size="sm" variant="outline"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Run Scan
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open Cases"           value={dash?.total_open ?? 0} sub="active monitoring" />
        <StatCard label="Avg UA Days"          value={dash?.avg_ua_days ?? 0} sub="open cases" tone={(dash?.avg_ua_days ?? 0) >= 14 ? 'danger' : (dash?.avg_ua_days ?? 0) >= 7 ? 'warn' : 'default'} />
        <StatCard label="Pending CHRO"         value={dash?.counts.termination_pending ?? 0} sub="approval required" tone={(dash?.counts.termination_pending ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Opened (30 days)"     value={dash?.opened_30d ?? 0} sub="new cases" />
      </div>

      {/* Tabs + search */}
      <div className="space-y-3">
        <SubTabs
          tabs={tabs.map(t => ({ id: t.id, label: t.label, badge: t.badge }))}
          value={activeTab}
          onChange={setTab}
          rightSlot={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs w-48"
                placeholder="Search employee…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          }
        />

        {/* Case table */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : cases.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <UserX className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No cases found</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Employee</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">First Absent</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Days UA</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Last Update</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {cases.map((c, idx) => (
                  <tr
                    key={c.id}
                    className={cn(
                      'border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors',
                      idx === cases.length - 1 && 'border-0',
                    )}
                    onClick={() => openCase(c.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {initials(empName(c.employee))}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-[13px]">{empName(c.employee)}</p>
                          <p className="text-[11px] text-muted-foreground">{c.employee.employee_code} · {c.employee.department?.name ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px]">
                      {c.first_ua_date ? format(new Date(c.first_ua_date), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'font-bold text-sm',
                        c.ua_days_count >= 21 ? 'text-red-600' :
                        c.ua_days_count >= 14 ? 'text-orange-600' :
                        c.ua_days_count >= 7  ? 'text-amber-600' : 'text-foreground',
                      )}>
                        {c.ua_days_count}
                      </span>
                      <span className="text-[11px] text-muted-foreground ml-1">days</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Case detail drawer */}
      {selectedCaseId && (
        <CaseDetailSheet
          caseId={selectedCaseId}
          open={detailOpen}
          onClose={() => {
            setDetailOpen(false)
            const next = new URLSearchParams(searchParams)
            next.delete('case')
            setSearchParams(next, { replace: true })
          }}
          onActionComplete={() => {
            qc.invalidateQueries({ queryKey: ['absconding-cases'] })
            qc.invalidateQueries({ queryKey: ['absconding-dashboard'] })
          }}
        />
      )}
    </div>
  )
}

// ── Case Detail Sheet ─────────────────────────────────────────────────────────

function CaseDetailSheet({
  caseId, open, onClose, onActionComplete,
}: {
  caseId: string
  open: boolean
  onClose: () => void
  onActionComplete: () => void
}) {
  const [commTab, setCommTab] = React.useState<'timeline' | 'log' | 'notes'>('timeline')
  const [noteText, setNoteText] = React.useState('')
  const [resolveOpen, setResolveOpen]   = React.useState(false)
  const [approveOpen, setApproveOpen]   = React.useState(false)
  const [letterOpen, setLetterOpen]     = React.useState<'wl1' | 'wl2' | 'termination' | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ data: AbscondingCase }>({
    queryKey: ['absconding-case', caseId],
    queryFn:  () => api.get<{ data: AbscondingCase }>(`/absconding/cases/${caseId}`),
    enabled:  open && !!caseId,
  })

  const { data: commData } = useQuery<{ data: CaseComm[] }>({
    queryKey: ['absconding-comms', caseId],
    queryFn:  () => api.get<{ data: CaseComm[] }>(`/absconding/cases/${caseId}/communications`),
    enabled:  open && !!caseId,
  })

  const c = (data as { data: AbscondingCase } | undefined)?.data
  const comms = (commData as { data: CaseComm[] } | undefined)?.data ?? []

  const noteMutation = useMutation({
    mutationFn: () => api.post(`/absconding/cases/${caseId}/communications`, {
      comm_type: 'hr_note', direction: 'internal', body: noteText,
    }),
    onSuccess: () => {
      setNoteText('')
      qc.invalidateQueries({ queryKey: ['absconding-comms', caseId] })
    },
  })

  const letterMutation = useMutation({
    mutationFn: (lt: 'wl1' | 'wl2' | 'termination') =>
      api.post(`/absconding/cases/${caseId}/letters`, { letter_type: lt }),
    onSuccess: () => {
      setLetterOpen(null)
      qc.invalidateQueries({ queryKey: ['absconding-case', caseId] })
      qc.invalidateQueries({ queryKey: ['absconding-comms', caseId] })
      onActionComplete()
    },
  })

  if (!open) return null

  const timelineSteps = [
    {
      key: 'flagged',
      label: 'Case Flagged',
      sub: c ? `${c.ua_days_count} days UA · First absent ${c.first_ua_date ? format(new Date(c.first_ua_date), 'dd MMM yyyy') : '—'}` : '',
      done: true,
      date: c?.created_at,
    },
    {
      key: 'wl1_sent',
      label: 'Warning Letter 1 Sent',
      sub: 'Formal notice — 7 days to respond',
      done: !!c?.wl1_sent_at,
      date: c?.wl1_sent_at,
    },
    {
      key: 'wl2_sent',
      label: 'Warning Letter 2 Sent (Final)',
      sub: 'Final warning — 7 days or termination',
      done: !!c?.wl2_sent_at,
      date: c?.wl2_sent_at,
    },
    {
      key: 'termination_pending',
      label: 'CHRO Approval',
      sub: c?.chro_profile ? `Reviewed by ${c.chro_profile.full_name}` : 'Pending review',
      done: c?.status === 'terminated',
      date: c?.status === 'terminated' ? c.updated_at : null,
    },
  ]

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent size="lg" className="w-full overflow-y-auto p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="text-base font-semibold">Case Detail</SheetTitle>
          {isLoading ? (
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : c ? (
            <div className="flex items-start justify-between mt-2">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">
                    {initials(empName(c.employee))}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-sm">{empName(c.employee)}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {c.employee.employee_code} · {c.employee.designation?.title ?? '—'} · {c.employee.department?.name ?? '—'}
                  </p>
                </div>
              </div>
              <StatusBadge status={c.status} />
            </div>
          ) : null}
        </SheetHeader>

        {c && (
          <>
            {/* UA summary */}
            <div className="px-6 py-4 bg-muted/30 border-b border-border flex items-center gap-6">
              <div className="text-center">
                <p className={cn('text-2xl font-bold', c.ua_days_count >= 14 ? 'text-red-600' : c.ua_days_count >= 7 ? 'text-orange-600' : 'text-amber-600')}>
                  {c.ua_days_count}
                </p>
                <p className="text-[11px] text-muted-foreground">UA Days</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{c.first_ua_date ? format(new Date(c.first_ua_date), 'dd MMM yy') : '—'}</p>
                <p className="text-[11px] text-muted-foreground">First Absent</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{c.employee.work_email ?? '—'}</p>
                <p className="text-[11px] text-muted-foreground">Work Email</p>
              </div>
              {c.employee.personal_phone && (
                <div className="text-center">
                  <p className="text-sm font-medium">{c.employee.personal_phone}</p>
                  <p className="text-[11px] text-muted-foreground">Mobile</p>
                </div>
              )}
            </div>

            {/* Employee response (if any) */}
            {c.employee_response && (
              <div className="mx-6 mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-xs font-medium text-green-700 mb-1">Employee Response Received</p>
                <p className="text-sm text-green-800">{c.employee_response}</p>
                {c.employee_response_at && (
                  <p className="text-[11px] text-green-600 mt-1">
                    {format(new Date(c.employee_response_at), 'dd MMM yyyy, HH:mm')} · {c.response_channel ?? 'unknown channel'}
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="px-6 py-4 border-b border-border flex flex-wrap gap-2">
              {c.status === 'flagged' && (
                <>
                  <Button size="sm" onClick={() => setLetterOpen('wl1')} disabled={letterMutation.isPending}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Send Warning Letter 1
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResolveOpen(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Mark Resolved
                  </Button>
                </>
              )}
              {c.status === 'wl1_sent' && (
                <>
                  <Button size="sm" onClick={() => setLetterOpen('wl2')} disabled={letterMutation.isPending}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Send Warning Letter 2
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResolveOpen(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Mark Resolved
                  </Button>
                </>
              )}
              {c.status === 'wl2_sent' && (
                <>
                  <Button size="sm" variant="destructive" onClick={() => setLetterOpen('termination')} disabled={letterMutation.isPending}>
                    <Shield className="h-3.5 w-3.5 mr-1.5" />
                    Request CHRO Approval
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResolveOpen(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Mark Resolved
                  </Button>
                </>
              )}
              {c.status === 'termination_pending' && (
                <Button size="sm" variant="destructive" onClick={() => setApproveOpen(true)}>
                  <Shield className="h-3.5 w-3.5 mr-1.5" />
                  Review Termination
                </Button>
              )}
              {['terminated', 'resolved', 'closed'].includes(c.status) && (
                <span className="text-sm text-muted-foreground italic">
                  {c.status === 'terminated' ? 'Employee terminated. FnF in progress.' :
                   c.status === 'resolved'   ? `Resolved: ${c.resolved_reason}` :
                   `Closed: ${c.resolved_reason}`}
                </span>
              )}
            </div>

            {/* Tabs: Timeline / Comm log / Notes */}
            <div className="px-6 pt-3 border-b border-border">
              <div className="flex gap-1">
                {(['timeline', 'log', 'notes'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setCommTab(t)}
                    className={cn(
                      'px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors',
                      commTab === t ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t === 'timeline' ? 'Timeline' : t === 'log' ? 'Communication Log' : 'HR Notes'}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 py-4">
              {commTab === 'timeline' && (
                <div className="space-y-0">
                  {timelineSteps.map((step, i) => (
                    <div key={step.key} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                          step.done ? 'border-primary bg-primary/10' : 'border-border bg-background',
                        )}>
                          {step.done && <div className="h-2 w-2 rounded-full bg-primary" />}
                        </div>
                        {i < timelineSteps.length - 1 && (
                          <div className={cn('w-0.5 flex-1 my-1', step.done ? 'bg-primary/30' : 'bg-border')} style={{ minHeight: 24 }} />
                        )}
                      </div>
                      <div className="pb-4">
                        <p className={cn('text-sm font-medium', step.done ? 'text-foreground' : 'text-muted-foreground')}>{step.label}</p>
                        <p className="text-[12px] text-muted-foreground">{step.sub}</p>
                        {step.date && (
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {format(new Date(step.date), 'dd MMM yyyy, HH:mm')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {commTab === 'log' && (
                <div className="space-y-3">
                  {comms.filter(comm => comm.comm_type !== 'hr_note').length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No communication logged yet.</p>
                  ) : comms.filter(comm => comm.comm_type !== 'hr_note').map(comm => {
                    const Icon = COMM_ICONS[comm.comm_type] ?? MessageSquare
                    return (
                      <div key={comm.id} className="flex gap-3 items-start">
                        <div className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0',
                          comm.direction === 'inbound' ? 'bg-green-100' :
                          comm.direction === 'outbound' ? 'bg-blue-100' : 'bg-muted',
                        )}>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium">{comm.subject ?? comm.comm_type.replace(/_/g, ' ')}</p>
                          {comm.body && <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{comm.body}</p>}
                          <p className="text-[11px] text-muted-foreground/70 mt-1">
                            {comm.sent_by_profile?.full_name ?? 'System'} · {format(new Date(comm.created_at), 'dd MMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {commTab === 'notes' && (
                <div className="space-y-4">
                  {comms.filter(comm => comm.comm_type === 'hr_note').map(note => (
                    <div key={note.id} className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-[13px]">{note.body}</p>
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        {note.sent_by_profile?.full_name ?? 'HR'} · {format(new Date(note.created_at), 'dd MMM yyyy, HH:mm')}
                      </p>
                    </div>
                  ))}
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Add an internal note…"
                      className="text-sm min-h-[80px]"
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={!noteText.trim() || noteMutation.isPending}
                      onClick={() => noteMutation.mutate()}
                    >
                      {noteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                      Add Note
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>

      {/* Letter confirmation dialog */}
      <Dialog open={!!letterOpen} onOpenChange={v => { if (!v) setLetterOpen(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {letterOpen === 'wl1' ? 'Issue Warning Letter 1' :
               letterOpen === 'wl2' ? 'Issue Warning Letter 2 (Final)' :
               'Request Termination Approval'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {letterOpen === 'wl1'
              ? 'This will generate and log a formal Warning Letter 1 for the employee, requesting explanation within 7 days.'
              : letterOpen === 'wl2'
              ? 'This is the final warning. The letter will be generated and the case escalated. No further response gives grounds for termination.'
              : 'This will escalate the case to CHRO for termination approval. A termination letter will be generated upon approval.'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLetterOpen(null)}>Cancel</Button>
            <Button
              variant={letterOpen === 'termination' ? 'destructive' : 'default'}
              disabled={letterMutation.isPending}
              onClick={() => letterOpen && letterMutation.mutate(letterOpen)}
            >
              {letterMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve dialog */}
      <ResolveDialog
        open={resolveOpen}
        caseId={caseId}
        onClose={() => setResolveOpen(false)}
        onSuccess={() => {
          setResolveOpen(false)
          qc.invalidateQueries({ queryKey: ['absconding-case', caseId] })
          qc.invalidateQueries({ queryKey: ['absconding-comms', caseId] })
          onActionComplete()
        }}
      />

      {/* Approve termination dialog */}
      <ApproveTerminationDialog
        open={approveOpen}
        caseId={caseId}
        onClose={() => setApproveOpen(false)}
        onSuccess={() => {
          setApproveOpen(false)
          qc.invalidateQueries({ queryKey: ['absconding-case', caseId] })
          onActionComplete()
        }}
      />
    </Sheet>
  )
}

// ── Resolve dialog ────────────────────────────────────────────────────────────

function ResolveDialog({
  open, caseId, onClose, onSuccess,
}: {
  open: boolean; caseId: string; onClose: () => void; onSuccess: () => void
}) {
  const [remarks, setRemarks]     = React.useState('')
  const [resolution, setResolution] = React.useState<'resolved' | 'closed'>('resolved')

  const mutation = useMutation({
    mutationFn: () => api.patch(`/absconding/cases/${caseId}/status`, { status: resolution, remarks }),
    onSuccess,
  })

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Close Case</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={resolution} onValueChange={v => setResolution(v as any)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="resolved">Resolved — employee returned / situation clarified</SelectItem>
              <SelectItem value="closed">Closed — no further action required</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Reason for closing (required)…"
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            className="text-sm min-h-[80px]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!remarks.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Close Case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Approve termination dialog ────────────────────────────────────────────────

function ApproveTerminationDialog({
  open, caseId, onClose, onSuccess,
}: {
  open: boolean; caseId: string; onClose: () => void; onSuccess: () => void
}) {
  const [remarks, setRemarks]   = React.useState('')
  const [approved, setApproved] = React.useState<boolean | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post(`/absconding/cases/${caseId}/approve-termination`, { approved, remarks }),
    onSuccess,
  })

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Review Termination Request</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Both warning letters have been issued with no employee response. Please review and decide.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setApproved(true)}
              className={cn(
                'rounded-lg border p-3 text-sm font-medium transition-colors',
                approved === true ? 'border-red-400 bg-red-50 text-red-700' : 'border-border hover:bg-muted',
              )}
            >
              Approve Termination
            </button>
            <button
              onClick={() => setApproved(false)}
              className={cn(
                'rounded-lg border p-3 text-sm font-medium transition-colors',
                approved === false ? 'border-green-400 bg-green-50 text-green-700' : 'border-border hover:bg-muted',
              )}
            >
              Reject — Return to HR
            </button>
          </div>
          <Textarea
            placeholder="Remarks (required)…"
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            className="text-sm min-h-[80px]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={approved === true ? 'destructive' : 'default'}
            disabled={approved === null || !remarks.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {approved === true ? 'Approve & Terminate' : 'Reject & Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
