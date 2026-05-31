import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBasePath } from '@/lib/routing'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller } from 'react-hook-form'
import { ArrowLeft, Check, ChevronRight, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormField, FormRow, FormSection, FormActions } from '@/components/forms'
import { PageContainer, PageHeader } from '@/components/layout'
import { cn, fmtDate } from '@/lib/utils'
import type { Department, Designation, Grade } from '@/types'

interface Site         { id: string; name: string; location: string | null }
interface Roster       { id: string; name: string; cycle_days: number }
interface WorkLocation { id: string; name: string; city: string | null; is_active: boolean }
interface CostCenter   { id: string; name: string; code: string | null; is_active: boolean }

// ── Step schemas ─────────────────────────────────────────────────────────────
const step1Schema = z.object({
  first_name:   z.string().min(1, 'Required'),
  last_name:    z.string().min(1, 'Required'),
  email:        z.string().email('Enter a valid email'),
  phone:        z.string().optional(),
  joining_date: z.string().min(1, 'Required'),
})

const step2Schema = z.object({
  employment_type:  z.enum(['permanent', 'contract', 'intern', 'probation']),
  department_id:    z.string().optional(),
  designation_id:   z.string().optional(),
  grade_id:         z.string().optional(),
  site_id:          z.string().optional(),
  roster_id:        z.string().optional(),
  work_location_id: z.string().optional(),
  cost_center_id:   z.string().optional(),
})

type Step1 = z.infer<typeof step1Schema>
type Step2 = z.infer<typeof step2Schema>

const STEPS = [
  { id: 1, label: 'Basic Info',  desc: 'Name, email, joining date' },
  { id: 2, label: 'Job Info',    desc: 'Role & department'          },
  { id: 3, label: 'Review',      desc: 'Confirm & onboard'          },
]

