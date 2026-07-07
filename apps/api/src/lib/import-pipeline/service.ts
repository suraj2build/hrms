/**
 * service.ts — Import job CRUD layer.
 *
 * All DB operations for the import pipeline go through here.
 * Routes and the worker use this instead of raw Supabase calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ImportJob,
  ImportJobStatus,
  ImportJobError,
  ImportJobChunk,
  RowError,
} from './types.js'

// ── Create ─────────────────────────────────────────────────────────────────────

export interface CreateImportJobParams {
  tenant_id:          string
  created_by:         string
  module:             string
  import_type:        string
  file_name:          string
  file_storage_path:  string
  file_size_bytes?:   number
  mime_type?:         string
  metadata?:          Record<string, unknown>
}

export async function createImportJob(
  supabase: SupabaseClient,
  params:   CreateImportJobParams,
): Promise<ImportJob> {
  const { data, error } = await supabase
    .from('import_jobs')
    .insert({
      tenant_id:         params.tenant_id,
      created_by:        params.created_by,
      module:            params.module,
      import_type:       params.import_type,
      master_type:       null,
      mode:              'upsert',
      status:            'uploaded',
      file_name:         params.file_name,
      file_storage_path: params.file_storage_path,
      file_size_bytes:   params.file_size_bytes  ?? null,
      mime_type:         params.mime_type         ?? 'text/csv',
      metadata:          params.metadata          ?? {},
      total_rows:        0,
      parsed_rows:       0,
      validated_rows:    0,
      processed_rows:    0,
      success_rows:      0,
      failed_rows:       0,
      skipped_rows:      0,
    })
    .select()
    .single()

  if (error) throw new Error(`createImportJob: ${error.message}`)
  return data as ImportJob
}

// ── Progress updates ───────────────────────────────────────────────────────────

export type JobProgressUpdate = Partial<{
  status:         ImportJobStatus
  current_stage:  string
  total_rows:     number
  parsed_rows:    number
  validated_rows: number
  processed_rows: number
  success_rows:   number
  failed_rows:    number
  skipped_rows:   number
  current_chunk:  number
  total_chunks:   number
  error_summary:  string
  started_at:     string
  completed_at:   string
}>

export async function updateJobProgress(
  supabase: SupabaseClient,
  jobId:    string,
  update:   JobProgressUpdate,
): Promise<void> {
  const { error } = await supabase
    .from('import_jobs')
    .update(update)
    .eq('id', jobId)

  if (error) throw new Error(`updateJobProgress: ${error.message}`)
}

// ── Error capture ──────────────────────────────────────────────────────────────

export async function addRowErrors(
  supabase:  SupabaseClient,
  jobId:     string,
  tenantId:  string,
  errors:    RowError[],
): Promise<void> {
  if (errors.length === 0) return

  const rows = errors.map(e => ({
    import_job_id: jobId,
    tenant_id:     tenantId,
    row_number:    e.row_number,
    row_key:       e.row_key        ?? null,
    error_stage:   e.error_stage,
    error_code:    e.error_code     ?? null,
    error_message: e.error_message,
    raw_payload:   e.raw_payload    ?? null,
  }))

  const { error } = await supabase.from('import_job_errors').insert(rows)
  if (error) throw new Error(`addRowErrors: ${error.message}`)
}

// ── Chunk management ───────────────────────────────────────────────────────────

export async function createChunks(
  supabase:  SupabaseClient,
  jobId:     string,
  tenantId:  string,
  chunks:    Array<{ chunk_no: number; start_row: number; end_row: number }>,
): Promise<void> {
  if (chunks.length === 0) return

  const rows = chunks.map(c => ({
    import_job_id: jobId,
    tenant_id:     tenantId,
    chunk_no:      c.chunk_no,
    start_row:     c.start_row,
    end_row:       c.end_row,
    status:        'pending',
    attempt:       0,
    success_count: 0,
    failure_count: 0,
  }))

  const { error } = await supabase
    .from('import_job_chunks')
    .upsert(rows, { onConflict: 'import_job_id,chunk_no', ignoreDuplicates: true })

  if (error) throw new Error(`createChunks: ${error.message}`)
}

export async function markChunkStarted(
  supabase: SupabaseClient,
  chunk:    ImportJobChunk,
): Promise<void> {
  const { error } = await supabase
    .from('import_job_chunks')
    .update({
      status:     'processing',
      attempt:    chunk.attempt + 1,
      started_at: new Date().toISOString(),
    })
    .eq('id', chunk.id)

  if (error) throw new Error(`markChunkStarted: ${error.message}`)
}

export async function markChunkCompleted(
  supabase:      SupabaseClient,
  chunkId:       string,
  successCount:  number,
  failureCount:  number,
): Promise<void> {
  const { error } = await supabase
    .from('import_job_chunks')
    .update({
      status:        'completed',
      success_count: successCount,
      failure_count: failureCount,
      completed_at:  new Date().toISOString(),
    })
    .eq('id', chunkId)

  if (error) throw new Error(`markChunkCompleted: ${error.message}`)
}

export async function markChunkFailed(
  supabase:      SupabaseClient,
  chunkId:       string,
  successCount:  number,
  failureCount:  number,
  errorSummary:  string,
): Promise<void> {
  const { error } = await supabase
    .from('import_job_chunks')
    .update({
      status:        'failed',
      success_count: successCount,
      failure_count: failureCount,
      error_summary: errorSummary,
      completed_at:  new Date().toISOString(),
    })
    .eq('id', chunkId)

  if (error) throw new Error(`markChunkFailed: ${error.message}`)
}

export async function getChunkMap(
  supabase: SupabaseClient,
  jobId:    string,
): Promise<Map<number, ImportJobChunk>> {
  const { data, error } = await supabase
    .from('import_job_chunks')
    .select('*')
    .eq('import_job_id', jobId)
    .order('chunk_no', { ascending: true })

  if (error) throw new Error(`getChunkMap: ${error.message}`)

  const map = new Map<number, ImportJobChunk>()
  for (const row of (data ?? []) as ImportJobChunk[]) {
    map.set(row.chunk_no, row)
  }
  return map
}

// ── Retry / reset helpers ──────────────────────────────────────────────────────

/**
 * Prepare a job for retry after failure.
 *
 * Phase B not completed (total_chunks IS NULL):
 *   Delete all errors + chunks → Phase B will re-run from scratch.
 *
 * Phase B completed (total_chunks IS NOT NULL):
 *   Delete only errors and chunks from the failed phase C chunks
 *   so Phase B results are preserved and Phase C can resume.
 */
