# CognixHR — Experience Event Model · The Canonical Event Grammar

> **STATUS: DESIGN FOR FREEZE** — the foundation that must be frozen *before*
> Timeline (and Notifications, and Community 2.0) are built. Part of the platform
> constitution alongside `EXPERIENCE_PATTERNS.md`.
> Authored as a short design iteration at the explicit direction: *"Before
> implementing Timeline, define the canonical Event model that every future
> experience will consume."*

---

## 0. Why this exists (the one decision this prevents)

Without this, three surfaces would each invent their own event shape:

- **Timeline** would grow a `TimelineEntry`,
- **Notifications** would grow a `Notification`,
- **Community** would grow a `FeedActivity`,

and within a quarter the same real-world fact — *"Priya recognised you"* — would
exist three times, in three shapes, ranked by three different rules, deep-linking to
three different places. The platform would stop feeling like one product.

The fix is a single rule:

> **The Experience Core exposes Events once. Every surface composes them differently.**

There is **one** canonical `ExperienceEvent`. Timeline, Notifications, Home Activity,
Community Activity, Manager Activity, Executive Activity, AI Reflection, Recognition,
and the Audit Story are all **consumers** — each a *projection* (filter + rank + frame)
over the same event stream. None of them owns an event shape of its own.

And the distinction that must survive implementation:

> **Timeline is not a log. Notifications are not alerts.**
> They are *different stories told from the same events* — one is memory, one is
> "what needs me now." The events are identical; only the lens differs.

---

## 1. The canonical `ExperienceEvent`

Exactly the twelve fields directed, plus a stable `id` (any model needs one) and a
small `flags` bag for view hints. This is the **source-of-truth shape**; every
pattern-level contract (`Event` §3.3, `Signal` §3.2) is a *view* of it (§6).

```ts
interface ExperienceEvent {
  id:            string                 // stable, deterministic — `${category}:${sourceId}` (idempotent across re-projection)

  // ── WHO ──────────────────────────────────────────────
  actor:         Party | null           // who performed the action (approver, recogniser, the system). null = self-evident/system
  subject:       Party                  // who/what it is about — almost always the viewer ("you")
  relatedPeople: Party[]                // the rest of the cast: cohort, mentioned, cc'd — faces beyond actor/subject

  // ── WHAT ─────────────────────────────────────────────
  action:        string                 // canonical verb key — 'leave.approved', 'recognition.received', 'payroll.released', 'employee.joined'
  category:      EventCategory          // the bucket — attendance | leave | payroll | recognition | announcement | lifecycle | document | approval | system
  narrative:     string                 // the human, people-aware sentence — "Priya recognised you as a Team Player"

  // ── WHEN ─────────────────────────────────────────────
  at:            string                 // ISO-8601 timestamp — THE canonical ordering key (one clock for every surface)

  // ── WHERE / SO-WHAT ──────────────────────────────────
  context:       Record<string, string | number | boolean>  // structured situational data — { period, amount, leave_type, days, badge, location }
  deepLink:      string | null          // canonical href into the module of record (one destination, every surface agrees)

  // ── HOW IT'S TREATED ─────────────────────────────────
  visibility:    Visibility             // the audience grammar — self | team | managers | company | executive
  severity:      Severity               // info | success | warn | urgent — drives the Need/Notification lens, ignored by the Story lens

  // ── THE INTELLIGENCE LAYER ───────────────────────────
  aiExplanation: string | null          // optional ambient/reflection sentence — set ONLY when genuinely insightful, else null

  flags?:        EventFlags             // view hints (not semantics): { milestone?, actionable?, social? }
}

interface Party { id: string; name: string; subtitle?: string; kind: 'employee' | 'manager' | 'system' | 'group' }

type EventCategory = 'attendance' | 'leave' | 'payroll' | 'recognition'
                   | 'announcement' | 'lifecycle' | 'document' | 'approval' | 'system'
type Visibility    = 'self' | 'team' | 'managers' | 'company' | 'executive'
type Severity      = 'info' | 'success' | 'warn' | 'urgent'
interface EventFlags { milestone?: boolean; actionable?: boolean; social?: boolean }
```

