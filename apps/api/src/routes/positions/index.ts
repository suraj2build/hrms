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
  ): Promise<{ field: string; message: string } | null> {
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
      const { data: row } = await fastify.supabase
        .from(table)
        .select('id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!row) return { field, message: `${label} not found in your organisation` }
    }
    return null
  }

  // Count current occupants (is_current job_history rows) per position id.
  async function fillCounts(tenantId: string, positionIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    if (positionIds.length === 0) return out
    const { data } = await fastify.supabase
      .from('job_history')
      .select('position_id')
      .eq('tenant_id', tenantId)
      .eq('is_current', true)
      .in('position_id', positionIds)
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

    let query = fastify.supabase
      .from('positions')
      .select(POSITION_SELECT)
      .eq('tenant_id', tid)
      .order('code') as any

    if (q.status)        query = query.eq('status', q.status)
    if (q.department_id) query = query.eq('department_id', q.department_id)
    if (q.site_id)       query = query.eq('site_id', q.site_id)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = (data ?? []) as any[]
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

    const { data: posData, error } = await fastify.supabase
      .from('positions')
      .select('id, sanctioned_count, status, department_id, effective_date, departments(name)')
      .eq('tenant_id', tid)
      .eq('status', 'active')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const positions = (posData ?? []) as any[]
    const filled = await fillCounts(tid, positions.map(p => p.id))

    let sanctioned = 0
    let filledTotal = 0
    let openPositions = 0      // positions with at least one vacant seat
    let agedVacancyDays = 0    // sum of age for positions that have any vacancy
    const byDept: Record<string, { department: string; sanctioned: number; filled: number; vacancies: number }> = {}
    const today = new Date()

    for (const p of positions) {
      const f = filled[p.id] ?? 0
      const vac = Math.max(p.sanctioned_count - f, 0)
      sanctioned  += p.sanctioned_count
      filledTotal += Math.min(f, p.sanctioned_count)
      if (vac > 0) {
        openPositions++
        if (p.effective_date) {
          agedVacancyDays += Math.floor((today.getTime() - new Date(p.effective_date).getTime()) / 86_400_000)
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
    if (reqRes.error) return reply.code(500).send({ error: 'DB_ERROR', message: reqRes.error.message })
    if (jhRes.error)  return reply.code(500).send({ error: 'DB_ERROR', message: jhRes.error.message })

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
    if (fkErr) return reply.code(400).send({ error: 'INVALID_REFERENCE', message: fkErr.message, field: fkErr.field })

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
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send(data)
  })

  // ── Update ──────────────────────────────────────────────────────────────────
  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = positionSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })

    const fkErr = await validatePositionFks(parsed.data, req.tenantId)
    if (fkErr) return reply.code(400).send({ error: 'INVALID_REFERENCE', message: fkErr.message, field: fkErr.field })

    const patch: Record<string, any> = { ...parsed.data }
    // Abolishing stamps the date; un-abolishing clears it.
    if (patch.status === 'abolished') patch.abolished_date = new Date().toISOString().slice(0, 10)
    else if (patch.status && patch.status !== 'abolished') patch.abolished_date = null

    const { data, error } = await fastify.supabase
      .from('positions').update(patch).eq('id', id).eq('tenant_id', req.tenantId).select().single()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'Position code already exists' })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
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
    if (reqRes.error) return reply.code(500).send({ error: 'DB_ERROR', message: reqRes.error.message })
    if (jhRes.error)  return reply.code(500).send({ error: 'DB_ERROR', message: jhRes.error.message })

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
      const { error } = await fastify.supabase
        .from('positions')
        .update({ status: 'abolished', abolished_date: new Date().toISOString().slice(0, 10) })
        .eq('id', id).eq('tenant_id', tid)
      if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      return reply.code(200).send({ data: { abolished: true } })
    }

    const { error } = await fastify.supabase
      .from('positions').delete().eq('id', id).eq('tenant_id', tid)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
