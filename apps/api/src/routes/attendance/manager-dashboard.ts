/**
 * Manager Dashboard API
 *
 * GET /manager/dashboard
 *
 * Returns an aggregated snapshot for the currently logged-in manager:
 *   - team_members     — direct reports with today's attendance status + punch times
 *   - today_summary    — present / late / absent / leave / not_marked counts
 *   - pending          — leave_requests (PENDING) + regularisations (pending)
 *   - anomalies        — unresolved anomaly count for the team
 *
 * Auth: any authenticated user.  Managers with no direct reports receive empty arrays.
 *       HR admins / super_admins can optionally pass ?manager_employee_id=UUID to view
 *       another manager's dashboard.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { normalizeAttendanceStatus } from '../../lib/attendance-utils.js'
import { PRESENT_STATUSES }          from '../../lib/attendance-read-model.js'

const querySchema = z.object({
  /** Override — HR admin can inspect another manager's dashboard */
  manager_employee_id: z.string().uuid().optional(),
  /** YYYY-MM-DD — defaults to today */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default async function managerDashboardRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/dashboard', auth, async (req: any, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const today   = parsed.data.date ?? new Date().toISOString().slice(0, 10)
    const { tenantId, userId, userRole } = req

    // ── Resolve manager employee_id ─────────────────────────────────────────────
    let managerEmployeeId: string | null = null

    if (
      parsed.data.manager_employee_id &&
      ['super_admin', 'hr_admin'].includes(userRole)
    ) {
      // Admin override: use the supplied ID directly (still scoped to tenant)
      const { data: empRow } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', parsed.data.manager_employee_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      managerEmployeeId = (empRow as { id: string } | null)?.id ?? null
    } else {
      // Normal path: resolve from the caller's profile
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      managerEmployeeId = (profile as { employee_id: string | null } | null)?.employee_id ?? null
    }

    if (!managerEmployeeId) {
      return reply.send({
        manager_employee_id: null,
        team_members:   [],
        today_summary:  { present: 0, late: 0, absent: 0, leave: 0, not_marked: 0, total: 0 },
        pending:        { leave_requests: [], regularisations: [] },
        anomalies:      { count: 0 },
      })
    }

    // ── Fetch direct reports ────────────────────────────────────────────────────
    const { data: directReports } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, status')
      .eq('tenant_id', tenantId)
      .eq('manager_id', managerEmployeeId)
      .eq('status', 'active')

    const teamMembers = (directReports ?? []) as Array<{
      id: string; first_name: string; last_name: string; employee_code: string; status: string
    }>

    if (!teamMembers.length) {
      return reply.send({
        manager_employee_id: managerEmployeeId,
        team_members:   [],
        today_summary:  { present: 0, late: 0, absent: 0, leave: 0, not_marked: 0, total: 0 },
        pending:        { leave_requests: [], regularisations: [] },
        anomalies:      { count: 0 },
      })
    }

    const teamIds = teamMembers.map(e => e.id)

    // ── Parallel data fetch ─────────────────────────────────────────────────────
    const [
      attendanceRes,
      firstPunchRes,
      lastPunchRes,
      pendingLeaveRes,
      pendingRegRes,
      anomalyRes,
    ] = await Promise.all([
      // Today's attendance_daily rows for the team
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, status, work_hours, late_minutes, is_payable')
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .in('employee_id', teamIds),

      // First IN punch today for each team member
      fastify.supabase
        .from('attendance_logs')
        .select('employee_id, check_in')
        .eq('tenant_id', tenantId)
        .gte('check_in', `${today}T00:00:00.000Z`)
        .lt('check_in',  `${today}T23:59:59.999Z`)
        .in('employee_id', teamIds)
        .order('check_in', { ascending: true }),

      // Last OUT punch today for each team member
      fastify.supabase
        .from('attendance_logs')
        .select('employee_id, check_out')
        .eq('tenant_id', tenantId)
        .gte('check_in', `${today}T00:00:00.000Z`)
        .lt('check_in',  `${today}T23:59:59.999Z`)
        .in('employee_id', teamIds)
        .not('check_out', 'is', null)
        .order('check_out', { ascending: false }),

      // Pending leave requests for team
      fastify.supabase
        .from('leave_requests')
        .select(`
          id, from_date, to_date, computed_days, reason, created_at,
          leave_types(id, name),
          employees!inner(id, first_name, last_name, employee_code)
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'PENDING')
        .in('employee_id', teamIds)
        .order('created_at', { ascending: false })
        .limit(20),

      // Pending regularisation requests for team
      fastify.supabase
        .from('attendance_regularisation')
        .select(`
          id, date, requested_check_in, requested_check_out, reason, created_at,
          employees!inner(id, first_name, last_name, employee_code)
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .in('employee_id', teamIds)
        .order('created_at', { ascending: false })
        .limit(20),

      // Unresolved anomaly count for team
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('resolved', false)
        .in('employee_id', teamIds),
    ])

    // ── Build attendance maps ───────────────────────────────────────────────────
    type DailyRow = { employee_id: string; status: string; work_hours: number; late_minutes: number; is_payable: boolean }
    type LogRow   = { employee_id: string; check_in: string | null; check_out: string | null }

    const dailyMap    = new Map<string, DailyRow>()
    for (const row of (attendanceRes.data ?? []) as DailyRow[]) {
      dailyMap.set(row.employee_id, row)
    }

    // First check-in per employee
    const firstInMap  = new Map<string, string>()
    for (const row of (firstPunchRes.data ?? []) as LogRow[]) {
      if (!firstInMap.has(row.employee_id) && row.check_in) {
        firstInMap.set(row.employee_id, row.check_in)
      }
    }

    // Last check-out per employee (first in the DESC-ordered result)
    const lastOutMap  = new Map<string, string>()
    for (const row of (lastPunchRes.data ?? []) as LogRow[]) {
      if (!lastOutMap.has(row.employee_id) && row.check_out) {
        lastOutMap.set(row.employee_id, row.check_out)
      }
    }

    // ── Build team_members array ────────────────────────────────────────────────
    const teamMembersOut = teamMembers.map(emp => {
      const daily  = dailyMap.get(emp.id)
      // Normalize status at the boundary — DB may store mixed case
      const status = normalizeAttendanceStatus(daily?.status ?? null) ?? 'not_marked'
      return {
        employee_id:    emp.id,
        employee_code:  emp.employee_code,
        name:           `${emp.first_name} ${emp.last_name}`,
        status,
        work_hours:     daily?.work_hours     ?? 0,
        late_minutes:   daily?.late_minutes   ?? 0,
        check_in:       firstInMap.get(emp.id)  ?? null,
        check_out:      lastOutMap.get(emp.id)  ?? null,
      }
    })

    // ── Today summary ───────────────────────────────────────────────────────────
    // PRESENT_STATUSES imported from attendance-read-model.ts — canonical definition
    let presentCount  = 0
    let lateCount     = 0
    let absentCount   = 0
    let leaveCount    = 0
    let notMarkedCount= 0

    for (const m of teamMembersOut) {
      if (m.status === 'late')       { presentCount++; lateCount++ }
      else if (m.status === 'absent')              absentCount++
      else if (m.status === 'leave')               leaveCount++
      else if (m.status === 'not_marked')          notMarkedCount++
      else if (PRESENT_STATUSES.has(m.status))     presentCount++
    }

    return reply.send({
      manager_employee_id: managerEmployeeId,
      date: today,
      team_members:   teamMembersOut,
      today_summary:  {
        present:    presentCount,
        late:       lateCount,
        absent:     absentCount,
        leave:      leaveCount,
        not_marked: notMarkedCount,
        total:      teamMembers.length,
      },
      pending: {
        leave_requests:   pendingLeaveRes.data  ?? [],
        regularisations:  pendingRegRes.data    ?? [],
      },
      anomalies: {
        count: anomalyRes.count ?? 0,
      },
    })
  })
}
