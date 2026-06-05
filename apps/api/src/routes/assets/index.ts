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

  // ── GET /assets — list with optional filters ──────────────────────────────
  fastify.get('/assets', auth, async (req: any, reply) => {
    const { status, category_id, search } = req.query as {
      status?: string; category_id?: string; search?: string
    }

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
      const s = `%${search}%`
      q = q.or(`asset_code.ilike.${s},name.ilike.${s},serial_number.ilike.${s}`)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = (data ?? []).map((a: any) => ({
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
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
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
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
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

    const { error } = await fastify.supabase
      .from('assets')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

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
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await fastify.supabase.from('employee_asset_ledger').insert({
      tenant_id:       req.tenantId,
      asset_id:        id,
      employee_id:     parsed.data.employee_id,
      action:          'assigned',
      condition_notes: parsed.data.notes ?? null,
      performed_by:    req.userId,
    })

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
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    if (employeeId) {
      await fastify.supabase.from('employee_asset_ledger').insert({
        tenant_id:       req.tenantId,
        asset_id:        id,
        employee_id:     employeeId,
        action:          parsed.data.condition,
        condition_notes: parsed.data.notes ?? null,
        performed_by:    req.userId,
      })
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

    // Resilient: a missing assets/asset_categories relationship on a drifted DB
    // must not break the whole profile — degrade to an empty list instead of 500.
    const { data: assigned, error: aErr } = await fastify.supabase
      .from('assets')
      .select('id, asset_code, name, serial_number, status, category_id, asset_categories ( name )')
      .eq('tenant_id', req.tenantId)
      .eq('assigned_to', id)
      .eq('status', 'assigned')
      .order('asset_code')
    if (aErr) req.log.warn({ err: aErr, employeeId: id }, 'assets list query failed — returning empty')

    const { data: history, error: hErr } = await fastify.supabase
      .from('employee_asset_ledger')
      .select('id, asset_id, action, action_date, condition_notes, created_at, assets ( asset_code, name )')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', id)
      .order('created_at', { ascending: false })
    if (hErr) req.log.warn({ err: hErr, employeeId: id }, 'asset ledger query failed — returning empty')

    return reply.send({
      data: {
        assigned: (assigned ?? []).map((a: any) => ({
          ...a, category_name: a.asset_categories?.name ?? null, asset_categories: undefined,
        })),
        history: (history ?? []).map((h: any) => ({
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
    const { count, error } = await fastify.supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('assigned_to', id)
      .eq('status', 'assigned')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: { count: count ?? 0 } })
  })
}
