/**
 * EssHelpdesk — /ess/issues  (ESS-05)
 *
 * Employee helpdesk: raise support tickets, track status, and converse with HR.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, MessageSquare, Send, Clock, CheckCircle2, AlertTriangle, Star } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { cn }  from '@/lib/utils'
import { useOpenOnParam } from '@/lib/runbooks/useOpenOnParam'

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
  sla_due_at: string | null
  sla_breached_at: string | null
  resolution_note: string | null
  csat_rating: number | null
  csat_comment: string | null
  csat_submitted_at: string | null
  created_at: string
  updated_at: string
  comments?: Comment[]
}

const CATEGORIES = [
  { value: 'payroll', label: 'Payroll' },
  { value: 'leave', label: 'Leave' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'it', label: 'IT' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'hr_policy', label: 'HR Policy' },
  { value: 'other', label: 'Other' },
]
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success'

function statusBadge(s: TicketStatus): { variant: BadgeVariant; label: string } {
  switch (s) {
    case 'open':              return { variant: 'secondary',   label: 'Open' }
    case 'in_progress':       return { variant: 'default',     label: 'In Progress' }
    case 'awaiting_employee': return { variant: 'outline',     label: 'Awaiting You' }
    case 'resolved':          return { variant: 'success',     label: 'Resolved' }
    case 'closed':            return { variant: 'secondary',   label: 'Closed' }
    default:                  return { variant: 'outline',     label: s }
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

const defaultForm = { subject: '', description: '', category: 'other', priority: 'medium' }

// ── Component ─────────────────────────────────────────────────────────────────

export function EssHelpdesk() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(defaultForm)

  // Runbook deep-link (?new=1) auto-opens the new-ticket dialog.
  useOpenOnParam('new', () => setCreateOpen(true))
  const [openTicketId, setOpenTicketId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [csatHover, setCsatHover] = useState(0)
  const [csatRating, setCsatRating] = useState(0)
  const [csatComment, setCsatComment] = useState('')

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['helpdesk', 'my', statusFilter],
    queryFn:  () =>
      api.get<{ data?: Ticket[] }>(`/helpdesk/tickets/my${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`).then(r => r.data ?? []),
  })

  const { data: detail } = useQuery<Ticket | null>({
    queryKey: ['helpdesk', 'detail', openTicketId],
    queryFn:  () => api.get<{ data?: Ticket | null }>(`/helpdesk/tickets/${openTicketId}`).then(r => r.data ?? null),
    enabled:  !!openTicketId,
  })

  const createTicket = useMutation({
    mutationFn: (body: typeof defaultForm) => api.post('/helpdesk/tickets', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helpdesk', 'my'] })
      setCreateOpen(false)
      setForm(defaultForm)
      toast.success('Ticket raised — HR has been notified')
    },
    onError: (e: Error) => toast.error('Failed to raise ticket', { description: e.message }),
  })

  const submitCsat = useMutation({
    mutationFn: ({ id, rating, comment }: { id: string; rating: number; comment?: string }) =>
      api.post(`/helpdesk/tickets/${id}/csat`, { rating, comment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helpdesk', 'detail', openTicketId] })
      qc.invalidateQueries({ queryKey: ['helpdesk', 'my'] })
      setCsatRating(0)
      setCsatComment('')
      toast.success('Thank you for your feedback!')
    },
    onError: (e: Error) => toast.error('Failed to submit rating', { description: e.message }),
  })

  const addComment = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post(`/helpdesk/tickets/${id}/comments`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['helpdesk', 'detail', openTicketId] })
      qc.invalidateQueries({ queryKey: ['helpdesk', 'my'] })
      setReply('')
    },
    onError: (e: Error) => toast.error('Failed to send reply', { description: e.message }),
  })

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (form.subject.trim().length < 3 || form.description.trim().length < 5) {
      toast.error('Add a subject and a short description')
      return
    }
    createTicket.mutate(form)
  }

  const openCount = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length

  return (
    <PageContainer>
      <PageHeader
        title="Helpdesk"
        subtitle={`Raise and track HR / IT support requests${openCount ? ` · ${openCount} open` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="awaiting_employee">Awaiting You</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />New Ticket
            </Button>
          </div>
        }
      />

      <SectionCard title="My Tickets">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8" />
            <p className="text-sm">No tickets yet.</p>
            <p className="text-xs">Raise a ticket and HR will get back to you.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map(t => {
              const sb = statusBadge(t.status)
              const breached = t.sla_breached_at && !['resolved', 'closed'].includes(t.status)
              return (
                <button
                  key={t.id}
                  onClick={() => setOpenTicketId(t.id)}
                  className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.subject}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className={cn('text-[10px] capitalize', priorityColor(t.priority))}>{t.priority}</Badge>
                      <Badge variant={sb.variant} className="text-[10px]">{sb.label}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                    <span className="capitalize">{t.category.replace('_', ' ')}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDateTime(t.created_at)}</span>
                    {breached && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />SLA breached</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Create Ticket ─────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setCreateOpen(false); setForm(defaultForm) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Raise a Ticket</DialogTitle></DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Subject *</label>
              <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Short summary of your issue" required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description *</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe your issue in detail"
                rows={4}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-none"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground">
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground">
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => { setCreateOpen(false); setForm(defaultForm) }}>Cancel</Button>
              <Button type="submit" disabled={createTicket.isPending}>
                {createTicket.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Raise Ticket
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Ticket Detail / Thread ────────────────────────────────────────────── */}
      <Dialog open={!!openTicketId} onOpenChange={o => { if (!o) { setOpenTicketId(null); setReply(''); setCsatRating(0); setCsatComment(''); setCsatHover(0) } }}>
        <DialogContent className="max-w-lg">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6">{detail.subject}</DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-1.5 -mt-2">
                <Badge variant="outline" className={cn('text-[10px] capitalize', priorityColor(detail.priority))}>{detail.priority}</Badge>
                <Badge variant={statusBadge(detail.status).variant} className="text-[10px]">{statusBadge(detail.status).label}</Badge>
                <span className="text-[10px] text-muted-foreground capitalize ml-1">{detail.category.replace('_', ' ')}</span>
              </div>

              <p className="text-sm text-foreground border border-border rounded-md p-3 bg-muted/20">{detail.description}</p>

              {detail.resolution_note && (
                <div className="rounded-md border border-success/30 bg-success/10 p-3 flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <div><p className="text-xs font-medium text-success">Resolution</p><p className="text-xs text-success mt-0.5">{detail.resolution_note}</p></div>
                </div>
              )}

              {/* CSAT prompt — shown once after resolution when not yet rated */}
              {['resolved', 'closed'].includes(detail.status) && (
                detail.csat_rating != null ? (
                  <div className="rounded-md border border-border bg-muted/20 p-3 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Your rating:</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star key={i} className={cn('h-4 w-4', i <= detail.csat_rating! ? 'fill-warning text-warning' : 'text-muted-foreground/25')} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground ml-1">{detail.csat_rating}/5</span>
                  </div>
                ) : (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
                    <p className="text-xs font-medium text-foreground">How satisfied are you with the resolution?</p>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <button
                          key={i}
                          type="button"
                          onMouseEnter={() => setCsatHover(i)}
                          onMouseLeave={() => setCsatHover(0)}
                          onClick={() => setCsatRating(i)}
                          className="focus:outline-none"
                          aria-label={`Rate ${i} out of 5`}
                        >
                          <Star className={cn(
                            'h-6 w-6 transition-colors',
                            i <= (csatHover || csatRating)
                              ? 'fill-warning text-warning'
                              : 'text-muted-foreground/30 hover:text-warning/50',
                          )} />
                        </button>
                      ))}
                      {csatRating > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          {['', 'Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'][csatRating]}
                        </span>
                      )}
                    </div>
                    {csatRating > 0 && (
                      <div className="space-y-2">
                        <input
                          value={csatComment}
                          onChange={e => setCsatComment(e.target.value)}
                          placeholder="Leave a comment (optional)"
                          className="w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                        />
                        <Button
                          size="sm"
                          disabled={submitCsat.isPending}
                          onClick={() => submitCsat.mutate({ id: detail.id, rating: csatRating, comment: csatComment || undefined })}
                        >
                          {submitCsat.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                          Submit Rating
                        </Button>
                      </div>
                    )}
                  </div>
                )
              )}

              {/* Thread */}
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {(detail.comments ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No replies yet.</p>
                ) : (
                  detail.comments!.map(c => (
                    <div key={c.id} className={cn('rounded-lg p-2.5 text-sm', c.author_role === 'hr' ? 'bg-primary/5 border border-primary/15' : 'bg-muted/40 border border-border')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.author_role === 'hr' ? 'HR Team' : 'You'}</span>
                        <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <p className="text-xs text-foreground whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Reply box — disabled when closed */}
              {detail.status !== 'closed' ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder="Type a reply…"
                    rows={2}
                    className="flex-1 text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-none"
                  />
                  <Button
                    size="sm"
                    disabled={addComment.isPending || reply.trim().length === 0}
                    onClick={() => addComment.mutate({ id: detail.id, body: reply.trim() })}
                  >
                    {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center">This ticket is closed.</p>
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
