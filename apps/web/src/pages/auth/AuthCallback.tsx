import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/types'

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin', 'manager']

/**
 * OAuth callback handler (Google SSO etc.).
 *
 * Strategy:
 *  1. Confirm a session exists in the URL fragment — if not, bail to /login.
 *  2. Wait for AuthProvider to finish calling /me and set the profile.
 *     This avoids the blank-screen race where navigate('/') fires before the
 *     profile is ready and RoleRedirect shows a dark spinner indefinitely.
 *  3. Navigate directly to the role-appropriate portal once the profile loads.
 */
export function AuthCallback() {
  const navigate = useNavigate()
  const { profile, isLoading } = useAuthStore()

  // Step 1: confirm the OAuth session on mount. If there is no session
  // (e.g. user landed here directly), send them to login immediately.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate('/login', { replace: true })
      }
      // If a session exists, AuthProvider's onAuthStateChange will fire
      // (SIGNED_IN or INITIAL_SESSION) and load the profile. The effect
      // below will then navigate once isLoading goes false.
    })
  }, [navigate])

  // Step 2: navigate once profile is ready.
  useEffect(() => {
    if (!isLoading && profile) {
      const dest = ADMIN_ROLES.includes(profile.role) ? '/admin/dashboard' : '/ess/dashboard'
      navigate(dest, { replace: true })
    }
  }, [profile, isLoading, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </div>
    </div>
  )
}
