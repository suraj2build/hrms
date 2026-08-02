/**
 * Muster Upload Routes
 *
 * GET  /attendance/muster/upload/template   — generate Excel template (all employees × date range)
 * POST /attendance/muster/upload            — apply muster rows parsed by the frontend
 * GET  /attendance/muster/uploads           — upload history (audit log)
 * GET  /attendance/muster/uploads/:id       — single upload detail + stored errors
 *
 * Access: hr_admin / super_admin only.
 *
 * Muster wins: upserts attendance_daily with source='muster'.
 * Punches (attendance_raw_logs / attendance_logs) are NOT touched.
 * Payroll-locked months are rejected row-by-row with an error message.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import * as XLSX                from 'xlsx'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const VALID_STATUSES = ['P', 'A', 'HLF'] as const
type MusterStatus = typeof VALID_STATUSES[number]

/** attendance_daily field values per muster status */
const STATUS_MAP: Record<MusterStatus, {
  status:       string
  day_fraction: number
  work_hours:   number
  is_payable:   boolean
}> = {
  P:   { status: 'present',  day_fraction: 1.0, work_hours: 8.0, is_payable: true  },
  A:   { status: 'absent',   day_fraction: 0.0, work_hours: 0.0, is_payable: false },
  HLF: { status: 'half_day', day_fraction: 0.5, work_hours: 4.0, is_payable: true  },
}

