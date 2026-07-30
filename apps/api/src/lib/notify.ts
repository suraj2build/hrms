/**
 * notify.ts — Lightweight operational notification helper.
 *
 * Inserts a record into inbox_items for the specified recipient(s).
 * Non-throwing: notification failures must never block primary operations.
 *
 * Usage:
 *   await notify(fastify.supabase, {
 *     tenantId, recipientId, item_type: 'payroll_blocker',
 *     title: 'Payroll period locked',
 *     summary: 'Retro adjustment queued for January 2025',
 *     severity: 'warning',
 *     entity_type: 'payroll_adjustments', entity_id: adjId,
 *     action_route: '/payroll/adjustments',
 *   })
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type InboxItemType =
  | 'approval_request'
  | 'payroll_blocker'
  | 'incident_alert'
  | 'escalation'
  | 'sla_breach'
  | 'compliance_alert'
  | 'reimbursement_action'
  | 'declaration_review'
  | 'advance_action'
  | 'loan_action'
  | 'validation_error'
  | 'general'

export type InboxSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface NotifyOptions {
  tenantId:      string
  recipientId:   string          // profile UUID of the target user
  senderId?:     string          // profile UUID of the actor (optional)
  item_type:     InboxItemType
  title:         string
  summary:       string
  severity?:     InboxSeverity   // default 'info'
  entity_type?:  string
  entity_id?:    string
  action_route?: string
  action_label?: string
  expires_at?:   string
  metadata?:     Record<string, unknown>
}

/**
 * Insert a single inbox notification.
 * Returns the created item id on success, null on failure.
 */
export async function notify(
  supabase: SupabaseClient,
  opts:     NotifyOptions,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('inbox_items')
      .insert({
        tenant_id:    opts.tenantId,
        recipient_id: opts.recipientId,
        sender_id:    opts.senderId    ?? null,
        item_type:    opts.item_type,
        title:        opts.title,
        summary:      opts.summary,
        severity:     opts.severity    ?? 'info',
        entity_type:  opts.entity_type ?? null,
        entity_id:    opts.entity_id   ?? null,
        action_route: opts.action_route ?? null,
        action_label: opts.action_label ?? null,
        expires_at:   opts.expires_at  ?? null,
        metadata:     opts.metadata    ?? {},
      })
      .select('id')
      .single()

    if (error) return null
    return (data as any)?.id ?? null
  } catch {
    return null
  }
}

/**
 * Notify all HR admins in a tenant.
 * Fetches profiles with role hr_admin or super_admin and inserts one inbox item per person.
 */
export async function notifyHrAdmins(
  supabase: SupabaseClient,
  opts:     Omit<NotifyOptions, 'recipientId'>,
): Promise<void> {
  try {
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .eq('tenant_id', opts.tenantId)
      .in('role', ['super_admin', 'hr_admin'])

    if (!admins || admins.length === 0) return

    const rows = (admins as any[]).map(a => ({
      tenant_id:    opts.tenantId,
      recipient_id: a.id,
      sender_id:    opts.senderId    ?? null,
      item_type:    opts.item_type,
      title:        opts.title,
      summary:      opts.summary,
      severity:     opts.severity    ?? 'info',
      entity_type:  opts.entity_type ?? null,
      entity_id:    opts.entity_id   ?? null,
      action_route: opts.action_route ?? null,
      action_label: opts.action_label ?? null,
      expires_at:   opts.expires_at  ?? null,
      metadata:     opts.metadata    ?? {},
    }))

    const { error } = await supabase.from('inbox_items').insert(rows)
    if (error) {
      console.warn('[notify] notifyHrAdmins insert failed', {
        tenantId:  opts.tenantId,
        itemType:  opts.item_type,
        count:     rows.length,
        error:     error.message,
      })
    }
  } catch {
    // Non-throwing — notification failures must never block primary operations
  }
}

/**
 * Log a scheduler job start. Returns the job log id.
 */
export async function logJobStart(
  supabase:  SupabaseClient,
  job: {
    tenantId?:    string
    job_type:     string
    job_name?:    string
    trigger_type?: 'scheduled' | 'manual' | 'retry' | 'event'
    triggered_by?: string
    meta?:        Record<string, unknown>
  },
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('scheduler_job_log')
      .insert({
        tenant_id:    job.tenantId    ?? null,
        job_type:     job.job_type,
        job_name:     job.job_name    ?? null,
        trigger_type: job.trigger_type ?? 'manual',
        status:       'started',
        started_at:   new Date().toISOString(),
        triggered_by: job.triggered_by ?? null,
        meta:         job.meta        ?? {},
      })
      .select('id')
      .single()

    return (data as any)?.id ?? null
  } catch {
    return null
  }
}

/**
 * Log a scheduler job completion (success or failure).
 */
export async function logJobEnd(
  supabase:  SupabaseClient,
  jobId:     string,
  result: {
    status:          'completed' | 'failed' | 'timeout' | 'cancelled'
    affected_count?: number
    error_message?:  string
    meta?:           Record<string, unknown>
  },
): Promise<void> {
  try {
    const now = new Date()
    const { data: existing } = await supabase
      .from('scheduler_job_log')
      .select('started_at')
      .eq('id', jobId)
      .single()

    const startedAt = existing ? new Date((existing as any).started_at) : now
    const durationMs = now.getTime() - startedAt.getTime()

    const { error } = await supabase
      .from('scheduler_job_log')
      .update({
        status:          result.status,
        completed_at:    now.toISOString(),
        duration_ms:     durationMs,
        affected_count:  result.affected_count ?? null,
        error_message:   result.error_message  ?? null,
        meta:            result.meta           ?? {},
      })
      .eq('id', jobId)

    if (error) console.warn('[notify] logJobEnd update failed', { jobId, error: error.message })
  } catch {
    // Non-throwing
  }
}
