/**
 * YTDStatement — /ess/salary/ytd
 *
 * Year-to-date payroll statement. Shows monthly breakdown of earnings,
 * deductions, and net pay; plus employer contribution summary.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn, formatCurrency }            from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => formatCurrency(n)

// Indian FY (Apr–Mar) from today — not hardcoded (a fixed year showed no data).
const fyOf = (d: Date) => {
  const y = d.getFullYear()
  const start = d.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
const CURRENT_FY = fyOf(new Date())
const FY_OPTIONS = [CURRENT_FY, fyOf(new Date(new Date().getFullYear() - 1, 0, 1))]

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthlyRow {
  month: string          // 'Apr 25'
  basic: number
  hra: number
  special: number
  other_earnings: number
  gross: number
  pf_employee: number
  pt: number
  tds: number
  other_deductions: number
  net_pay: number
  work_days: number
}

interface EmployerRow {
  month: string
  pf_employer: number
  esi_employer: number
  total_ctc: number
}

interface YTDData {
  financial_year: string
  total_gross: number
  total_tds: number
  total_pf_employee: number
  total_net_pay: number
  monthly_rows: MonthlyRow[]
  employer_rows: EmployerRow[]
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function YTDStatement() {
  const [fy, setFy] = useState(CURRENT_FY)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ytd-statement', fy],
    queryFn: async () => {
      // Endpoint returns the object directly (not wrapped in { data: ... })
      const res = await api.get<YTDData>(`/payroll/statutory/tds/ytd/my?financial_year=${fy}`)
      return res ?? null
    },
    staleTime: 5 * 60_000,
  })

  // Browser print → "Save as PDF" is the most reliable way to export this
  // statement without a server-side PDF pipeline.
  const handleDownload = () => {
    toast.info('Choose "Save as PDF" in the print dialog to download')
    window.print()
  }

  // Totals from monthly rows (use API totals if available, otherwise compute)
  const totals: MonthlyRow | null = data
    ? {
        month: 'Total',
        basic:            data.monthly_rows.reduce((s, r) => s + r.basic, 0),
        hra:              data.monthly_rows.reduce((s, r) => s + r.hra, 0),
        special:          data.monthly_rows.reduce((s, r) => s + r.special, 0),
        other_earnings:   data.monthly_rows.reduce((s, r) => s + r.other_earnings, 0),
        gross:            data.total_gross,
        pf_employee:      data.total_pf_employee,
        pt:               data.monthly_rows.reduce((s, r) => s + r.pt, 0),
        tds:              data.total_tds,
        other_deductions: data.monthly_rows.reduce((s, r) => s + r.other_deductions, 0),
        net_pay:          data.total_net_pay,
        work_days:        data.monthly_rows.reduce((s, r) => s + r.work_days, 0),
      }
    : null

  const employerTotals: EmployerRow | null = data
    ? {
        month:        'Total',
        pf_employer:  data.employer_rows.reduce((s, r) => s + r.pf_employer, 0),
        esi_employer: data.employer_rows.reduce((s, r) => s + r.esi_employer, 0),
        total_ctc:    data.employer_rows.reduce((s, r) => s + r.total_ctc, 0),
      }
    : null

  return (
    <PageContainer>
      <PageHeader
        title="YTD Statement"
        subtitle="Year-to-date payroll summary"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={fy}
              onChange={e => setFy(e.target.value)}
              className="text-sm border rounded-md px-2 py-1.5 bg-background"
            >
              {FY_OPTIONS.map(f => <option key={f}>{f}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1.5" /> Download
            </Button>
          </div>
        }
      />

      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex h-64 items-center justify-center text-destructive gap-2">
          <AlertCircle className="h-5 w-5" />
          <span>Failed to load YTD statement. Please try again.</span>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Summary cards */}
          <MetricRow cols={4}>
            <MetricCard label="Total Gross" value={inr(data.total_gross)} variant="info" subtitle={`FY ${data.financial_year}`} />
            <MetricCard label="Total TDS" value={inr(data.total_tds)} variant="destructive" subtitle="Income tax deducted" />
            <MetricCard label="Total PF (Employee)" value={inr(data.total_pf_employee)} variant="warning" subtitle="Your contribution" />
            <MetricCard label="Total Net Pay" value={inr(data.total_net_pay)} variant="success" subtitle="Take-home" />
          </MetricRow>

          {/* Monthly breakdown table */}
          <SectionCard title="Monthly Earnings & Deductions">
            {data.monthly_rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No payroll data for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {[
                        'Month', 'Basic', 'HRA', 'Special', 'Gross',
                        'PF Emp', 'PT', 'TDS', 'Net Pay', 'Days',
                      ].map(h => (
                        <th key={h} className={cn('py-2 px-2 font-medium', h === 'Month' ? 'text-left' : 'text-right')}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.monthly_rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-2 font-medium">{row.month}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(row.basic)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(row.hra)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(row.special)}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">{inr(row.gross)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{inr(row.pf_employee)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{inr(row.pt)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{inr(row.tds)}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold text-primary">{inr(row.net_pay)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{row.work_days}</td>
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot>
                      <tr className="border-t-2 bg-muted/40 font-semibold">
                        <td className="py-2 px-2">Total</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.basic)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.hra)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.special)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.gross)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.pf_employee)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.pt)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{inr(totals.tds)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-primary">{inr(totals.net_pay)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{totals.work_days}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </SectionCard>

          {/* Employer contributions */}
          <SectionCard title="Employer Contributions">
            {data.employer_rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No employer contribution data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Month', 'PF Employer', 'ESI Employer', 'Total CTC'].map(h => (
                        <th key={h} className={cn('py-2 px-3 font-medium', h === 'Month' ? 'text-left' : 'text-right')}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.employer_rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-3 font-medium">{row.month}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{inr(row.pf_employer)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{inr(row.esi_employer)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold">{inr(row.total_ctc)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {employerTotals && (
                    <tfoot>
                      <tr className="border-t-2 bg-muted/40 font-semibold">
                        <td className="py-2 px-3">Total</td>
                        <td className="py-2 px-3 text-right tabular-nums">{inr(employerTotals.pf_employer)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{inr(employerTotals.esi_employer)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-primary">{inr(employerTotals.total_ctc)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </PageContainer>
  )
}
