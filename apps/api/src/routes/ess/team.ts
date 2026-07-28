/**
 * GET /ess/team — the My Team experience: the People-near lens, "How are my people?"
 *
 * The most HUMAN surface of the Employee OS. It answers five people-questions and
 * nothing else: who's here, who's away, who to celebrate, who recently changed, who
 * might need support. It is NOT an approval inbox, a dashboard, an analytics page, or
 * a reporting workspace — those belong to My Attention / modules of record. Faces over
 * charts, moments over metrics (EXPERIENCE_TEAM_DESIGN.md, frozen boundary).
 *
 * Projects, never owns: roster from employees/job_history, presence from approved
 * leave spanning today (availability only — never the reason), celebrations from
 * dob/joining_date, and recent team recognition. Tenant + self/manager scoped; every
 * sub-query safe()-wrapped. Read-only.
 */

import type { FastifyInstance } from 'fastify'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

interface Party { id: string; name: string; subtitle?: string }

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}
function fullName(e: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!e) return 'A teammate'
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'A teammate'
}
const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion', customer_hero: 'Customer Hero', team_player: 'Team Player',
  innovator: 'Innovator', problem_solver: 'Problem Solver', culture_ambassador: 'Culture Ambassador',
}

export default async function essTeamRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/team', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const tz = await fetchTenantTz(fastify.supabase, tenantId)
    const today = getLocalDate(new Date().toISOString(), tz)
    const todayMMDD = today.slice(5)

    const { data: profileRow } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    const employeeId = (profileRow as any)?.employee_id ?? null

    const empty = { focus: { sentence: 'Your team will appear here.' }, roster: { manager: null, peers: [], reports: [] },
      today: { celebrations: [], out: [] }, recent: [], manager: null }
    if (!employeeId) return reply.send(empty)

    const me = await safe(fastify.supabase.from('employees')
      .select('id, first_name, last_name, manager_id')
      .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle().then(r => r.data as any), null)
    const myMgrId = (me?.manager_id as string | null) ?? null

    const SEL = 'id, first_name, last_name, dob, joining_date'
    const [managerRow, peerRows, reportRows] = await Promise.all([
      myMgrId
        ? safe(fastify.supabase.from('employees').select(SEL)
            .eq('id', myMgrId).eq('tenant_id', tenantId).maybeSingle().then(r => r.data as any), null)
        : Promise.resolve(null),
      myMgrId
        ? safe(fastify.supabase.from('employees').select(SEL)
            .eq('tenant_id', tenantId).eq('status', 'active').eq('manager_id', myMgrId).neq('id', employeeId).limit(20)
            .then(r => (r.data ?? []) as any[]), [] as any[])
        : Promise.resolve([] as any[]),
      safe(fastify.supabase.from('employees').select(SEL)
        .eq('tenant_id', tenantId).eq('status', 'active').eq('manager_id', employeeId).limit(30)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
    ])

    // The people I work with (manager + peers + reports), de-duplicated.
    const everyone = new Map<string, any>()
    if (managerRow) everyone.set(managerRow.id, managerRow)
    for (const p of peerRows as any[])   if (!everyone.has(p.id)) everyone.set(p.id, p)
    for (const r of reportRows as any[]) if (!everyone.has(r.id)) everyone.set(r.id, r)
    const teamIds = [...everyone.keys()]

    // Who's away today (availability only — never the reason) + recent team recognition.
    const [outRows, recogRows] = await Promise.all([
      teamIds.length
        ? safe(fastify.supabase.from('leave_requests')
            .select('employee_id, to_date')
            .eq('tenant_id', tenantId).in('status', ['approved', 'APPROVED'])
            .lte('from_date', today).gte('to_date', today).in('employee_id', teamIds).limit(40)
            .then(r => (r.data ?? []) as any[]), [] as any[])
        : Promise.resolve([] as any[]),
      teamIds.length
        ? safe(fastify.supabase.from('recognition')
            .select('id, from_employee, to_employee, badge_code, created_at')
            .eq('tenant_id', tenantId).in('to_employee', teamIds)
            .order('created_at', { ascending: false }).limit(6)
            .then(r => (r.data ?? []) as any[]), [] as any[])
        : Promise.resolve([] as any[]),
    ])

    const party = (e: any): Party => ({ id: e.id, name: fullName(e) })

    // Celebrations today — birthdays + anniversaries among the team (faces, warm).
    const celebrations: { name: string; kind: 'birthday' | 'anniversary'; years?: number }[] = []
    for (const e of everyone.values()) {
      if (typeof e.dob === 'string' && e.dob.slice(5) === todayMMDD) {
        celebrations.push({ name: fullName(e), kind: 'birthday' })
      }
      if (typeof e.joining_date === 'string' && e.joining_date.slice(5) === todayMMDD && e.joining_date.slice(0, 4) !== today.slice(0, 4)) {
        const years = today.slice(0, 4) ? Number(today.slice(0, 4)) - Number(e.joining_date.slice(0, 4)) : 0
        celebrations.push({ name: fullName(e), kind: 'anniversary', years })
      }
    }

    // Who's out today.
    const out = (outRows as any[]).map(o => {
      const e = everyone.get(o.employee_id)
      return e ? { name: fullName(e), back: o.to_date as string } : null
    }).filter(Boolean)

    // Recent team recognition — resolve giver names for the line.
    const recent: { id: string; title: string; person?: string }[] = []
    const giverIds = [...new Set((recogRows as any[]).map(r => r.from_employee).filter(Boolean))]
    const giverMap = new Map<string, string>()
    if (giverIds.length) {
      const gs = await safe(fastify.supabase.from('employees').select('id, first_name, last_name')
        .eq('tenant_id', tenantId).in('id', giverIds).then(r => (r.data ?? []) as any[]), [] as any[])
      for (const g of gs as any[]) giverMap.set(g.id, fullName(g))
    }
    for (const r of (recogRows as any[]).slice(0, 5)) {
      const who = everyone.get(r.to_employee)
      if (!who) continue
      const giver = giverMap.get(r.from_employee) ?? 'A colleague'
      const badge = r.badge_code ? (BADGE_LABELS[r.badge_code] ?? null) : null
      recent.push({ id: `rec_${r.id}`, person: giver,
        title: badge ? `${giver} recognised ${fullName(who)} — ${badge}` : `${giver} recognised ${fullName(who)}` })
    }

    const rosterCount = (managerRow ? 1 : 0) + (peerRows as any[]).length + (reportRows as any[]).length
    const isManagerView = (reportRows as any[]).length > 0
    const sentence = rosterCount === 0
      ? 'Your team will appear here as it grows.'
      : `Your team — ${rosterCount} ${rosterCount === 1 ? 'person' : 'people'}${out.length ? `, ${out.length} out today` : ''}.`

    // Manager care-insight — "who might need support" (one, gentle, silent otherwise).
    let manager: { insight?: string } | null = null
    if (isManagerView) {
      const lastLeave = await safe(fastify.supabase.from('leave_requests')
        .select('employee_id, to_date').eq('tenant_id', tenantId).in('status', ['approved', 'APPROVED'])
        .in('employee_id', (reportRows as any[]).map(r => r.id)).order('to_date', { ascending: false }).limit(200)
        .then(r => (r.data ?? []) as any[]), [] as any[])
      const lastByEmp = new Map<string, string>()
      for (const l of lastLeave as any[]) if (!lastByEmp.has(l.employee_id)) lastByEmp.set(l.employee_id, l.to_date)
      const longAgo = Date.now() - 75 * 86_400_000
      const needsBreak = (reportRows as any[]).find(r => {
        const last = lastByEmp.get(r.id)
        return !last || new Date(last).getTime() < longAgo
      })
      if (needsBreak) manager = { insight: `${fullName(needsBreak)} hasn't taken a break in a while — worth a check-in.` }
    }

    return reply.send({
      focus: { sentence },
      roster: {
        manager: managerRow ? { ...party(managerRow), subtitle: 'manager' } : null,
        peers: (peerRows as any[]).map(party),
        reports: (reportRows as any[]).map(party),
      },
      today: { celebrations, out },
      recent,
      manager,
    })
  })
}
