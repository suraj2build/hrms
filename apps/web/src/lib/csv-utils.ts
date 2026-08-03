/**
 * Shared CSV-export helpers for client-side "Download CSV" buttons.
 *
 * escapeCsvField neutralizes formula injection: a cell whose content starts
 * with =, +, -, or @ is interpreted as a formula by Excel/LibreOffice/Sheets
 * the moment the file is opened — dangerous when the value originates from
 * data another user or an uploaded file controls (employee name, error row
 * content, reconciliation notes). Prefixing a single quote forces text
 * interpretation without altering the visible value in any spreadsheet app.
 */

const FORMULA_TRIGGER = /^[=+\-@]/

export function escapeCsvField(value: unknown): string {
  const s = value == null ? '' : String(value)
  const safe = FORMULA_TRIGGER.test(s) ? `'${s}` : s
  return safe.includes(',') || safe.includes('"') || safe.includes('\n')
    ? `"${safe.replace(/"/g, '""')}"`
    : safe
}
