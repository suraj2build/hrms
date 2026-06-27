# Employee Operating System v1 — Design System Audit (CERTIFICATION)

**Auditor role:** Design System / frozen-design-language conformance
**Spec of record:** `apps/web/EXPERIENCE_PATTERNS.md §4` + `EXPERIENCE_HOME_DESIGN.md §3` (type scale, 32px rhythm, two-filled-panels rule, borderless surfaces, calm motion, silence-as-calm)
**Scope:** 7 ESS surfaces (EssHome, EssTimeline, MyGrowth, MyAttention, MyTeam, MyCompany, MyAssistant) + 15 experience primitives + 3 mobile files + tokens (`tailwind.config.ts`, `index.css`)
**Method:** read every file; grep-quantified hex + type-scale + rhythm + motion. Read-only — no source changed.

---

## Verdict

The surfaces composed from the shared primitives (Timeline, MyAttention, MyTeam, MyCompany, MyGrowth) are largely faithful to the frozen language. **Two systemic problems gate certification:**

1. **The flagship — EssHome — does not follow its own frozen spec.** It uses bordered cards everywhere (violating borderless + two-filled-panels), a 2-column grid (spec mandates one column), `space-y-6` (24px) instead of 32px, and *inlines* the Reflection gradient instead of using the `ReflectionCard` primitive. Home is supposed to be the reference build; it is currently the least conformant desktop surface.
2. **Pervasive hardcoded hex breaks the token contract and dark mode.** The spec says "No hardcoded hex in components — all tokenised." In reality `#15B8A6` (teal) is hardcoded in 7 primitives, and the entire mobile surface is built on raw hex via `glossy.ts`. The teal token does not even exist (`index.css` declares "no legacy teal"), so teal can *only* be expressed as raw hex — a token-system gap, not just sloppiness. None of this adapts to dark mode.

**Severity counts:** Critical 2 · High 6 · Medium 7 · Low 4 (19 findings).

---

## DIMENSION 1 — Typography (one type scale?)

### 1.1 Focus-header type scale is inconsistent across surfaces — THREE sizes for the same beat
**Severity: High · Effort: S**
The Focus "big sentence" (spec §3.B: "Focus 26 / semibold", i.e. ~1.6rem) is rendered at three different sizes:
- `FocusPanel.tsx:23` → `text-[1.6rem]` (Timeline, MyAssistant — via primitive)
- `MyGrowth.tsx:85` → `text-[1.5rem]` (identity name)
- `MyAttention.tsx:80`, `MyTeam.tsx:72`, `MyCompany.tsx:94`, `MyAttention.tsx:62` (empty state) → `text-[1.4rem]`

**Impact:** the single most important line on each surface is a different size depending on which page you're on — the "type soup" the spec explicitly set out to kill (§3.B "kills the current 6-size soup").
**Recommendation:** the surfaces at `1.4rem`/`1.5rem` re-implement the Focus wash inline instead of using `FocusPanel`. Route them all through `FocusPanel` (or a shared `text-focus` token at one value, 1.6rem). One Focus size everywhere.

### 1.2 Ad-hoc arbitrary font sizes instead of scale steps
**Severity: Medium · Effort: M**
The scale (§3.B) is Display 32 / Focus 26 / Heading 18 / Body 15 / Meta 13 / Eyebrow 11. Code uses arbitrary px/rem (`text-[1.4rem]`, `text-[1.5rem]`, `text-[1.6rem]`, `text-[15px]`, `text-[13px]`, `text-[11px]`, `text-[10px]`, `text-[9px]`) ad hoc rather than named scale utilities. EssHome's greeting is `text-2xl` (24px) — but spec says greeting is Display 32. Mobile (`MobileHome`) introduces `text-[9px]`/`text-[10px]` chip labels below the scale's Eyebrow floor (11px).
**Impact:** no enforced scale; drift is invisible and will keep happening. Greeting under-sized vs. spec.
**Recommendation:** define the six steps as Tailwind utilities/tokens (`text-display/focus/heading/body/meta/eyebrow`) and replace arbitrary values. Bump Home greeting to the Display step.

