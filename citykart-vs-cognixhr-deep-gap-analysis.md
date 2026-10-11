# CognixHR vs. Citykart — Deep Market-Readiness Gap Analysis

**Purpose:** A code-grounded depth pass (not a nav/surface review) across Recruitment,
Absconding/Exit/Clearance/F&F, Leave & Regularisation, Onboarding, Performance Management,
and Travel Desk — the specific areas flagged as needing real investigation beyond
[`citykart-vs-cognixhr-comparison.md`](./citykart-vs-cognixhr-comparison.md). Every claim
below is sourced from an agent that read actual route handlers, DB schema, and UI
components — not file names or nav labels. File:line citations are preserved from that
investigation.

**How to read this:** Three categories, in order of how they should weigh on go-live
decisions: (1) total structural gaps — nothing exists, or what exists is a stub with no
real workflow behind it; (2) partial gaps — real functionality with one or two
consequential holes; (3) where CognixHR is already ahead or at parity, stated plainly so
this isn't read as "everything is behind."

---

## 1. Total / structural gaps

### 1.1 Travel Desk — nothing exists
Confirmed by direct search (not an agent — zero hits across the repo for
travel-desk/tour-request/travel-expense/per-diem in any form). Citykart has a full Tour &
Travel Management module (Self/Team/Employee scope, tour request lifecycle with
Processing/Approved/Rejected/Cancelled states). CognixHR has no equivalent at any level —
no request type, no schema, no UI. If any customer segment travels for work (area
managers, auditors, regional ops), this is a flat-out missing capability, not a thin one.

