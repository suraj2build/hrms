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
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Billing</h1>
        <p className="text-sm text-slate-500">Payroll-triggered billing snapshots</p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 col-span-2 lg:col-span-1 flex items-center gap-3">
          <CreditCard className="h-8 w-8 text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Total (filtered)</p>
            <p className="text-xl font-bold text-white">{fmtCurrency(totalAmount)}</p>
          </div>
        </div>
        {monthSummary.map(([month, amount]) => (
          <div key={month} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <p className="text-[11px] text-slate-500 font-mono">{month}</p>
            <p className="text-base font-semibold text-emerald-300 mt-0.5">{fmtCurrency(amount)}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select
          value={tenantFilt}
          onChange={e => setTenantFilt(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white min-w-[160px]"
        >
          <option value="">All Tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input
          type="month"
          value={monthFilt}
          onChange={e => setMonthFilt(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
        />
        {(tenantFilt || monthFilt) && (
          <button onClick={() => { setTenantFilt(''); setMonthFilt('') }} className="text-xs text-slate-400 hover:text-slate-200 px-2">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              {['Month', 'Tenant', 'Employees', 'Rate', 'Amount Due', 'Plan'].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 w-full bg-slate-800 animate-pulse rounded" /></td></tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No billing records yet. They appear automatically after payroll finalization.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-800/30">
                <td className="px-4 py-2.5 font-mono text-[12px] text-slate-300">{r.snapshot_month}</td>
                <td className="px-4 py-2.5 text-[13px] text-slate-200">{tenantNames[r.tenant_id] ?? r.tenant_id.slice(0, 8) + '…'}</td>
                <td className="px-4 py-2.5 text-slate-300">{r.employee_count}</td>
                <td className="px-4 py-2.5 text-slate-400">{fmtCurrency(r.per_employee_rate)}</td>
                <td className="px-4 py-2.5 font-semibold text-emerald-300">{fmtCurrency(r.amount_due)}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    r.plan === 'enterprise' ? 'border-purple-500/40 text-purple-300' : 'border-slate-700 text-slate-400'
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
  )
}
