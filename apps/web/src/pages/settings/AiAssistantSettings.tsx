/**
 * AiAssistantSettings — /admin/settings/ai
 *
 * Admin panel to configure the AI Assistant provider + API key + model + toggle,
 * with a "Test connection" button. The raw key is write-only: the server returns
 * a masked hint, never the full key. Backed by /assistant/config (migration 316).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sparkles, ShieldAlert, Loader2, Check, Plug, KeyRound } from 'lucide-react'
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
  providers: ProviderOpt[]; updated_at: string | null
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

  const [provider, setProvider] = useState<string | null>(null)
  const [model,    setModel]    = useState<string | null>(null)
  const [enabled,  setEnabled]  = useState<boolean | null>(null)
  const [apiKey,   setApiKey]   = useState('')   // blank = keep existing

  // Effective values (local override falls back to server)
  const eProvider = provider ?? cfg?.provider ?? 'groq'
  const eEnabled  = enabled  ?? cfg?.enabled  ?? true
  const eModel    = model    ?? cfg?.model    ?? ''
  const providers = cfg?.providers ?? []
  const curProvMeta = providers.find(p => p.id === eProvider)

  const save = useMutation({
    mutationFn: () => api.put('/assistant/config', {
      provider: eProvider,
      model:    eModel.trim() ? eModel.trim() : null,
      enabled:  eEnabled,
      ...(apiKey ? { api_key: apiKey } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant-config'] })
      qc.invalidateQueries({ queryKey: ['assistant-status'] })
      setApiKey('')
      toast.success('AI settings saved')
    },
    onError: (e: Error) => toast.error('Could not save', { description: e.message }),
  })

  const test = useMutation({
    mutationFn: () => api.post<{ data: { ok: boolean; message: string } }>('/assistant/config/test', {
      provider: eProvider,
      model:    eModel.trim() ? eModel.trim() : null,
      ...(apiKey ? { api_key: apiKey } : {}),
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
          data they're already allowed to see. <span className="font-medium">Groq</span> has a generous free tier —
          create a key at <span className="font-medium">console.groq.com</span>, paste it below, and Test.
        </p>
      </div>

      {isLoading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div></SectionCard>
      ) : (
        <SectionCard title="Provider & key" icon={<Plug className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-4 max-w-xl">
            {/* Provider */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {providers.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setProvider(p.id); setModel('') }}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      eProvider === p.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Model <span className="text-muted-foreground/60">(blank = {curProvMeta?.default_model})</span></label>
              <Input value={eModel} onChange={e => setModel(e.target.value)} placeholder={curProvMeta?.default_model} className="h-9 text-sm" />
            </div>

            {/* API key */}
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

            {/* Enabled */}
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
              <input type="checkbox" checked={eEnabled} onChange={e => setEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              Assistant enabled for this organisation
            </label>

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Save
              </Button>
              <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
                Test connection
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </PageContainer>
  )
}
