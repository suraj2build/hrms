/**
 * POST /payroll/statutory/ptax/contributions/compute — wage-base pagination
 * regression (A1 statutory wage-base cluster)
 *
 * Mirrors esi-wage-base-pagination.test.ts / epf-wage-base-pagination.test.ts
 * for PTax's own two truncation risks against a 220-employee tenant with a
 * simulated 50-row max-rows cap:
 *
 * 1. payroll_slips (the authoritative PTax gross-wage source).
 * 2. employee_compensation_components (the fallback-gross source for
 *    employees with no finalized slip) — unchunked and unpaginated before
 *    this fix, despite several earning components per compensation.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import ptaxRoutes from '../ptax.js'

const TENANT_ID = 'tenant-ptax-wage-base-001'
const MONTH = '2026-06'
const ROW_PAGE_CAP = 50

function empUuid(i: number): string {
  return `00000000-0000-4000-e000-${String(i).padStart(12, '0')}`
}
function compUuid(i: number): string {
  return `00000000-0000-4000-e001-${String(i).padStart(12, '0')}`
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
      delete() { return { eq: () => ({ eq: () => ({ not: () => Promise.resolve({ error: null }) }) }) } },
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
  stateConfig: any[]
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
      if (table === 'employees')        return makeTable(opts.employees)
      if (table === 'ptax_state_config') return makeTable(opts.stateConfig)
      if (table === 'lwf_state_config')  return makeTable([])
      if (table === 'employee_statutory_overrides') return makeTable([])
      if (table === 'payroll_slips')     return makeTable(opts.slips, ROW_PAGE_CAP)
      if (table === 'employee_compensations')           return makeTable(opts.compensations, ROW_PAGE_CAP)
      if (table === 'employee_compensation_components')  return makeTable(opts.components, ROW_PAGE_CAP)
      if (table === 'ptax_slabs') {
        return makeTable([{
          tenant_id: TENANT_ID, financial_year: '2026-27', is_active: true, state_code: 'KA',
          monthly_income_from: 0, monthly_income_to: null, monthly_ptax: 200, frequency: 'monthly',
        }])
      }
      if (table === 'ptax_state_settings') return makeTable([])
      if (table === 'ptax_contributions')  return makeTable([])
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(ptaxRoutes)
  await app.ready()
  return { app, upsertSpy }
}

describe('POST /payroll/statutory/ptax/contributions/compute — wage-base pagination past a low max-rows cap', () => {
  it('computes PTax gross_salary for all 220 employees despite a 50-row cap on slips and components', async () => {
    const SLIP_COUNT = 100     // > ROW_PAGE_CAP (50)
    const FALLBACK_COUNT = 120 // > the 100-id chunk size, and 120*3=360 component rows > ROW_PAGE_CAP (50)
    const N = SLIP_COUNT + FALLBACK_COUNT

    const employees = Array.from({ length: N }, (_, i) => ({ id: empUuid(i), employee_code: `E${i}`, tenant_id: TENANT_ID, status: 'active', site_id: null }))
    const stateConfig = employees.map(e => ({ employee_id: e.id, state_code: 'KA', tenant_id: TENANT_ID, effective_from: '2020-01-01' }))

    const slips = employees.slice(0, SLIP_COUNT).map(e => ({
      employee_id: e.id, tenant_id: TENANT_ID, month: MONTH, status: 'finalized', gross_pay: '9500.00',
    }))

    const fallbackEmps = employees.slice(SLIP_COUNT)
    const compensations = fallbackEmps.map((e, i) => ({ id: compUuid(i), employee_id: e.id, tenant_id: TENANT_ID, is_active: true }))
    const components = compensations.flatMap(c => [
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { component_type: 'earning' } },
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { component_type: 'earning' } },
      { compensation_id: c.id, computed_monthly: '3000.00', salary_components: { component_type: 'earning' } },
    ])

    const { app, upsertSpy } = await buildApp({ employees, slips, compensations, components, stateConfig })

    const res = await app.inject({
      method: 'POST',
      url: '/contributions/compute',
      payload: { month: MONTH, financial_year: '2026-27' },
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
      expect(row.gross_salary).toBeCloseTo(9500, 2)
    }

    for (const e of fallbackEmps) {
      const row = byEmp.get(e.id)
      expect(row).toBeTruthy()
      expect(row.gross_salary).toBeCloseTo(9000, 2)
    }
  })
})
