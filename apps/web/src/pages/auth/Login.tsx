import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff, Mail, Lock, Users, Wallet, CalendarCheck, TrendingUp } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
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
          <div className="mb-8 flex items-center gap-2.5">
            <LogoMark size={34} />
            <span className="text-lg font-bold tracking-tight text-slate-900">Emvora</span>
          </div>

          {/* Heading */}
          <h1 className="text-[26px] font-bold tracking-tight text-slate-900">Welcome to Emvora</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in to your workforce workspace — payroll, attendance and people in one place.
          </p>

          {/* Sign in / Sign up segmented */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              className="rounded-lg bg-white py-2 text-sm font-semibold text-slate-900 shadow-sm"
            >
              Sign In
            </button>
            <Link
              to="/signup"
              className="rounded-lg py-2 text-center text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              Sign Up
            </Link>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email Address <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  autoComplete="email"
                  {...register('email')}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-shadow focus:border-[#1A4D8F] focus:outline-none focus:ring-2 focus:ring-[#1A4D8F]/15"
                />
              </div>
              {errors.email && <p className="mt-1 text-xs text-rose-500">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">
                  Password <span className="text-rose-500">*</span>
                </label>
                <Link to="/forgot-password" className="text-xs font-medium text-[#1A4D8F] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  {...register('password')}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-shadow focus:border-[#1A4D8F] focus:outline-none focus:ring-2 focus:ring-[#1A4D8F]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-rose-500">{errors.password.message}</p>}
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
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400">Or continue with</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Google SSO */}
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={googleLoading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
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
          <p className="mt-8 text-center text-[11px] text-slate-400">
            © {new Date().getFullYear()} Emvora · All rights reserved · Terms · Privacy Policy
          </p>
        </div>
      </div>

      {/* ── Right: showcase ────────────────────────────────────────────────── */}
      <ShowcasePanel />
    </div>
  )
}

// ── Showcase panel ──────────────────────────────────────────────────────────────

function ShowcasePanel() {
  return (
    <div className="relative hidden overflow-hidden lg:block">
      {/* Navy brand gradient */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(150deg, #0E2A4E 0%, #1A4D8F 52%, #11335E 100%)' }}
      />
      {/* Soft grid + glow */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(120% 90% at 70% 20%, #000 30%, transparent 80%)',
        }}
      />
      <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#3B82F6]/30 blur-3xl" />
      <div className="absolute bottom-10 left-0 h-72 w-72 rounded-full bg-[#1A8050]/20 blur-3xl" />

      {/* Content */}
      <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
        {/* Floating glassy card stack */}
        <div className="relative mx-auto mt-2 h-[360px] w-full max-w-[460px] [perspective:1400px]">
          {/* Workforce donut card (back) */}
          <GlassCard className="absolute left-2 top-0 w-[270px] [transform:rotate(-5deg)]" floatDelay="0s">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Workforce Overview</p>
              <Users className="h-3.5 w-3.5 text-white/60" />
            </div>
            <p className="mt-1 text-2xl font-bold text-white">248 <span className="text-sm font-medium text-white/60">employees</span></p>
            <div className="mt-3 flex items-center gap-4">
              <Donut />
              <div className="space-y-1.5 text-[11px]">
                <Legend color="#FFFFFF" label="Engineering" val="42%" />
                <Legend color="rgba(255,255,255,.6)" label="Operations" val="33%" />
                <Legend color="rgba(255,255,255,.32)" label="Sales & Other" val="25%" />
              </div>
            </div>
          </GlassCard>

          {/* Leave card (top-right) */}
          <GlassCard className="absolute right-0 top-8 w-[210px] [transform:rotate(4deg)]" floatDelay="1.1s">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Leave & Attendance</p>
              <CalendarCheck className="h-3.5 w-3.5 text-white/60" />
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <p className="text-xl font-bold text-white">96.4%</p>
                <p className="text-[10px] text-white/55">Attendance today</p>
              </div>
              <div className="text-right">
                <p className="text-base font-semibold text-emerald-300">12</p>
                <p className="text-[10px] text-white/55">On leave</p>
              </div>
            </div>
            <div className="mt-3 flex h-7 items-end gap-1">
              {[60, 80, 45, 90, 70, 96, 84].map((h, i) => (
                <span key={i} className="flex-1 rounded-sm bg-white/30" style={{ height: `${h}%` }} />
              ))}
            </div>
          </GlassCard>

          {/* Payroll card (front center) */}
          <GlassCard className="absolute left-1/2 bottom-0 w-[300px] [transform:translateX(-50%)_rotate(-2deg)]" floatDelay="0.5s" front>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Payroll · June 2026</p>
              <Wallet className="h-3.5 w-3.5 text-white/60" />
            </div>
            <p className="mt-1 text-2xl font-bold text-white">₹ 48.2L</p>
            <div className="mt-3 space-y-2">
              <PayLine label="Basic + DA" val="₹ 28.4L" pct={62} />
              <PayLine label="Allowances · HRA" val="₹ 12.9L" pct={28} />
              <PayLine label="PF · ESI · Tax" val="₹ 6.9L" pct={14} />
            </div>
            <button className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/15 py-2 text-[11px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm">
              <TrendingUp className="h-3 w-3" /> Run finalized · ready to disburse
            </button>
          </GlassCard>
        </div>

        {/* Tagline */}
        <div className="max-w-[440px]">
          <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-md">
            <LogoMark size={26} />
          </div>
          <h2 className="text-2xl font-bold leading-tight text-white xl:text-[28px]">
            A Unified Hub for Smarter<br />Workforce Decisions
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/65">
            Emvora gives HR, payroll and people teams a single command center —
            deep insights, statutory compliance and a 360° view of your entire workforce.
          </p>
          <div className="mt-6 flex items-center gap-1.5">
            <span className="h-1.5 w-6 rounded-full bg-white" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Building blocks ─────────────────────────────────────────────────────────────

function GlassCard({
  children, className, floatDelay = '0s', front = false,
}: {
  children: React.ReactNode; className?: string; floatDelay?: string; front?: boolean
}) {
  return (
    <div
      className={
        'rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl ' +
        'shadow-[0_25px_60px_-15px_rgba(0,0,0,0.55)] ring-1 ring-white/10 ' +
        (front ? 'z-20 ' : 'z-10 ') + (className ?? '')
      }
      style={{ animation: `emv-float 6s ease-in-out ${floatDelay} infinite` }}
    >
      {/* top gloss highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-2xl bg-gradient-to-b from-white/20 to-transparent" />
      <div className="relative">{children}</div>
    </div>
  )
}

function Donut() {
  return (
    <div className="relative h-16 w-16 flex-shrink-0">
      <div
        className="h-16 w-16 rounded-full"
        style={{
          background:
            'conic-gradient(#FFFFFF 0 42%, rgba(255,255,255,.6) 42% 75%, rgba(255,255,255,.32) 75% 100%)',
        }}
      />
      <div className="absolute inset-[22%] rounded-full bg-[#163F75]/90 backdrop-blur-sm" />
    </div>
  )
}

function Legend({ color, label, val }: { color: string; label: string; val: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-white/70">{label}</span>
      <span className="ml-auto font-semibold text-white/85">{val}</span>
    </div>
  )
}

function PayLine({ label, val, pct }: { label: string; val: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/70">{label}</span>
        <span className="font-semibold text-white/90">{val}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15">
        <span className="block h-full rounded-full bg-white/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function FloatKeyframes() {
  // Animate the `translate` property (independent of `transform`) so the cards'
  // rotation is preserved while they gently float.
  return (
    <style>{`
      @keyframes emv-float {
        0%, 100% { translate: 0 0; }
        50%      { translate: 0 -10px; }
      }
      @media (prefers-reduced-motion: reduce) {
        [style*="emv-float"] { animation: none !important; }
      }
    `}</style>
  )
}
