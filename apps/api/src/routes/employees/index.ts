import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { EventType, MODULE } from '../../platform/events/index.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, notFound, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { revokeEmployeeAuth } from '../../lib/user-account-service.js'
import { sanitizeOrFilterTerm } from '../../lib/postgrest-filter.js'

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
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
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
      const term = `%${sanitizeOrFilterTerm(trimmed)}%`
      query = query.or(`first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term},email.ilike.${term}`)
    }

    const { data, error } = await query

    if (error) {
      return serverError(request, reply, error, ErrorCode.QUERY_FAILED, 'Failed to search employees')
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

  // ── GET /employees/org-tree — hierarchical reporting tree (EMP-02) ───────────
  // Returns the full org hierarchy built from employees.manager_id, enriched with
  // current designation + department from job_history. Roots = employees with no
  // manager (or whose manager is outside the active set). Registered before
  // /employees/:id so "org-tree" is not matched as an id.
  fastify.get('/employees/org-tree', hrAdminAuth, async (request, reply) => {
    let emps: any[]
    try {
      emps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, employee_code, first_name, last_name, email, status, manager_id')
          .eq('tenant_id', request.tenantId)
          .neq('status', 'separated')
          .order('first_name', { ascending: true })
          .range(from, to),
      )
    } catch (error: any) {
      return serverError(request, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch org tree')
    }

    const rows = emps as any[]
    if (rows.length === 0) return reply.send({ data: { roots: [], total: 0 } })

    const empIds = rows.map((e) => e.id)

    // Enrich with current designation/department + profile photo
    const [jobRes, personalRes] = await Promise.all([
      fastify.supabase
        .from('job_history')
        .select('employee_id, manager_id, designations(name), departments(name)')
        .in('employee_id', empIds)
        .eq('tenant_id', request.tenantId)
        .eq('is_current', true),
      fastify.supabase
        .from('employee_personal_info')
        .select('employee_id, profile_photo')
        .in('employee_id', empIds)
        .eq('tenant_id', request.tenantId),
    ])

    const jobMap = new Map<string, any>()
    for (const j of (jobRes.data ?? [])) jobMap.set(j.employee_id, j)

    const photoMap = new Map<string, string | null>()
    for (const p of (personalRes.data ?? [])) photoMap.set(p.employee_id, p.profile_photo ?? null)

    interface OrgNode {
      id: string; employee_code: string; name: string; email: string; status: string
      designation: string | null; department: string | null; profile_photo: string | null
      manager_id: string | null; children: OrgNode[]
    }

    const nodeMap = new Map<string, OrgNode>()
    for (const e of rows) {
      const job = jobMap.get(e.id)
      // Prefer employees.manager_id; fall back to job_history.manager_id
      const managerId = e.manager_id ?? job?.manager_id ?? null
      nodeMap.set(e.id, {
        id:            e.id,
        employee_code: e.employee_code,
        name:          `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
        email:         e.email,
        status:        e.status,
        designation:   job?.designations?.name ?? null,
        department:    job?.departments?.name ?? null,
        profile_photo: photoMap.get(e.id) ?? null,
        manager_id:    managerId,
        children:      [],
      })
    }

    // Wire children to parents; collect roots
    const roots: OrgNode[] = []
    for (const node of nodeMap.values()) {
      if (node.manager_id && nodeMap.has(node.manager_id)) {
        nodeMap.get(node.manager_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    // Sort children by name at every level
    const sortRec = (n: OrgNode) => {
      n.children.sort((a, b) => a.name.localeCompare(b.name))
      n.children.forEach(sortRec)
    }
    roots.sort((a, b) => a.name.localeCompare(b.name))
    roots.forEach(sortRec)

    return reply.send({ data: { roots, total: rows.length } })
  })

  // GET /employees — HR admin / super_admin only
  // Employees and managers access their own or team data via scoped ESS/manager endpoints.
  fastify.get('/employees', hrAdminAuth, async (request, reply) => {
    const { status, page = '1', limit = '50', department_id, location_id, grade_id, designation_id, search } =
      request.query as Record<string, string>
    const parsedLimit = Math.min(500, Math.max(1, parseInt(limit) || 50))
    const parsedPage  = Math.max(1, parseInt(page) || 1)
    const offset      = (parsedPage - 1) * parsedLimit

    // ── Dimension filters (used by Data Explorer drill-to-employee-list) ──────
    // department / location / designation / grade all live on job_history
    // (is_current) after the lean-employees migration (016).
    let restrictIds: string[] | null = null
    if (department_id || location_id || designation_id || grade_id) {
      let jhq = fastify.supabase
        .from('job_history')
        .select('employee_id')
        .eq('tenant_id', request.tenantId)
        .eq('is_current', true)
      if (department_id)  jhq = jhq.eq('department_id', department_id)
      if (location_id)    jhq = jhq.eq('work_location_id', location_id)
      if (designation_id) jhq = jhq.eq('designation_id', designation_id)
      if (grade_id)       jhq = jhq.eq('grade_id', grade_id)
      const { data: jhRows, error: jhErr } = await jhq
      if (jhErr) return serverError(request, reply, jhErr, ErrorCode.QUERY_FAILED, 'Failed to filter by job history')
      restrictIds = (jhRows ?? []).map((r: any) => r.employee_id as string)
      if (restrictIds.length === 0) return reply.send({ data: [], total: 0 })
    }

    let query = fastify.supabase
      .from('employees')
      .select(
        'id, employee_code, first_name, last_name, email, phone, status, joining_date',
        { count: 'exact' },
      )
      .eq('tenant_id', request.tenantId)
      .order('first_name', { ascending: true })
      .range(offset, offset + parsedLimit - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (search?.trim()) {
      const term = `%${sanitizeOrFilterTerm(search.trim())}%`
      query = query.or(`first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term},email.ilike.${term}`)
    }
    if (restrictIds) query = query.in('id', restrictIds)

    const { data, error, count } = await query
    if (error) return serverError(request, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')

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

    if (error) return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

    return reply.send(data)
  })

  // POST /employees — HR admin / super_admin only
  fastify.post('/employees', hrAdminAuth, async (request, reply) => {
    const parsed = createEmployeeSchema.safeParse(request.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.errors[0]?.message ?? 'Validation failed')
    }

    // Generate employee code via the tenant sequence (idempotent, race-safe)
    const { data: generatedCode, error: codeErr } = await fastify.supabase
      .rpc('generate_employee_code', { p_tenant_id: request.tenantId })
    if (codeErr || !generatedCode) {
      return serverError(request, reply, codeErr, ErrorCode.INTERNAL_ERROR, 'Failed to generate employee code')
    }
    const code = generatedCode as string

    const { data, error } = await fastify.supabase
      .from('employees')
      .insert({ ...parsed.data, tenant_id: request.tenantId, employee_code: code })
      .select()
      .single()

    if (error) return serverError(request, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create employee')

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.EMPLOYEE_CREATED,
      module:      MODULE.EMPLOYEE,
      entity_type: 'employee',
      entity_id:   (data as any).id,
      tenant_id:      request.tenantId,
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
      return forbidden(reply, 'NO_EMPLOYEE_LINK', 'Profile not linked to an employee record')
    }

    const schema = z.object({
      phone: z.string().min(5).max(20).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }

    if (Object.keys(parsed.data).length === 0) {
      return validationError(reply, 'NO_CHANGES', 'No updatable fields provided')
    }

    const { data, error } = await fastify.supabase
      .from('employees')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', callerProfile.employee_id)
      .eq('tenant_id', req.tenantId)
      .select('id, first_name, last_name, phone, email')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update employee')
    return reply.send({ data })
  })

  // PUT /employees/:id — HR admin / super_admin only
  // employees.status CHECK constraint (migration 004) — the ground truth.
  const EMPLOYEE_STATUSES = ['active', 'inactive', 'on_notice', 'separated'] as const
  const PutEmployeeSchema = z.object({
    first_name:           z.string().min(1).optional(),
    last_name:            z.string().min(1).optional(),
    email:                z.string().email().optional().nullable(),
    phone:                z.string().optional().nullable(),
    status:               z.enum(EMPLOYEE_STATUSES).optional(),
    joining_date:         z.string().optional().nullable(),
    work_location_id:     z.string().uuid().optional().nullable(),
    manager_id:           z.string().uuid().optional().nullable(),
    reporting_manager_id: z.string().uuid().optional().nullable(),
    // NOTE: employment_type is NOT a column on employees (dropped by
    // migration 016 — it now only lives on job_history, edited via
    // job-history.ts). date_of_joining was never a real column either
    // (the real one is joining_date, above) — both previously would have
    // failed with "column does not exist" if ever submitted. Neither is
    // sent by the live caller (EmployeeProfile.tsx profileMutation).
  })

  fastify.put('/employees/:id', hrAdminAuth, async (request, reply) => {
    const { id } = request.params as { id: string }

    const parsed = PutEmployeeSchema.safeParse(request.body)
    if (!parsed.success) return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Invalid request body')

    // Validate: employee exists and belongs to this tenant before touching it
    const { data: existing, error: findError } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .single()

    if (findError || !existing) {
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    }

    // Fresh audit finding (cross-tenant IDOR): manager_id, reporting_manager_id,
    // and work_location_id were written straight through with no tenant check —
    // an hr_admin could set any of them to a UUID from another tenant. The
    // properly-guarded PUT /employees/:id/manager endpoint validates manager_id
    // (plus circular-reference), but this generic endpoint bypassed it entirely.
    // Mirrors the validateExpansionFks pattern already established in
    // masters/sites.ts.
    const fkChecks: Array<[string, string, string]> = [
      ['manager_id',           'employees',      'Manager'],
      ['reporting_manager_id', 'employees',      'Reporting manager'],
      ['work_location_id',     'work_locations', 'Work location'],
    ]
    for (const [field, table, label] of fkChecks) {
      const fkId = (parsed.data as Record<string, unknown>)[field]
      if (!fkId) continue
      const { data: fkRow } = await fastify.supabase
        .from(table)
        .select('id')
        .eq('id', fkId as string)
        .eq('tenant_id', request.tenantId)
        .maybeSingle()
      if (!fkRow) return validationError(reply, 'INVALID_REFERENCE', `${label} not found in your organisation`)
    }

    // Circular-reference guard — same gap as above: the dedicated
    // PUT /employees/:id/manager endpoint checks self-assignment and walks
    // the manager chain for cycles, but this generic endpoint writes
    // manager_id straight through with only the tenant-FK check just above.
    if (parsed.data.manager_id) {
      if (parsed.data.manager_id === id) {
        return reply.code(422).send({ error: 'CIRCULAR_REFERENCE', message: 'An employee cannot be their own manager.' })
      }
      const MAX_DEPTH = 20
      let cursor: string | null = parsed.data.manager_id
      let depth = 0
      while (cursor && depth < MAX_DEPTH) {
        const { data: node } = await fastify.supabase
          .from('employees')
          .select('manager_id')
          .eq('id', cursor)
          .eq('tenant_id', request.tenantId)
          .maybeSingle()
        const nodeRow = node as { manager_id: string | null } | null
        if (!nodeRow) break
        cursor = nodeRow.manager_id
        depth++
        if (cursor === id) {
          return reply.code(422).send({ error: 'CIRCULAR_REFERENCE', message: 'Setting this manager would create a circular reporting chain.' })
        }
      }
    }

    // Strip fields the caller must never overwrite
    const {
      id: _id,
      tenant_id: _tenant,
      employee_code: _code,
      created_at: _created,
      created_by: _createdBy,
      ...safeUpdates
    } = parsed.data as Record<string, unknown>

    const { data, error } = await fastify.supabase
      .from('employees')
      .update({ ...safeUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', request.tenantId)
      .select()
      .single()

    if (error) return serverError(request, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update employee')

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
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    }

    if (existing.status === 'separated') {
      return conflictError(reply, ErrorCode.CONFLICT, 'Employee is already separated')
    }

    const { error } = await fastify.supabase
      .from('employees')
      .update({ status: 'separated', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', request.tenantId)

    if (error) return serverError(request, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to separate employee')

    // AF-001: revoke auth access.
    await revokeEmployeeAuth(fastify.supabase, id, request.tenantId, fastify.log)

    return reply.send({ message: 'Employee separated successfully' })
  })
}
