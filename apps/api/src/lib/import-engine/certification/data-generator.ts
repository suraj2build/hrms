// ── Certification: Synthetic ValidatedRow factory ────────────────────────────

import type { ValidatedRow } from '../validator.js'

/** Generate N fully-valid rows suitable for any chunk-executor call. */
export function makeValidRows(count: number, startRow = 1): ValidatedRow[] {
  return Array.from({ length: count }, (_, i) => {
    const code = `EMP${String(startRow + i).padStart(6, '0')}`
    return {
      rowNumber:     startRow + i,
      originalData:  { employee_code: code, component_code: 'BASIC', amount: '50000' },
      normalizedData: { employee_code: code, component_code: 'BASIC', amount: 50000 },
      isValid:       true,
      errors:        [],
      warnings:      [],
    }
  })
}

/** Generate N invalid rows with a single error per row. */
export function makeInvalidRows(
  count:   number,
  message  = 'Employee not found',
  field    = 'employee_code',
  startRow = 1,
): ValidatedRow[] {
  return Array.from({ length: count }, (_, i) => ({
    rowNumber:      startRow + i,
    originalData:   { employee_code: `INVALID${i}` },
    normalizedData: { employee_code: `INVALID${i}` },
    isValid:        false,
    errors:         [{ field, message, severity: 'error' as const }],
    warnings:       [],
  }))
}
