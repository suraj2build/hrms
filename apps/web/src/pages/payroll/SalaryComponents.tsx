/**
 * SalaryComponents — /admin/payroll/salary-components
 *
 * Salary component library — the building blocks of every CTC structure.
 * Admins define earnings (Basic, HRA, Special Allowance), deductions
 * (PF, PT, TDS), and employer-contribution components here; these are
 * then assembled into Salary Structures in CompensationMaster.
 *
 * Note: calculation_type and default_value belong to salary_structure_components,
 * not salary_components. This page manages the component library only.
 *
 * Access: hr_admin / super_admin only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Layers, Plus, Pencil, Trash2, Loader2, ShieldAlert,
  TrendingUp, TrendingDown, Building2,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

type ComponentType = 'earning' | 'deduction' | 'employer_contribution'
type CalcType = 'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross'

const CALC_LABELS: Record<CalcType, string> = {
  fixed:        'Fixed (₹/month)',
  pct_of_basic: '% of Basic',
  pct_of_ctc:   '% of CTC',
  pct_of_gross: '% of Gross',
}

interface SalaryComponent {
  id:                   string
  name:                 string
  code:                 string
  component_type:       ComponentType
  is_taxable:           boolean
  is_pf_applicable:     boolean
  is_esi_applicable:    boolean
  is_pt_applicable:     boolean
  is_lwf_applicable:    boolean
  is_variable:          boolean
  is_active:            boolean
  display_order:        number
  default_calculation_type: CalcType | null
  default_value:            number | null
  created_at:           string
}

interface ComponentForm {
  name:              string
  code:              string
  component_type:    ComponentType
  is_taxable:        boolean
  is_pf_applicable:  boolean
  is_esi_applicable: boolean
  is_pt_applicable:  boolean
  is_lwf_applicable: boolean
  is_variable:       boolean
  default_calculation_type: CalcType | ''
  default_value:            string
}

const EMPTY_FORM: ComponentForm = {
  name: '', code: '', component_type: 'earning',
  is_taxable: true, is_pf_applicable: false, is_esi_applicable: false,
  is_pt_applicable: false, is_lwf_applicable: false, is_variable: false,
  default_calculation_type: '', default_value: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: ComponentType }) {
  const cfg: Record<ComponentType, { label: string; icon: React.ReactNode; cls: string }> = {
    earning:              { label: 'Earning',     icon: <TrendingUp className="h-3 w-3" />,   cls: 'text-success border-border' },
    deduction:            { label: 'Deduction',   icon: <TrendingDown className="h-3 w-3" />, cls: 'text-destructive border-border' },
    employer_contribution:{ label: 'Employer',    icon: <Building2 className="h-3 w-3" />,    cls: 'text-info border-border' },
  }
  const c = cfg[type]
  return (
    <Badge variant="outline" className={cn('flex items-center gap-1 rounded-full text-[10px]', c.cls)}>
      {c.icon}{c.label}
    </Badge>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SalaryComponents() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [showForm, setShowForm]   = useState(false)
  const [editId, setEditId]       = useState<string | null>(null)
  const [form, setForm]           = useState<ComponentForm>(EMPTY_FORM)
  const [search, setSearch]       = useState('')
  const [typeFilter, setTypeFilter] = useState<ComponentType | 'all'>('all')

  // ── Queries ─────────────────────────────────────────────────────────────────

  // Use a page-specific key to avoid colliding with the readiness-hooks cache
  // (hooks.ts uses ['salary-components'] and stores { data: [...] }, not a plain array)
  const { data: components, isLoading } = useQuery<SalaryComponent[]>({
    queryKey: ['salary-components-mgmt'],
    queryFn:  () => api.get('/masters/salary-components').then((r: any) => {
      const raw = r?.data ?? r
      return Array.isArray(raw) ? raw : (raw?.data ?? [])
    }),
    staleTime: 60_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['salary-components-mgmt'] })
    qc.invalidateQueries({ queryKey: ['salary-components'] })  // also bust readiness cache
  }

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/masters/salary-components', body),
    onSuccess: () => { toast.success('Component created'); invalidate(); resetForm() },
    onError: (e: Error) => { toast.error('Failed to create component', { description: e.message }) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/masters/salary-components/${id}`, body),
    onSuccess: () => { toast.success('Component updated'); invalidate(); resetForm() },
    onError: (e: Error) => { toast.error('Failed to update component', { description: e.message }) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/salary-components/${id}`),
    onSuccess: () => { toast.success('Component deleted'); invalidate() },
    onError: (e: Error) => { toast.error('Failed to delete component', { description: e.message }) },
  })

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false)
    setEditId(null)
    setForm(EMPTY_FORM)
  }

  function startEdit(c: SalaryComponent) {
    setForm({
      name: c.name, code: c.code, component_type: c.component_type,
      is_taxable: c.is_taxable, is_pf_applicable: c.is_pf_applicable,
      is_esi_applicable: c.is_esi_applicable, is_pt_applicable: c.is_pt_applicable,
      is_lwf_applicable: c.is_lwf_applicable, is_variable: c.is_variable,
      default_calculation_type: c.default_calculation_type ?? '',
      default_value:            c.default_value != null ? String(c.default_value) : '',
    })
    setEditId(c.id)
    setShowForm(true)
  }

  function handleSubmit() {
    // Serialize the suggested default rule (both fields together, or both null).
    const hasRule = form.default_calculation_type !== '' && form.default_value !== ''
    const body = {
      ...form,
      default_calculation_type: hasRule ? form.default_calculation_type : null,
      default_value:            hasRule ? Number(form.default_value) : null,
    }
    if (editId) updateMutation.mutate({ id: editId, body })
    else        createMutation.mutate(body)
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  // ── Filter ────────────────────────────────────────────────────────────────────

  const rows = (components ?? []).filter(c => {
    const q = search.toLowerCase()
    const matchQ    = !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    const matchType = typeFilter === 'all' || c.component_type === typeFilter
    return matchQ && matchType
  })

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold">Access Denied</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              You do not have permission to manage salary components.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Salary Components"
        subtitle="Define the building blocks used in salary structures — earnings, deductions, and employer contributions"
        actions={
          <Button size="sm" onClick={() => { resetForm(); setShowForm(v => !v) }}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Component
          </Button>
        }
      />

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      {showForm && (
        <SectionCard className="mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            {editId ? 'Edit Component' : 'New Salary Component'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. House Rent Allowance" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Code *</label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. HRA" className="font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Component Type</label>
              <select value={form.component_type}
                onChange={e => setForm(p => ({ ...p, component_type: e.target.value as ComponentType }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground outline-none focus:ring-1 ring-primary/50">
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
                <option value="employer_contribution">Employer Contribution</option>
              </select>
            </div>

            {/* Suggested default rule — pre-fills the structure builder */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Default Rule <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <select value={form.default_calculation_type}
                onChange={e => setForm(p => ({ ...p, default_calculation_type: e.target.value as CalcType | '' }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground outline-none focus:ring-1 ring-primary/50">
                <option value="">No suggestion</option>
                {(Object.keys(CALC_LABELS) as CalcType[]).map(k => (
                  <option key={k} value={k}>{CALC_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Default {form.default_calculation_type === 'fixed' ? 'Amount (₹/mo)' : 'Value (%)'}
              </label>
              <Input type="number" min={0} value={form.default_value}
                disabled={form.default_calculation_type === ''}
                onChange={e => setForm(p => ({ ...p, default_value: e.target.value }))}
                placeholder={form.default_calculation_type === '' ? '—' : '0'} />
            </div>

            <div className="flex flex-col gap-2 pt-1 sm:col-span-2 lg:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Compliance Flags</label>
              {[
                { key: 'is_taxable',       label: 'Taxable' },
                { key: 'is_pf_applicable', label: 'PF Applicable' },
                { key: 'is_esi_applicable',label: 'ESI Applicable' },
                { key: 'is_pt_applicable', label: 'PT Applicable' },
                { key: 'is_lwf_applicable',label: 'LWF Applicable' },
                { key: 'is_variable',      label: 'Variable (month-to-month)' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={form[key as keyof ComponentForm] as boolean}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.checked }))}
                    className="rounded" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={handleSubmit} disabled={isPending || !form.name || !form.code}>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {editId ? 'Update' : 'Create'}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </SectionCard>
      )}

      {/* ── Filters + Table ───────────────────────────────────────────────── */}
      <SectionCard
        className="mb-4"
        action={
          <div className="flex items-center gap-2">
            <select value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as ComponentType | 'all')}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none">
              <option value="all">All Types</option>
              <option value="earning">Earnings</option>
              <option value="deduction">Deductions</option>
              <option value="employer_contribution">Employer</option>
            </select>
            <Input placeholder="Search components…" value={search}
              onChange={e => setSearch(e.target.value)} className="h-7 text-xs w-48" />
          </div>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {(components ?? []).length === 0
                ? 'No salary components yet. Create your first component above.'
                : 'No components match the current filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Component</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Type</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Compliance Flags</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Variable</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{c.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{c.code}</div>
                    </td>
                    <td className="px-4 py-3"><TypeBadge type={c.component_type} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.is_taxable       && <Badge variant="secondary" className="text-[10px] rounded-full">Taxable</Badge>}
                        {c.is_pf_applicable && <Badge variant="outline"   className="text-[10px] rounded-full">PF</Badge>}
                        {c.is_esi_applicable&& <Badge variant="outline"   className="text-[10px] rounded-full">ESI</Badge>}
                        {c.is_pt_applicable && <Badge variant="outline"   className="text-[10px] rounded-full">PT</Badge>}
                        {c.is_lwf_applicable&& <Badge variant="outline"   className="text-[10px] rounded-full">LWF</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.is_variable
                        ? <Badge variant="warning" className="text-[10px] rounded-full">Variable</Badge>
                        : <span className="text-xs text-muted-foreground">Fixed</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
