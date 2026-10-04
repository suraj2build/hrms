/**
 * supabase-paginate.ts
 *
 * PostgREST enforces a server-side max-rows ceiling (default 1,000 on Supabase).
 * Any .limit(N) where N > max-rows is silently capped — the response contains
 * exactly max-rows rows with no error and no truncation signal.
 *
 * Use fetchAllRows() whenever you need the complete result set from a
 * tenant-scoped table that can grow beyond 1,000 rows (employees, attendance,
 * payroll records, etc.).  It pages through the table using Range headers,
 * which are honoured even when max-rows would truncate a single request.
 *
 * Usage:
 *
 *   import { fetchAllRows } from '../../lib/supabase-paginate.js'
 *
 *   const employees = await fetchAllRows((from, to) =>
 *     fastify.supabase
 *       .from('employees')
 *       .select('id, first_name, last_name')
 *       .eq('tenant_id', req.tenantId)
 *       .eq('status', 'active')
 *       .range(from, to),
 *   )
 */

/**
 * Fetches every row matching a query by issuing successive .range() requests
 * until an empty page is returned.
 *
 * The loop advances by the number of rows ACTUALLY returned (not the requested
 * batchSize) so it works correctly even when PostgREST's max-rows setting is
 * lower than batchSize.  Previously the loop stopped when data.length < batchSize,
 * which silently truncated results whenever max-rows < batchSize (e.g. max-rows
 * set to 1 in the Supabase API Settings dashboard would return only 1 row and
 * stop immediately, regardless of how many rows actually exist).
 *
 * Stopping condition: an empty page (0 rows).  This costs one extra round-trip
 * at the end but is correct at any max-rows value.
 *
 * @param queryFn  A function that accepts (from, to) and returns the Supabase
 *                 query with .range(from, to) appended.  Keep all other filters,
 *                 selects, and orderings inside queryFn — only the range varies.
 * @param batchSize  Rows per request.  Should be <= the PostgREST max-rows
 *                   setting (Supabase cloud default: 1,000) for efficient
 *                   batching.  If max-rows < batchSize, the loop still returns
 *                   all rows — just in smaller batches.  Defaults to 500.
 */
export async function fetchAllRows<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  batchSize = 500,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn(from, from + batchSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    from += data.length  // advance by actual rows received, not assumed batchSize
  }
  return rows
}

/**
 * fetchAllRowsByKeyset() — like fetchAllRows(), but immune to row skips/
 * duplicates when the table is written to WHILE pagination is in flight.
 *
 * fetchAllRows() pages by OFFSET (.range(from, to)): each page's window is
 * defined by its POSITION in the full ordered result set. If a row is
 * inserted or deleted anywhere at or before the current offset between two
 * page requests — entirely possible across several sequential HTTP round
 * trips against a live table, e.g. another finalize running concurrently —
 * every row at or after that position shifts by one. An insert shifts
 * everything right, duplicating the row that straddled the old/new page
 * boundary; a delete shifts everything left, skipping the row that would
 * have landed at the now-vacant final position. Adding a deterministic
 * `.order('id')` (see this cluster's other fixes) prevents a DIFFERENT bug —
 * nondeterministic ordering between two otherwise-identical requests — but
 * does NOT prevent this one, since id is a random UUID: a newly inserted
 * row can sort anywhere in the key space, including into an already-read
 * page's range.
 *
 * fetchAllRowsByKeyset() instead pages by VALUE: "every row with id greater
 * than the last id I've already read." That query's result does not depend
 * on how many rows exist before or after the cursor, only on which rows
 * have id > cursor — so a row inserted or deleted anywhere outside that
 * exact range has no effect on correctness. A row inserted with id <=
 * the current cursor is invisible to this read, same as a row inserted
 * after a hypothetical single-snapshot transaction would be — the
 * acceptable, well-understood edge of keyset pagination, not the silent
 * skip/duplicate offset pagination risks on EVERY row, not just ones at the
 * exact moment of insertion.
 *
 * Use this instead of fetchAllRows() wherever the read feeds a persisted
 * financial total (statutory wage bases, reconciliation sums) and the
 * source table can plausibly be written to while the read is in flight —
 * not just read-only dashboards. Requires the table to have a unique,
 * orderable `id` column (true for every table in this schema).
 *
 * @param queryFn    A function that accepts (afterId, limit) and returns the
 *                   query with `.order('id', { ascending: true }).limit(limit)`
 *                   appended, plus `.gt('id', afterId)` when afterId is not
 *                   null. The select() must include `id`.
 * @param batchSize  Rows per request. Defaults to 500.
 */
export async function fetchAllRowsByKeyset<T extends { id: string }>(
  queryFn: (afterId: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  batchSize = 500,
): Promise<T[]> {
  const rows: T[] = []
  let afterId: string | null = null
  while (true) {
    const { data, error } = await queryFn(afterId, batchSize)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    afterId = data[data.length - 1].id
  }
  return rows
}
