import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Landmark, Plus, Loader2, ShieldAlert, Check, X, Settings2,
  TrendingUp, TrendingDown, Building2, Trash2, Copy,
  MoreHorizontal, Pencil, Calendar,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast }         from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type CalcType      = 'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross' | 'balance'
type ComponentType = 'earning' | 'deduction' | 'employer_contribution'

interface SalaryStructure {
  id:               string
  name:             string
  code:             string
  description:      string | null
  is_active:        boolean
  created_at:       string
  pf_applicable?:   boolean
  esi_applicable?:  boolean
  tds_applicable?:  boolean
  salary_structure_components?: { count: number }[]
}

interface StructureComponent {
  id:                  string
  salary_component_id: string
  salary_structure_id: string
  calculation_type:    CalcType
  default_value:       number
  sequence:            number
  is_active:           boolean
  salary_components: {
    id:             string
    name:           string
    code:           string
    component_type: ComponentType
  }
}

interface SalaryComponent {
  id:             string
  name:           string
  code:           string
  component_type: ComponentType
  is_active:      boolean
  default_calculation_type: CalcType | null
  default_value:            number | null
}

interface CtcPreviewComponent {
  name:           string
  code:           string
  component_type: ComponentType
  monthly_amount: number
  annual_amount:  number
}

interface CtcPreview {
  components: CtcPreviewComponent[]
  totals: {
    gross_monthly:                  number
    gross_annual:                   number
    deductions_monthly:             number
    employer_contributions_monthly: number
    net_monthly:                    number
    net_annual:                     number
  }
  nlc_applied:     boolean
  pf_applied:      boolean
  nlc_wage_pct:    number | null
  ctc_annual:      number
  residual_annual: number
}

interface StructureForm {
  name:           string
  code:           string
  description:    string
  is_active:      boolean
  pf_applicable:  boolean
  esi_applicable: boolean
  tds_applicable: boolean
}

interface AddComponentForm {
  salary_component_id: string
  calculation_type:    CalcType
  default_value:       string
}

const EMPTY_STRUCTURE_FORM: StructureForm = {
  name: '', code: '', description: '', is_active: true,
  pf_applicable: true, esi_applicable: true, tds_applicable: true,
}

