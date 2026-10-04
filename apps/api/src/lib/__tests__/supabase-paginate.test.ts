/**
 * supabase-paginate.test.ts
 *
 * Proves the concrete difference between fetchAllRows() (OFFSET-based
 * .range() paging) and fetchAllRowsByKeyset() (keyset/cursor paging) when
 * the underlying table is written to WHILE pagination is in flight — a
 * realistic scenario for any financial read that pages across several
 * sequential HTTP round trips against a live table (e.g. another payroll
 * finalize running concurrently).
 *
 * A deterministic `.order('id')` (added elsewhere in this cluster) fixes a
 * DIFFERENT bug — nondeterministic row order between two otherwise-identical
 * requests. It does NOT fix this one: `id` is a random UUID, so a newly
 * inserted or deleted row can land anywhere in the key space, including
 * inside a page that's already been read. These tests simulate exactly that.
 */

import { describe, it, expect } from 'vitest'
import { fetchAllRows, fetchAllRowsByKeyset } from '../supabase-paginate.js'

function makeId(sortKey: number): string {
  // Zero-padded so plain string comparison == numeric sort order, standing
  // in for a real UUID's sort position without relying on actual randomness
  // for the test's determinism.
  return `id-${String(sortKey).padStart(6, '0')}`
}

/** A live, mutable table simulator. `rangeRead` and `keysetRead` both read
 *  from `this.rows` AT CALL TIME, not a frozen snapshot — modeling a real
 *  table that can change between two sequential HTTP requests. */
class LiveTable<T extends { id: string }> {
  rows: T[]
  constructor(rows: T[]) {
    this.rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))
  }
  rangeRead(from: number, to: number): T[] {
    return this.rows.slice(from, to + 1)
  }
  keysetRead(afterId: string | null, limit: number): T[] {
    const start = afterId === null ? 0 : this.rows.findIndex(r => r.id > afterId)
    if (start === -1) return []
    return this.rows.slice(start, start + limit)
  }
  insert(row: T) {
    this.rows.push(row)
    this.rows.sort((a, b) => (a.id < b.id ? -1 : 1))
  }
  deleteAt(index: number) {
    this.rows.splice(index, 1)
  }
}

describe('fetchAllRows() (OFFSET-based) is vulnerable to concurrent writes mid-pagination', () => {
  it('duplicates a row when a new row is inserted into an already-read page', async () => {
    const BATCH = 100
    const initial = Array.from({ length: 250 }, (_, i) => ({ id: makeId(i * 10), amount: i }))
    const table = new LiveTable(initial)

    let callCount = 0
    const rows = await fetchAllRows<{ id: string; amount: number }>((from, to) => {
      callCount++
      // After the FIRST page is read (rows 0..99), a concurrent finalize
      // inserts a new row that sorts INTO that already-read page (sort key
      // 5, well below the 100th row's key of 990). This is the realistic
      // case: nothing says a newly-finalized slip's random UUID sorts after
      // every already-finalized one.
      if (callCount === 2) {
        table.insert({ id: makeId(5), amount: 9999 })
      }
      return Promise.resolve({ data: table.rangeRead(from, to), error: null })
    }, BATCH)

    // The insert shifts every row after position 0 one slot to the right,
    // so whatever sat at the LAST position of page 1 (old offset 99, key
    // 990) reappears at the FIRST position of page 2 (new offset 100) — a
    // real duplicate. The row total (251) happens to still match the live
    // table's new size, which is exactly why count alone doesn't catch
    // this: the composition is wrong even though the count looks fine.
    const ids = rows.map(r => r.id)
    const dupes = ids.filter((id, idx) => ids.indexOf(id) !== idx)
    expect(table.rows.length).toBe(251)
    expect(dupes).toContain(makeId(990))
    // The newly inserted row itself sorted into the page that was already
    // read before it existed, and offset pagination never revisits a page —
    // so it is silently dropped, not just duplicated elsewhere.
    expect(ids).not.toContain(makeId(5))
  })

  it('skips a row when an already-read row is deleted mid-pagination', async () => {
    const BATCH = 100
    const initial = Array.from({ length: 250 }, (_, i) => ({ id: makeId(i * 10), amount: i }))
    const table = new LiveTable(initial)

    let callCount = 0
    const rows = await fetchAllRows<{ id: string; amount: number }>((from, to) => {
      callCount++
      // After the first page (rows 0..99) is read, row index 5 (already
      // read) is deleted — e.g. a superseded draft row cleaned up by
      // another request. Every row after it shifts one slot left, so
      // page 2 (offset 100..199) now starts one position early and misses
      // what would have been the row at the old final position.
      if (callCount === 2) {
        table.deleteAt(5)
      }
      return Promise.resolve({ data: table.rangeRead(from, to), error: null })
    }, BATCH)

    // The delete shifts every row after the deleted position one slot to
    // the left, so page 2's new starting offset (100) now lands one row
    // later than it should — the row that should have been there (key
    // 1000) is never read by any page. The returned count (249) again
    // happens to match the live table's new size, masking that the
    // COMPOSITION is wrong: it's missing a real row and still carries the
    // now-deleted one (read before the delete happened, which is the
    // correct, acceptable snapshot-at-read-time behavior for that one row).
    expect(table.rows.length).toBe(249)
    const ids = rows.map(r => r.id)
    expect(ids).toContain(makeId(50))       // read before deletion — correctly present
    expect(ids).not.toContain(makeId(1000)) // silently skipped by the shift — the actual bug
  })
})

describe('fetchAllRowsByKeyset() is immune to the same concurrent writes', () => {
  it('is unaffected by an insert into an already-read page', async () => {
    const BATCH = 100
    const initial = Array.from({ length: 250 }, (_, i) => ({ id: makeId(i * 10), amount: i }))
    const table = new LiveTable(initial)

    let callCount = 0
    const rows = await fetchAllRowsByKeyset<{ id: string; amount: number }>((afterId, limit) => {
      callCount++
      if (callCount === 2) {
        table.insert({ id: makeId(5), amount: 9999 })
      }
      return Promise.resolve({ data: table.keysetRead(afterId, limit), error: null })
    }, BATCH)

    expect(table.rows.length).toBe(251)
    const ids = rows.map(r => r.id)
    // No duplicates, ever — keyset pagination's defining property.
    expect(new Set(ids).size).toBe(ids.length)
    // The late insert (id-000005) sorts BEFORE the cursor's already-passed
    // range, so it is correctly not retroactively included — the
    // well-understood, documented edge of keyset pagination, not a silent
    // duplicate affecting a DIFFERENT, already-correct row.
    expect(rows.length).toBe(250)
    expect(ids).not.toContain(makeId(5))
  })

  it('is unaffected by a delete of an already-read row', async () => {
    const BATCH = 100
    const initial = Array.from({ length: 250 }, (_, i) => ({ id: makeId(i * 10), amount: i }))
    const table = new LiveTable(initial)

    let callCount = 0
    const rows = await fetchAllRowsByKeyset<{ id: string; amount: number }>((afterId, limit) => {
      callCount++
      if (callCount === 2) {
        table.deleteAt(5)
      }
      return Promise.resolve({ data: table.keysetRead(afterId, limit), error: null })
    }, BATCH)

    expect(table.rows.length).toBe(249)
    // The deleted row was already read and returned on page 1 — deleting it
    // from the live table afterwards cannot retroactively un-read it, and
    // (unlike offset pagination) does not shift anything else out of view.
    expect(rows.length).toBe(250)
  })
})
