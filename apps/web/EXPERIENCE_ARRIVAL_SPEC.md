# The Arrival — Experience Specification

> **Status: for approval. No implementation until approved.**
>
> This specifies the **Arrival** — the first viewport of Home, and the defining experience of
> the product. It is to CognixHR what the lock screen is to an operating system and the hero is
> to a landing page: the thing seen first, most often, and remembered longest. We are not
> designing a hero section. **We are designing the ritual of arriving at work.**
>
> The arrival's whole job is to make one feeling true within five seconds — *"This feels like
> my workplace"* — before a single thought about work. Belonging first. Work follows, deeper in.

---

## 0 · The ritual

A ritual is a small, repeated act that means more than its mechanics. *Arriving at work* is one:
you cross a threshold, the place receives you, you sense who's already there, you settle, and
*then* you begin. The Arrival reproduces that ritual digitally, every time Home opens.

The ritual has **three beats**, always in this order, completed in under five seconds:

1. **Recognition** — the place knows you. (Your name, in a human voice.)
2. **Atmosphere** — you are *somewhere*, at *this hour*. (A living field that is the time of day.)
3. **Belonging** — you are not alone here. (The faint presence of your people.)

The ritual repeats daily but is **never identical** — time and life re-dress it — so it stays
alive rather than becoming wallpaper. Like a lock screen, it **asks nothing of you.** It simply
receives you. The reward for arriving is the feeling itself, not a task list.

---

## 1 · Emotional purpose

| | |
|---|---|
| **Lasting psychological outcome** | **Belonging** — "This is my workplace. It's mine, and it knows me." |
| **The secondary outcome (earned, never first)** | **Direction** — "and here's what today holds" — reached only by walking deeper. |
| **Primary human question** | *"Am I home?"* (answered: yes) — not yet *"what do I have to do?"* |
| **The five-second memory** | *"This feels like my workplace."* Unprompted, in their own words. |
| **The felt sequence (first seconds)** | arrival → being known → reassurance → belonging → (optional) curiosity to go deeper. |

**What the Arrival is NOT optimizing for:** task initiation, information density, navigation,
speed-to-action, engagement metrics, feature discovery. Those are the work of rooms deeper
inside. Optimizing the *door* for *throughput* is exactly how we got a dashboard.

**Atmosphere's role:** reinforcement, never decoration. The light, time, and motion exist *only*
to make belonging more felt. The test (see §7): if you removed the atmosphere, belonging must get
*weaker*. If any pretty gradient could swap in with no loss, it was decoration — and it's wrong.

---

## 2 · Immutable elements

These five elements (and the one absence) are the **DNA of the Arrival.** They appear in *every*
state, on *every* device. States change their *dressing* (light, words, warmth) — never their
presence or their order. This is what keeps "one family, infinite mornings."

### 2.1 The Field — *the place, at this hour*
- A **full-viewport**, immersive atmospheric field that reads as *the time of day in a place* —
  not a banner behind content. It owns 100% of the first screen.
- It is **alive**: a barely-perceptible, slow drift ("breathing") so the place feels inhabited
  even in stillness. Never animated enough to notice consciously.
- **Why immutable:** without a sense of place and hour, it's a screen, not somewhere you arrived.
- **Constraints:** must hold a controlled-luminance zone behind the text (AA in every state,
  including night); CSS-now, photographic-later behind the *same* slot with no layout shift.

