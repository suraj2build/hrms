/**
 * Payroll Payout Batches & Reconciliation
 *
 * GET  /payroll/payout-batches                       — list bank disbursement batches
 * GET  /payroll/payout-batches/:runId/employees       — per-employee payout rows for a batch
 * GET  /payroll/payout-reconciliation                 — payout reconciliation records
 * POST /payroll/payout-reconciliation/:id/update       — update a reconciliation record
 * POST /payroll/runs/:id/payout-obligations           — generate payout obligations for a run
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, notFound, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { buildPayoutObligations } from '../../lib/payroll-accounting-engine.js'

export default async function payrollPayoutBatchesRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/payout-batches ───────────────────────────────────────────────
  // List payout batch records (bank disbursement tracking).
  fastify.get('/payroll/payout-batches', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { month } = (req.query ?? {}) as { month?: string }

    // Aggregate from payroll_slips — treat each finalized run as a virtual payout batch
    let q = fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, total_gross, total_net, finalized_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(24)

    if (month) q = q.eq('month', month)
    const { data: runs, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payout batches')

    // Map runs to virtual payout batches
    const batches = (runs ?? []).map(r => ({
      id:             r.id,
      month:          r.month,
      run_id:         r.id,
      employee_count: r.employee_count ?? 0,
      total_amount:   r.total_net ?? 0,
      gross_amount:   r.total_gross ?? 0,
      status:         r.status === 'finalized' ? 'ready' : r.status === 'draft' ? 'pending' : r.status,
      finalized_at:   r.finalized_at,
      created_at:     r.created_at,
    }))

    return reply.send({ data: batches })
  })

  // ── GET /payroll/payout-batches/:runId/employees ──────────────────────────────
  // Employee-level payout details for a run (for bank advice / individual tracking).
  fastify.get('/payroll/payout-batches/:runId/employees', hrAdminAuth, async (req: any, reply) => {
    const { runId } = req.params as { runId: string }
    const tenantId = req.tenantId as string

    let slips: any[]
    try {
      slips = await fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select(`
            id, employee_id, month, gross_pay, net_pay, total_deductions, lop_amount, status, held_reason,
            employees (
              employee_code,
              profiles!profile_id ( full_name ),
              bank_details:employee_bank_statutory ( account_number_masked:account_number, bank_name, ifsc_code )
            )
          `)
          .eq('run_id', runId)
          .eq('tenant_id', tenantId)
          .order('employee_id')
          .range(from, to))
    } catch (error: any) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payout employee details')
    }

    const mapped = slips.map((s: any) => {
      const bank = (s.employees?.bank_details ?? []).find((b: any) => b.is_primary) ?? s.employees?.bank_details?.[0] ?? null
      return {
        slip_id:          s.id,
        employee_id:      s.employee_id,
        employee_code:    s.employees?.employee_code ?? '—',
        employee_name:    s.employees?.profiles?.full_name ?? '—',
        net_pay:          s.net_pay,
        gross_pay:        s.gross_pay,
        total_deductions: s.total_deductions,
        status:           s.status,
        held_reason:      s.held_reason,
        bank_name:        bank?.bank_name ?? null,
        account_masked:   bank?.account_number_masked ?? null,
        ifsc:             bank?.ifsc_code ?? null,
        bank_verified:    !!bank,
      }
    })

    return reply.send({ data: mapped })
  })
  // ── GET /payroll/payout-reconciliation ───────────────────────────────────────
  // Payout reconciliation records with filter support.
  fastify.get('/payroll/payout-reconciliation', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const qSchema  = z.object({
      run_id:  z.string().uuid().optional(),
      status:  z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(500).default(100),
      offset:  z.coerce.number().int().min(0).default(0),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    const { run_id, status, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('payroll_payout_reconciliation')
      .select('id, run_id, slip_id, employee_id, expected_amount, paid_amount, variance_amount, payment_status, utr_number, bank_reference, bank_account_masked, ifsc_code, initiated_at, completed_at, failure_reason, retry_count', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (run_id) q = (q as any).eq('run_id', run_id)
    if (status) q = (q as any).eq('payment_status', status)

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payout reconciliation records')
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── POST /payroll/payout-reconciliation/:id/update ───────────────────────────
  // Update payout status (UTR, completion, failure).
  fastify.post('/payroll/payout-reconciliation/:id/update', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const bodySchema = z.object({
      payment_status: z.enum(['pending','processing','paid','failed','reversed','held','partial']),
      paid_amount:    z.number().min(0).optional(),
      utr_number:     z.string().max(50).optional(),
      bank_reference: z.string().max(100).optional(),
      failure_reason: z.string().max(500).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')

    const update: Record<string, unknown> = {
      payment_status: parsed.data.payment_status,
      updated_at:     new Date().toISOString(),
    }

    // Validate the paid amount against the obligation's expected_amount so a
    // payout can't be marked paid for an arbitrary (or zero) sum. A full 'paid'
    // must match the expected net within a ₹1 rounding tolerance; an intentional
    // short payment must use 'partial' (>0 and < expected). Other statuses
    // (pending/processing/failed/reversed/held) pass the amount through as-is.
    const { data: oblig } = await fastify.supabase
      .from('payroll_payout_reconciliation')
      .select('expected_amount')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!oblig) return notFound(reply, 'NOT_FOUND', 'Payout obligation not found')
    const expected = Number((oblig as any).expected_amount ?? 0)

    if (parsed.data.payment_status === 'paid') {
      // Default the recorded amount to the expected net if the caller omitted it.
      const paid = parsed.data.paid_amount ?? expected
      if (Math.abs(paid - expected) > 1) {
        return validationError(reply, 'AMOUNT_MISMATCH', `Paid amount (${paid}) does not match the expected net (${expected}). Use 'partial' for an intentional short payment.`)
      }
      update.paid_amount = paid
    } else if (parsed.data.payment_status === 'partial') {
      const paid = parsed.data.paid_amount
      if (paid === undefined || paid <= 0 || paid >= expected) {
        return validationError(reply, 'INVALID_PARTIAL_AMOUNT', `Partial payment must be greater than 0 and less than the expected net (${expected}).`)
      }
      update.paid_amount = paid
    } else if (parsed.data.paid_amount !== undefined) {
      update.paid_amount = parsed.data.paid_amount
    }
    if (parsed.data.utr_number)     update.utr_number     = parsed.data.utr_number
    if (parsed.data.bank_reference) update.bank_reference = parsed.data.bank_reference
    if (parsed.data.failure_reason) update.failure_reason = parsed.data.failure_reason
    if (parsed.data.payment_status === 'paid') update.completed_at = new Date().toISOString()
    if (parsed.data.payment_status === 'processing') update.initiated_at = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('payroll_payout_reconciliation')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update payout status')
    return reply.send({ message: 'Payout status updated' })
  })

  // ── POST /payroll/runs/:id/payout-obligations ────────────────────────────────
  // Generate payout obligation rows for a finalized run.
  fastify.post('/payroll/runs/:id/payout-obligations', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    // Guard: payout obligations (bank disbursement) must be built from FINALIZED
    // slips only — never from mutable draft net_pay.
    const { data: runRow } = await fastify.supabase
      .from('payroll_runs').select('status').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (!runRow) return notFound(reply, 'NOT_FOUND', 'Payroll run not found')
    if ((runRow as any).status !== 'finalized') {
      return conflictError(reply, 'NOT_FINALIZED', `Run must be finalized before generating payout obligations (current status: ${(runRow as any).status}).`)
    }

    // Check if obligations already exist
    const { count: existing } = await fastify.supabase
      .from('payroll_payout_reconciliation')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', id)
      .eq('tenant_id', tenantId)

    if ((existing ?? 0) > 0) {
      return conflictError(reply, 'OBLIGATIONS_EXIST', `${existing} payout obligations already exist for this run`)
    }

    // Get ledger id
    const { data: ledger } = await fastify.supabase
      .from('payroll_financial_ledgers')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .eq('ledger_type', 'payroll')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Get slips with bank details
    let slips: any[]
    try {
      slips = await fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select(`
            id, employee_id, net_pay,
            employees (
              bank_details:employee_bank_statutory ( account_number_masked:account_number, ifsc_code )
            )
          `)
          .eq('run_id', id)
          .eq('tenant_id', tenantId)
          .range(from, to))
    } catch (sErr: any) {
      return serverError(req, reply, sErr, 'SLIPS_FETCH_FAILED', 'Failed to fetch payroll slips for payout obligations')
    }

    const obligations = buildPayoutObligations(
      id, tenantId, (ledger as any)?.id ?? null,
      (slips as any[]).map(s => {
        const bank = (s.employees?.bank_details ?? []).find((b: any) => b.is_primary) ?? s.employees?.bank_details?.[0]
        return {
          slip_id:              s.id,
          employee_id:          s.employee_id,
          net_pay:              s.net_pay,
          bank_account_masked:  bank?.account_number_masked ?? null,
          ifsc_code:            bank?.ifsc_code ?? null,
        }
      }),
    )

    // lint-tenant-ok: `obligations` rows built by buildPayoutObligations() already set tenant_id: tenantId per row
    const { error: iErr } = await fastify.supabase.from('payroll_payout_reconciliation').insert(obligations)
    if (iErr) return serverError(req, reply, iErr, ErrorCode.INSERT_FAILED, 'Failed to create payout obligations')

    return reply.send({ message: `${obligations.length} payout obligations created`, count: obligations.length })
  })
}
