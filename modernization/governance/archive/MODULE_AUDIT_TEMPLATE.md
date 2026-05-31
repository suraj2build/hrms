# MODULE AUDIT TEMPLATE
## Enterprise HRMS — Mandatory Pre-Modernization Audit Framework

**Template Version:** 1.0  
**Date:** 2026-05-11  
**Classification:** Mandatory Execution Artifact — Complete Before Any Modernization Work  
**Governed By:**
- `MASTER_MODERNIZATION_PLAN.md` — Strategic principles and module priority
- `MODERNIZATION_EXECUTION_FRAMEWORK.md` — Phase lifecycle, gate criteria, and audit methodology

---

## AUDITOR INSTRUCTIONS

This template is the mandatory instrument for conducting a Phase 1 (Audit) investigation on any HRMS module entering active modernization. It must be completed in full before the Phase 1 → Phase 2 gate review.

**Completion rules:**
- Every section must be completed. Mark fields `N/A — [reason]` if genuinely not applicable. Do not leave fields blank.
- Every finding must be based on direct observation: code reading, database inspection, screen interaction, or operator interview. Do not estimate or assume.
- Every operator interview answer must be attributed to a role (not a name). Record role, frequency of use, and interview date.
- Findings marked `[CRITICAL]` must be reviewed by the Architecture Lead before Phase 2 begins.
- The Audit Report is a factual document, not a design document. Do not propose solutions within audit sections. The Audit Summary (Section 10) is the only section that permits forward-looking assessment.

**Audit governance:**
- Estimated audit duration: 5–15 working days depending on module complexity
- Minimum required workstreams: all 8 (Sections 2–9)
- Workstreams may proceed in parallel but all must complete before the Audit Summary is written
- Architecture Lead review is mandatory before the Phase 1 gate is approved

---

## AUDIT IDENTIFICATION

| Field | Value |
|---|---|
| **Module Under Audit** | `[Module Name]` |
| **Audit Reference ID** | `AUDIT-[MODULE-ABBREV]-[YYYY-MM]` |
| **Audit Start Date** | `[Date]` |
| **Audit Completion Date** | `[Date]` |
| **Lead Auditor** | `[Name, Role]` |
| **Supporting Auditors** | `[Names, Roles]` |
| **Operations Liaison** | `[Role — the operator representative who validated workflow findings]` |
| **Architecture Reviewer** | `[Name]` |
| **Module Priority Rank** | `[Priority N of 7 per MASTER_MODERNIZATION_PLAN.md]` |
| **Audit Status** | `[ ] In Progress  [ ] Complete  [ ] Gate Review Pending  [ ] Gate Approved` |

---

## TABLE OF CONTENTS

