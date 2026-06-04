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
    indigo: { ring: 'ring-teal-500/15',  icon: 'bg-gradient-to-br from-teal-500 to-indigo-600 text-white',  glow: 'before:bg-teal-500/10' },
    green:  { ring: 'ring-emerald-500/15', icon: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white', glow: 'before:bg-emerald-500/10' },
    amber:  { ring: 'ring-amber-500/20',  icon: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white', glow: 'before:bg-amber-500/10' },
    red:    { ring: 'ring-red-500/15',    icon: 'bg-gradient-to-br from-red-500 to-rose-600 text-white',     glow: 'before:bg-red-500/10' },
    slate:  { ring: 'ring-slate-300/40',  icon: 'bg-gradient-to-br from-slate-500 to-slate-700 text-white',  glow: 'before:bg-slate-400/10' },
  }
  const c = colorMap[color]
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl p-4 flex items-start gap-3.5 shadow-sm ring-1 ${c.ring} transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 before:absolute before:-right-6 before:-top-6 before:h-20 before:w-20 before:rounded-full before:blur-2xl ${c.glow}`}>
      <div className={`relative h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${c.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="relative min-w-0">
        <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.12em]">{label}</p>
        <p className="text-[26px] leading-tight font-bold text-slate-900 mt-0.5 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
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
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-9">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome back, {admin?.name?.split(' ')[0] ?? 'Owner'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">Live platform overview · auto-refreshing</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          All systems operational
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-white/60 ring-1 ring-slate-200/60 animate-pulse" />
          ))}
        </div>
      )}

      {d && (
        <>
          {/* Tenant stats */}
          <section>
            <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.16em] mb-3">Tenants</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Building2}    label="Total"     value={d.tenants.total}     color="slate" />
              <StatCard icon={CheckCircle2} label="Active"    value={d.tenants.active}    color="green" />
              <StatCard icon={Clock}        label="On Trial"  value={d.tenants.trial}     color="amber" />
              <StatCard icon={Ban}          label="Suspended" value={d.tenants.suspended + d.tenants.expired} color="red" />
            </div>
          </section>

          {/* Platform stats */}
          <section>
            <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.16em] mb-3">Platform</h2>
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
            <section className="relative overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-50 to-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-700">
                  {d.requests.pending} signup request{d.requests.pending !== 1 ? 's' : ''} awaiting review
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Go to <Link to="/owner/requests" className="font-medium text-teal-700 hover:underline">Requests</Link> to approve or reject.
              </p>
            </section>
          )}
        </>
      )}

      {/* ── Tenant Live Activity ─────────────────────────────────────────── */}
      {healthRows.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.16em]">Tenant Running Status</h2>
            <Link to="/owner/tenants" className="text-[11px] font-medium text-teal-700 hover:text-teal-800 flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-200/70">
                <tr>
                  {['Tenant', 'Status', 'Employees', 'Active Users', 'Last Login', 'Last Payroll'].map(h => (
                    <th key={h} className="text-left text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.1em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {healthRows.map(row => {
                  const t = row.tenant!
                  const STATUS_DOT: Record<string, string> = {
                    active:    'bg-emerald-500',
                    trial:     'bg-amber-500',
                    suspended: 'bg-red-500',
                    expired:   'bg-orange-500',
                    cancelled: 'bg-slate-400',
                  }
                  const payrollColor: Record<string, string> = {
                    finalized:  'text-emerald-600',
                    processing: 'text-amber-600',
                    draft:      'text-slate-400',
                  }
                  return (
                    <tr key={row.tenant_id} className="transition-colors hover:bg-teal-50/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/owner/tenants/${t.id}`}
                          className="font-semibold text-slate-800 text-[13px] hover:text-teal-700 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          {t.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[t.status] ?? 'bg-slate-400'}`} />
                          <span className="text-[11px] text-slate-500 capitalize">{t.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[12px] text-slate-600">
                          <Users2 className="h-3 w-3 text-slate-400" />
                          {row.employee_count}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[12px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${row.active_users > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          <span className={row.active_users > 0 ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
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
                            <span className="text-[12px] text-slate-600">{row.last_payroll_run.month}</span>
                            <span className={`ml-1.5 text-[10px] font-semibold ${payrollColor[row.last_payroll_run.status] ?? 'text-slate-400'}`}>
                              {row.last_payroll_run.status}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[12px]">—</span>
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
