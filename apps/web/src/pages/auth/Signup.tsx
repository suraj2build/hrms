import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Check, ChevronRight, User, Mail, Lock, Building2 } from 'lucide-react'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { AuthShowcase, FloatKeyframes } from './AuthShowcase'

// ── Schemas ──────────────────────────────────────────────────────────────────
const step1Schema = z.object({
  full_name: z.string().min(2, 'Name is required'),
  email:     z.string().email('Enter a valid email'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
})
const step2Schema = z.object({
  company_name: z.string().min(2, 'Company name is required'),
  industry:     z.string().min(1, 'Select an industry'),
  size_range:   z.string().min(1, 'Select company size'),
})

type Step1Form = z.infer<typeof step1Schema>
type Step2Form = z.infer<typeof step2Schema>

const INDUSTRIES = [
  'Retail', 'E-commerce', 'IT/Software', 'Manufacturing', 'BFSI',
  'Healthcare', 'Education', 'FMCG', 'Automobile', 'Staffing', 'Other',
]
const SIZE_RANGES = [
  { label: '1–50 employees',     value: '1-50'     },
  { label: '51–200 employees',   value: '51-200'   },
  { label: '201–500 employees',  value: '201-500'  },
  { label: '501–2000 employees', value: '501-2000' },
  { label: '2000+ employees',    value: '2000+'    },
]
const STEPS = [
  { id: 1, label: 'Your Account' },
  { id: 2, label: 'Company Info' },
  { id: 3, label: 'All Set!'     },
]

// ── Shared field styles (match Login) ───────────────────────────────────────────
const inputCls =
  'h-11 w-full rounded-xl border border-border bg-white pl-10 pr-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground shadow-sm transition-shadow focus:border-[#1A4D8F] focus:outline-none ' +
  'focus:ring-2 focus:ring-[#1A4D8F]/15'
const labelCls = 'mb-1.5 block text-sm font-medium text-foreground'
const selectCls =
  'h-11 w-full appearance-none rounded-xl border border-border bg-white px-3 text-sm text-foreground ' +
  'shadow-sm transition-shadow focus:border-[#1A4D8F] focus:outline-none focus:ring-2 focus:ring-[#1A4D8F]/15'

function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'relative h-11 w-full overflow-hidden rounded-xl text-sm font-semibold text-white shadow-lg',
        'shadow-[#1A4D8F]/25 transition-all hover:shadow-xl hover:shadow-[#1A4D8F]/30 disabled:opacity-70',
      )}
      style={{ background: 'linear-gradient(180deg, #2260A8 0%, #1A4D8F 60%, #163F75 100%)' }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      <span className="relative flex items-center justify-center gap-2">{children}</span>
    </button>
  )
}

