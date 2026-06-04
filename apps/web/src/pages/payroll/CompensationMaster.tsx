/**
 * CompensationMaster — /admin/payroll/compensation
 *
 * Salary structure builder. Admins compose salary structures by assembling
 * salary components (from the component library) with their per-structure
 * calculation rules (fixed amount, % of Basic, % of CTC, % of Gross)
 * and sequencing.
 *
 * Layout: two-panel — structures list (left) + structure detail (right).
 *
 * API:
 *   GET  /payroll/compensation/structures              → list
 *   POST /payroll/compensation/structures              → create
 *   PUT  /payroll/compensation/structures/:id          → update
 *   GET  /payroll/compensation/structures/:id/components → structure components
 *   POST /payroll/compensation/structures/:id/components → add component
 *   DELETE /payroll/compensation/structures/:id/components/:compId → remove
 *   GET  /payroll/compensation/components              → component library
 *
 * Access: hr_admin / super_admin only.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Landmark, Plus, Pencil, Loader2, ShieldAlert,
  ChevronRight, Check, X, Settings2, TrendingUp, TrendingDown, Building2, Trash2, Copy,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { toast }         from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type CalcType     = 'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross' | 'balance'
type ComponentType = 'earning' | 'deduction' | 'employer_contribution'

interface SalaryStructure {
  id:          string
  name:        string
  code:        string
  description: string | null
  is_active:   boolean
  created_at:  string
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
    basic_monthly:                  number
    deductions_monthly:             number
    employer_contributions_monthly: number
    net_monthly:                    number
    net_annual:                     number
  }
  nlc_applied:   boolean
  pf_applied:    boolean
  nlc_wage_pct:  number | null
  ctc_annual:    number
  residual_annual: number
}

interface StructureForm {
  name:        string
  code:        string
  description: string
  is_active:   boolean
}

interface AddComponentForm {
  salary_component_id: string
  calculation_type:    CalcType
  default_value:       string
  sequence:            string
}

const EMPTY_STRUCTURE_FORM: StructureForm = {
  name: '', code: '', description: '', is_active: true,
}

const EMPTY_ADD_FORM: AddComponentForm = {
  salary_component_id: '', calculation_type: 'fixed', default_value: '0', sequence: '0',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CALC_LABELS: Record<CalcType, string> = {
  fixed:        'Fixed (₹/month)',
  pct_of_basic: '% of Basic',
  pct_of_ctc:   '% of CTC',
  pct_of_gross: '% of Gross',
  balance:      'Balance (residual of CTC)',
}

function CalcBadge({ type, value }: { type: CalcType; value: number }) {
  const label =
    type === 'balance' ? 'Balance · residual of CTC'
    : type === 'fixed' ? `₹${value.toLocaleString('en-IN')}/mo`
    : `${value}% of ${type === 'pct_of_basic' ? 'Basic' : type === 'pct_of_ctc' ? 'CTC' : 'Gross'}`
  return <span className="text-xs text-muted-foreground font-mono">{label}</span>
}

function TypeIcon({ type }: { type: ComponentType }) {
  if (type === 'earning')   return <TrendingUp  className="h-3 w-3 text-success" />
  if (type === 'deduction') return <TrendingDown className="h-3 w-3 text-destructive" />
  return <Building2 className="h-3 w-3 text-info" />
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function CompensationMaster() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [selectedId, setSelectedId]           = useState<string | null>(null)
  const [showStructureForm, setShowStructureForm] = useState(false)
  const [editStructureId, setEditStructureId] = useState<string | null>(null)
  const [structureForm, setStructureForm]     = useState<StructureForm>(EMPTY_STRUCTURE_FORM)
  const [showAddDialog, setShowAddDialog]     = useState(false)
  const [addForm, setAddForm]                 = useState<AddComponentForm>(EMPTY_ADD_FORM)
  const [previewCtc, setPreviewCtc]           = useState('1200000')
  const [cloneSource, setCloneSource]         = useState<SalaryStructure | null>(null)
  const [cloneForm, setCloneForm]             = useState({ name: '', code: '' })

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
    onSuccess: () => { invalidateStructures(); resetStructureForm(); toast.success('Structure created') },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const updateStructureMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/payroll/compensation/structures/${id}`, body),
    onSuccess: () => { invalidateStructures(); resetStructureForm(); toast.success('Structure updated') },
    onError: (e: Error) => toast.error('Error', { description: e.message }),
  })

  const addComponentMutation = useMutation({
    mutationFn: (body: object) =>
      api.post(`/payroll/compensation/structures/${selectedId}/components`, body),
    onSuccess: () => {
      invalidateComponents()
      invalidateStructures()
      setShowAddDialog(false)
      setAddForm(EMPTY_ADD_FORM)
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
      setCloneSource(null)
      setCloneForm({ name: '', code: '' })
      if (res?.data?.id) setSelectedId(res.data.id)
      toast.success('Salary group cloned')
    },
    onError: (e: Error) => toast.error('Clone failed', { description: e.message }),
  })

  function startClone(s: SalaryStructure) {
    setCloneSource(s)
    setCloneForm({ name: `${s.name} (Copy)`, code: `${s.code}_COPY` })
  }
  function handleClone() {
    if (!cloneSource || !cloneForm.name || !cloneForm.code) return
    cloneMutation.mutate({ id: cloneSource.id, body: { name: cloneForm.name, code: cloneForm.code } })
  }

  const previewMutation = useMutation<{ data: CtcPreview }, Error, { ctc_annual: number }>({
    mutationFn: (body) => api.post(`/payroll/compensation/structures/${selectedId}/preview`, body),
    onError: (e: Error) => toast.error('Preview failed', { description: e.message }),
  })

  function runPreview() {
    const ctc = parseFloat(previewCtc)
    if (!ctc || ctc <= 0) { toast.error('Enter a valid annual CTC'); return }
    previewMutation.mutate({ ctc_annual: ctc })
  }

  // Reset preview when switching structures so stale numbers never linger
  useEffect(() => { previewMutation.reset() }, [selectedId])  // eslint-disable-line react-hooks/exhaustive-deps
  const previewResult = previewMutation.data?.data ?? null

  // ── Form helpers ─────────────────────────────────────────────────────────────

  function resetStructureForm() {
    setShowStructureForm(false)
    setEditStructureId(null)
    setStructureForm(EMPTY_STRUCTURE_FORM)
  }

  function startEditStructure(s: SalaryStructure) {
    setStructureForm({
      name: s.name, code: s.code,
      description: s.description ?? '',
      is_active: s.is_active,
    })
    setEditStructureId(s.id)
    setShowStructureForm(true)
  }

  function handleStructureSubmit() {
    const body = { ...structureForm, description: structureForm.description || undefined }
    if (editStructureId) updateStructureMutation.mutate({ id: editStructureId, body })
    else                 createStructureMutation.mutate(body)
  }

  function handleAddComponent() {
    addComponentMutation.mutate({
      salary_component_id: addForm.salary_component_id,
      calculation_type:    addForm.calculation_type,
      default_value:       parseFloat(addForm.default_value) || 0,
      sequence:            parseInt(addForm.sequence, 10) || 0,
    })
  }

  const selectedStructure   = structures.find(s => s.id === selectedId)
  const structureIsPending  = createStructureMutation.isPending || updateStructureMutation.isPending
  const sortedComponents    = [...structureComponents].sort((a, b) => a.sequence - b.sequence)

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
        subtitle="Build salary structures by assembling components with calculation rules and sequencing"
        actions={
          <Button size="sm" onClick={() => { resetStructureForm(); setShowStructureForm(v => !v) }}>
            <Plus className="h-4 w-4 mr-1.5" /> New Structure
          </Button>
        }
      />

      {/* ── Structure Create/Edit Form ─────────────────────────────────────── */}
      {showStructureForm && (
        <SectionCard className="mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            {editStructureId ? 'Edit Salary Structure' : 'New Salary Structure'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input value={structureForm.name}
                onChange={e => setStructureForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Senior Engineer CTC" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Code *</label>
              <Input value={structureForm.code}
                onChange={e => setStructureForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. SE_CTC" className="font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input value={structureForm.description}
                onChange={e => setStructureForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Optional description" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" id="struct_active" checked={structureForm.is_active}
                onChange={e => setStructureForm(p => ({ ...p, is_active: e.target.checked }))}
                className="rounded" />
              <label htmlFor="struct_active" className="text-xs font-medium text-muted-foreground cursor-pointer">
                Active
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={handleStructureSubmit}
              disabled={structureIsPending || !structureForm.name || !structureForm.code}>
              {structureIsPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {editStructureId ? 'Update' : 'Create'}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetStructureForm}>Cancel</Button>
          </div>
        </SectionCard>
      )}

      {/* ── Clone panel ───────────────────────────────────────────────────── */}
      {cloneSource && (
        <SectionCard className="mb-4" icon={<Copy className="h-4 w-4 text-muted-foreground" />}
          title={`Clone "${cloneSource.name}" into a new salary group`}
          description="Copies every component and its rule. Edit afterwards as needed.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">New Name *</label>
              <Input value={cloneForm.name}
                onChange={e => setCloneForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Manager CTC" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">New Code *</label>
              <Input value={cloneForm.code}
                onChange={e => setCloneForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                className="font-mono" placeholder="e.g. MGR_CTC" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={handleClone}
              disabled={cloneMutation.isPending || !cloneForm.name || !cloneForm.code}>
              {cloneMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Clone Group
            </Button>
            <Button size="sm" variant="ghost"
              onClick={() => { setCloneSource(null); setCloneForm({ name: '', code: '' }) }}>
              Cancel
            </Button>
          </div>
        </SectionCard>
      )}

      {/* ── Two-panel layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: Structures list ─────────────────────────────────────── */}
        <SectionCard
          title="Salary Structures"
          icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
        >
          {structuresLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            </div>
          ) : structures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <Landmark className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No structures yet.</p>
              <Button size="sm" variant="outline"
                onClick={() => { resetStructureForm(); setShowStructureForm(true) }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create one
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {structures.map(s => {
                const compCount = s.salary_structure_components?.[0]?.count ?? 0
                const isSelected = s.id === selectedId
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                    className={cn(
                      'flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-colors group',
                      isSelected
                        ? 'bg-primary/[0.10] border border-primary/20'
                        : 'hover:bg-muted/50 border border-transparent',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                        {!s.is_active && (
                          <Badge variant="secondary" className="text-[9px] rounded-full shrink-0">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground">{s.code}</span>
                        <span className="text-[10px] text-muted-foreground">
                          · {compCount} component{compCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        title="Edit structure"
                        onClick={e => { e.stopPropagation(); startEditStructure(s) }}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        title="Clone as new salary group"
                        onClick={e => { e.stopPropagation(); startClone(s) }}
                      >
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <ChevronRight className={cn(
                        'h-4 w-4 text-muted-foreground/40 transition-transform',
                        isSelected && 'rotate-90 text-primary',
                      )} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        {/* ── Right: Structure detail ───────────────────────────────────── */}
        <div className="lg:col-span-2">
          {!selectedId ? (
            <SectionCard>
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <Settings2 className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Select a salary structure to view and configure its components.
                </p>
              </div>
            </SectionCard>
          ) : (
            <SectionCard
              title={selectedStructure?.name ?? 'Structure'}
              icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
              action={
                <Button size="sm" variant="outline"
                  onClick={() => { setAddForm(EMPTY_ADD_FORM); setShowAddDialog(v => !v) }}
                  disabled={availableComponents.length === 0 && !showAddDialog}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Component
                </Button>
              }
            >
              {/* Structure meta */}
              {selectedStructure?.description && (
                <p className="text-xs text-muted-foreground mb-3">{selectedStructure.description}</p>
              )}

              {/* Add-component inline form */}
              {showAddDialog && (
                <div className="mb-4 p-3 rounded-md border border-border bg-muted/20">
                  <p className="text-xs font-semibold text-foreground mb-3">Add Component to Structure</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Component *</label>
                      <select value={addForm.salary_component_id}
                        onChange={e => {
                          const picked = availableComponents.find(c => c.id === e.target.value)
                          // Pre-fill the rule from the component's suggested default
                          // so groups aren't reconfigured from scratch each time.
                          setAddForm(p => ({
                            ...p,
                            salary_component_id: e.target.value,
                            calculation_type: picked?.default_calculation_type ?? p.calculation_type,
                            default_value: picked?.default_value != null ? String(picked.default_value) : p.default_value,
                          }))
                        }}
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50">
                        <option value="">Select component…</option>
                        {availableComponents.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.code}) — {
                              c.component_type === 'earning' ? 'Earning' :
                              c.component_type === 'deduction' ? 'Deduction' : 'Employer'
                            }
                          </option>
                        ))}
                      </select>
                      {availableComponents.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          All available components have been added to this structure.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Calculation Type</label>
                      <select value={addForm.calculation_type}
                        onChange={e => setAddForm(p => ({ ...p, calculation_type: e.target.value as CalcType }))}
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50">
                        {Object.entries(CALC_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Default Value {addForm.calculation_type === 'fixed' ? '(₹/month)' : addForm.calculation_type === 'balance' ? '(auto)' : '(%)'}
                      </label>
                      <Input type="number" min={0}
                        value={addForm.calculation_type === 'balance' ? '' : addForm.default_value}
                        disabled={addForm.calculation_type === 'balance'}
                        placeholder={addForm.calculation_type === 'balance' ? 'Residual of CTC' : undefined}
                        onChange={e => setAddForm(p => ({ ...p, default_value: e.target.value }))}
                        className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Sequence <span className="text-muted-foreground/60">(lower runs first)</span>
                      </label>
                      <Input type="number" min={0} value={addForm.sequence}
                        onChange={e => setAddForm(p => ({ ...p, sequence: e.target.value }))}
                        className="h-8 text-xs" placeholder="0" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" className="h-7 text-xs"
                      onClick={handleAddComponent}
                      disabled={!addForm.salary_component_id || addComponentMutation.isPending}>
                      {addComponentMutation.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        : <Check className="h-3 w-3 mr-1" />}
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => setShowAddDialog(false)}>
                      <X className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Components table */}
              {compLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading components…
                </div>
              ) : sortedComponents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <Settings2 className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No components in this structure.</p>
                  <Button size="sm" variant="outline"
                    onClick={() => { setAddForm(EMPTY_ADD_FORM); setShowAddDialog(true) }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add first component
                  </Button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="px-3 pb-2 font-medium text-xs w-12">Seq</th>
                          <th className="px-3 pb-2 font-medium text-xs">Component</th>
                          <th className="px-3 pb-2 font-medium text-xs">Type</th>
                          <th className="px-3 pb-2 font-medium text-xs">Default Calculation</th>
                          <th className="px-3 pb-2 font-medium text-xs text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedComponents.map(sc => (
                          <tr key={sc.id} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2.5">
                              <span className="text-xs font-mono text-muted-foreground">{sc.sequence}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <TypeIcon type={sc.salary_components.component_type} />
                                <div>
                                  <div className="text-xs font-medium text-foreground">
                                    {sc.salary_components.name}
                                  </div>
                                  <div className="text-[10px] font-mono text-muted-foreground">
                                    {sc.salary_components.code}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={cn('text-[10px] font-semibold', {
                                'text-success':     sc.salary_components.component_type === 'earning',
                                'text-destructive': sc.salary_components.component_type === 'deduction',
                                'text-info':        sc.salary_components.component_type === 'employer_contribution',
                              })}>
                                {sc.salary_components.component_type === 'earning'      ? 'Earning'
                                  : sc.salary_components.component_type === 'deduction' ? 'Deduction'
                                  : 'Employer'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <CalcBadge type={sc.calculation_type} value={sc.default_value} />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <Button size="icon" variant="ghost"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                disabled={removeComponentMutation.isPending}
                                onClick={() => removeComponentMutation.mutate(sc.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary footer */}
                  <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
                    {(['earning', 'deduction', 'employer_contribution'] as ComponentType[]).map(t => {
                      const count = sortedComponents.filter(c => c.salary_components.component_type === t).length
                      if (!count) return null
                      const label = t === 'earning' ? 'Earnings'
                        : t === 'deduction' ? 'Deductions'
                        : 'Employer Contrib.'
                      return (
                        <span key={t}>
                          <span className="font-semibold text-foreground">{count}</span>{' '}{label}
                        </span>
                      )
                    })}
                    <span className="ml-auto italic text-[10px]">
                      Calculation order follows sequence — lower numbers run first
                    </span>
                  </div>
                </>
              )}
            </SectionCard>
          )}

          {/* ── Live CTC Preview ─────────────────────────────────────────── */}
          {selectedId && sortedComponents.length > 0 && (
            <SectionCard
              className="mt-4"
              title="Live CTC Preview"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              action={
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} value={previewCtc}
                    onChange={e => setPreviewCtc(e.target.value)}
                    className="h-8 w-36 text-xs"
                    placeholder="Annual CTC"
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
                  Enter a sample annual CTC and click Preview to see the derived breakup using the
                  same engine that computes employee compensation. Nothing is saved.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Sum-to-CTC validator */}
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
                        {within ? <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                                : <X className="h-4 w-4 text-warning mt-0.5 shrink-0" />}
                        <span>
                          {within
                            ? `Earnings sum to CTC (₹${previewResult.totals.gross_annual.toLocaleString('en-IN')}/yr). Balanced.`
                            : residual > 0
                              ? `Under-allocated by ₹${residual.toLocaleString('en-IN')}/yr — add a Balance / Special Allowance component to absorb the residual.`
                              : `Over-allocated by ₹${Math.abs(residual).toLocaleString('en-IN')}/yr — earnings exceed CTC. Reduce a component.`}
                        </span>
                      </div>
                    )
                  })()}

                  {/* Totals strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Gross / mo',     value: previewResult.totals.gross_monthly },
                      { label: 'Deductions / mo', value: previewResult.totals.deductions_monthly },
                      { label: 'Employer / mo',   value: previewResult.totals.employer_contributions_monthly },
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

                  {/* NLC / PF flags */}
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

                  {/* Component lines */}
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
