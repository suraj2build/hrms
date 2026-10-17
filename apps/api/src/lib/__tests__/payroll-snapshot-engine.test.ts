/**
 * payroll-snapshot-engine — NUMERIC-as-string coercion regressions (G13 sweep)
 *
 * These immutable snapshots (compensation_snapshot, attendance_snapshot,
 * statutory_snapshot) are written once per payroll run and read forever after —
 * an uncoerced NUMERIC/DECIMAL string baked in here corrupts every downstream
 * reader (cost-center allocations, GL journal entries, replay) permanently,
 * since the row is never rewritten. Exercises buildEmployeePayrollSnapshot
 * end-to-end with DB rows shaped exactly as PostgREST/Supabase actually
 * return them: NUMERIC/DECIMAL columns as strings.
 */

import { describe, it, expect } from 'vitest'
import { buildEmployeePayrollSnapshot } from '../payroll-snapshot-engine.js'

const TENANT = 'tenant-001'
const EMP    = 'emp-001'
const MONTH  = '2026-10'

function mockSupabase(opts: {
  attendanceRows: Array<{ date: string; status: string; is_payable: boolean; day_fraction: string | number | null; overtime_minutes: number }>
  comp: {
    id: string; effective_from: string; ctc_annual: string | number; ctc_monthly: string | number
    salary_structure_id: string | null
    components: Array<{
      salary_component_id: string; value: string | number
      monthly_amount: string | number; annual_amount: string | number; sequence: number
      salary_components: { id: string; name: string; code: string; component_type: string; default_calculation_type: string }
    }>
  } | null
}) {
  return {
    from(table: string) {
      if (table === 'attendance_daily') {
        const chain: any = {
          select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain,
          order: () => Promise.resolve({ data: opts.attendanceRows, error: null }),
        }
        return chain
      }
      if (table === 'employee_compensations') {
        const chain: any = {
          select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({
            data: opts.comp ? {
              id: opts.comp.id, effective_from: opts.comp.effective_from,
              ctc_annual: opts.comp.ctc_annual, ctc_monthly: opts.comp.ctc_monthly,
              salary_structure_id: opts.comp.salary_structure_id,
              employee_compensation_components: opts.comp.components.map(c => ({
                salary_component_id: c.salary_component_id, value: c.value,
                monthly_amount: c.monthly_amount, annual_amount: c.annual_amount, sequence: c.sequence,
                salary_components: c.salary_components,
              })),
            } : null,
            error: null,
          }),
        }
        return chain
      }
      if (table === 'payroll_statutory_settings') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          // pt_enabled/tds_enabled false so the PT-slab and TDS-declaration branches
          // (extra table reads) are skipped — this test targets the attendance/
          // compensation/PF/ESI snapshot fields, not the full statutory surface.
          maybeSingle: () => Promise.resolve({ data: { pf_enabled: true, esi_enabled: true, pt_enabled: false, tds_enabled: false, tds_default_rate: '0.00', tds_default_regime: 'new' }, error: null }),
        }
        return chain
      }
      if (table === 'epf_config') {
        const chain: any = {
          select: () => chain, eq: () => chain, lte: () => chain, or: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_contribution_pct: '12.00', employer_pf_pct: '3.67', employer_eps_pct: '8.33', wage_ceiling: '15000.00', is_wage_ceiling_applicable: true }, error: null }),
        }
        return chain
      }
      if (table === 'esi_config') {
        const chain: any = {
          select: () => chain, eq: () => chain, lte: () => chain, or: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_contribution_pct: '0.75', employer_contribution_pct: '3.25', wage_ceiling: '21000.00' }, error: null }),
        }
        return chain
      }
      if (table === 'employees') {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { employee_code: 'SAAR001', profiles: { full_name: 'Test Employee' } }, error: null }) }
        return chain
      }
      // payroll_validation_rules
      const chain: any = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: [], error: null }) }
      return chain
    },
  } as any
}

const twoEarningComponents = [
  { salary_component_id: 'sc-1', value: '30000.0000', monthly_amount: '30000.00', annual_amount: '360000.00', sequence: 1, salary_components: { id: 'x', name: 'Basic', code: 'BASIC', component_type: 'earning', default_calculation_type: 'fixed' } },
  { salary_component_id: 'sc-2', value: '15000.0000', monthly_amount: '15000.00', annual_amount: '180000.00', sequence: 2, salary_components: { id: 'y', name: 'HRA', code: 'HRA', component_type: 'earning', default_calculation_type: 'fixed' } },
]

