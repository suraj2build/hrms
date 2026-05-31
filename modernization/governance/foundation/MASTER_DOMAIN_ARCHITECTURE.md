# MASTER DOMAIN MODELING + BOUNDED CONTEXT ARCHITECTURE
## AI-Native Workforce Operating System (HRMS Platform)

**Document Classification:** Core Platform Architecture  
**Version:** 1.0  
**Date:** May 2026  
**Authored By:** Principal Enterprise Architect  
**Status:** Foundational Reference — All Engineering Teams  

---

> *"The greatest architectural risk is not building the wrong microservice — it is allowing the wrong concepts to bleed across the wrong boundaries. Domain modeling is the act of drawing lines in the right places before someone else draws them in the wrong ones."*

---

## DOCUMENT PURPOSE

This document defines the **complete business domain architecture** for the AI-native Workforce Operating System. It is the authoritative reference for bounded context ownership, domain responsibilities, aggregate design, event contracts, integration boundaries, and future scalability partitioning.

This is **not** a microservice decomposition plan. It is a **domain-driven enterprise architecture blueprint** designed to govern a modular monolith today, while deliberately encoding the extraction boundaries required to scale tomorrow.

Every engineering team, every product decision, and every integration contract must be traceable to this document.

---

# SECTION 1: DOMAIN ARCHITECTURE OVERVIEW

---

## 1.1 Domain Philosophy

The platform is built on a foundational principle: **the business domain is the architecture.**

In most enterprise software, architecture drifts from the business model. Tables accumulate columns that belong to other concerns. Services grow to own logic that no single team fully understands. APIs expose blended data that mixes five different domain concepts. The result is a system that is technically operational but architecturally bankrupt — where every change requires understanding everything, and every enhancement risks breaking something unrelated.

Domain-Driven Design (DDD) corrects this by treating the **business domain as the primary organizing principle**. The software model mirrors the business model. The language in code matches the language of business operators. Domain boundaries reflect real ownership lines — not just technical convenience.

For a Workforce Operating System, this philosophy is not optional. HRMS platforms are among the most **semantically complex** enterprise systems in existence. They simultaneously manage:

- The legal employment relationship (contracts, compliance, entitlements)
- The operational workforce (schedules, attendance, productivity)
- The financial workforce (payroll, compensation, deductions)
- The organizational structure (hierarchy, roles, reporting lines)
- The transactional lifecycle (approvals, workflows, audit trails)
- The intelligence layer (analytics, predictions, AI agents)

Each of these is a **distinct business domain** with its own language, rules, ownership, and lifecycle. Conflating them — as most legacy HRMS systems do — produces the unmaintainable monoliths that this platform is designed to supersede.

---

## 1.2 Architectural Principles

The following principles are non-negotiable. Every architectural decision must be evaluated against them.

### Principle 1: Domain Sovereignty
Each bounded context is the **sole authoritative owner** of its data, its invariants, and its business rules. No other domain may write to, or directly query across, another domain's aggregate state. All cross-domain communication occurs through published contracts: APIs or domain events.

### Principle 2: Explicit Over Implicit Coupling
All dependencies between domains must be **explicit and documented**. Implicit coupling — shared database tables, shared ORM models, direct function calls that cross domain boundaries — is treated as an architectural defect. Every cross-context dependency creates future drag.

### Principle 3: Ubiquitous Language per Context
Each bounded context maintains its own **ubiquitous language** — the shared vocabulary used by engineers and domain experts within that context. The term "Employee" in the Payroll context has a different shape, different attributes, and different lifecycle than "Employee" in the Recruitment context. These are not the same object even if they share an identifier.

### Principle 4: Event-First Internal Communication
Wherever two domains need to communicate in a non-blocking, non-critical-path manner, the **event-first pattern** is mandated. Domain events are first-class citizens. They are not implementation details — they are published contracts that other domains may subscribe to.

### Principle 5: Read/Write Segregation at Domain Boundaries
Write operations (commands) are processed within the owning domain's aggregate. Read operations (queries) may be served from **projections, read models, or analytics replicas** that are populated by domain events. This principle is essential for future CQRS adoption and analytics separation.

### Principle 6: Policy Centralization, Logic Decentralization
Business rules that govern behavior (attendance rules, leave entitlement calculations, payroll computation logic) reside in the owning domain. But **cross-cutting policies** — effective-dated rule configurations, tenant overrides, compliance constraints — are managed by a centralized Policy Engine. Domains *invoke* policies; they do not *own* policy configuration.

### Principle 7: Tenant Isolation as a First-Class Concern
Every aggregate, every event, every read model, and every API contract is tenant-scoped from day one. Multi-tenancy is not retrofitted. `tenant_id` is a mandatory field at every persistence boundary, and tenant-aware query filters are enforced at the domain service layer, not the presentation layer.

### Principle 8: Auditability by Design
Every state-changing operation emits an audit record. This is not a cross-cutting logging concern — it is a domain responsibility. The Audit & Governance domain consumes events from all other domains and builds the immutable audit ledger. No domain is exempt.

---

## 1.3 Modular Monolith Strategy

The platform begins as a **modular monolith with event-driven internals**. This is not a compromise position — it is the correct architectural choice for the current phase.

### Why Not Microservices Now

Microservices impose significant operational overhead: network latency, distributed tracing, service discovery, independent deployments, distributed transactions, eventual consistency management. These costs are justified only when:

1. Individual domains require independently scalable infrastructure
2. Teams are large enough to own separate deployment pipelines
3. Domain boundaries are well-understood and stable

At platform inception — even with an existing codebase — domain boundaries are still being discovered. Prematurely extracting services before boundaries are validated leads to the **distributed monolith anti-pattern**: all the operational complexity of microservices with none of the independence benefits.

### Modular Monolith Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKFORCE OPERATING SYSTEM                    │
│                     (Modular Monolith Shell)                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Identity   │  │  Organization│  │      Employee        │  │
│  │   & Access   │  │   Domain     │  │      Domain          │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                       │              │
│  ┌──────▼───────────────────────────────────────▼───────────┐  │
│  │                  INTERNAL EVENT BUS                        │  │
│  │         (In-Process / Outbox Pattern / Future MQ)         │  │
│  └──────┬────────────────────────┬──────────────────────────┘  │
│         │                        │                              │
│  ┌──────▼───────┐  ┌─────────────▼──┐  ┌──────────────────┐  │
│  │  Attendance  │  │  Shift/Roster  │  │  Leave Management │  │
│  │   Domain     │  │    Domain      │  │     Domain        │  │
│  └──────┬───────┘  └────────────────┘  └────────┬──────────┘  │
│         │                                         │              │
│  ┌──────▼─────────────────────────────────────────▼─────────┐  │
│  │                  POLICY ENGINE DOMAIN                      │  │
│  │     (Attendance Rules / Leave Rules / Payroll Rules)      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Payroll    │  │  Workflow &  │  │     Compliance       │  │
│  │   Domain     │  │  Approvals   │  │      Domain          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Analytics   │  │  AI/Intel    │  │   Audit/Governance   │  │
│  │   Domain     │  │   Domain     │  │      Domain          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Module Isolation Rules

Within the monolith, each domain module enforces strict isolation:

1. **No shared ORM models across domain boundaries.** Each domain owns its own database schema namespace (Postgres schema or table prefix). Cross-domain data access is via internal API or event projection — never via JOIN across domain schemas.

2. **No shared service classes across domain boundaries.** A `PayrollService` may not import an `AttendanceService`. It may consume `AttendanceDataProjection` — a read model populated by events.

3. **Dependency inversion at every boundary.** Domain modules depend on abstractions (interfaces/contracts), not implementations. This is what enables future service extraction with minimal refactoring.

4. **Internal Event Bus with Outbox Pattern.** Events emitted within the monolith are persisted to an outbox table before processing, guaranteeing at-least-once delivery and enabling future migration to an external message broker (Kafka, RabbitMQ, etc.) with zero consumer-side changes.

---

## 1.4 Bounded Context Strategy

A **Bounded Context** is the primary unit of domain organization. It defines:

- A **semantic boundary** within which a single ubiquitous language is consistent
- An **ownership boundary** within which a single team has authority
- An **integration boundary** across which all communication is explicit and versioned

### Why Bounded Contexts Are Critical

Without bounded context discipline, HRMS platforms accumulate what practitioners call **"the Big Ball of Mud"**: a system where the Employee record has 200 columns because every feature ever built added more to it; where the payroll calculation reads from 12 different tables owned by 6 different product areas; where no single engineer can fully understand the blast radius of a schema change.

Bounded contexts prevent this by:

1. **Enforcing semantic clarity.** Within a bounded context, terms have precise, agreed-upon meanings. "Employee" in Payroll means a payroll-enrolled entity with compensation details. "Employee" in Recruitment means a candidate who accepted an offer. They share an identifier but are different domain objects with different lifecycles.

2. **Preventing data ownership confusion.** When it is unclear which domain "owns" a piece of data, it gets duplicated everywhere. Bounded contexts eliminate ambiguity by defining authoritative ownership for every domain concept.

3. **Enabling independent evolution.** A well-bounded context can change its internal model without breaking other domains — as long as it honors its external contracts. This is the foundation of platform longevity.

4. **Encoding future extraction points.** Every bounded context boundary is a potential future service boundary. Disciplined monolith modularity means future microservice extraction is a deployment concern, not an architectural redesign.

### Context Map Overview

The following context map illustrates the high-level relationships between bounded contexts and their integration patterns:

```
CONTEXT MAP — WORKFORCE OPERATING SYSTEM

Legend:
  [ACL] = Anti-Corruption Layer (translation required at boundary)
  [OHS] = Open Host Service (domain exposes stable API)
  [PL]  = Published Language (shared schema/contract)
  [CF]  = Conformist (downstream conforms to upstream model)
  [P/S] = Partnership (co-evolving contexts)
  →     = upstream-to-downstream dependency

┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│   [Identity & Access] ──OHS──→ ALL DOMAINS                          │
│                                                                       │
│   [Organization] ──OHS──→ [Employee] ──OHS──→ [Attendance]          │
│        │                       │                    │                │
│        │                  [Payroll]◄────ACL────[Policy Engine]       │
│        │                       │                    │                │
│        └──────────────→ [Leave Management]          │                │
│                               │                     │                │
│                          [Workflow] ←────P/S────────┘                │
│                               │                                      │
│   [Compliance] ──OHS──→ [Payroll] ──PL──→ [Analytics]               │
│                               │                                      │
│   [Audit] ←──CF────── ALL WRITE DOMAINS (event consumers)           │
│                                                                       │
│   [AI Intelligence] ──ACL──→ reads from [Analytics] projections      │
│   [AI Intelligence] ──ACL──→ subscribes to operational events        │
│                                                                       │
│   [Integration Platform] ──ACL──→ all OHS domains                   │
│   [Notification] ←──CF────── [Workflow] / [Leave] / [Payroll]       │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1.5 Event-Driven Evolution Strategy

The platform's internal architecture evolves from **synchronous-first** to **event-driven** over defined phases:

### Phase 1: In-Process Events (Current → 12 months)
All domain events are published and consumed within the same process using an in-process event dispatcher. Events are persisted to an **outbox table** per domain before being dispatched, guaranteeing durability even if the dispatcher crashes. Consumers are registered handlers within the same application process.

```
Domain Command → Aggregate State Change → Outbox Record Created
                                              ↓
                                    Outbox Processor (polling)
                                              ↓
                                    In-Process Event Dispatcher
                                              ↓
                              Registered Domain Event Handlers
```

### Phase 2: External Message Broker (12–24 months)
The outbox processor is redirected to publish events to an external broker (Apache Kafka preferred for volume; RabbitMQ for simpler deployments). Consumer handlers are migrated to broker-subscribed consumers. The domain code does not change — only the dispatcher infrastructure changes.

```
Domain Command → Aggregate State Change → Outbox Record
                                              ↓
                                    Outbox Relay Process
                                              ↓
                                    [Kafka Topic / RabbitMQ Exchange]
                                              ↓
                              Consumer Groups (still in monolith)
