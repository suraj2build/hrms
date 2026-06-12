/**
 * AdminCandidates — /admin/recruitment/candidates  (RCT-04)
 *
 * Candidate master: search, filter by source, create/edit, link to requisition.
 * Click a candidate to see their application history in a slide-over panel.
 *
 * Access: hr_admin / super_admin.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users2, Plus, RefreshCw, Search, Star, ExternalLink,
  Mail, Phone, Building2, Briefcase, ChevronRight, X,
  Globe, Linkedin, FileText, CalendarCheck, Video, MapPin,
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { api }                from '@/lib/api/client'
import { useAuthStore }      from '@/stores/authStore'
import { cn }                from '@/lib/utils'
import { OfferLetterDialog } from './OfferLetterDialog'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candidate {
  id:               string
  first_name:       string
  last_name:        string
  email:            string
  phone:            string | null
  current_company:  string | null
  current_title:    string | null
  total_experience: number | null
  source:           string
  linkedin_url:     string | null
  resume_url:       string | null
  notes:            string | null
  created_at:       string
}

interface CandidateApplication {
  id:             string
  status:         string
  overall_score:  number | null
  created_at:     string
  job_requisitions: { id: string; title: string } | null
  recruitment_pipeline_stages: { id: string; name: string; color: string } | null
}

interface CandidateInterview {
  id:             string
  round_number:   number
  title:          string | null
  interview_type: string
  scheduled_at:   string | null
  status:         string
  duration_mins:  number
  applications: { job_requisitions: { title: string } | null } | null
  interview_panel: { profiles: { full_name: string } | null }[]
}

interface CandForm {
  first_name:       string
  last_name:        string
  email:            string
  phone:            string
  current_company:  string
  current_title:    string
  total_experience: string
  source:           string
  linkedin_url:     string
  notes:            string
}

const EMPTY_FORM: CandForm = {
  first_name: '', last_name: '', email: '', phone: '',
  current_company: '', current_title: '', total_experience: '',
  source: 'direct', linkedin_url: '', notes: '',
}

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct', referral: 'Referral', portal: 'Job Portal',
  agency: 'Agency', linkedin: 'LinkedIn', naukri: 'Naukri',
  indeed: 'Indeed', other: 'Other',
}

const SOURCE_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  naukri:   'bg-orange-100 text-orange-700',
  indeed:   'bg-indigo-100 text-indigo-700',
  referral: 'bg-purple-100 text-purple-700',
  portal:   'bg-teal-100 text-teal-700',
  agency:   'bg-pink-100 text-pink-700',
  direct:   'bg-gray-100 text-gray-600',
  other:    'bg-gray-100 text-gray-600',
}

const APP_STATUS_META: Record<string, { label: string; className: string }> = {
  applied:      { label: 'Applied',       className: 'text-gray-600   bg-gray-50   border-gray-200'   },
  screening:    { label: 'Screening',     className: 'text-blue-600   bg-blue-50   border-blue-200'   },
  interviewing: { label: 'Interviewing',  className: 'text-purple-600 bg-purple-50 border-purple-200' },
  offer:        { label: 'Offer',         className: 'text-amber-600  bg-amber-50  border-amber-200'  },
  hired:        { label: 'Hired',         className: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  rejected:     { label: 'Rejected',      className: 'text-red-600    bg-red-50    border-red-200'    },
  withdrawn:    { label: 'Withdrawn',     className: 'text-gray-500   bg-gray-50   border-gray-200'   },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminCandidates() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [search,       setSearch]       = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [page,         setPage]         = useState(0)

  const [sheetOpen,    setSheetOpen]    = useState(false)
  const [editTarget,   setEditTarget]   = useState<Candidate | null>(null)
  const [form,         setForm]         = useState<CandForm>(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)

  const [detailOpen,   setDetailOpen]   = useState(false)
  const [detailCand,   setDetailCand]   = useState<Candidate | null>(null)
  const [offerAppId,   setOfferAppId]   = useState<string | null>(null)

  const PAGE_SIZE = 50

  // ── Queries ────────────────────────────────────────────────────────────────

  const params = new URLSearchParams()
  params.set('limit',  String(PAGE_SIZE))
  params.set('offset', String(page * PAGE_SIZE))
  if (search)                  params.set('search', search)
  if (sourceFilter !== 'all')  params.set('source', sourceFilter)

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: Candidate[]; total: number }>({
    queryKey: ['recruitment', 'candidates', search, sourceFilter, page],
    queryFn:  () => api.get(`/recruitment/candidates?${params}`),
    enabled:  isAdmin,
  })
  const rows  = data?.data ?? []
  const total = data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  const { data: appsData } = useQuery<{ data: CandidateApplication[] }>({
    queryKey: ['recruitment', 'applications', 'candidate', detailCand?.id],
    queryFn:  () => api.get(`/recruitment/applications?candidate_id=${detailCand?.id}&limit=50`),
    enabled:  !!detailCand,
  })
  const candidateApps = appsData?.data ?? []

  const { data: ivsData } = useQuery<{ data: CandidateInterview[] }>({
    queryKey: ['recruitment', 'interviews', 'candidate', detailCand?.id],
    queryFn:  () => api.get(`/recruitment/interviews?candidate_id=${detailCand?.id}&limit=50`),
    enabled:  !!detailCand,
  })
  const candidateInterviews = ivsData?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────

  function invalidate() { qc.invalidateQueries({ queryKey: ['recruitment', 'candidates'] }) }

  async function handleSave() {
    if (!form.first_name.trim() || !form.last_name.trim()) { toast.error('Name is required'); return }
    if (!form.email.trim()) { toast.error('Email is required'); return }
    setSaving(true)
    try {
      const payload: any = {
        first_name:       form.first_name.trim(),
        last_name:        form.last_name.trim(),
        email:            form.email.trim(),
        phone:            form.phone || null,
        current_company:  form.current_company || null,
        current_title:    form.current_title || null,
        total_experience: form.total_experience ? parseFloat(form.total_experience) : null,
        source:           form.source,
        linkedin_url:     form.linkedin_url || null,
        notes:            form.notes || null,
      }
      if (editTarget) {
        await api.put(`/recruitment/candidates/${editTarget.id}`, payload)
        toast.success('Candidate updated')
      } else {
        await api.post('/recruitment/candidates', payload)
        toast.success('Candidate added')
      }
      setSheetOpen(false)
      invalidate()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Save failed'
      if (e?.response?.data?.error === 'DUPLICATE_EMAIL') {
        toast.error('A candidate with this email already exists')
      } else {
        toast.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setSheetOpen(true)
  }

  function openEdit(c: Candidate) {
    setEditTarget(c)
    setForm({
      first_name:       c.first_name,
      last_name:        c.last_name,
      email:            c.email,
      phone:            c.phone ?? '',
      current_company:  c.current_company ?? '',
      current_title:    c.current_title ?? '',
      total_experience: c.total_experience != null ? String(c.total_experience) : '',
      source:           c.source,
      linkedin_url:     c.linkedin_url ?? '',
      notes:            c.notes ?? '',
    })
    setSheetOpen(true)
  }

  function openDetail(c: Candidate) {
    setDetailCand(c)
    setDetailOpen(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <Users2 className="h-8 w-8" />
          <p className="text-sm">Candidate management is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Candidates"
        subtitle="Talent pool — all applicants across requisitions"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />Add Candidate
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Source</label>
            <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(0) }}>
              <SelectTrigger className="h-9 text-sm min-w-[150px]">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(search || sourceFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setSourceFilter('all'); setPage(0) }}>
              Clear
            </Button>
          )}
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard title={`Candidates${total ? ` · ${total}` : ''}`}>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Users2 className="h-8 w-8" />
            <p className="text-sm">No candidates found.</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add first candidate
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 text-xs font-medium">Candidate</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Current Role</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Experience</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Source</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Contact</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(c => (
                    <tr
                      key={c.id}
                      className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => openDetail(c)}
                    >
                      <td className="py-2 px-3">
                        <p className="font-medium text-sm">{c.first_name} {c.last_name}</p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </td>
                      <td className="py-2 px-3">
                        {c.current_title ? (
                          <>
                            <p className="text-sm">{c.current_title}</p>
                            {c.current_company && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Building2 className="h-3 w-3" />{c.current_company}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground/60 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-sm">
                        {c.total_experience != null ? `${c.total_experience}y` : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="py-2 px-3">
                        <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', SOURCE_COLORS[c.source] ?? SOURCE_COLORS.other)}>
                          {SOURCE_LABELS[c.source] ?? c.source}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          {c.phone && (
                            <a
                              href={`tel:${c.phone}`}
                              onClick={e => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                              title={c.phone}
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {c.linkedin_url && (
                            <a
                              href={c.linkedin_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-muted-foreground hover:text-blue-600"
                              title="LinkedIn"
                            >
                              <Linkedin className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {c.resume_url && (
                            <a
                              href={c.resume_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                              title="Resume"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={e => { e.stopPropagation(); openEdit(c) }}
                          >
                            Edit
                          </Button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
                <span className="text-xs text-muted-foreground">Page {page + 1} of {maxPage + 1}</span>
                <Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage(p => Math.min(maxPage, p + 1))}>Next</Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? 'Edit Candidate' : 'Add Candidate'}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-first">First Name <span className="text-red-500">*</span></Label>
                <Input id="c-first" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className="mt-1" placeholder="Priya" />
              </div>
              <div>
                <Label htmlFor="c-last">Last Name <span className="text-red-500">*</span></Label>
                <Input id="c-last" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className="mt-1" placeholder="Sharma" />
              </div>
            </div>

            <div>
              <Label htmlFor="c-email">Email <span className="text-red-500">*</span></Label>
              <Input id="c-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1" placeholder="priya@example.com" disabled={!!editTarget} />
              {editTarget && <p className="text-[11px] text-muted-foreground mt-1">Email cannot be changed after creation.</p>}
            </div>

            <div>
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" placeholder="+91 98765 43210" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-company">Current Company</Label>
                <Input id="c-company" value={form.current_company} onChange={e => setForm(f => ({ ...f, current_company: e.target.value }))} className="mt-1" placeholder="Acme Corp" />
              </div>
              <div>
                <Label htmlFor="c-title">Current Title</Label>
                <Input id="c-title" value={form.current_title} onChange={e => setForm(f => ({ ...f, current_title: e.target.value }))} className="mt-1" placeholder="Software Engineer" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-exp">Total Experience (yrs)</Label>
                <Input id="c-exp" type="number" min={0} step={0.5} value={form.total_experience} onChange={e => setForm(f => ({ ...f, total_experience: e.target.value }))} className="mt-1" placeholder="5" />
              </div>
              <div>
                <Label>Source</Label>
                <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="c-linkedin">LinkedIn URL</Label>
              <Input id="c-linkedin" value={form.linkedin_url} onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))} className="mt-1" placeholder="https://linkedin.com/in/…" />
            </div>

            <div>
              <Label htmlFor="c-notes">Notes</Label>
              <textarea
                id="c-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any internal notes about this candidate…"
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          <SheetFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              {editTarget ? 'Save Changes' : 'Add Candidate'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Candidate Detail Slide-over */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detailCand && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Users2 className="h-5 w-5 text-muted-foreground" />
                  {detailCand.first_name} {detailCand.last_name}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-5 space-y-4">
                {/* Contact info */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <a href={`mailto:${detailCand.email}`} className="hover:underline">{detailCand.email}</a>
                  </div>
                  {detailCand.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {detailCand.phone}
                    </div>
                  )}
                  {detailCand.current_title && (
                    <div className="flex items-center gap-2 text-sm">
                      <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                      {detailCand.current_title}
                      {detailCand.current_company && ` @ ${detailCand.current_company}`}
                    </div>
                  )}
                  {detailCand.total_experience != null && (
                    <p className="text-xs text-muted-foreground">{detailCand.total_experience} years experience</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', SOURCE_COLORS[detailCand.source] ?? SOURCE_COLORS.other)}>
                      {SOURCE_LABELS[detailCand.source] ?? detailCand.source}
                    </span>
                    {detailCand.linkedin_url && (
                      <a href={detailCand.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 text-xs">
                        <Linkedin className="h-3 w-3" />LinkedIn
                      </a>
                    )}
                    {detailCand.resume_url && (
                      <a href={detailCand.resume_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
                        <FileText className="h-3 w-3" />Resume
                      </a>
                    )}
                  </div>
                </div>

                {detailCand.notes && (
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <p className="text-xs text-muted-foreground font-medium mb-1">Notes</p>
                    <p className="text-sm">{detailCand.notes}</p>
                  </div>
                )}

                {/* Interview Timeline */}
                {candidateInterviews.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                      Interview Timeline ({candidateInterviews.length})
                    </p>
                    <div className="space-y-2">
                      {candidateInterviews.map(iv => {
                        const ivStatusMeta: Record<string, string> = {
                          scheduled: 'text-blue-600 bg-blue-50 border-blue-200',
                          completed: 'text-emerald-600 bg-emerald-50 border-emerald-200',
                          cancelled: 'text-gray-500 bg-gray-50 border-gray-200',
                          no_show:   'text-red-600 bg-red-50 border-red-200',
                        }
                        return (
                          <div key={iv.id} className="rounded-lg border border-border p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">
                                  R{iv.round_number}{iv.title ? ` · ${iv.title}` : ''}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {iv.applications?.job_requisitions?.title ?? '—'}
                                </p>
                              </div>
                              <Badge variant="outline" className={cn('text-[10px] shrink-0', ivStatusMeta[iv.status] ?? '')}>
                                {iv.status.replace('_', '-')}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                              {iv.scheduled_at && (
                                <span>{new Date(iv.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {new Date(iv.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                              )}
                              <span className="flex items-center gap-0.5">
                                {iv.interview_type === 'video' ? <Video className="h-2.5 w-2.5" /> : iv.interview_type === 'in_person' ? <MapPin className="h-2.5 w-2.5" /> : null}
                                {iv.interview_type}
                              </span>
                              {iv.interview_panel.length > 0 && (
                                <span>{iv.interview_panel.map(p => p.profiles?.full_name?.split(' ')[0]).filter(Boolean).join(', ')}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Applications */}
                <div>
                  <p className="text-sm font-semibold mb-2">Applications ({candidateApps.length})</p>
                  {candidateApps.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No applications yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {candidateApps.map(app => {
                        const statusMeta = APP_STATUS_META[app.status] ?? { label: app.status, className: 'text-gray-600 bg-gray-50 border-gray-200' }
                        return (
                          <div key={app.id} className="rounded-lg border border-border p-2.5 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{app.job_requisitions?.title ?? '—'}</p>
                              {app.recruitment_pipeline_stages && (
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: app.recruitment_pipeline_stages.color }} />
                                  {app.recruitment_pipeline_stages.name}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <Badge variant="outline" className={cn('text-[10px]', statusMeta.className)}>
                                {statusMeta.label}
                              </Badge>
                              {app.overall_score != null && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Star className="h-2.5 w-2.5 fill-current text-amber-500" />
                                  {app.overall_score}/10
                                </span>
                              )}
                              {(app.status === 'offer' || app.status === 'hired') && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] gap-1"
                                  onClick={e => { e.stopPropagation(); setOfferAppId(app.id) }}
                                >
                                  <FileText className="h-3 w-3" />Offer Letter
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <Button variant="outline" size="sm" className="w-full" onClick={() => { setDetailOpen(false); openEdit(detailCand) }}>
                  Edit Candidate Details
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Offer Letter Dialog */}
      <OfferLetterDialog
        appId={offerAppId}
        open={!!offerAppId}
        onOpenChange={v => { if (!v) setOfferAppId(null) }}
      />
    </PageContainer>
  )
}
