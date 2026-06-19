/**
 * Positions — Position Management (R7)
 *
 * The sanctioned-strength cockpit. Shows the two KPIs the R0 registry deferred
 * to R7 — sanction vs actual (fill rate) and vacancy (open positions + ageing)
 * — over a CRUD table of the position master.
 *
 * A "position" is an authorised slot (title + designation + grade + dept +
 * location) with a sanctioned headcount. Vacancy = sanctioned − current
 * occupants (job_history.is_current rows pointing at the position).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Loader2, Briefcase, Building2, TrendingUp, AlertTriangle, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

// ── Types ──────────────────────────────────────────────────────────────────
interface NamedRef { id: string; name: string }
interface Position {
  id: string
  code: string
  title: string
  sanctioned_count: number
  status: 'active' | 'frozen' | 'abolished'
  effective_date: string
  designation_id: string | null
  grade_id: string | null
  department_id: string | null
  work_location_id: string | null
  site_id: string | null
  departments: NamedRef | null
  designations: NamedRef | null
  grades: NamedRef | null
  work_locations: NamedRef | null
  sites: NamedRef | null
  filled_count: number
  open_vacancies: number
  is_overfilled: boolean
}
interface Summary {
  summary: {
    sanctioned_strength: number
    filled: number
    vacancies: number
    fill_rate_pct: number
    open_positions: number
    avg_vacancy_age_days: number
    position_count: number
  }
  by_department: { department: string; sanctioned: number; filled: number; vacancies: number }[]
}

const NONE = '__none__'

interface FormState {
  title: string
  code: string
  sanctioned_count: number
  status: 'active' | 'frozen' | 'abolished'
  department_id: string
  designation_id: string
  grade_id: string
  work_location_id: string
  site_id: string
}
const emptyForm: FormState = {
  title: '', code: '', sanctioned_count: 1, status: 'active',
  department_id: NONE, designation_id: NONE, grade_id: NONE, work_location_id: NONE, site_id: NONE,
}

const STATUS_BADGE: Record<string, string> = {
  active:    'text-success border-success/30 bg-success/10',
  frozen:    'text-warning border-warning/30 bg-warning/10',
  abolished: 'text-muted-foreground border-border bg-muted',
}

export function Positions() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.profile?.role)
  const isAdmin = role === 'super_admin' || role === 'hr_admin'

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Position | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data: posData, isLoading } = useQuery<{ data: Position[] }>({
    queryKey: ['positions'], queryFn: () => api.get('/positions'),
  })
  const { data: summary } = useQuery<Summary>({
    queryKey: ['positions-summary'], queryFn: () => api.get('/positions/summary'),
  })
  const { data: deptData }   = useQuery<{ data: NamedRef[] }>({ queryKey: ['departments'],  queryFn: () => api.get('/departments'),  staleTime: 60_000 })
  const { data: desigData }  = useQuery<{ data: NamedRef[] }>({ queryKey: ['designations'], queryFn: () => api.get('/designations'), staleTime: 60_000 })
  const { data: gradeData }  = useQuery<{ data: NamedRef[] }>({ queryKey: ['grades'],       queryFn: () => api.get('/grades'),       staleTime: 60_000 })
  const { data: locData }    = useQuery<{ data: NamedRef[] }>({ queryKey: ['work-locations'], queryFn: () => api.get('/masters/work-locations'), staleTime: 60_000 })
  const { data: siteData }   = useQuery<{ data: NamedRef[] }>({ queryKey: ['sites'],        queryFn: () => api.get('/masters/sites'),  staleTime: 60_000 })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['positions'] })
    qc.invalidateQueries({ queryKey: ['positions-summary'] })
  }

  const idOrNull = (v: string) => (v === NONE ? null : v)
  const payload = (f: FormState) => ({
    title: f.title.trim(),
    code: f.code.trim() || undefined,
    sanctioned_count: f.sanctioned_count,
    status: f.status,
    department_id: idOrNull(f.department_id),
    designation_id: idOrNull(f.designation_id),
    grade_id: idOrNull(f.grade_id),
    work_location_id: idOrNull(f.work_location_id),
    site_id: idOrNull(f.site_id),
  })

  const createMut = useMutation({
    mutationFn: (f: FormState) => api.post('/positions', payload(f)),
    onSuccess: () => { toast.success('Position created'); invalidate(); setDialogOpen(false) },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to create position'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, f }: { id: string; f: FormState }) => api.put(`/positions/${id}`, payload(f)),
    onSuccess: () => { toast.success('Position updated'); invalidate(); setDialogOpen(false) },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to update position'),
  })
  const deleteMut = useMutation({
    mutationFn: ({ id, abolish }: { id: string; abolish: boolean }) => api.delete(`/positions/${id}`, abolish ? { abolish: true } : undefined),
    onSuccess: () => { toast.success('Position removed'); invalidate() },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to remove position'),
  })

  function openCreate() {
    setEditing(null); setForm(emptyForm); setDialogOpen(true)
  }
  function openEdit(p: Position) {
    setEditing(p)
    setForm({
      title: p.title, code: p.code, sanctioned_count: p.sanctioned_count, status: p.status,
      department_id: p.department_id ?? NONE, designation_id: p.designation_id ?? NONE,
      grade_id: p.grade_id ?? NONE, work_location_id: p.work_location_id ?? NONE, site_id: p.site_id ?? NONE,
    })
    setDialogOpen(true)
  }
  function submit() {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (editing) updateMut.mutate({ id: editing.id, f: form })
    else createMut.mutate(form)
  }
  function handleDelete(p: Position) {
    const referenced = p.filled_count > 0
    if (referenced) {
      if (confirm(`"${p.title}" has ${p.filled_count} current occupant(s). Retire (abolish) it instead of deleting?`)) {
        deleteMut.mutate({ id: p.id, abolish: true })
      }
      return
    }
    if (confirm(`Delete position "${p.title}"? This cannot be undone.`)) {
      deleteMut.mutate({ id: p.id, abolish: false })
    }
  }

  const positions = posData?.data ?? []
  const s = summary?.summary

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Briefcase className="h-6 w-6 text-primary" />
            Positions
          </h1>
          <p className="text-sm text-muted-foreground">
            Sanctioned org slots — the source of truth for headcount budget, fill rate and vacancy.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> New Position
          </Button>
        )}
      </div>

      {/* KPI cockpit */}
      {s && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard icon={Building2} label="Sanctioned Strength" value={s.sanctioned_strength} sub={`${s.position_count} positions`} />
          <KpiCard icon={TrendingUp} label="Fill Rate" value={`${s.fill_rate_pct}%`} sub={`${s.filled} filled`}
                   tone={s.fill_rate_pct >= 90 ? 'success' : s.fill_rate_pct >= 75 ? 'warning' : 'danger'} />
          <KpiCard icon={AlertTriangle} label="Vacancies" value={s.vacancies} sub={`${s.open_positions} open positions`}
                   tone={s.vacancies > 0 ? 'warning' : 'success'} />
          <KpiCard icon={Clock} label="Avg Vacancy Age" value={`${s.avg_vacancy_age_days}d`} sub="since sanctioned"
                   tone={s.avg_vacancy_age_days > 90 ? 'danger' : s.avg_vacancy_age_days > 45 ? 'warning' : 'success'} />
        </div>
      )}

      {/* By-department vacancy */}
      {summary && summary.by_department.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Sanction vs Actual by Department</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {summary.by_department.map(d => {
              const pct = d.sanctioned > 0 ? Math.round((d.filled / d.sanctioned) * 100) : 0
              return (
                <div key={d.department} className="flex items-center gap-3 text-sm">
                  <span className="w-40 flex-shrink-0 truncate">{d.department}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${pct >= 90 ? 'bg-success' : pct >= 75 ? 'bg-warning' : 'bg-destructive'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <span className="w-28 flex-shrink-0 text-right tabular-nums text-muted-foreground">
                    {d.filled}/{d.sanctioned}{d.vacancies > 0 && <span className="ml-1 text-warning">({d.vacancies} open)</span>}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Positions table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : positions.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No positions yet. {isAdmin && 'Create your first sanctioned position to start tracking vacancy.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">Title</th>
                    <th className="px-4 py-2.5 font-medium">Department</th>
                    <th className="px-4 py-2.5 font-medium">Grade</th>
                    <th className="px-4 py-2.5 text-center font-medium">Sanctioned</th>
                    <th className="px-4 py-2.5 text-center font-medium">Filled</th>
                    <th className="px-4 py-2.5 text-center font-medium">Vacancy</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    {isAdmin && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => (
                    <tr key={p.id} className="border-b border-border/60 hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.code}</td>
                      <td className="px-4 py-2.5 font-medium">
                        {p.title}
                        {p.designations?.name && <span className="ml-1.5 text-xs text-muted-foreground">· {p.designations.name}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.departments?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.grades?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{p.sanctioned_count}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">
                        <span className={p.is_overfilled ? 'text-destructive font-semibold' : ''}>{p.filled_count}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center tabular-nums">
                        {p.open_vacancies > 0
                          ? <span className="font-semibold text-warning">{p.open_vacancies}</span>
                          : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={STATUS_BADGE[p.status]}>{p.status}</Badge>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit Position' : 'New Position'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Senior Store Manager" />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Auto-generated" />
            </div>
            <div className="space-y-1.5">
              <Label>Sanctioned Count *</Label>
              <Input type="number" min={1} value={form.sanctioned_count}
                     onChange={e => setForm(f => ({ ...f, sanctioned_count: Math.max(1, Number(e.target.value) || 1) }))} />
            </div>
            <RefSelect label="Department"   value={form.department_id}   options={deptData?.data}  onChange={v => setForm(f => ({ ...f, department_id: v }))} />
            <RefSelect label="Designation"  value={form.designation_id}  options={desigData?.data} onChange={v => setForm(f => ({ ...f, designation_id: v }))} />
            <RefSelect label="Grade"        value={form.grade_id}        options={gradeData?.data} onChange={v => setForm(f => ({ ...f, grade_id: v }))} />
            <RefSelect label="Site"         value={form.site_id}         options={siteData?.data}  onChange={v => setForm(f => ({ ...f, site_id: v }))} />
            <RefSelect label="Work Location" value={form.work_location_id} options={locData?.data}  onChange={v => setForm(f => ({ ...f, work_location_id: v }))} />
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v: FormState['status']) => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="frozen">Frozen</SelectItem>
                  <SelectItem value="abolished">Abolished</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string
  tone?: 'success' | 'warning' | 'danger'
}) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
        <div className={`mt-1.5 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function RefSelect({ label, value, options, onChange }: {
  label: string; value: string; options?: NamedRef[]; onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {(options ?? []).map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
