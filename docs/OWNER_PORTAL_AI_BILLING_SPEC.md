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

## 1b. Integration path — call the HRMS owner API (NOT direct DB)

The owner portal must **not** read these tables directly from the browser —
master API keys would leak into the client. Instead it calls the HRMS owner API
(`apps/api/src/routes/owner/`, platform-admin JWT, service-role server-side).
**These endpoints are already built in the HRMS repo.** The owner portal builds
only the frontend that calls them. All require the platform-admin auth header.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET  /owner/ai-config` | Read master chain | keys masked (`key_hint`), never raw |
| `PUT  /owner/ai-config` | Replace master chain | `{ chain: [{provider, model?, enabled?, api_key?}] }`; omit `api_key` to keep, `''` to clear; ASCII-validated |
| `PATCH /owner/tenants/:id/ai-mode` | Flip a tenant | `{ ai_mode: 'self' | 'managed' }` |
| `GET  /owner/ai-usage?days=30&tenant_id=` | Priced usage | aggregates `ai_usage_log` × `ai_price_table`; per-tenant `managed_cost` / `total_cost` |
| `GET  /owner/ai-pricing` | Read price table | rows of `{provider, model, prompt_per_mtok, completion_per_mtok, currency}` |
| `PUT  /owner/ai-pricing` | Upsert prices | `{ rows: [...] }`; `model = '*'` is the provider fallback rate |

### 1c. Exact response envelopes (confirmed against the built handlers)

```jsonc
// GET /owner/ai-config
{ "data": { "chain": [ { "provider":"groq", "model":"…|null", "enabled":true,
                         "has_key":true, "key_hint":"gsk_••••AB12" } ],
            "updated_at":"…|null" } }

// GET /owner/ai-usage?days=30&tenant_id=…
{ "data": { "days":30, "currency":"USD",
            "tenants":[ { "tenant_id":"…", "tenant_name":"Acme Pvt Ltd",
                          "calls":12, "prompt":3400, "completion":900,
                          "total_tokens":4300, "managed_cost":0.0031, "total_cost":0.0031 } ],
            "totals":{ "calls":12, "total_tokens":4300,
                       "managed_cost":0.00, "total_cost":0.00 } } }

// GET /owner/ai-pricing
{ "data": { "rows":[ { "id":"…", "provider":"groq", "model":"llama-3.3-70b-versatile",
                       "prompt_per_mtok":0.59, "completion_per_mtok":0.79,
                       "currency":"USD", "updated_at":"…" } ] } }

// PUT /owner/ai-config | PUT /owner/ai-pricing | PATCH /owner/tenants/:id/ai-mode
// → { "data": { "ok": true, ... } }  (ai-mode returns { data: { id, ai_mode } })
```

## 2. What to build in the owner portal (frontend only)

### 2a. Master keys screen (Settings → AI)
- Form bound to `GET/PUT /owner/ai-config` — an ordered list of
  `{ provider, api_key, model, enabled }` with add / reorder / remove. You can copy
  the HRMS AI Settings UI (`apps/web/src/pages/settings/AiAssistantSettings.tsx`)
  almost verbatim — it already does masked hints, omit-to-keep, reorder.
- The API masks keys on read and validates ASCII on write; the frontend just
  shows `key_hint` and sends a new `api_key` only when the admin types one.

### 2b. Per-tenant mode toggle (on the existing tenant/license admin screen)
- A switch: **Self-managed (own keys)** ↔ **Managed (included in plan)**.
- Calls `PATCH /owner/tenants/:id/ai-mode` with `{ ai_mode }`. HRMS picks it up
  on the tenant's next chat call.

### 2c. Billing / cost dashboard
- Call `GET /owner/ai-usage?days=30` (optionally `&tenant_id=`). The API already
  joins `ai_usage_log` with `ai_price_table` and returns per-tenant
  `{ calls, total_tokens, managed_cost, total_cost }` plus grand totals.
  `managed_cost` = what you provisioned (`source='managed'`) — that's the billable
  figure; `total_cost` includes BYOK tenants for visibility.
- Render it as a table; no client-side pricing math needed.

### 2d. Price grid (Settings → AI → Pricing)
- Bind to `GET/PUT /owner/ai-pricing`. Rows are `{ provider, model,
  prompt_per_mtok, completion_per_mtok, currency }` (USD per 1M tokens).
- `model = '*'` is the per-provider fallback rate used when no exact model row
  matches. Migration 322 seeds defaults for groq/gemini/openai — edit them here.
- Editing is a row upsert (no deploy), shared across all owner admins.

### 2e. (Optional) tenant-facing usage — `GET /assistant/usage`
HRMS also exposes `GET /assistant/usage` (HR-auth, tenant-scoped) for in-app
cost visibility to the tenant admin. The owner portal uses `/owner/ai-usage`
instead (cross-tenant).

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
