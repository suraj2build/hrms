import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import {
  sendEmail, preJoineeInviteEmail, APP_PUBLIC_URL,
  type SendEmailResult,
} from '../../lib/email-service.js'

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

// Accepts BOTH the candidate-portal "friendly" field names and the DB-style
// names. All optional so either source validates; mapping to DB columns happens
// in the submit handler via resolveSubmission().
const submissionSchema = z.object({
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

// Maps a validated submission body (either field-name convention) to DB columns.
function resolveSubmission(body: SubmissionBody) {
  return {
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

type CreateInvitationBody = z.infer<typeof createInvitationSchema>
type RejectBody           = z.infer<typeof rejectSchema>
type SubmissionBody       = z.infer<typeof submissionSchema>

// ── Helper: token expiry (7 days) ─────────────────────────────────────────────
function tokenExpiresAt(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString()
}

// Maps a DB submission row → the field names the frontend expects.
function mapSubmissionRow(row: any) {
  if (!row) return null
  return {
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

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function preJoineeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

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

    const mapped = invitations.map((inv: any) => {
      const subRow = subsByInvitation[inv.id] ?? null
      return {
        ...inv,
        invite_token: inv.token,
        invite_url:   `/pre-join/${inv.token}`,
        submitted_at: subRow?.submitted_at ?? null,
        submission:   mapSubmissionRow(subRow),
      }
    })

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

    const { data, error } = await fastify.supabase
      .from('pre_joinee_invitations')
      .insert({
        tenant_id:    tenantId,
        first_name:   body.first_name,
        last_name:    body.last_name,
        email:        body.email,
        phone:        body.phone ?? null,
        designation:  body.designation ?? null,
        department:   body.department ?? null,
        joining_date: body.joining_date,
        token,
        status:       'pending',
        expires_at:   expiresAt,
        created_by:   req.userId ?? null,
      })
      .select()
      .single()

    if (error) {
      fastify.log.error({ event: 'pre_joinee.create', tenant_id: tenantId, err: error })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

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

    return reply.code(204).send()
  })

  // ── 4. POST /onboarding/pre-joinee/:id/approve — approve + create employee ─

  fastify.post('/onboarding/pre-joinee/:id/approve', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id } = req.params as { id: string }

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

    // ── Insert employee ──────────────────────────────────────────────────────
    const { data: employee, error: empErr } = await fastify.supabase
      .from('employees')
      .insert({
        tenant_id:    tenantId,
        first_name:   invitation.first_name,
        last_name:    invitation.last_name,
        email:        invitation.email,
        phone:        invitation.phone ?? null,
        joining_date: invitation.joining_date,
        status:       'active',
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
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
        updated_at:       new Date().toISOString(),
      })

    if (jobErr) {
      fastify.log.warn({ event: 'pre_joinee.approve.job_insert', tenant_id: tenantId, employee_id: employeeId, err: jobErr })
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
          bank_account_number: submission.bank_account_number ?? null,
          bank_ifsc:           submission.bank_ifsc ?? null,
          bank_account_type:   submission.bank_account_type ?? null,
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

    return reply.send({
      message:     'Invitation approved and employee created',
      employee_id: employeeId,
      employee,
    })
  })

  // ── 5. POST /onboarding/pre-joinee/:id/reject — reject with reason ─────────

  fastify.post('/onboarding/pre-joinee/:id/reject', auth, async (req: any, reply) => {
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

    return reply.send({ message: 'Invitation rejected', id, notes })
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
        submission:   mapSubmissionRow(submission),
      },
      invitation,
      submission: mapSubmissionRow(submission),
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
      .select('id, tenant_id, first_name, last_name, email, designation, department, joining_date, status, expires_at')
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

    return reply.send({
      id:             invitation.id,
      first_name:     invitation.first_name,
      last_name:      invitation.last_name,
      candidate_name: candidateName,
      company_name:   companyName,
      email:          invitation.email,
      designation:    invitation.designation ?? null,
      department:     invitation.department ?? null,
      joining_date:   invitation.joining_date,
      status:         invitation.status,
      expires_at:     invitation.expires_at ?? null,
    })
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

    if (invitation.status !== 'pending') {
      return reply.code(409).send({
        error: 'ALREADY_SUBMITTED',
        message: `Invitation has already been ${invitation.status}`,
      })
    }

    const tenantId: string = invitation.tenant_id

    // Upsert submission
    const { error: subErr } = await fastify.supabase
      .from('pre_joinee_submissions')
      .upsert(
        {
          tenant_id:                   tenantId,
          invitation_id:               invitation.id,
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
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', invitation.id)
      .eq('tenant_id', tenantId)

    if (updateErr) {
      fastify.log.warn({ event: 'pre_joinee.submit.status_update', tenant_id: tenantId, invitation_id: invitation.id, err: updateErr })
    }

    return reply.send({
      message: 'Submission received. HR will review your details.',
      invitation_id: invitation.id,
    })
  })
}
