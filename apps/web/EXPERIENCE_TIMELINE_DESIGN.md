# CognixHR — Timeline · The Employee Memory Experience

> **STATUS: DESIGN FOR REVIEW** — Phase 2, priority #1.
> Authored against the frozen vocabulary (`EXPERIENCE_PATTERNS.md`) with Home
> (`EXPERIENCE_HOME_DESIGN.md`) as the blueprint. Not yet implemented — this doc
> is the high-fidelity design + self-critique that must be approved first, exactly
> as Home was reviewed before it was built.

---

## 0. The question this surface answers

Not *"What page is this?"* — **"What has my time here meant?"**

Home answers *"What is my day?"* Timeline answers the larger, slower question every
employee carries quietly: **"What's my story been here — what have I done, who was
part of it, and am I growing?"** It is the surface where CognixHR proves it
*remembers* the person, not just their records.

A normal HRMS gives this as an **audit log**: a reverse-chronological table of rows —
"Leave approved · 12 Mar", "Slip generated · 28 Feb" — undifferentiated, faceless,
judgmental. That is *history*. Timeline must be **memory**: time told as a narrative,
with people woven in, with meaning surfaced, with the person's growth reflected back
to them. **Memory before history** (Principle 5) is the whole reason this surface
leads Phase 2.

> **The test:** the employee should scroll Timeline and feel *seen across time*, not
> *audited*. If it reads as a log with nicer fonts, it has failed.

---

## 1. Patterns composed (governance §7.1)

Timeline is built from the vocabulary, in rhythm order. Beats it omits are justified
(silence-as-calm).

| Beat | Pattern | Present? | Role on Timeline |
|------|---------|----------|------------------|
| 1 | **Focus** (§3.1) | ✅ leads | One human sentence framing the whole journey: *"You've been with the team 2 years and 3 months — here's the story so far."* No action; this Focus orients, it doesn't task. |
| 2 | **Need** (§3.2) | ⛔ omitted | Timeline is reflective, not actionable. "What needs me" lives on Home / Notification Center; bringing it here would turn memory into a to-do list. *Justified omission.* |
| 3 | **Story** (§3.3) | ✅ **the spine** | The entire body: the full `Event[]` history, time-grouped (Today · This week · This month · by year), faces on people-events, ambient reflections interleaved at milestones. This is the canonical full Story surface. |
| 4 | **People** (§3.4) | ✅ woven in | Not a separate rail — faces appear *inside* the Story at every people-event (recognition giver, the manager who approved, the teammate who joined alongside you). Relationships are part of the memory, not a sidebar. |
| 5 | **Progress** (§3.5) | ✅ as a milestone band | At year boundaries / anniversaries, a light Progress band punctuates the scroll: *"Year one: 47 days present without a late mark, 9 kudos given."* Growth framed as momentum, never a scorecard. |
| 6 | **Reflection** (§3.6) | ✅ once, near top | The signature memory-aware insight — the single most worth-saying thing about the person's arc: *"Your steadiest year yet — and your most generous: you recognised teammates 9 times."* One gradient panel, scarcity = signature. |
| 7 | **Closure** (§3.7) | ✅ at the deep end | When the scroll reaches the beginning — the join date — a warm origin marker closes the story: *"And this is where it began — your first day, 14 March 2024. Quite a journey."* Closure here means *"you've reached the start"*, the emotional floor of the narrative. |

**Lead pattern:** Focus (the journey framing). **Spine:** Story. **Signature moment:**
Reflection. The rhythm is the constant; Need is the only beat dropped, and for a
reason that protects the surface's purpose.

---

## 2. The shape of the experience

Timeline is **one vertical narrative**, read top (now) to bottom (origin). It is not a
filterable data grid with a date-picker as its front door — that would be *navigation
before narrative* (violates Principle 1). Search and filter exist, but **below the
fold and quiet** (Principle 3: ambient intelligence before search).

