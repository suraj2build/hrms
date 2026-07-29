/**
 * GET /ess/events — the canonical Experience Event projection.
 *
 * THE single source of truth for employee-experience events (see
 * apps/web/EXPERIENCE_EVENT_MODEL.md, frozen). The Experience Core exposes Events
 * ONCE here; every surface — Timeline, Notifications, Home/Community/Manager/
 * Executive Activity, Reflection, Recognition, Audit Story — is a *consumer* that
 * filters + ranks + frames the same stream. No surface owns its own event shape;
 * there is no parallel activity model.
 *
 * `projectEvents()` is the shared projector: it reads + merges + normalises rows
 * the platform already owns (leave, payroll, recognition, announcements,
 * lifecycle) into `ExperienceEvent`. It writes nothing and invents no business
 * logic — project, don't own (EXPERIENCE_PATTERNS.md §6). `/ess/timeline` and any
 * later consumer import THIS function rather than re-querying source tables, so
 * projection logic is never duplicated.
 *
 * Scope: tenant + self enforced server-side, always fresh. `safe()` wraps every
 * sub-query so a failed source yields fewer events, never a 500.
 */

import type { FastifyInstance } from 'fastify'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── The canonical Event (EXPERIENCE_EVENT_MODEL.md §1) ──────────────────────────

export type EventCategory =
  | 'attendance' | 'leave' | 'payroll' | 'recognition'
  | 'announcement' | 'lifecycle' | 'document' | 'approval' | 'system'
export type Visibility = 'self' | 'team' | 'managers' | 'company' | 'executive'
export type Severity   = 'info' | 'success' | 'warn' | 'urgent'

export interface Party {
  id: string
  name: string
  subtitle?: string
  kind: 'employee' | 'manager' | 'system' | 'group'
}

export interface ExperienceEvent {
  id:            string
  actor:         Party | null
  subject:       Party
  relatedPeople: Party[]
  action:        string          // namespaced verb — 'leave.approved', 'recognition.received', …
  category:      EventCategory
  narrative:     string          // the human, people-aware sentence (already rendered)
  at:            string          // ISO-8601 — the one ordering clock
  context:       Record<string, string | number | boolean>
  deepLink:      string | null   // path RELATIVE to the ESS base (the client prefixes it)
  visibility:    Visibility
  severity:      Severity
  aiExplanation: string | null
  flags?:        { milestone?: boolean; actionable?: boolean; social?: boolean }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

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

export interface ProjectOpts {
  tenantId:   string
  employeeId: string | null
  cursor?:    string | null   // ISO — return events strictly older than this (keyset pagination)
  limit?:     number
}

/**
 * Project the canonical event stream for one employee (self scope). Newest-first,
 * cursor-paginated by timestamp. Source caps keep a deep history bounded; if reads
 * ever get heavy a materialised `experience_memory` read-model is introduced THEN
 * (EXPERIENCE_PATTERNS.md §6) — not pre-built.
 */
export async function projectEvents(
  fastify: FastifyInstance, opts: ProjectOpts,
): Promise<{ events: ExperienceEvent[]; nextCursor: string | null }> {
  const { tenantId, employeeId } = opts
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100)
  if (!employeeId) return { events: [], nextCursor: null }
  const CAP = 200  // per-source ceiling — bounds deep histories without storage
  // Tenant-local "today", anchored at UTC noon — anniversary milestones below
  // compare against this rather than the server's raw UTC clock, so they land
  // on the tenant's actual local calendar day instead of the UTC one.
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  const now = new Date(`${getLocalDate(new Date().toISOString(), tz)}T12:00:00Z`)

