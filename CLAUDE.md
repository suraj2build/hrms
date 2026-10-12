# Project memory — HRMS

## Brand: CognixHR (rebranded from "Emvora")

The product is **CognixHR**. The old name **Emvora** is retired — never use it in
any user-facing copy, title, email, marketing, or new code. If you find a stray
"Emvora"/"emvora", treat it as a bug and rename it.

- **Product name:** CognixHR (wordmark: `Cognix` + `HR`, where **HR** is rendered
  in brand teal). In JSX: `Cognix<span className="text-[#15B8A6]">HR</span>`
  (use `#2DD4BF` for HR on dark/navy backgrounds).
- **Tagline:** "Smarter Workforce. Stronger Future."
- **Descriptor:** "Saar HRMS application" (Saar = the vendor/company).
- **Logo:** `apps/web/src/components/brand/Logo.tsx` — `<Logo />` (mark + wordmark)
  and `<LogoMark />` (mark only). The mark is an open "C" ring cradling an
  H/person figure in a blue→teal gradient.
- **Brand colours:**
  - Royal blue `#2E6FE6` (exported as `BRAND_BLUE`)
  - Teal `#15B8A6` (exported as `BRAND_TEAL`; brighter `#2DD4BF` on dark)
  - Deep navy background for hero/showcase surfaces.

### Intentionally NOT renamed (functional identifiers, invisible to users)
- localStorage keys `emvora-owner-auth` (`apps/web/src/lib/supabase/ownerClient.ts`)
  and `emvora-uat-certification` (`UATCertification.tsx`) — renaming would log
  users out / drop saved state. Leave them unless doing a deliberate migration.
- The Resend test sender address `onboarding@resend.dev` (display name is
  "CognixHR"); real sender is overridden via the `EMAIL_FROM` env var.

## Supabase data fetching — UNIVERSAL RULE

**NEVER use `.limit(N)` to fetch a complete dataset from a tenant-scoped table.**
PostgREST enforces a server-side `max-rows = 1000` ceiling that silently overrides any `.limit()` value — even `.limit(200_000)` returns exactly 1,000 rows with no error and no truncation signal. This caused the entire Muster Roll to show blank attendance for all 2,877 employees despite correct data in the DB.

**Rule:** Any API endpoint that must return a complete dataset must use `fetchAllRows()`:

```ts
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const rows = await fetchAllRows((from, to) =>
  fastify.supabase
    .from('attendance_daily')
    .select('employee_id, date, status')
    .eq('tenant_id', req.tenantId)
    .gte('date', fromDate)
    .range(from, to),   // ← range replaces limit
)
```

`.limit()` is only acceptable for intentionally bounded queries (e.g. "last 5 notifications", "top 20 results") where truncation is the desired behaviour.

Tables known to exceed 1,000 rows at enterprise scale: `employees`, `attendance_daily`, `raw_punches`, `attendance_anomalies`, `payroll_records`, `audit_logs`.

---

## Employee picker / search — UNIVERSAL RULE

**NEVER use raw UUID dropdowns for employee selection.** Every field that picks an employee must use a **search-by-name-or-employee-code** pattern:
- Show a text input that filters by `employee_code` OR `first_name + last_name` (case-insensitive)
- Display results as `"EMP001 — Rahul Sharma"` (code + full name)
- Submit only the resolved `employee_id` UUID to the API
- This applies everywhere: dialogs, filters, forms, quick-actions — any place a user selects an employee

Existing reusable component: search for `EmployeeSelector` or `EmployeeCombobox` in the web app.  
If one doesn't exist or doesn't match, build a simple inline combobox that:
1. `useQuery(['employees'], () => api.get('/employees').then(r => r.data))` to load the list
2. Filters locally on `code + name` substring match
3. Renders `<Popover>` + `<Command>` from shadcn/ui

---

## Context Rail — FROZEN at RC1

`apps/web/src/components/layout/EssContextPanel.tsx`
Visibility gate: `apps/web/src/components/layout/EssShell.tsx` (`showContextRail`)

The ESS Context Rail is **feature-frozen**. Do not add new sections, cards, CTAs,
or data sources without explicit product approval.

**Visible on Pillar pages only** (experience/overview pages — not service section pages):
`/ess/attention`, `/ess/identity`, `/ess/assistant`, `/ess/company`, `/ess/flowdesk`,
`/ess/team`, `/ess/recognition`

