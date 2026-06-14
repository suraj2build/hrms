# R9 — Scheduled Intelligence Push: Audit

**Status:** Audit (AUDIT-FIRST — findings only, no code shipped)
**Phase:** R9 (Phase 5) of the Workforce Intelligence modernization roadmap
**Class:** AUDIT FIRST
**Scope question:** *What does it take to deliver intelligence (digests, narratives, alerts)
on a schedule, via push/email, safely across tenants — and what already exists?*

> Grounded in the live codebase. Every claim below cites a file. This audit precedes any
> build; it defines what is present, what is absent, and the safety posture.

---

## 0. Executive verdict

**The hard infrastructure already exists and is tenant-safe. The gap is the last-mile
delivery wiring.** Digests are computed but never sent; they render only when a user opens
the page. A scheduler, two job systems, an email sender, an in-app notification store, and
tenant-scoped recipient resolution are all in place and already used for other automations.

- **~60% of "scheduled push" is built** (scheduling rails, digest computation, email sender, in-app notifications, tenant scoping).
- **~40% is missing** (a job that *invokes* digests on a cadence, a digest email template, channel/frequency preferences).
- **Multi-tenant safety (the most important audit item): PASS.** No cross-tenant leak found in any scheduler.

---

## 1. Delivery Infrastructure — **EXISTS**

Two complementary job systems plus five active schedulers, all in-process.

| Component | File | Role |
|---|---|---|
| In-memory job queue | `apps/api/src/lib/job-queue.ts` | `setTimeout`-based priority queue, concurrency, retries, dead-letter. Lost on restart (non-critical work). |
| Durable queue | `apps/api/src/lib/durable-queue.ts` | Postgres-backed (`background_jobs`), crash-safe, multi-instance via `FOR UPDATE SKIP LOCKED`, idempotency keys, poison-quarantine. Carries optional `tenant_id`. |
| SLA scanner | `apps/api/src/lib/sla-scanner.ts` | Every ~4h. Overdue leave/correction/helpdesk → in-app notifications + `sla.breached` events. |
| Intelligence scanner | `apps/api/src/lib/intelligence-scanner.ts` | Every ~6h. 7 scans → events (late patterns, burnout, staffing, payroll blockers, attendance risk, compliance deadlines, lifecycle expiry). |
| Leave scheduler | `apps/api/src/lib/leave-scheduler.ts` | Per-tenant cadence: accrual, carry-forward, expiry, event grants, reconciliation. |
| Attendance API scheduler | `apps/api/src/lib/attendance-api-scheduler.ts` | Polls external punch sources per their interval. |
| Event-bus automation | `apps/api/src/lib/event-bus-automation.ts` | Event-driven listeners → audit logs + HR notifications. |

Registered at startup in `apps/api/src/index.ts` (`AUTOMATION_REGISTRY`), with `startup-health.ts`
validating each module and disabling any that fail.

**Deployment model** — single Fastify web process (`apps/api/Dockerfile` → `node dist/index.js`;
`package.json` `start`). No separate worker. Schedulers run inside the web process. This *works*
(durable queue is multi-instance-safe), but heavy background work shares the HTTP process. A
dedicated worker mode is a future hardening, **not a blocker** for R9.

**Conclusion:** No new scheduling infrastructure is required for R9.

---

## 2. Intelligence Source Inventory — pull vs. push vs. stored

| # | Output | Generated at | Classification | Tenant-scoped recipients derivable? |
|---|---|---|---|---|
| 1 | **Executive narratives** (CEO/CHRO) | `routes/intelligence/index.ts:419` (upserts `intelligence_digest`) | **STORED** (only output persisted) | Yes — hr_admin/super_admin |
| 2 | **Workforce insights** (`/workforce-command`) | `routes/intelligence/index.ts:43–344` | **PULL-ONLY** | Yes |
| 3 | **Attrition signal** (`/org/attrition-signal`) | `routes/intelligence/index.ts:887–939` | **PULL-ONLY** | Yes |
| 4 | **Probation / lifecycle expiry alerts** | `intelligence-scanner.ts:466` → `lifecycle-expiry.ts` | **EVENT + in-app notification** | Yes (already notifies HR) |
| 5 | **Leave governance / SLA alerts** | `sla-scanner.ts:94–134`, `event-bus-automation.ts:64–147` | **EVENT + in-app notification** (push-capable) | Yes (already notifies HR) |
| 6 | **Payroll exceptions / blockers** | `intelligence-scanner.ts:271–341` | **EVENT** (cost insights pull-only) | Yes |
| 7 | **Compliance deadline exceptions** | `intelligence-scanner.ts:426–456` | **EVENT + in-app notification** | Yes |
| 8 | **Recruitment summaries** | `routes/recruitment/*` (analytics) | **PULL-ONLY** (no scheduler) | Yes |
| 9 | **Productivity / burnout insights** | `intelligence-scanner.ts:139–186` | **EVENT** (notifies HR at risk ≥ 75) | Yes |

**Read of the table:** Five of nine intelligence categories are **already emitted on a schedule**
as events and many already write in-app notifications to HR. Only the *digests/narratives*
(items 1–3, 8) are pull-only and never delivered. So "scheduled push" is mostly **connecting
the digest endpoints to the cadence that the event-based alerts already enjoy.**

---

## 3. Delivery Channels

