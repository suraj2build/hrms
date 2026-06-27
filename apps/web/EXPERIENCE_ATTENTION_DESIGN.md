# CognixHR — My Attention · The Need Experience

> **STATUS: DESIGN FOR REVIEW** — the fourth experience, designed to the standard set
> by My Day, My Story, and My Growth. High-fidelity, desktop + mobile, six-lens
> self-critique, against the frozen constitution (Patterns · Event Model · Moments ·
> Experience Map). Not implemented — approval gates the build.

---

## 0. Experience ownership (the permanent product rule)

- **Primary experience:** **My Attention** — the Need lens.
- **Secondary experiences enriched (via the Moments propagation contract):**
  - **My Day** — shows the top-3 *peek* of what needs you; My Attention is the full queue.
  - **My Story** — an *acted* need becomes a memory ("your leave was approved"); Attention
    keeps nothing historical, it hands resolved items to memory.
  - **My Team** — a manager's team approvals are surfaced here *and* are team-aware in My Team.
  - **My Assistant** — can *act on* an Attention item in natural language.
- **Consumes:** the **"My Attention" column** of the Moments propagation matrix — i.e. only
  events that genuinely *require an action*. No moment reaches this surface unless acting is
  the point (Moments §4 principle 3).

---

## 1. The question this surface answers

**"What needs me now?"**

And, just as important, the answer it is built to give most often: **"Nothing — you're
free."** My Attention is the **Need lens**, but its purpose is the inverse of every
notification centre ever shipped. A normal notifications screen is an *anxiety machine*:
an infinite feed, an unread badge that never reaches zero, alert fatigue. **My Attention
exists to be emptied, not scrolled.** Its emotional goal is *calm through resolution* —
get the employee to "all clear" and tell them so.

> **The test:** an employee opens My Attention and feels *"I know exactly what needs me,
> and I can be done"* — never *"ugh, notifications."*

The defining inversion: **the empty state is the reward, designed with as much care as the
full state.** "Nothing needs you" is the product working, not the product being empty.

---

## 2. Patterns composed (governance §7.1)

| Beat | Pattern | Present? | Role on My Attention |
|------|---------|----------|----------------------|
| 1 | **Focus** (§3.1) | ✅ leads | One synthesising sentence — *"Two things need you — about 3 minutes."* or *"You're all clear."* Direction or reassurance, never a count badge. |
| 2 | **Need** (§3.2) | ✅ **the spine** | The ranked queue — severity-first `SignalCard`s, each with one contextual action, grouped by urgency. The whole body. |
| 3 | **People** (§3.4) | ✅ woven | Faces on needs that involve a person — a manager's pending approval shows the *requester*. People before row-ids. |
| 4 | **Progress** (§3.5) | ⛔ omitted | Attention is about resolution, not growth. *Justified.* |
| 5 | **Reflection** (§3.6) | ⚪ light only | No gradient panel — Attention is utilitarian-calm, not reflective. One *ambient* guidance line ("nothing urgent — these can wait") does the AI work. |
| 6 | **Closure** (§3.7) | ✅ **the signature** | The all-clear state — *"Nothing needs you. You're free."* The emotional payoff and the surface's one filled, designed moment. |

**Lead:** Focus. **Spine:** Need. **Signature:** Closure (the all-clear). Progress and the
gradient-Reflection are dropped on purpose — this surface's job is to get to zero and say so.

---

## 3. The spine (top to bottom)

```
  ┌─ FOCUS (faint wash) ─────────────────────────────────────────┐
  │  Two things need you — about three minutes.                   │
  └────────────────────────────────────────────────────────────────┘
   ✨ Nothing urgent — these can wait for coffee.      (ambient line)

  NEEDS YOU NOW ───────────────────────────────         (urgent / warn)
   😊 Maya requested 3 days' leave           [Review →]   (requester face)
   ◷  Regularise yesterday's missing check-in [Fix →]

  CAN WAIT ────────────────────────────────────         (info)
   ▦  Your March payslip is ready             [View →]

  WAITING ON OTHERS ───────────────────────────         (track-only, no action by me)
   ↻  Your WFH request — pending with Maya    · submitted Tue

  ─────────────────────────────────────────────
              ✓  That's everything that needs you.      (Closure, pending-aware)
```

