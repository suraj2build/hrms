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
  getLocalDate,
  type HolidayRowWithDate,
} from '../../lib/org-context.js'
import { fetchTenantTz }  from '../../lib/attendance-engine.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, validationError, ErrorCode } from '../../lib/api-errors.js'

// Resolve "today" in the tenant's own timezone, not the server's (UTC) clock —
// mirrors the same fix applied to tds.ts / it-statement.ts / ytd-statement.ts.
async function tenantTodayStr(fastify: FastifyInstance, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

/** todayStr + N months, as YYYY-MM-DD (pure date arithmetic, no local-TZ constructor). */
function addMonths(todayStr: string, months: number): string {
  const [y, m, d] = todayStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10)
}

export default async function employeeOrgContextRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /employees/employees/:id/org-context ────────────────────────────────────────
  fastify.get('/employees/:id/org-context', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const employeeId = (req.params as any).id
    const today      = await tenantTodayStr(fastify, req.tenantId)

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

    // Resolve rotation policy (employee override → site default)
    const { data: empRow } = await fastify.supabase
      .from('employees')
      .select('rotation_policy_id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    const empRotationId = (empRow as any)?.rotation_policy_id ?? null
    const { data: siteRotRow } = orgCtx.site_id
      ? await fastify.supabase.from('sites').select('default_rotation_policy_id').eq('id', orgCtx.site_id).maybeSingle()
      : { data: null as any }
    const siteRotationId = (siteRotRow as any)?.default_rotation_policy_id ?? null
    const effectiveRotationId = empRotationId ?? siteRotationId
    let   rotation_policy: { id: string; name: string } | null = null
    let   rotation_source: 'employee' | 'site' | null = null
    if (effectiveRotationId) {
      const { data: rp } = await fastify.supabase
        .from('rotation_policies')
        .select('id, name')
        .eq('id', effectiveRotationId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (rp) {
        rotation_policy = rp as any
        rotation_source = empRotationId ? 'employee' : 'site'
      }
    }

    // Upcoming holidays (next 5 applicable to this employee)
    const futureEnd = addMonths(today, 3)
    const { data: rawHolidays } = await fastify.supabase
      .from('holiday_calendar')
      .select('date, name, is_optional, site_id, location_id')
      .eq('tenant_id', req.tenantId)
      .gte('date', today)
      .lte('date', futureEnd)
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
        roster_source:        rosterSource,
        rotation_policy,
        rotation_source,
        rotation_policy_id:   empRotationId,   // employee's own override (null = inherit site default)
        effective_from:       histRow?.effective_from ?? null,
        source:               histRow ? 'history' : 'employee',
        upcoming_holidays:    upcomingHols,
      },
    })
  })

  // ── POST /employees/employees/:id/org-context ───────────────────────────────────────
  fastify.post('/employees/:id/org-context', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const employeeId = (req.params as any).id
    const bodySchema = z.object({
      site_id:            z.string().uuid().nullable().optional(),
      roster_id:          z.string().uuid().nullable().optional(),
      rotation_policy_id: z.string().uuid().nullable().optional(),
      effective_from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason:             z.string().max(500).nullable().optional(),
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

    const { site_id, roster_id, rotation_policy_id, effective_from, reason } = parsed.data

    // Cross-tenant IDOR guard: site_id/roster_id/rotation_policy_id are plain FKs
    // with no tenant condition — without this check an hr_admin could point an
    // employee's assignment at another tenant's site/roster/rotation policy
    // (which then leaks cross-tenant names via the GET handler and, for site_id,
    // via bank-statutory.ts's site_state_code lookup).
    const fkChecks: Array<[string | null | undefined, string, string]> = [
      [site_id,            'sites',             'Site'],
      [roster_id,           'rosters',           'Roster'],
      [rotation_policy_id,  'rotation_policies', 'Rotation policy'],
    ]
    for (const [fkId, table, label] of fkChecks) {
      if (!fkId) continue
      const { data: fkRow } = await fastify.supabase
        .from(table)
        .select('id')
        .eq('id', fkId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!fkRow) return validationError(reply, ErrorCode.VALIDATION_ERROR, `${label} not found in your organisation`)
    }

    // Close the current assignment(s). A single unique "one current" index means
    // any leftover is_current row would block the insert below — so closing must
    // succeed. Set effective_to to the day before the new effective_from (but
    // never after it, for a same-day re-edit).
    const prevDay = new Date(`${effective_from}T12:00:00.000Z`)
    prevDay.setUTCDate(prevDay.getUTCDate() - 1)
    const closeTo = prevDay.toISOString().slice(0, 10)
    const { error: closeErr } = await fastify.supabase
      .from('employee_org_assignments')
      .update({ effective_to: closeTo, is_current: false })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)
    if (closeErr) return serverError(req, reply, closeErr, ErrorCode.UPDATE_FAILED, 'Could not close previous assignment')

    const newAssignment = {
      tenant_id:   req.tenantId,
      employee_id: employeeId,
      site_id:     site_id   ?? null,
      roster_id:   roster_id ?? null,
      effective_from,
      is_current:  true,
      reason:      reason    ?? null,
    }

    // Insert new assignment; if a stale is_current row still blocks the unique
    // index (23505), hard-close every current row and retry once.
    let { data: newRow, error } = await fastify.supabase
      .from('employee_org_assignments')
      .insert(newAssignment)
      .select('id, site_id, roster_id, effective_from, is_current')
      .single()

    if (error && (error as any).code === '23505') {
      await fastify.supabase
        .from('employee_org_assignments')
        .update({ is_current: false })
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('is_current', true)
      ;({ data: newRow, error } = await fastify.supabase
        .from('employee_org_assignments')
        .insert(newAssignment)
        .select('id, site_id, roster_id, effective_from, is_current')
        .single())
    }

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create org context assignment')

    // Mirror site + roster to employees table for quick lookups (core columns —
    // always present). Must not be coupled with rotation_policy_id, whose column
    // may be absent on un-migrated environments; a failure there must not block
    // the site/roster save.
    const { error: mirrorErr } = await fastify.supabase
      .from('employees')
      .update({ site_id: site_id ?? null, roster_id: roster_id ?? null })
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
    if (mirrorErr) return serverError(req, reply, mirrorErr, ErrorCode.UPDATE_FAILED, 'Failed to sync site/roster to employee record')

    // Rotation policy — separate, best-effort. undefined = leave as-is;
    // null = clear (inherit site default). If the column doesn't exist on this
    // environment, log and continue rather than failing the whole assignment.
    if (rotation_policy_id !== undefined) {
      const { error: rotErr } = await fastify.supabase
        .from('employees')
        .update({ rotation_policy_id: rotation_policy_id ?? null })
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
      if (rotErr) {
        req.log.warn({ err: rotErr, employeeId }, 'org-context: rotation_policy_id update failed (column may be missing — run migration)')
      }
    }

    // NOTE: Work Location & Cost Center are intentionally NOT handled here.
    // They live on job_history and are managed solely by the Job Details editor
    // (POST /job-history). Org-context owns only site / roster / rotation — this
    // single-writer split removes the previous two-route duplication where the
    // same job fields could be written (and silently cleared) from two places.

    return reply.code(201).send({ data: newRow })
  })
}
