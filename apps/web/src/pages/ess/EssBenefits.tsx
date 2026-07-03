/**
 * EssBenefits — /ess/benefits (ESS-05)
 *
 * Employee benefits enrolment. Browse the benefit plans your organisation
 * offers (group health, term life, accident, wellness, meal/transport),
 * enrol or waive, and — where the plan allows — choose which dependents are
 * covered. Distinct from the FBP tax module under Payroll.
 */

import { useMemo, useState } from'react'
import { useQuery, useMutation, useQueryClient } from'@tanstack/react-query'
import { toast } from'sonner'
import {
 HeartPulse, Shield, Activity, Sparkles, Utensils, Bus, Gift,
 Loader2, Check, Users, IndianRupee,
} from'lucide-react'

import { PageContainer } from'@/components/layout/PageContainer'
import { PageHeader } from'@/components/layout/PageHeader'
import { SectionCard } from'@/components/layout/SectionCard'
import { Badge } from'@/components/ui/badge'
import { Button } from'@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from'@/components/ui/dialog'
import { api } from'@/lib/api/client'
import { cn } from'@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type PlanType ='health'|'term_life'|'accident'|'wellness'|'meal'|'transport'|'nps'|'other'

interface Plan {
 id: string
 name: string
 plan_type: PlanType
 provider: string | null
 description: string | null
 coverage_amount: number
 employee_cost: number
 employer_cost: number
 allows_dependents: boolean
 enrollment_opens_at: string | null
 enrollment_closes_at: string | null
 is_open: boolean
 is_esic?: boolean
 is_nps?: boolean
}

interface Enrollment {
 id: string
 plan_id: string
 status:'enrolled'|'waived'
 dependent_ids: string[]
 enrolled_at: string
}

interface Dependent {
 id: string
 name: string
 dob: string | null
 gender: string | null
 relationship: string | null
}

const PLAN_META: Record<PlanType, { label: string; icon: React.ComponentType<{ className?: string }>; tint: string }> = {
 health: { label:'Group Health', icon: HeartPulse, tint:'text-destructive bg-destructive/10 border-destructive/30'},
 term_life: { label:'Term Life', icon: Shield, tint:'text-info bg-info/10 border-info/30'},
 accident: { label:'Accident', icon: Activity, tint:'text-warning bg-warning/10 border-warning/30'},
 wellness: { label:'Wellness', icon: Sparkles, tint:'text-success bg-success/10 border-success/30'},
 meal: { label:'Meal', icon: Utensils, tint:'text-accent-coral bg-accent-coral/10 border-accent-coral/30'},
 transport: { label:'Transport', icon: Bus, tint:'text-accent-teal bg-accent-teal/10 border-accent-teal/30'},
 nps: { label:'NPS', icon: Shield, tint:'text-accent-violet bg-accent-violet/20 border-accent-violet/30'},
 other: { label:'Benefit', icon: Gift, tint:'text-accent-violet bg-accent-violet/10 border-accent-violet/30'},
}

const inr = (n: number) =>
 new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits: 0 }).format(n || 0)

