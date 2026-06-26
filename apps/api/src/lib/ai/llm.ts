/**
 * llm.ts — provider-agnostic chat-completion client for the AI Assistant.
 *
 * Groq, OpenAI and Gemini all expose an OpenAI-COMPATIBLE chat endpoint, so a
 * single OpenAI SDK instance with a swapped baseURL + key covers all three.
 *
 * Config is resolved per-tenant from the DB (admin AI settings panel) and falls
 * back to env vars — see config.ts. This module is config-object driven: it never
 * reads env directly, so the same code serves a DB-configured tenant and an
 * env-only deployment. Keys are server-side only — never sent to the browser.
 */
import OpenAI from 'openai'

export type ProviderName = 'groq' | 'openai' | 'gemini'

interface ProviderMeta {
  label:        string
  baseURL:      string | undefined
  defaultModel: string
}

export const PROVIDER_META: Record<ProviderName, ProviderMeta> = {
  groq:   { label: 'Groq (Llama)',  baseURL: 'https://api.groq.com/openai/v1',                          defaultModel: 'llama-3.3-70b-versatile' },
  openai: { label: 'OpenAI',        baseURL: undefined,                                                 defaultModel: 'gpt-4o-mini' },
  gemini: { label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash' },
}

export interface AssistantConfig {
  provider: ProviderName
  apiKey:   string | null
  model:    string | null   // null → provider default
  enabled:  boolean
  source:   'tenant' | 'env' | 'none'
}

/** Usable = enabled and has a key. Gate the assistant on this. */
export function isConfigUsable(c: AssistantConfig): boolean {
  return c.enabled && !!c.apiKey
}

export function effectiveModel(c: AssistantConfig): string {
  return c.model || PROVIDER_META[c.provider].defaultModel
}

// ── Minimal chat types (OpenAI-compatible shapes we use) ─────────────────────────
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

export interface ToolCall {
  id:   string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatResult {
  content:   string | null
  toolCalls: ToolCall[]
}

export class AssistantNotConfiguredError extends Error {
  constructor() { super('AI assistant is not configured'); this.name = 'AssistantNotConfiguredError' }
}

/**
 * One chat-completion round. Returns the assistant message (text and/or tool calls).
 * Throws AssistantNotConfiguredError when the config has no key.
 */
export async function chatComplete(config: AssistantConfig, opts: {
  messages:     ChatMessage[]
  tools?:       ToolDef[]
  temperature?: number
  maxTokens?:   number
}): Promise<ChatResult> {
  if (!config.apiKey) throw new AssistantNotConfiguredError()
  const meta = PROVIDER_META[config.provider]

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: meta.baseURL })

  const resp = await client.chat.completions.create({
    model:       effectiveModel(config),
    messages:    opts.messages as any,
    tools:       opts.tools as any,
    tool_choice: opts.tools && opts.tools.length ? 'auto' : undefined,
    temperature: opts.temperature ?? 0.3,
    max_tokens:  opts.maxTokens ?? 700,
  })

  const choice = resp.choices?.[0]?.message
  return {
    content:   choice?.content ?? null,
    toolCalls: (choice?.tool_calls as ToolCall[] | undefined)?.filter(t => t.type === 'function') ?? [],
  }
}

/** Lightweight reachability check for the "Test connection" button. */
export async function testConnection(config: AssistantConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await chatComplete(config, {
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      maxTokens: 5,
      temperature: 0,
    })
    return { ok: true, message: `Connected — ${config.provider}:${effectiveModel(config)} replied "${(r.content ?? '').trim().slice(0, 20)}"` }
  } catch (e: any) {
    const status = e?.status as number | undefined
    // Try to extract a human-readable message from the SDK error or the raw response body.
    // Gemini wraps errors in { error: { message } } which OpenAI SDK may not parse.
    const rawMsg: string = e?.message || e?.error?.message || e?.error?.error?.message || ''
    const msg = status === 401 ? 'Invalid API key — check the key is correct and active'
      : status === 403 ? 'Forbidden — API key may not have access to this model or the API is not enabled'
      : status === 404 ? `Model not found — '${effectiveModel(config)}' may not be available on ${config.provider}'s endpoint`
      : status === 429 ? 'Rate limited / quota exceeded'
      : rawMsg || `Connection failed (HTTP ${status ?? 'network error'})`
    return { ok: false, message: msg }
  }
}
