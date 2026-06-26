# CognixHR Experience Cloud — UX Blueprint (v2)

> **Document 2 of 3.** The *how it works* — architecture, surfaces, interaction,
> and how every existing module connects into one ecosystem.
> Companion docs: **Vision** (why) · **Implementation Roadmap** (build plan).
> Supersedes `ESS_UX_UNIFICATION_BLUEPRINT.md` at the *vision* level; that v1 doc
> remains the concrete near-term cleanup the Roadmap's P0 executes.
>
> **Status:** FROZEN — architectural foundation. Governed by `COGNIXHR_PRODUCT_MANIFESTO.md`.
> Grounded in the four-part ESS audit; cited files are real. Changes require explicit,
> recorded amendment.

---

## 1. Architecture: kernel + surfaces

The product is **one kernel** feeding **seven surfaces** that compose across the
existing modules.

```
SURFACES (what the employee experiences)
  Home · Activity Timeline · Universal Search · Notification Center ·
  Identity · Community Graph · Ambient Assistant
        ▲
        │  read-models / compositions
KERNEL (the OS)
  Events  ·  Signals  ·  Identity Graph  ·  Intelligence
        ▲
        │  produce events / expose signals
MODULES (the depth — already built)
  Attendance · Leave · Payroll · Recognition · Requests(FlowDesk) ·
  Community · Documents · Onboarding · Separation · Benefits · Tax …
```

### 1.1 The kernel, concretely
- **Event spine** — a unified, append-only employee-event stream. Most events already
  exist trapped in module tables (`attendance_logs`, `leave_requests`,
  `payroll_runs`, `recognition`, `holiday_calendar`, `feed_posts`). The kernel is a
  **read-model/projection** over them (plus a thin `employee_timeline` for events with
  no natural home), *not* a rewrite of those tables.
- **Signal registry** — current truths each module computes (low leave balance,
  incomplete punch, OT risk, declaration due, probation ending). `EssOperationalCenter`
  already computes a cluster of these; the kernel exposes them through one API so any
  surface can render them.
- **Identity graph** — person + role + org position + manager + reports + skills +
  badges + milestones, composed from `employees`, `job_history`, `recognition`,
  derived service awards.
- **Intelligence** — ranking + recommendations over the three above. The shipped
  read-only assistant + its 14 tools are the first organs; ambient suggestions and
  the confirmed action-tier are the next.

**Design rule:** surfaces never query modules directly for cross-module composition —
they read the kernel. Modules remain the system of record; the kernel is the system of
*experience*.

---

## 2. Surface 1 — Home (the Operating System)

Home is **not** a widget board. It is a **ranked composition** of the kernel: a single
prioritized stream that answers three questions, in this order of human urgency:

1. **What needs me?** (pending approvals, declarations due, incomplete punch, expiring
   docs) — actionable cards with inline one-tap actions.
2. **What's happening to me today?** (shift, attendance state, salary released,
   approvals granted) — the day's state.
3. **What's worth feeling?** (a teammate's anniversary, kudos received, a milestone) —
   the human layer.

### 2.1 Composition model
- Home renders **cards emitted by the kernel**, each with: a priority score, a type, a
  primary action, and an optional AI annotation. New module = new card type; Home code
  doesn't change. This kills the current pattern where Home (`EssHome.tsx`) hard-codes
  every section and hand-rolls its own `Card`.
- **Ranking, not stacking:** an urgent approval outranks a birthday today; tomorrow,
  with nothing pending, the birthday rises. Deterministic v1 ranking
  (urgency × recency × relevance), ML-ready later.
