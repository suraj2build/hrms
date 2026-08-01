/**
 * community-celebrations.ts
 *
 * Auto-generates Community feed posts for today's birthdays and work
 * anniversaries. System-authored (author_employee = NULL) so they read as
 * "It's Kavya's birthday today!" rather than a personal wish — the per-person
 * "Wish" button then layers a personal celebration post on top.
 *
 * Idempotent: skips a celebration that already has a system post today (checked
 * in JS), and a partial unique index (migration 310) is the race-safe backstop
 * so two concurrent feed loads can't double-post.
 *
 * Cheap enough to call lazily on feed / home reads; a nightly cron can also call
 * runTenantCelebrations directly. Never throws — celebration generation must
 * never break the feed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate, localDayBoundsUtc } from './org-context.js'
import { logger } from './logger.js'

interface EmpRow {
  id: string
  first_name: string | null
  last_name:  string | null
  dob:        string | null
  joining_date: string | null
}

const firstName = (e: EmpRow) => (e.first_name ?? '').trim() || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'A colleague'

/** True when the MM-DD of an ISO date string matches today (year-agnostic). */
function isAnniversaryToday(iso: string, m: number, d: number): boolean {
  const dt = new Date(iso + 'T00:00:00')
  return !isNaN(dt.getTime()) && dt.getMonth() === m && dt.getDate() === d
}

/**
 * Ensure today's birthday + anniversary system posts exist for one tenant.
 * Returns the number of new posts created. Swallows all errors.
 */
export async function ensureTodaysCelebrations(supabase: SupabaseClient, tenantId: string): Promise<number> {
  try {
    // Tenant-local "today" — never the server process's own clock/TZ (same bug
    // class already fixed in absconding-engine.ts / compliance-calendar.ts).
    const tz = await fetchTenantTz(supabase, tenantId)
    const todayStr = getLocalDate(new Date().toISOString(), tz)
    const [yearStr, monthStr, dayStr] = todayStr.split('-')
    const year = Number(yearStr)
    const m    = Number(monthStr) - 1   // isAnniversaryToday expects getMonth()-style 0-indexed month
    const d    = Number(dayStr)

    // .limit(2000) previously relied on the server never capping below 2000 —
    // fetchAllRows is correct at any server-side row cap.
    const rows = await fetchAllRows<EmpRow>((from, to) =>
      supabase
        .from('employees')
        .select('id, first_name, last_name, dob, joining_date')
        .eq('tenant_id', tenantId).eq('status', 'active')
        .order('id')
        .range(from, to) as any,
    )
    if (!rows.length) return 0

    const birthdays = rows.filter((e) => e.dob && isAnniversaryToday(e.dob, m, d))
    const anniversaries = rows.filter((e) => {
      if (!e.joining_date || !isAnniversaryToday(e.joining_date, m, d)) return false
      return year - Number(e.joining_date.slice(0, 4)) > 0   // skip the joining day itself
    })
    if (!birthdays.length && !anniversaries.length) return 0

    // What already exists today (system posts only) → skip duplicates.
    const { startUtc: startOfDay } = localDayBoundsUtc(todayStr, tz)
    const { data: existing } = await supabase
      .from('feed_posts')
      .select('type, subject_employee')
      .eq('tenant_id', tenantId)
      .is('author_employee', null)
      .in('type', ['birthday', 'anniversary'])
      .gte('created_at', startOfDay)
    const seen = new Set((existing ?? []).map((p: any) => `${p.type}:${p.subject_employee}`))

    const toInsert: Record<string, unknown>[] = []
    for (const e of birthdays) {
      if (seen.has(`birthday:${e.id}`)) continue
      toInsert.push({
        tenant_id: tenantId, author_employee: null, subject_employee: e.id,
        type: 'birthday', audience_scope: 'company',
        body: `🎂 It's ${firstName(e)}'s birthday today! Drop a wish to make their day. 🎉`,
      })
    }
    for (const e of anniversaries) {
      if (seen.has(`anniversary:${e.id}`)) continue
      const years = year - Number((e.joining_date as string).slice(0, 4))
      toInsert.push({
        tenant_id: tenantId, author_employee: null, subject_employee: e.id,
        type: 'anniversary', audience_scope: 'company',
        body: `🎉 ${firstName(e)} completes ${years} year${years === 1 ? '' : 's'} with us today! Thank you for everything. 🙌`,
      })
    }
    if (!toInsert.length) return 0

    // Insert one-by-one so a unique-index conflict (a racing request already
    // created it) drops just that row instead of failing the whole batch.
    let created = 0
    for (const row of toInsert) {
      const { error } = await supabase.from('feed_posts').insert(row)
      if (!error) created++
      else if (error.code !== '23505') {
        // 23505 = unique_violation (expected under races); anything else is real.
        logger.error({ err: error }, '[celebrations] insert failed')
      }
    }
    return created
  } catch (err) {
    logger.error({ err }, '[celebrations] generation failed')
    return 0
  }
}
