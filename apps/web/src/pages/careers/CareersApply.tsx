/**
 * CareersApply — /careers/:tenantSlug/:openingId
 *
 * Public, unauthenticated opening detail + apply form. Submits to
 * POST /careers/:tenantSlug/openings/:openingId/apply, which finds-or-creates
 * the candidate and the application row — this is the one native inbound
 * path into the ATS pipeline; everything else requires HR to source a
 * candidate through another channel first.
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Briefcase, MapPin, Users, Loader2, CheckCircle2, Building2 } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface OpeningDetail {
  company_name: string
  id: string
  title: string
  location: string | null
  employment_type: string
  openings: number
  jd_text: string | null
  required_skills: string[] | null
  min_experience: number | null
  max_experience: number | null
  department: string | null
}

interface ApplyForm {
  first_name: string
  last_name: string
  email: string
  phone: string
  resume_url: string
  linkedin_url: string
  current_company: string
  current_title: string
  total_experience: string
  notes: string
}

const EMPTY_FORM: ApplyForm = {
  first_name: '', last_name: '', email: '', phone: '', resume_url: '', linkedin_url: '',
  current_company: '', current_title: '', total_experience: '', notes: '',
}

export function CareersApply() {
  const { tenantSlug, openingId } = useParams<{ tenantSlug: string; openingId: string }>()
  const [form, setForm] = useState<ApplyForm>(EMPTY_FORM)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery<{ data: OpeningDetail }>({
    queryKey: ['careers-opening', tenantSlug, openingId],
    queryFn:  () => api.get(`/careers/${tenantSlug}/openings/${openingId}`),
    retry:    false,
  })
  const opening = data?.data

  const applyMut = useMutation({
    mutationFn: () => api.post(`/careers/${tenantSlug}/openings/${openingId}/apply`, {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      resume_url: form.resume_url.trim() || undefined,
      linkedin_url: form.linkedin_url.trim() || undefined,
      current_company: form.current_company.trim() || undefined,
      current_title: form.current_title.trim() || undefined,
      total_experience: form.total_experience ? Number(form.total_experience) : undefined,
      notes: form.notes.trim() || undefined,
    }),
    onError: (e: unknown) => setFieldError(e instanceof Error ? e.message : 'Something went wrong — please try again'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFieldError(null)
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) {
      setFieldError('Name and email are required')
      return
    }
    applyMut.mutate()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-muted via-primary/5 to-success/5 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !opening) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-muted via-primary/5 to-success/5 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground px-4">
        <Building2 className="h-8 w-8 opacity-30" />
        <p className="text-sm">This position is no longer accepting applications.</p>
        <Link to={`/careers/${tenantSlug}`} className="text-xs text-primary hover:underline mt-1">View other open positions</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted via-primary/5 to-success/5">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6">
          <LogoMark className="h-7 w-7" />
          <span className="text-sm font-semibold text-muted-foreground">Careers · {opening.company_name}</span>
        </div>

        <Link to={`/careers/${tenantSlug}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> All open positions
        </Link>

        <div className="rounded-xl border border-border bg-card p-5 mb-6">
          <h1 className="text-xl font-bold text-foreground">{opening.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
            {opening.department && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{opening.department}</span>}
            {opening.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{opening.location}</span>}
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{opening.openings} opening{opening.openings === 1 ? '' : 's'}</span>
          </div>
          {opening.jd_text && (
            <p className="text-sm text-foreground mt-4 whitespace-pre-wrap">{opening.jd_text}</p>
          )}
          {opening.required_skills && opening.required_skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {opening.required_skills.map(s => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
              ))}
            </div>
          )}
        </div>

        {applyMut.isSuccess ? (
          <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">Application submitted</p>
            <p className="text-xs text-muted-foreground mt-1">We've received your application for {opening.title} and will be in touch by email.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Apply for this position</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">First name *</Label>
                <Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Last name *</Label>
                <Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Current company</Label>
                <Input value={form.current_company} onChange={e => setForm(f => ({ ...f, current_company: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Current title</Label>
                <Input value={form.current_title} onChange={e => setForm(f => ({ ...f, current_title: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Total experience (years)</Label>
                <Input type="number" min={0} max={60} step={0.5} value={form.total_experience} onChange={e => setForm(f => ({ ...f, total_experience: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">LinkedIn profile</Label>
                <Input value={form.linkedin_url} onChange={e => setForm(f => ({ ...f, linkedin_url: e.target.value }))} placeholder="https://linkedin.com/in/…" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Resume link</Label>
              <Input value={form.resume_url} onChange={e => setForm(f => ({ ...f, resume_url: e.target.value }))} placeholder="Link to your resume (Drive, Dropbox, etc.)" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Anything else you'd like to share?</Label>
              <Textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {fieldError && <p className="text-xs text-destructive">{fieldError}</p>}

            <Button type="submit" disabled={applyMut.isPending} className="w-full">
              {applyMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Submit Application
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
