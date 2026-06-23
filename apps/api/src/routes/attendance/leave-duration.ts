/**
 * Leave Duration Routes
 *
 * POST  /leave/duration/preview          — compute leave duration for a span (dry-run)
 * GET   /leave/duration/explain/:requestId — re-explain a stored leave request's duration
 *
 * These endpoints are powered exclusively by the leave-duration-engine (v1).
 * No frontend duration calculation is permitted; all computation goes through here.
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  computeLeaveDuration,
  buildPolicyFromRule,
  buildPolicyFromLegacy,
  buildDateRange,
  isDefaultWeekoff,
  validateSessionSpan,
  DEFAULT_POLICY,
  type LeaveSessionSpan,
  type DayContext,
} from '../../lib/leave-duration-engine.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

// Map service error types → HTTP status codes
function errorToHttp(type: string): number {
  switch (type) {
    case 'NOT_FOUND':            return 404
    case 'FORBIDDEN':            return 403
    case 'CONFLICT':             return 409
    case 'INSUFFICIENT_BALANCE': return 422
    case 'VALIDATION_ERROR':     return 400
    default:                     return 500
  }
}

// ── Policy resolution helpers ──────────────────────────────────────────────────

/**
 * Resolve effective DurationPolicy for a given employee + leave type.
 *
 * Priority chain (mirrors leave-policy-service.ts):
 *   1. employee-level leave_policy_assignments → leave_policy_rules
 *   2. department-level
 *   3. work_location-level
 *   4. default-scoped assignment
 *   5. legacy leave_policies row (fallback)
 *   6. DEFAULT_POLICY (permissive — if nothing configured)
 */
async function resolveEffectiveDurationPolicy(
  supabase:     any,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  asOf?:        string,
) {
  const effectiveDate = asOf ?? new Date().toISOString().slice(0, 10)

  // ── Step 1–4: resolve via leave_policy_assignments + leave_policy_rules ────
  //   Fetch the employee's department and work_location so we can search by scope
  const { data: emp } = await supabase
    .from('employees')
    .select('work_location_id, job_history!job_history_employee_id_fkey(department_id, is_current)')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (emp) {
    const jh = ((emp as any).job_history ?? []).find((j: any) => j.is_current) ?? ((emp as any).job_history ?? [])[0] ?? null
    ;(emp as any).department_id = jh?.department_id ?? null
  }

  // Build a list of scopes to try in priority order
  const scopeCandidates: Array<{ scope_type: string; scope_id: string | null }> = [
    { scope_type: 'employee',      scope_id: employeeId },
    { scope_type: 'department',    scope_id: (emp as any)?.department_id   ?? null },
    { scope_type: 'work_location', scope_id: (emp as any)?.work_location_id ?? null },
    { scope_type: 'default',       scope_id: null },
  ]

  for (const candidate of scopeCandidates) {
    if (candidate.scope_type !== 'default' && !candidate.scope_id) continue

    let assignmentQuery = supabase
      .from('leave_policy_assignments')
      .select('id, policy_id')
      .eq('tenant_id', tenantId)
      .eq('scope_type', candidate.scope_type)
      .lte('effective_from', effectiveDate)
      .or(`effective_to.is.null,effective_to.gte.${effectiveDate}`)

    if (candidate.scope_id) {
      assignmentQuery = assignmentQuery.eq('scope_id', candidate.scope_id)
    }

    const { data: assignments } = await assignmentQuery.limit(5)
    if (!assignments || assignments.length === 0) continue

    // For each matching assignment try to find a rule for the requested leave type
    for (const assignment of assignments as any[]) {
      const { data: rule } = await supabase
        .from('leave_policy_rules')
        .select('*')
        .eq('policy_id', assignment.policy_id)
        .eq('leave_type_id', leaveTypeId)
        .maybeSingle()

      if (rule) {
        return buildPolicyFromRule(rule as Record<string, unknown>)
      }
    }
  }

  // ── Step 5: legacy leave_policies fallback ─────────────────────────────────
  const { data: legacyPolicy } = await supabase
    .from('leave_policies')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('leave_type_id', leaveTypeId)
    .maybeSingle()

  if (legacyPolicy) {
    return buildPolicyFromLegacy(legacyPolicy as Record<string, unknown>)
  }

  // ── Step 6: nothing configured — use permissive default ───────────────────
  return DEFAULT_POLICY
}

/**
 * Fetch holidays from holiday_calendar for the given date range (tenant-scoped).
 */
async function fetchHolidays(
  supabase:   any,
  tenantId:   string,
  startDate:  string,
  endDate:    string,
): Promise<Map<string, string>> {
  const { data: holidays } = await supabase
    .from('holiday_calendar')
    .select('date, name')
    .eq('tenant_id', tenantId)
    .gte('date', startDate)
    .lte('date', endDate)

  const map = new Map<string, string>()
  for (const h of (holidays ?? []) as any[]) {
    map.set(h.date as string, h.name as string)
  }
  return map
}

