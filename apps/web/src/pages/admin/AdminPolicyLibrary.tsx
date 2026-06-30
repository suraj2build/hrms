/**
 * AdminPolicyLibrary — /admin/policy-library
 *
 * HR-facing view for managing company policy documents:
 * create, edit, publish (with employee ack notifications), archive,
 * and track per-policy acknowledgement rates.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Loader2, FileText, CheckCircle2, Clock, AlertTriangle,
  BookOpen, BarChart3, Users, Archive, Send, Edit3, Bot, MessageSquare,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type PolicyStatus   = 'draft' | 'published' | 'archived'
type PolicyCategory = 'leave' | 'compensation' | 'conduct' | 'recruitment' | 'learning' | 'health' | 'it' | 'posh' | 'compliance' | 'other'

interface Policy {
  id:                       string
  title:                    string
  category:                 PolicyCategory
  description:              string | null
  content:                  string | null
  file_url:                 string | null
  status:                   PolicyStatus
  version:                  number
  requires_acknowledgement: boolean
  is_mandatory?:            boolean
  effective_from:           string | null
  published_at:             string | null
  ack_count:                number
  created_at:               string
}

interface QALog {
  id:               string
  question:         string
  answer:           string
  cited_policy_ids: string[]
  created_at:       string
  employees?:       { first_name: string; last_name: string; employee_code: string } | null
}

interface AckStats {
  total:               number
  acknowledged:        number
  pending:             number
  rate:                number
  employees:           { id: string; employee_code: string; first_name: string; last_name: string; acknowledged: boolean; acknowledged_at: string | null }[]
  location_breakdown?: { location_id: string; location_name: string; total: number; acknowledged: number; rate: number }[]
}

const CATEGORIES: { value: PolicyCategory; label: string }[] = [
  { value: 'leave',         label: 'Leave & Attendance' },
  { value: 'compensation',  label: 'Compensation & Benefits' },
  { value: 'conduct',       label: 'Code of Conduct' },
  { value: 'recruitment',   label: 'Recruitment & Onboarding' },
  { value: 'learning',      label: 'Learning & Development' },
  { value: 'health',        label: 'Health & Wellness' },
  { value: 'it',            label: 'IT & Security' },
  { value: 'posh',          label: 'POSH' },
  { value: 'compliance',    label: 'Compliance' },
  { value: 'other',         label: 'Other' },
]

const STATUS_FILTER_OPTIONS = ['all', 'draft', 'published', 'archived'] as const

function categoryLabel(cat: PolicyCategory): string {
  return CATEGORIES.find(c => c.value === cat)?.label ?? cat
}

function statusBadge(s: PolicyStatus) {
  switch (s) {
    case 'draft':     return { variant: 'secondary' as const, label: 'Draft' }
    case 'published': return { variant: 'success'   as const, label: 'Published' }
    case 'archived':  return { variant: 'outline'   as const, label: 'Archived' }
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Empty form ────────────────────────────────────────────────────────────────

const emptyForm = {
  title:                    '',
  category:                 'other' as PolicyCategory,
  description:              '',
  content:                  '',
  file_url:                 '',
  requires_acknowledgement: false,
  is_mandatory:             false,
  effective_from:           '',
}

type PolicyForm = typeof emptyForm

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminPolicyLibrary() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [statusF, setStatusF]   = useState<typeof STATUS_FILTER_OPTIONS[number]>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [form, setForm]         = useState<PolicyForm>(emptyForm)
  const [ackViewId, setAckViewId] = useState<string | null>(null)
  const [qaExpanded, setQaExpanded] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ['policy-library', statusF],
    queryFn:  () => {
      const qs = statusF !== 'all' ? `?status=${statusF}` : ''
      return api.get<{ data: Policy[] }>(`/policies/admin/list${qs}`).then(r => r.data ?? [])
    },
    enabled: isAdmin,
  })

  const { data: qaLogs = [], isLoading: qaLoading } = useQuery<QALog[]>({
    queryKey: ['policy-qa-logs'],
    queryFn:  () => api.get<{ data: QALog[] }>('/policies/admin/qa-logs?limit=50').then(r => r.data ?? []),
    enabled:  isAdmin && qaExpanded,
    staleTime: 60_000,
  })

  const { data: ackStats, isLoading: ackLoading } = useQuery<AckStats>({
    queryKey: ['policy-library', 'acks', ackViewId],
    queryFn:  () => api.get<{ data: AckStats }>(`/policies/admin/${ackViewId}/acks`).then(r => r.data),
    enabled:  !!ackViewId,
  })

  // ── Computed stats ─────────────────────────────────────────────────────────

  const published = policies.filter(p => p.status === 'published').length
  const drafts    = policies.filter(p => p.status === 'draft').length
  const needAck   = policies.filter(p => p.status === 'published' && p.requires_acknowledgement).length

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['policy-library'] })

  const createPolicy = useMutation({
    mutationFn: (body: PolicyForm) => api.post('/policies', body),
    onSuccess: () => {
      invalidate(); setFormOpen(false); setForm(emptyForm)
      toast.success('Policy created as draft')
    },
    onError: (e: Error) => toast.error('Failed to create policy', { description: e.message }),
  })

  const updatePolicy = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PolicyForm> }) =>
      api.put(`/policies/${id}`, body),
    onSuccess: () => {
      invalidate(); setFormOpen(false); setEditId(null); setForm(emptyForm)
      toast.success('Policy updated')
    },
    onError: (e: Error) => toast.error('Failed to update policy', { description: e.message }),
  })

  const publishPolicy = useMutation({
    mutationFn: (id: string) => api.post(`/policies/${id}/publish`, {}),
    onSuccess: (_data, id) => {
      invalidate()
      const p = policies.find(x => x.id === id)
      toast.success(p?.requires_acknowledgement
        ? 'Policy published — employees notified to acknowledge'
        : 'Policy published')
    },
    onError: (e: Error) => toast.error('Failed to publish', { description: e.message }),
  })

  const archivePolicy = useMutation({
    mutationFn: (id: string) => api.post(`/policies/${id}/archive`, {}),
    onSuccess: () => { invalidate(); toast.success('Policy archived') },
    onError: (e: Error) => toast.error('Failed to archive', { description: e.message }),
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  const openCreate = () => { setEditId(null); setForm(emptyForm); setFormOpen(true) }

  const openEdit = (p: Policy) => {
    setEditId(p.id)
    setForm({
      title:                    p.title,
      category:                 p.category,
      description:              p.description ?? '',
      content:                  p.content ?? '',
      file_url:                 p.file_url ?? '',
      requires_acknowledgement: p.requires_acknowledgement,
      is_mandatory:             p.is_mandatory ?? false,
      effective_from:           p.effective_from ?? '',
    })
    setFormOpen(true)
  }

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    const body: PolicyForm = {
      ...form,
      description:    form.description    || '',
      content:        form.content        || '',
      file_url:       form.file_url       || '',
      effective_from: form.effective_from || '',
    }
    if (editId) {
      updatePolicy.mutate({ id: editId, body })
    } else {
      createPolicy.mutate(body)
    }
  }

  const isMutating = createPolicy.isPending || updatePolicy.isPending

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <BookOpen className="h-8 w-8" />
          <p className="text-sm">Policy Library is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Policy Library"
        subtitle="Author and publish company policies — track employee acknowledgements"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />New Policy
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Published</p>
          <p className="text-xl font-semibold">{published}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Drafts</p>
          <p className="text-xl font-semibold">{drafts}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Require Ack</p>
          <p className="text-xl font-semibold">{needAck}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Total</p>
          <p className="text-xl font-semibold">{policies.length}</p>
        </div>
      </div>

      <SectionCard
        title="Policies"
        action={
          <select
            value={statusF}
            onChange={e => setStatusF(e.target.value as typeof statusF)}
            className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
          >
            {STATUS_FILTER_OPTIONS.map(s => (
              <option key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : policies.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <BookOpen className="h-8 w-8" />
            <p className="text-sm">No policies yet. Create the first one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="text-left py-2 px-3 text-xs font-medium">Title</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Category</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Ack</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Effective</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map(p => {
                  const sb = statusBadge(p.status)
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs font-medium">{p.title}</span>
                        </div>
                        {p.description && <p className="text-[10px] text-muted-foreground mt-0.5 pl-5 line-clamp-1">{p.description}</p>}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{categoryLabel(p.category)}</td>
                      <td className="py-2 px-3">
                        <Badge variant={sb.variant} className="text-[10px]">{sb.label}</Badge>
                        {p.is_mandatory && <Badge variant="outline" className="ml-1 text-[10px] bg-orange-50 text-orange-700 border-orange-200">Mandatory</Badge>}
                      </td>
                      <td className="py-2 px-3">
                        {p.requires_acknowledgement && p.status === 'published' ? (
                          <button
                            onClick={() => setAckViewId(p.id)}
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Users className="h-3 w-3" />
                            {p.ack_count} acked
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">
                            {p.requires_acknowledgement ? '—' : 'Not required'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{fmtDate(p.effective_from)}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(p)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          {p.status === 'draft' && (
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-success"
                              disabled={publishPolicy.isPending}
                              onClick={() => publishPolicy.mutate(p.id)}
                              title="Publish"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {p.status === 'published' && (
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground"
                              disabled={archivePolicy.isPending}
                              onClick={() => archivePolicy.mutate(p.id)}
                              title="Archive"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Create / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={o => { if (!o) { setFormOpen(false); setEditId(null); setForm(emptyForm) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit Policy' : 'New Policy'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title *</label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Work From Home Policy"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as PolicyCategory }))}
                  className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                >
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Effective From</label>
                <input
                  type="date"
                  value={form.effective_from}
                  onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Short one-line summary"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Policy Content
                <span className="text-muted-foreground/60 font-normal ml-1">(markdown supported)</span>
              </label>
              <textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Full policy text…"
                rows={8}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Document URL (optional)</label>
              <Input
                value={form.file_url}
                onChange={e => setForm(f => ({ ...f, file_url: e.target.value }))}
                placeholder="https://…/policy.pdf"
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requires_acknowledgement}
                onChange={e => setForm(f => ({ ...f, requires_acknowledgement: e.target.checked }))}
                className="rounded"
              />
              <div>
                <span className="text-sm font-medium">Require employee acknowledgement</span>
                <p className="text-xs text-muted-foreground">When published, all employees will be notified and asked to confirm they have read this policy.</p>
              </div>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.is_mandatory}
                onChange={e => setForm(f => ({ ...f, is_mandatory: e.target.checked }))}
                className="rounded"
              />
              <div>
                <span className="text-sm font-medium">Mandatory policy</span>
                <p className="text-xs text-muted-foreground">Mark as a statutory/mandatory policy (e.g. POSH, Compliance). Shown with a mandatory badge in the employee portal.</p>
              </div>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setFormOpen(false); setEditId(null); setForm(emptyForm) }}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isMutating}>
                {isMutating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editId ? 'Save Changes' : 'Create Draft'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── AI Q&A Logs ──────────────────────────────────────────────────────── */}
      <SectionCard
        title="Policy Assistant Q&A Logs"
        description="Questions employees asked the AI — last 50"
        action={
          <button
            onClick={() => setQaExpanded(o => !o)}
            className="text-xs text-primary hover:underline"
          >
            {qaExpanded ? 'Hide' : 'Show'}
          </button>
        }
      >
        {!qaExpanded ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Bot className="h-4 w-4" />
            Click "Show" to load employee Q&A history from the Policy Assistant.
          </div>
        ) : qaLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : qaLogs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <MessageSquare className="h-7 w-7" />
            <p className="text-sm">No Q&A sessions yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {qaLogs.map(log => {
              const emp = log.employees
              return (
                <div key={log.id} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {log.question}
                    </p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(log.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground pl-5 line-clamp-2">{log.answer}</p>
                  <div className="pl-5 flex items-center gap-3">
                    {emp && (
                      <span className="text-[10px] text-muted-foreground">
                        {emp.first_name} {emp.last_name} ({emp.employee_code})
                      </span>
                    )}
                    {log.cited_policy_ids.length > 0 && (
                      <span className="text-[10px] text-primary">
                        {log.cited_policy_ids.length} polic{log.cited_policy_ids.length !== 1 ? 'ies' : 'y'} cited
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Ack stats dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!ackViewId} onOpenChange={o => { if (!o) setAckViewId(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Acknowledgement Report
            </DialogTitle>
          </DialogHeader>

          {ackLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : ackStats ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-xl font-semibold text-success">{ackStats.acknowledged}</p>
                  <p className="text-[10px] text-muted-foreground">Acknowledged</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-xl font-semibold text-warning">{ackStats.pending}</p>
                  <p className="text-[10px] text-muted-foreground">Pending</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-xl font-semibold">{ackStats.rate}%</p>
                  <p className="text-[10px] text-muted-foreground">Completion</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${ackStats.rate}%` }}
                />
              </div>

              {/* Location breakdown */}
              {(ackStats.location_breakdown ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">By Location</p>
                  <div className="space-y-1.5">
                    {ackStats.location_breakdown!.map(loc => (
                      <div key={loc.location_id}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span>{loc.location_name}</span>
                          <span className="text-muted-foreground">{loc.acknowledged}/{loc.total} ({loc.rate}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${loc.rate}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Employee list */}
              <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border border-border">
                {ackStats.employees.map(e => (
                  <div key={e.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors">
                    <div>
                      <p className="text-xs font-medium">{e.first_name} {e.last_name}</p>
                      <p className="text-[10px] text-muted-foreground">{e.employee_code}</p>
                    </div>
                    {e.acknowledged ? (
                      <div className="flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span className="text-[10px]">{e.acknowledged_at ? new Date(e.acknowledged_at).toLocaleDateString('en-IN') : 'Acked'}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-warning">
                        <Clock className="h-3.5 w-3.5" />
                        <span className="text-[10px]">Pending</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
