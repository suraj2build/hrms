/**
 * PolicyChain — policy precedence visualizer + "why this rule applied" explainer.
 *
 * Renders the 5-level precedence hierarchy visually, highlights the resolved
 * level, explains why that level took precedence, and optionally shows the
 * full candidate evaluation chain from the API.
 *
 * Usage:
 *   <PolicyChain resolution={policyResolution} />
 *   <PolicyExplainPanel resolution={resolution} compact />
 */
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, Info, ShieldCheck,
  AlertTriangle, Users, MapPin, Building2, Globe,
} from 'lucide-react'
import { useState } from 'react'
import { Badge }    from '@/components/ui/badge'
import { cn }       from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PolicyResolvedVia = 'employee' | 'department' | 'work_location' | 'default' | 'legacy' | 'none'

export interface PolicyCandidate {
  policy_id?:     string
  policy_name?:   string
  scope_type?:    PolicyResolvedVia
  scope_id?:      string
  priority_rank?: number
  skipped_reason?: string
}

export interface PolicyResolutionInfo {
  policy_id:       string | null
  policy_name:     string | null
  policy_version?: number | null
  source:          PolicyResolvedVia
  resolved_from?:  string | null
  is_simulation?:  boolean
  evaluated_candidates?: PolicyCandidate[]
  rules?:          Array<{
    leave_type_name?: string
    max_days_per_year?: number
    carry_forward?: boolean
    eligible?: boolean
    eligibility_reason?: string
  }>
}

// ── Precedence levels ─────────────────────────────────────────────────────────

interface PrecedenceLevel {
  key:         PolicyResolvedVia
  label:       string
  description: string
  rank:        number   // 1 = most specific
}

const LEVELS: PrecedenceLevel[] = [
  { key: 'employee',      label: 'Employee Override', description: 'A policy assigned directly to this individual employee.',              rank: 1 },
  { key: 'department',    label: 'Department Policy', description: 'A policy assigned to the employee\'s department.',                     rank: 2 },
  { key: 'work_location', label: 'Work Location Policy', description: 'A policy assigned to the employee\'s current work location.',       rank: 3 },
  { key: 'default',       label: 'Organization Default', description: 'The default policy applied to all employees without a specific assignment.', rank: 4 },
  { key: 'legacy',        label: 'Legacy / Fallback', description: 'A legacy policy resolved from direct rule assignments without scoping.', rank: 5 },
]

// ── Helper ─────────────────────────────────────────────────────────────────────

function resolvedDescription(source: PolicyResolvedVia, policyName: string | null, resolvedFrom?: string | null): string {
  const name = policyName ?? 'Unknown Policy'
  switch (source) {
    case 'employee':
      return `Policy "${name}" is applied because it was directly assigned to this employee, overriding all broader assignments.`
    case 'department':
      return `Policy "${name}" was matched via the employee's department${resolvedFrom ? ` (${resolvedFrom})` : ''}, as no individual employee override exists.`
    case 'work_location':
      return `Policy "${name}" was matched via the employee's work location${resolvedFrom ? ` (${resolvedFrom})` : ''}, as no department-level assignment exists.`
    case 'default':
      return `Policy "${name}" is the organization-wide default, applied because no employee, department, or location assignment matched.`
    case 'legacy':
      return `Policy "${name}" was resolved via a legacy direct-assignment rule. Consider migrating to scoped assignments.`
    case 'none':
      return `No matching policy was found at any precedence level. The employee may not be entitled to any leave under the current configuration.`
    default:
      return `Policy resolved via ${source}.`
  }
}

// ── Precedence hierarchy component ───────────────────────────────────────────

