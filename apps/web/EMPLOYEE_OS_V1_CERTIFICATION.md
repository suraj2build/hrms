# Employee Operating System v1 — Certification Audit

> **Scope:** the seven shipped Employee OS lenses (My Day · My Story · My Growth ·
> My Attention · My Team · My Company · My Assistant) across Experience, Design
> System, Engineering, Accessibility, Product (7 personas), and Commercial.
> **Method:** four parallel specialist audits grounded in the real code, synthesised
> by the Chief Architect. **No code changed in this audit.** Quality, not scope.
> Full per-finding detail (Severity · Impact · Recommendation · Effort) lives in the
> four appendices under `apps/web/certification/`.

---

## 0. Verdict — **CONDITIONAL · not yet certified for production**

Employee OS v1 is **feature-complete and architecturally sound** — the seven-lens
experience model, the Event Model / Moments contract, and the zero-overlap discipline
all hold up under audit. The *product thinking* is release-grade.

But **six Critical findings gate production**, and they cluster into three honest
truths:

1. **The platform is not dark-mode-safe** despite shipping dark mode (untokenised
   brand color).
2. **The flagship surface never actually conformed to its own frozen design language**
   (EssHome is a bordered card-grid, not the borderless one-column spec).
3. **There is a performance defect on the most-loaded screen** (a write + multiple
   full-roster scans on a GET).

None require redesign or new scope — every blocker is a **conformance, performance, or
accessibility quality fix** against the already-frozen design and architecture. This is
exactly the "improve quality, not scope" work the certification is meant to drive.

**Consolidated findings:** **Critical 6 · High ~15 · Medium ~22 · Low ~15** (≈58 total).

| Dimension | Result | Headline |
|-----------|--------|----------|
| Experience | 🟡 Conditional | One product in concept; type-scale/rhythm/mobile-parity drift in execution |
| Design System | 🔴 Blocked | Flagship non-conformant; teal untokenised → dark mode breaks |
| Engineering | 🔴 Blocked | Write-on-GET + 4 roster scans per Home paint; ESS pages not lazy-loaded |
| Accessibility | 🔴 Blocked | Screen-reader identity gap; unguarded continuous motion; contrast |
| Product (personas) | 🟡 Conditional | All 7 journeys work; frontline/manager hit the mobile-parity gap hardest |
| Commercial | 🟢 Strong | Five clear, defensible reasons to choose CognixHR (below) |

---

## 1. The certification gate — the 6 Criticals (must fix before GA)

| # | Finding | Dimension | Impact | Recommendation | Effort |
|---|---------|-----------|--------|----------------|--------|
| **C1** | `/ess/home` (a GET) `await`s `ensureTodaysCelebrations` — a 2000-row scan + N sequential `feed_posts` INSERTs — on the response critical path; Home also fans out 500+500-row roster scans, and `company.ts` adds a 4th 2000-row scan. (Eng C1/C2/H4) | Engineering | Slow, write-heavy first paint on every employee's most-opened screen; a read endpoint mutating data is a correctness/scaling hazard. | Move celebration generation off the GET (cron/scheduled or lazy/once-a-day guard); index/aggregate the birthday lookups; share one roster read. | **M–L** |
| **C2** | Brand **teal `#15B8A6` is hardcoded in 7 primitives** and **no teal token exists** (`index.css` remaps `--accent-teal`→navy); mobile cards use `bg-white`/`text-[#0F172A]`. (DS 8.1 / 9.1) | Design System | Employee OS **breaks in dark mode** (white cards on dark canvas; half-tokenised washes) though the app ships dark mode; teal can't be themed. | Introduce real `--accent-teal` (light `#15B8A6` / dark `#2DD4BF`) + a `teal` Tailwind color; replace literals; `bg-white`→`bg-card`, `text-[#0F172A]`→`text-foreground`. | **L** |
| **C3** | **EssHome violates its own frozen design language** — bordered/shadowed `Card`s on every movement (5+ filled panels vs the mandated 2), a `lg:grid-cols-5` two-column grid (spec: one column), no navy→teal Focus wash, inlined Reflection. (DS 3.1) | Design System | The *reference* surface reads as the "widget grid of cards" the design doc forbids; the other six inherited the borderless language, Home did not. | Rebuild Home to one borderless column via `FocusPanel` + `ReflectionCard` (conformance to the frozen doc — **not** a redesign). | **L** |
| **C4** | **`PersonAvatar` is `aria-hidden`** with the name only in `title` — so in JourneyRail, MyGrowth strengths, and SignalCard person-mode the person's **identity is never announced**. Four surfaces also start headings at `<h3>` with no `<h1>/<h2>`. (A11y) | Accessibility | Screen-reader users get no person identity on people-centric content and no page anchor — a WCAG blocker on the "people-first" promise. | Expose the name (visually-hidden text or `aria-label`) when the avatar is the sole identity carrier; add one `<h1>`/`<h2>` per surface. | **S–M** |
| **C5** | **Unguarded continuous motion** — `animate-spin` loaders (`MobileEssShell`, `MobileTimeline`), `animate-ping` live-dot (`MobileHome`), and the `op-*` infinite keyframes in `index.css` have **no `prefers-reduced-motion` guard**. (A11y / DS 4.2) | Accessibility | Motion-sensitive users get continuous animation with no escape — WCAG 2.3.3 failure. | Add a global `@media (prefers-reduced-motion: reduce){*{animation:none!important}}` safety net; replace mobile spinners with `LoadingState`. | **S** |
| **C6** | **Systemic contrast failures** — teal `#15B8A6` on white ≈2.4:1; `text-white/80` on the teal gradient end ≈2.9:1; `text-muted-foreground/60–70` + `text-[10px]/[11px]` meta below 4.5:1. (A11y) | Accessibility | Small text, glyphs, and the ✨ ambient mark are unreadable for low-vision users across every surface. | Darken teal for text/glyph use (or pair with a darker token); raise muted meta to ≥4.5:1; lift gradient eyebrow opacity. | **M** |

