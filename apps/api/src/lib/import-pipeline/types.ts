/**
 * types.ts — Shared TypeScript types for the enterprise import pipeline.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger }         from 'pino'

// ── Job lifecycle ──────────────────────────────────────────────────────────────

export type ImportJobStatus =
  // new pipeline statuses
  | 'uploaded'
  | 'queued'
  | 'parsing'
  | 'validating'
  | 'processing'
  | 'partial_failed'
  // legacy master import statuses
  | 'pending'
  | 'validated'
  | 'importing'
  // terminal
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ImportJobErrorStage =
  | 'parse'
  | 'validation'
  | 'business_validation'
  | 'write'

export type ChunkStatus = 'pending' | 'processing' | 'completed' | 'failed'

// ── DB row shapes ──────────────────────────────────────────────────────────────

export interface ImportJob {
  id:                 string
  tenant_id:          string
  module:             string | null
  import_type:        string | null
  master_type:        string | null
  mode:               string
  status:             ImportJobStatus
  current_stage:      string | null
  file_name:          string
  file_storage_path:  string | null
  file_size_bytes:    number | null
  mime_type:          string | null
  total_rows:         number
  parsed_rows:        number
  validated_rows:     number
  processed_rows:     number
  success_rows:       number
  failed_rows:        number
  skipped_rows:       number
  current_chunk:      number | null
  total_chunks:       number | null
  error_summary:      unknown
  metadata:           Record<string, unknown>
  started_at:         string | null
  completed_at:       string | null
  created_by:         string | null
  created_at:         string
}

export interface ImportJobError {
  id:             string
  import_job_id:  string
  tenant_id:      string
  row_number:     number
  row_key:        string | null
  error_stage:    ImportJobErrorStage
  error_code:     string | null
  error_message:  string
  raw_payload:    Record<string, unknown> | null
  created_at:     string
}

export interface ImportJobChunk {
  id:             string
  import_job_id:  string
  tenant_id:      string
  chunk_no:       number
  start_row:      number
  end_row:        number
  status:         ChunkStatus
  attempt:        number
  success_count:  number
  failure_count:  number
  error_summary:  string | null
  started_at:     string | null
  completed_at:   string | null
}

// ── Worker / module contract ───────────────────────────────────────────────────

export interface RowError {
  row_number:     number
  row_key?:       string | null
  error_stage:    ImportJobErrorStage
  error_code?:    string | null
  error_message:  string
  raw_payload?:   Record<string, unknown> | null
}

export interface ChunkResult {
  success_count: number
  failure_count: number
  errors:        RowError[]
}

/**
 * Interface every module must implement.
 * The module is responsible for Phase B (parse + validate) and Phase C (apply).
 * It uses service.ts helpers to update job state and record errors / chunks.
 */
export interface ImportModuleHandler {
  handle(job: ImportJob, supabase: SupabaseClient, log: Logger): Promise<void>
}
