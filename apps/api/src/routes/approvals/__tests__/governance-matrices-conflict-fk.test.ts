/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — two defects in POST/PUT
 * /approvals/governance/matrices:
 *
 *   1. approval_matrices has UNIQUE(tenant_id, name, entity_type)
 *      (migration 089). A name+entity_type collision (double-submit, or
 *      recreating after an earlier partial failure) was classified as a
 *      raw 500 serverError instead of the clean 409 conflictError this
 *      repo's own sibling file (lib/workflow-service.ts:102) already uses
 *      for the identical 23505 case.
 *   2. escalation_employee_id (inside each stage) was only checked as a
 *      well-formed UUID, never re-validated as belonging to this tenant's
 *      profiles — unlike delegate_id/granted_to in the same file, which
 *      already do this. These tests prove both fixes.
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import governanceEvolutionRoutes from '../governance-evolution.js'

const TENANT = 'tenant-1'
const OTHER_TENANT_EMPLOYEE = '99999999-9999-9999-9999-999999999999'
const VALID_EMPLOYEE        = '11111111-1111-1111-1111-111111111111'

function validStage(overrides: Record<string, unknown> = {}) {
  return {
    stage_number: 1,
    approver_type: 'direct_manager',
    approver_value: 'manager',
    sla_hours: 24,
    ...overrides,
  }
}

function buildApp(opts: {
  insertError?: { code: string; message: string }
  updateError?: { code: string; message: string }
  profilesInTenant: string[]  // ids that DO belong to this tenant
}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = 'hr-user-1'
    req.userRole = 'hr_admin'
  })

  const supabase = {
    from(table: string) {
      if (table === 'approval_matrices') {
        const chain: any = {
          insert: () => chain,
          update: () => chain,
          select: () => chain,
          eq:     () => chain,
          single: () => Promise.resolve(opts.insertError
            ? { data: null, error: opts.insertError }
            : { data: { id: 'matrix-1' }, error: null }),
          maybeSingle: () => Promise.resolve(opts.updateError
            ? { data: null, error: opts.updateError }
            : { data: { id: 'matrix-1' }, error: null }),
        }
        return chain
      }
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          in:     (col: string, ids: string[]) => Promise.resolve({
            data: ids.filter(id => opts.profilesInTenant.includes(id)).map(id => ({ id })),
            error: null,
          }),
        }
        return chain
      }
      // logAction()'s own audit_logs write, now called on every successful
      // matrix mutation (see this file's own fresh audit-logging finding).
      if (table === 'audit_logs') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(governanceEvolutionRoutes)
  return app
}

describe('POST /approvals/governance/matrices — 23505 classification', () => {
  it('a UNIQUE(tenant_id, name, entity_type) violation returns 409 CONFLICT, not a raw 500', async () => {
    const app = buildApp({ insertError: { code: '23505', message: 'duplicate key value violates unique constraint' }, profilesInTenant: [] })
    const res = await app.inject({
      method: 'POST', url: '/approvals/governance/matrices',
      payload: { name: 'Standard Leave Approval', entity_type: 'leave_request', stages: [validStage()] },
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('MATRIX_ALREADY_EXISTS')
  })

  it('a genuine DB error (not 23505) still returns 500 via serverError, unaffected', async () => {
    const app = buildApp({ insertError: { code: '42601', message: 'syntax error' }, profilesInTenant: [] })
    const res = await app.inject({
      method: 'POST', url: '/approvals/governance/matrices',
      payload: { name: 'Standard Leave Approval', entity_type: 'leave_request', stages: [validStage()] },
    })
    expect(res.statusCode).toBe(500)
  })
})

describe('PUT /approvals/governance/matrices/:id — 23505 classification', () => {
  it('renaming into a collision returns 409 CONFLICT, not 500', async () => {
    const app = buildApp({ updateError: { code: '23505', message: 'duplicate key value violates unique constraint' }, profilesInTenant: [] })
    const res = await app.inject({
      method: 'PUT', url: '/approvals/governance/matrices/matrix-1',
      payload: { name: 'Already Taken Name' },
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('MATRIX_ALREADY_EXISTS')
  })
})

describe('POST /approvals/governance/matrices — escalation_employee_id cross-tenant FK check', () => {
  it('an escalation_employee_id from ANOTHER tenant is refused — previously accepted and stored', async () => {
    const app = buildApp({ profilesInTenant: [VALID_EMPLOYEE] })
    const res = await app.inject({
      method: 'POST', url: '/approvals/governance/matrices',
      payload: {
        name: 'Matrix With Escalation', entity_type: 'leave_request',
        stages: [validStage({ escalation_employee_id: OTHER_TENANT_EMPLOYEE })],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('INVALID_REFERENCE')
  })

  it('an escalation_employee_id that genuinely belongs to this tenant is accepted', async () => {
    const app = buildApp({ profilesInTenant: [VALID_EMPLOYEE] })
    const res = await app.inject({
      method: 'POST', url: '/approvals/governance/matrices',
      payload: {
        name: 'Matrix With Escalation', entity_type: 'leave_request',
        stages: [validStage({ escalation_employee_id: VALID_EMPLOYEE })],
      },
    })
    expect(res.statusCode).toBe(201)
  })

  it('no escalation_employee_id at all is unaffected (optional field)', async () => {
    const app = buildApp({ profilesInTenant: [] })
    const res = await app.inject({
      method: 'POST', url: '/approvals/governance/matrices',
      payload: { name: 'Plain Matrix', entity_type: 'leave_request', stages: [validStage()] },
    })
    expect(res.statusCode).toBe(201)
  })
})