function PrecedenceHierarchy({ source }: { source: PolicyResolvedVia }) {
  const resolvedIndex = LEVELS.findIndex(l => l.key === source)

  return (
    <div className="space-y-1">
      {LEVELS.map((level, i) => {
        const isResolved  = level.key === source
        const isSkipped   = resolvedIndex >= 0 && i > resolvedIndex
        const isAbove     = resolvedIndex >= 0 && i < resolvedIndex

        return (
          <div key={level.key} className="flex items-center gap-2">
            {/* Connector line */}
            <div className="flex flex-col items-center w-4">
              {i > 0 && <div className="w-px h-2.5 bg-border/50" />}
              <div className={cn(
                'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                isResolved ? 'bg-primary'               :
                isAbove    ? 'bg-muted-foreground/20'   :
                'bg-muted/40',
              )}>
                {isResolved
                  ? <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                  : <Circle className={cn('h-2 w-2', isSkipped ? 'text-muted-foreground/20' : 'text-muted-foreground/40')} />
                }
              </div>
            </div>

            {/* Label */}
            <div className={cn(
              'flex-1 px-2.5 py-1.5 rounded-md text-xs transition-colors',
              isResolved ? 'bg-primary/10 border border-primary/30' :
              isAbove    ? 'bg-muted/20 text-muted-foreground/50'  :
              'bg-muted/10 text-muted-foreground/40',
            )}>
              <div className="flex items-center justify-between">
                <span className={cn('font-medium', isResolved ? 'text-primary' : '')}>
                  {level.label}
                </span>
                <span className={cn(
                  'text-[9px] font-mono',
                  isResolved ? 'text-primary/70' : 'text-muted-foreground/30'
                )}>
                  L{level.rank}
                </span>
              </div>
              {isResolved && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{level.description}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Candidate chain (debug / full trace) ─────────────────────────────────────

function CandidateChain({ candidates }: { candidates: PolicyCandidate[] }) {
  if (!candidates.length) return (
    <p className="text-xs text-muted-foreground">No candidate evaluation data available.</p>
  )

  return (
    <div className="space-y-1.5">
      {candidates.map((c, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md',
            c.skipped_reason ? 'bg-muted/20 opacity-60' : 'bg-success/10 border border-success/20',
          )}
        >
          <div>
            <span className="font-medium text-foreground">{c.policy_name ?? 'Unknown'}</span>
            {c.scope_type && (
              <Badge variant="outline" className="ml-1.5 text-[9px] rounded-full">{c.scope_type}</Badge>
            )}
          </div>
          {c.skipped_reason ? (
            <span className="text-[10px] text-muted-foreground italic">{c.skipped_reason}</span>
          ) : (
            <CheckCircle2 className="h-3 w-3 text-success" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── "Why this rule" explainer ─────────────────────────────────────────────────

export function PolicyExplainPanel({
  resolution,
  compact = false,
}: {
  resolution:  PolicyResolutionInfo
  compact?:    boolean
}) {
  const [showChain, setShowChain] = useState(false)
  const [showHierarchy, setShowHierarchy] = useState(!compact)

  const hasResolution = resolution.source !== 'none' && !!resolution.policy_name

  return (
    <div className="space-y-3">
      {/* Simulation badge */}
      {resolution.is_simulation && (
        <Badge variant="warning" className="rounded-full text-xs gap-1">
          <Info className="h-3 w-3" />
          Simulation Mode
        </Badge>
      )}

      {/* "Why this rule applied" box */}
      <div className={cn(
        'rounded-md border p-3 text-xs',
        hasResolution
          ? 'bg-primary/5 border-primary/20'
          : 'bg-muted/30 border-border',
      )}>
        <div className="flex items-start gap-2">
          <ShieldCheck className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', hasResolution ? 'text-primary' : 'text-muted-foreground')} />
          <div className="space-y-1">
            {hasResolution ? (
              <>
                <p className="font-semibold text-foreground">
                  Applied: {resolution.policy_name}
                  {resolution.policy_version != null && (
                    <span className="ml-1 text-muted-foreground font-normal">v{resolution.policy_version}</span>
                  )}
                </p>
                <p className="text-muted-foreground leading-snug">
                  {resolvedDescription(resolution.source, resolution.policy_name, resolution.resolved_from)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                {resolvedDescription('none', null)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Precedence hierarchy */}
      {!compact && (
        <div>
          <button
            onClick={() => setShowHierarchy(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            {showHierarchy ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Policy precedence hierarchy
          </button>
          {showHierarchy && <PrecedenceHierarchy source={resolution.source} />}
        </div>
      )}

      {/* Candidate chain */}
      {resolution.evaluated_candidates && resolution.evaluated_candidates.length > 0 && (
        <div>
          <button
            onClick={() => setShowChain(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            {showChain ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Evaluation chain ({resolution.evaluated_candidates.length} candidates)
          </button>
          {showChain && <CandidateChain candidates={resolution.evaluated_candidates} />}
        </div>
      )}

      {/* Resolved rules summary */}
      {resolution.rules && resolution.rules.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Effective Rules
            </p>
          </div>
          {resolution.rules.slice(0, 5).map((r, i) => (
            <div key={i} className={cn('px-3 py-2 border-b border-border/40 last:border-0 text-xs', !r.eligible ? 'opacity-50' : '')}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{r.leave_type_name ?? `Rule ${i + 1}`}</span>
                {r.eligible === false ? (
                  <Badge variant="destructive" className="text-[9px] rounded-full">Not eligible</Badge>
                ) : (
                  <Badge variant="success" className="text-[9px] rounded-full">Active</Badge>
                )}
              </div>
              <div className="text-muted-foreground mt-0.5 flex gap-3">
                {r.max_days_per_year != null && <span>{r.max_days_per_year} days/yr</span>}
                {r.carry_forward != null && <span>Carry-forward: {r.carry_forward ? 'Yes' : 'No'}</span>}
                {r.eligibility_reason && <span className="text-destructive">{r.eligibility_reason}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Full policy chain page block ─────────────────────────────────────────────

export function PolicyChain({ resolution, title = 'Policy Resolution' }: {
  resolution:  PolicyResolutionInfo
  title?:      string
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <PolicyExplainPanel resolution={resolution} />
    </div>
  )
}

// ── Policy Scope Matrix ────────────────────────────────────────────────────────

/**
 * Lightweight summary record for the scope matrix — derived from whatever
 * policy-master list data the parent has already fetched.
 */
export interface PolicyScopeSummary {
  id:               string
  name:             string
  is_default:       boolean
  status:           string
  assignment_count: number
  /** Granular scope counts — optional; show '?' when absent */
  scopes?: {
    employee?:      number
    department?:    number
    work_location?: number
  }
}

interface ScopeColumn {
  key:         'employee' | 'department' | 'work_location' | 'org_default'
  label:       string
  icon:        React.ComponentType<{ className?: string }>
  description: string
}

const SCOPE_COLS: ScopeColumn[] = [
  { key: 'org_default',   label: 'Org Default',    icon: Globe,      description: 'Applies to all employees unless overridden at a narrower scope' },
  { key: 'work_location', label: 'Work Location',  icon: MapPin,     description: 'Applies to employees at a specific office / site' },
  { key: 'department',    label: 'Department',     icon: Building2,  description: 'Applies to all employees in a department' },
  { key: 'employee',      label: 'Individual',     icon: Users,      description: 'Applies to a specific employee — highest precedence' },
]

function ScopeCell({
  count,
  isDefault,
}: {
  count:     number | undefined | null
  isDefault: boolean
}) {
  if (isDefault) {
    return (
      <div className="flex justify-center">
        <Badge variant="success" className="text-[9px] rounded-full">Default</Badge>
      </div>
    )
  }
  if (count == null) {
    return <span className="text-[10px] text-muted-foreground/40 block text-center">?</span>
  }
  if (count === 0) {
    return <span className="text-[10px] text-muted-foreground/30 block text-center">—</span>
  }
  return (
    <div className="flex justify-center">
      <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5">
        {count}
      </span>
    </div>
  )
}

/**
 * PolicyScopeMatrix — visualizes which organizational scope levels each
 * policy covers. Shows coverage gaps (policies with no assignments at any
 * specific scope fall back to the default — yellow warning).
 *
 * Usage in LeavePolicyEngine:
 *   <PolicyScopeMatrix policies={masters} />
 */
export function PolicyScopeMatrix({ policies }: { policies: PolicyScopeSummary[] }) {
  const published = policies.filter(p => p.status === 'published')
  const draft     = policies.filter(p => p.status !== 'published' && p.status !== 'archived')

  const defaultPolicy = published.find(p => p.is_default)
  const noDefault     = published.length > 0 && !defaultPolicy

  if (policies.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground text-xs">
        <ShieldCheck className="h-8 w-8 opacity-30" />
        <p>No policies created yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Coverage warnings */}
      {noDefault && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          No published org-default policy found — employees with no specific assignment will have no policy applied.
        </div>
      )}
      {draft.length > 0 && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-warning/10 border border-warning/20 text-warning">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          {draft.length} polic{draft.length === 1 ? 'y' : 'ies'} not yet published (draft/review) — not active in production.
        </div>
      )}

      {/* Scope legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1">
        {SCOPE_COLS.map(col => (
          <div key={col.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <col.icon className="h-3 w-3 flex-shrink-0" />
            <span title={col.description}>{col.label}</span>
          </div>
        ))}
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground min-w-[160px]">Policy</th>
              {SCOPE_COLS.map(col => (
                <th key={col.key} className="text-center px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <col.icon className="h-3 w-3" />
                    <span className="hidden sm:inline">{col.label}</span>
                  </div>
                </th>
              ))}
              <th className="text-center px-2 py-2 font-semibold text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {policies
              .filter(p => p.status !== 'archived')
              .map((policy, i) => {
                const isActive  = policy.status === 'published'
                const noAssign  = !policy.is_default && policy.assignment_count === 0
                return (
                  <tr
                    key={policy.id}
                    className={cn(
                      'border-b border-border/50 last:border-0',
                      i % 2 === 0 ? 'bg-card' : 'bg-muted/10',
                      !isActive && 'opacity-60',
                    )}
                  >
                    {/* Policy name */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                          policy.status === 'published' ? 'bg-success' :
                          policy.status === 'review'    ? 'bg-warning'  :
                          'bg-muted-foreground/40'
                        )} />
                        <span className={cn('font-medium', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                          {policy.name}
                        </span>
                        {noAssign && isActive && (
                          <span title="No assignments — only reachable via default fallback">
                            <AlertTriangle className="h-3 w-3 text-warning flex-shrink-0" />
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-muted-foreground ml-3.5 mt-0.5 uppercase tracking-wide">
                        {policy.status}
                      </div>
                    </td>

                    {/* Scope cells */}
                    <td className="px-2 py-2 text-center">
                      <ScopeCell count={policy.is_default ? 1 : 0} isDefault={policy.is_default} />
                    </td>
                    <td className="px-2 py-2">
                      <ScopeCell count={policy.scopes?.work_location} isDefault={false} />
                    </td>
                    <td className="px-2 py-2">
                      <ScopeCell count={policy.scopes?.department} isDefault={false} />
                    </td>
                    <td className="px-2 py-2">
                      <ScopeCell count={policy.scopes?.employee} isDefault={false} />
                    </td>

                    {/* Total assignments */}
                    <td className="px-2 py-2 text-center">
                      {policy.is_default ? (
                        <span className="text-[10px] text-muted-foreground">org-wide</span>
                      ) : (
                        <span className={cn(
                          'text-[10px] font-semibold tabular-nums',
                          policy.assignment_count > 0 ? 'text-foreground' : 'text-muted-foreground/40'
                        )}>
                          {policy.assignment_count}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground pt-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" /> Published</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning inline-block" /> In Review</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" /> Draft</span>
        <span className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 text-warning" /> Published but no assignments (unreachable unless default)</span>
      </div>
    </div>
  )
}

// ── StatusChangePill — compact before/after status widget ─────────────────────

/**
 * Inline before/after pill for use in audit trail rows.
 * Imported by AttendanceTimeline via `import { StatusChangePill }`.
 */
export function StatusChangePill({
  before,
  after,
}: {
  before: string | null
  after:  string
}) {
  const STATUS_LABEL: Record<string, string> = {
    present:    'Present', late: 'Late', absent: 'Absent',
    half_day:   'Half Day', leave: 'Leave', holiday: 'Holiday',
    weekend:    'Weekend', weekly_off: 'Weekly Off',
  }
  const STATUS_CLS: Record<string, string> = {
    present:    'bg-success/15 text-success border-success/25',
    late:       'bg-warning/15 text-warning border-warning/25',
    absent:     'bg-destructive/15 text-destructive border-destructive/25',
    half_day:   'bg-muted text-muted-foreground border-border',
    leave:      'bg-info/15 text-info border-info/25',
    holiday:    'bg-info/15 text-info border-info/25',
    weekend:    'bg-muted/40 text-muted-foreground/50 border-border/30',
    weekly_off: 'bg-muted/40 text-muted-foreground/50 border-border/30',
  }
  const chip = (val: string | null) =>
    val ? (
      <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold', STATUS_CLS[val] ?? 'bg-muted text-foreground border-border')}>
        {STATUS_LABEL[val] ?? val}
      </span>
    ) : (
      <span className="text-[10px] text-muted-foreground/40 italic">—</span>
    )

  return (
    <span className="inline-flex items-center gap-1.5">
      {chip(before)}
      <span className="text-[10px] text-muted-foreground/40">→</span>
      {chip(after)}
    </span>
  )
}
