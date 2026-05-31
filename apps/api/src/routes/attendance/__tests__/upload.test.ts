/**
 * Attendance CSV Upload — minimal regression tests
 *
 * Scenarios covered:
 *   1. localToUtc — IST tenant: 09:00 local → 03:30 UTC  (core timezone fix)
 *   2. localToUtc — UTC tenant: 09:00 local → 09:00 UTC  (regression: no offset applied)
 *   3. localToUtc — IST cross-midnight: 00:30 local Jan 15 → 19:00 UTC Jan 14
 *   4. Route happy path — IST tenant, standard shift
 *        • HTTP 200 with success_rows = 1
 *        • source = 'csv_upload' on every stored punch      (constraint compat)
 *        • IN punch stored as 03:30 UTC                     (timezone correctness)
 *        • OUT punch stored as 12:30 UTC                    (timezone correctness)
 *        • recomputeRange called with the correct local date
 *   5. Route happy path — UTC tenant
 *        • timestamps unchanged (no shift applied)
 *   6. Route — cross-midnight shift (22:00–06:00 IST)
 *        • OUT punch date is the next calendar day
 *        • recomputeRange called for BOTH the in-date and out-date
 *   7. Route — two CSV rows on the same date
 *        • recomputeRange called exactly once for that date (deduplication)
 *
 * What is NOT tested here (separate concern):
 *   - Full CSV validation error paths (missing columns, bad formats)
 *   - Actual database writes / Supabase integration
 *   - recomputeRange internals (tested in the engine separately)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

// ── Mock recomputeRange, keep localToUtc real ──────────────────────────────────
// vi.mock is hoisted to the top of the module by vitest, so it intercepts the
// import inside upload.ts before the route is loaded.
vi.mock('../../../lib/attendance-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/attendance-engine.js')>()
  return {
    ...actual,
    recomputeRange: vi.fn().mockResolvedValue(undefined),
  }
})

// Import AFTER the mock is registered so upload.ts receives the mocked version.
import uploadRoute from '../upload.js'
import { localToUtc, recomputeRange } from '../../../lib/attendance-engine.js'

// Cast for spy assertions
const recomputeSpy = recomputeRange as ReturnType<typeof vi.fn>

// ── Supabase mock builder ──────────────────────────────────────────────────────

interface MockOpts {
  timezone:  string
  employees: Array<{ id: string; employee_code: string }>
}

/**
 * Build a minimal Supabase client stub.
 *
 * Supports exactly the three query chains the upload route makes:
 *   from('employees').select(...).eq(...).in(...)
 *   from('tenants').select(...).eq(...).maybeSingle()
 *   from('attendance_punch_logs').upsert(...)
 *
 * Returns the upsert spy separately so tests can inspect captured rows.
 */
function buildMockSupabase(opts: MockOpts) {
  const upsertSpy = vi.fn().mockResolvedValue({ error: null })

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: opts.employees, error: null }),
            }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { timezone: opts.timezone }, error: null }),
            }),
          }),
        }
      }
      if (table === 'attendance_punch_logs') {
        return { upsert: upsertSpy }
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }

  return { supabase, upsertSpy }
}

// ── Fastify test app builder ───────────────────────────────────────────────────

async function buildApp(mockOpts: MockOpts): Promise<{
  app:       FastifyInstance
  upsertSpy: ReturnType<typeof vi.fn>
}> {
  const { supabase, upsertSpy } = buildMockSupabase(mockOpts)

  const app = Fastify({ logger: false })

  // Provide request decorations that the auth plugin would normally set
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  // Replace authenticate with a no-op that injects test identity
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = 'tenant-test-001'
    ;(req as any).userId   = 'user-test-001'
    ;(req as any).userRole = 'hr_admin'
  })

  app.decorate('supabase', supabase as any)

  await app.register(uploadRoute)
  await app.ready()

  return { app, upsertSpy }
}

/** Flush the Node.js setImmediate queue so fire-and-forget recomputes run. */
const flushImmediate = () => new Promise<void>((resolve) => setImmediate(resolve))

// ── Helpers ────────────────────────────────────────────────────────────────────

