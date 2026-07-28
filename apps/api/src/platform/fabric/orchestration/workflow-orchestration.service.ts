/**
 * WorkflowOrchestrationService — coordinates workflows across modules.
 * MAY coordinate, sequence, recommend, escalate.
 * MAY NOT bypass existing approval systems or mutate payroll/records.
 */
import { randomUUID }            from 'crypto'
import type { SupabaseClient }   from '@supabase/supabase-js'
import type { OrchestrationActivity, OrchestrationWorkflowType, OrchestrationStep } from '../types/fabric-types.js'
import { slaService }            from '../../operations/sla/sla.service.js'
import { explainabilityService } from '../../ai/services/explainability.service.js'

export class WorkflowOrchestrationService {
  /**
   * Start an orchestration activity for a workflow.
   * Persists to orchestration_activity_logs table.
   */
  async startOrchestration(supabase: SupabaseClient, params: {
    tenant_id:         string
    workflow_type:  OrchestrationWorkflowType
    entity_id:      string
    entity_type:    string
    steps:          Omit<OrchestrationStep, 'step_id'>[]
    metadata?:      Record<string, unknown>
  }): Promise<string> {
    const activityId = randomUUID()
    const steps: OrchestrationStep[] = params.steps.map(s => ({ ...s, step_id: randomUUID() }))

    const activity: OrchestrationActivity = {
      activity_id:   activityId,
      tenant_id:        params.tenant_id,
      workflow_type: params.workflow_type,
      entity_id:     params.entity_id,
      entity_type:   params.entity_type,
      status:        'active',
      steps,
      started_at:    new Date().toISOString(),
      metadata:      params.metadata,
      explainability: explainabilityService.explain({
        event_type:  `orchestration.${params.workflow_type}`,
        entity_type: params.entity_type,
        entity_id:   params.entity_id,
        payload:     { workflow_type: params.workflow_type, step_count: steps.length },
        severity:    'info',
      }),
    }

    // Previously fire-and-forget (`void ...insert(...)`, error never checked) —
    // the caller (POST /fabric/orchestration/escalate) got a 201 with a fresh
    // activityId regardless of whether the row actually landed, so a transient
    // insert failure produced an activity_id that GET /fabric/orchestration
    // would never list, with no way for the client to detect the mismatch.
    const { error } = await supabase
      .from('orchestration_activity_logs')
      .insert({
        activity_id:   activity.activity_id,
        tenant_id:        activity.tenant_id,
        workflow_type: activity.workflow_type,
        entity_id:     activity.entity_id,
        entity_type:   activity.entity_type,
        status:        activity.status,
        steps:         activity.steps,
        started_at:    activity.started_at,
        metadata:      activity.metadata ?? null,
        explainability: activity.explainability,
      })
    if (error) throw new Error('Failed to start orchestration activity')

    return activityId
  }

  /** Complete an orchestration activity. */
  async completeOrchestration(supabase: SupabaseClient, activityId: string, orgId: string): Promise<void> {
    // .select() + row-count check (not just `error`) — a stale/foreign
    // activityId matches zero rows with no error raised, and the caller
    // would otherwise be told completion succeeded when nothing changed.
    const { data, error } = await supabase
      .from('orchestration_activity_logs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('activity_id', activityId)
      .eq('tenant_id', orgId)
      .select('activity_id')
    if (error) throw new Error('Failed to complete orchestration activity')
    if (!data || data.length === 0) throw new Error('Orchestration activity not found')
  }

  /** Get recent orchestration activities for an org. */
  async getRecentActivities(supabase: SupabaseClient, orgId: string, limit = 20): Promise<OrchestrationActivity[]> {
    const { data, error } = await supabase
      .from('orchestration_activity_logs')
      .select('*')
      .eq('tenant_id', orgId)
      .order('started_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error('Failed to fetch orchestration activities')
    return (data ?? []) as OrchestrationActivity[]
  }

  /**
   * Coordinate an approval escalation workflow (advisory only).
   * Tracks SLA, logs orchestration, generates explainability.
   * Does NOT alter the approval itself.
   */
  async coordinateEscalation(supabase: SupabaseClient, params: {
    tenant_id:       string
    entity_id:    string
    entity_type:  string
    reason:       string
    escalate_to?: string    // optional actor target description
  }): Promise<string> {
    // Start SLA tracking for the escalation
    slaService.track('approval-pending', params.entity_id, params.entity_type, params.tenant_id)

    return this.startOrchestration(supabase, {
      tenant_id:        params.tenant_id,
      workflow_type: 'escalation_chain',
      entity_id:     params.entity_id,
      entity_type:   params.entity_type,
      steps: [
        { step_name: 'Escalation initiated',    status: 'completed' },
        { step_name: 'Notify stakeholders',     status: 'active' },
        { step_name: `Escalate to ${params.escalate_to ?? 'manager'}`, status: 'pending' },
        { step_name: 'Resolution tracking',     status: 'pending' },
      ],
      metadata: { reason: params.reason, escalate_to: params.escalate_to },
    })
  }
}

export const workflowOrchestrationService = new WorkflowOrchestrationService()
