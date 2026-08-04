/**
 * Cost Centers — optimistic-concurrency (CAS) behaviour on PUT (PEND-105)
 *
 * This is the reference test for the CAS pattern applied uniformly across
 * all PEND-105 Phase B endpoints: `expected_version` is optional in the
 * request body (backward-compatible with a frontend not yet updated to
 * send it — PEND-105 Phase C); when present, the UPDATE's WHERE clause
 * adds `.eq('version', expected_version)`, and a 0-row result is
 * disambiguated between "record doesn't exist" (404) and "record exists
 * but was edited since expected_version was read" (409 VERSION_CONFLICT)
 * via one follow-up existence SELECT.
 *
 * Scenarios covered:
 *   1. No expected_version in body — plain update, no version filter applied
 *   2. Correct expected_version — update succeeds, 200
 *   3. Stale expected_version (record exists, version moved on) — 409 VERSION_CONFLICT
 *   4. expected_version on a since-deleted record — 404, not 409
 *
 * What is NOT tested here: the DB trigger that increments `version` on
 * write (SQL, not exercised by these JS-side route tests — see migration
 * 428's own header comment for that mechanism).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import costCentersRoutes from '../cost-centers.js'

const TENANT_ID = 'tenant-test-001'
const RECORD_ID = 'cc-001'

interface ChainCall { method: string; args: unknown[] }

/** A minimal hand-rolled chainable query-builder mock — records every
 *  method call so tests can assert exactly which .eq() filters were
 *  applied, and resolves to a caller-supplied result when awaited. */
function makeChain(result: { data: unknown; error: unknown }) {
  const calls: ChainCall[] = []
  const chain: any = {
    calls,
    update: (...a: unknown[]) => { calls.push({ method: 'update', args: a }); return chain },
    select: (...a: unknown[]) => { calls.push({ method: 'select', args: a }); return chain },
    eq:     (...a: unknown[]) => { calls.push({ method: 'eq',     args: a }); return chain },
    maybeSingle: () => Promise.resolve(result),
  }
  return chain
}

function buildMockSupabase(updateResult: { data: unknown; error: unknown }, existsResult?: { data: unknown; error: unknown }) {
  const updateChain = makeChain(updateResult)
  const existsChain = existsResult ? makeChain(existsResult) : null
  let fromCallCount = 0
  const supabase = {
    from: (table: string) => {
      if (table !== 'cost_centers') throw new Error(`unexpected table "${table}"`)
      fromCallCount += 1
      // 1st .from() call in the route is the UPDATE chain; a 2nd call (the
      // disambiguation existence check) only happens on a 0-row CAS miss.
      if (fromCallCount === 1) return updateChain
      if (!existsChain) throw new Error('unexpected second .from() call — no existsResult configured')
      return existsChain
    },
  }
  return { supabase, updateChain, existsChain }
}

async function buildApp(supabase: unknown): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userRole', '')
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userRole = 'hr_admin'
  })
  app.decorate('supabase', supabase as any)
  await app.register(costCentersRoutes)
  await app.ready()
  return app
}

beforeEach(() => { vi.clearAllMocks() })

describe('PUT /masters/cost-centers/:id — CAS', () => {
  it('no expected_version in body — updates without a version filter', async () => {
    const row = { id: RECORD_ID, name: 'Updated', code: 'CC1', description: null, is_active: true, version: 2, created_at: '2099-01-01' }
    const { supabase, updateChain } = buildMockSupabase({ data: row, error: null })
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'PUT', url: `/${RECORD_ID}`, payload: { name: 'Updated' },
      headers: { authorization: 'Bearer test' },
    })

    expect(res.statusCode).toBe(200)
    const eqCalls = updateChain.calls.filter((c: ChainCall) => c.method === 'eq')
    expect(eqCalls.some((c: ChainCall) => c.args[0] === 'version')).toBe(false)
  })

  it('correct expected_version — applies the version filter and succeeds', async () => {
    const row = { id: RECORD_ID, name: 'Updated', code: 'CC1', description: null, is_active: true, version: 2, created_at: '2099-01-01' }
    const { supabase, updateChain } = buildMockSupabase({ data: row, error: null })
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'PUT', url: `/${RECORD_ID}`, payload: { name: 'Updated', expected_version: 1 },
      headers: { authorization: 'Bearer test' },
    })

    expect(res.statusCode).toBe(200)
    const eqCalls = updateChain.calls.filter((c: ChainCall) => c.method === 'eq')
    expect(eqCalls.some((c: ChainCall) => c.args[0] === 'version' && c.args[1] === 1)).toBe(true)
  })

  it('stale expected_version — 0 rows matched, record still exists → 409 VERSION_CONFLICT', async () => {
    const { supabase } = buildMockSupabase(
      { data: null, error: null },
      { data: { id: RECORD_ID }, error: null },
    )
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'PUT', url: `/${RECORD_ID}`, payload: { name: 'Updated', expected_version: 1 },
      headers: { authorization: 'Bearer test' },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('VERSION_CONFLICT')
  })

  it('expected_version on a since-deleted record — 0 rows matched, record gone → 404 not 409', async () => {
    const { supabase } = buildMockSupabase(
      { data: null, error: null },
      { data: null, error: null },
    )
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'PUT', url: `/${RECORD_ID}`, payload: { name: 'Updated', expected_version: 1 },
      headers: { authorization: 'Bearer test' },
    })

    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND')
  })
})
