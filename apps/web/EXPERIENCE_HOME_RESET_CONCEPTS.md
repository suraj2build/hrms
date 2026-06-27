# Home, Reset — 10 Concepts for the Front Door of an Employee OS

> **This is a design document, not an implementation.** No components are proposed here.
> We are choosing an *experience*, not decorating an interface. Implementation begins only
> after one concept is selected.

---

## Why we are resetting

The current Home is *good enterprise software*. That is the problem. It is still a
**dashboard**: a spine of widgets (signals, day, people, company, progress, holiday,
reflection), each a discrete unit of roughly equal visual weight, stacked. Atmosphere was
added on top — but a beautiful gradient over a widget list is still a widget list. The
gradient became **decoration**, not reinforcement.

A dashboard answers *"what is my status?"* The first feeling it produces is **work to do**.

We want the opposite first feeling. When you open your front door at home, you don't see a
status report of your house. You feel *you're home* — and only then notice the dishes. Home
should feel like **arriving at your workplace**, where the first felt thing is:

> **"I belong here."** → *then* → "and here's what matters today."

That reorders the entire design. Belonging is the **lasting psychological outcome** of Home;
direction is the *second* beat, earned only after you feel held. Everything below is judged
on whether it produces that order of feeling.

### The one rule that kills "dashboard"

**One dominant visual idea owns the screen. Everything else whispers in support.** A dashboard
has many things shouting at equal volume. An experience has *one thing speaking*, and a quiet
chorus behind it. If a concept can't name its single dominant idea in four words, it's a
dashboard wearing a gradient.

### Constraints (hard)

No dashboards · no widget grids · no KPI cards · no equal-sized panels · no artificial
symmetry · no "enterprise layout." Content always wins over atmosphere. Architecture, Core,
data, nav, and the Moments model remain **frozen** — every concept consumes the *same*
`/ess/home`, `/ess/signals`, `/ess/activity` data. We are reinventing *presentation only*.

### How to read the sketches

Each ASCII frame shows the **content canvas** (the persistent left nav rail is frozen IA and
omitted from the sketches). `▓` = atmospheric/immersive field. `·` = intentional empty space.
Faces are drawn `(◕)`.

---

## The five questions, answered for all ten

Each concept answers: **① first thing seen · ② emotional journey · ③ what owns 70% · ④ what is
intentionally NOT shown · ⑤ why return tomorrow.**

---

## 1 · The Threshold

**Vision:** Opening Home feels like walking through your company's front door at the start of
the day — an arrival, not a load.

**Emotional outcome:** *Belonging.* "I'm home. This is my place."

```
┌───────────────────────────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓  cinematic time-of-day atmosphere  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓                                                   ▓▓▓▓│
│▓▓        Good morning, Priya.                          ▓▓│  ← serif, huge
│▓▓        Tuesday feels calm. You're all set.           ▓▓│  ← one human line
│▓▓                                                       ▓▓│
│▓▓▓▓     (◕)(◕)(◕)  3 of your team are already in       ▓▓▓│  ← faint presence
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                                                           │
│   ·····  (scroll to step inside: the day unfolds)  ·····  │  ← everything else
│                                                           │     is below the fold
└───────────────────────────────────────────────────────────┘
```

- **①** A full-bleed atmospheric "doorway" that *is the time of day*, your name in serif, and
  one sentence about the feeling of the day — not its tasks.
- **②** Arrival → reassurance → *only on scroll* does the day's substance appear.
- **③** The atmospheric threshold field + the greeting. The fold is a deliberate horizon.
- **④** No tasks, counts, KPIs, or actions above the fold. Nothing to *do* until you've
  arrived.
- **⑤** Because the door greets *you* by name, with today's light — it's a small daily ritual,
  like a barista who knows your order.

**Why it isn't enterprise HR:** Enterprise software opens with *work*. This opens with
*welcome*. The first interaction is emotional, not transactional. The fold is used as a
dramatic device — unheard of in a tool whose whole point is density.

