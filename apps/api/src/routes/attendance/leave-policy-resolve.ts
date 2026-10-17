/**
 * Leave Policy Resolve — runtime policy resolution for an employee
 *
 * Endpoints:
 *   GET /leave/policy/resolve/:employeeId
 *       Resolves the full effective policy for an employee (all leave types).
 *       Returns which named policy applies, the scope that matched, and all rules.
 *
 *   GET /leave/policy/resolve/:employeeId/type/:leaveTypeId
 *       Resolves the effective rule for one specific leave type.
 *       Useful for pre-flight checks before submitting a leave application.
 *
 * Query params (both endpoints):
 *   ?as_of=YYYY-MM-DD   Evaluate policy effectiveness on this date (default: today).
 *   ?debug=true         Include evaluated_candidates array in full-resolve response.
 *
 * Access: any authenticated user in the tenant.
 *   Employees may call their own resolve; HR/admins may call for any employee.
 *
 * Resolution priority (highest → lowest):
 *   employee > department > work_location > default (named) > legacy leave_policies
 */

import type { FastifyInstance } from 'fastify'
import {
  resolveEffectivePolicyForEmployee,
  resolveEffectivePolicyRule,
} from '../../lib/leave-policy-service.js'
import { fetchTenantTz, utcToLocalDate } from '../../lib/attendance-engine.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { getDirectReportIds } from '../../lib/manager-scope.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — `!MANAGER_ROLES.includes(role)`
 * skipped this ownership check for EVERY manager-tier role, not just HR —
 * so a plain `manager` with zero reporting relationship to `employeeId`
 * could resolve any tenant employee's leave policy (accrual rate,
 * eligibility days, minimum service) plus name/employee_code/joining_date,
 * tenant-wide. Mirrors the sibling leave-duration.ts's self/HR/
 * getDirectReportIds pattern. Returns true if the caller may proceed;
 * false if it has already sent a 403/500 response.
 */
async function checkPolicyAccess(
  fastify:    FastifyInstance,
  req:        any,
  reply:      any,
  employeeId: string,
): Promise<boolean> {
  if ((HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) return true

  const { data: profile, error: profileError } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .maybeSingle()

  // A discarded error here previously collapsed into the 403 below,
  // masking a genuine backend failure as an authorization denial.
  if (profileError) {
    serverError(req, reply, profileError, ErrorCode.QUERY_FAILED, 'Failed to resolve caller identity')
    return false
  }
  const myEmployeeId = (profile as { employee_id: string | null } | null)?.employee_id ?? null
  if (myEmployeeId === employeeId) return true

  if (myEmployeeId && req.userRole === 'manager') {
    const reportIds = await getDirectReportIds(fastify.supabase, req.tenantId, myEmployeeId)
    if (reportIds.includes(employeeId)) return true
  }

  reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own policy' })
  return false
}

export default async function leavePolicyResolveRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /leave/policy/resolve/:employeeId ─────────────────────────────────
  // Full resolution: all leave types for this employee.
  fastify.get('/leave/policy/resolve/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    // Parse optional query params
    const rawAsOf = (req.query as any).as_of
    const asOf: string | undefined =
      rawAsOf && DATE_RE.test(rawAsOf) ? rawAsOf : undefined

    const includeDebug = (req.query as any).debug === 'true'

    // Non-admins may only resolve their own policy, or (for a manager) a
    // direct report's.
    if (!(await checkPolicyAccess(fastify, req, reply, employeeId))) return

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, joining_date')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // The service defaults a missing asOf to the tenant-LOCAL date
    // (utcToLocalDate). The response used to independently echo a raw UTC
    // date here, so near either day boundary the `as_of` shown to the
    // caller didn't match the date the resolution was actually evaluated
    // against — resolve it the same way once, up front, and reuse it.
    const effectiveAsOf = asOf ?? utcToLocalDate(new Date(), await fetchTenantTz(fastify.supabase, req.tenantId))

    const resolution = await resolveEffectivePolicyForEmployee(
      fastify.supabase,
      req.tenantId,
      employeeId,
      { asOf: effectiveAsOf, includeDebug },
    )

    return reply.send({
      data: {
        employee: {
          id:            (emp as any).id,
          name:          `${(emp as any).first_name} ${(emp as any).last_name}`,
          employee_code: (emp as any).employee_code,
          joining_date:  (emp as any).joining_date,
        },
        as_of: effectiveAsOf,
        ...resolution,
      },
    })
  })

  // ── GET /leave/policy/resolve/:employeeId/type/:leaveTypeId ──────────────
  // Single-rule resolution: one leave type for this employee.
  fastify.get('/leave/policy/resolve/:employeeId/type/:leaveTypeId', auth, async (req: any, reply) => {
    const { employeeId, leaveTypeId } = req.params as {
      employeeId:  string
      leaveTypeId: string
    }

    // Parse optional as_of query param
    const rawAsOf = (req.query as any).as_of
    const asOf: string | undefined =
      rawAsOf && DATE_RE.test(rawAsOf) ? rawAsOf : undefined

    // Non-admins may only resolve their own policy, or (for a manager) a
    // direct report's.
    if (!(await checkPolicyAccess(fastify, req, reply, employeeId))) return

    // Verify employee + leave type belong to tenant
    const [{ data: emp }, { data: lt }] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle(),
      fastify.supabase
        .from('leave_types')
        .select('id, name')
        .eq('id', leaveTypeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle(),
    ])

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }
    if (!lt) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Leave type not found' })
    }

    const effectiveAsOf = asOf ?? utcToLocalDate(new Date(), await fetchTenantTz(fastify.supabase, req.tenantId))

    const rule = await resolveEffectivePolicyRule(
      fastify.supabase,
      req.tenantId,
      employeeId,
      leaveTypeId,
      effectiveAsOf,
    )

    if (!rule) {
      return reply.code(404).send({
        error:   'NO_POLICY',
        message: 'No policy rule configured for this leave type',
      })
    }

    return reply.send({
      data: {
        employee: {
          id:            (emp as any).id,
          name:          `${(emp as any).first_name} ${(emp as any).last_name}`,
          employee_code: (emp as any).employee_code,
        },
        leave_type: {
          id:   (lt as any).id,
          name: (lt as any).name,
        },
        as_of: effectiveAsOf,
        rule,
      },
    })
  })
}
