/**
 * Manager Compensation Workspace — /manager/team/compensation
 *
 * Program 5 · P5.3. Gives a manager visibility into their direct reports'
 * compensation and lets them raise increment recommendations.
 *
 * The manager's employee_id is resolved SERVER-SIDE from their profile and the
 * team is scoped to employees.manager_id = that id — a manager can only ever see
 * their own reports (HR admins may pass ?manager_employee_id to inspect another
 * manager's team). Recommendations are submitted through the EXISTING
 * `POST /compensation/revisions` workflow (which already guards self / direct
 * report) — HR retains approval authority. No new workflow, no bypass.
 *
 *   GET /manager/team/compensation                     — team CTC + last revision
 *   GET /manager/team/compensation/:employeeId/history — one report's revision history
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

export default async function managerCompensationRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function isAdmin(role: string) {
    return (HR_ADMIN_ROLES as readonly string[]).includes(role)
  }

  /** Resolve the manager employee_id for this request (self, or admin override). */
  async function resolveManagerId(req: any, override?: string): Promise<string | null> {
    if (override && isAdmin(req.userRole)) {
      const { data } = await fastify.supabase
        .from('employees').select('id')
        .eq('id', override).eq('tenant_id', req.tenantId).maybeSingle()
      return (data as { id: string } | null)?.id ?? null
    }
    const { data } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', req.tenantId).maybeSingle()
    return (data as { employee_id: string | null } | null)?.employee_id ?? null
  }

  // ── GET /manager/team/compensation ────────────────────────────────────────────
  fastify.get('/manager/team/compensation', auth, async (req: any, reply) => {
    const parsed = z.object({ manager_employee_id: z.string().uuid().optional() }).safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const managerId = await resolveManagerId(req, parsed.data.manager_employee_id)
    if (!managerId) return reply.send({ data: [], manager_employee_id: null })

    // Direct reports (active). designation/grade are FK lookups (designation_id /
    // grade_id) embedded by name; joining_date is the canonical column.
    const { data: reports, error: repErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, joining_date, designations(name), grades(name)')
      .eq('tenant_id', req.tenantId)
      .eq('manager_id', managerId)
      .eq('status', 'active')
      .order('first_name', { ascending: true })

    if (repErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch team' })
    if (!reports?.length) return reply.send({ data: [], manager_employee_id: managerId })

    const empIds = reports.map((e: any) => e.id)

    // Active compensation + latest revision per report, in two batched reads.
    const [{ data: comps }, { data: revisions }] = await Promise.all([
      fastify.supabase
        .from('employee_compensations')
        .select('employee_id, ctc_annual, ctc_monthly, effective_from')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .in('employee_id', empIds),
      fastify.supabase
        .from('compensation_revisions')
        .select('employee_id, revision_type, status, effective_date, delta_pct, submitted_at')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', empIds)
        .order('submitted_at', { ascending: false }),
    ])

    const compByEmp = new Map((comps ?? []).map((c: any) => [c.employee_id, c]))
    const lastRevByEmp = new Map<string, any>()
    const pendingByEmp = new Set<string>()
    for (const r of revisions ?? []) {
      if (!lastRevByEmp.has(r.employee_id)) lastRevByEmp.set(r.employee_id, r)
      if (r.status === 'pending') pendingByEmp.add(r.employee_id)
    }

    const data = reports.map((e: any) => {
      const comp = compByEmp.get(e.id)
      const lastRev = lastRevByEmp.get(e.id)
      return {
        employee_id:    e.id,
        name:           `${e.first_name} ${e.last_name}`,
        employee_code:  e.employee_code,
        designation:    (Array.isArray(e.designations) ? e.designations[0]?.name : e.designations?.name) ?? null,
        grade:          (Array.isArray(e.grades) ? e.grades[0]?.name : e.grades?.name) ?? null,
        date_of_joining: e.joining_date ?? null,
        ctc_annual:     comp ? Number(comp.ctc_annual ?? 0) : null,
        ctc_monthly:    comp ? Number(comp.ctc_monthly ?? 0) : null,
        comp_effective_from: comp?.effective_from ?? null,
        last_revision: lastRev ? {
          revision_type:  lastRev.revision_type,
          status:         lastRev.status,
          effective_date: lastRev.effective_date,
          delta_pct:      lastRev.delta_pct != null ? Number(lastRev.delta_pct) : null,
        } : null,
        has_pending_revision: pendingByEmp.has(e.id),
      }
    })

    return reply.send({ data, manager_employee_id: managerId })
  })

  // ── GET /manager/team/compensation/:employeeId/history ────────────────────────
  fastify.get('/manager/team/compensation/:employeeId/history', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const managerId = await resolveManagerId(req)

    // The target must be the caller's own direct report (HR admins bypass the scope).
    if (!isAdmin(req.userRole)) {
      if (!managerId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'No manager profile linked' })
      const { data: emp } = await fastify.supabase
        .from('employees').select('id, manager_id')
        .eq('id', employeeId).eq('tenant_id', req.tenantId).maybeSingle()
      if (!emp || (emp as any).manager_id !== managerId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'This employee is not one of your direct reports' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select(`
        id, revision_type, effective_date, status, reason,
        before_ctc_annual, new_ctc_annual, delta_amount, delta_pct, submitted_at, decided_at
      `)
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('submitted_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch history' })
    return reply.send({ data: data ?? [], employee_id: employeeId })
  })
}
