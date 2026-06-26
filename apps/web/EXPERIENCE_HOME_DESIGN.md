# CognixHR — Today's Workspace (Home) · High-Fidelity Design

> **Design deliverable (STEP 1 + 2 + 3).** Desktop design, mobile-first design, and
> self-critique. **No implementation** — awaiting approval per the master prompt.
> Builds on the frozen constitution (Manifesto · Vision · UX Blueprint v2 · Roadmap ·
> Experience Review). The moodboard is inspiration only — we take its calm, whitespace,
> typography and faces; we reject its widget grid in favour of one vertical story.

---

## 0. The intent

Home is **Today's Workspace** — a single scrollable narrative that an employee reads
top to bottom like a sentence about their day. It is not a dashboard; it has **no
widget grid, no KPI tiles, no module labels.** Every movement answers one human
question and carries one ambient AI observation. People appear as faces, not icons.
The page should feel like Apple-calm, Linear-precise, Viva-personal — and unmistakably
CognixHR.

**The narrative spine (fixed order):**
```
Good morning  →  Today's Focus  →  What needs me  →  What happened  →
People around me  →  My work  →  Company pulse  →  AI reflection  →  Done for today
```

Each movement, its human question, and its data source:

| # | Movement | Human question | Data (reuse-first) |
|---|---|---|---|
| 1 | Good morning | "Is this *mine*?" | profile + clock (no service) |
| 2 | Today's Focus | "What matters today?" | derived from **/ess/signals** (synthesised focus) |
| 3 | What needs me | "What needs me?" | **/ess/signals** (exists) |
| 4 | What happened | "What happened?" | **/ess/activity** (exists) |
| 5 | People around me | "Who should I connect with today?" | /ess/home (birthdays, anniversaries, recognition) + new-joiners *(small add)* |
| 6 | My work | "What can I finish in 2 minutes?" | FlowDesk counts (exists via /ess/home kpis) |
| 7 | Company pulse | "What's happening around me?" | /ess/home feed_teaser (exists) |
| 8 | AI reflection | "What should I know I didn't think to ask?" | **NEW /ess/reflection** (one genuine insight) |
| 9 | Done for today | "Am I free?" | derived (no service) |

Only **one** new Experience Core service is required (`/ess/reflection`), and Home is
its immediate consumer — the growth rule holds.

---

## 1. DESKTOP — Today's Workspace

A centred single column, **max-width ~760px**, generous margins, the shell's left rail
and a slim top bar (search + notifications + profile) around it. **One column, not
three** — the eye travels down a story, never across a grid.

### Movement 1 — Good morning  *(identity, ~no chrome)*
- **Display greeting**, large and calm: `Good morning, Suraj` (32px / semibold).
- Sub-line, muted: `Thursday, 8 May · almost the weekend`.
- No card. Just air. This is the page taking a breath before it speaks.

### Movement 2 — Today's Focus  *(the hero — "what matters today")*
A single, wide, **borderless** focal panel with a soft tonal wash (navy→teal at 4–6%
opacity), generous padding (32px). This is the one confident statement of the day.

- ✨ eyebrow: `TODAY'S FOCUS` (11px, tracked, teal).
- **A big human sentence** synthesised from signals — the most important thing today,
  phrased as reassurance or direction:
  - light day → *"You can clear everything waiting in under 3 minutes."*
  - urgent → *"Two approvals are waiting on you — they're holding up your team."*
  - empty → *"Your day is clear. Nothing needs you — enjoy it."*
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
- One **AmbientLine**: *"Three teammates are celebrating today — a quick word goes far."*
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

### Movement 7 — Company pulse  *("what's happening around me")*
- Heading: `Around CognixHR` + `Open community →`.
- 2–3 **community posts** with **author faces** (PersonAvatar), conversational, no
  reaction chrome on Home — a glance, not a feed to work. Leadership/announcement posts
  get a subtle accent.

