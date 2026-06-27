/**
 * GET /ess/timeline — the Timeline experience: the employee's MEMORY.
 *
 * Timeline is not a log, not an audit report, not an activity table. It is the
 * story of the employee's journey (EXPERIENCE_TIMELINE_DESIGN.md). It is a PURE
 * STORY LENS over the canonical Event stream — it imports `projectEvents` from
 * the one Experience Core projection (events.ts) and re-queries no source tables,
 * defines no Timeline-specific event contract, and owns no storage. It only
 * *frames* events as a narrative: time-grouped, milestones chaptered, one
 * memory-aware reflection, a journey-framing focus, and a warm origin at the end.
 *
 * Distinction held (EXPERIENCE_EVENT_MODEL.md §5): the Story lens orders by time
 * and IGNORES severity (memory has no urgency). That is what makes this Timeline
 * and not Notifications, though both drink from the same well.
 *
 * Returns the Patterns §3.3 `Event` *view* of each canonical event so the shared
 * `ActivityItem` renders them unchanged.
 */

import type { FastifyInstance } from 'fastify'
import { projectEvents, type ExperienceEvent } from './events.js'

// The Story-view item — Patterns §3.3 Event projection of a canonical ExperienceEvent.
interface StoryItem {
  id:         string
  type:       string            // ← category (ActivityItem is type-agnostic)
  title:      string            // ← narrative
  body?:      string            // ← humanised context
  at:         string
  person?:    string            // ← the "other" face (giver received / receiver given)
  milestone?: boolean           // ← flags.milestone (chapter break)
  href?:      string            // ← deepLink
}
interface ProgressBand {
  heading: string
  ambient: string
  hints:   { label: string; value: string }[]
}
interface TimeGroup {
  key:       string
  label:     string
  progress?: ProgressBand
  events:    StoryItem[]
}

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

/** Humanise a context value into one short detail line. */
function detailFor(e: ExperienceEvent): string | undefined {
  switch (e.action) {
    case 'leave.approved': {
      const from = e.context.from, to = e.context.to
      return from && to ? `${from} → ${to}` : undefined
    }
    case 'payroll.released':
      return e.context.net_pay != null ? `Net ₹${Number(e.context.net_pay).toLocaleString('en-IN')}` : undefined
    case 'recognition.received':
      return e.context.message ? `“${e.context.message}”` : undefined
    case 'announcement.posted':
      return e.context.body ? String(e.context.body) : undefined
    default:
      return undefined
  }
}

/** The "other" person whose face belongs on this row (not the subject themselves). */
function faceFor(e: ExperienceEvent): string | undefined {
  if (e.actor && e.actor.kind === 'employee' && e.actor.id !== e.subject.id) return e.actor.name
  const r = e.relatedPeople[0]
  if (r && r.kind === 'employee' && r.id !== e.subject.id) return r.name
  return undefined
}

function toStory(e: ExperienceEvent): StoryItem {
  return {
    id: e.id, type: e.category, title: e.narrative,
    body: detailFor(e), at: e.at, person: faceFor(e),
    milestone: e.flags?.milestone || undefined,
    href: e.deepLink ?? undefined,
  }
}

/** Bucket an event into a human time-group, newest periods first. */
function groupOf(at: string, now: Date): { key: string; label: string } {
  const d = new Date(at)
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return { key: 'today', label: 'Today' }
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 7) return { key: 'week', label: 'This week' }
  if (d.getFullYear() === now.getFullYear()) {
    return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()]! }
  }
  return { key: `y-${d.getFullYear()}`, label: String(d.getFullYear()) }
}

/** Tenure in words from a join date. */
function tenureWords(join: string | null, now: Date): string | null {
  if (!join) return null
  const jd = new Date(join.length <= 10 ? join + 'T00:00:00Z' : join)
  if (isNaN(jd.getTime())) return null
  let months = (now.getFullYear() - jd.getFullYear()) * 12 + (now.getMonth() - jd.getMonth())
  if (now.getDate() < jd.getDate()) months -= 1
  if (months < 1) return 'less than a month'
  const y = Math.floor(months / 12), m = months % 12
  const yp = y ? `${y} year${y > 1 ? 's' : ''}` : ''
  const mp = m ? `${m} month${m > 1 ? 's' : ''}` : ''
  return [yp, mp].filter(Boolean).join(' and ') || 'a month'
}

