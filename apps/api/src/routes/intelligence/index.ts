/**
 * Intelligence Routes — AI Workforce OS Phase 1
 *
 * READ-ONLY intelligence layer. Every endpoint queries existing source tables
 * and derives insights. No writes to source-of-truth tables.
 * All narratives are deterministic rule-based text — no LLM calls.
 * All routes are tenant-isolated via req.tenantId.
 */
import type { FastifyInstance } from 'fastify'

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
        const { data: assetRisk } = await fastify.supabase
          .from('employee_asset_ledger').select('id, employee_id')
          .eq('tenant_id', tenantId).eq('status', 'assigned').in('employee_id', sepEmpIds).limit(50)
        if (assetRisk && assetRisk.length > 0) {
          assetsAtRiskCount = assetRisk.length
          observations.push({
            id: 'assets-at-risk', category: 'assets', severity: 'critical',
            title: assetRisk.length + ' asset' + (assetRisk.length > 1 ? 's' : '') + ' assigned to employees under separation',
            body: 'Company assets remain with employees in the separation process. Must be recovered before final clearance.',
            source_records: [{ table: 'employee_asset_ledger', count: assetRisk.length }],
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

      // KPIs
      const { count: activeCount }      = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active')
      const { count: joinersThisMonth } = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('joining_date', monthStart)
      const { count: onNotice }         = await fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'on_notice')

      observations.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))

      return reply.send({
        data: {
          summary:        buildSummary(observations),
          critical_count: observations.filter(o => o.severity === 'critical').length,
          high_count:     observations.filter(o => o.severity === 'high').length,
          observations,
          kpis: {
            active_headcount:    activeCount       ?? 0,
            joiners_this_month:  joinersThisMonth  ?? 0,
            on_notice:           onNotice          ?? 0,
            stalled_onboarding:  stalledSessions?.length ?? 0,
            pending_separations: pendingSep?.length ?? 0,
            assets_at_risk:      assetsAtRiskCount,
            probation_due:       probationDue?.length ?? 0,
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
      const newJoiners = team.filter((e: any) => e.joining_date && e.joining_date >= monthStart).length
      const probDue    = team.filter((e: any) => e.joining_date && e.joining_date <= ninetyDaysAgo).length
      let pendingLeave = 0
      if (managerId) {
        const { count } = await fastify.supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('approver_id', managerId).eq('status', 'pending')
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
      const { data: sep }     = await fastify.supabase.from('employee_separation').select('lifecycle_stage, initiated_at').eq('employee_id', employeeId).eq('tenant_id', tenantId).maybeSingle()
      const { count: assets } = await fastify.supabase.from('employee_asset_ledger').select('id', { count: 'exact', head: true }).eq('employee_id', employeeId).eq('tenant_id', tenantId).eq('status', 'assigned')
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
}
