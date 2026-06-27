/**
 * resolveArrival — the voice and light of The Arrival (Home's threshold).
 *
 * A pure function (no network; the only clock is the `now` you pass) that turns
 * time-of-day + the day's `context` + lightweight same-day memory into the four
 * spoken/visual layers of the door (EXPERIENCE_ARRIVAL_SPEC.md):
 *
 *   · eyebrow   — the grounding date (a lock-screen's quiet timestamp)
 *   · greeting  — recognition: your name, in the right voice (the <h1>)
 *   · weather   — Workplace Weather: the *rhythm/feeling* of the day, never metrics
 *   · field     — the CSS atmosphere (V1 is gradient-only; photography is a later slot)
 *
 * Hard rules encoded here so they can never drift:
 *   - NEVER surfaces urgency, warnings, counts, approvals or tasks. The door is a
 *     psychologically safe space — recognition, belonging, calm only.
 *   - Context (a birthday, first day, return) BEATS the clock for the greeting.
 *   - Same-day re-entry softens the greeting ("Welcome back") so it acknowledges
 *     continuity without becoming repetitive.
 *   - All fields are translucent tints over the app's base background, so foreground
 *     text stays AA in every phase (including Night) in both light and dark themes.
 */

import type { DayContext } from './resolveGreeting'

export type ArrivalPhase = 'dawn' | 'morning' | 'midday' | 'evening' | 'night' | 'weekend'

export interface ArrivalView {
  phase: ArrivalPhase
  /** The life moment driving the dressing, if any (for tests / styling hooks). */
  moment:
    | 'first_day' | 'back_from_leave' | 'birthday' | 'anniversary'
    | 'salary_day' | 'holiday_tomorrow' | 'holiday_today' | 'revisit' | null
  eyebrow: string
  greeting: string
  weather: string
  /** CSS background-image for the full-viewport atmospheric field. */
  field: string
}

