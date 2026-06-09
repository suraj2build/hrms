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

function r2(n: number): number { return Math.round(n * 100) / 100 }

export default async function statutoryDataset(fastify: FastifyInstance) {
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      (req: any, reply: any, done: () => void) => {
        if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
          return
        }
        done()
      },
    ],
  }

  fastify.get('/', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    if (!q.month || !/^\d{4}-\d{2}$/.test(q.month)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'month (YYYY-MM) is required' })
    }
    const month = q.month

    // ── Parallel primary queries ────────────────────────────────────────────────
    const [
      epfRes,
      esiRes,
      ptaxRes,
      epfRegRes,
      esiRegRes,
      ptaxRegsRes,
      finalizedSlipsRes,
      allSlipsRes,
    ] = await Promise.all([
      fastify.supabase
        .from('epf_contributions')
        .select('employee_id, employee_contribution, employer_pf, employer_eps, edli_contribution, pf_wages, voluntary_pf')
        .eq('tenant_id', tid)
        .eq('contribution_month', month),

      fastify.supabase
        .from('esi_contributions')
        .select('employee_id, employee_contribution, employer_contribution')
        .eq('tenant_id', tid)
        .eq('contribution_month', month),

      fastify.supabase
        .from('ptax_contributions')
        .select('employee_id, ptax_amount, state_code')
        .eq('tenant_id', tid)
        .eq('contribution_month', month),

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
        .eq('status', 'finalized'),

      fastify.supabase
        .from('payroll_slips')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tid)
        .eq('month', month),
    ])

    if (epfRes.error) return reply.code(500).send({ error: 'DB_ERROR', message: epfRes.error.message })

    const epfRows  = (epfRes.data  ?? []) as any[]
    const esiRows  = (esiRes.data  ?? []) as any[]
    const ptaxRows = (ptaxRes.data ?? []) as any[]

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
      const { data: uanData } = await fastify.supabase
        .from('epf_eligibility_overrides')
        .select('employee_id')
        .eq('tenant_id', tid)
        .in('employee_id', epfEmpIds)
        .not('uan', 'is', null)
        .is('effective_to', null)

      const uanCovered = new Set((uanData ?? []).map((r: any) => r.employee_id))
      missingUan = epfEmpIds.filter((id: string) => !uanCovered.has(id)).length
    }

    // ── TDS: employees with TDS deducted + missing PAN check ───────────────────
    const { data: tdsSlips } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, tds_deducted')
      .eq('tenant_id', tid)
      .eq('month', month)
      .eq('status', 'finalized')
      .gt('tds_deducted', 0)

    const tdsSlipRows  = (tdsSlips ?? []) as any[]
    const tdsEmpIds    = tdsSlipRows.map((r: any) => r.employee_id)
    const employeesWithTds = tdsEmpIds.length

    let missingPan = 0
    if (tdsEmpIds.length > 0) {
      const { data: panData } = await fastify.supabase
        .from('employee_bank_statutory')
        .select('employee_id')
        .eq('tenant_id', tid)
        .in('employee_id', tdsEmpIds)
        .not('pan_number', 'is', null)

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

    const grandTotal = r2(epfTotalRemittance + esiTotalRemittance + sumPtax + sumTdsDeducted)

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
