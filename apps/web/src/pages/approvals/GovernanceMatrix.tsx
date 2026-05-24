/**
 * GovernanceMatrix — /approvals/governance
 *
 * Admin-only workspace for managing approval matrices, authority delegations,
 * operational overrides, and simulating the approval chain for any entity.
 *
 * Access: hr_admin, super_admin only.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, GitMerge, Users, Zap, FlaskConical,
  Loader2, Trash2, Plus, CheckCircle2,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'
import { toast }          from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type ApproverType  = 'role' | 'employee' | 'manager'
type OverrideType  =
  | 'bypass_approval' | 'extend_sla' | 'unlock_period'
  | 'force_process'   | 'grant_balance' | 'roster_freeze_lift' | 'policy_exception'

type EntityType =
  | 'leave_request' | 'correction' | 'overtime' | 'comp_off'
  | 'payroll_run'   | 'roster_change' | 'shift_swap' | 'expense'

interface MatrixStage {
  stage_number:  number
  approver_type: ApproverType
  approver_value: string
  sla_hours:     number
}

interface ApprovalMatrix {
  id:                string
  name:              string
  entity_type:       string
  description:       string | null
  payroll_threshold: number | null
  is_active:         boolean
  stages_count:      number
  created_at:        string
}

interface Delegation {
  id:           string
  delegator_id: string
  delegator_name: string
  delegate_id:  string
  delegate_name: string
  entity_types: EntityType[]
  valid_from:   string
  valid_until:  string
  reason:       string | null
  is_active:    boolean
}

interface Override {
  id:             string
  override_type:  OverrideType
  granted_to_id:  string
  granted_to_name: string
  granted_by_name: string
  valid_until:    string
  max_uses:       number | null
  uses_remaining: number | null
  is_active:      boolean
}

interface SimulateStage {
  stage_number:   number
  approver_type:  ApproverType
  approver_value: string
  sla_hours:      number
}

interface SimulateResult {
  matrix_name:     string
  stages:          SimulateStage[]
  total_sla_hours: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ENTITY_TYPES: EntityType[] = [
  'leave_request', 'correction', 'overtime', 'comp_off',
  'payroll_run',   'roster_change', 'shift_swap', 'expense',
]

const OVERRIDE_TYPES: OverrideType[] = [
  'bypass_approval', 'extend_sla', 'unlock_period',
  'force_process',   'grant_balance', 'roster_freeze_lift', 'policy_exception',
]

const APPROVER_TYPES: ApproverType[] = ['role', 'employee', 'manager']

// ── Helpers ────────────────────────────────────────────────────────────────────

function humanLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n)
}

// ── Tab navigation ─────────────────────────────────────────────────────────────

type Tab = 'matrices' | 'delegations' | 'overrides' | 'simulate'

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'matrices',    label: 'Approval Matrices', icon: GitMerge    },
  { id: 'delegations', label: 'Delegations',       icon: Users       },
  { id: 'overrides',   label: 'Overrides',         icon: Zap         },
  { id: 'simulate',    label: 'Simulate',           icon: FlaskConical },
]

// ── New Matrix Dialog ──────────────────────────────────────────────────────────

function NewMatrixDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()

  const [name,        setName]        = useState('')
  const [entityType,  setEntityType]  = useState<EntityType | ''>('')
  const [description, setDescription] = useState('')
  const [threshold,   setThreshold]   = useState('')
  const [stages,      setStages]      = useState<MatrixStage[]>([])

  function addStage() {
    setStages(s => [
      ...s,
      { stage_number: s.length + 1, approver_type: 'role', approver_value: '', sla_hours: 24 },
    ])
  }

  function removeStage(idx: number) {
    setStages(s => s.filter((_, i) => i !== idx).map((st, i) => ({ ...st, stage_number: i + 1 })))
  }

  function updateStage<K extends keyof MatrixStage>(idx: number, key: K, value: MatrixStage[K]) {
    setStages(s => s.map((st, i) => i === idx ? { ...st, [key]: value } : st))
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/approvals/governance/matrices', {
        name,
        entity_type:       entityType,
        description:       description || undefined,
        payroll_threshold: threshold ? Number(threshold) : undefined,
        stages,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-matrices'] })
      onClose()
      setName(''); setEntityType(''); setDescription(''); setThreshold(''); setStages([])
      toast.success('Approval matrix created')
    },
    onError: (e: Error) => toast.error('Failed to create matrix', { description: e.message }),
  })

  const valid = !!name && !!entityType && stages.length > 0 &&
    stages.every(s => s.approver_value.trim())

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Approval Matrix</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Standard Leave Approval"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {/* Entity type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Entity Type *</label>
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value as EntityType)}
              className="flex w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">Select entity type…</option>
              {ENTITY_TYPES.map(t => (
                <option key={t} value={t}>{humanLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description (opt)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>

          {/* Payroll threshold */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Payroll Threshold (opt)</label>
            <input
              type="number"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              placeholder="Amount"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {/* Stages builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Stages *</label>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addStage}>
                <Plus className="h-3 w-3" />
                Add Stage
              </Button>
            </div>

            {stages.length === 0 && (
              <p className="text-xs text-muted-foreground/60 text-center py-4 rounded-md border border-dashed border-border">
                No stages added yet. Click "Add Stage" to begin.
              </p>
            )}

            {stages.map((stage, idx) => (
              <div
                key={idx}
                className="rounded-md border border-border bg-muted/20 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">Stage {stage.stage_number}</p>
                  <button
                    type="button"
                    onClick={() => removeStage(idx)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Approver Type</label>
                    <select
                      value={stage.approver_type}
                      onChange={e => updateStage(idx, 'approver_type', e.target.value as ApproverType)}
                      className="flex w-full h-7 rounded border border-input bg-background px-2 text-[10px] text-foreground outline-none"
                    >
                      {APPROVER_TYPES.map(t => (
                        <option key={t} value={t}>{humanLabel(t)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Approver Value</label>
                    <input
                      value={stage.approver_value}
                      onChange={e => updateStage(idx, 'approver_value', e.target.value)}
                      placeholder={stage.approver_type === 'role' ? 'hr_admin' : 'UUID'}
                      className="flex w-full h-7 rounded border border-input bg-background px-2 text-[10px] text-foreground outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">SLA (hrs)</label>
                    <input
                      type="number"
                      value={stage.sla_hours}
                      onChange={e => updateStage(idx, 'sla_hours', Number(e.target.value))}
                      className="flex w-full h-7 rounded border border-input bg-background px-2 text-[10px] text-foreground outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">Failed to create matrix. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!valid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Creating…</>
                : 'Create Matrix'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Matrices Tab ───────────────────────────────────────────────────────────────

function MatricesTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<{ data: ApprovalMatrix[] }>({
    queryKey: ['governance-matrices'],
    queryFn:  () => api.get('/approvals/governance/matrices'),
    staleTime: 60_000,
  })

  const deleteMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) => api.delete(`/approvals/governance/matrices/${id}`),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['governance-matrices'] })
      toast.success('Matrix deleted')
    },
    onError: (e: Error) => toast.error('Failed to delete matrix', { description: e.message }),
  })

  const rows = data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} matrices configured</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Matrix
        </Button>
      </div>

      <SectionCard noPadding>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading matrices…</span>
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-sm text-destructive">Failed to load matrices.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center py-12 gap-2 text-center">
            <GitMerge className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No matrices configured yet.</p>
          </div>
        )}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Name', 'Entity Type', 'Stages', 'Active', 'Payroll Threshold', ''].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold text-muted-foreground py-2.5 px-4 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4">
                      <p className="text-xs font-medium text-foreground">{row.name}</p>
                      {row.description && (
                        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                          {row.description}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">{humanLabel(row.entity_type)}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">{row.stages_count}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {row.is_active
                        ? <Badge variant="success" className="rounded-full text-[10px] px-2">Active</Badge>
                        : <Badge variant="secondary" className="rounded-full text-[10px] px-2">Inactive</Badge>
                      }
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">
                        {row.payroll_threshold != null ? fmtCurrency(row.payroll_threshold) : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(row.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Deactivate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <NewMatrixDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}

// ── New Delegation Dialog ──────────────────────────────────────────────────────

function NewDelegationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()

  const [delegateId,   setDelegateId]   = useState('')
  const [entityTypes,  setEntityTypes]  = useState<EntityType[]>([])
  const [validFrom,    setValidFrom]    = useState('')
  const [validUntil,   setValidUntil]   = useState('')
  const [reason,       setReason]       = useState('')

  function toggleEntity(et: EntityType) {
    setEntityTypes(prev =>
      prev.includes(et) ? prev.filter(x => x !== et) : [...prev, et],
    )
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/approvals/governance/delegations', {
        delegate_id:  delegateId,
        entity_types: entityTypes,
        valid_from:   validFrom,
        valid_until:  validUntil,
        reason:       reason || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-delegations'] })
      onClose()
      setDelegateId(''); setEntityTypes([]); setValidFrom(''); setValidUntil(''); setReason('')
      toast.success('Delegation created')
    },
    onError: (e: Error) => toast.error('Failed to create delegation', { description: e.message }),
  })

  const valid = !!delegateId && entityTypes.length > 0 && !!validFrom && !!validUntil

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Delegation</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Delegate ID */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Delegate (Employee UUID) *</label>
            <input
              value={delegateId}
              onChange={e => setDelegateId(e.target.value)}
              placeholder="UUID"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {/* Entity types */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Entity Types *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {ENTITY_TYPES.map(et => (
                <label
                  key={et}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors text-xs',
                    entityTypes.includes(et)
                      ? 'border-primary/60 bg-primary/5 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/20',
                  )}
                >
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={entityTypes.includes(et)}
                    onChange={() => toggleEntity(et)}
                  />
                  {humanLabel(et)}
                </label>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Valid From *</label>
              <input
                type="datetime-local"
                value={validFrom}
                onChange={e => setValidFrom(e.target.value)}
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Valid Until *</label>
              <input
                type="datetime-local"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason (opt)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this delegation being created?"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">Failed to create delegation. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!valid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Creating…</>
                : 'Create Delegation'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Delegations Tab ────────────────────────────────────────────────────────────

function DelegationsTab() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<{ data: Delegation[] }>({
    queryKey: ['governance-delegations'],
    queryFn:  () => api.get('/approvals/governance/delegations?is_active=true'),
    staleTime: 60_000,
  })

  const revokeMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) => api.delete(`/approvals/governance/delegations/${id}`),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['governance-delegations'] })
      toast.success('Delegation revoked')
    },
    onError: (e: Error) => toast.error('Failed to revoke delegation', { description: e.message }),
  })

  const rows = data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} active delegations</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Delegation
        </Button>
      </div>

      <SectionCard noPadding>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading delegations…</span>
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-sm text-destructive">Failed to load delegations.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center py-12 gap-2 text-center">
            <Users className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No active delegations.</p>
          </div>
        )}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Delegator', 'Delegate', 'Entity Types', 'Valid From', 'Valid Until', ''].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold text-muted-foreground py-2.5 px-4 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">{row.delegator_name}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">{row.delegate_name}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {row.entity_types.map(et => (
                          <Badge key={et} variant="outline" className="rounded-full text-[10px] px-2">
                            {humanLabel(et)}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground tabular-nums">{fmtDate(row.valid_from)}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground tabular-nums">{fmtDate(row.valid_until)}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(row.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <NewDelegationDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}

