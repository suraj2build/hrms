/**
 * attendance-utils.ts
 *
 * Shared utility functions for attendance data processing.
 *
 * normalizeAttendanceStatus — guards against case-sensitive status comparisons
 * by canonicalizing any status value to lowercase before it is compared or
 * displayed.  The attendance engine always writes lowercase statuses ('present',
 * 'absent', etc.) but external data sources (biometric device feeds, legacy
 * imports, manual overrides) may send mixed-case variants.
 *
 * This normalizer is the single choke-point: add it wherever status values
 * cross a trust boundary (API ingestion, aggregation, display mapping).
 */

import type { AttendanceStatus } from './attendance-engine.js'

/**
 * Canonical lowercase status values the engine recognises.
 * Anything else is returned as-is (lowercased) — unknown statuses are logged
 * by callers as needed.
 */
const KNOWN_STATUSES = new Set<string>([
  'present',
  'absent',
  'half_day',
  'late',
  'leave',
  'holiday',
  'weekly_off',
  // Extended statuses written by the biometric pipeline / regularisation
  'overtime',
  'missing_punch',
  'no_punch',
])

/**
 * Normalizes an attendance status value to its canonical lowercase form.
 *
 * - 'Present'   → 'present'
 * - 'LATE'      → 'late'
 * - 'Half_Day'  → 'half_day'
 * - null / ''   → null
 *
 * Returns null for null/undefined/empty input so callers can safely treat
 * "no normalised status" as "no data row".
 */
export function normalizeAttendanceStatus(
  status: string | null | undefined,
): string | null {
  if (!status) return null
  return status.toLowerCase()
}

/**
 * Type-safe variant: asserts the normalised value is an AttendanceStatus.
 * Use this when you need TypeScript to narrow the result to AttendanceStatus
 * (e.g., when writing to a typed record).
 *
 * Returns null for unknown/null input — let callers decide how to handle
 * unexpected status strings rather than silently coercing them.
 */
export function normalizeToAttendanceStatus(
  status: string | null | undefined,
): AttendanceStatus | null {
  if (!status) return null
  const lower = status.toLowerCase()
  if (KNOWN_STATUSES.has(lower)) return lower as AttendanceStatus
  return null
}
