/**
 * StatutoryReconciliationCenter — /admin/payroll/statutory-reconciliation
 *
 * PF · ESI · PT · TDS reconciliation: payable vs computed vs filed, variances,
 * ready-for-filing status, and drill-down into each statutory head.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState }                from 'react'
import { Link }                    from 'react-router-dom'
import { useQuery, useMutation }   from '@tanstack/react-query'
import { toast }                   from 'sonner'
import {
  Scale, CheckCircle2, AlertTriangle, RefreshCw,
  ChevronRight, FileText, Landmark, Shield,
  Loader2, BadgeCheck, DollarSign, Calculator,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatutoryHeadRecon {
  payable:  number
  computed: number
  variance: number
  label:    string
  ready:    boolean
}

interface StatutoryRecon {
  run:  { id: string; month: string; status: string; employee_count: number }
  pf:   StatutoryHeadRecon
  esi:  StatutoryHeadRecon
  pt:   StatutoryHeadRecon
  tds:  StatutoryHeadRecon
  ready_for_filing: boolean
  total_statutory:  number
}

interface PayrollRun { id: string; month: string; status: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}
function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Statutory Head Card ────────────────────────────────────────────────────────

interface HeadCardProps {
  label:   string
  head:    StatutoryHeadRecon
  route?:  string
  icon:    React.ReactNode
}

function HeadCard({ label, head, route, icon }: HeadCardProps) {
  const hasVariance = Math.abs(head.variance) >= 1
  return (
    <div className={cn(
      'flex flex-col gap-3 p-4 rounded-xl border',
      head.ready ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('p-1.5 rounded-lg', head.ready ? 'bg-success/15' : 'bg-warning/15')}>
            {icon}
          </div>
          <span className="text-sm font-semibold">{label}</span>
        </div>
        {head.ready
          ? <Badge variant="outline" className="text-success border-success/40 text-[9px] rounded-full gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" />Ready
            </Badge>
          : <Badge variant="outline" className="text-warning border-warning/40 text-[9px] rounded-full gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />Variance
            </Badge>
        }
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Computed</span>
          <span className="font-medium tabular-nums">{fmtCurrency(head.computed)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Payable</span>
          <span className="font-medium tabular-nums">{fmtCurrency(head.payable)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Filed</span>
          <span className="font-medium tabular-nums text-muted-foreground/60">—</span>
        </div>
        <div className="h-px bg-border/50 my-1" />
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Variance</span>
          <span className={cn('font-semibold tabular-nums', hasVariance ? 'text-warning' : 'text-success')}>
            {head.variance >= 0 ? '+' : ''}{fmtCurrency(head.variance)}
          </span>
        </div>
      </div>

      {route && (
        <Link to={route}
          className="flex items-center justify-between text-[10px] text-primary hover:underline mt-1">
          View Details <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function StatutoryReconciliationCenter() {
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined)

  const { data: runsRaw } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ['payroll-runs-statutory'],
    queryFn:  () => api.get('/payroll/runs?limit=12'),
    staleTime: 60_000,
  })
  const runs = runsRaw?.data ?? []

  const { data: reconRaw, isLoading, refetch } = useQuery<{ data: StatutoryRecon | null }>({
    queryKey: ['statutory-recon', selectedMonth],
    queryFn:  () => api.get(`/payroll/statutory-reconciliation${selectedMonth ? `?month=${selectedMonth}` : ''}`),
    staleTime: 60_000,
  })
  const recon = reconRaw?.data ?? null

  // Compute the statutory filing tables (EPF / ESI / PT) for the reconciled month.
  // This populates the "Payable" column and the per-head detail pages, which read
  // from epf_contributions / esi_contributions / ptax_contributions.
  const computeMutation = useMutation({
    mutationFn: async () => {
      const month = recon?.run.month
      if (!month) throw new Error('No finalized run to compute for')
      const heads = [
        { label: 'EPF', url: '/payroll/statutory/epf/contributions/compute'  },
        { label: 'ESI', url: '/payroll/statutory/esi/contributions/compute'  },
        { label: 'PT',  url: '/payroll/statutory/ptax/contributions/compute' },
      ]
      const results = await Promise.allSettled(
        heads.map(h => api.post(h.url, { month })),
      )
      const failed = results
        .map((r, i) => ({ r, label: heads[i].label }))
        .filter(x => x.r.status === 'rejected')
        .map(x => x.label)
      return { month, failed }
    },
    onSuccess: ({ month, failed }) => {
      if (failed.length === 0) {
        toast.success('Statutory filings computed', { description: `${month} — EPF · ESI · PT populated` })
      } else {
        toast.warning('Partial compute', { description: `${month} — failed: ${failed.join(', ')}` })
      }
      refetch()
    },
    onError: (e: any) => {
      toast.error('Compute failed', { description: e?.message ?? 'Unable to compute statutory filings' })
    },
  })

  return (
    <PageContainer>
      <PageHeader
        title="Statutory Reconciliation"
        subtitle="PF · ESI · PT · TDS — reconcile computed, payable, and filed amounts"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => computeMutation.mutate()}
              disabled={computeMutation.isPending || !recon}
              title="Compute EPF / ESI / PT filing amounts for this month and populate the detail pages"
            >
              {computeMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Calculator className="h-3.5 w-3.5 mr-1" />}
              Compute Filings
            </Button>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isLoading && 'animate-spin')} />Refresh
            </Button>
          </div>
        }
      />

      {/* Month Selector */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedMonth(undefined)}
          className={cn(
            'flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
            !selectedMonth ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
          )}
        >
          Latest
        </button>
        {runs.map(r => (
          <button
            key={r.month}
            onClick={() => setSelectedMonth(r.month)}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
              selectedMonth === r.month ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
            )}
          >
            {fmtMonth(r.month).replace(' ', ' ')}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />Loading reconciliation…
        </div>
      ) : !recon ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <Scale className="h-8 w-8 opacity-30" />
          <p className="text-sm">No payroll run found for this period</p>
        </div>
      ) : (
        <>
          {/* Filing Status Banner */}
          <div className={cn(
            'mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border',
            recon.ready_for_filing ? 'bg-success/5 border-success/30' : 'bg-warning/5 border-warning/30',
          )}>
            {recon.ready_for_filing
              ? <BadgeCheck className="h-5 w-5 text-success flex-shrink-0" />
              : <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
            }
            <div>
              <p className={cn('text-sm font-semibold', recon.ready_for_filing ? 'text-success' : 'text-warning')}>
                {recon.ready_for_filing ? 'Ready for Filing' : 'Reconciliation Variance Detected'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmtMonth(recon.run.month)} · {recon.run.employee_count} employees ·
                Total statutory: {fmtCurrency(recon.total_statutory)}
              </p>
            </div>
          </div>

          {/* Four Head Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <HeadCard label="Provident Fund (EPF)"       head={recon.pf}  route="/admin/payroll/statutory/epf"  icon={<Landmark className="h-4 w-4 text-success"  />} />
            <HeadCard label="Employee State Insurance"   head={recon.esi} route="/admin/payroll/statutory/esi"  icon={<Shield className="h-4 w-4 text-info"       />} />
            <HeadCard label="Professional Tax"           head={recon.pt}  route="/admin/payroll/statutory/ptax" icon={<FileText className="h-4 w-4 text-warning"   />} />
            <HeadCard label="Tax Deducted at Source"     head={recon.tds} route="/admin/payroll/statutory/tds"  icon={<DollarSign className="h-4 w-4 text-primary" />} />
          </div>

          {/* Summary Table */}
          <SectionCard title="Reconciliation Summary" icon={<Scale className="h-4 w-4" />}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Statutory Head', 'Computed', 'Payable', 'Filed', 'Variance', 'Status'].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { key: 'pf',  data: recon.pf  },
                    { key: 'esi', data: recon.esi },
                    { key: 'pt',  data: recon.pt  },
                    { key: 'tds', data: recon.tds },
                  ] as const).map(({ key, data }) => (
                    <tr key={key} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{data.label}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(data.computed)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(data.payable)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">—</td>
                      <td className={cn('px-4 py-2.5 tabular-nums font-medium', Math.abs(data.variance) >= 1 ? 'text-warning' : 'text-success')}>
                        {data.variance >= 0 ? '+' : ''}{fmtCurrency(data.variance)}
                      </td>
                      <td className="px-4 py-2.5">
                        {data.ready
                          ? <Badge variant="outline" className="text-success border-success/40 text-[9px] rounded-full gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Ready</Badge>
                          : <Badge variant="outline" className="text-warning border-warning/40 text-[9px] rounded-full gap-1"><AlertTriangle className="h-2.5 w-2.5" />Variance</Badge>
                        }
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/10 font-semibold">
                    <td className="px-4 py-2.5">Total Statutory</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(recon.total_statutory)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(recon.total_statutory)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">—</td>
                    <td className="px-4 py-2.5 tabular-nums text-success">—</td>
                    <td className="px-4 py-2.5">
                      {recon.ready_for_filing
                        ? <Badge variant="outline" className="text-success border-success/40 text-[9px] rounded-full">Ready to File</Badge>
                        : <Badge variant="outline" className="text-warning border-warning/40 text-[9px] rounded-full">Pending</Badge>
                      }
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
