/**
 * Recognition & Rewards routes — ESS 2.0 "Rewards" pillar (first slice).
 *
 *   GET  /recognition/badges  — active badge catalogue (auto-seeded per tenant)
 *   GET  /recognition/feed    — recent public recognition (company feed)
 *   GET  /recognition/me      — the caller's received/given summary + recent
 *   POST /recognition         — give recognition to a colleague
 *
 * Tenant scoping is enforced in code on every query (service-role bypasses RLS).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

const DEFAULT_BADGES = [
  { code: 'ownership_champion', label: 'Ownership Champion', icon: 'Award',     description: 'Takes end-to-end ownership',          points: 15 },
  { code: 'customer_hero',      label: 'Customer Hero',      icon: 'Heart',     description: 'Goes above and beyond for customers', points: 15 },
  { code: 'team_player',        label: 'Team Player',        icon: 'Users',     description: 'Lifts the whole team',                points: 10 },
  { code: 'innovator',          label: 'Innovator',          icon: 'Lightbulb', description: 'Brings new ideas to life',            points: 15 },
  { code: 'problem_solver',     label: 'Problem Solver',     icon: 'Wrench',    description: 'Cracks the hard problems',            points: 10 },
  { code: 'culture_ambassador', label: 'Culture Ambassador', icon: 'Sparkles',  description: 'Lives our values every day',          points: 10 },
]

const DEFAULT_MONTHLY_BUDGET = 100

async function resolveEmployeeId(fastify: FastifyInstance, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles').select('employee_id')
    .eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  return (data as { employee_id: string | null } | null)?.employee_id ?? null
}

/** First day of the current month (UTC), ISO — the budget period boundary. */
function startOfMonthISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** ISO start of a named period, or null for all-time. */
function periodStartISO(period: string): string | null {
  const now = new Date()
  switch (period) {
    case 'monthly':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    case 'quarterly': {
      const qMonth = Math.floor(now.getUTCMonth() / 3) * 3
      return new Date(Date.UTC(now.getUTCFullYear(), qMonth, 1)).toISOString()
    }
    case 'ytd':
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
    default:
      return null
  }
}

/** ISO string for N days ago (UTC). */
function daysAgoISO(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString()
}

/**
 * A giver's monthly points budget: the tenant's configured allowance, how many
 * points they've already spent this calendar month, and what remains.
 */
async function computeBudget(
  fastify: FastifyInstance, tenantId: string, employeeId: string,
): Promise<{ monthly: number; spent: number; remaining: number }> {
  const [budgetRes, spentRes] = await Promise.all([
    fastify.supabase
      .from('recognition_budgets').select('monthly_points')
      .eq('tenant_id', tenantId).maybeSingle(),
    fastify.supabase
      .from('recognition').select('points')
      .eq('tenant_id', tenantId).eq('from_employee', employeeId)
      .gte('created_at', startOfMonthISO()),
  ])
  const monthly = (budgetRes.data as { monthly_points?: number } | null)?.monthly_points ?? DEFAULT_MONTHLY_BUDGET
  const spent   = ((spentRes.data ?? []) as any[]).reduce((s, r) => s + (r.points ?? 0), 0)
  return { monthly, spent, remaining: Math.max(0, monthly - spent) }
}

// Provision the default badge set for a tenant that has none yet (covers tenants
// created after migration 306's one-time seed).
async function ensureDefaultBadges(fastify: FastifyInstance, tenantId: string): Promise<void> {
  const { count } = await fastify.supabase
    .from('recognition_badges').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  if ((count ?? 0) > 0) return
  await fastify.supabase
    .from('recognition_badges')
    .insert(DEFAULT_BADGES.map(b => ({ ...b, tenant_id: tenantId })))
}

// Attach human-readable names to recognition rows (two FKs to employees, so we
// resolve names with a single id→name map rather than ambiguous FK joins).
async function enrich(fastify: FastifyInstance, tenantId: string, rows: any[]): Promise<any[]> {
  const ids = [...new Set(rows.flatMap(r => [r.from_employee, r.to_employee].filter(Boolean)))]
  if (!ids.length) return rows
  const { data: emps } = await fastify.supabase
    .from('employees').select('id, first_name, last_name, employee_code')
    .eq('tenant_id', tenantId).in('id', ids)
  const m = new Map((emps ?? []).map((e: any) => [e.id, e]))
  const nameOf = (id: string | null | undefined) => {
    if (!id) return undefined
    const e = m.get(id)
    return e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : undefined
  }
  return rows.map(r => ({ ...r, from_name: nameOf(r.from_employee), to_name: nameOf(r.to_employee) }))
}

