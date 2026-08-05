/**
 * Attendance CSV Upload — minimal regression tests
 *
 * The route is an async, Supabase-Storage-backed job queue (not a synchronous
 * CSV-in-body endpoint) — see the header comment on upload.ts for why
 * (Railway drops connections whose body upload exceeds its proxy timeout on
 * large files). The browser uploads the CSV to Storage directly, then POSTs
 * a tiny { storage_path, filename, total_rows } body; the route creates a
 * job row, replies 202 immediately, and processes the file in the
 * background (setImmediate) — success/failure lands on the job row, which
 * the browser polls via GET /attendance/upload/jobs/:jobId.
 *
 * Scenarios covered:
 *   1. localToUtc — IST tenant: 09:00 local → 03:30 UTC  (core timezone fix)
 *   2. localToUtc — UTC tenant: 09:00 local → 09:00 UTC  (regression: no offset applied)
 *   3. localToUtc — IST cross-midnight: 00:30 local Jan 15 → 19:00 UTC Jan 14
 *   4. Route happy path — IST tenant
 *        • POST returns 202 with a job_id immediately
 *        • the background job completes with success_rows = 2 for a 2-punch day
 *        • source = 'csv_upload' on every stored punch      (constraint compat)
 *        • first punch of the day stored as IN, last as OUT (ordinal assignment)
 *        • punched_at is timezone-shifted correctly for the tenant           (03:30 / 12:30 UTC)
 *   5. Route happy path — UTC tenant
 *        • timestamps unchanged (no shift applied)
 *   6. Route — storage_path outside the caller's tenant folder is rejected (400 INVALID_PATH)
 *   7. Route — recomputeRange is called once per employee, spanning that
 *      employee's full min→max punch-date range (not once per date) —
 *      the grouped-recompute perf fix.
 *
 * What is NOT tested here (separate concern):
 *   - Full CSV validation error paths (missing columns, bad formats)
 *   - Actual database writes / Supabase Storage integration
 *   - recomputeRange internals (tested in the engine separately)
 *   - GET /attendance/upload/active-job's stale-job-detection window
 *
 * Not carried over from the old (pre-Storage) version of this route: a
 * "cross-midnight shift" scenario asserting the OUT punch lands on the next
 * calendar day. That was shift-schedule-aware date attribution the route
 * itself used to do from separate in_time/out_time columns; the current CSV
 * format is one `datetime` column per punch and direction is assigned purely
 * by ordinal position within each row's own calendar date (see upload.ts
 * step 4) — there is no route-level cross-midnight re-dating left to test.
 * localToUtc's own cross-midnight conversion is still covered above (#3).
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
  timezone:   string
  employees:  Array<{ id: string; employee_code: string }>
  csvContent: string
}

/**
 * Build a minimal Supabase client stub covering every table/bucket
 * processUploadJob and the route touch:
 *   storage.from(bucket).download(path)         — serves the fixture CSV
 *   storage.from(bucket).remove([path])         — fire-and-forget cleanup
 *   from('attendance_upload_jobs').insert/update/select — job lifecycle
 *   from('attendance_period_locks').select(...) — no locked months by default
 *   from('employees').select(...).eq(...).in(...)
 *   from('tenants').select(...).eq(...).maybeSingle()
 *   from('attendance_punch_logs').upsert(...)
 *   from('upload_sessions').insert(...)         — best-effort audit row
 *
 * The job row is kept in memory and merged on every .update() call, so a
 * test can either inspect `jobUpdates` (every partial update, in order) or
 * fetch the final state through the real GET /attendance/upload/jobs/:jobId
 * route — mirroring how the browser actually polls it.
 */
function buildMockSupabase(opts: MockOpts) {
  const upsertSpy   = vi.fn().mockResolvedValue({ error: null })
  const jobUpdates: Array<Record<string, unknown>> = []
  let jobRow: Record<string, unknown> | null = null

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: opts.employees, error: null }) }) }) }
      }
      if (table === 'tenants') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { timezone: opts.timezone }, error: null }) }) }) }
      }
      if (table === 'attendance_punch_logs') {
        return { upsert: upsertSpy }
      }
      if (table === 'attendance_period_locks') {
        // No finalized/locked months in these fixtures.
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }
      }
      if (table === 'upload_sessions') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      if (table === 'attendance_upload_jobs') {
        return {
          insert: (fields: Record<string, unknown>) => {
            jobRow = { id: 'job-1', ...fields }
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'job-1' }, error: null }) }) }
          },
          update: (fields: Record<string, unknown>) => {
            jobUpdates.push(fields)
            jobRow = { ...(jobRow ?? {}), ...fields }
            return { eq: () => Promise.resolve({ error: null }) }
          },
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: jobRow, error: null }) }) }) }),
        }
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
    storage: {
      from(_bucket: string) {
        return {
          download: () => Promise.resolve({ data: { text: async () => opts.csvContent }, error: null }),
          remove:   () => Promise.resolve({ error: null }),
        }
      },
    },
  }

  return { supabase, upsertSpy, jobUpdates, getJobRow: () => jobRow }
}

