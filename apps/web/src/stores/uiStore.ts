import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/types'

// ── Workspace impersonation ───────────────────────────────────────────────────

export interface ImpersonatedIdentity {
  id:   string
  name: string
  code: string
}

// ── UIState ───────────────────────────────────────────────────────────────────

interface UIState {
  // ── Sidebar collapse ────────────────────────────────────────────────────────
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void

  // ── Mobile nav drawer (session-only; <lg screens) ────────────────────────────
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  toggleMobileNav: () => void

  // ── Per-section open/closed state ──────────────────────────────────────────
  // Key format: "admin:SectionHeading" | "ess:SectionHeading"
  sectionStates: Record<string, boolean>
  setSectionOpen: (key: string, open: boolean) => void
  /** Toggles a section. Pass `currentDefault` so the first toggle is correct. */
  toggleSection: (key: string, currentDefault: boolean) => void

  // ── Workspace context (session-only, NOT persisted) ────────────────────────
  // null        = Admin Portal (real role)
  // 'manager'   = Manager Workspace (impersonating a manager's operational view)
  // 'employee'  = Employee Self Service (viewing a specific employee's ESS view)
  activeRole: UserRole | null
  setActiveRole: (role: UserRole | null) => void

  // Impersonated identities — set alongside activeRole, cleared together.
  // SESSION-ONLY — intentionally excluded from localStorage partialize.
  // Used by PreviewBanner (EssShell / ManagerShell) to show "Viewing as X" banner.
  impersonatedEmployee: ImpersonatedIdentity | null
  setImpersonatedEmployee: (emp: ImpersonatedIdentity | null) => void

  impersonatedManager: ImpersonatedIdentity | null
  setImpersonatedManager: (mgr: ImpersonatedIdentity | null) => void

  /** Atomically clears activeRole + both impersonated identities. */
  clearWorkspaceContext: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // ── sidebar ─────────────────────────────────────────────────────────────
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      // ── mobile nav drawer ─────────────────────────────────────────────────────
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),

      // ── sections ────────────────────────────────────────────────────────────
      sectionStates: {},
      setSectionOpen: (key, open) =>
        set((state) => ({
          sectionStates: { ...state.sectionStates, [key]: open },
        })),
      toggleSection: (key, currentDefault) => {
        set((state) => {
          const current =
            key in state.sectionStates ? state.sectionStates[key] : currentDefault
          return { sectionStates: { ...state.sectionStates, [key]: !current } }
        })
      },

      // ── workspace context (session-only) ────────────────────────────────────
      activeRole: null,
      setActiveRole: (role) => set({ activeRole: role }),

      impersonatedEmployee: null,
      setImpersonatedEmployee: (emp) => set({ impersonatedEmployee: emp }),

      impersonatedManager: null,
      setImpersonatedManager: (mgr) => set({ impersonatedManager: mgr }),

      clearWorkspaceContext: () =>
        set({
          activeRole:           null,
          impersonatedEmployee: null,
          impersonatedManager:  null,
        }),
    }),
    {
      name: 'hrms-ui',
      // Only persist layout state — never ephemeral workspace or session context.
      // activeRole / impersonatedEmployee / impersonatedManager are intentionally
      // excluded so workspace context always resets on page refresh.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sectionStates:    state.sectionStates,
      }),
    }
  )
)
