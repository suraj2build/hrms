/**
 * ESS Self-Service — /ess/me/*
 *
 * Employee Data Ownership (Program 4 · P4.1).
 *
 * The ESS projection of the employee's own personal data. Resolves employee_id
 * SERVER-SIDE from the authenticated profile (never trusts a client-supplied
 * id) so an employee can only ever read/write their OWN records. Reuses the
 * existing tables and the exact zod shapes used by the HR-admin employee master:
 *   - emergency_contacts        (read + write)
 *   - employee_addresses        (read + upsert by type)
 *   - employee_family           (read + write)
 *   - employee_nominations      (read + write, share ≤ 100% per scheme)
 *   - employee_bank_statutory   (READ-ONLY visibility — bank/PAN/UAN/PF/ESI)
 *
 * No new tables, no new workflow engine, no new scheduler. This is purely the
 * self-scoped surface over data that already exists.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { optStr, optDate, optEnum, optUuid } from '../../lib/zod-form.js'
import { computeLifecycleRisks, summariseLifecycle } from '../../lib/lifecycle-expiry.js'
import { notifyHrAdmins } from '../../lib/notify.js'

const STORAGE_BUCKET = 'employee-files'
const SIGNED_URL_TTL = 3600
const MAX_FILE_SIZE  = 5 * 1024 * 1024  // 5 MB

// Self-upload document types an employee may file themselves. Constrained to the
// values permitted by the documents.doc_type CHECK; HR-issued types (offer_letter,
// contract, relieving/experience letters) are intentionally excluded.
const ESS_DOC_TYPES = ['certificate', 'aadhaar', 'pan', 'other'] as const

const documentSchema = z.object({
  name:         z.string().min(1).max(200),
  doc_type:     z.enum(ESS_DOC_TYPES),
  storage_path: z.string().min(1).max(500),
  file_size:    z.number().int().positive().max(MAX_FILE_SIZE, 'File exceeds 5 MB limit').optional().nullable(),
  mime_type:    z.string().max(100).optional().nullable(),
  expires_at:   optDate,
})

// ── Schemas (mirror the HR-admin employee-master routes) ───────────────────────

const emergencyContactSchema = z.object({
  name:            z.string().min(1, 'Name is required'),
  relationship:    optStr,
  phone:           z.string().min(1, 'Phone is required'),
  alternate_phone: optStr,
  email:           z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().email().optional()),
  address:         optStr,
  is_primary:      z.boolean().optional().default(false),
})

const addressSchema = z.object({
  address_type:         z.enum(['current', 'permanent', 'correspondence']),
  line1:                z.string().min(1, 'Address line 1 is required'),
  line2:                z.string().optional(),
  city:                 z.string().min(1, 'City is required'),
  state:                z.string().min(1, 'State is required'),
  country:              z.string().optional().default('India'),
  pincode:              z.string().optional(),
  is_same_as_permanent: z.boolean().optional().default(false),
})

const familySchema = z.object({
  relationship_type_id: z.string().uuid('Invalid relationship type'),
  name:                 z.string().min(1, 'Name is required'),
  dob:                  optDate,
  gender:               optEnum(['male', 'female', 'other']),
  is_dependent:         z.boolean().optional().default(false),
  is_nominee:           z.boolean().optional().default(false),
  occupation:           optStr,
})

const nominationSchema = z.object({
  scheme:               z.enum(['pf', 'gratuity', 'esi', 'superannuation']),
  nominee_name:         z.string().min(1, 'Nominee name is required'),
  relationship_type_id: optUuid,
  dob:                  optDate,
  share_percentage:     z.number().positive().max(100, 'Cannot exceed 100%'),
  address:              optStr,
  is_minor:             z.boolean().optional().default(false),
  guardian_name:        optStr,
})

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Shows only the last 4 characters of a sensitive value, masking the rest. */
function maskTail(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null
  const s = String(value)
  if (s.length <= visible) return s
  return `••••${s.slice(-visible)}`
}

