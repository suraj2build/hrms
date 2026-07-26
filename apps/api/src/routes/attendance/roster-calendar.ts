/**
 * roster-calendar.ts — Advanced Roster & Weekly-Off Engine API
 *
 * Endpoints:
 *   GET  /roster-calendar/:employeeId               — single-employee month calendar
 *   POST /roster-calendar/bulk                      — multi-employee month calendar
 *   GET  /roster-weekly-off-rules?rosterId=          — list rules for a roster
 *   POST /roster-weekly-off-rules                   — create a rule
 *   PUT  /roster-weekly-off-rules/:id               — update a rule
 *   DELETE /roster-weekly-off-rules/:id             — delete a rule
 *   GET  /shift-segments?shiftId=                   — list segments for a shift
 *   POST /shift-segments                            — create a segment
 *   PUT  /shift-segments/:id                        — update a segment
 *   DELETE /shift-segments/:id                      — delete a segment
 *   GET  /roster-rotation-groups                    — list rotation groups
 *   POST /roster-rotation-groups                    — create rotation group
 *   PUT  /roster-rotation-groups/:id                — update rotation group
 *   GET  /roster-rotation-members?groupId=          — list members of a group
 *   POST /roster-rotation-members                   — add member to group
 *   DELETE /roster-rotation-members/:id             — remove member
 *   GET  /roster-holiday-groups                     — list holiday groups
 *   POST /roster-holiday-groups                     — create holiday group
 *   PUT  /roster-holiday-groups/:id                 — update holiday group
 *   GET  /roster-simulation/coverage?month=         — coverage analytics
 */

import type { FastifyInstance } from 'fastify'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import {
  buildEmployeeRosterCalendar,
  resolveRosterDay,
  checkFatigueRisk,
  resolveShiftExpectation,
  countRosterWorkingDays,
  explainRosterDay,
  validateRosterCalendar,
  generateTestDataset,
} from '../../lib/roster-calendar-engine.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Auth helper ───────────────────────────────────────────────────────────────
//
// This checks req.userId/req.userRole but does NOT itself populate them —
// fastify.authenticate does that. There is no global auth hook in this
// codebase (every route file wires auth per-route), so `preHandler:
// hrAdminAuth` alone, without `fastify.authenticate` running first, leaves
// req.userId permanently undefined and every request 401s regardless of the
// caller's actual credentials (ISSUE-137 — this left the entire file
// unreachable). Always use `preHandler: [fastify.authenticate, hrAdminAuth]`,
// matching every other route file's `hrAdminAuth` object pattern.

