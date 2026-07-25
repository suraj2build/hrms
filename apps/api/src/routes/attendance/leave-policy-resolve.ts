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
import { MANAGER_ROLES } from '../../lib/rbac.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

    // Non-admins may only resolve their own policy
    if (!MANAGER_ROLES.includes(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (profile?.employee_id !== employeeId) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'You can only view your own policy',
        })
      }
    }

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

    const resolution = await resolveEffectivePolicyForEmployee(
      fastify.supabase,
      req.tenantId,
      employeeId,
      { asOf, includeDebug },
    )

    return reply.send({
      data: {
        employee: {
          id:            (emp as any).id,
          name:          `${(emp as any).first_name} ${(emp as any).last_name}`,
          employee_code: (emp as any).employee_code,
          joining_date:  (emp as any).joining_date,
        },
        as_of: asOf ?? new Date().toISOString().slice(0, 10),
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

    // Non-admins may only resolve their own policy
    if (!MANAGER_ROLES.includes(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (profile?.employee_id !== employeeId) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'You can only view your own policy',
        })
      }
    }

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

    const rule = await resolveEffectivePolicyRule(
      fastify.supabase,
      req.tenantId,
      employeeId,
      leaveTypeId,
      asOf,
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
        as_of: asOf ?? new Date().toISOString().slice(0, 10),
        rule,
      },
    })
  })
}
