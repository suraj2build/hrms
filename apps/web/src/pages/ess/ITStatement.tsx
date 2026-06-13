/**
 * ITStatement — /ess/salary/it-statement
 *
 * Annual projected Income Tax computation statement.
 * Shows complete income → deduction → taxable income → tax computation waterfall.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, AlertCircle, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'
import { printForm16, type Form16Data } from '@/lib/form16-print'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

// Indian FY (Apr–Mar) computed from today, not hardcoded — a fixed year meant the
// statement requested the wrong FY and showed nothing for the current period.
const fyOf = (d: Date) => {
  const y = d.getFullYear()
  const start = d.getMonth() >= 3 ? y : y - 1   // Apr (month 3) onwards = current FY
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
const CURRENT_FY = fyOf(new Date())
const FY_OPTIONS = [CURRENT_FY, fyOf(new Date(new Date().getFullYear() - 1, 0, 1))]

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlabDetail {
  income_range: string
  rate: number
  tax: number
}

interface MonthlyTDS {
  month: string
  gross: number
  tds: number
  cumulative_tds: number
}

interface ITStatementData {
  financial_year: string
  regime: 'old' | 'new'
  // A. Income
  salary_from_employer: number
  hra_received: number
  other_allowances: number
  previous_employer_salary: number
  gross_salary: number
  // B. Deductions
  standard_deduction: number
  professional_tax: number
  home_loan_interest_24b: number
  gross_total_income: number
  // C. Chapter VI-A
  deduction_80c: number
  deduction_80d: number
  deduction_80ccd1b: number
  total_chapter_via: number
  other_deductions: Record<string, number>
  // D. Tax
  taxable_income: number
  slab_details: SlabDetail[]
  tax_before_rebate: number
  rebate_87a: number
  surcharge: number
  cess: number
  total_tax_payable: number
  // E. TDS
  tds_by_employer_ytd: number
  tds_by_others: number
  balance_tax_payable: number
  remaining_months: number
  monthly_recovery: number
  // F. Monthly schedule
  monthly_schedule: MonthlyTDS[]
}

// ── Section components ────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  indent = false,
  bold = false,
  negative = false,
  className,
}: {
  label: string
  value: number
  indent?: boolean
  bold?: boolean
  negative?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex justify-between items-center py-1.5', indent && 'pl-4', className)}>
      <span className={cn('text-sm', bold ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
      <span className={cn('text-sm tabular-nums', bold && 'font-semibold', negative && 'text-destructive')}>
        {negative ? `(${inr(value)})` : inr(value)}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="border-t my-1" />
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <SectionCard className="p-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="font-semibold text-sm">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </SectionCard>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ITStatement() {
  const [fy, setFy] = useState(CURRENT_FY)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['it-statement', fy],
    queryFn: async () => {
      // Endpoint sends statement directly (not wrapped in { data: ... })
      const res = await api.get<ITStatementData>(`/payroll/statutory/tds/it-statement/my?financial_year=${fy}`)
      return res ?? null
    },
    staleTime: 5 * 60 * 1000,
  })

  const handleDownload = () => {
    if (!data) { toast.error('Statement not loaded yet'); return }
    const ok = printForm16(data as unknown as Form16Data)
    if (!ok) toast.error('Allow pop-ups to download your Form 16')
  }

  return (
    <PageContainer>
      <PageHeader
        title="IT Statement"
        subtitle="Annual Income Tax Computation Statement"
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
              <Download className="h-4 w-4 mr-1.5" /> Download Form 16
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
          <span>Failed to load IT statement. Please try again.</span>
        </div>
      )}

      {data && (
        <div className="space-y-4 max-w-3xl">
          {/* Regime banner */}
          <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Tax Computed as per</p>
              <p className="text-xs text-muted-foreground">Financial Year {data.financial_year}</p>
            </div>
            <Badge variant="outline" className="ml-auto capitalize font-semibold px-3">
              {data.regime} Regime
            </Badge>
          </div>

          {/* A. Income Details */}
          <CollapsibleSection title="A. Income Details">
            <StatRow label="Salary from Employer" value={data.salary_from_employer} indent />
            <StatRow label="HRA Received" value={data.hra_received} indent />
            <StatRow label="Other Allowances" value={data.other_allowances} indent />
            <StatRow label="Previous Employer Salary" value={data.previous_employer_salary} indent />
            <Divider />
            <StatRow label="Gross Salary" value={data.gross_salary} bold />
          </CollapsibleSection>

          {/* B. Deductions (Gross → Gross Total Income) */}
          <CollapsibleSection title="B. Deductions">
            <StatRow label="Gross Salary (brought forward)" value={data.gross_salary} indent />
            <StatRow label="Standard Deduction u/s 16(ia)" value={data.standard_deduction} indent negative />
            <StatRow label="Professional Tax u/s 16(iii)" value={data.professional_tax} indent negative />
            {data.home_loan_interest_24b > 0 && (
              <StatRow label="Home Loan Interest u/s 24(b)" value={data.home_loan_interest_24b} indent negative />
            )}
            <Divider />
            <StatRow label="Gross Total Income" value={data.gross_total_income} bold />
          </CollapsibleSection>

          {/* C. Chapter VI-A Deductions */}
          {data.regime === 'old' && (
            <CollapsibleSection title="C. Chapter VI-A Deductions">
              {data.deduction_80c > 0 && (
                <StatRow label="80C — Investments & Payments" value={data.deduction_80c} indent negative />
              )}
              {data.deduction_80d > 0 && (
                <StatRow label="80D — Medical Insurance" value={data.deduction_80d} indent negative />
              )}
              {data.deduction_80ccd1b > 0 && (
                <StatRow label="80CCD(1B) — NPS Additional" value={data.deduction_80ccd1b} indent negative />
              )}
              {Object.entries(data.other_deductions ?? {}).map(([key, val]) => (
                val > 0 && <StatRow key={key} label={key} value={val} indent negative />
              ))}
              <Divider />
              <StatRow label="Total Chapter VI-A Deductions" value={data.total_chapter_via} bold negative />
            </CollapsibleSection>
          )}

          {/* D. Tax Computation */}
          <CollapsibleSection title="D. Tax Computation">
            <StatRow label="Taxable Income" value={data.taxable_income} bold />

            <p className="text-xs text-muted-foreground mt-3 mb-1 font-medium">Tax on Income Slabs</p>
            <div className="rounded-lg border overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Income Range</th>
                    <th className="text-right p-2 font-medium">Rate</th>
                    <th className="text-right p-2 font-medium">Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data.slab_details ?? []).map((s, i) => (
                    <tr key={i}>
                      <td className="p-2">{s.income_range}</td>
                      <td className="p-2 text-right">{s.rate}%</td>
                      <td className="p-2 text-right tabular-nums">{inr(s.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <StatRow label="Tax Before Rebate" value={data.tax_before_rebate} indent />
            <StatRow label="(-) Rebate u/s 87A" value={data.rebate_87a} indent negative />
            <StatRow label="(+) Surcharge" value={data.surcharge} indent />
            <StatRow label="(+) Health & Education Cess @ 4%" value={data.cess} indent />
            <Divider />
            <StatRow label="Total Tax Payable" value={data.total_tax_payable} bold />
          </CollapsibleSection>

          {/* E. TDS Recovery */}
          <CollapsibleSection title="E. TDS Recovery">
            <StatRow label="Total Tax Payable" value={data.total_tax_payable} indent />
            <StatRow label="(-) TDS by Current Employer (YTD)" value={data.tds_by_employer_ytd} indent negative />
            <StatRow label="(-) TDS by Others / 26AS" value={data.tds_by_others} indent negative />
            <Divider />
            <StatRow
              label="Balance Tax Payable"
              value={data.balance_tax_payable}
              bold
              className={data.balance_tax_payable < 0 ? 'text-green-600' : ''}
            />
            <StatRow
              label={`Monthly Recovery (${data.remaining_months} remaining months)`}
              value={data.monthly_recovery}
              indent
            />
          </CollapsibleSection>

          {/* F. Monthly TDS Schedule */}
          <CollapsibleSection title="F. Monthly TDS Schedule" defaultOpen={false}>
            {(data.monthly_schedule ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No monthly data available yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Month</th>
                      <th className="text-right py-2 font-medium">Gross</th>
                      <th className="text-right py-2 font-medium">TDS</th>
                      <th className="text-right py-2 font-medium">Cumulative TDS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.monthly_schedule.map((row, i) => (
                      <tr key={i}>
                        <td className="py-2">{row.month}</td>
                        <td className="py-2 text-right tabular-nums">{inr(row.gross)}</td>
                        <td className="py-2 text-right tabular-nums">{inr(row.tds)}</td>
                        <td className="py-2 text-right tabular-nums">{inr(row.cumulative_tds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleSection>
        </div>
      )}
    </PageContainer>
  )
}
