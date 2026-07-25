/**
 * postgrest-filter.ts
 *
 * Escapes user-supplied search text before interpolating it into a PostgREST
 * `.or("a.ilike.X,b.ilike.X")` filter string built via template literal.
 *
 * PostgREST's filter mini-language uses `,` to separate OR conditions and `()`
 * to nest and/or groups. An unescaped comma or parenthesis in a search term
 * lets the caller append extra filter clauses on arbitrary column names —
 * tenant isolation itself stays intact (tenant_id is always a separate .eq()
 * chained outside the .or() group), but a crafted search string can still
 * widen the query to unintended columns/conditions or trigger a malformed-
 * filter 500. (ISSUE-152)
 */
export function sanitizeOrFilterTerm(term: string): string {
  return term.replace(/[,()]/g, '')
}
