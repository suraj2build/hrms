/**
 * Rosters CRUD — /masters/rosters
 *
 * A "roster policy" is a named weekly-off governance policy stored as a
 * 7-Day × 5-Week matrix (which occurrence of each day of week is off/working/half-day).
 *
 * GET    /masters/rosters              — list all policies (with impact counts)
 * GET    /masters/rosters/:id          — single policy (full detail)
 * POST   /masters/rosters              — create policy   (hr_admin / super_admin)
 * PUT    /masters/rosters/:id          — update policy   (hr_admin / super_admin)
 * DELETE /masters/rosters/:id          — delete policy   (hr_admin / super_admin)
 * GET    /masters/rosters/:id/impact   — site + employee counts
 * POST   /masters/rosters/:id/duplicate — clone a policy
 *
 * pattern_json schema (JSONB):
 * {
 *   "weekly_off_days": [0, 6],          -- legacy DOW ints: 0=Sun…6=Sat (backward compat)
 *   "matrix": {                          -- 5-week × 7-day grid (primary source of truth)
 *     "week1": { "mon": "working", "tue": "working", "sat": "off", "sun": "off", ... },
 *     "week2": { ... },
 *     "week3": { ... },
 *     "week4": { ... },
 *     "week5": { ... }
 *   },
 *   "shift_pattern": [...]               -- optional legacy per-cycle-day shift
 * }
 *
 * weekly_off_days is auto-computed from the matrix on save (union of "off" cells across
 * all weeks) for backward compatibility with the attendance and leave engines.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { generateUniqueCode }   from '../../lib/generate-code.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows }   from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Schemas ───────────────────────────────────────────────────────────────────

const weeklyOffDaySchema = z.number().int().min(0).max(6)

const shiftPatternEntrySchema = z.object({
  cycle_day:  z.number().int().min(0),
  shift_code: z.string().min(1),
})

const dayStateSchema = z.enum(['working', 'off', 'half_day'])

const weekRowSchema = z.object({
  mon: dayStateSchema,
  tue: dayStateSchema,
  wed: dayStateSchema,
  thu: dayStateSchema,
  fri: dayStateSchema,
  sat: dayStateSchema,
  sun: dayStateSchema,
})

const matrixSchema = z.object({
  week1: weekRowSchema,
  week2: weekRowSchema,
  week3: weekRowSchema,
  week4: weekRowSchema,
  week5: weekRowSchema,
})

const patternJsonSchema = z.object({
  weekly_off_days: z.array(weeklyOffDaySchema).default([]),
  matrix:          matrixSchema.optional(),
  shift_pattern:   z.array(shiftPatternEntrySchema).optional(),
})

const schema = z.object({
  name:         z.string().min(1, 'Name is required').max(120),
  description:  z.string().max(500).optional().nullable(),
  code:         z.string().min(1).max(20).optional().nullable(),
  cycle_days:   z.union([z.literal(7), z.literal(14), z.literal(28)]).default(7),
  pattern_json: patternJsonSchema.default({ weekly_off_days: [] }),
  is_active:    z.boolean().optional(),
  // WO-credit (retail floating weekly-off): tag this roster with a structure.
  // Null = normal fixed-weekly-off roster.
  wo_credit_structure_id: z.string().uuid().optional().nullable(),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const SELECT_COLS = 'id, name, code, description, cycle_days, pattern_json, is_active, wo_credit_structure_id, created_at, updated_at'

const DOW_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/**
 * Derives legacy weekly_off_days from the new 5-week matrix.
 * A DOW is included if it is "off" in ANY of the 5 weeks.
 * This ensures the existing attendance engine still gets a reasonable weekly-off list.
 */
