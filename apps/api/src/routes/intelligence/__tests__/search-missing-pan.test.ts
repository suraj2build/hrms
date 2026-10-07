/**
 * POST /intelligence/search — 'missing_pan' filter
 *
 * employee_bank_statutory only has a row for an employee once they've
 * completed the statutory-details step. A naive
 * `.from('employee_bank_statutory').is('pan_number', null)` query only finds
 * employees who HAVE a row with a null pan_number — it misses every employee
 * who has no statutory row at all, which is the common case for anyone who
 * hasn't reached that step yet. It also previously swallowed query errors
 * into an empty result (silently reporting "nobody is missing a PAN").
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import intelligenceRoutes from '../index.js'

const TENANT_ID = 'tenant-test-001'

function genericChain(result: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain, neq: () => chain, gte: () => chain, lte: () => chain, lt: () => chain,
    in: () => chain, not: () => chain, is: () => chain, or: () => chain, order: () => chain,
    limit: () => chain, ilike: () => chain,
    maybeSingle: () => Promise.resolve(result),
    range: (from: number) => Promise.resolve(from === 0 ? result : { data: [], error: null }),
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return chain
}

async function buildApp(opts: {
  activeEmployees: Array<{ id: string }>
  statutoryRows: Array<{ employee_id: string; pan_number: string | null }>
  statutoryThrows?: boolean
  detailLookupThrows?: boolean
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
      if (table === 'tenants') return genericChain({ data: { timezone: 'UTC' }, error: null })
      if (table === 'employees') {
        // Two distinct queries hit this table: fetchAllRows's full active-employee
        // scan (.eq('status','active').range(...), no .in()) and the final
        // display query (.in('id', empIds).limit(50)). Filter by `.in('id', ...)`
        // when present so each gets the right rows.
        let filterIds: string[] | null = null
        const chain: any = {
          select: () => chain, eq: () => chain, neq: () => chain, order: () => chain,
          in: (_col: string, ids: string[]) => { filterIds = ids; return chain },
          limit: () => chain,
          range: (from: number) => {
            if (from !== 0) return Promise.resolve({ data: [], error: null })
            const rows = filterIds ? opts.activeEmployees.filter(e => filterIds!.includes(e.id)) : opts.activeEmployees
            return Promise.resolve({ data: rows, error: null })
          },
          then: (resolve: (v: unknown) => void) => {
            // filterIds set => this is the final per-employee detail lookup
            // (.in('id', empIds).limit(50)), not the fetchAllRows scan.
            if (filterIds && opts.detailLookupThrows) {
              resolve({ data: null, error: new Error('db unavailable') })
              return
            }
            const rows = filterIds ? opts.activeEmployees.filter(e => filterIds!.includes(e.id)) : opts.activeEmployees
            resolve({ data: rows, error: null })
          },
        }
        return chain
      }
      if (table === 'employee_bank_statutory') {
        if (opts.statutoryThrows) {
          return { select: () => ({ eq: () => ({ range: () => Promise.resolve({ data: null, error: new Error('db unavailable') }) }) }) }
        }
        return genericChain({ data: opts.statutoryRows, error: null })
      }
      return genericChain({ data: [], error: null })
    },
  } as any)

  await app.register(intelligenceRoutes)
  await app.ready()
  return app
}

describe("POST /intelligence/search — 'missing PAN'", () => {
  it('includes an employee with no employee_bank_statutory row at all', async () => {
    const app = await buildApp({
      activeEmployees: [
        { id: 'emp-no-row' },       // never did the statutory step
        { id: 'emp-has-pan' },      // has a row, PAN set
      ],
      statutoryRows: [
        { employee_id: 'emp-has-pan', pan_number: 'ABCDE1234F' },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'employees without PAN' },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const ids = body.employees.map((e: any) => e.id)
    expect(ids).toContain('emp-no-row')
    expect(ids).not.toContain('emp-has-pan')
  })

  it('includes an employee whose statutory row has pan_number IS NULL', async () => {
    const app = await buildApp({
      activeEmployees: [{ id: 'emp-null-pan' }],
      statutoryRows: [{ employee_id: 'emp-null-pan', pan_number: null }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'employees without PAN' },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().employees.map((e: any) => e.id)).toContain('emp-null-pan')
  })

  it('excludes an employee with a PAN on file', async () => {
    const app = await buildApp({
      activeEmployees: [{ id: 'emp-has-pan' }],
      statutoryRows: [{ employee_id: 'emp-has-pan', pan_number: 'ABCDE1234F' }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'employees without PAN' },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().employees).toEqual([])
  })

  it('a query failure propagates as a 500, not a silent empty result', async () => {
    const app = await buildApp({
      activeEmployees: [{ id: 'emp-1' }],
      statutoryRows: [],
      statutoryThrows: true,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'employees without PAN' },
      headers: { authorization: 'Bearer test-token' },
    })

    // Previously this failure was swallowed (try/catch -> empIds=[]), returning
    // 200 with an empty "no one is missing a PAN" result. It must now surface
    // as a failure, not a false negative.
    expect(res.statusCode).toBe(500)
  })

  it('a failure in the final per-employee detail lookup also propagates as a 500', async () => {
    const app = await buildApp({
      activeEmployees: [{ id: 'emp-no-row' }],
      statutoryRows: [],
      detailLookupThrows: true,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'employees without PAN' },
      headers: { authorization: 'Bearer test-token' },
    })

    // The two fetchAllRows scans succeed and correctly identify emp-no-row as
    // missing a PAN; only the subsequent .in('id', empIds).limit(50) detail
    // lookup fails. That query previously read only `data` (ignoring `error`),
    // which would have resolved `employees = data ?? []` to `[]` and returned
    // 200 with an empty result — the exact same silent-false-negative shape
    // as the two scans above, just one query later.
    expect(res.statusCode).toBe(500)
  })
})
