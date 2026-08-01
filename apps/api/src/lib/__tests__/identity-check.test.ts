import { describe, it, expect } from 'vitest'
import { crossCheckIdentity, type DocFieldRow } from '../onboarding/identity-check.js'

function row(field_name: string, extracted_value: string, source_document_type: string): DocFieldRow {
  return { field_name, extracted_value, source_document_type }
}

describe('identity-check — cross-document name verification', () => {
  it('a degraded single-token OCR extraction warns (partial), not a silent match', () => {
    const rows: DocFieldRow[] = [
      row('full_name', 'SWETA SHARMA', 'aadhaar'),
      // Garbled bank-proof OCR only yielded one initial-like token.
      row('account_holder_name', 'S', 'bank_proof'),
    ]
    const result = crossCheckIdentity(rows)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some(w => w.includes('Bank Proof'))).toBe(true)
    expect(result.flaggedDocTypes).toHaveLength(0)
  })

  it('a full multi-token name match is still a clean match with no warning', () => {
    const rows: DocFieldRow[] = [
      row('full_name', 'SWETA SHARMA', 'aadhaar'),
      row('full_name', 'SWETA SHARMA', 'pan'),
    ]
    const result = crossCheckIdentity(rows)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('a genuinely wrong-person document still errors as a mismatch', () => {
    const rows: DocFieldRow[] = [
      row('full_name', 'SWETA SHARMA', 'aadhaar'),
      row('full_name', 'RAHUL VERMA', 'pan'),
    ]
    const result = crossCheckIdentity(rows)
    expect(result.errors.some(e => e.includes('Name mismatch'))).toBe(true)
    expect(result.flaggedDocTypes).toContain('pan')
  })

  it('minor OCR spelling variation across two tokens still matches cleanly', () => {
    const rows: DocFieldRow[] = [
      row('full_name', 'SWETA SHARMA', 'aadhaar'),
      // OCR misread H→missing letter, still within tolerance, two tokens present.
      row('full_name', 'SHWETA SHARMA', 'passport'),
    ]
    const result = crossCheckIdentity(rows)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('a single-token anchor name (nothing else to compare) is unaffected', () => {
    const rows: DocFieldRow[] = [
      row('full_name', 'SWETA', 'aadhaar'),
      row('full_name', 'SWETA', 'pan'),
    ]
    const result = crossCheckIdentity(rows)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })
})
