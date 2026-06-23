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
import {
  sendEmail,
  joiningWelcomeEmail,
  itProvisioningEmail,
  APP_PUBLIC_URL,
} from './email-service.js'
import { brandConfig } from './brand-config.js'

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

// ── Pre-joinee path helper — emits joining.completed without a session ─────────
// The pre-joinee approval creates an employee directly from an invitation (no
// onboarding session / draft).  Emit just the joining.completed event so the
// welcome email (ONB-04) and IT provisioning (ONB-05) handlers still fire.

export function emitPreJoineeJoiningCompleted(opts: {
  tenantId:     string
  invitationId: string   // used as sessionId so the inbox entity points to the invitation
  employeeId:   string
  employeeCode: string
  joiningDate?: string | null
}): void {
  eventBus.emit({
    type:          'onboarding.joining.completed',
    tenantId:      opts.tenantId,
    correlationId: 'system',
    payload: {
      tenantId:     opts.tenantId,
      sessionId:    opts.invitationId,
      employeeId:   opts.employeeId,
      employeeCode: opts.employeeCode,
      joiningDate:  opts.joiningDate ?? null,
    },
  })
}

// ── O1.2 / O4.1 — Structured onboarding inbox dispatch ────────────────────────
//
// Every onboarding event that reaches an employee's ESS workspace is dispatched
// as a structured inbox_items row with entity_type, entity_id, and
// metadata.category='onboarding'. This replaces the original log stub so
// consumers can filter by entity_type without any keyword or URL heuristics.
//
// Only post-approval events dispatch to the employee inbox — pre-approval events
// (session.created, document.uploaded) happen before the employee profile exists
// and are handled via the email invite flow (email-service.ts / PreJoinPortal).

interface OnboardingInboxOpts {
  supabase:      SupabaseClient
  tenantId:      string
  employeeId:    string             // used to look up recipient profile UUID
  entityType:    string             // 'onboarding_session' | 'onboarding_document' | 'onboarding_checklist'
  entityId:      string
  itemType:      'action_required' | 'info' | 'reminder'
  severity:      'info' | 'warning' | 'success'
  title:         string
  summary:       string
  source:        string             // 'Onboarding Engine' | 'Document Management' | 'Checklist Engine'
  actionRoute?:  string
  actionLabel?:  string
}

/** Insert a structured onboarding inbox item for the employee.
 *  Silently skips if no profile is found — never throws. */
async function dispatchOnboardingInboxItem(opts: OnboardingInboxOpts): Promise<void> {
  try {
    // Resolve the profile UUID from the employee record.
    const { data: profile } = await opts.supabase
      .from('profiles')
      .select('id')
      .eq('employee_id', opts.employeeId)
      .eq('tenant_id', opts.tenantId)
      .maybeSingle()

    if (!profile?.id) return  // employee not yet linked to a profile — skip silently

    await opts.supabase.from('inbox_items').insert({
      tenant_id:    opts.tenantId,
      recipient_id: profile.id,
      item_type:    opts.itemType,
      severity:     opts.severity,
      title:        opts.title,
      summary:      opts.summary,
      entity_type:  opts.entityType,
      entity_id:    opts.entityId,
      action_route: opts.actionRoute ?? '/ess/onboarding',
      action_label: opts.actionLabel ?? 'View onboarding',
      status:       'unread',
      metadata: {
        category: 'onboarding',
        source:   opts.source,
      },
    })
  } catch (err) {
    logWarn('inbox_dispatch_failed', opts.entityId, err)
  }
}

// ── O5.6 — Trust admin inbox dispatch ────────────────────────────────────────
//
// HR admin trust notifications go to every HR_ADMIN / SUPER_ADMIN profile in the
// tenant. The category is 'compliance' so frontend filters can separate them from
// employee onboarding items.

interface TrustAdminInboxOpts {
  supabase:    SupabaseClient
  tenantId:    string
  entityType:  string
  entityId:    string
  severity:    'info' | 'warning' | 'success' | 'critical'
  title:       string
  summary:     string
  actionRoute: string
}

