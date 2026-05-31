/**
 * AccountingExportService — converts payroll data to accounting formats.
 *
 * Supports: CSV journal entries, Tally XML vouchers, QuickBooks IIF.
 * PURE COMPUTATION — no DB access. Caller passes payroll data.
 */

export type AccountingFormat = 'csv_journal' | 'tally_xml' | 'quickbooks_iif'

export interface JournalEntry {
  date:         string    // YYYY-MM-DD
  voucher_no?:  string
  ledger_dr:    string    // Debit ledger name (e.g., "Salary Expenses")
  ledger_cr:    string    // Credit ledger name (e.g., "Bank Account")
  amount:       number
  narration:    string
  cost_centre?: string
}

export interface PayrollExportInput {
  period:   string    // e.g., "2024-01"
  org_name: string
  entries:  Array<{
    employee_id:       string
    employee_name:     string
    gross_pay:         number
    net_pay:           number
    epf_employee:      number
    epf_employer:      number
    esi_employee:      number
    esi_employer:      number
    tds:               number
    professional_tax:  number
    other_deductions:  number
  }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function tallyDate(isoDate: string): string {
  // Convert YYYY-MM-DD → YYYYMMDD
  return isoDate.replace(/-/g, '')
}

function qbDate(isoDate: string): string {
  // Convert YYYY-MM-DD → MM/DD/YYYY
  const [y, m, d] = isoDate.split('-')
  return `${m}/${d}/${y}`
}

function escapeXML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function periodToDate(period: string): string {
  // period like "2024-01" → "2024-01-01"
  return `${period}-01`
}

// ---------------------------------------------------------------------------
// AccountingExportService
// ---------------------------------------------------------------------------

export class AccountingExportService {
  /** Generate CSV journal entries for a payroll run */
  toCSVJournal(input: PayrollExportInput): string {
    const lines: string[] = [
      'Date,VoucherNo,LedgerDr,LedgerCr,Amount,Narration,CostCentre',
    ]
    const date = periodToDate(input.period)
    let voucherIndex = 1

    for (const emp of input.entries) {
      const vno = (idx: number) => `PAY-${input.period}-${String(idx).padStart(4, '0')}`
      const narration = (desc: string) =>
        `${desc} - ${emp.employee_name} (${emp.employee_id}) | ${input.period}`

      const row = (dr: string, cr: string, amount: number, narr: string) =>
        [date, vno(voucherIndex++), escapeCSV(dr), escapeCSV(cr), amount.toFixed(2), escapeCSV(narr), ''].join(',')

      // 1. Gross Pay: DR "Salary Expenses" CR "Payroll Payable"
      if (emp.gross_pay > 0) {
        lines.push(row('Salary Expenses', 'Payroll Payable', emp.gross_pay, narration('Gross Salary')))
      }

      // 2. EPF employer: DR "EPF Employer Contribution" CR "EPF Payable"
      if (emp.epf_employer > 0) {
        lines.push(row('EPF Employer Contribution', 'EPF Payable', emp.epf_employer, narration('EPF Employer')))
      }

      // 3. ESI employer: DR "ESI Employer Contribution" CR "ESI Payable"
      if (emp.esi_employer > 0) {
        lines.push(row('ESI Employer Contribution', 'ESI Payable', emp.esi_employer, narration('ESI Employer')))
      }

      // 4. TDS: DR "Payroll Payable" CR "TDS Payable"
      if (emp.tds > 0) {
        lines.push(row('Payroll Payable', 'TDS Payable', emp.tds, narration('TDS Deduction')))
      }

      // 5. Net Pay: DR "Payroll Payable" CR "Bank Account"
      if (emp.net_pay > 0) {
        lines.push(row('Payroll Payable', 'Bank Account', emp.net_pay, narration('Net Salary')))
      }
    }

    return lines.join('\n')
  }

  /** Generate Tally XML voucher format */
  toTallyXML(input: PayrollExportInput): string {
    const date = periodToDate(input.period)
    const tDate = tallyDate(date)
    const messages: string[] = []

    for (const emp of input.entries) {
      const narration = `Payroll ${input.period} - ${emp.employee_name} (${emp.employee_id})`

      const voucher = (dr: string, cr: string, amount: number) => `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Journal" ACTION="Create">
            <DATE>${tDate}</DATE>
            <NARRATION>${escapeXML(narration)}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXML(dr)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${(-amount).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXML(cr)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>`

      if (emp.gross_pay > 0) messages.push(voucher('Salary Expenses', 'Payroll Payable', emp.gross_pay))
      if (emp.epf_employer > 0) messages.push(voucher('EPF Employer Contribution', 'EPF Payable', emp.epf_employer))
      if (emp.esi_employer > 0) messages.push(voucher('ESI Employer Contribution', 'ESI Payable', emp.esi_employer))
      if (emp.tds > 0) messages.push(voucher('Payroll Payable', 'TDS Payable', emp.tds))
      if (emp.net_pay > 0) messages.push(voucher('Payroll Payable', 'Bank Account', emp.net_pay))
    }

    return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>${messages.join('')}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`
  }

  /** Generate QuickBooks IIF format */
  toQuickBooksIIF(input: PayrollExportInput): string {
    const lines: string[] = [
      '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
      '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
      '!ENDTRNS',
    ]

    const date = qbDate(periodToDate(input.period))
    const memo = `Payroll ${input.period}`
    let trnsId = 1

    const addTransaction = (
      drAccount: string,
      crAccount: string,
      amount: number,
      txMemo: string,
    ) => {
      const id = trnsId++
      lines.push(
        `TRNS\t${id}\tGENERAL JOURNAL\t${date}\t${drAccount}\t${(-amount).toFixed(2)}\t${txMemo}`,
      )
      lines.push(
        `SPL\t${id}\tGENERAL JOURNAL\t${date}\t${crAccount}\t${amount.toFixed(2)}\t${txMemo}`,
      )
      lines.push('ENDTRNS')
    }

    for (const emp of input.entries) {
      const empMemo = `${memo} - ${emp.employee_name}`
      if (emp.gross_pay > 0) addTransaction('Salary Expenses', 'Payroll Payable', emp.gross_pay, empMemo)
      if (emp.epf_employer > 0) addTransaction('EPF Employer Contribution', 'EPF Payable', emp.epf_employer, empMemo)
      if (emp.esi_employer > 0) addTransaction('ESI Employer Contribution', 'ESI Payable', emp.esi_employer, empMemo)
      if (emp.tds > 0) addTransaction('Payroll Payable', 'TDS Payable', emp.tds, empMemo)
      if (emp.net_pay > 0) addTransaction('Payroll Payable', 'Bank Account', emp.net_pay, empMemo)
    }

    return lines.join('\n')
  }

  /** Export in specified format */
  export(input: PayrollExportInput, format: AccountingFormat): string {
    switch (format) {
      case 'csv_journal':     return this.toCSVJournal(input)
      case 'tally_xml':       return this.toTallyXML(input)
      case 'quickbooks_iif':  return this.toQuickBooksIIF(input)
    }
  }
}

export const accountingExportService = new AccountingExportService()
