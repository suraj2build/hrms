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
| AF-001 (lifecycle sync gap) | `employees.status = 'separated'` does NOT revoke Supabase Auth tokens — the HR lifecycle and auth state machines are unsynchronised. Product decision on revocation timing is pending (PD-1). `122_compliance_controls.sql` CC6.3 set to `in_progress` until AF-001 is resolved. Do not represent this control as implemented in any audit response. |
| Job queue duality | `job-queue.ts` (in-memory, unreliable) + `durable-queue.ts` (Supabase-backed) both in use |
| Migration count | 350 as of 2026-07-03; next available number is 351 |
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

*Last updated: 2026-07-03. All four remediation phases are closed. The active post-remediation backlog consists of: 2 implementation-ready engineering items (DEF-1 letter sanitization; DEF-2 reimbursements/my pagination); 2 product-decision-blocked engineering items (PD-1 AF-001 lifecycle/auth revocation; PD-2 helpdesk pagination semantics); 6 Phase 5 roadmap items pending re-scoping (ISSUE-059, 070, 082, 104, 116, 117). 55 legacy issue IDs are administratively closed because their original descriptions were not preserved in a durable artifact and no independently actionable scope remains.*
