/**
 * GET /ess/activity — the "what happened" Experience Core Service (today scope).
 *
 * Answers Home's second question: "What happened?" A lightweight, recent
 * activity feed PROJECTED from events the platform already records — attendance,
 * leave decisions, salary release, recognition received, peer birthdays,
 * company announcements. No new storage, reads + merges + sorts only.
 *
 * This is NOT the full Timeline (a later surface). It is the minimum the Home
 * "What happened today" block needs — the Experience Core grows only when a
 * visible block requires it.
 *
 * Scope: tenant + self enforced server-side. Window: last 2 days for personal
 * events (so an early-morning open isn't empty), today for peer birthdays.
 */

import type { FastifyInstance } from 'fastify'

type ActivityType = 'attendance' | 'leave' | 'payroll' | 'recognition' | 'birthday' | 'announcement'

interface ActivityEvent {
  id:    string
  type:  ActivityType
  title: string
  body?: string
  at:    string  // ISO timestamp for sorting + relative display
  /** The person this event is about (for a face) — recognition giver, birthday colleague. */
  person?: string
}

function todayISO(): string { return new Date().toISOString().slice(0, 10) }
function daysAgoISO(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString()
}
function fullName(e: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!e) return 'A colleague'
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'A colleague'
}
function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}

export default async function essActivityRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/activity', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data: profileRow } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    const employeeId = (profileRow as any)?.employee_id as string | null

    const today  = todayISO()
    const since  = daysAgoISO(2)
    const todayMMDD = today.slice(5)  // MM-DD

    const [todayAtt, approvedLeave, salary, kudos, announcements, colleagues] = await Promise.all([
      employeeId
        ? safe(fastify.supabase.from('attendance_logs').select('check_in, check_out')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .gte('check_in', today).lte('check_in', today + 'T23:59:59.999Z')
            .order('check_in', { ascending: true }).limit(1).maybeSingle()
            .then(r => r.data as any), null)
        : Promise.resolve(null),
      employeeId
        ? safe(fastify.supabase.from('leave_requests')
            .select('id, from_date, to_date, status, approved_at, leave_types(name)')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .in('status', ['approved', 'APPROVED']).gte('approved_at', since)
            .order('approved_at', { ascending: false }).limit(3)
            .then(r => (r.data ?? []) as any[]), [] as any[])
        : Promise.resolve([] as any[]),
      employeeId
        ? safe(fastify.supabase.from('payroll_slips')
            .select('id, month, net_pay, status, updated_at')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .eq('status', 'finalized').gte('updated_at', daysAgoISO(7))
            .order('updated_at', { ascending: false }).limit(1)
            .then(r => (r.data ?? []) as any[]), [] as any[])
        : Promise.resolve([] as any[]),
      employeeId
        ? safe(fastify.supabase.from('recognition')
            .select('id, from_employee, badge_code, message, created_at')
            .eq('tenant_id', tenantId).eq('to_employee', employeeId).gte('created_at', since)
            .order('created_at', { ascending: false }).limit(3)
            .then(r => (r.data ?? []) as any[]), [] as any[])
        : Promise.resolve([] as any[]),
      safe(fastify.supabase.from('feed_posts')
        .select('id, type, body, created_at')
        .eq('tenant_id', tenantId).eq('status', 'active').eq('type', 'announcement')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(3)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      safe(fastify.supabase.from('employees')
        .select('id, first_name, last_name, dob')
        .eq('tenant_id', tenantId).eq('status', 'active').not('dob', 'is', null).limit(500)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
    ])

    const events: ActivityEvent[] = []

    // Attendance — your check-in/out today.
    if (todayAtt?.check_in) {
      events.push({
        id: 'att_in', type: 'attendance', title: 'You checked in', at: todayAtt.check_in,
        body: todayAtt.check_out ? 'Checked out for the day' : 'Have a great day',
      })
    }

    // Leave approved (recent).
    for (const lv of approvedLeave as any[]) {
      const lt = Array.isArray(lv.leave_types) ? lv.leave_types[0] : lv.leave_types
      events.push({
        id: `leave_${lv.id}`, type: 'leave', title: 'Your leave was approved',
        body: `${lt?.name ?? 'Leave'} · ${lv.from_date} → ${lv.to_date}`,
        at: lv.approved_at ?? since,
      })
    }

    // Salary released (recent finalized slip).
    const slip = (salary as any[])[0]
    if (slip) {
      events.push({
        id: `pay_${slip.id}`, type: 'payroll', title: 'Salary released',
        body: slip.net_pay != null ? `${slip.month} · net ₹${Number(slip.net_pay).toLocaleString('en-IN')}` : slip.month,
        at: slip.updated_at ?? since,
      })
    }

    // Recognition received (recent) — resolve giver names.
    const recRows = kudos as any[]
    if (recRows.length) {
      const giverIds = [...new Set(recRows.map(r => r.from_employee).filter(Boolean))]
      const giverMap = new Map<string, string>()
      if (giverIds.length) {
        const givers = await safe(fastify.supabase.from('employees')
          .select('id, first_name, last_name').eq('tenant_id', tenantId).in('id', giverIds)
          .then(r => (r.data ?? []) as any[]), [] as any[])
        for (const g of givers) giverMap.set(g.id, fullName(g))
      }
      for (const r of recRows) {
        const giver = giverMap.get(r.from_employee) ?? 'A colleague'
        events.push({
          id: `rec_${r.id}`, type: 'recognition', title: `${giver} recognized you`,
          body: r.message ? `"${String(r.message).slice(0, 80)}"` : undefined, at: r.created_at, person: giver,
        })
      }
    }

    // Company announcements (recent).
    for (const a of announcements as any[]) {
      events.push({
        id: `ann_${a.id}`, type: 'announcement', title: 'Company announcement',
        body: (a.body ?? '').slice(0, 100), at: a.created_at,
      })
    }

    // Peer birthdays today.
    for (const c of (colleagues as any[])) {
      if (c.id === employeeId) continue
      if (typeof c.dob === 'string' && c.dob.slice(5) === todayMMDD) {
        events.push({
          id: `bday_${c.id}`, type: 'birthday', title: `${fullName(c)}'s birthday today`,
          body: 'Send your wishes', at: today + 'T00:00:00Z', person: fullName(c),
        })
      }
    }

    // Newest first.
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

    return reply.send({ events: events.slice(0, 8) })
  })
}
