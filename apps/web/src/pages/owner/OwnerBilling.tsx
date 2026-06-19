import { useState } from 'react'
import { useQuery }      from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { CreditCard } from 'lucide-react'

interface Snapshot {
  id: string; tenant_id: string; snapshot_month: string
  employee_count: number; per_employee_rate: number
  amount_due: number; plan: string; created_at: string
}
interface Tenant { id: string; name: string }

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export function OwnerBilling() {
  const [tenantFilt, setTenantFilt] = useState('')
  const [monthFilt,  setMonthFilt]  = useState('')

  const { data: tenantsData } = useQuery<{ data: Tenant[] }>({
    queryKey: ['owner-tenants-list'],
    queryFn:  () => ownerApi.get('/owner/tenants?limit=200'),
  })
  const tenants     = tenantsData?.data ?? []
  const tenantNames = tenants.reduce<Record<string, string>>((a, t) => { a[t.id] = t.name; return a }, {})

  const { data, isLoading } = useQuery<{ data: Snapshot[]; meta: { total: number; total_amount: number } }>({
    queryKey: ['owner-billing', tenantFilt, monthFilt],
    queryFn:  () => ownerApi.get(`/owner/billing?tenant_id=${tenantFilt}&month=${monthFilt}&limit=100`),
    placeholderData: (prev) => prev,
  })

  const rows         = data?.data ?? []
  const totalAmount  = data?.meta?.total_amount ?? 0

  // Aggregate by month for summary
  const byMonth: Record<string, number> = {}
  for (const r of rows) {
    byMonth[r.snapshot_month] = (byMonth[r.snapshot_month] ?? 0) + Number(r.amount_due)
  }
  const monthSummary = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">Payroll-triggered billing snapshots</p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04] p-3 col-span-2 lg:col-span-1 flex items-center gap-3">
          <CreditCard className="h-8 w-8 text-emerald-600 flex-shrink-0" />
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total (filtered)</p>
            <p className="text-xl font-bold text-foreground">{fmtCurrency(totalAmount)}</p>
          </div>
        </div>
        {monthSummary.map(([month, amount]) => (
          <div key={month} className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04] p-3">
            <p className="text-[11px] text-muted-foreground font-mono">{month}</p>
            <p className="text-base font-semibold text-emerald-700 mt-0.5">{fmtCurrency(amount)}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select
          value={tenantFilt}
          onChange={e => setTenantFilt(e.target.value)}
          aria-label="Filter by tenant"
          className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground min-w-[160px]"
        >
          <option value="">All Tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input
          type="month"
          value={monthFilt}
          onChange={e => setMonthFilt(e.target.value)}
          aria-label="Filter by month"
          className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
        />
        {(tenantFilt || monthFilt) && (
          <button onClick={() => { setTenantFilt(''); setMonthFilt('') }} className="text-xs text-muted-foreground hover:text-foreground px-2">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card border-b border-border">
            <tr>
              {['Month', 'Tenant', 'Employees', 'Rate', 'Amount Due', 'Plan'].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 w-full bg-muted animate-pulse rounded" /></td></tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No billing records yet. They appear automatically after payroll finalization.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-muted">
                <td className="px-4 py-2.5 font-mono text-[12px] text-foreground">{r.snapshot_month}</td>
                <td className="px-4 py-2.5 text-[13px] text-foreground">{tenantNames[r.tenant_id] ?? r.tenant_id.slice(0, 8) + '…'}</td>
                <td className="px-4 py-2.5 text-foreground">{r.employee_count}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtCurrency(r.per_employee_rate)}</td>
                <td className="px-4 py-2.5 font-semibold text-emerald-700">{fmtCurrency(r.amount_due)}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    r.plan === 'enterprise' ? 'border-purple-500/40 text-purple-700' : 'border-border text-muted-foreground'
                  }`}>
                    {r.plan}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
