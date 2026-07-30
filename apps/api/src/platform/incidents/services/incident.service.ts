/**
 * IncidentService — thin service layer over the existing operational_incidents table.
 *
 * The incidents table and full REST API already exist in:
 *   apps/api/src/routes/system/incidents.ts
 *
 * This service provides programmatic access for governance listeners
 * that need to auto-create incidents from rule violations.
 *
 * It does NOT duplicate or replace the existing REST routes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventSeverity }  from '../../events/types/platform-event.js'

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'

function toIncidentSeverity(s: EventSeverity): IncidentSeverity {
  if (s === 'info')    return 'low'
  if (s === 'warning') return 'medium'
  return s  // 'high' | 'critical' pass through
}

// Must match operational_incidents.incident_type's CHECK constraint exactly
// (supabase/migrations/090_operational_incidents.sql) — createFromGovernance
// takes incident_type as a bare string with no caller-side validation, and
// a violating value would otherwise fail the INSERT silently (the error is
// logged and swallowed, returning null with no signal to the governance
// action that triggered it).
const VALID_INCIDENT_TYPES = new Set([
  'payroll_impact', 'staffing_shortage', 'attendance_integrity', 'sla_breach_escalated',
  'workforce_overload', 'shift_imbalance', 'system_outage', 'compliance_breach',
  'data_anomaly', 'integration_failure',
])

export interface CreateIncidentInput {
  tenantId:            string
  incident_type:       string
  severity:            EventSeverity
  title:               string
  description:         string
  employee_id?:        string
  related_entity_type?: string
  related_entity_id?:  string
  tags?:               string[]
  metadata?:           Record<string, unknown>
  created_by?:         string
}

export class IncidentService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Create an incident from a governance rule violation.
   * Non-fatal — errors are logged and swallowed.
   */
  async createFromGovernance(input: CreateIncidentInput): Promise<string | null> {
    if (!VALID_INCIDENT_TYPES.has(input.incident_type)) {
      console.warn('[IncidentService] refusing to create incident with unknown incident_type', {
        incident_type: input.incident_type,
      })
      return null
    }

    const { data, error } = await this.supabase
      .from('operational_incidents')
      .insert({
        tenant_id:           input.tenantId,
        incident_type:       input.incident_type,
        severity:            toIncidentSeverity(input.severity),
        title:               input.title,
        description:         input.description,
        status:              'open',
        employee_id:         input.employee_id         ?? null,
        related_entity_type: input.related_entity_type ?? null,
        related_entity_id:   input.related_entity_id   ?? null,
        tags:                input.tags                ?? null,
        metadata:            input.metadata            ?? null,
        sla_breached:        false,
        created_by:          input.created_by          ?? null,
        created_at:          new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      console.warn('[IncidentService] failed to create incident', {
        type:  input.incident_type,
        error: error.message,
      })
      return null
    }

    return (data as any)?.id ?? null
  }

  /**
   * Link two incidents as related (e.g. same entity, close in time).
   * Non-fatal — errors are swallowed.
   */
  async linkRelatedIncidents(
    incidentId:        string,
    relatedIncidentId: string,
    tenantId:          string,
  ): Promise<void> {
    const { data, error: fetchError } = await this.supabase
      .from('operational_incidents')
      .select('metadata')
      .eq('id', incidentId)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      console.warn('[IncidentService] failed to fetch incident for linking', { incidentId, error: fetchError.message })
      return
    }
    if (!data) return

    const meta     = (data as any).metadata ?? {}
    const related: string[] = meta.related_incidents ?? []
    if (!related.includes(relatedIncidentId)) {
      related.push(relatedIncidentId)
    }

    const { error: updateError } = await this.supabase
      .from('operational_incidents')
      .update({
        metadata:   { ...meta, related_incidents: related },
        updated_at: new Date().toISOString(),
      })
      .eq('id', incidentId)
      .eq('tenant_id', tenantId)

    if (updateError) {
      console.warn('[IncidentService] failed to link related incident', { incidentId, relatedIncidentId, error: updateError.message })
    }
  }

  /**
   * Get incidents for an entity (entity_type + entity_id) for correlation.
   */
  async getEntityIncidents(
    tenantId:   string,
    entityType: string,
    entityId:   string,
    limit = 20,
  ): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('operational_incidents')
      .select('id, incident_type, severity, title, status, created_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('related_entity_type', entityType)
      .eq('related_entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      // Non-fatal by design (mirrors createFromGovernance/linkRelatedIncidents),
      // but logged so a query failure isn't silently indistinguishable from
      // "no matching incidents" — the caller (detectPatternAndEscalate) uses
      // this to decide whether to escalate.
      console.warn('[IncidentService] failed to fetch entity incidents', { tenantId, entityType, entityId, error: error.message })
      return []
    }
    return data ?? []
  }

  /**
   * Detect repeated incident patterns for an entity and return true if threshold met.
   * Useful for escalation decisions.
   */
  async detectPatternAndEscalate(
    tenantId:      string,
    entityType:    string,
    entityId:      string,
    incidentType:  string,
    thresholdCount = 3,
  ): Promise<boolean> {
    const incidents   = await this.getEntityIncidents(tenantId, entityType, entityId, 50)
    const matchCount  = incidents.filter(
      i => i.incident_type === incidentType && i.status !== 'resolved',
    ).length
    return matchCount >= thresholdCount
  }
}
