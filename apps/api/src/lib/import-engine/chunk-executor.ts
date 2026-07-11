// ── Enterprise Import Platform — Chunk Executor ──────────────────────────────
//
// Generic chunked execution engine. All bulk imports funnel through here:
//   • Pre-creates import_job_chunks (idempotent — safe to re-run)
//   • Writes validation failures to import_job_errors
//   • Processes eligible rows in chunks (default 5 000 rows/chunk)
//   • Skips 'completed' chunks on resume (crash recovery / checkpoint)
//   • Stamps import_jobs progress + last_activity_at after every chunk
//
// rotation_policies is intentionally excluded — its grouped multi-row write
// cannot be split at arbitrary row boundaries without corrupting rule sets.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ValidatedRow }   from './validator.js'

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_CHUNK_SIZE = 5_000
const ERROR_BATCH_SIZE          = 200

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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
        import_job_id: jobId,
        tenant_id:     tenantId,
        row_number:    vr.rowNumber,
        row_key:       getRowKey(vr),
        error_stage:   stage,
        error_code:    e.field === '_db' ? 'DB_ERROR' : `FIELD_${e.field.toUpperCase()}`,
        error_message: e.message,
        raw_payload:   vr.originalData,
      })
    }
    // Row is invalid but has no error messages — emit a generic entry so
    // the UI always has something to display.
    if (vr.errors.length === 0) {
      records.push({
        import_job_id: jobId,
        tenant_id:     tenantId,
        row_number:    vr.rowNumber,
        row_key:       getRowKey(vr),
        error_stage:   stage,
        error_code:    'UNKNOWN',
        error_message: 'Row failed without a specific error message.',
        raw_payload:   vr.originalData,
      })
    }
  }

  if (records.length === 0) return

  for (let i = 0; i < records.length; i += ERROR_BATCH_SIZE) {
    await supabase
      .from('import_job_errors')
      .insert(records.slice(i, i + ERROR_BATCH_SIZE))
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

  // 4. Upsert chunk records — ignoreDuplicates so a resume doesn't overwrite
  //    'completed' status with 'pending'.
  const chunkRecords = chunks.map((ch, idx) => ({
    import_job_id: jobId,
    tenant_id:     tenantId,
    chunk_no:      idx + 1,
    start_row:     ch[0].rowNumber,
    end_row:       ch[ch.length - 1].rowNumber,
    status:        'pending',
    attempt:       0,
  }))

  await supabase
    .from('import_job_chunks')
    .upsert(chunkRecords, { onConflict: 'import_job_id,chunk_no', ignoreDuplicates: true })

  // 5. Fetch live chunk statuses (to detect already-completed chunks on resume)
  const { data: liveChunks } = await supabase
    .from('import_job_chunks')
    .select('chunk_no, id, status, success_count, failure_count')
    .eq('import_job_id', jobId)
    .order('chunk_no', { ascending: true })

  const chunkMeta = new Map<number, {
    id:            string
    status:        string
    success_count: number
    failure_count: number
  }>()
  for (const row of liveChunks ?? []) {
    chunkMeta.set(row.chunk_no as number, {
      id:            row.id            as string,
      status:        row.status        as string,
      success_count: (row.success_count as number) ?? 0,
      failure_count: (row.failure_count as number) ?? 0,
    })
  }

  const isResume = [...chunkMeta.values()].some((m) => m.status === 'completed')

  // 6. Update job with total chunk count and stage
  await supabase
    .from('import_jobs')
    .update({ total_chunks: totalChunks, current_stage: 'writing' })
    .eq('id', jobId)

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

  // 8. Process each chunk
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkNo = idx + 1
    const chunk   = chunks[idx]
    const meta    = chunkMeta.get(chunkNo)

    // Checkpoint: skip already-completed chunks
    if (meta?.status === 'completed') continue

    const startedAt = new Date().toISOString()

    // Mark chunk as processing
    await supabase
      .from('import_job_chunks')
      .update({
        status:     'processing',
        attempt:    (meta?.status ? 1 : 0) + 1,
        started_at: startedAt,
      })
      .eq('import_job_id', jobId)
      .eq('chunk_no', chunkNo)

    try {
      // Snapshot which rows are currently valid (to detect write-failures below)
      const validBefore = new Set(chunk.filter((vr) => vr.isValid).map((vr) => vr.rowNumber))

      const result = await processChunk(chunk)

      // Rows that were valid before but became invalid during processing = write failures
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

      const processedRows = Math.min(chunkNo * chunkSize, eligibleRows.length)
      const completedAt   = new Date().toISOString()

      await supabase
        .from('import_job_chunks')
        .update({
          status:        'completed',
          success_count: result.created + result.updated,
          failure_count: result.failed,
          completed_at:  completedAt,
        })
        .eq('import_job_id', jobId)
        .eq('chunk_no', chunkNo)

      await supabase
        .from('import_jobs')
        .update({
          processed_rows:   processedRows,
          created_rows:     totalCreated,
          updated_rows:     totalUpdated,
          failed_rows:      totalFailed,
          skipped_rows:     totalSkipped,
          current_chunk:    chunkNo,
          last_activity_at: completedAt,
        })
        .eq('id', jobId)

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      await supabase
        .from('import_job_chunks')
        .update({
          status:        'failed',
          error_summary: msg.slice(0, 1000),
          completed_at:  new Date().toISOString(),
        })
        .eq('import_job_id', jobId)
        .eq('chunk_no', chunkNo)

      // Rethrow — the caller's outer catch will mark the job as failed
      throw err
    }
  }

  return {
    created: totalCreated,
    updated: totalUpdated,
    failed:  totalFailed,
    skipped: totalSkipped,
  }
}
