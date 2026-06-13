/**
 * AdminBenefits — /admin/benefits  (ESS-05)
 *
 * HR defines benefit plans (group health, term life, accident, wellness,
 * meal/transport), sets the cost split + enrolment window, and reviews who
 * has enrolled. Distinct from the FBP tax module.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Loader2, Pencil, Power, Users } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }  from '@/lib/utils'

type PlanType = 'health' | 'term_life' | 'accident' | 'wellness' | 'meal' | 'transport' | 'other'
const PLAN_TYPES: PlanType[] = ['health', 'term_life', 'accident', 'wellness', 'meal', 'transport', 'other']
const TYPE_LABEL: Record<PlanType, string> = {
  health: 'Group Health', term_life: 'Term Life', accident: 'Accident',
  wellness: 'Wellness', meal: 'Meal', transport: 'Transport', other: 'Other',
}

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
  is_active: boolean
}

interface Enrollment {
  id: string
  plan_id: string
  status: 'enrolled' | 'waived'
  dependent_ids: string[]
  updated_at: string
  employees?: { first_name: string; last_name: string; employee_code: string } | null
  benefit_plans?: { name: string; plan_type: PlanType } | null
}

type PlanForm = Omit<Plan, 'id'>

const BLANK: PlanForm = {
  name: '', plan_type: 'health', provider: '', description: '',
  coverage_amount: 0, employee_cost: 0, employer_cost: 0,
  allows_dependents: false, enrollment_opens_at: null, enrollment_closes_at: null, is_active: true,
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)

export function AdminBenefits() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [tab, setTab] = useState<'plans' | 'enrollments'>('plans')
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState<PlanForm>(BLANK)
  const [showForm, setShowForm] = useState(false)

  const { data: plansRaw, isLoading } = useQuery<{ data: Plan[] }>({
    queryKey: ['admin-benefit-plans'],
    queryFn:  () => api.get('/benefits/admin/plans'),
    enabled:  isAdmin,
  })
  const { data: enrollRaw } = useQuery<{ data: Enrollment[] }>({
    queryKey: ['admin-benefit-enrollments'],
    queryFn:  () => api.get('/benefits/admin/enrollments'),
    enabled:  isAdmin && tab === 'enrollments',
  })
  const plans = plansRaw?.data ?? []
  const enrollments = enrollRaw?.data ?? []

  const save = useMutation({
    mutationFn: (p: { id?: string; body: PlanForm }) =>
      p.id ? api.put(`/benefits/admin/plans/${p.id}`, p.body) : api.post('/benefits/admin/plans', p.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-benefit-plans'] })
      toast.success(editing ? 'Plan updated' : 'Plan created')
      setShowForm(false); setEditing(null)
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save plan'),
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/benefits/admin/plans/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-benefit-plans'] }); toast.success('Plan deactivated') },
    onError: (e: any) => toast.error(e?.message ?? 'Could not deactivate'),
  })

  function openCreate() { setEditing(null); setForm(BLANK); setShowForm(true) }
  function openEdit(p: Plan) {
    setEditing(p)
    setForm({ ...p, provider: p.provider ?? '', description: p.description ?? '' })
    setShowForm(true)
  }
  function submit() {
    if (form.name.trim().length < 2) { toast.error('Plan name is required'); return }
    save.mutate({ id: editing?.id, body: { ...form, provider: form.provider || undefined as any, description: form.description || undefined as any } })
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <Users className="h-8 w-8" /><p className="text-sm">Benefits admin is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Benefits"
        subtitle="Define benefit plans and review employee enrolments"
        actions={tab === 'plans' && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />New Plan</Button>}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {(['plans', 'enrollments'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-2 text-sm capitalize border-b-2 -mb-px transition-colors',
              tab === t ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'plans' ? (
        <SectionCard title="Benefit Plans">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : plans.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No benefit plans yet. Create one to get started.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 text-xs font-medium">Plan</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Type</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Cover</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Emp / Yr</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Window</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map(p => (
                    <tr key={p.id} className={cn('border-b border-border/50', !p.is_active && 'opacity-50')}>
                      <td className="py-2 px-3">
                        <span className="text-xs font-medium">{p.name}</span>
                        {p.provider && <span className="block text-[10px] text-muted-foreground">{p.provider}</span>}
                      </td>
                      <td className="py-2 px-3 text-xs">{TYPE_LABEL[p.plan_type]}</td>
                      <td className="py-2 px-3 text-xs text-right">{p.coverage_amount > 0 ? inr(p.coverage_amount) : '—'}</td>
                      <td className="py-2 px-3 text-xs text-right">{p.employee_cost > 0 ? inr(p.employee_cost) : 'Free'}</td>
                      <td className="py-2 px-3 text-[10px] text-muted-foreground">
                        {p.enrollment_opens_at || p.enrollment_closes_at
                          ? `${p.enrollment_opens_at ?? '…'} → ${p.enrollment_closes_at ?? '…'}`
                          : 'Always open'}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={p.is_active ? 'success' : 'secondary'} className="text-[10px]">{p.is_active ? 'Active' : 'Inactive'}</Badge>
                        {p.allows_dependents && <Badge variant="outline" className="ml-1 text-[10px]">+Deps</Badge>}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                        {p.is_active && (
                          <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(p.id)}><Power className="h-3.5 w-3.5 text-red-500" /></Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Enrolments">
          {enrollments.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No enrolments yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 text-xs font-medium">Employee</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Plan</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Dependents</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map(e => (
                    <tr key={e.id} className="border-b border-border/50">
                      <td className="py-2 px-3 text-xs">
                        {e.employees ? `${e.employees.first_name} ${e.employees.last_name}` : '—'}
                        {e.employees?.employee_code && <span className="block text-[10px] text-muted-foreground">{e.employees.employee_code}</span>}
                      </td>
                      <td className="py-2 px-3 text-xs">{e.benefit_plans?.name ?? '—'}</td>
                      <td className="py-2 px-3"><Badge variant={e.status === 'enrolled' ? 'success' : 'secondary'} className="text-[10px] capitalize">{e.status}</Badge></td>
                      <td className="py-2 px-3 text-xs text-right">{e.dependent_ids?.length ?? 0}</td>
                      <td className="py-2 px-3 text-[10px] text-muted-foreground">{new Date(e.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Plan create/edit dialog */}
      <Dialog open={showForm} onOpenChange={o => { if (!o) { setShowForm(false); setEditing(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit Plan' : 'New Benefit Plan'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" className="col-span-2">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Group Mediclaim 2026" />
            </Field>
            <Field label="Type">
              <select value={form.plan_type} onChange={e => setForm(f => ({ ...f, plan_type: e.target.value as PlanType }))} className={inputCls}>
                {PLAN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Provider">
              <input value={form.provider ?? ''} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} className={inputCls} placeholder="Insurer / vendor" />
            </Field>
            <Field label="Description" className="col-span-2">
              <textarea value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className={cn(inputCls, 'resize-none')} />
            </Field>
            <Field label="Cover amount (₹)">
              <input type="number" min={0} value={form.coverage_amount} onChange={e => setForm(f => ({ ...f, coverage_amount: Number(e.target.value) || 0 }))} className={inputCls} />
            </Field>
            <Field label="Employee cost / yr (₹)">
              <input type="number" min={0} value={form.employee_cost} onChange={e => setForm(f => ({ ...f, employee_cost: Number(e.target.value) || 0 }))} className={inputCls} />
            </Field>
            <Field label="Employer cost / yr (₹)">
              <input type="number" min={0} value={form.employer_cost} onChange={e => setForm(f => ({ ...f, employer_cost: Number(e.target.value) || 0 }))} className={inputCls} />
            </Field>
            <Field label="Allows dependents">
              <label className="flex items-center gap-2 text-xs h-[34px]">
                <input type="checkbox" checked={form.allows_dependents} onChange={e => setForm(f => ({ ...f, allows_dependents: e.target.checked }))} />
                Cover family members
              </label>
            </Field>
            <Field label="Enrolment opens">
              <input type="date" value={form.enrollment_opens_at ?? ''} onChange={e => setForm(f => ({ ...f, enrollment_opens_at: e.target.value || null }))} className={inputCls} />
            </Field>
            <Field label="Enrolment closes">
              <input type="date" value={form.enrollment_closes_at ?? ''} onChange={e => setForm(f => ({ ...f, enrollment_closes_at: e.target.value || null }))} className={inputCls} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null) }}>Cancel</Button>
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? 'Save' : 'Create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

const inputCls = 'w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground'

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  )
}
