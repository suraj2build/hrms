import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { eventBus } from '../../lib/event-bus.js'
import { computeFnfSettlement } from '../../lib/fnf-settlement-engine.js'
import { isHrAdmin, resolveCallerEmployeeId, isDirectReport } from '../../lib/manager-scope.js'
import { revokeEmployeeAuth } from '../../lib/user-account-service.js'
import { serverError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const clearanceStatusSchema = z.object({
  status:  z.enum(['cleared', 'rejected']),
  remarks: z.string().optional(),
  // optional so this stays backward-compatible with a frontend that hasn't
  // been updated to send it yet — the CAS check below only runs when a
  // caller actually provides it (PEND-105 follow-up wave).
  expected_version: z.number().int().positive().optional(),
})

const ffBodySchema = z.object({
  last_payroll_amount:      z.number(),
  leave_encashment_amount:  z.number(),
  gratuity_amount:          z.number(),
  notice_period_deduction:  z.number(),
  other_deductions:         z.number().optional().default(0),
  other_additions:          z.number().optional().default(0),
  asset_recovery_amount:    z.number().optional().default(0),
  loan_recovery_amount:     z.number().optional().default(0),
  advance_recovery_amount:  z.number().optional().default(0),
  notes:                    z.string().optional(),
  // optional — only checked against the update branch (a fresh insert has
  // no prior version to compare against).
  expected_version:         z.number().int().positive().optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CLEARANCE_DEPARTMENTS = ['it', 'finance', 'manager', 'admin', 'hr'] as const

const DEFAULT_CLEARANCE_DEPTS = [
  { code: 'it', label: 'IT' }, { code: 'finance', label: 'Finance' },
  { code: 'manager', label: 'Reporting Manager' }, { code: 'admin', label: 'Admin' }, { code: 'hr', label: 'HR' },
]

// The tenant's active clearance departments (seeds the defaults on first use).
async function getClearanceDepts(fastify: any, tenantId: string) {
  const { data } = await fastify.supabase
    .from('clearance_departments')
    .select('id, code, label, display_order, is_active, version')
    .eq('tenant_id', tenantId).eq('is_active', true).order('display_order')
  if (data && data.length > 0) return data
  const rows = DEFAULT_CLEARANCE_DEPTS.map((d, i) => ({ tenant_id: tenantId, code: d.code, label: d.label, display_order: i }))
  const { data: seeded } = await fastify.supabase.from('clearance_departments').insert(rows).select('id, code, label, display_order, is_active, version')
  return seeded ?? []
}

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id, status')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

async function getSeparationRecord(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employee_separation')
    .select('id, clearance_done')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

// Full separation row — for lifecycle transitions.
async function getSeparation(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employee_separation')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

// Gated forward sequence for the lifecycle pointer.
const STAGE_SEQUENCE = ['notice_period', 'clearance', 'fnf', 'relieving'] as const

const approveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  remarks:  z.string().optional(),
})

const advanceSchema = z.object({
  to: z.enum(['notice_period', 'clearance', 'fnf', 'relieving']).optional(),
})

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export default async function separationWorkflowRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /separations — list all separations with clearances + F&F for tenant ──
  fastify.get('/separations', hrAdminAuth, async (req: any, reply) => {
    // Separations accumulate over the tenant's lifetime (unlike active
    // employees, which shrink on separation), so a long-lived enterprise
    // tenant can exceed PostgREST's 1,000-row cap here — an unbounded
    // .select() would silently drop older separation records with no error.
    let seps: any[]
    try {
      seps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_separation')
          .select(`
            id, separation_type, initiated_by, notice_date,
            last_working_date, exit_reason, clearance_done,
            exit_interview_done, remarks, created_at, version,
            lifecycle_stage, approval_status, relieved_at, archived_at,
            employees!inner (
              id, first_name, last_name, employee_code,
              departments ( name )
            )
          `)
          .eq('tenant_id', req.tenantId)
          .order('created_at', { ascending: false })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch separations')
    }

    // Attach clearances + F&F for each separation
    const result = await Promise.all(seps.map(async (sep: any) => {
      const { data: clearances } = await fastify.supabase
        .from('separation_clearances')
        .select('id, department, status, cleared_by, cleared_at, remarks, version')
        .eq('separation_id', sep.id)
        .eq('tenant_id', req.tenantId)
        .order('created_at')

      const { data: ff } = await fastify.supabase
        .from('separation_ff_summary')
        .select('*')
        .eq('separation_id', sep.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      return {
        id:               sep.id,
        employee_id:      sep.employees?.id,
        employee_name:    `${sep.employees?.first_name} ${sep.employees?.last_name}`,
        employee_code:    sep.employees?.employee_code,
        department:       sep.employees?.departments?.name ?? null,
        separation_type:  sep.separation_type,
        last_working_date: sep.last_working_date,
        clearance_done:   sep.clearance_done,
        status:           sep.clearance_done ? 'completed' : 'in_progress',
        lifecycle_stage:  sep.lifecycle_stage ?? 'initiated',
        approval_status:  sep.approval_status ?? 'pending',
        relieved_at:      sep.relieved_at ?? null,
        archived_at:      sep.archived_at ?? null,
        version:          sep.version,
        clearances:       clearances ?? [],
        fnf:              ff ?? null,
      }
    }))

    return reply.send({ data: result })
  })

  // ── GET /employees/:id/separation-clearances ──────────────────────────────

  fastify.get('/employees/:id/separation-clearances', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('separation_clearances')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('department', { ascending: true })

    if (error)
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch separation clearances')

    return reply.send({ data: data ?? [] })
  })

  // ── POST /employees/:id/separation-clearances ─────────────────────────────

  fastify.post('/employees/:id/separation-clearances', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const separation = await getSeparationRecord(fastify, req.params.id, req.tenantId)
    if (!separation)
      return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record found. Initiate separation first.' })

    // Check if clearances already exist
    const { data: existing } = await fastify.supabase
      .from('separation_clearances')
      .select('id')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .limit(1)

    if (existing && existing.length > 0)
      return reply.code(409).send({ error: 'ALREADY_INITIALIZED', message: 'Clearances already initialized for this employee.' })

    const depts = await getClearanceDepts(fastify, req.tenantId)
    const rows = (depts.length ? depts.map((d: any) => d.code) : CLEARANCE_DEPARTMENTS).map((dept: string) => ({
      employee_id:    req.params.id,
      tenant_id:      req.tenantId,
      separation_id:  separation.id,
      department:     dept,
      status:         'pending',
      created_by:     req.userId,
    }))

    const { data, error } = await fastify.supabase
      .from('separation_clearances')
      .insert(rows)
      .select()

    if (error)
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to initialize clearances')

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_clearances',
      recordId:    separation.id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { departments: CLEARANCE_DEPARTMENTS },
    })

    return reply.code(201).send({ data })
  })

  // ── PATCH /employees/:id/separation-clearances/:clearanceId ──────────────

  fastify.patch('/employees/:id/separation-clearances/:clearanceId', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // P6.0d — ownership guard. HR admins may action any department's clearance.
    // A manager may only action the 'manager' clearance of a direct report; every
    // other caller is rejected. This both opens the manager clearance action and
    // closes the prior gap where ownership was never validated.
    if (!isHrAdmin(req.userRole)) {
      if (req.userRole !== 'manager') {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin access required' })
      }
      const { data: clearance } = await fastify.supabase
        .from('separation_clearances')
        .select('department')
        .eq('id', req.params.clearanceId)
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!clearance)
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Clearance record not found' })
      if ((clearance as any).department !== 'manager')
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Managers may only action the manager clearance' })
      const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!myEmpId || !(await isDirectReport(fastify.supabase, req.tenantId, myEmpId, req.params.id)))
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'This employee is not one of your direct reports' })
    }

    const parsed = clearanceStatusSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // ── Asset Management integration ────────────────────────────────────────
    // The IT clearance cannot be marked 'cleared' while the employee still holds
    // assigned company assets. Other departments are unaffected.
    if (parsed.data.status === 'cleared') {
      const { data: clearanceRow } = await fastify.supabase
        .from('separation_clearances')
        .select('department')
        .eq('id', req.params.clearanceId)
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (clearanceRow?.department === 'it') {
        const { count } = await fastify.supabase
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('assigned_to', req.params.id)
          .eq('status', 'assigned')

        const outstanding = count ?? 0
        if (outstanding > 0) {
          return reply.code(409).send({
            error:   'ASSETS_OUTSTANDING',
            message: `Employee has ${outstanding} asset(s) not yet returned. Recover assets before IT clearance.`,
            count:   outstanding,
          })
        }
      }
    }

    let updateQuery = fastify.supabase
      .from('separation_clearances')
      .update({
        status:       parsed.data.status,
        remarks:      parsed.data.remarks ?? null,
        updated_by:   req.userId,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', req.params.clearanceId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (parsed.data.expected_version !== undefined)
      updateQuery = updateQuery.eq('version', parsed.data.expected_version)

    const { data: updated, error } = await updateQuery.select().maybeSingle()

    if (error)
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update clearance status')
    if (!updated) {
      // Disambiguate "record deleted" (404) from "version moved on since
      // this was loaded" (409) — only relevant when a CAS check was applied.
      if (parsed.data.expected_version !== undefined) {
        const { data: stillExists } = await fastify.supabase
          .from('separation_clearances')
          .select('id')
          .eq('id', req.params.clearanceId)
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (stillExists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This clearance was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Clearance record not found' })
    }

    // Check if all 5 clearances are now 'cleared'
    const { data: allClearances, error: fetchErr } = await fastify.supabase
      .from('separation_clearances')
      .select('status')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (!fetchErr && allClearances) {
      // Clearance rows are seeded once, per-employee, from the tenant's actual
      // configured department list (getClearanceDepts()) — not the fixed
      // CLEARANCE_DEPARTMENTS default. Comparing against that hardcoded
      // literal's length breaks completion detection for any tenant that has
      // customized their clearance departments (added/removed via
      // /settlement/clearance-departments): allClearances.length is then
      // permanently != CLEARANCE_DEPARTMENTS.length, so clearance_done never
      // flips true and /relieve stays blocked forever. length > 0 is the
      // correct check — every row present for this employee must be cleared.
      const allCleared =
        allClearances.length > 0 &&
        allClearances.every((c: any) => c.status === 'cleared')

      if (allCleared) {
        await fastify.supabase
          .from('employee_separation')
          .update({ clearance_done: true })
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
      }
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_clearances',
      recordId:    req.params.clearanceId,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send({ data: updated })
  })

  // ── GET /employees/:id/separation-ff ─────────────────────────────────────

  fastify.get('/employees/:id/separation-ff', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('separation_ff_summary')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error)
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch F&F summary')

    return reply.send({ data: data ?? null })
  })

  // ── POST /employees/:id/separation-ff ────────────────────────────────────

  fastify.post('/employees/:id/separation-ff', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const separation = await getSeparationRecord(fastify, req.params.id, req.tenantId)
    if (!separation)
      return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record found. Initiate separation first.' })

    const parsed = ffBodySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // net_payable is a GENERATED column — never written by the app.
    const { data: existing } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, status')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    // Once approved or paid, the reviewed figures are frozen — this was the
    // one route that could silently rewrite them with no status check at
    // all, which made "approval" non-binding: whatever was last saved here
    // (by anyone, at any time) is what a concurrent approve/mark-paid would
    // actually commit, regardless of what was reviewed.
    if (existing && (existing as any).status !== 'draft') {
      return conflictError(reply, 'LOCKED',
        `This F&F settlement is ${(existing as any).status} and can no longer be edited.`)
    }

    // expected_version is a CAS control field, not a DB column — strip it
    // before spreading into the insert/update payload.
    const { expected_version, ...ffFields } = parsed.data

    let result: any
    let statusCode = 201

    if (existing) {
      // The LOCKED check above reads `existing` in a separate round-trip
      // from this UPDATE — on its own that's a check, not an enforcement:
      // a concurrent approve landing in between would still let this
      // UPDATE through and silently rewrite the now-approved row. Folding
      // .eq('status', 'draft') into the WHERE clause makes the freeze an
      // actual property of the write, not just of what was last read.
      let updateQuery = fastify.supabase
        .from('separation_ff_summary')
        .update({
          ...ffFields,
          updated_by: req.userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('tenant_id', req.tenantId)
        .eq('status', 'draft')
      if (expected_version !== undefined)
        updateQuery = updateQuery.eq('version', expected_version)

      const { data, error } = await updateQuery.select().maybeSingle()
      if (error)
        return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update F&F settlement')
      if (!data) {
        // Disambiguate the 0-row CAS miss: gone entirely, no longer draft
        // (a concurrent approve/mark-paid won the race), or — only when the
        // caller sent expected_version — a version conflict within 'draft'.
        const { data: current } = await fastify.supabase
          .from('separation_ff_summary')
          .select('status')
          .eq('id', existing.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (!current)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'F&F record not found' })
        if ((current as any).status !== 'draft') {
          return conflictError(reply, 'LOCKED',
            `This F&F settlement is ${(current as any).status} and can no longer be edited.`)
        }
        return conflictError(reply, ErrorCode.VERSION_CONFLICT,
          'This F&F settlement was changed by someone else. Reload and try again.')
      }
      result = data
      statusCode = 200
    } else {
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .insert({
          ...ffFields,
          employee_id:   req.params.id,
          tenant_id:     req.tenantId,
          separation_id: separation.id,
          status:        'draft',
          computed_by:   req.userId,
        })
        .select()
        .single()
      if (error)
        return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create F&F settlement')
      result = data
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_ff_summary',
      recordId:    result.id,
      action:      existing ? 'UPDATE' : 'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.code(statusCode).send({ data: result })
  })

  // ── POST /employees/:id/separation-ff/compute ────────────────────────────
  // Auto-calculate the formula-driven settlement components (gratuity, leave
  // encashment, notice shortfall) and upsert them onto the F&F draft. HR can
  // still override any value via POST /separation-ff afterwards.
  fastify.post('/employees/:id/separation-ff/compute', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const separation = await getSeparationRecord(fastify, req.params.id, req.tenantId)
    if (!separation)
      return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record found. Initiate separation first.' })

    const breakdown = await computeFnfSettlement(fastify.supabase, req.tenantId, req.params.id)
    if ('error' in breakdown)
      return reply.code(409).send({ error: 'COMPUTE_FAILED', message: breakdown.error })

    // Preserve any manual last_payroll_amount / other +/- already entered.
    const { data: existing } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, status, last_payroll_amount, other_additions, other_deductions')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    // Same freeze as POST /separation-ff above — recomputing an approved or
    // paid settlement would silently overwrite the figures that were
    // actually reviewed and signed off.
    if (existing && (existing as any).status !== 'draft') {
      return conflictError(reply, 'LOCKED',
        `This F&F settlement is ${(existing as any).status} and can no longer be recomputed.`)
    }

    const payload = {
      last_payroll_amount:     existing?.last_payroll_amount ?? 0,
      leave_encashment_amount: breakdown.leave_encashment_amount,
      gratuity_amount:         breakdown.gratuity_amount,
      notice_period_deduction: breakdown.notice_period_deduction,
      other_additions:         existing?.other_additions ?? 0,
      other_deductions:        existing?.other_deductions ?? 0,
      asset_recovery_amount:   breakdown.asset_recovery_amount,
      loan_recovery_amount:    breakdown.loan_recovery_amount,
      advance_recovery_amount: breakdown.advance_recovery_amount,
      // computed metadata
      gratuity_eligible:       breakdown.gratuity_eligible,
      gratuity_years:          breakdown.gratuity_years,
      leave_encashment_days:   breakdown.leave_encashment_days,
      leave_encashment_rate:   breakdown.leave_encashment_rate,
      leave_encashment_basis:  breakdown.leave_encashment_basis,
      notice_shortfall_days:   breakdown.notice_shortfall_days,
      salary_basis_basic:      breakdown.salary_basis_basic,
      salary_basis_gross:      breakdown.salary_basis_gross,
      computed_at:             new Date().toISOString(),
      computed_by:             req.userId,
      updated_by:              req.userId,
      updated_at:              new Date().toISOString(),
    }

    let result: any
    if (existing) {
      // Same TOCTOU fix as POST /separation-ff — the LOCKED check above is a
      // prior read, not an enforcement; fold the precondition into the
      // UPDATE's own WHERE clause so a concurrent approve landing in
      // between can't still let this recompute through.
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .update(payload).eq('id', existing.id).eq('tenant_id', req.tenantId).eq('status', 'draft')
        .select().maybeSingle()
      if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update computed F&F settlement')
      if (!data) {
        return conflictError(reply, 'LOCKED',
          'This F&F settlement was approved or paid while this recompute was in flight and can no longer be recomputed.')
      }
      result = data
    } else {
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .insert({ ...payload, employee_id: req.params.id, tenant_id: req.tenantId, separation_id: separation.id, status: 'draft', computed_by: req.userId })
        .select().single()
      if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create computed F&F settlement')
      result = data
    }

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'separation_ff_summary', recordId: result.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { computed: true, ...breakdown } as Record<string, unknown>,
    })

    return reply.send({ data: result, breakdown })
  })

  // ── PATCH /employees/:id/separation-ff/approve ────────────────────────────

  fastify.patch('/employees/:id/separation-ff/approve', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data: ff, error: fetchErr } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, status, version, computed_at, salary_basis_gross, salary_basis_basic, gratuity_amount, leave_encashment_amount, notice_period_deduction, asset_recovery_amount, loan_recovery_amount, advance_recovery_amount')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr)
      return serverError(req, reply, fetchErr, ErrorCode.QUERY_FAILED, 'Failed to fetch F&F record')
    if (!ff)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'F&F record not found' })
    if (ff.status === 'approved' || ff.status === 'paid')
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Cannot approve: current status is '${ff.status}'` })

    // G03: approval must not lock in a STALE calculation. If this record was
    // last computed via POST /compute (computed_at is set — a pure manual
    // entry via POST /separation-ff, never computed, has computed_at=null
    // and is HR's own responsibility, not something to "recompute"),
    // re-run the SAME computation now and compare EVERY material output
    // against what's stored — not just the salary basis. computeFnfSettlement
    // is a pure function of (separation dates/override/waiver, employment
    // category, gratuity_config, the last finalized slip, leave policy +
    // balance, outstanding assets, loan balances, pending advance recovery
    // schedules); comparing its full set of derived amounts is equivalent to
    // comparing all of those inputs, without having to special-case each one.
    // A correction to a finalized slip, a later finalized run, a leave-
    // balance adjustment, a notice-date/override/waiver edit, a gratuity-
    // config change, an asset return, a loan part-payment, or an advance
    // recovery schedule update between compute and approve would otherwise
    // approve a card the employee/HR never actually reviewed the current
    // numbers for — the exact "approving stale F&F calculations" gap the
    // original audit finding described, which filtering the salary-basis
    // query for status='finalized' alone does not close by itself. The
    // asset/loan/advance recovery amounts are exactly as time-sensitive as
    // the original five fields: an asset returned, a loan part-paid, or an
    // advance recovery schedule updated between compute and approve must
    // block approval the same way a corrected payroll slip does.
    if (ff.computed_at) {
      const fresh = await computeFnfSettlement(fastify.supabase, req.tenantId, req.params.id)
      if ('error' in fresh) {
        return reply.code(409).send({ error: 'RECOMPUTE_FAILED', message: `Cannot verify this settlement is still current: ${fresh.error}. Resolve the issue and recompute before approving.` })
      }
      const diff = (a: number | null | undefined, b: number | null | undefined) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) > 0.01
      const changedFields: Record<string, { stored: number; current: number }> = {}
      if (diff(fresh.salary_basis_gross, ff.salary_basis_gross))
        changedFields.salary_basis_gross = { stored: Number(ff.salary_basis_gross ?? 0), current: fresh.salary_basis_gross }
      if (diff(fresh.salary_basis_basic, ff.salary_basis_basic))
        changedFields.salary_basis_basic = { stored: Number(ff.salary_basis_basic ?? 0), current: fresh.salary_basis_basic }
      if (diff(fresh.gratuity_amount, (ff as any).gratuity_amount))
        changedFields.gratuity_amount = { stored: Number((ff as any).gratuity_amount ?? 0), current: fresh.gratuity_amount }
      if (diff(fresh.leave_encashment_amount, (ff as any).leave_encashment_amount))
        changedFields.leave_encashment_amount = { stored: Number((ff as any).leave_encashment_amount ?? 0), current: fresh.leave_encashment_amount }
      if (diff(fresh.notice_period_deduction, (ff as any).notice_period_deduction))
        changedFields.notice_period_deduction = { stored: Number((ff as any).notice_period_deduction ?? 0), current: fresh.notice_period_deduction }
      if (diff(fresh.asset_recovery_amount, (ff as any).asset_recovery_amount))
        changedFields.asset_recovery_amount = { stored: Number((ff as any).asset_recovery_amount ?? 0), current: fresh.asset_recovery_amount }
      if (diff(fresh.loan_recovery_amount, (ff as any).loan_recovery_amount))
        changedFields.loan_recovery_amount = { stored: Number((ff as any).loan_recovery_amount ?? 0), current: fresh.loan_recovery_amount }
      if (diff(fresh.advance_recovery_amount, (ff as any).advance_recovery_amount))
        changedFields.advance_recovery_amount = { stored: Number((ff as any).advance_recovery_amount ?? 0), current: fresh.advance_recovery_amount }

      if (Object.keys(changedFields).length > 0) {
        return reply.code(409).send({
          error:   'STALE_CALCULATION',
          message: 'The settlement inputs have changed since this was last computed (e.g. a corrected or newly finalized payroll slip, a leave-balance adjustment, a notice/gratuity change, an asset return, a loan part-payment, or an advance recovery update). Recompute via POST /separation-ff/compute and review the updated figures before approving.',
          changed_fields: changedFields,
        })
      }
    }

    // Fold the 'draft' precondition into the WHERE clause — the earlier
    // SELECT is a separate query, so two concurrent approve requests could
    // both pass it before either writes, mirroring the fix already applied
    // to /separation/approve, /advance, /relieve, /archive in this file.
    //
    // That alone is not enough: status='draft' only rules out a concurrent
    // APPROVE, not a concurrent EDIT. Without also binding to the exact
    // version just validated above, a concurrent POST /compute or
    // POST /separation-ff landing between the staleness check and this
    // UPDATE would change the stored amounts while status stays 'draft' —
    // this UPDATE would still match, flip status to 'approved', and commit
    // whatever the row NOW holds, which the staleness check never actually
    // saw. (POST /compute and POST /separation-ff now refuse to touch a
    // non-draft row, but both are still allowed to write while status is
    // 'draft' — exactly the window this closes.) version is bumped by
    // trg_separation_ff_summary_version on every UPDATE (migration 430), so
    // requiring it to still equal what we just read is equivalent to
    // requiring the row to be byte-for-byte what the staleness check
    // validated.
    const { data, error } = await fastify.supabase
      .from('separation_ff_summary')
      .update({
        status:      'approved',
        approved_by: req.userId,
        approved_at: new Date().toISOString(),
        updated_by:  req.userId,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', ff.id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'draft')
      .eq('version', (ff as any).version)
      .select()
      .maybeSingle()

    if (error)
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve F&F settlement')
    if (!data) {
      // Disambiguate why the CAS failed: already decided by someone else,
      // vs. edited/recomputed while still draft (version drift) — the
      // latter needs a different message since recompute-and-review is the
      // actual remedy, not "someone already approved this."
      const { data: current } = await fastify.supabase
        .from('separation_ff_summary')
        .select('status')
        .eq('id', ff.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (current && (current as any).status !== 'draft') {
        return reply.code(409).send({ error: 'ALREADY_DECIDED', message: 'This F&F settlement has already been approved or paid' })
      }
      return conflictError(reply, ErrorCode.VERSION_CONFLICT,
        'This F&F settlement was edited or recomputed while this approval was in flight. Reload and review the current figures before approving.')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_ff_summary',
      recordId:    ff.id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { status: 'approved' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation-ff/mark-paid ─────────────────────────

  fastify.patch('/employees/:id/separation-ff/mark-paid', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Status flip + loan foreclosure + advance recovery (schedules + ledger
    // + parent-request status) all happen inside mark_fnf_paid_atomic
    // (migration 445, extended by 448) as ONE transaction — not a sequence
    // of independent PostgREST round-trips. It FOR UPDATE-locks the
    // settlement row and every source loan/advance/asset row up front (so a
    // concurrent payroll run blocks on them rather than racing this), then
    // validates current loan/advance/asset totals against what was actually
    // approved before writing anything — a partial repayment or asset
    // return landing between approve and mark-paid aborts the whole call
    // (nothing half-applied) instead of silently paying out a different
    // recovery than what HR reviewed.
    //
    // Migration 448 closes a further gap: the compute→approve window
    // already re-validates leave_encashment_amount via the staleness check
    // in PATCH .../approve above, but nothing previously re-checked it
    // again in the approve→mark-paid window. mark_fnf_paid_atomic now also
    // FOR UPDATE-locks and re-sums employee_leave_balance for the exact
    // (leave_type_id, year) rows captured at compute time
    // (leave_encashment_basis) and aborts with SOURCE_DRIFT if a concurrent
    // standalone leave-encashment approval changed the balance since this
    // settlement was approved — the same pattern as the loan/advance/asset
    // checks, closing the last window where F&F and standalone encashment
    // could otherwise both pay out against the same leave days.
    const { data: rpcData, error: rpcErr } = await fastify.supabase.rpc('mark_fnf_paid_atomic', {
      p_tenant_id:   req.tenantId,
      p_employee_id: req.params.id,
      p_user_id:     req.userId,
    })

    if (rpcErr) {
      const msg = rpcErr.message ?? ''
      if (msg.includes('NOT_FOUND:'))
        return reply.code(404).send({ error: 'NOT_FOUND', message: msg.replace(/^.*NOT_FOUND:\s*/, '') })
      if (msg.includes('INVALID_STATE:'))
        return reply.code(409).send({ error: 'INVALID_STATE', message: msg.replace(/^.*INVALID_STATE:\s*/, '') })
      if (msg.includes('ALREADY_DECIDED:'))
        return reply.code(409).send({ error: 'ALREADY_DECIDED', message: msg.replace(/^.*ALREADY_DECIDED:\s*/, '') })
      if (msg.includes('SOURCE_DRIFT:'))
        return reply.code(409).send({ error: 'SOURCE_DRIFT', message: msg.replace(/^.*SOURCE_DRIFT:\s*/, '') })
      if (msg.includes('LEAVE_BASIS_MISSING:'))
        return reply.code(409).send({ error: 'LEAVE_BASIS_MISSING', message: msg.replace(/^.*LEAVE_BASIS_MISSING:\s*/, '') })
      return serverError(req, reply, rpcErr, ErrorCode.UPDATE_FAILED, 'Failed to mark F&F settlement as paid')
    }

    const { data: ffRow, error: reloadErr } = await fastify.supabase
      .from('separation_ff_summary')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (reloadErr)
      return serverError(req, reply, reloadErr, ErrorCode.QUERY_FAILED, 'Marked as paid, but failed to reload the settlement')

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_ff_summary',
      recordId:    (rpcData as any)?.id ?? ffRow?.id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { status: 'paid' },
    })

    return reply.send({ data: ffRow })
  })

  // ── PATCH /employees/:id/separation-ff/reopen ─────────────────────────────
  // Sends an 'approved' settlement back to 'draft' so HR can recompute/edit
  // and re-approve — the only way out when mark-paid's SOURCE_DRIFT check
  // (migration 445) blocks payment because a source loan/advance/asset
  // balance changed since approval. Deliberately NOT available from 'paid'
  // (money has already moved; that needs a real reversal process, not this).
  fastify.patch('/employees/:id/separation-ff/reopen', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data: ff, error: fetchErr } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, status')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (fetchErr)
      return serverError(req, reply, fetchErr, ErrorCode.QUERY_FAILED, 'Failed to fetch F&F record')
    if (!ff)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'F&F record not found' })
    if (ff.status !== 'approved')
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Only an approved settlement can be reopened (current: '${ff.status}')` })

    const { data, error } = await fastify.supabase
      .from('separation_ff_summary')
      .update({
        status:      'draft',
        approved_by: null,
        approved_at: null,
        updated_by:  req.userId,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', ff.id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'approved')
      .select()
      .maybeSingle()
    if (error)
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reopen F&F settlement')
    if (!data)
      return reply.code(409).send({ error: 'ALREADY_DECIDED', message: 'This F&F settlement is no longer approved' })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'separation_ff_summary', recordId: ff.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { status: 'draft', reopened: true },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/approve ───────────────────────────────

  fastify.patch('/employees/:id/separation/approve', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    const parsed = approveSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const now = new Date().toISOString()

    // Fold the 'pending' precondition into the WHERE clause on both branches —
    // without it, a re-invocation (double-click, retried request) after the
    // separation has already been approved/rejected and even advanced further
    // through the lifecycle unconditionally overwrites approval_status and,
    // on the approve branch, force-resets lifecycle_stage back to
    // 'notice_period' regardless of how far clearance/F&F progress has moved.
    if (parsed.data.decision === 'rejected') {
      const { data, error } = await fastify.supabase
        .from('employee_separation')
        .update({ approval_status: 'rejected', remarks: parsed.data.remarks ?? sep.remarks ?? null, updated_at: now })
        .eq('id', sep.id)
        .eq('tenant_id', req.tenantId)
        .eq('approval_status', 'pending')
        .select()
        .maybeSingle()
      if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject separation')
      if (!data) return reply.code(409).send({ error: 'ALREADY_DECIDED', message: 'This separation has already been approved or rejected' })

      await logAction(fastify.supabase, {
        tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
        action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
        newData: { approval_status: 'rejected' },
      })
      return reply.send({ data })
    }

    // approved
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({
        approval_status: 'approved',
        approved_by:     req.userId,
        approved_at:     now,
        lifecycle_stage: 'notice_period',
        updated_at:      now,
      })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .eq('approval_status', 'pending')
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve separation')
    if (!data) return reply.code(409).send({ error: 'ALREADY_DECIDED', message: 'This separation has already been approved or rejected' })

    const { error: statusErr } = await fastify.supabase
      .from('employees')
      .update({ status: 'on_notice' })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (statusErr) fastify.log.error({ err: statusErr, employeeId: req.params.id }, 'separation/approve: failed to set employee status to on_notice')

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { approval_status: 'approved', lifecycle_stage: 'notice_period' },
    })

    eventBus.emit({
      type: 'separation.approved', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, approvedBy: req.userId },
    })
    eventBus.emit({
      type: 'separation.stage.changed', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, fromStage: 'initiated', toStage: 'notice_period' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/advance ───────────────────────────────

  fastify.patch('/employees/:id/separation/advance', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    const parsed = advanceSchema.safeParse(req.body ?? {})
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const fromStage = sep.lifecycle_stage as string
    const idx = STAGE_SEQUENCE.indexOf(fromStage as any)
    if (idx === -1 || idx >= STAGE_SEQUENCE.length - 1)
      return reply.code(409).send({ error: 'INVALID_STAGE', message: `Cannot advance from stage '${fromStage}'` })

    const nextStage = STAGE_SEQUENCE[idx + 1]
    if (parsed.data.to && parsed.data.to !== nextStage)
      return reply.code(409).send({ error: 'INVALID_TARGET', message: `Next valid stage is '${nextStage}', not '${parsed.data.to}'` })

    // Fold the fromStage precondition into the UPDATE's own WHERE clause —
    // without it, two concurrent /advance calls (double-click, retried
    // request) both pass the earlier SELECT-based check and both apply,
    // silently skipping a stage or double-emitting stage-changed events.
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({ lifecycle_stage: nextStage, updated_at: new Date().toISOString() })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .eq('lifecycle_stage', fromStage)
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to advance separation stage')
    if (!data) return reply.code(409).send({ error: 'STAGE_CHANGED', message: 'Separation stage has already changed since this was loaded' })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { lifecycle_stage: nextStage },
    })

    eventBus.emit({
      type: 'separation.stage.changed', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, fromStage, toStage: nextStage },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/relieve ───────────────────────────────

  fastify.patch('/employees/:id/separation/relieve', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    if (!sep.clearance_done)
      return reply.code(409).send({ error: 'CLEARANCE_PENDING', message: 'Cannot relieve: clearance is not complete' })

    const { data: ff } = await fastify.supabase
      .from('separation_ff_summary')
      .select('status')
      .eq('separation_id', sep.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!ff || ff.status !== 'paid')
      return reply.code(409).send({ error: 'FNF_NOT_PAID', message: 'Cannot relieve: F&F settlement must be marked as paid' })

    const fromStage = sep.lifecycle_stage as string
    const now = new Date().toISOString()
    const lastWorkingDate = sep.last_working_date ?? now.slice(0, 10)

    // Fold the fromStage precondition into the UPDATE's own WHERE clause —
    // two concurrent /relieve calls would otherwise both pass the earlier
    // clearance/F&F checks and both apply, duplicating the auth-revocation
    // call and the emitted 'separation.relieved' event.
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({
        lifecycle_stage:   'relieved',
        relieved_at:       now,
        last_working_date: lastWorkingDate,
        updated_at:        now,
      })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .eq('lifecycle_stage', fromStage)
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to relieve employee')
    if (!data) return reply.code(409).send({ error: 'STAGE_CHANGED', message: 'Separation stage has already changed since this was loaded' })

    const { error: statusErr } = await fastify.supabase
      .from('employees')
      .update({ status: 'separated' })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (statusErr) fastify.log.error({ err: statusErr, employeeId: req.params.id }, 'separation/relieve: failed to set employee status to separated')

    // AF-001: revoke auth access on final separation.
    const revoked = await revokeEmployeeAuth(fastify.supabase, req.params.id, req.tenantId, fastify.log)
    if (!revoked) fastify.log.error({ employeeId: req.params.id, tenantId: req.tenantId }, 'separation/relieve: auth revocation did not fully succeed — employee may retain live access')

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { lifecycle_stage: 'relieved', relieved_at: now },
    })

    eventBus.emit({
      type: 'separation.relieved', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, lastWorkingDate },
    })
    eventBus.emit({
      type: 'separation.stage.changed', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, fromStage, toStage: 'relieved' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/archive ───────────────────────────────

  fastify.patch('/employees/:id/separation/archive', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    if (sep.lifecycle_stage !== 'relieved')
      return reply.code(409).send({ error: 'NOT_RELIEVED', message: 'Cannot archive: employee must be relieved first' })

    const now = new Date().toISOString()

    // Fold the 'relieved' precondition into the UPDATE's own WHERE clause —
    // two concurrent /archive calls would otherwise both pass the earlier
    // check and both apply, double-emitting 'separation.archived'.
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({ lifecycle_stage: 'archived', archived_at: now, archived_by: req.userId, updated_at: now })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .eq('lifecycle_stage', 'relieved')
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to archive separation')
    if (!data) return reply.code(409).send({ error: 'STAGE_CHANGED', message: 'Separation stage has already changed since this was loaded' })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { lifecycle_stage: 'archived', archived_at: now },
    })

    eventBus.emit({
      type: 'separation.archived', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id },
    })

    return reply.send({ data })
  })

  // ── Gratuity configuration (per tenant) ───────────────────────────────────

  const GRATUITY_DEFAULTS = { enabled: true, rate_numerator: 15, rate_denominator: 26, min_years: 5, max_amount: 2000000, basis: 'basic' as const }

  // GET /settlement/gratuity-config — current config (defaults if unconfigured)
  fastify.get('/settlement/gratuity-config', hrAdminAuth, async (req: any, reply) => {
    const { data } = await fastify.supabase
      .from('gratuity_config')
      .select('enabled, rate_numerator, rate_denominator, min_years, max_amount, basis, updated_at, version')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    return reply.send({ data: data ?? { ...GRATUITY_DEFAULTS, is_default: true } })
  })

  // PUT /settlement/gratuity-config — insert-or-update with CAS.
  // Rewritten from .upsert() (PEND-105 follow-up wave) — Supabase's upsert
  // can't express a WHERE clause on its ON CONFLICT DO UPDATE branch, so an
  // optimistic-concurrency check needs an explicit select-then-branch here
  // instead, matching the pattern used for the other upsert-based CAS
  // endpoints earlier in this project (personal-info.ts, bank-statutory.ts).
  fastify.put('/settlement/gratuity-config', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      enabled:          z.boolean().default(true),
      rate_numerator:   z.number().int().min(1).max(60),
      rate_denominator: z.number().int().min(1).max(31),
      min_years:        z.number().min(0).max(20),
      max_amount:       z.number().min(0).max(100000000),
      basis:            z.enum(['basic', 'gross']),
      // optional — a tenant configuring gratuity for the first time has no
      // prior version to compare against.
      expected_version: z.number().int().positive().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { expected_version, ...configFields } = parsed.data

    const { data: existing } = await fastify.supabase
      .from('gratuity_config')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    let data: any, error: any

    if (existing) {
      let updateQuery = fastify.supabase
        .from('gratuity_config')
        .update({ ...configFields, updated_at: new Date().toISOString(), updated_by: req.userId })
        .eq('id', existing.id)
        .eq('tenant_id', req.tenantId)
      if (expected_version !== undefined)
        updateQuery = updateQuery.eq('version', expected_version)

      const res = await updateQuery.select().maybeSingle()
      data = res.data
      error = res.error
      if (!error && !data) {
        if (expected_version !== undefined) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This gratuity configuration was changed by someone else. Reload and try again.')
        }
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Gratuity configuration not found' })
      }
    } else {
      const res = await fastify.supabase
        .from('gratuity_config')
        .insert({ tenant_id: req.tenantId, ...configFields, updated_at: new Date().toISOString(), updated_by: req.userId })
        .select()
        .single()
      data = res.data
      error = res.error
      // A concurrent first-time save for this tenant may have inserted the
      // row first — fall back to an update instead of surfacing a spurious
      // unique-violation to the caller.
      if (error?.code === '23505') {
        const retry = await fastify.supabase
          .from('gratuity_config')
          .update({ ...configFields, updated_at: new Date().toISOString(), updated_by: req.userId })
          .eq('tenant_id', req.tenantId)
          .select()
          .maybeSingle()
        data = retry.data
        error = retry.error
      }
    }

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save gratuity configuration')

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'gratuity_config', recordId: (data as any).id,
      action: 'UPDATE', performedBy: req.userId, newData: configFields as Record<string, unknown>,
    })

    return reply.send({ data })
  })

  // ── Configurable clearance departments ─────────────────────────────────────
  fastify.get('/settlement/clearance-departments', hrAdminAuth, async (req: any, reply) => {
    return reply.send({ data: await getClearanceDepts(fastify, req.tenantId) })
  })

  fastify.post('/settlement/clearance-departments', hrAdminAuth, async (req: any, reply) => {
    const parsed = z.object({ code: z.string().min(1).max(40), label: z.string().min(1).max(80), display_order: z.number().int().optional() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const code = parsed.data.code.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    const { data, error } = await fastify.supabase
      .from('clearance_departments')
      .insert({ tenant_id: req.tenantId, code, label: parsed.data.label, display_order: parsed.data.display_order ?? 99 })
      .select().single()
    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A department with this code already exists' })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create clearance department')
    }
    return reply.code(201).send({ data })
  })

  fastify.patch('/settlement/clearance-departments/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = z.object({
      label:             z.string().min(1).max(80).optional(),
      is_active:         z.boolean().optional(),
      display_order:     z.number().int().optional(),
      expected_version:  z.number().int().positive().optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { expected_version, ...deptFields } = parsed.data

    let updateQuery = fastify.supabase
      .from('clearance_departments')
      .update(deptFields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (expected_version !== undefined)
      updateQuery = updateQuery.eq('version', expected_version)

    // .maybeSingle() — not .single() — so a 0-row match (deleted, or a
    // stale expected_version) returns { data: null } instead of throwing.
    const { data, error } = await updateQuery.select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update clearance department')
    if (!data) {
      if (expected_version !== undefined) {
        const { data: stillExists } = await fastify.supabase
          .from('clearance_departments')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (stillExists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This clearance department was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Department not found' })
    }
    return reply.send({ data })
  })

  fastify.delete('/settlement/clearance-departments/:id', hrAdminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('clearance_departments').delete().eq('id', req.params.id).eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete clearance department')
    return reply.code(204).send()
  })
}
