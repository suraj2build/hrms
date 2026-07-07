/**
 * imports.ts — API client helpers for the enterprise import pipeline.
 */

import { api } from './client'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ImportJobStatus =
  | 'uploaded'
  | 'queued'
  | 'parsing'
  | 'validating'
  | 'processing'
  | 'partial_failed'
  | 'pending'
  | 'validated'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ImportJob {
  id:                 string
  tenant_id:          string
  module:             string | null
  import_type:        string | null
  status:             ImportJobStatus
  current_stage:      string | null
  file_name:          string
  file_size_bytes:    number | null
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
  created_at:         string
  created_by:         string | null
}

export interface ImportJobError {
  id:             string
  import_job_id:  string
  row_number:     number
  row_key:        string | null
  error_stage:    string
  error_code:     string | null
  error_message:  string
  created_at:     string
}

export interface CreateImportJobParams {
  module:             string
  import_type:        string
  file_name:          string
  file_storage_path:  string
  file_size_bytes?:   number
  mime_type?:         string
  metadata?:          Record<string, unknown>
}

// ── API calls ──────────────────────────────────────────────────────────────────

export const importsApi = {
  create: (params: CreateImportJobParams) =>
    api.post<{ job: ImportJob }>('/imports', params),

  list: (opts?: { module?: string; status?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (opts?.module)  qs.set('module',  opts.module)
    if (opts?.status)  qs.set('status',  opts.status)
    if (opts?.limit)   qs.set('limit',   String(opts.limit))
    if (opts?.offset)  qs.set('offset',  String(opts.offset))
    const q = qs.toString()
    return api.get<{ jobs: ImportJob[]; total: number }>(`/imports${q ? `?${q}` : ''}`)
  },

  get: (jobId: string) =>
    api.get<{ job: ImportJob }>(`/imports/${jobId}`),

  listErrors: (jobId: string, opts?: { stage?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (opts?.stage)   qs.set('stage',  opts.stage)
    if (opts?.limit)   qs.set('limit',  String(opts.limit))
    if (opts?.offset)  qs.set('offset', String(opts.offset))
    const q = qs.toString()
    return api.get<{ errors: ImportJobError[]; total: number }>(`/imports/${jobId}/errors${q ? `?${q}` : ''}`)
  },

  exportErrorsCsvUrl: (jobId: string) => `/imports/${jobId}/errors/export`,

  retry: (jobId: string) =>
    api.post<{ job: ImportJob }>(`/imports/${jobId}/retry`),

  cancel: (jobId: string) =>
    api.post<{ job: ImportJob }>(`/imports/${jobId}/cancel`),
}