const D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const Mn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function tod(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/** The ambient phase from the clock — the baseline light when no moment overrides. */
function phaseOf(now: Date): ArrivalPhase {
  const dow = now.getDay()
  if (dow === 0 || dow === 6) return 'weekend'
  const h = now.getHours()
  if (h < 8) return 'dawn'
  if (h < 12) return 'morning'
  if (h < 17) return 'midday'
  if (h < 21) return 'evening'
  return 'night'
}

// ── The atmospheric fields — translucent "skies" over the base background ────────
// Each is a layered light-source + wash. Opacities kept gentle so text-foreground
// holds AA on top in light mode, and the deep base carries it in dark mode.
const FIELD: Record<ArrivalPhase, string> = {
  // Dawn — a low sun warming the horizon: gold rising, peach, cool sky settling above.
  dawn:
    'radial-gradient(90% 70% at 50% 108%, rgba(245,184,96,0.30), transparent 62%), ' +
    'radial-gradient(70% 60% at 84% 96%, rgba(240,150,90,0.16), transparent 60%), ' +
    'linear-gradient(180deg, rgba(206,226,247,0.34) 0%, rgba(255,238,214,0.28) 70%, transparent)',
  // Morning — bright, clear, ascending blue with a soft fresh wash.
  morning:
    'radial-gradient(80% 70% at 50% -8%, rgba(46,111,230,0.16), transparent 60%), ' +
    'radial-gradient(70% 60% at 80% 110%, rgba(21,184,166,0.12), transparent 60%), ' +
    'linear-gradient(180deg, rgba(222,236,252,0.40), transparent 72%)',
  // Midday — high open daylight: the airiest, least-tinted field.
  midday:
    'radial-gradient(100% 60% at 50% -12%, rgba(46,111,230,0.12), transparent 64%), ' +
    'linear-gradient(180deg, rgba(228,239,252,0.34), transparent 74%)',
  // Evening — golden hour lowering from the side, amber and calm.
  evening:
    'radial-gradient(80% 72% at 88% 8%, rgba(245,176,92,0.26), transparent 60%), ' +
    'radial-gradient(64% 60% at 12% 96%, rgba(216,120,96,0.14), transparent 58%), ' +
    'linear-gradient(180deg, rgba(252,235,214,0.40), transparent 72%)',
  // Night — deep, quiet indigo; dim and still (the building resting). Tints stay light
  // enough over the base that text remains AA in light mode.
  night:
    'radial-gradient(90% 70% at 50% -6%, rgba(60,72,140,0.20), transparent 64%), ' +
    'radial-gradient(60% 56% at 16% 102%, rgba(124,92,205,0.14), transparent 58%), ' +
    'linear-gradient(180deg, rgba(206,214,238,0.34), transparent 74%)',
  // Weekend — soft, off-duty calm: gentle teal and blue, unhurried.
  weekend:
    'radial-gradient(86% 70% at 78% -6%, rgba(21,184,166,0.18), transparent 60%), ' +
    'radial-gradient(70% 60% at 14% 104%, rgba(46,111,230,0.12), transparent 60%), ' +
    'linear-gradient(180deg, rgba(224,243,240,0.38), transparent 72%)',
}

// A warm "celebration" wash layered in front of the phase field for life moments.
const WARM_OVERLAY =
  'radial-gradient(70% 60% at 50% 6%, rgba(245,190,110,0.26), transparent 58%), '

export interface ResolveArrivalInput {
  name: string | null | undefined
  ctx: DayContext | null | undefined
  now: Date
  /** True if this is not the first Home visit today (lightweight same-day memory). */
  revisit?: boolean
}

export function resolveArrival({ name, ctx, now, revisit }: ResolveArrivalInput): ArrivalView {
  const first = (name || 'there').split(' ')[0] || 'there'
  const c = ctx ?? {}
  const phase = phaseOf(now)
  const eyebrow = `${D[now.getDay()]} · ${now.getDate()} ${Mn[now.getMonth()]}`.toUpperCase()
  const baseField = FIELD[phase]

  // 1 — Life moments (context beats the clock). Warm light + a belonging line.
  if (c.is_first_day)
    return { phase, moment: 'first_day', eyebrow, greeting: `Welcome, ${first}.`, weather: 'Your first day. You’re one of us now.', field: WARM_OVERLAY + baseField }
  if (c.is_back_from_leave)
    return { phase, moment: 'back_from_leave', eyebrow, greeting: `Welcome back, ${first}.`, weather: 'You were missed. Ease back in — there’s no rush.', field: WARM_OVERLAY + baseField }
  if (c.is_birthday)
    return { phase, moment: 'birthday', eyebrow, greeting: `Happy birthday, ${first}.`, weather: 'The team’s thinking of you today.', field: WARM_OVERLAY + baseField }
  if (c.is_work_anniversary) {
    const y = c.anniversary_years ?? 0
    const yLabel = y > 0 ? `${y} year${y === 1 ? '' : 's'} today` : 'Another year today'
    return { phase, moment: 'anniversary', eyebrow, greeting: `${yLabel}, ${first}.`, weather: 'Thank you for all you’ve built here.', field: WARM_OVERLAY + baseField }
  }
  if (c.is_salary_day)
    return { phase, moment: 'salary_day', eyebrow, greeting: `Good ${tod(now.getHours())}, ${first}.`, weather: 'Payday — a good day to be here.', field: baseField }
  if (c.holiday_today)
    return { phase, moment: 'holiday_today', eyebrow, greeting: `Hello, ${first}.`, weather: 'It’s a holiday. Rest easy today.', field: baseField }
  if (c.holiday_tomorrow) {
    const hn = c.next_holiday_name ? ` (${c.next_holiday_name})` : ''
    return { phase, moment: 'holiday_tomorrow', eyebrow, greeting: `Good ${tod(now.getHours())}, ${first}.`, weather: `A holiday tomorrow${hn} — the week’s nearly yours.`, field: baseField }
  }

  // 2 — Same-day re-entry: acknowledge continuity, don't repeat the morning greeting.
  if (revisit)
    return { phase, moment: 'revisit', eyebrow, greeting: `Welcome back, ${first}.`, weather: weatherFor(phase, now), field: baseField }

  // 3 — Ambient: time-of-day recognition + the day's rhythm.
  const greeting =
    phase === 'midday' ? `Hello, ${first}.`
    : phase === 'evening' ? `Good evening, ${first}.`
    : phase === 'night' ? `Still here, ${first}?`
    : phase === 'weekend' ? `Happy ${D[now.getDay()]}, ${first}.`
    : `Good morning, ${first}.`

  return { phase, moment: null, eyebrow, greeting, weather: weatherFor(phase, now), field: baseField }
}

/**
 * Workplace Weather — the *rhythm* of the day, never a metric. Phase leads (the day
 * is literally winding down in the evening); day-of-week adds texture. Deliberately
 * says nothing about workload, tasks, or anything that needs you.
 */
function weatherFor(phase: ArrivalPhase, now: Date): string {
  if (phase === 'night') return 'The day is settling down. It can wait until tomorrow.'
  if (phase === 'evening') return 'The day is gently winding down.'
  if (phase === 'weekend') return 'A calm weekend across the company.'
  const dow = now.getDay()
  if (dow === 1) return 'A fresh week is opening up.'
  if (dow === 5) return 'Friday — easing toward the weekend.'
  if (phase === 'dawn') return 'The company is just waking up. It’s calm.'
  return 'Today feels calm and steady.'
}
