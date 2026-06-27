# CognixHR — My Company · The People-Far Experience

> **STATUS: DESIGN FOR REVIEW** — Priority 2 of the Employee OS completion program,
> designed to the standard of the shipped experiences and of `EXPERIENCE_TEAM_DESIGN.md`.
> Desktop + mobile, six-lens self-critique, against the frozen constitution (Patterns ·
> Event Model · Moments · Experience Map). Not implemented — approval gates the build.
> This surface **reconciles the existing Community + Recognition feeds** into one lens
> exactly as My Team reconciled the old Team page.

---

## 0. MASTER RULE — the five questions

1. **Which experience owns this?** **My Company** (a primary surface; the People-**far**
   lens — the org as a shared world).
2. **Which human question?** **"What's our shared world — and where do I belong?"**
3. **Which Core service does it consume?** A new **`/ess/company`** projection — the
   company-visibility lens over the canonical `/ess/events` (`visibility ∈ {company}`,
   `flags.social`), merged with the **existing** `feed_posts` (announcements · updates ·
   system celebrations) and the **existing** public `recognition` stream. Grown on demand,
   no new concept, no new storage. Reuses what Community already proved: `/community/*`
   (write side stays the module of record), `/recognition/feed`, and the celebration
   generator `ensureTodaysCelebrations`.
4. **Which Moments propagate in?** The **My Company column** of the propagation matrix:
   **announcements** (its home), **company celebrations** (anniversary / birthday — company
   wish), **broad recognition** (feed if public), and **joined** (company welcome). Each
   arrives as the *far* facet only — never the actionable facet, never the personal one.
5. **Does it create duplication?** **Yes today — two ways — and the redesign removes both.**
   - **(a) Two feeds, two shapes.** `/community/feed` (over `feed_posts`) and
     `/recognition/feed` (over `recognition`) are *two* "what's happening across the
     company" streams with *two* card shapes — exactly the divergence the frozen Event
     Model exists to prevent ("Community would grow a `FeedActivity`"). **Resolution:**
     My Company reads **one** projection (`/ess/company`) that the Event Model already
     designates as the Community consumer; recognition becomes a *facet of the one stream*
     (a People-card), not a second feed. The two endpoints are not deleted — `/community/*`
     stays the **write/moderation module of record** and `/recognition/feed` stays the
     Rewards-pillar detail view; My Company stops being a *second reader with a second
     shape* and becomes the *single lens*.
   - **(b) Community vs My Company as surfaces.** The current `EssCommunity` /
     `MobileCommunity` page **is** the People-far surface, but built as "a page with a
     composer and a feed," not as a narrative lens. **Resolution:** My Company
     **supersedes** that page (as My Team superseded the old Team page) — same data, same
     write endpoints, re-told through the Pattern grammar (Focus → People → Story →
     Reflection → Closure). The composer is **kept** (posting is belonging, not a
     dashboard) but demoted from the headline to a quiet "share with everyone" affordance.

   After this: **My Company = the one shared-world lens; `/community/*` = its write/mod
   plumbing; `/recognition/feed` = a scoped Rewards detail.** No second feed, no second
   card shape, no second "what's happening" page.

---

## 1. The question this surface answers

**"What's our shared world — and where do I belong?"**

Not *"how are my people?"* — that's My Team (the **near** circle). Not *"what happened to
me?"* — that's My Story (personal memory). My Company is the **People-far lens**: the whole
organisation as a place an employee belongs to. It answers a human, social question — what
are we celebrating together, who was seen, what was announced to all of us, who just joined
our world. It is **culture made visible**: faces and announcements and shared recognition,
warm and wide. It carries **nothing actionable** (that is My Attention) and **nothing purely
personal** (that is My Story / My Growth).

> **The test:** an employee opens My Company and feels *part of something* — a shared world
> with faces and moments — never *a social-media timeline to scroll* and never *a noticeboard
> of corporate notices*. (Agent rule: **never build a dashboard, never build a feed-for-its-
> own-sake.**)

---

