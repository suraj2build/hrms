/**
 * ApprovalWorkflows — /admin/approvals/workflows
 *
 * Approval workflow configuration for HR admins.
 * Allows defining multi-level approval chains per workflow type:
 *   • Leave requests
 *   • Attendance corrections
 *   • Regularisation requests
 *
 * Layout:
 *   Left  — tab list selecting workflow type
 *   Right — level cards with add / edit / delete
 *
 * Below — open workflow instances list (all pending items across types)
 *
 * Access: super_admin, hr_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { toast }                                  from 'sonner'
import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GitMerge, ShieldAlert, Plus, Trash2, Pencil,
  Loader2, Check, X, ChevronDown, ChevronUp,
  Users, Clock, CalendarDays,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type WorkflowType   = 'leave' | 'correction' | 'regularisation'
type ApproverType   = 'direct_manager' | 'hr_admin' | 'super_admin' | 'specific_role'
type InstanceStatus = 'pending' | 'approved' | 'rejected' | 'escalated' | 'auto_approved'

interface WorkflowConfig {
  id:                       string
  workflow_type:             WorkflowType
  level:                     number
  approver_type:             ApproverType
  specific_role:             string | null
  label:                     string
  auto_approve_after_hours:  number | null
  is_active:                 boolean
  created_at:                string
}

interface WorkflowInstance {
  id:             string
  workflow_type:  WorkflowType
  status:         InstanceStatus
  current_level:  number
  created_at:     string
  reference_id:   string | null
  requester_name: string | null
  leave_type?:    string | null
  date?:          string | null
}

interface ConfigResponse {
  data: WorkflowConfig[]
}

interface InstanceResponse {
  data: WorkflowInstance[]
  total: number
}

interface EmptyForm {
  level:                    string
  approver_type:             ApproverType
  specific_role:             string
  label:                     string
  auto_approve_after_hours:  string
  is_active:                 boolean
}

// ── Constants ──────────────────────────────────────────────────────────────────

const WORKFLOW_TABS: { id: WorkflowType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'leave',           label: 'Leave',          icon: CalendarDays },
  { id: 'correction',      label: 'Corrections',    icon: Clock        },
  { id: 'regularisation',  label: 'Regularisation', icon: Users        },
]

const APPROVER_TYPE_LABELS: Record<ApproverType, string> = {
  direct_manager: 'Direct Manager',
  hr_admin:       'HR Admin',
  super_admin:    'Super Admin',
  specific_role:  'Specific Role',
}

const APPROVER_TYPE_VARIANT: Record<ApproverType, string> = {
  direct_manager: 'outline',
  hr_admin:       'secondary',
  super_admin:    'destructive',
  specific_role:  'info',
}

const STATUS_VARIANT: Record<InstanceStatus, string> = {
  pending:       'warning',
  approved:      'success',
  rejected:      'destructive',
  escalated:     'info',
  auto_approved: 'secondary',
}

function emptyForm(): EmptyForm {
  return {
    level:                   '',
    approver_type:           'direct_manager',
    specific_role:           '',
    label:                   '',
    auto_approve_after_hours: '',
    is_active:               true,
  }
}

function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LevelForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial:  EmptyForm
  onSave:   (form: EmptyForm) => void
  onCancel: () => void
  saving:   boolean
}) {
  const [form, setForm] = useState<EmptyForm>(initial)

  function set(key: keyof EmptyForm, val: string | boolean) {
    setForm((p) => ({ ...p, [key]: val }))
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
      <div className="grid grid-cols-2 gap-3">
        {/* Level */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Level *</label>
          <Input
            type="number"
            min={1}
            max={10}
            value={form.level}
            onChange={(e) => set('level', e.target.value)}
            placeholder="1"
            className="h-8 text-xs"
          />
        </div>

        {/* Approver type */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Approver Type *</label>
          <select
            value={form.approver_type}
            onChange={(e) => set('approver_type', e.target.value as ApproverType)}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
          >
            {(Object.entries(APPROVER_TYPE_LABELS) as [ApproverType, string][]).map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
          </select>
        </div>

        {/* Label */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Label</label>
          <Input
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="e.g. Line Manager Approval"
            className="h-8 text-xs"
          />
        </div>

        {/* Specific role (conditional) */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Specific Role
            <span className="ml-1 text-[10px] text-muted-foreground/60">(if type = Specific Role)</span>
          </label>
          <Input
            value={form.specific_role}
            onChange={(e) => set('specific_role', e.target.value)}
            placeholder="e.g. finance_lead"
            className="h-8 text-xs"
            disabled={form.approver_type !== 'specific_role'}
          />
        </div>

        {/* Auto-approve after hours */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Auto-approve after (hours)</label>
          <Input
            type="number"
            min={1}
            value={form.auto_approve_after_hours}
            onChange={(e) => set('auto_approve_after_hours', e.target.value)}
            placeholder="e.g. 48"
            className="h-8 text-xs"
          />
        </div>

        {/* Active */}
        <div className="space-y-1 flex flex-col justify-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="text-xs text-muted-foreground">Active</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={saving}
          onClick={() => onSave(form)}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Save Level
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={onCancel}>
          <X className="h-3 w-3" />
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ApprovalWorkflows() {
  const { profile }   = useAuthStore()
  const qc            = useQueryClient()
  const isAdmin       = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [activeTab,    setActiveTab]    = useState<WorkflowType>('leave')
  const [showAddForm,  setShowAddForm]  = useState(false)
  const [editId,       setEditId]       = useState<string | null>(null)
  const [editForm,     setEditForm]     = useState<EmptyForm>(emptyForm())
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const [expandedInst, setExpandedInst] = useState<string | null>(null)

  // ── Config query ──────────────────────────────────────────────────────────────
  const { data: configData, isLoading: configLoading } = useQuery<ConfigResponse>({
    queryKey: ['workflow-config', activeTab],
    queryFn:  () => api.get<ConfigResponse>(`/approvals/workflows/config?workflow_type=${activeTab}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const configs = configData?.data ?? []

  // ── Instances query ───────────────────────────────────────────────────────────
  const { data: instanceData, isLoading: instLoading } = useQuery<InstanceResponse>({
    queryKey: ['workflow-instances'],
    queryFn:  () => api.get<InstanceResponse>('/approvals/workflows/instances?limit=20'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const instances = instanceData?.data ?? []

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (form: EmptyForm) =>
      api.post('/approvals/workflows/config', {
        workflow_type:            activeTab,
        level:                    parseInt(form.level, 10),
        approver_type:            form.approver_type,
        specific_role:            form.specific_role || null,
        label:                    form.label,
        auto_approve_after_hours: form.auto_approve_after_hours ? parseInt(form.auto_approve_after_hours, 10) : null,
        is_active:                form.is_active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-config', activeTab] })
      setShowAddForm(false)
      setEditId(null)
      toast.success('Workflow saved')
    },
    onError: (e: Error) => toast.error('Failed to save workflow', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/approvals/workflows/config/${id}`),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['workflow-config', activeTab] })
      setDeleteId(null)
      toast.success('Workflow deleted')
    },
    onError: (e: Error) => toast.error('Failed to delete workflow', { description: e.message }),
  })

  const actionMutation = useMutation({
    mutationFn: ({ instanceId, action }: { instanceId: string; action: string }) =>
      api.post(`/approvals/workflows/instances/${instanceId}/action`, { action }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['workflow-instances'] })
      setExpandedInst(null)
      toast.success('Action completed')
    },
    onError: (e: Error) => toast.error('Action failed', { description: e.message }),
  })

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function startEdit(cfg: WorkflowConfig) {
    setEditId(cfg.id)
    setEditForm({
      level:                   String(cfg.level),
      approver_type:           cfg.approver_type,
      specific_role:           cfg.specific_role ?? '',
      label:                   cfg.label,
      auto_approve_after_hours: cfg.auto_approve_after_hours ? String(cfg.auto_approve_after_hours) : '',
      is_active:               cfg.is_active,
    })
    setShowAddForm(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Approval Workflows"
        subtitle="Configure multi-level approval chains for leave, corrections, and regularisations"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can configure approval workflows.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <div className="space-y-6">

          {/* ── Config panel ──────────────────────────────────────────────── */}
          <div className="flex gap-4 items-start">

            {/* Tab list */}
            <div className="w-44 flex-shrink-0 space-y-1">
              {WORKFLOW_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setActiveTab(id); setShowAddForm(false); setEditId(null) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                    activeTab === id
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            {/* Config content */}
            <div className="flex-1">
              <SectionCard
                title={`${WORKFLOW_TABS.find((t) => t.id === activeTab)?.label ?? ''} Approval Levels`}
                icon={<GitMerge className="h-4 w-4 text-muted-foreground" />}
                action={
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => { setShowAddForm(true); setEditId(null) }}
                    disabled={showAddForm}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Level
                  </Button>
                }
              >
                {/* Add form */}
                {showAddForm && (
                  <div className="mb-4">
                    <LevelForm
                      initial={emptyForm()}
                      onSave={(form) => saveMutation.mutate(form)}
                      onCancel={() => setShowAddForm(false)}
                      saving={saveMutation.isPending}
                    />
                  </div>
                )}

                {configLoading ? (
                  <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Loading levels…
                  </div>
                ) : configs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                    <GitMerge className="h-8 w-8 opacity-30" />
                    <p className="text-sm font-medium text-foreground">No levels configured</p>
                    <p className="text-xs">Add the first approval level above.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {configs.map((cfg) => (
                      <div key={cfg.id}>
                        {editId === cfg.id ? (
                          <LevelForm
                            initial={editForm}
                            onSave={(form) => saveMutation.mutate(form)}
                            onCancel={() => setEditId(null)}
                            saving={saveMutation.isPending}
                          />
                        ) : (
                          <div className={cn(
                            'flex items-center gap-3 px-4 py-3 rounded-lg border text-sm',
                            cfg.is_active ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60',
                          )}>
                            {/* Level badge */}
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                              {cfg.level}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-foreground truncate">
                                  {cfg.label || APPROVER_TYPE_LABELS[cfg.approver_type]}
                                </span>
                                <Badge
                                  variant={APPROVER_TYPE_VARIANT[cfg.approver_type] as any}
                                  className="rounded-full text-[10px]"
                                >
                                  {APPROVER_TYPE_LABELS[cfg.approver_type]}
                                </Badge>
                                {!cfg.is_active && (
                                  <Badge variant="outline" className="rounded-full text-[10px]">Inactive</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                {cfg.specific_role && <span>Role: {cfg.specific_role}</span>}
                                {cfg.auto_approve_after_hours && (
                                  <span>Auto-approve after {cfg.auto_approve_after_hours}h</span>
                                )}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => startEdit(cfg)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>

                              {deleteId === cfg.id ? (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 text-[10px] px-2"
                                    disabled={deleteMutation.isPending}
                                    onClick={() => deleteMutation.mutate(cfg.id)}
                                  >
                                    {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[10px] px-2"
                                    onClick={() => setDeleteId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => setDeleteId(cfg.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          {/* ── Open Instances ────────────────────────────────────────────── */}
          <SectionCard
            title="Open Workflow Instances"
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          >
            {instLoading ? (
              <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Loading instances…
              </div>
            ) : instances.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                <Clock className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium text-foreground">No open instances</p>
                <p className="text-xs">All workflow items have been processed.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {instances.map((inst) => (
                  <div key={inst.id} className="border border-border rounded-lg overflow-hidden">
                    {/* Row header */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedInst(expandedInst === inst.id ? null : inst.id)}
                    >
                      <Badge
                        variant={STATUS_VARIANT[inst.status] as any}
                        className="rounded-full text-[10px] flex-shrink-0"
                      >
                        {inst.status.replace('_', ' ')}
                      </Badge>

                      <span className="font-medium capitalize text-foreground">
                        {inst.workflow_type.replace('_', ' ')}
                      </span>

                      {inst.requester_name && (
                        <span className="text-muted-foreground">— {inst.requester_name}</span>
                      )}

                      {inst.date && (
                        <span className="text-xs text-muted-foreground ml-auto mr-2">
                          {fmtDate(inst.date)}
                        </span>
                      )}

                      <span className="text-xs text-muted-foreground">
                        Level {inst.current_level}
                      </span>

                      {expandedInst === inst.id ? (
                        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-1 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1 flex-shrink-0" />
                      )}
                    </button>

                    {/* Expanded actions */}
                    {expandedInst === inst.id && inst.status === 'pending' && (
                      <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground mr-2">Action:</span>
                        {['approve', 'reject', 'escalate'].map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === 'approve' ? 'default' : action === 'reject' ? 'destructive' : 'outline'}
                            className="h-7 text-xs capitalize"
                            disabled={actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ instanceId: inst.id, action })}
                          >
                            {actionMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              action
                            )}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </PageContainer>
  )
}
