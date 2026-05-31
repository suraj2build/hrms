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

    // Pick highest confidence as primary
    const sorted = [...occurrences].sort(
      (a, b) => b.confidence_score - a.confidence_score,
    )
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