export function EssBenefits() {
 const qc = useQueryClient()
 const [openPlan, setOpenPlan] = useState<Plan | null>(null)
 const [picked, setPicked] = useState<Set<string>>(new Set())

 const { data: plansRaw, isLoading } = useQuery<{ data: Plan[] }>({
 queryKey: ['ess-benefit-plans'],
 queryFn: () => api.get('/benefits/plans'),
 staleTime: 60_000,
 })
 const { data: myRaw } = useQuery<{ data: Enrollment[] }>({
 queryKey: ['ess-benefit-my'],
 queryFn: () => api.get('/benefits/my'),
 staleTime: 60_000,
 })
 const { data: depRaw } = useQuery<{ data: Dependent[] }>({
 queryKey: ['ess-benefit-dependents'],
 queryFn: () => api.get('/benefits/dependents'),
 staleTime: 5 * 60_000,
 })

 const plans = plansRaw?.data ?? []
 const dependents = depRaw?.data ?? []
 const enrollByPlan = useMemo(
 () => new Map((myRaw?.data ?? []).map(e => [e.plan_id, e])),
 [myRaw],
 )

 const enroll = useMutation({
 mutationFn: (payload: { plan_id: string; status:'enrolled'|'waived'; dependent_ids: string[] }) =>
 api.post('/benefits/enroll', payload),
 onSuccess: (_d, vars) => {
 qc.invalidateQueries({ queryKey: ['ess-benefit-my'] })
 toast.success(vars.status ==='waived'?'Benefit waived':'Enrolled successfully')
 setOpenPlan(null)
 },
 onError: (e: Error) => toast.error(e?.message ??'Could not save your election'),
 })

 function startEnroll(plan: Plan) {
 const existing = enrollByPlan.get(plan.id)
 setPicked(new Set(existing?.dependent_ids ?? []))
 setOpenPlan(plan)
 }

 function toggleDep(id: string) {
 setPicked(prev => {
 const next = new Set(prev)
 next.has(id) ? next.delete(id) : next.add(id)
 return next
 })
 }

 return (
 <PageContainer>
 <PageHeader title="Benefits" subtitle="Enrol in the benefit plans your organisation offers" />

 <SectionCard title="Available Plans">
 {isLoading ? (
 <div className="flex items-center justify-center py-16 text-muted-foreground">
 <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading plans…
 </div>
 ) : plans.length === 0 ? (
 <div className="py-12 text-center text-sm text-muted-foreground">
 No benefit plans have been published for your organisation yet.
 </div>
 ) : (
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
 {plans.map(plan => {
 const meta = PLAN_META[plan.plan_type] ?? PLAN_META.other
 const Icon = meta.icon
 const mine = enrollByPlan.get(plan.id)
 return (
 <div key={plan.id} className="flex flex-col rounded-xl border border-border p-4">
 <div className="flex items-start justify-between gap-2">
 <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg border', meta.tint)}>
 <Icon className="h-4.5 w-4.5" />
 </div>
 {mine ? (
 <Badge variant={mine.status ==='enrolled'?'success':'secondary'} className="text-[10px] capitalize">
 {mine.status}
 </Badge>
 ) : !plan.is_open ? (
 <Badge variant="outline" className="text-[10px]">Closed</Badge>
 ) : null}
 </div>

 {plan.is_esic && (
 <div className="mt-1 rounded-md border border-info/40 bg-info/20 px-2 py-1 text-[10px] text-info font-medium">
 ESIC — Statutory benefit for eligible employees (gross ≤ ₹21,000)
 </div>
 )}
 {plan.is_nps && (
 <div className="mt-1 rounded-md border border-accent-violet/40 bg-accent-violet/20 px-2 py-1 text-[10px] text-accent-violet font-medium">
 National Pension Scheme (NPS)
 </div>
 )}
 <p className="mt-2 text-sm font-semibold text-foreground">{plan.name}</p>
 <p className="text-[11px] text-muted-foreground">{meta.label}{plan.provider ? ` · ${plan.provider}` :''}</p>

 {plan.description && (
 <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
 )}

 <div className="mt-3 space-y-1 text-xs">
 {plan.coverage_amount > 0 && (
 <div className="flex items-center justify-between">
 <span className="text-muted-foreground">Cover</span>
 <span className="font-medium">{inr(plan.coverage_amount)}</span>
 </div>
 )}
 <div className="flex items-center justify-between">
 <span className="text-muted-foreground">Your cost / yr</span>
 <span className="font-medium">{plan.employee_cost > 0 ? inr(plan.employee_cost) :'Free'}</span>
 </div>
 {plan.allows_dependents && (
 <div className="flex items-center gap-1 text-muted-foreground">
 <Users className="h-3 w-3" /> Dependents can be covered
 </div>
 )}
 </div>

 <div className="mt-3 pt-3 border-t border-border">
 <Button
 size="sm"
 variant={mine?.status ==='enrolled'?'outline':'default'}
 className="w-full"
 disabled={!plan.is_open && !mine}
 onClick={() => startEnroll(plan)}
 >
 {mine?.status ==='enrolled'?'Manage': plan.is_open ?'Enrol':'Closed'}
 </Button>
 </div>
 </div>
 )
 })}
 </div>
 )}
 </SectionCard>

 {/* Enrol / manage dialog */}
 <Dialog open={!!openPlan} onOpenChange={o => { if (!o) setOpenPlan(null) }}>
 <DialogContent className="max-w-md">
 {openPlan && (
 <>
 <DialogHeader><DialogTitle className="pr-6">{openPlan.name}</DialogTitle></DialogHeader>

 <div className="space-y-1 text-xs">
 {openPlan.coverage_amount > 0 && (
 <div className="flex justify-between"><span className="text-muted-foreground">Sum assured</span><span className="font-medium">{inr(openPlan.coverage_amount)}</span></div>
 )}
 <div className="flex justify-between"><span className="text-muted-foreground">Your contribution / yr</span><span className="font-medium">{openPlan.employee_cost > 0 ? inr(openPlan.employee_cost) :'Free'}</span></div>
 <div className="flex justify-between"><span className="text-muted-foreground">Employer contribution / yr</span><span className="font-medium">{inr(openPlan.employer_cost)}</span></div>
 </div>

 {openPlan.allows_dependents && (
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
 <Users className="h-3.5 w-3.5" /> Cover dependents
 </p>
 {dependents.length === 0 ? (
 <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-2">
 No dependents on file. Add family members in your profile to cover them.
 </p>
 ) : (
 <div className="space-y-1 max-h-44 overflow-y-auto">
 {dependents.map(d => {
 const on = picked.has(d.id)
 return (
 <button
 key={d.id}
 type="button"
 onClick={() => toggleDep(d.id)}
 className={cn(
'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
 on ?'border-primary bg-primary/5':'border-border hover:bg-muted/50',
 )}
 >
 <span className={cn('flex h-4 w-4 items-center justify-center rounded border', on ?'bg-primary border-primary text-primary-foreground':'border-muted-foreground/40')}>
 {on && <Check className="h-3 w-3" />}
 </span>
 <span className="flex-1">
 <span className="font-medium">{d.name}</span>
 {d.relationship && <span className="text-muted-foreground"> · {d.relationship}</span>}
 </span>
 </button>
 )
 })}
 </div>
 )}
 </div>
 )}

 <div className="flex items-center gap-2 pt-1">
 <Button
 className="flex-1"
 disabled={enroll.isPending}
 onClick={() => enroll.mutate({ plan_id: openPlan.id, status:'enrolled', dependent_ids: [...picked] })}
 >
 {enroll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />}
 <span className="ml-1">Enrol</span>
 </Button>
 <Button
 variant="outline"
 disabled={enroll.isPending}
 onClick={() => enroll.mutate({ plan_id: openPlan.id, status:'waived', dependent_ids: [] })}
 >
 Waive
 </Button>
 </div>
 </>
 )}
 </DialogContent>
 </Dialog>
 </PageContainer>
 )
}
