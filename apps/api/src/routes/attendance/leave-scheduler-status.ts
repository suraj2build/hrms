/**
 * Leave Scheduler Status — /leave/scheduler/status
 *
 * Exposes the live state of the autonomous leave scheduling engine.
 * Read-only observability endpoint — does NOT trigger any processing.
 *
 * GET /leave/scheduler/status
 *   Returns:
 *     • scheduler heartbeat (alive/stale/unknown)
 *     • per-engine last run summary (job_type, last_ran_at, status, metrics)
 *     • next due dates (computed, not stored)
 *     • open reconciliation issues count
 *
 * GET /leave/scheduler/history?job_type=&limit=
 *   Paginated job run history (scheduler runs only — excludes manual_replay).
 *
 * GET /leave/scheduler/reconciliation
 *   Last 30 reconciliation report summaries for this tenant.
 *
 * Access: hr_admin / super_admin only.
 */

import type { FastifyInstance } from 'fastify'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EngineStatus {
  job_type:             string
  label:                string
  description:          string
  schedule:             string
  last_run_at:          string | null
  last_run_status:      'completed' | 'failed' | 'running' | null
  last_employees:       number | null
  last_days_credited:   number | null
  last_duration_ms:     number | null
  last_error:           string | null
  next_due:             string
  is_overdue:           boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function nextMonthlyDate(): string {
  const d = new Date()
  // Next run: 1st of next month
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  return next.toISOString().slice(0, 10)
}

function nextYearlyDate(): string {
  const d = new Date()
  // Next run: Jan 1 or Apr 1, whichever is later from today
  const year  = d.getUTCFullYear()
  const jan   = new Date(Date.UTC(year, 0, 1))
  const apr   = new Date(Date.UTC(year, 3, 1))
  const jan1N = new Date(Date.UTC(year + 1, 0, 1))

  if (d < jan) return jan.toISOString().slice(0, 10)
  if (d < apr) return apr.toISOString().slice(0, 10)
  return jan1N.toISOString().slice(0, 10)
}

function nextCarryForwardDate(): string {
  const d = new Date()
  const year = d.getUTCFullYear()
  const dec31 = new Date(Date.UTC(year, 11, 31))
  const mar31 = new Date(Date.UTC(year, 2, 31))
  const dec31N = new Date(Date.UTC(year + 1, 11, 31))

  if (d < mar31) return mar31.toISOString().slice(0, 10)
  if (d < dec31) return dec31.toISOString().slice(0, 10)
  return dec31N.toISOString().slice(0, 10)
}

function tomorrow(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const ENGINE_META: Record<string, { label: string; description: string; schedule: string; nextDue: () => string }> = {
  monthly_accrual: {
    label:       'Monthly Accrual',
    description: 'Credits leave entitlement to all eligible employees on the 1st–3rd of each month',
    schedule:    '1st–3rd of every month',
    nextDue:     nextMonthlyDate,
  },
  yearly_accrual: {
    label:       'Yearly Credit',
    description: 'Full-year entitlement credit on Jan 1 (calendar year) or Apr 1 (financial year)',
    schedule:    'Jan 1 and/or Apr 1 annually',
    nextDue:     nextYearlyDate,
  },
  carry_forward: {
    label:       'Carry-Forward',
    description: 'Rolls eligible year-end balances into the next year per policy rules',
    schedule:    'Dec 31 (calendar) and Mar 31 (financial year-end)',
    nextDue:     nextCarryForwardDate,
  },
  co_expiry: {
    label:       'Balance Expiry',
    description: 'Expires accrual ledger entries that have passed their validity window',
    schedule:    'Daily',
    nextDue:     tomorrow,
  },
  event_grants: {
    label:       'Event Grants',
    description: 'Birthday, anniversary and custom event-triggered leave credits',
    schedule:    'Daily',
    nextDue:     tomorrow,
  },
  reconciliation: {
    label:       'Nightly Reconciliation',
    description: 'Ledger integrity check — detects balance drift, duplicate grants, missing accruals',
    schedule:    'Daily (nightly)',
    nextDue:     tomorrow,
  },
}

// ── Routes ─────────────────────────────────────────────────────────────────────

export default async function leaveSchedulerStatusRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /leave/scheduler/status ─────────────────────────────────────────────
  fastify.get('/leave/scheduler/status', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    try {
      const tenantId = req.tenantId as string

      // 1. Scheduler heartbeat — global (tenant_id IS NULL), never throws
      const { data: heartbeat } = await fastify.supabase
        .from('scheduler_heartbeats')
        .select('last_heartbeat_at, status, tick_count, last_error, metadata')
        .eq('scheduler_name', 'leave-scheduler')
        .is('tenant_id', null)
        .maybeSingle()
        .then(r => r, () => ({ data: null })) as any

      const now = Date.now()
      const lastBeat = heartbeat?.last_heartbeat_at
        ? new Date(heartbeat.last_heartbeat_at).getTime()
        : null
      const staleThresholdMs = 2 * 60 * 60 * 1000  // 2 hours
      const isStale = lastBeat == null || (now - lastBeat) > staleThresholdMs

      const scheduler = {
        status:             isStale ? 'stale' : (heartbeat?.status ?? 'unknown'),
        last_heartbeat_at:  heartbeat?.last_heartbeat_at ?? null,
        tick_count:         heartbeat?.tick_count ?? null,
        last_error:         heartbeat?.last_error ?? null,
        is_stale:           isStale,
      }

      // 2. Per-engine last run (scheduler runs only)
      const jobTypes = Object.keys(ENGINE_META)

      const { data: lastRuns, error: lastRunsErr } = await fastify.supabase
        .from('leave_job_log')
        .select('job_type, status, started_at, completed_at, duration_ms, result, error_msg')
        .eq('tenant_id', tenantId)
        .in('job_type', ['monthly_accrual', 'yearly_accrual', 'carry_forward', 'co_expiry', 'event_grants', 'reconciliation'])
        .order('started_at', { ascending: false })

      if (lastRunsErr) fastify.log.warn({ err: lastRunsErr.message }, 'leave_job_log query failed — scheduler status may be incomplete')

      // Take the most-recent row per job_type
      const byType = new Map<string, any>()
      for (const row of (lastRuns ?? []) as any[]) {
        if (!byType.has(row.job_type)) byType.set(row.job_type, row)
      }

      const engines: EngineStatus[] = jobTypes.map(jt => {
        const meta    = ENGINE_META[jt]!
        const last    = byType.get(jt) as any | undefined
        const nextDue = meta.nextDue()
        return {
          job_type:           jt,
          label:              meta.label,
          description:        meta.description,
          schedule:           meta.schedule,
          last_run_at:        last?.started_at ?? null,
          last_run_status:    last?.status     ?? null,
          last_employees:     (last?.result as any)?.employees_processed ?? null,
          last_days_credited: (last?.result as any)?.total_days_credited ?? null,
          last_duration_ms:   last?.duration_ms ?? null,
          last_error:         last?.error_msg   ?? null,
          next_due:           nextDue,
          is_overdue:         false,
        }
      })

      // 3. Open reconciliation issues — column is `resolved` (not `is_resolved`)
      let openIssues = 0
      try {
        const { count } = await fastify.supabase
          .from('leave_reconciliation_issues')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('resolved', false)
        openIssues = count ?? 0
      } catch { /* table may not exist yet — treat as 0 */ }

      // 4. Latest reconciliation report
      let lastRecon: any = null
      try {
        const { data } = await fastify.supabase
          .from('leave_reconciliation_reports')
          .select('run_date, severity, issues_found, employees_checked, created_at')
          .eq('tenant_id', tenantId)
          .order('run_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        lastRecon = data
      } catch { /* table may not exist yet */ }

      return reply.send({
        data: {
          scheduler,
          engines,
          reconciliation: {
            open_issues:       openIssues,
            last_run_date:     lastRecon?.run_date     ?? null,
            last_severity:     lastRecon?.severity     ?? null,
            issues_found:      lastRecon?.issues_found ?? null,
            employees_checked: lastRecon?.employees_checked ?? null,
          },
        },
      })
    } catch (err: any) {
      // A status endpoint must never crash — return a degraded response instead
      fastify.log.error({ err: err?.message ?? err }, 'GET /leave/scheduler/status degraded — returning partial data')
      return reply.send({
        data: {
          scheduler: { status: 'unknown', last_heartbeat_at: null, tick_count: null, last_error: String(err?.message ?? err), is_stale: true },
          engines: Object.keys(ENGINE_META).map(jt => ({
            job_type: jt, label: ENGINE_META[jt]!.label, description: ENGINE_META[jt]!.description,
            schedule: ENGINE_META[jt]!.schedule, last_run_at: null, last_run_status: null,
            last_employees: null, last_days_credited: null, last_duration_ms: null, last_error: null,
            next_due: ENGINE_META[jt]!.nextDue(), is_overdue: false,
          })),
          reconciliation: { open_issues: 0, last_run_date: null, last_severity: null, issues_found: null, employees_checked: null },
          _degraded: true,
          _error: err?.message ?? String(err),
        },
      })
    }
  })

  // ── GET /leave/scheduler/history ────────────────────────────────────────────
  fastify.get('/leave/scheduler/history', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { job_type, trigger_type, limit = 50, offset = 0 } = req.query as {
      job_type?: string
      trigger_type?: string
      limit?: number
      offset?: number
    }

    let q = fastify.supabase
      .from('leave_job_log')
      .select('id, job_type, status, trigger_type, dry_run, replay_reason, started_at, completed_at, duration_ms, params, result, error_msg', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (job_type)     (q as any) = (q as any).eq('job_type', job_type)
    if (trigger_type) (q as any) = (q as any).eq('trigger_type', trigger_type)

    const { data, error, count } = await q

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── GET /leave/scheduler/reconciliation ─────────────────────────────────────
  fastify.get('/leave/scheduler/reconciliation', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    try {
      const { data, error } = await fastify.supabase
        .from('leave_reconciliation_reports')
        .select('id, run_date, year, trigger_type, issues_found, critical_count, high_count, severity, employees_checked, created_at')
        .eq('tenant_id', req.tenantId)
        .order('run_date', { ascending: false })
        .limit(30)
        .then(r => r, () => ({ data: null, error: null })) as any

      if (error) {
        req.log.warn({ err: error }, 'leave_reconciliation_reports fetch failed — returning empty')
        return reply.send({ data: [] })
      }
      return reply.send({ data: data ?? [] })
    } catch (err: any) {
      req.log.warn({ err: err?.message ?? err }, 'reconciliation handler catch-all — returning empty')
      return reply.send({ data: [] })
    }
  })

  // ── GET /leave/event-grants ───────────────────────────────────────────────────
  // Read event-triggered leave grants from employee_event_grants.
  fastify.get('/leave/event-grants', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { data, error } = await fastify.supabase
      .from('employee_event_grants')
      .select(`
        id, employee_id, date_type_id, grant_date, expiry_date,
        leave_type_id, days_granted, status, reference_date, notes, created_at,
        employees!inner(first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      req.log.warn({ err: error }, 'employee_event_grants fetch failed — returning empty')
      return reply.send({ data: [] })
    }

    const rows = ((data ?? []) as any[]).map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        id:             r.id,
        employee_id:    r.employee_id,
        employee_name:  emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:  emp?.employee_code ?? null,
        date_type_id:   r.date_type_id,
        grant_date:     r.grant_date,
        expiry_date:    r.expiry_date,
        leave_type_id:  r.leave_type_id,
        days_granted:   r.days_granted,
        status:         r.status,
        reference_date: r.reference_date,
        notes:          r.notes,
        created_at:     r.created_at,
      }
    })

    return reply.send({ data: rows })
  })

  // ── GET /leave/governance/session-analytics ───────────────────────────────────
  // Aggregate leave request analytics for governance dashboard.
  fastify.get('/leave/governance/session-analytics', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    // Default to the current year (the frontend sends no year param). Filter on
    // from_date — the leave's actual occurrence — not created_at.
    const year      = Number((req.query as any).year) || new Date().getUTCFullYear()
    const yearStart = `${year}-01-01`
    const yearEnd   = `${year}-12-31`

    const emptyPayload = {
      total_requests: 0, half_day_count: 0, cross_session_count: 0,
      hourly_count: 0, by_type: [] as Array<Record<string, unknown>>,
    }

    const { data: requests, error } = await fastify.supabase
      .from('leave_requests')
      .select('id, status, session, half_day, hours_requested, start_session, end_session, from_date, leave_types(name)')
      .eq('tenant_id', req.tenantId)
      .gte('from_date', yearStart)
      .lte('from_date', yearEnd)

    if (error) {
      req.log.warn({ err: error }, 'leave_requests analytics fetch failed — returning empty')
      return reply.send({ data: emptyPayload })
    }

    // Count all non-cancelled requests, broken down by session type. Status is
    // UPPERCASE on leave_requests; this is an activity breakdown (not approvals),
    // so only CANCELLED is excluded.
    const rows = ((requests ?? []) as any[]).filter(r => r.status !== 'CANCELLED')
    const isCross = (r: any) => r.start_session && r.end_session && r.start_session !== r.end_session

    let half_day_count = 0, hourly_count = 0, cross_session_count = 0
    const byType = new Map<string, { full_day: number; first_half: number; second_half: number; cross_session: number }>()

    for (const r of rows) {
      const lt   = Array.isArray(r.leave_types) ? r.leave_types[0] : r.leave_types
      const name = lt?.name ?? 'Unknown'
      const bucket = byType.get(name) ?? { full_day: 0, first_half: 0, second_half: 0, cross_session: 0 }

      // Test cross-session FIRST: a multi-day span can be session='full_day' yet
      // still cross partial sessions at its ends.
      if (isCross(r))                            { cross_session_count++; bucket.cross_session++ }
      else if (r.session === 'first_half')       { half_day_count++;      bucket.first_half++ }
      else if (r.session === 'second_half')      { half_day_count++;      bucket.second_half++ }
      else if (r.session === 'hourly')           { hourly_count++ }   // summary only — no by_type column
      else                                       { bucket.full_day++ } // 'full_day' / null default

      byType.set(name, bucket)
    }

    const by_type = Array.from(byType.entries())
      .map(([leave_type_name, b]) => ({ leave_type_name, ...b }))
      .sort((a, b) => a.leave_type_name.localeCompare(b.leave_type_name))

    return reply.send({
      data: {
        total_requests: rows.length,
        half_day_count,
        cross_session_count,
        hourly_count,
        by_type,
      },
    })
  })
}
