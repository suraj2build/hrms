/**
 * AttendanceOperationsCenter — /admin/attendance/center
 *
 * Standalone fullscreen operational overview for the Attendance domain.
 * Replaces the workspace command header without reintroducing workspace navigation.
 *
 * Layout:
 *   PageHeader
 *   WorkspaceCommandHeader (KPI chips strip)
 *   Two-column content:
 *     Left  → grouped insight cards + quick-action navigation grid
 *     Right → recent operational events timeline
 */

import { useMemo }    from 'react'
import { useQuery }   from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ClipboardEdit, Clock, ShieldAlert,
  RefreshCw, TrendingDown, Users, Zap, Activity,
  BarChart2, Target, FileSearch, ShieldCheck, Brain,
  ClipboardCheck, Layers, Grid3X3,
} from 'lucide-react'

import { PageContainer }             from '@/components/layout/PageContainer'
import { PageHero }                  from '@/components/layout/PageHero'
import { SectionCard }               from '@/components/layout/SectionCard'
import { WorkspaceCommandHeader }    from '@/components/workspace/WorkspaceCommandHeader'
import { OperationalMetricChip }     from '@/components/workspace/OperationalMetricChip'
import { IntelligencePanel }         from '@/components/workspace/IntelligencePanel'
import { OperationalTimeline }       from '@/components/workspace/OperationalTimeline'
import type { InsightGroup }         from '@/components/workspace/IntelligencePanel'
import type { TimelineEvent }        from '@/components/workspace/OperationalTimeline'
import { Button }                    from '@/components/ui/button'
import { api }                       from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttendanceStats {
  unresolved_anomalies:    number
  pending_corrections:     number
  staffing_pressure:       number
  overnight_issues:        number
  confidence_warnings:     number
  recompute_backlog:       number
  payroll_continuity_gaps: number
  is_processing:           boolean
}

// ── Quick-action cards ─────────────────────────────────────────────────────────

interface QuickAction {
  label:       string
  description: string
  href:        string
  icon:        React.ComponentType<{ className?: string }>
  accent?:     'warning' | 'destructive' | 'success' | 'neutral'
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Muster Roll',      description: 'Month-view attendance grid',           href: '/admin/attendance/muster',            icon: Grid3X3,       accent: 'neutral'     },
  { label: 'Corrections',      description: 'Pending correction requests',          href: '/admin/attendance/corrections',        icon: ClipboardEdit, accent: 'warning'     },
  { label: 'Regularisation',   description: 'HR approval queue',                   href: '/admin/attendance/regularisation',     icon: ClipboardCheck,accent: 'warning'     },
  { label: 'Anomalies',        description: 'Flagged attendance anomalies',         href: '/admin/attendance/anomalies',          icon: AlertTriangle, accent: 'destructive' },
  { label: 'Exceptions',       description: 'Exception governance & rules',         href: '/admin/attendance/exceptions',         icon: ShieldAlert,   accent: 'warning'     },
  { label: 'Forensics',        description: 'Timeline deep-dive investigator',      href: '/admin/attendance/forensics',          icon: Target,        accent: 'neutral'     },
  { label: 'Risk Profiles',    description: 'Per-employee risk heatmap',           href: '/admin/attendance/risk',              icon: TrendingDown,  accent: 'warning'     },
  { label: 'Intelligence',     description: 'AI-powered workforce insights',        href: '/admin/intelligence',                  icon: Brain,         accent: 'neutral'     },
  { label: 'Confidence',       description: 'AI extraction confidence review',      href: '/admin/attendance/confidence',         icon: Activity,      accent: 'neutral'     },
  { label: 'Op. Health',       description: 'Operational health dashboard',         href: '/admin/operational-health',            icon: Zap,           accent: 'neutral'     },
  { label: 'Audit Log',        description: 'Full attendance audit trail',          href: '/admin/attendance/audit',              icon: FileSearch,    accent: 'neutral'     },
  { label: 'Policy',           description: 'Attendance policy configuration',      href: '/admin/attendance/policy',            icon: ShieldCheck,   accent: 'neutral'     },
  { label: 'Analytics',        description: 'Workforce composition analytics',      href: '/admin/analytics/workforce',          icon: BarChart2,     accent: 'neutral'     },
  { label: 'Policy Conflicts', description: 'Inter-policy conflict detection',      href: '/admin/attendance/policy-conflicts',  icon: Layers,        accent: 'warning'     },
]

