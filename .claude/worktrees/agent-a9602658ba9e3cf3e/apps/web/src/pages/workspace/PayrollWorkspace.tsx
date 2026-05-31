/**
 * PayrollWorkspace — /admin/payroll-workspace
 *
 * Unified workspace for all payroll operations.
 * Evolved into a PAYROLL OPERATIONS COMMAND CENTER:
 *
 *   Command Header  → payroll blockers, failed payouts, compliance mismatches,
 *                     reconciliation severity, pending validations, freeze state,
 *                     unresolved anomalies
 *
 *   Intelligence Panel → OT/payroll mismatches, failed bank transfers,
 *                        unresolved variance cases, compliance gaps,
 *                        investigation continuity, deduction inconsistencies
 *
 *   Payroll Timeline → run initiated, validation passed, freeze triggered,
 *                      anomaly detected, payout failed, compliance gap found
 *
 *   Tabs → Runs · Validation · Reconciliation · Governance · Compensation
 *           Compliance · Variance · Investigations · Ledger · Advances
 */

import { lazy, Suspense, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  DollarSign, CheckSquare, Scale, ShieldCheck,
  Landmark, BookMarked, PieChart, Search,
  BarChart3, CreditCard, AlertTriangle, Lock,
  XCircle, FileWarning, Banknote, Activity,
  TrendingDown,
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
const PayrollRuns             = lazy(() => import('@/pages/payroll/PayrollRuns').then(m => ({ default: m.PayrollRuns })))
const PayrollValidation       = lazy(() => import('@/pages/payroll/PayrollValidation').then(m => ({ default: m.PayrollValidation })))
const PayrollReconciliation   = lazy(() => import('@/pages/payroll/PayrollReconciliation').then(m => ({ default: m.PayrollReconciliation })))
const PayrollGovernance       = lazy(() => import('@/pages/payroll/PayrollGovernance').then(m => ({ default: m.PayrollGovernance })))
const CompensationMaster      = lazy(() => import('@/pages/payroll/CompensationMaster').then(m => ({ default: m.CompensationMaster })))
const PayrollCostIntelligence = lazy(() => import('@/pages/payroll/PayrollCostIntelligence').then(m => ({ default: m.PayrollCostIntelligence })))
const PayrollInvestigation    = lazy(() => import('@/pages/payroll/PayrollInvestigation').then(m => ({ default: m.PayrollInvestigation })))
const PayrollLedger           = lazy(() => import('@/pages/payroll/PayrollLedger').then(m => ({ default: m.PayrollLedger })))
const StatutoryDashboard      = lazy(() => import('@/pages/payroll/StatutoryDashboard').then(m => ({ default: m.StatutoryDashboard })))
const AdvanceSalary           = lazy(() => import('@/pages/payroll/AdvanceSalary').then(m => ({ default: m.AdvanceSalary })))

function TabLoader() {
  return (
    <div className="flex h-48 items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// ── Operational data types ─────────────────────────────────────────────────────

interface PayrollRunStats {
  blockers:             number   // validation issues blocking current run
  failed_payouts:       number   // bank transfer / disbursement failures
  compliance_mismatches: number  // EPF/ESI/PTAX/TDS data mismatches
  reconciliation_open:  number   // unresolved reconciliation items
  pending_validations:  number   // employees pending pre-run validation
  is_frozen:            boolean  // payroll freeze active
  unresolved_anomalies: number   // anomalies flagged by system
  current_run_month:    string   // e.g. "May 2025"
  ot_mismatches:        number   // OT vs payroll mismatches
  variance_cases:       number   // open variance investigation cases
  failed_bank_transfers: number  // bank-level transfer failures
  deduction_gaps:       number   // deduction inconsistencies
}

// ── Command Header ─────────────────────────────────────────────────────────────

function PayrollCommandHeader() {
  const navigate = useNavigate()

  const { data: stats, isLoading } = useQuery<PayrollRunStats>({
    queryKey:  ['payroll-run-stats'],
    queryFn:   () => api.get('/payroll/runs/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  const criticalAlert = !isLoading && (stats?.is_frozen)
    ? {
        message:     `Payroll is frozen for ${stats?.current_run_month ?? 'current period'} — all edits are locked pending approval.`,
        actionLabel: 'Review freeze',
        onAction:    () => goTab('governance'),
        severity:    'critical' as const,
      }
    : !isLoading && (stats?.blockers ?? 0) > 0
    ? {
        message:     `${stats!.blockers} validation blocker${stats!.blockers === 1 ? '' : 's'} preventing payroll run — resolve before processing.`,
        actionLabel: 'Fix blockers',
        onAction:    () => goTab('validation'),
        severity:    'critical' as const,
      }
    : undefined

  return (
    <WorkspaceCommandHeader
      alert={criticalAlert}
      loading={isLoading}
      metrics={
        <>
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.blockers ?? 0)}
            label="Run Blockers"
            severity={(stats?.blockers ?? 0) > 0 ? 'critical' : 'success'}
            icon={XCircle}
            sub={stats?.current_run_month}
            onClick={() => goTab('validation')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.failed_payouts ?? 0)}
            label="Failed Payouts"
            severity={(stats?.failed_payouts ?? 0) > 0 ? 'critical' : 'success'}
            icon={Banknote}
            onClick={() => goTab('runs')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.compliance_mismatches ?? 0)}
            label="Compliance Mismatches"
            severity={(stats?.compliance_mismatches ?? 0) > 0 ? 'warning' : 'success'}
            icon={FileWarning}
            onClick={() => goTab('compliance')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.reconciliation_open ?? 0)}
            label="Reconciliation Open"
            severity={(stats?.reconciliation_open ?? 0) > 3 ? 'warning' : 'neutral'}
            icon={Scale}
            onClick={() => goTab('reconciliation')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.unresolved_anomalies ?? 0)}
            label="Anomalies"
            severity={(stats?.unresolved_anomalies ?? 0) > 0 ? 'warning' : 'success'}
            icon={AlertTriangle}
            onClick={() => goTab('investigations')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.is_frozen ? 'Frozen' : 'Open')}
            label="Payroll State"
            severity={stats?.is_frozen ? 'critical' : 'success'}
            icon={Lock}
            onClick={() => goTab('governance')}
          />
          {/* Separator */}
          <div className="w-px h-8 bg-border/50 flex-shrink-0 mx-1" />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.ot_mismatches ?? 0)}
            label="OT Mismatches"
            severity={(stats?.ot_mismatches ?? 0) > 0 ? 'warning' : 'neutral'}
            icon={TrendingDown}
            compact
            onClick={() => goTab('reconciliation')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.variance_cases ?? 0)}
            label="Variance Cases"
            severity={(stats?.variance_cases ?? 0) > 0 ? 'warning' : 'neutral'}
            icon={PieChart}
            compact
            onClick={() => goTab('variance')}
          />
          <OperationalMetricChip
            value={isLoading ? '—' : (stats?.pending_validations ?? 0)}
            label="Pending Validation"
            severity={(stats?.pending_validations ?? 0) > 5 ? 'warning' : 'neutral'}
            icon={CheckSquare}
            compact
            onClick={() => goTab('validation')}
          />
        </>
      }
    />
  )
}