function hrAdminAuth(req: any, reply: any, done: () => void) {
  if (!req.userId) return reply.code(401).send({ error: 'Unauthorized' })
  const role = req.userRole ?? ''
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(role)) {
    return reply.code(403).send({ error: 'HR admin access required' })
  }
  done()
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function rosterCalendarRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify as any

  // ── Roster Calendar — per-employee ────────────────────────────────────────

  fastify.get('/roster-calendar/:employeeId', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { employeeId }   = req.params as { employeeId: string }
    const { month, detail } = req.query as { month?: string; detail?: string }
    const tenantId          = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: 'month query param required (YYYY-MM)' })
    }

    try {
      const calendar = await buildEmployeeRosterCalendar(supabase, tenantId, employeeId, month)

      // Summary stats
      const workingDays  = calendar.filter(d => d.is_working_day).length
      const weeklyOffs   = calendar.filter(d => d.is_weekly_off).length
      const holidays     = calendar.filter(d => d.is_holiday).length
      const altSatOffs   = calendar.filter(d => d.is_alternate_saturday_off).length
      const fatigueRisks = calendar.filter(d => d.fatigue_risk).length

      return reply.send({
        data: {
          employee_id: employeeId,
          month,
          summary: { working_days: workingDays, weekly_offs: weeklyOffs, holidays, alt_sat_offs: altSatOffs, fatigue_risks: fatigueRisks },
          days: detail === 'false' ? undefined : calendar,
        },
      })
    } catch (err: unknown) {
      req.log.error({ err, employeeId, month }, '[roster-calendar] engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to build roster calendar' })
    }
  })

  // ── Roster Calendar — bulk (multiple employees) ───────────────────────────

  fastify.post('/roster-calendar/bulk', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { employee_ids, month } = req.body as { employee_ids: string[]; month: string }
    const tenantId                = req.tenantId as string

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: 'month required (YYYY-MM)' })
    }
    if (!Array.isArray(employee_ids) || !employee_ids.length) {
      return reply.code(400).send({ error: 'employee_ids array required' })
    }
    if (employee_ids.length > 50) {
      return reply.code(400).send({ error: 'Maximum 50 employees per bulk request' })
    }

    try {
      const results = await Promise.all(
        employee_ids.map(async id => {
          const calendar = await buildEmployeeRosterCalendar(supabase, tenantId, id, month)
          return {
            employee_id:  id,
            working_days: calendar.filter(d => d.is_working_day).length,
            weekly_offs:  calendar.filter(d => d.is_weekly_off).length,
            holidays:     calendar.filter(d => d.is_holiday).length,
            alt_sat_offs: calendar.filter(d => d.is_alternate_saturday_off).length,
            fatigue_days: calendar.filter(d => d.fatigue_risk).length,
            days:         calendar,
          }
        })
      )

      return reply.send({ data: results, month })
    } catch (err: unknown) {
      req.log.error({ err, month, count: employee_ids.length }, '[roster-calendar] bulk engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to build roster calendar' })
    }
  })

  // ── Single-day resolution ─────────────────────────────────────────────────

  fastify.get('/roster-calendar/:employeeId/:date', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { employeeId, date } = req.params as { employeeId: string; date: string }
    const tenantId             = req.tenantId as string

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' })
    }

    try {
      const [day, expectation, fatigue] = await Promise.all([
        resolveRosterDay(supabase, tenantId, employeeId, date),
        resolveShiftExpectation(supabase, tenantId, employeeId, date),
        checkFatigueRisk(supabase, tenantId, employeeId, date, null),
      ])

      return reply.send({ data: { ...day, shift_expectation: expectation, fatigue_detail: fatigue } })
    } catch (err: unknown) {
      req.log.error({ err, employeeId, date }, '[roster-calendar] engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to resolve roster day' })
    }
  })

  // ── Working-day count (payroll) ───────────────────────────────────────────

  fastify.get('/roster-calendar/:employeeId/working-days', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const { month }      = req.query  as { month?: string }
    const tenantId       = req.tenantId as string

    if (!month) return reply.code(400).send({ error: 'month required' })
    try {
      const count = await countRosterWorkingDays(supabase, tenantId, employeeId, month)
      return reply.send({ data: { employee_id: employeeId, month, working_days: count } })
    } catch (err: unknown) {
      req.log.error({ err, employeeId, month }, '[roster-calendar] engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to count working days' })
    }
  })

  // ── Weekly-Off Rules CRUD ─────────────────────────────────────────────────

  fastify.get('/roster-weekly-off-rules', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { rosterId } = req.query as { rosterId?: string }
    const tenantId     = req.tenantId as string

    let q = supabase.from('roster_weekly_off_rules').select('*').eq('tenant_id', tenantId)
    if (rosterId) q = q.eq('roster_id', rosterId)
    q = q.order('priority', { ascending: false }).order('effective_from')

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch weekly-off rules')
    return reply.send({ data })
  })

  fastify.post('/roster-weekly-off-rules', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_weekly_off_rules')
      .insert({ ...body, tenant_id: tenantId })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create weekly-off rule')
    return reply.code(201).send({ data })
  })

  fastify.put('/roster-weekly-off-rules/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_weekly_off_rules')
      .update(body)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update weekly-off rule')
    if (!data) return reply.code(404).send({ error: 'Rule not found' })
    return reply.send({ data })
  })

  fastify.delete('/roster-weekly-off-rules/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { error } = await supabase
      .from('roster_weekly_off_rules')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete weekly-off rule')
    return reply.code(204).send()
  })

  // ── Shift Segments CRUD ───────────────────────────────────────────────────

  fastify.get('/shift-segments', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { shiftId } = req.query as { shiftId?: string }
    const tenantId    = req.tenantId as string

    let q = supabase.from('shift_segments').select('*').eq('tenant_id', tenantId)
    if (shiftId) q = q.eq('shift_id', shiftId)
    q = q.order('shift_id').order('segment_order')

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch shift segments')
    return reply.send({ data })
  })

  fastify.post('/shift-segments', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    // Fresh audit finding: shift_id was accepted from the client with no
    // tenant-ownership check, letting a caller attach a segment row to
    // another tenant's shift — _fetchShiftWithSegments (roster-calendar-
    // engine.ts) previously had no tenant filter either, so that injected
    // segment would silently flip is_split_shift for the OTHER tenant's
    // employees on that shift and corrupt their OT/split-shift computation.
    if (body.shift_id) {
      const { data: shift } = await supabase
        .from('shifts').select('id').eq('id', body.shift_id as string).eq('tenant_id', tenantId).maybeSingle()
      if (!shift) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Shift not found in your organisation' })
    }

    const { data, error } = await supabase
      .from('shift_segments')
      .insert({ ...body, tenant_id: tenantId })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create shift segment')
    return reply.code(201).send({ data })
  })

  fastify.put('/shift-segments/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('shift_segments')
      .update(body)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update shift segment')
    if (!data) return reply.code(404).send({ error: 'Segment not found' })
    return reply.send({ data })
  })

  fastify.delete('/shift-segments/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { error } = await supabase
      .from('shift_segments')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete shift segment')
    return reply.code(204).send()
  })

  // ── Rotation Groups CRUD ──────────────────────────────────────────────────

  fastify.get('/roster-rotation-groups', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data, error } = await supabase
      .from('roster_rotation_groups')
      .select('*, members:roster_rotation_members(id, employee_id, cohort_index, effective_from, effective_to)')
      .eq('tenant_id', tenantId)
      .order('name')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch rotation groups')
    return reply.send({ data })
  })

  fastify.post('/roster-rotation-groups', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_rotation_groups')
      .insert({ ...body, tenant_id: tenantId })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create rotation group')
    return reply.code(201).send({ data })
  })

  fastify.put('/roster-rotation-groups/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_rotation_groups')
      .update(body)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update rotation group')
    if (!data) return reply.code(404).send({ error: 'Rotation group not found' })
    return reply.send({ data })
  })

  // ── Rotation Members CRUD ─────────────────────────────────────────────────

  fastify.get('/roster-rotation-members', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { groupId } = req.query as { groupId?: string }
    const tenantId    = req.tenantId as string

    let q = supabase
      .from('roster_rotation_members')
      .select('*, employee:employees(id, employee_code, first_name, last_name)')
      .eq('tenant_id', tenantId)

    if (groupId) q = q.eq('rotation_group_id', groupId)
    q = q.order('cohort_index').order('effective_from')

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch rotation members')
    return reply.send({ data })
  })

  fastify.post('/roster-rotation-members', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_rotation_members')
      .insert({ ...body, tenant_id: tenantId })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to add rotation member')
    return reply.code(201).send({ data })
  })

  fastify.delete('/roster-rotation-members/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { error } = await supabase
      .from('roster_rotation_members')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to remove rotation member')
    return reply.code(204).send()
  })

  // ── Holiday Groups CRUD ───────────────────────────────────────────────────

  fastify.get('/roster-holiday-groups', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data, error } = await supabase
      .from('roster_holiday_groups')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch holiday groups')
    return reply.send({ data })
  })

  fastify.post('/roster-holiday-groups', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_holiday_groups')
      .insert({ ...body, tenant_id: tenantId })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create holiday group')
    return reply.code(201).send({ data })
  })

  fastify.put('/roster-holiday-groups/:id', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const body     = req.body as Record<string, unknown>

    const { data, error } = await supabase
      .from('roster_holiday_groups')
      .update(body)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update holiday group')
    if (!data) return reply.code(404).send({ error: 'Holiday group not found' })
    return reply.send({ data })
  })

  // ── Explain — full resolution chain for a single employee/date ───────────

  fastify.get('/roster-simulation/explain', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { employeeId, date } = req.query as { employeeId?: string; date?: string }
    const tenantId             = req.tenantId as string

    if (!employeeId) return reply.code(400).send({ error: 'employeeId query param required' })
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'date query param required (YYYY-MM-DD)' })
    }

    try {
      const explanation = await explainRosterDay(supabase, tenantId, employeeId, date)
      return reply.send({ data: explanation })
    } catch (err: unknown) {
      req.log.error({ err, employeeId, date }, '[roster-calendar] engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to explain roster simulation' })
    }
  })

  // ── Validate — check a month calendar for logical issues ─────────────────

  fastify.get('/roster-simulation/validate', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { employeeId, month } = req.query as { employeeId?: string; month?: string }
    const tenantId              = req.tenantId as string

    if (!employeeId) return reply.code(400).send({ error: 'employeeId query param required' })
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: 'month query param required (YYYY-MM)' })
    }

    try {
      const calendar = await buildEmployeeRosterCalendar(supabase, tenantId, employeeId, month)
      const issues   = validateRosterCalendar(calendar)

      return reply.send({
        data: {
          employee_id:   employeeId,
          month,
          total_days:    calendar.length,
          issue_count:   issues.length,
          errors:        issues.filter(i => i.severity === 'error').length,
          warnings:      issues.filter(i => i.severity === 'warning').length,
          issues,
          is_valid:      issues.filter(i => i.severity === 'error').length === 0,
        },
      })
    } catch (err: unknown) {
      req.log.error({ err, employeeId, month }, '[roster-calendar] engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to validate roster simulation' })
    }
  })

  // ── Test Dataset — return 8 edge-case scenarios for QA seeding ───────────

  fastify.get('/roster-simulation/test-dataset', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    try {
      return reply.send({ data: generateTestDataset() })
    } catch (err: unknown) {
      req.log.error({ err }, '[roster-calendar] engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to generate roster test dataset' })
    }
  })

  // ── Coverage Analytics ────────────────────────────────────────────────────

  fastify.get('/roster-simulation/coverage', { preHandler: [fastify.authenticate, hrAdminAuth] }, async (req: any, reply) => {
    const { month, rosterIds } = req.query as { month?: string; rosterIds?: string }
    const tenantId             = req.tenantId as string

    if (!month) return reply.code(400).send({ error: 'month required (YYYY-MM)' })

    // Fetch all employees (optionally filtered by roster)
    let employees: any[]
    try {
      employees = await fetchAllRows((from, to) => {
        let q = supabase
          .from('employees')
          .select('id, first_name, last_name, roster_id, site_id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
        if (rosterIds) q = q.in('roster_id', rosterIds.split(','))
        return q.range(from, to)
      })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch employees for roster coverage analytics')
    }

    // Build calendars for all employees (parallel, batched)
    const BATCH = 10
    const allCalendars: Array<{ employee_id: string; working_days: number; weekly_offs: number; alt_sat_offs: number; fatigue_days: number }> = []

    try {
      for (let i = 0; i < employees.length; i += BATCH) {
        const batch = employees.slice(i, i + BATCH)
        const results = await Promise.all(
          batch.map(async (emp: Record<string, string>) => {
            const cal = await buildEmployeeRosterCalendar(supabase, tenantId, emp.id, month)
            return {
              employee_id:  emp.id,
              working_days: cal.filter(d => d.is_working_day).length,
              weekly_offs:  cal.filter(d => d.is_weekly_off).length,
              alt_sat_offs: cal.filter(d => d.is_alternate_saturday_off).length,
              fatigue_days: cal.filter(d => d.fatigue_risk).length,
            }
          })
        )
        allCalendars.push(...results)
      }
    } catch (err: unknown) {
      req.log.error({ err, month }, '[roster-calendar] coverage engine error')
      return reply.code(500).send({ error: 'ROSTER_CALENDAR_ERROR', message: 'Failed to calculate roster coverage' })
    }

    const totalWorking = allCalendars.reduce((s, c) => s + c.working_days, 0)
    const avgWorking   = allCalendars.length ? (totalWorking / allCalendars.length).toFixed(1) : 0
    const fatigueCount = allCalendars.filter(c => c.fatigue_days > 0).length

    return reply.send({
      data: {
        month,
        employee_count:     allCalendars.length,
        avg_working_days:   Number(avgWorking),
        total_fatigue_risk: fatigueCount,
        by_employee:        allCalendars,
      },
    })
  })
}
