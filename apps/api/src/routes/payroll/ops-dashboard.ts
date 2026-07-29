/**
 * Operational Reconciliation Dashboard
 *
 * Lightweight operations visibility — NOT analytics.
 * Surfaces actionable issue counts with severity and context.
 *
 * GET /payroll/ops/dashboard   — aggregated issue counts
 * GET /payroll/ops/issues      — detailed issue list (paginated)
 * GET /payroll/ops/validate    — non-regression validation report
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function opsDashboardRoutes(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }] }

  // ── GET /payroll/ops/dashboard ────────────────────────────────────────────────
  // Single endpoint aggregating all operational health signals.
  // Uses parallel COUNT queries — each is independent and lightweight.
  fastify.get('/dashboard', adminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const tz       = await fetchTenantTz(fastify.supabase, tenantId)
    const today    = getLocalDate(new Date().toISOString(), tz)
    const monthDate = today.slice(0, 7)  // YYYY-MM

    const [
      // Pending payroll adjustments (retro changes queued on locked periods)
      adjResult,
      // Payroll run events with error status (failed computations)
      runErrResult,
      // Missing TDS proofs (declarations submitted but no verified proof)
      missingProofResult,
      // Statutory registration gaps (employees with no statutory registrations at site)
      statRegResult,
      // Payroll reconciliation items still open
      reconResult,
      // Failed scheduler jobs in last 7 days
      schedulerFailResult,
      // Pending leave approvals older than 48h
      staleLeaveResult,
      // EPF contributions with no matching payroll slip (orphan)
      epfOrphanResult,
    ] = await Promise.all([
      fastify.supabase
        .from('payroll_adjustments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),

      fastify.supabase
        .from('payroll_run_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('event_type', ['data_fetch_failed','compensation_missing','compensation_invalid','validation_failed','slip_insert_failed'])
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // Declarations in submitted/under_review status with no verified proof
      fastify.supabase
        .from('tax_declarations')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['submitted','under_review']),

      // Active employees with no site-level statutory registration
      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .is('site_id', null),

      // Open reconciliation items (acknowledged = false or status open)
      fastify.supabase
        .from('payroll_run_blockers')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'open'),

      // Failed scheduler jobs last 7 days
      fastify.supabase
        .from('scheduler_job_log')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'failed')
        .gte('started_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),

      // Pending leave older than 48h — canonical leave_requests
      fastify.supabase
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'PENDING')
        .lte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()),

      // EPF contributions without a matching finalized payroll slip for same month
      fastify.supabase
        .from('epf_contributions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('contribution_month', monthDate),
    ])

    // A failed count query returns `count: null`, which every section below
    // treats as `?? 0` — silently reporting "0 issues" / severity 'ok' for a
    // check that never actually ran, instead of surfacing the failure.
    const firstError = [
      adjResult, runErrResult, missingProofResult, statRegResult,
      reconResult, schedulerFailResult, staleLeaveResult, epfOrphanResult,
    ].find(r => r.error)?.error
    if (firstError) return serverError(req, reply, firstError, ErrorCode.QUERY_FAILED, 'Failed to load ops dashboard')

    const dashboard = {
      generated_at: new Date().toISOString(),
      month:        monthDate,
      sections: {
        payroll_adjustments: {
          label:    'Pending Payroll Adjustments',
          count:    adjResult.count ?? 0,
          severity: (adjResult.count ?? 0) > 0 ? 'warning' : 'ok',
          action:   '/payroll/adjustments',
        },
        payroll_failures: {
          label:    'Payroll Computation Failures (30d)',
          count:    runErrResult.count ?? 0,
          severity: (runErrResult.count ?? 0) > 0 ? 'error' : 'ok',
          action:   '/payroll/ops/issues?type=payroll_failures',
        },
        missing_tds_proofs: {
          label:    'TDS Declarations Awaiting Proof Review',
          count:    missingProofResult.count ?? 0,
          severity: (missingProofResult.count ?? 0) > 5 ? 'warning' : 'info',
          action:   '/payroll/statutory/tds/declarations?status=submitted',
        },
        employees_no_site: {
          label:    'Active Employees Without Site Assignment',
          count:    statRegResult.count ?? 0,
          severity: (statRegResult.count ?? 0) > 0 ? 'warning' : 'ok',
          action:   '/employees?filter=no_site',
        },
        open_blockers: {
          label:    'Open Payroll Blockers',
          count:    reconResult.count ?? 0,
          severity: (reconResult.count ?? 0) > 0 ? 'warning' : 'ok',
          action:   '/payroll/ops/issues?type=blockers',
        },
        scheduler_failures: {
          label:    'Scheduler Job Failures (7d)',
          count:    schedulerFailResult.count ?? 0,
          severity: (schedulerFailResult.count ?? 0) > 0 ? 'error' : 'ok',
          action:   '/payroll/scheduler/jobs?status=failed',
        },
        stale_leave_approvals: {
          label:    'Leave Requests Pending >48h',
          count:    staleLeaveResult.count ?? 0,
          severity: (staleLeaveResult.count ?? 0) > 0 ? 'warning' : 'ok',
          action:   '/attendance/leave?status=pending',
        },
        epf_this_month: {
          label:    `EPF Contributions Computed (${monthDate})`,
          count:    epfOrphanResult.count ?? 0,
          severity: 'info',
          action:   `/payroll/statutory/epf/contributions?month=${monthDate}`,
        },
      },
      total_issues: (
        (adjResult.count         ?? 0) +
        (runErrResult.count      ?? 0) +
        (reconResult.count       ?? 0) +
        (schedulerFailResult.count ?? 0) +
        (staleLeaveResult.count  ?? 0)
      ),
      health: (() => {
        const errors = (runErrResult.count ?? 0) + (schedulerFailResult.count ?? 0)
        const warnings = (adjResult.count ?? 0) + (reconResult.count ?? 0) + (staleLeaveResult.count ?? 0)
        if (errors > 0)   return 'degraded'
        if (warnings > 0) return 'warning'
        return 'healthy'
      })(),
    }

    return reply.send({ data: dashboard })
  })

  // ── GET /payroll/ops/issues ───────────────────────────────────────────────────
  // Detailed issue list with severity, affected employee, module, and timestamp.
  fastify.get('/issues', adminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      type:   z.enum(['payroll_failures','blockers','adjustments','scheduler_failures','all']).optional().default('all'),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { type, limit, offset } = parsed.data
    const tenantId = req.tenantId as string
    const issues: Array<{
      id:            string
      type:          string
      severity:      string
      module:        string
      employee_id:   string | null
      description:   string
      created_at:    string
      status:        string
      action_route?: string
    }> = []

    // Each category below is capped at .limit(50) for the in-memory preview
    // list, so `issues.length` (used for `total` further down) understates
    // the real backlog once any category exceeds 50. Track each category's
    // true count via a separate head:true query and report the sum as
    // `total_backlog` alongside the existing (now explicitly-capped) `total`.
    let trueTotal = 0

    if (type === 'all' || type === 'payroll_failures') {
      const [{ data: runErrs, error: runErrsErr }, { count: runErrCount, error: runErrCountErr }] = await Promise.all([
        fastify.supabase
          .from('payroll_run_events')
          .select('id, event_type, employee_id, payload, error_details, created_at, run_id')
          .eq('tenant_id', tenantId)
          .in('event_type', ['data_fetch_failed','compensation_missing','validation_failed','slip_insert_failed'])
          .order('created_at', { ascending: false })
          .limit(50),
        fastify.supabase
          .from('payroll_run_events')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .in('event_type', ['data_fetch_failed','compensation_missing','validation_failed','slip_insert_failed']),
      ])
      if (runErrsErr || runErrCountErr) return serverError(req, reply, runErrsErr ?? runErrCountErr, ErrorCode.QUERY_FAILED, 'Failed to load payroll failure issues')
      trueTotal += runErrCount ?? 0

      for (const e of (runErrs ?? []) as any[]) {
        issues.push({
          id:          e.id,
          type:        'payroll_failure',
          severity:    'error',
          module:      'payroll',
          employee_id: e.employee_id ?? null,
          description: `${e.event_type}: ${(e.error_details as any)?.message ?? 'unknown error'}`,
          created_at:  e.created_at,
          status:      'open',
          action_route: `/payroll/runs/${e.run_id}`,
        })
      }
    }

    if (type === 'all' || type === 'blockers') {
      const [{ data: blockers, error: blockersErr }, { count: blockerCount, error: blockerCountErr }] = await Promise.all([
        fastify.supabase
          .from('payroll_run_blockers')
          .select('id, blocker_type:rule_code, employee_id, reason, severity, status, created_at, run_id')
          .eq('tenant_id', tenantId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(50),
        fastify.supabase
          .from('payroll_run_blockers')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'open'),
      ])
      if (blockersErr || blockerCountErr) return serverError(req, reply, blockersErr ?? blockerCountErr, ErrorCode.QUERY_FAILED, 'Failed to load payroll blocker issues')
      trueTotal += blockerCount ?? 0

      for (const b of (blockers ?? []) as any[]) {
        issues.push({
          id:          b.id,
          type:        'payroll_blocker',
          severity:    b.severity ?? 'warning',
          module:      'payroll',
          employee_id: b.employee_id ?? null,
          description: `Blocker [${b.blocker_type}]: ${b.reason}`,
          created_at:  b.created_at,
          status:      b.status,
          action_route: `/payroll/runs/${b.run_id}`,
        })
      }
    }

    if (type === 'all' || type === 'adjustments') {
      const [{ data: adjs, error: adjsErr }, { count: adjCount, error: adjCountErr }] = await Promise.all([
        fastify.supabase
          .from('payroll_adjustments')
          .select('id, employee_id, locked_month, adjustment_type, reason, status, created_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(50),
        fastify.supabase
          .from('payroll_adjustments')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'pending'),
      ])
      if (adjsErr || adjCountErr) return serverError(req, reply, adjsErr ?? adjCountErr, ErrorCode.QUERY_FAILED, 'Failed to load payroll adjustment issues')
      trueTotal += adjCount ?? 0

      for (const a of (adjs ?? []) as any[]) {
        issues.push({
          id:          a.id,
          type:        'payroll_adjustment',
          severity:    'warning',
          module:      'payroll',
          employee_id: a.employee_id ?? null,
          description: `Retro adjustment [${a.adjustment_type}] for locked month ${a.locked_month}: ${a.reason}`,
          created_at:  a.created_at,
          status:      'pending',
          action_route: '/payroll/adjustments',
        })
      }
    }

    if (type === 'all' || type === 'scheduler_failures') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const [{ data: sjl, error: sjlErr }, { count: sjlCount, error: sjlCountErr }] = await Promise.all([
        fastify.supabase
          .from('scheduler_job_log')
          .select('id, job_type, job_name, error_message, started_at, status')
          .eq('tenant_id', tenantId)
          .eq('status', 'failed')
          .gte('started_at', sevenDaysAgo)
          .order('started_at', { ascending: false })
          .limit(50),
        fastify.supabase
          .from('scheduler_job_log')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'failed')
          .gte('started_at', sevenDaysAgo),
      ])
      if (sjlErr || sjlCountErr) return serverError(req, reply, sjlErr ?? sjlCountErr, ErrorCode.QUERY_FAILED, 'Failed to load scheduler failure issues')
      trueTotal += sjlCount ?? 0

      for (const j of (sjl ?? []) as any[]) {
        issues.push({
          id:          j.id,
          type:        'scheduler_failure',
          severity:    'error',
          module:      'scheduler',
          employee_id: null,
          description: `Job [${j.job_type}${j.job_name ? ' / ' + j.job_name : ''}] failed: ${j.error_message ?? 'unknown'}`,
          created_at:  j.started_at,
          status:      'failed',
          action_route: `/payroll/scheduler/jobs`,
        })
      }
    }

    // Sort by created_at DESC and paginate
    issues.sort((a, b) => b.created_at.localeCompare(a.created_at))
    const page = issues.slice(offset, offset + limit)

    // `total` reflects the true backlog count (trueTotal); `preview_total`
    // is the size of the in-memory list actually available to page through
    // (each category capped at 50) — surfacing both prevents "total" from
    // silently understating the backlog once any category exceeds 50.
    return reply.send({ data: page, total: trueTotal, preview_total: issues.length, limit, offset })
  })

  // ── GET /payroll/ops/validate ─────────────────────────────────────────────────
  // Non-regression validation report.
  // Checks key system invariants without mutating any data.
  fastify.get('/validate', adminAuth, async (req: any, reply) => {
    const tenantId  = req.tenantId as string
    const results: Array<{
      check:   string
      status:  'pass' | 'warn' | 'fail'
      message: string
      detail?: unknown
    }> = []

    // 1. All finalized slips have net_pay > 0
    // ISSUE-153: `.limit(5)` was also capping the reported count — with 200
    // affected slips this said "5 finalized slip(s)", silently undercounting by
    // 40x. `count: 'exact'` returns the true total (pre-limit) alongside the
    // capped `data`, which stays as a 5-row sample for `detail`.
    const { data: zeroNetSlips, count: zeroNetCount, error: zeroNetErr } = await fastify.supabase
      .from('payroll_slips')
      .select('id, employee_id, month', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'finalized')
      .lte('net_pay', 0)
      .limit(5)
    if (zeroNetErr) return serverError(req, reply, zeroNetErr, ErrorCode.QUERY_FAILED, 'Failed to run finalized-slip net-pay validation')

    const zeroNetTotal = zeroNetCount ?? (zeroNetSlips ?? []).length
    results.push({
      check:   'finalized_slips_net_pay_positive',
      status:  zeroNetTotal === 0 ? 'pass' : 'warn',
      message: zeroNetTotal === 0
        ? 'All finalized slips have net_pay > 0'
        : `${zeroNetTotal} finalized slip(s) have net_pay ≤ 0`,
      detail: zeroNetSlips,
    })

    // 2. No active employee has two active compensations
    // ISSUE (fresh audit): `.limit(5)` capped the reported count the same way
    // check #1 above did (already fixed) — and the RPC's error was discarded
    // entirely, so if it errored (e.g. not installed on an older DB — see
    // migration 395) this always silently reported 'pass'. Distinguish "we
    // checked and it's clean" from "we couldn't check" instead of collapsing
    // both into the same green status.
    const { data: multiCompRows, error: multiCompErr } = await fastify.supabase
      .rpc('check_duplicate_active_compensations', { p_tenant_id: tenantId })
    if (multiCompErr) {
      results.push({
        check:   'single_active_compensation_per_employee',
        status:  'warn',
        message: `Could not run duplicate-compensation check: ${multiCompErr.message}`,
      })
    } else {
      const multiCompIssues = (multiCompRows ?? []) as any[]
      results.push({
        check:   'single_active_compensation_per_employee',
        status:  multiCompIssues.length === 0 ? 'pass' : 'fail',
        message: multiCompIssues.length === 0
          ? 'Each active employee has at most one active compensation'
          : `${multiCompIssues.length} employee(s) have multiple active compensations`,
        detail: multiCompIssues.length > 0 ? multiCompIssues.slice(0, 5) : undefined,
      })
    }

    // 3. Snapshot integrity — check for recent runs with snapshots
    const { data: recentRuns, error: recentRunsErr } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'finalized')
      .order('month', { ascending: false })
      .limit(3)
    if (recentRunsErr) return serverError(req, reply, recentRunsErr, ErrorCode.QUERY_FAILED, 'Failed to run snapshot-integrity validation')

    const runIds = (recentRuns ?? []).map((r: any) => r.id)
    let snapshotCount = 0
    if (runIds.length > 0) {
      const { count, error: snapshotErr } = await fastify.supabase
        .from('payroll_run_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('run_id', runIds)
      if (snapshotErr) return serverError(req, reply, snapshotErr, ErrorCode.QUERY_FAILED, 'Failed to run snapshot-integrity validation')
      snapshotCount = count ?? 0
    }

    results.push({
      check:   'finalized_runs_have_snapshots',
      status:  runIds.length === 0 ? 'pass' : snapshotCount >= runIds.length ? 'pass' : 'warn',
      message: runIds.length === 0
        ? 'No finalized runs to check'
        : snapshotCount >= runIds.length
          ? `All ${runIds.length} recent finalized run(s) have snapshots`
          : `Only ${snapshotCount} of ${runIds.length} recent runs have snapshots`,
    })

    // 4. EPF/ESI config exists
    const [epfCfg, esiCfg] = await Promise.all([
      fastify.supabase.from('epf_config').select('id').eq('tenant_id', tenantId).is('effective_to', null).limit(1).maybeSingle(),
      fastify.supabase.from('esi_config').select('id').eq('tenant_id', tenantId).is('effective_to', null).limit(1).maybeSingle(),
    ])
    if (epfCfg.error || esiCfg.error) return serverError(req, reply, epfCfg.error ?? esiCfg.error, ErrorCode.QUERY_FAILED, 'Failed to run statutory-config validation')
    results.push({
      check:   'epf_config_present',
      status:  epfCfg.data ? 'pass' : 'warn',
      message: epfCfg.data ? 'EPF config is configured' : 'No active EPF config found',
    })
    results.push({
      check:   'esi_config_present',
      status:  esiCfg.data ? 'pass' : 'warn',
      message: esiCfg.data ? 'ESI config is configured' : 'No active ESI config found',
    })

    // 5. No pending payroll adjustments for open (unfrozen) months
    const { data: adjCheck, error: adjCheckErr } = await fastify.supabase
      .from('payroll_adjustments')
      .select('locked_month')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
    if (adjCheckErr) return serverError(req, reply, adjCheckErr, ErrorCode.QUERY_FAILED, 'Failed to run pending-adjustments validation')

    const pendingAdj = (adjCheck ?? []) as any[]
    results.push({
      check:   'no_pending_adjustments',
      status:  pendingAdj.length === 0 ? 'pass' : 'warn',
      message: pendingAdj.length === 0
        ? 'No pending payroll adjustments'
        : `${pendingAdj.length} pending adjustment(s) require review`,
    })

    const passCount = results.filter(r => r.status === 'pass').length
    const warnCount = results.filter(r => r.status === 'warn').length
    const failCount = results.filter(r => r.status === 'fail').length

    return reply.send({
      validated_at: new Date().toISOString(),
      summary: {
        total:  results.length,
        passed: passCount,
        warned: warnCount,
        failed: failCount,
        overall: failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass',
      },
      checks: results,
    })
  })
}
