# CognixHR — My Day (Home) · Flagship Experience Design

> **STATUS: FROZEN — flagship experience for CognixHR.**
> Approved 2026-06-26 after the four final refinements (personal identity · dynamic
> greetings · My Progress · memory) and the context-adaptation requirement. This
> document is now the **reference specification** every Home build and every later
> surface inherits from. It is governed by the frozen constitution (Manifesto · Vision ·
> UX Blueprint v2 · Roadmap · Experience Review) and is itself constitutional: build on
> it, do not contradict or quietly redesign it. Changes require a deliberate, recorded
> revision — not drift.
>
> Implementation (STEP 4) is now authorised: Desktop **My Day** → `GET /ess/reflection` →
> `GET /ess/progress` → Mobile **My Day**, each shippable, Home as the reference build.

---

## 0. The intent

Home is **My Day** — not "the dashboard," not "the portal," but *the employee's own
day*, told as a single scrollable narrative they read top to bottom like a sentence
about themselves. The name is first-person on purpose: the page belongs to **me**, it
knows **me**, it remembers **me**. It is not a dashboard; it has **no widget grid, no
KPI tiles, no module labels.** Every movement answers one human question and carries one
ambient AI observation. People appear as faces, not icons. The page should feel like
Apple-calm, Linear-precise, Viva-personal — and unmistakably CognixHR.

**The narrative spine (fixed order):**
```
Greeting  →  Today's Focus  →  What needs me  →  What happened  →
People around me  →  My work  →  My Progress  →  Company pulse  →
AI reflection  →  Done for today
```

Each movement, its human question, and its data source:

| # | Movement | Human question | Data (reuse-first) |
|---|----------|----------------|--------------------|
| 1 | Greeting | "Is this *mine*?" | profile + clock + context (no service) |
| 2 | Today's Focus | "What matters today?" | derived from **/ess/signals** (synthesised focus) |
| 3 | What needs me | "What needs me?" | **/ess/signals** (exists) |
| 4 | What happened | "What happened?" | **/ess/activity** (exists) |
| 5 | People around me | "Who should I connect with today?" | /ess/home (birthdays, anniversaries, recognition) + new-joiners *(small add)* |
| 6 | My work | "What can I finish in 2 minutes?" | FlowDesk counts (exists via /ess/home kpis) |
| 7 | My Progress | "Am I doing well?" | **NEW /ess/progress** (motivational, not reporting) |
| 8 | Company pulse | "What's happening around me?" | /ess/home feed_teaser (exists) |
| 9 | AI reflection | "What should I know I didn't think to ask?" | **NEW /ess/reflection** (one genuine insight, memory-aware) |
| 10 | Done for today | "Am I free?" | derived (no service) |

Two new Experience Core services are required (`/ess/progress`, `/ess/reflection`), and
Home is the immediate consumer of both — the growth rule holds. **Memory** is not a new
movement; it is a capability woven through Greeting, People, Progress and Reflection
(§3.D).

---

## 1. DESKTOP — My Day

A centred single column, **max-width ~760px**, generous margins, the shell's left rail
and a slim top bar (search + notifications + profile) around it. **One column, not
three** — the eye travels down a story, never across a grid.

### Movement 1 — Greeting  *(identity, dynamic & contextual, ~no chrome)*
- **Display greeting**, large and calm, **chosen at render time** from time-of-day,
  day-of-week, and any active life/work context (§3.A): `Good morning, Suraj` →
  `Happy birthday, Suraj 🎉` → `Welcome back, Suraj` after leave → `Welcome aboard,
  Suraj` on day one. (32px / semibold.)
- Sub-line, muted, also contextual: `Thursday, 8 May · almost the weekend` →
  `Payday — your salary lands today` → `Your first day · we're glad you're here`.
- **A memory touch when one exists** (§3.D), quiet and never creepy: *"You usually start
  around now."* / *"Two weeks since your last break."* Shown only when genuine; absent
  otherwise.
