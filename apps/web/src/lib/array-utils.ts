// ── Runtime-safe array / number utilities ─────────────────────────────────
// Use these instead of bare `?? []` so components never crash on
// unexpected API shapes (object vs array, null, undefined, number, etc.)

/**
 * Always returns a real array.
 * - Already an array → returned as-is (with cast to T[])
 * - Anything else  → []
 *
 * @example
 *   const rows = ensureArray<Row>(apiData?.rows)
 *   rows.map(r => ...)   // safe even if apiData is undefined or rows is an object
 */
export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Converts any value to a finite number, falling back to `fallback` (default 0).
 * Guards against NaN, Infinity, null, undefined, strings.
 */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return isFinite(n) ? n : fallback
}

/**
 * Formats a numeric percentage string, guarding against non-numeric input.
 * @example safePercent(apiData?.rate, 1) → "72.3%"
 */
export function safePercent(value: unknown, decimals = 1): string {
  return `${safeNumber(value).toFixed(decimals)}%`
}

/**
 * Converts an object whose values share a shape into an array.
 * Returns [] if value is not a plain object.
 * Optionally injects the object key as a field on each item.
 *
 * @example
 *   objectToArray({ low: { count: 1 }, high: { count: 5 } }, 'level')
 *   // → [{ level: 'low', count: 1 }, { level: 'high', count: 5 }]
 */
export function objectToArray<T extends Record<string, unknown>>(
  value: unknown,
  keyField?: string,
): T[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).map(([k, v]) => {
    if (keyField && typeof v === 'object' && v !== null) {
      return { [keyField]: k, ...(v as Record<string, unknown>) } as T
    }
    return (typeof v === 'object' && v !== null ? v : { value: v }) as T
  })
}
