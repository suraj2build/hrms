/**
 * Manager Team Regularisation Context
 *
 * GET /manager/team/regularisation-context?employee_id=&date=
 *
 * A raw punch-forensics trace is useless for approving a regularisation whose
 * whole point is that punches are missing. This gives the approver the context
 * that actually drives the decision:
 *
 *   • attendance      — the employee's recent attendance trend (avg hours,
 *                       punctuality, present/late/absent) over the last 30 days
 *   • current_record  — what attendance_daily currently holds for the target
 *                       date (so the correction's effect is visible)
 *   • history         — the employee's recent regularisation requests (pattern /
 *                       frequency signal, e.g. repeated "device down" claims)
 *
 * Authorisation mirrors the canonical manager-scope model: HR admins may inspect
 * anyone; a manager may only inspect their own direct reports.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isHrAdmin, resolveCallerEmployeeId, getDirectReportIds } from '../../lib/manager-scope.js'
import { fetchAttendanceTrend } from '../../lib/attendance-trend.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function managerTeamRegularisationContextRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/team/regularisation-context', auth, async (req: any, reply) => {
    const parsed = z.object({
      employee_id: z.string().uuid(),
      date:        z.string().regex(dateRe, 'date must be YYYY-MM-DD'),
    }).safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { employee_id, date } = parsed.data
    const tenantId = req.tenantId as string

    // ── Authorise ─────────────────────────────────────────────────────────────
    // Previously used isDirectReport() (literal one-level manager_id match),
    // while the actual approve/reject endpoint this drawer supports
    // (attendance/regularisation.ts) authorises via getDirectReportIds()'s
    // recursive get_all_subordinates() RPC (migration 357) — a skip-level
    // manager could approve a Level-4 report's regularisation but then 403 on
    // this context drawer for that same employee. Fixed to use the same
    // subtree-aware check.
    if (!isHrAdmin(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, tenantId)
      if (!callerEmpId) {
        return reply.code(403).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
      }
      const subordinateIds = await getDirectReportIds(fastify.supabase, tenantId, callerEmpId)
      if (!subordinateIds.includes(employee_id)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Employee is not one of your direct reports' })
      }
    }

    const { data: emp, error: empError } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('id', employee_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (empError) return serverError(req, reply, empError, ErrorCode.QUERY_FAILED, 'Failed to fetch employee')
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    let attendance, current, history, curError, histError
    try {
      ;[attendance, { data: current, error: curError }, { data: history, error: histError }] = await Promise.all([
        fetchAttendanceTrend(fastify.supabase, tenantId, employee_id, 30),

        fastify.supabase
          .from('attendance_daily')
          .select('date, status, work_hours, late_minutes, overtime_minutes')
          .eq('tenant_id', tenantId)
          .eq('employee_id', employee_id)
          .eq('date', date)
          .maybeSingle(),

        fastify.supabase
          .from('attendance_regularisation')
          .select('date, status, reason, created_at')
          .eq('tenant_id', tenantId)
          .eq('employee_id', employee_id)
          .order('created_at', { ascending: false })
          .limit(6),
      ])
    } catch (trendErr) {
      return serverError(req, reply, trendErr, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance trend')
    }
    // Silent failure previously fell back to `current: null` / `history: []`,
    // which reads as "no existing attendance record" / "no prior requests" —
    // could bias the approver's decision with no signal the query failed.
    if (curError)  return serverError(req, reply, curError, ErrorCode.QUERY_FAILED, 'Failed to fetch current attendance record')
    if (histError) return serverError(req, reply, histError, ErrorCode.QUERY_FAILED, 'Failed to fetch regularisation history')

    return reply.send({
      employee: {
        id:            emp.id,
        name:          `${emp.first_name} ${emp.last_name}`,
        employee_code: emp.employee_code,
      },
      date,
      attendance,
      current_record: current
        ? {
            status:           (current as any).status,
            work_hours:       Number((current as any).work_hours ?? 0),
            late_minutes:     Number((current as any).late_minutes ?? 0),
            overtime_minutes: Number((current as any).overtime_minutes ?? 0),
          }
        : null,
      history: (history ?? []).map((h: any) => ({
        date:       h.date,
        status:     h.status,
        reason:     h.reason,
        created_at: h.created_at,
      })),
    })
  })
}
