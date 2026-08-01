/**
 * Clears localStorage keys that hold one user's session-scoped UI state —
 * recent-page history, undo history, saved report/analytics views, queue
 * view-mode, per-workspace tab/filter memory, and in-progress import
 * sessions. Called from authStore's clear() on logout so a second user on
 * a shared machine doesn't inherit the previous user's recent-item lists,
 * undo history, or in-progress import data.
 *
 * Deliberately NOT cleared: device/browser preferences that aren't tied to
 * a specific user's identity or data (theme, workspace density, dismissed
 * hints, per-card collapse state) — those are reasonable to persist across
 * logins on the same device.
 */

const STATIC_KEYS = [
  'ux2_recent_pages',    // UniversalSearch.tsx / ContextualInsightsPanel.tsx — recent pages visited
  'ux5_undo_history',    // useUndoLayer.ts — intelligence undo history
  'ux7_queue_mode',      // useOperationalQueue.ts — queue view-mode preference
  'hrms-explorer-views', // DataExplorer.tsx — saved report views (may embed employee/department filters)
  'hrms-analytics-views', // AnalyticsStudio.tsx — saved analytics views (same reasoning)
]

const PREFIXES = [
  'ux3_ws_mem_',    // useWorkspaceMemory.ts — per-workspace tab/filter memory
  'hrms_import_',   // ImportWorkspace.tsx — in-progress import session recovery state
]

export function clearSessionUIState(): void {
  try {
    for (const key of STATIC_KEYS) localStorage.removeItem(key)

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && PREFIXES.some(prefix => key.startsWith(prefix))) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) — nothing to clear
  }
}
