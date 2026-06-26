/**
 * GET /ess/signals — the first Experience Core Service.
 *
 * A Signal is a *current truth about the employee's work that may need attention*,
 * carrying a contextual action. This is the "what needs you" layer that Home
 * composes into ranked cards (EXPERIENCE_CLOUD_UX_BLUEPRINT.md §1.1, §2).
 *
 * Reuse-first: signals are PROJECTED from data the platform already owns
 * (attendance, approvals, own requests, documents, leave). No new storage, no
 * new business logic — this service only *reads and ranks*.
 *
 * Scope: tenant + self enforced server-side. Managers additionally get team
 * approval signals. Only the signals Home needs are exposed — the Experience
 * Core grows surface-by-surface, never speculatively.
 *
 * Each signal: { id, type, severity, priority, title, body?, action? }
 *   - priority: higher = surfaced first (deterministic ranking, ML-ready later)
 *   - action.href: a path RELATIVE to the ESS base (the client prefixes it)
 */

import type { FastifyInstance } from 'fastify'

type Severity = 'info' | 'warning' | 'critical'

interface Signal {
  id:       string
  type:     'attendance' | 'approvals' | 'requests' | 'documents' | 'leave'
  severity: Severity
  priority: number
  title:    string
  body?:    string
  action?:  { label: string; href: string }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function offsetISO(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10)
}
function isWeekend(): boolean {
  const dow = new Date().getDay()  // 0 Sun … 6 Sat
  return dow === 0 || dow === 6
}

/** Adopt a Supabase PromiseLike into a real Promise, defaulting on any error. */
function safe<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.resolve(p).then(v => v, () => fallback)
}

export default async function essSignalsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/signals', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data: profileRow } = await fastify.supabase
      .from('profiles').select('employee_id, role')
      .eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()

    const employeeId = (profileRow as any)?.employee_id as string | null
    const role       = (profileRow as any)?.role as string | null
    const isManager  = ['manager', 'hr_admin', 'super_admin'].includes(role ?? '')

    // Not linked to an employee → no personal signals (managers still get approvals).
    const today    = todayISO()
    const in30Days = offsetISO(30)

    // Parallel, each section defensive — a failing source yields no signal, never a 500.
    const [todayAtt, ownPendingLeave, ownPendingReg, expiringDocs, leaveBal, mgrLeave, mgrReg] =
      await Promise.all([
        employeeId
          ? safe(fastify.supabase.from('attendance').select('check_in, check_out, status')
              .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('date', today).maybeSingle()
              .then(r => r.data as any), null)
          : Promise.resolve(null),
        employeeId
          ? safe(fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true })
              .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'pending')
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
        isManager
          ? safe(fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId).eq('status', 'pending')
              .then(r => r.count ?? 0), 0)
          : Promise.resolve(0),
        isManager
          ? safe(fastify.supabase.from('attendance_regularisation').select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId).eq('status', 'pending')
              .then(r => r.count ?? 0), 0)
          : Promise.resolve(0),
      ])

    const signals: Signal[] = []

    // 1. Manager — team approvals waiting. Highest urgency.
    const approvals = (mgrLeave as number) + (mgrReg as number)
    if (isManager && approvals > 0) {
      signals.push({
        id: 'team_approvals', type: 'approvals', severity: 'warning', priority: 100,
        title: `${approvals} approval${approvals > 1 ? 's' : ''} awaiting you`,
        body: 'Review and decide in FlowDesk.',
        action: { label: 'Review', href: '/flowdesk' },
      })
    }

    // 2. Attendance — punch state (suppressed on weekends; no shift logic needed).
    if (employeeId && !isWeekend()) {
      if (!todayAtt?.check_in) {
        signals.push({
          id: 'no_check_in', type: 'attendance', severity: 'warning', priority: 90,
          title: 'You haven’t checked in today',
          body: 'Punch in or raise a regularization if you’re working remotely.',
          action: { label: 'Attendance', href: '/attendance' },
        })
      } else if (todayAtt.check_in && !todayAtt.check_out) {
        signals.push({
          id: 'no_check_out', type: 'attendance', severity: 'info', priority: 40,
          title: 'You’re checked in',
          body: 'Remember to check out at the end of your day.',
          action: { label: 'Attendance', href: '/attendance' },
        })
      }
    }

    // 3. Documents expiring within 30 days.
    for (const doc of (expiringDocs as any[])) {
      const days = Math.max(0, Math.round(
        (new Date(doc.expires_at + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86_400_000))
      signals.push({
        id: `doc_expiry_${doc.name}`, type: 'documents', severity: days <= 7 ? 'warning' : 'info', priority: 70,
        title: `${doc.name} expires in ${days} day${days === 1 ? '' : 's'}`,
        body: 'Upload a renewed copy or contact HR.',
        action: { label: 'Documents', href: '/documents' },
      })
    }

    // 4. Zero leave balance (high-confidence; no arbitrary threshold).
    const totalLeave = (leaveBal as any[]).reduce((s, b) => s + Number(b.balance ?? 0), 0)
    if (employeeId && (leaveBal as any[]).length > 0 && totalLeave <= 0) {
      signals.push({
        id: 'no_leave', type: 'leave', severity: 'info', priority: 60,
        title: 'No leave balance remaining',
        body: 'You’ve used your available leave for now.',
        action: { label: 'Leave', href: '/leave/balance' },
      })
    }

    // 5. Your own requests in progress (gentle, lowest urgency).
    const ownPending = (ownPendingLeave as number) + (ownPendingReg as number)
    if (ownPending > 0) {
      signals.push({
        id: 'own_requests', type: 'requests', severity: 'info', priority: 30,
        title: `${ownPending} request${ownPending > 1 ? 's' : ''} in progress`,
        body: 'Track status in FlowDesk.',
        action: { label: 'Track', href: '/flowdesk' },
      })
    }

    // Ranked, highest priority first.
    signals.sort((a, b) => b.priority - a.priority)

    return reply.send({ signals })
  })
}
