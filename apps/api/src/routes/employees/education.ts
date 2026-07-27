import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'

const STORAGE_BUCKET = 'employee-files'
const SIGNED_URL_TTL = 3600 // 1 hour

const schema = z.object({
  qualification:      z.string().min(1, 'Qualification is required'),
  institution:        z.string().optional(),
  specialization:     z.string().optional(),
  year_of_completion: z.coerce.number().int().min(1900).max(2100).optional(),
  grade:              z.string().optional(),
  document_path:      z.string().optional(),
  document_name:      z.string().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

async function signUrl(fastify: any, path?: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await fastify.supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL)
  return data?.signedUrl ?? null
}

export default async function educationRoutes(fastify: FastifyInstance) {
  // Education is HR-managed in the employee master; gate all CRUD to HR admin.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/education', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_education')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('year_of_completion', { ascending: false, nullsFirst: false })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch education records')
    // Attach short-lived signed URLs for the certificate documents.
    const rows = await Promise.all(
      (data ?? []).map(async (r: any) => ({ ...r, document_url: await signUrl(fastify, r.document_path) })),
    )
    return reply.send({ data: rows })
  })

  fastify.post('/employees/:id/education', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_education')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create education record')
    return reply.code(201).send({ ...data, document_url: await signUrl(fastify, data.document_path) })
  })

  fastify.put('/employees/:id/education/:eduId', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    // .maybeSingle() (not .single()) — a wrong/foreign eduId must fall
    // through to the 404 below, not surface as a PGRST116 500.
    const { data, error } = await fastify.supabase
      .from('employee_education')
      .update(parsed.data)
      .eq('id', req.params.eduId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update education record')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Education record not found')
    return reply.send({ ...data, document_url: await signUrl(fastify, data.document_path) })
  })

  fastify.delete('/employees/:id/education/:eduId', hrAdminAuth, async (req: any, reply) => {
    // Fetch the document path first so we can clean up the storage object.
    const { data: row } = await fastify.supabase
      .from('employee_education')
      .select('document_path')
      .eq('id', req.params.eduId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const { data: deleted, error } = await fastify.supabase
      .from('employee_education')
      .delete()
      .eq('id', req.params.eduId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete education record')
    if (!deleted || deleted.length === 0) return notFound(reply, 'NOT_FOUND', 'Education record not found')

    if (row?.document_path) {
      await fastify.supabase.storage.from(STORAGE_BUCKET).remove([row.document_path])
    }
    return reply.code(204).send()
  })
}