**Pros:** Strongest possible "I belong" hit; the atmosphere finally *reinforces* (arrival)
instead of decorating; deeply ownable and brand-defining.
**Risks:** Power users may resent scrolling past the welcome daily; "below the fold" must be
genuinely useful or it reads as style-over-substance; weakest for someone who opens Home 12×/day
to *do* one thing fast.

---

## 2 · The Morning Letter

**Vision:** Each morning Home is a short, personal letter written *to* the employee — first
person, warm, edited down to what actually matters.

**Emotional outcome:** *Meaning + calm.* "Someone is paying attention to my day."

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   Tuesday, 27 June                          ·····         │  ← dateline, quiet
│                                                           │
│   Priya —                                                 │  ← editorial serif,
│                                                           │     reads like prose
│   It's a quiet one today. You're caught up, and           │
│   nothing's waiting on you. Aarav's back from leave —     │
│   he'd probably like a hello. Payday lands Friday.        │
│                                                           │
│   When you're ready, your day's below.                    │
│                                          — Cognix          │  ← signed
│                                                           │
│   ───────────────────────────────────────────────         │
│   ·····      (the day, told as continuing prose)   ·····  │
└───────────────────────────────────────────────────────────┘
```

- **①** A dateline and a salutation with your name — a letter, not a screen.
- **②** Being addressed → feeling *noticed* → the day told as narrative, not list.
- **③** A single column of warm editorial prose, generous leading, lots of margin.
- **④** No icons, no buttons, no tiles, no numbers-as-tiles. Counts dissolve into sentences
  ("payday lands Friday," not "Net pay ₹—").
- **⑤** The letter is *different every day* and speaks to your real situation — you come back
  to hear what today's says.

**Why it isn't enterprise HR:** Enterprise software never uses *prose*. This is radically
anti-widget: language is the entire interface. It feels authored, human, and singular.

**Pros:** Unmatched intimacy and "calm/meaning"; impossible to mistake for a dashboard;
showcases the ambient-AI voice as the product's soul.
**Risks:** Leans hardest on copy quality — a flat sentence breaks the spell; localization and
tone-at-scale are real work; actions still need a home (must resolve gracefully below the
letter); risk of feeling slow for transactional users.

---

## 3 · The Living Canvas

**Vision:** Home is one large, slowly-breathing canvas of the *company as a living organism* —
you are a point of light within something alive.

**Emotional outcome:** *Belonging + connection.* "I'm part of something bigger that's moving."

```
┌───────────────────────────────────────────────────────────┐
│  ▓ a single wide living field — faces & moments drift ▓    │
│                                                           │
│     (◕)Aarav back      (◕)Maya · 5 yrs today              │
│         ·         (◕)(◕)(◕) standup in 20m       ·        │
│   YOU ──┐                                                  │
│  (◕)    └→ gentle lines connect you to your people        │
│         (◕)Dev shipped       ·        (◕)new joiner: Sara │
│                                                           │
│   ·  the canvas is mostly calm space; motion is rare  ·   │
│                                                           │
│   ▁▁▁▁ a thin, quiet strip: "what needs you" (only if any)│
└───────────────────────────────────────────────────────────┘
```

- **①** A wide, calm field where *you* sit connected by soft threads to the people and
  moments around you — life, not a feed.
- **②** Locating yourself → seeing you're connected → noticing one human moment to act on.
- **③** The relational canvas of people and live company moments.
- **④** No lists, no module grid. Your *own* tasks are demoted to one thin strip, shown only
  when something truly needs you.
- **⑤** The canvas is never the same twice — people moved, someone's celebrating, the org
  breathed. You return to see how the organism shifted.

**Why it isn't enterprise HR:** It inverts the figure/ground of every HR tool — *the company
and its people are the foreground*, your task list is the background. It's spatial and
relational, not a stack of cards.

**Pros:** Most "alive" of all concepts; uniquely expresses People-as-interface; very hard to
imitate.
**Risks:** Spatial layouts fight responsive/mobile hardest; "where do I click to do X" can
suffer; motion must be *very* restrained or it becomes a toy; demands real relational data to
not feel sparse for lone-wolf roles.

---

## 4 · The Front Page

**Vision:** Home is the morning newspaper *of your work life* — one masthead, one lead story,
everything ruthlessly edited by importance.

**Emotional outcome:** *Direction.* "I know the one thing that matters, instantly."

```
┌───────────────────────────────────────────────────────────┐
│   THE DAILY · Priya's edition            Tue 27 Jun       │  ← masthead
│   ═════════════════════════════════════════════════════   │
│                                                           │
│   YOU'RE CLEAR FOR TODAY                                   │  ← ONE giant headline
│   Nothing needs you. Aarav's back; say hi.                │  ← deck/standfirst
│                                                           │
│   ─────────────┬─────────────────────────────────────     │
│   In brief     │  Around the company                      │  ← editorial columns,
│   • Pay Fri    │  Maya marks 5 years today.    (◕)        │     UNequal width
│   • 6 leave    │  Two new joiners this week.              │
│                │                                          │
└───────────────────────────────────────────────────────────┘
```

- **①** A masthead with *your* edition, then one dominant headline that states your day's
  truth in 3–5 words.
- **②** Orientation (it's my paper) → the lead (the one thing) → optional browse (in brief).
- **③** The lead headline — typographically enormous, the single focal point.
- **④** No equal panels: a newspaper is *deliberately* asymmetric. No KPI tiles — numbers live
  inside "in brief" as a quiet column.
- **⑤** A fresh front page every day with a new lead — the headline is a tiny daily hook.

**Why it isn't enterprise HR:** Editorial hierarchy (one lead, then asymmetric columns) is the
*opposite* of the symmetric grid. Importance is expressed by *size and position*, not by
identical cards.

**Pros:** Best "direction" outcome; instantly legible; asymmetry kills the dashboard feel
while staying information-rich; familiar metaphor lowers the learning curve.
**Risks:** Newspaper ≠ "belonging" — it's more *informational* than *emotional*; the metaphor
can feel busy if columns multiply; the "lead story" engine must reliably pick the *right* lead
or it misfires.

---

## 5 · The Gallery

**Vision:** Home is a quiet museum of *your* working life — vast negative space, a few framed
moments, nothing competing for attention.

**Emotional outcome:** *Calm + pride.* "My work is worth pausing over."

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   ·····················································     │
│   ·                                                 ·     │
│   ·            (◕)                                   ·     │  ← one "piece"
│   ·     Aarav recognized you.                        ·     │     centered in
│   ·     "Carried the launch." — Tuesday              ·     │     vast space
│   ·                                                 ·     │
│   ·····················································     │
│                                                           │
│        ·  ·  ·   (scroll: the next piece, alone)   ·  ·   │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

- **①** A single framed moment, centered, surrounded by deliberate emptiness — like the one
  painting on a gallery wall.
- **②** Stillness → attention drawn to one thing → quiet pride → step to the next "piece."
- **③** **Negative space** owns 70%. The content is small; the *space around it* is the design.
- **④** Almost everything. Density is the enemy. One thing at a time; counts and actions are
  hidden in a quiet menu.
- **⑤** Calm is addictive in a noisy workday — people return for the *feeling*, and to see
  which moment is on the wall today.

**Why it isn't enterprise HR:** HR software fears empty space; this *worships* it. Emptiness as
the primary material is the antithesis of "maximize information density."

**Pros:** Most distinctive "calm"; makes every shown moment feel precious; gorgeous, premium,
unforgettable.
**Risks:** Can feel *too* sparse / "where's my stuff?"; poor for high-task-volume days; risks
preciousness; needs a strong "but I need to act fast" escape hatch.

---

## 6 · The People Wall

**Vision:** The first thing you see is *people* — your team and company as faces, at scale,
before any task exists.

**Emotional outcome:** *Connection + belonging.* "These are my people."

```
┌───────────────────────────────────────────────────────────┐
│   Your people, today                                      │
│                                                           │
│   (◕)  (◕)  (◕)  (◕)  (◕)   ← large warm faces, in/out    │
│   Aarav Maya  Dev  Sara  You      shown by soft state     │
│                                                           │
│   (◕) Maya — 5 years today        ·  say something →      │  ← one human prompt
│                                                           │
│   ─────────────────────────────────────────────────       │
│   ·····   your day waits quietly under your people  ····· │
└───────────────────────────────────────────────────────────┘
```

- **①** A warm wall of real faces — who's in, who's out, who to celebrate.
- **②** Recognizing your people → feeling part of them → one nudge to connect → then your work.
- **③** Faces, at large scale, occupying the top two-thirds.
- **④** No task tiles up top; your individual to-dos sit *below* your people — relationships
  before transactions.
- **⑤** Faces change daily — someone's celebrating, someone's back, a new joiner — and there's
  always one easy human gesture to make.

**Why it isn't enterprise HR:** HR tools reduce people to rows and ids; this makes *humans the
home screen*. It says the company is people first, process second.

**Pros:** Purest expression of People-as-interface; immediate warmth/belonging; leverages
existing celebration/team data.
**Risks:** Privacy/comfort around presence states; weak for solo/remote roles with few
connections; can feel like a social network rather than a workplace OS if not anchored by the
day.

---

## 7 · The Single Question

**Vision:** Radical reduction — Home is essentially *one sentence*: the single most important
truth about your day, and nothing else until you ask for more.

**Emotional outcome:** *Calm + direction.* "There is exactly one thing, and I can hold it."

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│                                                           │
│                                                           │
│            You're all caught up.                          │  ← the whole screen
│            Enjoy the quiet, Priya.                        │     is one truth
│                                                           │
│            ·  nothing needs you  ·                        │
│                                                           │
│                          ⌄  (everything else, on demand)  │  ← one quiet affordance
│                                                           │
└───────────────────────────────────────────────────────────┘
```

