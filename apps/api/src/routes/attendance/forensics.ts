/**
 * GET /attendance/forensics/:employeeId/:date
 *
 * Returns a complete per-day forensic trace for a single employee using a
 * UNIFIED PROVENANCE MODEL that covers BOTH attendance pipelines:
 *
 *  Pipeline A — Biometric/Device
 *    attendance_raw_logs  → attendance_logs (sessions) → attendance_daily
 *
 *  Pipeline B — CSV Upload
 *    attendance_punch_logs (source='csv_upload') → recomputeRange → attendance_daily
 *
 * The response always exposes:
 *   raw_punches    — biometric device punches (Pipeline A)
 *   csv_punches    — CSV-uploaded IN/OUT punches (Pipeline B)
 *   source_type    — 'biometric' | 'csv_upload' | 'mixed' | 'none' — auto-detected
 *
 * The timeline includes events from both pipelines under unified types:
 *   raw_punch / csv_punch / session_paired / shift_resolved / computation_result
 *   leave_applied / leave_approved / correction_requested / status_change / etc.
 *
 * The "Final Status" stage of ComputationFlow shows correctly whenever
 * attendance_daily has a row — regardless of which pipeline produced it.
 *
 * Auth: hr_admin / super_admin
 */
import type { FastifyInstance } from 'fastify'
import { resolveEmployeeOrgContext, getWeeklyOffDays } from '../../lib/org-context.js'
import { normalizeAttendanceStatus } from '../../lib/attendance-utils.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Advance a YYYY-MM-DD string by N calendar days (UTC-safe). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default async function attendanceForensicsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get<{ Params: { employeeId: string; date: string } }>(
    '/attendance/forensics/:employeeId/:date',
    auth,
    async (req: any, reply) => {
      if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
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

      // Window for CSV punch queries: date-1 … date+1 (UTC) to catch all
      // timezone edge cases without requiring the tenant timezone here.
      // The engine uses a similar 48-h window for no-shift employees.
      const csvWindowFrom = `${date}T00:00:00.000Z`
      const csvWindowTo   = `${addDays(date, 1)}T23:59:59.999Z`

      // ── Parallel fetch all data sources ─────────────────────────────────
      const [
        { data: rawLogs, error: rawLogsErr },
        { data: processedLogs, error: processedLogsErr },
        { data: dailyRecord, error: dailyRecordErr },
        { data: auditRows, error: auditRowsErr },
        { data: corrections, error: correctionsErr },
        { data: leaveApps, error: leaveAppsErr },
        { data: rosterRow, error: rosterRowErr },
        { data: standingShift, error: standingShiftErr },
        { data: holidayRows, error: holidayRowsErr },
        { data: policyEvals, error: policyEvalsErr },
        // NEW: CSV pipeline punch logs
        { data: csvPunchLogs, error: csvPunchLogsErr },
        // NEW: Upload session for this employee's punches (most recent, last 7d)
        { data: uploadSession, error: uploadSessionErr },
      ] = await Promise.all([
        // 1. Raw device punches (Pipeline A — biometric)
        fastify.supabase
          .from('attendance_raw_logs')
          .select('id, device_id, punch_time:timestamp, direction, created_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_code', (emp as any).employee_code)
          .gte('timestamp', `${date}T00:00:00.000Z`)
          .lte('timestamp', `${date}T23:59:59.999Z`)
          .order('timestamp', { ascending: true }),

        // 2. Processed punch sessions (Pipeline A — biometric)
        // Was .or('check_in.gte.X,check_in.lte.Y') — that compiles to an OR,
        // not a bounded range, so it matched every session the employee ever
        // had (any timestamp is either >= start-of-day or <= end-of-day) and
        // this per-day forensic report silently included the employee's
        // entire session history instead of just the requested date.
        fastify.supabase
          .from('attendance_logs')
          .select('id, check_in, check_out, is_complete, created_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .gte('check_in', `${date}T00:00:00.000Z`)
          .lte('check_in', `${date}T23:59:59.999Z`)
          .order('check_in', { ascending: true }),

        // 3. Computed daily record — includes computed_source to identify which pipeline wrote it
        fastify.supabase
          .from('attendance_daily')
          .select('id, status, work_hours, late_minutes, overtime_minutes, is_payable, day_fraction, worked_on_holiday, worked_on_weekly_off, computed_source, created_at:date, updated_at:date')
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

        // 6. Leave covering this date — canonical leave_requests (status UPPERCASE)
        fastify.supabase
          .from('leave_requests')
          .select('id, status, from_date, to_date, reason, created_at, approved_at, approved_by, leave_types(name, is_paid), profiles!leave_requests_approved_by_fkey(full_name)')
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

        // 8. Standing shift (current assignment)
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

        // 11. CSV pipeline punch logs (Pipeline B)
        // Uses a 48-h UTC window to catch timezone edge cases.
        // `direction` = 'IN' | 'OUT'; `source` = 'csv_upload' (or other)
        fastify.supabase
          .from('attendance_punch_logs')
          .select('id, punched_at, direction, source, created_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .gte('punched_at', csvWindowFrom)
          .lte('punched_at', csvWindowTo)
          .order('punched_at', { ascending: true }),

        // 12. Most recent upload session for CSV provenance context (last 7 days)
        fastify.supabase
          .from('upload_sessions')
          .select('id, created_at, status, result_summary')
          .eq('tenant_id', req.tenantId)
          .eq('upload_type', 'attendance_csv')
          .eq('status', 'completed')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      // None of these 12 queries previously checked `error` — a transient
      // DB failure on any one silently rendered as an empty/null result,
      // so this forensic trace (built to reconstruct provenance for pay
      // disputes) could present an incomplete picture as if it were
      // complete, with no signal to the admin that something was missing.
      const firstError = [
        rawLogsErr, processedLogsErr, dailyRecordErr, auditRowsErr, correctionsErr,
        leaveAppsErr, rosterRowErr, standingShiftErr, holidayRowsErr, policyEvalsErr,
        csvPunchLogsErr, uploadSessionErr,
      ].find(Boolean)
      if (firstError) return serverError(req, reply, firstError, ErrorCode.QUERY_FAILED, 'Failed to build attendance forensic trace')

      // ── Normalise daily record status ────────────────────────────────────
      const daily = dailyRecord as any
      if (daily?.status) {
        daily.status = normalizeAttendanceStatus(daily.status)
      }

      // ── Detect active source pipeline ────────────────────────────────────
      const hasBiometric = (rawLogs ?? []).length > 0
      const hasCsv       = (csvPunchLogs ?? []).length > 0
      const sourceType: 'biometric' | 'csv_upload' | 'mixed' | 'none' =
        hasBiometric && hasCsv ? 'mixed'
        : hasBiometric          ? 'biometric'
        : hasCsv                ? 'csv_upload'
        :                         'none'

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

      // ── Weekly-off check ─────────────────────────────────────────────────
      const dayOfWeek = new Date(`${date}T12:00:00.000Z`).getUTCDay()
      const orgCtx = await resolveEmployeeOrgContext(fastify.supabase, req.tenantId, employeeId, date)
      const weeklyOffDays = getWeeklyOffDays(
        [],
        orgCtx.emp_roster_weekly_off,
        orgCtx.site_default_roster_weekly_off,
      )
      const isWeeklyOff = weeklyOffDays.includes(dayOfWeek)

      // ── Build chronological timeline ─────────────────────────────────────
      type TimelineEvent = {
        time:     string | null
        type:     string
        label:    string
        detail:   string | null
        actor:    string | null
        severity: 'info' | 'success' | 'warning' | 'error' | 'neutral'
        source_badge?: string   // 'CSV Upload' | 'Biometric Device' | 'Manual Override' | etc.
        meta:     Record<string, unknown>
      }

      const timeline: TimelineEvent[] = []

      // ── Pipeline A: biometric raw punches ────────────────────────────────
      for (const r of (rawLogs ?? []) as any[]) {
        timeline.push({
          time:         r.punch_time,
          type:         'raw_punch',
          label:        `Raw punch — ${r.direction ?? 'unknown direction'}`,
          detail:       r.device_id ? `Device: ${r.device_id}` : null,
          actor:        'device',
          severity:     'neutral',
          source_badge: 'Biometric Device',
          meta:         { id: r.id, device_id: r.device_id, direction: r.direction, pipeline: 'biometric' },
        })
      }

      // ── Pipeline B: CSV punch logs ───────────────────────────────────────
      for (const p of (csvPunchLogs ?? []) as any[]) {
        const dirLabel = (p.direction ?? '').toUpperCase()
        const srcLabel = p.source === 'csv_upload' ? 'CSV Upload' : p.source ?? 'unknown'
        timeline.push({
          time:         p.punched_at,
          type:         'csv_punch',
          label:        `CSV punch — ${dirLabel}`,
          detail:       `Source: ${srcLabel}`,
          actor:        'system',
          severity:     'neutral',
          source_badge: 'CSV Upload',
          meta:         {
            id:        p.id,
            direction: p.direction,
            source:    p.source,
            pipeline:  'csv_upload',
          },
        })
      }

      // ── Processed sessions (biometric pipeline) ──────────────────────────
      for (const s of (processedLogs ?? []) as any[]) {
        // work_minutes is derived from the check-in/out pair (not a stored column)
        const wm = (s.check_in && s.check_out)
          ? Math.round((new Date(s.check_out).getTime() - new Date(s.check_in).getTime()) / 60000)
          : null
        const dur = wm != null ? `${wm}m` : '?'
        timeline.push({
          time:         s.check_in,
          type:         'session_paired',
          label:        s.is_complete ? `Session paired — ${dur}` : 'Session opened (no OUT)',
          detail:       s.check_out ? `IN ${fmtIso(s.check_in)} → OUT ${fmtIso(s.check_out)}` : `IN ${fmtIso(s.check_in)} → OUT pending`,
          actor:        'system',
          severity:     s.is_complete ? 'info' : 'warning',
          source_badge: 'Biometric Device',
          meta:         { id: s.id, is_complete: s.is_complete, work_minutes: wm, pipeline: 'biometric' },
        })
      }

      // ── Shift resolution ─────────────────────────────────────────────────
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
          label:    'No shift assigned — using default window',
          detail:   'Default: 9h work window, late threshold at start hour. Without a shift, late minutes cannot be computed precisely.',
          actor:    'system',
          severity: 'warning',
          meta:     {},
        })
      }

      // ── Holiday overlay ──────────────────────────────────────────────────
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

      // ── Weekly-off ───────────────────────────────────────────────────────
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

      // ── Recompute job context (CSV pipeline) ─────────────────────────────
      // Surface when the daily record was computed via the CSV recompute engine
      if (daily?.computed_source === 'engine' && hasCsv) {
        timeline.push({
          time:         daily.created_at ?? null,
          type:         'recompute_job',
          label:        'Attendance recomputed (CSV upload pipeline)',
          detail:       uploadSession
            ? `Upload session ${(uploadSession as any).id?.slice(0, 8)}… at ${fmtIso((uploadSession as any).created_at)}`
            : 'CSV punch logs processed by attendance engine',
          actor:        'system',
          severity:     'info',
          source_badge: 'CSV Upload',
          meta:         {
            computed_source: 'engine',
            pipeline:        'csv_upload',
            upload_session:  uploadSession ? {
              id:         (uploadSession as any).id,
              created_at: (uploadSession as any).created_at,
              summary:    (uploadSession as any).result_summary,
            } : null,
          },
        })
      }

      // ── Daily computation result ─────────────────────────────────────────
      // This event is produced whenever attendance_daily has a row, regardless
      // of which pipeline wrote it. "Not computed" is never shown when daily
      // record exists — it now always maps to the correct source badge.
      if (daily) {
        const sourceBadge =
          daily.computed_source === 'engine'          ? (hasCsv ? 'CSV Upload' : 'Biometric Device')
          : daily.computed_source === 'manual'        ? 'Manual Override'
          : daily.computed_source === 'leave_approval'? 'Leave Override'
          : daily.computed_source === 'regularization'? 'Correction'
          : 'System'

        timeline.push({
          time:         daily.updated_at ?? daily.created_at,
          type:         'computation_result',
          label:        `Daily status computed: ${daily.status}`,
          detail:       `${daily.work_hours}h worked · ${daily.late_minutes}m late · ${daily.overtime_minutes}m OT · payable=${daily.is_payable}`,
          actor:        'system',
          severity:     daily.status === 'absent' ? 'error' : daily.status === 'late' ? 'warning' : 'success',
          source_badge: sourceBadge,
          meta:         {
            status:               daily.status,
            work_hours:           daily.work_hours,
            late_minutes:         daily.late_minutes,
            overtime_minutes:     daily.overtime_minutes,
            is_payable:           daily.is_payable,
            day_fraction:         daily.day_fraction,
            worked_on_holiday:    daily.worked_on_holiday,
            worked_on_weekly_off: daily.worked_on_weekly_off,
            computed_source:      daily.computed_source,
            pipeline:             hasCsv ? 'csv_upload' : hasBiometric ? 'biometric' : 'engine',
          },
        })
      }

      // ── Leave applications ───────────────────────────────────────────────
      for (const la of (leaveApps ?? []) as any[]) {
        timeline.push({
          time:         la.created_at,
          type:         'leave_applied',
          label:        `Leave applied: ${la.leave_types?.name ?? 'unknown'}`,
          detail:       `${la.from_date} – ${la.to_date} · status=${la.status}`,
          actor:        'employee',
          severity:     'info',
          source_badge: 'Leave',
          meta:         { id: la.id, status: la.status, leave_type: la.leave_types?.name },
        })
        if (la.status?.toUpperCase() === 'APPROVED' && la.approved_at) {
          timeline.push({
            time:         la.approved_at,
            type:         'leave_approved',
            label:        'Leave approved',
            detail:       `By ${la.profiles?.full_name ?? 'HR'}`,
            actor:        la.profiles?.full_name ?? null,
            severity:     'success',
            source_badge: 'Leave Override',
            meta:         { leave_id: la.id, approved_by: la.approved_by },
          })
        }
        if (la.status?.toUpperCase() === 'REJECTED') {
          timeline.push({
            time:         la.approved_at ?? null,
            type:         'leave_rejected',
            label:        'Leave rejected',
            detail:       `By ${la.profiles?.full_name ?? 'HR'}`,
            actor:        la.profiles?.full_name ?? null,
            severity:     'error',
            source_badge: 'Leave',
            meta:         { leave_id: la.id },
          })
        }
      }

      // ── Correction requests ──────────────────────────────────────────────
      for (const cr of (corrections ?? []) as any[]) {
        timeline.push({
          time:         cr.created_at,
          type:         'correction_requested',
          label:        'Attendance correction requested',
          detail:       cr.reason ?? null,
          actor:        'employee',
          severity:     'warning',
          source_badge: 'Correction',
          meta:         {
            id:                   cr.id,
            status:               cr.status,
            requested_check_in:   cr.requested_check_in,
            requested_check_out:  cr.requested_check_out,
          },
        })
        if (cr.status === 'approved' && cr.approved_at) {
          timeline.push({
            time:         cr.approved_at,
            type:         'correction_approved',
            label:        'Correction approved — daily record recomputed',
            detail:       `By ${(cr.profiles as any)?.full_name ?? 'HR'}`,
            actor:        (cr.profiles as any)?.full_name ?? null,
            severity:     'success',
            source_badge: 'Correction',
            meta:         { correction_id: cr.id },
          })
        }
        if (cr.status === 'rejected') {
          timeline.push({
            time:         cr.approved_at ?? null,
            type:         'correction_rejected',
            label:        'Correction rejected',
            detail:       `By ${(cr.profiles as any)?.full_name ?? 'HR'}`,
            actor:        (cr.profiles as any)?.full_name ?? null,
            severity:     'error',
            source_badge: 'Correction',
            meta:         { correction_id: cr.id },
          })
        }
      }

      // ── Audit trail — status changes ─────────────────────────────────────
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

      // ── Policy evaluation log ─────────────────────────────────────────────
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

      // ── Sort: by time (nulls last, logical order) ────────────────────────
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

        // Provenance metadata — tells the frontend which pipeline produced this data
        source_type:         sourceType,
        computed_source:     daily?.computed_source ?? null,

        daily_record:        daily ?? null,
        effective_shift:     effectiveShift,
        holiday:             holiday,
        is_weekly_off:       isWeeklyOff,

        // Pipeline A (biometric)
        raw_punches:         rawLogs ?? [],
        processed_sessions:  processedLogs ?? [],

        // Pipeline B (CSV upload)
        csv_punches:         csvPunchLogs ?? [],

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
