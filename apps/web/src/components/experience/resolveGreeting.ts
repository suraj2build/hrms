/**
 * resolveGreeting — the dynamic, contextual greeting selector for My Day.
 *
 * A pure function (no network, no clock side-effects beyond the `now` you pass)
 * that turns three inputs — time-of-day, day-of-week, and the day's `context`
 * object from /ess/home — into the page's opening line. Context BEATS
 * time-of-day: when something genuinely human is true today (a birthday, a
 * first day, payday), Home opens with that, not "Good morning."
 *
 * Spec: EXPERIENCE_HOME_DESIGN.md §3.A (priority table). Copy lives here, in one
 * table, so the voice stays consistent and is trivial to tune. Tested in
 * isolation — give it a name + context + a fixed `now` and assert the line.
 */

/** The day-shape Home reads to choose its opening — mirrors /ess/home `context`. */
export interface DayContext {
  is_manager?:          boolean
  is_first_day?:        boolean
  is_new_joiner?:       boolean
  is_birthday?:         boolean
  is_work_anniversary?: boolean
  anniversary_years?:   number | null
  is_back_from_leave?:  boolean
  is_salary_day?:       boolean
  holiday_today?:       boolean
  holiday_tomorrow?:    boolean
  next_holiday_name?:   string | null
  next_holiday_days?:   number | null
}

export interface Greeting {
  /** The display headline, e.g. "Happy birthday, Suraj 🎉". */
  headline: string
  /** The muted sub-line beneath it. */
  subline: string
  /**
   * Which rule fired — useful for tests, and lets a movement know the day's
   * lead context so Focus/People can echo it (adaptation, §5).
   */
  reason:
    | 'first_day' | 'birthday' | 'anniversary' | 'back_from_leave'
    | 'salary_day' | 'long_weekend' | 'time_of_day'
}

function timeOfDayVerb(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/** Day-of-week texture for the default sub-line. */
function weekTexture(dow: number): string {
  if (dow === 1) return 'a fresh week ahead'
  if (dow === 5) return 'almost the weekend'
  if (dow === 0 || dow === 6) return 'enjoy the weekend'
  return 'midweek'
}

const M = ['January','February','March','April','May','June','July','August','September','October','November','December']
const D = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

/** Long-form date for the default sub-line: "Thursday, 8 May". */
function longDate(now: Date): string {
  return `${D[now.getDay()]}, ${now.getDate()} ${M[now.getMonth()]}`
}

/**
 * Resolve the greeting. First matching context wins for the headline; the
 * default (time-of-day) is the fallback. Only the highest-priority context
 * leads — a second one is left for a movement's sub-line, never crowded here.
 */
export function resolveGreeting(name: string, ctx: DayContext | null | undefined, now: Date): Greeting {
  const first = (name || 'there').split(' ')[0] || 'there'
  const c = ctx ?? {}

  // 1 — First day (the warmest welcome trumps everything)
  if (c.is_first_day) {
    return { headline: `Welcome aboard, ${first}`, subline: 'Your first day · we’re glad you’re here', reason: 'first_day' }
  }

  // 2 — Birthday
  if (c.is_birthday) {
    return { headline: `Happy birthday, ${first} 🎉`, subline: 'Wishing you a wonderful year ahead', reason: 'birthday' }
  }

  // 3 — Work anniversary
  if (c.is_work_anniversary) {
    const y = c.anniversary_years ?? 0
    const yLabel = y > 0 ? `${y} year${y === 1 ? '' : 's'} today` : 'Another year today'
    return { headline: `${yLabel}, ${first} 🎊`, subline: 'Thank you for everything you’ve built here', reason: 'anniversary' }
  }

  // 4 — First day back after leave
  if (c.is_back_from_leave) {
    return { headline: `Welcome back, ${first}`, subline: 'Hope you had a good break — here’s what you missed', reason: 'back_from_leave' }
  }

  // 5 — Salary day
  if (c.is_salary_day) {
    return { headline: `Good ${timeOfDayVerb(now.getHours())}, ${first}`, subline: 'Payday — your salary landed today', reason: 'salary_day' }
  }

  // 6 — Holiday tomorrow / long weekend ahead
  if (c.holiday_tomorrow) {
    const name2 = c.next_holiday_name ? ` (${c.next_holiday_name})` : ''
    return { headline: `Good ${timeOfDayVerb(now.getHours())}, ${first}`, subline: `One more day, then a holiday${name2}`, reason: 'long_weekend' }
  }

  // 7 — Default: time-of-day + day-of-week texture
  return {
    headline: `Good ${timeOfDayVerb(now.getHours())}, ${first}`,
    subline: `${longDate(now)} · ${weekTexture(now.getDay())}`,
    reason: 'time_of_day',
  }
}