/**
 * Build DayContext[] for every date in [startDate, endDate], marking
 * is_holiday and is_weekly_off.
 *
 * Week-off days: Saturday (6) + Sunday (0) by default.
 * A future enhancement may read tenant.week_off_days config — for now
 * we default to [0, 6] which is the most common configuration.
 */
function buildDayContexts(
  startDate: string,
  endDate:   string,
  holidays:  Map<string, string>,
): DayContext[] {
  const dates = buildDateRange(startDate, endDate)
  return dates.map(date => ({
    date,
    is_holiday:    holidays.has(date),
    is_weekly_off: isDefaultWeekoff(date),
    holiday_name:  holidays.get(date),
  }))
}

// ── Route registration ─────────────────────────────────────────────────────────

export default async function leaveDurationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [(fastify as any).authenticate] }

  // ── POST /leave/duration/preview ───────────────────────────────────────────
  //
  // Computes the duration for a leave span without persisting anything.
  // Used by the frontend to show "you are taking X days" before submission.
  ;(fastify as any).post('/leave/duration/preview', auth, async (req: any, reply: any) => {
    const schema = z.object({
      employee_id:      z.string().uuid(),
      leave_type_id:    z.string().uuid(),
      start_date:       z.string().regex(dateRe, 'start_date must be YYYY-MM-DD'),
      start_session:    z.enum(['full_day', 'first_half', 'second_half', 'hourly']).default('full_day'),
      end_date:         z.string().regex(dateRe, 'end_date must be YYYY-MM-DD'),
      end_session:      z.enum(['full_day', 'first_half', 'second_half', 'hourly']).default('full_day'),
      requested_hours:  z.number().positive().max(24).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const {
      employee_id,
      leave_type_id,
      start_date,
      start_session,
      end_date,
      end_session,
      requested_hours,
    } = parsed.data

    // Verify the employee belongs to this tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Build the span
    const span: LeaveSessionSpan = {
      start_date,
      start_session,
      end_date,
      end_session,
      requested_hours,
    }

    // Validate the span before calling the engine
    const spanErrors = validateSessionSpan(span)
    if (spanErrors.length > 0) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: spanErrors[0],
        details: spanErrors,
      })
    }

    // Resolve policy and build day contexts in parallel
    const [policy, holidays] = await Promise.all([
      resolveEffectiveDurationPolicy(
        fastify.supabase,
        req.tenantId,
        employee_id,
        leave_type_id,
        start_date,
      ),
      fetchHolidays(fastify.supabase, req.tenantId, start_date, end_date),
    ])

    const dayInfo = buildDayContexts(start_date, end_date, holidays)

    // Compute duration — engine is pure, no I/O
    const result = computeLeaveDuration(span, dayInfo, policy)

    return reply.send({ data: result })
  })

  // ── GET /leave/duration/explain/:requestId ─────────────────────────────────
  //
  // Re-explains the duration computation for a stored leave request.
  // Returns the stored breakdown plus a freshly regenerated explain trace.
  ;(fastify as any).get('/leave/duration/explain/:requestId', auth, async (req: any, reply: any) => {
    const { requestId } = req.params as { requestId: string }

    // Fetch the leave request (tenant-scoped)
    const { data: leaveReq } = await fastify.supabase
      .from('leave_requests')
      .select(`
        id, from_date, to_date, session,
        start_session, end_session,
        duration_breakdown, engine_version,
        employee_id, leave_type_id,
        hours_requested
      `)
      .eq('id', requestId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!leaveReq) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Leave request not found' })
    }

    const lr = leaveReq as any

    // Reconstruct the span from stored fields.
    // Prefer the new start_session / end_session columns; fall back to session for
    // requests created before the duration engine was introduced.
    const storedStartSession: string = lr.start_session ?? lr.session ?? 'full_day'
    const storedEndSession:   string = lr.end_session   ?? lr.session ?? 'full_day'

    const span: LeaveSessionSpan = {
      start_date:      lr.from_date,
      start_session:   storedStartSession as any,
      end_date:        lr.to_date,
      end_session:     storedEndSession as any,
      requested_hours: lr.hours_requested ?? undefined,
    }

    // Re-fetch day contexts to regenerate the explain trace
    const [policy, holidays] = await Promise.all([
      resolveEffectiveDurationPolicy(
        fastify.supabase,
        req.tenantId,
        lr.employee_id,
        lr.leave_type_id,
        lr.from_date,
      ),
      fetchHolidays(fastify.supabase, req.tenantId, lr.from_date, lr.to_date),
    ])

    const dayInfo = buildDayContexts(lr.from_date, lr.to_date, holidays)

    // Recompute to get fresh explain steps (engine is deterministic / pure)
    const recomputed = computeLeaveDuration(span, dayInfo, policy)

    return reply.send({
      data: {
        request_id:         requestId,
        stored_breakdown:   lr.duration_breakdown ?? null,
        engine_version:     lr.engine_version     ?? recomputed.engine_version,
        recomputed_result:  recomputed,
        explain:            recomputed.explain,
      },
    })
  })
}