- **①** One sentence, centered, that *is* the state of your day ("You're all caught up" /
  "One thing needs you: approve Dev's leave").
- **②** Total focus → relief or clarity → expand only if you choose.
- **③** One line of text in a field of calm — the most extreme "one dominant idea."
- **④** Everything, by default. The day, people, company, actions are all one tap away but
  *invisible* until summoned.
- **⑤** It's the fastest possible "am I okay?" check in the building — a daily exhale.

**Why it isn't enterprise HR:** It is the *anti-dashboard* — it shows almost nothing on
purpose. No other HR product would dare make the home screen a single sentence.

**Pros:** Unbeatable calm + clarity; brilliant on mobile; bold, memorable, confident.
**Risks:** Can feel *empty/under-built* to stakeholders ("we paid for this?"); hides utility a
beat too far for power users; the single sentence must be *right* every time or trust erodes
fast; weakest for genuinely busy days.

---

## 8 · The Horizon (one continuous scroll)

**Vision:** Home is a single, uninterrupted vertical journey through your day — *now* at the
top, the day unfolding downward, the future on the horizon. No columns, ever.

**Emotional outcome:** *Direction + possibility.* "I can see my whole day as one path."

```
┌───────────────────────────────────────────────────────────┐
│   ▓ now ▓   Good morning. It's calm.                      │  ← top: the present
│      │                                                     │
│      ●  9:30  you're in. nice and early.                  │
│      │                                                     │  ← ONE thread,
│      ●  today  nothing needs you                          │     top to bottom,
│      │                                                     │     no branches
│      ●  Fri   payday                                       │
│      │                                                     │
│      ◌  ahead  Maya's 5 years · your review in 3 wks       │  ← horizon: future
│   ·····              keep going ↓                  ·····   │
└───────────────────────────────────────────────────────────┘
```