### Movement 8 — AI reflection  *(the signature ambient moment)*
A single, wide, **gradient panel** (navy→teal, the one rich surface on the page — the
image's "You're on a roll!" moment, done with restraint).
- ✨ `COGNIX INSIGHT`.
- **One genuine insight** — a pattern/explanation/recommendation the employee didn't
  ask for, from `/ess/reflection`:
  - *"You've been perfectly on time every day this week."*
  - *"Taking Friday off would stretch your remaining leave into a long weekend."*
  - *"Your net pay rose ₹2,400 this month — your incentive was processed."*
- One soft action: `View your week →`. Tone: warm, brief, never robotic.

### Movement 9 — Done for today  *(the calm closer — emotional payoff)*
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
        ✨ Three teammates are celebrating today — a quick word goes far.
        ( face )      ( face )       ( face )       ( face )
         Riya          Karan          Neha           Priya
         Birthday      3-yr anniv     1-yr anniv     Joined this week
         [ Wish 🎉 ]   [ Congrats ]   [ Congrats ]   [ Say hi ]

        Your work, in one place
        ✨ Everything assigned to you can be cleared in a few minutes.
        [ Apply leave ] [ Regularize ] [ Raise request ] [ Payslip ] [ My tasks ② ]

        Around CognixHR                                  Open community →
        (face) Leadership · "Q2 town hall this Friday, 4pm…"
        (face) Priya · "Shipped the new onboarding flow 🎉…"

        ┌─────────────────────────────────────────────────────────┐
        │ ✨ COGNIX INSIGHT                                         │
        │  You've been perfectly on time every day this week.     │
        │  [ View your week → ]                                   │
        └─────────────────────────────────────────────────────────┘  ← navy→teal

                 ✓  That's everything, Suraj. You're all set.
```

The whole page is **one column, vertically rhythmic** — calm, scannable in 5 seconds
(greeting → focus → people), deep on scroll.

---

## 3. The design system (Home is the reference implementation)

**Typography** — one calm scale (kills the current 6-size soup):
- Display 32 / semibold (greeting) · Focus 26 / semibold · Heading 18 / semibold ·
  Body 15 / regular · Meta 13 / muted · Eyebrow 11 / medium tracked. One weight step
  between levels; nothing `extrabold`.

**Spacing & rhythm** — 8px base. **32px between movements**, 24–28px card padding,
16–20px row rhythm. Whitespace is a feature, not a gap.

**Surfaces & elevation** — **borderless by default**; separation by whitespace + a
*single* soft shadow token (`--elev-1`). Only two filled panels on the page: Today's
Focus (faint wash) and AI Reflection (rich gradient). Everything else floats on the
canvas. Radius: one value (16px / `rounded-2xl`).

**Colour** — navy `#1A4D8F` primary, teal `#15B8A6` accent, calm neutral canvas. Two
gradients only (Focus = subtle, Reflection = rich). No hardcoded hex in components —
all tokenised. (Palette commit pending — design assumes navy-primary/teal-accent.)

**People** — PersonAvatar everywhere a human is named; 56px in celebrations, 36px in
lists. Photos drop in later behind the same component.

**Motion** — calm and meaningful: a 400ms fade/rise as each movement enters the
viewport (staggered ~60ms), the celebration's gentle rise, a soft sheen on the
Reflection panel. **All suppressed under `prefers-reduced-motion`.** Nothing bounces.

**AI voice** — one ✨ sentence per movement. Short, warm, specific, never repetitive,
never robotic. Explains, recommends, or reassures — never just states a number.

**States** — LoadingState (skeleton, no spinner-text), ErrorState (calm + retry),
EmptyState (a *positive* line, e.g. "Your day is clear"). Already built; reused.

---

## 4. MOBILE — Today's Workspace (true mobile-first, not scaled desktop)

Mobile is the **primary** channel. Same emotional journey, **thumb-first**, one screen
that flows. Bottom nav: `Home · FlowDesk · ＋ · Community · Profile`.

### The mobile journey (condensed, same spine)
1. **Header (sticky, soft):** `Good morning, Suraj 👋` + `Thu 8 May`. Avatar right.
2. **Today's Focus** — a full-width focal card, the hero sentence + one `Review now →`.
   Big type, lots of air. The first thumb-reach.
3. **What needs me** — a vertical stack of SignalCards (swipe-actionable: swipe right to
   action). Hidden when empty.
4. **People** — a **horizontally scrollable** row of celebration faces (thumb-swipe),
   each with `Wish`. Faces are big (64px) — the emotional hook on a phone.
5. **What happened** — a compact timeline, faces inline.
6. **Quick actions** — a single row of pill actions (not a grid), the 2-minute things.
7. **Company pulse** — one or two posts with faces.
8. **AI reflection** — the gradient insight card, full-bleed, one sentence + action.
9. **Done for today** — the closing ✓ line, then breathing room above the bottom nav.

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
│ Good morning, Suraj 👋    (av) │  sticky, soft
│ Thu 8 May · almost weekend     │
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
│ ✨ COGNIX INSIGHT              │
│ On time every day this week.   │  full-bleed gradient
│ [ View your week → ]           │
├───────────────────────────────┤
│  ✓ You're all set, Suraj.      │
├───────────────────────────────┤
│  ⌂      ▤      ＋     ◇    ◔   │  bottom nav
└───────────────────────────────┘
```

---

## 5. STEP 3 — Self-critique (six lenses) and what I changed

**First-time employee:** *Risk — does the synthesised "Today's Focus" make sense before
data exists?* → Designed honest empty/first-run copy ("Welcome, Suraj — here's where
your day will live") so the hero never shows a hollow promise.

**Manager:** *Risk — where's my team?* → "People around me" + a manager variant where
Today's Focus can be team-framed ("Your team is fully in today; 2 approvals need you").
Full manager operating layer stays a later surface, but Home doesn't ignore them.

**CEO / CHRO:** *Risk — does it show culture, not just tasks?* → People and Company Pulse
are mid-page, not buried; the Reflection moment elevates wellbeing/pattern over metrics.
A CHRO sees an *engagement* surface, not a transaction list.

**Apple HIG reviewer:** *Risk — too many movements (9)?* → Mitigated by **one column,
one type scale, borderless surfaces, 32px rhythm, only two filled panels.** Most
movements are 2–4 lines; the page is long but *calm*, never busy. Silence-when-empty
keeps it short on light days.

**Enterprise UX expert:** *Risk — is it just prettier cards?* → The differentiator is
**narrative + ambient intelligence + people-first + silence-as-calm**, not card styling.
No KPI tiles, no widget grid, no module menu — structurally not a dashboard.

**Logo-off test:** With the KPI grid gone, the orb gone, the story spine, the ambient
sentences, the faces, and the "Done for today" closer — a reviewer should think *"this
feels like the future of enterprise software,"* not *"nice HRMS."* The remaining risk is
execution polish (motion, type, spacing) — which is why Home is the reference build.

**Net changes from critique:** added honest first-run/empty copy; added a manager
framing for Today's Focus; confirmed silence-when-empty to keep the page short;
constrained to two filled panels for calm.

---

## 6. Experience Core implications (growth rule honoured)

- **Reuse:** Movements 2–4, 6, 7 read existing services (`/ess/signals`, `/ess/activity`,
  `/ess/home`). The components exist (SignalCard, ActivityItem, QuickActions,
  CelebrationCard, PersonAvatar, AmbientLine, states).
- **One new service:** `GET /ess/reflection` — a single genuine insight (pattern /
  explanation / recommendation) for Movement 8. Home is its only consumer now.
- **One small enrichment:** new-joiners for Movement 5 (extend `/ess/home` or a tiny
  query) — faces + role + "Say hi".
- **New components needed at build:** `TodayFocus` (hero), `ReflectionCard` (gradient
  insight), `PeopleRail` (celebration/recognition/new-joiner faces), `DoneForToday`
  closer. Each becomes a reusable surface primitive other surfaces inherit.

No speculative infrastructure. Every addition has Home as its immediate consumer.

---

## 7. What I need before implementation

Per the master prompt, I am **stopping here for approval.** Decisions that shape the
build:
1. **Approve the 9-movement narrative + single-column story** (vs the moodboard grid).
2. **Approve the one new service** `/ess/reflection` for the AI moment.
3. **Palette confirm** (navy-primary/teal-accent) so motion/tokens are final.
4. **Build order on approval:** Desktop Home movements → `/ess/reflection` →
   Mobile Home — each shippable, Home staying the reference implementation.

*No code has been written. Awaiting your review of this design before STEP 4.*
