/**
 * Asset Management — /assets
 *
 * Asset master + assign/return lifecycle backed by an immutable movement ledger
 * (employee_asset_ledger). assets.assigned_to is a denormalized pointer to the
 * current holder for quick lookups; the ledger is the authoritative log.
 *
 * Categories come from the existing asset_categories master (not duplicated).
 * Every mutation is tenant-scoped, audited (logAction) and replay-safe (eventBus).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { eventBus } from '../../lib/event-bus.js'
import { sanitizeOrFilterTerm } from '../../lib/postgrest-filter.js'
import { resolveCallerEmployeeId, isHrAdmin, isDirectReport } from '../../lib/manager-scope.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

// ── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  asset_code:    z.string().min(1, 'Asset code is required').max(80).transform(v => v.trim()),
  category_id:   z.string().uuid().optional().nullable(),
  name:          z.string().min(1, 'Name is required').max(160).transform(v => v.trim()),
  serial_number: z.string().max(160).optional().nullable(),
  purchase_date: z.string().optional().nullable(),
  purchase_cost: z.number().min(0).optional().nullable(),
  notes:         z.string().max(1000).optional().nullable(),
})

const updateSchema = createSchema.partial()

const assignSchema = z.object({
  employee_id: z.string().uuid(),
  notes:       z.string().max(1000).optional().nullable(),
})

const returnSchema = z.object({
  condition: z.enum(['returned', 'damaged', 'lost']),
  notes:     z.string().max(1000).optional().nullable(),
})

// ── Route Plugin ───────────────────────────────────────────────────────────────

export default async function assetsRoutes(fastify: FastifyInstance) {
  const auth         = { preHandler: [fastify.authenticate] }
  const hrAdminAuth  = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  const empName = (e: any) =>
    e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : null

  // Fresh audit finding: category_id was accepted straight from the request
  // body with no tenant check on POST/PUT /assets and POST /ess/me/asset-
  // requests. fastify.supabase runs with the service-role key (bypasses
  // RLS), so a cross-tenant category_id would insert/update successfully —
  // permanently cross-linking a record to another tenant's master-data row,
  // and leaking that tenant's category name back via the asset_categories(name)
  // FK-embed on every subsequent list read. Mirrors the same "verify FK
  // belongs to your tenant" check already applied in reimbursements.ts and
  // recruitment/index.ts for the identical category_id pattern.
  async function validateCategoryId(categoryId: string | null | undefined, tenantId: string): Promise<{ error: unknown } | { notFound: true } | null> {
    if (!categoryId) return null
    const { data, error } = await fastify.supabase
      .from('asset_categories').select('id').eq('id', categoryId).eq('tenant_id', tenantId).maybeSingle()
    if (error) return { error }
    if (!data) return { notFound: true }
    return null
  }

  // ── GET /assets — list with optional filters ──────────────────────────────
  fastify.get('/assets', auth, async (req: any, reply) => {
    const { status, category_id, search } = req.query as {
      status?: string; category_id?: string; search?: string
    }

    let data: any[]
    try {
      data = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('assets')
          .select(`
            id, asset_code, category_id, name, serial_number, purchase_date,
            purchase_cost, status, assigned_to, notes, created_at, updated_at,
            asset_categories ( name ),
            employees:assigned_to ( id, first_name, last_name, employee_code )
          `)
          .eq('tenant_id', req.tenantId)
          .order('created_at', { ascending: false })
        if (status)      q = q.eq('status', status)
        if (category_id) q = q.eq('category_id', category_id)
        if (search) {
          const s = `%${sanitizeOrFilterTerm(search)}%`
          q = q.or(`asset_code.ilike.${s},name.ilike.${s},serial_number.ilike.${s}`)
        }
        return q.range(from, to)
      })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch assets')
    }

    const rows = data.map((a: any) => ({
      ...a,
      category_name:       a.asset_categories?.name ?? null,
      assigned_to_name:    empName(a.employees),
      assigned_to_code:    a.employees?.employee_code ?? null,
      asset_categories:    undefined,
      employees:           undefined,
    }))

    return reply.send({ data: rows })
  })

  // ── POST /assets — create ──────────────────────────────────────────────────
  fastify.post('/assets', hrAdminAuth, async (req: any, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const catErr = await validateCategoryId(parsed.data.category_id, req.tenantId)
    if (catErr) {
      if ('error' in catErr) return serverError(req, reply, catErr.error, ErrorCode.QUERY_FAILED, 'Failed to validate category')
      return reply.code(400).send({ error: 'INVALID_REFERENCE', message: 'category_id not found in your organisation' })
    }

    const { data, error } = await fastify.supabase
      .from('assets')
      .insert({
        ...parsed.data,
        tenant_id:  req.tenantId,
        status:     'available',
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `Asset code "${parsed.data.asset_code}" already exists` })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create asset')
    }

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'assets', recordId: data.id,
      action: 'INSERT', performedBy: req.userId, newData: parsed.data as Record<string, unknown>,
    })

    return reply.code(201).send({ data })
  })

  // ── PUT /assets/:id — update editable fields ───────────────────────────────
  fastify.put('/assets/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const catErr = await validateCategoryId(parsed.data.category_id, req.tenantId)
    if (catErr) {
      if ('error' in catErr) return serverError(req, reply, catErr.error, ErrorCode.QUERY_FAILED, 'Failed to validate category')
      return reply.code(400).send({ error: 'INVALID_REFERENCE', message: 'category_id not found in your organisation' })
    }

    const { data, error } = await fastify.supabase
      .from('assets')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'Asset code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update asset')
    }
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Asset not found' })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'assets', recordId: data.id,
      action: 'UPDATE', performedBy: req.userId, newData: parsed.data as Record<string, unknown>,
    })

    return reply.send({ data })
  })

  // ── DELETE /assets/:id — only if not assigned ──────────────────────────────
  fastify.delete('/assets/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: asset } = await fastify.supabase
      .from('assets')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!asset) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Asset not found' })
    if (asset.status === 'assigned')
      return reply.code(409).send({ error: 'ASSET_ASSIGNED', message: 'Cannot delete an asset that is currently assigned. Return it first.' })

    // Fresh audit finding: TOCTOU — the status check above and this DELETE
    // are separate round-trips with no re-verification. A concurrent
    // POST /assets/:id/assign between them would flip status to 'assigned'
    // and this delete would still proceed, cascade-deleting the asset's
    // entire employee_asset_ledger history (ON DELETE CASCADE) including
    // the just-created assignment — leaving the employee holding a
    // physical asset that no longer exists anywhere in the system, with no
    // audit trail. Folding the status into the WHERE clause makes the
    // delete a no-op (0 rows affected) if it was assigned in the interim.
    const { data: deleted, error } = await fastify.supabase
      .from('assets')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .neq('status', 'assigned')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete asset')
    if (!deleted) {
      return reply.code(409).send({ error: 'ASSET_ASSIGNED', message: 'Cannot delete an asset that is currently assigned. Return it first.' })
    }

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'assets', recordId: id,
      action: 'DELETE', performedBy: req.userId,
    })

    return reply.send({ data: { deleted: true } })
  })

  // ── POST /assets/:id/assign ────────────────────────────────────────────────
  fastify.post('/assets/:id/assign', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = assignSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data: asset } = await fastify.supabase
      .from('assets')
      .select('id, status, asset_code')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!asset) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Asset not found' })
    if (asset.status !== 'available')
      return reply.code(409).send({ error: 'NOT_AVAILABLE', message: `Asset is '${asset.status}' — only available assets can be assigned.` })

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', parsed.data.employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('assets')
      .update({ status: 'assigned', assigned_to: parsed.data.employee_id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'available')
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to assign asset')
    if (!data) return reply.code(409).send({ error: 'NOT_AVAILABLE', message: 'Asset was assigned by another request — refresh and try again.' })

    const { error: ledgerErr } = await fastify.supabase.from('employee_asset_ledger').insert({
      tenant_id:       req.tenantId,
      asset_id:        id,
      employee_id:     parsed.data.employee_id,
      action:          'assigned',
      condition_notes: parsed.data.notes ?? null,
      performed_by:    req.userId,
    })
    if (ledgerErr) req.log.warn({ err: ledgerErr, assetId: id }, 'assets/assign: failed to write asset ledger entry')

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'assets', recordId: id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: parsed.data.employee_id,
      newData: { status: 'assigned', assigned_to: parsed.data.employee_id },
    })

    eventBus.emit({
      type: 'asset.assigned', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, assetId: id, employeeId: parsed.data.employee_id, assetCode: asset.asset_code },
    })

    return reply.send({ data })
  })

  // ── POST /assets/:id/return ────────────────────────────────────────────────
  fastify.post('/assets/:id/return', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = returnSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data: asset } = await fastify.supabase
      .from('assets')
      .select('id, status, assigned_to')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!asset) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Asset not found' })
    if (asset.status !== 'assigned')
      return reply.code(409).send({ error: 'NOT_ASSIGNED', message: 'Only an assigned asset can be returned.' })

    const newStatus =
      parsed.data.condition === 'returned' ? 'available'
      : parsed.data.condition === 'damaged' ? 'damaged'
      : 'lost'
    const employeeId = asset.assigned_to as string

    const { data, error } = await fastify.supabase
      .from('assets')
      .update({ status: newStatus, assigned_to: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'assigned')
      .select()
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to return asset')
    if (!data) return reply.code(409).send({ error: 'NOT_ASSIGNED', message: 'Asset was already returned by another request — refresh and try again.' })

    if (employeeId) {
      const { error: ledgerErr } = await fastify.supabase.from('employee_asset_ledger').insert({
        tenant_id:       req.tenantId,
        asset_id:        id,
        employee_id:     employeeId,
        action:          parsed.data.condition,
        condition_notes: parsed.data.notes ?? null,
        performed_by:    req.userId,
      })
      if (ledgerErr) req.log.warn({ err: ledgerErr, assetId: id }, 'assets/return: failed to write asset ledger entry')
    }

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'assets', recordId: id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: employeeId ?? null,
      newData: { status: newStatus, assigned_to: null, condition: parsed.data.condition },
    })

    eventBus.emit({
      type: 'asset.returned', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, assetId: id, employeeId: employeeId ?? '', condition: parsed.data.condition },
    })

    return reply.send({ data })
  })

  // ── GET /employees/:id/assets — assigned + ledger history ──────────────────
  fastify.get('/employees/:id/assets', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Any authenticated employee could previously view any coworker's
    // assigned-asset list and full ledger history (including condition_notes
    // — e.g. why an asset was marked damaged/lost) just by guessing a UUID.
    // Restrict to self, direct manager, or HR admin, matching the pattern in
    // attendance/fetch.ts.
    if (!isHrAdmin(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      const isSelf = !!callerEmpId && callerEmpId === id
      const isManagerOfTarget = !isSelf && !!callerEmpId
        && await isDirectReport(fastify.supabase, req.tenantId, callerEmpId, id)
      if (!isSelf && !isManagerOfTarget) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own or your team’s assets' })
      }
    }

    // Resilient: a missing assets/asset_categories relationship on a drifted DB
    // must not break the whole profile — degrade to an empty list instead of 500.
    const assigned = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('assets')
        .select('id, asset_code, name, serial_number, status, category_id, asset_categories ( name )')
        .eq('tenant_id', req.tenantId)
        .eq('assigned_to', id)
        .eq('status', 'assigned')
        .order('asset_code')
        .range(from, to)
    ).catch((err: unknown) => {
      req.log.warn({ err, employeeId: id }, 'assets list query failed — returning empty')
      return [] as any[]
    })

    const history = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('employee_asset_ledger')
        .select('id, asset_id, action, action_date, condition_notes, created_at, assets ( asset_code, name )')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', id)
        .order('created_at', { ascending: false })
        .range(from, to)
    ).catch((err: unknown) => {
      req.log.warn({ err, employeeId: id }, 'asset ledger query failed — returning empty')
      return [] as any[]
    })

    return reply.send({
      data: {
        assigned: assigned.map((a: any) => ({
          ...a, category_name: a.asset_categories?.name ?? null, asset_categories: undefined,
        })),
        history: history.map((h: any) => ({
          ...h,
          asset_code: h.assets?.asset_code ?? null,
          asset_name: h.assets?.name ?? null,
          assets:     undefined,
        })),
      },
    })
  })

  // ── GET /employees/:id/assets/outstanding-count ────────────────────────────
  fastify.get('/employees/:id/assets/outstanding-count', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    if (!isHrAdmin(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      const isSelf = !!callerEmpId && callerEmpId === id
      const isManagerOfTarget = !isSelf && !!callerEmpId
        && await isDirectReport(fastify.supabase, req.tenantId, callerEmpId, id)
      if (!isSelf && !isManagerOfTarget) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own or your team’s assets' })
      }
    }

    const { count, error } = await fastify.supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('assigned_to', id)
      .eq('status', 'assigned')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch outstanding asset count')
    return reply.send({ data: { count: count ?? 0 } })
  })

  // ── Asset requests (ESS request → HR approve → allocate) ───────────────────
  const requestSchema = z.object({
    category_id: z.string().uuid().optional().nullable(),
    item_name:   z.string().max(160).optional().nullable(),
    reason:      z.string().max(1000).optional().nullable(),
  })

  // ESS: create a request
  fastify.post('/ess/me/asset-requests', auth, async (req: any, reply) => {
    const empId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE', message: 'Profile not linked to an employee record' })
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    if (!parsed.data.category_id && !parsed.data.item_name) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Pick a category or describe the item' })
    }
    const catErr = await validateCategoryId(parsed.data.category_id, req.tenantId)
    if (catErr) {
      if ('error' in catErr) return serverError(req, reply, catErr.error, ErrorCode.QUERY_FAILED, 'Failed to validate category')
      return reply.code(400).send({ error: 'INVALID_REFERENCE', message: 'category_id not found in your organisation' })
    }
    const { data, error } = await fastify.supabase
      .from('asset_requests')
      .insert({ tenant_id: req.tenantId, employee_id: empId, ...parsed.data, status: 'pending' })
      .select().single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create asset request')
    return reply.code(201).send({ data })
  })

  // ESS: list own requests
  fastify.get('/ess/me/asset-requests', auth, async (req: any, reply) => {
    const empId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    if (!empId) return reply.send({ data: [] })
    try {
      const data = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('asset_requests')
          .select('*, asset_categories(name)')
          .eq('tenant_id', req.tenantId).eq('employee_id', empId)
          .order('requested_at', { ascending: false })
          .range(from, to)
      )
      return reply.send({ data: data.map((r: any) => ({ ...r, category_name: r.asset_categories?.name ?? null, asset_categories: undefined })) })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch asset requests')
    }
  })

  // HR: list all requests
  fastify.get('/asset-requests', hrAdminAuth, async (req: any, reply) => {
    const status = (req.query as any)?.status as string | undefined
    try {
      const data = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('asset_requests')
          .select('*, asset_categories(name), employees(first_name, last_name, employee_code)')
          .eq('tenant_id', req.tenantId).order('requested_at', { ascending: false })
        if (status && status !== 'all') q = q.eq('status', status)
        return q.range(from, to)
      })
      return reply.send({ data: data.map((r: any) => ({
        ...r,
        category_name:  r.asset_categories?.name ?? null,
        employee_name:  empName(r.employees),
        employee_code:  r.employees?.employee_code ?? null,
        asset_categories: undefined, employees: undefined,
      })) })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch asset requests')
    }
  })

  // HR: approve / reject
  fastify.patch('/asset-requests/:id/decide', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ decision: z.enum(['approved', 'rejected']), remarks: z.string().max(1000).optional().nullable() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    const { data, error } = await fastify.supabase
      .from('asset_requests')
      .update({ status: parsed.data.decision, decision_remarks: parsed.data.remarks ?? null, decided_by: req.userId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', req.tenantId).eq('status', 'pending').select().single()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to decide asset request')
    if (!data) return reply.code(409).send({ error: 'NOT_PENDING', message: 'Request not found or already decided' })
    return reply.send({ data })
  })

  // HR: fulfill an approved request by allocating an available asset
  fastify.post('/asset-requests/:id/fulfill', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ asset_id: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data: reqRow } = await fastify.supabase
      .from('asset_requests').select('id, employee_id, status').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!reqRow) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Request not found' })
    if (reqRow.status !== 'approved') return reply.code(409).send({ error: 'NOT_APPROVED', message: 'Only approved requests can be fulfilled' })

    const { data: asset } = await fastify.supabase
      .from('assets').select('id, status, asset_code').eq('id', parsed.data.asset_id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!asset) return reply.code(404).send({ error: 'ASSET_NOT_FOUND', message: 'Asset not found' })
    if (asset.status !== 'available') return reply.code(409).send({ error: 'NOT_AVAILABLE', message: `Asset is '${asset.status}'.` })

    // Assign the asset (mirror /assets/:id/assign) + log the movement.
    // Fold the availability check into the UPDATE itself so two concurrent
    // fulfill requests targeting the same asset can't both "win" the race.
    const { data: assigned } = await fastify.supabase.from('assets')
      .update({ status: 'assigned', assigned_to: reqRow.employee_id, updated_at: new Date().toISOString() })
      .eq('id', asset.id).eq('tenant_id', req.tenantId).eq('status', 'available')
      .select().maybeSingle()
    if (!assigned) return reply.code(409).send({ error: 'NOT_AVAILABLE', message: 'Asset was just assigned by another request.' })
    await fastify.supabase.from('employee_asset_ledger').insert({
      tenant_id: req.tenantId, asset_id: asset.id, employee_id: reqRow.employee_id,
      action: 'assigned', condition_notes: 'Fulfilled asset request', performed_by: req.userId,
    })
    eventBus.emit({
      type: 'asset.assigned', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, assetId: asset.id, employeeId: reqRow.employee_id, assetCode: asset.asset_code },
    })

    // Fold the 'approved' precondition into this UPDATE too — otherwise two
    // concurrent fulfill calls (each assigning a different available asset,
    // both passing the earlier read-check) would both succeed here, leaving
    // the employee assigned two physical assets for one request with only
    // one traceable via fulfilled_asset_id.
    const { data, error } = await fastify.supabase
      .from('asset_requests')
      .update({ status: 'fulfilled', fulfilled_asset_id: asset.id, updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', req.tenantId).eq('status', 'approved').select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to fulfill asset request')
    if (!data) return reply.code(409).send({ error: 'ALREADY_FULFILLED', message: 'Request was already fulfilled by another request' })
    return reply.send({ data })
  })
}
