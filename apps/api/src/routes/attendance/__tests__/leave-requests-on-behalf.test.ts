/**
 * POST /leave-requests — "raise on behalf" authorization tests
 *
 * createLeaveRequest() itself (duration engine, policy resolution, insert)
 * is exercised elsewhere / integration-style; these tests isolate the new
 * authorization logic this route layers in front of it:
 *
 *   - A plain employee's employee_id override is silently ignored (falls
 *     back to their own employee_id).
 *   - An HR admin may target any employee that exists in the tenant; a
 *     target that doesn't resolve returns 400 NOT_FOUND.
 *   - A manager may target their own direct reports only; anyone else
 *     returns 403 FORBIDDEN. isDirectReport() is the single source of that
 *     scoping (manager-scope.ts), mocked here so the test asserts the
 *     route's branching, not the DB query shape.
 *
 * createLeaveRequest is mocked so these tests never touch the leave
 * duration engine — only the employeeId it's called with matters here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/leave-request-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/leave-request-service.js')>()
  return { ...actual, createLeaveRequest: vi.fn() }
})
vi.mock('../../../lib/manager-scope.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/manager-scope.js')>()
  return { ...actual, isDirectReport: vi.fn() }
})

import leaveRequestsRoutes from '../leave-requests.js'
import { createLeaveRequest } from '../../../lib/leave-request-service.js'
import { isDirectReport }     from '../../../lib/manager-scope.js'

const createLeaveRequestMock = createLeaveRequest as ReturnType<typeof vi.fn>
const isDirectReportMock     = isDirectReport     as ReturnType<typeof vi.fn>

const TENANT_ID = '00000000-0000-0000-0000-000000000099'
const CALLER_EMPLOYEE_ID = '00000000-0000-0000-0000-000000000001'
const TARGET_EMPLOYEE_ID = '00000000-0000-0000-0000-000000000002'

const VALID_BODY = {
  leave_type_id: '00000000-0000-0000-0000-0000000000aa',
  from_date:     '2099-06-10',
  to_date:       '2099-06-12',
  reason:        'Family trip',
}

function okRow(employeeId: string) {
  return {
    ok: true,
    value: {
      id: 'leave-req-001', employee_id: employeeId, computed_days: 3,
      status: 'PENDING',
    },
  }
}

function buildMockSupabase(opts: { employeeExists?: boolean } = {}) {
  const supabase = {
    from(table: string) {
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_id: CALLER_EMPLOYEE_ID }, error: null }),
        }
        return chain
      }
      if (table === 'employees') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({
            data: opts.employeeExists === false ? null : { id: TARGET_EMPLOYEE_ID },
            error: null,
          }),
        }
        return chain
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }
  return supabase
}

async function buildApp(opts: { userRole: string; employeeExists?: boolean }): Promise<FastifyInstance> {
  const supabase = buildMockSupabase(opts)
  const app = Fastify({ logger: false })

  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'caller-profile-001'
    ;(req as any).userRole = opts.userRole
  })

  app.decorate('supabase', supabase as any)
  app.decorate('eventPublisher', { publish: vi.fn() } as any)

  await app.register(leaveRequestsRoutes)
  await app.ready()
  return app
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /leave-requests — on-behalf authorization', () => {
  it('employee role: employee_id override is silently ignored — falls back to own employee_id', async () => {
    createLeaveRequestMock.mockResolvedValue(okRow(CALLER_EMPLOYEE_ID))
    const app = await buildApp({ userRole: 'employee' })

    const res = await app.inject({
      method: 'POST', url: '/leave-requests', headers: HEADERS,
      payload: { ...VALID_BODY, employee_id: TARGET_EMPLOYEE_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(createLeaveRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: CALLER_EMPLOYEE_ID }),
    )
    await app.close()
  })

  it('hr_admin: may raise for any employee that exists in the tenant', async () => {
    createLeaveRequestMock.mockResolvedValue(okRow(TARGET_EMPLOYEE_ID))
    const app = await buildApp({ userRole: 'hr_admin', employeeExists: true })

    const res = await app.inject({
      method: 'POST', url: '/leave-requests', headers: HEADERS,
      payload: { ...VALID_BODY, employee_id: TARGET_EMPLOYEE_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(createLeaveRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: TARGET_EMPLOYEE_ID }),
    )
    await app.close()
  })

  it('hr_admin: target employee not found in tenant → 400, createLeaveRequest never called', async () => {
    const app = await buildApp({ userRole: 'hr_admin', employeeExists: false })

    const res = await app.inject({
      method: 'POST', url: '/leave-requests', headers: HEADERS,
      payload: { ...VALID_BODY, employee_id: TARGET_EMPLOYEE_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(createLeaveRequestMock).not.toHaveBeenCalled()
    await app.close()
  })

  it('manager: may raise leave for their own direct report', async () => {
    isDirectReportMock.mockResolvedValue(true)
    createLeaveRequestMock.mockResolvedValue(okRow(TARGET_EMPLOYEE_ID))
    const app = await buildApp({ userRole: 'manager' })

    const res = await app.inject({
      method: 'POST', url: '/leave-requests', headers: HEADERS,
      payload: { ...VALID_BODY, employee_id: TARGET_EMPLOYEE_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(isDirectReportMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, CALLER_EMPLOYEE_ID, TARGET_EMPLOYEE_ID)
    expect(createLeaveRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: TARGET_EMPLOYEE_ID }),
    )
    await app.close()
  })

  it('manager: target is NOT a direct report → 403, createLeaveRequest never called', async () => {
    isDirectReportMock.mockResolvedValue(false)
    const app = await buildApp({ userRole: 'manager' })

    const res = await app.inject({
      method: 'POST', url: '/leave-requests', headers: HEADERS,
      payload: { ...VALID_BODY, employee_id: TARGET_EMPLOYEE_ID },
    })

    expect(res.statusCode).toBe(403)
    expect(createLeaveRequestMock).not.toHaveBeenCalled()
    await app.close()
  })

  it('no employee_id override: everyone submits for themselves as before', async () => {
    createLeaveRequestMock.mockResolvedValue(okRow(CALLER_EMPLOYEE_ID))
    const app = await buildApp({ userRole: 'employee' })

    const res = await app.inject({
      method: 'POST', url: '/leave-requests', headers: HEADERS,
      payload: VALID_BODY,
    })

    expect(res.statusCode).toBe(201)
    expect(createLeaveRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: CALLER_EMPLOYEE_ID }),
    )
    await app.close()
  })
})
