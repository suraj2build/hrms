/* eslint-disable react-refresh/only-export-components -- co-locates the useEmployeeTrust hook with the summary component that renders its data */
/**
 * TrustSummary — O5.7.
 *
 * Displays the full trust breakdown (score, strengths, risks, recommendations,
 * audit_signals) for a single employee. Consumes GET /employees/:id/trust.
 *
 * Passive / read-only — never modifies employee data.
 * Designed to be embedded inside Employee360Tab after ReadinessCard.
 */

import { useQuery }   from '@tanstack/react-query'
import { api }        from '@/lib/api/client'
import {
  ShieldCheck, ShieldAlert, ShieldX, CircleDot,
  CheckCircle2, AlertTriangle, Info, Loader2, ListChecks,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrustAuditSignal {
  signal:      string
  source:      string
  occurred_at: string
  detail?:     string
}

interface TrustBreakdown {
  score_type:      string
  entity_id:       string
  tenant_id:          string
  score:           number | null
  severity:        'low' | 'medium' | 'high' | 'critical' | null
  factors:         string[]
  strengths:       string[]
  risks:           string[]
  recommendations: string[]
  audit_signals:   TrustAuditSignal[]
  computed_at:     string | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEmployeeTrust(employeeId: string | null) {
  return useQuery({
    queryKey: ['employee-trust', employeeId],
    queryFn: () => api.get<{ data: TrustBreakdown }>(`/employees/${employeeId}/trust`).then(r => r.data),
    enabled:   !!employeeId,
    staleTime: 120_000,
  })
}

// ── Severity helpers ──────────────────────────────────────────────────────────

function severityColor(s: string | null): string {
  switch (s) {
    case 'low':      return 'text-success dark:text-success'
    case 'medium':   return 'text-warning dark:text-warning'
    case 'high':     return 'text-accent-coral dark:text-accent-coral'
    case 'critical': return 'text-destructive dark:text-destructive'
    default:         return 'text-muted-foreground'
  }
}

function SeverityIcon({ severity, className }: { severity: string | null; className?: string }) {
  const cls = cn('h-5 w-5', severityColor(severity), className)
  switch (severity) {
    case 'low':      return <ShieldCheck className={cls} />
    case 'medium':   return <ShieldAlert className={cls} />
    case 'high':
    case 'critical': return <ShieldX className={cls} />
    default:         return <CircleDot className={cls} />
  }
}

// ── Sub-sections ──────────────────────────────────────────────────────────────

function BulletList({ items, icon: Icon, iconClass }: {
  items: string[]
  icon:  React.ComponentType<{ className?: string }>
  iconClass: string
}) {
  if (items.length === 0) return null
  return (
    <ul className="space-y-1">
      {items.map((text, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-foreground">
          <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', iconClass)} />
          {text}
        </li>
      ))}
    </ul>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrustSummary({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError } = useEmployeeTrust(employeeId)

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading trust data…
    </div>
  )

  if (isError || !data) return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
      Trust data unavailable — no evaluation has been run yet.
    </div>
  )

  const { score, severity, strengths, risks, recommendations, audit_signals, computed_at } = data

  return (
    <div className="space-y-3">
      {/* Score header */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          <SeverityIcon severity={severity} />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Trust score: {score != null ? `${score}/100` : '—'}
            </p>
            {severity && (
              <p className={cn('text-xs capitalize', severityColor(severity))}>
                {severity} risk
              </p>
            )}
          </div>
        </div>
        {computed_at && (
          <p className="text-[10px] text-muted-foreground">
            {new Date(computed_at).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Strengths + Risks side by side */}
      {(strengths.length > 0 || risks.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {strengths.length > 0 && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-success uppercase tracking-wide">Strengths</p>
              <BulletList items={strengths} icon={CheckCircle2} iconClass="text-success" />
            </div>
          )}
          {risks.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-warning uppercase tracking-wide">Risks</p>
              <BulletList items={risks} icon={AlertTriangle} iconClass="text-warning" />
            </div>
          )}
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5 text-[#2E6FE6]" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recommendations</p>
          </div>
          <BulletList items={recommendations} icon={Info} iconClass="text-[#2E6FE6]" />
        </div>
      )}

      {/* Audit trail (collapsed by default for space) */}
      {audit_signals.length > 0 && (
        <details className="group rounded-lg border border-border bg-card">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <CircleDot className="h-3.5 w-3.5 text-[#2E6FE6]" />
            Audit trail ({audit_signals.length} signal{audit_signals.length !== 1 ? 's' : ''})
          </summary>
          <div className="px-3 pb-3 space-y-1 border-t border-border mt-0 pt-2">
            {audit_signals.map((s, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-xs">
                <span className="font-mono text-[#2E6FE6]">{s.signal}</span>
                <span className="text-muted-foreground text-right shrink-0">
                  {new Date(s.occurred_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default TrustSummary
