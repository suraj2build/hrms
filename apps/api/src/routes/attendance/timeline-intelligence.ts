/**
 * Attendance Timeline Intelligence Route
 *
 * GET /attendance/timeline-intelligence/:employeeId/:date
 *
 * Returns an intelligence overlay for a single employee's day:
 *   - Confidence score/level/factors from attendance_daily
 *   - Exceptions from attendance_exceptions
 *   - Inferences from attendance_inference_log
 *   - Policy conflicts from attendance_policy_conflict_log
 *   - Retroactive impacts from attendance_retroactive_impacts
 *   - A derived intelligence_summary with overall reliability + attention flags
 *
 * Auth: hr_admin / super_admin (or the employee querying their own record).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// ── Types ─────────────────────────────────────────────────────────────────────

type OverallReliability = 'high' | 'medium' | 'low' | 'critical'

interface ExceptionRow {
  id:               string
  type:             string
  category:         string | null
  severity:         string
  status:           string
  payroll_impacting: boolean
  created_at:       string
}

interface InferenceRow {
  id:                string
  type:              string
  reason:            string | null
  confidence_penalty: number | null
  explanation:       string | null
}

interface PolicyConflictRow {
  id:                 string
  conflict_type:      string
  policy_a:           string | null
  policy_b:           string | null
  applied_precedence: string | null
  explanation:        string | null
}

interface RetroactiveImpactRow {
  id:             string
  trigger_source: string | null
  impact_types:   string[] | null
  before_status:  string | null
  after_status:   string | null
  explanation:    string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const paramsSchema = z.object({
  employeeId: z.string().regex(UUID_RE, 'employeeId must be a valid UUID'),
  date:       z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
})

/**
 * Map confidence_level → overall_reliability.
 * 'critical' → 'critical', 'low' → 'low', 'medium' → 'medium', anything else → 'high'
 */
