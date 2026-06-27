# CognixHR — My Growth (Identity) · The Growth Experience

> **STATUS: DESIGN FOR REVIEW** — the first implementation on top of the frozen
> architecture. High-fidelity, desktop + mobile, with a self-critique in the same
> review process used for Home and Timeline. Authored against the frozen
> constitution: Patterns vocabulary, Event Model, Moments contract, and the
> Experience Map. Not yet implemented — approval gates the build.

---

## 0. The question this surface answers

Not *"what's in my profile?"* — **"Who am I, and how have I grown?"**

My Story answers *what happened* (memory, read backward). **My Growth answers who
I'm becoming** (identity, read forward). It is the **Growth lens** of the Experience
Map — the distillation of a chronicle into a *self*: the person, their reporting line
as people, the milestone spine of their career, what they're known for, the skills
and learning they're building, the achievements they've earned.

The trap to avoid is the classic HRMS **"My Profile"** — a form of editable fields
(name, address, bank). That is a *module of record*, reached from here for an edit,
never the experience. My Growth is **reflective, not transactional**: a narrative of
self you *read and feel*, not a settings page you fill in.

> **The test:** strip the branding and it should read as *"the story of who I've
> become here"* — never *"an employee record."*

---

## 1. Patterns composed (governance §7.1)

In rhythm order; omissions justified (silence-as-calm).

| Beat | Pattern | Present? | Role on My Growth |
|------|---------|----------|-------------------|
| 1 | **Focus** (§3.1) | ✅ leads | One identity statement — *"Senior Analyst on Design · 2 years 3 months in."* Orients; no action. |
| 2 | **Need** (§3.2) | ⛔ omitted | Growth is not a task list. Anything actionable lives in My Attention. *Justified.* |
| 3 | **People** (§3.4) | ✅ high | The person themselves, and their **reporting line as faces** — manager, peers, reports. People before fields. |
| 4 | **Story→Growth** (§3.3) | ✅ **centrepiece** | The **Journey/Growth spine** — its *canonical home* (migrated from Timeline per the Map). Forward-reading milestones: Joined → firsts → anniversaries → promotion/learning (as sources exist). |
| 5 | **Progress** (§3.5) | ✅ | *What I'm known for* (strengths from recognition), skills and learning momentum — encouragement, never a score or peer-rank. |
| 6 | **Reflection** (§3.6) | ✅ once | One forward growth insight — *"You've become the team's go-to for onboarding."* The signature gradient moment. |
| 7 | **Closure** (§3.7) | ✅ gentle | A quiet forward note — *"Still early in the story — the best chapters are ahead."* Identity closes looking forward, not done. |

**Lead:** Focus (identity). **Centrepiece:** the Growth spine. **Signature:** the
growth Reflection. Need is the only beat dropped — deliberately, to keep Growth a
mirror, not a to-do list.

---

## 2. The spine (the experience, top to bottom)

```
  ┌─ FOCUS (identity, faint wash) ───────────────────────────────┐
  │  Priya Sharma · Senior Analyst, Design                        │
  │  2 years, 3 months in — and growing.                          │
  └───────────────────────────────────────────────────────────────┘

  WHO I WORK WITH                                    (People, faces)
   reports to  ◯ Maya     ·  alongside ◯ ◯ ◯  ·  guides ◯ ◯
                (manager)       (peers)            (reports)

  HOW I'VE GROWN                            (the Growth spine — home)
   ●───────●────────●─────────●─────────────●
   Joined  First    First     1 year      2 years
           payslip  recognition
                    (Priya ◯)

  ✨ COGNIX INSIGHT  (the one gradient panel)
   You've become the team's go-to for onboarding — three new
   joiners named you in their first month.

  WHAT I'M KNOWN FOR                            (Progress — strengths)
   Team Player ×4   ·   Problem Solver ×2   ·   Innovator ×1
   (qualities from recognition received — faces of who saw them)

  MY SKILLS              (future source — silent until it exists)
  MY LEARNING            (future source — silent until it exists)
  MY ACHIEVEMENTS        (milestones + awards, distilled)

  ✓ Still early in the story — the best chapters are ahead.   (Closure)
```

