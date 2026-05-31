import { useQuery }      from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { useOwnerStore } from '@/stores/ownerStore'
import { Link }          from 'react-router-dom'
import {
  Building2, CheckCircle2, Clock, Ban, AlertTriangle,
  Key, CreditCard, TrendingUp, Users2, ChevronRight,
} from 'lucide-react'

interface DashData {
  data: {
    tenants:         { total: number; active: number; trial: number; suspended: number; expired: number }
    requests:        { pending: number; total: number }
    active_api_keys: number
    billing_30d_total: number
  }
}

interface TenantHealth {
  tenant_id: string
  employee_count: number
  active_users: number
  last_login_at: string | null
  last_payroll_run: { month: string; status: string; finalized_at: string | null } | null
}

interface TenantsData {
  data: { id: string; name: string; status: string }[]
}

function timeAgo(iso: string): string {
  const diffMs   = Date.now() - new Date(iso).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1)    return 'just now'
  if (diffMins < 60)   return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24)    return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 30)   return `${diffDays}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function StatCard({
  icon: Icon, label, value, sub, color = 'indigo',
}: {
  icon: React.ElementType; label: string; value: number | string; sub?: string
  color?: 'indigo' | 'green' | 'amber' | 'red' | 'slate'
}) {
  const colorMap = {
    indigo: 'bg-indigo-600/20 text-indigo-400',
    green:  'bg-emerald-600/20 text-emerald-400',
    amber:  'bg-amber-600/20 text-amber-400',
    red:    'bg-red-600/20 text-red-400',
    slate:  'bg-slate-700 text-slate-400',
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start gap-3">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export function OwnerDashboard() {
  const { admin } = useOwnerStore()

  const { data, isLoading } = useQuery<DashData>({
    queryKey: ['owner-dashboard'],
    queryFn:  () => ownerApi.get('/owner/dashboard'),
    refetchInterval: 30_000,
  })

  const { data: healthRaw } = useQuery<{ data: TenantHealth[] }>({
    queryKey: ['owner-tenant-health'],
    queryFn:  () => ownerApi.get('/owner/tenant-health'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const { data: tenantsRaw } = useQuery<TenantsData>({
    queryKey: ['owner-tenants-mini'],
    queryFn:  () => ownerApi.get('/owner/tenants?limit=100'),
  })

  // Merge tenant name into health rows, sort by active_users desc, then employee_count desc
  const tenantNameMap = new Map((tenantsRaw?.data ?? []).map(t => [t.id, t]))
  const healthRows = (healthRaw?.data ?? [])
    .map(h => ({ ...h, tenant: tenantNameMap.get(h.tenant_id) }))
    .filter(h => h.tenant)
    .sort((a, b) => b.active_users - a.active_users || b.employee_count - a.employee_count)
    .slice(0, 8)

  const d = data?.data

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">
          Welcome, {admin?.name}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Platform overview</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {d && (
        <>
          {/* Tenant stats */}
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Tenants</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Building2}    label="Total"     value={d.tenants.total}     color="slate" />
              <StatCard icon={CheckCircle2} label="Active"    value={d.tenants.active}    color="green" />
              <StatCard icon={Clock}        label="On Trial"  value={d.tenants.trial}     color="amber" />
              <StatCard icon={Ban}          label="Suspended" value={d.tenants.suspended + d.tenants.expired} color="red" />
            </div>
          </section>

          {/* Platform stats */}
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Platform</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={AlertTriangle}
                label="Pending Requests"
                value={d.requests.pending}
                sub={`${d.requests.total} total`}
                color={d.requests.pending > 0 ? 'amber' : 'slate'}
              />
              <StatCard icon={Key}         label="Active API Keys"    value={d.active_api_keys}                   color="indigo" />
              <StatCard icon={CreditCard}  label="Billing (30 days)"  value={fmtCurrency(d.billing_30d_total)}    color="green" />
              <StatCard icon={TrendingUp}  label="Total Tenants"      value={d.tenants.total}                     color="slate" />
            </div>
          </section>

          {/* Quick actions */}
          {d.requests.pending > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">
                  {d.requests.pending} signup request{d.requests.pending !== 1 ? 's' : ''} awaiting review
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Go to <a href="/owner/requests" className="text-indigo-400 hover:underline">Requests</a> to approve or reject.
              </p>
            </section>
          )}
        </>
      )}

      {/* ── Tenant Live Activity ─────────────────────────────────────────── */}
      {healthRows.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tenant Running Status</h2>
            <Link to="/owner/tenants" className="text-[11px] text-indigo-400 hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 border-b border-slate-800">
                <tr>
                  {['Tenant', 'Status', 'Employees', 'Active Users', 'Last Login', 'Last Payroll'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {healthRows.map(row => {
                  const t = row.tenant!
                  const STATUS_DOT: Record<string, string> = {
                    active:    'bg-emerald-400',
                    trial:     'bg-amber-400',
                    suspended: 'bg-red-400',
                    expired:   'bg-orange-400',
                    cancelled: 'bg-slate-600',
                  }
                  const payrollColor: Record<string, string> = {
                    finalized:  'text-emerald-400',
                    processing: 'text-amber-400',
                    draft:      'text-slate-500',
                  }
                  return (
                    <tr key={row.tenant_id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/owner/tenants/${t.id}`}
                          className="font-medium text-white text-[13px] hover:text-indigo-300 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          {t.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[t.status] ?? 'bg-slate-600'}`} />
                          <span className="text-[11px] text-slate-400 capitalize">{t.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[12px] text-slate-300">
                          <Users2 className="h-3 w-3 text-slate-500" />
                          {row.employee_count}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[12px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${row.active_users > 0 ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                          <span className={row.active_users > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                            {row.active_users}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">
                        {row.last_login_at ? timeAgo(row.last_login_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {row.last_payroll_run ? (
                          <div>
                            <span className="text-[12px] text-slate-300">{row.last_payroll_run.month}</span>
                            <span className={`ml-1.5 text-[10px] font-medium ${payrollColor[row.last_payroll_run.status] ?? 'text-slate-500'}`}>
                              {row.last_payroll_run.status}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[12px]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
