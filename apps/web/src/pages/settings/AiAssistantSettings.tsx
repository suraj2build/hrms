/**
 * AiAssistantSettings — /admin/settings/ai
 *
 * Admin panel to configure the AI Assistant provider + API key + model + toggle,
 * with an optional fallback provider that kicks in automatically when the primary
 * is unavailable (rate-limited, down, bad key, etc.).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sparkles, ShieldAlert, Loader2, Check, Plug, KeyRound, ArrowDownToLine } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ProviderOpt { id: string; label: string; default_model: string }
interface ConfigResp {
  provider: string; model: string | null; enabled: boolean
  has_key: boolean; key_hint: string | null; source: string; env_fallback: boolean
  fallback_provider: string | null; fallback_model: string | null
  has_fallback_key: boolean; fallback_key_hint: string | null
  providers: ProviderOpt[]; updated_at: string | null
}

function ProviderPicker({
  providers, value, onChange,
}: { providers: ProviderOpt[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {providers.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            value === p.id
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted/50'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export function AiAssistantSettings() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const { data, isLoading } = useQuery<{ data: ConfigResp }>({
    queryKey: ['assistant-config'],
    queryFn:  () => api.get('/assistant/config'),
    enabled:  isAdmin,
  })
  const cfg = data?.data

  // ── Primary local state ──────────────────────────────────────────────────────
  const [provider, setProvider] = useState<string | null>(null)
  const [model,    setModel]    = useState<string | null>(null)
  const [enabled,  setEnabled]  = useState<boolean | null>(null)
  const [apiKey,   setApiKey]   = useState('')

  // ── Fallback local state ─────────────────────────────────────────────────────
  const [fbProvider, setFbProvider] = useState<string | null>(null)
  const [fbModel,    setFbModel]    = useState<string | null>(null)
  const [fbApiKey,   setFbApiKey]   = useState('')

  // Effective values
  const providers      = cfg?.providers ?? []
  const eProvider      = provider  ?? cfg?.provider      ?? 'groq'
  const eEnabled       = enabled   ?? cfg?.enabled       ?? true
  const eModel         = model     ?? cfg?.model         ?? ''
  const eFbProvider    = fbProvider ?? cfg?.fallback_provider ?? ''
  const eFbModel       = fbModel    ?? cfg?.fallback_model    ?? ''

  const curProvMeta   = providers.find(p => p.id === eProvider)
  const curFbProvMeta = providers.find(p => p.id === eFbProvider)
  const hasFallback   = !!eFbProvider

  const save = useMutation({
    mutationFn: () => api.put('/assistant/config', {
      provider: eProvider,
      model:    eModel.trim() || null,
      enabled:  eEnabled,
      ...(apiKey ? { api_key: apiKey } : {}),
      fallback_provider: eFbProvider || null,
      fallback_model:    eFbModel.trim() || null,
      ...(fbApiKey ? { fallback_api_key: fbApiKey } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant-config'] })
      qc.invalidateQueries({ queryKey: ['assistant-status'] })
      setApiKey(''); setFbApiKey('')
      toast.success('AI settings saved')
    },
    onError: (e: Error) => toast.error('Could not save', { description: e.message }),
  })

  const test = useMutation({
    mutationFn: (slot: 'primary' | 'fallback') => api.post<{ data: { ok: boolean; message: string } }>('/assistant/config/test', {
      provider: slot === 'primary' ? eProvider : (eFbProvider || undefined),
      model:    slot === 'primary'
        ? (eModel.trim() || null)
        : (eFbModel.trim() || null),
      ...(slot === 'primary' && apiKey   ? { api_key: apiKey }   : {}),
      ...(slot === 'fallback' && fbApiKey ? { api_key: fbApiKey } : {}),
      slot,
    }),
    onSuccess: (r) => r.data.ok
      ? toast.success('Connection OK', { description: r.data.message })
      : toast.error('Connection failed', { description: r.data.message }),
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
        subtitle="Choose a provider, paste an API key, and the in-app assistant turns on for everyone"
      />

      <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#15B8A6]" />
        <p>
          The assistant is <span className="font-semibold">read-only</span> and answers each person only from
          data they're already allowed to see. Configure a <span className="font-medium">fallback provider</span> below
          — if the primary is rate-limited or unavailable, the assistant automatically switches to it.
        </p>
      </div>

      {isLoading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div></SectionCard>
      ) : (
        <>
          {/* ── Primary provider ─────────────────────────────────────────────── */}
          <SectionCard title="Primary provider" icon={<Plug className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-4 max-w-xl">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <ProviderPicker
                  providers={providers}
                  value={eProvider}
                  onChange={v => { setProvider(v); setModel('') }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Model <span className="text-muted-foreground/60">(blank = {curProvMeta?.default_model})</span>
                </label>
                <Input value={eModel} onChange={e => setModel(e.target.value)} placeholder={curProvMeta?.default_model} className="h-9 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KeyRound className="h-3 w-3" />API key</label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={cfg?.has_key ? `Saved: ${cfg.key_hint} — type to replace` : 'Paste your API key'}
                  className="h-9 text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  {cfg?.has_key
                    ? `A key is saved (${cfg.source}). Leave blank to keep it.`
                    : cfg?.env_fallback
                      ? 'No saved key, but an environment key is available as fallback.'
                      : 'No key configured yet — the assistant stays off until one is added.'}
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                <input type="checkbox" checked={eEnabled} onChange={e => setEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                Assistant enabled for this organisation
              </label>

              <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate('primary')}>
                {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
                Test primary
              </Button>
            </div>
          </SectionCard>

          {/* ── Fallback provider ────────────────────────────────────────────── */}
          <SectionCard
            title="Fallback provider"
            icon={<ArrowDownToLine className="h-4 w-4 text-muted-foreground" />}
          >
            <p className="text-xs text-muted-foreground mb-4">
              Optional. If the primary fails (rate limit, downtime, invalid key), the assistant automatically retries with this provider.
            </p>
            <div className="space-y-4 max-w-xl">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => { setFbProvider(''); setFbModel('') }}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      !eFbProvider ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    None
                  </button>
                  {providers.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setFbProvider(p.id); setFbModel('') }}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        eFbProvider === p.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {hasFallback && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Model <span className="text-muted-foreground/60">(blank = {curFbProvMeta?.default_model})</span>
                    </label>
                    <Input value={eFbModel} onChange={e => setFbModel(e.target.value)} placeholder={curFbProvMeta?.default_model} className="h-9 text-sm" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KeyRound className="h-3 w-3" />Fallback API key</label>
                    <Input
                      type="password"
                      value={fbApiKey}
                      onChange={e => setFbApiKey(e.target.value)}
                      placeholder={cfg?.has_fallback_key ? `Saved: ${cfg.fallback_key_hint} — type to replace` : 'Paste API key for fallback provider'}
                      className="h-9 text-sm font-mono"
                    />
                    {cfg?.has_fallback_key && (
                      <p className="text-[10px] text-muted-foreground">A fallback key is saved. Leave blank to keep it.</p>
                    )}
                  </div>

                  <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate('fallback')}>
                    {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
                    Test fallback
                  </Button>
                </>
              )}
            </div>
          </SectionCard>

          {/* ── Save ─────────────────────────────────────────────────────────── */}
          <div className="flex justify-end">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Save settings
            </Button>
          </div>
        </>
      )}
    </PageContainer>
  )
}
