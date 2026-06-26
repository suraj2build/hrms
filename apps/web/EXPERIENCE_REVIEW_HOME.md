# Experience Review — Home (brutally honest)

> Not a code review. Not strategy. An experience critique of Home *as shipped*
> (commit 299409a), judged by one question: **does it feel like the digital front
> door of the company?** Reviewed through seven lenses. Deliverables: critique,
> top-10 improvements, priority order, wireframes, low-complexity recommendations.

---

## The one-line verdict

**We built a beautifully composed dashboard. We have not yet built a front door.**

Home is now *intelligent* and *well-architected* — but it still **leads with
transactions, stacks too many sections, doesn't breathe, and treats the human
layer as a sidebar.** Strip the logo and a sharp observer would still say "modern
HRMS," not "the place I open every morning." We are ~70% architecture, ~40%
experience. This review is about closing that gap.

---

## 1. The 3-second test (what the eye hits first)

When Home loads, in order, the eye lands on:
1. The big **navy→teal gradient hero** (good — it's personal), then
2. A **wall of stacked full-width sections**: signals → quick-action chips → a
   **3-tile KPI strip** → then a two-column grid.

**Problems:**
- The hero is **mostly decorative**. Its only function (punch state) is a small
  chip in the top-right. A lot of premium pixels, little job done.
- By the time you reach the grid there have been **four full-width bands** competing
  for attention. Nothing is clearly *the* focal point. The eye has no rest.
- The **KPI strip (Leave remaining · Last net pay · Open actions) with "View →"
  links is the single most damaging element.** It is *literally* a traditional HRMS
  dashboard. LinkedIn, Slack and Viva do not open with KPI tiles. This one band
  undoes much of the "operating system" feeling above it.

## 2. Does it answer the five questions?

| Question | Answered? | Honest grade |
|---|---|---|
| What needs me? | Yes — signals, top of page | **A−** |
| What happened? | Yes — but **below the fold**, in the left column | **B−** |
| What should I do next? | Yes — but a generic 6-chip row, low intelligence | **B** |
| What deserves my attention? | Partly — celebrations are **bottom-right, easily missed** | **C** |
| What makes me feel connected? | **Weakest.** Community is a **text-only log**, no faces; the social layer is secondary everywhere | **C−** |

We nailed the *functional* questions and under-served the *emotional* one — which
is the exact axis that separates a front door from a dashboard.

## 3. Cognitive load & breathing

**It does not breathe.** Symptoms, all real in the current build:
- **8+ distinct sections**, each with its own header, stacked vertically.
- **Type-size soup:** `text-2xl`, `text-sm`, `text-xs`, `text-[11px]`, `text-[10px]`,
  `text-[9px]` all on one screen. No calm scale.
- **Weight noise:** `font-extrabold` on greeting, KPI numbers, section titles — too
  many things shout, so nothing leads.
- **Entry-point overload:** 6 quick-action chips + 3 KPI "View →" links + signal
  actions + 3 section "View all" links = **~15 competing CTAs** above and around the
  fold. We promised to *reduce* navigation; Home currently *adds* choices.

An Apple HIG reviewer's note would be one word: **reduce.**

## 4. Emotional engagement — would they open it tomorrow?

Honestly: **a diligent employee opens it for the signals and quick actions — a
transactional pull, not an emotional one.** There is:
- No daily-varying delight (the greeting is static; "all caught up" is a flat
  banner, not a reward).
- No faces — the community teaser and activity are **icon+text logs**, so the social
  layer feels like an audit trail, not people.
- No streaks, no "your week," no surprise, no warmth beyond the greeting line.

A LinkedIn/Viva home gives a *reason to scroll*. Home currently gives a *list of
chores*. That is the core experience gap.

## 5. Differentiation — logo-off test

**Mixed, and the mix is the problem.** The top (signals, capability actions) is
genuinely more modern than competitors. But the **KPI strip + widget grid (feed /
recognition / holidays cards)** is textbook "HRMS with nicer cards." Result: the
screen contradicts itself — half operating-system, half dashboard. The traditional
half is what a skeptic would remember.

**Where we're still behaving like a traditional enterprise app:**
- KPI tiles as a hero band.
- A widgets grid as the body.
- Dense, small-text cards everywhere.
- People/celebration content ranked *below* numbers and transactions.

## 6. AI — is it ambient?

**No. Not yet.** What we have is *rule-based nudges* (signals) and a *projected log*
(activity). Both are good plumbing. Neither is *intelligence the employee feels.*
There is:
- No **explanation** ("your net pay rose ₹2,400 — mostly higher HRA").
- No **recommendation** ("3 leave days expire this quarter — plan a long weekend?").
- No **prediction** or natural-language insight anywhere on Home.
- The assistant is still a **separate widget**, not present on the surface.

We are presenting structured data *near* the user, not intelligence *for* the user.

## 7. Mobile

**Desktop is now significantly ahead — parity is broken.** `MobileHome` is the
*older* implementation (glossy chips, spotlight, interleaved feed). It does **not**
consume `/ess/signals` or `/ess/activity`, has **no** capability QuickActions, **no**
CelebrationCard. The entire new OS layer exists only on desktop. For a product that
declared "mobile is the most important channel," this is the most urgent regression.

## Persona one-liners

- **First-time employee:** overwhelmed — too many sections, no guidance on what
  matters.
- **Manager:** their #1 need (team pulse) is absent; the approvals nudge is buried.
- **CHRO/CEO:** sees a competent employee dashboard, not a culture/engagement
  showcase. No org pulse, no people-first signal.
- **Apple HIG reviewer:** too dense, too many type sizes, decorative hero, not enough
  whitespace — "establish one focal point and let it breathe."
- **vs LinkedIn / Viva:** they lead with *people and identity*; we lead with *numbers
  and tasks*. Still work-system-first, not employee-first.

---

## The ten biggest experience improvements

1. **Establish ONE focal area above the fold.** Merge hero + top signal into a single
   "Today" card. One clear thing to look at first, not four bands.
2. **Kill the KPI strip as a hero band.** It's the #1 "this is an HRMS" tell. Fold
   leave/pay into a slim inline context line or into the activity, not 3 tiles with
   "View →" links.
3. **Collapse the top stack to two bands:** *Today / what needs you* and *what's
   happening*. Move Quick Actions into a compact bar (or the hero), not its own band.
4. **Make it breathe.** Unify the type scale (kill the 6-size soup), reduce
   `font-extrabold` noise, add whitespace, make cards larger and calmer. Fewer,
   bigger, quieter.
5. **Lead with people, not transactions.** Raise the social/emotional layer
   (celebrations, community, recognition) and make it **visual — avatars and faces,
   not icon+text logs.** This is the LinkedIn/Viva differentiation.
6. **Make AI ambient: add a daily Insight line.** One proactive natural-language
   insight/recommendation derived from existing data ("Net pay up ₹2,400 this month —
   tap to see why"). Explanation and recommendation, not another nudge.
7. **Give activity warmth.** Avatars, richer "moments" framing for salary/recognition,
   group by time. Turn the log into a story of the day.
8. **Add a Manager lens to Home.** A compact team-pulse strip (present today · on
   leave · awaiting you · a team celebration) so Home serves the manager's #1 need.
9. **Close mobile parity.** Bring signals, activity, capability QuickActions and
   celebrations to `MobileHome` — the OS must exist on the most-used device.
10. **One signature delight.** A context-aware greeting that *knows* ("Friday — nearly
    there, Suraj") and a genuinely rewarding "all caught up" state. A small, premium,
    daily-varying reason to feel something.

---

## Prioritized implementation order (experience ROI ÷ effort)

| Pri | Improvement | Why first | New service? |
|---|---|---|---|
| **E1** | #1–#4: hierarchy + breathing (one focal area, demote KPIs, two bands, calm type scale) | Highest felt impact, **pure layout**, zero backend | No |
| **E2** | #6: ambient AI Insight line | Turns "dashboard" into "intelligent" — the biggest perception flip | Tiny — one `/ess/insight` (or reuse assistant) |
| **E3** | #5 + #7: people-first, avatars, warm activity | The emotional reason to return | No (data exists; needs avatar fields) |
| **E4** | #9: mobile parity | Fixes the worst regression; reuses E1–E3 primitives | No (reuse) |
| **E5** | #8 + #10: manager lens + signature delight | Depth + polish once the core feels right | Small (team-pulse may need a service) |

E1 is a **day of pure layout work** with no new architecture and the largest
experience payoff — exactly the "one day improving experience" you asked for.

---

## Wireframe — current vs proposed

**Current (dashboard-shaped):**
```
┌────────────────────────────────────────────┐
│ HERO  greeting + tiny punch chip (decorative)│  ← big, low-function
├────────────────────────────────────────────┤
│ What needs you (signals)                     │
├────────────────────────────────────────────┤
│ [chip][chip][chip][chip][chip][chip]         │  ← 6 quick actions band
├────────────────────────────────────────────┤
│ ┌Leave┐ ┌Net pay┐ ┌Open actions┐  View →    │  ← KPI STRIP (the HRMS tell)
├───────────────────────┬────────────────────┤
│ What happened today    │ Celebrations (cond.) │
│ Community (text log)    │ Recognition          │
│ Manager nudge (buried)  │ Holidays             │
└───────────────────────┴────────────────────┘
```

**Proposed (front-door-shaped):**
```
┌────────────────────────────────────────────┐
│ TODAY                                        │
│  "Good morning, Suraj — Friday, nearly there"│  ← context greeting
│  ◦ one focal thing: top signal OR punch      │  ← single focal point
│  ◦ ✨ Insight: "Net pay up ₹2,400 — why?"     │  ← ambient AI line
│  [ Apply leave ] [ Regularize ] · more ▾     │  ← compact action bar
├───────────────────────┬────────────────────┤
│ WHAT NEEDS YOU         │ PEOPLE              │
│  signal · signal       │  🎂 avatar  Wish     │  ← people-first, faces
│                        │  🏅 avatar  kudos    │
│ WHAT HAPPENED          │  (community w/ faces) │
│  ◦ avatar  moment      │                      │
│  ◦ avatar  moment      │  [slim leave/pay     │
│                        │   context line]      │  ← KPIs demoted to a line
└───────────────────────┴────────────────────┘
   (Manager? a one-line team-pulse strip sits under TODAY)
```

Net effect: **one focal area, fewer bands, faces over numbers, an intelligent line,
and room to breathe** — the same data, re-ranked around emotion and calm.

---

## Low-complexity recommendations (do these, avoid scope creep)

- **Re-rank and remove, don't add.** E1 is mostly deletion and consolidation — fewer
  sections, not more features. Complexity should *go down*.
- **Reuse the primitives we already built** (SignalCard, ActivityItem, QuickActions,
  CelebrationCard, the state primitives). The people-first/avatar work is mostly
  presentation on existing data.
- **One new tiny service max for this round** (`/ess/insight`), and only because the
  ambient-AI line has an immediate, visible consumer.
- **Don't gold-plate animation.** One context greeting + the existing subtle
  celebration is enough delight for now.

---

## The principle this review serves

> Architecture is only successful if the employee forgets it exists. Today Home
> still makes the employee *see the architecture* (sections, tiles, logs). The next
> increment's job is to make it disappear — and leave only how it felt: **calm,
> personal, intelligent, alive.**

*Recommend we execute E1 (hierarchy + breathing) first — one day, pure layout, no new
architecture — then E2 (ambient insight). Re-review Home after E1 before going further.*
