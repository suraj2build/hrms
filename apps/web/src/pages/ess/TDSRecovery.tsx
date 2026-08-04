/**
 * TDSRecovery — /ess/tax/tds-recovery
 *
 * ESS page showing the employee's month-by-month TDS recovery projection
 * for the selected financial year.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle, Info, Calculator } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Label }         from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api/client'
import { cn, formatCurrency }  from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => formatCurrency(n)

// Indian FY (Apr–Mar) from today — not hardcoded (a fixed year showed no data).
const fyOf = (d: Date) => {
  const y = d.getFullYear()
  const start = d.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
const CURRENT_FY = fyOf(new Date())
const FY_OPTIONS = [
  CURRENT_FY,
  fyOf(new Date(new Date().getFullYear() - 1, 0, 1)),
  fyOf(new Date(new Date().getFullYear() - 2, 0, 1)),
]

// Returns YYYY-MM for the current month
const currentYearMonth = () => {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TaxRegime = 'old' | 'new'

interface MonthlyRecovery {
  month: string               // YYYY-MM or human label e.g. "Apr 2025"
  month_key: string           // YYYY-MM for current comparison
  projected_annual_tax: number
  already_deducted: number
  external_tds: number
  remaining_tax: number
  cycles_left: number
  monthly_recovery: number
  regime: TaxRegime
}

interface TDSRecoveryData {
  financial_year: string
  projected_annual_tax: number
  already_deducted: number
  remaining_tax: number
  next_month_recovery: number
  months: MonthlyRecovery[]
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <Card className={cn(highlight && 'border-primary/40 bg-primary/5')}>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={cn('text-xl font-semibold tabular-nums', highlight && 'text-primary')}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TDSRecovery() {
  const [fy, setFy] = useState(CURRENT_FY)
  const thisMonth   = currentYearMonth()

  const { data, isLoading, isError } = useQuery<TDSRecoveryData>({
    queryKey: ['tds-recovery-my', fy],
    queryFn:  () => api.get(`/payroll/statutory/tds/recovery/my?financial_year=${fy}`),
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="TDS Recovery Projection"
        subtitle="Month-by-month projection of your income tax deduction for the selected financial year."
      />

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-info/30 bg-info/10 text-info text-sm">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Your monthly TDS is computed based on your active tax declaration, prior employer
          details, and payroll processed so far. Values for future months are projections and
          may change.
        </span>
      </div>

      {/* FY selector */}
      <div className="flex items-center gap-3 mb-6">
        <Label className="text-sm font-medium whitespace-nowrap">Financial Year</Label>
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FY_OPTIONS.map(y => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading recovery data…</span>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center justify-center py-24 gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Failed to load TDS recovery data. Please try again.</span>
        </div>
      )}

      {/* Data */}
      {!isLoading && !isError && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Projected Annual Tax"
              value={inr(data.projected_annual_tax)}
            />
            <SummaryCard
              label="Already Deducted"
              value={inr(data.already_deducted)}
            />
            <SummaryCard
              label="Remaining Tax"
              value={inr(data.remaining_tax)}
            />
            <SummaryCard
              label="Next Month Recovery"
              value={inr(data.next_month_recovery)}
              sub="Projected deduction"
              highlight
            />
          </div>

          {/* Monthly table */}
          <SectionCard title="Monthly Recovery Schedule" icon={<Calculator className="h-4 w-4" />}>
            {data.months.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Calculator className="h-8 w-8 opacity-40" />
                <p className="text-sm text-center max-w-xs">
                  No recovery data available — will be computed when payroll is processed.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Month</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Projected Annual Tax</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Already Deducted</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">External TDS</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Remaining Tax</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Cycles Left</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Monthly Recovery</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Regime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map(row => {
                      const isCurrent = row.month_key === thisMonth
                      return (
                        <tr
                          key={row.month_key}
                          className={cn(
                            'border-b hover:bg-muted/30 transition-colors',
                            isCurrent && 'bg-primary/5 font-medium'
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span>{row.month}</span>
                              {isCurrent && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
                                  Current
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {inr(row.projected_annual_tax)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {inr(row.already_deducted)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {row.external_tds > 0 ? inr(row.external_tds) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {inr(row.remaining_tax)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {row.cycles_left}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {inr(row.monthly_recovery)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] capitalize',
                                row.regime === 'new'
                                  ? 'bg-primary/10 text-primary border-primary/30'
                                  : 'bg-muted text-muted-foreground border-border'
                              )}
                            >
                              {row.regime}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* No data state (request succeeded but empty) */}
      {!isLoading && !isError && !data && (
        <div className="flex flex-col items-center justify-center py-24 gap-2 text-muted-foreground">
          <Calculator className="h-8 w-8 opacity-40" />
          <p className="text-sm">
            No recovery data available — will be computed when payroll is processed.
          </p>
        </div>
      )}
    </PageContainer>
  )
}
