/**
 * POST /payroll/statutory-reconciliation/close — wiring to
 * close_statutory_filing_atomic (migration 452).
 *
 * The route's own job is to run buildStatutoryRecon (read-only, complex,
 * already covered by statutory-recon-encashment.test.ts) to decide which
 * statutes are eligible, then hand the candidate rows to the atomic RPC,
 * which re-validates (under a payroll_runs row lock) that the run is still
 * finalized and that none of these rows were filed by a concurrent request
 * since this route's own earlier, unlocked read — real concurrency proof
 * for that RPC itself is scripts/db/verify-rollback-concurrency.mjs
 * sections C/D; a mocked RPC response can't exercise locking, so these
 * tests are scoped to what they can prove: the route calls the RPC with
 * the right rows and correctly merges its response back into the reply.
 */
import { describe, it, expect, vi } from 'vitest'
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
  existingClosures?: Array<Record<string, any>>
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
  const rpc = vi.fn()

  app.decorate('supabase', {
    from(table: string) {
      if (table === 'payroll_runs')              return plainChain({ data: opts.run, error: null })
      if (table === 'payroll_slips')             return rangeChain(opts.slips)
      if (table === 'epf_contributions')         return epfChain()
      if (table === 'esi_contributions')         return esiChain()
      if (table === 'ptax_contributions')        return ptaxChain()
      if (table === 'tds_monthly_projections')   return tdsChain()
      if (table === 'leave_encashment_requests') return plainChain({ data: [], error: null })
      if (table === 'statutory_filing_closures') return plainChain({ data: opts.existingClosures ?? [], error: null })
      return plainChain({ data: [], error: null })
    },
    rpc,
  } as any)

  await app.register(statutoryReconRoutes)
  await app.ready()
  return { app, rpc }
}

const HEADERS = { authorization: 'Bearer test-token', 'content-type': 'application/json' }

const RECONCILED_FIXTURE = {
  run: { id: RUN_ID, month: '2026-11', status: 'finalized', employee_count: 1, total_gross: 0, total_net: 0, total_deductions: 0 },
  slips: [{ employee_id: 'emp-1', component_breakdown: [{ code: 'TDS', monthly_amount: 2500 }] }],
  tdsProjectionRows: [{ id: 'proj-1', tds_this_month: 2500 }],
}

describe('POST /payroll/statutory-reconciliation/close', () => {
  it('a reconciled statute calls close_statutory_filing_atomic with the run id and the computed row, returns what the RPC reports filed', async () => {
    const { app, rpc } = await buildApp(RECONCILED_FIXTURE)
    rpc.mockResolvedValueOnce({ data: { filed: ['tds'], skipped_already_filed: [] }, error: null })

    const res = await app.inject({
      method: 'POST', url: '/payroll/statutory-reconciliation/close', headers: HEADERS,
      payload: { month: '2026-11', statutes: ['tds'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.filed).toEqual(['tds'])
    expect(body.skipped).toEqual([])
    expect(rpc).toHaveBeenCalledWith('close_statutory_filing_atomic', expect.objectContaining({
      p_tenant_id: TENANT_ID, p_run_id: RUN_ID,
      p_rows: expect.arrayContaining([expect.objectContaining({ statutory_type: 'tds', month: '2026-11' })]),
    }))
  })

  it('a statute that does not reconcile is skipped BEFORE the RPC is even called — no row sent for it', async () => {
    const { app, rpc } = await buildApp({
      run: { id: RUN_ID, month: '2026-11', status: 'finalized', employee_count: 1, total_gross: 0, total_net: 0, total_deductions: 0 },
      slips: [{ employee_id: 'emp-1', component_breakdown: [{ code: 'TDS', monthly_amount: 3000 }] }],
      tdsProjectionRows: [{ id: 'proj-1', tds_this_month: 2500 }],  // genuine variance
    })

    const res = await app.inject({
      method: 'POST', url: '/payroll/statutory-reconciliation/close', headers: HEADERS,
      payload: { month: '2026-11', statutes: ['tds'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.filed).toEqual([])
    expect(body.skipped[0].statute).toBe('tds')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('RUN_NOT_FINALIZED from the RPC (a concurrent rollback landed between this route\'s own check and the RPC call) → 409', async () => {
    const { app, rpc } = await buildApp(RECONCILED_FIXTURE)
    rpc.mockResolvedValueOnce({ data: null, error: { message: "RUN_NOT_FINALIZED: Payroll run for 2026-11 is no longer finalized (current: draft) — it may have been rolled back concurrently." } })

    const res = await app.inject({
      method: 'POST', url: '/payroll/statutory-reconciliation/close', headers: HEADERS,
      payload: { month: '2026-11', statutes: ['tds'] },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('RUN_NOT_FINALIZED')
  })

  it('the RPC\'s own fresh idempotency check (skipped_already_filed) is merged into the response as already_filed, not silently dropped', async () => {
    const { app, rpc } = await buildApp(RECONCILED_FIXTURE)
    // A concurrent request filed this exact statute between this route's own
    // unlocked pre-check and the RPC call — the RPC's OWN re-check under the
    // lock is what actually catches this, not the route's earlier read.
    rpc.mockResolvedValueOnce({ data: { filed: [], skipped_already_filed: ['tds'] }, error: null })

    const res = await app.inject({
      method: 'POST', url: '/payroll/statutory-reconciliation/close', headers: HEADERS,
      payload: { month: '2026-11', statutes: ['tds'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.filed).toEqual([])
    expect(body.skipped).toEqual(expect.arrayContaining([{ statute: 'tds', reason: 'already_filed' }]))
  })

  it('an unrecognized RPC error falls back to a generic 500, never leaking the raw DB message', async () => {
    const { app, rpc } = await buildApp(RECONCILED_FIXTURE)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint "statutory_filing_closures_pkey"' } })

    const res = await app.inject({
      method: 'POST', url: '/payroll/statutory-reconciliation/close', headers: HEADERS,
      payload: { month: '2026-11', statutes: ['tds'] },
    })

    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('statutory_filing_closures_pkey')
  })
})