- **Greeting + identity strip** stays (it's good) but becomes a themed
  PageHeader/Hero variant, inside the standard template — not an escape hatch.

### 2.2 Contextual actions everywhere
Every snapshot tile is a *do* surface: leave tile → "Apply"; missed-punch signal →
"Regularize" (AI pre-fills); payslip tile → "Why did this change?" (AI explains).
Home becomes the place work *starts*, not just where it's summarized.

---

## 3. Surface 2 — The Personal Activity Timeline

One chronological story of the employee's work life, projected from the event spine.

- **Content:** Checked in · Leave approved · Salary released · Kudos received ·
  Birthday/anniversary · Policy updated · Expense approved · Document expiring ·
  Training assigned — every module contributes.
- **Form:** a reverse-chronological, filterable timeline ("Today / This week / Pay /
  Recognition / Approvals"). Each entry deep-links to the source screen and carries an
  optional AI note ("Your net pay rose ₹2,400 — here's why").
- **Why it matters:** it is the employee's *memory* of their company. No competitor
  has a true cross-module personal timeline. It also becomes the substrate for
  celebrations (Surface 7) and the Notification Center (Surface 4) — same spine, three
  renderings.

---

## 4. Surface 3 — Universal Search

Search becomes a **primary capability and an AI entry point**, upgrading the existing
`CommandPalette` (⌘K).

- **Federated index:** people, policies, documents, requests, payroll items, leave,
  reimbursements, recognition, announcements, assets, learning.
- **Two modes in one box:** *find* (federated results, RBAC-scoped) and *ask* (routes
  to the assistant). Typing "leave balance" finds the screen *and* offers the answer.
- **Scoped by identity:** results respect role/scope server-side (the assistant tools
  already enforce this) — an employee searches their world, a manager their team.
- **Keyboard-first on desktop, prominent on mobile** — search is how navigation
  "disappears."

---

## 5. Surface 4 — One Notification Center

Every module's signals arrive through **one inbox**, replacing scattered per-module
notifications and the lone bell.

- **Sources:** tasks, approvals, payroll, attendance, leave, recognition, community,
  leadership announcements, AI nudges, HR.
- **Model:** a notification is an event with a delivery state (unread / read / acted).
  Same spine as the Timeline — the Timeline is "what happened," Notifications is "what
  happened that wants my attention."
- **Actionable:** approve, regularize, acknowledge, view — inline, without leaving the
  center. Grouped by type, with smart digesting (no notification spam).
- **One consistent experience** across desktop dock and mobile tab.

---

## 6. Surface 5 — Identity (Profile as a story)

`EssMyProfile` evolves from an HR record into a **LinkedIn-grade enterprise identity
page** — composed from the identity graph.

- **The story:** avatar + role + org position + manager/reports, then **achievements,
  badges, recognition received, skills, learning, service milestones, awards, career
  journey** (from `job_history`), and documents/position.
- **Two audiences, one page:** a *self* view (with the private HR data tabs that
  already exist) and a *public* view teammates see (the story, no sensitive data) —
  scope enforced server-side.
- **It tells who someone is**, not just what HR stores. This is the identity lineage
  (LinkedIn) made enterprise-safe.

---

## 7. Surface 6 — Community as a social graph

Community evolves from a chronological feed (`EssCommunity` / `feed_posts`) into an
**audience-scoped, personalized social graph**.

- **Graphs, not one wall:** My Team · My Department · Leadership · Location
  (store/warehouse/site) · Company · Communities of Interest · Projects. The feed
  schema already carries audience scope — this builds on it.
- **Personalized ranking** (relevance + relationship + recency + type weight), not
  pure chronology. Leadership/townhall pin; recognition and milestones surface.
- **Recognition flows through it:** kudos are first-class posts; celebrations
  originate here and echo to Home and the Timeline.
- **Governed:** moderation, audience scoping, profanity guard — already partially
  built; extended, not invented.

---

## 8. Surface 7 — The Ambient Assistant (AI that disappears)

AI stops being only a floating widget and becomes a **layer present in every screen**.

- **Inline intelligence:** each screen renders a context "smart strip" from the signal
  registry — Attendance suggests regularization; Leave recommends the optimal leave
  type; Payroll explains a delta; Tax reminds about declarations; Recognition suggests
  who to appreciate; Community recommends a post.
- **Confirmed action-tier:** suggestions are *actionable* — "Regularize yesterday's
  missing checkout?" → confirm card → existing write endpoint (respecting the 402
  write-gate). Builds directly on the assistant + tool registry already shipped.
- **The chat is the fallback, not the front door.** The persistent dock/tab remains
  for open-ended asks; most intelligence reaches the employee *without* opening it.
- **Grounded & scoped:** answers come only from kernel/module data the user may see;
  never fabricated; tenant + role enforced server-side.

---

## 9. The Manager Operating Layer

Managers get a **composed surface**, not an approvals queue — the kernel filtered to
"my team."

- **Team health at a glance:** attendance, workload balance, leave coverage, pending
  approvals, recognitions given/received, risks (attrition/OT/absence signals),
  birthdays & celebrations, AI recommendations ("3 reports have no kudos this quarter").
- **One persona, one shell:** the existing persona toggle stays; this replaces the
  fragmented `/manager/team/*` sprawl with a manager Home that orbits the same kernel.
- **Leadership variant later:** org-wide engagement, townhall broadcast, culture
  metrics — same pattern, wider scope.

---

## 10. How every existing module connects (the ecosystem map)

| Module | Produces (events) | Exposes (signals) | Surfaces it feeds |
|---|---|---|---|
| Attendance | checked in/out, regularized | incomplete punch, OT risk, late streak | Home, Timeline, Ambient AI, Notifications, Manager |
| Leave | applied/approved/rejected | low balance, expiring leave, coverage gap | Home, Timeline, Notifications, Manager, Ambient AI |
| Payroll | salary released, payslip ready | net-pay delta, LOP impact | Home, Timeline, Notifications, Ambient AI (explain) |
| Tax | declaration submitted | declaration due, regime election | Home, Notifications, Ambient AI |
| Recognition | kudos given/received, badge | recognition gap (manager) | Community, Identity, Home, Timeline, Celebrations |
| FlowDesk/Requests | request raised/decided | pending on me / pending mine | Home, Notifications, Manager, Timeline |
| Community | post, reaction, comment | relevant post, mention | Community graph, Home, Notifications |
| Documents | doc added/expiring | expiry alert | Home, Notifications, Timeline |
| Onboarding | task done, readiness | onboarding incomplete | Home, Timeline, Notifications |
| Identity/Org | role change, milestone | anniversary, promotion | Identity, Timeline, Celebrations, Community |

Every module becomes a **producer into the kernel**; no module is a dead-end page.

---

## 11. Information architecture (reconciling v1 cleanup with the OS)

The v1 unification blueprint's IA (grouped Services, one request hub, Tax Hub,
collapse `/manager/self/*`) is **still correct** — but reframed: pillars and Services
become *entry points into the kernel's surfaces*, not destinations.

