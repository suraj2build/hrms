# CognixHR — Experience Cloud Visual Design Language (RC2)

> **Design only. Not for implementation yet.** Architecture, Experience Core, Event
> Model, IA, navigation, human questions, surface ownership, Ambient-AI philosophy,
> Moments contract, APIs, data flow, and interaction principles are **frozen**. This
> document redesigns *everything above the architecture* — the visual language and
> composition — so that a CognixHR screen is recognised instantly, without the logo,
> and feels like nothing enterprise software has felt like before.
>
> Companion: `EXPERIENCE_CONCEPTS_RC2.md` (per-surface desktop + mobile concepts).

---

## 0. The thesis — *one family, seven souls*

The product is intellectually differentiated and visually conservative. The fix is not
"prettier cards." It is a **design language with a point of view**:

> **Light, type, and people — composed like an editorial magazine, not assembled like a
> dashboard.**

Three convictions drive every decision:

1. **Atmosphere over chrome.** Each surface is a *room with its own light*, not a page
   with its own cards. You feel which surface you're on before you read a word.
2. **A human voice in type.** A display **serif** speaks the one emotional truth of each
   screen; a clean sans does the work. No enterprise product sounds like this.
3. **People are the interface.** Faces — large, warm, photographic — are the primary
   material. Metrics are set in small type *around* people, never in tiles *instead of*
   them.

Recognition formula: **serif emotional line + atmospheric light + faces + borderless
depth + the ✨ ambient sentence.** Any one screen carrying these five reads as CognixHR.

---

## 1. Composition — *the end of the uniform template*

The RC1 problem: every surface is `wash-card → heading → cards → heading → cards`. RC2
gives each surface a **distinct compositional archetype** with **one dominant focal
point**, **one emotional center**, and **one memorable moment**. Seven archetypes:

| Surface | Archetype | Dominant focal point | Memorable moment |
|---------|-----------|----------------------|------------------|
| **My Day** | **Editorial front page** | the serif greeting + the single thing that matters today | the dawn light shifting with the hour |
| **My Story** | **The River** — a continuous vertical line you descend through time | the "now" marker at the top of an endless descending spine | a milestone blooming as a station on the line |
| **My Growth** | **The Ascent** — a rising diagonal path of milestones | the journey path itself (not the profile) | the path lighting up as it climbs to "now" |
| **My Attention** | **The Clearing** — centred, vast negative space | the *one* thing that needs you — or the all-clear | the queue dissolving into a single calm line |
| **My Team** | **The Portrait Wall** — faces first, data second | the cluster of your people's faces | a celebrating teammate's face at full warmth |
| **My Company** | **The Field** — a warm, dense social mosaic | today's celebrations as big faces, alive | the company "pulse" — motion, reactions, life |
| **My Assistant** | **The Spotlight** — one calm command surface on a deep ground | the ask field and its single confident answer | the answer resolving with one precise action |

**Rules that break the grid:**
- **Asymmetry is default.** A strong left spine or an off-centre focal; never a symmetric
  tile grid.
- **Full-bleed where it carries feeling** (the atmosphere field, the timeline river, the
  company mosaic). Contained where it carries focus (the Assistant, the Attention clearing).
- **Overlap creates depth.** Content lifts *over* the edge of the atmosphere field; faces
  break their frames. Layering, not boxing.
- **One loud thing per screen.** Everything else is quiet. If two things shout, neither is
  the focal point.
- **"Should this be a card?"** Default answer: **no.** Cards are reserved for genuinely
  discrete, actionable units (a Need/Signal, a recognition). Narrative, people, and
  reflection float on the canvas.

---

## 2. Typography — *the two-voice system*

The single most recognisable, most consumer-premium decision.

- **Display serif — Fraunces** (optical, warm, humanist). Carries **the one emotional
  line** per surface, and nothing else: the greeting, "the story so far," the person's
  name, "you're all clear," "your people." Optical size set high for soft, expensive
  curves. *This is the voice of the product.*
- **Functional sans — Inter.** Everything else: eyebrows, body, data, actions, meta.
- **Mono — JetBrains** only for true data/code (rare).

**Scale (desktop · mobile):**

| Role | Face | Size | Use |
|------|------|------|-----|
| **Hero** | Fraunces 500 | 48–56 · 32–36 | the one emotional line |
| **Title** | Fraunces 500 / Inter 600 | 28–32 · 24 | a section's human title (sparingly) |
| **Eyebrow** | Inter 600, 0.16em tracking, UPPERCASE | 11 · 11 | the quiet label above a movement; tinted by atmosphere |
| **Body** | Inter 400/500 | 15–16 · 15 | reading text, narrative |
| **Meta** | Inter 500 | 13 · 12 | times, counts, supporting |
| **Data** | Inter 600, tabular-nums | contextual | numbers that sit *beside* people |

**Detail that signals craft:** generous line-height on the serif (1.05–1.12), tight
tracking (−0.01em); eyebrows widely tracked and tinted; one weight step between levels;
**nothing extrabold** (RC1 already corrected this). Numbers use tabular figures so data
feels engineered, not typed.

---

## 3. Color — *color as light, not decoration*

Constant base: **navy `#1A4D8F` + teal `#15B8A6`** (with `#2DD4BF` teal on dark, AA ink
`#0B7A6E` for teal text). Every surface is a **different light cast over that base** — an
*atmosphere temperature*, not a different palette.