const EMPTY_ADD_FORM: AddComponentForm = {
  salary_component_id: '', calculation_type: 'fixed', default_value: '0',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CALC_LABELS: Record<CalcType, string> = {
  fixed:        'Fixed (₹/month)',
  pct_of_basic: '% of Basic',
  pct_of_ctc:   '% of CTC',
  pct_of_gross: '% of Gross',
  balance:      'Balance (residual of CTC)',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function CalcBadge({ type, value }: { type: CalcType; value: number }) {
  const label =
    type === 'balance' ? 'Balance'
    : type === 'fixed' ? `₹${value.toLocaleString('en-IN')}/mo`
    : `${value}% of ${type === 'pct_of_basic' ? 'Basic' : type === 'pct_of_ctc' ? 'CTC' : 'Gross'}`
  return <span className="text-xs text-muted-foreground font-mono">{label}</span>
}

function TypeIcon({ type }: { type: ComponentType }) {
  if (type === 'earning')   return <TrendingUp  className="h-3 w-3 text-success" />
  if (type === 'deduction') return <TrendingDown className="h-3 w-3 text-destructive" />
  return <Building2 className="h-3 w-3 text-info" />
}

function StatFlag({ label, active }: { label: string; active?: boolean }) {
  if (!active) return null
  return (
    <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold bg-primary/[0.08] text-primary border border-primary/20">
      {label}
    </span>
  )
}

// ── Structure Dialog ──────────────────────────────────────────────────────────

function StructureDialog({
  open, onOpenChange, editId, initialForm, onSubmit, isPending,
}: {
  open:          boolean
  onOpenChange:  (v: boolean) => void
  editId:        string | null
  initialForm:   StructureForm
  onSubmit:      (form: StructureForm) => void
  isPending:     boolean
}) {
  const [form, setForm] = useState<StructureForm>(initialForm)

  useEffect(() => { setForm(initialForm) }, [initialForm, open])

  function set(k: keyof StructureForm, v: string | boolean) {
    setForm(p => ({ ...p, [k]: v }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editId ? 'Edit Salary Structure' : 'New Salary Structure'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Senior Engineer CTC"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Code *</label>
              <Input
                value={form.code}
                onChange={e => set('code', e.target.value.toUpperCase())}
                placeholder="SE_CTC"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <div className="flex items-center gap-2 h-9">
                <input
                  type="checkbox" id="dlg_active"
                  checked={form.is_active}
                  onChange={e => set('is_active', e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="dlg_active" className="text-sm cursor-pointer">Active</label>
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">Statutory Applicability</p>
            <p className="text-[11px] text-muted-foreground">Which statutory deductions apply to employees on this structure?</p>
            <div className="flex gap-5 flex-wrap">
              {([
                ['pf_applicable',  'PF / EPF'],
                ['esi_applicable', 'ESI'],
                ['tds_applicable', 'TDS / Income Tax'],
              ] as [keyof StructureForm, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={!!form[key]}
                    onChange={e => set(key, e.target.checked)}
                    className="rounded"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSubmit(form)}
            disabled={isPending || !form.name || !form.code}
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {editId ? 'Save Changes' : 'Create Structure'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Clone Dialog ──────────────────────────────────────────────────────────────

function CloneDialog({
  source, open, onOpenChange, onClone, isPending,
}: {
  source:       SalaryStructure | null
  open:         boolean
  onOpenChange: (v: boolean) => void
  onClone:      (name: string, code: string) => void
  isPending:    boolean
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  useEffect(() => {
    if (source && open) {
      setName(`${source.name} (Copy)`)
      setCode(`${source.code}_COPY`)
    }
  }, [source, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Clone Structure</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Duplicates <span className="font-medium text-foreground">"{source?.name}"</span> with all components and calculation rules. Edit afterwards as needed.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">New Name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manager CTC" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">New Code *</label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="font-mono" placeholder="MGR_CTC" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onClone(name, code)} disabled={isPending || !name || !code}>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Clone Structure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Add Component Dialog ──────────────────────────────────────────────────────

function AddComponentDialog({
  open, onOpenChange, availableComponents, onAdd, isPending,
}: {
  open:                boolean
  onOpenChange:        (v: boolean) => void
  availableComponents: SalaryComponent[]
  onAdd:               (form: AddComponentForm) => void
  isPending:           boolean
}) {
  const [form, setForm] = useState<AddComponentForm>(EMPTY_ADD_FORM)

  useEffect(() => { if (open) setForm(EMPTY_ADD_FORM) }, [open])

  function pickComponent(id: string) {
    const picked = availableComponents.find(c => c.id === id)
    setForm(p => ({
      ...p,
      salary_component_id: id,
      calculation_type: picked?.default_calculation_type ?? p.calculation_type,
      default_value: picked?.default_value != null ? String(picked.default_value) : p.default_value,
    }))
  }

  const earnings   = availableComponents.filter(c => c.component_type === 'earning')
  const deductions = availableComponents.filter(c => c.component_type === 'deduction')
  const employer   = availableComponents.filter(c => c.component_type === 'employer_contribution')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Component to Structure</DialogTitle>
        </DialogHeader>
        {availableComponents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            All available components have been added to this structure.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Component *</label>
              <select
                value={form.salary_component_id}
                onChange={e => pickComponent(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">Select a component…</option>
                {earnings.length > 0 && (
                  <optgroup label="Earnings">
                    {earnings.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
                {deductions.length > 0 && (
                  <optgroup label="Deductions">
                    {deductions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
                {employer.length > 0 && (
                  <optgroup label="Employer Contributions">
                    {employer.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Calculation Rule</label>
              <select
                value={form.calculation_type}
                onChange={e => setForm(p => ({ ...p, calculation_type: e.target.value as CalcType }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                {Object.entries(CALC_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {form.calculation_type !== 'balance' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {form.calculation_type === 'fixed' ? 'Amount (₹/month)' : 'Percentage (%)'}
                </label>
                <Input
                  type="number" min={0}
                  value={form.default_value}
                  onChange={e => setForm(p => ({ ...p, default_value: e.target.value }))}
                />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {availableComponents.length > 0 && (
            <Button
              onClick={() => onAdd(form)}
              disabled={isPending || !form.salary_component_id}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Add Component
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function CompensationMaster() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [structureDialogOpen, setStructureDialogOpen] = useState(false)
  const [editStructureId, setEditStructureId]         = useState<string | null>(null)
  const [structureForm, setStructureForm]             = useState<StructureForm>(EMPTY_STRUCTURE_FORM)

  const [cloneSource, setCloneSource]         = useState<SalaryStructure | null>(null)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)

  const [componentDialogOpen, setComponentDialogOpen] = useState(false)

  const [previewCtc, setPreviewCtc] = useState('1200000')

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: structuresData, isLoading: structuresLoading } = useQuery<{ data: SalaryStructure[] }>({
    queryKey: ['comp-structures'],
    queryFn:  () => api.get('/payroll/compensation/structures'),
    staleTime: 60_000,
  })
  const structures = structuresData?.data ?? []

  const { data: structureComponentsData, isLoading: compLoading } = useQuery<{ data: StructureComponent[] }>({
    queryKey: ['comp-structure-components', selectedId],
    queryFn:  () => api.get(`/payroll/compensation/structures/${selectedId}/components`),
    enabled:  !!selectedId,
    staleTime: 30_000,
  })
  const structureComponents = structureComponentsData?.data ?? []

  const { data: componentLibraryData } = useQuery<{ data: SalaryComponent[] }>({
    queryKey: ['comp-components-library'],
    queryFn:  () => api.get('/payroll/compensation/components?is_active=true'),
    staleTime: 120_000,
  })
  const componentLibrary = componentLibraryData?.data ?? []

  const usedIds = new Set(structureComponents.map(c => c.salary_component_id))
  const availableComponents = componentLibrary.filter(c => !usedIds.has(c.id))

  // ── Mutations ────────────────────────────────────────────────────────────────

  const invalidateStructures = () => qc.invalidateQueries({ queryKey: ['comp-structures'] })
  const invalidateComponents = () => qc.invalidateQueries({ queryKey: ['comp-structure-components', selectedId] })

  const createStructureMutation = useMutation({
    mutationFn: (body: object) => api.post('/payroll/compensation/structures', body),
    onSuccess: () => {
      invalidateStructures()
      setStructureDialogOpen(false)
      setStructureForm(EMPTY_STRUCTURE_FORM)
      toast.success('Structure created')
    },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const updateStructureMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/payroll/compensation/structures/${id}`, body),
    onSuccess: () => {
      invalidateStructures()
      setStructureDialogOpen(false)
      setEditStructureId(null)
      setStructureForm(EMPTY_STRUCTURE_FORM)
      toast.success('Structure updated')
    },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const addComponentMutation = useMutation({
    mutationFn: (body: object) =>
      api.post(`/payroll/compensation/structures/${selectedId}/components`, body),
    onSuccess: () => {
      invalidateComponents()
      invalidateStructures()
      setComponentDialogOpen(false)
      toast.success('Component added')
    },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const removeComponentMutation = useMutation({
    mutationFn: (compId: string) =>
      api.delete(`/payroll/compensation/structures/${selectedId}/components/${compId}`),
    onSuccess: () => { invalidateComponents(); invalidateStructures(); toast.success('Component removed') },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const cloneMutation = useMutation<{ data: { id: string } }, Error, { id: string; body: object }>({
    mutationFn: ({ id, body }) => api.post(`/payroll/compensation/structures/${id}/clone`, body),
    onSuccess: (res) => {
      invalidateStructures()
      setCloneDialogOpen(false)
      setCloneSource(null)
      if (res?.data?.id) setSelectedId(res.data.id)
      toast.success('Structure cloned')
    },
    onError: (e: Error) => toast.error('Clone failed', { description: e.message }),
  })

  const previewMutation = useMutation<{ data: CtcPreview }, Error, { ctc_annual: number }>({
    mutationFn: (body) => api.post(`/payroll/compensation/structures/${selectedId}/preview`, body),
    onError: (e: Error) => toast.error('Preview failed', { description: e.message }),
  })

  useEffect(() => { previewMutation.reset() }, [selectedId])  // eslint-disable-line react-hooks/exhaustive-deps
  const previewResult = previewMutation.data?.data ?? null

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function openCreate() {
    setStructureForm(EMPTY_STRUCTURE_FORM)
    setEditStructureId(null)
    setStructureDialogOpen(true)
  }

  function openEdit(s: SalaryStructure) {
    setStructureForm({
      name:           s.name,
      code:           s.code,
      description:    s.description ?? '',
      is_active:      s.is_active,
      pf_applicable:  s.pf_applicable ?? true,
      esi_applicable: s.esi_applicable ?? true,
      tds_applicable: s.tds_applicable ?? true,
    })
    setEditStructureId(s.id)
    setStructureDialogOpen(true)
  }

  function handleStructureSubmit(form: StructureForm) {
    const body = { ...form, description: form.description || undefined }
    if (editStructureId) updateStructureMutation.mutate({ id: editStructureId, body })
    else                 createStructureMutation.mutate(body)
  }

  function handleClone(name: string, code: string) {
    if (!cloneSource) return
    cloneMutation.mutate({ id: cloneSource.id, body: { name, code } })
  }

  function handleAddComponent(form: AddComponentForm) {
    const sortedForMax = [...structureComponents].sort((a, b) => a.sequence - b.sequence)
    const maxSeq = sortedForMax.length > 0 ? Math.max(...sortedForMax.map(c => c.sequence)) : 0
    addComponentMutation.mutate({
      salary_component_id: form.salary_component_id,
      calculation_type:    form.calculation_type,
      default_value:       parseFloat(form.default_value) || 0,
      sequence:            maxSeq + 10,
    })
  }

  function runPreview() {
    const ctc = parseFloat(previewCtc)
    if (!ctc || ctc <= 0) { toast.error('Enter a valid annual CTC'); return }
    previewMutation.mutate({ ctc_annual: ctc })
  }

  const selectedStructure  = structures.find(s => s.id === selectedId)
  const structureIsPending = createStructureMutation.isPending || updateStructureMutation.isPending
  const sortedComponents   = [...structureComponents].sort((a, b) => a.sequence - b.sequence)

  const earnings    = sortedComponents.filter(c => c.salary_components.component_type === 'earning')
  const deductions  = sortedComponents.filter(c => c.salary_components.component_type === 'deduction')
  const employer    = sortedComponents.filter(c => c.salary_components.component_type === 'employer_contribution')

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold">Access Denied</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              You do not have permission to manage salary structures.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Compensation Master"
        subtitle="Build salary structures by assembling components with calculation rules"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" /> New Structure
          </Button>
        }
      />

      {/* ── Dialogs ───────────────────────────────────────────────────────────── */}
      <StructureDialog
        open={structureDialogOpen}
        onOpenChange={v => {
          if (!v) { setEditStructureId(null); setStructureForm(EMPTY_STRUCTURE_FORM) }
          setStructureDialogOpen(v)
        }}
        editId={editStructureId}
        initialForm={structureForm}
        onSubmit={handleStructureSubmit}
        isPending={structureIsPending}
      />

      <CloneDialog
        source={cloneSource}
        open={cloneDialogOpen}
        onOpenChange={v => { setCloneDialogOpen(v); if (!v) setCloneSource(null) }}
        onClone={handleClone}
        isPending={cloneMutation.isPending}
      />

      <AddComponentDialog
        open={componentDialogOpen}
        onOpenChange={setComponentDialogOpen}
        availableComponents={availableComponents}
        onAdd={handleAddComponent}
        isPending={addComponentMutation.isPending}
      />

      {/* ── Two-panel layout ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">

        {/* ── Left: Structures list ─────────────────────────────────────────── */}
        <SectionCard
          title="Salary Structures"
          icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
        >
          {structuresLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            </div>
          ) : structures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <Landmark className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No structures yet.</p>
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create first structure
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {structures.map(s => {
                const compCount  = s.salary_structure_components?.[0]?.count ?? 0
                const isSelected = s.id === selectedId
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                    className={cn(
                      'flex items-center gap-3 px-2 py-3 cursor-pointer transition-colors group',
                      isSelected ? 'bg-primary/[0.08]' : 'hover:bg-muted/50',
                    )}
                  >
                    {/* Selected accent */}
                    <div className={cn(
                      'w-0.5 self-stretch rounded-full shrink-0 transition-colors',
                      isSelected ? 'bg-primary' : 'bg-transparent group-hover:bg-border',
                    )} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                        {!s.is_active && (
                          <Badge variant="secondary" className="text-[9px] rounded-full shrink-0 py-0">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-mono text-muted-foreground">{s.code}</span>
                        <span className="text-[10px] text-muted-foreground">
                          · {compCount} component{compCount !== 1 ? 's' : ''}
                        </span>
                        {s.created_at && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            · <Calendar className="h-2.5 w-2.5 inline" /> {fmtDate(s.created_at)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        <StatFlag label="PF"  active={s.pf_applicable} />
                        <StatFlag label="ESI" active={s.esi_applicable} />
                        <StatFlag label="TDS" active={s.tds_applicable} />
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(s) }}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setCloneSource(s); setCloneDialogOpen(true) }}>
                          <Copy className="h-3.5 w-3.5 mr-2" /> Clone
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        {/* ── Right: Structure detail ───────────────────────────────────────── */}
        <div className="space-y-4">
          {!selectedId ? (
            <SectionCard>
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <Settings2 className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Select a salary structure on the left to view and configure its components.
                </p>
              </div>
            </SectionCard>
          ) : (
            <SectionCard
              title={selectedStructure?.name ?? 'Structure'}
              icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
              action={
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline"
                    onClick={() => selectedStructure && openEdit(selectedStructure)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button size="sm"
                    onClick={() => setComponentDialogOpen(true)}
                    disabled={availableComponents.length === 0}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Component
                  </Button>
                </div>
              }
            >
              {/* Structure meta strip */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {selectedStructure?.code}
                </span>
                {selectedStructure && !selectedStructure.is_active && (
                  <Badge variant="secondary">Inactive</Badge>
                )}
                <StatFlag label="PF"  active={selectedStructure?.pf_applicable} />
                <StatFlag label="ESI" active={selectedStructure?.esi_applicable} />
                <StatFlag label="TDS" active={selectedStructure?.tds_applicable} />
                {selectedStructure?.description && (
                  <span className="text-xs text-muted-foreground">{selectedStructure.description}</span>
                )}
              </div>

              {compLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading components…
                </div>
              ) : sortedComponents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <Settings2 className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No components in this structure yet.</p>
                  <Button size="sm" variant="outline" onClick={() => setComponentDialogOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add first component
                  </Button>
                </div>
              ) : (
                <div className="space-y-5">
                  {([
                    { label: 'Earnings',               list: earnings,   type: 'earning'               as ComponentType },
                    { label: 'Deductions',             list: deductions, type: 'deduction'             as ComponentType },
                    { label: 'Employer Contributions', list: employer,   type: 'employer_contribution' as ComponentType },
                  ] as { label: string; list: StructureComponent[]; type: ComponentType }[]).map(group => {
                    if (group.list.length === 0) return null
                    return (
                      <div key={group.type}>
                        <div className="flex items-center gap-2 mb-2">
                          <TypeIcon type={group.type} />
                          <span className="text-xs font-semibold text-foreground">{group.label}</span>
                          <span className="text-[10px] text-muted-foreground">({group.list.length})</span>
                        </div>
                        <div className="rounded-lg border border-border overflow-hidden">
                          {group.list.map((sc, idx) => (
                            <div
                              key={sc.id}
                              className={cn(
                                'flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40',
                                idx < group.list.length - 1 && 'border-b border-border/60',
                              )}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-foreground">
                                  {sc.salary_components.name}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] font-mono text-muted-foreground">
                                    {sc.salary_components.code}
                                  </span>
                                  <CalcBadge type={sc.calculation_type} value={sc.default_value} />
                                </div>
                              </div>
                              <Button
                                size="icon" variant="ghost"
                                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                disabled={removeComponentMutation.isPending}
                                onClick={() => removeComponentMutation.mutate(sc.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground flex-wrap border-t border-border/60">
                    <span><span className="font-semibold text-foreground">{earnings.length}</span> earnings</span>
                    <span><span className="font-semibold text-foreground">{deductions.length}</span> deductions</span>
                    <span><span className="font-semibold text-foreground">{employer.length}</span> employer</span>
                    <span className="ml-auto text-[10px]">{sortedComponents.length} total</span>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Live CTC Preview ─────────────────────────────────────────────── */}
          {selectedId && sortedComponents.length > 0 && (
            <SectionCard
              title="Live CTC Preview"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              action={
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} value={previewCtc}
                    onChange={e => setPreviewCtc(e.target.value)}
                    className="h-8 w-36 text-xs"
                    placeholder="Annual CTC (₹)"
                  />
                  <Button size="sm" className="h-8 text-xs" onClick={runPreview}
                    disabled={previewMutation.isPending}>
                    {previewMutation.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      : <Settings2 className="h-3.5 w-3.5 mr-1" />}
                    Preview
                  </Button>
                </div>
              }
            >
              {!previewResult ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Enter a sample annual CTC and click Preview to see the derived salary breakup. Nothing is saved.
                </p>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    const residual = previewResult.residual_annual
                    const within   = Math.abs(residual) <= 1
                    return (
                      <div className={cn(
                        'flex items-start gap-2 rounded-md px-3 py-2 text-xs border',
                        within
                          ? 'border-success/40 bg-success/10 text-foreground'
                          : 'border-warning/40 bg-warning/10 text-foreground',
                      )}>
                        {within
                          ? <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                          : <X    className="h-4 w-4 text-warning mt-0.5 shrink-0" />}
                        <span>
                          {within
                            ? `Earnings sum to CTC (₹${previewResult.totals.gross_annual.toLocaleString('en-IN')}/yr). Structure is balanced.`
                            : residual > 0
                              ? `Under-allocated by ₹${residual.toLocaleString('en-IN')}/yr — add a Balance component to absorb the residual.`
                              : `Over-allocated by ₹${Math.abs(residual).toLocaleString('en-IN')}/yr — reduce a component.`}
                        </span>
                      </div>
                    )
                  })()}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Gross / mo',        value: previewResult.totals.gross_monthly },
                      { label: 'Deductions / mo',    value: previewResult.totals.deductions_monthly },
                      { label: 'Employer / mo',      value: previewResult.totals.employer_contributions_monthly },
                      { label: 'Net take-home / mo', value: previewResult.totals.net_monthly, highlight: true },
                    ].map(s => (
                      <div key={s.label} className={cn(
                        'rounded-md border border-border p-2.5',
                        s.highlight && 'border-primary/30 bg-primary/[0.04]',
                      )}>
                        <p className="text-[10px] text-muted-foreground">{s.label}</p>
                        <p className={cn('text-sm font-semibold tabular-nums',
                          s.highlight ? 'text-primary' : 'text-foreground')}>
                          ₹{s.value.toLocaleString('en-IN')}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {previewResult.nlc_wage_pct != null && (
                      <Badge variant="secondary" className="text-[10px]">
                        Basic {previewResult.nlc_wage_pct}% of gross{previewResult.nlc_applied ? ' (NLC rebalanced)' : ''}
                      </Badge>
                    )}
                    {previewResult.pf_applied && (
                      <Badge variant="secondary" className="text-[10px]">PF injected</Badge>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {previewResult.components.map((c, i) => (
                          <tr key={`${c.code}-${i}`} className="border-b border-border/40">
                            <td className="py-1.5 pr-3">
                              <span className="flex items-center gap-1.5">
                                <TypeIcon type={c.component_type} />
                                {c.name}
                              </span>
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                              ₹{c.monthly_amount.toLocaleString('en-IN')}/mo
                            </td>
                            <td className="py-1.5 pl-3 text-right tabular-nums">
                              ₹{c.annual_amount.toLocaleString('en-IN')}/yr
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