## 2. Patterns composed (governance §7.1)

| Beat | Pattern | Present? | Role on My Company |
|------|---------|----------|--------------------|
| 1 | **Focus** (§3.1) | ✅ leads | One warm orienting line — *"Across CognixHR today — two people celebrating, one announcement."* Belonging, not a count. One soft action at most ("Share something →"). |
| 2 | **Need** (§3.2) | ⛔ omitted | **The load-bearing omission.** Anything that needs an action — an announcement requiring acknowledgement, a celebration that wants a wish-as-a-task — belongs to **My Attention**. Posting/wishing here is *expression*, not an obligation. *Justified — this is the boundary that stops My Company being a second inbox.* |
| 3 | **People** (§3.4) | ✅ **co-spine** | The shared world *is* people — company celebrations (birthday / anniversary / new joiner), the broad recognition stream as faces, the "X joined us" welcome. Faces large and warm. |
| 4 | **Story** (§3.3) | ✅ **co-spine** | The company feed told as a *what's-happening narrative* — announcements, updates, milestones — time-grouped (`Today · This week · Earlier`), faces on every people-item. This is where the existing feed lives, re-framed. |
| 5 | **Progress** (§3.5) | ⛔ omitted | No company "score." Progress is *personal* encouragement; an org-level metric here would be a culture dashboard — explicitly forbidden. Collective momentum, if ever shown, is a *Reflection* sentence, never a band. *Justified.* |
| 6 | **Reflection** (§3.6) | ✅ once | One ambient, belonging-aware sentence — *"It's been a month of milestones across the company — four anniversaries."* Or, the AI's "worth celebrating" surfacing. Warmth, never analytics. `insight: null` ⇒ absent. |
| 7 | **Closure** (§3.7) | ⚪ light | A quiet warm line — *"A good place to be part of."* Optional; omitted when the day is sparse (silence-as-calm). |

**Lead:** Focus. **Spine:** People **+** Story interwoven (the feed *is* people-and-time).
**AI:** one Reflection. **Need, Progress dropped on purpose** — those two omissions are
precisely what keep My Company a *shared world* and not (a) a second notification inbox or
(b) a culture-metrics dashboard.

---

## 3. The spine (top to bottom)

```
  ┌─ FOCUS (wash) ───────────────────────────────────────────────┐
  │  Across CognixHR today — two celebrating, one announcement.   │
  │                                          [ Share something → ] │
  └────────────────────────────────────────────────────────────────┘

  CELEBRATING TODAY ─────────────────              (People — company-wide)
   🎂 Aarti turns a year wiser      [ Wish → ]
   🎉 Karthik — 5 years with us     [ Wish → ]
   👋 Neha joined us this week       welcome her

  WORTH CELEBRATING ─────────────────              (People — broad recognition)
   😊 Priya recognised Dev — "Problem Solver"        👏 12

  HAPPENING ─────────────────────────              (Story — the company feed)
   📣 Announcement · Diwali holiday calendar is out      (pinned)
   💬 Facilities posted — new café menu from Monday
   — This week —
   💬 Sara shared — our Q2 town-hall recording

  ┌ ✨ COGNIX INSIGHT (gradient) ─────────────────────────────┐
  │  A month of milestones — four anniversaries across us.    │  (Reflection)
  └────────────────────────────────────────────────────────────┘

  · A good place to be part of. ✓                              (Closure, light)
```

**Adapts by role, structure constant (Home §5 discipline):**
- **Everyone** sees: company celebrations, broad recognition, the announcements/updates feed,
  the Reflection. Everyone can **react · comment · wish · post an update** — belonging is
  participatory.
- **HR (`hr_admin` / `super_admin`)** additionally: the **"post as announcement / pin"**
  affordance inside the composer, and the moderation menu on each item — **carried over
  unchanged** from today's Community (it already exists and is correct). These are *authoring*
  controls, not a dashboard.
