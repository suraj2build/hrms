/**
 * Cross-document identity verification for onboarding.
 *
 * Aadhaar is the IDENTITY ANCHOR (mandatory base proof). Every other document
 * that carries a name / DOB is checked against it so that a mismatched or
 * wrong-person document (e.g. someone else's PAN or bank proof) is caught
 * before an employee record is created.
 *
 * Returns human-readable errors (hard — block approval) and warnings (soft —
 * HR should verify). Indian-name aware: tolerant of honorifics, token order,
 * initials and minor OCR/spelling variants (e.g. SWETA vs SHWETA).
 */

export interface DocFieldRow {
  field_name: string
  extracted_value: string | null
  source_document_type: string | null
}

export interface IdentityCheckResult {
  errors: string[]
  warnings: string[]
}

const ANCHOR_ORDER = ['aadhaar', 'pan', 'passport', 'driving_license']

// Document types that carry the candidate's own name and should be verified.
const NAME_DOC_TYPES = new Set([
  'aadhaar', 'pan', 'passport', 'driving_license', 'resume', 'offer_letter',
  'bank_proof', 'salary_slip', 'pf_uan_document', 'esi_document', 'compensation_letter',
])

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'SHRI', 'SMT', 'KUMARI', 'KUM', 'DR', 'M/S'])

function normalizeDocType(dt: string | null): string {
  return (dt ?? '').toLowerCase().replace(/[\s-]/g, '_')
}

function prettyDocType(dt: string): string {
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function nameTokens(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t))
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

/** Do two name tokens refer to the same name part? (exact / initial / fuzzy) */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  // Initial vs full word: "S" matches "SWETA"
  if (a.length === 1 || b.length === 1) return a[0] === b[0]
  // Minor OCR / spelling variation (SWETA vs SHWETA): tolerate a small edit distance
  const tolerance = Math.max(1, Math.floor(Math.min(a.length, b.length) / 4))
  return levenshtein(a, b) <= tolerance
}

type MatchVerdict = 'match' | 'partial' | 'mismatch'

function compareNames(anchor: string, candidate: string): MatchVerdict {
  const a = nameTokens(anchor)
  const c = nameTokens(candidate)
  if (a.length === 0 || c.length === 0) return 'partial' // not enough to judge

  // Count how many of the smaller name's tokens align with the other name.
  const [small, large] = a.length <= c.length ? [a, c] : [c, a]
  const usedLarge = new Set<number>()
  let aligned = 0
  for (const tok of small) {
    const idx = large.findIndex((lt, i) => !usedLarge.has(i) && tokensMatch(tok, lt))
    if (idx >= 0) { usedLarge.add(idx); aligned++ }
  }

  if (aligned === 0) return 'mismatch'
  if (aligned === small.length) return 'match'      // every token of the shorter name is present
  // At least one shared token but not full coverage
  return aligned / small.length >= 0.5 ? 'partial' : 'mismatch'
}

function normalizeDob(v: string): string {
  // Accept YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY → YYYY-MM-DD
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return s
}

export function crossCheckIdentity(rows: DocFieldRow[]): IdentityCheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Group name + dob per document type.
  const byDoc: Record<string, { name?: string; firstName?: string; lastName?: string; holder?: string; dob?: string }> = {}
  for (const r of rows) {
    const dt = normalizeDocType(r.source_document_type)
    if (!dt || !NAME_DOC_TYPES.has(dt)) continue
    const val = (r.extracted_value ?? '').trim()
    if (!val) continue
    byDoc[dt] ??= {}
    if (r.field_name === 'full_name') byDoc[dt].name = val
    else if (r.field_name === 'first_name') byDoc[dt].firstName = val
    else if (r.field_name === 'last_name') byDoc[dt].lastName = val
    else if (r.field_name === 'account_holder_name') byDoc[dt].holder = val
    else if (r.field_name === 'dob') byDoc[dt].dob = val
  }

  const docName = (dt: string): string | undefined => {
    const d = byDoc[dt]
    if (!d) return undefined
    return d.name
      ?? d.holder
      ?? ([d.firstName, d.lastName].filter(Boolean).join(' ').trim() || undefined)
  }

  // Pick the identity anchor (prefer Aadhaar).
  const anchorType = ANCHOR_ORDER.find((dt) => docName(dt))
  if (!anchorType) {
    warnings.push('No government ID (Aadhaar/PAN) with a readable name was found — identity could not be cross-verified. Aadhaar is the required base proof.')
    return { errors, warnings }
  }

  const anchorName = docName(anchorType)!
  const anchorDob = byDoc[anchorType]?.dob
  const anchorLabel = prettyDocType(anchorType)

  for (const dt of Object.keys(byDoc)) {
    if (dt === anchorType) continue
    const candidateName = docName(dt)
    const label = prettyDocType(dt)

    // ── Name check ──
    if (candidateName) {
      const verdict = compareNames(anchorName, candidateName)
      if (verdict === 'mismatch') {
        errors.push(
          `Name mismatch: "${candidateName}" on ${label} does not match the ${anchorLabel} name "${anchorName}". Verify this document belongs to the candidate or re-upload a correct one.`,
        )
      } else if (verdict === 'partial') {
        warnings.push(
          `Name on ${label} ("${candidateName}") only partially matches the ${anchorLabel} name ("${anchorName}"). Please confirm it is the same person.`,
        )
      }
    }

    // ── DOB check ──
    const candidateDob = byDoc[dt]?.dob
    if (anchorDob && candidateDob && normalizeDob(anchorDob) !== normalizeDob(candidateDob)) {
      errors.push(
        `Date of birth mismatch: ${label} shows ${candidateDob} but ${anchorLabel} shows ${anchorDob}. Verify the document belongs to the candidate.`,
      )
    }
  }

  return { errors, warnings }
}
