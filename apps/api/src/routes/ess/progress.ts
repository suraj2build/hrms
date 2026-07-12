/**
 * GET /ess/progress — the "My Progress" Experience Core Service.
 *
 * Answers Home's Movement 7 question: "Am I doing well?" — and answers it the
 * way a thoughtful colleague would, not a report. It returns ONE warm,
 * encouraging headline plus a few momentum hints (words, not gauges), all
 * PROJECTED from data the platform already records: attendance history
 * (on-time streaks, consistency) and recognition given (generosity).
 *
 * Design contract (EXPERIENCE_HOME_DESIGN.md §3.C / Movement 7):
 *   - Motivates, never reports. No charts, no grades, no down-ranking vs peers.
 *   - Celebrates EFFORT and DIRECTION, framed as momentum, never deficit.
 *   - Silence over noise: when there's nothing genuinely positive to say,
 *     `show: false` and Home hides the movement entirely.
 *
 * This is also the first carrier of the MEMORY layer (§3.D), Phase 1 —
 * streaks and month-over-month effort are derived on read; no new storage.
 *
 * Scope: tenant + self enforced server-side.
 */

import type { FastifyInstance } from 'fastify'

interface ProgressHint { label: string; value: string }
interface ProgressPayload {
  show:    boolean
  heading: string
  ambient: string
  hints:   ProgressHint[]
}

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}
function daysAgoISO(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/**
 * On-time streak: walk recent working days newest-first, counting consecutive
 * 'present' days. Non-working rows (weekend / holiday) are skipped, not broken;
 * a 'late' / 'absent' / 'half_day' ends the streak. Effort, framed kindly.
 */
function onTimeStreak(rows: { date: string; status: string }[]): number {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1))  // newest first
  let streak = 0
  for (const r of sorted) {
    const s = String(r.status ?? '').toLowerCase()
    if (s === 'weekend' || s === 'holiday') continue
    if (s === 'present') { streak++; continue }
    break
  }
  return streak
}

export default async function essProgressRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/progress', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data: profileRow } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    const employeeId = (profileRow as any)?.employee_id as string | null

    const empty: ProgressPayload = { show: false, heading: '', ambient: '', hints: [] }
    if (!employeeId) return reply.send(empty)

    const since30 = daysAgoISO(45)  // generous window so streaks can be long
    const since60 = daysAgoISO(62)  // covers this + previous calendar month

    const [attRows, recRows] = await Promise.all([
      safe(fastify.supabase.from('attendance_daily')
        .select('date, status')
        .eq('employee_id', employeeId).eq('tenant_id', tenantId)
        .gte('date', since30).order('date', { ascending: false }).limit(60)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      safe(fastify.supabase.from('recognition')
        .select('created_at')
        .eq('tenant_id', tenantId).eq('from_employee', employeeId)
        .gte('created_at', since60 + 'T00:00:00Z')
        .then(r => (r.data ?? []) as any[]), [] as any[]),
    ])

    const streak = onTimeStreak(attRows as { date: string; status: string }[])

    // Kudos given — this month vs last, to celebrate a rising generosity.
    const now = new Date()
    const thisMonth = monthKey(now)
    const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    let kudosThis = 0, kudosLast = 0
    for (const r of recRows as any[]) {
      const k = monthKey(new Date(r.created_at))
      if (k === thisMonth) kudosThis++
      else if (k === lastMonth) kudosLast++
    }

    // ── Choose ONE lead headline + ambient, ranked by what's most worth saying.
    // Each candidate is only eligible when it is GENUINELY positive (the
    // "earned, then shown" rule). If none qualify, the movement stays silent.
    const hints: ProgressHint[] = []
    let heading = ''
    let ambient = ''

    if (streak >= 3) {
      heading = streak >= 8 ? 'A strong, steady week' : 'You’re in a good rhythm'
      ambient = streak >= 8
        ? `You’ve shown up on time ${streak} days running — your steadiest stretch in a while.`
        : `That’s ${streak} days on time in a row — a good rhythm to keep.`
      hints.push({ label: 'On-time streak', value: `${streak} days` })
    }

    if (kudosThis > 0) {
      hints.push({ label: 'Kudos given', value: `${kudosThis} this month` })
      if (!ambient) {
        heading = 'You make people’s day'
        ambient = kudosThis > kudosLast && kudosLast >= 0
          ? `You’ve recognised ${kudosThis} teammate${kudosThis === 1 ? '' : 's'} this month — more than last. People notice.`
          : `You’ve recognised ${kudosThis} teammate${kudosThis === 1 ? '' : 's'} this month — a small thing that goes far.`
      } else if (kudosThis > kudosLast) {
        // Streak already leads; add generosity as a supporting note in the ambient.
        ambient += ` And you’ve been more generous with recognition than last month.`
      }
    }

    const show = ambient.length > 0
    return reply.send({ show, heading, ambient, hints: hints.slice(0, 3) } as ProgressPayload)
  })
}
