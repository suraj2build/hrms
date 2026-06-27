# CognixHR — My Assistant · The Asked-Intelligence Experience

> **STATUS: DESIGN FOR REVIEW** — the seventh and final lens of the Employee OS,
> designed to the standard of the shipped experiences and against the frozen
> constitution (Experience Map · Patterns · Event Model · Moments). Desktop + mobile,
> six-lens self-critique, plus the cross-cutting boundaries this surface lives or dies
> on. Not implemented — approval gates the build. A mature assistant **backend already
> exists**; this document elevates it into the experience rather than rebuilding it.

---

## 0. MASTER RULE — the five questions

1. **Which experience owns this?** **My Assistant** (a primary lens — the
   *Intelligence · asked* surface). It is unusual among the seven: it is not a
   destination *beside* the others, it is the **universal verb** *over* them — the one
   place you turn to ask and to do, reachable from everywhere (⌘K / FAB), never a tab to
   hunt for.
2. **Which human question?** **"Can you help me with this?"** — the prompted question. A
   person who has *a specific thing in mind* and wants an answer or an action, now.
3. **Which Core service does it consume?** The **existing assistant routes**
   (`apps/api/src/routes/assistant/` — `/assistant/chat`, `/assistant/status`,
   `/assistant/config`, `/assistant/usage`) with their 13 RBAC-checked read tools
   (`find_employee`, `get_leave_balance`, `get_attendance`, `get_pending_approvals`,
   `get_payroll_run`, `get_compensation`, …), **reading across all `/ess/*` Core**
   (`/ess/events`, `/ess/home.context`, `/ess/signals`, `/ess/timeline`,
   `/ess/progress`, `/ess/reflection`) **and the search index**, and — the one new
   capability this design introduces — **acting via module flows** (deep-linking into a
   pre-shaped action, never the assistant writing directly). It **projects, doesn't
   own**; it writes nothing of its own (Patterns §6).
4. **Which Moments propagate in?** The **My Assistant column** of the propagation matrix
   (Moments §2) — the *ask* facet of every category: *"who recognised me & why"*,
   *"explain my pay change"*, *"where's my request?"*, *"how do I renew"*, *"my hours
   this week"*, *"help me get set up"*. The Assistant is the only lens that can answer
   *about* **every** moment on demand — it is the **secondary enricher** the Moments
   contract names: the universal *explain* and *act* verb hanging off any moment, on any
   surface.
5. **Does it create duplication?** **It is the highest-risk surface in the program for
   duplication — and three boundaries resolve it.** (a) **Vs Ambient AI** — the central
   boundary: Ambient AI is the *unprompted* lane (AI → you; one quiet sentence per block,
   already shipped via `AmbientLine` / `ReflectionCard`); My Assistant is the *asked*
   lane (you → AI). Different **direction**, zero overlap — the Assistant never emits
   unprompted lines into a surface, and Ambient AI never opens a conversation. (b) **Vs
   Search** — Search is **not a separate surface**; it is the Assistant's
   *instant-retrieval mode* (a query that needs no reasoning resolves to results
   directly, with no model round-trip). The existing `CommandPalette` (⌘K) and
   `UniversalSearch` are **folded into** the Assistant's instant mode — one find, not
   three. (c) **Vs the existing `AssistantWidget`** — today's floating chat bubble is
   **chatbot-first**, the exact anti-pattern the Experience Map forbids; this design
   **supersedes** it (conversation becomes the *fallback*, not the front door). Resolved
   on all three.

---

## 1. The question this surface answers

**"Can you help me with this?"**

This is the *prompted* question — the one a person asks when they already know what they
want and need the system to either *tell them* or *do it*. Its sibling, Ambient AI,
answers the question the person *didn't* think to ask (Reflection, §3.6); My Assistant
answers the one they *did*. The two together complete CognixHR's intelligence promise:
the system speaks to you unprompted, **and** answers you when you turn to it.

