/**
 * Compliance Filing Pack
 *
 * Generates regulator-ready files from finalized payroll data.
 * All exports read ONLY from immutable contribution tables and finalized slips.
 *
 * GET  /payroll/filing-pack/readiness     — pre-flight readiness check (EPF/ESI/PTax/TDS)
 * GET  /payroll/filing-pack/ecr           — ECR 2.0 text file (EPFO upload format)
 * GET  /payroll/filing-pack/24q           — Form 24Q deductee data CSV (Annexure I + II)
 * GET  /payroll/filing-pack/challan       — Consolidated challan data sheet
 * GET  /payroll/filing-pack/artifacts     — List of previously generated artifacts
 * POST /payroll/filing-pack/artifacts     — Record a generated artifact
 * PATCH /payroll/filing-pack/artifacts/:id — Update artifact status
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'

// ── Shared helpers ────────────────────────────────────────────────────────────

function r2(n: number) { return Math.round(n * 100) / 100 }
function sum(arr: any[], key: string) { return r2(arr.reduce((s, r) => s + (r[key] ?? 0), 0)) }

function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return `${headers.join(',')}\n${rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n')}`
}

function setCsvHeaders(reply: any, filename: string) {
  reply.header('Content-Type', 'text/csv; charset=utf-8')
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
}

function setTxtHeaders(reply: any, filename: string) {
  reply.header('Content-Type', 'text/plain; charset=utf-8')
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
}

// "2024-03" → "03/2024"
function monthToDDMMYYYY(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  return `${m}/${y}`
}

// "2024-03" → "01/04/2024" (last day + 1 → salary due)
function salaryDueDate(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  return `01/${String(Number(m) + 1).padStart(2, '0')}/${Number(m) === 12 ? Number(y) + 1 : y}`
}

function todayDDMMYYYY(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

// Quarter helpers (Indian FY: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)
// Returns [startMonth, endMonth] as YYYY-MM strings
function quarterMonths(quarter: number, fy: string): string[] {
  const [startYear] = fy.split('-').map(Number)
  const monthRanges: Record<number, [number, number, number]> = {
    1: [startYear,     4, 6],
    2: [startYear,     7, 9],
    3: [startYear,     10, 12],
    4: [startYear + 1, 1, 3],
  }
  const [yr, startM, endM] = monthRanges[quarter] ?? [startYear, 4, 6]
  const months: string[] = []
  for (let m = startM; m <= endM; m++) {
    months.push(`${yr}-${String(m).padStart(2, '0')}`)
  }
  return months
}

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function filingPackRoutes(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }] }

  const monthSchema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  })

  // ── GET /payroll/filing-pack/readiness ──────────────────────────────────────
  fastify.get('/readiness', adminAuth, async (req: any, reply) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month } = parsed.data

    // Run all checks in parallel
    const [
      epfContribs,
      esiContribs,
      ptaxContribs,
      epfReg,
      esiReg,
      ptaxRegs,
      finalizedSlips,
      allSlips,
    ] = await Promise.all([
      fastify.supabase
        .from('epf_contributions')
        .select('employee_id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month),

      fastify.supabase
        .from('esi_contributions')
        .select('employee_id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month),

      fastify.supabase
        .from('ptax_contributions')
        .select('state_code', { count: 'exact', head: false })
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month),

      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'epf')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'esi')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('statutory_registrations')
        .select('state_code, registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'ptax')
        .eq('is_active', true),

      fastify.supabase
        .from('payroll_slips')
        .select('employee_id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('month', month)
        .eq('status', 'finalized'),

      fastify.supabase
        .from('payroll_slips')
        .select('employee_id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('month', month),
    ])

    // UAN check: get EPF employee IDs then check overrides
    const epfCount = epfContribs.count ?? 0
    let missingUan = 0
    if (epfCount > 0) {
      const { data: epfEmpRows } = await fastify.supabase
        .from('epf_contributions')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month)

      const epfEmpIds = (epfEmpRows ?? []).map((r: any) => r.employee_id)

      if (epfEmpIds.length > 0) {
        const { data: uanData } = await fastify.supabase
          .from('epf_eligibility_overrides')
          .select('employee_id')
          .eq('tenant_id', req.tenantId)
          .in('employee_id', epfEmpIds)
          .not('uan', 'is', null)
          .is('effective_to', null)

        const uanCovered = new Set((uanData ?? []).map((r: any) => r.employee_id))
        missingUan = epfEmpIds.filter(id => !uanCovered.has(id)).length
      }
    }

    // PAN check: employees who had TDS deducted this month
    const { data: tdsSlips } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, tds_deducted')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('status', 'finalized')
      .gt('tds_deducted', 0)

    const tdsEmpIds = (tdsSlips ?? []).map((r: any) => r.employee_id)
    let missingPan = 0
    if (tdsEmpIds.length > 0) {
      const { data: panData } = await fastify.supabase
        .from('employee_bank_statutory')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', tdsEmpIds)
        .not('pan_number', 'is', null)

      const panCovered = new Set((panData ?? []).map((r: any) => r.employee_id))
      missingPan = tdsEmpIds.filter(id => !panCovered.has(id)).length
    }

    // PTax: which states have contributions but no registration
    const ptaxRows  = (ptaxContribs.data ?? []) as any[]
    const ptaxStates = [...new Set(ptaxRows.map((r: any) => r.state_code).filter(Boolean))] as string[]
    const ptaxRegMap = new Map<string, string>()
    for (const r of (ptaxRegs.data ?? []) as any[]) ptaxRegMap.set(r.state_code, r.registration_number)
    const ptaxMissingReg = ptaxStates.filter(s => !ptaxRegMap.has(s))

    // Build result
    const epfReady  = epfCount > 0 && !!epfReg.data?.registration_number && missingUan === 0
    const esiReady  = (esiContribs.count ?? 0) > 0 && !!esiReg.data?.registration_number
    const ptaxReady = ptaxRows.length === 0 || (ptaxStates.length > 0 && ptaxMissingReg.length === 0)
    const tdsReady  = (allSlips.count ?? 0) > 0 && missingPan === 0

    const finalCount = finalizedSlips.count ?? 0
    const totalCount = allSlips.count ?? 0
    const payrollReady = totalCount > 0 && finalCount === totalCount

    return reply.send({
      month,
      overall_ready: epfReady && esiReady && ptaxReady && tdsReady && payrollReady,
      checks: {
        payroll: {
          ready:            payrollReady,
          finalized_count:  finalCount,
          total_count:      totalCount,
          issues: payrollReady ? [] : [
            totalCount === 0
              ? 'No payroll slips found for this month'
              : `${totalCount - finalCount} slip(s) not yet finalized`,
          ],
        },
        epf: {
          ready:               epfReady,
          employee_count:      epfCount,
          missing_uan:         missingUan,
          registration_number: (epfReg.data as any)?.registration_number ?? null,
          issues: [
            ...(missingUan > 0         ? [`${missingUan} employee(s) missing UAN`]              : []),
            ...(!epfReg.data?.registration_number ? ['EPF registration number not configured'] : []),
            ...(epfCount === 0         ? ['No EPF contributions found for this month']           : []),
          ],
        },
        esi: {
          ready:               esiReady,
          employee_count:      esiContribs.count ?? 0,
          registration_number: (esiReg.data as any)?.registration_number ?? null,
          issues: [
            ...(!(esiContribs.count ?? 0)                ? ['No ESI contributions found for this month']          : []),
            ...(!esiReg.data?.registration_number        ? ['ESI registration number not configured']             : []),
          ],
        },
        ptax: {
          ready:                ptaxReady,
          employee_count:       ptaxRows.length,
          states:               ptaxStates,
          missing_registrations: ptaxMissingReg,
          issues: ptaxMissingReg.length > 0
            ? [`PTax registration missing for: ${ptaxMissingReg.join(', ')}`]
            : [],
        },
        tds: {
          ready:          tdsReady,
          employee_count: tdsEmpIds.length,
          missing_pan:    missingPan,
          issues: [
            ...(missingPan > 0 ? [`${missingPan} employee(s) with TDS but missing PAN`] : []),
          ],
        },
      },
    })
  })

  // ── GET /payroll/filing-pack/ecr ────────────────────────────────────────────
  // ECR 2.0 text file — EPFO monthly upload format
  fastify.get('/ecr', adminAuth, async (req: any, reply) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month } = parsed.data

    const [epfResult, regResult, tenantResult] = await Promise.all([
      fastify.supabase
        .from('epf_contributions')
        .select(`
          employee_id, pf_wages, employee_contribution, voluntary_pf,
          employer_pf, employer_eps, edli_contribution,
          employees(employee_code, first_name, last_name)
        `)
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month)
        .order('employees(employee_code)', { ascending: true }),

      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number, code_label')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'epf')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('tenants')
        .select('name')
        .eq('id', req.tenantId)
        .single(),
    ])

    if (epfResult.error) return reply.code(500).send({ error: 'QUERY_FAILED', message: epfResult.error.message })

    const rows     = (epfResult.data ?? []) as any[]
    const reg      = (regResult.data   as any) ?? {}
    const tenant   = (tenantResult.data as any) ?? {}

    // Fetch UANs
    const empIds = rows.map(r => r.employee_id)
    const uanMap = new Map<string, string>()
    if (empIds.length > 0) {
      const { data: uanRows } = await fastify.supabase
        .from('epf_eligibility_overrides')
        .select('employee_id, uan')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', empIds)
        .not('uan', 'is', null)
        .is('effective_to', null)
      for (const u of (uanRows ?? []) as any[]) uanMap.set(u.employee_id, u.uan)
    }

    // Aggregate totals for header
    const totPfWages  = sum(rows, 'pf_wages')
    const totEpf      = sum(rows, 'employee_contribution')
    const totEps      = sum(rows, 'employer_eps')
    const totDiff     = r2(rows.reduce((s, r) => s + r2((r.employer_pf ?? 0) - (r.employer_eps ?? 0)), 0))
    const totNcp      = 0  // ncp_days not stored in epf_contributions — EPFO portal fills from biometric

    const estId   = reg.registration_number ?? ''
    const estName = tenant.name ?? ''
    const wageMonth = monthToDDMMYYYY(month)
    const dueDate   = salaryDueDate(month)
    const today     = todayDDMMYYYY()

    // ECR 2.0 format
    const lines: string[] = [
      '#~#',
      [
        'HEADER RECORD:',
        'VERSION NUMBER', '1.0',
        'ESTABLISHMENT ID', estId,
        'ESTABLISHMENT NAME', estName,
        'WAGE MONTH', wageMonth,
        'SALARY DUE DATE', dueDate,
        'UPLOAD DATE', today,
        'TOTAL MEMBERS', String(rows.length),
        'TOTAL EPF WAGES', String(totPfWages),
        'TOTAL EPF CONTRIBUTION REMITTED', String(totEpf),
        'TOTAL EPS CONTRIBUTION REMITTED', String(totEps),
        'TOTAL EPF EPS DIFFERENCE REMITTED', String(totDiff),
        'TOTAL NCP DAYS', String(totNcp),
        'TOTAL REFUND OF ADVANCES', '0',
        '',
      ].join('~'),
      '#~#',
      'UAN~MEMBER ID~MEMBER NAME~GROSS PF WAGES~EPF CONTRIBUTION~EPS CONTRIBUTION~EPF-EPS DIFFERENCE~NCP DAYS~REFUND OF ADVANCES',
    ]

    for (const r of rows) {
      const emp  = r.employees ?? {}
      const name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim().toUpperCase()
      const diff = r2((r.employer_pf ?? 0) - (r.employer_eps ?? 0))
      lines.push([
        uanMap.get(r.employee_id) ?? '',
        emp.employee_code ?? '',
        name,
        r.pf_wages ?? 0,
        r.employee_contribution ?? 0,
        r.employer_eps ?? 0,
        diff,
        0,  // ncp_days — not stored; fill manually before EPFO upload if needed
        0,  // refund of advances
      ].join('~'))
    }

    lines.push('#~#')

    setTxtHeaders(reply, `ECR2_${estId}_${month}.txt`)
    return reply.send(lines.join('\r\n'))
  })

  // ── GET /payroll/filing-pack/24q ────────────────────────────────────────────
  // Form 24Q data CSV — Annexure I (challan) + Annexure II (deductees)
  fastify.get('/24q', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      quarter:        z.enum(['Q1','Q2','Q3','Q4']),
      financial_year: z.string().regex(/^\d{4}-\d{2}$/, 'financial_year must be YYYY-YY (e.g. 2024-25)'),
      sheet:          z.enum(['annexure_i', 'annexure_ii', 'both']).optional().default('both'),
      format:         z.enum(['csv','json']).optional().default('csv'),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { quarter, financial_year, sheet, format } = parsed.data
    const qNum = Number(quarter.slice(1))  // 'Q1' → 1

    // Expand FY "2024-25" → full year number 2024
    const [fyStart] = financial_year.split('-').map(Number)
    const months = quarterMonths(qNum, `${fyStart}-${String(fyStart + 1).slice(2)}`)

    // Fetch finalized payroll slips for the quarter
    const { data: slipsData, error: slipsErr } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        employee_id, month, gross_pay, tds_deducted,
        employees(employee_code, first_name, last_name)
      `)
      .eq('tenant_id', req.tenantId)
      .in('month', months)
      .eq('status', 'finalized')
      .order('month', { ascending: true })

    if (slipsErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: slipsErr.message })
    const slips = (slipsData ?? []) as any[]

    // Fetch PANs
    const empIds = [...new Set(slips.map(r => r.employee_id))]
    const panMap = new Map<string, string>()
    if (empIds.length > 0) {
      const { data: panRows } = await fastify.supabase
        .from('employee_bank_statutory')
        .select('employee_id, pan_number')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', empIds)
      for (const p of (panRows ?? []) as any[]) {
        if (p.pan_number) panMap.set(p.employee_id, p.pan_number)
      }
    }

    // ── Annexure I — Challan summary (one row per month in the quarter) ────────
    // Note: BSR code, challan number, and deposit date are filled by the deductor
    // AFTER they remit TDS to the bank. We provide the computed amounts.
    const annexureI = months.map(m => {
      const monthSlips = slips.filter(s => s.month === m)
      const tdsAmt = r2(monthSlips.reduce((s, r) => s + (r.tds_deducted ?? 0), 0))
      return {
        quarter,
        financial_year,
        salary_month:      m,
        section_code:      '192A',      // TDS on salary
        tds_amount:        tdsAmt,
        surcharge:         0,
        education_cess:    0,
        total_tax_deposited: tdsAmt,
        bsr_code:          '',          // fill after bank remittance
        challan_date:      '',          // fill after bank remittance
        challan_number:    '',          // fill after bank remittance
        deposit_type:      '(200)',     // normal (200) vs book entry (400)
        employee_count:    monthSlips.length,
      }
    }).filter(r => r.employee_count > 0)

    // ── Annexure II — Deductee details ─────────────────────────────────────────
    // One row per employee per quarter (aggregated across all months)
    const deducteeMap = new Map<string, any>()
    for (const s of slips) {
      const eid = s.employee_id
      if (!deducteeMap.has(eid)) {
        const emp = s.employees ?? {}
        deducteeMap.set(eid, {
          employee_code: emp.employee_code ?? '',
          employee_name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
          pan:           panMap.get(eid) ?? 'PANNOTAVBL',
          quarter,
          financial_year,
          section_code:  '192A',
          gross_salary:  0,
          tds_deducted:  0,
          months_worked: new Set<string>(),
        })
      }
      const d = deducteeMap.get(eid)!
      d.gross_salary = r2(d.gross_salary + (s.gross_pay ?? 0))
      d.tds_deducted = r2(d.tds_deducted + (s.tds_deducted ?? 0))
      d.months_worked.add(s.month)
    }

    const annexureII = [...deducteeMap.values()].map(d => ({
      employee_code:     d.employee_code,
      employee_name:     d.employee_name,
      pan:               d.pan,
      quarter:           d.quarter,
      financial_year:    d.financial_year,
      section_code:      d.section_code,
      gross_salary:      d.gross_salary,
      tds_deducted:      d.tds_deducted,
      months_in_quarter: d.months_worked.size,
      pan_status:        d.pan === 'PANNOTAVBL' ? 'MISSING' : 'OK',
    }))

    if (format === 'json') {
      return reply.send({
        quarter,
        financial_year,
        months,
        annexure_i:  annexureI,
        annexure_ii: annexureII,
      })
    }

    // CSV: output requested sheet(s)
    if (sheet === 'annexure_i' || sheet === 'both') {
      if (sheet === 'annexure_i') {
        const headers = ['quarter','financial_year','salary_month','section_code','tds_amount','surcharge','education_cess','total_tax_deposited','bsr_code','challan_date','challan_number','deposit_type','employee_count']
        setCsvHeaders(reply, `24Q_${financial_year}_${quarter}_AnnexureI.csv`)
        return reply.send(toCSV(headers, annexureI))
      }
    }

    if (sheet === 'annexure_ii') {
      const headers = ['employee_code','employee_name','pan','quarter','financial_year','section_code','gross_salary','tds_deducted','months_in_quarter','pan_status']
      setCsvHeaders(reply, `24Q_${financial_year}_${quarter}_AnnexureII.csv`)
      return reply.send(toCSV(headers, annexureII))
    }

    // sheet === 'both': combine with section markers
    const ai_headers = ['quarter','financial_year','salary_month','section_code','tds_amount','surcharge','education_cess','total_tax_deposited','bsr_code','challan_date','challan_number','deposit_type','employee_count']
    const aii_headers = ['employee_code','employee_name','pan','quarter','financial_year','section_code','gross_salary','tds_deducted','months_in_quarter','pan_status']
    const combined = [
      '# FORM 24Q — ANNEXURE I — CHALLAN DETAILS',
      '# NOTE: bsr_code / challan_date / challan_number must be filled after TDS remittance',
      toCSV(ai_headers, annexureI),
      '',
      '# FORM 24Q — ANNEXURE II — DEDUCTEE DETAILS',
      toCSV(aii_headers, annexureII),
    ].join('\n')

    setCsvHeaders(reply, `24Q_${financial_year}_${quarter}.csv`)
    return reply.send(combined)
  })

  // ── GET /payroll/filing-pack/challan ─────────────────────────────────────────
  // Consolidated statutory challan data sheet for the month
  fastify.get('/challan', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      month:  z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
      format: z.enum(['csv','json']).optional().default('json'),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, format } = parsed.data

    const [epfRes, esiRes, ptaxRes, tdsRes, epfReg, esiReg, ptaxRegs] = await Promise.all([
      fastify.supabase
        .from('epf_contributions')
        .select('employee_contribution, voluntary_pf, employer_pf, employer_eps, edli_contribution, pf_wages')
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month),

      fastify.supabase
        .from('esi_contributions')
        .select('employee_contribution, employer_contribution, total_contribution')
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month),

      fastify.supabase
        .from('ptax_contributions')
        .select('ptax_amount, state_code')
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month),

      fastify.supabase
        .from('payroll_slips')
        .select('tds_deducted')
        .eq('tenant_id', req.tenantId)
        .eq('month', month)
        .eq('status', 'finalized'),

      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'epf')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'esi')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('statutory_registrations')
        .select('state_code, registration_number')
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'ptax')
        .eq('is_active', true),
    ])

    const epfRows  = (epfRes.data  ?? []) as any[]
    const esiRows  = (esiRes.data  ?? []) as any[]
    const ptaxRows = (ptaxRes.data ?? []) as any[]
    const tdsRows  = (tdsRes.data  ?? []) as any[]

    const ptaxRegMap = new Map<string, string>()
    for (const r of (ptaxRegs.data ?? []) as any[]) ptaxRegMap.set(r.state_code, r.registration_number)

    const ptaxByState: Record<string, number> = {}
    for (const r of ptaxRows) {
      ptaxByState[r.state_code] = r2((ptaxByState[r.state_code] ?? 0) + (r.ptax_amount ?? 0))
    }

    // Admin charges = 0.50% of aggregate PF wages (EPFO standard rate)
    const epfAdminCharges = r2(sum(epfRows, 'pf_wages') * 0.005)

    const challan = {
      month,
      epf: {
        registration_number:   (epfReg.data as any)?.registration_number ?? null,
        employee_contribution: sum(epfRows, 'employee_contribution'),
        voluntary_pf:          sum(epfRows, 'voluntary_pf'),
        employer_pf:           sum(epfRows, 'employer_pf'),
        employer_eps:          sum(epfRows, 'employer_eps'),
        edli:                  sum(epfRows, 'edli_contribution'),
        admin_charges:         epfAdminCharges,
        total_remittance: r2(
          sum(epfRows, 'employee_contribution') + sum(epfRows, 'voluntary_pf') +
          sum(epfRows, 'employer_pf')           + sum(epfRows, 'employer_eps') +
          sum(epfRows, 'edli_contribution')      + epfAdminCharges
        ),
        employee_count: epfRows.length,
        challan_type:   'EPFO ECR',
        portal:         'https://unifiedportal-emp.epfindia.gov.in',
      },
      esi: {
        registration_number:   (esiReg.data as any)?.registration_number ?? null,
        employee_contribution: sum(esiRows, 'employee_contribution'),
        employer_contribution: sum(esiRows, 'employer_contribution'),
        total_remittance:      sum(esiRows, 'total_contribution'),
        employee_count:        esiRows.length,
        challan_type:          'ESIC Challan',
        portal:                'https://www.esic.in',
      },
      ptax: {
        by_state:      Object.entries(ptaxByState).map(([state, amount]) => ({
          state_code:          state,
          registration_number: ptaxRegMap.get(state) ?? null,
          amount,
        })),
        total_remittance: r2(ptaxRows.reduce((s, r) => s + (r.ptax_amount ?? 0), 0)),
        employee_count:   ptaxRows.length,
        challan_type:     'PT Challan',
      },
      tds: {
        total_deducted: r2(tdsRows.reduce((s, r) => s + (r.tds_deducted ?? 0), 0)),
        employee_count: tdsRows.filter((r: any) => (r.tds_deducted ?? 0) > 0).length,
        challan_type:   'ITNS 281',
        section:        '192A',
        portal:         'https://www.tin-nsdl.com',
        note:           'Remit before 7th of following month. Obtain BSR code + challan number for 24Q filing.',
      },
      grand_total_remittance: r2(
        sum(epfRows, 'employee_contribution') + sum(epfRows, 'voluntary_pf') +
        sum(epfRows, 'employer_pf')           + sum(epfRows, 'employer_eps') +
        sum(epfRows, 'edli_contribution')      + epfAdminCharges +
        sum(esiRows, 'total_contribution')    +
        r2(ptaxRows.reduce((s: number, r: any) => s + (r.ptax_amount ?? 0), 0)) +
        r2(tdsRows.reduce((s: number, r: any) => s + (r.tds_deducted ?? 0), 0))
      ),
    }

    if (format === 'json') return reply.send({ data: challan })

    // CSV: flat rows
    const csvRows: Record<string, unknown>[] = [
      { statutory_type: 'EPF', category: 'Employee PF Contribution',  amount: challan.epf.employee_contribution, registration: challan.epf.registration_number, portal: challan.epf.portal, month },
      { statutory_type: 'EPF', category: 'Voluntary PF',              amount: challan.epf.voluntary_pf,          registration: challan.epf.registration_number, portal: challan.epf.portal, month },
      { statutory_type: 'EPF', category: 'Employer PF (3.67%)',       amount: challan.epf.employer_pf,           registration: challan.epf.registration_number, portal: challan.epf.portal, month },
      { statutory_type: 'EPF', category: 'Employer EPS (8.33%)',      amount: challan.epf.employer_eps,          registration: challan.epf.registration_number, portal: challan.epf.portal, month },
      { statutory_type: 'EPF', category: 'EDLI',                      amount: challan.epf.edli,                  registration: challan.epf.registration_number, portal: challan.epf.portal, month },
      { statutory_type: 'EPF', category: 'Admin Charges',             amount: challan.epf.admin_charges,         registration: challan.epf.registration_number, portal: challan.epf.portal, month },
      { statutory_type: 'ESI', category: 'Employee ESI Contribution', amount: challan.esi.employee_contribution, registration: challan.esi.registration_number, portal: challan.esi.portal, month },
      { statutory_type: 'ESI', category: 'Employer ESI Contribution', amount: challan.esi.employer_contribution, registration: challan.esi.registration_number, portal: challan.esi.portal, month },
      ...challan.ptax.by_state.map(s => ({
        statutory_type: 'PTAX', category: `Professional Tax — ${s.state_code}`, amount: s.amount, registration: s.registration_number, portal: '', month,
      })),
      { statutory_type: 'TDS', category: 'TDS on Salary (Sec 192A)',  amount: challan.tds.total_deducted, registration: 'TAN (fill manually)', portal: challan.tds.portal, month },
    ]
    setCsvHeaders(reply, `challan-${month}.csv`)
    return reply.send(toCSV(['statutory_type','category','amount','registration','portal','month'], csvRows))
  })

  // ── GET /payroll/filing-pack/artifacts ──────────────────────────────────────
  fastify.get('/artifacts', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      month:          z.string().regex(/^\d{4}-\d{2}$/).optional(),
      financial_year: z.string().optional(),
      limit:          z.coerce.number().int().min(1).max(100).optional().default(50),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, financial_year, limit } = parsed.data

    let q = fastify.supabase
      .from('statutory_filing_artifacts')
      .select('*, profiles(full_name)')
      .eq('tenant_id', req.tenantId)
      .order('generated_at', { ascending: false })
      .limit(limit)

    if (month)          q = q.eq('period_month', month)
    if (financial_year) q = q.eq('period_fy', financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/filing-pack/artifacts ─────────────────────────────────────
  fastify.post('/artifacts', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      artifact_type:  z.enum(['ecr_2_0','24q','challan_epf','challan_esi','challan_ptax','challan_tds','challan_all']),
      period_month:   z.string().regex(/^\d{4}-\d{2}$/).optional(),
      period_quarter: z.number().int().min(1).max(4).optional(),
      period_fy:      z.string().optional(),
      file_name:      z.string().min(1),
      row_count:      z.number().int().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('statutory_filing_artifacts')
      .insert({
        tenant_id:      req.tenantId,
        generated_by:   req.userId,
        status:         'generated',
        ...parsed.data,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_filing_artifacts',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { ...parsed.data, status: 'generated' } as Record<string, unknown>,
    })

    return reply.code(201).send({ data })
  })

  // ── PATCH /payroll/filing-pack/artifacts/:id ─────────────────────────────────
  fastify.patch('/artifacts/:id', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      status: z.enum(['submitted','acknowledged']),
      notes:  z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const update: Record<string, unknown> = { status: parsed.data.status }
    if (parsed.data.notes) update.notes = parsed.data.notes
    if (parsed.data.status === 'submitted')    update.submitted_at    = new Date().toISOString()
    if (parsed.data.status === 'acknowledged') update.acknowledged_at = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('statutory_filing_artifacts')
      .update(update)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data)  return reply.code(404).send({ error: 'NOT_FOUND', message: 'Artifact not found' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_filing_artifacts',
      recordId:    req.params.id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: parsed.data.status, notes: parsed.data.notes } as Record<string, unknown>,
    })

    return reply.send({ data })
  })
}
