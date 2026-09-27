/**
 * GET /payroll/filing-pack/challan — G13 sweep regression
 *
 * epf_contributions/esi_contributions/ptax_contributions/payroll_slips columns
 * summed here (pf_wages, employee/employer_contribution, edli_contribution,
 * ptax_amount, tds_deducted) are all DECIMAL — PostgREST/Supabase serialize
 * them as strings. Before the fix, the shared `sum()` helper's plain `+`
 * reduce string-concatenated once a month had 2+ contribution rows (the
 * normal case for any tenant with more than one employee), corrupting every
 * EPF/ESI/PTax/TDS total and the grand total into NaN or garbage. This test
 * drives the real route handler with 2+ rows per table, string-shaped exactly
 * as the DB returns them, and reconciles the actual JSON response totals.
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import filingPackRoutes from '../filing-pack.js'

const TENANT_ID = 'tenant-test-001'

function genericChain(result: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain, limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    range: (from: number) => Promise.resolve(from === 0 ? result : { data: [], error: null }),
  }
  return chain
}

async function buildApp(opts: {
  epfRows: Array<Record<string, string>>
  esiRows: Array<Record<string, string>>
  ptaxRows: Array<{ ptax_amount: string; state_code: string }>
  tdsRows: Array<{ tds_deducted: string }>
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
      if (table === 'epf_contributions')  return genericChain({ data: opts.epfRows, error: null })
      if (table === 'esi_contributions')  return genericChain({ data: opts.esiRows, error: null })
      if (table === 'ptax_contributions') return genericChain({ data: opts.ptaxRows, error: null })
      if (table === 'payroll_slips')      return genericChain({ data: opts.tdsRows, error: null })
      // statutory_registrations — not under test here, return a benign row.
      return genericChain({ data: { registration_number: 'REG-1', state_code: 'KA' }, error: null })
    },
  } as any)

  await app.register(filingPackRoutes)
  await app.ready()
  return app
}

describe('GET /payroll/filing-pack/challan — DB-string contribution totals (G13 sweep)', () => {
  it('sums 2+ EPF/ESI/PTax/TDS rows into correct finite totals, not NaN or concatenated strings', async () => {
    const app = await buildApp({
      epfRows: [
        { employee_contribution: '1800.00', voluntary_pf: '0.00', employer_pf: '1800.00', employer_eps: '1250.00', edli_contribution: '75.00', pf_wages: '15000.00' },
        { employee_contribution: '1800.00', voluntary_pf: '500.00', employer_pf: '1800.00', employer_eps: '1250.00', edli_contribution: '75.00', pf_wages: '15000.00' },
      ],
      esiRows: [
        { employee_contribution: '150.00', employer_contribution: '650.00', total_contribution: '800.00' },
        { employee_contribution: '150.00', employer_contribution: '650.00', total_contribution: '800.00' },
      ],
      ptaxRows: [
        { ptax_amount: '200.00', state_code: 'KA' },
        { ptax_amount: '200.00', state_code: 'KA' },
        { ptax_amount: '208.00', state_code: 'MH' },
      ],
      tdsRows: [
        { tds_deducted: '5000.00' },
        { tds_deducted: '7500.50' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/challan?month=2026-10',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json().data

    // EPF: employee_contribution 1800+1800=3600, voluntary_pf 0+500=500,
    // employer_pf 1800+1800=3600, employer_eps 1250+1250=2500, edli 75+75=150
    expect(body.epf.employee_contribution).toBe(3600)
    expect(body.epf.voluntary_pf).toBe(500)
    expect(body.epf.employer_pf).toBe(3600)
    expect(body.epf.employer_eps).toBe(2500)
    expect(body.epf.edli).toBe(150)
    // admin_charges = 0.5% of pf_wages sum (15000+15000=30000) = 150
    expect(body.epf.admin_charges).toBe(150)
    expect(body.epf.total_remittance).toBe(3600 + 500 + 3600 + 2500 + 150 + 150)
    expect(Number.isNaN(body.epf.total_remittance)).toBe(false)

    // ESI: 150+150=300, 650+650=1300, 800+800=1600
    expect(body.esi.employee_contribution).toBe(300)
    expect(body.esi.employer_contribution).toBe(1300)
    expect(body.esi.total_remittance).toBe(1600)

    // PTax: by_state KA=200+200=400, MH=208; total_remittance=608
    expect(body.ptax.total_remittance).toBe(608)
    const byState = Object.fromEntries(body.ptax.by_state.map((r: any) => [r.state_code, r.amount]))
    expect(byState.KA).toBe(400)
    expect(byState.MH).toBe(208)

    // TDS: 5000+7500.5=12500.5
    expect(body.tds.total_deducted).toBe(12500.5)

    // grand_total_remittance must also be a real finite number, not NaN
    expect(Number.isFinite(body.grand_total_remittance)).toBe(true)
    expect(Number.isNaN(body.grand_total_remittance)).toBe(false)
    const expectedGrandTotal = body.epf.total_remittance + body.esi.total_remittance + body.ptax.total_remittance + body.tds.total_deducted
    expect(body.grand_total_remittance).toBeCloseTo(expectedGrandTotal, 2)
  })

  it('a month with a single contribution row per table still totals correctly (no regression on the 1-row case)', async () => {
    const app = await buildApp({
      epfRows: [{ employee_contribution: '1800.00', voluntary_pf: '0.00', employer_pf: '1800.00', employer_eps: '1250.00', edli_contribution: '75.00', pf_wages: '15000.00' }],
      esiRows: [],
      ptaxRows: [{ ptax_amount: '200.00', state_code: 'KA' }],
      tdsRows: [{ tds_deducted: '0.00' }],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/challan?month=2026-10',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json().data
    expect(body.epf.employee_contribution).toBe(1800)
    expect(body.ptax.total_remittance).toBe(200)
    expect(body.tds.total_deducted).toBe(0)
    expect(Number.isFinite(body.grand_total_remittance)).toBe(true)
  })
})
