/**
 * Readiness Framework — Scoring + Domain Assembler
 */
import type { ReadinessCheck, DomainReadiness, ReadinessDomain } from './types'

// ── Domain metadata ───────────────────────────────────────────────────────────

export const DOMAIN_META: Record<ReadinessDomain, { label: string; description: string }> = {
  organization: {
    label:       'Organization',
    description: 'Sites, work locations, departments, cost centers',
  },
  workforce: {
    label:       'Workforce',
    description: 'Employees, compensation, documents, bank details',
  },
  attendance: {
    label:       'Attendance',
    description: 'Shifts, rosters, assignments, attendance records',
  },
  leave: {
    label:       'Leave',
    description: 'Leave types, policies, opening balances',
  },
  payroll: {
    label:       'Payroll',
    description: 'Salary structures, components, payroll runs',
  },
  compliance: {
    label:       'Compliance',
    description: 'EPF, ESI, PT, statutory groups, PAN/UAN completeness',
  },
  imports: {
    label:       'Import Readiness',
    description: 'Upload order, dependency checks, data completeness',
  },
}

// ── Score + domain assembly ───────────────────────────────────────────────────

/**
 * Assembles a DomainReadiness object from an array of ReadinessCheck results.
 * Scoring: proportion of "scorable" checks (non-unknown) that are ok/warning-only.
 */
export function computeDomainReadiness(
  domain:    ReadinessDomain,
  checks:    ReadinessCheck[],
  isLoading  = false,
): DomainReadiness {
  const { label, description } = DOMAIN_META[domain]

  if (isLoading) {
    return {
      domain, label, description,
      score: 0, isReady: false, isEmpty: false, isLoading: true,
      checks: [], blockers: [], warnings: [], nextAction: undefined,
    }
  }

  const scorable = checks.filter(c => c.status !== 'unknown')
  const okCount  = scorable.filter(c => c.status === 'ok').length

  // Weighted score: ok = full point, warning = half point
  const warningCount = scorable.filter(c => c.status === 'warning').length
  const weightedOk   = okCount + warningCount * 0.5
  const score        = scorable.length === 0 ? 0
    : Math.round((weightedOk / scorable.length) * 100)

  const blockers = checks.filter(c => c.isBlocking && (c.status === 'error'))
  const warnings = checks.filter(c => !c.isBlocking && c.status === 'warning')

  // isEmpty: all checks are unknown or all are error with no ok
  const isEmpty = scorable.length === 0 || (okCount === 0 && scorable.every(c => c.status === 'error'))

  const isReady = blockers.length === 0 && score >= 60

  // nextAction: first blocker, then first error, then first warning
  const nextAction: ReadinessCheck | undefined =
    blockers[0] ??
    checks.find(c => c.status === 'error') ??
    warnings[0] ??
    undefined

  return {
    domain, label, description, score,
    isReady, isEmpty, isLoading: false,
    checks, blockers, warnings, nextAction,
  }
}

// ── Platform-wide score ───────────────────────────────────────────────────────

/** Average score across all provided domain readiness objects (excluding loading ones). */
export function computePlatformScore(domains: DomainReadiness[]): number {
  const loaded = domains.filter(d => !d.isLoading && !d.isEmpty)
  if (loaded.length === 0) return 0
  return Math.round(loaded.reduce((sum, d) => sum + d.score, 0) / loaded.length)
}