### Field semantics (the contract each consumer relies on)

| Field | Meaning | Who sets it | Notes |
|-------|---------|-------------|-------|
| `id` | Stable identity | projector | `category:sourceId` — re-projecting the same fact yields the same id (dedupe across surfaces, mark-as-read survives refresh) |
| `actor` | The doer | projector | `null` when the system or the passage of time is the doer (anniversary, slip released) |
| `subject` | The about-whom | projector | the viewer for self-surfaces; a report for Manager; a team for Executive |
| `relatedPeople` | Supporting cast | projector | cohort on a join, the team on an announcement — the faces that make memory human |
| `action` | Canonical verb | projector | a **closed, namespaced vocabulary** (`domain.verb`); surfaces switch on category, never parse `narrative` |
| `category` | The bucket | projector | the primary filter axis; new categories light up every surface with zero view changes |
| `narrative` | Human sentence | projector | people-aware, past-tense, already-rendered — the Story lens shows it verbatim; **never** a raw column dump |
| `at` | Timestamp | source row | the single clock — one ordering key shared by every surface (no per-surface sort drift) |
| `context` | Structured facts | projector | machine-readable extras a surface may reformat (₹ amount, leave dates, badge code); never free text the UI must parse |
| `deepLink` | Canonical destination | projector | one agreed href into the module of record; Timeline, Notification and Activity all jump to the same place |
| `visibility` | Audience grammar | projector | **see §3** — the audience tag, enforced on top by server-side RBAC |
| `severity` | Urgency | projector | the **Notification/Need** axis. The **Story/Timeline** lens deliberately ignores it (memory has no urgency) |
| `aiExplanation` | The reflection | projector / AI | the one place AI speaks. `null` unless specific-and-true (no fortune cookies) — Reflection consumes this, Timeline interleaves it |
| `flags` | View hints | projector | `milestone` → Story chaptering; `actionable` → Notification inclusion; `social` → Community inclusion |

---

## 2. The Core service — Events exposed once

A **single** projection endpoint feeds every consumer. It reuses exactly the source
queries `/ess/activity` and `/ess/signals` already proved (attendance · leave ·
payroll · recognition · announcements · lifecycle from `employees` · engine tables),
widened and normalised into `ExperienceEvent`.

```
GET /ess/events?scope=self|team|org&since=<iso>&cursor=<iso>&limit=40&categories=…
→ { events: ExperienceEvent[], nextCursor: string | null }
```

- **Project, don't own** (Patterns §6). The module of record stays the source of truth;
  this endpoint reads + merges + normalises + ranks. It writes nothing.
- **Tenant + RBAC scoping server-side, always fresh.** `scope` is *requested*; the
  server intersects it with the caller's role and `visibility` (§3). A self-user can
  never receive another person's `self`-visibility events, whatever they pass.
- **`safe()` every sub-query** — a failed source yields fewer events, never a 500.
- **One clock, one id space.** Deterministic ids + the shared `at` key are what let
  Notifications mark-as-read an event Timeline also shows — same fact, same id.
