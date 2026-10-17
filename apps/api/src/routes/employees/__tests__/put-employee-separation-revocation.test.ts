/**
 * PUT /employees/:id — auth-revocation gap (SYSTEM_AUDIT_2026-10-14 continuation).
 *
 * user-account-service.ts documents 5 code paths that set employees.status =
 * 'separated' and says all 5 now call revokeEmployeeAuth, including
 * "employees/index.ts (soft-delete)" — i.e. DELETE /employees/:id. That
 * audit missed a 6th path: EmployeeProfile.tsx's Overview tab edits `status`
 * directly through the generic PUT /employees/:id (OverviewTab.tsx's status
 * <select>, submitted via profileMutation), which never called
 * revokeEmployeeAuth at all — an employee separated this way kept a live
 * login indefinitely, same defect AF-001 was supposed to close everywhere.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import employeeRoutes from '../index.js'

vi.mock('../../../lib/audit-service.js', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))

const revokeEmployeeAuthMock = vi.fn().mockResolvedValue(true)
vi.mock('../../../lib/user-account-service.js', () => ({
  revokeEmployeeAuth: (...args: unknown[]) => revokeEmployeeAuthMock(...args),
}))

const TENANT = 'tenant-1'
const EMP_ID = 'emp-1'

function buildApp(opts: { existingStatus: string }) {
  const app = Fastify()
  app.decorateRequest('tenantId', TENANT)
  app.decorateRequest('userId', 'user-1')
  app.decorate('authenticate', async () => {})
  app.decorate('eventPublisher', { publish: vi.fn() } as any)
  app.addHook('preHandler', async (req: any) => { req.tenantId = TENANT; req.userId = 'user-1'; req.userRole = 'hr_admin' })

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { id: EMP_ID, status: opts.existingStatus }, error: null }),
              }),
            }),
          }),
          update: (fields: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: EMP_ID, ...fields }, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(employeeRoutes)
  return { app }
}

describe('PUT /employees/:id — status transition to separated must revoke auth', () => {
  it('calls revokeEmployeeAuth when status transitions active -> separated through the generic PUT', async () => {
    revokeEmployeeAuthMock.mockClear()
    const { app } = buildApp({ existingStatus: 'active' })
    await app.ready()

    const res = await app.inject({
      method: 'PUT', url: `/employees/${EMP_ID}`,
      payload: { status: 'separated' },
    })

    expect(res.statusCode).toBe(200)
    expect(revokeEmployeeAuthMock).toHaveBeenCalledWith(expect.anything(), EMP_ID, TENANT, expect.anything())
  })

  it('does NOT call revokeEmployeeAuth for an unrelated field update that leaves status untouched', async () => {
    revokeEmployeeAuthMock.mockClear()
    const { app } = buildApp({ existingStatus: 'active' })
    await app.ready()

    const res = await app.inject({
      method: 'PUT', url: `/employees/${EMP_ID}`,
      payload: { phone: '9999999999' },
    })

    expect(res.statusCode).toBe(200)
    expect(revokeEmployeeAuthMock).not.toHaveBeenCalled()
  })

  it('does NOT re-call revokeEmployeeAuth for a no-op resubmission of an already-separated record', async () => {
    revokeEmployeeAuthMock.mockClear()
    const { app } = buildApp({ existingStatus: 'separated' })
    await app.ready()

    const res = await app.inject({
      method: 'PUT', url: `/employees/${EMP_ID}`,
      payload: { status: 'separated' },
    })

    expect(res.statusCode).toBe(200)
    expect(revokeEmployeeAuthMock).not.toHaveBeenCalled()
  })
})
