# CognixHR — Experience Cloud (ESS 2.0) Blueprint

> **Status:** LOCKED design contract. We agreed this; we do not deviate without an
> explicit, recorded change. Build phases reference section numbers here.
>
> **Product line:** CognixHR — "Smarter Workforce. Stronger Future." (Saar HRMS).

---

## 0. Agreed constraints (the contract)

These were decided up front and govern every decision below.

1. **Brand stays CognixHR.** ESS 2.0 uses the existing **royal-blue `#2E6FE6` +
   teal `#15B8A6` + navy `#1A4D8F`** system (`apps/web/src/lib/brand-config.ts`,
   `apps/web/src/components/mobile/glossy.ts`). The "warm/human" feeling is
   delivered through **layout, whitespace, imagery, motion, micro-copy and
   content** — NOT a palette swap. The cream/plum/terracotta palette in the
   original brief is **retired** for this work. ESS must look like the same
   product as admin/manager.
2. **Evolution, not rebuild.** The experience layer (Home / Community / Team /
   Rewards / Assistant) **consumes existing modules as services** (Leave,
   Attendance, Payroll, FlowDesk-over-approvals, Rewards-new, AI-new). We do not
   re-plumb working modules.
3. **Blueprint before build.** This document is signed off before any pillar
   ships. Each build phase implements a named section here.
4. **Phasing reality:** Home + Team reuse existing code (fast). Community,
   Rewards, AI Assistant are net-new and backend-heavy (later phases).
5. **Mobile Phase 1 is a foundation, not a throwaway.** We extend
   `components/mobile/*` (shell, bottom nav, `glossy.ts`, 8 screens), we do not
   rewrite it.

### 0.1 Pre-req: brand unification (must land before/with Phase 1)
Desktop ESS CSS var `--primary` is **navy `#1A4D8F`** (`apps/web/src/index.css`),
but mobile Phase 1 + `brand-config.ts` use **royal-blue `#2E6FE6` + teal**. This
is the seam that makes desktop and mobile feel like one product.

> **Amendment (recorded change to the locked contract).** The original direction
> was to standardize on the royal-blue→teal system (move desktop *off* navy). This
> was **inverted by product decision**: we unify **toward the desktop navy
> `#1A4D8F`** instead. Scope of the first pass (agreed):
> - **Mobile header + primary CTA buttons → navy `#1A4D8F`** (`glossy.ts`
>   `HEADER_GRADIENT`, the centre punch FAB, active-tab tint, the punch-in and
>   apply-leave buttons). Desktop already uses navy, so it is unchanged.
> - **Teal `#15B8A6` stays the accent** (badges, secondary glossy stop).
> - **Mobile UI surfaces only** — the exported `BRAND_BLUE` token, the CognixHR
>   wordmark, and the marketing site keep royal-blue (untouched).
> - Decorative royal-blue chips/tiles on mobile are intentionally left for a later
>   pass (not "all royal-blue → navy").

---

## 1. Information Architecture

ESS 2.0 is organized as **5 pillars + a services drawer**. The pillars are the
emotional/daily surface; the services drawer holds the deep (existing) HR
transactions so nothing we already built is orphaned.

```
EXPERIENCE CLOUD
├── HOME            ← default landing (NOT attendance/leave/payroll)
│   ├── Greeting + Today's Work Snapshot
│   ├── Personal HR Snapshot
│   ├── Quick Actions
│   └── Surfaced cards: pending approvals, recognition, announcements
├── COMMUNITY       ← social feed (net-new)
│   ├── Recognition posts · anniversaries · birthdays · new joiners
│   ├── Leadership messages · company news · townhalls · policy updates
│   └── Reactions · comments · share-internally
├── FLOWDESK        ← unified Tasks / Approvals / Requests (shell over existing APIs)
│   ├── My Tasks
│   ├── Approvals (manager/HR)  → existing /approvals/pending + per-domain
│   └── Raise a Request          → leave/regularize/claim/asset/IT/HR
├── TEAM            ← team visibility (reuse EssTeam/EssTeamOff/MobileTeam)
│   ├── Who's present/leave/remote/travelling/new
│   └── Manager: team attendance · leave calendar · approvals · recognition
├── REWARDS         ← recognition & points (net-new)
│   ├── Give kudos · nominate · badges · points · leaderboard
│   └── Service awards · milestones
└── SERVICES DRAWER ← all existing deep HR (mapped, not rebuilt)
    ├── Work:      Attendance · Leave & Comp-Off · Schedule · WFH · Holidays
    ├── Pay:       Compensation · Tax & Declarations · Reimbursements · Loans · FBP · Benefits
    ├── Documents: My Documents · Letters · Assets · Policies · How-To Guides
    └── Me:        Profile · Onboarding · Separation · HR Support · Helpdesk
```