export async function resetJobForRetry(
  supabase: SupabaseClient,
  job:      ImportJob,
): Promise<void> {
  if (job.total_chunks === null) {
    // Phase B incomplete — full reset
    await supabase.from('import_job_errors').delete().eq('import_job_id', job.id)
    await supabase.from('import_job_chunks').delete().eq('import_job_id', job.id)

    await updateJobProgress(supabase, job.id, {
      status:         'queued',
      current_stage:  undefined,
      parsed_rows:    0,
      validated_rows: 0,
      processed_rows: 0,
      success_rows:   0,
      failed_rows:    0,
      skipped_rows:   0,
      current_chunk:  undefined,
      total_chunks:   undefined,
      error_summary:  undefined,
    })
  } else {
    // Phase B is done — only reset failed/pending chunks; keep completed ones.
    // Write errors will be re-appended on the retry run.
    await supabase
      .from('import_job_errors')
      .delete()
      .eq('import_job_id', job.id)
      .eq('error_stage', 'write')

    await supabase
      .from('import_job_chunks')
      .update({ status: 'pending', attempt: 0, error_summary: null })
      .eq('import_job_id', job.id)
      .neq('status', 'completed')

    await updateJobProgress(supabase, job.id, {
      status:        'queued',
      current_stage: undefined,
      error_summary: undefined,
    })
  }
}

// ── Read helpers ───────────────────────────────────────────────────────────────

export async function getImportJob(
  supabase:  SupabaseClient,
  jobId:     string,
  tenantId:  string,
): Promise<ImportJob | null> {
  const { data, error } = await supabase
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`getImportJob: ${error.message}`)
  return data as ImportJob | null
}

export async function listImportJobs(
  supabase:   SupabaseClient,
  tenantId:   string,
  opts: {
    module?:  string
    status?:  ImportJobStatus
    limit?:   number
    offset?:  number
  } = {},
): Promise<{ jobs: ImportJob[]; total: number }> {
  let query = supabase
    .from('import_jobs')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 20) - 1)

  if (opts.module) query = query.eq('module', opts.module)
  if (opts.status) query = query.eq('status', opts.status)

  const { data, count, error } = await query
  if (error) throw new Error(`listImportJobs: ${error.message}`)

  return { jobs: (data ?? []) as ImportJob[], total: count ?? 0 }
}

export async function listJobErrors(
  supabase:  SupabaseClient,
  jobId:     string,
  tenantId:  string,
  opts: {
    stage?:   string
    limit?:   number
    offset?:  number
  } = {},
): Promise<{ errors: ImportJobError[]; total: number }> {
  let query = supabase
    .from('import_job_errors')
    .select('*', { count: 'exact' })
    .eq('import_job_id', jobId)
    .eq('tenant_id', tenantId)
    .order('row_number', { ascending: true })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1)

  if (opts.stage) query = query.eq('error_stage', opts.stage)

  const { data, count, error } = await query
  if (error) throw new Error(`listJobErrors: ${error.message}`)

  return { errors: (data ?? []) as ImportJobError[], total: count ?? 0 }
}

export async function streamAllJobErrors(
  supabase:  SupabaseClient,
  jobId:     string,
  tenantId:  string,
): Promise<ImportJobError[]> {
  const PAGE = 1000
  const all: ImportJobError[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('import_job_errors')
      .select('*')
      .eq('import_job_id', jobId)
      .eq('tenant_id', tenantId)
      .order('row_number', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) throw new Error(`streamAllJobErrors: ${error.message}`)
    if (!data || data.length === 0) break

    all.push(...(data as ImportJobError[]))
    if (data.length < PAGE) break
    offset += PAGE
  }

  return all
}
