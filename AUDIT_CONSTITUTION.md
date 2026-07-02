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

`employees.status` and `profiles.is_active` are **independent state machines with no automatic
synchronization.** Setting `employees.status = 'separated'` through any separation workflow does
not touch `profiles.is_active` or Supabase Auth. This is a documented architectural finding.

- Do not add synchronization logic between the two state machines in a security-fix commit.
  The correct fix requires a product decision on revocation stage. See `ARCHITECTURE_FINDINGS.md` AF-001.
- The ISSUE-023 fix (adding `is_active` to the auth plugin) addresses explicitly deactivated
  accounts; it does not address the lifecycle sync gap.
- SOC2 control CC6.3 in `supabase/migrations/122_compliance_controls.sql` claims this is
  `'implemented'` — it is not. Do not represent it as implemented in any audit response.

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
ISSUE-028 ISSUE-054 ISSUE-055 ISSUE-056 ISSUE-057 ISSUE-058 ISSUE-061 ISSUE-065
ISSUE-066 ISSUE-067 ISSUE-068 ISSUE-069 ISSUE-083 ISSUE-088 ISSUE-090 ISSUE-111
```

**Phase 5 — Enterprise Features / Roadmap**
```
ISSUE-058 ISSUE-059 ISSUE-068 ISSUE-069 ISSUE-070 ISSUE-082 ISSUE-104 ISSUE-116 ISSUE-117
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
| Notification service | `dispatch()` in `lib/notification-service.ts` is a `console.log` stub (ISSUE-009, open) |
| Job queue duality | `job-queue.ts` (in-memory, unreliable) + `durable-queue.ts` (Supabase-backed) both in use |
| Migration count | 347 as of 2026-06-30; next available number is 348 |
| `org_id` tables | 17 tables use `org_id` instead of `tenant_id` (ISSUE-065, open) |
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

---

## 11. What a Good Audit Session Looks Like

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

*Last updated: 2026-07-02. Phase 1 (Critical Security) fully closed. Phase 2 in progress: ISSUE-025, ISSUE-036, ISSUE-040, ISSUE-041, ISSUE-042A, ISSUE-044 closed. Next: ISSUE-043A (simple-limit pagination subset), then ISSUE-045 (residue assessment). ISSUE-028 (raw setInterval schedulers) remains deferred.*
