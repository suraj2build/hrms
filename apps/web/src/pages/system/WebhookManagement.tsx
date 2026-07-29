/**
 * WebhookManagement — /system/webhooks
 *
 * Admin-only workspace for managing outbound webhook subscriptions and
 * inspecting delivery history with retry support.
 *
 * Access: hr_admin, super_admin only.
 */

import { useState }                                   from 'react'
import { useQuery, useMutation, useQueryClient }      from '@tanstack/react-query'
import {
  Webhook, Loader2, Plus, Trash2, Send, RotateCcw,
  CheckCircle2, XCircle, Clock, ShieldAlert, ChevronRight,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type DeliveryStatus   = 'delivered' | 'failed' | 'pending' | 'retrying' | 'dead_lettered'

interface WebhookRecord {
  id:                string
  name:              string
  url:               string
  event_types:       string[]
  is_active:         boolean
  description:       string | null
  max_retries:       number
  timeout_seconds:   number
  total_deliveries:  number
  failed_deliveries: number
  last_success_at:   string | null
  last_failure_at:   string | null
  created_at:        string
}

interface WebhookDelivery {
  id:          string
  webhook_id:  string
  event_type:  string
  status:      DeliveryStatus
  http_status: number | null
  duration_ms: number | null
  created_at:  string
}

interface TestResult {
  success:     boolean
  http_status: number | null
  duration_ms: number | null
  error?:      string
}

interface CreateWebhookBody {
  name:            string
  url:             string
  event_types:     string[]
  secret?:         string
  description?:    string
  max_retries:     number
  timeout_seconds: number
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const DELIVERY_VARIANT: Record<DeliveryStatus, BadgeVariant> = {
  delivered:    'success',
  failed:       'destructive',
  pending:      'secondary',
  retrying:     'warning',
  dead_lettered:'destructive',
}

const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  delivered:    'Delivered',
  failed:       'Failed',
  pending:      'Pending',
  retrying:     'Retrying',
  dead_lettered:'Dead Lettered',
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

function truncateUrl(url: string, maxLen = 48): string {
  if (url.length <= maxLen) return url
  return url.slice(0, maxLen) + '…'
}

// ── Dialog: Create Webhook ─────────────────────────────────────────────────────

interface CreateDialogProps {
  onClose:  () => void
  onCreate: (body: CreateWebhookBody) => void
  isPending: boolean
}

const COMMON_EVENT_TYPES = [
  'employee.created', 'employee.updated', 'employee.terminated',
  'attendance.punched_in', 'attendance.punched_out', 'attendance.exception',
  'leave.requested', 'leave.approved', 'leave.rejected',
  'payroll.processed', 'payroll.published',
]

function CreateWebhookDialog({ onClose, onCreate, isPending }: CreateDialogProps) {
  const [form, setForm] = useState({
    name:            '',
    url:             '',
    event_types_raw: '',
    secret:          '',
    description:     '',
    max_retries:     3,
    timeout_seconds: 30,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const event_types = form.event_types_raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    onCreate({
      name:            form.name,
      url:             form.url,
      event_types,
      secret:          form.secret || undefined,
      description:     form.description || undefined,
      max_retries:     form.max_retries,
      timeout_seconds: form.timeout_seconds,
    })
  }

  const inputCls =
    'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 ring-primary/50 placeholder:text-muted-foreground/50 disabled:opacity-50'
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
              <p className="font-semibold text-foreground">New Webhook</p>
              <p className="text-xs text-muted-foreground mt-0.5">Subscribe to outbound events</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="My Webhook"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Secret (optional)</label>
                <input
                  type="password"
                  value={form.secret}
                  onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  placeholder="Signing secret"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Endpoint URL *</label>
              <input
                required
                type="url"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/webhook"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>
                Event Types (comma-separated) *
              </label>
              <input
                required
                value={form.event_types_raw}
                onChange={e => setForm(f => ({ ...f, event_types_raw: e.target.value }))}
                placeholder="employee.created, leave.approved, payroll.processed"
                className={inputCls}
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {COMMON_EVENT_TYPES.map(evt => (
                  <button
                    key={evt}
                    type="button"
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                    onClick={() => {
                      setForm(f => {
                        const existing = f.event_types_raw
                          .split(',')
                          .map(s => s.trim())
                          .filter(Boolean)
                        if (existing.includes(evt)) return f
                        return {
                          ...f,
                          event_types_raw: [...existing, evt].join(', '),
                        }
                      })
                    }}
                  >
                    + {evt}
                  </button>
                ))}
              </div>
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Max Retries</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={form.max_retries}
                  onChange={e => setForm(f => ({ ...f, max_retries: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Timeout (seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={form.timeout_seconds}
                  onChange={e => setForm(f => ({ ...f, timeout_seconds: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Webhook
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

// ── Webhook Card ───────────────────────────────────────────────────────────────

interface WebhookCardProps {
  webhook:    WebhookRecord
  isSelected: boolean
  onSelect:   () => void
  onDelete:   (webhook: WebhookRecord) => void
  isDeleting: boolean
}

function WebhookCard({ webhook, isSelected, onSelect, onDelete, isDeleting }: WebhookCardProps) {
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
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-foreground truncate">{webhook.name}</p>
            <Badge
              variant={webhook.is_active ? 'success' : 'secondary'}
              className="rounded-full text-[10px] px-2 shrink-0"
            >
              {webhook.is_active ? 'active' : 'inactive'}
            </Badge>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground truncate">
            {truncateUrl(webhook.url)}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ChevronRight className={cn(
            'h-4 w-4 transition-colors',
            isSelected ? 'text-primary' : 'text-muted-foreground/40',
          )} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-2 mb-2">
        {webhook.event_types.slice(0, 4).map(evt => (
          <span
            key={evt}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60"
          >
            {evt}
          </span>
        ))}
        {webhook.event_types.length > 4 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60">
            +{webhook.event_types.length - 4}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground">{webhook.total_deliveries}</span> deliveries
          </span>
          {webhook.failed_deliveries > 0 && (
            <span className="text-[10px] text-destructive">
              <span className="font-medium">{webhook.failed_deliveries}</span> failed
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          disabled={isDeleting}
          onClick={e => {
            e.stopPropagation()
            onDelete(webhook)
          }}
        >
          {isDeleting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function WebhookManagement() {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [showCreate,    setShowCreate]    = useState(false)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)
  const [deleteTarget,  setDeleteTarget]  = useState<WebhookRecord | null>(null)
  const [testResult,    setTestResult]    = useState<TestResult | null>(null)
  const [testingId,     setTestingId]     = useState<string | null>(null)
  const [retryingId,    setRetryingId]    = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: webhooksData, isLoading: webhooksLoading } = useQuery<{ data: WebhookRecord[] }>({
    queryKey: ['webhooks'],
    queryFn:  () => api.get('/system/webhooks'),
    staleTime: 30_000,
    enabled:  isAdmin,
  })

  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery<{ data: WebhookDelivery[] }>({
    queryKey: ['webhook-deliveries', selectedId],
    queryFn:  () => api.get(`/system/webhooks/${selectedId}/deliveries`),
    staleTime: 15_000,
    enabled:  isAdmin && !!selectedId,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useMutation<WebhookRecord, Error, CreateWebhookBody>({
    mutationFn: body => api.post('/system/webhooks', body),
    onSuccess: () => {
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook created')
    },
    onError: (e: Error) => toast.error('Failed to create webhook', { description: e.message }),
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: id => api.delete(`/system/webhooks/${id}`),
    onSuccess: (_, id) => {
      setDeletingId(null)
      setDeleteTarget(null)
      if (selectedId === id) setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook deleted')
    },
    onError: (e: Error) => {
      setDeletingId(null)
      setDeleteTarget(null)
      toast.error('Failed to delete webhook', { description: e.message })
    },
  })

  const testMutation = useMutation<TestResult, Error, string>({
    mutationFn: id => api.post(`/system/webhooks/${id}/test`),
    onSuccess: result => {
      setTestingId(null)
      setTestResult(result)
      qc.invalidateQueries({ queryKey: ['webhook-deliveries', selectedId] })
      toast.success('Test delivery sent')
    },
    onError: (e: Error) => {
      setTestingId(null)
      toast.error('Test delivery failed', { description: e.message })
    },
  })

  const retryMutation = useMutation<void, Error, string>({
    mutationFn: deliveryId =>
      api.post(`/system/webhooks/deliveries/${deliveryId}/retry`),
    onSuccess: () => {
      setRetryingId(null)
      qc.invalidateQueries({ queryKey: ['webhook-deliveries', selectedId] })
      toast.success('Delivery retried')
    },
    onError: (e: Error) => {
      setRetryingId(null)
      toast.error('Failed to retry delivery', { description: e.message })
    },
  })

  // ── Derived ──────────────────────────────────────────────────────────────────

  const webhooks   = webhooksData?.data  ?? []
  const deliveries = deliveriesData?.data ?? []
  const selected   = webhooks.find(w => w.id === selectedId) ?? null

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Webhook Management"
          subtitle="Outbound event subscriptions and delivery tracking"
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

  return (
    <PageContainer>
      <PageHeader
        title="Webhook Management"
        subtitle="Outbound event subscriptions and delivery tracking"
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Webhook
          </Button>
        }
      />

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* ── Left: Webhook list ── */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Webhook className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Webhooks {webhooks.length > 0 && `(${webhooks.length})`}
            </p>
          </div>

          {webhooksLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading webhooks…
            </div>
          )}

          {!webhooksLoading && webhooks.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-12 text-center">
              <Webhook className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No webhooks configured</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Click "New Webhook" to get started
              </p>
            </div>
          )}

          {webhooks.map(wh => (
            <WebhookCard
              key={wh.id}
              webhook={wh}
              isSelected={selectedId === wh.id}
              onSelect={() => {
                setSelectedId(wh.id)
                setTestResult(null)
              }}
              onDelete={setDeleteTarget}
              isDeleting={deletingId === wh.id && deleteMutation.isPending}
            />
          ))}
        </div>

        {/* ── Right: Detail panel ── */}
        <div className="lg:col-span-3 space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-dashed border-border py-20 flex flex-col items-center justify-center gap-2">
              <Webhook className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">
                Select a webhook to view details
              </p>
            </div>
          ) : (
            <>
              {/* Stats card */}
              <SectionCard
                title={selected.name}
                icon={<Webhook className="h-4 w-4 text-muted-foreground" />}
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Total',      value: selected.total_deliveries,  variant: 'neutral' },
                    {
                      label: 'Successful',
                      value: selected.total_deliveries - selected.failed_deliveries,
                      variant: 'success',
                    },
                    {
                      label: 'Failed',
                      value: selected.failed_deliveries,
                      variant: selected.failed_deliveries > 0 ? 'destructive' : 'neutral',
                    },
                    {
                      label: 'Retries',
                      value: selected.max_retries,
                      variant: 'neutral',
                    },
                  ].map(stat => (
                    <div
                      key={stat.label}
                      className="rounded-md border border-border bg-muted/20 px-3 py-2.5"
                    >
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">
                        {stat.label}
                      </p>
                      <p
                        className={cn(
                          'text-xl font-bold',
                          stat.variant === 'success'     && 'text-success',
                          stat.variant === 'destructive' && 'text-destructive',
                          stat.variant === 'neutral'     && 'text-foreground',
                        )}
                      >
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground mb-4">
                  <div>
                    <span className="font-medium">Last success: </span>
                    {selected.last_success_at ? fmtDateTime(selected.last_success_at) : '—'}
                  </div>
                  <div>
                    <span className="font-medium">Last failure: </span>
                    {selected.last_failure_at ? (
                      <span className="text-destructive">
                        {fmtDateTime(selected.last_failure_at)}
                      </span>
                    ) : '—'}
                  </div>
                </div>

                {/* Test button & result */}
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={testingId === selected.id && testMutation.isPending}
                    onClick={() => {
                      setTestResult(null)
                      setTestingId(selected.id)
                      testMutation.mutate(selected.id)
                    }}
                  >
                    {testingId === selected.id && testMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send Test
                  </Button>

                  {testResult && (
                    <div
                      className={cn(
                        'flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border',
                        testResult.success
                          ? 'border-success/40 bg-success/5 text-success'
                          : 'border-destructive/40 bg-destructive/5 text-destructive',
                      )}
                    >
                      {testResult.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {testResult.success ? 'Success' : 'Failed'}
                        {testResult.http_status && ` · HTTP ${testResult.http_status}`}
                        {testResult.duration_ms && ` · ${testResult.duration_ms}ms`}
                      </span>
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* Deliveries table */}
              <SectionCard
                title="Delivery History"
                icon={<Clock className="h-4 w-4 text-muted-foreground" />}
                noPadding
              >
                {deliveriesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading deliveries…</span>
                  </div>
                ) : deliveries.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-2">
                    <Clock className="h-7 w-7 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">No deliveries yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          {['Created At', 'Event Type', 'Status', 'HTTP', 'Duration', ''].map(h => (
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
                        {deliveries.map(d => (
                          <tr
                            key={d.id}
                            className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                          >
                            <td className="py-2.5 px-4 whitespace-nowrap text-xs text-foreground tabular-nums">
                              {fmtDateTime(d.created_at)}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span className="text-[11px] font-mono text-foreground">
                                {d.event_type}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <Badge
                                variant={DELIVERY_VARIANT[d.status]}
                                className="rounded-full text-[10px] px-2"
                              >
                                {DELIVERY_LABEL[d.status]}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-xs tabular-nums">
                              {d.http_status ?? '—'}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {d.duration_ms != null ? `${d.duration_ms}ms` : '—'}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {(d.status === 'failed' || d.status === 'dead_lettered') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                  disabled={retryingId === d.id && retryMutation.isPending}
                                  onClick={() => {
                                    setRetryingId(d.id)
                                    retryMutation.mutate(d.id)
                                  }}
                                >
                                  {retryingId === d.id && retryMutation.isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3 w-3" />
                                  )}
                                  Retry
                                </Button>
                              )}
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
        <CreateWebhookDialog
          onClose={() => setShowCreate(false)}
          onCreate={body => createMutation.mutate(body)}
          isPending={createMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Webhook"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? It will stop receiving events and disappear from this list.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!deleteTarget) return
          setDeletingId(deleteTarget.id)
          deleteMutation.mutate(deleteTarget.id)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  )
}
