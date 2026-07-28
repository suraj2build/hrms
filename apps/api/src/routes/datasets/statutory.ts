/**
 * Canonical Statutory Dataset — /datasets/statutory
 *
 * Single source of truth for statutory totals and filing readiness consumed by:
 *   - StatutoryDashboard
 *   - FilingPackCenter
 *   - Reports page
 *
 * GET /datasets/statutory
 *   ?month  YYYY-MM  (required) — the payroll month to report on
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// Rows per .in() call — a large tenant's employee-id list for these lookups
// can exceed both PostgREST's 1,000-row response ceiling and safe request-URL
// length if sent in one call.
const ID_CHUNK = 200

async function fetchByIdsChunked<T>(
  fn: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ids: string[],
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data } = await fn(ids.slice(i, i + ID_CHUNK))
    if (data) out.push(...data)
  }
  return out
}

// Slips advance finalized → processed → paid; all count as final for reporting.
const FINAL_SLIP_STATUSES = ['finalized', 'processed', 'paid', 'completed']

function r2(n: number): number { return Math.round(n * 100) / 100 }

export default async function statutoryDataset(fastify: FastifyInstance) {
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      (req: any, reply: any, done: () => void) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
          return
        }
        done()
      },
    ],
  }

  // ── GET /datasets/statutory/exceptions ──────────────────────────────────────
  // Per-employee statutory identifier completeness — drives the compliance
  // dashboard's "missing IDs" exception list. Reads from employee_bank_statutory
  // (the SSOT for statutory identifiers). No new business logic.
  fastify.get('/exceptions', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId

    const FIELDS = [
      { key: 'pan',     label: 'PAN',      col: 'pan_number'     },
      { key: 'uan',     label: 'UAN',      col: 'uan_number'     },
      { key: 'aadhaar', label: 'Aadhaar',  col: 'aadhaar_number' },
      { key: 'esi',     label: 'ESI No.',  col: 'esi_number'     },
      { key: 'bank',    label: 'Bank A/C', col: 'account_number' },
      { key: 'ifsc',    label: 'IFSC',     col: 'ifsc_code'      },
    ] as const

    // Paginated — this feeds the compliance dashboard's completeness %, so an
    // unbounded .select() silently truncating at PostgREST's 1,000-row ceiling
    // would understate both total_employees and the missing-ID exception list
    // for any tenant above that size.
    let empList: any[]
    try {
      empList = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select(`
            id, employee_code, first_name, last_name,
            job_history!job_history_employee_id_fkey ( is_current, departments ( name ) )
          `)
          .eq('tenant_id', tid)
          .eq('status', 'active')
          .eq('job_history.is_current', true)
          .range(from, to),
      )
    } catch (empErr) {
      return reply.code(500).send({ error: 'DB_ERROR', message: empErr instanceof Error ? empErr.message : 'Failed to fetch employees' })
    }

    const ids = empList.map(e => e.id)

    const bsMap = new Map<string, any>()
    if (ids.length > 0) {
      const bs = await fetchByIdsChunked<any>(
        (chunk) => fastify.supabase
          .from('employee_bank_statutory')
          .select('employee_id, pan_number, aadhaar_number, uan_number, esi_number, account_number, ifsc_code')
          .eq('tenant_id', tid)
          .in('employee_id', chunk),
        ids,
      )
      for (const r of bs) bsMap.set(r.employee_id, r)
    }

    const fieldMissing: Record<string, number> = {}
    for (const f of FIELDS) fieldMissing[f.key] = 0

    const has = (v: any) => v != null && String(v).trim() !== ''

    const employees: Array<{ id: string; employee_code: string; name: string; department: string; missing: string[] }> = []
    for (const e of empList) {
      const rec = bsMap.get(e.id) ?? {}
      const missing: string[] = []
      for (const f of FIELDS) {
        if (!has(rec[f.col])) { missing.push(f.label); fieldMissing[f.key]++ }
      }
      if (missing.length > 0) {
        const jh = Array.isArray(e.job_history) ? e.job_history[0] : e.job_history
        employees.push({
          id:            e.id,
          employee_code: e.employee_code,
          name:          `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
          department:    (jh?.departments as any)?.name ?? 'Unassigned',
          missing,
        })
      }
    }

    const total      = empList.length
    const incomplete = employees.length

    return reply.send({
      summary: {
        total_employees: total,
        complete:        total - incomplete,
        incomplete,
        completeness_pct: total > 0 ? r2(((total - incomplete) / total) * 100) : 100,
      },
      by_field: FIELDS.map(f => ({ field: f.key, label: f.label, missing: fieldMissing[f.key] })),
      employees: employees.sort((a, b) => b.missing.length - a.missing.length).slice(0, 200),
    })
  })

  fastify.get('/', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    if (!q.month || !/^\d{4}-\d{2}$/.test(q.month)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'month (YYYY-MM) is required' })
    }
    const month = q.month

    // ── Parallel primary queries ────────────────────────────────────────────────
    // epf/esi/ptax/lwf contributions are paginated — a month's rows across the
    // whole tenant can exceed PostgREST's 1,000-row ceiling, which would
    // silently understate every remittance total this dataset reports.
    let epfRows: any[]
    try {
      epfRows = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('epf_contributions')
          .select('employee_id, employee_contribution, employer_pf, employer_eps, edli_contribution, pf_wages, voluntary_pf')
          .eq('tenant_id', tid)
          .eq('contribution_month', month)
          .range(from, to),
      )
    } catch (epfErr) {
      return reply.code(500).send({ error: 'DB_ERROR', message: epfErr instanceof Error ? epfErr.message : 'Failed to fetch EPF contributions' })
    }

    const [
      esiRows,
      ptaxRows,
      lwfRows,
    ] = await Promise.all([
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('esi_contributions')
          .select('employee_id, employee_contribution, employer_contribution')
          .eq('tenant_id', tid)
          .eq('contribution_month', month)
          .range(from, to),
      ).catch(() => []),

      fetchAllRows((from, to) =>
        fastify.supabase
          .from('ptax_contributions')
          .select('employee_id, ptax_amount, state_code')
          .eq('tenant_id', tid)
          .eq('contribution_month', month)
          .range(from, to),
      ).catch(() => []),

      fetchAllRows((from, to) =>
        fastify.supabase
          .from('lwf_contributions')
          .select('employee_id, employee_contribution, employer_contribution, state_code')
          .eq('tenant_id', tid)
          .eq('contribution_month', month)
          .range(from, to),
      ).catch(() => []),
    ])

    const [
      epfRegRes,
      esiRegRes,
      ptaxRegsRes,
      finalizedSlipsRes,
      allSlipsRes,
    ] = await Promise.all([
      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number')
        .eq('tenant_id', tid)
        .eq('statutory_type', 'epf')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('statutory_registrations')
        .select('registration_number')
        .eq('tenant_id', tid)
        .eq('statutory_type', 'esi')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),

      fastify.supabase
        .from('statutory_registrations')
        .select('state_code, registration_number')
        .eq('tenant_id', tid)
        .eq('statutory_type', 'ptax')
        .eq('is_active', true),

      fastify.supabase
        .from('payroll_slips')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tid)
        .eq('month', month)
        .in('status', FINAL_SLIP_STATUSES),

      fastify.supabase
        .from('payroll_slips')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tid)
        .eq('month', month),
    ])

    // A transient failure here must not silently read as "no registrations /
    // no slips submitted yet" — finalizedCount/totalCount feed directly into
    // payrollReady and the top-level filing-readiness verdict this endpoint
    // exists to compute (same PEND-21 pattern already fixed in the sibling
    // payroll-cost.ts main handler).
    if (epfRegRes.error)        return serverError(req, reply, epfRegRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch EPF registration')
    if (esiRegRes.error)        return serverError(req, reply, esiRegRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch ESI registration')
    if (ptaxRegsRes.error)      return serverError(req, reply, ptaxRegsRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch PTax registrations')
    if (finalizedSlipsRes.error) return serverError(req, reply, finalizedSlipsRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch finalized payroll slips')
    if (allSlipsRes.error)      return serverError(req, reply, allSlipsRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll slips')

    const epfRegNum  = (epfRegRes.data  as any)?.registration_number ?? null
    const esiRegNum  = (esiRegRes.data  as any)?.registration_number ?? null

    const ptaxRegMap = new Map<string, string>()
    for (const r of (ptaxRegsRes.data ?? []) as any[]) {
      ptaxRegMap.set(r.state_code, r.registration_number)
    }

    const finalizedCount = finalizedSlipsRes.count ?? 0
    const totalCount     = allSlipsRes.count ?? 0

    // ── EPF: missing UAN check ──────────────────────────────────────────────────
    let missingUan = 0
    if (epfRows.length > 0) {
      const epfEmpIds = epfRows.map((r: any) => r.employee_id)
      const uanData = await fetchByIdsChunked<{ employee_id: string }>(
        (chunk) => fastify.supabase
          .from('epf_eligibility_overrides')
          .select('employee_id')
          .eq('tenant_id', tid)
          .in('employee_id', chunk)
          .not('uan', 'is', null)
          .is('effective_to', null),
        epfEmpIds,
      )

      const uanCovered = new Set(uanData.map((r) => r.employee_id))
      missingUan = epfEmpIds.filter((id: string) => !uanCovered.has(id)).length
    }

    // ── TDS: employees with TDS deducted + missing PAN check ───────────────────
    // Paginated — a month's finalized slips with TDS deducted can exceed 1,000
    // rows for a large tenant.
    const tdsSlipRows = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('payroll_slips')
        .select('employee_id, tds_deducted')
        .eq('tenant_id', tid)
        .eq('month', month)
        .in('status', FINAL_SLIP_STATUSES)
        .gt('tds_deducted', 0)
        .range(from, to),
    )

    const tdsEmpIds    = tdsSlipRows.map((r: any) => r.employee_id)
    const employeesWithTds = tdsEmpIds.length

    let missingPan = 0
    if (tdsEmpIds.length > 0) {
      const panData = await fetchByIdsChunked<{ employee_id: string }>(
        (chunk) => fastify.supabase
          .from('employee_bank_statutory')
          .select('employee_id')
          .eq('tenant_id', tid)
          .in('employee_id', chunk)
          .not('pan_number', 'is', null),
        tdsEmpIds,
      )

      const panCovered = new Set((panData ?? []).map((r: any) => r.employee_id))
      missingPan = tdsEmpIds.filter((id: string) => !panCovered.has(id)).length
    }

    // ── PTax: states + missing registrations ───────────────────────────────────
    const ptaxStates = [...new Set(ptaxRows.map((r: any) => r.state_code).filter(Boolean))] as string[]
    const ptaxMissingRegs = ptaxStates.filter(s => !ptaxRegMap.has(s))

    // ── Totals ──────────────────────────────────────────────────────────────────
    const sumEpfEmpContrib  = r2(epfRows.reduce((s: number, r: any) => s + (r.employee_contribution ?? 0), 0))
    const sumEmployerPf     = r2(epfRows.reduce((s: number, r: any) => s + (r.employer_pf ?? 0), 0))
    const sumEmployerEps    = r2(epfRows.reduce((s: number, r: any) => s + (r.employer_eps ?? 0), 0))
    const sumEdli           = r2(epfRows.reduce((s: number, r: any) => s + (r.edli_contribution ?? 0), 0))
    const sumPfWages        = r2(epfRows.reduce((s: number, r: any) => s + (r.pf_wages ?? 0), 0))
    const adminCharges      = r2(sumPfWages * 0.005)
    const epfTotalRemittance = r2(sumEpfEmpContrib + sumEmployerPf + sumEmployerEps + sumEdli + adminCharges)

    const sumEsiEmpContrib   = r2(esiRows.reduce((s: number, r: any) => s + (r.employee_contribution ?? 0), 0))
    const sumEsiEmpContrib2  = r2(esiRows.reduce((s: number, r: any) => s + (r.employer_contribution ?? 0), 0))
    const esiTotalRemittance = r2(sumEsiEmpContrib + sumEsiEmpContrib2)

    const ptaxByState: Record<string, number> = {}
    for (const r of ptaxRows) {
      ptaxByState[r.state_code] = r2((ptaxByState[r.state_code] ?? 0) + (r.ptax_amount ?? 0))
    }
    const sumPtax = r2(ptaxRows.reduce((s: number, r: any) => s + (r.ptax_amount ?? 0), 0))

    const sumTdsDeducted = r2(tdsSlipRows.reduce((s: number, r: any) => s + (r.tds_deducted ?? 0), 0))

    const sumLwfEmp   = r2(lwfRows.reduce((s: number, r: any) => s + (r.employee_contribution ?? 0), 0))
    const sumLwfEmpr  = r2(lwfRows.reduce((s: number, r: any) => s + (r.employer_contribution ?? 0), 0))
    const lwfTotal    = r2(sumLwfEmp + sumLwfEmpr)
    const lwfStates   = [...new Set(lwfRows.map((r: any) => r.state_code).filter(Boolean))] as string[]

    const grandTotal = r2(epfTotalRemittance + esiTotalRemittance + sumPtax + sumTdsDeducted + lwfTotal)

    // ── Readiness ───────────────────────────────────────────────────────────────
    const epfReady     = epfRows.length > 0 && !!epfRegNum && missingUan === 0
    const esiReady     = esiRows.length > 0 && !!esiRegNum
    const ptaxReady    = ptaxRows.length === 0 || (ptaxStates.length > 0 && ptaxMissingRegs.length === 0)
    const tdsReady     = employeesWithTds === 0 || missingPan === 0
    const payrollReady = totalCount > 0 && finalizedCount === totalCount

    const issues: string[] = []
    if (!epfReady) {
      if (epfRows.length === 0)  issues.push('No EPF contributions found for this month')
      if (!epfRegNum)            issues.push('EPF registration number not configured')
      if (missingUan > 0)        issues.push(`${missingUan} employee(s) missing UAN`)
    }
    if (!esiReady) {
      if (esiRows.length === 0)  issues.push('No ESI contributions found for this month')
      if (!esiRegNum)            issues.push('ESI registration number not configured')
    }
    if (!ptaxReady && ptaxMissingRegs.length > 0) {
      issues.push(`PTax registration missing for: ${ptaxMissingRegs.join(', ')}`)
    }
    if (!tdsReady && missingPan > 0) {
      issues.push(`${missingPan} employee(s) with TDS but missing PAN`)
    }
    if (!payrollReady) {
      if (totalCount === 0) issues.push('No payroll slips found for this month')
      else issues.push(`${totalCount - finalizedCount} slip(s) not yet finalized`)
    }

    return reply.send({
      meta: {
        month,
        generated_at: new Date().toISOString(),
      },
      coverage: {
        epf: {
          enrolled:            epfRows.length,
          missing_uan:         missingUan,
          registration_number: epfRegNum,
          has_registration:    !!epfRegNum,
        },
        esi: {
          eligible:            esiRows.length,
          registration_number: esiRegNum,
          has_registration:    !!esiRegNum,
        },
        ptax: {
          enrolled:              ptaxRows.length,
          states:                ptaxStates,
          missing_registrations: ptaxMissingRegs,
        },
        tds: {
          employees_with_tds: employeesWithTds,
          missing_pan:        missingPan,
        },
        lwf: {
          enrolled: lwfRows.length,
          states:   lwfStates,
        },
        payroll: {
          finalized:     finalizedCount,
          total:         totalCount,
          all_finalized: totalCount > 0 && finalizedCount === totalCount,
        },
      },
      totals: {
        epf: {
          employee_contribution: sumEpfEmpContrib,
          employer_pf:           sumEmployerPf,
          employer_eps:          sumEmployerEps,
          edli:                  sumEdli,
          admin_charges:         adminCharges,
          total_remittance:      epfTotalRemittance,
        },
        esi: {
          employee_contribution: sumEsiEmpContrib,
          employer_contribution: sumEsiEmpContrib2,
          total_remittance:      esiTotalRemittance,
        },
        ptax: {
          amount:   sumPtax,
          by_state: Object.entries(ptaxByState).map(([state_code, amount]) => ({ state_code, amount })),
        },
        tds: {
          total_deducted: sumTdsDeducted,
        },
        lwf: {
          employee_contribution: sumLwfEmp,
          employer_contribution: sumLwfEmpr,
          total_remittance:      lwfTotal,
        },
        grand_total: grandTotal,
      },
      readiness: {
        overall:       epfReady && esiReady && ptaxReady && tdsReady && payrollReady,
        epf_ready:     epfReady,
        esi_ready:     esiReady,
        ptax_ready:    ptaxReady,
        tds_ready:     tdsReady,
        payroll_ready: payrollReady,
        issues,
      },
    })
  })
}
