/**
 * GET /ess/signals — the Need lens ("what needs you").
 *
 * A Signal is a *current truth that may need the employee to act*, carrying a
 * contextual action. Home composes the top-3 *peek*; My Attention composes the full
 * set, grouped by INTENT (EXPERIENCE_ATTENTION_DESIGN.md). Reuse-first: projected
 * from data the platform already owns — no new storage, read + rank only.
 *
 * Each signal carries an `intent` so My Attention can group it:
 *   - needs_you  — your decision/action/review (approvals, missing punch, expiring doc)
 *   - can_wait   — low-urgency, still actionable
 *   - waiting    — your in-flight request (track only; you can't act)
 *   - info_only  — pure FYI; EXCLUDED from My Attention (it can't be "cleared", so it
 *                  would violate the shrink principle), but still available to Home.
 *
 * Manager approvals are surfaced people-first: individual pending requests with the
 * requester's face, scoped to direct reports (admins see tenant-wide).
 */

import type { FastifyInstance } from 'fastify'
import { getDirectReportIds } from '../../lib/manager-scope.js'
import { MANAGER_ROLES } from '../../lib/rbac.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

type Severity = 'info' | 'warning' | 'critical'
type Intent   = 'needs_you' | 'can_wait' | 'waiting' | 'info_only'

interface Signal {
  id:       string
  type:     'attendance' | 'approvals' | 'requests' | 'documents' | 'leave'
  severity: Severity
  priority: number
  intent:   Intent
  title:    string
  body?:    string
  person?:  string            // requester's name → a face on approval signals
  action?:  { label: string; href: string }
}

async function resolveToday(fastify: FastifyInstance, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}
function offsetISO(today: string, days: number): string {
  return new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
function isWeekend(today: string): boolean {
  const dow = new Date(`${today}T12:00:00Z`).getDay()
  return dow === 0 || dow === 6
}
function daysBetween(from?: string, to?: string): number {
  if (!from || !to) return 1
  const a = new Date(from + 'T00:00:00Z').getTime(), b = new Date(to + 'T00:00:00Z').getTime()
  if (isNaN(a) || isNaN(b)) return 1
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1)
}
function fullName(e: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!e) return 'A teammate'
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'A teammate'
}
function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}

