import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { EventType, MODULE } from '../../platform/events/index.js'

// NOTE: After migration 016 (lean employees), the following columns were removed
// from the employees table and relocated to dedicated sub-tables:
//   pan_number, aadhaar_last4, uan_number → employee_bank_statutory
//   gender, dob → employee_personal_info
//   department_id, designation_id, grade_id, employment_type → job_history
//
// POST /employees only writes the lean core identity fields.
// All other data should be written via the dedicated sub-module routes
// (e.g. POST /employees/:id/bank-statutory, PUT /employees/:id/personal-info).
const createEmployeeSchema = z.object({
  first_name:      z.string().min(1),
  last_name:       z.string().min(1),
  email:           z.string().email(),
  phone:           z.string().optional(),
  joining_date:    z.string(),
})

export default async function employeeRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /employees/search — fast text search for UniversalSearch ─────────────
  // Must be registered BEFORE /employees/:id so "search" is not matched as an id.
  // Searches first_name, last_name, employee_code, email via ilike OR filter.
  // Returns a lightweight projection (no enrichment joins) capped at 20 results
  // for sub-100ms response times.
  fastify.get('/employees/search', hrAdminAuth, async (request, reply) => {
    const searchSchema = z.object({
      q:     z.string().max(100).default(''),
      limit: z.coerce.number().int().min(1).max(20).default(10),
    })

    const parsed = searchSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { q, limit } = parsed.data
    const trimmed = q.trim()

    let query = fastify.supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name, email, status')
      .eq('tenant_id', request.tenantId)
      .eq('status', 'active')
      .order('first_name', { ascending: true })
      .limit(limit)

    if (trimmed) {
      const term = `%${trimmed}%`
      query = query.or(`first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term},email.ilike.${term}`)
    }

    const { data, error } = await query

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    // Enrich with current department from job_history for the sublabel
    const rows = (data ?? []) as Array<{
      id: string; employee_code: string; first_name: string; last_name: string; email: string; status: string
    }>

    if (rows.length === 0) return reply.send({ data: [] })

    const empIds = rows.map((e) => e.id)
    const { data: jobRows } = await fastify.supabase
      .from('job_history')
      .select('employee_id, departments(name)')
      .in('employee_id', empIds)
      .eq('tenant_id', request.tenantId)
      .eq('is_current', true)

    const deptMap = new Map<string, string>()
    for (const j of (jobRows ?? []) as unknown as Array<{ employee_id: string; departments: { name: string } | null }>) {
      if (j.departments?.name) deptMap.set(j.employee_id, j.departments.name)
    }

    const enriched = rows.map((e) => ({
      id:            e.id,
      employee_code: e.employee_code,
      full_name:     `${e.first_name} ${e.last_name}`,
      email:         e.email,
      department:    deptMap.get(e.id) ?? null,
    }))

    return reply.send({ data: enriched })
  })

  // GET /employees — HR admin / super_admin only
  // Employees and managers access their own or team data via scoped ESS/manager endpoints.
  fastify.get('/employees', hrAdminAuth, async (request, reply) => {
    const { status, page = '1', limit = '100' } = request.query as Record<string, string>
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = fastify.supabase
      .from('employees')
      .select(
        'id, employee_code, first_name, last_name, email, phone, status, joining_date',
        { count: 'exact' },
      )
      .eq('tenant_id', request.tenantId)
      .order('first_name', { ascending: true })
      .range(offset, offset + parseInt(limit) - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = data ?? []
    if (rows.length === 0) return reply.send({ data: [], total: 0 })

    const empIds = rows.map((e: any) => e.id)

    // Parallel enrichment: profiles, job_history (current), personal_info
    const [profilesRes, jobRes, personalRes] = await Promise.all([
      fastify.supabase
        .from('profiles')
        .select('employee_id, role, is_active, email')
        .in('employee_id', empIds)
        .eq('tenant_id', request.tenantId),

      fastify.supabase
        .from('job_history')
        .select(`
          employee_id, employment_type,
          departments(id, name),
          designations(id, name),
          work_locations(id, name, city)
        `)
        .in('employee_id', empIds)
        .eq('tenant_id', request.tenantId)
        .eq('is_current', true),

      fastify.supabase
        .from('employee_personal_info')
        .select('employee_id, profile_photo')
        .in('employee_id', empIds)
        .eq('tenant_id', request.tenantId),
    ])

    // Build lookup maps
    const profileMap = new Map<string, { role: string; is_active: boolean }>()
    for (const p of (profilesRes.data ?? [])) {
      if (p.employee_id) profileMap.set(p.employee_id, { role: p.role, is_active: p.is_active })
    }

    const jobMap = new Map<string, any>()
    for (const j of (jobRes.data ?? [])) {
      jobMap.set(j.employee_id, j)
    }

    const personalMap = new Map<string, { profile_photo: string | null }>()
    for (const pi of (personalRes.data ?? [])) {
      personalMap.set(pi.employee_id, { profile_photo: pi.profile_photo ?? null })
    }

    const enriched = rows.map((emp: any) => {
      const profile  = profileMap.get(emp.id)
      const job      = jobMap.get(emp.id)
      const personal = personalMap.get(emp.id)

      // Determine account status
      let acctStatus: string = 'no_account'
      if (profile) {
        acctStatus = profile.is_active ? 'active' : 'suspended'
      }

      return {
        ...emp,
        department:    job?.departments    ?? null,
        designation:   job?.designations   ?? null,
        work_location: job?.work_locations ?? null,
        current_job:   job ? { employment_type: job.employment_type } : null,
        personal_info: personal ?? null,
        user_account: {
          status: acctStatus,
          role:   profile?.role ?? null,
        },
      }
    })

    return reply.send({ data: enriched, total: count ?? 0 })
  })

  // GET /employees/:id
  fastify.get('/employees/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Lean select — FK columns department_id, designation_id, grade_id, manager_id
    // were moved to job_history by migration 016. Use /employees/:id/full-profile
    // for the complete enriched view.
    const { data, error } = await fastify.supabase
      .from('employees')
      .select('id, tenant_id, employee_code, first_name, last_name, email, phone, joining_date, status, created_by, created_at, updated_at')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (error) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    return reply.send(data)
  })

  // POST /employees — HR admin / super_admin only
  fastify.post('/employees', hrAdminAuth, async (request, reply) => {
    const parsed = createEmployeeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    // Generate employee code
    const { count } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', request.tenantId)

    const code = `EMP-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data, error } = await fastify.supabase
      .from('employees')
      .insert({ ...parsed.data, tenant_id: request.tenantId, employee_code: code })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.EMPLOYEE_CREATED,
      module:      MODULE.EMPLOYEE,
      entity_type: 'employee',
      entity_id:   (data as any).id,
      org_id:      request.tenantId,
      actor_id:    (request as any).userId,
      actor_type:  'user',
      payload:     { employee_code: (data as any).employee_code, employment_type: (parsed.data as any).employment_type ?? null },
      correlation_id: (request as any).correlationId ?? undefined,
    })
    return reply.code(201).send(data)
  })

  // ── PATCH /employees/me ──────────────────────────────────────────────────────
  // ESS self-service: employee can update their own phone number only.
  // Must be registered BEFORE /employees/:id so "me" is not matched as an id.
  fastify.patch('/employees/me', auth, async (req: any, reply) => {
    // Resolve the employee_id from the authenticated user's profile
    const { data: callerProfile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!callerProfile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    const schema = z.object({
      phone: z.string().min(5).max(20).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'NO_CHANGES', message: 'No updatable fields provided' })
    }

    const { data, error } = await fastify.supabase
      .from('employees')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', callerProfile.employee_id)
      .eq('tenant_id', req.tenantId)
      .select('id, first_name, last_name, phone, email')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // PUT /employees/:id — HR admin / super_admin only
  fastify.put('/employees/:id', hrAdminAuth, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Validate: employee exists and belongs to this tenant before touching it
    const { data: existing, error: findError } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (findError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Strip fields the caller must never overwrite
    const {
      id: _id,
      tenant_id: _tenant,
      employee_code: _code,
      created_at: _created,
      created_by: _createdBy,
      ...safeUpdates
    } = request.body as Record<string, unknown>

    const { data, error } = await fastify.supabase
      .from('employees')
      .update({ ...safeUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    request.tenantId,
      tableName:   'employees',
      recordId:    id,
      action:      'UPDATE',
      performedBy: request.userId,
      onBehalfOf:  id,   // admin updating the employee's own record
      newData:     safeUpdates as Record<string, unknown>,
    })

    return reply.send(data)
  })

  // DELETE /employees/:id — soft delete only (status = separated, row is never removed)
  // HR admin / super_admin only — prevents any employee from separating a colleague.
  fastify.delete('/employees/:id', hrAdminAuth, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Confirm the employee exists and belongs to this tenant before modifying
    const { data: existing, error: findError } = await fastify.supabase
      .from('employees')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (findError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    if (existing.status === 'separated') {
      return reply.code(409).send({ error: 'CONFLICT', message: 'Employee is already separated' })
    }

    const { error } = await fastify.supabase
      .from('employees')
      .update({ status: 'separated', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', request.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ message: 'Employee separated successfully' })
  })
}
