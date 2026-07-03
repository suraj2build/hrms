import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { AuthShowcase, FloatKeyframes } from './AuthShowcase'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
})

type FormValues = z.infer<typeof schema>

export function ForgotPassword() {
  const [sent, setSent] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(values: FormValues) {
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    if (error) {
      toast.error(error.message)
      return
    }
    setSent(true)
  }

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

          {sent ? (
            /* ── Success state ─────────────────────────────────────────────── */
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-[#15B8A6]" />
              <h1 className="text-[22px] font-bold tracking-tight text-foreground">Check your email</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                If an account exists for that email address, a password reset link has been sent. Check your inbox and spam folder.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#1A4D8F] hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          ) : (
            /* ── Form state ────────────────────────────────────────────────── */
            <>
              <h1 className="text-[26px] font-bold tracking-tight text-foreground">Forgot password?</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
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

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="relative h-11 w-full overflow-hidden rounded-xl text-sm font-semibold text-white shadow-lg shadow-[#1A4D8F]/25 transition-all hover:shadow-xl hover:shadow-[#1A4D8F]/30 disabled:opacity-70"
                  style={{ background: 'linear-gradient(180deg, #2260A8 0%, #1A4D8F 60%, #163F75 100%)' }}
                >
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                  <span className="relative flex items-center justify-center gap-2">
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Send reset link
                  </span>
                </button>
              </form>

              <Link
                to="/login"
                className="mt-6 flex items-center gap-1.5 text-sm font-medium text-[#1A4D8F] hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </>
          )}

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