// ── Intelligence Panel ─────────────────────────────────────────────────────────

function PayrollIntelligencePanelContent() {
  const navigate = useNavigate()

  const { data: stats, isLoading } = useQuery<PayrollRunStats>({
    queryKey:  ['payroll-run-stats'],
    queryFn:   () => api.get('/payroll/runs/stats'),
    staleTime: 30_000,
    retry:     false,
  })

  const { data: events, isLoading: eventsLoading } = useQuery<{
    data: Array<{
      id: string; event_type: string; employee_name: string;
      timestamp: string; severity: string; detail: string;
    }>
  }>({
    queryKey:  ['payroll-operational-events'],
    queryFn:   () => api.get('/payroll/events?limit=15'),
    staleTime: 20_000,
    retry:     false,
  })

  function goTab(tab: string) {
    const p = new URLSearchParams()
    p.set('tab', tab)
    navigate({ search: p.toString() }, { replace: true })
  }

  const groups: InsightGroup[] = useMemo(() => {
    const payoutItems  = []
    const reconcItems  = []
    const complianceItems = []

    if ((stats?.failed_payouts ?? 0) > 0) {
      payoutItems.push({
        id:          'failed-payouts',
        title:       'Failed bank payouts',
        description: 'Bank transfers rejected — employees not paid',
        severity:    'critical' as const,
        count:       stats!.failed_payouts,
        action:      'Retry payouts',
        onAction:    () => goTab('runs'),
      })
    }
    if ((stats?.failed_bank_transfers ?? 0) > 0) {
      payoutItems.push({
        id:          'bank-transfers',
        title:       'Bank transfer failures',
        description: 'Disbursement file rejected by bank',
        severity:    'critical' as const,
        count:       stats!.failed_bank_transfers,
        action:      'View failures',
        onAction:    () => goTab('runs'),
      })
    }
    if ((stats?.blockers ?? 0) > 0) {
      payoutItems.push({
        id:          'run-blockers',
        title:       'Payroll run blockers',
        description: 'Validation issues preventing payroll processing',
        severity:    'critical' as const,
        count:       stats!.blockers,
        action:      'Fix blockers',
        onAction:    () => goTab('validation'),
      })
    }

    if ((stats?.ot_mismatches ?? 0) > 0) {
      reconcItems.push({
        id:          'ot-mismatch',
        title:       'OT vs payroll mismatch',
        description: 'Overtime hours in attendance don\'t match payroll OT',
        severity:    'warning' as const,
        count:       stats!.ot_mismatches,
        action:      'Reconcile OT',
        onAction:    () => goTab('reconciliation'),
      })
    }
    if ((stats?.variance_cases ?? 0) > 0) {
      reconcItems.push({
        id:          'variance-cases',
        title:       'Open variance cases',
        description: 'Payroll variance investigations awaiting resolution',
        severity:    'warning' as const,
        count:       stats!.variance_cases,
        action:      'Review cases',
        onAction:    () => goTab('variance'),
      })
    }
    if ((stats?.deduction_gaps ?? 0) > 0) {
      reconcItems.push({
        id:          'deduction-gaps',
        title:       'Deduction inconsistencies',
        description: 'Employee deductions differ from structure definition',
        severity:    'warning' as const,
        count:       stats!.deduction_gaps,
        action:      'Review deductions',
        onAction:    () => goTab('reconciliation'),
      })
    }

    if ((stats?.compliance_mismatches ?? 0) > 0) {
      complianceItems.push({
        id:          'compliance-gaps',
        title:       'Compliance data mismatches',
        description: 'EPF/ESI/PTAX/TDS registration or computation gaps',
        severity:    'warning' as const,
        count:       stats!.compliance_mismatches,
        action:      'Review compliance',
        onAction:    () => goTab('compliance'),
      })
    }
    if ((stats?.unresolved_anomalies ?? 0) > 0) {
      complianceItems.push({
        id:          'anomalies',
        title:       'Unresolved payroll anomalies',
        description: 'System-flagged inconsistencies needing investigation',
        severity:    'warning' as const,
        count:       stats!.unresolved_anomalies,
        action:      'Investigate',
        onAction:    () => goTab('investigations'),
      })
    }

    return [
      { id: 'payouts',    label: 'Payouts',    icon: Banknote,    items: payoutItems },
      { id: 'reconcil',   label: 'Reconciliation', icon: Scale,   items: reconcItems },
      { id: 'compliance', label: 'Compliance', icon: ShieldCheck, items: complianceItems },
    ]
  }, [stats])

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
        title="Payroll Intelligence"
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

export function PayrollWorkspace() {
  return (
    <WorkspaceShell
      title="Payroll"
      subtitle="Payroll runs, compliance, reconciliation, and compensation management"
      breadcrumbs={[{ label: 'Admin' }, { label: 'Payroll' }]}
      defaultTab="runs"
      commandHeader={<PayrollCommandHeader />}
      rightPanel={<PayrollIntelligencePanelContent />}
      navGroups={[
        {
          id:    'payroll',
          label: 'Payroll',
          items: [
            {
              key:         'runs',
              label:       'Runs',
              icon:        DollarSign,
              description: 'Run and manage payroll cycles',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollRuns />
                </Suspense>
              ),
            },
            {
              key:         'validation',
              label:       'Validation',
              icon:        CheckSquare,
              description: 'Pre-run validation and readiness checks',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollValidation />
                </Suspense>
              ),
            },
            {
              key:         'reconciliation',
              label:       'Reconciliation',
              icon:        Scale,
              description: 'Payroll vs attendance, OT, deductions reconciliation',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollReconciliation />
                </Suspense>
              ),
            },
            {
              key:         'governance',
              label:       'Governance',
              icon:        ShieldCheck,
              description: 'Maker-checker, freeze controls, and variance approvals',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollGovernance />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'compensation',
          label: 'Compensation',
          items: [
            {
              key:         'compensation',
              label:       'Structures',
              icon:        Landmark,
              description: 'Salary structures and employee compensation',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <CompensationMaster />
                </Suspense>
              ),
            },
            {
              key:         'compliance',
              label:       'Statutory',
              icon:        BarChart3,
              description: 'EPF, ESI, PTAX, and TDS management',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <StatutoryDashboard />
                </Suspense>
              ),
            },
            {
              key:         'advances',
              label:       'Advances',
              icon:        CreditCard,
              description: 'Salary advances and loan management',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <AdvanceSalary />
                </Suspense>
              ),
            },
          ],
        },
        {
          id:    'analysis',
          label: 'Analysis',
          items: [
            {
              key:         'variance',
              label:       'Variance',
              icon:        PieChart,
              description: 'Workforce cost breakdown and variance trends',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollCostIntelligence />
                </Suspense>
              ),
            },
            {
              key:         'investigations',
              label:       'Investigations',
              icon:        Search,
              description: 'Deep-dive investigation for payroll discrepancies',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollInvestigation />
                </Suspense>
              ),
            },
            {
              key:         'ledger',
              label:       'Ledger',
              icon:        BookMarked,
              description: 'Explainability ledger for all payroll changes',
              content: (
                <Suspense fallback={<TabLoader />}>
                  <PayrollLedger />
                </Suspense>
              ),
            },
          ],
        },
      ]}
    />
  )
}