export default async function essSignalsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/signals', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data: profileRow, error: profileErr } = await fastify.supabase
      .from('profiles').select('employee_id, role')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
    if (profileErr) return serverError(req, reply, profileErr, ErrorCode.QUERY_FAILED, 'Failed to resolve employee profile')

    const employeeId = (profileRow as any)?.employee_id as string | null
    const role       = (profileRow as any)?.role as string | null
    const isManager  = (MANAGER_ROLES as readonly string[]).includes(role ?? '')
    const isAdmin    = ['hr_admin', 'super_admin'].includes(role ?? '')

    const today    = await resolveToday(fastify, tenantId)
    const in30Days = offsetISO(today, 30)

    const [todayAtt, ownPendingLeave, ownPendingReg, expiringDocs, leaveBal, mgrLeaveRows, mgrReg] =
      await Promise.all([
        employeeId
          ? safe(fastify.supabase.from('attendance_logs').select('check_in, check_out')
              .eq('employee_id', employeeId).eq('tenant_id', tenantId)
              .gte('check_in', today).lte('check_in', today + 'T23:59:59.999Z')
              .order('check_in', { ascending: false }).limit(1).maybeSingle()
              .then(r => r.data as any), null)
          : Promise.resolve(null),
        employeeId
          // Fresh audit finding: leave_requests.status is uppercase-only per
          // its CHECK constraint (migration 041) — this compared against
          // lowercase 'pending', so this signal always read 0.
          ? safe(fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true })
              .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'PENDING')
              .then(r => r.count ?? 0), 0)
          : Promise.resolve(0),
        employeeId
          ? safe(fastify.supabase.from('attendance_regularisation').select('id', { count: 'exact', head: true })
              .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'pending')
              .then(r => r.count ?? 0), 0)
          : Promise.resolve(0),
        employeeId
          ? safe(fastify.supabase.from('documents').select('name, expires_at')
              .eq('employee_id', employeeId).eq('tenant_id', tenantId)
              .not('expires_at', 'is', null).gte('expires_at', today).lte('expires_at', in30Days)
              .order('expires_at').limit(3)
              .then(r => (r.data ?? []) as any[]), [] as any[])
          : Promise.resolve([] as any[]),
        employeeId
          ? safe(fastify.supabase.from('employee_leave_balance').select('balance')
              .eq('employee_id', employeeId).eq('tenant_id', tenantId)
              .then(r => (r.data ?? []) as any[]), [] as any[])
          : Promise.resolve([] as any[]),
        // Manager approvals — individual pending leave, scoped to reports (admins: tenant-wide).
        isManager && employeeId
          ? (async () => {
              let ids: string[] | null = null
              if (!isAdmin) {
                ids = await getDirectReportIds(fastify.supabase, tenantId, employeeId)
                if (!ids.length) return [] as any[]
              }
              // Fresh audit finding: same uppercase-only status fix as above.
              let q = fastify.supabase.from('leave_requests')
                .select('id, employee_id, from_date, to_date, leave_types(name)')
                .eq('tenant_id', tenantId).eq('status', 'PENDING').order('from_date').limit(6)
              if (ids) q = q.in('employee_id', ids)
              const { data } = await q
              return (data ?? []) as any[]
            })().catch(() => [] as any[])
          : Promise.resolve([] as any[]),
        isManager
          ? safe(fastify.supabase.from('attendance_regularisation').select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId).eq('status', 'pending')
              .then(r => r.count ?? 0), 0)
          : Promise.resolve(0),
      ])

    const signals: Signal[] = []

    // 1. Manager — team approvals, people-first (one card per requester, a face each).
    const apprRows = mgrLeaveRows as any[]
    if (apprRows.length) {
      const ids = [...new Set(apprRows.map(r => r.employee_id).filter(Boolean))]
      const nameMap = new Map<string, string>()
      if (ids.length) {
        const ppl = await safe(fastify.supabase.from('employees').select('id, first_name, last_name')
          .eq('tenant_id', tenantId).in('id', ids).then(r => (r.data ?? []) as any[]), [] as any[])
        for (const p of ppl as any[]) nameMap.set(p.id, fullName(p))
      }
      for (const r of apprRows.slice(0, 5)) {
        const who  = nameMap.get(r.employee_id) ?? 'A teammate'
        const lt   = Array.isArray(r.leave_types) ? r.leave_types[0] : r.leave_types
        const days = daysBetween(r.from_date, r.to_date)
        signals.push({
          id: `appr_${r.id}`, type: 'approvals', severity: 'warning', priority: 100, intent: 'needs_you',
          person: who,
          title: `${who} requested ${days} day${days > 1 ? 's' : ''}${lt?.name ? ` of ${String(lt.name).toLowerCase()}` : ' leave'}`,
          body: `${r.from_date} → ${r.to_date}`,
          action: { label: 'Review', href: '/flowdesk' },
        })
      }
      if (apprRows.length > 5) {
        signals.push({
          id: 'appr_more', type: 'approvals', severity: 'info', priority: 50, intent: 'can_wait',
          title: `${apprRows.length - 5} more approval${apprRows.length - 5 > 1 ? 's' : ''} waiting`,
          body: 'Review the rest in FlowDesk.', action: { label: 'Review', href: '/flowdesk' },
        })
      }
    }

    // 2. Manager — attendance corrections (aggregate).
    if (isManager && (mgrReg as number) > 0) {
      signals.push({
        id: 'team_reg', type: 'attendance', severity: 'warning', priority: 95, intent: 'needs_you',
        title: `${mgrReg} attendance correction${(mgrReg as number) > 1 ? 's' : ''} to review`,
        body: 'Approve or decline in FlowDesk.', action: { label: 'Review', href: '/flowdesk' },
      })
    }

    // 3. Attendance — punch state (suppressed on weekends).
    if (employeeId && !isWeekend(today)) {
      if (!todayAtt?.check_in) {
        signals.push({
          id: 'no_check_in', type: 'attendance', severity: 'warning', priority: 90, intent: 'needs_you',
          title: 'You haven’t checked in today',
          body: 'Punch in or raise a regularization if you’re working remotely.',
          action: { label: 'Attendance', href: '/attendance' },
        })
      } else if (todayAtt.check_in && !todayAtt.check_out) {
        signals.push({
          id: 'no_check_out', type: 'attendance', severity: 'info', priority: 40, intent: 'can_wait',
          title: 'You’re checked in',
          body: 'Remember to check out at the end of your day.',
          action: { label: 'Attendance', href: '/attendance' },
        })
      }
    }

    // 4. Documents expiring within 30 days.
    for (const doc of (expiringDocs as any[])) {
      const days = Math.max(0, Math.round(
        (new Date(doc.expires_at + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86_400_000))
      const urgent = days <= 7
      signals.push({
        id: `doc_expiry_${doc.name}`, type: 'documents', severity: urgent ? 'warning' : 'info', priority: 70,
        intent: urgent ? 'needs_you' : 'can_wait',
        title: `${doc.name} expires in ${days} day${days === 1 ? '' : 's'}`,
        body: 'Upload a renewed copy or contact HR.',
        action: { label: 'Documents', href: '/documents' },
      })
    }

    // 5. Zero leave balance — pure FYI, can't be cleared → info_only (excluded from Attention).
    const totalLeave = (leaveBal as any[]).reduce((s, b) => s + Number(b.balance ?? 0), 0)
    if (employeeId && (leaveBal as any[]).length > 0 && totalLeave <= 0) {
      signals.push({
        id: 'no_leave', type: 'leave', severity: 'info', priority: 60, intent: 'info_only',
        title: 'No leave balance remaining',
        body: 'You’ve used your available leave for now.',
        action: { label: 'Leave', href: '/leave/balance' },
      })
    }

    // 6. Your own requests in progress — waiting on others (track only).
    const ownPending = (ownPendingLeave as number) + (ownPendingReg as number)
    if (ownPending > 0) {
      signals.push({
        id: 'own_requests', type: 'requests', severity: 'info', priority: 30, intent: 'waiting',
        title: `${ownPending} request${ownPending > 1 ? 's' : ''} in progress`,
        body: 'Pending with your approver.', action: { label: 'Track', href: '/flowdesk' },
      })
    }

    signals.sort((a, b) => b.priority - a.priority)
    return reply.send({ signals })
  })
}
