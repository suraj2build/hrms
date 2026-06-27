# Experience · Product · Commercial — Chief Architect sections

## EXPERIENCE DIMENSION (per the 7 surfaces × 8 sub-dimensions)

### Findings

**E1 — Focus header type scale is inconsistent across surfaces.**
- Severity: **Medium** · Impact: breaks the "one type scale / one product" promise — the very first thing the eye lands on differs surface to surface (Timeline `FocusPanel` uses `text-[1.6rem]`; MyGrowth custom header `text-[1.5rem]`; MyAttention/MyTeam/MyCompany inline Focus `text-[1.4rem]`; Home uses the greeting block).
- Recommendation: route every surface's Focus through the shared `FocusPanel` primitive (or a single header component) with one size token. Retire the three inline Focus wash variants.
- Effort: **M**

**E2 — Eyebrow label casing/voice inconsistent.**
- Severity: **Low** · Impact: "YOUR STORY" (uppercase) vs "Across the company" vs "What needs you" vs "Your team" vs MyGrowth (no eyebrow) — small but felt cross-experience inconsistency.
- Recommendation: one eyebrow convention (uppercase tracking-wider, present on all seven).
- Effort: **S**

**E3 — Navigation: sidebar pillar set is crowded and labels are inconsistent.**
- Severity: **Medium** · Impact: the employee sidebar now carries 8 pillars (Home · My Attention · My Growth · Assistant · Community · FlowDesk · Team · Rewards) with mixed naming — first-person ("My Attention/My Growth") beside bare nouns ("Home/Community/Team/Rewards"). "Community" pillar opens the **My Company** surface (label≠destination). Cognitive load + inconsistency.
- Recommendation: settle one naming convention (recommend first-person for the 7 lenses); rename "Community"→"My Company", "Team"→"My Team", "Rewards"→"Recognition" or fold under a lens; consider grouping non-lens tools (FlowDesk/Rewards) below the 7 lenses. (Navigation is frozen in IA, not in label hygiene — this is copy, not restructure.)
- Effort: **M**

**E4 — Mobile parity is uneven (the biggest Experience gap).**
- Severity: **High** · Impact: Home and Timeline have bespoke, premium mobile screens (`MobileHome` glossy, `MobileTimeline`); the five newer lenses (Growth/Attention/Team/Company/Assistant) render the **responsive desktop page** on mobile. They work and are readable, but they are not "thumb-first / native-feeling" to the standard `MobileHome` set — inconsistent mobile quality across the seven.
- Recommendation: a mobile-excellence pass (program Agent 4) bringing the five responsive surfaces up to the `MobileHome` bar (touch targets, glossy headers, thumb reach, sheet transitions) WITHOUT shrinking desktop. No redesign — a parity/polish pass.
- Effort: **L**

**E5 — Moments cross-surface duplication is intended but unvalidated against real feel.**
- Severity: **Low** · Impact: a teammate's birthday appears in My Team ("Today") and My Company ("Celebrating today"); a recognition appears in Home peek + My Story + My Growth strength + My Company. By design these are *different facets* (Moments contract), but a user touring all surfaces sees the same person/event repeatedly. Risk it *reads* as duplication even though it is architecturally distinct.
- Recommendation: validate with the QA personas; if it grates, differentiate the copy per facet more sharply (Team = "wish a teammate", Company = "the company celebrates"). No structural change.
- Effort: **S** (copy) — verify first.

### What PASSES (protect)
- Human question answered: ✅ each of the 7 owns exactly one question; zero overlap verified.
- Emotional quality: ✅ strong — memory (Story), growth (Growth), calm-to-zero (Attention), belonging (Company), care (Team).
- Storytelling: ✅ strong on Home/Story/Growth; Attention/Team/Company are appropriately sectioned (not every lens is a narrative scroll, by design).
- Moments: ✅ propagation is faceted, not copied; My Attention correctly excludes non-clearable FYI.
- Ambient AI: ✅ one quiet sentence per surface; Assistant correctly the asked lane (no unprompted emission). Good coverage.

