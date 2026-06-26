/**
 * Assistant routes — the AI chat endpoint + the admin config panel API.
 *
 *   POST /assistant/chat            — role-scoped chat (context-injection + read-tools)
 *   GET  /assistant/status          — is the assistant usable for this tenant?
 *   GET  /assistant/config          — admin: current config (key masked)
 *   PUT  /assistant/config          — admin: set provider/key/model/enabled
 *   POST /assistant/config/test     — admin: test connection
 *
 * The LLM provider key is read server-side only (DB row or env) and never returned
 * to the browser. Chat is rate-limited per the global limiter + a tighter per-route cap.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  chatComplete, testConnection, AssistantNotConfiguredError,
  isConfigUsable, effectiveModel, PROVIDER_META,
  type ChatMessage, type ToolCall,
} from '../../lib/ai/llm.js'
import { resolveAssistantConfig, envConfig, maskKey } from '../../lib/ai/config.js'
import { buildAssistantContext } from '../../lib/ai/assistant-context.js'
import { ASSISTANT_TOOLS, executeTool } from '../../lib/ai/assistant-tools.js'

const HR_ROLES = ['super_admin', 'hr_admin']

const SYSTEM_BASE =
  'You are the CognixHR Assistant, a helpful in-app assistant for an HR/payroll system. ' +
  'Answer concisely and professionally. Only use the data provided in the context or returned by tools — ' +
  'never invent leave balances, salaries, names, or policies. If you do not have the data, say so and suggest where in the app to find it. ' +
  'You cannot perform actions (applying leave, approving) — you are read-only; guide the user to the right screen instead. ' +
  'Keep answers short (1–4 sentences) unless asked for detail.'

export default async function assistantRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAuth = {
    preHandler: [fastify.authenticate, async (req: any, reply: any) => {
      if (!HR_ROLES.includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      }
    }],
  }

  // ── GET /assistant/status ───────────────────────────────────────────────────
  fastify.get('/assistant/status', auth, async (req: any, reply) => {
    const cfg = await resolveAssistantConfig(fastify.supabase, req.tenantId)
    return reply.send({ data: { enabled: isConfigUsable(cfg), provider: cfg.provider, model: effectiveModel(cfg) } })
  })

  // ── POST /assistant/chat ─────────────────────────────────────────────────────
  fastify.post('/assistant/chat', {
    ...auth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req: any, reply) => {
    const schema = z.object({
      message: z.string().min(1).max(2000),
      history: z.array(z.object({
        role:    z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      })).max(12).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const cfg = await resolveAssistantConfig(fastify.supabase, req.tenantId)
    if (!isConfigUsable(cfg)) {
      return reply.code(200).send({ data: { reply: null, not_configured: true } })
    }

    const caller = { userId: req.userId, tenantId: req.tenantId, userRole: req.userRole }
    const { context, employeeId, isManagerOrHr } = await buildAssistantContext(fastify.supabase, caller)

    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_BASE}\n\nContext:\n${context}` },
      ...((parsed.data.history ?? []).map(h => ({ role: h.role, content: h.content })) as ChatMessage[]),
      { role: 'user', content: parsed.data.message },
    ]

    // Only managers/HR get the cross-record tools; employees stay context-only.
    const tools = isManagerOrHr ? ASSISTANT_TOOLS : undefined
    const toolCtx = { supabase: fastify.supabase, caller, employeeId }
    const toolsUsed: string[] = []

    try {
      // Tool loop — bounded to avoid runaway.
      for (let hop = 0; hop < 4; hop++) {
        const res = await chatComplete(cfg, { messages, tools, maxTokens: 700 })

        if (res.toolCalls.length === 0) {
          return reply.send({ data: { reply: res.content ?? '…', tools_used: toolsUsed, model: effectiveModel(cfg) } })
        }

        // Record the assistant's tool-call turn, then execute each and append results.
        messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls })
        for (const call of res.toolCalls as ToolCall[]) {
          let args: any = {}
          try { args = JSON.parse(call.function.arguments || '{}') } catch { /* leave empty */ }
          toolsUsed.push(call.function.name)
          const result = await executeTool(toolCtx, call.function.name, args)
          messages.push({ role: 'tool', content: result, tool_call_id: call.id })
        }
      }
      // Hit the hop cap — make one final no-tools call for a summary.
      const final = await chatComplete(cfg, { messages, maxTokens: 500 })
      return reply.send({ data: { reply: final.content ?? '…', tools_used: toolsUsed, model: effectiveModel(cfg) } })
    } catch (e: any) {
      if (e instanceof AssistantNotConfiguredError) {
        return reply.code(200).send({ data: { reply: null, not_configured: true } })
      }
      req.log.warn({ err: e?.message, status: e?.status }, 'assistant chat failed')
      const msg = e?.status === 429 ? 'The assistant is busy (rate limited). Please try again in a moment.'
        : e?.status === 401 ? 'The assistant is misconfigured (invalid API key). Ask an admin to check AI settings.'
        : 'Sorry — I could not answer that just now. Please try again.'
      return reply.code(200).send({ data: { reply: msg, error: true } })
    }
  })

  // ── GET /assistant/config (admin) ─────────────────────────────────────────────
  fastify.get('/assistant/config', hrAuth, async (req: any, reply) => {
    const { data: row } = await fastify.supabase
      .from('ai_assistant_config')
      .select('provider, api_key, model, enabled, updated_at')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    const env = envConfig()
    const r = row as any
    return reply.send({
      data: {
        provider:   r?.provider ?? env.provider,
        model:      r?.model ?? null,
        enabled:    r?.enabled ?? true,
        has_key:    !!r?.api_key,
        key_hint:   maskKey(r?.api_key),
        source:     r?.api_key ? 'tenant' : (env.apiKey ? 'env' : 'none'),
        env_fallback: !!env.apiKey,
        providers:  Object.entries(PROVIDER_META).map(([id, m]) => ({ id, label: m.label, default_model: m.defaultModel })),
        updated_at: r?.updated_at ?? null,
      },
    })
  })

  // ── PUT /assistant/config (admin) ─────────────────────────────────────────────
  fastify.put('/assistant/config', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      provider: z.enum(['groq', 'openai', 'gemini']),
      model:    z.string().max(100).nullable().optional(),
      enabled:  z.boolean(),
      // Omit api_key to keep the existing one; '' explicitly clears it.
      api_key:  z.string().max(300).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { provider, model, enabled, api_key } = parsed.data

    const patch: Record<string, unknown> = {
      tenant_id: req.tenantId, provider, model: model ?? null, enabled,
      updated_by: req.userId, updated_at: new Date().toISOString(),
    }
    if (api_key !== undefined) patch.api_key = api_key === '' ? null : api_key

    const { error } = await fastify.supabase
      .from('ai_assistant_config')
      .upsert(patch, { onConflict: 'tenant_id' })
    if (error) return reply.code(500).send({ error: 'SAVE_FAILED', message: error.message })
    return reply.send({ data: { ok: true } })
  })

  // ── POST /assistant/config/test (admin) ───────────────────────────────────────
  // Tests the provided key (if any) else the saved/env config — without persisting.
  fastify.post('/assistant/config/test', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      provider: z.enum(['groq', 'openai', 'gemini']).optional(),
      model:    z.string().max(100).nullable().optional(),
      api_key:  z.string().max(300).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let cfg = await resolveAssistantConfig(fastify.supabase, req.tenantId)
    if (parsed.data.provider) cfg = { ...cfg, provider: parsed.data.provider }
    if (parsed.data.model !== undefined) cfg = { ...cfg, model: parsed.data.model }
    if (parsed.data.api_key) cfg = { ...cfg, apiKey: parsed.data.api_key }   // test an unsaved key

    if (!cfg.apiKey) return reply.send({ data: { ok: false, message: 'No API key to test — enter one first.' } })
    const result = await testConnection({ ...cfg, enabled: true })
    if (!result.ok) req.log.warn({ provider: cfg.provider, model: cfg.model, message: result.message }, 'assistant connection test failed')
    return reply.send({ data: result })
  })
}