…and on a clear day, the surface **is** the reward:

```
                         ◯  ✓

                  Nothing needs you.
            You're all clear — enjoy the day.

        (one quiet line below: "2 requests in progress" if any)
```

**Grouping (by what it asks of you, not by module):**
- **Needs you now** — urgent/warn, *your* action (approvals, regularizations, expiring docs).
- **Can wait** — info, low-urgency (payslip ready, gentle nudges).
- **Waiting on others** — *your* in-flight requests: status only, you can't act, so it never
  counts toward "needs you." Awareness, not a task.

**The all-clear governs the headline:** when **Needs you now** is empty, the Focus becomes
the Closure reward; "Waiting on others" persists quietly below as awareness.

**Triage / acting:** unlike My Story (memories are felt, not clicked), Attention items
**deep-link to act** — this is exactly where deep-links belong (Moments §5). Acting in the
module clears the underlying condition, so the item **self-resolves** off the queue on the
next read. (Explicit *dismiss / snooze* is a deliberate v2 — see §6 — not v1.)

---

## 4. Data & Core services

My Attention is the **full-fidelity consumer of the existing Need lens** — `/ess/signals`
already projects "what needs you" (attendance, approvals, own requests, documents, leave;
managers additionally get team approvals), severity-ranked. Home consumes the **top-3 peek**;
My Attention consumes the **whole set**, grouped into the three intents above, with the
requester's face resolved on approval-type signals.

- **v1 is read-only and self-resolving** — consistent with every lens so far. The queue is
  *live truth*: act in the module → the condition clears → the item leaves. No new storage.
- **Evolution:** as more moment categories require action, `/ess/signals` extends (same Event
  Model) — optionally renamed `/ess/notifications` when the surface matures. No new concept.
- **People:** approval signals carry the requester as a `Party` so `PersonAvatar` renders the
  face (a small projection addition to the signal, not a new contract).

**Boundary — My Attention vs FlowDesk (the one to nail, like My Growth vs My Profile):**
FlowDesk is the **module of record** — the full request/approval *workbench* (filter, history,
bulk, detail). My Attention is the **experience** — the curated, ranked, calm answer to "what
needs me now," cross-module, designed to reach zero. Attention **links into** FlowDesk to do
the heavy work; it never tries to *be* FlowDesk. Attention is the front door; FlowDesk is the
workshop.

---

## 5. Desktop (≥ lg) & Mobile (< lg)

**Desktop** — a single focused column (~640–720px), an *inbox of needs*, never a module grid:

```
┌──────────────────────────────────────────────────────────┐
│  ┌ FOCUS (wash) ──────────────────────────────────────┐  │
│  │  Two things need you — about three minutes.         │  │
│  └──────────────────────────────────────────────────────┘  │
│  ✨ Nothing urgent — these can wait for coffee.           │
│                                                            │
│  Needs you now ───────────────────────                    │
│   😊 Maya · 3 days' leave              [ Review → ]        │
│   ◷  Missing check-in — yesterday      [ Fix → ]          │
│                                                            │
│  Can wait ────────────────────────────                    │
│   ▦  March payslip ready               [ View → ]         │
│                                                            │
│  Waiting on others ───────────────────                    │
│   ↻  WFH request · pending with Maya   submitted Tue      │
│                                                            │
│            ✓ That's everything that needs you.            │
└──────────────────────────────────────────────────────────┘
```

**Mobile** — the **bell** in the glossy header becomes the My Attention entry (today it routes
to approvals; it repoints to `/attention`). The full 5-tab bottom-nav restructure from the Map
lands when My Company / My Team exist; until then the bell is the home, with a count dot only
when something genuinely **needs you now** (never for "waiting" items).

