// ── Enterprise Import Platform — Chunk Executor ──────────────────────────────
//
// Self-healing chunk execution engine. All bulk imports funnel through here.
//
// Capabilities:
//   • Pre-creates import_job_chunks (idempotent — safe to re-run)
//   • Immutable chunk checksum for deterministic replay identity
//   • Writes validation failures to import_job_errors with error_category
//   • Processes eligible rows in chunks (default 5 000 rows/chunk)
//   • Skips 'completed' chunks on resume (crash recovery / checkpoint)
//   • Heartbeat timer (5 s) lets watchdog detect frozen workers
//   • Per-chunk timing metrics written to import_job_metrics
//   • Stamps import_jobs progress + last_activity_at after every chunk
//
// rotation_policies is intentionally excluded — its grouped multi-row write
// cannot be split at arbitrary row boundaries without corrupting rule sets.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ValidatedRow }   from './validator.js'

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_CHUNK_SIZE   = 5_000
const ERROR_BATCH_SIZE            = 200
const HEARTBEAT_INTERVAL_MS       = 5_000

// ── Types ─────────────────────────────────────────────────────────────────────

/** Called once per chunk with the rows in that chunk. Mutations to row.isValid
 *  and row.errors are inspected after the call — write failures should mark
 *  vr.isValid = false and push to vr.errors, matching the existing handler contract. */
export type ChunkProcessorFn = (
  rows: ValidatedRow[],
) => Promise<{ created: number; updated: number; failed: number; skipped: number }>

export interface ExecuteInChunksOptions {
  supabase:     SupabaseClient
  tenantId:     string
  jobId:        string
  /** Valid rows that the current mode allows writing. Chunked and processed. */
  eligibleRows: ValidatedRow[]
  /** Rows that failed validation. Written to import_job_errors, counted in failed. */
  invalidRows:  ValidatedRow[]
  /** Count of valid rows skipped due to mode restrictions (create_only + duplicate, etc.). */
  skippedCount: number
  chunkSize?:   number
  processChunk: ChunkProcessorFn
}

export interface ExecuteInChunksResult {
  created: number
  updated: number
  failed:  number
  skipped: number
}

// ── Error classification ──────────────────────────────────────────────────────

function classifyError(
  message: string,
  stage:   'validation' | 'business_validation' | 'write',
): 'permanent' | 'retryable' | 'fatal' {
  if (stage === 'validation' || stage === 'business_validation') return 'permanent'

  const m = message.toLowerCase()

  // Fatal: the entire import is invalid at the job level
  if (
    m.includes('manifest') ||
    m.includes('schema version') ||
    m.includes('different tenant') ||
    m.includes('template mismatch')
  ) return 'fatal'

  // Retryable: transient infrastructure failures
  if (
    m.includes('timeout') ||
    m.includes('connection') ||
    m.includes('network') ||
    m.includes('unavailable') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('503') ||
    m.includes('429') ||
    m.includes('too many requests')
  ) return 'retryable'

  // Default: permanent (FK violation, duplicate key, type error, etc.)
  return 'permanent'
}

// ── Chunk checksum ────────────────────────────────────────────────────────────
// djb2 hash over the structural identity of a chunk — jobId + chunkNo + rows.
// Written once at chunk creation; never updated. Lets replay verify it is
// processing the exact same row range as the original run.

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  }
  return h
}

function computeChunkChecksum(
  jobId:    string,
  chunkNo:  number,
  startRow: number,
  endRow:   number,
): string {
  return djb2(`${jobId}:${chunkNo}:${startRow}:${endRow}`).toString(16).padStart(8, '0')
}

// ── Row-key extraction ────────────────────────────────────────────────────────

const ROW_KEY_CANDIDATES = [
  'employee_code', 'code', 'email', 'name', 'policy_name',
  'leave_type_code', 'component_code',
]

function getRowKey(vr: ValidatedRow): string | null {
  for (const f of ROW_KEY_CANDIDATES) {
    const v = vr.normalizedData[f]
    if (v != null && v !== '') return String(v)
  }
  return null
}

// ── Error writer ──────────────────────────────────────────────────────────────

