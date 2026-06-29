/**
 * AdminTalentMarketplace — /admin/talent-marketplace
 *
 * HR view of the internal talent marketplace.
 * - Post open internal roles with skills, department, location, experience requirements
 * - View talent pool: all employees who expressed interest per role
 * - Review and shortlist/select candidates
 * - Close roles when filled
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Briefcase, Plus, Users, Tag, MapPin, Building2,
  Clock, CheckCircle2, XCircle, Loader2, ChevronRight,
  ToggleLeft, Edit2, Eye, Star, AlertCircle, Sparkles,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Textarea }      from '@/components/ui/textarea'
import { Label }         from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type InterestStatus = 'interested' | 'shortlisted' | 'selected' | 'not_selected' | 'withdrawn'

interface TalentRole {
  id:              string
  title:           string
  department:      string | null
  location:        string | null
  description:     string | null
  skills_required: string[]
  experience_min:  number | null
  is_open:         boolean
  posted_at:       string
  closes_at:       string | null
  interest_count:  number
}

interface CandidateEmployee {
  id:            string
  first_name:    string
  last_name:     string
  employee_code: string
  designation?:  string
  department?:   string
}

interface Interest {
  id:             string
  status:         InterestStatus
  availability:   string | null
  cover_note:     string | null
  skills:         string[]
  created_at:     string
  reviewer_notes: string | null
  employees:      CandidateEmployee | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InterestStatus, { label: string; color: string }> = {
  interested:   { label: 'Applied',      color: 'bg-blue-100 text-blue-700' },
  shortlisted:  { label: 'Shortlisted',  color: 'bg-yellow-100 text-yellow-700' },
  selected:     { label: 'Selected',     color: 'bg-green-100 text-green-700' },
  not_selected: { label: 'Not Selected', color: 'bg-gray-100 text-gray-500' },
  withdrawn:    { label: 'Withdrawn',    color: 'bg-gray-100 text-gray-400' },
}

const AVAIL_LABELS: Record<string, string> = {
  immediate: 'Immediate',
  '1_month': 'Within 1 Month',
  '3_months': 'Within 3 Months',
  open: 'Flexible',
}

// ── PostRoleDialog ────────────────────────────────────────────────────────────

function PostRoleDialog({
  open, onClose, onSuccess, editing,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editing?: TalentRole | null
}) {
  const [title,       setTitle]       = useState(editing?.title       ?? '')
  const [department,  setDepartment]  = useState(editing?.department  ?? '')
  const [location,    setLocation]    = useState(editing?.location    ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [skills,      setSkills]      = useState((editing?.skills_required ?? []).join(', '))
  const [expMin,      setExpMin]      = useState(String(editing?.experience_min ?? ''))
  const [closesAt,    setClosesAt]    = useState(editing?.closes_at?.slice(0, 10) ?? '')
  const [submitting,  setSubmitting]  = useState(false)

  async function handleSubmit() {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSubmitting(true)
    try {
      const body = {
        title:           title.trim(),
        department:      department.trim() || null,
        location:        location.trim()   || null,
        description:     description.trim() || null,
        skills_required: skills.split(',').map(s => s.trim()).filter(Boolean),
        experience_min:  expMin ? parseInt(expMin, 10) : null,
        closes_at:       closesAt || null,
      }
      if (editing) {
        await api.put(`/talent/roles/${editing.id}`, body)
        toast.success('Role updated')
      } else {
        await api.post('/talent/roles', body)
        toast.success('Role posted successfully')
      }
      onSuccess()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save role')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Role' : 'Post Internal Role'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Title <span className="text-red-500">*</span></Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Product Manager" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Department</Label>
              <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Engineering" />
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Bangalore / Remote" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Role overview, responsibilities, growth opportunity..."
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <Label>Skills Required <span className="text-gray-400 font-normal">(comma-separated)</span></Label>
            <Input
              value={skills}
              onChange={e => setSkills(e.target.value)}
              placeholder="React, TypeScript, Node.js"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Min. Experience (years)</Label>
              <Input
                type="number"
                min={0}
                value={expMin}
                onChange={e => setExpMin(e.target.value)}
                placeholder="3"
              />
            </div>
            <div className="space-y-1">
              <Label>Closes On</Label>
              <Input type="date" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !title.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Briefcase className="h-4 w-4 mr-1" />}
              {editing ? 'Update Role' : 'Post Role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── InterestPanel ─────────────────────────────────────────────────────────────

function InterestPanel({ role, onClose }: { role: TalentRole; onClose: () => void }) {
  const qc = useQueryClient()

  const { data: interestsData, isLoading } = useQuery<Interest[]>({
    queryKey: ['talent-interests', role.id],
    queryFn:  () => api.get<{ data: Interest[] }>(`/talent/roles/${role.id}/interests`).then(r => r.data),
  })
  const interests = interestsData ?? []

  const [reviewNote, setReviewNote] = useState('')

  const updateMutation = useMutation({
    mutationFn: ({ iid, status, notes }: { iid: string; status: InterestStatus; notes: string }) =>
      api.put(`/talent/interests/${iid}`, { status, reviewer_notes: notes }),
    onSuccess: () => {
      toast.success('Status updated')
      qc.invalidateQueries({ queryKey: ['talent-interests', role.id] })
      qc.invalidateQueries({ queryKey: ['talent-roles'] })
    },
    onError: () => toast.error('Failed to update status'),
  })

  const active   = interests.filter(i => i.status !== 'withdrawn')
  const withdrawn = interests.filter(i => i.status === 'withdrawn')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{role.title}</h3>
          <p className="text-sm text-gray-500">{active.length} active applicant{active.length !== 1 ? 's' : ''}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}><XCircle className="h-4 w-4" /></Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : active.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No applicants yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(interest => {
            const emp = interest.employees
            return (
              <div key={interest.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'}
                      {emp?.employee_code && <span className="text-xs text-gray-400 ml-1">({emp.employee_code})</span>}
                    </p>
                    <div className="flex gap-2 flex-wrap mt-0.5">
                      {emp?.designation && <span className="text-xs text-gray-500">{emp.designation}</span>}
                      {emp?.department  && <span className="text-xs text-gray-400">· {emp.department}</span>}
                      {interest.availability && (
                        <span className="text-xs text-gray-400">· {AVAIL_LABELS[interest.availability] ?? interest.availability}</span>
                      )}
                    </div>
                  </div>
                  <Badge className={cn('text-xs shrink-0', STATUS_CONFIG[interest.status].color)}>
                    {STATUS_CONFIG[interest.status].label}
                  </Badge>
                </div>

                {interest.cover_note && (
                  <p className="text-sm text-gray-600 bg-gray-50 rounded p-2 italic">{interest.cover_note}</p>
                )}

                {(interest.skills ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {interest.skills.map(s => (
                      <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                  </div>
                )}

                {/* Status actions */}
                <div className="flex gap-1.5 flex-wrap">
                  {(['shortlisted', 'selected', 'not_selected'] as InterestStatus[]).map(st => (
                    <Button
                      key={st}
                      size="sm"
                      variant={interest.status === st ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => updateMutation.mutate({ iid: interest.id, status: st, notes: '' })}
                      disabled={updateMutation.isPending || interest.status === st}
                    >
                      {STATUS_CONFIG[st].label}
                    </Button>
                  ))}
                </div>
              </div>
            )
          })}

          {withdrawn.length > 0 && (
            <p className="text-xs text-gray-400 text-center">{withdrawn.length} withdrawn application{withdrawn.length !== 1 ? 's' : ''}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminTalentMarketplace() {
  const qc = useQueryClient()
  const [tab,          setTab]          = useState<'open' | 'closed'>('open')
  const [showPost,     setShowPost]     = useState(false)
  const [editingRole,  setEditingRole]  = useState<TalentRole | null>(null)
  const [viewingRole,  setViewingRole]  = useState<TalentRole | null>(null)

  const { data: rolesData, isLoading } = useQuery<TalentRole[]>({
    queryKey: ['talent-roles', tab],
    queryFn:  () => api.get<{ data: TalentRole[] }>(`/talent/roles?is_open=${tab === 'open'}`).then(r => r.data),
  })
  const roles = rolesData ?? []

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/talent/roles/${id}/close`, {}),
    onSuccess: () => {
      toast.success('Role closed')
      qc.invalidateQueries({ queryKey: ['talent-roles'] })
    },
    onError: () => toast.error('Failed to close role'),
  })

  function refreshRoles() {
    qc.invalidateQueries({ queryKey: ['talent-roles'] })
  }

  // Summary stats
  const openCount  = roles.filter(r => r.is_open).length
  const totalInterests = roles.reduce((s, r) => s + (r.interest_count ?? 0), 0)

  return (
    <PageContainer>
      <PageHeader
        title="Internal Talent Marketplace"
        subtitle="Post open internal roles and manage your talent pool"
        actions={
          <Button onClick={() => { setEditingRole(null); setShowPost(true) }}>
            <Plus className="h-4 w-4 mr-1.5" /> Post Role
          </Button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
        {[
          { label: 'Open Roles',       value: roles.filter(r => r.is_open).length,  icon: Briefcase,    color: 'text-blue-600'   },
          { label: 'Total Applicants', value: totalInterests,                         icon: Users,        color: 'text-emerald-600' },
          { label: 'Roles w/ Interest',value: roles.filter(r => r.interest_count > 0).length, icon: Star, color: 'text-yellow-600' },
          { label: 'Closing Soon',     value: roles.filter(r => {
            if (!r.closes_at || !r.is_open) return false
            const diff = (new Date(r.closes_at).getTime() - Date.now()) / 86400000
            return diff >= 0 && diff <= 7
          }).length, icon: Clock, color: 'text-red-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <SectionCard key={label} className="p-4">
            <div className="flex items-center gap-2">
              <Icon className={cn('h-5 w-5', color)} />
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-xl font-bold text-gray-900">{value}</p>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      {/* Talent pool panel (slide-in) */}
      {viewingRole && (
        <SectionCard className="mt-4 border-blue-200 bg-blue-50/30">
          <InterestPanel role={viewingRole} onClose={() => setViewingRole(null)} />
        </SectionCard>
      )}

      {/* Roles list */}
      <Tabs value={tab} onValueChange={v => setTab(v as 'open' | 'closed')} className="mt-4">
        <TabsList>
          <TabsTrigger value="open">Open Roles</TabsTrigger>
          <TabsTrigger value="closed">Closed Roles</TabsTrigger>
        </TabsList>

        {['open', 'closed'].map(t => (
          <TabsContent key={t} value={t} className="mt-3">
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : roles.length === 0 ? (
              <SectionCard>
                <div className="text-center py-10 text-gray-500">
                  <Briefcase className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No {t} roles</p>
                  {t === 'open' && <p className="text-sm mt-1">Post your first internal role using the button above.</p>}
                </div>
              </SectionCard>
            ) : (
              <div className="space-y-3">
                {roles.map(role => (
                  <SectionCard key={role.id} className={cn('p-4', viewingRole?.id === role.id && 'border-blue-400 ring-1 ring-blue-300')}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{role.title}</h3>
                          <Badge variant={role.is_open ? 'default' : 'secondary'} className="text-xs">
                            {role.is_open ? 'Open' : 'Closed'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-3 mt-1">
                          {role.department && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Building2 className="h-3 w-3" /> {role.department}
                            </span>
                          )}
                          {role.location && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <MapPin className="h-3 w-3" /> {role.location}
                            </span>
                          )}
                          {role.experience_min != null && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock className="h-3 w-3" /> {role.experience_min}+ yrs
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                            <Users className="h-3 w-3" /> {role.interest_count} applicant{role.interest_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {(role.skills_required ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {role.skills_required.slice(0, 4).map(s => (
                              <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s}</span>
                            ))}
                            {role.skills_required.length > 4 && (
                              <span className="text-xs text-gray-400">+{role.skills_required.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => setViewingRole(viewingRole?.id === role.id ? null : role)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> Talent Pool
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => { setEditingRole(role); setShowPost(true) }}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        {role.is_open && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                            onClick={() => closeMutation.mutate(role.id)}
                            disabled={closeMutation.isPending}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" /> Close
                          </Button>
                        )}
                      </div>
                    </div>
                  </SectionCard>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <PostRoleDialog
        open={showPost}
        onClose={() => { setShowPost(false); setEditingRole(null) }}
        onSuccess={refreshRoles}
        editing={editingRole}
      />
    </PageContainer>
  )
}
