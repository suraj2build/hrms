import { describe, it, expect } from 'vitest'
import { sanitizeOrFilterTerm } from '../postgrest-filter.js'

describe('sanitizeOrFilterTerm (ISSUE-152)', () => {
  it('strips commas — cannot inject an additional OR condition', () => {
    expect(sanitizeOrFilterTerm('Smith,status.eq.terminated')).toBe('Smithstatus.eq.terminated')
  })

  it('strips parentheses — cannot inject a nested and()/or() group', () => {
    expect(sanitizeOrFilterTerm('Smith(status.eq.active)')).toBe('Smithstatus.eq.active')
  })

  it('leaves an ordinary search term unchanged', () => {
    expect(sanitizeOrFilterTerm('Rahul Sharma')).toBe('Rahul Sharma')
  })

  it('leaves ilike wildcards (%, _) untouched — not part of the injection surface', () => {
    expect(sanitizeOrFilterTerm('50%_off')).toBe('50%_off')
  })

  it('a fully-crafted injection payload is neutralized to inert text', () => {
    const payload = 'x%,is_admin.eq.true,(role.eq.super_admin'
    expect(sanitizeOrFilterTerm(payload)).toBe('x%is_admin.eq.truerole.eq.super_admin')
  })
})