- **Grow on demand.** `/ess/timeline`, `/ess/notifications`, etc. become **thin views**
  over this one projection (or thin server wrappers that apply the consumer's lens);
  no consumer re-queries source tables itself. `experience_memory` is materialised only
  if per-read projection over deep history gets heavy (Patterns §6) — not pre-built.

---

## 3. Visibility & access (the field that does the most work)

`visibility` is the **audience grammar** — it says *who an event is a story for* — and
it is the seam where the same stream fans out to different surfaces:

| `visibility` | The event is part of… | Consumed by |
|--------------|----------------------|-------------|
| `self` | the subject's own private record | Timeline, Home Activity, Notifications (to the subject) |
| `team` | a team's shared awareness | Manager Activity, Community (team), the team members' Notifications |
| `managers` | the management line of the subject | Manager Activity, an approver's Notifications |
| `company` | everyone's shared story | Community Activity, company-wide Notifications |
| `executive` | org-level signal/aggregate | Executive Activity, Executive Reflection |

**Critical:** `visibility` is a *tag on the event*, **not** the access control. Real
enforcement is the unchanged server-side **tenant + role + self** scoping applied on
top. Visibility decides *which story an event belongs to*; RBAC decides *whether this
caller may receive it at all*. Both must pass. A `team`-visible event still only
reaches managers/members the RBAC layer authorises. This keeps the audience grammar
expressive without it becoming a security mechanism on its own.

---

## 4. The consumers — same events, different stories

This is the whole point. Each surface is a **pure projection** over the one
`ExperienceEvent[]`. None adds an event shape; each adds a *lens* (filter + rank +
which patterns it composes them into).

| Consumer | Filter | Rank by | Pattern it renders | The story it tells |
|----------|--------|---------|--------------------|--------------------|
| **Timeline** | `subject = me`, full range, paginated | `at` desc, **ignore severity** | **Story** (time-grouped, milestones, interleaved `aiExplanation`) | *"What has my time here meant?"* — memory |
| **Notifications** | `actionable \|\| severity ≥ warn \|\| addressed-to-me`, unread, recent | **severity desc, then `at`** | **Need** (ranked `SignalCard`s) | *"What needs me now?"* — attention |
| **Home Activity** | `subject = me`, last ~2 days | `at` desc, take few | **Story (today slice)** | *"What happened today?"* |
| **Community Activity** | `visibility ∈ {company, team}`, `flags.social` | `at` desc | **People + Story** (faces on every item) | *"What's happening around us?"* |
| **Manager Activity** | `visibility ∈ {team, managers}` for my reports | severity, then `at` | **Need + People** | *"What about my team needs me?"* |
| **Executive Activity** | `visibility = executive`, aggregated | impact | **Reflection + Progress** (org aggregates) | *"Where should I look?"* |
| **AI Reflection** | events as **evidence**, any scope authorised | insight strength | **Reflection** (one `aiExplanation`, memory-aware) | *"What should I know that I didn't ask?"* |
| **Recognition** | `category = recognition` | `at` desc | **People** | *"Who saw me / whom did I see?"* |
| **Audit Story** | all, factual framing, **no warmth** | `at` desc | a plain `ActivityItem` list (compliance lens) | *"What factually occurred, for the record?"* |

The same `recognition.received` event is, simultaneously: a warm face in **Timeline**,
a badge toast in **Notifications**, a card in **Recognition**, a feed item in
**Community**, and a line of evidence in **Reflection** ("your most generous month").
One fact, one id, one deep link — five stories. That is the Experience Core being
cohesive.

---

## 5. Timeline ≠ log · Notifications ≠ alerts (the distinction to hold)

Both consume the identical stream. The discipline is in the **lens**, and it must not
erode under implementation pressure:

| | **Timeline (memory)** | **Notifications (attention)** |
|---|---|---|
| Question | "What has my time meant?" | "What needs me now?" |
| Range | all history, paginated | recent + unread |
| Ordering | chronological, **severity ignored** | **severity-first**, then recency |
| `severity` | unused (memory isn't urgent) | the primary axis |
| `aiExplanation` | interleaved as reflection at seams | rarely shown (action is the point) |
| Milestones | chaptered, celebrated (`flags.milestone`) | irrelevant |
| Empty state | *"your story is just beginning"* | *"you're all caught up"* (Closure) |
| Emotional job | being *seen across time* | being *freed* ("nothing needs you") |

If Notifications ever starts reading like a reverse-chron log, or Timeline ever starts
ranking by urgency, the distinction has been lost — that is a review-blocking
regression, not a style nit.

---

## 6. Relationship to the frozen Patterns vocabulary

This model **supersedes nothing** in `EXPERIENCE_PATTERNS.md`; it is the shared
**source shape** the pattern-level contracts there are *views* of:

- **Patterns §3.3 `Event`** `{id,type,title,body?,at,person?,action?}` → the **Story
  projection** of `ExperienceEvent`: `type←category`, `title/body←narrative`,
  `person←actor?.name`, `action←deepLink`. `ActivityItem` keeps rendering it unchanged.
- **Patterns §3.2 `Signal`** `{id,type,severity,priority,title,body?,action?}` → the
  **Need projection**: a `severity≥warn || actionable` `ExperienceEvent` with
  `priority` derived from `(severity, at)`. `SignalCard` keeps rendering it unchanged.
- **Patterns §3.6 `Reflection`** → consumes `aiExplanation` ranked across events.

So existing primitives (`ActivityItem`, `SignalCard`, `ReflectionCard`) need **no
change** — they already render the projections. The canonical model simply guarantees
those projections come from one source, not three. (Severity is unified to
`info|success|warn|urgent`; the legacy signals `info|warning|critical` maps
`warning→warn`, `critical→urgent` in the projector — a one-line normaliser, no
consumer change.)

---

## 7. Self-critique (short — the lenses that matter here)

- **Is this speculative infrastructure?** *No.* It is one normalised shape + one
  projection endpoint that **replaces** the divergence already starting (`/ess/activity`
  and `/ess/signals` are two event shapes today). It pays for itself the moment Timeline
  is the second consumer — and Notifications the third. Building it now is *cheaper* than
  reconciling three models later. (This is exactly the user's stated rationale.)
- **Does it violate "grow on demand"?** *Borderline — and consciously justified.* We
  normally grow the Core only when a visible block needs it. Here two visible blocks
  (Timeline, Notifications) are both queued and both need the same stream; defining it
  once is the on-demand growth, done at the right altitude. We do **not** pre-build
  `experience_memory`, pre-build event *writing/storage*, or add categories no surface
  shows — those stay deferred.
- **Risk — over-rich events bloat every payload.** Mitigation: `context`/`relatedPeople`
  are bounded; consumers request only the `categories`/`scope` they render; pagination
  caps per-source rows. A Notification payload doesn't carry a milestone's full cohort.
- **Risk — `visibility` mistaken for security.** Mitigation: §3 states it explicitly —
  visibility is *audience*, RBAC is *access*; both gate, server-side, always fresh.
- **Risk — `action` vocabulary sprawl.** Mitigation: it's a closed namespaced set
  (`domain.verb`); adding a verb is a deliberate, reviewed act, and surfaces switch on
  `category`, never on the verb string — so an unknown verb still renders.
- **Does it keep Timeline ≠ Notifications honest?** *Yes — structurally.* They share the
  source precisely so the difference is forced to live in the lens (§5), where it's
  visible and reviewable, instead of being smuggled into divergent data.

---

## 8. Build order (on freeze)

1. **Freeze this model** → it joins the constitution.
2. **`GET /ess/events`** — the one projection (normalise `/ess/activity` + `/ess/signals`
   sources into `ExperienceEvent`; deterministic ids; visibility tags; `safe()` per
   source; keyset pagination).
3. **Build Timeline** — the Story consumer, against the approved
   `EXPERIENCE_TIMELINE_DESIGN.md` (its `/ess/timeline` becomes a thin Story-lens view
   over `/ess/events`, not a separate projection).
4. **Build Universal Notification Center** — the Need/attention consumer over the **same**
   `/ess/events`, severity-first.
5. Migrate Home Activity + Signals to read the shared projection (no shape change to
   `ActivityItem`/`SignalCard` — they already render the views).

Timeline and Notifications thus reuse **exactly** the same Event model by construction —
the divergence this document exists to prevent becomes impossible to introduce.

*One Event grammar. Many stories. The Experience Core stays cohesive because every
surface draws from the same well and only the telling differs.*
