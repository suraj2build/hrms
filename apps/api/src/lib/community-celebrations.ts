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
    const now  = new Date()
    const m    = now.getMonth()
    const d    = now.getDate()
    const year = now.getFullYear()

    const { data: emps } = await supabase
      .from('employees')
      .select('id, first_name, last_name, dob, joining_date')
      .eq('tenant_id', tenantId).eq('status', 'active')
      .limit(2000)
    const rows = (emps ?? []) as EmpRow[]
    if (!rows.length) return 0

    const birthdays = rows.filter((e) => e.dob && isAnniversaryToday(e.dob, m, d))
    const anniversaries = rows.filter((e) => {
      if (!e.joining_date || !isAnniversaryToday(e.joining_date, m, d)) return false
      return year - Number(e.joining_date.slice(0, 4)) > 0   // skip the joining day itself
    })
    if (!birthdays.length && !anniversaries.length) return 0

    // What already exists today (system posts only) → skip duplicates.
    const startOfDay = new Date(year, m, d, 0, 0, 0, 0).toISOString()
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
        console.error('[celebrations] insert failed', error.message)
      }
    }
    return created
  } catch (err) {
    console.error('[celebrations] generation failed', err)
    return 0
  }
}
