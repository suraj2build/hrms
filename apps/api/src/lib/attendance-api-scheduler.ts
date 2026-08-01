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
import { durableQueue }        from './durable-queue.js'
import { logger }              from './logger.js'

// How often the scheduler wakes up and checks for due sources (5 minutes)
const TICK_MS = 5 * 60 * 1_000

// A source stuck in 'running' longer than this is treated as abandoned (the
// process that claimed it likely crashed/restarted before recording a
// terminal status) and becomes eligible for another attempt, instead of being
// excluded from every future poll forever.
const STALE_RUNNING_MS = 30 * 60 * 1_000

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

export async function runDueSources(supabase: SupabaseClient): Promise<void> {
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
    if (s.last_fetch_status === 'running') {
      // `updated_at` auto-bumps on every UPDATE (including the one that set
      // 'running'), so it doubles as "claimed since". A row stuck here past
      // the staleness window survived a crash/restart before recording a
      // terminal status — treat it as abandoned rather than excluding it
      // from every future poll forever.
      const claimedSince = s.updated_at ? new Date(s.updated_at).getTime() : 0
      if (now.getTime() - claimedSince < STALE_RUNNING_MS) return false
    }
    if (!s.last_fetched_at) return true                  // never fetched
    const next = new Date(s.last_fetched_at).getTime() + s.poll_interval_min * 60_000
    return now.getTime() >= next
  })

  if (!due.length) return

  console.log(`[att-api-scheduler] ${due.length} source(s) due — fetching`)

  for (const source of due) {
    await processSingleSource(supabase, source).catch((err: Error) =>
      logger.error({ err, sourceId: source.id }, `[att-api-scheduler] source ${source.id} unhandled error`),
    )
  }
}

async function processSingleSource(supabase: SupabaseClient, source: any): Promise<void> {
  // Atomically claim: guard the WHERE clause on "not currently running" so
  // two overlapping ticks/instances racing on the same due source can't both
  // proceed to fetch — only one UPDATE actually matches a row.
  const { data: claimed, error: runningErr } = await supabase
    .from('attendance_api_sources')
    .update({ last_fetch_status: 'running' })
    .eq('id', source.id)
    .or('last_fetch_status.is.null,last_fetch_status.neq.running')
    .select('id')
    .maybeSingle()
  if (runningErr) {
    console.warn(`[att-api-scheduler] source ${source.id} failed to mark running:`, runningErr.message)
    return
  }
  if (!claimed) {
    console.log(`[att-api-scheduler] source ${source.id} already claimed by a concurrent run — skipping`)
    return
  }

  const result = await fetchSourceData(source)

  if (!result.ok) {
    const { error: errStatusErr } = await supabase
      .from('attendance_api_sources')
      .update({
        last_fetch_status: 'error',
        last_fetch_error:  result.error ?? `HTTP ${result.status}`,
        last_fetched_at:   new Date().toISOString(),
      })
      .eq('id', source.id)
    // If this write itself fails, last_fetch_status is stuck at 'running' from
    // above, and the scheduler's `due` filter treats 'running' as already
    // in-flight — silently excluding this source from every future poll until
    // an operator manually resets the row.
    if (errStatusErr) console.warn(`[att-api-scheduler] source ${source.id} failed to record fetch error:`, errStatusErr.message)

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

  const { error: successErr } = await supabase
    .from('attendance_api_sources')
    .update({
      last_fetch_status: 'success',
      last_fetch_error:  null,
      last_fetch_count:  ingested,
      last_fetched_at:   new Date().toISOString(),
    })
    .eq('id', source.id)
  // Same stuck-at-'running' risk as the error-status write above.
  if (successErr) console.warn(`[att-api-scheduler] source ${source.id} failed to record fetch success:`, successErr.message)

  console.log(`[att-api-scheduler] source ${source.id} (${source.name}) ingested=${ingested} total_records=${records.length}`)
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function registerAttendanceApiScheduler(supabase: SupabaseClient): void {
  const enqueue = () => {
    // 5-minute bucket idempotency key prevents duplicate runs on concurrent ticks
    const now = new Date()
    const min5 = Math.floor(now.getUTCMinutes() / 5) * 5
    const key = `process-attendance:${now.toISOString().slice(0, 15)}${String(min5).padStart(2, '0')}`
    durableQueue.enqueue('process-attendance', {}, { idempotencyKey: key }).catch((err: Error) =>
      logger.error({ err }, '[att-api-scheduler] enqueue error'),
    )
  }

  // Initial tick after 30 s to let the process warm up first
  setTimeout(enqueue, 30_000)
  setInterval(enqueue, TICK_MS)

  console.log(`🔌 Attendance API scheduler active — ticking every ${TICK_MS / 60_000} min`)
}
