/**
 * Employee Org Context — site + roster assignment with history
 *
 * GET  /employees/employees/:id/org-context
 *      Returns current effective site/roster assignment for an employee,
 *      with resolved names and next 5 upcoming applicable holidays.
 *
 * POST /employees/employees/:id/org-context
 *      Creates a new date-effective assignment (and closes the previous one).
 *      Body: { site_id?, roster_id?, effective_from, reason? }
 *      Auth: hr_admin / super_admin
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  resolveEmployeeOrgContext,
  getHolidayDates,
  type HolidayRowWithDate,
} from '../../lib/org-context.js'

export default async function employeeOrgContextRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /employees/employees/:id/org-context ────────────────────────────────────────
  fastify.get('/employees/:id/org-context', auth, async (req: any, reply) => {
    const employeeId = (req.params as any).id
    const today      = new Date().toISOString().slice(0, 10)

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const orgCtx = await resolveEmployeeOrgContext(
      fastify.supabase, req.tenantId, employeeId, today,
    )

    // Resolve site name
    type SiteRecord = { id: string; name: string; timezone: string; default_roster_id: string | null }
    let site: SiteRecord | null = null
    if (orgCtx.site_id) {
      const { data: siteRow } = await fastify.supabase
        .from('sites')
        .select('id, name, timezone, default_roster_id')
        .eq('id', orgCtx.site_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (siteRow) site = siteRow as unknown as SiteRecord
    }

    // Resolve roster name (employee's own, or site default)
    const effectiveRosterId = orgCtx.roster_id ?? site?.default_roster_id ?? null
    type RosterRecord = { id: string; name: string; cycle_days: number }
    let   roster: RosterRecord | null = null
    let   rosterSource: 'employee' | 'site' | null = null
    if (effectiveRosterId) {
      const { data: rosterRow } = await fastify.supabase
        .from('rosters')
        .select('id, name, cycle_days')
        .eq('id', effectiveRosterId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (rosterRow) {
        roster       = rosterRow as unknown as RosterRecord
        rosterSource = orgCtx.roster_id ? 'employee' : 'site'
      }
    }

    // Upcoming holidays (next 5 applicable to this employee)
    const futureEnd = new Date()
    futureEnd.setMonth(futureEnd.getMonth() + 3)
    const { data: rawHolidays } = await fastify.supabase
      .from('holiday_calendar')
      .select('date, name, is_optional, site_id, location_id')
      .eq('tenant_id', req.tenantId)
      .gte('date', today)
      .lte('date', futureEnd.toISOString().slice(0, 10))
      .order('date')

    const holidaySet  = getHolidayDates((rawHolidays ?? []) as HolidayRowWithDate[], orgCtx)
    const upcomingHols = (rawHolidays ?? [])
      .filter((h: any) => holidaySet.has(h.date))
      .map((h: any) => ({ date: h.date, name: h.name, is_optional: h.is_optional }))
      .slice(0, 5)

    // Check if assignment came from history or current fields
    const { data: histRow } = await fastify.supabase
      .from('employee_org_assignments')
      .select('id, effective_from, is_current')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)
      .maybeSingle()

    return reply.send({
      data: {
        site,
        roster,
        roster_source:     rosterSource,
        effective_from:    histRow?.effective_from ?? null,
        source:            histRow ? 'history' : 'employee',
        upcoming_holidays: upcomingHols,
      },
    })
  })

  // ── POST /employees/employees/:id/org-context ───────────────────────────────────────
  fastify.post('/employees/:id/org-context', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const employeeId = (req.params as any).id
    const bodySchema = z.object({
      site_id:        z.string().uuid().nullable().optional(),
      roster_id:      z.string().uuid().nullable().optional(),
      effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason:         z.string().max(500).nullable().optional(),
    })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    }

    // Verify employee
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { site_id, roster_id, effective_from, reason } = parsed.data

    // Close the current assignment (if any)
    const prevDay = new Date(`${effective_from}T12:00:00.000Z`)
    prevDay.setUTCDate(prevDay.getUTCDate() - 1)
    await fastify.supabase
      .from('employee_org_assignments')
      .update({ effective_to: prevDay.toISOString().slice(0, 10), is_current: false })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)

    // Insert new assignment
    const { data: newRow, error } = await fastify.supabase
      .from('employee_org_assignments')
      .insert({
        tenant_id:      req.tenantId,
        employee_id:    employeeId,
        site_id:        site_id   ?? null,
        roster_id:      roster_id ?? null,
        effective_from,
        is_current:     true,
        reason:         reason ?? null,
      })
      .select('id, site_id, roster_id, effective_from, is_current')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Mirror to employees table for quick lookups without history join
    await fastify.supabase
      .from('employees')
      .update({ site_id: site_id ?? null, roster_id: roster_id ?? null })
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)

    return reply.code(201).send({ data: newRow })
  })
}
