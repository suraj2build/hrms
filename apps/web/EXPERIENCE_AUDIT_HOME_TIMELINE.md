# Experience Audit — Home + Timeline (Vertical Slice v1)

> A brutally honest *experience* review — not a code review. The question is not
> "does it work?" (it does) but "does it feel like the memory and front door of
> the company?" Reviewed as built. No architecture changes proposed; the Event
> Model and Experience Core are frozen. Refinements only.

---

## 0. The honest verdict (the decision gate)

**The slice is complete and the architecture is right. The experience is not yet
exceptional.** As built, Timeline reads closer to *"a beautifully styled activity
log"* than *"my journey"* — and I can name exactly why, in the code I wrote:

1. **Most rows are faceless.** Only `recognition` events carry a person. Leave,
   payroll, announcements, and even lifecycle render a grey type-glyph (leave/
   payroll have `actor: null` in the projector). The design promised "faces woven
   in"; in practice ~80% of a real timeline is anonymous icons. **This is the
   single biggest gap between the design's promise and the build.**
2. **Administrative repetition dominates.** Every finalized payslip becomes its own
   row — 24 near-identical *"Your {month} payslip was released"* lines down a
   two-year timeline. Repetition is the defining texture of a *log*, not a memory.
3. **Tapping a memory ejects you to a legacy module.** Row deep-links navigate to
   `/compensation`, `/leave/balance`, `/recognition` — the spell of "my journey"
   breaks the instant you touch it and land in a transactional table.
4. **"Load earlier" is a database word**, not a narrative one.
5. **First-day / sparse tone is wrong.** A day-one employee sees the origin closer
   *"This is where it began. Quite a journey."* — on their first day. That is
   emotionally false, and it's a real bug, not a matter of taste.
6. **No motion.** The patterns doc promised a calm 400ms fade/rise on entrance;
   the build renders statically. "Rendered" instead of "considered."

None of these are architectural. All six are copy / filtering / ordering / one
motion pass. So my recommendation (see §10) is a **short refinement pass before
Notification Center** — not a redesign, and not a rubber stamp.

What genuinely works and should be protected: the tenure-framed Focus, the
memory-aware Reflection, milestone emphasis (join + anniversaries), the
encouragement-not-scorecard Progress band, silence-as-calm empty states, human
time-group headers, and true one-product parity between desktop and mobile (same
primitives, same endpoint).

---

## 1. Seven personas, seven different reactions

**First-day employee.** Home is rich and welcoming; Timeline feels *premature*.
It's nearly empty, and the closer says "Quite a journey" when they have no journey
yet. Net feeling: "is this broken?" Timeline should be *forward-looking* on day one
("Day one — this is where your story begins"), not a hollow retrospective.

**Long-tenured employee.** Suffers *log fatigue*: two years of monthly payslips and
routine leave approvals bury the three things they actually care about — a
recognition, an anniversary, a promotion. And their biggest career beats
(**promotion, role change, manager change**) are *absent* — the projector doesn't
emit them. The peaks they'd feel proud of don't exist in their "memory."

**Manager.** Viewing their own timeline works, but instinctively reaches for "my
team's story" and hits a wall (Timeline is self-only — correct for now, but the
absence is felt). Worse: their *managerial* contributions (every leave they
approved, every report they recognised) are invisible in their own journey.

**CHRO.** Sees the retention/belonging power immediately — but worries about the
*median* employee in a fresh deployment: sparse data → thin experience. Also flags
that surfacing every payslip prominently makes comp feel ever-present, and asks
whether routine pay events belong in a *memory* at all.

**CEO.** Wants the five-second "wow." The Reflection panel delivers it — once,
then the scroll settles into administrative greys. Verdict: *the concept is a
differentiator; the current density is not.* It doesn't yet feel like something
no competitor has.

**Product designer.** Two heavy filled panels (Focus wash + Reflection gradient)
stack at the very top, pushing the first *actual memory* below the fold on mobile.
Reflection *pre-empts* the story instead of *punctuating* it. Deep-links break the
navigation model. Only recognition has faces. The Home→Timeline doorway is a tiny
heading link with no explanation of *why*.

