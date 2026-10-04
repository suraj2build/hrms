/**
 * POST /payroll/statutory/esi/contributions/compute — wage-base pagination
 * regression (A1 statutory wage-base cluster)
 *
 * Two distinct truncation risks in the SAME endpoint, both exercised here
 * against a 220-employee tenant with a simulated 50-row max-rows cap:
 *
 * 1. payroll_slips (slipGrossMap, the authoritative ESI wage source) — a
 *    plain query with no .range() would silently cap at the server's
 *    max-rows setting. 100 employees have a finalized slip; capped at 50,
 *    half of them would fall through to the (wrong) fallback path.
 * 2. employee_compensation_components (the fallback-gross source for
 *    employees without a finalized slip) — had NO chunking and NO
 *    pagination at all before this fix, despite several earning components
 *    per compensation (the row-per-id multiplier is not 1, unlike the other
 *    tables in this cluster). 120 employees fall back here, each with 3
 *    earning components = 360 rows, well past a 50-row cap and enough to
 *    overflow even a single 100-id chunk (300 rows in the first chunk alone).
 *
 * If either fix regresses, some employees' gross wages silently become 0,
 * and the sum of persisted employee_contribution across the fallback group
 * comes in under the correct total with no error.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import esiRoutes from '../esi.js'

const TENANT_ID = 'tenant-esi-wage-base-001'
const MONTH = '2026-06'
const ROW_PAGE_CAP = 50
const EMPLOYEE_PCT = 0.75

function empUuid(i: number): string {
  return `00000000-0000-4000-c000-${String(i).padStart(12, '0')}`
}
function compUuid(i: number): string {
  return `00000000-0000-4000-c001-${String(i).padStart(12, '0')}`
}

/** PostgREST-shaped mock: .range() pages respect a per-table max-rows cap;
 *  a direct await (no .range() in the chain) is also capped, simulating an
 *  unpaginated query hitting the real server-side ceiling. */
function makeTable(rows: any[], pageCap = Infinity) {
  function build(filtered: any[]) {
    const resolve = (r: any, col: string) => col.split('.').reduce((o, k) => o?.[k], r)
    const api: any = {
      select() { return api },
      eq(col: string, val: any) { return build(filtered.filter(r => resolve(r, col) === val)) },
      in(col: string, vals: any[]) {
        const set = new Set(vals)
        return build(filtered.filter(r => set.has(r[col])))
      },
      lte() { return api },
      gte() { return api },
      not(col: string, op: string, val: any) {
        if (op === 'in') {
          // .not('employee_id', 'in', '(a,b,c)') — stale-row cleanup delete filter; irrelevant to this mock's reads.
          return api
        }
        return api
      },
      is() { return api },
      or() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      delete() { return { eq: () => ({ eq: () => ({ not: () => Promise.resolve({ error: null }) }) }) } },
      upsert: (rows: any[]) => { upsertSpyTarget?.(rows); return Promise.resolve({ error: null }) },
      range(from: number, to: number) {
        const size = Math.min(to - from + 1, pageCap)
        return Promise.resolve({ data: filtered.slice(from, from + size), error: null })
      },
      then(resolve: any, reject: any) {
        return Promise.resolve({ data: filtered.slice(0, pageCap), error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return build(rows)
}
let upsertSpyTarget: ((rows: any[]) => void) | undefined

async function buildApp(opts: {
  employees: any[]
  slips: any[]
  compensations: any[]
  components: any[]
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

  app.decorate('supabase', {
    from(table: string) {
      if (table === 'payroll_runs')     return makeTable([{ id: 'run-1', status: 'finalized', tenant_id: TENANT_ID, month: MONTH }])
      if (table === 'esi_config')       return makeTable([{ employee_contribution_pct: String(EMPLOYEE_PCT), employer_contribution_pct: '3.25', wage_ceiling: '21000.00', tenant_id: TENANT_ID }])
      if (table === 'employees')        return makeTable(opts.employees)
      if (table === 'employee_statutory_overrides') return makeTable([])
      if (table === 'esi_eligibility_timeline')     return makeTable([])
      if (table === 'payroll_slips')     return makeTable(opts.slips, ROW_PAGE_CAP)
      if (table === 'employee_compensations')            return makeTable(opts.compensations, ROW_PAGE_CAP)
      if (table === 'employee_compensation_components')   return makeTable(opts.components, ROW_PAGE_CAP)
      if (table === 'esi_contributions') return makeTable([])
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(esiRoutes)
  await app.ready()
  return { app, upsertSpy }
}

describe('POST /payroll/statutory/esi/contributions/compute — wage-base pagination past a low max-rows cap', () => {
  it('computes full ESI contributions for all 220 employees despite a 50-row cap on slips and components', async () => {
    const SLIP_COUNT = 100     // > ROW_PAGE_CAP (50)
    const FALLBACK_COUNT = 120 // > the 100-id chunk size, and 120*3=360 component rows > ROW_PAGE_CAP (50)
    const N = SLIP_COUNT + FALLBACK_COUNT

    const employees = Array.from({ length: N }, (_, i) => ({ id: empUuid(i), employee_code: `E${i}`, tenant_id: TENANT_ID, status: 'active' }))

    // First 100 employees: finalized slip, gross 9500 (well under the 21000 ceiling).
    const slips = employees.slice(0, SLIP_COUNT).map(e => ({
      employee_id: e.id, tenant_id: TENANT_ID, month: MONTH, status: 'finalized',
      gross_pay: '9500.00', component_breakdown: [],
    }))

    // Remaining 120 employees: no slip — fall back to active compensation's
    // earning components. Each has 3 earning components summing to 9000.
    const fallbackEmps = employees.slice(SLIP_COUNT)
    const compensations = fallbackEmps.map((e, i) => ({ id: compUuid(i), employee_id: e.id, tenant_id: TENANT_ID, is_active: true }))
    const components = compensations.flatMap(c => [
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { component_type: 'earning' } },
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { component_type: 'earning' } },
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { component_type: 'earning' } },
    ])

    const { app, upsertSpy } = await buildApp({ employees, slips, compensations, components })

    const res = await app.inject({
      method: 'POST',
      url: '/contributions/compute',
      payload: { month: MONTH },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // All 220 are under the ceiling -> all eligible.
    expect(body.computed_count).toBe(N)

    const persisted = upsertSpy.mock.calls[0][0] as any[]
    expect(persisted).toHaveLength(N)

    const byEmp = new Map(persisted.map(r => [r.employee_id, r]))

    // Slip-path employees: esi_wages must reflect the full 9500, not a
    // truncated 0.
    for (const e of employees.slice(0, SLIP_COUNT)) {
      const row = byEmp.get(e.id)
      expect(row).toBeTruthy()
      expect(row.esi_wages).toBeCloseTo(9500, 2)
    }

    // Fallback-path employees: esi_wages must reflect the full 9000 (3x3000)
    // from their earning components. If the component chunk/pagination fix
    // regressed, components past the 50-row cap or the 100-id chunk
    // boundary would be silently dropped, understating or zeroing this sum.
    // 9000 * 0.75% = 67.5, rounded up to the nearest rupee by the ESI engine.
    const expectedPerEmployeeContribution = Math.ceil(9000 * (EMPLOYEE_PCT / 100))
    for (const e of fallbackEmps) {
      const row = byEmp.get(e.id)
      expect(row).toBeTruthy()
      expect(row.esi_wages).toBeCloseTo(9000, 2)
      expect(row.employee_contribution).toBe(expectedPerEmployeeContribution)
    }
  })
})