```

### Phase 3: Service Extraction (24+ months, as needed)
Individual bounded contexts with demonstrated need for independent scalability are extracted as services. Because domain boundaries are already enforced at the code level, extraction is a **deployment and infrastructure concern** — not an architectural redesign. The extracted service continues consuming from the same Kafka topics; the monolith no longer contains that module.

---

## 1.6 Why Domain Modeling Prevents Technical Debt

Technical debt in enterprise systems is almost never about bad code quality. It is about **misplaced responsibility** — business logic that lives in the wrong layer, the wrong service, or the wrong team's codebase. Domain modeling prevents this class of debt by:

**1. Making implicit boundaries explicit.** When there is no domain model, every developer makes their own architectural decisions. Over time, the system reflects hundreds of individual decisions with no coherent structure. Domain modeling replaces individual judgment with documented architectural intent.

**2. Preventing premature generalization.** Without domain boundaries, developers create "shared" utilities and services that accumulate responsibilities until they become unmaintainable god-objects. Domain modeling restricts what each context is allowed to own, preventing this accumulation.

**3. Preserving domain expert knowledge in code.** When domain rules are embedded in the aggregate layer with the correct ubiquitous language, domain experts can validate the implementation. When business logic is scattered across controllers, SQL queries, and configuration files, this validation is impossible.

**4. Enabling safe refactoring.** A well-modeled domain allows engineers to refactor internal implementation without fear of breaking external consumers — because the external contract (the published API/event schema) is versioned and stable, independent of internal structure.

The cost of correct domain modeling is measured in **weeks of upfront design**. The cost of skipping it is measured in **years of architectural remediation** — which is exactly the technical debt this platform is designed to escape from in its existing system.




---


# SECTION 2: CORE DOMAIN IDENTIFICATION

---

## 2.0 Domain Taxonomy

The platform is organized across **five domain tiers**, each reflecting a distinct layer of business responsibility:

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 1 — FOUNDATION DOMAINS                                         │
│  Identity & Access │ Organization │ Employee │ Policy Engine         │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 2 — OPERATIONAL DOMAINS                                        │
│  Attendance │ Shift Management │ Roster Planning │ Leave Management  │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 3 — FINANCIAL DOMAINS                                          │
│  Payroll │ Compensation & Benefits │ Asset Management                │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 4 — PROCESS DOMAINS                                            │
│  Workflow & Approvals │ Compliance │ Documents │ Notifications        │
│  Recruitment │ Performance Management                                │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 5 — INTELLIGENCE DOMAINS                                       │
│  Analytics │ AI Intelligence │ Audit & Governance                    │
│  Integration Platform │ Mobile Workforce                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2.1 TIER 1 — FOUNDATION DOMAINS

---

### Domain 01: Identity & Access Management (IAM)

**Why This Domain Exists:**
Every enterprise platform begins here. Before any business operation can execute, the system must answer three questions: *Who is this user? What roles do they hold? What are they authorized to do?* Identity and access is not merely authentication middleware — it is a **core business domain** because access control rules in HRMS are deeply business-driven (e.g., a manager can approve leave for their direct reports but not for peers in another department; payroll admins can view salary data only for their assigned cost centers).

**Enterprise Importance:**
IAM is the security foundation for everything else. Breaches of IAM controls in HRMS systems expose salary data, personal information, disciplinary records, and financial transactions. Enterprise customers — particularly in BFSI, healthcare, and government — conduct IAM audits before procurement. Without a mature IAM domain, the platform cannot compete at enterprise scale.

**Operational Responsibilities:**
- Authenticating users across channels (web, mobile, API, SSO)
- Managing role definitions and permission sets
- Enforcing attribute-based access control (ABAC) for multi-tenant row-level security
- Managing API keys, OAuth tokens, and session lifecycle
- Supporting SSO/SAML/OIDC federation with enterprise identity providers
- Maintaining user-to-role-to-permission chains with effective dates

**Business Ownership:** Platform Security & Infrastructure team. Policy definitions owned jointly with Compliance domain.

---

### Domain 02: Organization Domain

**Why This Domain Exists:**
The workforce does not exist in a flat list. It is organized into a hierarchy of legal entities, business units, departments, cost centers, locations, and reporting lines. This organizational structure is the **skeleton upon which every other domain hangs**. Payroll needs cost center ownership. Attendance needs location-based policy assignment. Leave approval workflows need the reporting hierarchy. Roster planning needs the department structure.

The Organization domain is not simply a "company settings" screen. It is a **living, versioned model** of how the enterprise is structured at any point in time — and how it has been structured historically.

**Enterprise Importance:**
Large enterprises restructure constantly: mergers, spin-offs, department reorgs, location additions. The Organization domain must handle **effective-dated structural changes** without corrupting historical operational records. An employee who was in Department A before a reorg should still show Department A in their historical payroll and attendance records, even after being moved to Department B.

**Operational Responsibilities:**
- Managing legal entities and company hierarchy
- Managing business units, departments, sub-departments
- Managing locations (offices, sites, remote designations)
- Managing cost centers and their financial associations
- Managing the employee reporting hierarchy (org chart)
- Handling restructuring with full history preservation
- Publishing the canonical organizational snapshot consumed by all other domains

**Business Ownership:** HR Operations / People Ops team. Finance team co-owns cost center definitions.

---

### Domain 03: Employee Domain

**Why This Domain Exists:**
The Employee domain is the **canonical system of record for the employment relationship**. It manages the lifecycle from the moment a candidate becomes an employee (onboarding) to the moment they exit (offboarding), capturing every contract, role, compensation band, and status change in between.

This is deliberately **not** the same as the identity record (which IAM owns), the organizational position (which Organization owns), or the payroll enrollment (which Payroll owns). The Employee domain owns the **employment contract relationship** — the business fact that a specific person, in a specific legal capacity, holds a specific employment status with the organization.

**Enterprise Importance:**
The Employee domain is the most referenced domain in the platform. Every other domain needs some projection of employee data. Its design must be hyper-stable — its published contracts cannot change without careful versioning — because breaking the Employee contract breaks everything downstream.

**Operational Responsibilities:**
- Managing employee master records and employment contracts
- Managing employment status lifecycle (active, probation, notice, terminated, rehired)
- Managing personal details (demographics, contact, emergency contacts)
- Managing job profiles (job title, grade, band, employment type)
- Managing contract history with effective dates
- Managing onboarding and offboarding workflows (coordination with Workflow domain)
- Publishing employee reference projections for downstream domain consumption

**Business Ownership:** Core HR / People Operations team. Legal/Compliance team co-owns contract templates.

---

### Domain 04: Policy Engine Domain

**Why This Domain Exists:**
This domain warrants dedicated treatment — it is the **central nervous system of all configurable business rules** across the platform. Without it, each operational domain hard-codes its rules. Attendance calculates overtime using its own rule logic. Payroll has its own interpretation of working hours. Leave calculates entitlements independently. The result is rule fragmentation: the same underlying business policy is implemented differently in five places and drifts out of sync over time.

The Policy Engine centralizes **rule definition, versioning, effective-dating, and tenant override management** while keeping rule *execution* inside the domain that owns the computation. Domains call the Policy Engine to retrieve the applicable rule configuration; they do not outsource computation to it.

**Enterprise Importance:**
Enterprise customers have complex, layered policy requirements: national labor laws, industry-specific regulations, collective bargaining agreements, company policies, department-level overrides, individual contract exceptions. No two enterprise tenants share the same policy configuration. The Policy Engine is what makes the platform **genuinely configurable** rather than superficially customizable.

**Operational Responsibilities:**
- Defining and versioning policy rule sets (attendance, leave, payroll, compliance, roster)
- Managing effective dates for policy changes
- Managing tenant-level, business-unit-level, and employee-level policy overrides
- Providing a policy simulation engine for impact analysis before activation
- Publishing policy resolution APIs consumed by operational domains
- Maintaining policy change audit trail

**Business Ownership:** Platform Configuration / HR Operations team. Compliance team defines compliance rule sets.

---

## 2.2 TIER 2 — OPERATIONAL DOMAINS

---

### Domain 05: Attendance Domain

**Why This Domain Exists:**
Attendance is the **primary operational data source** for the platform. Every payroll calculation, every leave deduction, every compliance report, and every productivity analysis begins with the raw fact: *was this employee at work, when did they arrive, when did they leave, and was that time productive?*

This is one of the platform's most technically complex domains. Attendance data arrives from heterogeneous sources (biometric devices, mobile GPS, manual entries, integrated time clocks, QR codes). It must be processed through multiple layers of business rule application: shift matching, grace period application, overtime calculation, break deduction, regularization workflows. The result is a **processed attendance record** that represents a business-agreed version of what happened — not just a raw log.

**Enterprise Importance:**
Attendance directly drives payroll accuracy. In organizations with large hourly or shift-based workforces, even a 1% error rate in attendance processing translates to significant payroll discrepancies. The domain must handle millions of punch records per day for large deployments, with real-time processing SLAs.

**Operational Responsibilities:**
- Ingesting raw attendance events from all capture sources
- Processing punch-in/punch-out records against shift definitions
- Applying attendance policy rules (grace periods, overtime thresholds, rounding)
- Computing daily attendance status (present, absent, late, early departure, OT)
- Managing attendance regularization requests and approvals
- Computing attendance-period summaries (daily, weekly, monthly cycles)
- Publishing processed attendance data for Payroll and Analytics consumption

**Business Ownership:** Operations / Time & Attendance team.

---

### Domain 06: Shift Management Domain

**Why This Domain Exists:**
In any organization with non-standard working hours — manufacturing, retail, hospitality, healthcare, BPO, logistics — the **shift definition** is a core operational artifact. A shift defines not just working hours but break structures, overtime eligibility thresholds, differential pay eligibility, and which attendance policies apply. Shift Management is a dedicated domain because shifts have a complex lifecycle of their own: they are defined, versioned, assigned to work patterns, and linked to both attendance computation and payroll processing.

**Enterprise Importance:**
Without a proper shift management domain, organizations cannot correctly process attendance for multi-shift environments, cannot accurately compute shift differentials in payroll, and cannot enforce the correct overtime rules for night vs. day shifts.

**Operational Responsibilities:**
- Defining and versioning shift types (day, night, split, rotating, flexi)
- Managing shift timing components (start, end, breaks, grace windows)
- Managing work patterns (weekly schedules linking multiple shifts)
- Managing shift-to-policy linkages (which attendance policy applies to this shift)
- Managing shift-to-payroll linkages (which differential/OT rules apply)
- Exposing shift resolution service consumed by Attendance and Roster domains

**Business Ownership:** Operations / Workforce Management team.

---

### Domain 07: Roster Planning Domain

**Why This Domain Exists:**
Roster Planning transforms **shift definitions and employee pools** into an operational plan: who works which shift, on which days, at which location. This is a distinct domain because roster planning involves complex optimization logic: coverage requirements, employee skill matching, fatigue management, leave-awareness, compliance constraints (maximum consecutive working days, minimum rest periods), and cost optimization.

This domain is the bridge between strategic workforce planning and day-to-day operational execution.

**Enterprise Importance:**
In shift-heavy industries, poor rostering directly causes operational failure (understaffing), employee dissatisfaction (unfair scheduling), and compliance violations (exceeding maximum hours). Advanced roster planning with constraint satisfaction is a key differentiator against competitors — most platforms offer basic manual rostering. An AI-assisted constraint-aware roster engine is a genuine enterprise selling point.

**Operational Responsibilities:**
- Creating roster periods and coverage plans
- Assigning employees to shifts within roster cycles
- Managing roster publishing and employee acknowledgment
- Handling roster change requests and swap workflows
- Enforcing roster constraints from the Policy Engine
- Detecting and flagging constraint violations before publishing
- Publishing roster assignments consumed by Attendance for shift-matching

**Business Ownership:** Operations / Scheduling team.

---

### Domain 08: Leave Management Domain

**Why This Domain Exists:**
Leave management is a **legal and contractual obligation** in every jurisdiction. Every employment contract defines leave entitlements — annual leave, sick leave, maternity/paternity, compensatory off, and jurisdiction-specific types. The Leave domain manages the complete lifecycle: entitlement accrual, balance management, application, approval, and consumption — with full traceability.

Leave is deeply intertwined with attendance (approved leave must explain absence), payroll (leave encashment, leave without pay deductions), and compliance (statutory leave obligations must be honored).

**Enterprise Importance:**
Leave errors are among the most visible employee grievances. Incorrect balance calculations, denied valid applications, or missed accruals cause immediate employee dissatisfaction and potential legal exposure. The Leave domain must be mathematically precise and fully auditable.

**Operational Responsibilities:**
- Defining leave types and entitlement rules per policy
- Managing leave balance lifecycle (accrual, carry-forward, lapsing)
- Processing leave applications through approval workflows
- Validating leave requests against balances and blackout dates
- Coordinating leave approval status with Attendance (absence justification)
- Publishing leave data for Payroll (LOP deductions, encashment processing)
- Managing leave plan views for managers (team calendar)
- Handling complex leave scenarios: half-day, hourly leave, comp-off, leave splitting

**Business Ownership:** HR Operations / Leave Administration team.

---

## 2.3 TIER 3 — FINANCIAL DOMAINS

---

### Domain 09: Payroll Domain

**Why This Domain Exists:**
Payroll is the **highest-stakes financial domain** in the platform. Every calculation must be correct — legally, contractually, and mathematically. The domain transforms attendance records, leave records, policy rules, compensation structures, and statutory deduction schedules into the definitive financial fact: *what does the organization owe each employee, and what must be withheld?*

Payroll is a complex computation engine, not a simple sum. It must handle: multiple pay components (basic, HRA, special allowances), variable pay (overtime, incentives, commissions), statutory deductions (taxes, social security contributions), voluntary deductions (loans, advances, insurance), arrear calculations, mid-month joiners/exits, and retroactive corrections.

**Enterprise Importance:**
Payroll errors are financially and legally consequential. Underpayment creates legal liability. Overpayment is a loss. Incorrect tax deductions trigger regulatory penalties. The Payroll domain must be treated with the same rigor as a financial accounting system — every computation must be explainable, traceable, and auditable.

**Operational Responsibilities:**
- Managing pay structures and compensation components
- Executing the payroll run computation cycle
- Processing earnings: fixed components, variable components, OT, incentives
- Processing deductions: statutory, voluntary, loan repayments, advances
- Applying tax computation and withholding rules
- Generating payslips with full component-level breakdown
- Managing payroll corrections and reversals
- Producing bank transfer files and payment instructions
- Publishing payroll completion events for downstream (Compliance, Analytics, Finance)
- Managing payroll period closure and finalization

**Business Ownership:** Payroll / Finance team. Statutory compliance co-owned with Compliance domain.

---

### Domain 10: Compensation & Benefits Domain

**Why This Domain Exists:**
Compensation and Benefits is distinct from Payroll even though they are related. Payroll *executes* compensation; Compensation & Benefits *defines* it. This domain owns the compensation architecture: salary bands, grade structures, benefit plans, reimbursement policies, and the compensation review lifecycle. It is the **definition layer** that Payroll consumes as configuration.

**Enterprise Importance:**
Compensation architecture is strategic. Salary band management, benefits administration, and compensation benchmarking are core to talent retention. Enterprise CHRO teams need visibility into compensation equity, range penetration, and total reward cost modeling — capabilities that require this to be a first-class domain.

**Operational Responsibilities:**
- Managing compensation bands and grade structures
- Managing benefit plan definitions and employee enrollments
- Processing reimbursement claims and approvals
- Managing flexible benefit allocation
- Coordinating compensation review cycles
- Publishing compensation structures consumed by Payroll

**Business Ownership:** Compensation & Benefits / Total Rewards team.

---

### Domain 11: Asset Management Domain

**Why This Domain Exists:**
Organizations issue physical and digital assets to employees: laptops, phones, access cards, uniforms, vehicles, software licenses. These have financial value, require tracking, and must be recovered at offboarding. While not the most complex domain, Asset Management is operationally important and has clear integration points with Employee lifecycle (onboarding triggers issuance; offboarding triggers return).

**Enterprise Importance:**
For organizations with large field forces or IT-heavy workforces, untracked asset issuance creates significant financial exposure. Integration with offboarding workflows ensures asset return is a prerequisite for full and final settlement processing.

**Operational Responsibilities:**
- Managing asset catalog and stock levels
- Processing asset issuance and return transactions
- Tracking asset condition and maintenance history
- Integrating with offboarding clearance workflows
- Publishing asset status for Finance and Audit domains

**Business Ownership:** IT / Admin / Facilities team.

---

## 2.4 TIER 4 — PROCESS DOMAINS

---

### Domain 12: Workflow & Approvals Domain

**Why This Domain Exists:**
The vast majority of HRMS operations require human approval: leave requests, attendance regularizations, payroll corrections, asset requests, expense reimbursements, onboarding steps, offboarding clearances. The Workflow domain provides the **generic approval orchestration engine** that all other domains use to route their approval-requiring entities through configurable multi-step, multi-actor approval chains.

This is critically a **generic orchestration domain** — it does not contain business logic. It knows nothing about what a "leave request" means. It only knows that a given entity needs to move through a sequence of approval stages, that each stage has actors, that actors can approve/reject/delegate, and that completion triggers downstream events. Business logic stays in the originating domain.

**Enterprise Importance:**
Enterprise organizations have complex approval hierarchies. A leave approval might require: immediate manager → department head → HR admin, with escalation rules if any stage is pending beyond 48 hours. The workflow engine must be configurable enough to model any organization's approval patterns without code changes.

**Operational Responsibilities:**
- Defining workflow templates (stages, actors, escalation rules, conditions)
- Instantiating workflow instances for domain-submitted approval requests
- Routing approvals to the correct actors based on org hierarchy and role
- Managing approval actions (approve, reject, delegate, recall)
- Enforcing SLA monitoring and escalation
- Publishing workflow completion events back to originating domains
- Providing the manager approval workspace interface

**Business Ownership:** HR Operations / Platform team. Workflow templates owned by individual business domains.

---

### Domain 13: Compliance Domain

**Why This Domain Exists:**
Every jurisdiction in which the organization operates imposes statutory obligations: labor law compliance, statutory contribution schedules (PF, ESI, SOCSO, CPF, etc.), employment standards, data privacy obligations (GDPR, PDPA), and industry-specific regulations. The Compliance domain **models these obligations, monitors adherence, and generates required statutory reports**.

This is not merely a reporting domain — it is an active governance domain that can reject payroll runs that would violate statutory minimums, flag attendance patterns that breach working time regulations, and alert on employees approaching maximum consecutive working day limits.

**Enterprise Importance:**
Non-compliance is not just a risk — it is a business blocker. Enterprise customers in regulated industries (BFSI, pharma, government) will not deploy a platform that cannot demonstrate statutory compliance automation. Darwinbox, Workday, and UKG all have dedicated compliance modules. This domain is table stakes for enterprise sales.

**Operational Responsibilities:**
- Managing jurisdiction-based statutory rule sets
- Monitoring payroll outputs against statutory minimum wage floors
- Generating statutory reports (PF challans, tax filings, labor returns)
- Managing statutory computation tables (tax slabs, contribution rates)
- Monitoring attendance patterns for working time regulation adherence
- Publishing compliance alerts as domain events
- Maintaining compliance audit trails for regulatory inspection

**Business Ownership:** Legal / Statutory Compliance team. Shared with Payroll for computation.

---

### Domain 14: Documents Domain

**Why This Domain Exists:**
The employment lifecycle generates a significant volume of documents: offer letters, appointment letters, confirmation letters, contract amendments, payslips, tax certificates, experience certificates, warning letters. The Documents domain manages the **generation, storage, versioning, access control, and employee self-service delivery** of all employment documents.

**Enterprise Importance:**
Document management has legal weight — employment documents are contractual evidence. Unauthorized access to salary slips or disciplinary letters is a PII/GDPR issue. The Documents domain must enforce fine-grained access control and maintain a complete issuance trail.

**Operational Responsibilities:**
- Managing document templates with dynamic field substitution
- Generating documents from templates triggered by domain events
- Managing document storage with tenant-isolated access control
- Managing employee self-service document download
- Managing document digital signature workflows
- Maintaining document issuance history and access logs

**Business Ownership:** HR Operations team. Legal team owns template content.

---

### Domain 15: Notifications Domain

**Why This Domain Exists:**
Every significant operation in the platform must communicate with affected parties: leave approvals, payroll processing, shift assignments, policy changes, compliance alerts. The Notifications domain provides the **centralized communication dispatch engine** that decouples event producers from communication delivery.

This domain is a pure consumer — it subscribes to events from all other domains and executes the appropriate notification dispatch (email, SMS, push, in-app, webhook) based on configurable notification templates and delivery preferences.

**Operational Responsibilities:**
- Managing notification templates per event type and channel
- Managing user notification preferences and channel opt-outs
- Dispatching notifications across channels (email, SMS, push, in-app)
- Managing delivery status tracking and retry logic
- Providing notification inbox for in-app notification center
- Managing bulk notification campaigns for HR communications

**Business Ownership:** Platform team. Template content owned by operational teams.

---

### Domain 16: Recruitment Domain

**Why This Domain Exists:**
While the current system does not have a mature recruitment module, it is a critical future domain. Recruitment represents the **pre-employment phase** of the workforce lifecycle — candidate sourcing, screening, interview management, offer generation, and the handoff into the Employee domain at hire. The integration between Recruitment and Employee onboarding is one of the highest-friction points in current HRMS platforms.

**Enterprise Importance:**
The candidate-to-employee conversion is a critical lifecycle moment. Data captured during recruitment (personal details, documents, compensation agreements) should flow seamlessly into onboarding without re-entry. This integration quality is a key differentiator.

**Operational Responsibilities:**
- Managing job requisitions and approval workflows
- Managing candidate applications and pipeline stages
- Managing interview scheduling and feedback collection
- Managing offer generation and acceptance tracking
- Publishing hire events that trigger Employee onboarding workflows
- Maintaining recruitment analytics (time-to-hire, source effectiveness)

**Business Ownership:** Talent Acquisition team.

---

### Domain 17: Performance Management Domain

**Why This Domain Exists:**
Performance Management is the **structured evaluation of employee contribution** against defined objectives and competency frameworks. It owns the goal-setting cycle, mid-year reviews, annual appraisals, 360-degree feedback, and performance improvement plans. Its outputs feed into Compensation Review (promotion, increment decisions) and potentially into Compliance (disciplinary action documentation).

**Enterprise Importance:**
Performance data is increasingly important as input for AI-driven workforce intelligence. Correlating performance ratings with attendance patterns, tenure, role, and compensation enables predictive models for attrition risk and high-performer identification.

**Operational Responsibilities:**
- Managing performance cycle definitions
- Managing goal-setting and cascading
- Managing review form templates and rating scales
- Processing performance review workflows
- Managing 360-degree feedback collection
- Publishing performance outcomes consumed by Compensation and Analytics

**Business Ownership:** People Development / Talent Management team.

---

## 2.5 TIER 5 — INTELLIGENCE DOMAINS

---

### Domain 18: Analytics Domain

**Why This Domain Exists:**
The Analytics domain is the **intelligence infrastructure** of the platform. It is not a reporting tool bolted on top of the OLTP database — it is a dedicated domain that owns read-optimized data projections, materialized analytical views, and the computation of business KPIs across the workforce. It consumes events from all operational domains and builds the analytical data model that powers dashboards, reports, and AI feature inputs.

The fundamental design principle: **the OLTP database is never directly queried for analytics**. Analytics data lives in analytics-owned projections, populated by domain events in near-real-time or via batch aggregation.

**Enterprise Importance:**
CHRO-level reporting, operational dashboards, and regulatory submissions all depend on the Analytics domain. Real-time workforce visibility (how many employees are currently checked in, what is today's absenteeism rate, which departments are understaffed) is a core operational need for large enterprises.

**Operational Responsibilities:**
- Maintaining workforce data projections from domain events
- Computing workforce KPIs (headcount, attrition, absenteeism, overtime rates)
- Providing the query layer for dashboard and report builders
- Managing pre-aggregated summary tables for performance-critical reports
- Publishing analytical datasets for AI/ML feature pipelines
- Managing tenant-scoped report definitions and scheduled delivery

**Business Ownership:** Data / Analytics Platform team. Dashboard definitions owned by operational teams.

---

### Domain 19: AI Intelligence Domain

**Why This Domain Exists:**
This domain orchestrates the platform's **AI-native capabilities** — not as isolated features, but as a coordinated intelligence layer that augments every operational domain. It owns the AI model lifecycle, vector memory stores, prediction pipelines, and the AI copilot infrastructure that surfaces intelligence within operational workspaces.

This is a deliberate architectural boundary: AI features are not scattered across operational domains as ad-hoc ML calls. They are centralized in an AI orchestration domain that consumes analytical data and operational events, runs inference, and publishes recommendations back to operational domains via well-defined contracts.

**Enterprise Importance:**
AI-native HRMS is the competitive frontier. Competitors like Darwinbox and Rippling are investing heavily in AI-driven HR workflows. The AI Intelligence domain is what transforms this platform from a "system of record" into a "system of intelligence" — and is the primary long-term differentiator.

**Operational Responsibilities:**
- Managing AI model registry and deployment pipeline
- Orchestrating prediction jobs (attrition risk, attendance prediction, payroll anomaly detection)
- Managing vector memory for context-aware AI copilots
- Generating and publishing AI recommendations consumed by operational domains
- Managing AI copilot conversation state and session context
- Monitoring AI model performance and drift detection
- Providing AI feature APIs consumed by frontend workspaces

**Business Ownership:** AI / Data Science Platform team.

---

### Domain 20: Audit & Governance Domain

**Why This Domain Exists:**
Every state-changing operation in the platform must be traceable — who did what, to which record, at what time, and from where. The Audit & Governance domain builds the **immutable audit ledger** by consuming domain events from all other domains. It is a pure consumer domain — it never writes to other domains, it only accumulates the audit record.

**Enterprise Importance:**
Enterprise customers — particularly in regulated industries — require full audit trails for compliance inspection. The ability to replay the complete history of any record (payroll computation inputs, leave balance changes, attendance corrections) is a non-negotiable feature for regulated industries.

**Operational Responsibilities:**
- Consuming domain events from all write domains
- Storing immutable audit records with full context payload
- Providing audit query APIs for compliance inspection
- Managing audit retention policies per data category and jurisdiction
- Generating audit reports for regulatory submission
- Detecting and alerting on suspicious access patterns (security audit)

**Business Ownership:** Compliance / Legal / Security team.

---

### Domain 21: Integration Platform Domain

**Why This Domain Exists:**
Enterprise customers do not operate in isolation. They have existing ERP systems (SAP, Oracle), financial systems, biometric device vendors, SSO providers, and third-party applications. The Integration Platform domain provides the **managed integration layer** for bidirectional data exchange with external systems — with transformation, error handling, monitoring, and rate management.

**Enterprise Importance:**
Integration capability is one of the top enterprise procurement criteria. The ability to integrate with SAP HR, Oracle HRMS, Kronos time systems, ADP payroll outputs, and biometric device SDKs is mandatory for large enterprise deployments.

**Operational Responsibilities:**
- Managing integration connector definitions and authentication
- Processing inbound data transformations and validation
- Dispatching outbound data to external systems
- Managing webhook registrations and delivery
- Monitoring integration health, error rates, and retry queues
- Providing integration audit trails for data exchange verification

**Business Ownership:** Platform / Integration Engineering team.

---

### Domain 22: Mobile Workforce Domain

**Why This Domain Exists:**
A dedicated Mobile Workforce domain addresses the **specific operational needs of field-based and remote employees** whose work patterns, attendance capture methods, and workspace interactions differ significantly from office-based employees. This includes geo-fenced attendance capture, offline-capable time logging, field task management, and mobile-optimized approval workflows.

**Enterprise Importance:**
For enterprises with large field forces (logistics, construction, utilities, healthcare field staff), mobile workforce capability is not an enhancement — it is a core requirement. GPS-based attendance, offline sync, and mobile-first approval flows must be first-class platform features.

**Operational Responsibilities:**
- Managing geo-fence definitions for location-based attendance
- Processing mobile attendance capture with GPS validation
- Managing offline data synchronization and conflict resolution
- Providing mobile-optimized approval and self-service capabilities
- Managing mobile session security and device registration

**Business Ownership:** Mobile Platform / Operations team.




---


# SECTION 3: BOUNDED CONTEXT MODELING

---

> Each bounded context is modeled across 15 dimensions (A–O). This section covers the six most operationally critical domains in full depth. Remaining domains follow the same structural template.

---

## BC-01: IDENTITY & ACCESS MANAGEMENT (IAM)

### A. Domain Purpose
IAM is the **authentication and authorization authority** for the entire platform. It owns the identity of every actor (human user, system agent, API client) and defines what each actor is permitted to do within what scope. It is the exclusive gatekeeper between the external world and all domain operations.

### B. Core Responsibilities
- User authentication (password, MFA, SSO/SAML/OIDC)
- Session lifecycle management (token issuance, refresh, revocation)
- Role definition and role-to-permission mapping
- Permission enforcement through attribute-based access control (ABAC)
- API key and OAuth client management
- Tenant-scoped user provisioning
- Delegated access management (acting-as, delegation chains)
- Security event logging (failed logins, suspicious access)
- Password policies and credential rotation enforcement

### C. Aggregates

**`UserAccount`** — Root aggregate for a platform user identity.
```
UserAccount {
  user_id: UUID                    // canonical identity
  tenant_id: UUID                  // tenant scope
  identity_type: ENUM              // human | service_account | api_client
  credential_hash: CredentialHash  // value object
  mfa_config: MFAConfiguration     // value object
  status: AccountStatus            // active | suspended | locked | deprovisioned
  last_login: Timestamp
  failed_attempts: Integer
  sessions: [Session]              // child entities
}
```

**`Role`** — Named permission grouping within a tenant scope.
```
Role {
  role_id: UUID
  tenant_id: UUID
  role_code: RoleCode              // value object — immutable identifier
  permissions: [PermissionGrant]   // value objects
  scope_constraints: ScopeSet      // org units, locations this role applies to
  effective_period: DateRange      // value object
}
```

**`PermissionPolicy`** — ABAC policy rule that evaluates context.
```
PermissionPolicy {
  policy_id: UUID
  tenant_id: UUID
  resource_type: ResourceType
  action: Action
  conditions: [PolicyCondition]    // attribute expressions
  effect: ALLOW | DENY
  priority: Integer
}
```

### D. Value Objects
- `CredentialHash` — Bcrypt/Argon2 hashed credential, not raw password
- `RoleCode` — Immutable string code for cross-system role reference
- `PermissionGrant` — `{ resource, action, scope }` triple
- `ScopeSet` — Set of org unit / location identifiers constraining role authority
- `DateRange` — `{ effective_from, effective_to }` for time-bounded grants
- `JWTClaims` — Signed claim bundle for token payload
- `SessionFingerprint` — Device/IP/UA signature for session anomaly detection

### E. Domain Services
- `AuthenticationService` — Validates credentials, issues tokens, enforces MFA
- `AuthorizationService` — Evaluates permission policies against request context
- `SessionService` — Manages token lifecycle, refresh, and revocation
- `UserProvisioningService` — Creates/updates/deprovisions user accounts
- `SSOBridgeService` — Handles SAML/OIDC federation with enterprise IdPs
- `PasswordPolicyService` — Enforces credential complexity and rotation rules

### F. Ownership Boundaries
IAM exclusively owns:
- All `UserAccount` records and their credential state
- All `Role` and `PermissionPolicy` definitions within a tenant
- All active session tokens
- The canonical mapping of `employee_id → user_id` (published, not owned by Employee domain)

### G. What This Domain MUST NOT Own
- Employee profile details (name, department, contact) — owned by Employee domain
- Business-level permissions logic ("can approve leave for subordinates") — policy expressed in Role, but subordinate resolution is Organization domain's responsibility
- Audit log storage — IAM emits security events; Audit domain stores them
- Application-level feature flags — owned by a Platform Configuration service

### H. Dependencies
- **Organization Domain** — For resolving reporting hierarchy used in ABAC scope evaluation (e.g., "can manage employees in own department")
- **Employee Domain** — For employee-to-user linkage validation during provisioning
- **Audit Domain** — Event consumer only; IAM publishes, Audit stores

### I. External Interfaces

**Published APIs (OHS):**
- `POST /auth/token` — Authentication and token issuance
- `POST /auth/refresh` — Token refresh
- `POST /auth/revoke` — Session termination
- `GET /auth/introspect` — Token validation for other services
- `GET /users/{id}/permissions` — Permission set query for UI rendering
- `POST /users` — User provisioning
- `GET /roles` — Role catalog

**Published Events:**
- `iam.user.provisioned` `{user_id, tenant_id, identity_type}`
- `iam.user.deprovisioned` `{user_id, tenant_id}`
- `iam.session.created` `{user_id, session_id, ip, device}`
- `iam.session.revoked` `{user_id, session_id, reason}`
- `iam.login.failed` `{user_id, tenant_id, ip, attempt_count}`
- `iam.role.assigned` `{user_id, role_id, assigned_by}`
- `iam.role.revoked` `{user_id, role_id}`

### J. Read vs Write Ownership
- **Write:** All credential and session state changes are write-heavy; strict transactional consistency required
- **Read:** Permission evaluation must be extremely fast (sub-5ms); permission resolution results may be cached with short TTL (30–60s). Role and permission queries served from in-memory cache refreshed on role change events

### K. Sync vs Async Operations
- **Synchronous:** Token validation (every API request depends on this), authentication, permission checks
- **Asynchronous:** User provisioning notifications, security event audit trail, cross-tenant role sync (enterprise SSO)

### L. Multi-Tenant Considerations
- `tenant_id` is a mandatory partition key on all IAM tables
- Role definitions are tenant-scoped; platform-level roles (super admin) are specially partitioned
- SSO configurations are per-tenant; IdP federation is tenant-specific
- Session tokens carry `tenant_id` claim and are validated against tenant-specific policies
- Cross-tenant access (holding company scenarios) requires explicit delegation grants, never implicit

### M. Security Considerations
- Credential hashes must use Argon2id (not bcrypt, not MD5/SHA1)
- Tokens must be short-lived (15-minute access tokens; 7-day refresh tokens)
- Refresh token rotation must be enforced (invalidate old refresh on use)
- All failed authentication events must be rate-limited and alerted above threshold
- Session fingerprinting enables anomalous session detection
- PII in IAM is minimal: user_id is opaque, linkage to employee PII is in Employee domain

### N. Analytics Considerations
IAM emits security telemetry consumed by Analytics:
- Login frequency by user, device, location
- Session duration distribution
- Failed login rate by tenant and IP
- Permission usage heatmap (which permissions are exercised, which are dead)
- Suspicious access pattern detection feed for Security Analytics dashboard

### O. AI Readiness Considerations
- AI Security Agent: anomalous login pattern detection (unusual hours, unknown device, new geography)
- AI can consume permission usage data to suggest role right-sizing (least-privilege recommendations)
- Zero-trust AI validation: AI agents operating as service accounts require IAM-issued short-lived tokens with minimal scope, reviewed and rotated automatically

---

## BC-02: ORGANIZATION DOMAIN

### A. Domain Purpose
The Organization domain is the **canonical structural model of the enterprise**. It owns the legal entity hierarchy, organizational units, locations, cost centers, and the employee reporting tree. All other domains reference the organizational model for contextual resolution — but only the Organization domain may modify it.

### B. Core Responsibilities
- Managing the legal entity tree (holding company → subsidiaries → branches)
- Managing organizational units (division → department → team → sub-team)
- Managing physical and virtual locations
- Managing cost centers and financial mapping
- Managing the employee reporting hierarchy (manager → direct report relationships)
- Processing organizational restructuring events with full history preservation
- Resolving org context for any given employee at any point in time (historically)
- Publishing organizational snapshots for downstream domain consumption

### C. Aggregates

**`LegalEntity`** — Root for the company/subsidiary structure.
```
LegalEntity {
  entity_id: UUID
  tenant_id: UUID
  entity_code: EntityCode          // value object
  entity_type: ENUM                // holding | subsidiary | branch | division
  registration_details: RegistrationInfo  // jurisdiction, registration number
  parent_entity_id: UUID?          // null for root
  effective_period: DateRange
  status: EntityStatus
}
```

**`OrganizationalUnit`** — Department/team/business unit node.
```
OrganizationalUnit {
  unit_id: UUID
  tenant_id: UUID
  entity_id: UUID                  // owning legal entity
  parent_unit_id: UUID?            // tree structure
  unit_code: UnitCode
  unit_type: UnitType              // division | department | team | project
  cost_center_id: UUID?            // optional cost center linkage
  effective_period: DateRange
  head_employee_id: UUID?          // who leads this unit
}
```

**`Location`** — Physical or virtual work location.
```
Location {
  location_id: UUID
  tenant_id: UUID
  entity_id: UUID
  location_code: LocationCode
  location_type: ENUM              // office | site | remote | field
  address: PostalAddress           // value object
  geo_coordinates: GeoPoint        // value object
  timezone: Timezone               // value object
  attendance_policy_id: UUID?      // policy assignment
}
```

**`ReportingRelationship`** — Directed edge in the org reporting graph.
```
ReportingRelationship {
  relationship_id: UUID
  tenant_id: UUID
  employee_id: UUID
  manager_id: UUID
  relationship_type: ENUM          // direct | dotted_line | functional
  effective_period: DateRange
}
```

### D. Value Objects
- `EntityCode` — Short immutable identifier (e.g., "ACME-SG")
- `UnitCode` — Department short code
- `PostalAddress` — `{street, city, state, country, postal_code}`
- `GeoPoint` — `{latitude, longitude}` for geofencing
- `Timezone` — IANA timezone string
- `DateRange` — `{effective_from, effective_to}` for all structural nodes
- `OrgPath` — Materialized path string for efficient tree queries (`/ROOT/DIV01/DEPT03/`)

### E. Domain Services
- `OrgTreeService` — Resolves full ancestor/descendant paths, supports point-in-time queries
- `ReportingHierarchyService` — Resolves reporting chains (who are the direct/indirect reports of manager X)
- `OrgSnapshotService` — Produces point-in-time org snapshots for historical query and analytics
- `RestructuringService` — Processes bulk org changes with effective-date versioning and event publication
- `CostCenterService` — Manages cost center assignment and employee cost allocation

### F. Ownership Boundaries
Organization exclusively owns:
- The canonical organizational hierarchy tree
- All location definitions and geo-configurations
- All reporting relationship records
- Cost center definitions (financial mapping is Finance domain; the definition is here)
- Point-in-time organizational snapshots

### G. What This Domain MUST NOT Own
- Employee personal details — owned by Employee domain
- Attendance policies assigned to locations — Policy Engine owns rule sets; Organization only holds the reference/linkage
- Payroll cost center allocations — Payroll reads cost center IDs from Organization; financial ledger posting is Finance domain
- User access scoping rules — IAM owns permission policies; they may reference org unit IDs but Organization does not enforce them

### H. Dependencies
- **IAM Domain** — For validating that org change actors are authorized
- **Policy Engine** — For validating that org structures comply with configured constraints
- **Employee Domain** — Consumes `employee.created` / `employee.transferred` events to update reporting relationships

### I. External Interfaces

**Published APIs (OHS):**
- `GET /org/units/{id}` — Unit detail with hierarchy context
- `GET /org/units?employee_id=X&at=DATE` — Org unit for employee at date
- `GET /org/reporting-chain/{employee_id}` — Full upward chain
- `GET /org/direct-reports/{manager_id}` — Direct reports list
- `GET /org/locations` — Location catalog
- `GET /org/snapshot?at=DATE` — Full org snapshot at timestamp

**Published Events:**
- `org.unit.created` `{unit_id, tenant_id, parent_unit_id, effective_from}`
- `org.unit.restructured` `{unit_id, old_parent_id, new_parent_id, effective_from}`
- `org.unit.deactivated` `{unit_id, effective_from}`
- `org.reporting.changed` `{employee_id, old_manager_id, new_manager_id, effective_from}`
- `org.location.created` `{location_id, tenant_id}`
- `org.costcenter.reassigned` `{unit_id, old_cc_id, new_cc_id, effective_from}`

### J. Read vs Write Ownership
- **Write:** Structural changes are low-frequency but high-impact; require transactional integrity
- **Read:** Extremely high read volume — nearly every domain query involves org context. Org tree must be cached aggressively. Materialized path (`ltree` in Postgres) enables efficient ancestor/descendant queries without recursive CTEs on every request. Analytics projections maintain their own org dimension table.

### K. Sync vs Async Operations
- **Synchronous:** Org tree resolution (every request needs org context), hierarchy traversal
- **Asynchronous:** Restructuring event propagation to downstream domains, org snapshot publication for analytics, reporting hierarchy rebuild after bulk changes

### L. Multi-Tenant Considerations
- All org nodes are tenant-scoped; no cross-tenant hierarchy traversal
- Multi-entity tenants (holding companies managing subsidiaries) are modeled within a single tenant via LegalEntity hierarchy
- Org tree partitioning by `tenant_id` enables full row-level isolation

### M. Security Considerations
- Org structure itself is sensitive — reporting relationships reveal management hierarchies that should not be exposed to unauthorized users
- Row-level security: employees may see their own org path; managers may see their subtree; HR admins see full tenant tree
- Org restructuring operations require elevated authorization and mandatory audit event emission

### N. Analytics Considerations
- Org structure is the primary dimension for all workforce analytics (headcount by department, attrition by business unit)
- Point-in-time snapshots are essential for historical trend analysis (headcount 12 months ago vs. today)
- Analytics maintains its own denormalized `dim_organization` table populated from org events

### O. AI Readiness Considerations
- AI workforce planning agents need historical org evolution data to identify restructuring patterns
- AI can predict cost center budget pressure based on headcount growth trends per org unit
- Org hierarchy is context input for AI copilot responses ("show me attendance for my team")

---

## BC-03: EMPLOYEE DOMAIN

### A. Domain Purpose
The Employee domain is the **system of record for the employment relationship**. It owns the lifecycle from offer acceptance (handoff from Recruitment) through every status change (probation, confirmation, promotion, transfer, leave of absence) to exit. It is the canonical source of employment facts that downstream domains reference.

### B. Core Responsibilities
- Managing the employee master record and employment contract
- Managing employment status lifecycle with full history
- Managing personal information (demographics, contact, identity documents)
- Managing job profile (title, grade, band, employment type, work arrangement)
- Managing onboarding process coordination
- Managing offboarding and exit processing
- Managing emergency contact and dependent records
- Publishing employee reference projections for downstream consumption
- Managing employee self-service profile updates (with approval workflows)

### C. Aggregates

**`Employee`** — Root aggregate. The employment relationship entity.
```
Employee {
  employee_id: UUID                    // canonical cross-domain reference
  tenant_id: UUID
  employee_number: EmployeeNumber      // value object — human-readable ID
  personal_identity: PersonalIdentity  // value object
  employment_status: EmploymentStatus  // active | probation | notice | terminated
  current_assignment: JobAssignment    // value object — current role context
  assignment_history: [JobAssignment]  // full history
  contact_details: ContactInfo         // value object
  emergency_contacts: [EmergencyContact]
  user_account_id: UUID?               // linked IAM identity
  onboarding_status: OnboardingStatus  // entity
  exit_details: ExitRecord?            // entity, null if active
}
```

**`JobAssignment`** — Effective-dated job context (value object in history, entity when current).
```
JobAssignment {
  assignment_id: UUID
  employee_id: UUID
  unit_id: UUID                        // org unit ref (Organization domain)
  location_id: UUID                    // location ref (Organization domain)
  position_id: UUID                    // position definition
  job_title: JobTitle                  // value object
  grade: EmployeeGrade                 // value object
  employment_type: EmploymentType      // full_time | part_time | contract | intern
  work_arrangement: WorkArrangement    // office | remote | hybrid
  reporting_manager_id: UUID           // employee ref
  effective_period: DateRange
  cost_center_id: UUID                 // cost allocation ref
}
```

**`EmploymentContract`** — Legal contract terms.
```
EmploymentContract {
  contract_id: UUID
  employee_id: UUID
  contract_type: ContractType          // permanent | fixed_term | probationary
  start_date: Date
  end_date: Date?
  notice_period: Duration              // value object
  probation_period: Duration
  jurisdiction: Jurisdiction           // value object
  signed_document_id: UUID?            // Document domain reference
}
```

### D. Value Objects
- `EmployeeNumber` — `{prefix, sequence, check_digit}` — human-readable unique identifier
- `PersonalIdentity` — `{legal_name, date_of_birth, gender, nationality, national_id_type, national_id_number}` — PII container
- `JobTitle` — `{title_code, display_name}` — references position catalog
- `EmployeeGrade` — `{grade_code, band, level}` — references compensation structure
- `ContactInfo` — `{personal_email, work_email, phone, address}` — partially PII
- `Duration` — `{value, unit}` — calendar-aware duration type
- `Jurisdiction` — `{country_code, state_code}` — determines applicable compliance rules
- `WorkArrangement` — immutable descriptor of work mode

### E. Domain Services
- `EmployeeLifecycleService` — Processes status transitions with business rule validation
- `OnboardingOrchestrationService` — Coordinates the onboarding task workflow
- `OffboardingOrchestrationService` — Coordinates exit clearance, FNF triggering, account deprovisioning
- `TransferService` — Processes inter-department/inter-entity transfers with org updates
- `EmployeeProjectionService` — Produces read-optimized employee reference projections for other domains
- `DocumentTriggerService` — Requests document generation from Documents domain on lifecycle events

### F. Ownership Boundaries
Employee domain exclusively owns:
- All employee master data and PII
- Employment status history with effective dates
- Job assignment history
- Contract records
- Onboarding/offboarding state machines
- The canonical `employee_id` as the cross-domain identity anchor

### G. What This Domain MUST NOT Own
- Payroll compensation details — owned by Compensation & Benefits domain
- Leave balances — owned by Leave Management domain
- Attendance records — owned by Attendance domain
- User account credentials — owned by IAM domain
- Org unit structure — owned by Organization domain (Employee holds *references* to org IDs, not the org structure itself)
- Performance appraisal records — owned by Performance Management domain

### H. Dependencies
- **IAM Domain** — User account provisioning triggered by employee onboarding; deprovisioning on exit
- **Organization Domain** — For validating org unit, location, and reporting manager references on job assignments
- **Workflow Domain** — For routing onboarding tasks, profile change approvals, and offboarding clearances
- **Documents Domain** — For triggering appointment letter, contract, and experience certificate generation
- **Notifications Domain** — For onboarding communications and lifecycle milestone alerts
- **Policy Engine** — For resolving applicable policies based on employee jurisdiction and employment type

### I. External Interfaces

**Published APIs (OHS):**
- `GET /employees/{id}` — Full employee record (access-controlled by role)
- `GET /employees/{id}/assignment` — Current job assignment context
- `GET /employees/{id}/history` — Employment history timeline
- `GET /employees/search` — Filtered search across tenant employee pool
- `GET /employees/{id}/projection` — Lightweight reference projection for downstream domains

**Published Events:**
- `employee.created` `{employee_id, tenant_id, unit_id, location_id, employment_type, effective_date}`
- `employee.onboarded` `{employee_id, tenant_id, joining_date}`
- `employee.transferred` `{employee_id, old_unit_id, new_unit_id, old_manager_id, new_manager_id, effective_date}`
- `employee.promoted` `{employee_id, old_grade, new_grade, effective_date}`
- `employee.status_changed` `{employee_id, old_status, new_status, effective_date}`
- `employee.exited` `{employee_id, tenant_id, exit_date, exit_type, last_working_date}`
- `employee.profile_updated` `{employee_id, changed_fields[], updated_by}`

### J. Read vs Write Ownership
- **Write:** Status changes, assignment changes, and onboarding/exit operations are write operations with full transactional integrity
- **Read:** Employee lookup is the highest-volume read operation in the entire platform. A **lightweight Employee Reference Projection** (employee_id, name, unit_id, location_id, manager_id, employment_type, status) is maintained as a denormalized read model, updated by `employee.*` events. All downstream domains consume the projection, never the write model directly.

### K. Sync vs Async Operations
- **Synchronous:** Employee record retrieval, status validation during workflow submission
- **Asynchronous:** IAM provisioning/deprovisioning, document generation triggers, leave balance initialization on join, payroll enrollment trigger, org reporting relationship update

### L. Multi-Tenant Considerations
- All employee data is tenant-partitioned at the database schema level
- PII fields must be encrypted at rest with tenant-specific encryption keys
- Cross-entity employee transfers (within multi-entity tenant) require explicit transfer transaction; employee_id remains stable, legal entity reference changes
- Tenant-level employee number sequences are managed to avoid collisions

### M. Security Considerations
- Employee domain contains the most sensitive PII in the platform: national IDs, date of birth, address, contact details
- Field-level encryption for national_id_number, date_of_birth, bank_account_details (when stored here temporarily)
- Column-level access control: HR managers see full PII; line managers see subset (name, contact); peers see display name only
- GDPR right-to-erasure: personal fields must support pseudonymization while preserving employment facts for statutory retention
- All PII access events logged to Audit domain with field-level granularity

### N. Analytics Considerations
- Headcount metrics (active, new hire, termination counts)
- Tenure distribution, attrition rate, retention rate
- Diversity metrics (gender, nationality distribution — aggregate only, never individual-level in analytics)
- Grade distribution and promotion velocity
- Employment type mix (full-time vs. contract ratio)

### O. AI Readiness Considerations
- **Attrition Prediction:** AI models consume employee tenure, grade, transfer history, and performance signals to predict attrition risk at 30/60/90 day horizon
- **Career Path Intelligence:** AI analyzes historical promotion patterns to recommend career development interventions
- **Onboarding Optimization:** AI identifies onboarding completion patterns that correlate with higher retention

---

## BC-04: ATTENDANCE DOMAIN

### A. Domain Purpose
The Attendance domain is the **operational core of the workforce time tracking system**. It owns the complete pipeline from raw attendance event ingestion through multi-stage processing to finalized daily attendance records. It is the authoritative source of "did this employee work, for how long, under what conditions" — facts that drive payroll, compliance, and workforce analytics.

### B. Core Responsibilities
- Ingesting raw attendance events from all capture sources (biometric, mobile, manual, integration)
- Deduplicating and validating raw punch events
- Processing punches against shift assignments to compute daily attendance
- Applying policy rules (grace periods, overtime thresholds, break deductions, rounding rules)
- Computing shift-level and day-level attendance status
- Managing regularization requests for incomplete or disputed attendance
- Computing attendance period summaries (weekly, monthly cycles)
- Managing attendance corrections and their audit trails
- Publishing processed attendance data for Payroll and Analytics

### C. Aggregates

**`AttendanceCycle`** — The period-level computation container.
```
AttendanceCycle {
  cycle_id: UUID
  tenant_id: UUID
  employee_id: UUID
  period: AttendancePeriod            // value object {year, month, period_type}
  status: CycleStatus                 // open | processing | finalized | locked
  daily_records: [DailyAttendance]    // child entities
  summary: AttendanceSummary          // value object — computed totals
  processed_at: Timestamp?
  locked_at: Timestamp?
  locked_by: UUID?
}
```

**`DailyAttendance`** — The core operational record for one employee on one day.
```
DailyAttendance {
  daily_id: UUID
  cycle_id: UUID
  employee_id: UUID
  attendance_date: Date
  shift_id: UUID?                     // assigned shift (from Roster/Shift domain)
  punches: [ProcessedPunch]           // ordered punch sequence
  first_in: Timestamp?
  last_out: Timestamp?
  effective_hours: Duration           // policy-adjusted working duration
  overtime_hours: Duration            // OT beyond threshold
  attendance_status: AttendanceStatus // present | absent | late | half_day | OT | holiday | weekend
  shift_status: ShiftComplianceStatus // on_time | late | early_departure | absent
  leave_linked: UUID?                 // linked leave application if absence is leave-justified
  regularization: RegularizationRecord?
  is_manually_overridden: Boolean
  source: AttendanceSource            // biometric | mobile | manual | integration
}
```

**`RawPunchEvent`** — Immutable inbound event from any capture source.
```
RawPunchEvent {
  event_id: UUID
  tenant_id: UUID
  employee_id: UUID
  device_id: UUID?
  raw_timestamp: Timestamp
  punch_type: PunchType               // in | out | break_start | break_end
  source_type: SourceType             // biometric | mobile_gps | manual | api
  geo_location: GeoPoint?
  device_metadata: DeviceMetadata     // value object
  is_processed: Boolean
  processing_notes: String[]
}
```

**`RegularizationRequest`** — Employee-submitted attendance correction.
```
RegularizationRequest {
  request_id: UUID
  daily_attendance_id: UUID
  employee_id: UUID
  claimed_in: Timestamp?
  claimed_out: Timestamp?
  reason: RegularizationReason        // value object
  workflow_instance_id: UUID          // Workflow domain reference
  status: RequestStatus               // pending | approved | rejected
  applied_at: Timestamp?
}
```

### D. Value Objects
- `AttendancePeriod` — `{year, month, period_type: weekly|biweekly|monthly}`
- `AttendanceSummary` — `{total_present_days, total_absent_days, total_ot_hours, total_late_instances, total_effective_hours, lop_days}` — computed aggregate
- `ProcessedPunch` — `{raw_event_id, normalized_timestamp, punch_type, is_valid, validation_notes}`
- `GraceWindow` — `{late_grace_minutes, early_departure_grace_minutes}` — from Policy Engine
- `OvertimeThreshold` — `{daily_threshold_hours, weekly_threshold_hours, computation_method}` — from Policy Engine
- `ShiftComplianceStatus` — computed status comparing actual vs. expected shift timing
- `AttendanceSource` — `{source_type, device_id, capture_method}`

### E. Domain Services
- `PunchIngestionService` — Validates and persists raw punch events from all sources; deduplication logic
- `AttendanceProcessingService` — Executes the multi-step processing pipeline per employee per day
- `ShiftMatchingService` — Determines which shift assignment applies to a given employee on a given date (delegates shift data to Shift domain projection)
- `PolicyApplicationService` — Fetches applicable attendance policy from Policy Engine and applies rules to raw duration data
- `OvertimeComputationService` — Computes OT hours against policy-defined thresholds (daily, weekly, rolling)
- `RegularizationService` — Processes regularization submissions and applies approved corrections
- `PeriodFinalizationService` — Locks a cycle after payroll cutoff; prevents further modification
- `AttendanceProjectionService` — Produces payroll-ready and analytics-ready projections of finalized attendance

### F. Ownership Boundaries
Attendance domain exclusively owns:
- All raw punch events (immutable once stored)
- All daily attendance records and their computed values
- All attendance cycle summaries
- Regularization request state (workflow state managed in Workflow domain, but attendance domain holds the business record)
- The processed attendance projection published to Payroll

### G. What This Domain MUST NOT Own
- Shift definitions — owned by Shift Management domain (consumed as projection)
- Leave records — owned by Leave Management domain (attendance references leave to explain absences)
- Payroll computation — Attendance domain produces inputs to Payroll; computation is Payroll's responsibility
- Biometric device management — owned by Mobile/Integration domain
- Employee personal details — consumed from Employee projection

### H. Dependencies
- **Policy Engine** — For fetching applicable attendance rules per employee (grace periods, OT thresholds, rounding rules)
- **Shift Management Domain** — For resolving shift assignment for a given employee on a given date
- **Roster Planning Domain** — For accessing published roster schedules
- **Employee Domain** — For validating employee existence and employment status
- **Leave Management Domain** — For checking approved leave to justify absences in processing
- **Workflow Domain** — For routing regularization requests through approval chains
- **Organization Domain** — For location-level policy resolution

### I. External Interfaces

**Published APIs (OHS):**
- `POST /attendance/punch` — Real-time punch submission from devices/mobile
- `GET /attendance/{employee_id}/daily?date=X` — Daily attendance record
- `GET /attendance/{employee_id}/cycle?period=X` — Period summary
- `GET /attendance/team?manager_id=X&date=X` — Manager team view
- `POST /attendance/regularize` — Submit regularization request
- `GET /attendance/payroll-projection?employee_id=X&period=X` — Payroll-ready data

**Published Events:**
- `attendance.punched` `{employee_id, tenant_id, punch_type, timestamp, source, location}`
- `attendance.daily.processed` `{employee_id, date, status, effective_hours, ot_hours}`
- `attendance.cycle.finalized` `{employee_id, period, summary, lop_days}`
- `attendance.regularization.submitted` `{request_id, employee_id, date}`
- `attendance.regularization.approved` `{request_id, employee_id, applied_changes}`
- `attendance.anomaly.detected` `{employee_id, date, anomaly_type, details}` — for AI consumption

### J. Read vs Write Ownership
- **Write:** Raw punch ingestion is extremely high-frequency write. Daily processing is batch-compute. Period finalization is low-frequency, high-importance.
- **Read:** Managers need team attendance dashboards (real-time read). Payroll needs finalized projection (batch read at cutoff). Analytics needs historical aggregates. Three distinct read patterns → three distinct read models maintained.

### K. Sync vs Async Operations
- **Synchronous:** Real-time punch ingestion acknowledgment (device must know punch was received), current-day attendance status for mobile self-service
- **Asynchronous:** Daily attendance processing (end-of-day batch or near-real-time event-driven), regularization workflow routing, period finalization events to Payroll, anomaly detection events to AI domain

### L. Multi-Tenant Considerations
- Punch events are tenant-partitioned; device registrations are tenant-scoped
- High-volume tenants (10,000+ employees with biometric punch every shift) require horizontal write scaling; the Attendance domain is the primary candidate for early service extraction
- Attendance processing jobs are tenant-isolated to prevent resource contention

### M. Security Considerations
- GPS punch data is sensitive location PII — stored with purpose limitation (attendance validation only, not general tracking)
- Biometric device data (fingerprint templates) never stored in application layer; only presence/event signals received
- Attendance records must be tamper-evident; `RawPunchEvent` is immutable; corrections go through `RegularizationRequest` with full audit chain
- Manager access scoped to own direct report tree; payroll admin access scoped to assigned employee groups

### N. Analytics Considerations
- Real-time attendance dashboard: present/absent count, late arrivals, early departures, OT in progress
- Historical: absenteeism rate trends, department-level attendance health scores, OT cost analysis
- Anomaly signals: unusual absence spikes, persistent lateness patterns, excessive OT hours
- Attendance quality score per location/department — signals for policy effectiveness

### O. AI Readiness Considerations
- **Absence Prediction:** ML model predicts which employees are likely to be absent tomorrow based on historical patterns, weather, day-of-week signals
- **OT Anomaly Detection:** Identifies unusual overtime patterns that may indicate payroll fraud or process inefficiency
- **Attendance Pattern Clustering:** Groups employees by attendance behavior profiles for targeted policy interventions
- **AI Copilot:** Manager can ask "Who in my team has been frequently late this month?" and receive instant summarized response from attendance projections

---

## BC-05: PAYROLL DOMAIN

### A. Domain Purpose
The Payroll domain is the **computation and disbursement authority for employee compensation**. It takes finalized inputs from Attendance, Leave, Compensation, and Compliance domains and executes the payroll computation pipeline — producing the definitive financial record of what each employee is owed, what must be withheld, and what must be remitted to statutory bodies.

### B. Core Responsibilities
- Managing payroll periods and cutoff schedules
- Executing the payroll computation engine across all pay components
- Processing earnings: fixed salary, variable components, overtime premium, incentives
- Processing deductions: statutory (tax, social security), voluntary (loans, advances, insurance)
- Computing net pay per employee per period
- Generating payslips with complete component-level explanation
- Producing bank transfer instructions and payment files
- Managing statutory reporting outputs (tax certificates, statutory challans)
- Processing payroll corrections, reversals, and off-cycle runs
- Enforcing pre-disbursement validation rules (statutory minimums, anomaly checks)

### C. Aggregates

**`PayrollRun`** — The master computation run for a period.
```
PayrollRun {
  run_id: UUID
  tenant_id: UUID
  period: PayrollPeriod               // value object
  run_type: RunType                   // regular | supplementary | correction | off_cycle
  status: RunStatus                   // draft | computing | computed | validated | approved | disbursed | closed
  employee_scope: EmployeeScope       // all | filtered_group
  computation_parameters: ComputationParameters  // value object
  employee_payslips: [EmployeePayslip] // child aggregates
  run_summary: PayrollSummary         // value object
  approval_trail: [ApprovalRecord]
  disbursement_batch_id: UUID?
  created_at: Timestamp
  finalized_at: Timestamp?
}
```

**`EmployeePayslip`** — The per-employee computation result.
```
EmployeePayslip {
  payslip_id: UUID
  run_id: UUID
  employee_id: UUID
  period: PayrollPeriod
  pay_structure_snapshot: PayStructureSnapshot  // frozen at run time
  attendance_inputs: AttendanceInputSnapshot    // frozen from Attendance projection
  leave_inputs: LeaveInputSnapshot              // frozen from Leave projection
  earnings: [PayComponent]
  deductions: [PayComponent]
  gross_pay: Money                             // value object
  total_deductions: Money
  net_pay: Money
  statutory_outputs: [StatutoryComponent]
  status: PayslipStatus               // computed | validated | approved | paid | reversed
  computation_log: [ComputationStep]  // full auditability of calculation
  anomaly_flags: [AnomalyFlag]
}
```

**`PayComponent`** — Individual earnings or deduction line item.
```
PayComponent {
  component_id: UUID
  component_code: ComponentCode       // value object
  component_type: ComponentType       // earning | deduction | stat_deduction | benefit
  component_name: String
  computation_basis: ComputationBasis // value object — how it was computed
  amount: Money
  is_taxable: Boolean
  is_statutory: Boolean
}
```

**`PayrollCorrection`** — Post-disbursement correction record.
```
PayrollCorrection {
  correction_id: UUID
  original_payslip_id: UUID
  correction_type: CorrectionType     // reversal | adjustment | arrear
  corrected_components: [PayComponent]
  net_correction_amount: Money
  reason: CorrectionReason
  authorized_by: UUID
  applied_in_run_id: UUID             // correction included in which run
}
```

### D. Value Objects
- `PayrollPeriod` — `{year, month, period_type, start_date, end_date}`
- `Money` — `{amount: Decimal(19,4), currency: ISO4217CurrencyCode}` — never a plain float
- `ComponentCode` — Immutable code for each pay element (e.g., "BASIC", "HRA", "PF_EE", "TDS")
- `ComputationBasis` — `{basis_type: fixed|percentage|formula, basis_value, reference_component_code?}`
- `PayStructureSnapshot` — Frozen copy of compensation structure at run time (prevents retroactive changes affecting processed payroll)
- `AttendanceInputSnapshot` — `{present_days, absent_days, lop_days, ot_hours, effective_days}` — frozen at payroll run time
- `StatutoryComponent` — `{statutory_type, applicable_law, employee_contribution, employer_contribution, computation_details}`
- `AnomalyFlag` — `{flag_type, description, severity, requires_manual_review}`

### E. Domain Services
- `PayrollRunService` — Orchestrates the full run lifecycle (initialize → compute → validate → approve → disburse)
- `EarningsComputationService` — Computes all earning components per employee per period
- `DeductionComputationService` — Computes all deduction components (voluntary and statutory)
- `TaxComputationService` — Applies jurisdiction-specific tax computation (depends on Compliance domain rule tables)
- `LopDeductionService` — Computes Loss of Pay deductions from Attendance LOP days
- `OvertimePremiumService` — Computes OT premium earnings based on OT hours and applicable rate
- `PayslipGenerationService` — Assembles final payslip document data and triggers Document domain
- `BankFileGenerationService` — Produces bank-specific payment files (NACHA, BACS, GIRO, etc.)
- `AnomalyDetectionService` — Flags statistical anomalies in the computed run (significant deviations from prior period)
- `PayrollCorrectionService` — Processes reversals and adjustments in subsequent runs

### F. Ownership Boundaries
Payroll domain exclusively owns:
- All PayrollRun records and their lifecycle state
- All EmployeePayslip computation records
- All PayComponent records within a run
- Bank transfer instructions and payment file generation
- Statutory computation outputs (PF challan data, tax deduction data)
- Payroll correction and reversal records

### G. What This Domain MUST NOT Own
- Compensation structure definitions — owned by Compensation & Benefits domain
- Attendance computation — Payroll consumes finalized attendance projections; does not recompute
- Leave balance management — Payroll consumes leave inputs; does not manage balances
- Tax rate tables and statutory rate schedules — owned by Compliance domain
- Employee personal bank details long-term storage — held transiently for disbursement; permanent banking data owned by Employee/Compensation domain
- General ledger accounting entries — owned by Finance integration (out of platform scope or Integration domain)

### H. Dependencies
- **Attendance Domain** — Finalized attendance cycle projections (mandatory input to payroll run)
- **Leave Management Domain** — Leave deduction inputs (LOP days, leave encashment amounts)
- **Compensation & Benefits Domain** — Pay structure definitions and benefit plan amounts
- **Compliance Domain** — Tax computation rules, statutory contribution rates, exemption limits
- **Policy Engine** — Payroll computation policies (OT rate multipliers, rounding rules)
- **Employee Domain** — Employee reference projection (status, employment type, jurisdiction)
- **Organization Domain** — Cost center assignment for payroll cost allocation
- **Workflow Domain** — Payroll approval workflows
- **Documents Domain** — Payslip document generation trigger

### I. External Interfaces

**Published APIs (OHS):**
- `POST /payroll/runs` — Initiate a payroll run
- `GET /payroll/runs/{run_id}` — Run status and summary
- `POST /payroll/runs/{run_id}/compute` — Trigger computation
- `POST /payroll/runs/{run_id}/approve` — Approve run for disbursement
- `GET /payroll/payslips/{employee_id}?period=X` — Employee payslip retrieval
- `GET /payroll/runs/{run_id}/anomalies` — Anomaly flags for HR review
- `GET /payroll/reports/statutory/{report_type}?period=X` — Statutory reports

**Published Events:**
- `payroll.run.initiated` `{run_id, tenant_id, period, employee_count}`
- `payroll.run.computed` `{run_id, tenant_id, period, total_gross, total_net, anomaly_count}`
- `payroll.run.approved` `{run_id, approved_by, approved_at}`
- `payroll.run.disbursed` `{run_id, disbursement_date, total_net_disbursed}`
- `payroll.payslip.generated` `{payslip_id, employee_id, period, net_pay}`
- `payroll.anomaly.detected` `{run_id, employee_id, anomaly_type, deviation_amount}`
- `payroll.correction.applied` `{correction_id, original_payslip_id, net_correction}`

### J. Read vs Write Ownership
- **Write:** Payroll run computation is intensive write — hundreds of thousands of component records created in a single run. Batch computation requires dedicated compute capacity.
- **Read:** Payslip retrieval by employees is high-frequency read (especially on payday and month-end). Read model: finalized payslips stored as denormalized JSON documents for fast retrieval. Analytics read model: aggregated payroll cost data per department/period, populated from `payroll.run.disbursed` events.

### K. Sync vs Async Operations
- **Synchronous:** Payslip retrieval (employee self-service), run status queries
- **Asynchronous:** Payroll computation (batch job triggered by run initiation command), bank file generation (triggered by approval), payslip document generation, statutory report generation, analytics event publication, anomaly alerts to notification channel

### L. Multi-Tenant Considerations
- Payroll runs are strictly tenant-isolated; no cross-tenant computation
- Multi-entity tenants may require consolidated group-level payroll reporting; this is a read-side projection concern, not a write-side concern
- Payroll run scheduling (cutoff dates, processing windows) is per-tenant configuration
- High-frequency tenants (monthly payroll for 50,000+ employees) may require dedicated payroll compute workers

### M. Security Considerations
- Payslip data contains individual compensation details — highest sensitivity PII
- Column-level encryption for salary amounts, bank details
- Payslip access: individual employee sees only their own; payroll admin sees assigned employee group; CFO/CHRO see aggregates
- Payroll run approval requires dual authorization for amounts above threshold (four-eyes principle)
- Bank file generation produces externally transmitted files — must be encrypted and integrity-checked
- All payroll computation steps logged in `computation_log` for full audit traceability

### N. Analytics Considerations
- Payroll cost by department, location, grade band, employment type
- Total compensation ratio (base vs. variable vs. benefits)
- OT cost trends per department
- LOP deduction trends (proxy for absenteeism impact)
- Statutory contribution totals for finance reconciliation
- Payslip anomaly rates per payroll run (quality metric)

### O. AI Readiness Considerations
- **Payroll Anomaly Detection:** ML model identifies statistically unusual payroll amounts compared to rolling average per employee, component, and peer group
- **Payroll Forecasting:** AI predicts next-period payroll costs based on headcount changes, planned OT, and historical patterns
- **Compensation Intelligence:** AI analyzes pay equity gaps, identifies outliers in compensation distribution
- **Pre-Disbursement AI Check:** Before approval, AI scans for potential duplicate payments, missing statutory deductions, or data quality issues that rule-based validation misses

---

## BC-06: LEAVE MANAGEMENT DOMAIN

### A. Domain Purpose
The Leave Management domain owns the **complete lifecycle of employee leave entitlements and utilization**. It defines what leave an employee is entitled to, tracks the balance through accrual and consumption, manages the application-to-approval pipeline, and publishes leave status to downstream systems.

### B. Core Responsibilities
- Defining leave type catalog per tenant (annual, sick, maternity, compensatory, etc.)
- Managing employee leave balance initialization and accrual
- Processing carry-forward and lapsing rules at period boundaries
- Receiving and validating leave applications
- Routing leave applications through approval workflows
- Maintaining the approved/rejected/cancelled leave record
- Publishing approved leave data to Attendance (absence justification) and Payroll (LOP, encashment)
- Providing manager leave planning calendar views
- Managing compensatory off accrual from OT attendance events

### C. Aggregates

**`LeaveBalance`** — The authoritative entitlement record per employee per leave type per period.
```
LeaveBalance {
  balance_id: UUID
  tenant_id: UUID
  employee_id: UUID
  leave_type_id: UUID
  policy_year: Integer
  opening_balance: LeaveQuantity       // value object
  accrued: LeaveQuantity
  carried_forward: LeaveQuantity
  availed: LeaveQuantity
  pending_approval: LeaveQuantity      // reserved for pending applications
  encashed: LeaveQuantity
  lapsed: LeaveQuantity
  closing_balance: LeaveQuantity       // computed
  last_computed_at: Timestamp
  transactions: [LeaveTransaction]     // full ledger history
}
```

**`LeaveApplication`** — An employee's leave request.
```
LeaveApplication {
  application_id: UUID
  tenant_id: UUID
  employee_id: UUID
  leave_type_id: UUID
  start_date: Date
  end_date: Date
  duration: LeaveQuantity              // value object — calendar-aware computation
  day_details: [LeaveDayDetail]        // full | half_day_am | half_day_pm | hourly
  reason: LeaveReason                  // value object
  supporting_documents: [DocumentRef]
  status: ApplicationStatus            // draft | submitted | pending | approved | rejected | cancelled | withdrawn
  workflow_instance_id: UUID
  balance_deducted_at: Timestamp?      // when balance was reserved/deducted
  approval_trail: [ApprovalRecord]
}
```

**`LeaveType`** — The definition of a leave category.
```
LeaveType {
  leave_type_id: UUID
  tenant_id: UUID
  type_code: LeaveTypeCode
  type_name: String
  entitlement_basis: EntitlementBasis  // value object — fixed | accrual | earned
  accrual_schedule: AccrualSchedule?   // value object
  carry_forward_rule: CarryForwardRule // value object
  encashment_rule: EncashmentRule?     // value object
  applicability_rules: [ApplicabilityRule] // who is eligible
  blackout_dates: [DateRange]
  requires_document: Boolean
  minimum_notice_days: Integer
  maximum_consecutive_days: Integer?
  is_statutory: Boolean
  gender_restricted: GenderRestriction?
}
```

### D. Value Objects
- `LeaveQuantity` — `{value: Decimal, unit: days|hours}` — prevents mixing of day/hour balances
- `LeaveReason` — `{reason_code, description}` — structured reason for audit
- `LeaveDayDetail` — `{date, duration_type: full|half_am|half_pm|hours, hours?: Decimal}`
- `AccrualSchedule` — `{frequency: monthly|annual, accrual_rate, pro_rate_on_join: Boolean, pro_rate_on_exit: Boolean}`
- `CarryForwardRule` — `{max_carry_days, expiry_months_after_year_end, minimum_avail_before_carry}`
- `EncashmentRule` — `{max_encashable_days, encashment_rate_basis, taxable: Boolean}`
- `EntitlementBasis` — `{basis_type, value, pro_ration_method}`

### E. Domain Services
- `LeaveEntitlementService` — Computes opening balance for new period, applies policy rules
- `AccrualProcessingService` — Runs monthly/annual accrual jobs across all active employees
- `CarryForwardService` — Executes year-end carry-forward and lapsing processing
- `LeaveApplicationService` — Validates application against balance, blackout rules, notice periods
- `LeaveApprovalService` — Processes approval/rejection actions and triggers balance finalization
- `CompensatoryOffService` — Computes comp-off entitlements from approved OT attendance events
- `LeaveEncashmentService` — Processes encashment requests and publishes to Payroll
- `LeaveCalendarService` — Aggregates team leave calendar for manager visibility
- `LeaveProjectionService` — Produces leave deduction inputs for Payroll consumption

### F. Ownership Boundaries
Leave domain exclusively owns:
- All leave type definitions
- All leave balance records and their transaction ledger
- All leave applications and their lifecycle state
- Compensatory off accrual records
- Leave calendar (the business view of who is on leave when)

### G. What This Domain MUST NOT Own
- Attendance records — Leave references attendance but does not own it
- Public holiday calendar — owned by Policy Engine (though Leave consumes it for duration computation)
- Payroll computation of leave encashment amounts — Leave publishes encashment inputs; Payroll computes the financial value
- Workflow approval mechanism — Workflow domain manages the workflow instance; Leave owns the business state

### H. Dependencies
- **Policy Engine** — Leave entitlement rules, carry-forward rules, blackout dates, public holiday calendar
- **Attendance Domain** — Consumes OT events for comp-off accrual; publishes approved leave back to Attendance for absence justification
- **Employee Domain** — Employment type, joining date, and gender (for gender-restricted leave types)
- **Workflow Domain** — Leave approval routing
- **Organization Domain** — Manager hierarchy for approval routing context
- **Payroll Domain** — Publishes LOP days and encashment inputs for payroll run

### I. External Interfaces

**Published APIs (OHS):**
- `POST /leave/applications` — Submit leave application
- `GET /leave/applications/{id}` — Application status
- `GET /leave/balances/{employee_id}` — Full balance summary
- `GET /leave/team-calendar?manager_id=X&month=X` — Team absence view
- `GET /leave/payroll-inputs?employee_id=X&period=X` — Payroll consumption endpoint

**Published Events:**
- `leave.application.submitted` `{application_id, employee_id, leave_type, start_date, end_date, days}`
- `leave.application.approved` `{application_id, employee_id, leave_type, start_date, end_date, approved_by}`
- `leave.application.rejected` `{application_id, employee_id, reason}`
- `leave.balance.updated` `{employee_id, leave_type_id, new_balance, transaction_type}`
- `leave.compoff.accrued` `{employee_id, ot_date, compoff_quantity}`
- `leave.encashment.processed` `{employee_id, leave_type_id, days_encashed, period}`
- `leave.period.closed` `{tenant_id, policy_year, employees_processed, carry_forward_total}`

### J. Read vs Write Ownership
- **Write:** Balance deductions require strict optimistic locking to prevent race conditions (e.g., employee and manager submitting leave for same days simultaneously)
- **Read:** Employee self-service balance view is high-frequency; cached balance projection updated on every `leave.balance.updated` event. Manager calendar view served from pre-aggregated leave calendar projection.

### K. Sync vs Async Operations
- **Synchronous:** Balance availability check (must be real-time during application submission), application status query
- **Asynchronous:** Annual accrual processing (batch), carry-forward computation, leave approval workflow routing, attendance absence justification update, payroll input publication

### L. Multi-Tenant Considerations
- Leave type catalogs are per-tenant with optional global templates
- Statutory leave types (mandated by law) must be provisioned by Compliance domain; tenant cannot remove them
- Multi-jurisdiction tenants require location-based leave type applicability
- Year-end processing jobs must be tenant-isolated with configurable fiscal year definitions

### M. Security Considerations
- Leave applications and medical documentation are sensitive PII
- Supporting documents (medical certificates) must be stored in Documents domain with restricted access
- Manager sees team members' leave status (not medical details); HR sees full application
- Automated leave deduction for unauthorized absences must be authorized through explicit workflow, not silent system action

### N. Analytics Considerations
- Absenteeism rate by department, leave type, and period
- Leave utilization vs. entitlement ratio
- Carry-forward trends (early indicator of leave utilization problems)
- Leave pattern analysis (Monday/Friday leave concentration — proxy for extended weekend behavior)
- Sick leave frequency — anomaly detection for wellbeing programs

### O. AI Readiness Considerations
- **Leave Pattern Prediction:** AI predicts high-absence periods to proactively alert managers for staffing
- **Burnout Early Warning:** AI flags employees with unusually low leave utilization (potential burnout indicator)
- **Leave Application Anomaly:** AI detects unusual leave patterns (frequent sick leaves on specific days) for HR awareness
- **AI Copilot:** Employee asks "how many leaves do I have left this year?" and gets instant balance breakdown with eligibility summary

---

## BC-07: POLICY ENGINE DOMAIN

### A. Domain Purpose
The Policy Engine is the **single source of truth for all configurable business rule sets** that govern operational behavior across the platform. It separates *rule definition* from *rule execution*: domains define what computations they need to perform; the Policy Engine defines the parameters, thresholds, and conditions that govern those computations.

### B. Core Responsibilities
- Defining and versioning policy rule sets across all domains
- Managing effective dates for policy activation and expiry
- Managing tenant-level, entity-level, department-level, and individual-level overrides
- Providing a policy resolution API (given employee + context + date → applicable rule set)
- Providing policy simulation capabilities (what-if impact analysis)
- Maintaining full audit history of policy changes
- Managing public holiday calendars per jurisdiction
- Validating policy configurations for internal consistency

### C. Aggregates

**`PolicyDefinition`** — A versioned rule configuration for a specific policy domain.
```
PolicyDefinition {
  policy_id: UUID
  tenant_id: UUID
  policy_domain: PolicyDomain         // attendance | leave | payroll | roster | compliance
  policy_code: PolicyCode             // value object — stable identifier
  version: PolicyVersion              // value object
  rule_set: RuleSet                   // value object — the actual rule parameters
  effective_period: DateRange
  applicability_scope: ApplicabilityScope  // entity | unit | location | employment_type | all
  status: PolicyStatus                // draft | active | superseded | archived
  parent_policy_id: UUID?             // for override/inheritance chain
  simulation_results: [SimulationResult]
}
```

**`PolicyResolutionContext`** — Input to the resolution engine.
```
PolicyResolutionContext {
  employee_id: UUID
  tenant_id: UUID
  entity_id: UUID
  unit_id: UUID
  location_id: UUID
  employment_type: EmploymentType
  jurisdiction: Jurisdiction
  evaluation_date: Date
}
```

**`HolidayCalendar`** — Jurisdiction or tenant-specific public holiday definitions.
```
HolidayCalendar {
  calendar_id: UUID
  tenant_id: UUID
  jurisdiction: Jurisdiction
  calendar_year: Integer
  holidays: [PublicHoliday]           // child value objects
  optional_holidays: [PublicHoliday]  // optional/restricted holidays
}
```

### D. Value Objects
- `PolicyVersion` — `{major, minor, patch}` — semantic versioning
- `PolicyCode` — Immutable string code per policy type
- `DateRange` — Effective period with open-ended support (`effective_to: null` = indefinitely active)
- `RuleSet` — Domain-specific JSON schema validated rule parameters (different schema per policy_domain)
- `ApplicabilityScope` — Hierarchical scope: `{scope_type, scope_ids[]}`
- `ResolutionResult` — `{policy_id, policy_version, rule_set, resolution_path}` — records which level resolved

### E. Domain Services
- `PolicyResolutionService` — Core service: given a context, traverses the policy hierarchy and returns the most specific applicable policy
- `PolicyVersioningService` — Manages the versioning lifecycle (draft → active → superseded)
- `PolicySimulationService` — Runs a hypothetical policy change against a sample or full employee population to compute impact
- `HolidayCalendarService` — Manages holiday calendar definitions and publication
- `PolicyAuditService` — Records every policy change with full diff and authorization context

### F. Ownership Boundaries
Policy Engine exclusively owns:
- All policy definitions and their version history
- The policy resolution algorithm and precedence rules
- Holiday calendar definitions
- Policy simulation engine and results

### G. What This Domain MUST NOT Own
- The actual computation logic that uses the policies — that stays in the owning domain (Attendance computes OT using parameters from Policy Engine, but OT computation logic is in Attendance domain)
- Employee-level exception records that are effectively individual contracts — those belong to Employee/Compensation domains
- Compliance statutory rule tables — Compliance domain owns the statutory rules; Policy Engine owns configurable company policies

### H. Dependencies
- **Compliance Domain** — Statutory constraints feed into policy validation (a company policy cannot violate statutory minimums)
- **Organization Domain** — For scope resolution (policy assigned to unit X applies to all sub-units)
- **Employee Domain** — For employment type and jurisdiction determination during context resolution

### I. External Interfaces

**Published APIs (OHS — synchronous, must be fast):**
- `POST /policies/resolve` — Core resolution API consumed by all operational domains
- `GET /policies/{code}/versions` — Version history for a policy code
- `POST /policies` — Create new policy definition
- `PUT /policies/{id}/activate` — Activate a draft policy
- `POST /policies/simulate` — Run impact simulation
- `GET /holidays/{jurisdiction}/{year}` — Holiday calendar

**Published Events:**
- `policy.activated` `{policy_id, policy_code, tenant_id, domain, effective_from}`
- `policy.superseded` `{policy_id, superseded_by_id, effective_from}`
- `policy.simulation.completed` `{simulation_id, policy_id, impact_summary}`
- `holiday.calendar.published` `{calendar_id, jurisdiction, year, holiday_count}`

### J. Read vs Write Ownership
- **Write:** Policy changes are low-frequency but high-impact; require strict optimistic locking and audit trail
- **Read:** Policy resolution is called on every operational event (every punch, every leave calculation, every payroll line item). Must be extremely fast. Resolved policies are cached aggressively per context hash with short TTL. Cache invalidated by `policy.activated` events.

### K. Sync vs Async Operations
- **Synchronous:** Policy resolution (blocking call required before operational computation)
- **Asynchronous:** Policy activation notifications to downstream domains, simulation job execution, cache invalidation broadcast

---

## BC-08: WORKFLOW & APPROVALS DOMAIN

### A. Domain Purpose
The Workflow domain provides the **generic approval orchestration engine** that all other business domains use. It manages multi-step, multi-actor approval chains for any entity type — leave applications, payroll corrections, regularization requests, onboarding steps, policy changes — without containing any business logic about the entities themselves.

### B. Core Responsibilities
- Defining workflow templates (stages, actors, conditions, SLAs)
- Instantiating workflow instances for any entity submitted for approval
- Routing approval tasks to correct actors based on hierarchy and role
- Managing actor actions: approve, reject, delegate, recall, escalate
- Enforcing SLA timers and auto-escalation rules
- Publishing completion events with outcomes back to originating domains
- Providing the approval workspace interface (approver's task inbox)

### C. Aggregates

**`WorkflowTemplate`** — Reusable approval process definition.
```
WorkflowTemplate {
  template_id: UUID
  tenant_id: UUID
  template_code: TemplateCode
  entity_type: EntityType             // leave | regularization | payroll_correction | onboarding | ...
  stages: [WorkflowStage]             // ordered stage definitions
  conditions: [RoutingCondition]      // dynamic routing rules
  sla_config: SLAConfiguration        // value object
  version: Integer
  is_active: Boolean
}
```

**`WorkflowInstance`** — A specific running approval for a specific entity.
```
WorkflowInstance {
  instance_id: UUID
  tenant_id: UUID
  template_id: UUID
  entity_type: EntityType
  entity_id: UUID                     // reference to the domain entity being approved
  initiator_id: UUID
  current_stage: Integer
  stages: [WorkflowStageExecution]    // execution state per stage
  overall_status: InstanceStatus      // pending | approved | rejected | cancelled | expired
  created_at: Timestamp
  completed_at: Timestamp?
  outcome: WorkflowOutcome?           // value object
}
```

**`WorkflowTask`** — Individual approval action assigned to an actor.
```
WorkflowTask {
  task_id: UUID
  instance_id: UUID
  stage_index: Integer
  assigned_to: UUID                   // actor employee_id
  assignment_reason: AssignmentReason // direct | role | hierarchy | delegation
  due_at: Timestamp                   // SLA deadline
  status: TaskStatus                  // pending | completed | escalated | delegated | expired
  action_taken: TaskAction?           // approve | reject | delegate
  action_at: Timestamp?
  comments: String?
  delegated_to: UUID?
}
```

### D. Value Objects
- `TemplateCode` — Stable code for a workflow template (e.g., "LEAVE_APPROVAL_3STEP")
- `SLAConfiguration` — `{per_stage_hours, escalation_chain[], auto_approve_on_expiry: Boolean}`
- `WorkflowOutcome` — `{result: approved|rejected, final_actor_id, outcome_at, comments}`
- `RoutingCondition` — `{field, operator, value, target_stage}` — for dynamic routing (e.g., leave > 10 days goes to senior approver)

### E. Domain Services
- `WorkflowInstantiationService` — Creates a workflow instance from a template for a given entity
- `TaskRoutingService` — Resolves which actor to assign each stage task (consults Organization domain for hierarchy)
- `ApprovalActionService` — Processes actor actions and advances workflow state machine
- `EscalationService` — Runs periodic job to detect SLA breaches and escalate or auto-resolve
- `DelegationService` — Manages actor delegation chains
- `WorkflowQueryService` — Provides approver inbox, pending count, and history views

### F. Ownership Boundaries
Workflow domain exclusively owns:
- All workflow template definitions
- All workflow instance state machines
- All task assignments and their status
- SLA monitoring and escalation logic

### G. What This Domain MUST NOT Own
- Business decisions about approvals (what constitutes valid leave — that's Leave domain's concern)
- Employee hierarchy for routing — consumed from Organization domain
- Notification dispatch — emits events; Notifications domain handles dispatch

### H. Dependencies
- **Organization Domain** — For resolving manager hierarchy for task routing
- **IAM Domain** — For actor identity validation
- **Notifications Domain** — Workflow events trigger approval notifications

### I. External Interfaces

**Published APIs:**
- `POST /workflows/instances` — Submit entity for approval
- `POST /workflows/tasks/{task_id}/approve` — Actor approval action
- `POST /workflows/tasks/{task_id}/reject` — Actor rejection action
- `GET /workflows/inbox/{actor_id}` — Actor's pending tasks
- `GET /workflows/instances/{instance_id}` — Instance status and history

**Published Events:**
- `workflow.instance.created` `{instance_id, entity_type, entity_id, initiator_id}`
- `workflow.task.assigned` `{task_id, instance_id, assigned_to, due_at}`
- `workflow.task.completed` `{task_id, action: approved|rejected, actor_id}`
- `workflow.instance.completed` `{instance_id, entity_type, entity_id, outcome, completed_at}`
- `workflow.sla.breached` `{task_id, assigned_to, breach_duration}`
- `workflow.escalated` `{instance_id, escalated_from, escalated_to}`

---

## BC-09: ANALYTICS DOMAIN

### A. Domain Purpose
The Analytics domain owns the **workforce intelligence data platform** — the read-optimized, event-sourced data layer that powers all dashboards, reports, and AI feature inputs. It does not share the OLTP database. It builds and owns its own data model, assembled from events published by all operational domains.

### B. Core Responsibilities
- Consuming domain events and maintaining analytical projections
- Computing workforce KPIs and metric series
- Serving dashboard query APIs with sub-second performance
- Managing tenant-scoped report definitions and scheduled delivery
- Maintaining multi-dimensional analytical models (headcount, attendance, payroll, leave)
- Publishing aggregated data sets for AI model training pipelines
- Managing data retention and archival for analytics data

### C. Aggregates

**`AnalyticsProjection`** — A named read model built from domain events.
```
AnalyticsProjection {
  projection_id: UUID
  tenant_id: UUID
  projection_type: ProjectionType     // headcount | attendance_daily | payroll_period | leave_usage | ...
  grain: ProjectionGrain              // employee | department | location | tenant
  period: ProjectionPeriod
  dimension_values: DimensionMap      // value object — org, location, grade, type
  metric_values: MetricMap            // value object — the actual KPI values
  last_updated: Timestamp
  source_event_ids: UUID[]            // traceability
}
```

**`DashboardDefinition`** — A tenant-configured dashboard layout.
```
DashboardDefinition {
  dashboard_id: UUID
  tenant_id: UUID
  dashboard_code: DashboardCode
  owner_role: RoleCode
  widget_configs: [WidgetConfig]      // child value objects
  filter_defaults: FilterSet
  refresh_interval: Duration
  is_system_defined: Boolean          // platform defaults vs. custom
}
```

### D. Value Objects
- `DimensionMap` — `{org_unit_id, location_id, grade, employment_type, ...}` — slicing axes
- `MetricMap` — `{metric_code → value}` — the computed KPI values
- `ProjectionGrain` — granularity level for aggregation
- `WidgetConfig` — `{widget_type, metric_codes[], dimension_filters, visualization_type}`

### E. Domain Services
- `EventProjectionService` — Processes incoming domain events and updates projection tables
- `KPIComputationService` — Computes derived metrics (attrition rate, absence rate, OT%) from raw projections
- `DashboardQueryService` — Serves dashboard widget queries from pre-aggregated projections
- `ReportGenerationService` — Assembles and delivers scheduled reports
- `DataExportService` — Produces structured data exports for AI feature engineering pipelines
- `RetentionManagementService` — Manages analytics data lifecycle per tenant configuration

### F. Ownership Boundaries
Analytics domain exclusively owns:
- All analytical projections and aggregated data models
- Dashboard and report definitions
- The KPI computation logic
- Analytics-layer data retention policies

### G. What This Domain MUST NOT Own
- Operational data — Analytics reads from events; never writes back to operational domains
- Real-time transactional state — operational domains own current state; Analytics owns aggregated history
- AI model training or inference — AI Intelligence domain consumes analytics datasets

### H. Dependencies (Event Consumer)
- Consumes events from: Attendance, Leave, Payroll, Employee, Organization, Workflow, Compliance
- Reads from operational APIs only for initial data seeding or backfill scenarios

### I. External Interfaces
- `GET /analytics/metrics?dimension=X&period=Y` — KPI query API
- `GET /analytics/dashboards/{id}/widgets` — Dashboard data queries
- `POST /analytics/reports/schedule` — Report scheduling
- `GET /analytics/exports/{dataset}` — AI pipeline data export

**Publishes:** No domain events (read-only domain). Publishes scheduled report delivery events to Notifications.

---

## BC-10: AI INTELLIGENCE DOMAIN

### A. Domain Purpose
The AI Intelligence domain is the **orchestration layer for all AI-native capabilities** in the platform. It owns model lifecycle management, prediction pipeline execution, vector memory for context-aware copilots, and the recommendation engine that surfaces intelligence across operational workspaces.

### B. Core Responsibilities
- Managing the AI model registry (which models are deployed, their versions, performance metrics)
- Executing prediction pipelines (attrition risk, attendance forecasting, payroll anomalies)
- Managing vector embeddings for semantic memory and context-aware copilot responses
- Generating and publishing AI recommendations to operational domains
- Managing AI copilot session state and conversation memory
- Monitoring model performance, drift, and accuracy decay
- Managing AI agent credentials and execution contexts (IAM integration)

### C. Aggregates

**`AIModel`** — A deployed prediction or generation model.
```
AIModel {
  model_id: UUID
  model_code: ModelCode
  model_type: ModelType               // classification | regression | embedding | generation | agent
  use_case: UseCase                   // attrition_risk | absence_prediction | payroll_anomaly | copilot | ...
  version: ModelVersion
  deployment_status: DeploymentStatus // shadow | canary | production | deprecated
  performance_metrics: ModelMetrics   // value object
  input_schema: SchemaDefinition      // expected feature set
  output_schema: SchemaDefinition     // output format contract
  inference_endpoint: EndpointConfig  // value object
}
```

**`PredictionJob`** — A scheduled or triggered inference run.
```
PredictionJob {
  job_id: UUID
  tenant_id: UUID
  model_id: UUID
  trigger_type: TriggerType           // scheduled | event_driven | on_demand
  input_dataset_ref: DatasetRef       // reference to Analytics data export
  output: [PredictionResult]          // child value objects
  status: JobStatus
  executed_at: Timestamp
  predictions_generated: Integer
}
```

**`CopilotSession`** — AI assistant conversation state.
```
CopilotSession {
  session_id: UUID
  tenant_id: UUID
  user_id: UUID
  workspace_context: WorkspaceContext // which domain workspace the user is in
  conversation_turns: [ConversationTurn]
  context_embeddings: [VectorRef]     // semantic memory references
  active_permissions: PermissionSnapshot  // scoped to what user can see
  created_at: Timestamp
  last_active: Timestamp
}
```

### D. Value Objects
- `ModelCode` — Stable identifier per model use case
- `ModelMetrics` — `{accuracy, precision, recall, f1, auc, last_evaluated_at}`
- `PredictionResult` — `{entity_id, predicted_value, confidence_score, explanation_features}`
- `WorkspaceContext` — `{domain, view, entity_id}` — what the user is looking at
- `VectorRef` — `{embedding_id, source_domain, source_entity_id, created_at}`

### E. Domain Services
- `ModelRegistryService` — Manages model lifecycle, versioning, and deployment configuration
- `PredictionOrchestrationService` — Schedules and executes prediction jobs, routes results
- `VectorMemoryService` — Manages embedding generation, storage, and similarity retrieval
- `CopilotService` — Manages session lifecycle, context assembly, and response generation
- `RecommendationPublisherService` — Publishes AI recommendations as events consumed by operational domains
- `ModelMonitoringService` — Tracks prediction accuracy over time, detects drift, triggers retraining alerts

### F. Ownership Boundaries
- All AI model registry entries
- All prediction job results
- All vector embeddings and semantic memory
- All copilot session state
- AI recommendation publication pipeline

### G. What This Domain MUST NOT Own
- Training data (consumed from Analytics exports)
- Operational decisions — AI provides recommendations; humans approve or systems act via explicit event contracts
- Infrastructure for model training (data science platform concern) — only inference is platform-domain concern

### H. Dependencies
- **Analytics Domain** — Primary data source for prediction feature pipelines
- **All operational domains** — Subscribes to domain events for real-time signal feeding
- **IAM Domain** — AI agents operate with scoped service account tokens
- **Employee Domain** — Employee context for copilot personalization

### I. External Interfaces
- `GET /ai/predictions/{use_case}?employee_id=X` — On-demand prediction retrieval
- `POST /ai/copilot/sessions` — Start copilot session
- `POST /ai/copilot/sessions/{id}/message` — Send message, receive contextual response
- `GET /ai/recommendations?domain=X&entity_id=Y` — Recommendation retrieval

**Published Events:**
- `ai.prediction.generated` `{job_id, model_code, use_case, tenant_id, result_count}`
- `ai.attrition_risk.flagged` `{employee_id, tenant_id, risk_score, risk_factors}`
- `ai.payroll_anomaly.flagged` `{run_id, employee_id, anomaly_type, confidence}`
- `ai.recommendation.published` `{recommendation_id, target_domain, entity_id, recommendation_type}`

### J. Security Considerations
- AI copilot responses must be scoped to data the requesting user is authorized to see — copilot inherits user's permission context, never bypasses ABAC
- Prediction results for individual employees (attrition risk scores) must not be exposed to the employee themselves — only to authorized HR roles
- AI model inputs and outputs must be logged for bias auditing and explainability




---


# SECTION 4: DOMAIN RELATIONSHIP MAPPING

---

## 4.1 Inter-Domain Dependency Map

The following matrix defines the directional dependency relationships between all bounded contexts. An entry (A → B) means Domain A depends on Domain B as an upstream data provider.

```
UPSTREAM → DOWNSTREAM DEPENDENCY MATRIX

                    IAM  ORG  EMP  ATT  SHFT ROST LEAV PAY  C&B  WRK  COMP DOC  NOTIF POL  ANA  AI   AUD  INT  MOB
