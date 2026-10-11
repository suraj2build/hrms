/**
 * GET /payroll/filing-pack/ecr — chunked UAN lookup regression
 *
 * The ECR 2.0 export enriches each EPF contributor with their UAN from
 * epf_eligibility_overrides via a single .in() over every contributor for
 * the month. At enterprise headcount that's an unchunked .in() over
 * thousands of UUIDs — a request-line risk. Fixed by chunking in batches of
 * 100; simulated here by rejecting any single .in() call carrying more than
 * 100 ids, and proven by checking every one of 120 members' UAN column.
 */

import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import filingPackRoutes from '../filing-pack.js'

const TENANT_ID = 'tenant-ecr-001'
const MONTH = '2026-06'
const IN_CHUNK_LIMIT = 100

function uuid(i: number): string {
  return `00000000-0000-4000-b000-${String(i).padStart(12, '0')}`
}

function makeTable(rows: any[], opts: { inLimit?: number } = {}) {
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
      not(col: string, op: string, val: any) {
        if (op === 'is' && val === null) return build(filtered.filter(r => r[col] != null))
        return build(filtered)
      },
      is(col: string, val: any) {
        if (val === null) return build(filtered.filter(r => r[col] == null))
        return build(filtered)
      },
      order() { return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      range(from: number, to: number) { return Promise.resolve({ data: filtered.slice(from, to + 1), error: null }) },
      then(resolve: any, reject: any) {
        return Promise.resolve({ data: filtered, error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return build(rows)
}

async function buildApp(opts: { epfContributions: any[]; epfOverrides: any[] }) {
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
      if (table === 'epf_contributions')        return makeTable(opts.epfContributions)
      if (table === 'epf_eligibility_overrides') return makeTable(opts.epfOverrides, { inLimit: IN_CHUNK_LIMIT })
      if (table === 'statutory_registrations')   return makeTable([{ registration_number: 'EPF-REG-1' }])
      if (table === 'tenants')                   return makeTable([{ id: TENANT_ID, name: 'Test Co', timezone: 'Asia/Kolkata' }])
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(filingPackRoutes)
  await app.ready()
  return app
}

describe('GET /payroll/filing-pack/ecr — chunked UAN lookup over 120 contributors', () => {
  it('every one of 120 members gets their correct UAN in the ECR text output', async () => {
    const N = 120 // > IN_CHUNK_LIMIT (100)
    const empIds = Array.from({ length: N }, (_, i) => uuid(i))

    const epfContributions = empIds.map((id, i) => ({
      employee_id: id, tenant_id: TENANT_ID, contribution_month: MONTH,
      pf_wages: 15000, employee_contribution: 1800, employer_pf: 1800, employer_eps: 1250, edli_contribution: 75,
      employees: { employee_code: `EMP${String(i).padStart(4, '0')}`, first_name: 'Test', last_name: `E${i}` },
    }))
    // UAN present for all 120 — if chunking is broken (unchunked .in() over
    // 120 ids), the mock throws and the whole request 500s.
    const epfOverrides = empIds.map(id => ({ employee_id: id, tenant_id: TENANT_ID, uan: `UAN${id.slice(-6)}`, effective_to: null }))

    const app = await buildApp({ epfContributions, epfOverrides })

    const res = await app.inject({
      method: 'GET',
      url: `/ecr?month=${MONTH}`,
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const lines = res.body.split('\r\n')
    const dataLines = lines.filter(l => l.includes('~EMP'))
    expect(dataLines.length).toBe(N)

    for (let i = 0; i < N; i++) {
      const code = `EMP${String(i).padStart(4, '0')}`
      const line = dataLines.find(l => l.includes(`~${code}~`))
      expect(line).toBeTruthy()
      const uan = (line as string).split('~')[0]
      expect(uan).toBe(`UAN${empIds[i].slice(-6)}`)
    }
  })

  it('a chunk-boundary split (101 members, 1 over the limit) still resolves every UAN', async () => {
    const N = 101
    const empIds = Array.from({ length: N }, (_, i) => uuid(i))
    const epfContributions = empIds.map((id, i) => ({
      employee_id: id, tenant_id: TENANT_ID, contribution_month: MONTH,
      pf_wages: 10000, employee_contribution: 1200, employer_pf: 1200, employer_eps: 833, edli_contribution: 50,
      employees: { employee_code: `EMP${String(i).padStart(4, '0')}`, first_name: 'Test', last_name: `E${i}` },
    }))
    const epfOverrides = empIds.map(id => ({ employee_id: id, tenant_id: TENANT_ID, uan: `UAN${id.slice(-6)}`, effective_to: null }))

    const app = await buildApp({ epfContributions, epfOverrides })
    const res = await app.inject({
      method: 'GET',
      url: `/ecr?month=${MONTH}`,
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const dataLines = res.body.split('\r\n').filter(l => l.includes('~EMP'))
    expect(dataLines.length).toBe(N)
    // The 101st employee (index 100) falls in the second chunk — would be
    // silently dropped by a broken chunk boundary.
    const lastCode = `EMP${String(N - 1).padStart(4, '0')}`
    const lastLine = dataLines.find(l => l.includes(`~${lastCode}~`))
    expect(lastLine).toBeTruthy()
    expect((lastLine as string).split('~')[0]).toBe(`UAN${empIds[N - 1].slice(-6)}`)
  })
})