- **Privacy:** recognition appears here **only if public** (`recognition.visibility = public`
  / `feed_posts.audience_scope = company`); a private kudos never reaches the far lens. Leave
  is **absent** by design (it is `self`/private — the matrix gives it no Company cell).

---

## 4. Data & Core services

A new **`/ess/company`** read-model (grow on demand; project, don't own; tenant + RBAC
scoped) — the **Community consumer** the Event Model already named (§4: *Community Activity =
`visibility ∈ {company, team}`, `flags.social`, faces on every item*). It composes three
sources the platform **already owns**, into one shape:

- **celebrating** — today's company celebrations (system birthday/anniversary posts +
  new-joiner lifecycle), as `Party[]` faces with a one-tap **Wish** action. Reuses
  `ensureTodaysCelebrations` (the idempotent generator) and the lifecycle `joined` moment.
- **recognition** — recent **public** recognition (`recognition.visibility = 'public'`), as
  People-cards with giver→receiver faces and reaction count. This is the **broad-recognition
  facet** of the recognition moment (Moments §3: "feed if public") — *not* a second feed.
- **happening** — the company `feed_posts` stream (announcements · updates), pinned-first
  then `created_at` desc, told through `ActivityItem` / `TimeGroup` (Story lens). Carries the
  **announcement moment** ("its home", per the matrix).
- **reflection** — one belonging-aware `aiExplanation` ranked across the above (e.g. a
  milestone-rich month), or `null`.

**Reuses, supersedes, sheds:**
- **Supersedes** the `EssCommunity` page and `MobileCommunity` screen as the *front door* —
  they become the My Company experience (route + mobile tab repointed). The page's good bones
  (composer, reactions, comments, moderation, wish) are **kept**, re-composed under the
  Pattern grammar.
- **Reuses (unchanged, as the module of record)** all **write** endpoints —
  `POST /community/posts`, `/wish`, `/react`, `/comments`, `PATCH …` (pin/hide/remove),
  `/report`, `GET /community/reports`. My Company **reads** through `/ess/company` and
  **writes** through these. (Mirror of My Team: the experience reads the lens, acts via the
  module.)
- **Supersedes the two divergent read feeds** — `/community/feed` and `/recognition/feed` as
  *the surface's source* collapse into the **one** `/ess/company` projection (Event Model's
  whole point). `/recognition/feed` survives as a **scoped Rewards-pillar detail**;
  `/community/feed` survives only as internal plumbing if `/ess/company` chooses to wrap it.
- **Sheds** nothing actionable — there is none to shed; any "ack this announcement" need is
  **My Attention's** alone (and reaches it via the event's `actionable` flag, never here).

This is the §6 grow-on-demand loop done correctly: a *visible* surface (My Company) needs the
*already-designated* Community projection, so we build it once — rather than letting Community
and Recognition keep two shapes forever.

---

## 5. Desktop (≥ lg) & Mobile (< lg)

**Desktop** — a community surface, faces on every people-item, **two filled panels max** (the
Focus wash + the Reflection gradient). A warm reading column, never a table, never a grid of
metric tiles.

```
┌──────────────────────────────────────────────────────────────┐
│  ┌ FOCUS (wash) ──────────────────────────────────────────┐  │
│  │  Across CognixHR today — two celebrating, one news.     │  │
│  │                                       [ Share → ]        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Celebrating today ───────                                     │
│   🎂 Aarti  [Wish]     🎉 Karthik · 5 yrs  [Wish]   👋 Neha    │
│                                                                │
│  Worth celebrating ───────                                     │
│   😊 Priya recognised Dev — Problem Solver           👏 12     │
│                                                                │
│  Happening ───────────────                                     │
│   📣 Diwali holiday calendar is out               (pinned)     │
│   💬 Facilities — new café menu Monday        react · comment  │
│   — This week —                                                │
│   💬 Sara — Q2 town-hall recording            react · comment  │
│                                                                │
│  ┌ ✨ COGNIX INSIGHT (gradient) ───────────────────────────┐  │
│  │  A month of milestones — four anniversaries across us.   │  │
│  └──────────────────────────────────────────────────────────┘  │
│  · A good place to be part of. ✓                               │
└──────────────────────────────────────────────────────────────┘
```

