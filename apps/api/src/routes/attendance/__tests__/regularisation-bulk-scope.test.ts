/**
 * SYSTEM_AUDIT_2026-10-14 — bulk-approve/bulk-reject ownership-guard scope fix.
 *
 * Both routes' own comment says the guard exists so "every request in the
 * batch must belong to a direct report" (P6.5), but the guard used
 * getDirectReportIds — the full subordinate tree — so a batch containing a
 * GRANDCHILD's request (not an immediate report) passed this gate even
 * though approveRegularisation/rejectRegularisation's own validateApprover
 * check (immediate-manager-only) would always refuse it per-item. Fixed to
 * use getImmediateReportIds, matching the guard's own stated intent and the
 * real downstream authorization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/approval-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-service.js')>()
  return { ...actual, approveRegularisation: vi.fn(), rejectRegularisation: vi.fn() }
})

import regularisationRoutes from '../regularisation.js'
import { approveRegularisation, rejectRegularisation } from '../../../lib/approval-service.js'

const approveMock = approveRegularisation as ReturnType<typeof vi.fn>
const rejectMock  = rejectRegularisation  as ReturnType<typeof vi.fn>

const TENANT_ID        = 'tenant-001'
const MANAGER_ID       = 'emp-manager'
const DIRECT_REPORT_ID = 'emp-direct-report'
const GRANDCHILD_ID    = 'emp-grandchild'   // manager_id = DIRECT_REPORT_ID — NOT an immediate report of MANAGER_ID

const REG_DIRECT      = 'ec98fe8b-8623-494b-ab04-2e154a38d3b1'
const REG_GRANDCHILD  = 'd6d1f12d-cc77-44b3-af0c-bccc24f4a098'

function buildSupabase() {
  return {
    from(table: string) {
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_id: MANAGER_ID }, error: null }),
          single:      () => Promise.resolve({ data: { employee_id: MANAGER_ID }, error: null }),
        }
        return chain
      }
      if (table === 'employees') {
        // getImmediateReportIds: .select('id').eq('manager_id', X).eq('tenant_id', Y)
        const chain: any = {
          _managerId: null as string | null,
          select: () => chain,
          eq(field: string, value: unknown) {
            if (field === 'manager_id') chain._managerId = value
            return chain
          },
          then(resolve: (v: unknown) => void) {
            const ids = chain._managerId === MANAGER_ID ? [DIRECT_REPORT_ID] : []
            resolve({ data: ids.map(id => ({ id })), error: null })
            return Promise.resolve()
          },
        }
        return chain
      }
      if (table === 'attendance_regularisation') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          in(field: string, ids: string[]) {
            if (field === 'id') chain._ids = ids
            return chain
          },
          then(resolve: (v: unknown) => void) {
            const all = [
              { id: REG_DIRECT,     employee_id: DIRECT_REPORT_ID },
              { id: REG_GRANDCHILD, employee_id: GRANDCHILD_ID },
            ]
            const scoped = all.filter(r => chain._ids?.includes(r.id))
            resolve({ data: scoped, error: null })
            return Promise.resolve()
          },
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'manager-profile-001'
    ;(req as any).userRole = 'manager'
  })
  app.decorate('supabase', buildSupabase() as any)
  await app.register(regularisationRoutes)
  await app.ready()
  return app
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /attendance/regularisation/bulk-approve — ownership guard scope', () => {
  it('403s a batch containing a grandchild\'s request instead of letting it through to approveRegularisation', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT, REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.unauthorized_ids).toEqual([REG_GRANDCHILD])
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('allows a batch containing only the immediate direct report\'s request through the gate', async () => {
    approveMock.mockResolvedValue({ ok: true, value: { id: REG_DIRECT, status: 'approved', employee_id: DIRECT_REPORT_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT] },
    })
    expect(res.statusCode).toBe(200)
    expect(approveMock).toHaveBeenCalledTimes(1)
  })
})

describe('POST /attendance/regularisation/bulk-reject — ownership guard scope', () => {
  it('403s a batch containing a grandchild\'s request instead of letting it through to rejectRegularisation', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-reject', headers: HEADERS,
      payload: { ids: [REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.unauthorized_ids).toEqual([REG_GRANDCHILD])
    expect(rejectMock).not.toHaveBeenCalled()
  })
})
