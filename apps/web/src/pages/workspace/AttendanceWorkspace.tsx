/**
 * AttendanceWorkspace — /admin/attendance-workspace
 *
 * Unified workspace for all attendance operations.
 * Evolved into an ATTENDANCE OPERATIONS CENTER:
 *
 *   Command Header  → anomaly pressure, unresolved corrections,
 *                     staffing pressure, overnight shift issues,
 *                     confidence risks, recompute backlog
 *
 *   Intelligence Panel → anomaly clusters, correction bottlenecks,
 *                        staffing risk zones, overnight incidents,
 *                        attendance → payroll continuity gaps
 *
 *   Attendance Timeline → processing run, anomaly flagged, correction approved,
 *                         recompute triggered, payroll continuity issue detected
 *
 *   Tabs → Dashboard · Muster · Corrections · Regularisation · Forensics
 *           Anomalies · Intelligence · Risks · Exceptions · Policies · Operations · Audit
 */

import { lazy, Suspense, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart2, Grid3X3, ClipboardEdit, ClipboardCheck,
  Target, AlertTriangle, Brain, ShieldAlert, Layers,
  ShieldCheck, Zap, FileSearch, Users, RefreshCw,
  Activity, TrendingDown, Clock,
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
const Attendance             = lazy(() => import('@/pages/attendance/Attendance').then(m => ({ default: m.Attendance })))
const MusterRoll             = lazy(() => import('@/pages/attendance/MusterRoll').then(m => ({ default: m.MusterRoll })))
const AttendanceCorrections  = lazy(() => import('@/pages/attendance/AttendanceCorrections').then(m => ({ default: m.AttendanceCorrections })))
const RegularisationApproval = lazy(() => import('@/pages/attendance/RegularisationApproval').then(m => ({ default: m.RegularisationApproval })))
const AttendanceTimeline     = lazy(() => import('@/pages/attendance/AttendanceTimeline').then(m => ({ default: m.AttendanceTimeline })))
const AttendanceAnomalies    = lazy(() => import('@/pages/attendance/AttendanceAnomalies').then(m => ({ default: m.AttendanceAnomalies })))
const WorkforceIntelligence  = lazy(() => import('@/pages/attendance/WorkforceIntelligence').then(m => ({ default: m.WorkforceIntelligence })))
const AttendanceRisk         = lazy(() => import('@/pages/attendance/AttendanceRisk').then(m => ({ default: m.AttendanceRisk })))
const ExceptionGovernance    = lazy(() => import('@/pages/attendance/ExceptionGovernance').then(m => ({ default: m.ExceptionGovernance })))
const AttendancePolicy       = lazy(() => import('@/pages/attendance/AttendancePolicy').then(m => ({ default: m.AttendancePolicy })))
const OperationalHealth      = lazy(() => import('@/pages/attendance/OperationalHealth').then(m => ({ default: m.OperationalHealth })))
const AttendanceAudit        = lazy(() => import('@/pages/attendance/AttendanceAudit').then(m => ({ default: m.AttendanceAudit })))

function TabLoader() {
  return (
    <div className="flex h-48 items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// ── Operational data types ─────────────────────────────────────────────────────

interface AttendanceStats {
  unresolved_anomalies:    number  // flagged anomalies pending review
  pending_corrections:     number  // correction requests awaiting approval
  staffing_pressure:       number  // employees below minimum staffing threshold
  overnight_issues:        number  // overnight shift incidents / incomplete punches
  confidence_warnings:     number  // AI confidence below threshold
  recompute_backlog:       number  // employees with stale/queued recompute
  payroll_continuity_gaps: number  // attendance→payroll data gaps detected
  is_processing:           boolean // attendance processing currently running
}

// ── Command Header ─────────────────────────────────────────────────────────────

function AttendanceCommandHeader() {
  const navigate = useNavigate()

  const { data: stats, isLoading } = useQuery<AttendanceStats>({
    queryKey:  ['attendance-ops-stats'],
    queryFn:   () => api.get('/attendance/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  const criticalAlert = !isLoading && (stats?.payroll_continuity_gaps ?? 0) > 0
    ? {
        message:     `${stats!.payroll_continuity_gaps} attendance → payroll continuity gap${stats!.payroll_continuity_gaps === 1 ? '' : 's'} detected — payroll accuracy at risk.`,
        actionLabel: 'Investigate',
        onAction:    () => goTab('anomalies'),
        severity:    'critical' as const,
      }
    : !isLoading && stats?.is_processing
    ? {
        message:     'Attendance processing is currently running — data may be in flux.',
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
            value={isLoading ? '—' : (stats?.unresolved_anomalies ?? 0)}
            label="Unresolved Anomalies"
            severity={(stats?.unresolved_anomalies ?? 0) > 0 ? 'critical' : 'success'}
            icon={AlertTriangle}
            onClick={() => goTab('anomalies')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.pending_corrections ?? 0)}
            label="Pending Corrections"
            severity={(stats?.pending_corrections ?? 0) > 0 ? 'warning' : 'success'}
            icon={ClipboardEdit}
            onClick={() => goTab('corrections')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.overnight_issues ?? 0)}
            label="Overnight Issues"
            severity={(stats?.overnight_issues ?? 0) > 0 ? 'warning' : 'success'}
            icon={Clock}
            onClick={() => goTab('anomalies')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.confidence_warnings ?? 0)}
            label="Confidence Risks"
            severity={(stats?.confidence_warnings ?? 0) > 0 ? 'warning' : 'success'}
            icon={ShieldAlert}
            onClick={() => goTab('intelligence')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.recompute_backlog ?? 0)}
            label="Recompute Backlog"
            severity={(stats?.recompute_backlog ?? 0) > 5 ? 'warning' : 'neutral'}
            icon={RefreshCw}
            onClick={() => goTab('operations')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.payroll_continuity_gaps ?? 0)}
            label="Payroll Gaps"
            severity={(stats?.payroll_continuity_gaps ?? 0) > 0 ? 'critical' : 'success'}
            icon={TrendingDown}
            onClick={() => goTab('anomalies')}
          />
          {/* Separator */}
          <div className="w-px h-8 bg-border/50 flex-shrink-0 mx-1" />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.staffing_pressure ?? 0)}
            label="Staffing Pressure"
            severity={(stats?.staffing_pressure ?? 0) > 0 ? 'warning' : 'neutral'}
            icon={Users}
            compact
            onClick={() => goTab('risks')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.is_processing ? 'Running' : 'Idle')}
            label="Processor"
            severity={stats?.is_processing ? 'info' : 'neutral'}
            icon={Zap}
            compact
            onClick={() => goTab('operations')}
          />
        </>
      }
    />
  )
}

