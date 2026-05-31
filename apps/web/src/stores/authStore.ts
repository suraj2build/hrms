import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Profile, Tenant, UserRole } from '@/types'

interface AuthState {
  profile: Profile | null
  tenant: Tenant | null
  accessToken: string | null
  isLoading: boolean
  /**
   * True only during the initial auth resolution on first app mount.
   * Set to false after the first INITIAL_SESSION / SIGNED_IN / SIGNED_OUT
   * event resolves — then stays false permanently for the lifetime of the
   * page. Shells gate their full-screen spinners on this flag so that
   * silent token refreshes (TOKEN_REFRESHED) never trigger a loading takeover.
   */
  isBootstrapping: boolean
  setProfile: (profile: Profile | null) => void
  setTenant: (tenant: Tenant | null) => void
  setAccessToken: (token: string | null) => void
  setLoading: (loading: boolean) => void
  setBootstrapping: (v: boolean) => void
  clear: () => void
  hasRole: (role: UserRole) => boolean
  hasPermission: (permission: string) => boolean
}

// Permission map per role
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: ['*'],
  hr_admin: [
    'employees:read', 'employees:write', 'employees:delete',
    'departments:read', 'departments:write',
    'designations:read', 'designations:write',
    'grades:read', 'grades:write',
    'documents:read', 'documents:write', 'documents:delete',
    'analytics:read',
    'settings:read', 'settings:write',
    'roles:read',
  ],
  manager: [
    'employees:read',
    'departments:read',
    'documents:read',
    'analytics:read',
  ],
  employee: [
    'profile:read', 'profile:write',
    'documents:read',
  ],
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      tenant: null,
      accessToken: null,
      isLoading: true,
      isBootstrapping: true,
      setProfile: (profile) => set({ profile }),
      setTenant: (tenant) => set({ tenant }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setLoading: (isLoading) => set({ isLoading }),
      setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
      clear: () => set({ profile: null, tenant: null, accessToken: null }),
      hasRole: (role: UserRole) => {
        const { profile } = get()
        if (!profile) return false
        if (profile.role === 'super_admin') return true
        return profile.role === role
      },
      hasPermission: (permission: string) => {
        const { profile } = get()
        if (!profile) return false
        const perms = ROLE_PERMISSIONS[profile.role] ?? []
        return perms.includes('*') || perms.includes(permission)
      },
    }),
    {
      name: 'hrms-auth',
      partialize: (state) => ({ profile: state.profile, tenant: state.tenant }),
    }
  )
)