### 1.2 Performance Management (PMS) — effectively nothing exists
Confirmed directly: the only "performance" feature is
`apps/web/src/pages/dashboard/ManagerTeamPerformance.tsx` — purely attendance-derived
(attendance rate, punctuality, avg daily hours → an auto-computed "Excellent/Good/
Average/Needs Attention" tier). No goals, no KRA/KPI, no competency self-rating, no
manager narrative feedback, no review cycle, no team rollup. Citykart has a real
Balanced-Scorecard-style PMS (My Goals, Self Rate Competencies, Manager Feedbacks, Manager
Recommendations, Appraisal Summary, plus a mirrored Team view). This is a structural
absence — what exists is attendance analytics wearing a "performance" label, not a
thinner PMS.

### 1.3 PIP (Performance Improvement Plan) — confirmed total gap
Zero matches anywhere in the repo for PIP/performance_improvement/improvement_plan. The
absconding engine's warning-letter sequence (WL1/WL2) only covers attendance-based
absconding, not a formal underperformance track with goals, checkpoints, and manager
sign-off over a defined period. Citykart has a dedicated sidebar item for this.

### 1.4 Probation Confirmation — no workflow, just a field and a notification
CognixHR has the raw ingredients — `job_history.confirmation_date`, a manager-facing
overdue bucket (`team-lifecycle.ts:115-150`, `ExpiryManagement.tsx:28-78`) — but **no
confirm/extend decision exists anywhere in the codebase.** The only action is
`POST /manager/team/lifecycle/confirmation-recommend`, which just fires a generic HR-inbox
notification with a free-text note. HR must manually create a new `job_history` row to
actually set `confirmation_date`, with no structured link to the original due date, no
captured manager feedback, and no status lifecycle (Citykart: tabs by state — Manager
Feedback Pending / Extended / Closed — with an OVERDUE badge). This is a real workflow in
Citykart and a notification stub sitting on a date column in CognixHR.

### 1.5 No public/candidate-facing recruitment intake
The recruitment backend is far deeper than it looks from file names — a genuine
requisition → approval-chain → opening → candidate → interview (with interviewer
calibration analytics) → offer → hire pipeline exists end to end
(`apps/api/src/routes/recruitment/index.ts`, 2,668 lines; schema across migrations 240,
246, 297). But **every candidate/application-creation route is `hrAdminAuth`-gated** —
there is no careers page and no public apply form anywhere in the repo. `CandidatePortal.tsx`
only lets an already-sourced candidate check status and accept/decline an offer; it cannot
submit a new application. `job_board_postings` is a manually-logged link table with no
inbound webhook to auto-create candidates from a real job-board application. **A customer
cannot run live hiring through CognixHR today** — they can only use it to track and move
candidates someone already sourced through a different channel (email, a job board's own
site, a recruiter), then hand off to the (genuinely good) preboarding flow once hired.

### 1.6 "Raise leave on behalf" — missing
Both leave-submission API paths resolve `employee_id` strictly from the caller's own
session — no HR/manager override parameter exists to file leave for someone else.
Citykart has this explicitly ("+ Raise Leave on behalf"). For retail/ops staff without
reliable personal device/ESS access, this is an operational blocker, not a nice-to-have —
confirmed as the top go-live risk by the leave/regularisation investigation.

### 1.7 Leave Grant (ad-hoc credit) — no purpose-built tool
No dedicated "Grant Leave" action (Employee / Leave Type / Granted Leaves / Month / Granted
By) exists. The closest tools are `PUT /attendance/leave/balance` and
`POST /attendance/leave/opening-balance` — both overwrite-the-absolute-balance semantics,
not an additive, auditable grant event. A separate rule-triggered "event grant" engine
exists for milestone-based credits, but nothing for a one-off HR goodwill/compensatory
grant. Employees would see a balance jump with no "granted leave" line explaining why.

### 1.8 Budget Seat Master — no pre-approval headcount-budget gate
Citykart requires a budgeted-seat check before a requisition can even be raised. CognixHR's
requisition approval chain (Reporting Manager → HR Head → Finance Head) is generic — no
headcount-budget-vs-actual check gates it.

---

## 2. Partial gaps — real functionality, consequential holes

### 2.1 F&F doesn't auto-pull asset-recovery or loan-recovery deductions
`fnf-settlement-engine.ts` auto-computes gratuity, leave encashment, and notice-period
shortfall from live data — genuinely good. But `last_payroll_amount`, `other_additions`,
and `other_deductions` are explicitly manual pass-through fields (lines 33-35, 219-221).
There is no query against outstanding assets or loan balances feeding F&F automatically,
despite the separation/clearance flow already knowing an employee holds unreturned assets.
**For a retail chain with high absconding volume** (uniforms, POS devices, cash-handling
shortages, staff loans), this is exactly the money-recovery step that matters most at exit
— today it's a manual line HR must remember to fill in per case. Flagged by the
absconding/exit agent as the single most consequential gap in that whole area.

### 2.2 Leave encashment approval doesn't auto-post to payroll
`mark-paid` only flips a status flag (`leave-accrual.ts:386-400`) — HR must separately
create the actual payroll line item. Risk of "encashment approved" and "actually paid"
silently desyncing. (Note: F&F-time encashment, by contrast, is properly automated — this
gap is specific to in-service encashment.)

### 2.3 Comp-off has no separate ledger-vs-balance view
An audit trail exists underneath (`comp_off_requests` + `leave_accrual_ledger` with
expiry), but there's no standalone "Comp Off Register" (every earn/use transaction) split
from "Comp Off Balances" (current usable number) the way Citykart presents them as two
distinct screens — comp-off balance is just another row in the general leave-balance view.

### 2.4 Clearance has no cross-employee worklist view
The underlying clearance model is genuinely solid — real multi-department sign-off
(`separation_clearances`, configurable department list, IT clearance correctly blocked
while assets are outstanding, manager-ownership-scoped actioning) — better business logic
than Citykart's in places. But it's single-employee-at-a-time; there's no
Pending/Processing/Completed cross-tenant table the way Citykart's "No Dues" list works,
so HR can't see at a glance how many exits are stuck and where.

### 2.5 Absconding → separation is automatic; separation → clearance checklist init is not
`processTermination()` auto-creates the separation record and flags F&F as pending in the
same transaction when a case is escalated to termination — genuinely good, real code-level
linkage, not a documentation convention. But the clearance department checklist itself
still requires a manual `POST /employees/:id/separation-clearances` call to initialize —
one manual handoff remains in an otherwise-automated chain.

### 2.6 No EWD-equivalent (elect to work extended hours instead of taking leave)
`wfh` and `field_work` exist only as regularisation reason codes (retroactively excusing a
missed punch), not as a forward-looking request type. Minor relative to the above, included
for completeness since it was explicitly asked about.

### 2.7 Recruitment's funnel/reporting is thinner than Citykart's named-stage breakdown
The dashboard funnel has ~5 generic statuses vs. Citykart's 10 named stages (incl.
Negotiation, On Hold, Offer Rejected as distinct, trackable states), and there's no
standalone exportable "Reports" surface — reporting is folded into the dashboard plus a
separate (actually more sophisticated) interviewer-calibration analytics page. Lower
priority than 1.5 above, but worth knowing: even once a public intake route plus this exist, the pipeline's own stage granularity will still read as leaner than Citykart's.

