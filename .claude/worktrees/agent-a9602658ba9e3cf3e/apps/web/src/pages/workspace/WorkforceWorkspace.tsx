/**
 * WorkforceWorkspace — /admin/workforce
 *
 * Unified workspace for all workforce operations.
 * Evolved into a WORKFORCE OPERATIONS COCKPIT:
 *
 *   Command Header  → onboarding throughput, pending reviews, SLA breaches,
 *                     duplicate risks, payroll activation backlog,
 *                     extraction confidence warnings
 *
 *   Intelligence Panel → risks, missing docs, duplicate PAN/UAN warnings,
 *                        bottlenecks, activation failures, compliance backlog
 *
 *   Onboarding Timeline → resume uploaded, PAN extracted, duplicate triggered,
 *                         payroll pending, ESS activated
 *
 *   Tabs → Employees · Onboarding · Imports · Reviews · Documents
 *           Analytics · Intelligence
 */

import { lazy, Suspense, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery }  from '@tanstack/react-query'
import {
  Users, UserPlus, FolderUp, TrendingUp, FileText,
  ClipboardCheck, Brain, AlertTriangle,
  ShieldAlert, UserCheck, CreditCard, FileWarning,
  Activity,
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
const EmployeeList        = lazy(() => import('@/pages/employees/EmployeeList').then(m => ({ default: m.EmployeeList })))
const OnboardingDashboard = lazy(() => import('@/pages/onboarding/OnboardingDashboard').then(m => ({ default: m.OnboardingDashboard })))
const ImportWorkspace     = lazy(() => import('@/pages/import/ImportWorkspace').then(m => ({ default: m.ImportWorkspace })))
const WorkforceAnalytics  = lazy(() => import('@/pages/attendance/WorkforceAnalytics').then(m => ({ default: m.WorkforceAnalytics })))
const Documents           = lazy(() => import('@/pages/documents/Documents').then(m => ({ default: m.Documents })))
const WorkforceIntelligence = lazy(() => import('@/pages/attendance/WorkforceIntelligence').then(m => ({ default: m.WorkforceIntelligence })))
const ApprovalInbox       = lazy(() => import('@/pages/attendance/ApprovalInbox').then(m => ({ default: m.ApprovalInbox })))

function TabLoader() {
  return (
    <div className="flex h-48 items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// ── Operational data types ─────────────────────────────────────────────────────

interface OnboardingStats {
  total_pending:       number
  hr_review_pending:   number
  sla_breached:        number
  duplicate_risk:      number
  payroll_backlog:     number
  confidence_warnings: number
  completed_today:     number
  throughput_7d:       number
}

interface WorkforceOverview {
  active_employees:    number
  pending_activations: number
  missing_compliance:  number
  missing_documents:   number
}

// ── Command Header component ───────────────────────────────────────────────────

function WorkforceCommandHeader() {
  const navigate = useNavigate()

  const { data: stats, isLoading: statsLoading } = useQuery<OnboardingStats>({
    queryKey:  ['workforce-onboarding-stats'],
    queryFn:   () => api.get('/onboarding/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  const { data: overview, isLoading: overviewLoading } = useQuery<WorkforceOverview>({
    queryKey:  ['workforce-overview'],
    queryFn:   () => api.get('/employees/overview'),
    staleTime: 60_000,
    retry:     false,
  })

  const loading = statsLoading || overviewLoading

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  const criticalAlert = !loading && (stats?.sla_breached ?? 0) > 0
    ? {
        message:     `${stats!.sla_breached} onboarding session${stats!.sla_breached === 1 ? '' : 's'} have breached SLA — immediate review required.`,
        actionLabel: 'Review now',
        onAction:    () => goTab('onboarding'),
        severity:    'critical' as const,
      }
    : undefined

  return (
    <WorkspaceCommandHeader
      alert={criticalAlert}
      loading={loading}
      metrics={
        <>
          <OperationalMetricChip
            value={loading ? '—' : (stats?.total_pending ?? 0)}
            label="Pending Onboarding"
            severity={(stats?.total_pending ?? 0) > 5 ? 'warning' : 'neutral'}
            icon={UserPlus}
            sub={stats?.throughput_7d !== undefined ? `${stats.throughput_7d} completed this week` : undefined}
            onClick={() => goTab('onboarding')}
          />
          <OperationalMetricChip
            value={loading ? '—' : (stats?.hr_review_pending ?? 0)}
            label="HR Reviews Pending"
            severity={(stats?.hr_review_pending ?? 0) > 0 ? 'warning' : 'success'}
            icon={ClipboardCheck}
            onClick={() => goTab('reviews')}
          />
          <OperationalMetricChip
            value={loading ? '—' : (stats?.sla_breached ?? 0)}
            label="SLA Breaches"
            severity={(stats?.sla_breached ?? 0) > 0 ? 'critical' : 'success'}
            icon={AlertTriangle}
            onClick={() => goTab('onboarding')}
          />
          <OperationalMetricChip
            value={loading ? '—' : (stats?.duplicate_risk ?? 0)}
            label="Duplicate Risks"
            severity={(stats?.duplicate_risk ?? 0) > 0 ? 'critical' : 'success'}
            icon={ShieldAlert}
            onClick={() => goTab('onboarding')}
          />
          <OperationalMetricChip
            value={loading ? '—' : (stats?.payroll_backlog ?? 0)}
            label="Payroll Activation"
            severity={(stats?.payroll_backlog ?? 0) > 3 ? 'warning' : 'neutral'}
            icon={CreditCard}
            onClick={() => goTab('onboarding')}
          />
          <OperationalMetricChip
            value={loading ? '—' : (stats?.confidence_warnings ?? 0)}
            label="Confidence Warnings"
            severity={(stats?.confidence_warnings ?? 0) > 0 ? 'warning' : 'success'}
            icon={FileWarning}
            onClick={() => goTab('onboarding')}
          />
          {/* Separator */}
          <div className="w-px h-8 bg-border/50 flex-shrink-0 mx-1" />
          <OperationalMetricChip
            value={loading ? '—' : (overview?.active_employees ?? 0)}
            label="Active Employees"
            severity="neutral"
            icon={Users}
            compact
          />
          <OperationalMetricChip
            value={loading ? '—' : (overview?.missing_compliance ?? 0)}
            label="Missing Compliance"
            severity={(overview?.missing_compliance ?? 0) > 0 ? 'warning' : 'neutral'}
            icon={FileWarning}
            compact
            onClick={() => goTab('employees')}
          />
        </>
      }
    />
  )
}

// ── Intelligence Panel ─────────────────────────────────────────────────────────

function WorkforceIntelligencePanelContent() {
  const navigate = useNavigate()

  const { data: stats, isLoading } = useQuery<OnboardingStats>({
    queryKey:  ['workforce-onboarding-stats'],
    queryFn:   () => api.get('/onboarding/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<{
    data: Array<{
      id: string; event_type: string; session_id: string;
      employee_name: string; timestamp: string; severity: string; detail: string;
    }>
  }>({
    queryKey:  ['workforce-operational-events'],
    queryFn:   () => api.get('/onboarding/events?limit=15'),
    staleTime: 20_000,
    retry:     false,
  })

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  // Build insight groups from live data (graceful on missing endpoints)
  const groups: InsightGroup[] = useMemo(() => {
    const riskItems = []
    const bottleneckItems = []
    const activationItems = []

    if ((stats?.duplicate_risk ?? 0) > 0) {
      riskItems.push({
        id:          'dup-risk',
        title:       'Duplicate PAN / UAN risk',
        description: 'Multiple sessions share identity documents',
        severity:    'critical' as const,
        count:       stats!.duplicate_risk,
        action:      'Review duplicates',
        onAction:    () => goTab('onboarding'),
      })
    }
    if ((stats?.confidence_warnings ?? 0) > 0) {
      riskItems.push({
        id:          'confidence',
        title:       'Low extraction confidence',
        description: 'AI confidence below threshold — manual verification needed',
        severity:    'warning' as const,
        count:       stats!.confidence_warnings,
        action:      'Review sessions',
        onAction:    () => goTab('onboarding'),
      })
    }
    if ((stats?.sla_breached ?? 0) > 0) {
      riskItems.push({
        id:          'sla',
        title:       'SLA breach detected',
        description: `${stats!.sla_breached} session(s) exceeded processing SLA`,
        severity:    'critical' as const,
        count:       stats!.sla_breached,
        action:      'Escalate now',
        onAction:    () => goTab('onboarding'),
      })
    }

    if ((stats?.hr_review_pending ?? 0) > 0) {
      bottleneckItems.push({
        id:          'hr-review',
        title:       'HR review queue backed up',
        description: `${stats!.hr_review_pending} sessions awaiting HR decision`,
        severity:    'warning' as const,
        count:       stats!.hr_review_pending,
        action:      'Go to Reviews',
        onAction:    () => goTab('reviews'),
      })
    }

    if ((stats?.payroll_backlog ?? 0) > 0) {
      activationItems.push({
        id:          'payroll-backlog',
        title:       'Payroll setup pending',
        description: 'Employees activated but not mapped to salary structure',
        severity:    'warning' as const,
        count:       stats!.payroll_backlog,
        action:      'Complete setup',
        onAction:    () => goTab('employees'),
      })
    }

    return [
      { id: 'risks',       label: 'Risks',       icon: ShieldAlert,  items: riskItems },
      { id: 'bottlenecks', label: 'Bottlenecks', icon: AlertTriangle, items: bottleneckItems },
      { id: 'activation',  label: 'Activation',  icon: UserCheck,    items: activationItems },
    ]
  }, [stats])

  // Build timeline from API events or use placeholder structure
  const timeline: TimelineEvent[] = useMemo(() => {
    if (!events?.data?.length) return []
    return events.data.map(e => ({
      id:          e.id,
      title:       e.event_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: e.employee_name ? `${e.employee_name} · ${e.detail ?? ''}` : e.detail,
      timestamp:   e.timestamp,
      severity:    (e.severity as TimelineEvent['severity']) ?? 'neutral',
    }))
  }, [events?.data])

  return (
    <div className="flex flex-col h-full">
      <IntelligencePanel
        title="Workforce Intelligence"
        groups={groups}
        loading={isLoading}
      />

      {/* Onboarding Timeline */}
      <div className="border-t border-border/50 px-3 pt-3 pb-4 flex-shrink-0">
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <Activity className="h-3 w-3 text-muted-foreground/60" />
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Recent Events
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

export function WorkforceWorkspace() {
  return (
    <WorkspaceShell
      title="Workforce"
      subtitle="Employee management, onboarding intelligence, and workforce operations"
      breadcrumbs={[{ label: 'Admin' }, { label: 'Workforce' }]}
      defaultTab="employees"
      commandHeader={<WorkforceCommandHeader />}
      rightPanel={<WorkforceIntelligencePanelContent />}
      navGroups={[
        {
          id:    'workforce',
          label: 'Workforce',
          items: [
            {
              key:         'employees',
              label:       'Employees',
              icon:        Users,
              description: 'Employee directory and profiles',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <EmployeeList />
                </Suspense>
              ),
            },
            {
              key:         'onboarding',
              label:       'Onboarding',
              icon:        UserPlus,
              description: 'AI-assisted employee onboarding pipeline',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <OnboardingDashboard />
                </Suspense>
              ),
            },
            {
              key:         'reviews',
              label:       'Reviews',
              icon:        ClipboardCheck,
              description: 'Pending approvals and HR action queue',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <ApprovalInbox />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'data',
          label: 'Data',
          items: [
            {
              key:         'documents',
              label:       'Documents',
              icon:        FileText,
              description: 'Employee document vault',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <Documents />
                </Suspense>
              ),
            },
            {
              key:         'imports',
              label:       'Imports',
              icon:        FolderUp,
              description: 'Bulk master data and employee imports',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <ImportWorkspace />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'intelligence',
          label: 'Intelligence',
          items: [
            {
              key:         'analytics',
              label:       'Analytics',
              icon:        TrendingUp,
              description: 'Workforce composition and headcount analytics',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <WorkforceAnalytics />
                </Suspense>
              ),
            },
            {
              key:         'intelligence',
              label:       'Intelligence',
              icon:        Brain,
              description: 'AI-powered workforce risk and insights',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <WorkforceIntelligence />
                </Suspense>
              ),
            },
          ],
        },
      ]}
    />
  )
}