> **Note on C3:** the design *document* is frozen and correct; the *flagship code* simply
> never met it. Fixing Home to match its own spec is conformance work explicitly permitted
> by "improve quality, not scope" — and it resolves the longstanding irony that the
> "reference implementation" was the least conformant surface.

---

## 2. High-priority fast-follows (before GA, mostly S/M)

- **Bundle (Eng H1):** the 7 ESS pages are **static imports** in `App.tsx` while 224 other
  routes use `lazy()` — they sit in the eager **1.15 MB / 299 KB-gzip** index chunk loaded
  for everyone (even admins who never open `/ess`). Convert to `lazy()`. **Biggest cheap win. (S)**
- **Type scale (DS 1.1) & rhythm (DS 2.1):** the Focus "big sentence" renders at **three
  sizes** (1.4/1.5/1.6rem) and top-level spacing is **four rhythms** (space-y-4/6/8/9).
  Route every surface through one `FocusPanel` + one `space-y-8`. **(S–M)**
- **Mobile parity (Exp E4 / DS 7.1, 6.1, 3.3):** the five newer lenses render the responsive
  *desktop* page on mobile while Home/Timeline have bespoke premium screens; mobile bypasses
  `PersonAvatar` (raw initials/emoji, lost per-name tint), uses raw spinners, and a 6-color
  off-brand palette via `glossy.ts`. A mobile-excellence pass (program Agent 4) to the
  `MobileHome` bar — **without shrinking desktop**. **(L)**
- **Timeline at scale (Eng H2/H3):** no virtualization, and `projectEvents` re-queries the
  full per-source history (200×5) on **every** page (in-memory keyset). Virtualize + push the
  cursor into the queries. **(M–L)**
- **Focus rings (A11y):** most hand-rolled `<button>`/clickable cards have only hover/active,
  **no visible focus ring**; the assistant thread lacks focus-move + `aria-live`. **(M)**
- **Error parity (Eng M5):** **EssHome is the only surface missing an `ErrorState`** branch —
  a failed `/ess/home` shows a blank page. **(S)**
- **Second brand blue (DS 8.2):** `#2E6FE6` is a hardcoded second "brand blue" across mobile.
  Tokenise or converge on `--primary`. **(M)**

Full Medium/Low lists (state-primitive reuse, motion-idiom consistency, name-resolution N+1,
copy-paste helpers, soft-nag empty copy, etc.) are in the appendices.

---

## 3. Cross-cutting root causes (fix the cause, not 58 symptoms)

1. **The token layer dropped teal.** Most color findings (C2, C6, DS 8.x, 9.x) trace to one
   gap: no teal token. Fix it once → dark mode, contrast, and theming largely resolve together.
2. **Inline re-implementation instead of primitives.** The three-size Focus, four rhythms,
   hand-rolled empty/loading/error states, and Home's card-grid all come from surfaces
   *not* routing through the shared primitives (`FocusPanel`, `EmptyState`, `LoadingState`,
   `ReflectionCard`). A shared `<Movement>`/`<Surface>` wrapper would enforce rhythm + motion
   + one-column everywhere at once.
3. **Mobile is a parallel visual language.** Home/Timeline maintain divergent mobile builds
   that have drifted (palette, faces, loaders, gradients); the newer lenses reuse one
   responsive component (the right pattern). Converging mobile onto the primitives kills the
   whole drift class.