const UPSERT_CHUNK = 500
const MAX_ROWS     = 150_000  // safety cap — 4000 emp × 31 days ≈ 124k

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function musterUploadRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function adminOnly(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /attendance/muster/upload/template ──────────────────────────────────
  // Returns an XLSX file with all active employees × every date in the range.
  // Status column is blank — HR fills it in and re-uploads the file.
  fastify.get('/attendance/muster/upload/template', auth, async (req: any, reply) => {
    if (!adminOnly(req, reply)) return

    const qSchema = z.object({
      from: z.string().regex(DATE_RE, 'from must be YYYY-MM-DD'),
      to:   z.string().regex(DATE_RE, 'to must be YYYY-MM-DD'),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { from, to } = parsed.data

    if (from > to) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '"from" must be on or before "to"' })
    }

    const fromDate = new Date(from)
    const toDate   = new Date(to)
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
    if (diffDays > 31) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Date range cannot exceed 31 days' })
    }

    // All active employees for this tenant — PostgREST's 1,000-row max-rows
    // ceiling silently truncates a plain .select() too, not just .limit(N),
    // so a large tenant's template would be missing employees with no error.
    let employees: Array<{ employee_code: string; first_name: string; last_name: string }>
    try {
      employees = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('employee_code, first_name, last_name')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .order('employee_code')
          .range(from, to),
      )
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')
    }

    // Build date list
    const dates: string[] = []
    const cur = new Date(fromDate)
    while (cur <= toDate) {
      dates.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }

    // ── Sheet 1: Muster ───────────────────────────────────────────────────────
    const wsRows: (string | number)[][] = [
      ['Employee Code', 'Employee Name', 'Date', 'Status (P / A / HLF)'],
    ]
    for (const emp of (employees ?? [])) {
      for (const date of dates) {
        wsRows.push([emp.employee_code, `${emp.first_name} ${emp.last_name}`, date, ''])
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(wsRows)
    ws['!cols'] = [
      { wch: 16 },  // Employee Code
      { wch: 28 },  // Employee Name
      { wch: 14 },  // Date
      { wch: 22 },  // Status
    ]

    // ── Sheet 2: Instructions ─────────────────────────────────────────────────
    const wsInstr = XLSX.utils.aoa_to_sheet([
      ['Muster Upload Instructions'],
      [''],
      ['Fill the "Status" column in the Muster sheet using EXACTLY one of:'],
      ['  P    = Present (full day, 8 hrs)'],
      ['  A    = Absent  (0 hrs, LOP applies)'],
      ['  HLF  = Half Day (4 hrs, 0.5 LOP applies)'],
      [''],
      ['Rules:'],
      ['  • Leave the Status blank to skip that row — no change is made'],
      ['  • Do NOT modify Employee Code, Employee Name, or Date columns'],
      ['  • Payroll-locked periods are automatically rejected (shown in error report)'],
      ['  • Muster status overrides biometric-derived status — punches are kept for audit'],
      ['  • Statuses are case-sensitive: use P, A, HLF exactly (not p, a, hlf)'],
    ])

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws,      'Muster')
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="muster-${from}-to-${to}.xlsx"`)
      .send(buf)
  })

  // ── POST /attendance/muster/upload ─────────────────────────────────────────
  // Frontend parses the Excel client-side and sends the data rows as JSON.
  // Blank-status rows must be filtered out by the frontend before sending.
  fastify.post('/attendance/muster/upload', auth, async (req: any, reply) => {
    if (!adminOnly(req, reply)) return

    const bodySchema = z.object({
      filename: z.string().min(1).max(500),
      rows: z.array(z.object({
        employee_code: z.string().min(1).max(50),
        date:          z.string().regex(DATE_RE),
        status:        z.enum(VALID_STATUSES),
      })).min(1).max(MAX_ROWS),
    })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { filename, rows } = parsed.data

    // Derive period bounds
    const sortedDates = rows.map(r => r.date).sort()
    const periodFrom  = sortedDates[0]
    const periodTo    = sortedDates[sortedDates.length - 1]

    // ── Resolve all employee codes in one query ───────────────────────────────
    // A large enterprise's muster covers more employees than any single
    // upload's row cap enforces, so this can exceed PostgREST's 1,000-row
    // max-rows ceiling just like an unbounded fetch would — paginate it.
    const uniqueCodes = [...new Set(rows.map(r => r.employee_code))]
    const resolvedEmployees = await fetchAllRows<{ id: string; employee_code: string }>((from, to) =>
      fastify.supabase
        .from('employees')
        .select('id, employee_code')
        .eq('tenant_id', req.tenantId)
        .in('employee_code', uniqueCodes)
        .range(from, to),
    )

    const codeToId: Record<string, string> = {}
    for (const emp of resolvedEmployees) {
      codeToId[emp.employee_code] = emp.id
    }

    // ── Fetch locked months ───────────────────────────────────────────────────
    const uniqueMonths = [...new Set(rows.map(r => r.date.slice(0, 7)))]
    const { data: lockedPeriods } = await fastify.supabase
      .from('attendance_period_locks')
      .select('period_month')
      .eq('tenant_id', req.tenantId)
      .in('period_month', uniqueMonths)
      .neq('state', 'OPEN')

    const lockedMonths = new Set((lockedPeriods ?? []).map((p: any) => p.period_month as string))

    // ── Create upload record (audit) ──────────────────────────────────────────
    const { data: uploadRecord, error: uploadErr } = await fastify.supabase
      .from('muster_uploads')
      .insert({
        tenant_id:    req.tenantId,
        uploaded_by:  req.userId,
        filename,
        period_from:  periodFrom,
        period_to:    periodTo,
        row_count:    rows.length,
        success_count: 0,
        error_count:   0,
      })
      .select('id')
      .single()

    if (uploadErr || !uploadRecord) {
      return serverError(req, reply, uploadErr, ErrorCode.INSERT_FAILED, 'Failed to initialise upload')
    }

    const uploadId = uploadRecord.id

    // ── Validate + map rows ───────────────────────────────────────────────────
    type UploadError = { row: number; employee_code: string; date: string; reason: string }
    type DailyRow = {
      tenant_id:        string
      employee_id:      string
      date:             string
      status:           string
      work_hours:       number
      late_minutes:     number
      overtime_minutes: number
      is_payable:       boolean
      day_fraction:     number
      source:           string
      muster_upload_id: string
    }

    const errors:  UploadError[] = []
    const toUpsert: DailyRow[]   = []
    // Parallel to toUpsert (same index) — row number/employee_code for
    // reporting which specific rows failed if their upsert chunk fails.
    const toUpsertMeta: Array<{ row: number; employee_code: string; date: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i]
      const rowNum = i + 1

      const empId = codeToId[row.employee_code]
      if (!empId) {
        errors.push({ row: rowNum, employee_code: row.employee_code, date: row.date,
          reason: `Employee code "${row.employee_code}" not found in this tenant` })
        continue
      }

      const month = row.date.slice(0, 7)
      if (lockedMonths.has(month)) {
        errors.push({ row: rowNum, employee_code: row.employee_code, date: row.date,
          reason: `Period ${month} is locked for payroll — no changes allowed` })
        continue
      }

      const m = STATUS_MAP[row.status]
      toUpsert.push({
        tenant_id:        req.tenantId,
        employee_id:      empId,
        date:             row.date,
        status:           m.status,
        work_hours:       m.work_hours,
        late_minutes:     0,
        overtime_minutes: 0,
        is_payable:       m.is_payable,
        day_fraction:     m.day_fraction,
        source:           'muster',
        muster_upload_id: uploadId,
      })
      toUpsertMeta.push({ row: rowNum, employee_code: row.employee_code, date: row.date })
    }

    // ── Batch upsert ──────────────────────────────────────────────────────────
    let upsertFailCount = 0

    for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK) {
      const chunk     = toUpsert.slice(i, i + UPSERT_CHUNK)
      const chunkMeta = toUpsertMeta.slice(i, i + UPSERT_CHUNK)
      const { error: upsertErr } = await fastify.supabase
        .from('attendance_daily')
        .upsert(chunk, { onConflict: 'tenant_id,employee_id,date', ignoreDuplicates: false })

      if (upsertErr) {
        fastify.log.error({ upsertErr, chunk_start: i }, 'muster-upload: upsert chunk failed')
        upsertFailCount += chunk.length
        // Previously a chunk failure only incremented a bare count — the
        // admin-facing error report (and CSV/UI) had zero detail on which
        // rows failed or why, undistinguishable from a fully successful
        // upload except for a mismatched success_count. Record one entry
        // per affected row so they're visible the same way validation
        // failures already are.
        for (const meta of chunkMeta) {
          errors.push({
            row:           meta.row,
            employee_code: meta.employee_code,
            date:          meta.date,
            reason:        'Database write failed for this row — contact support if this persists',
          })
        }
      }
    }

    const successCount = toUpsert.length - upsertFailCount
    // errors already includes one entry per failed-chunk row (pushed above),
    // so it alone is the full error count — adding upsertFailCount again
    // would double-count every chunk-failure row.
    const errorCount   = errors.length

    // ── Update audit record ───────────────────────────────────────────────────
    await fastify.supabase
      .from('muster_uploads')
      .update({
        success_count: successCount,
        error_count:   errorCount,
        errors:        errors.slice(0, 500),  // cap stored errors to 500
      })
      .eq('id', uploadId)

    return reply.code(201).send({
      upload_id:     uploadId,
      row_count:     rows.length,
      success_count: successCount,
      error_count:   errorCount,
      errors:        errors.slice(0, 100), // return first 100 in response body
    })
  })

  // ── GET /attendance/muster/uploads ─────────────────────────────────────────
  fastify.get('/attendance/muster/uploads', auth, async (req: any, reply) => {
    if (!adminOnly(req, reply)) return

    const { data, error } = await fastify.supabase
      .from('muster_uploads')
      .select('id, filename, period_from, period_to, row_count, success_count, error_count, uploaded_by, created_at')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      if ((error as any).code === '42P01') return reply.send({ data: [] })
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch uploads')
    }

    // Resolve uploader names
    const uploaderIds = [...new Set((data ?? []).map((r: any) => r.uploaded_by as string))]
    let nameMap: Record<string, string> = {}
    if (uploaderIds.length) {
      const { data: profiles } = await fastify.supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', uploaderIds)
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string }>) {
        nameMap[p.id] = p.full_name
      }
    }

    const rows = (data ?? []).map((r: any) => ({
      id:            r.id,
      filename:      r.filename,
      period_from:   r.period_from,
      period_to:     r.period_to,
      row_count:     r.row_count,
      success_count: r.success_count,
      error_count:   r.error_count,
      created_at:    r.created_at,
      uploaded_by:   nameMap[r.uploaded_by] ?? r.uploaded_by,
    }))

    return reply.send({ data: rows })
  })

  // ── GET /attendance/muster/uploads/:id ─────────────────────────────────────
  fastify.get('/attendance/muster/uploads/:id', auth, async (req: any, reply) => {
    if (!adminOnly(req, reply)) return

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('muster_uploads')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error)  return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch upload')
    if (!data)  return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload not found' })

    return reply.send({ data })
  })
}
