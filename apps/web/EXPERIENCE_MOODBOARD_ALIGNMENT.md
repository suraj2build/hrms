# CognixHR — Mood-Board Alignment (RC2 → reference direction)

> A reference collage was provided as the *emotional and visual target* (not a layout to
> copy). This note reconciles the RC2 design language with it: what the board **confirms**,
> the one thing it **corrects**, and the per-surface mood it **pins**. Architecture, Core,
> nav, interaction model: frozen. Study the qualities; reinvent the presentation.

---

## 1. What the board confirms (RC2 was right)

- **Atmosphere over chrome** — every screen opens in a full-width ambient hero with its own
  light; you know the surface instantly. ✅
- **A serif emotional line** — each hero leads with one large, human display headline ("Good
  morning, Priya", "Your story so far", "All clear, Stay ahead."). ✅
- **People dominate** — faces everywhere: journey companions, team members, celebrants,
  kudos. ✅
- **One family / seven souls** — same shell, type, and people-language; a *different light*
  per surface. ✅
- **Frozen nav preserved** — the board's persistent left sidebar (Home · My Attention · My
  Growth · Assistant · Community · FlowDesk · Team · Rewards + Services + Manager) is exactly
  our IA. The redesign is presentation only. ✅

## 2. The one correction — *imagery is now first-class*

RC2 said "no image files; gradient meshes only." **The board overrides that.** Each hero is
an **immersive, cinematic atmospheric field** — a painterly landscape evoking the surface's
emotion (sunrise, dusk summit, teal peak, calm night, golden-hour, still lake, aurora). This
is the single biggest uplift from the reference.

**Direction:** the hero `Atmosphere` becomes a **richer, taller, layered field** — a radial
light-source (a "sun") + an atmospheric sky wash + soft depth — that *reads* as a cinematic
landscape. Two delivery tiers:
- **Tier 1 (now, asset-free):** sophisticated multi-layer CSS gradient meshes per mood —
  dark-mode-safe, AA-safe (headline stays on a controlled-luminance zone), zero asset weight.
- **Tier 2 (optional uplift):** curated, optimized hero photography/illustration per surface
  (the board's literal richness) — needs an art-direction + asset pipeline; the same
  `Atmosphere` slot accepts it later with no structural change.

## 3. The seven moods, pinned from the board

| Surface | Headline (voice) | Mood / light | Hero feeling |
|---------|------------------|--------------|--------------|
| **My Day** | "Good morning, Priya" | **Dawn** — warm sunrise, gold→peach→blue | a day awakening |
| **My Story** | "Your story so far" | **Dusk** — deep indigo/magenta summit at twilight, a lone figure | a reflective journey |
| **My Growth** | "Your growth, your way" | **Ascent** — teal/blue summit, a figure climbing | reaching, upward |
| **My Attention** | "All clear, Stay ahead." | **Calm night** — serene blue, a single ✓ | reassurance |
| **My Team** | "Your team, your impact" | **Golden hour** — warm amber, people together | human warmth |
| **My Company** | "Together, we build what matters" | **Open water** — serene lake & mountains | belonging, expanse |
| **My Assistant** | "Your assistant, always with you." | **Aurora** — deep violet/magenta with a teal spark | calm intelligence |

(My earlier atmosphere names map cleanly: Memory→Dusk, Clarity→Calm-night, Belonging→Open-
water, Intelligence→Aurora.)

## 4. Composition refinements observed (and how they meet our principles)

- **Immersive hero, then composed content** — a tall full-bleed hero with the serif headline
  + one-line subtitle, *then* the spine of movements below. (Our Atmosphere + Movement model,
  with a taller, richer hero.)
- **Stats sit beside meaning, small** — Story's "7 years · 5 roles · 12 milestones · 86
  memories" and Team's "5 present · 1 on leave · 0 at risk" are *quiet supporting numbers*
  under a human headline — exactly our "metrics support people, never replace them." Keep them
  small, tabular, never tile-dashboards.
- **Cards return — but only for discrete units.** The board does use cards (a Need, a kudos, a
  feed post, a quick-action) — confirming RC2's rule: cards for discrete *actionable/social*
  units; narrative and people float. Cards are softened (depth, no hard borders).
- **Faces at scale + clusters** — journey companions, "who I work with", celebrants as
  overlapping face rows. Matches People-as-interface.
- **Tabs/segmented controls** (Story: Timeline/Chapters/Memories/Highlights) are acceptable
  *within* a surface as a quiet secondary control — not a new nav. Optional per surface.

## 5. What stays exactly as RC2 / frozen

The two-voice type (Fraunces + Inter) · navy+teal base + per-surface light · borderless
floating depth · the ✨ ambient sentence · one type scale / 8-pt grid / premium easing /
signature per-surface motion · the seven composition archetypes (River, Ascent, Clearing,
Portrait wall, Field, Spotlight) · all frozen architecture, Core, nav, Moments, interaction.

---

*Net change from RC2: the hero becomes a richer, immersive, cinematic atmosphere (asset-free
now, photographic later), and the per-surface moods are pinned to the reference. Everything
else in RC2 holds. The proof: My Day, enriched to the reference's dawn.*
