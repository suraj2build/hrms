# CognixHR — Moments · The Significance & Propagation Contract

> **STATUS: FOR FREEZE — part of the Experience Core contract.**
> An appendix to the frozen Event Model (`EXPERIENCE_EVENT_MODEL.md`). It adds no
> new event *shape* and no storage; it adds the rule the Core uses to decide which
> events *deserve to be remembered* — **Moments** — and how a single moment
> propagates across the seven experiences **without duplication**. Derive-on-read,
> consistent with the frozen Core.

---

## 0. Event vs Moment

> **An event is something that happens. A moment is something that deserves to be
> remembered.**

Every `ExperienceEvent` is exposed once by the Core. Most are *routine* — a daily
punch, a monthly payslip — true, but not memorable. A **moment** is the salient
subset: the events an employee would *tell someone about*. The Core decides
significance **once**, centrally, so no surface re-litigates it. This is the
platform-wide generalisation of the rule Timeline already applies ("would I tell
someone about this?") — now binding on every lens.

The payoff: **one moment, many facets, zero duplication.** Because each experience
answers a different human question, the same moment shows a different *face* in each
— never the same card twice. Propagation is by **question**, not by copying.

---

## 1. Significance — the three classes

The Core classifies every event into one of three tiers (`momentClass`). The class,
not the surface, decides reach.

| Class | Meaning | How it surfaces |
|-------|---------|-----------------|
| **routine** | happened, not memorable | aggregate only — a count, a streak, a folded summary. Never an individual remembered row. |
| **moment** | worth remembering | enters Memory (My Story); may peek in Today; may reach People surfaces by visibility. |
| **milestone** | a growth beat | everything a *moment* does **plus** it enters the Growth spine (My Growth / Journey). |

Nesting: **milestone ⊂ moment ⊂ event.** Classification rules (derive-on-read, from
category + context — never fabricated):

- **routine:** attendance punches; routine single-day leave; recurring monthly payslips;
  document/profile edits.
- **moment:** recognition (given/received); a real break or life-event leave; birthdays;
  company announcements; an anomalous/!first pay change worth noting.
- **milestone:** joined; first payslip; first recognition; service anniversaries;
  confirmation; promotion; role change; team change; learning completion. *(The last five
  are defined here and propagate automatically the day their event sources emit — never
  invented.)*

---

## 2. The propagation matrix

For each major category: which lenses a moment reaches, and the **facet** it shows
there. Empty cell = the moment has nothing to say to that lens's question, so it does
**not** appear (silence is the anti-duplication mechanism). Visibility + RBAC gate every
People-surface cell on top (Event Model §3).

| Category (class) | My Day · *Today* | My Story · *Memory* | My Growth · *Growth* | My Attention · *Need* | My Team · *near* | My Company · *far* | My Assistant · *ask* |
|---|---|---|---|---|---|---|---|
| **Recognition received** (moment / first = milestone) | peek if today | row + giver's face | strength + count; *first* = Journey milestone | — *(no action)* | manager: "your report was seen" | feed if public | "who recognised me & why" |
| **Recognition given** (moment) | minor | "you recognised X" | generosity signal | — | manager: engagement | feed if public | context |
| **Leave — real break / life-event** (moment / life = milestone) | "you're off" context | "you took 5 days off" | life-event = life milestone | — | coverage / who's out | — *(private)* | balance & explain |
| **Leave — pending request** (routine→need) | — | — | — | **the action** (approve / track) | manager: to approve | — | "where's my request?" |
| **Payroll — released** (routine; *first* = milestone) | payday focus | folded summary; *first* = milestone | *first payslip* only | "payslip ready" (once) | — | — | "explain my pay change" |
| **Joined** (milestone) | first-day welcome | origin chapter | Journey origin | onboarding tasks | "X joined" — welcome | company welcome | "help me get set up" |
| **Anniversary** (milestone) | celebration context | milestone row | Journey step | — | team celebration | company celebration | — |
| **Birthday** (moment) | celebration peek | — *(personal, recurring)* | — | — | team wish | company wish | — |
| **Promotion / role / team change · confirmation** (milestone, *future source*) | "congrats / new role" | major chapter break | **headline Journey beat** | role-onboarding tasks | org-change awareness | feed if appropriate | "what changes for me" |
| **Learning completed** (milestone, *future source*) | minor | memory | skills/learning Journey beat | next learning step | manager: skill growth | — | "recommend next" |
| **Announcement** (moment, company) | teaser | — *(not personal memory)* | — | ack if required | if team-targeted | **its home** | "what was announced" |
| **Document expiring** (routine→need) | — | — | — | **renew action** | — | — | "how do I renew" |
| **Attendance punch** (routine) | today's status | aggregate streak only | consistency trait (aggregate) | missing punch = need | — | — | "my hours this week" |

---

## 3. The flagship trace — Recognition (one moment, seven facets)

The example you named, made exact — note no facet repeats another:

- **My Day** — *"You were recognised today"* — a peek in the present, links onward. (relevance)
- **My Story** — a memory row with the **giver's face** and their words. (what happened)
- **My Growth** — adds to *what you're known for*; if it's your first, a **Journey milestone**. (who I'm becoming)
- **My Attention** — **nothing.** Recognition needs no action; it never clutters the need-queue. (the boundary that proves the model)
- **My Team** — the manager sees *"your report was recognised"* — team awareness, not the employee's copy. (near people)
- **My Company** — a community-feed item **only if** visibility is public. (far people)
- **My Assistant** — can *explain* on request: *"Priya recognised you for the launch."* (asked)

Same fact, same id, same `at`. Seven questions, seven faces, zero duplicate cards.

---

## 4. The governing principles (the contract)

1. **Significance is decided once.** The Core's `momentClass` is authoritative; no surface
   re-classifies. Change the rule in one place, every lens follows.
2. **Propagation is by question, not by copy.** A moment reaches a lens **only if** it has
   something to say to that lens's one question; otherwise it is absent. Absence is how
   duplication is prevented.
3. **Action is My Attention's alone.** A moment touches My Attention **only** when it
   genuinely requires an action. Resolved or no-action moments never appear there.
4. **Memory is selective; Growth is rarer still.** routine → aggregate only; moment →
   memory; milestone → memory **and** the Growth spine. The spine stays sparse and proud.
5. **Visibility gates reach; RBAC gates access.** People-surface propagation (Team/Company)
   follows the event's `visibility`, enforced by server-side RBAC on top.
6. **Never fabricate to fill a cell.** A future category (promotion, learning) propagates
   the day its event source emits — not before. A thin matrix today is honest, not broken.
7. **Derive-on-read.** Moments add no storage; the classifier and propagation are computed
   over the canonical stream. A materialised `experience_moments` model appears only if a
   real surface's continuity demands it (grow on demand).

---

## 5. Freeze

This contract joins the Experience Core constitution: **events are exposed once; the Core
decides which become moments; each moment is faceted by each lens's question; nothing
duplicates.** Timeline's existing selectivity is the first instance; My Growth will be the
second consumer (the milestone facet), at which point the classifier is centralised into a
shared Core helper (grow on demand).

The architecture, navigation, and mental model are now frozen. Implementation proceeds —
**My Growth (Identity)** first. Future change comes from real product usage, not redesign.

*Events happen. Moments are remembered. One world, faceted seven ways.*
