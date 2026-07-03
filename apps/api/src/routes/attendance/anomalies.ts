/**
 * Attendance Anomalies Routes
 *
 * GET  /attendance/anomalies/my        — Employee: own anomalies (current month default)
 * GET  /attendance/anomalies           — HR: all tenant anomalies with filter/search
 * POST /attendance/anomalies/:id/resolve — HR: mark anomaly as resolved
 *
 * Auth:
 *   - /my   → any authenticated user (sees only their own records)
 *   - /     → hr_admin / super_admin only
 *   - /resolve → hr_admin / super_admin only
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eventBus } from '../../lib/event-bus.js'
import { recomputeRange } from '../../lib/attendance-engine.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const hrQuerySchema = z.object({
  from:        z.string().regex(dateRe).optional(),
  to:          z.string().regex(dateRe).optional(),
  employee_id: z.string().uuid().optional(),
  type:        z.enum(['missing_punch', 'missing_out', 'no_punch', 'late', 'excessive_hours']).optional(),
  severity:    z.enum(['low', 'medium', 'high']).optional(),
  resolved:    z.enum(['true', 'false']).optional(),
  limit:       z.coerce.number().int().min(1).max(200).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
})

const myQuerySchema = z.object({
  from:   z.string().regex(dateRe).optional(),
  to:     z.string().regex(dateRe).optional(),
  type:   z.enum(['missing_punch', 'missing_out', 'no_punch', 'late', 'excessive_hours']).optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export default async function attendanceAnomaliesRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/anomalies/my ──────────────────────────────────────────────
  //    Employee self-view — shows only the calling user's own anomalies.
  fastify.get('/attendance/anomalies/my', auth, async (req: any, reply) => {
    // Resolve employee_id from the caller's profile
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({
        error:   'NO_EMPLOYEE_LINK',
        message: 'Your profile is not linked to an employee record',
      })
    }

    const parsed = myQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { from, to, type, limit, offset } = parsed.data

    // Default to current month if no date range supplied
    const now    = new Date()
    const fromDt = from ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const toDt   = to   ?? toDate.toISOString().slice(0, 10)

    let q = fastify.supabase
      .from('attendance_anomalies')
      .select('id, date, type, message, severity, resolved, created_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .gte('date', fromDt)
      .lte('date', toDt)
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (type) q = q.eq('type', type)

    const { data, error, count } = await q

    if (error) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch anomalies' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /attendance/anomalies/summary ─────────────────────────────────────────
  //    HR monitoring view — department-level anomaly rates, no individual rows.
  //    Query param: month=YYYY-MM (defaults to current month)
  //    Also returns 3-month trend and org-wide totals.
  fastify.get('/attendance/anomalies/summary', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { month } = req.query as { month?: string }
    const now = new Date()
    const targetMonth = month && /^\d{4}-\d{2}$/.test(month)
      ? month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const periodStart = `${targetMonth}-01`
    const nextMonthDate = new Date(`${targetMonth}-01`)
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1)
    const periodEnd = nextMonthDate.toISOString().slice(0, 10)

    // ── Fetch anomalies for this month (flat — no nested join) ───────────────────
    const { data: anomalies, error } = await fastify.supabase
      .from('attendance_anomalies')
      .select('id, type, severity, resolved, date, employee_id')
      .eq('tenant_id', req.tenantId)
      .gte('date', periodStart)
      .lt('date', periodEnd)
      .limit(10_000)

    if (error) {
      req.log.error({ err: error }, 'anomaly summary query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch anomaly summary' })
    }

    // ── Fetch department info for all affected employees in one query ─────────────
    const affectedEmpIds = [...new Set((anomalies ?? []).map((r: any) => r.employee_id).filter(Boolean))]

    const { data: empDeptRows } = affectedEmpIds.length > 0
      ? await fastify.supabase
          .from('employees')
          .select('id, job_history!job_history_employee_id_fkey(department_id, department_name, is_current)')
          .eq('tenant_id', req.tenantId)
          .in('id', affectedEmpIds)
      : { data: [] }

    // Build employee → dept lookup (department lives on job_history)
    const empDeptMap: Record<string, { department_id: string; department_name: string }> = {}
    for (const e of (empDeptRows ?? []) as any[]) {
      const jh = (e.job_history ?? []).find((j: any) => j.is_current) ?? (e.job_history ?? [])[0] ?? null
      empDeptMap[e.id] = {
        department_id:   jh?.department_id ?? '__none__',
        department_name: jh?.department_name ?? 'Unassigned',
      }
    }

    // ── Fetch active employee counts per department (for rate calculation) ────────
    const { data: empCounts } = await fastify.supabase
      .from('employees')
      .select('job_history!job_history_employee_id_fkey(department_id, department_name, is_current)')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    // Build dept employee count map
    const deptEmpCount: Record<string, { name: string; count: number }> = {}
    for (const emp of (empCounts ?? []) as any[]) {
      const jh = (emp.job_history ?? []).find((j: any) => j.is_current) ?? (emp.job_history ?? [])[0] ?? null
      const deptId   = jh?.department_id ?? '__none__'
      const deptName = jh?.department_name ?? 'Unassigned'
      if (!deptEmpCount[deptId]) deptEmpCount[deptId] = { name: deptName, count: 0 }
      deptEmpCount[deptId].count++
    }

    // ── Aggregate anomalies by department ────────────────────────────────────────
    type TypeKey = 'no_punch' | 'missing_punch' | 'missing_out' | 'late' | 'excessive_hours'
    interface DeptBucket {
      department_id:   string
      department_name: string
      total:           number
      unresolved:      number
      high_severity:   number
      employee_ids:    Set<string>
      by_type:         Record<TypeKey, number>
    }

    const deptMap = new Map<string, DeptBucket>()
    let orgTotal = 0, orgUnresolved = 0, orgHigh = 0

    const orgByType: Record<string, number> = {}

    for (const row of (anomalies ?? []) as any[]) {
      const dept     = empDeptMap[row.employee_id] ?? { department_id: '__none__', department_name: 'Unassigned' }
      const deptId   = dept.department_id
      const deptName = dept.department_name

      orgTotal++
      if (!row.resolved) orgUnresolved++
      if (row.severity === 'high') orgHigh++
      orgByType[row.type] = (orgByType[row.type] ?? 0) + 1

      if (!deptMap.has(deptId)) {
        deptMap.set(deptId, {
          department_id:   deptId,
          department_name: deptName,
          total: 0, unresolved: 0, high_severity: 0,
          employee_ids: new Set(),
          by_type: { no_punch: 0, missing_punch: 0, missing_out: 0, late: 0, excessive_hours: 0 },
        })
      }
      const bucket = deptMap.get(deptId)!
      bucket.total++
      if (!row.resolved) bucket.unresolved++
      if (row.severity === 'high') bucket.high_severity++
      if (row.employee_id) bucket.employee_ids.add(row.employee_id)
      bucket.by_type[row.type as TypeKey] = (bucket.by_type[row.type as TypeKey] ?? 0) + 1
    }

    // ── Build department summary rows ─────────────────────────────────────────────
    const byDepartment = [...deptMap.values()]
      .map(b => ({
        department_id:        b.department_id === '__none__' ? null : b.department_id,
        department_name:      b.department_name,
        employee_count:       deptEmpCount[b.department_id]?.count ?? 0,
        affected_employees:   b.employee_ids.size,
        anomaly_count:        b.total,
        unresolved_count:     b.unresolved,
        high_severity_count:  b.high_severity,
        anomaly_rate:         deptEmpCount[b.department_id]?.count
          ? parseFloat((b.total / deptEmpCount[b.department_id].count).toFixed(2))
          : null,
        by_type: b.by_type,
      }))
      .sort((a, b) => b.anomaly_count - a.anomaly_count)

    // ── 3-month trend ─────────────────────────────────────────────────────────────
    const trendMonths: string[] = []
    for (let i = 2; i >= 0; i--) {
      const d = new Date(`${targetMonth}-01`)
      d.setUTCMonth(d.getUTCMonth() - i)
      trendMonths.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }

    const trendData: Array<{ month: string; total: number; unresolved: number }> = []
    for (const m of trendMonths) {
      if (m === targetMonth) {
        trendData.push({ month: m, total: orgTotal, unresolved: orgUnresolved })
      } else {
        const mStart = `${m}-01`
        const mNext  = new Date(`${m}-01`)
        mNext.setUTCMonth(mNext.getUTCMonth() + 1)
        const mEnd = mNext.toISOString().slice(0, 10)
        const { count: mTotal } = await fastify.supabase
          .from('attendance_anomalies')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .gte('date', mStart).lt('date', mEnd)
        const { count: mUnres } = await fastify.supabase
          .from('attendance_anomalies')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('resolved', false)
          .gte('date', mStart).lt('date', mEnd)
        trendData.push({ month: m, total: mTotal ?? 0, unresolved: mUnres ?? 0 })
      }
    }

    return reply.send({
      month: targetMonth,
      summary: {
        total:         orgTotal,
        unresolved:    orgUnresolved,
        high_severity: orgHigh,
        by_type:       orgByType,
      },
      by_department: byDepartment,
      trend:         trendData,
    })
  })

  // ── GET /attendance/anomalies ──────────────────────────────────────────────────
  //    HR view — all anomalies for the tenant with rich filtering.
  fastify.get('/attendance/anomalies', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = hrQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { from, to, employee_id, type, severity, resolved, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('attendance_anomalies')
      .select(
        `
          id, date, type, message, severity, resolved, created_at, updated_at,
          resolved_at, employee_id,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (from)        q = q.gte('date', from)
    if (to)          q = q.lte('date', to)
    if (employee_id) q = q.eq('employee_id', employee_id)
    if (type)        q = q.eq('type', type)
    if (severity)    q = q.eq('severity', severity)
    if (resolved === 'true')  q = q.eq('resolved', true)
    if (resolved === 'false') q = q.eq('resolved', false)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'attendance_anomalies query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch anomalies' })
    }

    const rows = ((data ?? []) as Array<{
      id:          string
      date:        string
      type:        string
      message:     string
      severity:    string
      resolved:    boolean
      created_at:  string
      updated_at:  string
      resolved_at: string | null
      employee_id: string | null
      employees:   { id: string; first_name: string; last_name: string; employee_code: string } | Array<{ id: string; first_name: string; last_name: string; employee_code: string }> | null
    }>).map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        id:            r.id,
        date:          r.date,
        type:          r.type,
        message:       r.message,
        severity:      r.severity,
        resolved:      r.resolved,
        created_at:    r.created_at,
        resolved_at:   r.resolved_at,
        employee_id:   emp?.id           ?? r.employee_id ?? null,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── POST /attendance/anomalies/:id/resolve ─────────────────────────────────────
  //    HR admin marks one anomaly as resolved.
  fastify.post('/attendance/anomalies/:id/resolve', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('attendance_anomalies')
      .update({
        resolved:    true,
        resolved_by: req.userId,
        resolved_at: new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)   // only allow resolving unresolved rows
      .select('id, resolved, resolved_at, employee_id, date, tenant_id, type')
      .maybeSingle()

    if (error) {
      req.log.error({ err: error, anomaly_id: id }, 'anomaly resolve failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to resolve anomaly' })
    }

    if (!data) {
      return reply.code(404).send({
        error:   'NOT_FOUND',
        message: 'Anomaly not found or already resolved',
      })
    }

    // ── Post-resolve side effects (non-fatal) ────────────────────────────────
    // 1. Recompute attendance_daily for the anomaly date so lop_days/payable_days
    //    reflect the correction immediately (e.g. no_punch → punch restored).
    //    Runs before notification so downstream payroll reads fresh data.
    if (data.employee_id && data.date) {
      try {
        await recomputeRange(fastify.supabase, {
          tenant_id:   data.tenant_id,
          employee_id: data.employee_id,
          from_date:   data.date,
          to_date:     data.date,
          changed_by:  req.userId,
        })
      } catch (recomputeErr) {
        req.log.warn({ err: recomputeErr, anomaly_id: data.id }, 'attendance recompute failed after anomaly resolve (non-fatal)')
      }
    }

    // 2. Emit observable event for audit traceability
    eventBus.emit({
      type:          'attendance.anomaly.resolved',
      tenantId:      data.tenant_id,
      correlationId: `anomaly-resolve-${data.id}`,
      payload: {
        tenantId:    data.tenant_id,
        employeeId:  data.employee_id ?? '',
        date:        data.date,
        anomalyType: (data as any).type ?? '',
        anomalyId:   data.id,
        resolvedBy:  req.userId,
      },
    })

    // 3. Notify the affected employee (look up their profile id) — fire-and-forget
    if (data.employee_id) {
      void (async () => {
        try {
          const { data: prof } = await fastify.supabase
            .from('profiles')
            .select('id')
            .eq('employee_id', data.employee_id!)
            .eq('tenant_id', data.tenant_id)
            .maybeSingle()

          if (!prof?.id) return

          const typeLabel: Record<string, string> = {
            missing_out:     'missing check-out',
            no_punch:        'no punch',
            late:            'late arrival',
            excessive_hours: 'excessive work hours',
          }
          const label = typeLabel[(data as any).type] ?? (data as any).type ?? 'anomaly'

          await fastify.supabase.from('notifications').insert({
            tenant_id:    data.tenant_id,
            recipient_id: prof.id,
            title:        'Attendance Anomaly Resolved',
            body:         `Your attendance anomaly (${label}) for ${data.date} has been reviewed and resolved by HR.`,
            link:         '/ess/attendance',
            is_read:      false,
            event_id:     data.id,
          })
        } catch (err: unknown) {
          req.log.warn({ err, anomaly_id: data.id }, 'anomaly employee notification failed (non-fatal)')
        }
      })()
    }

    return reply.send({ data: { id: data.id, resolved: data.resolved, resolved_at: data.resolved_at } })
  })

  // ── POST /attendance/anomalies/bulk-resolve ─────────────────────────────────────
  //    HR admin resolves multiple anomalies in one call.
  //    Body: { ids: string[] }
  fastify.post('/attendance/anomalies/bulk-resolve', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const bulkSchema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(200),
    })
    const parsed = bulkSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { ids } = parsed.data
    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('attendance_anomalies')
      .update({
        resolved:    true,
        resolved_by: req.userId,
        resolved_at: now,
        updated_at:  now,
      })
      .in('id', ids)
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      // Select fields needed for recompute — employee_id and date are required
      .select('id, employee_id, date, tenant_id, type')

    if (error) {
      req.log.error({ err: error }, 'bulk anomaly resolve failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to bulk-resolve anomalies' })
    }

    const resolvedRows = (data ?? []) as Array<{
      id: string
      employee_id: string | null
      date: string | null
      tenant_id: string
      type: string | null
    }>

    // ── Recompute attendance_daily for each unique employee+date ─────────────────
    // Single-resolve calls recomputeRange; bulk-resolve must do the same so
    // lop_days/payable_days reflect the correction rather than staying stale.
    //
    // Deduplicate by employee_id+date to avoid redundant recomputes when
    // multiple anomalies for the same date are resolved in one batch.
    const recomputeTargets = new Map<string, { employee_id: string; date: string; tenant_id: string }>()
    const keyToAnomalyIds  = new Map<string, string[]>()
    for (const row of resolvedRows) {
      if (row.employee_id && row.date) {
        const key = `${row.employee_id}:${row.date}`
        recomputeTargets.set(key, {
          employee_id: row.employee_id,
          date:        row.date,
          tenant_id:   row.tenant_id,
        })
        keyToAnomalyIds.set(key, [...(keyToAnomalyIds.get(key) ?? []), row.id])
      }
    }

    let recomputeAttempted = 0
    let recomputeFailed    = 0
    const failedAnomalyIds: string[] = []

    for (const [key, { employee_id, date, tenant_id }] of recomputeTargets) {
      recomputeAttempted++
      try {
        await recomputeRange(fastify.supabase, {
          tenant_id,
          employee_id,
          from_date:  date,
          to_date:    date,
          changed_by: req.userId,
        })
      } catch (recomputeErr) {
        recomputeFailed++
        failedAnomalyIds.push(...(keyToAnomalyIds.get(key) ?? []))
        req.log.warn(
          { err: recomputeErr, employee_id, date },
          'bulk anomaly resolve: attendance recompute failed — re-opening the anomaly so it is not falsely marked resolved',
        )
      }
    }

    // Re-open the anomalies whose corrective recompute failed — marking them
    // resolved while attendance_daily stays stale would hide a real gap from
    // payroll. Only the verified-corrected anomalies remain resolved.
    if (failedAnomalyIds.length > 0) {
      await fastify.supabase
        .from('attendance_anomalies')
        .update({ resolved: false, resolved_by: null, resolved_at: null, updated_at: new Date().toISOString() })
        .in('id', failedAnomalyIds)
        .eq('tenant_id', req.tenantId)
      req.log.warn(
        { recompute_attempted: recomputeAttempted, recompute_failed: recomputeFailed, reopened: failedAnomalyIds.length },
        'bulk anomaly resolve: some recomputes failed — affected anomalies re-opened',
      )
    }

    return reply.send({
      resolved_count:      resolvedRows.length - failedAnomalyIds.length,
      recompute_attempted: recomputeAttempted,
      // Only include failure fields when there were failures (keeps happy-path clean)
      ...(recomputeFailed > 0 && { recompute_failed: recomputeFailed, reopened: failedAnomalyIds.length }),
    })
  })

}
