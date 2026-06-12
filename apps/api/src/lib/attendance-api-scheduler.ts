/**
 * Attendance API Scheduler
 *
 * Polls attendance_api_sources rows on their configured intervals and
 * ingests the returned punch records into attendance_raw_logs.
 *
 * Tick interval: every TICK_MS (5 minutes). Each tick queries for sources
 * whose next-due time has passed: last_fetched_at + poll_interval_min < now().
 * Sources with poll_interval_min = 0 are manual-only and never auto-fetched.
 *
 * Errors per-source are caught and logged; one failing source never blocks others.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSourceData }     from '../routes/attendance/api-sources.js'

// How often the scheduler wakes up and checks for due sources (5 minutes)
const TICK_MS = 5 * 60 * 1_000

// Resolve dot-path (same logic as in api-sources.ts — kept local to avoid circular import)
function resolvePath(obj: unknown, path?: string | null): unknown {
  if (!path) return obj
  const parts = path.replace(/^\$\.?/, '').split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

async function runDueSources(supabase: SupabaseClient): Promise<void> {
  // Find active sources whose next fetch is overdue
  const now = new Date()

  const { data: sources, error } = await supabase
    .from('attendance_api_sources')
    .select('*')
    .eq('is_active', true)
    .gt('poll_interval_min', 0)

  if (error || !sources?.length) {
    if (error) console.warn('[att-api-scheduler] source query failed:', error.message)
    return
  }

  const due = sources.filter((s: any) => {
    if (s.last_fetch_status === 'running') return false  // already in-flight
    if (!s.last_fetched_at) return true                  // never fetched
    const next = new Date(s.last_fetched_at).getTime() + s.poll_interval_min * 60_000
    return now.getTime() >= next
  })

  if (!due.length) return

  console.log(`[att-api-scheduler] ${due.length} source(s) due — fetching`)

  for (const source of due) {
    await processSingleSource(supabase, source).catch((err: Error) =>
      console.error(`[att-api-scheduler] source ${source.id} unhandled error:`, err.message),
    )
  }
}

async function processSingleSource(supabase: SupabaseClient, source: any): Promise<void> {
  // Mark as running
  await supabase
    .from('attendance_api_sources')
    .update({ last_fetch_status: 'running' })
    .eq('id', source.id)

  const result = await fetchSourceData(source)

  if (!result.ok) {
    await supabase
      .from('attendance_api_sources')
      .update({
        last_fetch_status: 'error',
        last_fetch_error:  result.error ?? `HTTP ${result.status}`,
        last_fetched_at:   new Date().toISOString(),
      })
      .eq('id', source.id)

    console.warn(`[att-api-scheduler] source ${source.id} (${source.name}) fetch failed:`, result.error)
    return
  }

  // Resolve records from response
  const resolved = resolvePath(result.raw, source.response_path)
  const records: unknown[] = Array.isArray(resolved) ? resolved : (resolved != null ? [resolved] : [])

  // Map & upsert into attendance_raw_logs
  const rows: Array<{
    tenant_id:     string
    source_id:     string
    employee_code: string
    timestamp:     string
    direction:     string
  }> = []

  for (const rec of records) {
    if (typeof rec !== 'object' || rec == null) continue
    const r = rec as Record<string, unknown>

    const empCode = String(r[source.field_employee_code] ?? '').trim()
    const tsRaw   = r[source.field_timestamp]
    const dirRaw  = String(r[source.field_direction] ?? '').trim().toLowerCase()

    if (!empCode || !tsRaw) continue
    const ts = new Date(tsRaw as string)
    if (isNaN(ts.getTime())) continue

    const direction =
      dirRaw === 'in'  || dirRaw === '1' || dirRaw === 'entry' ? 'in'
      : dirRaw === 'out' || dirRaw === '0' || dirRaw === 'exit' ? 'out'
      : null

    if (!direction) continue

    rows.push({
      tenant_id:     source.tenant_id,
      source_id:     source.id,
      employee_code: empCode,
      timestamp:     ts.toISOString(),
      direction,
    })
  }

  let ingested = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error: insErr } = await supabase
      .from('attendance_raw_logs')
      .upsert(chunk, { onConflict: 'tenant_id,employee_code,timestamp,direction', ignoreDuplicates: true })

    if (insErr) {
      console.warn(`[att-api-scheduler] source ${source.id} insert error:`, insErr.message)
    } else {
      ingested += chunk.length
    }
  }

  await supabase
    .from('attendance_api_sources')
    .update({
      last_fetch_status: 'success',
      last_fetch_error:  null,
      last_fetch_count:  ingested,
      last_fetched_at:   new Date().toISOString(),
    })
    .eq('id', source.id)

  console.log(`[att-api-scheduler] source ${source.id} (${source.name}) ingested=${ingested} total_records=${records.length}`)
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function registerAttendanceApiScheduler(supabase: SupabaseClient): void {
  // Initial tick after 30 s to let the process warm up first
  setTimeout(() => {
    runDueSources(supabase).catch((err: Error) =>
      console.error('[att-api-scheduler] initial tick error:', err.message),
    )
  }, 30_000)

  setInterval(() => {
    runDueSources(supabase).catch((err: Error) =>
      console.error('[att-api-scheduler] tick error:', err.message),
    )
  }, TICK_MS)

  console.log(`🔌 Attendance API scheduler active — ticking every ${TICK_MS / 60_000} min`)
}
