/**
 * form16-print.ts — client-side Form 16 (Part B) generation.
 *
 * Renders the salary-certificate HTML from the existing IT-statement data and
 * opens the browser's print dialog (Save as PDF). Mirrors the offer-letter
 * print flow — zero server-side PDF dependency.
 *
 * NOTE: Part A (TDS deducted & deposited, challan/quarterly detail) is issued
 * from the Income-Tax TRACES portal and is intentionally out of scope; this is
 * the Part B salary computation certificate plus a TDS summary.
 */

export interface Form16Header {
  employee_name:   string
  employee_code:   string | null
  joining_date:    string | null
  pan:             string | null
  employer_name:   string
  employer_tan:    string | null
  assessment_year: string
}

export interface Form16Data {
  header?:                  Form16Header
  financial_year:           string
  regime:                   'old' | 'new'
  salary_from_employer:     number
  hra_received:             number
  other_allowances:         number
  previous_employer_salary: number
  gross_salary:             number
  standard_deduction:       number
  professional_tax:         number
  home_loan_interest_24b:   number
  gross_total_income:       number
  deduction_80c:            number
  deduction_80d:            number
  deduction_80ccd1b:        number
  total_chapter_via:        number
  other_deductions:         Record<string, number>
  taxable_income:           number
  tax_before_rebate:        number
  rebate_87a:               number
  surcharge:                number
  cess:                     number
  total_tax_payable:        number
  tds_by_employer_ytd:      number
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n || 0)

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

function row(label: string, value: number, opts: { bold?: boolean; indent?: boolean; neg?: boolean } = {}) {
  return `<tr class="${opts.bold ? 'b' : ''}">
    <td class="${opts.indent ? 'in' : ''}">${esc(label)}</td>
    <td class="amt">${opts.neg ? `(${inr(value)})` : inr(value)}</td>
  </tr>`
}

export function buildForm16Html(d: Form16Data): string {
  const h = d.header
  const others = d.other_deductions ?? {}
  const hraExemption = others['HRA'] ?? 0
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Form 16 (Part B) — ${esc(h?.employee_name ?? '')} — FY ${esc(d.financial_year)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 32px; font-size: 12px; }
  .doc { max-width: 760px; margin: 0 auto; }
  .hd { text-align: center; border-bottom: 2px solid #2E6FE6; padding-bottom: 12px; margin-bottom: 16px; }
  .hd h1 { margin: 0; font-size: 18px; letter-spacing: .5px; }
  .hd .sub { color: #555; font-size: 11px; margin-top: 2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 24px; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  .meta div { min-width: 220px; }
  .meta .k { color: #777; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  .meta .v { font-weight: 600; font-size: 13px; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #2E6FE6; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 0; border-bottom: 1px solid #f2f2f2; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.in { padding-left: 18px; color: #555; }
  tr.b td { font-weight: 700; border-top: 1px solid #ccc; border-bottom: none; }
  .ft { margin-top: 24px; font-size: 10px; color: #888; border-top: 1px solid #eee; padding-top: 10px; }
  @media print { body { padding: 0; } .doc { max-width: none; } }
</style></head>
<body><div class="doc">
  <div class="hd">
    <h1>FORM 16 — PART B</h1>
    <div class="sub">Certificate under Section 203 of the Income-tax Act, 1961 — Salary Income & Tax Computation</div>
  </div>

  <div class="meta">
    <div><div class="k">Employee</div><div class="v">${esc(h?.employee_name ?? '—')}</div></div>
    <div><div class="k">Employee Code</div><div class="v">${esc(h?.employee_code ?? '—')}</div></div>
    <div><div class="k">PAN of Employee</div><div class="v">${esc(h?.pan ?? '—')}</div></div>
    <div><div class="k">Employer (Deductor)</div><div class="v">${esc(h?.employer_name ?? '—')}</div></div>
    <div><div class="k">TAN of Deductor</div><div class="v">${esc(h?.employer_tan ?? '—')}</div></div>
    <div><div class="k">Financial Year</div><div class="v">${esc(d.financial_year)}</div></div>
    <div><div class="k">Assessment Year</div><div class="v">${esc(h?.assessment_year ?? '—')}</div></div>
    <div><div class="k">Tax Regime</div><div class="v">${d.regime === 'old' ? 'Old Regime' : 'New Regime'}</div></div>
  </div>

  <h2>1. Gross Salary</h2>
  <table>
    ${row('Salary as per provisions u/s 17(1)', d.salary_from_employer)}
    ${row('House Rent Allowance received', d.hra_received, { indent: true })}
    ${row('Other allowances', d.other_allowances, { indent: true })}
    ${d.previous_employer_salary ? row('Salary from previous employer', d.previous_employer_salary, { indent: true }) : ''}
    ${row('Gross Salary', d.gross_salary, { bold: true })}
  </table>

  <h2>2. Exemptions & Deductions from Salary</h2>
  <table>
    ${row('HRA exemption u/s 10(13A)', hraExemption, { neg: true })}
    ${row('Standard deduction u/s 16(ia)', d.standard_deduction, { neg: true })}
    ${row('Professional Tax u/s 16(iii)', d.professional_tax, { neg: true })}
    ${row('Interest on housing loan u/s 24(b)', d.home_loan_interest_24b, { neg: true })}
    ${row('Gross Total Income', d.gross_total_income, { bold: true })}
  </table>

  <h2>3. Deductions under Chapter VI-A</h2>
  <table>
    ${row('Section 80C', d.deduction_80c, { indent: true })}
    ${row('Section 80D', d.deduction_80d, { indent: true })}
    ${row('Section 80CCD(1B)', d.deduction_80ccd1b, { indent: true })}
    ${others['80E'] ? row('Section 80E', others['80E'], { indent: true }) : ''}
    ${others['80G'] ? row('Section 80G', others['80G'], { indent: true }) : ''}
    ${others['80TTA'] ? row('Section 80TTA', others['80TTA'], { indent: true }) : ''}
    ${row('Total Chapter VI-A deductions', d.total_chapter_via, { bold: true })}
  </table>

  <h2>4. Tax Computation</h2>
  <table>
    ${row('Total Taxable Income', d.taxable_income, { bold: true })}
    ${row('Tax on income (before rebate)', d.tax_before_rebate)}
    ${row('Rebate u/s 87A', d.rebate_87a, { neg: true })}
    ${row('Surcharge', d.surcharge)}
    ${row('Health & Education Cess', d.cess)}
    ${row('Total Tax Payable', d.total_tax_payable, { bold: true })}
    ${row('TDS deducted by employer (YTD)', d.tds_by_employer_ytd)}
  </table>

  <div class="ft">
    <p><strong>Note:</strong> This is the Part B salary computation. Part A (tax deducted & deposited with challan/quarterly detail) is issued from the Income-Tax Department TRACES portal and must be obtained separately. Amounts reflect figures recorded in the payroll system for the financial year shown.</p>
    <p>Generated by CognixHR on ${esc(generatedAt)}.</p>
  </div>
</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`
}

/** Render Form 16 (Part B) and open the browser print/save-as-PDF dialog. */
export function printForm16(d: Form16Data): boolean {
  const html = buildForm16Html(d)
  const win = window.open('', '_blank')
  if (!win) return false   // popup blocked
  win.document.open()
  win.document.write(html)
  win.document.close()
  return true
}
