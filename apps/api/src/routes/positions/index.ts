/**
 * Position Management — /positions  (R7)
 *
 * The sanctioned-strength layer. A "position" is an authorised slot in the org
 * structure (title + designation + grade + department + location), with a
 * sanctioned headcount. This is distinct from:
 *   - designations  (a label pool, not a slot count)
 *   - job_requisitions.openings (how many to hire right now)
 *   - job_history   (who actually occupies a slot)
 *
 * Endpoints:
 *   GET    /positions             list positions + computed filled/vacancy
 *   GET    /positions/summary     PLN.sanction_vs_actual + PLN.vacancy aggregate KPI
 *   GET    /positions/:id/usage   how many requisitions / job_history rows reference it
 *   POST   /positions             create (HR admin)
 *   PUT    /positions/:id         update (HR admin)
 *   DELETE /positions/:id         delete or abolish (HR admin)
 *
 * Reads are open to any authenticated user (dropdowns / analytics); mutations
 * are HR-admin only. Every query is explicitly tenant-scoped (service-role key).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateUniqueCode } from '../../lib/generate-code.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

async function tenantTodayStr(supabase: any, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

const positionSchema = z.object({
  code:             z.string().trim().optional(),
  title:            z.string().min(1),
  designation_id:   z.string().uuid().nullish(),
  grade_id:         z.string().uuid().nullish(),
  department_id:    z.string().uuid().nullish(),
  work_location_id: z.string().uuid().nullish(),
  cost_center_id:   z.string().uuid().nullish(),
  site_id:          z.string().uuid().nullish(),
  sanctioned_count: z.number().int().positive().optional(),
  status:           z.enum(['active', 'frozen', 'abolished']).optional(),
  effective_date:   z.string().optional(),
  notes:            z.string().nullish(),
})

const POSITION_SELECT = `
  id, code, title, sanctioned_count, status, effective_date, abolished_date, notes,
  designation_id, grade_id, department_id, work_location_id, cost_center_id, site_id,
  designations ( id, name ),
  grades ( id, name ),
  departments ( id, name ),
  work_locations ( id, name ),
  sites ( id, name )
`

export default async function positionsRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // Fresh audit finding (cross-tenant IDOR): designation_id/grade_id/
  // department_id/work_location_id/cost_center_id/site_id were inserted/
  // updated with zero tenant check, and POSITION_SELECT's unfiltered FK
  // joins would then echo a foreign tenant's name straight back in the
  // response. Mirrors the validateExpansionFks pattern in masters/sites.ts.
  async function validatePositionFks(
    data: Record<string, any>,
    tenantId: string,
  ): Promise<{ field: string; message: string; queryError?: unknown } | null> {
    const checks: Array<[string, string, string]> = [
      ['designation_id',   'designations',   'Designation'],
      ['grade_id',         'grades',         'Grade'],
      ['department_id',    'departments',    'Department'],
      ['work_location_id', 'work_locations', 'Work location'],
      ['cost_center_id',   'cost_centers',   'Cost center'],
      ['site_id',          'sites',          'Site'],
    ]
    for (const [field, table, label] of checks) {
      const id = data[field]
      if (!id) continue
      const { data: row, error } = await fastify.supabase
        .from(table)
        .select('id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      // A transient query failure must not be reported identically to a
      // genuine missing FK — that would masquerade a DB outage as "this
      // department doesn't exist" and hide the real failure from logs.
      if (error) return { field, message: `Failed to validate ${label.toLowerCase()}`, queryError: error }
      if (!row) return { field, message: `${label} not found in your organisation` }
    }
    return null
  }

  // Count current occupants (is_current job_history rows) per position id.
  // fetchAllRows: total occupants across all positions can exceed the
  // PostgREST 1000-row cap for a large multi-site tenant, silently
  // under-counting filled_count/open_vacancies with no truncation signal.
  async function fillCounts(tenantId: string, positionIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    if (positionIds.length === 0) return out
    const data = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('job_history')
        .select('position_id')
        .eq('tenant_id', tenantId)
        .eq('is_current', true)
        .in('position_id', positionIds)
        .range(from, to),
    )
    for (const row of (data ?? []) as any[]) {
      const pid = row.position_id
      if (pid) out[pid] = (out[pid] ?? 0) + 1
    }
    return out
  }

  // ── List ──────────────────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    // fetchAllRows: sanctioned positions can exceed the PostgREST 1000-row
    // cap for a large multi-site tenant — this list feeds fillCounts() and
    // the per-position open_vacancies/is_overfilled computation below, so a
    // silent truncation here would silently drop positions from the register.
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => {
        let query = fastify.supabase
          .from('positions')
          .select(POSITION_SELECT)
          .eq('tenant_id', tid)
          .order('code')
          .range(from, to) as any
        if (q.status)        query = query.eq('status', q.status)
        if (q.department_id) query = query.eq('department_id', q.department_id)
        if (q.site_id)       query = query.eq('site_id', q.site_id)
        return query
      })
    } catch (error: any) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch positions')
    }

    const filled = await fillCounts(tid, rows.map(r => r.id))

    const data2 = rows.map(r => {
      const filled_count = filled[r.id] ?? 0
      return {
        ...r,
        filled_count,
        open_vacancies: Math.max(r.sanctioned_count - filled_count, 0),
        is_overfilled:  filled_count > r.sanctioned_count,
      }
    })
    return reply.send({ data: data2 })
  })

  // ── Aggregate KPI: sanction vs actual + vacancy (PLN.sanction_vs_actual / PLN.vacancy)
  fastify.get('/summary', auth, async (req: any, reply) => {
    const tid = req.tenantId

    // fetchAllRows: same 1000-row cap risk as GET / above — this feeds the
    // sanctioned_strength/vacancies/fill_rate_pct KPIs, so a silent
    // truncation here would under-report the true tenant-wide vacancy count.
    let positions: any[]
    try {
      positions = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('positions')
          .select('id, sanctioned_count, status, department_id, effective_date, departments(name)')
          .eq('tenant_id', tid)
          .eq('status', 'active')
          .range(from, to),
      )
    } catch (error: any) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch position summary')
    }
    const filled = await fillCounts(tid, positions.map(p => p.id))

    let sanctioned = 0
    let filledTotal = 0
    let openPositions = 0      // positions with at least one vacant seat
    let agedVacancyDays = 0    // sum of age for positions that have any vacancy
    const byDept: Record<string, { department: string; sanctioned: number; filled: number; vacancies: number }> = {}
    // Tenant-local "today", not the server's (UTC) clock — this file already
    // uses tenantTodayStr() for abolished_date below; this KPI was missed.
    const todayMs = Date.parse(`${await tenantTodayStr(fastify.supabase, tid)}T00:00:00Z`)

    for (const p of positions) {
      const f = filled[p.id] ?? 0
      const vac = Math.max(p.sanctioned_count - f, 0)
      sanctioned  += p.sanctioned_count
      filledTotal += Math.min(f, p.sanctioned_count)
      if (vac > 0) {
        openPositions++
        if (p.effective_date) {
          agedVacancyDays += Math.floor((todayMs - new Date(p.effective_date).getTime()) / 86_400_000)
        }
      }
      const dk = p.department_id ?? '__none__'
      if (!byDept[dk]) byDept[dk] = { department: (p.departments as any)?.name ?? 'Unassigned', sanctioned: 0, filled: 0, vacancies: 0 }
      byDept[dk].sanctioned += p.sanctioned_count
      byDept[dk].filled     += Math.min(f, p.sanctioned_count)
      byDept[dk].vacancies  += vac
    }

    const totalVacancies = Math.max(sanctioned - filledTotal, 0)

    return reply.send({
      meta: { generated_at: new Date().toISOString() },
      summary: {
        sanctioned_strength: sanctioned,
        filled:              filledTotal,
        vacancies:           totalVacancies,
        fill_rate_pct:       sanctioned > 0 ? Math.round((filledTotal / sanctioned) * 1000) / 10 : 0,
        open_positions:      openPositions,
        avg_vacancy_age_days: openPositions > 0 ? Math.round(agedVacancyDays / openPositions) : 0,
        position_count:      positions.length,
      },
      by_department: Object.values(byDept).sort((a, b) => b.vacancies - a.vacancies),
    })
  })

  // ── Usage (before delete) ───────────────────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tid = req.tenantId

    const [reqRes, jhRes] = await Promise.all([
      fastify.supabase.from('job_requisitions').select('*', { count: 'exact', head: true })
        .eq('position_id', id).eq('tenant_id', tid),
      fastify.supabase.from('job_history').select('*', { count: 'exact', head: true })
        .eq('position_id', id).eq('tenant_id', tid).eq('is_current', true),
    ])
    if (reqRes.error) return serverError(req, reply, reqRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch position usage')
    if (jhRes.error)  return serverError(req, reply, jhRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch position usage')

    const requisitions = reqRes.count ?? 0
    const occupants    = jhRes.count ?? 0
    return reply.send({ data: { requisitions, occupants, total: requisitions + occupants } })
  })

  // ── Create ──────────────────────────────────────────────────────────────────
  fastify.post('/', hrAdminAuth, async (req: any, reply) => {
    const parsed = positionSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    if (!req.tenantId)   return reply.code(403).send({ error: 'NO_TENANT', message: 'No tenant context' })

    const fkErr = await validatePositionFks(parsed.data, req.tenantId)
    if (fkErr) {
      if (fkErr.queryError) return serverError(req, reply, fkErr.queryError, ErrorCode.QUERY_FAILED, fkErr.message)
      return reply.code(400).send({ error: 'INVALID_REFERENCE', message: fkErr.message, field: fkErr.field })
    }

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'positions', req.tenantId, parsed.data.title)

    const { code: _omit, ...rest } = parsed.data
    const { data, error } = await fastify.supabase
      .from('positions')
      .insert({ ...rest, code, tenant_id: req.tenantId, created_by: req.userId })
      .select().single()

    if (error) {
      req.log.error({ err: error, tenant_id: req.tenantId, code }, 'position create failed')
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: `A position with code "${code}" already exists` })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create position')
    }
    return reply.code(201).send(data)
  })

  // ── Update ──────────────────────────────────────────────────────────────────
  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = positionSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const fkErr = await validatePositionFks(parsed.data, req.tenantId)
    if (fkErr) {
      if (fkErr.queryError) return serverError(req, reply, fkErr.queryError, ErrorCode.QUERY_FAILED, fkErr.message)
      return reply.code(400).send({ error: 'INVALID_REFERENCE', message: fkErr.message, field: fkErr.field })
    }

    const patch: Record<string, any> = { ...parsed.data }
    // Abolishing stamps the date; un-abolishing clears it.
    if (patch.status === 'abolished') patch.abolished_date = await tenantTodayStr(fastify.supabase, req.tenantId)
    else if (patch.status && patch.status !== 'abolished') patch.abolished_date = null

    const { data, error } = await fastify.supabase
      .from('positions').update(patch).eq('id', id).eq('tenant_id', req.tenantId).select().maybeSingle()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'Position code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update position')
    }
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Position not found' })
    return reply.send(data)
  })

  // ── Delete (hard) — refuses if occupied/referenced unless abolish=true ────────
  fastify.delete('/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tid = req.tenantId
    const abolish = (req.body as any)?.abolish === true

    const [reqRes, jhRes] = await Promise.all([
      fastify.supabase.from('job_requisitions').select('*', { count: 'exact', head: true })
        .eq('position_id', id).eq('tenant_id', tid),
      fastify.supabase.from('job_history').select('*', { count: 'exact', head: true })
        .eq('position_id', id).eq('tenant_id', tid).eq('is_current', true),
    ])
    if (reqRes.error) return serverError(req, reply, reqRes.error, ErrorCode.QUERY_FAILED, 'Failed to check position usage')
    if (jhRes.error)  return serverError(req, reply, jhRes.error, ErrorCode.QUERY_FAILED, 'Failed to check position usage')

    const usageCount = (reqRes.count ?? 0) + (jhRes.count ?? 0)

    // Referenced positions are soft-retired (abolished) so history/requisitions
    // keep their FK intact (ON DELETE SET NULL would orphan them otherwise).
    if (usageCount > 0 && !abolish) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: 'Position is referenced by requisitions or current occupants. Pass abolish=true to retire it instead.',
      })
    }

    if (abolish) {
      const { data, error } = await fastify.supabase
        .from('positions')
        .update({ status: 'abolished', abolished_date: await tenantTodayStr(fastify.supabase, tid) })
        .eq('id', id).eq('tenant_id', tid)
        .select('id').maybeSingle()
      if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to abolish position')
      if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Position not found' })
      return reply.code(200).send({ data: { abolished: true } })
    }

    const { data, error } = await fastify.supabase
      .from('positions').delete().eq('id', id).eq('tenant_id', tid).select('id').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete position')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Position not found' })
    return reply.code(204).send()
  })
}
