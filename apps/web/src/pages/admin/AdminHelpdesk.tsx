/**
 * AdminHelpdesk — /admin/helpdesk  (ESS-05)
 *
 * HR queue for employee helpdesk tickets: filter, assign to an agent,
 * converse (public + internal notes), and resolve with a resolution note.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, MessageSquare, Send, AlertTriangle, Clock, Lock, StickyNote, Sparkles, Star } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }  from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type TicketStatus = 'open' | 'in_progress' | 'awaiting_employee' | 'resolved' | 'closed'
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

interface Comment {
  id: string
  author_role: 'employee' | 'hr'
  body: string
  is_internal: boolean
  created_at: string
}

interface Ticket {
  id: string
  subject: string
  description: string
  category: string
  priority: TicketPriority
  status: TicketStatus
  assigned_to: string | null
  sla_due_at: string | null
  sla_breached_at: string | null
  resolution_due_at: string | null
  resolution_breached_at: string | null
  resolution_note: string | null
  csat_rating: number | null
  created_at: string
  employees?: { first_name: string; last_name: string; employee_code: string } | null
  comments?: Comment[]
}

interface Agent { id: string; full_name: string | null; role: string }
interface Stats { total: number; open: number; breached: number; resolution_breached: number; by_status: Record<string, number> }
interface CsatStats { average: number | null; total: number; by_rating: Record<string, number> }
interface SlaPolicy { priority: TicketPriority; response_hours: number; resolution_hours: number; is_custom: boolean }

const STATUSES: TicketStatus[] = ['open', 'in_progress', 'awaiting_employee', 'resolved', 'closed']

type BadgeVariant = NonNullable<BadgeProps['variant']>

function statusBadge(s: TicketStatus): { variant: BadgeVariant; label: string } {
  switch (s) {
    case 'open':              return { variant: 'secondary', label: 'Open' }
    case 'in_progress':       return { variant: 'default',   label: 'In Progress' }
    case 'awaiting_employee': return { variant: 'outline',   label: 'Awaiting Employee' }
    case 'resolved':          return { variant: 'success',   label: 'Resolved' }
    case 'closed':            return { variant: 'secondary', label: 'Closed' }
    default:                  return { variant: 'outline',   label: s }
  }
}
function priorityColor(p: TicketPriority): string {
  switch (p) {
    case 'urgent': return 'text-destructive border-destructive/30 bg-destructive/10'
    case 'high':   return 'text-accent-coral border-accent-coral/30 bg-accent-coral/10'
    case 'medium': return 'text-warning border-warning/30 bg-warning/10'
    default:       return 'text-success border-success/30 bg-success/10'
  }
}
function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function CsatStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={cn('h-3 w-3', i <= rating ? 'fill-warning text-warning' : 'text-muted-foreground/25')} />
      ))}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminHelpdesk() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [statusF, setStatusF]     = useState('all')
  const [priorityF, setPriorityF] = useState('all')
  const [openId, setOpenId]       = useState<string | null>(null)
  const [reply, setReply]         = useState('')
  const [internal, setInternal]   = useState(false)
  const [resNote, setResNote]     = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [aiLoading, setAiLoading] = useState(false)

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['admin-helpdesk', statusF, priorityF],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (statusF !== 'all')   params.set('status', statusF)
      if (priorityF !== 'all') params.set('priority', priorityF)
      const qsStr = params.toString()
      return api.get<{ data: Ticket[] }>(`/helpdesk/tickets${qsStr ? `?${qsStr}` : ''}`).then(r => r.data ?? [])
    },
    enabled: isAdmin,
  })

  const { data: stats } = useQuery<Stats>({
    queryKey: ['admin-helpdesk', 'stats'],
    queryFn:  () => api.get<{ data: Stats }>('/helpdesk/stats').then(r => r.data),
    enabled:  isAdmin,
  })

  const { data: csatStats } = useQuery<CsatStats>({
    queryKey: ['admin-helpdesk', 'csat-stats'],
    queryFn:  () => api.get<{ data: CsatStats }>('/helpdesk/stats/csat').then(r => r.data),
    enabled:  isAdmin,
  })

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['admin-helpdesk', 'agents'],
    queryFn:  () => api.get<{ data: Agent[] }>('/helpdesk/agents').then(r => r.data ?? []),
    enabled:  isAdmin,
  })

  const { data: detail } = useQuery<Ticket | null>({
    queryKey: ['admin-helpdesk', 'detail', openId],
    queryFn:  () => api.get<{ data: Ticket | null }>(`/helpdesk/tickets/${openId}`).then(r => r.data ?? null),
    enabled:  !!openId,
  })

  // ── SLA policy configuration ───────────────────────────────────────────────
  const [showSla, setShowSla] = useState(false)
  const [slaDraft, setSlaDraft] = useState<SlaPolicy[] | null>(null)
  const { data: slaPolicies = [] } = useQuery<SlaPolicy[]>({
    queryKey: ['admin-helpdesk', 'sla-policies'],
    queryFn:  () => api.get<{ data: SlaPolicy[] }>('/helpdesk/sla-policies').then(r => r.data ?? []),
    enabled:  isAdmin,
  })
  const policyRows = slaDraft ?? slaPolicies
  const saveSla = useMutation({
    mutationFn: (policies: SlaPolicy[]) =>
      api.put('/helpdesk/sla-policies', {
        policies: policies.map(p => ({ priority: p.priority, response_hours: p.response_hours, resolution_hours: p.resolution_hours })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-helpdesk', 'sla-policies'] })
      setSlaDraft(null)
      toast.success('SLA policy saved')
    },
    onError: (e: Error) => toast.error('Failed to save SLA policy', { description: e.message }),
  })
  const editPolicy = (priority: TicketPriority, field: 'response_hours' | 'resolution_hours', value: number) => {
    setSlaDraft(policyRows.map(p => p.priority === priority ? { ...p, [field]: value } : p))
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-helpdesk'] })
  }

  const assign = useMutation({
    mutationFn: ({ id, assigned_to }: { id: string; assigned_to: string | null }) =>
      api.post(`/helpdesk/tickets/${id}/assign`, { assigned_to }),
    onSuccess: () => { invalidate(); toast.success('Assignment updated') },
    onError: (e: Error) => toast.error('Failed to assign', { description: e.message }),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status, resolution_note }: { id: string; status: TicketStatus; resolution_note?: string }) =>
      api.post(`/helpdesk/tickets/${id}/status`, { status, resolution_note }),
    onSuccess: () => { invalidate(); setResNote(''); toast.success('Status updated') },
    onError: (e: Error) => toast.error('Failed to update status', { description: e.message }),
  })

  const addComment = useMutation({
    mutationFn: ({ id, body, is_internal }: { id: string; body: string; is_internal: boolean }) =>
      api.post(`/helpdesk/tickets/${id}/comments`, { body, is_internal }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-helpdesk', 'detail', openId] })
      invalidate()
      setReply('')
    },
    onError: (e: Error) => toast.error('Failed to send', { description: e.message }),
  })

  const bulkStatus = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: TicketStatus }) =>
      api.post('/helpdesk/tickets/bulk-status', { ticket_ids: ids, status }),
    onSuccess: (_data, vars) => {
      invalidate()
      setSelectedIds(new Set())
      toast.success(`${vars.ids.length} ticket(s) marked as ${statusBadge(vars.status).label}`)
    },
    onError: (e: Error) => toast.error('Bulk update failed', { description: e.message }),
  })

  const handleAiSuggest = async () => {
    if (!openId) return
    setAiLoading(true)
    try {
      const result = await api.get<{ data: { suggestion: string } }>(`/helpdesk/tickets/${openId}/ai-suggest`)
      if (result.data?.suggestion) {
        setReply(result.data.suggestion)
        toast.success('AI suggestion ready — edit before sending')
      }
    } catch (e) {
      toast.error('AI suggest failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    } finally {
      setAiLoading(false)
    }
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === tickets.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tickets.map(t => t.id)))
    }
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <MessageSquare className="h-8 w-8" />
          <p className="text-sm">HR Helpdesk is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  const selectedArr = Array.from(selectedIds)

  return (
    <PageContainer>
      <PageHeader
        title="HR Helpdesk"
        subtitle="Employee support tickets — assign, respond, and resolve"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowSla(s => !s)}>
            <Clock className="h-4 w-4 mr-1" /> SLA Policy
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Open Tickets</p>
          <p className="text-xl font-semibold">{stats?.open ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Response Breached</p>
          <p className={cn('text-xl font-semibold', (stats?.breached ?? 0) > 0 && 'text-destructive')}>{stats?.breached ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Resolution Breached</p>
          <p className={cn('text-xl font-semibold', (stats?.resolution_breached ?? 0) > 0 && 'text-destructive')}>{stats?.resolution_breached ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Total</p>
          <p className="text-xl font-semibold">{stats?.total ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">Avg CSAT</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-xl font-semibold">{csatStats?.average != null ? csatStats.average.toFixed(1) : '—'}</p>
            {csatStats?.average != null && <Star className="h-4 w-4 fill-warning text-warning" />}
          </div>
          {(csatStats?.total ?? 0) > 0 && <p className="text-[10px] text-muted-foreground">{csatStats!.total} rated</p>}
        </div>
      </div>

      {/* SLA policy editor */}
      {showSla && (
        <SectionCard
          title="SLA Policy"
          action={
            <div className="flex items-center gap-2">
              {slaDraft && (
                <Button size="sm" variant="ghost" onClick={() => setSlaDraft(null)} disabled={saveSla.isPending}>Reset</Button>
              )}
              <Button size="sm" disabled={!slaDraft || saveSla.isPending} onClick={() => slaDraft && saveSla.mutate(slaDraft)}>
                {saveSla.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          }
        >
          <p className="text-xs text-muted-foreground mb-3">
            Hours from ticket creation to first HR response and to resolution, per priority. Applies to newly created tickets.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="text-left py-2 px-3 text-xs font-medium">Priority</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Response (h)</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Resolution (h)</th>
                </tr>
              </thead>
              <tbody>
                {policyRows.map(p => (
                  <tr key={p.priority} className="border-b border-border/50">
                    <td className="py-2 px-3"><Badge variant="outline" className={cn('text-[10px] capitalize', priorityColor(p.priority))}>{p.priority}</Badge></td>
                    <td className="py-2 px-3">
                      <input type="number" min={1} max={720} value={p.response_hours}
                        onChange={e => editPolicy(p.priority, 'response_hours', Math.max(1, Number(e.target.value) || 1))}
                        className="w-24 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min={1} max={2160} value={p.resolution_hours}
                        onChange={e => editPolicy(p.priority, 'resolution_hours', Math.max(1, Number(e.target.value) || 1))}
                        className="w-24 text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Ticket Queue"
        action={
          <div className="flex items-center gap-2">
            <select value={statusF} onChange={e => setStatusF(e.target.value)} className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground">
              <option value="all">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{statusBadge(s).label}</option>)}
            </select>
            <select value={priorityF} onChange={e => setPriorityF(e.target.value)} className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground">
              <option value="all">All priorities</option>
              {['urgent', 'high', 'medium', 'low'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </div>
        }
      >
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
            <span className="text-xs font-medium">{selectedIds.size} ticket{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" disabled={bulkStatus.isPending}
              onClick={() => bulkStatus.mutate({ ids: selectedArr, status: 'resolved' })}>
              {bulkStatus.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Resolve Selected
            </Button>
            <Button size="sm" variant="outline" disabled={bulkStatus.isPending}
              onClick={() => bulkStatus.mutate({ ids: selectedArr, status: 'closed' })}>
              Close Selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Cancel</Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8" /><p className="text-sm">No tickets match the filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="py-2 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={tickets.length > 0 && selectedIds.size === tickets.length}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Subject</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Employee</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Category</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Priority</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">CSAT</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Assigned</th>
                  <th className="text-left py-2 px-3 text-xs font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => {
                  const sb = statusBadge(t.status)
                  const breached = t.sla_breached_at && !['resolved', 'closed'].includes(t.status)
                  const emp = t.employees
                  const isSelected = selectedIds.has(t.id)
                  return (
                    <tr
                      key={t.id}
                      className={cn('border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors', isSelected && 'bg-primary/5')}
                      onClick={() => setOpenId(t.id)}
                    >
                      <td className="py-2 px-3" onClick={e => {
                        e.stopPropagation()
                        setSelectedIds(prev => {
                          const next = new Set(prev)
                          if (next.has(t.id)) next.delete(t.id)
                          else next.add(t.id)
                          return next
                        })
                      }}>
                        <input type="checkbox" checked={isSelected} onChange={() => {}} className="rounded pointer-events-none" />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          {breached && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          <span className="text-xs font-medium text-foreground">{t.subject}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{emp ? `${emp.first_name} ${emp.last_name}` : '—'}</td>
                      <td className="py-2 px-3 text-xs capitalize">{t.category.replace('_', ' ')}</td>
                      <td className="py-2 px-3"><Badge variant="outline" className={cn('text-[10px] capitalize', priorityColor(t.priority))}>{t.priority}</Badge></td>
                      <td className="py-2 px-3"><Badge variant={sb.variant} className="text-[10px]">{sb.label}</Badge></td>
                      <td className="py-2 px-3">
                        {t.csat_rating != null
                          ? <CsatStars rating={t.csat_rating} />
                          : <span className="text-[10px] text-muted-foreground/40">—</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {t.assigned_to ? (agents.find(a => a.id === t.assigned_to)?.full_name ?? 'Assigned') : <span className="text-muted-foreground/60">Unassigned</span>}
                      </td>
                      <td className="py-2 px-3 text-[10px] text-muted-foreground">{fmtDateTime(t.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Detail / manage ───────────────────────────────────────────────────── */}
      <Dialog open={!!openId} onOpenChange={o => { if (!o) { setOpenId(null); setReply(''); setResNote(''); setInternal(false) } }}>
        <DialogContent className="max-w-xl">
          {detail ? (
            <>
              <DialogHeader><DialogTitle className="pr-6">{detail.subject}</DialogTitle></DialogHeader>
              <div className="flex items-center gap-1.5 -mt-2 flex-wrap">
                <Badge variant="outline" className={cn('text-[10px] capitalize', priorityColor(detail.priority))}>{detail.priority}</Badge>
                <Badge variant={statusBadge(detail.status).variant} className="text-[10px]">{statusBadge(detail.status).label}</Badge>
                <span className="text-[10px] text-muted-foreground capitalize">{detail.category.replace('_', ' ')}</span>
                {detail.employees && <span className="text-[10px] text-muted-foreground">· {detail.employees.first_name} {detail.employees.last_name} ({detail.employees.employee_code})</span>}
                {detail.sla_breached_at && !['resolved', 'closed'].includes(detail.status) && (
                  <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 bg-destructive/10 gap-1"><AlertTriangle className="h-3 w-3" />Response SLA breached</Badge>
                )}
                {detail.resolution_breached_at && !['resolved', 'closed'].includes(detail.status) && (
                  <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 bg-destructive/10 gap-1"><AlertTriangle className="h-3 w-3" />Resolution SLA breached</Badge>
                )}
                {detail.csat_rating != null && (
                  <div className="flex items-center gap-1 ml-auto shrink-0">
                    <span className="text-[10px] text-muted-foreground">CSAT</span>
                    <CsatStars rating={detail.csat_rating} />
                  </div>
                )}
              </div>
              {(detail.sla_due_at || detail.resolution_due_at) && !['resolved', 'closed'].includes(detail.status) && (
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground -mt-1">
                  {detail.sla_due_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Response due {fmtDateTime(detail.sla_due_at)}</span>}
                  {detail.resolution_due_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Resolution due {fmtDateTime(detail.resolution_due_at)}</span>}
                </div>
              )}

              <p className="text-sm text-foreground border border-border rounded-md p-3 bg-muted/20">{detail.description}</p>

              {/* Manage row: assign + status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Assigned to</label>
                  <select
                    value={detail.assigned_to ?? ''}
                    onChange={e => assign.mutate({ id: detail.id, assigned_to: e.target.value || null })}
                    className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                  >
                    <option value="">Unassigned</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.full_name ?? 'Unassigned'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Status</label>
                  <select
                    value={detail.status}
                    onChange={e => setStatus.mutate({ id: detail.id, status: e.target.value as TicketStatus })}
                    className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{statusBadge(s).label}</option>)}
                  </select>
                </div>
              </div>

              {/* Resolution note (when resolving) */}
              {(detail.status === 'in_progress' || detail.status === 'awaiting_employee' || detail.status === 'open') && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Resolution note (optional)</label>
                    <input
                      value={resNote}
                      onChange={e => setResNote(e.target.value)}
                      placeholder="Summary of how this was resolved"
                      className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                    />
                  </div>
                  <Button size="sm" variant="outline" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: detail.id, status: 'resolved', resolution_note: resNote || undefined })}>
                    Resolve
                  </Button>
                </div>
              )}

              {detail.resolution_note && (
                <div className="rounded-md border border-success/30 bg-success/10 p-2.5 text-xs text-success">
                  <span className="font-medium">Resolution:</span> {detail.resolution_note}
                </div>
              )}

              {/* Thread */}
              <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                {(detail.comments ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No replies yet.</p>
                ) : (
                  detail.comments!.map(c => (
                    <div key={c.id} className={cn(
                      'rounded-lg p-2.5 text-sm border',
                      c.is_internal ? 'bg-warning/10 border-warning/30'
                        : c.author_role === 'hr' ? 'bg-primary/5 border-primary/15' : 'bg-muted/40 border-border',
                    )}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                          {c.is_internal && <StickyNote className="h-3 w-3 text-warning" />}
                          {c.author_role === 'hr' ? 'HR Team' : 'Employee'}{c.is_internal ? ' · Internal' : ''}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <p className="text-xs text-foreground whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Reply composer */}
              {detail.status !== 'closed' ? (
                <div className="space-y-2">
                  <textarea
                    value={reply} onChange={e => setReply(e.target.value)}
                    placeholder={internal ? 'Internal note (not visible to employee)…' : 'Reply to employee…'}
                    rows={2}
                    className={cn(
                      'w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground resize-none focus:outline-none focus:ring-1',
                      internal ? 'border-warning/50 focus:ring-warning/40' : 'border-border focus:ring-primary/30',
                    )}
                  />
                  <div className="flex items-center gap-2">
                    {/* Internal / public toggle pill */}
                    <button
                      type="button"
                      onClick={() => setInternal(v => !v)}
                      className={cn(
                        'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all',
                        internal
                          ? 'bg-warning/15 border-warning/50 text-warning font-medium'
                          : 'border-border text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      <StickyNote className="h-3 w-3" />
                      {internal ? 'Internal note' : 'Public reply'}
                    </button>

                    <div className="flex-1" />

                    {/* AI Suggest */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={aiLoading}
                      onClick={handleAiSuggest}
                      title="Draft a reply using AI based on the ticket thread"
                    >
                      {aiLoading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Sparkles className="h-3.5 w-3.5" />
                      }
                      <span className="ml-1">{aiLoading ? 'Thinking…' : 'AI Suggest'}</span>
                    </Button>

                    {/* Send */}
                    <Button
                      size="sm"
                      disabled={addComment.isPending || reply.trim().length === 0}
                      onClick={() => addComment.mutate({ id: detail.id, body: reply.trim(), is_internal: internal })}
                    >
                      {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      <span className="ml-1">Send</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1"><Lock className="h-3 w-3" />This ticket is closed.</p>
              )}
            </>
          ) : (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
