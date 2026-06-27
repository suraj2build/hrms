# Experience Audit — Continuity across My Day · My Story · My Growth

> A walkthrough of the complete employee journey as **one product**, not three
> screens: Login → My Day → My Story → My Growth → Home → Logout. Reviewed as built.
> No redesign, no new architecture — only continuity fixes between the three frozen
> experiences. Issues found are resolved in the same pass (§4).

---

## 0. The emotional arc (what works)

Walked end to end, the three surfaces form a genuine arc:

- **My Day** — *present*. Calm, "what matters today," ends "you're all set."
- **My Story** — *past*. Reflective, chaptered, ends "this is where it began."
- **My Growth** — *future/self*. Aspirational, "how you've grown," ends "the best
  chapters are ahead."

**Present → reflect → aspire.** The pivot from My Story ("where it began", backward)
into My Growth ("chapters ahead", forward) is the strongest seam in the product — a
satisfying turn from memory to becoming. The shared primitives (Focus wash, one
Reflection gradient per surface, `PersonAvatar`, the centred ✓ closer) make the three
feel cut from one cloth. This is one product, not three pages.

The natural click-path even tells the story in order: My Day's "your story →" → My
Story → the growth echo → My Growth. The journey the user named is the journey the
nav already walks.

---

## 1. The real continuity break: "journey" means two things

The one genuine problem, and it's a language collision I introduced:

- **My Story** calls itself **"YOUR JOURNEY"** (its Focus eyebrow) and Home invites
  *"revisit your **journey** so far →"* — both pointing at My Story (memory).
- **My Growth** owns *"how you've grown"*, *"your growth **journey**"* (the spine and
  the Timeline echo) — the actual Growth surface.

So the same word — **journey** — labels both *memory* and *growth*. An employee can't
tell which "journey" a link means. This is the duplicated-concept / inconsistent-
language issue, concentrated in one word.

**Resolution (one clean split, copy-only):**
- **"Story"** belongs to **My Story** (memory): "YOUR STORY", "your story so far".
- **"Journey / grown / growth"** belongs to **My Growth**: "how you've grown", "your
  growth journey".

After the split there is exactly one owner of each word, and every link's destination
is unambiguous from its label.

---

## 2. Duplication that is correct (leave it)

- **Recognition appears on all three** — My Day (a peek: "you were recognised"), My
  Story (a memory row with the giver's face), My Growth (a distilled *strength*). This
  is the Moments contract working as designed: one moment, three *different* facets,
  three different questions. Verified each facet genuinely differs — **not** a bug.
- **One Reflection gradient per surface** — three across the walkthrough, but each is a
  *different* insight (today's / the memory arc / growth). Scarcity holds (one per
  surface). **Watch:** for a mid-tenure, low-recognition employee, My Story's tenure
  reflection ("…this is where it all began") and My Growth's ("…you're building
  something here") are close in spirit — distinct enough today, but keep an eye that
  they never render near-identical wording. No fix now.

---

## 3. Smaller observations

- **Navigation friction (mobile):** My Growth lives in "More" + the Story echo; it's
  not a bottom-nav tab yet. Acceptable — the 5-tab restructure waits until My Attention
  / My Company exist (per the Map). The Story-echo bridge keeps it reachable in-narrative.
- **Two Story doorways on Home** (the "Here's your day" heading link + the closing
  invitation). Mild redundancy, but they sit in different contexts (contextual vs
  narrative) and now use consistent "story" wording — kept, not merged.
- **Sidebar says "Home", not "My Day".** Acceptable: Home is the universal front door;
  the other surfaces being "My ___" while the hub is "Home" reads naturally. Left as-is.
- **Mobile Home's Story card icon is a Trophy** — slightly growth-flavoured for a link
  to *memory*. Cosmetic; noted, not changed (would add an icon import for little gain).

---

## 4. "Looking Ahead" → "Your Next Chapter"

**Adopted — it genuinely improves clarity.** "Looking Ahead" is generic corporate
language. **"Your Next Chapter"** speaks the platform's own narrative vocabulary: My
Story is built from **chapters** (Joining, Settling in, This year). Naming My Growth's
forward section "Your Next Chapter" ties the biography together — the past chapters live
in My Story, the next one is being written in My Growth. It's warm, first-person, and
forward, with no collision (Story's chapters are past; this is *next*).

---

## 5. Fixes applied in this pass (copy + label only)

1. **My Story** Focus eyebrow `YOUR JOURNEY` → **`YOUR STORY`**.
2. **My Day** doorways → "story" language: heading `Your timeline →` → **`Your story →`**;
   closer `Revisit your journey so far →` → **`Revisit your story so far →`**.
3. **My Day (mobile)** Story card copy → story language (no "journey").
4. **My Growth** section `Looking ahead` → **`Your next chapter`**.

Result: **"story" = memory, "journey/growth" = becoming** — one owner per word, every
doorway unambiguous, the biography metaphor consistent across all three surfaces.

---

## 6. Verdict

With the language split applied, My Day · My Story · My Growth read as **one continuous
product**: a single employee, walked from their present, through their memory, to who
they're becoming — same voice, same primitives, unambiguous doorways, a coherent
present→past→future arc. **These three experiences are ready to freeze.**

*One employee. Three lenses. One world that knows them — and now speaks of itself with
one consistent voice.*
