import Anthropic from '@anthropic-ai/sdk'

export interface ExtractedField {
  field_name: string
  value: string | null
  confidence_score: number        // 0.0 - 1.0
  reasoning: string
  source_document_type: string
}

export interface ExtractionResult {
  fields: ExtractedField[]
  document_summary: string
  overall_confidence: number      // 0.0 - 1.0
  extraction_version: string
  error?: string
}

// Field lists per document type
const DOCUMENT_FIELDS: Record<string, string[]> = {
  aadhaar: [
    'full_name', 'dob', 'gender', 'address_line1', 'address_city',
    'address_state', 'address_pincode', 'phone',
  ],
  pan: [
    'full_name', 'pan_number', 'dob', 'father_name',
  ],
  passport: [
    'full_name', 'passport_number', 'dob', 'gender', 'nationality',
    'address_line1', 'expiry_date',
  ],
  driving_license: [
    'full_name', 'dob', 'address_line1', 'address_city', 'address_state',
  ],
  resume: [
    'first_name', 'last_name', 'email', 'phone', 'address_city',
    'previous_employer', 'previous_designation', 'total_experience_years',
    'skills_summary', 'highest_education',
  ],
  offer_letter: [
    'full_name', 'email', 'joining_date', 'employment_type', 'ctc_annual',
    'designation', 'department',
  ],
  experience_letter: [
    'full_name', 'previous_employer', 'previous_designation',
    'from_date', 'to_date', 'reason_for_leaving',
  ],
  relieving_letter: [
    'full_name', 'previous_employer', 'previous_designation',
    'from_date', 'to_date', 'reason_for_leaving',
  ],
  salary_slip: [
    'full_name', 'employee_code', 'month_year', 'gross_salary', 'net_salary',
    'basic_salary', 'hra', 'pf_deduction', 'esi_deduction', 'pan_number',
    'uan_number', 'bank_account_last4',
  ],
  compensation_letter: [
    'full_name', 'ctc_annual', 'ctc_monthly', 'effective_date',
  ],
  bank_proof: [
    'account_holder_name', 'bank_name', 'account_number', 'ifsc_code',
    'branch_name', 'account_type',
  ],
  pf_uan_document: [
    'full_name', 'uan_number', 'pf_number', 'dob',
  ],
  esi_document: [
    'full_name', 'esi_number', 'employer_name',
  ],
  other: [
    'full_name', 'email', 'phone', 'date', 'reference_number',
  ],
}

const EXTRACTION_VERSION = '1.0.0'

const SYSTEM_PROMPT = `You are an enterprise HR document analysis assistant for an Indian HR management system.
Extract structured employee data from the provided document text.
Return ONLY valid JSON. Be precise with Indian formats:
- Dates: YYYY-MM-DD
- PAN: 10 chars AAAAA9999A format
- UAN: 12 digits
- IFSC: 11 chars starting with bank code
- Phone: 10 digits
- Pincode: 6 digits`

export async function extractFromDocument(
  documentType: string,
  documentText: string,
  mimeType: string,
  imageBase64?: string,
): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const normalizedType = documentType.toLowerCase().replace(/[\s-]/g, '_')
  const fields = DOCUMENT_FIELDS[normalizedType] ?? DOCUMENT_FIELDS['other']
  const fieldListJson = JSON.stringify(fields, null, 2)

  const userPrompt = `Document Type: ${documentType}

Document Text:
${documentText}

Extract the following fields and return JSON:
${fieldListJson}

Return this exact JSON structure:
{
  "fields": [
    {
      "field_name": "pan_number",
      "value": "ABCDE1234F",
      "confidence_score": 0.98,
      "reasoning": "PAN number clearly visible in top-right of document"
    }
  ],
  "document_summary": "PAN card for Rahul Kumar Sharma",
  "overall_confidence": 0.95
}

If a field is not found, include it with value: null and confidence_score: 0.`

  try {
    // Build message content — support vision for image types
    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } }

    const contentBlocks: ContentBlock[] = []

    if (
      imageBase64 &&
      (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp')
    ) {
      const validMime =
        mimeType === 'image/jpeg' ? 'image/jpeg'
        : mimeType === 'image/png' ? 'image/png'
        : 'image/webp'
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: validMime as 'image/jpeg' | 'image/png' | 'image/webp',
          data: imageBase64,
        },
      })
    }

    contentBlocks.push({ type: 'text', text: userPrompt })

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: contentBlocks,
        },
      ],
    })

    // Extract raw text from response
    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('')

    // Strip markdown code fences if present
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()

    // Parse JSON
    const parsed = JSON.parse(jsonText) as {
      fields: Array<{
        field_name: string
        value: string | null
        confidence_score: number
        reasoning: string
      }>
      document_summary: string
      overall_confidence: number
    }

    if (!Array.isArray(parsed.fields)) {
      throw new Error('Parsed response missing fields array')
    }

    const enrichedFields: ExtractedField[] = parsed.fields.map((f) => ({
      field_name: f.field_name,
      value: f.value ?? null,
      confidence_score: typeof f.confidence_score === 'number' ? f.confidence_score : 0,
      reasoning: f.reasoning ?? '',
      source_document_type: documentType,
    }))

    // Ensure all expected fields are present (fill missing ones)
    const presentNames = new Set(enrichedFields.map((f) => f.field_name))
    for (const fieldName of fields) {
      if (!presentNames.has(fieldName)) {
        enrichedFields.push({
          field_name: fieldName,
          value: null,
          confidence_score: 0,
          reasoning: 'Field not found in document',
          source_document_type: documentType,
        })
      }
    }

    return {
      fields: enrichedFields,
      document_summary: parsed.document_summary ?? '',
      overall_confidence: typeof parsed.overall_confidence === 'number' ? parsed.overall_confidence : 0,
      extraction_version: EXTRACTION_VERSION,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      fields: [],
      document_summary: '',
      overall_confidence: 0,
      extraction_version: EXTRACTION_VERSION,
      error: message,
    }
  }
}
