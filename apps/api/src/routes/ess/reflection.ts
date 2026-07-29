/**
 * GET /ess/reflection — the memory-aware AI reflection (Home Movement 9).
 *
 * Answers the question the employee didn't think to ask: "What should I know?"
 * Returns ONE genuine insight — a pattern, an explanation, or a gentle
 * recommendation — PROJECTED across the employee's own history, not just today.
 * This is the signature ambient moment (EXPERIENCE_HOME_DESIGN.md Movement 9)
 * and the richest carrier of the MEMORY layer (§3.D, Phase 1: derive-on-read).
 *
 * Candidates, ranked by what's most worth surfacing today:
 *   1. Pay changed   — "Your net pay rose ₹2,400 this month — incentive processed."
 *   2. Break overdue — "You usually take a break around now — you've earned one."
 *   3. On-time week  — "You've been perfectly on time every day this week."
 *
 * Tone: warm, brief, never robotic, never a number for its own sake. If nothing
 * genuine qualifies, returns insight: null and Home hides the panel.
 *
 * Scope: tenant + self. Memory is per-employee, self-only.
 */

import type { FastifyInstance } from 'fastify'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

interface Reflection {
  insight: string | null
  action?: { label: string; href: string }
  /** Which memory the insight drew on — for tests + light client styling. */
  kind?: 'pay' | 'break' | 'attendance'
}

function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}
function daysAgoISO(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86_400_000)
}

export default async function essReflectionRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/reflection', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data: profileRow, error: profileErr } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    if (profileErr) return serverError(req, reply, profileErr, ErrorCode.QUERY_FAILED, 'Failed to resolve employee profile')
    const employeeId = (profileRow as any)?.employee_id as string | null

    if (!employeeId) return reply.send({ insight: null } as Reflection)

    // Tenant-local "today" — the leave `to_date` comparison below is an exact
    // day-boundary filter, so the server's raw UTC clock would wrongly treat
    // an employee's actual local "today" as tomorrow for the first ~5.5 hours
    // of the day for an IST tenant, excluding a just-ended leave from the
    // "time since your last break" calculation.
    const tz = await fetchTenantTz(fastify.supabase, tenantId)
    const today = getLocalDate(new Date().toISOString(), tz)

    const [slips, lastLeave, attRows] = await Promise.all([
      // Last two finalized slips → pay delta (memory across pay cycles).
      safe(fastify.supabase.from('payroll_slips')
        .select('net_pay, month, status, updated_at')
        .eq('employee_id', employeeId).eq('tenant_id', tenantId)
        .eq('status', 'finalized')
        .order('month', { ascending: false }).limit(2)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      // Most recent approved leave that has ended → time since last break.
      safe(fastify.supabase.from('leave_requests')
        .select('to_date')
        .eq('employee_id', employeeId).eq('tenant_id', tenantId)
        .in('status', ['approved', 'APPROVED']).lte('to_date', today)
        .order('to_date', { ascending: false }).limit(1)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
      // Last ~10 days attendance → "on time all week" pattern.
      safe(fastify.supabase.from('attendance_daily')
        .select('date, status')
        .eq('employee_id', employeeId).eq('tenant_id', tenantId)
        .gte('date', daysAgoISO(9)).order('date', { ascending: false }).limit(14)
        .then(r => (r.data ?? []) as any[]), [] as any[]),
    ])

    // ── Candidate 1: pay changed (recently finalized, with a previous to compare)
    const slipRows = slips as any[]
    const latest = slipRows[0]
    const prev   = slipRows[1]
    const releasedRecently = latest
      && typeof latest.updated_at === 'string'
      && daysBetween(today, (latest.updated_at as string).slice(0, 10)) <= 5
    if (releasedRecently && latest.net_pay != null && prev?.net_pay != null) {
      const delta = Number(latest.net_pay) - Number(prev.net_pay)
      if (Math.abs(delta) >= 100) {
        const dir = delta > 0 ? 'rose' : 'changed by'
        const amt = `₹${Math.abs(delta).toLocaleString('en-IN')}`
        const insight = delta > 0
          ? `Your net pay ${dir} ${amt} this month — worth a look at what changed.`
          : `Your net pay ${dir} ${amt} this month — the breakdown explains why.`
        return reply.send({ insight, action: { label: 'View payslip', href: '/compensation' }, kind: 'pay' } as Reflection)
      }
    }

    // ── Candidate 2: break overdue (a long stretch since the last leave)
    const lastTo = (lastLeave as any[])[0]?.to_date as string | undefined
    const sinceBreak = lastTo ? daysBetween(today, lastTo) : null
    if (sinceBreak != null && sinceBreak >= 60) {
      const weeks = Math.round(sinceBreak / 7)
      return reply.send({
        insight: `It’s been about ${weeks} weeks since your last break — you usually take one around now, and you’ve earned it.`,
        action: { label: 'Plan some leave', href: '/leave/balance' }, kind: 'break',
      } as Reflection)
    }

    // ── Candidate 3: a clean on-time week
    const att = (attRows as any[]).map(r => String(r.status ?? '').toLowerCase())
      .filter(s => s !== 'weekend' && s !== 'holiday' && s !== 'weekly_off')
    if (att.length >= 4 && att.every(s => s === 'present')) {
      return reply.send({
        insight: `You’ve been perfectly on time every working day this week — quietly impressive.`,
        action: { label: 'View your week', href: '/attendance' }, kind: 'attendance',
      } as Reflection)
    }

    return reply.send({ insight: null } as Reflection)
  })
}