**Apple HIG reviewer.** Consistency is good (shared primitives). But: no entrance
motion or transition consideration; two competing focal elements at the top where
there should be one; a copy bug in the empty/first-day state; and a navigation
inconsistency (reflective rows behave like action rows by deep-linking out). Would
pass the system, fail the polish.

---

## 2. Does Home lead to Timeline? Does Timeline feel like a page?

**Half-connected.** They share the Story DNA and voice, so they belong to the same
world. But Home never *narrates into* Timeline — the only bridge is a small
"Your timeline →" link on the "Here's your day" heading (and a card on mobile).
Nothing on Home explains *why* Timeline exists or *what* it will give. So Timeline
still arrives as "another page you can navigate to," not "the natural deepening of
the story Home started." Home answers "what matters today"; Timeline answers "how
has my journey unfolded" — but the *seam between the two questions is unspoken.*

**Why it can still read as a log:** faceless administrative rows + payslip
repetition + "Load earlier" + deep-links-to-modules. Fix those four and the same
data starts reading as memory.

---

## 3. Emotional quality — proud, or merely informed?

Honestly: **mostly informed, occasionally moved.** The moments that land — a
colleague's face recognising you, the Reflection line, an anniversary milestone —
are real and warm. But they're *outnumbered* by neutral administrative rows, so the
emotional average settles at "informed." Memory should make you feel *seen*;
right now you feel *updated*. The fix is not more events — it's fewer, more
meaningful ones, with more human presence (§10 #1, #2, #5).

---

## 4. Information overlap (Home ↔ Timeline)

Real and worth reducing:
- **Recent activity** appears in both: Home's "Here's your day" (`/ess/activity`,
  last 2 days) and Timeline's "Today / This week" groups are the same events.
- **Recognition** shows on Home (Your people) *and* Timeline.

**Recommendation:** keep Home's recent slice (it's the *today* lens) but let
Timeline *own depth*. Make Home's activity block explicitly the door into Timeline
("…and the rest of your story →") so the overlap reads as *continuity*, not
*duplication*. Nothing needs to disappear; the recent overlap should feel like the
same river, not two copies.

---

## 5. Sparse data

- **One month, little activity:** Focus correctly says "your story is just
  beginning," but the body is a payslip and a join event, and the closer mis-fires
  ("Quite a journey"). Feels empty + tonally off.
- **No recognitions:** the timeline loses its only faces → entirely glyphs.
- **No milestones:** anniversaries need a full year; a 3–11 month employee has only
  the join event as a milestone.

