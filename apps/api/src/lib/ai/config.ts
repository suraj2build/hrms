/**
 * config.ts — resolve the AI Assistant provider chain for a tenant.
 *
 * The admin panel stores an ordered list (providers_json): the assistant tries
 * each enabled entry top-to-bottom and uses the first that answers. When no
 * tenant chain is configured it falls back to env vars so an env-only deployment
 * still works. Raw API keys never leave the server — the config API returns only
 * masked hints.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssistantConfig, ProviderName } from './llm.js'
import { PROVIDER_META, isConfigUsable } from './llm.js'

function envProvider(): ProviderName {
  const raw = (process.env['ASSISTANT_PROVIDER'] ?? process.env['AI_PROVIDER'] ?? 'groq').toLowerCase()
  return (raw in PROVIDER_META) ? (raw as ProviderName) : 'groq'
}

function envKeyFor(p: ProviderName): string | null {
  const map: Record<ProviderName, string> = { groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' }
  return process.env[map[p]] ?? null
}

function envModelFor(p: ProviderName): string | null {
  const map: Record<ProviderName, string> = { groq: 'GROQ_MODEL', openai: 'OPENAI_MODEL', gemini: 'GEMINI_MODEL' }
  return process.env[map[p]] ?? null
}

/** The env-derived config (fallback / default). */
export function envConfig(): AssistantConfig {
  const provider = envProvider()
  const apiKey   = envKeyFor(provider)
  return { provider, apiKey, model: envModelFor(provider), enabled: true, source: apiKey ? 'env' : 'none' }
}

export interface ChainEntry {
  provider: ProviderName
  api_key:  string | null
  model:    string | null
  enabled:  boolean
}

type DbRow = {
  provider: string; api_key: string | null; model: string | null; enabled: boolean
  fallback_provider?: string | null; fallback_api_key?: string | null; fallback_model?: string | null
  providers_json?: ChainEntry[] | null
}

/** Normalize a stored chain entry into an AssistantConfig. */
function toConfig(e: ChainEntry): AssistantConfig {
  const provider = (e.provider in PROVIDER_META ? e.provider : 'groq') as ProviderName
  return { provider, apiKey: e.api_key ?? null, model: e.model ?? null, enabled: e.enabled !== false, source: 'tenant' }
}

/** Build the legacy primary/fallback rows into a chain (for pre-319 rows). */
function legacyChain(row: DbRow): AssistantConfig[] {
  const out: AssistantConfig[] = []
  if (row.api_key) {
    const provider = (row.provider in PROVIDER_META ? row.provider : 'groq') as ProviderName
    out.push({ provider, apiKey: row.api_key, model: row.model, enabled: row.enabled, source: 'tenant' })
  }
  if (row.fallback_provider && row.fallback_api_key) {
    const fp = (row.fallback_provider in PROVIDER_META ? row.fallback_provider : 'groq') as ProviderName
    out.push({ provider: fp, apiKey: row.fallback_api_key, model: row.fallback_model ?? null, enabled: true, source: 'tenant' })
  }
  return out
}

/**
 * Resolve the ordered, usable provider chain for a tenant.
 * providers_json first, else legacy primary/fallback, else env. Only enabled
 * entries with a key are returned, in priority order.
 */
export async function resolveAssistantChain(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AssistantConfig[]> {
  const { data } = await supabase
    .from('ai_assistant_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const row = data as DbRow | null

  let chain: AssistantConfig[] = []
  if (row?.providers_json && Array.isArray(row.providers_json) && row.providers_json.length > 0) {
    chain = row.providers_json.map(toConfig)
  } else if (row) {
    chain = legacyChain(row)
  }

  // Keep only enabled entries that actually have a key.
  chain = chain.filter(isConfigUsable)

  // No usable tenant entries → env fallback.
  if (chain.length === 0) {
    const env = envConfig()
    if (env.apiKey) chain = [env]
  }
  return chain
}

export interface ResolvedConfigs {
  primary:  AssistantConfig
  fallback: AssistantConfig | null
  chain:    AssistantConfig[]
}

/** Back-compat shim: primary = first in chain, fallback = second. */
export async function resolveAssistantConfigs(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ResolvedConfigs> {
  const chain = await resolveAssistantChain(supabase, tenantId)
  const primary = chain[0] ?? envConfig()
  return { primary, fallback: chain[1] ?? null, chain }
}

/** Primary-only resolver (status endpoint). */
export async function resolveAssistantConfig(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AssistantConfig> {
  return (await resolveAssistantConfigs(supabase, tenantId)).primary
}

/** Mask a key for display: keep a short prefix + last 4, hide the middle. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 10) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
