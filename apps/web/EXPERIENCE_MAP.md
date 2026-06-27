# CognixHR — Experience Map · The Employee Experience Cloud IA

> **STATUS: FOR FREEZE — the final architectural checkpoint before execution.**
> The information architecture of every employee-facing experience: one unique
> purpose, one human question, zero overlap. Sits in the constitution beside the
> Patterns vocabulary and the Event Model — it does not restate them; it *places*
> every surface in one connected ecosystem. After this freezes, implementation
> begins with **My Growth (Identity)** and there are no further architectural
> redesigns.

---

## 0. The model — three tiers, not a pile of modules

The employee never "uses a module." They live in **experiences** (lenses), which
compose from **modules of record** (the transaction/truth layer) and are threaded
by **cross-cutting layers** (intelligence, retrieval, people).

```
   ┌──────────────────────────────────────────────────────────────┐
   │  EXPERIENCES  (7 lenses — the only "front doors")             │
   │  My Day · My Story · My Growth · My Attention                 │
   │  My Team · My Company · My Assistant                          │
   ├──────────────────────────────────────────────────────────────┤
   │  CROSS-CUTTING LAYERS  (threads, never surfaces)             │
   │  Ambient AI · Search · People/Identity primitives            │
   ├──────────────────────────────────────────────────────────────┤
   │  MODULES OF RECORD  (reached *from* an experience, with       │
   │  context pre-shaped — never the front door)                   │
   │  Leave · Payroll · Attendance · Documents · FlowDesk · …      │
   ├──────────────────────────────────────────────────────────────┤
   │  EXPERIENCE CORE  (one Event stream, many lenses — frozen)    │
   │  /ess/events · /ess/home · /ess/signals · /ess/timeline · …   │
   └──────────────────────────────────────────────────────────────┘
```

**Consequence (the philosophy made concrete):** there is no "Pay experience" or
"Leave experience." Pay, leave, and attendance are *woven across lenses* — payday
is a My Day focus, your pay history is My Story, "payslip ready" is My Attention,
"first payslip" is a My Growth milestone. You still *do* a leave application in the
leave module — but you always *arrive* there from an experience, pre-contextualised.
Modules are the workshop; experiences are the home.

---

## 1. The seven experiences at a glance

Every surface is **first-person — "My ___"**. The platform belongs to the employee;
the naming makes that felt. Each owns exactly one question.

| Surface | Lens | The one human question | Built? |
|---------|------|------------------------|--------|
| **My Day** (Home) | **Today** | *"What matters today?"* | ✅ frozen |
| **My Story** (Timeline) | **Memory** | *"How has my journey unfolded?"* | ✅ frozen |
| **My Growth** (Identity) | **Growth** | *"Who am I, and how have I grown?"* | ▶ next |
| **My Attention** (Notifications) | **Need** | *"What needs me now?"* | queued |
| **My Team** | **People · near** | *"How are my people?"* | future |
| **My Company** | **People · far** | *"What's our shared world?"* | future |
| **My Assistant** | **Intelligence · asked** | *"Can you help me with this?"* | future |

