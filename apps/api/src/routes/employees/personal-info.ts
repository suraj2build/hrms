import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr } from '../../lib/zod-form.js'
import { serverError, notFound, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'

// clearable*: blanking a field ('' or null) writes null so it is actually
// CLEARED on save (not silently left at the old value). A field OMITTED from
// the body stays untouched (Zod drops absent optional keys). profile_photo is
// kept omit-only (managed by the photo upload), so a personal-info edit never
// erases the avatar.
const clearableStr = z.preprocess((v) => (v === '' || v === null ? null : v), z.string().nullable().optional())
const clearableEnum = <T extends [string, ...string[]]>(vals: T) =>
  z.preprocess((v) => (v === '' || v === null ? null : v), z.enum(vals).nullable().optional())

const schema = z.object({
  gender:                 clearableEnum(['male','female','other']),
  dob:                    clearableStr,
  marital_status:         clearableEnum(['single','married','divorced','widowed']),
  blood_group:            clearableStr,
  nationality:            clearableStr,
  religion:               clearableStr,
  caste_category:         clearableEnum(['general','obc','sc','st','ews']),
  physically_handicapped: z.boolean().optional(),
  profile_photo:          optStr,
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C).
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .single()
  return !!data
}

export default async function personalInfoRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /employees/:id/personal-info
  // HR admins see any employee; a regular employee may only see their own.
  fastify.get('/employees/:id/personal-info', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
    if (!isHrAdmin) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!callerProfile?.employee_id || callerProfile.employee_id !== req.params.id) {
        return forbidden(reply, 'FORBIDDEN', 'You can only view your own personal info')
      }
    }

    const { data, error } = await fastify.supabase
      .from('employee_personal_info')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error && error.code !== 'PGRST116')
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch personal information')
    return reply.send({ data: data ?? null })
  })

  // PUT /employees/:id/personal-info  (upsert-with-CAS) — HR admin only
  //
  // PEND-105: this used to be a plain .upsert() — but a CAS version check
  // needs a WHERE clause on the UPDATE branch, which supabase-js's upsert()
  // doesn't expose (it always does INSERT ... ON CONFLICT DO UPDATE
  // unconditionally). Rewritten as an explicit select-then-insert-or-update:
  //   - No existing row → first-ever save for this employee, nothing to
  //     conflict with, plain INSERT. A concurrent first save from another
  //     tab loses the unique-key race (23505) and falls back to an update.
  //   - Existing row → CAS-checked UPDATE keyed on id, with
  //     .eq('version', expected_version) added to the WHERE clause itself
  //     when the caller sends it (not just checked-then-written, which
  //     alone would still race) — same pattern as every other PEND-105
  //     endpoint.
  fastify.put('/employees/:id/personal-info', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return validationError(reply, ErrorCode.VALIDATION_ERROR, `${issue.path.join('.') || 'body'}: ${issue.message}`)
    }
    const { expected_version, ...fields } = parsed.data

    const { data: existing, error: existingErr } = await fastify.supabase
      .from('employee_personal_info')
      .select('id, version')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (existingErr) return serverError(req, reply, existingErr, ErrorCode.QUERY_FAILED, 'Failed to load personal information')

    if (!existing) {
      const { data, error } = await fastify.supabase
        .from('employee_personal_info')
        .insert({ ...fields, employee_id: req.params.id, tenant_id: req.tenantId })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') {
          // Lost the race — another request inserted the first row for this
          // employee concurrently. This caller believed no row existed, so
          // there's no version of theirs to compare; fall back to a plain
          // update of whatever just landed.
          const { data: retryData, error: retryErr } = await fastify.supabase
            .from('employee_personal_info')
            .update(fields)
            .eq('employee_id', req.params.id)
            .eq('tenant_id', req.tenantId)
            .select()
            .maybeSingle()
          if (retryErr) return serverError(req, reply, retryErr, ErrorCode.UPDATE_FAILED, 'Failed to save personal information')
          return reply.send(retryData)
        }
        return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to save personal information')
      }
      return reply.send(data)
    }

    let query = fastify.supabase
      .from('employee_personal_info')
      .update(fields)
      .eq('id', existing.id)
      .eq('tenant_id', req.tenantId)
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query.select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save personal information')
    if (!data) {
      // 0 rows matched — the row we just confirmed exists moved on
      // (version changed) between the check above and this UPDATE.
      return conflictError(reply, ErrorCode.VERSION_CONFLICT,
        'Personal information was changed by someone else. Reload and try again.')
    }
    return reply.send(data)
  })
}
