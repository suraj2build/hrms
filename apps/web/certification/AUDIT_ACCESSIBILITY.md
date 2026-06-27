# Accessibility Audit — Employee Operating System v1 (WCAG 2.1 AA)

**Scope:** 7 ESS surfaces (EssHome, EssTimeline, MyGrowth, MyAttention, MyTeam, MyCompany, MyAssistant), shared experience primitives, and the mobile shell + MobileHome/MobileTimeline.
**Method:** read-only review of shipped code, grounded in file:line. Contrast figures computed against the resolved light-theme tokens (`--card #FFFFFF`, `--background #F3F5F8`, `--foreground #17202B`, `--muted-foreground #637080`, brand teal `#15B8A6`).

**Key token math used throughout:**
- `text-muted-foreground` (#637080) on white card = **4.78:1** → passes normal text (barely).
- `text-muted-foreground/80` ≈ 3.9:1, `/70` ≈ 3.3:1, `/60` ≈ 2.8:1 → **all fail** 4.5:1 for normal-size text.
- Teal `#15B8A6` on white = **~2.4:1** → fails 4.5:1 (normal) and 3:1 (large/icon non-text).
- `text-white/80` on the `#15B8A6` end of the navy→teal gradient ≈ **2.9:1** → fails 4.5:1.

---

## CRITICAL

### C1 — PersonAvatar announces no name to screen readers (identity is lost)
**File:** `apps/web/src/components/experience/PersonAvatar.tsx:44-53`
The avatar is `aria-hidden` with the name carried only in a `title` attribute (not reliably announced by SR; never announced when `aria-hidden`). In several places the avatar is the **sole** carrier of a person's identity with no adjacent text:
- `JourneyRail` person steps render only the avatar + a milestone label, no name text (`JourneyRail.tsx:82-90`).
- `MyGrowth` Strengths "faces" row — avatars only, no names (`MyGrowth.tsx:34-38`).
- `SignalCard` when `signal.person` is set the avatar replaces the type icon; the name may or may not be in the title text (`SignalCard.tsx:66-67`).
- Home recognition / community / celebration rows pair the avatar with a visible name, so those are OK — but the primitive itself is the systemic defect.
**Impact:** Screen-reader and voice-control users get "?" / nothing for the person — recognition, celebrations, growth milestones and people rails become anonymous. Voice-control users cannot target the face.
**Recommendation:** Replace `aria-hidden`+`title` with `role="img"` and `aria-label={name}` (decorative-only when an adjacent visible name exists — then keep `aria-hidden` deliberately). Add an `decorative?: boolean` prop so callers that already print the name can suppress the double-announce, and callers that don't (JourneyRail, Strengths) get the label.
**Effort:** M

### C2 — Mobile loading spinners animate under prefers-reduced-motion
**Files:** `apps/web/src/components/mobile/MobileEssShell.tsx:34` (`Loader`), `apps/web/src/components/mobile/screens/MobileTimeline.tsx:39`
Both use a bare `animate-spin` ring with no `motion-safe:` / `motion-reduce:` guard, so they keep spinning even when the user has requested reduced motion (WCAG 2.3.3 / vestibular-trigger risk).
**Impact:** Users with vestibular disorders / motion sensitivity get a continuously rotating element they cannot suppress; can induce nausea/dizziness.
**Recommendation:** Gate with `motion-safe:animate-spin` and provide a static fallback (e.g. a dimmed ring or a text "Loading…"), or swap to the shared `LoadingState` skeleton used everywhere else (which is static).
**Effort:** S

---

## HIGH

### H1 — "Happening now" live dot uses unguarded `animate-ping`
**File:** `apps/web/src/components/mobile/screens/MobileHome.tsx:210`
`<span className="h-1.5 w-1.5 animate-ping ...">` pulses continuously with no motion guard.
**Impact:** Same vestibular concern as C2 — a perpetually animating element under reduced-motion.
**Recommendation:** `motion-safe:animate-ping`. (Decorative, so no static fallback needed; it just stops.)
**Effort:** S

### H2 — Heading hierarchy is broken / skipped across surfaces
**Files:**
- `EssHome.tsx` — page has an `<h1>` (219) then section `<h2>` via `Heading` (100), but the "What needs you" group titles, the AI Reflection panel, and several blocks use styled `<p>` not headings; the Reflection "Cognix Insight" eyebrow (374) and the closing tenure CTA are non-heading. Reasonable but the **Reflection** and **Movement 7 Progress** blocks (357) reuse `<h2>` out of document order relative to the grid cards' `<h2>`s — multiple sibling h2s without an enclosing structure.
- `MyAttention.tsx` — **no `<h1>`/`<h2>` at all.** The page title ("What needs you") is a `<p>` (79); group labels are `<h3>` (28) with no parent h1/h2. Heading levels start at h3.
- `MyTeam.tsx` — page title is `<p>` (71); sections jump straight to `<h3>` (84,112,120) with no h1/h2.
- `MyCompany.tsx` — page title `<p>` (94); sections `<h3>` (114,135,152) with no h1/h2.
- `MyGrowth.tsx` — person name is a `<p>` (85), not the page heading; first real heading is `<h3>` (28,50). No h1/h2.
- `EssTimeline.tsx` — no page `<h1>`; first heading is `Chapter`'s `<h3>` (Chapter.tsx:23). FocusPanel sentence is a `<p>`.
- `FocusPanel.tsx:22-23` — eyebrow + big sentence are both `<p>`; the surface's main title is never a heading.
**Impact:** Screen-reader users navigating by heading (a primary navigation mode) get either nothing (MyAttention/MyTeam/MyCompany have no top-level heading) or a hierarchy that starts at h3 and skips h1/h2 (2.4.6 / 1.3.1). The page's main purpose is not exposed as a heading.
**Recommendation:** Give every surface one `<h1>` (the Focus sentence or page name). Make `FocusPanel` render its sentence as the surface `<h1>` (or accept an `as` prop). Demote in-page section labels to `<h2>` so levels don't skip. The desktop `EssHome` `<h1>` is the correct model.
**Effort:** M

### H3 — Custom card/button affordances have no visible focus ring
Many interactive elements are bare `<button>`/clickable `<div>` with only `hover:` styling and **no `focus-visible:` ring**, so keyboard users cannot see focus (2.4.7):
- `EssHome.tsx` — `Heading` action button (102), Punch-in (230), Reflection action (379), QuickActions, the tenure CTA (411), "Recognize a teammate" (311). None declare focus styles.
- `MyAssistant.tsx` — `Chip` buttons (360-368), "Open conversation"/"New ask"/"Hide conversation" (291-302), the send buttons rely on `disabled:opacity` only — no focus ring (195,342).
- `FocusPanel.tsx:25`, `ReflectionCard.tsx:31`, `JourneyEcho` (`JourneyRail.tsx:53`), `ChapterSummary` toggle (`ChapterSummary.tsx:18`), `EssTimeline` pagination button (71), `MobileTimeline` "Try again" (47) and pagination (74).
- `MobileEssShell.tsx` — bell (90), persona tabs (103). `MobileBottomNav.tsx` — nav buttons (61) and FAB (45).
- `MobileHome.tsx` — virtually every card is a `<button>` with `active:scale` but no `focus-visible:` (123,138,156,172,179,213,222,255, etc.).
Note: the shared shadcn `Button` (button.tsx:10) **does** ship a `focus-visible:ring-2` — so `SignalCard`'s action button and `CelebrationCard`'s Wish button are fine. The defect is the hand-rolled `<button>`/`<div>` elements that bypass it.
**Impact:** Keyboard-only and low-vision keyboard users cannot tell which control is focused across most of the Employee OS.
**Recommendation:** Add a shared `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2` utility (or a `.focus-ring` class) and apply to every hand-rolled interactive element. Prefer routing through the shared `Button` where practical.
**Effort:** M

### H4 — Teal `#15B8A6` used for small text fails contrast
**Files:** `MyGrowth.tsx:54` (teal icon glyph + text uses `text-[#15B8A6]`), `JourneyRail.tsx` step icons + the `JourneyEcho` is fine (icon only), `MyAssistant.tsx:182` eyebrow icon, `AmbientLine.tsx:23` spark, `ChapterSummary`/`ActivityItem` lifecycle tint (`ActivityItem.tsx:50` `text-[#15B8A6]`), `MyTeam.tsx:91-92` Cake/PartyPopper glyphs. Where `#15B8A6` is used as **text** (e.g. brand "HR", any teal label) on white it is ~2.4:1.
The most load-bearing case: brand convention renders small teal text/labels and the `text-[#15B8A6]` strength/anniversary chrome.
**Impact:** Low-vision users cannot read teal-on-white small text/meaningful glyphs (1.4.3 for text, 1.4.11 for meaningful icons needing 3:1).
**Recommendation:** Use the darker teal token for text on light surfaces (the brand already defines `#15B8A6` only as a fill; introduce e.g. `#0E8576` for text/iconography on white to clear 4.5:1 / 3:1). Keep `#15B8A6` for large fills and the dark-bg `#2DD4BF` variant.
**Effort:** M

---

## MEDIUM

### M1 — Low-contrast meta/secondary text (the `/70 /80 /60` and `text-[10px]/[11px]` pattern)
Pervasive use of muted-foreground opacity variants and 10–11px text that fall below 4.5:1:
- `ActivityItem.tsx:89` — `text-[10px] text-muted-foreground/70` timestamp (~2.5:1, 10px). The body text is also `text-xs` (11px) muted.
- `EssHome.tsx:240` `text-muted-foreground/80`, `:286` `text-[11px] text-muted-foreground/60`, `:327` `text-foreground/70 italic`.
- `MyTeam.tsx:43` `text-[10px] text-muted-foreground` subtitle.
- `JourneyRail.tsx:90` `text-[10px] text-muted-foreground`, `:62` `text-[11px]`.
- Multiple `text-[11px]` eyebrows (`FocusPanel`, `MyAttention:79`, `MyTeam:71`, `MyCompany:93`, `ReflectionCard:26`) — at uppercase 11px these are below the 4.5:1 small-text bar where muted.
- `MobileBottomNav.tsx:63` `text-[9px]`, `MobileHome.tsx` many `text-[9px]/[10px]` labels.
**Impact:** Low-vision users lose timestamps, subtitles, eyebrows, and nav labels — much of the ambient/secondary information layer.
**Recommendation:** Drop the opacity suffixes on text (use solid `text-muted-foreground` which is ~4.78:1), and raise the smallest meta text to ≥12px or darken the token for ≤11px. Audit `/60` and `/70` text specifically — they cannot pass at any size as normal text.
**Effort:** M

### M2 — `text-white/80` on navy→teal gradient fails at the teal end
**Files:** `ReflectionCard.tsx:26` (`text-white/80` eyebrow), `EssHome.tsx:374` (same), `MyTeam.tsx:135` ("A quiet nudge" `text-white/80`), `MobileHome.tsx:239` (`text-white/80`), `MyAssistant`/`MobileHome` insight eyebrows.
The gradient runs `#1A4D8F → #15B8A6`; `white/80` (#fff @ 80% over teal) ≈ 2.9:1 — fails for the 11px uppercase eyebrow.
**Impact:** The "Cognix Insight" / "A quiet nudge" eyebrow labels are hard to read against the lighter teal portion of the gradient.
**Recommendation:** Use full `text-white` (and optionally a subtle text-shadow) for the eyebrow, or darken the teal stop. Full white on `#15B8A6` is ~2.9:1 too for small text — consider darkening the gradient's light stop to ~`#0E8576` so white clears 4.5:1.
**Effort:** S

### M3 — Persona toggle is a tablist with no tabpanel association / roving focus
**File:** `MobileEssShell.tsx:97-111`
`role="tablist"` with `role="tab"` + `aria-selected` is set, but there is no `role="tabpanel"`, no `aria-controls`, and no roving `tabIndex` / arrow-key handling between tabs (ARIA tab pattern expects arrow-key navigation and a linked panel).
**Impact:** Screen-reader users hear "tab" but there is no panel relationship; keyboard users can't use the expected arrow-key tab semantics (they Tab through each, which is acceptable but inconsistent with the announced role).
**Recommendation:** Either add `aria-controls`/`role="tabpanel"` + arrow-key roving focus, or simplify to two plain toggle buttons with `aria-pressed`.
**Effort:** M

### M4 — Assistant conversation overlay: no focus management / return
**File:** `MyAssistant.tsx:310-352`
When "Open conversation" toggles the thread open, focus is not moved into the new region and there is no `aria-live` on the streaming answer; on "Hide conversation"/"New ask" focus is not returned to a predictable control. The answer `FocusPanel` (254) and loading states are not announced.
**Impact:** Screen-reader users get no notification that an answer arrived or that the conversation opened; keyboard focus stays on the toggle while new content appears below.
**Recommendation:** Add `aria-live="polite"` to the answer container and the thread; on open, move focus to the continue-conversation input (`MyAssistant.tsx:334`); on close/new-ask, return focus to the ask field. (This is not a modal, so a full focus-trap isn't required — but live-region + focus move is.)
**Effort:** M

### M5 — Mobile sheets / shell content not a focus-trapped/announced region
**File:** `MobileEssShell.tsx` content area + `MobileWishButton` flows (referenced from MobileHome:309). Persona switch swaps the entire `<main>` content (116-123) with no `aria-live`/focus move, and the bell badge dot (92) conveys state by color/shape only.
**Impact:** State changes (new content after persona switch, "needs you" badge appearing) are silent to SR users; the badge has no text alternative.
**Recommendation:** Add a visually-hidden text label to the bell when `needsYou` is true (e.g. "1 thing needs you"), and announce content swaps. The bell already has `aria-label="What needs you"` (good) but the badge state isn't in it.
**Effort:** S

---

## LOW

### L1 — Icon-only controls mostly labelled, a few gaps
**Good:** mobile bell (`MobileEssShell.tsx:90` `aria-label`), assistant send buttons (`MyAssistant.tsx:198,345` `aria-label`), FAB (`MobileBottomNav.tsx:46` `aria-label`).
**Gaps:** The Home Punch-in button (`EssHome.tsx:230`) has visible text "Punch in" (OK). The `ChapterSummary` chevron toggle (`ChapterSummary.tsx:18`) has a visible label but no `aria-expanded` to convey open/closed state to SR users.
**Impact:** SR users don't hear the expanded/collapsed state of the Chapter summary disclosure.
**Recommendation:** Add `aria-expanded={open}` to the `ChapterSummary` toggle button (and the assistant "Open conversation" toggle).
**Effort:** S

### L2 — Decorative spark/sheen correctly hidden, but emoji conveys meaning unlabelled
**Files:** `MobileHome.tsx:298` celebration emoji (🎂/🎉) is the only indicator of post type in some branches; `CelebrationCard.tsx:54` sheen is correctly `aria-hidden` (good).
**Impact:** Emoji-as-meaning can be read inconsistently by SR; minor since adjacent label text usually exists.
**Recommendation:** Ensure each celebration row has a text label of the kind (it largely does via `celebration.label`); wrap standalone meaningful emoji in `role="img" aria-label`.
**Effort:** S

### L3 — `ActivityItem` clickable variant is correctly keyboard-enabled (PASS, noted)
**File:** `ActivityItem.tsx:63-74`
The clickable variant DOES add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handling Enter/Space with `preventDefault`. This is **correct**. The only gap: no `focus-visible:` ring on the clickable row (covered by H3), and it has no `aria-label` so SR users hear only the title text (acceptable). No fix needed beyond H3.
**Effort:** —

### L4 — JourneyRail horizontal scroll region not keyboard-reachable / labelled
**File:** `JourneyRail.tsx:74-95`
The `overflow-x-auto` rail has no `tabIndex={0}` or `role="group"`/`aria-label`, so keyboard users can't scroll it and SR users get no region name. Same for the mobile chip/spotlight horizontal scrollers (`MobileHome.tsx:154,170`).
**Impact:** Keyboard users can't reach content scrolled off-screen in the rails; minor since items are non-interactive (JourneyRail) but the mobile scrollers contain buttons reachable via Tab anyway.
**Recommendation:** Add `tabIndex={0}` + `role="group"` + `aria-label` to scrollable non-interactive rails (JourneyRail) so the overflow is keyboard-scrollable.
**Effort:** S

---

## Severity counts
- **Critical: 2** (C1 avatar identity, C2 mobile spinner under reduced-motion)
- **High: 4** (H1 animate-ping, H2 heading hierarchy, H3 focus rings, H4 teal small-text contrast)
- **Medium: 5** (M1 muted/tiny text contrast, M2 white/80-on-gradient, M3 tablist semantics, M4 assistant focus/live-region, M5 mobile content/badge announcement)
- **Low: 4** (L1 aria-expanded gaps, L2 emoji labels, L3 ActivityItem PASS-noted, L4 scroll-region keyboard/labels)

**Total findings: 15** (1 of which, L3, is a documented PASS).

## Things verified as CORRECT (no action)
- `ActivityItem` clickable variant: full keyboard support (role+tabIndex+Enter/Space). (`ActivityItem.tsx:70-73`)
- `Chapter`, `JourneyRail`, `ChapterSummary`, `CelebrationCard`, `MyAttention` all-clear hero: all animations correctly gated behind `motion-safe:` / `motion-reduce:`. (`Chapter.tsx:19`, `JourneyRail.tsx:72`, `ChapterSummary.tsx:29`, `CelebrationCard.tsx:48`, `MyAttention.tsx:58`) — the ONLY unguarded animations are the bare `animate-spin`/`animate-ping` loaders (C2, H1).
- shadcn `Button` ships a proper `focus-visible:ring-2` (`button.tsx:10`); SignalCard & CelebrationCard actions inherit it.
- Assistant ask inputs have `aria-label` (`MyAssistant.tsx:192,339`) and send buttons have `aria-label` (198,345).
- Mobile bell has `aria-label`; FAB has `aria-label`.
