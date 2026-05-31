/**
 * IntegrationRegistry — /system/integrations
 *
 * Admin-only catalog of external system integrations with health monitoring,
 * per-integration audit log, and on-demand health checks.
 *
 * Access: hr_admin, super_admin only.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plug, Loader2, Plus, ShieldAlert, Activity,
  ArrowDownLeft, ArrowUpRight, XCircle, CheckCircle2, Pencil,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type IntegrationStatus = 'active' | 'inactive' | 'error' | 'maintenance'
type HealthStatus      = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
type IntegrationType   =
  | 'payroll_export' | 'biometric' | 'erp' | 'hris_external'
  | 'notification_gateway' | 'document_storage' | 'identity_provider'
  | 'time_tracking' | 'custom_api' | 'other'
type AuthType          = 'api_key' | 'oauth2' | 'basic' | 'hmac' | 'none'
type AuditDirection    = 'inbound' | 'outbound'
type AuditStatus       = 'success' | 'failure' | 'timeout'

interface Integration {
  id:              string
  name:            string
  integration_type: IntegrationType
  status:          IntegrationStatus
  health_status:   HealthStatus
  description:     string | null
  endpoint_url:    string
  auth_type:       AuthType
  total_calls:     number
  error_rate_pct:  number
  avg_latency_ms:  number
  created_at:      string
}

interface AuditEntry {
  id:          string
  operation:   string
  direction:   AuditDirection
  status:      AuditStatus
  duration_ms: number | null
  created_at:  string
}

interface HealthCheckResult {
  health_status: HealthStatus
  latency_ms:    number | null
  message?:      string
}

interface CreateIntegrationBody {
  name:             string
  integration_type: IntegrationType
  endpoint_url:     string
  auth_type:        AuthType
  description?:     string
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const STATUS_VARIANT: Record<IntegrationStatus, BadgeVariant> = {
  active:      'success',
  inactive:    'secondary',
  error:       'destructive',
  maintenance: 'warning',
}

const HEALTH_VARIANT: Record<HealthStatus, BadgeVariant> = {
  healthy:   'success',
  degraded:  'warning',
  unhealthy: 'destructive',
  unknown:   'secondary',
}

const DIRECTION_VARIANT: Record<AuditDirection, BadgeVariant> = {
  inbound:  'outline',
  outbound: 'secondary',
}

const AUDIT_STATUS_VARIANT: Record<AuditStatus, BadgeVariant> = {
  success: 'success',
  failure: 'destructive',
  timeout: 'warning',
}

// ── Constants ──────────────────────────────────────────────────────────────────

const INTEGRATION_TYPES: IntegrationType[] = [
  'payroll_export', 'biometric', 'erp', 'hris_external',
  'notification_gateway', 'document_storage', 'identity_provider',
  'time_tracking', 'custom_api', 'other',
]

const AUTH_TYPES: AuthType[] = ['api_key', 'oauth2', 'basic', 'hmac', 'none']

function typeLabel(t: IntegrationType): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function authLabel(a: AuthType): string {
  const map: Record<AuthType, string> = {
    api_key: 'API Key',
    oauth2:  'OAuth 2.0',
    basic:   'Basic Auth',
    hmac:    'HMAC',
    none:    'None',
  }
  return map[a]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

// ── Create dialog ──────────────────────────────────────────────────────────────

interface CreateDialogProps {
  onClose:   () => void
  onCreate:  (body: CreateIntegrationBody) => void
  isPending: boolean
}

function CreateIntegrationDialog({ onClose, onCreate, isPending }: CreateDialogProps) {
  const [form, setForm] = useState<{
    name:             string
    integration_type: IntegrationType
    endpoint_url:     string
    auth_type:        AuthType
    description:      string
  }>({
    name:             '',
    integration_type: 'custom_api',
    endpoint_url:     '',
    auth_type:        'api_key',
    description:      '',
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onCreate({
      name:             form.name,
      integration_type: form.integration_type,
      endpoint_url:     form.endpoint_url,
      auth_type:        form.auth_type,
      description:      form.description || undefined,
    })
  }

  const inputCls =
    'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 ring-primary/50 placeholder:text-muted-foreground/50'
  const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <p className="font-semibold text-foreground">Register Integration</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add an external system to the registry
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <XCircle className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="SAP HR Export"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Integration Type *</label>
                <select
                  required
                  value={form.integration_type}
                  onChange={e =>
                    setForm(f => ({ ...f, integration_type: e.target.value as IntegrationType }))
                  }
                  className={inputCls}
                >
                  {INTEGRATION_TYPES.map(t => (
                    <option key={t} value={t}>{typeLabel(t)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Auth Type *</label>
                <select
                  required
                  value={form.auth_type}
                  onChange={e =>
                    setForm(f => ({ ...f, auth_type: e.target.value as AuthType }))
                  }
                  className={inputCls}
                >
                  {AUTH_TYPES.map(a => (
                    <option key={a} value={a}>{authLabel(a)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Endpoint URL *</label>
              <input
                required
                type="url"
                value={form.endpoint_url}
                onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
                placeholder="https://api.example.com/v1"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                className={cn(inputCls, 'resize-none')}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Register
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

// ── Edit dialog ────────────────────────────────────────────────────────────────

interface EditDialogProps {
  integration: Integration
  onClose:     () => void
  onEdit:      (body: Partial<CreateIntegrationBody & { status: IntegrationStatus }>) => void
  isPending:   boolean
}

function EditIntegrationDialog({ integration, onClose, onEdit, isPending }: EditDialogProps) {
  const [form, setForm] = useState<{
    name:             string
    integration_type: IntegrationType
    endpoint_url:     string
    auth_type:        AuthType
    description:      string
    status:           IntegrationStatus
  }>({
    name:             integration.name,
    integration_type: integration.integration_type,
    endpoint_url:     integration.endpoint_url,
    auth_type:        integration.auth_type,
    description:      integration.description ?? '',
    status:           integration.status,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onEdit({
      name:             form.name,
      integration_type: form.integration_type,
      endpoint_url:     form.endpoint_url,
      auth_type:        form.auth_type,
      description:      form.description || undefined,
      status:           form.status,
    })
  }

  const inputCls =
    'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 ring-primary/50 placeholder:text-muted-foreground/50'
  const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <p className="font-semibold text-foreground">Edit Integration</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Update configuration for {integration.name}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <XCircle className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="SAP HR Export"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Integration Type *</label>
                <select
                  required
                  value={form.integration_type}
                  onChange={e =>
                    setForm(f => ({ ...f, integration_type: e.target.value as IntegrationType }))
                  }
                  className={inputCls}
                >
                  {INTEGRATION_TYPES.map(t => (
                    <option key={t} value={t}>{typeLabel(t)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Auth Type *</label>
                <select
                  required
                  value={form.auth_type}
                  onChange={e =>
                    setForm(f => ({ ...f, auth_type: e.target.value as AuthType }))
                  }
                  className={inputCls}
                >
                  {AUTH_TYPES.map(a => (
                    <option key={a} value={a}>{authLabel(a)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Endpoint URL *</label>
              <input
                required
                type="url"
                value={form.endpoint_url}
                onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
                placeholder="https://api.example.com/v1"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as IntegrationStatus }))}
                className={inputCls}
              >
                {(['active', 'inactive', 'maintenance', 'error'] as IntegrationStatus[]).map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                className={cn(inputCls, 'resize-none')}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

// ── Integration card (list) ────────────────────────────────────────────────────

interface IntegrationCardProps {
  integration: Integration
  isSelected:  boolean
  onSelect:    () => void
}

function IntegrationCard({ integration, isSelected, onSelect }: IntegrationCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3.5 cursor-pointer transition-all hover:shadow-sm',
        isSelected
          ? 'border-primary/60 ring-1 ring-primary/30'
          : 'border-border hover:border-border/80',
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-foreground leading-snug">{integration.name}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant={HEALTH_VARIANT[integration.health_status]} className="rounded-full text-[10px] px-2">
            {integration.health_status}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Badge variant="outline" className="rounded-full text-[10px] px-2">
          {typeLabel(integration.integration_type)}
        </Badge>
        <Badge variant={STATUS_VARIANT[integration.status]} className="rounded-full text-[10px] px-2">
          {integration.status}
        </Badge>
      </div>

      {integration.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-1 mb-1">
          {integration.description}
        </p>
      )}

      <p className="text-[10px] font-mono text-muted-foreground/70 truncate">
        {integration.endpoint_url}
      </p>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function IntegrationRegistry() {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [selectedId,      setSelectedId]      = useState<string | null>(null)
  const [showCreate,      setShowCreate]      = useState(false)
  const [showEdit,        setShowEdit]        = useState(false)
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterType,      setFilterType]      = useState('')
  const [healthResult,    setHealthResult]    = useState<HealthCheckResult | null>(null)
  const [checkingHealth,  setCheckingHealth]  = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: integrationsData, isLoading: integrationsLoading } =
    useQuery<{ data: Integration[] }>({
      queryKey: ['integrations', filterStatus, filterType],
      queryFn:  () => {
        const params = new URLSearchParams()
        if (filterStatus) params.set('status', filterStatus)
        if (filterType)   params.set('integration_type', filterType)
        const qs = params.toString()
        return api.get(`/system/integrations${qs ? `?${qs}` : ''}`)
      },
      staleTime: 30_000,
      enabled:   isAdmin,
    })

  const { data: auditData, isLoading: auditLoading } =
    useQuery<{ data: AuditEntry[] }>({
      queryKey: ['integration-audit', selectedId],
      queryFn:  () => api.get(`/system/integrations/${selectedId}/audit`),
      staleTime: 15_000,
      enabled:   isAdmin && !!selectedId,
    })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useMutation<Integration, Error, CreateIntegrationBody>({
    mutationFn: body => api.post('/system/integrations', body),
    onSuccess: () => {
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: ['integrations'] })
      toast.success('Integration registered')
    },
    onError: (e: Error) => toast.error('Failed to register integration', { description: e.message }),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateIntegrationBody & { status: IntegrationStatus }> }) =>
      api.put(`/system/integrations/${id}`, body),
    onSuccess: () => {
      setShowEdit(false)
      qc.invalidateQueries({ queryKey: ['integrations'] })
      toast.success('Integration updated')
    },
    onError: (e: Error) => toast.error('Failed to update integration', { description: e.message }),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/system/integrations/${id}`),
    onSuccess: () => {
      setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['integrations'] })
      toast.success('Integration deactivated')
    },
    onError: (e: Error) => toast.error('Failed to deactivate', { description: e.message }),
  })

  const healthCheckMutation = useMutation<HealthCheckResult, Error, string>({
    mutationFn: id => api.post(`/system/integrations/${id}/health-check`),
    onSuccess: result => {
      setCheckingHealth(false)
      setHealthResult(result)
      qc.invalidateQueries({ queryKey: ['integrations'] })
      toast.success('Health check completed')
    },
    onError: (e: Error) => {
      setCheckingHealth(false)
      toast.error('Health check failed', { description: e.message })
    },
  })

  // ── Derived ──────────────────────────────────────────────────────────────────

  const integrations = integrationsData?.data ?? []
  const auditEntries = auditData?.data         ?? []
  const selected     = integrations.find(i => i.id === selectedId) ?? null

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Integration Registry"
          subtitle="External system catalog and integration health"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-16 gap-2 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Access restricted</p>
            <p className="text-xs text-muted-foreground/60">
              This workspace is available to HR administrators only.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const selectCls =
    'flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50'

  return (
    <PageContainer>
      <PageHeader
        title="Integration Registry"
        subtitle="External system catalog and integration health"
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            Register Integration
          </Button>
        }
      />

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* ── Left: Integration list ── */}
        <div className="lg:col-span-2 space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className={selectCls}
            >
              <option value="">All Statuses</option>
              {(['active', 'inactive', 'error', 'maintenance'] as IntegrationStatus[]).map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className={selectCls}
            >
              <option value="">All Types</option>
              {INTEGRATION_TYPES.map(t => (
                <option key={t} value={t}>{typeLabel(t)}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Integrations {integrations.length > 0 && `(${integrations.length})`}
            </p>
          </div>

          {integrationsLoading && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading integrations…
            </div>
          )}

          {!integrationsLoading && integrations.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-12 text-center">
              <Plug className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No integrations found</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Register one to get started
              </p>
            </div>
          )}

          <div className="space-y-2">
            {integrations.map(integration => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                isSelected={selectedId === integration.id}
                onSelect={() => {
                  setSelectedId(integration.id)
                  setHealthResult(null)
                }}
              />
            ))}
          </div>
        </div>

        {/* ── Right: Detail panel ── */}
        <div className="lg:col-span-3 space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-dashed border-border py-20 flex flex-col items-center justify-center gap-2">
              <Plug className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">
                Select an integration to view details
              </p>
            </div>
          ) : (
            <>
              {/* Overview card */}
              <SectionCard
                title={selected.name}
                icon={<Plug className="h-4 w-4 text-muted-foreground" />}
              >
                {/* Meta row */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="outline" className="rounded-full text-[10px] px-2">
                    {typeLabel(selected.integration_type)}
                  </Badge>
                  <Badge
                    variant={STATUS_VARIANT[selected.status]}
                    className="rounded-full text-[10px] px-2"
                  >
                    {selected.status}
                  </Badge>
                  <Badge
                    variant={HEALTH_VARIANT[selected.health_status]}
                    className="rounded-full text-[10px] px-2"
                  >
                    {selected.health_status}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-xs mb-4">
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground font-medium w-24 shrink-0">Endpoint</span>
                    <span className="font-mono text-foreground break-all">{selected.endpoint_url}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground font-medium w-24 shrink-0">Auth Type</span>
                    <span className="text-foreground">{authLabel(selected.auth_type)}</span>
                  </div>
                  {selected.description && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground font-medium w-24 shrink-0">Description</span>
                      <span className="text-foreground">{selected.description}</span>
                    </div>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Total Calls',   value: (selected.total_calls ?? 0).toLocaleString() },
                    {
                      label: 'Error Rate',
                      value: `${(selected.error_rate_pct ?? 0).toFixed(1)}%`,
                      cls: (selected.error_rate_pct ?? 0) > 5 ? 'text-destructive' : 'text-foreground',
                    },
                    {
                      label: 'Avg Latency',
                      value: `${selected.avg_latency_ms}ms`,
                      cls: selected.avg_latency_ms > 1000 ? 'text-warning' : 'text-foreground',
                    },
                  ].map(stat => (
                    <div
                      key={stat.label}
                      className="rounded-md border border-border bg-muted/20 px-3 py-2.5"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">
                        {stat.label}
                      </p>
                      <p className={cn('text-xl font-bold', stat.cls ?? 'text-foreground')}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Health check */}
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={checkingHealth && healthCheckMutation.isPending}
                    onClick={() => {
                      setHealthResult(null)
                      setCheckingHealth(true)
                      healthCheckMutation.mutate(selected.id)
                    }}
                  >
                    {checkingHealth && healthCheckMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Activity className="h-3.5 w-3.5" />
                    )}
                    Health Check
                  </Button>

                  {healthResult && (
                    <div
                      className={cn(
                        'flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border',
                        healthResult.health_status === 'healthy'
                          ? 'border-success/40 bg-success/5 text-success'
                          : healthResult.health_status === 'degraded'
                          ? 'border-warning/40 bg-warning/5 text-warning'
                          : 'border-destructive/40 bg-destructive/5 text-destructive',
                      )}
                    >
                      {healthResult.health_status === 'healthy' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      <span className="capitalize">{healthResult.health_status}</span>
                      {healthResult.latency_ms != null && (
                        <span className="text-muted-foreground">· {healthResult.latency_ms}ms</span>
                      )}
                    </div>
                  )}
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setShowEdit(true)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {selected.status !== 'inactive' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive hover:text-destructive"
                        disabled={deactivateMutation.isPending}
                        onClick={() => {
                          if (confirm(`Deactivate "${selected.name}"?`)) {
                            deactivateMutation.mutate(selected.id)
                          }
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Deactivate
                      </Button>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* Audit log */}
              <SectionCard
                title="Audit Log"
                icon={<Activity className="h-4 w-4 text-muted-foreground" />}
                noPadding
              >
                {auditLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading audit log…</span>
                  </div>
                ) : auditEntries.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-2">
                    <Activity className="h-7 w-7 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">No audit entries yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          {['Operation', 'Direction', 'Status', 'Duration', 'Created At'].map(h => (
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
                        {auditEntries.map(entry => (
                          <tr
                            key={entry.id}
                            className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                          >
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span className="text-xs font-mono text-foreground">
                                {entry.operation}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <Badge
                                variant={DIRECTION_VARIANT[entry.direction]}
                                className="rounded-full text-[10px] px-2 gap-0.5"
                              >
                                {entry.direction === 'inbound' ? (
                                  <ArrowDownLeft className="h-2.5 w-2.5" />
                                ) : (
                                  <ArrowUpRight className="h-2.5 w-2.5" />
                                )}
                                {entry.direction}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <Badge
                                variant={AUDIT_STATUS_VARIANT[entry.status]}
                                className="rounded-full text-[10px] px-2 capitalize"
                              >
                                {entry.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {entry.duration_ms != null ? `${entry.duration_ms}ms` : '—'}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-xs text-foreground tabular-nums">
                              {fmtDateTime(entry.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>

      {/* ── Create dialog ── */}
      {showCreate && (
        <CreateIntegrationDialog
          onClose={() => setShowCreate(false)}
          onCreate={body => createMutation.mutate(body)}
          isPending={createMutation.isPending}
        />
      )}

      {/* ── Edit dialog ── */}
      {showEdit && selected && (
        <EditIntegrationDialog
          integration={selected}
          onClose={() => setShowEdit(false)}
          onEdit={body => editMutation.mutate({ id: selected.id, body })}
          isPending={editMutation.isPending}
        />
      )}
    </PageContainer>
  )
}
