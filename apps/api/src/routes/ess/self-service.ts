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
}
