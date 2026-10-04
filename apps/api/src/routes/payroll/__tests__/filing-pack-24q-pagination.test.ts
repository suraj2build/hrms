/**
 * GET /payroll/filing-pack/24q — pagination + chunking regression
 *
 * build24QDataset() has two fetches that were vulnerable at enterprise scale:
 *
 * 1. The finalized-slips scan (payroll_slips, one row per employee per month
 *    in the quarter) used fetchAllRows — correct already, exercised here with
 *    a low simulated max-rows cap to prove it still pages through 3 months *
 *    120 employees = 360 rows.
 * 2. The PAN lookup (employee_bank_statutory) ran a single .in() over every
 *    deductee in the quarter — unchunked, risking the request-line limit at
 *    enterprise headcount. Fixed by chunking in batches of 100; simulated
 *    here by rejecting any single .in() call carrying more than 100 ids.
 *
 * Both are proven by checking every one of 120 deductees gets the correct
 * pan/pan_status in Annexure II — a chunking or pagination regression would
 * either throw (if .in() exceeds the simulated line limit) or silently drop
 * some deductees' real PAN, miscounting MISSING vs OK.
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import filingPackRoutes from '../filing-pack.js'

const TENANT_ID = 'tenant-24q-001'
const QUARTER = 'Q1'
const FY = '2025-26'
const MONTHS = ['2025-04', '2025-05', '2025-06']
const ROW_PAGE_CAP = 50
const IN_CHUNK_LIMIT = 100

function uuid(i: number): string {
  return `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`
}

function makeTable(rows: any[], opts: { pageCap?: number; inLimit?: number } = {}) {
  const pageCap = opts.pageCap ?? Infinity
  const inLimit = opts.inLimit ?? Infinity

  function build(filtered: any[]) {
    const api: any = {
      select() { return api },
      eq(col: string, val: any) { return build(filtered.filter(r => r[col] === val)) },
      in(col: string, vals: any[]) {
        if (vals.length > inLimit) {
          throw new Error(`simulated request-line overflow: .in('${col}', [${vals.length} ids])`)
        }
        const set = new Set(vals)
        return build(filtered.filter(r => set.has(r[col])))
      },
      order() { return api },
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

async function buildApp(opts: { slips: any[]; bankStatutory: any[] }) {
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
      if (table === 'payroll_slips')           return makeTable(opts.slips, { pageCap: ROW_PAGE_CAP })
      if (table === 'employee_bank_statutory') return makeTable(opts.bankStatutory, { inLimit: IN_CHUNK_LIMIT })
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(filingPackRoutes)
  await app.ready()
  return app
}

describe('GET /payroll/filing-pack/24q — pagination past max-rows + chunked PAN lookup', () => {
  it('every one of 120 deductees gets the correct pan_status across 3 months of slips', async () => {
    const N = 120 // > ROW_PAGE_CAP (50) and > IN_CHUNK_LIMIT (100)
    const empIds = Array.from({ length: N }, (_, i) => uuid(i))

    const slips = empIds.flatMap(id =>
      MONTHS.map(month => ({
        employee_id: id,
        month,
        gross_pay: '50000.00',
        tds_deducted: '1000.00',
        status: 'finalized',
        tenant_id: TENANT_ID,
        employees: { employee_code: `EMP-${id.slice(-4)}`, first_name: 'Test', last_name: id.slice(-4) },
      })),
    )
    // PAN on file for employees at indices divisible by 4 only.
    const bankStatutory = empIds
      .filter((_, i) => i % 4 === 0)
      .map(id => ({ employee_id: id, tenant_id: TENANT_ID, pan_number: 'ABCDE1234F' }))
    const expectPanOnFile = new Set(empIds.filter((_, i) => i % 4 === 0))

    const app = await buildApp({ slips, bankStatutory })

    const res = await app.inject({
      method: 'GET',
      url: `/24q?quarter=${QUARTER}&financial_year=${FY}&format=json`,
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.annexure_ii.length).toBe(N)

    const byCode = new Map(body.annexure_ii.map((d: any) => [d.employee_code, d]))
    for (const id of empIds) {
      const code = `EMP-${id.slice(-4)}`
      const row = byCode.get(code) as any
      expect(row).toBeTruthy()
      if (expectPanOnFile.has(id)) {
        expect(row.pan_status).toBe('OK')
        expect(row.pan).toBe('ABCDE1234F')
      } else {
        expect(row.pan_status).toBe('MISSING')
      }
      // 3 slips in the quarter per employee -> gross/tds summed across all 3
      expect(row.months_in_quarter).toBe(3)
      expect(row.gross_salary).toBeCloseTo(150000, 2)
      expect(row.tds_deducted).toBeCloseTo(3000, 2)
    }

    // Annexure I: 3 monthly rows, each with the full 120-employee count.
    expect(body.annexure_i.length).toBe(3)
    for (const row of body.annexure_i) {
      expect(row.employee_count).toBe(N)
      expect(row.tds_amount).toBeCloseTo(120000, 2) // 120 employees * 1000
    }
  })
})
