import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr, optDate, optEnum } from '../../lib/zod-form.js'

// Unselected dropdowns arrive as '' AND cleared fields arrive as null from the
// form — the shared helpers coerce both → undefined so optional fields validate
// instead of rejecting the whole save with a 400.
const schema = z.object({
  gender:                 optEnum(['male','female','other']),
  dob:                    optDate,
  marital_status:         optEnum(['single','married','divorced','widowed']),
  blood_group:            optStr,
  nationality:            z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().optional().default('Indian')),
  religion:               optStr,
  caste_category:         optEnum(['general','obc','sc','st','ews']),
  physically_handicapped: z.boolean().optional().default(false),
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
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    if (!isHrAdmin) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (!callerProfile?.employee_id || callerProfile.employee_id !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own personal info' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('employee_personal_info')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error && error.code !== 'PGRST116')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // PUT /employees/:id/personal-info  (upsert) — HR admin only
  fastify.put('/employees/:id/personal-info', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return reply.code(400).send({ error: 'VALIDATION', message: `${issue.path.join('.') || 'body'}: ${issue.message}` })
    }
    const { data, error } = await fastify.supabase
      .from('employee_personal_info')
      .upsert(
        { ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId },
        { onConflict: 'tenant_id,employee_id' }
      )
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })
}
