/**
 * Payroll Accounting & GL Mappings
 *
 * Accounting dashboard aggregates (liability, accruals, payout completion,
 * ledger imbalances), GL account balance summaries, and GL mapping
 * management. Split out of the former monolithic routes/payroll/index.ts.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function payrollAccountingRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/accounting/summary ─────────────────────────────────────────
  // Dashboard aggregates: total liability, accruals, payout completion, ledger imbalances.
  fastify.get('/payroll/accounting/summary', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const qSchema  = z.object({ months: z.coerce.number().int().min(1).max(12).default(3) })
    const parsed   = qSchema.safeParse(req.query)
    const months   = parsed.success ? parsed.data.months : 3

    const [ledgersRes, payouts] = await Promise.all([
      fastify.supabase
        .from('payroll_financial_ledgers')
        .select('id, ledger_month, ledger_type, ledger_status, total_debit, total_credit')
        .eq('tenant_id', tenantId)
        .order('ledger_month', { ascending: false })
        .limit(months * 3),
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('payroll_payout_reconciliation')
          .select('expected_amount, paid_amount, payment_status')
          .eq('tenant_id', tenantId)
          .range(from, to),
      ),
    ])

    const ledgers = (ledgersRes.data ?? []) as any[]

    const totalPayrollLiability = ledgers
      .filter(l => l.ledger_type === 'payroll' && l.ledger_status !== 'reversed')
      .reduce((s, l) => s + (l.total_credit ?? 0), 0)

    const pendingPayouts = payouts.filter(p => p.payment_status === 'pending' || p.payment_status === 'processing')
    const failedPayouts  = payouts.filter(p => p.payment_status === 'failed')
    const completedPayouts = payouts.filter(p => p.payment_status === 'paid')

    const totalExpected  = payouts.reduce((s, p) => s + (p.expected_amount ?? 0), 0)
    const totalPaid      = completedPayouts.reduce((s, p) => s + (p.paid_amount ?? 0), 0)
    const imbalancedLedgers = ledgers.filter(l => l.ledger_status !== 'reversed' && Math.abs((l.total_debit ?? 0) - (l.total_credit ?? 0)) > 0.01)

    return reply.send({
      data: {
        total_payroll_liability:  totalPayrollLiability,
        pending_payout_amount:    pendingPayouts.reduce((s, p) => s + p.expected_amount, 0),
        failed_payout_count:      failedPayouts.length,
        payout_completion_pct:    totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0,
        imbalanced_ledger_count:  imbalancedLedgers.length,
        total_ledger_count:       ledgers.length,
        posted_ledger_count:      ledgers.filter(l => l.ledger_status === 'posted').length,
        statutory_liability_hint: 'Sum statutory payable GL accounts for exact statutory liabilities',
        recent_ledgers:           ledgers.slice(0, 6),
      },
    })
  })

  // ── GET /payroll/accounting/gl-summary ────────────────────────────────────────
  // GL account balance summary across all posted ledgers.
  fastify.get('/payroll/accounting/gl-summary', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    let data: any[]
    try {
      data = await fetchAllRows<any>((from, to) =>
        fastify.supabase
          .from('payroll_ledger_entries')
          .select('gl_account_code, gl_account_name, entry_category, debit_amount, credit_amount')
          .eq('tenant_id', tenantId)
          .range(from, to))
    } catch (error: any) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch GL account summary')
    }

    // Aggregate by GL account
    const glMap = new Map<string, { code: string; name: string; category: string; totalDebit: number; totalCredit: number }>()
    for (const row of data as any[]) {
      const existing = glMap.get(row.gl_account_code)
      if (existing) {
        existing.totalDebit  += row.debit_amount  ?? 0
        existing.totalCredit += row.credit_amount ?? 0
      } else {
        glMap.set(row.gl_account_code, {
          code:        row.gl_account_code,
          name:        row.gl_account_name,
          category:    row.entry_category,
          totalDebit:  row.debit_amount  ?? 0,
          totalCredit: row.credit_amount ?? 0,
        })
      }
    }

    const summary = Array.from(glMap.values())
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(g => ({
        ...g,
        balance:     Math.round((g.totalDebit - g.totalCredit) * 100) / 100,
        totalDebit:  Math.round(g.totalDebit  * 100) / 100,
        totalCredit: Math.round(g.totalCredit * 100) / 100,
      }))

    return reply.send({ data: summary })
  })
  // ── GET /payroll/gl-mappings ──────────────────────────────────────────────────
  // List GL account mappings for the tenant.
  fastify.get('/payroll/gl-mappings', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_gl_mappings')
      .select('id, component_code, component_type, debit_gl_code, debit_gl_name, credit_gl_code, credit_gl_name, effective_from, is_active')
      .eq('tenant_id', tenantId)
      .order('component_type')
      .order('component_code')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch GL mappings')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/gl-mappings/seed ────────────────────────────────────────────
  // Seed default GL mappings for this tenant (idempotent).
  fastify.post('/payroll/gl-mappings/seed', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    const { error } = await fastify.supabase.rpc('seed_default_gl_mappings', { p_tenant_id: tenantId })
    if (error) return serverError(req, reply, error, 'SEED_FAILED', 'Failed to seed default GL mappings')
    return reply.send({ message: 'Default GL mappings seeded successfully' })
  })
}
