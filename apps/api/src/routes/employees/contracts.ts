import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr, optDate } from '../../lib/zod-form.js'
import { serverError, notFound, forbidden, ErrorCode } from '../../lib/api-errors.js'

const STORAGE_BUCKET = 'employee-files'
const SIGNED_URL_TTL = 3600 // 1 hour

async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles').select('employee_id').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  return data?.employee_id ?? null
}

/** Generate a signed URL for a storage path. Returns null on failure. */
async function createSignedUrl(fastify: any, storagePath: string): Promise<string | null> {
  const { data, error } = await fastify.supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL)
  if (error || !data?.signedUrl) {
    fastify.log.warn({ storagePath, error: error?.message }, 'contracts: failed to generate signed URL')
    return null
  }
  return data.signedUrl
}

const schema = z.object({
  contract_type: z.enum(['appointment','renewal','amendment','nda','other']),
  start_date:    z.string().min(1, 'Start date is required'),
  end_date:      optDate,
  storage_path:  optStr,
  status:        z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(['draft','active','expired','terminated']).optional().default('active')),
  notes:         optStr,
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function contractsRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // Self-or-HR-admin — EssDocuments.tsx reads this for the caller's own
  // contracts; the admin console reads it for any employee. Was previously
  // any authenticated user with no ownership check at all, letting one
  // employee read another's contract records (NDAs, terms, notes) just by
  // supplying an employee UUID.
  fastify.get('/employees/:id/contracts', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== req.params.id) {
        return forbidden(reply, 'FORBIDDEN', 'You can only view your own contracts')
      }
    }

    const { data, error } = await fastify.supabase
      .from('employee_contracts')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('start_date', { ascending: false })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee contracts')

    const contracts = await Promise.all(
      (data ?? []).map(async (c: any) => ({
        ...c,
        signed_url: c.storage_path ? await createSignedUrl(fastify, c.storage_path) : null,
        signed_url_expires_in: SIGNED_URL_TTL,
      })),
    )
    return reply.send({ data: contracts })
  })

  // HR admin only — employees do not manage their own contracts
  fastify.post('/employees/:id/contracts', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.storage_path && !parsed.data.storage_path.startsWith(`${req.tenantId}/`)) {
      return reply.code(400).send({ error: 'INVALID_STORAGE_PATH', message: 'storage_path must be within your tenant namespace' })
    }
    const { data, error } = await fastify.supabase
      .from('employee_contracts')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId, created_by: req.userId })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create employee contract')
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/contracts/:contractId', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.storage_path && !parsed.data.storage_path.startsWith(`${req.tenantId}/`)) {
      return reply.code(400).send({ error: 'INVALID_STORAGE_PATH', message: 'storage_path must be within your tenant namespace' })
    }
    const { data, error } = await fastify.supabase
      .from('employee_contracts')
      .update(parsed.data)
      .eq('id', req.params.contractId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update employee contract')
    if (!data) return notFound(reply, 'CONTRACT_NOT_FOUND', 'Contract not found')
    return reply.send(data)
  })

  fastify.delete('/employees/:id/contracts/:contractId', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    const { error } = await fastify.supabase
      .from('employee_contracts')
      .delete()
      .eq('id', req.params.contractId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete employee contract')
    return reply.code(204).send()
  })
}
