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
import { WhatsAppProvider } from '../../lib/whatsapp-provider.js'

const CreateAwardSchema = z.object({
  name:                 z.string().min(1),
  description:          z.string().optional().nullable(),
  frequency:            z.string().optional(),
  award_type:           z.string().optional(),
  monetary_value:       z.number().optional().nullable(),
  monetary_description: z.string().optional().nullable(),
  eligible_group:       z.unknown().optional(),
  requires_nomination:  z.boolean().optional(),
})

const UpdateAwardSchema = z.object({
  name:                 z.string().min(1).optional(),
  description:          z.string().optional().nullable(),
  frequency:            z.string().optional(),
  award_type:           z.string().optional(),
  monetary_value:       z.number().optional().nullable(),
  monetary_description: z.string().optional().nullable(),
  eligible_group:       z.unknown().optional(),
  requires_nomination:  z.boolean().optional(),
  is_active:            z.boolean().optional(),
})

const CreateRoundSchema = z.object({
  period_label: z.string().min(1),
  period_start: z.string().optional().nullable(),
  period_end:   z.string().optional().nullable(),
})

const UpdateRoundSchema = z.object({
  status:       z.string().optional(),
  period_label: z.string().optional(),
  period_start: z.string().optional().nullable(),
  period_end:   z.string().optional().nullable(),
})

const DeclareWinnerSchema = z.object({
  winner_employee_id: z.string().uuid('winner_employee_id must be a valid UUID'),
  winner_notes:       z.string().optional().nullable(),
})

const NominateSchema = z.object({
  nominee_id:    z.string().uuid('nominee_id must be a valid UUID'),
  justification: z.string().optional().nullable(),
})

