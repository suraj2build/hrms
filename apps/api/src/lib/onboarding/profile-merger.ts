import type { ExtractedField } from './extraction-engine.js'

export interface MergeInput {
  sessionId: string
  tenantId: string
  extractedFields: Array<{
    documentId: string
    documentType: string
    fields: ExtractedField[]
  }>
}

export interface MergedProfile {
  fields: Record<string, {
    value: string | null
    confidence_score: number
    source_document_type: string
    document_id: string
    is_conflicting: boolean
    conflict_note?: string
    all_values: Array<{ value: string; source: string; confidence: number }>
  }>
  overall_confidence: number
  missing_critical_fields: string[]
  conflict_fields: string[]
}

const CRITICAL_FIELDS = ['first_name', 'last_name', 'email', 'pan_number', 'joining_date']

/**
 * Field → authoritative document-type priority.
 *
 * For each field we trust the document that legally/structurally OWNS that
 * datum, NOT whichever OCR happened to report the highest confidence. Confidence
 * is only used as a tie-breaker WITHIN the same authority tier (or when none of
 * the source documents appear in the priority list).
 *
 * Document-type keys are normalised (lowercase, spaces/hyphens → underscore) to
 * match `extraction-engine.ts` DOCUMENT_FIELDS keys.
 */
const FIELD_SOURCE_PRIORITY: Record<string, string[]> = {
  // ── Legal identity — government IDs are authoritative ──
  full_name:           ['aadhaar', 'pan', 'passport', 'driving_license', 'offer_letter', 'resume'],
  first_name:          ['aadhaar', 'pan', 'passport', 'resume'],
  last_name:           ['aadhaar', 'pan', 'passport', 'resume'],
  father_name:         ['pan', 'aadhaar'],
  dob:                 ['aadhaar', 'pan', 'passport', 'driving_license', 'pf_uan_document'],
  gender:              ['aadhaar', 'passport'],
  nationality:         ['passport', 'aadhaar'],

  // ── Contact — the candidate's current details live on the resume ──
  email:               ['resume', 'offer_letter', 'other'],
  phone:               ['resume', 'offer_letter', 'aadhaar', 'other'],

  // ── Address — Aadhaar is the authoritative proof of address ──
  address_line1:       ['aadhaar', 'passport', 'driving_license'],
  address_city:        ['aadhaar', 'driving_license', 'resume'],
  address_state:       ['aadhaar', 'driving_license'],
  address_pincode:     ['aadhaar'],

  // ── Statutory identifiers ──
  pan_number:          ['pan', 'salary_slip'],
  passport_number:     ['passport'],
  uan_number:          ['pf_uan_document', 'salary_slip'],
  pf_number:           ['pf_uan_document', 'salary_slip'],
  esi_number:          ['esi_document', 'salary_slip'],

  // ── Bank / payroll — cancelled cheque / bank proof is authoritative ──
  account_holder_name: ['bank_proof'],
  bank_name:           ['bank_proof', 'salary_slip'],
  account_number:      ['bank_proof'],
  ifsc_code:           ['bank_proof'],
  branch_name:         ['bank_proof'],
  account_type:        ['bank_proof'],

  // ── Employment — offer / compensation letters ──
  joining_date:        ['offer_letter'],
  employment_type:     ['offer_letter'],
  designation:         ['offer_letter', 'experience_letter'],
  department:          ['offer_letter'],
  ctc_annual:          ['offer_letter', 'compensation_letter'],
  ctc_monthly:         ['compensation_letter', 'offer_letter'],
}

function normalizeDocType(dt: string): string {
  return (dt ?? '').toLowerCase().replace(/[\s-]/g, '_')
}

export function mergeExtractions(input: MergeInput): MergedProfile {
  // Collect all field occurrences across documents
  const fieldMap: Record<
    string,
    Array<{
      value: string | null
      confidence_score: number
      source_document_type: string
      document_id: string
    }>
  > = {}

  for (const doc of input.extractedFields) {
    for (const field of doc.fields) {
      if (!fieldMap[field.field_name]) {
        fieldMap[field.field_name] = []
      }
      fieldMap[field.field_name].push({
        value: field.value,
        confidence_score: field.confidence_score,
        source_document_type: doc.documentType,
        document_id: doc.documentId,
      })
    }
  }

  const mergedFields: MergedProfile['fields'] = {}
  const conflictFields: string[] = []
  let totalConfidenceSum = 0
  let totalFieldCount = 0

  for (const [fieldName, occurrences] of Object.entries(fieldMap)) {
    // Filter to non-null occurrences for comparison
    const nonNullOccurrences = occurrences.filter(
      (o) => o.value !== null && o.value !== '',
    )

    // Pick the primary value by DOCUMENT AUTHORITY for this field, falling back
    // to confidence only as a tie-breaker. This prevents a high-confidence but
    // wrong OCR value (e.g. a misread name on an ID) from overriding the value
    // from the document that actually owns the field.
    const priority = FIELD_SOURCE_PRIORITY[fieldName]
    const rankOf = (docType: string): number => {
      if (!priority) return Number.MAX_SAFE_INTEGER
      const idx = priority.indexOf(normalizeDocType(docType))
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
    }

    // Prefer real values over nulls; among real values use authority then
    // confidence; if every occurrence is null, keep the first (null) entry.
    const candidates = nonNullOccurrences.length > 0 ? nonNullOccurrences : occurrences
    const sorted = [...candidates].sort((a, b) => {
      const ra = rankOf(a.source_document_type)
      const rb = rankOf(b.source_document_type)
      if (ra !== rb) return ra - rb
      return b.confidence_score - a.confidence_score
    })
    const primary = sorted[0]

    // Detect conflicts — two non-null values from different sources that differ
    const uniqueValues = new Set(nonNullOccurrences.map((o) => o.value))
    const isConflicting = uniqueValues.size > 1

    let conflictNote: string | undefined
    if (isConflicting) {
      const valuesSummary = nonNullOccurrences
        .map((o) => `"${o.value}" (from ${o.source_document_type})`)
        .join(', ')
      conflictNote = `Multiple values found: ${valuesSummary}`
      conflictFields.push(fieldName)
    }

    const allValues = nonNullOccurrences.map((o) => ({
      value: o.value as string,
      source: o.source_document_type,
      confidence: o.confidence_score,
    }))

    mergedFields[fieldName] = {
      value: primary.value,
      confidence_score: primary.confidence_score,
      source_document_type: primary.source_document_type,
      document_id: primary.document_id,
      is_conflicting: isConflicting,
      ...(conflictNote ? { conflict_note: conflictNote } : {}),
      all_values: allValues,
    }

    totalConfidenceSum += primary.confidence_score
    totalFieldCount += 1
  }

  // Overall confidence = average of all primary field confidences
  const overallConfidence =
    totalFieldCount > 0 ? totalConfidenceSum / totalFieldCount : 0

  // Identify missing critical fields
  const missingCriticalFields = CRITICAL_FIELDS.filter((f) => {
    const entry = mergedFields[f]
    return !entry || entry.value === null || entry.value === ''
  })

  return {
    fields: mergedFields,
    overall_confidence: Math.round(overallConfidence * 1000) / 1000,
    missing_critical_fields: missingCriticalFields,
    conflict_fields: conflictFields,
  }
}
