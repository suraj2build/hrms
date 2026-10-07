/**
 * GET /payroll/filing-pack/readiness — pagination + chunking regression
 *
 * Two distinct failure modes were fixed here, and this test targets both:
 *
 * 1. Response-row-count truncation: the EPF-contributor scan (epf_contributions,
 *    one row per employee for the month) and the TDS-deducted slip scan
 *    (payroll_slips) were plain, unpaginated queries. At enterprise headcount
 *    these exceed PostgREST's max-rows cap and silently drop employees —
 *    understating missing_uan/missing_pan and falsely reporting readiness.
 *    Simulated here with a low max-rows cap (50) on both tables; the fix
 *    (fetchAllRows) must page past it with .range().
 *
 * 2. Request-size risk: the UAN-coverage (epf_eligibility_overrides) and
 *    PAN-coverage (employee_bank_statutory) lookups ran a single .in() over
 *    every EPF contributor / TDS deductee — a tenant-wide id list that can
 *    blow the request-line limit. Simulated here by making the mock reject
 *    any single .in() call carrying more than 100 ids; the fix chunks by 100.
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import filingPackRoutes from '../filing-pack.js'

const TENANT_ID = 'tenant-readiness-001'
const MONTH = '2026-06'
const ROW_PAGE_CAP = 50
const IN_CHUNK_LIMIT = 100

function uuid(i: number): string {
  return `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`
}

/** PostgREST-shaped mock. `pageCap` simulates a low max-rows ceiling on both
 *  a direct await and .range() reads. `inLimit` makes .in() throw once a
 *  single call carries more ids than a real request line could hold,
 *  simulating what an unchunked .in() would risk in production. */
function makeTable(rows: any[], opts: { pageCap?: number; inLimit?: number } = {}) {
  const pageCap = opts.pageCap ?? Infinity
  const inLimit = opts.inLimit ?? Infinity

  function build(filtered: any[], selectOpts: any = {}) {
    const api: any = {
      select(_cols: any, o: any) { return build(filtered, o || {}) },
      eq(col: string, val: any) { return build(filtered.filter(r => r[col] === val), selectOpts) },
      in(col: string, vals: any[]) {
        if (vals.length > inLimit) {
          throw new Error(`simulated request-line overflow: .in('${col}', [${vals.length} ids])`)
        }
        const set = new Set(vals)
        return build(filtered.filter(r => set.has(r[col])), selectOpts)
      },
      not(col: string, op: string, val: any) {
        if (op === 'is' && val === null) return build(filtered.filter(r => r[col] != null), selectOpts)
        return build(filtered, selectOpts)
      },
      is(col: string, val: any) {
        if (val === null) return build(filtered.filter(r => r[col] == null), selectOpts)
        return build(filtered, selectOpts)
      },
      gt(col: string, val: any) { return build(filtered.filter(r => Number(r[col]) > val), selectOpts) },
      order() { return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      range(from: number, to: number) {
        const size = Math.min(to - from + 1, pageCap)
        return Promise.resolve({ data: filtered.slice(from, from + size), error: null })
      },
      then(resolve: any, reject: any) {
        const result = selectOpts.head
          ? { data: null, count: filtered.length, error: null }
          : { data: filtered.slice(0, pageCap), error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return api
  }
  return build(rows)
}

async function buildApp(opts: {
  epfContributions: any[]
  epfOverrides: any[]
  payrollSlips: any[]
  bankStatutory: any[]
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
      if (table === 'epf_contributions')         return makeTable(opts.epfContributions, { pageCap: ROW_PAGE_CAP })
      if (table === 'epf_eligibility_overrides')  return makeTable(opts.epfOverrides, { inLimit: IN_CHUNK_LIMIT })
      if (table === 'payroll_slips')              return makeTable(opts.payrollSlips, { pageCap: ROW_PAGE_CAP })
      if (table === 'employee_bank_statutory')    return makeTable(opts.bankStatutory, { inLimit: IN_CHUNK_LIMIT })
      if (table === 'esi_contributions')          return makeTable([])
      if (table === 'ptax_contributions')         return makeTable([])
      if (table === 'statutory_registrations')    return makeTable([{ registration_number: 'REG-1', state_code: 'KA' }])
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(filingPackRoutes)
  await app.ready()
  return app
}

describe('GET /payroll/filing-pack/readiness — pagination past max-rows + chunked .in()', () => {
  it('reports the true missing-UAN/missing-PAN counts for a 120-employee tenant', async () => {
    const N = 120 // > ROW_PAGE_CAP (50) and > IN_CHUNK_LIMIT (100)
    const empIds = Array.from({ length: N }, (_, i) => uuid(i))

    const epfContributions = empIds.map(id => ({ employee_id: id, tenant_id: TENANT_ID, contribution_month: MONTH }))
    const payrollSlips = empIds.map(id => ({
      employee_id: id, tenant_id: TENANT_ID, month: MONTH, status: 'finalized', tds_deducted: '100.00',
    }))
    // UAN on file for employees at even indices only.
    const epfOverrides = empIds
      .filter((_, i) => i % 2 === 0)
      .map(id => ({ employee_id: id, tenant_id: TENANT_ID, uan: `UAN-${id}`, effective_to: null }))
    // PAN on file for employees at indices divisible by 3 only.
    const bankStatutory = empIds
      .filter((_, i) => i % 3 === 0)
      .map(id => ({ employee_id: id, tenant_id: TENANT_ID, pan_number: `PAN${id}` }))

    const expectedMissingUan = empIds.filter((_, i) => i % 2 !== 0).length
    const expectedMissingPan = empIds.filter((_, i) => i % 3 !== 0).length

    const app = await buildApp({ epfContributions, epfOverrides, payrollSlips, bankStatutory })

    const res = await app.inject({
      method: 'GET',
      url: `/readiness?month=${MONTH}`,
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.checks.epf.employee_count).toBe(N)
    expect(body.checks.epf.missing_uan).toBe(expectedMissingUan)
    expect(body.checks.tds.missing_pan).toBe(expectedMissingPan)
    // With missing UAN/PAN both nonzero, neither EPF nor TDS can be ready —
    // the pre-fix truncation would have under-reported these and could have
    // falsely flipped overall_ready to true.
    expect(body.checks.epf.ready).toBe(false)
    expect(body.checks.tds.ready).toBe(false)
    expect(body.overall_ready).toBe(false)
  })

  it('a small tenant (below both caps) is unaffected: full UAN/PAN coverage reads as ready', async () => {
    const N = 5
    const empIds = Array.from({ length: N }, (_, i) => uuid(i))
    const epfContributions = empIds.map(id => ({ employee_id: id, tenant_id: TENANT_ID, contribution_month: MONTH }))
    const payrollSlips = empIds.map(id => ({
      employee_id: id, tenant_id: TENANT_ID, month: MONTH, status: 'finalized', tds_deducted: '100.00',
    }))
    const epfOverrides = empIds.map(id => ({ employee_id: id, tenant_id: TENANT_ID, uan: `UAN-${id}`, effective_to: null }))
    const bankStatutory = empIds.map(id => ({ employee_id: id, tenant_id: TENANT_ID, pan_number: `PAN${id}` }))

    const app = await buildApp({ epfContributions, epfOverrides, payrollSlips, bankStatutory })

    const res = await app.inject({
      method: 'GET',
      url: `/readiness?month=${MONTH}`,
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.checks.epf.missing_uan).toBe(0)
    expect(body.checks.tds.missing_pan).toBe(0)
  })
})
