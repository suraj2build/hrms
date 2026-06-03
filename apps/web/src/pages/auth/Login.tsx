import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { FormField } from '@/components/forms'
import type { UserRole } from '@/types'

const loginSchema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin', 'manager']

export function Login() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword]   = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  // True while we are waiting for AuthProvider to load the profile after sign-in.
  const [awaitingProfile, setAwaitingProfile] = useState(false)

  const { profile, isLoading } = useAuthStore()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  // ── Already-authenticated redirect ─────────────────────────────────────────
  // If the user lands on /login while already signed in (e.g. browser back),
  // send them straight to the right portal once the profile is loaded.
  useEffect(() => {
    if (!isLoading && profile) {
      const dest = ADMIN_ROLES.includes(profile.role) ? '/admin/dashboard' : '/ess/dashboard'
      navigate(dest, { replace: true })
    }
  }, [profile, isLoading, navigate])

  // ── Post-sign-in redirect ───────────────────────────────────────────────────
  // We set awaitingProfile = true when credentials are accepted. Once
  // AuthProvider finishes loading /me and sets the profile, we navigate.
  // This keeps the Login form visible (no blank-screen jump to /) while the
  // profile is being fetched, and lets us detect failure cleanly.
  useEffect(() => {
    if (!awaitingProfile) return
    // isLoading went from true → false: AuthProvider finished the /me call.
    if (!isLoading) {
      if (profile) {
        const dest = ADMIN_ROLES.includes(profile.role) ? '/admin/dashboard' : '/ess/dashboard'
        navigate(dest, { replace: true })
      } else {
        // AuthProvider cleared the profile — /me failed (profile missing, API
        // down, etc.). The error toast is shown by AuthProvider; just reset
        // our waiting flag so the form is usable again.
        setAwaitingProfile(false)
      }
    }
  }, [awaitingProfile, isLoading, profile, navigate])

  async function onSubmit(values: LoginForm) {
    const { error } = await supabase.auth.signInWithPassword({
      email:    values.email,
      password: values.password,
    })
    if (error) { toast.error(error.message); return }
    // Credentials accepted. Stay on this page — AuthProvider will now call
    // /me and populate the profile. The useEffect above will navigate once
    // isLoading goes false.
    setAwaitingProfile(true)
  }

  async function signInWithGoogle() {
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) { toast.error(error.message); setGoogleLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #EBF3FC 0%, #F3F5F8 50%, #E8F3EC 100%)' }}
    >
      <div className="w-full max-w-[440px] space-y-6">
        {/* Branding */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center mb-4">
            <LogoMark size={48} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Sign in to your Emvora workspace</p>
        </div>

        <Card className="shadow-elev-3">
          <CardContent className="pt-6 space-y-4">
            {/* Google SSO */}
            <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle} disabled={googleLoading}>
              {googleLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Continue with Google
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Email / password form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                label="Work Email"
                htmlFor="email"
                required
                error={errors.email?.message}
              >
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  {...register('email')}
                />
              </FormField>

              <FormField
                htmlFor="password"
                required
                error={errors.password?.message}
                label=""
                className="space-y-1.5"
              >
                {/* Custom label row with forgot-password link */}
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    Password <span className="text-destructive ml-0.5 font-semibold" aria-hidden="true">*</span>
                  </label>
                  <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormField>

              <Button type="submit" className="w-full" disabled={isSubmitting || awaitingProfile}>
                {(isSubmitting || awaitingProfile) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {awaitingProfile ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              New to Emvora?{' '}
              <Link to="/signup" className="text-primary hover:underline font-medium">
                Create your company
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