### 2.2 The Greeting — *it knows you*
- Your **name**, greeted, in the **display serif**, large and unhurried. The page's `<h1>`.
- Time- and context-aware voice ("Good morning, Priya." / "Welcome back, Priya." / "Still here,
  Priya?").
- **Why immutable:** recognition by name is the entire difference between *welcome* and *log in*.
- **Constraints:** real text (never an image); first and most prominent thing the eye meets;
  never paired with a count or a verb-task.

### 2.3 The Human Line — *the day's feeling, not its tasks*
- **One** sentence about how the day *feels*, drawn from real context but spoken as a person
  would. *"It's calm today. You're all set."* / *"A full one ahead — nothing's on fire."*
- **Why immutable:** it converts data into reassurance; it's the voice of a place that has your
  back.
- **Constraints:** exactly one line; never a number-as-fact; never an instruction; if it can't be
  said warmly and truthfully, it falls back to the calm default (§3.4) — it never forces drama.

### 2.4 Presence — *you're not alone in the building*
- A **faint, ambient** sense of your people being here: a few faces, low in the frame, and a
  plain line (*"Aarav, Maya and 5 others are already here"*).
- **Why immutable:** belonging is *social*. Recognition + atmosphere make a beautiful screen;
  presence makes it a *workplace*.
- **Constraints:** ambient, never interactive on the threshold (no click-to-profile here); faces
  decorative; the line carries meaning for assistive tech; degrades gracefully to solo states
  (§3.5) without ever feeling lonely.

### 2.5 The Deeper Cue — *there's more inside, when you're ready*
- A **single, whisper-soft** invitation downward. Not a button, not a CTA, not labeled with a
  task. Just enough to say the day waits further in.
- **Why immutable:** it makes the emptiness *generous and intentional*, not broken or unfinished.
- **Constraints:** one only; visually quietest element on screen; keyboard-focusable and
  labeled for assistive tech ("Go to your day"); never a colored/filled control.

### 2.6 The Sacred Absence — *what must NEVER appear on the Arrival*
Banned from the first viewport, in every state, without exception:
- task tiles, quick actions, buttons (except the one deeper cue) · KPI/metric cards · numeric
  badges or counts as primary elements · "what needs you" / signals / approvals · nav menus or
  module grids competing for the eye · onboarding nudges, "complete your profile," promos ·
  notification dots · anything that asks you to *work*.
- **Why immutable:** the absence *is* the welcome. The instant work appears at the door, the
  ritual collapses into a dashboard.

---

## 3 · Arrival states

The Arrival is one ritual rendered through a **state matrix**. Two axes drive the dressing:
**time-of-day** (the ambient default) and **context-moment** (a life event that *overrides* the
clock). Plus edge/data states that must never break the ritual.

### 3.1 Time-of-day states (the ambient baseline)

| State | Window | Light | Greeting voice | Human-line tone |
|-------|--------|-------|----------------|-----------------|
| **Dawn** | ~5–8 | warm sunrise, gold→soft blue, rising | "Good morning, {name}." | fresh, unhurried |
| **Morning** | ~8–12 | bright, clear, ascending | "Good morning, {name}." | ready, calm |
| **Midday** | ~12–17 | high, open daylight | "Hello, {name}." | in-flow, steady |
| **Evening** | ~17–21 | amber, lowering, golden | "Good evening, {name}." | winding down, warm |
| **Night** | ~21–5 | deep, dim, quiet, a few stars | "Still here, {name}?" | gentle, caring (go rest) |
| **Weekend / rest** | Sat–Sun | soft, calm, off-duty | "Enjoy the weekend, {name}." | light, no pressure |

### 3.2 Context-moment overrides (life beats the clock)

A real workplace greets you differently on a day that matters. These **re-dress** the ambient
state (warmer/specific light + a line that *names* the moment). Priority order when several
collide is top-to-bottom:

| Moment | What changes | Greeting / line example |
|--------|--------------|--------------------------|
| **First day** | warmest light; presence foregrounded (your new team) | "Welcome, {name}. You're one of us now." |
| **Return from leave** | warm, re-entry light | "Welcome back, {name}. You were missed." |
| **Birthday** | celebratory warmth, gentle sparkle | "Happy birthday, {name}." |
| **Work anniversary** | golden, milestone glow | "{n} years today, {name}. Thank you." |
| **Payday** | bright, light relief | "Payday, {name}. A good day." |
| **Company holiday / eve** | restful, anticipatory | "{Holiday} tomorrow — enjoy it, {name}." |
| **Recognition received** | warm spark | "Someone appreciated you, {name}." |
| **After-hours / late** | dim, caring | "It's late, {name}. The day can wait." |

Only **one** moment is expressed at a time (the highest-priority), so the Arrival never clutters.
The moment colors the line and light; the five immutable elements stay exactly in place.

### 3.3 Data/edge states (the ritual must survive all of them)

| State | Behavior — the ritual never breaks |
|-------|-----------------------------------|
| **Slow data** | Field + greeting paint *immediately* from time + cached name; line/presence fade in when ready. Never a spinner at the door. |
| **No/partial data** | Greeting + field always render. Missing line → calm default. Missing presence → solo state (§3.5). |
| **Hard error** | Still a complete, dignified arrival: field + "Hello, {name}." + a calm line. Errors live *deeper*, never on the threshold. |
| **Unknown name** | "Hello there." — warm, never "Hello, User" / blank. |

### 3.4 The default — *a quiet, ordinary day*
Most days have no special moment and no urgency. The default is **calm, not empty**: ambient
time-of-day light, name, presence, and a reassuring line — *"It's calm today. You're all set."*
The ordinary day must feel *good*, because most arrivals are ordinary. This is the state we
perfect first.

### 3.5 The solo / new state — *belonging without a crowd*
For new joiners, lone-wolf roles, or absent presence data, belonging cannot lean on a crowd.
Presence degrades to **place-belonging**: the line speaks to *the company* ("The team's here —
27 in today.") or, for a true first day, to *being welcomed in* — never an empty frame, never a
sad "no one's here." The Arrival must make a solo employee feel they belong *to the place* even
when no face is shown.

### 3.6 The second-visit guard — *don't go robotic*
On repeat visits the *same* day, the Arrival must not woodenly re-greet "Good morning" for the
fifth time. It softens on re-entry (a quieter greeting / "Back again, {name}.") so the ritual
feels *alive and aware*, not on a loop. (Implementation detail: a lightweight same-day visit
awareness — specified, decided at build.)

---

## 4 · Transitions

Motion is **atmosphere, not animation.** Nothing is "app-y." Every transition has a reduced-motion
equivalent that preserves the feeling without movement.

### 4.1 Entry — *lights coming up as you step in*
On load, the place **warms up** rather than popping in. Sequence and timing (target feel):
1. **Field** appears first — a soft fade-up of the atmosphere (~600–800ms, ease-out). The room
   exists before anything is said.
2. **Greeting** settles in — a gentle rise + fade (~500ms), starting ~150ms after the field. Like
   a light finding your face.
3. **Human line** follows (~400ms, +120ms stagger).
4. **Presence** arrives last, softly (~400ms, +120ms) — people "already here" fading into view.
5. **Deeper cue** breathes in last, quietly.
- **Total choreography ≤ ~1.2s**, and the greeting is *readable within the first frame paint*
  (the animation is polish over already-legible content, never a gate on comprehension).
- **Reduced-motion:** no rise/stagger — elements simply appear at full opacity; the field is
  static. The arrival is just as complete.

### 4.2 Idle — *the place breathes*
A continuous, **barely-perceptible** drift of the field (slow light movement, ~8–14s period, tiny
amplitude) so the place feels inhabited and alive. Must be *subliminal* — if a user consciously
notices it looping, it's too strong. **Reduced-motion: fully still.**

### 4.3 Walking deeper — *the threshold yields to the building*
Scrolling down is **moving through a space**, not paging a feed:
- The threshold **recedes** as you scroll (a gentle parallax / light-travel: the field drifts and
  dims slightly, as if you've stepped past the entrance into the interior light).
- The deeper rooms (people → today → what-needs-you) rise into a **calmer interior atmosphere** —
  the morning light gives way to a focused, quiet ground.
- The frozen **nav rail re-emerges** to full presence only *after* you leave the threshold (at the
  door it was dimmed/receded; inside, navigation is welcome again).
- **Work becomes reachable only here** — never pulled up to the door.
- **Reduced-motion:** no parallax; sections simply scroll normally; the light-shift is a static
  difference between threshold and interior, not an animated one.

### 4.4 Time-boundary re-dress — *if left open across an hour*
If Home sits open across a time boundary (e.g. morning → midday) or a context changes, the
Arrival may **re-dress gently on next focus** (a soft cross-fade of light + greeting), so the
place keeps honest time. Never a jarring mid-session jump while the user is reading.

---

## 5 · Mobile experience

The phone opens the **same door** — and the discipline is *stricter*, because the screen is the
threshold entirely.

- **Full-screen arrival.** The Arrival owns the entire first viewport, edge to edge, including the
  area behind the status bar (safe-area aware). The current glossy app header **yields** to the
  arrival — there is no app chrome at the door.
- **The bottom nav is deferred** on the threshold (hidden/quiet), re-appearing as you scroll into
  the day — mirroring the desktop nav rail receding at the door. *(Confirm at build: if platform
  guidelines require persistent nav, it appears in its calmest possible form.)*
- **Stricter content.** One greeting, one human line, presence, one deeper cue. Nothing else.
  Mobile is where "nothing to do at the door" matters most — it's the most-glanced surface.
- **Ergonomics.** Greeting sits in the comfortable upper-middle; the deeper cue near the natural
  thumb zone. One-handed, no reach to *do* anything (there's nothing to do).
- **Performance.** First meaningful paint of *field + greeting* must be near-instant on a mid-tier
  phone and a slow network — atmosphere is lightweight (CSS), name from cache; nothing heavy
  blocks the greeting. Photography (later) streams in behind, never blocking.
- **Identical soul.** Same three beats, same immutables, same five-second outcome. Desktop and
  mobile differ in *frame*, never in *feeling*.

---

## 6 · Accessibility

Accessibility is **part of the welcome**, not a retrofit. A screen-reader user must *also* feel
they arrived somewhere that knows them.

- **Structure & landmarks.** The greeting is the page's single `<h1>` (the SR anchor). The Arrival
  is a labeled region ("Welcome"). A skip-to-content link reaches the day.
- **Screen-reader reading order:** greeting → human line → presence (as a real sentence, e.g.
  "Aarav, Maya and 5 others are here") → the deeper cue ("Go to your day"). The order *is* the
  ritual: known → reassured → belonging → invited.
- **The field is `aria-hidden`.** Decorative faces are `aria-hidden`/decorative; the presence
  *line* carries the meaning.
- **Contrast (AA) in every state.** Greeting/line/presence text holds ≥ AA against its
  controlled-luminance zone in *all* time states — including **Night** and system **dark mode**.
  Night/dark is the easiest state to fail; it is explicitly tested.
- **Reduced motion.** `prefers-reduced-motion` removes breathing, parallax, and entry stagger;
  the arrival is fully present and equally complete without motion.
- **Keyboard.** Nothing traps focus; nothing *needs* interaction. The only focusable control is the
  deeper cue, with a clear visible focus ring and a descriptive label.
- **Color independence & color-scheme.** No meaning by color alone; respects
  `prefers-color-scheme`. The night/dark arrival is a designed state, not an inversion.
- **Cognitive.** Plain, warm language. No jargon, no metrics to parse, nothing to decode. The
  lowest-load home screen possible — by design.

---

## 7 · Failure tests

If the Arrival fails **any** of these, it has regressed into a hero section or a dashboard and is
not done. These are pass/fail, not aspirations.

1. **The five-second residue test.** Show it for five seconds, hide it, ask "what do you
   remember?" Pass = *"it felt like my workplace / it knew me."* Fail = a number, a task, a
   feature.
2. **The "nothing to do" test.** Is there any actionable/work element above the fold besides the
   single deeper cue? If yes → fail.
3. **The remove-the-atmosphere test.** Strip the field. Does *belonging* measurably weaken? If it
   feels the same → the atmosphere was decoration → fail.
4. **The swap-the-gradient test.** Could any unrelated pretty gradient replace the field with no
   loss of meaning? If yes → decorative → fail. (The field must read as *this place, this hour*.)
5. **The screen-vs-place test.** Describe it in one word: did testers say "a place / a moment" or
   "a screen / a page"? "Screen" → fail.
6. **The stranger test.** Would it greet a stranger identically? If the name/context could be
   swapped for anyone with no change, recognition is fake → fail.
7. **The second-visit test.** Open it five times in a morning. Does it feel aware (softening) or
   robotic (same canned greeting)? Robotic → fail.
8. **The solo-employee test.** A brand-new joiner with zero connections — do they still feel they
   *belong to the place*? An empty or lonely frame → fail.
9. **The bad-day test.** On a genuinely heavy day, is the Arrival still calm and honest — neither
   lying ("all clear") nor dumping the workload at the door? A pile of work at the threshold →
   fail.
10. **The night/dark contrast test.** In Night state and system dark mode, do greeting/line/
    presence hold AA? Below AA → fail.
11. **The reduced-motion test.** With motion disabled, is the arrival just as complete and just as
    moving? If it depends on animation to land → fail.
12. **The performance test.** Field + greeting paint fast on a mid-tier phone / slow network, no
    spinner at the door, no layout shift when presence/photography loads. Spinner or jank → fail.

---

## 8 · Definition of done (the Arrival)

The Arrival ships only when **all** are true:
- The first thing the eye meets is **atmosphere + your name** — never a piece of work.
- There is **nothing to do** at the door, and that reads as **generosity**, not a gap.
- It passes **all twelve failure tests** (§7), including night/dark AA and reduced-motion.
- The five immutable elements (§2) are present, in order, in **every** state (§3), on phone and
  desktop, with identical soul.
- Removing the atmosphere weakens belonging (it reinforces, never decorates).
- It is **calm, fast, AA-accessible, reduced-motion-safe**, and survives every edge state without
  breaking the ritual.

## 9 · Out of scope (explicitly)

The rooms *deeper inside* — People, Today, What-Needs-You, the quiet close — are **not** specified
here. They are built only **after** the Arrival passes its definition of done, one room at a time,
each held to "does this still feel like a place, not software?" This document governs **the door**.

## 10 · Open questions for sign-off

1. **Photography vs. CSS for v1.** Ship Tier-1 (CSS atmospheres) first and add Tier-2 (cinematic
   photography) behind the same slot later — or commission photography before first ship?
   *(Recommendation: ship Tier-1 to perfect the ritual fast; photography is an uplift, not a
   blocker.)*
2. **Presence data source & privacy.** "Already here" implies attendance/presence. Confirm the
   data source and that surfacing "who's in" is acceptable (or scope presence to celebrations /
   "the team's here — N in today" if presence is sensitive).
3. **Mobile persistent nav.** Confirm the bottom nav may fully hide on the threshold, or must
   remain in a minimal form per platform guidelines.
4. **Second-visit awareness.** Confirm we may track lightweight same-day visit state to soften
   repeat greetings.
5. **The deeper cue.** One soft downward affordance only — confirm it's acceptable that the door
   has *no* labeled actions at all.

> Approve this specification (or mark up the open questions), and implementation of the Arrival —
> and only the Arrival — begins, validated against §7 before any deeper room is built.
