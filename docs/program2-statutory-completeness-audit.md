# Program 2 — Statutory Completeness Audit

**Date:** 2026-06-13 · **Type:** Decision document — **audit & recommendation only.**
**Constraints honoured:** no implementation, no migrations, no APIs, no UI, no code changes, **no commits**. (This file is written for review and left **uncommitted** per the Program-2 rules.)
**Method:** Every claim verified against the codebase (file + line). Gaps were *verified*, not assumed.

---

## 1. Current Architecture Review

CognixHR already has the **engines, data, and delivery infrastructure** for statutory completeness — the gaps are almost entirely **thin glue layers** (an export, a scheduled scan, a UI, and ~48 one-line audit calls), not new subsystems.

- **Statutory calculation** is complete and live for EPF/ESI/PT/**LWF**/TDS — each has an engine and writes immutable per-employee contributions.
- **Filing data** exists (`statutory_filing_artifacts` with period/status, `statutory_filing_closures` with challan/filed state) but **no due-date/deadline store**.
- **Scheduling** is a solved problem: `leave-scheduler.ts` (hourly durable tick), `sla-scanner.ts` (scheduled scan → event + inbox), `intelligence-scanner.ts` (6 h → observations) are all registered at startup (`apps/api/src/index.ts:398-407`).
- **Alerting/delivery** is a solved problem: `inbox_items` (already supports `item_type='compliance_alert'`), `notify()`/`notifyHrAdmins()`, `notification_templates` (already has a `'compliance'` category), and `intelligence_observations` (already has a `'compliance'` category).
- **Audit logging** is a solved problem: `logAction()` → `audit_logs`, used widely — but **barely wired into statutory routes**.

**Net:** Program 2 is mostly **assembly over existing, proven parts.** Only Form 24Q and TAN capture need genuinely new data.

---

## 2. Existing Assets (verified)

| Asset | Location | Relevance |
|---|---|---|
| LWF engine + storage | `lib/statutory/lwf-engine.ts` (`computeLWF`), `lib/statutory-payroll.ts:146`, `routes/payroll/statutory/lwf.ts:327`, migration `229_lwf_tables.sql` | P2.3 — data is **fully computed & stored** |
| Statutory export pattern | `routes/payroll/exports.ts:61-531` (epf/esi/**ptax**/tds/challan/recon) | P2.3/P2.4 — CSV template to mirror |
| TDS engine + monthly TDS | `lib/statutory/tds-engine.ts`, `payroll_slips.tds_deducted` (mig 226), `tds_monthly_projections` (mig 098) | P2.4 — computation + per-slip TDS present |
| **Partial 24Q already exists** | `routes/payroll/filing-pack.ts:408-557` — `GET /payroll/filing-pack/24q` builds Annexure I + II CSV | P2.4 — a CSV scaffold already exists |
| Filing artifacts + closures | migrations `232_statutory_filing_artifacts.sql`, `218_statutory_filing_closure.sql` | P2.1 — period/status + challan/filed state |
| Scheduler infra | `lib/leave-scheduler.ts`, `lib/sla-scanner.ts`, `lib/intelligence-scanner.ts`; registered `index.ts:398-407` | P2.1/P2.2 — reusable tick + scan→inbox |
| Inbox + notify | migration `107_operational_inbox.sql` (`item_type` incl. `'compliance_alert'`), `lib/notify.ts` (`notify`, `notifyHrAdmins`) | P2.2 — programmatic alert insert |
| Notification templates | migration `106_notification_templates.sql` (category incl. `'compliance'`), `NotificationTemplates.tsx` | P2.2 — multi-channel templates |
| Observations engine | migration `213_intelligence_layer.sql` (`intelligence_observations`, category incl. `'compliance'`), `routes/intelligence/index.ts:40-188`, `WorkforceCommand.tsx` | P2.2 — observation surface |
| Executive compliance shell | `pages/executive/ComplianceView.tsx:72-74` — explicit "not wired yet" placeholder | P2.1/P2.2 — wiring target |
| Audit logging | `lib/audit-service.ts` (`logAction`), `audit_logs`; gold-standard usage in `separation-workflow.ts` | P2.5 — reuse as-is |

---

## 3. Reuse Opportunities (no new engines)