**What renders today vs later (render-what's-real, like Timeline):** the identity
Focus, the reporting line (from profile), the **Growth spine** (Joined / first
payslip / first recognition / anniversaries — real now), **strengths** (from
recognition badges received), and the growth Reflection all render from data that
exists. **Skills · Learning · Achievements** are designed now but **silent** until
their event sources emit (Moments propagation) — never a hollow placeholder widget.

---

## 3. Data & Core services

A new read-model **`/ess/identity`** (built on demand at implementation — grow on
demand), projecting from existing tables and the canonical stream:

- **person + reporting line** — `employees` / `profiles` (self + manager + peers + reports as `Party[]`).
- **Growth spine** — the **Journey** projection (today inside `/ess/timeline.journey`; its
  canonical home moves here). Milestone subset of `/ess/events`.
- **strengths** — `recognition` received, grouped by badge into qualities + the faces who gave them.
- **skills / learning / achievements** — future event sources; projected when present, silent otherwise.

No new event shape, no new Core concept — Identity is the **milestone/Growth facet** of the
Moments contract (§My Growth column). It consumes; it never writes (profile *edits* go to the
module of record, reached from here).

**Relationships (Experience Map §3.3):** ↔ **Home** greets this identity and links here.
↔ **Timeline** is the raw memory; Growth is the distilled self — and **Growth now owns the
Journey spine** (Timeline keeps a compact echo that links here). ↔ **AI** is ambient (growth
insight); the Assistant can answer *about* my growth. ↔ **Search** finds skills/people.

---

## 4. Desktop (≥ lg)

A profile-*hub* — wider than Timeline's reading column, but still a narrative read
top-to-bottom, people-first, two filled panels only (Focus wash + Reflection gradient).

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌ FOCUS (wash) ────────────────────────────────────────────────────┐ │
│  │  ◯  Priya Sharma                                                  │ │
│  │     Senior Analyst · Design · 2 years 3 months in — and growing. │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  Who I work with ──────────────────────────                           │
│   reports to ◯ Maya    alongside ◯ ◯ ◯ ◯    guides ◯ ◯                │
│                                                                        │
│  How I've grown ──────────────────────────  (horizontal Growth spine) │
│   ●─────●──────●───────●────────●                                      │
│                                                                        │
│  ┌ ✨ COGNIX INSIGHT (gradient) ───────────────────────────────────┐ │
│  │  You've become the team's go-to for onboarding.                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  What I'm known for ──────────────  │  Achievements ───────────────   │
│   Team Player ×4  ◯◯◯◯               │   🏅 First recognition           │
│   Problem Solver ×2 ◯◯               │   🎉 2-year milestone            │
│                                      │                                  │
│  My skills (silent until sourced)   │  My learning (silent until …)    │
└──────────────────────────────────────────────────────────────────────┘
```

Two-column below the spine (strengths / achievements) on wide screens; everything
collapses to one column under it. The Growth spine is full-width and prominent — it
is the centrepiece.

## 5. Mobile (< lg) — the **Me** tab root

The Experience Map gives My Growth the **Me** tab; My Story is reached from here.

```
┌───────────────────────────┐
│        ◯  (avatar)         │
│      Priya Sharma          │
│  Senior Analyst · Design   │
│  2y 3m in — and growing.   │
├───────────────────────────┤
│ Who I work with           │
│  ◯ Maya  ◯◯◯  ◯◯           │
│                           │
│ How I've grown            │
│  ●──●──●──●──●  (h-scroll) │
│                           │
│ ┌ ✨ Insight ───────────┐ │
│ │ Go-to for onboarding. │ │
│ └───────────────────────┘ │
│ What I'm known for        │
│  Team Player ×4           │
│  Problem Solver ×2        │
│                           │
│  → My Story (your memory) │
└───────────────────────────┘
```

Same primitives as desktop (FocusPanel · PeopleRail · JourneyRail · ReflectionCard ·
ProgressBand · strengths chips) via one shared hook — phone and desktop, one self.

---

## 6. Self-critique (the six lenses)

**1 · Narrative before navigation.** *Pass.* Reads as a story of self (identity →
people → growth → reflection → strengths), not a tabbed profile. **Risk:** a hub with
several regions can drift toward a dashboard. **Guard:** keep the vertical narrative
order; regions are beats, not widgets; no tabs.

**2 · People before metrics.** *Strong pass.* Reporting line as faces, recogniser faces
on strengths and the first-recognition milestone. **Watch:** strengths must read as
*qualities with faces*, never a numeric leaderboard.

**3 · Ambient intelligence before search.** *Pass.* The growth Reflection interprets
*for* the person before any find box. **Risk:** a generic insight ("you're doing great")
would cheapen it — must be specific and true (named strength, named people) or omitted.

**4 · Context before forms.** *Pass — and the defining risk.* My Growth must **not**
become an editable profile form. Editing fields is a module action reached *from* here;
the surface itself asks nothing. If it ever sprouts input fields, it has failed.

**5 · Memory before history.** *Pass, with the migration.* Growth is the *distilled*
self, not a re-listed log. The Journey spine moving here (and Timeline keeping a compact
echo) is what prevents My Story and My Growth from showing the same milestones twice —
the Map's mandated migration is load-bearing, not cosmetic.

**6 · Progress before reporting & Reflection before closure.** *Pass.* Strengths and
(future) skills/learning are framed as momentum, never scores or peer-ranks (§3.5
guardrail). The surface closes *forward* ("the best chapters are ahead"), not "done."

**Cross-cutting honest risks:**
- **Thin-data reality.** Today only join + recognition + pay-firsts + anniversaries exist;
  skills/learning/promotions are future sources. So an early My Growth is *identity +
  spine + strengths* — real but compact. **Mitigation:** lead with the person and the
  spine; silence empty future sections entirely (no "coming soon" clutter); it degrades
  honestly, exactly like sparse Timeline. A quiet self is still a true self.
- **Overlap with My Company.** Company shows the live recognition *feed*; Growth shows *my*
  recognition *distilled into strengths*. Different question — hold the line (no feed here).
- **Overlap with My Story.** Resolved only if the Journey migration is actually executed at
  build; if both surfaces render the full spine, the audit will (rightly) call it duplication.
- **Vanity risk.** A "self" surface can tip into ego-metrics. Guard with the Progress rules:
  qualities not scores, never rank-against-peers, encouragement not judgement.

---

## 7. Build order (on approval — not before)

1. **`/ess/identity`** — person + reporting line + strengths (recognition grouped) +
   the Growth spine (reuse the Journey projector — no duplicate logic) + growth Reflection.
   Silent sections for absent sources.
2. **Migrate the Journey spine's home here**; reduce Timeline to a compact echo linking to
   My Growth (executes the Map's mandated migration — kills the spine duplication).
3. **Extract `PeopleRail`** (the reporting line) as the shared People primitive (Patterns
   §5 housekeeping) and a **strengths** component; reuse `FocusPanel · JourneyRail ·
   ReflectionCard · ProgressBand · PersonAvatar` unchanged.
4. **Desktop `MyGrowth` surface** + route `/ess/identity` (and `/manager/self/identity`).
5. **Mobile `MeHome`** as the Me-tab root; My Story reached from here; bottom-nav per the Map.
6. Skills / Learning / Achievements regions light up automatically as their event sources
   (and Moments propagation) come online — no redesign.

Each slice ships green (web + api tsc, vite build), as Home and Timeline did.

---

*My Story is what happened to me. My Growth is who I've become. Built right, an employee
opens it and sees not a record, but a person — themselves, growing.*
