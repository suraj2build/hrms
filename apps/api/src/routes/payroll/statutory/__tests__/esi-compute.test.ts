/**
 * POST /payroll/statutory/esi/contributions/compute — G13 sweep regression
 *
 * Drives the REAL route handler (not just computeESI in isolation) through a
 * real HTTP request, with esi_config.wage_ceiling and payroll_slips.gross_pay
 * returned exactly as PostgREST/Supabase actually shape them: strings, not
 * numbers. Before the fix, `grossWages <= config.wageCeiling` silently did an
 * ALPHABETICAL string comparison — no error, no NaN, just wrong eligibility
 * (e.g. "9500.00" > "21000.00" alphabetically, since '9' > '2'). This test
 * reconciles the actual PERSISTED esi_contributions upsert payload, not just
 * an in-memory return value, against the two employees this exact scenario
 * would have gotten backwards.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import esiRoutes from '../esi.js'

const TENANT_ID = 'tenant-test-001'

function genericChain(result: unknown, opts: { paged?: boolean } = {}) {
  const chain: any = {
    select: () => chain,
    eq: () => chain, neq: () => chain, gte: () => chain, lte: () => chain,
    in: () => chain, not: () => chain, order: () => chain, limit: () => chain,
    or: () => chain,
    maybeSingle: () => Promise.resolve(result),
    single:      () => Promise.resolve(result),
    delete: () => Promise.resolve({ error: null }),
    upsert: (rows: any[]) => { upsertSpyTarget?.(rows); return Promise.resolve({ error: null }) },
    range: (from: number) => Promise.resolve(
      !opts.paged || from === 0 ? result : { data: [], error: null },
    ),
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return chain
}
// Set per-test so the upsert closure above can reach the current test's spy.
let upsertSpyTarget: ((rows: any[]) => void) | undefined

async function buildApp(opts: {
  wageCeilingAsString: string
  slips: Array<{ employee_id: string; gross_pay: string; component_breakdown: any[] }>
  employees: Array<{ id: string; employee_code: string }>
}) {
  const upsertSpy = vi.fn()
  upsertSpyTarget = upsertSpy

  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'hr-admin-1'
    ;(req as any).userRole = 'hr_admin'
  })

  let empPageServed = false
  app.decorate('supabase', {
    from(table: string) {
      if (table === 'payroll_runs') return { select: () => genericChain({ data: { id: 'run-1', status: 'finalized' }, error: null }) }
      if (table === 'esi_config') {
        return { select: () => genericChain({ data: { employee_contribution_pct: '0.75', employer_contribution_pct: '3.25', wage_ceiling: opts.wageCeilingAsString }, error: null }) }
      }
      if (table === 'employees') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                range: () => {
                  if (empPageServed) return Promise.resolve({ data: [], error: null })
                  empPageServed = true
                  return Promise.resolve({ data: opts.employees, error: null })
                },
              }),
            }),
          }),
        }
      }
      if (table === 'employee_statutory_overrides') return { select: () => genericChain({ data: [], error: null }) }
      if (table === 'esi_eligibility_timeline')     return { select: () => genericChain({ data: [], error: null }) }
      if (table === 'payroll_slips')                return { select: () => genericChain({ data: opts.slips, error: null }) }
      if (table === 'esi_contributions') {
        return {
          delete: () => genericChain({ error: null }),
          upsert: (rows: any[]) => { upsertSpy(rows); return Promise.resolve({ error: null }) },
        }
      }
      return genericChain({ data: [], error: null }, { paged: true })
    },
  } as any)

  await app.register(esiRoutes)
  await app.ready()

  return { app, upsertSpy }
}

describe('POST /payroll/statutory/esi/contributions/compute — DB-string wage_ceiling/gross_pay (G13 sweep)', () => {
  it('correctly separates an employee below the ceiling from one above it, both given as real DB strings', async () => {
    const { app, upsertSpy } = await buildApp({
      wageCeilingAsString: '21000.00',
      slips: [
        { employee_id: 'emp-low',  gross_pay: '9500.00',  component_breakdown: [] },   // eligible: 9500 <= 21000
        { employee_id: 'emp-high', gross_pay: '150000.00', component_breakdown: [] },  // ineligible: 150000 > 21000
      ],
      employees: [
        { id: 'emp-low',  employee_code: 'E1' },
        { id: 'emp-high', employee_code: 'E2' },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/contributions/compute',
      payload: { month: '2026-10' },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // Before the fix, alphabetical string comparison would flip both of these:
    // "9500.00" > "21000.00" (since '9' > '2') -> wrongly marked ineligible,
    // "150000.00" < "21000.00" (since '1' < '2') -> wrongly marked eligible.
    // skipped_ineligible counts only override-table exclusions, not wage-ceiling
    // ones — emp-high's exclusion shows up as simply not being in `contributions`.
    expect(body.computed_count).toBe(1)          // only emp-low is eligible

    // Reconcile against the actual PERSISTED upsert payload, not just the response body.
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const persistedRows = upsertSpy.mock.calls[0][0] as any[]
    expect(persistedRows).toHaveLength(1)
    expect(persistedRows[0].employee_id).toBe('emp-low')
    expect(persistedRows[0].is_eligible).toBe(true)
  })

  it('a genuinely low earner just under the ceiling is not dropped by string comparison', async () => {
    const { app, upsertSpy } = await buildApp({
      wageCeilingAsString: '21000.00',
      slips: [{ employee_id: 'emp-1', gross_pay: '20999.00', component_breakdown: [] }],
      employees: [{ id: 'emp-1', employee_code: 'E1' }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/contributions/compute',
      payload: { month: '2026-10' },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().computed_count).toBe(1)
    const persistedRows = upsertSpy.mock.calls[0][0] as any[]
    expect(persistedRows[0].is_eligible).toBe(true)
  })

  it('an employee exactly at the ceiling is still eligible (<=, not <)', async () => {
    const { app, upsertSpy } = await buildApp({
      wageCeilingAsString: '21000.00',
      slips: [{ employee_id: 'emp-1', gross_pay: '21000.00', component_breakdown: [] }],
      employees: [{ id: 'emp-1', employee_code: 'E1' }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/contributions/compute',
      payload: { month: '2026-10' },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().computed_count).toBe(1)
    expect(upsertSpy.mock.calls[0][0][0].is_eligible).toBe(true)
  })
})