```
  now  ┃  ✦ FOCUS — "2 years, 3 months. Here's the story so far."
       ┃
       ┃  ✨ REFLECTION (gradient) — "Your steadiest, most generous year yet."
       ┃
       ┃  ── Today ──────────────────────────
       ┃   ● You checked in · 9:02am
       ┃   ● Priya recognised you — "Team Player"      [face]
       ┃
       ┃  ── This week ───────────────────────
       ┃   ● Your leave was approved · Mon              [face: approver]
       ┃   ● Payslip released · ₹ ▮▮,▮▮▮
       ┃
       ┃  ── March 2026 ──────────────────────
       ┃   ● You regularised a missing check-in
       ┃   ● You gave kudos to Arjun                    [face]
       ┃
       ┃  ┌─ PROGRESS band ────────────────────┐
       ┃  │ Year two so far · On-time 96% · 4 kudos given │
       ┃  └────────────────────────────────────┘
       ┃
       ┃  ── 2025 ────────────────────────────
       ┃   ◆ Work anniversary — 1 year 🎉
       ┃   ● Promoted to Senior Analyst                 [milestone]
       ┃   ● ... (paginated, loads on scroll)
       ┃
       ┃  ── 2024 ────────────────────────────
       ┃   ● You joined the Design team                 [faces: cohort]
  origin┃   ✓ CLOSURE — "This is where it began. 14 Mar 2024."
```

### Event taxonomy (what the Story is made of)

Every row is the platform-standard **Event** (`EXPERIENCE_PATTERNS.md §3.3`).
Types, all projected from existing module tables — **no new business logic**:

| Event type | Source table | Person/face | Milestone? |
|------------|-------------|-------------|------------|
| `attendance` | `attendance` (check-in/out, regularization) | — | no |
| `leave` | `leave_requests` + `leave_types` | approver | no |
| `payroll` | `payroll_slips` (released/finalized) | — | no |
| `recognition` | `recognition` (received **and** given) | giver / receiver | no |
| `announcement` | `feed_posts` (type=announcement) | — | no |
| `birthday` | `employees.dob` (own, past years) | self | soft |
| `anniversary` | `employees.join/hire date` | self | **✦ milestone** |
| `joined` | `employees` hire date (origin event) | onboarding cohort | **✦ milestone** |
| `comp_off` / `overtime` / `regularization` | engine tables (P1) | approver | no |
| `document` | document/profile changes (when surfaced) | — | no |

`ActivityItem` renders **any type with no per-type view branching** — milestone vs
ordinary is a flag on the Event, not a separate component. New event types light up
the Timeline with zero view changes (same contract that lets `/ess/activity` grow).

### Faces, not glyphs (Principle 2)

When an Event has a `person`, the row leads with a `PersonAvatar` — the colleague who
recognised you, the manager who approved your leave, the teammates who joined the same
week you did. When there's no person, a soft type-glyph (never a loud icon). The memory
of *who was there* is half the point of a timeline; a faceless log throws it away.

---

## 3. Memory, not history (the heart of the surface)

This is what separates Timeline from every audit log. Three mechanisms, all
**derive-on-read** first (per §6 — no `experience_memory` table until continuity
demands it):