export async function writeImportErrors(
  supabase: SupabaseClient,
  tenantId: string,
  jobId:    string,
  rows:     ValidatedRow[],
  stage:    'validation' | 'business_validation' | 'write',
): Promise<void> {
  const records: Record<string, unknown>[] = []

  for (const vr of rows) {
    for (const e of vr.errors) {
      records.push({
        import_job_id:  jobId,
        tenant_id:      tenantId,
        row_number:     vr.rowNumber,
        row_key:        getRowKey(vr),
        error_stage:    stage,
        error_code:     e.field === '_db' ? 'DB_ERROR' : `FIELD_${e.field.toUpperCase()}`,
        error_message:  e.message,
        error_category: classifyError(e.message, stage),
        raw_payload:    vr.originalData,
      })
    }
    // Row is invalid but has no error messages — emit a generic entry so
    // the UI always has something to display.
    if (vr.errors.length === 0) {
      records.push({
        import_job_id:  jobId,
        tenant_id:      tenantId,
        row_number:     vr.rowNumber,
        row_key:        getRowKey(vr),
        error_stage:    stage,
        error_code:     'UNKNOWN',
        error_message:  'Row failed without a specific error message.',
        error_category: classifyError('', stage),
        raw_payload:    vr.originalData,
      })
    }
  }

  if (records.length === 0) return

  // import_job_errors table may not exist in older DB schemas — fire-and-forget.
  for (let i = 0; i < records.length; i += ERROR_BATCH_SIZE) {
    supabase
      .from('import_job_errors')
      .insert(records.slice(i, i + ERROR_BATCH_SIZE))
      .then(() => {}, () => {})
  }
}

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executeInChunks({
  supabase,
  tenantId,
  jobId,
  eligibleRows,
  invalidRows,
  skippedCount,
  chunkSize = DEFAULT_CHUNK_SIZE,
  processChunk,
}: ExecuteInChunksOptions): Promise<ExecuteInChunksResult> {

  // 1. Write validation errors (once per run — on resume they already exist)
  if (invalidRows.length > 0) {
    await writeImportErrors(supabase, tenantId, jobId, invalidRows, 'validation')
  }

  // 2. Nothing eligible to process
  if (eligibleRows.length === 0) {
    return {
      created: 0,
      updated: 0,
      failed:  invalidRows.length,
      skipped: skippedCount,
    }
  }

  // 3. Split into chunks
  const chunks: ValidatedRow[][] = []
  for (let i = 0; i < eligibleRows.length; i += chunkSize) {
    chunks.push(eligibleRows.slice(i, i + chunkSize))
  }
  const totalChunks = chunks.length

  // 4. Upsert chunk records (fire-and-forget — table may not exist in older DB schemas)
  const chunkRecords = chunks.map((ch, idx) => {
    const chunkNo  = idx + 1
    const startRow = ch[0].rowNumber
    const endRow   = ch[ch.length - 1].rowNumber
    return {
      import_job_id: jobId,
      tenant_id:     tenantId,
      chunk_no:      chunkNo,
      start_row:     startRow,
      end_row:       endRow,
      checksum:      computeChunkChecksum(jobId, chunkNo, startRow, endRow),
      status:        'pending',
      attempt:       0,
    }
  })

  supabase
    .from('import_job_chunks')
    .upsert(chunkRecords, { onConflict: 'import_job_id,chunk_no', ignoreDuplicates: true })
    .then(() => {}, () => {})

  // 5. Fetch live chunk statuses (to detect already-completed chunks on resume)
  //    Non-fatal — import_job_chunks table may not exist in older DB schemas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let liveChunksRaw: any[] = []
  try {
    const res = await supabase
      .from('import_job_chunks')
      .select('chunk_no, id, status, success_count, failure_count, attempt')
      .eq('import_job_id', jobId)
      .order('chunk_no', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    liveChunksRaw = (res.data as any[]) ?? []
  } catch { /* table may not exist */ }

  const chunkMeta = new Map<number, {
    id:            string
    status:        string
    success_count: number
    failure_count: number
    attempt:       number
  }>()
  for (const row of liveChunksRaw) {
    chunkMeta.set(row.chunk_no as number, {
      id:            row.id            as string,
      status:        row.status        as string,
      success_count: (row.success_count as number) ?? 0,
      failure_count: (row.failure_count as number) ?? 0,
      attempt:       (row.attempt       as number) ?? 0,
    })
  }

  const isResume = [...chunkMeta.values()].some((m) => m.status === 'completed')

  // 6. Update job stage (fire-and-forget — total_chunks/current_stage columns may not exist)
  supabase
    .from('import_jobs')
    .update({ total_chunks: totalChunks, current_stage: 'writing' })
    .eq('id', jobId)
    .then(() => {}, () => {})

  // 7. Initialise running counters
  let totalCreated: number
  let totalUpdated: number
  let totalFailed:  number
  let totalSkipped: number

  if (isResume) {
    // Counters already reflect completed chunk work; fetch from DB.
    const { data: jobData } = await supabase
      .from('import_jobs')
      .select('created_rows, updated_rows, failed_rows, skipped_rows')
      .eq('id', jobId)
      .single()

    totalCreated = (jobData?.created_rows as number)  ?? 0
    totalUpdated = (jobData?.updated_rows as number)  ?? 0
    totalFailed  = (jobData?.failed_rows  as number)  ?? invalidRows.length
    totalSkipped = (jobData?.skipped_rows as number)  ?? skippedCount
  } else {
    totalCreated = 0
    totalUpdated = 0
    totalFailed  = invalidRows.length
    totalSkipped = skippedCount
  }

  // 8. Heartbeat timer — fire-and-forget; heartbeat_at may not exist in older DB schemas.
  const heartbeatTimer = setInterval(() => {
    supabase
      .from('import_jobs')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('id', jobId)
      .then(() => {}, () => {})
  }, HEARTBEAT_INTERVAL_MS)

  // Per-chunk timing accumulators for job-level aggregate metrics
  let totalChunkMs  = 0
  let peakChunkMs   = 0
  let chunksRan     = 0

  try {
    // 9. Process each chunk
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkNo = idx + 1
      const chunk   = chunks[idx]
      const meta    = chunkMeta.get(chunkNo)

      // Checkpoint: skip already-completed chunks
      if (meta?.status === 'completed') continue

      const chunkStartMs = Date.now()
      const startedAt    = new Date(chunkStartMs).toISOString()

      supabase
        .from('import_job_chunks')
        .update({
          status:     'processing',
          attempt:    (meta?.attempt ?? 0) + 1,
          started_at: startedAt,
        })
        .eq('import_job_id', jobId)
        .eq('chunk_no', chunkNo)
        .then(() => {}, () => {})

      try {
        const validBefore = new Set(chunk.filter((vr) => vr.isValid).map((vr) => vr.rowNumber))

        const dbWriteStart = Date.now()
        const result       = await processChunk(chunk)
        const dbWriteMs    = Date.now() - dbWriteStart

        // Rows that were valid before but became invalid = write failures
        const writeFailures = chunk.filter(
          (vr) => validBefore.has(vr.rowNumber) && !vr.isValid,
        )
        if (writeFailures.length > 0) {
          await writeImportErrors(supabase, tenantId, jobId, writeFailures, 'write')
        }

        totalCreated += result.created
        totalUpdated += result.updated
        totalFailed  += result.failed
        totalSkipped += result.skipped

        const processedRows    = Math.min(chunkNo * chunkSize, eligibleRows.length)
        const chunkDurationMs  = Date.now() - chunkStartMs
        const completedAt      = new Date().toISOString()
        const rps              = chunkDurationMs > 0
          ? Math.round((chunk.length / chunkDurationMs) * 1000 * 100) / 100
          : 0

        // Track for job-level aggregate
        totalChunkMs += chunkDurationMs
        peakChunkMs   = Math.max(peakChunkMs, chunkDurationMs)
        chunksRan++

        // Update chunk state (fire-and-forget — table may not exist in older DB schemas)
        supabase
          .from('import_job_chunks')
          .update({
            status:        'completed',
            success_count: result.created + result.updated,
            failure_count: result.failed,
            completed_at:  completedAt,
          })
          .eq('import_job_id', jobId)
          .eq('chunk_no', chunkNo)
          .then(() => {}, () => {})

        // Update job progress — only columns present since migration 108
        await supabase
          .from('import_jobs')
          .update({
            created_rows:  totalCreated,
            updated_rows:  totalUpdated,
            failed_rows:   totalFailed,
            skipped_rows:  totalSkipped,
          })
          .eq('id', jobId)

        // Per-chunk metrics (fire-and-forget — table may not exist in older DB schemas)
        supabase
          .from('import_job_metrics')
          .insert({
            import_job_id:     jobId,
            tenant_id:         tenantId,
            chunk_no:          chunkNo,
            chunk_duration_ms: chunkDurationMs,
            db_write_ms:       dbWriteMs,
            rows_per_second:   rps,
            success_count:     result.created + result.updated,
            failure_count:     result.failed,
            retry_count:       (meta?.attempt ?? 0),
          })
          .then(() => {}, () => {})

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)

        // fire-and-forget — table may not exist in older DB schemas
        supabase
          .from('import_job_chunks')
          .update({
            status:        'failed',
            error_summary: msg.slice(0, 1000),
            completed_at:  new Date().toISOString(),
          })
          .eq('import_job_id', jobId)
          .eq('chunk_no', chunkNo)
          .then(() => {}, () => {})

        throw err
      }
    }

  } finally {
    // Always clear heartbeat — even if a chunk threw
    clearInterval(heartbeatTimer)

    // Write job-level throughput metrics if any chunks ran
    if (chunksRan > 0) {
      const totalEligible   = eligibleRows.length
      const totalElapsedMs  = totalChunkMs
      const avgRps          = totalElapsedMs > 0
        ? Math.round((totalEligible / totalElapsedMs) * 1000 * 100) / 100
        : 0

      // fire-and-forget — peak_chunk_ms/avg_rows_per_sec may not exist in older DB schemas
      supabase
        .from('import_jobs')
        .update({
          peak_chunk_ms:    peakChunkMs,
          avg_rows_per_sec: avgRps,
        })
        .eq('id', jobId)
        .then(() => {}, () => {})
    }
  }

  return {
    created: totalCreated,
    updated: totalUpdated,
    failed:  totalFailed,
    skipped: totalSkipped,
  }
}
