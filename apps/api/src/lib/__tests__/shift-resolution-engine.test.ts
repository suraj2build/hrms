/**
 * shift-resolution-engine parity tests (AHI-1).
 *
 * Validates the two AHI-1 guarantees that matter most:
 *   1. resolveShiftWithAttribution (single-day engine) and resolveShiftBatch
 *      (batch processor) resolve the SAME shift + attribution for the same
 *      inputs, across every level of the priority chain.
 *   2. employee_shifts is resolved TEMPORALLY (effective_from/effective_to),
 *      not via is_current — so historical recomputes are deterministic.
 *
 * Uses a hand-rolled thenable query-builder stub so no live DB is required.
 */
import { describe, it, expect } from 'vitest'
import { resolveShiftWithAttribution, resolveShiftBatch } from '../shift-resolution-engine.js'

const TENANT = 't1'
const DATE = '2026-03-10' // a Tuesday → condition 'weekday'

// ── Fixtures ────────────────────────────────────────────────────────────────
// tenant_id is required on every row: resolveShiftBatch's Step 6 shift-detail
// query scopes `.eq('tenant_id', tenantId)` (ISSUE-272 cross-tenant IDOR fix,
// commit 096855b) — without it these fixtures are silently filtered out of
// shiftDetails and the batch resolver returns nothing, even though the real
// `shifts` table always carries tenant_id.
const SHIFTS = {
  morning: { id: 's-morning', tenant_id: TENANT, name: 'Morning', start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 15, is_night_shift: false },
  night:   { id: 's-night',   tenant_id: TENANT, name: 'Night',   start_time: '22:00:00', end_time: '06:00:00', grace_minutes: 10, is_night_shift: true  },
  rot:     { id: 's-rot',     tenant_id: TENANT, name: 'Rotation',start_time: '08:00:00', end_time: '16:00:00', grace_minutes: 5,  is_night_shift: false },
  site:    { id: 's-site',    tenant_id: TENANT, name: 'SiteDef', start_time: '10:00:00', end_time: '18:00:00', grace_minutes: 20, is_night_shift: false },
}

/**
 * Minimal Supabase stub. Each table resolves to a fixture array; the fluent
 * chain (.select/.eq/.in/.lte/.or/.order/.limit/.maybeSingle) filters rows in
 * memory and is awaitable. Only the operators the resolver uses are modelled.
 */
function makeSupabase(tables: Record<string, any[]>) {
  function builder(rows: any[]) {
    let filtered = [...rows]
    const api: any = {
      select() { return api },
      eq(col: string, val: any) { filtered = filtered.filter(r => r[col] === val); return api },
      in(col: string, vals: any[]) { filtered = filtered.filter(r => vals.includes(r[col])); return api },
      lte(col: string, val: any) { filtered = filtered.filter(r => r[col] != null && r[col] <= val); return api },
      not(col: string, _op: string, _v: any) { filtered = filtered.filter(r => r[col] != null); return api },
      or(expr: string) {
        // Only used for: 'effective_to.is.null,effective_to.gte.<date>'
        const m = expr.match(/effective_to\.gte\.(.+)$/)
        const d = m?.[1]
        filtered = filtered.filter(r => r.effective_to == null || (d != null && r.effective_to >= d))
        return api
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false
        filtered = [...filtered].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
        return api
      },
      limit(n: number) { filtered = filtered.slice(0, n); return api },
      maybeSingle() { return Promise.resolve({ data: filtered[0] ?? null, error: null }) },
      then(resolve: any) { return Promise.resolve({ data: filtered, error: null }).then(resolve) },
    }
    return api
  }
  return { from(table: string) { return builder(tables[table] ?? []) } } as any
}

/** Both resolvers run against the SAME fixtures; assert they agree. */
async function bothResolve(tables: Record<string, any[]>, empId: string) {
  const sb = makeSupabase(tables)
  const single = await resolveShiftWithAttribution(sb, TENANT, empId, DATE)
  const batch = (await resolveShiftBatch(makeSupabase(tables), TENANT, [empId], DATE)).get(empId) ?? null
  return { single, batch }
}