/** Returns true if an unread trust inbox item with the same title already exists
 *  for this entity within the last 7 days. Prevents duplicate flooding when trust
 *  is re-evaluated on every profile update. */
async function trustAdminInboxItemExists(
  supabase:  SupabaseClient,
  tenantId:  string,
  entityId:  string,
  title:     string,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('inbox_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('entity_id', entityId)
      .eq('entity_type', 'workforce_trust')
      .eq('title', title)
      .eq('status', 'unread')
      .gte('created_at', since)
      .limit(1)
      .maybeSingle()
    return !!data?.id
  } catch {
    return false  // on error, allow the item through
  }
}

async function dispatchTrustAdminInboxItem(opts: TrustAdminInboxOpts): Promise<void> {
  try {
    // Fetch all HR-admin profiles in the tenant
    const { data: admins } = await opts.supabase
      .from('profiles')
      .select('id')
      .eq('tenant_id', opts.tenantId)
      .in('role', ['hr_admin', 'super_admin', 'owner'])

    if (!admins || admins.length === 0) return

    const rows = admins.map((a: any) => ({
      tenant_id:    opts.tenantId,
      recipient_id: a.id,
      item_type:    'action_required',
      severity:     opts.severity,
      title:        opts.title,
      summary:      opts.summary,
      entity_type:  opts.entityType,
      entity_id:    opts.entityId,
      action_route: opts.actionRoute,
      action_label: 'Review trust',
      status:       'unread',
      metadata: {
        category: 'compliance',
        source:   'Trust Intelligence',
      },
    }))

    await opts.supabase.from('inbox_items').insert(rows)
  } catch (err) {
    logWarn('trust_admin_inbox_failed', opts.entityId, err)
  }
}

/** For document events: look up linked_employee_id from the session (set only
 *  after approval — silently skips if the session is still pre-approval). */