---

## 3. Where CognixHR is already ahead or at parity — stated plainly

- **Absconding detection is fully automated** — a daily scheduled scan with a real
  escalation state machine (flagged → warning letters → termination-pending → CHRO
  approval), auto-closing cases that self-resolve. Citykart's review didn't even confirm
  whether its absconding list is automatic or manually maintained.
- **Half-day leave granularity exceeds Citykart** — CognixHR supports
  full_day/first_half/second_half/**hourly** with 0.25h increments and cross-day sessions;
  Citykart only has First/Second half.
- **Leave policy engine is genuinely rich** — 9 standard India leave types pre-seeded,
  configurable accrual frequency (monthly/quarterly/yearly/on-joining), pro-ration,
  carry-forward with expiry, and per-type encashability caps — comparable or deeper than
  what the Citykart review surfaced.
- **Regularisation is deeper** — 8 named reason codes, configurable per-period caps,
  SLA auto-breach — arguably ahead of Citykart's equivalent.
- **Period lock/freeze is real and enforced in two layers** (app-level guard + DB trigger),
  correctly gating leave approval and comp-off generation against a locked payroll period.
- **The pre-join candidate portal is strong** — a genuine tokenized, no-login public
  portal with AI-assisted document extraction, cross-document identity verification, and a
  closed-loop HR-flags-a-document → candidate-re-uploads cycle. This is more rigorous than
  what the Citykart review described for its equivalent step.
- **Clearance's business logic (asset-blocking, ownership-scoped actions) and the
  separation→F&F auto-flagging are real engineering, not surface-level** — the gaps
  identified above (§2.1, §2.4, §2.5) are refinements on a solid foundation, not signs the
  foundation is weak.

---

## 4. If you had to pick a go-live priority order

Highest-impact, most "a real customer will hit this in week one" items first:

1. **F&F asset/loan auto-deduction (§2.1)** — direct money-leakage risk at scale, and the
   data to fix it (outstanding assets, loan balances) already exists elsewhere in the
   system; this is a wiring job, not new infrastructure.
2. **"Raise leave on behalf" (§1.6)** — blocks real retail/ops usage patterns, not an edge
   case.
3. **Probation Confirmation workflow (§1.4)** — every employee crosses this; right now
   it's invisible process risk (confirmations silently never happening) rather than a
   missing nice-to-have.
4. **Public recruitment intake (§1.5)** — biggest absolute scope gap, but lower urgency
   than 1-3 if early customers source candidates through their own channels anyway; becomes
   urgent the moment a customer wants self-serve hiring.
5. **PMS and Travel Desk (§1.2, §1.1)** — the two actual "build it from scratch" items.
   Whether these matter depends entirely on which customer segment is being sold to —
   worth a product conversation about whether they're in scope for initial launch at all,
   or explicitly out of scope (same kind of explicit-disable decision already made for
   standalone leave encashment / G12).
6. Everything in §2.2-2.7 — real but lower-urgency refinements.

PIP (§1.3) and Leave Grant (§1.7) and Budget Seat Master (§1.8) are genuine gaps but lower
urgency unless a specific customer names them as a requirement.
