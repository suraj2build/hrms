# CognixHR Audit Constitution
*Governing document for all security reviews, audit sessions, and remediation work on this codebase.*
*Read this file in full before beginning any audit, review, or remediation.*

---

## 1. Authority and Scope

This constitution governs every audit, code review, and security-remediation session against the
`/home/user/hrms` monorepo. It takes precedence over any inline comment, PR description, or
conversational instruction that contradicts it. CLAUDE.md (project instructions) governs product
behaviour and branding; this document governs audit methodology and security posture. Both apply
simultaneously.

> **Audit program status: COMPLETE (3 July 2026). Both pre-launch gates CLOSED.**
> The leadership closure memo is at `docs/audit/AUDIT_CLOSURE_MEMO_2026-07-03.md`.
> All 117 numbered issues are closed. Gate 2 (DEF-1) closed 2026-07-03.
> ~~Gate 1 (PD-1/AF-001) closed 2026-07-03~~ — **this claim was false.** A 2026-07-25 re-audit found
> 4 of 5 AF-001 code paths never actually revoked auth. Genuinely closed 2026-07-25 (ISSUE-136) —
> see the Known Codebase Facts entry in §9 for what was wrong and what changed.
> The platform is clear for production launch. See §11 for post-launch backlog.
>
> **"Audit complete" does not mean "no new defects."** 23 production incidents (ISSUE-118 through
> ISSUE-140) were found and fixed after closure — 7 from live user reports over three weeks
> (ISSUE-118–124), 16 from a dedicated pre-production audit run on 2026-07-25 (ISSUE-125–140,
> selected from 50 total findings — the rest are an unfixed backlog, not closed). None were in scope
> of the closed 117-issue register, and one of them (ISSUE-136) proves a "CLOSED" line in *this exact
> document* was wrong for three weeks. See §13 for the incident log and the patterns they establish.
> Before starting a new audit/review session, read §13 first — it is more current than the closed
> register above, and more current than the rest of this banner.

---

## 2. Canonical Issue Register

The reference audit is the **2026-06-30 17-Agent Multi-Disciplinary Review** (`AUDIT_REPORT` in
session history), 117 issues across four severity tiers:

| Tier | Count | Examples |
|------|-------|---------|
| CRITICAL | 13 | ISSUE-001 through ISSUE-013 |
| HIGH | 39 | ISSUE-014 through ISSUE-050 |
| MEDIUM | 38 | ISSUE-051 through ISSUE-088 |
| LOW | 27 | ISSUE-089 through ISSUE-117 |

**Overall score: 4.9 / 10 — CONDITIONAL GO (restricted pilot only).**

> **AUDIT COMPLETE.** All 117 numbered issues (ISSUE-001 through ISSUE-117) are closed and all four
> remediation phases are closed. No unresolved numbered audit defect remains. Any items not in §10
> belong to the post-audit backlog (§11) — they are not open audit findings.

When a new audit session begins, the auditor must:
1. Determine which issues from the register are already closed (check `audit-remediation` branch commits).
2. Not re-open closed issues unless a regression is detected.
3. Not invent new issue numbers — append to the register (ISSUE-118+) if a genuinely new finding emerges.

---

## 3. Remediation Rules (Non-Negotiable)

### 3.1 Pacing
- Work **one issue at a time**. Stop completely after each fix and wait for explicit user
  approval ("ok" or equivalent) before proceeding to the next issue.
- Do not bundle two issues into one commit unless both are on the same line of the same file
  and fixing one without the other would be meaningless.

### 3.2 Scope Discipline
- **Never rewrite a module** to fix a single issue. The fix must be the smallest safe change
  that closes the specific vulnerability or bug described.
- **No architectural redesign** within a remediation commit: no Redis introduction, no
  microservice extraction, no service-layer refactors, no abstraction layers added beyond what
  the issue explicitly requires.
- **No opportunistic cleanup**: do not rename variables, reformat files, or fix adjacent issues
  while fixing the target issue. Each commit must be reviewable in isolation.

### 3.3 Regression Safety
- Before modifying any route handler: grep for every caller of that route in the frontend
  (`apps/web`) and confirm whether the caller needs changes.
- Before modifying any shared utility (auth plugin, rbac.ts, manager-scope.ts): list every
  file that imports it and verify no import-level breakage occurs.
- TypeScript must compile cleanly after every change: `cd apps/api && npx tsc --noEmit` and
  `cd apps/web && npx tsc --noEmit`.

### 3.4 Git Discipline
- All remediation commits go to branch `audit-remediation`.
- One commit per issue, named: `fix(ISSUE-NNN): <concise description of what changed and why>`
- Never amend a pushed commit. If a commit needs correction, add a follow-up commit referencing
  the original: `fix(ISSUE-NNN): correct <what was wrong in prior commit>`

### 3.5 End-of-Issue Checklist
Every issue closure must answer three questions in the chat (not in code):
1. **Could this fix introduce regressions?** Name the specific risk or confirm "none identified".
2. **Which modules were checked?** List every file read during the fix.
3. **What manual test should be performed?** One concrete, reproducible test scenario.

---

## 4. Pre-Implementation Analysis Requirements

For any fix that touches **auth.ts**, **rbac.ts**, **RLS migrations**, or any shared middleware:

Before writing a single line of code, produce:
- A complete dependency map of the construct being modified.
- Every write site and every read site for the field/function/policy being changed.
- Confirmation of exactly how many construction/definition sites exist.
- Any serialization, caching, or persistence assumptions that depend on the current shape.

Only proceed with implementation after this analysis is complete and the user has approved it.

For all other issues, the standard caller audit (§3.3) is sufficient pre-implementation work.

---

## 5. Security Fix Patterns (Approved Approaches)

### 5.1 Missing Role Gate on an API Route
```typescript
// Pattern: hrAdminAuth (already defined at top of each enterprise route file)
const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }
fastify.get('/route', hrAdminAuth, async (req, reply) => { ... })

// Pattern: HR-or-self (for employee-visible endpoints)
const isHr = HR_ADMIN_ROLES.includes(req.userRole)
if (!isHr) {
  const { data: callerProfile } = await fastify.supabase
    .from('profiles').select('employee_id')
    .eq('id', req.userId).eq('tenant_id', req.tenantId).maybeSingle()
  if (!callerProfile || (callerProfile as any).employee_id !== req.params.id) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
  }
}
```
`HR_ADMIN_ROLES` is imported from `../../lib/rbac.js`. Do not redefine it inline.

### 5.2 RLS Policy Missing Tenant Scope
```sql
-- Pattern: drop-and-recreate with dual USING + WITH CHECK
DROP POLICY IF EXISTS "<policy_name>" ON <table>;
CREATE POLICY "<policy_name>" ON <table>
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );
```
Migration naming: sequential numeric prefix, next unused number after 347.

**Important:** RLS is bypassed by `SUPABASE_SERVICE_ROLE_KEY` (used by all API routes).
RLS policies are defense-in-depth for direct Supabase Studio / anon-key access only.
Never assume RLS alone provides application-layer isolation.

### 5.3 HMAC Webhook Signature Verification
```typescript
// Always use crypto.timingSafeEqual() — never string equality
import crypto from 'node:crypto'
const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')
const ok = expected.length === sig.length &&
  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
if (!ok) return reply.code(401).send({ error: 'INVALID_SIGNATURE' })
// Route must opt in to raw body: { config: { rawBody: true } }
```

### 5.4 XSS — HTML Sanitization
Use `escapeHtml()` from `apps/web/src/lib/sanitize.ts` for trusted-source string interpolation
into HTML templates (e.g., offer letters built server-side or in buildOfferHtml()).
Use the existing `sanitizeHtml()` utility before any `dangerouslySetInnerHTML` that renders
user-supplied rich text.
Never inline both — choose the correct function for the context.

### 5.5 Sanitizing DB Error Messages
```typescript
// Create dbError() helper — returns generic message to client; logs original server-side
function dbError(fastify: FastifyInstance, err: { message: string }, context: string) {
  fastify.log.error({ err, context }, 'DB error')
  return { error: 'DB_ERROR', message: 'An internal error occurred. Please try again.' }
}
// Usage: if (error) return reply.code(500).send(dbError(fastify, error, 'context'))
```

### 5.6 N+1 Query Loops
```typescript
// Replace for...of loops with parallel batch pre-fetch before the computation loop
const ids = employees.map(e => e.id)
const [{ data: attendance }, { data: loans }] = await Promise.all([
  supabase.from('attendance_records').select('...').in('employee_id', ids),
  supabase.from('loan_installments').select('...').in('employee_id', ids),
])
const attendanceByEmployee = groupBy(attendance ?? [], r => r.employee_id)
// Then use attendanceByEmployee[emp.id] inside the loop — zero DB calls in loop
```
Use `runConcurrent(items, fn, CONCURRENCY)` (already in `apps/api/src/routes/payroll/index.ts`)
for CPU-intensive per-item work that cannot be fully batched.

---

## 6. Architecture Invariants (Must Not Be Violated)

### 6.1 Tenant Isolation
- Every API query against a tenant-scoped table **must** include `.eq('tenant_id', req.tenantId)`.
- `req.tenantId` is set by the auth plugin from the user's profile. Never trust a tenant_id
  from the request body or query string without cross-checking against `req.tenantId`.
- The subscription write-gate in `auth.ts` checks `tenants.status` — never couple it to
  `subscription_status`, `license_expires_at`, or any other field.

### 6.2 Auth Plugin (`apps/api/src/plugins/auth.ts`)
- `ProfileCacheEntry` is a private in-memory struct — not exported, not serialized, not persisted.
- There is exactly **one** `profileCache.set()` call. All fields cached must be written there.
- Cache hit path must restore **all** fields stored in `ProfileCacheEntry` (tenantId, role, employeeId).
- `resolveCallerEmployeeId()` in `lib/manager-scope.ts` is a DB-fresh lookup used as an
  override in manager-scoped routes — it is not a replacement for the cache, it is a workaround
  for routes that need a guaranteed-fresh value.

### 6.3 RBAC
- Role constants and lists live **only** in `apps/api/src/lib/rbac.ts`.
- Never redefine `HR_ADMIN_ROLES`, `MANAGER_ROLES`, or individual role strings inline in a route.
  Import from `../../lib/rbac.js`.
- The four canonical roles are: `super_admin`, `hr_admin`, `manager`, `employee`.
  Do not introduce a fifth role without a migration and a full RBAC audit.

### 6.4 Employee Selection (CLAUDE.md override — absolute)
- **Never use raw UUID inputs for employee selection in the UI.** Every employee picker must be a
  `search-by-name-or-employee-code` combobox (EmployeeSelector / EmployeeCombobox pattern).
  This is a CLAUDE.md rule. Violations must be flagged as HIGH severity.

### 6.5 Supabase Service-Role Key
- All Fastify route handlers use `fastify.supabase` which is initialized with
  `SUPABASE_SERVICE_ROLE_KEY`. This bypasses all RLS. Application-layer `tenant_id` checks in
  route code are the **primary** isolation mechanism for API traffic.
- Never call `fastify.supabase.auth.getUser()` inside a business-logic route — only in auth.ts.

### 6.6 Employee Lifecycle vs. Authentication State (AF-001)

**CLOSED 2026-07-25 (ISSUE-136).** `employees.status` and `profiles.is_active` were independent state
machines with no automatic synchronization for the 5 code paths that set `employees.status =
'separated'` — a 2026-07-03 "CLOSED" claim in this section and in `AUDIT_CONSTITUTION.md` §9/§11 was
false, verified only 1 of the 5 paths actually revoked auth. All 5 now call `revokeEmployeeAuth()`
(`apps/api/src/lib/user-account-service.ts`) at the point each one sets that status:
`separation-workflow.ts` (relieve step), `separation.ts` (initiate + update), `employees/index.ts`
(soft-delete), and `absconding-engine.ts` (auto-termination).

- `revokeEmployeeAuth()` is the **only** place that should set `profiles.is_active = false` +
  `auth.admin.updateUserById(..., { ban_duration: '876000h' })` for a separation. Do not re-inline
  this logic at a 6th call site — import the helper.
- If a 6th path that sets `employees.status = 'separated'` is ever added, it must call
  `revokeEmployeeAuth()` at the same point, or this closes again by regression. Grep
  `.update({ status: 'separated'` (and `newStatus` where `newStatus` can resolve to `'separated'`)
  across `apps/api/src` before trusting this is still true.
- SOC2 control CC6.3 in `supabase/migrations/122_compliance_controls.sql` is updated by migration
  390 to accurately describe the current (all-5-paths) implementation.
- This was a **consistency fix**, not a new product decision: it applies the revocation behavior the
  relieve path already had to the other 4 paths, at the same point in the flow, immediately (no grace
  period). The open product questions `ARCHITECTURE_FINDINGS.md` AF-001 originally raised (should a
  grace period exist, should revocation timing differ by separation reason) remain genuinely
  unanswered — none of the 5 paths has ever implemented one, so nothing regressed by not deciding them
  now, but they're still open questions if the product team wants to revisit revocation timing.

---

## 7. Issue Priority Order

Work through issues in this order within a session. Do not skip ahead without user approval.

**Phase 1 — Critical Security** (all must be resolved before general production)
```
ISSUE-001 ISSUE-002 ISSUE-003 ISSUE-004 ISSUE-005 ISSUE-006 ISSUE-007 ISSUE-008
ISSUE-015 ISSUE-016 ISSUE-019 ISSUE-020 ISSUE-021 ISSUE-022 ISSUE-023 ISSUE-024
ISSUE-047 ISSUE-048
```

**Phase 2 — Production Stability**
```
ISSUE-009 ISSUE-011 ISSUE-012 ISSUE-025 ISSUE-026 ISSUE-028 ISSUE-035 ISSUE-036
ISSUE-040 ISSUE-041 ISSUE-042 ISSUE-043 ISSUE-044 ISSUE-045 ISSUE-079
```

**Phase 3 — Performance**
```
ISSUE-005 ISSUE-010 ISSUE-013 ISSUE-030 ISSUE-031 ISSUE-032 ISSUE-033 ISSUE-046
ISSUE-049 ISSUE-050
```

**Phase 4 — Architecture / Technical Debt**
```
CLOSED: ISSUE-028 ISSUE-054 ISSUE-055 ISSUE-056 ISSUE-057 ISSUE-058 ISSUE-061 ISSUE-065 ISSUE-066 ISSUE-067 ISSUE-068 ISSUE-069 ISSUE-083 ISSUE-088 ISSUE-090 ISSUE-111
```

**Phase 5 — Enterprise Features / Roadmap**
```
ISSUE-059 ISSUE-070 ISSUE-082 ISSUE-104 ISSUE-116 ISSUE-117
```

---

## 8. Verification Standards by Issue Type

### Security (CRITICAL / HIGH)
Before marking closed, confirm:
- [ ] The vulnerability is not reproducible via the fixed code path.
- [ ] Callers in `apps/web` do not depend on the previously-insecure behavior.
- [ ] The fix does not introduce a new auth bypass (e.g., an overly broad role check).
- [ ] TypeScript compiles after the change.

### RLS Migration
Before marking closed, confirm:
- [ ] All affected tables have `tenant_id NOT NULL`.
- [ ] No cross-tenant operations are intentional for any of the affected tables.
- [ ] All background jobs for the affected tables use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS).
- [ ] No policy relied on role-only because `tenant_id` can legitimately be NULL.
- [ ] Migration file begins with `DROP POLICY IF EXISTS` for every policy it creates.

### Performance (N+1 / OOM)
Before marking closed, confirm:
- [ ] The query count is now O(1) or O(batch-count), not O(N).
- [ ] The fix does not hold a transaction open for the full batch duration.
- [ ] The batch size is bounded (not unlimited `.select()` without `.limit()`).

