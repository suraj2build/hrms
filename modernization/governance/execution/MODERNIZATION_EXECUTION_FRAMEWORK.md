# MODERNIZATION EXECUTION FRAMEWORK
## Enterprise HRMS — Mandatory Execution Operating Manual

**Document Version:** 1.0  
**Date:** 2026-05-11  
**Classification:** Mandatory Governance — All Engineering, Product, and Architecture Work  
**Document Authority:** This framework governs all HRMS modernization activity. No module may enter active modernization, no feature may be built, no architecture may be changed, and no intelligence capability may be deployed without operating within this framework.

**Governing Documents (Parent Hierarchy):**
- `MASTER_MODERNIZATION_PLAN.md` — Strategic product direction and non-negotiable principles
- `MASTER_PLATFORM_ENGINEERING.md` — Engineering architecture and runtime constraints
- `MASTER_DOMAIN_ARCHITECTURE.md` — Domain boundaries, ownership, and event contracts
- `MASTER_DATA_ARCHITECTURE.md` — Data sovereignty, schema governance, and audit architecture
- `MASTER_EVENT_ARCHITECTURE.md` — Event taxonomy, async patterns, and operational event contracts

**In case of conflict between this document and any parent document, the parent document prevails.**

---

## TABLE OF CONTENTS

