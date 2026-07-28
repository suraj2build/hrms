import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, validationError, ErrorCode } from '../../lib/api-errors.js'

/** One calendar day before the given YYYY-MM-DD date, as YYYY-MM-DD. */
function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Empty/None selections arrive as '' or null from the form — coerce both to
// undefined so optional uuid fields validate instead of 400-ing the whole save.
const optUuid = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().uuid().optional(),
)
const optStr = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().optional(),
)

const createJobHistorySchema = z.object({
  department_id:     optUuid,
  designation_id:    optUuid,
  grade_id:          optUuid,
  work_location_id:  optUuid,
  cost_center_id:    optUuid,
  shift_id:          optUuid,
  manager_id:        optUuid,
  employment_type:   z.enum(['permanent','contract','intern','probation','consultant']),
  confirmation_date: optStr,
  effective_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason_for_change: optStr,
  is_current:        z.boolean().optional().default(true),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

/** Resolves caller employee_id from profiles (tenant-scoped). */
async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .single()
  return data?.employee_id ?? null
}

export default async function jobHistoryRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /employees/:id/job-info  → current job (latest is_current = true)
  // Employees may only view their own; HR admins see all.
  fastify.get('/employees/:id/job-info', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own job info' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('job_history')
      .select(`
        *,
        departments(id, name, code),
        designations(id, name),
        grades(id, name, code),
        work_locations(id, name, city),
        cost_centers(id, name, code),
        shifts(id, name, start_time, end_time),
        manager:manager_id(id, first_name, last_name, employee_code)
      `)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('is_current', true)
      .single()
    if (error && error.code !== 'PGRST116')
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch job info')
    return reply.send({ data: data ?? null })
  })

  // GET /employees/:id/job-history  → full history
  // Employees may only view their own; HR admins see all.
  fastify.get('/employees/:id/job-history', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own job history' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('job_history')
      .select(`
        *,
        departments(id, name),
        designations(id, name),
        grades(id, name, code),
        work_locations(id, name),
        cost_centers(id, name),
        shifts(id, name),
        manager:manager_id(id, first_name, last_name, employee_code)
      `)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error) {
      // Embed failure (a FK column/relationship missing on a drifted DB) must not
      // break the whole profile. Fall back to the raw rows (no joined names) so
      // the page still loads; run migration 223 to restore the embeds.
      req.log.warn({ err: error, employeeId: req.params.id }, 'job-history embed failed — serving raw rows (run migration 223)')
      const { data: raw, error: rawErr } = await fastify.supabase
        .from('job_history')
        .select('*')
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .order('effective_from', { ascending: false })
      if (rawErr) return serverError(req, reply, rawErr, ErrorCode.QUERY_FAILED, 'Failed to fetch job history')
      return reply.send({ data: raw ?? [] })
    }
    return reply.send({ data })
  })

  // POST /employees/:id/job-history  → new job entry (trigger auto-closes previous)
  // HR admin only — creating job history entries changes reporting structures.
  fastify.post('/employees/:id/job-history', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = createJobHistorySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Cross-tenant IDOR guard: department_id/designation_id/grade_id/work_location_id/
    // cost_center_id/shift_id/manager_id are plain FKs with no tenant condition, so
    // without this check an hr_admin could attach another tenant's row here (mirrors
    // the fkChecks pattern in index.ts PUT /employees/:id and full-create.ts).
    const fkChecks: Array<[string, string, string]> = [
      ['department_id',     'departments',      'Department'],
      ['designation_id',    'designations',     'Designation'],
      ['grade_id',          'grades',           'Grade'],
      ['work_location_id',  'work_locations',   'Work location'],
      ['cost_center_id',    'cost_centers',     'Cost center'],
      ['shift_id',          'shifts',           'Shift'],
      ['manager_id',        'employees',        'Manager'],
    ]
    for (const [field, table, label] of fkChecks) {
      const fkId = (parsed.data as Record<string, unknown>)[field]
      if (!fkId) continue
      const { data: fkRow } = await fastify.supabase
        .from(table)
        .select('id')
        .eq('id', fkId as string)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!fkRow) return validationError(reply, ErrorCode.VALIDATION_ERROR, `${label} not found in your organisation`)
    }

    // Circular-reference guard — this endpoint also syncs employees.manager_id
    // (below), a second write path to the same column that the dedicated
    // PUT /employees/:id/manager route already guards against self-assignment
    // and cycles. Without the same check here, reassigning via job history
    // (the path the "Reassign Reporting Manager" UI actually uses) can create
    // A→B→A with no rejection.
    if (parsed.data.is_current !== false && parsed.data.manager_id) {
      if (parsed.data.manager_id === req.params.id) {
        return reply.code(422).send({ error: 'CIRCULAR_REFERENCE', message: 'An employee cannot be their own manager.' })
      }
      const MAX_DEPTH = 20
      let cursor: string | null = parsed.data.manager_id
      let depth = 0
      while (cursor && depth < MAX_DEPTH) {
        const { data: node } = await fastify.supabase
          .from('employees')
          .select('manager_id')
          .eq('id', cursor)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        const nodeRow = node as { manager_id: string | null } | null
        if (!nodeRow) break
        cursor = nodeRow.manager_id
        depth++
        if (cursor === req.params.id) {
          return reply.code(422).send({ error: 'CIRCULAR_REFERENCE', message: 'Setting this manager would create a circular reporting chain.' })
        }
      }
    }

    // Supersede the prior current row BEFORE inserting, replicating exactly
    // what fn_close_prev_job_history's AFTER INSERT trigger (migration 013)
    // does: is_current=false AND effective_to=effective_from-1day. Closing
    // is_current here (regardless of the trigger's presence) makes the
    // insert safe from the uidx_job_history_one_current collision on
    // drifted DBs — but a bare is_current=false pre-update also means that
    // by the time the trigger runs, its own `WHERE is_current = true` finds
    // nothing to close, so effective_to is never set even when the trigger
    // IS present. Setting effective_to here too closes that gap.
    if (parsed.data.is_current !== false) {
      const { error: closeErr } = await fastify.supabase
        .from('job_history')
        .update({
          is_current:   false,
          effective_to: dayBefore(parsed.data.effective_from),
        })
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true)

      if (closeErr) {
        return serverError(req, reply, closeErr, ErrorCode.UPDATE_FAILED, 'Failed to close previous job history entry')
      }
    }

    // Insert + return the RAW row (no FK embeds). Embedding here previously made
    // "Add Position" 500 whenever a job_history FK relationship was missing on a
    // drifted DB — even though the row inserted fine. The client refetches the
    // full profile after success, so the embedded names aren't needed here.
    const { data, error } = await fastify.supabase
      .from('job_history')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        created_by:  req.userId,
      })
      .select('*')
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create job history entry')

    // Sync employees.manager_id when a new current job row carries a manager_id.
    // This keeps the live reporting FK in sync with job_history automatically.
    if (parsed.data.is_current !== false && 'manager_id' in parsed.data) {
      const { error: mgrSyncErr } = await fastify.supabase
        .from('employees')
        .update({ manager_id: parsed.data.manager_id ?? null, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
      if (mgrSyncErr) {
        req.log.error({ err: mgrSyncErr, employeeId: req.params.id }, 'job-history: job entry created but failed to sync employees.manager_id')
      }
    }

    return reply.code(201).send(data)
  })

  // DELETE /employees/:id/job-history/:rowId — HR admin only
  fastify.delete('/employees/:id/job-history/:rowId', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('job_history')
      .delete()
      .eq('id', req.params.rowId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete job history entry')
    if (!data || data.length === 0) return notFound(reply, 'NOT_FOUND', 'Job history entry not found')
    return reply.code(204).send()
  })
}
