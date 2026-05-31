/**
 * OperationsWorkspace — /admin/operations
 *
 * Unified workspace for all operational systems.
 * Evolved into a WORKFORCE OPERATIONS NOC:
 *
 *   Command Header  → active incidents, job failures, queue pressure,
 *                     SLA breaches, pending escalations, observability alerts
 *
 *   Intelligence Panel → incident clusters, escalation risks, queue overflow,
 *                        integration failures, compliance risks,
 *                        onboarding failures, payroll blockers from ops
 *
 *   Operations Timeline → incident opened, SLA breached, job failed,
 *                         escalation triggered, integration error, alert fired
 *
 *   Tabs → Inbox · Incidents · Orchestration · Observability · Events
 *           Automations · Governance · Webhooks · Integrations
 */

import { lazy, Suspense, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Inbox, AlertTriangle, GitBranch, PlayCircle,
  Radio, Zap, Webhook, Layers,
  Activity, ShieldAlert, XCircle, Clock, Bell,
} from 'lucide-react'

import { WorkspaceShell }           from '@/components/workspace/WorkspaceShell'
import { WorkspaceCommandHeader }   from '@/components/workspace/WorkspaceCommandHeader'
import { OperationalMetricChip }    from '@/components/workspace/OperationalMetricChip'
import { IntelligencePanel }        from '@/components/workspace/IntelligencePanel'
import { OperationalTimeline }      from '@/components/workspace/OperationalTimeline'
import type { InsightGroup }        from '@/components/workspace/IntelligencePanel'
import type { TimelineEvent }       from '@/components/workspace/OperationalTimeline'
import { api }                      from '@/lib/api/client'

// ── Lazy tab contents ──────────────────────────────────────────────────────────
const OperationalInbox     = lazy(() => import('@/pages/notifications/OperationalInbox').then(m => ({ default: m.OperationalInbox })))
const IncidentManagement   = lazy(() => import('@/pages/system/IncidentManagement').then(m => ({ default: m.IncidentManagement })))
const OrchestrationConsole = lazy(() => import('@/pages/system/OrchestrationConsole').then(m => ({ default: m.OrchestrationConsole })))
const AutomationsConsole   = lazy(() => import('@/pages/system/AutomationsConsole').then(m => ({ default: m.AutomationsConsole })))
const ObservabilityConsole = lazy(() => import('@/pages/system/ObservabilityConsole').then(m => ({ default: m.ObservabilityConsole })))
const EventGovernance      = lazy(() => import('@/pages/system/EventGovernance').then(m => ({ default: m.EventGovernance })))
const WebhookManagement    = lazy(() => import('@/pages/system/WebhookManagement').then(m => ({ default: m.WebhookManagement })))
const IntegrationRegistry  = lazy(() => import('@/pages/system/IntegrationRegistry').then(m => ({ default: m.IntegrationRegistry })))
const GovernanceMatrix     = lazy(() => import('@/pages/approvals/GovernanceMatrix').then(m => ({ default: m.GovernanceMatrix })))