IAM                  -    -    →    →    →    →    →    →    →    →    →    →    →     →    →    →    →    →    →
Organization         ↑    -    →    →    →    →    →    →    →    →    →    -    →     →    →    →    →    -    →
Employee             ↑    ↑    -    →    →    →    →    →    →    →    →    →    →     →    →    →    →    -    →
Attendance           ↑    ↑    ↑    -    →    ↑    →    →    -    →    -    -    →     ↑    →    →    →    ↑    ↑
ShiftMgmt            ↑    ↑    ↑    ↑    -    →    -    →    -    -    -    -    -     ↑    →    →    →    -    -
RosterPlanning       ↑    ↑    ↑    ↑    ↑    -    →    -    -    →    -    -    →     ↑    →    →    →    -    -
LeaveManagement      ↑    ↑    ↑    ↑    -    -    -    →    -    →    -    →    →     ↑    →    →    →    -    -
Payroll              ↑    ↑    ↑    ↑    ↑    -    ↑    -    ↑    →    ↑    →    →     ↑    →    →    →    →    -
Comp&Benefits        ↑    ↑    ↑    -    -    -    -    ↑    -    →    -    -    -     ↑    →    →    →    -    -
Workflow             ↑    ↑    ↑    -    -    -    -    -    -    -    -    →    →     -    →    →    →    -    -
Compliance           ↑    ↑    ↑    ↑    -    -    ↑    ↑    -    →    -    -    →     ↑    →    →    →    -    -
Documents            ↑    -    ↑    -    -    -    ↑    ↑    -    ↑    -    -    →     -    →    →    →    -    -
Notifications        ↑    -    ↑    -    -    -    -    -    -    -    -    -    -     -    -    →    →    -    -
PolicyEngine         ↑    ↑    ↑    -    -    -    -    -    -    -    ↑    -    -     -    →    →    →    -    -
Analytics            ↑    -    -    -    -    -    -    -    -    -    -    -    -     -    -    →    →    -    -
AI Intelligence      ↑    -    ↑    -    -    -    -    -    -    -    -    -    →     -    ↑    -    →    -    -
Audit                ↑    -    -    -    -    -    -    -    -    -    -    -    -     -    -    -    -    -    -
Integration          ↑    ↑    ↑    ↑    ↑    -    ↑    ↑    -    ↑    -    -    -     ↑    ↑    -    →    -    ↑
MobileWorkforce      ↑    ↑    ↑    ↑    -    ↑    ↑    -    -    ↑    -    -    →     -    -    -    →    -    -

