import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import {
  sendEmail, preJoineeInviteEmail, buddyAssignmentEmail, APP_PUBLIC_URL,
  type SendEmailResult,
} from '../../lib/email-service.js'
import { emitPreJoineeJoiningCompleted } from '../../lib/onboarding-orchestrator.js'
import { reopenInvitationForReupload } from '../../lib/onboarding/reopen-invitation.js'
import { logAction } from '../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

// ── Schemas ───────────────────────────────────────────────────────────────────

const createInvitationSchema = z.object({
  first_name:    z.string().min(1, 'first_name is required'),
  last_name:     z.string().min(1, 'last_name is required'),
  email:         z.string().email('Enter a valid email'),
  phone:         z.string().optional(),
  designation:   z.string().optional(),
  department:    z.string().optional(),
  joining_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'joining_date must be YYYY-MM-DD'),
})

const rejectSchema = z.object({
  notes: z.string().min(1, 'notes is required'),
})

const reuploadSchema = z.object({
  items: z.array(z.object({
    document_type: z.string().min(1),
    reason:        z.string().min(1, 'reason is required'),
  })).min(1, 'At least one document must be flagged'),
  message: z.string().optional(),
})

// Accepts BOTH the candidate-portal "friendly" field names and the DB-style
// names. All optional so either source validates; mapping to DB columns happens
// in the submit handler via resolveSubmission().
const submissionSchema = z.object({
  // HR-prefilled identity/role — editable by the candidate but flagged for review.
  first_name:                 z.string().optional(),
  last_name:                  z.string().optional(),
  email:                      z.string().optional(),
  phone:                      z.string().optional(),
  designation:                z.string().optional(),
  department:                 z.string().optional(),
  joining_date:               z.string().optional(),
  // Names of the identity fields the candidate changed away from the HR values.
  edited_fields:              z.array(z.string()).optional(),

  // Personal — portal sends date_of_birth, API/db uses dob
  dob:                        z.string().optional(),
  date_of_birth:              z.string().optional(),
  gender:                     z.string().optional(),
  blood_group:                z.string().optional(),
  marital_status:             z.string().optional(),
  nationality:                z.string().optional(),

  // Address
  address_line1:              z.string().optional(),
  address_line2:              z.string().optional(),
  city:                       z.string().optional(),
  state:                      z.string().optional(),
  pincode:                    z.string().optional(),

  // Emergency contact — portal: emergency_name / emergency_phone / emergency_relationship
  emergency_contact_name:     z.string().optional(),
  emergency_contact_phone:    z.string().optional(),
  emergency_contact_relation: z.string().optional(),
  emergency_name:             z.string().optional(),
  emergency_phone:            z.string().optional(),
  emergency_relation:         z.string().optional(),
  emergency_relationship:     z.string().optional(),

  // Bank — portal: account_number / ifsc_code / account_type
  bank_name:                  z.string().optional(),
  bank_account_number:        z.string().optional(),
  bank_ifsc:                  z.string().optional(),
  bank_account_type:          z.string().optional(),
  account_number:             z.string().optional(),
  ifsc:                       z.string().optional(),
  ifsc_code:                  z.string().optional(),
  account_type:               z.string().optional(),

  // Compliance
  pan_number:                 z.string().optional(),
  aadhaar_number:             z.string().optional(),
  uan_number:                 z.string().optional(),
  pan:                        z.string().optional(),
  aadhaar:                    z.string().optional(),
  uan:                        z.string().optional(),

  // Previous employment — candidate-declared prior work experience (0..N entries)
  previous_employment:        z.array(z.object({
    company_name:       z.string().optional(),
    designation:        z.string().optional(),
    from_date:          z.string().optional(),
    to_date:            z.string().optional(),
    last_ctc:           z.union([z.string(), z.number()]).optional(),
    reason_for_leaving: z.string().optional(),
  })).optional(),

  // Education — candidate-declared qualifications with optional certificate (0..N)
  education:                  z.array(z.object({
    qualification:      z.string().optional(),
    institution:        z.string().optional(),
    specialization:     z.string().optional(),
    year_of_completion: z.union([z.string(), z.number()]).optional(),
    grade:              z.string().optional(),
    document_path:      z.string().optional(),
    document_name:      z.string().optional(),
  })).optional(),

  // Declaration — portal sends `declaration`, API/db uses declaration_accepted
  declaration_accepted:       z.boolean().optional(),
  declaration:                z.boolean().optional(),
})

// Normalise gender/marital/account_type casing coming from the portal selects
// (e.g. "Male" → "male", "Savings" → "savings"). Returns null for empties.
function norm(v?: string | null): string | null {
  if (v === undefined || v === null) return null
  const t = v.trim()
  return t === '' ? null : t
}
function normLower(v?: string | null): string | null {
  const t = norm(v)
  return t ? t.toLowerCase() : null
}

// Identity/role fields HR pre-fills and the candidate may edit (and we flag).
const IDENTITY_FIELDS = [
  'first_name', 'last_name', 'email', 'phone',
  'designation', 'department', 'joining_date',
] as const

// Normalises candidate-declared previous employment: drops blank rows, coerces
// last_ctc to a number, trims strings. Returns a clean array safe to store/copy.
function resolvePreviousEmployment(body: SubmissionBody) {
  return (body.previous_employment ?? [])
    .map((e) => {
      const ctcRaw = e.last_ctc
      const ctcNum = ctcRaw === undefined || ctcRaw === '' || ctcRaw === null
        ? null
        : Number(ctcRaw)
      return {
        company_name:       norm(e.company_name),
        designation:        norm(e.designation),
        from_date:          norm(e.from_date),
        to_date:            norm(e.to_date),
        last_ctc:           Number.isFinite(ctcNum) ? ctcNum : null,
        reason_for_leaving: norm(e.reason_for_leaving),
      }
    })
    .filter((e) => e.company_name) // company name is the minimum to keep a row
}

// Normalises candidate-declared education: drops blank rows (no qualification),
// coerces year_of_completion to an integer, trims strings, keeps the uploaded
// certificate's storage path. Returns a clean array safe to store/copy.
function resolveEducation(body: SubmissionBody) {
  return (body.education ?? [])
    .map((e) => {
      const yearRaw = e.year_of_completion
      const yearNum = yearRaw === undefined || yearRaw === '' || yearRaw === null
        ? null
        : parseInt(String(yearRaw), 10)
      return {
        qualification:      norm(e.qualification),
        institution:        norm(e.institution),
        specialization:     norm(e.specialization),
        year_of_completion: Number.isFinite(yearNum) ? yearNum : null,
        grade:              norm(e.grade),
        document_path:      norm(e.document_path),
        document_name:      norm(e.document_name),
      }
    })
    .filter((e) => e.qualification) // qualification is the minimum to keep a row
}