**Name verdict (challenged as asked):** keep all seven. They form a coherent
first-person mental model and each maps to a distinct lens. Two refinements I
*affirm* rather than rename:
- **"My Attention" beats "Notifications"** — it reframes alerts (a system pushing at
  you) into a curated queue of *what genuinely needs you* (and nothing that doesn't).
- **"My Assistant" is kept but strictly bounded** to the *asked* lane (you → AI) so it
  never becomes a chatbot that competes with ambient AI (AI → you). See §3.7 and §4.

I rejected three tempting merges (justified in §2): My Day + My Attention,
My Story + My Growth, My Team + My Company. Each pair answers two different
questions and merging would reintroduce overlap.

---

## 2. The zero-overlap matrix (the heart of this document)

Two surfaces may touch the same *data*; they must never answer the same *question*.
The boundaries that keep all seven distinct:

| Tension | Boundary that resolves it |
|---------|---------------------------|
| **My Day ↔ My Attention** | Day = *curated synthesis* of the present (one calm narrative; a **peek** at the top 1–3 needs). Attention = the *exhaustive ranked queue* of everything actionable + triage. Day reassures; Attention resolves. (Like a calm Today summary vs the full Notification Center.) |
| **My Story ↔ My Growth** | Story = *chronological memory*, everything that happened, read backward. Growth = the *distilled self* — the milestone spine, skills, achievements, identity — read forward. Growth is what Story *means*, not a second copy of it. **The JourneyRail's canonical home moves from Timeline to My Growth** (see §5). |
| **My Attention ↔ My Team** | Anything that **needs an action** (incl. a manager's team approvals) → My Attention. Anything about **understanding or celebrating people** → My Team. A manager's "2 approvals waiting" is Attention; "how your team's week went" is Team. |
| **My Team ↔ My Company** | **Near vs far.** Team = my circle (manager, peers, reports) — care and, for managers, team health. Company = the org — culture, community, company-wide recognition, belonging. |
| **My Assistant ↔ Ambient AI** | **Asked vs ambient.** Assistant = *you speak to AI* (prompted: ask, do). Ambient AI = *AI speaks to you* (unprompted, one sentence per block, everywhere). Different directions, zero overlap. |
| **My Assistant ↔ Search** | Search is not a surface — it's the *retrieval substrate*. Its human face is the Assistant's instant-answer mode; each surface also offers a *scoped* find. There is no standalone "Search experience." |

If a proposed feature can't name which single question it serves, it does not get a
surface — it gets *woven* into the one whose question it answers.

---

## 3. The surfaces in full

Each defines: Purpose · Question · Primary Experience · Core services · relationships
(Home / Timeline / Identity / AI / Search) · Desktop · Mobile.

### 3.1 — My Day  ·  *Today lens*  ·  ✅ frozen
- **Purpose:** orient the employee in the present — synthesise everything that matters
  today into one calm story.
- **Question:** *"What matters today?"*
- **Primary experience:** the day as a 10-movement narrative (greeting → focus →
  what-needs-me *peek* → what happened → people → progress → reflection → done).
- **Core services:** `/ess/home`, `/ess/home.context`, `/ess/signals` (peek), `/ess/activity`
  (today slice), `/ess/progress`, `/ess/reflection`.
- **↔ Home:** it *is* Home, the front door.
- **↔ Timeline:** its "what happened" is the today-slice of Story; invites into My Story.
- **↔ Identity:** greeted *by* identity; invites into My Growth ("revisit your journey").
- **↔ AI:** ambient greeting + Reflection. No chat.
- **↔ Search:** a quick scoped find; a real question hands off to My Assistant.
- **Desktop:** one narrative column (~720–860px), left story / right people regions.
- **Mobile:** the default Home tab; glossy greeting header; vertical thumb-scroll.

### 3.2 — My Story  ·  *Memory lens*  ·  ✅ frozen
- **Purpose:** the employee's memory — what happened, told as a biography.
- **Question:** *"How has my journey unfolded?"*
- **Primary experience:** reverse-chron **chapters** (Joining → … → This year) — faces,
  milestones, folded routine, one memory-aware reflection, a forward Growth rail (handing
  off to My Growth).
- **Core services:** `/ess/timeline` (the Story lens over `/ess/events`).
- **↔ Home:** the full depth behind Home's today slice.
- **↔ Identity:** the raw chronological substrate Growth distils into milestones; **cedes
  the JourneyRail's primary home to My Growth** (§5).
- **↔ AI:** one memory-aware Reflection. No chat.
- **↔ Search:** "find a moment" — scoped, quiet, below the narrative (future).
- **Desktop:** centred 720px reading column.
- **Mobile:** under the **Me** hub; thumb-scroll; deep-linked from My Day.

### 3.3 — My Growth  ·  *Growth lens*  ·  ▶ first to build (Identity)
- **Purpose:** who the employee *is* and is *becoming* — identity, the career biography,
  skills, achievements, recognition distilled into a self.
- **Question:** *"Who am I, and how have I grown?"*
- **Primary experience:** an identity hub — the person (name, role, reporting line *as
  people*), the **Journey/Growth spine** (now its canonical home), skills, learning,
  achievements, recognition summarised. Forward-reading, aspirational.
- **Core services:** the Journey projection (today `/ess/timeline.journey`; migrates to a
  dedicated `/ess/identity` when built — profile + skills + achievements + milestone subset
  of `/ess/events`), recognition. Grows as Skills/Learning event sources come online.
- **↔ Home:** Home greets this identity and links here.
- **↔ Timeline:** consumes Timeline's milestone subset; Story is the memory, Growth the self.
- **↔ AI:** ambient growth insight ("you've grown into the team's go-to for X"). No chat.
- **↔ Search:** find skills, people, achievements.
- **Desktop:** profile-hub — person header + Growth rail + skills/achievements regions.
- **Mobile:** the **Me** tab root; Growth rail + cards; My Story reached from here.

### 3.4 — My Attention  ·  *Need lens*  ·  queued (after Identity)
- **Purpose:** the single curated queue of everything that needs the employee — and
  nothing that doesn't.
- **Question:** *"What needs me now?"*
- **Primary experience:** severity-ranked Need cards over canonical events; triage
  (act / dismiss / snooze); self + (managers) team approvals; status of awaited requests.
  Empty state is a *reward* — "you're all clear."
- **Core services:** `/ess/signals` evolving into `/ess/notifications` (the Need lens over
  `/ess/events`, severity-first — same Event Model).
- **↔ Home:** Home shows the top-3 *peek*; this is the exhaustive queue + triage.
- **↔ Timeline:** an *acted* item becomes a memory in Story; Attention itself keeps nothing
  historical (no urgency in memory — Event Model §5).
- **↔ Identity:** none direct (action, not identity).
- **↔ AI:** ambient ranking/explanation ("clear these in 3 minutes"); the Assistant can *act*
  on items.
- **↔ Search:** filter/triage the queue.
- **Desktop:** a focused inbox region — list, not a module grid.
- **Mobile:** a primary bottom-nav tab (the bell) with a badge.

### 3.5 — My Team  ·  *People · near lens*  ·  future
- **Purpose:** understand and care for the people closest to the employee — manager,
  peers, reports — and, for managers, team health.
- **Question:** *"How are my people?"*
- **Primary experience:** the team as **faces** — who's in/out today, team recognition and
  celebrations, team growth; for managers, a team-health insight band. **No action queue**
  (that's My Attention).
- **Core services:** future `/ess/team` (team-visibility projection over `/ess/events`),
  recognition, presence/leave (read), `/ess/home.context`.
- **↔ Home:** Home's manager persona *peeks* the team; this is the full team experience.
- **↔ Timeline:** a personal lens; the team's awareness is not the employee's memory.
- **↔ Identity:** shows teammates' lightweight identities; my own self is My Growth.
- **↔ AI:** ambient team insight ("one report is low on leave balance — worth a check-in").
- **↔ Search:** find a teammate.
- **Desktop:** team roster + awareness regions + (manager) insight band.
- **Mobile:** via the existing **Me / Team** persona toggle (managers); a Team tab in
  manager context.

### 3.6 — My Company  ·  *People · far lens*  ·  future
- **Purpose:** the shared world — culture, community, company-wide recognition,
  announcements, belonging.
- **Question:** *"What's happening across us — and where do I belong?"*
- **Primary experience:** the community feed, company celebrations, the broad recognition
  stream, announcements, culture moments — people-wide and warm.
- **Core services:** `/ess/activity` (company-visibility), community/feed, recognition feed;
  future `/ess/company`.
- **↔ Home:** Home's "from around the company" teaser opens into this full surface.
- **↔ Timeline:** company moments you were part of may echo into Story; Company is shared,
  Story is personal.
- **↔ Identity:** recognition received here feeds My Growth.
- **↔ AI:** ambient "worth celebrating" surfacing.
- **↔ Search:** find people and posts.
- **Desktop:** a community/feed layout, faces on every item.
- **Mobile:** a primary bottom-nav tab.

### 3.7 — My Assistant  ·  *Intelligence · asked lens*  ·  future
- **Purpose:** the one place to **ask and do** in natural language — the prompted
  counterpart to ambient AI; it subsumes Search.
- **Question:** *"Can you help me with this?"*
- **Primary experience:** a conversational surface — ask anything (search + answer), do
  anything (initiate flows: apply leave, find a policy, draft a note), grounded in the
  employee's own scoped data and RBAC.
- **Core services:** the assistant routes (existing); reads across **all** Experience Core
  services + the search index; *acts* via module flows.
- **↔ every surface:** it can answer *about* and act *within* all of them — the universal verb.
- **↔ AI:** it *is* the asked lane of AI; ambient AI is the unprompted lane (no overlap).
- **↔ Search:** Search is the Assistant's instant-retrieval mode, not a separate surface.
- **Desktop:** a persistent invokable panel (⌘K) plus a full conversational view.
- **Mobile:** a persistent affordance (header / FAB), never a buried tab.

---

## 4. Cross-cutting layers (threads, deliberately *not* surfaces)

- **Ambient AI** — one quiet sentence per block on *every* surface (explain / recommend /
  reassure / encourage). The unprompted lane. Carried by `AmbientLine` / `ReflectionCard`.
  Not a destination.
- **Search** — the retrieval substrate. Human face = My Assistant (instant mode); each
  surface offers a *scoped* find. Never a standalone experience.
- **People / Identity primitives** — `PersonAvatar`, `JourneyRail`, celebration cards — the
  shared human vocabulary every surface draws on so faces look and behave identically.
- **Modules of record** — leave, payroll, attendance, documents, FlowDesk, etc. The
  action/truth layer beneath the lenses. Reached *from* an experience with context
  pre-shaped; never the front door.

---

## 5. Navigation model + the one migration this map mandates

**Desktop:** the seven experiences are the primary navigation; modules are reached *from*
experiences (plus a secondary "all tools" affordance for power users). My Assistant is a
persistent ⌘K-style invocation, not a nav item to hunt for.

**Mobile (5 bottom-nav slots):** **My Day** · **My Attention** · **My Company** · **Me**
(the Growth + Story hub) · with **My Assistant** as a persistent affordance (FAB/header).
The manager **My Team** view rides the existing **Me / Team** persona toggle — no extra tab.

**Mandated migration (resolves the overlap this slice created):** the **JourneyRail** —
today rendered atop Timeline — has its **canonical home in My Growth (Identity)**. When
Identity ships, Identity owns the Growth spine; Timeline either keeps a *compact echo* that
links to My Growth or hands it off entirely (decided at Identity build). This keeps My Story
purely *memory* and My Growth purely *self*, with no duplicated spine. No other surface
moves; modules stay where they are.

---

## 6. Freeze

This map is the frozen IA of the Employee Experience Cloud: **seven experiences, three
cross-cutting layers, modules of record beneath, one Event stream under all of it.** Every
surface has one purpose, one human question, and a named boundary against every neighbour.

Implementation now begins — **My Growth (Identity)** first — design-first, against this
frozen map, the frozen Patterns vocabulary, and the frozen Event Model. No further
architectural redesigns; future richness arrives through new event sources and real product
usage, not new surfaces.

*Seven lenses. One employee. One connected world that knows them.*
