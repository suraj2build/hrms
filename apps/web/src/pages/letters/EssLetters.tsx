/**
 * ESS Letters Page — Employee self-service view
 *
 * Tabs:
 *  1. My Letters   — letters that have been issued to this employee
 *  2. Request      — request a new letter (ess_requestable templates)
 *  3. My Requests  — status of past requests
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Download, Clock, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Plus, BookOpen, ClipboardList,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label }  from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

// ── Types ─────────────────────────────────────────────────────────────────────

interface IssuedLetter {
  id: string
  subject: string
  approval_status: string
  issued_at: string | null
  created_at: string
  template: { name: string; letter_type: string }
}

interface IssuedLetterDetail extends IssuedLetter {
  body_html: string
}

interface EssTemplate {
  id: string
  name: string
  letter_type: string
  requires_approval: boolean
  approval_levels: number
}

interface MyRequest {
  id: string
  reason: string
  status: 'pending' | 'processing' | 'fulfilled' | 'rejected'
  requested_at: string
  processed_at: string | null
  rejection_reason: string | null
  template: { name: string; letter_type: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; icon: React.ComponentType<{className?:string}> }> = {
    issued:      { label: 'Issued',      cls: 'text-success bg-success/10',       icon: CheckCircle2 },
    pending:     { label: 'Pending',     cls: 'text-warning bg-warning/10',       icon: Clock         },
    processing:  { label: 'Processing',  cls: 'text-info bg-info/10',             icon: Clock         },
    fulfilled:   { label: 'Fulfilled',   cls: 'text-success bg-success/10',       icon: CheckCircle2  },
    rejected:    { label: 'Rejected',    cls: 'text-destructive bg-destructive/10', icon: XCircle       },
  }
  const m = map[status] ?? { label: status, cls: 'text-muted-foreground bg-muted', icon: Clock }
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full', m.cls)}>
      <m.icon className="h-2.5 w-2.5" />
      {m.label}
    </span>
  )
}

const LETTER_TYPE_ICONS: Record<string, string> = {
  offer:        '📋',
  appointment:  '🤝',
  confirmation: '✅',
  increment:    '💰',
  relieving:    '🚪',
  experience:   '📜',
  salary:       '💵',
  warning:      '⚠️',
  custom:       '📄',
}

// ── Letter Viewer Dialog ──────────────────────────────────────────────────────

function LetterViewDialog({ letterId, onClose }: { letterId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ess-letter-detail', letterId],
    queryFn: () => api.get<{ data: IssuedLetterDetail }>(`/letters/ess/my-letters/${letterId}`),
  })
  const letter = data?.data

  function printLetter() {
    const html = letter?.body_html ?? ''
    const win  = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>${letter?.subject ?? 'Letter'}</title>
    <style>body{font-family:Georgia,serif;max-width:750px;margin:40px auto;font-size:13px;line-height:1.6}</style>
    </head><body>${html}</body></html>`)
    win.document.close()
    win.print()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{letter?.subject ?? 'Letter'}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : letter ? (
          <div
            className="prose prose-sm max-w-none text-foreground border rounded-md p-6 min-h-[300px]"
            dangerouslySetInnerHTML={{ __html: letter.body_html }}
          />
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">Letter not found</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {letter && (
            <Button onClick={printLetter}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Print / Save as PDF
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Request Letter Dialog ─────────────────────────────────────────────────────

function RequestLetterDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState('')
  const [reason,     setReason]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)

  const { data: tmplData } = useQuery({
    queryKey: ['ess-requestable-templates'],
    queryFn: () => api.get<{ data: EssTemplate[] }>('/letters/ess/templates'),
  })
  const templates = tmplData?.data ?? []
  const selected  = templates.find(t => t.id === selectedId)

  async function submit() {
    if (!selectedId) return
    setSubmitting(true)
    try {
      await api.post('/letters/ess/request', { template_id: selectedId, reason })
      qc.invalidateQueries({ queryKey: ['my-letter-requests'] })
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request a Letter</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-medium text-center">Request submitted!</p>
            <p className="text-sm text-muted-foreground text-center">HR will process your request and issue the letter shortly.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 border rounded-lg text-xs text-center transition-colors',
                    selectedId === t.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/40 hover:bg-sidebar-accent text-foreground'
                  )}
                >
                  <span className="text-xl">{LETTER_TYPE_ICONS[t.letter_type] ?? '📄'}</span>
                  <span className="font-medium leading-tight">{t.name}</span>
                  {t.requires_approval && (
                    <span className="text-[10px] text-warning">Needs approval</span>
                  )}
                </button>
              ))}
              {templates.length === 0 && (
                <div className="col-span-2 py-8 text-center text-sm text-muted-foreground">
                  No letter types available for self-service requests
                </div>
              )}
            </div>

            {selectedId && (
              <div className="space-y-1">
                <Label className="text-xs">Reason / Purpose <span className="text-muted-foreground">(optional)</span></Label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={`Why do you need a ${selected?.name ?? 'letter'}? e.g. For visa application, bank loan…`}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={!selectedId || submitting}>
                {submitting ? 'Submitting…' : 'Submit Request'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'my-letters' | 'request' | 'my-requests'

export function EssLetters() {
  const [tab,        setTab]        = useState<Tab>('my-letters')
  const [viewId,     setViewId]     = useState<string | null>(null)
  const [showReq,    setShowReq]    = useState(false)

  // My Letters
  const { data: lettersData, isLoading: lettersLoading, refetch: refetchLetters } = useQuery({
    queryKey: ['ess-my-letters'],
    queryFn: () => api.get<{ data: IssuedLetter[] }>('/letters/ess/my-letters'),
    staleTime: 60_000,
  })
  const myLetters = lettersData?.data ?? []

  // My Requests
  const { data: reqData, isLoading: reqLoading, refetch: refetchReq } = useQuery({
    queryKey: ['my-letter-requests'],
    queryFn: () => api.get<{ data: MyRequest[] }>('/letters/ess/requests'),
    staleTime: 30_000,
    enabled: tab === 'my-requests',
  })
  const myRequests = reqData?.data ?? []

  const TABS = [
    { id: 'my-letters'  as Tab, label: 'My Letters',  icon: FileText        },
    { id: 'request'     as Tab, label: 'Request',      icon: Plus            },
    { id: 'my-requests' as Tab, label: 'My Requests',  icon: ClipboardList   },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            My Letters
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">View your letters and request new ones from HR</p>
        </div>
        <Button onClick={() => setShowReq(true)} size="sm">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Request a Letter
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-6 border-b border-border/50 flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── MY LETTERS ────────────────────────────────────────────────────── */}
        {tab === 'my-letters' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{myLetters.length} letter{myLetters.length !== 1 ? 's' : ''} issued to you</p>
              <Button variant="outline" size="sm" onClick={() => refetchLetters()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {lettersLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
            ) : myLetters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/50">
                <FileText className="h-10 w-10" />
                <p className="text-sm">No letters issued to you yet</p>
                <Button variant="outline" size="sm" onClick={() => setShowReq(true)}>
                  Request a Letter
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {myLetters.map(l => (
                  <div
                    key={l.id}
                    className="border border-border/50 rounded-lg p-4 space-y-3 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => setViewId(l.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xl">
                        {LETTER_TYPE_ICONS[l.template?.letter_type] ?? '📄'}
                      </div>
                      {statusBadge(l.approval_status)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground leading-tight">{l.template?.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{l.subject}</p>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Issued {fmt(l.issued_at)}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setViewId(l.id) }}
                        className="text-primary hover:underline flex items-center gap-0.5"
                      >
                        <Download className="h-2.5 w-2.5" /> View / Print
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── REQUEST ───────────────────────────────────────────────────────── */}
        {tab === 'request' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-foreground">Request a Letter</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Select the letter type you need. HR will generate and issue it to you.
              </p>
            </div>
            <Button onClick={() => setShowReq(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Start Request
            </Button>
          </div>
        )}

        {/* ── MY REQUESTS ───────────────────────────────────────────────────── */}
        {tab === 'my-requests' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{myRequests.length} request{myRequests.length !== 1 ? 's' : ''}</p>
              <Button variant="outline" size="sm" onClick={() => refetchReq()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {reqLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
            ) : myRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/50">
                <ClipboardList className="h-10 w-10" />
                <p className="text-sm">No letter requests yet</p>
              </div>
            ) : (
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/30 border-b border-border/40">
                    <tr>
                      {['Letter', 'Reason', 'Requested', 'Status', ''].map(h => (
                        <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide px-3 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {myRequests.map(r => (
                      <tr key={r.id} className="hover:bg-sidebar-accent/50 transition-colors">
                        <td className="px-3 py-2.5 text-[13px]">
                          <div className="font-medium">{r.template?.name}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[13px] max-w-[200px] truncate text-muted-foreground">
                          {r.reason || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-muted-foreground">{fmt(r.requested_at)}</td>
                        <td className="px-3 py-2.5">{statusBadge(r.status)}</td>
                        <td className="px-3 py-2.5">
                          {r.status === 'rejected' && r.rejection_reason && (
                            <span className="text-[11px] text-destructive flex items-center gap-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" /> {r.rejection_reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────────────── */}
      {viewId  && <LetterViewDialog letterId={viewId} onClose={() => setViewId(null)} />}
      {showReq && <RequestLetterDialog onClose={() => setShowReq(false)} />}
    </div>
  )
}
