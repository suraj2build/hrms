/**
 * Operational Health Dashboard
 *
 * Aggregates all operational observability signals into a single response
 * so operators get a full picture of platform health in one request.
 *
 * GET /system/operational-health
 *   Composite health report:
 *   - Attendance freshness (live scan, optionally cached)
 *   - Unresolved reconciliation issue counts
 *   - Scheduler heartbeats (liveness)
 *   - Durable queue metrics (pending/running/dead)
 *   - Payroll run status (current + prior month)
 *   - Platform module health
 *
 * GET /attendance/freshness
 *   Attendance freshness scan for the calling tenant (detailed).
 *   Optionally includes per-employee stale list.
 *
 * GET /attendance/freshness/history
 *   Freshness snapshot history (trend data, last N days).
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { scanAttendanceFreshness, getFreshnessHistory } from '../../lib/attendance-freshness.js'
import { durableQueue }         from '../../lib/durable-queue.js'
import { platformHealth }       from '../../lib/startup-health.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate }  from '../../lib/org-context.js'

export default async function operationalHealthRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function assertAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
      return false
    }
    return true
  }

  // ── GET /attendance/freshness ──────────────────────────────────────────────
  fastify.get('/attendance/freshness', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const querySchema = z.object({
      stale_days:         z.coerce.number().int().min(1).max(30).default(2),
      include_stale_list: z.enum(['true', 'false']).default('true'),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { stale_days, include_stale_list } = parsed.data

    try {
      const report = await scanAttendanceFreshness(
        fastify.supabase,
        req.tenantId,
        stale_days,
        include_stale_list === 'true',
      )
      return reply.send({ data: report })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to scan attendance freshness')
    }
  })

  // ── GET /attendance/freshness/history ──────────────────────────────────────
  fastify.get('/attendance/freshness/history', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const querySchema = z.object({
      days: z.coerce.number().int().min(1).max(90).default(30),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    try {
      const history = await getFreshnessHistory(fastify.supabase, req.tenantId, parsed.data.days)
      return reply.send({ data: history, total: history.length })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance freshness history')
    }
  })

  // ── GET /system/operational-health ────────────────────────────────────────
  // Comprehensive health aggregation for the operational dashboard.
  // All sub-queries are run in parallel; individual failures degrade gracefully
  // rather than failing the entire response.
  fastify.get('/system/operational-health', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const tenantId = req.tenantId as string
    const now      = new Date()
    // Tenant-local "current month", not the server's (UTC) clock — otherwise
    // near local midnight at month start this looks up payroll_runs for the
    // wrong month (ISSUE-154 class).
    const tz       = await fetchTenantTz(fastify.supabase, tenantId)
    const todayStr = getLocalDate(now.toISOString(), tz)
    const [curY, curM] = todayStr.slice(0, 7).split('-').map(Number)
    const monthKey = todayStr.slice(0, 7)
    const prevDate = new Date(Date.UTC(curY, curM - 2, 1, 12))
    const prevMonth= prevDate.toISOString().slice(0, 7)

    // Run all probes in parallel — each wrapped in a catch so one failure
    // doesn't take down the whole dashboard response.
    const [
      freshnessResult,
      attendanceOpenResult,
      leaveOpenResult,
      heartbeatsResult,
      durableMetricsResult,
      currentPayrollResult,
      prevPayrollResult,
    ] = await Promise.allSettled([

      // 1. Attendance freshness (no stale list — summary only)
      scanAttendanceFreshness(fastify.supabase, tenantId, 2, false),

      // 2. Open attendance reconciliation issues (counts only)
      fastify.supabase
        .from('attendance_reconciliation_issues')
        .select('severity', { count: 'exact', head: false })
        .eq('tenant_id', tenantId)
        .eq('resolved', false),

      // 3. Open leave reconciliation issues
      fastify.supabase
        .from('leave_reconciliation_issues')
        .select('severity', { count: 'exact', head: false })
        .eq('tenant_id', tenantId)
        .eq('resolved', false),

      // 4. Scheduler heartbeats
      fastify.supabase
        .from('scheduler_heartbeats')
        .select('scheduler_name, last_heartbeat_at, status, tick_count, last_error')
        .eq('tenant_id', tenantId)
        .order('last_heartbeat_at', { ascending: false }),

      // 5. Durable queue metrics
      durableQueue.getMetrics(fastify.supabase, tenantId),

      // 6. Current month payroll run
      fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, employee_count, total_gross, total_net, finalized_at, created_at')
        .eq('tenant_id', tenantId)
        .eq('month', monthKey)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 7. Previous month payroll run
      fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, employee_count, total_gross, total_net, finalized_at, created_at')
        .eq('tenant_id', tenantId)
        .eq('month', prevMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // ── Build attendance freshness section ────────────────────────────────────
    const freshness = freshnessResult.status === 'fulfilled'
      ? {
          health:                    freshnessResult.value.health_status,
          total_active_employees:    freshnessResult.value.total_active_employees,
          employees_with_data:       freshnessResult.value.employees_with_data,
          employees_stale:           freshnessResult.value.employees_stale,
          employees_missing:         freshnessResult.value.employees_missing,
          unprocessed_raw_logs:      freshnessResult.value.unprocessed_raw_logs,
          oldest_unprocessed_hours:  freshnessResult.value.oldest_unprocessed_hours,
          hours_since_last_run:      freshnessResult.value.hours_since_last_run,
          last_processing_run_at:    freshnessResult.value.last_processing_run_at,
        }
      : { health: 'unknown', error: (freshnessResult.reason as Error)?.message }

    // ── Build reconciliation section ───────────────────────────────────────────
    const attIssues = attendanceOpenResult.status === 'fulfilled'
      ? (attendanceOpenResult.value.data ?? []) as any[]
      : []
    const leaveIssues = leaveOpenResult.status === 'fulfilled'
      ? (leaveOpenResult.value.data ?? []) as any[]
      : []

    function severityCounts(issues: any[], realCount?: number) {
      const c = { critical: 0, error: 0, warning: 0, info: 0, total: realCount ?? issues.length }
      for (const i of issues) {
        if (i.severity in c) (c as any)[i.severity]++
      }
      return c
    }

    const reconciliation = {
      attendance: severityCounts(attIssues, attendanceOpenResult.status === 'fulfilled' ? (attendanceOpenResult.value.count ?? attIssues.length) : attIssues.length),
      leave:      severityCounts(leaveIssues, leaveOpenResult.status === 'fulfilled' ? (leaveOpenResult.value.count ?? leaveIssues.length) : leaveIssues.length),
    }

    // ── Build scheduler heartbeats section ────────────────────────────────────
    const heartbeats = heartbeatsResult.status === 'fulfilled'
      ? (heartbeatsResult.value.data ?? []).map((h: any) => {
          const ageMs = h.last_heartbeat_at
            ? now.getTime() - new Date(h.last_heartbeat_at).getTime()
            : null
          return {
            scheduler_name:   h.scheduler_name,
            status:           h.status,
            tick_count:       h.tick_count,
            last_error:       h.last_error,
            age_seconds:      ageMs != null ? Math.floor(ageMs / 1000) : null,
            is_stale:         ageMs != null ? ageMs > 2 * 60 * 60 * 1_000 : true,
          }
        })
      : []

    const schedulerHealth = heartbeats.some((h: any) => h.is_stale) ? 'stale' :
                            heartbeats.length === 0                  ? 'unknown' : 'alive'

    // ── Build durable queue section ────────────────────────────────────────────
    const queueMetrics = durableMetricsResult.status === 'fulfilled'
      ? durableMetricsResult.value
      : { error: (durableMetricsResult.reason as Error)?.message }

    // ── Build payroll section ──────────────────────────────────────────────────
    const currentRun = currentPayrollResult.status === 'fulfilled'
      ? currentPayrollResult.value.data
      : null
    const prevRun = prevPayrollResult.status === 'fulfilled'
      ? prevPayrollResult.value.data
      : null

    // ── Overall platform health score ──────────────────────────────────────────
    // Aggregate all signals into a single status:
    // critical → any critical issue OR attendance health=critical OR stale scheduler
    // degraded → any degraded signal
    // healthy  → everything green
    const isCritical =
      (freshness as any).health === 'critical' ||
      reconciliation.attendance.critical > 0 ||
      reconciliation.leave.critical > 0 ||
      (queueMetrics as any).dead > 0

    const isDegraded =
      (freshness as any).health === 'degraded' ||
      reconciliation.attendance.error > 0 ||
      reconciliation.leave.error > 0 ||
      schedulerHealth === 'stale' ||
      schedulerHealth === 'unknown'

    const overallHealth = isCritical ? 'critical' : isDegraded ? 'degraded' : 'healthy'

    return reply.send({
      data: {
        timestamp:      now.toISOString(),
        overall_health: overallHealth,

        attendance_freshness: freshness,

        reconciliation,

        scheduler: {
          health:      schedulerHealth,
          heartbeats,
        },

        durable_queue: queueMetrics,

        payroll: {
          current_month: monthKey,
          current_run:   currentRun ? {
            id:             currentRun.id,
            status:         currentRun.status,
            employee_count: currentRun.employee_count,
            total_gross:    currentRun.total_gross,
            total_net:      currentRun.total_net,
            finalized_at:   currentRun.finalized_at,
            created_at:     currentRun.created_at,
          } : null,
          prev_month: prevMonth,
          prev_run: prevRun ? {
            id:           prevRun.id,
            status:       prevRun.status,
            finalized_at: prevRun.finalized_at,
          } : null,
        },

        platform: {
          status:        platformHealth.status,
          uptime_seconds:Math.floor(process.uptime()),
          modules:       platformHealth.modules,
        },
      },
    })
  })
}