function csvBody(rows: string[]): { csv_content: string } {
  const header = 'employee_code,date,in_time,out_time'
  return { csv_content: [header, ...rows].join('\n') }
}

const POST_HEADERS = {
  'content-type':  'application/json',
  'authorization': 'Bearer test-token',
}

// ── Section 1: localToUtc — pure unit tests, no mocking ───────────────────────

describe('localToUtc — timezone conversion', () => {
  it('converts 09:00 IST to 03:30 UTC (IST = UTC+5:30)', () => {
    const result = localToUtc('2024-01-15', '09:00', 'Asia/Kolkata')
    expect(result.toISOString()).toBe('2024-01-15T03:30:00.000Z')
  })

  it('leaves 09:00 unchanged for a UTC tenant (no offset)', () => {
    const result = localToUtc('2024-01-15', '09:00', 'UTC')
    expect(result.toISOString()).toBe('2024-01-15T09:00:00.000Z')
  })

  it('handles cross-midnight: 00:30 IST on Jan 15 = 19:00 UTC on Jan 14', () => {
    const result = localToUtc('2024-01-15', '00:30', 'Asia/Kolkata')
    expect(result.toISOString()).toBe('2024-01-14T19:00:00.000Z')
  })

  it('converts 18:00 IST to 12:30 UTC (standard shift-end)', () => {
    const result = localToUtc('2024-01-15', '18:00', 'Asia/Kolkata')
    expect(result.toISOString()).toBe('2024-01-15T12:30:00.000Z')
  })

  it('accepts HH:MM:SS as well as HH:MM', () => {
    const withSeconds    = localToUtc('2024-01-15', '09:00:00', 'Asia/Kolkata')
    const withoutSeconds = localToUtc('2024-01-15', '09:00',    'Asia/Kolkata')
    expect(withSeconds.toISOString()).toBe(withoutSeconds.toISOString())
  })
})

// ── Section 2: Route — happy path ─────────────────────────────────────────────

describe('POST /attendance/upload — happy path', () => {
  beforeEach(async () => {
    // Drain any setImmediate callbacks queued by previous tests before clearing
    // the spy — prevents call-count leaks across tests that inject but don't flush.
    await flushImmediate()
    recomputeSpy.mockClear()
  })

  it('returns 200 with success_rows = 1 for a single valid row', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    const res = await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,09:00,18:00']),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success_rows).toBe(1)
    expect(body.failed_rows).toHaveLength(0)

    await app.close()
  })

  it('stores punches with source = csv_upload (constraint compatibility)', async () => {
    const { app, upsertSpy } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,09:00,18:00']),
    })

    // The upsert spy captures the rows array passed to .upsert()
    const [punchRows] = upsertSpy.mock.calls[0] as [Array<{ source: string }>]
    expect(punchRows.length).toBe(2)  // one IN + one OUT
    expect(punchRows.every((r) => r.source === 'csv_upload')).toBe(true)

    await app.close()
  })

  it('stores UTC-correct timestamps for an IST tenant', async () => {
    const { app, upsertSpy } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,09:00,18:00']),
    })

    const [punchRows] = upsertSpy.mock.calls[0] as [
      Array<{ punched_at: string; direction: 'IN' | 'OUT' }>
    ]
    const inPunch  = punchRows.find((r) => r.direction === 'IN')!
    const outPunch = punchRows.find((r) => r.direction === 'OUT')!

    // 09:00 IST → 03:30 UTC
    expect(inPunch.punched_at).toBe('2024-01-15T03:30:00.000Z')
    // 18:00 IST → 12:30 UTC
    expect(outPunch.punched_at).toBe('2024-01-15T12:30:00.000Z')

    await app.close()
  })

  it('does not shift timestamps for a UTC tenant', async () => {
    const { app, upsertSpy } = await buildApp({
      timezone:  'UTC',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,09:00,18:00']),
    })

    const [punchRows] = upsertSpy.mock.calls[0] as [
      Array<{ punched_at: string; direction: 'IN' | 'OUT' }>
    ]
    const inPunch  = punchRows.find((r) => r.direction === 'IN')!
    const outPunch = punchRows.find((r) => r.direction === 'OUT')!

    expect(inPunch.punched_at).toBe('2024-01-15T09:00:00.000Z')
    expect(outPunch.punched_at).toBe('2024-01-15T18:00:00.000Z')

    await app.close()
  })

  it('triggers recomputeRange for the correct local date', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,09:00,18:00']),
    })

    // Flush fire-and-forget setImmediate before asserting
    await flushImmediate()

    expect(recomputeSpy).toHaveBeenCalledOnce()
    const callArgs = recomputeSpy.mock.calls[0][1] as {
      employee_id: string
      from_date:   string
      to_date:     string
    }
    expect(callArgs.employee_id).toBe('emp-uuid-001')
    expect(callArgs.from_date).toBe('2024-01-15')
    expect(callArgs.to_date).toBe('2024-01-15')

    await app.close()
  })
})

