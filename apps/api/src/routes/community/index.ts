/**
 * Community feed routes — ESS 2.0 "Community" pillar (first slice).
 *
 *   GET   /community/feed                  — ranked feed (pinned first)
 *   POST  /community/posts                 — create a post
 *   PATCH /community/posts/:id             — pin/hide/remove (HR only)
 *   POST  /community/posts/:id/react       — toggle a reaction
 *   GET   /community/posts/:id/comments    — list a post's comments
 *   POST  /community/posts/:id/comments    — add a comment
 *
 * Tenant scoping enforced in code on every query (service-role bypasses RLS).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ensureTodaysCelebrations } from '../../lib/community-celebrations.js'
import { containsProfanity } from '../../lib/profanity.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
const PROFANITY_MSG = 'Your message looks like it contains inappropriate language. Please rephrase.'
const REACTIONS = ['like', 'celebrate', 'appreciate', 'support'] as const

async function resolveEmployeeId(fastify: FastifyInstance, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles').select('employee_id')
    .eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  return (data as { employee_id: string | null } | null)?.employee_id ?? null
}

async function namesFor(fastify: FastifyInstance, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map()
  const { data } = await fastify.supabase
    .from('employees').select('id, first_name, last_name')
    .eq('tenant_id', tenantId).in('id', uniq)
  return new Map((data ?? []).map((e: any) => [e.id, `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()]))
}

export default async function communityRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /community/feed ──────────────────────────────────────────────────────
  fastify.get('/community/feed', auth, async (req: any, reply) => {
    const limit = Math.min(50, Math.max(1, Number((req.query as any).limit) || 25))
    const me    = await resolveEmployeeId(fastify, req.userId, req.tenantId)

    // Lazily ensure today's birthday/anniversary system posts exist (idempotent).
    await ensureTodaysCelebrations(fastify.supabase, req.tenantId)

    const { data: posts, error } = await fastify.supabase
      .from('feed_posts')
      .select('id, author_employee, subject_employee, type, title, body, pinned, created_at')
      .eq('tenant_id', req.tenantId).eq('status', 'active')
      .order('pinned', { ascending: false }).order('created_at', { ascending: false })
      .limit(limit)
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load feed' })

    const rows = posts ?? []
    const postIds = rows.map((p: any) => p.id)

    // Reactions + comment counts in two batched reads, aggregated in JS.
    const [reactRes, commentRes] = await Promise.all([
      postIds.length
        ? fastify.supabase.from('feed_reactions').select('post_id, employee_id, reaction').eq('tenant_id', req.tenantId).in('post_id', postIds)
        : Promise.resolve({ data: [] as any[] }),
      postIds.length
        ? fastify.supabase.from('feed_comments').select('post_id').eq('tenant_id', req.tenantId).in('post_id', postIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const reactCount = new Map<string, number>()
    const myReaction = new Map<string, string>()
    for (const r of (reactRes.data ?? []) as any[]) {
      reactCount.set(r.post_id, (reactCount.get(r.post_id) ?? 0) + 1)
      if (me && r.employee_id === me) myReaction.set(r.post_id, r.reaction)
    }
    const commentCount = new Map<string, number>()
    for (const c of (commentRes.data ?? []) as any[]) {
      commentCount.set(c.post_id, (commentCount.get(c.post_id) ?? 0) + 1)
    }

    const names = await namesFor(fastify, req.tenantId, [
      ...rows.map((p: any) => p.author_employee),
      ...rows.map((p: any) => p.subject_employee),
    ])
    const data = rows.map((p: any) => ({
      ...p,
      author_name:    p.author_employee  ? names.get(p.author_employee)  : null,
      subject_name:   p.subject_employee ? names.get(p.subject_employee) : null,
      reaction_count: reactCount.get(p.id) ?? 0,
      comment_count:  commentCount.get(p.id) ?? 0,
      my_reaction:    myReaction.get(p.id) ?? null,
    }))
    return reply.send({ data })
  })

  // ── POST /community/wish ─────────────────────────────────────────────────────
  // One-tap peer celebration: wish a colleague a happy birthday / work
  // anniversary. Any employee may post a wish (unlike announcements). Creates a
  // typed celebration post that records both author and subject.
  fastify.post('/community/wish', auth, async (req: any, reply) => {
    const schema = z.object({
      subject_employee_id: z.string().uuid('subject_employee_id must be a valid UUID'),
      kind:                z.enum(['birthday', 'anniversary']),
      message:             z.string().min(1, 'message is required').max(2000),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    if (containsProfanity(parsed.data.message)) {
      return reply.code(400).send({ error: 'PROFANITY_BLOCKED', message: PROFANITY_MSG })
    }

    // Subject must be a real employee in the caller's tenant.
    const { data: subject } = await fastify.supabase
      .from('employees').select('id')
      .eq('id', parsed.data.subject_employee_id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!subject) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Colleague not found' })

    const author = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    const { data, error } = await fastify.supabase
      .from('feed_posts')
      .insert({
        tenant_id:        req.tenantId,
        author_employee:  author,
        subject_employee: parsed.data.subject_employee_id,
        type:             parsed.data.kind,           // 'birthday' | 'anniversary'
        body:             parsed.data.message,
        audience_scope:   'company',
      })
      .select('id')
      .single()
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to post wish' })
    return reply.code(201).send({ data })
  })

  // ── POST /community/posts ────────────────────────────────────────────────────
  fastify.post('/community/posts', auth, async (req: any, reply) => {
    const schema = z.object({
      body:           z.string().min(1).max(2000),
      title:          z.string().max(200).optional(),
      type:           z.enum(['update', 'announcement']).default('update'),
      audience_scope: z.enum(['company', 'department', 'site']).default('company'),
      pinned:         z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    if (containsProfanity(parsed.data.body) || containsProfanity(parsed.data.title)) {
      return reply.code(400).send({ error: 'PROFANITY_BLOCKED', message: PROFANITY_MSG })
    }

    const isHr = HR_ADMIN_ROLES.includes(req.userRole)
    // Announcements + pinning are HR-only; everyone else posts plain updates.
    if ((parsed.data.type === 'announcement' || parsed.data.pinned) && !isHr) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only HR can post announcements or pin posts' })
    }

    const authorEmployee = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    const { data, error } = await fastify.supabase
      .from('feed_posts')
      .insert({
        tenant_id:       req.tenantId,
        author_employee: authorEmployee,
        type:            parsed.data.type,
        title:           parsed.data.title ?? null,
        body:            parsed.data.body,
        audience_scope:  parsed.data.audience_scope,
        pinned:          parsed.data.pinned ?? false,
      })
      .select('id')
      .single()
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create post' })
    return reply.code(201).send({ data })
  })

  // ── PATCH /community/posts/:id (moderation — HR only) ────────────────────────
  fastify.patch('/community/posts/:id', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR access required' })
    }
    const { id } = req.params as { id: string }
    const schema = z.object({
      pinned: z.boolean().optional(),
      status: z.enum(['active', 'hidden', 'removed']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.pinned !== undefined) update.pinned = parsed.data.pinned
    if (parsed.data.status !== undefined) update.status = parsed.data.status

    const { data, error } = await fastify.supabase
      .from('feed_posts').update(update)
      .eq('id', id).eq('tenant_id', req.tenantId).select('id')
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update post')
    if (!data || data.length === 0) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Post not found' })
    return reply.send({ message: 'Post updated' })
  })

  // ── POST /community/posts/:id/react (toggle) ─────────────────────────────────
  fastify.post('/community/posts/:id/react', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ reaction: z.enum(REACTIONS).default('like') })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const me = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    if (!me) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Your account is not linked to an employee record' })

    // Post must exist within the tenant.
    const { data: post } = await fastify.supabase
      .from('feed_posts').select('id').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!post) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Post not found' })

    const { data: existing } = await fastify.supabase
      .from('feed_reactions').select('id, reaction')
      .eq('tenant_id', req.tenantId).eq('post_id', id).eq('employee_id', me).maybeSingle()

    if (existing) {
      if ((existing as any).reaction === parsed.data.reaction) {
        // Same reaction → toggle off.
        await fastify.supabase.from('feed_reactions').delete().eq('id', (existing as any).id)
        return reply.send({ data: { reaction: null } })
      }
      await fastify.supabase.from('feed_reactions').update({ reaction: parsed.data.reaction }).eq('id', (existing as any).id)
      return reply.send({ data: { reaction: parsed.data.reaction } })
    }

    const { error } = await fastify.supabase
      .from('feed_reactions')
      .insert({ tenant_id: req.tenantId, post_id: id, employee_id: me, reaction: parsed.data.reaction })
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to react' })
    return reply.send({ data: { reaction: parsed.data.reaction } })
  })

  // ── GET /community/posts/:id/comments ────────────────────────────────────────
  fastify.get('/community/posts/:id/comments', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data: rows, error } = await fastify.supabase
      .from('feed_comments')
      .select('id, employee_id, body, created_at')
      .eq('tenant_id', req.tenantId).eq('post_id', id)
      .order('created_at', { ascending: true }).limit(200)
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load comments' })

    const names = await namesFor(fastify, req.tenantId, (rows ?? []).map((c: any) => c.employee_id))
    const data = (rows ?? []).map((c: any) => ({ ...c, author_name: c.employee_id ? names.get(c.employee_id) : null }))
    return reply.send({ data })
  })

  // ── POST /community/posts/:id/comments ───────────────────────────────────────
  fastify.post('/community/posts/:id/comments', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ body: z.string().min(1).max(1000) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    if (containsProfanity(parsed.data.body)) {
      return reply.code(400).send({ error: 'PROFANITY_BLOCKED', message: PROFANITY_MSG })
    }

    const me = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    const { data: post } = await fastify.supabase
      .from('feed_posts').select('id').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!post) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Post not found' })

    const { data, error } = await fastify.supabase
      .from('feed_comments')
      .insert({ tenant_id: req.tenantId, post_id: id, employee_id: me, body: parsed.data.body })
      .select('id')
      .single()
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to add comment' })
    return reply.code(201).send({ data })
  })

  // ── POST /community/posts/:id/report ─────────────────────────────────────────
  // Any employee can report a post. One report per reporter per post (UNIQUE);
  // a repeat report is treated as success (idempotent) rather than an error.
  fastify.post('/community/posts/:id/report', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ reason: z.string().max(500).optional() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: post } = await fastify.supabase
      .from('feed_posts').select('id').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!post) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Post not found' })

    const reporter = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    const { error } = await fastify.supabase
      .from('feed_reports')
      .insert({ tenant_id: req.tenantId, post_id: id, reporter_employee: reporter, reason: parsed.data.reason ?? null })
    // 23505 = already reported by this person → idempotent success.
    if (error && error.code !== '23505') {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to submit report' })
    }
    return reply.code(201).send({ message: 'Report submitted' })
  })

  // ── GET /community/reports (HR only) ─────────────────────────────────────────
  // Open reports grouped by post, with reporter count + the post body, so HR can
  // decide whether to hide/remove via PATCH /community/posts/:id.
  fastify.get('/community/reports', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR access required' })
    }
    const { data: reports, error } = await fastify.supabase
      .from('feed_reports')
      .select('id, post_id, reporter_employee, reason, created_at')
      .eq('tenant_id', req.tenantId).eq('status', 'open')
      .order('created_at', { ascending: false }).limit(200)
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to load reports' })

    const rows = reports ?? []
    const postIds = [...new Set(rows.map((r: any) => r.post_id))]
    if (!postIds.length) return reply.send({ data: [] })

    const { data: posts } = await fastify.supabase
      .from('feed_posts').select('id, body, type, status, author_employee')
      .eq('tenant_id', req.tenantId).in('id', postIds)
    const postMap = new Map((posts ?? []).map((p: any) => [p.id, p]))

    // Group reports by post.
    const grouped = new Map<string, { post_id: string; count: number; reasons: string[]; latest: string }>()
    for (const r of rows as any[]) {
      const g = grouped.get(r.post_id) ?? { post_id: r.post_id, count: 0, reasons: [] as string[], latest: r.created_at }
      g.count += 1
      if (r.reason) g.reasons.push(r.reason)
      grouped.set(r.post_id, g)
    }
    const data = [...grouped.values()].map((g) => {
      const p: any = postMap.get(g.post_id)
      return { ...g, post_body: p?.body ?? null, post_type: p?.type ?? null, post_status: p?.status ?? null }
    })
    return reply.send({ data })
  })
}
