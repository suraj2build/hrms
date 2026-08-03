/**
 * Payroll Routes — barrel
 *
 * This file used to hold all payroll run/slip/accounting/forensics routes
 * directly (5,783 lines, 58 routes). It has been split into domain-scoped
 * sibling files for maintainability; this barrel just registers them all
 * under the same fastify instance so route paths and behavior are unchanged.
 *
 * - runs.ts             — run lifecycle: create/list/finalize/rollback/delete,
 *                          blockers, preflight, export, variance, retry-failed,
 *                          freeze; houses the executePayrollRun engine and the
 *                          'payroll-run' durable job handler.
 * - slips.ts             — employee self-service payslip reads (my-slips,
 *                          slip by id, pay trend) + run slip listing.
 * - validation-rules.ts  — payroll_validation_rules list/toggle.
 * - forensics.ts         — /payroll/forensics, readiness-score, freeze-log,
 *                          freeze-month/unfreeze-month.
 * - statutory-recon.ts   — /payroll/statutory-reconciliation (list/close/
 *                          confirm/reopen).
 * - approval-stages.ts   — maker-checker governance log (approve/reject).
 * - payout-batches.ts    — payout batches, payout reconciliation, payout
 *                          obligations.
 * - snapshots.ts          — run snapshot create/read/employees.
 * - integrity.ts         — verify-integrity, replay, replay-sessions.
 * - run-ledgers.ts       — financial ledger create/read/post/reverse/export,
 *                          cost-allocations.
 * - accounting.ts        — accounting summary, GL summary, GL mappings.
 * - run-diagnostics.ts   — run reconciliation report, per-employee trace.
 */
import type { FastifyInstance } from 'fastify'
import payrollRunsRoutes from './runs.js'
import payrollSlipsRoutes from './slips.js'
import payrollValidationRulesRoutes from './validation-rules.js'
import payrollForensicsRoutes from './forensics.js'
import payrollStatutoryReconRoutes from './statutory-recon.js'
import payrollApprovalStagesRoutes from './approval-stages.js'
import payrollPayoutBatchesRoutes from './payout-batches.js'
import payrollSnapshotsRoutes from './snapshots.js'
import payrollIntegrityRoutes from './integrity.js'
import payrollRunLedgersRoutes from './run-ledgers.js'
import payrollAccountingRoutes from './accounting.js'
import payrollRunDiagnosticsRoutes from './run-diagnostics.js'

export default async function payrollRoutes(fastify: FastifyInstance) {
  await fastify.register(payrollRunsRoutes)
  await fastify.register(payrollSlipsRoutes)
  await fastify.register(payrollValidationRulesRoutes)
  await fastify.register(payrollForensicsRoutes)
  await fastify.register(payrollStatutoryReconRoutes)
  await fastify.register(payrollApprovalStagesRoutes)
  await fastify.register(payrollPayoutBatchesRoutes)
  await fastify.register(payrollSnapshotsRoutes)
  await fastify.register(payrollIntegrityRoutes)
  await fastify.register(payrollRunLedgersRoutes)
  await fastify.register(payrollAccountingRoutes)
  await fastify.register(payrollRunDiagnosticsRoutes)
}