### 1.3 `font-extrabold` used despite spec "nothing extrabold"
**Severity: Low · Effort: S**
Spec §3.B: "One weight step between levels; nothing extrabold." `MobileEssShell.tsx:86` (`font-extrabold` greeting), `MobileHome.tsx:145,182` and several mobile cards use `font-extrabold`/`font-bold` freely.
**Impact:** mobile reads heavier than the calm desktop language.
**Recommendation:** cap at `font-semibold` on Employee-OS surfaces; reserve bolder weights for genuinely numeric emphasis if at all.

---

## DIMENSION 2 — Spacing (32px rhythm)

### 2.1 Top-level movement rhythm differs on every surface
**Severity: High · Effort: S**
Spec §3.C / Patterns §4: "32px rhythm" between movements → `space-y-8`. Actual top-level container spacing:
- `EssHome.tsx:213` → `space-y-6` (24px) ❌ (the flagship)
- `MyAssistant.tsx:175` → `space-y-6` (24px) ❌
- `MyAttention.tsx:76`, `MyTeam.tsx:68`, `MyCompany.tsx:90` → `space-y-8` (32px) ✅
- `EssTimeline.tsx:50`, `MyGrowth.tsx:80` → `space-y-9` (36px) ⚠ (off-spec, but at least consistent with each other)
- `MobileHome.tsx:120` → `space-y-4`; `MobileTimeline.tsx:56` → `space-y-8`

**Impact:** four different vertical rhythms across one product; the flagship and the assistant are visibly tighter than the rest. Fails the "feels like one product" test.
**Recommendation:** standardise all desktop surfaces to `space-y-8` (32px). If Timeline/Growth want a touch more air, do it via a single shared constant, not per-file `9`. Decide and document one mobile rhythm.

