import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseDocumentToText } from '../../lib/onboarding/document-parser.js'
import { extractFromDocument } from '../../lib/onboarding/extraction-engine.js'
import { mergeExtractions } from '../../lib/onboarding/profile-merger.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const createSessionSchema = z.object({
  candidate_name: z.string().optional(),
  assigned_to: z.string().uuid().optional().nullable(),
})

const createDocumentSchema = z.object({
  document_type: z.string().min(1),
  file_name: z.string().min(1),
  file_size: z.number().int().nonnegative(),
  mime_type: z.string().min(1),
  storage_path: z.string().min(1),
})

const extractSchema = z.object({
  document_ids: z.array(z.string().uuid()).optional(),
})

// ─── Route plugin ──────────────────────────────────────────────────────────

export default async function sessionRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── POST /onboarding/sessions ──────────────────────────────────────────────
  fastify.post('/sessions', auth, async (req: any, reply) => {
    // HR admin check
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = createSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    const { candidate_name, assigned_to } = parsed.data

    const { data, error } = await fastify.supabase
      .from('onboarding_sessions')
      .insert({
        tenant_id: req.tenantId,
        candidate_name: candidate_name ?? null,
        assigned_to: assigned_to ?? null,
        status: 'active',
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.code(201).send({ data })
  })

  // ── GET /onboarding/sessions ───────────────────────────────────────────────
  fastify.get('/sessions', auth, async (req: any, reply) => {
    const {
      status,
      page = '1',
      limit = '20',
    } = req.query as Record<string, string>

    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = fastify.supabase
      .from('onboarding_sessions')
      .select(
        `
        id, candidate_name, status, created_at, assigned_to, created_by,
        onboarding_documents(id),
        draft_employee_profiles(id, status)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) {
      // Graceful degradation when tables don't exist yet (migration pending)
      if ((error as any).code === '42P01' || error.message?.includes('does not exist')) {
        return reply.send({ data: [], total: 0 })
      }
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    // Normalise: map document array → count, keep draft profile summary
    const rows = (data ?? []).map((s: any) => ({
      ...s,
      document_count:   Array.isArray(s.onboarding_documents) ? s.onboarding_documents.length : 0,
      draft_profile:    Array.isArray(s.draft_employee_profiles) ? (s.draft_employee_profiles[0] ?? null) : null,
      onboarding_documents:   undefined,
      draft_employee_profiles: undefined,
    }))

    return reply.send({ data: rows, total: count ?? 0 })
  })

  // ── GET /onboarding/sessions/:id ──────────────────────────────────────────
  fastify.get('/sessions/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: session, error: sessionError } = await fastify.supabase
      .from('onboarding_sessions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (sessionError || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })
    }

    const { data: documents, error: docsError } = await fastify.supabase
      .from('onboarding_documents')
      .select('*')
      .eq('session_id', id)
      .eq('tenant_id', req.tenantId)
      .order('uploaded_at', { ascending: true })

    if (docsError) {
      fastify.log.error({ docsError, sessionId: id }, 'GET /sessions/:id — documents sub-query failed')
      // Don't crash the entire session load on a documents query failure
    }

    // Select only stable columns — overall_confidence etc. added in migration 178
    // which may not be applied yet; select('*') is safe but we only need summary here
    const { data: draftProfile } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('id, status')
      .eq('session_id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    return reply.send({ data: { ...session, documents: documents ?? [], draft_profile: draftProfile ?? null } })
  })

  // ── DELETE /onboarding/sessions/:id ───────────────────────────────────────
  fastify.delete('/sessions/:id', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data: session, error: findError } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (findError || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })
    }

    const { error } = await fastify.supabase
      .from('onboarding_sessions')
      .update({ status: 'archived' })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: { id, status: 'archived' } })
  })

  // ── POST /onboarding/sessions/:id/documents ───────────────────────────────
  fastify.post('/sessions/:id/documents', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = createDocumentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    // Verify session belongs to tenant
    const { data: session, error: sessionError } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (sessionError || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })
    }

    const { document_type, file_name, file_size, mime_type, storage_path } = parsed.data

    const { data, error } = await fastify.supabase
      .from('onboarding_documents')
      .insert({
        tenant_id: req.tenantId,
        session_id: id,
        document_type,
        file_name,
        file_size,
        mime_type,
        storage_path,
        extraction_status: 'pending',
        uploaded_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.code(201).send({ data })
  })

  // ── GET /onboarding/sessions/:id/documents ────────────────────────────────
  fastify.get('/sessions/:id/documents', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Query documents directly — session ownership is enforced by tenant_id
    const { data, error } = await fastify.supabase
      .from('onboarding_documents')
      .select('*')
      .eq('session_id', id)
      .eq('tenant_id', req.tenantId)
      .order('uploaded_at', { ascending: true })

    if (error) {
      fastify.log.error({ error, sessionId: id }, 'Failed to fetch onboarding documents')
      // Gracefully return empty list if table doesn't exist yet (migration pending)
      if ((error as any).code === '42P01') return reply.send({ data: [] })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── DELETE /onboarding/sessions/:id/documents/:docId ─────────────────────
  fastify.delete('/sessions/:id/documents/:docId', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id, docId } = req.params as { id: string; docId: string }

    const { data: doc, error: findError } = await fastify.supabase
      .from('onboarding_documents')
      .select('id, extraction_status')
      .eq('id', docId)
      .eq('session_id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (findError || !doc) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Document not found' })
    }

    if (doc.extraction_status !== 'pending') {
      return reply.code(409).send({
        error: 'CONFLICT',
        message: 'Document can only be deleted when extraction_status is pending',
      })
    }

    const { error } = await fastify.supabase
      .from('onboarding_documents')
      .delete()
      .eq('id', docId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: { id: docId, deleted: true } })
  })

  // ── POST /onboarding/sessions/:id/extract ─────────────────────────────────
  fastify.post('/sessions/:id/extract', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id: sessionId } = req.params as { id: string }

    const parsed = extractSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    // Verify session
    const { data: session, error: sessionError } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (sessionError || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })
    }

    // Determine which documents to process
    let docsQuery = fastify.supabase
      .from('onboarding_documents')
      .select('*')
      .eq('session_id', sessionId)
      .eq('tenant_id', req.tenantId)

    if (parsed.data.document_ids && parsed.data.document_ids.length > 0) {
      docsQuery = docsQuery.in('id', parsed.data.document_ids)
    }
    // Otherwise process EVERY document in the session. Re-extraction is a full
    // refresh: it must (a) re-process documents stuck in 'processing' from an
    // interrupted run, and (b) include every document so the cross-document
    // merge is complete (the merge rebuilds the draft from this run's results).

    const { data: documents, error: docsError } = await docsQuery

    if (docsError) return reply.code(500).send({ error: 'DB_ERROR', message: docsError.message })
    if (!documents || documents.length === 0) {
      return reply.code(400).send({ error: 'NO_DOCUMENTS', message: 'No documents to extract' })
    }

    // ── Process each document ─────────────────────────────────────────────
    // Sort: Aadhaar first, PAN second — these are the identity anchors.
    // All other documents are validated AGAINST the anchor after extraction.
    const ANCHOR_PRIORITY: Record<string, number> = { aadhaar: 0, pan: 1, passport: 2 }
    const sortedDocuments = [...documents].sort((a, b) => {
      const pa = ANCHOR_PRIORITY[a.document_type?.toLowerCase().replace(/[\s-]/g, '_') ?? ''] ?? 99
      const pb = ANCHOR_PRIORITY[b.document_type?.toLowerCase().replace(/[\s-]/g, '_') ?? ''] ?? 99
      return pa - pb
    })

    const extractionResults: Array<{
      documentId: string
      documentType: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields: any[]
    }> = []
    const docErrors: Array<{ docId: string; step: string; reason: string }> = []

    // Anchor name/DOB extracted from Aadhaar (or PAN as fallback).
    // Set after the first anchor doc succeeds — used to reject mismatches.
    let anchorName: string | null = null
    let anchorDob:  string | null = null
    let anchorDocType: string | null = null

    let documentsExtracted = 0

    for (const doc of sortedDocuments) {
      fastify.log.info({ docId: doc.id, docType: doc.document_type, storagePath: doc.storage_path }, 'extract: processing document')
      // Mark this document as in-progress so the UI can show live progress
      // (committed immediately — the review screen polls and reflects it).
      {
        const { error: procErr } = await fastify.supabase
          .from('onboarding_documents')
          .update({ extraction_status: 'processing', extraction_error: null })
          .eq('id', doc.id)
        if (procErr) fastify.log.error({ procErr, docId: doc.id }, 'extract: failed to mark document processing')
      }
      try {
        // 1. Download file from Supabase Storage
        const { data: fileData, error: downloadError } = await fastify.supabase.storage
          .from('employee-files')
          .download(doc.storage_path)

        if (downloadError || !fileData) {
          const reason = `Download failed: ${downloadError?.message ?? 'no data returned'}`
          fastify.log.error({ downloadError, storagePath: doc.storage_path }, 'extract: storage download failed')
          docErrors.push({ docId: doc.id, step: 'download', reason })
          const { error: updErr } = await fastify.supabase
            .from('onboarding_documents')
            .update({ extraction_status: 'failed', extraction_error: reason })
            .eq('id', doc.id)
          if (updErr) fastify.log.error({ updErr }, 'extract: failed to mark doc as failed after download error')
          continue
        }

        fastify.log.info({ docId: doc.id, mimeType: doc.mime_type }, 'extract: download ok, parsing')
        const arrayBuffer = await fileData.arrayBuffer()
        const fileBuffer = Buffer.from(arrayBuffer)

        // 2. Parse text
        const parseResult = await parseDocumentToText(fileBuffer, doc.mime_type)
        fastify.log.info({ docId: doc.id, textLen: parseResult.text.length, parseError: parseResult.error }, 'extract: parse done')

        // 3. Prepare base64 for PDFs and images so Claude can read them natively
        let imageBase64: string | undefined
        const mimeType: string = doc.mime_type ?? ''
        if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
          imageBase64 = fileBuffer.toString('base64')
          fastify.log.info({ docId: doc.id, base64Len: imageBase64.length }, 'extract: base64 encoded for Claude')
        }

        // 4. Extract with Claude (bounded — a single hung model call must not
        //    stall the whole run and leave later documents in 'processing').
        fastify.log.info({ docId: doc.id }, 'extract: calling Claude')
        const EXTRACT_TIMEOUT_MS = 120_000
        const extractionResult = await Promise.race([
          extractFromDocument(doc.document_type, parseResult.text, mimeType, imageBase64),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error(`Extraction timed out after ${EXTRACT_TIMEOUT_MS / 1000}s`)), EXTRACT_TIMEOUT_MS),
          ),
        ])
        fastify.log.info({
          docId: doc.id,
          fieldsCount: extractionResult.fields.length,
          confidence: extractionResult.overall_confidence,
          error: extractionResult.error,
        }, 'extract: Claude done')

        // 5. Update document row
        const { error: docUpdErr } = await fastify.supabase
          .from('onboarding_documents')
          .update({
            extraction_status: extractionResult.error ? 'failed' : 'extracted',
            confidence_score: extractionResult.overall_confidence,
            extracted_text: parseResult.text || null,
            document_summary: extractionResult.document_summary || null,
            extraction_error: extractionResult.error ?? null,
            extraction_version: extractionResult.extraction_version,
          })
          .eq('id', doc.id)
        if (docUpdErr) fastify.log.error({ docUpdErr, docId: doc.id }, 'extract: failed to update document status')

        if (extractionResult.error) {
          docErrors.push({ docId: doc.id, step: 'claude', reason: extractionResult.error })
        } else if (extractionResult.fields.length === 0) {
          docErrors.push({ docId: doc.id, step: 'claude', reason: 'Claude returned 0 fields — document may be blank or unsupported format' })
        } else {
          const normDocType = (doc.document_type ?? '').toLowerCase().replace(/[\s-]/g, '_')
          const isAnchorDoc = normDocType === 'aadhaar' || normDocType === 'pan' || normDocType === 'passport'

          // Extract name/DOB from this result for anchor or comparison
          const getName = (fields: any[]): string | null => {
            const full = fields.find((f: any) => f.field_name === 'full_name')?.value
            if (full) return (full as string).toUpperCase().trim()
            const first = fields.find((f: any) => f.field_name === 'first_name')?.value ?? ''
            const last  = fields.find((f: any) => f.field_name === 'last_name')?.value ?? ''
            const holder = fields.find((f: any) => f.field_name === 'account_holder_name')?.value ?? ''
            const combined = [first, last].filter(Boolean).join(' ').trim() || holder
            return combined ? (combined as string).toUpperCase().trim() : null
          }
          const getDob = (fields: any[]): string | null =>
            fields.find((f: any) => f.field_name === 'dob')?.value ?? null

          const docName = getName(extractionResult.fields as any[])
          const docDob  = getDob(extractionResult.fields as any[])

          // Set anchor from first successful Aadhaar/PAN/Passport
          if (isAnchorDoc && !anchorName && docName) {
            anchorName    = docName
            anchorDob     = docDob
            anchorDocType = normDocType
            fastify.log.info({ anchorName, anchorDob, anchorDocType }, 'extract: identity anchor set')
          }

          // 6. Identity check for non-anchor docs (if anchor is available)
          if (!isAnchorDoc && anchorName && docName) {
            // Simple token-based match (same logic as identity-check.ts)
            const HONORIFICS = new Set(['MR','MRS','MS','SHRI','SMT','KUMARI','KUM','DR'])
            const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, ' ')
              .split(/\s+/).filter((t) => t.length > 0 && !HONORIFICS.has(t))
            const lev = (a: string, b: string): number => {
              const m = a.length, n = b.length
              if (!m) return n; if (!n) return m
              const dp = Array.from({ length: m + 1 }, (_,i) => [i, ...Array(n).fill(0)])
              for (let j = 0; j <= n; j++) dp[0][j] = j
              for (let i = 1; i <= m; i++)
                for (let j = 1; j <= n; j++) {
                  const c = a[i-1] === b[j-1] ? 0 : 1
                  dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+c)
                }
              return dp[m][n]
            }
            const tokMatch = (a: string, b: string) => {
              if (a === b) return true
              if (a.length === 1 || b.length === 1) return a[0] === b[0]
              return lev(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 4))
            }
            const anchorToks = tokens(anchorName)
            const docToks    = tokens(docName)
            const small = anchorToks.length <= docToks.length ? anchorToks : docToks
            const large = anchorToks.length <= docToks.length ? docToks : anchorToks
            const used = new Set<number>()
            let aligned = 0
            for (const t of small) {
              const idx = large.findIndex((lt, i) => !used.has(i) && tokMatch(t, lt))
              if (idx >= 0) { used.add(idx); aligned++ }
            }
            const isMismatch = aligned === 0 || aligned / small.length < 0.5

            if (isMismatch) {
              const reason = `Identity mismatch: name "${docName}" does not match ${anchorDocType} anchor "${anchorName}". Document rejected — no data extracted.`
              fastify.log.warn({ docId: doc.id, docName, anchorName }, 'extract: identity mismatch — rejecting document')
              docErrors.push({ docId: doc.id, step: 'identity', reason })
              await fastify.supabase
                .from('onboarding_documents')
                .update({ extraction_status: 'rejected', extraction_error: reason })
                .eq('id', doc.id)
              continue  // ← skip adding to extractionResults — no data from this doc
            }

            // DOB mismatch check (hard reject)
            if (anchorDob && docDob) {
              const norm = (d: string) => {
                const s = d.trim()
                const a = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
                if (a) return `${a[1]}-${a[2]}-${a[3]}`
                const b = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/)
                if (b) return `${b[3]}-${b[2]}-${b[1]}`
                return s
              }
              if (norm(anchorDob) !== norm(docDob)) {
                const reason = `Identity mismatch: DOB "${docDob}" does not match ${anchorDocType} DOB "${anchorDob}". Document rejected.`
                fastify.log.warn({ docId: doc.id, docDob, anchorDob }, 'extract: DOB mismatch — rejecting document')
                docErrors.push({ docId: doc.id, step: 'identity', reason })
                await fastify.supabase
                  .from('onboarding_documents')
                  .update({ extraction_status: 'rejected', extraction_error: reason })
                  .eq('id', doc.id)
                continue
              }
            }
          }

          // 7. Collect for merge (only docs that passed identity check reach here)
          extractionResults.push({
            documentId: doc.id,
            documentType: doc.document_type,
            fields: extractionResult.fields as any,
          })
          documentsExtracted++
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        fastify.log.error({ err: message, docId: doc.id }, 'extract: unhandled exception in extraction loop')
        docErrors.push({ docId: doc.id, step: 'exception', reason: message })
        const { error: catchUpdErr } = await fastify.supabase
          .from('onboarding_documents')
          .update({ extraction_status: 'failed', extraction_error: message })
          .eq('id', doc.id)
        if (catchUpdErr) fastify.log.error({ catchUpdErr, docId: doc.id }, 'extract: failed to mark doc as failed after exception')
      }
    }

    // Safety net: never leave a document stuck in 'processing' once the run has
    // finished its loop. Any still 'processing' here means its terminal update
    // was missed — mark it 'failed' so the UI never shows a permanent spinner.
    {
      const { error: sweepErr } = await fastify.supabase
        .from('onboarding_documents')
        .update({ extraction_status: 'failed', extraction_error: 'Extraction did not complete — please retry' })
        .eq('session_id', sessionId)
        .eq('tenant_id', req.tenantId)
        .eq('extraction_status', 'processing')
      if (sweepErr) fastify.log.error({ sweepErr, sessionId }, 'extract: failed to sweep stuck processing documents')
    }

    // ── Merge & create/update draft profile ────────────────────────────────
    let draftProfileId: string | null = null

    if (extractionResults.length > 0) {
      const merged = mergeExtractions({
        sessionId,
        tenantId: req.tenantId,
        extractedFields: extractionResults as any,
      })

      // ── Map extracted field names → valid draft_employee_profiles columns ──
      // Many extracted fields (full_name, ifsc_code, account_number, etc.) don't
      // match DB column names exactly. This function normalises them so the
      // INSERT/UPDATE never references a column that doesn't exist.
      function buildProfileColumns(fields: Record<string, { value: string | null }>): Record<string, unknown> {
        // Only these columns exist in draft_employee_profiles (migration 109 + 178)
        const VALID_COLUMNS = new Set([
          'first_name', 'last_name', 'email', 'phone', 'dob', 'gender',
          'address_line1', 'address_city', 'address_state', 'address_pincode',
          'employee_code', 'joining_date', 'employment_type',
          'department_id', 'designation_id', 'grade_id',   // UUID FKs — HR sets via dropdown
          'pan_number', 'uan_number', 'esi_number', 'pf_number',
          'bank_name', 'bank_account_number', 'bank_ifsc', 'bank_account_type', 'ctc_annual',
          'previous_employer', 'previous_designation',
        ])

        // Extracted field → table column remapping
        const FIELD_MAP: Record<string, string> = {
          ifsc_code:            'bank_ifsc',
          account_number:       'bank_account_number',
          account_type:         'bank_account_type',
          account_holder_name:  'first_name',   // best-effort
          ctc_monthly:          '',              // no column — skip
          from_date:            '',
          to_date:              '',
          reason_for_leaving:   '',
          father_name:          '',
          passport_number:      '',
          expiry_date:          '',
          nationality:          '',
          branch_name:          '',
          total_experience_years: '',
          skills_summary:       '',
          highest_education:    '',
          month_year:           '',
          gross_salary:         '',
          net_salary:           '',
          basic_salary:         '',
          hra:                  '',
          pf_deduction:         '',
          esi_deduction:        '',
          bank_account_last4:   '',
          effective_date:       'joining_date',
          reference_number:     '',
          date:                 '',
        }

        const GENDER_MAP: Record<string, string> = {
          male: 'male', m: 'male', man: 'male',
          female: 'female', f: 'female', woman: 'female',
          other: 'other', others: 'other',
          prefer_not_to_say: 'prefer_not_to_say',
        }

        const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
          permanent: 'permanent', full_time: 'permanent', 'full-time': 'permanent',
          contract: 'contract', contractor: 'contract',
          intern: 'intern', internship: 'intern',
          probation: 'probation',
          consultant: 'consultant',
        }

        const cols: Record<string, unknown> = {}

        // Handle full_name → first_name + last_name split.
        // full_name is resolved by document-authority priority (Aadhaar/PAN/
        // passport first), so it is the legal name and WINS over a resume's
        // first_name/last_name. Resume first/last is used only as a fallback
        // when no authoritative full_name is present.
        const fullName = fields['full_name']?.value
        const haveFullName = !!fullName
        const toTitle = (s: string) => s.trim().replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
        if (fullName) {
          const parts = fullName.trim().split(/\s+/)
          cols['first_name'] = toTitle(parts[0] ?? fullName)
          if (parts.length > 1) cols['last_name'] = toTitle(parts.slice(1).join(' '))
        }

        for (const [rawName, fieldData] of Object.entries(fields)) {
          if (!fieldData.value || rawName === 'full_name') continue
          // Don't let resume first/last overwrite the authoritative full_name split
          if (haveFullName && (rawName === 'first_name' || rawName === 'last_name')) continue
          // Title-case name fields coming from any source
          if ((rawName === 'first_name' || rawName === 'last_name') && typeof fieldData.value === 'string') {
            fieldData = { ...fieldData, value: toTitle(fieldData.value) }
          }

          const colName = FIELD_MAP[rawName] !== undefined ? FIELD_MAP[rawName] : rawName

          // Empty string in FIELD_MAP means "skip this field"
          if (!colName || !VALID_COLUMNS.has(colName)) continue

          let value: unknown = fieldData.value

          // Normalise gender
          if (colName === 'gender') {
            value = GENDER_MAP[fieldData.value.toLowerCase().replace(/[^a-z_]/g, '')] ?? null
            if (!value) continue
          }

          // Normalise employment_type
          if (colName === 'employment_type') {
            value = EMPLOYMENT_TYPE_MAP[fieldData.value.toLowerCase().replace(/[^a-z_-]/g, '')] ?? null
            if (!value) continue
          }

          // Normalise ctc_annual to numeric (strip ₹ commas etc.)
          if (colName === 'ctc_annual') {
            const num = parseFloat(String(fieldData.value).replace(/[^\d.]/g, ''))
            value = isNaN(num) ? null : num
            if (!value) continue
          }

          cols[colName] = value
        }

        return cols
      }

      const profileColumns = buildProfileColumns(
        Object.fromEntries(
          Object.entries(merged.fields).map(([k, v]) => [k, { value: v.value }]),
        ),
      )

      const { data: existing } = await fastify.supabase
        .from('draft_employee_profiles')
        .select('id')
        .eq('session_id', sessionId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (existing?.id) {
        // Wipe all extractable columns first so stale data from a previous
        // (partial/wrong) run can never survive a re-extraction.
        const NULLABLE_EXTRACT_COLS: Record<string, null> = {
          first_name: null, last_name: null, email: null, phone: null,
          dob: null, gender: null, address_line1: null, address_city: null,
          address_state: null, address_pincode: null, joining_date: null,
          employment_type: null, pan_number: null, uan_number: null,
          esi_number: null, pf_number: null, bank_name: null,
          bank_account_number: null, bank_ifsc: null, bank_account_type: null,
          ctc_annual: null, previous_employer: null, previous_designation: null,
        }
        await fastify.supabase
          .from('draft_employee_profiles')
          .update({ ...NULLABLE_EXTRACT_COLS, updated_at: new Date().toISOString() })
          .eq('id', existing.id)

        const { error: updateErr } = await fastify.supabase
          .from('draft_employee_profiles')
          .update({
            ...profileColumns,
            overall_confidence: merged.overall_confidence,
            missing_critical_fields: merged.missing_critical_fields,
            conflict_fields: merged.conflict_fields,
            status: 'draft_ready',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        if (updateErr) {
          fastify.log.error({ updateErr, draftId: existing.id }, 'extract: draft_employee_profiles UPDATE failed — migration 178 may not be applied')
        }
        draftProfileId = existing.id
      } else {
        const { data: newDraft, error: insertErr } = await fastify.supabase
          .from('draft_employee_profiles')
          .insert({
            tenant_id: req.tenantId,
            session_id: sessionId,
            ...profileColumns,
            overall_confidence: merged.overall_confidence,
            missing_critical_fields: merged.missing_critical_fields,
            conflict_fields: merged.conflict_fields,
            status: 'draft_ready',
          })
          .select('id')
          .single()

        if (insertErr) {
          fastify.log.error({ insertErr, sessionId }, 'extract: draft_employee_profiles INSERT failed — migration 178 may not be applied')
        }
        draftProfileId = newDraft?.id ?? null
      }

      // ── Insert draft_employee_fields (needs draft_id — do after profile created) ──
      if (draftProfileId) {
        // Build the new extracted rows first, and track which field_names the
        // documents produced a REAL (non-null) value for.
        const fieldRows: object[] = []
        const extractedNames = new Set<string>()
        for (const doc of extractionResults) {
          for (const f of doc.fields) {
            if (f.value !== null && f.value !== '') extractedNames.add(f.field_name)
            fieldRows.push({
              tenant_id:            req.tenantId,
              draft_id:             draftProfileId,
              document_id:          doc.documentId,
              field_name:           f.field_name,
              extracted_value:      f.value,
              confidence_score:     f.confidence_score,
              extraction_reasoning: f.reasoning,
              source_document_type: f.source_document_type,
              is_conflicting:       false,
              is_hr_override:       false,
            })
          }
        }

        // 1. Clear prior AI-extracted (non-override) rows — they're being refreshed.
        await fastify.supabase
          .from('draft_employee_fields')
          .delete()
          .eq('draft_id', draftProfileId)
          .eq('tenant_id', req.tenantId)
          .eq('is_hr_override', false)

        // 2. DOCUMENT WINS over manual entry: for any field the documents now
        //    provide a value for, also remove the HR-manual override so the
        //    extracted value takes over. Manual entries for fields NOT present
        //    in any document are preserved (re-extraction only fills/updates).
        if (extractedNames.size > 0) {
          await fastify.supabase
            .from('draft_employee_fields')
            .delete()
            .eq('draft_id', draftProfileId)
            .eq('tenant_id', req.tenantId)
            .eq('is_hr_override', true)
            .in('field_name', Array.from(extractedNames))
        }

        if (fieldRows.length > 0) {
          const { error: fieldsErr } = await fastify.supabase
            .from('draft_employee_fields')
            .insert(fieldRows)
          if (fieldsErr) {
            fastify.log.error({ fieldsErr }, 'extract: failed to insert draft_employee_fields')
          }
        }
      }

      // Update session status
      await fastify.supabase
        .from('onboarding_sessions')
        .update({ status: 'draft_ready' })
        .eq('id', sessionId)
    }

    // ── Audit log ──────────────────────────────────────────────────────────
    await fastify.supabase
      .from('onboarding_audit_log')
      .insert({
        tenant_id: req.tenantId,
        session_id: sessionId,
        draft_id:   draftProfileId ?? undefined,
        action:     'extraction_completed',
        actor_id:   req.userId,
        details: {
          documents_extracted: documentsExtracted,
          total_documents: documents.length,
        },
      })

    return reply.send({
      data: {
        session_id: sessionId,
        documents_extracted: documentsExtracted,
        draft_profile_id: draftProfileId,
        doc_errors: docErrors.length > 0 ? docErrors : undefined,
      },
    })
  })
}
