# CognixHR — Experience Cloud Visual Language v2 · "Atmospheres"

> **A reinvention of presentation, not architecture.** Data model, Experience Core,
> Moments contract, navigation, the seven patterns, and every interaction principle are
> **unchanged**. What changes is the *visual language* — from "borderless cards on a flat
> canvas" to a system of **Atmospheres**: one cohesive design DNA in which each experience
> breathes with its own emotional center.

---

## 0. The thesis

The RC1 surfaces are *calm and correct* — but they share one flat, neutral canvas, so all
seven feel like the same quiet page with different text. A premium consumer product does the
opposite: it gives each space an **atmosphere** you can feel in the first half-second, while
every space is unmistakably one product.

> **One DNA, seven souls.** The skeleton (type system, 8-pt space, motion grammar, the seven
> patterns, navy+teal brand) is the constant. The *light* in each room is the variable.

---

## 1. The cohesive DNA (the constant across all seven)

- **Editorial, not dashboard.** Generous margins, a confident vertical spine, asymmetry,
  one big human line per surface. Whitespace is the luxury material.
- **A two-voice type system.** A **display serif** (Fraunces — warm, optical, premium) carries
  the *emotional beat* — the one human sentence that is the soul of each surface. Inter carries
  everything functional. The serif/sans contrast is the single most distinctive, most
  consumer-premium move, and it costs nothing in clarity.
- **Depth through light, never borders.** Soft, layered, low-opacity shadows + faint tints
  build hierarchy. Content floats; nothing is boxed. (RC1's "borderless" rule, now with real
  depth.)
- **One motion grammar.** 420ms, a single premium easing (`cubic-bezier(.2,.7,.2,1)`),
  entrance = a short rise + fade, staggered down the spine. Reduced-motion fully honored.
- **The brand base is constant** — navy `#1A4D8F` + teal `#15B8A6`. Each atmosphere is a
  *tint of light over that base*, never a different palette.

## 2. The signature mechanisms (how an Atmosphere is built)

1. **The Atmosphere field** — every surface opens in a full-bleed ambient header (not a card):
   a soft aurora/mesh gradient unique to the surface's emotional center, cradling the eyebrow,
   the serif hero line, and one primary affordance. This replaces the RC1 "Focus wash card."
2. **The spine** — beneath the field, movements float on a faintly tinted canvas with soft
   depth, separated by air (8-pt rhythm ×4 = 32), led by quiet uppercase eyebrows.
3. **The signature accent** — each surface has one accent *temperature* layered over the brand
   (warm dawn, deep memory, luminous ascent, cool clarity…), expressed in the field gradient,
   the eyebrow, and the one accent glyph — never in body text (contrast stays AA).
4. **The signature entrance** — each emotional center gets one distinct entrance choreography
   (rise, recede, ascend, settle…) from the shared motion grammar.

---

## 3. The seven Atmospheres (one system, seven emotional centers)

| Surface | Emotional center | Atmosphere (light) | Serif hero | Signature motion |
|---------|------------------|--------------------|-----------|------------------|
| **My Day** | **Dawn** — awakening, warm, forward | warm gold→teal sunrise, **time-of-day aware** (morning warm · evening cool) | the dynamic greeting | gentle **rise**, like morning |
| **My Story** | **Memory** — deep, reflective, slightly nostalgic | indigo→navy depth, faint sepia warmth | "the story so far" | chapters **recede** into depth |
| **My Growth** | **Ascent** — aspirational, luminous, upward | teal→bright vertical lift | the person's name | content **ascends / blooms** |
| **My Attention** | **Clarity** — calm, spacious, focused | cool, near-monochrome, maximal negative space | "what needs you" / "you're clear" | items **settle**, the all-clear **breathes open** |
| **My Team** | **Warmth** — human, close, social | warm amber-within-brand, soft | "your people" | faces **gather** in |
| **My Company** | **Belonging** — expansive, communal, bright | the brand at its most open & panoramic | "our shared world" | a wide field **fades up** |
| **My Assistant** | **Intelligence** — crisp, precise, responsive | deep ground + a single bright spark | "how can I help?" | answer **resolves** with precision |

Walk all seven and they feel like seven rooms in one beautifully-designed home: same
architecture, same materials, different light — and you always know which room you're in.

---

## 4. What is preserved (non-negotiable)

Architecture · data model · Experience Core services · Event Model · Moments contract ·
the seven-lens navigation/IA · every interaction principle (narrative-before-navigation,
people-before-metrics, ambient-before-search, silence-as-calm, the finishable My Attention,
the asked↔ambient Assistant boundary) · the RC1 accessibility + dark-mode gains (the serif is
AA-sized; atmospheres are tints that keep contrast; reduced-motion fully honored).

## 5. Rollout

The language lives in the **shared foundation** (tokens: Fraunces, depth shadows, atmosphere
accents, display scale) + two new primitives (`Atmosphere` field, `Movement` spine wrapper).
So the cohesion is *enforced centrally*, and each surface adopts its atmosphere by composition
— not a bespoke rebuild. Order: **prove on the flagship My Day**, validate the direction, then
roll the remaining six (each ~a theme + a signature touch), keeping every step green.

*Reinvent the light. Keep the house.*
