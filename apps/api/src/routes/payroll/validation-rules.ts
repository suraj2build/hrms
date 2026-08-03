/**
 * Payroll Validation Rules
 *
 * GET   /payroll/validation-rules       — list per-tenant validation rules
 * PATCH /payroll/validation-rules/:id   — toggle enabled/blocking or change severity
 *
 * Split out of the former monolithic routes/payroll/index.ts.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, forbidden, validationError, ErrorCode } from '../../lib/api-errors.js'

export default async function payrollValidationRulesRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/validation-rules ─────────────────────────────────────────────
  fastify.get('/payroll/validation-rules', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('payroll_validation_rules')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('stage')
      .order('code')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch validation rules')
    return reply.send({ data: data ?? [] })
  })

  // ── PATCH /payroll/validation-rules/:id ─────────────────────────────────────
  // Toggle enabled/blocking or change severity of a validation rule.
  // Only super_admin can call; hr_admin gets 403.
  fastify.patch('/payroll/validation-rules/:id', hrAdminAuth, async (req: any, reply) => {
    if (!['super_admin'].includes(req.userRole)) {
      return forbidden(reply, 'FORBIDDEN', 'Only super_admin can modify validation rules')
    }

    const { id } = req.params as { id: string }
    const schema = z.object({
      enabled:  z.boolean().optional(),
      blocking: z.boolean().optional(),
      severity: z.enum(['critical', 'warning', 'info']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    if (Object.keys(parsed.data).length === 0) {
      return validationError(reply, 'VALIDATION_ERROR', 'At least one field (enabled, blocking, severity) must be provided')
    }

    const { data, error } = await fastify.supabase
      .from('payroll_validation_rules')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update validation rule')
    if (!data)  return notFound(reply, 'NOT_FOUND', 'Validation rule not found')

    return reply.send({ data })
  })

  // ── GET /payroll/my-slips ────────────────────────────────────────────────────
  // ESS: employee views own finalized payslips (list)
  // Response: { data: EmployeePayslipView[] }
}
