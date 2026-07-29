/**
 * GET /ess/home — aggregated home payload for the ESS 2.0 Experience Cloud.
 *
 * Single endpoint that runs all home-screen data in parallel server-side so
 * the client makes ONE network call instead of 13 waterfall fetches.
 *
 * Payload sections:
 *   profile          — name, designation, department, tenure
 *   today            — today's punch state (check_in/check_out/status)
 *   kpis             — leave days remaining, last net pay, open actions
 *   leave_balance    — all leave-type balances
 *   upcoming_holidays — next 5 within 60 days
 *   recognition      — recent kudos received (last 3)
 *   feed_teaser      — last 3 published feed posts
 *   birthdays        — colleagues with DOB anniversary in next 7 days
 *   anniversaries    — colleagues with work anniversary in next 7 days
 *
 * All errors are swallowed per-section — if a sub-query fails, that section
 * is empty/null rather than crashing the whole response (house rule: never
 * let a missing data source blank out the whole home screen).
 */

import type { FastifyInstance } from 'fastify'
import { ensureTodaysCelebrations } from '../../lib/community-celebrations.js'
import { getDirectReportIds } from '../../lib/manager-scope.js'
import { MANAGER_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// Run the (idempotent, write-heavy) celebration generation at most once per tenant
// per day per instance, and OFF the GET response critical path — it was previously
// awaited on every /ess/home request (a full-roster scan + N inserts before the main
// fan-out). Fire-and-forget; the function is idempotent and never throws (RC1 C1).
const celebrationRunDay = new Map<string, string>()

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function offsetISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Days until the MM-DD of a date recurs (0 = today, 1 = tomorrow … 364). */
function daysUntilAnniversary(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [, m, d] = dateStr.split('-').map(Number)
  const thisYear = today.getFullYear()
  let next = new Date(thisYear, m - 1, d)
  if (next < today) next = new Date(thisYear + 1, m - 1, d)
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

function fullName(e: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!e) return 'Unknown'
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Unknown'
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function essHomeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/home', auth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    // Resolve employee_id + role from profiles
    const { data: profileRow, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id, role')
      .eq('id', req.userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (profileErr) return serverError(req, reply, profileErr, ErrorCode.QUERY_FAILED, 'Failed to resolve employee profile')

    const employeeId = (profileRow as any)?.employee_id as string | null
    const role       = (profileRow as any)?.role as string | null
    const isManager  = (MANAGER_ROLES as readonly string[]).includes(role ?? '')

    const today       = todayISO()
    const in60Days    = offsetISO(60)
    const FAKE_EMP_ID = '00000000-0000-0000-0000-000000000000'

    // Ensure today's birthday/anniversary system posts exist so the feed teaser
    // picks them up — but at most once per tenant per day, and never blocking the
    // response (it was awaited on every request — the C1 write-on-GET defect).
    if (celebrationRunDay.get(tenantId) !== today) {
      celebrationRunDay.set(tenantId, today)
      void ensureTodaysCelebrations(fastify.supabase, tenantId).catch(() => {})
    }

    // ── Parallel fan-out (all independent) ──────────────────────────────────
    const [
      empRes,
      jobRes,
      todayAttRes,
      leaveBalRes,
      payslipRes,
      holidayRes,
      recognitionRes,
      feedRes,
      pendingLeaveCnt,
      pendingRegCnt,
      colleaguesRes,
      recentLeaveEndedRes,
      todayPunchRes,
    ] = await Promise.all([
      // 1. Employee basic record
      employeeId
        ? fastify.supabase.from('employees')
            .select('id, first_name, last_name, employee_code, joining_date, dob')
            .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
        : Promise.resolve({ data: null }),

      // 2. Current job row → designation, department, grade, reporting manager
      employeeId
        ? fastify.supabase.from('job_history')
            .select('designations(name), departments(name), grades(name), employees!job_history_manager_id_fkey(first_name, last_name)')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .eq('is_current', true).maybeSingle()
        : Promise.resolve({ data: null }),

      // 3. Today's attendance summary (status + work hours from daily aggregate)
      employeeId
        ? fastify.supabase.from('attendance_daily')
            .select('status, work_hours')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .eq('date', today).maybeSingle()
        : Promise.resolve({ data: null }),

      // 4. Leave balances
      employeeId
        ? fastify.supabase.from('employee_leave_balance')
            .select('balance, leave_types(name)')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .order('balance', { ascending: false }).limit(6)
        : Promise.resolve({ data: [] }),

      // 5. Latest paid payslip (updated_at → detect "salary released today")
      employeeId
        ? fastify.supabase.from('payroll_slips')
            .select('net_pay, month, status, updated_at')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .order('month', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),

      // 6. Upcoming holidays (next 60 days, first 5)
      fastify.supabase.from('holiday_calendar')
        .select('id, name, date')
        .eq('tenant_id', tenantId)
        .gte('date', today).lte('date', in60Days)
        .order('date').limit(5),

      // 7. Recent recognition received
      employeeId
        ? fastify.supabase.from('recognition')
            .select('id, from_employee, badge_code, message, points, created_at')
            .eq('tenant_id', tenantId).eq('to_employee', employeeId)
            .order('created_at', { ascending: false }).limit(3)
        : Promise.resolve({ data: [] }),

      // 8. Community feed teaser
      // Disambiguate the author embed: feed_posts has TWO FKs to employees
      // (author_employee + subject_employee), so name the constraint explicitly.
      fastify.supabase.from('feed_posts')
        .select('id, type, body, created_at, employees!feed_posts_author_employee_fkey(first_name, last_name)')
        .eq('tenant_id', tenantId).eq('status', 'active')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(3),

      // 9. My pending leave count. Fresh audit finding: leave_requests.status
      // is uppercase-only per its CHECK constraint (migration 041) — this
      // compared against lowercase 'pending', so this KPI always read 0.
      employeeId
        ? fastify.supabase.from('leave_requests')
            .select('id', { count: 'exact', head: true })
            .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'PENDING')
        : Promise.resolve({ count: 0 }),

      // 10. My pending regularisation count
      employeeId
        ? fastify.supabase.from('attendance_regularisation')
            .select('id', { count: 'exact', head: true })
            .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'pending')
        : Promise.resolve({ count: 0 }),

      // 11. Active colleagues (for birthday + anniversary computation).
      // Needs the FULL active roster, not a sample — a fixed .limit(500)
      // silently hid every colleague past that cutoff from birthday/
      // anniversary detection for a tenant with a larger headcount, so
      // some employees' celebrations would never appear to anyone.
      fetchAllRows((from, to) =>
        fastify.supabase.from('employees')
          .select('id, first_name, last_name, dob, joining_date')
          .eq('tenant_id', tenantId).eq('status', 'active')
          .not('id', 'eq', employeeId ?? FAKE_EMP_ID)
          .range(from, to),
      ).then((data) => ({ data })),

      // 12. Most recent approved leave that ended yesterday → "welcome back"
      employeeId
        ? fastify.supabase.from('leave_requests')
            .select('to_date')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .in('status', ['approved', 'APPROVED'])
            .eq('to_date', offsetISO(-1)).limit(1)
        : Promise.resolve({ data: [] }),

      // 13. Today's first check-in / last check-out from punch log
      employeeId
        ? fastify.supabase.from('attendance_logs').select('check_in, check_out')
            .eq('employee_id', employeeId).eq('tenant_id', tenantId)
            .gte('check_in', today).lte('check_in', today + 'T23:59:59.999Z')
            .order('check_in', { ascending: true }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    // ── Profile ──────────────────────────────────────────────────────────────
    const emp = (empRes.data ?? null) as any
    const job = (jobRes.data ?? null) as any
    const tenureMonths = emp?.joining_date
      ? Math.floor((Date.now() - new Date(emp.joining_date).getTime()) / (30.4375 * 86_400_000))
      : 0

    const profile = {
      id:            emp?.id       ?? null,
      name:          emp           ? fullName(emp) : null,
      employee_code: emp?.employee_code ?? null,
      joining_date:  emp?.joining_date  ?? null,
      tenure_months: tenureMonths,
      designation:   (job?.designations as any)?.name  ?? null,
      department:    (job?.departments  as any)?.name  ?? null,
      grade:         (job?.grades       as any)?.name  ?? null,
      manager:       job?.employees ? fullName(job.employees as any) : null,
    }

    // ── Today's attendance ────────────────────────────────────────────────────
    const todayAtt   = (todayAttRes.data   ?? null) as any
    const todayPunch = (todayPunchRes.data  ?? null) as any
    const today_snapshot = {
      check_in:    todayPunch?.check_in  ?? null,
      check_out:   todayPunch?.check_out ?? null,
      total_hours: todayAtt?.work_hours  ?? null,
      status:      todayAtt?.status      ?? 'absent',
    }

    // ── KPIs ─────────────────────────────────────────────────────────────────
    const leaveRows   = (leaveBalRes.data ?? []) as any[]
    const totalLeave  = leaveRows.reduce((s: number, b: any) => s + Number(b.balance ?? 0), 0)
    const latestSlip  = ((payslipRes.data ?? []) as any[])[0] ?? null
    const openActions = (pendingLeaveCnt.count ?? 0) + (pendingRegCnt.count ?? 0)

    // ── Team approvals count (managers only, fast — second fan-out) ───────────
    let pendingApprovalsCount = 0
    if (isManager) {
      if (role === 'manager' && employeeId) {
        const reportIds = await getDirectReportIds(fastify.supabase, tenantId, employeeId)
        if (reportIds.length > 0) {
          const [la, ra] = await Promise.all([
            fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId).eq('status', 'PENDING').in('employee_id', reportIds),
            fastify.supabase.from('attendance_regularisation').select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId).eq('status', 'pending').in('employee_id', reportIds),
          ])
          pendingApprovalsCount = (la.count ?? 0) + (ra.count ?? 0)
        }
      } else {
        // hr_admin / super_admin: tenant-wide count is appropriate
        const [la, ra] = await Promise.all([
          fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('status', 'PENDING'),
          fastify.supabase.from('attendance_regularisation').select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('status', 'pending'),
        ])
        pendingApprovalsCount = (la.count ?? 0) + (ra.count ?? 0)
      }
    }

    // ── Leave balance ─────────────────────────────────────────────────────────
    const leave_balance = leaveRows.map((b: any) => ({
      name:    (b.leave_types as any)?.name ?? 'Leave',
      balance: Number(b.balance ?? 0),
      used:    Number(b.used    ?? 0),
    }))

    // ── Holidays ─────────────────────────────────────────────────────────────
    const upcoming_holidays = ((holidayRes.data ?? []) as any[]).map((h: any) => ({
      id:         h.id,
      name:       h.name,
      date:       h.date,
      days_until: Math.max(0, Math.round(
        (new Date(h.date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86_400_000,
      )),
    }))

    // ── Recognition ──────────────────────────────────────────────────────────
    const recRows = (recognitionRes.data ?? []) as any[]
    const giverIds = [...new Set(recRows.map((r: any) => r.from_employee).filter(Boolean))]
    const giverMap = new Map<string, string>()
    if (giverIds.length) {
      const { data: givers } = await fastify.supabase
        .from('employees').select('id, first_name, last_name')
        .eq('tenant_id', tenantId).in('id', giverIds)
      for (const g of (givers ?? []) as any[]) giverMap.set(g.id, fullName(g))
    }
    const recognition = {
      total_received: recRows.length,
      recent: recRows.map((r: any) => ({
        id:         r.id,
        from_name:  giverMap.get(r.from_employee) ?? 'A colleague',
        badge_code: r.badge_code,
        message:    r.message,
        points:     r.points,
        created_at: r.created_at,
      })),
    }

    // ── Feed teaser ───────────────────────────────────────────────────────────
    const feed_teaser = ((feedRes.data ?? []) as any[]).map((p: any) => ({
      id:         p.id,
      type:       p.type,
      body:       (p.body ?? '').slice(0, 200),
      created_at: p.created_at,
      author:     p.employees ? fullName(p.employees as any) : 'CognixHR',
    }))

    // ── Birthdays & work anniversaries (next 7 days) ──────────────────────────
    const colleagues = (colleaguesRes.data ?? []) as any[]

    const birthdays = colleagues
      .filter((c: any) => !!c.dob)
      .map((c: any) => ({ employee_id: c.id, name: fullName(c), days_until: daysUntilAnniversary(c.dob as string) }))
      .filter((c: any) => c.days_until <= 7)
      .sort((a: any, b: any) => a.days_until - b.days_until)

    const anniversaries = colleagues
      .filter((c: any) => !!c.joining_date)
      .map((c: any) => {
        const joiningYear = Number((c.joining_date as string).slice(0, 4))
        const years = new Date().getFullYear() - joiningYear
        return { employee_id: c.id, name: fullName(c), years, days_until: daysUntilAnniversary(c.joining_date as string) }
      })
      .filter((c: any) => c.days_until <= 7 && c.years > 0)
      .sort((a: any, b: any) => a.days_until - b.days_until)

    // ── Context — the day's shape, for the greeting selector + adaptation ─────
    // One small object the client reads to choose greeting copy and to reshape
    // movements (busy / salary / birthday / holiday / new-joiner / manager)
    // WITHOUT changing Home's structure (EXPERIENCE_HOME_DESIGN.md §5).
    const todayMMDD = today.slice(5)
    const ownDob    = emp?.dob          as string | null
    const ownJoin   = emp?.joining_date as string | null
    const daysSinceJoin = ownJoin
      ? Math.round((new Date(today + 'T12:00:00Z').getTime() - new Date(ownJoin + 'T12:00:00Z').getTime()) / 86_400_000)
      : null
    const nextHoliday  = upcoming_holidays[0] ?? null
    const releasedToday = !!latestSlip
      && String(latestSlip.status ?? '').toLowerCase() === 'finalized'
      && typeof latestSlip.updated_at === 'string'
      && (latestSlip.updated_at as string).slice(0, 10) === today
    const backFromLeave = ((recentLeaveEndedRes as any).data ?? []).length > 0

    const context = {
      is_manager:           isManager,
      is_first_day:         ownJoin === today,
      is_new_joiner:        daysSinceJoin != null && daysSinceJoin >= 0 && daysSinceJoin <= 7,
      is_birthday:          !!ownDob  && ownDob.slice(5)  === todayMMDD,
      is_work_anniversary:  !!ownJoin && ownJoin.slice(5) === todayMMDD && ownJoin !== today,
      anniversary_years:    ownJoin && ownJoin.slice(5) === todayMMDD ? new Date().getFullYear() - Number(ownJoin.slice(0, 4)) : null,
      is_back_from_leave:   backFromLeave,
      is_salary_day:        releasedToday,
      holiday_today:        nextHoliday?.days_until === 0,
      holiday_tomorrow:     nextHoliday?.days_until === 1,
      next_holiday_name:    nextHoliday?.name ?? null,
      next_holiday_days:    nextHoliday?.days_until ?? null,
    }

    return reply.send({
      profile,
      context,
      today: today_snapshot,
      kpis: {
        leave_days_remaining:  Math.round(totalLeave * 10) / 10,
        net_pay:               latestSlip?.net_pay ? Number(latestSlip.net_pay) : null,
        open_actions:          openActions,
        pending_approvals:     pendingApprovalsCount,
      },
      leave_balance,
      upcoming_holidays,
      recognition,
      feed_teaser,
      birthdays,
      anniversaries,
    })
  })
}
