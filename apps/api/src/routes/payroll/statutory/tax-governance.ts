/**
 * tax-governance.ts — HR Admin Tax Governance & Compliance Routes
 *
 * Provides settings management, compliance dashboards, and component override
 * capabilities for HR administrators.
 *
 * Routes (prefix: /payroll/statutory/tds):
 *   GET  /governance                      — get governance settings for a FY
 *   PUT  /governance                      — upsert governance settings
 *   GET  /compliance                      — compliance dashboard
 *   GET  /components/tenant               — tenant-specific component overrides
 *   PUT  /components/:id/override         — override a system component for this tenant
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../../lib/audit-service.js'

// ── Admin guard ───────────────────────────────────────────────────────────────

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

// ── Helper ────────────────────────────────────────────────────────────────────

function currentFinancialYear(): string {
  const now = new Date()
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${fyYear}-${String(fyYear + 1).slice(2)}`
}

// =============================================================================
export default async function taxGovernanceRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ===========================================================================
  // GET /governance?financial_year=2025-26
  // ===========================================================================
  fastify.get('/governance', adminAuth, async (req: any, reply) => {
    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    const { data, error } = await fastify.supabase
      .from('tds_governance_settings')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null, financial_year: fy })
  })

  // ===========================================================================
  // PUT /governance — upsert governance settings
  // ===========================================================================
  fastify.put('/governance', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      financial_year:        z.string().min(1),
      window_open_date:      z.string().datetime({ offset: true }).optional().nullable(),
      window_close_date:     z.string().datetime({ offset: true }).optional().nullable(),
      window_grace_date:     z.string().datetime({ offset: true }).optional().nullable(),
      window_lock_date:      z.string().datetime({ offset: true }).optional().nullable(),
      default_regime:        z.enum(['old', 'new']).optional().default('new'),
      allow_regime_switching: z.boolean().optional().default(true),
      proof_mandatory:       z.boolean().optional().default(false),
      max_proof_size_mb:     z.number().positive().optional().default(5),
      allowed_proof_formats: z.array(z.string()).optional().default(['pdf', 'jpg', 'jpeg', 'png']),
      component_overrides:   z.record(z.unknown()).optional().nullable(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tds_governance_settings')
      .upsert({
        ...parsed.data,
        tenant_id:  req.tenantId,
        updated_by: req.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,financial_year' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'tds_governance_settings',
      recordId:    (data as any)?.id ?? req.tenantId,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.send({ data })
  })

  // ===========================================================================
  // GET /compliance?financial_year=2025-26
  // Compliance dashboard: declarations status, proof review queue, risk flags
  // ===========================================================================
  fastify.get('/compliance', adminAuth, async (req: any, reply) => {
    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    // Parallel queries for compliance metrics
    const [
      activeEmpResult,
      declResult,
      proofResult,
      regimeResult,
    ] = await Promise.all([
      // Total active employees
      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),

      // All declarations for this FY grouped by status
      fastify.supabase
        .from('tax_declarations')
        .select('id, employee_id, status, declaration_category, declared_amount, approved_amount')
        .eq('tenant_id', req.tenantId)
        .eq('financial_year', fy),

      // Proofs not yet verified
      fastify.supabase
        .from('declaration_proofs')
        .select(`
          id, document_state, uploaded_at,
          tax_declarations!inner (
            id, employee_id, financial_year, declaration_category
          )
        `)
        .eq('tenant_id', req.tenantId)
        .eq('is_superseded', false)
        .eq('tax_declarations.financial_year', fy)
        .not('document_state', 'eq', 'verified'),

      // Regime elections for FY
      fastify.supabase
        .from('tax_regime_elections')
        .select('employee_id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('financial_year', fy),
    ])

    const totalEmployees         = activeEmpResult.count ?? 0
    const declarations           = (declResult.data as any[]) ?? []
    const pendingProofs          = (proofResult.data as any[]) ?? []
    const employeesWithRegime    = regimeResult.count ?? 0

    // Unique employee IDs who have submitted declarations
    const submittedOrApproved   = declarations.filter((d: any) => ['submitted','under_review','approved','payroll_applied'].includes(d.status))
    const uniqueSubmitters      = new Set(submittedOrApproved.map((d: any) => d.employee_id))
    const declarationsSubmitted = uniqueSubmitters.size
    const declarationsPending   = Math.max(0, totalEmployees - declarationsSubmitted)

    // Proof breakdown
    const proofsRejected        = pendingProofs.filter((p: any) => p.document_state === 'rejected').length
    const proofsAwaitingReview  = pendingProofs.filter((p: any) => ['uploaded', 'under_review'].includes(p.document_state)).length

    // No regime elected
    const noRegimeElected       = Math.max(0, totalEmployees - employeesWithRegime)

    // High-risk employees: high declared amounts not yet approved
    const HIGH_AMOUNT_THRESHOLD = 200_000
    const highRiskDecls = declarations.filter(
      (d: any) => ['declared', 'submitted'].includes(d.status) && (d.declared_amount ?? 0) > HIGH_AMOUNT_THRESHOLD,
    )
    const highRiskEmployeeIds = new Set(highRiskDecls.map((d: any) => d.employee_id))

    // Aggregate total declared amount + top category per high-risk employee
    const highRiskAmountMap = new Map<string, { amount: number; category: string }>()
    for (const d of highRiskDecls) {
      const prev = highRiskAmountMap.get(d.employee_id)
      highRiskAmountMap.set(d.employee_id, {
        amount:   (prev?.amount ?? 0) + (d.declared_amount ?? 0),
        category: prev?.category ?? (d.declaration_category ?? 'Various'),
      })
    }

    // Build high-risk list (fetch names in one query if any)
    let riskItems: any[] = []
    if (highRiskEmployeeIds.size > 0) {
      const { data: empData } = await fastify.supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name')
        .eq('tenant_id', req.tenantId)
        .in('id', Array.from(highRiskEmployeeIds))
        .limit(50)

      riskItems = ((empData as any[]) ?? []).map((e: any) => {
        const info = highRiskAmountMap.get(e.id)
        return {
          employee_id:      e.id,
          employee_name:    `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.id,
          employee_code:    e.employee_code ?? null,
          section:          info?.category ?? 'Various',
          declared_amount:  info?.amount ?? 0,
          risk_reason:      'High declared amount pending approval',
          risk_level:       'high',
        }
      })
    }

    // Declaration status breakdown (kept for backwards-compat / future use)
    const statusCounts: Record<string, number> = {}
    for (const d of declarations) {
      statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1
    }

    // Total declared vs approved amounts
    const totalDeclared = declarations.reduce((s: number, d: any) => s + (d.declared_amount ?? 0), 0)
    const totalApproved = declarations
      .filter((d: any) => ['approved','payroll_applied'].includes(d.status))
      .reduce((s: number, d: any) => s + (d.approved_amount ?? d.declared_amount ?? 0), 0)

    // Return shape that matches the frontend ComplianceData interface
    return reply.send({
      stats: {
        total_employees:    totalEmployees,
        submitted:          declarationsSubmitted,
        pending:            declarationsPending,
        proofs_under_review: proofsAwaitingReview,
        rejected:           proofsRejected,
      },
      risk_items: riskItems,
      // Extra fields available for future dashboard expansion
      financial_year:               fy,
      no_regime_elected:            noRegimeElected,
      declaration_status_breakdown: statusCounts,
      financials: {
        total_declared:   totalDeclared,
        total_approved:   totalApproved,
        pending_approval: totalDeclared - totalApproved,
      },
    })
  })

  // ===========================================================================
  // GET /components/tenant — list tenant-specific component overrides
  // NOTE: must be registered BEFORE /components/:id routes (static path first)
  // ===========================================================================
  fastify.get('/components/tenant', adminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('tax_declaration_components')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('display_order', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ===========================================================================
  // PUT /components/:id/override — override a system component for this tenant
  // Creates a tenant-specific copy that shadows the system component.
  // ===========================================================================
  fastify.put('/components/:id/override', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Load the system component
    const { data: original, error: origErr } = await fastify.supabase
      .from('tax_declaration_components')
      .select('*')
      .eq('id', id)
      .is('tenant_id', null)   // system component only
      .maybeSingle()

    if (origErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: origErr.message })
    if (!original) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'System component not found (only system components can be overridden)' })
    }

    const schema = z.object({
      display_name:       z.string().min(1).max(255).optional(),
      description:        z.string().nullable().optional(),
      max_limit:          z.number().nonnegative().nullable().optional(),
      proof_required:     z.boolean().optional(),
      is_active:          z.boolean().optional(),
      display_order:      z.number().int().nonnegative().optional(),
      component_overrides: z.record(z.unknown()).optional(),  // arbitrary tenant metadata
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Upsert — if override already exists for this tenant+section_code, update it
    const overrideRecord = {
      section_code:       (original as any).section_code,
      sub_section:        (original as any).sub_section,
      display_name:       parsed.data.display_name        ?? (original as any).display_name,
      description:        parsed.data.description         ?? (original as any).description,
      parent_group:       (original as any).parent_group,
      regime_eligibility: (original as any).regime_eligibility,
      declaration_type:   (original as any).declaration_type,
      max_limit:          parsed.data.max_limit !== undefined ? parsed.data.max_limit : (original as any).max_limit,
      proof_required:     parsed.data.proof_required      ?? (original as any).proof_required,
      is_active:          parsed.data.is_active            ?? (original as any).is_active,
      display_order:      parsed.data.display_order        ?? (original as any).display_order,
      tenant_id:          req.tenantId,
      system_component_id: id,   // reference back to the system component being overridden
      updated_at:         new Date().toISOString(),
    }

    const { data: result, error: upsertErr } = await fastify.supabase
      .from('tax_declaration_components')
      .upsert(overrideRecord, { onConflict: 'tenant_id,section_code' })
      .select()
      .single()

    if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })

    return reply.send({
      data: result,
      message: `System component '${(original as any).display_name}' overridden for this tenant`,
    })
  })
}
