import { useQuery }      from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { useOwnerStore } from '@/stores/ownerStore'
import { Link }          from 'react-router-dom'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back, {admin?.name?.split(' ')[0] ?? 'Owner'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Live platform overview · auto-refreshing</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          All systems operational
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-card ring-1 ring-ring/60 animate-pulse" />
          ))}
        </div>
      )}

      {d && (
        <>
          {/* Tenant stats */}
          <section>
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.16em] mb-3">Tenants</h2>
            <MetricRow cols={4}>
              <MetricCard icon={Building2}    label="Total"     value={d.tenants.total}     variant="neutral" />
              <MetricCard icon={CheckCircle2} label="Active"    value={d.tenants.active}    variant="success" />
              <MetricCard icon={Clock}        label="On Trial"  value={d.tenants.trial}     variant="warning" />
              <MetricCard icon={Ban}          label="Suspended" value={d.tenants.suspended + d.tenants.expired} variant="destructive" />
            </MetricRow>
          </section>

          {/* Platform stats */}
          <section>
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.16em] mb-3">Platform</h2>
            <MetricRow cols={4}>
              <MetricCard
                icon={AlertTriangle}
                label="Pending Requests"
                value={d.requests.pending}
                subtitle={`${d.requests.total} total`}
                variant={d.requests.pending > 0 ? 'warning' : 'neutral'}
              />
              <MetricCard icon={Key}         label="Active API Keys"    value={d.active_api_keys}                   variant="info" />
              <MetricCard icon={CreditCard}  label="Billing (30 days)"  value={fmtCurrency(d.billing_30d_total)}    variant="success" />
              <MetricCard icon={TrendingUp}  label="Total Tenants"      value={d.tenants.total}                     variant="neutral" />
            </MetricRow>
          </section>

          {/* Quick actions */}
          {d.requests.pending > 0 && (
            <section className="relative overflow-hidden rounded-2xl border border-warning/40 bg-gradient-to-r from-warning/10 to-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="text-sm font-semibold text-warning">
                  {d.requests.pending} signup request{d.requests.pending !== 1 ? 's' : ''} awaiting review
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Go to <Link to="/owner/requests" className="font-medium text-primary hover:underline">Requests</Link> to approve or reject.
              </p>
            </section>
          )}
        </>
      )}

      {/* ── Tenant Live Activity ─────────────────────────────────────────── */}
      {healthRows.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">Tenant Running Status</h2>
            <Link to="/owner/tenants" className="text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="rounded-2xl border border-border bg-card backdrop-blur-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  {['Tenant', 'Status', 'Employees', 'Active Users', 'Last Login', 'Last Payroll'].map(h => (
                    <th key={h} className="text-left text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.1em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {healthRows.map(row => {
                  const t = row.tenant!
                  const STATUS_DOT: Record<string, string> = {
                    active:    'bg-success',
                    trial:     'bg-warning',
                    suspended: 'bg-destructive',
                    expired:   'bg-accent-coral',
                    cancelled: 'bg-muted',
                  }
                  const payrollColor: Record<string, string> = {
                    finalized:  'text-success',
                    processing: 'text-warning',
                    draft:      'text-muted-foreground',
                  }
                  return (
                    <tr key={row.tenant_id} className="transition-colors hover:bg-primary/[0.04]">
                      <td className="px-4 py-3">
                        <Link
                          to={`/owner/tenants/${t.id}`}
                          className="font-semibold text-foreground text-[13px] hover:text-primary transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          {t.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[t.status] ?? 'bg-muted'}`} />
                          <span className="text-[11px] text-muted-foreground capitalize">{t.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <Users2 className="h-3 w-3 text-muted-foreground" />
                          {row.employee_count}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[12px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${row.active_users > 0 ? 'bg-success' : 'bg-muted'}`} />
                          <span className={row.active_users > 0 ? 'text-success font-medium' : 'text-muted-foreground'}>
                            {row.active_users}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {row.last_login_at ? timeAgo(row.last_login_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {row.last_payroll_run ? (
                          <div>
                            <span className="text-[12px] text-muted-foreground">{row.last_payroll_run.month}</span>
                            <span className={`ml-1.5 text-[10px] font-semibold ${payrollColor[row.last_payroll_run.status] ?? 'text-muted-foreground'}`}>
                              {row.last_payroll_run.status}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[12px]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