```
┌───────────────────────────┐
│  Two things need you ·3min │  ← Focus
│  ✨ nothing urgent         │
│  Needs you now            │
│  😊 Maya · leave   Review →│
│  ◷ Missing punch   Fix →   │
│  Can wait                 │
│  ▦ Payslip ready   View →  │
│  ✓ that's everything      │
└───────────────────────────┘
```

Same shared primitives (`FocusPanel · SignalCard · PersonAvatar · AmbientLine · DoneForToday`)
as the other surfaces — one product, one voice.

---

## 6. Self-critique (the six lenses)

**1 · Narrative before navigation.** *Pass, with the core risk.* Opens with a synthesising
Focus + human group headings ("Needs you now"), not "Inbox (47)". **Risk:** a queue is
inherently list-shaped and can slide back into a notification feed. **Guard:** the Focus
sentence, the three intent-groups, and a hard cap on what qualifies as a "need" keep it a
*curated answer*, not a stream.

**2 · People before metrics.** *Pass.* Faces on approval needs (the requester). **Watch:**
many needs are system-shaped (missing punch, expiring doc) with no person — calm glyphs there;
never invent a face.

**3 · Ambient intelligence before search.** *Pass.* One ambient line triages *for* the user
("nothing urgent — these can wait") before any filter. No search box dominates a list that is
meant to be *small*.

**4 · Context before forms.** *Pass.* Each item pre-shapes its action and carries context into
the module; Attention itself asks nothing.

**5 · Memory before history.** *Pass — and it's the anti-overlap guarantee.* My Attention holds
**nothing historical**. An acted need *leaves* and becomes a My Story memory. This is precisely
what stops Attention from becoming "a log of past notifications" and what keeps it disjoint from
My Story. Present-tense only.

**6 · Progress before reporting & Reflection before closure.** *Pass.* Progress is omitted
(justified); there is no gradient Reflection. The surface's one designed emotional moment is
**Closure** — the all-clear. **The make-or-break:** the empty state must feel like *freedom*,
not *emptiness*. If "Nothing needs you" reads as a sad blank screen, the surface has failed its
whole reason for being. It gets the care a hero state gets.

**Cross-cutting honest risks:**
- **Alert-fatigue regression** — if the Need lens is noisy, Attention becomes the anxiety
  machine it replaces. **Mitigation:** severity ranking + only-genuine-needs (Moments §4) + the
  three calm groups + the badge fires *only* for "needs you now," never for "waiting".
- **My Attention ↔ FlowDesk** — the redundancy trap (§4). Held by the experience-vs-workbench
  boundary; Attention links into FlowDesk, never replicates it. This is the boundary most likely
  to blur in build — guard it like My Growth ≠ My Profile.
- **My Attention ↔ My Day** — Day stays a ≤3 *peek* that links here; Attention is the home of the
  full queue. Don't let Day grow the list or Attention lose the synthesis.
- **Write-state (triage)** — v1 is read-only/self-resolving (the queue reflects live truth).
  **Explicit dismiss / snooze is a deliberate v2** and is the *first* place an experience needs
  per-user write-state (a minimal `attention_state` set). Flagged now, gated separately — not
  smuggled into v1.

---

## 7. Build order (on approval — not before)

1. **Extend the Need lens** — `/ess/signals` grouped into the three intents + the requester
   `Party` on approval signals (people-first). Still read-only, self-resolving.
2. **`MyAttention` desktop surface** — Focus + grouped Need queue + the all-clear Closure as a
   first-class hero state; route `/ess/attention` (+ manager self).
3. **Mobile** — repoint the header bell to `/attention`; the badge fires only on "needs you now".
4. **Resolve-to-memory wiring** — confirm acted items propagate to My Story (Moments) so the
   queue truly empties into memory.
5. **(v2, separate approval)** triage: dismiss / snooze with a minimal per-user state model.

Each slice ships green (web + api tsc, vite build), as the first three did.

---

*My Day says what matters. My Story remembers. My Growth aspires. My Attention clears the way —
and its highest achievement is to be empty, and to make that feel like freedom.*
