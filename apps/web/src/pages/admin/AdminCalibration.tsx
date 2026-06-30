/**
 * AdminCalibration — /admin/calibration
 *
 * Calibration sessions for succession planning: create sessions, log candidate
 * adjustments (readiness, scores), view the full change log, and close sessions
 * once calibration is complete.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList, Plus, ChevronRight, Loader2, X, Check,
  Clock, CheckCircle2, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CalibrationSession {
  id:         string
  title:      string
  status:     'open' | 'closed'
  created_at: string
  closed_at:  string | null
}

interface CalibrationChange {
  id:            string
  field_changed: string
  old_value:     string | null
  new_value:     string | null
  notes:         string | null
  created_at:    string
  employees: {
    first_name:    string
    last_name:     string
    employee_code: string
  } | null
}

interface SessionDetail extends CalibrationSession {
  participants: string[]
  changes:      CalibrationChange[]
}

const FIELD_LABELS: Record<string, string> = {
  readiness_level:     'Readiness Level',
  score_performance:   'Performance Score',
  score_skill_gap:     'Skill Gap Score',
  score_leadership:    'Leadership Score',
  score_mobility:      'Mobility Score',
  score_tenure:        'Tenure Score',
  score_attrition_risk:'Attrition Risk Score',
  nine_box_performance:'9-Box Performance',
  nine_box_potential:  '9-Box Potential',
}

const VALID_FIELDS = Object.keys(FIELD_LABELS)

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminCalibration() {
  const qc = useQueryClient()

  const [createOpen,  setCreateOpen]  = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [detailId,    setDetailId]    = useState<string | null>(null)

  // Add-change form state
  const [addChangeOpen,    setAddChangeOpen]    = useState(false)
  const [changeEmpId,      setChangeEmpId]      = useState<string | null>(null)
  const [changeCandId,     setChangeCandId]     = useState('')
  const [changeField,      setChangeField]      = useState(VALID_FIELDS[0])
  const [changeOldVal,     setChangeOldVal]     = useState('')
  const [changeNewVal,     setChangeNewVal]     = useState('')
  const [changeNotes,      setChangeNotes]      = useState('')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: sessions = [], isLoading } = useQuery<CalibrationSession[]>({
    queryKey: ['calibration-sessions'],
    queryFn:  () => api.get<{ data: CalibrationSession[] }>('/succession/calibration').then(r => r.data ?? []),
  })

  const { data: detail, isLoading: detailLoading } = useQuery<SessionDetail>({
    queryKey: ['calibration-session', detailId],
    queryFn:  () =>
      api.get<{ data: SessionDetail }>(`/succession/calibration/${detailId}`).then(r => r.data),
    enabled: !!detailId,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createSession = useMutation({
    mutationFn: (title: string) =>
      api.post('/succession/calibration', { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calibration-sessions'] })
      toast.success('Calibration session created')
      setCreateOpen(false)
      setCreateTitle('')
    },
    onError: (e: Error) => toast.error('Failed to create session', { description: e.message }),
  })

  const addChange = useMutation({
    mutationFn: (payload: {
      sessionId:     string
      candidate_id:  string
      field_changed: string
      old_value:     string
      new_value:     string
      notes:         string
    }) =>
      api.post(`/succession/calibration/${payload.sessionId}/changes`, {
        candidate_id:  payload.candidate_id,
        field_changed: payload.field_changed,
        old_value:     payload.old_value  || undefined,
        new_value:     payload.new_value  || undefined,
        notes:         payload.notes      || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calibration-session', detailId] })
      toast.success('Change recorded')
      setAddChangeOpen(false)
      setChangeEmpId(null)
      setChangeCandId('')
      setChangeField(VALID_FIELDS[0])
      setChangeOldVal('')
      setChangeNewVal('')
      setChangeNotes('')
    },
    onError: (e: Error) => toast.error('Failed to record change', { description: e.message }),
  })

  const closeSession = useMutation({
    mutationFn: (sessionId: string) =>
      api.patch(`/succession/calibration/${sessionId}/close`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calibration-sessions'] })
      qc.invalidateQueries({ queryKey: ['calibration-session', detailId] })
      toast.success('Session closed')
    },
    onError: (e: Error) => toast.error('Failed to close session', { description: e.message }),
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmtName(e: CalibrationChange['employees']) {
    if (!e) return '—'
    return `${e.first_name} ${e.last_name} (${e.employee_code})`
  }

  const openSessions   = sessions.filter(s => s.status === 'open')
  const closedSessions = sessions.filter(s => s.status === 'closed')

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Calibration Sessions"
        subtitle="Structured sessions to align succession candidate ratings across reviewers"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />New Session
          </Button>
        }
      />

      <SectionCard>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <ClipboardList className="h-8 w-8" />
            <p className="text-sm">No calibration sessions yet.</p>
            <p className="text-xs">Create a session to start aligning succession candidate ratings.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {openSessions.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Open ({openSessions.length})
                </p>
                <div className="rounded-md border border-border overflow-hidden">
                  {openSessions.map((s, idx) => (
                    <button
                      key={s.id}
                      onClick={() => setDetailId(s.id)}
                      className={cn(
                        'w-full text-left flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors',
                        idx < openSessions.length - 1 && 'border-b border-border/50',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Clock className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(s.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4 shrink-0">
                        <Badge variant="default" className="text-[10px]">Open</Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {closedSessions.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Closed ({closedSessions.length})
                </p>
                <div className="rounded-md border border-border overflow-hidden">
                  {closedSessions.map((s, idx) => (
                    <button
                      key={s.id}
                      onClick={() => setDetailId(s.id)}
                      className={cn(
                        'w-full text-left flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors',
                        idx < closedSessions.length - 1 && 'border-b border-border/50',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate text-muted-foreground">{s.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Closed {s.closed_at ? new Date(s.closed_at).toLocaleDateString() : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4 shrink-0">
                        <Badge variant="secondary" className="text-[10px]">Closed</Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Create Session Dialog ────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setCreateOpen(false); setCreateTitle('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Calibration Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Session Title *</label>
              <input
                value={createTitle}
                onChange={e => setCreateTitle(e.target.value)}
                placeholder="e.g. Q2 2026 Succession Calibration"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setCreateOpen(false); setCreateTitle('') }}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!createTitle.trim()) { toast.error('Title is required'); return }
                  createSession.mutate(createTitle.trim())
                }}
                disabled={createSession.isPending}
              >
                {createSession.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Create Session
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Session Detail Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!detailId} onOpenChange={o => { if (!o) setDetailId(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailLoading || !detail ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
                  <span>{detail.title}</span>
                  <Badge variant={detail.status === 'open' ? 'default' : 'secondary'} className="text-[10px] capitalize">
                    {detail.status}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-muted-foreground">
                  Created {new Date(detail.created_at).toLocaleDateString()}
                  {detail.closed_at && ` · Closed ${new Date(detail.closed_at).toLocaleDateString()}`}
                </p>
                {detail.status === 'open' && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAddChangeOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />Record Change
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      disabled={closeSession.isPending}
                      onClick={() => {
                        if (window.confirm('Close this calibration session? This cannot be undone.')) {
                          closeSession.mutate(detail.id)
                        }
                      }}
                    >
                      {closeSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5 mr-1" />}
                      Close Session
                    </Button>
                  </div>
                )}
              </div>

              {/* Change log */}
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  Change Log
                  <span className="text-xs font-normal text-muted-foreground ml-1">({detail.changes.length})</span>
                </h3>

                {detail.changes.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground rounded-lg border border-dashed border-border">
                    <Users className="h-6 w-6" />
                    <p className="text-sm">No changes recorded yet.</p>
                    {detail.status === 'open' && (
                      <p className="text-xs">Use "Record Change" to log calibration adjustments.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-border overflow-hidden">
                    {detail.changes.map((c, idx) => (
                      <div
                        key={c.id}
                        className={cn(
                          'px-4 py-3',
                          idx < detail.changes.length - 1 && 'border-b border-border/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground">
                              {fmtName(c.employees)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              <span className="font-medium text-foreground">
                                {FIELD_LABELS[c.field_changed] ?? c.field_changed}
                              </span>
                              {' '}changed{' '}
                              {c.old_value != null && (
                                <span className="line-through text-muted-foreground">{c.old_value}</span>
                              )}
                              {c.old_value != null && c.new_value != null && ' → '}
                              {c.new_value != null && (
                                <span className="text-foreground font-medium">{c.new_value}</span>
                              )}
                            </p>
                            {c.notes && (
                              <p className="text-[11px] text-muted-foreground mt-1 italic">{c.notes}</p>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Record Change Dialog ─────────────────────────────────────────────── */}
      <Dialog open={addChangeOpen} onOpenChange={o => {
        if (!o) {
          setAddChangeOpen(false)
          setChangeEmpId(null)
          setChangeCandId('')
          setChangeField(VALID_FIELDS[0])
          setChangeOldVal('')
          setChangeNewVal('')
          setChangeNotes('')
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Calibration Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Candidate *</label>
              <EmployeeSelector
                value={changeEmpId ?? undefined}
                onChange={v => {
                  const id = typeof v === 'string' ? v : null
                  setChangeEmpId(id)
                  setChangeCandId(id ?? '')
                }}
                placeholder="Search candidate by name or code…"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Field *</label>
              <select
                value={changeField}
                onChange={e => setChangeField(e.target.value)}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
              >
                {VALID_FIELDS.map(f => (
                  <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Previous Value</label>
                <input
                  value={changeOldVal}
                  onChange={e => setChangeOldVal(e.target.value)}
                  placeholder="Before calibration"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">New Value *</label>
                <input
                  value={changeNewVal}
                  onChange={e => setChangeNewVal(e.target.value)}
                  placeholder="After calibration"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <textarea
                value={changeNotes}
                onChange={e => setChangeNotes(e.target.value)}
                placeholder="Rationale for this calibration adjustment…"
                rows={2}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setAddChangeOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!detailId)        { toast.error('No session selected'); return }
                  if (!changeCandId)    { toast.error('Candidate is required'); return }
                  if (!changeNewVal.trim()) { toast.error('New value is required'); return }
                  addChange.mutate({
                    sessionId:     detailId,
                    candidate_id:  changeCandId,
                    field_changed: changeField,
                    old_value:     changeOldVal,
                    new_value:     changeNewVal,
                    notes:         changeNotes,
                  })
                }}
                disabled={addChange.isPending}
              >
                {addChange.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  : <Check className="h-4 w-4 mr-1" />}
                Record Change
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
