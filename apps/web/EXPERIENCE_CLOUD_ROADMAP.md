# CognixHR Experience Cloud — Implementation Roadmap

> **Document 3 of 3.** Phased execution mapped to the **existing codebase**.
> Companion docs: **Vision** (why) · **UX Blueprint v2** (how it works).
> Builds on `ESS_UX_UNIFICATION_BLUEPRINT.md` (the v1 cleanup = this roadmap's P0).
>
> **Status:** FROZEN — architectural foundation. Governed by `COGNIXHR_PRODUCT_MANIFESTO.md`.
> No code yet. Each phase is independently shippable, reuse-first, and preserves
> governance (RBAC, tenant scope, the 402 write-gate, the lint/colour gate). File/route/
> table references are real (from the four-part audit). Changes require recorded amendment.

---

## 0. Sequencing logic

Two tracks run in parallel and converge:

- **Track A — Coherence (UI):** make today's ~40 screens feel like one product. Low
  risk, high perceived value, unblocks everything visual. *(This is v1's P0–P3.)*
- **Track B — Kernel (platform):** stand up Events / Signals / Identity / Intelligence
  so surfaces can compose across modules. Higher value, builds the moat.

We ship **A first for fast wins**, but stand up the **kernel's read-models early** so
the OS surfaces (Timeline, Notifications, ambient AI) have something to read.

```
P0 Coherence ──► P1 Nav+Requests ──► P2 Kernel read-models ──► P3 OS surfaces
                                                            └─► P4 Ambient AI + Identity
                                                            └─► P5 Community graph + Manager layer
                                                            └─► P6 Predictive intelligence + Platform
```

---

## P0 — Coherence sweep  *(Track A · v1 P0 · low risk)*

**Goal:** one visual system; the product *feels* unified. No new features.

| Work | Where (real files) |
|---|---|
| Bring `EssHome` into the template (`PageContainer`/`PageHeader`); replace its bespoke `Card`/KPI tiles with `SectionCard`/`MetricCard` | `pages/ess/EssHome.tsx:109` |
| Remove the 30+ hand-rolled `rounded-* border bg-card` tiles | EssHome, EssLoansAdvances, EssPolicies, EssAssets, EssSeparation, … |
| One `EmptyState` / `LoadingState` / `ErrorState` primitive, adopted everywhere | new `components/layout/` primitives |
| Tokenize colours; remove `#15B8A6`/`#2E6FE6` hardcodes; fix misleading aliases (`--accent-teal` = navy) | `index.css`, `lib/brand-config.ts`, pages |
| Lock section rhythm + type scale; enforce via the existing colour/lint gate | `DESIGN_CONSISTENCY.md` gate |

**Exit:** every ESS screen passes one template + token contract; lint-gated so it can't
regress. **Decision needed (Vision §11 #1):** commit navy-primary/teal-accent.

---

## P1 — Navigation spine + unified requests  *(Track A · v1 P1–P2)*

**Goal:** ≤5 primary destinations per platform; one request model; remove duplication.

| Work | Where |
|---|---|
| Group nav thematically (Work/Pay/Docs/Me); promote buried screens (Benefits, FBP, Tax, Operational Center) | `config/navigation.config.ts`, `EmployeeSidebar.tsx`, `MobileMore.tsx` |
| Collapse the **25 duplicate `/manager/self/*` routes** into persona-hosted ESS routes | `App.tsx`, `ManagerShell.tsx` |
| Merge confusable twins: Helpdesk + HR-Support → one **Support** (two tabs) | `EssHelpdesk.tsx`, `EssHRSupport.tsx` |
| Retire the orphan `/manager/team/attendance`; clean redirect-chain debt | `App.tsx` |
| **FlowDesk = the single submit + track surface**: "Raise a Request" launcher for all 10 types; Approvals becomes a component, not a route | `EssFlowDesk.tsx`, `EssApprovals.tsx` |
| **Status-label normalizer**: map all 10 enums to one display lexicon | new `lib/status-lexicon.ts` + `StatusBadge` |
| **Tax Hub**: fold ITStatement/YTD/HRA/TDS/PreviousEmployer into `TaxPlanner` tabs | `pages/ess/TaxPlanner.tsx` + siblings |

**Decision needed (Vision §11 #2, #3):** approve manager-route collapse + FlowDesk as
the request hub.

---

## P2 — Kernel read-models  *(Track B · the platform foundation)*

**Goal:** stand up Events / Signals / Identity as read-models over existing data so OS
surfaces have something to read. **Minimal new storage — mostly projections.**

| Kernel piece | Build approach (reuse-first) |
|---|---|
| **Event spine** | `GET /timeline` read-model projecting existing tables (`attendance_logs`, `leave_requests`, `payroll_runs`, `recognition`, `holiday_calendar`, `documents`, `feed_posts`); a thin `employee_timeline` table only for events with no source row. Tenant + self scoped. |
| **Signal registry** | `GET /signals` consolidating what `EssOperationalCenter` already computes (incomplete punch, OT risk, low leave, declaration due, doc expiry) into one typed list. |
| **Identity graph** | `GET /identity/:id` composing `employees` + `job_history` + `recognition` + derived service awards; self vs public projection. |
| **Intelligence** | reuse the shipped assistant tool-registry as the read substrate; add a ranking function for Home cards. |

**Exit:** three stable APIs (`/timeline`, `/signals`, `/identity`) the surfaces consume.
No module rewrite — these are projections + one thin events table.

---

## P3 — OS surfaces: Home, Timeline, Notifications, Search  *(Track B)*

**Goal:** the surfaces that make Home an OS, all reading P2's kernel.

| Surface | Build |
|---|---|
| **Home as composition** | Re-architect `EssHome` to render ranked kernel cards (from `/signals` + `/timeline`), not hard-coded sections. New module = new card type, no Home change. |
| **Activity Timeline** | New `pages/ess/EssTimeline.tsx` over `/timeline`; filterable, deep-linking, AI-annotated. |
| **Notification Center** | Unify the existing bell + `/notifications` into one inbox over the event spine with delivery-state + inline actions; one component for desktop dock + mobile tab. |
| **Universal Search** | Upgrade `components/operational/CommandPalette.tsx` into federated find + ask (routes to assistant); RBAC-scoped index. |

**Exit:** an employee can open Home and see a ranked, intelligent day; see their full
story in the Timeline; get every alert in one inbox; find/ask anything from one box.

---

## P4 — Ambient AI + Identity  *(Track B · builds on shipped assistant)*

**Goal:** AI disappears into screens; Profile becomes a story.

| Work | Build |
|---|---|
| **Ambient smart-strips** | A reusable `AiContextStrip` that any screen mounts, reading `/signals` for that context (Attendance→regularize, Leave→best type, Payroll→explain, Tax→remind, Recognition→suggest). |
| **Confirmed action-tier** | Extend the assistant tool-registry from read-only to *confirmed writes* (apply leave, regularize, raise ticket) via confirm-cards over existing endpoints, honoring the 402 write-gate. *(This is the blueprint's Phase-5 Act tier.)* |
| **Identity page** | Evolve `EssMyProfile` into the story page over `/identity`; self vs public views. |

**Exit:** intelligence reaches employees without opening chat; profiles tell a story.

---

## P5 — Community graph + Manager Operating Layer  *(Track B)*

**Goal:** community becomes a social graph; managers get a composed surface.

| Work | Build |
|---|---|
| **Community graph** | Extend `feed_posts` audience-scoping into selectable graphs (Team/Dept/Leadership/Location/Interest/Project); personalized ranking replaces pure chronology. | 
| **Celebration engine** | Reduced-motion-aware celebration moments triggered by timeline events (salary, promotion, anniversary, recognition, milestone). |
| **Manager Operating Layer** | Replace `/manager/team/*` sprawl with a manager Home over the kernel filtered to "my team": health, workload, risks, recognitions, celebrations, AI recommendations. |

**Exit:** Community pulls people in; managers lead from one intelligent surface.

---

## P6 — Predictive intelligence + Platform  *(horizon)*

**Goal:** reactive → predictive; the kernel gains new producers.

- Predictive signals (attrition risk, attendance-pattern alerts, recognition-equity
  gaps) layered onto the signal registry.
- Leadership operating layer (org engagement, townhall broadcast, culture metrics).
- New producers join the kernel: **Learning, Performance, Goals** — each emits events
  and signals, instantly appearing in Home/Timeline/Identity with no surface rewrite
  (the payoff of the kernel architecture).

---

## Phase → value → risk summary

| Phase | Delivers | Track | Risk |
|---|---|---|---|
| **P0** | "Feels like one product" | A | Low |
| **P1** | One nav, one request model | A | Med |
| **P2** | The kernel (Events/Signals/Identity) | B | Med |
| **P3** | Home-as-OS, Timeline, Notifications, Search | B | Med-High |
| **P4** | Ambient AI + Identity story | B | Med-High |
| **P5** | Community graph + Manager layer | B | High |
| **P6** | Predictive + new producers | B | High |

P0–P1 are the v1 blueprint (fast, safe, visible). P2 is the pivot from "cleaner ESS"
to "operating system." P3+ is the OS.

---

## Governance & guardrails (every phase)

- **Reuse-first:** modules are producers, not rewrites. New storage limited to a thin
  events table + read-models.
- **Scope & security:** tenant isolation + RBAC enforced server-side on every kernel
  API (the assistant tools already model this); writes honor the 402 write-gate.
- **No fabricated data:** every surface degrades to an honest empty-state.
- **One contract:** the colour/lint/token gate stays green; one template, one palette.
- **Independently shippable:** each phase stands alone; the product is never broken
  mid-roadmap.

---

## What we need decided before P0 (from Vision §11)

1. **Primary colour** — navy-primary/teal-accent on both platforms (recommended). *→ unblocks P0.*
2. **Manager routing** — collapse the 25 `/manager/self/*` duplicates. *→ unblocks P1.*
3. **Request hub** — FlowDesk as the single submit+track surface. *→ unblocks P1.*
4. **Kernel commitment** — agree the Events/Signals/Identity read-model approach (vs.
   continuing module-by-module). *→ unblocks P2 and everything after.*

Decisions 1–3 let Track A (P0–P1) start immediately. Decision 4 is the strategic one:
it's what turns a cleanup into the Employee Operating System.

---

*End of roadmap. Together with the Vision and UX Blueprint, this is the full plan:
why we're building it, how it works, and how we get there from the codebase we have.*