export default async function essTimelineRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/timeline', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { data: profileRow } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    const employeeId = (profileRow as any)?.employee_id ?? null

    const cursor = (req.query?.cursor as string) || null
    const limit  = req.query?.limit ? Number(req.query.limit) : 40
    const firstPage = !cursor

    const { events, nextCursor } = await projectEvents(fastify, { tenantId, employeeId, cursor, limit })
    const now = new Date()

    // Group into the narrative (newest-first; groups in first-seen order).
    const groupMap = new Map<string, TimeGroup>()
    for (const e of events) {
      const g = groupOf(e.at, now)
      let grp = groupMap.get(g.key)
      if (!grp) { grp = { key: g.key, label: g.label, events: [] }; groupMap.set(g.key, grp) }
      grp.events.push(toStory(e))
    }
    const groups = [...groupMap.values()]

    // First-page framing only — Focus, Reflection, Progress, and the origin marker.
    let focus: { eyebrow: string; sentence: string } | null = null
    let reflection: { insight: string | null; kind?: string } | null = null
    let origin: { joined_at: string; label: string } | null = null

    if (firstPage) {
      const emp = employeeId
        ? await safe(fastify.supabase.from('employees')
            .select('joining_date').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
            .then(r => r.data as any), null)
        : null
      const join = (emp?.joining_date as string | null) ?? null
      const tenure = tenureWords(join, now)

      // Focus — the journey framing (no action; this Focus orients).
      focus = {
        eyebrow: 'YOUR TIMELINE',
        sentence: tenure && tenure !== 'less than a month'
          ? `${tenure[0]!.toUpperCase()}${tenure.slice(1)} with the team. Here's the story so far.`
          : 'Welcome — your story here is just beginning.',
      }

      // Accurate counts for Reflection + Progress (cheap, scoped to this year).
      const yearStart = `${now.getFullYear()}-01-01`
      const [givenYr, recvYr] = employeeId ? await Promise.all([
        safe(fastify.supabase.from('recognition').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('from_employee', employeeId).gte('created_at', yearStart)
          .then(r => r.count ?? 0), 0),
        safe(fastify.supabase.from('recognition').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('to_employee', employeeId).gte('created_at', yearStart)
          .then(r => r.count ?? 0), 0),
      ]) : [0, 0]

      // Reflection — one memory-aware insight, ranked. Speaks across time, never a bare number.
      if ((givenYr as number) >= 3) {
        reflection = { insight: `You've recognised teammates ${givenYr} times this year — that generosity gets noticed.`, kind: 'generosity' }
      } else if ((recvYr as number) >= 3) {
        reflection = { insight: `Your work's been seen — ${recvYr} recognitions came your way this year.`, kind: 'recognised' }
      } else if (tenure && tenure !== 'less than a month') {
        reflection = { insight: `${tenure[0]!.toUpperCase()}${tenure.slice(1)} ago, this is where it all began.`, kind: 'tenure' }
      } else {
        reflection = { insight: null }
      }

      // Progress — light encouragement on the most recent group (never a scorecard).
      const hints: { label: string; value: string }[] = []
      if ((recvYr  as number) > 0) hints.push({ label: 'Recognised this year', value: String(recvYr) })
      if ((givenYr as number) > 0) hints.push({ label: 'Kudos you gave', value: String(givenYr) })
      if (hints.length && groups.length) {
        groups[0]!.progress = { heading: 'This year so far', ambient: 'Momentum worth noticing — keep going.', hints }
      }
    }

    // Origin (Closure) — surfaces when the join event is on this page (the deep end).
    const joinEvt = events.find(e => e.action === 'employee.joined')
    if (joinEvt) origin = { joined_at: joinEvt.at, label: 'This is where it began.' }

    return reply.send({ focus, reflection, groups, nextCursor, origin })
  })
}
