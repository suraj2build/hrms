/**
 * AdminRecruitment — /admin/recruitment/requisitions  (RCT-01)
 *
 * Job requisition management: create, approve, hold, cancel, search.
 * Side sheet for create / edit with all fields.
 * Status workflow: draft → open → on_hold ↔ open → filled / cancelled
 *
 * Access: hr_admin / super_admin.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Briefcase, Plus, RefreshCw, Search, ChevronDown,
  CheckCircle2, PauseCircle, XCircle, MoreHorizontal,
  Users, CalendarClock, MapPin, Trash2,
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

interface Department { id: string; name: string }

interface Requisition {
  id:              string
  title:           string
  department_id:   string | null
  departments:     { id: string; name: string } | null
  location:        string | null
  employment_type: string
  openings:        number
  status:          'draft' | 'open' | 'on_hold' | 'filled' | 'cancelled'
  target_date:     string | null
  applicant_count: number
  raised_by_profile: { id: string; full_name: string } | null
  jd_text:         string | null
  required_skills: string[] | null
  min_experience:  number | null
  max_experience:  number | null
  salary_min:      number | null
  salary_max:      number | null
  created_at:      string
}

interface ReqForm {
  title:           string
  department_id:   string
  location:        string
  employment_type: string
  openings:        string
  jd_text:         string
  skills_raw:      string
  min_experience:  string
  max_experience:  string
  salary_min:      string
  salary_max:      string
  target_date:     string
}

const EMPTY_FORM: ReqForm = {
  title: '', department_id: '', location: '', employment_type: 'full_time',
  openings: '1', jd_text: '', skills_raw: '', min_experience: '',
  max_experience: '', salary_min: '', salary_max: '', target_date: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft:     { label: 'Draft',     className: 'text-gray-600   border-gray-200   bg-gray-50'   },
  open:      { label: 'Open',      className: 'text-emerald-600 border-emerald-200 bg-emerald-50' },
  on_hold:   { label: 'On Hold',   className: 'text-amber-600  border-amber-200  bg-amber-50'  },
  filled:    { label: 'Filled',    className: 'text-blue-600   border-blue-200   bg-blue-50'   },
  cancelled: { label: 'Cancelled', className: 'text-red-600    border-red-200    bg-red-50'    },
}

const EMP_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Intern',
}

function fmt(n: number | null, prefix = '') {
  if (n == null) return '—'
  return prefix + n.toLocaleString('en-IN')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminRecruitment() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('all')
  const [deptFilter,   setDeptFilter]   = useState('all')
  const [search,       setSearch]       = useState('')

  const [sheetOpen,  setSheetOpen]  = useState(false)
  const [editTarget, setEditTarget] = useState<Requisition | null>(null)
  const [form,       setForm]       = useState<ReqForm>(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: deptData } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
    staleTime: 10 * 60 * 1000,
  })
  const departments = deptData?.data ?? []

  const { data: statsData } = useQuery<{ requisitions: Record<string, number> }>({
    queryKey: ['recruitment', 'stats'],
    queryFn:  () => api.get('/recruitment/stats'),
    enabled:  isAdmin,
  })
  const stats = statsData?.requisitions ?? {}

  const params = new URLSearchParams()
  if (statusFilter !== 'all') params.set('status', statusFilter)
  if (deptFilter   !== 'all') params.set('department_id', deptFilter)
  if (search)                  params.set('search', search)
  params.set('limit', '100')

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: Requisition[]; total: number }>({
    queryKey: ['recruitment', 'requisitions', statusFilter, deptFilter, search],
    queryFn:  () => api.get(`/recruitment/requisitions?${params}`),
    enabled:  isAdmin,
  })
  const rows = data?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['recruitment'] })
  }

  async function runAction(endpoint: string, successMsg: string) {
    try {
      await api.post(endpoint, {})
      toast.success(successMsg)
      invalidate()
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Action failed')
    }
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/recruitment/requisitions/${id}`),
    onSuccess: () => { toast.success('Requisition deleted'); invalidate() },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Delete failed'),
  })

  // ── Sheet helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setSheetOpen(true)
  }

  function openEdit(r: Requisition) {
    setEditTarget(r)
    setForm({
      title:           r.title,
      department_id:   r.department_id ?? '',
      location:        r.location ?? '',
      employment_type: r.employment_type,
      openings:        String(r.openings),
      jd_text:         r.jd_text ?? '',
      skills_raw:      (r.required_skills ?? []).join(', '),
      min_experience:  r.min_experience != null ? String(r.min_experience) : '',
      max_experience:  r.max_experience != null ? String(r.max_experience) : '',
      salary_min:      r.salary_min != null ? String(r.salary_min) : '',
      salary_max:      r.salary_max != null ? String(r.salary_max) : '',
      target_date:     r.target_date ?? '',
    })
    setSheetOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      const payload: any = {
        title:           form.title.trim(),
        department_id:   form.department_id || null,
        location:        form.location || null,
        employment_type: form.employment_type,
        openings:        parseInt(form.openings) || 1,
        jd_text:         form.jd_text || null,
        required_skills: form.skills_raw ? form.skills_raw.split(',').map(s => s.trim()).filter(Boolean) : null,
        min_experience:  form.min_experience ? parseFloat(form.min_experience) : null,
        max_experience:  form.max_experience ? parseFloat(form.max_experience) : null,
        salary_min:      form.salary_min ? parseFloat(form.salary_min) : null,
        salary_max:      form.salary_max ? parseFloat(form.salary_max) : null,
        target_date:     form.target_date || null,
      }
      if (editTarget) {
        await api.put(`/recruitment/requisitions/${editTarget.id}`, payload)
        toast.success('Requisition updated')
      } else {
        await api.post('/recruitment/requisitions', payload)
        toast.success('Requisition created')
      }
      setSheetOpen(false)
      invalidate()
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
          <Briefcase className="h-8 w-8" />
          <p className="text-sm">Recruitment management is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Job Requisitions"
        subtitle="Raise, approve, and manage open positions across the organisation"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />New Requisition
            </Button>
          </div>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {(['open', 'draft', 'on_hold', 'filled', 'cancelled'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
              statusFilter === s ? 'ring-2 ring-primary' : 'border-border bg-card',
            )}
          >
            <p className="text-xs text-muted-foreground capitalize">{STATUS_META[s].label}</p>
            <p className="text-2xl font-bold mt-0.5">{stats[s] ?? 0}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by title…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
              <SelectTrigger className="h-9 text-sm min-w-[140px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="filled">Filled</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Department</label>
            <Select value={deptFilter} onValueChange={v => setDeptFilter(v)}>
              <SelectTrigger className="h-9 text-sm min-w-[160px]">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(statusFilter !== 'all' || deptFilter !== 'all' || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('all'); setDeptFilter('all'); setSearch('') }}>
              Clear
            </Button>
          )}
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard title={`Requisitions${data?.total ? ` · ${data.total}` : ''}`}>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Briefcase className="h-8 w-8" />
            <p className="text-sm">No requisitions match the current filters.</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1" />Create first requisition
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="text-left py-2 px-3 text-xs font-medium">Position</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Department</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Type</th>
                  <th className="text-center py-2 px-3 text-xs font-medium">Openings</th>
                  <th className="text-center py-2 px-3 text-xs font-medium">Applicants</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Target Date</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const meta = STATUS_META[r.status]
                  const canEdit   = ['draft', 'on_hold'].includes(r.status)
                  const canApprove = r.status === 'draft'
                  const canHold   = ['open', 'draft'].includes(r.status)
                  const canReopen = ['on_hold', 'filled'].includes(r.status)
                  const canCancel = !['cancelled', 'filled'].includes(r.status)
                  const canDelete = r.status === 'draft'

                  return (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3">
                        <p className="font-medium text-sm">{r.title}</p>
                        {r.location && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />{r.location}
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {r.departments?.name ?? <span className="italic">—</span>}
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {EMP_TYPE_LABELS[r.employment_type] ?? r.employment_type}
                      </td>
                      <td className="py-2 px-3 text-center text-sm font-semibold">
                        {r.openings}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5',
                          r.applicant_count > 0 ? 'bg-blue-50 text-blue-600' : 'text-muted-foreground',
                        )}>
                          <Users className="h-3 w-3" />{r.applicant_count}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {r.target_date
                          ? <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" />{new Date(r.target_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                          : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className={cn('text-[10px]', meta.className)}>
                          {meta.label}
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
                            {canEdit && (
                              <DropdownMenuItem onClick={() => openEdit(r)}>
                                Edit details
                              </DropdownMenuItem>
                            )}
                            {canApprove && (
                              <DropdownMenuItem
                                className="text-emerald-600"
                                onClick={() => runAction(`/recruitment/requisitions/${r.id}/approve`, 'Approved and opened')}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-2" />Approve & Open
                              </DropdownMenuItem>
                            )}
                            {canHold && (
                              <DropdownMenuItem
                                className="text-amber-600"
                                onClick={() => runAction(`/recruitment/requisitions/${r.id}/hold`, 'Put on hold')}
                              >
                                <PauseCircle className="h-3.5 w-3.5 mr-2" />Put on Hold
                              </DropdownMenuItem>
                            )}
                            {canReopen && (
                              <DropdownMenuItem
                                className="text-blue-600"
                                onClick={() => runAction(`/recruitment/requisitions/${r.id}/reopen`, 'Requisition reopened')}
                              >
                                <RefreshCw className="h-3.5 w-3.5 mr-2" />Reopen
                              </DropdownMenuItem>
                            )}
                            {canCancel && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={() => runAction(`/recruitment/requisitions/${r.id}/cancel`, 'Requisition cancelled')}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-2" />Cancel
                                </DropdownMenuItem>
                              </>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => deleteMut.mutate(r.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />Delete Draft
                              </DropdownMenuItem>
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
        )}
      </SectionCard>

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editTarget ? 'Edit Requisition' : 'New Requisition'}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="req-title">Job Title <span className="text-red-500">*</span></Label>
              <Input
                id="req-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Senior Backend Engineer"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Department</Label>
                <Select value={form.department_id || 'none'} onValueChange={v => setForm(f => ({ ...f, department_id: v === 'none' ? '' : v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select dept…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="req-location">Location</Label>
                <Input
                  id="req-location"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="City / Remote"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Employment Type</Label>
                <Select value={form.employment_type} onValueChange={v => setForm(f => ({ ...f, employment_type: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">Full-time</SelectItem>
                    <SelectItem value="part_time">Part-time</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="req-openings">No. of Openings</Label>
                <Input
                  id="req-openings"
                  type="number"
                  min={1}
                  value={form.openings}
                  onChange={e => setForm(f => ({ ...f, openings: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-min-exp">Min Experience (yrs)</Label>
                <Input
                  id="req-min-exp"
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.min_experience}
                  onChange={e => setForm(f => ({ ...f, min_experience: e.target.value }))}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="req-max-exp">Max Experience (yrs)</Label>
                <Input
                  id="req-max-exp"
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.max_experience}
                  onChange={e => setForm(f => ({ ...f, max_experience: e.target.value }))}
                  placeholder="10"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-sal-min">Salary Min (₹)</Label>
                <Input
                  id="req-sal-min"
                  type="number"
                  min={0}
                  value={form.salary_min}
                  onChange={e => setForm(f => ({ ...f, salary_min: e.target.value }))}
                  placeholder="600000"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="req-sal-max">Salary Max (₹)</Label>
                <Input
                  id="req-sal-max"
                  type="number"
                  min={0}
                  value={form.salary_max}
                  onChange={e => setForm(f => ({ ...f, salary_max: e.target.value }))}
                  placeholder="1200000"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="req-target">Target Close Date</Label>
              <Input
                id="req-target"
                type="date"
                value={form.target_date}
                onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="req-skills">Required Skills <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
              <Input
                id="req-skills"
                value={form.skills_raw}
                onChange={e => setForm(f => ({ ...f, skills_raw: e.target.value }))}
                placeholder="React, Node.js, PostgreSQL"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="req-jd">Job Description</Label>
              <textarea
                id="req-jd"
                value={form.jd_text}
                onChange={e => setForm(f => ({ ...f, jd_text: e.target.value }))}
                placeholder="Describe the role, responsibilities, and requirements…"
                rows={5}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          <SheetFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
              {editTarget ? 'Save Changes' : 'Create Requisition'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
