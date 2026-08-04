/**
 * Employee Manager Routes
 *
 * GET /employees/:id/manager           — return the employee's current manager
 * PUT /employees/:id/manager           — set / change the manager (HR admin only)
 *                                        Body: { manager_id: string | null }
 *
 * Circular-reference check (application layer):
 *   Before updating employee A's manager to B, walk B's manager chain.
 *   If A appears anywhere in that chain → reject 422 CIRCULAR_REFERENCE.
 *   Max depth: 20 hops (guard against infinite loops from bad data).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const MAX_DEPTH = 20   // maximum manager-chain depth before aborting cycle check

export default async function employeeManagerRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /employees/:id/manager ──────────────────────────────────────────────
  fastify.get('/employees/:id/manager', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Verify employee belongs to tenant
    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, manager_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (empErr || !emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    if (!emp.manager_id) {
      return reply.send({ data: null })
    }

    // Fetch manager details
    const { data: manager, error: mgrErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name, email, phone, status')
      .eq('id', emp.manager_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (mgrErr || !manager) {
      // manager_id set but manager not in same tenant or deleted → return null
      return reply.send({ data: null })
    }

    return reply.send({ data: manager })
  })

  // ── PUT /employees/:id/manager ──────────────────────────────────────────────
  fastify.put('/employees/:id/manager', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const bodySchema = z.object({
      manager_id: z.string().uuid('manager_id must be a valid UUID').nullable(),
    })
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { manager_id } = parsed.data

    // reassign_manager_atomic() (migration 414) does the tenant-scope check,
    // the self-assignment/circular-reference chain-walk, and the UPDATE all
    // inside one transaction, serialized against every other manager
    // reassignment for this tenant via an advisory lock — an app-layer
    // chain-walk followed by a separate UPDATE (the old shape) left a gap
    // where two concurrent reassignments could together form a cycle
    // neither one individually would create.
    const { data: rpcData, error: rpcErr } = await fastify.supabase
      .rpc('reassign_manager_atomic', {
        p_tenant_id:      req.tenantId,
        p_employee_id:    id,
        p_new_manager_id: manager_id,
        p_max_depth:      MAX_DEPTH,
      })
      .single()
    if (rpcErr) return serverError(req, reply, rpcErr, ErrorCode.UPDATE_FAILED, 'Failed to update manager')

    const outcome = (rpcData as { outcome: string } | null)?.outcome
    if (outcome === 'not_found')          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    if (outcome === 'manager_not_found')  return reply.code(404).send({ error: 'NOT_FOUND', message: 'Manager not found in this tenant' })
    if (outcome === 'self_reference') {
      return reply.code(422).send({
        error:   'CIRCULAR_REFERENCE',
        message: 'An employee cannot be their own manager.',
      })
    }
    if (outcome === 'cycle') {
      return reply.code(422).send({
        error:   'CIRCULAR_REFERENCE',
        message: 'Setting this manager would create a circular reporting chain.',
      })
    }

    // PEND-105: reassign_manager_atomic() (migration 414) performs the UPDATE
    // itself inside the RPC's own transaction — its current signature has no
    // p_expected_version param to plumb a CAS check through, and rewriting
    // the RPC's SQL is out of scope for this batch (needs a matching
    // migration). `version` is surfaced here so callers can at least read
    // the post-update value; full CAS protection for this endpoint is
    // tracked separately.
    const { data, error } = await fastify.supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name, manager_id, version')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch updated employee')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employees',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  id,
      newData:     { manager_id },
    })

    return reply.send({ data })
  })
}