The **composer** is a quiet affordance behind "Share something →" (not a headline textarea
fighting the Focus). Reactions/comments expand inline on each `ActivityItem`, exactly as
today — kept, not redesigned. HR's announcement toggle + moderation menu live where they do
now.

**Mobile** — My Company is a **primary bottom-nav tab** (Experience Map §5: *My Day · My
Attention · **My Company** · Me · Assistant*). The current `MobileCommunity` becomes *this*
experience: Focus header → celebrating → worth-celebrating → happening → insight, one
thumb-scroll. The composer drops to a FAB / collapsed bar so the feed leads with people.

```
┌───────────────────────────┐
│ Across CognixHR · today    │  ← Focus
│ [ Share something ]        │
│ Celebrating                │
│ 🎂 Aarti [Wish] 🎉 Karthik │
│ 👋 Neha joined             │
│ Worth celebrating          │
│ 😊 Priya → Dev      👏 12  │
│ Happening                  │
│ 📣 Diwali calendar (pin)   │
│ 💬 Café menu  ♥  💬        │
│ — This week —              │
│ 💬 Town-hall recording     │
│ ✨ A month of milestones   │
└───────────────────────────┘
```

Shared primitives only — `FocusPanel · PeopleRail · CelebrationCard · PersonAvatar ·
ActivityItem · TimeGroup · AmbientLine · ReflectionCard · DoneForToday`. **No bespoke
component.** The today's `PostCard` / reaction / comment / wish UI is preserved by mapping it
onto `ActivityItem` + `CelebrationCard` (a reconciliation, not a rewrite) — one product, one
voice.

---

## 6. Self-critique (the six lenses)

**1 · Narrative before navigation.** *Pass.* Opens with a belonging Focus and reads as "here's
our shared world today," not a feed wall with a composer on top. **Risk — the gravest here:**
a company feed *is* the canonical temptation to become "just a social feed" / infinite scroll.
**Guard:** lead with people-and-celebration, time-group the rest (`Today/This week/Earlier`),
cap the first view, and let it be *short* on a quiet day (silence-as-calm). The composer is
demoted; the story leads.

**2 · People before metrics.** *Strong pass — it is half the spine.* Every celebration and
recognition item is a `PersonAvatar`; reactions are faces and warmth, not analytics. **Watch:**
reaction counts must stay *ambient warmth* ("👏 12"), never ranked engagement scoring — no
"most-liked," no leaderboard.

**3 · Ambient before search.** *Pass.* The Reflection surfaces "worth celebrating" *for* the
employee before any search; finding a post/person is a quiet secondary scoped find.

**4 · Context before forms.** *Pass.* "Wish" is one tap (context supplies subject + occasion);
reacting is one tap. The composer is the *only* form, and it is optional expression, not a
required gate.

**5 · Memory before history.** *Pass / boundary-critical.* My Company is **present-tense
shared awareness** ("what's happening across us now"), not the employee's biography. A company
moment the employee was part of **echoes into My Story** (their memory) — it is **not** copied
into a personal history here. The feed is the org's *now*, not anyone's *past*.

**6 · Progress before reporting & Reflection before closure.** *Pass.* No company score (the
deliberate Progress omission); the one Reflection is belonging-framed, never a metric; a light
warm Closure over a dead-stop end.

**Cross-cutting (the boundaries to hold):**
- **My Company ↔ My Team (far vs near — the headline boundary).** Team = *my* circle (manager,
  peers, reports) seen as faces I work with; Company = *everyone*. The **same recognition
  moment** shows different facets: My Team → "your report was seen" (manager awareness); My
  Company → a public feed card (broad). **Guard in build:** My Company never scopes to *my*
  reports/peers; My Team never shows the company-wide stream. A teammate's birthday is a
  *near* wish in Team and a *far* wish in Company — same event, two facets, no duplicate card
  (Moments §2).