- **①** "Now," at the top, in atmosphere — then a single line you follow downward.
- **②** Present → the day's beats in sequence → the horizon ahead → a sense of *forward*.
- **③** One vertical thread. No second column exists anywhere — the structure itself refuses
  the dashboard.
- **④** No grid, no sidebar of widgets, no symmetry. Time is the only organizing principle.
- **⑤** The thread is always moving — new beats, a nearer horizon. It's *your* day as a story
  with a direction.

**Why it isn't enterprise HR:** A dashboard is 2D (a grid); this is strictly 1D (a line). One
thread is impossible to perceive as "widgets" — it's a narrative.

**Pros:** Naturally responsive (one column = same on mobile); structurally *cannot* become a
dashboard; unifies past/now/future into one felt arc; closest evolution of today's spine, so
lower risk.
**Risks:** Closest to the *current* design — must feel decisively more narrative or it reads as
"the same list, restyled"; long scrolls can bury fast actions; "horizon/future" needs real
forward data to deliver possibility.

---

## 9 · The Atrium

**Vision:** Home is the *lobby of your building* — a sense of place and ambient presence you
step into, where the company's pulse is felt as environment, not content.

**Emotional outcome:** *Belonging + calm.* "I've arrived somewhere real."

```
┌───────────────────────────────────────────────────────────┐
│ ▓▓▓ a sense of architectural space — depth, light, air ▓▓▓ │
│ ▓                                                       ▓ │
│ ▓   Welcome back, Priya.            27 present today    ▓ │  ← ambient presence,
│ ▓                                   the building's awake ▓ │     felt not listed
│ ▓        ·  ·  ·  ·  ·  ·  ·  ·  ·                       ▓ │
│ ▓                                                       ▓ │
│ ▓   ┌── today's noticeboard (one quiet item) ──┐       ▓ │  ← like a lobby board
│ ▓   │ Maya marks 5 years. Sign the card →       │       ▓ │
│ ▓   └──────────────────────────────────────────┘       ▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└───────────────────────────────────────────────────────────┘
```

