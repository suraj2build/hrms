import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { useOwnerStore } from '@/stores/ownerStore'
import { toast }         from 'sonner'
import {
  Plus, Search, ChevronRight, Building2,
  CheckCircle2, Clock, Ban, XCircle, AlertTriangle,
  Users2, Eye, EyeOff, RefreshCw,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface Tenant {
  id: string; name: string; slug: string; plan: string; status: string
  trial_ends_at: string | null; license_expires_at: string | null
  per_employee_rate: number; billing_email: string | null; created_at: string
  country: string
}

interface TenantHealth {
  tenant_id: string
  employee_count: number
  active_users: number
  last_login_at: string | null
  last_payroll_run: { month: string; status: string; finalized_at: string | null } | null
}

interface TenantHealthResponse {
  data: TenantHealth[]
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  active:    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  trial:     <Clock        className="h-3.5 w-3.5 text-amber-600" />,
  suspended: <Ban          className="h-3.5 w-3.5 text-red-600" />,
  expired:   <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />,
  cancelled: <XCircle      className="h-3.5 w-3.5 text-slate-500" />,
}

const STATUS_COLOR: Record<string, string> = {
  active:    'border-emerald-300 text-emerald-700 bg-emerald-100/70',
  trial:     'border-amber-300 text-amber-700 bg-amber-100/70',
  suspended: 'border-red-300 text-red-700 bg-red-100/70',
  expired:   'border-orange-300 text-orange-700 bg-orange-100/70',
  cancelled: 'border-slate-200 text-slate-500 bg-slate-100',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
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
  return fmtDate(iso)
}

export function OwnerTenants() {
  const navigate     = useNavigate()
  const qc           = useQueryClient()
  const { isOwner }  = useOwnerStore()
  const [search,     setSearch]     = useState('')
  const [statusFilt, setStatusFilt] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    name: '', plan: 'standard', per_employee_rate: '', billing_email: '', country: 'IN',
    // Optional initial admin
    admin_name: '', admin_email: '', admin_password: '',
  })
  const [showPwd, setShowPwd] = useState(false)

  const generatePassword = useCallback(() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
    let pwd = ''
    for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
    setForm(f => ({ ...f, admin_password: pwd }))
    setShowPwd(true)
  }, [])

  const { data, isLoading } = useQuery<{ data: Tenant[]; meta: { total: number } }>({
    queryKey: ['owner-tenants', search, statusFilt],
    queryFn:  () => ownerApi.get(`/owner/tenants?search=${search}&status=${statusFilt}&limit=50`),
    placeholderData: (prev) => prev,
  })

  const { data: healthData } = useQuery<TenantHealthResponse>({
    queryKey: ['owner-tenant-health'],
    queryFn:  () => ownerApi.get('/owner/tenant-health'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // Build a quick lookup map: tenant_id → health stats
  const healthMap = new Map<string, TenantHealth>(
    (healthData?.data ?? []).map(h => [h.tenant_id, h])
  )

  const createMut = useMutation({
    mutationFn: async () => {
      // Step 1: create tenant
      const res = await ownerApi.post<{ data: { id: string } }>('/owner/tenants', {
        name:               form.name,
        plan:               form.plan,
        per_employee_rate:  Number(form.per_employee_rate) || 0,
        billing_email:      form.billing_email || undefined,
        country:            form.country,
      })
      const tenantId = res.data.id

      // Step 2: provision initial admin if provided
      if (form.admin_email && form.admin_password && form.admin_name) {
        await ownerApi.post(`/owner/tenants/${tenantId}/admins`, {
          email:    form.admin_email,
          password: form.admin_password,
          name:     form.admin_name,
          role:     'admin',
        })
      }

      return res
    },
    onSuccess: () => {
      const hadAdmin = form.admin_email && form.admin_password
      toast.success(hadAdmin ? 'Tenant created with admin account' : 'Tenant created')
      setCreateOpen(false)
      setForm({ name: '', plan: 'standard', per_employee_rate: '', billing_email: '', country: 'IN', admin_name: '', admin_email: '', admin_password: '' })
      setShowPwd(false)
      qc.invalidateQueries({ queryKey: ['owner-tenants'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const tenants = data?.data ?? []

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{data?.meta?.total ?? 0} total companies</p>
        </div>
        {isOwner() && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 bg-gradient-to-r from-teal-500 via-sky-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white border-0 shadow-lg shadow-teal-500/20 gap-1.5"
          >
            <Plus className="h-4 w-4" /> New Tenant
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 bg-card backdrop-blur border-border text-foreground placeholder:text-muted-foreground h-9 text-sm shadow-sm"
          />
        </div>
        {['', 'active', 'trial', 'suspended', 'expired'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilt(s)}
            aria-pressed={statusFilt === s}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              statusFilt === s
                ? 'bg-gradient-to-r from-teal-500 to-indigo-600 text-white shadow-md shadow-teal-500/20'
                : 'bg-card backdrop-blur border border-border text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.04] overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-sm">
          <thead className="bg-card border-b border-border">
            <tr>
              {['Company', 'Plan', 'Status', 'Rate / emp', 'Employees', 'Live Activity', 'Last Payroll'].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">{h}</th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 w-full bg-muted animate-pulse rounded" /></td></tr>
            ))}
            {!isLoading && tenants.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">No tenants found</td></tr>
            )}
            {tenants.map(t => {
              const h = healthMap.get(t.id)
              const lastPayroll = h?.last_payroll_run
              const payrollStatusColor: Record<string, string> = {
                finalized: 'text-emerald-600',
                processing: 'text-amber-600',
                draft: 'text-slate-500',
              }
              return (
              <tr
                key={t.id}
                onClick={() => navigate(`/owner/tenants/${t.id}`)}
                className="hover:bg-muted cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-[13px]">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                    t.plan === 'enterprise'
                      ? 'border-purple-300 text-purple-700 bg-purple-100/70'
                      : 'border-border text-muted-foreground bg-muted'
                  }`}>
                    {t.plan}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_COLOR[t.status] ?? ''}`}>
                    {STATUS_ICON[t.status]}
                    {t.status}
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground text-[13px]">
                  {t.per_employee_rate > 0 ? fmtCurrency(t.per_employee_rate) : <span className="text-muted-foreground">—</span>}
                </td>

                {/* Employees */}
                <td className="px-4 py-3">
                  {h ? (
                    <div className="flex items-center gap-1.5 text-[12px] text-foreground">
                      <Users2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      {h.employee_count}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-[12px]">—</span>
                  )}
                </td>

                {/* Live Activity: active users + last login */}
                <td className="px-4 py-3">
                  {h ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${h.active_users > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <span className={h.active_users > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                          {h.active_users} user{h.active_users !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {h.last_login_at && (
                        <p className="text-[10px] text-muted-foreground">
                          last {timeAgo(h.last_login_at)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-[12px]">—</span>
                  )}
                </td>

                {/* Last Payroll */}
                <td className="px-4 py-3">
                  {lastPayroll ? (
                    <div className="space-y-0.5">
                      <p className="text-[12px] text-foreground">{lastPayroll.month}</p>
                      <p className={`text-[10px] font-medium ${payrollStatusColor[lastPayroll.status] ?? 'text-muted-foreground'}`}>
                        {lastPayroll.status}
                      </p>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-[12px]">—</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) setShowPwd(false) }}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">

            {/* ── Tenant details ── */}
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tenant Details</p>

            {[
              { key: 'name',              label: 'Company Name *',        type: 'text',   placeholder: 'Acme Corp' },
              { key: 'billing_email',     label: 'Billing Email',         type: 'email',  placeholder: 'billing@acme.com' },
              { key: 'per_employee_rate', label: 'Per-Employee Rate (₹)', type: 'number', placeholder: '299' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label htmlFor={`new-tenant-${key}`} className="text-xs font-medium text-foreground">{label}</label>
                <Input
                  id={`new-tenant-${key}`}
                  type={type}
                  placeholder={placeholder}
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
                />
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="new-tenant-plan" className="text-xs font-medium text-foreground">Plan</label>
                <select
                  id="new-tenant-plan"
                  value={form.plan}
                  onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="standard">Standard</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="new-tenant-country" className="text-xs font-medium text-foreground">Country</label>
                <Input
                  id="new-tenant-country"
                  placeholder="IN"
                  value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase().slice(0, 2) }))}
                  className="bg-muted border-border text-foreground h-8 text-sm"
                />
              </div>
            </div>

            {/* ── Initial Admin (optional) ── */}
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Initial Admin Account <span className="text-muted-foreground normal-case font-normal">(optional — can provision later)</span>
              </p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="new-tenant-admin-name" className="text-xs font-medium text-foreground">Admin Name</label>
                  <Input
                    id="new-tenant-admin-name"
                    placeholder="John Smith"
                    value={form.admin_name}
                    onChange={e => setForm(f => ({ ...f, admin_name: e.target.value }))}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="new-tenant-admin-email" className="text-xs font-medium text-foreground">Admin Email</label>
                  <Input
                    id="new-tenant-admin-email"
                    type="email"
                    placeholder="admin@acmecorp.com"
                    value={form.admin_email}
                    onChange={e => setForm(f => ({ ...f, admin_email: e.target.value }))}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="new-tenant-admin-password" className="text-xs font-medium text-foreground">Temporary Password</label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Input
                        id="new-tenant-admin-password"
                        type={showPwd ? 'text' : 'password'}
                        placeholder="Min 8 characters"
                        value={form.admin_password}
                        onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPwd ? 'Hide password' : 'Show password'}
                      >
                        {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={generatePassword}
                      className="h-8 border-border text-muted-foreground hover:text-foreground gap-1 px-2"
                    >
                      <RefreshCw className="h-3 w-3" /> Generate
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">This password will be shown once — save it before creating.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Show the generated password prominently before submit */}
          {form.admin_password && showPwd && (
            <div className="rounded-md bg-amber-50 border border-amber-300 px-3 py-2 text-xs">
              <span className="text-amber-800 font-semibold">Save this password: </span>
              <code className="text-amber-950 font-mono font-semibold select-all">{form.admin_password}</code>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="text-muted-foreground">Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!form.name.trim() || createMut.isPending}
              className="bg-gradient-to-r from-teal-500 via-sky-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white border-0 shadow-md shadow-teal-500/20"
            >
              {createMut.isPending ? 'Creating…' : 'Create Tenant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
