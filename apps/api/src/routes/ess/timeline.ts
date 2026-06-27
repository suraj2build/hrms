/**
 * GET /ess/timeline — the Timeline experience: the employee's MEMORY, told as a
 * biography rather than an audit trail.
 *
 * A pure STORY LENS over the canonical Event stream (events.ts) — it re-queries no
 * source tables for the stream itself, defines no Timeline-specific event contract,
 * and owns no storage. The Experience Core and the Event Model are frozen; only the
 * *telling* evolves here. This lens does four things the raw stream does not:
 *
 *   1. SELECTS  — memory is selective. Only events worth remembering survive
 *                 ("would I tell another person about this?"). Company announcements
 *                 and routine noise are dropped or folded.
 *   2. TELLS    — records become stories. "Payslip released" → folded; a long break
 *                 → "You took 5 days off". Context is used where genuine, never faked.
 *   3. COMPRESSES — repetition collapses. 24 payslip rows become one quiet, expandable
 *                 chapter summary. Compress repetition, expand meaning.
 *   4. CHAPTERS — the journey divides itself into narrative eras (Joining, Settling
 *                 in, year chapters) so it reads as a life, not an endless scroll.
 *
 * It orders by time and IGNORES severity — the discipline that keeps this Timeline
 * and not Notifications, from the same well (EXPERIENCE_EVENT_MODEL.md §5). Rows
 * carry NO deep-links: a memory is felt, not clicked through (refinement principle 5).
 */

import type { FastifyInstance } from 'fastify'
import { projectEvents, type ExperienceEvent } from './events.js'
import { projectJourney, type JourneyStep } from './journey.js'

// The Story-view item — Patterns §3.3 Event projection. No href: memories don't eject.
interface StoryItem {
  id:         string
  type:       string
  title:      string
  body?:      string
  at:         string
  person?:    string
  milestone?: boolean
}
interface ProgressBand { heading: string; ambient: string; hints: { label: string; value: string }[] }

interface Chapter {
  key:      string
  title:    string
  order:    number          // newest event time in the chapter — client sorts desc
  events:   StoryItem[]      // the memorable rows (faces, milestones, real breaks)
  folded:   StoryItem[]      // routine rows compressed behind a summary (expandable)
  progress?: ProgressBand
}

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Leave types that denote a life moment — told specifically (their own type name, never invented).
const LIFE_LEAVE = /maternity|paternity|marriage|wedding|bereavement|sabbatical|adoption|honeymoon/i
const SICK_LEAVE = /sick|medical/i

