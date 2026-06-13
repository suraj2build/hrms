/**
 * Intelligence Routes — AI Workforce OS Phase 1
 *
 * READ-ONLY intelligence layer. Every endpoint queries existing source tables
 * and derives insights. No writes to source-of-truth tables.
 * All narratives are deterministic rule-based text — no LLM calls.
 * All routes are tenant-isolated via req.tenantId.
 */
import type { FastifyInstance } from 'fastify'
import { computeUpcoming } from '../../lib/compliance-calendar.js'

interface SourceRecord { table: string; count: number; sample?: string }

interface Observation {
  id: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'info'
  title: string
  body: string
  source_records: SourceRecord[]
  generated_at: string
}

function buildSummary(obs: Observation[]): string {
  const critical = obs.filter(o => o.severity === 'critical').length
  const high     = obs.filter(o => o.severity === 'high').length
  const total    = obs.length
  if (total === 0) return 'All workforce signals are within normal range. No action required.'
  const parts: string[] = []
  if (critical > 0) parts.push(critical + ' critical item' + (critical > 1 ? 's' : '') + ' require immediate attention')
  if (high > 0)     parts.push(high + ' high-priority item' + (high > 1 ? 's' : '') + ' need review')
  const rest = total - critical - high
  if (rest > 0)     parts.push(rest + ' informational signal' + (rest > 1 ? 's' : '') + ' noted')
  return parts.join('. ') + '.'
}

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 }

