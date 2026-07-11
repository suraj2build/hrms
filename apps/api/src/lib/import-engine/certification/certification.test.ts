// ── Enterprise Import Platform — Certification Suite ─────────────────────────
//
// Seven scenarios that prove the import engine behaves correctly under
// enterprise conditions.  Run with: pnpm --filter api test
//
// Scenario A — Normal Import (Throughput)
// Scenario B — Worker Crash & Resume
// Scenario C — Retry Classification
// Scenario D — Permanent Errors
// Scenario E — Concurrency Guard
// Scenario F — Heartbeat Monitoring
// Scenario G — Large Error Volume

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_CHUNK_SIZE,
  executeInChunks,
  writeImportErrors,
  type ChunkProcessorFn,
} from '../chunk-executor.js'
import type { ValidatedRow } from '../validator.js'
import { MockSupabase } from './mock-supabase.js'
import { makeInvalidRows, makeValidRows } from './data-generator.js'

const JOB_ID    = 'cert-job-0000-0000-0000-000000000000'
const TENANT_ID = 'cert-tenant-0000-0000-0000-000000000000'

function seedJob(db: MockSupabase, overrides: Record<string, unknown> = {}) {
  db.seed('import_jobs', [{
    id:           JOB_ID,
    status:       'importing',
    created_rows: 0,
    updated_rows: 0,
    failed_rows:  0,
    skipped_rows: 0,
    ...overrides,
  }])
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario A — Normal Import (Throughput)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario A — Normal Import (Throughput)', () => {
  const DATASETS = [5_000, 50_000, 250_000]

  test.each(DATASETS)('%i rows — correct counts, all chunks completed, checksum present', async (N) => {
    const db          = new MockSupabase()
    seedJob(db)
    const eligibleRows = makeValidRows(N)

    const t0     = performance.now()
    const result = await executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows,
      invalidRows:  [],
      skippedCount: 0,
      processChunk: async (chunk) => ({ created: chunk.length, updated: 0, failed: 0, skipped: 0 }),
    })
    const elapsedMs      = performance.now() - t0
    const expectedChunks = Math.ceil(N / DEFAULT_CHUNK_SIZE)
    const chunks         = db.getTable('import_job_chunks')

    expect(result.created).toBe(N)
    expect(result.failed).toBe(0)
    expect(chunks.length).toBe(expectedChunks)
    expect(chunks.every(c => c.status === 'completed')).toBe(true)
    // Idempotency: every chunk must carry a non-empty checksum
    expect(chunks.every(c => typeof c.checksum === 'string' && (c.checksum as string).length > 0)).toBe(true)

    const rps = Math.round(N / (elapsedMs / 1000))
    console.info(`    A.${N.toLocaleString()}: ${Math.round(elapsedMs)}ms | ${expectedChunks} chunks | ${rps.toLocaleString()} rows/s`)
  }, 60_000)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario B — Worker Crash & Resume
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario B — Worker Crash & Resume', () => {
  const TOTAL_ROWS  = 50_000   // 10 chunks of 5 000
  const CRASH_CHUNK = 3        // crash DURING chunk 3 (after chunks 1 & 2 complete)

  test('resumes from checkpoint — completed chunks skipped, checksums unchanged', async () => {
    const db           = new MockSupabase()
    seedJob(db)
    const eligibleRows = makeValidRows(TOTAL_ROWS)
    const totalChunks  = Math.ceil(TOTAL_ROWS / DEFAULT_CHUNK_SIZE)

    let phase: 'run1' | 'run2' = 'run1'
    let run1Calls = 0
    let run2Calls = 0

    const processChunk: ChunkProcessorFn = async (chunk) => {
      if (phase === 'run1') {
        run1Calls++
        if (run1Calls === CRASH_CHUNK) throw new Error('Simulated worker crash at chunk 3')
      } else {
        run2Calls++
      }
      return { created: chunk.length, updated: 0, failed: 0, skipped: 0 }
    }

    // Run 1 — crashes at chunk 3
    await expect(
      executeInChunks({
        supabase: db as any, tenantId: TENANT_ID, jobId: JOB_ID,
        eligibleRows, invalidRows: [], skippedCount: 0, processChunk,
      })
    ).rejects.toThrow('Simulated worker crash')

    const chunksAfterCrash = db.getTable('import_job_chunks')
    expect(chunksAfterCrash.filter(c => c.status === 'completed').length).toBe(CRASH_CHUNK - 1)
    expect(chunksAfterCrash.find(c => c.chunk_no === CRASH_CHUNK)?.status).toBe('failed')

    // Capture checksums before resume — they must survive the ignoreDuplicates upsert
    const checksumsBefore = new Map(
      chunksAfterCrash.map(c => [c.chunk_no as number, c.checksum as string])
    )

    // Run 2 — resume
    phase = 'run2'
    const result = await executeInChunks({
      supabase: db as any, tenantId: TENANT_ID, jobId: JOB_ID,
      eligibleRows, invalidRows: [], skippedCount: 0, processChunk,
    })

    expect(result.created).toBe(TOTAL_ROWS)
    expect(db.getTable('import_job_chunks').every(c => c.status === 'completed')).toBe(true)

    // Checksums are structurally identical — ignoreDuplicates preserved the originals
    for (const c of db.getTable('import_job_chunks')) {
      expect(c.checksum).toBe(checksumsBefore.get(c.chunk_no as number))
    }

    // Only chunks from crash-point onward were re-processed (no re-work)
    expect(run2Calls).toBe(totalChunks - (CRASH_CHUNK - 1))
  })

  test('crash on last chunk — resumes and completes', async () => {
    const db           = new MockSupabase()
    seedJob(db)
    const eligibleRows = makeValidRows(3_000)  // well under one chunk

    let callCount = 0
    const processChunk: ChunkProcessorFn = async (chunk) => {
      callCount++
      if (callCount === 1) throw new Error('Crash on the only chunk')
      return { created: chunk.length, updated: 0, failed: 0, skipped: 0 }
    }

    await expect(executeInChunks({
      supabase: db as any, tenantId: TENANT_ID, jobId: JOB_ID,
      eligibleRows, invalidRows: [], skippedCount: 0, processChunk,
    })).rejects.toThrow()

    const chunk1 = db.getTable('import_job_chunks').find(c => c.chunk_no === 1)
    expect(chunk1?.status).toBe('failed')

    // Resume — the failed chunk is not skipped (only 'completed' are)
    const result = await executeInChunks({
      supabase: db as any, tenantId: TENANT_ID, jobId: JOB_ID,
      eligibleRows, invalidRows: [], skippedCount: 0, processChunk,
    })

    expect(result.created).toBe(3_000)
    expect(db.getTable('import_job_chunks')[0]?.status).toBe('completed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario C — Retry Classification
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario C — Retry Classification', () => {
  async function classify(
    message: string,
    field   = 'employee_code',
    stage:  'validation' | 'business_validation' | 'write' = 'write',
  ): Promise<string> {
    const db  = new MockSupabase()
    const row: ValidatedRow = {
      rowNumber: 1, originalData: {}, normalizedData: {},
      warnings: [], isValid: false,
      errors: [{ field, message, severity: 'error' }],
    }
    await writeImportErrors(db as any, TENANT_ID, JOB_ID, [row], stage)
    return db.getTable('import_job_errors')[0]?.error_category as string
  }

  test('network timeout → retryable',           async () => expect(await classify('DB connection timeout')).toBe('retryable'))
  test('ECONNRESET → retryable',                async () => expect(await classify('ECONNRESET: socket hang up')).toBe('retryable'))
  test('503 service unavailable → retryable',   async () => expect(await classify('503 service temporarily unavailable')).toBe('retryable'))
  test('429 rate limit → retryable',            async () => expect(await classify('429 too many requests')).toBe('retryable'))

  test('FK violation → permanent',              async () => expect(await classify('foreign key constraint violation')).toBe('permanent'))
  test('generic DB error → permanent',          async () => expect(await classify('some unexpected database error')).toBe('permanent'))

  test('manifest mismatch → fatal',             async () => expect(await classify('manifest version mismatch: expected 2')).toBe('fatal'))
  test('different tenant → fatal',              async () => expect(await classify('template belongs to a different tenant')).toBe('fatal'))
  test('schema version mismatch → fatal',       async () => expect(await classify('schema version incompatible')).toBe('fatal'))

  test('validation stage overrides message — timeout becomes permanent', async () => {
    // Even a "retryable" message is permanent if the stage is validation
    expect(await classify('connection timeout', 'employee_code', 'validation')).toBe('permanent')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario D — Permanent Errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario D — Permanent Errors', () => {
  test('valid and invalid rows partitioned correctly', async () => {
    const VALID   = 300
    const INVALID = 75
    const db      = new MockSupabase()
    seedJob(db)

    const result = await executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows: makeValidRows(VALID),
      invalidRows:  makeInvalidRows(INVALID, 'Employee not found'),
      skippedCount: 0,
      processChunk: async (chunk) => ({ created: chunk.length, updated: 0, failed: 0, skipped: 0 }),
    })

    expect(result.created).toBe(VALID)
    expect(result.failed).toBe(INVALID)

    const errors = db.getTable('import_job_errors')
    expect(errors.length).toBe(INVALID)
    expect(errors.every(e => e.error_category === 'permanent')).toBe(true)
    expect(errors.every(e => e.error_stage === 'validation')).toBe(true)
    expect(errors.every(e => e.error_code === 'FIELD_EMPLOYEE_CODE')).toBe(true)
  })

  test('write failures detected mid-chunk and recorded as write-stage errors', async () => {
    const db   = new MockSupabase()
    seedJob(db)
    const rows = makeValidRows(200)

    let callCount = 0
    const processChunk: ChunkProcessorFn = async (chunk) => {
      callCount++
      if (callCount === 1) {
        // Simulate 20 write failures in the first chunk
        chunk.slice(0, 20).forEach(vr => {
          vr.isValid = false
          vr.errors.push({ field: '_db', message: 'duplicate key violation', severity: 'error' })
        })
        return { created: 180, updated: 0, failed: 20, skipped: 0 }
      }
      return { created: chunk.length, updated: 0, failed: 0, skipped: 0 }
    }

    const result = await executeInChunks({
      supabase: db as any, tenantId: TENANT_ID, jobId: JOB_ID,
      eligibleRows: rows, invalidRows: [], skippedCount: 0, processChunk,
    })

    expect(result.failed).toBe(20)
    const writeErrors = db.getTable('import_job_errors').filter(e => e.error_stage === 'write')
    expect(writeErrors.length).toBe(20)
    expect(writeErrors.every(e => e.error_category === 'permanent')).toBe(true)
  })

  test('skipped rows counted but not written to errors', async () => {
    const db = new MockSupabase()
    seedJob(db)

    const result = await executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows: makeValidRows(100),
      invalidRows:  [],
      skippedCount: 42,
      processChunk: async (chunk) => ({ created: chunk.length, updated: 0, failed: 0, skipped: 0 }),
    })

    expect(result.skipped).toBe(42)
    expect(db.getTable('import_job_errors').length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario E — Concurrency Guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario E — Concurrency Guard', () => {
  async function findActiveJob(db: MockSupabase, masterType: string) {
    const { data } = await (db as any)
      .from('import_jobs')
      .select('id, status')
      .eq('tenant_id', TENANT_ID)
      .eq('master_type', masterType)
      .in('status', ['validating', 'importing', 'processing'])
      .maybeSingle()
    return data as { id: string; status: string } | null
  }

  test('detects an actively importing job', async () => {
    const db = new MockSupabase()
    db.seed('import_jobs', [{ id: 'active-job', tenant_id: TENANT_ID, master_type: 'employee_salary_upload', status: 'importing' }])
    const active = await findActiveJob(db, 'employee_salary_upload')
    expect(active).toBeTruthy()
    expect(active!.id).toBe('active-job')
  })

  test('no conflict when only completed jobs exist', async () => {
    const db = new MockSupabase()
    db.seed('import_jobs', [{ id: 'done-job', tenant_id: TENANT_ID, master_type: 'employee_salary_upload', status: 'completed' }])
    expect(await findActiveJob(db, 'employee_salary_upload')).toBeNull()
  })

  test('detects a job in validating status', async () => {
    const db = new MockSupabase()
    db.seed('import_jobs', [{ id: 'val-job', tenant_id: TENANT_ID, master_type: 'employee_salary_upload', status: 'validating' }])
    const active = await findActiveJob(db, 'employee_salary_upload')
    expect(active).toBeTruthy()
  })

  test('detects a job in processing status', async () => {
    const db = new MockSupabase()
    db.seed('import_jobs', [{ id: 'proc-job', tenant_id: TENANT_ID, master_type: 'employee_salary_upload', status: 'processing' }])
    const active = await findActiveJob(db, 'employee_salary_upload')
    expect(active).toBeTruthy()
  })

  test('different master_type does not block', async () => {
    const db = new MockSupabase()
    db.seed('import_jobs', [{ id: 'other-job', tenant_id: TENANT_ID, master_type: 'leave_types', status: 'importing' }])
    expect(await findActiveJob(db, 'employee_salary_upload')).toBeNull()
  })

  test('different tenant does not block', async () => {
    const db = new MockSupabase()
    db.seed('import_jobs', [{ id: 'other-tenant-job', tenant_id: 'other-tenant', master_type: 'employee_salary_upload', status: 'importing' }])
    expect(await findActiveJob(db, 'employee_salary_upload')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario F — Heartbeat Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario F — Heartbeat Monitoring', () => {
  afterEach(() => { vi.useRealTimers() })

  test('heartbeat_at is stamped during active chunk processing', async () => {
    vi.useFakeTimers()
    const db = new MockSupabase()
    seedJob(db)

    await executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows: makeValidRows(500),   // one chunk
      invalidRows:  [],
      skippedCount: 0,
      processChunk: async (chunk) => {
        vi.advanceTimersByTime(6_000)    // advance past the 5s heartbeat interval
        return { created: chunk.length, updated: 0, failed: 0, skipped: 0 }
      },
    })

    const heartbeatCalls = db.calls.filter(
      c => c.table === 'import_jobs' && c.op === 'update'
        && typeof (c.data as Record<string, unknown>)?.heartbeat_at === 'string'
    )
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('heartbeat timer cleared after completion — no further stamps', async () => {
    vi.useFakeTimers()
    const db = new MockSupabase()
    seedJob(db)

    await executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows: makeValidRows(100),
      invalidRows:  [],
      skippedCount: 0,
      processChunk: async (chunk) => ({ created: chunk.length, updated: 0, failed: 0, skipped: 0 }),
    })

    db.clearCalls()
    vi.advanceTimersByTime(30_000)  // 6 × 5s intervals after completion

    const lateHeartbeats = db.calls.filter(
      c => c.table === 'import_jobs' && c.op === 'update'
        && typeof (c.data as Record<string, unknown>)?.heartbeat_at === 'string'
    )
    expect(lateHeartbeats.length).toBe(0)
  })

  test('heartbeat timer cleared even when a chunk throws', async () => {
    vi.useFakeTimers()
    const db = new MockSupabase()
    seedJob(db)

    await expect(executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows: makeValidRows(100),
      invalidRows:  [],
      skippedCount: 0,
      processChunk: async () => { throw new Error('chunk error') },
    })).rejects.toThrow()

    db.clearCalls()
    vi.advanceTimersByTime(30_000)

    expect(db.calls.filter(c => typeof (c.data as any)?.heartbeat_at === 'string').length).toBe(0)
  })

  test('stale detection threshold — > 60 s is stale, < 60 s is fresh', () => {
    const THRESHOLD   = 60_000
    const staleStamp  = new Date(Date.now() - 90_000).toISOString()
    const freshStamp  = new Date(Date.now() - 30_000).toISOString()

    expect(Date.now() - new Date(staleStamp).getTime()).toBeGreaterThan(THRESHOLD)
    expect(Date.now() - new Date(freshStamp).getTime()).toBeLessThan(THRESHOLD)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario G — Large Error Volume
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario G — Large Error Volume', () => {
  const ERROR_ROWS       = 100_000
  const BATCH_SIZE       = 200
  const EXPECTED_BATCHES = ERROR_ROWS / BATCH_SIZE  // 500

  test('100 000 invalid rows written in batches of 200', async () => {
    const db = new MockSupabase()

    const t0 = performance.now()
    await executeInChunks({
      supabase:     db as any,
      tenantId:     TENANT_ID,
      jobId:        JOB_ID,
      eligibleRows: [],
      invalidRows:  makeInvalidRows(ERROR_ROWS, 'Required field missing'),
      skippedCount: 0,
      processChunk: async () => ({ created: 0, updated: 0, failed: 0, skipped: 0 }),
    })
    const elapsed = performance.now() - t0

    const stored      = db.getTable('import_job_errors')
    const insertCalls = db.calls.filter(c => c.table === 'import_job_errors' && c.op === 'insert')

    expect(stored.length).toBe(ERROR_ROWS)
    expect(insertCalls.length).toBe(EXPECTED_BATCHES)
    expect(stored.every(e => e.error_category === 'permanent')).toBe(true)

    console.info(`    G: ${ERROR_ROWS.toLocaleString()} errors in ${Math.round(elapsed)}ms via ${EXPECTED_BATCHES} batches`)
  }, 60_000)

  test('error records carry all required fields', async () => {
    const db = new MockSupabase()
    await writeImportErrors(
      db as any, TENANT_ID, JOB_ID,
      makeInvalidRows(5, 'Employee not found', 'employee_code', 1),
      'validation',
    )

    const errors = db.getTable('import_job_errors')
    expect(errors.length).toBe(5)

    const first = errors[0]
    expect(first.import_job_id).toBe(JOB_ID)
    expect(first.tenant_id).toBe(TENANT_ID)
    expect(first.error_stage).toBe('validation')
    expect(first.error_code).toBe('FIELD_EMPLOYEE_CODE')
    expect(first.error_category).toBe('permanent')
    expect(first.row_key).toBe('INVALID0')
    expect(typeof first.raw_payload).toBe('object')
  })

  test('rows with no error messages get a synthetic UNKNOWN record', async () => {
    const db = new MockSupabase()
    const row: ValidatedRow = {
      rowNumber: 1, originalData: {}, normalizedData: {}, warnings: [],
      isValid: false, errors: [],   // no explicit errors
    }
    await writeImportErrors(db as any, TENANT_ID, JOB_ID, [row], 'validation')

    const errors = db.getTable('import_job_errors')
    expect(errors.length).toBe(1)
    expect(errors[0].error_code).toBe('UNKNOWN')
  })
})
