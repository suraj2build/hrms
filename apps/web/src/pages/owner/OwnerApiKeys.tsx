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
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => ownerApi.delete(`/owner/api-keys/${id}`),
    onSuccess: () => { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['owner-api-keys'] }) },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
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
          <h1 className="text-2xl font-bold text-foreground">API Keys</h1>
          <p className="text-sm text-muted-foreground">{keys.filter(k => k.is_active).length} active keys</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20 gap-1.5">
          <Plus className="h-4 w-4" /> Generate Key
        </Button>
      </div>

      {/* Keys grouped by tenant */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
        </div>
      )}

      {!isLoading && keys.length === 0 && (
        <div className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring/[0.04] p-8 text-center text-muted-foreground">
          No API keys yet. Generate one for a tenant.
        </div>
      )}

      {Object.entries(byTenant).map(([tenantId, tKeys]) => (
        <div key={tenantId} className="rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-ring/[0.04] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <Key className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">{tenantNameMap[tenantId] ?? tenantId}</span>
            <span className="text-[11px] text-muted-foreground ml-auto">{tKeys.filter(k => k.is_active).length} active</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-card">
              <tr>
                {['Name', 'Prefix', 'Scopes', 'Last Used', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tKeys.map(k => (
                <tr key={k.id} className="hover:bg-muted">
                  <td className="px-4 py-2.5 text-foreground text-[13px]">{k.name}</td>
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
                    {k.is_active
                      ? <span className="flex items-center gap-1 text-[11px] text-success"><CheckCircle2 className="h-3 w-3" /> Active</span>
                      : <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Revoked</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    {k.is_active && (
                      <button
                        onClick={() => revokeMut.mutate(k.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Revoke key"
                        aria-label="Revoke key"
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
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader><DialogTitle>Generate API Key</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label htmlFor="new-key-tenant" className="text-sm font-medium text-foreground">Tenant *</label>
              <select
                id="new-key-tenant"
                value={form.tenant_id}
                onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
              >
                <option value="">Select tenant…</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-key-name" className="text-sm font-medium text-foreground">Key Name</label>
              <Input
                id="new-key-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Production"
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Scopes</label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_SCOPES.map(s => (
                  <label key={s} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                      className="rounded border-border"
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="text-muted-foreground">Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!form.tenant_id || !form.name || form.scopes.length === 0 || createMut.isPending}
              className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20"
            >
              {createMut.isPending ? 'Generating…' : 'Generate Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New key revealed dialog — shown ONCE */}
      <Dialog open={!!newKey} onOpenChange={() => { setNewKey(null); setShowKey(false) }}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" /> API Key Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-amber-700 font-medium">
              ⚠ Save this key now — it will never be shown again.
            </p>
            <div className="relative rounded-lg bg-muted border border-border p-3">
              <p className="font-mono text-[12px] text-emerald-700 break-all pr-16">
                {showKey ? newKey : '•'.repeat(Math.min((newKey?.length ?? 40), 40))}
              </p>
              <div className="absolute top-2 right-2 flex gap-1">
                <button onClick={() => setShowKey(!showKey)} className="p-1.5 rounded bg-muted hover:bg-muted text-foreground" aria-label={showKey ? 'Hide key' : 'Show key'}>
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(newKey ?? ''); toast.success('Copied!') }}
                  className="p-1.5 rounded bg-muted hover:bg-muted text-foreground"
                  aria-label="Copy key"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewKey(null); setShowKey(false) }} className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20">
              I've saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