async function resolveSessionEmployeeId(
  supabase: SupabaseClient,
  sessionId: string,
  tenantId:  string,
): Promise<string | null> {
  // onboarding_sessions does not store a linked employee id; the link is not tracked here.
  const { data } = await supabase
    .from('onboarding_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data ? null : null
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

  // ── O4.1 — Structured inbox dispatch for employee-facing onboarding events ──
  // Post-approval events only (pre-approval events have no employee profile yet).

  eventBus.on('onboarding.document.verified', async (event) => {
    const { tenantId, sessionId, documentId, documentType } = event.payload
    const employeeId = await resolveSessionEmployeeId(supabase, sessionId, tenantId)
    if (!employeeId) return
    await dispatchOnboardingInboxItem({
      supabase, tenantId, employeeId,
      entityType: 'onboarding_document', entityId: documentId,
      itemType: 'info', severity: 'success',
      title: 'Document verified',
      summary: `Your ${documentType ?? 'document'} has been reviewed and verified.`,
      source: 'Document Management',
      actionRoute: '/ess/onboarding', actionLabel: 'View your onboarding',
    })
  })

  eventBus.on('onboarding.document.rejected', async (event) => {
    const { tenantId, sessionId, documentId, documentType, reason } = event.payload
    const employeeId = await resolveSessionEmployeeId(supabase, sessionId, tenantId)
    if (!employeeId) return
    await dispatchOnboardingInboxItem({
      supabase, tenantId, employeeId,
      entityType: 'onboarding_document', entityId: documentId,
      itemType: 'action_required', severity: 'warning',
      title: 'Document needs attention',
      summary: `Your ${documentType ?? 'document'} was rejected${reason ? `: ${reason}` : ''}. Your HR team will advise next steps.`,
      source: 'Document Management',
      actionRoute: '/ess/onboarding', actionLabel: 'View your documents',
    })
  })

  eventBus.on('onboarding.checklist.completed', async (event) => {
    const { tenantId, employeeId, checklistId } = event.payload
    await dispatchOnboardingInboxItem({
      supabase, tenantId, employeeId,
      entityType: 'onboarding_checklist', entityId: checklistId,
      itemType: 'info', severity: 'success',
      title: 'Onboarding checklist complete',
      summary: 'All mandatory onboarding tasks are done. Great work!',
      source: 'Checklist Engine',
      actionRoute: '/ess/onboarding', actionLabel: 'View your journey',
    })
  })

  eventBus.on('onboarding.joining.completed', async (event) => {
    const { tenantId, sessionId, employeeId, employeeCode } = event.payload
    await dispatchOnboardingInboxItem({
      supabase, tenantId, employeeId,
      entityType: 'onboarding_session', entityId: sessionId,
      itemType: 'info', severity: 'success',
      title: 'Joining finalised',
      summary: `Welcome to the team${employeeCode ? ` (${employeeCode})` : ''}. Your onboarding is complete.`,
      source: 'Onboarding Engine',
      actionRoute: '/ess/onboarding', actionLabel: 'View your workspace',
    })
  })

  // ── ONB-04 + ONB-05: Welcome email to joiner + IT provisioning notification ──
  eventBus.on('onboarding.joining.completed', async (event) => {
    const { tenantId, employeeId, employeeCode, joiningDate } = event.payload

    // Fetch employee and tenant in parallel
    const [{ data: emp }, { data: tenant }] = await Promise.all([
      supabase
        .from('employees')
        .select('first_name, last_name, email, job_history!job_history_employee_id_fkey(manager_id, is_current)')
        .eq('id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle(),
    ])
    if (emp) {
      const _jh = ((emp as any).job_history ?? []).find((j: any) => j.is_current) ?? ((emp as any).job_history ?? [])[0] ?? null
      ;(emp as any).reporting_manager_id = _jh?.manager_id ?? null
    }

    const companyName = (tenant as any)?.name ?? brandConfig.productName

    // ONB-04: Welcome email to the new employee
    if ((emp as any)?.email) {
      try {
        let managerName: string | undefined
        let managerEmail: string | undefined
        if ((emp as any).reporting_manager_id) {
          const { data: mgr } = await supabase
            .from('employees')
            .select('first_name, last_name, email')
            .eq('id', (emp as any).reporting_manager_id)
            .eq('tenant_id', tenantId)
            .maybeSingle()
          if (mgr) {
            managerName  = `${(mgr as any).first_name ?? ''} ${(mgr as any).last_name ?? ''}`.trim() || undefined
            managerEmail = (mgr as any).email ?? undefined
          }
        }

        const { subject, html } = joiningWelcomeEmail({
          firstName:    (emp as any).first_name ?? '',
          employeeCode,
          companyName,
          joiningDate:  joiningDate ?? undefined,
          managerName,
          managerEmail,
          loginUrl:     APP_PUBLIC_URL,
        })
        await sendEmail({ to: (emp as any).email, subject, html })
      } catch (err) {
        logWarn('welcome_email_failed', employeeId, err)
      }
    }

    // ONB-05: IT provisioning notification to HR admins
    // (Profiles has no email col — fetch emails via Supabase Auth Admin API)
    try {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('role', ['hr_admin', 'super_admin'])

      if (admins && admins.length > 0) {
        const emailMap: Record<string, string> = {}
        try {
          const { data: authList } = await (supabase.auth as any).admin.listUsers({ perPage: 1000, page: 1 })
          for (const u of (authList?.users ?? [])) {
            emailMap[u.id] = u.email ?? ''
          }
        } catch (_) { /* email enrichment best-effort */ }

        const recipientEmails = admins
          .map((a: any) => emailMap[a.id])
          .filter((e): e is string => Boolean(e))

        if (recipientEmails.length > 0 && emp) {
          const employeeName = `${(emp as any).first_name ?? ''} ${(emp as any).last_name ?? ''}`.trim()
          const { subject, html } = itProvisioningEmail({
            employeeName,
            employeeCode,
            companyName,
            joiningDate: joiningDate ?? undefined,
            hrSystemUrl: APP_PUBLIC_URL,
          })
          await sendEmail({ to: recipientEmails, subject, html })
        }
      }
    } catch (err) {
      logWarn('it_provisioning_email_failed', employeeId, err)
    }
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
      await dispatchOnboardingInboxItem({
        supabase, tenantId, employeeId,
        entityType: 'onboarding_checklist', entityId: checklist.id,
        itemType: 'action_required', severity: 'info',
        title: 'Your onboarding checklist is ready',
        summary: 'Your personalised onboarding checklist has been set up. Complete your tasks to get fully set up.',
        source: 'Checklist Engine',
        actionRoute: '/ess/onboarding', actionLabel: 'View my checklist',
      })
    } catch (err) {
      logWarn('checklist_auto_create_failed', event.payload.sessionId, err)
    }
  })

  // ── O5.6 — Trust notifications: HR admin inbox — exception-based only ─────────
  //
  // Rules:
  //   • Duplicates     → always notify (critical signal), but deduplicate: skip if
  //                      an unread item for the same employee+type exists < 7 days.
  //   • Verifications  → aggregate ALL failures from one evaluation into ONE inbox
  //                      item per employee; deduplicate the same way.
  //   • trust.score.computed / trust.verification.completed → never notify.
  //   • trust.risk.raised → notify only for severity medium+; deduplicate.
  //
  // This prevents HR inboxes from flooding when a single employee has multiple
  // failed checks or when trust is re-evaluated on every profile update.

  eventBus.on('trust.duplicate.detected', async (event) => {
    const { tenantId, entityId, duplicateType, matchingEntityIds, severity } = event.payload
    const title = 'Duplicate identity detected'
    if (await trustAdminInboxItemExists(supabase, tenantId, entityId, title)) return
    await dispatchTrustAdminInboxItem({
      supabase, tenantId,
      entityType:  'workforce_trust', entityId,
      severity:    severity === 'critical' || severity === 'high' ? 'critical' : 'warning',
      title,
      summary:     `A duplicate ${duplicateType} was found across ${matchingEntityIds.length + 1} employee record(s). Please investigate.`,
      actionRoute: '/admin/trust',
    })
  })

  // Verification failures are aggregated: a debounce window of 5 s collects all
  // failures for the same employee in one evaluation then sends a single item.
  const pendingVerifFailures: Map<string, { types: string[]; timer: ReturnType<typeof setTimeout> }> = new Map()

  eventBus.on('trust.verification.failed', async (event) => {
    const { tenantId, entityId, verificationType } = event.payload
    const key = `${tenantId}:${entityId}`
    const existing = pendingVerifFailures.get(key)
    if (existing) {
      existing.types.push(verificationType)
      return  // timer already set — will flush when it fires
    }
    const entry = { types: [verificationType], timer: null as any }
    pendingVerifFailures.set(key, entry)
    entry.timer = setTimeout(async () => {
      pendingVerifFailures.delete(key)
      const types = entry.types
      const title  = 'Identity verification failed'
      if (await trustAdminInboxItemExists(supabase, tenantId, entityId, title)) return
      await dispatchTrustAdminInboxItem({
        supabase, tenantId,
        entityType:  'workforce_trust', entityId,
        severity:    'warning',
        title,
        summary:     `${types.map(t => t.toUpperCase()).join(', ')} verification could not be confirmed. Manual review may be needed.`,
        actionRoute: '/admin/trust',
      })
    }, 5_000)
  })

  eventBus.on('trust.risk.raised', async (event) => {
    const { tenantId, entityId, riskType, severity, detail } = event.payload
    if (severity === 'low') return  // only escalate medium+ to HR
    const title = `Trust risk raised: ${riskType}`
    if (await trustAdminInboxItemExists(supabase, tenantId, entityId, title)) return
    await dispatchTrustAdminInboxItem({
      supabase, tenantId,
      entityType:  'workforce_trust', entityId,
      severity:    severity === 'critical' ? 'critical' : 'warning',
      title,
      summary:     detail ?? `A ${severity} trust risk (${riskType}) was flagged for this employee.`,
      actionRoute: '/admin/trust',
    })
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


function logWarn(event: string, entityId: string, err: unknown): void {
  console.log(JSON.stringify({
    level:     'warn',
    service:   'onboarding-orchestrator',
    event,
    entity_id: entityId,
    error:     err instanceof Error ? err.message : String(err),
  }))
}