The discipline that makes this a CognixHR experience and not a bolted-on chatbot:
**lead with the answer and the action, not the conversation.** When I ask *"how many
leaves do I have left?"* I get **a number and a button to apply** — not a blinking
cursor inviting a chat. When I type *"payslip"* I get **my payslip**, instantly — not a
model deciding whether to fetch it. Conversation is the *fallback* the surface degrades
to **only** when the ask is genuinely open-ended ("draft a note to my manager about next
week"). The front door is a calm ask field over a few action cards; the chat thread is
what unfolds *behind* it when reasoning is actually required.

> **The test:** strip every logo and label, and My Assistant should feel like
> **"an assistant that knows my work"** — it answers *me*, with *my* data, and hands me
> the *next action* — never **"a chatbot bolted onto an HR app."** If it opens with an
> empty message box and a "Hi, how can I help?" greeting as its *primary* state, it has
> failed this test. (Agent rule: **never build a chatbot-first surface.**)

---

## 2. Patterns composed (governance §7.1)

My Assistant is the **unusual surface**: it is not a fixed narrative spine read
top-to-bottom like My Day — it is **the verb over the other lenses**, summoned with an
intent. So it composes the patterns *differently*: it does not *open with* Focus and
*close with* Closure on a static page; instead each **answer** it returns is itself a
miniature pattern composition (a Focus-shaped answer, optionally a Need-shaped action,
optionally a Reflection). The table reads the patterns as the Assistant *deploys* them,
not as page beats.

| Beat | Pattern | Present? | Role on My Assistant |
|------|---------|----------|---------------------|
| 1 | **Focus** (§3.1) | ✅ leads (per-answer) | Every answer opens as **one confident sentence** — *"You have 12 leave days left."* The reply *is* a Focus. Never a wall of prose. |
| 2 | **Need** (§3.2) | ✅ **the differentiator** | Every answer that *implies an action* carries **one** action card (`SignalCard`-shaped) — *"Apply for leave →"*. This is what makes it an assistant, not a search box. Silence when no action applies. |
| 3 | **Story** (§3.3) | ⚪ on request | When the ask is about *what happened* (*"show my leave history"*), it returns a scoped `ActivityItem` slice over `/ess/events` — Story-as-answer, not a fresh shape. |
| 4 | **People** (§3.4) | ✅ when human | When an answer is *about a person* (*"who recognised me?"*) the giver is a **face** (`PersonAvatar`), never a name string. |
| 5 | **Progress** (§3.5) | ⚪ on request | *"How's my attendance?"* returns the `ProgressBand` framing (encouragement), never a score. |
| 6 | **Reflection** (§3.6) | ⛔ **omitted — deliberately** | Reflection is the **ambient/unprompted** lane (AI → you). The Assistant is the **asked** lane. Letting it volunteer unprompted insight would **collapse the boundary with Ambient AI** — the one thing this surface must never do. *Justified: this omission is the whole point of the asked/ambient split.* |
| 7 | **Closure** (§3.7) | ✅ per-action | When the Assistant *completes* a handoff (leave applied via the module flow), the result lands as a Closure success state — *"Leave applied — enjoy the break."* — not a bare toast. |

**Lead:** Focus (the answer). **Differentiator:** Need (the action card — read →
understand → act). **Deliberate omission:** Reflection — it belongs to Ambient AI, and
keeping it out is how the asked/ambient boundary survives implementation.

---

## 3. The spine (the ask → answer loop, not a page)

The Assistant's "spine" is a **loop**, not a scroll. Four stages, degrading gracefully
from instant retrieval to conversation only when needed:

```
  ┌─ ⌘K / ASK FIELD ──────────────────────────────────────────────┐
  │  ✨  Ask me anything, or jump to…                              │   ← the front door
  │      "leave balance"   "my payslip"   "apply leave"           │     (one calm field)
  └────────────────────────────────────────────────────────────────┘
            │
            │  what kind of ask is this?  (resolved client-first)
            ▼
  ┌─ INSTANT MODE (Search) ─────────┐   ┌─ UNDERSTANDING ──────────────┐
  │  retrieval — no model needed     │   │  ✨ reading your leave…       │
  │  • navigate: "payroll runs" →    │   │  (a real ask → /assistant/chat │
  │  • people:   "Priya Nair" →      │   │   tool-loop, RBAC-scoped)     │
  │  • action:   "apply leave" →     │   └──────────────────────────────┘
  │  resolves to a target, instantly │              │
  └─────────────────────────────────┘              ▼
            │                          ┌─ ANSWER + ACTION CARD ───────────┐
            └─ jumps / pre-shapes ────▶│  You have 12 leave days left.    │  ← Focus-shaped
                                       │  ┌──────────────────────────┐    │     answer
                                       │  │ 🌴 Apply for leave    →  │    │  ← Need-shaped
                                       │  └──────────────────────────┘    │     action card
                                       │  ↳ giver's face if it's a person │  ← People when human
                                       └──────────────────────────────────┘
                                                  │
                          (only if the ask is open-ended / needs back-and-forth)
                                                  ▼
                                       ┌─ CONVERSATIONAL FALLBACK ────────┐
                                       │  the thread unfolds *behind* the │  ← the LAST resort,
                                       │  answer — never the front door   │     not the entry
                                       └──────────────────────────────────┘
```

**Reading the spine:** the entry is an **ask field over action affordances**, not a chat
window. A typed query is *first* resolved as **instant retrieval** (the old
`CommandPalette` brain — navigate / people / action, zero model latency). Only a query
that needs *reasoning over the person's data* hits `/assistant/chat`, runs the
tool-loop, and returns a **Focus-shaped answer + one action card**. Conversation is the
**fourth** stage — it appears only when the ask is genuinely open, and even then it
unfolds *beneath* the answer, never as the opening state.

---

## 4. Data & Core services

**Reuse the existing assistant backend wholesale — elevate, don't duplicate.**

- **Existing routes (the spine of record):** `POST /assistant/chat` (role-scoped,
  context-injected via `buildAssistantContext`, ordered provider chain with automatic
  fallback, rate-limited 20/min, token-metered to `ai_usage_log`), `GET
  /assistant/status` (is it usable for this tenant), `GET/PUT /assistant/config` +
  `POST /assistant/config/test` (admin, **keys masked** — see below), `GET
  /assistant/usage` (admin token summary). These already exist and are mature; the
  experience layer consumes them as-is.
- **Reads across all Core:** the chat tool-loop already calls **13 RBAC-checked,
  read-only tools** (`find_employee`, `get_team_on_leave`, `get_leave_balance`,
  `get_leave_requests`, `get_attendance`, `get_pending_approvals`,
  `get_employee_assets`, `get_holidays`, `get_headcount`, `list_departments`,
  `get_payroll_cost`, `get_payroll_run`, `get_compensation`). The instant-retrieval mode
  additionally reads the **search index** (the `CommandPalette` / `UniversalSearch` nav +
  employee + quick-action corpus) and the canonical `/ess/events` projection for
  Story-as-answer.
- **ACTS via module flows (the one new capability):** today the backend system prompt is
  explicitly **read-only** (*"You cannot perform actions… guide the user to the right
  screen instead"*). The experience keeps that safety stance but elevates "guide to the
  screen" into a **first-class action card**: the Assistant never writes a leave row
  itself — it returns *"Apply for leave →"* that **deep-links into the leave module's own
  flow, pre-shaped with context** (dates, type) exactly as the Map mandates (*"acts via
  module flows"*). The module of record performs the write, behind its own validation and
  the auth write-gate. Result: the Assistant can *initiate* any action without ever
  becoming a write path or bypassing module rules.
- **Server-side RBAC, always:** every tool re-checks the caller's role + tenant +
  self/report scope **inside the executor** — never trusted to the model. An employee
  only ever gets their own data; `get_compensation` / org-wide payroll refuse non-HR
  callers regardless of what the model asks.
- **API keys stay server-side — never to the browser:** provider keys are read from DB or
  env **server-side only** and returned to admins **masked** (`maskKey`, `key_hint`).
  This is an existing, load-bearing invariant — the design preserves it absolutely.
  Brand note (CLAUDE.md): the surface is **CognixHR Assistant** — never "Emvora".

**Reuses, supersedes, folds in:**
- **Supersedes** the `AssistantWidget` floating chat bubble — its chatbot-first framing
  violates the Map; its transport (`/assistant/chat`) and its session-persistence pattern
  survive *inside* the new asked-lane surface as the conversational *fallback*.
- **Folds in** `CommandPalette` (⌘K) and `UniversalSearch` as the Assistant's **instant
  mode** — one retrieval brain, not two competing palettes. ⌘K *becomes* the Assistant
  invocation (Map §5: *"a persistent ⌘K-style invocation, not a nav item to hunt for"*).
- **Sheds nothing of record** — modules stay the source of truth; the Assistant only
  reads and hands off.

---

## 5. Desktop (⌘K panel + full view) & Mobile (persistent affordance)

**Desktop** — a **⌘K-invokable panel** (the everyday case: ask, get answer + action,
done) with a **full conversational view** behind it for sustained back-and-forth. The
panel opens over the ask field; instant results and the answer+action card render *in
place*; only an open-ended ask expands into the threaded view. Two filled surfaces max
(the ask wash, and a Reflection gradient *never* appears here — Reflection is ambient).

```
  ⌘K  ┌──────────────────────────────────────────────────────────────┐
      │  ✨  Ask me anything, or jump to…                       esc   │  ← ask field (wash)
      │  ────────────────────────────────────────────────────────────│
      │  query: "how many leaves do I have"                          │
      │                                                              │
      │  ✨  You have 12 leave days left — 8 casual, 4 sick.         │  ← Focus-shaped answer
      │      ┌────────────────────────────────────────────┐         │
      │      │ 🌴  Apply for leave                      →  │         │  ← ONE action card (Need)
      │      └────────────────────────────────────────────┘         │
      │      Was this helpful?  · Open full conversation →           │  ← fallback, not front door
      └──────────────────────────────────────────────────────────────┘

  (empty / no query — the front door is action-first, NOT a chat greeting)
      ┌──────────────────────────────────────────────────────────────┐
      │  ✨  Ask me anything, or jump to…                             │
      │   Suggested:  Leave balance · My payslip · Who's off today    │  ← read→understand→act
      │   Recent:     Apply leave · Payroll runs                      │     suggestions, not a cursor
      └──────────────────────────────────────────────────────────────┘
```

**Mobile** — a **persistent affordance**, never a buried tab (Map §5). It rides the
header ✨ / a FAB; tapping opens the same ask-first sheet. The five bottom-nav slots stay
**My Day · My Attention · My Company · Me**; the Assistant is the always-reachable verb
on top, exactly as the Map fixes it.

```
┌───────────────────────────┐
│  ✨ Ask CognixHR      [×]  │  ← ask field, thumb-first
│  ───────────────────────  │
│  "my payslip"             │
│                           │
│  ✨ Your June payslip is  │  ← answer
│     ready — net ₹48,200.  │
│  ┌─────────────────────┐  │
│  │ 📄 View payslip   → │  │  ← one action card
│  └─────────────────────┘  │
│  Open conversation →      │  ← fallback link
└───────────────────────────┘
   ▲ summoned from header ✨ / FAB — never a 6th tab
```

Shared primitives only — `FocusPanel` (the answer), `SignalCard` (the action card),
`PersonAvatar` (a human in an answer), `ActivityItem` (Story-as-answer), `ProgressBand`
(Progress-as-answer), `AmbientLine` (the ✨ voice), `LoadingState` / `EmptyState`. One
product, one voice — no bespoke chat bubbles as the primary vocabulary.

---

## 6. Self-critique (the six lenses + the cross-cutting boundaries)

**1 · Narrative before navigation.** *Pass — with the surface's own twist.* The
Assistant isn't a narrative page; its "narrative" is the **answer-shaped reply** (Focus +
action), which leads over any menu. **Risk:** a ⌘K palette tempts a raw list-of-links.
**Guard:** a real ask always resolves to *an answer*, not just a jump; the list is only
the instant-retrieval fallback.

**2 · People before metrics.** *Pass.* Any answer about a person renders a
`PersonAvatar` ("Priya recognised you" shows Priya's face), never a bare name or id.

**3 · Ambient before search.** *Pass — and this surface is where the principle is most
load-bearing.* The Assistant is explicitly the *asked* counterpart; it must **never**
pre-empt the ambient lane by volunteering unprompted insight. Search here is *instant
retrieval*, deliberately quiet, behind the ask. **This is the boundary the whole surface
is built to hold (see cross-cutting below).**

**4 · Context before forms.** *Strong pass — it's the differentiator.* The answer arrives
with the **next action pre-shaped** ("Apply for leave →" with dates already inferred from
the ask). The person never re-enters what the Assistant already understood. A form is the
module's last resort, not the Assistant's first screen.

**5 · Memory before history.** *Pass.* Story-as-answer references the person's own arc
("you usually take leave around now") via `/ess/events`, not a raw undifferentiated log
dump.

**6 · Progress before reporting & Reflection before closure.** *Partial-by-design.*
Progress-as-answer is framed as encouragement (no scores). **Reflection is deliberately
omitted** (it is the ambient lane) — so the "Reflection before closure" beat is honoured
by *Ambient AI elsewhere*, not duplicated here. Closure *is* present: a completed handoff
lands as a success state.

**Cross-cutting (the boundaries this surface lives or dies on):**

- **Assistant ↔ Ambient AI — the central boundary (asked vs unprompted).** Same
  intelligence, **opposite direction**. Ambient AI = AI → you, *unprompted*, one quiet
  sentence per block (`AmbientLine` / `ReflectionCard`), already shipped, woven into every
  surface. Assistant = you → AI, *prompted*, summoned with an intent. **Guard in build:**
  the Assistant **never emits a line into another surface** (that is Ambient AI's job),
  and Ambient AI **never opens a thread** (that is the Assistant's). The Reflection
  pattern is omitted from the Assistant *precisely* to keep this seam clean. If the
  Assistant ever starts proactively interrupting, the boundary is gone — review-blocking.

- **Assistant ↔ Search — instant mode, not a separate surface.** Search has **no front
  door of its own** (Map §4). Its human face *is* the Assistant's instant-retrieval mode:
  a query resolves client-first to navigate/people/action with **zero model latency**, and
  only escalates to `/assistant/chat` when reasoning is required. **Guard:** there is **one**
  ⌘K — the existing `CommandPalette` and `UniversalSearch` are folded in, not left to
  compete. Two search palettes after this ships is a duplication regression.

- **The chatbot-creep risk (the most likely failure).** The gravity of every AI feature is
  toward "just add a chat window." **Guard:** the *primary* state is an ask field over
  action cards; the *answer* leads with Focus + a Need action; the *thread* is the
  **fourth** stage, summoned only for open-ended asks, unfolding *behind* the answer. The
  existing `AssistantWidget` (chat bubble as the front door) is **superseded**, not
  extended. The acceptance bar: *if the empty state is a blinking message box, it's wrong.*

- **Hallucination / trust.** The backend already enforces *"only use data from context or
  tools; never invent leave balances, salaries, names, or policies; if a tool reports no
  access, relay that plainly."* The experience reinforces it: answers cite their **source
  action card** (the data came from a real tool), the *"AI can be wrong — verify"* note
  persists, and a *"Was this helpful?"* affordance routes feedback. The Assistant never
  fabricates a number to fill an answer (mirrors Reflection's no-fortune-cookie rule).

- **Acting-with-permissions safety.** The Assistant is **read + handoff only — never a
  write path.** It *initiates* actions by deep-linking into the module's own pre-shaped
  flow, where the module's validation **and** the auth write-gate (402 SUBSCRIPTION_REQUIRED
  on a lapsed tenant — CLAUDE.md) apply. A suspended/expired tenant can still *ask*
  (reads stay open) but the handed-off write is blocked at the module, exactly as designed.
  Every tool re-checks RBAC server-side; the model is never trusted with scope.

- **"Conversation is the fallback, not the front door."** The single sentence that governs
  the whole surface. The front door is **ask + act**; conversation degrades in only for the
  open-ended ask. **Guard in build:** the default-mounted state must render the ask field +
  suggestions/action affordances, *never* an open thread.

---

## 7. Build order (on approval — not before)

1. **Elevate ⌘K into the Assistant front door** — refactor `CommandPalette` so its
   instant-retrieval brain (navigate / people / action) becomes the Assistant's
   **instant mode**, with a single ask field; fold `UniversalSearch` into it (one
   retrieval surface, not three). No backend change.
2. **Answer + action-card rendering** — wire the ask field to `/assistant/chat` for
   reasoning asks; render the reply as a **Focus-shaped answer** (`FocusPanel`) + **one
   `SignalCard` action** + `PersonAvatar` when the answer is about a person. Instant asks
   short-circuit the model entirely.
3. **Action handoff (the one new capability)** — turn the backend's "guide to the screen"
   into deep-linked, **context-pre-shaped** action cards into module flows (leave apply,
   view payslip, renew document). Keep the assistant **read-only at the API**; the module
   performs the write behind its validation + the write-gate.
4. **Conversational fallback** — the threaded view (reusing `AssistantWidget`'s transport
   + session persistence) unfolds *behind* the answer **only** for open-ended asks;
   supersede the floating chat-bubble front door.
5. **Mobile affordance** — header ✨ / FAB opening the same ask-first sheet; **no 6th
   tab**; bottom-nav unchanged.
6. **Reconcile & retire** — remove the chatbot-first `AssistantWidget` launcher; ensure
   exactly one ⌘K; verify Ambient AI lines never originate here and the Assistant never
   emits into another surface.

**Definition of Done (the program's, applied):** desktop ✓ · mobile ✓ · a11y ✓ · perf ✓
(instant mode has zero model latency) · existing assistant backend reused, **not
duplicated** ✓ · keys stay server-side/masked ✓ · RBAC server-side on every tool ✓ ·
Design System + shared primitives followed ✓ · **no second search palette** ✓ ·
**Assistant ↔ Ambient AI boundary held** (Reflection omitted; no unprompted emission) ✓ ·
**conversation is the fallback, not the front door** ✓ · human question answered ✓ ·
Moments *ask* facet validated ✓ · build + tsc green ✓.

---

*Ambient AI speaks before I ask. My Assistant answers when I do — and hands me the next
step, not a chat window. Asked and unprompted are the same intelligence facing opposite
directions; keeping conversation as the fallback, never the front door, is the whole
discipline.*