describe('shift-resolution-engine — single/batch parity', () => {
  it('priority 1: shift_roster override resolves identically', async () => {
    const tables = {
      shift_roster: [{ tenant_id: TENANT, employee_id: 'e1', date: DATE, shift_id: SHIFTS.morning.id, shifts: SHIFTS.morning }],
      shifts: [SHIFTS.morning],
      employees: [{ id: 'e1', tenant_id: TENANT, site_id: null, rotation_policy_id: null, sites: null }],
    }
    const { single, batch } = await bothResolve(tables, 'e1')
    expect(single?.shift_id).toBe(SHIFTS.morning.id)
    expect(single?.resolution_source).toBe('shift_roster')
    expect(batch).toEqual(single)
  })

  it('priority 2: rotation_policy resolves identically with attribution', async () => {
    const tables = {
      shift_roster: [],
      employees: [{ id: 'e2', tenant_id: TENANT, site_id: 'site1', rotation_policy_id: 'rp1',
        sites: { default_rotation_policy_id: null, default_shift_id: null, shifts: null } }],
      rotation_policy_rules: [{ rotation_policy_id: 'rp1', condition_type: 'weekday_working', shift_id: SHIFTS.rot.id, effective_from: '2000-01-01', effective_to: null, shifts: SHIFTS.rot }],
      shifts: [SHIFTS.rot],
    }
    const { single, batch } = await bothResolve(tables, 'e2')
    expect(single?.resolution_source).toBe('rotation_policy')
    expect(single?.rotation_policy_id).toBe('rp1')
    expect(batch).toEqual(single)
  })

  it('priority 3: employee_shifts resolves TEMPORALLY (effective window), identically', async () => {
    const tables = {
      shift_roster: [],
      employees: [{ id: 'e3', tenant_id: TENANT, site_id: null, rotation_policy_id: null, sites: null }],
      rotation_policy_rules: [],
      employee_shifts: [
        // Old assignment, already closed before DATE — must be IGNORED.
        { tenant_id: TENANT, employee_id: 'e3', shift_id: SHIFTS.night.id, effective_from: '2026-01-01', effective_to: '2026-02-28', shifts: SHIFTS.night },
        // Current assignment effective as of DATE — must WIN.
        { tenant_id: TENANT, employee_id: 'e3', shift_id: SHIFTS.morning.id, effective_from: '2026-03-01', effective_to: null, shifts: SHIFTS.morning },
      ],
      shifts: [SHIFTS.morning, SHIFTS.night],
    }
    const { single, batch } = await bothResolve(tables, 'e3')
    expect(single?.shift_id).toBe(SHIFTS.morning.id)   // not the closed night shift
    expect(single?.resolution_source).toBe('standing_shift')
    expect(batch).toEqual(single)
  })

  it('priority 3 (historical date): a past recompute picks the shift in effect THEN', async () => {
    const histTables = {
      shift_roster: [],
      employees: [{ id: 'e3', tenant_id: TENANT, site_id: null, rotation_policy_id: null, sites: null }],
      rotation_policy_rules: [],
      employee_shifts: [
        { tenant_id: TENANT, employee_id: 'e3', shift_id: SHIFTS.night.id, effective_from: '2026-01-01', effective_to: '2026-02-28', shifts: SHIFTS.night },
        { tenant_id: TENANT, employee_id: 'e3', shift_id: SHIFTS.morning.id, effective_from: '2026-03-01', effective_to: null, shifts: SHIFTS.morning },
      ],
      shifts: [SHIFTS.morning, SHIFTS.night],
    }
    const sb = makeSupabase(histTables)
    // Resolve for a date inside the OLD window → must return the night shift.
    const past = await resolveShiftWithAttribution(sb, TENANT, 'e3', '2026-02-15')
    expect(past?.shift_id).toBe(SHIFTS.night.id)
  })

  it('priority 2 (temporal, AHI-3): a rotation rule edit does not change a past date', async () => {
    // Two versions of the weekday rule: the old one (night) was effective
    // through Feb; the new one (rot) is effective from March.
    const tables = {
      shift_roster: [],
      employees: [{ id: 'e6', tenant_id: TENANT, site_id: 'site1', rotation_policy_id: 'rp9',
        sites: { default_rotation_policy_id: null, default_shift_id: null, shifts: null } }],
      rotation_policy_rules: [
        { rotation_policy_id: 'rp9', condition_type: 'weekday_working', shift_id: SHIFTS.night.id, effective_from: '2026-01-01', effective_to: '2026-02-28', shifts: SHIFTS.night },
        { rotation_policy_id: 'rp9', condition_type: 'weekday_working', shift_id: SHIFTS.rot.id,   effective_from: '2026-03-01', effective_to: null,         shifts: SHIFTS.rot },
      ],
      shifts: [SHIFTS.night, SHIFTS.rot],
    }
    // DATE is 2026-03-10 → resolves the current (rot) version.
    const { single, batch } = await bothResolve(tables, 'e6')
    expect(single?.shift_id).toBe(SHIFTS.rot.id)
    expect(batch).toEqual(single)

    // A February weekday (2026-02-17 is a Tuesday) must still resolve the
    // version effective THEN (night), not the current one.
    const past = await resolveShiftWithAttribution(makeSupabase(tables), TENANT, 'e6', '2026-02-17')
    expect(past?.shift_id).toBe(SHIFTS.night.id)
  })

  it('priority 4: site_default resolves identically (parity bug regression)', async () => {
    const tables = {
      shift_roster: [],
      employees: [{ id: 'e4', tenant_id: TENANT, site_id: 'site1', rotation_policy_id: null,
        sites: { default_rotation_policy_id: null, default_shift_id: SHIFTS.site.id, shifts: SHIFTS.site } }],
      rotation_policy_rules: [],
      employee_shifts: [],
      sites: [{ id: 'site1', tenant_id: TENANT, default_shift_id: SHIFTS.site.id }],
      shifts: [SHIFTS.site],
    }
    const { single, batch } = await bothResolve(tables, 'e4')
    expect(single?.shift_id).toBe(SHIFTS.site.id)
    expect(single?.resolution_source).toBe('site_default')
    expect(batch).toEqual(single)
  })

  it('no shift resolvable → both return null', async () => {
    const tables = {
      shift_roster: [],
      employees: [{ id: 'e5', tenant_id: TENANT, site_id: null, rotation_policy_id: null, sites: null }],
      rotation_policy_rules: [],
      employee_shifts: [],
      shifts: [],
    }
    const { single, batch } = await bothResolve(tables, 'e5')
    expect(single).toBeNull()
    expect(batch).toBeNull()
  })
})
