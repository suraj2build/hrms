/**
 * HRA (House Rent Allowance) Declaration Routes
 * ESS + admin routes for HRA declarations with PAN and governance validation.
 *
 * Route groups (all under prefix '/payroll/statutory/tds'):
 *   ESS  (/my)     — employee reads/writes for their own declarations
 *   Admin (/verify) — HR admin verification workflow
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { checkDeclarationWindow } from './tds.js'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const hraBodySchema = z.object({
  financial_year:    z.string().regex(/^\d{4}-\d{2}$/, 'financial_year must be YYYY-YY'),
  from_month:        z.string().regex(/^\d{4}-\d{2}$/, 'from_month must be YYYY-MM'),
  to_month:          z.string().regex(/^\d{4}-\d{2}$/, 'to_month must be YYYY-MM'),
  monthly_rent:      z.number().positive('monthly_rent must be positive'),
  landlord_name:     z.string().optional(),
  landlord_pan:      z.string().optional(),
  landlord_address:  z.string().optional(),
  city:              z.string().optional(),
  is_metro:          z.boolean().default(false),
})

const verifyBodySchema = z.object({
  status:             z.enum(['verified', 'rejected']),
  verification_notes: z.string().optional(),
})

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

/**
 * Fetch HRA governance settings for the given tenant + financial year.
 * Returns null if no settings row exists (permissive defaults apply).
 */
async function fetchHraGovernanceSettings(
  fastify: FastifyInstance,
  tenantId: string,
  financialYear: string,
): Promise<{ pan_required_threshold: number; max_houses_allowed: number } | null> {
  const { data } = await fastify.supabase
    .from('hra_governance_settings')
    .select('pan_required_threshold, max_houses_allowed')
    .eq('tenant_id', tenantId)
    .eq('financial_year', financialYear)
    .maybeSingle()
  return (data as any) ?? null
}

/**
 * Validate PAN requirement and duplicate declaration constraints.
 * Returns an error response object if validation fails, or null if all good.
 */
async function validateHraDeclaration(
  fastify: FastifyInstance,
  req: any,
  employeeId: string,
  body: z.infer<typeof hraBodySchema>,
  excludeId?: string,
): Promise<{ code: number; error: string; message: string } | null> {
  // 1. Temporal check: to_month must be >= from_month
  if (body.to_month < body.from_month) {
    return { code: 400, error: 'INVALID_DATE_RANGE', message: 'to_month must be on or after from_month' }
  }

  // 2. Governance settings checks
  const settings = await fetchHraGovernanceSettings(fastify, req.tenantId, body.financial_year)

  if (settings) {
    // PAN threshold check: annual rent > threshold and no PAN provided
    const panThreshold = settings.pan_required_threshold ?? 0
    if (panThreshold > 0 && body.monthly_rent * 12 > panThreshold && !body.landlord_pan) {
      return {
        code: 400,
        error: 'PAN_REQUIRED',
        message: `Landlord PAN is mandatory when annual rent exceeds ₹${panThreshold}`,
      }
    }

    // Duplicate declaration check (only when max_houses_allowed = 1)
    if (settings.max_houses_allowed === 1) {
      let q = fastify.supabase
        .from('hra_declarations')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('financial_year', body.financial_year)
        .neq('status', 'superseded')

      // When editing, exclude the current record from duplicate check
      if (excludeId) {
        q = q.neq('id', excludeId)
      }

      const { data: existing } = await q.maybeSingle()
      if (existing) {
        return {
          code: 409,
          error: 'DUPLICATE_DECLARATION',
          message: 'An active HRA declaration already exists for this financial year. Only one house is allowed per the current governance settings.',
        }
      }
    }
  }

  return null
}