// ── Fastify test app builder ───────────────────────────────────────────────────

async function buildApp(mockOpts: Omit<MockOpts, 'csvContent'> & { csvContent?: string }): Promise<{
  app:       FastifyInstance
  upsertSpy: ReturnType<typeof vi.fn>
  jobUpdates: Array<Record<string, unknown>>
  getJobRow: () => Record<string, unknown> | null
}> {
  const { supabase, upsertSpy, jobUpdates, getJobRow } = buildMockSupabase({
    csvContent: csvBody(['EMP001,2024-01-15 09:00']),
    ...mockOpts,
  } as MockOpts)

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

  return { app, upsertSpy, jobUpdates, getJobRow }
}

/**
 * Flush the Node.js setImmediate queue so the background job (itself
 * dispatched via setImmediate from the route handler) runs to completion.
 * Empirically one flush is enough here: every mocked query resolves an
 * already-settled Promise, so the whole async chain drains via microtasks
 * within the same check-phase tick — confirmed by asserting on
 * `getJobRow().status === 'completed'` rather than a call count, so this
 * stays correct even if that changes.
 */
const flushImmediate = () => new Promise<void>((resolve) => setImmediate(resolve))

// ── Helpers ────────────────────────────────────────────────────────────────────

/** One `datetime` column per punch — current CSV format (see upload.ts). */
function csvBody(rows: string[]): string {
  const header = 'employee_code,datetime'
  return [header, ...rows].join('\n')
}

const POST_HEADERS = {
  'content-type':  'application/json',
  'authorization': 'Bearer test-token',
}