const ACCENT_CLASSES = {
  warning:     'border-warning/20 bg-warning/[0.04] hover:bg-warning/[0.08]',
  destructive: 'border-destructive/20 bg-destructive/[0.04] hover:bg-destructive/[0.08]',
  success:     'border-success/20 bg-success/[0.04] hover:bg-success/[0.08]',
  neutral:     'border-border/60 bg-muted/[0.04] hover:bg-muted/10',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AttendanceOperationsCenter() {
  const navigate = useNavigate()

  const { data: stats, isLoading } = useQuery<AttendanceStats>({
    queryKey:  ['attendance-ops-stats'],
    queryFn:   () => api.get('/attendance/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<{
    data: Array<{
      id: string; event_type: string; employee_name: string
      timestamp: string; severity: string; detail: string
    }>
  }>({
    queryKey:  ['attendance-operational-events'],
    queryFn:   () => api.get('/attendance/events?limit=15'),
    staleTime: 20_000,
    retry:     false,
  })

  // ── Critical alert ──────────────────────────────────────────────────────────
  const criticalAlert = !isLoading && (stats?.payroll_continuity_gaps ?? 0) > 0
    ? {
        message:     `${stats!.payroll_continuity_gaps} attendance → payroll continuity gap${stats!.payroll_continuity_gaps === 1 ? '' : 's'} detected — payroll accuracy at risk.`,
        actionLabel: 'Investigate',
        onAction:    () => navigate('/admin/attendance/anomalies'),
        severity:    'critical' as const,
      }
    : !isLoading && stats?.is_processing
    ? {
        message:  'Attendance processing is currently running — data may be in flux.',
        severity: 'warning' as const,
      }
    : undefined

  // ── Intelligence groups ─────────────────────────────────────────────────────
  const groups: InsightGroup[] = useMemo(() => {
    const anomalyItems    = []
    const correctionItems = []
    const continuityItems = []

    if ((stats?.unresolved_anomalies ?? 0) > 0) {
      anomalyItems.push({
        id: 'anomalies', title: 'Unresolved attendance anomalies',
        description: 'Will auto-mark as LOP at period lock · Employees resolve via regularisation → manager approval',
        severity: 'warning' as const, count: stats!.unresolved_anomalies,
        action: 'View dept breakdown', onAction: () => navigate('/admin/attendance/anomalies'),
      })
    }
    if ((stats?.overnight_issues ?? 0) > 0) {
      anomalyItems.push({
        id: 'overnight', title: 'Overnight shift incidents',
        description: 'Incomplete punches or schedule violations on night shifts',
        severity: 'warning' as const, count: stats!.overnight_issues,
        action: 'Review incidents', onAction: () => navigate('/admin/attendance/forensics'),
      })
    }
    if ((stats?.confidence_warnings ?? 0) > 0) {
      anomalyItems.push({
        id: 'confidence', title: 'AI confidence warnings',
        description: 'Attendance records with low detection confidence',
        severity: 'warning' as const, count: stats!.confidence_warnings,
        action: 'Review warnings', onAction: () => navigate('/admin/attendance/confidence'),
      })
    }

    if ((stats?.pending_corrections ?? 0) > 0) {
      correctionItems.push({
        id: 'corrections', title: 'Correction requests pending',
        description: 'Employee-submitted corrections awaiting HR approval',
        severity: 'warning' as const, count: stats!.pending_corrections,
        action: 'Approve corrections', onAction: () => navigate('/admin/attendance/corrections'),
      })
    }
    if ((stats?.recompute_backlog ?? 0) > 0) {
      correctionItems.push({
        id: 'recompute', title: 'Recompute backlog',
        description: 'Employees with stale attendance calculations',
        severity: 'warning' as const, count: stats!.recompute_backlog,
        action: 'Trigger recompute', onAction: () => navigate('/admin/attendance'),
      })
    }

    if ((stats?.payroll_continuity_gaps ?? 0) > 0) {
      continuityItems.push({
        id: 'payroll-gaps', title: 'Attendance → Payroll gaps',
        description: "Attendance data doesn't match payroll inputs for some employees",
        severity: 'critical' as const, count: stats!.payroll_continuity_gaps,
        action: 'Investigate gaps', onAction: () => navigate('/admin/attendance/anomalies'),
      })
    }
    if ((stats?.staffing_pressure ?? 0) > 0) {
      continuityItems.push({
        id: 'staffing', title: 'Staffing pressure zones',
        description: 'Departments below minimum staffing threshold',
        severity: 'warning' as const, count: stats!.staffing_pressure,
        action: 'View risk zones', onAction: () => navigate('/admin/attendance/risk'),
      })
    }

    return [
      { id: 'anomalies',   label: 'Anomalies',   icon: AlertTriangle, items: anomalyItems },
      { id: 'corrections', label: 'Corrections',  icon: ClipboardEdit, items: correctionItems },
      { id: 'continuity',  label: 'Continuity',   icon: TrendingDown,  items: continuityItems },
    ]
  }, [stats, navigate])

  // ── Timeline ────────────────────────────────────────────────────────────────
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
    <PageContainer>
      <PageHero
        eyebrow="Time & Attendance"
        title="Attendance Operations"
        subtitle="Real-time operational state — anomalies, corrections, staffing and payroll continuity."
        actions={
          <Button size="sm" variant="outline"
            className="h-8 gap-1.5 border-white/20 bg-white/10 text-white hover:bg-white/20"
            onClick={() => navigate('/admin/attendance')}>
            Process Attendance
          </Button>
        }
      />

      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <WorkspaceCommandHeader
        alert={criticalAlert}
        loading={isLoading}
        metrics={
          <>
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.unresolved_anomalies ?? 0)}
              label="Unresolved Anomalies"
              severity={(stats?.unresolved_anomalies ?? 0) > 0 ? 'warning' : 'success'}
              icon={AlertTriangle}
              onClick={() => navigate('/admin/attendance/anomalies')}
            />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.pending_corrections ?? 0)}
              label="Pending Corrections"
              severity={(stats?.pending_corrections ?? 0) > 0 ? 'warning' : 'success'}
              icon={ClipboardEdit}
              onClick={() => navigate('/admin/attendance/corrections')}
            />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.overnight_issues ?? 0)}
              label="Overnight Issues"
              severity={(stats?.overnight_issues ?? 0) > 0 ? 'warning' : 'success'}
              icon={Clock}
              onClick={() => navigate('/admin/attendance/forensics')}
            />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.confidence_warnings ?? 0)}
              label="Confidence Risks"
              severity={(stats?.confidence_warnings ?? 0) > 0 ? 'warning' : 'success'}
              icon={ShieldAlert}
              onClick={() => navigate('/admin/attendance/confidence')}
            />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.recompute_backlog ?? 0)}
              label="Recompute Backlog"
              severity={(stats?.recompute_backlog ?? 0) > 5 ? 'warning' : 'neutral'}
              icon={RefreshCw}
              onClick={() => navigate('/admin/attendance')}
            />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.payroll_continuity_gaps ?? 0)}
              label="Payroll Gaps"
              severity={(stats?.payroll_continuity_gaps ?? 0) > 0 ? 'critical' : 'success'}
              icon={TrendingDown}
              onClick={() => navigate('/admin/attendance/anomalies')}
            />
            <div className="w-px h-8 bg-border/50 flex-shrink-0 mx-1" />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.staffing_pressure ?? 0)}
              label="Staffing Pressure"
              severity={(stats?.staffing_pressure ?? 0) > 0 ? 'warning' : 'neutral'}
              icon={Users}
              compact
              onClick={() => navigate('/admin/attendance/risk')}
            />
            <OperationalMetricChip
              value={isLoading ? '—' : (stats?.is_processing ? 'Running' : 'Idle')}
              label="Processor"
              severity={stats?.is_processing ? 'info' : 'neutral'}
              icon={Zap}
              compact
              onClick={() => navigate('/admin/attendance')}
            />
          </>
        }
      />

      {/* ── Two-column content ───────────────────────────────────────────────── */}
      <div className="flex gap-5 items-start">

        {/* Left — insight cards + quick actions */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Intelligence groups */}
          <SectionCard title="Active Issues">
            <IntelligencePanel
              groups={groups}
              loading={isLoading}
              emptyState={
                <div className="flex items-center gap-2 py-4 px-1 text-xs text-muted-foreground/60">
                  <Activity className="h-3.5 w-3.5 text-success/60" />
                  All systems operational — no active issues detected.
                </div>
              }
            />
          </SectionCard>

          {/* Quick-action navigation grid */}
          <SectionCard title="Operational Tools">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.href}
                  type="button"
                  onClick={() => navigate(qa.href)}
                  className={`group flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${ACCENT_CLASSES[qa.accent ?? 'neutral']}`}
                >
                  <span className="chip-grad flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm flex-shrink-0">
                    <qa.icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-[12px] font-medium text-foreground leading-tight">{qa.label}</p>
                    <p className="text-[10px] text-muted-foreground/60 leading-tight mt-0.5">{qa.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>

        </div>

        {/* Right — recent events timeline */}
        <div className="w-64 flex-shrink-0">
          <SectionCard title="Recent Events">
            <OperationalTimeline
              events={timeline}
              loading={eventsLoading}
              maxItems={12}
            />
          </SectionCard>
        </div>

      </div>
    </PageContainer>
  )
}
