import { describe, it, expect } from 'vitest'
import { isValidFeedbackScreenshotPath } from '../feedback-screenshot-path.js'

const TENANT = 'tenant-abc'

describe('isValidFeedbackScreenshotPath', () => {
  it('accepts the real upload flow\'s exact shape', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/1760400000000-x7k2qa.png`, TENANT)).toBe(true)
  })

  it('rejects a different tenant\'s folder', () => {
    expect(isValidFeedbackScreenshotPath('other-tenant/feedback/123.png', TENANT)).toBe(false)
  })

  it('rejects a tenant id that is merely a string-prefix of another (no slash boundary bypass)', () => {
    expect(isValidFeedbackScreenshotPath('tenant-abcXYZ/feedback/123.png', TENANT)).toBe(false)
  })

  it('rejects literal ".." traversal', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/../other-tenant/secret.png`, TENANT)).toBe(false)
  })

  it('rejects an empty filename (bare prefix, nothing after it)', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/`, TENANT)).toBe(false)
  })

  it('rejects a path with no filename segment at all', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback`, TENANT)).toBe(false)
  })

  it('rejects backslash-separated traversal, even disguised as a single segment', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/..\\..\\secret.png`, TENANT)).toBe(false)
  })

  it('rejects a bare backslash in the filename', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/evil\\name.png`, TENANT)).toBe(false)
  })

  it('rejects percent-encoded traversal sequences (never decoded, but must not be allow-listed either)', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/%2e%2e%2fsecret.png`, TENANT)).toBe(false)
  })

  it('rejects a double-encoded slash used to smuggle an extra path segment', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/..%2f..%2fsecret.png`, TENANT)).toBe(false)
  })

  it('rejects an extra nested path segment (an unrelated object elsewhere in the bucket, not a flat upload)', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/sub/dir/secret.png`, TENANT)).toBe(false)
  })

  it('rejects a filename that is a lone dot', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/.`, TENANT)).toBe(false)
  })

  it('rejects a leading-dot (hidden-file-style) filename', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/.htaccess`, TENANT)).toBe(false)
  })

  it('rejects a trailing-dot filename', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/payslip.`, TENANT)).toBe(false)
  })

  it('rejects an unrelated storage object that merely starts with the right prefix text but is a different bucket path shape', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback-exports/payroll.csv`, TENANT)).toBe(false)
  })

  it('accepts a single-character filename', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/a`, TENANT)).toBe(true)
  })

  it('accepts filenames with underscores and hyphens (the real generator\'s charset)', () => {
    expect(isValidFeedbackScreenshotPath(`${TENANT}/feedback/a_b-c.jpeg`, TENANT)).toBe(true)
  })
})