const UPLOAD_BODY = { storage_path: 'tenant-test-001/upload.csv', filename: 'upload.csv' }

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

  it('returns 202 with a job_id immediately, before the file is processed', async () => {
    const { app, getJobRow } = await buildApp({
      timezone:   'Asia/Kolkata',
      employees:  [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
      csvContent: csvBody(['EMP001,2024-01-15 09:00', 'EMP001,2024-01-15 18:00']),
    })

    const res = await app.inject({
      method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: UPLOAD_BODY,
    })

    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.job_id).toBe('job-1')
    // The response is sent before setImmediate dispatches processUploadJob —
    // the job shouldn't be "completed" yet at the moment of the HTTP reply.
    expect(getJobRow()?.status).not.toBe('completed')

    await app.close()
  })

  it('completes the background job with success_rows = 2 for a 2-punch day', async () => {
    const { app, getJobRow } = await buildApp({
      timezone:   'Asia/Kolkata',
      employees:  [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
      csvContent: csvBody(['EMP001,2024-01-15 09:00', 'EMP001,2024-01-15 18:00']),
    })

    await app.inject({ method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: UPLOAD_BODY })
    await flushImmediate()

    const job = getJobRow()!
    expect(job.status).toBe('completed')
    expect(job.success_rows).toBe(2)
    expect(job.failed_rows).toBe(0)

    await app.close()
  })

  it('stores punches with source = csv_upload (constraint compatibility)', async () => {
    const { app, upsertSpy } = await buildApp({
      timezone:   'Asia/Kolkata',
      employees:  [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
      csvContent: csvBody(['EMP001,2024-01-15 09:00', 'EMP001,2024-01-15 18:00']),
    })

    await app.inject({ method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: UPLOAD_BODY })
    await flushImmediate()

    // The upsert spy captures the rows array passed to .upsert()
    const [punchRows] = upsertSpy.mock.calls[0] as [Array<{ source: string }>]
    expect(punchRows.length).toBe(2)  // one IN + one OUT
    expect(punchRows.every((r) => r.source === 'csv_upload')).toBe(true)

    await app.close()
  })

  it('assigns IN to the first punch and OUT to the last punch of a multi-punch day, timezone-shifted for IST', async () => {
    const { app, upsertSpy } = await buildApp({
      timezone:   'Asia/Kolkata',
      employees:  [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
      csvContent: csvBody(['EMP001,2024-01-15 09:00', 'EMP001,2024-01-15 18:00']),
    })

    await app.inject({ method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: UPLOAD_BODY })
    await flushImmediate()

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
      timezone:   'UTC',
      employees:  [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
      csvContent: csvBody(['EMP001,2024-01-15 09:00', 'EMP001,2024-01-15 18:00']),
    })

    await app.inject({ method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: UPLOAD_BODY })
    await flushImmediate()

    const [punchRows] = upsertSpy.mock.calls[0] as [
      Array<{ punched_at: string; direction: 'IN' | 'OUT' }>
    ]
    const inPunch  = punchRows.find((r) => r.direction === 'IN')!
    const outPunch = punchRows.find((r) => r.direction === 'OUT')!

    expect(inPunch.punched_at).toBe('2024-01-15T09:00:00.000Z')
    expect(outPunch.punched_at).toBe('2024-01-15T18:00:00.000Z')

    await app.close()
  })

  it('rejects a storage_path outside the caller\'s tenant folder (400 INVALID_PATH)', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    const res = await app.inject({
      method: 'POST', url: '/attendance/upload', headers: POST_HEADERS,
      payload: { storage_path: 'some-other-tenant/upload.csv', filename: 'upload.csv' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_PATH')

    await app.close()
  })

  it('returns 400 VALIDATION_ERROR when storage_path is missing from the body', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [{ id: 'emp-uuid-001', employee_code: 'EMP001' }],
    })

    const res = await app.inject({
      method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: { filename: 'upload.csv' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('VALIDATION_ERROR')

    await app.close()
  })
})

// ── Section 3: Route — grouped recompute (per employee, not per date) ────────

describe('POST /attendance/upload — recompute grouping', () => {
  beforeEach(async () => {
    await flushImmediate()
    recomputeSpy.mockClear()
  })

  it('calls recomputeRange once per employee, spanning that employee\'s full punch-date range', async () => {
    const { app } = await buildApp({
      timezone:  'Asia/Kolkata',
      employees: [
        { id: 'emp-uuid-001', employee_code: 'EMP001' },
        { id: 'emp-uuid-002', employee_code: 'EMP002' },
      ],
      // EMP001 punches on both Jan 15 and Jan 17 (a gap day in between);
      // EMP002 punches only on Jan 15. Grouping is per-employee across their
      // whole punch span, not per (employee, date) — this replaces the old
      // per-date recompute call the route used to make (see file header).
      csvContent: csvBody([
        'EMP001,2024-01-15 09:00',
        'EMP001,2024-01-15 18:00',
        'EMP001,2024-01-17 09:00',
        'EMP001,2024-01-17 18:00',
        'EMP002,2024-01-15 09:00',
        'EMP002,2024-01-15 18:00',
      ]),
    })

    await app.inject({ method: 'POST', url: '/attendance/upload', headers: POST_HEADERS, payload: UPLOAD_BODY })
    // Two flushes: the route's own setImmediate dispatches processUploadJob,
    // which — from *inside* that same macrotask — schedules the recompute
    // step via its own setImmediate (upload.ts step 13, deliberately
    // deferred so job completion isn't blocked on recompute). A callback
    // registered during a check-phase iteration runs in the *next*
    // iteration, so it needs its own flush to observe.
    await flushImmediate()
    await flushImmediate()

    // One call per employee, not one per punch-date.
    expect(recomputeSpy).toHaveBeenCalledTimes(2)

    const byEmployee = new Map(
      recomputeSpy.mock.calls.map((call: any[]) => {
        const args = call[1] as { employee_id: string; from_date: string; to_date: string }
        return [args.employee_id, args]
      }),
    )

    // EMP001's single call spans its full min→max range, Jan 15 through Jan 17
    // (including the gap day) — recomputeRange itself walks every day in the
    // span so the gap day still gets marked absent/weekly-off correctly.
    expect(byEmployee.get('emp-uuid-001')).toMatchObject({ from_date: '2024-01-15', to_date: '2024-01-17' })
    // EMP002 only punched Jan 15, so its span collapses to a single day.
    expect(byEmployee.get('emp-uuid-002')).toMatchObject({ from_date: '2024-01-15', to_date: '2024-01-15' })

    await app.close()
  })
})
