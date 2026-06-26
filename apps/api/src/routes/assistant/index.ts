/**
 * Assistant routes — the AI chat endpoint + the admin config panel API.
 *
 *   POST /assistant/chat            — role-scoped chat (context-injection + read-tools)
 *   GET  /assistant/status          — is the assistant usable for this tenant?
 *   GET  /assistant/config          — admin: the provider chain (keys masked)
 *   PUT  /assistant/config          — admin: save the ordered provider chain
 *   POST /assistant/config/test     — admin: test one provider+key
 *
 * Providers are configured as an ordered chain: the assistant tries each enabled
 * entry top-to-bottom and uses the first that answers; the rest are automatic
 * fallbacks. Keys are read server-side only (DB or env) and never returned to the
 * browser — only a masked hint. Chat is rate-limited.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  chatCompleteWithFallback, testConnection,
  AssistantNotConfiguredError, isConfigUsable, effectiveModel, PROVIDER_META,
  sanitizeApiKey, invalidKeyChar,
  type ChatMessage, type ToolCall, type AssistantConfig,
} from '../../lib/ai/llm.js'
import { resolveAssistantConfig, resolveAssistantChain, maskKey } from '../../lib/ai/config.js'
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

    // Ordered provider chain — tried top-to-bottom with automatic fallback.
    const cfgList = await resolveAssistantChain(fastify.supabase, req.tenantId)
    if (cfgList.length === 0) {
      return reply.code(200).send({ data: { reply: null, not_configured: true } })
    }

    const caller = { userId: req.userId, tenantId: req.tenantId, userRole: req.userRole }
    const { context, employeeId, isManagerOrHr } = await buildAssistantContext(fastify.supabase, caller)

    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_BASE}\n\nContext:\n${context}` },
      ...((parsed.data.history ?? []).map(h => ({ role: h.role, content: h.content })) as ChatMessage[]),
      { role: 'user', content: parsed.data.message },
    ]

    const tools = isManagerOrHr ? ASSISTANT_TOOLS : undefined
    const toolCtx = { supabase: fastify.supabase, caller, employeeId }
    const toolsUsed: string[] = []

    try {
      // Track the active config across the tool loop — may switch to a fallback mid-session.
      let activeConfig = cfgList[0]!
      let usedFallback = false

      // Tool loop — bounded to avoid runaway.
      for (let hop = 0; hop < 4; hop++) {
        const { content: res, usedConfig, fellBack } = await chatCompleteWithFallback(
          hop === 0 ? cfgList : [activeConfig],
          { messages, tools, maxTokens: 700 },
          (from, reason) => req.log.warn({ from: from.provider, reason }, 'assistant provider failed, trying next in chain'),
        )
        if (fellBack) { activeConfig = usedConfig; usedFallback = true }

        if (res.toolCalls.length === 0) {
          return reply.send({
            data: {
              reply:      res.content ?? '…',
              tools_used: toolsUsed,
              model:      effectiveModel(activeConfig),
              provider:   activeConfig.provider,
              fell_back:  usedFallback,
            },
          })
        }

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
      const { content: final, usedConfig } = await chatCompleteWithFallback([activeConfig], { messages, maxTokens: 500 })
      return reply.send({
        data: {
          reply:      final.content ?? '…',
          tools_used: toolsUsed,
          model:      effectiveModel(usedConfig),
          provider:   usedConfig.provider,
          fell_back:  usedFallback,
        },
      })
    } catch (e: any) {
      if (e instanceof AssistantNotConfiguredError) {
        return reply.code(200).send({ data: { reply: null, not_configured: true } })
      }
      req.log.warn({
        err: e?.message, status: e?.status,
        tried: cfgList.map(c => `${c.provider}:${effectiveModel(c)}`),
      }, 'assistant chat failed')
      const triedDesc = cfgList.map(c => `${c.provider} (${effectiveModel(c)})`).join(' → ')
      // Pull the most useful detail out of the (last) provider error so the reason
      // is actually diagnosable instead of a generic "try again".
      const detail: string = e?.message || e?.errorDetails?.[0]?.reason || ''
      const msg = e?.status === 429 ? 'The assistant is busy (rate limited). Please try again in a moment.'
        : e?.status === 401 ? `The assistant is misconfigured — ${triedDesc} rejected the API key. Ask an admin to re-check the keys in AI settings.`
        : e?.status === 404 ? `The configured model wasn't found (tried ${triedDesc}). Ask an admin to check the model name in AI settings.${detail ? ` Details: ${detail.slice(0, 160)}` : ''}`
        : `Sorry — I couldn't answer that just now (tried ${triedDesc}).${detail ? ` Reason: ${detail.slice(0, 200)}` : ''}`
      return reply.code(200).send({ data: { reply: msg, error: true } })
    }
  })

  // ── GET /assistant/config (admin) ─────────────────────────────────────────────
  fastify.get('/assistant/config', hrAuth, async (req: any, reply) => {
    const { data: row } = await fastify.supabase
      .from('ai_assistant_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    const r = row as any

    // Stored chain (masked). Fall back to legacy primary/fallback columns if the
    // chain column is empty (pre-319 rows) so existing keys still show.
    let chain: Array<{ provider: string; model: string | null; enabled: boolean; api_key: string | null }> = []
    if (Array.isArray(r?.providers_json) && r.providers_json.length > 0) {
      chain = r.providers_json
    } else if (r?.api_key) {
      chain = [{ provider: r.provider, model: r.model, enabled: r.enabled ?? true, api_key: r.api_key }]
      if (r.fallback_provider && r.fallback_api_key) {
        chain.push({ provider: r.fallback_provider, model: r.fallback_model, enabled: true, api_key: r.fallback_api_key })
      }
    }

    // What the chat path actually resolves to (ground truth — shows env-shadowing).
    const active = await resolveAssistantChain(fastify.supabase, req.tenantId)

    return reply.send({
      data: {
        chain: chain.map(e => ({
          provider: e.provider,
          model:    e.model ?? null,
          enabled:  e.enabled !== false,
          has_key:  !!e.api_key,
          key_hint: maskKey(e.api_key),
        })),
        active: active.length
          ? { provider: active[0]!.provider, model: effectiveModel(active[0]!), source: active[0]!.source, count: active.length }
          : null,
        providers:  Object.entries(PROVIDER_META).map(([id, m]) => ({ id, label: m.label, default_model: m.defaultModel })),
        updated_at: r?.updated_at ?? null,
      },
    })
  })

  // ── PUT /assistant/config (admin) ─────────────────────────────────────────────
  // Saves the whole ordered chain. Within an entry, omit api_key to keep the saved
  // one; send '' to clear it. Keys must be ASCII (HTTP-header safe).
  fastify.put('/assistant/config', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      chain: z.array(z.object({
        provider: z.enum(['groq', 'openai', 'gemini']),
        model:    z.string().max(100).nullable().optional(),
        enabled:  z.boolean().optional(),
        api_key:  z.string().max(300).optional(),  // omit = keep existing; '' = clear
      })).max(3),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Load existing keys so an omitted api_key preserves the saved value (per provider).
    const { data: existing } = await fastify.supabase
      .from('ai_assistant_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    const ex = existing as any
    const savedKey = new Map<string, string>()
    if (Array.isArray(ex?.providers_json)) {
      for (const e of ex.providers_json) if (e?.provider && e?.api_key) savedKey.set(e.provider, e.api_key)
    } else if (ex?.api_key) {
      savedKey.set(ex.provider, ex.api_key)
      if (ex.fallback_provider && ex.fallback_api_key) savedKey.set(ex.fallback_provider, ex.fallback_api_key)
    }

    const providers_json: Array<{ provider: string; api_key: string | null; model: string | null; enabled: boolean }> = []
    for (const e of parsed.data.chain) {
      let key: string | null
      if (e.api_key === undefined) key = savedKey.get(e.provider) ?? null   // keep existing
      else if (e.api_key === '')   key = null                               // clear
      else                          key = sanitizeApiKey(e.api_key)         // new

      if (key) {
        const bad = invalidKeyChar(key)
        if (bad) return reply.code(400).send({
          error: 'INVALID_KEY',
          message: `${e.provider} key contains an invalid character "${bad}" — re-copy the key (a hyphen "-" may have been auto-corrected to a dash "—").`,
        })
      }
      providers_json.push({ provider: e.provider, api_key: key, model: e.model ?? null, enabled: e.enabled !== false })
    }

    // Keep the legacy primary columns in sync with chain[0] so older readers and
    // the NOT NULL provider column stay valid.
    const head = providers_json[0]
    const patch: Record<string, unknown> = {
      tenant_id:  req.tenantId,
      providers_json,
      provider:   head?.provider ?? 'groq',
      api_key:    head?.api_key ?? null,
      model:      head?.model ?? null,
      enabled:    head ? head.enabled : true,
      updated_by: req.userId,
      updated_at: new Date().toISOString(),
    }

    let { error } = await fastify.supabase
      .from('ai_assistant_config')
      .upsert(patch, { onConflict: 'tenant_id' })

    const isSchemaErr = (e: any) =>
      e?.message?.includes('schema cache') || e?.message?.includes('Could not find')

    // Level 2: providers_json not in PostgREST cache — try with fallback_* columns (migration 318).
    if (error && isSchemaErr(error)) {
      const { providers_json: _pj, ...patch2 } = patch as any
      const second = providers_json[1]
      patch2.fallback_provider = second?.provider ?? null
      patch2.fallback_api_key  = second?.api_key  ?? null
      patch2.fallback_model    = second?.model    ?? null
      ;({ error } = await fastify.supabase
        .from('ai_assistant_config')
        .upsert(patch2, { onConflict: 'tenant_id' }))
    }

    // Level 3: fallback_* also not in cache (cache predates migration 318) — write only original columns.
    if (error && isSchemaErr(error)) {
      const {
        providers_json: _pj, fallback_provider: _fp, fallback_api_key: _fk, fallback_model: _fm,
        ...minPatch
      } = patch as any
      ;({ error } = await fastify.supabase
        .from('ai_assistant_config')
        .upsert(minPatch, { onConflict: 'tenant_id' }))
    }

    if (error) return reply.code(500).send({ error: 'SAVE_FAILED', message: error.message })
    return reply.send({ data: { ok: true } })
  })

  // ── POST /assistant/config/test (admin) ───────────────────────────────────────
  // Tests one provider+model+key. If api_key is omitted, uses the saved key for
  // that provider (resolved from the chain).
  fastify.post('/assistant/config/test', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      provider: z.enum(['groq', 'openai', 'gemini']),
      model:    z.string().max(100).nullable().optional(),
      api_key:  z.string().max(300).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let apiKey = sanitizeApiKey(parsed.data.api_key)
    if (!apiKey) {
      // No key typed — fall back to the saved key for this provider.
      const chain = await resolveAssistantChain(fastify.supabase, req.tenantId)
      apiKey = chain.find(c => c.provider === parsed.data.provider)?.apiKey ?? null
    }
    if (!apiKey) return reply.send({ data: { ok: false, message: 'No API key to test — enter one first.' } })

    const cfg: AssistantConfig = {
      provider: parsed.data.provider,
      apiKey,
      model:    parsed.data.model ?? null,
      enabled:  true,
      source:   'tenant',
    }
    const result = await testConnection(cfg)
    if (!result.ok) req.log.warn({ provider: cfg.provider, model: cfg.model, message: result.message }, 'assistant connection test failed')
    return reply.send({ data: result })
  })
}
