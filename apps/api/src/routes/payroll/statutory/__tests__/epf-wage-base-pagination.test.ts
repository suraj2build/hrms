/**
 * POST /payroll/statutory/epf/contributions/compute — wage-base pagination
 * regression (A1 statutory wage-base cluster)
 *
 * Mirrors esi-wage-base-pagination.test.ts for EPF's own two truncation
 * risks against a 220-employee tenant with a simulated 50-row max-rows cap:
 *
 * 1. payroll_slips (the AUTHORITATIVE PF wage base) — truncation here is
 *    worse than a zero: a missing employee still gets a slip-less
 *    *fallback* pf_wages computed from pfBaseMap, so the bug produces a
 *    plausible-looking but wrong number, not an obvious zero.
 * 2. employee_compensation_components (pfBaseMap's PF-applicable-component
 *    source for employees with no slip) — unchunked and unpaginated before
 *    this fix. When truncated, pfBaseMap.get(id) misses and the code falls
 *    back to config.wageCeiling (15000) instead of the real component sum
 *    (9000 in this test) — a silently wrong EPF wage base with no error.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import epfRoutes from '../epf.js'

const TENANT_ID = 'tenant-epf-wage-base-001'
const MONTH = '2026-06'
const ROW_PAGE_CAP = 50

function empUuid(i: number): string {
  return `00000000-0000-4000-d000-${String(i).padStart(12, '0')}`
}
function compUuid(i: number): string {
  return `00000000-0000-4000-d001-${String(i).padStart(12, '0')}`
}

function makeTable(rows: any[], pageCap = Infinity) {
  const resolve = (r: any, col: string) => col.split('.').reduce((o, k) => o?.[k], r)
  function build(filtered: any[]) {
    const api: any = {
      select() { return api },
      eq(col: string, val: any) { return build(filtered.filter(r => resolve(r, col) === val)) },
      in(col: string, vals: any[]) {
        const set = new Set(vals)
        return build(filtered.filter(r => set.has(r[col])))
      },
      lte() { return api },
      gte() { return api },
      not() { return api },
      is() { return api },
      or() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
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
      if (table === 'epf_config')       return makeTable([{ wage_ceiling: '15000.00', tenant_id: TENANT_ID }])
      if (table === 'employees')        return makeTable(opts.employees)
      if (table === 'epf_eligibility_overrides') return makeTable([])
      if (table === 'payroll_slips')     return makeTable(opts.slips, ROW_PAGE_CAP)
      if (table === 'employee_compensations')           return makeTable(opts.compensations, ROW_PAGE_CAP)
      if (table === 'employee_compensation_components')  return makeTable(opts.components, ROW_PAGE_CAP)
      if (table === 'epf_contributions') return makeTable([])
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(epfRoutes)
  await app.ready()
  return { app, upsertSpy }
}

describe('POST /payroll/statutory/epf/contributions/compute — wage-base pagination past a low max-rows cap', () => {
  it('computes the correct PF wage base for all 220 employees despite a 50-row cap on slips and components', async () => {
    const SLIP_COUNT = 100     // > ROW_PAGE_CAP (50)
    const FALLBACK_COUNT = 120 // > the 100-id chunk size, and 120*3=360 component rows > ROW_PAGE_CAP (50)
    const N = SLIP_COUNT + FALLBACK_COUNT

    const employees = Array.from({ length: N }, (_, i) => ({ id: empUuid(i), employee_code: `E${i}`, tenant_id: TENANT_ID, status: 'active' }))

    // First 100 employees: finalized slip with a single PF-applicable earning of 9500.
    const slips = employees.slice(0, SLIP_COUNT).map(e => ({
      employee_id: e.id, tenant_id: TENANT_ID, month: MONTH, status: 'finalized',
      total_working_days: 30, payable_days: 30,
      component_breakdown: [
        { component_type: 'earning', is_pf_applicable: true, code: 'BASIC', monthly_amount: 9500 },
      ],
    }))

    // Remaining 120 employees: no slip — fall back to pfBaseMap, built from
    // active compensation's PF-applicable components. 3 components of 3000
    // each = 9000, deliberately different from the config wageCeiling
    // (15000) so a silent fallback-to-ceiling is distinguishable.
    const fallbackEmps = employees.slice(SLIP_COUNT)
    const compensations = fallbackEmps.map((e, i) => ({ id: compUuid(i), employee_id: e.id, tenant_id: TENANT_ID, is_active: true }))
    const components = compensations.flatMap(c => [
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { is_pf_applicable: true } },
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { is_pf_applicable: true } },
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { is_pf_applicable: true } },
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
    expect(body.computed_count).toBe(N)

    const persisted = upsertSpy.mock.calls[0][0] as any[]
    expect(persisted).toHaveLength(N)
    const byEmp = new Map(persisted.map(r => [r.employee_id, r]))

    for (const e of employees.slice(0, SLIP_COUNT)) {
      const row = byEmp.get(e.id)
      expect(row).toBeTruthy()
      expect(row.pf_wages).toBeCloseTo(9500, 2)
    }

    for (const e of fallbackEmps) {
      const row = byEmp.get(e.id)
      expect(row).toBeTruthy()
      // Must be the real component sum (9000), not a silent fallback to the
      // 15000 config wageCeiling.
      expect(row.pf_wages).toBeCloseTo(9000, 2)
    }
  })
})
