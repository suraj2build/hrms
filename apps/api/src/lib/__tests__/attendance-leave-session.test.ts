/**
 * attendance-engine — resolveLeaveSessionForDate regression tests
 * (SYSCERT_AUDIT_2026-08-02.md C3)
 *
 * A multi-day leave request only has ONE legacy `session` column for the
 * whole span, but a half-day start/end means each date needs its OWN
 * session: the duration engine's `duration_breakdown.per_day` is the
 * authoritative per-date source and must win over the legacy column
 * whenever it has an entry for the date in question.
 */

import { describe, it, expect } from 'vitest'
import { resolveLeaveSessionForDate } from '../attendance-engine.js'

describe('resolveLeaveSessionForDate', () => {
  it('cross-session 3-day span: start=second_half, middle=full_day, end=first_half', () => {
    const approvedLeave = {
      half_day: false,
      session: 'second_half' as const,   // legacy column — only reflects the START session
      duration_breakdown: {
        per_day: [
          { date: '2026-08-03', session: 'second_half' as const },
          { date: '2026-08-04', session: 'full_day' as const },
          { date: '2026-08-05', session: 'first_half' as const },
        ],
      },
    }
    // Previously: every day in the span resolved to the legacy `session`
    // ('second_half'), so day 2 and day 3 got the wrong day_fraction.
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-03')).toBe('second_half')
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-04')).toBe('full_day')
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-05')).toBe('first_half')
  })

  it('per-day entry with session=none (holiday/weekoff skip, sandwich-exclude, attendance-overlap) → null', () => {
    const approvedLeave = {
      half_day: false,
      session: 'full_day' as const,
      duration_breakdown: {
        per_day: [
          { date: '2026-08-03', session: 'full_day' as const },
          { date: '2026-08-04', session: 'none' as const },   // e.g. sandwiched weekend, excluded
          { date: '2026-08-05', session: 'full_day' as const },
        ],
      },
    }
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-04')).toBeNull()
  })

  it('no duration_breakdown (pre-engine-rollout row) → falls back to legacy session column', () => {
    const approvedLeave = { half_day: false, session: 'first_half' as const, duration_breakdown: null }
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-03')).toBe('first_half')
  })

  it('no duration_breakdown, session null → falls back to half_day boolean', () => {
    const approvedLeave = { half_day: true, session: null, duration_breakdown: null }
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-03')).toBe('first_half')
  })

  it('hourly leave: per_day is empty by design → falls back to legacy session=hourly', () => {
    const approvedLeave = {
      half_day: false,
      session: 'hourly' as const,
      duration_breakdown: { per_day: [] },
    }
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-03')).toBe('hourly')
  })

  it('date not present in per_day (defensive) → falls back to legacy session column', () => {
    const approvedLeave = {
      half_day: false,
      session: 'full_day' as const,
      duration_breakdown: { per_day: [{ date: '2026-08-03', session: 'full_day' as const }] },
    }
    expect(resolveLeaveSessionForDate(approvedLeave, '2026-08-09')).toBe('full_day')
  })
})
