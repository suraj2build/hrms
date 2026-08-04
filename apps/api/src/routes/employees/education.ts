import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'

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

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
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
    // Storage path must live under this tenant's prefix — the metadata row
    // carries the correct tenant_id, but the referenced object is signed
    // later (signUrl uses the service-role client, bypassing bucket RLS), so
    // without this check an admin could register — and later sign — another
    // tenant's file. Matches the check in routes/uploads/index.ts.
    if (parsed.data.document_path && !parsed.data.document_path.startsWith(`${req.tenantId}/`)) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, 'document_path must be within your tenant namespace')
    }
    const { data, error } = await fastify.supabase
      .from('employee_education')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create education record')
    return reply.code(201).send({ ...data, document_url: await signUrl(fastify, data.document_path) })
  })

  fastify.put('/employees/:id/education/:eduId', hrAdminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.document_path && !parsed.data.document_path.startsWith(`${req.tenantId}/`)) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, 'document_path must be within your tenant namespace')
    }
    const { expected_version, ...fields } = parsed.data
    // .maybeSingle() (not .single()) — a wrong/foreign eduId must fall
    // through to the 404 below, not surface as a PGRST116 500.
    let query = fastify.supabase
      .from('employee_education')
      .update(fields)
      .eq('id', req.params.eduId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)
    const { data, error } = await query.select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update education record')
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('employee_education')
          .select('id')
          .eq('id', req.params.eduId)
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'Education record was changed by someone else. Reload and try again.')
        }
      }
      return notFound(reply, 'NOT_FOUND', 'Education record not found')
    }
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