| Channel | State | Evidence |
|---|---|---|
| **In-app notifications** | ✅ Live | `notifications` table + `routes/notifications/index.ts`; `inbox_items` via `notifyHrAdmins`. SLA scanner and event automations already write here. |
| **Email** | ⚠️ Transactional only | Resend via `lib/email-service.ts` (`RESEND_API_KEY`, `EMAIL_FROM`). Used for onboarding/recruitment invites. **No digest/intelligence email exists.** |
| **WhatsApp** | ❌ Absent | No integration. |
| **Teams / Slack** | ❌ Absent | No integration. (Channel registry lists `webhook` as a disabled stub.) |
| **Mobile push / Web push / FCM** | ❌ Absent | No push infrastructure. |

The notification **channel registry** (`routes/notifications/index.ts` `/channels`) returns a
hardcoded list (`in_app` on; `email`/`sms`/`push`/`webhook` off) and the toggle endpoint is a
**no-op stub — it does not persist.**

---

## 4. User Preference Model — **ABSENT**

There is **no** persisted model for who receives what, how often, or on which channel.

- No `user_notification_preferences` (or equivalent) table.
- No frequency choice (daily / weekly / monthly).
- No role targeting (HR Head / Manager / Employee / Finance / Admin) for digests.
- No per-category subscription (e.g. "email me attrition + payroll only").
- Frontend: `pages/intelligence/WorkforceDigest.tsx` renders digests on demand (no "subscribe");
  `pages/notifications/NotificationTemplates.tsx` shows channel toggles that **don't save**.

This is the single largest *product* gap. A minimal R9 (broadcast to all HR admins) needs **no**
preference table; a richer R9 (opt-in, per-role, per-category) **does** introduce new data —
which is why a preference-driven version sits *beyond* the register's "R9 = no new data" line.

---

## 5. Multi-Tenant Safety — **PASS (most important item)**

The API runs on the **Supabase service-role key** (`apps/api/src/plugins/supabase.ts`), which
**bypasses RLS**. Therefore tenant isolation depends *entirely* on explicit `tenant_id` filters
in application code. The audit verified that the scheduled layer enforces this consistently.

1. **Tenant enumeration.** Every scheduler loops tenants explicitly:
   `SELECT id FROM tenants` then per-tenant scan — `intelligence-scanner.ts:81` / `:510`,
   `sla-scanner.ts:82`, `leave-scheduler.ts:97`. No global cross-tenant query.

2. **Per-query tenant filter.** Every data query in `intelligence-scanner.ts`, `sla-scanner.ts`,
   and `leave-scheduler.ts` carries `.eq('tenant_id', tenantId)` (verified across all scan
   functions). **No unfiltered query found.**

3. **Recipient resolution is tenant-scoped.** HR recipients are fetched with
   `.eq('tenant_id', tenantId).in('role', ['super_admin','hr_admin'])`
   (`sla-scanner.ts:46`, `event-bus-automation.ts:340`), and notifications are inserted with the
   **same** `tenant_id`. A notification cannot be written to a foreign-tenant recipient.

4. **Role scoping.** Every intelligence/digest endpoint gates to `hr_admin`/`super_admin`
   (`routes/intelligence/index.ts` lines 44, 347, 394, 888, 1034, 1087…; executive via
   `requireExec`). In-process events are not HTTP-exposed.

5. **Background jobs.** `durable-queue.ts` jobs carry an optional `tenant_id`; handlers scope by it.

**Verdict:** No cross-tenant leak is possible in the current scheduled layer. A scheduled digest
push that **reuses the existing per-tenant loop + tenant-scoped HR recipient resolution** inherits
this safety. The risk would only appear if a future digest job queried across tenants or resolved
recipients without the tenant filter.

**Recommended guardrails for any R9 build:**
- Reuse `fetchHrProfileIds(supabase, tenantId)` / the existing per-tenant loop — do not re-invent recipient resolution.
- Add a CI/lint rule: scanner/scheduler queries must include a `tenant_id` filter.
- Log every scheduled send as `(tenant_id, recipient_id, category, period)` for an audit trail.
- Assert a non-null `tenantId` at the top of every scheduled handler.

---

## 6. Gap summary & build scope (for when R9 is greenlit)

| Capability | Status | Needed for scheduled push |
|---|---|---|
| Scheduling rails | ✅ exists | reuse |
| Digest computation | ✅ exists (pull) | reuse endpoints/logic |
| Email sender (Resend) | ✅ exists | add a digest template |
| In-app notifications | ✅ exists | reuse |
| Tenant-scoped recipients | ✅ exists | reuse |
| **Digest scheduler job** | ❌ missing | **build** — daily/weekly/monthly cadence calling existing digest logic per tenant |
| **Digest email template** | ❌ missing | **build** — `digestEmail()` HTML wrapper |
| **Channel persistence** | ⚠️ stub | make `/notifications/channels` save |
| **Preference model + UI** | ❌ missing | *optional* — introduces new data (beyond register's R9 line) |

**Two viable R9 shapes:**
- **R9-minimal (honors "no new data"):** one scheduler job + a digest email template that
  broadcasts the existing daily/weekly/monthly digest to each tenant's HR admins. Low risk;
  reuses every safe primitive above.
- **R9-full (new data):** the above + `user_notification_preferences` (frequency, role, category,
  channel) + a settings UI + channel persistence. More complete; steps outside the register's R9 scope.

---

## 7. Audit conclusion

R9 is **not blocked by missing infrastructure**, and its **tenant-safety foundation is sound**.
Whenever it is built, it should be assembled from the existing, already-audited primitives rather
than new plumbing — keeping the proven per-tenant, per-role scoping intact. The only genuinely new
*data* question is whether to ship delivery preferences (R9-full) or a broadcast-to-HR digest
(R9-minimal). That is a product decision, recorded here for the build phase.

*This document is the R9 deliverable: an audit, not an implementation.*