function deriveReliability(confidenceLevel: string | null | undefined): OverallReliability {
  switch (confidenceLevel) {
    case 'critical': return 'critical'
    case 'low':      return 'low'
    case 'medium':   return 'medium'
    default:         return 'high'
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function timelineIntelligenceRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get<{ Params: { employeeId: string; date: string } }>(
    '/attendance/timeline-intelligence/:employeeId/:date',
    auth,
    async (req: any, reply) => {
      // Validate params
      const paramsParsed = paramsSchema.safeParse(req.params)
      if (!paramsParsed.success) {
        return reply.code(400).send({
          error:   'VALIDATION_ERROR',
          message: paramsParsed.error.issues[0]?.message,
        })
      }

      const { employeeId, date } = paramsParsed.data
      const isAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

      // Non-admins may only view their own intelligence data
      if (!isAdmin) {
        const { data: profile } = await fastify.supabase
          .from('profiles')
          .select('employee_id')
          .eq('id', req.userId)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()

        if ((profile as any)?.employee_id !== employeeId) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
        }
      }

      // Confirm the employee belongs to this tenant
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      // ── Parallel queries ────────────────────────────────────────────────────
      const [
        exceptionsResult,
        inferencesResult,
        conflictsResult,
        retroactiveResult,
        dailyResult,
      ] = await Promise.allSettled([
        // 1. attendance_exceptions
        fastify.supabase
          .from('attendance_exceptions')
          .select('id, type, category, severity, status, payroll_impacting, created_at')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .order('created_at', { ascending: true }),

        // 2. attendance_inference_log
        fastify.supabase
          .from('attendance_inference_log')
          .select('id, type, reason, confidence_penalty, explanation')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .order('created_at', { ascending: true }),

        // 3. attendance_policy_conflict_log
        fastify.supabase
          .from('attendance_policy_conflict_log')
          .select('id, conflict_type, policy_a, policy_b, applied_precedence, explanation')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .order('created_at', { ascending: true }),

        // 4. attendance_retroactive_impacts
        fastify.supabase
          .from('attendance_retroactive_impacts')
          .select('id, trigger_source, impact_types, before_status, after_status, explanation')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('affected_date', date)
          .order('created_at', { ascending: true }),

        // 5. attendance_daily — confidence fields
        fastify.supabase
          .from('attendance_daily')
          .select('confidence_score, confidence_level, confidence_factors')
          .eq('tenant_id', req.tenantId)
          .eq('employee_id', employeeId)
          .eq('date', date)
          .maybeSingle(),
      ])

      // Extract data gracefully — tables may not yet exist; default to empty arrays
      const exceptions: ExceptionRow[] =
        exceptionsResult.status === 'fulfilled' && !exceptionsResult.value.error
          ? ((exceptionsResult.value.data ?? []) as ExceptionRow[])
          : []

      const inferences: InferenceRow[] =
        inferencesResult.status === 'fulfilled' && !inferencesResult.value.error
          ? ((inferencesResult.value.data ?? []) as InferenceRow[])
          : []

      const policyConflicts: PolicyConflictRow[] =
        conflictsResult.status === 'fulfilled' && !conflictsResult.value.error
          ? ((conflictsResult.value.data ?? []) as PolicyConflictRow[])
          : []

      const retroactiveImpacts: RetroactiveImpactRow[] =
        retroactiveResult.status === 'fulfilled' && !retroactiveResult.value.error
          ? ((retroactiveResult.value.data ?? []) as RetroactiveImpactRow[])
          : []

      const dailyRow: {
        confidence_score:   number | null
        confidence_level:   string | null
        confidence_factors: unknown[] | null
      } | null =
        dailyResult.status === 'fulfilled' && !dailyResult.value.error
          ? (dailyResult.value.data as any) ?? null
          : null

      // ── Build confidence block ──────────────────────────────────────────────
      const confidence = dailyRow
        ? {
            score:   dailyRow.confidence_score   ?? null,
            level:   dailyRow.confidence_level   ?? null,
            factors: dailyRow.confidence_factors ?? [],
          }
        : null

      // ── Derive intelligence_summary ─────────────────────────────────────────
      const hasExceptions      = exceptions.length > 0
      const hasInferences      = inferences.length > 0
      const hasPolicyConflicts = policyConflicts.length > 0
      const hasRetroactive     = retroactiveImpacts.length > 0

      const overallReliability = deriveReliability(confidence?.level)

      // payroll_safe: no unresolved payroll-impacting exceptions AND confidence not 'critical'
      const unresolvedPayrollExceptions = exceptions.filter(
        (e) => e.payroll_impacting && e.status !== 'resolved',
      )
      const payrollSafe = unresolvedPayrollExceptions.length === 0 && confidence?.level !== 'critical'

      // requires_attention: any open exception with severity 'high'/'critical' OR confidence 'critical'
      const hasHighSeverityException = exceptions.some(
        (e) =>
          ['high', 'critical'].includes(e.severity) &&
          e.status !== 'resolved',
      )
      const requiresAttention = hasHighSeverityException || confidence?.level === 'critical'

      // ── Response ────────────────────────────────────────────────────────────
      return reply.send({
        employee_id: employeeId,
        date,
        confidence,
        exceptions: exceptions.map((e) => ({
          id:               e.id,
          type:             e.type,
          category:         e.category ?? null,
          severity:         e.severity,
          status:           e.status,
          payroll_impacting: e.payroll_impacting,
          created_at:       e.created_at,
        })),
        inferences: inferences.map((i) => ({
          id:                i.id,
          type:              i.type,
          reason:            i.reason ?? null,
          confidence_penalty: i.confidence_penalty ?? null,
          explanation:       i.explanation ?? null,
        })),
        policy_conflicts: policyConflicts.map((c) => ({
          id:                 c.id,
          conflict_type:      c.conflict_type,
          policy_a:           c.policy_a ?? null,
          policy_b:           c.policy_b ?? null,
          applied_precedence: c.applied_precedence ?? null,
          explanation:        c.explanation ?? null,
        })),
        retroactive_impacts: retroactiveImpacts.map((r) => ({
          id:             r.id,
          trigger_source: r.trigger_source ?? null,
          impact_types:   r.impact_types   ?? [],
          before_status:  r.before_status  ?? null,
          after_status:   r.after_status   ?? null,
          explanation:    r.explanation    ?? null,
        })),
        intelligence_summary: {
          has_exceptions:          hasExceptions,
          has_inferences:          hasInferences,
          has_policy_conflicts:    hasPolicyConflicts,
          has_retroactive_impact:  hasRetroactive,
          overall_reliability:     overallReliability,
          payroll_safe:            payrollSafe,
          requires_attention:      requiresAttention,
        },
      })
    },
  )
}
