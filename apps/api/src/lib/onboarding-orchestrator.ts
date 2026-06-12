/**
 * onboarding-orchestrator.ts — Phase O1: Onboarding Orchestration Foundation.
 *
 * Connects the onboarding pipeline to the existing platform infrastructure:
 *   → Platform event bus   (typed events at every lifecycle transition)
 *   → Notification layer    (reusable template catalog — O1.2)
 *   → Trust workspace       (onboarding trust score persisted on approval)
 *   → Checklist engine       (auto-instantiate checklist on employee creation)
 *   → Lifecycle event log     (durable audit trail — O1.3, O2 Timeline source)
 *
 * Usage:
 *   1. Routes call the emit* helpers (fire-and-forget, never throw).
 *   2. Call registerOnboardingHandlers(supabase) once at startup.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { eventBus }           from './event-bus.js'
import type { HrmsEventType, HrmsEvent } from './event-bus.js'
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

export function emitOnboardingDocumentUploaded(opts: {
  tenantId:       string
  sessionId:      string
  documentId:     string
  documentType:   string
  uploadedBy:     string
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.document.uploaded',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:     opts.tenantId,
      sessionId:    opts.sessionId,
      documentId:   opts.documentId,
      documentType: opts.documentType,
      uploadedBy:   opts.uploadedBy,
    },
  })
}

export function emitOnboardingDocumentVerified(opts: {
  tenantId:       string
  sessionId:      string
  documentId:     string
  documentType:   string
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.document.verified',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:     opts.tenantId,
      sessionId:    opts.sessionId,
      documentId:   opts.documentId,
      documentType: opts.documentType,
    },
  })
}

export function emitOnboardingDocumentRejected(opts: {
  tenantId:       string
  sessionId:      string
  documentId:     string
  documentType:   string
  reason:         string
  correlationId?: string
}): void {
  eventBus.emit({
    type:          'onboarding.document.rejected',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:     opts.tenantId,
      sessionId:    opts.sessionId,
      documentId:   opts.documentId,
      documentType: opts.documentType,
      reason:       opts.reason,
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
  joiningDate?:   string | null
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

  // Joining is finalised the moment the employee record is created.
  eventBus.emit({
    type:          'onboarding.joining.completed',
    tenantId:      opts.tenantId,
    correlationId: opts.correlationId ?? 'system',
    payload: {
      tenantId:     opts.tenantId,
      sessionId:    opts.sessionId,
      employeeId:   opts.employeeId,
      employeeCode: opts.employeeCode,
      joiningDate:  opts.joiningDate ?? null,
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

// ── O1.2 — Reusable notification template catalog ──────────────────────────────
//
// One template per onboarding touchpoint. Subject/body are rendered from the
// event payload. The dispatch path is still a structured-log stub — when a real
// provider (Resend / OneSignal / Supabase Realtime) is wired, only renderAndSend()
// changes; these templates and the event→template mapping stay the same.
// Future phases extend this catalog: probation_started, probation_review_due,
// confirmation_approved. (Defined but not wired until those phases exist.)

interface NotificationTemplate {
  code:    string
  subject: string
  body:    (ctx: Record<string, unknown>) => string
}

const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  welcome: {
    code:    'onboarding_welcome',
    subject: 'Welcome aboard',
    body:    (c) => `A new onboarding has started${c.candidate_name ? ` for ${c.candidate_name}` : ''}.`,
  },
  documents_required: {
    code:    'onboarding_documents_required',
    subject: 'Documents required',
    body:    () => 'Please upload the requested onboarding documents to proceed.',
  },
  verification_approved: {
    code:    'onboarding_verification_approved',
    subject: 'Document verified',
    body:    (c) => `Your ${c.document_type ?? 'document'} has been verified.`,
  },
  verification_rejected: {
    code:    'onboarding_verification_rejected',
    subject: 'Document rejected',
    body:    (c) => `Your ${c.document_type ?? 'document'} was rejected${c.reason ? `: ${c.reason}` : ''}.`,
  },
  checklist_assigned: {
    code:    'onboarding_checklist_assigned',
    subject: 'Onboarding checklist assigned',
    body:    () => 'An onboarding checklist has been assigned to you.',
  },
  checklist_completed: {
    code:    'onboarding_checklist_completed',
    subject: 'Onboarding checklist completed',
    body:    () => 'All mandatory onboarding tasks are complete.',
  },
  ready_for_joining: {
    code:    'onboarding_ready_for_joining',
    subject: 'Ready for joining',
    body:    (c) => `Joining is finalised${c.employee_code ? ` (${c.employee_code})` : ''}.`,
  },
}

/** Event type → notification template key. Only mapped events dispatch. */
const EVENT_TEMPLATE_MAP: Partial<Record<HrmsEventType, keyof typeof NOTIFICATION_TEMPLATES>> = {
  'onboarding.session.created':       'welcome',
  'onboarding.document.verified':     'verification_approved',
  'onboarding.document.rejected':     'verification_rejected',
  'onboarding.checklist.completed':   'checklist_completed',
  'onboarding.joining.completed':     'ready_for_joining',
}

