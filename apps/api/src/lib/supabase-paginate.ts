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
 * until a page shorter than batchSize is returned.
 *
 * @param queryFn  A function that accepts (from, to) and returns the Supabase
 *                 query with .range(from, to) appended.  Keep all other filters,
 *                 selects, and orderings inside queryFn — only the range varies.
 * @param batchSize  Rows per request.  Must not exceed the PostgREST max-rows
 *                   setting (default 1,000).  Defaults to 1,000.
 */
export async function fetchAllRows<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  batchSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn(from, from + batchSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < batchSize) break
    from += batchSize
  }
  return rows
}