// ── Section 3: Route — cross-midnight shift ────────────────────────────────────

describe('POST /attendance/upload — cross-midnight (night shift)', () => {
  beforeEach(async () => {
    await flushImmediate()
    recomputeSpy.mockClear()
  })

  it('places the OUT punch on the next calendar day for a night-shift row', async () => {
    const { app, upsertSpy } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    // 22:00–06:00 IST → cross-midnight; out_time < in_time
    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,22:00,06:00']),
    })

    const [punchRows] = upsertSpy.mock.calls[0] as [
      Array<{ punched_at: string; direction: 'IN' | 'OUT' }>
    ]
    const inPunch  = punchRows.find((r) => r.direction === 'IN')!
    const outPunch = punchRows.find((r) => r.direction === 'OUT')!

    // 22:00 IST on Jan 15 → 16:30 UTC on Jan 15
    expect(inPunch.punched_at).toBe('2024-01-15T16:30:00.000Z')
    // 06:00 IST on Jan 16 → 00:30 UTC on Jan 16
    expect(outPunch.punched_at).toBe('2024-01-16T00:30:00.000Z')

    await app.close()
  })

  it('triggers recompute for both the in-date and the out-date', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody(['EMP001,2024-01-15,22:00,06:00']),
    })

    await flushImmediate()

    // Expect two recompute calls: Jan 15 (in-date) and Jan 16 (out-date)
    expect(recomputeSpy).toHaveBeenCalledTimes(2)

    const dates = recomputeSpy.mock.calls.map(
      (call: any[]) => (call[1] as { from_date: string }).from_date,
    )
    expect(dates).toContain('2024-01-15')
    expect(dates).toContain('2024-01-16')

    await app.close()
  })
})

// ── Section 4: Route — recompute deduplication ────────────────────────────────

describe('POST /attendance/upload — recompute deduplication', () => {
  beforeEach(async () => {
    await flushImmediate()
    recomputeSpy.mockClear()
  })

  it('calls recomputeRange once per unique (employee, date) regardless of row count', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [
        { id: 'emp-uuid-001', employee_code: 'EMP001' },
        { id: 'emp-uuid-002', employee_code: 'EMP002' },
      ],
    })

    // Three rows: EMP001 twice on Jan 15 with different time windows (two shifts),
    // and EMP002 once on Jan 15.  Recompute should fire twice total:
    // once for (EMP001, Jan 15) and once for (EMP002, Jan 15).
    await app.inject({
      method:  'POST',
      url:     '/attendance/upload',
      headers: POST_HEADERS,
      payload: csvBody([
        'EMP001,2024-01-15,09:00,13:00',
        'EMP001,2024-01-15,14:00,18:00',
        'EMP002,2024-01-15,09:00,18:00',
      ]),
    })

    await flushImmediate()

    expect(recomputeSpy).toHaveBeenCalledTimes(2)

    const keys = recomputeSpy.mock.calls.map(
      (call: any[]) => {
        const args = call[1] as { employee_id: string; from_date: string }
        return `${args.employee_id}::${args.from_date}`
      },
    )
    expect(keys).toContain('emp-uuid-001::2024-01-15')
    expect(keys).toContain('emp-uuid-002::2024-01-15')

    await app.close()
  })
})