```
PRIMARY (both platforms, ≤5):  Home · Community · FlowDesk · Team · Rewards
PERSISTENT (cross-cutting):     Universal Search · Notification Center · Assistant · Identity
SERVICES (grouped, on-demand):  Work · Pay · Docs · Me  (the existing deep modules)
```

The deep modules don't disappear — they recede. You reach them by *intent* (search,
an AI suggestion, a Home card, a notification), not by hunting a menu.

---

## 12. Interaction & visual system (one product, every device)

This is where v1's findings become non-negotiable foundations for the OS:

- **One template:** every surface and screen obeys `PageContainer → PageHeader →
  SectionCard` + `MetricCard`; Home stops being an escape hatch; the 30+ hand-rolled
  cards are removed and lint-gated.
- **One palette:** resolve the desktop-navy vs mobile-royal-blue seam — commit to navy
  primary + teal accent on both platforms; tokenize every color (no `#15B8A6`
  hardcodes); fix the misleading legacy aliases.
- **One state system:** a single `EmptyState`, `LoadingState`, `ErrorState`.
- **Real parity:** a shared `MobilePageTemplate` so the ~25 desktop-fallback screens
  become phone-native; mobile dead-ends get entry points.
- **Emotional design (Surface 7's sibling):** a celebration engine, reduced-motion
  aware, triggered by timeline events — salary released, promotion, anniversary,
  recognition, milestone. Premium and subtle; never confetti-for-confetti.

---

## 13. Design principles (the guardrails)

1. **Compose, don't add pages.** New value = a new card type / signal / event, not a
   new destination.
2. **Surfaces read the kernel; modules own the data.** Never cross-query modules from a
   surface.
3. **Action lives next to information.** Every tile can *do*, not just show.
4. **AI is ambient first, conversational second.**
5. **One product on every device** — same palette, same template, same primitives.
6. **Calm over dense; warm over corporate; fast always.**
7. **Governance is invisible but absolute** — RBAC, tenant scope, write-gate,
   no fabricated data.

---

*Next: the Implementation Roadmap sequences this against the real codebase — what's a
read-model over existing tables, what's net-new, and in what order.*