// ── Intelligence Panel ─────────────────────────────────────────────────────────

function AttendanceIntelligencePanelContent() {
  const navigate = useNavigate()

  const { data: stats, isLoading } = useQuery<AttendanceStats>({
    queryKey:  ['attendance-ops-stats'],
    queryFn:   () => api.get('/attendance/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<{
    data: Array<{
      id: string; event_type: string; employee_name: string;
      timestamp: string; severity: string; detail: string;
    }>
  }>({
    queryKey:  ['attendance-operational-events'],
    queryFn:   () => api.get('/attendance/events?limit=15'),
    staleTime: 20_000,
    retry:     false,
  })

  const goTab = useCallback((tab: string) => {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }, [navigate])

  const groups: InsightGroup[] = useMemo(() => {
    const anomalyItems      = []
    const correctionItems   = []
    const continuityItems   = []

    if ((stats?.unresolved_anomalies ?? 0) > 0) {
      anomalyItems.push({
        id:          'anomalies',
        title:       'Unresolved attendance anomalies',
        description: 'System-flagged records requiring HR review',
        severity:    'critical' as const,
        count:       stats!.unresolved_anomalies,
        action:      'Review anomalies',
        onAction:    () => goTab('anomalies'),
      })
    }
    if ((stats?.overnight_issues ?? 0) > 0) {
      anomalyItems.push({
        id:          'overnight',
        title:       'Overnight shift incidents',
        description: 'Incomplete punches or schedule violations on night shifts',
        severity:    'warning' as const,
        count:       stats!.overnight_issues,
        action:      'Review incidents',
        onAction:    () => goTab('forensics'),
      })
    }
    if ((stats?.confidence_warnings ?? 0) > 0) {
      anomalyItems.push({
        id:          'confidence',
        title:       'AI confidence warnings',
        description: 'Attendance records with low detection confidence',
        severity:    'warning' as const,
        count:       stats!.confidence_warnings,
        action:      'Review warnings',
        onAction:    () => goTab('intelligence'),
      })
    }

    if ((stats?.pending_corrections ?? 0) > 0) {
      correctionItems.push({
        id:          'corrections',
        title:       'Correction requests pending',
        description: 'Employee-submitted corrections awaiting HR approval',
        severity:    'warning' as const,
        count:       stats!.pending_corrections,
        action:      'Approve corrections',
        onAction:    () => goTab('corrections'),
      })
    }
    if ((stats?.recompute_backlog ?? 0) > 0) {
      correctionItems.push({
        id:          'recompute',
        title:       'Recompute backlog',
        description: 'Employees with stale attendance calculations',
        severity:    'warning' as const,
        count:       stats!.recompute_backlog,
        action:      'Trigger recompute',
        onAction:    () => goTab('operations'),
      })
    }

    if ((stats?.payroll_continuity_gaps ?? 0) > 0) {
      continuityItems.push({
        id:          'payroll-gaps',
        title:       'Attendance → Payroll gaps',
        description: 'Attendance data doesn\'t match payroll inputs for some employees',
        severity:    'critical' as const,
        count:       stats!.payroll_continuity_gaps,
        action:      'Investigate gaps',
        onAction:    () => goTab('anomalies'),
      })
    }
    if ((stats?.staffing_pressure ?? 0) > 0) {
      continuityItems.push({
        id:          'staffing',
        title:       'Staffing pressure zones',
        description: 'Departments below minimum staffing threshold',
        severity:    'warning' as const,
        count:       stats!.staffing_pressure,
        action:      'View risk zones',
        onAction:    () => goTab('risks'),
      })
    }

    return [
      { id: 'anomalies',   label: 'Anomalies',   icon: AlertTriangle, items: anomalyItems },
      { id: 'corrections', label: 'Corrections',  icon: ClipboardEdit, items: correctionItems },
      { id: 'continuity',  label: 'Continuity',   icon: TrendingDown,  items: continuityItems },
    ]
  }, [stats, goTab])

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
        title="Attendance Intelligence"
        groups={groups}
        loading={isLoading}
      />

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

export function AttendanceWorkspace() {
  return (
    <WorkspaceShell
      title="Attendance"
      subtitle="Processing, corrections, forensics, and attendance intelligence"
      breadcrumbs={[{ label: 'Admin' }, { label: 'Attendance' }]}
      defaultTab="muster"
      commandHeader={<AttendanceCommandHeader />}
      rightPanel={<AttendanceIntelligencePanelContent />}
      navGroups={[
        {
          id:    'operations',
          label: 'Operations',
          items: [
            {
              key:         'muster',
              label:       'Muster Roll',
              icon:        Grid3X3,
              description: 'Monthly attendance register across all employees',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <MusterRoll />
                </Suspense>
              ),
            },
            {
              key:         'corrections',
              label:       'Corrections',
              icon:        ClipboardEdit,
              description: 'Review and approve attendance correction requests',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AttendanceCorrections />
                </Suspense>
              ),
            },
            {
              key:         'regularisation',
              label:       'Regularisation',
              icon:        ClipboardCheck,
              description: 'Attendance regularisation approvals',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <RegularisationApproval />
                </Suspense>
              ),
            },
            {
              key:         'exceptions',
              label:       'Exceptions',
              icon:        Layers,
              description: 'Exception governance and override management',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <ExceptionGovernance />
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
              key:         'anomalies',
              label:       'Anomalies',
              icon:        AlertTriangle,
              description: 'System-flagged attendance anomalies',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AttendanceAnomalies />
                </Suspense>
              ),
            },
            {
              key:         'forensics',
              label:       'Forensics',
              icon:        Target,
              description: 'Deep-dive per-employee forensic timeline',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AttendanceTimeline />
                </Suspense>
              ),
            },
            {
              key:         'risks',
              label:       'Risks',
              icon:        ShieldAlert,
              description: 'Attendance risk heatmaps and early warnings',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AttendanceRisk />
                </Suspense>
              ),
            },
            {
              key:         'intelligence',
              label:       'Intelligence',
              icon:        Brain,
              description: 'AI-powered attendance risk and insights',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <WorkforceIntelligence />
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
              key:         'policies',
              label:       'Policies',
              icon:        ShieldCheck,
              description: 'Attendance policy configuration',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AttendancePolicy />
                </Suspense>
              ),
            },
            {
              key:         'audit',
              label:       'Audit Log',
              icon:        FileSearch,
              description: 'Full audit trail of attendance record changes',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AttendanceAudit />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'system',
          label: 'System',
          items: [
            {
              key:         'dashboard',
              label:       'Processing',
              icon:        BarChart2,
              description: 'Attendance processing dashboard and run control',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <Attendance />
                </Suspense>
              ),
            },
            {
              key:         'operations',
              label:       'Health',
              icon:        Zap,
              description: 'Processing status and operational health',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <OperationalHealth />
                </Suspense>
              ),
            },
          ],
        },
      ]}
    />
  )
}
