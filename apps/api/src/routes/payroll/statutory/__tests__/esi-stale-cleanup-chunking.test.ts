/**
 * POST /payroll/statutory/esi/contributions/compute — stale-row cleanup
 * chunking regression.
 *
 * The stale-row cleanup after a re-finalize used to build a single
 * .not('employee_id', 'in', `(${allKeepIds.join(',')})`) — every kept id
 * encoded into one URL query parameter. Found by actually running this
 * endpoint against 1,200 real employees in Postgres
 * (scripts/pagination-scale-check.sh): the request died before reaching the
 * server (empty error, nothing in the gateway's own log) — a request-size
 * failure no in-memory mock would ever surface, since mocks never serialize
 * a URL. Fixed by computing the actual stale ids (existing rows minus kept)
 * and deleting them in bounded .in()-chunks of 100.
 *
 * This test simulates the same request-size failure a real oversized URL
 * would cause: the mock throws if a single .in() call carries more than 100
 * ids, and proves 250 stale employees (requiring 3 chunks) are still all
 * removed without exceeding that limit on any one call.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import esiRoutes from '../esi.js'

const TENANT_ID = 'tenant-esi-stale-cleanup-001'
const MONTH = '2026-07'
const IN_CHUNK_LIMIT = 100

function empUuid(i: number): string {
  return `00000000-0000-4000-f000-${String(i).padStart(12, '0')}`
}

function makeTable(rows: any[], opts: { inLimit?: number } = {}) {
  const inLimit = opts.inLimit ?? Infinity
  type State = { filtered: any[]; limitN: number | null }
  function build(state: State) {
    const api: any = {
      select() { return api },
      eq(col: string, val: any) { return build({ ...state, filtered: state.filtered.filter(r => r[col] === val) }) },
      in(col: string, vals: any[]) {
        if (vals.length > inLimit) {
          throw new Error(`simulated request-line overflow: .in('${col}', [${vals.length} ids])`)
        }
        const set = new Set(vals)
        return build({ ...state, filtered: state.filtered.filter(r => set.has(r[col])) })
      },
      gt(col: string, val: any) { return build({ ...state, filtered: state.filtered.filter(r => r[col] > val) }) },
      not() { return api },
      is() { return api },
      or() { return api },
      lte() { return api },
      gte() { return api },
      order(col: string, o: { ascending?: boolean } = {}) {
        const asc = o.ascending !== false
        const sorted = [...state.filtered].sort((a, b) => {
          if (a[col] === b[col]) return 0
          return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1)
        })
        return build({ ...state, filtered: sorted })
      },
      limit(n: number) { return build({ ...state, limitN: n }) },
      maybeSingle() { return Promise.resolve({ data: state.filtered[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: state.filtered[0] ?? null, error: null }) },
      upsert: (rows: any[]) => { upsertSpyTarget?.(rows); return Promise.resolve({ error: null }) },
      delete() {
        return {
          eq: () => ({
            eq: () => ({
              in: (col: string, vals: any[]) => {
                if (vals.length > inLimit) {
                  throw new Error(`simulated request-line overflow on delete: .in('${col}', [${vals.length} ids])`)
                }
                deleteSpyTarget?.(vals)
                return Promise.resolve({ error: null })
              },
            }),
          }),
        }
      },
      range(from: number, to: number) {
        return Promise.resolve({ data: state.filtered.slice(from, to + 1), error: null })
      },
      then(resolve: any, reject: any) {
        const cap = state.limitN ?? Infinity
        return Promise.resolve({ data: state.filtered.slice(0, cap), error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return build({ filtered: rows, limitN: null })
}
let upsertSpyTarget: ((rows: any[]) => void) | undefined
let deleteSpyTarget: ((ids: string[]) => void) | undefined

async function buildApp(opts: { employees: any[]; slips: any[]; existingContributions: any[] }) {
  const upsertSpy = vi.fn()
  const deleteSpy = vi.fn()
  upsertSpyTarget = upsertSpy
  deleteSpyTarget = deleteSpy

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
      if (table === 'payroll_runs') return makeTable([{ id: 'run-1', status: 'finalized', tenant_id: TENANT_ID, month: MONTH }])
      if (table === 'esi_config')   return makeTable([{ employee_contribution_pct: '0.75', employer_contribution_pct: '3.25', wage_ceiling: '21000.00', tenant_id: TENANT_ID }])
      if (table === 'employees')    return makeTable(opts.employees)
      if (table === 'employee_statutory_overrides') return makeTable([])
      if (table === 'esi_eligibility_timeline')     return makeTable([])
      if (table === 'payroll_slips') return makeTable(opts.slips)
      if (table === 'esi_contributions') return makeTable(opts.existingContributions, { inLimit: IN_CHUNK_LIMIT })
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(esiRoutes)
  await app.ready()
  return { app, upsertSpy, deleteSpy }
}

describe('POST /payroll/statutory/esi/contributions/compute — chunked stale-row cleanup', () => {
  it('removes 250 stale rows in chunks of <=100, never exceeding the simulated request-line limit', async () => {
    const KEEP_COUNT = 10
    const STALE_COUNT = 250 // > IN_CHUNK_LIMIT (100), forces 3 delete chunks
    const keepEmps = Array.from({ length: KEEP_COUNT }, (_, i) => ({ id: empUuid(i), employee_code: `KEEP${i}`, tenant_id: TENANT_ID, status: 'active' }))
    // Stale employees are no longer active (e.g. separated) — they won't be
    // in empList, but their old esi_contributions row for this month must
    // still be cleaned up.
    const staleIds = Array.from({ length: STALE_COUNT }, (_, i) => empUuid(1000 + i))

    const slips = keepEmps.map((e, i) => ({
      id: `slip-${String(i).padStart(6, '0')}`,
      employee_id: e.id, tenant_id: TENANT_ID, month: MONTH, status: 'finalized', gross_pay: '9500.00', component_breakdown: [],
    }))
    const existingContributions = [
      ...keepEmps.map((e, i) => ({ id: `contrib-keep-${String(i).padStart(6, '0')}`, employee_id: e.id, tenant_id: TENANT_ID, contribution_month: MONTH })),
      ...staleIds.map((id, i) => ({ id: `contrib-stale-${String(i).padStart(6, '0')}`, employee_id: id, tenant_id: TENANT_ID, contribution_month: MONTH })),
    ]

    const { app, deleteSpy } = await buildApp({ employees: keepEmps, slips, existingContributions })

    const res = await app.inject({
      method: 'POST',
      url: '/contributions/compute',
      payload: { month: MONTH },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().computed_count).toBe(KEEP_COUNT)

    // Every .in() delete call must stay within the chunk limit...
    for (const call of deleteSpy.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(IN_CHUNK_LIMIT)
    }
    // ...and together they must cover every stale id exactly once.
    const allDeleted = deleteSpy.mock.calls.flatMap(call => call[0])
    expect(new Set(allDeleted)).toEqual(new Set(staleIds))
    expect(deleteSpy.mock.calls.length).toBe(Math.ceil(STALE_COUNT / IN_CHUNK_LIMIT))
  })
})
