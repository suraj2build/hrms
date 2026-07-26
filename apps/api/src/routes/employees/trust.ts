/**
 * Trust breakdown endpoints — O5.3.
 *
 * GET /employees/:id/trust              — full trust breakdown by employee
 * GET /onboarding/sessions/:id/trust    — full trust breakdown by session
 *
 * Both endpoints compute strengths, risks, recommendations, and audit_signals
 * live from verification_events + duplicate_detection_events + the stored
 * workforce_trust_score. The scoring algorithm is not re-run here — we use the
 * persisted score as the authoritative number and enrich it with explainability.
 */

import type { FastifyInstance } from 'fastify'
import { trustScoreService }    from '../../platform/trust/scoring/trust-score.service.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import type {
  VerificationResult, VerificationStatus, VerificationType,
  DuplicateDetectionResult, DuplicateType,
} from '../../platform/trust/types/trust-types.js'

export default async function employeeTrustRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /employees/:id/trust ──────────────────────────────────────────────
  // Reputational/fraud-signal data — was previously authenticate-only,
  // letting any employee read a colleague's fraud/trust breakdown.

  fastify.get('/employees/:id/trust', auth, async (req: any, reply) => {
    const employeeId: string = req.params.id
    const tenantId:   string = req.tenantId

    if (!tenantId) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    // Verify employee exists
    const { data: emp } = await fastify.supabase
      .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const result = await computeEmployeeTrustBreakdown(fastify.supabase, employeeId, tenantId)
    return reply.send({ data: result })
  })

  // ── GET /onboarding/sessions/:id/trust ────────────────────────────────────

  fastify.get('/onboarding/sessions/:id/trust', auth, async (req: any, reply) => {
    const sessionId: string = req.params.id
    const tenantId:  string = req.tenantId

    if (!tenantId) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const { data: session } = await fastify.supabase
      .from('onboarding_sessions').select('id')
      .eq('id', sessionId).eq('tenant_id', tenantId).maybeSingle()
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })

    // onboarding_sessions has no linked_employee_id column → treat as not-yet-converted
    const employeeId: string | null = null

    if (employeeId) {
      // Session has been converted to an employee — use the full employee trust
      const result = await computeEmployeeTrustBreakdown(fastify.supabase, employeeId, tenantId)
      return reply.send({ data: result, source: 'employee' })
    }

    // Pre-conversion session — derive from onboarding checklist booleans only
    const result = await computeSessionTrustBreakdown(fastify.supabase, sessionId, tenantId)
    return reply.send({ data: result, source: 'session' })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function computeEmployeeTrustBreakdown(
  supabase:   any,
  employeeId: string,
  tenantId:   string,
) {
  const [scoreRow, verifRows, dupRows] = await Promise.all([
    supabase
      .from('workforce_trust_scores')
      .select('id, score, severity, factors, explainability, computed_at')
      .eq('tenant_id', tenantId)
      .eq('entity_id', employeeId)
      .eq('score_type', 'employee')
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from('verification_events')
      .select('verification_type, status, flags, score, verified_at')
      .eq('tenant_id', tenantId)
      .eq('entity_id', employeeId)
      .order('verified_at', { ascending: false }),

    supabase
      .from('duplicate_detection_events')
      .select('duplicate_type, matching_entity_ids, severity, value_hash, detected_at')
      .eq('tenant_id', tenantId)
      .eq('entity_id', employeeId)
      .order('detected_at', { ascending: false }),
  ])

  const stored  = scoreRow?.data
  const verifs  = (verifRows?.data ?? []) as VerificationResult[]
  const dups    = (dupRows?.data  ?? []) as DuplicateDetectionResult[]

  const score    = stored?.score    ?? null
  const severity = stored?.severity ?? null

  // Build explainability fields from the live event data
  const partial = trustScoreService.computeEmployeeTrustScore({
    employee_id:   employeeId,
    tenant_id:        tenantId,
    verifications: verifs,
    duplicates:    dups,
  })

  return {
    score_type:      'employee' as const,
    entity_id:       employeeId,
    tenant_id:          tenantId,
    // Use persisted score as authoritative; fall back to recomputed if absent
    score:           score         ?? partial.score,
    severity:        severity      ?? partial.severity,
    factors:         stored?.factors ?? partial.factors,
    strengths:       partial.strengths,
    risks:           partial.risks,
    recommendations: partial.recommendations,
    audit_signals:   partial.audit_signals,
    computed_at:     stored?.computed_at ?? partial.computed_at,
    explainability:  stored?.explainability ?? partial.explainability,
  }
}

async function computeSessionTrustBreakdown(
  supabase:  any,
  sessionId: string,
  tenantId:  string,
) {
  // Load the draft profile to get document upload flags
  const { data: draft } = await supabase
    .from('draft_employee_profiles')
    .select('id, pan_number, status')
    .eq('session_id', sessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { data: bankRow } = await supabase
    .from('draft_bank_statutory')
    .select('account_number')
    .eq('session_id', sessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { data: docs } = await supabase
    .from('onboarding_documents')
    .select('document_type, extraction_status')
    .eq('session_id', sessionId)
    .eq('tenant_id', tenantId)

  const hasPan      = !!(draft as any)?.pan_number
  const hasBank     = !!(bankRow as any)?.account_number
  const hasIdentity = ((docs ?? []) as any[]).some(
    (d: any) => ['passport', 'aadhaar', 'voter_id', 'driving_licence'].includes(d.document_type),
  )

  return trustScoreService.computeOnboardingTrustScore({
    employee_id:   sessionId,
    tenant_id:        tenantId,
    has_pan:       hasPan,
    has_bank:      hasBank,
    has_identity:  hasIdentity,
    duplicates:    [],
  })
}
