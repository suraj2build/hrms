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

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const hrQuerySchema = z.object({
  from:        z.string().regex(dateRe).optional(),
  to:          z.string().regex(dateRe).optional(),
  employee_id: z.string().uuid().optional(),
  type:        z.enum(['missing_out', 'no_punch', 'late', 'excessive_hours']).optional(),
  severity:    z.enum(['low', 'medium', 'high']).optional(),
  resolved:    z.enum(['true', 'false']).optional(),
  limit:       z.coerce.number().int().min(1).max(200).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
})

const myQuerySchema = z.object({
  from:   z.string().regex(dateRe).optional(),
  to:     z.string().regex(dateRe).optional(),
  type:   z.enum(['missing_out', 'no_punch', 'late', 'excessive_hours']).optional(),
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

  // ── GET /attendance/anomalies ──────────────────────────────────────────────────
  //    HR view — all anomalies for the tenant with rich filtering.
  fastify.get('/attendance/anomalies', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
          resolved_at,
          employees!inner(id, first_name, last_name, employee_code),
          profiles(id, full_name)
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
      employees:   { id: string; first_name: string; last_name: string; employee_code: string } | Array<{ id: string; first_name: string; last_name: string; employee_code: string }> | null
      profiles:    { id: string; full_name: string } | Array<{ id: string; full_name: string }> | null
    }>).map((r) => {
      const emp  = Array.isArray(r.employees) ? r.employees[0] : r.employees
      const prof = Array.isArray(r.profiles)  ? r.profiles[0]  : r.profiles
      return {
        id:            r.id,
        date:          r.date,
        type:          r.type,
        message:       r.message,
        severity:      r.severity,
        resolved:      r.resolved,
        created_at:    r.created_at,
        resolved_at:   r.resolved_at,
        employee_id:   emp?.id           ?? null,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
        resolved_by_name: prof?.full_name ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── POST /attendance/anomalies/:id/resolve ─────────────────────────────────────
  //    HR admin marks one anomaly as resolved.
  fastify.post('/attendance/anomalies/:id/resolve', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    // 1. Emit observable event for audit traceability
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

    // 2. Notify the affected employee (look up their profile id) — fire-and-forget
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
      .select('id')

    if (error) {
      req.log.error({ err: error }, 'bulk anomaly resolve failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to bulk-resolve anomalies' })
    }

    return reply.send({ resolved_count: (data ?? []).length })
  })

  // ── GET /attendance/anomalies/summary ─────────────────────────────────────────
  //    Lightweight counts for operational banner + health dashboard.
  //    Auth: any authenticated user (admins see tenant totals, employees see own).
  fastify.get('/attendance/anomalies/summary', auth, async (req: any, reply) => {
    const isAdmin = ['super_admin', 'hr_admin', 'manager'].includes(req.userRole)

    // Base query for open_count
    const openQ = fastify.supabase
      .from('attendance_anomalies')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const resolvedTodayQ = fastify.supabase
      .from('attendance_anomalies')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('resolved', true)
      .gte('resolved_at', todayStart.toISOString())

    const [openRes, resolvedRes] = await Promise.all([
      isAdmin ? openQ : openQ.eq('employee_id', req.userId),
      isAdmin ? resolvedTodayQ : resolvedTodayQ.eq('employee_id', req.userId),
    ])

    if (openRes.error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch summary' })

    return reply.send({
      open_count:     openRes.count ?? 0,
      resolved_today: resolvedRes.count ?? 0,
    })
  })
}
