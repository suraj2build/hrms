import { useState } from 'react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Phone, Bell, Send, Link, Plus, Edit2 } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubTabs } from '@/components/ui/SubTabs'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  channel_type: string
  event_trigger: string
  subject_template: string | null
  body_template: string
  is_active: boolean
  created_at: string
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

type Tab = 'templates' | 'channels' | 'log'
type ChannelType = 'email' | 'sms' | 'in_app' | 'push' | 'webhook'

const CHANNEL_TYPES: ChannelType[] = ['email', 'sms', 'in_app', 'push', 'webhook']
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

function logStatusBadge(status: NotifLog['status']) {
  const map: Record<NotifLog['status'], string> = {
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
  channel_type: ChannelType
  event_trigger: string
  subject_template: string
  body_template: string
  is_active: boolean
}

const defaultForm: TemplateForm = {
  template_code: '',
  template_name: '',
  channel_type: 'email',
  event_trigger: '',
  subject_template: '',
  body_template: '',
  is_active: true,
}

export function NotificationTemplates() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('templates')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<NotifTemplate | null>(null)
  const [form, setForm] = useState<TemplateForm>(defaultForm)
  const [logStatusFilter, setLogStatusFilter] = useState<string>('all')

  const { data: templates = [], isLoading: tLoading } = useQuery<NotifTemplate[]>({
    queryKey: ['notifications', 'templates'],
    queryFn: () => api.get('/notifications/templates').then((r: any) => r.data),
    enabled: activeTab === 'templates',
  })

  const { data: channels = [], isLoading: cLoading } = useQuery<NotifChannel[]>({
    queryKey: ['notifications', 'channels'],
    queryFn: () => api.get('/notifications/channels').then((r: any) => r.data),
    enabled: activeTab === 'channels',
  })

  const { data: logs = [], isLoading: lLoading } = useQuery<NotifLog[]>({
    queryKey: ['notifications', 'log'],
    queryFn: () => api.get('/notifications/log').then((r: any) => r.data),
    enabled: activeTab === 'log',
  })

  const createTemplate = useMutation({
    mutationFn: (body: TemplateForm) => api.post('/notifications/templates', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications', 'templates'] }); closeDialog(); toast.success('Template created') },
    onError: (e: Error) => toast.error('Template created', { description: e.message }),
  })

  const updateTemplate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TemplateForm> }) =>
      api.put(`/notifications/templates/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications', 'templates'] }); closeDialog(); toast.success('Template updated') },
    onError: (e: Error) => toast.error('Template updated', { description: e.message }),
  })

  const toggleChannel = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/notifications/channels/${id}`, { is_enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications', 'channels'] }); toast.success('Channel setting updated') },
    onError: (e: Error) => toast.error('Channel setting updated', { description: e.message }),
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
      channel_type: t.channel_type as ChannelType,
      event_trigger: t.event_trigger,
      subject_template: t.subject_template ?? '',
      body_template: t.body_template,
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
    { key: 'templates', label: 'Templates' },
    { key: 'channels', label: 'Channels' },
    { key: 'log', label: 'Delivery Log' },
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
                    <th className="text-left py-2 px-3 font-medium">Channel</th>
                    <th className="text-left py-2 px-3 font-medium">Event Trigger</th>
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
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {channelIcon(t.channel_type)}
                          {t.channel_type}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{t.event_trigger}</td>
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
                      <td className="py-2 px-3 text-foreground">{log.template_name ?? log.template_id}</td>
                      <td className="py-2 px-3 text-muted-foreground">{log.recipient_name ?? log.recipient_id}</td>
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {channelIcon(log.channel_type)}
                          {log.channel_type}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={logStatusBadge(log.status) as any}>
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
        <DialogContent className="max-w-lg">
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
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Channel Type *</label>
                <select
                  value={form.channel_type}
                  onChange={e => setForm(f => ({ ...f, channel_type: e.target.value as ChannelType }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                  required
                >
                  {CHANNEL_TYPES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Event Trigger *</label>
                <Input
                  value={form.event_trigger}
                  onChange={e => setForm(f => ({ ...f, event_trigger: e.target.value }))}
                  placeholder="e.g. leave.approved"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Subject Template (optional)</label>
              <Input
                value={form.subject_template}
                onChange={e => setForm(f => ({ ...f, subject_template: e.target.value }))}
                placeholder="e.g. Your leave has been {{status}}"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Body Template *</label>
              <textarea
                value={form.body_template}
                onChange={e => setForm(f => ({ ...f, body_template: e.target.value }))}
                placeholder="Hi {{employee_name}}, your leave request..."
                rows={4}
                required
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

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
