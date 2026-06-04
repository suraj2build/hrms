import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerApi }  from '@/lib/api/ownerApi'
import { toast }     from 'sonner'
import {
  Plus, Copy, Trash2, CheckCircle2, Clock, Key, Eye, EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface Tenant    { id: string; name: string }
interface ApiKey    { id: string; tenant_id: string; name: string; key_prefix: string; scopes: string[]; is_active: boolean; last_used_at: string | null; created_at: string }
interface NewKeyRes { data: ApiKey & { key: string }; message: string }

const ALL_SCOPES = ['employees:read', 'employees:write', 'attendance:read', 'payroll:read']

function fmtDate(d: string | null) {
  if (!d) return 'Never'
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

export function OwnerApiKeys() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newKey, setNewKey]         = useState<string | null>(null)
  const [showKey, setShowKey]       = useState(false)
  const [form, setForm]             = useState({ tenant_id: '', name: 'Production', scopes: ['employees:read'] as string[] })

  const { data: tenantsData } = useQuery<{ data: Tenant[] }>({
    queryKey: ['owner-tenants-list'],
    queryFn:  () => ownerApi.get('/owner/tenants?limit=200'),
  })
  const tenants = tenantsData?.data ?? []

  const { data, isLoading } = useQuery<{ data: ApiKey[] }>({
    queryKey: ['owner-api-keys'],
    queryFn:  () => ownerApi.get('/owner/api-keys?active=false'),
    placeholderData: (prev) => prev,
  })
  const keys = data?.data ?? []

  const createMut = useMutation({
    mutationFn: () => ownerApi.post<NewKeyRes>('/owner/api-keys', form),
    onSuccess: (res) => {
      setNewKey(res.data.key)
      setCreateOpen(false)
      setForm({ tenant_id: '', name: 'Production', scopes: ['employees:read'] })
      qc.invalidateQueries({ queryKey: ['owner-api-keys'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => ownerApi.delete(`/owner/api-keys/${id}`),
    onSuccess: () => { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['owner-api-keys'] }) },
    onError: (e: any) => toast.error(e.message),
  })

  function toggleScope(s: string) {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(s) ? f.scopes.filter(x => x !== s) : [...f.scopes, s],
    }))
  }

  // Group by tenant
  const byTenant = keys.reduce<Record<string, ApiKey[]>>((acc, k) => {
    if (!acc[k.tenant_id]) acc[k.tenant_id] = []
    acc[k.tenant_id].push(k)
    return acc
  }, {})

  const tenantNameMap = tenants.reduce<Record<string, string>>((acc, t) => { acc[t.id] = t.name; return acc }, {})

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">API Keys</h1>
          <p className="text-sm text-slate-500">{keys.filter(k => k.is_active).length} active keys</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white border-0 shadow-md shadow-teal-500/20 gap-1.5">
          <Plus className="h-4 w-4" /> Generate Key
        </Button>
      </div>

      {/* Keys grouped by tenant */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-xl" />)}
        </div>
      )}

      {!isLoading && keys.length === 0 && (
        <div className="rounded-2xl border border-white/70 bg-white/55 backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04] p-8 text-center text-slate-500">
          No API keys yet. Generate one for a tenant.
        </div>
      )}

      {Object.entries(byTenant).map(([tenantId, tKeys]) => (
        <div key={tenantId} className="rounded-2xl border border-white/70 bg-white/55 backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-2">
            <Key className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">{tenantNameMap[tenantId] ?? tenantId}</span>
            <span className="text-[11px] text-slate-400 ml-auto">{tKeys.filter(k => k.is_active).length} active</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white/50">
              <tr>
                {['Name', 'Prefix', 'Scopes', 'Last Used', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-4 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tKeys.map(k => (
                <tr key={k.id} className="hover:bg-slate-100/30">
                  <td className="px-4 py-2.5 text-slate-700 text-[13px]">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-slate-500">{k.key_prefix}…</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">{fmtDate(k.last_used_at)}</td>
                  <td className="px-4 py-2.5">
                    {k.is_active
                      ? <span className="flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Active</span>
                      : <span className="flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-3 w-3" /> Revoked</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    {k.is_active && (
                      <button
                        onClick={() => revokeMut.mutate(k.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                        title="Revoke key"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-md">
          <DialogHeader><DialogTitle>Generate API Key</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Tenant *</label>
              <select
                value={form.tenant_id}
                onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                className="w-full bg-slate-100 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Select tenant…</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Key Name</label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Production"
                className="bg-slate-100 border-slate-200 text-slate-900"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Scopes</label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_SCOPES.map(s => (
                  <label key={s} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                      className="rounded border-slate-300"
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="text-slate-500">Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!form.tenant_id || !form.name || form.scopes.length === 0 || createMut.isPending}
              className="bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white border-0 shadow-md shadow-teal-500/20"
            >
              {createMut.isPending ? 'Generating…' : 'Generate Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New key revealed dialog — shown ONCE */}
      <Dialog open={!!newKey} onOpenChange={() => { setNewKey(null); setShowKey(false) }}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" /> API Key Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-amber-700 font-medium">
              ⚠ Save this key now — it will never be shown again.
            </p>
            <div className="relative rounded-lg bg-slate-100 border border-slate-200 p-3">
              <p className="font-mono text-[12px] text-emerald-700 break-all pr-16">
                {showKey ? newKey : '•'.repeat(Math.min((newKey?.length ?? 40), 40))}
              </p>
              <div className="absolute top-2 right-2 flex gap-1">
                <button onClick={() => setShowKey(!showKey)} className="p-1.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700">
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(newKey ?? ''); toast.success('Copied!') }}
                  className="p-1.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewKey(null); setShowKey(false) }} className="bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white border-0 shadow-md shadow-teal-500/20">
              I've saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
