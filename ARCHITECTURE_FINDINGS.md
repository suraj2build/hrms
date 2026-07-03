# Architecture Findings Register
*Findings that cannot be closed by a targeted code fix alone. Each requires a product decision,
a design review, or an explicit acceptance of the architectural trade-off before implementation.*

*Security issues with a targeted fix belong in the audit remediation backlog (AUDIT_CONSTITUTION.md).
Issues here are structural — fixing a single file would address a symptom, not the root cause.*

---

## AF-001 — Employee lifecycle and authentication state are independent state machines

| Field | Value |
|---|---|
| **ID** | AF-001 |
| **Priority** | High |
| **Status** | Open |
| **Requires product decision** | Yes |
| **Discovered** | 2026-07-01 (during ISSUE-023 pre-implementation investigation) |
| **Related audit issues** | ISSUE-023 (deactivated accounts valid until JWT expiry) |

### Risk

Authentication state (`profiles.is_active`, Supabase Auth `ban_duration`) is never automatically
updated when employment state (`employees.status`) changes. A separated employee retains full
HRMS access until HR manually suspends their account through a separate workflow — which has no
enforcement, no reminder, and no audit obligation in the current product.

### Evidence

**Two independent state machines with no synchronization:**

| State machine | Field | Transitions | Controls HRMS access? |
|---|---|---|---|
| HR / employment | `employees.status` | `active → on_notice → separated` | No |
| Authentication | `profiles.is_active` + Supabase Auth `ban_duration` | Set manually via separate suspend action | Yes (after ISSUE-023 fix) |

**Code paths that set `employees.status = 'separated'` without touching auth:**

1. `apps/api/src/routes/employees/separation.ts:68-71` — POST initiates separation, sets `employees.status = 'on_notice'` or `'separated'`; no auth effect.
2. `apps/api/src/routes/employees/separation.ts:105-110` — PUT updates separation, sets `employees.status = 'separated'` when last working date passes; no auth effect.
3. `apps/api/src/routes/employees/separation-workflow.ts:770` — Relief step sets `employees.status = 'separated'`; no auth effect.
4. `apps/api/src/routes/employees/index.ts:475` — DELETE (soft) sets `employees.status = 'separated'`; no auth effect.
5. `apps/api/src/lib/absconding-engine.ts:658` — Absconding auto-separation sets `employees.status = 'separated'`; no auth effect.

**`separation.*` events are emitted but never consumed for auth:**

`event-bus.ts` defines and `separation-workflow.ts` emits `separation.relieved`, `separation.approved`,
`separation.stage.changed`, `separation.archived`. A complete search of all `eventBus.on()` calls
(`event-bus-automation.ts`, `onboarding-orchestrator.ts`) finds **zero** handlers that respond to
any separation event by touching `profiles.is_active` or calling `auth.admin.updateUserById()`.

**Two inconsistent paths for the one manual deactivation that does exist:**

| Path | Sets `profiles.is_active` | Sets Supabase Auth ban |
|---|---|---|
| `PATCH /employees/:id/user-account` (action: suspend) — `user-account.ts:339,348` | Yes | Yes (`ban_duration: '876000h'`) |
| `PUT /users/:id/status` — `analytics/index.ts:146` | Yes | **No** |

A user deactivated via the analytics route retains working refresh tokens indefinitely.

**False SOC2 compliance attestation:**

`supabase/migrations/122_compliance_controls.sql:142` records control CC6.3 as `status: 'implemented'`:
```
'Employee status=terminated triggers session revocation job. Auth.users disabled on offboarding.'
```
The session revocation job does not exist. The compliance record is inaccurate.

**No legitimate business scenario found for `employees.status = 'separated'` + `profiles.is_active = true`:**

No documentation, comment, product spec, or code path in the repository describes an intended
alumni access, post-exit document retrieval, or F&F-stage-specific access model that would
justify retaining auth access after separation. The ESS `/ess/separation` page provides
exit-tracking access during the notice/clearance/FnF stages (when `employees.status = 'on_notice'`),
not after `'separated'` is set.

