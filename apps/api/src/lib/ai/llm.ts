/**
 * llm.ts — provider-agnostic chat-completion client for the AI Assistant.
 *
 * Groq + OpenAI use the OpenAI SDK (compatible API).
 * Gemini uses the native @google/generative-ai SDK — same as the onboarding
 * extraction engine — because the OpenAI-compatibility shim for Gemini
 * does not reliably support gemini-2.0-flash and returns 404 for it.
 *
 * Config is resolved per-tenant from the DB (admin AI settings panel) and falls
 * back to env vars — see config.ts. Keys are server-side only — never sent to
 * the browser.
 */
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

export type ProviderName = 'groq' | 'openai' | 'gemini'

interface ProviderMeta {
  label:        string
  baseURL:      string | undefined   // undefined = OpenAI default
  defaultModel: string
}

export const PROVIDER_META: Record<ProviderName, ProviderMeta> = {
  groq:   { label: 'Groq (Llama)',  baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  openai: { label: 'OpenAI',        baseURL: undefined,                         defaultModel: 'gpt-4o-mini' },
  gemini: { label: 'Google Gemini', baseURL: undefined,                         defaultModel: 'gemini-2.0-flash' },
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

// ── Chat message types (OpenAI-compatible shapes used throughout) ─────────────
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

// ── Gemini native implementation ───────────────────────────────────────────────

async function chatCompleteGemini(
  config: AssistantConfig,
  opts: { messages: ChatMessage[]; tools?: ToolDef[]; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const genAI = new GoogleGenerativeAI(config.apiKey!)

  // Extract system instruction separately (Gemini handles it outside the message history)
  const sysMsg = opts.messages.find(m => m.role === 'system')
  const convMsgs = opts.messages.filter(m => m.role !== 'system')

  // Build tool_call_id → function name map so we can name function responses
  const callIdToName = new Map<string, string>()
  for (const m of convMsgs) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) callIdToName.set(tc.id, tc.function.name)
    }
  }

  // Convert OpenAI-style messages to Gemini Contents
  const contents: any[] = []
  for (const msg of convMsgs) {
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] })
    } else if (msg.role === 'assistant') {
      const parts: any[] = []
      if (msg.content) parts.push({ text: msg.content })
      for (const tc of msg.tool_calls ?? []) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* noop */ }
        parts.push({ functionCall: { name: tc.function.name, args } })
      }
      if (parts.length) contents.push({ role: 'model', parts })
    } else if (msg.role === 'tool') {
      const fnName = callIdToName.get(msg.tool_call_id) ?? 'unknown'
      let responseData: unknown = msg.content
      try { responseData = JSON.parse(msg.content) } catch { /* keep raw string */ }
      contents.push({ role: 'user', parts: [{ functionResponse: { name: fnName, response: { result: responseData } } }] })
    }
  }

  // Convert OpenAI tool definitions to Gemini function declarations
  const geminiTools = opts.tools?.length ? [{
    functionDeclarations: opts.tools.map(t => ({
      name:        t.function.name,
      description: t.function.description,
      parameters:  t.function.parameters as any,
    })),
  }] as any : undefined

  const genModel = genAI.getGenerativeModel({
    model: effectiveModel(config),
    ...(sysMsg ? { systemInstruction: { role: 'system', parts: [{ text: sysMsg.content as string }] } } : {}),
    ...(geminiTools ? { tools: geminiTools } : {}),
    generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxTokens ?? 700 },
  })

  const result = await genModel.generateContent({ contents })
  const candidate = result.response.candidates?.[0]

  let textContent: string | null = null
  const toolCalls: ToolCall[] = []

  for (const part of candidate?.content?.parts ?? []) {
    if ('text' in part && part.text) textContent = (textContent ?? '') + part.text
    if ('functionCall' in part && part.functionCall) {
      toolCalls.push({
        id:   `fc-${part.functionCall.name}-${Date.now()}`,
        type: 'function',
        function: {
          name:      part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      })
    }
  }

  return { content: textContent, toolCalls }
}

// ── OpenAI-SDK implementation (Groq + OpenAI) ─────────────────────────────────

async function chatCompleteOpenAI(
  config: AssistantConfig,
  opts: { messages: ChatMessage[]; tools?: ToolDef[]; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const meta   = PROVIDER_META[config.provider]
  const client = new OpenAI({ apiKey: config.apiKey!, baseURL: meta.baseURL })

  const resp = await client.chat.completions.create({
    model:       effectiveModel(config),
    messages:    opts.messages as any,
    tools:       opts.tools as any,
    tool_choice: opts.tools?.length ? 'auto' : undefined,
    temperature: opts.temperature ?? 0.3,
    max_tokens:  opts.maxTokens ?? 700,
  })

  const choice = resp.choices?.[0]?.message
  return {
    content:   choice?.content ?? null,
    toolCalls: (choice?.tool_calls as ToolCall[] | undefined)?.filter(t => t.type === 'function') ?? [],
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * One chat-completion round. Returns the assistant message (text and/or tool calls).
 * Throws AssistantNotConfiguredError when the config has no key.
 */
export async function chatComplete(
  config: AssistantConfig,
  opts: { messages: ChatMessage[]; tools?: ToolDef[]; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  if (!config.apiKey) throw new AssistantNotConfiguredError()
  return config.provider === 'gemini'
    ? chatCompleteGemini(config, opts)
    : chatCompleteOpenAI(config, opts)
}

/** Lightweight reachability check for the "Test connection" button. */
export async function testConnection(config: AssistantConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await chatComplete(config, {
      messages:  [{ role: 'user', content: 'Reply with the single word: ok' }],
      maxTokens: 5,
      temperature: 0,
    })
    return { ok: true, message: `Connected — ${config.provider}:${effectiveModel(config)} replied "${(r.content ?? '').trim().slice(0, 20)}"` }
  } catch (e: any) {
    const status = e?.status as number | undefined
    const rawMsg: string = e?.message || e?.errorDetails?.[0]?.reason || ''
    const msg = status === 401 ? 'Invalid API key — check the key is correct and active'
      : status === 403 ? 'Forbidden — API key may not have access to this model or the Gemini API is not enabled'
      : status === 404 ? `Model not found — '${effectiveModel(config)}' may not be available for ${config.provider}`
      : status === 429 ? 'Rate limited / quota exceeded'
      : rawMsg || `Connection failed (HTTP ${status ?? 'network error'})`
    return { ok: false, message: msg }
  }
}