- **My Company ↔ My Story (shared vs personal — the de-dup with memory).** Company is the
  org's shared present; Story is the employee's private past. A public moment may **echo** into
  Story; it is never *the same card*. **Guard:** nothing in My Company is keyed to "my
  history"; it is keyed to `visibility = company`.
- **My Company ↔ My Day (teaser vs full).** My Day's "from around the company" line is a
  *peek*; My Company is the *full* shared world it opens into. **Guard:** My Day shows ≤1–2;
  My Company is the destination, not a second teaser.
- **My Company ↔ My Attention (shared vs actionable — the Need omission).** An announcement
  that *requires acknowledgement* is an **Attention** need; here the same announcement is just
  *part of the shared story*. **Guard in build:** no approve/ack/dismiss controls ever render
  on My Company. Reacting/commenting/wishing/posting are *expression*, not triage.
- **The "it's just a social feed" risk (be brutally honest).** A company feed can degrade into
  a noisy social network — vanity metrics, infinite scroll, engagement-bait. The Pattern
  grammar is the antidote: **Focus** gives it a point, **People+Story** give it faces and time,
  **no Progress** denies it metrics, **no Need** denies it obligation, **Closure** lets it end.
  If My Company ever starts ranking by engagement or never ends, the lens has been lost — a
  review-blocking regression, not a style nit.
- **Thin-data honesty.** On a small/new tenant most days have **no** announcement and **no**
  recognition — the surface should then be *short and warm* (celebrations + a welcome + a quiet
  Closure), **never** padded with empty tiles or a "be the first to post!" nag dressed as
  content. A light company day is a *short* company day. (This is the same discipline that
  keeps Home calm; it matters more here because a half-empty social feed reads as a ghost
  town.)
- **Visibility & RBAC.** Recognition shows only when **public**; `feed_posts` only when
  `status='active'`; everything tenant-scoped server-side, RBAC on top (Event Model §3). The
  far lens never leaks a `self`/private event.

---

## 7. Build order (on approval — not before)

1. **`/ess/company`** — the Community consumer over `/ess/events` (`visibility = company`,
   `flags.social`) **merged with** the existing `feed_posts` + public `recognition` reads, into
   one shape: `{ celebrating[], recognition[], happening[] (time-grouped), reflection }`.
   Read-only, `safe()` per source, tenant + RBAC scoped. This is where the **two feeds become
   one** (the Event-Model reconciliation).
2. **`MyCompany` surface** (desktop + reused responsively on mobile) from shared primitives —
   Focus → People (celebrating + recognition) → Story (happening, `TimeGroup`+`ActivityItem`)
   → Reflection → light Closure. **Port** the existing reaction / comment / wish / composer /
   moderation UI onto the primitives (reconcile, don't rewrite).
3. **Reconcile navigation:** the **Community** pillar → My Company; repoint the mobile
   **Community tab** to `MyCompany`; keep **all `/community/*` write + moderation endpoints**
   as the module of record; demote `/recognition/feed` to a scoped Rewards detail (no longer a
   second "what's happening" surface).
4. **Verify Moments propagation** — announcements (home) / company celebrations / broad public
   recognition / joined (welcome) surface here as the **Company facet**; confirm **nothing
   actionable** and **nothing private** leaks in, and that the **same** recognition/celebration
   events render as *different* facets in My Team and My Story (no duplicate card across
   lenses).

**Definition of Done (the program's, applied):** desktop ✓ · mobile ✓ · a11y ✓ · perf ✓ ·
Core reused (one projection, not two feeds) ✓ · Design System followed ✓ · **no duplicate
logic/UI** (the two feeds reconciled; Community page superseded) ✓ · human question answered ✓
· Moments validated (far facets only; no actionable/private leak) ✓ · build + tsc green ✓.

---

*My Team is how my people are; My Story is what happened to me; My Company is the world we
share. One asks me to care for a few, one asks me to remember, this one asks me to belong.
Keeping the far lens warm — and free of both the inbox and the dashboard — is the whole point.*
