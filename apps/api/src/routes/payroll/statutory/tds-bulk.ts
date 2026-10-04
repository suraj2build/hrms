/**
 * TDS Bulk Operations + Reconciliation Routes
 *
 * Mount prefix: /payroll/statutory/tds
 *
 * Bulk proof/declaration operations (admin-only):
 *   POST /proofs/bulk-verify
 *   POST /proofs/bulk-reject
 *   POST /proofs/bulk-request-revision
 *   POST /declarations/bulk-lock
 *
 * Reconciliation (admin-only):
 *   GET  /reconciliation
 *   POST /reconciliation/compute
 *   PATCH /reconciliation/:id
 *
 * ESS completion (any authenticated user):
 *   GET  /declarations/completion/my
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../../lib/rbac.js'
import { fetchAllRows } from '../../../lib/supabase-paginate.js'
import { fetchTenantTz } from '../../../lib/attendance-engine.js'
import { getLocalDate } from '../../../lib/org-context.js'
import { serverError, ErrorCode } from '../../../lib/api-errors.js'

/** Rows per .in() call — keeps the request URL well under server/proxy
 *  request-line limits. The request-body schemas here allow up to 500
 *  UUIDs, which builds a ~18.5 KB request URL if sent in a single .in() —
 *  confirmed to fail in production above ~400 UUIDs (~14.8 KB). */
const BULK_ID_CHUNK = 100

/**
 * Runs an .in('id', chunk)-scoped update across all of `ids`, chunked to stay
 * under request-line limits, and returns the ids that were actually updated
 * (mirrors the shape each handler below already expects from a single call).
 */
async function chunkedUpdateByIds(
  supabase: any,
  ids: string[],
  applyUpdate: (chunk: string[]) => PromiseLike<{ data: Array<{ id: string }> | null; error: unknown }>,
): Promise<{ updatedIds: string[]; error: unknown }> {
  const updatedIds: string[] = []
  for (let i = 0; i < ids.length; i += BULK_ID_CHUNK) {
    const { data, error } = await applyUpdate(ids.slice(i, i + BULK_ID_CHUNK))
    if (error) return { updatedIds, error }
    if (data) updatedIds.push(...data.map((r) => r.id))
  }
  return { updatedIds, error: null }
}