Hidden on Home (`/ess/home` — has its own inline right column) and all Service section
pages (Leave, Attendance, Pay, Documents, Assets, etc.) — task-oriented pages don't
benefit from the rail.

**Approved sections (do not remove or restructure):**
- Approvals — managers only, directly actionable
- Birthdays & Milestones — time-sensitive, hidden when empty
- Upcoming Holidays — always a valid planning signal
- Recent Kudos — hidden when empty

**Do not re-add (explicitly removed at RC1):**
- "Recognise a teammate" CTA — promotional, not contextual
- Kudos empty state — noise, not signal

**Deferred (P2 — needs product approval before implementation):**
- Wish persistence across navigation
- Page-aware / context-sensitive rail content
- Dynamic signal cards (payslip date, expiring leave, etc.)
- Recommendation ordering logic

These will be revisited after launch, based on observed employee behavior.

---

## API error responses — UNIVERSAL RULE

**NEVER use raw `reply.code(N).send({ error: '...', message: error.message })` in API routes.**  
DB error messages (PostgREST, Supabase) contain table names, constraint names, and query details — they must never reach clients. Use the typed helpers from `apps/api/src/lib/api-errors.ts` instead.

```ts
import { serverError, notFound, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'

// 500 — DB error: the raw `error` object is logged server-side only; message is a safe string
if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')

// 404
if (!data) return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

// 403
if (!isAllowed) return forbidden(reply, 'FORBIDDEN', 'HR admin access required')

// 400 (validation)
if (!parsed.success) return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0].message)

// 409 (conflict)
return conflictError(reply, 'ALREADY_EXISTS', 'A record already exists')
```

**ErrorCode mapping by operation:**
- SELECT / GET / fetch → `ErrorCode.QUERY_FAILED`
- INSERT → `ErrorCode.INSERT_FAILED`
- UPDATE / upsert → `ErrorCode.UPDATE_FAILED`
- DELETE → `ErrorCode.DELETE_FAILED`
- Engine / computation errors → `ErrorCode.COMPUTE_FAILED`

**`serverError()` logs automatically** (structured, with requestId/tenantId/userId context). If there's a `req.log.error(...)` immediately before a `reply.code(500)`, remove the manual log — it would double-log.

**No helpers for 422 or 503** — leave those as `reply.code(422).send(...)` / `reply.code(503).send(...)`.

**CI enforces this** via `scripts/check-manual-500s.mjs` (ratchet: count of raw `reply.code(500)` may only decrease) and `scripts/check-console-error.mjs` (ratchet: console.error may only decrease).  
Update baselines after a batch conversion: `node scripts/check-manual-500s.mjs --update`.

---

## Tenant licensing — the contract HRMS depends on

**Decision (2026-08-05, closing AUDIT_FINDINGS_2026-08-03.md's F28 — see
ISSUE-195 in AUDIT_CONSTITUTION.md): HRMS is now the sole owner and writer of
its own tenant licensing state.** The previously-separate owner-portal
deployment (`cognix-owner.vercel.app`) is retired as a functional app — it no
longer writes `tenants.status`. There are exactly two writers, and both live
in this repo:

- **`apps/api/src/routes/owner/index.ts`** (`/owner/*`) — manual platform-admin
  actions (activate / suspend / cancel / issue-license / hard delete), gated by
  `fastify.authenticateOwner` against `platform_admins`. This is the
  authoritative layer.
- **`apps/api/src/routes/billing/index.ts`** (`/billing/webhook`) — automated
  Razorpay self-serve subscription events, signature-verified (see
  `BILLING.md`).

**Coordination rule, so the two writers can't race:** `/owner/tenants/:id/suspend`,
`/cancel`, and the hard `DELETE` each cancel the tenant's live Razorpay
subscription (if `razorpay_subscription_id` is set) in the same request. This
stops a delayed/retried webhook event from silently reactivating a tenant an
owner just suspended or cancelled — the manual action always wins because
there's no longer a pending subscription left to fire a future event.

This `tenants` table (`supabase/migrations/001`/`202`/`278`) has **no
product-scoping column** — verified: it is CognixHR's own table, not shared
with CogniDesk or any other product. If a second product is ever made to
share this same table, this whole section needs a rewrite before that's safe.

The contract itself is unchanged:
- **`tenants.status`** drives access: `active` / `trial` allow use;
  `suspended` / `expired` / `cancelled` block writes.
