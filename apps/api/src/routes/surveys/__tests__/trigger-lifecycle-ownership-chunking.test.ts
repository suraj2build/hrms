/**
 * POST /surveys/admin/trigger-lifecycle — chunked ownership-validation
 * regression.
 *
 * employee_ids is caller-supplied with no upper bound, and the ownership
 * check FAILS CLOSED: any id not resolved back from `employees` is rejected.
 * Chunking that check by 100 (this round's UNB-149 fix) must preserve both
 * properties under a mock, not just under the real-stack script
 * (attendance-survey-truncation-check.sh) that already proves it end to
 * end against real Postgres:
 *
 * 1. Truncation: >100 valid ids (spanning 2 chunks) are all still verified
 *    and the request succeeds — chunking must not silently drop a later
 *    chunk's valid ids and false-reject them.
 * 2. Ownership: a foreign-tenant id placed in the SECOND chunk (past the
 *    first 100) must still be rejected — proven for real in the bash
 *    script; this mock test pins the same property fast, in CI, without a
 *    live Postgres.
 * 3. Query-error path: if a later chunk's query itself errors (not just
 *    "no match"), the request must surface a 500, not silently treat the
 *    error as "those ids don't exist" and let a mismatched-but-coincidentally-
 *    short validEmps list slip through.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import surveyRoutes from '../index.js'

const TENANT_ID = 'tenant-survey-chunk-001'

function empId(i: number): string {
  return `00000000-0000-4000-e000-${String(i).padStart(12, '0')}`
}

/** A minimal employees-table mock whose .in() calls can be scripted per
 *  invocation — needed to simulate an error on a specific (later) chunk,
 *  which the shared makeMockTable() in postgrest-mock.ts doesn't support. */
function makeScriptedEmployeesTable(validIds: Set<string>, errorOnCallIndex: number | null) {
  let callIndex = -1
  return {
    select() { return this },
    eq() { return this },
    in(_col: string, vals: string[]) {
      callIndex++
      if (errorOnCallIndex !== null && callIndex === errorOnCallIndex) {
        return Promise.resolve({ data: null, error: { message: 'simulated transient DB error' } })
      }
      return Promise.resolve({ data: vals.filter(v => validIds.has(v)).map(id => ({ id })), error: null })
    },
  }
}

async function buildApp(opts: {
  surveyExists: boolean
  validIds: Set<string>
  errorOnCallIndex?: number | null
  upsertSpy?: (rows: any[]) => void
}) {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userRole = 'hr_admin'
  })

  // Built ONCE, outside `from()` — the real route calls
  // .from('employees') fresh on every chunk iteration, so the scripted
  // table's call-index counter must persist ACROSS those calls to land
  // the simulated error on the intended chunk, not reset to 0 every time.
  const employeesTable = makeScriptedEmployeesTable(opts.validIds, opts.errorOnCallIndex ?? null)

  app.decorate('supabase', {
    from(table: string) {
      if (table === 'surveys') {
        return {
          select() { return this },
          eq() { return this },
          order() { return this },
          limit() { return this },
          single: () => Promise.resolve({
            data: opts.surveyExists ? { id: 'survey-1', title: 'Onboarding D30' } : null,
            error: null,
          }),
        }
      }
      if (table === 'employees') {
        return employeesTable
      }
      if (table === 'survey_assignments') {
        return {
          upsert(rows: any[]) {
            opts.upsertSpy?.(rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as any)

  await app.register(surveyRoutes)
  await app.ready()
  return app
}

describe('POST /surveys/admin/trigger-lifecycle — chunked ownership validation', () => {
  it('accepts 150 valid ids spanning 2 chunks (no false rejection from chunking)', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => empId(i))
    const validIds = new Set(ids)
    const upsertSpy = vi.fn()

    const app = await buildApp({ surveyExists: true, validIds, upsertSpy })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/trigger-lifecycle',
      payload: { lifecycle_type: 'onboarding_d30', employee_ids: ids },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.assigned).toBe(150)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(150)
  })

  it('rejects a foreign-tenant id placed in the SECOND chunk (past id 100)', async () => {
    const ownIds = Array.from({ length: 104 }, (_, i) => empId(i))
    const foreignId = empId(999) // placed last -> lands in the second (101-105) chunk
    const validIds = new Set(ownIds) // foreignId deliberately NOT in the valid set

    const app = await buildApp({ surveyExists: true, validIds })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/trigger-lifecycle',
      payload: { lifecycle_type: 'onboarding_d30', employee_ids: [...ownIds, foreignId] },
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_EMPLOYEES')
  })

  it('surfaces a 500 when a later chunk\'s query itself errors, rather than silently rejecting as INVALID_EMPLOYEES', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => empId(i)) // 2 chunks: [0..99], [100..149]
    const validIds = new Set(ids)

    // errorOnCallIndex: 1 -> the SECOND .in() call (the second chunk) errors.
    const app = await buildApp({ surveyExists: true, validIds, errorOnCallIndex: 1 })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/trigger-lifecycle',
      payload: { lifecycle_type: 'onboarding_d30', employee_ids: ids },
      headers: { authorization: 'Bearer test-token' },
    })

    // A real DB error must come back as a server error, not as the
    // ownership-rejection response — those mean different things to an
    // HR admin (fix your input vs. try again / contact support), and a
    // transient DB blip must never be presented as "these employees don't
    // belong to your organisation."
    expect(res.statusCode).toBe(500)
    expect(res.json().error).not.toBe('INVALID_EMPLOYEES')
  })
})
