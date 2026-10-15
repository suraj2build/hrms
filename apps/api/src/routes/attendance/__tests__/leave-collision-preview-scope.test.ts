/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — GET /leave/collision/preview had
 * zero object-level authorization check: only tenant-membership of
 * employee_id was verified, so any authenticated employee could pass a
 * colleague's employee_id and get back that colleague's holiday/weekly-off
 * collision analysis — a structural gap against the sibling endpoint in
 * the same directory, leave-duration.ts's POST /leave/duration/preview,
 * which both are called with the identical employee_id from the same
 * LeaveApply.tsx screen. These tests prove the fix: self and HR are
 * allowed; a manager is scoped to their direct-report tree; anyone else is
 * refused.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import leaveCollisionRoutes from '../leave-collision.js'

vi.mock('../../../lib/collision-engine.js', () => ({
  resolveCollisionPolicy: vi.fn().mockResolvedValue({ mode: 'block' }),
  computeCollision:       vi.fn().mockResolvedValue({ collisions: [] }),
}))

const TENANT = 'tenant-1'

function buildApp(opts: {
  userRole:         string
  userId:           string
  callerEmployeeId: string | null
  reportIds:        string[]
}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = opts.userId
    req.userRole = opts.userRole
  })

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'target' }, error: null }) }) }) }) }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { employee_id: opts.callerEmployeeId }, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, params: any) => {
      if (fn === 'get_all_subordinates') {
        return params.p_manager_id === opts.callerEmployeeId
          ? Promise.resolve({ data: opts.reportIds.map(id => ({ id })), error: null })
          : Promise.resolve({ data: [], error: null })
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(leaveCollisionRoutes)
  return app
}

const MANAGER_EMP_ID = '11111111-1111-1111-1111-111111111111'
const REPORT_A       = '22222222-2222-2222-2222-222222222222'
const OUTSIDE_EMP    = '33333333-3333-3333-3333-333333333333'
const LEAVE_TYPE     = '44444444-4444-4444-4444-444444444444'

function url(employeeId: string) {
  return `/leave/collision/preview?employee_id=${employeeId}&leave_type_id=${LEAVE_TYPE}&from_date=2026-01-01&to_date=2026-01-02`
}

describe('GET /leave/collision/preview — ownership guard', () => {
  it('a plain employee previewing their OWN employee_id is allowed', async () => {
    const app = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: OUTSIDE_EMP, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(200)
  })

  it('a plain employee previewing a COLLEAGUE\'s employee_id is refused — previously this returned 200 with the colleague\'s data', async () => {
    const app = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: OUTSIDE_EMP, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(REPORT_A) })
    expect(res.statusCode).toBe(403)
  })

  it('HR admin may preview any employee_id', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(200)
  })

  it('manager previewing a direct report\'s employee_id is allowed', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: url(REPORT_A) })
    expect(res.statusCode).toBe(200)
  })

  it('manager previewing a NON-report\'s employee_id is refused', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(403)
  })
})