// Maps a validated submission body (either field-name convention) to DB columns.
function resolveSubmission(body: SubmissionBody) {
  // Keep only recognised identity fields the candidate flagged as edited.
  const editedFields = (body.edited_fields ?? []).filter(
    (f): f is string => IDENTITY_FIELDS.includes(f as any)
  )
  return {
    previous_employment:        resolvePreviousEmployment(body),
    education:                  resolveEducation(body),
    confirmed_first_name:       norm(body.first_name),
    confirmed_last_name:        norm(body.last_name),
    confirmed_email:            norm(body.email),
    confirmed_phone:            norm(body.phone),
    confirmed_designation:      norm(body.designation),
    confirmed_department:       norm(body.department),
    confirmed_joining_date:     norm(body.joining_date),
    edited_fields:              editedFields,
    dob:                        norm(body.dob ?? body.date_of_birth),
    gender:                     normLower(body.gender),
    blood_group:                norm(body.blood_group),
    marital_status:             normLower(body.marital_status),
    nationality:                norm(body.nationality),
    address_line1:              norm(body.address_line1),
    address_line2:              norm(body.address_line2),
    city:                       norm(body.city),
    state:                      norm(body.state),
    pincode:                    norm(body.pincode),
    emergency_contact_name:     norm(body.emergency_contact_name ?? body.emergency_name),
    emergency_contact_phone:    norm(body.emergency_contact_phone ?? body.emergency_phone),
    emergency_contact_relation: norm(body.emergency_contact_relation ?? body.emergency_relation ?? body.emergency_relationship),
    bank_name:                  norm(body.bank_name),
    bank_account_number:        norm(body.bank_account_number ?? body.account_number),
    bank_ifsc:                  norm(body.bank_ifsc ?? body.ifsc ?? body.ifsc_code),
    bank_account_type:          normLower(body.bank_account_type ?? body.account_type),
    pan_number:                 norm(body.pan_number ?? body.pan),
    aadhaar_number:             norm(body.aadhaar_number ?? body.aadhaar),
    uan_number:                 norm(body.uan_number ?? body.uan),
    declaration_accepted:       body.declaration_accepted ?? body.declaration ?? false,
  }
}

const DOC_TYPES = ['cv', 'pan', 'aadhaar', 'cheque', 'photo', 'education'] as const
const MANDATORY_DOCS = ['cv', 'pan', 'aadhaar', 'cheque', 'photo'] as const

const uploadUrlSchema = z.object({
  document_type: z.enum(DOC_TYPES),
  file_name:     z.string().min(1, 'file_name is required'),
})

const registerDocSchema = z.object({
  document_type: z.enum(DOC_TYPES),
  file_name:     z.string().min(1, 'file_name is required'),
  storage_path:  z.string().min(1, 'storage_path is required'),
  mime_type:     z.string().optional(),
  file_size:     z.number().int().nonnegative().optional(),
})

type CreateInvitationBody = z.infer<typeof createInvitationSchema>
type RejectBody           = z.infer<typeof rejectSchema>
type SubmissionBody       = z.infer<typeof submissionSchema>

// ── Helper: token expiry (7 days) ─────────────────────────────────────────────
function tokenExpiresAt(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)   // 30 days — matches the invite email copy + DB default
  return d.toISOString()
}

// Maps a DB submission row → the field names the frontend expects.
function mapSubmissionRow(row: any) {
  if (!row) return null
  return {
    confirmed_first_name:   row.confirmed_first_name ?? null,
    confirmed_last_name:    row.confirmed_last_name ?? null,
    confirmed_email:        row.confirmed_email ?? null,
    confirmed_phone:        row.confirmed_phone ?? null,
    confirmed_designation:  row.confirmed_designation ?? null,
    confirmed_department:   row.confirmed_department ?? null,
    confirmed_joining_date: row.confirmed_joining_date ?? null,
    edited_fields:          Array.isArray(row.edited_fields) ? row.edited_fields : [],
    previous_employment:    Array.isArray(row.previous_employment) ? row.previous_employment : [],
    education:              Array.isArray(row.education) ? row.education : [],
    dob:                  row.dob ?? null,
    gender:               row.gender ?? null,
    blood_group:          row.blood_group ?? null,
    marital_status:       row.marital_status ?? null,
    nationality:          row.nationality ?? null,
    address_line1:        row.address_line1 ?? null,
    address_line2:        row.address_line2 ?? null,
    city:                 row.city ?? null,
    state:                row.state ?? null,
    pincode:              row.pincode ?? null,
    emergency_name:       row.emergency_contact_name ?? null,
    emergency_phone:      row.emergency_contact_phone ?? null,
    emergency_relation:   row.emergency_contact_relation ?? null,
    bank_name:            row.bank_name ?? null,
    account_number:       row.bank_account_number ?? null,
    ifsc:                 row.bank_ifsc ?? null,
    account_type:         row.bank_account_type ?? null,
    pan:                  row.pan_number ?? null,
    aadhaar:              row.aadhaar_number ?? null,
    uan:                  row.uan_number ?? null,
    documents_uploaded:   row.documents_uploaded ?? false,
    declaration_accepted: row.declaration_accepted ?? false,
    submitted_at:         row.submitted_at ?? null,
  }
}

// Enriches a mapped submission's education entries with short-lived signed URLs
// so HR can view the uploaded certificates in the review drawer. Safe on null /
// empty education. Never throws — a failed signature just yields a null URL.
async function signSubmissionEducation(fastify: FastifyInstance, submission: any) {
  if (!submission || !Array.isArray(submission.education) || submission.education.length === 0) {
    return submission
  }
  const education = await Promise.all(
    submission.education.map(async (e: any) => {
      if (!e?.document_path) return { ...e, document_url: null }
      const { data } = await fastify.supabase.storage
        .from('employee-files')
        .createSignedUrl(e.document_path, 3600)
      return { ...e, document_url: data?.signedUrl ?? null }
    }),
  )
  return { ...submission, education }
}

// ── Shared merge helper ─────────────────────────────────────────────────────
// Merges a pre-joinee invitation into the AI-onboarding review queue:
//   1. fetch the invitation's identity fields
//   2. create an onboarding_session
//   3. copy pre_joinee_documents → onboarding_documents (DOC_TYPE_MAP)
//   4. prefill a draft_employee_profile (status 'hr_review_pending')
//   5. link the invitation to its session_id
// Returns the new sessionId, or null on any error (logs a warning; never throws).
type MergeSubmission = {
  dob:                 any
  gender:              any
  address_line1:       any
  city:                any
  state:               any
  pincode:             any
  pan_number:          any
  uan_number:          any
  bank_name:           any
  bank_account_number: any
  bank_ifsc:           any
  bank_account_type:   any
}

