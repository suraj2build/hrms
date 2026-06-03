import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { toast } from 'sonner'
import { ownerSupabase }  from '@/lib/supabase/ownerClient'
import { ownerApi }       from '@/lib/api/ownerApi'
import { useOwnerStore }  from '@/stores/ownerStore'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
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
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Branding */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center mb-4">
            <LogoMark size={48} />
          </div>
          <h1 className="text-2xl font-bold text-white">Platform Owner</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to the owner control panel</p>
        </div>

        <Card className="border-slate-800 bg-slate-900">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">Email</label>
                <Input
                  type="email"
                  placeholder="owner@platform.local"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  {...register('email')}
                />
                {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">Password</label>
                <div className="relative">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
              </div>

              <Button
                type="submit"
                className="w-full bg-[#0D9488] hover:bg-[#1E5BA8] text-white"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Sign in to Owner Panel
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-600">
          This portal is restricted to platform administrators only.
        </p>
      </div>
    </div>
  )
}
