# CognixHR — Experience Patterns · The Experience Vocabulary

> **STATUS: FROZEN — the experience vocabulary of CognixHR.**
> Extracted from the frozen flagship **My Day** (`EXPERIENCE_HOME_DESIGN.md`) and
> governed by the constitution (Manifesto · Vision · UX Blueprint v2 · Roadmap).
> Every surface built after Home — Timeline, Leave, Payroll, Recognition,
> Community, Identity, Manager, Executive — **composes these patterns** so the
> whole platform feels like one product. This is not a component library and not
> a token sheet; it is the **grammar of experience**. Build with it.

---

## 0. What this is (and what it is not)

There are two reference documents, and they answer different questions:

| Document | Answers | Examples |
|----------|---------|----------|
| **Design system** (`EXPERIENCE_HOME_DESIGN.md §3`) | *How does it look?* | type scale, 32px rhythm, navy/teal tokens, borderless surfaces, motion |
| **Experience patterns** (this file) | *What story is the person experiencing?* | Focus, Need, Story, People, Progress, Reflection, Closure |

A surface is **not** a page with widgets. It is a **sequence of patterns** that
together tell the employee a story about their work. The design system makes each
pattern look calm and premium; this file decides **which patterns appear, in what
order, and what each one is allowed to do.**

> **The test for every new surface:** *"What story is the employee experiencing?"*
> — never *"What page are they using?"*

---

## 1. The seven inheritance principles (non-negotiable)

Home established these. Every surface inherits them. When a design choice conflicts
with one of these, the principle wins.

1. **Narrative before navigation** — lead with a story read top-to-bottom, not a
   menu of modules. Navigation is a fallback, never the front door.
2. **People before metrics** — faces and names before numbers and tiles. A human is
   `PersonAvatar`, not a row id.
3. **Ambient intelligence before search** — one quiet AI sentence that explains /
   recommends / reassures, surfaced *for* the user, before any search box or filter.
4. **Context before forms** — read the situation and pre-shape the action. Ask only
   for what context can't supply. A form is the last resort, not the first screen.
5. **Memory before history** — reference what happened *to this person over time*
   ("you usually…", "two weeks since…") before showing a raw, undifferentiated log.
6. **Progress before reporting** — frame momentum and growth (encouragement) before
   dashboards and percentages (judgement).
7. **Reflection before closure** — give one genuine insight, then let the person
   *finish*. Every experience earns a calm ending.

---

## 2. The narrative grammar (the emotional rhythm)

Home's spine is the canonical sequence. Other surfaces use the **same rhythm**, not
necessarily all seven beats — a surface includes a pattern only when it has something
true to say (silence-as-calm). The order is the constant:

```
Focus  →  Need  →  Story  →  People  →  Progress  →  Reflection  →  Closure
 ▲         ▲        ▲          ▲           ▲             ▲              ▲
"what     "what    "what      "who is     "am I         "what I        "am I
 matters   needs    happened   here with   growing?"     didn't think   done?"
 now"      me"      / my       me"                       to ask"
                    journey"
```

- **Open with Focus, close with Closure.** Everything between is included as the
  surface's content warrants.
- **One pattern leads.** When several could open a surface, the highest-priority true
  one leads; the rest tuck in quietly (exactly as the greeting selector resolves).
- **Skip, never pad.** A pattern with nothing genuine to say is omitted for that
  view. A light surface is a *short* surface, not a padded one.

---

## 3. The patterns

Each pattern below defines: **Intent · Human question · When to use · Composition ·
Data contract · Rules · Voice · Home reference · Cross-surface instances.** Treat the
data-contract shapes as the *minimum* interface a Core service projects so the same
primitive renders everywhere with zero per-surface business logic.

---

### 3.1 — FOCUS · "what matters now"

- **Intent:** open the surface with one confident, human statement of the single most
  important thing right now — reassurance or direction, never a wall of options.
- **Human question:** *"What matters most here, right now?"*
- **When to use:** the **first** beat of nearly every surface. Always present (it can
  be reassuring — "nothing needs you" — but it is never absent).
- **Composition:** one borderless focal panel (faint navy→teal wash) · eyebrow ·
  **one big sentence** (Focus type, 24–28px) · **one** primary action · optional faint
  context line (words, not tiles). Component: `TodayFocus` / `FocusPanel`.
