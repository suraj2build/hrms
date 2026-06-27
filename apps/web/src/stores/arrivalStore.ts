/**
 * arrivalStore — the nav-hide signal for The Arrival (Home's threshold).
 *
 * The Arrival is the first viewport of Home: a psychologically safe "door" where
 * navigation and all chrome are HIDDEN, so the only thing present is recognition,
 * belonging and calm (EXPERIENCE_ARRIVAL_SPEC.md §2.6 — the Sacred Absence; §4.3 —
 * nav reappears only after crossing). Because nav lives in the shells (EssShell /
 * MobileEssShell) and the Arrival lives in the page, they need a tiny shared flag:
 *
 *   - The Arrival sets `atThreshold = true` while the door is in view, and flips it
 *     to `false` once the employee crosses (scrolls past) into the day.
 *   - The shells read `atThreshold` and hide all chrome (sidebar, topbar, context
 *     panel, warnings, bottom nav) while it is true.
 *
 * Deliberately NOT persisted — it is pure transient view state for the current page.
 */

import { create } from 'zustand'

interface ArrivalState {
  /** True while the Arrival door owns the screen; false once crossed into the day. */
  atThreshold: boolean
  setAtThreshold: (v: boolean) => void
}

export const useArrivalStore = create<ArrivalState>((set) => ({
  atThreshold: false,
  setAtThreshold: (v) => set((s) => (s.atThreshold === v ? s : { atThreshold: v })),
}))
