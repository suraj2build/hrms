/**
 * Digest Builder (R9) — single source of truth for daily/weekly/monthly digests.
 *
 * Extracted from the GET /intelligence/digest/* routes so the same deterministic,
 * rule-based digest can be produced in two contexts:
 *   1. on demand, when an HR admin opens the digest page (the routes), and
 *   2. on a schedule, when the digest scheduler pushes it (lib/digest-scheduler).
 *
 * Every query is explicitly tenant-scoped — these run under the service-role
 * key (RLS bypassed), so the tenant_id filter is the isolation boundary.
 * No LLM calls; text is assembled from counts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate } from './org-context.js'

export type DigestFrequency = 'daily' | 'weekly' | 'monthly'

// Resolve "today" in the tenant's own timezone, not the server's (UTC) clock —
// between 00:00-05:29 IST the UTC calendar date is still yesterday, which
// shifted "new joiners today"/"this month" calculations by a day right at
// every day/month boundary (ISSUE-154 class).
export async function tenantTodayStr(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

// Add/subtract whole days from a YYYY-MM-DD string, staying UTC-anchored so
// the result doesn't depend on the server process's local TZ setting.
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export interface DigestResult {
  period:       DigestFrequency
  summary_text: string
  metrics:      Record<string, number>
  generated_at: string
  sources:      { table: string; description: string }[]
  /** Human label for the period this digest covers (e.g. '2026-06-14', '2026-06'). */
  period_label: string
}

async function count(
  supabase: SupabaseClient,
  table: string,
  build: (q: any) => any,
): Promise<number> {
  // A failed query must not be reported as "0" — that's indistinguishable
  // from a genuine zero and would ship a digest claiming e.g. "no pending
  // approvals" when the read actually errored. Let it propagate; both
  // callers (the on-demand routes and the scheduler's per-tenant loop)
  // already catch and surface/log failures rather than silently continuing.
  const { count, error } = await build(
    supabase.from(table).select('id', { count: 'exact', head: true }),
  )
  if (error) throw new Error(`digest count query failed on ${table}: ${error.message}`)
  return count ?? 0
}

