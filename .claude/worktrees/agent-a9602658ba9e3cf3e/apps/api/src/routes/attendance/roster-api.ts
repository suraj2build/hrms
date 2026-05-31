/**
 * Shift Roster API Routes
 *
 * GET    /attendance/roster?month=YYYY-MM          â€” fetch full roster for the month
 * GET    /attendance/roster/employee/:employeeId   â€” today's roster override for one employee
 * POST   /attendance/roster/assign                 â€” single cell assignment
 * POST   /attendance/roster/bulk                   â€” bulk assignment (range Ã— employees)
 * POST   /attendance/roster/copy-week              â€” copy roster overrides from one week to another
 * POST   /attendance/roster/csv                    â€” upload CSV (employee_code,date,shift_code)
 * DELETE /attendance/roster/:id                    â€” remove a roster override
 *
 * Data model:
 *   shift_roster rows override an employee's standing shift (employee_shifts)
 *   for specific dates. The GET endpoint returns both so the UI can display
 *   the effective shift per cell without needing further lookups.
 *
 * Protected â€” requires hr_admin or super_admin.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { expandDateRange, shiftDate } from '../../lib/leave-engine.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logBulkAction } from '../../lib/audit-service.js'
import { eventService } from '../../lib/event-service.js'
import { recomputeRange } from '../../lib/attendance-engine.js'

const dateRe  = /^\d{4}-\d{2}-\d{2}$/
const monthRe = /^\d{4}-\d{2}$/

const assignSchema = z.object({
  employee_id: z.string().uuid(),
  date:        z.string().regex(dateRe, 'date must be YYYY-MM-DD'),
  shift_id:    z.string().uuid(),
})

const bulkSchema = z.object({
  employee_ids: z.array(z.string().uuid()).min(1, 'at least one employee required'),
  from_date:    z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
  to_date:      z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
  shift_id:     z.string().uuid(),
})

const copyWeekSchema = z.object({
  from_week_start: z.string().regex(dateRe, 'from_week_start must be YYYY-MM-DD'),
  to_week_start:   z.string().regex(dateRe, 'to_week_start must be YYYY-MM-DD'),
  employee_ids:    z.array(z.string().uuid()).optional(),
})

export default async function rosterRoute(fastify: FastifyInstance) {
  // All roster endpoints require HR admin â€” authenticate + role check in one step
  const adminAuth = {
    preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)],
  }

  // â”€â”€ GET /attendance/roster/employee/:employeeId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Returns today's roster override (if any) for a single employee.
  // Used by the Employee Config Panel in EmployeeProfile.
  fastify.get('/attendance/roster/employee/:employeeId', adminAuth, async (req, reply) => {

    const { employeeId } = req.params as { employeeId: string }
    const today = new Date().toISOString().slice(0, 10)

    const { data: row, error } = await fastify.supabase
      .from('shift_roster')
      .select('id, date, shift_id, shifts(id, name, code, start_time, end_time)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('date', today)
      .maybeSingle()

    if (error) {
      req.log.error({ err: error }, 'roster employee today fetch failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch roster' })
    }

    return reply.send({ data: row ?? null })
  })

  // â”€â”€ GET /attendance/roster â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/attendance/roster', adminAuth, async (req, reply) => {

    const { month } = req.query as { month?: string }
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'month must be YYYY-MM' })
    }

    const [y, m] = month.split('-').map(Number)
    const fromDate = `${month}-01`
    const toDate   = new Date(y, m, 0).toISOString().slice(0, 10)

    // Batch-fetch everything needed for the roster grid in parallel
    const [
      { data: employees, error: empError },
      { data: shifts,    error: shiftError },
      { data: roster,    error: rosterError },
      { data: standing,  error: standingError },
      { data: jobRows,   error: jobError },
    ] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active')
        .order('employee_code'),

      fastify.supabase
        .from('shifts')
        .select('id, name, code, start_time, end_time')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .order('name'),

      fastify.supabase
        .from('shift_roster')
        .select('id, employee_id, date, shift_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', fromDate)
        .lte('date', toDate),

      fastify.supabase
        .from('employee_shifts')
        .select('employee_id, shift_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),

      fastify.supabase
        .from('job_history')
        .select('employee_id, work_location_id, work_locations(id, name)')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),
    ])

    if (empError || shiftError || rosterError || standingError || jobError) {
      const err = empError ?? shiftError ?? rosterError ?? standingError ?? jobError
      req.log.error({ err }, 'roster data fetch failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch roster data' })
    }

    const jobMap = new Map(
      (jobRows ?? []).map((j: any) => [j.employee_id as string, j.work_locations ?? null])
    )

    return reply.send({
      month,
      employees: (employees ?? []).map((e: { id: string; first_name: string; last_name: string; employee_code: string }) => ({
        id:            e.id,
        employee_code: e.employee_code,
        name:          `${e.first_name} ${e.last_name}`,
        work_location: jobMap.get(e.id) ?? null,
      })),
      shifts: shifts ?? [],
      roster: roster ?? [],
      standing: standing ?? [],
    })
  })

  // â”€â”€ POST /attendance/roster/assign â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/attendance/roster/assign', adminAuth, async (req, reply) => {

    const parsed = assignSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, date, shift_id } = parsed.data

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const { data, error } = await fastify.supabase
      .from('shift_roster')
      .upsert(
        { tenant_id: req.tenantId, employee_id, date, shift_id },
        { onConflict: 'tenant_id,employee_id,date' },
      )
      .select('id, employee_id, date, shift_id')
      .single()

    if (error) {
      req.log.error({ err: error }, 'roster assign upsert failed')
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to assign shift' })
    }

    return reply.code(201).send({ data })
  })

  // â”€â”€ POST /attendance/roster/bulk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/attendance/roster/bulk', adminAuth, async (req, reply) => {

    const parsed = bulkSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_ids, from_date, to_date, shift_id } = parsed.data

    if (from_date > to_date) {
      return reply.code(400).send({ error: 'INVALID_DATES', message: 'from_date must be â‰¤ to_date' })
    }

    const dates = expandDateRange(from_date, to_date)
    if (dates.length > 31) {
      return reply.code(400).send({ error: 'RANGE_TOO_LARGE', message: 'Date range may not exceed 31 days' })
    }

    const rows: { tenant_id: string; employee_id: string; date: string; shift_id: string }[] = []
    for (const empId of employee_ids) {
      for (const d of dates) {
        rows.push({ tenant_id: req.tenantId, employee_id: empId, date: d, shift_id })
      }
    }

    const { error } = await fastify.supabase
      .from('shift_roster')
      .upsert(rows, { onConflict: 'tenant_id,employee_id,date' })

    if (error) {
      req.log.error({ err: error }, 'roster bulk upsert failed')
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to bulk assign shifts' })
    }

    return reply.send({ assigned: rows.length, employees: employee_ids.length, days: dates.length })
  })

  // â”€â”€ POST /attendance/roster/copy-week â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Copies shift_roster rows from a source week to a target week.
  // Same day-of-week offset mapping: source Monday â†’ target Monday, etc.
  fastify.post('/attendance/roster/copy-week', adminAuth, async (req, reply) => {

    const parsed = copyWeekSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { from_week_start, to_week_start, employee_ids } = parsed.data

    if (from_week_start === to_week_start) {
      return reply.code(400).send({ error: 'INVALID_WEEKS', message: 'Source and target weeks must be different' })
    }

    const fromDates = expandDateRange(from_week_start, shiftDate(from_week_start, 6))
    const toDates   = expandDateRange(to_week_start,   shiftDate(to_week_start,   6))

    // Fetch source week roster rows
    let q = fastify.supabase
      .from('shift_roster')
      .select('employee_id, date, shift_id')
      .eq('tenant_id', req.tenantId)
      .in('date', fromDates)

    if (employee_ids?.length) {
      q = q.in('employee_id', employee_ids)
    }

    const { data: sourceRows, error: fetchErr } = await q

    if (fetchErr) {
      req.log.error({ err: fetchErr }, 'copy-week source fetch failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch source week roster' })
    }

    if (!sourceRows?.length) {
      return reply.send({ message: 'No roster overrides in source week to copy', rows_copied: 0 })
    }

    // Map each source row to the corresponding day in the target week
    const dayIndexMap = new Map(fromDates.map((d, i) => [d, i]))
    const newRows = (sourceRows as Array<{ employee_id: string; date: string; shift_id: string }>)
      .map((r) => ({
        tenant_id:   req.tenantId,
        employee_id: r.employee_id,
        date:        toDates[dayIndexMap.get(r.date)!],
        shift_id:    r.shift_id,
      }))

    const { error: upsertErr } = await fastify.supabase
      .from('shift_roster')
      .upsert(newRows, { onConflict: 'tenant_id,employee_id,date' })

    if (upsertErr) {
      req.log.error({ err: upsertErr }, 'copy-week upsert failed')
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to copy roster entries' })
    }

    return reply.send({ message: 'Week copied successfully', rows_copied: newRows.length })
  })

  // â”€â”€ POST /attendance/roster/csv â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Accepts CSV text with header row: employee_code,date,shift_code
  // Resolves codes to IDs, then bulk-upserts into shift_roster.
  //
  // allow_partial (default false = STRICT MODE):
  //   false â†’ if ANY row fails validation return 422 with row-level errors, nothing is upserted
  //   true  â†’ upsert valid rows, return errors for invalid ones (partial insert)
  fastify.post('/attendance/roster/csv', adminAuth, async (req, reply) => {

    const body = req.body as { csv_content?: string; allow_partial?: boolean }
    const { csv_content, allow_partial = false } = body

    // Idempotency â€” replay cached response for duplicate submissions
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'roster-csv')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    if (!csv_content) {
      return reply.code(400).send({ error: 'MISSING_BODY', message: 'csv_content is required' })
    }

    const lines = csv_content.trim().split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      return reply.code(400).send({ error: 'EMPTY_CSV', message: 'CSV must have a header row and at least one data row' })
    }

    // Skip header; parse data rows
    const dataLines = lines.slice(1)
    const parsedRows = dataLines.map((l, idx) => {
      const [employee_code, date, shift_code] = l.split(',').map((s) => s.trim())
      return { line: idx + 1, employee_code, date, shift_code }
    })

    // Batch-resolve codes to IDs (fetch once)
    const [{ data: emps }, { data: shifts }] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id, employee_code')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),
      fastify.supabase
        .from('shifts')
        .select('id, code')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true),
    ])

    const empMap   = new Map((emps   ?? []).map((e: any) => [e.employee_code as string, e.id as string]))
    const shiftMap = new Map((shifts ?? []).map((s: any) => [s.code as string,          s.id as string]))

    const rows:   Array<{ tenant_id: string; employee_id: string; date: string; shift_id: string }> = []
    const errors: Array<{ line: number; message: string }> = []

    for (const { line, employee_code, date, shift_code } of parsedRows) {
      if (!employee_code || !date || !shift_code) {
        errors.push({ line, message: 'Missing required columns (employee_code, date, shift_code)' })
        continue
      }
      if (!dateRe.test(date)) {
        errors.push({ line, message: `Invalid date format "${date}" â€” expected YYYY-MM-DD` })
        continue
      }
      const employee_id = empMap.get(employee_code)
      if (!employee_id) {
        errors.push({ line, message: `Unknown employee_code: ${employee_code}` })
        continue
      }
      const shift_id = shiftMap.get(shift_code)
      if (!shift_id) {
        errors.push({ line, message: `Unknown shift_code: ${shift_code}` })
        continue
      }
      rows.push({ tenant_id: req.tenantId, employee_id, date, shift_id })
    }

    // Strict mode: reject the whole upload if any row failed
    if (!allow_partial && errors.length > 0) {
      return reply.code(422).send({
        error:   'VALIDATION_ERRORS',
        message: `${errors.length} row(s) failed validation â€” nothing was inserted`,
        errors,
      })
    }

    if (!rows.length) {
      return reply.code(400).send({ error: 'NO_VALID_ROWS', message: 'No valid rows after validation', errors })
    }

    const { error: upsertErr } = await fastify.supabase
      .from('shift_roster')
      .upsert(rows, { onConflict: 'tenant_id,employee_id,date' })

    if (upsertErr) {
      req.log.error({ err: upsertErr }, 'roster csv upsert failed')
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to upsert roster rows' })
    }

    const csvResponseBody = { rows_inserted: rows.length, errors }

    // Cache successful upload so duplicate submissions are replayed without re-inserting
    if (iKey) {
      await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'roster-csv', 200, csvResponseBody)
    }

    // Audit log — CSV roster upload by HR admin
    await logBulkAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'shift_roster',
      action:      'INSERT',
      performedBy: req.userId,
      summary: {
        rows_inserted:  rows.length,
        rows_skipped:   errors.length,
        allow_partial,
      },
    })

    // Event emission — fire-and-forget, after DB write and audit succeed
    eventService.emit('roster.uploaded', {
      tenant_id:      req.tenantId,
      rows_processed: rows.length,
      rows_failed:    errors.length,
    })

    // Fire-and-forget recompute for affected employees × dates
    // Group upserted rows by employee, then call recomputeRange per employee.
    setImmediate(async () => {
      try {
        const byEmp = new Map<string, string[]>()
        for (const r of rows) {
          const existing = byEmp.get(r.employee_id) ?? []
          existing.push(r.date)
          byEmp.set(r.employee_id, existing)
        }
        await Promise.all(
          [...byEmp.entries()].map(([empId, empDates]) => {
            const sorted = empDates.slice().sort()
            return recomputeRange(fastify.supabase, {
              tenant_id:   req.tenantId,
              employee_id: empId,
              from_date:   sorted[0]!,
              to_date:     sorted[sorted.length - 1]!,
              changed_by:  req.userId,
            })
          }),
        )
      } catch (recomputeErr) {
        fastify.log.warn({ err: recomputeErr }, 'roster csv recompute failed (fire-and-forget)')
      }
    })

    return reply.send(csvResponseBody)
  })

  // â”€â”€ DELETE /attendance/roster/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.delete('/attendance/roster/:id', adminAuth, async (req, reply) => {

    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('shift_roster')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      req.log.error({ err: error }, 'roster delete failed')
      return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to remove roster entry' })
    }

    return reply.code(204).send()
  })
}