- **`tenants.trial_ends_at`** ends a `trial` once past.

Enforcement lives in `apps/api/src/plugins/auth.ts` (the write-gate): on every
authenticated **write** (POST/PUT/PATCH/DELETE) except `/billing` and
`/support`, it reads `tenants.status` + `trial_ends_at` **fresh** (not from the
profile cache) and returns **402 SUBSCRIPTION_REQUIRED** when blocked. Reads stay
open so a lapsed tenant can still reach the billing page to recover.

Rules to avoid breaking this:
- HRMS must keep gating on **`tenants.status`** — don't couple it to
  `license_expires_at` or `subscription_status`.
- Never add a third writer of `tenants.status` outside `owner/index.ts` and
  `billing/index.ts` without also updating the coordination rule above.
- A platform admin reaches `/owner/*` at this same app's own domain
  (`/owner/login`) — the old separate owner-portal domain, if it still
  resolves anywhere, should only ever show a landing page that links here,
  never a live app with its own DB credentials.

---

## Market-readiness build priorities (2026-10-11) — DONE

Source: `citykart-vs-cognixhr-comparison.md` and
`citykart-vs-cognixhr-deep-gap-analysis.md` (both on this branch, root of
repo) — a code-grounded gap analysis against a competitor retail-chain HRMS.
All 4 build-order items below are implemented, each with a migration
verified against a real Postgres 16 instance running the full migration
history and a focused test file:

1. **F&F auto-pull asset/loan recovery** — DONE. `fnf-settlement-engine.ts`
   now queries `assets` (unreturned, assigned), `employee_loans`
   (outstanding_balance), and `advance_recovery_schedules` (pending) and
   feeds the amounts into `separation_ff_summary.asset_recovery_amount` /
   `loan_recovery_amount` / `advance_recovery_amount` (migration 442); HR can
   still override any of the three.
2. **Raise leave on behalf** — DONE. `POST /leave-requests` accepts an
   optional `employee_id` override: HR admins may target any employee in
   the tenant, managers only their own direct reports
   (`isDirectReport()`); every other role has it silently ignored.
   `ApprovalInbox.tsx` has a "Raise Leave" entry point. The leave's actual
   owner can also cancel their own pending request now, not only whoever
   filed it.
3. **Probation Confirmation workflow** — DONE. New `probation_confirmations`
   table (migration 443): manager recommends confirm/extend with feedback
   (`POST /manager/team/lifecycle/confirmation-recommend`) → HR decides
   (`PATCH /probation-confirmations/:id/decide`), which sets
   `job_history.confirmation_date` on confirm or records a new due date on
   extend. New HR screen at `/admin/employees/probation-confirmations`.
4. **Public recruitment intake** — DONE. `job_requisitions.is_public`
   (migration 444, HR opt-in, separate from `status='open'`) plus
   unauthenticated `GET/POST /careers/:tenantSlug/*` routes
   (`public-careers.ts`) — tenant resolved fresh from `tenants.slug` on
   every request, same `isTenantBlocked()` check the authenticated
   write-gate uses. Public pages at `/careers/:tenantSlug` and
   `/careers/:tenantSlug/:openingId`. `AdminRecruitment.tsx` has the
   "List on careers page" toggle.

**Admin-load philosophy, stated explicitly so it isn't re-litigated per
feature:** don't add another manual queue for something that should mostly
resolve itself. Concretely: `AttendanceAnomalies.tsx` has been de-emphasized
— DONE (2026-10-11). It stays (not removed — read-only department-level
monitoring, not a per-row triage queue) but moved out of Attendance ›
Operations into Attendance › Analytics & Audit in `nav-config.ts`;
regularisation is the real correction flow and keeps its own "Approvals"
spot in Operations. The `OperationalBanner` no longer surfaces a raw
"N open anomalies" signal on every admin page — that duplicated the
regularisation signal's urgency without an actual action to take on the
anomalies page itself. The reconciliation logic (auto-resolves anomalies
the current `attendance_daily` truth already contradicts) is extracted into
`apps/api/src/lib/anomaly-reconciler.ts` and now runs on its own daily
scheduled job (`reconcile-anomalies`, registered in `index.ts` alongside
`detect-absconding`/`notice-overdue-scan`) in addition to the manual
"Reconcile Now" button — fewer anomalies ever require a human to notice
them at all, let alone triage them.