- **P2.2 alerts** → reuse `sla-scanner.ts` scan→`notify()` pattern + existing `'compliance'` templates + `'compliance_alert'` inbox type. **No new alert engine** (objective met).
- **P2.1 calendar** → reuse the scheduler tick + the existing inline deadline math (`routes/workspace/stats.ts:560-563`) as the deadline source; feed both the calendar UI and the P2.2 scanner from one place.
- **P2.3 LWF export** → clone the `ptax` export handler almost verbatim.
- **P2.4 24Q** → extend the existing `filing-pack.ts:408-557` CSV rather than start over.
- **P2.5 logging** → `logAction` one-liners after each successful mutation; `separation-workflow.ts` is the copy-paste template.

---

## 4. Missing Assets (verified gaps, classified)

### P2.1 Compliance Calendar — **High**
- **ABSENT:** a persisted deadlines source (`compliance_deadlines`/`filing_due_dates`) — deadlines are computed ad-hoc, never stored. *(Note: can be done as a derived endpoint with no table — see plan.)*
- **ABSENT:** calendar UI (no grid/timeline; no orphaned component exists).
- **PRESENT:** scheduler, filing tables, one-off deadline math, dashboard shells.
- **Verdict:** missing **UI + a thin deadline-source layer**, not a new subsystem.

### P2.2 Compliance Alerts — **High** (effort **Low**)
- **ABSENT:** a scheduled compliance scan + the 3 compliance templates + the `ComplianceView` wiring.
- **PRESENT:** *everything else* (inbox type, notify, templates category, observations category, scanner pattern).
- **Verdict:** **assembly only — no new alert engine** (objective confirmed achievable).

### P2.3 LWF Export — **Medium** (effort **Low**)
- **ABSENT:** `GET /payroll/exports/lwf` endpoint + a download button in `LWFManagement.tsx`.
- **PRESENT:** engine, `lwf_contributions`, state settings.
- **Verdict:** pure **reporting gap** — ~40-line export mirroring `ptax`. No payroll change.
- *Caveat:* states are tenant-configured on-demand (no seed) — not a blocker for export.

### P2.4 Form 24Q — **Medium/High** (effort **Medium–High**, partially blocked)
- **ABSENT (mandatory):** **Deductor TAN** (not in `tenants`, not in `statutory_registrations` — whose CHECK only allows `epf`/`esi`/`ptax`), **challan number / BSR / deposit date / deductee-challan mapping**, **per-deductee surcharge/cess** (hardcoded 0), and the **FVU fixed-width** file format.
- **PRESENT:** Annexure I + II **CSV** already generated; PAN, names, gross, quarterly TDS all derivable.
- **Verdict:** **data + format gap.** A *verification CSV* is producible today; a *submittable FVU* is not (blocked on TAN + challan remittance data).

### P2.5 Statutory Audit Logging — **High** (effort **Low**)
- **VERIFIED:** **1 of ~49** statutory write endpoints calls `logAction` (only `statutory/governance.ts` settings). FNF/gratuity (just added) is correctly logged.
- **Coverage matrix:**

| Domain | File | Mutating endpoints | Audited |
|---|---|---|---|
| EPF | `statutory/epf.ts` | 5 | 0 |
| ESI | `statutory/esi.ts` | 6 | 0 |
| PT | `statutory/ptax.ts` | 4 | 0 |
| LWF | `statutory/lwf.ts` | 2 | 0 |
| TDS declarations/approvals/proofs | `statutory/tds.ts` | 13 | 0 |
| TDS governance/plans/components | `tax-governance.ts`, `tds-plans.ts`, `tds-components.ts` | 7 | 0 |
| Statutory governance/registrations/overrides | `statutory/governance.ts` | 7 | **1** |
| Statutory groups master | `masters/statutory-groups.ts` | 3 | 0 |
| Filing-pack status (submitted/acknowledged) | `payroll/filing-pack.ts` | 2 | 0 |
| Gratuity/FNF | `separation-workflow.ts` | several | ✅ |

- **Highest-sensitivity unlogged:** TDS declaration **approve/reject/revision** (`tds.ts:687/740/790`), proof **verify/reject** (`tds.ts:969/1011`), filing **status transitions** (`filing-pack.ts:778`).

---

## 5. Risks

| Risk | Severity | Note |
|---|---|---|
| **TAN not captured anywhere** | **High** | Blocks 24Q submission; also why P1.3 Form 16 shows TAN "—". Shared prerequisite. |
| 24Q without challan/BSR/deposit data | High | Can't produce a *submittable* FVU; only a verification CSV. Challan data needs post-remittance entry. |
| Statutory changes unaudited | High | Config/rate/eligibility/approval changes leave no trail — audit/dispute exposure. Cheap to fix. |
| Per-deductee surcharge/cess = 0 in 24Q | Medium | Annexure II understates high-earner tax detail until computed/stored. |
| Alert spam on restart | Low | In-memory dedup resets on restart (acceptable; matches SLA scanner). |
| No deadline table → drift | Low | If deadlines are computed, keep the rule in ONE place to avoid divergence. |