export function Signup() {
  const navigate = useNavigate()
  const [step, setStep]           = useState(1)
  const [step1Data, setStep1Data] = useState<Step1Form | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form1 = useForm<Step1Form>({ resolver: zodResolver(step1Schema) })
  const form2 = useForm<Step2Form>({ resolver: zodResolver(step2Schema) })

  async function onStep2Submit(data: Step2Form) {
    if (!step1Data) return
    setIsSubmitting(true)
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email:    step1Data.email,
        password: step1Data.password,
        options:  { data: { full_name: step1Data.full_name } },
      })
      if (authError) throw new Error(authError.message)
      if (!authData.user) throw new Error('Failed to create user')

      await api.post('/setup', {
        user_id:      authData.user.id,
        full_name:    step1Data.full_name,
        company_name: data.company_name,
        industry:     data.industry,
        size_range:   data.size_range,
      })
      setStep(3)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#f5f7fb] lg:grid lg:grid-cols-[1fr_1.05fr]">
      <FloatKeyframes />

      {/* ── Left: form ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-screen items-center justify-center px-5 py-10 lg:min-h-0">
        <div className="w-full max-w-[420px]">
          {/* Logo */}
          <div className="mb-7 flex items-center gap-3">
            <LogoMark size={40} tile />
            <div>
              <Wordmark height={20} />
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                Smarter Workforce · Stronger Future
              </p>
            </div>
          </div>

          <h1 className="text-[24px] font-bold tracking-tight text-foreground">Set up your CognixHR workspace</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Get started in 2 minutes</p>

          {/* Step indicators */}
          <div className="mt-6 flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-1.5">
                <span className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  step >= s.id ? 'bg-[#1A4D8F] text-white' : 'bg-muted text-muted-foreground',
                )}>
                  {step > s.id ? <Check className="h-3 w-3" /> : s.id}
                </span>
                <span className={cn('text-[11px]', step === s.id ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>

          {/* ── Step 1: Account ── */}
          {step === 1 && (
            <form
              onSubmit={form1.handleSubmit((d) => { setStep1Data(d); setStep(2) })}
              className="mt-6 space-y-4"
            >
              <div>
                <p className="text-[15px] font-semibold text-foreground">Create your account</p>
                <p className="text-xs text-muted-foreground">You'll be the Super Admin of your company.</p>
              </div>

              <Field label="Full Name" icon={User} error={form1.formState.errors.full_name?.message}>
                <input className={inputCls} placeholder="Rajan Sharma" {...form1.register('full_name')} />
              </Field>
              <Field label="Work Email" icon={Mail} error={form1.formState.errors.email?.message}>
                <input className={inputCls} type="email" placeholder="rajan@company.com" {...form1.register('email')} />
              </Field>
              <Field label="Password" icon={Lock} error={form1.formState.errors.password?.message} hint="Minimum 8 characters">
                <input className={inputCls} type="password" placeholder="••••••••" {...form1.register('password')} />
              </Field>

              <PrimaryButton type="submit">Continue <ChevronRight className="h-4 w-4" /></PrimaryButton>
            </form>
          )}

          {/* ── Step 2: Company ── */}
          {step === 2 && (
            <form onSubmit={form2.handleSubmit(onStep2Submit)} className="mt-6 space-y-4">
              <div>
                <p className="text-[15px] font-semibold text-foreground">Tell us about your company</p>
                <p className="text-xs text-muted-foreground">This helps us configure CognixHR for your needs.</p>
              </div>

              <Field label="Company Name" icon={Building2} error={form2.formState.errors.company_name?.message}>
                <input className={inputCls} placeholder="CityKart Retail Pvt. Ltd." {...form2.register('company_name')} />
              </Field>

              <div>
                <label className={labelCls}>Industry <span className="text-destructive">*</span></label>
                <select className={selectCls} defaultValue="" {...form2.register('industry')}>
                  <option value="" disabled>Select industry</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
                {form2.formState.errors.industry && <p className="mt-1 text-xs text-destructive">{form2.formState.errors.industry.message}</p>}
              </div>

              <div>
                <label className={labelCls}>Company Size <span className="text-destructive">*</span></label>
                <select className={selectCls} defaultValue="" {...form2.register('size_range')}>
                  <option value="" disabled>How many employees?</option>
                  {SIZE_RANGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                {form2.formState.errors.size_range && <p className="mt-1 text-xs text-destructive">{form2.formState.errors.size_range.message}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="h-11 flex-1 rounded-xl border border-border bg-white text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Back
                </button>
                <div className="flex-1">
                  <PrimaryButton type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create Company
                  </PrimaryButton>
                </div>
              </div>
            </form>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (
            <div className="mt-8 rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                <Check className="h-8 w-8 text-success" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">You're all set!</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your CognixHR workspace is ready. Check your email to verify your account, then sign in.
              </p>
              <div className="mt-5">
                <PrimaryButton type="button" onClick={() => navigate('/login')}>Go to Sign In</PrimaryButton>
              </div>
            </div>
          )}

          {step < 3 && (
            <p className="mt-6 text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-[#1A4D8F] hover:underline">Sign in</Link>
            </p>
          )}

          <p className="mt-8 text-center text-[11px] text-slate-400">
            © {new Date().getFullYear()} CognixHR · All rights reserved ·{' '}
            <Link to="/terms" className="hover:text-slate-600 hover:underline">Terms</Link> ·{' '}
            <Link to="/privacy" className="hover:text-slate-600 hover:underline">Privacy Policy</Link>
          </p>
        </div>
      </div>

      {/* ── Right: showcase ────────────────────────────────────────────────── */}
      <AuthShowcase />
    </div>
  )
}

// ── Field with inline icon (matches Login) ──────────────────────────────────────

function Field({
  label, icon: Icon, error, hint, children,
}: {
  label: string; icon: React.ElementType; error?: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className={labelCls}>{label} <span className="text-rose-500">*</span></label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        {children}
      </div>
      {hint && !error && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  )
}
