/**
 * Payroll Statutory Reconciliation
 *
 * GET  /payroll/statutory-reconciliation           — COMPUTED vs PAYABLE per statute for a run's month
 * POST /payroll/statutory-reconciliation/close      — close reconciliation for a month (gate before finalize)
 * POST /payroll/statutory-reconciliation/confirm    — confirm a statute's variance is accepted/explained
 * POST /payroll/statutory-reconciliation/reopen     — reopen a previously closed month
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { logAction } from '../../lib/audit-service.js'
import { serverError, notFound, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'

export default async function payrollStatutoryReconRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── Shared statutory-reconciliation builder ───────────────────────────────────
  // Computes COMPUTED (payslip) vs PAYABLE (filing tables) per statute for a run.
  // Used by both the GET summary and the POST closure gate so they never diverge.
  type ReconStatute = { payable: number; computed: number; variance: number; filed: boolean }
  type ReconResult = {
    run: { id: string; month: string; status: string }
    recon: { pf: ReconStatute; esi: ReconStatute; pt: ReconStatute; tds: ReconStatute }
    employeeCount: number
  }
  const STATUTE_KEYS = ['pf', 'esi', 'pt', 'tds'] as const
  type StatuteKey = typeof STATUTE_KEYS[number]

  async function buildStatutoryRecon(tenantId: string, month?: string): Promise<ReconResult | null> {
    let runQuery = fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, total_gross, total_net, total_deductions')
      .eq('tenant_id', tenantId)
      .in('status', ['finalized', 'partial_failed', 'draft'])
      .order('created_at', { ascending: false })
    if (month) runQuery = runQuery.eq('month', month)
    const { data: run } = await runQuery.limit(1).maybeSingle()
    if (!run) return null

    const reconMonth = run.month as string

    // COMPUTED (from payslips) — real slip codes. TDS isn't on the slip.
    const slips = await fetchAllRows<any>((from, to) =>
      fastify.supabase
        .from('payroll_slips')
        .select('component_breakdown, employee_id')
        .eq('run_id', run.id)
        .eq('tenant_id', tenantId)
        .range(from, to))

    const recon = {
      pf:  { payable: 0, computed: 0, variance: 0, filed: false },
      esi: { payable: 0, computed: 0, variance: 0, filed: false },
      pt:  { payable: 0, computed: 0, variance: 0, filed: false },
      tds: { payable: 0, computed: 0, variance: 0, filed: false },
    }
    const employeeCount = slips.length

    for (const slip of slips) {
      for (const comp of (slip.component_breakdown ?? [])) {
        const code = (comp.code ?? '').toUpperCase()
        const amt  = Number(comp.monthly_amount ?? 0)
        if (code === 'PF_EMPLOYEE' || code === 'PF_EMPLOYER' || code === 'EPF' || code === 'PF') recon.pf.computed  += amt
        else if (code === 'ESI_EMPLOYEE' || code === 'ESI_EMPLOYER' || code === 'ESI')            recon.esi.computed += amt
        else if (code === 'PTAX' || code === 'PT' || code === 'PROFESSIONAL_TAX')                 recon.pt.computed  += amt
        else if (code === 'TDS' || code === 'INCOME_TAX')                                         recon.tds.computed += amt
      }
    }

    // PAYABLE (from actual filing tables for this month)
    const [epfRows, esiRows, ptaxRows, tdsRows] = await Promise.all([
      fastify.supabase.from('epf_contributions')
        .select('employee_contribution, total_employer_contribution, voluntary_pf')
        .eq('tenant_id', tenantId).eq('contribution_month', reconMonth),
      fastify.supabase.from('esi_contributions')
        .select('total_contribution')
        .eq('tenant_id', tenantId).eq('contribution_month', reconMonth),
      fastify.supabase.from('ptax_contributions')
        .select('ptax_amount')
        .eq('tenant_id', tenantId).eq('contribution_month', reconMonth),
      fastify.supabase.from('tds_monthly_projections')
        .select('tds_this_month')
        .eq('tenant_id', tenantId).eq('projection_month', reconMonth),
    ])

    const sum = (rows: any[] | null | undefined, fn: (r: any) => number) =>
      Math.round((rows ?? []).reduce((s, r) => s + fn(r), 0) * 100) / 100

    recon.pf.payable  = sum(epfRows.data, r => Number(r.employee_contribution ?? 0) + Number(r.total_employer_contribution ?? 0) + Number(r.voluntary_pf ?? 0))
    recon.esi.payable = sum(esiRows.data, r => Number(r.total_contribution ?? 0))
    recon.pt.payable  = sum(ptaxRows.data, r => Number(r.ptax_amount ?? 0))
    recon.tds.payable = sum(tdsRows.data, r => Number(r.tds_this_month ?? 0))

    recon.pf.filed  = (epfRows.data?.length  ?? 0) > 0
    recon.esi.filed = (esiRows.data?.length  ?? 0) > 0
    recon.pt.filed  = (ptaxRows.data?.length ?? 0) > 0
    recon.tds.filed = (tdsRows.data?.length  ?? 0) > 0

    // NOTE: a head with NO filing rows must stay filed:false / payable:0 here —
    // do NOT fall back to treating the slip-aggregated amount as "payable", even
    // though that number is a reasonable estimate of the real liability. Setting
    // payable = computed (and filed = true) manufactures a zero variance for a
    // month whose independent filing data (epf/esi/ptax_contributions,
    // tds_monthly_projections) was simply never generated — isReconciled() and
    // POST /close both read filed/variance straight off this struct, so that
    // used to let a month with zero real filing rows pass the "ready to file"
    // gate and get marked filed. `close`'s own skip-reason logic
    // ('no_contributions_generated', below) already assumed filed stays false
    // in this case — this fallback was the only thing making that branch dead.
    //
    // The other direction is legitimate and kept as-is: filing rows CAN exist
    // with no matching slip line (e.g. TDS, which isn't its own slip component) —
    // there payable is the real, already-independently-confirmed number, so
    // showing it as computed too is correct, not a fabrication.
    for (const k of STATUTE_KEYS) {
      if (recon[k].computed === 0 && recon[k].payable > 0) {
        // Filing rows exist but slip had no line (e.g. TDS not on slip) — show payable.
        recon[k].computed = recon[k].payable
      }
    }

    recon.pf.variance  = Math.round((recon.pf.payable  - recon.pf.computed)  * 100) / 100
    recon.esi.variance = Math.round((recon.esi.payable - recon.esi.computed) * 100) / 100
    recon.pt.variance  = Math.round((recon.pt.payable  - recon.pt.computed)  * 100) / 100
    recon.tds.variance = Math.round((recon.tds.payable - recon.tds.computed) * 100) / 100

    return {
      run: { id: run.id as string, month: reconMonth, status: run.status as string },
      recon,
      employeeCount,
    }
  }

  // A statute is RECONCILED when its filing rows exist and variance is within ₹1.
  const isReconciled = (s: ReconStatute) => s.filed && Math.abs(s.variance) < 1

  // ── GET /payroll/statutory-reconciliation ─────────────────────────────────────
  // Cross-statutory reconciliation summary: PF, ESI, PT, TDS per run/month,
  // merged with persisted closure state (filed / confirmed).
  fastify.get('/payroll/statutory-reconciliation', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { month } = (req.query ?? {}) as { month?: string }

    const result = await buildStatutoryRecon(tenantId, month)
    if (!result) return reply.send({ data: null, message: 'No payroll run found' })

    const { run, recon, employeeCount } = result

    // Persisted closures for this month.
    const { data: closureRows } = await fastify.supabase
      .from('statutory_filing_closures')
      .select('statutory_type, status, challan_number, reference_note, filed_at, confirmed_at, variance')
      .eq('tenant_id', tenantId)
      .eq('month', run.month)
    const closureMap = new Map<string, any>(
      (closureRows ?? []).map((c: any) => [c.statutory_type, c]),
    )

    const runFinalized = run.status === 'finalized'
    const decorate = (key: StatuteKey, s: ReconStatute, label: string) => {
      const closure = closureMap.get(key)
      return {
        ...s,
        label,
        ready:     isReconciled(s),
        // Can only file when the run is finalized AND the statute reconciles.
        can_file:  runFinalized && isReconciled(s) && !closure,
        closure_status: closure?.status ?? null,    // 'filed' | 'confirmed' | null
        challan_number: closure?.challan_number ?? null,
        reference_note: closure?.reference_note ?? null,
        filed_at:       closure?.filed_at ?? null,
        confirmed_at:   closure?.confirmed_at ?? null,
      }
    }

    const pf  = decorate('pf',  recon.pf,  'Provident Fund')
    const esi = decorate('esi', recon.esi, 'Employee State Insurance')
    const pt  = decorate('pt',  recon.pt,  'Professional Tax')
    const tds = decorate('tds', recon.tds, 'Tax Deducted at Source')

    const readyForFiling = isReconciled(recon.pf) && isReconciled(recon.esi) && isReconciled(recon.pt) && isReconciled(recon.tds)
    const allClosed = [pf, esi, pt, tds].every(s => s.closure_status !== null)

    return reply.send({
      data: {
        run: { id: run.id, month: run.month, status: run.status, employee_count: employeeCount },
        pf, esi, pt, tds,
        ready_for_filing: readyForFiling,
        run_finalized:    runFinalized,
        all_closed:       allClosed,
        total_statutory:  recon.pf.computed + recon.esi.computed + recon.pt.computed + recon.tds.computed,
        note: readyForFiling
          ? undefined
          : 'Not ready: statutory contributions must be generated (EPF/ESI/PT/TDS) and match payslip totals within ₹1 before filing.',
      },
    })
  })

  // ── POST /payroll/statutory-reconciliation/close ──────────────────────────────
  // File one or more statutes for a month. Gated: run must be finalized AND the
  // statute must reconcile within ₹1. Idempotent — refuses to file twice.
  fastify.post('/payroll/statutory-reconciliation/close', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({
      month:          z.string().regex(/^\d{4}-\d{2}$/),
      statutes:       z.array(z.enum(['pf', 'esi', 'pt', 'tds'])).min(1),
      challan_number: z.string().max(120).optional(),
      reference_note: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const { month, statutes, challan_number, reference_note } = parsed.data

    const result = await buildStatutoryRecon(tenantId, month)
    if (!result) return notFound(reply, 'NO_RUN', `No payroll run found for ${month}`)
    if (result.run.status !== 'finalized') {
      return conflictError(reply, 'RUN_NOT_FINALIZED', `Payroll run for ${month} is '${result.run.status}'. Finalize the run before filing statutory dues.`)
    }

    // Existing closures (idempotency guard).
    const { data: existingRows } = await fastify.supabase
      .from('statutory_filing_closures')
      .select('statutory_type, status')
      .eq('tenant_id', tenantId)
      .eq('month', month)
    const existing = new Set((existingRows ?? []).map((r: any) => r.statutory_type))

    const filed: string[] = []
    const skipped: Array<{ statute: string; reason: string }> = []
    const rowsToInsert: any[] = []
    const nowIso = new Date().toISOString()

    for (const key of statutes) {
      if (existing.has(key)) { skipped.push({ statute: key, reason: 'already_filed' }); continue }
      const s = result.recon[key as StatuteKey]
      if (!isReconciled(s)) {
        skipped.push({
          statute: key,
          reason: s.filed ? `variance_${s.variance}` : 'no_contributions_generated',
        })
        continue
      }
      rowsToInsert.push({
        tenant_id:       tenantId,
        month,
        statutory_type:  key,
        status:          'filed',
        run_id:          result.run.id,
        computed_amount: s.computed,
        payable_amount:  s.payable,
        variance:        s.variance,
        snapshot:        { ...s, run_id: result.run.id, month, captured_at: nowIso },
        challan_number:  challan_number ?? null,
        reference_note:  reference_note ?? null,
        filed_by:        req.userId ?? null,
        filed_at:        nowIso,
      })
      filed.push(key)
    }

    if (rowsToInsert.length > 0) {
      const { error } = await fastify.supabase
        .from('statutory_filing_closures')
        .insert(rowsToInsert)
      if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to record statutory filing')

      await logAction(fastify.supabase, {
        tenantId,
        tableName:   'statutory_filing_closures',
        recordId:    result.run.id,
        action:      'INSERT',
        performedBy: req.userId ?? null,
        newData:     { month, filed, challan_number: challan_number ?? null },
      }).catch(() => {})
    }

    return reply.send({ month, filed, skipped })
  })

  // ── POST /payroll/statutory-reconciliation/confirm ─────────────────────────────
  // Mark a filed statute as confirmed (acknowledgement received).
  fastify.post('/payroll/statutory-reconciliation/confirm', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({
      month:    z.string().regex(/^\d{4}-\d{2}$/),
      statutes: z.array(z.enum(['pf', 'esi', 'pt', 'tds'])).min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const { month, statutes } = parsed.data

    const { error } = await fastify.supabase
      .from('statutory_filing_closures')
      .update({ status: 'confirmed', confirmed_by: req.userId ?? null, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .in('statutory_type', statutes)
      .eq('status', 'filed')

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to confirm statutory filings')
    return reply.send({ month, confirmed: statutes })
  })

  // ── POST /payroll/statutory-reconciliation/reopen ──────────────────────────────
  // Reopen (un-file) a statute — deletes the closure so it can be refiled.
  fastify.post('/payroll/statutory-reconciliation/reopen', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({
      month:    z.string().regex(/^\d{4}-\d{2}$/),
      statutes: z.array(z.enum(['pf', 'esi', 'pt', 'tds'])).min(1),
      reason:   z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const { month, statutes, reason } = parsed.data

    const { error } = await fastify.supabase
      .from('statutory_filing_closures')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .in('statutory_type', statutes)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to reopen statutory filings')

    await logAction(fastify.supabase, {
      tenantId,
      tableName:   'statutory_filing_closures',
      recordId:    tenantId,
      action:      'DELETE',
      performedBy: req.userId ?? null,
      oldData:     { month, statutes, reason: reason ?? null },
    }).catch(() => {})

    return reply.send({ month, reopened: statutes })
  })
}
