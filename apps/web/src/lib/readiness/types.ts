/**
 * Readiness Framework — Core Types
 *
 * The readiness system is a frontend intelligence layer that derives
 * operational state from cached TanStack Query data and surfaces
 * actionable guidance without requiring new backend APIs.
 *
 * Architecture:
 *   Evaluator (pure fn) → checks[] → computeDomainReadiness() → DomainReadiness
 *   Hook (TanStack Query) → fires queries → calls evaluator → returns DomainReadiness
 *   Component (UI) → consumes DomainReadiness → renders guidance
 */

// ── Domain identifiers ────────────────────────────────────────────────────────

export type ReadinessDomain =
  | 'organization'   // Sites, work locations, depts, cost centers
  | 'workforce'      // Employees, compensation, documents, bank
  | 'attendance'     // Shifts, rosters, assignments, punch data
  | 'leave'          // Leave types, policies, opening balances
  | 'payroll'        // Salary structures, components, runs
  | 'compliance'     // EPF, ESI, PT, statutory groups
  | 'imports'        // Import readiness, dependency order

// ── Check-level types ─────────────────────────────────────────────────────────

/** How severe is a failing check? */
export type ReadinessSeverity = 'blocker' | 'warning' | 'info'

/** The computed state of a readiness check */
export type ReadinessStatus =
  | 'ok'       // Check passes
  | 'warning'  // Check passes but with caveats
  | 'error'    // Check fails — action required
  | 'unknown'  // Cannot evaluate (data not yet available)

export interface ReadinessCheck {
  /** Unique check identifier, e.g. 'org-sites' */
  id:             string
  /** Short human-readable label, e.g. "Sites configured" */
  label:          string
  status:         ReadinessStatus
  severity:       ReadinessSeverity
  /** If true, this check must pass before downstream operations are safe */
  isBlocking:     boolean
  /** Human-readable value context, e.g. "4 of 12 employees" or "0 sites" */
  value?:         number | string
  /** What action to take to resolve this check */
  recommendation?: string
  /** CTA button label */
  actionLabel?:   string
  /** Deep-link to the screen that resolves this check */
  actionPath?:    string
  /** Explains which upstream domain this check depends on */
  dependsOn?:     ReadinessDomain
  /** Optional detail line (shown in expanded views) */
  detail?:        string
}

// ── Domain-level readiness ────────────────────────────────────────────────────

export interface DomainReadiness {
  domain:      ReadinessDomain
  label:       string
  description: string
  /** 0–100: proportion of non-unknown checks that pass */
  score:       number
  /** Domain is operationally ready (no blockers, score ≥ 60) */
  isReady:     boolean
  /** Domain has never been configured at all (all checks unknown/error, no data) */
  isEmpty:     boolean
  isLoading:   boolean
  checks:      ReadinessCheck[]
  /** Checks that are blocking AND failing/erroring */
  blockers:    ReadinessCheck[]
  /** Non-blocking checks in warning state */
  warnings:    ReadinessCheck[]
  /** Highest-priority unresolved check — surface as "next action" */
  nextAction?: ReadinessCheck
}

// ── Workflow sequencing ───────────────────────────────────────────────────────

export type WorkflowStepStatus = 'complete' | 'in_progress' | 'blocked' | 'pending'

export interface WorkflowStep {
  id:          string
  label:       string
  description?: string
  status:      WorkflowStepStatus
  /** Blockers preventing this step from being complete */
  blockers?:   string[]
  /** Where to navigate to action this step */
  actionPath?: string
  actionLabel?: string
}

export interface WorkflowSequenceDef {
  id:    string
  label: string
  steps: WorkflowStep[]
}