export function AddEmployee() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const basePath     = useBasePath()
  const { profile }  = useAuthStore()

  // HR admin-only page — employees and managers cannot create new employees
  if (!['super_admin', 'hr_admin'].includes(profile?.role ?? '')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-sm text-muted-foreground font-medium">Access restricted to HR administrators.</p>
      </div>
    )
  }
  const [step, setStep]           = useState(1)
  const [step1Data, setStep1Data] = useState<Step1 | null>(null)
  const [step2Data, setStep2Data] = useState<Step2 | null>(null)

  const { data: departments }  = useQuery<{ data: Department[] }>({ queryKey: ['departments'],  queryFn: () => api.get('/departments')  })
  const { data: designations } = useQuery<{ data: Designation[] }>({ queryKey: ['designations'], queryFn: () => api.get('/designations') })
  const { data: grades }       = useQuery<{ data: Grade[] }>({ queryKey: ['grades'],       queryFn: () => api.get('/grades')       })
  const { data: sitesData }      = useQuery<{ data: Site[] }>({ queryKey: ['sites'],          queryFn: () => api.get('/masters/sites'),          staleTime: 60_000 })
  const { data: rostersData }    = useQuery<{ data: Roster[] }>({ queryKey: ['rosters'],        queryFn: () => api.get('/masters/rosters'),        staleTime: 60_000 })
  const { data: workLocsData }   = useQuery<{ data: WorkLocation[] }>({ queryKey: ['work-locations'], queryFn: () => api.get('/masters/work-locations'), staleTime: 60_000 })
  const { data: costCentersData }= useQuery<{ data: CostCenter[] }>({ queryKey: ['cost-centers'],   queryFn: () => api.get('/masters/cost-centers'),  staleTime: 60_000 })

  const form1 = useForm<Step1>({ resolver: zodResolver(step1Schema), mode: 'onChange' })
  const form2 = useForm<Step2>({ resolver: zodResolver(step2Schema), mode: 'onChange' })

  const mutation = useMutation({
    mutationFn: async () => {
      if (!step1Data || !step2Data) throw new Error('Form data missing')
      const result = await api.post<{ employee: { id: string } }>('/employees/full-create', {
        first_name:      step1Data.first_name,
        last_name:       step1Data.last_name,
        email:           step1Data.email,
        phone:           step1Data.phone         || undefined,
        joining_date:    step1Data.joining_date,
        employment_type: step2Data.employment_type,
        department_id:   step2Data.department_id   || undefined,
        designation_id:  step2Data.designation_id  || undefined,
        grade_id:        step2Data.grade_id        || undefined,
        site_id:          step2Data.site_id          || undefined,
        roster_id:        (step2Data.roster_id && step2Data.roster_id !== '__none__')
                            ? step2Data.roster_id : undefined,
        work_location_id: step2Data.work_location_id || undefined,
        cost_center_id:   step2Data.cost_center_id   || undefined,
        effective_from:  step1Data.joining_date,
      })
      return result.employee
    },
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Employee onboarded successfully')
      navigate(`${basePath}/employees/${employee.id}`)
    },
    onError: (e: Error) => toast.error('Failed to add employee', { description: e.message }),
  })

  return (
    <PageContainer size="narrow">
      {/* Back + header */}
      <Button variant="ghost" size="sm" onClick={() => navigate(`${basePath}/employees`)} className="-ml-2 gap-1">
        <ArrowLeft className="h-4 w-4" />
        Employees
      </Button>

      <PageHeader
        title="Add Employee"
        subtitle="Onboard a new employee in a few steps."
      />

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-2 flex-1">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                step > s.id  ? 'bg-success text-success-foreground'
                : step === s.id ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
              )}>
                {step > s.id ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <div className="hidden sm:block">
                <p className={cn('text-xs font-semibold', step === s.id ? 'text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </p>
                <p className="text-[10px] text-muted-foreground">{s.desc}</p>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('flex-1 h-px', step > s.id ? 'bg-success' : 'bg-border')} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 1 — Basic Info ── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic Information</CardTitle>
            <CardDescription>Core identity and contact details</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form1.handleSubmit((d) => { setStep1Data(d); setStep(2) })} className="space-y-4">
              <FormSection>
                <FormRow cols={2}>
                  <FormField
                    label="First Name"
                    htmlFor="first_name"
                    required
                    error={form1.formState.errors.first_name?.message}
                  >
                    <Input id="first_name" placeholder="Rahul" {...form1.register('first_name')} />
                  </FormField>

                  <FormField
                    label="Last Name"
                    htmlFor="last_name"
                    required
                    error={form1.formState.errors.last_name?.message}
                  >
                    <Input id="last_name" placeholder="Sharma" {...form1.register('last_name')} />
                  </FormField>
                </FormRow>

                <FormField
                  label="Work Email"
                  htmlFor="email"
                  required
                  error={form1.formState.errors.email?.message}
                >
                  <Input id="email" type="email" placeholder="rahul.sharma@company.com" {...form1.register('email')} />
                </FormField>

                <FormRow cols={2}>
                  <FormField label="Phone" htmlFor="phone">
                    <Input id="phone" placeholder="+91 98765 43210" {...form1.register('phone')} />
                  </FormField>

                  <FormField
                    label="Joining Date"
                    htmlFor="joining_date"
                    required
                    error={form1.formState.errors.joining_date?.message}
                  >
                    <Controller
                      control={form1.control}
                      name="joining_date"
                      render={({ field, fieldState }) => (
                        <DateInput
                          id="joining_date"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          aria-invalid={!!fieldState.error}
                        />
                      )}
                    />
                  </FormField>
                </FormRow>
              </FormSection>

              <Button type="submit" className="w-full">
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2 — Job Info ── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Initial Job Placement</CardTitle>
            <CardDescription>Sets the first job history record. Can be changed later from the profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form2.handleSubmit((d) => { setStep2Data(d); setStep(3) })} className="space-y-4">
              <FormSection>
                <FormField
                  label="Employment Type"
                  htmlFor="employment_type"
                  required
                  error={form2.formState.errors.employment_type?.message}
                >
                  <Select onValueChange={(v) => form2.setValue('employment_type', v as Step2['employment_type'])}>
                    <SelectTrigger id="employment_type"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="permanent">Permanent</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="intern">Intern</SelectItem>
                      <SelectItem value="probation">Probation</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormRow cols={2}>
                  <FormField label="Department" htmlFor="department_id">
                    <Select onValueChange={(v) => form2.setValue('department_id', v)}>
                      <SelectTrigger id="department_id"><SelectValue placeholder="Select department" /></SelectTrigger>
                      <SelectContent>
                        {departments?.data?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Designation" htmlFor="designation_id">
                    <Select onValueChange={(v) => form2.setValue('designation_id', v)}>
                      <SelectTrigger id="designation_id"><SelectValue placeholder="Select designation" /></SelectTrigger>
                      <SelectContent>
                        {designations?.data?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>
                </FormRow>

                <FormField label="Grade" htmlFor="grade_id">
                  <Select onValueChange={(v) => form2.setValue('grade_id', v)}>
                    <SelectTrigger id="grade_id"><SelectValue placeholder="Select grade" /></SelectTrigger>
                    <SelectContent>
                      {grades?.data?.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormRow cols={2}>
                  <FormField label="Site" htmlFor="site_id">
                    <Select onValueChange={(v) => form2.setValue('site_id', v)}>
                      <SelectTrigger id="site_id"><SelectValue placeholder="Select site (optional)" /></SelectTrigger>
                      <SelectContent>
                        {sitesData?.data?.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}{s.location ? ` — ${s.location}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Roster" htmlFor="roster_id">
                    <Select onValueChange={(v) => form2.setValue('roster_id', v)}>
                      <SelectTrigger id="roster_id"><SelectValue placeholder="Inherit from site" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Inherit from site —</SelectItem>
                        {rostersData?.data?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} ({r.cycle_days}-day)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </FormRow>

                <FormRow cols={2}>
                  <FormField label="Work Location" htmlFor="work_location_id">
                    <Select onValueChange={(v) => form2.setValue('work_location_id', v)}>
                      <SelectTrigger id="work_location_id"><SelectValue placeholder="Select work location" /></SelectTrigger>
                      <SelectContent>
                        {workLocsData?.data?.filter(w => w.is_active !== false).map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}{w.city ? ` · ${w.city}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Cost Center" htmlFor="cost_center_id">
                    <Select onValueChange={(v) => form2.setValue('cost_center_id', v)}>
                      <SelectTrigger id="cost_center_id"><SelectValue placeholder="Select cost center" /></SelectTrigger>
                      <SelectContent>
                        {costCentersData?.data?.filter(c => c.is_active !== false).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}{c.code ? ` (${c.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </FormRow>
              </FormSection>

              <FormActions stretch>
                <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button type="submit">
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </FormActions>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3 — Review ── */}
      {step === 3 && step1Data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review & Onboard</CardTitle>
            <CardDescription>Confirm the details before creating the employee record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="rounded-md border border-border bg-muted/30 p-4 space-y-1 text-sm">
              {/* Basic */}
              <p><span className="text-muted-foreground w-32 inline-block">Name</span>{step1Data.first_name} {step1Data.last_name}</p>
              <p><span className="text-muted-foreground w-32 inline-block">Email</span>{step1Data.email}</p>
              {step1Data.phone && <p><span className="text-muted-foreground w-32 inline-block">Phone</span>{step1Data.phone}</p>}
              <p><span className="text-muted-foreground w-32 inline-block">Joining Date</span>{fmtDate(step1Data.joining_date)}</p>

              {step2Data && (
                <>
                  <div className="border-t border-border/60 my-2" />
                  {/* Job */}
                  <p>
                    <span className="text-muted-foreground w-32 inline-block">Employment</span>
                    <span className="capitalize">{step2Data.employment_type}</span>
                  </p>
                  {step2Data.department_id && departments?.data && (
                    <p><span className="text-muted-foreground w-32 inline-block">Department</span>{departments.data.find(d => d.id === step2Data.department_id)?.name ?? '—'}</p>
                  )}
                  {step2Data.designation_id && designations?.data && (
                    <p><span className="text-muted-foreground w-32 inline-block">Designation</span>{designations.data.find(d => d.id === step2Data.designation_id)?.name ?? '—'}</p>
                  )}
                  {step2Data.grade_id && grades?.data && (
                    <p><span className="text-muted-foreground w-32 inline-block">Grade</span>{grades.data.find(g => g.id === step2Data.grade_id)?.name ?? '—'}</p>
                  )}
                  {step2Data.site_id && sitesData?.data && (
                    <p><span className="text-muted-foreground w-32 inline-block">Site</span>{sitesData.data.find(s => s.id === step2Data.site_id)?.name ?? '—'}</p>
                  )}
                  {step2Data.work_location_id && workLocsData?.data && (() => {
                    const w = workLocsData.data.find(w => w.id === step2Data.work_location_id)
                    return <p><span className="text-muted-foreground w-32 inline-block">Work Location</span>{w ? (w.city ? `${w.name} · ${w.city}` : w.name) : '—'}</p>
                  })()}
                  {step2Data.cost_center_id && costCentersData?.data && (() => {
                    const c = costCentersData.data.find(c => c.id === step2Data.cost_center_id)
                    return <p><span className="text-muted-foreground w-32 inline-block">Cost Center</span>{c ? (c.code ? `${c.name} (${c.code})` : c.name) : '—'}</p>
                  })()}
                  <p>
                    <span className="text-muted-foreground w-32 inline-block">Roster</span>
                    {step2Data.roster_id && step2Data.roster_id !== '__none__' && rostersData?.data
                      ? (rostersData.data.find(r => r.id === step2Data.roster_id)?.name ?? '—')
                      : <span className="italic text-muted-foreground text-xs">Inherit from site</span>
                    }
                  </p>
                </>
              )}
            </div>

            {/* Post-onboarding note */}
            <div className="flex gap-2.5 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                After onboarding, complete the employee's profile from their profile page:
                personal details, Aadhaar / PAN / UAN, bank info, emergency contacts, and documents.
              </span>
            </div>

            <FormActions stretch>
              <Button type="button" variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Employee
              </Button>
            </FormActions>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}
