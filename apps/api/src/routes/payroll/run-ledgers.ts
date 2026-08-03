/**
 * Payroll Run Financial Ledger (Phase 16 — Financial Ledger Engine)
 *
 * POST /payroll/runs/:id/ledger              — generate a run's financial ledger
 * GET  /payroll/runs/:id/ledger              — fetch a run's ledger
 * GET  /payroll/ledgers/:ledgerId/entries    — paginated ledger entries
 * POST /payroll/ledgers/:ledgerId/post       — post a ledger to the GL
 * POST /payroll/ledgers/:ledgerId/reverse    — reverse a posted ledger
 * GET  /payroll/ledgers/:ledgerId/export     — CSV export of ledger entries
 * GET  /payroll/runs/:id/cost-allocations    — per-department cost allocation breakdown
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, notFound, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { buildPayrollFinancialLedger, reversePayrollLedger, exportGeneralLedger } from '../../lib/payroll-accounting-engine.js'
import { logRunEvent } from '../../lib/payroll-run-events.js'

export default async function payrollRunLedgersRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNTING LEDGER ENDPOINTS  (Phase 16 — Financial Ledger Engine)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POST /payroll/runs/:id/ledger ────────────────────────────────────────────
  // Generate or regenerate a financial ledger for a finalized run (from snapshot).
  fastify.post('/payroll/runs/:id/ledger', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const bodySchema = z.object({
      ledger_type:      z.enum(['payroll','accrual','payout','adjustment']).default('payroll'),
      accounting_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')

    const result = await buildPayrollFinancialLedger(
      fastify.supabase, id, tenantId, req.userId,
      { ledger_type: parsed.data.ledger_type, accounting_date: parsed.data.accounting_date },
    )

    if ('error' in result) {
      // Actionable preconditions (snapshot needed / archived / ledger already posted)
      // surface as 409 with a code the UI can act on, not an opaque 500.
      const actionable = new Set(['SNAPSHOT_REQUIRED', 'SNAPSHOT_ARCHIVED', 'LEDGER_EXISTS'])
      const code = (result as any).code as string | undefined
      if (code && actionable.has(code)) {
        return conflictError(reply, code!, result.error)
      }
      return serverError(req, reply, new Error(result.error), 'LEDGER_BUILD_FAILED', 'Failed to build payroll financial ledger')
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: 'ledger_created',
      payload: {
        ledger_id:      result.ledger_id,
        balanced:       result.balanced,
        total_debit:    result.total_debit,
        entry_count:    result.entry_count,
        integrity_hash: result.integrity_hash.slice(0, 12),
      },
    })

    if (result.balanced) {
      await logRunEvent(fastify.supabase, req.log, {
        tenant_id:  tenantId,
        run_id:     id,
        event_type: 'ledger_balanced',
        payload:    { ledger_id: result.ledger_id },
      })
    }

    return reply.send({ data: result })
  })

  // ── GET /payroll/runs/:id/ledger ─────────────────────────────────────────────
  // Get ledger manifest + control totals.
  fastify.get('/payroll/runs/:id/ledger', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id, ledger_month, ledger_type, ledger_status, total_debit, total_credit, currency, integrity_hash, posted_at, posted_by, reverses_ledger_id, notes, created_at')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch ledger details')
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/ledgers/:ledgerId/entries ───────────────────────────────────
  // Paginated ledger entries — GL journal view.
  fastify.get('/payroll/ledgers/:ledgerId/entries', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string
    const qSchema = z.object({
      entry_type:  z.string().optional(),
      gl_code:     z.string().optional(),
      employee_id: z.string().uuid().optional(),
      limit:       z.coerce.number().int().min(1).max(500).default(200),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    const { entry_type, gl_code, employee_id, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('payroll_ledger_entries')
      .select('id, entry_type, entry_category, gl_account_code, gl_account_name, debit_amount, credit_amount, description, source_component_code, source_component_name, accounting_date, journal_reference, employee_id', { count: 'exact' })
      .eq('ledger_id', ledgerId)
      .eq('tenant_id', tenantId)
      .order('accounting_date')
      .order('journal_reference')
      .range(offset, offset + limit - 1)

    if (entry_type)  q = (q as any).eq('entry_type', entry_type)
    if (gl_code)     q = (q as any).eq('gl_account_code', gl_code)
    if (employee_id) q = (q as any).eq('employee_id', employee_id)

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch ledger entries')
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── POST /payroll/ledgers/:ledgerId/post ─────────────────────────────────────
  // Post a balanced ledger (requires balanced status).
  fastify.post('/payroll/ledgers/:ledgerId/post', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string

    const { data: ledger, error: lErr } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id, ledger_status, run_id, total_debit, total_credit')
      .eq('id', ledgerId)
      .eq('tenant_id', tenantId)
      .single()

    if (lErr || !ledger) return notFound(reply, 'NOT_FOUND', 'Ledger not found')
    if ((ledger as any).ledger_status === 'posted') return conflictError(reply, 'ALREADY_POSTED', 'Ledger is already posted')
    if ((ledger as any).ledger_status !== 'balanced') {
      return conflictError(reply, 'NOT_BALANCED', `Ledger must be balanced before posting. Current status: ${(ledger as any).ledger_status}. Debit: ${(ledger as any).total_debit}, Credit: ${(ledger as any).total_credit}`)
    }

    const { error: updErr } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .update({ ledger_status: 'posted', posted_at: new Date().toISOString(), posted_by: req.userId })
      .eq('id', ledgerId)
      .eq('tenant_id', req.tenantId)

    if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to post ledger')

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     (ledger as any).run_id,
      event_type: 'ledger_posted',
      payload:    { ledger_id: ledgerId, posted_by: req.userId },
    })

    return reply.send({ message: 'Ledger posted successfully', ledger_id: ledgerId })
  })

  // ── POST /payroll/ledgers/:ledgerId/reverse ──────────────────────────────────
  // Safe reversal — creates mirror entries, never deletes posted entries.
  fastify.post('/payroll/ledgers/:ledgerId/reverse', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string

    const bodySchema = z.object({ reason: z.string().min(5).max(500) })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')

    const result = await reversePayrollLedger(fastify.supabase, ledgerId, tenantId, req.userId, parsed.data.reason)
    if ('error' in result) return validationError(reply, 'REVERSAL_FAILED', result.error)

    const { data: origLedger } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('run_id')
      .eq('id', ledgerId)
      .eq('tenant_id', tenantId)
      .single()

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     (origLedger as any)?.run_id ?? '',
      event_type: 'ledger_reversed',
      payload:    { original_ledger_id: ledgerId, reversal_ledger_id: result.reversal_ledger_id, reason: parsed.data.reason },
    })

    return reply.send({ message: 'Ledger reversed', reversal_ledger_id: result.reversal_ledger_id })
  })

  // ── GET /payroll/ledgers/:ledgerId/export ────────────────────────────────────
  // ERP-ready export. ?format=csv|tally|sap|zoho|quickbooks
  fastify.get('/payroll/ledgers/:ledgerId/export', hrAdminAuth, async (req: any, reply) => {
    const { ledgerId } = req.params as { ledgerId: string }
    const tenantId     = req.tenantId as string
    const qSchema = z.object({
      format: z.enum(['csv','tally','sap','zoho','quickbooks','xlsx']).default('csv'),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')

    const result = await exportGeneralLedger(fastify.supabase, ledgerId, tenantId, parsed.data.format)
    if ('error' in result) return serverError(req, reply, new Error(result.error), 'EXPORT_FAILED', 'Failed to export general ledger')

    reply.header('Content-Disposition', `attachment; filename="${result.filename}"`)
    reply.header('Content-Type', result.mime)
    return reply.send(result.content)
  })

  // ── GET /payroll/runs/:id/cost-allocations ───────────────────────────────────
  // Department / cost-center burden breakdown.
  fastify.get('/payroll/runs/:id/cost-allocations', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: ledger } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .eq('ledger_type', 'payroll')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!ledger) return notFound(reply, 'NOT_FOUND', 'No ledger found for this run — generate ledger first')

    let data: any[]
    try {
      data = await fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('payroll_cost_allocations')
          .select('employee_id, department_id, cost_center_id, department_name, cost_center_name, gross_pay, net_pay, lop_recovery, employer_burden, statutory_burden, overtime_cost, total_cost, allocation_pct')
          .eq('ledger_id', (ledger as any).id)
          .eq('tenant_id', tenantId)
          .order('total_cost', { ascending: false })
          .range(from, to))
    } catch (error: any) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch cost allocations')
    }
    return reply.send({ data })
  })
}
