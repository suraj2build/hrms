import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr } from '../../lib/zod-form.js'
import { serverError, notFound, forbidden, validationError, ErrorCode } from '../../lib/api-errors.js'

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

  // PUT /employees/:id/personal-info  (upsert) — HR admin only
  fastify.put('/employees/:id/personal-info', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return validationError(reply, ErrorCode.VALIDATION_ERROR, `${issue.path.join('.') || 'body'}: ${issue.message}`)
    }
    const { data, error } = await fastify.supabase
      .from('employee_personal_info')
      .upsert(
        { ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId },
        { onConflict: 'tenant_id,employee_id' }
      )
      .select()
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save personal information')
    return reply.send(data)
  })
}
