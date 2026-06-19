import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff, Mail, Lock } from 'lucide-react'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { AuthShowcase, FloatKeyframes } from './AuthShowcase'
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
  const [awaitingProfile, setAwaitingProfile] = useState(false)

  const { profile, isLoading } = useAuthStore()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  // Already-authenticated redirect
  useEffect(() => {
    if (!isLoading && profile) {
      const dest = ADMIN_ROLES.includes(profile.role) ? '/admin/dashboard' : '/ess/dashboard'
      navigate(dest, { replace: true })
    }
  }, [profile, isLoading, navigate])

  // Post-sign-in redirect
  useEffect(() => {
    if (!awaitingProfile) return
    if (!isLoading) {
      if (profile) {
        const dest = ADMIN_ROLES.includes(profile.role) ? '/admin/dashboard' : '/ess/dashboard'
        navigate(dest, { replace: true })
      } else {
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

  const busy = isSubmitting || awaitingProfile

  return (
    <div className="min-h-screen w-full bg-[#f5f7fb] lg:grid lg:grid-cols-[1fr_1.05fr]">
      <FloatKeyframes />

      {/* ── Left: form ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-screen items-center justify-center px-5 py-10 lg:min-h-0">
        <div className="w-full max-w-[400px]">
          {/* Logo */}
          <div className="mb-8 flex items-center gap-3">
            <LogoMark size={40} tile />
            <div>
              <Wordmark height={20} />
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                Smarter Workforce · Stronger Future
              </p>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">Welcome to CognixHR</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Sign in to your workforce workspace — payroll, attendance and people in one place.
          </p>

          {/* Sign in / Sign up segmented */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            <button
              type="button"
              className="rounded-lg bg-white py-2 text-sm font-semibold text-foreground shadow-sm"
            >
              Sign In
            </button>
            <Link
              to="/signup"
              className="rounded-lg py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-muted-foreground"
            >
              Sign Up
            </Link>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
                Email Address <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  autoComplete="email"
                  {...register('email')}
                  className="h-11 w-full rounded-xl border border-border bg-white pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-shadow focus:border-[#1A4D8F] focus:outline-none focus:ring-2 focus:ring-[#1A4D8F]/15"
                />
              </div>
              {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password <span className="text-destructive">*</span>
                </label>
                <Link to="/forgot-password" className="text-xs font-medium text-[#1A4D8F] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  {...register('password')}
                  className="h-11 w-full rounded-xl border border-border bg-white pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-shadow focus:border-[#1A4D8F] focus:outline-none focus:ring-2 focus:ring-[#1A4D8F]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-muted-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
            </div>

            {/* Sign in button — glossy */}
            <button
              type="submit"
              disabled={busy}
              className="relative h-11 w-full overflow-hidden rounded-xl text-sm font-semibold text-white shadow-lg shadow-[#1A4D8F]/25 transition-all hover:shadow-xl hover:shadow-[#1A4D8F]/30 disabled:opacity-70"
              style={{ background: 'linear-gradient(180deg, #2260A8 0%, #1A4D8F 60%, #163F75 100%)' }}
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              <span className="relative flex items-center justify-center gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {awaitingProfile ? 'Signing in…' : 'Sign In'}
              </span>
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">Or continue with</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Google SSO */}
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={googleLoading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-white text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-60"
          >
            {googleLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>

          {/* Footer */}
          <p className="mt-8 text-center text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} CognixHR · All rights reserved ·{' '}
            <Link to="/terms" className="hover:text-foreground hover:underline">Terms</Link> ·{' '}
            <Link to="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
          </p>
        </div>
      </div>

      {/* ── Right: showcase ────────────────────────────────────────────────── */}
      <AuthShowcase />
    </div>
  )
}