// ── Daily ──────────────────────────────────────────────────────────────────
export async function buildDailyDigest(supabase: SupabaseClient, tenantId: string): Promise<DigestResult> {
  const now = new Date()
  const todayStr      = await tenantTodayStr(supabase, tenantId)
  const twentyFourAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const j = await count(supabase, 'employees',             q => q.eq('tenant_id', tenantId).eq('joining_date', todayStr))
  const s = await count(supabase, 'employee_separation',   q => q.eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', twentyFourAgo))
  const a = await count(supabase, 'employee_asset_ledger', q => q.eq('tenant_id', tenantId).eq('action', 'assigned').gte('created_at', twentyFourAgo))
  const p = await count(supabase, 'leave_requests',        q => q.eq('tenant_id', tenantId).eq('status', 'PENDING'))

  const parts: string[] = [`Daily digest for ${todayStr}.`]
  if (j > 0) parts.push(`${j} new joiner${j > 1 ? 's' : ''} today.`)
  else        parts.push('No new joiners today.')
  if (s > 0) parts.push(`${s} separation${s > 1 ? 's' : ''} completed today.`)
  if (a > 0) parts.push(`${a} asset${a > 1 ? 's' : ''} assigned today.`)
  if (p > 0) parts.push(`${p} approval${p > 1 ? 's' : ''} pending.`)
  if (s === 0 && a === 0 && p === 0) parts.push('No outstanding actions.')

  return {
    period: 'daily',
    summary_text: parts.join(' '),
    metrics: { new_joiners_today: j, separations_today: s, assets_assigned_today: a, pending_approvals: p },
    generated_at: now.toISOString(),
    period_label: todayStr,
    sources: [
      { table: 'employees',             description: 'joining_date = today' },
      { table: 'employee_separation',   description: 'lifecycle_stage in (relieved, archived), last 24h' },
      { table: 'employee_asset_ledger', description: 'action=assigned last 24h' },
      { table: 'leave_requests',        description: 'status = pending' },
    ],
  }
}

// ── Weekly ─────────────────────────────────────────────────────────────────
export async function buildWeeklyDigest(supabase: SupabaseClient, tenantId: string): Promise<DigestResult> {
  const now = new Date()
  const sevenDaysAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const todayStr      = await tenantTodayStr(supabase, tenantId)
  const weekStart     = shiftDateStr(todayStr, -7)
  const ninetyDaysAgo = shiftDateStr(todayStr, -90)

  const j  = await count(supabase, 'employees',           q => q.eq('tenant_id', tenantId).gte('joining_date', weekStart))
  const e  = await count(supabase, 'employee_separation', q => q.eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', sevenDaysAgo.toISOString()))
  const o  = await count(supabase, 'onboarding_sessions', q => q.eq('tenant_id', tenantId).eq('status', 'employee_created').gte('updated_at', sevenDaysAgo.toISOString()))
  const pb = await count(supabase, 'employees',           q => q.eq('tenant_id', tenantId).eq('status', 'active').lte('joining_date', ninetyDaysAgo))

  const parts: string[] = [`Weekly digest — last 7 days (from ${weekStart}).`]
  parts.push(`${j} new joiner${j !== 1 ? 's' : ''} this week.`)
  if (e > 0) parts.push(`${e} exit${e !== 1 ? 's' : ''} this week.`)
  if (o > 0) parts.push(`${o} onboarding${o !== 1 ? 's' : ''} completed.`)
  if (pb > 0) parts.push(`${pb} probation review${pb !== 1 ? 's' : ''} due.`)
  if (e === 0 && pb === 0) parts.push('No exits or probation concerns this week.')

  return {
    period: 'weekly',
    summary_text: parts.join(' '),
    metrics: { joiners_7d: j, exits_7d: e, onboarding_completions_7d: o, probation_reviews_due: pb },
    generated_at: now.toISOString(),
    period_label: `week of ${weekStart}`,
    sources: [
      { table: 'employees',          description: 'joining_date last 7d; joining_date <= 90 days ago for probation' },
      { table: 'employee_separation', description: 'lifecycle_stage in (relieved, archived), last 7d' },
      { table: 'onboarding_sessions', description: 'status = employee_created, last 7d' },
    ],
  }
}

// ── Monthly ────────────────────────────────────────────────────────────────
export async function buildMonthlyDigest(supabase: SupabaseClient, tenantId: string): Promise<DigestResult> {
  const now = new Date()
  const todayStr      = await tenantTodayStr(supabase, tenantId)
  const [y, m]        = todayStr.split('-').map(Number)
  const monthStart    = `${y}-${String(m).padStart(2, '0')}-01`
  // Date.UTC (not new Date(y, m, 0), which anchors to the process's local TZ)
  // so month-end is correct regardless of the server process's TZ setting.
  const monthEnd      = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const ninetyDaysAgo = shiftDateStr(todayStr, -90)

  const headcount = await count(supabase, 'employees',           q => q.eq('tenant_id', tenantId).eq('status', 'active'))
  const joiners   = await count(supabase, 'employees',           q => q.eq('tenant_id', tenantId).gte('joining_date', monthStart).lte('joining_date', monthEnd))
  const exits     = await count(supabase, 'employee_separation', q => q.eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', monthStart))
  const probBacklog = await count(supabase, 'employees',         q => q.eq('tenant_id', tenantId).eq('status', 'active').lte('joining_date', ninetyDaysAgo))
  const netChange = joiners - exits
  const monthLabel = todayStr.slice(0, 7)

  const parts: string[] = [`Monthly digest for ${monthLabel}.`]
  parts.push(`Active headcount: ${headcount} employee${headcount !== 1 ? 's' : ''}.`)
  if (joiners > 0) parts.push(`${joiners} joined this month.`)
  if (exits > 0)   parts.push(`${exits} exited this month.`)
  if (netChange > 0)       parts.push(`Net headcount change: +${netChange}.`)
  else if (netChange < 0)  parts.push(`Net headcount change: ${netChange}.`)
  if (probBacklog > 0) parts.push(`${probBacklog} probation confirmation${probBacklog !== 1 ? 's' : ''} overdue.`)
  if (exits === 0 && probBacklog === 0) parts.push('No exits or probation concerns this month.')

  return {
    period: 'monthly',
    summary_text: parts.join(' '),
    metrics: { headcount, joiners_mtd: joiners, exits_mtd: exits, net_change: netChange, probation_backlog: probBacklog },
    generated_at: now.toISOString(),
    period_label: monthLabel,
    sources: [
      { table: 'employees',           description: 'active headcount; joining_date current month; probation backlog' },
      { table: 'employee_separation', description: 'lifecycle_stage in (relieved, archived), current month' },
    ],
  }
}

export function buildDigest(supabase: SupabaseClient, tenantId: string, frequency: DigestFrequency): Promise<DigestResult> {
  if (frequency === 'daily')   return buildDailyDigest(supabase, tenantId)
  if (frequency === 'weekly')  return buildWeeklyDigest(supabase, tenantId)
  return buildMonthlyDigest(supabase, tenantId)
}

/**
 * Period key for idempotency: daily=YYYY-MM-DD, weekly=YYYY-Www, monthly=YYYY-MM.
 * Takes the tenant-local "today" as a YYYY-MM-DD string (see `tenantTodayStr`)
 * rather than a bare `Date` — the digest content this key is stamped against
 * is itself built from the tenant's local calendar, so deriving the key from
 * the server's UTC clock instead would let the two silently disagree for any
 * non-UTC tenant (ISSUE-154 class).
 */
export function periodKey(frequency: DigestFrequency, localDateStr: string): string {
  if (frequency === 'daily') return localDateStr
  const [y, m, d] = localDateStr.split('-').map(Number)
  if (frequency === 'monthly') return `${y}-${String(m).padStart(2, '0')}`
  // ISO week number
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dayNum = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay()
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