- **Data contract:**
  ```ts
  interface Focus { eyebrow: string; sentence: string; action?: { label: string; href: string }; context?: string }
  ```
- **Rules:** exactly one sentence, one action. Synthesised from signals/state, not a
  raw count. Never two competing messages. Tone adapts to context (busy / calm / first
  day / manager) without changing the panel's shape.
- **Voice:** *"You can clear everything waiting in under 3 minutes."* /
  *"Two approvals are holding up your team."*
- **Home reference:** Movement 2 (Today's Focus).
- **Cross-surface:** Manager Home → "Manager Alerts" (team-framed focus). Executive →
  "Executive Priorities". Leave → "You have 12 days — and a long weekend is one click
  away." Payroll → "Payday. Your slip is ready."

---

### 3.2 — NEED · "what needs me"

- **Intent:** surface the small set of things that genuinely require the person to act,
  ranked, each with a contextual action — and **disappear entirely when nothing does.**
- **Human question:** *"What needs me?"*
- **When to use:** right after Focus, whenever actionable items exist (approvals,
  regularizations, expiring docs, risks).
- **Composition:** a conversational heading + count · a short ranked stack of
  `SignalCard`s (≤3 on a home; "View all →" beyond) · each card carries one action.
- **Data contract:** the **Signal** shape is the platform standard —
  ```ts
  interface Signal { id: string; type: string; severity: 'info'|'warn'|'urgent'; priority: number; title: string; body?: string; action?: { label: string; href: string } }
  ```
- **Rules:** silence-as-calm — render nothing when empty (Focus already reassured).
  Ranked by priority. No per-type branching in the view; new signal types render with
  zero changes (`SignalCard` is type-agnostic).
- **Voice:** card titles are imperatives a person can act on: *"Regularize your missing
  check-in."*
- **Home reference:** Movement 3 (Worth your attention).
- **Cross-surface:** Manager → "Approvals & Risks". Payroll → "3 inputs missing before
  this run locks". Identity → "Your passport expires in 12 days". Notification Center
  is the **aggregation** of Need across all surfaces.

---

### 3.3 — STORY · "what happened / my journey"

- **Intent:** tell time as a narrative — what happened, with people and meaning woven
  in — not an undifferentiated log. This is the pattern **Timeline** is built from.
- **Human question:** *"What happened?"* (today) → *"What's my journey been?"* (life).
- **When to use:** any surface where chronology carries meaning — Home's day, the full
  Timeline, a Leave journey, a payroll history, an onboarding arc.
- **Composition:** time-grouped sections (Today · This week · Earlier / or by year for
  the long arc) · a vertical stack of `ActivityItem`s (face when a person is involved,
  soft glyph otherwise) · relative time · ambient reflections interleaved at meaningful
  moments. Components: `ActivityItem`, `TimeGroup`, `StoryRail`.
- **Data contract:** the **Event** shape is the platform standard —
  ```ts
  interface Event { id: string; type: string; title: string; body?: string; at: string; person?: string; action?: { label: string; href: string } }
  ```
  Story services return `Event[]` (paginated for long ranges); `ActivityItem` renders
  any type with no changes.
- **Rules:** newest-first within a group. People-centred events show faces. Group
  headers are human ("This week", not a date range). Memory reflections (§3.6) may
  punctuate the story but never crowd it.
- **Voice:** the ambient line summarises a stretch: *"A big quarter for you — a
  promotion and two milestones."*
- **Home reference:** Movement 4 (Here's your day) — the **today slice** of Story.
- **Cross-surface:** **Timeline** (the full Story surface). Leave → "Your leave
  journey". Payroll → "Your pay over time". Onboarding → "Your first weeks".

---

### 3.4 — PEOPLE · "who is here with me"

- **Intent:** make work feel human — celebrate, connect, recognise. Faces large and
  warm; relationships over records.
- **Human question:** *"Who should I connect with?"*
- **When to use:** the emotional centre of community-shaped surfaces; present on Home,
  Recognition, Community, Manager (team), and anywhere a person should be seen.
- **Composition:** `PersonAvatar` (56px in celebrations, 36px in lists) ·
  `CelebrationCard` (birthday / anniversary / new joiner, one warm action) · a quieter
  line of recognition received / given. Components: `PeopleRail`, `CelebrationCard`,
  `PersonAvatar`.
- **Data contract:**
  ```ts
  interface Person { name: string; subtitle?: string; reason?: 'birthday'|'anniversary'|'new_joiner'|'recognition'; action?: { label: string; href: string } }
  ```
- **Rules:** people are **faces, never icons**. Photos drop in later behind the same
  `PersonAvatar`. Warmth without noise — premium entrance, no confetti spam. Pair-memory
  (§3.6) enriches People copy when genuine.
- **Voice:** *"Three teammates are celebrating today — a quick word goes far."*
- **Home reference:** Movement 5 (Your people).
- **Cross-surface:** Recognition (the full People surface). Manager → "Your team
  today". Community → faces on every post. Identity → "your reporting line", as people.

---

### 3.5 — PROGRESS · "am I growing"

- **Intent:** make the person feel *seen and encouraged* — momentum and direction, not
  scores. Motivates, never reports.
- **Human question:** *"Am I doing well?"*
- **When to use:** wherever there is genuine, positive momentum to reflect — attendance
  consistency, generosity, learning, goals. **Silent** when there is nothing true to
  celebrate.
- **Composition:** a deliberately **light** band (not a panel) · one warm heading · one
  ambient encouragement line · ≤3 word-hints (`On-time streak · 8 days`). Component:
  `ProgressBand`.
- **Data contract:**
  ```ts
  interface Progress { show: boolean; heading: string; ambient: string; hints: { label: string; value: string }[] }
  ```
- **Rules — the guardrails that keep it motivation, not gamification:** no charts, no
  grades, no percentages-as-judgement, **never rank a person down against peers**.
  Celebrate effort and direction. `show: false` hides the pattern entirely (silence
  over manufactured praise).
- **Voice:** *"You've shown up on time eight days running — your steadiest stretch
  yet."*
- **Home reference:** Movement 7 (You're doing well).
- **Cross-surface:** Learning → "You're three lessons into the path". Goals → "2 of 3
  on track — strong quarter". Manager → team momentum ("on-time rate held all week"),
  never a leaderboard that shames.

---

### 3.6 — REFLECTION · "what I didn't think to ask"

- **Intent:** the signature ambient-AI moment — one genuine, memory-aware insight the
  person didn't request: a pattern, an explanation, a gentle recommendation.
- **Human question:** *"What should I know that I didn't think to ask?"*
- **When to use:** near the end of a surface, once, as a rich moment. Present when a
  real insight exists; absent otherwise (never a generic fortune-cookie).
- **Composition:** the **one rich surface** — a navy→teal gradient panel · `COGNIX
  INSIGHT` eyebrow · one sentence · one soft action. Component: `ReflectionCard`.
- **Data contract:**
  ```ts
  interface Reflection { insight: string | null; action?: { label: string; href: string }; kind?: string }
  ```
- **Rules:** **memory before history** — speak across time, not just about today.
  Ranked: surface the single most worth-saying insight. `insight: null` hides the
  panel. Warm, brief, never robotic, never a number for its own sake. This is the only
  place a gradient panel appears in a surface (scarcity = signature).
- **Voice:** *"You usually take a break around now — you've earned one."*
- **Home reference:** Movement 9 (Cognix Insight).
- **Cross-surface:** Payroll → "Your net pay rose ₹2,400 — incentive processed". Leave
  → "Friday off would make a long weekend". Manager → "One report is low on balance —
  worth a check-in". Executive → "Attrition risk is concentrated in one team."

---

### 3.7 — CLOSURE · "am I done"

- **Intent:** the emotional payoff — tell the person they can stop. Few enterprise apps
  give this; it is a CognixHR signature.
- **Human question:** *"Am I free?"*
- **When to use:** the **last** beat of a surface, and the resolution of any completed
  action (a success state is Closure at the task scale).
- **Composition:** no card — a centred quiet line with a small ✓. Pending-aware copy.
  Component: `DoneForToday` / `SuccessState`.
- **Data contract:**
  ```ts
  interface Closure { settled: boolean; name?: string }  // settled=false → "a couple of things still waiting"
  ```
- **Rules:** calm, never a dead-end. When work remains, it reassures rather than nags.
  A completed form ends in Closure, not a bare toast — the person feels *finished*.
- **Voice:** *"That's everything, Suraj. You're all set — have a great day."*
- **Home reference:** Movement 10 (Done for today).
- **Cross-surface:** every success state ("Leave applied — enjoy the break"). Payroll →
  "Run locked — everyone gets paid Friday." Onboarding → "You're all set up."

---

## 4. Shared voice & motion (inherited from Home §3)

- **One ambient sentence per pattern** — short, warm, specific, never repetitive, never
  robotic. It explains, recommends, reassures, or encourages — never just states a
  number. Carried by `AmbientLine` (✨ + one sentence).
- **One type scale, 32px rhythm, borderless surfaces.** Only **two filled panels** per
  surface: the Focus wash and the Reflection gradient. Everything else floats.
- **People are faces.** `PersonAvatar` everywhere a human is named.
- **Motion is calm** — 400ms fade/rise on entrance, suppressed under
  `prefers-reduced-motion`. Nothing bounces.
- **Silence is a feature.** Empty patterns vanish; light days are short.

---

## 5. The reusable primitives (where each pattern lives in code)

`apps/web/src/components/experience/` is the shared kit. Patterns map to primitives:

| Pattern | Primitive(s) | Status |
|---------|--------------|--------|
| Focus | `TodayFocus` / `FocusPanel` | exists inline (Home); extract to primitive in Phase 2 |
| Need | `SignalCard` | ✅ built |
| Story | `ActivityItem`, `TimeGroup`, `StoryRail` | `ActivityItem` ✅; `TimeGroup`/`StoryRail` new for Timeline |
| People | `PersonAvatar`, `CelebrationCard`, `PeopleRail` | avatars + cards ✅; `PeopleRail` to extract |
| Progress | `ProgressBand` | rendered inline (Home); extract to primitive |
| Reflection | `ReflectionCard` | rendered inline (Home); extract to primitive |
| Closure | `DoneForToday`, `SuccessState` | rendered inline (Home); extract to primitive |
| Voice | `AmbientLine` | ✅ built |
| States | `LoadingState`, `ErrorState`, `EmptyState` | ✅ built |

**Phase-2 housekeeping:** as each pattern is reused by a second surface, extract its
inline Home implementation into a named primitive here so Timeline/Leave/etc. inherit
it rather than re-implementing. Home stays the reference; the primitive becomes the
contract.

---

## 6. Core service grammar (the kernel behind the patterns)

Patterns are fed by **Experience Core read-models** that project from existing module
tables — never new business logic, never speculative infrastructure. Conventions:

- **Project, don't own.** A Core service reads + merges + ranks existing data; the
  module of record stays the source of truth.
- **Tenant + self scoping server-side** on every Core endpoint, always fresh.
- **`safe()` every sub-query** — a failed source yields an empty section, never a blank
  surface.
- **Grow on demand.** Add a Core service only when a *visible* pattern on a real
  surface needs it. Home proved the loop: `/ess/signals` (Need), `/ess/activity`
  (Story-today), `/ess/progress` (Progress), `/ess/reflection` (Reflection),
  `/ess/home.context` (Focus/greeting).
- **Memory is derive-on-read first** (Phase 1); a materialised `experience_memory`
  read-model is introduced only when a surface's continuity demands it.

---

## 7. Governance

This vocabulary is **frozen**. Every Phase-2 surface (and every later one) must:

1. **Open its design doc by naming the patterns it composes, in rhythm order**, and
   justify any beat it omits (silence-as-calm is a valid justification).
2. **Reuse the primitives** in §5 — no bespoke re-implementation of a pattern that
   already exists.
3. **Honour the seven principles** in §1; when a tradeoff arises, the principle wins.
4. **Pass the question:** *"What story is the employee experiencing?"*

A surface that reads as *"a nice page"* has failed. A surface that reads as *"part of
one product that knows me"* has inherited Home correctly.

*Home is the blueprint. This file is the grammar. Everything else should feel like it
belongs to the same world.*