4. **Read endpoints doing roster scans (and one doing writes).** The Experience Core projects
   beautifully but pays for it with per-request full-roster scans; a shared cached "today's
   people/celebrants" read-model (derive-on-read → materialise, per the Core's own §6) removes
   C1 and several Mediums in one move — and is squarely **Priority 4 (Performance)** territory.

---

## 4. Product — persona validation (all 7 journeys walked)

All seven journeys **function**; issues are quality, not breakage.

- **New Joiner** 🟡 — warm welcome across Home/Story/Growth/Company; *gap:* no onboarding-task
  signal yet, so My Attention is empty on day one (honest, but a missed guidance moment).
- **Store / frontline** 🟡 — mobile-only, so the **mobile-parity gap (E4) hits hardest**; core
  punch flow works; thin data → honest empty states.
- **Corporate** 🟢 — richest, strongest journey. No findings.
- **Remote** 🟢 — the "no check-in" nudge already offers the regularization path. Fine.
- **Manager** 🟡 — My Team + My Attention are strong; *friction:* lives across two shells
  (`/manager/*` console ↔ `/ess` self), a navigation-clarity watch-item.
- **HR** 🟢 — tenant-wide approvals + Company moderation work; approval list caps sensibly.
- **Executive (employee mode)** 🟢 — identical to employee, correct (Executive OS out of scope).

---

## 5. Commercial — why a CHRO chooses CognixHR over a traditional HRMS

1. **It's an Employee Operating System, not a portal of modules.** Employees live in seven
   first-person experiences that tell one story — not a menu of forms. This drives **adoption
   and daily engagement**, the metric most HRMS rollouts die on.
2. **People-first, emotionally designed — built for belonging and retention.** Faces over rows;
   recognition, celebrations, a Timeline that *remembers* a journey and a My Growth that
   reflects who someone is becoming. A retention lever, not a cost centre.
3. **Ambient AI woven through the product — not a bolted-on chatbot.** One quiet contextual
   insight per surface, plus an asked Assistant that leads with an answer + an action. A
   credible "AI-native HR" story for the board.
4. **My Attention inverts notification fatigue.** Uniquely built to be *emptied* — "Nothing
   needs you. You're all clear" is the designed reward, and it can never accumulate
   un-clearable noise. A *finishable* workday no competitor frames this way.
5. **One coherent architecture under everything.** A single Event stream, a Moments contract,
   a frozen Experience Map — every surface feels like one product, mobile and desktop, with
   zero overlap, and new capability composes in without redesign. Lower change-management
   cost; a platform that *stays* coherent as it grows.

> *Traditional HRMS digitises HR paperwork. CognixHR gives every employee an operating system
> for their work-life — and makes them want to open it.*

---

## 6. Remediation plan to reach certification

**Gate sprint (blocks GA) — the 6 Criticals, ~2–4 focused days:**
1. **Teal token + dark-mode tokenisation** (C2) — the keystone; unblocks C6 and many Mediums.
2. **Rebuild EssHome to the frozen borderless one-column language** (C3) via the shared primitives.
3. **Move the celebration write off `/ess/home` + de-duplicate roster scans** (C1).
4. **Screen-reader identity + headings** (C4) and **reduced-motion safety net** (C5) — both quick.
5. **Contrast pass** (C6) — rides on the teal token.

**Fast-follow (before GA, ~2–3 days):** lazy-load ESS pages (bundle), unify Focus size +
32px rhythm via one wrapper, EssHome `ErrorState`, focus rings + assistant `aria-live`, second
brand blue tokenised.

**Then (the roadmap, in order):** **Mobile Excellence** (E4 — converge mobile on the
primitives), then **Performance Optimization** (the cached people/celebrants read-model,
Timeline virtualization), folding naturally into the stated Priority 4/5. **Assistant Actions**
and **Universal Search** (Priority 1/2) remain post-certification.

---

## 7. Appendices (full per-finding detail)

- `certification/AUDIT_DESIGN_SYSTEM.md` — 19 findings, 9 dimensions
- `certification/AUDIT_ENGINEERING.md` — 14 findings, perf/bundle/caching/error-handling
- `certification/AUDIT_ACCESSIBILITY.md` — 15 findings, WCAG 2.1 AA
- `certification/AUDIT_EXPERIENCE_PRODUCT_COMMERCIAL.md` — experience + persona + commercial

*Employee OS v1 is a genuinely strong product held back by a tight, fixable set of quality
gaps — none of them scope, all of them conformance. Close the six Criticals and it certifies.*
