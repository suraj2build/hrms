import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Phone, Bell, Send, Link, Plus, Edit2 } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubTabs } from '@/components/ui/SubTabs'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

interface NotifChannel {
  id: string
  channel_type: 'email' | 'sms' | 'in_app' | 'push' | 'webhook'
  is_enabled: boolean
  config: Record<string, unknown>
}

interface NotifTemplate {
  id: string
  template_code: string
  template_name: string
  category: string
  severity: string
  subject: string | null
  body_template: string
  available_channels: string[]
  placeholders: string[]
  has_action_cta: boolean
  cta_label: string | null
  cta_route: string | null
  is_active: boolean
  created_at: string
}

interface NotifVariable {
  key: string
  label: string
  description: string
  sample: string
  scope: string
}

interface TemplateMeta {
  categories: string[]
  severities: string[]
  channels: string[]
  variables: NotifVariable[]
}

interface NotifLog {
  id: string
  template_id: string
  recipient_id: string
  channel_type: string
  status: 'queued' | 'sent' | 'failed' | 'bounced'
  sent_at: string | null
  error_message: string | null
  template_name?: string
  recipient_name?: string
}

type Tab = 'templates' | 'channels' | 'digest-status' | 'log'

interface DigestStatusRow {
  id: string
  action: 'DIGEST_SENT' | 'DIGEST_FAILED'
  new_values: Record<string, unknown>
  created_at: string
}

const LOG_STATUSES = ['all', 'queued', 'sent', 'failed', 'bounced'] as const

function channelIcon(type: string) {
  switch (type) {
    case 'email': return <Mail className="h-4 w-4" />
    case 'sms': return <Phone className="h-4 w-4" />
    case 'in_app': return <Bell className="h-4 w-4" />
    case 'push': return <Send className="h-4 w-4" />
    case 'webhook': return <Link className="h-4 w-4" />
    default: return <Bell className="h-4 w-4" />
  }
}

function logStatusBadge(status: NotifLog['status']): BadgeProps['variant'] {
  const map: Record<NotifLog['status'], BadgeProps['variant']> = {
    queued: 'secondary',
    sent: 'success',
    failed: 'destructive',
    bounced: 'warning',
  }
  return map[status] ?? 'secondary'
}

interface TemplateForm {
  template_code: string
  template_name: string
  category: string
  severity: string
  subject: string
  body_template: string
  available_channels: string[]
  has_action_cta: boolean
  cta_label: string
  cta_route: string
  is_active: boolean
}

const defaultForm: TemplateForm = {
  template_code: '',
  template_name: '',
  category: 'general',
  severity: 'info',
  subject: '',
  body_template: '',
  available_channels: ['in_app'],
  has_action_cta: false,
  cta_label: '',
  cta_route: '',
  is_active: true,
}

