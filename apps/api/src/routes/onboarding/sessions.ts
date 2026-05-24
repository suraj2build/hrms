import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseDocumentToText } from '../../lib/onboarding/document-parser.js'
import { extractFromDocument } from '../../lib/onboarding/extraction-engine.js'
import { mergeExtractions } from '../../lib/onboarding/profile-merger.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const createSessionSchema = z.object({
  candidate_name: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
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
        status: 'pending',
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
        onboarding_documents(count),
        draft_employee_profiles(id, status, overall_confidence)
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

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data, total: count ?? 0 })
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
      .order('created_at', { ascending: true })

    if (docsError) return reply.code(500).send({ error: 'DB_ERROR', message: docsError.message })

    const { data: draftProfile } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('id, status, overall_confidence, missing_critical_fields, conflict_fields')
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

    const { data: session, error: sessionError } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (sessionError || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })
    }

    const { data, error } = await fastify.supabase
      .from('onboarding_documents')
      .select('*')
      .eq('session_id', id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: true })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data })
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
    } else {
      docsQuery = docsQuery.eq('extraction_status', 'pending')
    }

    const { data: documents, error: docsError } = await docsQuery

    if (docsError) return reply.code(500).send({ error: 'DB_ERROR', message: docsError.message })
    if (!documents || documents.length === 0) {
      return reply.code(400).send({ error: 'NO_DOCUMENTS', message: 'No documents to extract' })
    }

    // ── Process each document ─────────────────────────────────────────────
    const extractionResults: Array<{
      documentId: string
      documentType: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields: any[]
    }> = []

    let documentsExtracted = 0

    for (const doc of documents) {
      try {
        // 1. Download file from Supabase Storage
        const { data: fileData, error: downloadError } = await fastify.supabase.storage
          .from('employee-files')
          .download(doc.storage_path)

        if (downloadError || !fileData) {
          await fastify.supabase
            .from('onboarding_documents')
            .update({ extraction_status: 'failed', extraction_error: `Download failed: ${downloadError?.message ?? 'unknown'}` })
            .eq('id', doc.id)
          continue
        }

        const arrayBuffer = await fileData.arrayBuffer()
        const fileBuffer = Buffer.from(arrayBuffer)

        // 2. Parse text
        const parseResult = await parseDocumentToText(fileBuffer, doc.mime_type)

        // 3. Prepare base64 for image types
        let imageBase64: string | undefined
        if (doc.mime_type.startsWith('image/')) {
          imageBase64 = fileBuffer.toString('base64')
        }

        // 4. Extract with Claude
        const extractionResult = await extractFromDocument(
          doc.document_type,
          parseResult.text,
          doc.mime_type,
          imageBase64,
        )

        // 5. Update document row
        await fastify.supabase
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

        if (!extractionResult.error && extractionResult.fields.length > 0) {
          // 6. Insert/upsert draft_employee_fields rows
          const fieldRows = extractionResult.fields.map((f) => ({
            tenant_id: req.tenantId,
            session_id: sessionId,
            document_id: doc.id,
            field_name: f.field_name,
            value: f.value,
            confidence_score: f.confidence_score,
            reasoning: f.reasoning,
            source_document_type: f.source_document_type,
            is_hr_override: false,
          }))

          await fastify.supabase
            .from('draft_employee_fields')
            .upsert(fieldRows, { onConflict: 'session_id,document_id,field_name' })

          extractionResults.push({
            documentId: doc.id,
            documentType: doc.document_type,
            fields: extractionResult.fields as any,
          })

          documentsExtracted++
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        await fastify.supabase
          .from('onboarding_documents')
          .update({ extraction_status: 'failed', extraction_error: message })
          .eq('id', doc.id)
      }
    }

    // ── Merge & create/update draft profile ────────────────────────────────
    let draftProfileId: string | null = null

    if (extractionResults.length > 0) {
      const merged = mergeExtractions({
        sessionId,
        tenantId: req.tenantId,
        extractedFields: extractionResults as any,
      })

      // Build flat columns from merged fields for the draft_employee_profiles row
      const profileColumns: Record<string, unknown> = {}
      for (const [fieldName, fieldData] of Object.entries(merged.fields)) {
        if (fieldData.value !== null) {
          profileColumns[fieldName] = fieldData.value
        }
      }

      const { data: existing } = await fastify.supabase
        .from('draft_employee_profiles')
        .select('id')
        .eq('session_id', sessionId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (existing?.id) {
        await fastify.supabase
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

        draftProfileId = existing.id
      } else {
        const { data: newDraft } = await fastify.supabase
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

        draftProfileId = newDraft?.id ?? null
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
        action: 'extraction_completed',
        performed_by: req.userId,
        metadata: {
          documents_extracted: documentsExtracted,
          total_documents: documents.length,
          draft_profile_id: draftProfileId,
        },
      })

    return reply.send({
      data: {
        session_id: sessionId,
        documents_extracted: documentsExtracted,
        draft_profile_id: draftProfileId,
      },
    })
  })
}
