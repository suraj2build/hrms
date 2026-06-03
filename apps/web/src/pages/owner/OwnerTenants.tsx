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
  active:    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  trial:     <Clock        className="h-3.5 w-3.5 text-amber-400" />,
  suspended: <Ban          className="h-3.5 w-3.5 text-red-400" />,
  expired:   <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />,
  cancelled: <XCircle      className="h-3.5 w-3.5 text-slate-500" />,
}

const STATUS_COLOR: Record<string, string> = {
  active:    'border-emerald-500/30 text-emerald-300 bg-emerald-500/10',
  trial:     'border-amber-500/30 text-amber-300 bg-amber-500/10',
  suspended: 'border-red-500/30 text-red-300 bg-red-500/10',
  expired:   'border-orange-500/30 text-orange-300 bg-orange-500/10',
  cancelled: 'border-slate-700 text-slate-500 bg-slate-800',
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
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Tenants</h1>
          <p className="text-sm text-slate-500">{data?.meta?.total ?? 0} total companies</p>
        </div>
        {isOwner() && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#0D9488] hover:bg-[#1E5BA8] text-white gap-1.5"
          >
            <Plus className="h-4 w-4" /> New Tenant
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-sm"
          />
        </div>
        {['', 'active', 'trial', 'suspended', 'expired'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilt(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilt === s ? 'bg-[#0D9488] text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              {['Company', 'Plan', 'Status', 'Rate / emp', 'Employees', 'Live Activity', 'Last Payroll'].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-4 py-2.5">{h}</th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 w-full bg-slate-800 animate-pulse rounded" /></td></tr>
            ))}
            {!isLoading && tenants.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No tenants found</td></tr>
            )}
            {tenants.map(t => {
              const h = healthMap.get(t.id)
              const lastPayroll = h?.last_payroll_run
              const payrollStatusColor: Record<string, string> = {
                finalized: 'text-emerald-400',
                processing: 'text-amber-400',
                draft: 'text-slate-500',
              }
              return (
              <tr
                key={t.id}
                onClick={() => navigate(`/owner/tenants/${t.id}`)}
                className="hover:bg-slate-800/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white text-[13px]">{t.name}</p>
                      <p className="text-[11px] text-slate-500">{t.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                    t.plan === 'enterprise'
                      ? 'border-purple-500/40 text-purple-300 bg-purple-500/10'
                      : 'border-slate-700 text-slate-400 bg-slate-800'
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
                <td className="px-4 py-3 text-slate-300 text-[13px]">
                  {t.per_employee_rate > 0 ? fmtCurrency(t.per_employee_rate) : <span className="text-slate-600">—</span>}
                </td>

                {/* Employees */}
                <td className="px-4 py-3">
                  {h ? (
                    <div className="flex items-center gap-1.5 text-[12px] text-slate-300">
                      <Users2 className="h-3 w-3 text-slate-500 flex-shrink-0" />
                      {h.employee_count}
                    </div>
                  ) : (
                    <span className="text-slate-600 text-[12px]">—</span>
                  )}
                </td>

                {/* Live Activity: active users + last login */}
                <td className="px-4 py-3">
                  {h ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${h.active_users > 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <span className={h.active_users > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                          {h.active_users} user{h.active_users !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {h.last_login_at && (
                        <p className="text-[10px] text-slate-600">
                          last {timeAgo(h.last_login_at)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-600 text-[12px]">—</span>
                  )}
                </td>

                {/* Last Payroll */}
                <td className="px-4 py-3">
                  {lastPayroll ? (
                    <div className="space-y-0.5">
                      <p className="text-[12px] text-slate-300">{lastPayroll.month}</p>
                      <p className={`text-[10px] font-medium ${payrollStatusColor[lastPayroll.status] ?? 'text-slate-500'}`}>
                        {lastPayroll.status}
                      </p>
                    </div>
                  ) : (
                    <span className="text-slate-600 text-[12px]">—</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <ChevronRight className="h-4 w-4 text-slate-600" />
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) setShowPwd(false) }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">

            {/* ── Tenant details ── */}
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Tenant Details</p>

            {[
              { key: 'name',              label: 'Company Name *',        type: 'text',   placeholder: 'Acme Corp' },
              { key: 'billing_email',     label: 'Billing Email',         type: 'email',  placeholder: 'billing@acme.com' },
              { key: 'per_employee_rate', label: 'Per-Employee Rate (₹)', type: 'number', placeholder: '299' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">{label}</label>
                <Input
                  type={type}
                  placeholder={placeholder}
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-sm"
                />
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Plan</label>
                <select
                  value={form.plan}
                  onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-white"
                >
                  <option value="standard">Standard</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Country</label>
                <Input
                  placeholder="IN"
                  value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase().slice(0, 2) }))}
                  className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                />
              </div>
            </div>

            {/* ── Initial Admin (optional) ── */}
            <div className="border-t border-slate-700 pt-3">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Initial Admin Account <span className="text-slate-600 normal-case font-normal">(optional — can provision later)</span>
              </p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Admin Name</label>
                  <Input
                    placeholder="John Smith"
                    value={form.admin_name}
                    onChange={e => setForm(f => ({ ...f, admin_name: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Admin Email</label>
                  <Input
                    type="email"
                    placeholder="admin@acmecorp.com"
                    value={form.admin_email}
                    onChange={e => setForm(f => ({ ...f, admin_email: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Temporary Password</label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Input
                        type={showPwd ? 'text' : 'password'}
                        placeholder="Min 8 characters"
                        value={form.admin_password}
                        onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))}
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-sm pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={generatePassword}
                      className="h-8 border-slate-700 text-slate-400 hover:text-white gap-1 px-2"
                    >
                      <RefreshCw className="h-3 w-3" /> Generate
                    </Button>
                  </div>
                  <p className="text-[10px] text-slate-600">This password will be shown once — save it before creating.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Show the generated password prominently before submit */}
          {form.admin_password && showPwd && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs">
              <span className="text-amber-400 font-semibold">Save this password: </span>
              <code className="text-amber-200 font-mono select-all">{form.admin_password}</code>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="text-slate-400">Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!form.name.trim() || createMut.isPending}
              className="bg-[#0D9488] hover:bg-[#1E5BA8] text-white"
            >
              {createMut.isPending ? 'Creating…' : 'Create Tenant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
