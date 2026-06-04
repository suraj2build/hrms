import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { ownerSupabase }  from '@/lib/supabase/ownerClient'
import { ownerApi }       from '@/lib/api/ownerApi'
import { useOwnerStore }  from '@/stores/ownerStore'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import type { PlatformAdmin } from '@/stores/ownerStore'

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password required'),
})
type Form = z.infer<typeof schema>

export function OwnerLogin() {
  const navigate          = useNavigate()
  const { setAdmin, setAccessToken } = useOwnerStore()
  const [showPw, setShowPw] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(values: Form) {
    // 1. Sign in with Supabase
    const { data, error } = await ownerSupabase.auth.signInWithPassword({
      email: values.email, password: values.password,
    })
    if (error) { toast.error(error.message); return }

    const token = data.session?.access_token
    if (!token) { toast.error('No session token received'); return }

    // 2. Store token temporarily so ownerApi can use it
    setAccessToken(token)

    // 3. Verify this user is a platform admin
    try {
      const res = await ownerApi.get<{ data: PlatformAdmin }>('/owner/me')
      setAdmin(res.data)
      toast.success(`Welcome, ${res.data.name}`)
      navigate('/owner/dashboard', { replace: true })
    } catch {
      // Not a platform admin — clear token and sign out
      setAccessToken(null)
      await ownerSupabase.auth.signOut()
      toast.error('This account does not have owner panel access.')
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 text-slate-900 antialiased overflow-hidden">
      {/* Ambient backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-slate-50" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(110%_110%_at_0%_0%,rgba(13,148,136,0.14),transparent_45%),radial-gradient(110%_110%_at_100%_0%,rgba(79,70,229,0.12),transparent_45%),radial-gradient(130%_130%_at_50%_100%,rgba(56,189,248,0.10),transparent_50%)]" />
      {/* Faint grid */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.4] [background-image:linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:38px_38px]" />

      <div className="w-full max-w-sm space-y-7">
        {/* Branding */}
        <div className="text-center">
          <div className="inline-grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-teal-500 to-indigo-600 shadow-xl shadow-teal-500/25 mb-5">
            <LogoMark size={30} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
            Control Center
          </h1>
          <p className="text-sm text-slate-500 mt-1.5">Platform owner — sign in to continue</p>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-xl p-6 shadow-xl shadow-slate-900/5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Email</label>
              <Input
                type="email"
                placeholder="owner@platform.local"
                className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/30"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Password</label>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 pr-10 focus-visible:ring-teal-500/30"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white shadow-lg shadow-teal-500/20 border-0"
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in to Control Center
            </Button>
          </form>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Restricted to platform administrators only.
        </p>
      </div>
    </div>
  )
}