export function NotificationTemplates() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('templates')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<NotifTemplate | null>(null)
  const [form, setForm] = useState<TemplateForm>(defaultForm)
  const [logStatusFilter, setLogStatusFilter] = useState<string>('all')
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const { data: templates = [], isLoading: tLoading } = useQuery<NotifTemplate[]>({
    queryKey: ['notifications', 'templates'],
    queryFn: () => api.get<{ data: NotifTemplate[] }>('/notifications/templates').then((r) => r.data),
    enabled: activeTab === 'templates',
  })

  // Single source of truth for the editor — categories, severities, channels, variables.
  const { data: meta } = useQuery<TemplateMeta>({
    queryKey: ['notifications', 'template-meta'],
    queryFn: () => api.get<{ data: TemplateMeta }>('/notifications/templates/meta').then((r) => r.data),
    staleTime: Infinity,
  })

  // Insert a {{variable}} token at the body textarea cursor (or append).
  function insertVariable(key: string) {
    const token = `{{${key}}}`
    const el = bodyRef.current
    if (!el) {
      setForm(f => ({ ...f, body_template: f.body_template + token }))
      return
    }
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd ?? el.value.length
    const next  = el.value.slice(0, start) + token + el.value.slice(end)
    setForm(f => ({ ...f, body_template: next }))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  const { data: channels = [], isLoading: cLoading } = useQuery<NotifChannel[]>({
    queryKey: ['notifications', 'channels'],
    queryFn: () => api.get<{ data: NotifChannel[] }>('/notifications/channels').then((r) => r.data),
    enabled: activeTab === 'channels',
  })

  const { data: logs = [], isLoading: lLoading } = useQuery<NotifLog[]>({
    queryKey: ['notifications', 'log'],
    queryFn: () => api.get<{ data: NotifLog[] }>('/notifications/log').then((r) => r.data),
    enabled: activeTab === 'log',
  })

  const createTemplate = useMutation({
    mutationFn: (body: TemplateForm) => api.post('/notifications/templates', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications', 'templates'] }); closeDialog(); toast.success('Template created') },
    onError: (e: Error) => toast.error('Failed to create template', { description: e.message }),
  })

  const updateTemplate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TemplateForm> }) =>
      api.put(`/notifications/templates/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications', 'templates'] }); closeDialog(); toast.success('Template updated') },
    onError: (e: Error) => toast.error('Failed to update template', { description: e.message }),
  })

  const toggleChannel = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/notifications/channels/${id}`, { is_enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications', 'channels'] }); toast.success('Channel setting updated') },
    onError: (e: Error) => toast.error('Channel setting updated', { description: e.message }),
  })

  const { data: digestStatus = [], isLoading: dsLoading } = useQuery<DigestStatusRow[]>({
    queryKey: ['notifications', 'digest-status'],
    queryFn: () => api.get<{ data: DigestStatusRow[] }>('/notifications/digest/status').then((r) => r.data),
    enabled: activeTab === 'digest-status',
    refetchInterval: activeTab === 'digest-status' ? 30_000 : false,
  })

  const runDigest = useMutation({
    mutationFn: (frequency: string) => api.post<{ data?: { in_app: number; email: number; failed: number } }>('/notifications/digest/run', { frequency }),
    onSuccess: (r) => {
      const d = r?.data
      qc.invalidateQueries({ queryKey: ['notifications', 'digest-status'] })
      toast.success('Digest sent', { description: d ? `${d.in_app} in-app · ${d.email} email · ${d.failed} failed` : undefined })
    },
    onError: (e: Error) => toast.error('Send failed', { description: e.message }),
  })

  function openAdd() {
    setEditingTemplate(null)
    setForm(defaultForm)
    setDialogOpen(true)
  }

  function openEdit(t: NotifTemplate) {
    setEditingTemplate(t)
    setForm({
      template_code: t.template_code,
      template_name: t.template_name,
      category: t.category,
      severity: t.severity ?? 'info',
      subject: t.subject ?? '',
      body_template: t.body_template,
      available_channels: t.available_channels?.length ? t.available_channels : ['in_app'],
      has_action_cta: t.has_action_cta ?? false,
      cta_label: t.cta_label ?? '',
      cta_route: t.cta_route ?? '',
      is_active: t.is_active,
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingTemplate(null)
    setForm(defaultForm)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editingTemplate) {
      updateTemplate.mutate({ id: editingTemplate.id, body: form })
    } else {
      createTemplate.mutate(form)
    }
  }

  const filteredLogs = logStatusFilter === 'all'
    ? logs
    : logs.filter(l => l.status === logStatusFilter)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'templates',      label: 'Templates' },
    { key: 'channels',       label: 'Channels' },
    { key: 'digest-status',  label: 'Digest Delivery' },
    { key: 'log',            label: 'Delivery Log' },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Notification Management"
        subtitle="Manage notification templates, channels, and delivery logs"
        actions={
          activeTab === 'templates' ? (
            <Button onClick={openAdd} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Template
            </Button>
          ) : undefined
        }
      />

      {/* Tab Bar */}
      <SubTabs<typeof activeTab>
        tabs={tabs.map(t => ({ id: t.key, label: t.label }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-6"
      />

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <SectionCard title="Templates">
          {tLoading ? (
            <p className="text-muted-foreground text-sm py-4">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No templates found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Code</th>
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-left py-2 px-3 font-medium">Category</th>
                    <th className="text-left py-2 px-3 font-medium">Channels</th>
                    <th className="text-left py-2 px-3 font-medium">Active</th>
                    <th className="text-left py-2 px-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-2 px-3 font-mono text-xs">{t.template_code}</td>
                      <td className="py-2 px-3 text-foreground">{t.template_name}</td>
                      <td className="py-2 px-3">
                        <Badge variant="secondary" className="capitalize">{t.category}</Badge>
                      </td>
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          {(t.available_channels ?? []).map(c => (
                            <span key={c} title={c}>{channelIcon(c)}</span>
                          ))}
                          {(!t.available_channels || t.available_channels.length === 0) && <span className="text-xs">—</span>}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => updateTemplate.mutate({ id: t.id, body: { is_active: !t.is_active } })}
                          className={cn(
                            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                            t.is_active ? 'bg-primary' : 'bg-muted'
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                              t.is_active ? 'translate-x-4' : 'translate-x-1'
                            )}
                          />
                        </button>
                      </td>
                      <td className="py-2 px-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                          <Edit2 className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <SectionCard title="Notification Channels">
          {cLoading ? (
            <p className="text-muted-foreground text-sm py-4">Loading channels…</p>
          ) : channels.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No channels configured.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {channels.map(ch => (
                <div
                  key={ch.id}
                  className="border border-border rounded-lg p-4 flex items-center justify-between bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{channelIcon(ch.channel_type)}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground capitalize">
                        {ch.channel_type.replace('_', ' ')}
                      </p>
                      <p className={cn('text-xs', ch.is_enabled ? 'text-success' : 'text-muted-foreground')}>
                        {ch.is_enabled ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleChannel.mutate({ id: ch.id, is_enabled: !ch.is_enabled })}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                      ch.is_enabled ? 'bg-primary' : 'bg-muted'
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                        ch.is_enabled ? 'translate-x-4' : 'translate-x-1'
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Digest Delivery Tab */}
      {activeTab === 'digest-status' && (
        <SectionCard title="Digest Delivery">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              Digests are delivered automatically to all HR admins — daily at 06:00 UTC, weekly on Monday, monthly on the 1st.
              Use "Send now" to test delivery immediately.
            </p>
            <div className="flex gap-2">
              {(['daily', 'weekly', 'monthly'] as const).map(f => (
                <Button key={f} variant="outline" size="sm" disabled={runDigest.isPending}
                  onClick={() => runDigest.mutate(f)}>
                  <Send className="h-3.5 w-3.5 mr-1" />
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
          </div>
          {dsLoading ? (
            <p className="text-muted-foreground text-sm py-4">Loading delivery log…</p>
          ) : digestStatus.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No digest sends yet. Use "Send now" to trigger a test delivery.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground uppercase tracking-wider text-[10px]">
                    <th className="text-left py-2 pr-4 font-semibold">Status</th>
                    <th className="text-left py-2 pr-4 font-semibold">Frequency</th>
                    <th className="text-left py-2 pr-4 font-semibold">Channel</th>
                    <th className="text-left py-2 pr-4 font-semibold">Period</th>
                    <th className="text-left py-2 font-semibold">Sent at</th>
                  </tr>
                </thead>
                <tbody>
                  {digestStatus.map(row => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="py-2 pr-4">
                        <Badge variant={row.action === 'DIGEST_SENT' ? 'success' : 'destructive'} className="text-[10px]">
                          {row.action === 'DIGEST_SENT' ? 'Sent' : 'Failed'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 capitalize">{String(row.new_values?.frequency ?? '—')}</td>
                      <td className="py-2 pr-4 capitalize">{String(row.new_values?.channel ?? '—').replace('_', '-')}</td>
                      <td className="py-2 pr-4 font-mono text-muted-foreground">{String(row.new_values?.period_key ?? '—')}</td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Delivery Log Tab */}
      {activeTab === 'log' && (
        <SectionCard
          title="Delivery Log"
          action={
            <select
              value={logStatusFilter}
              onChange={e => setLogStatusFilter(e.target.value)}
              className="text-sm border border-border rounded-md px-2 py-1 bg-background text-foreground"
            >
              {LOG_STATUSES.map(s => (
                <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          }
        >
          {lLoading ? (
            <p className="text-muted-foreground text-sm py-4">Loading log…</p>
          ) : filteredLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No log entries found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Template</th>
                    <th className="text-left py-2 px-3 font-medium">Recipient</th>
                    <th className="text-left py-2 px-3 font-medium">Channel</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Sent At</th>
                    <th className="text-left py-2 px-3 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(log => (
                    <tr key={log.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                      <td className="py-2 px-3 text-foreground">{log.template_name ?? '—'}</td>
                      <td className="py-2 px-3 text-muted-foreground">{log.recipient_name ?? '—'}</td>
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {channelIcon(log.channel_type)}
                          {log.channel_type}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={logStatusBadge(log.status)}>
                          {log.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground text-xs">
                        {log.sent_at ? new Date(log.sent_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 px-3 text-destructive text-xs max-w-[180px] truncate">
                        {log.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit Template' : 'Add Template'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Template Code *</label>
                <Input
                  value={form.template_code}
                  onChange={e => setForm(f => ({ ...f, template_code: e.target.value }))}
                  placeholder="e.g. LEAVE_APPROVED"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Template Name *</label>
                <Input
                  value={form.template_name}
                  onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))}
                  placeholder="e.g. Leave Approved"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Category *</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground capitalize"
                  required
                >
                  {(meta?.categories ?? ['general']).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Severity</label>
                <select
                  value={form.severity}
                  onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground capitalize"
                >
                  {(meta?.severities ?? ['info']).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Delivery Channels</label>
              <div className="flex flex-wrap gap-2">
                {(meta?.channels ?? ['in_app', 'email']).map(c => {
                  const on = form.available_channels.includes(c)
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        available_channels: on
                          ? f.available_channels.filter(x => x !== c)
                          : [...f.available_channels, c],
                      }))}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs rounded-full border px-3 py-1.5 transition-colors capitalize',
                        on ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-muted/40',
                      )}
                    >
                      {channelIcon(c)} {c.replace('_', '-')}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Subject (optional)</label>
              <Input
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. Your leave has been {{status}}"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted-foreground block">Body *</label>
                <span className="text-[10px] text-muted-foreground">Click a variable to insert it</span>
              </div>
              {/* Variable picker — single source of truth from GET /meta */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(meta?.variables ?? []).map(v => (
                  <button
                    key={v.key}
                    type="button"
                    title={`${v.description} (e.g. ${v.sample})`}
                    onClick={() => insertVariable(v.key)}
                    className="text-[11px] font-mono rounded border border-border bg-muted/40 px-1.5 py-0.5 text-foreground hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
              <textarea
                ref={bodyRef}
                value={form.body_template}
                onChange={e => setForm(f => ({ ...f, body_template: e.target.value }))}
                placeholder="Hi {{employee_name}}, your {{leave_type}} request has been {{status}}."
                rows={5}
                required
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Optional call-to-action */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={form.has_action_cta}
                  onChange={e => setForm(f => ({ ...f, has_action_cta: e.target.checked }))}
                  className="h-4 w-4 rounded accent-primary"
                />
                <span className="text-xs font-medium text-foreground">Include an action button (CTA)</span>
              </label>
              {form.has_action_cta && (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    value={form.cta_label}
                    onChange={e => setForm(f => ({ ...f, cta_label: e.target.value }))}
                    placeholder="Button label — e.g. View Request"
                  />
                  <Input
                    value={form.cta_route}
                    onChange={e => setForm(f => ({ ...f, cta_route: e.target.value }))}
                    placeholder="Route — e.g. /ess/leave"
                  />
                </div>
              )}
            </div>

            {editingTemplate && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                    form.is_active ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                      form.is_active ? 'translate-x-4' : 'translate-x-1'
                    )}
                  />
                </button>
                <span className="text-sm text-foreground">Active</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={createTemplate.isPending || updateTemplate.isPending}>
                {editingTemplate ? 'Save Changes' : 'Create Template'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
