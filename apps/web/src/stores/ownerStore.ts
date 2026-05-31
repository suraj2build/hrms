/**
 * Owner Store — platform admin session state
 *
 * Separate from the tenant authStore. Holds the platform_admins profile
 * and the Supabase access token for owner API calls.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PlatformAdmin {
  id:             string
  name:           string
  email:          string
  role:           'owner' | 'admin'
  is_active:      boolean
  last_login_at:  string | null
  created_at:     string
}

interface OwnerState {
  admin:       PlatformAdmin | null
  accessToken: string | null
  isLoading:   boolean
  setAdmin:       (admin: PlatformAdmin | null) => void
  setAccessToken: (token: string | null) => void
  setLoading:     (v: boolean) => void
  clear:          () => void
  isOwner:        () => boolean
}

export const useOwnerStore = create<OwnerState>()(
  persist(
    (set, get) => ({
      admin:       null,
      accessToken: null,
      isLoading:   false,
      setAdmin:       (admin)       => set({ admin }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setLoading:     (isLoading)   => set({ isLoading }),
      clear: () => set({ admin: null, accessToken: null }),
      isOwner: () => get().admin?.role === 'owner',
    }),
    {
      name: 'hrms-owner',
      partialize: (state) => ({ admin: state.admin }),
    },
  ),
)
