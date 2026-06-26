# CognixHR — ESS Unification UX Blueprint

> **Purpose:** Audit-driven blueprint to redesign the existing ESS surface into **one
> continuous Employee Experience Cloud** — *without adding new features*. Every
> recommendation re-homes, standardizes, or connects screens that **already exist**.
>
> **Status:** PROPOSAL — for review before any implementation. Findings are grounded
> in a four-part code audit (IA/navigation, pillar screens, services screens,
> design-system/parity). Cited files are real.
>
> **Constraint honored:** No new modules. This is IA + interaction + visual +
> parity + engagement work over the current ~40 screens.

---

## 0. The one-sentence diagnosis

CognixHR ESS already has a **strong skeleton** (a `PageContainer → PageHeader →
SectionCard` template most screens obey) but **fragmented joints**: the landing page
breaks the template, the desktop and mobile speak two visual dialects, requests are
scattered across 9 screens, and ~25 screens have no real mobile form. It reads as
*many adjacent apps*, not *one operating system*. The fix is **unification, not
addition**.

---

## 1. What the audit found (grounded)

### 1.1 Information architecture
- **41 `/ess/*` routes + 43 `/manager/*` routes**, of which **~25 `/manager/self/*`
  duplicate ESS routes** rendering the same components in a different shell
  (`App.tsx`). A manager can reach `/ess/attendance` *or* `/manager/self/attendance`
  — same page, different chrome, shell remounts and recolors.
- **Consolidation debt:** 5+ legacy redirects (`/ess/dashboard`, `/ess/comp-off`,
  `/ess/leave/ledger`, `/ess/payroll/my-slips`, `/ess/declarations`, attendance
  variants). Old deep links survive but create redirect hops.
- **Confusable twins:** `/ess/issues` (EssHelpdesk — ticketing) and `/ess/hr-support`
  (EssHRSupport — FAQ) sit adjacent with near-identical labels; intent is unclear.
- **Orphan:** `/manager/team/attendance` renders an admin-grade page flagged in-code
  as inappropriate for managers; not in nav but still routable.
- **Flat breadth:** ~25 directly reachable ESS items with **no thematic grouping**.
  High-value screens are *buried* (no direct nav): **Benefits, FBP, HRA/TDS/
  Previous-Employer declarations, Operational Center, HR Support, Policies**.

### 1.2 Request fragmentation (the biggest functional seam)
**10 request types across 9 bespoke screens, no unified submission hub**, with
**inconsistent status enums**:

| Request | Screen | Status enum (note the drift) |
|---|---|---|
| Leave | EssLeaveBalance | pending/approved/rejected/withdrawn |
| Regularization | EssRegularization | pending/approved/rejected/withdrawn |
| WFH | EssWfh | pending/approved/rejected/**cancelled** |
| Comp-off | EssLeaveBalance (tab) | pending/approved/rejected |
| Advance | EssLoansAdvances | pending/approved/rejected/**paid** |
| Loan | EssLoansAdvances | pending/disbursed/active/closed |
| Reimbursement | EssReimbursements | draft/submitted/under_review/approved/rejected/paid |
| Asset | EssAssets | pending/approved/rejected/fulfilled/cancelled |
| FBP | EssFBP | draft/submitted/approved/rejected |
| Helpdesk | EssHelpdesk | open/in_progress/awaiting_employee/resolved/closed |

Plus **EssApprovals ↔ EssFlowDesk redundancy** — FlowDesk re-embeds EssApprovals in
its "My Requests" tab, so two routes answer "where are my requests?"

And **tax is split across 6 screens** (TaxPlanner, ITStatement, YTDStatement,
HRADeclarations, TDSRecovery, PreviousEmployer) — TaxPlanner was meant to unify but
the other five remain standalone deep links.

### 1.3 Interaction & visual consistency
- **EssHome is the escape hatch:** it does **not** use `PageContainer`/`PageHeader`
  and hand-rolls its own `Card` + KPI tiles (`EssHome.tsx:109`), duplicating
  `MetricCard`. **30+ hand-rolled `rounded-* border bg-card` tiles** exist across ESS
  despite `DESIGN_CONSISTENCY.md` forbidding it.
- **Cross-pillar drift:** section spacing varies `space-y-3 / 4 / 5`; **3 different
  empty-state patterns** (centered icon, success banner, text-only); body text
  oscillates `text-xs` vs `text-sm`; avatar color palettes differ per screen
  (5-color vs 8-color vs `primary/10`); loading is skeleton on Home, spinner-text
  elsewhere; **`#15B8A6` is hardcoded** instead of tokenized in Home/Community.

### 1.4 Desktop ↔ mobile (two dialects + parity holes)
- **Color seam:** desktop primary is **navy `#1A4D8F`**; mobile revives **royal-blue
  `#2E6FE6`** + glossy violet/teal/amber gradients (`glossy.ts`). Same product, two
  palettes. Legacy aliases make it worse (`--accent-teal` actually resolves to navy).
- **Parity holes:** **only ~8 screens are mobile-native**; **~25 fall back to the
  desktop page rendered inside the mobile shell** (`MobileEssShell` `<Outlet/>`),
  e.g. reimbursements, loans, assets, documents, tax, FBP, benefits, separation,
  profile — unusable forms/tables on a phone.
- **Mobile dead ends:** schedule, optional-holidays, onboarding, separation,
  operational-center have **no mobile entry point** at all.
- **Asymmetry:** payslip is a *tab* on desktop but a *top-level screen* on mobile.
- **No mobile type scale** — ad-hoc `text-[9px]…text-4xl`.

### 1.5 Engagement
Recognition badges/points exist but are **static**; there is exactly **one animated
element** (`animate-ping` on MobileHome). No streaks, no celebration moments, no
progress affordances — despite the data (attendance, service dates, recognition
points) already existing to power them.

---

## 2. The unification thesis

> Make ESS feel like **one OS** by enforcing **one template, one palette, one set of
> interaction primitives, one request model, and one navigation spine** across every
> screen and both form factors — reusing what's built.

Five unification moves, each mapped to the dimensions you named:

| Move | Fixes | Dimensions |
|---|---|---|
| **A. One navigation spine** | flat breadth, manager/self dup, buried screens | IA, navigation |
| **B. One request model** | 10 scattered flows, status drift, Approvals/FlowDesk dup | IA, contextual actions |
| **C. One page template** | EssHome escape hatch, hand-rolled cards, drift | interaction, visual hierarchy |
| **D. One visual system** | navy/blue seam, tokens, radius, mobile type scale | visual, responsiveness, parity |
| **E. One engagement layer** | static badges, no momentum | engagement |

---

## 3. Blueprint — Move A: One navigation spine

**Goal:** ≤5 primary destinations on each platform; everything else grouped, nothing
buried, no duplicate route to the same page.

**Desktop rail (pillars on top, grouped Services below a divider):**
```
PILLARS:   Home · Community · FlowDesk · Team · Rewards
SERVICES (grouped, collapsible):
  Work    → Attendance · Leave & Comp-Off · WFH · Schedule · Holidays
  Pay     → Pay & Payslips · Tax Hub · Reimbursements · Loans & Advances · FBP · Benefits
  Docs    → Documents · Letters · Assets · Policies · How-To
  Me      → Profile · Onboarding · Separation · Helpdesk · HR Support
PERSISTENT: ⌘K search · Assistant dock · Profile
```
- **Promote the buried:** Benefits, FBP, Tax Hub, Operational Center surfaced under a
  group (not deep-link-only).
- **Collapse the twins:** "Helpdesk" (ticketing) and "HR Support" (FAQ) become one
  **Support** entry with two tabs — kill the label confusion, keep both functions.
- **Kill `/manager/self/*` duplication:** one canonical ESS route set; the manager
  shell hosts the *same* ESS pages via persona, not a parallel route tree. Removes 25
  redundant routes and the shell-remount/recolor jank.
- **Mobile bottom nav stays 5:** `Home · FlowDesk · ＋Punch · Community · More` — but
  **"More" becomes a grouped Services index** (Pay / Work / Docs / Me), not a flat
  12-icon grid, and it badges pending counts.

**No feature added** — this is re-homing routes + grouping nav config
(`navigation.config.ts`, `EmployeeSidebar.tsx`, `MobileMore.tsx`).

---

## 4. Blueprint — Move B: One request model

**Goal:** one mental model for "ask for something" and "track what I asked."

- **Unify submission into FlowDesk → "Raise a Request":** a single launcher listing
  all 10 request types (leave, regularization, WFH, comp-off, advance, loan,
  reimbursement, asset, FBP, helpdesk). Each opens its **existing** form — no new
  forms, just one front door. EssFlowDesk already deep-links these; this elevates it
  to the canonical entry.
- **Resolve Approvals vs FlowDesk:** FlowDesk is the **only** "what's waiting / what I
  raised" surface; `/ess/approvals` becomes an internal component of FlowDesk, not a
  competing route.
- **Normalize a status vocabulary** for display (not the DB): map every enum to a
  shared 5-state lexicon — **Draft · Submitted · In Review · Approved · Closed**
  (rejected/cancelled/paid render as terminal variants of these) — via one
  `StatusBadge` mapping. Makes 10 flows *read* identically.
- **Consolidate the Tax Hub:** fold ITStatement/YTD/HRA/TDS/PreviousEmployer in as
  **tabs of TaxPlanner** (the page already aspires to this), so tax is one
  destination with one status tracker.

**No feature added** — same APIs, same forms; this is a launcher + a status-label
normalizer + tab consolidation.

---

## 5. Blueprint — Move C: One page template

**Goal:** every screen, including Home, obeys the same skeleton.

- **Bring EssHome into the system:** wrap it in `PageContainer`; replace the bespoke
  `Card` and KPI tiles with `SectionCard` + `MetricCard`/`MetricRow`. Keep the warm
  hero as a *themed PageHeader/Hero variant*, not a one-off.
- **Delete hand-rolled cards:** sweep the 30+ `rounded-* border bg-card` tiles
  (EssHome, EssLoansAdvances, EssPolicies, EssAssets, EssSeparation, …) onto
  `SectionCard`/`MetricCard`. Enforce via the existing colour/lint gate so it can't
  regress.
- **Standardize the three states:** one `EmptyState`, one `LoadingState`
  (skeleton), one `ErrorState` (card + retry) — used everywhere. Today there are 3
  empty, 2 loading, 3 error patterns.
- **Lock the type/spacing scale:** one section rhythm (pick `space-y-6` per the
  PageContainer default), one body size, one meta size — kill the `text-xs`/`text-sm`
  coin-flip.

**No feature added** — this is refactor-to-primitive + lint enforcement.

---

## 6. Blueprint — Move D: One visual system (and real parity)

**Goal:** desktop and mobile look like one product; every screen is usable on a phone.

- **Resolve the palette seam — decide one primary.** Recommend committing to the
  **navy `#1A4D8F` primary + teal `#15B8A6` accent** already chosen for desktop, and
  retuning `glossy.ts` so mobile gradients derive from navy/teal (royal-blue demoted
  to a decorative accent, not a second primary). Tokenize `#15B8A6` (no hardcodes).
- **Fix the misleading tokens:** rename/realign legacy aliases (`--accent-teal`
  currently = navy) and actually use `--elev-1/2/3` instead of inline shadows; pick
  one card radius.
- **Add a mobile type scale** to the token set so mobile stops using ad-hoc pixel
  sizes.
- **Close parity with a `MobilePageTemplate`:** instead of 25 desktop fallbacks,
  introduce *one* responsive mobile wrapper that renders the existing screen's data
  in a phone-friendly stack (cards not tables, sheets not modals). Prioritize the
  high-traffic fallbacks first: Reimbursements, Loans, Assets, Documents, Profile,
  Benefits/FBP, Tax. Add mobile entry points for the current dead ends (schedule,
  optional-holidays, onboarding, separation).
- **Payslip asymmetry:** make payslip the same depth on both (a tab on both, or a
  screen on both) — pick one.

**No feature added** — token cleanup + a shared responsive wrapper over existing data.

---

## 7. Blueprint — Move E: One engagement layer (from existing data)

**Goal:** moments of momentum, built only from data already in the system.

- **Streaks** from attendance punches (e.g., on-time streak) — surfaced on Home.
- **Celebration moments** (reduced-motion-aware) when a request is approved, a kudos
  is received, a service anniversary hits — all events that already fire.
- **Progress affordances:** onboarding readiness, leave-year utilization,
  recognition-points-to-next-badge — all derivable from existing fields.
- **Proactive AI hooks (no new tools):** the assistant + Operational Center already
  compute "low leave balance", "incomplete punch", "OT warning" — surface these as
  *contextual nudges* on Home and inline on the relevant screen, instead of a hidden
  page.

**No feature added** — these are presentations of existing signals.

---

## 8. Contextual actions & proactive AI (cross-cutting)

- **Put the action where the data is:** every snapshot tile (leave, payslip, pending
  approval, asset) gets an inline primary action, so Home and Profile become *do*
  surfaces, not just *view* surfaces. (Home already half-does this with KPI links —
  standardize it.)
- **Assistant as the universal action front door:** the read-only assistant (shipped)
  plus a future confirmed *act tier* (blueprint Phase 5) becomes the cross-screen
  "just ask" path — but even today it can deep-link to the right screen, replacing
  navigation hunting.
- **Operational Center → ambient, not a page:** its computed risks belong on Home/the
  relevant screen as nudges, not buried at `/ess/operational-center`.

---

## 9. Phasing (each step independently shippable, all reuse-only)

| Phase | Move | Scope | Risk |
|---|---|---|---|
| **P0 — Consistency sweep** | C, D | EssHome → template; kill hand-rolled cards; one Empty/Loading/Error; tokenize `#15B8A6`; lint-gate it | Low — visual refactor |
| **P1 — Navigation spine** | A | Group nav (desktop + mobile "More"); promote buried screens; merge Helpdesk/HR-Support; collapse `/manager/self/*` | Med — routing |
| **P2 — Request model** | B | FlowDesk "Raise a Request" launcher; Approvals→component; status-label normalizer; Tax Hub tabs | Med — IA |
| **P3 — Palette + parity** | D | Commit one primary; retune glossy; `MobilePageTemplate` for top fallbacks; mobile dead-end entry points | Med-High — broad |
| **P4 — Engagement** | E | Streaks, celebration moments, progress, ambient nudges | Low-Med — additive presentation |

P0 alone makes the product *feel* unified; P1–P2 remove the structural fragmentation;
P3 closes the device gap; P4 adds the daily-pull.

---

## 10. Explicit guardrails (so this stays "no new features")

- Every recommendation maps to an **existing screen, route, component, or API**.
- New *components* are limited to **shared primitives** (`EmptyState`, `ErrorState`,
  `MobilePageTemplate`, a status-label map) — these *reduce* code, not add features.
- No new business logic, no new endpoints, no new data the platform doesn't already
  compute.
- The 402 write-gate, tenant scoping, and the colour/lint contract remain in force.

---

## 11. What I recommend deciding first (before implementation)

1. **Primary colour:** commit to navy-primary/teal-accent across both platforms
   (recommended) vs. royal-blue. This unblocks Move D.
2. **Manager routing:** approve collapsing `/manager/self/*` into persona-hosted ESS
   routes (removes 25 duplicate routes).
3. **Request hub home:** confirm FlowDesk as the single submit + track surface
   (Approvals becomes a component).
4. **Phase order:** confirm P0 (consistency sweep) ships first as the fastest
   "feels like one product" win.

Once these four are decided, P0 can begin immediately — it's mechanical and low-risk.

---

*End of blueprint. This document proposes structure only; no screens have been
changed. Implementation begins after sign-off on §11.*