// =============================================================================
export default async function hraDeclarationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /hra/my ─────────────────────────────────────────────────────────────
  fastify.get('/hra/my', auth, async (req: any, reply) => {
    const querySchema = z.object({
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    let q = fastify.supabase
      .from('hra_declarations')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })

    if (parsed.data.financial_year) {
      q = q.eq('financial_year', parsed.data.financial_year)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /hra/my ─────────────────────────────────────────────────────────────
  fastify.post('/hra/my', auth, async (req: any, reply) => {
    const parsed = hraBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const windowErr = await checkDeclarationWindow(fastify, req.tenantId)
    if (windowErr) return reply.code(windowErr.code).send(windowErr.body)

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    const validationError = await validateHraDeclaration(fastify, req, employeeId, parsed.data)
    if (validationError) {
      return reply.code(validationError.code).send({ error: validationError.error, message: validationError.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('hra_declarations')
      .insert({
        ...parsed.data,
        tenant_id:  req.tenantId,
        employee_id: employeeId,
        status:     'draft',
        created_at:  now,
        updated_at:  now,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /hra/my/:id ──────────────────────────────────────────────────────────
  fastify.put('/hra/my/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const parsed = hraBodySchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const windowErr = await checkDeclarationWindow(fastify, req.tenantId)
    if (windowErr) return reply.code(windowErr.code).send(windowErr.body)

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    // Fetch the existing declaration to verify ownership and status
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('hra_declarations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: fetchErr.message })
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'HRA declaration not found' })

    const rec = existing as any
    if (rec.employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only edit your own declarations' })
    }
    if (!['draft', 'submitted'].includes(rec.status)) {
      return reply.code(409).send({ error: 'NOT_EDITABLE', message: 'Only draft or submitted declarations can be edited' })
    }

    // Merge partial update with existing values for validation
    const merged = {
      financial_year:   parsed.data.financial_year   ?? rec.financial_year,
      from_month:       parsed.data.from_month       ?? rec.from_month,
      to_month:         parsed.data.to_month         ?? rec.to_month,
      monthly_rent:     parsed.data.monthly_rent     ?? rec.monthly_rent,
      landlord_pan:     'landlord_pan' in parsed.data ? parsed.data.landlord_pan : rec.landlord_pan,
      landlord_name:    'landlord_name' in parsed.data ? parsed.data.landlord_name : rec.landlord_name,
      landlord_address: 'landlord_address' in parsed.data ? parsed.data.landlord_address : rec.landlord_address,
      city:             'city' in parsed.data ? parsed.data.city : rec.city,
      is_metro:         parsed.data.is_metro         ?? rec.is_metro,
    } as z.infer<typeof hraBodySchema>

    const validationError = await validateHraDeclaration(fastify, req, employeeId, merged, id)
    if (validationError) {
      return reply.code(validationError.code).send({ error: validationError.error, message: validationError.message })
    }

    const { data, error } = await fastify.supabase
      .from('hra_declarations')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── DELETE /hra/my/:id ───────────────────────────────────────────────────────
  fastify.delete('/hra/my/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const isAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Fetch record
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('hra_declarations')
      .select('id, employee_id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: fetchErr.message })
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'HRA declaration not found' })

    const rec = existing as any

    if (!isAdmin) {
      const employeeId = await resolveCallerEmployeeId(fastify, req)
      if (!employeeId) {
        return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
      }
      if (rec.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only delete your own declarations' })
      }
      if (rec.status !== 'draft') {
        return reply.code(409).send({ error: 'NOT_DELETABLE', message: 'Only draft declarations can be deleted' })
      }
    }

    const { error } = await fastify.supabase
      .from('hra_declarations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /hra/admin (admin only) — all-tenant HRA declarations list ──────────
  // Must be registered BEFORE /hra/:id/verify to avoid param collision.
  fastify.get(
    '/hra/admin',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const querySchema = z.object({
        financial_year: z.string().optional(),
        status:         z.string().optional(),
      })
      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      let q = fastify.supabase
        .from('hra_declarations')
        .select('*, employees(id, first_name, last_name)')
        .eq('tenant_id', req.tenantId)
        .order('created_at', { ascending: false })

      if (parsed.data.financial_year) q = q.eq('financial_year', parsed.data.financial_year)
      if (parsed.data.status)         q = q.eq('status', parsed.data.status)

      const { data, error } = await q

      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

      // Map DB shape → frontend HRAAdmin shape
      const result = (data ?? []).map((r: any) => ({
        id:               r.id,
        financial_year:   r.financial_year,
        employee_id:      r.employee_id,
        employee_name:    r.employees
          ? `${r.employees.first_name ?? ''} ${r.employees.last_name ?? ''}`.trim()
          : r.employee_id,
        from_month:       r.from_month,
        to_month:         r.to_month,
        monthly_rent:     Number(r.monthly_rent ?? 0),
        landlord_name:    r.landlord_name   ?? null,
        landlord_pan:     r.landlord_pan    ?? null,
        city:             r.city            ?? null,
        is_metro:         r.is_metro        ?? false,
        status:           r.status          as string,
        // hra_declarations has no rejection_reason column — the reviewer's reason
        // is captured in verification_notes; surface it only for rejected rows.
        rejection_reason: r.status === 'rejected' ? (r.verification_notes ?? null) : null,
        created_at:       r.created_at,
      }))

      return reply.send(result)
    },
  )

  // ── PUT /hra/:id/verify (admin only) ─────────────────────────────────────────
  fastify.put(
    '/hra/:id/verify',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const { id } = req.params as { id: string }

      const parsed = verifyBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      const now = new Date().toISOString()

      // Status precondition: only un-decided declarations may be verified/rejected.
      // hra_declarations.status ∈ ('draft','submitted','verified','rejected','superseded');
      // the verify workflow may only transition from the pending states below — an
      // already-decided (verified/rejected) or superseded record must not be re-flipped.
      const { data, error } = await fastify.supabase
        .from('hra_declarations')
        .update({
          status:             parsed.data.status,
          verification_notes: parsed.data.verification_notes ?? null,
          updated_at:         now,
        })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .in('status', ['draft', 'submitted'])
        .select()
        .maybeSingle()

      if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
      // No row matched the precondition: either not found, or already decided.
      if (!data) return reply.code(409).send({ error: 'INVALID_STATE', message: 'HRA declaration not found or already decided' })

      return reply.send({ data })
    },
  )
}