---

## 6. Recommended Build Order

The mandated order is P2.1→P2.5. By **value ÷ effort ÷ risk**, I recommend a re-sequence (flagged for your call):

1. **P2.5 Statutory Audit Logging** — *fastest, highest governance value, near-zero risk.* ~48 one-liners. Do first.
2. **P2.3 LWF Export** — small, isolated reporting win; closes a real filing gap.
3. **P2.1 Calendar + P2.2 Alerts (together)** — build the **single deadline source** once, then render it (calendar) and scan it (alerts). P2.2 is trivial once the source exists.
4. **P2.4 Form 24Q (scoped)** — first land **TAN capture** (shared with Form 16), then polish the existing Annexure CSV + per-deductee surcharge/cess. **Defer the full FVU + challan integration** (blocked on bank remittance data) to a later, separate effort.

*If you prefer the literal P2.1→P2.5 order, the only change is doing the calendar before logging/LWF; everything remains compatible.*

---

## 7. Estimated Effort Per Workstream

| Workstream | Scope | Schema? | Effort |
|---|---|---|---|
| **P2.5 audit logging** | ~48 `logAction` calls across ~10 files | none | **~1–1.5 d** |
| **P2.3 LWF export** | 1 endpoint + 1 download button | none | **~0.5 d** |
| **P2.1 calendar** | deadline-source endpoint (derived, no table) + calendar UI + wire `ComplianceView` | none (derived) or 1 tiny table | **~3–4 d** |
| **P2.2 alerts** | 1 scheduled scan reusing `notify` + 3 templates + exec wiring | none | **~1–2 d** |
| **P2.4 24Q (MVP)** | TAN capture (small migration: extend `statutory_registrations` CHECK or add tenant TAN) + Annexure CSV polish + per-deductee surcharge/cess | small | **~2–3 d** |
| **P2.4 24Q (full FVU)** | RPU/FVU fixed-width + challan/BSR/deposit capture + deductee-challan mapping | medium | **~1–2 wk (defer)** |

*(These right-size the sub-agent's "weeks" estimates — the logging work is mechanical one-liners.)*

---

## Program 2 — Recommended Execution Plan

**Phase 2A — Governance & reporting quick wins (~2 d, no schema)**
- **P2.5:** add `logAction` to all statutory mutations (start with TDS approve/reject/proof-verify + filing status; then config/eligibility/registrations/slabs/groups). Pattern = `separation-workflow.ts`.
- **P2.3:** add `GET /payroll/exports/lwf` (mirror `ptax`) + download button in `LWFManagement.tsx`.

**Phase 2B — Deadlines: calendar + alerts (~4–5 d, ≤1 tiny table)**
- Create a **single deadline source** (derived endpoint preferred; tiny `compliance_deadlines` table only if persistence/ack is needed) using the existing inline rule.
- **P2.1:** calendar UI (reuse dashboard card/grid components) + wire `ComplianceView` placeholder.
- **P2.2:** a scheduled compliance scan (clone `sla-scanner`) → `notify()`/`notifyHrAdmins()` with new `'compliance'` templates → already-supported `'compliance_alert'` inbox + `'compliance'` observations. **No new engine.**

**Phase 2C — Form 24Q MVP (~2–3 d, small schema)**
- Land **TAN capture** (also fixes Form 16 header) — extend `statutory_registrations` to allow a `tds`/`tan` type, or add a tenant TAN field; surface in statutory settings UI.
- Polish the existing `filing-pack 24q` Annexure I+II CSV; compute per-deductee surcharge/cess.
- **Explicitly defer** full NSDL FVU + challan/BSR/deposit capture (needs post-remittance bank data) to a separate program with its own approval.

**Gate:** Await approval on (a) the re-sequence vs literal order, and (b) the 24Q MVP-vs-full-FVU scope, before any implementation.

---

### Finding classification summary
- **Critical:** none (no production outage; P1 already cleared the live 500).
- **High:** P2.5 statutory logging gap · P2.1 calendar absence · P2.2 alert absence · TAN-not-captured (blocks 24Q + weakens Form 16).
- **Medium:** P2.3 LWF export · P2.4 24Q data/format (challan, surcharge/cess, FVU).
- **Low:** alert restart-dedup · deadline single-source-of-truth hygiene.

*No code, migrations, routes, UI, or commits were created. Recommendation only — awaiting approval to begin Phase 2A.*