1. [Module Identity and Operational Context](#section-1)
2. [Operational Analysis](#section-2)
3. [Workflow Analysis](#section-3)
4. [Reconciliation Analysis](#section-4)
5. [Runtime Stability Analysis](#section-5)
6. [Technical Debt Analysis](#section-6)
7. [UX Workflow Analysis](#section-7)
8. [Data Integrity Analysis](#section-8)
9. [Intelligence Opportunity Analysis](#section-9)
10. [Audit Summary and Phase Gate Recommendation](#section-10)

---

<a name="section-1"></a>
## SECTION 1 — MODULE IDENTITY AND OPERATIONAL CONTEXT

> **Purpose:** Establish the precise operational scope of this module before deeper analysis begins. Every subsequent section must be interpreted within this context.

---

### 1.1 Module Definition

**Module name (as known in the codebase):**
```
[e.g., payroll, attendance, employee-master]
```

**Module name (as known to operators):**
```
[e.g., "Payroll Processing", "Attendance Management", "Employee Records"]
```

**Module's core operational purpose (1–3 sentences):**
```
[What does this module exist to do? State the business function, not the technical function.
Example: "This module processes monthly payroll for all active employees, computing gross-to-net
salary based on attendance records, statutory rules, and configured pay components, and produces
the payslip, disbursement file, and statutory liability reports."]
```

**Where this module sits in the operational sequence:**
```
[Describe what feeds into this module and what this module feeds into.
Example: "Receives input from Attendance (processed attendance records) and Employee Master
(salary structures, deductions). Outputs to Compliance (statutory liabilities) and Finance
(disbursement files)."]
```

---

### 1.2 Primary User Roles

List every role that interacts with this module in any capacity.

| Role | Interaction Type | Estimated Daily Interactions | Criticality |
|---|---|---|---|
| `[e.g., Payroll Manager]` | `[Primary operator / approver / viewer / data entry]` | `[e.g., 50–200 actions/day]` | `[High / Medium / Low]` |
| `[Role]` | `[Type]` | `[Volume]` | `[Criticality]` |
| `[Role]` | `[Type]` | `[Volume]` | `[Criticality]` |
| `[Role]` | `[Type]` | `[Volume]` | `[Criticality]` |

**Highest-criticality role (the operator this module must serve first):**
```
[Role name and justification]
```

---

### 1.3 Operational Calendar

Document when this module is most actively used and what operational events drive usage peaks.

| Event | Frequency | Typical Window | Operator Load |
|---|---|---|---|
| `[e.g., Monthly payroll run]` | `[Monthly]` | `[25th–28th of each month]` | `[High — all payroll staff]` |
| `[e.g., Daily attendance sync]` | `[Daily]` | `[6:00 AM – 9:00 AM]` | `[Medium — automated + exceptions]` |
| `[e.g., Statutory filing]` | `[Quarterly]` | `[First 7 days of quarter]` | `[High — compliance team]` |
| `[Event]` | `[Frequency]` | `[Window]` | `[Load]` |

**Deployment freeze windows** (times when no deployment may occur to this module):
```
[Based on operational calendar above — populate Section 9.3 of MODERNIZATION_EXECUTION_FRAMEWORK.md]
```

---

### 1.4 Module Boundaries

**Codebase location(s) of this module:**
```
[List all directories, files, and packages that belong to this module.
Be precise — do not mark "approximately here" or "around this folder".]

Frontend:
  apps/web/src/[path]
  apps/web/src/[path]

Backend:
  [service/module path]
  [service/module path]

Database schemas/tables (owned):
  [schema.table_name]
  [schema.table_name]

Shared packages used (but not owned):
  [@package/name]
```

**What this module explicitly does NOT own:**
```
[e.g., "Does not own employee master records — reads from employee domain via API.
Does not own leave balances — reads leave approved status from Leave module."]
```

---

<a name="section-2"></a>
## SECTION 2 — OPERATIONAL ANALYSIS

> **Purpose:** Document what the module does operationally in complete, factual detail. This is the master inventory of all functions, processes, and capabilities. Findings here drive scope for all subsequent sections.

---

### 2.1 Function Inventory

List every discrete function this module performs. A function is a named operation the module can execute — not a screen, not a button. Functions map to operator tasks.

| Function ID | Function Name | Description | Primary Operator Role | Frequency |
|---|---|---|---|---|
| `F-001` | `[e.g., Initiate Payroll Run]` | `[What it does, what it produces]` | `[Role]` | `[Daily / Weekly / Monthly / Ad hoc]` |
| `F-002` | `[Function]` | `[Description]` | `[Role]` | `[Frequency]` |
| `F-003` | `[Function]` | `[Description]` | `[Role]` | `[Frequency]` |
| `F-004` | `[Function]` | `[Description]` | `[Role]` | `[Frequency]` |
| `F-005` | `[Function]` | `[Description]` | `[Role]` | `[Frequency]` |
| `[Continue for all functions]` | | | | |

**Total function count:** `[N]`

---

### 2.2 Calculation Inventory

List every calculation this module performs. A calculation is any place where input data is transformed into a derived result.

| Calc ID | Calculation Name | Inputs | Formula / Rule | Statutory Basis | Verified in Code |
|---|---|---|---|---|---|
| `C-001` | `[e.g., Basic Salary Proration]` | `[Monthly salary, working days, present days]` | `[Salary / working_days × present_days]` | `[None / Section X of Act Y]` | `[ ] Yes  [ ] No` |
| `C-002` | `[e.g., PF Employer Contribution]` | `[Basic salary]` | `[12% of basic, capped at ₹15,000]` | `[EPF Act 1952]` | `[ ] Yes  [ ] No` |
| `C-003` | `[Calculation]` | `[Inputs]` | `[Formula]` | `[Basis]` | `[ ] Yes  [ ] No` |
| `[Continue for all calculations]` | | | | | |

**Calculations with unverified formulas (no test, no documentation):** `[Count]`

> `[CRITICAL]` Any calculation marked `No` in the `Verified in Code` column is an unverified calculation. These are mandatory P0 targets for Phase 2 Stabilization.

---

### 2.3 Integration Inventory

Document every system this module exchanges data with, both inbound and outbound.

#### Inbound Integrations (data this module receives)

| Integration ID | Source | Data Type | Transfer Method | Frequency | Failure Handling |
|---|---|---|---|---|---|
| `I-IN-001` | `[e.g., Biometric Device]` | `[Punch records]` | `[API push / SFTP / DB sync]` | `[Real-time / Hourly / Daily]` | `[Describe what happens when source fails]` |
| `I-IN-002` | `[e.g., Employee Master]` | `[Salary structures]` | `[API call]` | `[On payroll run]` | `[Describe]` |
| `[Continue]` | | | | | |

#### Outbound Integrations (data this module sends)

| Integration ID | Destination | Data Type | Transfer Method | Frequency | Failure Handling |
|---|---|---|---|---|---|
| `I-OUT-001` | `[e.g., Compliance Module]` | `[Statutory liabilities]` | `[Event / API]` | `[Post payroll run]` | `[Describe what happens when destination fails]` |
| `I-OUT-002` | `[e.g., Bank / Disbursement]` | `[Payment file]` | `[SFTP]` | `[Monthly]` | `[Describe]` |
| `[Continue]` | | | | | |

**Undocumented integrations discovered during code reading:**
```
[List any integrations found in code that were not previously documented.
These are high-risk — they represent coupling that the team was unaware of.]
```

---

### 2.4 Output Inventory

List every artifact this module produces as an output.

| Output ID | Output Name | Format | Consumer | Downstream Dependency |
|---|---|---|---|---|
| `O-001` | `[e.g., Payslip]` | `[PDF + DB record]` | `[Employee via ESS]` | `[ESS, Finance archive]` |
| `O-002` | `[e.g., PF Challan]` | `[Excel + PDF]` | `[Compliance Officer]` | `[EPFO filing]` |
| `O-003` | `[e.g., Salary Register]` | `[Excel + on-screen]` | `[HR Manager]` | `[Internal record]` |
| `[Continue]` | | | | |

**Outputs with no downstream verification mechanism** (i.e., no system confirms the output was received or used correctly):
```
[List outputs — these are reconciliation gaps by definition]
```

---

<a name="section-3"></a>
## SECTION 3 — WORKFLOW ANALYSIS

> **Purpose:** Map every operational workflow in this module to full operational depth. A workflow is a sequence of human and system actions with a defined start state, decision points, actor transitions, and end state. This section is the most operationally important section of the audit.

---

### 3.1 Workflow Inventory

List every workflow this module contains. Distinguish primary workflows (the core operational purpose of the module) from secondary workflows (supporting operations, exception handling, configuration).

| WF ID | Workflow Name | Type | Primary Actor | Trigger | End State |
|---|---|---|---|---|---|
| `WF-001` | `[e.g., Monthly Payroll Run]` | `[Primary]` | `[Payroll Manager]` | `[Manual initiation on pay date]` | `[Payroll processed and disbursement file generated]` |
| `WF-002` | `[e.g., Payroll Hold / Release]` | `[Secondary]` | `[Payroll Manager]` | `[Manual — exception case]` | `[Employee held or released from current run]` |
| `WF-003` | `[Workflow]` | `[Type]` | `[Actor]` | `[Trigger]` | `[End State]` |
| `[Continue for all workflows]` | | | | | |

**Total workflow count:** `[N]` primary, `[N]` secondary

---

### 3.2 Primary Workflow Detail

Complete the following for **every primary workflow**. For modules with many workflows, every primary workflow gets its own subsection (3.2.1, 3.2.2, etc.).

---

#### Workflow: `[WF-ID] — [Workflow Name]`

**Operational purpose:**
```
[Why does this workflow exist? What business problem does it solve?]
```

**Pre-conditions (what must be true before this workflow can begin):**
```
1. [Pre-condition — e.g., "Attendance for the period must be marked as reconciled"]
2. [Pre-condition — e.g., "Payroll period must be open"]
3. [Pre-condition]
```

**Trigger:**
```
[What starts this workflow? Manual action by operator? Scheduled job? Event from another module?]
```

**Step-by-Step Sequence:**

| Step # | Step Name | Actor | System Action | Human Decision Required | Output / State Change |
|---|---|---|---|---|---|
| 1 | `[Step name]` | `[Human role / System]` | `[What the system does at this step]` | `[ ] Yes  [ ] No — [If yes: what decision?]` | `[What changes after this step]` |
| 2 | `[Step name]` | `[Actor]` | `[System action]` | `[ ] Yes  [ ] No` | `[Output]` |
| 3 | `[Step name]` | `[Actor]` | `[System action]` | `[ ] Yes  [ ] No` | `[Output]` |
| 4 | `[Step name]` | `[Actor]` | `[System action]` | `[ ] Yes  [ ] No` | `[Output]` |
| `[Continue]` | | | | | |

**Decision points** (steps where the workflow branches based on a condition or human judgment):

| Decision Point | Condition | Branch A | Branch B |
|---|---|---|---|
| `[Step #]` | `[Condition that triggers branching]` | `[What happens if condition is true]` | `[What happens if condition is false]` |
| `[Step #]` | `[Condition]` | `[Branch A]` | `[Branch B]` |

**Approval gates** (steps that require a named authorization before proceeding):

| Gate | Who Authorizes | What They Authorize | What Happens if Denied |
|---|---|---|---|
| `[Step #]` | `[Role]` | `[What they are approving]` | `[Rejection path]` |

**Error / exception paths** (what happens when something goes wrong at each major step):

| At Step | Failure Mode | Current System Behavior | Gap / Risk |
|---|---|---|---|
| `[Step #]` | `[What can go wrong]` | `[What the system currently does]` | `[Is the behavior adequate? If not, what is the risk?]` |
| `[Step #]` | `[Failure mode]` | `[Current behavior]` | `[Gap / Risk]` |

**Post-conditions (what must be true after this workflow completes successfully):**
```
1. [Post-condition — e.g., "Payslip generated for every active employee in scope"]
2. [Post-condition — e.g., "PF and ESI liabilities recorded for the period"]
3. [Post-condition]
```

**Operator-reported pain points** (from interviews — verbatim where possible):
```
[Role]: "[Pain point quote]"
[Role]: "[Pain point quote]"
```

**Workarounds operators have developed:**
```
[Describe any workaround the operator uses to compensate for a system limitation.
These represent undocumented requirements and often mask bugs or design gaps.]
```

**Workflow integrity assessment:**

| Dimension | Finding | Severity |
|---|---|---|
| Steps clearly sequenced? | `[ ] Yes  [ ] Partially  [ ] No` | `[None / Low / Medium / High]` |
| All branches handled? | `[ ] Yes  [ ] Partially  [ ] No` | `[None / Low / Medium / High]` |
| Approval gates enforced by system? | `[ ] Yes  [ ] Partially  [ ] No` | `[None / Low / Medium / High]` |
| Error paths handled and surfaced? | `[ ] Yes  [ ] Partially  [ ] No` | `[None / Low / Medium / High]` |
| Audit trail emitted at key steps? | `[ ] Yes  [ ] Partially  [ ] No` | `[None / Low / Medium / High]` |
| Rollback / undo available if needed? | `[ ] Yes  [ ] No  [ ] N/A` | `[None / Low / Medium / High]` |

---

### 3.3 Undocumented Workflow Discovery

Workflows discovered during operator interviews or code reading that are not formally documented anywhere:

| WF ID | Workflow Description | Discovered Via | Operational Impact |
|---|---|---|---|
| `WF-UND-001` | `[Describe the undocumented workflow]` | `[Code review / Operator interview / Observation]` | `[What breaks if this workflow is disrupted?]` |
| `WF-UND-002` | `[Description]` | `[Source]` | `[Impact]` |

> `[CRITICAL]` Undocumented workflows are high-risk. They represent operator knowledge that will be lost if the operator leaves and operational logic that is invisible to engineering. Every undocumented workflow must be formally documented before Phase 2 begins.

---

### 3.4 Cross-Module Workflow Dependencies

Workflows in this module that depend on the state or output of another module:

| This Workflow | Depends On | From Module | Dependency Type | Risk if Dependency Breaks |
|---|---|---|---|---|
| `[WF-ID]` | `[e.g., Reconciled attendance records]` | `[Attendance]` | `[Data input / State prerequisite / Event trigger]` | `[e.g., Payroll cannot run; must be held until attendance is reconciled]` |
| `[WF-ID]` | `[Dependency]` | `[Module]` | `[Type]` | `[Risk]` |

---

<a name="section-4"></a>
## SECTION 4 — RECONCILIATION ANALYSIS

> **Purpose:** Identify every place where data is compared, verified, or reconciled within this module. Assess the completeness of reconciliation mechanisms and identify gaps where reconciliation should exist but does not. Per MASTER_MODERNIZATION_PLAN.md, reconciliation-first design is non-negotiable.

---

### 4.1 Reconciliation Surface Inventory

List every reconciliation activity this module is responsible for.

| Rec ID | Reconciliation Name | What Is Compared | Expected Source | Actual Source | Discrepancy Action |
|---|---|---|---|---|---|
| `R-001` | `[e.g., Attendance vs. Payroll Input]` | `[Expected days from shift roster vs. actual days used in payroll]` | `[Attendance module records]` | `[Payroll input snapshot]` | `[Exception queue for operator review]` |
| `R-002` | `[e.g., Upload vs. Existing Records]` | `[Uploaded salary revisions vs. current salary records]` | `[Upload file]` | `[Employee salary table]` | `[Diff view, operator approval required]` |
| `R-003` | `[Reconciliation]` | `[What vs. what]` | `[Source A]` | `[Source B]` | `[Discrepancy action]` |
| `[Continue]` | | | | | |

---

### 4.2 Reconciliation Mechanism Assessment

For each reconciliation identified above, assess the quality of the current reconciliation mechanism.

| Rec ID | Diff View Available | Exception Queue Exists | Operator Decision Required | Audit Trail on Decision | Assessment |
|---|---|---|---|---|---|
| `R-001` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[Adequate / Partial / Missing]` |
| `R-002` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[Adequate / Partial / Missing]` |
| `R-003` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[Adequate / Partial / Missing]` |

**Reconciliations rated `Missing`:** `[Count]`  
**Reconciliations rated `Partial`:** `[Count]`

> `[CRITICAL]` Any reconciliation rated `Missing` for a payroll, compliance, or statutory data flow is a P0 stabilization target.

---

### 4.3 Reconciliation Gap Analysis

Locations where reconciliation should exist but currently does not:

| Gap ID | Where the Gap Exists | What Should Be Reconciled | Operational Risk of Gap |
|---|---|---|---|
| `RG-001` | `[e.g., Post-disbursement]` | `[Disbursement confirmation vs. payroll run amounts]` | `[Underpayments or overpayments go undetected until the next cycle]` |
| `RG-002` | `[Location]` | `[What vs. what]` | `[Risk]` |
| `[Continue]` | | | | |

---

### 4.4 Input Manifest Assessment

For each computed output in Section 2.4, assess whether the system records a full input manifest (what data was used to produce the output).

| Output ID | Output Name | Input Manifest Recorded | What Is Captured | Gap |
|---|---|---|---|---|
| `O-001` | `[Payslip]` | `[ ] Full  [ ] Partial  [ ] None` | `[e.g., Payroll run ID, attendance snapshot, policy versions applied]` | `[What is missing from the manifest]` |
| `O-002` | `[Output]` | `[ ] Full  [ ] Partial  [ ] None` | `[What is captured]` | `[Gap]` |

**Outputs with no input manifest:** `[Count]`

> `[CRITICAL]` Any computed output with no input manifest cannot be audited or re-derived. This is a data architecture defect and a P0 stabilization target for any payroll, compliance, or statutory output.

---

### 4.5 Reconciliation UX Assessment

Evaluate whether the current UX supports reconciliation effectively.

| UX Element | Exists | Adequate for Operation | Gap Description |
|---|---|---|---|
| Diff view (expected vs. actual) | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Exception queue for unresolved discrepancies | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Bulk approve / reject on exception queue | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Audit trail visible from reconciliation screen | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Export of exception list for offline review | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Reconciliation status indicator (pending / clear) | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Summary of discrepancy volume and category | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |

---

<a name="section-5"></a>
## SECTION 5 — RUNTIME STABILITY ANALYSIS

> **Purpose:** Assess the module's real-world reliability in production. Stability must be established before any enhancement or optimization work begins. This section must be based on measured data — not estimates.

---

### 5.1 Performance Baseline

Measure current performance. These are the baseline values that Phase 3 optimization will improve against.

**Measurement period:** `[Date range of measurements]`  
**Measurement method:** `[APM tool / Database query / Log analysis / Manual timing]`

#### API Performance

| Endpoint | Method | P50 (ms) | P95 (ms) | P99 (ms) | Target P99 (ms) | Status |
|---|---|---|---|---|---|---|
| `[/api/module/endpoint]` | `[GET/POST]` | `[N]` | `[N]` | `[N]` | `[500]` | `[ ] Pass  [ ] Fail` |
| `[/api/module/endpoint]` | `[Method]` | `[N]` | `[N]` | `[N]` | `[500]` | `[ ] Pass  [ ] Fail` |
| `[Bulk operation endpoint]` | `[POST]` | `[N]` | `[N]` | `[N]` | `[5000]` | `[ ] Pass  [ ] Fail` |
| `[Continue for all primary endpoints]` | | | | | | |

**Endpoints failing P99 target:** `[Count]`  
**Slowest endpoint (worst P99):** `[Endpoint — N ms]`

#### Frontend Performance

| Screen | Initial Load (ms) | P95 Load (ms) | Target (ms) | Status |
|---|---|---|---|---|
| `[Module primary screen]` | `[N]` | `[N]` | `[3000]` | `[ ] Pass  [ ] Fail` |
| `[Module secondary screen]` | `[N]` | `[N]` | `[3000]` | `[ ] Pass  [ ] Fail` |
| `[Continue]` | | | | |

#### Database Query Performance

Identify the five slowest queries used by this module:

| Query # | Query Description | Table(s) | Avg Execution (ms) | P99 Execution (ms) | Index Used? |
|---|---|---|---|---|---|
| Q1 | `[Description]` | `[Tables]` | `[N]` | `[N]` | `[ ] Yes  [ ] No  [ ] Partial` |
| Q2 | `[Description]` | `[Tables]` | `[N]` | `[N]` | `[ ] Yes  [ ] No  [ ] Partial` |
| Q3 | `[Description]` | `[Tables]` | `[N]` | `[N]` | `[ ] Yes  [ ] No  [ ] Partial` |
| Q4 | `[Description]` | `[Tables]` | `[N]` | `[N]` | `[ ] Yes  [ ] No  [ ] Partial` |
| Q5 | `[Description]` | `[Tables]` | `[N]` | `[N]` | `[ ] Yes  [ ] No  [ ] Partial` |

---

### 5.2 Error Rate Baseline

**Measurement period:** `[Date range]`  
**Data source:** `[Error monitoring platform / Log analysis]`

| Error Type | Count (period) | Rate (% of operations) | Trend | P0/P1 Classification |
|---|---|---|---|---|
| `[e.g., Unhandled API exceptions]` | `[N]` | `[N%]` | `[ ] Increasing  [ ] Stable  [ ] Decreasing` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` |
| `[e.g., Database constraint violations]` | `[N]` | `[N%]` | `[ ] Increasing  [ ] Stable  [ ] Decreasing` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` |
| `[e.g., Integration timeout errors]` | `[N]` | `[N%]` | `[ ] Increasing  [ ] Stable  [ ] Decreasing` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` |
| `[e.g., Calculation errors / exceptions]` | `[N]` | `[N%]` | `[ ] Increasing  [ ] Stable  [ ] Decreasing` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` |
| `[Continue]` | | | | |

**Total operational error rate:** `[N%]`  
**Acceptable error rate threshold:** `<0.1%` (per MODERNIZATION_EXECUTION_FRAMEWORK.md Section 12.2)  
**Status:** `[ ] Within threshold  [ ] Exceeds threshold — requires immediate action`

---

### 5.3 Known Bug Register

List every known bug in this module. Source from: issue tracker, operator complaints, code comments (TODO/FIXME/HACK), and direct observation.

| Bug ID | Description | Severity | Discovered | Source | Operational Impact | Workaround Exists? |
|---|---|---|---|---|---|---|
| `B-001` | `[Bug description]` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` | `[Date]` | `[Issue tracker / Operator / Code]` | `[What breaks or is wrong]` | `[ ] Yes — [describe]  [ ] No` |
| `B-002` | `[Description]` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` | `[Date]` | `[Source]` | `[Impact]` | `[ ] Yes  [ ] No` |
| `B-003` | `[Description]` | `[ ] P0  [ ] P1  [ ] P2  [ ] P3` | `[Date]` | `[Source]` | `[Impact]` | `[ ] Yes  [ ] No` |
| `[Continue]` | | | | | | |

**Bug totals:**
- P0 bugs: `[N]`
- P1 bugs: `[N]`
- P2 bugs: `[N]`
- P3 bugs: `[N]`

> `[CRITICAL]` Any P0 bug must be reviewed by the Architecture Lead immediately. Phase 2 must begin with P0 resolution as the first priority.

---

### 5.4 Failure Mode Analysis

For each primary workflow (from Section 3), document what currently happens when the workflow fails.

| Workflow | Failure Mode | What Currently Happens | Data Safe? | Operator Informed? | Recovery Path |
|---|---|---|---|---|---|
| `[WF-001]` | `[e.g., Payroll run fails mid-execution]` | `[e.g., Run marked failed; partial records in DB; no rollback]` | `[ ] Yes  [ ] No  [ ] Partial` | `[ ] Yes  [ ] No` | `[e.g., Manual DB cleanup required — no automated recovery]` |
| `[WF-002]` | `[Failure mode]` | `[Current behavior]` | `[ ] Yes  [ ] No  [ ] Partial` | `[ ] Yes  [ ] No` | `[Recovery path]` |
| `[Continue]` | | | | | |

**Workflows with unsafe failure modes (data not safe OR no automated recovery):** `[Count]`

> `[CRITICAL]` Any workflow where data safety is `No` on failure is a P0 stabilization target.

---

### 5.5 External Dependency Reliability

For each external integration in Section 2.3, assess reliability.

| Integration ID | Average Uptime (%) | Failure Frequency | Current Failure Handling | Adequate? |
|---|---|---|---|---|
| `I-IN-001` | `[N%]` | `[e.g., 2–3 times/month]` | `[What the system does when this integration fails]` | `[ ] Yes  [ ] No` |
| `I-OUT-001` | `[N%]` | `[Frequency]` | `[Handling]` | `[ ] Yes  [ ] No` |
| `[Continue]` | | | | |

---

### 5.6 Test Coverage Assessment

Measure actual test coverage. Do not estimate.

**Coverage measurement tool and command used:**
```
[e.g., jest --coverage --collectCoverageFrom='src/modules/payroll/**']
```

| Coverage Area | Statements | Branches | Functions | Lines | Target | Status |
|---|---|---|---|---|---|---|
| Calculation logic | `[N%]` | `[N%]` | `[N%]` | `[N%]` | `95% branch` | `[ ] Pass  [ ] Fail` |
| Workflow / state machine | `[N%]` | `[N%]` | `[N%]` | `[N%]` | `100% transitions` | `[ ] Pass  [ ] Fail` |
| API endpoints | `[N%]` | `[N%]` | `[N%]` | `[N%]` | `90% branch` | `[ ] Pass  [ ] Fail` |
| Bulk operations | `[N%]` | `[N%]` | `[N%]` | `[N%]` | `100% paths` | `[ ] Pass  [ ] Fail` |
| Data validation | `[N%]` | `[N%]` | `[N%]` | `[N%]` | `100% conditions` | `[ ] Pass  [ ] Fail` |
| Error handling paths | `[N%]` | `[N%]` | `[N%]` | `[N%]` | `90%` | `[ ] Pass  [ ] Fail` |

**Untested critical paths** (high-risk paths with zero test coverage):
```
1. [Path description — e.g., "PF ceiling breach handling in payroll calculation"]
2. [Path description]
3. [Path description]
```

---

<a name="section-6"></a>
## SECTION 6 — TECHNICAL DEBT ANALYSIS

> **Purpose:** Identify, classify, and quantify all technical debt in the module. Per MODERNIZATION_EXECUTION_FRAMEWORK.md Section 14, all debt must be classified before stabilization work begins.

---

### 6.1 Code Quality Assessment

| Quality Dimension | Assessment | Evidence |
|---|---|---|
| **Domain isolation** — Does the module import directly from other module domains? | `[ ] Isolated  [ ] Partially coupled  [ ] Highly coupled` | `[List any cross-domain direct imports found]` |
| **Calculation encapsulation** — Are calculations in dedicated, testable functions? | `[ ] Encapsulated  [ ] Mixed in controllers/handlers  [ ] Scattered` | `[Examples of scattered calculation code]` |
| **Error handling coverage** — Are all error paths handled? | `[ ] Comprehensive  [ ] Partial  [ ] Minimal` | `[Examples of unhandled errors]` |
| **Type safety** — Is the module fully typed? | `[ ] Full TypeScript  [ ] Partial  [ ] Minimal` | `[Any / unknown usage, implicit any]` |
| **Code duplication** — Is there repeated logic that should be centralized? | `[ ] Minimal  [ ] Moderate  [ ] High` | `[Examples of duplicated logic]` |
| **Cyclomatic complexity** — Are there functions with very high branching complexity? | `[ ] Manageable  [ ] High in places  [ ] Critical` | `[Functions with complexity >10]` |
| **Dead code** — Is there unused code in the module? | `[ ] None found  [ ] Some found  [ ] Significant` | `[Examples of dead code]` |

---

### 6.2 Technical Debt Register

Classify and log all technical debt found during the audit.

| TD ID | Classification | Description | Affected Area | Operational Risk | Resolution Phase Target |
|---|---|---|---|---|---|
| `TD-001` | `[ ] TD-CRITICAL  [ ] TD-HIGH  [ ] TD-MEDIUM  [ ] TD-LOW` | `[Specific description of the debt]` | `[Calculation / Workflow / Data / UX / Infrastructure]` | `[What operational problem this debt could cause]` | `[Phase 2 / Phase 3 / Phase 4 / Opportunistic]` |
| `TD-002` | `[ ] TD-CRITICAL  [ ] TD-HIGH  [ ] TD-MEDIUM  [ ] TD-LOW` | `[Description]` | `[Area]` | `[Risk]` | `[Phase target]` |
| `TD-003` | `[ ] TD-CRITICAL  [ ] TD-HIGH  [ ] TD-MEDIUM  [ ] TD-LOW` | `[Description]` | `[Area]` | `[Risk]` | `[Phase target]` |
| `[Continue for all debt items]` | | | | | |

**Debt summary:**
- TD-CRITICAL items: `[N]` — Must resolve in Phase 2
- TD-HIGH items: `[N]` — Must resolve in Phase 3
- TD-MEDIUM items: `[N]` — Target Phase 3, may carry to Phase 4
- TD-LOW items: `[N]` — Opportunistic resolution

---

### 6.3 Cross-Module Coupling Audit

Document every place where this module directly imports from, or directly queries data owned by, another module.

| Coupling ID | This Module Location | Coupled To | Nature of Coupling | Risk Level |
|---|---|---|---|---|
| `CX-001` | `[File path + line range]` | `[Other module]` | `[Direct import / Shared table query / Shared ORM model]` | `[ ] High  [ ] Medium  [ ] Low` |
| `CX-002` | `[Location]` | `[Module]` | `[Nature]` | `[ ] High  [ ] Medium  [ ] Low` |
| `[Continue]` | | | | |

**Total cross-module coupling violations:** `[N]`

> `[CRITICAL]` Per MASTER_PLATFORM_ENGINEERING.md, domain-to-domain direct imports are architectural defects. All TD-CRITICAL coupling violations must be resolved in Phase 2.

---

### 6.4 Dependency Version Audit

Assess the currency of key dependencies used exclusively or predominantly by this module.

| Dependency | Current Version | Latest Stable | EOL Date | Risk Level | Action Required |
|---|---|---|---|---|---|
| `[package-name]` | `[X.Y.Z]` | `[X.Y.Z]` | `[Date or N/A]` | `[ ] High  [ ] Medium  [ ] Low` | `[Update / Monitor / No action]` |
| `[package-name]` | `[X.Y.Z]` | `[X.Y.Z]` | `[Date or N/A]` | `[ ] High  [ ] Medium  [ ] Low` | `[Action]` |
| `[Continue]` | | | | | |

---

<a name="section-7"></a>
## SECTION 7 — UX WORKFLOW ANALYSIS

> **Purpose:** Audit every screen in this module from the operator's perspective. This is a workflow and operational density audit — not a visual design critique. Findings are evaluated against workflow-first and enterprise density principles from MASTER_MODERNIZATION_PLAN.md.

---

### 7.1 Screen Inventory

List every screen in this module.

| Screen ID | Screen Name / Route | Primary Operator | Frequency of Use | Screen Type |
|---|---|---|---|---|
| `S-001` | `[e.g., Payroll Run Dashboard — /payroll/run]` | `[Payroll Manager]` | `[Monthly — high intensity during run window]` | `[Operational primary / Configuration / Report / Exception handling]` |
| `S-002` | `[Screen name — route]` | `[Role]` | `[Frequency]` | `[Type]` |
| `S-003` | `[Screen name — route]` | `[Role]` | `[Frequency]` | `[Type]` |
| `[Continue for all screens]` | | | | |

**Total screen count:** `[N]`

---

### 7.2 Per-Screen Workflow Assessment

Complete the following for every screen identified in 7.1. For modules with many screens, use subsections (7.2.1, 7.2.2, etc.).

---

#### Screen: `[S-ID] — [Screen Name]`

**Operational purpose of this screen:**
```
[What does an operator accomplish on this screen?]
```

**Workflow context** (where this screen sits in the operator's task sequence):
```
[e.g., "Operator lands here after initiating payroll run from the dashboard. Uses this screen to
review calculation results, resolve exceptions, and approve the run for disbursement."]
```

**Workflow completeness assessment:**

| Workflow Element | Present | Adequate | Gap / Finding |
|---|---|---|---|
| Primary action is immediately visible | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| All data needed to make the operator's decision is on screen | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[What is missing]` |
| Operator can see the status of in-progress operations | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Error states are clearly communicated with actionable guidance | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Bulk operations supported where needed | `[ ] Yes  [ ] No  [ ] N/A` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Confirmation gates present for destructive/irreversible actions | `[ ] Yes  [ ] No  [ ] N/A` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |
| Audit trail / history accessible from this screen | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No  [ ] N/A` | `[Gap]` |

**Operational density assessment:**

| Density Element | Current State | Finding |
|---|---|---|
| Data displayed per viewport | `[Row count, field count visible without scroll]` | `[Adequate / Too sparse / Too dense]` |
| Filters available | `[List available filters]` | `[Missing filters operators need]` |
| Sort options available | `[List sortable columns]` | `[Missing sort operators need]` |
| Columns visible by default | `[List default columns]` | `[Hidden columns operators frequently need]` |
| Pagination size (default rows per page) | `[N rows]` | `[Adequate for operator volume? If not: what should it be?]` |

**Operator-reported friction points** (from interviews):
```
[Role]: "[Quote or description of friction]"
[Role]: "[Quote or description of friction]"
```

**UX class of any proposed changes** (per MODERNIZATION_EXECUTION_FRAMEWORK.md Section 6.2):
```
[Classify any clearly needed changes as Class 1–5.
Do not propose solutions here — only classify the scope of the needed change.]
```

---

### 7.3 Navigation and Information Architecture

**Can operators navigate between related screens without losing context?**
```
[ ] Yes — navigation is logical and preserves context
[ ] Partially — some navigation loses state or requires redundant re-entry
[ ] No — navigation is confusing or forces operators to restart tasks
```

**Findings:**
```
[Describe specific navigation friction points]
```

**Are related workflows linked?** (e.g., can the operator jump from an exception to its source record?)
```
[ ] Yes  [ ] Partially  [ ] No
[Findings]
```

---

### 7.4 Form and Data Entry Assessment

For every form in this module, assess data entry quality.

| Form ID | Form Name | Required Fields Marked? | Inline Validation? | Server-Side Validation? | Pre-fill/Defaults? | Data Loss Risk on Session Expire? |
|---|---|---|---|---|---|---|
| `FM-001` | `[Form name]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| `FM-002` | `[Form name]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| `[Continue]` | | | | | | |

**Forms with data loss risk on session expire:** `[Count]`

---

### 7.5 Bulk Operation UX Assessment

For every bulk operation in this module:

| Bulk Operation | Selection Counter Visible? | Preview Before Execute? | Confirmation Modal? | Result Summary? | Failure Detail? |
|---|---|---|---|---|---|
| `[e.g., Bulk payroll hold]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| `[Bulk operation]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |

**Bulk operations missing any of the above elements:** `[Count]`

---

<a name="section-8"></a>
## SECTION 8 — DATA INTEGRITY ANALYSIS

> **Purpose:** Assess the completeness, accuracy, and structural integrity of the data this module owns and maintains. Data integrity findings are among the highest-risk findings in any HRMS audit because data errors propagate to payroll, compliance, and statutory outputs.

---

### 8.1 Schema Ownership Map

Document every database table this module owns. For each, record its schema health.

| Table Name | Schema | Row Count (approx) | Primary Key | Has Tenant Scope? | Has Soft Delete? | Has Updated At? | Has Created At? |
|---|---|---|---|---|---|---|---|
| `[schema.table_name]` | `[schema]` | `[N]` | `[Column]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| `[schema.table_name]` | `[schema]` | `[N]` | `[Column]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` |
| `[Continue]` | | | | | | | |

**Tables missing tenant scope:** `[Count]` — `[CRITICAL]` if any  
**Tables missing created_at:** `[Count]`  
**Tables missing updated_at where records are mutable:** `[Count]`

---

### 8.2 Data Quality Findings

For each table owned by this module, run the following integrity checks and record findings.

| Check | Table | Finding | Count Affected | Severity |
|---|---|---|---|---|
| Null values in required fields | `[table]` | `[Field(s) with unexpected nulls]` | `[N rows]` | `[ ] P0  [ ] P1  [ ] P2` |
| Orphaned records (FK references non-existent parent) | `[table]` | `[FK column — parent table]` | `[N rows]` | `[ ] P0  [ ] P1  [ ] P2` |
| Duplicate records where uniqueness is expected | `[table]` | `[Duplicate key combination]` | `[N groups]` | `[ ] P0  [ ] P1  [ ] P2` |
| Inconsistent enumeration values | `[table]` | `[Field — inconsistent values found]` | `[N rows]` | `[ ] P0  [ ] P1  [ ] P2` |
| Records with future effective dates that should not exist | `[table]` | `[Field — dates affected]` | `[N rows]` | `[ ] P0  [ ] P1  [ ] P2` |
| Records with impossible date ranges (end before start) | `[table]` | `[Date field pair]` | `[N rows]` | `[ ] P0  [ ] P1  [ ] P2` |
| Zero or negative values in fields that must be positive | `[table]` | `[Field]` | `[N rows]` | `[ ] P0  [ ] P1  [ ] P2` |
| `[Additional check]` | `[table]` | `[Finding]` | `[Count]` | `[ ] P0  [ ] P1  [ ] P2` |

**Data quality P0 findings:** `[Count]`  
**Data quality P1 findings:** `[Count]`

---

### 8.3 Audit Trail Coverage Assessment

For each state-changing operation in this module, assess whether an audit trail is currently emitted.

| Operation | Table Affected | Audit Event Emitted? | What Is Captured | Gap |
|---|---|---|---|---|
| `[e.g., Payroll run creation]` | `[payroll.runs]` | `[ ] Yes  [ ] No  [ ] Partial` | `[If yes: actor, timestamp, parameters]` | `[If partial/no: what is missing]` |
| `[e.g., Salary component update]` | `[payroll.components]` | `[ ] Yes  [ ] No  [ ] Partial` | `[Captured fields]` | `[Gap]` |
| `[e.g., Bulk employee hold]` | `[payroll.holds]` | `[ ] Yes  [ ] No  [ ] Partial` | `[Captured fields]` | `[Gap]` |
| `[Continue for all operations]` | | | | |

**Operations with no audit trail:** `[Count]`  
**Operations with partial audit trail:** `[Count]`

> `[CRITICAL]` Any payroll, compliance, or disbursement operation with no audit trail is a P0 stabilization target.

---

### 8.4 Temporal Data Assessment

For records that change over time (effective-dated records, versioned records), assess temporal completeness.

| Table | Record Type | effective_from present? | effective_to present? | version field present? | Historical versions preserved? | Assessment |
|---|---|---|---|---|---|---|
| `[table]` | `[e.g., Salary structure]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[Complete / Partial / Missing]` |
| `[table]` | `[Record type]` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[ ] Yes  [ ] No` | `[Complete / Partial / Missing]` |

**Records requiring temporal modeling that currently lack it:** `[List]`

---

### 8.5 Cross-Schema Data Access Violations

Document any location where this module reads from or writes to tables owned by another domain:

| Violation ID | Location in Code | Accesses Table | Owned By | Access Type | Risk |
|---|---|---|---|---|---|
| `DA-001` | `[File:line]` | `[schema.table]` | `[Module]` | `[SELECT / INSERT / UPDATE]` | `[What breaks if that table changes]` |
| `DA-002` | `[File:line]` | `[schema.table]` | `[Module]` | `[Access type]` | `[Risk]` |

**Total cross-schema violations:** `[N]`

> `[CRITICAL]` Cross-schema direct access is an architectural defect per MASTER_DOMAIN_ARCHITECTURE.md. All violations are TD-CRITICAL items requiring Phase 2 remediation.

---

<a name="section-9"></a>
## SECTION 9 — INTELLIGENCE OPPORTUNITY ANALYSIS

> **Purpose:** Identify where intelligence capabilities would provide genuine operational value to this module. This section is completed last, after all operational, workflow, stability, and data findings are documented. Intelligence opportunities are evaluated only where the underlying data and operations are confirmed to be stable.
>
> **Standing constraint:** Per MASTER_MODERNIZATION_PLAN.md and MODERNIZATION_EXECUTION_FRAMEWORK.md, no intelligence feature is deployed on this module until Phases 2 and 3 are complete. This section is forward-planning only — it does not authorize intelligence work.

---

### 9.1 Intelligence Readiness Pre-Check

Before identifying intelligence opportunities, assess whether the module's data is suitable as an intelligence input.

| Pre-Check | Status | Notes |
|---|---|---|
| Data completeness: are key operational fields populated reliably? | `[ ] Reliable  [ ] Partial  [ ] Poor` | `[Findings]` |
| Data consistency: are enumerations and categorical values consistent? | `[ ] Consistent  [ ] Partial  [ ] Inconsistent` | `[Findings]` |
| Historical data depth: how many months/years of historical data exist? | `[N months / years]` | `[Any gaps in history?]` |
| Audit trail completeness: are key events tracked reliably? | `[ ] Complete  [ ] Partial  [ ] Missing` | `[Findings]` |
| Volume: is the data volume sufficient for pattern detection? | `[ ] Sufficient  [ ] Marginal  [ ] Insufficient` | `[N records in key tables]` |

**Intelligence readiness overall:** `[ ] Ready (after stabilization)  [ ] Conditional  [ ] Not Ready`

**If Not Ready — blockers:**
```
[List what must be resolved before intelligence signals are reliable on this module]
```

---

### 9.2 Anomaly Detection Opportunities

Identify operational patterns where anomaly detection would surface genuine risk to the operator.

| Opp ID | Signal Name | What Anomaly Looks Like | Data Required | Business Risk If Undetected | Delivery Form |
|---|---|---|---|---|---|
| `INT-001` | `[e.g., Salary spike detection]` | `[Gross salary increase >20% vs. prior month without approved revision]` | `[payroll.payslips — current and prior month]` | `[Unauthorized salary change goes undetected until statutory impact]` | `[Inline row flag on payroll run review screen]` |
| `INT-002` | `[Signal name]` | `[What the anomaly looks like]` | `[Tables / fields required]` | `[Risk if undetected]` | `[Delivery form]` |
| `INT-003` | `[Signal name]` | `[Anomaly definition]` | `[Data required]` | `[Risk]` | `[Delivery form]` |
| `[Continue]` | | | | | |

---

### 9.3 Predictive Alert Opportunities

Identify operational situations that are predictable in advance and where early warning has genuine operational value.

| Opp ID | Alert Name | What It Predicts | Lead Time | Data Signal | Operator Action Enabled |
|---|---|---|---|---|---|
| `INT-A-001` | `[e.g., Compliance deadline approach]` | `[PF filing deadline in 7 days; filing not yet initiated]` | `[7 days]` | `[compliance.filing_calendar + filing_status]` | `[Operator initiates filing before deadline rather than in crisis mode]` |
| `INT-A-002` | `[Alert name]` | `[What it predicts]` | `[Lead time]` | `[Data signal]` | `[Operator action]` |
| `[Continue]` | | | | | |

---

### 9.4 Operational Insight Opportunities

Identify aggregated operational patterns that, if surfaced to the operator, would improve decision quality.

| Opp ID | Insight Name | What It Shows | Aggregate Over | Operator Decision Improved |
|---|---|---|---|---|
| `INT-I-001` | `[e.g., Department attendance trend]` | `[7-day rolling average attendance rate by department, vs. prior period]` | `[Department, week]` | `[Attendance Manager can identify problem departments before month-end payroll impact]` |
| `INT-I-002` | `[Insight name]` | `[What it shows]` | `[Aggregate dimension]` | `[Decision improved]` |
| `[Continue]` | | | | |

---

### 9.5 AI Assistance Opportunities

Identify workflow steps where AI-generated suggestions would reduce operator effort or reduce decision error rate.

| Opp ID | Workflow Step | Current Operator Effort | AI Assistance Type | Expected Reduction in Effort |
|---|---|---|---|---|
| `INT-AS-001` | `[e.g., Attendance exception resolution]` | `[Operator manually reviews each exception and decides: regularize, reject, or escalate — 2–5 min each]` | `[Suggested resolution based on employee history + policy match + similar past resolutions]` | `[Operator validates suggestion vs. deciding from scratch — reduces to <1 min per exception]` |
| `INT-AS-002` | `[Workflow step]` | `[Current effort]` | `[AI assistance type]` | `[Expected reduction]` |
| `[Continue]` | | | | |

---

### 9.6 Intelligence Anti-Patterns to Avoid

Based on findings from this audit, document specific intelligence anti-patterns that would be harmful for this module:

```
1. [e.g., "Do not surface intelligence alerts that require the operator to dismiss before completing
   the payroll run — payroll run timing is critical and interruptions increase error risk."]

2. [e.g., "Do not replace the exception queue with an AI-curated summary — operators need to see
   all exceptions, not a filtered subset selected by the model."]

3. [Anti-pattern specific to this module's operational character]
```

---

<a name="section-10"></a>
## SECTION 10 — AUDIT SUMMARY AND PHASE GATE RECOMMENDATION

> **Purpose:** Synthesize all audit findings into a structured summary that supports the Phase 1 gate review decision. This is the only section where forward-looking assessment and recommendations are permitted.

---

### 10.1 Audit Findings Summary

| Category | Finding Count | Critical Findings | High Findings |
|---|---|---|---|
| Unverified calculations | `[N]` | `[N]` | `[N]` |
| P0 bugs | `[N]` | `[N]` | `—` |
| P1 bugs | `[N]` | `—` | `[N]` |
| Reconciliation gaps | `[N]` | `[N]` | `[N]` |
| Workflow failures (unsafe on error) | `[N]` | `[N]` | `[N]` |
| Missing audit trails | `[N]` | `[N]` | `[N]` |
| Cross-module coupling violations | `[N]` | `[N]` | `[N]` |
| Data integrity P0 issues | `[N]` | `[N]` | `—` |
| Data integrity P1 issues | `[N]` | `—` | `[N]` |
| TD-CRITICAL debt items | `[N]` | `[N]` | `—` |
| TD-HIGH debt items | `[N]` | `—` | `[N]` |
| Test coverage failures | `[N areas]` | `[N]` | `[N]` |
| UX workflow gaps | `[N]` | `[N]` | `[N]` |
| **TOTAL CRITICAL** | | **`[N]`** | |
| **TOTAL HIGH** | | | **`[N]`** |

---

### 10.2 Operational Risk Assessment

Based on all findings, assess the module's current operational risk level:

**Overall operational risk:**  
`[ ] Critical — Module has findings that could cause data loss, incorrect payroll, or compliance failure in current state`  
`[ ] High — Module has significant stability gaps that increase operational error probability`  
`[ ] Medium — Module is mostly stable but has gaps that require addressed before enhancement`  
`[ ] Low — Module is stable; primary gaps are optimization and enhancement opportunities`

**Justification:**
```
[2–4 sentences explaining the risk assessment. Reference specific findings by ID.
e.g., "Risk is classified as Critical due to B-003 (unhandled payroll run mid-execution failure
causing partial records) and RG-001 (no post-disbursement reconciliation). These findings mean
data integrity cannot be guaranteed under current failure conditions."]
```

---

### 10.3 Phase 2 Priority Order

Based on audit findings, the following is the recommended priority order for Phase 2 (Stabilization) work:

**Priority 1 — Must resolve first (P0 bugs + TD-CRITICAL):**
```
1. [Bug ID / TD ID — Description — Why first]
2. [Bug ID / TD ID — Description]
3. [Bug ID / TD ID — Description]
```

**Priority 2 — Resolve after Priority 1 complete (P1 bugs + critical reconciliation gaps):**
```
1. [Bug ID / Gap ID — Description]
2. [Bug ID / Gap ID — Description]
```

**Priority 3 — Resolve before Phase 2 exit (remaining stabilization):**
```
1. [Item — Description]
2. [Item — Description]
```

---

### 10.4 Phase 2 Estimated Effort

| Work Category | Estimated Effort |
|---|---|
| P0 bug resolution | `[N days]` |
| P1 bug resolution | `[N days]` |
| Test coverage establishment | `[N days]` |
| Calculation documentation and verification | `[N days]` |
| Audit trail completion | `[N days]` |
| Data integrity remediation | `[N days]` |
| Cross-module coupling remediation | `[N days]` |
| **Total Phase 2 estimate** | **`[N days / N sprints]`** |

**Confidence level in estimate:** `[ ] High (well-understood scope)  [ ] Medium (some unknowns)  [ ] Low (significant unknowns remain)`

**Estimate uncertainty factors:**
```
[Any areas where the estimate could be significantly wrong, and why]
```

---

### 10.5 Pre-Existing Capability Worth Preserving

Document operational strengths found during the audit — things that work well and must be preserved unconditionally through modernization.

```
1. [e.g., "The payroll component ledger view provides full gross-to-net transparency per employee.
   This is a high-value operational feature — operators rely on it daily for variance explanations.
   Any change to the payroll screen must preserve this view."]

2. [e.g., "The attendance exception queue correctly groups exceptions by exception type and allows
   batch resolution. The grouping logic is well-implemented and must be preserved in any UX change."]

3. [Capability worth preserving]
```

---

### 10.6 Phase Gate Recommendation

**Recommendation:**  
`[ ] Approve Phase 1 exit — Proceed to Phase 2`  
`[ ] Conditional approval — Phase 2 may begin after the following conditions are met:`  
`[ ] Deny Phase 1 exit — Audit is incomplete or critical findings require pre-gate resolution`

**Conditions (if conditional approval):**
```
1. [Condition that must be met before Phase 2 begins]
2. [Condition]
```

**Denial reasons (if denied):**
```
[Specific reasons why the audit is insufficient or why pre-gate resolution is required]
```

**Auditor sign-off:**

| Role | Name | Signature | Date |
|---|---|---|---|
| Lead Auditor | `[Name]` | `_______________` | `[Date]` |
| Operations Liaison | `[Name]` | `_______________` | `[Date]` |
| Architecture Reviewer | `[Name]` | `_______________` | `[Date]` |

---

## APPENDIX A — OPERATOR INTERVIEW LOG

Record of all operator interviews conducted during this audit.

| Interview # | Operator Role | Interview Date | Duration | Key Findings Reference |
|---|---|---|---|---|
| `OI-001` | `[Role]` | `[Date]` | `[N minutes]` | `[Section references where findings from this interview appear]` |
| `OI-002` | `[Role]` | `[Date]` | `[N minutes]` | `[References]` |
| `[Continue]` | | | | |

**Interview guide questions used:**
```
1. Walk me through a typical [day / week / month] using this module. What do you do first?
2. What is the most time-consuming step in your workflow?
3. What is the step you are most worried about making a mistake on?
4. Are there any workarounds you use because the system doesn't quite do what you need?
5. What would you immediately fix if you could fix one thing?
6. When something goes wrong in this module, what is the hardest part of recovering?
7. Are there any operations you avoid doing in the system and do manually instead? Why?
8. What data do you wish you could see on this screen that isn't there?
9. Have you ever had to redo work because the system lost your input?
10. Are there any calculations or outputs from this module that you don't fully trust? Why?
```

---

## APPENDIX B — AUDIT EVIDENCE REGISTER

Record of all evidence artifacts collected during this audit.

| Evidence ID | Type | Description | Location / Reference | Collected By | Date |
|---|---|---|---|---|---|
| `EV-001` | `[Code / Database / Screenshot / Interview / Log / Report]` | `[What this evidence shows]` | `[File path / Attachment / URL]` | `[Auditor name]` | `[Date]` |
| `EV-002` | `[Type]` | `[Description]` | `[Location]` | `[Auditor]` | `[Date]` |
| `[Continue]` | | | | | |

---

## APPENDIX C — AUDIT CHANGE LOG

Record of any updates made to this document after initial completion.

| Date | Changed By | Section(s) Changed | Reason for Change |
|---|---|---|---|
| `[Date]` | `[Name]` | `[Sections]` | `[Why the change was made]` |

---

## DOCUMENT CONTROL

| Field | Value |
|---|---|
| **Template Owner** | Architecture Lead |
| **Template Version** | 1.0 |
| **Governed By** | MODERNIZATION_EXECUTION_FRAMEWORK.md — Section 2 (Audit Methodology) |
| **Mandatory For** | Every module entering Phase 1 of the modernization lifecycle |
| **Completion Requirement** | All sections must be completed before Phase 1 gate review |
| **Archive Location** | `modernization/audits/[MODULE]-[YYYY-MM]/` |
| **Retention** | Permanently retained — audit records are the historical record of module state at modernization entry |

---

*This template is a forensic instrument, not a planning document. Its value is proportional to the honesty and completeness of the findings it records. An audit that finds few problems is not a good audit — it is an incomplete one. Every finding discovered here is a problem avoided in production.*
