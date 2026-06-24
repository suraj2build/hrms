import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { crossCheckIdentity } from '../../lib/onboarding/identity-check.js'
import { reopenInvitationForReupload } from '../../lib/onboarding/reopen-invitation.js'
import {
  emitOnboardingSessionApproved,
  emitOnboardingSessionRejected,
} from '../../lib/onboarding-orchestrator.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const fieldOverridesSchema = z.object({
  overrides: z.array(
    z.object({
      field_name: z.string().min(1),
      value: z.string(),
    }),
  ).min(1),
})

const rejectSchema = z.object({
  reason: z.string().min(1),
})

const reuploadSchema = z.object({
  items: z.array(z.object({
    document_type: z.string().min(1),
    reason:        z.string().min(1),
  })).min(1),
  message: z.string().optional(),
})

// ─── Validation helpers ────────────────────────────────────────────────────

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
const UAN_REGEX = /^\d{12}$/
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─── Route plugin ──────────────────────────────────────────────────────────

export default async function draftRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /onboarding/drafts/:id ────────────────────────────────────────────
  fastify.get('/drafts/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: draft, error: draftError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (draftError || !draft) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Draft profile not found' })
    }

    // Fetch all fields — DB column is draft_id (not session_id)
    const { data: rawFields, error: fieldsError } = await fastify.supabase
      .from('draft_employee_fields')
      .select('*')
      .eq('draft_id', id)
      .eq('tenant_id', req.tenantId)
      .order('field_name', { ascending: true })

    if (fieldsError) {
      fastify.log.error({ fieldsError, draftId: id }, 'GET /drafts/:id — fields sub-query failed')
      // Don't 500 — return draft without fields so extracted data tab still renders
    }

    // Map DB column names → frontend-expected shape
    const fields = (rawFields ?? []).map((f: any) => ({
      field_name:           f.field_name,
      value:                f.extracted_value ?? f.normalized_value ?? null,
      confidence_score:     f.confidence_score ?? null,
      source_document_type: f.source_document_type ?? null,
      is_conflicting:       f.is_conflicting ?? false,
      conflict_note:        f.conflict_note ?? null,
      is_hr_override:       f.is_hr_override ?? false,
      document_id:          f.document_id ?? null,
    }))

    return reply.send({ data: { ...draft, fields } })
  })

  // ── PATCH /onboarding/drafts/:id/fields ───────────────────────────────────
  fastify.patch('/drafts/:id/fields', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = fieldOverridesSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    const { data: draft, error: draftError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('id, session_id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (draftError || !draft) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Draft profile not found' })
    }

    const { overrides } = parsed.data

    // Build flat column updates for the draft_employee_profiles row
    const profileUpdates: Record<string, string> = {}
    for (const override of overrides) {
      profileUpdates[override.field_name] = override.value
    }

    // Update draft profile columns
    const { error: updateError } = await fastify.supabase
      .from('draft_employee_profiles')
      .update({ ...profileUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (updateError) return reply.code(500).send({ error: 'DB_ERROR', message: updateError.message })

    // Delete existing HR-override field rows for this draft + field names, then re-insert
    const overrideFieldNames = overrides.map((o) => o.field_name)
    await fastify.supabase
      .from('draft_employee_fields')
      .delete()
      .eq('draft_id', id)
      .eq('tenant_id', req.tenantId)
      .eq('is_hr_override', true)
      .in('field_name', overrideFieldNames)

    const fieldRows = overrides.map((o) => ({
      tenant_id:            req.tenantId,
      draft_id:             id,
      document_id:          null,
      field_name:           o.field_name,
      extracted_value:      o.value,
      confidence_score:     1.0,
      extraction_reasoning: 'HR manual override',
      source_document_type: 'hr_override',
      is_hr_override:       true,
    }))

    await fastify.supabase
      .from('draft_employee_fields')
      .insert(fieldRows)

    // Audit log
    await fastify.supabase
      .from('onboarding_audit_log')
      .insert({
        tenant_id: req.tenantId,
        session_id: draft.session_id,
        draft_id: id,
        action: 'field_overridden',
        actor_id: req.userId,
        details: { overrides },
      })

    // Return updated draft
    const { data: updatedDraft, error: fetchError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError) return reply.code(500).send({ error: 'DB_ERROR', message: fetchError.message })

    return reply.send({ data: updatedDraft })
  })

  // ── POST /onboarding/drafts/:id/validate ──────────────────────────────────
  fastify.post('/drafts/:id/validate', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data: draft, error: draftError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (draftError || !draft) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Draft profile not found' })
    }

    const validationErrors: string[] = []
    const validationWarnings: string[] = []
    let duplicateRisk: string | null = null
    let identityFlags: string[] = []

    // ── PAN number format ────────────────────────────────────────────────
    if (draft.pan_number) {
      if (!PAN_REGEX.test(draft.pan_number)) {
        validationErrors.push('pan_number format is invalid (expected AAAAA9999A)')
      } else {
        // Duplicate PAN check
        const { data: panDup } = await fastify.supabase
          .from('employee_bank_statutory')
          .select('employee_id')
          .eq('pan_number', draft.pan_number)
          .eq('tenant_id', req.tenantId)
          .limit(1)
          .maybeSingle()

        if (panDup) {
          duplicateRisk = `PAN ${draft.pan_number} already exists for employee ${panDup.employee_id}`
        }
      }
    }

    // ── Email format + duplicate ─────────────────────────────────────────
    if (draft.email) {
      if (!EMAIL_REGEX.test(draft.email)) {
        validationErrors.push('email format is invalid')
      } else {
        const { data: emailDup } = await fastify.supabase
          .from('employees')
          .select('id')
          .eq('email', draft.email)
          .eq('tenant_id', req.tenantId)
          .limit(1)
          .maybeSingle()

        if (emailDup) {
          if (!duplicateRisk) {
            duplicateRisk = `Email ${draft.email} already exists for employee ${emailDup.id}`
          } else {
            duplicateRisk += ` | Email ${draft.email} also duplicate`
          }
        }
      }
    }

    // ── UAN format + duplicate ───────────────────────────────────────────
    if (draft.uan_number) {
      if (!UAN_REGEX.test(draft.uan_number)) {
        validationErrors.push('uan_number must be exactly 12 digits')
      } else {
        const { data: uanDup } = await fastify.supabase
          .from('employee_bank_statutory')
          .select('employee_id')
          .eq('uan_number', draft.uan_number)
          .eq('tenant_id', req.tenantId)
          .limit(1)
          .maybeSingle()

        if (uanDup) {
          const uanNote = `UAN ${draft.uan_number} already exists for employee ${uanDup.employee_id}`
          if (!duplicateRisk) {
            duplicateRisk = uanNote
          } else {
            duplicateRisk += ` | ${uanNote}`
          }
        }
      }
    }

    // ── IFSC format ──────────────────────────────────────────────────────
    if (draft.ifsc_code) {
      if (!IFSC_REGEX.test(draft.ifsc_code)) {
        validationErrors.push('ifsc_code format is invalid (expected 11 chars e.g. SBIN0001234)')
      }
    }

    // ── joining_date not more than 90 days in future ─────────────────────
    if (draft.joining_date) {
      const joiningDate = new Date(draft.joining_date)
      const today = new Date()
      const ninetyDaysFromNow = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)

      if (joiningDate > ninetyDaysFromNow) {
        validationWarnings.push('joining_date is more than 90 days in the future')
      }

      // Department required if joining_date set
      if (!draft.department) {
        validationWarnings.push('department is recommended when joining_date is set')
      }
    }

    // ── Master-field existence checks ─────────────────────────────────────
    if (draft.department_id) {
      const { data: dept } = await fastify.supabase
        .from('departments')
        .select('id')
        .eq('id', draft.department_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!dept) validationErrors.push('Selected department does not exist in master data')
    }

    if (draft.designation_id) {
      const { data: desg } = await fastify.supabase
        .from('designations')
        .select('id')
        .eq('id', draft.designation_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!desg) validationErrors.push('Selected designation does not exist in master data')
    }

    if (draft.grade_id) {
      const { data: grade } = await fastify.supabase
        .from('grades')
        .select('id')
        .eq('id', draft.grade_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!grade) validationErrors.push('Selected grade does not exist in master data')
    }

    // ── Required field presence checks ────────────────────────────────────
    if (!draft.first_name && !(draft as any).full_name) {
      validationErrors.push('first_name or full_name is required')
    }
    if (!draft.email) {
      validationErrors.push('email is required')
    }
    if (!draft.joining_date) {
      validationErrors.push('joining_date is required')
    }

    // ── Master-field presence warnings ────────────────────────────────────
    if (!draft.department_id) {
      validationWarnings.push('Department not set — required before creating employee record')
    }
    if (!draft.designation_id) {
      validationWarnings.push('Designation not set — required before creating employee record')
    }

    // ── Cross-document identity verification (Aadhaar = anchor) ───────────
    // Ensure every uploaded document belongs to the same person: names and DOB
    // must match the Aadhaar (base proof). Mismatches block approval.
    {
      const { data: docFields } = await fastify.supabase
        .from('draft_employee_fields')
        .select('field_name, extracted_value, source_document_type')
        .eq('draft_id', id)
        .eq('tenant_id', req.tenantId)

      if (docFields && docFields.length > 0) {
        const { errors: idErrors, warnings: idWarnings, flaggedDocTypes } = crossCheckIdentity(docFields)
        validationErrors.push(...idErrors)
        validationWarnings.push(...idWarnings)
        identityFlags = flaggedDocTypes
      }
    }

    const hasErrors = validationErrors.length > 0
    const newStatus = hasErrors ? 'validation_pending' : 'approval_pending'

    await fastify.supabase
      .from('draft_employee_profiles')
      .update({
        validation_errors: validationErrors,
        validation_warnings: validationWarnings,
        duplicate_risk: duplicateRisk,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return reply.send({
      data: {
        validation_errors: validationErrors,
        validation_warnings: validationWarnings,
        duplicate_risk: duplicateRisk,
        identity_flags: identityFlags,
        status: newStatus,
      },
    })
  })

  // ── POST /onboarding/drafts/:id/approve ───────────────────────────────────
  // Supports an optional exception pass:
  //   { exception_pass: true, exception_reason: "..." }
  // When exception_pass is true, approval is allowed even from
  // 'validation_pending' status (errors present). The employee is created
  // and flagged onboarding_status='documents_pending' for follow-up.
  const approveSchema = z.object({
    exception_pass:   z.boolean().optional().default(false),
    exception_reason: z.string().max(500).optional(),
  })

  fastify.post('/drafts/:id/approve', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const parsed = approveSchema.safeParse(req.body ?? {})
    const exceptionPass   = parsed.success ? parsed.data.exception_pass   : false
    const exceptionReason = parsed.success ? parsed.data.exception_reason  : undefined

    const { data: draft, error: draftError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (draftError || !draft) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Draft profile not found' })
    }

    const allowedStatuses = exceptionPass
      ? ['approval_pending', 'validation_pending']
      : ['approval_pending']

    if (!allowedStatuses.includes(draft.status)) {
      return reply.code(409).send({
        error: 'INVALID_STATUS',
        message: exceptionPass
          ? `Cannot approve: draft status is "${draft.status}". Run validation first.`
          : `Draft must be in approval_pending status (current: ${draft.status}). Run validation, or use exception pass to override errors.`,
      })
    }

    // Generate employee_code
    const { count: empCount } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)

    const employeeCode = `EMP${String((empCount ?? 0) + 1).padStart(4, '0')}`

    // Build first_name / last_name from draft
    let firstName = draft.first_name ?? ''
    let lastName = draft.last_name ?? ''
    if (!firstName && draft.full_name) {
      const parts = (draft.full_name as string).trim().split(/\s+/)
      firstName = parts[0] ?? ''
      lastName = parts.slice(1).join(' ') || ''
    }

    // Create employee record (lean columns only per migration 016)
    const { data: employee, error: empError } = await fastify.supabase
      .from('employees')
      .insert({
        tenant_id: req.tenantId,
        employee_code: employeeCode,
        first_name: firstName,
        last_name: lastName,
        email: draft.email,
        phone: draft.phone ?? null,
        joining_date: draft.joining_date,
        status: 'active',
        created_by: req.userId,
      })
      .select('id, employee_code')
      .single()

    if (empError || !employee) {
      return reply.code(500).send({ error: 'DB_ERROR', message: empError?.message ?? 'Failed to create employee' })
    }

    const employeeId = employee.id

    // ── Copy onboarding documents → employee documents tab ─────────────────
    // Map onboarding document_type → documents.doc_type CHECK constraint values
    const DOC_TYPE_MAP: Record<string, string> = {
      aadhaar:           'aadhaar',
      pan:               'pan',
      offer_letter:      'offer_letter',
      experience_letter: 'experience_letter',
      relieving_letter:  'relieving_letter',
      passport:          'certificate',
      driving_license:   'certificate',
      resume:            'other',
      salary_slip:       'other',
      compensation_letter: 'other',
      bank_proof:        'other',
      pf_uan_document:   'other',
      esi_document:      'other',
      tax_document:      'other',
      joining_letter:    'offer_letter',
      certificate:       'certificate',
      contract:          'contract',
    }

    const { data: onboardingDocs, error: onboardingDocsError } = await fastify.supabase
      .from('onboarding_documents')
      .select('document_type, file_name, storage_path, file_size, mime_type, uploaded_by, extraction_status')
      .eq('session_id', draft.session_id)
      .eq('tenant_id', req.tenantId)
      .neq('extraction_status', 'rejected')   // never copy identity-rejected docs to employee master

    if (onboardingDocsError) {
      fastify.log.warn({ onboardingDocsError, sessionId: draft.session_id }, 'approve — failed to fetch onboarding docs for copy')
    } else if (onboardingDocs && onboardingDocs.length > 0) {
      const docRows = onboardingDocs.map((d: any) => ({
        tenant_id:    req.tenantId,
        employee_id:  employeeId,
        doc_type:     DOC_TYPE_MAP[d.document_type] ?? 'other',
        name:         d.file_name,
        storage_path: d.storage_path,
        file_size:    d.file_size ?? null,
        mime_type:    d.mime_type ?? null,
        uploaded_by:  d.uploaded_by ?? null,
      }))

      const { error: docInsertError } = await fastify.supabase
        .from('documents')
        .insert(docRows)

      if (docInsertError) {
        // Non-fatal — employee was created successfully; just log the copy failure
        fastify.log.warn({ docInsertError, employeeId, docCount: docRows.length }, 'approve — document copy to employee tab failed (non-fatal)')
      } else {
        fastify.log.info({ employeeId, docCount: docRows.length }, 'approve — onboarding documents copied to employee tab')
      }
    }

    // Create employee_personal_info if dob/gender available
    if (draft.dob || draft.gender) {
      await fastify.supabase
        .from('employee_personal_info')
        .insert({
          tenant_id: req.tenantId,
          employee_id: employeeId,
          dob: draft.dob ?? null,
          gender: draft.gender ?? null,
        })
    }

    // Link auth profile → employee (non-fatal — schema cache reload may be needed)
    if (draft.email) {
      try {
        const { data: authUser } = await fastify.supabase
          .from('profiles')
          .select('id')
          .eq('email', draft.email)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()

        if (authUser) {
          const { error: profileLinkErr } = await fastify.supabase
            .from('profiles')
            .update({ employee_id: employeeId })
            .eq('id', authUser.id)
          if (profileLinkErr) {
            // Likely a schema cache issue — run: NOTIFY pgrst, 'reload schema';
            fastify.log.warn({ profileLinkErr, employeeId }, 'approve: profile employee_id link failed (non-fatal — run schema cache reload)')
          }
        }
      } catch (e) {
        fastify.log.warn({ e, employeeId }, 'approve: profile link threw (non-fatal)')
      }
    }

    // Update draft status — record exception details if applicable
    await fastify.supabase
      .from('draft_employee_profiles')
      .update({
        status: 'employee_created',
        linked_employee_id: employeeId,
        updated_at: new Date().toISOString(),
        ...(exceptionPass ? {
          exception_approved: true,
          exception_reason: exceptionReason ?? 'Approved with exception by HR',
          exception_errors: draft.validation_errors ?? [],
        } : {}),
      })
      .eq('id', id)

    // Update session status
    await fastify.supabase
      .from('onboarding_sessions')
      .update({ status: 'employee_created' })
      .eq('id', draft.session_id)

    // Audit log — record exception details for traceability
    await fastify.supabase
      .from('onboarding_audit_log')
      .insert({
        tenant_id: req.tenantId,
        session_id: draft.session_id,
        draft_id: id,
        action: exceptionPass ? 'employee_created_with_exception' : 'employee_created',
        actor_id: req.userId,
        details: {
          employee_id: employeeId,
          employee_code: employeeCode,
          ...(exceptionPass ? {
            exception_reason: exceptionReason ?? 'Approved with exception by HR',
            overridden_errors: draft.validation_errors ?? [],
          } : {}),
        },
      })

    emitOnboardingSessionApproved({
      tenantId:      req.tenantId,
      sessionId:     draft.session_id,
      draftId:       id,
      employeeId,
      employeeCode,
      approvedBy:    req.userId,
      exceptionPass,
      joiningDate:   draft.joining_date ?? null,
      correlationId: (req as any).correlationId,
    })

    return reply.code(201).send({
      data: {
        employee_id: employeeId,
        employee_code: employeeCode,
        exception_pass: exceptionPass,
      },
    })
  })

  // ── POST /onboarding/drafts/:id/reject ────────────────────────────────────
  fastify.post('/drafts/:id/reject', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    const { data: draft, error: draftError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('id, session_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (draftError || !draft) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Draft profile not found' })
    }

    const { error: updateError } = await fastify.supabase
      .from('draft_employee_profiles')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return reply.code(500).send({ error: 'DB_ERROR', message: updateError.message })

    // Update session status
    await fastify.supabase
      .from('onboarding_sessions')
      .update({ status: 'rejected' })
      .eq('id', draft.session_id)

    // Audit log
    await fastify.supabase
      .from('onboarding_audit_log')
      .insert({
        tenant_id: req.tenantId,
        session_id: draft.session_id,
        draft_id: id,
        action: 'rejected',
        actor_id: req.userId,
        details: { reason: parsed.data.reason },
      })

    // Return updated draft
    const { data: updatedDraft } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('*')
      .eq('id', id)
      .single()

    emitOnboardingSessionRejected({
      tenantId:      req.tenantId,
      sessionId:     draft.session_id,
      draftId:       id,
      rejectedBy:    req.userId,
      reason:        parsed.data.reason,
      correlationId: (req as any).correlationId,
    })

    return reply.send({ data: updatedDraft })
  })

  // ── POST /onboarding/drafts/:id/request-reupload ──────────────────────────
  // Send the originating pre-join candidate back to revise/re-upload the flagged
  // document(s). Re-opens their portal and closes this draft/session.
  fastify.post('/drafts/:id/request-reupload', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const parsed = reuploadSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    const { data: draft } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('id, session_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!draft) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Draft profile not found' })
    }

    // Resolve the originating pre-join invitation from the session.
    const { data: invitation } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('session_id', draft.session_id)
      .maybeSingle()

    if (!invitation) {
      return reply.code(409).send({
        error: 'NO_PRE_JOIN_LINK',
        message: 'This onboarding session is not linked to a pre-join invitation, so it cannot be sent back for re-upload.',
      })
    }

    // Map onboarding document types back to the candidate portal's upload slots
    // (resume→cv, bank_proof→cheque) so the right slot is highlighted for the candidate.
    const PRE_JOIN_TYPE: Record<string, string> = { resume: 'cv', bank_proof: 'cheque', pan: 'pan', aadhaar: 'aadhaar', photo: 'photo' }
    const mappedItems = parsed.data.items.map(i => ({
      document_type: PRE_JOIN_TYPE[i.document_type] ?? i.document_type,
      reason:        i.reason,
    }))

    const result = await reopenInvitationForReupload(
      fastify, req.tenantId, invitation.id, mappedItems, parsed.data.message ?? null,
    )
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message })
    }

    // Close out this draft/session — the candidate's resubmission opens a fresh one.
    const reason = `Sent back to candidate for document re-upload: ${parsed.data.items.map(i => i.document_type).join(', ')}`
    await fastify.supabase
      .from('draft_employee_profiles')
      .update({ status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', id)
    await fastify.supabase
      .from('onboarding_sessions')
      .update({ status: 'rejected' })
      .eq('id', draft.session_id)
    await fastify.supabase
      .from('onboarding_audit_log')
      .insert({
        tenant_id: req.tenantId,
        session_id: draft.session_id,
        draft_id: id,
        action: 'reupload_requested',
        actor_id: req.userId,
        details: { items: parsed.data.items, message: parsed.data.message ?? null },
      })

    return reply.send({ message: 'Re-upload requested', invitation_id: invitation.id })
  })
}