const SpotAwardSchema = z.object({
  to_employee_id: z.string().uuid('to_employee_id must be a valid UUID'),
  award_name:     z.string().min(1),
  message:        z.string().optional().nullable(),
  monetary_value: z.number().optional().nullable(),
})

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
      .order('label', { ascending: true }).limit(100)
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
    if (parsed.data.visibility === 'public') {
      const toName = `${(recipient as any).first_name ?? ''} ${(recipient as any).last_name ?? ''}`.trim() || 'a colleague'
      await fastify.supabase.from('feed_posts').insert({
        tenant_id:       req.tenantId,
        author_employee: fromEmployee,
        type:            'recognition',
        title:           badgeLabel,
        body:            `Recognized ${toName}${parsed.data.message ? ` — ${parsed.data.message}` : ''}`,
      }).then(undefined, () => { /* feed best-effort */ })
    }

    // WhatsApp notification to recipient if they have a phone (best-effort — never block kudos success)
    if (parsed.data.badge_code) {
      const { data: empRow } = await fastify.supabase
        .from('employees')
        .select('phone, first_name')
        .eq('id', parsed.data.to_employee)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if ((empRow as any)?.phone) {
        try {
          const wa = new WhatsAppProvider(fastify.supabase)
          await wa.sendTemplate(req.tenantId, (empRow as any).phone, 'peer_badge_received', {
            name:    (empRow as any).first_name ?? 'Team member',
            badge:   badgeLabel ?? parsed.data.badge_code,
            message: parsed.data.message,
          })
        } catch (waErr) {
          fastify.log.warn({ err: waErr }, 'recognition: WhatsApp badge notification failed — kudos still recorded')
        }
      }
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
      .order('label').limit(100)
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

  // ── Formal Award Programs (admin CRUD) ───────────────────────────────────

  fastify.get('/recognition/admin/awards', hrAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('formal_awards')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false }).limit(200)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/recognition/admin/awards', hrAuth, async (req: any, reply) => {
    const parsed = CreateAwardSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { name, description, frequency, award_type, monetary_value, monetary_description, eligible_group, requires_nomination } = parsed.data
    const { data, error } = await fastify.supabase.from('formal_awards')
      .insert({ tenant_id: req.tenantId, name: name.trim(), description, frequency: frequency || 'monthly', award_type: award_type || 'custom', monetary_value: monetary_value || null, monetary_description, eligible_group, requires_nomination: requires_nomination !== false, created_by: req.userId })
      .select('id').single()
    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send({ data })
  })

  fastify.patch('/recognition/admin/awards/:id', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = UpdateAwardSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const allowed = ['name','description','frequency','award_type','monetary_value','monetary_description','eligible_group','requires_nomination','is_active']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if ((parsed.data as any)[k] !== undefined) update[k] = (parsed.data as any)[k] }
    const { error } = await fastify.supabase.from('formal_awards').update(update).eq('tenant_id', req.tenantId).eq('id', id)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  // ── Award Rounds ──────────────────────────────────────────────────────────

  fastify.get('/recognition/admin/awards/:awardId/rounds', hrAuth, async (req: any, reply) => {
    const { awardId } = req.params as { awardId: string }
    const { data, error } = await fastify.supabase
      .from('award_rounds')
      .select(`*, employees!award_rounds_winner_employee_id_fkey(id, first_name, last_name, employee_code)`)
      .eq('tenant_id', req.tenantId).eq('award_id', awardId)
      .order('created_at', { ascending: false }).limit(100)
    if (error) return reply.code(500).send({ error: error.message })
    // Attach nomination count
    const roundIds = (data ?? []).map((r: any) => r.id)
    const nomCounts: Record<string, number> = {}
    if (roundIds.length) {
      const { data: noms } = await fastify.supabase.from('award_nominations').select('round_id').eq('tenant_id', req.tenantId).in('round_id', roundIds)
      ;(noms ?? []).forEach((n: any) => { nomCounts[n.round_id] = (nomCounts[n.round_id] ?? 0) + 1 })
    }
    return reply.send({ data: (data ?? []).map((r: any) => ({ ...r, nomination_count: nomCounts[r.id] ?? 0 })) })
  })

  fastify.post('/recognition/admin/awards/:awardId/rounds', hrAuth, async (req: any, reply) => {
    const { awardId } = req.params as { awardId: string }
    const parsed = CreateRoundSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { period_label, period_start, period_end } = parsed.data
    const { data, error } = await fastify.supabase.from('award_rounds')
      .insert({ tenant_id: req.tenantId, award_id: awardId, period_label: period_label.trim(), period_start: period_start || null, period_end: period_end || null, status: 'open', created_by: req.userId })
      .select('id').single()
    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send({ data })
  })

  fastify.patch('/recognition/admin/awards/:awardId/rounds/:roundId', hrAuth, async (req: any, reply) => {
    const { roundId } = req.params as { awardId: string; roundId: string }
    const parsed = UpdateRoundSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const allowed = ['status','period_label','period_start','period_end']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if ((parsed.data as any)[k] !== undefined) update[k] = (parsed.data as any)[k] }
    const { error } = await fastify.supabase.from('award_rounds').update(update).eq('tenant_id', req.tenantId).eq('id', roundId)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  fastify.post('/recognition/admin/awards/:awardId/rounds/:roundId/declare-winner', hrAuth, async (req: any, reply) => {
    const { awardId, roundId } = req.params as { awardId: string; roundId: string }
    const parsed = DeclareWinnerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { winner_employee_id, winner_notes } = parsed.data
    // Update the round
    const { data: round, error: re } = await fastify.supabase.from('award_rounds')
      .update({ status: 'closed', winner_employee_id, winner_notes: winner_notes || null, declared_at: new Date().toISOString(), declared_by: req.userId })
      .eq('tenant_id', req.tenantId).eq('id', roundId)
      .select('period_label, formal_awards!award_rounds_award_id_fkey(name)')
      .single()
    if (re) return reply.code(500).send({ error: re.message })
    // Mark winning nomination
    await fastify.supabase.from('award_nominations')
      .update({ status: 'winner', reviewed_at: new Date().toISOString(), reviewed_by: req.userId })
      .eq('tenant_id', req.tenantId).eq('round_id', roundId).eq('nominee_id', winner_employee_id)
    // Mark others not_selected
    await fastify.supabase.from('award_nominations')
      .update({ status: 'not_selected', reviewed_at: new Date().toISOString(), reviewed_by: req.userId })
      .eq('tenant_id', req.tenantId).eq('round_id', roundId).eq('status', 'pending')
    // WhatsApp to winner (best-effort — never block winner declaration success)
    const { data: winner } = await fastify.supabase
      .from('employees').select('phone, first_name').eq('id', winner_employee_id).eq('tenant_id', req.tenantId).maybeSingle()
    if ((winner as any)?.phone) {
      try {
        const wa = new WhatsAppProvider(fastify.supabase)
        const awardName = (round as any)?.formal_awards?.name ?? 'award'
        await wa.sendTemplate(req.tenantId, (winner as any).phone, 'award_winner', {
          name:       (winner as any).first_name ?? 'Team member',
          award_name: awardName,
          period:     (round as any)?.period_label ?? '',
        })
      } catch (waErr) {
        fastify.log.warn({ err: waErr }, 'recognition: WhatsApp winner notification failed — winner still declared')
      }
    }
    return reply.send({ data: { winner_declared: true } })
  })

  // ── Nominations ───────────────────────────────────────────────────────────

  fastify.get('/recognition/admin/awards/:awardId/rounds/:roundId/nominations', hrAuth, async (req: any, reply) => {
    const { roundId } = req.params as { awardId: string; roundId: string }
    const { data, error } = await fastify.supabase
      .from('award_nominations')
      .select(`id, justification, status, created_at,
        employees!award_nominations_nominee_id_fkey(id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name)),
        profiles!award_nominations_nominated_by_fkey(id, full_name)`)
      .eq('tenant_id', req.tenantId).eq('round_id', roundId)
      .order('created_at', { ascending: false }).limit(500)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/recognition/admin/awards/:awardId/rounds/:roundId/nominations', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const { roundId } = req.params as { awardId: string; roundId: string }
    const parsed = NominateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { nominee_id, justification } = parsed.data
    const { data, error } = await fastify.supabase.from('award_nominations')
      .insert({ tenant_id: req.tenantId, round_id: roundId, nominee_id, nominated_by: req.userId, justification: justification || null })
      .select('id').single()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'This employee is already nominated for this round' })
      return reply.code(500).send({ error: error.message })
    }
    return reply.code(201).send({ data })
  })

  fastify.patch('/recognition/admin/awards/:awardId/rounds/:roundId/nominations/:nomId', hrAuth, async (req: any, reply) => {
    const { nomId } = req.params as { awardId: string; roundId: string; nomId: string }
    const { status, justification } = req.body as any
    const validStatuses = ['pending','shortlisted','not_selected']
    if (status && !validStatuses.includes(status)) return reply.code(400).send({ error: 'Invalid status' })
    const update: Record<string, unknown> = {}
    if (status) { update.status = status; update.reviewed_at = new Date().toISOString(); update.reviewed_by = req.userId }
    if (justification !== undefined) update.justification = justification
    const { error } = await fastify.supabase.from('award_nominations').update(update).eq('tenant_id', req.tenantId).eq('id', nomId)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  // ── Admin: multi-level nomination approval ───────────────────────────────────
  // Level 1 approval (HR admin), level 2 approval (owner/CHRO)

  fastify.post('/recognition/admin/nominations/:nomId/approve', hrAuth, async (req: any, reply) => {
    const { nomId } = req.params as { nomId: string }
    const schema = z.object({
      level:   z.enum(['1', '2']),
      approve: z.boolean(),
      notes:   z.string().max(1000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { level, approve, notes } = parsed.data
    const now = new Date().toISOString()

    const { data: nom, error: fetchErr } = await fastify.supabase
      .from('award_nominations')
      .select('id, status, nominee_id, approval_level')
      .eq('tenant_id', req.tenantId)
      .eq('id', nomId)
      .maybeSingle()

    if (fetchErr || !nom) return reply.code(404).send({ error: 'Nomination not found' })

    let update: Record<string, unknown> = {}
    if (level === '1') {
      if (!approve) {
        update = { status: 'rejected', reviewed_at: now, reviewed_by: req.userId, approval_level: 1, approved_by_l1: null, l1_approved_at: null }
      } else {
        update = { status: 'level_2_pending', approved_by_l1: req.userId, l1_approved_at: now, approval_level: 1 }
      }
    } else {
      if (!approve) {
        update = { status: 'rejected', reviewed_at: now, reviewed_by: req.userId, approval_level: 1 }
      } else {
        update = { status: 'shortlisted', approved_by_l2: req.userId, l2_approved_at: now, reviewed_at: now, reviewed_by: req.userId, approval_level: 2 }
      }
    }

    const { error: upErr } = await fastify.supabase
      .from('award_nominations')
      .update(update)
      .eq('tenant_id', req.tenantId)
      .eq('id', nomId)

    if (upErr) return reply.code(500).send({ error: upErr.message })

    return reply.send({ data: { ok: true, new_status: update.status ?? 'unchanged' } })
  })

  // ── ESS: view open award rounds for nomination ─────────────────────────────

  fastify.get('/recognition/awards/open', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('award_rounds')
      .select(`id, period_label, period_start, period_end, status, created_at,
        formal_awards!award_rounds_award_id_fkey(id, name, description, eligible_group, requires_nomination, monetary_value, monetary_description)`)
      .eq('tenant_id', req.tenantId).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(100)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── ESS: view recent award winners ────────────────────────────────────────

  fastify.get('/recognition/awards/winners', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('award_rounds')
      .select(`id, period_label, declared_at,
        formal_awards!award_rounds_award_id_fkey(id, name, award_type),
        employees!award_rounds_winner_employee_id_fkey(id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name))`)
      .eq('tenant_id', req.tenantId).eq('status', 'closed')
      .not('winner_employee_id', 'is', null)
      .order('declared_at', { ascending: false }).limit(20)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── Long Service Alerts (admin) ───────────────────────────────────────────

  fastify.get('/recognition/admin/long-service-alerts', hrAuth, async (req: any, reply) => {
    // Find employees who hit 1yr, 3yr, or 5yr milestone in the current month
    const today = new Date()
    const milestones = [1, 3, 5]
    const alerts: any[] = []
    for (const years of milestones) {
      // Employees whose date_of_joining anniversary (years ago) falls this month
      const targetYear = today.getFullYear() - years
      const monthStr = String(today.getMonth() + 1).padStart(2, '0')
      const lastDay = new Date(targetYear, today.getMonth() + 1, 0).getDate()
      const from = `${targetYear}-${monthStr}-01`
      const to   = `${targetYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`
      const { data } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name), joining_date')
        .eq('tenant_id', req.tenantId)
        .gte('joining_date', from)
        .lte('joining_date', to)
        .not('status', 'eq', 'terminated')
      ;(data ?? []).forEach((e: any) => alerts.push({ ...e, milestone_years: years }))
    }
    return reply.send({ data: alerts })
  })

  // ── Spot Awards (manager gives to direct report) ──────────────────────────

  fastify.get('/recognition/admin/spot-awards', hrAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('spot_awards')
      .select(`id, award_name, message, monetary_value, created_at,
        employees!from_employee_id(id, first_name, last_name),
        employees!to_employee_id(id, first_name, last_name, employee_code, designation:designations(name))`)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false }).limit(50)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/recognition/spot-award', { preHandler: fastify.authenticate }, async (req: any, reply) => {
    const parsed = SpotAwardSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { to_employee_id, award_name, message, monetary_value } = parsed.data
    const empId = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.code(403).send({ error: 'Employee profile not found' })
    const { data, error } = await fastify.supabase.from('spot_awards')
      .insert({ tenant_id: req.tenantId, from_employee_id: empId, to_employee_id, award_name: award_name.trim(), message: message || null, monetary_value: monetary_value || null })
      .select('id').single()
    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send({ data })
  })

  // ── Admin: overall R&R tracking dashboard ────────────────────────────────

  fastify.get('/recognition/admin/rnr-summary', hrAuth, async (req: any, reply) => {
    const [awardsRes, roundsRes, nominationsRes, spotRes, peersRes] = await Promise.all([
      fastify.supabase.from('formal_awards').select('id', { count: 'exact', head: true }).eq('tenant_id', req.tenantId).eq('is_active', true),
      fastify.supabase.from('award_rounds').select('id, status', { count: 'exact' }).eq('tenant_id', req.tenantId),
      fastify.supabase.from('award_nominations').select('id, status').eq('tenant_id', req.tenantId),
      fastify.supabase.from('spot_awards').select('id, monetary_value').eq('tenant_id', req.tenantId),
      fastify.supabase.from('recognition').select('id, points').eq('tenant_id', req.tenantId).gte('created_at', new Date(new Date().getFullYear(), 0, 1).toISOString()),
    ])
    const rounds = (roundsRes.data ?? []) as any[]
    const nominations = (nominationsRes.data ?? []) as any[]
    const spotAwards = (spotRes.data ?? []) as any[]
    const peerRecs = (peersRes.data ?? []) as any[]
    const totalMonetary = spotAwards.reduce((s: number, a: any) => s + (a.monetary_value ?? 0), 0)
    return reply.send({
      data: {
        active_award_programs: awardsRes.count ?? 0,
        total_rounds: rounds.length,
        open_rounds: rounds.filter((r: any) => r.status === 'open').length,
        closed_rounds: rounds.filter((r: any) => r.status === 'closed').length,
        total_nominations: nominations.length,
        pending_nominations: nominations.filter((n: any) => n.status === 'pending').length,
        spot_awards_given: spotAwards.length,
        spot_awards_monetary_total: totalMonetary,
        peer_recognitions_ytd: peerRecs.length,
        peer_points_ytd: peerRecs.reduce((s: number, r: any) => s + (r.points ?? 0), 0),
      },
    })
  })
}
