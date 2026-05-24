/**
 * GET /attendance/forensics/:employeeId/:date
 *
 * Returns a complete per-day forensic trace for a single employee:
 *   raw punches → processed sessions → computation result →
 *   shift resolution → holiday/leave overlay → corrections →
 *   policy evaluations → full actor audit trail.
 *
 * Auth: hr_admin / super_admin
 */
import type { FastifyInstance } from 'fastify'
import { resolveEmployeeOrgContext, getWeeklyOffDays } from '../../lib/org-context.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function attendanceForensicsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get<{ Params: { employeeId: string; date: string } }>(
    '/attendance/forensics/:employeeId/:date',
    auth,
    async (req: any, reply) => {
      if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      }

      const { employeeId, date } = req.params
      if (!DATE_RE.test(date)) {
        return reply.code(400).send({ error: 'INVALID_DATE', message: 'Date must be YYYY-MM-DD' })
      }

      // ── Tenant-scope the employee ────────────────────────────────────────
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      // ── Parallel fetch all data sources ─────────────────────────────────
      const [
        { data: rawLogs },
        { data: processedLogs },
        { data: dailyRecord },
        { data: auditRows },
        { data: corrections },
        { data: leaveApps },
        { data: rosterRow },
        { data: standingShift },
        { data: holidayRows },
        { data: policyEvals },
      ] = await Promise.all([
        // 1. Raw device punches
        fastify.supabase
          .from('attendance_raw_logs')
          .select('id, device_id, punch_time, direction, created_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .gte('punch_time', `${date}T00:00:00.000Z`)
          .lte('punch_time', `${date}T23:59:59.999Z`)
          .order('punch_time', { ascending: true }),

        // 2. Processed punch sessions
        fastify.supabase
          .from('attendance_logs')
          .select('id, check_in, check_out, is_complete, work_minutes, created_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .or(`check_in.gte.${date}T00:00:00.000Z,check_in.lte.${date}T23:59:59.999Z`)
          .order('check_in', { ascending: true }),

        // 3. Computed daily record
        fastify.supabase
          .from('attendance_daily')
          .select('id, status, work_hours, late_minutes, overtime_minutes, is_payable, day_fraction, worked_on_holiday, worked_on_weekly_off, created_at, updated_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .maybeSingle(),

        // 4. Audit trail
        fastify.supabase
          .from('attendance_audit_log')
          .select('id, source, before_status, after_status, created_at, metadata, changed_by, profiles(full_name)')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .order('created_at', { ascending: true }),

        // 5. Correction requests
        fastify.supabase
          .from('attendance_regularisation')
          .select('id, status, requested_check_in, requested_check_out, reason, created_at, approved_at, approved_by, profiles!attendance_regularisation_approved_by_fkey(full_name)')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .order('created_at', { ascending: true }),

        // 6. Leave applications covering this date
        fastify.supabase
          .from('leave_applications')
          .select('id, status, from_date, to_date, reason, created_at, approved_at, approved_by, leave_types(name, is_paid), profiles!leave_applications_approved_by_fkey(full_name)')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .lte('from_date', date)
          .gte('to_date', date)
          .order('created_at', { ascending: true }),

        // 7. Roster override for this date
        fastify.supabase
          .from('shift_roster')
          .select('id, shift_id, shifts(id, name, code, start_time, end_time, grace_minutes)')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .maybeSingle(),

        // 8. Standing shift (current assignment) — timing fields only; weekly-off is roster-derived
        fastify.supabase
          .from('employee_shifts')
          .select('id, effective_from, shifts(id, name, code, start_time, end_time, grace_minutes)')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('is_current', true)
          .maybeSingle(),

        // 9. Holiday on this date
        fastify.supabase
          .from('holiday_calendar')
          .select('id, name, holiday_type')
          .eq('tenant_id', req.tenantId)
          .eq('date', date),

        // 10. Policy evaluation log
        fastify.supabase
          .from('policy_evaluation_log')
          .select('id, policy_name, policy_version, resolved_via, eligible, eligibility_reason, trigger_context, is_simulation, evaluated_at, leave_types(name)')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('evaluated_on', date)
          .order('evaluated_at', { ascending: false })
          .limit(20),
      ])

      // ── Derive shift in use ──────────────────────────────────────────────
      const rosterShift  = (rosterRow as any)?.shifts ?? null
      const standingData = (standingShift as any)?.shifts ?? null
      const effectiveShift = rosterShift
        ? { ...(rosterShift as object), source: 'roster' as const }
        : standingData
        ? { ...(standingData as object), source: 'standing' as const }
        : null

      // ── Holiday check ────────────────────────────────────────────────────
      const holiday = (holidayRows ?? [])[0] ?? null

      // ── Compute day-of-week for weekly_off check ─────────────────────────
      // Weekly-off days come exclusively from rosters, not shifts.
      const dayOfWeek = new Date(`${date}T12:00:00.000Z`).getUTCDay()
      const orgCtx = await resolveEmployeeOrgContext(fastify.supabase, req.tenantId, employeeId, date)
      const weeklyOffDays = getWeeklyOffDays(
        [],   // shift weekly_off_days deprecated — roster is the sole source
        orgCtx.emp_roster_weekly_off,
        orgCtx.site_default_roster_weekly_off,
      )
      const isWeeklyOff = weeklyOffDays.includes(dayOfWeek)

      // ── Build chronological timeline ─────────────────────────────────────
      type TimelineEvent = {
        time: string | null
        type: string
        label: string
        detail: string | null
        actor: string | null
        severity: 'info' | 'success' | 'warning' | 'error' | 'neutral'
        meta: Record<string, unknown>
      }

      const timeline: TimelineEvent[] = []

      // Raw punches
      for (const r of (rawLogs ?? []) as any[]) {
        timeline.push({
          time:     r.punch_time,
          type:     'raw_punch',
          label:    `Raw punch — ${r.direction ?? 'unknown direction'}`,
          detail:   r.device_id ? `Device: ${r.device_id}` : null,
          actor:    'device',
          severity: 'neutral',
          meta:     { id: r.id, device_id: r.device_id, direction: r.direction },
        })
      }

      // Processed sessions
      for (const s of (processedLogs ?? []) as any[]) {
        const dur = s.work_minutes != null ? `${Math.round(s.work_minutes)}m` : '?'
        timeline.push({
          time:     s.check_in,
          type:     'session_paired',
          label:    s.is_complete ? `Session paired — ${dur}` : 'Session opened (no OUT)',
          detail:   s.check_out ? `IN ${fmtIso(s.check_in)} → OUT ${fmtIso(s.check_out)}` : `IN ${fmtIso(s.check_in)} → OUT pending`,
          actor:    'system',
          severity: s.is_complete ? 'info' : 'warning',
          meta:     { id: s.id, is_complete: s.is_complete, work_minutes: s.work_minutes },
        })
      }

      // Shift resolution
      if (effectiveShift) {
        timeline.push({
          time:     null,
          type:     'shift_resolved',
          label:    `Shift resolved: ${(effectiveShift as any).name} (${effectiveShift.source})`,
          detail:   `${(effectiveShift as any).start_time} – ${(effectiveShift as any).end_time}, grace ${(effectiveShift as any).grace_minutes ?? 0}m`,
          actor:    'system',
          severity: effectiveShift.source === 'roster' ? 'info' : 'neutral',
          meta:     { shift: effectiveShift },
        })
      } else {
        timeline.push({
          time:     null,
          type:     'shift_resolved',
          label:    'No shift assigned',
          detail:   'Late minutes cannot be computed without a shift',
          actor:    'system',
          severity: 'warning',
          meta:     {},
        })
      }

      // Holiday overlay
      if (holiday) {
        timeline.push({
          time:     null,
          type:     'holiday',
          label:    `Holiday: ${(holiday as any).name}`,
          detail:   `Type: ${(holiday as any).holiday_type ?? 'general'}`,
          actor:    'system',
          severity: 'info',
          meta:     { holiday },
        })
      }

      // Weekly-off
      if (isWeeklyOff) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        timeline.push({
          time:     null,
          type:     'weekly_off',
          label:    `Weekly-off day (${dayNames[dayOfWeek]})`,
          detail:   null,
          actor:    'system',
          severity: 'neutral',
          meta:     { day_of_week: dayOfWeek },
        })
      }

      // Daily computation result
      if (dailyRecord) {
        const d = dailyRecord as any
        timeline.push({
          time:     d.updated_at ?? d.created_at,
          type:     'computation_result',
          label:    `Daily status computed: ${d.status}`,
          detail:   `${d.work_hours}h worked · ${d.late_minutes}m late · ${d.overtime_minutes}m OT · payable=${d.is_payable}`,
          actor:    'system',
          severity: d.status === 'absent' ? 'error' : d.status === 'late' ? 'warning' : 'success',
          meta:     {
            status:              d.status,
            work_hours:          d.work_hours,
            late_minutes:        d.late_minutes,
            overtime_minutes:    d.overtime_minutes,
            is_payable:          d.is_payable,
            day_fraction:        d.day_fraction,
            worked_on_holiday:   d.worked_on_holiday,
            worked_on_weekly_off: d.worked_on_weekly_off,
          },
        })
      }

      // Leave applications
      for (const la of (leaveApps ?? []) as any[]) {
        timeline.push({
          time:     la.created_at,
          type:     'leave_applied',
          label:    `Leave applied: ${la.leave_types?.name ?? 'unknown'}`,
          detail:   `${la.from_date} – ${la.to_date} · status=${la.status}`,
          actor:    'employee',
          severity: 'info',
          meta:     { id: la.id, status: la.status, leave_type: la.leave_types?.name },
        })
        if (la.status === 'approved' && la.approved_at) {
          timeline.push({
            time:     la.approved_at,
            type:     'leave_approved',
            label:    'Leave approved',
            detail:   `By ${la.profiles?.full_name ?? 'HR'}`,
            actor:    la.profiles?.full_name ?? null,
            severity: 'success',
            meta:     { leave_id: la.id, approved_by: la.approved_by },
          })
        }
        if (la.status === 'rejected') {
          timeline.push({
            time:     la.approved_at ?? null,
            type:     'leave_rejected',
            label:    'Leave rejected',
            detail:   `By ${la.profiles?.full_name ?? 'HR'}`,
            actor:    la.profiles?.full_name ?? null,
            severity: 'error',
            meta:     { leave_id: la.id },
          })
        }
      }

      // Correction requests
      for (const cr of (corrections ?? []) as any[]) {
        timeline.push({
          time:     cr.created_at,
          type:     'correction_requested',
          label:    'Attendance correction requested',
          detail:   cr.reason ?? null,
          actor:    'employee',
          severity: 'warning',
          meta:     {
            id:                 cr.id,
            status:             cr.status,
            requested_check_in:  cr.requested_check_in,
            requested_check_out: cr.requested_check_out,
          },
        })
        if (cr.status === 'approved' && cr.approved_at) {
          timeline.push({
            time:     cr.approved_at,
            type:     'correction_approved',
            label:    'Correction approved — daily record recomputed',
            detail:   `By ${(cr.profiles as any)?.full_name ?? 'HR'}`,
            actor:    (cr.profiles as any)?.full_name ?? null,
            severity: 'success',
            meta:     { correction_id: cr.id },
          })
        }
        if (cr.status === 'rejected') {
          timeline.push({
            time:     cr.approved_at ?? null,
            type:     'correction_rejected',
            label:    'Correction rejected',
            detail:   `By ${(cr.profiles as any)?.full_name ?? 'HR'}`,
            actor:    (cr.profiles as any)?.full_name ?? null,
            severity: 'error',
            meta:     { correction_id: cr.id },
          })
        }
      }

      // Audit trail — status changes
      for (const a of (auditRows ?? []) as any[]) {
        const changedBy = a.profiles?.full_name ?? (a.source === 'system' ? 'Attendance Processor' : 'HR')
        timeline.push({
          time:     a.created_at,
          type:     'status_change',
          label:    `Status changed (${a.source}): ${a.before_status ?? '—'} → ${a.after_status}`,
          detail:   null,
          actor:    changedBy,
          severity: a.source === 'regularisation' ? 'info' : a.source === 'leave' ? 'info' : 'neutral',
          meta:     {
            id:             a.id,
            source:         a.source,
            before_status:  a.before_status,
            after_status:   a.after_status,
            run_id:         a.metadata?.run_id ?? null,
          },
        })
      }

      // Policy evaluation log
      for (const pe of (policyEvals ?? []) as any[]) {
        timeline.push({
          time:     pe.evaluated_at,
          type:     'policy_evaluated',
          label:    pe.policy_name
            ? `Policy resolved: ${pe.policy_name} v${pe.policy_version ?? '?'} (${pe.resolved_via})`
            : 'Policy resolution: no match found',
          detail:   pe.eligible === false ? `Not eligible: ${pe.eligibility_reason ?? 'reason unknown'}` : pe.leave_types?.name ? `Leave type: ${pe.leave_types.name}` : null,
          actor:    pe.is_simulation ? 'simulation' : 'system',
          severity: pe.eligible === false ? 'warning' : pe.policy_name ? 'info' : 'neutral',
          meta:     {
            id:               pe.id,
            policy_name:      pe.policy_name,
            policy_version:   pe.policy_version,
            resolved_via:     pe.resolved_via,
            eligible:         pe.eligible,
            trigger_context:  pe.trigger_context,
            is_simulation:    pe.is_simulation,
          },
        })
      }

      // Sort by time (nulls last within their logical order)
      timeline.sort((a, b) => {
        if (!a.time && !b.time) return 0
        if (!a.time) return 1
        if (!b.time) return -1
        return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
      })

      // ── Response ─────────────────────────────────────────────────────────
      return reply.send({
        employee: {
          id:   emp.id,
          name: `${(emp as any).first_name} ${(emp as any).last_name}`,
          code: (emp as any).employee_code,
        },
        date,
        daily_record:        dailyRecord ?? null,
        effective_shift:     effectiveShift,
        holiday:             holiday,
        is_weekly_off:       isWeeklyOff,
        raw_punches:         rawLogs ?? [],
        processed_sessions:  processedLogs ?? [],
        leave_applications:  leaveApps ?? [],
        corrections:         corrections ?? [],
        policy_evaluations:  policyEvals ?? [],
        audit_trail:         auditRows ?? [],
        timeline,
      })
    },
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtIso(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
