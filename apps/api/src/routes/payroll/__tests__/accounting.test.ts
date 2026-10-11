/**
 * GET /payroll/accounting/summary and /payroll/accounting/gl-summary — G13 sweep
 * regression
 *
 * payroll_financial_ledgers.total_credit, payroll_payout_reconciliation.
 * expected_amount/paid_amount, and payroll_ledger_entries.debit_amount/
 * credit_amount are all NUMERIC — PostgREST/Supabase serialize them as
 * strings. Before the fix, a plain `+`/`+=` reduce string-concatenated once
 * 2+ rows existed (the normal case for any account with more than one
 * transaction), corrupting total_payroll_liability, pending_payout_amount,
 * and every GL account's totalDebit/totalCredit/balance into NaN or a
 * concatenated string.
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import accountingRoutes from '../accounting.js'

const TENANT_ID = 'tenant-test-001'

function genericChain(result: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain, order: () => chain, limit: () => chain,
    range: (from: number) => Promise.resolve(from === 0 ? result : { data: [], error: null }),
    // Fallback for queries that terminate at .limit()/.order() rather than
    // .range() (e.g. payroll_financial_ledgers) — awaiting the chain itself
    // must still resolve to `result`.
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return chain
}

async function buildApp(opts: {
  ledgers?: Array<Record<string, any>>
  payouts?: Array<Record<string, any>>
  glEntries?: Array<Record<string, any>>
}) {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'hr-admin-1'
    ;(req as any).userRole = 'hr_admin'
  })

  app.decorate('supabase', {
    from(table: string) {
      if (table === 'payroll_financial_ledgers')     return genericChain({ data: opts.ledgers ?? [], error: null })
      if (table === 'payroll_payout_reconciliation') return genericChain({ data: opts.payouts ?? [], error: null })
      if (table === 'payroll_ledger_entries')        return genericChain({ data: opts.glEntries ?? [], error: null })
      return genericChain({ data: [], error: null })
    },
  } as any)

  await app.register(accountingRoutes)
  await app.ready()
  return app
}

describe('GET /payroll/accounting/summary — DB-string ledger/payout totals (G13 sweep)', () => {
  it('sums 2+ payroll ledgers and payouts into correct finite totals', async () => {
    const app = await buildApp({
      ledgers: [
        { id: 'l1', ledger_month: '2026-09', ledger_type: 'payroll', ledger_status: 'posted', total_debit: '500000.00', total_credit: '500000.00' },
        { id: 'l2', ledger_month: '2026-10', ledger_type: 'payroll', ledger_status: 'posted', total_debit: '520000.00', total_credit: '520000.00' },
      ],
      payouts: [
        { expected_amount: '500000.00', paid_amount: '500000.00', payment_status: 'paid' },
        { expected_amount: '520000.00', paid_amount: '0.00', payment_status: 'pending' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/payroll/accounting/summary',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json().data

    // 500000 + 520000 = 1020000, not "500000.00520000.00"
    expect(body.total_payroll_liability).toBe(1020000)
    expect(Number.isNaN(body.total_payroll_liability)).toBe(false)
    expect(body.pending_payout_amount).toBe(520000)
    // payout_completion_pct = round(500000 / 1020000 * 100) = 49, not NaN
    expect(Number.isFinite(body.payout_completion_pct)).toBe(true)
    expect(body.payout_completion_pct).toBe(49)
  })

  it('a single payroll ledger still totals correctly (no regression on the 1-row case)', async () => {
    const app = await buildApp({
      ledgers: [{ id: 'l1', ledger_month: '2026-10', ledger_type: 'payroll', ledger_status: 'posted', total_debit: '500000.00', total_credit: '500000.00' }],
      payouts: [],
    })

    const res = await app.inject({ method: 'GET', url: '/payroll/accounting/summary', headers: { authorization: 'Bearer test-token' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.total_payroll_liability).toBe(500000)
  })
})

describe('GET /payroll/accounting/gl-summary — DB-string debit/credit totals (G13 sweep)', () => {
  it('aggregates 2+ ledger entries per GL account into correct finite debit/credit/balance', async () => {
    const app = await buildApp({
      glEntries: [
        { gl_account_code: '4001', gl_account_name: 'Salary Expense', entry_category: 'expense', debit_amount: '500000.00', credit_amount: '0.00' },
        { gl_account_code: '4001', gl_account_name: 'Salary Expense', entry_category: 'expense', debit_amount: '520000.00', credit_amount: '0.00' },
        { gl_account_code: '2001', gl_account_name: 'Salary Payable', entry_category: 'liability', debit_amount: '0.00', credit_amount: '500000.00' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/payroll/accounting/gl-summary',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const summary = res.json().data as any[]

    const salaryExpense = summary.find(g => g.code === '4001')
    // 500000 + 520000 = 1020000, not "500000.00520000.00" / NaN
    expect(salaryExpense.totalDebit).toBe(1020000)
    expect(salaryExpense.totalCredit).toBe(0)
    expect(salaryExpense.balance).toBe(1020000)
    expect(Number.isNaN(salaryExpense.totalDebit)).toBe(false)

    const salaryPayable = summary.find(g => g.code === '2001')
    expect(salaryPayable.totalCredit).toBe(500000)
    expect(salaryPayable.balance).toBe(-500000)
  })
})