async function mergeInvitationToSession(
  fastify: FastifyInstance,
  invitationId: string,
  tenantId: string,
  sub: MergeSubmission,
): Promise<string | null> {
  try {
    // 1. Fetch the invitation's identity fields.
    const { data: inv } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('first_name, last_name, email, designation, department, joining_date')
      .eq('id', invitationId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const firstName = inv?.first_name ?? null
    const lastName  = inv?.last_name ?? null
    const candidateName = `${firstName ?? ''} ${lastName ?? ''}`.trim() || (inv?.email ?? 'Candidate')

    // 2. Create the onboarding session (created_by null — public/candidate action).
    const { data: session, error: sessErr } = await fastify.supabase
      .from('onboarding_sessions')
      .insert({
        tenant_id:      tenantId,
        candidate_name: candidateName,
        status:         'active',
        created_by:     null,
      })
      .select('id')
      .single()

    if (sessErr || !session) throw sessErr ?? new Error('session insert returned no row')
    const sessionId: string = session.id

    // 3. Copy pre_joinee_documents → onboarding_documents (mapping document_type).
    //    'photo' is not allowed by the onboarding_documents CHECK → skip.
    const DOC_TYPE_MAP: Record<string, string | null> = {
      cv:      'resume',
      pan:     'pan',
      aadhaar: 'aadhaar',
      cheque:  'bank_proof',
      photo:   null, // not allowed by onboarding_documents CHECK → skip
    }

    const { data: preDocs } = await fastify.supabase
      .from('pre_joinee_documents')
      .select('document_type, file_name, storage_path, mime_type, file_size')
      .eq('invitation_id', invitationId)
      .eq('tenant_id', tenantId)

    const docRows = (preDocs ?? [])
      .map((d: any) => {
        const mapped = DOC_TYPE_MAP[d.document_type] ?? 'other'
        if (mapped === null) return null // skip photo
        return {
          tenant_id:         tenantId,
          session_id:        sessionId,
          document_type:     mapped,
          file_name:         d.file_name ?? d.document_type,
          storage_path:      d.storage_path,
          mime_type:         d.mime_type ?? null,
          file_size:         d.file_size ?? null,
          extraction_status: 'pending',
        }
      })
      .filter((r: any): r is NonNullable<typeof r> => r !== null)

    if (docRows.length > 0) {
      const { error: docInsErr } = await fastify.supabase
        .from('onboarding_documents')
        .insert(docRows)
      if (docInsErr) {
        fastify.log.warn({ event: 'pre_joinee.merge.docs', invitation_id: invitationId, session_id: sessionId, err: docInsErr })
      }
    }

    // 4. Prefill the draft_employee_profile from invitation + resolved submission.
    const allowedGenders = new Set(['male', 'female', 'other', 'prefer_not_to_say'])
    const draftGender = sub.gender && allowedGenders.has(sub.gender) ? sub.gender : null

    const { error: draftErr } = await fastify.supabase
      .from('draft_employee_profiles')
      .insert({
        tenant_id:           tenantId,
        session_id:          sessionId,
        status:              'hr_review_pending',
        first_name:          firstName,
        last_name:           lastName,
        email:               inv?.email ?? null,
        phone:               null, // submission has no phone
        dob:                 sub.dob,
        gender:              draftGender,
        address_line1:       sub.address_line1,
        address_city:        sub.city,
        address_state:       sub.state,
        address_pincode:     sub.pincode,
        joining_date:        inv?.joining_date ?? null,
        pan_number:          sub.pan_number,
        uan_number:          sub.uan_number,
        bank_name:           sub.bank_name,
        bank_account_number: sub.bank_account_number,
        bank_ifsc:           sub.bank_ifsc,
        bank_account_type:   sub.bank_account_type,
      })
    if (draftErr) {
      fastify.log.warn({ event: 'pre_joinee.merge.draft', invitation_id: invitationId, session_id: sessionId, err: draftErr })
    }

    // 5. Link the invitation to its onboarding session.
    const { error: linkErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .update({ session_id: sessionId })
      .eq('id', invitationId)
      .eq('tenant_id', tenantId)
    if (linkErr) {
      fastify.log.warn({ event: 'pre_joinee.merge.link', invitation_id: invitationId, session_id: sessionId, err: linkErr })
    }

    return sessionId
  } catch (mergeErr) {
    fastify.log.warn({ event: 'pre_joinee.merge', invitation_id: invitationId, err: mergeErr })
    return null
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function preJoineeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // Look up an invitation by token. Returns the invitation row, or sends an
  // appropriate error reply and returns null. Mirrors the GET token validation.
  async function resolveInvitationByToken(
    token: string,
    reply: any,
  ): Promise<{ id: string; tenant_id: string; status: string; expires_at: string | null } | null> {
    const { data: invitation, error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, tenant_id, status, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (error) {
      fastify.log.error({ event: 'pre_joinee.token.resolve', token, err: error })
      reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      return null
    }
    if (!invitation) {
      reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
      return null
    }

    const expired = invitation.expires_at ? new Date(invitation.expires_at) < new Date() : false
    if (expired) {
      reply.code(410).send({ error: 'GONE', message: 'This invitation link has expired' })
      return null
    }
    if (invitation.status !== 'pending') {
      reply.code(410).send({
        error: 'GONE',
        message: `This invitation has already been ${invitation.status}`,
      })
      return null
    }

    return invitation
  }

  // ── 0. GET /onboarding/pre-joinee/stats — status counts for the tenant ─────
  // Registered before the list/other GETs to keep route matching unambiguous.

  fastify.get('/onboarding/pre-joinee/stats', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId

    const { data, error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('status')
      .eq('tenant_id', tenantId)

    if (error) {
      fastify.log.error({ event: 'pre_joinee.stats', tenant_id: tenantId, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    const rows = data ?? []
    let pending = 0, submitted = 0, approved = 0
    for (const r of rows) {
      if (r.status === 'pending') pending++
      else if (r.status === 'submitted') submitted++
      else if (r.status === 'approved') approved++
    }

    return reply.send({ total: rows.length, pending, submitted, approved })
  })

  // ── 1. GET /onboarding/pre-joinee — list invitations ───────────────────────

  fastify.get('/onboarding/pre-joinee', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId

    const { data, error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      fastify.log.error({ event: 'pre_joinee.list', tenant_id: tenantId, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    const invitations = data ?? []

    // Fetch submissions for any submitted/approved invitations so the HR table
    // can show submitted_at and the review drawer can render details.
    const ids = invitations
      .filter((i: any) => i.status === 'submitted' || i.status === 'approved')
      .map((i: any) => i.id)

    const subsByInvitation: Record<string, any> = {}
    if (ids.length > 0) {
      const { data: subs } = await fastify.supabase
        .from('pre_joinee_submissions')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('invitation_id', ids)
      for (const s of subs ?? []) subsByInvitation[s.invitation_id] = s
    }

    const mapped = await Promise.all(invitations.map(async (inv: any) => {
      const subRow = subsByInvitation[inv.id] ?? null
      return {
        ...inv,
        invite_token: inv.token,
        invite_url:   `/pre-join/${inv.token}`,
        submitted_at: subRow?.submitted_at ?? null,
        submission:   await signSubmissionEducation(fastify, mapSubmissionRow(subRow)),
      }
    }))

    return reply.send({ data: mapped, total: mapped.length })
  })

  // ── 2. POST /onboarding/pre-joinee — create invitation ────────────────────

  fastify.post('/onboarding/pre-joinee', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId

    const parsed = createInvitationSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const body: CreateInvitationBody = parsed.data
    const token = randomUUID()
    const expiresAt = tokenExpiresAt()
    const email = body.email.trim().toLowerCase()

    const row = {
      tenant_id:    tenantId,
      first_name:   body.first_name,
      last_name:    body.last_name,
      email,
      phone:        body.phone ?? null,
      designation:  body.designation ?? null,
      department:   body.department ?? null,
      joining_date: body.joining_date,
      token,
      status:       'pending',
      expires_at:   expiresAt,
      created_by:   req.userId ?? null,
    }

    // Re-invite handling: an invite for this email already exists in this tenant
    // (UNIQUE(tenant_id,email)). Look it up — if it's still pending/expired/rejected,
    // refresh it (new token, reset to pending) instead of failing with a 500.
    const { data: existing } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .maybeSingle()

    let data: any = null
    let error: any = null

    if (existing) {
      if (existing.status === 'approved') {
        return reply.code(409).send({
          error: 'ALREADY_APPROVED',
          message: 'This candidate has already been approved and onboarded.',
        })
      }
      // Refresh the existing invite
      const upd = await fastify.supabase
        .from('pre_joinee_invitations')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      data = upd.data; error = upd.error
    } else {
      const ins = await fastify.supabase
        .from('pre_joinee_invitations')
        .insert(row)
        .select()
        .single()
      data = ins.data; error = ins.error
    }

    if (error) {
      fastify.log.error({ event: 'pre_joinee.create', tenant_id: tenantId, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'pre_joinee_invitations',
      recordId:    data.id,
      action:      existing ? 'UPDATE' : 'INSERT',
      performedBy: req.userId,
      newData:     { first_name: body.first_name, last_name: body.last_name, email, designation: body.designation ?? null, joining_date: body.joining_date, status: 'pending' },
    })

    // invite_url points at the PUBLIC candidate page route, not the API route.
    const inviteUrl     = `/pre-join/${token}`
    const fullInviteUrl = `${APP_PUBLIC_URL}${inviteUrl}`

    // ── Fire the invite email (best-effort — never blocks invite creation) ──
    let emailResult: SendEmailResult = { sent: false, skipped: true }
    try {
      // Resolve company name for the email greeting
      const { data: tenant } = await fastify.supabase
        .from('tenants').select('name').eq('id', tenantId).maybeSingle()
      const tmpl = preJoineeInviteEmail({
        candidateName: `${body.first_name} ${body.last_name}`.trim(),
        companyName:   tenant?.name ?? 'our company',
        joiningDate:   body.joining_date,
        inviteUrl:     fullInviteUrl,
      })
      emailResult = await sendEmail({ to: body.email, subject: tmpl.subject, html: tmpl.html })
    } catch (e) {
      fastify.log.warn({ event: 'pre_joinee.invite_email', err: e })
    }

    return reply.code(201).send({
      data: {
        ...data,
        invite_token: token,
        invite_url:   inviteUrl,
        email_sent:   emailResult.sent,
        email_skipped: emailResult.skipped ?? false,
      },
    })
  })

  // ── 2b. POST /onboarding/pre-joinee/:id/resend — re-send + extend the link ──
  // Re-emails the candidate and pushes the expiry out so an expired/old link
  // works again. Keeps the same token (the previously emailed link stays valid).
  fastify.post('/onboarding/pre-joinee/:id/resend', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    const { data: inv, error: fetchErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, tenant_id, token, first_name, last_name, email, joining_date, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'DB_ERROR', message: fetchErr.message })
    if (!inv)     return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })

    // Only resend while the candidate still has work to do.
    if (!['pending', 'expired', 'changes_requested'].includes(inv.status)) {
      return reply.code(409).send({
        error: 'INVALID_STATE',
        message: `Cannot resend — this invitation has already been ${inv.status}.`,
      })
    }

    const expiresAt = tokenExpiresAt()                         // fresh 30-day window
    const newStatus = inv.status === 'expired' ? 'pending' : inv.status
    const { error: updErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .update({ expires_at: expiresAt, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updErr) return reply.code(500).send({ error: 'DB_ERROR', message: updErr.message })

    const fullInviteUrl = `${APP_PUBLIC_URL}/pre-join/${inv.token}`
    let emailResult: SendEmailResult = { sent: false, skipped: true }
    try {
      const { data: tenant } = await fastify.supabase
        .from('tenants').select('name').eq('id', tenantId).maybeSingle()
      const tmpl = preJoineeInviteEmail({
        candidateName: `${inv.first_name ?? ''} ${inv.last_name ?? ''}`.trim(),
        companyName:   tenant?.name ?? 'our company',
        joiningDate:   inv.joining_date,
        inviteUrl:     fullInviteUrl,
      })
      emailResult = await sendEmail({ to: inv.email, subject: tmpl.subject, html: tmpl.html })
    } catch (e) {
      fastify.log.warn({ event: 'pre_joinee.resend_email', invitation_id: id, err: e })
    }

    await logAction(fastify.supabase, {
      tenantId, tableName: 'pre_joinee_invitations', recordId: id,
      action: 'UPDATE', performedBy: req.userId,
      newData: { resent: true, status: newStatus, expires_at: expiresAt },
    })

    return reply.send({
      message:       'Invitation resent',
      id,
      invite_url:    `/pre-join/${inv.token}`,
      email_sent:    emailResult.sent,
      email_skipped: emailResult.skipped ?? false,
      expires_at:    expiresAt,
    })
  })

  // ── 3. DELETE /onboarding/pre-joinee/:id — cancel/delete invitation ────────

  fastify.delete('/onboarding/pre-joinee/:id', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      fastify.log.error({ event: 'pre_joinee.delete', tenant_id: tenantId, id, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'pre_joinee_invitations',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
    })

    return reply.code(204).send()
  })

  // ── 3b. POST /onboarding/pre-joinee/:id/push-to-review ─────────────────────
  // Backfill: push an already-submitted candidate into the AI review queue.
  // Idempotent — if a session is already linked, returns it unchanged.
  fastify.post('/onboarding/pre-joinee/:id/push-to-review', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    // 1. Load the invitation.
    const { data: invitation, error: invErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, session_id, status, tenant_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (invErr || !invitation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
    }

    // 2. Already linked → idempotent return.
    if (invitation.session_id) {
      return reply.send({ data: { session_id: invitation.session_id, already: true } })
    }

    // 3. Load its submission row.
    const { data: subRow, error: subErr } = await fastify.supabase
      .from('pre_joinee_submissions')
      .select('*')
      .eq('invitation_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (subErr) {
      fastify.log.error({ event: 'pre_joinee.push_to_review.submission', tenant_id: tenantId, id, err: subErr })
      return reply.code(500).send({ error: 'DB_ERROR', message: subErr.message })
    }
    if (!subRow) {
      return reply.code(400).send({ error: 'NO_SUBMISSION', message: 'Candidate has not submitted yet' })
    }

    // 4. Build the sub object (columns already match) and merge.
    const sub = {
      dob:                 subRow.dob,
      gender:              subRow.gender,
      address_line1:       subRow.address_line1,
      city:                subRow.city,
      state:               subRow.state,
      pincode:             subRow.pincode,
      pan_number:          subRow.pan_number,
      uan_number:          subRow.uan_number,
      bank_name:           subRow.bank_name,
      bank_account_number: subRow.bank_account_number,
      bank_ifsc:           subRow.bank_ifsc,
      bank_account_type:   subRow.bank_account_type,
    }

    const sessionId = await mergeInvitationToSession(fastify, id, tenantId, sub)

    // 5. Failure → 500.
    if (!sessionId) {
      return reply.code(500).send({ error: 'MERGE_FAILED' })
    }

    return reply.send({ data: { session_id: sessionId } })
  })

  // ── 4. POST /onboarding/pre-joinee/:id/approve — approve + create employee ─
  //
  // RH-01: On first call (no body / no action), the handler checks for an
  // existing employee record matching by email, phone, PAN, or Aadhaar.
  // If found it returns { action_required: 'rehire_check', existing_employee, match_reason }
  // without creating anything.  HR then chooses:
  //   { action: 'rehire',       employee_id } → reactivate existing record
  //   { action: 'new_employee'              } → skip the check, create fresh

  const approveBodySchema = z.object({
    action:      z.enum(['rehire', 'new_employee']).optional(),
    employee_id: z.string().uuid().optional(),
  })

  fastify.post('/onboarding/pre-joinee/:id/approve', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole as any)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    const parsedBody    = approveBodySchema.safeParse(req.body ?? {})
    const action        = parsedBody.success ? parsedBody.data.action        : undefined
    const rehireEmpId   = parsedBody.success ? parsedBody.data.employee_id   : undefined

    // Fetch invitation
    const { data: invitation, error: invErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (invErr || !invitation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
    }

    if (invitation.status !== 'submitted') {
      return reply.code(409).send({
        error: 'INVALID_STATE',
        message: `Cannot approve invitation with status '${invitation.status}'`,
      })
    }

    // Fetch submission details
    const { data: submission } = await fastify.supabase
      .from('pre_joinee_submissions')
      .select('*')
      .eq('invitation_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    // ── RH-01: Rehire detection (skip when HR has already made a choice) ─────
    if (!action) {
      const empSelect = 'id, employee_code, first_name, last_name, email, phone, status, joining_date'

      let existing: Record<string, unknown> | null = null
      let matchReason: string | null = null

      // 1. Email match
      if (!existing && invitation.email) {
        const { data } = await fastify.supabase
          .from('employees')
          .select(empSelect)
          .eq('tenant_id', tenantId)
          .eq('email', invitation.email)
          .maybeSingle()
        if (data) { existing = data; matchReason = 'email' }
      }

      // 2. Phone match
      if (!existing && invitation.phone) {
        const { data } = await fastify.supabase
          .from('employees')
          .select(empSelect)
          .eq('tenant_id', tenantId)
          .eq('phone', invitation.phone)
          .maybeSingle()
        if (data) { existing = data; matchReason = 'phone' }
      }

      // 3. PAN match (via employee_identity)
      if (!existing && submission?.pan_number) {
        const { data: idRow } = await fastify.supabase
          .from('employee_identity')
          .select('employee_id')
          .eq('tenant_id', tenantId)
          .eq('identity_number', submission.pan_number)
          .maybeSingle()
        if (idRow?.employee_id) {
          const { data } = await fastify.supabase
            .from('employees')
            .select(empSelect)
            .eq('id', idRow.employee_id)
            .maybeSingle()
          if (data) { existing = data; matchReason = 'pan' }
        }
      }

      // 4. Aadhaar match (via employee_identity)
      if (!existing && submission?.aadhaar_number) {
        const { data: idRow } = await fastify.supabase
          .from('employee_identity')
          .select('employee_id')
          .eq('tenant_id', tenantId)
          .eq('identity_number', submission.aadhaar_number)
          .maybeSingle()
        if (idRow?.employee_id) {
          const { data } = await fastify.supabase
            .from('employees')
            .select(empSelect)
            .eq('id', idRow.employee_id)
            .maybeSingle()
          if (data) { existing = data; matchReason = 'aadhaar' }
        }
      }

      if (existing) {
        return reply.send({
          action_required:   'rehire_check',
          existing_employee: existing,
          match_reason:      matchReason,
        })
      }
    }

    // ── RH-01: Rehire path — reactivate existing employee ───────────────────
    if (action === 'rehire') {
      if (!rehireEmpId) {
        return reply.code(400).send({ error: 'MISSING_EMPLOYEE_ID', message: 'employee_id is required for rehire action' })
      }

      await fastify.supabase
        .from('employees')
        .update({ status: 'active', joining_date: invitation.joining_date, updated_at: new Date().toISOString() })
        .eq('id', rehireEmpId)
        .eq('tenant_id', tenantId)

      await fastify.supabase
        .from('pre_joinee_invitations')
        .update({ status: 'approved', employee_id: rehireEmpId, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId)

      await logAction(fastify.supabase, {
        tenantId,
        tableName:   'pre_joinee_invitations',
        recordId:    id,
        action:      'UPDATE',
        performedBy: req.userId,
        onBehalfOf:  rehireEmpId,
        oldData:     { status: invitation.status },
        newData:     { status: 'approved', employee_id: rehireEmpId, rehired: true },
      })

      emitPreJoineeJoiningCompleted({
        tenantId,
        invitationId: id,
        employeeId:   rehireEmpId,
        employeeCode: '',
        joiningDate:  invitation.joining_date ?? null,
      })

      return reply.send({
        message:     'Candidate rehired — existing employee record reactivated',
        employee_id: rehireEmpId,
        rehired:     true,
      })
    }

    // ── New employee path (action === 'new_employee' or no match found) ──────

    // Generate employee_code (NOT NULL on employees) — same scheme as the
    // draft-approval path so both onboarding routes stay consistent.
    const { count: empCount } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)

    const employeeCode = `EMP${String((empCount ?? 0) + 1).padStart(4, '0')}`

    // ── Insert employee ──────────────────────────────────────────────────────
    const { data: employee, error: empErr } = await fastify.supabase
      .from('employees')
      .insert({
        tenant_id:     tenantId,
        employee_code: employeeCode,
        first_name:    invitation.first_name,
        last_name:     invitation.last_name,
        email:         invitation.email,
        phone:         invitation.phone ?? null,
        joining_date:  invitation.joining_date,
        status:        'active',
        created_by:    req.userId,
      })
      .select()
      .single()

    if (empErr || !employee) {
      fastify.log.error({ event: 'pre_joinee.approve.emp_insert', tenant_id: tenantId, err: empErr })
      return reply.code(500).send({ error: 'DB_ERROR', message: empErr?.message ?? 'Failed to create employee' })
    }

    const employeeId: string = employee.id

    // ── Insert job_history ───────────────────────────────────────────────────
    const { error: jobErr } = await fastify.supabase
      .from('job_history')
      .insert({
        tenant_id:        tenantId,
        employee_id:      employeeId,
        employment_type:  'permanent',
        effective_from:   invitation.joining_date,
        is_current:       true,
        created_at:       new Date().toISOString(),
      })

    if (jobErr) {
      fastify.log.warn({ event: 'pre_joinee.approve.job_insert', tenant_id: tenantId, employee_id: employeeId, err: jobErr })
    }

    // ── Personal info + profile photo ─────────────────────────────────────────
    // Persist the candidate's personal details and promote the mandatory
    // passport photo to the employee's profile photo (it already lives in the
    // employee-files bucket, so the stored path resolves directly).
    {
      const { data: photoDoc } = await fastify.supabase
        .from('pre_joinee_documents')
        .select('storage_path')
        .eq('invitation_id', id)
        .eq('tenant_id', tenantId)
        .eq('document_type', 'photo')
        .maybeSingle()

      const okGender  = new Set(['male', 'female', 'other'])
      const okMarital = new Set(['single', 'married', 'divorced', 'widowed'])
      const piGender  = submission?.gender && okGender.has(submission.gender) ? submission.gender : null
      const piMarital = submission?.marital_status && okMarital.has(submission.marital_status) ? submission.marital_status : null

      if (photoDoc?.storage_path || submission?.dob || piGender || submission?.blood_group || piMarital) {
        const { error: piErr } = await fastify.supabase
          .from('employee_personal_info')
          .insert({
            tenant_id:      tenantId,
            employee_id:    employeeId,
            dob:            submission?.dob ?? null,
            gender:         piGender,
            blood_group:    submission?.blood_group ?? null,
            marital_status: piMarital,
            ...(submission?.nationality ? { nationality: submission.nationality } : {}),
            profile_photo:  photoDoc?.storage_path ?? null,
          })
        if (piErr) {
          fastify.log.warn({ event: 'pre_joinee.approve.personal_info_insert', tenant_id: tenantId, employee_id: employeeId, err: piErr })
        }
      }
    }

    // ── Previous employment (candidate-declared work history) ─────────────────
    if (submission && Array.isArray(submission.previous_employment) && submission.previous_employment.length > 0) {
      const prevRows = submission.previous_employment
        .filter((e: any) => e?.company_name)
        .map((e: any) => ({
          tenant_id:          tenantId,
          employee_id:        employeeId,
          company_name:       e.company_name,
          designation:        e.designation ?? null,
          from_date:          e.from_date ?? null,
          to_date:            e.to_date ?? null,
          last_ctc:           e.last_ctc ?? null,
          reason_for_leaving: e.reason_for_leaving ?? null,
        }))
      if (prevRows.length > 0) {
        const { error: prevErr } = await fastify.supabase
          .from('previous_employment')
          .insert(prevRows)
        if (prevErr) {
          fastify.log.warn({ event: 'pre_joinee.approve.prev_emp_insert', tenant_id: tenantId, employee_id: employeeId, err: prevErr })
        }
      }
    }

    // ── Education (candidate-declared qualifications + certificates) ──────────
    if (submission && Array.isArray(submission.education) && submission.education.length > 0) {
      const eduRows = submission.education
        .filter((e: any) => e?.qualification)
        .map((e: any) => ({
          tenant_id:          tenantId,
          employee_id:        employeeId,
          qualification:      e.qualification,
          institution:        e.institution ?? null,
          specialization:     e.specialization ?? null,
          year_of_completion: e.year_of_completion ?? null,
          grade:              e.grade ?? null,
          document_path:      e.document_path ?? null,
          document_name:      e.document_name ?? null,
        }))
      if (eduRows.length > 0) {
        const { error: eduErr } = await fastify.supabase
          .from('employee_education')
          .insert(eduRows)
        if (eduErr) {
          fastify.log.warn({ event: 'pre_joinee.approve.education_insert', tenant_id: tenantId, employee_id: employeeId, err: eduErr })
        }
      }
    }

    // ── Bank details ─────────────────────────────────────────────────────────
    if (
      submission &&
      (submission.bank_name || submission.bank_account_number || submission.bank_ifsc)
    ) {
      const { error: bankErr } = await fastify.supabase
        .from('employee_bank_statutory')
        .insert({
          tenant_id:           tenantId,
          employee_id:         employeeId,
          bank_name:           submission.bank_name ?? null,
          account_number:      submission.bank_account_number ?? null,
          ifsc_code:           submission.bank_ifsc ?? null,
          account_type:        submission.bank_account_type ?? null,
          uan_number:          submission.uan_number ?? null,
          created_at:          new Date().toISOString(),
          updated_at:          new Date().toISOString(),
        })

      if (bankErr) {
        fastify.log.warn({ event: 'pre_joinee.approve.bank_insert', tenant_id: tenantId, employee_id: employeeId, err: bankErr })
      }
    }

    // ── Identity (PAN / Aadhaar) ─────────────────────────────────────────────
    if (submission && (submission.pan_number || submission.aadhaar_number)) {
      const identityRows: object[] = []

      if (submission.pan_number) {
        identityRows.push({
          tenant_id:      tenantId,
          employee_id:    employeeId,
          identity_type:  'pan',
          identity_number: submission.pan_number,
          created_at:     new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        })
      }

      if (submission.aadhaar_number) {
        identityRows.push({
          tenant_id:      tenantId,
          employee_id:    employeeId,
          identity_type:  'aadhaar',
          identity_number: submission.aadhaar_number,
          created_at:     new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        })
      }

      if (identityRows.length > 0) {
        const { error: idErr } = await fastify.supabase
          .from('employee_identity')
          .insert(identityRows)

        if (idErr) {
          fastify.log.warn({ event: 'pre_joinee.approve.identity_insert', tenant_id: tenantId, employee_id: employeeId, err: idErr })
        }
      }
    }

    // ── Update invitation status ─────────────────────────────────────────────
    const { error: updateErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .update({ status: 'approved', employee_id: employeeId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updateErr) {
      fastify.log.warn({ event: 'pre_joinee.approve.status_update', tenant_id: tenantId, id, err: updateErr })
    }

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'pre_joinee_invitations',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      oldData:     { status: invitation.status },
      newData:     { status: 'approved', employee_id: employeeId, employee_code: employeeCode },
    })

    // Trigger welcome email (ONB-04) + IT provisioning notification (ONB-05)
    emitPreJoineeJoiningCompleted({
      tenantId,
      invitationId: id,
      employeeId,
      employeeCode,
      joiningDate:  invitation.joining_date ?? null,
    })

    return reply.send({
      message:     'Invitation approved and employee created',
      employee_id: employeeId,
      employee,
    })
  })

  // ── 5. POST /onboarding/pre-joinee/:id/reject — reject with reason ─────────

  fastify.post('/onboarding/pre-joinee/:id/reject', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole as any)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const { notes } = parsed.data as RejectBody

    const { data: invitation, error: fetchErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchErr || !invitation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
    }

    const { error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .update({
        status:     'rejected',
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      fastify.log.error({ event: 'pre_joinee.reject', tenant_id: tenantId, id, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'pre_joinee_invitations',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      oldData:     { status: invitation.status },
      newData:     { status: 'rejected', notes },
    })

    return reply.send({ message: 'Invitation rejected', id, notes })
  })

  // ── 5b. POST /onboarding/pre-joinee/:id/request-reupload ──────────────────
  // Bounce a submitted invitation back to the candidate to revise/re-upload the
  // flagged document(s). Re-opens their portal (status → changes_requested).
  fastify.post('/onboarding/pre-joinee/:id/request-reupload', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    const parsed = reuploadSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const result = await reopenInvitationForReupload(
      fastify, tenantId, id, parsed.data.items, parsed.data.message ?? null,
    )
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message })
    }

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'pre_joinee_invitations',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'changes_requested', requested_changes: parsed.data.items },
    })

    return reply.send({ message: 'Re-upload requested', id, status: 'changes_requested' })
  })

  // ── 6. GET /onboarding/pre-joinee/:id/submission — get submission for HR ───

  fastify.get('/onboarding/pre-joinee/:id/submission', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

    // Ensure invitation belongs to tenant
    const { data: invitation, error: invErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (invErr || !invitation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
    }

    const { data: submission, error: subErr } = await fastify.supabase
      .from('pre_joinee_submissions')
      .select('*')
      .eq('invitation_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (subErr) {
      fastify.log.error({ event: 'pre_joinee.submission.fetch', tenant_id: tenantId, id, err: subErr })
      return reply.code(500).send({ error: 'DB_ERROR', message: subErr.message })
    }

    return reply.send({
      data: {
        ...invitation,
        invite_token: invitation.token,
        invite_url:   `/pre-join/${invitation.token}`,
        submitted_at: submission?.submitted_at ?? null,
        submission:   await signSubmissionEducation(fastify, mapSubmissionRow(submission)),
      },
      invitation,
      submission: await signSubmissionEducation(fastify, mapSubmissionRow(submission)),
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC ROUTES — no authentication, token-based
  // ─────────────────────────────────────────────────────────────────────────────

  // ── 7. GET /onboarding/pre-join/:token — validate token ───────────────────

  fastify.get('/onboarding/pre-join/:token', async (req: any, reply) => {
    const { token } = req.params as { token: string }

    const { data: invitation, error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, tenant_id, first_name, last_name, email, phone, designation, department, joining_date, status, expires_at, requested_changes')
      .eq('token', token)
      .maybeSingle()

    if (error) {
      fastify.log.error({ event: 'pre_joinee.token.validate', token, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    if (!invitation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
    }

    const now = new Date()
    const expired = invitation.expires_at ? new Date(invitation.expires_at) < now : false
    const usedStatuses = ['submitted', 'approved', 'rejected']

    if (expired || usedStatuses.includes(invitation.status)) {
      return reply.code(410).send({
        error: 'GONE',
        message: expired
          ? 'This invitation link has expired'
          : `This invitation has already been ${invitation.status}`,
      })
    }

    // Resolve company name for the portal welcome banner.
    let companyName: string | null = null
    if (invitation.tenant_id) {
      const { data: tenant } = await fastify.supabase
        .from('tenants')
        .select('name')
        .eq('id', invitation.tenant_id)
        .maybeSingle()
      companyName = tenant?.name ?? null
    }

    const candidateName = `${invitation.first_name ?? ''} ${invitation.last_name ?? ''}`.trim()

    // When re-opened for re-upload, return the candidate's prior submission +
    // flagged docs so the portal pre-fills and highlights what to revise.
    let submission: any = null
    let uploadedDocuments: string[] = []
    if (invitation.status === 'changes_requested') {
      const { data: subRow } = await fastify.supabase
        .from('pre_joinee_submissions')
        .select('*')
        .eq('invitation_id', invitation.id)
        .maybeSingle()
      submission = await signSubmissionEducation(fastify, mapSubmissionRow(subRow))
      const { data: docRows } = await fastify.supabase
        .from('pre_joinee_documents')
        .select('document_type')
        .eq('invitation_id', invitation.id)
        .eq('tenant_id', invitation.tenant_id)
      uploadedDocuments = (docRows ?? []).map((d: any) => d.document_type)
    }

    return reply.send({
      id:             invitation.id,
      first_name:     invitation.first_name,
      last_name:      invitation.last_name,
      candidate_name: candidateName,
      company_name:   companyName,
      email:          invitation.email,
      phone:          invitation.phone ?? null,
      designation:    invitation.designation ?? null,
      department:     invitation.department ?? null,
      joining_date:   invitation.joining_date,
      status:         invitation.status,
      expires_at:     invitation.expires_at ?? null,
      requested_changes:  Array.isArray(invitation.requested_changes) ? invitation.requested_changes : [],
      submission,
      uploaded_documents: uploadedDocuments,
    })
  })

  // ── 7-bis. POST /onboarding/pre-join/:token/request-new-link ───────────────
  // PUBLIC self-service: a candidate on the "link expired" screen renews their
  // own link. Extends the expiry on the SAME token (so the page they're on works
  // again on reload) and re-emails it. Knowing the 32-byte token is the auth.
  fastify.post('/onboarding/pre-join/:token/request-new-link', async (req: any, reply) => {
    const { token } = req.params as { token: string }

    const { data: inv } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, tenant_id, token, first_name, last_name, email, joining_date, status')
      .eq('token', token)
      .maybeSingle()

    // Generic OK if the token is unknown — never reveal whether it exists.
    if (!inv) {
      return reply.send({ ok: true, message: 'If this invitation is still active, a fresh link has been sent.' })
    }

    // Already finished — there's nothing to renew.
    if (['submitted', 'approved', 'rejected'].includes(inv.status)) {
      return reply.code(409).send({
        error: 'NOT_RESUMABLE',
        message: `This onboarding has already been ${inv.status}. Please contact your HR team.`,
      })
    }

    const expiresAt = tokenExpiresAt()
    const newStatus = inv.status === 'expired' ? 'pending' : inv.status
    await fastify.supabase
      .from('pre_joinee_invitations')
      .update({ expires_at: expiresAt, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', inv.id)
      .eq('tenant_id', inv.tenant_id)

    try {
      const { data: tenant } = await fastify.supabase
        .from('tenants').select('name').eq('id', inv.tenant_id).maybeSingle()
      const tmpl = preJoineeInviteEmail({
        candidateName: `${inv.first_name ?? ''} ${inv.last_name ?? ''}`.trim(),
        companyName:   tenant?.name ?? 'our company',
        joiningDate:   inv.joining_date,
        inviteUrl:     `${APP_PUBLIC_URL}/pre-join/${inv.token}`,
      })
      await sendEmail({ to: inv.email, subject: tmpl.subject, html: tmpl.html })
    } catch (e) {
      fastify.log.warn({ event: 'pre_joinee.self_request_link', token, err: e })
    }

    const masked = (inv.email ?? '').replace(/^(.).*(@.*)$/, (_m: string, a: string, b: string) => `${a}***${b}`)
    return reply.send({ ok: true, message: 'Your link has been renewed.', email_masked: masked })
  })

  // ── 7a. POST /onboarding/pre-join/:token/upload-url — signed upload URL ─────

  fastify.post('/onboarding/pre-join/:token/upload-url', async (req: any, reply) => {
    const { token } = req.params as { token: string }

    const parsed = uploadUrlSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const invitation = await resolveInvitationByToken(token, reply)
    if (!invitation) return // reply already sent

    const { document_type, file_name } = parsed.data
    const ext = file_name.includes('.') ? file_name.split('.').pop()!.toLowerCase() : 'bin'
    const path = `pre-onboarding/${invitation.tenant_id}/${invitation.id}/${document_type}-${Date.now()}.${ext}`

    const { data, error } = await fastify.supabase.storage
      .from('employee-files')
      .createSignedUploadUrl(path)

    if (error || !data) {
      fastify.log.error({ event: 'pre_joinee.upload_url', invitation_id: invitation.id, err: error })
      return reply.code(500).send({ error: 'STORAGE_ERROR', message: error?.message ?? 'Failed to create upload URL' })
    }

    return reply.send({
      data: { signed_url: data.signedUrl, token: data.token, path },
    })
  })

  // ── 7b. POST /onboarding/pre-join/:token/documents — register uploaded doc ──

  fastify.post('/onboarding/pre-join/:token/documents', async (req: any, reply) => {
    const { token } = req.params as { token: string }

    const parsed = registerDocSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const invitation = await resolveInvitationByToken(token, reply)
    if (!invitation) return // reply already sent

    const { document_type, file_name, storage_path, mime_type, file_size } = parsed.data

    // The candidate can only register a path inside their own invitation's
    // namespace (the prefix the upload-url endpoint hands out). Without this a
    // valid token could point a "document" at any object in the shared bucket,
    // which is later disclosed via signed URL → cross-tenant file read.
    const expectedPrefix = `pre-onboarding/${invitation.tenant_id}/${invitation.id}/`
    if (!storage_path.startsWith(expectedPrefix)) {
      return reply.code(400).send({
        error:   'INVALID_STORAGE_PATH',
        message: 'storage_path must be within your onboarding namespace',
      })
    }

    const { error } = await fastify.supabase
      .from('pre_joinee_documents')
      .upsert(
        {
          tenant_id:     invitation.tenant_id,
          invitation_id: invitation.id,
          document_type,
          file_name,
          storage_path,
          mime_type:     mime_type ?? null,
          file_size:     file_size ?? null,
          uploaded_at:   new Date().toISOString(),
        },
        { onConflict: 'invitation_id,document_type' },
      )

    if (error) {
      fastify.log.error({ event: 'pre_joinee.documents.upsert', invitation_id: invitation.id, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: { document_type, storage_path } })
  })

  // ── 8. POST /onboarding/pre-join/:token/submit — candidate submits details ─

  fastify.post('/onboarding/pre-join/:token/submit', async (req: any, reply) => {
    const { token } = req.params as { token: string }

    const parsed = submissionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }

    const body = parsed.data as SubmissionBody
    const sub = resolveSubmission(body)

    if (!sub.declaration_accepted) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'declaration_accepted must be true',
      })
    }

    // Validate token
    const { data: invitation, error: invErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .select('id, tenant_id, status, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (invErr) {
      fastify.log.error({ event: 'pre_joinee.submit.token_lookup', token, err: invErr })
      return reply.code(500).send({ error: 'DB_ERROR', message: invErr.message })
    }

    if (!invitation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invitation not found' })
    }

    const now = new Date()
    const expired = invitation.expires_at ? new Date(invitation.expires_at) < now : false

    if (expired) {
      return reply.code(410).send({ error: 'GONE', message: 'This invitation link has expired' })
    }

    if (invitation.status !== 'pending' && invitation.status !== 'changes_requested') {
      return reply.code(409).send({
        error: 'ALREADY_SUBMITTED',
        message: `Invitation has already been ${invitation.status}`,
      })
    }

    const tenantId: string = invitation.tenant_id

    // Guard: all 4 mandatory documents must be uploaded before submission.
    const { data: docs, error: docsErr } = await fastify.supabase
      .from('pre_joinee_documents')
      .select('document_type')
      .eq('invitation_id', invitation.id)

    if (docsErr) {
      fastify.log.error({ event: 'pre_joinee.submit.docs_check', invitation_id: invitation.id, err: docsErr })
      return reply.code(500).send({ error: 'DB_ERROR', message: docsErr.message })
    }

    const have = new Set((docs ?? []).map((d: any) => d.document_type))
    const missing = MANDATORY_DOCS.filter((t) => !have.has(t))
    if (missing.length > 0) {
      return reply.code(400).send({
        error: 'DOCUMENTS_REQUIRED',
        message: 'Please upload all required documents (CV, PAN, Aadhaar, Cancelled Cheque, Passport Photo)',
        missing,
      })
    }

    // Upsert submission
    const { error: subErr } = await fastify.supabase
      .from('pre_joinee_submissions')
      .upsert(
        {
          tenant_id:                   tenantId,
          invitation_id:               invitation.id,
          confirmed_first_name:        sub.confirmed_first_name,
          confirmed_last_name:         sub.confirmed_last_name,
          confirmed_email:             sub.confirmed_email,
          confirmed_phone:             sub.confirmed_phone,
          confirmed_designation:       sub.confirmed_designation,
          confirmed_department:        sub.confirmed_department,
          confirmed_joining_date:      sub.confirmed_joining_date,
          edited_fields:               sub.edited_fields,
          previous_employment:         sub.previous_employment,
          education:                   sub.education,
          dob:                         sub.dob,
          gender:                      sub.gender,
          blood_group:                 sub.blood_group,
          marital_status:              sub.marital_status,
          nationality:                 sub.nationality,
          address_line1:               sub.address_line1,
          address_line2:               sub.address_line2,
          city:                        sub.city,
          state:                       sub.state,
          pincode:                     sub.pincode,
          emergency_contact_name:      sub.emergency_contact_name,
          emergency_contact_phone:     sub.emergency_contact_phone,
          emergency_contact_relation:  sub.emergency_contact_relation,
          bank_name:                   sub.bank_name,
          bank_account_number:         sub.bank_account_number,
          bank_ifsc:                   sub.bank_ifsc,
          bank_account_type:           sub.bank_account_type,
          pan_number:                  sub.pan_number,
          aadhaar_number:              sub.aadhaar_number,
          uan_number:                  sub.uan_number,
          declaration_accepted:        sub.declaration_accepted,
          documents_uploaded:          true,
          submitted_at:                new Date().toISOString(),
        },
        { onConflict: 'invitation_id' }
      )

    if (subErr) {
      fastify.log.error({ event: 'pre_joinee.submit.upsert', tenant_id: tenantId, invitation_id: invitation.id, err: subErr })
      return reply.code(500).send({ error: 'DB_ERROR', message: subErr.message })
    }

    // Update invitation status to 'submitted'
    const { error: updateErr } = await fastify.supabase
      .from('pre_joinee_invitations')
      .update({ status: 'submitted', requested_changes: [], updated_at: new Date().toISOString() })
      .eq('id', invitation.id)
      .eq('tenant_id', tenantId)

    if (updateErr) {
      fastify.log.warn({ event: 'pre_joinee.submit.status_update', tenant_id: tenantId, invitation_id: invitation.id, err: updateErr })
    }

    // ── Best-effort merge into the AI-onboarding review queue ──────────────────
    // Creates an onboarding_session, copies the candidate's uploaded documents
    // into onboarding_documents, and prefills a draft_employee_profile so HR can
    // extract/validate/approve from the existing review UI. A failure here must
    // NEVER fail the candidate's submission (helper returns null, never throws).
    const mergedSessionId = await mergeInvitationToSession(fastify, invitation.id, tenantId, sub)

    return reply.send({
      message: 'Submission received. HR will review your details.',
      invitation_id: invitation.id,
      session_id: mergedSessionId,
    })
  })

  // ── PATCH /onboarding/pre-joinee/:id/buddy ─────────────────────────────────
  fastify.patch('/onboarding/pre-joinee/:id/buddy', auth, async (req: any, reply) => {
    const { id }              = req.params as { id: string }
    const { buddy_employee_id } = req.body as { buddy_employee_id: string | null }
    const { tenantId }        = req

    // Fetch invitation + validate ownership
    const { data: inv, error: invErr } = await req.supabase
      .from('pre_joinee_invitations')
      .select('id, first_name, last_name, designation, joining_date, employee_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (invErr || !inv) return reply.code(404).send({ error: 'NOT_FOUND' })

    // Update buddy
    const { error: updErr } = await req.supabase
      .from('pre_joinee_invitations')
      .update({ buddy_employee_id: buddy_employee_id ?? null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updErr) return reply.code(500).send({ error: updErr.message })

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'pre_joinee_invitations',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  inv.employee_id ?? null,
      newData:     { buddy_employee_id: buddy_employee_id ?? null },
    })

    // Send buddy notification email (best-effort, never fail the request)
    if (buddy_employee_id) {
      try {
        const [{ data: buddy }, { data: tenant }] = await Promise.all([
          req.supabase
            .from('employees')
            .select('first_name, last_name, email, job_history!job_history_employee_id_fkey(designation_name, is_current)')
            .eq('id', buddy_employee_id)
            .eq('tenant_id', tenantId)
            .maybeSingle(),
          req.supabase
            .from('tenants')
            .select('name')
            .eq('id', tenantId)
            .maybeSingle(),
        ])
        if (buddy) {
          const _jh = ((buddy as any).job_history ?? []).find((j: any) => j.is_current) ?? ((buddy as any).job_history ?? [])[0] ?? null
          ;(buddy as any).job_title = _jh?.designation_name ?? null
        }

        if (buddy?.email) {
          const { subject, html } = buddyAssignmentEmail({
            buddyName:      `${buddy.first_name ?? ''} ${buddy.last_name ?? ''}`.trim(),
            newJoinerName:  `${inv.first_name} ${inv.last_name}`.trim(),
            newJoinerRole:  inv.designation ?? undefined,
            companyName:    (tenant as any)?.name ?? 'your company',
            joiningDate:    inv.joining_date ?? undefined,
            hrSystemUrl:    APP_PUBLIC_URL,
          })
          await sendEmail({ to: buddy.email, subject, html })
        }
      } catch (_) { /* email is best-effort */ }
    }

    return reply.send({ ok: true })
  })
}