**Cross-cutting:** AI Assistant (Pillar 5) is **persistent**, not a nav
destination — bottom-right panel on desktop, dedicated tab on mobile.

### 1.1 Existing-route mapping (nothing orphaned)
Every current `/ess/*` route (35 routes, `App.tsx:980-1038`) keeps working and is
reachable. The new IA re-homes them:

| New home | Existing routes folded in |
|---|---|
| Home (surfaced) | `/ess/dashboard` becomes Home; attendance/leave/pay surfaced as cards |
| FlowDesk | `/ess/approvals`, `/ess/wfh`, `/ess/loans`, `/ess/reimbursements` (raise/track) |
| Team | `/ess/team`, `/ess/whos-off` |
| Services → Work | `/ess/attendance`, `/ess/leave/balance`, `/ess/schedule`, holidays |
| Services → Pay | `/ess/compensation`, `/ess/salary*`, `/ess/fbp`, `/ess/benefits` |
| Services → Docs | `/ess/documents`, `/ess/letters`, `/ess/assets`, `/ess/policies`, `/ess/runbooks` |
| Services → Me | `/ess/profile`, `/ess/onboarding`, `/ess/separation`, `/ess/hr-support`, `/ess/issues` |

---

## 2. Desktop Wireframe Structure

Three-zone workspace (LinkedIn + Slack + enterprise), reusing `EssShell` +
`Topbar`, replacing `EmployeeSidebar` groups with a pillar rail.

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOPBAR  Cognix▸HR  ⌘K search        🔔  Theme  ▾Avatar (existing Topbar)  │
├──────────┬──────────────────────────────────────────────┬──────────────┤
│ LEFT RAIL│  CENTER (dynamic)                            │ RIGHT CONTEXT │
│          │                                              │               │
│ ⌂ Home   │  ┌── HOME ──────────────────────────────┐    │ 🎂 Birthdays  │
│ ◇ Comm-  │  │ Good morning, Suraj                   │    │ 📢 Announce-  │
│   unity  │  │ ┌Work Snapshot┐ ┌HR Snapshot┐         │    │    ments      │
│ ☑ Flow-  │  │ │shift·status ││leave·salary│         │    │ ⚡ Quick      │
│   Desk   │  │ │hours·tasks  ││holidays·svc│         │    │    Actions    │
│ ⛹ Team   │  │ └────────────┘ └───────────┘         │    │ 🏖 Holidays   │
│ ★ Rewards│  │ [Quick Actions row]                   │    │ 🏅 Recognition│
│ ───────  │  │ ┌Pending Approvals┐ ┌Recognition┐     │    │ ✅ Approvals  │
│ Pay      │  │ └─────────────────┘ └───────────┘     │    │               │
│ Docs     │  └──────────────────────────────────────┘    │ (context-aware│
│ Learning │                                              │  per pillar)  │
│ ───────  │                                              │               │
│ 🤖 Assist│                                              │               │
│ ◔ Profile│                                              │               │
└──────────┴──────────────────────────────────────────────┴──────────────┘
                                            🤖 Assistant dock (bottom-right) ▸