Apply the same lens to any new admin screen going forward: if a queue
exists, it should default to "only what actually needs a human," not
"everything, unfiltered" — the same principle already flagged for the HR
Admin approval-queue scope gap in `citykart-vs-cognixhr-comparison.md`
§2.7/§3.1.

Deferred, needs an explicit product scope decision before building: PMS
(performance management) and Travel Desk have zero implementation — not
started pending a decision on whether they're in scope for initial launch.

**G12 (standalone leave encashment) — decided and built (2026-10-12),
payment-status defect found and fixed in round 2, F&F-concurrency fixed and
an accounting-ledger defect found and fixed in round 3 (all 2026-10-12).**
Was in the same "deferred pending decision" bucket as PMS/Travel Desk above;
the user authorized completion. Employee-initiated request UI
(`apps/web/src/pages/ess/EssLeaveBalance.tsx`'s Encashment tab), a real
payout + TDS computation at approval time (`computeEncashmentPayout` in
`apps/api/src/lib/accrual-engine.ts` — a flat marginal-slab-rate
withholding, explicitly NOT a Section 10(10AA) exemption computation; that
needs tax/compliance sign-off before go-live).

Round 1 (migration 446) shipped `mark_leave_encashment_paid_atomic`, which
posted the payout directly into an already-persisted `payroll_slips` row
and flipped status to `'paid'` immediately. Round 2 found this was a real
defect, not just a semantic nitpick: `POST /payroll/runs` explicitly
permits deleting and recomputing every slip in a non-finalized ("draft")
run on re-run, which would silently wipe that posting while the request
kept claiming `'paid'`. Migration 447 replaces it:
`assign_leave_encashment_to_payroll_run_atomic` only records intent
(`payroll_run_id`; status stays `'approved'`) — every (re)generation of
that run's slip derives the payout fresh from `leave_encashment_requests`
(`fetchEncashmentPayout` + `applyEncashmentPayout`, `apps/api/src/routes/
payroll/runs.ts` / `lib/payroll-engine.ts`), so regeneration can no longer
lose it. Status only becomes `'paid'` once the run is actually finalized
(`fn_finalize_leave_encashments_for_run`), with a symmetric revert on
rollback (`fn_revert_leave_encashments_for_rollback`). Proven against a
real local Postgres 16 instance with the full migration history (000→447)
applying cleanly — see `scripts/db/verify-g12-encashment-atomic.mjs`.

Duplicate-payment prevention: payroll via the above; F&F via
`lib/fnf-settlement-engine.ts`'s leave-encashment calculation reading the
same `employee_leave_balance` table standalone encashment already
decrements, **plus, as of round 3, a real concurrency check** — migration
448's extension to `mark_fnf_paid_atomic`: `computeFnfSettlement` now
returns the exact `(leave_type_id, year)` pairs it read balances for
(`separation_ff_summary.leave_encashment_basis`), and `mark_fnf_paid_atomic`
re-sums exactly those rows and raises `SOURCE_DRIFT` if a standalone
encashment approval changed the balance since F&F approval — the same
pattern already proven for loan/advance/asset drift, closing the
approve→mark-paid race round 2 had identified but deliberately deferred.

Round 3 also found and fixed a real, previously-unnoticed defect in a
subsystem neither round 1 nor round 2 had examined: the accounting ledger
(`lib/payroll-accounting-engine.ts`) built every journal entry from the
employee's *standing* compensation catalog, never from the slip's actual
computed components — so `LEAVE_ENCASHMENT`/its `TDS` line (and,
pre-existing, advance/loan-EMI deductions) were silently absent from every
GL posting, and the LOP contra formula misclassified their rupee value as
"LOP recovery" instead. Fixed generally via a new `payroll_employee_
snapshots.adhoc_components` column (migration 449) and a named,
tested `computeLopAmount` helper — closing the pre-existing advance/loan-EMI
gap too, as a side effect.

Two further gaps were found this round and honestly disclosed as NOT
fixed (lower severity, operational rather than money-safety): the
statutory TDS reconciliation screen doesn't know about one-time
encashment payouts (shows a spurious variance, doesn't mispay or misfile);
and `computeEncashmentPayout`'s rate-per-day could be overstated for a
second encashment request if the first one inflated the slip it reads from.
See `docs/production-readiness/STATUS.md`'s 2026-10-12 addenda (all three
rounds) for the full writeup and what's still open.