### What ISSUE-023 fixes (and what it does not fix)

The ISSUE-023 remediation adds `profiles.is_active` to the auth plugin's profile lookup and
cache, so that explicitly deactivated users are blocked within one cache TTL (≤5 minutes).
This closes the symptom for users who are manually deactivated via either existing path.

**ISSUE-023 does not fix AF-001.** A separated employee who was never manually deactivated
continues to have `profiles.is_active = true` and retains full access. The fix for ISSUE-023
cannot see a separation it was never told about.

### Requires product decision before implementation

The following questions must be answered by product/HR process owners before any code is
written to synchronize the two state machines:

1. **At which lifecycle stage should HRMS access be revoked?**
   The separation FSM has seven stages: `initiated → notice_period → clearance → fnf → relieving → relieved → archived`.
   Revoking at `on_notice` would block the employee from tracking their own exit via `/ess/separation`.
   Revoking at `relieved` (final stage before archival) is the logical candidate, but requires
   confirmation that no access to F&F documents, payslips, or IT returns is needed after that point.

2. **Should revocation be immediate or scheduled?**
   Immediate revocation on `relieved` is cleanest. A scheduled grace period (e.g., 24h after
   `relieved_at`) would allow the employee to download final documents before losing access.

3. **Should revocation apply to all separation reasons equally?**
   Voluntary resignation, involuntary termination, absconding, and retirement may warrant
   different access treatment. For example, absconders arguably warrant immediate revocation
   at `on_notice`; retirees may warrant a longer grace period.

4. **Does the separation workflow assume the employee can complete self-service steps?**
   If the clearance or exit-interview stage requires the employee to submit information via
   the HRMS portal, access cannot be revoked before those steps are complete.

### Recommended implementation (pending product decision)

Once the product decision is made, the implementation should:

1. **Add a single lifecycle hook in `separation-workflow.ts`** at the confirmed revocation stage
   (likely the `relieve` action, line ~770), calling a new shared helper:
   ```typescript
   await revokeEmployeeAuth(fastify, profileId, tenantId)
   ```

2. **Implement `revokeEmployeeAuth()`** in `lib/user-account-service.ts` (new file):
   - Sets `profiles.is_active = false`
   - Calls `auth.admin.updateUserById(profileId, { ban_duration: '876000h' })`
   - Evicts the `profileCache` entry (requires exporting an eviction function from `auth.ts`)
   - Logs to `audit_logs`

3. **Apply the same helper** in `absconding-engine.ts` at the point where `employees.status`
   is set to `'separated'`, with immediate effect.

4. **Update the SOC2 compliance record** in migration 122 to reflect the actual implementation
   once it exists — or add a corrective migration that sets `status = 'partially_implemented'`
   until the fix is shipped.

5. **Unify the two manual deactivation paths:** `analytics/index.ts` (`PUT /users/:id/status`)
   must call Supabase Auth `ban_duration` alongside its `profiles.is_active` update, the same
   way `user-account.ts` does. This is a standalone one-line fix independent of this AF.

### Acceptance criteria for closing AF-001

- [ ] Product decision on revocation stage documented here.
- [ ] `revokeEmployeeAuth()` helper implemented and tested.
- [ ] Hook added at the confirmed lifecycle stage in `separation-workflow.ts`.
- [ ] Hook added in `absconding-engine.ts`.
- [ ] `analytics/index.ts` deactivation path calls Supabase Auth ban.
- [ ] `auth.ts` exports a `evictProfileCache(userId)` function.
- [ ] SOC2 control CC6.3 updated to `'implemented'` only after all above are done.
- [ ] Manual test: separate an employee through the full FSM and confirm portal access is
      blocked at the expected stage with no residual cache window.

---

*Add new architecture findings below, incrementing the AF-NNN counter.*