  const [me, leaves, slips, kudosIn, kudosOut, announcements] = await Promise.all([
    safe(fastify.supabase.from('employees')
      .select('id, first_name, last_name, joining_date')
      .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
      .then(r => r.data as any), null),
    safe(fastify.supabase.from('leave_requests')
      .select('id, from_date, to_date, status, approved_at, leave_types(name)')
      .eq('employee_id', employeeId).eq('tenant_id', tenantId).in('status', ['approved', 'APPROVED'])
      .order('approved_at', { ascending: false }).limit(CAP)
      .then(r => (r.data ?? []) as any[]), [] as any[]),
    safe(fastify.supabase.from('payroll_slips')
      .select('id, month, net_pay, status, updated_at')
      .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'finalized')
      .order('updated_at', { ascending: false }).limit(CAP)
      .then(r => (r.data ?? []) as any[]), [] as any[]),
    safe(fastify.supabase.from('recognition')
      .select('id, from_employee, badge_code, message, created_at')
      .eq('tenant_id', tenantId).eq('to_employee', employeeId)
      .order('created_at', { ascending: false }).limit(CAP)
      .then(r => (r.data ?? []) as any[]), [] as any[]),
    safe(fastify.supabase.from('recognition')
      .select('id, to_employee, badge_code, message, created_at')
      .eq('tenant_id', tenantId).eq('from_employee', employeeId)
      .order('created_at', { ascending: false }).limit(CAP)
      .then(r => (r.data ?? []) as any[]), [] as any[]),
    safe(fastify.supabase.from('feed_posts')
      .select('id, body, created_at')
      .eq('tenant_id', tenantId).eq('status', 'active').eq('type', 'announcement')
      .order('created_at', { ascending: false }).limit(50)
      .then(r => (r.data ?? []) as any[]), [] as any[]),
  ])

  // Resolve faces for the recognition graph (givers received-from, receivers given-to).
  const personIds = new Set<string>()
  for (const k of kudosIn  as any[]) if (k.from_employee) personIds.add(k.from_employee)
  for (const k of kudosOut as any[]) if (k.to_employee)   personIds.add(k.to_employee)
  const nameMap = new Map<string, string>()
  if (personIds.size) {
    const people = await safe(fastify.supabase.from('employees')
      .select('id, first_name, last_name').eq('tenant_id', tenantId).in('id', [...personIds])
      .then(r => (r.data ?? []) as any[]), [] as any[])
    for (const p of people as any[]) nameMap.set(p.id, fullName(p))
  }

  const subject: Party = { id: employeeId, name: me ? fullName(me) : 'You', kind: 'employee' }
  const events: ExperienceEvent[] = []

  // Leave approved — an approval in the journey.
  for (const lv of leaves as any[]) {
    const lt = Array.isArray(lv.leave_types) ? lv.leave_types[0] : lv.leave_types
    const at = lv.approved_at || (lv.to_date ? lv.to_date + 'T00:00:00Z' : null)
    if (!at) continue
    events.push({
      id: `leave:${lv.id}`, actor: null, subject, relatedPeople: [],
      action: 'leave.approved', category: 'leave',
      narrative: `Your ${lt?.name ?? 'leave'} was approved`, at,
      context: { from: lv.from_date ?? '', to: lv.to_date ?? '', leave_type: lt?.name ?? 'Leave' },
      deepLink: '/leave/balance', visibility: 'self', severity: 'success', aiExplanation: null,
    })
  }
  // Payroll released.
  for (const s of slips as any[]) {
    if (!s.updated_at) continue
    events.push({
      id: `payroll:${s.id}`, actor: null, subject, relatedPeople: [],
      action: 'payroll.released', category: 'payroll',
      narrative: `Your ${s.month} payslip was released`, at: s.updated_at,
      context: s.net_pay != null ? { month: s.month ?? '', net_pay: Number(s.net_pay) } : { month: s.month ?? '' },
      deepLink: '/compensation', visibility: 'self', severity: 'success', aiExplanation: null,
    })
  }
  // Recognition received — a face, warm.
  for (const k of kudosIn as any[]) {
    if (!k.created_at) continue
    const giver = nameMap.get(k.from_employee) ?? 'A colleague'
    const badge = k.badge_code ? (BADGE_LABELS[k.badge_code] ?? null) : null
    const actor: Party = { id: k.from_employee ?? 'system', name: giver, kind: 'employee' }
    events.push({
      id: `rec:${k.id}`, actor, subject, relatedPeople: [actor],
      action: 'recognition.received', category: 'recognition',
      narrative: badge ? `${giver} recognised you as ${badge}` : `${giver} recognised you`,
      at: k.created_at,
      context: k.message ? { message: String(k.message).slice(0, 140), badge: k.badge_code ?? '' } : { badge: k.badge_code ?? '' },
      deepLink: '/recognition', visibility: 'self', severity: 'info', aiExplanation: null, flags: { social: true },
    })
  }
  // Recognition given — generosity is part of the story too.
  for (const k of kudosOut as any[]) {
    if (!k.created_at) continue
    const rcv = nameMap.get(k.to_employee) ?? 'a teammate'
    const rcvParty: Party = { id: k.to_employee ?? 'system', name: rcv, kind: 'employee' }
    events.push({
      id: `recout:${k.id}`, actor: subject, subject, relatedPeople: [rcvParty],
      action: 'recognition.given', category: 'recognition',
      narrative: `You recognised ${rcv}`, at: k.created_at,
      context: { badge: k.badge_code ?? '' },
      deepLink: '/recognition', visibility: 'self', severity: 'info', aiExplanation: null, flags: { social: true },
    })
  }
  // Company announcements — company-visibility events.
  for (const a of announcements as any[]) {
    if (!a.created_at) continue
    events.push({
      id: `ann:${a.id}`, actor: null, subject: { id: 'company', name: 'Company', kind: 'group' }, relatedPeople: [],
      action: 'announcement.posted', category: 'announcement',
      narrative: 'Company announcement', at: a.created_at,
      context: { body: String(a.body ?? '').slice(0, 140) },
      deepLink: '/community', visibility: 'company', severity: 'info', aiExplanation: null,
    })
  }
  // Lifecycle — the origin and the anniversaries (the chapter breaks of the story).
  const join = (me?.joining_date as string | null) ?? null
  if (join) {
    const joinAt = join.length <= 10 ? join + 'T00:00:00Z' : join
    const jd = new Date(joinAt)
    if (!isNaN(jd.getTime())) {
      events.push({
        id: `join:${employeeId}`, actor: null, subject, relatedPeople: [],
        action: 'employee.joined', category: 'lifecycle',
        narrative: 'You joined the team', at: joinAt,
        context: { joining_date: join }, deepLink: null, visibility: 'self', severity: 'success',
        aiExplanation: null, flags: { milestone: true },
      })
      const years = Math.floor((now.getTime() - jd.getTime()) / (365.25 * 86_400_000))
      for (let y = 1; y <= years; y++) {
        const a = new Date(jd); a.setUTCFullYear(jd.getUTCFullYear() + y)
        if (a.getTime() > now.getTime()) break
        events.push({
          id: `anniv:${employeeId}:${y}`, actor: null, subject, relatedPeople: [],
          action: 'employee.anniversary', category: 'lifecycle',
          narrative: y === 1 ? 'Your first work anniversary' : `Your ${y}-year work anniversary`,
          at: a.toISOString(), context: { years: y }, deepLink: null, visibility: 'self',
          severity: 'success', aiExplanation: null, flags: { milestone: true },
        })
      }
    }
  }

  // One clock, newest-first.
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  // Keyset cursor — strictly older than the cursor timestamp.
  const filtered = opts.cursor
    ? events.filter(e => new Date(e.at).getTime() < new Date(opts.cursor!).getTime())
    : events
  const page = filtered.slice(0, limit)
  const nextCursor = filtered.length > limit ? page[page.length - 1]!.at : null
  return { events: page, nextCursor }
}

// ── The raw consumer endpoint ───────────────────────────────────────────────────

export default async function essEventsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/events', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { data: profileRow, error: profileErr } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    if (profileErr) return serverError(req, reply, profileErr, ErrorCode.QUERY_FAILED, 'Failed to resolve employee profile')
    const employeeId = (profileRow as any)?.employee_id ?? null

    const cursor = (req.query?.cursor as string) || null
    const limit  = req.query?.limit ? Number(req.query.limit) : 40

    const out = await projectEvents(fastify, { tenantId, employeeId, cursor, limit })
    return reply.send(out)
  })
}
