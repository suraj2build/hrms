/**
 * GET /ess/identity — the My Growth experience: "Who am I, and how have I grown?"
 *
 * The Growth lens (EXPERIENCE_GROWTH_DESIGN.md) — the distilled SELF, not a profile
 * form and not a re-listed log. It composes, never owns: the person + reporting line
 * (from employees/job_history), the Growth spine (the SHARED projectJourney — its
 * canonical home is now here, migrated off Timeline), strengths distilled from
 * recognition received, one forward growth Reflection, and a real-data-only
 * "Looking Ahead" (the next service anniversary / first-months orientation — never a
 * prediction or coaching engine). Skills / learning / achievements are intentionally
 * ABSENT until their event sources exist — calm empty space, never a placeholder.
 *
 * Tenant + self scoped server-side; every sub-query safe()-wrapped. No writes —
 * editing HR fields is a module action reached *from* here, never part of it.
 */

import type { FastifyInstance } from 'fastify'
import { projectJourney } from './journey.js'

interface Party { id: string; name: string; subtitle?: string }

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}
function fullName(e: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!e) return ''
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()
}
const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion', customer_hero: 'Customer Hero', team_player: 'Team Player',
  innovator: 'Innovator', problem_solver: 'Problem Solver', culture_ambassador: 'Culture Ambassador',
}
function tenureWords(join: string | null, now: Date): string | null {
  if (!join) return null
  const jd = new Date(join.length <= 10 ? join + 'T00:00:00Z' : join)
  if (isNaN(jd.getTime())) return null
  let months = (now.getFullYear() - jd.getFullYear()) * 12 + (now.getMonth() - jd.getMonth())
  if (now.getDate() < jd.getDate()) months -= 1
  if (months < 1) return 'less than a month'
  const y = Math.floor(months / 12), m = months % 12
  return [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ') || 'a month'
}
function humanizeIn(at: string, now: Date): string {
  const days = Math.round((new Date(at).getTime() - now.getTime()) / 86_400_000)
  if (days <= 0) return 'soon'
  if (days <= 31) return `in ${days} day${days === 1 ? '' : 's'}`
  const months = Math.round(days / 30.4)
  return `in ${months} month${months === 1 ? '' : 's'}`
}

export default async function essIdentityRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/identity', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const now = new Date()

    const { data: profileRow } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    const employeeId = (profileRow as any)?.employee_id ?? null

    if (!employeeId) {
      return reply.send({ person: null, reporting: { manager: null, peers: [], reports: [] },
        journey: [], strengths: [], reflection: { insight: null }, lookingAhead: [] })
    }

    const [me, job, reports, kudos, jr] = await Promise.all([
      safe(fastify.supabase.from('employees')
        .select('id, first_name, last_name, joining_date, manager_id')
        .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle().then(r => r.data as any), null),
      safe(fastify.supabase.from('job_history')
        .select('designations(name), departments(name), employees!job_history_manager_id_fkey(id, first_name, last_name)')
        .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('is_current', true).maybeSingle()
        .then(r => r.data as any), null),
      safe(fastify.supabase.from('employees')
        .select('id, first_name, last_name')
        .eq('tenant_id', tenantId).eq('status', 'active').eq('manager_id', employeeId).limit(12)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      safe(fastify.supabase.from('recognition')
        .select('badge_code, from_employee')
        .eq('tenant_id', tenantId).eq('to_employee', employeeId).limit(200)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      projectJourney(fastify, { tenantId, employeeId, now }),
    ])

    const join = (me?.joining_date as string | null) ?? null
    const tenure = tenureWords(join, now)
    const designation = (job?.designations as any)?.name ?? null
    const department  = (job?.departments  as any)?.name ?? null
    const mgrRow      = (job?.employees as any) ?? null

    // ── Reporting line (people, never ids). Peers share my manager. ──
    const manager: Party | null = mgrRow ? { id: mgrRow.id, name: fullName(mgrRow), subtitle: 'manager' } : null
    const myMgrId = (me?.manager_id as string | null) ?? null
    const peers: Party[] = myMgrId
      ? await safe(fastify.supabase.from('employees').select('id, first_name, last_name')
          .eq('tenant_id', tenantId).eq('status', 'active').eq('manager_id', myMgrId).neq('id', employeeId).limit(8)
          .then(r => ((r.data ?? []) as any[]).map(p => ({ id: p.id, name: fullName(p) }))), [] as Party[])
      : []
    const reportParties: Party[] = (reports as any[]).map(r => ({ id: r.id, name: fullName(r) }))

    // ── Strengths — recognition received, distilled to qualities (never a score). ──
    const byBadge = new Map<string, { count: number; faces: Set<string> }>()
    const giverIds = new Set<string>()
    for (const k of kudos as any[]) {
      const code = k.badge_code || 'recognition'
      const e = byBadge.get(code) ?? { count: 0, faces: new Set<string>() }
      e.count += 1
      if (k.from_employee) { e.faces.add(k.from_employee); giverIds.add(k.from_employee) }
      byBadge.set(code, e)
    }
    const giverNames = new Map<string, string>()
    if (giverIds.size) {
      const gs = await safe(fastify.supabase.from('employees').select('id, first_name, last_name')
        .eq('tenant_id', tenantId).in('id', [...giverIds]).then(r => (r.data ?? []) as any[]), [] as any[])
      for (const g of gs as any[]) giverNames.set(g.id, fullName(g))
    }
    const strengths = [...byBadge.entries()]
      .map(([code, v]) => ({ badge: code, label: BADGE_LABELS[code] ?? 'Recognition', count: v.count,
        faces: [...v.faces].map(id => giverNames.get(id)).filter(Boolean).slice(0, 3) as string[] }))
      .sort((a, b) => b.count - a.count)

    // ── Growth Reflection — one forward, specific, memory-aware insight (or silence). ──
    const top = strengths[0]
    const totalRecv = strengths.reduce((s, x) => s + x.count, 0)
    let reflection: { insight: string | null } = { insight: null }
    if (top && top.count >= 3) {
      reflection = { insight: `You've become known as a${/^[AEIOU]/.test(top.label) ? 'n' : ''} ${top.label} — recognised ${top.count} times for it.` }
    } else if (totalRecv >= 3) {
      reflection = { insight: `Your work's being seen — ${totalRecv} recognitions so far.` }
    } else if (tenure && tenure !== 'less than a month' && /year/.test(tenure)) {
      reflection = { insight: `${tenure[0]!.toUpperCase()}${tenure.slice(1)} in — you're building something here.` }
    }

    // ── Looking Ahead — gently forward, REAL data only (no prediction/coaching). ──
    const lookingAhead: { label: string; detail?: string }[] = []
    if (jr.nextAnniversary) {
      const within = (new Date(jr.nextAnniversary.at).getTime() - now.getTime()) / 86_400_000
      if (within <= 150) {
        lookingAhead.push({
          label: jr.nextAnniversary.years === 1 ? 'Your first work anniversary' : `Your ${jr.nextAnniversary.years}-year anniversary`,
          detail: humanizeIn(jr.nextAnniversary.at, now),
        })
      }
    }
    const tenureDays = join ? (now.getTime() - new Date(join.length <= 10 ? join + 'T00:00:00Z' : join).getTime()) / 86_400_000 : 999
    if (tenureDays >= 0 && tenureDays < 90) {
      lookingAhead.push({ label: 'Your first 90 days', detail: 'Settling in — finding your rhythm' })
    }

    return reply.send({
      person: me ? { name: fullName(me) || null, designation, department, joining_date: join, tenure_months:
        join ? Math.floor((now.getTime() - new Date(join).getTime()) / (30.4375 * 86_400_000)) : 0, tenure_label: tenure } : null,
      reporting: { manager, peers, reports: reportParties },
      journey: jr.steps,
      strengths,
      reflection,
      lookingAhead,
    })
  })
}