function TabLoader() {
  return (
    <div className="flex h-48 items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// ── Operational data types ─────────────────────────────────────────────────────

interface OpsHealth {
  active_incidents:     number  // open P1/P2 incidents
  job_failures:         number  // background job failures in last hour
  queue_pressure:       number  // jobs in backlog beyond normal threshold
  sla_breaches:         number  // SLA violations in current period
  pending_escalations:  number  // escalations awaiting action
  observability_alerts: number  // monitoring alerts fired
  inbox_pending:        number  // unactioned items in operational inbox
  integration_errors:   number  // failing third-party integrations
  webhook_failures:     number  // webhook delivery failures
}

// ── Command Header ─────────────────────────────────────────────────────────────

function OperationsCommandHeader() {
  const navigate = useNavigate()

  const { data: health, isLoading } = useQuery<OpsHealth>({
    queryKey:  ['ops-health'],
    queryFn:   () => api.get('/ops/health'),
    staleTime: 15_000,
    retry:     false,
  })

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  const criticalAlert = !isLoading && (health?.active_incidents ?? 0) > 0
    ? {
        message:     `${health!.active_incidents} active incident${health!.active_incidents === 1 ? '' : 's'} — operational continuity at risk.`,
        actionLabel: 'View incidents',
        onAction:    () => goTab('incidents'),
        severity:    'critical' as const,
      }
    : !isLoading && (health?.sla_breaches ?? 0) > 0
    ? {
        message:     `${health!.sla_breaches} SLA breach${health!.sla_breaches === 1 ? '' : 'es'} detected in the current period.`,
        actionLabel: 'Review breaches',
        onAction:    () => goTab('incidents'),
        severity:    'warning' as const,
      }
    : undefined

  return (
    <WorkspaceCommandHeader
      alert={criticalAlert}
      loading={isLoading}
      metrics={
        <>
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.active_incidents ?? 0)}
            label="Active Incidents"
            severity={(health?.active_incidents ?? 0) > 0 ? 'critical' : 'success'}
            icon={XCircle}
            onClick={() => goTab('incidents')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.job_failures ?? 0)}
            label="Job Failures"
            severity={(health?.job_failures ?? 0) > 0 ? 'critical' : 'success'}
            icon={AlertTriangle}
            sub="last hour"
            onClick={() => goTab('orchestration')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.sla_breaches ?? 0)}
            label="SLA Breaches"
            severity={(health?.sla_breaches ?? 0) > 0 ? 'warning' : 'success'}
            icon={Clock}
            onClick={() => goTab('incidents')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.pending_escalations ?? 0)}
            label="Escalations"
            severity={(health?.pending_escalations ?? 0) > 0 ? 'warning' : 'neutral'}
            icon={Bell}
            onClick={() => goTab('incidents')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.observability_alerts ?? 0)}
            label="Alerts"
            severity={(health?.observability_alerts ?? 0) > 0 ? 'warning' : 'success'}
            icon={Radio}
            onClick={() => goTab('observability')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.integration_errors ?? 0)}
            label="Integration Errors"
            severity={(health?.integration_errors ?? 0) > 0 ? 'warning' : 'success'}
            icon={Webhook}
            onClick={() => goTab('integrations')}
          />
          {/* Separator */}
          <div className="w-px h-8 bg-border/50 flex-shrink-0 mx-1" />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.inbox_pending ?? 0)}
            label="Inbox Pending"
            severity={(health?.inbox_pending ?? 0) > 10 ? 'warning' : 'neutral'}
            icon={Inbox}
            compact
            onClick={() => goTab('inbox')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (health?.queue_pressure ?? 0)}
            label="Queue Pressure"
            severity={(health?.queue_pressure ?? 0) > 50 ? 'warning' : 'neutral'}
            icon={GitBranch}
            compact
            onClick={() => goTab('orchestration')}
          />
        </>
      }
    />
  )
}

// ── Intelligence Panel ─────────────────────────────────────────────────────────