function daysBetween(from?: string, to?: string): number {
  if (!from || !to) return 1
  const a = new Date(from + 'T00:00:00Z').getTime(), b = new Date(to + 'T00:00:00Z').getTime()
  if (isNaN(a) || isNaN(b)) return 1
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1)
}
function monthYear(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
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

/** Which narrative chapter (era) an event belongs to. */
function chapterOf(at: string, join: string | null, now: Date): { key: string; title: string } {
  const d = new Date(at)
  if (join) {
    const jd = new Date(join.length <= 10 ? join + 'T00:00:00Z' : join)
    if (!isNaN(jd.getTime())) {
      const days = (d.getTime() - jd.getTime()) / 86_400_000
      if (days <= 90)  return { key: 'joining',  title: 'Joining' }
      if (days <= 365) return { key: 'settling', title: 'Settling in' }
    }
  }
  const y = d.getFullYear()
  return { key: `y-${y}`, title: y === now.getFullYear() ? 'This year' : String(y) }
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
    const limit  = req.query?.limit ? Number(req.query.limit) : 60
    const firstPage = !cursor
    const now = new Date()

    // The canonical stream + the shared Growth-spine projector (one source of the
    // "firsts" and the Journey — no duplicated milestone logic).
    const [{ events, nextCursor }, emp, jr] = await Promise.all([
      projectEvents(fastify, { tenantId, employeeId, cursor, limit }),
      employeeId
        ? safe(fastify.supabase.from('employees').select('joining_date')
            .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle().then(r => r.data as any), null)
        : Promise.resolve(null),
      projectJourney(fastify, { tenantId, employeeId, now }),
    ])
    const join = (emp?.joining_date as string | null) ?? null
    const firstSlipId  = jr.firstSlipId
    const firstKudosId = jr.firstKudosId

    // ── Tell each event as a story; decide what's a memory vs routine noise. ──
    // Returns null to DROP (not worth remembering), { item, folded } otherwise.
    function tell(e: ExperienceEvent): { item: StoryItem; folded: boolean } | null {
      const base = { id: e.id, at: e.at }

      switch (e.action) {
        // Company news is not personal memory — it lives on Home/Community, not here.
        case 'announcement.posted':
          return null

        case 'recognition.received': {
          const first = !!firstKudosId && e.id === `rec:${firstKudosId}`
          return { item: { ...base, type: 'recognition',
            title: first ? `Your first recognition — ${e.narrative}` : e.narrative,
            body: e.context.message ? `“${e.context.message}”` : undefined,
            person: e.actor?.name, milestone: first || undefined }, folded: false }
        }
        case 'recognition.given':
          return { item: { ...base, type: 'recognition', title: e.narrative, person: e.relatedPeople[0]?.name }, folded: false }

        case 'leave.approved': {
          const days = daysBetween(String(e.context.from || ''), String(e.context.to || ''))
          const lt = String(e.context.leave_type || 'leave')
          let title: string
          if (LIFE_LEAVE.test(lt))      title = `You took ${lt.toLowerCase()}`
          else if (SICK_LEAVE.test(lt)) title = days >= 2 ? `You took ${days} days of sick leave` : 'You took a sick day'
          else                          title = days >= 2 ? `You took ${days} days off` : 'You took a day off'
          // Single routine days fold into the chapter summary; real breaks & life moments stay.
          const folded = days < 2 && !LIFE_LEAVE.test(lt)
          const body = e.context.from && e.context.to && e.context.from !== e.context.to
            ? `${monthYear(String(e.context.from))}`
            : undefined
          return { item: { ...base, type: 'leave', title, body, milestone: LIFE_LEAVE.test(lt) || undefined }, folded }
        }

        case 'payroll.released': {
          const first = firstSlipId && e.id === `payroll:${firstSlipId}`
          if (first) return { item: { ...base, type: 'payroll', title: 'Your first payslip — welcome aboard.', milestone: true }, folded: false }
          // Routine pay folds into the chapter summary (compress repetition, expand meaning).
          return { item: { ...base, type: 'payroll', title: `${e.context.month ?? 'Monthly'} payslip`,
            body: e.context.net_pay != null ? `Net ₹${Number(e.context.net_pay).toLocaleString('en-IN')}` : undefined }, folded: true }
        }

        case 'employee.joined':
          return { item: { ...base, type: 'lifecycle', title: 'You joined the team', milestone: true }, folded: false }
        case 'employee.anniversary':
          return { item: { ...base, type: 'lifecycle', title: e.narrative, milestone: true }, folded: false }

        default:
          return { item: { ...base, type: e.category, title: e.narrative }, folded: false }
      }
    }

    // ── Group into narrative chapters. ──
    const chapMap = new Map<string, Chapter>()
    for (const e of events) {
      const told = tell(e)
      if (!told) continue
      const c = chapterOf(e.at, join, now)
      let chap = chapMap.get(c.key)
      if (!chap) { chap = { key: c.key, title: c.title, order: 0, events: [], folded: [] }; chapMap.set(c.key, chap) }
      ;(told.folded ? chap.folded : chap.events).push(told.item)
      chap.order = Math.max(chap.order, new Date(e.at).getTime())
    }
    const chapters = [...chapMap.values()].sort((a, b) => b.order - a.order)

    // ── First-page framing: Focus · Reflection · Progress · origin. ──
    let focus: { eyebrow: string; sentence: string } | null = null
    let reflection: { insight: string | null; kind?: string } | null = null
    let origin: { joined_at: string; label: string; first_day: boolean } | null = null
    let journey: JourneyStep[] = []

    if (firstPage) {
      const tenure = tenureWords(join, now)
      const brandNew = !tenure || tenure === 'less than a month'

      focus = {
        eyebrow: 'YOUR JOURNEY',
        sentence: brandNew
          ? 'Welcome. Everything from here becomes part of your story.'
          : `${tenure![0]!.toUpperCase()}${tenure!.slice(1)} with the team. Here's the story so far.`,
      }

      const yearStart = `${now.getFullYear()}-01-01`
      const [givenYr, recvYr] = employeeId ? await Promise.all([
        safe(fastify.supabase.from('recognition').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('from_employee', employeeId).gte('created_at', yearStart).then(r => r.count ?? 0), 0),
        safe(fastify.supabase.from('recognition').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('to_employee', employeeId).gte('created_at', yearStart).then(r => r.count ?? 0), 0),
      ]) : [0, 0]

      if ((givenYr as number) >= 3) {
        reflection = { insight: `You've recognised teammates ${givenYr} times this year — that generosity gets noticed.`, kind: 'generosity' }
      } else if ((recvYr as number) >= 3) {
        reflection = { insight: `Your work's been seen — ${recvYr} recognitions came your way this year.`, kind: 'recognised' }
      } else if (!brandNew) {
        reflection = { insight: `${tenure![0]!.toUpperCase()}${tenure!.slice(1)} ago, this is where it all began.`, kind: 'tenure' }
      } else {
        reflection = { insight: null }   // silence — never manufacture significance
      }

      const hints: { label: string; value: string }[] = []
      if ((recvYr  as number) > 0) hints.push({ label: 'Recognised this year', value: String(recvYr) })
      if ((givenYr as number) > 0) hints.push({ label: 'Kudos you gave', value: String(givenYr) })
      if (hints.length && chapters.length) {
        chapters[0]!.progress = { heading: 'This year so far', ambient: 'Momentum worth noticing — keep going.', hints }
      }

      // Journey (the Growth spine) — from the shared projector. Show only a real arc.
      if (jr.steps.length >= 2) journey = jr.steps
    }

    // Origin (Closure) — forward-looking on day one, retrospective once there's a journey.
    const joinEvt = events.find(e => e.action === 'employee.joined')
    if (joinEvt) {
      const days = join ? (now.getTime() - new Date(join.length <= 10 ? join + 'T00:00:00Z' : join).getTime()) / 86_400_000 : 999
      origin = days <= 31
        ? { joined_at: joinEvt.at, label: 'Day one. This is where your story begins.', first_day: true }
        : { joined_at: joinEvt.at, label: 'This is where it began.', first_day: false }
    }

    return reply.send({ focus, reflection, journey, chapters, nextCursor, origin })
  })
}
