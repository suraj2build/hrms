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
