/**
 * G12 — standalone leave encashment, completed end to end.
 *
 * Route-level tests for the two new endpoints that delegate to migration
 * 446's atomic Postgres functions (mark_leave_encashment_paid_atomic,
 * reverse_leave_encashment_atomic): this file verifies the route calls the
 * RPC with the right arguments and maps every documented error prefix to
 * the right HTTP status/code, exactly as separation-ff.test.ts does for the
 * F&F mark-paid RPC. The functions' own transactional/concurrency
 * guarantees are verified separately against real Postgres — see
 * scripts/db/verify-g12-encashment-atomic.mjs — since a mocked RPC
 * response can't exercise actual transaction semantics.
 *
 * Also covers the two plain-query additions: GET /leave/encashment/
 * encashable-types (the employee-facing projection the ESS request form
 * needs) and GET /leave/encashment/all?status= (admin visibility beyond
 * 'pending', needed to find a request to mark-paid or reverse).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import leaveAccrualRoutes from '../leave-accrual.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000099'
const REQUEST_ID = '00000000-0000-0000-0000-000000000011'
const RUN_ID = '00000000-0000-0000-0000-000000000022'

function buildApp(opts: { rpc?: ReturnType<typeof vi.fn>; from?: (table: string) => any } = {}) {
  const rpc = opts.rpc ?? vi.fn()
  const supabase = {
    rpc,
    from: opts.from ?? (() => { throw new Error('unexpected .from() call') }),
  }
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'hr-admin-001'
    ;(req as any).userRole = 'hr_admin'
  })
  app.decorate('supabase', supabase as any)
  return { app, supabase }
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => { vi.clearAllMocks() })

describe('POST /leave/encashment/:id/mark-paid', () => {
  it('validates payroll_run_id is required', async () => {
    const { app } = buildApp()
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: `/leave/encashment/${REQUEST_ID}/mark-paid`, headers: HEADERS, payload: {},
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('happy path — calls the RPC with the right arguments', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: REQUEST_ID, status: 'paid' }, error: null })
    const { app } = buildApp({ rpc })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: `/leave/encashment/${REQUEST_ID}/mark-paid`, headers: HEADERS,
      payload: { payroll_run_id: RUN_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('mark_leave_encashment_paid_atomic', {
      p_tenant_id: TENANT_ID, p_request_id: REQUEST_ID, p_payroll_run_id: RUN_ID, p_user_id: 'hr-admin-001',
    })
    await app.close()
  })

  it.each([
    ['NOT_FOUND: Encashment request not found', 404, 'NOT_FOUND'],
    ['RUN_NOT_FOUND: Payroll run not found', 404, 'RUN_NOT_FOUND'],
    ['NO_PAYSLIP: This employee has no payslip in that run', 409, 'NO_PAYSLIP'],
    ['RUN_NOT_DRAFT: Payroll run is finalized', 409, 'RUN_NOT_DRAFT'],
    ['ALREADY_DECIDED: This encashment request is no longer in approved status', 409, 'ALREADY_DECIDED'],
    ['NOT_COMPUTED: This request has no computed payout amount', 409, 'NOT_COMPUTED'],
  ])('maps RPC error %s to %i %s', async (rpcMessage, expectedStatus, expectedCode) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: rpcMessage } })
    const { app } = buildApp({ rpc })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: `/leave/encashment/${REQUEST_ID}/mark-paid`, headers: HEADERS,
      payload: { payroll_run_id: RUN_ID },
    })
    expect(res.statusCode).toBe(expectedStatus)
    expect(JSON.parse(res.body).error).toBe(expectedCode)
    await app.close()
  })

  it('an unrecognized RPC error falls back to 500 without leaking the raw DB message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint "foo"' } })
    const { app } = buildApp({ rpc })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: `/leave/encashment/${REQUEST_ID}/mark-paid`, headers: HEADERS,
      payload: { payroll_run_id: RUN_ID },
    })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('unique constraint')
    await app.close()
  })
})

describe('POST /leave/encashment/:id/reverse', () => {
  it('happy path — calls the RPC with the right arguments, reason optional', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: REQUEST_ID, status: 'reversed' }, error: null })
    const { app } = buildApp({ rpc })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: `/leave/encashment/${REQUEST_ID}/reverse`, headers: HEADERS, payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('reverse_leave_encashment_atomic', {
      p_tenant_id: TENANT_ID, p_request_id: REQUEST_ID, p_actor_id: 'hr-admin-001', p_reason: null,
    })
    await app.close()
  })

  it.each([
    ['NOT_FOUND: Encashment request not found', 404, 'NOT_FOUND'],
    ['CONFLICT: Only an approved or paid request can be reversed (current: rejected)', 409, 'CONFLICT'],
    ['PAYROLL_FINALIZED: This payout was posted into a payslip that is now finalized', 409, 'PAYROLL_FINALIZED'],
  ])('maps RPC error %s to %i %s', async (rpcMessage, expectedStatus, expectedCode) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: rpcMessage } })
    const { app } = buildApp({ rpc })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: `/leave/encashment/${REQUEST_ID}/reverse`, headers: HEADERS,
      payload: { reason: 'approved in error' },
    })
    expect(res.statusCode).toBe(expectedStatus)
    expect(JSON.parse(res.body).error).toBe(expectedCode)
    expect(rpc).toHaveBeenCalledWith('reverse_leave_encashment_atomic', {
      p_tenant_id: TENANT_ID, p_request_id: REQUEST_ID, p_actor_id: 'hr-admin-001', p_reason: 'approved in error',
    })
    await app.close()
  })
})

describe('GET /leave/encashment/encashable-types', () => {
  it('returns the encashable rule projection, scoped to active+encashable', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const rows = [{ leave_type_id: 'lt-1', max_encashable_per_year: 15, leave_types: { id: 'lt-1', name: 'Earned Leave' } }]
    const chain: any = {
      select: (...a: unknown[]) => { calls.push({ method: 'select', args: a }); return chain },
      eq:     (...a: unknown[]) => { calls.push({ method: 'eq', args: a }); return chain },
      then:   (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    }
    const { app } = buildApp({ from: (table: string) => { expect(table).toBe('leave_accrual_rules'); return chain } })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/leave/encashment/encashable-types', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data).toEqual(rows)
    expect(calls.some(c => c.method === 'eq' && c.args[0] === 'encashable' && c.args[1] === true)).toBe(true)
    expect(calls.some(c => c.method === 'eq' && c.args[0] === 'is_active' && c.args[1] === true)).toBe(true)
    await app.close()
  })
})

describe('GET /leave/encashment/all', () => {
  it('rejects an invalid status value', async () => {
    const { app } = buildApp()
    await app.register(leaveAccrualRoutes)
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/leave/encashment/all?status=not-a-status', headers: HEADERS })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('filters by the requested status', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const chain: any = {
      select: (...a: unknown[]) => { calls.push({ method: 'select', args: a }); return chain },
      eq:     (...a: unknown[]) => { calls.push({ method: 'eq', args: a }); return chain },
      order:  (...a: unknown[]) => { calls.push({ method: 'order', args: a }); return chain },
      then:   (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }
    const { app } = buildApp({ from: () => chain })
    await app.register(leaveAccrualRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/leave/encashment/all?status=paid', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    expect(calls.some(c => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'paid')).toBe(true)
    await app.close()
  })
})