**Improvement:** lean into the *forward* frame when history is thin — celebrate the
beginning rather than apologising for the emptiness. A first-day/early timeline
should feel like an *opening chapter* ("Welcome. Everything from here becomes part
of your story."), with the join event as a proud anchor and the closer suppressed.

---

## 6. Mobile vs desktop

**Genuinely the same story** — same `/ess/timeline`, same primitives, same emotional
beats. Two honest differences: (a) the mobile entry point (a labelled "Your
timeline" card) is *clearer* than desktop's tiny heading link; (b) on mobile the two
stacked top panels eat the whole first screen before any memory appears. Neither is
significantly stronger overall; mobile's doorway is better, desktop's reading length
is better. Parity is a win — fix the top-panel stacking for both (§10 #10).

---

## 7. Manifesto test — modern HRMS, or Employee OS?

**Strip the branding today and it reads as "an unusually humane, beautiful HRMS" —
the front half of the Employee OS, not yet the whole thing.** The bones are
OS-grade (one Event Model, one Core, surfaces as lenses). The *flesh* is still
HRMS in four specific places — every one a refinement, not a foundation:

1. **Events are records, not memories** — "payslip released," "leave approved" is
   module language wearing a timeline.
2. **Navigation ejects to modules** — touching a memory drops you into a legacy
   transactional page.
3. **Repetition over meaning** — monthly payslip rows are log behaviour.
4. **Faceless rows** — people are the soul of the OS; only recognition has them.

Fix those four and it crosses from "HRMS that feels nice" to "OS that knows me."

---

## 8. What works (protect these)

Tenure-framed Focus · memory-aware Reflection (generosity / recognised / tenure
ranking) · milestone emphasis · Progress-as-encouragement (no scorecard) ·
silence-as-calm · human time-group headers · desktop/mobile one-product parity ·
the clean Event-Model → lens separation. The skeleton is exactly right. This audit
is about the *flesh*.

---

## 9. The ten biggest experience improvements (refinements only)

Ordered by emotional impact. None touch the architecture, the Event Model, or the
Core; all are copy / filter / order / weighting / one motion pass.

1. **Put people on every row that has one.** Resolve and show the leave *approver's*
   face; show the giver/receiver on recognition (done); for self-events with no
   other person, lead with the employee's *own* avatar so the row reads as "me,"
   not an anonymous glyph. Kill the faceless-log texture. *(projector copy/field
   refinement — same Event Model.)*
2. **Collapse administrative repetition into summaries.** Don't render 24 payslip
   rows — fold routine pay/leave into one quiet per-chapter line ("12 payslips,
   18 days off this year"), expandable. Individual rows only for the *notable*
   (first paycheck, a raise, a long break). Biggest single log→memory move. *(view
   layer.)*
3. **Fix the first-day / sparse tone (real bug).** Suppress "Quite a journey" under
   ~1 month; make the origin forward-looking — "Day one. This is where your story
   begins." Make the closer tenure-aware. *(copy + one conditional.)*
4. **Make Home narrate *into* Timeline.** After "Done for today," add one ambient
   invitation — "Your story so far: {tenure}, {last milestone}. Revisit your
   journey →." The doorway should explain *why*, not just link. *(small Home add.)*
5. **Rewrite event copy from record to memory.** "Your March payslip was released"
   → routine ones summarised (#2); leave → "You took 3 days to recharge in March"
   (rest, not an approval event). Lead with the human meaning. *(copy.)*
6. **Remove company announcements from the personal Timeline.** Company news isn't
   *my* journey — keep it on Home/Community. One filter in the Story lens; the
   canonical stream still carries it for those consumers. *(one-line filter.)*
7. **Keep memories inside the memory.** Reflective rows (recognition, milestones)
   shouldn't deep-link out to legacy pages — a memory is felt, not clicked through.
   Drop the href on reflective rows; reserve navigation for genuinely actionable
   ones. *(remove href on reflective types.)*
8. **Replace "Load earlier" with narrative language** — "Earlier in your story ↓".
   *(copy.)*
9. **Add the one considered motion pass** the design promised: 400ms fade/rise on
   group + item entrance, `prefers-reduced-motion` aware. This is most of the gap
   between "rendered" and "premium." *(motion on TimeGroup/items.)*
10. **Don't bury the story under two panels.** Let Reflection *punctuate* (appear
    after the first chapter) rather than pre-empt; lighten the Focus framing so the
    first real memory is reachable on the first screen, especially mobile. *(order/
    layout.)*

---

## 10. Decision-gate recommendation

**Do not approve Notification Center yet — but we are one short pass away.**

Home + Timeline is a *complete, sound, and genuinely promising* vertical slice. It
is not *yet* the exceptional, memorable experience the manifesto demands, for the
specific and fixable reasons above. None require touching the frozen architecture.

I recommend a **single tight refinement pass** (items #1–#10, the bulk of which are
copy/filter/order one-liners plus one motion pass and one summarisation view).
After it, Timeline should read as *"the story of my career"* with the branding
stripped — at which point the gate opens to Notification Center with confidence,
on top of an experience that's actually exceptional rather than merely complete.

*We set out to validate emotion, not architecture. The architecture passed. The
emotion is close — and the distance left is refinement, not reinvention.*