```

- **Left rail:** pillars on top, Services groups below a divider, Assistant +
  Profile pinned bottom. Reuses the collapsible-group + live badge logic already
  in `EmployeeSidebar.tsx:157-193` (pending-approval count).
- **Center:** per-pillar content. Home composes existing widgets
  (`EmployeeDashboard`, MetricCard/MetricRow).
- **Right context panel:** new, context-aware. Widgets are small, reusable cards
  (Birthdays, Announcements, Quick Actions, Holidays, Recognition, Approvals).
- **Assistant dock:** persistent collapsible panel, bottom-right (Pillar 5).

---

## 3. Mobile Wireframe Structure

Extends Phase 1 (`components/mobile/*`). The current bottom nav
(`MobileBottomNav.tsx`: Home/Attendance/Leave/Payslip/More) **migrates** to the
ESS 2.0 tabs. Attendance/Leave/Payslip are **demoted from primary nav** into Home
cards + the Services area (exactly per brief).

```
Phase 1 tabs:   Home · Attendance · Leave · Payslip · More
ESS 2.0 tabs:   Home · FlowDesk · [＋punch] · Community · Assistant   (Profile in header)
```

```
┌─────────────────────────────┐   Home (mobile)
│ ◐ Good morning, Suraj    🔔 │  glossy blue→teal header (existing HEADER_GRADIENT)
├─────────────────────────────┤
│ ┌Today┐  Shift · In 09:02   │  ← reuse MobileHome punch + today
│ │card │  Hours 6:20         │
│ └─────┘                     │
│ ┌Leave┐┌Salary┐┌Tasks ┐     │  ← contextual cards (was primary nav)
│ │12.5 ││✓Paid ││ 3 due│     │
│ └─────┘└──────┘└──────┘     │
│ [Apply][Regularize][Claim]  │  ← quick actions (FAB-adjacent)
│ ── Recognition ───────────  │
│ 🏅 Priya → Customer Champ   │
│ ── Announcements ─────────  │
│ 📢 Townhall Fri 4pm         │
├─────────────────────────────┤
│  ⌂      ☑      ＋     ◇   🤖 │  Home·FlowDesk·Punch·Community·Assistant
└─────────────────────────────┘
```

- **Keep:** `MobileEssShell` (header, persona toggle), `glossy.ts`, GPS/selfie
  punch (`MobileAttendance`), the `MobileRouter` fallback-to-`<Outlet>` pattern so
  un-migrated routes still render the desktop page.
- **Add tabs:** FlowDesk, Community, Assistant. **Demote:** Attendance/Leave/
  Payslip become Home cards + entries in a refreshed `MobileMore`/Services.
- **Center FAB:** keep quick-punch (highest-frequency action), per Phase 1.
- **Thumb-first:** Community feed is single-column, large tap targets, reactions
  inline.

---

## 4. Navigation Architecture

| Surface | Primary nav | Secondary | Persistent |
|---|---|---|---|
| **Desktop** | Left rail: Home, Community, FlowDesk, Team, Rewards | Services groups (Pay/Docs/Learning) below divider | Assistant dock, ⌘K search, Profile |
| **Mobile** | Bottom nav: Home, FlowDesk, ＋Punch, Community, Assistant | Services grid in Home / More | Profile in header, persona toggle (managers) |

**Rules:**
- Home is always the default landing (replaces dashboard-first).
- Attendance/Leave/Payroll are **never** primary nav items — surfaced in Home +
  Services (brief-mandated).
- Managers get a Me/Team persona toggle (already in `MobileEssShell.tsx:68-82`
  and `ManagerPersonaToggle` desktop) — Team pillar + manager widgets appear only
  in Team persona.
- ⌘K command palette (`components/operational/CommandPalette.tsx`) is retained
  and later upgraded into the Assistant entry point.

---

## 5. Feed Architecture (Community — net-new)

A single ranked feed of typed posts. **No existing reusable feed**
(`ActivityFeed.tsx` is operational events only).

**Post types:** `recognition`, `anniversary`, `birthday`, `new_joiner`,
`leadership`, `announcement`, `townhall`, `policy_update`, `achievement`,
`milestone`.

**Composition:** auto-generated posts (anniversaries, birthdays, new joiners,
recognitions flow in from the Rewards engine) + authored posts (leadership/HR via
an admin composer).

**Ranking (v1, deterministic — no ML):** recency + audience match (org/dept/site)
+ type weight (leadership/townhall pinned) + engagement. Tenant-scoped, audience-
scoped (company / department / site / team).

**Interactions:** `like`, `appreciate`, `celebrate`, `comment`, `share_internally`.
Reuse the comment pattern from `helpdesk_ticket_comments` as the schema precedent.

**Moderation:** HR/admin can pin, hide, or remove; report-post flow; profanity
guard on comments.

**Surfaces:** full feed in Community pillar; top 2-3 cards surfaced in Home;
recognition posts also appear in Rewards.

---

## 6. Recognition Architecture (Rewards — net-new)

First-class, feed-integrated. **No existing R&R code.**

**Primitives:**
- **Kudos / Appreciation** — peer-to-peer, lightweight, optional badge + message.
- **Nomination** — structured nomination toward an award (manager/committee
  approval).
- **Badges** — `Ownership Champion`, `Customer Hero`, `Team Player`, `Innovator`,
  `Problem Solver`, `Culture Ambassador` (configurable per tenant).
- **Points** — earned from received recognition; budgeted monthly per giver to
  prevent inflation.
- **Service awards / milestones** — auto-generated from `employees.joining_date`.
- **Leaderboard** — opt-in, dept/team scoped, time-boxed (avoid permanent
  ranking pressure — enterprise-grade, not gamified-childish).

**Flow:** give kudos → creates recognition record → emits a `recognition` feed
post → credits points → optional badge. All tenant-scoped, audience-aware.

**Governance:** budgets, approval matrix for nominations (reuse the
`approval_matrices`/`approval_workflow_config` pattern), redemption policy (points
→ catalogue) deferred to a later phase.

---

## 7. AI Assistant Experience (net-new; one backend stub exists)

Persistent **Cognix Assistant**, action-oriented (not just informational).

- **Desktop:** bottom-right collapsible dock. **Mobile:** dedicated tab.
- **Entry point reuse:** upgrade `CommandPalette` (⌘K) into the assistant launcher
  (it already has the shell + a nav-target registry to reuse).
- **Backend reuse:** `apps/api/src/platform/ai/services/explainability.service.ts`
  is a stub ("wire to Anthropic Claude"); LLM wiring already exists for onboarding
  doc-extraction (`lib/onboarding/extraction-engine.ts`, Anthropic/OpenAI). We
  reuse that provider plumbing — default to the latest Claude model.

**Capability tiers:**
1. **Answer (read):** "How many leaves do I have?", "Why is my salary lower this
   month?", "Show last month's attendance", "Who approved my request?", "What
   policies apply to me?" — backed by existing ESS read APIs.
2. **Act (write, confirmed):** "Create a leave request", "Regularize yesterday",
   "Raise an IT ticket", "Submit a claim" — assistant composes the payload, shows
   a confirm card, then calls the existing write endpoint (respecting the 402
   licensing write-gate in `apps/api/src/plugins/auth.ts`).
3. **Guide:** deep-links into the right ESS screen when an action needs full form.

**Tool-routing:** a server-side action registry maps intents → existing endpoints
(leave-apply, regularization, reimbursement, helpdesk-create). No new business
logic — the assistant is a conversational front-end over existing APIs.

**Safety:** every write requires explicit user confirmation; assistant never
fabricates HR data (answers grounded in API responses); tenant + employee scope
enforced server-side, never trusted from the prompt.

---

## 8. User Journeys

1. **Daily open (the core loop):** land on Home → see greeting, today's punch
   state, 3 tasks due, 1 pending approval, a teammate's anniversary → tap
   "Appreciate" → one-tap kudos posts to feed. *Goal: a reason to open daily that
   isn't a transaction.*
2. **Apply leave (assistant):** "Apply 2 days casual next Mon-Tue" → assistant
   shows confirm card with balance impact → confirm → existing `/leave-requests`
   POST → appears in FlowDesk + Home.
3. **Get recognized:** manager gives "Customer Hero" badge → recognition post in
   feed → employee gets a celebration animation + points → milestone surfaced in
   Home.
4. **Manager approval:** Team persona → FlowDesk Approvals shows team's pending
   leave/regularization (existing `/approvals/pending`) → swipe-approve on mobile
   (reuse `MobileTeam` bulk-approve).
5. **New joiner:** first login → onboarding journey (`EssOnboarding`) + auto
   "Welcome" feed post → Home nudges profile completion + first kudos.
6. **Payday:** salary-credited → Home "Salary ✓ Paid" card → tap → payslip
   (`EssCompensation`/`MobilePayslip`) → "Why lower?" → assistant explains deltas.

---

## 9. Persona-Based Experiences

| Persona | Home emphasis | Pillars they live in | Net-new for them |
|---|---|---|---|
| **Employee** | Personal snapshot, tasks, recognition received, community | Home, Community, Rewards, Assistant | feed, kudos, assistant |
| **Manager** | Team availability, approvals queue, team recognition | Team, FlowDesk + employee pillars (persona toggle) | team feed, give-recognition budget |
| **HR** | Org pulse, announcements composer, recognition program health | Community (compose), Rewards (admin), existing admin | feed moderation, R&R program admin |
| **Leadership** | Org-wide engagement, townhall broadcast, recognition culture metrics | Community (broadcast), Executive Intelligence (existing) | leadership broadcast, engagement KPIs |

Persona is derived from role + the existing persona toggle; one identity, one
shell, persona swaps the surface (no remount — the pattern we already use).

---

## 10. Enterprise UX Best Practices (applied here)

- **Consistency:** reuse canonical `MetricCard`/`MetricRow`, `PageHeader`,
  `SectionCard`, `glossy.ts` — ESS 2.0 obeys the same design-token contract
  (`DESIGN_CONSISTENCY.md`); colour-lint gate stays green.
- **Performance:** Home is a single aggregated read (one "home" endpoint) not N
  waterfall calls; feed is cursor-paginated; assistant streams.
- **Accessibility:** WCAG AA contrast on the blue/teal system, keyboard-navigable
  rail + ⌘K, reduced-motion honored for celebration animations.
- **Density with warmth:** high-information but breathable; warmth from imagery,
  avatars, motion, micro-copy — not chrome.
- **Progressive disclosure:** pillars shallow, Services deep; never more than 5
  primary destinations on either platform.
- **Trust:** assistant confirms writes; recognition has anti-gaming budgets; feed
  has moderation. Enterprise-grade, not consumer-gamified.
- **Resilience:** every new surface degrades to an empty-state (no fabricated
  data) — the house rule we already enforce.

---

## 11. Detailed Component Inventory

**Reuse (exists):** `EssShell`, `MobileEssShell`, `MobileBottomNav`, `glossy.ts`,
`Topbar`, `MetricCard`/`MetricRow`, `PageHeader`, `SectionCard`, `Avatar`,
`CommandPalette`, `EmployeeDashboard`, all 8 mobile screens, `EssApprovals`,
`ApprovalInbox`, `EssTeam`/`EssTeamOff`/`MobileTeam`.

**Net-new:**
- Layout: `ExperienceRail` (left), `ContextPanel` (right), `AssistantDock`.
- Home: `HomeGreeting`, `WorkSnapshotCard`, `HRSnapshotCard`, `QuickActionsRow`,
  `SurfacedFeedStrip`, `SurfacedApprovals`.
- Community: `FeedList`, `FeedComposer`, `PostCard` (per type), `ReactionBar`,
  `CommentThread`, `AnnouncementCard`, `TownhallCard`.
- Rewards: `GiveKudosSheet`, `BadgePicker`, `RecognitionCard`, `PointsWallet`,
  `Leaderboard`, `ServiceAwardCard`, `NominationForm`.
- Assistant: `AssistantPanel`, `MessageStream`, `ConfirmActionCard`,
  `SuggestionChips`.
- Context widgets: `BirthdaysWidget`, `AnnouncementsWidget`, `HolidaysWidget`,
  `RecognitionWidget`, `PendingApprovalsWidget`.

---

## 12. Recommended Database Objects (all tenant-scoped, RLS-backed)

**Community:**
- `feed_posts` (id, tenant_id, author_id, type, body, media, audience_scope,
  audience_ref, pinned, status, created_at)
- `feed_reactions` (id, tenant_id, post_id, employee_id, reaction)
- `feed_comments` (id, tenant_id, post_id, employee_id, body, created_at)
- `announcements` (id, tenant_id, title, body, audience, publish_at, expires_at)

**Rewards:**
- `recognition` (id, tenant_id, from_id, to_id, badge_code, message, points,
  visibility, feed_post_id)
- `badges` (id, tenant_id, code, label, icon, criteria, active)
- `recognition_points` (id, tenant_id, employee_id, balance, period)
- `recognition_budgets` (id, tenant_id, giver_role, monthly_points)
- `service_awards` (id, tenant_id, employee_id, years, awarded_at) — or derived.
- `nominations` (id, tenant_id, nominee_id, award_code, status, approver_id)

**Assistant:**
- `assistant_conversations` (id, tenant_id, employee_id, created_at)
- `assistant_messages` (id, tenant_id, conversation_id, role, content,
  tool_calls, created_at)

**Home/FlowDesk:** reuse existing tables (`leave_requests`,
`attendance_regularisation`, `overtime_requests`, `comp_off_requests`,
`payroll_reimbursement_claims`, `approval_matrices`). New `tasks` table only if
FlowDesk grows beyond approvals.

> Every new table: `tenant_id` FK + RLS policy (consistent with the platform's
> multi-tenant posture — service-role API still scopes by `tenant_id`).

---

## 13. APIs Required

**Reuse (exists):** `/me`, `/attendance/:id`, `/attendance/leave/my`,
`/leave-requests` (+approve), `/attendance/regularisation/*`, `/payroll/my-slips`,
`/approvals/pending`, `/attendance/anomalies/my`, reimbursement/loan/wfh
endpoints.

**Net-new:**
- Home: `GET /ess/home` — single aggregated payload (snapshot + teasers) to avoid
  waterfalls.
- Community: `GET /community/feed` (cursor), `POST /community/posts`,
  `POST /community/posts/:id/react`, `POST /community/posts/:id/comments`,
  `GET /community/announcements`, moderation `PATCH/DELETE`.
- Rewards: `POST /recognition` (give), `GET /recognition/feed`,
  `GET /recognition/me` (points/badges), `GET /recognition/leaderboard`,
  `POST /nominations`, badge CRUD (admin).
- Assistant: `POST /assistant/message` (streamed), action registry resolving
  intents → existing write endpoints (server-side, confirmed).

All new endpoints: `fastify.authenticate` + tenant scope + zod validation +
the 402 write-gate for writes (the contract in `apps/api/src/plugins/auth.ts`).

---

## 14. Future Roadmap (phased)

| Phase | Scope | Reuse vs new | Outcome |
|---|---|---|---|
| **0** | Brand unification (desktop navy→royal-blue), pillar rail scaffold, mobile tab migration | mostly reuse | One coherent shell, ESS 2.0 nav |
| **1** | **Home** (desktop + mobile), `GET /ess/home`, context panel/widgets | reuse-heavy | Daily-open landing live |
| **2** | **FlowDesk** unified Tasks/Approvals/Requests over existing approval APIs | reuse-heavy | One place for all actions |
| **3** | **Community** feed v1 (posts, reactions, comments, announcements, auto-posts) | net-new | Engagement surface live |
| **4** | **Rewards** (kudos, badges, points, service awards) + feed integration | net-new | Recognition first-class |
| **5** | **AI Assistant** (answer tier → act tier), ⌘K upgrade, provider wiring | net-new | Action-oriented assistant |
| **6** | Leaderboards, nominations workflow, points redemption, Learning pillar, leadership broadcast, engagement analytics | net-new | Maturity / culture metrics |

Each phase ships behind the existing patterns (empty-states, lint/token gate,
tenant scope) and is independently shippable.

---

## 15. Differentiation vs Darwinbox / PeopleStrong / Keka / Hono / Zoho People

| Dimension | Them (typical) | CognixHR Experience Cloud |
|---|---|---|
| **Default surface** | Attendance/leave dashboard (transaction-first) | **Home** experience — a reason to open daily, not a task |
| **Community** | Bolt-on "feed" few use; often disconnected | Feed wired to **recognition + milestones + leadership**, surfaced in Home |
| **Recognition** | Buried under HR menus, optional add-on | **First-class pillar**, feed-integrated, budgeted (anti-gaming) |
| **AI** | Chatbot that answers FAQs | **Action-oriented** assistant that *creates leave/tickets/claims* over real APIs, confirmed |
| **Mobile** | Responsive shrink of desktop | **Mobile-first** dedicated shell (already shipped Phase 1) + thumb-first feed |
| **Consistency** | Module-by-module visual drift | One design-token contract, lint-gated (we already enforce it) |
| **Architecture** | Experience re-plumbs data | Experience is a **thin layer over a mature platform** — faster, cheaper, coherent |

**The wedge:** competitors sell an HRMS with an ESS attached. CognixHR ships an
**Employee Operating System** — the digital front door — on top of an already
mature platform, reusing its depth instead of rebuilding it.

---

*End of locked blueprint. Build phases implement sections by number. Changes to
this contract require an explicit, recorded amendment.*
