# CognixHR — My Team · The People-Near Experience

> **STATUS: DESIGN FOR REVIEW** — Priority 1 of the Employee OS completion program,
> designed to the standard of the four shipped experiences. Desktop + mobile, six-lens
> self-critique, against the frozen constitution (Patterns · Event Model · Moments ·
> Experience Map). Not implemented — approval gates the build.

---

## 0. MASTER RULE — the five questions

1. **Which experience owns this?** **My Team** (a primary surface; the People-near lens).
2. **Which human question?** **"How are my people?"**
3. **Which Core service does it consume?** A new **`/ess/team`** projection (team-visibility
   events over the canonical `/ess/events`, plus the team roster) — grown on demand, no new
   concept. Reuses `employees` / `job_history` (roster), `leave_requests` (who's out today),
   `recognition` (team recognition), and celebration data (dob / joining_date).
4. **Which Moments propagate in?** The **My Team column** of the propagation matrix:
   birthday & anniversary (team celebration), recognition (team awareness), leave (who's
   out), joined (welcome a new teammate), and — when their sources exist — promotion / role
   / team change (org-change awareness).
5. **Does it create duplication?** **Yes today — and the redesign removes it.** The current
   "Team" surface (mobile `MobileTeam`, and the `/ess/team` / `/ess/whos-off` pages) is
   effectively an **approvals inbox** (`/attendance/regularisation/team`, approve/reject).
   Approvals are *action* — owned by **My Attention** (where team approvals now live,
   people-first). **Resolution:** My Team sheds the approval queue entirely and becomes the
   *people* experience; "Who's Off" folds in as "who's out today". After this, no overlap:
   **My Attention = what my team needs me to act on; My Team = how my people are.**

---

## 1. The question this surface answers

**"How are my people?"**

Not *"what does my team owe me to approve?"* — that's My Attention. My Team is the
**People-near lens**: the small circle an employee actually works with — their manager,
their peers, and (for managers) their reports — seen as **faces and lives, not rows**. It
answers a human, relational question: who's here today, who's celebrating, who did great
work, who could use a word. For managers it adds one quiet read on team *health* — never a
performance dashboard.

> **The test:** an employee opens My Team and sees *people they recognise and care about* —
> never *a roster grid* or *an approvals queue*. (Agent 1 rule: **never build a dashboard.**)

---

## 2. Patterns composed (governance §7.1)

| Beat | Pattern | Present? | Role on My Team |
|------|---------|----------|-----------------|
| 1 | **Focus** (§3.1) | ✅ leads | One human line — *"Your team — six people, two out today."* Orients; no action. |
| 2 | **Need** (§3.2) | ⛔ omitted | Action belongs to My Attention. This is the boundary that de-duplicates "Team". *Justified.* |
| 3 | **People** (§3.4) | ✅ **the spine** | The team as faces — manager, peers, reports; who's out today; celebrations to acknowledge; recognition within the team. The whole body. |
| 4 | **Progress** (§3.5) | ✅ managers only | One *light* team-momentum line ("on-time rate held all week") — encouragement, **never a leaderboard or a per-person score**. Silent for non-managers and when nothing's true. |
| 5 | **Reflection** (§3.6) | ✅ managers, once | One ambient team insight ("one report is low on leave balance — worth a check-in"). Care, not surveillance. |
| 6 | **Closure** (§3.7) | ⚪ light | A quiet warm line ("a good team to be part of"). Optional; omitted when sparse. |

**Lead:** Focus. **Spine:** People. **Manager additions:** a momentum line + one insight.
Need is dropped on purpose — that is precisely what stops My Team from being the approvals
inbox it is today.

---

## 3. The spine (top to bottom)

```
  ┌─ FOCUS (wash) ───────────────────────────────────────────────┐
  │  Your team — six people, two out today.                       │
  └────────────────────────────────────────────────────────────────┘

  TODAY ──────────────────────────────             (presence + celebration)
   🎂 It's Arjun's birthday          [ Wish → ]
   🌴 Maya & Sara are out today      back tomorrow

  YOUR PEOPLE ────────────────────────             (the roster, as faces)
   ◯ Maya  (manager)   ◯ Arjun  ◯ Sara  ◯ Dev  ◯ Priya  ◯ Ravi

  RECENTLY ───────────────────────────             (team recognition)
   😊 Priya recognised Dev — "Problem Solver"

  ─ managers only ───────────────────────────────────────────────
  ✨ One report is low on leave balance — worth a check-in.   (Reflection)
     On-time rate held all week.                              (Progress)
```

**Adapts by role, structure constant (Home §5 discipline):**
- **Employee** sees: their manager + peers as faces, today's presence, team celebrations,
  team recognition.
- **Manager** additionally sees: their reports, the team-momentum line, and one care-insight.
- **Privacy:** "out today" shows **availability**, never the leave reason or medical detail —
  presence, not records.

---

## 4. Data & Core services

A new **`/ess/team`** read-model (grow on demand; project, don't own; tenant + RBAC scoped):
- **roster** — manager (`job_history` fkey), peers (`employees.manager_id` = my manager),
  reports (`employees.manager_id` = me, via `getDirectReportIds`) — all as `Party[]` faces.
- **today** — who's out (today inside an approved `leave_requests` range; availability only)
  and today's celebrations (dob / joining_date).
- **recently** — recognition where giver or receiver is in the team (the team-visibility
  facet of recognition Moments).
- **manager extras** — a momentum line (e.g., team on-time rate from `attendance`, framed as
  encouragement) and one care-insight (e.g., a report with low leave balance / long stretch
  without a break — the My Team facet of the Reflection pattern).

**Reuses, supersedes, sheds:**
- **Supersedes** the current `/ess/team` page and the mobile Team-approvals view — those
  become the My Team experience.
- **Folds in** `/ess/whos-off` as the "out today" line (one fewer destination — simplify).
- **Sheds** approvals/regularisation review → already owned by **My Attention** (no
  duplication). The existing `/attendance/regularisation/team` action endpoints remain the
  *module of record* My Attention links into; My Team never shows them.

---

## 5. Desktop (≥ lg) & Mobile (< lg)

**Desktop** — a people surface, faces large, two filled panels max (Focus wash + the
manager Reflection gradient). Never a table.

```
┌──────────────────────────────────────────────────────────────┐
│  ┌ FOCUS (wash) ──────────────────────────────────────────┐  │
│  │  Your team — six people, two out today.                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Today ───────────────                                         │
│   🎂 Arjun's birthday   [Wish]      🌴 Maya, Sara out today    │
│                                                                │
│  Your people ─────────                                         │
│   ◯ Maya·mgr   ◯ Arjun   ◯ Sara   ◯ Dev   ◯ Priya   ◯ Ravi    │
│                                                                │
│  Recently ────────────                                         │
│   😊 Priya recognised Dev — Problem Solver                     │
│                                                                │
│  ┌ ✨ for the manager (gradient) ───────────────────────────┐  │
│  │  One report's low on leave — worth a check-in.           │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Mobile** — rides the **existing Me / Team persona toggle** (managers) that the shell
already has; the Team view becomes *this* experience (replacing the approvals inbox). Faces,
celebrations, presence — thumb-first, one scroll. The team-approvals that used to live here
are reached via the **bell → My Attention** (where they now belong).

```
┌───────────────────────────┐
│ Your team · 2 out today    │  ← Focus
│ Today                      │
│ 🎂 Arjun  [Wish]           │
│ 🌴 Maya, Sara out          │
│ Your people                │
│ ◯◯◯◯◯◯  (faces)            │
│ Recently                   │
│ 😊 Priya → Dev             │
│ ✨ (mgr) check in w/ Dev   │
└───────────────────────────┘
```

Shared primitives only — `FocusPanel · PeopleRail · CelebrationCard · PersonAvatar ·
ActivityItem · AmbientLine · ReflectionCard` — one product, one voice.

---

## 6. Self-critique (the six lenses)

**1 · Narrative before navigation.** *Pass.* Opens with a human Focus and reads as
"here are your people today," not a roster table. **Risk:** a team naturally tempts a
grid/org-chart. **Guard:** faces + presence + celebration, never columns; no dashboard.

**2 · People before metrics.** *Strong pass — it's the entire surface.* Everyone is a
`PersonAvatar`. **Watch:** the manager momentum line must stay *encouragement*, never a
per-person scoreboard (the §3.5 guardrail is load-bearing here).

**3 · Ambient before search.** *Pass.* The manager insight surfaces care *for* them before
any search; finding a teammate is a quiet secondary action.

**4 · Context before forms.** *Pass.* "Wish" is one tap; presence is read, not entered. No
forms.

**5 · Memory before history.** *Pass / N-A.* My Team is present-tense ("how are they *now*").
A teammate's history is *their* My Story, not exposed here — a deliberate privacy boundary.

**6 · Progress before reporting & Reflection before closure.** *Pass.* Team momentum is
framed as encouragement (no leaderboard); the manager insight is care, not surveillance; a
light closing line over a blunt ending.

**Cross-cutting (the boundaries to hold):**
- **My Team ↔ My Attention (the de-dup, most important).** Team = *understand/celebrate
  people*; Attention = *act*. The current Team-as-approvals is the duplication; removing the
  queue from Team resolves it. **Guard in build:** no approve/reject controls ever appear on
  My Team.
- **My Team ↔ My Company.** Near vs far: Team = my circle; Company = the org. My Team shows
  *my* people; Company shows *everyone*.
- **My Team ↔ My Growth.** Teammates appear here as lightweight faces; deep identity is each
  person's own My Growth. My Team never becomes a profile browser.
- **Privacy & RBAC.** "Out today" is availability only (no reason); team data is tenant +
  manager-scope enforced server-side. A manager sees their reports; an employee sees their
  immediate team, not the whole org.
- **Manager-vs-employee adaptation** — one surface, role-adaptive content, structure constant
  (Home §5). No separate "manager team page" (that drift is what created today's mess).

---

## 7. Build order (on approval — not before)

1. **`/ess/team`** — roster (manager/peers/reports as `Party[]`) + today (out + celebrations)
   + recent team recognition + (manager) momentum line & one care-insight. Read-only, scoped.
2. **`MyTeam` surface** (desktop + reused responsively on mobile) from shared primitives;
   route `/ess/team` (replacing the current page) + manager self.
3. **Reconcile navigation:** Team pillar → the new experience; fold `/ess/whos-off` into it;
   repoint the mobile **Team persona** view to `MyTeam`; ensure team approvals are reachable
   only via **My Attention** (remove them from Team).
4. **Verify Moments propagation** — celebrations/recognition/leave/joined surface here as the
   My Team facet; nothing actionable leaks in.

**Definition of Done (the program's, applied):** desktop ✓ · mobile ✓ · a11y ✓ · perf ✓ ·
Core reused ✓ · Design System followed ✓ · no duplicate logic/UI ✓ · human question answered
✓ · Moments validated ✓ · build + tsc green ✓.

---

*My Attention is what my team needs me to do. My Team is how my people are. One asks for
action; the other asks me to care. Keeping them apart is the whole point.*
