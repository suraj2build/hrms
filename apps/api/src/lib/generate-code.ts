/**
 * generateUniqueCode
 *
 * Derives a short code from a display name and ensures it is unique within
 * the tenant's table before returning it.
 *
 * Algorithm:
 *   1. Take the first letter of each word in the name, uppercase, max 5 chars
 *      e.g. "Human Resources" → "HR", "Engineering" → "E", "Senior Dev Ops" → "SDO"
 *   2. Check if that code already exists in the table for this tenant
 *   3. If it does, append an incrementing number until a free slot is found
 *      e.g. "HR" → "HR1" → "HR2" …
 *
 * Usage:
 *   const code = await generateUniqueCode(fastify.supabase, 'departments', tenantId, name)
 */

export async function generateUniqueCode(
  // Supabase client — typed loosely to avoid importing the full type here
  supabase: any,
  table:    string,
  tenantId: string,
  name:     string,
): Promise<string> {
  const base = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w[0] ?? '').toUpperCase())
    .join('')
    .slice(0, 5) || 'X'

  // Fetch all codes that start with `base` in one query (avoids N+1)
  const { data, error } = await supabase
    .from(table)
    .select('code')
    .eq('tenant_id', tenantId)
    .ilike('code', `${base}%`)

  if (error) throw new Error(`generateUniqueCode: failed to check existing codes in ${table}: ${error.message}`)

  const taken = new Set<string>(
    (data ?? []).map((r: any) => (r.code ?? '').toUpperCase()),
  )

  if (!taken.has(base)) return base

  for (let i = 1; i <= 999; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }

  // Extremely unlikely fallback
  return `${base}${Date.now().toString(36).toUpperCase().slice(-4)}`
}
