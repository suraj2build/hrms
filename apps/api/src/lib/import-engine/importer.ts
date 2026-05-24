// ── Universal Master Import Framework — Importer ─────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import { validateImportRows }  from './validator.js'
import type { ValidatedRow }   from './validator.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImportMode = 'create_only' | 'update_only' | 'upsert' | 'validate_only'

export interface ImportResult {
  importJobId: string
  created: number
  updated: number
  failed: number
  skipped: number
  duration_ms: number
}

// ── Table config ──────────────────────────────────────────────────────────────

interface TableConfig {
  table: string
  uniqueColumn: string
  mapRow: (tenantId: string, norm: Record<string, unknown>) => Record<string, unknown>
}

const TABLE_MAP: Record<string, TableConfig> = {
  employees: {
    table: 'employees',
    uniqueColumn: 'employee_code',
    mapRow: (tenantId, norm) => ({
      tenant_id:       tenantId,
      employee_code:   norm.employee_code,
      first_name:      norm.first_name,
      last_name:       norm.last_name,
      email:           norm.email,
      phone:           norm.phone ?? null,
      joining_date:    norm.joining_date,
      status:          norm.status ?? 'active',
    }),
  },

  shifts: {
    table: 'shifts',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:      tenantId,
      code:           norm.code,
      name:           norm.name,
      start_time:     norm.start_time,
      end_time:       norm.end_time,
      grace_minutes:  norm.grace_minutes ?? 0,
      is_night_shift: norm.is_night_shift ?? false,
      // weekly_off_days intentionally omitted — shifts carry timing rules only.
      // Configure weekly-off days on Roster templates instead.
    }),
  },

  departments: {
    table: 'departments',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:   tenantId,
      code:        norm.code,
      name:        norm.name,
      parent_code: norm.parent_code ?? null,
    }),
  },

  designations: {
    table: 'designations',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:       tenantId,
      code:            norm.code,
      name:            norm.name,
      department_code: norm.department_code ?? null,
      level:           norm.level ?? null,
    }),
  },

  work_locations: {
    table: 'work_locations',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id: tenantId,
      code:      norm.code,
      name:      norm.name,
      city:      norm.city    ?? null,
      state:     norm.state   ?? null,
      country:   norm.country ?? null,
      pincode:   norm.pincode ?? null,
    }),
  },

  cost_centers: {
    table: 'cost_centers',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:   tenantId,
      code:        norm.code,
      name:        norm.name,
      description: norm.description ?? null,
    }),
  },

  salary_components: {
    table: 'salary_components',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:          tenantId,
      code:               norm.code,
      name:               norm.name,
      component_type:     norm.component_type,
      is_taxable:         norm.is_taxable         ?? false,
      is_pf_applicable:   norm.is_pf_applicable   ?? false,
      is_esi_applicable:  norm.is_esi_applicable  ?? false,
    }),
  },

  leave_types: {
    table: 'leave_types',
    uniqueColumn: 'name',
    mapRow: (tenantId, norm) => ({
      tenant_id:       tenantId,
      name:            norm.name,
      is_paid:         norm.is_paid         ?? true,
      allow_sandwich:  norm.allow_sandwich  ?? false,
    }),
  },

  holiday_calendar: {
    table: 'holiday_calendar',
    uniqueColumn: 'date',
    mapRow: (tenantId, norm) => ({
      tenant_id:    tenantId,
      date:         norm.date,
      name:         norm.name,
      holiday_type: norm.holiday_type ?? 'national',
    }),
  },
}

// ── Batch insert helper ───────────────────────────────────────────────────────

const BATCH_SIZE = 100

async function batchInsert(
  supabase: SupabaseClient,
  table: string,
  records: Record<string, unknown>[],
  uniqueColumn: string,
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number; errors: Array<{ index: number; message: string }> }> {
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0
  const errors: Array<{ index: number; message: string }> = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    if (mode === 'upsert') {
      const { data, error } = await supabase
        .from(table)
        .upsert(batch, { onConflict: uniqueColumn })
        .select()

      if (error) {
        // Mark all in batch as failed
        for (let j = 0; j < batch.length; j++) {
          errors.push({ index: i + j, message: error.message })
          failed++
        }
      } else {
        // Rough heuristic: if a row's unique key was already in DB it's an update;
        // we don't have fine-grained info here, so trust the caller's duplicate flags.
        created += data?.length ?? batch.length
      }
    } else if (mode === 'create_only') {
      const { data, error } = await supabase
        .from(table)
        .insert(batch)
        .select()

      if (error) {
        for (let j = 0; j < batch.length; j++) {
          errors.push({ index: i + j, message: error.message })
          failed++
        }
      } else {
        created += data?.length ?? batch.length
      }
    } else if (mode === 'update_only') {
      // Update one-by-one on unique key (no bulk update-by-code in PostgREST)
      for (let j = 0; j < batch.length; j++) {
        const record = batch[j]
        const tenantId = record.tenant_id as string
        const keyVal   = record[uniqueColumn]
        const { error } = await supabase
          .from(table)
          .update(record)
          .eq('tenant_id', tenantId)
          .eq(uniqueColumn, keyVal)
        if (error) {
          errors.push({ index: i + j, message: error.message })
          failed++
        } else {
          updated++
        }
      }
    }
  }

  return { created, updated, failed, skipped, errors }
}

// ── Row-level result writer ───────────────────────────────────────────────────