Legend: → = depends on (downstream)  ↑ = is depended on (upstream)  - = no direct relationship
```

---

## 4.2 Canonical Upstream-Downstream Hierarchy

```
PLATFORM DEPENDENCY LAYERS

Layer 0 — Platform Foundation (no domain dependencies)
┌─────────────────────────────────────────────────────┐
│  Identity & Access Management                        │
│  (Consumed by ALL domains — authentication layer)   │
└─────────────────────────────────────────────────────┘

Layer 1 — Core Reference Data (depend only on IAM + each other)
┌──────────────────┐  ┌─────────────────┐  ┌──────────────┐
│  Organization    │  │  Employee       │  │ Policy Engine│
│  Domain          │  │  Domain         │  │ Domain       │
└──────────────────┘  └─────────────────┘  └──────────────┘

Layer 2 — Operational Domains (depend on Layer 0+1)
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│Attendance│  │  Shift   │  │  Roster  │  │    Leave     │
│ Domain   │  │Management│  │ Planning │  │  Management  │
└──────────┘  └──────────┘  └──────────┘  └──────────────┘

Layer 3 — Financial Domains (depend on Layer 0+1+2)
┌──────────────┐  ┌───────────────────┐
│   Payroll    │  │  Compensation &   │
│   Domain     │  │  Benefits Domain  │
└──────────────┘  └───────────────────┘

Layer 4 — Process Domains (depend on Layer 0+1+2+3)
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Workflow  │  │Compliance│  │Documents │  │Notificat-│  │  Asset   │
│&Approvals│  │  Domain  │  │  Domain  │  │  ions    │  │Management│
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘

Layer 5 — Intelligence & Platform Domains (consume from all layers)
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Analytics │  │    AI    │  │ Audit &  │  │Integrat- │  │  Mobile  │
│  Domain  │  │Intellig. │  │Governance│  │  ion     │  │Workforce │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## 4.3 Critical Domain Interaction Flows

### Flow 1: Employee Onboarding End-to-End

```
Recruitment Domain
  ↓ emit: recruitment.offer.accepted {candidate_id, offer_details}
  
Employee Domain (consumes)
  → Creates Employee aggregate
  → Triggers onboarding workflow via Workflow Domain
  ↓ emit: employee.created {employee_id, unit_id, joining_date}
  
[Parallel downstream consumers of employee.created]
  
IAM Domain ──────────────────→ Provisions UserAccount
Organization Domain ──────────→ Creates ReportingRelationship
Leave Management Domain ───────→ Initializes LeaveBalance
Attendance Domain ─────────────→ Creates AttendanceCycle for current period
Compensation & Benefits Domain → Initializes pay structure enrollment
Documents Domain ──────────────→ Generates appointment letter
Notifications Domain ──────────→ Sends welcome communication
Analytics Domain ──────────────→ Updates headcount projection
```

### Flow 2: Daily Attendance Processing

```
[Multiple Sources — parallel]
Biometric Device ─────┐
Mobile GPS Punch ──────┼──→ Attendance Domain: PunchIngestionService
Manual Entry ──────────┘         ↓
                           RawPunchEvent (persisted, immutable)
                                 ↓
                    [End-of-shift / scheduled processing trigger]
                                 ↓
Policy Engine Domain ←── PolicyApplicationService.resolve(employee, date)
                    → Returns: AttendancePolicyRuleSet
                                 ↓
Shift Domain Projection ←── ShiftMatchingService.resolve(employee, date)
                    → Returns: ShiftDefinition for the day
                                 ↓
Leave Domain (sync read) ←── Check: any approved leave for this date?
                                 ↓
AttendanceProcessingService
  → Computes: effective_hours, ot_hours, attendance_status, shift_compliance
  → Persists: DailyAttendance record
  ↓ emit: attendance.daily.processed {employee_id, date, status, hours, ot_hours}
  
[Consumers of attendance.daily.processed]
Analytics Domain ──────────────→ Updates daily attendance projection
AI Intelligence Domain ────────→ Feeds anomaly detection pipeline
Notifications Domain ──────────→ Alerts manager if employee absent
```

### Flow 3: Leave Application to Payroll Impact

```
Employee Self-Service
  → POST /leave/applications
  
Leave Domain: LeaveApplicationService
  → Validates balance availability (LeaveBalance aggregate)
  → Validates policy constraints (Policy Engine: blackout dates, notice period, max duration)
  → Reserves pending balance
  → Submits to Workflow Domain for approval routing
  ↓ emit: leave.application.submitted {application_id, employee_id, dates, days}

Workflow Domain
  → Creates WorkflowInstance (template: LEAVE_APPROVAL)
  → Routes task to manager (consults Organization Domain for reporting hierarchy)
  → Sends notification via Notifications Domain
  ↓ emit: workflow.task.assigned {task_id, assigned_to: manager_id}

[Manager Action: Approve]

Workflow Domain
  ↓ emit: workflow.instance.completed {entity_type: leave, entity_id: application_id, outcome: approved}

Leave Domain (consumes workflow.instance.completed)
  → Finalizes LeaveBalance deduction (moves from pending → availed)
  → Updates application status to approved
  ↓ emit: leave.application.approved {application_id, employee_id, start_date, end_date}

Attendance Domain (consumes leave.application.approved)
  → Links approved leave to absence records for those dates
  → Updates DailyAttendance.leave_linked = application_id
  → Status changes from 'absent' to 'leave_justified'

[At Payroll Cutoff]

Payroll Domain calls: GET /leave/payroll-inputs?employee_id=X&period=P
  → Receives: {lop_days, leave_encashment_days}
  → LopDeductionService applies LOP deduction to payslip
```

### Flow 4: Payroll Run Processing

```
Payroll Admin triggers: POST /payroll/runs {period: 2026-05, run_type: regular}

PayrollRun Domain
  → Validates period not already processed
  → Locks the period (prevents new attendance corrections, leave changes)
  
[Parallel input collection]
  
Attendance Domain ←── GET /attendance/payroll-projection (finalized cycle)
Leave Domain ←──────── GET /leave/payroll-inputs
Comp & Benefits ←────── GET /compensation/pay-structures (active structures)
Policy Engine ←──────── POST /policies/resolve (payroll rules per employee)
Compliance Domain ←───── GET /compliance/statutory-rates (tax tables, PF rates)

PayrollRunService: EarningsComputationService
  → For each employee: computes all earning components
  → Applies OT premium, variable pay, arrears

PayrollRunService: DeductionComputationService
  → Computes statutory deductions (PF, ESI, TDS)
  → Computes voluntary deductions (loans, insurance)

PayrollRunService: AnomalyDetectionService
  → Flags statistical outliers vs. prior 3 periods

PayrollRun.status → computed
↓ emit: payroll.run.computed {run_id, period, summary, anomaly_count}

[HR Review / Approval / AI Anomaly Check]

PayrollRun.status → approved
↓ emit: payroll.run.approved

BankFileGenerationService → Produces NEFT/BACS/GIRO file
PayslipGenerationService → Triggers Documents domain for PDF generation

PayrollRun.status → disbursed
↓ emit: payroll.run.disbursed {run_id, total_disbursed, disbursement_date}

[Downstream consumers]
Analytics Domain ──────→ Updates payroll cost projections
Compliance Domain ──────→ Updates statutory liability tracking
Audit Domain ──────────→ Records full payroll run event chain
AI Domain ─────────────→ Feeds payroll forecasting model
```

### Flow 5: AI Attrition Risk Workflow

```
[Scheduled: weekly]

AI Intelligence Domain: PredictionOrchestrationService
  → Fetches feature dataset from Analytics Domain export:
    {employee tenure, grade, transfer count, attendance pattern, 
     leave utilization, performance rating, peer comparison}
  
  → Runs AttritionRiskModel inference (ML classification)
  → Generates PredictionResult per employee with risk_score + top risk factors
  
  ↓ emit: ai.attrition_risk.flagged (for employees above risk threshold)
    {employee_id, risk_score: 0.82, risk_factors: [low_leave_utilization, recent_transfer, below_market_comp]}

HR Intelligence Dashboard (consumes)
  → Displays at-risk employee list to CHRO/HR BP

AI CopilotService (updates vector memory)
  → Embeds attrition risk context for employee entity
  → Available for copilot query: "Who in sales is at high attrition risk?"

Notification Domain (consumes — for HR managers only, not employees)
  → Sends weekly attrition risk digest to HR Business Partners
```

---

## 4.4 Anti-Coupling Recommendations

The following are the highest-risk coupling patterns that must be actively prevented:

### Anti-Pattern 1: Payroll Reading Attendance Directly
**Risk:** Payroll domain directly querying Attendance domain tables.
**Prevention:** Payroll domain only consumes the published `AttendanceProjection` API — a read model built by Attendance domain specifically for payroll consumption. This projection is the contract. Payroll never touches raw attendance tables.

### Anti-Pattern 2: Attendance Owning Shift Logic
**Risk:** Attendance domain embedding shift definitions and rotation rules.
**Prevention:** Attendance domain receives only a shift assignment reference (shift_id) from Roster domain. Shift detail is resolved through the Shift domain's published projection. Shift business rules live exclusively in Shift Management domain.

### Anti-Pattern 3: Workflow Domain Containing Business Decisions
**Risk:** Workflow domain checking "is this leave request valid" before routing.
**Prevention:** Workflow domain is a pure state machine orchestrator. All business validation happens in the originating domain (Leave domain validates the leave request) before submitting to Workflow. Workflow only knows: "I received an entity, route it through these stages."

### Anti-Pattern 4: Employee Domain Owning Policy Configuration
**Risk:** Employee records accumulating policy exception fields directly.
**Prevention:** Individual employee policy overrides (if needed) are stored in Policy Engine as individual-scope policy definitions referencing employee_id. The Employee domain does not contain policy configuration.

### Anti-Pattern 5: Analytics Domain Reading OLTP Tables
**Risk:** Analytics dashboards powered by direct queries to operational Postgres tables.
**Prevention:** Analytics domain owns its own read-optimized data store (projection tables, possibly separate schema). It is populated exclusively from domain events. Direct cross-domain SQL queries are an architectural defect.

