import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserRole } from '@/types'

interface UIState {
  // ── Sidebar collapse ────────────────────────────────────────────────────────
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void

  // ── Per-section open/closed state ──────────────────────────────────────────
  // Key format: "admin:SectionHeading" | "ess:SectionHeading"
  sectionStates: Record<string, boolean>
  setSectionOpen: (key: string, open: boolean) => void
  /** Toggles a section. Pass `currentDefault` so the first toggle is correct. */
  toggleSection: (key: string, currentDefault: boolean) => void

  // ── Active portal role ──────────────────────────────────────────────────────
  // null = use the real profile.role; non-null = preview override
  activeRole: UserRole | null
  setActiveRole: (role: UserRole | null) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // ── sidebar ─────────────────────────────────────────────────────────────
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      // ── sections ────────────────────────────────────────────────────────────
      sectionStates: {},
      setSectionOpen: (key, open) =>
        set((state) => ({
          sectionStates: { ...state.sectionStates, [key]: open },
        })),
      toggleSection: (key, currentDefault) => {
        const { sectionStates } = get()
        const current =
          key in sectionStates ? sectionStates[key] : currentDefault
        set((state) => ({
          sectionStates: { ...state.sectionStates, [key]: !current },
        }))
      },

      // ── active role ─────────────────────────────────────────────────────────
      activeRole: null,
      setActiveRole: (role) => set({ activeRole: role }),
    }),
    { name: 'hrms-ui' }
  )
)
