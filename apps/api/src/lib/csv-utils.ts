/**
 * Shared CSV-export helpers.
 *
 * escapeCsvField neutralizes formula injection: a cell whose content starts
 * with =, +, -, or @ is interpreted as a formula by Excel/LibreOffice/Sheets
 * the moment the file is opened — dangerous when the value originates from
 * user-controlled data (employee name, narration, held_reason, etc.) that
 * reaches an export CSV. Prefixing a single quote forces text interpretation
 * without altering the visible value in any spreadsheet application.
 */

const FORMULA_TRIGGER = /^[=+\-@]/

export function escapeCsvField(value: unknown): string {
  const s = value == null ? '' : String(value)
  const safe = FORMULA_TRIGGER.test(s) ? `'${s}` : s
  return safe.includes(',') || safe.includes('"') || safe.includes('\n')
    ? `"${safe.replace(/"/g, '""')}"`
    : safe
}

export function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const header = headers.map(escapeCsvField).join(',')
  const body   = rows.map(r => headers.map(h => escapeCsvField(r[h])).join(',')).join('\n')
  return `${header}\n${body}`
}