export default async function recognitionRoutes(fastify: FastifyInstance) {
  const auth   = { preHandler: [fastify.authenticate] }
  const hrAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /recognition/badges ─────────────────────────────────────────────────
  fastify.get('/recognition/badges', auth, async (req: any, reply) => {
    await ensureDefaultBadges(fastify, req.tenantId)
    const { data, error } = await fastify.supabase
      .from('recognition_badges')
      .select('code, label, icon, description, points')
      .eq('tenant_id', req.tenantId).eq('is_active', true)
      .order('label', { ascending: true })
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load badges' })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /recognition/feed ───────────────────────────────────────────────────
  fastify.get('/recognition/feed', auth, async (req: any, reply) => {
    const limit = Math.min(50, Math.max(1, Number((req.query as any).limit) || 20))
    const { data: rows, error } = await fastify.supabase
      .from('recognition')
      .select('id, from_employee, to_employee, badge_code, message, points, created_at')
      .eq('tenant_id', req.tenantId).eq('visibility', 'public')
      .order('created_at', { ascending: false }).limit(limit)
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load feed' })
    return reply.send({ data: await enrich(fastify, req.tenantId, rows ?? []) })
  })

  // ── GET /recognition/me ─────────────────────────────────────────────────────
  fastify.get('/recognition/me', auth, async (req: any, reply) => {
    const employeeId = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.send({ data: { received: 0, given: 0, points: 0, recent: [], budget: { monthly: DEFAULT_MONTHLY_BUDGET, spent: 0, remaining: DEFAULT_MONTHLY_BUDGET } } })

    const [recvRes, giveRes, budget] = await Promise.all([
      fastify.supabase
        .from('recognition')
        .select('id, from_employee, to_employee, badge_code, message, points, created_at')
        .eq('tenant_id', req.tenantId).eq('to_employee', employeeId)
        .order('created_at', { ascending: false }).limit(20),
      fastify.supabase
        .from('recognition').select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId).eq('from_employee', employeeId),
      computeBudget(fastify, req.tenantId, employeeId),
    ])

    const received = recvRes.data ?? []
    const points   = received.reduce((s: number, r: any) => s + (r.points ?? 0), 0)
    return reply.send({
      data: {
        received: received.length,
        given:    giveRes.count ?? 0,
        points,
        recent:   await enrich(fastify, req.tenantId, received),
        budget,
      },
    })
  })

  // ── GET /recognition/leaderboard ────────────────────────────────────────────
  fastify.get('/recognition/leaderboard', auth, async (req: any, reply) => {
    const period   = (req.query as any).period ?? 'all'
    const since    = periodStartISO(period)
    let q = fastify.supabase
      .from('recognition').select('to_employee, points')
      .eq('tenant_id', req.tenantId)
    if (since) q = q.gte('created_at', since)
    const { data: rows, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load leaderboard' })

    const agg = new Map<string, { points: number; count: number }>()
    for (const r of (rows ?? []) as any[]) {
      const cur = agg.get(r.to_employee) ?? { points: 0, count: 0 }
      cur.points += r.points ?? 0
      cur.count  += 1
      agg.set(r.to_employee, cur)
    }
    const top = [...agg.entries()]
      .sort((a, b) => b[1].points - a[1].points || b[1].count - a[1].count)
      .slice(0, 10)

    const { data: emps } = top.length
      ? await fastify.supabase.from('employees').select('id, first_name, last_name')
          .eq('tenant_id', req.tenantId).in('id', top.map(([id]) => id))
      : { data: [] as any[] }
    const nameMap = new Map((emps ?? []).map((e: any) => [e.id, `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()]))

    const data = top.map(([id, v], i) => ({
      rank: i + 1, employee_id: id, name: nameMap.get(id) ?? 'Unknown', points: v.points, count: v.count,
    }))
    return reply.send({ data })
  })

  // ── POST /recognition ───────────────────────────────────────────────────────
  fastify.post('/recognition', auth, async (req: any, reply) => {
    const schema = z.object({
      to_employee: z.string().uuid(),
      badge_code:  z.string().min(1).optional(),
      message:     z.string().min(1).max(500),
      visibility:  z.enum(['public', 'private']).default('public'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const fromEmployee = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    if (!fromEmployee) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Your account is not linked to an employee record' })
    if (fromEmployee === parsed.data.to_employee) return reply.code(400).send({ error: 'SELF_RECOGNITION', message: 'You cannot recognize yourself' })

    // Recipient must belong to the same tenant.
    const { data: recipient } = await fastify.supabase
      .from('employees').select('id, first_name, last_name')
      .eq('id', parsed.data.to_employee).eq('tenant_id', req.tenantId).maybeSingle()
    if (!recipient) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Recipient not found' })

    // Points + label come from the chosen badge (server-resolved, never trusted from client).
    let points = 0
    let badgeLabel: string | null = null
    if (parsed.data.badge_code) {
      const { data: badge } = await fastify.supabase
        .from('recognition_badges').select('points, label')
        .eq('tenant_id', req.tenantId).eq('code', parsed.data.badge_code).maybeSingle()
      points     = (badge as { points?: number } | null)?.points ?? 0
      badgeLabel = (badge as { label?: string } | null)?.label ?? null
    }

    // Anti-gaming: a points-bearing badge must fit the giver's remaining monthly
    // budget. A message-only kudos (0 points) is always allowed.
    if (points > 0) {
      const budget = await computeBudget(fastify, req.tenantId, fromEmployee)
      if (points > budget.remaining) {
        return reply.code(400).send({
          error:   'BUDGET_EXCEEDED',
          message: `This badge costs ${points} pts but you have only ${budget.remaining} of ${budget.monthly} left this month. Try a lower-point badge or a message-only kudos.`,
        })
      }
    }

    const { data, error } = await fastify.supabase
      .from('recognition')
      .insert({
        tenant_id:     req.tenantId,
        from_employee: fromEmployee,
        to_employee:   parsed.data.to_employee,
        badge_code:    parsed.data.badge_code ?? null,
        message:       parsed.data.message,
        points,
        visibility:    parsed.data.visibility,
      })
      .select('id')
      .single()
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to record recognition' })

    // Public recognition also flows into the Community feed (blueprint intent).
    // Best-effort: a feed failure must not fail the recognition itself.
    if (parsed.data.visibility === 'public') {
      const toName = `${(recipient as any).first_name ?? ''} ${(recipient as any).last_name ?? ''}`.trim() || 'a colleague'
      await fastify.supabase.from('feed_posts').insert({
        tenant_id:       req.tenantId,
        author_employee: fromEmployee,
        type:            'recognition',
        title:           badgeLabel,
        body:            `👏 Recognized ${toName}${parsed.data.message ? ` — ${parsed.data.message}` : ''}`,
      }).then(undefined, () => { /* feed best-effort */ })
    }

    return reply.code(201).send({ data })
  })

  // ── Admin: analytics dashboard ─────────────────────────────────────────────

  fastify.get('/recognition/admin/analytics', hrAuth, async (req: any, reply) => {
    const since30d = daysAgoISO(30)
    const since7d  = daysAgoISO(7)

    const [all30, all7, budget] = await Promise.all([
      fastify.supabase
        .from('recognition')
        .select('from_employee, to_employee, points, created_at')
        .eq('tenant_id', req.tenantId)
        .gte('created_at', since30d),
      fastify.supabase
        .from('recognition')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', since7d),
      fastify.supabase
        .from('recognition_budgets')
        .select('monthly_points')
        .eq('tenant_id', req.tenantId)
        .maybeSingle(),
    ])

    const rows30  = (all30.data ?? []) as any[]
    const total7d = all7.count ?? 0

    // 30-day daily trend
    const trendMap: Record<string, number> = {}
    for (const r of rows30) {
      const day = (r.created_at as string).slice(0, 10)
      trendMap[day] = (trendMap[day] ?? 0) + 1
    }
    const trend: { date: string; count: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - i)
      const date = d.toISOString().slice(0, 10)
      trend.push({ date, count: trendMap[date] ?? 0 })
    }

    // Top givers (30d)
    const giverMap = new Map<string, { points: number; count: number }>()
    const receiverMap = new Map<string, { points: number; count: number }>()
    for (const r of rows30) {
      const g = giverMap.get(r.from_employee) ?? { points: 0, count: 0 }
      g.points += r.points ?? 0; g.count++
      giverMap.set(r.from_employee, g)

      const rv = receiverMap.get(r.to_employee) ?? { points: 0, count: 0 }
      rv.points += r.points ?? 0; rv.count++
      receiverMap.set(r.to_employee, rv)
    }
    const topGiverIds    = [...giverMap.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 5).map(([id]) => id)
    const topReceiverIds = [...receiverMap.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 5).map(([id]) => id)
    const allIds = [...new Set([...topGiverIds, ...topReceiverIds])]

    const { data: emps } = allIds.length
      ? await fastify.supabase.from('employees').select('id, first_name, last_name').eq('tenant_id', req.tenantId).in('id', allIds)
      : { data: [] as any[] }
    const nameMap = new Map((emps ?? []).map((e: any) => [e.id, `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()]))

    const topGivers    = topGiverIds.map(id => ({ employee_id: id, name: nameMap.get(id) ?? 'Unknown', ...giverMap.get(id)! }))
    const topReceivers = topReceiverIds.map(id => ({ employee_id: id, name: nameMap.get(id) ?? 'Unknown', ...receiverMap.get(id)! }))

    return reply.send({
      data: {
        total_30d:         rows30.length,
        total_7d:          total7d,
        unique_givers_30d: giverMap.size,
        unique_receivers_30d: receiverMap.size,
        monthly_budget:    (budget.data as any)?.monthly_points ?? DEFAULT_MONTHLY_BUDGET,
        trend,
        top_givers:    topGivers,
        top_receivers: topReceivers,
      },
    })
  })

  // ── Admin: badge management ────────────────────────────────────────────────

  fastify.get('/recognition/admin/badges', hrAuth, async (req: any, reply) => {
    await ensureDefaultBadges(fastify, req.tenantId)
    const { data, error } = await fastify.supabase
      .from('recognition_badges')
      .select('code, label, icon, description, points, is_active')
      .eq('tenant_id', req.tenantId)
      .order('label')
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load badges' })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/recognition/admin/badges', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      code:        z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
      label:       z.string().min(1).max(100),
      description: z.string().max(300).optional(),
      icon:        z.string().max(50).default('Award'),
      points:      z.number().int().min(0).max(500),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('recognition_badges')
      .insert({ ...parsed.data, tenant_id: req.tenantId, is_active: true })

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data: { ok: true } })
  })

  fastify.patch('/recognition/admin/badges/:code', hrAuth, async (req: any, reply) => {
    const { code } = req.params as { code: string }
    const schema = z.object({
      label:       z.string().min(1).max(100).optional(),
      description: z.string().max(300).optional(),
      icon:        z.string().max(50).optional(),
      points:      z.number().int().min(0).max(500).optional(),
      is_active:   z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('recognition_badges')
      .update(parsed.data)
      .eq('tenant_id', req.tenantId)
      .eq('code', code)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data: { ok: true } })
  })

  // ── Admin: budget configuration ────────────────────────────────────────────

  fastify.get('/recognition/admin/budget', hrAuth, async (req: any, reply) => {
    const { data } = await fastify.supabase
      .from('recognition_budgets')
      .select('monthly_points')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    return reply.send({ data: { monthly_points: (data as any)?.monthly_points ?? DEFAULT_MONTHLY_BUDGET } })
  })

  fastify.patch('/recognition/admin/budget', hrAuth, async (req: any, reply) => {
    const schema = z.object({ monthly_points: z.number().int().min(0).max(10_000) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('recognition_budgets')
      .upsert({ tenant_id: req.tenantId, monthly_points: parsed.data.monthly_points }, { onConflict: 'tenant_id' })

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data: { ok: true } })
  })
}
