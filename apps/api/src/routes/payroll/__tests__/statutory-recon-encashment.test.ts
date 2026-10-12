/**
 * GET /payroll/statutory-reconciliation — leave-encashment TDS must not
 * manufacture a spurious variance.
 *
 * tds_monthly_projections (the "payable" side) only ever models RECURRING
 * monthly salary — it has no forward projection for a one-time standalone
 * leave-encashment payout. Before this fix, buildStatutoryRecon's "computed"
 * side (correctly, from payroll_slips.component_breakdown) included the
 * encashment's own TDS withholding while "payable" did not, so any month
 * containing a finalized encashment payout showed a variance ≥ its TDS
 * amount — potentially blocking /close for a reason that isn't a real
 * discrepancy. The fix adds the paid encashment requests' tds_amount for
 * this run to the payable side too, since that figure is already
 * independently confirmed (it's exactly what HR reviewed and approved on
 * the standalone request itself).
 */
import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import statutoryReconRoutes from '../statutory-recon.js'

const TENANT_ID = 'tenant-recon-001'
const RUN_ID = 'run-001'

function rangeChain(rows: unknown[]) {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain,
    range: (from: number) => Promise.resolve(from === 0 ? { data: rows, error: null } : { data: [], error: null }),
  }
  return chain
}

// fetchAllRowsByKeyset calls supabase.from(table) FRESH for every page, so
// the "already served a page" flag must live OUTSIDE the per-call chain
// object (keyed by table) or each new chain instance resets it, looping
// forever since these fixture rows carry no `id` for afterId/gt() to
// actually narrow by.
function keysetChainFactory(rows: unknown[]) {
  let served = false
  return () => {
    const chain: any = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, gt: () => chain,
      then: (resolve: (v: unknown) => void) => {
        if (served) { resolve({ data: [], error: null }); return }
        served = true
        resolve({ data: rows, error: null })
      },
    }
    return chain
  }
}

function plainChain(result: unknown) {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, in: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return chain
}

async function buildApp(opts: {
  run: Record<string, any>
  slips: Array<Record<string, any>>
  tdsProjectionRows?: Array<Record<string, any>>
  encashmentRows?: Array<Record<string, any>>
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

  const epfChain  = keysetChainFactory([])
  const esiChain  = keysetChainFactory([])
  const ptaxChain = keysetChainFactory([])
  const tdsChain  = keysetChainFactory(opts.tdsProjectionRows ?? [])

  app.decorate('supabase', {
    from(table: string) {
      if (table === 'payroll_runs')              return plainChain({ data: opts.run, error: null })
      if (table === 'payroll_slips')             return rangeChain(opts.slips)
      if (table === 'epf_contributions')         return epfChain()
      if (table === 'esi_contributions')         return esiChain()
      if (table === 'ptax_contributions')        return ptaxChain()
      if (table === 'tds_monthly_projections')   return tdsChain()
      if (table === 'leave_encashment_requests') return plainChain({ data: opts.encashmentRows ?? [], error: null })
      if (table === 'statutory_filing_closures') return plainChain({ data: [], error: null })
      return plainChain({ data: [], error: null })
    },
  } as any)

  await app.register(statutoryReconRoutes)
  await app.ready()
  return app
}

const HEADERS = { authorization: 'Bearer test-token' }

describe('GET /payroll/statutory-reconciliation — encashment TDS reconciliation', () => {
  it('a month with a finalized encashment payout shows zero TDS variance, not a spurious one', async () => {
    const app = await buildApp({
      run: { id: RUN_ID, month: '2026-11', status: 'finalized', employee_count: 1, total_gross: 0, total_net: 0, total_deductions: 0 },
      slips: [{
        employee_id: 'emp-1',
        component_breakdown: [
          { code: 'TDS', monthly_amount: 3000 },   // 2500 recurring + 500 encashment, folded together on the slip
        ],
      }],
      tdsProjectionRows: [{ id: 'proj-1', tds_this_month: 2500 }],  // recurring-only projection, no knowledge of the encashment
      encashmentRows: [{ tds_amount: 500 }],
    })

    const res = await app.inject({ method: 'GET', url: '/payroll/statutory-reconciliation', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    const tds = res.json().data.tds

    expect(tds.computed).toBe(3000)
    // Without the fix, payable would be 2500 and variance -500.
    expect(tds.payable).toBe(3000)
    expect(tds.variance).toBe(0)
    expect(tds.ready).toBe(true)
  })

  it('a month with NO encashment payout is unaffected (no regression on the ordinary case)', async () => {
    const app = await buildApp({
      run: { id: RUN_ID, month: '2026-11', status: 'finalized', employee_count: 1, total_gross: 0, total_net: 0, total_deductions: 0 },
      slips: [{ employee_id: 'emp-1', component_breakdown: [{ code: 'TDS', monthly_amount: 2500 }] }],
      tdsProjectionRows: [{ id: 'proj-1', tds_this_month: 2500 }],
      encashmentRows: [],
    })

    const res = await app.inject({ method: 'GET', url: '/payroll/statutory-reconciliation', headers: HEADERS })
    const tds = res.json().data.tds
    expect(tds.computed).toBe(2500)
    expect(tds.payable).toBe(2500)
    expect(tds.variance).toBe(0)
  })

  it('a real recurring-TDS discrepancy (unrelated to encashment) still shows up as variance', async () => {
    const app = await buildApp({
      run: { id: RUN_ID, month: '2026-11', status: 'finalized', employee_count: 1, total_gross: 0, total_net: 0, total_deductions: 0 },
      slips: [{ employee_id: 'emp-1', component_breakdown: [{ code: 'TDS', monthly_amount: 3000 }] }],
      tdsProjectionRows: [{ id: 'proj-1', tds_this_month: 2500 }],  // genuinely under-projected, no encashment involved
      encashmentRows: [],
    })

    const res = await app.inject({ method: 'GET', url: '/payroll/statutory-reconciliation', headers: HEADERS })
    const tds = res.json().data.tds
    expect(tds.computed).toBe(3000)
    expect(tds.payable).toBe(2500)
    expect(tds.variance).toBe(-500)
    expect(tds.ready).toBe(false)
  })
})
