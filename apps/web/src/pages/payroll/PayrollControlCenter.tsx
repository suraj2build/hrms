/**
 * PayrollControlCenter — unified 7-step payroll execution workspace.
 *
 * Replaces having to navigate to 6+ separate pages to complete a payroll run.
 * Each step represents a pre-run check or action in the payroll cycle and must
 * be completed in order (where blocksNext is true) before proceeding.
 *
 * Route: /admin/payroll/center
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  ClipboardCheck,
  AlertTriangle,
  Lock,
  Timer,
  TrendingUp,
  Shield,
  PlayCircle,
  Check,
  X,
  SkipForward,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { usePayrollDeadline } from '@/contexts/PayrollDeadlineContext'

// ── Types ──────────────────────────────────────────────────────────────────────

type StepId =
  | 'readiness'
  | 'exceptions'
  | 'freeze'
  | 'ot-validation'
  | 'variance'
  | 'compliance'
  | 'final-lock'

type StepStatus = 'pending' | 'in-progress' | 'complete' | 'blocked' | 'skipped'

interface PayrollStep {
  id: StepId
  order: number
  label: string
  description: string
  icon: LucideIcon
  blocksNext: boolean
}

// ── Compliance stats — mirrors /payroll/compliance/stats response shape ────────

interface PccComplianceModule {
  is_ready:           boolean
  employees_missing:  number
  filing_gaps:        number
  computation_errors: number
}

interface PccComplianceStats {
  epf:  PccComplianceModule
  esi:  PccComplianceModule
  ptax: PccComplianceModule
  tds:  PccComplianceModule
}

// ── Step-state helpers ─────────────────────────────────────────────────────────

/** Canonical default for a fresh payroll period. */
const STEP_DEFAULT: Record<StepId, StepStatus> = {
  readiness:       'pending',
  exceptions:      'pending',
  freeze:          'pending',
  'ot-validation': 'pending',
  variance:        'pending',
  compliance:      'pending',
  'final-lock':    'pending',
}

/** Returns the sessionStorage key for a given payroll month string (YYYY-MM). */
const stepStorageKey = (month: string) => `pcc_steps_${month}`

/** Returns YYYY-MM for the current calendar month. */
function currentPayrollMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Formats a YYYY-MM string as "May 2026". */
function formatPayrollMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', {
    month: 'long',
    year:  'numeric',
  })
}

// ── Step definitions ───────────────────────────────────────────────────────────

const PAYROLL_STEPS: PayrollStep[] = [
  {
    id: 'readiness',
    order: 1,
    label: 'Pre-Run Checks',
    description: 'Verify missing punches, anomalies, and corrections are resolved',
    icon: ClipboardCheck,
    blocksNext: true,
  },
  {
    id: 'exceptions',
    order: 2,
    label: 'Exception Clearance',
    description: 'Review and clear all open operational exceptions',
    icon: AlertTriangle,
    blocksNext: true,
  },
  {
    id: 'freeze',
    order: 3,
    label: 'Attendance Freeze',
    description: 'Lock the attendance period to prevent further changes',
    icon: Lock,
    blocksNext: true,
  },
  {
    id: 'ot-validation',
    order: 4,
    label: 'OT Validation',
    description: 'Approve or reject overtime claims before payroll calculation',
    icon: Timer,
    blocksNext: false,
  },
  {
    id: 'variance',
    order: 5,
    label: 'Salary Variance',
    description: 'Review employees with significant compensation changes',
    icon: TrendingUp,
    blocksNext: false,
  },
  {
    id: 'compliance',
    order: 6,
    label: 'Compliance Check',
    description: 'Verify EPF, ESI, PT, and TDS compliance status',
    icon: Shield,
    blocksNext: true,
  },
  {
    id: 'final-lock',
    order: 7,
    label: 'Final Lock & Run',
    description: 'Lock all data and initiate payroll calculation',
    icon: PlayCircle,
    blocksNext: false,
  },
]

// ── StepPanel ──────────────────────────────────────────────────────────────────

