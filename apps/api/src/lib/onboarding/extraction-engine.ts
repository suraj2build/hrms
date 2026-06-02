import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'

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
  provider?: string               // which AI provider was used
  error?: string
}

// ── Field lists per document type ─────────────────────────────────────────────

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

const EXTRACTION_VERSION = '1.1.0'

const SYSTEM_PROMPT = `You are an enterprise HR document analysis assistant for an Indian HR management system.
Extract structured employee data from the provided document text.
Return ONLY valid JSON. Be precise with Indian formats:
- Dates: YYYY-MM-DD
- PAN: 10 chars AAAAA9999A format
- UAN: 12 digits
- IFSC: 11 chars starting with bank code
- Phone: 10 digits
- Pincode: 6 digits`

// ── Shared JSON parser ─────────────────────────────────────────────────────────

function buildUserPrompt(documentType: string, documentText: string, fields: string[]): string {
  return `Document Type: ${documentType}

Document Text:
${documentText}

Extract the following fields and return JSON:
${JSON.stringify(fields, null, 2)}

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
}

function parseExtractionResponse(
  rawText: string,
  documentType: string,
  fields: string[],
): Omit<ExtractionResult, 'extraction_version' | 'provider' | 'error'> {
  // Strip markdown code fences if present
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()

  const parsed = JSON.parse(jsonText) as {
    fields: Array<{ field_name: string; value: string | null; confidence_score: number; reasoning: string }>
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

  // Ensure all expected fields are present (fill missing ones with null)
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
  }
}

function humaniseError(raw: string): string {
  if (raw.includes('credit balance is too low') || raw.includes('insufficient_quota')) {
    return 'Anthropic API credits exhausted — top up at console.anthropic.com/settings/billing'
  }
  if (raw.includes('invalid_api_key') || raw.includes('authentication_error')) {
    return 'API key is invalid — check the API key in apps/api/.env'
  }
  if (raw.includes('overloaded_error') || raw.includes('529')) {
    return 'AI API is overloaded — retry in a few seconds'
  }
  return raw
}

// ── Provider: Anthropic Claude ────────────────────────────────────────────────

async function extractWithAnthropic(
  documentType: string,
  documentText: string,
  mimeType: string,
  imageBase64: string | undefined,
  fields: string[],
): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string }

  const contentBlocks: ContentBlock[] = []

  if (imageBase64 && mimeType === 'application/pdf') {
    contentBlocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 },
      title: `${documentType} document`,
    })
  } else if (imageBase64 && (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp')) {
    const validMime = mimeType as 'image/jpeg' | 'image/png' | 'image/webp'
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: validMime, data: imageBase64 } })
  }

  contentBlocks.push({ type: 'text', text: buildUserPrompt(documentType, documentText, fields) })

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentBlocks }],
  })

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  const result = parseExtractionResponse(rawText, documentType, fields)
  return { ...result, extraction_version: EXTRACTION_VERSION, provider: 'anthropic' }
}

// ── Provider: Google Gemini ───────────────────────────────────────────────────

async function extractWithGemini(
  documentType: string,
  documentText: string,
  mimeType: string,
  imageBase64: string | undefined,
  fields: string[],
): Promise<ExtractionResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  // gemini-2.0-flash is free in Google AI Studio dev quota
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash' })

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []

  // Gemini supports PDF and images natively via inlineData
  if (imageBase64 && (mimeType === 'application/pdf' || mimeType.startsWith('image/'))) {
    parts.push({ inlineData: { mimeType, data: imageBase64 } })
  }

  parts.push({ text: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(documentType, documentText, fields)}` })

  const response = await model.generateContent(parts)
  const rawText = response.response.text()

  const result = parseExtractionResponse(rawText, documentType, fields)
  return { ...result, extraction_version: EXTRACTION_VERSION, provider: 'gemini' }
}

// ── Provider: OpenAI ──────────────────────────────────────────────────────────

async function extractWithOpenAI(
  documentType: string,
  documentText: string,
  mimeType: string,
  imageBase64: string | undefined,
  fields: string[],
): Promise<ExtractionResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  type MessageContent = Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >

  const userContent: MessageContent = []

  // OpenAI doesn't support native PDF blocks — send images only
  if (imageBase64 && mimeType.startsWith('image/')) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${imageBase64}` },
    })
  }

  userContent.push({ type: 'text', text: buildUserPrompt(documentType, documentText, fields) })

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    max_tokens: 1500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  const rawText = response.choices[0]?.message?.content ?? ''
  const result = parseExtractionResponse(rawText, documentType, fields)
  return { ...result, extraction_version: EXTRACTION_VERSION, provider: 'openai' }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function extractFromDocument(
  documentType: string,
  documentText: string,
  mimeType: string,
  imageBase64?: string,
): Promise<ExtractionResult> {
  const normalizedType = documentType.toLowerCase().replace(/[\s-]/g, '_')
  const fields = DOCUMENT_FIELDS[normalizedType] ?? DOCUMENT_FIELDS['other']

  // Provider implementations + their required API key.
  const PROVIDERS: Record<string, { hasKey: () => boolean; run: () => Promise<ExtractionResult> }> = {
    anthropic: {
      hasKey: () => !!process.env.ANTHROPIC_API_KEY,
      run: () => extractWithAnthropic(documentType, documentText, mimeType, imageBase64, fields),
    },
    gemini: {
      hasKey: () => !!process.env.GEMINI_API_KEY,
      run: () => extractWithGemini(documentType, documentText, mimeType, imageBase64, fields),
    },
    openai: {
      hasKey: () => !!process.env.OPENAI_API_KEY,
      run: () => extractWithOpenAI(documentType, documentText, mimeType, imageBase64, fields),
    },
  }

  // AI_PROVIDER chooses the PRIMARY backend; the others are automatic fallbacks
  // (so a rate-limited / quota-exhausted free-tier key — e.g. Gemini 429 — does
  // not break extraction when another provider key is configured).
  const primary = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()
  const order = [primary, 'anthropic', 'openai', 'gemini']
    .filter((p, i, arr) => arr.indexOf(p) === i && PROVIDERS[p])
    .filter((p) => PROVIDERS[p].hasKey())

  if (order.length === 0) {
    return {
      fields: [], document_summary: '', overall_confidence: 0,
      extraction_version: EXTRACTION_VERSION, provider: primary,
      error: 'No AI provider API key configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY)',
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const isRateLimit = (m: string) => /429|rate.?limit|quota|too many requests|resource.?exhausted/i.test(m)

  let lastError = ''
  for (let i = 0; i < order.length; i++) {
    const provider = order[i]
    // One in-place retry on a transient rate-limit before falling through.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await PROVIDERS[provider].run()
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err)
        lastError = raw
        if (attempt === 0 && isRateLimit(raw)) {
          await sleep(6000)
          continue // retry same provider once
        }
        break // move to next provider
      }
    }
  }

  return {
    fields: [], document_summary: '', overall_confidence: 0,
    extraction_version: EXTRACTION_VERSION, provider: order[0],
    error: humaniseError(lastError),
  }
}
