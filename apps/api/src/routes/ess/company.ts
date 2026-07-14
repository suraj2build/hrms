/**
 * GET /ess/company — the My Company experience: the People-FAR lens,
 * "What's our shared world — and where do I belong?"
 *
 * The belonging surface of the Employee OS. It reconciles the two existing
 * "what's happening across the company" streams — the community `feed_posts`
 * feed and the public `recognition` stream — into ONE warm shape: faces over
 * charts, moments over metrics. It is NEVER a social network, an announcement
 * board, a dashboard, or an inbox (EXPERIENCE_COMPANY_DESIGN.md, frozen
 * boundary). No Need (action belongs to My Attention), no Progress (no company
 * score).
 *
 * Projects, never owns: company-wide celebrations from employees.dob /
 * joining_date and recent new joiners; recent PUBLIC recognition; the active
 * company feed (announcements + updates) time-grouped Today / This week /
 * Earlier; one warm belonging reflection. Tenant-scoped; self via
 * profiles.employee_id; every sub-query safe()-wrapped. Read-only — writes
 * (post / wish / react / comment / moderation) stay the /community module of
 * record.
 */

import type { FastifyInstance } from 'fastify'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

function todayISO(): string { return new Date().toISOString().slice(0, 10) }
function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}
function fullName(e: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!e) return 'A colleague'
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'A colleague'
}
const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion', customer_hero: 'Customer Hero', team_player: 'Team Player',
  innovator: 'Innovator', problem_solver: 'Problem Solver', culture_ambassador: 'Culture Ambassador',
}

interface Celebrating { id: string; name: string; kind: 'birthday' | 'anniversary' | 'joined'; years?: number }
interface Recognition { id: string; title: string; person: string }
interface HappeningEvent { id: string; type: 'announcement' | 'lifecycle'; title: string; body?: string; at: string }
interface HappeningGroup { key: string; label: string; events: HappeningEvent[] }

