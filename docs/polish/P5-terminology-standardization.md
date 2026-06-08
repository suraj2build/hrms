# P5 — Terminology Standardization

**Program:** Emvora Product Polish (Feature Complete → Enterprise Premium)
**Phase:** P5 of P7
**Status:** Shipped
**Constraints honored:** No schema · No API redesign · No business logic · No workflow · No payroll behavior · No RBAC · No RLS changes.

---

## Problem

Navigation labels used internal architecture vocabulary that meant nothing to HR users. Examples: "Collision Log," "Accrual Engine," "Observability Console," "Forensics." An HR manager navigating the system shouldn't need to decode engineering concepts.

---

## Renames (nav-config.ts only — routes unchanged)

### Attendance
| Before | After |
|---|---|
| Roster Intelligence | Roster Analytics |

### Leave
| Before | After |
|---|---|
| Engine Status | Scheduler Status |
| Accrual Ledger | Accrual History |
| Accrual Engine | Accrual Runs |
| Collision Log | Leave Conflicts |
| Leave Governance | Leave Rules |
| Policy Engine | Policy Simulator |

### Payroll
| Before | After |
|---|---|
| Arrear Engine | Arrear Payments |
| Forensics | Deep Analysis |
| IT / TDS Governance (group) | Tax & Declarations |
| Tax Governance | Tax Declarations |

### Advanced Operations
| Before | After |
|---|---|
| Governance Matrix | Approval Matrix |
| Event Governance | Event Log |
| Advanced Intelligence (group) | Advanced Analytics |
| Session Intelligence | Attendance Sessions |
| UAT Certification | UAT Testing |
| Intelligence Hub | Analytics |
| Observability Console | System Monitor |
| Orchestration Console | System Orchestration |

---

## Principle Applied

Every renamed item follows one rule: **a non-technical HR user should immediately understand what they'll find behind the label.** Architecture terms (Engine, Forensics, Intelligence, Governance, Observability, Collision) were replaced with outcome or function terms.

Routes are unchanged — no links break.

---

## Files Changed

| File | Change |
|---|---|
| `components/layout/v2/nav-config.ts` | 16 label renames across Leave, Payroll, Compliance, Advanced Operations domains |

**Zero** changes to routes, components, schemas, APIs, business logic, or any data.