describe('buildEmployeePayrollSnapshot — DB-string NUMERIC fields (G13 sweep)', () => {
  it('compensation_snapshot components/ctc are real numbers, and sum correctly across 2+ components', async () => {
    const supabase = mockSupabase({
      attendanceRows: [
        { date: '2026-10-01', status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
        { date: '2026-10-02', status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
      ],
      comp: { id: 'comp-1', effective_from: '2026-01-01', ctc_annual: '540000.00', ctc_monthly: '45000.00', salary_structure_id: null, components: twoEarningComponents },
    })

    const result = await buildEmployeePayrollSnapshot(supabase, TENANT, EMP, MONTH, null)

    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    expect(result.compensation_snapshot.ctc_monthly).toBe(45000)
    expect(result.compensation_snapshot.ctc_annual).toBe(540000)
    const grossFromSnapshot = result.compensation_snapshot.components.reduce((s: number, c: any) => s + c.monthly_amount, 0)
    expect(grossFromSnapshot).toBe(45000)   // 30000 + 15000, not "30000.0015000.00" / NaN
    expect(Number.isNaN(grossFromSnapshot)).toBe(false)
  })

  it('attendance_snapshot payable_days sums 2+ string day_fraction rows without corrupting', async () => {
    const supabase = mockSupabase({
      attendanceRows: [
        { date: '2026-10-01', status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
        { date: '2026-10-02', status: 'half_day', is_payable: true, day_fraction: '0.5', overtime_minutes: 0 },
        { date: '2026-10-03', status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
      ],
      comp: { id: 'comp-1', effective_from: '2026-01-01', ctc_annual: '360000.00', ctc_monthly: '30000.00', salary_structure_id: null, components: [twoEarningComponents[0]] },
    })

    const result = await buildEmployeePayrollSnapshot(supabase, TENANT, EMP, MONTH, null)

    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    expect(result.attendance_snapshot.payable_days).toBe(2.5)
    expect(result.attendance_snapshot.lop_days).toBe(0.5)
    expect(Number.isNaN(result.attendance_snapshot.payable_days)).toBe(false)
  })

  it('statutory_snapshot PF employer_rate_pct sums two DB-string percentages correctly', async () => {
    const supabase = mockSupabase({
      attendanceRows: [{ date: '2026-10-01', status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 }],
      comp: { id: 'comp-1', effective_from: '2026-01-01', ctc_annual: '360000.00', ctc_monthly: '30000.00', salary_structure_id: null, components: [twoEarningComponents[0]] },
    })

    const result = await buildEmployeePayrollSnapshot(supabase, TENANT, EMP, MONTH, null)

    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    // employer_pf_pct "3.67" + employer_eps_pct "8.33" -> 12, not "3.678.33" -> NaN
    expect(result.statutory_snapshot.pf.employer_rate_pct).toBe(12)
    expect(result.statutory_snapshot.pf.wage_ceiling).toBe(15000)
    expect(result.statutory_snapshot.esi.wage_ceiling).toBe(21000)
  })

  it('null computed_monthly/annual_amount components default to 0, not NaN, in the snapshot', async () => {
    const supabase = mockSupabase({
      attendanceRows: [{ date: '2026-10-01', status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 }],
      comp: {
        id: 'comp-1', effective_from: '2026-01-01', ctc_annual: '120000.00', ctc_monthly: '10000.00', salary_structure_id: null,
        components: [{ salary_component_id: 'sc-1', value: '0', monthly_amount: null as any, annual_amount: null as any, sequence: 1, salary_components: { id: 'x', name: 'Allowance', code: 'ALLOW', component_type: 'earning', default_calculation_type: 'fixed' } }],
      },
    })

    const result = await buildEmployeePayrollSnapshot(supabase, TENANT, EMP, MONTH, null)

    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    expect(result.compensation_snapshot.components[0].monthly_amount).toBe(0)
    expect(Number.isNaN(result.compensation_snapshot.components[0].monthly_amount)).toBe(false)
  })
})