---

## PRODUCT DIMENSION — persona journeys

**P1 — New Joiner.** Mostly good: Home welcomes (first-day greeting), Timeline is forward ("Day one — your story begins"), Growth says "just getting started", Company shows their welcome, Team shows manager+peers. **Gap:** the Moments matrix promised *onboarding tasks → My Attention* for a new joiner, but `signals.ts` emits no onboarding-task signal, so a new joiner's My Attention is likely empty ("all clear") on day one — technically fine (no fabrication) but a missed guidance moment. Severity **Low**; Recommendation: when an onboarding module/event source exists, wire onboarding tasks as `needs_you` signals (future event source, not now). Effort **M** (deferred).

**P2 — Store / frontline Employee.** Mobile-first, often no rich hierarchy/recognition data → thin Growth/Team/Company (honest empty states, good). The core flow is punch (FAB) — works. **Tie to E4:** because frontline is mobile-only, the uneven mobile parity (E4) hits this persona hardest. Severity **Medium** (rolls up into E4).

**P3 — Corporate Employee.** Richest data, full experience — the strongest journey. No new findings.

**P4 — Remote Employee.** The "you haven't checked in" signal could nag remote workers, but copy already offers "raise a regularization if you're working remotely." Acceptable. Severity **Low**.

**P5 — Manager.** My Team (care-insight, people) + My Attention (team approvals, people-first) are strong. **Friction:** the manager lives across TWO shells — `/manager/*` console and `/ess` (or `/manager/self/*`) employee mode — with a persona toggle on mobile. Cross-shell context-switching is a navigation-clarity risk. Severity **Medium**; Recommendation: ensure the Me↔Team / console↔self transitions are obvious and preserve scroll/context; audit in QA. Effort **M**.

**P6 — HR (hr_admin).** Sees tenant-wide approvals (Attention), Company moderation controls (kept). Works. Confirm the tenant-wide approval scope in Attention isn't overwhelming for large tenants (caps at 5 + "more"). Severity **Low**.

**P7 — Executive in employee mode.** Identical to employee — correct (Executive OS is out of scope). No findings.

---

## COMMERCIAL — Why a CHRO chooses CognixHR over a traditional HRMS (the five reasons)

1. **It's an Employee Operating System, not a portal of modules.** Employees live in seven first-person experiences that tell one story — not a menu of forms (Leave / Payroll / Attendance). This is the difference between software employees *tolerate* and software they *open daily*. Adoption and engagement — the metric most HRMS rollouts die on — is the headline.

2. **People-first, emotionally designed — built for belonging and retention.** Faces over rows, recognition and celebrations surfaced warmly, a Timeline that remembers an employee's journey and a My Growth that reflects who they're becoming. Traditional HRMS is transactional; CognixHR makes an employee feel *seen*. That is a retention lever, not a cost centre.

3. **Ambient AI woven through the product — not a bolted-on chatbot.** Every surface carries one quiet, contextual insight that explains, reassures, or encourages; and an asked Assistant that leads with an answer + an action, not a chat window. Intelligence as the fabric of the experience — a credible "AI-native HR" story a CHRO can take to the board.

4. **My Attention inverts notification fatigue.** Uniquely, the attention surface is built to be *emptied* — "Nothing needs you. You're all clear" is the designed reward, and it can never accumulate non-clearable noise. Against every enterprise inbox that only grows, CognixHR offers a *finishable* workday. No competitor frames attention this way.

5. **One coherent architecture under everything — premium, consistent, fast to extend.** A single Event stream, a Moments propagation contract, and a frozen Experience Map mean every surface feels like one product, mobile and desktop, with zero feature overlap — and new capability composes in without redesign. For a CHRO that means a platform that *stays* coherent as it grows, lower change-management cost, and a product employees are proud to use.

> The one-line pitch: *Traditional HRMS digitises HR paperwork. CognixHR gives every employee an operating system for their work-life — and makes them want to open it.*
