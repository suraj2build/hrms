/**
 * postgrest-mock.ts
 *
 * A PostgREST-query-builder mock shared by the pagination regression tests
 * in src/routes/payroll/statutory/__tests__/. Supports both pagination
 * styles used across this codebase on the SAME mock table:
 *   - offset: .range(from, to) — terminal, resolves directly.
 *   - keyset: .gt('id', afterId).order('id').limit(n) in any call order —
 *     deferred to resolution time, so it doesn't matter whether production
 *     code calls .limit() before or after .gt() (real supabase-js doesn't
 *     care either — it accumulates query state regardless of call order;
 *     an earlier, simpler version of this mock applied filters eagerly at
 *     each call and broke the moment production code called .limit() before
 *     .gt() in the same chain).
 *
 * `pageCap` simulates a low real-world max-rows ceiling, applied to BOTH
 * styles' terminal resolution. `inLimit` makes `.in()` throw once a single
 * call carries more ids than a real request line could hold, simulating a
 * request-size failure an unchunked `.in()` would risk in production.
 */

export interface MockTableOptions {
  pageCap?: number
  inLimit?: number
}

function resolvePath(row: any, col: string): any {
  return col.split('.').reduce((o, k) => o?.[k], row)
}

export function makeMockTable(rows: any[], opts: MockTableOptions = {}) {
  const pageCap = opts.pageCap ?? Infinity
  const inLimit = opts.inLimit ?? Infinity

  type State = { filtered: any[]; limitN: number | null }

  function build(state: State) {
    const api: any = {
      select() { return api },
      eq(col: string, val: any) {
        return build({ ...state, filtered: state.filtered.filter(r => resolvePath(r, col) === val) })
      },
      in(col: string, vals: any[]) {
        if (vals.length > inLimit) {
          throw new Error(`simulated request-line overflow: .in('${col}', [${vals.length} ids])`)
        }
        const set = new Set(vals)
        return build({ ...state, filtered: state.filtered.filter(r => set.has(resolvePath(r, col))) })
      },
      gt(col: string, val: any) {
        return build({ ...state, filtered: state.filtered.filter(r => resolvePath(r, col) > val) })
      },
      gte(col: string, val: any) {
        return build({ ...state, filtered: state.filtered.filter(r => resolvePath(r, col) >= val) })
      },
      lte(col: string, val: any) {
        return build({ ...state, filtered: state.filtered.filter(r => resolvePath(r, col) <= val) })
      },
      not(col: string, op: string, val: any) {
        if (op === 'is' && val === null) return build({ ...state, filtered: state.filtered.filter(r => resolvePath(r, col) != null) })
        return build(state)
      },
      is(col: string, val: any) {
        if (val === null) return build({ ...state, filtered: state.filtered.filter(r => resolvePath(r, col) == null) })
        return build(state)
      },
      or() { return build(state) },
      order(col: string, o: { ascending?: boolean } = {}) {
        const asc = o.ascending !== false
        const sorted = [...state.filtered].sort((a, b) => {
          const av = resolvePath(a, col), bv = resolvePath(b, col)
          if (av === bv) return 0
          return (av < bv ? -1 : 1) * (asc ? 1 : -1)
        })
        return build({ ...state, filtered: sorted })
      },
      limit(n: number) { return build({ ...state, limitN: n }) },
      maybeSingle() { return Promise.resolve({ data: state.filtered[0] ?? null, error: null }) },
      single() { return Promise.resolve({ data: state.filtered[0] ?? null, error: null }) },
      delete() {
        return {
          eq: () => ({
            eq: () => ({
              in: () => Promise.resolve({ error: null }),
              not: () => Promise.resolve({ error: null }),
            }),
          }),
        }
      },
      upsert(rowsToUpsert: any[]) { upsertSpyTarget?.(rowsToUpsert); return Promise.resolve({ error: null }) },
      // Offset-style terminal method.
      range(from: number, to: number) {
        const size = Math.min(to - from + 1, pageCap)
        return Promise.resolve({ data: state.filtered.slice(from, from + size), error: null })
      },
      // Keyset-style (and any other) terminal resolution: apply .limit(),
      // capped by the simulated pageCap, at await-time — not at .limit()
      // call-time — so it's correct regardless of whether .gt() was
      // chained before or after .limit() in the production code.
      then(resolve: any, reject: any) {
        const cap = Math.min(state.limitN ?? Infinity, pageCap)
        const data = state.filtered.slice(0, cap)
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return build({ filtered: rows, limitN: null })
}

let upsertSpyTarget: ((rows: any[]) => void) | undefined
export function setMockUpsertSpy(fn: (rows: any[]) => void) {
  upsertSpyTarget = fn
}
