/**
 * Professional Tax Routes
 * State-wise slab management and contribution computation.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computePTax } from '../../../lib/statutory/ptax-engine.js'
import type { PTaxSlab } from '../../../lib/statutory/ptax-engine.js'
import { logAction } from '../../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../../lib/rbac.js'
import { fetchAllRows, fetchAllRowsByKeyset } from '../../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../../lib/api-errors.js'

export default async function ptaxRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── Static state catalogue (all Indian states / UTs that levy P-Tax) ──────────
  const PTAX_STATES: Record<string, string> = {
    AP: 'Andhra Pradesh',
    AS: 'Assam',
    BR: 'Bihar',
    CG: 'Chhattisgarh',
    GA: 'Goa',
    GJ: 'Gujarat',
    HR: 'Haryana',
    HP: 'Himachal Pradesh',
    JH: 'Jharkhand',
    KA: 'Karnataka',
    KL: 'Kerala',
    MP: 'Madhya Pradesh',
    MH: 'Maharashtra',
    MN: 'Manipur',
    ML: 'Meghalaya',
    MZ: 'Mizoram',
    NL: 'Nagaland',
    OR: 'Odisha',
    PB: 'Punjab',
    SK: 'Sikkim',
    TN: 'Tamil Nadu',
    TS: 'Telangana',
    TR: 'Tripura',
    WB: 'West Bengal',
  }

  // ── GET /payroll/statutory/ptax/states ────────────────────────────────────────
  // Returns all known P-Tax states with their enabled status for this tenant.
  // Enabled state is persisted in ptax_state_settings (migration 179).
  // Falls back to disabled if no settings row exists yet.
  fastify.get('/states', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data: settings, error } = await fastify.supabase
      .from('ptax_state_settings')
      .select('state_code, enabled, registration_number, registration_date')
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch P-Tax state settings')

    // Build a lookup map: state_code → settings row
    const settingsMap = new Map<string, { enabled: boolean; registration_number: string | null; registration_date: string | null }>()
    for (const s of (settings ?? []) as any[]) {
      settingsMap.set(s.state_code, {
        enabled:             s.enabled,
        registration_number: s.registration_number ?? null,
        registration_date:   s.registration_date   ?? null,
      })
    }

    const result = Object.entries(PTAX_STATES).map(([code, name]) => {
      const row = settingsMap.get(code)
      return {
        state_code:          code,
        state_name:          name,
        // Default to false for states never explicitly toggled
        enabled:             row?.enabled             ?? false,
        registration_number: row?.registration_number ?? null,
        registration_date:   row?.registration_date   ?? null,
      }
    })

    return reply.send(result)
  })

  // ── PUT /payroll/statutory/ptax/states/:stateCode ─────────────────────────────
  // Toggle a state on (enabled=true) or off (enabled=false).
  // Upserts a row in ptax_state_settings.
  fastify.put('/states/:stateCode', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { stateCode } = req.params as { stateCode: string }

    // Allow both known states and custom state codes (e.g. HR for Haryana, or any
    // UT/special zone). The name falls back to the code if not in the known list.
    const schema = z.object({
      enabled:             z.boolean().optional(),
      state_name:          z.string().optional(),   // custom name for unknown state codes
      registration_number: z.string().nullable().optional(),
      registration_date:   z.string().nullable().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Default enabled to true if not explicitly provided
    const isEnabled = parsed.data.enabled !== false && parsed.data.enabled !== undefined
      ? parsed.data.enabled
      : (parsed.data.enabled === false ? false : undefined)

    // Build upsert payload — only include defined fields
    const upsertPayload: Record<string, any> = {
      tenant_id:  req.tenantId,
      state_code: stateCode,
      updated_at: new Date().toISOString(),
      updated_by: req.userId,
    }

    if (parsed.data.enabled !== undefined) {
      upsertPayload.enabled = parsed.data.enabled
    }
    if (parsed.data.registration_number !== undefined) {
      upsertPayload.registration_number = parsed.data.registration_number
    }
    if (parsed.data.registration_date !== undefined) {
      upsertPayload.registration_date = parsed.data.registration_date
    }

    // If only registration fields are being updated (no enabled flag), we need
    // to preserve the existing enabled value via upsert without overwriting it.
    // If enabled was not passed, default to true for new rows only — existing rows
    // are updated in-place via ON CONFLICT DO UPDATE, so we read the current value first.
    if (parsed.data.enabled === undefined) {
      const { data: existing } = await fastify.supabase
        .from('ptax_state_settings')
        .select('enabled')
        .eq('tenant_id', req.tenantId)
        .eq('state_code', stateCode)
        .maybeSingle()
      upsertPayload.enabled = existing?.enabled ?? true
    }

    const { error } = await fastify.supabase
      .from('ptax_state_settings')
      .upsert(upsertPayload, { onConflict: 'tenant_id,state_code' })

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update P-Tax state settings')

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'ptax_state_settings',
      recordId:    stateCode,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send({
      state_code:          stateCode,
      state_name:          PTAX_STATES[stateCode] ?? parsed.data.state_name ?? stateCode,
      enabled:             upsertPayload.enabled,
      registration_number: upsertPayload.registration_number ?? null,
      registration_date:   upsertPayload.registration_date   ?? null,
    })
  })

  // ── GET /payroll/statutory/ptax/slabs ─────────────────────────────────────────
  fastify.get('/slabs', auth, async (req: any, reply) => {
    const querySchema = z.object({
      state_code: z.string().optional(),
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('ptax_slabs')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('state_code', { ascending: true })
      .order('monthly_income_from', { ascending: true })

    if (parsed.data.state_code) q = q.eq('state_code', parsed.data.state_code)
    if (parsed.data.financial_year) q = q.eq('financial_year', parsed.data.financial_year)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch P-Tax slabs')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/ptax/slabs ────────────────────────────────────────
  fastify.post('/slabs', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      state_code: z.string().min(1),
      financial_year: z.string().min(1),
      gender: z.enum(['male', 'female', 'other']).optional(),
      monthly_income_from: z.number(),
      // blank "to" = open-ended top band → null accepted (not just undefined).
      monthly_income_to: z.number().nullable().optional(),
      monthly_ptax: z.number(),
      annual_ptax: z.number().nullable().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('ptax_slabs')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_SLAB', message: 'A slab with these parameters already exists' })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create P-Tax slab')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'ptax_slabs',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.code(201).send({ data })
  })

  // ── DELETE /payroll/statutory/ptax/slabs/:id ──────────────────────────────────
  fastify.delete('/slabs/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: deleted, error } = await fastify.supabase
      .from('ptax_slabs')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete P-Tax slab')
    if (!deleted || deleted.length === 0) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Slab not found' })
    }
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'ptax_slabs',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
    })
    return reply.code(204).send()
  })

  // ── GET /payroll/statutory/ptax/state-config ──────────────────────────────────
  fastify.get('/state-config', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('ptax_state_config')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch P-Tax state config')
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /payroll/statutory/ptax/state-config/:employeeId ─────────────────────
  fastify.put('/state-config/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      state_code:      z.string().min(1),
      effective_from:  z.string().optional(),   // defaults to today if omitted
      effective_to:    z.string().optional(),
      override_reason: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const effectiveFrom = parsed.data.effective_from || new Date().toISOString().slice(0, 10)

    // employeeId is a raw URL param, never checked against this tenant before
    // being used to write a state-config row.
    const { data: emp } = await fastify.supabase
      .from('employees').select('id').eq('id', employeeId).eq('tenant_id', req.tenantId).maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found in your organisation' })

    // Delete existing open-ended rows first so there's only one active config.
    await fastify.supabase
      .from('ptax_state_config')
      .delete()
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .is('effective_to', null)

    const { data, error } = await fastify.supabase
      .from('ptax_state_config')
      .insert({
        state_code:      parsed.data.state_code,
        effective_from:  effectiveFrom,
        effective_to:    parsed.data.effective_to ?? null,
        override_reason: parsed.data.override_reason ?? 'Set from employee master',
        employee_id:     employeeId,
        tenant_id:       req.tenantId,
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to set employee P-Tax state')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'ptax_state_config',
      recordId:    (data as any)?.id ?? employeeId,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/ptax/contributions ─────────────────────────────────
  fastify.get('/contributions', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().optional(),
      employee_id: z.string().uuid().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // fetchAllRows(): a plain .select() with no .range() silently truncates at
    // PostgREST's 1,000-row ceiling for tenants with more than 1,000 P-Tax
    // contribution rows (SYSCERT_AUDIT_2026-08-02.md C6).
    let data: any[]
    try {
      data = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('ptax_contributions')
          .select('*')
          .eq('tenant_id', req.tenantId)
          .order('id')
        if (parsed.data.month) q = q.eq('contribution_month', parsed.data.month)
        if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
        return q.range(from, to)
      })
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch P-Tax contributions')
    }
    return reply.send({ data })
  })

  // ── POST /payroll/statutory/ptax/contributions/compute ───────────────────────
  fastify.post('/contributions/compute', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
      // Optional: when omitted, derive the Indian FY from the month. This lets the
      // on-finalize auto-compute and generic "compute filings" callers send just a
      // month — previously a missing financial_year hard-failed with 400 and PTax
      // silently never populated.
      financial_year: z.string().min(1).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { month } = parsed.data
    // Indian financial year (Apr–Mar): 2026-04 → "2026-27", 2026-03 → "2025-26".
    const financial_year = parsed.data.financial_year ?? (() => {
      const [y, m] = month.split('-').map(Number)
      const startY = m >= 4 ? y : y - 1
      return `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`
    })()
    const monthDate = `${month}-01`

    // Guard: statutory contributions must be computed from a FINALIZED payroll run.
    let payrollRunId: string | null = null
    {
      const { data: runRow } = await fastify.supabase
        .from('payroll_runs').select('id, status').eq('tenant_id', req.tenantId).eq('month', month).maybeSingle()
      const st = (runRow as any)?.status
      if (st !== 'finalized' && st !== 'partial_failed' && st !== 'frozen') {
        return reply.code(409).send({
          error: 'RUN_NOT_FINALIZED',
          message: `Finalize the ${month} payroll run before computing Professional Tax (current: ${st ?? 'no run'}).`,
        })
      }
      payrollRunId = (runRow as any)?.id ?? null
    }

    // Calendar month for frequency checks (1–12)
    const calendarMonth = parseInt(month.split('-')[1], 10)

    // Fetch active employees — raw select (no FK embed) to avoid Supabase 500s
    // when the sites FK constraint name differs from what PostgREST expects.
    // fetchAllRows() (not a plain .select()): tenants above 1,000 active
    // employees would otherwise silently get PTax computed for only the first
    // 1,000 (PostgREST's server-side max-rows ceiling).
    let empList: any[]
    try {
      empList = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, employee_code, site_id')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .order('id')
          .range(from, to),
      )
    } catch (empErr) {
      return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')
    }

    // Resolve site state_code separately to avoid the FK-embed failure.
    // Chunked: a retail-chain tenant can have 1,000+ sites (site_type/region/
    // zone are first-class dimensions elsewhere in this codebase), so a
    // single unchunked .in() risks PostgREST's silent 1,000-row cap.
    const siteIds = [...new Set(empList.map(e => e.site_id).filter(Boolean))] as string[]
    const siteStateMap = new Map<string, string>()
    const SITE_CHUNK = 100
    for (let i = 0; i < siteIds.length; i += SITE_CHUNK) {
      const { data: siteRows } = await fastify.supabase
        // lint-query-ok: chunked to SITE_CHUNK (100) ids per request above
        .from('sites')
        .select('id, state_code')
        .in('id', siteIds.slice(i, i + SITE_CHUNK))
        .eq('tenant_id', req.tenantId)
      for (const s of (siteRows ?? []) as any[]) {
        if (s.state_code) siteStateMap.set(s.id, s.state_code)
      }
    }

    // ── State resolution ───────────────────────────────────────────────────────
    // Priority: ptax_state_config (manual) > lwf_state_config (shared work state)
    //           > sites.state_code (auto). An employee works in one state, so the
    //           LWF state assignment also drives PT when PT's own isn't set.
    //
    // fetchAllRows() on both: neither table is deduplicated to "latest row
    // per employee" at the query level (the code below picks the first seen
    // per employee during iteration instead), so a plain, unpaginated read
    // is at least one row per employee and can be more for anyone with a
    // state-reassignment history. Found by actually running this endpoint
    // against 2,200 real employees (scripts/pagination-scale-check.sh):
    // 1,200 of them — everyone past the 1,000-row cap — came back with
    // state=null ("skipped_no_state"), silently excluding them from PTax
    // entirely with no error.
    const [stateConfigs, lwfStateConfigs] = await Promise.all([
      fetchAllRows<{ employee_id: string; state_code: string }>((from, to) =>
        fastify.supabase.from('ptax_state_config')
          .select('employee_id, state_code').eq('tenant_id', req.tenantId)
          .order('effective_from', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)),
      fetchAllRows<{ employee_id: string; state_code: string }>((from, to) =>
        fastify.supabase.from('lwf_state_config')
          .select('employee_id, state_code').eq('tenant_id', req.tenantId)
          .order('effective_from', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)),
    ])

    // Map employee_id → most recent manual state override (PT first, else LWF)
    const manualStateMap = new Map<string, string>()
    for (const cfg of (stateConfigs ?? []) as any[]) {
      if (!manualStateMap.has(cfg.employee_id) && cfg.state_code) manualStateMap.set(cfg.employee_id, cfg.state_code)
    }
    for (const cfg of (lwfStateConfigs ?? []) as any[]) {
      if (!manualStateMap.has(cfg.employee_id) && cfg.state_code) manualStateMap.set(cfg.employee_id, cfg.state_code)
    }

    // ── PTax exemptions ────────────────────────────────────────────────────────
    const { data: exemptRows } = await fastify.supabase
      .from('employee_statutory_overrides')
      .select('employee_id')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'ptax')
      .eq('is_exempt', true)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)

    const exemptSet = new Set<string>(((exemptRows ?? []) as any[]).map(r => r.employee_id))

    // ── Actual gross wages from finalized payroll slips (payroll-safe) ─────────
    // Gross = gross_pay from payroll_slips where status = finalized for this month.
    // For employees without a finalized slip, fall back to sum of all earning
    // components from their active compensation (pro-rated estimate).
    // fetchAllRowsByKeyset() — this is the authoritative PTax gross-wage
    // source (slipGrossMap); at ≥1,001 finalized slips in the month a plain
    // query would silently push the overflow onto the compensation fallback
    // below. Keyset, not offset: a concurrent finalize can insert a new slip
    // anywhere in the random-UUID key space while this read is paging,
    // which offset/.range() pagination would silently skip or duplicate
    // even with a deterministic .order('id') — see supabase-paginate.test.ts.
    const slipRows = await fetchAllRowsByKeyset((afterId, limit) => {
      let q = fastify.supabase
        .from('payroll_slips')
        .select('id, employee_id, gross_pay, component_breakdown')
        .eq('tenant_id', req.tenantId)
        .eq('month', month)
        .eq('status', 'finalized')
        .order('id', { ascending: true })
        .limit(limit)
      if (afterId) q = q.gt('id', afterId)
      return q
    })

    // gross_pay is NUMERIC — coerce here so slab lookups/comparisons downstream get a
    // real number, not a string (G13 sweep).
    const slipGrossMap = new Map<string, number>(
      (slipRows as any[]).map(r => [r.employee_id, Number(r.gross_pay ?? 0)]),
    )

    // Financial-chain reconciliation: unlike EPF/ESI just above (which both
    // take their employee-deduction amount straight from the finalized
    // slip's PF_EMPLOYEE/ESI_EMPLOYEE line — "slip is source of truth", so
    // the filing table can never diverge from the actual payslip), PTax here
    // only reused the slip's GROSS WAGES and then RECOMPUTED ptax_amount
    // fresh against whatever ptax_slabs/ptax_state_settings are configured
    // right now. If a tenant edits its PT slabs (or disables a state) any
    // time between finalizing payroll and running this compute step — two
    // separate actions, not atomic — the ptax_contributions row used for
    // filing/deposit would show a DIFFERENT amount than what the employee's
    // actual payslip deducted and net_pay reflects, exactly the "deposit
    // doesn't match the filing" class of bug EPF/ESI were already fixed
    // against. Mirror that fix: take the slip's own PTAX line when present.
    const slipPtaxMap = new Map<string, number>()
    for (const r of slipRows as any[]) {
      const breakdown = Array.isArray(r.component_breakdown) ? r.component_breakdown : []
      const ptaxLine = breakdown.find((c: any) => String(c?.code ?? '').toUpperCase() === 'PTAX')
      if (ptaxLine) slipPtaxMap.set(r.employee_id, Number(ptaxLine.monthly_amount ?? 0))
    }

    // Fallback: gross from active compensation components (earning type only)
    let fallbackGrossMap = new Map<string, number>()
    const empsMissingSlip = empList.filter(e => !slipGrossMap.has(e.id)).map(e => e.id)

    if (empsMissingSlip.length > 0) {
      // Chunked AND fetchAllRows-paginated — same request-size fix as the
      // identical pattern in esi.ts/epf.ts, found by actually running
      // against 2,200 real employees (scripts/pagination-scale-check.sh).
      const compRows: Array<{ id: string; employee_id: string }> = []
      for (let i = 0; i < empsMissingSlip.length; i += 100) {
        const chunkIds = empsMissingSlip.slice(i, i + 100)
        const chunkRows = await fetchAllRows<{ id: string; employee_id: string }>((from, to) =>
          fastify.supabase
            .from('employee_compensations')
            .select('id, employee_id')
            .eq('tenant_id', req.tenantId)
            .eq('is_active', true)
            .in('employee_id', chunkIds)
            .order('id')
            .range(from, to),
        )
        compRows.push(...chunkRows)
      }

      const compIdToEmpId = new Map<string, string>(
        compRows.map((c: any) => [c.id, c.employee_id]),
      )

      if (compRows.length > 0) {
        // Chunked AND fetchAllRows-paginated — same reasoning as the
        // identical pattern in epf.ts/esi.ts: the row-per-id multiplier here
        // is NOT 1 (several earning components per compensation), so even a
        // 100-id chunk can exceed a single unpaginated page.
        const compIds = (compRows as any[]).map(c => c.id)
        const compCompRows: any[] = []
        for (let i = 0; i < compIds.length; i += 100) {
          const chunkIds = compIds.slice(i, i + 100)
          const chunkRows = await fetchAllRows<any>((from, to) =>
            fastify.supabase
              .from('employee_compensation_components')
              .select('compensation_id, computed_monthly, salary_components!inner(component_type)')
              .in('compensation_id', chunkIds)
              .eq('salary_components.component_type', 'earning')
              .order('id')
              .range(from, to),
          )
          compCompRows.push(...chunkRows)
        }

        // computed_monthly is NUMERIC — coerce or an employee with 2+ earning
        // components corrupts their fallback gross into NaN, failing
        // ptax_contributions.gross_salary's NOT NULL constraint (G13 sweep).
        for (const row of compCompRows) {
          const empId = compIdToEmpId.get(row.compensation_id)
          if (empId) {
            fallbackGrossMap.set(empId, (fallbackGrossMap.get(empId) ?? 0) + Number(row.computed_monthly ?? 0))
          }
        }
      }
    }

    // ── Fetch all ptax slabs for this tenant + financial year (all states) ─────
    // select('*') so it's resilient if migration 166 columns (frequency /
    // deduction_month) aren't present — a named select would error → 0 slabs.
    const { data: allSlabs } = await fastify.supabase
      .from('ptax_slabs')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)
      .eq('is_active', true)

    // States the tenant has explicitly DISABLED in ptax_state_settings. PT must
    // not be deducted/filed for these even if slabs exist (LWF already gates on
    // its settings; PT didn't). Only an explicit enabled=false disables — states
    // with no settings row keep the slab-driven default, so this never silently
    // stops PT for tenants who never configured ptax_state_settings.
    const { data: ptStateSettings } = await fastify.supabase
      .from('ptax_state_settings')
      .select('state_code, enabled')
      .eq('tenant_id', req.tenantId)
    const disabledStates = new Set<string>(
      ((ptStateSettings ?? []) as any[]).filter(s => s.enabled === false).map(s => s.state_code),
    )

    const slabsByState = new Map<string, PTaxSlab[]>()
    for (const slab of (allSlabs ?? []) as any[]) {
      const existing = slabsByState.get(slab.state_code) ?? []
      existing.push({
        monthlyIncomeFrom: Number(slab.monthly_income_from),
        monthlyIncomeTo:   slab.monthly_income_to != null ? Number(slab.monthly_income_to) : undefined,
        monthlyPtax:       Number(slab.monthly_ptax),
        frequency:         slab.frequency ?? 'monthly',
        deductionMonth:    slab.deduction_month ?? undefined,
      } as PTaxSlab)
      slabsByState.set(slab.state_code, existing)
    }

    const contributions: any[] = []
    let skippedExempt = 0
    let skippedNoState = 0
    let skippedStateDisabled = 0
    let wagesFromSlip = 0
    let wagesFallback = 0
    let computedZero = 0           // slab found but PT resolved to 0 (no income match / freq / ₹0 slab)
    const noSlabStates = new Set<string>()   // states with employees but no slabs
    let skippedNoSlabs = 0
    let sampleTrace: string[] | null = null  // trace of the first eligible employee, for diagnostics
    // Per-employee resolved-state diagnostics (master tagging visibility)
    const stateDiag: Array<{ code: string; state: string | null; source: string }> = []

    for (const emp of empList) {
      // Skip exempted employees
      if (exemptSet.has(emp.id)) { skippedExempt++; continue }

      // Resolve state: manual override (PT or LWF) → site state_code
      const manual    = manualStateMap.get(emp.id) ?? null
      const siteState = emp.site_id ? (siteStateMap.get(emp.site_id) ?? null) : null
      const stateCode = manual ?? siteState
      if (stateDiag.length < 5) {
        stateDiag.push({
          code:   emp.employee_code,
          state:  stateCode,
          source: manual ? 'employee master' : siteState ? 'site' : 'none',
        })
      }
      if (!stateCode) { skippedNoState++; continue }
      if (disabledStates.has(stateCode)) { skippedStateDisabled++; continue }

      const slabs = slabsByState.get(stateCode) ?? []
      if (slabs.length === 0) { skippedNoSlabs++; noSlabStates.add(stateCode); continue }  // no slabs for state/FY

      // Resolve gross wages
      let grossSalary: number
      if (slipGrossMap.has(emp.id)) {
        grossSalary = slipGrossMap.get(emp.id)!
        wagesFromSlip++
      } else {
        grossSalary = fallbackGrossMap.get(emp.id) ?? 0
        wagesFallback++
      }

      const result = computePTax(grossSalary, slabs, calendarMonth, stateCode)
      if (!sampleTrace) sampleTrace = result.traceSteps   // capture first computed employee's trace

      // Slip is the source of truth, same as EPF/ESI above: when a
      // finalized slip actually has a PTAX line, file exactly that amount
      // — never a freshly-recomputed figure that can drift from it if
      // slabs/state settings changed after finalize.
      const slipPtax = slipPtaxMap.get(emp.id)
      const ptaxAmount = slipPtax !== undefined ? slipPtax : result.ptaxAmount
      if (ptaxAmount === 0) computedZero++

      contributions.push({
        tenant_id:          req.tenantId,
        employee_id:        emp.id,
        contribution_month: month,
        payroll_run_id:     payrollRunId,
        state_code:         stateCode,
        financial_year,
        gross_salary:       grossSalary,
        ptax_amount:        ptaxAmount,
      })
    }

    // Remove stale rows for employees no longer in this month's deductible set
    // (e.g. dropped below the slab / state disabled since the last compute), so a
    // re-finalize cannot leave a phantom PT liability on the filing.
    //
    // Same fix as esi.ts's identical pattern: a single .not('employee_id',
    // 'in', `(${allKeepIds.join(',')})`) encodes every kept id into one URL
    // query parameter, which breaks before it reaches the server at
    // enterprise headcount (found by running this endpoint for real against
    // 1,200 employees — scripts/pagination-scale-check.sh). Fixed by finding
    // the actual stale ids and deleting them in bounded .in()-chunks.
    {
      const keepSet = new Set(contributions.map((c: any) => c.employee_id))
      let existingRows: Array<{ employee_id: string }>
      try {
        existingRows = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('ptax_contributions')
            .select('employee_id')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
            .order('id')
            .range(from, to),
        )
      } catch (existErr) {
        return serverError(req, reply, existErr, ErrorCode.QUERY_FAILED, 'Failed to read existing P-Tax contributions for cleanup')
      }
      const staleIds = existingRows.map(r => r.employee_id).filter(id => !keepSet.has(id))
      for (let i = 0; i < staleIds.length; i += 100) {
        const chunk = staleIds.slice(i, i + 100)
        const { error: delErr } = await fastify.supabase
          .from('ptax_contributions')
          .delete()
          .eq('tenant_id', req.tenantId)
          .eq('contribution_month', month)
          .in('employee_id', chunk)
        if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to clean up stale P-Tax contributions')
      }
    }

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('ptax_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return serverError(req, reply, upsertErr, ErrorCode.UPDATE_FAILED, 'Failed to save P-Tax contributions')
    }

    return reply.send({
      computed_count:    contributions.length,
      computed_zero:     computedZero,
      computed_nonzero:  contributions.length - computedZero,
      skipped_exempt:    skippedExempt,
      skipped_no_state:  skippedNoState,
      skipped_state_disabled: skippedStateDisabled,
      skipped_no_slabs:  skippedNoSlabs,
      no_slab_states:    [...noSlabStates],
      total_active:      empList.length,
      financial_year,
      sample_trace:      sampleTrace,
      state_diagnostics: stateDiag,
      wages_from_slip:   wagesFromSlip,
      wages_fallback:    wagesFallback,
      month,
    })
  })
}
