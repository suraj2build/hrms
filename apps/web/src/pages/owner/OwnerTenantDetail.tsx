import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { useOwnerStore } from '@/stores/ownerStore'
import { toast }         from 'sonner'
import {
  ArrowLeft, Award, Edit2, Save, X,
  UserPlus, Eye, EyeOff, RefreshCw, KeyRound,
  ShieldCheck, UserX, UserCheck, Copy, Check, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface TenantDetail {
  id: string; name: string; slug: string; plan: string; status: string
  trial_ends_at: string | null; license_issued_at: string | null
  license_expires_at: string | null; billing_email: string | null
  per_employee_rate: number; notes: string | null; country: string
  created_at: string
  billing_snapshots: BillingRow[]
  api_keys: ApiKeyRow[]
}
interface BillingRow  { id: string; snapshot_month: string; employee_count: number; per_employee_rate: number; amount_due: number; plan: string }
interface ApiKeyRow   { id: string; name: string; key_prefix: string; scopes: string[]; is_active: boolean; last_used_at: string | null }
// profiles.id = auth user UUID (no separate user_id column)
interface TenantAdmin { id: string; full_name: string; email: string | null; role: string; is_active: boolean; created_at: string }

const STATUS_COLOR: Record<string, string> = {
  active:    'text-success', trial: 'text-warning',
  suspended: 'text-destructive',    expired: 'text-warning', cancelled: 'text-muted-foreground',
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

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  let pwd = ''
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

export function OwnerTenantDetail() {
  const { id }           = useParams<{ id: string }>()
  const navigate         = useNavigate()
  const qc               = useQueryClient()
  const { isOwner }      = useOwnerStore()
  const [editing, setEditing]       = useState(false)
  const [editForm, setEditForm]     = useState<Record<string, string>>({})
  const [licenseMonths, setLicenseMonths] = useState('12')

  // Admin provisioning state
  const [addAdminOpen, setAddAdminOpen]   = useState(false)
  const [adminForm, setAdminForm]         = useState({ name: '', email: '', password: '', role: 'super_admin' })
  const [showAdminPwd, setShowAdminPwd]   = useState(false)
  // Reset password state — stores the result { email, temp_password } to display once
  const [resetResult, setResetResult]     = useState<{ email: string; temp_password: string } | null>(null)
  // Reset-password dialog: which admin + the (optional) manually-typed password
  const [resetAdminId, setResetAdminId]   = useState<string | null>(null)
  const [resetPwd, setResetPwd]           = useState('')
  const [showResetPwd, setShowResetPwd]   = useState(false)
  const [cdlg, setCdlg] = useState<{ msg: string; act: () => void; destructive?: boolean } | null>(null)
  const [copiedPwd, setCopiedPwd]         = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<{ data: TenantDetail }>({
    queryKey: ['owner-tenant', id],
    queryFn:  () => ownerApi.get(`/owner/tenants/${id}`),
  })
  const t = data?.data

  // Tenant admins query
  const { data: adminsData, refetch: refetchAdmins } = useQuery<{ data: TenantAdmin[] }>({
    queryKey: ['owner-tenant-admins', id],
    queryFn:  () => ownerApi.get(`/owner/tenants/${id}/admins`),
    enabled:  !!id,
  })
  const admins = adminsData?.data ?? []

  const addAdminMut = useMutation({
    mutationFn: () => ownerApi.post(`/owner/tenants/${id}/admins`, {
      name:     adminForm.name,
      email:    adminForm.email,
      password: adminForm.password || generatePassword(),
      role:     adminForm.role,
    }),
    onSuccess: () => {
      toast.success('Admin account created')
      setAddAdminOpen(false)
      setAdminForm({ name: '', email: '', password: '', role: 'super_admin' })
      setShowAdminPwd(false)
      refetchAdmins()
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const toggleAdminMut = useMutation({
    mutationFn: ({ adminId, is_active }: { adminId: string; is_active: boolean }) =>
      ownerApi.patch(`/owner/tenants/${id}/admins/${adminId}`, { is_active }),
    onSuccess: () => { toast.success('Updated'); refetchAdmins() },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const resetPasswordMut = useMutation({
    // password omitted/empty → backend auto-generates a strong temp password.
    mutationFn: ({ adminId, password }: { adminId: string; password?: string }) =>
      ownerApi.post<{ data: { email: string; temp_password: string } }>(
        `/owner/tenants/${id}/admins/${adminId}/reset-password`,
        password && password.trim().length >= 8 ? { password: password.trim() } : {},
      ),
    onSuccess: (res) => {
      setResetResult(res.data)
      setCopiedPwd(false)
      setResetAdminId(null)
      setResetPwd('')
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const copyPassword = useCallback((pwd: string) => {
    navigator.clipboard.writeText(pwd).then(() => {
      setCopiedPwd(true)
      setTimeout(() => setCopiedPwd(false), 2000)
    })
  }, [])

  function startEdit() {
    if (!t) return
    setEditForm({
      plan:               t.plan,
      per_employee_rate:  String(t.per_employee_rate),
      billing_email:      t.billing_email ?? '',
      notes:              t.notes ?? '',
    })
    setEditing(true)
  }

  const updateMut = useMutation({
    mutationFn: () => ownerApi.patch(`/owner/tenants/${id}`, {
      ...editForm, per_employee_rate: Number(editForm.per_employee_rate) || 0,
    }),
    onSuccess: () => { toast.success('Tenant updated'); setEditing(false); qc.invalidateQueries({ queryKey: ['owner-tenant', id] }) },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  function doStatusAction(action: 'activate' | 'suspend' | 'cancel') {
    ownerApi.post(`/owner/tenants/${id}/${action}`)
      .then(() => { toast.success(`Tenant ${action}d`); qc.invalidateQueries({ queryKey: ['owner-tenant', id] }) })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
  }

  function statusAction(action: 'activate' | 'suspend' | 'cancel') {
    const name = t?.name ?? 'this tenant'
    if (action === 'suspend') {
      setCdlg({ msg: `Suspend "${name}"? Their users will be blocked from making changes until reactivated.`, act: () => doStatusAction('suspend') })
    } else if (action === 'cancel') {
      setCdlg({ msg: `Cancel "${name}"'s subscription? They will lose write access.`, act: () => doStatusAction('cancel') })
    } else {
      doStatusAction(action)
    }
  }

  function issueLicense() {
    ownerApi.post(`/owner/tenants/${id}/license`, { months: Number(licenseMonths) })
      .then(() => { toast.success('License issued'); qc.invalidateQueries({ queryKey: ['owner-tenant', id] }); qc.invalidateQueries({ queryKey: ['owner-tenants'] }) })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
  }

  function deleteTenant() {
    const name = t?.name ?? 'this tenant'
    setCdlg({
      msg: `Permanently DELETE "${name}" and ALL its data (employees, payroll, attendance, logins)?\n\nThis cannot be undone.`,
      destructive: true,
      act: () => ownerApi.delete<{ message?: string }>(`/owner/tenants/${id}`)
        .then((res) => { toast.success(res?.message ?? 'Tenant deleted'); qc.invalidateQueries({ queryKey: ['owner-tenants'] }); navigate('/owner/tenants') })
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
    })
  }

  if (isLoading) return (
    <div className="p-6 space-y-4">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />)}
    </div>
  )
  if (isError) return (
    <div className="p-6">
      <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm text-destructive">Couldn’t load this tenant. Please try again.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    </div>
  )
  if (!t) return <div className="p-6 text-muted-foreground">Tenant not found</div>

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => navigate('/owner/tenants')} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Tenants
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.name}</h1>
          <div className="flex items-center gap-2.5 mt-1.5">
            <span className="text-sm text-muted-foreground">{t.slug}</span>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${STATUS_COLOR[t.status]}`}>{t.status}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
              t.plan === 'enterprise' ? 'border-accent-violet/30 text-accent-violet bg-accent-violet/15' : 'border-border text-muted-foreground bg-muted'
            }`}>{t.plan}</span>
          </div>
        </div>
        {isOwner() && (
          <div className="flex flex-wrap items-center gap-2">
            {!editing && (
              <Button onClick={startEdit} size="sm" className="bg-card bg-none backdrop-blur border border-border text-foreground hover:bg-muted hover:text-foreground shadow-sm gap-1.5">
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            {t.status !== 'active'    && <Button onClick={() => statusAction('activate')} size="sm" className="bg-success bg-none hover:bg-success/90 text-success-foreground shadow-sm shadow-success/20">Activate</Button>}
            {t.status === 'active'    && <Button onClick={() => statusAction('suspend')}  size="sm" className="bg-warning bg-none hover:bg-warning/90 text-warning-foreground shadow-sm shadow-warning/20">Suspend</Button>}
            {t.status !== 'cancelled' && <Button onClick={() => statusAction('cancel')}   size="sm" className="bg-card bg-none backdrop-blur border border-border text-muted-foreground hover:bg-muted hover:text-foreground shadow-sm">Cancel</Button>}
            <Button onClick={deleteTenant} size="sm" className="bg-card bg-none backdrop-blur border border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive shadow-sm gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Details card */}
        <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
            {editing && (
              <div className="flex gap-1.5">
                <Button onClick={() => updateMut.mutate()} size="sm" className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20 h-7 text-xs gap-1">
                  <Save className="h-3 w-3" /> Save
                </Button>
                <Button onClick={() => setEditing(false)} size="sm" variant="ghost" className="text-muted-foreground h-7 text-xs gap-1">
                  <X className="h-3 w-3" /> Cancel
                </Button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              {[
                { key: 'billing_email',      label: 'Billing Email', type: 'email' },
                { key: 'per_employee_rate',  label: 'Per-Employee Rate (₹)', type: 'number' },
                { key: 'notes',             label: 'Notes', type: 'text' },
              ].map(({ key, label, type }) => (
                <div key={key} className="space-y-1">
                  <label htmlFor={`edit-tenant-${key}`} className="text-xs text-muted-foreground">{label}</label>
                  <Input
                    id={`edit-tenant-${key}`}
                    type={type}
                    value={editForm[key] ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className="bg-muted border-border text-foreground h-8 text-sm"
                  />
                </div>
              ))}
              <div className="space-y-1">
                <label htmlFor="edit-tenant-plan" className="text-xs text-muted-foreground">Plan</label>
                <select
                  id="edit-tenant-plan"
                  value={editForm.plan}
                  onChange={e => setEditForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="standard">Standard</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
          ) : (
            <dl className="space-y-2.5 text-sm">
              {[
                { label: 'Country',         value: t.country },
                { label: 'Billing Email',   value: t.billing_email ?? '—' },
                { label: 'Rate / employee', value: t.per_employee_rate > 0 ? fmtCurrency(t.per_employee_rate) : '—' },
                { label: 'Created',         value: fmtDate(t.created_at) },
                { label: 'Trial Ends',      value: fmtDate(t.trial_ends_at) },
                { label: 'License Issued',  value: fmtDate(t.license_issued_at) },
                { label: 'License Expires', value: fmtDate(t.license_expires_at) },
                { label: 'Notes',           value: t.notes ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-32 flex-shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="text-foreground break-all">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* License management */}
        {isOwner() && (
          <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring p-4 space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" /> License Management
            </h2>
            <div className="space-y-2">
              <label htmlFor="license-months" className="text-xs text-muted-foreground">Issue license for</label>
              <div className="flex gap-2">
                <select
                  id="license-months"
                  value={licenseMonths}
                  onChange={e => setLicenseMonths(e.target.value)}
                  className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground flex-1"
                >
                  {[1, 3, 6, 12, 24].map(m => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
                </select>
                <Button onClick={issueLicense} className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20">
                  Issue License
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Sets status to <span className="text-success">active</span> and records license_issued_at / license_expires_at.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Billing snapshots */}
      {t.billing_snapshots.length > 0 && (
        <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Billing History</h2>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-card">
              <tr>
                {['Month', 'Employees', 'Rate / emp', 'Amount Due', 'Plan'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {t.billing_snapshots.map(b => (
                <tr key={b.id} className="hover:bg-muted">
                  <td className="px-4 py-2.5 text-foreground font-mono text-[12px]">{b.snapshot_month}</td>
                  <td className="px-4 py-2.5 text-foreground">{b.employee_count}</td>
                  <td className="px-4 py-2.5 text-foreground">{fmtCurrency(b.per_employee_rate)}</td>
                  <td className="px-4 py-2.5 text-success font-semibold">{fmtCurrency(b.amount_due)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-[11px]">{b.plan}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* API keys */}
      {t.api_keys.length > 0 && (
        <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">API Keys</h2>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-card">
              <tr>
                {['Name', 'Key Prefix', 'Scopes', 'Last Used', 'Status'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {t.api_keys.map(k => (
                <tr key={k.id} className="hover:bg-muted">
                  <td className="px-4 py-2.5 text-foreground">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">{k.key_prefix}…</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{fmtDate(k.last_used_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-medium ${k.is_active ? 'text-success' : 'text-muted-foreground'}`}>
                      {k.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── Tenant Admins ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Tenant Admin Accounts</h2>
            <span className="text-[11px] text-muted-foreground">({admins.length})</span>
          </div>
          {isOwner() && (
            <Button
              size="sm"
              onClick={() => setAddAdminOpen(true)}
              className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20 h-7 text-xs gap-1"
            >
              <UserPlus className="h-3 w-3" /> Add Admin
            </Button>
          )}
        </div>

        {admins.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            <ShieldCheck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p>No admin accounts yet.</p>
            <p className="text-xs mt-1">Click "Add Admin" to provision the first login for this tenant.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-card">
              <tr>
                {['Name', 'Email', 'Role', 'Created', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {admins.map(a => {
                const displayName = a.full_name || a.email || 'Unknown'
                const roleLabel: Record<string, string> = {
                  super_admin: 'Admin', hr_admin: 'HR Admin', manager: 'Manager',
                }
                return (
                <tr key={a.id} className="hover:bg-muted">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-primary-foreground">{displayName.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="text-[13px] text-foreground font-medium">{displayName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{a.email ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                      a.role === 'super_admin'
                        ? 'border-primary/40 text-primary bg-primary/10'
                        : a.role === 'hr_admin'
                        ? 'border-info/40 text-info bg-info/10'
                        : 'border-border text-muted-foreground bg-muted'
                    }`}>
                      {roleLabel[a.role] ?? a.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                    {fmtDate(a.created_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-medium ${a.is_active ? 'text-success' : 'text-destructive'}`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {isOwner() && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setResetAdminId(a.id); setResetPwd(''); setShowResetPwd(false) }}
                          disabled={resetPasswordMut.isPending}
                          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-warning hover:bg-warning/10 gap-1"
                          title="Reset password"
                          aria-label="Reset password"
                        >
                          <KeyRound className="h-3 w-3" /> Reset
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (a.is_active) {
                              setCdlg({
                                msg: `Deactivate "${displayName}"? They will be immediately locked out of the product until reactivated.`,
                                act: () => toggleAdminMut.mutate({ adminId: a.id, is_active: false }),
                                destructive: true,
                              })
                            } else {
                              toggleAdminMut.mutate({ adminId: a.id, is_active: true })
                            }
                          }}
                          disabled={toggleAdminMut.isPending}
                          className={`h-6 px-2 text-[10px] gap-1 ${
                            a.is_active
                              ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                              : 'text-muted-foreground hover:text-success hover:bg-success/10'
                          }`}
                        >
                          {a.is_active ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                          {a.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ── Reset Password Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!resetAdminId} onOpenChange={open => { if (!open) { setResetAdminId(null); setResetPwd(''); setShowResetPwd(false) } }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-warning" />
              Reset Admin Password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Enter a new password, or leave blank to auto-generate a strong one.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="reset-admin-password" className="text-xs font-medium text-foreground">New Password</label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    id="reset-admin-password"
                    type={showResetPwd ? 'text' : 'password'}
                    placeholder="Min 8 chars (blank = auto-generate)"
                    value={resetPwd}
                    onChange={e => setResetPwd(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPwd(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showResetPwd ? 'Hide password' : 'Show password'}
                  >
                    {showResetPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setResetPwd(generatePassword()); setShowResetPwd(true) }}
                  className="h-8 border-border text-muted-foreground hover:text-foreground gap-1 px-2"
                >
                  <RefreshCw className="h-3 w-3" /> Generate
                </Button>
              </div>
              {resetPwd && resetPwd.trim().length > 0 && resetPwd.trim().length < 8 && (
                <p className="text-[10px] text-destructive">Password must be at least 8 characters.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => resetAdminId && resetPasswordMut.mutate({ adminId: resetAdminId, password: resetPwd })}
              disabled={resetPasswordMut.isPending || (resetPwd.trim().length > 0 && resetPwd.trim().length < 8)}
              className="bg-warning bg-none hover:bg-warning/90 text-warning-foreground shadow-sm shadow-warning/20"
            >
              {resetPasswordMut.isPending ? 'Resetting…' : (resetPwd.trim() ? 'Set Password' : 'Auto-Generate & Reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Admin Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={addAdminOpen} onOpenChange={open => { setAddAdminOpen(open); if (!open) { setAdminForm({ name: '', email: '', password: '', role: 'super_admin' }); setShowAdminPwd(false) } }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              Add Tenant Admin
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Creates a Supabase auth account + CognixHR profile. The admin can log in immediately with these credentials.
            </p>

            <div className="space-y-1.5">
              <label htmlFor="add-admin-name" className="text-xs font-medium text-foreground">Full Name *</label>
              <Input
                id="add-admin-name"
                placeholder="John Smith"
                value={adminForm.name}
                onChange={e => setAdminForm(f => ({ ...f, name: e.target.value }))}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="add-admin-email" className="text-xs font-medium text-foreground">Email *</label>
              <Input
                id="add-admin-email"
                type="email"
                placeholder="admin@company.com"
                value={adminForm.email}
                onChange={e => setAdminForm(f => ({ ...f, email: e.target.value }))}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="add-admin-password" className="text-xs font-medium text-foreground">Temporary Password *</label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    id="add-admin-password"
                    type={showAdminPwd ? 'text' : 'password'}
                    placeholder="Min 8 characters"
                    value={adminForm.password}
                    onChange={e => setAdminForm(f => ({ ...f, password: e.target.value }))}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPwd(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showAdminPwd ? 'Hide password' : 'Show password'}
                  >
                    {showAdminPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setAdminForm(f => ({ ...f, password: generatePassword() })); setShowAdminPwd(true) }}
                  className="h-8 border-border text-muted-foreground hover:text-foreground gap-1 px-2"
                >
                  <RefreshCw className="h-3 w-3" /> Generate
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="add-admin-role" className="text-xs font-medium text-foreground">Role</label>
              <select
                id="add-admin-role"
                value={adminForm.role}
                onChange={e => setAdminForm(f => ({ ...f, role: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
              >
                <option value="super_admin">Admin (full access)</option>
                <option value="hr_admin">HR Admin</option>
                <option value="manager">Manager</option>
              </select>
            </div>

            {adminForm.password && showAdminPwd && (
              <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs">
                <span className="text-warning font-semibold">Save before submitting: </span>
                <code className="text-foreground font-mono font-semibold select-all">{adminForm.password}</code>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddAdminOpen(false)} className="text-muted-foreground">Cancel</Button>
            <Button
              onClick={() => addAdminMut.mutate()}
              disabled={!adminForm.name.trim() || !adminForm.email.trim() || !adminForm.password.trim() || addAdminMut.isPending}
              className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20"
            >
              {addAdminMut.isPending ? 'Creating…' : 'Create Admin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Result Dialog ─────────────────────────────────────── */}
      <Dialog open={!!resetResult} onOpenChange={open => { if (!open) setResetResult(null) }}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-warning" />
              Password Reset
            </DialogTitle>
          </DialogHeader>
          {resetResult && (
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">New temporary password for <span className="text-foreground">{resetResult.email}</span>:</p>
              <div className="flex items-center gap-2 rounded-lg bg-muted border border-border px-3 py-2">
                <code className="flex-1 font-mono text-sm font-semibold text-foreground select-all">{resetResult.temp_password}</code>
                <button
                  onClick={() => copyPassword(resetResult.temp_password)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Copy password"
                >
                  {copiedPwd ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-warning">⚠ Share this with the admin now — it won't be shown again.</p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResetResult(null)} className="bg-muted bg-none hover:bg-muted text-foreground">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!cdlg} message={cdlg?.msg ?? ''} title="Confirm" confirmLabel="Confirm" destructive={cdlg?.destructive} onConfirm={() => { cdlg?.act(); setCdlg(null) }} onCancel={() => setCdlg(null)} />
    </div>
  )
}