async function writeRowResults(
  supabase: SupabaseClient,
  jobId: string,
  rows: ValidatedRow[],
  rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'>,
): Promise<void> {
  const payload = rows.map((vr) => ({
    import_job_id: jobId,
    row_number:    vr.rowNumber,
    status:        rowStatuses[vr.rowNumber] ?? (vr.isValid ? 'skipped' : 'failed'),
    errors:        vr.errors.length   > 0 ? vr.errors   : null,
    warnings:      vr.warnings.length > 0 ? vr.warnings : null,
    original_data: vr.originalData,
  }))

  // Batch write row results silently (non-critical)
  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    await supabase
      .from('import_job_rows')
      .insert(payload.slice(i, i + BATCH_SIZE))
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runImport(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  masterType: string,
  mode: ImportMode,
  rows: Record<string, string>[],
  fileName: string,
): Promise<ImportResult> {
  const startedAt = Date.now()

  // ── 1. Create the job record ─────────────────────────────────────────────
  const { data: jobData, error: jobCreateError } = await supabase
    .from('import_jobs')
    .insert({
      tenant_id:   tenantId,
      created_by:  createdBy,
      master_type: masterType,
      mode,
      file_name:   fileName,
      status:      'validating',
      total_rows:  rows.length,
    })
    .select('id')
    .single()

  if (jobCreateError || !jobData) {
    throw new Error(`Failed to create import job: ${jobCreateError?.message ?? 'unknown'}`)
  }

  const jobId = jobData.id as string

  try {
    // ── 2. Validate rows ─────────────────────────────────────────────────
    const validation = await validateImportRows(supabase, tenantId, masterType, rows)

    // ── 3. Update job with validation counts ────────────────────────────
    await supabase
      .from('import_jobs')
      .update({
        valid_rows:   validation.validRows,
        invalid_rows: validation.invalidRows,
      })
      .eq('id', jobId)

    // ── 4. validate_only mode — stop here ───────────────────────────────
    if (mode === 'validate_only') {
      await supabase
        .from('import_jobs')
        .update({ status: 'validated', duration_ms: Date.now() - startedAt })
        .eq('id', jobId)

      // Write row results even in validate_only so the user can inspect errors
      const rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'> = {}
      for (const vr of validation.rows) {
        rowStatuses[vr.rowNumber] = vr.isValid ? 'skipped' : 'failed'
      }
      await writeRowResults(supabase, jobId, validation.rows, rowStatuses)

      return {
        importJobId: jobId,
        created:     0,
        updated:     0,
        failed:      validation.invalidRows,
        skipped:     validation.validRows,
        duration_ms: Date.now() - startedAt,
      }
    }

    // ── 5. Update status to importing ───────────────────────────────────
    await supabase
      .from('import_jobs')
      .update({ status: 'importing' })
      .eq('id', jobId)

    // ── 6. Prepare records for insertion ────────────────────────────────
    const config = TABLE_MAP[masterType]
    if (!config) {
      throw new Error(`No table config for master type: ${masterType}`)
    }

    const rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'> = {}

    // Split rows by eligibility based on mode
    const toProcess: Array<{ vr: ValidatedRow; record: Record<string, unknown> }> = []
    let skippedCount = 0

    for (const vr of validation.rows) {
      if (!vr.isValid) {
        rowStatuses[vr.rowNumber] = 'failed'
        continue
      }

      if (mode === 'create_only' && vr.isDuplicate) {
        rowStatuses[vr.rowNumber] = 'skipped'
        skippedCount++
        continue
      }

      if (mode === 'update_only' && !vr.isDuplicate) {
        rowStatuses[vr.rowNumber] = 'skipped'
        skippedCount++
        continue
      }

      const record = config.mapRow(tenantId, vr.normalizedData)
      toProcess.push({ vr, record })
    }

    // ── 7. Batch upsert / insert ─────────────────────────────────────────
    const records = toProcess.map((p) => p.record)
    const result  = await batchInsert(
      supabase,
      config.table,
      records,
      config.uniqueColumn,
      mode,
    )

    // Map batch results back to individual row statuses
    for (let i = 0; i < toProcess.length; i++) {
      const { vr } = toProcess[i]
      const batchError = result.errors.find((e) => e.index === i)
      if (batchError) {
        rowStatuses[vr.rowNumber] = 'failed'
        vr.errors.push({ field: '_db', message: batchError.message, severity: 'error' })
      } else if (mode === 'update_only') {
        rowStatuses[vr.rowNumber] = 'updated'
      } else if (mode === 'upsert' && vr.isDuplicate) {
        rowStatuses[vr.rowNumber] = 'updated'
      } else {
        rowStatuses[vr.rowNumber] = 'created'
      }
    }

    // ── 8. Write row-level results ───────────────────────────────────────
    await writeRowResults(supabase, jobId, validation.rows, rowStatuses)

    const duration_ms = Date.now() - startedAt
    const totalCreated = mode === 'upsert'
      ? toProcess.filter((_, i) => !toProcess[i].vr.isDuplicate).length - result.failed
      : result.created
    const totalUpdated = mode === 'upsert'
      ? toProcess.filter((_, i) => toProcess[i].vr.isDuplicate).length
      : result.updated
    const totalFailed  = validation.invalidRows + result.failed
    const totalSkipped = skippedCount + result.skipped

    // ── 9. Finalise job ──────────────────────────────────────────────────
    await supabase
      .from('import_jobs')
      .update({
        status:       'completed',
        created_rows: totalCreated,
        updated_rows: totalUpdated,
        failed_rows:  totalFailed,
        skipped_rows: totalSkipped,
        duration_ms,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return {
      importJobId: jobId,
      created:     totalCreated,
      updated:     totalUpdated,
      failed:      totalFailed,
      skipped:     totalSkipped,
      duration_ms,
    }
  } catch (err) {
    // Mark job as failed on unexpected error
    await supabase
      .from('import_jobs')
      .update({
        status:      'failed',
        duration_ms: Date.now() - startedAt,
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq('id', jobId)
    throw err
  }
}
