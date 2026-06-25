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

const DEFAULT_BADGES = [
  { code: 'ownership_champion', label: 'Ownership Champion', icon: 'Award',     description: 'Takes end-to-end ownership',          points: 15 },
  { code: 'customer_hero',      label: 'Customer Hero',      icon: 'Heart',     description: 'Goes above and beyond for customers', points: 15 },
  { code: 'team_player',        label: 'Team Player',        icon: 'Users',     description: 'Lifts the whole team',                points: 10 },
  { code: 'innovator',          label: 'Innovator',          icon: 'Lightbulb', description: 'Brings new ideas to life',            points: 15 },
  { code: 'problem_solver',     label: 'Problem Solver',     icon: 'Wrench',    description: 'Cracks the hard problems',            points: 10 },
  { code: 'culture_ambassador', label: 'Culture Ambassador', icon: 'Sparkles',  description: 'Lives our values every day',          points: 10 },
]

async function resolveEmployeeId(fastify: FastifyInstance, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles').select('employee_id')
    .eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  return (data as { employee_id: string | null } | null)?.employee_id ?? null
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
  const auth = { preHandler: [fastify.authenticate] }

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
    if (!employeeId) return reply.send({ data: { received: 0, given: 0, points: 0, recent: [] } })

    const [recvRes, giveRes] = await Promise.all([
      fastify.supabase
        .from('recognition')
        .select('id, from_employee, to_employee, badge_code, message, points, created_at')
        .eq('tenant_id', req.tenantId).eq('to_employee', employeeId)
        .order('created_at', { ascending: false }).limit(20),
      fastify.supabase
        .from('recognition').select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId).eq('from_employee', employeeId),
    ])

    const received = recvRes.data ?? []
    const points   = received.reduce((s: number, r: any) => s + (r.points ?? 0), 0)
    return reply.send({
      data: {
        received: received.length,
        given:    giveRes.count ?? 0,
        points,
        recent:   await enrich(fastify, req.tenantId, received),
      },
    })
  })

  // ── GET /recognition/leaderboard ────────────────────────────────────────────
  fastify.get('/recognition/leaderboard', auth, async (req: any, reply) => {
    const { data: rows, error } = await fastify.supabase
      .from('recognition').select('to_employee, points')
      .eq('tenant_id', req.tenantId)
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
}
