/**
 * Public Careers routes — /careers/* (no authentication).
 *
 * Covers the two things that matter most for an unauthenticated,
 * tenant-resolved-from-a-URL-slug route: (1) a tenant that doesn't exist or
 * is suspended/expired/cancelled must 404 exactly like an unknown slug
 * (never leak which case it was), and (2) the apply flow's find-or-create
 * candidate logic, since nothing else in the codebase has this dedup —
 * the existing hrAdminAuth-gated candidate-create route just 409s on a
 * repeat email.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/email-service.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
  applicationReceivedEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h' }),
  APP_PUBLIC_URL: 'https://example.test',
}))

import publicCareersRoutes from '../public-careers.js'
import { sendEmail } from '../../../lib/email-service.js'

const sendEmailMock = sendEmail as ReturnType<typeof vi.fn>

const TENANT_ID = '00000000-0000-0000-0000-000000000099'
const OPENING_ID = '00000000-0000-0000-0000-000000000011'
const CANDIDATE_ID = '00000000-0000-0000-0000-000000000022'

function tenantRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: TENANT_ID, name: 'Acme Retail', status: 'active', trial_ends_at: null, ...overrides }
}

async function buildApp(supabase: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorate('supabase', supabase)
  await app.register(publicCareersRoutes)
  await app.ready()
  return app
}

// Minimal awaitable chain builder — resolves to `result` from any depth of
// .eq()/.select()/.order() chaining, and supports maybeSingle()/single()
// resolving to the same result's `.data`/`.error` shape.
function chainResolving(result: { data: unknown; error: unknown }) {
  const chain: any = {
    select: () => chain,
    eq:     () => chain,
    order:  () => chain,
    update: () => chain,
    insert: () => chain,
    maybeSingle: () => Promise.resolve(result),
    single:      () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return chain
}

beforeEach(() => vi.clearAllMocks())

describe('GET /careers/:tenantSlug/openings', () => {
  it('unknown tenant slug → 404 (no leak)', async () => {
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: null, error: null })
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({ method: 'GET', url: '/careers/no-such-tenant/openings' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('suspended tenant → 404, same as unknown slug', async () => {
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow({ status: 'suspended' }), error: null })
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({ method: 'GET', url: '/careers/acme/openings' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('active tenant: returns only mapped public fields', async () => {
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow(), error: null })
      if (table === 'job_requisitions') return chainResolving({
        data: [{ id: OPENING_ID, title: 'Store Associate', location: 'Mumbai', employment_type: 'full_time', openings: 3, min_experience: 0, max_experience: 2, departments: { name: 'Retail Ops' } }],
        error: null,
      })
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({ method: 'GET', url: '/careers/acme/openings' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data.company_name).toBe('Acme Retail')
    expect(body.data.openings).toEqual([{
      id: OPENING_ID, title: 'Store Associate', location: 'Mumbai', employment_type: 'full_time',
      openings: 3, min_experience: 0, max_experience: 2, department: 'Retail Ops',
    }])
    await app.close()
  })
})

describe('POST /careers/:tenantSlug/openings/:id/apply', () => {
  it('opening not open/public → 404', async () => {
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow(), error: null })
      if (table === 'job_requisitions') return chainResolving({ data: null, error: null })
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'POST', url: `/careers/acme/openings/${OPENING_ID}/apply`,
      headers: { 'content-type': 'application/json' },
      payload: { first_name: 'Rahul', last_name: 'Sharma', email: 'rahul@example.com' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('new applicant: creates a candidate (source=portal) + application, 201', async () => {
    const insertedCandidate = vi.fn()
    const insertedApplication = vi.fn()
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow(), error: null })
      if (table === 'job_requisitions') return chainResolving({ data: { id: OPENING_ID, title: 'Store Associate' }, error: null })
      if (table === 'candidates') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }), // no existing candidate
          insert: (payload: any) => { insertedCandidate(payload); return chain },
          single: () => Promise.resolve({ data: { id: CANDIDATE_ID }, error: null }),
        }
        return chain
      }
      if (table === 'applications') {
        const chain: any = {
          insert: (payload: any) => { insertedApplication(payload); return chain },
          select: () => chain,
          single: () => Promise.resolve({ data: { id: 'app-001' }, error: null }),
        }
        return chain
      }
      if (table === 'audit_logs') return { insert: () => Promise.resolve({ error: null }) }
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'POST', url: `/careers/acme/openings/${OPENING_ID}/apply`,
      headers: { 'content-type': 'application/json' },
      payload: { first_name: 'Rahul', last_name: 'Sharma', email: 'rahul@example.com', phone: '9999999999' },
    })

    expect(res.statusCode).toBe(201)
    expect(insertedCandidate).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: TENANT_ID, email: 'rahul@example.com', source: 'portal',
    }))
    expect(insertedApplication).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: TENANT_ID, requisition_id: OPENING_ID, candidate_id: CANDIDATE_ID, status: 'applied',
    }))

    // Fire-and-forget email send — flush the microtask queue before asserting.
    await new Promise(r => setImmediate(r))
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'rahul@example.com' }))
    await app.close()
  })

  it('repeat applicant (existing email): reuses the candidate id, updates profile fields, no new candidate insert', async () => {
    const candidateInsert = vi.fn()
    const candidateUpdate = vi.fn()
    const insertedApplication = vi.fn()
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow(), error: null })
      if (table === 'job_requisitions') return chainResolving({ data: { id: OPENING_ID, title: 'Store Associate' }, error: null })
      if (table === 'candidates') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { id: CANDIDATE_ID }, error: null }), // existing candidate found
          insert: (payload: any) => { candidateInsert(payload); return chain },
          update: (payload: any) => { candidateUpdate(payload); return chain },
          then:   (resolve: (v: unknown) => void) => resolve({ data: null, error: null }), // update() awaited directly
        }
        return chain
      }
      if (table === 'applications') {
        const chain: any = {
          insert: (payload: any) => { insertedApplication(payload); return chain },
          select: () => chain,
          single: () => Promise.resolve({ data: { id: 'app-002' }, error: null }),
        }
        return chain
      }
      if (table === 'audit_logs') return { insert: () => Promise.resolve({ error: null }) }
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'POST', url: `/careers/acme/openings/${OPENING_ID}/apply`,
      headers: { 'content-type': 'application/json' },
      payload: { first_name: 'Rahul', last_name: 'Sharma', email: 'rahul@example.com' },
    })

    expect(res.statusCode).toBe(201)
    expect(candidateInsert).not.toHaveBeenCalled()
    expect(candidateUpdate).toHaveBeenCalled()
    expect(insertedApplication).toHaveBeenCalledWith(expect.objectContaining({ candidate_id: CANDIDATE_ID }))
    await app.close()
  })

  it('duplicate application (already applied to this role) → 409', async () => {
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow(), error: null })
      if (table === 'job_requisitions') return chainResolving({ data: { id: OPENING_ID, title: 'Store Associate' }, error: null })
      if (table === 'candidates') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { id: CANDIDATE_ID }, error: null }),
          update: () => chain,
          then:   (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
        }
        return chain
      }
      if (table === 'applications') {
        const chain: any = {
          insert: () => chain,
          select: () => chain,
          single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }),
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'POST', url: `/careers/acme/openings/${OPENING_ID}/apply`,
      headers: { 'content-type': 'application/json' },
      payload: { first_name: 'Rahul', last_name: 'Sharma', email: 'rahul@example.com' },
    })

    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('DUPLICATE_APPLICATION')
    await app.close()
  })

  it('invalid email → 400, no DB calls', async () => {
    const supabase = { from: (table: string) => {
      if (table === 'tenants') return chainResolving({ data: tenantRow(), error: null })
      throw new Error(`unexpected table ${table}`)
    } }
    const app = await buildApp(supabase)

    const res = await app.inject({
      method: 'POST', url: `/careers/acme/openings/${OPENING_ID}/apply`,
      headers: { 'content-type': 'application/json' },
      payload: { first_name: 'Rahul', last_name: 'Sharma', email: 'not-an-email' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
