/**
 * Compliance Export Engine
 *
 * Produces compliance-ready CSV exports from IMMUTABLE contribution tables.
 * Does NOT read mutable live data — reads only finalized contribution records
 * and payroll snapshots.
 *
 * GET /payroll/exports/epf                  — EPF ECR-format monthly export
 * GET /payroll/exports/esi                  — ESI monthly contribution export
 * GET /payroll/exports/ptax                 — Professional Tax monthly export
 * GET /payroll/exports/tds                  — TDS annual summary export
 * GET /payroll/exports/challan              — Challan summary (all statutory types)
 * GET /payroll/exports/statutory-reconciliation — Month-level statutory reconciliation
 *
 * Query params (per export):
 *   month         YYYY-MM (required for monthly exports)
 *   financial_year YYYY-YY (required for TDS)
 *   state_code    optional (PTax)
 *   site_id       optional
 *   employee_id   optional
 *   format        'csv' (default) | 'json'
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const header = headers.join(',')
  const body   = rows.map(r => headers.map(h => escape(r[h])).join(',')).join('\n')
  return `${header}\n${body}`
}

function setCsvHeaders(reply: any, filename: string) {
  reply.header('Content-Type', 'text/csv; charset=utf-8')
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
}

export default async function payrollExportsRoutes(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }] }

  const monthSchema = z.object({
    month:       z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    site_id:     z.string().uuid().optional(),
    employee_id: z.string().uuid().optional(),
    format:      z.enum(['csv','json']).optional().default('csv'),
  })

  // ── GET /payroll/exports/epf ──────────────────────────────────────────────────
  fastify.get('/epf', adminAuth, async (req: any, reply) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, site_id, employee_id, format } = parsed.data

    // fetchAllRows() (not a plain query): a tenant with >1,000 EPF
    // contribution rows for a month would otherwise have its ECR export
    // silently truncated at 1,000 employees — a compliance filing gap.
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('epf_contributions')
          .select(`
            employee_id, contribution_month,
            pf_wages, employee_contribution, voluntary_pf,
            employer_pf, employer_eps, edli_contribution, is_capped,
            employees(employee_code, first_name, last_name, site_id)
          `)
          .eq('tenant_id', req.tenantId)
          .eq('contribution_month', month)
          .order('employees(employee_code)', { ascending: true })

        if (employee_id) q = q.eq('employee_id', employee_id)
        return q.range(from, to)
      })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch EPF contributions')
    }
    if (site_id) rows = rows.filter(r => r.employees?.site_id === site_id)

    // Also fetch UANs from epf_eligibility_overrides — the parent EPF query
    // above is already paginated, so this lookup must be too, otherwise UANs
    // silently resolve empty for any tenant with >1,000 EPF rows/month.
    const empIds = rows.map(r => r.employee_id)
    let uanMap = new Map<string, string | null>()
    if (empIds.length > 0) {
      const uanRows = await fetchAllRows<{ employee_id: string; uan: string | null }>((from, to) =>
        fastify.supabase
          .from('epf_eligibility_overrides')
          .select('employee_id, uan')
          .eq('tenant_id', req.tenantId)
          .in('employee_id', empIds)
          .is('effective_to', null)
          .range(from, to),
      )

      for (const r of uanRows) {
        uanMap.set(r.employee_id, r.uan ?? null)
      }
    }

    const records = rows.map(r => ({
      uan:                   uanMap.get(r.employee_id) ?? '',
      employee_code:         r.employees?.employee_code ?? '',
      employee_name:         r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '',
      contribution_month:    r.contribution_month,
      pf_wages:              r.pf_wages,
      employee_pf:           r.employee_contribution,
      voluntary_pf:          r.voluntary_pf ?? 0,
      employer_pf:           r.employer_pf,
      employer_eps:          r.employer_eps,
      edli_contribution:     r.edli_contribution,
      total_employer:        ((r.employer_pf ?? 0) + (r.employer_eps ?? 0) + (r.edli_contribution ?? 0)),
      is_capped:             r.is_capped ? 'Y' : 'N',
    }))
    // Admin charges (0.5% of aggregate PF wages, EPFO standard rate) is a
    // lump-sum employer-level charge, not a per-employee figure —
    // epf_contributions has no admin_charges column at all (this row shape
    // used to fabricate one at 0 via `r.admin_charges ?? 0`, always reading
    // as "no admin charge" instead of omitting a field that doesn't exist
    // per employee). See /challan below for the correct aggregate total.

    if (format === 'json') return reply.send({ data: records, month, count: records.length })

    const headers = [
      'uan','employee_code','employee_name','contribution_month',
      'pf_wages','employee_pf','voluntary_pf','employer_pf','employer_eps',
      'edli_contribution','total_employer','is_capped',
    ]
    setCsvHeaders(reply, `epf-ecr-${month}.csv`)
    return reply.send(toCSV(headers, records))
  })

  // ── GET /payroll/exports/esi ──────────────────────────────────────────────────
  fastify.get('/esi', adminAuth, async (req: any, reply) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, site_id, employee_id, format } = parsed.data

    // fetchAllRows() (not a plain query): a tenant with >1,000 ESI
    // contribution rows for a month would otherwise have its export
    // silently truncated at 1,000 employees — a compliance filing gap.
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('esi_contributions')
          .select(`
            employee_id, contribution_month,
            esi_wages, is_eligible, employee_contribution, employer_contribution, total_contribution,
            employees(employee_code, first_name, last_name, site_id)
          `)
          .eq('tenant_id', req.tenantId)
          .eq('contribution_month', month)

        if (employee_id) q = q.eq('employee_id', employee_id)
        return q.range(from, to)
      })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch ESI contributions')
    }
    if (site_id) rows = rows.filter(r => r.employees?.site_id === site_id)

    // Fetch ESI registration for tenant
    const { data: reg, error: regErr } = await fastify.supabase
      .from('statutory_registrations')
      .select('registration_number')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'esi')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (regErr) return serverError(req, reply, regErr, ErrorCode.QUERY_FAILED, 'Failed to fetch ESI registration')

    const esiRegNumber = (reg as any)?.registration_number ?? ''

    const records = rows.map(r => ({
      esi_registration:    esiRegNumber,
      employee_code:       r.employees?.employee_code ?? '',
      employee_name:       r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '',
      contribution_month:  r.contribution_month,
      esi_wages:           r.esi_wages,
      is_eligible:         r.is_eligible ? 'Y' : 'N',
      employee_contribution: r.employee_contribution,
      employer_contribution: r.employer_contribution,
      total_contribution:  r.total_contribution,
    }))

    if (format === 'json') return reply.send({ data: records, month, esi_registration: esiRegNumber, count: records.length })

    const headers = [
      'esi_registration','employee_code','employee_name','contribution_month',
      'esi_wages','is_eligible','employee_contribution','employer_contribution','total_contribution',
    ]
    setCsvHeaders(reply, `esi-${month}.csv`)
    return reply.send(toCSV(headers, records))
  })

  // ── GET /payroll/exports/ptax ─────────────────────────────────────────────────
  fastify.get('/ptax', adminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      month:        z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
      state_code:   z.string().optional(),
      employee_id:  z.string().uuid().optional(),
      format:       z.enum(['csv','json']).optional().default('csv'),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, state_code, employee_id, format } = parsed.data

    // fetchAllRows() (not a plain query): a tenant with >1,000 PTax
    // contribution rows for a month would otherwise have its export
    // silently truncated at 1,000 employees — a compliance filing gap.
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('ptax_contributions')
          .select(`
            employee_id, contribution_month, state_code, financial_year,
            gross_salary, ptax_amount,
            employees(employee_code, first_name, last_name)
          `)
          .eq('tenant_id', req.tenantId)
          .eq('contribution_month', month)

        if (state_code)  q = q.eq('state_code', state_code)
        if (employee_id) q = q.eq('employee_id', employee_id)
        return q.range(from, to)
      })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch PTax contributions')
    }

    // Fetch PTax registrations per state
    const states = [...new Set(rows.map(r => r.state_code).filter(Boolean))]
    const regMap = new Map<string, string>()
    if (states.length > 0) {
      const { data: regs, error: regsErr } = await fastify.supabase
        .from('statutory_registrations')
        .select('state_code, registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'ptax')
        .eq('is_active', true)
        .in('state_code', states)
      if (regsErr) return serverError(req, reply, regsErr, ErrorCode.QUERY_FAILED, 'Failed to fetch PTax registrations')

      for (const r of (regs ?? []) as any[]) regMap.set(r.state_code, r.registration_number)
    }

    const records = rows.map(r => ({
      ptax_registration:  regMap.get(r.state_code) ?? '',
      state_code:         r.state_code,
      employee_code:      r.employees?.employee_code ?? '',
      employee_name:      r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '',
      contribution_month: r.contribution_month,
      financial_year:     r.financial_year,
      gross_salary:       r.gross_salary,
      ptax_amount:        r.ptax_amount,
    }))

    if (format === 'json') return reply.send({ data: records, month, count: records.length })

    const headers = [
      'ptax_registration','state_code','employee_code','employee_name',
      'contribution_month','financial_year','gross_salary','ptax_amount',
    ]
    setCsvHeaders(reply, `ptax-${month}.csv`)
    return reply.send(toCSV(headers, records))
  })

  // ── GET /payroll/exports/lwf ──────────────────────────────────────────────────
  // P2.3 — Labour Welfare Fund monthly register. Mirrors the ptax export;
  // registration number is resolved from lwf_state_settings (per-state).
  fastify.get('/lwf', adminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      month:        z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
      state_code:   z.string().optional(),
      employee_id:  z.string().uuid().optional(),
      format:       z.enum(['csv','json']).optional().default('csv'),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, state_code, employee_id, format } = parsed.data

    // fetchAllRows() (not a plain query): a tenant with >1,000 LWF
    // contribution rows for a month would otherwise have its export
    // silently truncated at 1,000 employees — a compliance filing gap.
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('lwf_contributions')
          .select(`
            employee_id, contribution_month, state_code,
            gross_salary, employee_contribution, employer_contribution, is_eligible,
            employees(employee_code, first_name, last_name)
          `)
          .eq('tenant_id', req.tenantId)
          .eq('contribution_month', month)

        if (state_code)  q = q.eq('state_code', state_code)
        if (employee_id) q = q.eq('employee_id', employee_id)
        return q.range(from, to)
      })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch LWF contributions')
    }

    // Resolve LWF registration number per state from lwf_state_settings
    const states = [...new Set(rows.map(r => r.state_code).filter(Boolean))]
    const regMap = new Map<string, string>()
    if (states.length > 0) {
      const { data: regs, error: regsErr } = await fastify.supabase
        .from('lwf_state_settings')
        .select('state_code, registration_number')
        .eq('tenant_id', req.tenantId)
        .in('state_code', states)
      if (regsErr) return serverError(req, reply, regsErr, ErrorCode.QUERY_FAILED, 'Failed to fetch LWF registrations')
      for (const r of (regs ?? []) as any[]) regMap.set(r.state_code, r.registration_number ?? '')
    }

    const records = rows.map(r => ({
      lwf_registration:      regMap.get(r.state_code) ?? '',
      state_code:            r.state_code,
      employee_code:         r.employees?.employee_code ?? '',
      employee_name:         r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '',
      contribution_month:    r.contribution_month,
      gross_salary:          r.gross_salary,
      employee_contribution: r.employee_contribution,
      employer_contribution: r.employer_contribution,
      total_contribution:    Number(r.employee_contribution ?? 0) + Number(r.employer_contribution ?? 0),
      is_eligible:           r.is_eligible,
    }))

    if (format === 'json') return reply.send({ data: records, month, count: records.length })

    const headers = [
      'lwf_registration','state_code','employee_code','employee_name',
      'contribution_month','gross_salary','employee_contribution',
      'employer_contribution','total_contribution','is_eligible',
    ]
    setCsvHeaders(reply, `lwf-${month}.csv`)
    return reply.send(toCSV(headers, records))
  })

  // ── GET /payroll/exports/tds ──────────────────────────────────────────────────
  fastify.get('/tds', adminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      financial_year: z.string().min(4),
      employee_id:    z.string().uuid().optional(),
      format:         z.enum(['csv','json']).optional().default('csv'),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { financial_year, employee_id, format } = parsed.data

    // Read from tds_declaration_snapshots (immutable) — NOT from live
    // tax_declarations. fetchAllRows() (not a plain query): this table keeps
    // one row per employee PER SNAPSHOT (dedup happens below in application
    // code), so a tenant with >1,000 employees can easily exceed 1,000 rows
    // for a single financial year — a plain query would silently drop
    // employees from the annual TDS export.
    let allSnapshots: any[]
    try {
      allSnapshots = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('tds_declaration_snapshots')
          .select(`
            employee_id, financial_year, snapshot_at,
            total_declared, total_approved,
            declaration_items,
            employees(employee_code, first_name, last_name)
          `)
          .eq('tenant_id', req.tenantId)
          .eq('financial_year', financial_year)
          .order('employee_id', { ascending: true })
          .order('snapshot_at', { ascending: false })

        if (employee_id) q = q.eq('employee_id', employee_id)
        return q.range(from, to)
      })
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch TDS declaration snapshots')
    }

    // Dedupe: keep latest snapshot per employee
    const seen = new Map<string, any>()
    for (const r of allSnapshots) {
      if (!seen.has(r.employee_id)) seen.set(r.employee_id, r)
    }

    // total_rejected doesn't exist on tds_declaration_snapshots (only
    // total_declared/total_approved — migration 165) and was previously
    // fabricated as `r.total_rejected ?? 0`, always reading as "nothing
    // rejected" regardless of the real figure. Removed rather than guessed
    // at a derivation (total_declared - total_approved would conflate
    // "rejected" with "still pending review", which isn't the same thing).
    const records = [...seen.values()].map(r => ({
      employee_code:    r.employees?.employee_code ?? '',
      employee_name:    r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '',
      financial_year:   r.financial_year,
      snapshot_at:      r.snapshot_at,
      total_declared:   r.total_declared ?? 0,
      total_approved:   r.total_approved ?? 0,
      items_count:      Array.isArray(r.declaration_items) ? r.declaration_items.length : 0,
    }))

    if (format === 'json') return reply.send({ data: records, financial_year, count: records.length })

    const headers = [
      'employee_code','employee_name','financial_year','snapshot_at',
      'total_declared','total_approved','items_count',
    ]
    setCsvHeaders(reply, `tds-${financial_year}.csv`)
    return reply.send(toCSV(headers, records))
  })

  // ── GET /payroll/exports/challan ──────────────────────────────────────────────
  // Challan summary: consolidated statutory totals for the month (all types)
  fastify.get('/challan', adminAuth, async (req: any, reply) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, format } = parsed.data

    // fetchAllRows() on all three (not plain .select()s): these feed a SUM
    // across every contribution row for the month — a >1,000-row tenant
    // would otherwise get a silently understated challan total with no
    // truncation signal.
    let epfRows: any[], esiRows: any[], ptaxRows: any[]
    try {
      ;[epfRows, esiRows, ptaxRows] = await Promise.all([
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('epf_contributions')
            .select('employee_contribution, employer_pf, employer_eps, edli_contribution, voluntary_pf, pf_wages')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('esi_contributions')
            .select('employee_contribution, employer_contribution, total_contribution')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('ptax_contributions')
            .select('ptax_amount, state_code')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
            .range(from, to),
        ),
      ])
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch contribution totals')
    }

    const r2 = (n: number) => Math.round(n * 100) / 100

    const sum = (arr: any[], key: string) => r2(arr.reduce((s, r) => s + (r[key] ?? 0), 0))

    const ptaxByState: Record<string, number> = {}
    for (const r of ptaxRows) {
      ptaxByState[r.state_code] = r2((ptaxByState[r.state_code] ?? 0) + (r.ptax_amount ?? 0))
    }

    // Admin charges = 0.50% of aggregate PF wages (EPFO standard rate) —
    // epf_contributions has no admin_charges column at all, so
    // sum(epfRows, 'admin_charges') always evaluated to 0, understating
    // every EPF/grand total in this challan by the real admin-charge amount.
    // Matches the correct pattern already used in filing-pack.ts.
    const epfAdminCharges = r2(sum(epfRows, 'pf_wages') * 0.005)

    const challan = {
      month,
      epf: {
        employee_contribution: sum(epfRows, 'employee_contribution'),
        voluntary_pf:          sum(epfRows, 'voluntary_pf'),
        employer_pf:           sum(epfRows, 'employer_pf'),
        employer_eps:          sum(epfRows, 'employer_eps'),
        edli:                  sum(epfRows, 'edli_contribution'),
        admin_charges:         epfAdminCharges,
        total_remittance:      r2(
          sum(epfRows, 'employee_contribution') + sum(epfRows, 'voluntary_pf') +
          sum(epfRows, 'employer_pf') + sum(epfRows, 'employer_eps') +
          sum(epfRows, 'edli_contribution') + epfAdminCharges
        ),
        employee_count: epfRows.length,
      },
      esi: {
        employee_contribution: sum(esiRows, 'employee_contribution'),
        employer_contribution: sum(esiRows, 'employer_contribution'),
        total_remittance:      sum(esiRows, 'total_contribution'),
        employee_count:        esiRows.length,
      },
      ptax: {
        total_remittance: r2(ptaxRows.reduce((s, r) => s + (r.ptax_amount ?? 0), 0)),
        by_state:         ptaxByState,
        employee_count:   ptaxRows.length,
      },
      grand_total_remittance: r2(
        sum(epfRows, 'employee_contribution') + sum(epfRows, 'voluntary_pf') +
        sum(epfRows, 'employer_pf')          + sum(epfRows, 'employer_eps') +
        sum(epfRows, 'edli_contribution')    + epfAdminCharges +
        sum(esiRows, 'total_contribution')   +
        ptaxRows.reduce((s: number, r: any) => s + (r.ptax_amount ?? 0), 0)
      ),
    }

    if (format === 'json') return reply.send({ data: challan })

    // CSV: flat rows per statutory type
    const rows = [
      { statutory_type: 'EPF', category: 'Employee Contribution',    amount: challan.epf.employee_contribution,    month },
      { statutory_type: 'EPF', category: 'Voluntary PF',             amount: challan.epf.voluntary_pf,             month },
      { statutory_type: 'EPF', category: 'Employer PF (3.67%)',      amount: challan.epf.employer_pf,              month },
      { statutory_type: 'EPF', category: 'Employer EPS (8.33%)',     amount: challan.epf.employer_eps,             month },
      { statutory_type: 'EPF', category: 'EDLI',                     amount: challan.epf.edli,                     month },
      { statutory_type: 'EPF', category: 'Admin Charges',            amount: challan.epf.admin_charges,            month },
      { statutory_type: 'ESI', category: 'Employee Contribution',    amount: challan.esi.employee_contribution,    month },
      { statutory_type: 'ESI', category: 'Employer Contribution',    amount: challan.esi.employer_contribution,    month },
      ...Object.entries(challan.ptax.by_state).map(([state, amt]) => ({
        statutory_type: 'PTAX', category: `Professional Tax — ${state}`, amount: amt, month,
      })),
    ]

    const headers = ['statutory_type','category','amount','month']
    setCsvHeaders(reply, `challan-${month}.csv`)
    return reply.send(toCSV(headers, rows))
  })

  // ── GET /payroll/exports/statutory-reconciliation ─────────────────────────────
  // Month-level reconciliation: contributions vs payroll slip deductions
  fastify.get('/statutory-reconciliation', adminAuth, async (req: any, reply) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, employee_id, format } = parsed.data

    // fetchAllRows() on all four (not plain queries): reconciliation must see
    // every finalized slip and every contribution row for the month — a
    // >1,000-row tenant would otherwise silently reconcile only a subset,
    // reporting false matches for employees that were never compared.
    let slips: any[], epfRows: any[], esiRows: any[], ptaxRows: any[]
    try {
      ;[slips, epfRows, esiRows, ptaxRows] = await Promise.all([
        fetchAllRows((from, to) => {
          let q = fastify.supabase
            .from('payroll_slips')
            .select('employee_id, gross_pay, net_pay, total_deductions, component_breakdown, employees(employee_code, first_name, last_name)')
            .eq('tenant_id', req.tenantId)
            .eq('month', month)
            .eq('status', 'finalized')
          if (employee_id) q = q.eq('employee_id', employee_id)
          return q.range(from, to)
        }),
        fetchAllRows((from, to) => {
          let q = fastify.supabase
            .from('epf_contributions')
            .select('employee_id, employee_contribution, employer_pf, employer_eps, edli_contribution')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
          if (employee_id) q = q.eq('employee_id', employee_id)
          return q.range(from, to)
        }),
        fetchAllRows((from, to) => {
          let q = fastify.supabase
            .from('esi_contributions')
            .select('employee_id, employee_contribution, employer_contribution')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
          if (employee_id) q = q.eq('employee_id', employee_id)
          return q.range(from, to)
        }),
        fetchAllRows((from, to) => {
          let q = fastify.supabase
            .from('ptax_contributions')
            .select('employee_id, ptax_amount')
            .eq('tenant_id', req.tenantId)
            .eq('contribution_month', month)
          if (employee_id) q = q.eq('employee_id', employee_id)
          return q.range(from, to)
        }),
      ])
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch reconciliation data')
    }

    const epfMap   = new Map(epfRows.map((r: any) => [r.employee_id, r]))
    const esiMap   = new Map(esiRows.map((r: any) => [r.employee_id, r]))
    const ptaxMap  = new Map(ptaxRows.map((r: any) => [r.employee_id, r]))

    const r2 = (n: number) => Math.round(n * 100) / 100

    const records = slips.map(slip => {
      const epf   = epfMap.get(slip.employee_id)  as any
      const esi   = esiMap.get(slip.employee_id)  as any
      const ptax  = ptaxMap.get(slip.employee_id) as any

      // Extract deductions from component_breakdown for comparison
      const breakdown = Array.isArray(slip.component_breakdown) ? slip.component_breakdown : []
      const findDeduction = (name: string) =>
        breakdown.find((c: any) => c.name?.toLowerCase().includes(name.toLowerCase()))?.monthly_amount ?? 0

      const slipEpf  = findDeduction('pf')
      const slipEsi  = findDeduction('esi')
      const slipPtax = findDeduction('professional tax')

      const epfContrib  = epf?.employee_contribution   ?? 0
      const esiContrib  = esi?.employee_contribution   ?? 0
      const ptaxContrib = ptax?.ptax_amount            ?? 0

      return {
        employee_code:  slip.employees?.employee_code ?? '',
        employee_name:  slip.employees ? `${slip.employees.first_name} ${slip.employees.last_name}` : '',
        month,
        gross_pay:      slip.gross_pay,
        net_pay:        slip.net_pay,
        // EPF
        slip_epf:       slipEpf,
        contrib_epf:    epfContrib,
        epf_variance:   r2(slipEpf - epfContrib),
        // ESI
        slip_esi:       slipEsi,
        contrib_esi:    esiContrib,
        esi_variance:   r2(slipEsi - esiContrib),
        // PTax
        slip_ptax:      slipPtax,
        contrib_ptax:   ptaxContrib,
        ptax_variance:  r2(slipPtax - ptaxContrib),
        // Match flag — was missing the PTax variance check, so a row with a
        // genuine PTax mismatch but matching EPF/ESI was silently marked 'Y'.
        is_matched:     (Math.abs(r2(slipEpf - epfContrib)) < 1 && Math.abs(r2(slipEsi - esiContrib)) < 1 && Math.abs(r2(slipPtax - ptaxContrib)) < 1) ? 'Y' : 'N',
      }
    })

    if (format === 'json') return reply.send({ data: records, month, count: records.length })

    const headers = [
      'employee_code','employee_name','month','gross_pay','net_pay',
      'slip_epf','contrib_epf','epf_variance',
      'slip_esi','contrib_esi','esi_variance',
      'slip_ptax','contrib_ptax','ptax_variance','is_matched',
    ]
    setCsvHeaders(reply, `statutory-recon-${month}.csv`)
    return reply.send(toCSV(headers, records))
  })
}
