/**
 * POST /payroll/statutory/tds/reconciliation/compute — pagination regression
 *
 * tds_declaration_snapshots and payroll_slips are fetched per 100-employee
 * .in() chunk. Before the fix, each chunk issued one unpaginated query, so a
 * chunk whose employees collectively have more rows in the financial year
 * than PostgREST's max-rows setting (one snapshot per payroll run; one slip
 * per month) silently lost rows past the cap — defaulting the missing
 * employees' projected/actual TDS to 0 and corrupting the reconciliation.
 *
 * This test simulates a low max-rows ceiling (50) on both tables so a single
 * 100-employee chunk with 1 row/employee (120 total across 2 chunks) can
 * only be read correctly if the handler loops with .range() until an empty
 * page, as fetchAllRows does. A handler that queries once per chunk (the old
 * code) would only see the first 50 rows of each table and silently treat
 * every other employee as having no snapshot/slip.
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import tdsBulkRoutes from '../tds-bulk.js'
import { makeMockTable } from '../../../../lib/__tests__/test-helpers/postgrest-mock.js'

const TENANT_ID = 'tenant-tds-recon-001'
const PAGE_CAP = 50

function uuid(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
}
function slipUuid(i: number): string {
  return `00000000-0000-4000-8001-${String(i).padStart(12, '0')}`
}

function makeTable(rows: any[], pageCap = Infinity) {
  return makeMockTable(rows, { pageCap })
}

async function buildApp(opts: { employees: Array<{ id: string }>; snapshots: any[]; slips: any[] }) {
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
      if (table === 'employees')                   return makeTable(opts.employees)
      if (table === 'tds_declaration_snapshots')    return makeTable(opts.snapshots, PAGE_CAP)
      if (table === 'payroll_slips')                return makeTable(opts.slips, PAGE_CAP)
      if (table === 'tax_projection_reconciliation') return makeTable([])
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(tdsBulkRoutes)
  await app.ready()
  return app
}

describe('POST /payroll/statutory/tds/reconciliation/compute — pagination past a low max-rows cap', () => {
  it('reconciles every employee even when snapshots+slips exceed the simulated max-rows cap per chunk', async () => {
    const N = 120 // > PAGE_CAP (50), forces 3 round trips per 120-row table
    const employees = Array.from({ length: N }, (_, i) => ({ id: uuid(i), tenant_id: TENANT_ID }))
    const financialYear = '2025-26'

    // One snapshot and one slip per employee — if the handler stopped after
    // a single unpaginated read of 50 rows, employees 50..119 would be
    // silently treated as projected=0 (no risk flag -> reconciliation_status
    // defaults to 'matched' instead of reflecting an actual mismatch).
    const snapshots = employees.map(e => ({
      employee_id: e.id, total_approved: 10000, created_at: '2025-06-01T00:00:00Z',
      tenant_id: TENANT_ID, financial_year: financialYear,
    }))
    const slips = employees.map((e, i) => ({
      id: slipUuid(i), employee_id: e.id, tds_deducted: '5000.00', month: '2025-06', tenant_id: TENANT_ID,
    }))

    const app = await buildApp({ employees, snapshots, slips })

    const res = await app.inject({
      method: 'POST',
      url: '/reconciliation/compute',
      headers: { authorization: 'Bearer test-token' },
      payload: { financial_year: financialYear, employee_ids: employees.map(e => e.id) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // Every one of the 120 employees has projected=10000, actual=5000 — a
    // 50% under-deduction (< projected*0.9) — so all 120 must be flagged
    // high-variance. If pagination silently dropped employees 50..119's
    // snapshot/slip rows, this count would be far lower than 120.
    expect(body.computed).toBe(120)
    expect(body.high_variance).toBe(120)
  })

  it('a chunk at or under the cap is unaffected (no regression on the small-tenant case)', async () => {
    const financialYear = '2025-26'
    const employees = Array.from({ length: 5 }, (_, i) => ({ id: uuid(i), tenant_id: TENANT_ID }))
    const snapshots = employees.map(e => ({
      employee_id: e.id, total_approved: 1000, created_at: '2025-06-01T00:00:00Z',
      tenant_id: TENANT_ID, financial_year: financialYear,
    }))
    const slips = employees.map((e, i) => ({ id: slipUuid(i), employee_id: e.id, tds_deducted: '1000.00', month: '2025-06', tenant_id: TENANT_ID }))

    const app = await buildApp({ employees, snapshots, slips })

    const res = await app.inject({
      method: 'POST',
      url: '/reconciliation/compute',
      headers: { authorization: 'Bearer test-token' },
      payload: { financial_year: financialYear, employee_ids: employees.map(e => e.id) },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.computed).toBe(5)
    expect(body.high_variance).toBe(0) // projected == actual, no variance
  })
})
