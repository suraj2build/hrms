/**
 * LeavePolicyEngine — /admin/leave-policy-engine
 *
 * Enterprise policy lifecycle management for named leave policy masters.
 *
 * Features:
 *   • Conflict detection banner (duplicate scopes / multiple defaults)
 *   • Policy master list with status state machine (draft→review→published→archived)
 *   • Publish / Request Review / Archive / Rollback actions
 *   • Immutable version history panel
 *   • Field-level change log panel
 *   • Simulation mode: resolve policy for an employee without production side-effects
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, AlertTriangle, CheckCircle2, Loader2,
  GitBranch, History, FileSearch, PlayCircle,
  Send, Archive, RotateCcw, ChevronRight,
  AlertCircle, BookOpen, User, Calendar,
  Info, LayoutGrid,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import { Input }          from '@/components/ui/input'
import { DateInput }      from '@/components/ui/date-input'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast }          from 'sonner'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn, fmtDate, fmtDateTime } from '@/lib/utils'
import { PolicyExplainPanel, PolicyScopeMatrix } from '@/components/operational/PolicyChain'
import type { PolicyResolutionInfo, PolicyResolvedVia, PolicyScopeSummary } from '@/components/operational/PolicyChain'
import { ContextualHint, ProcessStepGuide } from '@/components/operational/ContextualHint'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'

// ── Types ─────────────────────────────────────────────────────────────────────

type PolicyStatus = 'draft' | 'review' | 'published' | 'archived'

interface PolicyMaster {
  id:               string
  name:             string
  description:      string | null
  is_default:       boolean
  year_type:        'calendar' | 'financial'
  is_active:        boolean
  status:           PolicyStatus
  version:          number
  effective_from:   string | null
  published_at:     string | null
  publish_notes:    string | null
  created_at:       string
  updated_at:       string
  rule_count:       number
  assignment_count: number
}

interface PolicyVersion {
  id:          string
  version:     number
  snapshot_at: string
  snapshot_by: string | null
  reason:      string | null
}

interface ChangeLogEntry {
  id:            string
  operation:     string
  changed_by:    string | null
  changed_at:    string
  field_changes: Array<{ field: string; old_value: unknown; new_value: unknown }>
  comment:       string | null
}

interface PolicyConflict {
  type:        string
  description: string
  conflicting: string[]
  severity:    'warning' | 'error'
}

interface SimulationResult {
  employee: { id: string; name: string; employee_code: string }
  resolution: {
    policy_id:     string | null
    policy_name:   string | null
    policy_version: number | null
    source:        string
    priority_rank: number | null
    rules:         Array<{ leave_type_name: string; accrual_days_per_year: number; eligible: boolean }>
    evaluated_candidates?: Array<{ scope_type: string; priority: number; matched: boolean; policy_id: string | null }>
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<PolicyStatus, { variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  published: { variant: 'success',     label: 'Published' },
  review:    { variant: 'warning',     label: 'In Review' },
  draft:     { variant: 'secondary',   label: 'Draft' },
  archived:  { variant: 'destructive', label: 'Archived' },
}

const OP_LABEL: Record<string, string> = {
  create:  'Created',
  update:  'Updated',
  publish: 'Published',
  archive: 'Archived',
  rollback:'Rolled back',
  delete:  'Deleted',
}


// ── Main component ─────────────────────────────────────────────────────────────

export function LeavePolicyEngine() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [panelTab,     setPanelTab]     = useState<'versions' | 'changelog'>('versions')

  // Action dialogs
  const [publishOpen,  setPublishOpen]  = useState(false)
  const [publishNotes, setPublishNotes] = useState('')
  const [archiveOpen,  setArchiveOpen]  = useState(false)
  const [archiveReason,setArchiveReason]= useState('')
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackVer,  setRollbackVer]  = useState<number | null>(null)
  const [simOpen,      setSimOpen]      = useState(false)
  const [simEmpId,     setSimEmpId]     = useState('')
  const [simDate,      setSimDate]      = useState('')
  const [simResult,    setSimResult]    = useState<SimulationResult | null>(null)
  const [actionError,  setActionError]  = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: mastersData, isLoading: mastersLoading } = useQuery<{ data: PolicyMaster[] }>({
    queryKey: ['leave-policy-masters'],
    queryFn:  () => api.get('/masters/leave-policy-masters'),
    staleTime: 60_000,
  })
  const masters = mastersData?.data ?? []

  const { data: conflictsData } = useQuery<{ data: PolicyConflict[] }>({
    queryKey: ['policy-conflicts'],
    queryFn:  () => api.get('/masters/leave-policy-masters/conflicts'),
    staleTime: 120_000,
    enabled:  isAdmin,
  })
  const conflicts = conflictsData?.data ?? []

  const selected = masters.find(m => m.id === selectedId) ?? null

  const { data: versionsData, isLoading: versionsLoading } = useQuery<{ data: PolicyVersion[] }>({
    queryKey: ['policy-versions', selectedId],
    queryFn:  () => api.get(`/masters/leave-policy-masters/${selectedId}/versions`),
    enabled:  !!selectedId,
    staleTime: 60_000,
  })
  const versions = versionsData?.data ?? []

  const { data: changeLogData, isLoading: changeLogLoading } = useQuery<{ data: ChangeLogEntry[] }>({
    queryKey: ['policy-changelog', selectedId],
    queryFn:  () => api.get(`/masters/leave-policy-masters/${selectedId}/change-log`),
    enabled:  !!selectedId,
    staleTime: 60_000,
  })
  const changeLogs = changeLogData?.data ?? []

  // ── Mutations ────────────────────────────────────────────────────────────────
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['leave-policy-masters'] })
    qc.invalidateQueries({ queryKey: ['policy-conflicts'] })
    if (selectedId) {
      qc.invalidateQueries({ queryKey: ['policy-versions', selectedId] })
      qc.invalidateQueries({ queryKey: ['policy-changelog', selectedId] })
    }
  }

  const reviewMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/masters/leave-policy-masters/${id}/request-review`, {}),
    onSuccess: () => {
      invalidate()
      setActionError('')
      toast.success('Policy submitted for review')
    },
    onError: (e: Error) => {
      setActionError(e.message)
      toast.error('Failed to submit for review', { description: e.message })
    },
  })

  const publishMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.post(`/masters/leave-policy-masters/${id}/publish`, { notes }),
    onSuccess: () => {
      invalidate()
      setPublishOpen(false)
      setPublishNotes('')
      setActionError('')
      toast.success('Policy published', { description: 'Now active in the resolution engine.' })
    },
    onError: (e: Error) => {
      setActionError(e.message)
      toast.error('Failed to publish policy', { description: e.message })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/masters/leave-policy-masters/${id}/archive`, { reason }),
    onSuccess: () => {
      invalidate()
      setArchiveOpen(false)
      setArchiveReason('')
      setActionError('')
      toast.success('Policy archived')
    },
    onError: (e: Error) => {
      setActionError(e.message)
      toast.error('Failed to archive policy', { description: e.message })
    },
  })

  const rollbackMutation = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post(`/masters/leave-policy-masters/${id}/rollback/${version}`, {}),
    onSuccess: () => {
      invalidate()
      setRollbackOpen(false)
      setRollbackVer(null)
      setActionError('')
      toast.success(`Policy restored to v${rollbackVer}`, { description: 'A new draft has been created.' })
    },
    onError: (e: Error) => {
      setActionError(e.message)
      toast.error('Failed to rollback policy', { description: e.message })
    },
  })

  const simulateMutation = useMutation({
    mutationFn: ({ id, empId, date }: { id: string; empId: string; date: string }) => {
      const params = new URLSearchParams({ employee_id: empId })
      if (date) params.set('date', date)
      return api.get<SimulationResult>(`/masters/leave-policy-masters/${id}/simulate?${params}`)
    },
    onSuccess: (r) => {
      setSimResult(r)
      setActionError('')
      toast.success('Simulation complete')
    },
    onError: (e: Error) => {
      setActionError(e.message)
      toast.error('Simulation failed', { description: e.message })
    },
  })

  // ── Guard ────────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Leave Policy Engine" subtitle="Enterprise policy lifecycle management" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can manage leave policies.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Leave Policy Engine"
        subtitle="Manage, version, and publish leave policy masters"
      />

      {/* Conflict warnings */}
      {conflicts.length > 0 && (
        <div className="space-y-2">
          {conflicts.map((c, i) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border text-sm',
                c.severity === 'error'
                  ? 'bg-destructive/10 border-destructive/30 text-destructive'
                  : 'bg-warning/10 border-warning/30 text-warning',
              )}
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold capitalize">{c.type.replace('_', ' ')}</p>
                <p className="text-xs mt-0.5 opacity-90">{c.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {actionError}
          <button
            type="button"
            className="ml-auto text-xs underline"
            onClick={() => setActionError('')}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Policy scope coverage matrix */}
      <SectionCard
        title="Scope Coverage Matrix"
        icon={<LayoutGrid className="h-4 w-4 text-muted-foreground" />}
      >
        <ContextualHint
          id="scope-matrix-explainer"
          title="How the scope matrix works"
          variant="info"
          dismissible
          className="mb-3"
        >
          Each column represents a policy master. Each row represents a scope level (tenant-wide,
          department, location, employee group). Numbers show how many entities are assigned at
          that scope. The resolution engine picks the most-specific matching scope when an employee
          applies for leave — lower rows take priority over higher rows.
        </ContextualHint>
        <p className="text-xs text-muted-foreground mb-4">
          Visual map of which organizational scope levels each policy covers.
          Numbers show how many entity assignments exist at each scope.
        </p>
        <PolicyScopeMatrix
          policies={(masters as PolicyScopeSummary[]).filter(m => m.status !== 'archived')}
        />
      </SectionCard>

      {/* Main grid: list + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Policy master list ─────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Policy Masters"
            icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
          >
            {mastersLoading ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />Loading policies…
              </div>
            ) : masters.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <BookOpen className="h-8 w-8 opacity-30" />
                <p className="text-sm">No policy masters yet.</p>
                <p className="text-xs opacity-70">Create a policy master from the Leave Policy Masters configuration page.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {masters.map(m => {
                  const sb   = STATUS_BADGE[m.status] ?? STATUS_BADGE.draft
                  const isSel = m.id === selectedId
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'flex items-start gap-3 px-1 py-3 rounded-lg transition-colors cursor-pointer',
                        isSel ? 'bg-primary/6' : 'hover:bg-muted/30',
                      )}
                      onClick={() => { setSelectedId(m.id); setPanelTab('versions'); setActionError('') }}
                    >
                      {/* Left: info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{m.name}</span>
                          <Badge variant={sb.variant} className="rounded-full text-[9px] px-1.5 py-0">{sb.label}</Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">v{m.version}</span>
                          {m.is_default && (
                            <Badge variant="outline" className="rounded-full text-[9px] px-1.5 py-0">Default</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                          <span>{m.rule_count} rule{m.rule_count !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{m.assignment_count} assignment{m.assignment_count !== 1 ? 's' : ''}</span>
                          {m.published_at && (
                            <>
                              <span>·</span>
                              <span className="text-success">Published {fmtDate(m.published_at)}</span>
                            </>
                          )}
                          {m.effective_from && (
                            <>
                              <span>·</span>
                              <span>Effective {fmtDate(m.effective_from)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right: action buttons */}
                      <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        {m.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] px-2 gap-1"
                            disabled={reviewMutation.isPending}
                            onClick={() => reviewMutation.mutate(m.id)}
                          >
                            <Send className="h-3 w-3" />
                            Review
                          </Button>
                        )}
                        {(m.status === 'draft' || m.status === 'review') && (
                          <Button
                            size="sm"
                            className="h-7 text-[10px] px-2 gap-1"
                            onClick={() => { setSelectedId(m.id); setPublishOpen(true); setActionError('') }}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Publish
                          </Button>
                        )}
                        {m.status === 'published' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] px-2 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => { setSelectedId(m.id); setArchiveOpen(true); setActionError('') }}
                          >
                            <Archive className="h-3 w-3" />
                            Archive
                          </Button>
                        )}
                        {m.status === 'published' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10px] px-2 gap-1"
                            onClick={() => { setSelectedId(m.id); setSimOpen(true); setSimResult(null); setActionError('') }}
                          >
                            <PlayCircle className="h-3 w-3" />
                            Simulate
                          </Button>
                        )}
                        <ChevronRight
                          className={cn(
                            'h-4 w-4 text-muted-foreground/40 transition-colors',
                            isSel && 'text-primary',
                          )}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Side panel: versions + changelog ──────────────────────── */}
        <div className="lg:col-span-1">
          {!selected ? (
            <SectionCard>
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <GitBranch className="h-8 w-8 opacity-20" />
                <p className="text-sm text-foreground">Select a policy</p>
                <p className="text-xs">Click a policy to view version history and change log.</p>
              </div>
              <ProcessStepGuide
                title="Policy Lifecycle"
                steps={[
                  { step: 1, label: 'Draft', detail: 'Create and configure rules. Not yet visible to employees.' },
                  { step: 2, label: 'Review', detail: 'Submitted for HR approval. Locked for further edits.' },
                  { step: 3, label: 'Published', detail: 'Live. Resolution engine uses this version.' },
                  { step: 4, label: 'Archived', detail: 'Retired. Preserved for audit; no longer applied.' },
                ]}
                className="mt-4"
              />
            </SectionCard>
          ) : (
            <SectionCard
              title={selected.name}
              icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
            >
              {/* Panel tab switcher */}
              <div className="flex gap-1 p-1 rounded-lg bg-muted/30 mb-3">
                {([
                  { key: 'versions', label: 'Versions', icon: History },
                  { key: 'changelog', label: 'Changes', icon: FileSearch },
                ] as const).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPanelTab(key)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-colors',
                      panelTab === key
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Versions panel */}
              {panelTab === 'versions' && (
                <div>
                  {versionsLoading ? (
                    <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" />Loading…
                    </div>
                  ) : versions.length === 0 ? (
                    <div className="py-4 text-xs text-muted-foreground text-center">
                      No snapshots yet. Snapshots are created on Publish and Archive.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {versions.map(v => (
                        <div key={v.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold font-mono text-foreground">v{v.version}</span>
                              {v.reason && (
                                <Badge variant="outline" className="rounded-full text-[9px] px-1.5 py-0 capitalize">
                                  {v.reason}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(v.snapshot_at)}</p>
                          </div>
                          {v.version < (selected?.version ?? 1) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] px-1.5 gap-0.5 text-warning"
                              onClick={() => {
                                setRollbackVer(v.version)
                                setRollbackOpen(true)
                                setActionError('')
                              }}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Change log panel */}
              {panelTab === 'changelog' && (
                <div>
                  {changeLogLoading ? (
                    <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" />Loading…
                    </div>
                  ) : changeLogs.length === 0 ? (
                    <div className="py-4 text-xs text-muted-foreground text-center">
                      No change history recorded yet.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {changeLogs.map(cl => (
                        <div key={cl.id} className="p-2 rounded-lg bg-muted/30 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="rounded-full text-[9px] px-1.5 py-0 capitalize">
                              {OP_LABEL[cl.operation] ?? cl.operation}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">{fmtDateTime(cl.changed_at)}</span>
                          </div>
                          {cl.comment && (
                            <p className="text-[10px] text-muted-foreground italic">"{cl.comment}"</p>
                          )}
                          {cl.field_changes.length > 0 && (
                            <div className="space-y-0.5">
                              {cl.field_changes.map((fc, fi) => (
                                <p key={fi} className="text-[10px] font-mono">
                                  <span className="text-muted-foreground">{fc.field}:</span>{' '}
                                  <span className="text-destructive line-through">{String(fc.old_value ?? '—')}</span>
                                  {' → '}
                                  <span className="text-success">{String(fc.new_value ?? '—')}</span>
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          )}
        </div>
      </div>

      {/* ── Publish dialog ─────────────────────────────────────────────── */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Policy</DialogTitle>
            <DialogDescription>
              Publishing <strong>{selected?.name}</strong> (v{(selected?.version ?? 0) + 1}) will make
              it active for all policy resolutions. This action creates an immutable snapshot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Release Notes (optional)</label>
              <textarea
                value={publishNotes}
                onChange={e => setPublishNotes(e.target.value)}
                rows={3}
                placeholder="Describe what changed in this version…"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
              />
            </div>
            {actionError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />{actionError}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setPublishOpen(false)} disabled={publishMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => selected && publishMutation.mutate({ id: selected.id, notes: publishNotes })}
                disabled={publishMutation.isPending}
              >
                {publishMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Publishing…</>
                  : <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Publish</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Archive dialog ─────────────────────────────────────────────── */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Policy</DialogTitle>
            <DialogDescription>
              Archiving <strong>{selected?.name}</strong> will deactivate it. Existing assignments
              will no longer match this policy. An immutable snapshot will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Reason (optional)</label>
              <Input
                value={archiveReason}
                onChange={e => setArchiveReason(e.target.value)}
                placeholder="e.g. Replaced by updated policy v3"
                className="h-8 text-xs"
              />
            </div>
            {actionError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />{actionError}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setArchiveOpen(false)} disabled={archiveMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => selected && archiveMutation.mutate({ id: selected.id, reason: archiveReason })}
                disabled={archiveMutation.isPending}
              >
                {archiveMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Archiving…</>
                  : <><Archive className="h-3.5 w-3.5 mr-1.5" />Archive</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rollback dialog ────────────────────────────────────────────── */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rollback to v{rollbackVer}</DialogTitle>
            <DialogDescription>
              This will restore <strong>{selected?.name}</strong> from the v{rollbackVer} snapshot
              as a new draft (v{(selected?.version ?? 0) + 1}). The current state will be preserved
              in the change log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
              <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              All existing rules will be replaced with the rules from snapshot v{rollbackVer}.
              You will need to review and publish the restored draft.
            </div>
            {actionError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />{actionError}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRollbackOpen(false)} disabled={rollbackMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="text-warning border-warning/30 hover:bg-warning/10"
                onClick={() => selected && rollbackVer != null && rollbackMutation.mutate({ id: selected.id, version: rollbackVer })}
                disabled={rollbackMutation.isPending}
              >
                {rollbackMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Restoring…</>
                  : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Restore to v{rollbackVer}</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Simulation dialog ─────────────────────────────────────────── */}
      <Dialog open={simOpen} onOpenChange={open => { setSimOpen(open); if (!open) setSimResult(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-primary" />
              Simulate Policy Resolution
            </DialogTitle>
            <DialogDescription>
              Test how <strong>{selected?.name}</strong> resolves for a specific employee.
              Results are logged as simulation (no production data changed).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <ContextualHint
              id="leave-policy-sim"
              title="Safe simulation — no production data changed"
              variant="tip"
              inline
              dismissible
            >
              Simulation evaluates the policy resolution chain for the employee you specify and
              shows which policy would apply, which rules activate, and how leave entitlements are
              computed. Nothing is written to attendance or leave records.
            </ContextualHint>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />Employee
                </label>
                <EmployeeSelector
                  value={simEmpId || undefined}
                  onChange={v => setSimEmpId(typeof v === 'string' ? v : '')}
                  placeholder="Search by name or code…"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />Resolve As Of (optional)
                </label>
                <DateInput
                  value={simDate}
                  onChange={setSimDate}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {actionError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />{actionError}
              </p>
            )}

            <Button
              className="w-full h-8 text-xs gap-1.5"
              disabled={!simEmpId || simulateMutation.isPending}
              onClick={() => selected && simulateMutation.mutate({ id: selected.id, empId: simEmpId, date: simDate })}
            >
              {simulateMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Simulating…</>
                : <><PlayCircle className="h-3.5 w-3.5" />Run Simulation</>
              }
            </Button>

            {/* Simulation results — rendered via PolicyExplainPanel */}
            {simResult && (() => {
              const resolution: PolicyResolutionInfo = {
                policy_id:      simResult.resolution.policy_id,
                policy_name:    simResult.resolution.policy_name,
                policy_version: simResult.resolution.policy_version,
                source:         (simResult.resolution.source as PolicyResolvedVia) ?? 'none',
                is_simulation:  true,
                evaluated_candidates: simResult.resolution.evaluated_candidates?.map(c => ({
                  scope_type:      c.scope_type as PolicyResolvedVia,
                  priority_rank:   c.priority,
                  skipped_reason:  c.matched ? undefined : 'Not matched',
                })),
                rules: simResult.resolution.rules.map(r => ({
                  leave_type_name:  r.leave_type_name,
                  max_days_per_year: r.accrual_days_per_year,
                  eligible:         r.eligible,
                })),
              }

              return (
                <div className="border-t border-border pt-3 space-y-3">
                  {/* Employee header */}
                  <div className="flex items-center gap-2 text-xs">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{simResult.employee.name}</span>
                    <span className="text-muted-foreground font-mono">#{simResult.employee.employee_code}</span>
                  </div>

                  {/* Full policy explainer with hierarchy + candidate chain + rules */}
                  <PolicyExplainPanel resolution={resolution} />
                </div>
              )
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