export default async function intelligenceRoutes(fastify: FastifyInstance) {

  // ── GET /intelligence/workforce-command ─────────────────────────────────────
  fastify.get('/workforce-command', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const observations: Observation[] = []
    const now           = new Date()
    const sevenDaysAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString()
    const threeDaysAgo  = new Date(now.getTime() - 3  * 24 * 60 * 60 * 1000).toISOString()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)

    try {
      // 1. Employees missing joining_date
      const { data: noJoin } = await fastify.supabase
        .from('employees').select('id, first_name, last_name')
        .eq('tenant_id', tenantId).eq('status', 'active').is('joining_date', null).limit(50)
      if (noJoin && noJoin.length > 0) {
        observations.push({
          id: 'missing-joining-date', category: 'onboarding',
          severity: noJoin.length > 3 ? 'high' : 'medium',
          title: noJoin.length + ' active employee' + (noJoin.length > 1 ? 's' : '') + ' missing joining date',
          body: 'Active employees without a joining date cannot be included in payroll processing or leave accrual. Update their profiles to ensure accurate records.',
          source_records: [{ table: 'employees', count: noJoin.length, sample: noJoin.slice(0, 3).map((e: any) => e.first_name + ' ' + e.last_name).join(', ') }],
          generated_at: now.toISOString(),
        })
      }

      // 2. Stalled onboarding sessions
      const { data: stalledSessions } = await fastify.supabase
        .from('onboarding_sessions').select('id, candidate_name, status, created_at')
        .eq('tenant_id', tenantId).neq('status', 'employee_created').neq('status', 'rejected')
        .lt('created_at', sevenDaysAgo).limit(50)
      if (stalledSessions && stalledSessions.length > 0) {
        observations.push({
          id: 'stalled-onboarding', category: 'onboarding',
          severity: stalledSessions.length > 5 ? 'high' : 'medium',
          title: stalledSessions.length + ' onboarding session' + (stalledSessions.length > 1 ? 's' : '') + ' stalled over 7 days',
          body: 'Candidates with stalled onboarding sessions have not been converted to employees. Review to complete or reject.',
          source_records: [{ table: 'onboarding_sessions', count: stalledSessions.length, sample: stalledSessions.slice(0, 3).map((s: any) => s.candidate_name || s.id.slice(0,8)).join(', ') }],
          generated_at: now.toISOString(),
        })
      }

      // 3. Separations stalled in intermediate stage > 3 days
      const { data: pendingSep } = await fastify.supabase
        .from('employee_separation').select('id, employee_id, lifecycle_stage, updated_at')
        .eq('tenant_id', tenantId).not('lifecycle_stage', 'in', '("relieved","archived")')
        .lt('updated_at', threeDaysAgo).limit(20)
      if (pendingSep && pendingSep.length > 0) {
        observations.push({
          id: 'pending-separation', category: 'separation',
          severity: pendingSep.length > 2 ? 'high' : 'medium',
          title: pendingSep.length + ' separation' + (pendingSep.length > 1 ? 's' : '') + ' pending action over 3 days',
          body: 'Employee separations in intermediate stages may delay final settlements and asset recovery.',
          source_records: [{ table: 'employee_separation', count: pendingSep.length }],
          generated_at: now.toISOString(),
        })
      }

      // 4. Assets assigned to employees under separation
      const sepEmpIds = (pendingSep ?? []).map((s: any) => s.employee_id as string)
      let assetsAtRiskCount = 0
      if (sepEmpIds.length > 0) {
        // assets.assigned_to is the denormalized current holder; status='assigned'
        const { data: assetRisk } = await fastify.supabase
          .from('assets').select('id, assigned_to')
          .eq('tenant_id', tenantId).eq('status', 'assigned').in('assigned_to', sepEmpIds).limit(50)
        if (assetRisk && assetRisk.length > 0) {
          assetsAtRiskCount = assetRisk.length
          observations.push({
            id: 'assets-at-risk', category: 'assets', severity: 'critical',
            title: assetRisk.length + ' asset' + (assetRisk.length > 1 ? 's' : '') + ' assigned to employees under separation',
            body: 'Company assets remain with employees in the separation process. Must be recovered before final clearance.',
            source_records: [{ table: 'assets', count: assetRisk.length }],
            generated_at: now.toISOString(),
          })
        }
      }

      // 5. Probation overdue
      const { data: probationDue } = await fastify.supabase
        .from('employees').select('id, first_name, last_name, joining_date')
        .eq('tenant_id', tenantId).eq('status', 'active').lte('joining_date', ninetyDaysAgo).limit(50)
      if (probationDue && probationDue.length > 0) {
        observations.push({
          id: 'probation-review-due', category: 'compliance',
          severity: probationDue.length > 5 ? 'high' : 'medium',
          title: probationDue.length + ' employee' + (probationDue.length > 1 ? 's' : '') + ' eligible for probation confirmation',
          body: 'These employees joined more than 90 days ago and may be due for probation confirmation.',
          source_records: [{ table: 'employees', count: probationDue.length, sample: probationDue.slice(0, 3).map((e: any) => e.first_name + ' ' + e.last_name).join(', ') }],
          generated_at: now.toISOString(),
        })
      }

      // 6. O3 — Sessions with no documents uploaded > 24h (missing mandatory docs)
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const { data: emptyDocSessions } = await fastify.supabase
        .from('onboarding_sessions')
        .select('id, candidate_name, created_at')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'extracting'])
        .lt('created_at', oneDayAgo)
        .limit(50)
      // Filter: sessions with zero documents
      let noDocCount = 0
      const noDocSamples: string[] = []
      if (emptyDocSessions && emptyDocSessions.length > 0) {
        for (const s of emptyDocSessions as any[]) {
          const { count: docCount } = await fastify.supabase
            .from('onboarding_documents').select('id', { count: 'exact', head: true })
            .eq('session_id', s.id).eq('tenant_id', tenantId)
          if ((docCount ?? 0) === 0) {
            noDocCount++
            if (noDocSamples.length < 3) noDocSamples.push(s.candidate_name || s.id.slice(0, 8))
          }
        }
      }
      if (noDocCount > 0) {
        observations.push({
          id: 'readiness-missing-documents', category: 'onboarding',
          severity: noDocCount > 3 ? 'high' : 'medium',
          title: noDocCount + ' onboarding session' + (noDocCount > 1 ? 's' : '') + ' missing documents (>24h)',
          body: 'Candidates have not uploaded any documents more than 24 hours after session creation. Documents are required to proceed with extraction and approval.',
          source_records: [{ table: 'onboarding_sessions', count: noDocCount, sample: noDocSamples.join(', ') }],
          generated_at: now.toISOString(),
        })
      }

      // 7. O3 — Sessions in hr_review > 3 days (approvals over SLA)
      const { data: slaBreached } = await fastify.supabase
        .from('onboarding_sessions')
        .select('id, candidate_name')
        .eq('tenant_id', tenantId)
        .in('status', ['hr_review', 'validation_pending'])
        .lt('updated_at', threeDaysAgo)
        .limit(50)
      if (slaBreached && slaBreached.length > 0) {
        observations.push({
          id: 'readiness-approval-sla', category: 'onboarding',
          severity: slaBreached.length > 3 ? 'high' : 'medium',
          title: slaBreached.length + ' onboarding approval' + (slaBreached.length > 1 ? 's' : '') + ' pending > 3 days',
          body: 'Onboarding sessions awaiting HR review or validation for more than 3 days. Delayed approvals block employee joining and onboarding checklist assignment.',
          source_records: [{ table: 'onboarding_sessions', count: slaBreached.length, sample: (slaBreached as any[]).slice(0, 3).map((s: any) => s.candidate_name || s.id.slice(0, 8)).join(', ') }],
          generated_at: now.toISOString(),
        })
      }

      // 8. O3 — Employees with incomplete checklists > 14 days post-approval
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const { data: overdueChecklists } = await fastify.supabase
        .from('employee_onboarding_checklists')
        .select('id, employee_id')
        .eq('tenant_id', tenantId)
        .neq('status', 'completed')
        .lt('start_date', fourteenDaysAgo.slice(0, 10))
        .limit(50)
      if (overdueChecklists && overdueChecklists.length > 0) {
        observations.push({
          id: 'readiness-checklist-overdue', category: 'onboarding',
          severity: overdueChecklists.length > 5 ? 'high' : 'medium',
          title: overdueChecklists.length + ' onboarding checklist' + (overdueChecklists.length > 1 ? 's' : '') + ' overdue (>14 days)',
          body: 'Employees have incomplete onboarding checklists more than 14 days after checklist assignment. Incomplete checklists reduce onboarding readiness scores.',
          source_records: [{ table: 'employee_onboarding_checklists', count: overdueChecklists.length }],
          generated_at: now.toISOString(),
        })
      }

      // KPIs (existing + O3 readiness KPIs derived from session status)
      const { count: activeCount }      = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active')
      const { count: joinersThisMonth } = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('joining_date', monthStart)
      const { count: onNotice }         = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'on_notice')

      // O3 readiness distribution — derived from session status (no per-employee score computation)
      const { count: readyCount }   = await fastify.supabase.from('onboarding_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'employee_created')
      const { count: rejCount }     = await fastify.supabase.from('onboarding_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'rejected')
      const { count: activeOnb }    = await fastify.supabase.from('onboarding_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('status', 'in', '("employee_created","rejected","archived")')
      const readyPct   = (readyCount ?? 0) + (rejCount ?? 0) + (activeOnb ?? 0) > 0
        ? Math.round(((readyCount ?? 0) / ((readyCount ?? 0) + (rejCount ?? 0) + (activeOnb ?? 0))) * 100)
        : null

      // ── Compliance filing deadlines (single source: ComplianceCalendarService)
      try {
        const upcoming = await computeUpcoming(fastify.supabase, tenantId, 7)
        const overdue = upcoming.filter(d => d.status === 'overdue')
        const due3    = upcoming.filter(d => d.status !== 'overdue' && d.days_to_due <= 3)
        const due7    = upcoming.filter(d => d.status !== 'overdue' && d.days_to_due > 3 && d.days_to_due <= 7)
        const sample  = (arr: typeof upcoming) => arr.slice(0, 3).map(d => `${d.label} — due ${d.due_date}${d.status === 'overdue' ? ` (${Math.abs(d.days_to_due)}d late)` : ` (${d.days_to_due}d)`}`).join('; ')
        if (overdue.length) {
          observations.push({
            id: 'compliance-overdue', category: 'compliance', severity: 'critical',
            title: `${overdue.length} statutory filing${overdue.length > 1 ? 's' : ''} overdue`,
            body: `Overdue filings risk penalties and interest. Most overdue: ${overdue[0].label} (${Math.abs(overdue[0].days_to_due)} days late, due ${overdue[0].due_date}). Recommended action: file immediately and record the challan reference.`,
            source_records: [{ table: 'compliance_calendar', count: overdue.length, sample: sample(overdue) }],
            generated_at: now.toISOString(),
          })
        }
        if (due3.length) {
          observations.push({
            id: 'compliance-due-3', category: 'compliance', severity: 'high',
            title: `${due3.length} statutory filing${due3.length > 1 ? 's' : ''} due within 3 days`,
            body: `Filings due imminently. Next: ${due3[0].label} due ${due3[0].due_date} (${due3[0].days_to_due} day${due3[0].days_to_due === 1 ? '' : 's'} remaining). Recommended action: finalise figures and file before the due date.`,
            source_records: [{ table: 'compliance_calendar', count: due3.length, sample: sample(due3) }],
            generated_at: now.toISOString(),
          })
        }
        if (due7.length) {
          observations.push({
            id: 'compliance-due-7', category: 'compliance', severity: 'medium',
            title: `${due7.length} statutory filing${due7.length > 1 ? 's' : ''} due within 7 days`,
            body: `Upcoming statutory deadlines. Recommended action: prepare the returns and challans this week. ${sample(due7)}.`,
            source_records: [{ table: 'compliance_calendar', count: due7.length, sample: sample(due7) }],
            generated_at: now.toISOString(),
          })
        }
      } catch { /* compliance scan is best-effort; never break the command view */ }

      observations.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))

      return reply.send({
        data: {
          summary:        buildSummary(observations),
          critical_count: observations.filter(o => o.severity === 'critical').length,
          high_count:     observations.filter(o => o.severity === 'high').length,
          observations,
          kpis: {
            active_headcount:           activeCount              ?? 0,
            joiners_this_month:         joinersThisMonth         ?? 0,
            on_notice:                  onNotice                 ?? 0,
            stalled_onboarding:         stalledSessions?.length  ?? 0,
            pending_separations:        pendingSep?.length        ?? 0,
            assets_at_risk:             assetsAtRiskCount,
            probation_due:              probationDue?.length      ?? 0,
            // O3 readiness KPIs
            onboarding_ready:           readyCount               ?? 0,
            onboarding_blocked:         rejCount                 ?? 0,
            onboarding_in_progress:     activeOnb                ?? 0,
            onboarding_ready_pct:       readyPct,
            onboarding_approval_sla:    slaBreached?.length       ?? 0,
            onboarding_checklist_overdue: overdueChecklists?.length ?? 0,
          },
          generated_at: now.toISOString(),
        },
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/workforce-command error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/manager-summary ────────────────────────────────────────
  fastify.get('/manager-summary', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const now = new Date()
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const { data: profile } = await fastify.supabase.from('profiles').select('employee_id').eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
      const managerId: string | null = profile?.employee_id ?? null
      const { data: teamData } = managerId
        ? await fastify.supabase.from('employees').select('id, first_name, last_name, status, joining_date').eq('tenant_id', tenantId).eq('manager_id', managerId).eq('status', 'active').limit(100)
        : { data: [] as any[] }
      const team       = teamData ?? []
      const teamSize   = team.length
      const teamIds    = team.map((e: any) => e.id as string)
      const newJoiners = team.filter((e: any) => e.joining_date && e.joining_date >= monthStart).length
      const probDue    = team.filter((e: any) => e.joining_date && e.joining_date <= ninetyDaysAgo).length
      // Pending leave for the team: leave_requests are not assigned an approver until
      // actioned, so count PENDING requests raised by the manager's direct reports.
      let pendingLeave = 0
      if (teamIds.length > 0) {
        const { count } = await fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('employee_id', teamIds).eq('status', 'PENDING')
        pendingLeave = count ?? 0
      }
      const parts: string[] = []
      if (teamSize === 0) {
        parts.push('No direct reports assigned.')
      } else {
        parts.push('Your team has ' + teamSize + ' active member' + (teamSize > 1 ? 's' : '') + '.')
        if (newJoiners > 0) parts.push(newJoiners + ' new joiner' + (newJoiners > 1 ? 's' : '') + ' this month.')
        if (probDue > 0)    parts.push(probDue + ' member' + (probDue > 1 ? 's' : '') + ' eligible for probation confirmation.')
        if (pendingLeave > 0) parts.push(pendingLeave + ' leave request' + (pendingLeave > 1 ? 's' : '') + ' pending approval.')
        if (probDue === 0 && pendingLeave === 0) parts.push('No compliance concerns detected.')
      }
      return reply.send({ data: { summary: parts.join(' '), team_size: teamSize, new_joiners_this_month: newJoiners, probation_due: probDue, pending_leave_approvals: pendingLeave, generated_at: now.toISOString() } })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/manager-summary error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/executive-narrative?month=YYYY-MM ──────────────────────
  fastify.get('/executive-narrative', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()
    const monthParam    = ((req.query as any).month as string) || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'))
    const [yr, mo]      = monthParam.split('-').map(Number)
    const periodStart   = new Date(yr, mo - 1, 1).toISOString().slice(0, 10)
    const periodEnd     = new Date(yr, mo, 0).toISOString().slice(0, 10)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const { count: h }  = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active')
      const { count: j }  = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('joining_date', periodStart).lte('joining_date', periodEnd)
      const { count: e }  = await fastify.supabase.from('employee_separation').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', periodStart)
      const { count: pb } = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active').lte('joining_date', ninetyDaysAgo)
      const headcount = h ?? 0, joiners = j ?? 0, exits = e ?? 0, probBacklog = pb ?? 0
      const parts: string[] = []
      parts.push('Total active headcount stands at ' + headcount + ' employee' + (headcount !== 1 ? 's' : '') + '.')
      if (joiners > 0)     parts.push(joiners + ' employee' + (joiners > 1 ? 's' : '') + ' joined this period.')
      if (exits > 0)       parts.push(exits + ' employee' + (exits > 1 ? 's' : '') + ' exited this period.')
      if (probBacklog > 0) parts.push(probBacklog + ' employee' + (probBacklog > 1 ? 's' : '') + ' in the probation backlog — confirmation overdue.')
      if (probBacklog === 0 && exits === 0) parts.push('No exits or probation concerns this period.')
      const metrics = { headcount, joiners, exits, probation_backlog: probBacklog, net_change: joiners - exits, period: monthParam }
      await fastify.supabase.from('intelligence_digest').upsert({ tenant_id: tenantId, period_type: 'monthly', period_start: periodStart, period_end: periodEnd, narrative: parts.join(' '), metrics, generated_at: now.toISOString() }, { onConflict: 'tenant_id,period_type,period_start' })
      return reply.send({ data: { narrative: parts.join(' '), metrics, period_start: periodStart, period_end: periodEnd, generated_at: now.toISOString() } })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/executive-narrative error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/employee/:id/360 ──────────────────────────────────────
  fastify.get('/employee/:id/360', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id: employeeId } = req.params as { id: string }
    // employees can only view their own 360
    if (req.userRole === 'employee') {
      const { data: prof } = await fastify.supabase.from('profiles').select('employee_id').eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
      if (!prof || prof.employee_id !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    try {
      const now           = new Date()
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      const sources: string[] = []

      // ── employees (lean schema — no department_id; that lives in job_history) ──
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code, status, joining_date')
        .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
      if (!emp) return reply.code(404).send({ error: 'NOT_FOUND' })
      sources.push('employees')

      const joiningDate  = emp.joining_date ? new Date(emp.joining_date) : null
      const tenureDays   = joiningDate ? Math.floor((now.getTime() - joiningDate.getTime()) / (1000 * 60 * 60 * 24)) : null
      const probationDue = joiningDate ? joiningDate < ninetyDaysAgo && emp.status === 'active' : false

      // ── employee_separation (timestamp column is created_at, not initiated_at) ──
      const { data: sep } = await fastify.supabase
        .from('employee_separation')
        .select('lifecycle_stage, created_at, last_working_date')
        .eq('employee_id', employeeId).eq('tenant_id', tenantId).maybeSingle()
      if (sep) sources.push('employee_separation')

      // ── assets (current holder = assets.assigned_to; status='assigned') ──
      const { data: assetRows, count: assetCount } = await fastify.supabase
        .from('assets')
        .select('id, name, asset_code, category_id', { count: 'exact' })
        .eq('assigned_to', employeeId).eq('tenant_id', tenantId).eq('status', 'assigned').limit(50)
      if ((assetCount ?? 0) > 0) sources.push('assets')

      // ── onboarding (linked via draft_employee_profiles.linked_employee_id → session) ──
      let onboarding: { status: string } | null = null
      try {
        const { data: draftLink } = await fastify.supabase
          .from('draft_employee_profiles')
          .select('status, session_id')
          .eq('tenant_id', tenantId).eq('linked_employee_id', employeeId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (draftLink) { onboarding = { status: draftLink.status }; sources.push('draft_employee_profiles') }
      } catch (_) { /* skip */ }

      // ── leave balances (table is employee_leave_balance) ──
      let leavePayload: { balances: { leave_type: string; balance: number; used: number }[] } | null = null
      try {
        const { data: leavRows, error: leaveErr } = await fastify.supabase
          .from('employee_leave_balance')
          .select('leave_type_id, balance, year')
          .eq('employee_id', employeeId).eq('tenant_id', tenantId).limit(20)
        if (!leaveErr && leavRows && leavRows.length > 0) {
          leavePayload = { balances: leavRows.map((r: any) => ({ leave_type: r.leave_type_id, balance: Number(r.balance ?? 0), used: 0 })) }
          sources.push('employee_leave_balance')
        }
      } catch (_) { /* skip */ }

      // ── compensation (table is employee_compensations, plural; current = is_active) ──
      let compensationPayload: { ctc_annual: number; effective_from: string } | null = null
      try {
        const { data: comp, error: compErr } = await fastify.supabase
          .from('employee_compensations')
          .select('ctc_annual, effective_from')
          .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('is_active', true)
          .order('effective_from', { ascending: false }).limit(1).maybeSingle()
        if (!compErr && comp) {
          compensationPayload = { ctc_annual: Number(comp.ctc_annual ?? 0), effective_from: comp.effective_from }
          sources.push('employee_compensations')
        }
      } catch (_) { /* skip */ }

      // ── job_history for current department/designation (is_current row) ──
      let currentDept: string | null = null
      let currentDesignation: string | null = null
      try {
        const { data: jh, error: jhErr } = await fastify.supabase
          .from('job_history')
          .select('department_id, designation_id, is_current')
          .eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('is_current', true)
          .limit(1).maybeSingle()
        if (!jhErr && jh) {
          if (jh.department_id)   currentDept = jh.department_id
          if (jh.designation_id)  currentDesignation = jh.designation_id
          sources.push('job_history')
        }
      } catch (_) { /* skip */ }

      // ── build deterministic summary ──
      const summaryParts: string[] = []
      if (emp.status === 'active')   summaryParts.push('Active employee' + (tenureDays !== null ? ' with ' + tenureDays + ' day' + (tenureDays !== 1 ? 's' : '') + ' tenure.' : '.'))
      else                           summaryParts.push('Employee status: ' + emp.status + '.')
      if (sep)                       summaryParts.push('Separation in progress — stage: ' + sep.lifecycle_stage.replace(/_/g, ' ') + '.')
      if (probationDue)              summaryParts.push('Probation confirmation overdue.')
      if ((assetCount ?? 0) > 0)     summaryParts.push((assetCount ?? 0) + ' company asset' + ((assetCount ?? 0) > 1 ? 's' : '') + ' assigned.')
      if (onboarding && onboarding.status !== 'employee_created') summaryParts.push('Onboarding status: ' + onboarding.status.replace(/_/g, ' ') + '.')
      if (!sep && !probationDue && (!assetCount || assetCount === 0)) summaryParts.push('No compliance concerns detected.')

      return reply.send({
        data: {
          employee: {
            id:           emp.id,
            name:         emp.first_name + ' ' + emp.last_name,
            code:         emp.employee_code,
            status:       emp.status,
            joining_date: emp.joining_date ?? null,
            tenure_days:  tenureDays,
            department_id: currentDept,
            designation:  currentDesignation,
          },
          compliance: {
            probation_due:    probationDue,
            separation_stage: sep?.lifecycle_stage ?? null,
            assets_assigned:  assetCount ?? 0,
            assets:           assetRows ?? [],
          },
          compensation: compensationPayload,
          leave:        leavePayload,
          attendance_signal: null, // Phase 2 will populate
          onboarding:   onboarding ? { status: onboarding.status, completed_at: null } : null,
          summary:      summaryParts.join(' '),
          generated_at: now.toISOString(),
          sources,
        },
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/employee 360 error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/employee/:id/insights ──────────────────────────────────
  fastify.get('/employee/:id/insights', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { id: employeeId } = req.params as { id: string }
    if (req.userRole === 'employee') {
      const { data: prof } = await fastify.supabase.from('profiles').select('employee_id').eq('id', req.userId).eq('tenant_id', tenantId).maybeSingle()
      if (!prof || prof.employee_id !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    try {
      const now           = new Date()
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      const { data: emp } = await fastify.supabase.from('employees').select('id, first_name, last_name, status, joining_date, employee_code').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
      if (!emp) return reply.code(404).send({ error: 'NOT_FOUND' })
      const { data: sep }     = await fastify.supabase.from('employee_separation').select('lifecycle_stage, created_at').eq('employee_id', employeeId).eq('tenant_id', tenantId).maybeSingle()
      const { count: assets } = await fastify.supabase.from('assets').select('id', { count: 'exact', head: true }).eq('assigned_to', employeeId).eq('tenant_id', tenantId).eq('status', 'assigned')
      const joiningDate  = emp.joining_date ? new Date(emp.joining_date) : null
      const probationDue = joiningDate ? joiningDate < ninetyDaysAgo && emp.status === 'active' : false
      const parts: string[] = []
      if (emp.status === 'active') parts.push('Active employee.')
      if (sep)           parts.push('Separation in progress — stage: ' + sep.lifecycle_stage.replace(/_/g, ' ') + '.')
      if (probationDue)  parts.push('Probation confirmation due.')
      if (assets && assets > 0) parts.push(assets + ' company asset' + (assets > 1 ? 's' : '') + ' assigned.')
      if (!sep && !probationDue && (!assets || assets === 0)) parts.push('No compliance concerns detected.')
      return reply.send({ data: { employee: { id: emp.id, name: emp.first_name + ' ' + emp.last_name, code: emp.employee_code, status: emp.status, joining_date: emp.joining_date }, summary: parts.join(' '), separation: sep ?? null, assigned_assets: assets ?? 0, probation_due: probationDue, generated_at: now.toISOString() } })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/employee insights error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/org/departments ──────────────────────────────────────
  fastify.get('/org/departments', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()
    const thirtyDaysAgo   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const ninetyDaysAgo   = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      // Active employees (lean schema — no department on employees)
      let empRows: any[] = []
      try {
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, joining_date')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .limit(2000)
        empRows = data ?? []
      } catch (_e) { empRows = [] }

      // Department comes from the current job_history row (is_current=true) + departments join
      const empToDept = new Map<string, { id: string; name: string }>()
      try {
        const { data: jh } = await fastify.supabase
          .from('job_history')
          .select('employee_id, department_id, departments(id, name)')
          .eq('tenant_id', tenantId)
          .eq('is_current', true)
          .limit(5000)
        for (const r of jh ?? []) {
          const dep: any = r.departments
          if (r.department_id) empToDept.set(r.employee_id, { id: r.department_id, name: dep?.name ?? 'Unknown' })
        }
      } catch (_e) { /* skip */ }

      // Group by department (probation = active and joined > 90 days ago, joining_date proxy)
      const deptMap = new Map<string, { id: string; name: string; empIds: string[]; joiners_30d: number; probation_due: number }>()
      for (const e of empRows) {
        const dep      = empToDept.get(e.id)
        const deptId   = dep?.id ?? '__none__'
        const deptName = dep?.name ?? 'Unassigned'
        if (!deptMap.has(deptId)) deptMap.set(deptId, { id: deptId, name: deptName, empIds: [], joiners_30d: 0, probation_due: 0 })
        const entry = deptMap.get(deptId)!
        entry.empIds.push(e.id)
        if (e.joining_date && e.joining_date >= thirtyDaysAgo) entry.joiners_30d++
        if (e.joining_date && e.joining_date <= ninetyDaysAgo) entry.probation_due++
      }

      // Fetch separations in last 30 days to map exits per department
      let sepRows: any[] = []
      try {
        const { data } = await fastify.supabase
          .from('employee_separation')
          .select('employee_id, updated_at')
          .eq('tenant_id', tenantId)
          .gte('updated_at', thirtyDaysAgo)
        sepRows = data ?? []
      } catch (_e) { sepRows = [] }

      // Build a set: employee_id -> exits count per dept
      const empIdToSep = new Set<string>(sepRows.map((s: any) => s.employee_id))

      // Build response sorted by headcount desc, limit 20
      const departments = Array.from(deptMap.values())
        .map(d => {
          const headcount    = d.empIds.length
          const exits_30d    = d.empIds.filter(id => empIdToSep.has(id)).length
          const parts: string[] = [`${headcount} active employee${headcount !== 1 ? 's' : ''}.`]
          if (d.joiners_30d > 0) parts.push(`${d.joiners_30d} joined in last 30 days.`)
          if (exits_30d > 0) parts.push(`${exits_30d} separation${exits_30d !== 1 ? 's' : ''} in last 30 days.`)
          if (d.probation_due > 0) parts.push(`${d.probation_due} probation confirmation${d.probation_due !== 1 ? 's' : ''} due soon.`)
          if (parts.length === 1) parts.push('No recent activity.')
          return { id: d.id, name: d.name, headcount, joiners_30d: d.joiners_30d, exits_30d, probation_due: d.probation_due, summary_text: parts.join(' ') }
        })
        .sort((a, b) => b.headcount - a.headcount)
        .slice(0, 20)

      return reply.send({ departments })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/org/departments error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/org/headcount-trend ──────────────────────────────────
  fastify.get('/org/headcount-trend', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()

    // Fetch all employees once (lean schema has no termination_date)
    let allEmp: any[] = []
    try {
      const { data } = await fastify.supabase
        .from('employees')
        .select('id, joining_date')
        .eq('tenant_id', tenantId)
        .limit(5000)
      allEmp = data ?? []
    } catch (_e) { allEmp = [] }

    // Separations carry the exit date (last_working_date); fall back to relieved_at
    let allSep: any[] = []
    try {
      const { data } = await fastify.supabase
        .from('employee_separation')
        .select('id, employee_id, last_working_date, relieved_at')
        .eq('tenant_id', tenantId)
        .limit(5000)
      allSep = data ?? []
    } catch (_e) { allSep = [] }

    // employee_id -> exit date (YYYY-MM-DD)
    const empExitDate = new Map<string, string>()
    for (const s of allSep) {
      const exit = s.last_working_date ?? (s.relieved_at ? s.relieved_at.slice(0, 10) : null)
      if (s.employee_id && exit) empExitDate.set(s.employee_id, exit.slice(0, 10))
    }

    const months: { period: string; headcount: number; joiners: number; exits: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d          = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const year       = d.getFullYear()
      const month      = d.getMonth() + 1
      const periodStr  = `${year}-${String(month).padStart(2, '0')}`
      const monthStart = new Date(year, month - 1, 1).toISOString().slice(0, 10)
      const monthEnd   = new Date(year, month, 0).toISOString().slice(0, 10)   // last day of month

      const headcount = allEmp.filter(e => {
        if (!e.joining_date) return false
        const joined = e.joining_date.slice(0, 10)
        const left   = empExitDate.get(e.id) ?? null
        return joined <= monthEnd && (left === null || left > monthEnd)
      }).length

      const joiners = allEmp.filter(e => {
        if (!e.joining_date) return false
        const joined = e.joining_date.slice(0, 10)
        return joined >= monthStart && joined <= monthEnd
      }).length

      const exits = Array.from(empExitDate.values()).filter(d2 => d2 >= monthStart && d2 <= monthEnd).length

      months.push({ period: periodStr, headcount, joiners, exits })
    }
    return reply.send({ months })
  })

  // ── GET /intelligence/action-center ────────────────────────────────────────
  fastify.get('/action-center', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()

    interface ActionObservation {
      id: string
      event_type: string
      title: string
      suggestion: string
      source_table: string
      source_count: number
      generated_at: string
    }

    const observations: ActionObservation[] = []

    try {
      // 1. New employees created in last 48h
      const { data: newEmps, error: newEmpErr } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', fortyEightHoursAgo)
        .limit(100)
      if (!newEmpErr && newEmps && newEmps.length > 0) {
        const n = newEmps.length
        observations.push({
          id: 'new-employees-48h',
          event_type: 'new_hire',
          title: n + ' new employee' + (n > 1 ? 's' : '') + ' added in the last 48 hours',
          suggestion: 'Consider reviewing each new employee profile to ensure onboarding checklists are assigned and access provisioning is initiated.',
          source_table: 'employees',
          source_count: n,
          generated_at: now.toISOString(),
        })
      }

      // 2. Separations initiated in last 48h (timestamp column is created_at)
      const { data: newSeps, error: newSepErr } = await fastify.supabase
        .from('employee_separation')
        .select('id, employee_id, created_at, lifecycle_stage')
        .eq('tenant_id', tenantId)
        .gte('created_at', fortyEightHoursAgo)
        .limit(100)
      if (!newSepErr && newSeps && newSeps.length > 0) {
        const n = newSeps.length
        observations.push({
          id: 'separations-initiated-48h',
          event_type: 'separation_initiated',
          title: n + ' separation' + (n > 1 ? 's' : '') + ' initiated in the last 48 hours',
          suggestion: 'Review asset assignments and clearance schedules for employees who recently initiated separation. Verify recovery plans are in place.',
          source_table: 'employee_separation',
          source_count: n,
          generated_at: now.toISOString(),
        })

        // 3. Assets assigned during active separation
        const sepEmpIds = newSeps.map((s: any) => s.employee_id as string)
        if (sepEmpIds.length > 0) {
          const { data: assetsInSep, error: assetSepErr } = await fastify.supabase
            .from('employee_asset_ledger')
            .select('id, employee_id, action_date')
            .eq('tenant_id', tenantId)
            .eq('action', 'assigned')
            .in('employee_id', sepEmpIds)
            .gte('created_at', fortyEightHoursAgo)
            .limit(100)
          if (!assetSepErr && assetsInSep && assetsInSep.length > 0) {
            const na = assetsInSep.length
            observations.push({
              id: 'assets-assigned-during-separation-48h',
              event_type: 'asset_separation_overlap',
              title: na + ' asset' + (na > 1 ? 's' : '') + ' assigned to employees currently under separation',
              suggestion: 'An asset was assigned during an active separation process. Verify whether a recovery plan exists and ensure clearance timelines are updated accordingly.',
              source_table: 'employee_asset_ledger',
              source_count: na,
              generated_at: now.toISOString(),
            })
          }
        }
      }

      // 4. Assets assigned in last 48h (general — ledger action='assigned')
      const { data: recentAssets, error: assetErr } = await fastify.supabase
        .from('employee_asset_ledger')
        .select('id, employee_id, action_date')
        .eq('tenant_id', tenantId)
        .eq('action', 'assigned')
        .gte('created_at', fortyEightHoursAgo)
        .limit(100)
      if (!assetErr && recentAssets && recentAssets.length > 0) {
        const n = recentAssets.length
        // Only add if not already covered by the separation overlap observation
        observations.push({
          id: 'assets-assigned-48h',
          event_type: 'asset_assigned',
          title: n + ' asset' + (n > 1 ? 's' : '') + ' assigned in the last 48 hours',
          suggestion: 'Consider confirming that asset handover acknowledgements have been collected and inventory records reflect the latest assignments.',
          source_table: 'employee_asset_ledger',
          source_count: n,
          generated_at: now.toISOString(),
        })
      }

      // 5. Employees who became on_notice recently (updated_at in last 48h and status = on_notice)
      const { data: onNoticeRecent, error: noticeErr } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, updated_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'on_notice')
        .gte('updated_at', fortyEightHoursAgo)
        .limit(100)
      if (!noticeErr && onNoticeRecent && onNoticeRecent.length > 0) {
        const n = onNoticeRecent.length
        observations.push({
          id: 'on-notice-recent-48h',
          event_type: 'on_notice',
          title: n + ' employee' + (n > 1 ? 's' : '') + ' moved to on_notice status in the last 48 hours',
          suggestion: 'Review the separation pipeline for these employees. Consider initiating asset recovery tracking and scheduling exit interviews if not already planned.',
          source_table: 'employees',
          source_count: n,
          generated_at: now.toISOString(),
        })
      }

      return reply.send({
        observations,
        total: observations.length,
        generated_at: now.toISOString(),
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/action-center error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/org/attrition-signal ─────────────────────────────────
  fastify.get('/org/attrition-signal', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      // SSOT status values are active/inactive/on_notice/separated (no 'resigned')
      let rows: any[] = []
      try {
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, status, updated_at')
          .eq('tenant_id', tenantId)
          .in('status', ['on_notice', 'separated'])
          .gte('updated_at', ninetyDaysAgo)
          .limit(500)
        rows = data ?? []
      } catch (_e) { rows = [] }

      // Resolve department via current job_history row (employees has no department_id)
      const empDept = new Map<string, string>()
      if (rows.length > 0) {
        try {
          const { data: jh } = await fastify.supabase
            .from('job_history')
            .select('employee_id, departments(name)')
            .eq('tenant_id', tenantId)
            .eq('is_current', true)
            .in('employee_id', rows.map((r: any) => r.id))
          for (const j of jh ?? []) empDept.set(j.employee_id, (j.departments as any)?.name ?? 'Unassigned')
        } catch (_e) { /* skip */ }
      }

      const deptCountMap = new Map<string, number>()
      for (const r of rows) {
        const deptName = empDept.get(r.id) ?? 'Unassigned'
        deptCountMap.set(deptName, (deptCountMap.get(deptName) ?? 0) + 1)
      }

      const total = rows.length
      const by_department = Array.from(deptCountMap.entries())
        .map(([dept_name, count]) => ({ dept_name, count }))
        .sort((a, b) => b.count - a.count)

      const signal: 'elevated' | 'normal' | 'low' = total >= 10 ? 'elevated' : total >= 3 ? 'normal' : 'low'
      return reply.send({ signal, by_department, total })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/org/attrition-signal error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/digest/daily ──────────────────────────────────────────
  fastify.get('/digest/daily', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()
    const todayStr      = now.toISOString().slice(0, 10)
    const twentyFourAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    try {
      const { count: newJoiners } = await fastify.supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('joining_date', todayStr)
      const { count: separationsToday } = await fastify.supabase
        .from('employee_separation').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', twentyFourAgo)
      const { count: assetsToday } = await fastify.supabase
        .from('employee_asset_ledger').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('action', 'assigned').gte('created_at', twentyFourAgo)
      let pendingApprovals = 0
      try {
        const { count: leaveP } = await fastify.supabase
          .from('leave_requests').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'PENDING')
        pendingApprovals += leaveP ?? 0
      } catch (_) {}
      const j = newJoiners ?? 0, s = separationsToday ?? 0, a = assetsToday ?? 0, p = pendingApprovals
      const parts: string[] = [`Daily digest for ${todayStr}.`]
      if (j > 0) parts.push(`${j} new joiner${j > 1 ? 's' : ''} today.`)
      else        parts.push('No new joiners today.')
      if (s > 0) parts.push(`${s} separation${s > 1 ? 's' : ''} completed today.`)
      if (a > 0) parts.push(`${a} asset${a > 1 ? 's' : ''} assigned today.`)
      if (p > 0) parts.push(`${p} approval${p > 1 ? 's' : ''} pending.`)
      if (s === 0 && a === 0 && p === 0) parts.push('No outstanding actions.')
      const metrics = { new_joiners_today: j, separations_today: s, assets_assigned_today: a, pending_approvals: p }
      return reply.send({
        period: 'daily',
        summary_text: parts.join(' '),
        metrics,
        generated_at: now.toISOString(),
        sources: [
          { table: 'employees',             description: 'joining_date = today' },
          { table: 'employee_separation',   description: 'lifecycle_stage in (relieved, archived), last 24h' },
          { table: 'employee_asset_ledger', description: 'action=assigned last 24h' },
          { table: 'leave_requests',        description: 'status = pending' },
        ],
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/digest/daily error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/digest/weekly ─────────────────────────────────────────
  fastify.get('/digest/weekly', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()
    const sevenDaysAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const weekStart     = sevenDaysAgo.toISOString().slice(0, 10)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const { count: joiners } = await fastify.supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).gte('joining_date', weekStart)
      const { count: exits } = await fastify.supabase
        .from('employee_separation').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', sevenDaysAgo.toISOString())
      const { count: onboardingCompleted } = await fastify.supabase
        .from('onboarding_sessions').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('status', 'employee_created').gte('updated_at', sevenDaysAgo.toISOString())
      const { count: probationDue } = await fastify.supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('status', 'active').lte('joining_date', ninetyDaysAgo)
      const j = joiners ?? 0, e = exits ?? 0, o = onboardingCompleted ?? 0, pb = probationDue ?? 0
      const parts: string[] = [`Weekly digest — last 7 days (from ${weekStart}).`]
      parts.push(`${j} new joiner${j !== 1 ? 's' : ''} this week.`)
      if (e > 0) parts.push(`${e} exit${e !== 1 ? 's' : ''} this week.`)
      if (o > 0) parts.push(`${o} onboarding${o !== 1 ? 's' : ''} completed.`)
      if (pb > 0) parts.push(`${pb} probation review${pb !== 1 ? 's' : ''} due.`)
      if (e === 0 && pb === 0) parts.push('No exits or probation concerns this week.')
      const metrics = { joiners_7d: j, exits_7d: e, onboarding_completions_7d: o, probation_reviews_due: pb }
      return reply.send({
        period: 'weekly',
        summary_text: parts.join(' '),
        metrics,
        generated_at: now.toISOString(),
        sources: [
          { table: 'employees',          description: 'joining_date last 7d; joining_date <= 90 days ago for probation' },
          { table: 'employee_separation', description: 'lifecycle_stage in (relieved, archived), last 7d' },
          { table: 'onboarding_sessions', description: 'status = employee_created, last 7d' },
        ],
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/digest/weekly error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── POST /intelligence/search ───────────────────────────────────────────────
  fastify.post('/search', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    const tenantId: string = req.tenantId
    const { query } = req.body as { query?: string }
    if (!query || typeof query !== 'string' || !query.trim()) {
      return reply.code(400).send({ error: 'MISSING_QUERY' })
    }
    const q = query.trim().toLowerCase()
    const now = new Date()

    const SUGGESTIONS = [
      'employees joining this month',
      'employees joining this week',
      'employees without PAN',
      'employees on notice',
      'employees on probation',
      'separated employees',
      'employees without onboarding',
      'employees with assets',
      'engineering department',
    ]

    type FilterType =
      | 'joining_this_month'
      | 'joining_this_week'
      | 'missing_pan'
      | 'on_notice'
      | 'probation'
      | 'separated'
      | 'without_onboarding'
      | 'with_assets'
      | 'department'

    let filterType: FilterType | null = null
    let departmentKeyword: string | null = null

    if (q.includes('joining this month') || q.includes('joined this month')) {
      filterType = 'joining_this_month'
    } else if (q.includes('joining this week') || q.includes('joined this week')) {
      filterType = 'joining_this_week'
    } else if (q.includes('without pan') || q.includes('missing pan') || q.includes('no pan')) {
      filterType = 'missing_pan'
    } else if (q.includes('on notice') || q.includes('notice period')) {
      filterType = 'on_notice'
    } else if (q.includes('probation')) {
      filterType = 'probation'
    } else if (q.includes('separated') || q.includes('exited')) {
      filterType = 'separated'
    } else if (q.includes('without onboarding') || q.includes('no onboarding') || q.includes('missing onboarding')) {
      filterType = 'without_onboarding'
    } else if (q.includes('with assets') || q.includes('has assets') || q.includes('have assets')) {
      filterType = 'with_assets'
    } else {
      // department keyword matching
      const deptKeywords = ['engineering', 'sales', 'hr', 'finance', 'marketing', 'operations', 'product', 'design', 'legal', 'support']
      for (const kw of deptKeywords) {
        if (q.includes(kw)) {
          filterType = 'department'
          departmentKeyword = kw
          break
        }
      }
    }

    if (!filterType) {
      return reply.send({
        error: 'Could not interpret query',
        suggestions: SUGGESTIONS,
      })
    }

    try {
      const sources: string[] = ['employees']
      let interpreted_as = ''
      let employees: any[] = []

      if (filterType === 'joining_this_month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
        interpreted_as = `joining_date >= ${monthStart}`
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code, status, joining_date')
          .eq('tenant_id', tenantId)
          .gte('joining_date', monthStart)
          .limit(50)
        employees = data ?? []

      } else if (filterType === 'joining_this_week') {
        const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1 // Monday=0
        const monday = new Date(now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000)
        const weekStart = monday.toISOString().slice(0, 10)
        interpreted_as = `joining_date >= ${weekStart} (Monday of current week)`
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code, status, joining_date')
          .eq('tenant_id', tenantId)
          .gte('joining_date', weekStart)
          .limit(50)
        employees = data ?? []

      } else if (filterType === 'missing_pan') {
        interpreted_as = 'pan_number IS NULL'
        sources.push('employee_bank_statutory')
        // Try employee_bank_statutory first, fall back to employees table
        let empIds: string[] = []
        try {
          const { data: panRows } = await fastify.supabase
            .from('employee_bank_statutory')
            .select('employee_id')
            .eq('tenant_id', tenantId)
            .is('pan_number', null)
            .limit(200)
          empIds = (panRows ?? []).map((r: any) => r.employee_id)
        } catch (_) {
          // table may not exist, skip
        }
        if (empIds.length > 0) {
          const { data } = await fastify.supabase
            .from('employees')
            .select('id, first_name, last_name, employee_code, status, joining_date')
            .eq('tenant_id', tenantId)
            .in('id', empIds.slice(0, 50))
            .limit(50)
          employees = data ?? []
        } else {
          // try pan on employees table directly
          try {
            const { data } = await fastify.supabase
              .from('employees')
              .select('id, first_name, last_name, employee_code, status, joining_date')
              .eq('tenant_id', tenantId)
              .is('pan_number', null)
              .limit(50)
            employees = data ?? []
          } catch (_) { employees = [] }
        }

      } else if (filterType === 'on_notice') {
        interpreted_as = "status = 'on_notice'"
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code, status, joining_date')
          .eq('tenant_id', tenantId)
          .eq('status', 'on_notice')
          .limit(50)
        employees = data ?? []

      } else if (filterType === 'probation') {
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        interpreted_as = `joining_date <= ${ninetyDaysAgo} AND status = 'active'`
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code, status, joining_date')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .lte('joining_date', ninetyDaysAgo)
          .limit(50)
        employees = data ?? []

      } else if (filterType === 'separated') {
        interpreted_as = "status = 'separated'"
        const { data } = await fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code, status, joining_date')
          .eq('tenant_id', tenantId)
          .eq('status', 'separated')
          .limit(50)
        employees = data ?? []

      } else if (filterType === 'without_onboarding') {
        interpreted_as = 'no completed onboarding (draft_employee_profiles.linked_employee_id)'
        sources.push('draft_employee_profiles')
        // Employees linked to a completed onboarding draft
        let completedEmpIds: string[] = []
        try {
          const { data: drafts } = await fastify.supabase
            .from('draft_employee_profiles')
            .select('linked_employee_id')
            .eq('tenant_id', tenantId)
            .not('linked_employee_id', 'is', null)
            .limit(1000)
          const ids = new Set<string>()
          for (const s of (drafts ?? [])) {
            if (s.linked_employee_id) ids.add(s.linked_employee_id)
          }
          completedEmpIds = Array.from(ids)
        } catch (_) {}
        let query = fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code, status, joining_date')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
        if (completedEmpIds.length > 0) {
          query = query.not('id', 'in', `(${completedEmpIds.slice(0, 200).map(id => `"${id}"`).join(',')})`) as any
        }
        const { data } = await (query as any).limit(50)
        employees = data ?? []

      } else if (filterType === 'with_assets') {
        interpreted_as = 'has a currently-assigned asset (assets.status=assigned)'
        sources.push('assets')
        let empIds: string[] = []
        try {
          const { data: assetRows } = await fastify.supabase
            .from('assets')
            .select('assigned_to')
            .eq('tenant_id', tenantId)
            .eq('status', 'assigned')
            .not('assigned_to', 'is', null)
            .limit(200)
          const ids = new Set<string>((assetRows ?? []).map((r: any) => r.assigned_to as string))
          empIds = Array.from(ids)
        } catch (_) {}
        if (empIds.length > 0) {
          const { data } = await fastify.supabase
            .from('employees')
            .select('id, first_name, last_name, employee_code, status, joining_date')
            .eq('tenant_id', tenantId)
            .in('id', empIds.slice(0, 50))
            .limit(50)
          employees = data ?? []
        }

      } else if (filterType === 'department' && departmentKeyword) {
        interpreted_as = `department name ILIKE '%${departmentKeyword}%'`
        sources.push('departments')
        // Find matching department IDs first
        const { data: depts } = await fastify.supabase
          .from('departments')
          .select('id, name')
          .eq('tenant_id', tenantId)
          .ilike('name', `%${departmentKeyword}%`)
          .limit(20)
        sources.push('job_history')
        const deptIds = (depts ?? []).map((d: any) => d.id as string)
        if (deptIds.length > 0) {
          // employees has no department_id — resolve member ids via current job_history
          const { data: jh } = await fastify.supabase
            .from('job_history')
            .select('employee_id')
            .eq('tenant_id', tenantId)
            .eq('is_current', true)
            .in('department_id', deptIds)
            .limit(200)
          const memberIds = (jh ?? []).map((r: any) => r.employee_id as string)
          if (memberIds.length > 0) {
            const { data } = await fastify.supabase
              .from('employees')
              .select('id, first_name, last_name, employee_code, status, joining_date')
              .eq('tenant_id', tenantId)
              .in('id', memberIds.slice(0, 50))
              .limit(50)
            employees = data ?? []
          }
        }
      }

      // Attach department name via current job_history (single batch lookup)
      const deptByEmp = new Map<string, string>()
      if (employees.length > 0) {
        try {
          const { data: jh2 } = await fastify.supabase
            .from('job_history')
            .select('employee_id, departments(name)')
            .eq('tenant_id', tenantId)
            .eq('is_current', true)
            .in('employee_id', employees.map((e: any) => e.id))
          for (const r of jh2 ?? []) deptByEmp.set(r.employee_id, (r.departments as any)?.name ?? '')
        } catch (_) { /* skip */ }
      }

      const normalizedEmployees = employees.map((e: any) => ({
        id:            e.id,
        first_name:    e.first_name,
        last_name:     e.last_name,
        employee_code: e.employee_code,
        status:        e.status,
        joining_date:  e.joining_date ?? null,
        department:    deptByEmp.get(e.id) || null,
      }))

      return reply.send({
        query,
        interpreted_as,
        employees: normalizedEmployees,
        count: normalizedEmployees.length,
        sources,
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/search error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/digest/monthly ────────────────────────────────────────
  fastify.get('/digest/monthly', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const now = new Date()
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd      = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const { count: h }  = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active')
      const { count: j }  = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('joining_date', monthStart).lte('joining_date', monthEnd)
      const { count: e }  = await fastify.supabase.from('employee_separation').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('lifecycle_stage', ['relieved', 'archived']).gte('updated_at', monthStart)
      const { count: pb } = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active').lte('joining_date', ninetyDaysAgo)
      const headcount = h ?? 0, joiners = j ?? 0, exits = e ?? 0, probBacklog = pb ?? 0
      const netChange = joiners - exits
      const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const parts: string[] = [`Monthly digest for ${monthLabel}.`]
      parts.push(`Active headcount: ${headcount} employee${headcount !== 1 ? 's' : ''}.`)
      if (joiners > 0) parts.push(`${joiners} joined this month.`)
      if (exits > 0)   parts.push(`${exits} exited this month.`)
      if (netChange > 0)       parts.push(`Net headcount change: +${netChange}.`)
      else if (netChange < 0)  parts.push(`Net headcount change: ${netChange}.`)
      if (probBacklog > 0) parts.push(`${probBacklog} probation confirmation${probBacklog !== 1 ? 's' : ''} overdue.`)
      if (exits === 0 && probBacklog === 0) parts.push('No exits or probation concerns this month.')
      const metrics = { headcount, joiners_mtd: joiners, exits_mtd: exits, net_change: netChange, probation_backlog: probBacklog }
      return reply.send({
        period: 'monthly',
        summary_text: parts.join(' '),
        metrics,
        generated_at: now.toISOString(),
        sources: [
          { table: 'employees',           description: 'active headcount; joining_date current month; probation backlog' },
          { table: 'employee_separation', description: 'lifecycle_stage in (relieved, archived), current month' },
        ],
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/digest/monthly error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // ── GET /intelligence/onboarding/:sessionId/readiness ───────────────────────
  fastify.get('/onboarding/:sessionId/readiness', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const tenantId: string = req.tenantId
    const { sessionId } = req.params as { sessionId: string }
    const now = new Date()
    const sources: string[] = []

    try {
      // 1. Fetch onboarding session
      const { data: session, error: sessionErr } = await fastify.supabase
        .from('onboarding_sessions')
        .select('id, candidate_name, status, tenant_id')
        .eq('id', sessionId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (sessionErr || !session) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' })
      sources.push('onboarding_sessions')

      // 2. Fetch onboarding documents
      const { data: docRows } = await fastify.supabase
        .from('onboarding_documents')
        .select('id, status')
        .eq('session_id', sessionId)
        .eq('tenant_id', tenantId)
        .limit(200)
      const docs = docRows ?? []
      sources.push('onboarding_documents')
      const docTotal     = docs.length
      const docExtracted = docs.filter((d: any) => d.status === 'extracted').length
      const docFailed    = docs.filter((d: any) => d.status === 'failed').length
      const docRejected  = docs.filter((d: any) => d.status === 'rejected').length
      const docPending   = docs.filter((d: any) => d.status === 'pending').length

      // 3. Fetch draft employee profiles
      let missingFields: string[] = []
      let validationErrors: string[] = []
      try {
        const { data: draftRows } = await fastify.supabase
          .from('draft_employee_profiles')
          .select('missing_critical_fields, validation_errors')
          .eq('session_id', sessionId)
          .eq('tenant_id', tenantId)
          .limit(1)
        if (draftRows && draftRows.length > 0) {
          const draft = draftRows[0]
          missingFields    = Array.isArray(draft.missing_critical_fields) ? draft.missing_critical_fields : []
          validationErrors = Array.isArray(draft.validation_errors)       ? draft.validation_errors       : []
          sources.push('draft_employee_profiles')
        }
      } catch (_) { /* table may not exist — skip */ }

      // 4. Fetch pre-joinee submission
      try {
        const { data: inviteRows } = await fastify.supabase
          .from('pre_joinee_invitations')
          .select('id')
          .eq('session_id', sessionId)
          .eq('tenant_id', tenantId)
          .limit(1)
        if (inviteRows && inviteRows.length > 0) {
          const inviteId = inviteRows[0].id
          const { data: submRows } = await fastify.supabase
            .from('pre_joinee_submissions')
            .select('id, status')
            .eq('invitation_id', inviteId)
            .limit(1)
          if (submRows && submRows.length > 0) {
            sources.push('pre_joinee_submissions')
          }
        }
      } catch (_) { /* table may not exist — skip */ }

      // 5. Determine readiness score (rule-based)
      const hasRejected     = docRejected > 0
      const hasFailed       = docFailed > 0
      const hasValErrors    = validationErrors.length > 0
      const hasBlockingMiss = missingFields.some((f: string) => {
        const fl = f.toLowerCase()
        return fl.includes('email') || fl.includes('name')
      })
      const allExtracted    = docTotal > 0 && docExtracted === docTotal
      const noIssues        = !hasRejected && !hasFailed && !hasValErrors && missingFields.length === 0

      let readinessScore: 'ready' | 'nearly_ready' | 'needs_attention' | 'blocked'
      if (hasRejected || hasBlockingMiss) {
        readinessScore = 'blocked'
      } else if (hasValErrors || hasFailed) {
        readinessScore = 'needs_attention'
      } else if (allExtracted && noIssues) {
        readinessScore = 'ready'
      } else {
        readinessScore = 'nearly_ready'
      }

      // 6. Build readiness_text
      const textParts: string[] = []
      if (docTotal > 0) {
        textParts.push(`${docExtracted} of ${docTotal} document${docTotal !== 1 ? 's' : ''} extracted.`)
      }
      if (docRejected > 0) textParts.push(`${docRejected} rejected (identity mismatch).`)
      if (docFailed > 0)   textParts.push(`${docFailed} failed extraction.`)
      if (docPending > 0)  textParts.push(`${docPending} pending review.`)
      if (missingFields.length > 0) textParts.push(`Missing: ${missingFields.slice(0, 3).join(', ')}${missingFields.length > 3 ? ', and more' : ''}.`)
      if (validationErrors.length > 0) textParts.push(`${validationErrors.length} validation error${validationErrors.length !== 1 ? 's' : ''}.`)
      if (textParts.length === 0) textParts.push('No documents or draft profile found.')
      const readinessText = textParts.join(' ')

      // 7. Suggested actions (rule-based)
      const suggestedActions: string[] = []
      if (docRejected > 0)             suggestedActions.push('Re-upload rejected documents with correct identity information.')
      if (docFailed > 0)               suggestedActions.push('Review failed documents and re-upload clear scanned copies.')
      if (docPending > 0)              suggestedActions.push('Complete extraction review for pending documents.')
      if (missingFields.length > 0)    suggestedActions.push('Fill in missing critical fields: ' + missingFields.slice(0, 3).join(', ') + '.')
      if (validationErrors.length > 0) suggestedActions.push('Resolve validation errors before creating employee record.')
      if (suggestedActions.length === 0 && readinessScore === 'ready') suggestedActions.push('All checks passed — proceed to create employee record.')

      return reply.send({
        session_id:       session.id,
        candidate_name:   session.candidate_name ?? null,
        readiness_score:  readinessScore,
        readiness_text:   readinessText,
        documents: {
          total:     docTotal,
          extracted: docExtracted,
          failed:    docFailed,
          rejected:  docRejected,
          pending:   docPending,
        },
        missing_fields:    missingFields,
        validation_errors: validationErrors,
        suggested_actions: suggestedActions,
        sources,
        generated_at: now.toISOString(),
      })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'intelligence/onboarding/readiness error')
      return reply.code(500).send({ error: 'INTELLIGENCE_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })
}
