/**
 * AdminInterviews — /admin/recruitment/interviews  (INT-01, INT-04b)
 *
 * Schedule interview rounds linked to applications, assign panel members,
 * set type/date/meet-link. Update status (complete / cancel / no-show).
 * Timeline view per candidate shows all rounds across all their applications.
 *
 * Access: hr_admin / super_admin.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck, Plus, RefreshCw, Search, Video, Phone,
  Users, MapPin, Clock, MoreHorizontal, CheckCircle2,
  XCircle, UserX, ChevronDown, Briefcase, UserCircle2,
  CalendarDays, AlarmClock, Star,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Label }         from '@/components/ui/label'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InterviewRound {
  id:             string
  application_id: string
  round_number:   number
  title:          string | null
  interview_type: string
  scheduled_at:   string | null
  duration_mins:  number
  meet_link:      string | null
  status:         string
  notes:          string | null
  created_at:     string
  applications: {
    id: string
    status: string
    candidates: { id: string; first_name: string; last_name: string; email: string; current_company: string | null }
    job_requisitions: { id: string; title: string } | null
  } | null
  interview_panel: { interviewer_id: string; profiles: { id: string; full_name: string } | null }[]
}

interface Requisition  { id: string; title: string }
interface Application  { id: string; status: string; candidates: { first_name: string; last_name: string }; job_requisitions: { title: string } | null }
interface Interviewer  { id: string; full_name: string; role: string }

interface RoundForm {
  application_id:  string
  round_number:    string
  title:           string
  interview_type:  string
  scheduled_at:    string
  scheduled_time:  string
  duration_mins:   string
  meet_link:       string
  notes:           string
  interviewer_ids: string[]
}

const EMPTY_FORM: RoundForm = {
  application_id: '', round_number: '1', title: '',
  interview_type: 'video', scheduled_at: '', scheduled_time: '10:00',
  duration_mins: '60', meet_link: '', notes: '', interviewer_ids: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  video:      { label: 'Video',     icon: <Video     className="h-3.5 w-3.5" /> },
  phone:      { label: 'Phone',     icon: <Phone     className="h-3.5 w-3.5" /> },
  in_person:  { label: 'In-person', icon: <MapPin    className="h-3.5 w-3.5" /> },
  assignment: { label: 'Task',      icon: <Briefcase className="h-3.5 w-3.5" /> },
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  scheduled:  { label: 'Scheduled',  className: 'text-blue-600   bg-blue-50   border-blue-200'   },
  completed:  { label: 'Completed',  className: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  cancelled:  { label: 'Cancelled',  className: 'text-gray-500   bg-gray-50   border-gray-200'   },
  no_show:    { label: 'No-show',    className: 'text-red-600    bg-red-50    border-red-200'     },
}

function fmtDT(s: string | null): string {
  if (!s) return 'TBD'
  const d = new Date(s)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function isToday(s: string | null): boolean {
  if (!s) return false
  const d = new Date(s)
  const now = new Date()
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

function isTomorrow(s: string | null): boolean {
  if (!s) return false
  const d = new Date(s)
  const tom = new Date(); tom.setDate(tom.getDate() + 1)
  return d.getDate() === tom.getDate() && d.getMonth() === tom.getMonth() && d.getFullYear() === tom.getFullYear()
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminInterviews() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('scheduled')
  const [reqFilter,    setReqFilter]    = useState('all')

  const [sheetOpen,    setSheetOpen]    = useState(false)
  const [editTarget,   setEditTarget]   = useState<InterviewRound | null>(null)
  const [form,         setForm]         = useState<RoundForm>(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: reqData } = useQuery<{ data: Requisition[] }>({
    queryKey: ['recruitment', 'requisitions', 'all'],
    queryFn:  () => api.get('/recruitment/requisitions?limit=100'),
    enabled:  isAdmin,
  })
  const requisitions = reqData?.data ?? []

  const { data: appData } = useQuery<{ data: Application[] }>({
    queryKey: ['recruitment', 'applications', 'for-interviews', reqFilter],
    queryFn:  () => {
      const p = new URLSearchParams({ limit: '200' })
      if (reqFilter !== 'all') p.set('requisition_id', reqFilter)
      return api.get(`/recruitment/applications?${p}`)
    },
    enabled: isAdmin,
  })
  const applications = appData?.data ?? []

  const { data: ivrData } = useQuery<{ data: Interviewer[] }>({
    queryKey: ['recruitment', 'interviewers'],
    queryFn:  () => api.get('/recruitment/interviewers'),
    enabled:  isAdmin,
  })
  const interviewers = ivrData?.data ?? []

  const params = new URLSearchParams({ limit: '100' })
  if (statusFilter !== 'all') params.set('status', statusFilter)
  if (reqFilter    !== 'all') params.set('requisition_id', reqFilter)

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: InterviewRound[]; total: number }>({
    queryKey: ['recruitment', 'interviews', statusFilter, reqFilter],
    queryFn:  () => api.get(`/recruitment/interviews?${params}`),
    enabled:  isAdmin,
  })
  const rows = data?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────

  function invalidate() { qc.invalidateQueries({ queryKey: ['recruitment', 'interviews'] }) }

  async function transition(id: string, action: string, label: string) {
    try {
      await api.post(`/recruitment/interviews/${id}/${action}`, {})
      toast.success(label)
      invalidate()
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Action failed')
    }
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/recruitment/interviews/${id}`),
    onSuccess:  () => { toast.success('Interview deleted'); invalidate() },
    onError:    (e: any) => toast.error(e?.response?.data?.message ?? 'Delete failed'),
  })

  // ── Sheet helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setSheetOpen(true)
  }

  function openEdit(r: InterviewRound) {
    setEditTarget(r)
    const dt = r.scheduled_at ? new Date(r.scheduled_at) : null
    setForm({
      application_id:  r.application_id,
      round_number:    String(r.round_number),
      title:           r.title ?? '',
      interview_type:  r.interview_type,
      scheduled_at:    dt ? dt.toISOString().slice(0, 10) : '',
      scheduled_time:  dt ? dt.toTimeString().slice(0, 5) : '10:00',
      duration_mins:   String(r.duration_mins),
      meet_link:       r.meet_link ?? '',
      notes:           r.notes ?? '',
      interviewer_ids: r.interview_panel.map(p => p.interviewer_id),
    })
    setSheetOpen(true)
  }

  function toggleInterviewer(id: string) {
    setForm(f => ({
      ...f,
      interviewer_ids: f.interviewer_ids.includes(id)
        ? f.interviewer_ids.filter(i => i !== id)
        : [...f.interviewer_ids, id],
    }))
  }

  async function handleSave() {
    if (!form.application_id) { toast.error('Application is required'); return }
    setSaving(true)
    try {
      let scheduledAt: string | null = null
      if (form.scheduled_at) {
        scheduledAt = new Date(`${form.scheduled_at}T${form.scheduled_time}:00`).toISOString()
      }
      const payload: any = {
        application_id:  form.application_id,
        round_number:    parseInt(form.round_number) || 1,
        title:           form.title || null,
        interview_type:  form.interview_type,
        scheduled_at:    scheduledAt,
        duration_mins:   parseInt(form.duration_mins) || 60,
        meet_link:       form.meet_link || null,
        notes:           form.notes || null,
        interviewer_ids: form.interviewer_ids,
      }
      if (editTarget) {
        const { application_id, ...updatePayload } = payload
        await api.put(`/recruitment/interviews/${editTarget.id}`, updatePayload)
        toast.success('Interview updated')
      } else {
        await api.post('/recruitment/interviews', payload)
        toast.success('Interview scheduled')
      }
      setSheetOpen(false)
      invalidate()
      qc.invalidateQueries({ queryKey: ['recruitment', 'applications'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <CalendarCheck className="h-8 w-8" />
          <p className="text-sm">Interview management is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  // Group by date label
  const groups: { label: string; items: InterviewRound[] }[] = []
  const today: InterviewRound[] = [], tomorrow: InterviewRound[] = [], later: InterviewRound[] = [], noDate: InterviewRound[] = []
  for (const r of rows) {
    if (!r.scheduled_at) noDate.push(r)
    else if (isToday(r.scheduled_at)) today.push(r)
    else if (isTomorrow(r.scheduled_at)) tomorrow.push(r)
    else later.push(r)
  }
  if (today.length)    groups.push({ label: 'Today',    items: today })
  if (tomorrow.length) groups.push({ label: 'Tomorrow', items: tomorrow })
  if (later.length)    groups.push({ label: 'Upcoming', items: later })
  if (noDate.length)   groups.push({ label: 'No Date',  items: noDate })

  return (
    <PageContainer>
      <PageHeader
        title="Interviews"
        subtitle="Schedule interview rounds, assign panel, and track completion"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />Schedule Interview
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-sm min-w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="no_show">No-show</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Requisition</label>
            <Select value={reqFilter} onValueChange={setReqFilter}>
              <SelectTrigger className="h-9 text-sm min-w-[200px]">
                <SelectValue placeholder="All requisitions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All requisitions</SelectItem>
                {requisitions.map(r => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(statusFilter !== 'scheduled' || reqFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('scheduled'); setReqFilter('all') }}>Clear</Button>
          )}
        </div>
      </SectionCard>

      {/* Interview list grouped by date */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <CalendarCheck className="h-8 w-8" />
            <p className="text-sm">No interviews found for the selected filters.</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1" />Schedule first interview
            </Button>
          </div>
        </SectionCard>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <SectionCard key={group.label} title={`${group.label} · ${group.items.length}`}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                      <th className="text-left py-2 px-3 text-xs font-medium">Candidate</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Requisition</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Round</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Date & Time</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Panel</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(r => {
                      const cand = r.applications?.candidates
                      const req  = r.applications?.job_requisitions
                      const typeMeta = TYPE_META[r.interview_type] ?? TYPE_META.video
                      const statusMeta = STATUS_META[r.status] ?? STATUS_META.scheduled

                      return (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="py-2 px-3">
                            {cand ? (
                              <>
                                <p className="font-medium">{cand.first_name} {cand.last_name}</p>
                                <p className="text-xs text-muted-foreground">{cand.current_company ?? cand.email}</p>
                              </>
                            ) : <span className="text-muted-foreground/60">—</span>}
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground max-w-[160px] truncate">
                            {req?.title ?? '—'}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-muted-foreground">{typeMeta.icon}</span>
                              <span className="text-xs">R{r.round_number}{r.title ? ` · ${r.title}` : ''}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {r.duration_mins}min · {typeMeta.label}
                            </p>
                          </td>
                          <td className="py-2 px-3 text-xs whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3 text-muted-foreground" />
                              {fmtDT(r.scheduled_at)}
                            </div>
                            {r.meet_link && (
                              <a
                                href={r.meet_link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline text-[10px] flex items-center gap-0.5 mt-0.5"
                              >
                                <Video className="h-2.5 w-2.5" />Join meeting
                              </a>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {r.interview_panel.length === 0 ? (
                              <span className="text-xs text-muted-foreground/60 italic">Unassigned</span>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  {r.interview_panel.slice(0, 2).map(p => p.profiles?.full_name?.split(' ')[0]).join(', ')}
                                  {r.interview_panel.length > 2 && ` +${r.interview_panel.length - 2}`}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant="outline" className={cn('text-[10px]', statusMeta.className)}>
                              {statusMeta.label}
                            </Badge>
                          </td>
                          <td className="py-2 px-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => openEdit(r)}>Edit details</DropdownMenuItem>
                                {r.status === 'scheduled' && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-emerald-600"
                                      onClick={() => transition(r.id, 'complete', 'Marked as completed')}
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5 mr-2" />Mark Complete
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-amber-600"
                                      onClick={() => transition(r.id, 'no-show', 'Marked as no-show')}
                                    >
                                      <UserX className="h-3.5 w-3.5 mr-2" />No-show
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-red-600"
                                      onClick={() => transition(r.id, 'cancel', 'Interview cancelled')}
                                    >
                                      <XCircle className="h-3.5 w-3.5 mr-2" />Cancel
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-red-600"
                                      onClick={() => deleteMut.mutate(r.id)}
                                    >Delete</DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* Schedule / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? 'Edit Interview' : 'Schedule Interview'}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {/* Application selector — only on create */}
            {!editTarget && (
              <div>
                <Label>Application <span className="text-red-500">*</span></Label>
                <Select value={form.application_id || 'none'} onValueChange={v => setForm(f => ({ ...f, application_id: v === 'none' ? '' : v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select candidate application…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Select —</SelectItem>
                    {applications.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.candidates.first_name} {a.candidates.last_name}
                        {a.job_requisitions && ` · ${a.job_requisitions.title}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="iv-round">Round Number</Label>
                <Input
                  id="iv-round"
                  type="number"
                  min={1}
                  value={form.round_number}
                  onChange={e => setForm(f => ({ ...f, round_number: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Interview Type</Label>
                <Select value={form.interview_type} onValueChange={v => setForm(f => ({ ...f, interview_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">Video call</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="in_person">In-person</SelectItem>
                    <SelectItem value="assignment">Assignment / Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="iv-title">Round Title <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input
                id="iv-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Technical Round 1"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="iv-date">Date</Label>
                <Input
                  id="iv-date"
                  type="date"
                  value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="iv-time">Time</Label>
                <Input
                  id="iv-time"
                  type="time"
                  value={form.scheduled_time}
                  onChange={e => setForm(f => ({ ...f, scheduled_time: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="iv-dur">Duration (minutes)</Label>
                <Input
                  id="iv-dur"
                  type="number"
                  min={15}
                  step={15}
                  value={form.duration_mins}
                  onChange={e => setForm(f => ({ ...f, duration_mins: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="iv-meet">Meet Link</Label>
              <Input
                id="iv-meet"
                value={form.meet_link}
                onChange={e => setForm(f => ({ ...f, meet_link: e.target.value }))}
                placeholder="https://meet.google.com/…"
                className="mt-1"
              />
            </div>

            {/* Panel selection */}
            <div>
              <Label className="mb-2 block">
                Interview Panel
                <span className="text-xs text-muted-foreground ml-1">({form.interviewer_ids.length} selected)</span>
              </Label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {interviewers.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground italic">No interviewers available</p>
                ) : (
                  interviewers.map(ivr => (
                    <label
                      key={ivr.id}
                      className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.interviewer_ids.includes(ivr.id)}
                        onChange={() => toggleInterviewer(ivr.id)}
                        className="accent-primary"
                      />
                      <span className="text-sm">{ivr.full_name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{ivr.role.replace('_', ' ')}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="iv-notes">Notes</Label>
              <textarea
                id="iv-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Instructions for panel, topics to cover…"
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          <SheetFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              {editTarget ? 'Save Changes' : 'Schedule'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