function StepPanel({
  step,
  children,
  status,
  onComplete,
  onSkip,
  canSkip = true,
  canBypass = false,
}: {
  step: PayrollStep
  children: React.ReactNode
  status: 'ok' | 'warning' | 'blocked'
  onComplete?: () => void
  onSkip?: () => void
  canSkip?: boolean
  canBypass?: boolean
}): JSX.Element {
  const StepIcon = step.icon
  const [showBypass, setShowBypass] = useState(false)
  const [bypassReason, setBypassReason] = useState('')

  const handleBypassConfirm = () => {
    if (!bypassReason.trim()) return
    setShowBypass(false)
    setBypassReason('')
    onSkip?.()
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'p-2 rounded-lg',
            status === 'ok'
              ? 'bg-success/10'
              : status === 'warning'
                ? 'bg-warning/10'
                : 'bg-destructive/10',
          )}
        >
          <StepIcon
            className={cn(
              'h-5 w-5',
              status === 'ok'
                ? 'text-success'
                : status === 'warning'
                  ? 'text-warning'
                  : 'text-destructive',
            )}
          />
        </div>
        <div>
          <h2 className="text-base font-semibold">{step.label}</h2>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </div>
        <div className="ml-auto">
          {status === 'ok' && (
            <Badge variant="success" className="gap-1">
              <Check className="h-3 w-3" /> Ready
            </Badge>
          )}
          {status === 'warning' && (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Issues
            </Badge>
          )}
          {status === 'blocked' && (
            <Badge variant="destructive" className="gap-1">
              <X className="h-3 w-3" /> Blocked
            </Badge>
          )}
        </div>
      </div>

      <div>{children}</div>

      {/* Bypass reason input — shown inline when user clicks Proceed Anyway */}
      {showBypass && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
          <p className="text-xs font-medium text-warning">
            Bypassing with open issues — enter a reason to confirm
          </p>
          <textarea
            className="w-full rounded border border-border bg-background text-sm px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            placeholder="e.g. Mis-punches are for resigned employees, safe to proceed"
            value={bypassReason}
            onChange={e => setBypassReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => { setShowBypass(false); setBypassReason('') }}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1 bg-warning hover:bg-warning/90 text-warning-foreground border-0"
              disabled={!bypassReason.trim()}
              onClick={handleBypassConfirm}>
              <SkipForward className="h-3 w-3" /> Confirm bypass
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        {status === 'ok' && onComplete && (
          <Button onClick={onComplete} className="gap-1.5">
            <Check className="h-4 w-4" /> Complete Step
          </Button>
        )}
        {canSkip && onSkip && (
          <Button variant="outline" onClick={onSkip} className="gap-1.5">
            Skip →
          </Button>
        )}
        {status !== 'ok' && canBypass && !showBypass && onSkip && (
          <Button variant="outline" size="sm" className="gap-1.5 text-warning border-warning/30 hover:bg-warning/10"
            onClick={() => setShowBypass(true)}>
            <SkipForward className="h-3.5 w-3.5" /> Proceed anyway
          </Button>
        )}
        {status !== 'ok' && !canBypass && !canSkip && (
          <p className="text-xs text-muted-foreground">Resolve issues above before proceeding</p>
        )}
        {status !== 'ok' && !canBypass && canSkip && (
          <p className="text-xs text-muted-foreground">Issues found — resolve or skip to proceed</p>
        )}
      </div>
    </div>
  )
}

// ── Issue row helper ───────────────────────────────────────────────────────────

function IssueRow({
  label,
  count,
  linkLabel,
  onLink,
}: {
  label: string
  count: number
  linkLabel: string
  onLink: () => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/40 border border-border">
      <div className="flex items-center gap-2">
        {count > 0 ? (
          <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
        ) : (
          <Check className="h-4 w-4 text-success flex-shrink-0" />
        )}
        <span className="text-sm">{label}</span>
        <Badge variant={count > 0 ? 'destructive' : 'secondary'} className="text-xs">
          {count}
        </Badge>
      </div>
      {count > 0 && (
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={onLink}>
          {linkLabel}
        </Button>
      )}
    </div>
  )
}

// ── Previous step checklist for final-lock ─────────────────────────────────────

