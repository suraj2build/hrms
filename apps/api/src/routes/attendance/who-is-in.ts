/**
 * Who Is In — Real-time Tenant-wide Attendance Status
 *
 * GET /attendance/who-is-in?date=YYYY-MM-DD&shift_id=UUID
 *
 * Returns all active employees grouped into four buckets:
 *   not_yet_in    — no check-in recorded; expected but absent so far
 *   late_arrivals — checked in after shift start + grace window
 *   on_time       — checked in within the grace window
 *   out_of_office — on leave / holiday / weekly-off / comp-off
 *
 * Shift priority: shift_roster (date-specific) > employee_shifts (standing)
 * Expected check-in = shift.start_time + grace_minutes
 *
 * Auth: hr_admin / super_admin only
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const OUT_OF_OFFICE_STATUSES = new Set(['leave', 'holiday', 'weekly_off', 'comp_off', 'rest_day', 'off'])

export default async function whoIsInRoute(fastify: FastifyInstance) {
  // hr_admin, super_admin → tenant-wide view
  // manager              → scoped to direct reports only
  const auth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!['super_admin', 'hr_admin', 'manager'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin access required' })
      return
    }
    done()
  }] }

  fastify.get('/attendance/who-is-in', auth, async (req: any, reply) => { try {
    const schema = z.object({
      date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      shift_id: z.string().uuid().optional(),
    })

    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const tenantId = req.tenantId as string
    const date     = parsed.data.date ?? new Date().toISOString().slice(0, 10)
    const shiftFilter = parsed.data.shift_id

    // ── 1. Resolve employee scope ─────────────────────────────────────────────
    // Admin → all active employees in tenant
    // Manager → direct reports only (employees.manager_id = caller's employee_id)
    const isAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    let empQuery = fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    if (!isAdmin) {
      // Resolve the manager's own employee_id
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', tenantId)
        .single()

      const managerEmpId = (callerProfile as any)?.employee_id
      if (!managerEmpId) {
        return reply.send(emptyResponse(date))
      }
      empQuery = empQuery.eq('manager_id', managerEmpId)
    }

    const { data: employees, error: empErr } = await empQuery

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: empErr.message })

    const emps     = (employees ?? []) as any[]
    const empIds   = emps.map(e => e.id)

    if (empIds.length === 0) {
      return reply.send(emptyResponse(date))
    }

    // ── 2. Parallel fetch: daily status, punch logs, shifts ───────────────────
    const [dailyRes, firstInRes, shiftRosterRes, empShiftsRes, leaveAppRes] = await Promise.all([

      // Today's attendance_daily rows
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, status, work_hours, late_minutes')
        .eq('tenant_id', tenantId)
        .eq('date', date)
        .in('employee_id', empIds),

      // First check-in punch per employee today
      fastify.supabase
        .from('attendance_logs')
        .select('employee_id, check_in')
        .eq('tenant_id', tenantId)
        .gte('check_in', `${date}T00:00:00.000Z`)
        .lt('check_in',  `${date}T23:59:59.999Z`)
        .in('employee_id', empIds)
        .order('check_in', { ascending: true }),

      // Date-specific shift roster overrides
      fastify.supabase
        .from('shift_roster')
        .select('employee_id, shift_id, shifts(id, name, start_time, grace_minutes)')
        .eq('tenant_id', tenantId)
        .eq('date', date)
        .in('employee_id', empIds),

      // Standing shift assignments (fallback)
      fastify.supabase
        .from('employee_shifts')
        .select('employee_id, shift_id, shifts(id, name, start_time, grace_minutes)')
        .eq('tenant_id', tenantId)
        .eq('is_current', true)
        .in('employee_id', empIds),

      // Approved leave applications covering today (for "Applied" badge)
      fastify.supabase
        .from('leave_applications')
        .select('employee_id, from_date, to_date')
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .lte('from_date', date)
        .gte('to_date',   date)
        .in('employee_id', empIds),
    ])

    // ── 3. Build lookup maps ──────────────────────────────────────────────────

    // Daily status map
    const dailyMap = new Map<string, { status: string; work_hours: number; late_minutes: number }>()
    for (const r of (dailyRes.data ?? []) as any[]) {
      dailyMap.set(r.employee_id, r)
    }

    // First check-in map
    const firstInMap = new Map<string, string>()
    for (const r of (firstInRes.data ?? []) as any[]) {
      if (!firstInMap.has(r.employee_id) && r.check_in) {
        firstInMap.set(r.employee_id, r.check_in)
      }
    }

    // Shift map: roster overrides standing
    const shiftMap = new Map<string, { shift_id: string; name: string; start_time: string; grace_minutes: number }>()
    for (const r of (empShiftsRes.data ?? []) as any[]) {
      const s = Array.isArray(r.shifts) ? r.shifts[0] : r.shifts
      if (s) shiftMap.set(r.employee_id, { shift_id: r.shift_id, name: s.name, start_time: s.start_time, grace_minutes: s.grace_minutes ?? 0 })
    }
    for (const r of (shiftRosterRes.data ?? []) as any[]) {
      const s = Array.isArray(r.shifts) ? r.shifts[0] : r.shifts
      if (s) shiftMap.set(r.employee_id, { shift_id: r.shift_id, name: s.name, start_time: s.start_time, grace_minutes: s.grace_minutes ?? 0 })
    }

    // Leave application set (for "Applied" badge)
    const leaveAppliedSet = new Set<string>(
      ((leaveAppRes.data ?? []) as any[]).map((r: any) => r.employee_id)
    )

    // ── 4. Helper: compute expected check-in string from shift ─────────────────
    function expectedCheckIn(shift: { start_time: string; grace_minutes: number }): string {
      // start_time is HH:MM:SS; add grace_minutes → expected latest on-time arrival
      const [h, m] = shift.start_time.split(':').map(Number)
      const totalMins = h * 60 + m + shift.grace_minutes
      const eh = Math.floor(totalMins / 60) % 24
      const em = totalMins % 60
      return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`
    }

    // ── 5. Classify every employee ─────────────────────────────────────────────
    const notYetIn:    any[] = []
    const lateArrivals: any[] = []
    const onTime:       any[] = []
    const outOfOffice:  any[] = []

    let oooLeave   = 0
    let oooHoliday = 0
    let oooOffDay  = 0
    let oooRestDay = 0

    for (const emp of emps) {
      const daily    = dailyMap.get(emp.id)
      const status   = (daily?.status ?? 'not_marked').toLowerCase()
      const checkIn  = firstInMap.get(emp.id) ?? null
      const shift    = shiftMap.get(emp.id)
      const dept: { name?: string } | null = null   // department resolved separately; not on employees table

      const base = {
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        name:          `${emp.first_name} ${emp.last_name}`,
        department:    (dept as { name?: string } | null)?.name ?? null,
        shift_name:    shift?.name ?? null,
      }

      // Apply shift filter if requested
      if (shiftFilter && shift?.shift_id !== shiftFilter) continue

      // Out of office bucket
      if (OUT_OF_OFFICE_STATUSES.has(status)) {
        const isLeave   = status === 'leave'
        const isHoliday = status === 'holiday'
        const isOffDay  = status === 'weekly_off' || status === 'off'
        const isRestDay = status === 'comp_off' || status === 'rest_day'

        if (isLeave)   oooLeave++
        if (isHoliday) oooHoliday++
        if (isOffDay)  oooOffDay++
        if (isRestDay) oooRestDay++

        outOfOffice.push({
          ...base,
          status,
          days:    1,
          applied: isLeave && leaveAppliedSet.has(emp.id),
        })
        continue
      }

      // Has checked in
      if (checkIn) {
        const lateMinutes = daily?.late_minutes ?? 0
        const checkInTime = checkIn.slice(11, 19) // HH:MM:SS

        if (status === 'late' || lateMinutes > 0) {
          lateArrivals.push({
            ...base,
            check_in:     checkInTime,
            late_minutes: lateMinutes,
            late_by:      formatDuration(lateMinutes),
          })
        } else {
          // On time — compute how early
          let earlyMinutes = 0
          if (shift) {
            const [sh, sm] = shift.start_time.split(':').map(Number)
            const shiftStartMins = sh * 60 + sm
            const [ch, cm] = checkInTime.split(':').map(Number)
            const checkInMins = ch * 60 + cm
            earlyMinutes = Math.max(0, shiftStartMins - checkInMins)
          }
          onTime.push({
            ...base,
            check_in:      checkInTime,
            early_minutes: earlyMinutes,
            early_by:      formatDuration(earlyMinutes),
          })
        }
        continue
      }

      // No check-in and not out of office → Not Yet In
      notYetIn.push({
        ...base,
        expected_time: shift ? expectedCheckIn(shift) : null,
      })
    }

    // ── 6. Summary ────────────────────────────────────────────────────────────
    const total = notYetIn.length + lateArrivals.length + onTime.length + outOfOffice.length
    const pct   = (n: number) => total > 0 ? Math.round((n / total) * 100 * 100) / 100 : 0

    return reply.send({
      date,
      summary: {
        not_yet_in:    { count: notYetIn.length,     pct: pct(notYetIn.length)     },
        late_arrivals: { count: lateArrivals.length,  pct: pct(lateArrivals.length)  },
        on_time:       { count: onTime.length,         pct: pct(onTime.length)        },
        out_of_office: { count: outOfOffice.length,    pct: pct(outOfOffice.length)   },
        total,
      },
      not_yet_in:    notYetIn,
      late_arrivals: lateArrivals.sort((a, b) => b.late_minutes - a.late_minutes),
      on_time:       onTime.sort((a, b) => b.early_minutes - a.early_minutes),
      out_of_office: {
        on_leave:  oooLeave,
        holiday:   oooHoliday,
        off_day:   oooOffDay,
        rest_day:  oooRestDay,
        employees: outOfOffice,
      },
    })
  } catch (err: any) {
    req.log.error({ err }, 'who-is-in unhandled error')
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: err?.message ?? String(err), stack: err?.stack })
  }
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyResponse(date: string) {
  return {
    date,
    summary: {
      not_yet_in:    { count: 0, pct: 0 },
      late_arrivals: { count: 0, pct: 0 },
      on_time:       { count: 0, pct: 0 },
      out_of_office: { count: 0, pct: 0 },
      total: 0,
    },
    not_yet_in:    [],
    late_arrivals: [],
    on_time:       [],
    out_of_office: { on_leave: 0, holiday: 0, off_day: 0, rest_day: 0, employees: [] },
  }
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '00:00'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