// ── Grant Override Dialog ──────────────────────────────────────────────────────

function GrantOverrideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()

  const [overrideType,  setOverrideType]  = useState<OverrideType | ''>('')
  const [grantedTo,     setGrantedTo]     = useState('')
  const [reason,        setReason]        = useState('')
  const [justification, setJustification] = useState('')
  const [validUntil,    setValidUntil]    = useState('')
  const [maxUses,       setMaxUses]       = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/approvals/governance/overrides', {
        override_type: overrideType,
        granted_to:    grantedTo,
        reason,
        justification,
        valid_until:   validUntil,
        max_uses:      maxUses ? Number(maxUses) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-overrides'] })
      onClose()
      setOverrideType(''); setGrantedTo(''); setReason('')
      setJustification(''); setValidUntil(''); setMaxUses('')
      toast.success('Override granted')
    },
    onError: (e: Error) => toast.error('Failed to grant override', { description: e.message }),
  })

  const valid = !!overrideType && !!grantedTo && !!reason && !!justification && !!validUntil

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Grant Override</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Override type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Override Type *</label>
            <select
              value={overrideType}
              onChange={e => setOverrideType(e.target.value as OverrideType)}
              className="flex w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">Select type…</option>
              {OVERRIDE_TYPES.map(t => (
                <option key={t} value={t}>{humanLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* Granted to */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Granted To (Employee UUID) *</label>
            <input
              value={grantedTo}
              onChange={e => setGrantedTo(e.target.value)}
              placeholder="UUID"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason *</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="Business reason for this override…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>

          {/* Justification */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Justification *</label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={2}
              placeholder="Detailed justification and authority basis…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
            />
          </div>

          {/* Valid until + max uses */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Valid Until *</label>
              <input
                type="datetime-local"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Max Uses (opt)</label>
              <input
                type="number"
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                placeholder="Unlimited"
                className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              />
            </div>
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">Failed to grant override. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!valid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Granting…</>
                : 'Grant Override'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Overrides Tab ──────────────────────────────────────────────────────────────

function OverridesTab() {
  const qc = useQueryClient()
  const [showGrant, setShowGrant] = useState(false)
  const [revokeId,  setRevokeId]  = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')

  const { data, isLoading, isError, refetch } = useQuery<{ data: Override[] }>({
    queryKey: ['governance-overrides'],
    queryFn:  () => api.get('/approvals/governance/overrides?is_active=true'),
    staleTime: 60_000,
  })

  const revokeMutation = useMutation<unknown, Error, { id: string; revoke_reason: string }>({
    mutationFn: ({ id, revoke_reason }) =>
      api.delete(`/approvals/governance/overrides/${id}`, { data: { revoke_reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governance-overrides'] })
      setRevokeId(null)
      setRevokeReason('')
      toast.success('Override revoked')
    },
    onError: (e: Error) => toast.error('Failed to revoke override', { description: e.message }),
  })

  const rows = data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} active overrides</p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowGrant(true)}>
          <Plus className="h-3.5 w-3.5" />
          Grant Override
        </Button>
      </div>

      <SectionCard noPadding>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading overrides…</span>
          </div>
        )}
        {isError && (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-sm text-destructive">Failed to load overrides.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center py-12 gap-2 text-center">
            <Zap className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No active overrides.</p>
          </div>
        )}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Type', 'Granted To', 'Granted By', 'Valid Until', 'Uses', ''].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold text-muted-foreground py-2.5 px-4 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <Badge variant="outline" className="rounded-full text-[10px] px-2">
                        {humanLabel(row.override_type)}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">{row.granted_to_name}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-muted-foreground">{row.granted_by_name}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground tabular-nums">{fmtDate(row.valid_until)}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="text-xs text-foreground">
                        {row.max_uses != null
                          ? `${row.uses_remaining ?? '?'} / ${row.max_uses}`
                          : 'Unlimited'
                        }
                      </span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                        onClick={() => setRevokeId(row.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Revoke confirmation dialog */}
      <Dialog open={!!revokeId} onOpenChange={v => { if (!v) { setRevokeId(null); setRevokeReason('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke Override</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Revocation Reason</label>
              <textarea
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                rows={3}
                placeholder="Why is this override being revoked?"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
              />
            </div>
            {revokeMutation.isError && (
              <p className="text-xs text-destructive">Revocation failed. Please try again.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setRevokeId(null); setRevokeReason('') }}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!revokeReason.trim() || revokeMutation.isPending}
                onClick={() => revokeId && revokeMutation.mutate({ id: revokeId, revoke_reason: revokeReason })}
              >
                {revokeMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Revoking…</>
                  : 'Revoke'
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <GrantOverrideDialog open={showGrant} onClose={() => setShowGrant(false)} />
    </div>
  )
}

// ── Simulate Tab ───────────────────────────────────────────────────────────────

function SimulateTab() {
  const [entityType,    setEntityType]    = useState<EntityType | ''>('')
  const [payrollAmount, setPayrollAmount] = useState('')
  const [departmentId,  setDepartmentId]  = useState('')

  const [result, setResult] = useState<SimulateResult | null>(null)
  const [empty,  setEmpty]  = useState(false)

  const mutation = useMutation<{ data: SimulateResult | null }, Error, void>({
    mutationFn: () =>
      api.post('/approvals/governance/simulate', {
        entity_type:    entityType || undefined,
        payroll_amount: payrollAmount ? Number(payrollAmount) : undefined,
        department_id:  departmentId || undefined,
      }),
    onSuccess: (res) => {
      if (res.data) {
        setResult(res.data)
        setEmpty(false)
        toast.success('Approval chain simulated')
      } else {
        setResult(null)
        setEmpty(true)
      }
    },
    onError: (e: Error) => toast.error('Simulation failed', { description: e.message }),
  })

  const valid = !!entityType

  return (
    <div className="space-y-4 max-w-lg">
      <SectionCard title="Simulate Approval Chain" icon={<FlaskConical className="h-4 w-4 text-muted-foreground" />}>
        <div className="space-y-3">
          {/* Entity type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Entity Type *</label>
            <select
              value={entityType}
              onChange={e => { setEntityType(e.target.value as EntityType); setResult(null); setEmpty(false) }}
              className="flex w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">Select entity type…</option>
              {ENTITY_TYPES.map(t => (
                <option key={t} value={t}>{humanLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* Payroll amount */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Payroll Amount (opt)</label>
            <input
              type="number"
              value={payrollAmount}
              onChange={e => setPayrollAmount(e.target.value)}
              placeholder="e.g. 500000"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {/* Department ID */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Department ID (opt)</label>
            <input
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
              placeholder="UUID"
              className="flex w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            />
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">Simulation failed. Please try again.</p>
          )}

          <Button
            size="sm"
            className="gap-1.5"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Simulating…</>
              : <><FlaskConical className="h-3.5 w-3.5" />Simulate</>
            }
          </Button>
        </div>
      </SectionCard>

      {/* Result */}
      {empty && (
        <SectionCard>
          <div className="flex flex-col items-center py-8 gap-2 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">No matrix found</p>
            <p className="text-xs text-muted-foreground/60">
              No approval matrix matches the given criteria.
            </p>
          </div>
        </SectionCard>
      )}

      {result && (
        <SectionCard
          title={result.matrix_name}
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
        >
          <div className="space-y-0">
            {result.stages.map((stage, idx) => (
              <div key={stage.stage_number} className="flex gap-3">
                {/* vertical timeline */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 border border-primary/30 shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">{stage.stage_number}</span>
                  </div>
                  {idx < result.stages.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1 mb-0" style={{ minHeight: '24px' }} />
                  )}
                </div>

                <div className="pb-5 min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    {humanLabel(stage.approver_type)}
                    <span className="font-mono font-normal text-muted-foreground ml-1.5">
                      {stage.approver_value}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    SLA: {stage.sla_hours}h
                  </p>
                </div>
              </div>
            ))}

            <div className="border-t border-border pt-3 mt-1">
              <p className="text-xs text-muted-foreground">
                Total SLA:{' '}
                <span className="font-semibold text-foreground">{result.total_sla_hours}h</span>
              </p>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function GovernanceMatrix() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [activeTab, setActiveTab] = useState<Tab>('matrices')

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Governance Matrix"
          subtitle="Approval matrices, delegations, and operational overrides"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-16 gap-2 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Access restricted</p>
            <p className="text-xs text-muted-foreground/60">
              This workspace is available to HR administrators only.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Governance Matrix"
        subtitle="Approval matrices, delegations, and operational overrides"
      />

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 border-b border-border pb-0 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ── */}
      <div className="pt-1">
        {activeTab === 'matrices'    && <MatricesTab    />}
        {activeTab === 'delegations' && <DelegationsTab />}
        {activeTab === 'overrides'   && <OverridesTab   />}
        {activeTab === 'simulate'    && <SimulateTab    />}
      </div>
    </PageContainer>
  )
}