function OperationsIntelligencePanelContent() {
  const navigate = useNavigate()

  const { data: health, isLoading } = useQuery<OpsHealth>({
    queryKey:  ['ops-health'],
    queryFn:   () => api.get('/ops/health'),
    staleTime: 15_000,
    retry:     false,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<{
    data: Array<{
      id: string; event_type: string; source: string;
      timestamp: string; severity: string; detail: string;
    }>
  }>({
    queryKey:  ['ops-operational-events'],
    queryFn:   () => api.get('/ops/events?limit=15'),
    staleTime: 15_000,
    retry:     false,
  })

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  const groups: InsightGroup[] = useMemo(() => {
    const incidentItems    = []
    const infrastructureItems = []
    const integrationItems = []

    if ((health?.active_incidents ?? 0) > 0) {
      incidentItems.push({
        id:          'incidents',
        title:       'Active incidents',
        description: 'Open P1/P2 incidents requiring immediate action',
        severity:    'critical' as const,
        count:       health!.active_incidents,
        action:      'Resolve incidents',
        onAction:    () => goTab('incidents'),
      })
    }
    if ((health?.sla_breaches ?? 0) > 0) {
      incidentItems.push({
        id:          'sla',
        title:       'SLA breaches detected',
        description: 'Service level agreements violated in current period',
        severity:    'critical' as const,
        count:       health!.sla_breaches,
        action:      'Review SLA',
        onAction:    () => goTab('incidents'),
      })
    }
    if ((health?.pending_escalations ?? 0) > 0) {
      incidentItems.push({
        id:          'escalations',
        title:       'Pending escalations',
        description: 'Incidents escalated awaiting senior action',
        severity:    'warning' as const,
        count:       health!.pending_escalations,
        action:      'Take action',
        onAction:    () => goTab('incidents'),
      })
    }

    if ((health?.job_failures ?? 0) > 0) {
      infrastructureItems.push({
        id:          'job-failures',
        title:       'Background job failures',
        description: 'Scheduled jobs failed in the last hour',
        severity:    'critical' as const,
        count:       health!.job_failures,
        action:      'View jobs',
        onAction:    () => goTab('orchestration'),
      })
    }
    if ((health?.queue_pressure ?? 0) > 50) {
      infrastructureItems.push({
        id:          'queue',
        title:       'Job queue under pressure',
        description: 'Queue depth exceeding normal operational threshold',
        severity:    'warning' as const,
        count:       health!.queue_pressure,
        action:      'Scale workers',
        onAction:    () => goTab('orchestration'),
      })
    }
    if ((health?.observability_alerts ?? 0) > 0) {
      infrastructureItems.push({
        id:          'alerts',
        title:       'Observability alerts firing',
        description: 'Monitoring thresholds breached across modules',
        severity:    'warning' as const,
        count:       health!.observability_alerts,
        action:      'View alerts',
        onAction:    () => goTab('observability'),
      })
    }

    if ((health?.integration_errors ?? 0) > 0) {
      integrationItems.push({
        id:          'integrations',
        title:       'Integration failures',
        description: 'Third-party integrations returning errors',
        severity:    'warning' as const,
        count:       health!.integration_errors,
        action:      'View integrations',
        onAction:    () => goTab('integrations'),
      })
    }
    if ((health?.webhook_failures ?? 0) > 0) {
      integrationItems.push({
        id:          'webhooks',
        title:       'Webhook delivery failures',
        description: 'Outbound webhooks failing to deliver',
        severity:    'warning' as const,
        count:       health!.webhook_failures,
        action:      'Retry webhooks',
        onAction:    () => goTab('webhooks'),
      })
    }

    return [
      { id: 'incidents',      label: 'Incidents',      icon: XCircle,     items: incidentItems },
      { id: 'infrastructure', label: 'Infrastructure', icon: ShieldAlert,  items: infrastructureItems },
      { id: 'integrations',   label: 'Integrations',   icon: Webhook,     items: integrationItems },
    ]
  }, [health])

  const timeline: TimelineEvent[] = useMemo(() => {
    if (!events?.data?.length) return []
    return events.data.map(e => ({
      id:          e.id,
      title:       e.event_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: e.source ? `${e.source} · ${e.detail ?? ''}` : e.detail,
      timestamp:   e.timestamp,
      severity:    (e.severity as TimelineEvent['severity']) ?? 'neutral',
    }))
  }, [events?.data])

  return (
    <div className="flex flex-col h-full">
      <IntelligencePanel
        title="Operations NOC"
        groups={groups}
        loading={isLoading}
      />

      <div className="border-t border-border/50 px-3 pt-3 pb-4 flex-shrink-0">
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <Activity className="h-3 w-3 text-muted-foreground/60" />
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Live Events
          </p>
        </div>
        <OperationalTimeline
          events={timeline}
          loading={eventsLoading}
          maxItems={8}
        />
      </div>
    </div>
  )
}

// ── Workspace ──────────────────────────────────────────────────────────────────

export function OperationsWorkspace() {
  return (
    <WorkspaceShell
      title="Operations"
      subtitle="Inbox, incidents, orchestration, observability, and system health"
      breadcrumbs={[{ label: 'Admin' }, { label: 'Operations' }]}
      defaultTab="inbox"
      commandHeader={<OperationsCommandHeader />}
      rightPanel={<OperationsIntelligencePanelContent />}
      navGroups={[
        {
          id:    'operations',
          label: 'Operations',
          items: [
            {
              key:         'inbox',
              label:       'Inbox',
              icon:        Inbox,
              description: 'Unified operational inbox with pending actions',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <OperationalInbox />
                </Suspense>
              ),
            },
            {
              key:         'incidents',
              label:       'Incidents',
              icon:        AlertTriangle,
              description: 'Active incident tracking and resolution',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <IncidentManagement />
                </Suspense>
              ),
            },
            {
              key:         'orchestration',
              label:       'Orchestration',
              icon:        GitBranch,
              description: 'Worker registry, queue pressure, and job ownership',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <OrchestrationConsole />
                </Suspense>
              ),
            },
            {
              key:         'observability',
              label:       'Observability',
              icon:        Radio,
              description: 'Live event bus, job queue, and module health',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <ObservabilityConsole />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'automation',
          label: 'Automation',
          items: [
            {
              key:         'events',
              label:       'Events',
              icon:        Zap,
              description: 'Event log, retention rules, and replay queue',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <EventGovernance />
                </Suspense>
              ),
            },
            {
              key:         'automations',
              label:       'Automations',
              icon:        PlayCircle,
              description: 'Scheduled jobs and automation workflows',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AutomationsConsole />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'governance',
          label: 'Governance',
          items: [
            {
              key:         'governance',
              label:       'Approvals',
              icon:        Layers,
              description: 'Multi-level approval governance matrix',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <GovernanceMatrix />
                </Suspense>
              ),
            },
            {
              key:         'webhooks',
              label:       'Webhooks',
              icon:        Webhook,
              description: 'Webhook endpoint management and delivery logs',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <WebhookManagement />
                </Suspense>
              ),
            },
            {
              key:         'integrations',
              label:       'Integrations',
              icon:        Layers,
              description: 'Third-party integration registry',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <IntegrationRegistry />
                </Suspense>
              ),
            },
          ],
        },
      ]}
    />
  )
}
