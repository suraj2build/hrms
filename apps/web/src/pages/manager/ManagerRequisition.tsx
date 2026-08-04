/**
 * ManagerRequisition — /manager/requisitions
 *
 * Lets a manager RAISE a hiring/replacement requisition. Submissions land in
 * the existing recruitment workflow as 'draft' (pending HR approval); HR then
 * approves/holds/cancels. Backend: POST /recruitment/requisitions (manager-or-HR).
 */
import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Briefcase, Plus } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { fmtDate as fmtDateUtil } from '@/lib/utils'

interface Department { id: string; name: string }
interface Requisition {
  id:              string
  title:           string
  departments?:    { name: string } | null
  employment_type: string
  openings:        number
  status:          string
  target_date:     string | null
  created_at:      string
}

const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract',  label: 'Contract' },
  { value: 'intern',    label: 'Intern' },
]

const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-info/10 text-info border-info/30',
  open:      'bg-success/10 text-success border-success/30',
  on_hold:   'bg-warning/10 text-warning border-warning/30',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/30',
  closed:    'bg-muted text-muted-foreground border-border',
}

interface FormState {
  title:           string
  reason:          'new_role' | 'replacement'
  department_id:   string
  location:        string
  employment_type: string
  openings:        string
  target_date:     string
  jd_text:         string
}
const EMPTY: FormState = {
  title: '', reason: 'new_role', department_id: '', location: '',
  employment_type: 'full_time', openings: '1', target_date: '', jd_text: '',
}

export function ManagerRequisition() {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY)

  const { data: deptData } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
  })
  const departments = deptData?.data ?? []

  const { data: reqData, isLoading } = useQuery<{ data: Requisition[] }>({
    queryKey: ['manager', 'requisitions'],
    queryFn:  () => api.get('/recruitment/requisitions'),
  })
  const requisitions = reqData?.data ?? []

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const reasonLabel = form.reason === 'replacement' ? 'Replacement' : 'New role'
  const canSubmit = form.title.trim().length > 0 && Number(form.openings) >= 1

  // Backend supports an Idempotency-Key on this endpoint (checkIdempotency/
  // storeIdempotency, keyed 'requisition-create') so a duplicate submit
  // (double-click, network retry) doesn't create two draft requisitions.
  const idempotencyKey = useRef(crypto.randomUUID())

  const create = useMutation({
    mutationFn: () => {
      // The schema has no dedicated reason column, so record hiring vs
      // replacement at the top of the JD for HR context.
      const jd = `Requisition type: ${reasonLabel}\n\n${form.jd_text}`.trim()
      return api.post('/recruitment/requisitions', {
        title:           form.title.trim(),
        department_id:   form.department_id || null,
        location:        form.location.trim() || null,
        employment_type: form.employment_type,
        openings:        Number(form.openings),
        target_date:     form.target_date || null,
        jd_text:         jd,
      }, { headers: { 'Idempotency-Key': idempotencyKey.current } })
    },
    onSuccess: () => {
      toast.success('Requisition submitted', { description: 'Sent to HR for approval.' })
      setForm(EMPTY)
      idempotencyKey.current = crypto.randomUUID()
      qc.invalidateQueries({ queryKey: ['manager', 'requisitions'] })
      // AdminRecruitment.tsx's queue (['recruitment', 'requisitions', ...])
      // and stats tile (['recruitment', 'stats']) read the same
      // job_requisitions table — invalidate the whole 'recruitment' family
      // so HR sees the new draft without a manual refresh.
      qc.invalidateQueries({ queryKey: ['recruitment'] })
    },
    onError: (e: Error) => toast.error('Failed to submit requisition', { description: e.message }),
  })

  const fmtDate = useMemo(() => (iso: string | null) => (iso ? fmtDateUtil(iso) : '—'), [])

  return (
    <PageContainer>
      <PageHeader
        title="Raise Requisition"
        subtitle="Request a new hire or a replacement — submissions go to HR for approval"
      />

      <SectionCard title="New Requisition" icon={<Plus className="h-4 w-4 text-muted-foreground" />} className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Role title *</label>
            <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Senior Backend Engineer" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.reason}
              onChange={e => set('reason', e.target.value as FormState['reason'])}
            >
              <option value="new_role">New role (additional headcount)</option>
              <option value="replacement">Replacement (backfill)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Department</label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.department_id}
              onChange={e => set('department_id', e.target.value)}
            >
              <option value="">— Select department —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Employment type</label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.employment_type}
              onChange={e => set('employment_type', e.target.value)}
            >
              {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Openings</label>
            <Input type="number" min={1} value={form.openings} onChange={e => set('openings', e.target.value)} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Location</label>
            <Input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Bengaluru / Remote" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Target fill date</label>
            <Input type="date" value={form.target_date} onChange={e => set('target_date', e.target.value)} />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Justification / job description</label>
            <textarea
              className="min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.jd_text}
              onChange={e => set('jd_text', e.target.value)}
              placeholder="Why is this hire needed? Key responsibilities, must-have skills…"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="My Requisitions" icon={<Briefcase className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : requisitions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No requisitions yet. Raise one above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Role</th>
                  <th className="py-2 px-3 font-medium">Department</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium text-right">Openings</th>
                  <th className="py-2 px-3 font-medium">Target</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {requisitions.map(r => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 px-3 font-medium text-foreground">{r.title}</td>
                    <td className="py-2 px-3 text-muted-foreground">{r.departments?.name ?? '—'}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {EMPLOYMENT_TYPES.find(t => t.value === r.employment_type)?.label ?? r.employment_type}
                    </td>
                    <td className="py-2 px-3 text-right text-foreground">{r.openings}</td>
                    <td className="py-2 px-3 text-muted-foreground">{fmtDate(r.target_date)}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={STATUS_STYLE[r.status] ?? 'bg-muted text-muted-foreground border-border'}>
                        {r.status === 'draft' ? 'Pending approval' : r.status.replace('_', ' ')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}

export default ManagerRequisition