- No card. Just air. This is the page taking a breath before it speaks **to this person,
  on this day.**

### Movement 2 — Today's Focus  *(the hero — "what matters today")*
A single, wide, **borderless** focal panel with a soft tonal wash (navy→teal at 4–6%
opacity), generous padding (32px). This is the one confident statement of the day.

- ✨ eyebrow: `TODAY'S FOCUS` (11px, tracked, teal).
- **A big human sentence** synthesised from signals — the most important thing today,
  phrased as reassurance or direction:
  - light day → *"You can clear everything waiting in under 3 minutes."*
  - urgent → *"Two approvals are waiting on you — they're holding up your team."*
  - empty → *"Your day is clear. Nothing needs you — enjoy it."*
  - salary day → *"Payday. Your slip is ready, and nothing else needs you."*
  (24–28px, the largest text on the page after the greeting.)
- **One primary action** beneath it: `Review now →` (solid navy pill) — deep-links to
  exactly the thing the sentence is about.
- Optional: a single faint line of context (`2 approvals · 1 regularization`) — words,
  never tiles.
- No 3D orb (the image's decoration); the *sentence* is the hero, not an illustration.

### Movement 3 — What needs me  *(only if something does — silence is calm)*
- Conversational heading: `Worth your attention` + a small count.
- A short stack of **SignalCard**s (already built), ranked, each with a contextual
  action. Three max on Home; "View all →" if more.
- If nothing: this movement **disappears entirely** (Movement 2 already reassured).

### Movement 4 — What happened  *(the day's story, with faces)*
- Heading: `Here's your day`.
- One **AmbientLine**: *"Your salary landed today — and a few good things happened too."*
- A vertical **timeline of ActivityItem**s. People-centred events (recognition,
  birthdays) show a **PersonAvatar**; system events show a soft type glyph. Time on the
  left in muted small caps. Generous 16–20px row rhythm.

### Movement 5 — People around me  *("who should I connect with")*
The emotional centre of the page. **Faces, large and warm.**
- Heading: `Your people` + `See all →`.
- One **AmbientLine**, *memory-aware* where it earns it: *"Three teammates are
  celebrating today — and you and Amit have traded four kudos this quarter."*
- A horizontal row of **3–4 large CelebrationCards** (faces ~56px), each: avatar,
  name, reason (`Birthday` / `3-year anniversary`), and one warm action (`Wish 🎉` /
  `Congratulate 👏`). Subtle, premium entrance (fade/rise).
- Below, a quieter line of **recognition received** (face + "Amit recognized you for
  Design Excellence") and **new joiners** (face + role + "joined this week · Say hi").

### Movement 6 — My work  *("what can I finish in 2 minutes")*
- Heading: `Your work, in one place`.
- One **AmbientLine**: *"Everything assigned to you can be cleared in a few minutes."*
- A compact **capability action bar** (QuickActions) — the 2-minute things: Apply Leave,
  Regularize, Raise Request, View Payslip, My Tasks (badged). Context-aware ordering
  (the relevant action is promoted). **No grid of big icon tiles** — a calm wrap of
  pill actions.

### Movement 7 — My Progress  *(motivates, never reports — the quiet lift)*
A deliberately **light** band — a single warm sentence and at most three soft progress
hints. This is **not** an analytics strip; it never shows a chart, a percentage that
feels like a grade, or a number that could read as surveillance. It exists to make a
person feel *seen and encouraged*, then get out of the way.

- Heading: `You're doing well` (or contextually `A strong week`, `Back in your rhythm`).
- One **AmbientLine** as the lift, framed as encouragement and growth, derived from
  `/ess/progress`:
  - *"You've shown up on time eight days running — your most consistent stretch yet."*
  - *"You've given more recognition than last month — people notice."*
  - *"You're close to a full quarter with no missed check-ins."*
- Up to **three gentle hints**, words not gauges, each phrased as momentum, never deficit:
  `On-time streak · 8 days` · `Kudos given · 5 this month` · `Goals on track · 2 of 3`.
- **Tone rules:** celebrate effort and direction, not output; never compare a person
  *down* against peers; when there's nothing genuinely positive to say, the movement
  **stays silent** rather than manufacturing praise (silence-as-calm applies here too).

### Movement 8 — Company pulse  *("what's happening around me")*
- Heading: `Around CognixHR` + `Open community →`.
- 2–3 **community posts** with **author faces** (PersonAvatar), conversational, no
  reaction chrome on Home — a glance, not a feed to work. Leadership/announcement posts
  get a subtle accent.

### Movement 9 — AI reflection  *(the signature ambient moment, memory-aware)*
A single, wide, **gradient panel** (navy→teal, the one rich surface on the page — the
image's "You're on a roll!" moment, done with restraint).
- ✨ `COGNIX INSIGHT`.
- **One genuine insight** — a pattern/explanation/recommendation the employee didn't
  ask for, from `/ess/reflection`. Because the service is **memory-aware**, it can speak
  across time, not just about today:
  - *"You've been perfectly on time every day this week."*
  - *"You usually take a break around this point in the quarter — you've earned one."*
  - *"Taking Friday off would stretch your remaining leave into a long weekend."*
  - *"Your net pay rose ₹2,400 this month — your incentive was processed."*
- One soft action: `View your week →`. Tone: warm, brief, never robotic. Reflection sits
  **after** Progress on purpose — it interprets the momentum the previous movement
  surfaced.

### Movement 10 — Done for today  *(the calm closer — emotional payoff)*
- No card. A centred, quiet line with a small ✓: *"That's everything, Suraj. You're all
  set — have a great Thursday."*
- This is the **reward for reaching the bottom** — a feeling few enterprise apps give.
  It tells the employee they can close the laptop. (When work *is* pending, it instead
  reads: *"A couple of things are still waiting — but nothing that can't wait for coffee."*)

---

## 2. DESKTOP wireframe (high-fidelity)

```
        Good morning, Suraj
        Thursday, 8 May · almost the weekend
        ✨ You usually start around now.

        ┌─────────────────────────────────────────────────────────┐
        │ ✨ TODAY'S FOCUS                                          │
        │                                                         │
        │  You can clear everything waiting                       │   ← 26px
        │  in under 3 minutes.                                    │
        │                                                         │
        │  [ Review now → ]      2 approvals · 1 regularization   │
        └─────────────────────────────────────────────────────────┘

        Worth your attention                                    (3)
        ▸ Regularize your missing check-in        Yesterday   High  →
        ▸ Two approvals are waiting on you        Pranav, Neha     →
        ▸ Passport expires in 12 days             Upload doc       →

        Here's your day
        ✨ Your salary landed today — and a few good things happened too.
        09:15   ✓  You checked in
        11:30  (face) Amit approved your leave for 12 May
        13:45   ₹  Salary credited · View payslip
        15:10  (face) Amit recognized you — "Design Excellence"

        Your people                                          See all →
        ✨ Three teammates are celebrating — you and Amit have traded 4 kudos.
        ( face )      ( face )       ( face )       ( face )
         Riya          Karan          Neha           Priya
         Birthday      3-yr anniv     1-yr anniv     Joined this week
         [ Wish 🎉 ]   [ Congrats ]   [ Congrats ]   [ Say hi ]

        Your work, in one place
        ✨ Everything assigned to you can be cleared in a few minutes.
        [ Apply leave ] [ Regularize ] [ Raise request ] [ Payslip ] [ My tasks ② ]

        You're doing well
        ✨ You've shown up on time eight days running — your steadiest stretch yet.
        On-time streak · 8 days    Kudos given · 5    Goals on track · 2 of 3

        Around CognixHR                                  Open community →
        (face) Leadership · "Q2 town hall this Friday, 4pm…"
        (face) Priya · "Shipped the new onboarding flow 🎉…"

        ┌─────────────────────────────────────────────────────────┐
        │ ✨ COGNIX INSIGHT                                         │
        │  You usually take a break around now — you've earned one.│
        │  [ View your week → ]                                   │
        └─────────────────────────────────────────────────────────┘  ← navy→teal

                 ✓  That's everything, Suraj. You're all set.
```

The whole page is **one column, vertically rhythmic** — calm, scannable in 5 seconds
(greeting → focus → people), deep on scroll.

---

## 3. The design system (Home is the reference implementation)

### 3.A — Dynamic & contextual greetings  *(refinement 2)*

The greeting is **never a fixed string.** It is resolved at render from three inputs,
in priority order — **context beats time-of-day** when a meaningful life/work event is
active, so the page always opens with the most human thing true right now.

**Resolution order (first match wins for the headline):**

| Priority | Context (when true) | Headline | Sub-line |
|----------|---------------------|----------|----------|
| 1 | First day (joined today) | `Welcome aboard, Suraj` | `Your first day · we're glad you're here` |
| 2 | Birthday | `Happy birthday, Suraj 🎉` | `Wishing you a wonderful year ahead` |
| 3 | Work anniversary | `Three years today, Suraj 🎊` | `Thank you for everything you've built here` |
| 4 | First day back after leave | `Welcome back, Suraj` | `Hope you had a good break — here's what you missed` |
| 5 | Salary day | `Good morning, Suraj` | `Payday — your salary lands today` |
| 6 | Holiday tomorrow / long weekend | `Good morning, Suraj` | `One more day, then a long weekend` |
| 7 | — *(default, time-of-day)* | `Good morning` / `Good afternoon` / `Good evening, Suraj` | day-of-week + texture (`almost the weekend`, `fresh week`, `midweek`) |

- **Time-of-day** sets the default verb (`morning` < 12:00, `afternoon` < 17:00,
  `evening` otherwise) and is always the fallback.
- **Day-of-week** colours the sub-line texture: Monday → *"a fresh week"*, Friday →
  *"almost the weekend"*, midweek → *"midweek"*.
- **Context** (rows 1–6) overrides the headline and/or sub-line when active. Only the
  single highest-priority context shows in the headline; a second, lower one may tuck
  into the sub-line if it doesn't crowd.
- **Memory touch** (§3.D) renders as the optional third ambient line under the greeting,
  never as part of the headline.
- Implemented as a pure `resolveGreeting(profile, now, context)` selector — testable,
  no network, context fields supplied by `/ess/home`. Copy lives in one table so tone
  stays consistent and is easy to tune.

### 3.B — Typography
One calm scale (kills the current 6-size soup):
- Display 32 / semibold (greeting) · Focus 26 / semibold · Heading 18 / semibold ·
  Body 15 / regular · Meta 13 / muted · Eyebrow 11 / medium tracked. One weight step
  between levels; nothing `extrabold`.

### 3.C — Spacing, surfaces, colour, people, motion, voice, states
- **Spacing & rhythm** — 8px base. **32px between movements**, 24–28px card padding,
  16–20px row rhythm. The My Progress band runs *tighter* (its hints are one line) to
  signal "light, not a section." Whitespace is a feature, not a gap.
- **Surfaces & elevation** — **borderless by default**; separation by whitespace + a
  *single* soft shadow token (`--elev-1`). Only two filled panels on the page: Today's
  Focus (faint wash) and AI Reflection (rich gradient). My Progress is **not** a panel —
  it floats on the canvas like the other movements, to stay quiet. Radius: one value
  (16px / `rounded-2xl`).
- **Colour** — navy `#1A4D8F` primary, teal `#15B8A6` accent, calm neutral canvas. Two
  gradients only (Focus = subtle, Reflection = rich). No hardcoded hex in components —
  all tokenised. (Palette commit pending — design assumes navy-primary/teal-accent.)
- **People** — PersonAvatar everywhere a human is named; 56px in celebrations, 36px in
  lists. Photos drop in later behind the same component.
- **Motion** — calm and meaningful: a 400ms fade/rise as each movement enters the
  viewport (staggered ~60ms), the celebration's gentle rise, a soft sheen on the
  Reflection panel. **All suppressed under `prefers-reduced-motion`.** Nothing bounces.
- **AI voice** — one ✨ sentence per movement. Short, warm, specific, never repetitive,
  never robotic. Explains, recommends, reassures, or *encourages* — never just states a
  number.
- **States** — LoadingState (skeleton, no spinner-text), ErrorState (calm + retry),
  EmptyState (a *positive* line, e.g. "Your day is clear"). Already built; reused.

### 3.D — Designing for memory  *(refinement 4)*

Home should feel like it **remembers** the person across time — referencing past actions
and relationships, not just today's rows. This is the seed of the platform's long-term
intelligence; we design the surface for it now and grow the data behind it deliberately.

**Principles**
- **Remembered, not surveilled.** Memory is used to *reassure, connect and encourage* —
  never to nag, score, or imply you're being watched. If a memory line could read as
  "we're tracking you," it doesn't ship.
- **Earned, then shown.** A memory line appears **only when it's genuinely true and
  useful.** No template fires on thin data; silence beats a forced "we remember you."
- **Relationships, not just records.** The richest memory is *between people* — kudos
  exchanged, who you usually thank, teammates you celebrate — because that's what makes
  work feel human.

**Where memory surfaces (woven through existing movements, not a new one):**

| Surface | Memory it draws on | Example line |
|---------|--------------------|--------------|
| Greeting (M1) | habitual login time, time since last break | *"You usually start around now."* · *"Two weeks since your last break."* |
| People (M5) | kudos history between you and a colleague | *"You and Amit have traded four kudos this quarter."* |
| My Progress (M7) | streaks, month-over-month effort | *"Your most consistent stretch yet."* |
| AI reflection (M9) | seasonal patterns, leave rhythm, pay history | *"You usually take a break around now — you've earned one."* |

**Data model (reuse-first, grown deliberately):**
- **Phase 1 (now):** memory is *derived on read* from data we already keep — attendance
  history (streaks, habitual times), recognition rows (pair counts), leave history (time
  since last break), payroll deltas. `/ess/progress` and `/ess/reflection` compute these
  in their queries; no new storage yet. This already powers every example line above.
- **Phase 2 (later, when a surface needs it):** a thin **`experience_memory`** read-model
  (per employee: rolling streaks, last-break date, pair-kudos tallies, "usually" windows)
  materialised from the same source tables — introduced only when derive-on-read becomes
  too heavy or a surface needs cross-session continuity. Kernel rule holds: built when a
  visible block demands it, never speculatively.
- **Scope & privacy:** memory is **per-employee and self-only** — your Home references
  *your* past and *your* relationships, tenant-scoped server-side like every Core
  service. No employee's memory is ever exposed to another.

---

## 4. MOBILE — My Day (true mobile-first, not scaled desktop)

Mobile is the **primary** channel. Same emotional journey, **thumb-first**, one screen
that flows. Bottom nav: `Home · FlowDesk · ＋ · Community · Profile`.

### The mobile journey (condensed, same spine)
1. **Header (sticky, soft):** the **dynamic greeting** `Good morning, Suraj 👋` (or its
   contextual variant — `Happy birthday`, `Welcome back`) + `Thu 8 May`. Avatar right.
   The memory touch tucks under as one small line when present.
2. **Today's Focus** — a full-width focal card, the hero sentence + one `Review now →`.
   Big type, lots of air. The first thumb-reach.
3. **What needs me** — a vertical stack of SignalCards (swipe-actionable: swipe right to
   action). Hidden when empty.
4. **People** — a **horizontally scrollable** row of celebration faces (thumb-swipe),
   each with `Wish`. Faces are big (64px) — the emotional hook on a phone.
5. **What happened** — a compact timeline, faces inline.
6. **Quick actions** — a single row of pill actions (not a grid), the 2-minute things.
7. **My Progress** — one warm line + a single chip (`8-day streak`); deliberately the
   lightest stop on the page, easy to flick past, lovely to land on.
8. **Company pulse** — one or two posts with faces.
9. **AI reflection** — the gradient insight card, full-bleed, one sentence + action.
10. **Done for today** — the closing ✓ line, then breathing room above the bottom nav.

### Mobile principles
- **One thing per thumb-stop.** Each movement is a full-width, self-contained moment;
  you flick down through the day.
- **Faces are bigger on mobile** — emotional connection matters more on the device
  people actually live in.
- **Actions are reachable** — primary actions sit in the lower 2/3; the focal `Review
  now` is thumb-height.
- **No tables, no horizontal cramming, no desktop fallback** — every movement is
  designed for the phone first.

### Mobile wireframe
```
┌───────────────────────────────┐
│ Good morning, Suraj 👋    (av) │  sticky, soft · dynamic
│ Thu 8 May · almost weekend     │
│ ✨ You usually start now.      │  memory touch (when true)
├───────────────────────────────┤
│ ✨ TODAY'S FOCUS               │
│ Clear everything waiting       │  ← big
│ in under 3 minutes.            │
│ [ Review now → ]               │
├───────────────────────────────┤
│ Worth your attention        ▸  │
│ ▸ Missing check-in    High  →  │
│ ▸ 2 approvals waiting       →  │
├───────────────────────────────┤
│ Your people                    │
│ (◯face) (◯face) (◯face)  →     │  horizontal swipe
│  Riya    Karan   Neha          │
│  [Wish]  [👏]    [👏]          │
├───────────────────────────────┤
│ Here's your day                │
│ 09:15 ✓ Checked in             │
│ 11:30 (f) Leave approved       │
│ 13:45 ₹ Salary credited        │
├───────────────────────────────┤
│ [Leave] [Regularize] [Tasks ②] │  one pill row
├───────────────────────────────┤
│ You're doing well              │
│ ✨ On time 8 days running.  ⌁8 │  lightest stop
├───────────────────────────────┤
│ ✨ COGNIX INSIGHT              │
│ You've earned a break soon.    │  full-bleed gradient
│ [ View your week → ]           │
├───────────────────────────────┤
│  ✓ You're all set, Suraj.      │
├───────────────────────────────┤
│  ⌂      ▤      ＋     ◇    ◔   │  bottom nav
└───────────────────────────────┘
```

---

## 5. Context adaptation — one structure, many days  *(the adaptation requirement)*

The 10-movement spine **never changes.** What changes is *which movements speak, how
loud, and in what voice* — Home reshapes itself to the day without restructuring. This
is the core promise: the same page feels right on a frantic Monday, a payday, a birthday,
a holiday eve, a first day, and to a manager — because **content adapts, structure
doesn't.** Movements that have nothing true to say go silent (silence-as-calm); the
order and identity of the page hold.

| Context | Greeting (M1) | Today's Focus (M2) | What needs me (M3) | People (M5) | My Progress (M7) | Reflection (M9) | Done (M10) |
|---------|---------------|--------------------|--------------------|-------------|------------------|-----------------|------------|
| **Busy day** | default time-of-day | *"A full day — but the urgent two come first."* | full stack, ranked hard; "View all" | quiet, below the fold | silent (don't add load) | *"Heaviest day this week — you've cleared days like this before."* | *"Still a few open — you've made a real dent."* |
| **Salary day** | sub-line: *"Payday — your salary lands today"* | *"Payday. Your slip is ready, nothing else needs you."* | usually empty | normal | maybe: *"Third month in a row, fully present."* | *"Net pay rose ₹2,400 — incentive processed."* | *"All set — enjoy payday."* |
| **Birthday** | `Happy birthday, Suraj 🎉` | softened: *"It's your day — work can wait a little."* | minimised | **flips outward:** *"It's your birthday — here's who's celebrating you,"* wishes surface | *"A year of showing up — thank you."* | warm, personal | *"Have a wonderful birthday, Suraj."* |
| **Holiday (eve / on)** | sub-line: *"One more day, then a long weekend"* | *"Nothing needs you before the break."* | empty/hidden | holiday line + who's off | silent | *"A long weekend ahead — leave it all here."* | *"Enjoy the holiday — see you after."* |
| **New joiner** | `Welcome aboard, Suraj` | *"Let's get you set up — three things to start."* (onboarding tasks, honest first-run) | onboarding checklist, gentle | *"Meet your team,"* faces of teammates + buddy | hidden until there's a streak to celebrate | *"Your first week — here's how CognixHR works for you."* | *"That's a good first day — welcome again."* |
| **Manager** | default | can be **team-framed:** *"Your team is fully in; 2 approvals need you."* | **team approvals promoted** above personal | adds team birthdays/anniversaries to act on | *team-aware:* *"Your team's on-time rate held all week."* | *"One report is low on leave balance — worth a check-in."* | *"Your team's clear for today, too."* |

**Rules that keep adaptation safe:**
- **Structure is invariant.** No context adds, removes, or reorders movements — it only
  changes copy, emphasis, ranking, and visibility *within* the fixed spine.
- **Context is data, not branches in the view.** Each movement reads a small `context`
  object (`isBirthday`, `isSalaryDay`, `isFirstDay`, `isManager`, `holidayAhead`, …)
  supplied by `/ess/home`; the component picks copy from a table, exactly like
  `resolveGreeting`. No special-case layouts, no per-context screens.
- **One thing leads.** When several contexts are true (birthday *and* payday), the
  highest-priority one leads the greeting/focus and the rest tuck into sub-lines — the
  page never shouts two things at once.
- **Silence over noise.** Any movement with nothing genuinely true to say is hidden for
  that day. A light day is a *short* page, not a padded one.

---

## 6. STEP 3 — Self-critique (six lenses) and what I changed

**First-time employee:** *Risk — does the synthesised "Today's Focus" make sense before
data exists?* → Honest empty/first-run copy and a dedicated **new-joiner column** in the
adaptation matrix (onboarding-framed Focus, "Meet your team" People, Progress hidden
until earned) so the hero never shows a hollow promise and Progress never praises a
person with no history.

**Manager:** *Risk — where's my team?* → "People around me" + a **manager column**:
team-framed Focus, team approvals promoted, team-aware Progress and Reflection. Full
manager operating layer stays a later surface, but Home doesn't ignore them — and it does
so *within the same spine.*

**CEO / CHRO:** *Risk — does it show culture, not just tasks?* → People and Company Pulse
are mid-page; **My Progress** and the memory layer elevate *encouragement and belonging*
over metrics. A CHRO sees an *engagement* surface that remembers and motivates, not a
transaction list. Guardrail added: Progress celebrates effort, never ranks people down.

**Apple HIG reviewer:** *Risk — now 10 movements?* → Mitigated by **one column, one type
scale, borderless surfaces, 32px rhythm, only two filled panels, and aggressive
silence-when-empty.** My Progress is deliberately the *lightest* band (one line + chips,
not a panel); memory adds at most one quiet line. Most movements are 2–4 lines; the page
is long but *calm*, and short on light days.

**Enterprise UX expert:** *Risk — is "My Progress" just gamification dressed up?* →
Designed as **motivation, not scoring**: no charts, no grades, no down-ranking, silent
when there's nothing true to celebrate. It reads as a colleague noticing your effort,
not a leaderboard. The real differentiator remains narrative + ambient intelligence +
people-first + memory + silence-as-calm — not card styling.

**Logo-off test:** A page that opens by name and context, remembers your rhythm,
celebrates your people, quietly notices your progress, and tells you when you're done —
a reviewer should think *"this feels like the future of enterprise software,"* not *"nice
HRMS."* Remaining risk is execution polish (motion, type, spacing, and keeping the memory
voice warm-not-creepy) — which is why Home is the reference build.

**Net changes from critique:** renamed to **My Day** (first-person identity); made
greetings **dynamic/contextual** with a priority table; added **My Progress** as a quiet,
motivational (never reporting) band with explicit tone guardrails; added a **memory
layer** woven through M1/M5/M7/M9 with privacy and "earned, then shown" rules; added a
**context-adaptation matrix** proving one structure serves busy/salary/birthday/holiday/
new-joiner/manager days; kept silence-when-empty and two-filled-panels for calm.

---

## 7. Experience Core implications (growth rule honoured)

- **Reuse:** Movements 2–6, 8 read existing services (`/ess/signals`, `/ess/activity`,
  `/ess/home`). The components exist (SignalCard, ActivityItem, QuickActions,
  CelebrationCard, PersonAvatar, AmbientLine, states).
- **Two new services**, each with Home as immediate consumer:
  - `GET /ess/progress` — Movement 7. Returns one motivational headline + up to three
    momentum hints (streaks, effort deltas, goals-on-track), derived from existing
    attendance/recognition/goal tables. **Encouragement only** — no raw analytics.
  - `GET /ess/reflection` — Movement 9. One genuine, **memory-aware** insight (pattern /
    explanation / recommendation) computed across the employee's history.
- **Context fields:** `/ess/home` adds a small `context` object (`isBirthday`,
  `isSalaryDay`, `isFirstDay`, `isManager`, `holidayAhead`, habitual-login window,
  pair-kudos tallies) powering the greeting selector, the adaptation matrix, and the
  Phase-1 memory lines. Small enrichment, not a new service.
- **One small enrichment:** new-joiners for Movement 5 (extend `/ess/home` or a tiny
  query) — faces + role + "Say hi".
- **Memory data:** Phase 1 derive-on-read (no new storage); Phase 2 optional
  `experience_memory` read-model **only when a surface demands it** (§3.D).
- **New components needed at build:** `TodayFocus` (hero), `ProgressBand` (motivational
  line + hints), `ReflectionCard` (gradient insight), `PeopleRail` (celebration/
  recognition/new-joiner faces), `DoneForToday` closer, and a `resolveGreeting` selector.
  Each component becomes a reusable surface primitive other surfaces inherit.

No speculative infrastructure. Every addition has Home as its immediate consumer.

---

## 8. Frozen — build order

This design is **frozen as the flagship experience.** Implementation (STEP 4) proceeds in
shippable slices, Home staying the reference implementation throughout:

1. **Desktop My Day** — rename + `resolveGreeting` (dynamic/contextual) + the 10-movement
   narrative against existing services; `context` object added to `/ess/home`.
2. **`GET /ess/progress`** — the My Progress band (motivational, derive-on-read).
3. **`GET /ess/reflection`** — the memory-aware AI moment.
4. **Mobile My Day** — the thumb-first journey consuming the same Core services.

Memory grows derive-on-read first (Phase 1); the `experience_memory` read-model is
introduced later only if a surface needs it. Palette (navy-primary/teal-accent) is taken
as confirmed for tokens and motion.

*This document is the contract. Subsequent surfaces (Timeline, FlowDesk, People) inherit
its narrative grammar, its ambient voice, its memory principles, and its
silence-as-calm.*