- **①** A sense of *space* with depth and light — and a soft signal that the building is alive
  ("27 present today") — before any task.
- **②** Stepping in → "the place is awake, people are here" → one lobby-board moment → into
  your work.
- **③** Architectural atmosphere (depth, air, light) as a *place*, not a backdrop.
- **④** No task grid; presence and place lead. Work is reached by walking deeper, not by
  scanning tiles.
- **⑤** The building feels inhabited and different each morning — arriving is its own small
  comfort.

**Why it isn't enterprise HR:** It designs a *place*, not a screen. Spatial belonging is a
category no HRMS attempts.

**Pros:** Strong, unusual "belonging via place"; atmosphere is genuinely load-bearing here
(it's the *room*); pairs naturally with cinematic imagery.
**Risks:** "Sense of place" is hard to achieve without heavy art direction; can drift toward
decoration if the room has nothing to *do*; presence data raises the same privacy questions as
#6; abstract — hardest to spec precisely.

---

## 10 · The Almanac (day-as-weather)

**Vision:** Home reads the *weather of your workday* — a single, honest forecast of how today
will feel (calm, busy, celebratory, heavy) — and dresses the whole screen in it.

**Emotional outcome:** *Calm + direction.* "I know what kind of day this is before I start."

```
┌───────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓ atmosphere = today's "weather" (here: clear) ▓▓▓▓▓▓▓ │
│                                                           │
│        Today looks clear.                                 │  ← the forecast,
│        Light load, one celebration, no deadlines.         │     in plain words
│                                                           │
│        ☼  calm   ·   (◕) Maya · 5y   ·   pay Fri          │  ← three honest
│                                                           │     "conditions"
│   ·······   the hours ahead, only if you look   ·······   │
└───────────────────────────────────────────────────────────┘
```

- **①** A one-word "forecast" of the day's *character* (Clear · Busy · Celebratory · Heavy),
  with the whole atmosphere matching it.
- **②** Reading the day's weather → mentally bracing or relaxing accordingly → optional detail.
- **③** The forecast statement + its matching environment.
- **④** No tiles, no counts as primary; the day's "conditions" are 2–3 honest words, not
  metrics.
- **⑤** Tomorrow's weather is genuinely different — and knowing the day's *character* up front
  is a uniquely useful, calming ritual.

**Why it isn't enterprise HR:** It reports a *feeling/character*, not data. The atmosphere is
literally the information (clear vs. heavy), so it can never be mere decoration.

**Pros:** Atmosphere becomes *content* (perfectly satisfies "atmosphere reinforces outcome");
emotionally honest; sets expectations, reducing anxiety; very ownable concept.
**Risks:** The "forecast" model must be trustworthy — a wrong read ("clear" on a hard day)
breaks it badly; risk of gimmick if over-literal with weather metaphor; less directly
"belonging" than place/people concepts.

---

## At a glance

| # | Concept | Dominant idea (≤4 words) | Lasting outcome | 70% of screen | Boldness | Risk |
|---|---------|--------------------------|-----------------|---------------|:-------:|:----:|
| 1 | **The Threshold** | Walking through the door | Belonging | Arrival atmosphere | High | Med |
| 2 | **The Morning Letter** | A letter to you | Meaning · calm | Editorial prose | High | Med |
| 3 | **The Living Canvas** | The company, alive | Belonging · connection | Relational field | Very high | High |
| 4 | **The Front Page** | One lead headline | Direction | The headline | Med | Low |
| 5 | **The Gallery** | One framed moment | Calm · pride | Negative space | High | Med-high |
| 6 | **The People Wall** | My people, first | Connection · belonging | Faces at scale | Med-high | Med |
| 7 | **The Single Question** | One sentence | Calm · direction | One line of truth | Very high | High |
| 8 | **The Horizon** | One continuous thread | Direction · possibility | A vertical line | Med | Low-med |
| 9 | **The Atrium** | Arriving at a place | Belonging · calm | Architectural space | High | High |
| 10 | **The Almanac** | The day's weather | Calm · direction | Forecast + environment | Med-high | Med |

---

## Recommendation (for discussion, not decision)

The brief's north star is **"I belong here" *before* "I have work to do."** Three concepts hit
that ordering most directly, by feeling:

- **For belonging-first arrival → #1 The Threshold.** The purest answer to the literal brief:
  Home becomes a doorway, and the atmosphere finally *does a job* (arrival) instead of
  decorating. Safer than the spatial concepts, more emotional than the editorial ones.
- **For an unmistakably non-software soul → #2 The Morning Letter.** Nothing reads less like a
  dashboard than prose addressed to you by name. Highest intimacy; rests on writing quality.
- **For structural certainty it can't regress to a dashboard → #8 The Horizon.** One thread,
  no columns — the layout itself forbids widgets. Lowest risk, evolves today's spine, but the
  least radical.

A strong path is a **hybrid: The Threshold as the entry (arrival/belonging), opening onto The
Horizon below (one continuous thread for the day).** That gives belonging *first* and direction
*second* — the exact psychological order the brief demands — without a column grid anywhere.

Pure-calm bets (#5 Gallery, #7 Single Question) are the most differentiated but the riskiest
with stakeholders; the people/place bets (#3, #6, #9) are the most alive but the heaviest to
build well and the most data-/art-dependent.

> **Next step:** select one concept (or a hybrid). Only then does implementation begin — and it
> begins by designing *that one experience* to its lasting outcome, not by restyling the
> current page.