export default async function essSelfServiceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  /** Resolves the caller's OWN employee_id from their profile (server-trusted). */
  async function resolveEmployeeId(req: any): Promise<string | null> {
    const { data } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', req.tenantId).single()
    return data?.employee_id ?? null
  }

  /** Guard: resolves self employee_id or replies 400; returns null when blocked. */
  async function selfOr400(req: any, reply: any): Promise<string | null> {
    const empId = await resolveEmployeeId(req)
    if (!empId) {
      reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Your profile is not linked to an employee record' })
      return null
    }
    return empId
  }

  async function validateShareTotal(empId: string, tenantId: string, scheme: string, newShare: number, excludeId?: string) {
    let q = fastify.supabase
      .from('employee_nominations').select('share_percentage')
      .eq('employee_id', empId).eq('tenant_id', tenantId).eq('scheme', scheme)
    if (excludeId) q = q.neq('id', excludeId)
    const { data } = await q
    const existing = (data ?? []).reduce((s: number, r: any) => s + Number(r.share_percentage), 0)
    return existing + newShare <= 100
  }

  // ── Bank & Statutory — READ-ONLY visibility ──────────────────────────────────
  // Highly sensitive PII. Employees may VIEW (to verify salary-credit details)
  // but not edit — changes stay an HR-verified action. Account number and
  // Aadhaar are masked to the last 4; PAN/UAN/PF/ESI shown in full (own data).
  fastify.get('/ess/me/bank-statutory', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('employee_bank_statutory')
      .select('bank_name, account_number, ifsc_code, branch_name, account_type, pan_number, aadhaar_number, uan_number, pf_number, esi_number, pt_applicable, lwf_applicable, tax_regime')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (error && error.code !== 'PGRST116')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.send({ data: null })
    return reply.send({ data: {
      bank_name:      data.bank_name ?? null,
      account_number: maskTail(data.account_number),
      ifsc_code:      data.ifsc_code ?? null,
      branch_name:    data.branch_name ?? null,
      account_type:   data.account_type ?? null,
      pan_number:     data.pan_number ?? null,
      aadhaar_number: maskTail(data.aadhaar_number),
      uan_number:     data.uan_number ?? null,
      pf_number:      data.pf_number ?? null,
      esi_number:     data.esi_number ?? null,
      pt_applicable:  data.pt_applicable ?? null,
      lwf_applicable: data.lwf_applicable ?? null,
      tax_regime:     data.tax_regime ?? null,
    } })
  })

  // ── Emergency Contacts — full self-service CRUD ──────────────────────────────
  fastify.get('/ess/me/emergency-contacts', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('emergency_contacts').select('*')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .order('is_primary', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/ess/me/emergency-contacts', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = emergencyContactSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.is_primary) {
      await fastify.supabase.from('emergency_contacts')
        .update({ is_primary: false }).eq('employee_id', empId).eq('tenant_id', req.tenantId)
    }
    const { data, error } = await fastify.supabase
      .from('emergency_contacts')
      .insert({ ...parsed.data, employee_id: empId, tenant_id: req.tenantId })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/ess/me/emergency-contacts/:contactId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = emergencyContactSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.is_primary) {
      await fastify.supabase.from('emergency_contacts')
        .update({ is_primary: false }).eq('employee_id', empId).eq('tenant_id', req.tenantId)
        .neq('id', req.params.contactId)
    }
    const { data, error } = await fastify.supabase
      .from('emergency_contacts').update(parsed.data)
      .eq('id', req.params.contactId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Contact not found' })
    return reply.send(data)
  })

  fastify.delete('/ess/me/emergency-contacts/:contactId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { error } = await fastify.supabase
      .from('emergency_contacts').delete()
      .eq('id', req.params.contactId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Addresses — read + upsert by type + delete ───────────────────────────────
  fastify.get('/ess/me/addresses', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('employee_addresses').select('*')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId).order('address_type')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/ess/me/addresses', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = addressSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_addresses')
      .upsert({ ...parsed.data, employee_id: empId, tenant_id: req.tenantId }, { onConflict: 'tenant_id,employee_id,address_type' })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })

  fastify.delete('/ess/me/addresses/:addressId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { error } = await fastify.supabase
      .from('employee_addresses').delete()
      .eq('id', req.params.addressId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Family — full self-service CRUD ──────────────────────────────────────────
  fastify.get('/ess/me/family', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('employee_family').select('*, relationship_types(id, name, code)')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId).order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/ess/me/family', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = familySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_family')
      .insert({ ...parsed.data, employee_id: empId, tenant_id: req.tenantId })
      .select('*, relationship_types(id, name)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/ess/me/family/:memberId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = familySchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_family').update(parsed.data)
      .eq('id', req.params.memberId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .select('*, relationship_types(id, name)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Family member not found' })
    return reply.send(data)
  })

  fastify.delete('/ess/me/family/:memberId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { error } = await fastify.supabase
      .from('employee_family').delete()
      .eq('id', req.params.memberId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Nominations — full self-service CRUD (share ≤ 100% per scheme) ────────────
  fastify.get('/ess/me/nominations', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('employee_nominations').select('*, relationship_types(id, name)')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId).order('scheme')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/ess/me/nominations', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = nominationSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.is_minor && !parsed.data.guardian_name)
      return reply.code(400).send({ error: 'VALIDATION', message: 'Guardian name required for minor nominees' })
    if (!await validateShareTotal(empId, req.tenantId, parsed.data.scheme, parsed.data.share_percentage))
      return reply.code(400).send({ error: 'VALIDATION', message: `Total share for ${parsed.data.scheme} would exceed 100%` })
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .insert({ ...parsed.data, employee_id: empId, tenant_id: req.tenantId })
      .select('*, relationship_types(id, name)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/ess/me/nominations/:nomId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = nominationSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.share_percentage) {
      const { data: existing } = await fastify.supabase
        .from('employee_nominations').select('scheme').eq('id', req.params.nomId)
        .eq('employee_id', empId).eq('tenant_id', req.tenantId).single()
      const scheme = parsed.data.scheme ?? existing?.scheme
      if (scheme && !await validateShareTotal(empId, req.tenantId, scheme, parsed.data.share_percentage, req.params.nomId))
        return reply.code(400).send({ error: 'VALIDATION', message: `Total share for ${scheme} would exceed 100%` })
    }
    const { data, error } = await fastify.supabase
      .from('employee_nominations').update(parsed.data)
      .eq('id', req.params.nomId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .select('*, relationship_types(id, name)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nomination not found' })
    return reply.send(data)
  })

  fastify.delete('/ess/me/nominations/:nomId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { error } = await fastify.supabase
      .from('employee_nominations').delete()
      .eq('id', req.params.nomId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Documents — self upload + delete-own (binary already in storage) ──────────
  // GET lists ALL of the employee's documents (HR-uploaded + self-uploaded) with
  // signed URLs. POST records metadata for a file the client uploaded to storage.
  // DELETE is restricted to documents the employee uploaded themselves — HR-issued
  // documents (offer letters, contracts) cannot be removed by the employee.
  async function signedUrl(path: string | null): Promise<string | null> {
    if (!path) return null
    const { data } = await fastify.supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
    return data?.signedUrl ?? null
  }

  fastify.get('/ess/me/documents', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('documents')
      .select('id, name, doc_type, storage_path, file_size, mime_type, expires_at, uploaded_by, created_at')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    const docs = await Promise.all((data ?? []).map(async (d: any) => ({
      ...d,
      is_own: d.uploaded_by === req.userId,
      signed_url: await signedUrl(d.storage_path),
      signed_url_expires_in: SIGNED_URL_TTL,
    })))
    return reply.send({ data: docs })
  })

  fastify.post('/ess/me/documents', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = documentSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('documents')
      .insert({ ...parsed.data, employee_id: empId, tenant_id: req.tenantId, uploaded_by: req.userId })
      .select('id, name, doc_type, storage_path, file_size, mime_type, expires_at, created_at')
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send({ data: { ...data, is_own: true, signed_url: await signedUrl(data.storage_path), signed_url_expires_in: SIGNED_URL_TTL } })
  })

  fastify.delete('/ess/me/documents/:docId', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    // Only the uploader may delete — guards HR-issued documents from removal.
    const { data: doc } = await fastify.supabase
      .from('documents').select('id, storage_path, uploaded_by')
      .eq('id', req.params.docId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!doc) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Document not found' })
    if (doc.uploaded_by !== req.userId)
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only delete documents you uploaded. Contact HR to remove this document.' })
    if (doc.storage_path) {
      await fastify.supabase.storage.from(STORAGE_BUCKET).remove([doc.storage_path]).catch(() => {})
    }
    const { error } = await fastify.supabase
      .from('documents').delete()
      .eq('id', req.params.docId).eq('employee_id', empId).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })

  // ── Separation — resignation request + tracking (P4.3) ───────────────────────
  // The employee can submit ONE resignation request and then track its progress
  // (clearances, full & final). The request lands as a pending, employee-initiated
  // row in employee_separation (initiated_by='employee', lifecycle_stage='initiated',
  // approval_status='pending') WITHOUT changing employment status — HR drives it
  // forward through the existing separation workspace. Reuses existing tables and
  // the existing HR workflow; no new state machine.

  const resignationSchema = z.object({
    last_working_date: z.string().min(1, 'Proposed last working date is required'),
    notice_date:       optDate,
    exit_reason:       z.string().min(1, 'Please tell us your reason for leaving'),
    remarks:           optStr,
  })

  fastify.get('/ess/me/separation', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data: sep } = await fastify.supabase
      .from('employee_separation').select('*')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId).maybeSingle()
    if (!sep) return reply.send({ data: null, clearances: [], ff: null })
    const [{ data: clearances }, { data: ff }] = await Promise.all([
      fastify.supabase.from('separation_clearances')
        .select('id, department, status, remarks, cleared_at')
        .eq('separation_id', (sep as any).id).eq('tenant_id', req.tenantId).order('department'),
      fastify.supabase.from('separation_ff_summary')
        .select('id, status, net_payable, approved_at, paid_at, leave_encashment_amount, gratuity_amount, notice_period_deduction')
        .eq('separation_id', (sep as any).id).eq('tenant_id', req.tenantId).maybeSingle(),
    ])
    return reply.send({ data: sep, clearances: clearances ?? [], ff: ff ?? null })
  })

  fastify.post('/ess/me/separation', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const parsed = resignationSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // One separation per employee (UNIQUE tenant_id, employee_id). If a record
    // already exists, the resignation/separation is already under way.
    const { data: existing } = await fastify.supabase
      .from('employee_separation').select('id')
      .eq('employee_id', empId).eq('tenant_id', req.tenantId).maybeSingle()
    if (existing)
      return reply.code(409).send({ error: 'ALREADY_EXISTS', message: 'A separation is already in progress. Please track it below or contact HR.' })

    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .insert({
        employee_id:       empId,
        tenant_id:         req.tenantId,
        separation_type:   'resignation',
        initiated_by:      'employee',
        lifecycle_stage:   'initiated',
        approval_status:   'pending',
        notice_date:       parsed.data.notice_date ?? new Date().toISOString().slice(0, 10),
        last_working_date: parsed.data.last_working_date,
        exit_reason:       parsed.data.exit_reason,
        remarks:           parsed.data.remarks ?? null,
        created_by:        req.userId,
      })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Surface to HR through the existing inbox — no new notification framework.
    const { data: emp } = await fastify.supabase
      .from('employees').select('first_name, last_name, employee_code')
      .eq('id', empId).eq('tenant_id', req.tenantId).maybeSingle()
    const who = emp ? `${emp.first_name} ${emp.last_name} (${emp.employee_code ?? '—'})` : 'An employee'
    await notifyHrAdmins(fastify.supabase, {
      tenantId:     req.tenantId,
      senderId:     req.userId,
      item_type:    'approval_request',
      title:        'Resignation submitted',
      summary:      `${who} submitted a resignation. Proposed last working day ${parsed.data.last_working_date}.`,
      severity:     'warning',
      entity_type:  'employee_separation',
      entity_id:    (data as any).id,
      action_route: `/admin/workforce/separations`,
      action_label: 'Review separation',
    }).catch(() => {})

    return reply.code(201).send({ data })
  })

  // ── Asset obligations — own assigned assets (P4.3) ───────────────────────────
  fastify.get('/ess/me/assets', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const { data, error } = await fastify.supabase
      .from('assets')
      .select('id, asset_code, name, category_id, serial_number, status, assigned_to, notes')
      .eq('assigned_to', empId).eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    const assets = data ?? []
    const outstanding = assets.filter((a: any) => a.status === 'assigned').length
    return reply.send({ data: assets, outstanding_count: outstanding })
  })

  // ── Expiry Awareness — own lifecycle risks (P4.2) ────────────────────────────
  // Projects the Program 3A lifecycle engine to the caller only. One brain, many
  // projections — no duplicate expiry logic. 365-day horizon so the employee sees
  // documents/passport/visa/identity/contract expiries well ahead of time, plus
  // anything already overdue.
  fastify.get('/ess/me/expiry', auth, async (req: any, reply) => {
    const empId = await selfOr400(req, reply); if (!empId) return
    const all = await computeLifecycleRisks(fastify.supabase, req.tenantId, { withinDays: 365 }).catch(() => [])
    // Probation is a confirmation matter for HR, not an employee "expiry" — drop it
    // from the employee-facing view to avoid alarming language about themselves.
    const items = all.filter(r => r.employee_id === empId && r.category !== 'probation')
    return reply.send({ data: items, summary: summariseLifecycle(items) })
  })
}
