/**
 * SecurityOpsWorkspace — /admin/security/ops
 *
 * Program 4: Security Operations Workspace.
 * Surfaces existing DB infrastructure as an operational workspace:
 *   – Security health KPIs (alerts, events)
 *   – Security event stream
 *   – Security alerts (acknowledge / investigate / resolve)
 *   – Detection rules catalog (enable/disable)
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, RefreshCw, AlertTriangle, CheckCircle2,
  Eye, Clock, Zap, Activity, ToggleLeft, ToggleRight,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SecurityHealth {
  alerts_30d: {
    total:         number
    open:          number
    critical_open: number
    high_open:     number
    resolved:      number
    avg_mtta_sec:  number | null
    avg_mttr_sec:  number | null
  }
  events_7d: {
    total:       number
    by_severity: Record<string, number>
  }
  detection_rules: {
    total:   number
    enabled: number
  }
}

interface SecurityEvent {
  id:          number
  event_type:  string
  severity:    string
  tenant_id:   string | null
  actor_id:    string | null
  actor_ip:    string | null
  target_type: string | null
  target_id:   string | null
  event_data:  Record<string, unknown>
  occurred_at: string
}

interface SecurityAlert {
  id:               string
  rule_name:        string
  severity:         string
  tenant_id:        string | null
  actor_id:         string | null
  triggered_at:     string
  trigger_count:    number
  trigger_window_s: number
  status:           string
  acknowledged_at:  string | null
  resolved_at:      string | null
  resolution_note:  string | null
  mtta_seconds:     number | null
  mttr_seconds:     number | null
}

interface DetectionRule {
  id:               string
  rule_name:        string
  description:      string
  severity:         string
  enabled:          boolean
  event_type_filter: string | null
  window_seconds:   number
  threshold:        number
  alert_channel:    string
  cooldown_seconds: number
  runbook_url:      string | null
}

// ── Severity configs ──────────────────────────────────────────────────────────

const SEV: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-50    text-red-700    border-red-200'    },
  high:     { label: 'High',     color: 'bg-orange-50 text-orange-700 border-orange-200' },
  medium:   { label: 'Medium',   color: 'bg-amber-50  text-amber-700  border-amber-200'  },
  low:      { label: 'Low',      color: 'bg-blue-50   text-blue-700   border-blue-200'   },
  info:     { label: 'Info',     color: 'bg-gray-100  text-gray-600   border-gray-200'   },
}

const ALERT_STATUS: Record<string, { label: string; color: string }> = {
  open:           { label: 'Open',          color: 'bg-red-50    text-red-700    border-red-200'    },
  acknowledged:   { label: 'Acknowledged',  color: 'bg-amber-50  text-amber-700  border-amber-200'  },
  investigating:  { label: 'Investigating', color: 'bg-blue-50   text-blue-700   border-blue-200'   },
  resolved:       { label: 'Resolved',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  false_positive: { label: 'False Positive', color: 'bg-gray-100 text-gray-600   border-gray-200'   },
}

function fmtSeconds(s: number | null) {
  if (s == null) return '—'
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SecurityOpsWorkspace() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('health')
  const [alertStatus,   setAlertStatus]   = useState('all')
  const [alertSeverity, setAlertSeverity] = useState('all')
  const [eventSeverity, setEventSeverity] = useState('all')
  const [updateModal,   setUpdateModal]   = useState<SecurityAlert | null>(null)
  const [updateForm,    setUpdateForm]    = useState({ status: '', resolution_note: '' })

  // ── Queries ────────────────────────────────────────────────────────────────

  const healthQ = useQuery<SecurityHealth>({
    queryKey: ['security-health'],
    queryFn:  () => api.get('/security/health'),
  })

  const eventParams = new URLSearchParams({ limit: '100' })
  if (eventSeverity !== 'all') eventParams.set('severity', eventSeverity)

  const eventsQ = useQuery<{ data: SecurityEvent[]; total: number }>({
    queryKey: ['security-events', eventSeverity],
    queryFn:  () => api.get(`/security/events?${eventParams}`),
    enabled:  tab === 'events',
  })

  const alertParams = new URLSearchParams({ limit: '100' })
  if (alertStatus   !== 'all') alertParams.set('status', alertStatus)
  if (alertSeverity !== 'all') alertParams.set('severity', alertSeverity)

  const alertsQ = useQuery<{ data: SecurityAlert[]; total: number }>({
    queryKey: ['security-alerts', alertStatus, alertSeverity],
    queryFn:  () => api.get(`/security/alerts?${alertParams}`),
    enabled:  tab === 'alerts',
  })

  const rulesQ = useQuery<{ data: DetectionRule[] }>({
    queryKey: ['security-rules'],
    queryFn:  () => api.get('/security/detection-rules'),
    enabled:  tab === 'rules',
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateAlertMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/security/alerts/${id}`, {
        status:          updateForm.status,
        resolution_note: updateForm.resolution_note || null,
      }),
    onSuccess: () => {
      toast.success('Alert updated')
      setUpdateModal(null)
      qc.invalidateQueries({ queryKey: ['security-alerts'] })
      qc.invalidateQueries({ queryKey: ['security-health'] })
    },
    onError: () => toast.error('Update failed'),
  })

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/security/detection-rules/${id}`, { enabled }),
    onSuccess: () => {
      toast.success('Rule updated')
      qc.invalidateQueries({ queryKey: ['security-rules'] })
      qc.invalidateQueries({ queryKey: ['security-health'] })
    },
    onError: () => toast.error('Update failed'),
  })

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['security-health'] })
    qc.invalidateQueries({ queryKey: ['security-events'] })
    qc.invalidateQueries({ queryKey: ['security-alerts'] })
    qc.invalidateQueries({ queryKey: ['security-rules'] })
  }

  const health = healthQ.data

  return (
    <PageContainer>
      <PageHeader
        title="Security Operations"
        subtitle="Security event stream, active alerts, and detection rule management"
        actions={
          <Button variant="ghost" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="health">Security Health</TabsTrigger>
          <TabsTrigger value="alerts">
            Alerts
            {health?.alerts_30d.open ? (
              <span className="ml-1.5 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {health.alerts_30d.open > 9 ? '9+' : health.alerts_30d.open}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="events">Event Stream</TabsTrigger>
          <TabsTrigger value="rules">Detection Rules</TabsTrigger>
        </TabsList>

        {/* ── Health Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="health">
          {healthQ.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
          ) : health ? (
            <div className="grid gap-4">
              <SectionCard title="Alerts (Last 30 Days)">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Open Alerts',    value: health.alerts_30d.open,          color: health.alerts_30d.open > 0          ? 'text-amber-600' : 'text-foreground' },
                    { label: 'Critical Open',  value: health.alerts_30d.critical_open, color: health.alerts_30d.critical_open > 0 ? 'text-red-600'   : 'text-foreground' },
                    { label: 'High Open',      value: health.alerts_30d.high_open,     color: health.alerts_30d.high_open > 0     ? 'text-orange-600': 'text-foreground' },
                    { label: 'Resolved',       value: health.alerts_30d.resolved,      color: 'text-emerald-600' },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg border p-3">
                      <p className={cn('text-2xl font-bold', k.color)}>{k.value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
                    </div>
                  ))}
                </div>
                {health.alerts_30d.critical_open > 0 && (
                  <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">
                      <strong>{health.alerts_30d.critical_open}</strong> critical alert{health.alerts_30d.critical_open > 1 ? 's require' : ' requires'} immediate attention.
                    </p>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Avg. Time to Acknowledge</p>
                    <p className="text-lg font-semibold mt-0.5">{fmtSeconds(health.alerts_30d.avg_mtta_sec)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Avg. Time to Resolve</p>
                    <p className="text-lg font-semibold mt-0.5">{fmtSeconds(health.alerts_30d.avg_mttr_sec)}</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Events (Last 7 Days)">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold">{health.events_7d.total}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Total Events</p>
                  </div>
                  {['critical','high','medium','low'].map(sev => (
                    <div key={sev} className="rounded-lg border p-3">
                      <p className={cn('text-2xl font-bold capitalize', SEV[sev]?.color.split(' ')[1]?.replace('text-', 'text-') ?? '')}>
                        {health.events_7d.by_severity[sev] ?? 0}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">{sev}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Detection Rules">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold text-emerald-600">{health.detection_rules.enabled}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Active Rules</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold">{health.detection_rules.total}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Total Rules</p>
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : null}
        </TabsContent>

        {/* ── Alerts Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="alerts">
          <SectionCard>
            <div className="flex gap-3 mb-4">
              <Select value={alertStatus} onValueChange={setAlertStatus}>
                <SelectTrigger className="h-8 text-sm w-36">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="false_positive">False Positive</SelectItem>
                </SelectContent>
              </Select>
              <Select value={alertSeverity} onValueChange={setAlertSeverity}>
                <SelectTrigger className="h-8 text-sm w-32">
                  <SelectValue placeholder="All severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {alertsQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (alertsQ.data?.data ?? []).length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/60 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No alerts found</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(alertsQ.data?.data ?? []).map(a => {
                  const sevMeta    = SEV[a.severity]
                  const statusMeta = ALERT_STATUS[a.status]
                  const isOpen     = a.status === 'open'
                  return (
                    <div key={a.id} className={cn('py-3.5 flex items-start gap-3', isOpen && a.severity === 'critical' && 'bg-red-50/30')}>
                      <div className={cn(
                        'mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0',
                        a.severity === 'critical' ? 'bg-red-100'    :
                        a.severity === 'high'     ? 'bg-orange-100' :
                        'bg-amber-100',
                      )}>
                        <ShieldAlert className={cn(
                          'h-3.5 w-3.5',
                          a.severity === 'critical' ? 'text-red-600'    :
                          a.severity === 'high'     ? 'text-orange-600' :
                          'text-amber-600',
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{a.rule_name}</span>
                          {sevMeta    && <Badge variant="outline" className={cn('text-[10px]', sevMeta.color)}>{sevMeta.label}</Badge>}
                          {statusMeta && <Badge variant="outline" className={cn('text-[10px]', statusMeta.color)}>{statusMeta.label}</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          <span>{a.trigger_count} event{a.trigger_count !== 1 ? 's' : ''} in {Math.round(a.trigger_window_s / 60)}m window</span>
                          <span>{format(new Date(a.triggered_at), 'dd MMM yyyy HH:mm')}</span>
                          {a.mtta_seconds != null && <span>MTTA: {fmtSeconds(a.mtta_seconds)}</span>}
                          {a.mttr_seconds != null && <span>MTTR: {fmtSeconds(a.mttr_seconds)}</span>}
                        </div>
                        {a.resolution_note && (
                          <p className="text-xs text-muted-foreground mt-0.5">{a.resolution_note}</p>
                        )}
                      </div>
                      {isOpen && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setUpdateModal(a); setUpdateForm({ status: 'acknowledged', resolution_note: '' }) }}
                        >
                          Acknowledge
                        </Button>
                      )}
                      {a.status === 'acknowledged' && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setUpdateModal(a); setUpdateForm({ status: 'resolved', resolution_note: '' }) }}
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Events Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="events">
          <SectionCard>
            <div className="flex gap-3 mb-4">
              <Select value={eventSeverity} onValueChange={setEventSeverity}>
                <SelectTrigger className="h-8 text-sm w-32">
                  <SelectValue placeholder="All severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {eventsQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (eventsQ.data?.data ?? []).length === 0 ? (
              <div className="py-12 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No security events</p>
              </div>
            ) : (
              <div className="divide-y divide-border font-mono text-xs">
                {(eventsQ.data?.data ?? []).map(e => {
                  const sm = SEV[e.severity]
                  return (
                    <div key={e.id} className="py-2.5 flex items-center gap-3">
                      <span className="text-muted-foreground w-36 flex-shrink-0">
                        {format(new Date(e.occurred_at), 'dd MMM HH:mm:ss')}
                      </span>
                      {sm && (
                        <Badge variant="outline" className={cn('text-[10px] w-16 justify-center flex-shrink-0', sm.color)}>
                          {sm.label}
                        </Badge>
                      )}
                      <span className="font-medium text-foreground flex-shrink-0">{e.event_type}</span>
                      {e.target_type && (
                        <span className="text-muted-foreground truncate">{e.target_type}{e.target_id ? `:${e.target_id.slice(0, 8)}` : ''}</span>
                      )}
                      {e.actor_ip && (
                        <span className="text-muted-foreground flex-shrink-0">{e.actor_ip}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Detection Rules Tab ───────────────────────────────────────────── */}
        <TabsContent value="rules">
          <SectionCard>
            {rulesQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (
              <div className="divide-y divide-border">
                {(rulesQ.data?.data ?? []).map(r => {
                  const sm = SEV[r.severity]
                  return (
                    <div key={r.id} className="py-3.5 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{r.rule_name}</p>
                          {sm && <Badge variant="outline" className={cn('text-[10px]', sm.color)}>{sm.label}</Badge>}
                          <Badge variant="outline" className={cn('text-[10px]', r.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200')}>
                            {r.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>Threshold: {r.threshold} events in {Math.round(r.window_seconds / 60)}m</span>
                          <span>Channel: {r.alert_channel}</span>
                          {r.event_type_filter && <span>Filter: {r.event_type_filter}</span>}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn('gap-1.5 flex-shrink-0', r.enabled ? 'text-emerald-600' : 'text-muted-foreground')}
                        onClick={() => toggleRuleMutation.mutate({ id: r.id, enabled: !r.enabled })}
                        disabled={toggleRuleMutation.isPending}
                      >
                        {r.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Update Alert Dialog */}
      <Dialog open={!!updateModal} onOpenChange={() => setUpdateModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Alert</DialogTitle></DialogHeader>
          {updateModal && (
            <div className="space-y-3 py-2">
              <p className="text-sm font-medium">{updateModal.rule_name}</p>
              <div>
                <Label>New Status</Label>
                <Select value={updateForm.status} onValueChange={v => setUpdateForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="false_positive">False Positive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Resolution Note</Label>
                <Input
                  className="mt-1"
                  value={updateForm.resolution_note}
                  onChange={e => setUpdateForm(f => ({ ...f, resolution_note: e.target.value }))}
                  placeholder="Describe the investigation or resolution..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateModal(null)}>Cancel</Button>
            <Button
              disabled={!updateForm.status || updateAlertMutation.isPending}
              onClick={() => updateModal && updateAlertMutation.mutate(updateModal.id)}
            >
              {updateAlertMutation.isPending ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
