# Owner Portal — AI Provisioning & Billing Spec

This is the build spec for the **`cognix-owner`** repo (the owner portal at
`license.cognix.com`). The **HRMS side is already built** — this document is the
contract it exposes. Build the owner portal against the shared Supabase DB tables
described here.

> **Architecture rule (unchanged):** the owner portal is the *control plane*
> (master keys, cross-tenant billing); HRMS is the *data plane* per tenant. They
> share **one Supabase database**. The owner portal **writes** provisioning;
> HRMS **reads** it and **writes** usage. Never put master keys in the
> tenant-facing HRMS app.

---

## 1. Shared DB tables (already created by HRMS migration `321`)

### `tenants.ai_mode`  *(owner WRITES, HRMS READS)*
```
ai_mode TEXT NOT NULL DEFAULT 'self'  CHECK (ai_mode IN ('self','managed'))
```
- `self`    — tenant brings their own API keys (HRMS AI Settings screen, default).
- `managed` — provider supplies the keys; HRMS uses the global master chain below.

Flipping a tenant to `managed` is a single `UPDATE tenants SET ai_mode='managed' WHERE id=$tenant`.
HRMS picks it up on the next chat call (read fresh, like `tenants.status`).

### `ai_managed_config`  *(owner WRITES, HRMS READS)*  — singleton, `id = 1`
```
id             INT  PRIMARY KEY DEFAULT 1 CHECK (id = 1)
providers_json JSONB NOT NULL DEFAULT '[]'   -- ordered provider chain
updated_by     UUID
updated_at     TIMESTAMPTZ
```
`providers_json` is an **ordered array** (same shape as a tenant's own chain). The
assistant tries entries top-to-bottom; the rest are automatic fallbacks:
```json
[
  { "provider": "groq",   "api_key": "gsk_...", "model": "llama-3.3-70b-versatile", "enabled": true },
  { "provider": "gemini", "api_key": "AIza...", "model": "gemini-3.5-flash",        "enabled": true }
]
```
- `provider` ∈ `groq` | `openai` | `gemini`.
- `model` may be `null` → provider default.
- Keys must be **ASCII** (they go in HTTP headers). Reject em-dash/smart-quote pastes.
- Upsert the singleton: `upsert({ id: 1, providers_json, updated_by, updated_at }, { onConflict: 'id' })`.
- After writing, run `NOTIFY pgrst, 'reload schema'` only if you added columns — not needed for plain row writes.

### `ai_usage_log`  *(HRMS WRITES, owner READS)*
```
id                UUID PK
tenant_id         UUID NOT NULL REFERENCES tenants(id)
provider          TEXT          -- 'groq' | 'openai' | 'gemini'
model             TEXT
prompt_tokens     INT
completion_tokens INT
total_tokens      INT
source            TEXT          -- 'managed' | 'tenant' | 'env'
user_id           UUID
created_at        TIMESTAMPTZ
```
HRMS inserts **one row per assistant message** (across the whole tool loop).
**Token counts only — no prices.** The owner portal applies pricing so rate
changes never touch HRMS. `source='managed'` rows are the ones you bill for
(those used your master keys); `source='tenant'` rows are BYOK (visibility only).

---

## 2. What to build in the owner portal

### 2a. Master keys screen (Settings → AI)
- Form to edit `ai_managed_config.providers_json` — an ordered list of
  `{ provider, api_key, model, enabled }` with add / reorder / remove (mirror the
  HRMS AI Settings UI; you can copy `apps/web/src/pages/settings/AiAssistantSettings.tsx`).
- A **Test** button per row is optional; if you want it, replicate HRMS's
  `testConnection` (a 1-token completion) or just call the provider directly.
- Validate keys are ASCII before saving (reuse the same hyphen-vs-em-dash check).

### 2b. Per-tenant mode toggle (on the existing tenant/license admin screen)
- A switch: **Self-managed (own keys)** ↔ **Managed (included in plan)**.
- Writes `tenants.ai_mode`. That's the whole integration on the provisioning side.

### 2c. Billing / cost dashboard
- Aggregate `ai_usage_log` per tenant per month. Example query:
  ```sql
  SELECT tenant_id,
         date_trunc('month', created_at) AS month,
         provider,
         SUM(prompt_tokens)     AS prompt_tokens,
         SUM(completion_tokens) AS completion_tokens,
         SUM(total_tokens)      AS total_tokens,
         COUNT(*)               AS calls
  FROM ai_usage_log
  WHERE source = 'managed'           -- only what you provisioned
  GROUP BY 1, 2, 3
  ORDER BY month DESC, total_tokens DESC;
  ```
- Apply your **price table** in the owner portal (per provider, per 1M tokens,
  split prompt/completion). Keep it as data you can edit without a deploy. Example:
  | provider | model | prompt $/1M | completion $/1M |
  |---|---|---|---|
  | groq | llama-3.3-70b-versatile | … | … |
  | gemini | gemini-3.5-flash | … | … |
  | openai | gpt-4o-mini | … | … |
- `cost = prompt_tokens/1e6 * prompt_price + completion_tokens/1e6 * completion_price`.

### 2d. (Optional) read HRMS's per-tenant summary endpoint
HRMS exposes `GET /assistant/usage` (HR-auth) returning month-to-date and
last-30-day token totals + per-provider breakdown for **one** tenant. The owner
portal generally won't need this (it can query the DB directly across all
tenants), but it exists for in-app tenant-facing cost visibility.

---

## 3. End-to-end flow once both sides are done

1. Owner sets master keys in `ai_managed_config` (once).
2. Owner flips a tenant to `ai_mode='managed'`.
3. That tenant's HRMS AI Settings now shows **"AI is included in your plan"**
   (read-only) instead of key inputs.
4. Every assistant chat for that tenant uses the master keys and writes an
   `ai_usage_log` row with `source='managed'`.
5. Owner billing dashboard sums those rows × price table → per-tenant invoice line.

---

## 4. Guardrails / gotchas

- **Don't** couple `ai_mode` to anything else — it's independent of `tenants.status`
  (licensing). A `managed` tenant that is `suspended` still can't write (the
  existing write-gate in `apps/api/src/plugins/auth.ts` applies), but reads/chat
  follow their own rules.
- **Don't** store prices in HRMS. Tokens in, pricing in the owner portal.
- **Master keys are sensitive.** They live only in `ai_managed_config` (service-role
  RLS) and are read by the HRMS API service-role client to make the calls. Never
  expose them to any browser — the HRMS config API already only returns masked hints.
- Keys must be ASCII. The HRMS PUT handler rejects non-ASCII; mirror that check.
