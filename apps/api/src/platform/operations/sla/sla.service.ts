/**
 * SlaService — enterprise SLA tracking and breach detection.
 * Tracks time-based operational obligations.
 * Generates SLA breach events for observability — never blocks operations.
 */
import type { SlaDefinition, SlaStatus, SlaBreachEvent } from '../types/operations-types.js'
import { explainabilityService }                          from '../../ai/services/explainability.service.js'

const DEFAULT_SLAS: SlaDefinition[] = [
  { sla_id: 'approval-pending',     name: 'Approval Pending',          entity_type: 'leave_request',  threshold_hours: 48,  severity_on_breach: 'high' },
  { sla_id: 'incident-open',        name: 'Open Incident',             entity_type: 'incident',        threshold_hours: 72,  severity_on_breach: 'high' },
  { sla_id: 'payroll-review',       name: 'Payroll Review',            entity_type: 'payroll_run',     threshold_hours: 24,  severity_on_breach: 'critical' },
  { sla_id: 'compliance-review',    name: 'Compliance Review',         entity_type: 'compliance_eval', threshold_hours: 168, severity_on_breach: 'warning' },
  { sla_id: 'verification-pending', name: 'Verification Pending',      entity_type: 'verification',    threshold_hours: 24,  severity_on_breach: 'warning' },
]

export class SlaService {
  private readonly definitions: SlaDefinition[] = [...DEFAULT_SLAS]
  private readonly tracked: Map<string, SlaStatus> = new Map()
  private readonly breaches: SlaBreachEvent[] = []

  registerSla(sla: SlaDefinition): void { this.definitions.push(sla) }

  /** Start tracking an entity against an SLA. */
  track(slaId: string, entityId: string, entityType: string, orgId: string, startedAt?: string): void {
    const sla = this.definitions.find(d => d.sla_id === slaId)
    if (!sla) return
    const start = new Date(startedAt ?? new Date().toISOString())
    const due   = new Date(start.getTime() + sla.threshold_hours * 3_600_000)
    this.tracked.set(`${slaId}:${entityId}`, {
      sla_id:          slaId,
      entity_id:       entityId,
      entity_type:     entityType,
      tenant_id:          orgId,
      started_at:      start.toISOString(),
      due_at:          due.toISOString(),
      breached:        false,
      hours_elapsed:   0,
      hours_remaining: sla.threshold_hours,
    })
  }

  /** Stop tracking (entity resolved). */
  resolve(slaId: string, entityId: string): void {
    this.tracked.delete(`${slaId}:${entityId}`)
  }

  /** Scan all tracked items and emit breach events for overdue ones. */
  scanBreaches(): SlaBreachEvent[] {
    const now = Date.now()
    const newBreaches: SlaBreachEvent[] = []
    for (const [, status] of this.tracked.entries()) {
      const due = new Date(status.due_at).getTime()
      const elapsed = (now - new Date(status.started_at).getTime()) / 3_600_000
      const remaining = Math.max(0, (due - now) / 3_600_000)

      // Update elapsed/remaining
      status.hours_elapsed   = elapsed
      status.hours_remaining = remaining

      if (now > due && !status.breached) {
        status.breached = true
        const sla = this.definitions.find(d => d.sla_id === status.sla_id)
        const breach: SlaBreachEvent = {
          sla_id:          status.sla_id,
          entity_id:       status.entity_id,
          entity_type:     status.entity_type,
          tenant_id:          status.tenant_id,
          breach_severity: sla?.severity_on_breach ?? 'warning',
          description:     `${sla?.name ?? status.sla_id} SLA breached — ${elapsed.toFixed(1)}h elapsed (threshold: ${sla?.threshold_hours}h)`,
          breached_at:     new Date().toISOString(),
          explainability:  explainabilityService.explain({
            event_type:  `sla.breach.${status.sla_id}`,
            entity_type: status.entity_type,
            entity_id:   status.entity_id,
            payload:     { hours_elapsed: elapsed, threshold_hours: sla?.threshold_hours },
            severity:    sla?.severity_on_breach ?? 'warning',
          }),
        }
        newBreaches.push(breach)
        this.breaches.push(breach)
      }
    }
    return newBreaches
  }

  getTracked(orgId?: string): SlaStatus[] {
    const all = [...this.tracked.values()]
    return orgId ? all.filter(s => s.tenant_id === orgId) : all
  }

  getBreaches(orgId?: string): SlaBreachEvent[] {
    return orgId ? this.breaches.filter(b => b.tenant_id === orgId) : [...this.breaches]
  }

  getDefinitions(): SlaDefinition[] { return [...this.definitions] }
}

export const slaService = new SlaService()
