/**
 * config.ts — resolve the AI Assistant config for a tenant.
 *
 * Precedence: the tenant's row in ai_assistant_config (set via the admin panel)
 * wins; if absent/keyless, fall back to env vars so an env-only deployment still
 * works. The raw API key never leaves the server — the config route returns only a
 * masked hint.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssistantConfig, ProviderName } from './llm.js'
import { PROVIDER_META } from './llm.js'

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

/**
 * Resolve the effective config for a tenant: DB row first, else env. A DB row that
 * is present but keyless falls through to env so a half-saved row never disables
 * an env-configured deployment.
 */
export async function resolveAssistantConfig(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AssistantConfig> {
  const { data } = await supabase
    .from('ai_assistant_config')
    .select('provider, api_key, model, enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const row = data as { provider: string; api_key: string | null; model: string | null; enabled: boolean } | null
  if (row && row.api_key) {
    const provider = (row.provider in PROVIDER_META ? row.provider : 'groq') as ProviderName
    return { provider, apiKey: row.api_key, model: row.model, enabled: row.enabled, source: 'tenant' }
  }
  // No usable tenant row → env fallback (but honour an explicit tenant 'disabled').
  const env = envConfig()
  if (row && row.enabled === false) return { ...env, enabled: false }
  return env
}

/** Mask a key for display: keep a short prefix + last 4, hide the middle. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null
  if (key.length <= 10) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