// Source document_states a proof must be in for each bulk transition below.
// declaration_proofs_document_state_check (migration 177) allows 9 states —
// without this guard the bulk endpoints matched proofs purely by id, so a
// proof already 'verified', 'rejected', 'superseded', 'payroll_locked', or
// 'archived' could be silently forced back into 'verified'/'rejected'/
// 'revision_requested', overwriting a terminal or payroll-locked state.
const VERIFIABLE_STATES  = ['uploaded', 'under_review']
const REJECTABLE_STATES  = ['uploaded', 'under_review']
const REVISABLE_STATES   = ['uploaded', 'under_review']

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentFinancialYear(): string {
  const now = new Date()
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${fyYear}-${String(fyYear + 1).slice(2)}`
}

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

async function logBulkOperation(
  fastify: FastifyInstance,
  tenantId: string,
  actorId: string,
  operationType: string,
  affectedIds: string[],
  reason?: string,
  financialYear?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await fastify.supabase
    .from('tds_bulk_operation_log')
    .insert({
      tenant_id:      tenantId,
      operation_type: operationType,
      actor_id:       actorId,
      affected_ids:   affectedIds,
      affected_count: affectedIds.length,
      reason:         reason ?? null,
      financial_year: financialYear ?? null,
      metadata:       metadata ?? {},
    })
}

/**
 * chunkedUpdateByIds stops at the first failing chunk and returns whatever
 * updated successfully before it. Without this, callers discarded that
 * partial success entirely: the audit-trail insert (logBulkOperation) never
 * ran for the ids that DID get updated, and the client received a bare 500
 * with no indication some records were already mutated (verified/rejected/
 * locked) in the DB.
 */
async function respondPartialBulkFailure(
  fastify: FastifyInstance,
  req: any,
  reply: any,
  error: unknown,
  updatedIds: string[],
  requestedIds: string[],
  operationType: string,
  reason: string | undefined,
  financialYear: string | undefined,
): Promise<any> {
  if (updatedIds.length > 0) {
    await logBulkOperation(
      fastify, req.tenantId, req.userId, operationType, updatedIds, reason, financialYear,
      { requested_ids: requestedIds, partial_failure: true },
    )
  }
  return serverError(
    req, reply, error, ErrorCode.UPDATE_FAILED,
    `Bulk operation stopped after updating ${updatedIds.length} of ${requestedIds.length} record(s); the completed portion has been saved and logged`,
  )
}

// =============================================================================
export default async function tdsBulkRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ===========================================================================
  // Bulk Proof Operations
  // ===========================================================================

  // POST /payroll/statutory/tds/proofs/bulk-verify
  fastify.post('/proofs/bulk-verify', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      proof_ids: z.array(z.string().uuid()).min(1).max(500),
      notes:     z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { proof_ids, notes } = parsed.data
    const now = new Date().toISOString()

    const { updatedIds, error } = await chunkedUpdateByIds(fastify.supabase, proof_ids, (chunk) =>
      fastify.supabase
        .from('declaration_proofs')
        .update({
          document_state:     'verified',
          is_verified:        true,
          verified_by:        req.userId,
          verified_at:        now,
          verification_notes: notes ?? null,
          updated_at:         now,
        })
        .in('id', chunk)
        .eq('tenant_id', req.tenantId)
        .in('document_state', VERIFIABLE_STATES)
        .select('id'),
    )

    if (error) return respondPartialBulkFailure(fastify, req, reply, error, updatedIds, proof_ids, 'bulk_verify', notes, undefined)

    const failed = proof_ids.filter(id => !updatedIds.includes(id))

    await logBulkOperation(
      fastify,
      req.tenantId,
      req.userId,
      'bulk_verify',
      updatedIds,
      notes,
      undefined,
      { requested_ids: proof_ids },
    )

    return reply.send({ updated: updatedIds.length, failed })
  })

  // POST /payroll/statutory/tds/proofs/bulk-reject
  fastify.post('/proofs/bulk-reject', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      proof_ids:        z.array(z.string().uuid()).min(1).max(500),
      rejection_reason: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { proof_ids, rejection_reason } = parsed.data
    const now = new Date().toISOString()

    const { updatedIds, error } = await chunkedUpdateByIds(fastify.supabase, proof_ids, (chunk) =>
      fastify.supabase
        .from('declaration_proofs')
        .update({
          document_state:   'rejected',
          is_verified:      false,
          rejection_reason,
          updated_at:       now,
        })
        .in('id', chunk)
        .eq('tenant_id', req.tenantId)
        .in('document_state', REJECTABLE_STATES)
        .select('id'),
    )

    if (error) return respondPartialBulkFailure(fastify, req, reply, error, updatedIds, proof_ids, 'bulk_reject', rejection_reason, undefined)

    const failed = proof_ids.filter(id => !updatedIds.includes(id))

    await logBulkOperation(
      fastify,
      req.tenantId,
      req.userId,
      'bulk_reject',
      updatedIds,
      rejection_reason,
      undefined,
      { requested_ids: proof_ids },
    )

    return reply.send({ updated: updatedIds.length, failed })
  })

  // POST /payroll/statutory/tds/proofs/bulk-request-revision
  fastify.post('/proofs/bulk-request-revision', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      proof_ids:       z.array(z.string().uuid()).min(1).max(500),
      revision_reason: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { proof_ids, revision_reason } = parsed.data
    const now = new Date().toISOString()

    const { updatedIds, error } = await chunkedUpdateByIds(fastify.supabase, proof_ids, (chunk) =>
      fastify.supabase
        .from('declaration_proofs')
        .update({
          document_state:  'revision_requested',
          revision_reason,
          updated_at:      now,
        })
        .in('id', chunk)
        .eq('tenant_id', req.tenantId)
        .in('document_state', REVISABLE_STATES)
        .select('id'),
    )

    if (error) return respondPartialBulkFailure(fastify, req, reply, error, updatedIds, proof_ids, 'bulk_request_revision', revision_reason, undefined)

    const failed = proof_ids.filter(id => !updatedIds.includes(id))

    await logBulkOperation(
      fastify,
      req.tenantId,
      req.userId,
      'bulk_request_revision',
      updatedIds,
      revision_reason,
      undefined,
      { requested_ids: proof_ids },
    )

    return reply.send({ updated: updatedIds.length, failed })
  })

  // ===========================================================================
  // Bulk Declaration Lock
  // ===========================================================================

  // POST /payroll/statutory/tds/declarations/bulk-lock
  fastify.post('/declarations/bulk-lock', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      declaration_ids: z.array(z.string().uuid()).min(1).max(500),
      financial_year:  z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { declaration_ids, financial_year } = parsed.data
    const now = new Date().toISOString()

    // Only lock declarations in approved or payroll_applied status
    const lockableStatuses = ['approved', 'payroll_applied']

    const { updatedIds, error } = await chunkedUpdateByIds(fastify.supabase, declaration_ids, (chunk) =>
      fastify.supabase
        .from('tax_declarations')
        .update({
          status:                   'locked',
          payroll_locked_at:        now,
          locked_by_payroll_run_id: null,
          updated_at:               now,
        })
        .in('id', chunk)
        .in('status', lockableStatuses)
        .eq('tenant_id', req.tenantId)
        .select('id'),
    )

    if (error) return respondPartialBulkFailure(fastify, req, reply, error, updatedIds, declaration_ids, 'bulk_lock', undefined, financial_year)

    const skipped = declaration_ids.filter(id => !updatedIds.includes(id))

    await logBulkOperation(
      fastify,
      req.tenantId,
      req.userId,
      'bulk_lock',
      updatedIds,
      undefined,
      financial_year,
      { requested_ids: declaration_ids, skipped },
    )

    return reply.send({ updated: updatedIds.length, skipped })
  })

  // ===========================================================================
  // Reconciliation endpoints
  // ===========================================================================

  // GET /payroll/statutory/tds/reconciliation
  fastify.get('/reconciliation', adminAuth, async (req: any, reply) => {
    const qsSchema = z.object({
      financial_year:        z.string().optional(),
      risk_flag:             z.string().optional(),
      reconciliation_status: z.string().optional(),
      employee_id:           z.string().uuid().optional(),
      limit:                 z.coerce.number().int().min(1).max(200).default(50),
      offset:                z.coerce.number().int().min(0).default(0),
    })
    const qs = qsSchema.safeParse(req.query)
    if (!qs.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })
    }

    const { financial_year, risk_flag, reconciliation_status, employee_id, limit, offset } = qs.data

    let q = fastify.supabase
      .from('tax_projection_reconciliation')
      .select(`
        *,
        employees!inner (
          id,
          employee_code,
          profiles!profile_id (full_name)
        )
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('computed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (financial_year)        q = q.eq('financial_year', financial_year)
    if (risk_flag)             q = q.eq('risk_flag', risk_flag)
    if (reconciliation_status) q = q.eq('reconciliation_status', reconciliation_status)
    if (employee_id)           q = q.eq('employee_id', employee_id)

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch TDS reconciliation records')

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // POST /payroll/statutory/tds/reconciliation/compute
  fastify.post('/reconciliation/compute', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      financial_year: z.string().min(1),
      employee_ids:   z.array(z.string().uuid()).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { financial_year, employee_ids } = parsed.data

    // Fetch employees in scope. When employee_ids is provided it's chunked
    // (unbounded array from the caller — a single .in() over thousands of
    // UUIDs would exceed request-line limits); when omitted, the full-tenant
    // read is paginated the same way the rest of the payroll surface is.
    let employees: Array<{ id: string }>
    let empErr: unknown = null
    try {
      if (employee_ids && employee_ids.length > 0) {
        const EMP_ID_CHUNK = 100
        employees = []
        for (let i = 0; i < employee_ids.length; i += EMP_ID_CHUNK) {
          const { data, error } = await fastify.supabase
            .from('employees')
            .select('id')
            .eq('tenant_id', req.tenantId)
            .in('id', employee_ids.slice(i, i + EMP_ID_CHUNK))
          if (error) throw error
          if (data) employees.push(...data)
        }
      } else {
        employees = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('employees')
            .select('id')
            .eq('tenant_id', req.tenantId)
            .order('id')
            .range(from, to),
        )
      }
    } catch (err) {
      employees = []
      empErr = err
    }
    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to fetch employees for reconciliation')
    if (!employees || employees.length === 0) {
      return reply.send({ computed: 0, high_variance: 0 })
    }

    const empIds = (employees as any[]).map((e: any) => e.id as string)

    // Fetch latest projected_tax from tds_declaration_snapshots per employee.
    // Chunked: empIds can now be the tenant's full headcount (the fetch above
    // is no longer silently capped), so a single .in() would exceed request-
    // line limits at enterprise scale. Each chunk is ALSO paginated with
    // fetchAllRows: the UNIQUE(tenant_id, employee_id, financial_year,
    // payroll_run_id) constraint allows one snapshot per payroll run, so a
    // 100-employee chunk on a monthly-payroll tenant can return up to ~1200
    // rows in one FY — past PostgREST's 1000-row cap, which would silently
    // drop some employees' latest snapshot (and default them to projected=0).
    let snapshots: any[]
    try {
      snapshots = []
      for (let i = 0; i < empIds.length; i += 100) {
        const chunkIds = empIds.slice(i, i + 100)
        const chunkRows = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('tds_declaration_snapshots')
            .select('employee_id, total_approved, created_at')
            .in('employee_id', chunkIds)
            .eq('tenant_id', req.tenantId)
            .eq('financial_year', financial_year)
            .order('created_at', { ascending: false })
            .range(from, to),
        )
        snapshots.push(...chunkRows)
      }
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch TDS declaration snapshots')
    }

    // Build map: employee_id -> latest snapshot
    const snapshotMap = new Map<string, number>()
    for (const snap of snapshots as any[]) {
      if (!snapshotMap.has(snap.employee_id)) {
        snapshotMap.set(snap.employee_id, snap.total_approved ?? 0)
      }
    }

    // Fetch actual TDS from payroll_slips for the FY (sum tds_deducted)
    // financial_year like '2025-26' → Apr 2025 – Mar 2026
    const fyStartYear = parseInt(financial_year.split('-')[0], 10)
    const fyStart = `${fyStartYear}-04-01`
    const fyEnd   = `${fyStartYear + 1}-03-31`

    // Same cap risk as the snapshots fetch above: a 100-employee chunk times
    // up to 12 monthly slips in the FY can exceed 1000 rows, so each chunk is
    // paginated with fetchAllRows rather than taken as a single page.
    let slips: any[]
    try {
      slips = []
      for (let i = 0; i < empIds.length; i += 100) {
        const chunkIds = empIds.slice(i, i + 100)
        const chunkRows = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('payroll_slips')
            .select('employee_id, tds_deducted')
            .in('employee_id', chunkIds)
            .eq('tenant_id', req.tenantId)
            // payroll_slips has no pay_date; its `month` is 'YYYY-MM' — scope to the FY months
            .gte('month', fyStart.slice(0, 7))
            .lte('month', fyEnd.slice(0, 7))
            .range(from, to),
        )
        slips.push(...chunkRows)
      }
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll slips for TDS reconciliation')
    }

    // Build map: employee_id -> sum actual TDS. tds_deducted is DECIMAL — coerce or an
    // employee with 2+ slips in the FY corrupts this into NaN, failing the
    // tax_projection_reconciliation.actual_tax NOT NULL upsert (G13 sweep).
    const actualTdsMap = new Map<string, number>()
    for (const slip of slips as any[]) {
      const prev = actualTdsMap.get(slip.employee_id) ?? 0
      actualTdsMap.set(slip.employee_id, prev + Number(slip.tds_deducted ?? 0))
    }

    const now = new Date().toISOString()
    let computed = 0
    let highVariance = 0
    const upsertRows: any[] = []

    for (const empId of empIds) {
      const projected = snapshotMap.get(empId) ?? 0
      const actual    = actualTdsMap.get(empId) ?? 0

      // Detect risk flag
      let riskFlag: string | null = null
      if (projected > 0 && actual < 0) {
        riskFlag = 'negative_recovery'
      } else if (projected > 0 && actual > projected * 1.1) {
        riskFlag = 'over_deduction'
      } else if (projected > 0 && actual < projected * 0.9) {
        riskFlag = 'under_deduction'
      }

      const isHighVariance = riskFlag !== null
      if (isHighVariance) highVariance++

      const reconciliationStatus = riskFlag ? 'pending' : 'matched'

      upsertRows.push({
        tenant_id:             req.tenantId,
        employee_id:           empId,
        financial_year,
        period_month:          null,
        projected_tax:         projected,
        actual_tax:            actual,
        variance_reason:       riskFlag ? [riskFlag] : [],
        reconciliation_status: reconciliationStatus,
        risk_flag:             riskFlag,
        payroll_run_id:        null,
        computed_at:           now,
        updated_at:            now,
      })
    }

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('tax_projection_reconciliation')
        .upsert(upsertRows, {
          onConflict: 'tenant_id,employee_id,financial_year,period_month,payroll_run_id',
        })

      if (upsertErr) return serverError(req, reply, upsertErr, ErrorCode.UPDATE_FAILED, 'Failed to save tax projection reconciliation')
      computed = upsertRows.length
    }

    return reply.send({ computed, high_variance: highVariance })
  })

  // PATCH /payroll/statutory/tds/reconciliation/:id
  fastify.patch('/reconciliation/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      reconciliation_status: z.enum(['pending', 'matched', 'variance_reviewed', 'adjusted']),
      notes:                 z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('tax_projection_reconciliation')
      .update({
        reconciliation_status: parsed.data.reconciliation_status,
        notes:                 parsed.data.notes ?? null,
        reviewed_by:           req.userId,
        reviewed_at:           now,
        updated_at:            now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update reconciliation record')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Reconciliation record not found' })

    return reply.send({ data })
  })

  // ===========================================================================
  // ESS Completion
  // ===========================================================================

  // GET /payroll/statutory/tds/declarations/completion/my?financial_year=2025-26
  fastify.get('/declarations/completion/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const qsSchema = z.object({
      financial_year: z.string().optional(),
    })
    const qs = qsSchema.safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    // Fetch regime
    const { data: regimeData } = await fastify.supabase
      .from('tax_regime_elections')
      .select('regime')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const regime: string = (regimeData as any)?.regime ?? 'new'

    // Fetch all declarations for this employee/FY
    const { data: declarations } = await fastify.supabase
      .from('tax_declarations')
      .select('id, status, declared_amount, approved_amount')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)

    const declList = (declarations ?? []) as any[]

    // declared_amount is DECIMAL — coerce or 2+ declarations corrupt this into NaN (G13 sweep).
    const totalDeclaredAmount = declList.reduce(
      (sum: number, d: any) => sum + Number(d.declared_amount ?? 0), 0
    )

    // Check lock statuses
    const isDeclarationLocked = declList.some(
      (d: any) => d.status === 'locked'
    )
    const isPayrollLocked = declList.some(
      (d: any) => d.status === 'payroll_applied'
    )

    // Fetch active components requiring proof for the matching regime
    const { data: components } = await fastify.supabase
      .from('tax_declaration_components')
      .select('id, section_code, regime_eligibility, proof_required')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .eq('proof_required', true)
      .or(`regime_eligibility.eq.both,regime_eligibility.eq.${regime}`)

    const componentList = (components ?? []) as any[]
    const totalComponents = componentList.length

    // Count approved/payroll_applied declarations as "declared"
    const declaredComponents = declList.filter(
      (d: any) => ['approved', 'payroll_applied'].includes(d.status)
    ).length

    const completionPct = totalComponents > 0
      ? Math.round((declaredComponents / totalComponents) * 100)
      : 0

    // Pending proofs
    const { count: pendingProofsCount } = await fastify.supabase
      .from('declaration_proofs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .in('declaration_id', declList.map((d: any) => d.id))
      .in('document_state', ['uploaded', 'under_review'])

    // Rejected proofs
    const { count: rejectedProofsCount } = await fastify.supabase
      .from('declaration_proofs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .in('declaration_id', declList.map((d: any) => d.id))
      .eq('document_state', 'rejected')

    // Monthly TDS recovery — from tds_monthly_projections (current month).
    // Tenant-local, not server UTC (see tds.ts recompute endpoint for the
    // same fix) — a UTC month would look up the wrong projection row near
    // IST midnight.
    const tzForMonth   = await fetchTenantTz(fastify.supabase, req.tenantId)
    const currentMonth = getLocalDate(new Date().toISOString(), tzForMonth).slice(0, 7)
    const { data: projRow } = await fastify.supabase
      .from('tds_monthly_projections')
      .select('tds_this_month')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .eq('projection_month', currentMonth)
      .maybeSingle()

    const monthlyTdsRecovery: number = Number((projRow as any)?.tds_this_month ?? 0)

    // Potential tax saving (rough: sum of approved amounts * marginal rate 30%).
    // approved_amount/declared_amount are DECIMAL — coerce or 2+ declarations corrupt
    // this into NaN, silently zeroing out potential_tax_saving (G13 sweep).
    const totalApprovedAmount = declList.reduce(
      (sum: number, d: any) => sum + Number(d.approved_amount ?? d.declared_amount ?? 0), 0
    )
    const potentialTaxSaving = Math.round(totalApprovedAmount * 0.3)

    // Fetch deadline from tds_governance_settings (window_close_date)
    const { data: govSettings } = await fastify.supabase
      .from('tds_governance_settings')
      .select('window_close_date')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const deadline: string = (govSettings as any)?.window_close_date ?? '2026-01-31'

    return reply.send({
      financial_year:        fy,
      regime,
      completion_pct:        completionPct,
      total_components:      totalComponents,
      declared_components:   declaredComponents,
      pending_proofs:        pendingProofsCount ?? 0,
      rejected_proofs:       rejectedProofsCount ?? 0,
      total_declared_amount: totalDeclaredAmount,
      potential_tax_saving:  potentialTaxSaving,
      deadline,
      is_declaration_locked: isDeclarationLocked,
      is_payroll_locked:     isPayrollLocked,
      monthly_tds_recovery:  monthlyTdsRecovery,
    })
  })
}
