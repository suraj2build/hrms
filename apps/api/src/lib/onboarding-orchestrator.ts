/**
 * onboarding-orchestrator.ts — Phase O1: Onboarding Orchestration Foundation.
 *
 * Connects the onboarding pipeline to the existing platform infrastructure:
 *   → Platform event bus   (typed events at every status transition)
 *   → Notification layer   (structured log; swap dispatch() for real provider)
 *   → Trust workspace      (onboarding trust score persisted on approval)
 *   → Checklist engine     (auto-instantiate checklist on employee creation)
 *
 * Usage:
 *   1. Routes call the emit* helpers (fire-and-forget, never throw).
 *   2. Call registerOnboardingHandlers(supabase) once at startup.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { eventBus }           from './event-bus.js'
import { trustScoreService }  from '../platform/trust/scoring/trust-score.service.js'

// ── Event emitters (called by onboarding routes) ──────────────────────────────

export function emitOnboardingSessionCreated(opts: {
  tenantId:       string
  sessionId:      string
  candidateName?: string | null
  createdBy:      string
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.session.created',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:      opts.tenantId,
      sessionId:     opts.sessionId,
      candidateName: opts.candidateName ?? undefined,
      createdBy:     opts.createdBy,
    },
  })
}

export function emitOnboardingExtractionComplete(opts: {
  tenantId:       string
  sessionId:      string
  draftId:        string
  docCount:       number
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.session.extraction_complete',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:  opts.tenantId,
      sessionId: opts.sessionId,
      draftId:   opts.draftId,
      docCount:  opts.docCount,
    },
  })
}

export function emitOnboardingSessionApproved(opts: {
  tenantId:       string
  sessionId:      string
  draftId:        string
  employeeId:     string
  employeeCode:   string
  approvedBy:     string
  exceptionPass:  boolean
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.session.approved',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:      opts.tenantId,
      sessionId:     opts.sessionId,
      draftId:       opts.draftId,
      employeeId:    opts.employeeId,
      employeeCode:  opts.employeeCode,
      approvedBy:    opts.approvedBy,
      exceptionPass: opts.exceptionPass,
    },
  })
}

export function emitOnboardingSessionRejected(opts: {
  tenantId:       string
  sessionId:      string
  draftId:        string
  rejectedBy:     string
  reason:         string
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.session.rejected',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:   opts.tenantId,
      sessionId:  opts.sessionId,
      draftId:    opts.draftId,
      rejectedBy: opts.rejectedBy,
      reason:     opts.reason,
    },
  })
}

export function emitOnboardingChecklistCompleted(opts: {
  tenantId:       string
  employeeId:     string
  checklistId:    string
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.checklist.completed',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:    opts.tenantId,
      employeeId:  opts.employeeId,
      checklistId: opts.checklistId,
    },
  })
}

// ── Handler registration (call once at startup) ────────────────────────────────

export function registerOnboardingHandlers(supabase: SupabaseClient): void {

  // ── approved → compute + persist onboarding trust score ────────────────────
  eventBus.on('onboarding.session.approved', async (event) => {
    const { tenantId, sessionId, employeeId, draftId } = event.payload
    try {
      // Fetch draft for document presence signals
      const { data: draft } = await supabase
        .from('draft_employee_profiles')
        .select('pan_number, bank_account_number, validation_errors, duplicate_risk')
        .eq('id', draftId)
        .eq('tenant_id', tenantId)
        .single()

      // Check for uploaded identity documents (Aadhaar/Passport)
      const { data: identityDocs } = await supabase
        .from('onboarding_documents')
        .select('id')
        .eq('session_id', sessionId)
        .eq('tenant_id', tenantId)
        .in('document_type', ['aadhaar', 'passport'])
        .in('extraction_status', ['extracted', 'skipped'])
        .limit(1)

      const hasPan      = Boolean(draft?.pan_number)
      const hasBank     = Boolean(draft?.bank_account_number)
      const hasIdentity = Boolean(identityDocs && identityDocs.length > 0)
      const hasDuplicate = Boolean(draft?.duplicate_risk)

      const result = trustScoreService.computeOnboardingTrustScore({
        employee_id:  employeeId,
        org_id:       tenantId,
        has_pan:      hasPan,
        has_bank:     hasBank,
        has_identity: hasIdentity,
        duplicates:   hasDuplicate
          ? [{ duplicate_type: 'pan', severity: 'high', matching_entity_ids: [] } as any]
          : [],
      })

      await supabase
        .from('workforce_trust_scores')
        .upsert({
          tenant_id:   tenantId,
          entity_id:   sessionId,
          score_type:  'onboarding',
          score:       result.score,
          severity:    result.severity,
          factors:     result.factors,
          computed_at: result.computed_at,
        }, { onConflict: 'tenant_id,entity_id,score_type' })
    } catch (err) {
      logWarn('trust_score_failed', sessionId, err)
    }
  })

  // ── approved → auto-instantiate onboarding checklist ───────────────────────
  eventBus.on('onboarding.session.approved', async (event) => {
    const { tenantId, employeeId } = event.payload
    try {
      // Find the default (oldest active) checklist template for this tenant
      const { data: template } = await supabase
        .from('onboarding_checklist_templates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!template) return

      // Skip if checklist already exists for this employee
      const { data: existing } = await supabase
        .from('onboarding_checklists')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (existing) return

      // Fetch template items
      const { data: items } = await supabase
        .from('onboarding_checklist_items')
        .select('title, description, is_mandatory, sort_order, category, assigned_to_role')
        .eq('template_id', template.id)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      // Create the checklist instance
      const today = new Date().toISOString().substring(0, 10)
      const target = new Date()
      target.setDate(target.getDate() + 30)
      const targetDate = target.toISOString().substring(0, 10)

      const { data: checklist } = await supabase
        .from('onboarding_checklists')
        .insert({
          tenant_id:              tenantId,
          employee_id:            employeeId,
          template_id:            template.id,
          status:                 'pending',
          start_date:             today,
          target_completion_date: targetDate,
        })
        .select('id')
        .single()

      if (!checklist || !items || items.length === 0) return

      const taskRows = (items as any[]).map((item) => ({
        tenant_id:        tenantId,
        checklist_id:     checklist.id,
        title:            item.title,
        description:      item.description ?? null,
        is_mandatory:     item.is_mandatory,
        sort_order:       item.sort_order,
        category:         item.category ?? null,
        assigned_to_role: item.assigned_to_role ?? null,
        status:           'pending',
        notes:            null,
        completed_at:     null,
      }))

      await supabase.from('onboarding_checklist_tasks').insert(taskRows)
    } catch (err) {
      logWarn('checklist_auto_create_failed', event.payload.sessionId, err)
    }
  })

  // ── Notification dispatchers ──────────────────────────────────────────────

  eventBus.on('onboarding.session.created', async (event) => {
    const { tenantId, sessionId, candidateName, createdBy } = event.payload
    notify('onboarding_session_created', tenantId, sessionId, createdBy, { candidate_name: candidateName })
  })

  eventBus.on('onboarding.session.extraction_complete', async (event) => {
    const { tenantId, sessionId, draftId, docCount } = event.payload
    notify('onboarding_extraction_complete', tenantId, sessionId, undefined, { draft_id: draftId, doc_count: docCount })
  })

  eventBus.on('onboarding.session.approved', async (event) => {
    const { tenantId, sessionId, employeeId, approvedBy, exceptionPass } = event.payload
    notify('onboarding_approved', tenantId, sessionId, approvedBy, { employee_id: employeeId, exception_pass: exceptionPass })
  })

  eventBus.on('onboarding.session.rejected', async (event) => {
    const { tenantId, sessionId, rejectedBy, reason } = event.payload
    notify('onboarding_rejected', tenantId, sessionId, rejectedBy, { reason })
  })

  eventBus.on('onboarding.checklist.completed', async (event) => {
    const { tenantId, employeeId, checklistId } = event.payload
    notify('onboarding_checklist_completed', tenantId, checklistId, undefined, { employee_id: employeeId })
  })

  console.log(JSON.stringify({
    level:   'info',
    service: 'onboarding-orchestrator',
    action:  'handlers_registered',
    events: [
      'onboarding.session.created',
      'onboarding.session.extraction_complete',
      'onboarding.session.approved',
      'onboarding.session.rejected',
      'onboarding.checklist.completed',
    ],
  }))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type OnboardingNotificationType =
  | 'onboarding_session_created'
  | 'onboarding_extraction_complete'
  | 'onboarding_approved'
  | 'onboarding_rejected'
  | 'onboarding_checklist_completed'

function notify(
  type:      OnboardingNotificationType,
  tenantId:  string,
  entityId:  string,
  actorId?:  string,
  metadata?: Record<string, unknown>,
): void {
  // Structured log — observable without a real provider.
  // Replace this body with Resend/OneSignal/Supabase Realtime when ready.
  console.log(JSON.stringify({
    level:     'info',
    service:   'onboarding-notification',
    event:     type,
    tenant_id: tenantId,
    entity_id: entityId,
    actor_id:  actorId ?? null,
    ...(metadata ?? {}),
  }))
}

function logWarn(event: string, entityId: string, err: unknown): void {
  console.log(JSON.stringify({
    level:     'warn',
    service:   'onboarding-orchestrator',
    event,
    entity_id: entityId,
    error:     err instanceof Error ? err.message : String(err),
  }))
}