export default async function essCompanyRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/company', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const today = todayISO()
    const todayMMDD = today.slice(5)
    const thisYear = today.slice(0, 4)

    // ── Sources (each safe()-wrapped so one bad source can't nuke the lens) ──
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const [empRows, joinerRows, recogRows, feedRows] = await Promise.all([
      // Active roster — for today's company-wide birthdays + anniversaries.
      safe(
        fetchAllRows((from, to) =>
          fastify.supabase.from('employees')
            .select('id, first_name, last_name, dob, joining_date')
            .eq('tenant_id', tenantId).eq('status', 'active')
            .range(from, to),
        ),
        [] as any[],
      ),
      // Recent new joiners — a company "welcome" (joined in the last week).
      safe(fastify.supabase.from('employees')
        .select('id, first_name, last_name, joining_date')
        .eq('tenant_id', tenantId).eq('status', 'active')
        .gte('joining_date', sevenDaysAgo).lte('joining_date', today)
        .order('joining_date', { ascending: false }).limit(10)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      // Recent PUBLIC recognition — the broad-recognition facet (faces).
      safe(fastify.supabase.from('recognition')
        .select('id, from_employee, to_employee, badge_code, message, created_at')
        .eq('tenant_id', tenantId).eq('visibility', 'public')
        .order('created_at', { ascending: false }).limit(8)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      // The company feed — announcements + updates (Story lens), newest first.
      safe(fastify.supabase.from('feed_posts')
        .select('id, author_employee, type, title, body, pinned, created_at')
        .eq('tenant_id', tenantId).eq('status', 'active')
        .in('type', ['announcement', 'update'])
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(30)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
    ])

    // ── celebrating — birthdays + anniversaries today, then new joiners ──────
    const celebrating: Celebrating[] = []
    for (const e of empRows as any[]) {
      if (typeof e.dob === 'string' && e.dob.slice(5) === todayMMDD) {
        celebrating.push({ id: e.id, name: fullName(e), kind: 'birthday' })
      }
      if (typeof e.joining_date === 'string' && e.joining_date.slice(5) === todayMMDD && e.joining_date.slice(0, 4) !== thisYear) {
        const years = Number(thisYear) - Number(e.joining_date.slice(0, 4))
        if (years > 0) celebrating.push({ id: e.id, name: fullName(e), kind: 'anniversary', years })
      }
    }
    const celebratingIds = new Set(celebrating.map(c => c.id))
    for (const e of joinerRows as any[]) {
      if (celebratingIds.has(e.id)) continue
      celebrating.push({ id: e.id, name: fullName(e), kind: 'joined' })
      celebratingIds.add(e.id)
    }

    // ── recognition — resolve giver→receiver names (two FKs to employees) ────
    const recognition: Recognition[] = []
    const recogIds = [...new Set((recogRows as any[]).flatMap(r => [r.from_employee, r.to_employee]).filter(Boolean))]
    const recogNames = new Map<string, string>()
    if (recogIds.length) {
      const emps = await safe(fastify.supabase.from('employees').select('id, first_name, last_name')
        .eq('tenant_id', tenantId).in('id', recogIds).then(r => (r.data ?? []) as any[]), [] as any[])
      for (const e of emps as any[]) recogNames.set(e.id, fullName(e))
    }
    for (const r of (recogRows as any[]).slice(0, 6)) {
      const giver = recogNames.get(r.from_employee) ?? 'A colleague'
      const receiver = recogNames.get(r.to_employee) ?? 'a colleague'
      const badge = r.badge_code ? (BADGE_LABELS[r.badge_code] ?? null) : null
      recognition.push({
        id: `rec_${r.id}`,
        person: receiver,
        title: badge
          ? `${giver} recognised ${receiver} — ${badge}`
          : `${giver} recognised ${receiver}`,
      })
    }

    // ── happening — the company feed, time-grouped Today / This week / Earlier ─
    const startOfToday = new Date(today + 'T00:00:00').getTime()
    const startOfWeek = Date.now() - 7 * 86_400_000
    const groups: HappeningGroup[] = [
      { key: 'today', label: 'Today', events: [] },
      { key: 'week', label: 'This week', events: [] },
      { key: 'earlier', label: 'Earlier', events: [] },
    ]
    const byKey = new Map(groups.map(g => [g.key, g]))
    for (const p of feedRows as any[]) {
      const ev: HappeningEvent = {
        id: `feed_${p.id}`,
        type: p.type === 'announcement' ? 'announcement' : 'lifecycle',
        title: (p.title as string | null) || (p.type === 'announcement' ? 'Announcement' : 'An update from the company'),
        body: (p.body as string | null) ?? undefined,
        at: p.created_at as string,
      }
      const t = new Date(p.created_at).getTime()
      const key = t >= startOfToday ? 'today' : t >= startOfWeek ? 'week' : 'earlier'
      byKey.get(key)!.events.push(ev)
    }
    const happening = groups.filter(g => g.events.length > 0)

    // ── focus — one warm orienting line (belonging, not a count) ─────────────
    const celebCount = celebrating.length
    const annCount = (feedRows as any[]).filter(p => p.type === 'announcement').length
    const bits: string[] = []
    if (celebCount) bits.push(`${celebCount} celebrating`)
    if (annCount) bits.push(`${annCount} ${annCount === 1 ? 'announcement' : 'announcements'}`)
    const sentence = bits.length
      ? `Across the company today — ${bits.join(', ')}.`
      : 'Across the company today — a quiet, steady day.'

    // ── reflection — one belonging-aware line, or null (silence-as-calm) ─────
    let insight: string | null = null
    const anniversaries = celebrating.filter(c => c.kind === 'anniversary').length
    const joiners = celebrating.filter(c => c.kind === 'joined').length
    if (anniversaries >= 2) {
      insight = `A month of milestones — ${anniversaries} work anniversaries across the company.`
    } else if (joiners >= 2) {
      insight = `Our world is growing — ${joiners} new people joined us this week.`
    } else if (recognition.length >= 3) {
      insight = `People are seeing the good in each other — ${recognition.length} recognitions shared lately.`
    }

    return reply.send({
      focus: { sentence },
      celebrating,
      recognition,
      happening,
      reflection: { insight },
    })
  })
}