function deriveWeeklyOffDays(matrix: z.infer<typeof matrixSchema>): number[] {
  const offSet = new Set<number>()
  const weeks = [matrix.week1, matrix.week2, matrix.week3, matrix.week4, matrix.week5]
  for (const week of weeks) {
    for (const [day, state] of Object.entries(week)) {
      if (state === 'off') {
        const dow = DOW_MAP[day]
        if (dow !== undefined) offSet.add(dow)
      }
    }
  }
  return [...offSet].sort((a, b) => a - b)
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function rostersRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          return reply.code(403).send({
            error:   'FORBIDDEN',
            message: 'HR admin access required',
          })
        }
      },
    ],
  }

  // ── GET /masters/rosters ──────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('rosters')
      .select(SELECT_COLS)
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch roster policies')
    }

    const rosters = data ?? []

    // ── Attach impact counts (sites assigned, employees assigned) ──────────
    if (rosters.length > 0) {
      const rosterIds = rosters.map((r: any) => r.id)

      // Paginated — these feed the employee_count/site_count badges shown for
      // every roster; an unbounded scan would silently undercount for a
      // tenant with more than 1000 matching sites/employees.
      const [sites, employees] = await Promise.all([
        fetchAllRows<{ default_roster_id: string | null }>((from, to) =>
          fastify.supabase
            .from('sites')
            .select('default_roster_id')
            .eq('tenant_id', req.tenantId)
            .in('default_roster_id', rosterIds)
            .range(from, to),
        ),
        fetchAllRows<{ roster_id: string | null }>((from, to) =>
          fastify.supabase
            .from('employees')
            .select('roster_id')
            .eq('tenant_id', req.tenantId)
            .in('roster_id', rosterIds)
            .eq('status', 'active')
            .range(from, to),
        ),
      ])

      const siteCountMap:     Record<string, number> = {}
      const employeeCountMap: Record<string, number> = {}

      for (const s of (sites ?? [])) {
        if (s.default_roster_id) {
          siteCountMap[s.default_roster_id] = (siteCountMap[s.default_roster_id] ?? 0) + 1
        }
      }
      for (const e of (employees ?? [])) {
        if (e.roster_id) {
          employeeCountMap[e.roster_id] = (employeeCountMap[e.roster_id] ?? 0) + 1
        }
      }

      return reply.send({
        data: rosters.map((r: any) => ({
          ...r,
          site_count:     siteCountMap[r.id]     ?? 0,
          employee_count: employeeCountMap[r.id] ?? 0,
        })),
      })
    }

    return reply.send({ data: rosters })
  })

  // ── GET /masters/rosters/:id ──────────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('rosters')
      .select(SELECT_COLS)
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Roster policy not found' })
    }

    return reply.send({ data })
  })

  // ── POST /masters/rosters ─────────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0]?.message,
      })
    }

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'rosters', req.tenantId, parsed.data.name)

    const payload = { ...parsed.data, code, tenant_id: req.tenantId }

    // Derive weekly_off_days from matrix when provided
    if (payload.pattern_json.matrix) {
      payload.pattern_json.weekly_off_days = deriveWeeklyOffDays(payload.pattern_json.matrix)
    }

    const { data, error } = await fastify.supabase
      .from('rosters')
      .insert(payload)
      .select(SELECT_COLS)
      .single()

    if (error) {
      if (error.code === '23505') {
        const field = error.message?.includes('uq_rosters_tenant_code') ? 'code' : 'name'
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: field === 'code'
            ? `A roster policy with code "${parsed.data.code}" already exists`
            : `A roster policy named "${parsed.data.name}" already exists`,
        })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create roster policy')
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/rosters/:id ──────────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0]?.message,
      })
    }

    const payload: Record<string, unknown> = { ...parsed.data }

    // Derive weekly_off_days from matrix when provided
    if (payload.pattern_json && (payload.pattern_json as any).matrix) {
      ;(payload.pattern_json as any).weekly_off_days = deriveWeeklyOffDays(
        (payload.pattern_json as any).matrix,
      )
    }

    const { data, error } = await fastify.supabase
      .from('rosters')
      .update(payload)
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)
      .select(SELECT_COLS)
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update roster policy')
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Roster policy not found' })
    }

    return reply.send({ data })
  })

  // ── DELETE /masters/rosters/:id ───────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const rosterId = (req.params as any).id

    // Safety check — both FKs are ON DELETE SET NULL (060_employee_site_roster.sql,
    // 061_sites_default_roster.sql), so an unguarded delete would silently strip
    // roster_id off every assigned employee and default_roster_id off every site
    // that uses this as its default, with no warning. Refuse if referenced,
    // matching the sibling rotation-policies.ts DELETE guard.
    const { count: empCount, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('roster_id', rosterId)
      .eq('tenant_id', req.tenantId)
    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to check roster usage')

    const { count: siteCount, error: siteErr } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('default_roster_id', rosterId)
      .eq('tenant_id', req.tenantId)
    if (siteErr) return serverError(req, reply, siteErr, ErrorCode.QUERY_FAILED, 'Failed to check roster usage')

    const totalRefs = (empCount ?? 0) + (siteCount ?? 0)
    if (totalRefs > 0) {
      return reply.code(409).send({
        error: 'REFERENCED',
        message: `Roster policy is used by ${empCount ?? 0} employee(s) and ${siteCount ?? 0} site(s). Unassign them first.`,
      })
    }

    const { error } = await fastify.supabase
      .from('rosters')
      .delete()
      .eq('id', rosterId)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete roster policy')
    }
    return reply.code(204).send()
  })

  // ── GET /masters/rosters/:id/impact ──────────────────────────────────────
  fastify.get('/:id/impact', adminAuth, async (req: any, reply) => {
    const rosterId  = (req.params as any).id

    // Paginated — a widely-used roster (e.g. the standard shift) can plausibly
    // be assigned to well over 1000 employees in an enterprise tenant. An
    // unbounded scan would understate the true impact list before an HR
    // admin edits/deletes this roster.
    let sites: any[]
    let directEmployees: any[]
    try {
      ;[sites, directEmployees] = await Promise.all([
        fetchAllRows<any>((from, to) =>
          fastify.supabase
            .from('sites')
            .select('id, name, code')
            .eq('tenant_id', req.tenantId)
            .eq('default_roster_id', rosterId)
            .range(from, to),
        ),
        fetchAllRows<any>((from, to) =>
          fastify.supabase
            .from('employees')
            .select('id, first_name, last_name, employee_code')
            .eq('tenant_id', req.tenantId)
            .eq('roster_id', rosterId)
            .eq('status', 'active')
            .range(from, to),
        ),
      ])
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch roster policy impact')
    }

    const siteIds = sites.map((s: any) => s.id)
    let inheritedCount = 0

    if (siteIds.length > 0) {
      const { count } = await fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active')
        .in('site_id', siteIds)
        .is('roster_id', null)  // no direct override — inherits site default

      inheritedCount = count ?? 0
    }

    return reply.send({
      data: {
        site_count:               sites.length,
        direct_employee_count:    directEmployees.length,
        inherited_employee_count: inheritedCount,
        total_employee_count:     directEmployees.length + inheritedCount,
        sites,
        direct_employees:         directEmployees,
      },
    })
  })

  // ── POST /masters/rosters/:id/duplicate ──────────────────────────────────
  fastify.post('/:id/duplicate', adminAuth, async (req: any, reply) => {
    const rosterId = (req.params as any).id

    // Fetch the source roster
    const { data: source, error: fetchErr } = await fastify.supabase
      .from('rosters')
      .select(SELECT_COLS)
      .eq('id', rosterId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !source) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Source roster policy not found' })
    }

    // Generate a unique name by appending "(Copy)" and a suffix if needed
    let newName = `${source.name} (Copy)`
    let suffix  = 1
    while (true) {
      const { data: existing } = await fastify.supabase
        .from('rosters')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .eq('name', newName)
        .single()

      if (!existing) break
      suffix++
      newName = `${source.name} (Copy ${suffix})`
    }

    const { data: newRoster, error: insertErr } = await fastify.supabase
      .from('rosters')
      .insert({
        tenant_id:    req.tenantId,
        name:         newName,
        code:         null,           // code must be unique — clear on copy
        description:  source.description ? `Copy of: ${source.description}` : null,
        cycle_days:   source.cycle_days,
        pattern_json: source.pattern_json,
        is_active:    true,
      })
      .select(SELECT_COLS)
      .single()

    if (insertErr) {
      return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to duplicate roster policy')
    }

    return reply.code(201).send({ data: newRoster })
  })
}