// ── Handler registration (call once at startup) ────────────────────────────────

const ALL_ONBOARDING_EVENTS: HrmsEventType[] = [
  'onboarding.session.created',
  'onboarding.document.uploaded',
  'onboarding.document.verified',
  'onboarding.document.rejected',
  'onboarding.session.extraction_complete',
  'onboarding.session.approved',
  'onboarding.session.rejected',
  'onboarding.joining.completed',
  'onboarding.checklist.completed',
]

export function registerOnboardingHandlers(supabase: SupabaseClient): void {

  // ── O1.3 — Persist every lifecycle event to the durable audit log ──────────
  // This is the single source of truth the O2 Timeline reads from.
  eventBus.onMany(ALL_ONBOARDING_EVENTS, async (event) => {
    try {
      const row = normalizeLifecycleEvent(event)
      const { error } = await supabase.from('onboarding_lifecycle_events').insert(row)
      if (error) logWarn('lifecycle_persist_failed', row.session_id ?? row.employee_id ?? 'unknown', error.message)
    } catch (err) {
      logWarn('lifecycle_persist_threw', 'unknown', err)
    }
  })

  // ── O1.2 — Dispatch templated notifications for mapped events ──────────────
  eventBus.onMany(ALL_ONBOARDING_EVENTS, async (event) => {
    const templateKey = EVENT_TEMPLATE_MAP[event.type]
    if (!templateKey) return
    renderAndSend(templateKey, event.tenantId, event.payload as Record<string, unknown>)
  })

  // ── approved → compute + persist onboarding trust score ────────────────────
  eventBus.on('onboarding.session.approved', async (event) => {
    const { tenantId, sessionId, employeeId, draftId } = event.payload
    try {
      const { data: draft } = await supabase
        .from('draft_employee_profiles')
        .select('pan_number, bank_account_number, validation_errors, duplicate_risk')
        .eq('id', draftId)
        .eq('tenant_id', tenantId)
        .single()

      const { data: identityDocs } = await supabase
        .from('onboarding_documents')
        .select('id')
        .eq('session_id', sessionId)
        .eq('tenant_id', tenantId)
        .in('document_type', ['aadhaar', 'passport'])
        .in('extraction_status', ['extracted', 'skipped'])
        .limit(1)

      const hasPan       = Boolean(draft?.pan_number)
      const hasBank      = Boolean(draft?.bank_account_number)
      const hasIdentity  = Boolean(identityDocs && identityDocs.length > 0)
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
      const { data: template } = await supabase
        .from('onboarding_checklist_templates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!template) return

      const { data: existing } = await supabase
        .from('employee_onboarding_checklists')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (existing) return

      const { data: items } = await supabase
        .from('onboarding_checklist_items')
        .select('title, description, is_mandatory, sort_order, category, assigned_to_role')
        .eq('template_id', template.id)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      const today = new Date().toISOString().substring(0, 10)
      const target = new Date()
      target.setDate(target.getDate() + 30)
      const targetDate = target.toISOString().substring(0, 10)

      const { data: checklist } = await supabase
        .from('employee_onboarding_checklists')
        .insert({
          tenant_id:              tenantId,
          employee_id:            employeeId,
          template_id:            template.id,
          status:                 'not_started',
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

      await supabase.from('employee_onboarding_tasks').insert(taskRows)

      // Notify the new joiner that a checklist is now assigned.
      renderAndSend('checklist_assigned', tenantId, { employee_id: employeeId })
    } catch (err) {
      logWarn('checklist_auto_create_failed', event.payload.sessionId, err)
    }
  })

  console.log(JSON.stringify({
    level:   'info',
    service: 'onboarding-orchestrator',
    action:  'handlers_registered',
    events:  ALL_ONBOARDING_EVENTS,
  }))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface LifecycleEventRow {
  tenant_id:    string
  event_type:   string
  session_id:   string | null
  employee_id:  string | null
  draft_id:     string | null
  document_id:  string | null
  actor_id:     string | null
  title:        string
  detail:       Record<string, unknown>
  severity:     'info' | 'success' | 'warning' | 'critical'
  occurred_at:  string
}

/** Map any onboarding event → a durable lifecycle-event row (O1.3). */
function normalizeLifecycleEvent(event: HrmsEvent<HrmsEventType>): LifecycleEventRow {
  const p = event.payload as Record<string, any>
  const base = {
    tenant_id:   event.tenantId,
    event_type:  event.type,
    session_id:  (p.sessionId as string) ?? null,
    employee_id: (p.employeeId as string) ?? null,
    draft_id:    (p.draftId as string) ?? null,
    document_id: (p.documentId as string) ?? null,
    occurred_at: event.timestamp,
    detail:      p,
  }

  switch (event.type) {
    case 'onboarding.session.created':
      return { ...base, actor_id: p.createdBy ?? null, severity: 'info',
        title: `Onboarding started${p.candidateName ? ` — ${p.candidateName}` : ''}` }
    case 'onboarding.document.uploaded':
      return { ...base, actor_id: p.uploadedBy ?? null, severity: 'info',
        title: `Document uploaded — ${p.documentType}` }
    case 'onboarding.document.verified':
      return { ...base, actor_id: null, severity: 'success',
        title: `Document verified — ${p.documentType}` }
    case 'onboarding.document.rejected':
      return { ...base, actor_id: null, severity: 'warning',
        title: `Document rejected — ${p.documentType}` }
    case 'onboarding.session.extraction_complete':
      return { ...base, actor_id: null, severity: 'info',
        title: `Extraction complete — ${p.docCount} document(s)` }
    case 'onboarding.session.approved':
      return { ...base, actor_id: p.approvedBy ?? null, severity: 'success',
        title: `Draft approved — employee ${p.employeeCode} created${p.exceptionPass ? ' (exception)' : ''}` }
    case 'onboarding.session.rejected':
      return { ...base, actor_id: p.rejectedBy ?? null, severity: 'warning',
        title: `Onboarding rejected — ${p.reason}` }
    case 'onboarding.joining.completed':
      return { ...base, actor_id: null, severity: 'success',
        title: `Joining completed — ${p.employeeCode}` }
    case 'onboarding.checklist.completed':
      return { ...base, actor_id: null, severity: 'success',
        title: 'Onboarding checklist completed' }
    default:
      return { ...base, actor_id: null, severity: 'info', title: event.type }
  }
}

/** Render a template and dispatch it. Structured-log stub — swap for a provider. */
function renderAndSend(
  templateKey: keyof typeof NOTIFICATION_TEMPLATES,
  tenantId:    string,
  ctx:         Record<string, unknown>,
): void {
  const template = NOTIFICATION_TEMPLATES[templateKey]
  if (!template) return
  try {
    console.log(JSON.stringify({
      level:         'info',
      service:       'onboarding-notification',
      template_code: template.code,
      tenant_id:     tenantId,
      subject:       template.subject,
      body:          template.body(ctx),
      ...ctx,
    }))
  } catch {
    // Notification rendering/dispatch must never affect the lifecycle flow.
  }
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
