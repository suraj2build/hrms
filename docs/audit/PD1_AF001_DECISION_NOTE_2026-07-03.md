# CognixHR — Product Decision Note

## PD-1 / AF-001: Employee Lifecycle → Auth Revocation Policy

**Prepared by:** Engineering & Security
**Date:** 3 July 2026
**Status:** Decision required before final production launch
**Classification:** Internal

---

## 1. Decision Required

CognixHR needs a formal product policy for **when employee authentication access should be revoked during the separation lifecycle**.

### Decision to approve

**Recommended policy:**
Employees retain access during notice-period and exit workflow stages, and **authentication is revoked automatically and immediately when the employee reaches the final separated / relieved lifecycle state**.

This decision closes **PD-1 / AF-001** and allows Engineering to complete the remaining pre-launch security gate tied to offboarding access control.

---

## 2. Why this decision is required

The audit remediation program identified a lifecycle/authentication gap:

* CognixHR currently supports employee lifecycle stages such as **notice period, clearance, F&F, relieving, relieved, separated**
* A separated employee's HR lifecycle status and their authentication access are **not yet fully synchronized**
* As a result, an employee can be marked separated in the HR workflow while their auth access is not automatically revoked through the lifecycle event itself

This gap is tracked as:

* **PD-1 / AF-001 — Employee lifecycle ↔ authentication revocation sync**

It is the final launch gate tied to employee offboarding access control and SOC2 control alignment.

---

## 3. Policy options considered

### Option A — Immediate revocation at final separation state **(Recommended)**

Employees retain access during notice period and other exit workflow stages.
Authentication is revoked automatically when the employee reaches the **final offboarded state** — e.g. **separated** or **relieved** (whichever CognixHR treats as the terminal employment state).

**Pros**

* Strongest security and compliance posture
* Clear and easy to explain to customers and auditors
* No lingering access after formal separation
* Minimal operational ambiguity
* Aligns best with the intended SOC2 control language around offboarding revocation

**Cons**

* If HR marks the terminal state too early by mistake, access ends immediately

---

### Option B — End-of-day revocation on separation date

Employees may be marked separated during the day, but authentication is revoked only by an end-of-day batch process.

**Pros**

* More forgiving operationally if HR wants access to continue through the day
* Reduces risk of accidental mid-day lockout

**Cons**

* Creates a known access window after formal separation
* Weaker security/compliance position
* Harder to defend if asked whether separated employees retain access after offboarding

---

### Option C — Manual HR-triggered revocation

Lifecycle separation and authentication revocation are separate actions. HR explicitly clicks a "Deactivate access" step after processing separation.

**Pros**

* Gives HR explicit control over timing

**Cons**

* Highest risk of inconsistency and missed revocations
* Operationally fragile
* Weakest control design
* Not recommended for a production HRMS expected to support compliance-oriented customers

---

## 4. Recommendation

### Recommended product policy

**Approve Option A.**

> **Employees retain access during notice period and in-progress exit workflow stages. Authentication is revoked automatically and immediately when the employee reaches the final separated / relieved lifecycle state.**

### Why this is the recommended policy

This gives CognixHR the right balance between **employee self-service continuity during exit processing** and **clean access termination once employment is formally ended**.

It ensures:

* Employees can still use ESS during active exit stages such as:

  * notice period
  * clearance tasks
  * F&F progress tracking
  * relieving workflow steps
* Access is not left open after the employee is formally offboarded
* The control is event-driven and reliable, not dependent on manual HR follow-up
* The policy is simple enough to document, implement, test, and explain externally

---

## 5. Proposed policy statement for approval

The following statement is recommended as the official product rule:

> **CognixHR will retain employee access during active employment and in-progress separation workflow stages, including notice period, clearance, and F&F processing. Once the employee reaches the final offboarded lifecycle state — defined by CognixHR as the terminal "separated" or "relieved" status — authentication access will be revoked automatically and immediately.**

---

## 6. Engineering implementation after approval

Once Product approves the policy, Engineering can implement the control using the existing deactivation pattern already present elsewhere in the codebase.

### Implementation behavior

On transition to the approved terminal separation state:

1. Set the employee's profile to inactive

   * `profiles.is_active = false`

2. Revoke authentication access via Supabase Auth

   * `auth.admin.updateUserById(..., { ban_duration: '876000h' })`

3. Write an audit/event log entry recording:

   * employee id
   * previous lifecycle state
   * new lifecycle state
   * revocation timestamp
   * actor / system source

### Reactivation / rehire path

If the employee is reactivated or rehired through an approved workflow:

1. Set `profiles.is_active = true`
2. Remove the auth ban:

   * `ban_duration: 'none'`

---

## 7. Scope clarification

This decision **does not** change notice-period access behavior.

### Access remains available during:

* active employment
* notice period
* exit clearance workflow
* F&F processing
* any non-terminal separation stage

### Access is revoked at:

* the final terminal separation state only
  (**recommended:** `separated` or `relieved`, depending on the product's chosen terminal state definition)

---

## 8. Open point for Product confirmation

Before Engineering implements the change, Product should confirm **which lifecycle state is the canonical terminal offboarding state** for CognixHR:

* **Option 1:** `separated`
* **Option 2:** `relieved`

### Engineering recommendation

Use **the state that represents "employment formally ended and employee should no longer access the system."**

If CognixHR already treats one of these as the terminal offboarding state in the separation workflow and ESS experience, that state should become the revocation trigger.

---

## 9. Decision request

### Product approval requested

Please confirm the following:

1. **Approved policy:** Revoke access automatically at the final terminal separation state
2. **Terminal state name:** `separated` or `relieved`
3. **No manual HR confirmation step required:** Yes / No

### Engineering recommendation on all three:

* **Policy:** Yes — automatic revocation at terminal state
* **Terminal state:** whichever is the true final offboarding state in the lifecycle model
* **Manual confirmation step:** No

---

## 10. Decision outcome if approved

If Product approves the recommended policy:

* **PD-1 / AF-001** can move from **decision pending** to **implementation**
* Engineering can complete the remaining lifecycle-auth synchronization work
* The audit launch gate tied to offboarding access control can be closed
* SOC2 control **CC6.3** can move toward **implemented** once the change is deployed and verified

---

## 11. Recommendation Summary

**Recommended decision:**
Approve **automatic auth revocation at the final separated / relieved lifecycle state**, with no separate manual HR confirmation step.

**Reason:**
This preserves employee access during legitimate exit workflows while ensuring clean, immediate access termination once employment is formally ended.

**Estimated engineering effort after approval:**
**~0.5 day to 1 day** including implementation, verification, and audit log confirmation.
