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

    // Verify employee belongs to tenant
    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (empErr || !emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Self-assignment guard (belt-and-suspenders over DB CHECK constraint)
    if (manager_id === id) {
      return reply.code(422).send({
        error:   'CIRCULAR_REFERENCE',
        message: 'An employee cannot be their own manager.',
      })
    }

    // Circular reference check — walk manager_id's chain; fail if id appears
    if (manager_id) {
      // Verify new manager belongs to same tenant
      const { data: newMgr } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', manager_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!newMgr) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Manager not found in this tenant' })
      }

      // Walk up the chain: newMgr → newMgr.manager → ... checking for id
      let cursor: string | null = manager_id
      let depth = 0

      while (cursor && depth < MAX_DEPTH) {
        const { data: node } = await fastify.supabase
          .from('employees')
          .select('manager_id')
          .eq('id', cursor)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()

        const nodeRow = node as { manager_id: string | null } | null
        if (!nodeRow) break
        cursor = nodeRow.manager_id
        depth++

        if (cursor === id) {
          return reply.code(422).send({
            error:   'CIRCULAR_REFERENCE',
            message: 'Setting this manager would create a circular reporting chain.',
          })
        }
      }
    }

    // Update
    const { data, error } = await fastify.supabase
      .from('employees')
      .update({ manager_id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, employee_code, first_name, last_name, manager_id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update manager')

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
