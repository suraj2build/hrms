/**
 * Manager Team Lifecycle Workspace — /manager/team/lifecycle
 *
 * Program 6A · P6.1 + P6.2. One read surface that lets a manager run their team's
 * employment lifecycle without depending on HR for visibility:
 *
 *   • Probation & confirmation — who is on probation, due, overdue
 *   • New joiners              — joining date, onboarding readiness, pending docs
 *   • Expiry risks             — documents / identity / passport / visa / contract
 *   • Separations              — notice period, LWD, clearance + F&F status
 *
 * Nothing is recomputed here. Expiry risk is read from the single Program 3A
 * source (computeLifecycleRisks), readiness from the Readiness Engine, trust from
 * workforce_trust_scores, separations from employee_separation. Every section is
 * scoped to employees.manager_id = caller (HR admins may pass ?manager_employee_id).
 *
 *   GET  /manager/team/lifecycle[?include_readiness=true]   — workspace + rail summary
 *   POST /manager/team/lifecycle/confirmation-recommend     — notify HR (no direct confirm)
 *
 * The manager confirmation action is a RECOMMENDATION only — it raises an inbox
 * item to HR through the existing notification system. HR performs the actual
 * confirmation through the existing job-history workflow. No new workflow engine.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  computeLifecycleRisks, summariseLifecycle, type LifecycleRiskItem,
} from '../../lib/lifecycle-expiry.js'
import { computeReadiness } from '../../lib/readiness-engine.js'
import { notifyHrAdmins } from '../../lib/notify.js'
import { resolveManagerEmployeeId, resolveCallerEmployeeId, isDirectReport } from '../../lib/manager-scope.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const NEW_JOINER_WINDOW_DAYS = 90

const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

export default async function managerTeamLifecycleRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /manager/team/lifecycle ───────────────────────────────────────────────
  fastify.get('/manager/team/lifecycle', auth, async (req: any, reply) => {
    const parsed = z.object({
      manager_employee_id: z.string().uuid().optional(),
      include_readiness:   z.coerce.boolean().optional().default(false),
    }).safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const managerId = await resolveManagerEmployeeId(fastify.supabase, req, parsed.data.manager_employee_id)
    if (!managerId) return reply.send(emptyLifecycle(null))

    // All reports (any status — separations cover on-notice / separated staff).
    const { data: reports, error: repErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, joining_date, status')
      .eq('tenant_id', req.tenantId)
      .eq('manager_id', managerId)
    if (repErr) return serverError(req, reply, repErr, ErrorCode.QUERY_FAILED, 'Failed to fetch team')
    if (!reports?.length) return reply.send(emptyLifecycle(managerId))

    const teamIds  = reports.map((e: any) => e.id as string)
    const nameOf   = new Map(reports.map((e: any) => [e.id, `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.employee_code || e.id.slice(0, 8)]))
    const codeOf   = new Map(reports.map((e: any) => [e.id, e.employee_code ?? null]))
    const joinOf   = new Map(reports.map((e: any) => [e.id, e.joining_date ?? null]))
    const teamIdSet = new Set(teamIds)

    // ── Parallel reads — every source already exists ────────────────────────────
    const joinerCutoff = isoDaysAgo(NEW_JOINER_WINDOW_DAYS)
    const [lifecycleAll, jobHistoryRes, separationsRes, trustScoresRes] = await Promise.all([
      // Program 3A — the single expiry source, then filter to the team.
      computeLifecycleRisks(fastify.supabase, req.tenantId, { withinDays: 90 }),
      // Probation status from current job_history rows.
      fastify.supabase
        .from('job_history')
        .select('employee_id, employment_type, confirmation_date')
        .eq('tenant_id', req.tenantId).eq('is_current', true)
        .in('employee_id', teamIds),
      // Active separations for the team.
      fastify.supabase
        .from('employee_separation')
        .select('id, employee_id, separation_type, notice_date, last_working_date, exit_reason, clearance_done, lifecycle_stage, approval_status')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', teamIds),
      // Trust risk for the team (lowest scores / high-severity first).
      fastify.supabase
        .from('workforce_trust_scores')
        .select('entity_id, score, severity, factors, computed_at')
        .eq('tenant_id', req.tenantId).eq('score_type', 'employee')
        .in('entity_id', teamIds),
    ])
    // Each of these previously used `.then(r => r.data ?? [])`, silently
    // discarding r.error and turning a genuine DB failure into "this team has
    // no probation/separation/trust-risk items" — indistinguishable from a
    // real empty result on this manager-facing lifecycle dashboard.
    if (jobHistoryRes.error)    return serverError(req, reply, jobHistoryRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch job history')
    if (separationsRes.error)  return serverError(req, reply, separationsRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch separations')
    if (trustScoresRes.error) return serverError(req, reply, trustScoresRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch trust scores')
    const jobHistory   = jobHistoryRes.data ?? []
    const separations  = separationsRes.data ?? []
    const trustScores  = trustScoresRes.data ?? []

    const teamLifecycle = lifecycleAll.filter((i: LifecycleRiskItem) => teamIdSet.has(i.employee_id))

    // ── Probation & confirmation ───────────────────────────────────────────────
    const onProbationIds = new Set<string>(
      (jobHistory as any[])
        .filter(j => j.employment_type === 'probation' && !j.confirmation_date)
        .map(j => j.employee_id),
    )
    const probationItems = teamLifecycle.filter(i => i.category === 'probation')
    const confirmationOverdue = probationItems.filter(i => i.bucket === 'overdue')
    const confirmationDue     = probationItems.filter(i => i.bucket !== 'overdue')
    const overdueIds = new Set(confirmationOverdue.map(i => i.employee_id))
    const dueIds     = new Set(confirmationDue.map(i => i.employee_id))
    const onProbation = [...onProbationIds].map(id => ({
      employee_id: id,
      name:        nameOf.get(id) ?? id.slice(0, 8),
      employee_code: codeOf.get(id) ?? null,
      joining_date:  joinOf.get(id) ?? null,
      confirmation_state: overdueIds.has(id) ? 'overdue' : dueIds.has(id) ? 'due' : 'on_track',
    }))

    // ── Expiry risks (non-probation lifecycle categories) ──────────────────────
    const expiryItems = teamLifecycle.filter(i => i.category !== 'probation')
    const expirySummary = summariseLifecycle(expiryItems)

    // ── Separations ────────────────────────────────────────────────────────────
    const sepRows = separations as any[]
    let managerClearances: Record<string, { id: string; status: string }> = {}
    if (sepRows.length) {
      const sepEmpIds = sepRows.map(s => s.employee_id)
      const { data: clr, error: clrError } = await fastify.supabase
        .from('separation_clearances')
        .select('id, employee_id, department, status')
        .eq('tenant_id', req.tenantId)
        .eq('department', 'manager')
        .in('employee_id', sepEmpIds)
      if (clrError) return serverError(req, reply, clrError, ErrorCode.QUERY_FAILED, 'Failed to fetch manager clearances')
      for (const c of (clr ?? []) as any[]) {
        managerClearances[c.employee_id] = { id: c.id, status: c.status }
      }
    }
    const separationList = sepRows.map(s => ({
      employee_id:       s.employee_id,
      name:              nameOf.get(s.employee_id) ?? s.employee_id.slice(0, 8),
      employee_code:     codeOf.get(s.employee_id) ?? null,
      separation_type:   s.separation_type,
      notice_date:       s.notice_date,
      last_working_date: s.last_working_date,
      exit_reason:       s.exit_reason,
      lifecycle_stage:   s.lifecycle_stage,
      approval_status:   s.approval_status,
      clearance_done:    s.clearance_done,
      manager_clearance: managerClearances[s.employee_id] ?? null,
    }))
    const activeSeparations = separationList.filter(s => s.lifecycle_stage !== 'relieved' && s.lifecycle_stage !== 'archived')
    const pendingManagerClearance = activeSeparations.filter(
      s => s.manager_clearance && s.manager_clearance.status === 'pending',
    ).length

    // ── Trust risk ─────────────────────────────────────────────────────────────
    const trustRisks = (trustScores as any[])
      .filter(t => t.severity === 'high' || t.severity === 'critical')
      .sort((a, b) => Number(a.score ?? 0) - Number(b.score ?? 0))
      .map(t => ({
        employee_id:   t.entity_id,
        name:          nameOf.get(t.entity_id) ?? t.entity_id.slice(0, 8),
        employee_code: codeOf.get(t.entity_id) ?? null,
        score:         t.score != null ? Number(t.score) : null,
        severity:      t.severity,
        reason:        firstFactorReason(t.factors),
      }))

    // ── New joiners (+ optional readiness) ─────────────────────────────────────
    const joinerReports = reports.filter((e: any) => e.joining_date && e.joining_date >= joinerCutoff && e.status === 'active')
    let newJoiners: any[] = joinerReports.map((e: any) => ({
      employee_id:    e.id,
      name:           nameOf.get(e.id),
      employee_code:  e.employee_code ?? null,
      joining_date:   e.joining_date,
      readiness_pct:  null as number | null,
      readiness_status: null as string | null,
      pending_items:  null as number | null,
    }))
    if (parsed.data.include_readiness && joinerReports.length) {
      newJoiners = await Promise.all(joinerReports.map(async (e: any) => {
        let readiness_pct: number | null = null
        let readiness_status: string | null = null
        let pending_items: number | null = null
        try {
          const r = await computeReadiness(fastify.supabase, { tenantId: req.tenantId, employeeId: e.id })
          readiness_pct    = r.overall_score
          readiness_status = r.status
          pending_items    = r.blocking_items.length
        } catch { /* no onboarding context — leave readiness null */ }
        return {
          employee_id:   e.id,
          name:          nameOf.get(e.id),
          employee_code: e.employee_code ?? null,
          joining_date:  e.joining_date,
          readiness_pct,
          readiness_status,
          pending_items,
        }
      }))
    }

    // ── Rail summary (P6.2) ────────────────────────────────────────────────────
    const within7  = (i: LifecycleRiskItem) => i.bucket === 'overdue' || i.bucket === 'due_7'
    const summary = {
      probation: {
        on_probation: onProbation.length,
        due_week:     confirmationDue.filter(within7).length,
        due_month:    confirmationDue.length,
        overdue:      confirmationOverdue.length,
      },
      new_joiners: {
        count:           newJoiners.length,
        pending_readiness: newJoiners.filter(j => j.readiness_status && j.readiness_status !== 'ready').length,
        missing_documents: newJoiners.filter(j => (j.pending_items ?? 0) > 0).length,
      },
      trust: {
        high:   trustRisks.filter(t => t.severity === 'high').length,
        critical: trustRisks.filter(t => t.severity === 'critical').length,
      },
      expiry: {
        documents: expiryItems.filter(i => i.category === 'document' || i.category === 'identity').length,
        contracts: expiryItems.filter(i => i.category === 'contract').length,
        visa:      expiryItems.filter(i => i.category === 'visa' || i.category === 'passport').length,
        overdue:   expirySummary.by_bucket.overdue,
      },
      separation: {
        active:                   activeSeparations.length,
        pending_manager_clearance: pendingManagerClearance,
      },
    }

    return reply.send({
      manager_employee_id: managerId,
      team_size: reports.length,
      probation: {
        on_probation:         onProbation,
        confirmation_due:     confirmationDue.map(toConfirmationRow),
        confirmation_overdue: confirmationOverdue.map(toConfirmationRow),
      },
      new_joiners: newJoiners,
      expiry: { items: expiryItems, summary: expirySummary },
      separations: separationList,
      trust_risks: trustRisks,
      summary,
    })
  })

  // ── POST /manager/team/lifecycle/confirmation-recommend ───────────────────────
  fastify.post('/manager/team/lifecycle/confirmation-recommend', auth, async (req: any, reply) => {
    const parsed = z.object({
      employee_id: z.string().uuid(),
      note:        z.string().max(1000).optional(),
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Only the employee's own manager (or HR) may recommend.
    const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    const isAdmin = req.userRole === 'super_admin' || req.userRole === 'hr_admin'
    if (!isAdmin) {
      if (!myEmpId || !(await isDirectReport(fastify.supabase, req.tenantId, myEmpId, parsed.data.employee_id))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only recommend confirmation for your direct reports' })
      }
    }

    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('id', parsed.data.employee_id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const name = `${(emp as any).first_name ?? ''} ${(emp as any).last_name ?? ''}`.trim() || (emp as any).employee_code

    // Reuse the existing inbox/notification system — no new workflow.
    await notifyHrAdmins(fastify.supabase, {
      tenantId:     req.tenantId,
      senderId:     req.userId,
      item_type:    'approval_request',
      title:        `Confirmation recommended: ${name}`,
      summary:      parsed.data.note?.trim()
        ? `Manager recommends confirming ${name}. Note: ${parsed.data.note.trim()}`
        : `Manager recommends confirming ${name} from probation.`,
      severity:     'info',
      entity_type:  'employees',
      entity_id:    parsed.data.employee_id,
      action_route: `/admin/employees/${parsed.data.employee_id}`,
      action_label: 'Review confirmation',
      metadata:     { kind: 'confirmation_recommendation', recommended_by_employee_id: myEmpId },
    })

    return reply.send({ ok: true, employee_id: parsed.data.employee_id })
  })
}

// ── helpers ────────────────────────────────────────────────────────────────────

function toConfirmationRow(i: LifecycleRiskItem) {
  return {
    employee_id:   i.employee_id,
    name:          i.employee_name,
    employee_code: i.employee_code,
    due_date:      i.due_date,
    days_to_due:   i.days_to_due,
    bucket:        i.bucket,
    severity:      i.severity,
  }
}

function firstFactorReason(factors: unknown): string | null {
  if (Array.isArray(factors) && factors.length) {
    const f = factors[0] as any
    return typeof f === 'string' ? f : (f?.reason ?? f?.label ?? f?.name ?? null)
  }
  return null
}

function emptyLifecycle(managerId: string | null) {
  return {
    manager_employee_id: managerId,
    team_size: 0,
    probation: { on_probation: [], confirmation_due: [], confirmation_overdue: [] },
    new_joiners: [],
    expiry: { items: [], summary: summariseLifecycle([]) },
    separations: [],
    trust_risks: [],
    summary: {
      probation:   { on_probation: 0, due_week: 0, due_month: 0, overdue: 0 },
      new_joiners: { count: 0, pending_readiness: 0, missing_documents: 0 },
      trust:       { high: 0, critical: 0 },
      expiry:      { documents: 0, contracts: 0, visa: 0, overdue: 0 },
      separation:  { active: 0, pending_manager_clearance: 0 },
    },
  }
}