1. [Modernization Lifecycle](#section-1)
2. [Audit Methodology](#section-2)
3. [Stabilization Methodology](#section-3)
4. [Workflow-First Modernization Rules](#section-4)
5. [Operational Hardening Standards](#section-5)
6. [UX Enhancement Governance](#section-6)
7. [Intelligence Integration Governance](#section-7)
8. [Engineering Delivery Standards](#section-8)
9. [Release Governance](#section-9)
10. [Rollout Governance](#section-10)
11. [KPI Validation Framework](#section-11)
12. [Enterprise Reliability Standards](#section-12)
13. [Module Readiness Gates](#section-13)
14. [Technical Debt Classification](#section-14)
15. [Change Classification System](#section-15)
16. [Reconciliation-First Operational Principles](#section-16)
17. [Human-in-the-Loop Operational Requirements](#section-17)

---

<a name="section-1"></a>
## SECTION 1 — MODERNIZATION LIFECYCLE

### 1.1 The Five-Phase Lifecycle

Every module that enters active modernization traverses five phases in strict sequential order. No phase may be skipped. No phase may be exited until its exit criteria are fully satisfied and documented.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    MODULE MODERNIZATION LIFECYCLE                          │
│                                                                           │
│   ┌─────────┐   ┌───────────┐   ┌──────────┐   ┌─────────┐   ┌────────┐ │
│   │  AUDIT  │──▶│ STABILIZE │──▶│ OPTIMIZE │──▶│ ENHANCE │──▶│ INTEL  │ │
│   │ Phase 1 │   │  Phase 2  │   │  Phase 3 │   │ Phase 4 │   │ Phase 5│ │
│   └─────────┘   └───────────┘   └──────────┘   └─────────┘   └────────┘ │
│                                                                           │
│   ◀──── OPERATIONAL MATURITY MUST BE CONFIRMED BEFORE ADVANCING ────────▶ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Phase Definitions

#### Phase 1 — AUDIT
**Purpose:** Establish complete, documented understanding of what the module currently does, what is fragile, what is undocumented, and what operational dependencies exist.

**Activities:**
- Map every screen, form, workflow, and calculation in the module
- Document all database tables owned by the module and their schemas
- Identify all cross-module dependencies (data reads, workflow triggers, shared tables)
- Catalogue all known bugs, edge cases, and operator workarounds
- Measure current performance baselines (page load, query execution, API latency)
- Interview operators who use the module daily to capture undocumented workflows
- Assess test coverage — what is tested, what is not

**Deliverables:**
- Module Audit Report (mandatory before Phase 2 begins)
- Known Bug Register with severity classification
- Dependency Map (inter-module and external)
- Operator Interview Summary
- Performance Baseline Report

**Exit Criteria:**
- Module Audit Report reviewed and approved by Architecture lead
- All module screens and workflows documented
- Dependency map complete
- No undocumented external integrations

---

#### Phase 2 — STABILIZE
**Purpose:** Make the module operationally reliable. Fix bugs, close edge cases, ensure calculations are verified, add test coverage, and eliminate fragility. No new features. No UX changes. No intelligence features.

**Activities:**
- Fix all P0 and P1 bugs identified in Audit phase
- Add automated tests for all critical calculation paths (payroll computation, attendance processing, compliance derivations)
- Add automated tests for all critical workflows (approval chains, state transitions, bulk operations)
- Eliminate data integrity issues (orphaned records, inconsistent states, missing audit trails)
- Add missing audit event emission for all state-changing operations
- Document all calculation rules with test-verified examples
- Resolve all cross-module coupling issues identified in Audit phase

**Deliverables:**
- Stabilization Completion Report
- Test coverage report (minimum thresholds per module type — see Section 12)
- Verified calculation documentation
- Resolved bug register (all P0, P1 closed; P2 logged with fix timeline)

**Exit Criteria:**
- Zero open P0 bugs
- Zero open P1 bugs that affect operational workflows
- Test coverage meets minimum thresholds (Section 12)
- All critical calculations documented and test-verified
- Operations team sign-off: module is stable for production use

**Hard Rule:** No Phase 3 work begins until Phase 2 exit criteria are satisfied and documented.

---

#### Phase 3 — OPTIMIZE
**Purpose:** Improve the module's performance, reduce technical debt, and refactor code for maintainability — without changing operational behavior.

**Activities:**
- Optimize slow queries identified in performance baseline
- Add database indexes identified as missing during Audit
- Refactor deeply coupled code into domain-isolated modules
- Improve API response times to meet reliability standards (Section 12)
- Reduce bundle size and frontend load times for module screens
- Extract repeated logic into shared utilities without breaking operational behavior
- Improve error handling and error messaging for operators

**Deliverables:**
- Performance Improvement Report (before vs. after metrics)
- Technical Debt Resolution Log
- Refactoring Summary (what changed, what was preserved)

**Exit Criteria:**
- API response time targets met (Section 12.2)
- No performance regression on any existing operation
- No operational behavior change — full regression test pass
- Technical debt register updated

---

#### Phase 4 — ENHANCE
**Purpose:** Add operational improvements, UX enhancements, and new workflow capabilities that increase operator effectiveness. All enhancements are additive. No existing workflows are removed or restructured without operator validation.

**Activities:**
- Implement UX improvements approved under UX Enhancement Governance (Section 6)
- Add new operational features identified as high-value during Audit
- Improve reconciliation workflows, exception queues, and bulk operations
- Enhance data export, reporting, and audit trail accessibility
- Add any missing operational guards (confirmation dialogs, validation warnings, bulk action previews)

**Deliverables:**
- Enhancement Scope Document (approved before implementation)
- Feature addition regression test results
- Operator acceptance documentation

**Exit Criteria:**
- All enhancements validated against workflow-first principles (Section 4)
- No operational regression — full regression test pass
- Operator acceptance sign-off for all workflow changes
- UX enhancements reviewed under Section 6 governance

---

#### Phase 5 — INTELLIGIZE
**Purpose:** Layer intelligence capabilities onto a stable, optimized, enhanced module. Intelligence augments operator workflows; it does not replace them. No intelligence feature ships on an unstable module.

**Activities:**
- Implement anomaly detection relevant to the module's operational data
- Add inline intelligence indicators within existing operational screens
- Implement predictive alerts for module-specific risk signals
- Add AI-assisted exception resolution suggestions where appropriate
- Implement intelligence as non-blocking, degradable enhancement (Section 7)

**Deliverables:**
- Intelligence Integration Design (approved before implementation)
- Fallback behavior documentation (what happens when intelligence is unavailable)
- Intelligence accuracy baseline

**Exit Criteria:**
- Intelligence features do not degrade operational screen performance
- All intelligence features have tested fallback behavior
- No intelligence feature blocks or alters core operational workflows
- Intelligence accuracy meets minimum thresholds (Section 11.4)

---

### 1.3 Lifecycle Governance Rules

**Rule L1 — Sequential Enforcement**
Phases are sequential. A module in Phase 2 cannot receive Phase 4 work. A module in Phase 3 cannot receive Phase 5 work. Cross-phase work within a single module is a governance violation.

**Rule L2 — One Active Module**
Only one module is in active modernization (Phases 2–5) at any time. Other modules receive critical bug fixes only. This prevents diffuse engineering attention, cross-module regression chains, and incomplete modernization artifacts.

**Rule L3 — Phase Exit Documentation**
Phase exit requires documented sign-off, not tacit agreement. The Phase Exit Document must be created, reviewed, and approved before the next phase begins.

**Rule L4 — Regression at Phase Boundary**
Before any phase exit, a full regression test of the module's operational behavior must be run and pass. A regression failure at phase boundary halts advancement and triggers a stabilization sub-cycle.

**Rule L5 — No Intelligence Before Stability**
Phase 5 cannot begin on any module until Phases 2 and 3 are complete. Operational stability is the non-negotiable prerequisite for intelligence work. This rule has no exceptions.

---

<a name="section-2"></a>
## SECTION 2 — AUDIT METHODOLOGY

### 2.1 Audit Scope

Every module audit must produce a complete, honest assessment of the module's current state. The audit is not a design exercise. It is a factual investigation. Its output governs all subsequent phases.

### 2.2 Audit Workstreams

#### Workstream A — Functional Mapping
Document every function the module performs:
- List every screen accessible within the module
- Map the workflow sequence for every primary operator task
- Identify every form, every field, every validation rule
- Document every calculation performed (formulas, rules, edge cases)
- Map every bulk operation (upload, bulk approve, bulk process)
- Document every report or export the module generates

**Output:** Module Functional Map (screen-by-screen, workflow-by-workflow)

#### Workstream B — Data Audit
Assess the data structures the module owns and depends on:
- List every database table the module reads from or writes to
- Identify tables owned exclusively by this module vs. shared with other modules
- Document all foreign key relationships and cross-module data dependencies
- Identify data quality issues: null values in required fields, inconsistent enumerations, orphaned records
- Map all indexes and assess whether critical query paths are indexed

**Output:** Module Data Map and Data Quality Report

#### Workstream C — Integration Audit
Document all connections to other modules and external systems:
- Map all API endpoints the module exposes and all it consumes
- Identify all event subscriptions and event publications
- Document all external integrations (biometric devices, statutory portals, third-party systems)
- Identify undocumented dependencies discovered through code reading

**Output:** Integration Dependency Map

#### Workstream D — Operational Behavior Audit
Capture how operators actually use the module in production:
- Conduct structured interviews with operators (Payroll Manager, HR Admin, Compliance Officer, ESS users)
- Identify workarounds operators have developed for system limitations
- Document undocumented workflows that exist only in operator knowledge
- Capture operator pain points, error-prone steps, and efficiency bottlenecks

**Output:** Operator Workflow Interview Summary

#### Workstream E — Code and Quality Audit
Assess the technical health of the module's implementation:
- Measure test coverage by module area (calculation logic, workflow logic, UI behavior)
- Identify untested critical paths
- Assess error handling completeness: are all failure modes handled gracefully?
- Identify code areas with high cyclomatic complexity
- Catalogue all known bugs and classify by severity

**Output:** Code Quality Report and Known Bug Register

#### Workstream F — Performance Baseline
Measure the module's current performance to establish baseline for Phase 3 optimization:
- Record API response times for all primary endpoints (P50, P95, P99)
- Record frontend screen load times for all primary screens
- Identify the five slowest queries used by the module
- Document any performance-related operator complaints

**Output:** Performance Baseline Report

### 2.3 Audit Anti-Patterns

The following are prohibited during the Audit phase. They contaminate the audit with design bias and produce incomplete assessments.

| Anti-Pattern | Why Prohibited |
|---|---|
| Proposing redesigns during audit | Audit is observation, not design. Design proposals bias what is documented. |
| Skipping operator interviews | Operators carry undocumented operational knowledge. Missing this produces an incomplete audit. |
| Auditing only the code, not the UX | Operational behavior lives in both code and UX. Both must be audited. |
| Filtering out "unimportant" screens | Every screen represents an operator workflow. No screen is unimportant until verified. |
| Estimating test coverage without measuring | Estimates are always optimistic. Measure; do not estimate. |

---

<a name="section-3"></a>
## SECTION 3 — STABILIZATION METHODOLOGY

### 3.1 Stabilization Principles

Stabilization is the most important phase of the modernization lifecycle. It transforms a module that works most of the time into a module that works correctly, consistently, and provably. Every other phase depends on the foundation it builds.

**Stabilization is not:**
- Feature development
- Performance optimization
- UX improvement
- Intelligence integration

**Stabilization is:**
- Bug elimination
- Test coverage establishment
- Calculation verification
- Audit trail completion
- Data integrity enforcement
- Error handling hardening

### 3.2 Bug Triage and Priority Classification

All bugs identified in the Audit phase are classified using this severity system:

| Severity | Definition | Resolution Requirement |
|---|---|---|
| **P0 — Critical** | Bug causes data loss, incorrect payroll calculation, incorrect compliance computation, or security breach | Must be resolved before any Phase 2 activity proceeds. Zero tolerance. |
| **P1 — High** | Bug prevents completion of an operational workflow, causes incorrect but non-payroll data, or produces misleading operator information | Must be resolved during Phase 2. Phase 3 cannot begin until all P1 bugs are closed. |
| **P2 — Medium** | Bug causes inconvenience or suboptimal behavior but does not prevent workflow completion or produce incorrect results | Must be logged with fix commitment. Resolution target: Phase 3. |
| **P3 — Low** | Cosmetic issues, minor inconveniences, low-frequency edge cases with no operational impact | Logged and tracked. Resolution target: Phase 4 or as time permits. |

### 3.3 Test Coverage Requirements

Stabilization must establish test coverage that verifies the module's critical operational behavior. Coverage targets by module area:

| Module Area | Minimum Coverage Requirement |
|---|---|
| Calculation logic (payroll, attendance, compliance) | 95% branch coverage |
| Workflow state transitions | 100% of all defined state transitions |
| Bulk operations (upload, batch approve, mass process) | 100% of operational paths including error paths |
| API endpoints (operational) | 90% with happy path and primary error paths |
| Data validation rules | 100% of all validation conditions |
| Audit event emission | 100% of state-changing operations verified to emit correct event |

### 3.4 Calculation Verification Protocol

For any module that performs calculations (Payroll, Attendance, Compliance), stabilization requires calculation verification:

**Step 1 — Document the Formula**
Every calculation must be documented in human-readable form: inputs, formula, edge cases, statutory basis.

**Step 2 — Test with Production-Representative Data**
Calculations are verified using anonymized samples of real production data, not synthetic data. Synthetic data misses real-world edge cases.

**Step 3 — Cross-Verify with Prior Run Outputs**
For payroll and compliance: the recalculated result using documented formulas must match the historical system output for the same inputs. Discrepancies are P0 defects.

**Step 4 — Document All Edge Cases**
Every edge case discovered during verification is documented. If the edge case produces a correct result, document why. If it produces an incorrect result, it is a P0 defect.

### 3.5 Audit Trail Completeness

Every state-changing operation in a stabilized module must emit an audit event. Stabilization is not complete until this is verified for every operation:

| Operation Type | Required Audit Event |
|---|---|
| Record creation | Who created, what was created, timestamp, all field values |
| Record update | Who updated, what field changed, previous value, new value, timestamp |
| Record deletion or soft-delete | Who deleted, what was deleted, timestamp, reason if required |
| Bulk operation | Initiating user, batch identifier, count of affected records, timestamp |
| Workflow state transition | Initiating actor, from-state, to-state, reason, timestamp |
| Payroll run | Run initiator, run parameters, affected employee count, run timestamp |
| Compliance filing | Filing actor, filing period, statutory body, submission timestamp |

### 3.6 Data Integrity Enforcement

During stabilization, all data integrity issues identified in Audit must be resolved:

**Orphaned record remediation:** Records that reference deleted or non-existent parent records must be identified, assessed, and either linked to correct parents or formally archived.

**Null value enforcement:** Required fields that contain null values must be remediated with correct data or with explicit sentinel values that are operationally meaningful.

**Enumeration consistency:** Fields that contain inconsistent enumeration values (e.g., "Active", "active", "ACTIVE" for the same status) must be normalized.

**Duplicate detection:** Duplicate records in operational tables must be identified, deduplicated under operator review, and prevented by database constraints.

---

<a name="section-4"></a>
## SECTION 4 — WORKFLOW-FIRST MODERNIZATION RULES

### 4.1 The Workflow-First Principle

Every modernization decision — architecture, UX, feature, optimization — must be evaluated against the operational workflow it supports. The workflow is the organizing principle. Technology and design serve the workflow; they do not define it.

> **"What does the operator need to accomplish? That question must be answered before any implementation decision is made."**

### 4.2 Workflow Analysis Requirements

Before any enhancement, redesign, or feature addition, the following workflow analysis must be completed and documented:

**Workflow Identity Questions:**
1. What is the name of the workflow being affected?
2. Who is the operator executing this workflow? (Role, frequency, volume)
3. What are the inputs to this workflow?
4. What is the decision the operator must make?
5. What are the outputs of this workflow?
6. What happens downstream when this workflow completes?
7. What happens operationally if this workflow is delayed or blocked?

**Change Impact Questions:**
1. What changes in the workflow as a result of this modernization?
2. What stays the same?
3. Will existing operators need to relearn any steps?
4. Does the change reduce or increase the number of steps to complete the workflow?
5. Does the change preserve or remove existing operator control points?

### 4.3 Workflow Preservation Rules

**Rule W1 — Existing Workflows Are Presumed Correct**
An existing operator workflow exists because it solved an operational problem. Before changing any workflow, the original reason for its design must be understood. Changing a workflow without understanding why it exists risks removing critical operational behavior.

**Rule W2 — Workflow Sequence May Not Be Arbitrarily Shortened**
Reducing steps in an operational workflow is only permitted when:
- The removed step provided no operational value (confirmed through operator interview)
- The removed step's function is preserved through another mechanism
- The change is validated by operators before deployment

**Rule W3 — No Hidden State Transitions**
Every workflow state transition must be visible to the operator and auditable. Automated state transitions that occur without operator awareness are prohibited unless:
- The transition is explicitly a background system operation (not a business decision)
- The operator is notified of the transition after it occurs
- The transition is reversible by the operator

**Rule W4 — Bulk Operations Require Confirmation Gates**
Any operation that affects multiple records simultaneously must have:
- A preview step showing the operator what will be affected
- An explicit confirmation action before execution
- A result summary after execution (success count, failure count, failures listed)

**Rule W5 — Critical Operations Require Elevated Confirmation**
Operations classified as critical (payroll run, statutory filing, mass termination, bulk salary revision) require two-level confirmation:
1. Initial action with summary of what will occur
2. Explicit typed confirmation or secondary confirmation step before execution

### 4.4 Prohibited Workflow Modifications

The following modifications to existing workflows are prohibited without explicit Architecture and Operations governance approval:

- Removing an approval step from any workflow that was previously required
- Converting a multi-step workflow into a single-step auto-approve
- Removing any field from a form that previously captured operational data
- Changing the sequence of steps in a payroll, compliance, or attendance workflow
- Automating a decision that was previously made by a human operator

---

<a name="section-5"></a>
## SECTION 5 — OPERATIONAL HARDENING STANDARDS

### 5.1 Definition of Operational Hardening

Operational hardening is the process of ensuring that the module fails safely, communicates failures clearly, recovers without data loss, and handles all edge cases without operator intervention. A hardened module does not silently fail. It does not produce incorrect results without surfacing an error. It does not require operator workarounds to function.

### 5.2 Error Handling Standards

**Standard EH1 — No Silent Failures**
Every error in an operational workflow must surface to the operator as a clear, actionable message. Generic error messages ("Something went wrong") are prohibited in operational contexts. Every error message must tell the operator:
- What failed
- Why it failed (where known)
- What the operator should do next

**Standard EH2 — No Data Loss on Failure**
If a bulk operation fails partway through, the operation must either:
- Roll back completely to the pre-operation state, OR
- Record which records succeeded, which failed, and why — and provide a mechanism to resume or retry only the failed records

Partial completion without recovery information is an operational defect.

**Standard EH3 — Validation Before Execution**
Operational workflows must validate all inputs before executing any state-changing operation. Validation errors must be surfaced before the operation begins — not after partial execution. For bulk operations, all validation must complete before the first record is processed.

**Standard EH4 — External Dependency Failure Handling**
If the module depends on an external system (biometric device sync, statutory portal, third-party integration), the failure of that external system must not:
- Prevent the operator from completing other workflows in the module
- Produce incorrect data in the operational database
- Silently degrade module functionality without operator awareness

The module must surface external dependency failures clearly and continue to function in a degraded-but-safe mode.

### 5.3 Data Validation Standards

| Validation Type | Standard |
|---|---|
| **Required field validation** | Client-side for UX; server-side for integrity. Both required. |
| **Numeric range validation** | Salary amounts, hours, deduction percentages must be validated against configured operational bounds |
| **Date range validation** | Effective dates, payroll periods, compliance windows must be validated against operational calendar |
| **Cross-field validation** | Fields that have dependencies (e.g., end date must be after start date) must be validated together |
| **Statutory rule validation** | PF, ESI, TDS, PT inputs must be validated against current statutory rules before processing |
| **Duplicate detection** | Employee records, payroll runs, compliance filings must be checked for duplicates before creation |

### 5.4 Operational Logging Standards

Every module must emit operational logs sufficient to reconstruct what happened in any operational scenario without accessing the database:

**Minimum log events per module:**
- Module initialization and configuration load
- Every API call received: method, endpoint, tenant, user, timestamp
- Every database transaction committed: operation type, affected table, record count
- Every external integration call: target system, operation, success/failure, latency
- Every bulk operation: initiator, batch size, success count, failure count
- Every error: full error context including stack trace, input parameters, user context

**Log retention:** Operational logs retained for 90 days minimum. Compliance-relevant logs retained per statutory requirement.

### 5.5 Concurrency and Race Condition Hardening

Operational workflows that are susceptible to concurrent execution must be hardened:

**Payroll runs:** Only one payroll run per tenant per payroll period may execute simultaneously. Concurrent run attempts must be rejected with a clear message identifying the in-progress run.

**Bulk operations:** Long-running bulk operations must acquire an operational lock that prevents duplicate execution. Lock acquisition failure must be surfaced clearly.

**Approval workflows:** Concurrent approval of the same workflow item by different users must be handled through optimistic locking. The second approver must receive a conflict notification, not a silent failure.

**Attendance processing:** Duplicate punch records (same employee, same timestamp) must be detected and deduplicated during ingestion, not silently inserted.

---

<a name="section-6"></a>
## SECTION 6 — UX ENHANCEMENT GOVERNANCE

### 6.1 UX Enhancement Mandate

UX enhancements are permitted — and encouraged — within the bounds established by the MASTER_MODERNIZATION_PLAN. This section defines how UX work is governed, scoped, reviewed, and delivered.

The core UX mandate: **improve the operator's ability to execute workflows, not the aesthetic quality of the interface.**

### 6.2 UX Enhancement Classification

| Class | Definition | Approval Required |
|---|---|---|
| **Class 1 — Cosmetic** | Font, color, spacing, icon improvements with no layout change. Does not affect workflow sequence or information density. | Standard PR review |
| **Class 2 — Presentational** | Table column improvements, filter additions, sort order changes, pagination improvements. Adds operational surface; removes none. | Technical lead review |
| **Class 3 — Structural** | Changes to screen layout, information hierarchy, or component arrangement. May reorganize but must not reduce information density. | Architecture + UX review |
| **Class 4 — Workflow** | Changes to form sequence, approval flow, multi-step wizard behavior, or step-to-step navigation. Affects how operators complete tasks. | Architecture + Operations review + Operator sign-off |
| **Class 5 — Paradigm** | Fundamental change to how a module's primary function is exposed. Replacement of a primary screen paradigm. | Full governance review. Extremely high bar. |

### 6.3 UX Enhancement Design Rules

**Rule UX1 — Enterprise Density Is Non-Negotiable**
Data-grid heavy screens must remain data-grid heavy. Converting a high-density data table into a card-based layout for aesthetic reasons is prohibited. Enterprise operators manage hundreds to thousands of records. Density is a feature, not a flaw.

**Rule UX2 — Workflow Sequence Must Be Preserved**
A UX enhancement may not change the sequence of steps in an established operational workflow unless:
- The existing sequence was identified as operationally incorrect during Audit
- The new sequence is validated by operators before deployment
- A rollback plan exists if operators reject the change in production

**Rule UX3 — No Information Removal**
A UX enhancement may not remove data fields from operational screens unless:
- The field is confirmed to be unused by all operators (verified through Audit interviews)
- The data is preserved in the database and accessible through alternative means
- The removal is explicitly approved in the enhancement scope document

**Rule UX4 — Reconciliation Surfaces Must Expand, Never Contract**
Screens that support reconciliation workflows (payroll variance review, attendance exception management, upload diff views) must always maintain or increase their reconciliation surface area. Simplification that hides reconciliation data is an operational regression.

**Rule UX5 — Intelligence Indicators Must Be Non-Intrusive**
When intelligence indicators (anomaly flags, risk scores, alerts) are added to operational screens, they must:
- Not displace operational data from its current position
- Not require operator interaction to dismiss before completing the primary workflow
- Not alter the visual hierarchy of the primary operational information

**Rule UX6 — New Interaction Patterns Require Operator Validation**
If a UX enhancement introduces an interaction pattern that operators have not used before (e.g., drag-and-drop for reordering, inline editing replacing form-based editing, expandable rows replacing detail screens), it must be validated with representative operators before deployment.

### 6.4 Enterprise UX Design Standards

When designing or enhancing screens, the following standards apply:

**Data Tables:**
- Default sort must reflect the most operationally logical sort (most recent, most critical)
- Sortable columns must include all columns operators commonly sort by
- Filterable fields must cover all fields operators commonly filter by
- Row count per page defaults must be enterprise-appropriate (50–100 rows, not 10–20)
- Bulk selection and bulk action must be available on all operational tables where bulk operations are supported

**Forms:**
- Validation messages must appear inline next to the relevant field
- Required fields must be visually indicated
- Form submission must be disabled until minimum required fields are complete
- Long forms must display a progress indicator or section navigation
- Auto-save must be implemented on forms where session loss would cause data loss

**Status and State Visibility:**
- Every workflow item must display its current state visibly and clearly
- Pending vs. in-progress vs. completed states must be visually distinct
- Error states must include the reason for the error, not just an error indicator

**Bulk Operations:**
- Selection count must be displayed as records are selected
- Bulk action buttons must be disabled until at least one record is selected
- Confirmation modal must display count and sample of affected records
- Post-operation result must display success count and failure count with failure details

---

<a name="section-7"></a>
## SECTION 7 — INTELLIGENCE INTEGRATION GOVERNANCE

### 7.1 Intelligence Integration Mandate

Intelligence features are layered onto stable, optimized modules. They are never the primary operational interface. They are never a prerequisite for completing an operational workflow. They are assistive, non-blocking, and degradable.

> **"If the intelligence layer is unavailable, the HRMS must operate with 100% of its operational capability intact."**

### 7.2 Intelligence Integration Prerequisites

A module may not receive intelligence integration until all of the following prerequisites are satisfied:

| Prerequisite | Verification Method |
|---|---|
| Phase 2 (Stabilize) complete | Phase 2 exit document approved |
| Phase 3 (Optimize) complete | Phase 3 exit document approved |
| Zero open P0 and P1 bugs | Bug register reviewed |
| Audit trail complete for all state-changing operations | Audit event coverage test |
| Performance targets met | Performance baseline vs. current metrics |
| Operator acceptance sign-off | Operator sign-off documentation |

### 7.3 Permitted Intelligence Features

The following intelligence capabilities are permitted within the HRMS:

| Capability | Description | Delivery Form |
|---|---|---|
| **Anomaly Detection** | Automated identification of records deviating from established operational patterns | Inline row-level flags on data tables |
| **Risk Scoring** | Per-record risk score based on operational signals (payroll variance, attendance deviation, compliance deadline proximity) | Sortable/filterable score column on operational tables |
| **Predictive Alerts** | Early warning of conditions that are likely to cause operational problems (compliance deadline approach, leave liability accumulation, attrition signal) | Alert banner or sidebar panel within relevant module |
| **Exception Summaries** | AI-generated summary of the exception queue — count, categories, estimated resolution time | Summary panel within exception queue screens |
| **Anomaly Explanation** | When a flag is raised, contextual explanation of why the anomaly was detected and what similar cases resolved to | Contextual side panel, opened on demand by operator |
| **Compliance Guidance** | Contextual statutory rule explanations within compliance filing workflows | Inline help panel, opened on demand |

### 7.4 Prohibited Intelligence Forms

The following intelligence delivery forms are prohibited:

| Prohibited Form | Reason |
|---|---|
| Intelligence as primary landing page | Operations, not intelligence, is the primary context |
| Conversational AI replacing structured forms | Structured data entry is operationally reliable; conversational AI is not |
| AI-initiated state changes without operator confirmation | Human-in-the-loop is mandatory for all business decisions (Section 17) |
| Autonomous payroll or compliance actions | Zero tolerance; all payroll and compliance actions require explicit human authorization |
| Intelligence that blocks workflow completion | Intelligence is non-blocking; it must never prevent an operator from completing a workflow |
| Generative UI that replaces operational screens | One frontend; no AI-generated alternative interfaces |

### 7.5 Intelligence Fallback Requirements

Every intelligence feature must define and implement a fallback behavior for when the intelligence service is unavailable:

**Degraded Mode:** The module must operate in full operational capacity with intelligence indicators hidden or replaced by neutral indicators. The operator must be notified that intelligence is currently unavailable, but must not be blocked from any operation.

**Fallback UI:** Intelligence UI elements (flag badges, score columns, anomaly panels) must render in a neutral/empty state when intelligence data is unavailable — not in an error state that alarms operators.

**Recovery:** When intelligence service recovers, indicators must repopulate without operator action. No manual refresh required for intelligence data recovery.

### 7.6 Intelligence Accuracy Standards

Before an intelligence feature is deployed to production, it must meet minimum accuracy standards validated on production-representative data:

| Feature Type | Minimum Precision | Minimum Recall |
|---|---|---|
| Anomaly Detection (payroll) | 85% | 80% |
| Anomaly Detection (attendance) | 80% | 75% |
| Risk Scoring (compliance) | 90% | 85% |
| Predictive Alerts | 75% | 70% |

False positive rate must be low enough that operators do not begin ignoring intelligence indicators due to alert fatigue. Alert fatigue rate monitoring (operator dismissal rate) is a post-deployment KPI.

---

<a name="section-8"></a>
## SECTION 8 — ENGINEERING DELIVERY STANDARDS

### 8.1 Code Standards

**Standard CS1 — Domain Isolation**
All code changes must respect domain boundaries as defined in MASTER_DOMAIN_ARCHITECTURE.md. A module's code may not directly import from, or directly query, another module's data layer. Cross-module data flows through published APIs or domain events.

**Standard CS2 — Type Safety**
All backend code must be fully typed. All API contracts must be expressed as Zod schemas. All frontend code consuming APIs must use generated types from the shared contract layer, not locally defined interfaces.

**Standard CS3 — No Magic Queries**
Ad-hoc SQL queries embedded in business logic are prohibited. All database access must go through the established data access layer. Raw SQL is permitted only in the database migration layer and in read-optimized query functions that are explicitly documented and tested.

**Standard CS4 — No Cross-Schema Direct Joins**
Database queries may not join across schema boundaries (domain-to-domain). If data from multiple domains is needed in a single view, it is assembled at the application layer from domain APIs, not through a cross-schema SQL join.

**Standard CS5 — All Mutations Emit Events**
Every state-changing database operation must be accompanied by a domain event emission. Events are the audit trail mechanism and the cross-domain communication mechanism. A mutation without an event is an architectural defect.

**Standard CS6 — Idempotency for Bulk Operations**
All bulk operations (bulk import, batch payroll run, batch compliance filing) must be designed for idempotency. Running the same operation twice with the same inputs must produce the same result, not a duplicate or an error.

### 8.2 Testing Standards

| Test Type | Coverage Standard | When Required |
|---|---|---|
| Unit tests — calculation logic | 95% branch coverage | Mandatory for all calculation-bearing modules |
| Unit tests — workflow logic | All state transitions covered | Mandatory for all workflow-bearing modules |
| Integration tests — API endpoints | All endpoints, happy path + primary error paths | Mandatory before any deployment |
| End-to-end tests — critical workflows | Payroll run, compliance filing, attendance reconciliation | Mandatory before Phase 4 or later |
| Regression tests — all prior behavior | 100% pass rate required | Mandatory before every deployment |
| Performance tests — P99 latency | Must meet Section 12 targets | Mandatory before Phase 3 exit |

### 8.3 PR and Review Standards

**Standard PR1 — Scope Discipline**
Every pull request must have a declared scope: what module it touches, what it changes, what it preserves. PRs that inadvertently touch unrelated modules require explicit justification and scope expansion approval.

**Standard PR2 — Regression Test Evidence**
Every PR that touches operational logic must include evidence of regression test passage. "Tests pass locally" is not sufficient. CI must run and pass.

**Standard PR3 — No Orphan Code**
Code that is added but never called, or code that is removed but whose calling code remains, is not permitted to merge. Dead code is a technical debt deposit.

**Standard PR4 — Migration Safety**
All database migrations must be:
- Reversible (down migration implemented and tested)
- Non-destructive (no DROP TABLE or DROP COLUMN without explicit approval)
- Safe for zero-downtime deployment (no operations that lock tables for extended periods)

**Standard PR5 — Documentation Parity**
If a PR changes a calculation, workflow, or integration behavior, the corresponding documentation must be updated in the same PR. Documentation debt is not deferred.

---

<a name="section-9"></a>
## SECTION 9 — RELEASE GOVERNANCE

### 9.1 Release Classification

All releases are classified before deployment. Classification determines the approval chain, testing requirements, and rollout procedure.

| Release Class | Definition | Approval Required | Rollout Procedure |
|---|---|---|---|
| **Class R1 — Patch** | Bug fix with no behavioral change. Single module, no workflow impact. | Technical lead | Direct deployment with monitoring |
| **Class R2 — Minor Enhancement** | Additive feature or UX improvement. No workflow change. Existing operations unaffected. | Technical lead + Architecture review | Staged rollout (Section 10) |
| **Class R3 — Operational Change** | Change to an existing workflow, calculation change, or integration modification | Architecture + Operations sign-off | Phased rollout with operator notification |
| **Class R4 — Module Milestone** | Phase exit release (Phase 2, 3, 4, or 5 completion) | Full governance review | Controlled rollout with rollback plan |
| **Class R5 — Cross-Module** | Change affecting two or more modules simultaneously | Architecture + Operations + Leadership | Extended validation; manual rollout |

### 9.2 Release Checklist

Every release, regardless of class, must complete this checklist before deployment:

**Pre-Deployment:**
- [ ] Regression test suite executed and passed
- [ ] No P0 or P1 bugs open in affected modules
- [ ] Database migrations tested against production-representative dataset
- [ ] Rollback procedure documented and tested
- [ ] Operations team notified of deployment window and expected impact
- [ ] Monitoring alerts configured for new functionality
- [ ] Feature flags configured if rollout is phased

**Deployment:**
- [ ] Deployment executed during approved deployment window
- [ ] Post-deployment smoke tests executed immediately after deployment
- [ ] Operational workflows spot-checked by engineering team
- [ ] Error rate and latency metrics observed for 30 minutes post-deployment

**Post-Deployment:**
- [ ] Post-deployment monitoring report completed (24 hours)
- [ ] No regression incidents opened in first 48 hours
- [ ] Operator feedback collected if operational workflow was changed

### 9.3 Deployment Window Restrictions

**Payroll module:** No deployments during payroll processing windows (typically payroll cut-off to disbursement). Deployment freeze applies from payroll run initiation through successful payroll disbursement confirmation.

**Compliance module:** No deployments within 48 hours of a statutory filing deadline.

**Attendance module:** No deployments during peak attendance processing windows (typically shift start/end peaks and EOD processing).

**Emergency exceptions:** P0 bug fixes may be deployed outside approved windows with Architecture and Operations dual approval.

---

<a name="section-10"></a>
## SECTION 10 — ROLLOUT GOVERNANCE

### 10.1 Rollout Strategy

Changes that affect operational workflows must follow a staged rollout. Staged rollout prevents a defective change from affecting all operators simultaneously and provides a controlled mechanism for collecting early feedback.

### 10.2 Staged Rollout Tiers

| Tier | Audience | Duration | Gate to Next Tier |
|---|---|---|---|
| **Tier 0 — Internal** | Engineering and QA team in production environment | 24 hours | Zero errors, expected behavior confirmed |
| **Tier 1 — Pilot** | 1–2 selected operators with explicit awareness they are piloting | 48–72 hours | Operator acceptance; zero P0/P1 issues |
| **Tier 2 — Limited** | 20–30% of operators, selected by operational role | 5–7 days | Zero P0 issues; P1 rate below threshold |
| **Tier 3 — Full** | All operators | Permanent | — |

### 10.3 Rollout Gate Criteria

A release must pass the following criteria before advancing to the next rollout tier:

**Error Rate:** No increase in error rate above pre-deployment baseline during the tier period.

**Performance:** P99 latency must not exceed pre-deployment baseline by more than 10%.

**Operator Acceptance:** No operator-reported P0 or P1 issues during the tier period.

**Regression:** No previously working operational workflow reported as broken.

### 10.4 Rollback Triggers

A deployment is immediately rolled back if any of the following occur during any rollout tier:

- P0 bug discovered (data loss, incorrect calculation, security breach)
- Error rate increases by more than 5x baseline
- Any operational workflow rendered non-functional for any operator
- Payroll or compliance calculation confirmed incorrect

**Rollback timeline:** Rollback must be executable within 30 minutes of rollback decision. Rollback procedure must be pre-tested and documented before deployment.

### 10.5 Operator Communication

When a release changes an operational workflow:

- Operators must be notified at least 48 hours before the change reaches their environment
- Notification must describe: what is changing, why it is changing, what the new workflow looks like
- A brief operational guide must accompany any workflow change
- A feedback channel must be active for at least 7 days after the change reaches Tier 3

---

<a name="section-11"></a>
## SECTION 11 — KPI VALIDATION FRAMEWORK

### 11.1 KPI Categories

The HRMS modernization is measured across four KPI categories. Metrics are tracked per module and platform-wide.

### 11.2 Operational Reliability KPIs

| KPI | Target | Measurement Method |
|---|---|---|
| Payroll calculation accuracy | 100% | Post-run reconciliation report |
| Attendance processing accuracy | 99.9% | Daily reconciliation vs. device records |
| Compliance filing accuracy | 100% | Post-filing statutory verification |
| Workflow completion rate | >99% | Workflow engine success/failure ratio |
| Data integrity violations | 0 | Daily integrity check query results |
| Unhandled error rate | <0.1% of operations | Error monitoring platform |

### 11.3 Performance KPIs

| KPI | Target | Measurement Method |
|---|---|---|
| API P99 response time — operational endpoints | <500ms | APM platform percentile tracking |
| API P99 response time — bulk operations | <5s initiation; async completion | APM platform |
| Frontend — initial page load (operational modules) | <3s | Real user monitoring |
| Frontend — subsequent navigation | <1s | Real user monitoring |
| Database query P99 — OLTP | <100ms | Database query monitoring |
| Payroll run processing time (1,000 employees) | <10 minutes | Payroll run event timestamps |

### 11.4 Intelligence Quality KPIs

| KPI | Target | Measurement Method |
|---|---|---|
| Anomaly detection precision | ≥85% | Monthly operator validation sample |
| Anomaly detection recall | ≥80% | Monthly retrospective analysis |
| Alert fatigue rate (operator dismissal without action) | <30% | Intelligence interaction tracking |
| Intelligence feature availability | ≥99% | Intelligence service uptime monitoring |
| Intelligence response time | <2s for inline indicators | APM platform |

### 11.5 Modernization Progress KPIs

| KPI | Measurement | Cadence |
|---|---|---|
| Modules in Phase 2+ | Count and phase status | Monthly |
| Open P0 bugs | Count by module | Weekly |
| Open P1 bugs | Count by module | Weekly |
| Test coverage by module | Branch coverage percentage | Per-release |
| Operator-reported regression incidents | Count and severity | Per-release |
| Technical debt items resolved | Count and classification | Monthly |

### 11.6 KPI Review Cadence

| Review | Cadence | Audience |
|---|---|---|
| Operational reliability review | Weekly | Engineering + Operations |
| Performance review | Per-release + Monthly | Engineering + Architecture |
| Intelligence quality review | Monthly | Engineering + Operations |
| Modernization progress review | Monthly | Engineering + Product + Leadership |
| Full KPI review | Quarterly | All stakeholders |

---

<a name="section-12"></a>
## SECTION 12 — ENTERPRISE RELIABILITY STANDARDS

### 12.1 Availability Standards

| System Component | Target Availability | Measurement Period |
|---|---|---|
| HRMS application (full platform) | 99.5% | Monthly |
| Payroll processing engine | 99.9% during payroll windows | Per payroll cycle |
| Compliance filing module | 99.9% within 72h of statutory deadline | Per filing event |
| Attendance processing | 99.5% | Monthly |
| ESS portal | 99.0% | Monthly |
| Intelligence layer | 99.0% | Monthly |

**Planned downtime:** Planned maintenance windows must be scheduled outside operational peak hours and must be communicated to operators at least 48 hours in advance. Planned maintenance does not count against availability calculation if properly communicated.

### 12.2 Performance Standards

| Endpoint Category | P50 Target | P95 Target | P99 Target |
|---|---|---|---|
| Record lookup (single record) | <50ms | <150ms | <300ms |
| List/grid fetch (paginated, 100 rows) | <100ms | <300ms | <500ms |
| Calculation execution (single employee) | <200ms | <500ms | <1s |
| Bulk validation (100 records) | <1s | <3s | <5s |
| Report generation (standard, <1,000 rows) | <3s | <8s | <15s |
| Payroll run initiation | <500ms initiation | Async processing; separate SLA |
| Bulk upload (500 records) | <5s | <15s | <30s |

### 12.3 Data Durability Standards

- All operational data must be persisted to disk-backed storage before the creating API call returns a success response
- No in-memory-only data stores for operational data
- Database backups: daily full backup, continuous WAL archiving
- Backup restoration must be testable and must be tested quarterly
- Recovery time objective (RTO): 4 hours for full platform restoration from backup
- Recovery point objective (RPO): 1 hour maximum data loss in worst-case failure

### 12.4 Security Standards

- All API endpoints require authenticated session (no unauthenticated operational endpoints)
- All data access is tenant-scoped at the database query level (RLS enforced at Supabase level)
- All sensitive fields (salary, PAN, bank account) encrypted at rest
- All inter-service communication uses authenticated channels
- Session tokens expire according to configured policy; inactive sessions are terminated
- All authentication events and permission changes are logged to the audit system

---

<a name="section-13"></a>
## SECTION 13 — MODULE READINESS GATES

### 13.1 Gate Purpose

Module Readiness Gates are formal checkpoints that a module must pass before advancing to the next lifecycle phase. Gates prevent premature phase advancement and ensure the phase's work is genuinely complete, not merely started.

### 13.2 Gate 1 — Audit Completion Gate (Phase 1 → Phase 2)

| Gate Criterion | Evidence Required | Approver |
|---|---|---|
| All module screens documented | Functional Map document | Technical lead |
| All workflows documented | Workflow map with operator validation | Technical lead |
| Dependency map complete | Dependency Map document | Architecture lead |
| Operator interviews complete | Interview summary document | Operations representative |
| Known bugs registered and classified | Bug register with P0–P3 classification | Technical lead |
| Performance baseline recorded | Performance Baseline Report | Technical lead |
| Architecture lead review complete | Architecture review sign-off | Architecture lead |

**Gate 1 Decision:** Architecture lead signs Phase 1 Exit Document. Module enters Phase 2.

---

### 13.3 Gate 2 — Stabilization Completion Gate (Phase 2 → Phase 3)

| Gate Criterion | Evidence Required | Approver |
|---|---|---|
| All P0 bugs resolved | Bug register: zero open P0 | Technical lead |
| All P1 bugs resolved | Bug register: zero open P1 affecting operations | Technical lead |
| Test coverage meets minimums | Coverage report with Section 3.3 targets met | Technical lead |
| Calculation verification complete | Calculation documentation with test evidence | Architecture lead |
| Audit trail coverage verified | Audit event coverage test results | Technical lead |
| Data integrity issues resolved | Data Quality Remediation Report | Technical lead |
| Operations team sign-off | Operations team sign-off document | Operations representative |

**Gate 2 Decision:** Architecture lead + Operations representative sign Phase 2 Exit Document. Module enters Phase 3.

---

### 13.4 Gate 3 — Optimization Completion Gate (Phase 3 → Phase 4)

| Gate Criterion | Evidence Required | Approver |
|---|---|---|
| API performance targets met | Performance report: Section 12.2 targets met | Technical lead |
| No performance regression | Before/after performance comparison | Technical lead |
| Full regression test passage | CI regression test report | Technical lead |
| Technical debt log updated | Technical Debt Register current | Technical lead |
| Refactoring summary complete | Refactoring Summary Document | Architecture lead |

**Gate 3 Decision:** Architecture lead signs Phase 3 Exit Document. Module enters Phase 4.

---

### 13.5 Gate 4 — Enhancement Completion Gate (Phase 4 → Phase 5)

| Gate Criterion | Evidence Required | Approver |
|---|---|---|
| Enhancement scope fully delivered | Enhancement Scope Document with completion status | Technical lead |
| No operational regression | Regression test report: full pass | Technical lead |
| Operator acceptance complete | Operator Acceptance Sign-off | Operations representative |
| UX enhancements reviewed | UX governance review record | Architecture lead |
| Documentation updated | Module documentation current | Technical lead |

**Gate 4 Decision:** Architecture lead + Operations representative sign Phase 4 Exit Document. Module enters Phase 5.

---

### 13.6 Gate 5 — Intelligence Integration Completion Gate (Phase 5 complete)

| Gate Criterion | Evidence Required | Approver |
|---|---|---|
| All intelligence features deployed | Intelligence Integration Scope: fully delivered | Technical lead |
| Intelligence accuracy targets met | Accuracy validation report: Section 7.6 targets met | Architecture lead |
| Fallback behavior tested | Fallback test results | Technical lead |
| Intelligence does not affect performance | Performance comparison: pre/post intelligence | Technical lead |
| Alert fatigue rate acceptable | Intelligence interaction tracking: <30% dismissal | Operations representative |
| Operator feedback positive | Operator feedback summary | Operations representative |

**Gate 5 Decision:** Architecture lead + Operations representative sign Phase 5 Exit Document. Module modernization complete.

---

<a name="section-14"></a>
## SECTION 14 — TECHNICAL DEBT CLASSIFICATION

### 14.1 Technical Debt Philosophy

Technical debt is not inherently bad. Some debt is accepted consciously to meet an operational deadline. The problem is not debt — it is unclassified, untracked, and unaddressed debt. This section defines how technical debt is classified, tracked, and resolved.

### 14.2 Debt Classification System

| Class | Definition | Resolution Priority |
|---|---|---|
| **TD-CRITICAL** | Debt that creates operational risk: incorrect behavior under edge cases, unverified calculations, untested critical paths, security vulnerabilities | Must be resolved during Phase 2 (Stabilize). Cannot exit Phase 2 with open TD-CRITICAL debt. |
| **TD-HIGH** | Debt that creates maintenance risk: deeply coupled code that makes changes risky, undocumented business rules, missing test coverage for important but non-critical paths | Must be resolved during Phase 3 (Optimize). Cannot exit Phase 3 with open TD-HIGH debt. |
| **TD-MEDIUM** | Debt that creates efficiency risk: suboptimal patterns, duplicated logic, outdated libraries with available alternatives, improvable error handling | Should be resolved during Phase 3. May carry into Phase 4 with documented plan. |
| **TD-LOW** | Cosmetic or stylistic debt: inconsistent naming, code organization improvements, comment coverage, minor refactoring opportunities | Addressed opportunistically. No mandatory resolution timeline. |

### 14.3 Technical Debt Register

All identified technical debt is logged in the Technical Debt Register with:
- Unique ID
- Classification (TD-CRITICAL through TD-LOW)
- Description of the debt
- Affected module
- Affected area (calculation, workflow, data, UX, infrastructure)
- Date identified
- Identified by
- Resolution target phase
- Resolution status and date

### 14.4 Debt Accrual Rules

New technical debt may only be consciously accrued during development if:
1. The debt is classified and logged in the Technical Debt Register before the code merges
2. The resolution phase is specified
3. The technical lead explicitly approves the debt accrual

Unclassified technical debt discovered during code review is a blocking issue — the PR may not merge until the debt is either resolved or formally logged.

---

<a name="section-15"></a>
## SECTION 15 — CHANGE CLASSIFICATION SYSTEM

### 15.1 Change Classification Purpose

Every change to the HRMS must be classified before it is implemented. Classification determines the approval chain, required testing, deployment procedure, and rollout strategy. Unclassified changes are not permitted to merge.

### 15.2 Change Classification Matrix

| Change Class | Description | Examples | Approval Chain | Testing Requirement |
|---|---|---|---|---|
| **CC-1 Hotfix** | Emergency fix for P0 production incident. Single, minimal change. | Payroll calculation bug fix, data corruption repair, security patch | Architecture lead (emergency authority) | Targeted test; full regression within 24h |
| **CC-2 Bug Fix** | Non-emergency bug fix. Single module. No workflow change. | Form validation fix, display error correction, API error handling | Technical lead review | Regression test: affected area |
| **CC-3 Additive Feature** | New capability added without changing existing behavior. | New filter on existing table, new export format, new validation rule | Technical lead + Architecture review | Full module regression |
| **CC-4 Enhancement** | Change to existing feature that improves but does not break existing behavior. | UX improvement, query optimization, error message improvement | Technical lead + Architecture review | Full module regression |
| **CC-5 Workflow Change** | Change that modifies an existing operational workflow sequence or decision point. | Approval flow change, form step reorder, new mandatory field | Architecture + Operations sign-off | Full module regression + operator validation |
| **CC-6 Calculation Change** | Change to a calculation formula, statutory rule, or computation logic. | PF ceiling change, OT rate adjustment, compliance rule update | Architecture + Statutory verification + Operations | Calculation regression against historical data |
| **CC-7 Cross-Module Change** | Change that intentionally affects two or more modules. | Shared data structure change, cross-module workflow, shared component change | Full governance review | Full platform regression |
| **CC-8 Intelligence Feature** | Addition of any AI or intelligence capability. | Anomaly detection flag, risk score column, predictive alert | Architecture + Operations review | Intelligence validation + fallback test + full regression |
| **CC-9 Data Migration** | Change to existing data structure or data content in production. | Schema column addition, data backfill, enumeration normalization | Architecture lead + DBA review | Migration dry-run on production backup + rollback test |
| **CC-10 Architecture Change** | Change to system architecture, runtime configuration, or infrastructure. | New service dependency, Supabase configuration change, authentication change | Architecture lead + Leadership | Full platform regression + security review |

### 15.3 Change Classification Escalation

If a change is classified at CC-5 or higher and the approvers are unavailable, the change must be held until approval is obtained. There is no self-approval path for CC-5 through CC-10 changes under any circumstance except CC-1 (where Architecture lead emergency authority applies).

---

<a name="section-16"></a>
## SECTION 16 — RECONCILIATION-FIRST OPERATIONAL PRINCIPLES

### 16.1 Reconciliation as a Core Platform Paradigm

The HRMS processes data that must be reconciled — comparing what is expected against what was recorded, resolving discrepancies, and producing a verified result that is used for payroll, compliance, and statutory filings. Reconciliation is not a feature; it is the operational mode of the platform.

Every module that handles operational data must be designed with reconciliation as a primary concern.

### 16.2 Reconciliation Architecture Requirements

**Requirement R1 — Every Computed Output Has an Input Manifest**
Every computed output (payslip, attendance summary, leave balance, statutory liability) must carry a complete record of its inputs: which records were included, which policy versions were applied, which manual adjustments were made, and what the computation timestamp was. This makes the output auditable and re-derivable.

**Requirement R2 — Diff Views on All Reconciliation Surfaces**
When data is compared (uploaded vs. recorded, expected vs. actual, previous run vs. current run), the UI must expose a diff view that shows:
- Records that match (no reconciliation required)
- Records with discrepancies (require operator review)
- Records present in one source but absent in the other (require operator decision)

Hiding the diff inside an aggregate count is a reconciliation UX failure.

**Requirement R3 — Exception Queues for All Reconciliation Gaps**
Every reconciliation process must generate an exception queue for discrepancies that require operator action. The exception queue must show:
- Nature of the discrepancy
- Both the expected and actual values
- The affected record(s)
- The action options available to the operator (accept, correct, escalate, override)

**Requirement R4 — Audit Trail on All Reconciliation Decisions**
When an operator makes a reconciliation decision (accepts an exception, overrides a discrepancy, escalates a case), that decision is recorded in the audit trail with the operator identity, timestamp, and reason.

**Requirement R5 — Reconciliation Status Visibility**
The status of all in-progress reconciliation processes must be visible to authorized operators at all times. Reconciliation that is pending, in-progress, blocked on exceptions, or complete must be clearly indicated — not inferred from absence of output.

### 16.3 Module-Specific Reconciliation Standards

#### Attendance Reconciliation
- Raw punch data from devices must be reconcilable against processed attendance records
- Shift assignment must be reconcilable against actual punch times
- Leave records must be reconcilable against attendance absences
- Processed attendance must be reconcilable against payroll attendance input

#### Payroll Reconciliation
- Payroll run inputs must be reconcilable against source data (attendance, salary structures, deductions)
- Current payroll run must be reconcilable against prior run (variance flagging for all significant changes)
- Gross to net computation must be fully transparent and re-derivable
- Disbursement records must be reconcilable against processed payroll

#### Compliance Reconciliation
- Computed statutory liabilities must be reconcilable against source payroll data
- Filed amounts must be reconcilable against computed liabilities
- Prior period adjustments must be traceable to their source and reconcilable

#### Upload Reconciliation
- Uploaded records must be reconcilable against existing records (new vs. update vs. conflict)
- Post-upload state must be reconcilable against pre-upload state plus upload diff
- Upload errors must be exportable with their original row context for correction

### 16.4 Reconciliation-First UX Standards

**Never hide discrepancy counts behind success messages.** An upload summary that says "500 records processed" without disclosing that 47 had warnings and 8 had errors is a reconciliation UX failure.

**Never auto-resolve discrepancies.** When a reconciliation gap exists, an operator must make the resolution decision. The system may suggest a resolution, but it may not execute the resolution automatically.

**Never discard rejected data.** Records that fail upload validation, fail reconciliation, or are rejected by the operator must be preserved with their rejection reason — never silently discarded. The operator must be able to retrieve, correct, and resubmit them.

---

<a name="section-17"></a>
## SECTION 17 — HUMAN-IN-THE-LOOP OPERATIONAL REQUIREMENTS

### 17.1 The Human-in-the-Loop Mandate

The HRMS processes decisions that have direct financial, legal, and employment consequences for real people. Payroll amounts, statutory filings, leave decisions, disciplinary records, and employment status changes are not system events — they are consequential decisions that must be owned by a human operator.

No AI system, automation, or background process may execute a consequential HRMS decision without explicit human authorization.

> **"The system assists. The system suggests. The system flags. The system never decides alone."**

### 17.2 Decision Categories and Authorization Requirements

#### Category D1 — Fully Automated (No Human Authorization Required)
These operations run automatically without human intervention. They are low-consequence, high-frequency, and reversible.

| Operation | Automated Behavior | Human Visibility |
|---|---|---|
| Attendance punch ingestion | Automatic record creation | Visible in attendance log |
| Duplicate punch detection | Automatic deduplication with logging | Visible in reconciliation |
| Intelligence indicator refresh | Automatic score/flag update | Visible on operational screens |
| Session expiry | Automatic session termination | Operator notified on next login |
| Scheduled report generation | Automatic generation | Delivered to operator's queue |

#### Category D2 — System-Initiated, Human-Confirmed
These operations are initiated or recommended by the system but require explicit operator confirmation before execution.

| Operation | System Role | Required Human Action |
|---|---|---|
| Attendance exception auto-suggestion | Suggests resolution for common exceptions | Operator must approve suggested resolution |
| Anomaly flag escalation | Flags record with risk score | Operator must review and acknowledge or dismiss |
| Compliance deadline alert | Issues deadline warning | Operator must acknowledge alert |
| Leave auto-accrual | Calculates accrual amount | HR Admin must confirm accrual run |
| Payroll component auto-calculation | Calculates component amounts | Payroll Manager must verify and approve |

#### Category D3 — Human-Initiated, System-Assisted
These operations are explicitly initiated by an operator. The system assists with calculation, validation, and recommendations, but the operator owns the decision.

| Operation | Operator Role | System Assistance |
|---|---|---|
| Payroll run | Operator initiates and authorizes | System calculates; surfaces anomalies for operator review |
| Attendance regularization | Operator approves or rejects each case | System surfaces supporting data |
| Leave approval | Manager approves or rejects | System surfaces leave balance, team coverage |
| Salary revision | HR Admin enters revision | System validates against policy rules |
| Compliance filing | Compliance Officer submits | System calculates liability; operator reviews |

#### Category D4 — Human-Authorized, Human-Executed
These operations are high-consequence and require full human ownership. No automation permitted. No AI suggestion is binding.

| Operation | Authorization Requirement | Notes |
|---|---|---|
| Payroll disbursement authorization | Payroll Manager + designated approver | Two-person authorization mandatory |
| Mass termination (>10 employees) | HR Leadership authorization | Explicit bulk termination approval with list review |
| Statutory filing submission | Compliance Officer sign-off | Explicit pre-filing review checklist mandatory |
| Salary structure change (platform-wide) | HR Leadership + Finance sign-off | Dual authorization required |
| Data deletion or anonymization | Data Privacy Officer authorization | Documented legal basis required |

### 17.3 Authorization Audit Requirements

Every human authorization recorded in the system must carry:
- Identity of the authorizing operator (user ID, role)
- Timestamp of the authorization
- What was authorized (operation type, affected records, scope)
- Any supporting context captured at authorization (anomaly acknowledgements, override reasons)
- IP address and session context of the authorization

Authorization records are immutable. They may not be edited or deleted after creation.

### 17.4 Override Governance

When an operator overrides a system-generated value, rule, or recommendation, the override must be:
1. **Explicit:** The operator must take an active override action — not simply change a value without indicating it is an override
2. **Explained:** Override reason must be captured and stored with the overridden record
3. **Audited:** Override is logged with full context (operator, timestamp, original value, override value, reason)
4. **Bounded:** Overrides must be within operator-role authorization limits. Overrides outside role limits require escalation

**Override limits by role:**

| Role | Override Authority |
|---|---|
| HR Staff | Cannot override payroll calculations, statutory computations, or compliance rules |
| HR Admin | Can override attendance regularization, leave adjustments, up to defined salary limits |
| Payroll Manager | Can override payroll components within defined variance bounds; cannot override statutory deductions |
| Compliance Officer | Can override compliance computations with documented statutory basis |
| System Administrator | Can override platform configurations; cannot override operational data without audit |

### 17.5 AI Recommendation Governance

When the intelligence layer makes a recommendation or suggestion to an operator:

**The operator must not be pressured to accept AI recommendations.** The UI must make it equally easy to accept, dismiss, or override an AI recommendation. Dismiss and override options must be as visually prominent as accept options.

**AI recommendations must be explainable.** The operator must be able to see why the AI made the recommendation — what signals, what patterns, what data — before accepting it.

**AI recommendations must have tracked outcomes.** When an operator accepts or rejects a recommendation, that outcome is recorded. This data is used to measure recommendation accuracy and calibrate the model.

**AI recommendations that are consistently ignored are deprecated.** If an intelligence feature's dismissal rate exceeds 50% over a 30-day period, it is reviewed for accuracy, relevance, and UX placement before continuing in production.

---

## APPENDIX A — DOCUMENT RELATIONSHIPS

```
MASTER_MODERNIZATION_PLAN.md
│   Strategic product vision, non-negotiable principles, module priority
│
├── MASTER_PLATFORM_ENGINEERING.md
│   │   Single runtime architecture, build system, deployment topology
│   │
│   └── MODERNIZATION_EXECUTION_FRAMEWORK.md (THIS DOCUMENT)
│           How the modernization is executed operationally
│
├── MASTER_DOMAIN_ARCHITECTURE.md
│       Domain boundaries, bounded context ownership, event contracts
│
├── MASTER_DATA_ARCHITECTURE.md
│       Data sovereignty, schema governance, temporal modeling, audit architecture
│
└── MASTER_EVENT_ARCHITECTURE.md
        Event taxonomy, async patterns, event-driven operational contracts
```

**Hierarchy of authority:**
1. MASTER_MODERNIZATION_PLAN.md (highest authority)
2. MASTER_PLATFORM_ENGINEERING.md
3. MASTER_DOMAIN_ARCHITECTURE.md
4. MASTER_DATA_ARCHITECTURE.md
5. MASTER_EVENT_ARCHITECTURE.md
6. MODERNIZATION_EXECUTION_FRAMEWORK.md (this document)

Where this framework conflicts with a parent document, the parent document prevails and this document must be updated.

---

## APPENDIX B — QUICK REFERENCE: PROHIBITED ACTIONS

The following actions are prohibited under this framework. Any team member who encounters a proposal to take one of these actions must raise it as a governance issue before any implementation proceeds.

| Prohibited Action | Governing Section |
|---|---|
| Beginning Phase 3 before Phase 2 is gate-approved | Section 1.3, Rule L1 |
| Beginning Phase 5 before Phase 3 is gate-approved | Section 1.3, Rule L5 |
| Deploying intelligence on an unstable module | Section 7.2 |
| Intelligence feature that blocks an operational workflow | Section 7.4 |
| Removing a field from an operational form without approval | Section 6.3, Rule UX3 |
| Shrinking reconciliation surface area | Section 6.3, Rule UX4 |
| Automating a Category D4 decision | Section 17.2 |
| AI-initiated state change without operator confirmation | Section 17.1 |
| Cross-module SQL join | Section 8.1, Standard CS4 |
| Direct domain-to-domain code import | Section 8.1, Standard CS1 |
| Mutation without audit event | Section 8.1, Standard CS5 |
| Deployment during payroll processing window | Section 9.3 |
| Deployment within 48h of statutory deadline | Section 9.3 |
| Rollback-less deployment | Section 10.4 |
| Unclassified change merging | Section 15.1 |
| Technical debt accrual without logging | Section 14.4 |
| Override without audit record | Section 17.4 |

---

## APPENDIX C — PHASE EXIT DOCUMENT TEMPLATE

For each module, the following template is completed at each phase exit:

```
MODULE PHASE EXIT DOCUMENT
══════════════════════════════════════════════════════════

Module Name:          [Module]
Phase Completed:      Phase [N] — [Phase Name]
Date of Completion:   [Date]
Prepared By:          [Technical Lead]

PHASE SUMMARY
─────────────────────────────────────────────────────────
What was completed in this phase:
[Summary of work completed]

What was deferred to a later phase:
[Any scope deferred with justification]

GATE CRITERIA VERIFICATION
─────────────────────────────────────────────────────────
[List all gate criteria with: PASS / FAIL / N/A + evidence link]

OPEN ITEMS
─────────────────────────────────────────────────────────
Known issues carried forward (classified and logged):
[List with Debt Register IDs]

REGRESSION STATUS
─────────────────────────────────────────────────────────
Regression test execution date:    [Date]
Regression test result:            PASS / FAIL
Coverage achieved:                 [%]

APPROVALS
─────────────────────────────────────────────────────────
Technical Lead:           _____________ Date: _______
Architecture Lead:        _____________ Date: _______
Operations Representative: ____________ Date: _______
(Leadership sign-off for Phase 4 and Phase 5 exits)
Leadership:               _____________ Date: _______

NEXT PHASE AUTHORIZATION
─────────────────────────────────────────────────────────
Module is authorized to enter Phase [N+1]: YES / NO
Authorization conditions (if any):
[Any conditions that must be met before Phase N+1 begins]
```

---

## DOCUMENT CONTROL

| Field | Value |
|---|---|
| **Document Owner** | Architecture Lead |
| **Enforcement Authority** | Architecture Lead + Operations Lead |
| **Review Cycle** | Quarterly, or upon completion of each Module Phase Exit |
| **Next Review** | 2026-08-11 |
| **Change Process** | Proposed changes require Architecture lead review. Changes to Sections 4, 16, or 17 require Operations representative co-approval. |
| **Enforcement** | Mandatory. Deviations require written approval from Architecture Lead. Deviations from Section 17 (Human-in-the-Loop) have no exception path. |

---

*This document is the mandatory execution operating manual for all HRMS modernization work. It does not replace judgment — it informs it. Engineers, product managers, and architects are expected to understand the principles well enough to apply them in situations this document does not explicitly cover. When in doubt: stabilize before innovating, preserve before changing, and ask before acting.*