### Anti-Pattern 6: AI Domain Making Operational Decisions
**Risk:** AI recommendations automatically modifying attendance, payroll, or leave records.
**Prevention:** AI domain only publishes recommendation events. Operational mutations require explicit human action or a configured automation rule (owned by the receiving domain's automation service). AI never directly writes to operational domain aggregates.

### Anti-Pattern 7: Notifications Domain Containing Business Logic
**Risk:** Notification domain deciding whether to send a notification based on business rules.
**Prevention:** Business logic for "when to notify" lives in the emitting domain. The emitting domain decides to emit a specific event (e.g., `leave.application.rejected`). Notifications domain simply maps event type to notification template and executes delivery. It contains no business conditions.

---

## 4.5 Event Flow Diagram

```
EVENT FLOW — PRINCIPAL PATHS

                           ┌─────────────────┐
                           │   WRITE DOMAINS  │
                           │  (Event Sources) │
                           └────────┬─────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                       │
    ┌─────────▼──────┐   ┌──────────▼───────┐   ┌─────────▼──────┐
    │   Attendance   │   │     Leave Mgmt   │   │    Payroll     │
    │   ──────────   │   │   ──────────     │   │   ─────────    │
    │ attendance.*   │   │  leave.*         │   │  payroll.*     │
    └────────┬───────┘   └──────────┬───────┘   └─────────┬──────┘
             │                      │                       │
             └──────────────────────┼───────────────────────┘
                                    │
                         ┌──────────▼──────────┐
                         │   INTERNAL EVENT     │
                         │   BUS / OUTBOX       │
                         └──────────┬──────────┘
                                    │
          ┌─────────────────────────┼───────────────────────────┐
          │                         │                            │
 ┌────────▼──────┐       ┌──────────▼──────┐        ┌──────────▼──────┐
 │  Analytics    │       │  Audit Domain   │        │ Notifications   │
 │  Domain       │       │  (immutable log)│        │   Domain        │
 │  (projections)│       └─────────────────┘        │  (dispatch)     │
 └────────┬──────┘                                   └─────────────────┘
          │
 ┌────────▼──────┐
 │ AI Intellig.  │
 │  Domain       │
 │  (features +  │
 │  predictions) │
 └───────────────┘
```

---

## 4.6 Context Integration Pattern Reference

| Integration Pair | Pattern | Rationale |
|---|---|---|
| IAM → All Domains | Shared Kernel (token claims) | Token structure is a shared contract; not a domain coupling |
| Employee → Payroll | Published Language (employee projection) | Payroll consumes a stable projection API, not Employee internals |
| Attendance → Payroll | Published Language (payroll-projection API) | Finalized, frozen projection — Payroll cannot trigger re-computation |
| Policy Engine → All | Open Host Service | Policy resolution is a platform-wide synchronous service |
| Leave → Attendance | Event-based (leave.approved) | Async; Attendance updates absence justification from event |
| All → Audit | Conformist | Audit simply records all events in their native schema |
| All → Analytics | Event-based projections | Analytics builds its own model; never reads operational schemas |
| All → Notifications | Event-based (CF pattern) | Notifications conforms to emitter event schemas |
| External Systems → Platform | Anti-Corruption Layer (Integration Domain) | External models translated to internal canonical forms |
| AI → Operational Domains | Published Language (recommendations) | AI publishes typed recommendation events; domains choose to act |




---


# SECTION 5: EXISTING MODULE ALIGNMENT STRATEGY

---

> **Governing Principle:** The existing system contains hard-won domain logic — attendance computation rules, payroll calculation pipelines, leave entitlement mechanics — that represent years of operational refinement. The architectural migration must *wrap and evolve* this logic, never discard it. Destructive rewrites are an engineering ego trap. Strategic refactoring is the professional path.

---

## 5.0 Alignment Decision Framework

Each existing module is evaluated against four criteria:

| Criterion | Questions Asked |
|---|---|
| **Domain Logic Value** | Does this module contain mature, correct, hard-to-recreate business rules? |
| **Boundary Correctness** | Does the module's current scope map cleanly to one bounded context, or does it bleed across multiple? |
| **Technical Debt Level** | Is the implementation so coupled or outdated that evolving it costs more than rebuilding with the preserved logic? |
| **Integration Risk** | How many downstream systems depend on this module's current interfaces? |

**Decision outcomes:**
- **RETAIN** — Module maps cleanly to a bounded context; logic is sound; interface can be versioned and published as-is
- **REFACTOR** — Logic is valuable but scope is wrong, coupling is high, or interfaces need modernization; preserve rules, reshape structure
- **SPLIT** — Module contains multiple distinct domain responsibilities that must be separated into distinct bounded contexts
- **MERGE** — Module is too granular; two or more modules represent one logical domain and should be consolidated
- **REBUILD** — Domain logic is so entangled with defunct technology or has no reusable substance; reconstruct guided by operational requirements (reuse rules, not code)

---

## 5.1 ATTENDANCE ENGINE

**Decision: REFACTOR → becomes Attendance Domain**

### Current State Assessment
The existing attendance engine is likely the most mature and operationally critical module. It processes raw punch data, applies shift rules, computes OT, and produces daily summaries. This logic is deeply aligned with the **Attendance Domain** as defined in this architecture.

However, the typical issues in an existing attendance engine include:
- Shift definitions are embedded in attendance tables (should be a separate Shift Management domain)
- Leave checking is done via direct table reads into the Leave module (should be event-driven)
- Policy rules (grace periods, OT thresholds) are hard-coded in stored procedures or service methods rather than externalized to a Policy Engine
- Analytics queries run directly against attendance operational tables
- Regularization workflow logic is mixed into the attendance service instead of delegating to a Workflow domain

### Refactoring Strategy
```
RETAIN:  Core punch processing pipeline (deduplication, ordering, gap filling)
RETAIN:  Daily attendance status computation logic (present/absent/late/OT rules)
RETAIN:  Period summary aggregation logic (monthly totals, LOP computation)
RETAIN:  Attendance correction/override mechanisms

EXTRACT: Shift definitions → move to new Shift Management Domain module
EXTRACT: Leave absence lookup → replace with event subscription (leave.application.approved)
EXTRACT: Policy rule constants → externalize to Policy Engine; replace hard-coded values with Policy Engine API calls
EXTRACT: Analytics queries → remove all OLAP-style queries; replace with projection population via domain events
EXTRACT: Regularization workflow routing → delegate to Workflow Domain; Attendance only holds business record

MODERNIZE: Add RawPunchEvent as immutable append-only entity (currently likely mutable)
MODERNIZE: Add AttendanceCycle as aggregate root with status lifecycle
MODERNIZE: Add outbox event emission for attendance.daily.processed, attendance.cycle.finalized
MODERNIZE: Add PayrollProjection endpoint (clean API for Payroll consumption)
```

### Migration Path
**Phase 1 (Month 1–2):** Introduce `AttendanceCycle` and `DailyAttendance` aggregates wrapping existing computation logic. No behavior change — purely structural.

**Phase 2 (Month 2–4):** Extract Policy Engine calls. Replace hard-coded rules with `PolicyEngine.resolve()` calls. Validate outputs match existing behavior before switching.

**Phase 3 (Month 3–5):** Wire domain event emission. `attendance.daily.processed` and `attendance.cycle.finalized` events published to outbox. Downstream consumers (Analytics, AI) begin consuming events.

**Phase 4 (Month 5–6):** Remove direct cross-domain reads. Replace Leave direct query with attendance checking its own `leave_linked` field (set by event handler on `leave.application.approved`).

**Risk:** Medium. The computation logic is being preserved; only the integration interfaces are changing. The greatest risk is the Policy Engine extraction — extensive regression testing of attendance computations before and after is mandatory.

---

## 5.2 LEAVE ENGINE

**Decision: REFACTOR → becomes Leave Management Domain**

### Current State Assessment
The leave engine typically contains solid entitlement and balance logic — accrual rules, carry-forward computations, balance deductions on approval. These are valuable. However, common structural problems include:

- Leave type definitions mixed with entitlement computation (should be separated — types are config, computation is domain logic)
- Approval workflow embedded in leave service (should delegate to Workflow domain)
- Direct database reads for attendance absence justification (should be event-driven)
- Payroll integration via shared table or tight API coupling (should be a published payroll-inputs projection)
- Public holiday calendar stored in leave tables (should be Policy Engine / HolidayCalendar)

### Refactoring Strategy
```
RETAIN:  Leave balance ledger data model and transaction history
RETAIN:  Accrual computation logic (monthly/annual accrual rules)
RETAIN:  Carry-forward and lapsing computation logic
RETAIN:  Leave duration computation (calendar-aware, holiday-aware)
RETAIN:  Balance reservation-on-submit and deduction-on-approval mechanics

EXTRACT: Workflow routing logic → delegate to Workflow Domain (Leave submits to Workflow, listens for completion event)
EXTRACT: Public holiday calendar → move to Policy Engine as HolidayCalendar aggregate
EXTRACT: Leave type configuration UI → remains in Leave domain but expose as proper LeaveType aggregate
EXTRACT: Payroll integration → replace with GET /leave/payroll-inputs clean API endpoint

MODERNIZE: Introduce LeaveBalance as proper aggregate with optimistic locking (prevent race conditions on concurrent applications)
MODERNIZE: Introduce LeaveApplication as aggregate with full status state machine
MODERNIZE: Add outbox events: leave.application.submitted, leave.application.approved, leave.balance.updated
MODERNIZE: Add compensatory off accrual handler (consumes attendance.daily.processed where ot_hours > 0)
```

### Migration Path
**Phase 1 (Month 1–2):** Wrap existing leave logic in `LeaveApplicationService` and `LeaveEntitlementService`. Introduce `LeaveBalance` aggregate with optimistic locking.

**Phase 2 (Month 2–3):** Decouple approval workflow. Leave domain submits to Workflow Domain and consumes `workflow.instance.completed` event to finalize approval. Retire embedded approval logic.

**Phase 3 (Month 3–4):** Migrate holiday calendar to Policy Engine. Update duration computation to consume from Policy Engine `HolidayCalendar` API.

**Phase 4 (Month 4–5):** Add event publication. Wire outbox events. Begin feeding leave data to Analytics via events rather than shared queries.

**Risk:** Low-Medium. Leave logic is relatively self-contained. The highest risk is the optimistic locking introduction — must be tested under concurrent submission load.

---

## 5.3 PAYROLL ENGINE

**Decision: REFACTOR + SPLIT → becomes Payroll Domain + Compensation & Benefits Domain**

### Current State Assessment
The payroll engine is typically the most complex and the most valuable module. It contains:
- The computation pipeline (the "how to calculate payroll" logic) — extremely valuable, years of refinement
- Pay structure/component definitions (what pay components exist, their computation rules)
- Statutory computation tables (tax slabs, PF rates, ESI thresholds)
- Bank file generation logic
- Payslip generation logic

The critical architectural problem: **pay structure definitions (which components, what rates) are mixed with computation logic** in a way that makes the system opaque and hard to configure without code changes.

### Split Decision
The existing payroll module must be split into two bounded contexts:

```
EXISTING PAYROLL MODULE
        ↓ SPLIT INTO:
┌──────────────────────┐     ┌─────────────────────────────┐
│   PAYROLL DOMAIN     │     │  COMPENSATION & BENEFITS     │
│                      │     │       DOMAIN                 │
│  - Computation       │     │  - Pay structure definitions │
│    pipeline          │     │  - Component catalog         │
│  - PayrollRun        │     │  - Salary bands              │
│  - EmployeePayslip   │     │  - Benefit plan definitions  │
│  - Deduction logic   │     │  - Comp review cycle         │
│  - Bank file gen     │     │                              │
│  - Statutory outputs │     │  Payroll domain READS from   │
│                      │     │  C&B domain at run time      │
└──────────────────────┘     └─────────────────────────────┘
```

### Refactoring Strategy for Payroll Domain
```
RETAIN:  Core earnings computation pipeline (the mathematical logic is gold)
RETAIN:  Deduction computation pipeline (statutory and voluntary deduction logic)
RETAIN:  LOP calculation mechanics
RETAIN:  Bank file format generation logic
RETAIN:  Payroll period management and cutoff logic

EXTRACT: Pay component definitions → Compensation & Benefits domain
EXTRACT: Tax rate tables → Compliance domain (statutory rates are compliance data)
EXTRACT: Attendance data reads → replace with PayrollProjection API consumption (Attendance publishes, Payroll consumes)
EXTRACT: Leave data reads → replace with LeavePayrollInputs API consumption

MODERNIZE: Introduce PayrollRun as proper aggregate with full status lifecycle
MODERNIZE: Introduce EmployeePayslip as nested aggregate with immutable computation log
MODERNIZE: Add computation_log (step-by-step trace of every calculation for auditability)
MODERNIZE: Add AnomalyDetectionService (statistical outlier detection per payroll run)
MODERNIZE: Freeze inputs at run-start (PayStructureSnapshot, AttendanceInputSnapshot) — prevent mid-run source changes from affecting computation
MODERNIZE: Add outbox events: payroll.run.computed, payroll.run.disbursed, payroll.payslip.generated
```

### Refactoring Strategy for Compensation & Benefits Domain (new)
The pay structure / component configuration currently embedded in Payroll must be extracted into its own domain aggregate. This is a **new module** created by extraction — the data already exists, but now has a proper home and lifecycle.

```
NEW AGGREGATES:
  - PayStructure (grade → component list → computation rules)
  - BenefitPlan (benefit type → eligibility → amounts)
  - CompensationBand (grade band → salary range)
  - ReimbursementPolicy (expense type → rules → approval)

MIGRATION: Extract pay structure tables to C&B schema
           Payroll domain accesses via C&B published API (not shared tables)
```

### Migration Path
**Phase 1 (Month 1–3):** Preserve all computation logic. Wrap in PayrollRun / EmployeePayslip aggregates. Introduce computation_log. No business behavior change.

**Phase 2 (Month 2–4):** Extract pay structure definitions to Compensation & Benefits module. Payroll consumes C&B API at run initiation to fetch PayStructureSnapshot. Validate payslip outputs are identical.

**Phase 3 (Month 4–5):** Replace attendance and leave direct reads with official projection APIs. Introduce frozen input snapshots.

**Phase 4 (Month 5–6):** Add event publication. Introduce anomaly detection. Wire analytics projections.

**Risk:** High. Payroll computation changes must be validated with extreme care — even penny-level rounding differences are unacceptable. Mandatory: parallel-run strategy where new payroll engine runs alongside old for 2–3 periods with output comparison before cutover.

---

## 5.4 WORKFLOW SERVICE

**Decision: REFACTOR → becomes Workflow & Approvals Domain**

### Current State Assessment
Most existing HRMS workflow implementations fall into one of two anti-patterns:
1. **Too specific:** Separate approval logic per entity type (leave approval service, regularization approval service, etc.) with duplicated routing logic
2. **Too generic and brittle:** A generic workflow engine that stores routing rules in a JSON blob with no type safety

### Refactoring Strategy
```
RETAIN:  The concept of multi-stage approval chains
RETAIN:  Manager hierarchy resolution for approval routing (extract to organization-aware service)
RETAIN:  Approval action recording (approve/reject/delegate history)

REBUILD (if pattern #1 above): Consolidate all entity-specific approval services into single WorkflowInstance engine
REBUILD (if brittle JSON approach): Replace with typed WorkflowTemplate + WorkflowStage model

MODERNIZE: Introduce WorkflowTemplate as versioned aggregate
MODERNIZE: Introduce WorkflowInstance as proper state machine aggregate (not just a status field)
MODERNIZE: Introduce WorkflowTask per stage with actor assignment and SLA deadline
MODERNIZE: Add SLA monitoring and auto-escalation service
MODERNIZE: Add outbox events: workflow.task.assigned, workflow.instance.completed
MODERNIZE: Decouple business validation from workflow engine (originating domain validates; workflow only orchestrates)
```

### Migration Path
**Phase 1:** Map all existing approval flows to WorkflowTemplate definitions. No code changes to business logic.

**Phase 2:** Migrate each entity type (leave, regularization, payroll correction) to use the WorkflowInstance engine. Decommission entity-specific approval services one by one.

**Phase 3:** Add SLA enforcement and notification integration.

**Risk:** Medium. The routing logic is the most complex part — manager hierarchy resolution must be validated against all existing approval flows before migration.

---

## 5.5 NOTIFICATION SERVICE

**Decision: REFACTOR → becomes Notifications Domain**

### Current State Assessment
Notifications in existing HRMS systems are typically scattered: payroll sends its own emails, leave sends its own SMS, attendance sends its own alerts — all with different templates, different delivery mechanisms, and no unified delivery tracking.

### Refactoring Strategy
```
RETAIN:  Any existing email/SMS template content (migrate to centralized template store)
RETAIN:  Existing channel credentials and delivery configurations

CONSOLIDATE: All notification dispatch into single Notifications domain
MODERNIZE: Event-driven consumption model — Notifications subscribes to domain events
MODERNIZE: Centralized template engine with dynamic field substitution
MODERNIZE: Per-user notification preference management (channel opt-outs)
MODERNIZE: Delivery status tracking and retry logic
MODERNIZE: In-app notification inbox as first-class feature
```

**Risk:** Low. Notifications are a peripheral concern. The risk is ensuring no notification gaps during migration (some notifications from old system, some from new).

---

## 5.6 API LAYER

**Decision: REBUILD → replace with Domain-Aligned API Contracts**

### Current State Assessment
Most existing HRMS APIs are either:
- Thin database wrappers (CRUD APIs over tables with no domain logic)
- Monolithic API controllers mixing concerns from multiple domains
- Inconsistently versioned with no backward compatibility guarantees

### Rebuild Strategy
```
REBUILD: Replace all existing API controllers with domain-aligned command/query endpoints
DESIGN:  Each bounded context exposes its own API namespace (/attendance/*, /payroll/*, /leave/*)
DESIGN:  Strict versioning from day one (/v1/, /v2/ — never break existing consumers without version bump)
DESIGN:  Command APIs (POST/PUT/PATCH) enforce aggregate invariants through domain services
DESIGN:  Query APIs serve from read models / projections (never raw aggregate tables)
DESIGN:  API authentication enforcement through IAM middleware (never per-endpoint auth logic)
DESIGN:  OpenAPI specification as the contract artifact — generated from code, not written manually
```

**Note:** "Rebuild" here means the API layer code, NOT the domain logic. Domain logic from existing services is preserved and wrapped. Only the HTTP interface layer is rebuilt — this is a low-risk rebuild because it has no business logic.

**Risk:** Medium. Existing integrations (external systems, frontend) will break if API paths change. Use an Anti-Corruption Layer in the Integration domain to maintain backward-compatible adapter endpoints during transition.

---

## 5.7 ANALYTICS / REPORTING QUERIES

**Decision: REBUILD → becomes Analytics Domain with event-driven projections**

### Current State Assessment
Existing analytics in most HRMS systems are: complex SQL queries running directly against operational Postgres tables, sometimes with materialized views but still sharing the OLTP database. This creates:
- Performance contention (reporting queries blocking operational transactions)
- Tight coupling (schema changes in attendance tables break attendance reports)
- No real-time capability (reports are always point-in-time snapshots)

### Rebuild Strategy
```
REBUILD: Retire all direct OLTP analytics queries
BUILD NEW: Analytics domain with separate projection tables (own Postgres schema)
BUILD NEW: Event-driven projection population (domain events → Analytics projections)
BUILD NEW: Pre-aggregated summary tables for common KPI queries (sub-second performance)
BUILD NEW: Dashboard API layer serving from projections only

MIGRATION: 
  Step 1: Build projection tables alongside existing analytics queries
  Step 2: Validate projection outputs match existing query outputs
  Step 3: Switch dashboards to consume projection APIs
  Step 4: Decommission OLTP analytics queries
```

**Preserve:** Report definitions and KPI formulas (what to measure and how). These are valuable business knowledge that must be translated — not discarded — into the new projection computation logic.

**Risk:** Medium. The rebuild risk is primarily the initial data backfill — projections must be seeded with historical data from existing tables before event-driven updates take over. A one-time migration job per domain handles this.

---

## 5.8 EXISTING SUPABASE/POSTGRES FOUNDATION

**Decision: RETAIN + EVOLVE**

### Strategy
The Supabase/Postgres foundation is a significant asset. Postgres is enterprise-grade, proven at scale, and an excellent fit for the bounded context model:

```
RETAIN:  Postgres as the primary operational data store
RETAIN:  Supabase Realtime for push-based event delivery to frontend (attendance dashboards, notification inbox)
RETAIN:  Supabase Row Level Security (RLS) as a defense-in-depth mechanism for tenant isolation (supplementing application-level tenant filtering)
RETAIN:  Supabase Storage for document management (integrated with Documents domain)

EVOLVE:  Introduce Postgres schema-per-domain isolation (each bounded context gets its own Postgres schema: attendance.*, payroll.*, leave.*)
EVOLVE:  Introduce outbox table per domain schema for reliable event publication
EVOLVE:  Introduce domain-specific read model tables within each domain schema
EVOLVE:  Analytics domain may eventually migrate to columnar store (TimescaleDB, ClickHouse) for time-series performance — but this is a Phase 3 concern

DO NOT: Enforce cross-domain constraints at the database level (no FK constraints across domain schemas). All cross-domain referential integrity is maintained at the application/event level.
```

---

## 5.9 Module Alignment Summary Table

| Existing Module | Decision | Target Domain | Preserve | Extract/Rebuild |
|---|---|---|---|---|
| Attendance Engine | REFACTOR | Attendance Domain | Punch processing, daily computation, OT logic, period summaries | Shift definitions, policy constants, analytics queries, workflow routing |
| Leave Engine | REFACTOR | Leave Management Domain | Balance ledger, accrual logic, carry-forward, duration computation | Approval workflow, holiday calendar, payroll integration interface |
| Payroll Engine | REFACTOR + SPLIT | Payroll Domain + C&B Domain | Computation pipeline, deduction logic, bank file generation | Pay structure definitions (→ C&B), statutory rates (→ Compliance), direct data reads |
| Workflow Service | REFACTOR | Workflow & Approvals Domain | Approval chain concept, hierarchy routing, action history | Entity-specific logic (consolidate to generic engine), SLA monitoring |
| Notification Service | REFACTOR | Notifications Domain | Template content, delivery channel config | Scattered per-domain dispatch (consolidate), event-driven consumption model |
| API Layer | REBUILD | All Domain APIs | None (logic preserved in domain services) | Entire HTTP layer replaced with domain-aligned versioned APIs |
| Analytics/Reporting | REBUILD | Analytics Domain | KPI definitions, report formulas, business metric definitions | All OLTP queries replaced with event-driven projections |
| Supabase/Postgres | RETAIN + EVOLVE | Platform Infrastructure | Core DB engine, RLS, Realtime, Storage | Add schema isolation, outbox tables, domain-specific read models |




---


# SECTION 6: POLICY ENGINE DOMAIN STRATEGY

---

## 6.0 Strategic Rationale

The Policy Engine is the most architecturally distinctive element of this platform design. Most HRMS systems scatter business rule configuration across domain tables, application configuration files, and hard-coded constants. The result is a system where changing an overtime rule requires a database migration, changing a leave entitlement requires code modification, and tenant-specific compliance adjustments require manual intervention.

The Policy Engine corrects this by establishing a **single, versioned, audited, simulation-capable configuration layer** that all operational domains invoke before executing business computations.

**The fundamental contract:**
> *Domains own computation logic. The Policy Engine owns computation parameters.*

This means: Attendance computes overtime. But how many hours constitute the daily overtime threshold, what multiplier applies, and whether it's computed daily or weekly — those are Policy Engine parameters.

---

## 6.1 Policy Domain Structure

### Policy Domains (Namespaces)

The Policy Engine organizes policies into domain namespaces — each namespace serves a specific operational domain:

```
POLICY ENGINE NAMESPACES

┌─────────────────────────────────────────────────────────────┐
│                     POLICY ENGINE                           │
│                                                             │
│  ┌─────────────────┐  ┌────────────────┐                  │
│  │ ATTENDANCE_POLICY│  │  LEAVE_POLICY  │                  │
│  │                 │  │                │                  │
│  │ • Grace windows │  │ • Entitlement  │                  │
│  │ • OT thresholds │  │ • Carry-forward│                  │
│  │ • Rounding rules│  │ • Blackout days│                  │
│  │ • Break deducts │  │ • Notice period│                  │
│  │ • Late deduction│  │ • Encashment   │                  │
│  └─────────────────┘  └────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌────────────────┐                  │
│  │  PAYROLL_POLICY │  │ ROSTER_POLICY  │                  │
│  │                 │  │                │                  │
│  │ • OT rate rules │  │ • Min coverage │                  │
│  │ • LOP deduction │  │ • Max consec.  │                  │
│  │ • Rounding      │  │   working days │                  │
│  │ • Advance limits│  │ • Min rest hrs │                  │
│  │ • Reimbursement │  │ • Shift swap   │                  │
│  │   limits        │  │   rules        │                  │
│  └─────────────────┘  └────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌────────────────┐                  │
│  │COMPLIANCE_POLICY│  │ HOLIDAY_CALENDAR│                 │
│  │                 │  │                │                  │
│  │ • Working time  │  │ • National     │                  │
│  │   max hours     │  │   holidays     │                  │
│  │ • Min wage floor│  │ • Optional     │                  │
│  │ • Rest period   │  │   holidays     │                  │
│  │   requirements  │  │ • Restricted   │                  │
│  └─────────────────┘  └────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 6.2 Policy Versioning Architecture

Every policy definition is versioned using **semantic versioning with temporal validity**:

```
PolicyDefinition {
  policy_id:       UUID           -- unique record identifier
  policy_code:     String         -- stable domain-specific code (e.g., "ATT_GRACE_POLICY")
  domain:          PolicyDomain   -- attendance | leave | payroll | roster | compliance
  version:         {major, minor} -- major = breaking change; minor = backward-compatible addition
  rule_set:        JSON           -- domain-specific schema-validated rule parameters
  effective_from:  Date           -- when this version takes effect
  effective_to:    Date | null    -- null = currently active / indefinite
  status:          draft | active | superseded | archived
  superseded_by:   UUID | null    -- links to the version that replaced this one
  created_by:      UUID           -- actor who created this version
  approved_by:     UUID | null    -- required for activation
  created_at:      Timestamp
  activated_at:    Timestamp | null
}
```

### Version Lifecycle State Machine

```
                      ┌─────────┐
                      │  DRAFT  │ ← Policy admin creates new version
                      └────┬────┘
                           │ approve() — requires authorized approver
                           ▼
                      ┌─────────┐
            ┌────────►│ ACTIVE  │ ← Only one ACTIVE version per policy_code per scope at a time
            │         └────┬────┘
   (future  │              │ new version activated (effective_from reached)
   version  │              ▼
   becomes  │        ┌────────────┐
   active)  └────────│ SUPERSEDED │ ← Retained for historical resolution
                     └────────────┘
                           │ after retention_period
                           ▼
                      ┌──────────┐
                      │ ARCHIVED │ ← Immutable, queryable for audit
                      └──────────┘
```

### Version Transition Rules
1. **Only one active version per `(policy_code, scope, tenant_id)` tuple at any time.** Activating a new version automatically supersedes the current active version.
2. **A new version's `effective_from` cannot be in the past.** Policy changes cannot retroactively alter already-computed payroll periods or finalized attendance cycles.
3. **Superseded versions are NEVER deleted.** They are required for historical policy resolution (e.g., "what was the OT policy in March 2025?").
4. **Major version bumps require all downstream domain teams to validate compatibility** before activation. Minor version bumps are backward-compatible and can be activated after internal review.

---

## 6.3 Effective-Date Resolution Engine

The Policy Engine's most critical service is the **resolution engine** — given a query context (who, where, when), return the single applicable policy.

### Resolution Algorithm

```
PolicyResolutionService.resolve(context: PolicyResolutionContext) → ResolutionResult

Input context:
  - tenant_id
  - employee_id
  - entity_id (legal entity)
  - unit_id (org unit)
  - location_id
  - employment_type
  - jurisdiction (country + state)
  - evaluation_date
  - policy_domain (attendance | leave | payroll | roster | compliance)
  - policy_code (specific policy being requested)

Resolution algorithm (most specific wins):
  1. Query: policy for (tenant, policy_code, scope=employee_id, evaluation_date)
     → If found and active: return this policy (individual override)
  
  2. Query: policy for (tenant, policy_code, scope=unit_id, evaluation_date)
     → If found and active: return this policy (department-level override)
  
  3. Query: policy for (tenant, policy_code, scope=location_id, evaluation_date)
     → If found and active: return this policy (location-level override)
  
  4. Query: policy for (tenant, policy_code, scope=employment_type, evaluation_date)
     → If found and active: return this policy (employment-type override)
  
  5. Query: policy for (tenant, policy_code, scope=entity_id, evaluation_date)
     → If found and active: return this policy (legal entity override)
  
  6. Query: policy for (tenant, policy_code, scope=ALL, evaluation_date)
     → If found and active: return this policy (tenant-wide default)
  
  7. Query: policy for (PLATFORM, policy_code, scope=ALL)
     → If found: return platform-level default (fallback)
  
  8. Return: PolicyNotConfiguredError
     → Domain must handle missing policy gracefully (alert, use safe defaults)
```

### Resolution Result Contract
```
ResolutionResult {
  policy_id:         UUID        -- which specific policy definition applied
  policy_code:       String
  version:           {major, minor}
  rule_set:          JSON        -- the actual parameters to apply
  resolved_at_scope: String      -- employee | unit | location | employment_type | entity | tenant | platform
  evaluation_date:   Date
  cache_ttl_seconds: Integer     -- how long callers may cache this result
}
```

### Caching Strategy
Policy resolution results are **aggressively cached** because:
- They are read-heavy (called on every punch, every leave computation, every payroll line item)
- They change rarely (policies are modified infrequently compared to operational data)
- Cache invalidation is event-driven: `policy.activated` event triggers cache flush for affected scope

```
Cache key: {tenant_id}:{policy_code}:{scope_key}:{date}
Cache TTL: 300 seconds (overridden by resolution result's cache_ttl_seconds)
Invalidation: broadcast cache-bust message on policy.activated event
Fallback on cache miss: call Policy Engine synchronously
```

---

## 6.4 Tenant Override Hierarchy

The Policy Engine supports **five levels of override**, from broadest to most specific:

```
POLICY OVERRIDE HIERARCHY (most specific overrides less specific)

Level 1 — Platform Default
  ├── Defined by platform team
  ├── Applies when no tenant override exists
  └── Cannot be disabled; serves as safety net

Level 2 — Tenant Default
  ├── Defined by tenant admin
  ├── Applies to all employees in tenant unless overridden
  └── Most common configuration level

Level 3 — Legal Entity Override
  ├── Defined for a specific subsidiary/entity within tenant
  ├── Example: UAE entity has different OT rules than India entity
  └── Overrides tenant default for employees in that entity

Level 4 — Department / Location Override
  ├── Defined for specific org units or locations
  ├── Example: Manufacturing plant has different grace windows than head office
  └── Overrides entity and tenant defaults

Level 5 — Individual Employee Override
  ├── Defined for specific employees
  ├── Example: Senior executive with custom leave entitlement per contract
  └── Overrides all group-level policies
  └── Requires HR admin + legal authorization to create
```

### Multi-Tenant Isolation
Each tenant's policy tree is fully isolated. A Platform-level default is the only cross-tenant shared configuration, and it is read-only from any tenant's perspective. Tenant A cannot see or affect Tenant B's policy definitions.

---

## 6.5 Policy Simulation Engine

Before activating a new policy, administrators must be able to understand its impact. The **Simulation Engine** answers: "If we activate this new OT policy from next month, how many employees are affected, by how much, and what is the estimated payroll cost delta?"

### Simulation Architecture

```
SimulationRequest {
  simulation_id:     UUID
  tenant_id:         UUID
  policy_id:         UUID            -- the DRAFT policy to simulate
  simulation_scope:  EmployeeScope   -- all | unit | location | sample
  reference_period:  DateRange       -- historical period to use as base data
  requested_by:      UUID
}

SimulationEngine.run(request):
  1. Fetch all employees in simulation_scope
  2. For each employee:
     a. Load historical operational data for reference_period (attendance, leave)
     b. Run computation with CURRENT policy → current_result
     c. Run computation with NEW (draft) policy → simulated_result
     d. Compute delta: simulated_result - current_result
  3. Aggregate results:
     - Affected employee count
     - Average impact per employee
     - Total estimated impact (OT cost delta, LOP day delta, etc.)
     - Distribution histogram (who is most/least impacted)
     - Compliance risk flags (any employees falling below statutory minimums under new policy)

SimulationResult {
  simulation_id:      UUID
  status:             running | completed | failed
  affected_count:     Integer
  total_delta:        Money | Duration   -- type depends on policy domain
  per_employee:       [EmployeeSimResult]
  compliance_flags:   [ComplianceFlag]
  completed_at:       Timestamp
  summary_narrative:  String            -- human-readable summary for admin review
}
```

### Simulation Constraints
- Simulation runs **asynchronously** (async job triggered by request; result fetched by polling or notification)
- Simulation results are **advisory only** — they do not affect operational records
- Simulation results are retained for 90 days and linked to the policy version for decision audit trail
- Large-tenant simulations (50,000+ employees) are throttled and run in background batches

---

## 6.6 Policy Auditability

Every policy change — creation, modification, activation, deactivation — generates an immutable audit record:

```
PolicyAuditRecord {
  audit_id:       UUID
  policy_id:      UUID
  event_type:     created | modified | submitted_for_approval | approved | activated | superseded | archived
  actor_id:       UUID
  actor_role:     String
  old_state:      JSON?       -- previous policy state snapshot
  new_state:      JSON        -- new policy state snapshot
  diff:           JSON        -- computed diff between old and new state
  justification:  String      -- mandatory free-text reason for change
  ip_address:     String
  occurred_at:    Timestamp
}
```

### Four-Eyes Principle for Policy Activation
Policy activation for any policy with a financial or compliance impact requires **dual authorization**:
1. A policy admin creates and submits the new version (status: `draft → submitted`)
2. A separate authorized approver (HR Director or Compliance Officer role) reviews and activates (status: `submitted → active`)

The same actor cannot both create and activate a high-impact policy — enforced at the domain service level.

---

## 6.7 How Operational Domains Invoke the Policy Engine

The integration pattern is **synchronous pull** at computation time:

```python
# Example: Attendance Domain — computing daily OT hours

class AttendanceProcessingService:
    
    def compute_daily_attendance(self, employee_id, date, raw_punches):
        
        # Step 1: Build resolution context
        context = PolicyResolutionContext(
            tenant_id=employee.tenant_id,
            employee_id=employee_id,
            entity_id=employee.entity_id,
            unit_id=employee.unit_id,
            location_id=employee.location_id,
            employment_type=employee.employment_type,
            jurisdiction=employee.jurisdiction,
            evaluation_date=date,
            policy_domain=PolicyDomain.ATTENDANCE,
            policy_code="ATT_OVERTIME_RULES"
        )
        
        # Step 2: Fetch applicable policy (cached)
        ot_policy: ResolutionResult = policy_engine.resolve(context)
        ot_rules = ot_policy.rule_set
        # ot_rules = {daily_ot_threshold_hours: 8, weekly_ot_threshold_hours: 48, ot_rate_multiplier: 1.5, ...}
        
        # Step 3: Apply policy parameters to computation
        effective_hours = compute_effective_hours(raw_punches, ot_rules)
        ot_hours = max(0, effective_hours - ot_rules['daily_ot_threshold_hours'])
        
        # Domain owns computation; Policy Engine owns parameters
        return DailyAttendance(effective_hours=effective_hours, ot_hours=ot_hours, ...)
```

### Domain Integration Requirements
Each operational domain must:
1. **Never hard-code policy parameters.** Every threshold, rate, limit, or rule value must be fetched from Policy Engine.
2. **Pass the full resolution context.** Don't shortcut with partial context — the resolution engine needs all scope identifiers to select the most specific applicable policy.
3. **Handle `PolicyNotConfiguredError` gracefully.** Domains must define safe-default behavior when a policy is not configured (log alert, use platform default, or reject the operation with a clear error).
4. **Respect `cache_ttl_seconds`.** Cache resolved policies for the duration specified in the result — do not make a Policy Engine call for every individual computation within a batch.

---

## 6.8 Policy Schema Validation

Each policy domain has a **strictly defined JSON Schema** for its `rule_set` field. Attempting to activate a policy with an invalid rule_set fails schema validation before persistence:

### Example: Attendance Policy Rule Set Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "title": "AttendanceOvertimePolicy",
  "type": "object",
  "required": ["daily_ot_threshold_hours", "weekly_ot_threshold_hours", "ot_computation_basis"],
  "properties": {
    "daily_ot_threshold_hours": {
      "type": "number",
      "minimum": 4,
      "maximum": 24,
      "description": "Hours of work per day beyond which overtime applies"
    },
    "weekly_ot_threshold_hours": {
      "type": "number",
      "minimum": 20,
      "maximum": 168
    },
    "ot_computation_basis": {
      "type": "string",
      "enum": ["daily", "weekly", "both_daily_then_weekly"]
    },
    "grace_period_late_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 120
    },
    "grace_period_early_departure_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 120
    },
    "rounding_rule": {
      "type": "string",
      "enum": ["none", "nearest_15", "nearest_30", "floor_15", "floor_30"]
    },
    "break_deduction_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 120
    }
  },
  "additionalProperties": false
}
```

Schema validation ensures that policy administrators cannot create structurally invalid policies that would cause runtime computation failures in operational domains.




---


# SECTION 7: EVENT OWNERSHIP STRATEGY

---

## 7.0 Event Architecture Principles

Domain events are **first-class architectural citizens** — not implementation details, not log entries, not notifications. They represent **facts about what happened in a bounded context**, stated in the past tense, owned by a single canonical source.

### Core Event Principles

**1. Single Source of Truth per Event Type**
Every event type has exactly one domain that is authorized to emit it. `attendance.daily.processed` is only ever emitted by the Attendance domain. No other domain may emit this event. This is the *event authority* rule.

**2. Events are Immutable Facts**
Once an event is emitted and persisted to the outbox, it cannot be modified or retracted. If a fact changes (attendance is corrected), a new event is emitted (`attendance.correction.applied`). The original event remains in the log.

**3. Events are Published Contracts**
Event schemas are versioned contracts. Consumers build on event schemas. A breaking change to an event schema requires a version bump and a consumer migration period. Event schemas are as carefully managed as API schemas.

**4. Events Describe What Happened, Not What To Do**
Events use past tense (`leave.application.approved`, not `approve_leave`). They describe a fact that occurred. What downstream consumers do with that fact is their own business.

**5. Consumers are Autonomous**
Downstream event consumers must never require the emitting domain to know about them. Attendance emits `attendance.daily.processed` without knowing that Analytics, Payroll, and AI domains will consume it. Adding a new consumer never requires changes to the emitting domain.

---

## 7.1 Outbox Pattern Implementation

The Outbox Pattern guarantees that **domain state changes and event publication are atomic** — either both happen, or neither does. This prevents the most dangerous consistency failure in event-driven systems: state changes that are not followed by their events (consumers miss the fact).

```
OUTBOX PATTERN FLOW

Application Transaction:
  ┌─────────────────────────────────────────────────────────┐
  │  BEGIN TRANSACTION                                       │
  │                                                          │
  │  1. Update domain aggregate (e.g., DailyAttendance)     │
  │  2. INSERT INTO attendance.outbox {                      │
  │       event_id:       UUID                               │
  │       event_type:     'attendance.daily.processed'       │
  │       aggregate_id:   {daily_attendance_id}              │
  │       aggregate_type: 'DailyAttendance'                  │
  │       payload:        {JSON event payload}               │
  │       created_at:     NOW()                              │
  │       published:      false                              │
  │     }                                                    │
  │                                                          │
  │  COMMIT TRANSACTION                                      │
  └─────────────────────────────────────────────────────────┘
                      ↓
          Outbox Relay Process (polling loop)
  ┌─────────────────────────────────────────────────────────┐
  │  SELECT * FROM attendance.outbox WHERE published = false │
  │  ORDER BY created_at ASC LIMIT 100                       │
  │                                                          │
  │  FOR each unpublished event:                             │
  │    → Publish to Event Bus (in-process or external MQ)   │
  │    → On success: UPDATE outbox SET published = true      │
  │    → On failure: retry with exponential backoff          │
  └─────────────────────────────────────────────────────────┘
```

### Outbox Table Schema (per domain)
```sql
CREATE TABLE {domain}.outbox (
  event_id        UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type      VARCHAR(120) NOT NULL,
  aggregate_type  VARCHAR(80)  NOT NULL,
  aggregate_id    UUID         NOT NULL,
  tenant_id       UUID         NOT NULL,
  payload         JSONB        NOT NULL,
  schema_version  INTEGER      NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  published       BOOLEAN      NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  publish_attempts INTEGER     NOT NULL DEFAULT 0,
  last_error      TEXT
);

CREATE INDEX idx_outbox_unpublished ON {domain}.outbox (created_at) WHERE published = false;
```

---

## 7.2 Event Schema Standard

All domain events conform to a **canonical envelope schema** that wraps the domain-specific payload:

```json
{
  "event_id":       "uuid-v4",
  "event_type":     "attendance.daily.processed",
  "event_version":  1,
  "schema_version": 1,
  "occurred_at":    "2026-05-09T14:30:00Z",
  "tenant_id":      "uuid-v4",
  "aggregate_type": "DailyAttendance",
  "aggregate_id":   "uuid-v4",
  "correlation_id": "uuid-v4",
  "causation_id":   "uuid-v4",
  "emitted_by":     "attendance-domain",
  "payload": {
    // domain-specific fields
  }
}
```

| Field | Purpose |
|---|---|
| `event_id` | Unique event identifier — enables idempotent consumer processing |
| `event_type` | Namespaced event type identifier — primary routing key |
| `event_version` | Payload schema version — enables consumer migration |
| `occurred_at` | When the business fact occurred (not when the event was published) |
| `tenant_id` | Tenant scope — mandatory on all events |
| `correlation_id` | Traces a chain of related events across domains (e.g., all events from one payroll run) |
| `causation_id` | The `event_id` of the event that caused this event — enables causal chain reconstruction |
| `emitted_by` | Source domain identifier |

---

## 7.3 Canonical Event Registry

### TIER 1: FOUNDATION EVENTS

#### Identity & Access Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `iam.user.provisioned` | IAM | User account created | Employee, Audit |
| `iam.user.deprovisioned` | IAM | User account disabled | Employee, Audit |
| `iam.session.created` | IAM | Login session started | Audit |
| `iam.session.revoked` | IAM | Session terminated | Audit |
| `iam.login.failed` | IAM | Authentication failure | Audit, AI (security) |
| `iam.role.assigned` | IAM | Role granted to user | Audit |
| `iam.role.revoked` | IAM | Role removed from user | Audit |

#### Organization Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `org.unit.created` | Organization | New org unit defined | Analytics, Audit |
| `org.unit.restructured` | Organization | Unit moved in hierarchy | Employee, Analytics, Audit |
| `org.unit.deactivated` | Organization | Unit closed | Employee, Analytics, Audit |
| `org.reporting.changed` | Organization | Manager relationship updated | Workflow, Analytics, Audit |
| `org.location.created` | Organization | New location added | Attendance, Roster, Analytics |
| `org.costcenter.reassigned` | Organization | Cost center changed for unit | Payroll, Analytics, Audit |

#### Employee Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `employee.created` | Employee | New employee record created | IAM, Leave, Attendance, Payroll, Analytics, Audit, Notifications |
| `employee.onboarded` | Employee | Onboarding complete, officially joined | Leave, Attendance, Comp&Ben, Notifications, Analytics |
| `employee.transferred` | Employee | Inter-department/entity transfer | Organization, Attendance, Payroll, Analytics, Audit |
| `employee.promoted` | Employee | Grade/title change | Payroll, Comp&Ben, Analytics, Audit |
| `employee.status_changed` | Employee | Employment status transition | IAM, Attendance, Leave, Payroll, Analytics |
| `employee.exited` | Employee | Exit confirmed | IAM (deprovision), Asset, Leave (final encashment), Payroll (FNF), Audit, Notifications |
| `employee.profile_updated` | Employee | Personal/contact details changed | Audit, Notifications |

#### Policy Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `policy.activated` | Policy Engine | Policy version went live | ALL domains (cache invalidation) |
| `policy.superseded` | Policy Engine | Policy version replaced | Audit |
| `policy.simulation.completed` | Policy Engine | Simulation results ready | Notifications (to requestor) |
| `holiday.calendar.published` | Policy Engine | Holiday calendar for new year | Leave, Attendance, Roster |

---

### TIER 2: OPERATIONAL EVENTS

#### Attendance Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `attendance.punched` | Attendance | Raw punch received and validated | AI (real-time monitoring), Analytics (live dashboard) |
| `attendance.daily.processed` | Attendance | Day-level computation complete | Analytics, AI, Notifications (absence alerts) |
| `attendance.cycle.finalized` | Attendance | Period locked, payroll inputs ready | Payroll (triggers run eligibility) |
| `attendance.regularization.submitted` | Attendance | Employee submitted correction | Workflow (initiates approval) |
| `attendance.regularization.approved` | Attendance | Correction approved and applied | Analytics, Audit |
| `attendance.anomaly.detected` | Attendance | Unusual pattern flagged | AI Intelligence, Notifications (HR alert) |
| `attendance.correction.applied` | Attendance | Manual correction applied by HR | Audit |

**Canonical payload — `attendance.daily.processed`:**
```json
{
  "payload": {
    "employee_id":        "uuid",
    "attendance_date":    "2026-05-09",
    "status":             "present",
    "shift_id":           "uuid",
    "first_in":           "2026-05-09T09:02:00Z",
    "last_out":           "2026-05-09T18:15:00Z",
    "effective_hours":    8.5,
    "overtime_hours":     0.5,
    "is_late":            false,
    "late_minutes":       0,
    "early_departure_minutes": 0,
    "source":             "biometric",
    "policy_version_used": {"policy_code": "ATT_OVERTIME_RULES", "version": "2.1"},
    "leave_linked_id":    null
  }
}
```

#### Shift Management Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `shift.defined` | Shift Management | New shift type created | Roster, Analytics |
| `shift.updated` | Shift Management | Shift timing/rules changed | Roster, Attendance, Analytics |

#### Roster Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `roster.published` | Roster Planning | Roster for a period made official | Attendance, Notifications (employee), Analytics |
| `roster.assignment.changed` | Roster Planning | Individual assignment modified | Attendance, Notifications |
| `roster.violation.detected` | Roster Planning | Constraint breach identified | Notifications (manager), Compliance |

#### Leave Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `leave.application.submitted` | Leave Management | New leave request created | Workflow (routing), Notifications |
| `leave.application.approved` | Leave Management | Leave approved and balance deducted | Attendance (absence justification), Analytics, Audit, Notifications |
| `leave.application.rejected` | Leave Management | Leave rejected | Notifications, Audit |
| `leave.application.cancelled` | Leave Management | Leave cancelled (by employee or HR) | Attendance, Analytics, Audit |
| `leave.balance.updated` | Leave Management | Balance changed (accrual/deduction/carry) | Analytics, AI |
| `leave.compoff.accrued` | Leave Management | Compensatory off balance added | Notifications (employee) |
| `leave.encashment.processed` | Leave Management | Leave encashment submitted to payroll | Payroll |
| `leave.period.closed` | Leave Management | Year-end processing complete | Analytics, Audit |

**Canonical payload — `leave.application.approved`:**
```json
{
  "payload": {
    "application_id":  "uuid",
    "employee_id":     "uuid",
    "leave_type_id":   "uuid",
    "leave_type_code": "ANNUAL_LEAVE",
    "start_date":      "2026-05-12",
    "end_date":        "2026-05-14",
    "days_approved":   3.0,
    "approved_by":     "uuid",
    "approved_at":     "2026-05-09T11:20:00Z",
    "new_balance":     12.0,
    "balance_unit":    "days"
  }
}
```

---

### TIER 3: FINANCIAL EVENTS

#### Payroll Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `payroll.run.initiated` | Payroll | Payroll run started | Audit, Notifications (admin) |
| `payroll.run.computed` | Payroll | Computation complete, pending review | AI (anomaly check), Analytics, Notifications |
| `payroll.run.approved` | Payroll | Run approved for disbursement | Audit |
| `payroll.run.disbursed` | Payroll | Payments released | Analytics, Compliance, Finance Integration, Audit, Notifications (employees) |
| `payroll.payslip.generated` | Payroll | Individual payslip available | Documents (store), Notifications (employee) |
| `payroll.anomaly.detected` | Payroll | Statistical outlier in run | AI Intelligence, Notifications (payroll admin) |
| `payroll.correction.applied` | Payroll | Post-disbursement correction | Analytics, Audit |

**Canonical payload — `payroll.run.disbursed`:**
```json
{
  "payload": {
    "run_id":               "uuid",
    "period":               {"year": 2026, "month": 5},
    "run_type":             "regular",
    "disbursement_date":    "2026-05-31",
    "employee_count":       1250,
    "total_gross":          {"amount": "12500000.00", "currency": "INR"},
    "total_deductions":     {"amount": "2100000.00", "currency": "INR"},
    "total_net_disbursed":  {"amount": "10400000.00", "currency": "INR"},
    "statutory_liabilities":[
      {"type": "PF_EMPLOYER", "amount": "750000.00"},
      {"type": "ESI_EMPLOYER", "amount": "125000.00"}
    ]
  }
}
```

---

### TIER 4: PROCESS EVENTS

#### Workflow Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `workflow.instance.created` | Workflow | Approval process started | Audit, Notifications |
| `workflow.task.assigned` | Workflow | Approval task sent to actor | Notifications (approver) |
| `workflow.task.completed` | Workflow | Actor took action | Notifications |
| `workflow.instance.completed` | Workflow | All stages done → outcome determined | All originating domains (Leave, Payroll, etc.) |
| `workflow.sla.breached` | Workflow | Approval overdue | Notifications (escalation), Audit |
| `workflow.escalated` | Workflow | Task escalated to next actor | Notifications |

**Canonical payload — `workflow.instance.completed`:**
```json
{
  "payload": {
    "instance_id":    "uuid",
    "entity_type":    "leave_application",
    "entity_id":      "uuid",
    "outcome":        "approved",
    "final_actor_id": "uuid",
    "completed_at":   "2026-05-09T11:18:00Z",
    "stages_completed": 2,
    "total_duration_hours": 3.5
  }
}
```

#### Compliance Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `compliance.violation.detected` | Compliance | Statutory rule breach identified | Notifications (HR/Legal), Audit, AI |
| `compliance.report.generated` | Compliance | Statutory report produced | Audit |

#### Audit Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `audit.record.created` | Audit | Audit log entry persisted | None (Audit is terminal consumer) |

---

### TIER 5: INTELLIGENCE EVENTS

#### AI Intelligence Events
| Event Type | Emitter | Description | Key Consumers |
|---|---|---|---|
| `ai.prediction.generated` | AI Intelligence | Prediction job completed | Analytics |
| `ai.attrition_risk.flagged` | AI Intelligence | Employee flagged as high attrition risk | Notifications (HR BP only), Analytics |
| `ai.payroll_anomaly.flagged` | AI Intelligence | Payroll line flagged as suspicious | Payroll domain (pre-disbursement hold queue), Notifications |
| `ai.recommendation.published` | AI Intelligence | AI recommendation ready for domain | Target operational domain |
| `ai.model.drift_detected` | AI Intelligence | Model accuracy degraded | Notifications (AI ops team) |

---

## 7.4 Event Delivery Semantics

### At-Least-Once Delivery
All events in this platform use **at-least-once delivery** semantics. This means:
- Events may be delivered more than once (duplicate delivery is possible, especially during outbox retry)
- All event consumers **must implement idempotent processing**

### Idempotency Implementation
```sql
-- Consumer idempotency table (per consuming domain)
CREATE TABLE {domain}.processed_events (
  event_id     UUID         NOT NULL PRIMARY KEY,  -- deduplicate by event_id
  event_type   VARCHAR(120) NOT NULL,
  processed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Consumer processing pattern:
BEGIN;
  INSERT INTO {domain}.processed_events (event_id, event_type)
  VALUES ($event_id, $event_type)
  ON CONFLICT (event_id) DO NOTHING;
  
  IF rows_affected = 0:
    ROLLBACK;
    -- Event already processed — skip
    RETURN;
  
  -- Process event business logic here
  
COMMIT;
```

### Event Ordering Guarantees
- **Within a single aggregate:** Events are ordered by `occurred_at` timestamp. The outbox relay publishes in `created_at` order per aggregate, guaranteeing causal ordering for the same aggregate.
- **Across aggregates:** No ordering guarantee. Consumers must handle out-of-order delivery using the `occurred_at` timestamp for sequencing where order matters.
- **Cross-domain ordering:** Not guaranteed. Consumers must be designed for eventual consistency.

---

## 7.5 Event Versioning and Evolution

### Schema Evolution Rules

**Non-breaking changes (no version bump required):**
- Adding optional fields to payload (existing consumers ignore unknown fields)
- Expanding enum value sets (new values consumers must handle gracefully)

**Breaking changes (version bump required):**
- Removing fields from payload
- Renaming fields
- Changing field types
- Making previously optional fields required

### Versioning Strategy
When a breaking change is required:
1. New event type version published: `attendance.daily.processed.v2`
2. Both `v1` and `v2` emitted simultaneously during migration window (6 weeks minimum)
3. Consumers migrate from `v1` to `v2` subscription at their own pace
4. After all consumers confirmed migrated: `v1` emission deprecated and retired

### Consumer Registry
Each team maintaining a domain event consumer must register in the platform's **Event Consumer Registry** — a maintained document (or internal service catalog entry) recording:
- Which events the domain consumes
- The minimum schema version supported
- Consumer idempotency implementation confirmation

This registry enables impact assessment when event schemas must change.

---

## 7.6 Event Bus Migration Path

```
PHASE 1 (Now → 12 months): IN-PROCESS EVENT BUS
  ┌────────────────────────────────────────────────┐
  │  Domain → Outbox Table → Outbox Relay          │
  │  → In-Process EventDispatcher                  │
  │  → Registered Handler Functions                │
  │  (all within same application process)         │
  └────────────────────────────────────────────────┘
  
  Pros: Zero infrastructure overhead, simple debugging
  Cons: Cannot scale emitter and consumer independently
  When to graduate: When any consumer needs independent scaling

PHASE 2 (12–24 months): EXTERNAL MESSAGE BROKER
  ┌────────────────────────────────────────────────┐
  │  Domain → Outbox Table → Outbox Relay          │
  │  → Kafka Topics (or RabbitMQ Exchanges)        │
  │  → Consumer Groups (still in monolith)         │
  └────────────────────────────────────────────────┘
  
  Topic naming: {tenant-segregated or shared}
  Partitioning: by tenant_id for isolation
  Retention: 7 days for operational; 30 days for audit topics
  
  Pros: Independent consumer scaling, replay capability, broker monitoring
  Cons: Operational complexity, network latency

PHASE 3 (24+ months): SERVICE-EXTRACTED CONSUMERS
  ┌────────────────────────────────────────────────┐
  │  Kafka Topics → Independently deployed         │
  │                 consumer services              │
  │  (Analytics, AI — highest volume consumers     │
  │   extracted first)                             │
  └────────────────────────────────────────────────┘

Kafka Topic Convention:
  {platform}.{domain}.{event_type}
  Examples:
    workforce.attendance.daily-processed
    workforce.payroll.run-disbursed
    workforce.leave.application-approved
    workforce.employee.created
```




---


# SECTION 8: ANALYTICS DOMAIN STRATEGY

---

## 8.0 The Central Architectural Decision: OLTP ≠ Analytics

The most consequential architectural decision in the analytics domain is the absolute separation of **OLTP (operational) data** from **analytics data**.

In most existing HRMS systems, analytics and reporting queries run directly against the operational database. This creates a category of problems that grow worse over time:

| Problem | Consequence |
|---|---|
| Long-running analytical queries lock or slow operational tables | Payroll runs slow when HR is pulling reports; attendance processing degrades during dashboard access |
| Analytics schema is tightly coupled to operational schema | Every operational schema change requires simultaneous analytics query updates |
| No historical snapshots | Point-in-time analysis requires expensive historical reconstruction |
| No pre-aggregation | Every dashboard load recomputes from raw data — expensive and slow |
| No data lineage | Impossible to determine why a KPI value changed |
| No real-time capability | Analytics are always point-in-time, never streaming |

The analytics domain completely eliminates these problems by owning its own data store, populated exclusively from domain events, with no dependency on operational schemas.

---

## 8.1 Analytics Architecture Model

```
ANALYTICS ARCHITECTURE — THREE LAYER MODEL

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: EVENT INGESTION LAYER                                      │
│                                                                       │
│  Domain Events → Event Consumer → Raw Event Store                    │
│  (all operational domain events consumed and stored in raw form)     │
│  Storage: Append-only event log per domain namespace                 │
│  Latency: <1 second from event emission to raw store                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2: PROJECTION COMPUTATION LAYER                               │
│                                                                       │
│  Event Processors → Dimensional Projections → KPI Aggregations       │
│                                                                       │
│  Projection types:                                                    │
│  • Employee Dimension (snapshot from employee.* events)              │
│  • Daily Attendance Fact (from attendance.daily.processed)           │
│  • Monthly Leave Fact (from leave.balance.updated)                   │
│  • Payroll Period Fact (from payroll.run.disbursed)                  │
│  • Headcount Snapshot (from employee status events)                  │
│                                                                       │
│  Processing modes:                                                    │
│  • Near-real-time: Streaming processor (sub-minute latency)          │
│  • Hourly batch: Pre-aggregated KPI summaries                        │
│  • Daily batch: Heavy cross-domain analytics, trend series           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3: QUERY & SERVING LAYER                                      │
│                                                                       │
│  Dashboard APIs → Widget Queries → Projection Tables                  │
│  Report Generator → Template Rendering → Scheduled Delivery          │
│  AI Feature Store → ML Training Data → Analytics Exports             │
│                                                                       │
│  Performance target:                                                  │
│  • Dashboard widget queries: <500ms P95                              │
│  • KPI cards: <100ms (served from pre-aggregated cache)              │
│  • Custom report generation: <30 seconds for 12-month range          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8.2 Dimensional Data Model

The analytics domain implements a **star schema dimensional model** for workforce data — proven in enterprise data warehousing to support efficient analytical queries across arbitrary dimension combinations.

### Core Dimensions

**`dim_employee`** — Slowly Changing Dimension (Type 2)
```sql
CREATE TABLE analytics.dim_employee (
  surrogate_key    BIGSERIAL    PRIMARY KEY,
  employee_id      UUID         NOT NULL,   -- operational system key
  tenant_id        UUID         NOT NULL,
  employee_number  VARCHAR(20)  NOT NULL,
  full_name        VARCHAR(200) NOT NULL,
  employment_type  VARCHAR(30)  NOT NULL,
  grade_code       VARCHAR(20),
  band             VARCHAR(20),
  unit_id          UUID         NOT NULL,
  unit_name        VARCHAR(200) NOT NULL,
  unit_path        VARCHAR(500),            -- materialized hierarchy path
  location_id      UUID         NOT NULL,
  location_name    VARCHAR(200),
  entity_id        UUID         NOT NULL,
  entity_name      VARCHAR(200),
  cost_center_id   UUID,
  cost_center_code VARCHAR(20),
  manager_id       UUID,
  employment_status VARCHAR(30) NOT NULL,
  joining_date     DATE         NOT NULL,
  exit_date        DATE,
  -- SCD Type 2 fields
  valid_from       DATE         NOT NULL,
  valid_to         DATE,                    -- NULL = current record
  is_current       BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Source traceability
  source_event_id  UUID         NOT NULL,
  loaded_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- Optimized for current + point-in-time queries
CREATE INDEX idx_dim_employee_current ON analytics.dim_employee (employee_id, tenant_id) WHERE is_current = TRUE;
CREATE INDEX idx_dim_employee_pit ON analytics.dim_employee (employee_id, valid_from, valid_to);
```

**`dim_date`** — Standard date dimension pre-populated for 10 years
```sql
CREATE TABLE analytics.dim_date (
  date_key        INTEGER      PRIMARY KEY,  -- YYYYMMDD integer key
  date_value      DATE         NOT NULL,
  year            INTEGER,
  quarter         INTEGER,
  month           INTEGER,
  month_name      VARCHAR(20),
  week_of_year    INTEGER,
  day_of_week     INTEGER,
  day_name        VARCHAR(20),
  is_weekend      BOOLEAN,
  is_month_end    BOOLEAN,
  fiscal_year     INTEGER,
  fiscal_quarter  INTEGER
);
```

**`dim_organization`** — Hierarchy dimension with materialized paths for efficient filtering
```sql
CREATE TABLE analytics.dim_organization (
  unit_key      BIGSERIAL    PRIMARY KEY,
  unit_id       UUID         NOT NULL,
  tenant_id     UUID         NOT NULL,
  unit_name     VARCHAR(200) NOT NULL,
  unit_type     VARCHAR(50),
  parent_unit_id UUID,
  unit_path     VARCHAR(1000),  -- /ROOT/DIVISION/DEPT/TEAM
  depth         INTEGER,
  entity_id     UUID,
  entity_name   VARCHAR(200),
  is_current    BOOLEAN      NOT NULL DEFAULT TRUE,
  valid_from    DATE         NOT NULL,
  valid_to      DATE
);
```

**`dim_leave_type`** — Static dimension updated from policy events
```sql
CREATE TABLE analytics.dim_leave_type (
  leave_type_key  BIGSERIAL   PRIMARY KEY,
  leave_type_id   UUID        NOT NULL,
  tenant_id       UUID        NOT NULL,
  type_code       VARCHAR(30) NOT NULL,
  type_name       VARCHAR(100),
  is_statutory    BOOLEAN,
  entitlement_basis VARCHAR(30),
  is_current      BOOLEAN     NOT NULL DEFAULT TRUE
);
```

---

### Core Fact Tables

**`fact_daily_attendance`** — One row per employee per working day
```sql
CREATE TABLE analytics.fact_daily_attendance (
  fact_id              BIGSERIAL    PRIMARY KEY,
  date_key             INTEGER      NOT NULL REFERENCES analytics.dim_date(date_key),
  employee_key         BIGINT       NOT NULL REFERENCES analytics.dim_employee(surrogate_key),
  tenant_id            UUID         NOT NULL,
  -- Measures
  attendance_status    VARCHAR(30)  NOT NULL,  -- present | absent | leave | holiday | weekend
  is_present           BOOLEAN      NOT NULL,
  is_late              BOOLEAN      NOT NULL DEFAULT FALSE,
  is_early_departure   BOOLEAN      NOT NULL DEFAULT FALSE,
  effective_hours      DECIMAL(6,2) NOT NULL DEFAULT 0,
  overtime_hours       DECIMAL(6,2) NOT NULL DEFAULT 0,
  late_minutes         INTEGER      NOT NULL DEFAULT 0,
  early_departure_mins INTEGER      NOT NULL DEFAULT 0,
  is_leave_justified   BOOLEAN      NOT NULL DEFAULT FALSE,
  leave_type_key       BIGINT       REFERENCES analytics.dim_leave_type(leave_type_key),
  -- Source traceability
  source_event_id      UUID         NOT NULL,  -- attendance.daily.processed event_id
  loaded_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (date_key);  -- Monthly partitions for query performance
```

**`fact_payroll_period`** — One row per employee per payroll period
```sql
CREATE TABLE analytics.fact_payroll_period (
  fact_id              BIGSERIAL    PRIMARY KEY,
  payroll_period_key   INTEGER      NOT NULL,   -- YYYYMM integer
  employee_key         BIGINT       NOT NULL REFERENCES analytics.dim_employee(surrogate_key),
  tenant_id            UUID         NOT NULL,
  run_id               UUID         NOT NULL,
  -- Measures
  gross_pay            DECIMAL(19,4) NOT NULL DEFAULT 0,
  net_pay              DECIMAL(19,4) NOT NULL DEFAULT 0,
  total_deductions     DECIMAL(19,4) NOT NULL DEFAULT 0,
  basic_pay            DECIMAL(19,4),
  ota_amount           DECIMAL(19,4),           -- overtime earnings
  statutory_deductions DECIMAL(19,4),
  voluntary_deductions DECIMAL(19,4),
  lop_days             DECIMAL(6,2),
  lop_deduction_amount DECIMAL(19,4),
  currency             CHAR(3)      NOT NULL,
  -- Source traceability
  source_event_id      UUID         NOT NULL,
  loaded_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**`fact_leave_transaction`** — One row per leave balance movement
```sql
CREATE TABLE analytics.fact_leave_transaction (
  fact_id              BIGSERIAL    PRIMARY KEY,
  date_key             INTEGER      NOT NULL,
  employee_key         BIGINT       NOT NULL,
  leave_type_key       BIGINT       NOT NULL,
  tenant_id            UUID         NOT NULL,
  -- Measures
  transaction_type     VARCHAR(40)  NOT NULL,  -- accrual | availed | carry_forward | lapsed | encashed
  quantity             DECIMAL(8,2) NOT NULL,
  closing_balance      DECIMAL(8,2),
  application_id       UUID,
  source_event_id      UUID         NOT NULL,
  loaded_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**`fact_headcount_snapshot`** — Daily snapshot of workforce composition
```sql
CREATE TABLE analytics.fact_headcount_snapshot (
  snapshot_date_key    INTEGER      NOT NULL,
  tenant_id            UUID         NOT NULL,
  unit_key             BIGINT       NOT NULL,
  employment_type      VARCHAR(30)  NOT NULL,
  grade_code           VARCHAR(20),
  -- Measures
  headcount            INTEGER      NOT NULL DEFAULT 0,
  new_joiners          INTEGER      NOT NULL DEFAULT 0,
  exits                INTEGER      NOT NULL DEFAULT 0,
  transfers_in         INTEGER      NOT NULL DEFAULT 0,
  transfers_out        INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_date_key, tenant_id, unit_key, employment_type, grade_code)
);
```

---

## 8.3 Real-Time Analytics Architecture

### Real-Time Metrics (sub-60-second latency)
Powered by **Supabase Realtime** subscriptions on projection tables:

```
Event emitted → Projection table updated → Supabase Realtime → Dashboard widget updated

Real-time metrics available:
• Current live attendance count (employees punched-in right now)
• Today's absenteeism rate (updated as each daily record is processed)
• Active overtime count (employees currently on OT clock)
• Pending approval count (per manager — from Workflow domain events)
• Today's leave count (employees on approved leave today)
```

Implementation pattern:
```sql
-- Real-time summary table (updated on every attendance.daily.processed event)
CREATE TABLE analytics.rt_attendance_summary (
  tenant_id         UUID     NOT NULL,
  summary_date      DATE     NOT NULL,
  unit_id           UUID     NOT NULL,
  present_count     INTEGER  NOT NULL DEFAULT 0,
  absent_count      INTEGER  NOT NULL DEFAULT 0,
  late_count        INTEGER  NOT NULL DEFAULT 0,
  on_leave_count    INTEGER  NOT NULL DEFAULT 0,
  on_ot_count       INTEGER  NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, summary_date, unit_id)
);
-- Supabase Realtime subscription on this table → pushes to dashboard
```

### Hourly Pre-Aggregated KPIs
```
Hourly batch job runs → Reads from fact tables → Writes to kpi_cache table

Cached KPIs (updated hourly):
• Absenteeism rate (30/60/90 day rolling average per department)
• Overtime rate (week-to-date per department)
• Leave utilization rate (policy year to date)
• Attrition rate (rolling 12 months)
• Time-to-hire (from Recruitment domain events — if available)
```

---

## 8.4 Dashboard Ownership Model

Dashboards are owned by **operational domain teams** who define what to display — but served by the **Analytics domain** which owns the data and the query layer. This prevents dashboard proliferation that results in conflicting KPI definitions.

```
DASHBOARD OWNERSHIP

┌────────────────────────────────────────────────────────────┐
│  STRATEGIC DASHBOARDS (CHRO / CFO / CEO level)             │
│  Owner: Analytics team                                      │
│  Content: Workforce health, cost, attrition, compliance     │
│  Refresh: Daily                                             │
├────────────────────────────────────────────────────────────┤
│  OPERATIONAL DASHBOARDS (HR Managers, Operations)           │
│  Owner: HR Operations team (template defined)              │
│  Content: Attendance, leave, roster, payroll status         │
│  Refresh: Real-time (attendance) / Hourly (leave/payroll)   │
├────────────────────────────────────────────────────────────┤
│  MANAGER DASHBOARDS (Line managers — team view)             │
│  Owner: Platform product team                               │
│  Content: My team attendance, leave calendar, approvals     │
│  Refresh: Real-time (attendance) / On-demand (leave)        │
├────────────────────────────────────────────────────────────┤
│  EMPLOYEE SELF-SERVICE (Individual employee view)           │
│  Owner: Platform product team                               │
│  Content: My attendance, leave balance, payslips            │
│  Refresh: On-demand                                         │
└────────────────────────────────────────────────────────────┘
```

### KPI Governance
Every KPI exposed in the analytics domain must have a **KPI Definition Record** (maintained as documented metadata):

| KPI | Formula | Data Source | Refresh | Owner |
|---|---|---|---|---|
| Absenteeism Rate | (Absent days / Working days) × 100 | fact_daily_attendance | Hourly | HR Ops |
| OT Rate | OT hours / Regular hours × 100 | fact_daily_attendance | Hourly | Operations |
| Headcount | COUNT(active employees) | fact_headcount_snapshot | Daily | HR Ops |
| Attrition Rate | (Exits in period / Avg headcount) × 100 | fact_headcount_snapshot | Monthly | People Analytics |
| Payroll Cost per FTE | Total payroll cost / Headcount | fact_payroll_period | Monthly | Finance |
| Leave Utilization | Availed days / Entitled days × 100 | fact_leave_transaction | Monthly | HR Ops |

Conflicts in KPI definitions (e.g., two teams using different attrition formulas) are resolved by the Platform Analytics team. Once defined, the canonical formula is implemented in the Analytics domain and all dashboards use the same computation — no divergence.

---

## 8.5 Analytics → AI Intelligence Handoff

The Analytics domain is the **primary data source for all AI feature engineering**. The boundary between Analytics and AI Intelligence is:

- **Analytics owns:** Historical projection data, aggregated KPIs, dimensional models
- **AI Intelligence owns:** Feature engineering, model training pipelines, inference execution

```
DATA HANDOFF BOUNDARY

Analytics Domain                  AI Intelligence Domain
  ┌──────────────────┐              ┌──────────────────────┐
  │ Analytics Export │              │ Feature Engineering  │
  │ API              │──────────────│ Pipeline             │
  │                  │              │                      │
  │ GET /analytics/  │  Scheduled   │ Pulls structured     │
  │ exports/         │  data pull   │ analytical data      │
  │ {dataset}        │  (daily or   │ Transforms into      │
  │                  │  on-demand)  │ ML features          │
  └──────────────────┘              └──────────────────────┘
```

### Available Export Datasets
| Dataset | Content | Consumed By |
|---|---|---|
| `employee_tenure_features` | Tenure, grade, transfer count, title changes | Attrition prediction |
| `attendance_pattern_features` | 90-day rolling attendance behavior per employee | Absence prediction, anomaly detection |
| `leave_utilization_features` | Leave utilization, type distribution, timing patterns | Burnout prediction, attrition |
| `payroll_history_features` | Period-over-period payroll variance per employee | Anomaly detection |
| `headcount_trend_series` | Monthly headcount by unit, grade, type | Workforce planning forecasts |
| `performance_correlation` | Performance ratings linked to operational signals | Attrition and promotion prediction |

Export datasets are **read-only snapshots** — AI domain may not write back to Analytics projections. AI predictions are stored in the AI domain's own store and published back to operational domains via events.

---

## 8.6 Analytics Data Retention and Governance

### Retention Tiers
```
RETENTION POLICY BY DATA TYPE

Tier 1 — Real-time summaries (rt_* tables)
  Retention: 7 days rolling window
  Reason: Operational; replaced by fact table records

Tier 2 — Transactional fact tables (fact_daily_attendance, fact_payroll_period)
  Retention: 7 years (statutory requirement — employment records)
  Archival: After 2 years, older partitions moved to cold storage (S3 Parquet)
  
Tier 3 — KPI aggregates and pre-computed summaries
  Retention: 5 years (business analytics horizon)
  
Tier 4 — Dimension history (SCD Type 2 records)
  Retention: Indefinite (historical analysis requires full history)

Tier 5 — Raw event log
  Retention: 2 years hot, then archived to cold storage
  Purpose: Reprocessing, audit, projection rebuild
```

### Analytics Data Quality
The analytics domain monitors its own data quality:
- **Completeness:** Are all expected daily attendance facts populated for all active employees? Alerts if gaps detected.
- **Freshness:** Are projections within their expected latency SLA? Alert if fact tables are more than 2 hours stale.
- **Consistency:** Do headcount snapshots match Employee domain's active employee count? Alert on discrepancy > 0.5%.




---


# SECTION 9: AI DOMAIN STRATEGY

---

## 9.0 AI-Native Architecture Philosophy

"AI-native" is a frequently misused term. In most platforms, it means "we added an LLM chatbot." In this architecture, AI-native means something more precise and more demanding:

**AI systems are first-class architectural citizens that integrate with every operational domain through well-defined contracts — not bolted-on features that scrape data from whatever is available.**

This has concrete architectural implications:
1. **Every operational domain is designed to emit AI-consumable signals.** Domain events carry the data quality and structure needed for ML feature engineering — not because ML engineers demanded it, but because the domain architecture mandated it.
2. **AI recommendations flow through typed contracts.** AI does not directly mutate operational data. It publishes typed recommendations that operational domains choose to act on through their own automation rules.
3. **AI respects permission boundaries.** A copilot responds to questions using only data the requesting user is authorized to see. AI never bypasses ABAC.
4. **AI model governance is a domain concern.** Models are versioned, monitored, and governed with the same rigor applied to domain aggregates and event schemas.

---

## 9.1 AI Orchestration Architecture

```
AI INTELLIGENCE DOMAIN — INTERNAL ARCHITECTURE

┌──────────────────────────────────────────────────────────────────┐
│                    AI INTELLIGENCE DOMAIN                         │
│                                                                    │
│  ┌─────────────────┐    ┌──────────────────┐                     │
│  │  MODEL REGISTRY  │    │  FEATURE STORE   │                    │
│  │                 │    │                  │                     │
│  │  • Model catalog│    │  • Employee      │                     │
│  │  • Version mgmt │    │    features      │                     │
│  │  • A/B configs  │    │  • Attendance    │                     │
│  │  • Endpoints    │◄───│    patterns      │                     │
│  │  • Perf metrics │    │  • Payroll       │                     │
│  └────────┬────────┘    │    history       │                     │
│           │             │  • Leave signals │                     │
│           │             └──────────────────┘                     │
│           │                    ▲                                  │
│           │             Analytics Domain Exports                  │
│           │                                                       │
│  ┌────────▼────────────────────────────────────────────┐        │
│  │          PREDICTION ORCHESTRATION ENGINE              │        │
│  │                                                       │        │
│  │  • Job Scheduler (cron + event-triggered)            │        │
│  │  • Feature assembly per employee                     │        │
│  │  • Model inference execution                         │        │
│  │  • Result storage and publication                    │        │
│  └────────┬──────────────────────────────────────────┬─┘        │
│           │                                           │           │
│  ┌────────▼────────┐                        ┌────────▼────────┐  │
│  │  VECTOR MEMORY  │                        │  RECOMMENDATION │  │
│  │  STORE          │                        │  PUBLISHER      │  │
│  │                 │                        │                 │  │
│  │  • Embeddings   │                        │  • Types        │  │
│  │    per entity   │                        │  • Confidence   │  │
│  │  • Semantic     │                        │  • Routing      │  │
│  │    search       │                        │  • Events       │  │
│  │  • Copilot      │                        └─────────────────┘  │
│  │    context      │                                              │
│  └────────┬────────┘                                              │
│           │                                                       │
│  ┌────────▼────────────────────────────────────────────┐        │
│  │           COPILOT ENGINE                             │        │
│  │                                                      │        │
│  │  • Session management                               │        │
│  │  • Context assembly (user permissions + workspace)  │        │
│  │  • Intent classification                            │        │
│  │  • Tool routing (analytics query / prediction /     │        │
│  │    operational lookup)                              │        │
│  │  • Response generation (LLM with grounded context)  │        │
│  │  • Memory persistence                               │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9.2 Prediction Systems

### 9.2.1 Attrition Risk Prediction

**Business Problem:** Identify employees likely to resign within the next 30/60/90 days, giving HR time to intervene.

**Model Type:** Binary classification (high/low risk) + risk score (0–1 probability)

**Feature Engineering:**
```
Feature Category         Features
─────────────────────────────────────────────────────────────────
Tenure & Stability       • Days since joining
                         • Number of employer changes (pre-joining, from profile)
                         • Months in current role (since last promotion/transfer)
                         • Number of transfers in last 24 months

Compensation Signals     • Compensation percentile within grade band
                         • Months since last salary revision
                         • Total compensation vs. market benchmark (if data available)
                         • Increment percentage at last review

Attendance Patterns      • 90-day attendance rate
                         • Late arrival frequency (30-day rolling)
                         • Unplanned leave frequency (sick leave in last 90 days)
                         • Leave application patterns (Monday/Friday concentration)

Performance Signals      • Last performance rating
                         • Rating trend (improving, stable, declining)
                         • Goal completion rate

Engagement Proxies       • Manager change frequency
                         • Leave utilization rate (low utilization = burnout risk)
                         • OT hours (excessive OT = burnout; zero OT for OT-prone roles = disengagement)
                         • Survey participation (if available)

Organizational Context   • Department attrition rate (contagion effect)
                         • Manager attrition (losing a manager increases team risk)
                         • Headcount growth rate in team (expanding = stability; shrinking = risk)
```

**Prediction Outputs:**
```
AttritionPrediction {
  employee_id:      UUID
  risk_score:       Decimal(4,3)      // 0.000 to 1.000
  risk_tier:        low|medium|high|critical
  risk_horizon:     30|60|90          // days
  top_risk_factors: [RiskFactor]      // top 3 contributing features with weight
  confidence:       Decimal(4,3)      // model confidence in prediction
  predicted_at:     Timestamp
  model_version:    String
}
```

**Publication:** `ai.attrition_risk.flagged` event for risk_tier = high | critical (only — not all employees)

**HR Interaction Contract:**
- Risk scores visible to: HR Business Partner, CHRO, direct manager (at HR's discretion)
- Risk scores NOT visible to: The employee themselves (prevents gaming)
- Required disclaimer: Displayed alongside risk scores: "AI prediction — use as one signal among many, not as a decision basis alone"

---

### 9.2.2 Absence Prediction

**Business Problem:** Predict which employees are likely to be absent tomorrow, enabling proactive rostering adjustments.

**Model Type:** Binary classification per employee per upcoming date

**Feature Engineering:**
```
• Historical absence on same day of week (Friday effect, Monday effect)
• Absence after public holiday proximity
• Weather signals (if location data available — for field workforce)
• Recent illness history (consecutive sick days in last 2 weeks)
• Scheduled leave tomorrow (deterministic — from Leave domain)
• OT hours this week (fatigue proxy)
• Team-level absence rate today (contagion proxy)
```

**Prediction Window:** Daily batch run at 6pm for next-day predictions

**Publication:** `ai.absence_prediction.generated` — consumed by Roster domain to flag potential coverage gaps

**Operational Integration:**
```
Roster Planning Workspace:
  "3 employees in Night Shift B are predicted as 80%+ absence risk for tomorrow.
   Current coverage: 8/11 required.
   Suggested: Request standby from Shift A (2 available) or approve pending
   shift swap request from [Employee X]."
```

---

### 9.2.3 Payroll Anomaly Detection

**Business Problem:** Detect statistically unusual payroll computations before disbursement, catching errors and potential fraud.

**Model Type:** Statistical anomaly detection (Z-score + isolation forest combination)

**Detection Rules (combined ML + rule-based):**

```
RULE-BASED CHECKS (deterministic — must always run):
  □ Net pay > 3× last period net pay (sudden spike)
  □ Net pay < 0.5× last period net pay (sudden drop — excluding FNF runs)
  □ Statutory deduction = 0 for employee with non-zero gross (missed deduction)
  □ OT hours > [policy max hours per period] × 1.5 (OT threshold breach)
  □ Bank account changed in last 7 days (fraud risk)
  □ Duplicate net pay amount for two employees in same run (data error)

ML-BASED CHECKS (probabilistic — flag for human review):
  □ Gross pay Z-score > 2.5 vs. same employee's 6-month average
  □ Gross pay Z-score > 2.0 vs. peer group (same grade, unit) for this period
  □ LOP days anomalous relative to prior attendance patterns
  □ Unusual combination of components (unexpected allowances appearing)
```

**Integration with Payroll Run:**
```
PayrollRun.status = computed
  → AI Anomaly Scanner triggered (async)
  → Scans all EmployeePayslips
  → Flags anomalies with severity: warning | critical
  → Publishes: ai.payroll_anomaly.flagged per anomalous payslip

Payroll Domain (consumes):
  → Adds AnomalyFlag to EmployeePayslip
  → Blocks auto-approval if critical anomalies exist (requires manual resolution)
  → Displays anomaly queue in Payroll Review workspace
```

---

### 9.2.4 Workforce Planning Intelligence

**Business Problem:** Predict headcount requirements per department/location for future planning horizons.

**Model Type:** Time-series forecasting (Prophet / LSTM) per org unit

**Inputs:**
- Historical headcount time series per org unit (12+ months)
- Historical attrition rates per grade and unit
- Planned headcount changes (from HR plan, if available)
- Seasonal patterns (industry-specific hiring cycles)

**Outputs:**
- Expected headcount 3/6/12 months forward
- Predicted attrition count per unit per quarter
- Recommended hiring pipeline targets

**Publication:** Workforce planning dashboard dataset in Analytics domain

---

## 9.3 AI Copilot Design

The AI copilot provides **contextual natural language interaction** with workforce data and operational functions. It is not a generic chatbot — it is a workspace-aware, permission-scoped, grounded intelligence layer.

### Copilot Architecture

```
USER MESSAGE → Copilot Engine

Step 1: Context Assembly
  • Who is the user? (IAM identity)
  • What can they see? (Permission snapshot from IAM)
  • Where are they in the app? (Workspace context: attendance / payroll / roster)
  • What is the conversation history? (Last N turns)
  • What entity are they viewing? (employee_id, unit_id, etc.)

Step 2: Intent Classification
  • DATA_QUERY: "Show me attendance for my team this week"
  • OPERATIONAL_ACTION: "Approve leave request for John"
  • EXPLANATION_REQUEST: "Why is this employee's payslip lower than last month?"
  • PREDICTION_REQUEST: "Who is at risk of leaving in my team?"
  • PROCESS_GUIDANCE: "How do I process an off-cycle payroll run?"

Step 3: Tool Routing (based on intent)
  • DATA_QUERY → Analytics domain query API (scoped to user permissions)
  • OPERATIONAL_ACTION → Domain command API (with explicit user confirmation)
  • EXPLANATION_REQUEST → Audit log + computation trace query
  • PREDICTION_REQUEST → AI Intelligence prediction store query
  • PROCESS_GUIDANCE → Knowledge base retrieval

Step 4: Context-Grounded Response Generation
  • Fetch data from appropriate tool
  • Assemble grounding context
  • Generate response using LLM with grounding data
  • Validate: response contains only data user is authorized to see
  • Format for workspace display (tables, charts, action cards)

Step 5: Memory Persistence
  • Store key facts from this turn in vector memory (for future sessions)
  • Update session state
```

### Copilot Interaction Examples

**Example 1 — Manager Attendance Query:**
```
User (Manager): "Who in my team was late more than 3 times this month?"

Copilot:
  1. Resolves user's direct report list from Organization domain (scoped to their team)
  2. Queries analytics.fact_daily_attendance for this month, their team, late=true
  3. Groups by employee, filters count > 3
  4. Response: "4 employees in your team have been late more than 3 times this month:
     • Sarah M. — 5 instances (avg 12 min late)
     • Raj K. — 4 instances (avg 8 min late)
     • ...
     Would you like to send a reminder or initiate an attendance review?"
```

**Example 2 — HR BP Attrition Risk Query:**
```
User (HR Business Partner): "Which employees in the Sales team are at high attrition risk?"

Copilot:
  1. Validates: HR BP has permission to view attrition risk for Sales team
  2. Queries AI prediction store for high-risk employees in Sales unit
  3. Fetches top risk factors per employee
  4. Response: "3 employees in Sales are flagged as high attrition risk:
     • [Employee A] — Risk: 84% | Factors: below-market comp, 14 months no increment, high OT
     • [Employee B] — Risk: 79% | Factors: manager change (3rd in 18 months), below peers rating
     • [Employee C] — Risk: 71% | Factors: high sick leave frequency, consecutive Mondays absent
     
     Note: These are AI predictions — treat as decision-support signals, not conclusions."
```

**Example 3 — Payroll Explanation:**
```
User (Employee): "Why is my salary lower this month?"

Copilot:
  1. Validates: User is querying their own payslip (self-service permission)
  2. Fetches current and previous EmployeePayslip
  3. Computes component-level delta
  4. Fetches audit trail for any corrections
  5. Response: "Your net pay this month is ₹52,340, which is ₹4,200 lower than last month.
     The difference is due to:
     • 2 LOP (Loss of Pay) days: ₹3,100 deducted (you had 2 unapproved absent days on May 3 & 7)
     • Professional Tax: ₹1,100 (quarterly deduction, not applied in April)
     
     If you believe the LOP is incorrect, you can submit a regularization request.
     [Submit Regularization] ← action button"
```

---

## 9.4 Vector Memory Ownership

The AI domain manages a **vector memory store** for semantic retrieval — enabling the copilot to answer contextual questions that require matching meaning rather than exact keyword lookup.

### What is Embedded
```
Entity Type          Embedding Content                          Purpose
─────────────────────────────────────────────────────────────────────────────
Employee Record      Name + role + unit + key attributes         Entity lookup
Policy Document      Full policy rule set text + metadata        Policy Q&A
Attendance Pattern   Monthly attendance summary per employee     Pattern search
Payslip Summary      Period payslip narrative summary            "Why different" queries
Leave History        Leave application reasons + patterns        Absence pattern Q&A
Process Documents    HR policy docs, process guides              Copilot guidance
```

### Vector Memory Architecture
```
Embedding Pipeline:
  Domain Event → Content Extractor → Embedding Model → Vector Store

Vector Store: pgvector extension on Postgres (Phase 1)
              → Dedicated Qdrant / Weaviate (Phase 2 if volume warrants)

Embedding Model: text-embedding-3-large (OpenAI) or equivalent open model
Embedding Dimensions: 1536 (OpenAI) or 768 (open models)

Search Pattern:
  User Query → Embed query → Cosine similarity search → Top-K results
  → Feed to LLM as grounding context → Generate response
```

### Memory Scoping and Security
- Every vector record carries `tenant_id` and `accessible_to_roles[]` metadata
- Vector similarity search always filters by `tenant_id` — no cross-tenant retrieval possible
- LLM context assembly further filters grounding documents by user's permission scope
- Employee-specific vectors (payslip summaries, attrition risk) are scoped to HR roles — not accessible in employee-facing copilot contexts

---

## 9.5 AI Model Governance

### Model Registry
Every deployed model is registered with:
```
ModelRegistryEntry {
  model_id:          UUID
  model_code:        String          -- stable identifier (e.g., "ATTRITION_RISK_V2")
  use_case:          UseCase
  version:           String          -- semantic version
  training_data:     DatasetRef      -- what data trained this model
  training_date:     Date
  validation_metrics: {
    accuracy, precision, recall, f1, auc_roc   // classification
    rmse, mae, mape                              // regression
    coverage, precision_at_k                    // recommendation
  }
  bias_assessment:   BiasReport      -- fairness metrics across demographic groups
  deployment_stage:  shadow|canary|production|deprecated
  inference_endpoint: String
  owner_team:        String
  approved_by:       String
  activated_at:      Timestamp
}
```

### Model Deployment Stages
```
Training → Validation → Shadow → Canary → Production

Shadow:     Model runs alongside production, outputs logged but not used
            Purpose: Validate predictions quality before any business impact
            Duration: Minimum 2 weeks

Canary:     Model serves 10% of requests; production serves 90%
            Purpose: Detect performance degradation under real load
            Duration: Minimum 1 week if metrics stable

Production: Model serves all requests
            Monitoring: Accuracy tracking on labeled outcome data
```

### Model Drift Detection
```
Monthly monitoring job:
  1. Fetch prediction labels from 30 days ago (employees flagged as high attrition risk)
  2. Check actual outcomes (did they resign? from employee.exited events)
  3. Compute actual precision and recall vs. model's claimed metrics
  4. If actual accuracy falls below threshold: emit ai.model.drift_detected
  5. Trigger: model retraining pipeline initiation

Drift thresholds:
  Attrition Risk model: alert if precision < 0.55 or recall < 0.50
  Absence Prediction:   alert if accuracy < 0.70
  Payroll Anomaly:      alert if false_positive_rate > 0.15
```

---

## 9.6 AI Integration with Each Operational Domain

| Domain | AI Input (what AI consumes) | AI Output (what AI publishes) | Operational Impact |
|---|---|---|---|
| **Attendance** | `attendance.daily.processed` events; attendance pattern features | Absence prediction; anomaly detection | Roster adjustments; manager alerts |
| **Leave** | `leave.balance.updated` events; leave pattern features | Burnout risk signals; leave denial fairness check | HR wellbeing intervention; manager advisories |
| **Payroll** | `payroll.run.computed` events; payslip data | Anomaly flags pre-disbursement | Block suspicious payslips for human review |
| **Roster** | `roster.published` events; absence predictions | Coverage gap predictions; optimal roster suggestions | Proactive staffing adjustments |
| **Employee** | `employee.*` lifecycle events; tenure/grade features | Attrition risk scores; career path recommendations | HR retention interventions; L&D recommendations |
| **Analytics** | Aggregated datasets via export APIs | Training data pipeline; predictions stored back | Enriches dashboards with predictive intelligence |
| **Workflow** | `workflow.sla.breached` events | Approval SLA risk prediction; suggested escalation | Proactive escalation before SLA breach |
| **Compliance** | `compliance.violation.detected` events | Pattern analysis; future violation risk prediction | Preventive compliance alerts |




---


# SECTION 10: FUTURE SCALABILITY STRATEGY

---

## 10.0 Scalability Philosophy

The modular monolith architecture is designed with **explicit extraction boundaries** — seams that are ready to become service boundaries when operational scale, team ownership, or business criticality justifies the operational overhead of service decomposition.

The governing question for every extraction decision is:
> *"Does this domain's scaling requirement differ enough from the rest of the system that co-deployment is creating a measurable constraint?"*

If the answer is yes — the domain should be extracted. If the answer is no — it stays in the monolith, enjoying the simplicity of shared deployment, shared transactions, and simplified debugging.

Scale thresholds that typically trigger extraction:
- **Write throughput:** A domain processes >10,000 writes/minute that saturate shared application resources
- **Compute intensity:** A domain's batch jobs (payroll computation, AI inference) consume >30% of shared CPU capacity
- **Independent deployment need:** A domain needs multiple daily deploys while the rest of the system deploys weekly
- **Team autonomy:** A team of 5+ engineers fully owns a domain and is blocked by shared deployment cycles

---

## 10.1 Domain Scaling Classification

```
SCALING PROFILE MATRIX

                    Write     Read      Compute   Event      Extraction
Domain              Volume    Volume    Intensity  Volume     Priority
─────────────────────────────────────────────────────────────────────────
Attendance          ████████  ████████  ████░░░░  ████████   HIGHEST
Payroll             ████░░░░  ███░░░░░  ████████  ████░░░░   HIGH
Analytics           ░░░░░░░░  ████████  ████████  ░░░░░░░░   HIGH
AI Intelligence     ░░░░░░░░  ████░░░░  ████████  ████░░░░   HIGH
Leave Management    ████░░░░  ████░░░░  ██░░░░░░  ████░░░░   MEDIUM
Notifications       ██░░░░░░  ██░░░░░░  ░░░░░░░░  ████████   MEDIUM
Workflow            ████░░░░  ████░░░░  ██░░░░░░  ████░░░░   MEDIUM
Employee            ██░░░░░░  ████████  ░░░░░░░░  ████░░░░   LOW
Organization        ░░░░░░░░  ████████  ░░░░░░░░  ██░░░░░░   LOW
IAM                 ██░░░░░░  ████████  ░░░░░░░░  ████░░░░   LOW
Policy Engine       ░░░░░░░░  ████████  ░░░░░░░░  ██░░░░░░   LOW
Payroll (Disburse)  ░░░░░░░░  ████░░░░  ████████  ██░░░░░░   MEDIUM
Compliance          ░░░░░░░░  ████░░░░  ████░░░░  ██░░░░░░   LOW
Documents           ██░░░░░░  ████████  ██░░░░░░  ████░░░░   LOW

Scale: ░ = low, █ = high (4 bars = highest)
```

---

## 10.2 Extraction Priority and Triggers

### Priority 1: Attendance Domain

**Why first:**
The Attendance domain has the highest sustained write volume of any domain in the platform. A deployment with 10,000 employees across 3 shifts generates approximately 60,000–80,000 raw punch events per day (in + out + breaks), with spikes at shift start/end times. At 50,000 employees, this becomes 300,000–400,000 events per day — approximately 200–400 writes per second at peak.

This write pressure, combined with the real-time processing SLA (punches must be acknowledged within 2 seconds), means Attendance is the first domain whose scaling requirement will diverge from the rest of the system.

**Extraction trigger:** >5,000 active employees with biometric punch; peak write throughput >100/second; OR attendance processing latency SLA consistently breached under load.

**Extraction architecture:**
```
Extracted Attendance Service:
  - Horizontally scalable punch ingestion API (stateless, load-balanced)
  - Dedicated Postgres instance for attendance schema (high IOPS configuration)
  - Attendance processing workers (horizontally scalable consumer pool)
  - Outbox relay → Kafka for event publication
  
Infrastructure:
  - API tier: 3–8 instances (auto-scaled on CPU/request queue depth)
  - Processing workers: 2–6 instances (auto-scaled on outbox queue depth)
  - DB: Postgres with streaming replica for read queries
  - Cache: Redis for shift assignment and policy resolution cache
```

**Pre-extraction checklist:**
- [ ] All cross-domain reads replaced with event-based or API-based integrations (no shared table access)
- [ ] Attendance Outbox properly configured and tested
- [ ] Policy Engine call latency within 50ms P99 (cache hit required)
- [ ] Shift domain projection API stable and versioned
- [ ] Integration tests covering all cross-domain contracts

---

### Priority 2: Analytics Domain

**Why second:**
Analytics is a pure consumer domain — it never writes to operational tables. But its **read volume and compute requirements** are substantial. Analytical queries against large workforce datasets, combined with event processing from all other domains, make it the domain most likely to be resource-starved in a shared deployment.

Additionally, the Analytics domain is a strong candidate for a **different database technology** (columnar store) than the operational Postgres used by other domains — making it a natural extraction candidate.

**Extraction trigger:** Analytics query latency consistently >2 seconds; event processing falling behind by >10 minutes; OR need to adopt a different storage technology (ClickHouse, TimescaleDB, BigQuery).

**Extraction architecture:**
```
Extracted Analytics Service:
  - Dedicated analytics Postgres schema → migrate to ClickHouse or TimescaleDB
  - Kafka consumer group for all operational domain events
  - Event projection workers (separate from monolith)
  - Query API service (read-only, stateless, horizontally scalable)
  - Dashboard data cache (Redis for frequently-accessed KPIs)
  
Infrastructure evolution path:
  Phase 1: Separate Postgres schema (already isolated in monolith)
  Phase 2: Streaming replica for analytics reads (reduce OLTP impact)
  Phase 3: Extract to dedicated service with ClickHouse columnar store
  Phase 4: Add Apache Flink or similar for streaming aggregation
```

---

### Priority 3: AI Intelligence Domain

**Why third:**
AI inference — especially LLM-based copilot responses — is **compute-intensive and has different infrastructure needs** than the rest of the platform:
- GPU infrastructure for model inference (or managed AI service API calls)
- Vector database for semantic search
- High-memory instances for large model context windows
- Model isolation (a poorly behaved model should not crash the HRMS)

These requirements make AI a strong extraction candidate for both infrastructure efficiency and failure isolation.

**Extraction trigger:** Copilot response latency >3 seconds; AI inference consuming >20% of shared compute; model inference costs justify dedicated infrastructure.

**Extraction architecture:**
```
Extracted AI Service:
  - Copilot API (stateless, horizontally scalable)
  - Prediction job workers (GPU-capable for custom models; API-based for LLM)
  - Vector store: pgvector → Qdrant (at scale)
  - Model serving: Dedicated inference endpoints (Anthropic API / Azure OpenAI / self-hosted)
  - Feature computation workers (consumes from Analytics exports and Kafka events)
  - Separate Postgres for AI domain state (model registry, prediction results, session state)
```

---

### Priority 4: Payroll Computation Engine

**Why fourth:**
Payroll computation is **compute-intensive but low-frequency** (monthly batch). However, at enterprise scale (50,000+ employees), a single payroll run can take hours on shared infrastructure, blocking other operations. The payroll computation engine is a strong candidate for extraction as a dedicated batch compute service.

**Note:** Payroll *data management* (run lifecycle, payslip storage) stays in the monolith. Only the *computation engine* — the CPU-intensive batch job that processes all payslips — is extracted.

**Extraction trigger:** Payroll run taking >2 hours; run competing with operational workloads; OR compliance requirement for payroll compute isolation.

**Extraction architecture:**
```
Extracted Payroll Computation Worker:
  - Dedicated computation worker pool (high-CPU instances)
  - Consumes PayrollRun initiation commands from queue
  - Reads frozen input snapshots from Payroll domain APIs
  - Writes computed payslip results back to Payroll domain via API
  - Horizontally scalable (can process employee batches in parallel)
  
  This is the "compute extraction" pattern — the domain remains in the monolith,
  but the computation workload is offloaded to dedicated workers.
```

---

### Priority 5: Notification Service

**Why fifth:**
Notifications are **event-heavy and I/O-bound** (sending emails, SMS, push notifications). They do not require the same database resources as other domains but need reliable delivery infrastructure with retry management. Notifications are also a natural candidate for a managed service (AWS SES, SendGrid, Firebase) rather than custom infrastructure.

**Extraction trigger:** Notification delivery becoming a bottleneck; need for dedicated delivery monitoring; OR cost optimization through specialized delivery infrastructure.

---

## 10.3 Queue-Heavy Domain Strategy

Certain domains are inherently queue-heavy — they process work asynchronously through job queues rather than synchronous request-response cycles.

### Queue Infrastructure Progression

```
PHASE 1 — POSTGRES-BASED QUEUES (Now → 18 months)
  Using: Postgres tables as queues (pg_listen/notify or polling)
  Implementation: Outbox tables serve as job queues for all async work
  Suitable for: <1,000 events/minute aggregate throughput

  Tables as queues:
    attendance.outbox          → Attendance event relay
    payroll.computation_jobs   → Payroll worker job queue
    notifications.send_queue   → Notification dispatch queue
    ai.prediction_jobs         → Prediction job queue

PHASE 2 — REDIS-BASED QUEUES (18–30 months)
  Using: Redis Streams or BullMQ (Node.js) / Celery (Python) over Redis
  Suitable for: 1,000–50,000 events/minute
  Migration: Swap outbox relay target from Postgres queue to Redis Stream
  No application code changes required

PHASE 3 — KAFKA (30+ months or on-demand)
  Using: Apache Kafka (self-hosted) or Confluent Cloud
  Suitable for: >50,000 events/minute; replay capability required
  Full event sourcing capability; consumer group isolation per service

Migration trigger thresholds:
  Postgres → Redis: Outbox polling consuming >5% DB CPU; queue depth consistently >10,000
  Redis → Kafka: Consumer groups need independent scaling; replay required; >5 extracted services
```

---

## 10.4 Database Scaling Strategy

### Postgres Scaling Progression

```
STAGE 1 — SINGLE INSTANCE WITH SCHEMA ISOLATION (Now → Phase 2)
  Architecture: Single Postgres instance, multiple schemas per domain
  Read scaling: Supabase read replicas for Analytics and reporting
  Write scaling: Connection pooling via PgBouncer (Supabase built-in)
  Suitable for: Up to ~20,000 employees, ~5TB total data

STAGE 2 — PRIMARY/REPLICA WITH ANALYTICS SEPARATION (Phase 2)
  Architecture: 
    - Primary: All write operations (all domains)
    - Replica 1: Analytics domain reads
    - Replica 2: Report generation and AI feature queries
  Suitable for: 20,000–100,000 employees

STAGE 3 — DOMAIN-ISOLATED DATABASES (Phase 3+)
  Architecture: Extracted services get their own Postgres instances
    - Attendance DB: High IOPS, SSD-optimized
    - Analytics DB: ClickHouse or columnar-optimized Postgres
    - AI DB: High-memory, pgvector-optimized
    - Operational DB: Remaining monolith domains
  Suitable for: 100,000+ employees

Postgres-specific optimizations (applicable at all stages):
  • Partition fact tables by month (attendance, payroll)
  • Partial indexes for common filtered queries (WHERE status = 'active')
  • Materialized views for expensive aggregate queries (refresh on schedule)
  • pg_partman for automated partition management
  • Timescale extension for time-series data if staying on Postgres
```

---

## 10.5 Multi-Tenant Scaling Considerations

### Tenant Isolation at Scale

```
SMALL TENANTS (<500 employees): Shared infrastructure, shared database, schema-level isolation
MEDIUM TENANTS (500–10,000 employees): Shared infrastructure, tenant-aware query partitioning
LARGE TENANTS (10,000–50,000 employees): Dedicated connection pools, priority compute allocation
ENTERPRISE TENANTS (50,000+ employees): Dedicated infrastructure stack (database, workers, cache)
```

### Noisy Neighbor Protection
Without tenant isolation at the infrastructure level, a large tenant's payroll run can starve a smaller tenant's real-time attendance processing. Protection mechanisms:

1. **Rate limiting at API layer:** Each tenant has API rate limits proportional to their tier
2. **Compute quotas:** Batch jobs (payroll, analytics projection) are assigned compute credits per tenant tier
3. **Queue isolation:** Enterprise tenants get dedicated queue consumers; smaller tenants share pooled consumers
4. **Database connection pooling:** Per-tenant connection pools prevent one tenant from exhausting the connection limit

---

## 10.6 Kafka Topic Architecture (Phase 2+)

```
TOPIC DESIGN PRINCIPLES

Naming convention:
  {platform}.{domain}.{event-type}
  Examples:
    workforce.attendance.daily-processed
    workforce.payroll.run-disbursed
    workforce.employee.created

Partitioning strategy:
  Key: tenant_id (ensures all events for a tenant are processed in order)
  Partitions: 12–48 per topic (sized for consumer parallelism)
  
Retention:
  Operational topics: 7 days (high volume, consumers are real-time)
  Audit topics: 30 days (longer retention for audit consumers)
  
Topic-per-tenant (for large enterprise tenants):
  workforce.{tenant_id}.attendance.daily-processed
  Enables tenant-specific consumer groups and retention policies

Consumer group naming:
  {platform}.{consuming-domain}.{event-type}
  Examples:
    workforce.analytics.attendance.daily-processed
    workforce.ai.attendance.daily-processed
    workforce.audit.attendance.daily-processed
```




---


# SECTION 11: FINAL RECOMMENDATIONS

---

## 11.1 Most Critical Architectural Boundaries

These are the five boundaries that, if violated, will cause the greatest long-term technical debt. Treat each as a **hard engineering constraint** — not a guideline.

### Boundary 1: Analytics Domain ↔ All Operational Domains
**The rule:** The Analytics domain reads from no operational domain's database table directly. Ever.
**Why it's critical:** This is the single most violated boundary in HRMS platforms. The temptation to write `SELECT * FROM attendance.daily_attendance WHERE tenant_id = X` from the analytics service is constant. It creates coupling that makes operational schema changes impossible without analytics breakage.
**Enforcement:** Database-level permission denial. The analytics schema's database user has no SELECT privilege on any operational schema. The only permitted access pattern is the domain's published API or event stream.

### Boundary 2: Payroll Domain ↔ Attendance Domain
**The rule:** Payroll consumes only the published `AttendancePayrollProjection` API endpoint — a read model designed for payroll consumption. Payroll never queries attendance operational tables. Payroll never triggers attendance recomputation.
**Why it's critical:** Payroll and Attendance interact at month-end when payroll runs. If Payroll reads attendance directly, a schema change in attendance tables breaks payroll. If Payroll triggers attendance reprocessing, you have a bidirectional dependency that makes deployment order unpredictable.
**Enforcement:** Code review gates; architecture fitness function (automated test asserting no `attendance.*` table names appear in Payroll domain SQL).

### Boundary 3: Workflow Domain ↔ All Business Domains
**The rule:** The Workflow domain contains zero business logic. It processes workflow state transitions but makes no business decisions. The originating domain validates business rules before submitting to Workflow, and makes business decisions when receiving the workflow outcome event.
**Why it's critical:** If business logic leaks into the Workflow domain, you create a domain that becomes the stealth owner of business rules from multiple contexts. This produces the worst kind of coupling — a domain that must change whenever any business rule in any context changes.
**Enforcement:** Code review; Workflow domain has no imports from any business domain module.

### Boundary 4: Policy Engine → Domain Computation
**The rule:** Policy Engine returns rule parameters; domains perform computations. Policy Engine never computes attendance OT, never calculates leave entitlements, never processes payroll components. It only answers: "what are the rule parameters for this context?"
**Why it's critical:** If computation logic migrates into the Policy Engine, it becomes a computational black box with business logic from every domain — a god service. Domains must own their computation; the Policy Engine owns only configuration.
**Enforcement:** Policy Engine's rule_set fields contain only scalar values (numbers, booleans, enum codes, date ranges) — never executable logic or formulas.

### Boundary 5: IAM ↔ Business Domains
**The rule:** IAM owns authentication and authorization definition. Business domains enforce authorization decisions but do not define them. No business domain checks a specific permission by name (`hasPermission('APPROVE_LEAVE')`) — they check a business capability that the IAM policy resolves.
**Why it's critical:** Hardcoding permission names in business domain code tightly couples business logic to the IAM permission model. When permission structures evolve (new roles, new granularity), you get a cross-domain refactoring cascade.
**Enforcement:** Business domains call a domain-appropriate authorization helper (`canApproveLeavesFor(managerId, employeeId)`) that internally resolves permissions — abstracting the specific IAM permission name from the business logic.

---

## 11.2 Most Dangerous Coupling Risks

Ranked by probability of occurrence and impact severity:

### Risk 1: Shared Database Tables Across Domain Boundaries
**Probability:** Very High (most common failure mode in HRMS evolution)
**Impact:** Critical — blocks independent scaling, makes schema changes cascade
**Prevention:** Enforce Postgres schema-per-domain naming convention from day one. Automated architecture tests that detect cross-schema foreign key references.

### Risk 2: Payroll Computation Logic Drift Across Modules
**Probability:** High
**Impact:** High — computation inconsistencies between Payroll and Attendance/Leave produce payroll errors
**Prevention:** Single computation owner per metric. OT hours are computed in Attendance; OT earnings are computed in Payroll using Attendance's OT hours as input. Never compute the same metric in two domains.

### Risk 3: Workflow Domain Accumulating Business Logic
**Probability:** High — developers find it "convenient" to add business rules to workflow conditions
**Impact:** High — Workflow becomes a business logic dumping ground; untestable and unmaintainable
**Prevention:** Code review policy: any conditional logic in Workflow domain that references domain-specific terms (leave, payroll, attendance) is a defect.

### Risk 4: AI Domain Directly Mutating Operational Data
**Probability:** Medium
**Impact:** Very High — AI directly writing to operational tables bypasses all domain invariants, audit trails, and approval workflows
**Prevention:** AI Intelligence domain's database user has INSERT/UPDATE privileges on AI domain tables only. Zero write access to any operational domain.

### Risk 5: Policy Engine Becoming a Computation Service
**Probability:** Medium — "since Policy Engine knows the rules, let it compute the result" logic
**Impact:** High — Policy Engine becomes a computation server with dependencies on all domain data
**Prevention:** Strict schema validation of rule_set JSON: only scalar values permitted. No formula fields.

### Risk 6: Notification Domain Containing Business Decision Logic
**Probability:** Medium
**Impact:** Medium — Notification domain becomes a business logic owner; hard to test, hard to change
**Prevention:** Events emitted by domains must be at business-decision level (`leave.application.approved`), not at notification-trigger level. Notification domain does not decide when to notify — only how.

### Risk 7: Employee Domain PII Leaking into Analytics Projections
**Probability:** Medium
**Impact:** Very High — GDPR/privacy violation; potential regulatory penalty
**Prevention:** Analytics schema stores only non-PII identifiers (employee_id as UUID, grade code, unit code). No name, date of birth, national ID, or contact details in any analytics table. Display names resolved at query time through permission-controlled Employee domain API call.

---

## 11.3 Highest-Value Existing Modules

Ranked by domain logic maturity and value preserved in migration:

### 1. Attendance Engine (Highest Value)
The attendance computation pipeline — punch processing, shift matching, OT calculation, period finalization — represents significant domain knowledge. The business rules embedded here (grace period handling, night-shift overtime calculation, split-shift processing) took years to get right and reflect real operational complexity. **Preserve every line of computation logic. Refactor structure; never rewrite computation.**

### 2. Payroll Computation Pipeline (High Value)
The earnings and deductions computation pipeline is mathematically precise and legally compliant. Statutory deduction logic (tax computation, PF/ESI calculations) is particularly valuable. **This must be parallel-run validated before any cutover — not just unit tested.**

### 3. Leave Accrual and Balance Engine (High Value)
The accrual mechanics — pro-rated entitlements, carry-forward rules, balance reservation-on-submit pattern — are operationally mature and handle edge cases (mid-year joins, exit processing, leave without pay interactions) that are easy to get wrong in a rebuild.

### 4. Workflow Routing Logic (Medium-High Value)
The hierarchical routing logic — finding the correct approver based on org hierarchy, handling delegation chains, respecting skip-level rules — is valuable and non-trivial. Even if the workflow engine itself is rebuilt into a generic state machine, the routing algorithm should be preserved and refactored into the new Workflow domain.

### 5. Business Rules Embedded in APIs (Medium Value — risk of loss)
The most underappreciated value in existing systems: validation logic embedded in API request handlers. This logic (e.g., "cannot apply for more than X days of leave without manager approval," "attendance regularization must be submitted within 7 days") represents real business rules agreed upon with customers. **Catalog these before any migration and ensure they survive.**

---

## 11.4 Biggest Future Scalability Risks

### Risk 1: Attendance Write Volume at Enterprise Scale
A 100,000-employee deployment with biometric punch generates ~600,000+ writes per day, with extreme concentration during shift changes (thousands of punches per minute). If the Attendance domain is not extracted before this scale is reached, it will create write bottlenecks that affect the entire platform's availability.

**Mitigation:** Plan Attendance extraction at the 5,000-employee threshold, not when problems are already occurring.

### Risk 2: Analytics Query Performance Degradation
As the workforce history grows (5+ years of daily attendance, payroll, and leave data), analytical queries on non-partitioned tables will degrade significantly. A 100,000-employee deployment produces 36.5 million daily attendance records per year.

**Mitigation:** Implement monthly table partitioning from day one (see Section 8). Adopt ClickHouse for Analytics domain by Phase 2.

### Risk 3: AI Inference Latency at Copilot Scale
If 10,000 concurrent users are using the AI copilot, LLM inference costs and latency become significant. A single LLM call costs ~$0.01–0.05 per query at current pricing; at 1 million queries/day this is $10,000–50,000/day in inference costs.

**Mitigation:** Implement aggressive response caching for common queries. Use smaller/cheaper models for intent classification; larger models only for complex generation. Pre-generate common responses during off-peak hours.

### Risk 4: Payroll Run Compute Time
A monthly payroll run for 100,000 employees with complex computation chains (multiple earnings components, statutory deductions, tax computation, anomaly detection) can take 4–6 hours on shared infrastructure.

**Mitigation:** Extract Payroll Computation Engine as dedicated batch workers early (before 20,000 employees). Implement parallel employee-batch processing.

### Risk 5: Multi-Tenant Policy Resolution Cache Invalidation
With 1,000+ tenants and frequent policy changes, the Policy Engine's cache invalidation broadcast could create thundering herd problems — all tenants simultaneously re-querying the Policy Engine after a platform-wide policy update.

**Mitigation:** Stagger cache TTL with small random jitter per tenant. Use tenant-scoped cache invalidation (not global broadcast) for tenant-specific policy changes.

---

## 11.5 Recommended Platform Evolution Priorities

### Quarter 1–2: Foundation Hardening
**Priority objectives:**
1. Establish domain schema isolation (per-domain Postgres schemas) — prevents future coupling
2. Introduce outbox tables per domain — enables reliable event emission
3. Extract Policy Engine as distinct module with policy resolution API — unblocks all other domains
4. Modernize Employee domain with proper aggregate model and event emission
5. Wire Analytics event consumers for Attendance and Employee events — gives immediate analytics value

**Key milestone:** All cross-domain database reads eliminated within operational tier.

### Quarter 3–4: Operational Domain Modernization
**Priority objectives:**
1. Complete Attendance domain refactoring (shift extraction, policy externalization, event emission)
2. Complete Leave Management domain refactoring (workflow delegation, event emission)
3. Introduce Workflow domain as generic approval engine (consolidate all approval flows)
4. Begin Notifications domain consolidation (single dispatch service consuming events)
5. Establish Analytics projection pipeline for all Tier 2 operational domains

**Key milestone:** All operational domain events flowing through outbox to in-process event bus.

### Year 2: Financial Domain and Intelligence Layer
**Priority objectives:**
1. Complete Payroll domain refactoring + C&B domain extraction
2. Introduce AI Intelligence domain (attrition risk as first model)
3. Introduce AI copilot (attendance and leave workspace first)
4. Analytics domain migration to dedicated schema with pre-aggregated KPI layer
5. Complete Compliance domain (statutory reporting automation)

**Key milestone:** AI copilot launched in manager workspace; attrition risk model in production.

### Year 3+: Scale and Intelligence Expansion
**Priority objectives:**
1. Attendance domain service extraction (triggered by scale)
2. Analytics domain migration to columnar store
3. AI model expansion (absence prediction, payroll anomaly, workforce planning)
4. Recruitment domain development
5. Performance Management domain development
6. Integration Platform maturation (enterprise connector library)

---

## 11.6 Architecture Maturity Assessment

```
ARCHITECTURE MATURITY SCORECARD — CURRENT STATE

Dimension                          Current    Target (24mo)   Target (48mo)
────────────────────────────────────────────────────────────────────────────
Domain Boundary Clarity            ●●○○○       ●●●●○           ●●●●●
Event-Driven Communication         ●○○○○       ●●●○○           ●●●●●
Policy Centralization              ●●○○○       ●●●●○           ●●●●●
Analytics Separation               ●○○○○       ●●●○○           ●●●●●
AI Integration                     ○○○○○       ●●●○○           ●●●●●
Multi-Tenant Isolation             ●●○○○       ●●●●○           ●●●●●
Audit & Compliance Traceability    ●●○○○       ●●●●○           ●●●●●
Scalability Readiness              ●●○○○       ●●●○○           ●●●●●
API Contract Stability             ●●○○○       ●●●●○           ●●●●●
Developer Experience (DX)          ●●○○○       ●●●○○           ●●●●●

Legend: ● = maturity level achieved  ○ = not yet achieved (each = 20%)
```

---

## 11.7 Enterprise Readiness Assessment

### Readiness for Enterprise Procurement (Post-24-Month Target State)

| Enterprise Requirement | Architecture Support | Confidence |
|---|---|---|
| Multi-tenant data isolation | Schema + RLS isolation by tenant_id | High |
| GDPR / data privacy compliance | PII in Employee domain, field encryption, erasure support | High |
| SSO / SAML integration | IAM domain, SSOBridgeService | High |
| Statutory compliance (PF, ESI, TDS, SOCSO, etc.) | Compliance domain + Policy Engine | High |
| Full audit trail for regulatory inspection | Audit domain consuming all write events | High |
| Role-based access control | IAM domain with ABAC | High |
| Multi-entity / multi-jurisdiction | Organization hierarchy + jurisdiction-aware policies | High |
| Payroll accuracy and traceability | Immutable computation log per payslip | High |
| API for ERP integration | Integration Platform domain | Medium |
| Offline mobile support | Mobile Workforce domain | Medium |
| Custom reporting | Analytics domain query API + report builder | Medium |
| AI-powered insights | AI Intelligence domain | Medium |
| SLA: 99.9% uptime | Modular extraction enables rolling updates | Medium-High |

---

## 11.8 AI Readiness Assessment

The platform's architectural design encodes AI readiness at every layer:

### Structural AI Readiness
| Requirement | How Architecture Supports It |
|---|---|
| Clean training data | Event-sourced fact tables in Analytics domain produce well-structured historical data |
| Feature engineering pipeline | Analytics export API provides structured datasets; feature store in AI domain |
| Real-time signal feeds | Domain events consumed by AI domain enable real-time model inputs |
| Model governance | Model Registry aggregate with versioning, metrics, and bias assessment |
| Prediction → Action pipeline | Typed recommendation events; operational domains choose to act |
| Copilot data access | Permission-scoped data queries; AI inherits user's ABAC context |
| Explainability | Computation logs in Payroll; feature importance in prediction results |
| Continuous improvement | Model performance monitoring; drift detection; retraining triggers |

### AI Capability Roadmap

```
PHASE 1 (Year 1): Reactive Intelligence
  ✓ Payroll anomaly detection (pre-disbursement)
  ✓ Attendance anomaly detection (unusual patterns)
  ✓ Basic copilot (attendance and leave Q&A)
  
PHASE 2 (Year 2): Predictive Intelligence
  ✓ Attrition risk scoring
  ✓ Absence prediction for roster planning
  ✓ Leave pattern analysis (burnout detection)
  ✓ Extended copilot (payroll explanation, approvals)
  
PHASE 3 (Year 3): Prescriptive Intelligence
  ✓ Workforce planning forecasts (headcount, hiring requirements)
  ✓ Roster optimization (AI-suggested schedules)
  ✓ Compensation equity analysis
  ✓ Career path recommendations
  ✓ Autonomous HR agent (draft onboarding plans, compliance alerts)

PHASE 4 (Year 4+): Autonomous Workforce Operations
  ✓ AI-orchestrated workflows (proactive exception management)
  ✓ Real-time labor cost optimization
  ✓ Predictive compliance (flag violations before they occur)
  ✓ Multi-modal workforce intelligence (voice copilot for field workers)
```

---

## 11.9 Closing Architecture Statement

This document establishes the **architectural contract** for the AI-native Workforce Operating System. It is not aspirational — it is prescriptive. Every engineering decision made in service of this platform must be traceable to the boundaries, ownership rules, and integration contracts defined here.

The platform is designed to win against Darwinbox, Workday, UKG, and Rippling — not by copying their features, but by out-executing them architecturally. The advantage of a greenfield-evolution architecture built on mature domain logic is that it combines the **operational correctness of a proven system** with the **structural integrity of deliberate design**.

The three non-negotiable platform commitments that this architecture exists to honor:

1. **Payroll is always correct.** Every computation is traceable, every input is frozen at run time, every anomaly is detected before disbursement. This is architecturally guaranteed — not operationally hoped for.

2. **Workforce data is always trusted.** Attendance records are immutable at capture, corrections are full audit-trailed, policy applications are versioned and explainable. No one will ask "how was this calculated?" and receive a shrug.

3. **The platform grows with its customers.** A 100-employee SME and a 100,000-employee enterprise share the same domain model, the same event contracts, and the same API surface — with infrastructure that scales independently and AI features that improve as the dataset grows.

This document is version 1.0. It must be treated as a living architectural artifact — reviewed quarterly, updated as domain understanding deepens, and enforced continuously as the platform evolves.

---

*Document completed. All 22 domains modeled. All 11 sections complete.*




---


