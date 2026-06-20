/**
 * ManagerTeamPayrollCost — P6.11
 *
 * Team payroll cost visibility for managers. Shows per-employee gross/net pay,
 * OT cost and LOP deduction for a selected payroll month, plus team aggregates.
 * Read-only — HR/payroll retains all payroll processing authority.
 *
 * Reuses: GET /manager/team/payroll-cost?month=YYYY-MM (new P6.11 endpoint).
 */

import { useState }   from 'react'
import { useQuery }   from '@tanstack/react-query'
import { Coins, RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayrollRow {
  employee_id:     string
  name:            string | null
  employee_code:   string | null
  designation:     string | null
  gross_pay:       number
  net_pay:         number
  ot_cost:         number
  lop_deduction:   number
  volatility_index: number | null
}

interface PayrollCostResponse {
  data:       PayrollRow[]
  month:      string
  run_status: string | null
  total:      { gross_pay: number; net_pay: number; ot_cost: number; lop_deduction: number } | null
  note?:      string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(m: string, delta: number) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function VolatilityBadge({ vi }: { vi: number | null }) {
  if (vi == null) return <span className="text-muted-foreground">—</span>
  const cls = vi > 15 ? 'text-destructive font-semibold' : vi > 8 ? 'text-warning' : 'text-muted-foreground'
  return <span className={cn('tabular-nums text-xs', cls)}>{vi.toFixed(1)}%</span>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerTeamPayrollCost({ embedded = false }: { embedded?: boolean }) {
  const [month, setMonth] = useState(currentMonth())

  const { data, isFetching, refetch } = useQuery<PayrollCostResponse>({
    queryKey: ['manager-team-payroll-cost', month],
    queryFn:  () => api.get(`/manager/team/payroll-cost?month=${month}`),
    staleTime: 5 * 60_000,
  })

  const rows  = data?.data ?? []
  const total = data?.total

  const runStatusVariant = (s: string | null) => {
    if (!s) return undefined
    if (s === 'finalized') return 'default' as const
    if (s === 'draft')     return 'secondary' as const
    return 'secondary' as const
  }

  const body = (
    <>
      {/* Month navigator */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border">
          <button
            className="p-1.5 hover:bg-muted transition-colors"
            onClick={() => setMonth(m => shiftMonth(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 text-sm font-semibold tabular-nums">{month}</span>
          <button
            className="p-1.5 hover:bg-muted transition-colors"
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            disabled={month >= currentMonth()}
          >
            <ChevronRight className={cn('h-4 w-4', month >= currentMonth() && 'opacity-30')} />
          </button>
        </div>
        {data?.run_status && (
          <Badge variant={runStatusVariant(data.run_status)} className="capitalize">
            {data.run_status}
          </Badge>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Team aggregates */}
      {total && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          {[
            { label: 'Total Gross', val: total.gross_pay, cls: '' },
            { label: 'Total Net',   val: total.net_pay,   cls: 'text-success' },
            { label: 'OT Cost',     val: total.ot_cost,   cls: total.ot_cost > 0 ? 'text-warning' : '' },
            { label: 'LOP Impact',  val: total.lop_deduction, cls: total.lop_deduction > 0 ? 'text-destructive' : '' },
          ].map(tile => (
            <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">{tile.label}</p>
              <p className={cn('text-lg font-bold tabular-nums', tile.cls)}>{fmtINR(tile.val)}</p>
            </div>
          ))}
        </div>
      )}

      <SectionCard>
        {isFetching && rows.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : data?.note ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Coins className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">{data.note}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Coins className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No payroll data for this month</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-left">
                  <th className="py-2 px-4">Employee</th>
                  <th className="py-2 px-3 text-right">Gross Pay</th>
                  <th className="py-2 px-3 text-right">Net Pay</th>
                  <th className="py-2 px-3 text-right">OT Cost</th>
                  <th className="py-2 px-3 text-right">LOP</th>
                  <th className="py-2 px-3 text-right">Volatility</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.employee_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 px-4">
                      <p className="font-medium">{r.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{r.employee_code}{r.designation ? ` · ${r.designation}` : ''}</p>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtINR(r.gross_pay)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-success">{fmtINR(r.net_pay)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {r.ot_cost > 0 ? <span className="text-warning">{fmtINR(r.ot_cost)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {r.lop_deduction > 0 ? <span className="text-destructive">{fmtINR(r.lop_deduction)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <VolatilityBadge vi={r.volatility_index} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold bg-muted/20">
                    <td className="py-2 px-4 text-sm">Team Total</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtINR(total.gross_pay)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-success">{fmtINR(total.net_pay)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {total.ot_cost > 0 ? <span className="text-warning">{fmtINR(total.ot_cost)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {total.lop_deduction > 0 ? <span className="text-destructive">{fmtINR(total.lop_deduction)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 px-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )

  if (embedded) return body

  return (
    <PageContainer>
      <PageHeader
        title="Team Payroll Cost"
        subtitle="Gross pay, net pay, OT cost and LOP deduction for your team. HR manages payroll processing."
      />
      {body}
    </PageContainer>
  )
}

export default ManagerTeamPayrollCost
