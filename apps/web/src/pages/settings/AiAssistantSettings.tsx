/**
 * AiAssistantSettings — /admin/settings/ai
 *
 * One screen to configure an ordered chain of AI providers. The assistant tries
 * each enabled provider top-to-bottom and uses the first that answers — so the
 * ones below act as automatic fallbacks. Reorder with the up/down arrows.
 *
 * Keys are write-only: the server returns a masked hint, never the full key.
 */
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Sparkles, ShieldAlert, Loader2, Check, Plug, KeyRound,
  ArrowUp, ArrowDown, Trash2, Plus,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ProviderOpt { id: string; label: string; default_model: string }
interface ChainRow { provider: string; model: string | null; enabled: boolean; has_key: boolean; key_hint: string | null }
interface ActiveCfg { provider: string; model: string; source: string; count: number }
interface ConfigResp {
  chain: ChainRow[]
  active: ActiveCfg | null
  providers: ProviderOpt[]
  updated_at: string | null
}

// Local editable row — newKey carries a freshly-typed key (blank = keep saved).
interface EditRow { provider: string; model: string; enabled: boolean; has_key: boolean; key_hint: string | null; newKey: string }

export function AiAssistantSettings() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const { data, isLoading, refetch } = useQuery<{ data: ConfigResp }>({
    queryKey: ['assistant-config'],
    queryFn:  () => api.get('/assistant/config'),
    enabled:  isAdmin,
  })
  const cfg = data?.data
  const providers = cfg?.providers ?? []

  const [rows, setRows] = useState<EditRow[] | null>(null)

  // Seed local rows from the server once loaded.
  useEffect(() => {
    if (cfg && rows === null) {
      setRows(cfg.chain.map(c => ({
        provider: c.provider, model: c.model ?? '', enabled: c.enabled,
        has_key: c.has_key, key_hint: c.key_hint, newKey: '',
      })))
    }
  }, [cfg, rows])

  const list = rows ?? []
  const metaFor = (id: string) => providers.find(p => p.id === id)
  const usedProviders = new Set(list.map(r => r.provider))
  const available = providers.filter(p => !usedProviders.has(p.id))

  const setRow = (i: number, patch: Partial<EditRow>) =>
    setRows(rs => (rs ?? []).map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const move = (i: number, dir: -1 | 1) =>
    setRows(rs => {
      const a = [...(rs ?? [])]
      const j = i + dir
      if (j < 0 || j >= a.length) return a
      ;[a[i], a[j]] = [a[j]!, a[i]!]
      return a
    })
  const remove = (i: number) => setRows(rs => (rs ?? []).filter((_, idx) => idx !== i))
  const add = (provider: string) =>
    setRows(rs => [...(rs ?? []), { provider, model: '', enabled: true, has_key: false, key_hint: null, newKey: '' }])

  const save = useMutation({
    mutationFn: () => api.put('/assistant/config', {
      chain: list.map(r => ({
        provider: r.provider,
        model:    r.model.trim() || null,
        enabled:  r.enabled,
        // Only send api_key when the admin typed a new one; blank keeps the saved key.
        ...(r.newKey ? { api_key: r.newKey } : {}),
      })),
    }),
    onSuccess: async () => {
      const fresh = await refetch()
      if (fresh.data) {
        setRows(fresh.data.data.chain.map(c => ({
          provider: c.provider, model: c.model ?? '', enabled: c.enabled,
          has_key: c.has_key, key_hint: c.key_hint, newKey: '',
        })))
      }
      qc.invalidateQueries({ queryKey: ['assistant-status'] })
      toast.success('AI settings saved')
    },
    onError: (e: Error) => toast.error('Could not save', { description: e.message }),
  })

  const test = useMutation({
    mutationFn: (r: EditRow) => api.post<{ data: { ok: boolean; message: string } }>('/assistant/config/test', {
      provider: r.provider,
      model:    r.model.trim() || null,
      ...(r.newKey ? { api_key: r.newKey } : {}),
    }),
    onSuccess: (res) => res.data.ok
      ? toast.success('Connection OK', { description: res.data.message })
      : toast.error('Connection failed', { description: res.data.message }),
    onError: (e: Error) => toast.error('Test failed', { description: e.message }),
  })

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="AI Assistant" subtitle="Configure the in-app assistant" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can configure the AI assistant.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="AI Assistant"
        subtitle="Add one or more providers — the assistant uses them top-to-bottom and falls back automatically"
      />

      <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#15B8A6]" />
        <p>
          The assistant is <span className="font-semibold">read-only</span> and answers each person only from data
          they're already allowed to see. List providers in priority order: the <span className="font-medium">top</span> one
          is used first, and if it's rate-limited or down the next is tried automatically.
        </p>
      </div>

      {cfg?.active && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-xs text-foreground">
          <Plug className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
          <p>
            Currently answering with <span className="font-semibold">{cfg.active.provider}</span>{' '}
            <span className="text-muted-foreground">({cfg.active.model}, {cfg.active.source} key)</span>
            {cfg.active.count > 1 && <> — {cfg.active.count - 1} fallback{cfg.active.count > 2 ? 's' : ''} ready.</>}
          </p>
        </div>
      )}

      {isLoading || rows === null ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div></SectionCard>
      ) : (
        <SectionCard title="Providers" icon={<Plug className="h-4 w-4 text-muted-foreground" />}>
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No providers yet — add one below.</p>
          ) : (
            <div className="space-y-3">
              {list.map((r, i) => {
                const m = metaFor(r.provider)
                return (
                  <div key={r.provider} className="rounded-lg border border-border p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
                        <span className="text-sm font-medium">{m?.label ?? r.provider}</span>
                        {i === 0 && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">Primary</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Remove" onClick={() => remove(i)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Model <span className="text-muted-foreground/60">(blank = {m?.default_model})</span></label>
                        <Input value={r.model} onChange={e => setRow(i, { model: e.target.value })} placeholder={m?.default_model} className="h-9 text-sm" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KeyRound className="h-3 w-3" />API key</label>
                        <Input
                          type="password"
                          value={r.newKey}
                          onChange={e => setRow(i, { newKey: e.target.value })}
                          placeholder={r.has_key ? `Saved: ${r.key_hint} — type to replace` : 'Paste API key'}
                          className="h-9 text-sm font-mono"
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                        <input type="checkbox" checked={r.enabled} onChange={e => setRow(i, { enabled: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
                        Enabled
                      </label>
                      <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(r)}>
                        {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
                        Test
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add provider */}
          {available.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Add provider:</span>
              {available.map(p => (
                <button key={p.id} type="button" onClick={() => add(p.id)}
                  className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary">
                  <Plus className="h-3 w-3" />{p.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 flex justify-end border-t border-border pt-4">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Save settings
            </Button>
          </div>
        </SectionCard>
      )}
    </PageContainer>
  )
}