1. **Time told as narrative, not rows.** Group headers are human ("This week", "March
   2026", "2024"), newest-first within each. Relative time near the top ("2 days ago"),
   absolute deeper down. The eye reads a *story arc*, not a spreadsheet.

2. **Milestones punctuate.** Anniversaries, promotions, the join date render as `◆`
   milestone markers — larger, warmer, with a year-summary Progress band attached.
   These are the chapter breaks of the person's story.

3. **Ambient reflections interleaved (memory-aware).** At meaningful seams the Ambient
   line speaks *across time*, not about a single row:
   - at a year boundary → *"A strong year — a promotion and your steadiest attendance yet."*
   - at the origin → *"Two years and three months ago, this is where you started."*
   - over a generous stretch → *"You recognised teammates 9 times this year — among the most on your team."* (never a rank that shames — Principle 6 guardrail)

   These punctuate; they never crowd (§3.3 rule). At most one per chapter.

### Relationship memory (Principle 5, the harder half)

Memory is not only *what I did* but *who I did it with*. Where genuine, Timeline names
relationships derived from co-occurrence:
- *"You and Arjun joined the same week."* (cohort from hire dates)
- *"Priya has recognised you 4 times — your most frequent champion."* (recognition graph)

This is **derive-on-read** from `recognition` + `employees`, ranked, and shown only
when true (silence-as-calm). It is the seed of the `experience_memory` read-model,
which we introduce **only if** Timeline's pagination makes per-read derivation too heavy
(§6: grow on demand, not speculatively).

---

## 4. The Core service — `GET /ess/timeline`

Timeline needs **one** new Experience Core read-model: the full-history superset of
`/ess/activity`. Same projection discipline (project, don't own; tenant+self scoping
server-side, fresh; `safe()` every sub-query).

```
GET /ess/timeline?cursor=<iso>&limit=40
→ {
    focus:      { eyebrow, sentence },              // journey framing (Focus)
    reflection: { insight: string|null, kind? },    // memory-aware arc insight (Reflection)
    groups: [                                        // Story, time-grouped, newest-first
      { key: "today"|"week"|"2026-03"|"2025"|...,
        label: "Today" | "This week" | "March 2026" | "2025",
        progress?: { heading, ambient, hints[] },    // Progress band on year/anniversary seams
        events: Event[] }                            // §3.3 Event contract, milestone flag inline
    ],
    nextCursor: string | null,                       // pagination for the long arc
    origin?:    { joined_at, label }                 // Closure marker when the first page reaches it
  }
```

**Projection plan (reuses `/ess/activity`'s exact source queries, widened range):**
- attendance · leave · payroll · recognition (received + given) · announcements ·
  birthdays · anniversaries · join — each `safe()`-wrapped, tenant+self scoped.
- Merge → sort newest-first → bucket into time groups → attach Progress band at
  year/anniversary seams → rank one Reflection across the loaded range.
- **Pagination by `at` cursor** (keyset, not offset) so the long arc scrolls smoothly;
  `limit` default 40 events.
- **Performance guardrail:** server caps per-source rows per page; if a tenant's history
  is deep, we materialise `experience_memory` *then* — not before (§6).

**Why not extend `/ess/activity`?** `/ess/activity` is deliberately the *today slice*
(last 2 days, no pagination, no milestones) feeding Home's Movement 4. Timeline is the
*full Story surface* (paginated, milestone-aware, journey-framed). Same Event contract,
same primitives — different scope. Keeping them separate honours "grow the Core only
when a visible block needs it": Home's block didn't need history; Timeline's does.

---

## 5. Desktop wireframe (≥ lg)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  YOUR TIMELINE                                                        │  ← eyebrow (Meta)
│                                                                       │
│  ┌─ FOCUS (faint navy→teal wash, borderless) ───────────────────┐   │
│  │  Two years and three months with the team.                    │   │  ← Focus sentence (26px)
│  │  Here's the story so far.                                     │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─ REFLECTION (navy→teal gradient — the one filled panel) ──────┐   │
│  │  ✨ COGNIX INSIGHT                                             │   │
│  │  Your steadiest year yet — and your most generous:            │   │
│  │  you recognised teammates nine times.                         │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Today ─────────────────────────────────────────────────────         │  ← TimeGroup header
│   ◐  You checked in                                    9:02am        │
│   😊 Priya recognised you · "Team Player"             2h ago         │  ← face (PersonAvatar)
│                                                                       │
│  This week ─────────────────────────────────────────────────         │
│   😊 Maya approved your leave · 24–26 Mar              Mon           │  ← approver's face
│   ▦  Payslip released · March                         Fri           │
│                                                                       │
│   ┌ PROGRESS (light band, not a panel) ──────────────────────┐      │
│   │ Year two so far · On-time 96% · 4 kudos given            │      │
│   └──────────────────────────────────────────────────────────┘      │
│                                                                       │
│  2025 ──────────────────────────────────────────────────────         │
│   ◆  Work anniversary — one year                      14 Mar 🎉     │  ← milestone marker
│   ◆  Promoted to Senior Analyst                       02 Sep        │
│   …                                                  (scroll loads)  │
│                                                                       │
│  2024 ──────────────────────────────────────────────────────         │
│   👥 You joined the Design team                       14 Mar        │  ← cohort faces
│   ✓  This is where it began. Quite a journey.                       │  ← CLOSURE
│                                                                       │
│                          · · · ·                                     │
│             quiet search/filter affordance (below the fold)          │  ← Principle 3
└─────────────────────────────────────────────────────────────────────┘
```

A single comfortable column (max ~720px) centred — a timeline is read, not scanned
across. The vertical spine is implied by left-aligned markers and 32px rhythm between
events, larger gaps between time groups. No table, no zebra rows, no borders except the
two filled panels.

---

## 6. Mobile wireframe (< lg) — `MobileTimeline`

Same narrative, one-thumb scroll. Lives behind the bottom-nav / "More", and is the
natural deep-link target from Home's Movement 4 ("View your full timeline →").

```
┌───────────────────────────┐
│  ‹ Your timeline          │  ← glossy header (inherited shell)
├───────────────────────────┤
│ ┌ Focus (wash) ─────────┐ │
│ │ 2 yrs 3 mo with the   │ │
│ │ team. The story so far│ │
│ └───────────────────────┘ │
│ ┌ ✨ Insight (gradient)─┐ │
│ │ Steadiest, most       │ │
│ │ generous year yet.    │ │
│ └───────────────────────┘ │
│                           │
│ Today ───────────         │
│ ◐ Checked in     9:02     │
│ 😊 Priya · kudos  2h      │
│                           │
│ This week ───────         │
│ 😊 Leave approved Mon     │
│ ▦ Payslip · Mar  Fri      │
│ ┌ Year two · 96% on-time┐ │
│ └───────────────────────┘ │
│                           │
│ 2024 ───────────          │
│ 👥 You joined    14 Mar   │
│ ✓ Where it began.         │
│        (load earlier)     │
└───────────────────────────┘
```

Mobile drops the Focus to one line, keeps the Reflection (it's the signature moment),
keeps milestones and the Closure origin. Infinite scroll via the same `nextCursor`.
Reuses `ActivityItem`, `TimeGroup`, `ProgressBand`, `ReflectionCard`, `PersonAvatar` —
**zero bespoke mobile components** (Principle: one product).

---

## 7. Context adaptation (Home §5 discipline — structure constant, content adapts)

The spine never changes; what fills it adapts to who's looking and where they are in
their arc:

| Context | How Timeline adapts (same structure) |
|---------|--------------------------------------|
| **New joiner (< 30 days)** | Short story — Focus becomes *"Welcome — your story is just beginning."* Closure is near the top (origin is recent). Reflection waits until there's an arc to reflect on (silence over a hollow insight). |
| **Long-tenured (years)** | Deep scroll, year chapters, multiple Progress bands and milestones. Reflection speaks to the long arc. |
| **Anniversary day** | Top milestone glows; Reflection leads with the anniversary: *"Three years today. Here's what they held."* |
| **Quiet recent period** | Recent groups are short (silence-as-calm); the surface doesn't pad — it lets older chapters carry the weight. |
| **Heavy recognition stretch** | People-events dominate recent groups; relationship-memory lines surface ("Priya, your most frequent champion"). |
| **Manager viewing own** | Identical surface — Timeline is *self* memory. The team's story is Manager Home's concern, not here (keeps the surface honest about whose memory it is). |

---

## 8. Self-critique (the six lenses — same review that hardened Home)

### Lens 1 — Narrative before navigation
**Pass, with a watch.** The surface opens as a story (Focus → Reflection → chaptered
Story), and search/filter is deliberately demoted below the fold. **Risk:** a long
history makes "find that one leave in 2024" painful without a filter. **Mitigation:**
keyset pagination + a quiet, collapsed filter that never becomes the front door. If
user testing shows people *hunting* more than *reading*, revisit — but never by
promoting the filter above the narrative.

### Lens 2 — People before metrics
**Pass.** Faces are woven *into* the Story (approver, recogniser, cohort), not exiled to
a sidebar — arguably more people-first than Home, where People is a discrete movement.
**Watch:** until employee photos exist, `PersonAvatar` shows initials; the warmth lands
fully only when photos drop in behind the same primitive (already the contract).

### Lens 3 — Ambient intelligence before search
**Pass.** Reflection + interleaved memory lines do the interpretive work *for* the user
before any search box. **Risk — the real one:** ambient lines that are generic ("You had
a busy month!") would cheapen the whole surface. **Guardrail:** every reflection must be
*specific and true* (a named number, a named person, a real milestone) or it is omitted.
Fortune-cookie text is a bug, not a fallback.

### Lens 4 — Context before forms
**Pass / N/A.** Timeline has no forms — it's pure reflection. The "context" obligation
is met by adapting the *content* to the person's arc (§7). Nothing to ask, so nothing is
asked. Clean inheritance.

### Lens 5 — Memory before history (the make-or-break lens)
**Conditional pass — this is where Timeline lives or dies.** The design is explicitly
built to be memory (narrative grouping, milestones, relationship lines, arc reflections)
rather than a log. **Honest risk:** if the projection is thin — early on we may only have
attendance + payroll + a little leave — Timeline degrades toward exactly the audit log
it's meant to transcend. **Mitigation:** (a) the milestone/anniversary/join markers and
the arc Reflection give *meaning* even on sparse data; (b) silence-as-calm means a sparse
timeline reads as *"your story is just beginning"*, not *"empty table"*; (c) we do **not**
ship Timeline until at least the people-events (recognition, approver faces, cohort) are
wired, because those carry the memory. A faceless Timeline is not worth shipping — better
to wait than to ship history wearing memory's clothes.

### Lens 6 — Progress before reporting & Reflection before closure
**Pass.** Progress appears as encouragement bands at chapter seams (no charts, no peer
ranking, effort-framed) — momentum, not a scorecard. The surface ends in genuine Closure
(the origin marker), giving the scroll an emotional floor instead of trailing off into
blank pagination. **Watch:** Progress bands must never quietly become KPIs; the §3.5
guardrail (no percentages-as-judgement) is easy to erode under "just one more stat" —
hold the line in review.

### Cross-cutting risks
- **Performance on deep histories.** Keyset pagination + per-source row caps; materialise
  `experience_memory` only if reads get heavy (§6). Don't pre-build the table.
- **Date/timezone correctness.** Group boundaries ("This week", year seams) must use the
  tenant's locale, not UTC, or the story mis-chapters. Test across timezones.
- **Privacy.** Timeline is strictly *self* (tenant+self scoping). A manager never sees a
  report's Timeline here — that's a deliberate boundary, not an omission.
- **The "nice page" failure mode.** If the ambient lines are weak and photos are absent,
  Timeline risks reading as a prettier log. The mitigation is editorial discipline on the
  AI voice, not more UI.

---

## 9. Build order (when approved — not before)

Slices that each deliver visible value, smallest first (the Home pattern):

1. **`GET /ess/timeline`** — full-history projection + keyset pagination, reusing
   `/ess/activity`'s source queries widened in range. Returns `groups[]` + `nextCursor`.
2. **Extract Story primitives** — `TimeGroup` + `StoryRail` (new), `ActivityItem`
   (exists) — and lift `ReflectionCard` / `ProgressBand` from inline-Home into shared
   primitives (the §5 Phase-2 housekeeping, now that a second surface needs them).
3. **Desktop `Timeline` surface** — Focus + Reflection + chaptered Story + Progress
   bands + Closure, infinite scroll.
4. **`MobileTimeline`** — same primitives in the glossy shell; deep-linked from Home's
   Movement 4.
5. **Relationship memory** — derive-on-read cohort + champion lines; introduce
   `experience_memory` *only if* step 1's per-read derivation proves too heavy.

Each slice ships green (web + api tsc, vite build) before the next, exactly as the four
My Day slices did.

---

*Timeline is the surface that proves CognixHR remembers you. Built right, an employee
scrolls it and feels their time here had shape and was witnessed. Built wrong, it's a
log with a gradient. The difference is entirely in the memory — and that is the bar this
design holds itself to.*