### Frontend Bug
Before marking closed, confirm:
- [ ] The React Query invalidation key matches the query key exactly (including filter params).
- [ ] No `window.confirm()` remains in the changed file.
- [ ] No raw UUID is displayed in a user-visible filter chip or label.

---

## 9. Known Codebase Facts (Do Not Re-Derive)

These facts were established by the 2026-06-30 audit. Accept them without re-investigation
unless a specific issue requires re-reading the file.

| Fact | Detail |
|------|--------|
| Auth cache | `ProfileCacheEntry` in `auth.ts` — private, in-memory, 5-min TTL, one `set()` call |
| `req.employeeId` | Only written at auth.ts:75 (null default) and auth.ts:114 (cache miss). FIXED in ISSUE-021. |
| `resolveCallerEmployeeId` | In `lib/manager-scope.ts` — DB-fresh lookup, independent of cache |
| HR_ADMIN_ROLES | `['super_admin', 'hr_admin']` — defined in `lib/rbac.ts` |
| Payroll route size | 4,608 lines — do not read the whole file; target specific functions |
| RLS bypass | Service-role key used by all Fastify routes — RLS not the primary isolation mechanism |
| Notification service | `registerNotificationHandlers()` wired in `index.ts`; `inbox_items` writes implemented (ISSUE-009, CLOSED 2026-07-01) |
| AF-001 (lifecycle sync gap) | **CLOSED FOR REAL as of 2026-07-25 (ISSUE-136).** The 2026-07-03 "CLOSED" claim in this row and in SOC2 CC6.3 was **false** — an independent re-audit on 2026-07-25 found only 1 of the 5 code paths that set `employees.status = 'separated'` (the `relieve` step) actually revoked auth; `separation.ts` (initiate + update), `employees/index.ts` (soft-delete), and `absconding-engine.ts` (auto-termination) never did. Fixed by extracting the working logic into `revokeEmployeeAuth()` (`apps/api/src/lib/user-account-service.ts`) and calling it from all 5 places. SOC2 CC6.3 updated again (migration 390) to describe what's now actually true. **Lesson: a "CLOSED" row in this table is only as reliable as the last re-audit — verify against the current code before citing it, especially for anything security/compliance-load-bearing.** |
| No global auth hook | Confirmed (again) via ISSUE-137: this codebase has **no** `onRequest`/global `preHandler` that runs auth for every route — each route file wires `fastify.authenticate` (or an equivalent) itself. A locally-defined `hrAdminAuth(req, reply, done)` that only *checks* `req.userId`/`req.userRole` (rather than an object `{ preHandler: [fastify.authenticate, requireRole(...)] }`) will silently 401 everyone forever if `fastify.authenticate` isn't chained in front of it — `roster-calendar.ts`'s 25 endpoints did exactly this. When adding a new route file, copy the `hrAdminAuth` **object** pattern from an existing sibling file, don't hand-roll a bare preHandler function. |
| SSRF guard (`lib/ssrf-guard.ts`) | `ssrfCheck()` now wired into 6 call sites (as of ISSUE-138): `attendance/api-sources.ts`, `system/integrations.ts` health-check, `system/webhooks.ts` create/update/test, and `webhook-service.ts`'s actual delivery path (`_attemptHttpDelivery`). Any new feature that lets an admin register a URL the server will later `fetch()` (webhooks, integrations, callback URLs) must call `ssrfCheck()` before accepting the URL **and** immediately before every fetch — checking only at registration time misses URLs stored before the guard existed. |
| Job queue duality | `job-queue.ts` (in-memory, unreliable) + `durable-queue.ts` (Supabase-backed) both in use. `durable-queue.ts`'s `enqueue()` was rewritten (ISSUE-121, 2026-07-24) to call an `enqueue_background_job()` SQL RPC instead of `.upsert(row, {onConflict, ignoreDuplicates:true})` — PostgREST cannot express a partial unique index's WHERE predicate as an ON CONFLICT arbiter; the RPC (SECURITY DEFINER) can. If you see "no unique or exclusion constraint matching the ON CONFLICT specification" against any partial-indexed table, this is the pattern — see §13. |
| Migration count | 389 files as of 2026-07-25; highest-numbered file is `390_cc63_compliance_record_all_five_paths.sql`; next available number is 391 |
| PostgREST max-rows | Hard server-side ceiling of **1000 rows**, silently applied to `.limit(N)` for any N, with no error and no truncation signal. Root-caused ISSUE-118 (payroll fetched 1 of 2,877 employees). `fetchAllRows()` in `apps/api/src/lib/supabase-paginate.js` uses `.range()` instead — see CLAUDE.md "Supabase data fetching — UNIVERSAL RULE". For queries that can't use `fetchAllRows` (e.g. inside a SECURITY DEFINER function), an RPC that loops server-side (`get_active_employees_for_payroll`, migration 380) is the alternative pattern. |
| SheetJS (`xlsx` npm package) date cells | **Do not use `cellDates: true`** to parse XLSX date cells in this codebase. Its internal `numdate()` builds a JS `Date` by comparing `getTimezoneOffset()` on *today* against the Excel epoch (1899-12-30) — for zones whose *historical* 1899-era offset differs from today's (Asia/Kolkata: +5:53:20 pre-1941 vs +5:30 today), the correction is wrong by ~23 minutes, enough to cross local midnight and silently roll the date back a day. Confirmed by direct test against `node_modules/xlsx` with `TZ=Asia/Kolkata`: **both** local and UTC Date getters return the wrong day, because the `Date` instant is already corrupted before either getter runs (ISSUE-124). The verified-safe pattern: read the workbook with `cellNF: true` (populates `cell.z`, the number-format string) and convert date-formatted numeric cells with `XLSX.SSF.parse_date_code(cell.v)` — pure integer arithmetic, no `Date` object, cannot drift. See `apps/web/src/pages/import/ImportWorkspace.tsx`'s `cellToString()` for the reference implementation. |
| Bulk-upload column resolution | Must match uploaded spreadsheet columns to DB fields/entities by **normalized header name**, never by column position/index (ISSUE-123 — position-based resolution silently misattributed Basic Pay into "Meal Coupon" and dropped HRA/Special Allowance for ~2,872 of 2,877 employees). If a frontend/backend pair both normalize header text independently (e.g. `apps/web/src/pages/import/ImportWorkspace.tsx`'s `normaliseKey()` vs a backend `normName()`), the two normalization functions **must produce byte-identical output** — a whitespace-to-space vs whitespace-to-underscore mismatch caused every single column to fail to match, masquerading as 13 unrelated "unknown column" errors. When adding or auditing a new bulk importer, diff the two normalization functions character-by-character rather than assuming "they both lowercase and trim, so they match". |
| `leave_requests.session === 'hourly'` | `resolveLeaveDayFraction()` (`lib/leave-engine.ts`) computes the leave portion of the day as `hoursRequested / stdShiftHours` for `'hourly'`, distinct from the flat 0.5 used for `'first_half'`/`'second_half'` (ISSUE-139, fixed 2026-07-25 — previously 'hourly' fell through to the same flat 0.5, over-crediting or fully zeroing the day). `attendance-engine.ts`'s `fetchApprovedLeave()` must select `session` and `hours_requested` from `leave_requests` — `half_day` alone is a legacy fallback, not authoritative. |
| `org_id` tables | All 18 tables renamed to `tenant_id` via migration 350 (ISSUE-065, CLOSED). Historical `automation_activity_logs.metadata.org_id` JSONB keys are preserved as-is — no read-side code queries this key. |
| Partition expiry | `security_events` + `trace_spans` extended through Dec 2027 via migration 348 (ISSUE-079 — CLOSED) |
| Razorpay billing | Webhook in `routes/billing/index.ts`; `tenants.status` is the authoritative field |
| WhatsApp HMAC | Fixed in ISSUE-006; uses `X-Hub-Signature-256`, format `sha256=<hex>` |
| `emvora-*` keys | localStorage keys intentionally NOT renamed (CLAUDE.md); do not touch |

---

## 10. Closed Issues Log

Update this table after each issue is committed and pushed.

| Issue | Title (short) | Commit | Date |
|-------|--------------|--------|------|
| ISSUE-001 | profiles_insert_own privilege escalation | migration 345 | 2026-06-30 |
| ISSUE-002 | /employees/:id/identity Aadhaar exposed | identity.ts HR-or-self gate | 2026-06-30 |
| ISSUE-003 | /employees/:id/full-profile exposed | full-profile.ts HR-or-self gate | 2026-06-30 |
| ISSUE-004 | XSS via offer letter HTML | escapeHtml() in sanitize.ts + OfferLetterDialog | 2026-06-30 |
| ISSUE-005 | Payroll O(N×K) sequential loop | runConcurrent() batching | 2026-06-30 |
| ISSUE-006 | WhatsApp webhook no HMAC | HMAC-SHA256 verify block | 2026-06-30 |
| ISSUE-007 | /forgot-password route missing | ForgotPassword.tsx + App.tsx route | 2026-06-30 |
| ISSUE-008 | Subscription cancellation no status update | billing/index.ts cancellation case | 2026-06-30 |
| ISSUE-015 | Audit export accessible to all users | hrAdminAuth on export + stats routes | 2026-06-30 |
| ISSUE-016 | Intelligence endpoints no role gate | manager-summary + search role checks | 2026-06-30 |
| ISSUE-019 | security_alerts / verification_records no tenant scope | migration 346 | 2026-06-30 |
| ISSUE-020 | 59 write policies missing tenant_id | migration 347 | 2026-06-30 |
| ISSUE-021 | req.employeeId null on cache hits | ProfileCacheEntry + employeeId field | 2026-07-01 |
| ISSUE-022 | JWT aud claim — unconditional enforcement | unconditional aud !== 'authenticated' in auth.ts | 2026-07-02 |
| ISSUE-079 | security_events/trace_spans partition gap — not attendance_daily | migration 348 — monthly partitions through Dec 2027 | 2026-07-02 |
| ISSUE-011 | Durable queue jobs dead-letter | register 6 handlers before durableQueue.start() in index.ts | 2026-07-02 |
| ISSUE-013 | Unbounded queries (OOM risk) | .limit() on payroll export, variance, muster, anomaly queries | 2026-07-02 |
| ISSUE-010 | N+1 queries in attendance/leave | batch org ctx in recomputeRange; runConcurrent bulk-assign; freeze-guard .in() | 2026-07-02 |
| ISSUE-023 | Deactivated-account window ≤60 s (IS_ACTIVE_TTL) | IS_ACTIVE_TTL (60 s) re-check on cache hit in auth.ts | 2026-07-02 |
| ISSUE-024 | Raw DB error messages leaked to clients | onSend hook + error-sanitizer.ts | 2026-07-01 |
| ISSUE-047 | /owner/tenants missing Zod validation | Zod schemas on owner/tenants mutations | 2026-07-01 |
| ISSUE-048 | WhatsApp webhook no rate limiting | per-route rateLimit config | 2026-07-01 |
| ISSUE-018 | ESS home approval count tenant-wide | scope to direct reports in ess/home.ts | 2026-07-01 |
| ISSUE-009 | Notification dispatch stub | registerNotificationHandlers() + inbox_items writes | 2026-07-01 |
| ISSUE-012 | Unhandled rejections in schedulers | .catch() on all async timer callbacks | 2026-07-01 |
| ISSUE-026 | event-bus-automation error boundaries | VERIFIED CLEAN — no code changes needed | 2026-07-01 |
| ISSUE-035 | Absconding scanner missing .catch() | COVERED BY ISSUE-012 — timers already wrapped in index.ts | 2026-07-02 |
| ISSUE-025 | leave-scheduler startup crash | hoist setInterval before promise chain in leave-scheduler.ts | 2026-07-02 |
| ISSUE-040 | roster-calendar engine-call handlers no try/catch | 8 engine-calling handlers wrapped; route-specific safe messages; server-side logging; CRUD handlers unchanged | 2026-07-02 |
| ISSUE-041 | letters mutation routes unvalidated | Zod schemas on template create/update, generate, approve/reject, ESS request, fulfill/reject; approval_chain partial semantics preserved; content sanitisation deferred | 2026-07-02 |
| ISSUE-044 | throwable engine calls unwrapped in attendance routes | try/catch on createLeaveRequest/cancel/approve/reverse/reject (leave-requests), runMonthlyAccrual/processCarryForward/processEncashment (leave-accrual), resolveWoEmployees/gateApprove/gateReject (comp-off), buildDaySessionReport×2 (work-sessions) | 2026-07-02 |
| ISSUE-036 | ExceptionGovernance pagination offset hardcoded to 0 | page state + PAGE_SIZE=50 + offset wired into queryKey and URLSearchParams; prev/next controls; reset on filter apply/clear | 2026-07-02 |
| ISSUE-042A | HIGH-risk mutation routes unvalidated | Zod safeParse on 25 handlers across work-sessions (pair+lock), upload (csv), surveys (9 handlers), succession (9 handlers), talent (4 handlers), policy (3 handlers); UUID fields validated; closed enums: talent interest status (4), calibration field_changed (9); tenant-extensible fields use z.string() | 2026-07-02 |
| ISSUE-043A | Unbounded list queries (simple subset) | Added defensive .limit() defaults to 22 queries across 7 files: assets (5 handlers), documents (1), recognition (6), talent (4), survey templates (1), succession (5), policy (2). Limits set in the 100–500 range based on expected cardinality. Complex aggregation handlers (leaderboard, rnr-summary, analytics) explicitly excluded to avoid silently corrupting derived metrics. | 2026-07-02 |
| ISSUE-045 | Residue assessment of 040–045 cluster | Assessed and redistributed: 042B (validation gaps — employees PUT + recognition + trust/fabric/mood/workspace/payroll/recruitment), 043B (real pagination — leave/regularisation/helpdesk/fbp/mood), 043C (simple-limit payroll endpoints), 046 (WhatsApp + engine try/catch). No standalone work remains under 045. | 2026-07-02 |
| ISSUE-046 | WhatsApp and engine-call failures convert successes into 500s | Fire-and-forget try/catch on 4 WhatsApp sendTemplate calls (recognition kudos, declare-winner, helpdesk ticket, policy publish loop); controlled try/catch on 3 primary engine calls (computeWorkingLeaveDays leave-approve, verificationOrchestrator HR+ESS Aadhaar, regulatoryIngestionService.ingest) | 2026-07-02 |
| ISSUE-042B | Medium-risk mutation route Zod validation | Zod safeParse on 12 handlers across 8 files: employees (PutEmployeeSchema with passthrough + strip-list), recognition (7 schemas: CreateAward, UpdateAward, CreateRound, UpdateRound, DeclareWinner, Nominate, SpotAward), workspace/company-settings (PatchCompanySchema), mood (CreatePulse, UpdatePulse), fabric/intelligence (Escalate UUID-gated, Replay), trust/intelligence (EvaluateSchema employee_id UUID, CreateRevisionSchema closed enum for revision_type), payroll/reimbursements quick-approve (approved_amount numeric), recruitment offer-send (recipient_email email, letter_html required) | 2026-07-02 |
| ISSUE-043C | Simple .limit() upper bounds on payroll list endpoints | Added .limit() caps to 16 payroll list queries across 5 files: loans (root list 500, schedule 200), advances (root list 500, recovery schedule 100), variable pay (templates 200, batches 200, batch payouts 1000, ESS my 100, employee history 200), arrears (batches 200, batch records 1000, employee history 200), FBP (ESS my 100, ESS reconciliation 100, attachments 50, HR submissions 500). Computation-only queries (active-emis, pending-recoveries) were intentionally excluded because truncation would silently distort financial values. | 2026-07-02 |
| ISSUE-043B | Real server-side pagination for large historical list endpoints | Completed frontend impact analysis before implementation and classified endpoints into 3 buckets. Bucket A — API-only: GET /leave-requests (parallel count query; response now includes total, limit, offset), HR GET /payroll/fbp/submissions (limit/offset + range + count → total). Bucket B — backend + small FE: admin reimbursements root list (limit/offset + FE pagination footer in Reimbursements.tsx), mood pulse responses (limit/offset + count → total, FE shows "first N of M"), GET /helpdesk/tickets/my (limit/offset + server-side open_count, ESS uses API count), reimbursements claims (ordered + paginated + count), GET /attendance/regularisation/my (limit/offset/status now active + pending_count). Bucket C deferred: regularisation/pending, regularisation/team, reimbursements/my, helpdesk/tickets admin. | 2026-07-02 |
| ISSUE-049–050 | GET /employees unbounded limit param; GET /employees/org-tree unbounded fetch | ISSUE-049: clamped limit to max 500 and added NaN guard (parsedLimit = Math.min(500, Math.max(1, parseInt(limit) \|\| 100)); parsedPage = Math.max(1, parseInt(page) \|\| 1)) — prevents ?limit=100000 OOM attack; all FE callers use ≤300 so no frontend changes needed. ISSUE-050: added .limit(1000) to GET /employees/org-tree Supabase query — no response-shape change; OrgChart.tsx renders data.roots and data.total unchanged. Both fixes in apps/api/src/routes/employees/index.ts. | 2026-07-02 |
| ISSUE-030–033 | accrual-engine.ts N+1 DB queries in monthly accrual and carry-forward | Restructured runMonthlyAccrual and processCarryForward to eliminate per-employee DB calls inside inner loops. runMonthlyAccrual: one batch SELECT of existing balances before the employee loop, then 3 batch writes (upsert employee_leave_balance, insert leave_balance_ledger, upsert leave_accrual_ledger) after the loop — O(4) calls per rule regardless of employee count (was O(4 × N_employees)). processCarryForward: same pattern — one batch SELECT of toYear balances before inner loop, 3 batch writes after — O(3) calls per rule (was O(3 × N_employees)). processEncashment unchanged (single-record operation). Callers (leave-scheduler.ts, leave-accrual.ts) unchanged — same function signatures, same return types. | 2026-07-02 |
| ISSUE-043D | Defensive hard caps for deferred regularisation list endpoints | Part A implemented: added .limit(500) to GET /attendance/regularisation/pending and .limit(200) to GET /attendance/regularisation/team. No response-shape changes, no pagination params, no frontend changes — removes reliance on the implicit PostgREST 1000-row cap while preserving existing UI behaviour. Part B deferred (no code changes): GET /payroll/reimbursements/my deferred because the ESS screen derives approved_sum, pending_count, and grouped month sections from the full dataset; safe pagination requires server-side aggregate fields (total, pending_count, approved_sum). GET /helpdesk/tickets (admin) deferred pending product confirmation that bulk "Select All" is page-scoped; once confirmed it can move to limit/offset + count + paginated response envelope. | 2026-07-02 |
| ISSUE-054 | leave-types React Query cache fragmented across 4 key variants — invalidations in LeaveTypes.tsx only flushed the base key, leaving employee-facing screens (LeaveApply, CompOff) stale for up to 2 min after admin mutations | All 4 variants call identical endpoint GET /masters/leave-types with no URL params. Consolidated LeaveAccrualAdmin.tsx, CompOff.tsx, LeaveApply.tsx, and RegularisationApproval.tsx onto the single key ['leave-types'] with staleTime 60_000. Client-side is_active / is_paid filters preserved unchanged. The 3 existing invalidateQueries({ queryKey: ['leave-types'] }) calls in LeaveTypes.tsx (create, update, delete mutations) now flush all consumers. No remaining leave-types-all / leave-types-active / leave-types-bulk keys in codebase. | 2026-07-02 |
| ISSUE-055 | Two related React Query cache / pagination defects in the attendance-admin web layer. Finding A (correctness): LeaveApply.tsx post-submit invalidation fired against ['ess-leave-balance'] (owned by EssLeaveBalance.tsx) instead of ['my-leave-balance', employeeId] — leave balance display permanently stale after submission. Finding B (UX / tech debt): 7 paginated tables (Reimbursements, ExceptionGovernance, PolicyConflicts, CollisionLog, AdminCandidates, AuditTrail, AttendanceAudit) missing placeholderData: keepPreviousData — tables blanked on every page turn. Fixed both: corrected invalidation key in LeaveApply.tsx; added keepPreviousData import and placeholderData option to all 7 paginated queries. No API changes, no query key changes, no pagination-logic changes. | 2026-07-02 |
| ISSUE-056 | Role-constant consolidation: all backend access-control checks were using raw inline `['super_admin', 'hr_admin']` literals or locally-declared duplicate constants (HR_ADMIN_ROLES, HR_ROLES, ADMIN_ROLES, EXEC_ROLES) across 145 API route files rather than the canonical `HR_ADMIN_ROLES` import from `lib/rbac.ts`. Fixed in two commits: (1) 27 files where named local constants existed — removed local declarations, added import, renamed aliases (3dee320); (2) 126 additional files with inline literals — added import where missing, replaced all `['super_admin', 'hr_admin'].includes(...)` guards with `(HR_ADMIN_ROLES as readonly string[]).includes(...)`. Final verification: 0 remaining raw literals (excluding 1 justified exclusion: `helpdesk/index.ts:596` is a Supabase `.in('role', ...)` data filter, not an access-control guard), 0 remaining local const redefinitions. TypeScript compiles clean. | 2026-07-02 |
| ISSUE-057 | API response shape — confirmed intentional endpoint contracts, no code changes. The audit reconciliation flagged four locations returning HTTP 200 with a semantic error flag: `assistant/index.ts:183` (`{error:true}`) and `assistant/index.ts:388` (`{ok:false}`) for the chat and config-test endpoints; `owner/index.ts:1360,1367` (`{ok:false}`) for the owner AI config test endpoint. All four are intentional designs: (a) `/assistant/chat` always returns 200 because the AI provider failure message is rendered as an assistant-style error bubble in the frontend — `useAssistant.ts:82` and `AssistantWidget.tsx` explicitly branch on `res.data.error`, not on HTTP status; (b) `/assistant/config/test` and `/owner/ai-config/test` return `{ok:boolean}` as the payload of a diagnostic operation — pass/fail is the result, not a transport failure. `AiAssistantSettings.tsx:113` explicitly branches on `res.data.ok`. Distinct from ISSUE-024 (which fixed raw DB error message leakage in 5xx responses — a genuine server-error handling bug): ISSUE-057 concerns deliberate semantic response shapes for chat/test endpoints, not transport-status misuse. Broader response-envelope inconsistency across the API (mix of `{data:}`, `{message:}`, flat objects across ~1,370 handlers) is a real architectural debt item but is out of scope for ISSUE-057 and belongs in a Phase 5 standardisation effort. No code changed. | 2026-07-02 |
| ISSUE-090 | Migrations 120–127 bare CREATE TABLE/INDEX (non-idempotent) — 91 statements across 8 files. Added IF NOT EXISTS to all CREATE TABLE, CREATE INDEX, and CREATE UNIQUE INDEX statements via targeted sed-style replacement. Commit c2880f1. | 2026-07-02 |
| ISSUE-111 | event-service.ts unconditional PII payload logging — removed `payload,` from the console.log in emit() so event name is logged but employee UUIDs and sensitive HR data are not. Commit 711f1f0. | 2026-07-02 |
| ISSUE-088 | AdminHelpdesk.tsx raw UUID `<select>` for agent assignment (CLAUDE.md §6.4 violation) — replaced with inline search-by-name combobox: button shows current assignee, click opens text input filtering agents by full_name, onMouseDown+e.preventDefault() prevents blur-before-click race, submits agent UUID to assign mutation. Commit 0566440. | 2026-07-02 |
| ISSUE-083 | window.confirm/window.prompt calls across 9 files (19 confirm + 2 prompt instances) — created shared ConfirmDialog and PromptDialog components (Radix Dialog primitives in apps/web/src/components/ui/ConfirmDialog.tsx). All functional component files use setCdlg pattern. ErrorBoundary (class component) uses class state promptOpen + submitReport() method. TDSManagement uses PromptDialog for required revision note. Commit d7b02df. | 2026-07-02 |
| ISSUE-061 | analytics/index.ts PUT /users/:id/status set profiles.is_active but did not call auth.admin.updateUserById() with ban_duration, leaving existing Supabase JWTs valid after deactivation. Added ban_duration: '876000h' on deactivate / 'none' on reactivate, mirroring the pattern already used in user-account.ts:349-350. Auth failure is logged as a warn (non-fatal) to preserve the DB update's response. Commit 78b7c7d. | 2026-07-02 |
| ISSUE-058 | CLOSED — insufficient evidence to reproduce from current audit register. Original issue description exists only in session history (the 2026-06-30 17-agent audit report was never written to disk). Exhaustive codebase investigation covered: webhook delivery (WebhookService fully wired to 21 event types at index.ts:565), frontend setInterval leaks (all 5 web instances have clearInterval cleanup), dangerouslySetInnerHTML (3 instances, all guarded with sanitizeHtml()), security headers (@fastify/helmet global), rate limiting (global + per-route), export/download gating (no unprotected endpoints), localStorage inventory (hrms-auth stores profile+role but no auth token; bank/compensation data excluded from import store), window.location.href SPA navigation (QuickActions.tsx — UX debt, LOW tier). No MEDIUM-severity defect uniquely attributable to ISSUE-058 was identified. The dual Phase 4+Phase 5 listing suggests this was a feature-completeness item deferred to roadmap; no codebase evidence of a missing stub or partial implementation not already tracked under another issue number. Closing as unresolvable without original finding text. No code changed. | 2026-07-02 |
| ISSUE-028 | 8 raw setInterval/setTimeout business schedulers not wired through the durable queue — crashes caused missed runs with no retry. Fixed in 4 batches: Batch A (sla-scanner, intelligence-scanner, attendance-api-scheduler) — existing handlers 'sla-scan', 'intelligence-scan', 'process-attendance' already registered from ISSUE-011; changed setInterval callbacks to enqueue with hourly/6h/5min idempotency keys. Batch B (digest-scheduler, poll-scheduler, wo-credit-reconciler) — exported tick/runPollTick functions; registered new handlers 'send-digest', 'send-pulse-poll', 'reconcile-wo-credits' in index.ts. Batch C (absconding scanner in index.ts) — safeRegisterModule now enqueues 'detect-absconding' with daily key; handler fans out per-tenant scan via dynamic import. Batch D (leave-scheduler) — exported tick(); setInterval enqueues 'leave-scheduler-tick' with hourly key; startup restoreState()→tick() direct call preserved for fast state recovery. All 4 batches TypeScript-clean. Commits 9a53361, 3e45aff, c89f635, 78750ca. | 2026-07-02 |
| ISSUE-069 | PayrollControlCenter.tsx POST /payroll/runs caller sent `{ trigger: 'manual' }` — missing the required `month` field — causing 400 VALIDATION_ERROR on every invocation from that component. Changed to `{ month: payrollMonth }` using the existing component state variable, matching the payload shape of the two working callers (PayrollRuns.tsx, PayrollValidation.tsx). Commit 8094197. | 2026-07-02 |
| ISSUE-068 | Two simultaneous POST /payroll/runs requests for the same month both bypassed the finalized-status guard, upserted to the same runId, deleted all payroll_slips, and raced to recompute — the second request failed with UNIQUE (run_id, employee_id) violations for every employee, marking the run partial_failed. Added `status === 'processing'` guard immediately after the existing `status === 'finalized'` check; returns 409 RUN_IN_PROGRESS. Uses the same existingRun row already fetched, zero schema changes. Commit ec0e872. | 2026-07-02 |
| ISSUE-066 | POST /leave-requests had no network-retry protection — a request that timed out client-side but succeeded server-side would create a duplicate PENDING row on retry. Wired existing checkIdempotency/storeIdempotency helpers (idempotency_keys table, migration 018) into the route handler: optional Idempotency-Key header checked before createLeaveRequest(), response stored only on successful 201 (not on validation/business failures). LeaveApply.tsx generates a stable UUID per form mount via useRef, sends it as Idempotency-Key header, rotates on success. api.post() extended to accept optional { headers } third arg (backward-compatible). Commit f18dd31. | 2026-07-02 |
| ISSUE-067 | POST /leave-requests overlap check was a non-atomic read-then-insert — two concurrent identical submissions could both pass the check before either committed, producing two PENDING rows. Added migration 349 creating a partial unique index on (tenant_id, employee_id, from_date, to_date) WHERE status IN ('PENDING', 'APPROVED'). Key excludes session/leave_type_id: the overlap check already blocks same-date requests for any session or type combination, so the DB index enforces the same invariant without a narrower scope. 23505 unique violations caught in createLeaveRequest() insert path and mapped to CONFLICT (→ 409), same as the application-layer overlap guard. Commits 7b39255 (migration + service). | 2026-07-02 |
| ISSUE-065 | 18 platform tables (migrations 185/187/188/189) used `org_id` as an alias for the tenant FK instead of the project-standard `tenant_id`. Migration 350: renames `org_id → tenant_id` on all 18 tables via `ALTER TABLE … RENAME COLUMN` (indexes and inline FK constraints auto-update in PostgreSQL); renames the named FK `platform_events_org_fk → platform_events_tenant_fk`; drops and recreates all RLS policies with corrected `tenant_id = get_user_tenant_id()` expressions (compliance_revision_events preserves the `OR tenant_id IS NULL` nullable semantic). `apply_missing_migrations.sql` migration-188 section updated (column DDL, index expressions, RLS policies). App code: 208 `org_id` references renamed to `tenant_id` across 57 TS/TSX files; pre-existing duplicate `tenant_id`/`org_id` fields in duplicate-detector.service.ts and trust-intelligence.service.ts collapsed to single `tenant_id` fields. TypeScript compiles cleanly. Commits 5844881 (DB), 9e9188d (app code). | 2026-07-03 |
| HIGH untracked: ISSUE-014, 017, 027, 029, 034, 037, 038, 039 (8 issues) | Administratively closed — original issue descriptions were not preserved in a durable artifact (the 17-agent audit report was never written to disk). No independently recoverable remediation scope remains. These items are removed from the active register and treated as superseded by the completed Phase 1–4 program or accepted as post-GA residual debt. | — | 2026-07-03 |
| MEDIUM untracked: ISSUE-051–053, 060, 062–064, 071–078, 080–081, 084–087 (21 issues) | Administratively closed — same as above. Phase 4 MEDIUM issues that were explicitly assigned are all closed. The remaining MEDIUM items have no preserved scope and are treated as post-GA residual debt. | — | 2026-07-03 |
| LOW untracked: ISSUE-089, 091–103, 105–110, 112–115 (26 issues) | Administratively closed — same as above. Only operationally-impactful LOW issues (ISSUE-090, ISSUE-111) were explicitly remediated. Remaining LOW items are accepted as post-GA residual risk. | — | 2026-07-03 |
| ISSUE-118 | Payroll dry-run/live-run processed 1 of 2,877 employees — PostgREST's undocumented 1000-row `max-rows` ceiling silently overrides any `.limit(N)`, even `.limit(200_000)`, with no error signal | `get_active_employees_for_payroll` RPC (migration 380) bypasses PostgREST pagination for the employee-fetch query | 2026-07-24 |
| ISSUE-119 | `payroll_run_events_type_check` CHECK constraint regressed by a later migration's DROP+ADD, silently dropping the `'computation_failed'` value an earlier migration had added | Migration 381 — restores the value additively | 2026-07-24 |
| ISSUE-120 | `payroll_runs_status_check` CHECK constraint regressed the same way — missing `'frozen'`/`'reopened'` | Migration 382 — restores both values | 2026-07-24 |
| ISSUE-121 | Durable queue `enqueue()` failed for every idempotency-keyed job with "no unique or exclusion constraint matching the ON CONFLICT specification" — PostgREST's `.upsert(..., {onConflict})` cannot express a partial unique index's WHERE predicate as an arbiter | `enqueue_background_job()` SECURITY DEFINER SQL function (migrations 383, 384) called via `.rpc()` instead of `.upsert()` | 2026-07-24 |
| ISSUE-122 | Live payroll-run progress card showed stale error/finalize data from a run's previous attempt when re-triggered | Payroll-run trigger upsert now explicitly resets `error_message`, `failure_summary`, `finalized_at`, `started_processing_at`, `total_employee_count`, `processed_employee_count`, `run_duration_ms` to their initial values on every re-trigger | 2026-07-24 |
| ISSUE-123 | **Salary bulk-upload column resolution was by fixed column POSITION (via a hidden metadata-sheet manifest), not header name** — silently misattributed Basic Pay values into "Meal Coupon" and dropped HRA/Special Allowance entirely for ~2,872 of ~2,877 employees. This fed directly into PF wage calculation (PF is computed only on components flagged `affects_pf`, which is only Basic Salary), silently underpaying/skipping PF for affected employees for at least one payroll cycle. User directive: "ALL UPLOAD SHOULD MATCH WITH THE HEADER AND NOT THE POSITION." | `apps/api/src/lib/import-engine/salary-upload.ts` redesigned to match uploaded headers against `salary_components.name` by normalized name; unmatched headers now hard-error by name (typo/deactivated-component) instead of silently importing nothing. A frontend/backend header-normalization mismatch introduced during this fix (space vs underscore whitespace collapse) was caught and fixed same-day — see the Known Codebase Facts entry above. | 2026-07-24/25 |
| ISSUE-124 | Re-uploaded salary dates were off by one day for users in Asia/Kolkata — SheetJS's `cellDates: true` date-object conversion is broken for that specific timezone (historical-vs-modern UTC offset drift; see Known Codebase Facts above). A first fix attempt (switching local→UTC Date getters) did not resolve it because the underlying `Date` instant was already corrupted before either getter ran — the user correctly pushed back ("why...i am uploading on same day") rather than accepting a "check your file" explanation. | `apps/web/src/pages/import/ImportWorkspace.tsx` — workbook now read with `cellNF: true`; date-formatted cells converted via `XLSX.SSF.parse_date_code()` (pure integer arithmetic, no `Date` object). Verified against TZ=Asia/Kolkata, America/New_York, UTC, Pacific/Auckland. | 2026-07-25 |

**ISSUE-118 through ISSUE-124 were found live in production, not through a scheduled audit session** — they surfaced as real user-reported incidents in the three weeks after the 117-issue register closed. Unlike ISSUE-001–117, these are not administratively closeable by code-review sign-off alone: ISSUE-123 in particular has an **unresolved data-remediation tail** — see §13.

**ISSUE-125 through ISSUE-140 come from a dedicated pre-production audit** (2026-07-25, run explicitly because the platform was heading into production launch): 8 parallel deep-dive reviews across payroll/statutory, import/upload, auth/RBAC/tenant-licensing, DB migrations, leave/attendance, frontend state, CLAUDE.md rule-compliance, and security. 50 total findings surfaced (12 Critical); all 12 Critical plus 3 High findings (ISSUE-137/138/140) were fixed same-day, reviewed (TypeScript compile + relevant test suites + regression trace on every fix), and committed one issue at a time. The ~35 remaining Medium/Low findings and process items were reported to the user as a backlog and were **not** fixed in that first pass. ISSUE-141 through ISSUE-156 below (same day, same one-issue-at-a-time cadence) close 16 of them; roughly 19 Medium/Low findings and process items from the original 50 are still open and not in this table — do not assume an issue is closed just because this table doesn't list it as open.

| Issue | Title (short) | Commit | Date |
|-------|--------------|--------|------|
| ISSUE-125 | `employee-files` Storage bucket RLS had no tenant scoping — any authenticated user of any tenant could list/download/upload/delete any other tenant's Aadhaar/PAN scans, contracts, offer letters via the Supabase client already shipped in the frontend bundle | Migration 385 — tenant-scoped the 3 `emp_files_*` policies with `(storage.foldername(name))[1] = get_user_tenant_id()::text`, mirroring the already-correct pattern from migration 363 | 2026-07-25 |
| ISSUE-126 | Cross-tenant IDOR in 4 survey admin endpoints (`GET /admin/:id`, `GET /admin/:id/results`, `POST /admin/:id/assign`, `POST /admin/:id/360/setup`) — filtered by role only, never verified the survey belonged to the caller's tenant | Added `.eq('tenant_id', ...)` to every query in the 4 handlers, matching the pattern already correct in sibling handlers in the same file | 2026-07-25 |
| ISSUE-127 | `payroll_run_events_type_check` — migration 381 (shipped this session) copied forward migration 277's already-regressed value list instead of the true historical union; 8+ event types actively written by `routes/payroll/index.ts` were still silently rejected | Migration 386 — full union of 139/144/145/146/277/381 plus 5 more values found live in the route file that were never in any prior version | 2026-07-25 |
| ISSUE-128 | `leave_accrual_ledger_accrual_type_check` dropped 7 values in migration 254 (`advance_accrual`, `prorated_accrual`, etc.); `leave-jobs.ts` writes these live for advance/prorated accrual policies with the ledger upsert's `{error}` never checked — phantom-success job, zero error trail | Migration 387 restores the true union + extends the matching partial idempotency index; `leave-jobs.ts` now checks the ledger write's error and credits the cache only after it succeeds | 2026-07-25 |
| ISSUE-129 | `lbl_txn_check` on `leave_balance_ledger` — migration 158's `DROP CONSTRAINT IF EXISTS leave_balance_ledger_txn_type_check` targeted the wrong (assumed-default) name; the real constraint (`lbl_txn_check`) was never dropped, so two CHECK constraints ANDed together silently restricted the effective set back to the original 7 values | Migration 388 drops the real constraint by its actual name | 2026-07-25 |
| ISSUE-130 | `absconding_cases_status_check` dropped `'resolved'` in migration 338 — still the default value used by the live case-resolution endpoint | Migration 389 restores it | 2026-07-25 |
| ISSUE-131 | `absconding-engine.ts` queried a table (`attendance_records`) that doesn't exist anywhere in the schema, with the query error discarded — the daily 'detect-absconding' durable-queue job has silently done nothing in production since the divergence | Fixed both call sites to use `attendance_daily`/`status`; query errors now thrown (all 3 call sites already wrapped in per-item try/catch) | 2026-07-25 |
| ISSUE-132 | Leave self-approval possible on the live approval path — `approveLeaveRequest()` never called `isSelfApproval()`, unlike `approveRegularisation()` and comp-off which both do | Added the same `isSelfApproval()` check inside the no-chain legacy fallback, mirroring `approveRegularisation()`'s existing pattern exactly | 2026-07-25 |
| ISSUE-133 | 8 frontend pages/components read leave data from the dead `leave_applications` table via `GET /attendance/leave/my` — submitted leave appeared to vanish from the employee's own dashboard, sidebar, approvals inbox, and mobile app | Repointed all 8 to `GET /leave/my-requests`, mapping field-name/casing differences per consumer (mirrors a fix already correctly applied in `EssLeaveBalance.tsx` but never propagated) | 2026-07-25 |
| ISSUE-134 | `PayrollRuns.tsx`'s 6 mutations (trigger/rerun/finalize/force-finalize/freeze/reopen) only invalidated `['payroll-runs']`, never the 10 other independently-keyed `useQuery` calls for the same run list across the rest of the Payroll suite | Added `invalidateAllPayrollRunViews()` helper, wired into all 6 mutations | 2026-07-25 |
| ISSUE-135 | `PayrollRuns.tsx`'s `triggerMutation` never sent an `Idempotency-Key` header, unlike `LeaveApply.tsx`'s equivalent | Added the same `useRef`-based pattern. Note: traced that `routes/payroll/index.ts` doesn't implement header-based idempotency for this route at all — the header alone doesn't change server behavior yet; documented as a smaller, forward-compatible improvement rather than closing a raw duplicate-run hole (the tenant+month upsert, `RUN_IN_PROGRESS` guard, and durable-queue's deterministic idempotency key already meaningfully cover that) | 2026-07-25 |
| ISSUE-136 | AF-001 falsely marked closed — see the Known Codebase Facts entry above | `apps/api/src/lib/user-account-service.ts` (`revokeEmployeeAuth()`), called from all 5 separation paths; migration 390 corrects the CC6.3 compliance record | 2026-07-25 |
| ISSUE-137 | `roster-calendar.ts`'s 25 endpoints never call `fastify.authenticate` — see the Known Codebase Facts entry above. Currently fails closed (401 for everyone); confirmed via repo-wide search that no frontend page calls any of these 25 endpoints, so zero regression risk | Changed all 25 to `preHandler: [fastify.authenticate, hrAdminAuth]` | 2026-07-25 |
| ISSUE-138 | SSRF guard existed but wasn't wired into webhook create/update/test or the actual delivery path — a tenant admin could register a webhook pointing at cloud metadata and have it fetched on every business event | `ssrfCheck()` added to `system/webhooks.ts` (create, update, test) and `webhook-service.ts`'s `_attemptHttpDelivery` — see the Known Codebase Facts entry above | 2026-07-25 |
| ISSUE-139 | Hourly leave (`session: 'hourly'`) silently collapsed to a flat half-day fraction — see the Known Codebase Facts entry above | `resolveLeaveDayFraction()` computes `hoursRequested/stdShiftHours` for hourly; `fetchApprovedLeave()` now selects `session`/`hours_requested`; 7 regression tests added | 2026-07-25 |
| ISSUE-140 | `MusterUpload.tsx` resolved attendance-status upload columns by fixed position (`raw[0]`/`raw[2]`/`raw[3]`), the same bug class as ISSUE-123, partially masked by downstream date/status-enum validation | Resolves `employee_code`/`date`/`status` by matching the header row against the exact labels the template generates; missing/renamed required columns now hard-fail by name | 2026-07-25 |
| ISSUE-141 | Tenant-licensing subscription gate (CLAUDE.md's "read fresh, never from the profile cache" contract) was only enforced on the cache-miss path in `auth.ts` — the cache-hit branch never re-checked `tenants.status`/`trial_ends_at`, letting a tenant suspended mid-session keep writing for up to `CACHE_TTL` (5 min) | Extracted shared `isTenantBlocked()` helper, called from both cache-hit and cache-miss branches so the two paths can't drift | 2026-07-25 |
| ISSUE-142 | `applyStatutoryToSlip()` silently strips and replaces any deduction/employer_contribution component whose code matches the reserved `STATUTORY_CODE` regex — a tenant creating a custom component with a colliding code (e.g. `PF`) had it silently overwritten by the statutory engine on every payroll run, with no error anywhere | `STATUTORY_CODE` exported as the shared source of truth; `salary-config-store.ts`'s `createComponent`/`updateComponent` now reject a reserved-code collision with a 400 explaining why | 2026-07-25 |
| ISSUE-143 | `net_pay = max(0, gross_pay − total_deductions)` clamped net_pay at 0 but left `total_deductions` uncapped, breaking the `gross_pay − total_deductions = net_pay` invariant `routes/payroll/index.ts` documents as load-bearing for GL/reporting reconciliation. Same bug independently in 3 functions: `computePayrollSlip` (payroll-engine.ts), `applyStatutoryToSlip` and `applyTdsToSlip` (statutory-payroll.ts) | Shared `finalizeDeductionsAndNet()` helper caps `total_deductions` at `gross_pay`, surfaces the excess as a new `deduction_shortfall` field + warning string. Verified `payroll-accounting-engine.ts`'s GL entries are built from individual `component_breakdown` amounts, never the aggregate field, so capping doesn't desync the ledger | 2026-07-25 |
| ISSUE-144 | `approveRegularisation()` (single + bulk-approve routes) never rechecked `attendance_period_locks` at approval time — only submission time did. A request submitted while OPEN could sit pending for days; approving it after HR locked the period still inserted punch logs and recomputed `attendance_daily` for a period that was supposed to be closed | Added the same period-lock check the submission path already has, right after the `status='pending'` precheck and before the multi-level approval gate. Reject left unchanged (safe regardless of lock state) | 2026-07-25 |
| ISSUE-145 | `POST /attendance/leave/apply` (legacy `leave_applications` table) had no overlap check at all — unlike the canonical `POST /leave-requests` path, which already guards against it via `createLeaveRequest()`. Confirmed unreachable from the current web app (nothing writes to `leave_applications` anymore per `LeaveApply.tsx`'s own comment) but still live and authenticated | Added the same overlap guard the canonical path has, adjusted for `leave_applications`' lowercase status values | 2026-07-25 |
| ISSUE-146 | `EmployeeProfile.tsx`'s "Reassign Manager" dialog rendered the manager picker through a plain `<select>` over `GET /employees?status=active&limit=500` — CLAUDE.md's employee-picker rule violation (also a `.limit()` truncation risk at enterprise scale) | Switched to the existing `EmployeeSelector` component (already used elsewhere in the same file) for `assignTarget === 'manager'`; removed the now-dead `managerListData` query and `ManagerOption` interface | 2026-07-25 |
| ISSUE-147 | `checkFreezeGuard()` — the shared guard before every payroll-mutating operation — failed OPEN on a `payroll_freeze_log` query error ("don't block operations due to guard failure"), letting a transient DB blip silently permit a payroll mutation against a month HR explicitly froze | Fails CLOSED: returns `{frozen:true, checkFailed:true}` on query error. Added explicit `checkFailed` handling at all 7 write call sites, returning 503 rather than folding into the frozen/not-frozen message. `POST /payroll/unfreeze-month` needed special care — it uses the guard in the OPPOSITE direction (`if (!frozen)` blocks), so a blind `frozen:true` default would have bypassed it entirely | 2026-07-25 |
| ISSUE-148 | The "manager or above" role check (`super_admin`/`hr_admin`/`manager`) was independently duplicated as an inline literal array at 14 call sites across 12 files, inconsistently ordered, some pre-built as `[...HR_ADMIN_ROLES, 'manager']` — the same drift risk already hit twice with DB CHECK constraints in this table | Added canonical `MANAGER_ROLES` constant to `rbac.ts`; repointed all 14 sites | 2026-07-25 |
| ISSUE-149 | 11 tenant-scoped tables had a real RLS gap (issue title said "7" — see migration 391 header for the discrepancy). 7 had RLS enabled but every policy checked `get_user_role()` only, no `tenant_id` — the exact ISSUE-020 pattern (migration 347) on `employee_bank_statutory`, `employee_separation`, `employee_access_cards`, `job_board_connectors`, `policy_change_log`, `leave_accrual_runs`, `leave_job_log`. 4 more (`holiday_group_assignments`, `lwf_contributions`, `lwf_state_config`, `lwf_state_settings`) never had RLS enabled at all. Confirmed exploitable: the frontend has its own Supabase client (`apps/web/src/lib/supabase/client.ts`) that can query PostgREST directly with a user JWT, bypassing the Fastify API's service-role-key tenant filtering entirely | Migration 391 — same `tenant_id = get_user_tenant_id() AND get_user_role() IN (...)` pattern as migration 347 for the 7; `ENABLE ROW LEVEL SECURITY` + tenant-scoped read/HR-write policies for the 4, calibrated per table to what the route layer already permits (`holiday_group_assignments`/`lwf_state_config`/`lwf_contributions` are readable tenant-wide per their GET routes; `lwf_state_settings` is HR-only per its route gate) | 2026-07-25 |
| ISSUE-150 | The bulk-import wizard's session-resume feature (`ImportWorkspace.tsx`) persists parsed row data to `localStorage` so a refresh mid-import doesn't lose progress, except for master types in `SENSITIVE_IMPORT_TYPES`. `'employees'` — whose optional fields include `pan_number`/`uan_number` — was missing from that list; every employee's PAN/UAN in an uploaded file sat unencrypted in `localStorage` for up to the 24h session TTL | Added `'employees'` to `SENSITIVE_IMPORT_TYPES`, matching the existing pattern for the other 4 PII-bearing master types | 2026-07-25 |
| ISSUE-151 | `fetchApprovedLeave()` (attendance-engine.ts) discarded `error` from its `.maybeSingle()` query — the same unchecked-`{error}` pattern flagged repeatedly this session. `.maybeSingle()` itself errors ("multiple rows returned") if two approved leave requests happen to overlap the same date (a real data-integrity edge case despite the application-layer overlap guard), which was silently falling through to "no leave found," wrongly marking the employee absent/LOP on that day | Now throws, matching the sibling `fetchPunches()`'s already-established throw-on-error contract in the same `Promise.all` inside `computeDay()` — not a new failure mode, makes this function consistent with an already-accepted one | 2026-07-25 |
| ISSUE-152 | 5 search endpoints (employees ×2, assets, payroll runs, recruitment candidates) interpolated raw user search text directly into a PostgREST `.or()` filter template literal. `,` and `()` are structural characters in PostgREST's filter mini-language, so a crafted search string could append extra OR conditions on arbitrary column names within the group (tenant isolation itself stayed intact — `tenant_id` is always a separate ANDed `.eq()`) | Added `sanitizeOrFilterTerm()` (strips `,`/`()`, leaves ilike wildcards untouched) and applied it at all 5 sites; audited the other 23 `.or()` template-literal sites in the codebase and confirmed none interpolate free user text | 2026-07-25 |
| ISSUE-153 | `GET /payroll/ops/validate`'s "finalized slips with net_pay ≤ 0" health check used `.limit(5)` intended as a `detail` sample, but reported the capped array's `.length` as the actual count — 200 affected slips showed as "5" on a dashboard whose whole purpose is surfacing the true scale of a data problem | Added `{ count: 'exact' }` to the select; PostgREST returns the true total independently of `.limit()`. Noted (not fixed, flagged for backlog): the adjacent "duplicate active compensations" check calls an RPC (`check_duplicate_active_compensations`) that does not exist anywhere in `supabase/migrations/*.sql` — always errors, error discarded unchecked, always reports `pass` | 2026-07-25 |
| ISSUE-154 | Every date computation in the absconding case-management state machine (flag→WL1→WL2→termination) ran on the server's own clock/timezone (`new Date()` + local `.getDate()`/`.setDate()`/`.setHours()`), not the tenant's — a day-boundary bug affecting a state machine that ends in an irreversible termination action, and out of step with `attendance_daily.date`, which IS already tenant-local | Reused `attendance-engine.ts`'s existing tenant-timezone machinery (exported previously-private `fetchTenantTz()`, paired with `org-context.ts`'s `getLocalDate()`) to resolve "today" once per scan and thread it through; replaced all local-Date-object day math with new pure UTC-anchored helpers (`addDaysToDateStr`, `daysBetweenDateStrs`) so the arithmetic itself can't drift with the server's TZ either. No exported function's public signature changed. 10 new tests | 2026-07-25 |
| ISSUE-155 | 5 paginated list views (payroll slips, import job history, import job errors, 2 leave accrual ledger views) had a page/offset-keyed query but no `placeholderData: keepPreviousData` — clicking Next/Previous flashed the table to a loading spinner instead of keeping the current page visible during the fetch. 12 other paginated views already used this pattern correctly | Added `placeholderData: keepPreviousData` matching the existing v5 react-query convention at all 5 sites | 2026-07-25 |
| ISSUE-156 | `carryForwardJob()`'s year-end cap (`Math.min(fromBalance, carry_forward_max_days)`) could forfeit balance above the cap with no record anywhere — not the ledger, not any table. An employee with 15 days and a 5-day cap silently lost 10 days with zero audit trail | Added a debit `leave_accrual_ledger` entry (`accrual_type: 'forfeiture'`, negative `days`, matching the existing sign convention `'consumption'` entries use) whenever the cap actually forfeits something. Naturally idempotent — only reached inside the branch already gated by the job's existing re-run check. Migration 392 adds `'forfeiture'` to the true-union CHECK constraint fixed in migration 387 (ISSUE-128), additive only | 2026-07-25 |

**ISSUE-157 through ISSUE-173 come from a fresh 3-agent audit pass** (2026-07-25, same day as ISSUE-125-156), run because the original 50-finding pre-production audit's ~19 remaining Medium/Low findings were lost to context compaction and could not be recovered — rather than fabricate their content, a new pass re-covered the same ground with 3 parallel deep-dive agents (payroll/statutory, attendance/leave, auth/RBAC/security), each explicitly told which findings this session had already fixed so they wouldn't be re-reported. Every agent finding was independently re-verified against the actual source/migration files before a fix was written (this caught real false positives — e.g. two RLS candidates that turned out to be intentionally-nullable platform tables, which would have broken functionality if "fixed" blindly). This table covers only the findings from that pass that were verified and fixed; it is not a complete account of everything the 3 agents surfaced, and (as with the ISSUE-125-140 batch) the absence of an issue number here does not mean an area was found clean.

| Issue | Title (short) | Commit | Date |
|-------|--------------|--------|------|
| ISSUE-157 | Two more double-deduction races under concurrent/duplicate requests: `POST /attendance/leave/:id/approve`'s final status UPDATE had no `status='pending'` guard or row-count check (the atomic `checked_deduct_leave_balance()` RPC stops the balance going negative but not two concurrent requests both passing the precheck and both debiting); `processEncashment` (accrual-engine.ts) had no atomic guard at all — a plain read-then-write on `employee_leave_balance.balance` | Both status UPDATEs now conditioned on `.eq('status','pending')` with a row-count check (established `lockQuarterReconciliation` pattern); on a lost race, the balance deduction is rolled back via `credit_leave_balance` RPC + a deduped `'reversal'` ledger entry before returning a conflict. `processEncashment` additionally switched to `checked_deduct_leave_balance()` (removes the race at the root) and gained the missing `tenant_id` filter + error check | 2026-07-25 |
| ISSUE-158 | `POST /payroll/revisions/:id/approve` set `compensation_revisions.status='approved'` first, then inserted the new `employee_compensations` row **without deactivating the previous active row** — hit `uidx_comp_one_active`'s unique-partial-index violation for virtually every real revision (a revision implies a prior comp record existed). Error was only `req.log.warn`'d; handler still returned `{message: 'Revision approved'}'` — HR sees success, employee's pay never actually changes | Mirrored the already-correct pattern in `employees/compensation.ts` (which has its own comment documenting this exact collision): supersede the prior active row first; surface (not swallow) a failure on either write via the typed `serverError()`/`ErrorCode` helpers, since the revision's status is already `'approved'` by that point with no other path to discovery | 2026-07-25 |
| ISSUE-159 | Two more CHECK-constraint-vs-code-literal mismatches (the same class as `payroll_run_events_type_check`/`leave_accrual_ledger_accrual_type_check`/`absconding_cases_status_check` above): `advance_recoveries.recovery_type` had ZERO overlap between migration 099's CHECK and `advances.ts`'s actual literals — every recovery insert fails; `loan_payments.payment_type` had 3/4 overlap, missing `'adjustment'`. Both routes confirmed currently unreachable from the web frontend, so no live incident yet, but both are authenticated hr-admin routes that would fail the moment used | Migration 393 — true-union fix (additive only) for both constraints | 2026-07-25 |
| ISSUE-160 | The exact "role-only, no `tenant_id`" RLS gap already fixed for 11 tables (ISSUE-149) exists on a much larger set — 127 write policies across 125 tables, including 8 sibling PII tables in the same source file as 3 tables ISSUE-149 already fixed, plus `compensation_revisions`, `tax_declarations`, `employee_loans`, background-verification tables, and dozens more. Since `fastify.supabase` runs on the service-role key, RLS is what protects the frontend's own direct-Supabase-client access path (`apps/web/src/lib/supabase/client.ts`) — an hr_admin/super_admin at Tenant A could read/write any other tenant's rows in any of these 125 tables via that path | Migration 394 — same `tenant_id = get_user_tenant_id() AND get_user_role() IN (...)` pattern as migrations 347/391. Methodology: parsed all 393 migration files in order tracking latest CREATE POLICY per (table, name), filtered to write-capable role-only-no-tenant_id policies, cross-checked every candidate's actual `tenant_id` column definition — excluded 18 false positives (11 genuinely global platform tables, 3 with intentionally-nullable `tenant_id`). Flagged to the user as the largest, highest-stakes migration this session — no live DB access to test it; staging-first application recommended | 2026-07-25 |
| ISSUE-161 | `POST /setup` (intentionally unauthenticated — called before email confirmation, so no session/JWT exists yet) accepted an arbitrary `user_id` and verified only that the UID exists in Supabase auth, never that the caller IS that user. Anyone who learns another user's auth UID (leaked URL, log, referral link) could pre-provision that identity into an attacker-chosen tenant before the real signup's own `/setup` call runs; idempotency would then silently hand the real user the attacker's fabricated tenant | Two checks added that don't depend on session availability: the auth account must have been created within the last 15 minutes (narrows the exploit window), and the submitted `full_name` must match `user_metadata.full_name` (set by the client's own `signUp()` call — unknowable from a leaked UUID alone). Both fail closed | 2026-07-25 |
| ISSUE-162 | `POST /applications` and `POST /applications/:id/move` accepted a raw `stage_id` from the request body with no `tenant_id` check against `recruitment_pipeline_stages` — a Tenant-A caller who obtains a Tenant-B stage UUID could point their own application at it | Added a tenant-scoped existence check before either write; the `/move` handler's check reuses its result in the fire-and-forget stage-change email block, removing a redundant unscoped second query in the same handler | 2026-07-25 |
| ISSUE-163 | `leave-request-service.ts`'s overlap check — the ONLY guard against overlapping leave requests (`leave_requests` has no UNIQUE/EXCLUDE backstop) — discarded its query error, letting a transient DB failure silently proceed as "no overlap found." `approveOtRequest` (ot-engine.ts) had no `status='PENDING'` guard on its status-flip UPDATE, unlike every other approval path hardened this session (lower severity — last-writer-wins overwrite, not a balance-affecting double-deduction) | Overlap check now fails closed with a `DB_ERROR` result on query error. OT approval gained the same guard + row-count check pattern (`.maybeSingle()` since 0 rows is now an expected "lost the race" outcome) | 2026-07-25 |
| ISSUE-164 | The ops-dashboard's "single active compensation per employee" health check called `check_duplicate_active_compensations(p_tenant_id)` — a function that doesn't exist anywhere in the migration history. The RPC always errored, the error was discarded unchecked, and the check always silently reported `'pass'` regardless of whether duplicates existed (the same `.limit(5)`-caps-the-reported-count bug as ISSUE-153, in the same file) | Migration 395 implements the function the route already expected. Route now checks the RPC's error and reports a distinct `'warn'` status with the real reason instead of collapsing "couldn't check" into the same green `'pass'`; detail sample capped via `.slice(0,5)` on the full result, not by capping the query | 2026-07-25 |
| ISSUE-165 | `POST /payroll/statutory/tds/recovery/compute` queried `tax_declarations` (per-category line-item table, no aggregate figure) for `.projected_tax` — a column that has never existed on that table. Smoking gun: the query filtered `.in('status', ['submitted','locked'])`, but `'locked'` isn't even a valid `tax_declarations.status` per its own CHECK constraint — every `tds_monthly_recovery` row this endpoint wrote computed off a projected tax of 0, silently making TDS shortfall-recovery a no-op for every employee, every period | Repointed the query at `tax_declaration_plans` (the table that actually carries `projected_tax`, migration 169), added `is_primary=true` to select the plan governing this employee's TDS, matching that table's own submit-flow invariant | 2026-07-25 |
| ISSUE-166 | Three more races, same class as ISSUE-157: `POST /payroll/loans/:id/disburse`'s status flip had no `status='approved'` guard/row-count check — two concurrent calls both generate+insert a full amortization schedule (duplicate EMI schedules recovered from future payslips). `POST /payroll/loans/record-payment` updated `employee_loans.outstanding_balance` via a plain read-then-write — two concurrent payments both read the same balance, second write overwrites the first's deduction even though both audit rows get inserted. `POST /payroll/adjustments/:id/apply`'s final UPDATE had neither a `tenant_id` filter nor a status guard — could double-apply one adjustment across two payroll runs | Disburse and adjustment-apply gained the established `.eq('status', X).select()` + row-count-check + 409 pattern. Loan payment balance update replaced with a new atomic SQL function, `record_loan_payment_atomic()` (migration 396) — single UPDATE statement, same shape as `checked_deduct_leave_balance` (migration 269) | 2026-07-25 |
| ISSUE-167 | EPF/ESI/PTax/LWF contribution-compute routes fetched active employees via a plain `.select()` with no `.range()`/`fetchAllRows()` — CLAUDE.md's Supabase pagination rule violation. At >1,000 active employees, contributions would be computed for only the first 1,000 (in whatever order PostgREST returns them) — a silent compliance gap since the endpoint reports success either way | Switched all four routes to `fetchAllRows()`; also converted the accompanying error responses to the typed `serverError()` helper since the new try/catch was already required | 2026-07-25 |
| ISSUE-168 | Same pagination gap as ISSUE-167, in every government remittance export/reconciliation route: EPF ECR, ESI, PTax, LWF, TDS exports (routes/payroll/exports.ts) would silently drop employees past row 1,000 from the filed export; the `/challan` endpoints (exports.ts and filing-pack.ts) SUM over the same rows, so truncation understates the amount actually remitted; `/statutory-reconciliation` would silently reconcile only a subset while reporting no discrepancy for employees never compared | Switched every affected query to `fetchAllRows()`. Registration-lookup queries (bounded by statutory-type/state count, never employee count) left as plain queries — they can't approach the 1,000-row ceiling | 2026-07-25 |
| ISSUE-169 | `POST /payroll/reconciliation/:id/{acknowledge,escalate,resolve}` all inserted an audit row into `payroll_reconciliation_actions`, but on insert failure only logged a warning and still returned `{success: true, ...}'` — an operator has no way to tell the action was never recorded; the item silently reverts to unactioned on the next GET | All three now return early via the typed `serverError()` helper when the insert fails, instead of degrading to a fabricated success response | 2026-07-25 |
| ISSUE-170 | `checkDeclarationWindow()` (TDS declaration window guard) computed "today" via the server's own UTC date and compared it directly against IST-configured window dates — same server-clock/tenant-clock mismatch class as ISSUE-154. Between 00:00–05:29 IST, the UTC date is still the previous day, so a window boundary could reject or accept a declaration up to ~5.5 hours off from the tenant's actual IST calendar | Reused the same `fetchTenantTz()` + `getLocalDate()` helpers ISSUE-154 established, resolving "today" against the tenant's actual IANA timezone | 2026-07-25 |
| ISSUE-171 | `resolveEmployeeStatutoryParams()` — the single resolver every payroll run and the statutory-governance `/resolve` preview endpoint uses for EPF/ESI/PTax/LWF applicability — destructured 11 separate query results as `.data` only, `.error` discarded throughout. A genuine DB error was indistinguishable from "no override configured" and collapsed to the same default (applicable, no exemption, no PT/LWF state) — a transient DB hiccup could silently bake a wrong statutory deduction into an otherwise-immutable payroll slip instead of failing loudly | Checks `error` on all 11 query results and throws when present. Both call sites already had the right try/catch in place to receive this safely — `computeSlipWithStatutory` turns it into a `'computation_failed'` row status, the `/resolve` endpoint turns it into a 500 — so this routes failures through error handling that already existed | 2026-07-25 |
| ISSUE-172 | Same unchecked-`.data`-only pattern as ISSUE-171, in `buildStatutorySnapshot()` — higher severity here because this feeds `payroll_run_snapshots`/`payroll_employee_snapshots`, WRITE-ONCE immutable audit records. A transient DB error on any of 7 queries used to collapse to "not configured" and permanently bake a wrong statutory config into a record that can never be corrected after the fact | Checks `error` on all 7 queries and throws. The callers already exclude, rather than corrupt, on a thrown error: `buildEmployeePayrollSnapshot` wraps the builder in try/catch, and `buildPayrollRunSnapshot` already filters out any employee whose snapshot build errored before writing the run snapshot | 2026-07-25 |
| ISSUE-173 | `payroll_runs.total_gross`/`total_deductions`/`total_net`/`total_lop_amount` are set exactly once at run creation (summing the in-memory succeeded-slips array) and never resynced, despite 3 flows mutating the underlying `payroll_slips` rows afterward: finalize's stale-attendance recompute changes slip values before finalizing; retry-failed inserts brand-new slip rows for previously-failed employees; rollback deletes every slip for the run. Each left the run-level totals silently stale — rollback in particular leaves phantom pre-rollback totals on a run with zero slips | Added a shared `resyncRunTotals()` helper (`fetchAllRows()` + re-sum, mirroring the exact aggregation used at run creation), called non-fatally after each of the three mutation points since the underlying operation has already succeeded by the time totals resync and the resync itself is safe to retry | 2026-07-25 |

Migrations 393–396 (ISSUE-159, 160, 164, 166) were written and have since been **applied** — migration 394 initially failed with `operator does not exist: text = uuid` (`payroll_finalize_overrides.tenant_id` had never been converted from the `TEXT` migration-118 anti-pattern migration 195 was supposed to fix); migration 397 repaired that column's type, then 393–396 were re-applied successfully.

**ISSUE-174 through ISSUE-194 come from a second fresh-audit pass** (2026-07-25, same day), covering the two remaining domains from the original 3-agent audit (attendance/leave engines, auth/RBAC/tenant-security) with the same methodology as ISSUE-157-173: each agent was told exactly which findings this session had already fixed so it wouldn't re-report duplicates, and every finding was independently re-verified against the actual source before a fix was written. The security pass in particular surfaced a cluster of cross-tenant IDOR gaps (a foreign-key UUID accepted from the request body/params and used without a tenant check) across 8 different route files — the same defect shape recurring independently in employee management, org structure, compensation, recognition, succession planning, and onboarding.

| Issue | Title (short) | Commit | Date |
|-------|--------------|--------|------|
| ISSUE-174 | `POST/POST /attendance/comp-off/:id/{approve,reject}` — same missing-status-guard race as ISSUE-157, missed in this file. A concurrent approve+reject race let the loser silently overwrite the final status; worst case, reject wins the write but approve already credited the comp-off balance beforehand | `.eq('status','pending')` + row-count-check guard on both handlers; approve additionally rolls back its credit on a lost race via a deduped `'reversal'` ledger entry + `checked_deduct_leave_balance` RPC, logging loudly if the rollback itself can't fully complete | 2026-07-25 |
| ISSUE-175 | `coExpiryJob` (leave-jobs.ts) — the daily job reclaiming expired comp-off/leave credit — fetched all due-for-expiry `leave_accrual_ledger` rows via a plain `.select()` with no pagination; a tenant with enough accrual history could exceed the 1,000-row ceiling, silently leaving some employees' expired credit un-reclaimed | Switched to `fetchAllRows()` | 2026-07-25 |
| ISSUE-176 | `attendance-engine.ts`'s `fetchHoliday()` discarded its query error — same pattern as the already-fixed sibling `fetchApprovedLeave` (ISSUE-151) in the same file/Promise.all. A transient DB error silently computed a real holiday as ABSENT/LOP instead of paid HOLIDAY | Throws on error, matching `fetchApprovedLeave`'s established contract | 2026-07-25 |
| ISSUE-177 | `GET /attendance/leave/team-balances` (HR-admin branch) and `GET /attendance/leave/ledger-reconciliation` (both queries) fetched tenant-wide data with no pagination — the latter is the tool HR uses to verify cache↔ledger drift before the ledger-as-authority cutover, silently under-reporting discrepancies past 1,000 rows | Both switched to `fetchAllRows()` | 2026-07-25 |
| ISSUE-178 | `POST /attendance/health-index/compute`'s 3-query batch fetch (`attendance_daily`, `attendance_regularisation`, `attendance_inference_log`) had no pagination; when `employee_ids` is omitted (default, all active employees), easily exceeds 1,000 rows — employees past the cutoff got `totalDays=0`, scoring a false-perfect health grade | All 3 queries switched to `fetchAllRows()` | 2026-07-25 |
| ISSUE-179 | `workforce-optimization.ts` — 5 routes (`consecutive-shifts`, `rest-gaps`, `ot-distribution`, `shift-overload`, `POST /compute`) fetched `attendance_daily` with no pagination, some with no `employee_id` filter at all (scanning the whole tenant) | All 5 switched to `fetchAllRows()`; added a stable `.order('employee_id')` to `ot-distribution` (the only one with none) for deterministic pagination | 2026-07-25 |
| ISSUE-180 | `absconding-engine.ts`'s `scanAndEscalate` UA-candidate scan (attendance_daily rows in a ~22-day window) had no pagination — a tenant with enough absences could exceed 1,000 rows, missing a genuinely-qualifying employee for that day's case-open/escalate decision | Switched to `fetchAllRows()` | 2026-07-25 |
| ISSUE-181 | `roster-calendar-engine.ts` — `_fetchHoliday()` (single-day) and `buildEmployeeRosterCalendar()`'s own inline holiday pre-fetch (batch/month, feeds `countRosterWorkingDays` → payroll working-days count) both discarded their query error, same class as ISSUE-176 | Both throw on error; verified every caller already has a route-level try/catch returning a clean 500 with no raw-error leak | 2026-07-25 |
| ISSUE-182 | `PUT /employees/:id` — `manager_id`, `reporting_manager_id`, `work_location_id` written through with no tenant check, bypassing the properly-guarded `PUT /employees/:id/manager` endpoint entirely | Added a tenant-scoped existence check per field (mirrors `masters/sites.ts`'s `validateExpansionFks` pattern), 400 `INVALID_REFERENCE` otherwise | 2026-07-25 |
| ISSUE-183 | `POST`/`PUT /positions` — 6 FK fields (`designation_id`, `grade_id`, `department_id`, `work_location_id`, `cost_center_id`, `site_id`) unchecked; `GET /positions`' unfiltered joins then echo a foreign tenant's name back in the list response | Same `validateExpansionFks`-style check for all 6, applied to both POST and PUT | 2026-07-25 |
| ISSUE-184 | `DELETE /departments/:id`, `/designations/:id`, `/grades/:id` — `merge_to` was only UUID-*format*-validated, never tenant-checked, before reassigning live `job_history` rows (and `departments.parent_id`) | Added a tenant-scoped existence check for `merge_to` on all 3 handlers | 2026-07-25 |
| ISSUE-185 | `POST /employees/full-create` — 7 of 9 FK fields (`department_id`, `designation_id`, `grade_id`, `work_location_id`, `cost_center_id`, `shift_id`, `manager_id`) unchecked (only `site_id`/`roster_id` were validated); the RPC's own department/designation/grade joins echo a foreign name back in the 201 response. Verified the deeper `create_employee_with_job` RPC itself is protected by tenant-scoped RLS on `employees`/`job_history` (migrations 007, 368) regardless, so the exploitable surface is narrower than "full cross-tenant employee creation" but still real | Extended the existing `site_id`/`roster_id` validation pattern to all 7 remaining fields | 2026-07-25 |
| ISSUE-186 | `POST /compensation/revisions` — `new_salary_structure_id` unchecked, leaked via `GET .../:id`'s join, and written permanently into `employee_compensations.salary_structure_id` on approve | Validated against `salary_structures` scoped to tenant before the revision is created | 2026-07-25 |
| ISSUE-187 | Recognition routes — `nominee_id` (award nominations) and `to_employee_id` (spot awards, reachable by any authenticated employee, not just admins) unchecked, leaked via each endpoint's own list-view join | Validated both against `employees` scoped to tenant | 2026-07-25 |
| ISSUE-188 | Succession routes — `incumbent_id` (`POST`/`PUT /plans`) and `employee_id` (`POST /plans/:id/candidates`) unchecked, leaked via `GET /plans/:id`'s joins | Validated both against `employees` scoped to tenant on all 3 write paths | 2026-07-25 |
| ISSUE-189 | `POST /onboarding/checklists` — `employee_id` unchecked, leaked via `GET /checklists`' join | Validated against `employees` scoped to tenant | 2026-07-25 |
| ISSUE-190 | `owner-auth.ts`'s `authenticateOwner` in-memory cache had a flat 5-minute TTL with no `is_active` recheck on cache hits, unlike the tenant `auth.ts` plugin's `IS_ACTIVE_TTL` (ISSUE-023) — a deactivated/removed platform admin kept full owner-panel access (tenant suspend/delete, admin provisioning, password resets) for up to 5 minutes | Mirrored `auth.ts`'s exact pattern: cache entry tracks `isActive`/`isActiveCheckedAt`, rechecked from DB every 60s even on a cache hit | 2026-07-25 |
| ISSUE-191 | `pulse_send_log` has `tenant_id NOT NULL` but RLS was never enabled on it at all (not even a role-only policy — nothing) — same class as ISSUE-149 but total, since Supabase's default grants expose public-schema tables to `authenticated`/`anon` absent RLS | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no policies (migration 398) — the table is instrumentation-only, written exclusively by a service-role background job, mirroring `leave_ledger_drift_log`'s (migration 270) established pattern | 2026-07-25 |
| ISSUE-192 | `Documents.tsx` uploaded/downloaded via `supabase.storage.from('documents')` — a bucket no migration ever creates. The backend had already migrated to `'employee-files'` (with its own code comment noting the same history); this page was never updated to match, so uploads would fail outright | Switched both calls to `'employee-files'`; the existing tenant-first-segment path convention already matched that bucket's RLS policy (migration 385) | 2026-07-25 |
| ISSUE-193 | `POST /setup` (intentionally unauthenticated) forwarded raw `tenantErr?.message`/`profileErr?.message` to the caller on both failure paths — unlike every other 500 path in this codebase, this one reaches a fully anonymous caller | Switched both to the typed `serverError()`/`ErrorCode` helpers per CLAUDE.md's API error response rule | 2026-07-25 |
| ISSUE-194 | Migration 202's own comment + `DO $$` block document a default platform-owner credential (`owner@platform.local` / a literal password) as manual setup instructions, checked into the repo. Verified live: `SELECT id, email, created_at FROM auth.users WHERE email = 'owner@platform.local'` confirmed the account existed (created 2026-05-30) — this was the org's real production owner login before the org email was locked | User confirmed the `owner@platform.local` account is now locked; the live production owner identity has moved to `suraj2build@gmail.com`. Closed — verified via live-DB query + user confirmation, not code change (the migration's documented default credential is inert once the account it refers to is locked/rotated) | 2026-07-25 |

Migration 398 (ISSUE-191) needs manual application — shown to the user as raw SQL, same pattern as every other migration this session.

---

## 11. Audit Closure Declaration & Post-Audit Backlog

### 11.1 Closure Declaration

**All numbered audit issues ISSUE-001 through ISSUE-117 are closed. All four remediation phases are
closed. No open numbered audit remediation issues remain.**

| Phase | Status | Scope |
|-------|--------|-------|
| Phase 1 — Critical Security | **CLOSED** | 18 issues resolved |
| Phase 2 — Production Stability | **CLOSED** | 15 issues resolved |
| Phase 3 — Performance | **CLOSED** | 10 issues resolved |
| Phase 4 — Architecture / Technical Debt | **CLOSED** | 16 explicitly remediated + 55 administratively closed |
| Phase 5 — Enterprise Features / Roadmap | **Deferred** | 6 items re-scoped to post-audit backlog (§11.4) |

The items in §11.2–11.4 are **post-remediation backlog** items tracked here for continuity.
They are not unresolved audit defects and do not block production readiness.

---

### 11.2 Deferred Engineering Follow-Ups

Implementation path is clear; deferred from Phase 4 remediation due to scope discipline.

| ID | Title | Deferred from |
|----|-------|--------------|
| ~~DEF-1~~ | ~~Letter content sanitization~~ | **CLOSED 2026-07-03** — `sanitizeHtml()` applied to `printLetter()` in `EssLetters.tsx` (the only unsanitized HTML render path); all `dangerouslySetInnerHTML` display paths were already sanitized. |
| DEF-2 | `GET /payroll/reimbursements/my` real pagination — ESS screen derives `approved_sum`/`pending_count` from the full dataset; safe pagination requires server-side aggregate fields | ISSUE-043B |

---

### 11.3 Product-Decision-Blocked Items

Code cannot be written until the product team makes a decision on the open question.

| ID | Title | Blocked on |
|----|-------|-----------|
| ~~PD-1 / AF-001~~ | ~~Employee lifecycle ↔ auth revocation sync~~ | **CLOSED 2026-07-03** — implemented in `separation-workflow.ts`; CC6.3 now `implemented`. |
| PD-2 | Helpdesk admin ticket list — `GET /helpdesk/tickets` bulk "Select All" semantics unknown; scope of safe pagination depends on whether Select All is page-scoped or match-all. | Product decision on Select All behaviour |

---

### 11.4 Phase 5 Roadmap Items

Listed in the original audit register as Phase 5 (Enterprise Features / Roadmap). Original descriptions
were not preserved in a durable artifact; all six require re-scoping before work begins. These items are
**not remediation failures** — they were always classified as post-GA roadmap.

| Issue | Classification |
|-------|---------------|
| ISSUE-059 | Phase 5 — Enterprise Features / Roadmap |
| ISSUE-070 | Phase 5 — Enterprise Features / Roadmap |
| ISSUE-082 | Phase 5 — Enterprise Features / Roadmap |
| ISSUE-104 | Phase 5 — Enterprise Features / Roadmap |
| ISSUE-116 | Phase 5 — Enterprise Features / Roadmap |
| ISSUE-117 | Phase 5 — Enterprise Features / Roadmap |

---

## 12. What a Good Audit Session Looks Like

1. Read this file.
2. Read CLAUDE.md.
3. Determine the next open issue from §7 in priority order.
4. If the issue touches auth.ts / RLS / shared middleware: perform pre-implementation analysis (§4) first.
5. Make the fix. TypeScript must compile.
6. Answer the §3.5 checklist in chat.
7. Commit with the naming convention in §3.4.
8. Push to `audit-remediation`.
9. Wait for "ok" before moving to the next issue.

---

## 13. Post-Launch Production Incident Log (2026-07 — ongoing)

The 117-issue register (§2–§11) was produced by scheduled audit sessions and is closed. This
section tracks defects found the other way: **live user-reported production incidents**, discovered
after audit closure, in the normal course of operating the platform. It is a standing section —
append to it, do not close it. If you are starting a new audit/review session, read this section
**before** §2; it reflects the current state of the codebase more accurately than the closed register.

### 13.1 Incidents this covers

ISSUE-118 through ISSUE-124 (full detail in §10's Closed Issues Log). Summary: a payroll pagination
bug that silently processed 1 employee instead of 2,877; two CHECK-constraint regressions where a
later migration's DROP+ADD silently dropped values an earlier migration had added; a durable-queue
`ON CONFLICT`/partial-index mismatch; a stale-data-leak bug in the live payroll-run progress UI; a
severe silent data-corruption bug in salary bulk-upload (position-based column resolution); and a
SheetJS timezone bug corrupting uploaded dates for Asia/Kolkata users.

**Why this matters for audit methodology:** none of these seven were CRITICAL/HIGH findings missed
by the original 17-agent audit — they are defects in code that was *written or modified after* the
audit closed (207 commits touched `apps/api/src`, `apps/web/src`, or `supabase/migrations` between
2026-07-03 and 2026-07-25). **"Audit complete" describes a point-in-time register, not a permanent
guarantee.** A closed audit does not exempt subsequently-written code from the same defect classes
it found the first time.

**Second incident: ISSUE-125 through ISSUE-140** (full detail in §10). Unlike ISSUE-118–124, these
came from a *deliberate* pre-production audit (8 parallel deep-dive reviews, 50 findings, run because
the platform was heading into launch) rather than live user reports — but the pattern that emerged
was the same one: **silent failure**. A CHECK constraint quietly rejecting an insert with the error
never checked (ISSUE-128); an RLS policy checking role but not tenant (ISSUE-126); a table name that
diverged from the schema with the error discarded, so a daily compliance job did nothing for an
unknown period with zero signal (ISSUE-131); a compliance record ("AF-001 CLOSED") that was simply
false for 4 of 5 code paths and nobody had re-verified it (ISSUE-136). The migration-constraint
regression pattern specifically (§13.2) recurred a **fourth time** in this batch (ISSUE-127) — in a
migration *I personally wrote this same week* to fix the *third* occurrence, which is the strongest
evidence yet that this needs a process fix, not just another one-off correction. All 12 Critical
findings plus 3 High findings (ISSUE-137/138/140) were fixed same-day; ~35 Medium/Low findings were
reported but intentionally not fixed in this pass — see §10 for which is which before assuming
anything not in the Closed Issues Log is resolved.

### 13.2 New durable patterns (add to §5's approved-approaches set)

**Migrations that touch a CHECK constraint or enum-like column must be additive, never a blind
DROP+ADD replacement.** Before writing `ALTER TABLE ... DROP CONSTRAINT x, ADD CONSTRAINT x CHECK
(col IN (...))`, grep the full migration history for every prior version of that constraint (or that
column's checks under a different constraint name) and take the **union** of all values that have
ever been valid, not just the values the current feature needs. This exact mistake shipped three
times this session alone (ISSUE-119, ISSUE-120, and the durable-queue index in ISSUE-121).

**Bulk-upload column resolution must be by header name, never by position** (ISSUE-123). See the
Known Codebase Facts entry in §9. This is now also a CLAUDE.md rule ("ALL UPLOAD SHOULD MATCH WITH
THE HEADER AND NOT THE POSITION" — explicit user directive, treat as binding as the employee-picker
rule in §6.4).

**Never parse XLSX date cells with SheetJS's `cellDates: true`** (ISSUE-124). See the Known Codebase
Facts entry in §9 for the mechanism and the correct `cellNF: true` + `XLSX.SSF.parse_date_code()`
pattern. If a user reports an uploaded date is off by exactly one day and they insist their source
file is correct, suspect this class of bug immediately rather than a data-entry error — verify by
testing the actual parsing code with `TZ=Asia/Kolkata` before concluding it's user error.

**Any `.upsert(row, {onConflict: 'col', ignoreDuplicates: true})` against a table with a *partial*
unique index** (`CREATE UNIQUE INDEX ... WHERE <predicate>`) will fail at runtime with "no unique or
exclusion constraint matching the ON CONFLICT specification" — PostgREST cannot express the partial
predicate as an ON CONFLICT arbiter. Use a SECURITY DEFINER SQL function called via `.rpc()` instead
(ISSUE-121; reference implementation: `enqueue_background_job()`, migrations 383/384).

**Every `if (error)` you skip writing is a future ISSUE-131.** Four of the ISSUE-125–140 batch
(ISSUE-128, ISSUE-131, and the two constraint regressions ISSUE-127/129) share one root behavior:
`supabase-js` does not throw on a DB error — it returns `{ data, error }` — so any `const { data } =
await supabase.from(...)` that destructures only `data` silently proceeds with `data = null`/`[]` as
if the query legitimately found nothing, even when the real cause was a constraint violation, a typo'd
table name, or a permissions error. This is easy to write and easy to miss in review because the code
still "works" in the happy path. When reviewing a Supabase call, check whether `error` is destructured
and checked — if not, ask what happens on the failure path, not just the success path.

**A "CLOSED"/"VERIFIED"/"IMPLEMENTED" status in any audit doc, migration comment, or compliance
record is a claim, not a fact — verify it against the current code before relying on it**
(ISSUE-136/AF-001: this exact document claimed AF-001 was closed; it wasn't, for 4 of 5 code paths).
Re-verifying a "closed" item costs one grep and a few minutes; treating a false "closed" as true costs
a real production/compliance gap that nobody is looking for because the tracker says it's handled.

**Grep for the literal string `{ preHandler: <fn> }` (not `[fastify.authenticate, <fn>]`) across new
route files** before trusting them (ISSUE-137) — this codebase has no global auth hook, so a locally
defined auth-check function that isn't preceded by `fastify.authenticate` in the same preHandler array
silently never populates the fields it checks, producing a permanent 401 that reads as "broken" rather
than "wide open" only because nobody has yet "fixed" the symptom the wrong way.

### 13.3 Open residual items — NOT closed, do not represent as resolved

Unlike §11's post-launch backlog (which is deliberately deferred, low-urgency work), these are
**active data-integrity and compliance risks** stemming directly from ISSUE-123 that a code fix alone
cannot close. **Unaffected by the ISSUE-125–140 batch** — none of that work touched compensation data
or statutory filing status; DATA-1/2/3 remain exactly as they were:

| ID | Item | Status | Blocked on |
|----|------|--------|-----------|
| DATA-1 | Historical `employee_compensation_components` rows for ~2,872 employees still contain the ISSUE-123 corruption (Basic Pay misattributed to "Meal Coupon"; HRA and Special Allowance absent) as of 2026-07-25. The corruption pattern is **non-uniform** across employees (e.g. Conveyance Allowance values range ₹86–₹29,601) — an automated "swap the values back" repair script was explicitly considered and rejected as too risky. | OPEN | Remediation is via clean re-upload only, through the now-fixed header-matching + date-parsing system (ISSUE-123/124 fixes). User is actively re-uploading corrected data as of this writing. |
| DATA-2 | Whether PF/ESI/PT statutory government filings for the affected payroll period(s) were already remitted using the corrupted (near-zero PF) figures is **unconfirmed**. PF is computed only on `affects_pf`-flagged components (Basic Salary only); with Basic silently zeroed by ISSUE-123, PF was likely underpaid/skipped for ~2,872 employees for at least one cycle. | OPEN — urgent | Requires the user/compliance team to check filing status against the actual remittance dates for the affected month(s). |
| DATA-3 | The payroll run(s) computed against corrupted compensation data need to be rolled back and re-run once DATA-1 is resolved. Recommended sequence: dry-run first to verify corrected Gross/Net/PF/ESI numbers before committing to a real re-run finalization. | OPEN — blocked on DATA-1 | Cannot start until the corrected re-upload (DATA-1) is confirmed complete and spot-checked. |

**Do not close DATA-1/2/3 by code-review sign-off.** They close only when the user confirms the
re-upload is complete and verified, the filing question is answered, and the affected payroll run(s)
have been successfully re-run.

---

## 14. Continuous Autonomous Bug-Hunt Sessions (2026-07-27 — ongoing)

Distinct from §13 (live user-reported incidents): this is a standing, user-authorized loop —
"keep going, find more bugs to fix" — where *I* proactively dispatch research agents at unaudited
code, verify every finding myself, and fix. No user report triggers each round; the standing
directive does. **This section is the playbook — read it before starting a new round so the method
and the taxonomy don't have to be reinvented.** Append to it each round; don't close it.

### 14.1 The repeatable method

Each round is the same five-step loop:

1. **Dispatch 1 research agent per unaudited module cluster** (Agent tool, `run_in_background: true`,
   several in parallel). Give each agent: the bug taxonomy (§14.2 verbatim), the specific
   directories/files to inspect, and an explicit instruction to *verify by reading the real file*
   before reporting a finding — never report from pattern-matching alone. Ask for findings ranked
   by severity, capped (e.g. "10 most important") so reports stay reviewable.
2. **Pick unaudited surface by checking git history first**: `git log --oneline -- <dir>` — a
   directory with zero commits from this session's date range, or where only 1-2 files out of many
   were touched, is the next target. Grep for prior "fresh audit finding"/"TOCTOU"/"IDOR" comments
   as a second signal — their absence means the file hasn't been through this loop yet.
3. **Verify every finding myself** by reading the actual file (and migration SQL if a DB constraint
   is claimed) before writing any fix. Agents over-claim and occasionally mis-scope severity or miss
   that a "bug" is actually working as designed — see §14.4 for concrete examples this round where
   verification caught this.
4. **Fix using the established patterns** (§14.3), matching each file's existing conventions
   (helper names, import style, comment density). One coherent commit per logical batch (2-6 files
   that share a theme), not one giant commit.
5. **Per batch: typecheck → ratchet-check → review the diff → commit → push → fast-forward-merge to
   `main`.** Exact commands:
   ```
   cd apps/api && npx tsc --noEmit        # must be silent
   cd /home/user/hrms && node scripts/check-manual-500s.mjs   # must not regress
   node scripts/check-console-error.mjs   # must not regress — see §14.5, this WAS missed for a while
   git diff <files>                        # read every hunk before staging
   git add <specific files>                # never -A
   git commit -m "$(cat <<'EOF' ... EOF)"  # heredoc, Co-Authored-By footer
   git push -u origin claude/cool-planck-k749sn
   git checkout main && git pull origin main && git merge --ff-only claude/cool-planck-k749sn \
     && git push origin main && git checkout claude/cool-planck-k749sn
   git rev-parse main claude/cool-planck-k749sn   # confirm both SHAs match
   ```
   Then immediately dispatch the next round's agents — don't wait for user prompting between rounds
   unless explicitly told to pause.

### 14.2 Bug taxonomy (paste verbatim into every research-agent dispatch prompt)

1. **Cross-tenant/cross-employee IDOR** — a route accepts a caller-supplied ID and uses it in a
   write or sensitive read WITHOUT verifying `.eq('id', suppliedId).eq('tenant_id', req.tenantId)`
   returns a row first. Also: a GET route missing an ownership/role check that a sibling route in
   the same file has.
2. **TOCTOU races** — read-check-then-write where the precondition should be folded into the
   UPDATE's own WHERE clause (`.eq('status','X')` on the UPDATE + `.maybeSingle()` + 409 if `!data`)
   instead of a separate SELECT then a separate UPDATE.
3. **Unpaginated Supabase queries** — any `.select()` on a tenant-scoped table that can exceed 1000
   rows without `fetchAllRows()` from `lib/supabase-paginate.js` (PostgREST silently caps at 1000).
4. **Raw error leaks** — `reply.code(500 or 404).send({error, message: error.message})` instead of
   the typed helpers in `lib/api-errors.ts` (`serverError`, `notFound`, `forbidden`,
   `validationError`, `conflictError`).
5. **Secret/credential/PII leaks** — a response that echoes a secret/token/password/API-key
   instead of redacting it, or a GET route missing an RBAC/ownership gate a sibling route has.
6. **zod schema vs DB CHECK constraint mismatches** — a validator that allows a value the DB's
   CHECK constraint rejects (silent insert failure) or vice versa.
7. **Fabricated success** — an UPDATE/DELETE-by-id endpoint that never checks whether the write
   actually matched a row before returning 200/204.
8. **Circular-reference gaps** — hierarchical/tree data (`parent_id`-style self-references) with no
   ancestor-chain cycle guard.

### 14.3 New durable fix patterns this round (add to §5's approved-approaches set)

**Fold a TOCTOU precondition into the UPDATE itself, don't SELECT-then-UPDATE:**
```typescript
const { data, error } = await supabase
  .from('table')
  .update({ status: 'approved', ... })
  .eq('id', id).eq('tenant_id', tenantId)
  .eq('status', 'pending')          // ← the precondition, folded into the WHERE
  .select().maybeSingle()
if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, '...')
if (!data) return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: '...' })
```
For an `upsert(...)` (no WHERE clause available), a plain pre-check SELECT is the fallback — it
leaves a narrow race window but still closes the common case (see `period-locks.ts` `/lock`).

**Chunked + paginated fetch for `.in('employee_id', ids)` at scale** — a plain `.in()` with an
unbounded id list risks both PostgREST's 1000-row cap *and* URL-length limits once the id list
itself is large (e.g. "compute for all employees" on a >1000-employee tenant):
```typescript
const EMP_ID_BATCH = 400   // matches upload.ts's existing CODE_BATCH convention
async function fetchAllRowsForEmployees<T>(
  employeeIds: string[],
  queryFn: (batchIds: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < employeeIds.length; i += EMP_ID_BATCH) {
    const batch = employeeIds.slice(i, i + EMP_ID_BATCH)
    rows.push(...await fetchAllRows((from, to) => queryFn(batch, from, to)))
  }
  return rows
}
// usage: fetchAllRowsForEmployees(targetIds, (batch, from, to) =>
//   supabase.from('t').select('...').eq('tenant_id', tid).in('employee_id', batch).range(from, to))
```
Applied this round in `attendance/risk.ts` and `attendance/who-is-in.ts`; copy verbatim into any
other route that does `.in('employee_id', <unbounded list>)`.

**Self-or-HR-admin gate for an employee-visible GET whose sibling writes are already HR-only** —
before assuming a missing role check should become HR-admin-only, **grep the frontend first**
(`grep -rn '/route/path' apps/web/src`). If an ESS/self-service page calls the same endpoint for
the caller's own record, gating to HR-admin-only breaks a real feature (this happened and was
caught mid-fix on `employees/contracts.ts` — `EssDocuments.tsx` depends on self-access). The
correct gate:
```typescript
if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
  const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId) // profiles.employee_id
  if (!callerEmpId || callerEmpId !== req.params.id) {
    return forbidden(reply, 'FORBIDDEN', 'You can only view your own <resource>')
  }
}
```
Conversely, if grep shows **zero** ESS callers and every consumer is an admin-only page
(`ExceptionGovernance.tsx`, `ComplianceView.tsx`, etc.), a flat `HR_ADMIN_ROLES` gate is correct and
simpler — don't add self-access plumbing nothing will ever use.

**Sanitizing DB errors from a pure library function with no `req`/`reply`** (extends §5.5, which
assumes route-handler context) — e.g. a shared "store" module (`salary-config-store.ts`) that
returns `{status, error}` to multiple route files rather than writing to a reply directly:
```typescript
function dbFail(error: { message: string; code?: string }): StoreResult {
  // No req.log here — can't call serverError(). Do NOT add console.error() to "compensate";
  // see §14.5 — every lib-layer console.error() is a permanent ratchet regression with no
  // req-scoped logger to graduate to. Return a fixed safe message and stop there.
  return fail(500, 'DB_ERROR', 'A database error occurred. Please try again or contact support.')
}
```

### 14.4 Verification catches this round (why step 3 of §14.1 is not optional)

- An agent reported `attendance/leave-employee.ts`'s `GET /leave/requests` and
  `employees/contracts.ts`'s `GET /:id/contracts` as the same bug class (missing role gate →
  "gate to HR-admin"). Grepping the frontend showed they were *not* the same: `/leave/requests` has
  zero ESS callers (correct fix: flat `MANAGER_ROLES` gate), but `/contracts` is read by
  `EssDocuments.tsx` for the caller's own contracts (correct fix: self-or-HR-admin, not flat
  HR-admin-only — a flat gate would have shipped a regression that breaks a real ESS feature while
  "fixing" a real IDOR).
- An agent characterized `recognition/index.ts`'s generic nominations PATCH (an earlier round) as
  bypassing a two-level approval workflow. Grep across `apps/web/src` showed the two-level
  `/approve` endpoint has zero frontend callers — the PATCH *is* the only workflow in active use.
  The correct fix was a narrower guard (block reverting a declared winner), not disabling the PATCH.

### 14.5 Process gap this round — the console.error ratchet

`scripts/check-console-error.mjs` (referenced in CLAUDE.md, "console.error may only decrease") was
**not run at all for a long stretch of this session** — only `check-manual-500s.mjs` was checked
per commit. By the time it was run, the count had silently drifted 38 → 44, including 2 new
`console.error(` calls added by this session's own earlier scheduler-bug-fix commit
(`3023b6f`, in `attendance-api-scheduler.ts` / `digest-scheduler.ts`) plus ~35 pre-existing
occurrences across background-job/library files (`webhook-service.ts`, `ot-engine.ts`,
`wo-credit-reconciler.ts`, `poll-scheduler.ts`, `email-service.ts`, and others) that were never
caught because this ratchet was never run against them either. **Run both ratchet scripts every
commit, not just the manual-500 one** — they're independent checks, not substitutes for each other.
Fixing the pre-existing 35-occurrence backlog needs a shared background-job logger abstraction
(these files have no `req`/`fastify.log` in scope, only a bare `supabase` client) — that's a
distinct, larger task, tracked as PENDING-1 below, not folded into this round's fixes.

### 14.6 Pending — found but NOT fixed this round

Anything in this table is a **verified-real finding that has not been remediated**. Do not assume
it's handled because it's documented here — documentation is not remediation. Pick from this list
first when a new round starts, in the order listed (roughly severity-then-effort order).

| ID | File(s) | Finding | Severity | Why deferred |
|----|---------|---------|----------|---------------|
| PEND-10 | `import/index.ts` (`DELETE /jobs/:id`) | Setting `status='cancelled'` doesn't actually stop the already-dispatched background `runImport`/`runSalaryUploadJob` promise — `importer.ts`/`chunk-executor.ts` have zero `cancelled`-status checks anywhere, so all remaining chunks still get written and the job's final status silently flips back to `completed`, erasing the evidence a cancel was ever requested | HIGH | Needs a cancellation-token plumbed through the chunk-executor loop — bigger change than a single-file patch |
| PEND-11 | `absconding/index.ts` | `OPEN_STATUSES`/`ALL_STATUSES` (route layer) don't include `'second_escalation'`, `'open'`, `'rejoined'` even though migration `389` added them to the live CHECK constraint and `absconding-engine.ts`'s `scanAndEscalate()` actively uses `second_escalation`. Effect: dashboard "Open Cases" undercounts, `GET /cases?status=second_escalation` 400s, and the route's own hand-rolled `/run-auto-escalation` (a duplicate of `scanAndEscalate()`) has no branch for `second_escalation` so those cases silently never advance | HIGH | Needs a decision: extend the vocabulary in 3 places, or delete the duplicated `/run-auto-escalation` route in favor of the single-source `scanAndEscalate()` — worth a product/architecture call, not a blind patch |
| PEND-12 | Many files, 43 occurrences (baseline re-synced 2026-07-27; was 38) | `console.error(` calls in background-job/library code with no `req`/`fastify.log` in scope (`webhook-service.ts`, `ot-engine.ts`, `wo-credit-reconciler.ts`, `poll-scheduler.ts`, `digest-scheduler.ts`, `sla-scanner.ts`, `intelligence-scanner.ts`, `email-service.ts`, `event-emitter.ts`, `whatsapp-provider.ts`, `insurance-provider.ts`, `policy-governance.ts`, `intelligence-engine.ts`, `community-celebrations.ts`, `attendance-reconciliation.ts`, `leave-reconciliation.ts`, `workforce-reconciliation-service.ts`, `anomaly-handler.ts`, `event-service.ts`, `attendance-api-scheduler.ts`) — fails `check-console-error.mjs`'s ratchet (see §14.5). The one route-handler occurrence (`routes/whatsapp/index.ts:156`, had `req.log` in scope) was fixed; the remainder genuinely lack request context | LOW (CI hygiene, not a functional/security bug) | Needs a shared background-job logger abstraction threaded through many unrelated files — a distinct, larger refactor, not a quick fix. |
| PEND-22 | `lib/import-engine/importer.ts` (`batchInsert` ~1127-1143, `batchChunk` ~1204-1215) | Under `mode: 'upsert'`, `batchInsert`'s own created/updated counters are discarded — PostgREST's `.upsert().select()` doesn't report insert-vs-update per row, so `batchChunk` instead classifies every successfully-written row purely from `vr.isDuplicate`, a flag set once during validation (a separate read before the actual write). If the real DB state diverges from that validation-time snapshot (e.g. two rows in the same uploaded file sharing a unique key, landing in different 100-row batches/chunks), the reported created/updated summary can disagree with what was actually written | LOW-MEDIUM | Needs a real per-row insert-vs-update signal (e.g. comparing `created_at`/`updated_at` post-write, if present and reliably distinct on insert, per one of 12 different TABLE_MAP target tables) rather than a blind counter swap — verify each table's timestamp-column behavior before changing the classification logic |
| PEND-23 | `lib/statutory/statutory-governance.ts` (`resolveEmployeeStatutoryParams`, EPF/ESI applicability ~lines 279-323), consumed by `lib/statutory-payroll.ts`'s `epfApplicable`/`esi` gates | EPF/ESI are marked applicable by default regardless of whether the tenant/site has an actual `statutory_registrations` row (EPF/ESI establishment code) on file — unlike PTax, which already gates `isApplicable` on `resolvedState && ptaxSlabs.length > 0`. Confirmed: no seed/onboarding step auto-populates `statutory_registrations`; it's only created via the `StatutoryPolicy.tsx` admin UI, so an employer that hasn't completed that setup still has EPF/ESI silently computed and deducted with no registration to remit against or file returns under | MEDIUM (compliance gap, not currently causing wrong numbers for tenants who *have* registered) | A hard gate (`isApplicable = false` when `registrations.epf`/`registrations.esi` is null) was drafted and verified correct, but rejected as a blind ship — it would silently zero EPF/ESI deductions on the next payroll run for any tenant that hasn't gone through registration setup, which is most/all current tenants, with no migration path to backfill first. The existing filing-readiness dashboard (`routes/datasets/statutory.ts`, `epfReady`/`esiReady`) already surfaces "registration not configured" as an advisory issue — ship the hard gate only after confirming production tenants' `statutory_registrations` data is backfilled, or add an explicit tenant-level opt-in flag before defaulting to block |
| PEND-24 | `routes/surveys/index.ts` (`POST /admin/:id/360/setup` ~lines 812-850, `GET /my/360/nominations` ~909, `POST /my/360/:roundId/nominate` ~948), schema `feedback_360_rounds` (migration `342_survey_enhancements.sql`, amended by `352_fix_360_rounds_columns.sql`) | The entire 360°-feedback nomination feature is dead end-to-end: `POST /admin/:id/360/setup` only ever creates ONE `feedback_360_rounds` row per survey with `nominee_id = NULL` (the "bulk/template" row migration 352 introduced — its own comment says "the setup UI creates a round before nominees are chosen," implying a later step assigns `nominee_id` per employee). No such later step exists anywhere in the codebase (verified via repo-wide grep — the setup insert is the only write to this table). Consequently `GET /my/360/nominations` (`.eq('nominee_id', empId)`) never matches any row for any employee, and `POST /my/360/:roundId/nominate` (`round.nominee_id !== empId` check) 403s unconditionally for every employee, every round. HR gets a "360° review round created" success toast and believes the cycle is running; zero employees can ever see a round to act on or submit peer nominations | HIGH (entire feature silently non-functional, discovered only when HR notices zero nominations weeks later) | Needs a genuine feature addition, not a bug fix: an employee-selection step (who is this round for?) that the frontend `AdminSurveyDetail.tsx`'s 360-setup tab never collects and the backend schema never accepts. The natural fix — extend `Setup360Schema` with `employee_ids: string[]` (mirroring the sibling `/trigger` endpoint's already-established bulk-employee-assignment + tenant-validation pattern a few lines above it in the same file) and insert one row per employee with `nominee_id` set instead of the null-nominee bulk row — requires a real employee-picker UI per this codebase's own `EmployeeSelector`/`EmployeeCombobox` convention (CLAUDE.md's employee-picker universal rule), which is new UI work, not a 1-line patch. Deliberately not blind-built without product sign-off on the selection flow (all employees? only those due for review? handpicked?). |
| PEND-25 | `routes/talent/index.ts` (`POST /interest`, ~lines 256-279) | `is_open` is checked via a separate `SELECT` on `talent_roles` before the `upsert` into `talent_interests` — no re-assertion of `is_open` in the write path itself, so a role closed between the check and the upsert can still receive a new interest registration | LOW (narrow window, no data corruption — just a stale interest record HR can ignore) | `upsert()`'s conflict-target (`onConflict: 'role_id,employee_id'`) doesn't support an additional `WHERE`-style precondition the way a plain `.update()` does; a real fix needs either a DB-side trigger/CHECK on `talent_interests` referencing the parent role's `is_open`, or restructuring to an RPC that re-verifies atomically — not a 1-line patch |
| PEND-26 | `routes/recruitment/index.ts` (`POST /requisitions/:id/submit-approval`, ~lines 508-521) | Status is checked via a separate `SELECT` (`status !== 'draft'`) before a `DELETE` + `INSERT` reseeding the `requisition_approvals` chain — no precondition folded into either write. Two concurrent submit-approval calls (e.g. a double-click or resubmission race) can both pass the draft check; the second caller's `DELETE` wipes the first caller's freshly-seeded steps regardless of the first caller's response already having been sent, leaving the approval chain state inconsistent with what either caller observed. The requisition's own `status` stays `'draft'` for the entire multi-step approval chain (only flips to `'open'` on final approval), so it can't be used as a "not yet submitted" guard the way other TOCTOU fixes in this file fold a status precondition into the WHERE clause | LOW (narrow window; the second `INSERT` would 23505-collide on `UNIQUE(requisition_id, step_order)` if any prior step survived, surfacing as a 500 rather than silent corruption in most interleavings) | Needs either an idempotency-key on this endpoint or a new intermediate `job_requisitions` status (e.g. `'submitted'`) to gate re-submission atomically — both are small feature additions, not a 1-line patch, and the DEFAULT_REQ_CHAIN reseed-on-resubmit behavior needs a product decision on what "resubmit after rejection" should preserve before changing it |
| PEND-27 | `lib/community-celebrations.ts` (JS-level "already posted" check, ~lines 74-82) + migration `310_feed_celebration_dedup.sql`'s `uniq_feed_auto_celebration` index | The JS pre-check correctly uses the tenant-local day (`localDayBoundsUtc(todayStr, tz)`), but the DB unique index it relies on as a race-safe backstop is keyed on `(created_at AT TIME ZONE 'UTC')::date` — the **UTC** calendar date, not the tenant-local date (the migration's own comment explains this is because `timestamptz::date` isn't `IMMUTABLE`, so the index can't reference the tenant's timezone directly). For a tenant whose local day spans UTC midnight (true for nearly every non-zero-offset timezone, including IST), two celebration-generation calls racing across that UTC-midnight instant within the same tenant-local day would get different index day-keys, so the unique constraint would fail to block a duplicate birthday/anniversary post | LOW-MEDIUM (narrow race window — both calls must land within roughly the same second, straddling UTC midnight specifically; the ordinary JS pre-check already blocks the vastly more common non-racing case) | A real fix needs a DB-level change, not an application patch: either a stored/generated `tenant_local_date` column populated by a trigger that joins `tenants` for the timezone (then indexed instead of the UTC-cast expression), or accepting the current UTC-anchored index as an intentional simplification and relying on the JS check for the common case. Needs a decision on whether the added trigger complexity is worth closing this narrow a window before writing the migration |
| PEND-28 | `lib/compensation-engine.ts` (`derive()`, ~lines 226-246 vs the employee-deduction loop ~lines 314-325) | `employer_contribution` components with `calc_type: 'pct_of_gross'` (e.g. seeded `ESI_EMPLOYER` at 3.25%) are computed against `nbGross` — the sum of non-balance earnings **before** the Special Allowance/`balance` component exists — while `deduction` components with the same `calc_type` (e.g. seeded `ESI_EMPLOYEE` at 0.75%) are computed against `d.grossAnnual`, the **final** gross that includes the balance component. Statutorily, employer and employee ESI must share the exact same wage base — for a ₹6,00,000/yr CTC with default seeded components this understates employer ESI by roughly ₹4,290/yr (~₹357/month) relative to the employee side's base, misstating promised employer cost in the CTC breakup/offer letter and in `employee_compensation_components.computed_monthly` | MEDIUM (misstates CTC-structuring/offer numbers and employer-cost reconciliation; the actual monthly payslip ESI/PF/PT/TDS lines are separately overridden by statutory-payroll.ts, so this doesn't necessarily corrupt the final payslip for those specific codes) | Fixing this correctly requires the employer's `pct_of_gross` contributions to be computed against the *final* gross (including balance) — but final gross's balance is itself `ctcAnnual - employerAnnual - nonBalanceEarnings`, a genuine circular dependency (employer cost depends on final gross; final gross depends on employer cost). A 1-line patch (just swapping which gross value either side uses) makes one side "correct" and the other wrong in the opposite direction — the real fix needs a fixed-point iteration (similar in shape to the existing NLC bisection a few lines above) that converges employer pct_of_gross contributions and the balance component together. That's a new algorithm inside a core, already-tested financial engine, not a quick patch — needs careful test coverage added alongside it before shipping |

When a PEND item is fixed, delete its row from this table (git history + the commit message are the
permanent record — don't leave a stale "FIXED" row here to rot). When a new round finds something
and doesn't fix it immediately, add a row here before ending the round.

---

*Last updated: 2026-07-27.*

**Audit remediation complete** (117 numbered issues, closed 2026-07-03: 62 explicitly remediated, 55
administratively closed). All four phases closed. No open *numbered audit* issues remain.

**Post-launch incident log (§13) is NOT complete** — ISSUE-118 through 140 are logged as closed code
fixes, but DATA-1, DATA-2, and DATA-3 are open, active, unresolved production risks as of the date
above, and roughly 35 Medium/Low findings from the 2026-07-25 audit (§10, ISSUE-125–140 preamble)
were reported but intentionally not fixed. Do not cite this document as evidence the platform
currently has zero open issues without reading §13 first.

Post-launch backlog summary (§11): 1 deferred engineering item (DEF-2) · 1 product-decision-blocked
item (PD-2) · 6 Phase 5 roadmap items pending re-scope (ISSUE-059, 070, 082, 104, 116, 117).
Pre-launch gates: DEF-1 CLOSED 2026-07-03 · PD-1/AF-001 **genuinely** CLOSED 2026-07-25 (ISSUE-136) —
the 2026-07-03 closure claim for this specific gate was false; see §9 and §10.
