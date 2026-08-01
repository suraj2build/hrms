/**
 * chunk-executor.ts — Chunk state machine for Phase C of the import pipeline.
 *
 * Phase C processes valid rows in chunks from the source file.
 * The executor streams the file once, sequentially, dispatching chunk-sized
 * groups of rows to the caller's apply function.
 *
 * Resumability:
 *   On retry, pass the chunkMap (pre-loaded from import_job_chunks).
 *   Chunks with status='completed' are skipped automatically.
 *   The file is still streamed from the beginning, but skipped rows
 *   are consumed without calling applyChunk.
 *
 * Memory model:
 *   At most one chunk's worth of rows is held in memory at a time.
 *   For 5,000-row chunks at ~100 bytes/row = ~500 KB peak usage.
 */

import type { SupabaseClient }   from '@supabase/supabase-js'
import type { Logger }            from 'pino'
import type { ImportJob, ImportJobChunk, ChunkResult, RowError } from './types.js'
import type { ParsedRow }         from './csv-stream.js'
import {
  markChunkStarted,
  markChunkCompleted,
  markChunkFailed,
  addRowErrors,
  updateJobProgress,
} from './service.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChunkRow {
  lineNumber:  number
  rowNumber:   number       // 1-indexed data row (header = row 0)
  values:      string[]
  headers:     string[]
}

export type ApplyChunkFn = (rows: ChunkRow[], chunkNo: number) => Promise<ChunkResult>

export interface ExecuteChunksOpts {
  job:        ImportJob
  supabase:   SupabaseClient
  log:        Logger
  rows:       AsyncGenerator<ParsedRow>
  headers:    string[]
  chunkSize:  number
  chunkMap:   Map<number, ImportJobChunk>
  applyChunk: ApplyChunkFn
}

// ── Executor ───────────────────────────────────────────────────────────────────

/**
 * Execute Phase C: stream rows, process chunk by chunk.
 *
 * Returns aggregate counts across all chunks.
 */
export async function executeChunks(opts: ExecuteChunksOpts): Promise<{
  processedRows: number
  successRows:   number
  failedRows:    number
}> {
  const { job, supabase, log, rows, headers, chunkSize, chunkMap, applyChunk } = opts

  let buffer:        ChunkRow[] = []
  let rowNumber      = 0
  let chunkNo        = 0
  let processedRows  = 0
  let successRows    = 0
  let failedRows     = 0

  async function flushChunk(buf: ChunkRow[], cn: number): Promise<void> {
    const existingChunk = chunkMap.get(cn)

    // Skip already-completed chunks (resumability)
    if (existingChunk?.status === 'completed') {
      log.debug({ jobId: job.id, chunkNo: cn }, '[import] skipping completed chunk')
      successRows   += existingChunk.success_count
      failedRows    += existingChunk.failure_count
      processedRows += existingChunk.success_count + existingChunk.failure_count
      return
    }

    if (!existingChunk) {
      // The pre-planned chunkMap (from computeChunkBoundaries at job creation)
      // has no entry for this chunk number — the file's actual row count at
      // stream time no longer matches the row count planning saw (e.g. the
      // source file changed between planning and streaming). Silently
      // returning here used to drop every row in this chunk from the job's
      // final counts with no error and no audit trail. Record it as a
      // failure instead so the job's totals stay honest and the gap is
      // discoverable.
      log.error({ jobId: job.id, chunkNo: cn, rowCount: buf.length }, '[import] chunk not found in chunkMap — rows dropped')
      const errors: RowError[] = buf.map(row => ({
        row_number:    row.rowNumber,
        error_stage:   'write',
        error_message: `Chunk ${cn} was not in the pre-planned chunk map — this row was never written`,
      }))
      await addRowErrors(supabase, job.id, job.tenant_id, errors)
      failedRows    += buf.length
      processedRows += buf.length
      await updateJobProgress(supabase, job.id, {
        processed_rows: processedRows,
        success_rows:   successRows,
        failed_rows:    failedRows,
        current_chunk:  cn,
      })
      return
    }

    await markChunkStarted(supabase, existingChunk)

    let result: ChunkResult
    try {
      result = await applyChunk(buf, cn)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ jobId: job.id, chunkNo: cn, err: msg }, '[import] chunk apply threw')
      await markChunkFailed(supabase, existingChunk.id, 0, buf.length, msg)
      failedRows    += buf.length
      processedRows += buf.length
      await updateJobProgress(supabase, job.id, {
        processed_rows: processedRows,
        success_rows:   successRows,
        failed_rows:    failedRows,
        current_chunk:  cn,
      })
      return
    }

    // Record row-level write errors
    if (result.errors.length > 0) {
      await addRowErrors(supabase, job.id, job.tenant_id, result.errors)
    }

    const chunkStatus = result.failure_count > 0 && result.success_count === 0
      ? 'failed'
      : 'completed'

    if (chunkStatus === 'failed') {
      await markChunkFailed(
        supabase,
        existingChunk.id,
        result.success_count,
        result.failure_count,
        result.errors[0]?.error_message ?? 'Unknown error',
      )
    } else {
      await markChunkCompleted(supabase, existingChunk.id, result.success_count, result.failure_count)
    }

    successRows   += result.success_count
    failedRows    += result.failure_count
    processedRows += result.success_count + result.failure_count

    await updateJobProgress(supabase, job.id, {
      processed_rows: processedRows,
      success_rows:   successRows,
      failed_rows:    failedRows,
      current_chunk:  cn,
      current_stage:  `Writing chunk ${cn} of ${chunkMap.size}`,
    })
  }

  for await (const parsed of rows) {
    rowNumber++
    chunkNo = Math.ceil(rowNumber / chunkSize)

    buffer.push({
      lineNumber: parsed.lineNumber,
      rowNumber,
      values:     parsed.values,
      headers,
    })

    if (buffer.length >= chunkSize) {
      await flushChunk(buffer, chunkNo)
      buffer = []
    }
  }

  // Flush remainder
  if (buffer.length > 0) {
    chunkNo = Math.ceil(rowNumber / chunkSize) || 1
    await flushChunk(buffer, chunkNo)
  }

  return { processedRows, successRows, failedRows }
}