### 2.2 Focus-wash padding inconsistent (p-6 vs p-5)
**Severity: Low · Effort: S**
Spec: Focus padding 32px (generous). `FocusPanel.tsx:21`, MyAttention/MyTeam/MyCompany/MyGrowth Focus → `p-6` (24px); `MyAssistant.tsx:179` ask field → `p-5` (20px); mobile Focus → `p-4`.
**Impact:** the Focus panel breathes differently per surface. (Note: even `p-6`=24px is short of the spec's 32px.)
**Recommendation:** one Focus padding token; align to spec (`p-8`) or at minimum make every Focus identical.

---

## DIMENSION 3 — Cards / elevation / "two filled panels only"

### 3.1 EssHome violates borderless + two-filled-panels + one-column rules
**Severity: Critical · Effort: L**
Spec §3.C: "borderless by default… Only two filled panels: Today's Focus (faint wash) and AI Reflection (gradient)… One column, not three." EssHome instead:
- Wraps nearly every movement in a bordered, shadowed `Card` (`EssHome.tsx:92-94`: `rounded-2xl border border-border/60 bg-card shadow-sm`) — the Focus area, "Here's your day", "From around the company", "Your people", Holidays are ALL filled/bordered cards. That is **5+ filled panels**, not two.
- The Focus movement is a plain bordered `Card` with **no navy→teal wash at all** (`EssHome.tsx:216`) — the hero treatment the spec centres the whole page on is missing.
- Uses a **2-column grid** (`EssHome.tsx:258` `lg:grid-cols-5` → col-span-3 / col-span-2), directly contradicting "One column, not three… the eye travels down a story, never across a grid."
- Reflection is **inlined** (`EssHome.tsx:373`) rather than using `ReflectionCard`.

**Impact:** the flagship reads as "a nice dashboard of cards" — exactly the "widget grid" the design doc forbids ("no widget grid, no KPI tiles"). Every other surface inherited the borderless language; Home, the supposed reference, did not. This is the single biggest conformance gap.
**Recommendation:** rebuild Home to one column of borderless movements; apply the Focus wash via `FocusPanel`; drop the bordered `Card` wrapper from Story/Company/People/Holidays (whitespace-separated, per §3.C); replace the inline Reflection with `<ReflectionCard>`. Treat this as the reference re-build the doc promised.

### 3.2 MyAssistant renders extra filled/bordered panels beyond the two allowed
**Severity: Medium · Effort: M**
On an answered ask, `MyAssistant` shows: Focus wash (`:179`) + a bordered "person" card (`:258` `border bg-card`) + a `SignalCard` (bordered) + a bordered "Conversation" panel (`:311`). With the Focus wash that is several filled surfaces; there is no Reflection here (correctly omitted), so the "two filled panels" budget is spent on chrome.
**Impact:** the answer view feels card-heavy vs. the calm one-wash language.
**Recommendation:** make the person line and the conversation block borderless (whitespace separation); keep SignalCard as the one actionable card.

### 3.3 Mobile surfaces are entirely card-based with custom shadows
**Severity: Medium · Effort: L**
`MobileHome` uses `rounded-2xl bg-white shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]` on the punch card, progress card, every feed card, kudos card, story button — i.e. a filled-card-per-block model, the opposite of borderless. The Focus and Reflection use *different* inline gradients again (`:125` `linear-gradient(120deg,#1A4D8F,#2E6FE6)` for Focus vs the desktop teal wash; `:238` navy→teal for Reflection).
**Impact:** mobile is a separate visual language from desktop, not the same product thumb-first. The mobile Focus gradient is **navy→royal-blue**, not the spec's **navy→teal**.
**Recommendation:** accept that mobile may use soft cards, but unify the shadow into one token, and make the Focus/Reflection gradients identical to desktop's tokenised pair.

### 3.4 Radius is consistent (good)
**Severity: Low (positive note)**
`rounded-2xl` is used consistently for the wash/gradient/cards across primitives and surfaces, matching the "one radius value" rule. No action.

---

## DIMENSION 4 — Motion (motion-safe / prefers-reduced-motion)

### 4.1 Inconsistent reduced-motion convention (motion-safe vs motion-reduce)
**Severity: Medium · Effort: S**
Two opposite idioms coexist: `Chapter.tsx:19`, `JourneyRail.tsx:72`, `ChapterSummary.tsx:29`, `MyAttention.tsx:58` use **`motion-safe:`** (animate only when motion OK) — correct and guarded. `CelebrationCard.tsx:48` uses **`motion-reduce:transition-none`** (the inverse idiom). Both achieve the goal, but mixing them is a maintenance trap and makes "is this guarded?" non-obvious.
**Impact:** low visual impact, real consistency/audit cost.
**Recommendation:** pick one convention (recommend `motion-safe:` for entrances) and apply uniformly.

### 4.2 Mobile spinners and a ping animation have NO reduced-motion guard
**Severity: High · Effort: S**
- `MobileEssShell.tsx:34` and `MobileTimeline.tsx:39`: `animate-spin` loader with no `motion-safe`/`motion-reduce`.
- `MobileHome.tsx:210`: `animate-ping` on the "Happening now" dot — a continuous, attention-grabbing pulse, unguarded.
- `index.css` operational keyframes (`op-sla-pulse`, `op-shimmer-sweep`, `op-escalate-blink`, `op-sla-critical-flash`) animate infinitely with **no `@media (prefers-reduced-motion: reduce)`** block anywhere in `index.css`.

Spec §3.C: "All suppressed under prefers-reduced-motion. Nothing bounces." The continuous ping/pulse loops directly violate this for motion-sensitive users (accessibility/WCAG 2.3.3).
**Impact:** accessibility gate — continuous motion with no escape hatch. The `animate-spin` loaders also diverge from the canonical `LoadingState` skeleton (see 6.1).
**Recommendation:** add a global `@media (prefers-reduced-motion: reduce){ *{animation:none!important} }` safety net in `index.css`, and replace mobile spinners with `LoadingState`. Drop or guard the `animate-ping`.

### 4.3 EssHome has no entrance motion at all
**Severity: Low · Effort: M**
Spec §3.C describes a 400ms staggered fade/rise as each movement enters. `Chapter`/`JourneyRail` implement it; EssHome (and MyAttention/MyTeam/MyCompany/MyGrowth sections) render statically with no entrance animation.
**Impact:** the "calm premium entrance" is only on Timeline/Growth; the flagship is flat.
**Recommendation:** apply the same `motion-safe` fade/rise stagger to movement-level wrappers (a shared `<Movement>` wrapper would fix this everywhere at once).

---

## DIMENSION 5 — Empty states (silence-as-calm)

### 5.1 Empty states are well-designed across most surfaces (positive)
**Severity: Low (positive note)**
MyAttention's all-clear (`:56-68`) is genuinely designed (icon, calm copy, faded-in). MyTeam (`:75`), MyCompany (`:105`), MyGrowth (absent-sections), Timeline (`:57`) all have calm, positive empty copy and honor silence-as-calm. This dimension is largely a pass.

### 5.2 Empty-state typography/treatment not shared — each is hand-rolled
**Severity: Medium · Effort: M**
The spec lists a built `EmptyState` primitive (Patterns §5 "States: LoadingState, ErrorState, EmptyState ✅"). The surfaces do **not** use it — each writes its own `<p className="py-14 text-center text-sm text-muted-foreground">…` (MyTeam:76, MyCompany:106, Timeline:58/63, MyGrowth absent). MyAttention's all-clear is yet another bespoke layout. Padding varies (`py-14`, `py-16`, `py-20`).
**Impact:** inconsistent empty-state rhythm; the shared primitive is bypassed (governance §7.2 "reuse the primitives — no bespoke re-implementation").
**Recommendation:** route calm empties through the `EmptyState` primitive (or extract MyAttention's treatment as the canonical one); one padding value.

### 5.3 EssHome empty sub-states are plain muted text, not designed
**Severity: Low · Effort: S**
`EssHome.tsx:268` ("Nothing yet — your check-ins…") and `:276` ("It's quiet — be the first to share something.") are bare `<p>`s inside cards. The community one ("be the first to share") is arguably a soft nag, which the broader design philosophy discourages.
**Recommendation:** align with the calmer empty copy used elsewhere; avoid "be first to post" framing.

---

## DIMENSION 6 — Loading states (consistent LoadingState?)

### 6.1 Two parallel loading systems — skeleton vs raw spinner
**Severity: High · Effort: M**
Spec mandates a single state system; `LoadingState` is the canonical skeleton (no spinner-text, no layout jump). Desktop surfaces use it correctly (EssHome:209, MyAttention:45, MyTeam:60, MyCompany:71, MyGrowth:71, Timeline:43, MyAssistant:231). **But the mobile shell and mobile timeline use a raw `animate-spin` ring** (`MobileEssShell.tsx:32-37` `Loader`, `MobileTimeline.tsx:36-41`) — exactly the spinner the spec replaced. MyAssistant correctly uses `LoadingState` even on mobile, so the inconsistency is purely the two hand-rolled mobile spinners.
**Impact:** loading feels different (and jumps) on mobile Home/Timeline vs everywhere else; two competing state systems.
**Recommendation:** replace the mobile `Loader`/spinner with `LoadingState` so all surfaces load identically.

### 6.2 MobileTimeline error state is a one-off, not ErrorState
**Severity: Low · Effort: S**
`MobileTimeline.tsx:43-50` hand-rolls an error `<p>` + retry link instead of using `ErrorState` (which desktop Timeline uses at `EssTimeline.tsx:45`).
**Recommendation:** use `ErrorState` for parity.

---

## DIMENSION 7 — Avatars (PersonAvatar everywhere a human appears?)

### 7.1 Mobile renders raw initials/glyphs where a face belongs — bypasses PersonAvatar
**Severity: High · Effort: M**
Spec / Manifesto: "People are faces. PersonAvatar everywhere a human is named." Mobile **does not use PersonAvatar at all**; instead it draws its own initial bubbles with `glossy()` gradients and a local `initials()`:
- `MobileHome.tsx:181-183` leaderboard faces → `initials(l.name)` in a glossy navy bubble (not PersonAvatar).
- `MobileHome.tsx:301` post author → `initials(post.author_name)` in a glossy bubble.
- `KudosCard` (`:335-355`) shows from/to **names only, no face**.
- Celebration posts (`:298`) show an emoji, not the celebrant's face.

**Impact:** the mobile "people" surfaces — the emotional core per the spec ("Faces are bigger on mobile") — show colored initials and emojis, not the shared face component. The deterministic per-name tint (a key PersonAvatar feature) is lost; a person gets different colors on desktop vs mobile.
**Recommendation:** use `PersonAvatar` (or a `size="xl"` variant for the 56–64px mobile faces the spec wants) across mobile. Add real faces to KudosCard.

### 7.2 PersonAvatar `aria-hidden` removes the name from the a11y tree
**Severity: Medium · Effort: S**
`PersonAvatar.tsx:47` sets `aria-hidden` with only a `title`. Where the avatar appears *next to* a visible name (PeopleRail, ActivityItem, MyTeam) this is fine. But in `EssHome` recognition rows and anywhere the avatar is the sole identity carrier, the person's name is invisible to screen readers.
**Impact:** minor a11y gap for people-centric content.
**Recommendation:** keep `aria-hidden` only when an adjacent text label repeats the name; otherwise expose it.

---

## DIMENSION 8 — Color consistency (hardcoded hex vs tokens; brand navy/teal)

### 8.1 Teal `#15B8A6` is hardcoded in 7 primitives — there is no teal token
**Severity: Critical · Effort: L**
Spec §3.C: "No hardcoded hex in components — all tokenised." `SignalCard` even documents this ("Token-based accents — no hardcoded hex"). Yet teal is hardcoded everywhere it appears:
- `FocusPanel.tsx:21` `to-[#15B8A6]/[0.06]`
- `ReflectionCard.tsx:25` `from-[#1A4D8F] to-[#15B8A6]`
- `AmbientLine.tsx:23` `text-[#15B8A6]` (the ✨ on every ambient line, every surface)
- `PersonAvatar.tsx:20` `bg-[#15B8A6]/15 text-[#15B8A6]`
- `ActivityItem.tsx:50,81` lifecycle tint + milestone ring
- `CelebrationCard.tsx:46,54,56,64` (border, sheen, icon chip, button — 4×)
- `JourneyRail.tsx:55,57,76,85` (4×), plus `MyGrowth.tsx:54`, `MyTeam.tsx:91-92`

**Root cause (token-system gap, not just sloppiness):** `index.css:12` declares the palette is **"navy primary… no legacy teal"**, and `--accent-teal` is *remapped to navy* (`index.css:165` `--accent-teal: #1A4D8F`). So there is **no usable teal token** — teal can only be expressed as raw `#15B8A6`. The brand spec (CLAUDE.md, EXPERIENCE docs) treats teal as a core brand accent; the token layer dropped it.
**Impact:** (a) brand teal cannot be themed, dark-mode-adapted, or globally changed; (b) the petrol/bordeaux themes had to add a CSS remap of `#1A4D8F`/`#2E6FE6` arbitrary classes (`index.css:897-951`) but teal `#15B8A6` is **not remapped** there — so under petrol/bordeaux, every ✨, Focus wash, celebration and Reflection stays the original teal, off-theme. (c) Dark mode: `#15B8A6` is a fixed light-mode value with no `.dark` override.
**Recommendation:** introduce real `--accent-teal: #15B8A6` (light) / `#2DD4BF` (dark) tokens + a `teal` Tailwind color, replace all `#15B8A6` literals, and add teal to the theme remap blocks. This is the keystone fix for color consistency.

### 8.2 Royal-blue `#2E6FE6` used as a brand color but it's not the primary
**Severity: High · Effort: M**
The token primary is navy `#1A4D8F`. But `#2E6FE6` (royal blue) is hardcoded as a brand fill throughout mobile (`glossy.ts:10 BRAND.blue`, used in `MobileHome` punch/chips/spotlight/reactions, `MobileEssShell` loader border `:34`) and in the mobile Focus gradient (`MobileHome.tsx:125` `linear-gradient(120deg,#1A4D8F,#2E6FE6)`). `index.css:903` explicitly notes many components "hardcode the brand blue (#2E6FE6)… rather than using var(--primary)" and the theme system must remap them one-by-one.
**Impact:** two competing "brand blue" values (`#1A4D8F` token vs `#2E6FE6` literal). Mobile reads as a brighter, different brand than desktop. The `glossy.ts` doc comment claims royal-blue "is no longer the header colour," yet `BRAND.blue = #2E6FE6` is still the workhorse fill across the mobile home.
**Recommendation:** decide one brand blue. If `#2E6FE6` is intentional as a "bright accent," tokenise it (`--brand-blue`) and reference the token; don't scatter the literal. Prefer `var(--primary)` for primary fills.

### 8.3 Off-palette colors on mobile (violet, amber, custom greens)
**Severity: Medium · Effort: M**
`MobileHome` introduces colors absent from the navy/teal brand: violet `#7C3AED`/`#A78BFA` (Payslip chip, Spotlight "Give", KudosCard, "Give kudos" button, +pts pills), amber `#B07B18`/`#D9A441`, greens `#1A8050`/`#34B27B`/`#5C9AFF`. These are inline literals via `glossy()`, not tokens.
**Impact:** the calm two-color (navy/teal) language the desktop holds to is replaced on mobile by a 6-color candy palette. Off-brand and untokenised.
**Recommendation:** reduce mobile fills to the brand pair (+ semantic success/warning tokens) or formally extend the palette as tokens; either way, stop using raw hex.

### 8.4 `#0F172A` (slate) used as a text color on mobile instead of `foreground`
**Severity: Low · Effort: S**
`MobileHome.tsx:145,167,182,209,…` use `text-[#0F172A]` for headings instead of `text-foreground`. This is a fixed near-black that won't invert in dark mode.
**Recommendation:** `text-foreground`.

### 8.5 `#F5A623` badge dot off-palette and not a token
**Severity: Low · Effort: S**
`MobileEssShell.tsx:92` notification badge uses `bg-[#F5A623]` (amber-orange) ringed by `#1A4D8F`. Not in the token set; `--warning` exists (`#B07B18`) and should be used.
**Recommendation:** use `bg-warning` or a tokenised attention color.

---

## DIMENSION 9 — Dark mode + responsive

### 9.1 The entire teal/blue brand layer is light-mode-only and breaks in dark mode
**Severity: Critical (rolled into 8.1/8.2) · Effort: L**
Every hardcoded `#15B8A6`, `#1A4D8F`, `#2E6FE6`, `#0F172A`, `bg-white` (mobile cards), and the `glossy()` gradients are fixed light values. The app **supports dark mode** (`tailwind.config.ts:4` `darkMode: ['class']`; `index.css:205` `.dark` overrides tokens; primary becomes `#5B8FD6` in dark). Because the Employee-OS surfaces bypass tokens for brand color:
- **Reflection gradient** (`from-[#1A4D8F] to-[#15B8A6]`) stays the same dark-navy→teal in dark mode — text is white-on-gradient so it survives, but it ignores the lifted dark primary.
- **Focus wash** `from-primary/[0.06]` adapts (token) but `to-[#15B8A6]/[0.06]` does not — the wash is half-tokenised, half-fixed.
- **Mobile cards** `bg-white` and `text-[#0F172A]` would render white cards with near-black text on a dark page → broken in dark mode.

**Impact:** Employee OS is not dark-mode-safe despite the app shipping dark mode. White mobile cards on a dark canvas are a visible defect.
**Recommendation:** the 8.1/8.2/8.4 tokenisation fixes resolve this. Specifically replace `bg-white`→`bg-card`, `text-[#0F172A]`→`text-foreground`, and the teal/blue literals with dark-adaptive tokens. Then spot-check each surface in `.dark`.

### 9.2 Responsive: desktop Home grid vs mobile is a hard fork, not a continuum
**Severity: Medium · Effort: L**
EssHome uses `lg:grid-cols-5`; below `lg`, `MobileEssShell` swaps to entirely separate `MobileHome`/`MobileTimeline` components with different layout, palette, type weights, and state primitives. The shared ESS pages (MyGrowth/MyAttention/MyTeam/MyCompany/MyAssistant) are reused as-is on mobile (good — one component), but Home and Timeline maintain two divergent implementations.
**Impact:** Home/Timeline must be kept in sync by hand; they have already drifted (rhythm, palette, faces, gradients, loaders — see findings above). Maintenance + consistency risk.
**Recommendation:** longer-term, converge Home/Timeline on the shared primitives (as MyTeam etc. already do) so one responsive component serves both, eliminating the drift class entirely.

---

## Quick-reference: findings by severity

**Critical (2)**
- 3.1 EssHome violates borderless + two-filled-panels + one-column (flagship non-conformant)
- 8.1 Teal `#15B8A6` hardcoded in 7 primitives; no teal token exists (also drives 9.1 dark-mode break)

**High (6)**
- 1.1 Focus header three sizes (1.4/1.5/1.6rem)
- 2.1 Top-level rhythm differs per surface (space-y-6/8/9/4)
- 4.2 Mobile ping/spin + op-* keyframes unguarded for reduced-motion
- 6.1 Two loading systems (skeleton vs raw spinner on mobile)
- 7.1 Mobile bypasses PersonAvatar (raw initials/emoji)
- 8.2 `#2E6FE6` second "brand blue" hardcoded across mobile

**Medium (7)**
- 1.2 Ad-hoc font sizes vs scale; greeting under-sized
- 3.2 MyAssistant extra filled panels
- 3.3 Mobile fully card-based, divergent gradients
- 4.1 motion-safe vs motion-reduce mixed
- 5.2 Empty states hand-rolled, EmptyState primitive bypassed
- 7.2 PersonAvatar aria-hidden hides name when sole identity
- 8.3 Off-palette mobile colors (violet/amber/green)
- 9.2 Home/Timeline desktop-vs-mobile hard fork (drift risk)

(8 medium incl. 9.2 — counted as 7 distinct + 9.2; treat 9.2 as Medium.)

**Low (4)**
- 1.3 font-extrabold on mobile
- 2.2 Focus padding p-6 vs p-5 vs p-4
- 4.3 EssHome no entrance motion
- 5.3 EssHome bare empty sub-states / soft nag
- 6.2 MobileTimeline one-off error state
- 8.4 `#0F172A` text instead of foreground
- 8.5 `#F5A623` badge off-palette
- 7.* PersonAvatar a11y (also listed Medium)

(Low cluster larger; the gating items are the 2 Critical + 6 High.)

---

## Recommended certification gate

**Block v1 cert on:** 3.1 (rebuild Home to the frozen language) and 8.1+9.1 (introduce teal token + tokenise brand hex so dark mode works). These two are the difference between "one product that knows me" and "a nice set of cards." The High items (Focus size, rhythm, motion guards, mobile avatars/loaders, second brand blue) are fast follows — mostly S/M — and should land before GA.
