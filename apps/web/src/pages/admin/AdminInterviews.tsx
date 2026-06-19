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
  CalendarCheck, Plus, RefreshCw, Video, Phone,
  Users, MapPin, MoreHorizontal, CheckCircle2,
  XCircle, UserX, Briefcase,
  CalendarDays, Star,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
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

  // Scorecard dialog state
  const [scoreRound,   setScoreRound]   = useState<InterviewRound | null>(null)
  const [myTech,       setMyTech]       = useState('')
  const [myComm,       setMyComm]       = useState('')
  const [myCulture,    setMyCulture]    = useState('')
  const [myOverall,    setMyOverall]    = useState('')
  const [myRec,        setMyRec]        = useState('')
  const [myNotes,      setMyNotes]      = useState('')
  const [scoreSaving,  setScoreSaving]  = useState(false)
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

  const { data: scorecardData, refetch: refetchScorecard } = useQuery<{
    data: { id: string; interviewer_id: string; technical_score: number|null; communication_score: number|null; culture_score: number|null; overall_score: number|null; recommendation: string|null; notes: string|null; submitted_at: string; profiles: { id: string; full_name: string }|null }[]
    aggregate: { technical_score: number; communication_score: number; culture_score: number; overall_score: number; count: number } | null
  }>({
    queryKey: ['recruitment', 'scorecard', scoreRound?.id],
    queryFn:  () => api.get(`/recruitment/interviews/${scoreRound?.id}/scorecard`),
    enabled:  !!scoreRound,
  })
  const scorecardRows = scorecardData?.data ?? []
  const aggregate     = scorecardData?.aggregate ?? null

  // ── Mutations ──────────────────────────────────────────────────────────────

  function invalidate() { qc.invalidateQueries({ queryKey: ['recruitment', 'interviews'] }) }

  async function transition(id: string, action: string, label: string) {
    try {
      await api.post(`/recruitment/interviews/${id}/${action}`, {})
      toast.success(label)
      invalidate()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    }
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/recruitment/interviews/${id}`),
    onSuccess:  () => { toast.success('Interview deleted'); invalidate() },
    onError:    (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  })

  // ── Scorecard helpers ──────────────────────────────────────────────────────

  function openScorecard(r: InterviewRound) {
    setScoreRound(r)
    const myScore = scorecardRows.find(s => s.interviewer_id === profile?.id)
    setMyTech(myScore?.technical_score != null ? String(myScore.technical_score) : '')
    setMyComm(myScore?.communication_score != null ? String(myScore.communication_score) : '')
    setMyCulture(myScore?.culture_score != null ? String(myScore.culture_score) : '')
    setMyOverall(myScore?.overall_score != null ? String(myScore.overall_score) : '')
    setMyRec(myScore?.recommendation ?? '')
    setMyNotes(myScore?.notes ?? '')
  }

  async function submitScore() {
    if (!scoreRound) return
    setScoreSaving(true)
    try {
      await api.post(`/recruitment/interviews/${scoreRound.id}/scorecard`, {
        technical_score:     myTech     ? parseInt(myTech)     : null,
        communication_score: myComm     ? parseInt(myComm)     : null,
        culture_score:       myCulture  ? parseInt(myCulture)  : null,
        overall_score:       myOverall  ? parseInt(myOverall)  : null,
        recommendation:      myRec      || null,
        notes:               myNotes    || null,
      })
      toast.success('Score submitted')
      refetchScorecard()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Submit failed')
    } finally { setScoreSaving(false) }
  }

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
      const payload = {
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
        const { application_id: _application_id, ...updatePayload } = payload
        await api.put(`/recruitment/interviews/${editTarget.id}`, updatePayload)
        toast.success('Interview updated')
      } else {
        await api.post('/recruitment/interviews', payload)
        toast.success('Interview scheduled')
      }
      setSheetOpen(false)
      invalidate()
      qc.invalidateQueries({ queryKey: ['recruitment', 'applications'] })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
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
                                <DropdownMenuItem onClick={() => openScorecard(r)}>
                                  <Star className="h-3.5 w-3.5 mr-2" />View Scorecard
                                </DropdownMenuItem>
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

      {/* Schedule / Edit Dialog */}
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden [&>button]:text-white [&>button]:opacity-80 [&>button:hover]:opacity-100 [&>button]:top-5 [&>button]:right-5">
          {/* Header */}
          <div className="bg-gradient-to-br from-[#4c1d95] to-[#7c3aed] px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2.5 shrink-0">
                <CalendarCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-lg leading-tight">
                  {editTarget ? 'Edit Interview' : 'Schedule Interview'}
                </h2>
                <p className="text-purple-100 text-sm mt-0.5">
                  {editTarget ? 'Update interview round details' : 'Set up round, panel members, and schedule'}
                </p>
              </div>
            </div>
          </div>

          {/* Form body */}
          <div className="overflow-y-auto max-h-[65vh] px-6 py-5 space-y-6">

            {/* Interview Details */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full bg-[#7c3aed]" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Interview Details</p>
              </div>
              <div className="space-y-3">
                {!editTarget && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Candidate Application <span className="text-destructive">*</span></Label>
                    <Select value={form.application_id || 'none'} onValueChange={v => setForm(f => ({ ...f, application_id: v === 'none' ? '' : v }))}>
                      <SelectTrigger className="h-10"><SelectValue placeholder="Select candidate application…" /></SelectTrigger>
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
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Round Number</Label>
                    <Input type="number" min={1} value={form.round_number} onChange={e => setForm(f => ({ ...f, round_number: e.target.value }))} className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Interview Type</Label>
                    <Select value={form.interview_type} onValueChange={v => setForm(f => ({ ...f, interview_type: v }))}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="video">Video call</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                        <SelectItem value="in_person">In-person</SelectItem>
                        <SelectItem value="assignment">Assignment / Task</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Round Title
                    <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                  </Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Technical Round 1" className="h-10" />
                </div>
              </div>
            </div>

            {/* Schedule */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full bg-[#7c3aed]" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Schedule</p>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Date</Label>
                    <Input type="date" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Time</Label>
                    <Input type="time" value={form.scheduled_time} onChange={e => setForm(f => ({ ...f, scheduled_time: e.target.value }))} className="h-10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Duration (mins)</Label>
                    <Input type="number" min={15} step={15} value={form.duration_mins} onChange={e => setForm(f => ({ ...f, duration_mins: e.target.value }))} className="h-10" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Meet / Video Link</Label>
                  <Input value={form.meet_link} onChange={e => setForm(f => ({ ...f, meet_link: e.target.value }))} placeholder="https://meet.google.com/…" className="h-10" />
                </div>
              </div>
            </div>

            {/* Panel Members */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full bg-[#7c3aed]" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Interview Panel
                  {form.interviewer_ids.length > 0 && (
                    <span className="ml-2 normal-case text-[#7c3aed] bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                      {form.interviewer_ids.length} selected
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-lg border border-border overflow-hidden divide-y divide-border max-h-44 overflow-y-auto">
                {interviewers.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground italic">No interviewers available</p>
                ) : (
                  interviewers.map(ivr => (
                    <label
                      key={ivr.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                        form.interviewer_ids.includes(ivr.id) ? 'bg-purple-50/60' : 'hover:bg-muted/40'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={form.interviewer_ids.includes(ivr.id)}
                        onChange={() => toggleInterviewer(ivr.id)}
                        className="accent-purple-600 w-4 h-4"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ivr.full_name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{ivr.role.replace(/_/g, ' ')}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-1 rounded-full bg-[#7c3aed]" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Notes</p>
              </div>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Instructions for the panel, topics to cover, prep notes…"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground"><span className="text-destructive">*</span> Required fields</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="min-w-28 bg-[#7c3aed] hover:bg-[#6d28d9]">
                {saving && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
                {editTarget ? 'Save Changes' : 'Schedule Interview'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Scorecard Dialog */}
      <Dialog open={!!scoreRound} onOpenChange={open => { if (!open) setScoreRound(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500" />
              Scorecard — {scoreRound && (
                <>R{scoreRound.round_number}{scoreRound.title ? ` · ${scoreRound.title}` : ''}
                  {scoreRound.applications?.candidates &&
                    ` · ${scoreRound.applications.candidates.first_name} ${scoreRound.applications.candidates.last_name}`}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Aggregate summary */}
          {aggregate && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Panel Aggregate ({aggregate.count} score{aggregate.count !== 1 ? 's' : ''})</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: 'Technical',    value: aggregate.technical_score },
                  { label: 'Communication', value: aggregate.communication_score },
                  { label: 'Culture',      value: aggregate.culture_score },
                  { label: 'Overall',      value: aggregate.overall_score },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-md bg-background border border-border p-2">
                    <p className="text-lg font-bold">{value > 0 ? value : '—'}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-panelist rows */}
          {scorecardRows.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground border-b border-border">
                    <th className="text-left py-1.5 px-3 font-medium">Interviewer</th>
                    <th className="text-center py-1.5 px-2 font-medium">Tech</th>
                    <th className="text-center py-1.5 px-2 font-medium">Comm</th>
                    <th className="text-center py-1.5 px-2 font-medium">Culture</th>
                    <th className="text-center py-1.5 px-2 font-medium">Overall</th>
                    <th className="text-left py-1.5 px-3 font-medium">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecardRows.map(s => {
                    const recColors: Record<string, string> = {
                      strong_yes: 'text-emerald-600', yes: 'text-green-600',
                      maybe: 'text-amber-600', no: 'text-orange-600', strong_no: 'text-red-600',
                    }
                    return (
                      <tr key={s.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="py-2 px-3 font-medium">{s.profiles?.full_name ?? '—'}</td>
                        <td className="py-2 px-2 text-center">{s.technical_score ?? '—'}</td>
                        <td className="py-2 px-2 text-center">{s.communication_score ?? '—'}</td>
                        <td className="py-2 px-2 text-center">{s.culture_score ?? '—'}</td>
                        <td className="py-2 px-2 text-center font-semibold">{s.overall_score ?? '—'}</td>
                        <td className={cn('py-2 px-3 font-medium', recColors[s.recommendation ?? ''] ?? '')}>
                          {s.recommendation?.replace('_', ' ') ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Submit/update my score */}
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">Submit My Score (1–5 scale)</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Technical',     val: myTech,    set: setMyTech },
                { label: 'Communication', val: myComm,    set: setMyComm },
                { label: 'Culture Fit',   val: myCulture, set: setMyCulture },
                { label: 'Overall',       val: myOverall, set: setMyOverall },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <Label className="text-xs">{label}</Label>
                  <div className="flex gap-1 mt-1">
                    {[1,2,3,4,5].map(n => (
                      <button
                        key={n}
                        onClick={() => set(val === String(n) ? '' : String(n))}
                        className={cn(
                          'w-8 h-8 rounded-md border text-sm font-semibold transition-colors',
                          val === String(n)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:bg-muted/50',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Label className="text-xs">Recommendation</Label>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(['strong_yes','yes','maybe','no','strong_no'] as const).map(rec => {
                  const recLabel: Record<string, string> = { strong_yes: 'Strong Yes', yes: 'Yes', maybe: 'Maybe', no: 'No', strong_no: 'Strong No' }
                  const recColor: Record<string, string> = {
                    strong_yes: 'border-emerald-500 bg-emerald-50 text-emerald-700',
                    yes: 'border-green-400 bg-green-50 text-green-700',
                    maybe: 'border-amber-400 bg-amber-50 text-amber-700',
                    no: 'border-orange-400 bg-orange-50 text-orange-700',
                    strong_no: 'border-red-500 bg-red-50 text-red-700',
                  }
                  return (
                    <button
                      key={rec}
                      onClick={() => setMyRec(myRec === rec ? '' : rec)}
                      className={cn(
                        'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors',
                        myRec === rec ? recColor[rec] : 'border-border hover:bg-muted/50',
                      )}
                    >
                      {recLabel[rec]}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Notes</Label>
              <textarea
                value={myNotes}
                onChange={e => setMyNotes(e.target.value)}
                placeholder="Observations, strengths, areas of concern…"
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setScoreRound(null)}>Close</Button>
            <Button onClick={submitScore} disabled={scoreSaving}>
              {scoreSaving && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              Submit Score
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
