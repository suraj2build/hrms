/**
 * Payroll Run Diagnostics
 *
 * GET /payroll/runs/:id/reconciliation                    — run-level reconciliation report
 * GET /payroll/runs/:id/employees/:employeeId/trace        — per-employee computation trace
 *
 * Split out of the former monolithic routes/payroll/index.ts.
 */
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, notFound, validationError, ErrorCode } from '../../lib/api-errors.js'
import { buildPayrollReconciliationReport } from '../../lib/payroll-reconciliation-engine.js'

export default async function payrollRunDiagnosticsRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/payroll/runs/:id/reconciliation', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: run, error: runErr } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, tenant_id, status, total_gross, total_deductions, total_net')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (runErr) return serverError(req, reply, runErr, ErrorCode.QUERY_FAILED, 'Failed to fetch run')
    if (!run)   return notFound(reply, 'NOT_FOUND', 'Run not found')

    const REPORTABLE = new Set(['draft', 'partial_failed', 'finalized'])
    if (!REPORTABLE.has((run as any).status)) {
      return validationError(
        reply,
        'RUN_NOT_COMPLETE',
        `Reconciliation is only available for completed runs (draft/partial_failed/finalized). Current status: ${(run as any).status}`,
      )
    }

    let slips: Array<{
      employee_id: string
      gross_pay: number; total_deductions: number; net_pay: number
      employer_contributions: number; tds_deducted: number
      component_breakdown: any
    }>
    try {
      slips = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select('employee_id, gross_pay, total_deductions, net_pay, employer_contributions, tds_deducted, component_breakdown')
          .eq('run_id', id)
          .eq('tenant_id', tenantId)
          .range(from, to),
      )
    } catch (slipErr: any) {
      return serverError(req, reply, slipErr, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll slips for reconciliation')
    }

    // Slips don't store employee_code — resolve from the employee snapshot if available,
    // otherwise leave blank (still useful for run-level totals and component breakdown).
    const empCodeMap = new Map<string, string>()
    try {
      const { data: snapManifest } = await fastify.supabase
        .from('payroll_run_snapshots')
        .select('id')
        .eq('run_id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (snapManifest) {
        const empSnaps = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('payroll_employee_snapshots')
            .select('employee_id, employee_code')
            .eq('snapshot_id', (snapManifest as any).id)
            .eq('tenant_id', tenantId)
            .range(from, to),
        )
        for (const e of empSnaps) empCodeMap.set((e as any).employee_id, (e as any).employee_code)
      }
    } catch {
      // employee_code resolution is best-effort
    }

    const slipsForRecon = slips.map((s: any) => ({
      employee_id:            s.employee_id,
      employee_code:          empCodeMap.get(s.employee_id) ?? '',
      gross_pay:              Number(s.gross_pay ?? 0),
      total_deductions:       Number(s.total_deductions ?? 0),
      net_pay:                Number(s.net_pay ?? 0),
      employer_contributions: Number(s.employer_contributions ?? 0),
      tds_deducted:           Number(s.tds_deducted ?? 0),
      component_breakdown:    Array.isArray(s.component_breakdown) ? s.component_breakdown : [],
    }))

    const report = buildPayrollReconciliationReport(
      {
        id:               (run as any).id,
        month:            (run as any).month,
        tenant_id:        (run as any).tenant_id,
        total_gross:      Number((run as any).total_gross ?? 0),
        total_deductions: Number((run as any).total_deductions ?? 0),
        total_net:        Number((run as any).total_net ?? 0),
      },
      slipsForRecon,
    )

    return reply.send({ data: report })
  })

  // ── GET /payroll/runs/:id/employees/:employeeId/trace ─────────────────────
  // End-to-end audit trace for a single employee in a given run.
  //
  // Answers "Why did <employee> receive ₹X?" by combining:
  //   1. The final payroll slip (gross/deductions/net, component breakdown)
  //   2. The immutable employee snapshot (attendance, compensation, statutory,
  //      formula, and validation sub-blobs captured at computation time)
  //   3. Every forensic run event logged for this employee during the run
  //      (data_fetch_failed, computation_failed, slip_inserted, etc.)
  //
  // Requires a snapshot to exist; the snapshot is auto-built on run completion
  // (draft/partial_failed) so this endpoint is available without finalization.
  fastify.get('/payroll/runs/:id/employees/:employeeId/trace', hrAdminAuth, async (req: any, reply) => {
    const { id: runId, employeeId } = req.params as { id: string; employeeId: string }
    const tenantId = req.tenantId as string

    // Fetch slip, snapshot manifest, and run events in parallel
    const [slipResult, manifestResult, eventsResult] = await Promise.allSettled([
      fastify.supabase
        .from('payroll_slips')
        .select('id, employee_id, month, run_id, gross_pay, net_pay, lop_days, lop_amount, payable_days, total_working_days, overtime_hours, ctc_monthly, total_deductions, employer_contributions, tds_deducted, component_breakdown, status, held_reason, warning')
        .eq('run_id', runId)
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),

      fastify.supabase
        .from('payroll_run_snapshots')
        .select('id')
        .eq('run_id', runId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),

      fastify.supabase
        .from('payroll_run_events')
        .select('event_type, payload, error_details, created_at')
        .eq('run_id', runId)
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }),
    ])

    const slip     = slipResult.status     === 'fulfilled' && !slipResult.value.error     ? slipResult.value.data     : null
    const manifest = manifestResult.status === 'fulfilled' && !manifestResult.value.error ? manifestResult.value.data : null
    const events   = eventsResult.status   === 'fulfilled' && !eventsResult.value.error   ? (eventsResult.value.data ?? []) : []

    // Fetch the per-employee snapshot if a manifest exists
    let employeeSnapshot: Record<string, unknown> | null = null
    if (manifest) {
      const { data: empSnap, error: empSnapErr } = await fastify.supabase
        .from('payroll_employee_snapshots')
        .select('employee_id, employee_code, employee_name, gross_pay, deductions, net_pay, payable_days, lop_days, overtime_hours, total_working_days, computed_at, attendance_snapshot, compensation_snapshot, component_snapshot, statutory_snapshot, formula_snapshot, validation_snapshot')
        .eq('snapshot_id', (manifest as any).id)
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (!empSnapErr && empSnap) employeeSnapshot = empSnap as Record<string, unknown>
    }

    if (!slip && !employeeSnapshot && events.length === 0) {
      return notFound(reply, 'NOT_FOUND', 'No payroll record found for this employee in the given run')
    }

    return reply.send({
      data: {
        run_id:            runId,
        employee_id:       employeeId,
        slip:              slip ?? null,
        snapshot:          employeeSnapshot ?? null,
        snapshot_note:     !manifest ? 'Snapshot not yet built — run POST /payroll/runs/:id/snapshot to generate it' : (!employeeSnapshot ? 'Employee snapshot not found in manifest' : null),
        events,
      },
    })
  })
}