function PreviousStepChecklist({
  stepStatuses,
}: {
  stepStatuses: Record<StepId, StepStatus>
}): JSX.Element {
  const previous = PAYROLL_STEPS.slice(0, 6)
  return (
    <div className="flex flex-col gap-1.5">
      {previous.map((step) => {
        const status = stepStatuses[step.id]
        const isDone = status === 'complete' || status === 'skipped'
        return (
          <div
            key={step.id}
            className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/30"
          >
            {isDone ? (
              <Check className="h-4 w-4 text-success flex-shrink-0" />
            ) : (
              <X className="h-4 w-4 text-destructive flex-shrink-0" />
            )}
            <span className={cn('text-sm', isDone ? 'text-foreground' : 'text-muted-foreground')}>
              {step.label}
            </span>
            {step.blocksNext && !isDone && (
              <Badge variant="destructive" className="ml-auto text-xs">
                Required
              </Badge>
            )}
            {isDone && (
              <Badge variant="secondary" className="ml-auto text-xs capitalize">
                {status}
              </Badge>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PayrollControlCenter(): JSX.Element {
  const navigate = useNavigate()
  const { isDeadlineMode, activateDeadline, deactivateDeadline, hoursUntilDeadline } =
    usePayrollDeadline()

  // ── Payroll period ────────────────────────────────────────────────────────
  const [payrollMonth, setPayrollMonth] = useState<string>(currentPayrollMonth)

  // ── Step state — initialised from sessionStorage for the current month ────
  const [activeStep, setActiveStep] = useState<StepId>('readiness')
  const [stepStatuses, setStepStatuses] = useState<Record<StepId, StepStatus>>(() => {
    try {
      const stored = sessionStorage.getItem(stepStorageKey(currentPayrollMonth()))
      if (stored) return JSON.parse(stored) as Record<StepId, StepStatus>
    } catch { /* ignore — storage unavailable */ }
    return STEP_DEFAULT
  })
  const [isRunning, setIsRunning] = useState(false)
  const [isFrozen,  setIsFrozen]  = useState(false)
  const [lastRunId, setLastRunId] = useState<string | null>(null)

  // ── Skip the month-change effect on first mount (state already initialised above) ──
  const isFirstMount = useRef(true)

  // Persist step progress whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(stepStorageKey(payrollMonth), JSON.stringify(stepStatuses))
    } catch { /* ignore */ }
  }, [stepStatuses, payrollMonth])

  // When the operator selects a different month, restore that month's saved progress
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }
    try {
      const stored = sessionStorage.getItem(stepStorageKey(payrollMonth))
      setStepStatuses(stored ? (JSON.parse(stored) as Record<StepId, StepStatus>) : STEP_DEFAULT)
    } catch {
      setStepStatuses(STEP_DEFAULT)
    }
    setActiveStep('readiness')
    setIsFrozen(false)
    setLastRunId(null)
  }, [payrollMonth])

  // ── completeStep ─────────────────────────────────────────────────────────────

  const completeStep = useCallback((stepId: StepId) => {
    setStepStatuses((prev) => ({ ...prev, [stepId]: 'complete' }))
    const currentOrder = PAYROLL_STEPS.find((p) => p.id === stepId)?.order ?? 0
    const nextStep = PAYROLL_STEPS.find((s) => s.order === currentOrder + 1)
    if (nextStep) setActiveStep(nextStep.id)
  }, [])

  const skipStep = useCallback((stepId: StepId) => {
    setStepStatuses((prev) => ({ ...prev, [stepId]: 'skipped' }))
    const currentOrder = PAYROLL_STEPS.find((p) => p.id === stepId)?.order ?? 0
    const nextStep = PAYROLL_STEPS.find((s) => s.order === currentOrder + 1)
    if (nextStep) setActiveStep(nextStep.id)
  }, [])

  // ── Step 1 — readiness ───────────────────────────────────────────────────────

  const { data: missingPunchCount } = useQuery({
    queryKey: ['pcc-missing'],
    queryFn: () =>
      api
        .get<{ data: unknown[]; total?: number }>(
          '/attendance/anomalies?type=missing_punch&resolved=false&limit=1',
        )
        .then((r) => r.total ?? r.data?.length ?? 0),
    enabled: activeStep === 'readiness',
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: correctionCount } = useQuery({
    queryKey: ['pcc-corrections'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/corrections?status=pending&limit=1')
        .then((r) => r.data?.length ?? 0),
    enabled: activeStep === 'readiness',
    staleTime: 60_000,
  })

  // Auto-complete readiness when both counts are zero
  useEffect(() => {
    if (
      activeStep === 'readiness' &&
      missingPunchCount === 0 &&
      correctionCount === 0 &&
      stepStatuses.readiness === 'pending'
    ) {
      setStepStatuses((prev) => ({ ...prev, readiness: 'complete' }))
    }
  }, [activeStep, missingPunchCount, correctionCount, stepStatuses.readiness])

  // ── Step 2 — exceptions ──────────────────────────────────────────────────────

  const { data: exceptionCount } = useQuery({
    queryKey: ['pcc-exceptions'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/attendance/anomalies?resolved=false&limit=1')
        .then((r) => r.data?.length ?? 0),
    enabled: activeStep === 'exceptions' || activeStep === 'readiness',
    staleTime: 60_000,
  })

  // ── Step 3 — freeze ──────────────────────────────────────────────────────────

  const freezeMutation = useMutation({
    mutationFn: () => api.post<void>('/attendance/periods/lock', {}),
    onSuccess: () => {
      setIsFrozen(true)
      completeStep('freeze')
      toast.success('Attendance period frozen')
    },
    onError: () => toast.error('Freeze failed'),
  })

  // ── Step 4 — ot-validation ───────────────────────────────────────────────────

  // OT step: query actual pending approval requests, not anomaly spikes
  const { data: otCount } = useQuery({
    queryKey: ['pcc-ot', payrollMonth],
    queryFn: () =>
      api
        .get<{ data: unknown[]; total?: number }>(
          `/overtime/requests?status=PENDING&month=${payrollMonth}`,
        )
        .then((r) => r.total ?? r.data?.length ?? 0),
    enabled: activeStep === 'ot-validation',
    staleTime: 60_000,
  })

  // ── Step 5 — variance ────────────────────────────────────────────────────────

  const { data: revisionCount } = useQuery({
    queryKey: ['pcc-revisions'],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/payroll/revisions?status=pending&limit=1')
        .then((r) => r.data?.length ?? 0),
    enabled: activeStep === 'variance',
    staleTime: 60_000,
  })

  // ── Step 6 — compliance ──────────────────────────────────────────────────────

  // Compliance step: query real statutory module readiness, not attendance anomalies
  const { data: complianceStats } = useQuery<PccComplianceStats>({
    queryKey: ['pcc-compliance', payrollMonth],
    queryFn: () =>
      api.get<PccComplianceStats>(`/payroll/compliance/stats?month=${payrollMonth}`),
    enabled: activeStep === 'compliance',
    staleTime: 60_000,
  })

  // ── Step 7 — final-lock ──────────────────────────────────────────────────────

  const { data: dashStats } = useQuery({
    queryKey: ['pcc-dash'],
    queryFn: () =>
      api.get<{ active_employees: number; total_employees: number }>('/analytics/dashboard'),
    enabled: activeStep === 'final-lock',
    staleTime: 5 * 60_000,
  })

  const runPayrollMutation = useMutation({
    mutationFn: () => api.post<{ run_id: string }>('/payroll/runs', { trigger: 'manual' }),
    onSuccess: (data) => {
      setIsRunning(false)
      setLastRunId(data?.run_id ?? null)
      completeStep('final-lock')
      // Stay in the workspace — show payout link inline rather than ejecting to /admin/payroll
      toast.success(`Payroll run submitted — ID: ${data?.run_id ?? 'N/A'}`)
    },
    onError: () => {
      setIsRunning(false)
      toast.error('Payroll run failed — check logs and retry')
    },
  })

  const canRunPayroll = PAYROLL_STEPS.slice(0, 6)
    .filter((s) => s.blocksNext)
    .every((s) => stepStatuses[s.id] === 'complete' || stepStatuses[s.id] === 'skipped')

  // ── Deadline mode toggle ─────────────────────────────────────────────────────

  const handleDeadlineToggle = useCallback(() => {
    if (isDeadlineMode) {
      deactivateDeadline()
    } else {
      activateDeadline()
    }
  }, [isDeadlineMode, activateDeadline, deactivateDeadline])

  // ── Active step data ─────────────────────────────────────────────────────────

  const currentStep = PAYROLL_STEPS.find((s) => s.id === activeStep) ?? PAYROLL_STEPS[0]

  // ── Step content renderer ────────────────────────────────────────────────────

  function renderStepContent(): JSX.Element {
    switch (activeStep) {
      case 'readiness': {
        const mp = missingPunchCount ?? 0
        const cc = correctionCount ?? 0
        const hasIssues = mp > 0 || cc > 0
        return (
          <StepPanel
            step={currentStep}
            status={hasIssues ? 'warning' : 'ok'}
            onComplete={() => completeStep('readiness')}
            onSkip={() => skipStep('readiness')}
            canSkip={false}
            canBypass
          >
            <div className="flex flex-col gap-2">
              <IssueRow
                label="Missing punch records"
                count={mp}
                linkLabel="Go to Missing Punches →"
                onLink={() => navigate('/admin/daily-ops?tab=missing-punches')}
              />
              <IssueRow
                label="Pending corrections"
                count={cc}
                linkLabel="Go to Corrections →"
                onLink={() => navigate('/admin/attendance/corrections')}
              />
              {!hasIssues && (
                <p className="text-sm text-success font-medium">
                  All pre-run checks passed. Ready to proceed.
                </p>
              )}
            </div>
          </StepPanel>
        )
      }

      case 'exceptions': {
        const ec = exceptionCount ?? 0
        return (
          <StepPanel
            step={currentStep}
            status={ec > 0 ? 'warning' : 'ok'}
            onComplete={() => completeStep('exceptions')}
            onSkip={() => skipStep('exceptions')}
            canSkip={false}
            canBypass
          >
            <div className="flex flex-col gap-2">
              <IssueRow
                label="Open operational exceptions"
                count={ec}
                linkLabel="Go to Anomalies →"
                onLink={() => navigate('/admin/attendance/anomalies')}
              />
              {ec === 0 && (
                <p className="text-sm text-success font-medium">
                  No open exceptions. Ready to proceed.
                </p>
              )}
            </div>
          </StepPanel>
        )
      }

      case 'freeze': {
        return (
          <StepPanel
            step={currentStep}
            status={isFrozen ? 'ok' : 'warning'}
            onComplete={isFrozen ? () => completeStep('freeze') : undefined}
            onSkip={() => skipStep('freeze')}
            canSkip={false}
            canBypass
          >
            <div className="flex flex-col gap-3">
              {isFrozen ? (
                <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-success/10 border border-success/30">
                  <Lock className="h-4 w-4 text-success flex-shrink-0" />
                  <span className="text-sm text-success font-medium">
                    Attendance period is frozen
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-warning/10 border border-warning/30">
                    <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                    <span className="text-sm text-warning">
                      Freezing the attendance period is irreversible. No further changes can be
                      made to attendance records once locked.
                    </span>
                  </div>
                  <Button
                    onClick={() => freezeMutation.mutate()}
                    disabled={freezeMutation.isPending}
                    className="gap-1.5 w-fit"
                    variant="destructive"
                  >
                    <Lock className="h-4 w-4" />
                    {freezeMutation.isPending ? 'Freezing…' : 'Freeze Attendance Period'}
                  </Button>
                </>
              )}
            </div>
          </StepPanel>
        )
      }

      case 'ot-validation': {
        const oc = otCount ?? 0
        return (
          <StepPanel
            step={currentStep}
            status={oc > 0 ? 'warning' : 'ok'}
            onComplete={() => completeStep('ot-validation')}
            onSkip={() => skipStep('ot-validation')}
            canSkip
          >
            <div className="flex flex-col gap-2">
              <IssueRow
                label="Pending OT approval requests"
                count={oc}
                linkLabel="Go to OT Management →"
                onLink={() => navigate('/admin/overtime')}
              />
              {oc === 0 && (
                <p className="text-sm text-success font-medium">
                  No pending overtime approval requests.
                </p>
              )}
            </div>
          </StepPanel>
        )
      }

      case 'variance': {
        const rc = revisionCount ?? 0
        return (
          <StepPanel
            step={currentStep}
            status={rc > 0 ? 'warning' : 'ok'}
            onComplete={() => completeStep('variance')}
            onSkip={() => skipStep('variance')}
            canSkip
          >
            <div className="flex flex-col gap-2">
              <IssueRow
                label="Pending compensation revisions"
                count={rc}
                linkLabel="Go to Comp Revisions →"
                onLink={() => navigate('/admin/payroll/compensation-revisions')}
              />
              {rc === 0 && (
                <p className="text-sm text-success font-medium">
                  No pending salary variance items.
                </p>
              )}
            </div>
          </StepPanel>
        )
      }

      case 'compliance': {
        // Derive per-module readiness from real statutory stats (not attendance anomalies)
        const compModules: Array<{
          key:   string
          label: string
          route: string
          mod:   PccComplianceModule | undefined
        }> = complianceStats
          ? [
              { key: 'epf',  label: 'PF / EPF',    route: '/admin/payroll/statutory/epf',  mod: complianceStats.epf  },
              { key: 'esi',  label: 'ESI',          route: '/admin/payroll/statutory/esi',  mod: complianceStats.esi  },
              { key: 'ptax', label: 'Prof. Tax',    route: '/admin/payroll/statutory/ptax', mod: complianceStats.ptax },
              { key: 'tds',  label: 'TDS',          route: '/admin/payroll/statutory/tds',  mod: complianceStats.tds  },
            ]
          : []

        const notReady  = compModules.filter(m => m.mod && !m.mod.is_ready)
        const allReady  = complianceStats !== undefined && notReady.length === 0
        const compStatus: 'ok' | 'warning' | 'blocked' = allReady ? 'ok' : 'warning'

        return (
          <StepPanel
            step={currentStep}
            status={compStatus}
            onComplete={allReady ? () => completeStep('compliance') : undefined}
            canSkip={false}
          >
            <div className="flex flex-col gap-2">
              {!complianceStats && (
                <p className="text-sm text-muted-foreground">Loading statutory compliance status…</p>
              )}
              {compModules.map(({ key, label, route, mod }) => {
                const issueCount = mod
                  ? (mod.employees_missing ?? 0) + (mod.filing_gaps ?? 0) + (mod.computation_errors ?? 0)
                  : 0
                return (
                  <IssueRow
                    key={key}
                    label={`${label} — ${mod?.is_ready ? 'ready' : 'issues found'}`}
                    count={issueCount}
                    linkLabel={`Review ${label} →`}
                    onLink={() => navigate(route)}
                  />
                )
              })}
              {allReady && (
                <p className="text-sm text-success font-medium">
                  All statutory obligations verified. Ready to proceed.
                </p>
              )}
            </div>
          </StepPanel>
        )
      }

      case 'final-lock': {
        const activeEmployees = dashStats?.active_employees ?? 0
        return (
          <StepPanel
            step={currentStep}
            status={canRunPayroll ? 'ok' : 'blocked'}
            onComplete={undefined}
            canSkip={false}
          >
            <div className="flex flex-col gap-4">
              <div className="text-sm text-muted-foreground">
                All previous steps must be completed before initiating the payroll run.
              </div>

              <PreviousStepChecklist stepStatuses={stepStatuses} />

              {canRunPayroll && (
                <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-success/10 border border-success/30">
                  <Check className="h-5 w-5 text-success flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-success">Ready to run payroll</p>
                    {activeEmployees > 0 && (
                      <p className="text-xs text-success">
                        {activeEmployees.toLocaleString()} active employee
                        {activeEmployees !== 1 ? 's' : ''} will be processed
                      </p>
                    )}
                  </div>
                </div>
              )}

              {canRunPayroll && !lastRunId && (
                <Button
                  size="lg"
                  className="gap-2 w-fit"
                  disabled={runPayrollMutation.isPending || isRunning}
                  onClick={() => {
                    setIsRunning(true)
                    runPayrollMutation.mutate()
                  }}
                >
                  <PlayCircle className="h-5 w-5" />
                  {runPayrollMutation.isPending || isRunning
                    ? 'Initiating Payroll Run…'
                    : 'Run Payroll'}
                </Button>
              )}

              {/* Post-run success — stay in workspace, surface next action */}
              {lastRunId && (
                <div className="flex items-start gap-3 py-3 px-4 rounded-lg bg-primary/5 border border-primary/20">
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary">Payroll run submitted</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      Run ID: {lastRunId}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 shrink-0"
                    onClick={() => navigate(`/admin/payroll/payout?runId=${lastRunId}`)}
                  >
                    Bank Payout →
                  </Button>
                </div>
              )}
            </div>
          </StepPanel>
        )
      }

      default:
        return <div />
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-primary/[0.05] via-primary/[0.02] to-transparent">
        <div className="flex items-center gap-3">
          <div className="gloss-sheen flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-elev-1" style={{ background: 'var(--grad-primary)' }}>
            <PlayCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/70">Payroll · Execution</p>
            <h1 className="font-display text-lg font-semibold leading-tight">Payroll Operations</h1>
            <p className="text-xs text-muted-foreground">
              7-step payroll execution workflow · follow each step in sequence
            </p>
          </div>
        </div>

        {/* Period context — always confirm the correct month before running */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Processing:</span>
          <input
            type="month"
            value={payrollMonth}
            onChange={e => e.target.value && setPayrollMonth(e.target.value)}
            className="h-7 px-2 text-xs font-semibold rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs font-bold text-foreground">
            {formatPayrollMonth(payrollMonth)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isDeadlineMode && hoursUntilDeadline !== undefined && (
            <span className="text-xs text-warning font-medium">
              {hoursUntilDeadline > 0 ? `${hoursUntilDeadline}h until deadline` : 'Deadline now'}
            </span>
          )}
          <Button
            size="sm"
            variant={isDeadlineMode ? 'destructive' : 'outline'}
            className="text-xs h-8 gap-1.5"
            onClick={handleDeadlineToggle}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {isDeadlineMode ? 'Deactivate Deadline Mode' : 'Activate Deadline Mode'}
          </Button>
        </div>
      </div>

      {/* Deadline mode warning strip */}
      {isDeadlineMode && (
        <div className="flex items-center gap-2 px-6 py-2 bg-warning/10 border-b border-warning/30">
          <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
          <span className="text-xs font-semibold text-warning">
            Deadline Mode Active — prioritise completing all steps
          </span>
        </div>
      )}

      {/* Progress stepper */}
      <div className="flex items-center px-4 py-4 border-b border-border overflow-x-auto">
        {PAYROLL_STEPS.map((step, i) => {
          const status = stepStatuses[step.id]
          const isActive = activeStep === step.id
          return (
            <React.Fragment key={step.id}>
              <button
                onClick={() => setActiveStep(step.id)}
                className="flex flex-col items-center gap-1 flex-shrink-0"
              >
                <div
                  className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors',
                    status === 'complete'
                      ? 'bg-success border-success text-success-foreground'
                      : status === 'blocked'
                        ? 'bg-destructive border-destructive text-white'
                        : isActive
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-background border-border text-muted-foreground',
                  )}
                >
                  {status === 'complete' ? (
                    <Check className="h-4 w-4" />
                  ) : status === 'blocked' ? (
                    <X className="h-4 w-4" />
                  ) : (
                    step.order
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium whitespace-nowrap',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </button>

              {i < PAYROLL_STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-1 min-w-4',
                    stepStatuses[PAYROLL_STEPS[i].id] === 'complete'
                      ? 'bg-success'
                      : 'bg-muted',
                  )}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step content panel */}
      <div className="flex-1 overflow-y-auto">{renderStepContent()}</div>
    </div>
  )
}
