/**
 * Payroll Validation Rules
 *
 * GET   /payroll/validation-rules        — list the resolved rule set for this
 *                                           tenant: every platform default, with
 *                                           this tenant's own override (if any)
 *                                           substituted in by rule `code`.
 * PATCH /payroll/validation-rules/:code  — create or update THIS TENANT'S OWN
 *                                           override for a rule code. Never
 *                                           modifies the platform default row —
 *                                           that stays platform-admin-only
 *                                           (migration 143's RLS policy).
 *
 * Ownership model (migration 439, see docs/production-readiness/STATUS.md
 * "Tenant vs. global ownership"): global defaults with tenant-specific
 * overrides, resolved explicitly by code. Previously this route read/wrote
 * rows filtered by tenant_id alone, which could never see any of the 11
 * platform default rows (all tenant_id IS NULL) — this endpoint was broken
 * for every tenant before migration 439 made tenant overrides possible.
 *
 * Split out of the former monolithic routes/payroll/index.ts.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, forbidden, validationError, ErrorCode } from '../../lib/api-errors.js'
import { fetchResolvedValidationRules, upsertTenantValidationRuleOverride } from '../../lib/payroll-validation-rules.js'

export default async function payrollValidationRulesRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/validation-rules ─────────────────────────────────────────────
  fastify.get('/payroll/validation-rules', hrAdminAuth, async (req: any, reply) => {
    try {
      const data = await fetchResolvedValidationRules(fastify.supabase, req.tenantId)
      data.sort((a, b) => a.stage.localeCompare(b.stage) || a.code.localeCompare(b.code))
      return reply.send({ data })
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch validation rules')
    }
  })

  // ── PATCH /payroll/validation-rules/:code ───────────────────────────────────
  // Create or update this tenant's own override (enabled/blocking/severity)
  // for the platform default rule identified by `code`.
  // Only super_admin can call; hr_admin gets 403.
  fastify.patch('/payroll/validation-rules/:code', hrAdminAuth, async (req: any, reply) => {
    if (!['super_admin'].includes(req.userRole)) {
      return forbidden(reply, 'FORBIDDEN', 'Only super_admin can modify validation rules')
    }

    const { code } = req.params as { code: string }
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

    const { data, error } = await upsertTenantValidationRuleOverride(fastify.supabase, req.tenantId, code, parsed.data)

    if (error) {
      const message = (error as { message?: string }).message ?? ''
      if (message.startsWith('No global validation rule')) {
        return notFound(reply, 'NOT_FOUND', 'Validation rule not found')
      }
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update validation rule')
    }

    return reply.send({ data })
  })

  // ── GET /payroll/my-slips ────────────────────────────────────────────────────
  // ESS: employee views own finalized payslips (list)
  // Response: { data: EmployeePayslipView[] }
}
