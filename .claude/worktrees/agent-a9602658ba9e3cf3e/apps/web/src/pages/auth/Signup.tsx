import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Building2, Check, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormField, FormActions } from '@/components/forms'
import { cn } from '@/lib/utils'

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
  { label: '1–50 employees',    value: '1-50'    },
  { label: '51–200 employees',  value: '51-200'  },
  { label: '201–500 employees', value: '201-500' },
  { label: '501–2000 employees',value: '501-2000'},
  { label: '2000+ employees',   value: '2000+'   },
]

const STEPS = [
  { id: 1, label: 'Your Account' },
  { id: 2, label: 'Company Info' },
  { id: 3, label: 'All Set!'     },
]

export function Signup() {
  const navigate = useNavigate()
  const [step, setStep]         = useState(1)
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Branding */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-4">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Set up your HRMS</h1>
          <p className="text-sm text-muted-foreground mt-1">Get started in 2 minutes</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
                step > s.id || step === s.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}>
                {step > s.id ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <span className={cn('text-xs', step === s.id ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Account ── */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create your account</CardTitle>
              <CardDescription>You'll be the Super Admin of your company.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={form1.handleSubmit((d) => { setStep1Data(d); setStep(2) })}
                className="space-y-4"
              >
                <FormField
                  label="Full Name"
                  htmlFor="full_name"
                  required
                  error={form1.formState.errors.full_name?.message}
                >
                  <Input id="full_name" placeholder="Rajan Sharma" {...form1.register('full_name')} />
                </FormField>

                <FormField
                  label="Work Email"
                  htmlFor="signup_email"
                  required
                  error={form1.formState.errors.email?.message}
                >
                  <Input id="signup_email" type="email" placeholder="rajan@company.com" {...form1.register('email')} />
                </FormField>

                <FormField
                  label="Password"
                  htmlFor="signup_password"
                  required
                  description="Minimum 8 characters"
                  error={form1.formState.errors.password?.message}
                >
                  <Input id="signup_password" type="password" placeholder="••••••••" {...form1.register('password')} />
                </FormField>

                <Button type="submit" className="w-full">
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Company ── */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tell us about your company</CardTitle>
              <CardDescription>This helps us configure HRMS for your needs.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={form2.handleSubmit(onStep2Submit)} className="space-y-4">
                <FormField
                  label="Company Name"
                  htmlFor="company_name"
                  required
                  error={form2.formState.errors.company_name?.message}
                >
                  <Input id="company_name" placeholder="CityKart Retail Pvt. Ltd." {...form2.register('company_name')} />
                </FormField>

                <FormField
                  label="Industry"
                  htmlFor="industry"
                  required
                  error={form2.formState.errors.industry?.message}
                >
                  <Select onValueChange={(v) => form2.setValue('industry', v)}>
                    <SelectTrigger id="industry"><SelectValue placeholder="Select industry" /></SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  label="Company Size"
                  htmlFor="size_range"
                  required
                  error={form2.formState.errors.size_range?.message}
                >
                  <Select onValueChange={(v) => form2.setValue('size_range', v)}>
                    <SelectTrigger id="size_range"><SelectValue placeholder="How many employees?" /></SelectTrigger>
                    <SelectContent>
                      {SIZE_RANGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormActions stretch>
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create Company
                  </Button>
                </FormActions>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Success ── */}
        {step === 3 && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto">
                <Check className="h-8 w-8 text-success" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">You're all set!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Your HRMS is ready. Check your email to verify your account, then sign in.
                </p>
              </div>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Go to Sign In
              </Button>
            </CardContent>
          </Card>
        )}

        {step < 3 && (
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline font-medium">Sign in</Link>
          </p>
        )}
      </div>
    </div>
  )
}