| Surface | Atmosphere | Light recipe (over the base) |
|---------|-----------|------------------------------|
| My Day | **Dawn** — warm, awakening, *time-aware* | warm gold glow (top-left) → teal, shifting cooler by evening |
| My Story | **Memory** — deep, reflective | indigo→navy depth, a faint sepia warmth in the paper |
| My Growth | **Ascent** — luminous, upward | teal rising from below, brightening toward "now" |
| My Attention | **Clarity** — cool, near-monochrome | the lightest touch of navy; mostly air |
| My Team | **Warmth** — human, close | soft amber-within-brand, intimate |
| My Company | **Belonging** — bright, open | the brand at its most panoramic and alive |
| My Assistant | **Intelligence** — deep ground, one spark | dark navy field + a single teal spark |

Rules: atmospheres live in **backgrounds and one accent glyph only** — never in body
text (contrast stays AA). Semantic colors (success/warn) are used with restraint, as
quiet status, never as decoration. Dark mode is a *deeper night* of the same atmospheres.

---

## 4. Depth — *floating on light, never boxed*

- **Three planes:** the atmosphere field (deepest, ambient) → the canvas (tinted page) →
  floating content (soft, layered shadows). No borders anywhere.
- **Two elevations only** (`shadow-depth`, `shadow-depth-lg`) — soft, low-opacity, navy-
  tinted in light / black in dark. Elevation = importance, used sparingly.
- **Overlap as signature:** the hero content sits *over* the atmosphere's lower edge;
  faces overflow their containers; a milestone lifts off the timeline line. Layering
  creates the premium, three-dimensional feel enterprise software never has.

---

## 5. Imagery — *the enterprise taboo, used with taste*

Enterprise software fears imagery. We use it — but only **human and atmospheric**, never
stock:

- **Faces are the primary imagery.** Photo-backed avatars (initials fallback) at real
  scale: 88–112px in celebrations, 56px in people rails, clustered and overlapping for
  groups. A team is a wall of faces, not rows.
- **Atmospheric fields** — soft aurora/mesh gradients (the per-surface light). Generated,
  tokenised, dark-safe; never an image file.
- **Milestone & empty-state illustration** — a small, restrained, custom line-illustration
  vocabulary for the human peaks (joined, first recognition, an anniversary) and for calm
  empties ("your story is just beginning"). Warm, optimistic, on-brand — the texture a
  consumer product has and enterprise never does.
- **No hero stock photography, no decorative spot icons-as-art.** Imagery must carry
  meaning (a person) or feeling (light), never fill space.

---

## 6. Iconography — *restraint as refinement*

- One set (lucide), **1.5px stroke, rounded joins**, sized to the type beside it. Icons
  *support*, never decorate; a movement leads with an eyebrow word, not an icon.
- **Two signature glyphs only:** the **✨ spark** (the Ambient-AI voice — always teal,
  always paired with one sentence) and the **Cognix open-C** (used at milestone/identity
  moments). These two are the product's punctuation.
- Status uses shape + one quiet color, not loud iconography.

---

## 7. Avatars & people — *the human unit*

- `PersonAvatar` is the atom of the interface. **Photo-first, initials-fallback** with a
  deterministic per-name tint (so a person is *the same color everywhere*).
- **Scale carries emotion:** xl (88–112) for the celebrated person of the moment; lg (56)
  for people rails; sm (32) inline. The more it matters, the bigger the face.
- **Clusters & overlap** for groups (a team, a cohort) — overlapping rings, a warm pile of
  people, not a list of names.
- Accessibility: every face announces its name (RC1 fix preserved); decorative beside a
  visible label.

---

## 8. Motion — *rhythm, not animation*

- **One easing** (`cubic-bezier(.2,.7,.2,1)`), one base duration (~520ms). Entrance =
  a short **rise + fade**, staggered down the spine. Fully reduced-motion-honoured.
- **A signature entrance per emotional center:** Day *rises* like morning · Story
  *recedes* into depth · Growth *ascends* · Attention *settles*, and the all-clear
  *breathes open* · Team *gathers* faces in · Company *fades up* a living field ·
  Assistant *resolves* an answer with precision.
- **Micro-moments** that feel alive: a hover lift (1–2px + shadow), the ✨ shimmer on the
  ambient line, a number that counts up in Progress, the all-clear's single slow breath.
- Motion creates the *cadence* of a screen (loud → quiet → focal → calm), never spectacle.

---

## 9. Visual rhythm — *every screen breathes*

Each surface follows a breathing rhythm rather than a flat list:

```
   ATMOSPHERE (loud, the hero)
        ↓  large air
   the one thing that matters (focal)
        ↓  quiet
   the supporting movements (soft, staggered)
        ↓  the memorable moment (one peak)
        ↓  large air
   the calm close (the ambient line / the done state)
```

Air is **composed**, not empty: asymmetric margins, a left spine, content hanging off it —
so whitespace reads as *calm and intentional*, never as a half-finished page (the RC1
"empty white canvas" critique).

---

## 10. The family / the souls — *why this is cohesive and distinct*

**Unmistakably one product (the constants):** the serif+sans two voices · the navy+teal
base · the atmosphere-light language · borderless depth · faces-as-interface · the ✨
ambient sentence · one type scale, one 8-pt grid, one easing.

**Each surface its own identity (the variables):** the composition archetype (§1) · the
atmosphere temperature (§3) · the dominant focal point · the signature motion · the
memorable moment.

> Walk the seven and it is seven rooms in one beautifully-designed home: same architecture,
> same materials, same light *vocabulary* — but the light in each room is different, and you
> always know which room you're standing in. That is the difference between *"a nice HR app"*
> and *"I've never seen enterprise software feel like this."*

---

*Reinvent the light, the type, and the way people are seen. Keep the house exactly as it is.*
