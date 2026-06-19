/**
 * CertificationWorkspace — /admin/workforce/certifications
 *
 * Program 2: Certification Governance.
 * Manage employee certifications, licenses, professional credentials, and renewals.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck, Plus, Search, AlertTriangle,
  Calendar, Building2, Trash2, Edit2,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { Label }         from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Certification {
  id:           string
  employee_id:  string
  cert_name:    string
  cert_type:    string
  issuing_body: string | null
  cert_number:  string | null
  issue_date:   string | null
  expiry_date:  string | null
  status:       string
  document_url: string | null
  notes:        string | null
  created_at:   string
  employees: {
    id:           string
    employee_code: string
    profiles: { full_name: string } | null
  } | null
}

interface CertStats {
  total:        number
  by_type:      Record<string, number>
  by_status:    Record<string, number>
  expiring_30d: number
  expiring_90d: number
}

interface ExpiringCert extends Certification {
  days_remaining: number
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  certification: { label: 'Certification', color: 'bg-blue-50   text-blue-700   border-blue-200'   },
  license:       { label: 'License',       color: 'bg-purple-50 text-purple-700 border-purple-200' },
  credential:    { label: 'Credential',    color: 'bg-teal-50   text-teal-700   border-teal-200'   },
  membership:    { label: 'Membership',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  active:  { label: 'Active',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expired: { label: 'Expired', color: 'bg-red-50     text-red-700     border-red-200'     },
  revoked: { label: 'Revoked', color: 'bg-gray-100   text-gray-600    border-gray-200'    },
  pending: { label: 'Pending', color: 'bg-amber-50   text-amber-700   border-amber-200'   },
}

// ── Form helper ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  employee_id:  '',
  cert_name:    '',
  cert_type:    'certification',
  issuing_body: '',
  cert_number:  '',
  issue_date:   '',
  expiry_date:  '',
  status:       'active',
  document_url: '',
  notes:        '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CertificationWorkspace() {
  const qc = useQueryClient()
  const [tab,    setTab]    = useState('all')
  const [search, setSearch] = useState('')
  const [typeF,  setTypeF]  = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Certification | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  // ── Queries ────────────────────────────────────────────────────────────────

  const statsQ = useQuery<CertStats>({
    queryKey: ['cert-stats'],
    queryFn:  () => api.get('/certifications/stats'),
  })

  const allParams = new URLSearchParams({ limit: '200' })
  if (search)         allParams.set('search', search)
  if (typeF !== 'all') allParams.set('cert_type', typeF)

  const allQ = useQuery<{ data: Certification[]; total: number }>({
    queryKey: ['certifications', search, typeF],
    queryFn:  () => api.get(`/certifications?${allParams}`),
    enabled:  tab === 'all',
  })

  const expiringQ = useQuery<{ data: ExpiringCert[]; days_window: number }>({
    queryKey: ['certifications-expiring'],
    queryFn:  () => api.get('/certifications/expiring?days=90'),
    enabled:  tab === 'expiring',
  })

  const expiredParams = new URLSearchParams({ status: 'expired', limit: '200' })
  const expiredQ = useQuery<{ data: Certification[] }>({
    queryKey: ['certifications-expired'],
    queryFn:  () => api.get(`/certifications?${expiredParams}`),
    enabled:  tab === 'expired',
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (f: typeof EMPTY_FORM) => {
      const body = {
        ...f,
        issuing_body: f.issuing_body || null,
        cert_number:  f.cert_number  || null,
        issue_date:   f.issue_date   || null,
        expiry_date:  f.expiry_date  || null,
        document_url: f.document_url || null,
        notes:        f.notes        || null,
      }
      if (editTarget) return api.put(`/certifications/${editTarget.id}`, body)
      return api.post('/certifications', body)
    },
    onSuccess: () => {
      toast.success(editTarget ? 'Certification updated' : 'Certification added')
      closeModal()
      qc.invalidateQueries({ queryKey: ['certifications'] })
      qc.invalidateQueries({ queryKey: ['cert-stats'] })
      qc.invalidateQueries({ queryKey: ['certifications-expiring'] })
      qc.invalidateQueries({ queryKey: ['certifications-expired'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/certifications/${id}`),
    onSuccess: () => {
      toast.success('Certification deleted')
      qc.invalidateQueries({ queryKey: ['certifications'] })
      qc.invalidateQueries({ queryKey: ['cert-stats'] })
    },
    onError: () => toast.error('Delete failed'),
  })

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(cert: Certification) {
    setEditTarget(cert)
    setForm({
      employee_id:  cert.employee_id,
      cert_name:    cert.cert_name,
      cert_type:    cert.cert_type,
      issuing_body: cert.issuing_body ?? '',
      cert_number:  cert.cert_number  ?? '',
      issue_date:   cert.issue_date   ?? '',
      expiry_date:  cert.expiry_date  ?? '',
      status:       cert.status,
      document_url: cert.document_url ?? '',
      notes:        cert.notes        ?? '',
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditTarget(null)
  }

  const stats = statsQ.data

  return (
    <PageContainer>
      <PageHeader
        title="Certifications & Licenses"
        subtitle="Track employee certifications, licenses, credentials, and renewal dates"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Certification
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total',         value: stats.total,        color: 'text-foreground'   },
            { label: 'Active',        value: stats.by_status?.active  ?? 0, color: 'text-emerald-600' },
            { label: 'Expiring (30d)',value: stats.expiring_30d,  color: 'text-amber-600'    },
            { label: 'Expired',       value: stats.by_status?.expired ?? 0, color: 'text-red-600'     },
          ].map(s => (
            <div key={s.label} className="rounded-xl border bg-card p-4">
              <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <SectionCard>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <TabsList>
              <TabsTrigger value="all">
                All {stats ? `(${stats.total})` : ''}
              </TabsTrigger>
              <TabsTrigger value="expiring">
                Expiring Soon {stats?.expiring_90d ? `(${stats.expiring_90d})` : ''}
              </TabsTrigger>
              <TabsTrigger value="expired">
                Expired {stats?.by_status?.expired ? `(${stats.by_status.expired})` : ''}
              </TabsTrigger>
            </TabsList>

            {tab === 'all' && (
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search certifications..."
                    className="pl-8 h-8 text-sm w-48"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <Select value={typeF} onValueChange={setTypeF}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="certification">Certification</SelectItem>
                    <SelectItem value="license">License</SelectItem>
                    <SelectItem value="credential">Credential</SelectItem>
                    <SelectItem value="membership">Membership</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <TabsContent value="all">
            <CertTable
              rows={allQ.data?.data ?? []}
              isLoading={allQ.isLoading}
              onEdit={openEdit}
              onDelete={id => deleteMutation.mutate(id)}
            />
          </TabsContent>

          <TabsContent value="expiring">
            <ExpiringTable
              rows={expiringQ.data?.data ?? []}
              isLoading={expiringQ.isLoading}
              onEdit={openEdit}
            />
          </TabsContent>

          <TabsContent value="expired">
            <CertTable
              rows={expiredQ.data?.data ?? []}
              isLoading={expiredQ.isLoading}
              onEdit={openEdit}
              onDelete={id => deleteMutation.mutate(id)}
            />
          </TabsContent>
        </Tabs>
      </SectionCard>

      {/* Add / Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={closeModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Certification' : 'Add Certification'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {!editTarget && (
              <div>
                <Label>Employee *</Label>
                <EmployeeSelector
                  className="mt-1 w-full"
                  placeholder="Search employee by name or code…"
                  value={form.employee_id}
                  onChange={v => setForm(f => ({ ...f, employee_id: typeof v === 'string' ? v : (v[0] ?? '') }))}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Certification Name *</Label>
                <Input className="mt-1" value={form.cert_name} onChange={e => setForm(f => ({ ...f, cert_name: e.target.value }))} />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.cert_type} onValueChange={v => setForm(f => ({ ...f, cert_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="certification">Certification</SelectItem>
                    <SelectItem value="license">License</SelectItem>
                    <SelectItem value="credential">Credential</SelectItem>
                    <SelectItem value="membership">Membership</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Issuing Body</Label>
                <Input className="mt-1" value={form.issuing_body} onChange={e => setForm(f => ({ ...f, issuing_body: e.target.value }))} />
              </div>
              <div>
                <Label>Certificate / License #</Label>
                <Input className="mt-1" value={form.cert_number} onChange={e => setForm(f => ({ ...f, cert_number: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Issue Date</Label>
                <Input type="date" className="mt-1" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
              </div>
              <div>
                <Label>Expiry Date</Label>
                <Input type="date" className="mt-1" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Document URL</Label>
                <Input className="mt-1" value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button
              disabled={!form.cert_name || (!editTarget && !form.employee_id) || saveMutation.isPending}
              onClick={() => saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? 'Saving...' : editTarget ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

// ── Sub-tables ────────────────────────────────────────────────────────────────

function CertTable({
  rows, isLoading, onEdit, onDelete,
}: { rows: Certification[]; isLoading: boolean; onEdit: (c: Certification) => void; onDelete: (id: string) => void }) {
  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
  if (rows.length === 0) return (
    <div className="py-12 text-center">
      <BadgeCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">No certifications found</p>
    </div>
  )
  return (
    <div className="divide-y divide-border">
      {rows.map(c => (
        <div key={c.id} className="py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{c.cert_name}</p>
              <Badge variant="outline" className={cn('text-[10px]', TYPE_META[c.cert_type]?.color)}>
                {TYPE_META[c.cert_type]?.label ?? c.cert_type}
              </Badge>
              <Badge variant="outline" className={cn('text-[10px]', STATUS_META[c.status]?.color)}>
                {STATUS_META[c.status]?.label ?? c.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {c.employees && (
                <span className="text-xs text-muted-foreground">
                  {c.employees.profiles?.full_name ?? '—'} · {c.employees.employee_code}
                </span>
              )}
              {c.issuing_body && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3" /> {c.issuing_body}
                </span>
              )}
              {c.expiry_date && (
                <span className={cn(
                  'flex items-center gap-1 text-xs',
                  new Date(c.expiry_date) < new Date() ? 'text-red-600' : 'text-muted-foreground',
                )}>
                  <Calendar className="h-3 w-3" />
                  Expires {format(new Date(c.expiry_date), 'dd MMM yyyy')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEdit(c)}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => { if (confirm('Delete this certification?')) onDelete(c.id) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function ExpiringTable({
  rows, isLoading, onEdit,
}: { rows: ExpiringCert[]; isLoading: boolean; onEdit: (c: Certification) => void }) {
  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
  if (rows.length === 0) return (
    <div className="py-12 text-center">
      <BadgeCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">No certifications expiring in the next 90 days</p>
    </div>
  )
  return (
    <div className="divide-y divide-border">
      {rows.map(c => (
        <div key={c.id} className="py-3 flex items-center gap-3">
          <div className={cn(
            'h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
            c.days_remaining <= 7  ? 'bg-red-100 text-red-700'    :
            c.days_remaining <= 30 ? 'bg-amber-100 text-amber-700' :
            'bg-blue-100 text-blue-700',
          )}>
            {c.days_remaining}d
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{c.cert_name}</p>
              <Badge variant="outline" className={cn('text-[10px]', TYPE_META[c.cert_type]?.color)}>
                {TYPE_META[c.cert_type]?.label ?? c.cert_type}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {c.employees && (
                <span className="text-xs text-muted-foreground">
                  {c.employees.profiles?.full_name ?? '—'} · {c.employees.employee_code}
                </span>
              )}
              {c.issuing_body && (
                <span className="text-xs text-muted-foreground">{c.issuing_body}</span>
              )}
              <span className={cn(
                'flex items-center gap-1 text-xs font-medium',
                c.days_remaining <= 7  ? 'text-red-600' :
                c.days_remaining <= 30 ? 'text-amber-600' : 'text-blue-600',
              )}>
                <AlertTriangle className="h-3 w-3" />
                Expires {format(new Date(c.expiry_date!), 'dd MMM yyyy')} ({c.days_remaining} days left)
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEdit(c)}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
