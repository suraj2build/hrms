/**
 * Executive Intelligence Center — Read-Only Strategic Aggregation Layer
 *
 * Provides C-suite / CHRO views aggregated from existing SSOT tables.
 * NO new calculations, NO duplicate business logic, NO alternative truths.
 * All metrics derive from authoritative sources already maintained by
 * payroll, attendance, leave, trust, and governance modules.
 *
 * GET /executive/ceo         — CEO composite snapshot
 * GET /executive/chro        — CHRO composite snapshot
 * GET /executive/workforce   — Workforce deep-dive
 * GET /executive/financial   — Financial workforce metrics
 * GET /executive/compliance  — Compliance & risk summary
 * GET /executive/trends      — Strategic historical trends
 *
 * Auth: JWT required. hr_admin / super_admin only.
 * Mode: READ-ONLY. No mutations, no approvals, no workflow execution.
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { computeLifecycleRisks, summariseLifecycle } from '../../lib/lifecycle-expiry.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Types ─────────────────────────────────────────────────────────────────────


const monthRe    = /^\d{4}-\d{2}$/

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 7)
}

function monthStart(m: string): string { return `${m}-01` }
function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo, 0).toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function today(): string { return new Date().toISOString().slice(0, 10) }

function safeRate(num: number, den: number, dec = 1): number {
  return den > 0 ? parseFloat(((num / den) * 100).toFixed(dec)) : 0
}

function safeAvg(total: number, count: number, dec = 0): number {
  return count > 0 ? parseFloat((total / count).toFixed(dec)) : 0
}

// ── Narrative helpers — deterministic text from metrics ───────────────────────

function ceoNarrative(d: {
  employee_count: number; joiners_30d: number; exits_30d: number
  attendance_rate: number; open_exceptions: number; open_incidents: number
  pending_revisions: number; payroll_cost_current: number
}): string {
  const parts: string[] = []

  // Headcount movement
  if (d.joiners_30d > 0 || d.exits_30d > 0) {
    const net = d.joiners_30d - d.exits_30d
    parts.push(
      `Workforce is ${d.employee_count.toLocaleString()} active employees — ` +
      `${d.joiners_30d} joined and ${d.exits_30d} exited in the last 30 days ` +
      `(net ${net >= 0 ? '+' : ''}${net}).`,
    )
  } else {
    parts.push(`Workforce headcount: ${d.employee_count.toLocaleString()} active employees.`)
  }

  // Attendance
  if (d.attendance_rate >= 90) {
    parts.push(`Attendance is healthy at ${d.attendance_rate}%.`)
  } else if (d.attendance_rate >= 75) {
    parts.push(`Attendance at ${d.attendance_rate}% — moderate absenteeism; review may be warranted.`)
  } else if (d.attendance_rate > 0) {
    parts.push(`Attendance is below target at ${d.attendance_rate}% — requires immediate review.`)
  }

  // Operational alerts
  const alerts: string[] = []
  if (d.open_exceptions > 0)  alerts.push(`${d.open_exceptions} open attendance exception${d.open_exceptions > 1 ? 's' : ''}`)
  if (d.open_incidents > 0)   alerts.push(`${d.open_incidents} open incident${d.open_incidents > 1 ? 's' : ''}`)
  if (d.pending_revisions > 0) alerts.push(`${d.pending_revisions} pending compensation revision${d.pending_revisions > 1 ? 's' : ''}`)
  if (alerts.length > 0) {
    parts.push(`Attention required: ${alerts.join(', ')}.`)
  } else {
    parts.push('No open operational alerts.')
  }

  return parts.join(' ')
}

function chroNarrative(d: {
  employee_count: number; absence_rate: number; pending_revisions: number
  trust_high_risk: number; leave_utilization_pct: number
}): string {
  const parts: string[] = []

  if (d.absence_rate > 10) {
    parts.push(`Absenteeism is elevated at ${d.absence_rate}% — consider reviewing leave and wellness policies.`)
  } else if (d.absence_rate > 0) {
    parts.push(`Absenteeism is within normal range at ${d.absence_rate}%.`)
  }

  if (d.leave_utilization_pct > 0) {
    parts.push(`Leave utilization stands at ${d.leave_utilization_pct}% of available entitlement.`)
  }

  if (d.pending_revisions > 5) {
    parts.push(`${d.pending_revisions} compensation revisions are pending approval — a high backlog may delay payroll.`)
  } else if (d.pending_revisions > 0) {
    parts.push(`${d.pending_revisions} compensation revision${d.pending_revisions > 1 ? 's' : ''} pending approval.`)
  }

  if (d.trust_high_risk > 0) {
    parts.push(`${d.trust_high_risk} employee${d.trust_high_risk > 1 ? 's' : ''} flagged with high trust risk — verification review recommended.`)
  }

  return parts.length > 0 ? parts.join(' ') : 'All CHRO metrics are within normal operating parameters.'
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function executiveRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireExec(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'Executive access required' })
      return false
    }
    return true
  }

  // ── GET /executive/ceo ────────────────────────────────────────────────────
  // CEO composite snapshot: headcount, payroll cost, attendance, attention items.
  // Source: employees, payroll_runs, attendance_daily, attendance_exceptions,
  //         operational_incidents, compensation_revisions
  fastify.get('/executive/ceo', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const from30 = daysAgo(30)
    const to     = today()
    const month  = currentMonth()

    const [
      activeEmpRes, joinersRes, exitsRes,
      daily, excOpenRes, incOpenRes,
      pendingRevRes, payrollRunRes,
    ] = await Promise.all([
      // Active headcount
      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),

      // Joiners last 30 days
      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('joining_date', from30)
        .lte('joining_date', to),

      // Exits last 30 days
      fastify.supabase
        .from('employees')
        .select('id, employee_separation!inner(last_working_date)', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('employee_separation.last_working_date', from30)
        .lte('employee_separation.last_working_date', to),

      // Attendance last 30 days (for rate). Paginated — 30 days across the
      // whole tenant can exceed PostgREST's 1,000-row ceiling for a large
      // tenant, understating the attendance/absence rate.
      fetchAllRows((from, to2) =>
        fastify.supabase
          .from('attendance_daily')
          .select('status')
          .eq('tenant_id', req.tenantId)
          .gte('date', from30)
          .lte('date', to)
          .range(from, to2),
      ),

      // Open exceptions
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'open'),

      // Open incidents
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'open'),

      // Pending compensation revisions
      fastify.supabase
        .from('compensation_revisions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending'),

      // Latest payroll run for current month
      fastify.supabase
        .from('payroll_runs')
        .select('id, status, total_gross, total_net, employee_count, month')
        .eq('tenant_id', req.tenantId)
        .in('status', ['completed', 'finalized'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const employee_count      = activeEmpRes.count ?? 0
    const joiners_30d         = joinersRes.count ?? 0
    const exits_30d           = exitsRes.count ?? 0
    const open_exceptions     = excOpenRes.count ?? 0
    const open_incidents      = incOpenRes.count ?? 0
    const pending_revisions   = pendingRevRes.count ?? 0

    const present = daily.filter((r: any) => r.status === 'present' || r.status === 'late').length
    const absent  = daily.filter((r: any) => r.status === 'absent').length
    const attendance_rate = safeRate(present, daily.length)
    const absence_rate    = safeRate(absent,  daily.length)

    const payrollRun             = payrollRunRes.data
    const payroll_cost_current   = payrollRun ? Number(payrollRun.total_gross ?? 0) : 0
    const payroll_net_current    = payrollRun ? Number(payrollRun.total_net   ?? 0) : 0
    const payroll_headcount      = payrollRun?.employee_count ?? 0
    const payroll_month          = payrollRun?.month ?? month
    const avg_cost_per_employee  = safeAvg(payroll_cost_current, payroll_headcount)

    const narrative = ceoNarrative({
      employee_count, joiners_30d, exits_30d, attendance_rate,
      open_exceptions, open_incidents, pending_revisions, payroll_cost_current,
    })

    return reply.send({
      // Workforce
      employee_count,
      joiners_30d,
      exits_30d,
      net_headcount_change: joiners_30d - exits_30d,
      // Attendance
      attendance_rate,
      absence_rate,
      // Payroll
      payroll_cost_current,
      payroll_net_current,
      payroll_headcount,
      payroll_month,
      avg_cost_per_employee,
      // Attention items
      open_exceptions,
      open_incidents,
      pending_revisions,
      total_attention_items: open_exceptions + open_incidents + pending_revisions,
      // Narrative
      narrative,
      // Meta
      generated_at: new Date().toISOString(),
      period: { from: from30, to },
    })
  })

  // ── GET /executive/chro ───────────────────────────────────────────────────
  // CHRO composite: workforce distribution, leave/attendance, compensation, trust.
  // Source: employees, job_history, departments, attendance_daily, leave_requests,
  //         compensation_revisions, workforce_trust_scores
  fastify.get('/executive/chro', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const from30 = daysAgo(30)
    const to     = today()

    const [
      employees, daily, leaveRows,
      pendingRevisions, approvedRevRes,
      trustHighRiskRes, trustVerifiedRes, trustTotalRes,
      deptRows,
    ] = await Promise.all([
      // Active headcount. Paginated — a row-returning .select() (no
      // count:exact/head:true) truncates at PostgREST's 1,000-row ceiling
      // for a large tenant, understating employee_count itself plus the
      // employment-type/gender distributions below.
      fetchAllRows((from, to2) =>
        fastify.supabase
          .from('employees')
          .select('id, employment_type, gender')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .range(from, to2),
      ),

      // Attendance last 30 days. Paginated for the same reason.
      fetchAllRows((from, to2) =>
        fastify.supabase
          .from('attendance_daily')
          .select('status')
          .eq('tenant_id', req.tenantId)
          .gte('date', from30)
          .lte('date', to)
          .range(from, to2),
      ),

      // Leave requests last 30 days. Paginated for the same reason.
      fetchAllRows((from, to2) =>
        fastify.supabase
          .from('leave_requests')
          .select('status, total_days:computed_days')
          .eq('tenant_id', req.tenantId)
          .gte('created_at', `${from30}T00:00:00`)
          .lte('created_at', `${to}T23:59:59`)
          .range(from, to2),
      ),

      // Pending revisions. Fresh audit finding: pending_revisions (below)
      // came from this query's exact count, but pending_revisions_by_type
      // was built from only the first 50 rows (no .order()) — for a tenant
      // with >50 pending revisions the by-type breakdown silently didn't sum
      // to the reported total. fetchAllRows() so both are exhaustive.
      fetchAllRows<{ id: string; revision_type: string }>((from, to2) =>
        fastify.supabase
          .from('compensation_revisions')
          .select('id, revision_type')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'pending')
          .range(from, to2),
      ),

      // Approved revisions last 30d
      fastify.supabase
        .from('compensation_revisions')
        .select('delta_amount, delta_pct', { count: 'exact' })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'approved')
        .gte('updated_at', `${from30}T00:00:00`),

      // Trust high-risk employees. Adds score_type='employee' to match the
      // verified/total siblings just below — without it this count also
      // included onboarding/payroll/document score rows, not just employee
      // scores.
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee')
        .eq('severity', 'high'),

      // Trust verified employees. Fresh audit finding: this queried
      // 'employee_trust_profiles', a table that does not exist anywhere in
      // supabase/migrations/ — the real table is workforce_trust_scores
      // (see the O5.9 fix a few hundred lines below in /executive/compliance
      // for the same table). Since count:exact/head:true swallows a "relation
      // does not exist" error via `?? 0`, this silently returned 0 forever.
      // 'severity' (low/medium/high/critical) is the closest real proxy for
      // "verified" — a low-risk trust score, same as trust_medium_risk below
      // uses severity='medium'.
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee')
        .eq('severity', 'low'),

      // Trust total profiles
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee'),

      // Department distribution via job_history. Paginated for the same reason.
      fetchAllRows((from, to2) =>
        fastify.supabase
          .from('job_history')
          .select('department_id, departments(id, name)')
          .eq('tenant_id', req.tenantId)
          .eq('is_current', true)
          .range(from, to2),
      ),
    ])

    // Employment type distribution
    const employee_count  = employees.length

    const typeMap = new Map<string, number>()
    const genderMap = new Map<string, number>()
    for (const e of employees) {
      const t = (e as any).employment_type ?? 'unspecified'
      const g = (e as any).gender ?? 'unspecified'
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
      genderMap.set(g, (genderMap.get(g) ?? 0) + 1)
    }
    const employment_type_distribution = Object.fromEntries(typeMap)
    const gender_distribution          = Object.fromEntries(genderMap)

    // Attendance
    const present     = daily.filter((r: any) => r.status === 'present' || r.status === 'late').length
    const absent      = daily.filter((r: any) => r.status === 'absent').length
    const attendance_rate = safeRate(present, daily.length)
    const absence_rate    = safeRate(absent,  daily.length)

    // Leave — leave_requests.status is uppercase-only per its CHECK
    // constraint (migration 041). Fresh audit finding: these were comparing
    // against lowercase 'approved'/'pending', so leave_approved, leave_pending,
    // and total_days_taken (and the derived leave_utilization_pct) were
    // always 0.
    const leave_applied    = leaveRows.length
    const leave_approved   = leaveRows.filter((r: any) => r.status === 'APPROVED').length
    const leave_pending    = leaveRows.filter((r: any) => r.status === 'PENDING').length
    const total_days_taken = leaveRows
      .filter((r: any) => r.status === 'APPROVED')
      .reduce((s: number, r: any) => s + (Number(r.total_days) || 0), 0)

    // Compensation revisions
    const pending_revisions  = pendingRevisions.length
    const approved_revisions = approvedRevRes.count ?? 0
    const pendingByType = new Map<string, number>()
    for (const r of pendingRevisions as any[]) {
      const t = r.revision_type ?? 'other'
      pendingByType.set(t, (pendingByType.get(t) ?? 0) + 1)
    }
    const pending_revisions_by_type = Object.fromEntries(pendingByType)

    // Trust metrics
    const trust_high_risk   = trustHighRiskRes.count ?? 0
    const trust_verified    = trustVerifiedRes.count ?? 0
    const trust_total       = trustTotalRes.count ?? 0
    const trust_verification_pct = safeRate(trust_verified, trust_total)

    // Department distribution
    const deptMap2 = new Map<string, number>()
    for (const jh of deptRows as any[]) {
      const name = jh.departments?.name ?? 'Unassigned'
      deptMap2.set(name, (deptMap2.get(name) ?? 0) + 1)
    }
    const dept_distribution = Object.fromEntries(deptMap2)

    const leave_utilization_pct = employee_count > 0
      ? safeRate(total_days_taken, employee_count * 30)
      : 0

    // ── R10 — Recruitment KPI elevation (SUP.hiring_velocity, SUP.offer_acceptance)
    // Canonical CHRO surface for the recruitment funnel. Best-effort: the
    // recruitment module's tables may be absent in some deployments, so missing
    // tables must never break the CHRO snapshot.
    const hiring_funnel = { applied: 0, screening: 0, interviewing: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0 }
    let offers_extended = 0
    let offers_accepted = 0
    let offer_acceptance_rate: number = 0
    let avg_time_to_offer: number | null = null
    let avg_time_to_hire: number | null = null
    let open_requisitions = 0
    let recruitment_active = false
    try {
      const since = daysAgo(180)   // rolling 6-month window on application date
      const apps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('applications')
          .select('status, created_at, updated_at, offer_date, offer_accepted')
          .eq('tenant_id', req.tenantId)
          .gte('created_at', `${since}T00:00:00`)
          .range(from, to),
      ).catch(() => [] as any[])
      const [reqRes] = await Promise.all([
        fastify.supabase
          .from('job_requisitions')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('status', 'open'),
      ])

      recruitment_active = true
      const offerTimes: number[] = []
      const hireTimes: number[]  = []
      for (const a of apps) {
        if (a.status && a.status in hiring_funnel) {
          hiring_funnel[a.status as keyof typeof hiring_funnel]++
        }
        // Offer acceptance: an offer is "extended" once offer_date is set.
        if (a.offer_date) {
          offers_extended++
          if (a.offer_accepted === true || a.status === 'hired') offers_accepted++
          const t = (new Date(a.offer_date).getTime() - new Date(a.created_at).getTime()) / 86400000
          if (Number.isFinite(t) && t >= 0) offerTimes.push(t)
        }
        if (a.status === 'hired') {
          const t = (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / 86400000
          if (Number.isFinite(t) && t >= 0) hireTimes.push(t)
        }
      }
      offer_acceptance_rate = Number(safeRate(offers_accepted, offers_extended))
      const mean = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null
      avg_time_to_offer = mean(offerTimes)
      avg_time_to_hire  = mean(hireTimes)
      open_requisitions = reqRes.count ?? 0
    } catch (e) {
      req.log?.warn?.({ err: e }, 'CHRO recruitment block best-effort failed')
    }

    const narrative = chroNarrative({
      employee_count, absence_rate, pending_revisions,
      trust_high_risk, leave_utilization_pct,
    })

    return reply.send({
      // Workforce distribution
      employee_count,
      employment_type_distribution,
      gender_distribution,
      dept_distribution,
      // Attendance & leave
      attendance_rate,
      absence_rate,
      leave_applied,
      leave_approved,
      leave_pending,
      total_days_taken,
      leave_utilization_pct,
      // Compensation
      pending_revisions,
      approved_revisions,
      pending_revisions_by_type,
      // Trust
      trust_high_risk,
      trust_verified,
      trust_total,
      trust_verification_pct,
      // Recruitment / Talent (R10)
      recruitment_active,
      hiring_funnel,
      offers_extended,
      offers_accepted,
      offer_acceptance_rate,
      avg_time_to_offer,
      avg_time_to_hire,
      open_requisitions,
      // Narrative
      narrative,
      generated_at: new Date().toISOString(),
      period: { from: from30, to },
    })
  })

  // ── GET /executive/workforce ──────────────────────────────────────────────
  // Workforce deep-dive: headcount, joiner/exit trends, department breakdown.
  // Source: employees, job_history, departments
  fastify.get('/executive/workforce', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const querySchema = z.object({
      months: z.coerce.number().int().min(1).max(12).default(6),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const monthCount = parsed.data.months

    // All four queries are paginated — row-returning .select() calls over the
    // whole tenant's employee history routinely exceed PostgREST's 1,000-row
    // ceiling, silently understating headcount, department/type/gender
    // distributions, and the joiner/exit trend lines below.
    const [empRows, deptRows, separationRows, joiners] = await Promise.all([
      // All active employees with joining date and type
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, joining_date, employment_type, status, gender, employee_separation!employee_separation_employee_id_fkey(last_working_date)')
          .eq('tenant_id', req.tenantId)
          .in('status', ['active', 'separated'])
          .range(from, to),
      ),

      // Current department assignments
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('job_history')
          .select('employee_id, department_id, departments(id, name)')
          .eq('tenant_id', req.tenantId)
          .eq('is_current', true)
          .range(from, to),
      ),

      // Recent separations for trend
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, employee_separation!inner(last_working_date)')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'separated')
          .gte('employee_separation.last_working_date', monthsAgo(monthCount + 1) + '-01')
          .range(from, to),
      ),

      // Recent joiners for trend
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, joining_date')
          .eq('tenant_id', req.tenantId)
          .gte('joining_date', monthsAgo(monthCount + 1) + '-01')
          .range(from, to),
      ),
    ])

    const _flattenSep = (e: any) => ({ ...e, separation_date: (e.employee_separation ?? [])[0]?.last_working_date ?? null })
    const allEmp    = empRows.map(_flattenSep)
    const active    = allEmp.filter((e: any) => e.status === 'active')
    const separated = separationRows.map(_flattenSep)

    // Build month boundaries
    const monthBoundaries: Array<{ month: string; from: string; to: string }> = []
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      const m = d.toISOString().slice(0, 7)
      monthBoundaries.push({ month: m, from: monthStart(m), to: monthEnd(m) })
    }

    // Monthly joiner/exit counts
    const monthly_trends = monthBoundaries.map(({ month, from, to }) => {
      const month_joiners = joiners.filter((e: any) => e.joining_date >= from && e.joining_date <= to).length
      const month_exits   = separated.filter((e: any) => e.separation_date >= from && e.separation_date <= to).length
      return { month, joiners: month_joiners, exits: month_exits, net: month_joiners - month_exits }
    })

    // Department distribution (current active only, via job_history)
    const deptCounts = new Map<string, number>()
    const deptByEmpId = new Map<string, string>()
    for (const jh of deptRows as any[]) {
      const name = jh.departments?.name ?? 'Unassigned'
      deptByEmpId.set(jh.employee_id, name)
    }
    for (const e of active as any[]) {
      const name = deptByEmpId.get(e.id) ?? 'Unassigned'
      deptCounts.set(name, (deptCounts.get(name) ?? 0) + 1)
    }
    const dept_distribution = [...deptCounts.entries()]
      .map(([dept, count]) => ({ dept, count, pct: safeRate(count, active.length) }))
      .sort((a, b) => b.count - a.count)

    // Employment type distribution
    const typeCounts = new Map<string, number>()
    for (const e of active as any[]) {
      const t = e.employment_type ?? 'unspecified'
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
    }
    const employment_type_distribution = [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count, pct: safeRate(count, active.length) }))
      .sort((a, b) => b.count - a.count)

    // Gender distribution
    const genderCounts = new Map<string, number>()
    for (const e of active as any[]) {
      const g = e.gender ?? 'unspecified'
      genderCounts.set(g, (genderCounts.get(g) ?? 0) + 1)
    }
    const gender_distribution = Object.fromEntries(genderCounts)

    return reply.send({
      employee_count: active.length,
      monthly_trends,
      dept_distribution,
      employment_type_distribution,
      gender_distribution,
      total_joiners_period: joiners.length,
      total_exits_period:   separated.length,
      generated_at: new Date().toISOString(),
    })
  })

  // ── GET /executive/department-trend ───────────────────────────────────────
  // Per-department monthly joiner/exit/net + attrition for the drill-down sheet.
  // Department is resolved by NAME (the whole exec dept feature is name-keyed:
  // dept_distribution above emits names, the UI merges rows by name). An
  // employee's department is their LATEST job_history row by effective_from, so
  // separated employees still resolve to their last department.
  // NOTE: attrition_pct is a proxy — month exits ÷ current active headcount in
  // the department (the same simple denominator used elsewhere here) — not a
  // start-of-month running base. Honest approximation, not fabricated.
  fastify.get('/executive/department-trend', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const querySchema = z.object({
      department: z.string().min(1),
      months:     z.coerce.number().int().min(1).max(12).default(12),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { department, months: monthCount } = parsed.data

    // Paginated — both can exceed PostgREST's 1,000-row ceiling for a large
    // tenant, silently dropping employees/job history from the drill-down.
    const [empRows, jhRows] = await Promise.all([
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, joining_date, status, employee_separation!employee_separation_employee_id_fkey(last_working_date)')
          .eq('tenant_id', req.tenantId)
          .in('status', ['active', 'separated'])
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('job_history')
          .select('employee_id, effective_from, departments(name)')
          .eq('tenant_id', req.tenantId)
          .range(from, to),
      ),
    ])

    // Resolve each employee's department = their latest job_history row.
    const latestJh = new Map<string, { eff: string; name: string }>()
    for (const jh of jhRows as any[]) {
      const name = (jh.departments as any)?.name ?? 'Unassigned'
      const eff  = jh.effective_from ?? ''
      const prev = latestJh.get(jh.employee_id)
      if (!prev || eff >= prev.eff) latestJh.set(jh.employee_id, { eff, name })
    }
    const deptOf = (empId: string) => latestJh.get(empId)?.name ?? 'Unassigned'

    const flatten = (e: any) => ({ ...e, separation_date: (e.employee_separation ?? [])[0]?.last_working_date ?? null })
    const emp = empRows.map(flatten).filter((e: any) => deptOf(e.id) === department)
    const activeInDept = emp.filter(e => e.status === 'active').length

    const monthBoundaries: Array<{ month: string; from: string; to: string }> = []
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      const m = d.toISOString().slice(0, 7)
      monthBoundaries.push({ month: m, from: monthStart(m), to: monthEnd(m) })
    }

    const trend = monthBoundaries.map(({ month, from, to }) => {
      const joiners = emp.filter(e => e.joining_date && e.joining_date >= from && e.joining_date <= to).length
      const exits   = emp.filter(e => e.separation_date && e.separation_date >= from && e.separation_date <= to).length
      const attrition_pct = activeInDept > 0 ? parseFloat(((exits / activeInDept) * 100).toFixed(1)) : 0
      return { month, joiners, exits, net: joiners - exits, attrition_pct }
    })

    return reply.send({ data: { department, active_headcount: activeInDept, trend } })
  })

  // ── GET /executive/financial ──────────────────────────────────────────────
  // Financial workforce: payroll cost trends, compensation revision impact.
  // Source: payroll_runs, payroll_dept_snapshots, compensation_revisions
  fastify.get('/executive/financial', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const querySchema = z.object({
      months: z.coerce.number().int().min(1).max(12).default(6),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const monthCount = parsed.data.months
    const oldestMonth = monthsAgo(monthCount)

    // Phase 1A — payroll runs + queries independent of latestPayrollMonth, all in parallel.
    // revisionImpactRes and otTrendRes use only oldestMonth so they don't need to wait
    // for the runs result — starting them in parallel saves one sequential round-trip.
    const [payrollRunsRes, revisionImpactRes, otTrendRows] = await Promise.all([
      fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, total_gross, total_net, employee_count')
        .eq('tenant_id', req.tenantId)
        .in('status', ['completed', 'finalized'])
        .gte('month', oldestMonth)
        .order('month', { ascending: true }),

      // independent of latestPayrollMonth — runs in parallel with Phase 1A
      fastify.supabase
        .from('compensation_revisions')
        .select('revision_type, delta_amount, delta_pct, effective_date, status')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'approved')
        .gte('effective_date', monthStart(oldestMonth))
        .order('effective_date', { ascending: true }),

      // independent of latestPayrollMonth — runs in parallel with Phase 1A
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('payroll_dept_snapshots')
          .select('month, total_ot_cost')
          .eq('tenant_id', req.tenantId)
          .gte('month', oldestMonth)
          .order('month', { ascending: true })
          .range(from, to),
      ).catch(() => [] as any[]),
    ])

    if (payrollRunsRes.error) {
      return serverError(req, reply, payrollRunsRes.error, ErrorCode.QUERY_FAILED, 'Failed to load payroll runs')
    }

    const runs = payrollRunsRes.data ?? []
    const latestRun = runs[runs.length - 1] as any
    // Falls back to current calendar month only when no finalized runs exist yet.
    const latestPayrollMonth = latestRun?.month ?? currentMonth()

    // Phase 2 — queries that depend on latestPayrollMonth resolved above.
    const [currentMonthSlips, deptSnapshotRes, variableMonthRes] = await Promise.all([
      // P5.4 — current finalized slips for component-level payroll mix
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select('component_breakdown, gross_pay')
          .eq('tenant_id', req.tenantId)
          .eq('month', latestPayrollMonth)
          .in('status', ['finalized'])
          .range(from, to),
      ).catch(() => [] as any[]),

      // Latest month dept snapshot for cost breakdown
      fastify.supabase
        .from('payroll_dept_snapshots')
        .select('department_id, department_name, headcount, total_gross, total_net, total_ot_cost')
        .eq('tenant_id', req.tenantId)
        .eq('month', latestPayrollMonth)
        .order('total_gross', { ascending: false })
        .limit(10),

      // P5.4 — approved variable pay for the current month (the "variable" bucket)
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('variable_payouts')
          .select('amount, variable_payout_batches!inner(status, payout_month)')
          .eq('tenant_id', req.tenantId)
          .eq('variable_payout_batches.status', 'approved')
          .eq('variable_payout_batches.payout_month', latestPayrollMonth)
          .range(from, to),
      ).catch(() => [] as any[]),
    ])

    // Monthly payroll cost trend
    const payroll_cost_trend = runs.map((r: any) => ({
      month:             r.month,
      total_gross:       Number(r.total_gross ?? 0),
      total_net:         Number(r.total_net ?? 0),
      employee_count:    r.employee_count ?? 0,
      avg_cost_per_head: safeAvg(Number(r.total_gross ?? 0), r.employee_count ?? 0),
    }))

    // Latest run metrics (latestRun computed above from Phase 1)
    const payroll_current_gross    = latestRun ? Number(latestRun.total_gross ?? 0) : 0
    const payroll_current_net      = latestRun ? Number(latestRun.total_net   ?? 0) : 0
    const payroll_current_headcount = latestRun?.employee_count ?? 0
    const payroll_current_month     = latestPayrollMonth

    // Month-over-month change
    const prevRun = runs.length >= 2 ? runs[runs.length - 2] as any : null
    const prev_gross = prevRun ? Number(prevRun.total_gross ?? 0) : 0
    const payroll_mom_change = prev_gross > 0
      ? parseFloat(((payroll_current_gross - prev_gross) / prev_gross * 100).toFixed(1))
      : 0

    // Revision impact
    const revisions = revisionImpactRes.data ?? []
    const total_revision_delta = revisions.reduce((s, r: any) => s + Number(r.delta_amount ?? 0), 0)
    const avg_revision_pct     = revisions.length > 0
      ? parseFloat((revisions.reduce((s, r: any) => s + Number(r.delta_pct ?? 0), 0) / revisions.length).toFixed(1))
      : 0
    const revisions_by_type = revisions.reduce((acc: Record<string, number>, r: any) => {
      const t = r.revision_type ?? 'other'
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})

    // Dept cost breakdown (latest month)
    const dept_cost_breakdown = (deptSnapshotRes.data ?? []).map((d: any) => ({
      dept:           d.department_name ?? 'Unassigned',
      headcount:      d.headcount ?? 0,
      total_gross:    Number(d.total_gross ?? 0),
      total_net:      Number(d.total_net ?? 0),
      ot_cost:        Number(d.total_ot_cost ?? 0),
    }))

    // ── P5.4 — component-level payroll mix (current finalized month) ───────────
    // Aggregate each slip's component_breakdown into fixed / statutory buckets,
    // then add the variable pay (from approved variable payouts) and OT (from dept
    // snapshots). Reuses payroll data only — no new calculation engine.
    let fixed_pay = 0
    let employee_deductions = 0
    let employer_statutory = 0
    for (const slip of currentMonthSlips) {
      const breakdown = Array.isArray((slip as any).component_breakdown) ? (slip as any).component_breakdown : []
      for (const c of breakdown) {
        const amt = Number(c.monthly_amount ?? 0)
        if (c.component_type === 'earning')                    fixed_pay += amt
        else if (c.component_type === 'deduction')             employee_deductions += amt
        else if (c.component_type === 'employer_contribution') employer_statutory += amt
      }
    }
    const ot_cost_current = dept_cost_breakdown.reduce((s, d) => s + d.ot_cost, 0)
    const variable_pay = (variableMonthRes ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0)
    // Fixed earnings already include OT inside gross; expose OT separately and net it
    // out of fixed so the four buckets don't double-count.
    const fixed_excl_ot = Math.max(0, Math.round(fixed_pay - ot_cost_current))

    const component_mix = {
      month:               latestPayrollMonth,
      fixed_pay:           fixed_excl_ot,
      variable_pay:        Math.round(variable_pay),
      statutory_cost:      Math.round(employer_statutory),
      ot_cost:             Math.round(ot_cost_current),
      employee_deductions: Math.round(employee_deductions),
      gross_total:         Math.round(fixed_pay),
      has_data:            currentMonthSlips.length > 0,
    }

    // ── P5.6 — overtime cost trend (monthly, across the window) ────────────────
    const otByMonth = new Map<string, number>()
    for (const r of (otTrendRows ?? [])) {
      const m = (r as any).month as string
      otByMonth.set(m, (otByMonth.get(m) ?? 0) + Number((r as any).total_ot_cost ?? 0))
    }
    const ot_trend = [...otByMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, ot_cost]) => ({ month, ot_cost: Math.round(ot_cost) }))

    // ── R3 — OT Dependency (CST.ot_dependency), elevated to L1 headline ─────────
    // Full-month OT (from all dept snapshots, not the top-10 breakdown) ÷ gross.
    const ot_cost_month = otByMonth.get(payroll_current_month) ?? ot_cost_current
    const ot_dependency_pct = payroll_current_gross > 0
      ? parseFloat((ot_cost_month / payroll_current_gross * 100).toFixed(1))
      : 0
    const ot_dependency_flag: 'high' | 'medium' | 'normal' =
      ot_dependency_pct > 25 ? 'high' : ot_dependency_pct > 15 ? 'medium' : 'normal'
    const ot_cost_total = Math.round(ot_cost_month)

    // ── R3 — Payroll Variance flag (CST.variance), elevated to L1 ───────────────
    const variance_flag: 'high' | 'medium' | 'normal' =
      Math.abs(payroll_mom_change) > 20 ? 'high' : Math.abs(payroll_mom_change) > 10 ? 'medium' : 'normal'

    // ── R3 — Leave Liability (CST.leave_liability) & F&F Exposure (CST.ff_exposure)
    // Both best-effort: missing tables/columns must never break the financial view.
    let leave_liability = 0
    let leave_liability_employees = 0
    let leave_liability_days = 0
    try {
      const currentYear = new Date().getUTCFullYear()
      const [encashRulesRes, compRes] = await Promise.all([
        fastify.supabase
          .from('leave_accrual_rules')
          .select('leave_type_id, encashable')
          .eq('tenant_id', req.tenantId)
          .eq('encashable', true),
        fastify.supabase
          .from('employee_compensations')
          .select('employee_id, ctc_monthly')
          .eq('tenant_id', req.tenantId)
          .eq('is_active', true),
      ])
      const encashableTypeIds = (encashRulesRes.data ?? []).map((r: any) => r.leave_type_id).filter(Boolean)
      const dailyRateByEmp = new Map<string, number>()
      for (const c of (compRes.data ?? []) as any[]) {
        if (c.ctc_monthly) dailyRateByEmp.set(c.employee_id, Number(c.ctc_monthly) / 26)
      }
      if (encashableTypeIds.length > 0) {
        const { data: balRows } = await fastify.supabase
          .from('employee_leave_balance')
          .select('employee_id, balance, leave_type_id')
          .eq('tenant_id', req.tenantId)
          .eq('year', currentYear)
          .in('leave_type_id', encashableTypeIds)
          .gt('balance', 0)
        const empSet = new Set<string>()
        for (const b of (balRows ?? []) as any[]) {
          const rate = dailyRateByEmp.get(b.employee_id)
          if (!rate) continue
          const days = Number(b.balance ?? 0)
          leave_liability     += days * rate
          leave_liability_days += days
          empSet.add(b.employee_id)
        }
        leave_liability_employees = empSet.size
      }
      leave_liability = Math.round(leave_liability)
      leave_liability_days = parseFloat(leave_liability_days.toFixed(1))
    } catch (e) {
      req.log?.warn?.({ err: e }, 'leave_liability best-effort failed')
    }

    let ff_exposure = 0
    let ff_active_separations = 0
    try {
      const { data: ffRows } = await fastify.supabase
        .from('separation_ff_summary')
        .select('net_payable, status')
        .eq('tenant_id', req.tenantId)
        .neq('status', 'paid')
      for (const r of (ffRows ?? []) as any[]) {
        ff_exposure += Number(r.net_payable ?? 0)
        ff_active_separations++
      }
      ff_exposure = Math.round(ff_exposure)
    } catch (e) {
      req.log?.warn?.({ err: e }, 'ff_exposure best-effort failed')
    }

    return reply.send({
      payroll_current_gross,
      payroll_current_net,
      payroll_current_headcount,
      payroll_current_month,
      payroll_mom_change,
      variance_flag,
      payroll_cost_trend,
      total_revision_delta,
      avg_revision_pct,
      revisions_by_type,
      approved_revisions_count: revisions.length,
      dept_cost_breakdown,
      component_mix,
      ot_trend,
      ot_cost_total,
      ot_dependency_pct,
      ot_dependency_flag,
      leave_liability,
      leave_liability_employees,
      leave_liability_days,
      ff_exposure,
      ff_active_separations,
      generated_at: new Date().toISOString(),
    })
  })

  // ── GET /executive/compliance ─────────────────────────────────────────────
  // Compliance & risk: governance, SLA breaches, trust risks, verification.
  // Source: operational_incidents, attendance_exceptions, workforce_trust_scores,
  //         governance_events, duplicate_detection_events
  fastify.get('/executive/compliance', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const from30 = daysAgo(30)
    const to     = today()

    const [
      incOpenRes, incCriticalRes, incTotalRes,
      excOpenRes, excBreachedRes, excTotalRes,
      trustHighRes, trustMedRes, trustTotalRes,
      trustVerifiedRes,
      dupRes, govEvents,
      wfTrustRes,
    ] = await Promise.all([
      // Open incidents
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'open'),

      // Critical incidents
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .in('severity', ['critical', 'high'])
        .eq('status', 'open'),

      // Total incidents 30 days
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', `${from30}T00:00:00`),

      // Open exceptions
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'open'),

      // SLA-breached exceptions 30 days
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('sla_breached', true)
        .gte('created_at', `${from30}T00:00:00`),

      // Total exceptions 30 days
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', `${from30}T00:00:00`),

      // High-risk trust profiles. Adds score_type='employee' to match the
      // medium/total/verified siblings just below — without it, this count
      // was scoped differently from the others (it also included
      // onboarding/payroll/document score rows, not just employee scores).
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee')
        .eq('severity', 'high'),

      // Medium-risk trust profiles. Fresh audit finding: queried
      // 'employee_trust_profiles' (doesn't exist — see O5.9 comment below)
      // with a 'risk_level' column that doesn't exist either. Real table is
      // workforce_trust_scores, real column is 'severity'.
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee')
        .eq('severity', 'medium'),

      // Total trust profiles
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee'),

      // Verified employees — severity='low' is the closest real proxy for
      // "verified" on workforce_trust_scores (no boolean verified flag exists).
      fastify.supabase
        .from('workforce_trust_scores')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('score_type', 'employee')
        .eq('severity', 'low'),

      // Duplicate detection events (recent)
      fastify.supabase
        .from('duplicate_detection_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId),

      // Governance events 30d. Fresh audit finding: this used count:exact
      // (correct, exhaustive) for the total but built the severity breakdown
      // from only the first 200 rows with no .order() — the same anti-pattern
      // the O5.9 fix just below (workforce_trust_scores) was deliberately
      // written to avoid. A tenant with >200 governance drift events in 30
      // days got a severity breakdown that silently didn't sum to the
      // reported total, feeding governance_risk in the Risk Posture Index.
      fetchAllRows<{ id: string; severity: string }>((from, to2) =>
        fastify.supabase
          .from('governance_drift_events')
          .select('id, severity')
          .eq('tenant_id', req.tenantId)
          .gte('detected_at', `${from30}T00:00:00`)
          .range(from, to2),
      ),

      // O5.9 — workforce_trust_scores avg + distribution. workforce_trust_scores
      // is UNIQUE(org_id, entity_id, score_type) — one row per employee, not a
      // log — so a hardcoded .limit(500) silently drops employees past 500 for
      // larger tenants, and (ordered by computed_at DESC) biases the sample
      // toward whichever employees were most recently rescored. This average
      // feeds the CHRO/CEO-facing Risk Posture Index composite.
      fetchAllRows<{ score: number; severity: string; computed_at: string }>((from, to2) =>
        fastify.supabase
          .from('workforce_trust_scores')
          .select('score, severity, computed_at')
          .eq('tenant_id', req.tenantId)
          .eq('score_type', 'employee')
          .range(from, to2)
      ),
    ])

    const open_incidents         = incOpenRes.count     ?? 0
    const critical_incidents     = incCriticalRes.count ?? 0
    const total_incidents_30d    = incTotalRes.count    ?? 0
    const open_exceptions        = excOpenRes.count     ?? 0
    const sla_breached_30d       = excBreachedRes.count ?? 0
    const total_exceptions_30d   = excTotalRes.count    ?? 0
    const trust_high_risk        = trustHighRes.count   ?? 0
    const trust_medium_risk      = trustMedRes.count    ?? 0
    const trust_total            = trustTotalRes.count  ?? 0
    const trust_verified         = trustVerifiedRes.count ?? 0
    const open_duplicates        = dupRes.count         ?? 0

    const gov_total_30d  = govEvents.length
    const govBySeverity  = govEvents.reduce((acc: Record<string, number>, e: any) => {
      const s = e.severity ?? 'unknown'
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    }, {})

    // O5.9 — trust metrics from workforce_trust_scores
    const wfScores: Array<{ score: number; severity: string; computed_at: string }> = wfTrustRes ?? []
    const avg_trust_score = wfScores.length > 0
      ? Math.round(wfScores.reduce((sum, r) => sum + (r.score ?? 0), 0) / wfScores.length)
      : null
    const trust_distribution = wfScores.reduce((acc: Record<string, number>, r) => {
      acc[r.severity] = (acc[r.severity] ?? 0) + 1
      return acc
    }, {})
    // Monthly trend: group scores by YYYY-MM and average
    const trendMap: Record<string, { total: number; count: number }> = {}
    for (const r of wfScores) {
      const month = r.computed_at?.slice(0, 7) ?? 'unknown'
      const entry = trendMap[month] ?? { total: 0, count: 0 }
      entry.total += r.score ?? 0
      entry.count++
      trendMap[month] = entry
    }
    const trust_trend = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, { total, count }]) => ({ month, avg_score: Math.round(total / count) }))

    const sla_breach_rate       = safeRate(sla_breached_30d, total_exceptions_30d)
    const trust_verification_pct = safeRate(trust_verified, trust_total)
    const trust_at_risk          = trust_high_risk + trust_medium_risk

    // Overall risk score: weighted blend (0–100, lower is better)
    const compliance_risk_score = Math.min(100, Math.round(
      (sla_breach_rate * 0.3) +
      (critical_incidents > 0 ? 25 : 0) +
      (safeRate(trust_high_risk, trust_total) * 0.2) +
      (open_duplicates > 0 ? 10 : 0) +
      (open_exceptions > 20 ? 15 : open_exceptions > 5 ? 8 : 0),
    ))

    const risk_status = compliance_risk_score >= 50 ? 'high'
      : compliance_risk_score >= 25 ? 'medium'
      : 'low'

    // ── Lifecycle expiry exposure (single source: lifecycle-expiry) ──────────
    // Read-only roll-up. Drives Expiry Risk Index, Documentation Health,
    // Contract Exposure and Probation Exposure. Best-effort — never breaks the view.
    let lifecycle = {
      expiry_risk_index: 0,
      total_at_risk:     0,
      overdue:           0,
      due_7:             0,
      due_30:            0,
      documentation_health: 100,   // 0–100, higher is better
      documents_at_risk:    0,
      contract_exposure:    0,
      probation_exposure:   0,
      by_category:          {} as Record<string, Record<string, number>>,
    }
    try {
      const risks   = await computeLifecycleRisks(fastify.supabase, req.tenantId, { withinDays: 90 })
      const summary = summariseLifecycle(risks)
      const overdue = summary.by_bucket.overdue
      const due7    = summary.by_bucket.due_7
      const due30   = summary.by_bucket.due_30
      // Weighted index (0–100, higher = more exposure): overdue weigh most.
      const expiry_risk_index = Math.min(100, overdue * 8 + due7 * 4 + due30 * 1)
      const docCats = summary.by_category.document
      const idCats  = summary.by_category.identity
      const ppCats  = summary.by_category.passport
      const documents_at_risk = (docCats.overdue + docCats.due_7 + docCats.due_30)
        + (idCats.overdue + idCats.due_7 + idCats.due_30)
        + (ppCats.overdue + ppCats.due_7 + ppCats.due_30)
      const docsOverdue = docCats.overdue + idCats.overdue + ppCats.overdue
      lifecycle = {
        expiry_risk_index,
        total_at_risk: summary.total,
        overdue, due_7: due7, due_30: due30,
        documentation_health: Math.max(0, 100 - (docsOverdue * 6 + documents_at_risk * 2)),
        documents_at_risk,
        contract_exposure:  summary.by_category.contract.overdue + summary.by_category.contract.due_7 + summary.by_category.contract.due_30,
        probation_exposure: summary.by_category.probation.overdue + summary.by_category.probation.due_7 + summary.by_category.probation.due_30,
        by_category: summary.by_category,
      }
    } catch { /* lifecycle roll-up is best-effort */ }

    // ── R2 · Risk Posture Index ───────────────────────────────────────────────
    // RSK.posture_index — the single L1 composite of the six risk domains:
    //   Trust · Compliance · Governance · Security · Privacy · Certification.
    // Each sub-signal is normalised to a 0–100 *risk* scale (higher = worse), then
    // blended by fixed weights summing to 1.0. This is the canonical surface for
    // the index per the R0 KPI registry; every other view consumes it read-only.
    // Security & privacy are queried best-effort here so a missing table never
    // breaks the compliance view.
    let sec_open_critical = 0, sec_open_high = 0
    let privacy_flagged = 0, privacy_erasure_breached = 0
    try {
      const nowIso = new Date().toISOString()
      const [secCritRes, secHighRes, piiRes, eraseRes] = await Promise.all([
        fastify.supabase.from('security_alerts').select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId).eq('severity', 'critical').neq('status', 'resolved'),
        fastify.supabase.from('security_alerts').select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId).eq('severity', 'high').neq('status', 'resolved'),
        fastify.supabase.from('pii_access_log').select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId).eq('flagged', true).gte('accessed_at', `${from30}T00:00:00`),
        fastify.supabase.from('erasure_requests').select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId).in('status', ['pending', 'in_progress']).lt('sla_deadline', nowIso),
      ])
      sec_open_critical        = secCritRes.count  ?? 0
      sec_open_high            = secHighRes.count   ?? 0
      privacy_flagged          = piiRes.count       ?? 0
      privacy_erasure_breached = eraseRes.count     ?? 0
    } catch { /* security/privacy roll-up is best-effort */ }

    // Six sub-signals, each 0–100 risk (higher = worse)
    const trust_risk      = avg_trust_score != null
      ? Math.max(0, 100 - avg_trust_score)
      : Math.round(safeRate(trust_high_risk, trust_total))
    const compliance_risk = compliance_risk_score
    const governance_risk = Math.min(100,
      (govBySeverity.critical ?? 0) * 20 + (govBySeverity.high ?? 0) * 8 + (govBySeverity.medium ?? 0) * 2)
    const security_risk   = Math.min(100, sec_open_critical * 20 + sec_open_high * 8)
    const privacy_risk    = Math.min(100, privacy_erasure_breached * 15 + privacy_flagged * 5)
    const certCat         = lifecycle.by_category.certification ?? { overdue: 0, due_7: 0, due_30: 0 }
    const certification_risk = Math.min(100, certCat.overdue * 8 + certCat.due_7 * 4 + certCat.due_30 * 1)

    const posture_components = {
      trust:         { score: trust_risk,         weight: 0.20 },
      compliance:    { score: compliance_risk,    weight: 0.25 },
      governance:    { score: governance_risk,    weight: 0.15 },
      security:      { score: security_risk,      weight: 0.15 },
      privacy:       { score: privacy_risk,       weight: 0.10 },
      certification: { score: certification_risk, weight: 0.15 },
    }
    const posture_index = Math.round(
      Object.values(posture_components).reduce((s, c) => s + c.score * c.weight, 0),
    )
    const posture_band: 'low' | 'medium' | 'high' | 'critical' =
      posture_index >= 75 ? 'critical' : posture_index >= 50 ? 'high' : posture_index >= 25 ? 'medium' : 'low'

    return reply.send({
      // Incidents
      open_incidents,
      critical_incidents,
      total_incidents_30d,
      // Exceptions
      open_exceptions,
      sla_breached_30d,
      total_exceptions_30d,
      sla_breach_rate,
      // Trust
      trust_high_risk,
      trust_medium_risk,
      trust_at_risk,
      trust_total,
      trust_verified,
      trust_verification_pct,
      // Governance
      gov_total_30d,
      gov_by_severity: govBySeverity,
      // Duplicates
      open_duplicates,
      // Composite
      compliance_risk_score,
      risk_status,
      // R2 — Risk Posture Index (canonical composite of the six risk domains)
      posture_index,
      posture_band,
      posture_components,
      security_risk_inputs: { open_critical: sec_open_critical, open_high: sec_open_high },
      privacy_risk_inputs:  { flagged_access_30d: privacy_flagged, erasure_sla_breached: privacy_erasure_breached },
      // O5.9 — trust intelligence metrics
      avg_trust_score,
      trust_distribution,
      trust_trend,
      // P3.5 — workforce lifecycle expiry exposure
      lifecycle,
      generated_at: new Date().toISOString(),
      period: { from: from30, to },
    })
  })

  // ── GET /executive/trends ─────────────────────────────────────────────────
  // Strategic historical trends: attendance, leave, payroll, headcount — N months.
  // Source: attendance_daily, payroll_runs, leave_requests, employees
  // NO forecasting. Historical read-only.
  fastify.get('/executive/trends', auth, async (req: any, reply) => {
    if (!requireExec(req, reply)) return

    const querySchema = z.object({
      months: z.coerce.number().int().min(2).max(12).default(6),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const monthCount   = parsed.data.months
    const oldestMonth  = monthsAgo(monthCount - 1)
    const oldestDate   = monthStart(oldestMonth)

    // Build boundaries
    const boundaries: Array<{ month: string; from: string; to: string }> = []
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      const m = d.toISOString().slice(0, 7)
      boundaries.push({ month: m, from: monthStart(m), to: monthEnd(m) })
    }

    // attendance_daily/leave_requests/employees are paginated — full-period
    // fetches across the whole tenant routinely exceed PostgREST's 1,000-row
    // ceiling, silently understating every trend line below. payroll_runs is
    // bounded (one row per month) and left as-is.
    const [attRows, payrollRunsRes, leaveRows, joinerRows, exitRowsRaw] = await Promise.all([
      // Attendance for full period
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('date, status')
          .eq('tenant_id', req.tenantId)
          .gte('date', oldestDate)
          .lte('date', today())
          .range(from, to),
      ),

      // Payroll runs for period
      fastify.supabase
        .from('payroll_runs')
        .select('month, total_gross, total_net, employee_count, status')
        .eq('tenant_id', req.tenantId)
        .in('status', ['completed', 'finalized'])
        .gte('month', oldestMonth)
        .order('month', { ascending: true }),

      // Leave approvals for period. Fresh audit finding: leave_requests.status
      // is uppercase-only per its CHECK constraint (migration 041) — 'approved'
      // never matched any row, so leave_days_approved was always 0 in every
      // /executive/trends response.
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('leave_requests')
          .select('created_at, status, total_days:computed_days')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'APPROVED')
          .gte('created_at', `${oldestDate}T00:00:00`)
          .range(from, to),
      ),

      // Joiners per month
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('joining_date')
          .eq('tenant_id', req.tenantId)
          .gte('joining_date', oldestDate)
          .range(from, to),
      ),

      // Exits per month
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, employee_separation!inner(last_working_date)')
          .eq('tenant_id', req.tenantId)
          .gte('employee_separation.last_working_date', oldestDate)
          .range(from, to),
      ),
    ])

    const payrollRuns = payrollRunsRes.data ?? []
    const exitRows    = (exitRowsRaw as any[]).map((e: any) => ({ ...e, separation_date: (e.employee_separation ?? [])[0]?.last_working_date ?? null }))

    // Build a payroll run map by month
    const payrollByMonth = new Map<string, any>()
    for (const r of payrollRuns as any[]) {
      payrollByMonth.set(r.month, r)
    }

    const trends = boundaries.map(({ month, from, to }) => {
      // Attendance
      const monthAtt     = attRows.filter((r: any) => r.date >= from && r.date <= to)
      const attTotal     = monthAtt.length
      const attPresent   = monthAtt.filter((r: any) => r.status === 'present' || r.status === 'late').length
      const attendance_rate = safeRate(attPresent, attTotal)

      // Leave
      const monthLeave   = leaveRows.filter((r: any) => r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to)
      const leave_days   = monthLeave.reduce((s, r: any) => s + (Number(r.total_days) || 0), 0)

      // Payroll
      const run          = payrollByMonth.get(month)
      const payroll_gross = run ? Number(run.total_gross ?? 0) : null
      const payroll_headcount = run?.employee_count ?? null

      // Headcount movement
      const joiners  = joinerRows.filter((r: any) => r.joining_date >= from && r.joining_date <= to).length
      const exits    = exitRows.filter((r: any) => r.separation_date >= from && r.separation_date <= to).length

      return {
        month,
        attendance_rate,
        leave_days_approved: leave_days,
        payroll_gross,
        payroll_headcount,
        joiners,
        exits,
        net_headcount: joiners - exits,
      }
    })

    return reply.send({
      months: trends,
      month_count: monthCount,
      generated_at: new Date().toISOString(),
    })
  })
}
