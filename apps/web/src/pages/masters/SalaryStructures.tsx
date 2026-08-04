/**
 * Salary Structures — /masters/salary-structures
 *
 * Lists all salary structures for the tenant.
 * Each structure acts as a template grouping salary components
 * (Basic, HRA, etc.) with their calculation rules.
 * Structures are assigned to employees via the Compensation Master.
 */
import { useState }                               from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import {
  GitMerge, Plus, Pencil, Trash2, Loader2,
  ChevronRight, ChevronDown, Layers, Star,
} from 'lucide-react'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { Badge }          from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
}                         from '@/components/ui/dialog'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SalaryComponent {
  id:             string
  name:           string
  code:           string
  component_type: string
}

interface StructureComponent {
  id:                  string
  salary_component_id: string
  calculation_type:    'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross'
  default_value:       number
  sequence:            number
  is_active:           boolean
  salary_components:   SalaryComponent
}

interface SalaryStructure {
  id:          string
  code:        string
  name:        string
  description: string | null
  is_active:   boolean
  is_default:  boolean
  version:     number
  created_at:  string
  salary_structure_components: StructureComponent[]
}

const CALC_LABELS: Record<string, string> = {
  fixed:          'Fixed (₹)',
  pct_of_basic:   '% of Basic',
  pct_of_ctc:     '% of CTC',
  pct_of_gross:   '% of Gross',
}

const EMPTY = { name: '', code: '', description: '', is_active: true }

// ── Component ─────────────────────────────────────────────────────────────────

export function SalaryStructures() {
  const qc                      = useQueryClient()
  const { profile }             = useAuthStore()
  const isAdmin                 = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen, setDlgOpen]   = useState(false)
  const [editItem, setEditItem] = useState<SalaryStructure | null>(null)
  const [form, setForm]         = useState(EMPTY)
  const [err, setErr]           = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery<{ data: SalaryStructure[] }>({
    queryKey: ['salary-structures'],
    queryFn:  () => api.get('/masters/salary-structures'),
    staleTime: 60_000,
  })
  const structures = data?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY)
    setErr('')
    setDlgOpen(true)
  }

  function openEdit(s: SalaryStructure) {
    setEditItem(s)
    setForm({
      name:        s.name,
      code:        s.code,
      description: s.description ?? '',
      is_active:   s.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const versionConflict = useVersionConflict([['salary-structures'], ['salary-structures-list']])

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY) => {
      const payload = {
        name:        body.name,
        code:        body.code.toUpperCase().trim(),
        description: body.description || null,
        is_active:   body.is_active,
      }
      return editItem
        ? api.put(`/masters/salary-structures/${editItem.id}`, withExpectedVersion(payload, editItem))
        : api.post('/masters/salary-structures', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-structures'] })
      // EmployeeProfile's Setup Compensation dialog reads the same list under
      // a separate key.
      qc.invalidateQueries({ queryKey: ['salary-structures-list'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Structure updated' : 'Structure created')
    },
    onError: (e: Error) => {
      if (versionConflict(e)) return
      setErr(e.message ?? 'Failed to save')
      toast.error('Save failed', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/salary-structures/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-structures'] })
      qc.invalidateQueries({ queryKey: ['salary-structures-list'] })
      toast.success('Structure deleted')
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  const setDefaultMut = useMutation({
    mutationFn: (structure: SalaryStructure) =>
      api.put(`/masters/salary-structures/${structure.id}`, withExpectedVersion({ is_default: true }, structure)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-structures'] })
      qc.invalidateQueries({ queryKey: ['salary-structures-list'] })
      toast.success('Default structure updated')
    },
    onError: (e: Error) => {
      if (versionConflict(e)) return
      toast.error('Failed to set default', { description: e.message })
    },
  })

  return (
    <PageContainer>
      <PageHeader
        title="Salary Structures"
        subtitle="Define pay templates — group salary components with their calculation rules"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Structure</Button>
            : undefined
        }
      />

      <SectionCard title="All Structures" icon={<GitMerge className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : structures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <GitMerge className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No salary structures configured yet.</p>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />Create your first structure
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {structures.map(s => {
              const isOpen = expanded.has(s.id)
              const comps  = s.salary_structure_components ?? []
              const activeComps = comps.filter(c => c.is_active)

              return (
                <div key={s.id}>
                  {/* Structure row */}
                  <div className="flex items-center gap-3 px-3 py-3 hover:bg-muted/20 transition-colors">
                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleExpand(s.id)}
                      className="text-muted-foreground/60 hover:text-muted-foreground shrink-0"
                    >
                      {isOpen
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />
                      }
                    </button>

                    <Badge variant="outline" className="rounded-full text-xs font-mono shrink-0">
                      {s.code}
                    </Badge>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{s.name}</p>
                      {s.description && (
                        <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                      )}
                    </div>

                    {/* Component count chip */}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Layers className="h-3 w-3" />
                      {activeComps.length} component{activeComps.length !== 1 ? 's' : ''}
                    </span>

                    {s.is_default && (
                      <Badge
                        variant="default"
                        className="rounded-full text-xs shrink-0 bg-[#15B8A6] text-white border-0"
                      >
                        <Star className="h-2.5 w-2.5 mr-1 fill-current" />
                        Default
                      </Badge>
                    )}

                    <Badge
                      variant={s.is_active ? 'success' : 'secondary'}
                      className="rounded-full text-xs shrink-0"
                    >
                      {s.is_active ? 'Active' : 'Inactive'}
                    </Badge>

                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0">
                        {!s.is_default && s.is_active && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-[#15B8A6]"
                            title="Set as default"
                            disabled={setDefaultMut.isPending}
                            onClick={() => setDefaultMut.mutate(s)}
                          >
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete "${s.name}"?`)) delMut.mutate(s.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Expanded — component list */}
                  {isOpen && (
                    <div className="bg-muted/10 border-t border-border/30 px-10 py-2">
                      {comps.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2 italic">
                          No components mapped. Use the Compensation Master to add components.
                        </p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground/60 uppercase tracking-wide text-[10px]">
                              <th className="text-left py-1.5 w-8">#</th>
                              <th className="text-left py-1.5">Component</th>
                              <th className="text-left py-1.5">Type</th>
                              <th className="text-left py-1.5">Calculation</th>
                              <th className="text-right py-1.5">Value</th>
                              <th className="text-left py-1.5 pl-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {[...comps].sort((a, b) => a.sequence - b.sequence).map(c => (
                              <tr key={c.id} className="text-foreground/80">
                                <td className="py-1.5 tabular-nums text-muted-foreground">{c.sequence}</td>
                                <td className="py-1.5 font-medium">{c.salary_components.name}</td>
                                <td className="py-1.5">
                                  <Badge variant="outline" className="text-[10px] rounded px-1 py-0 font-mono">
                                    {c.salary_components.component_type}
                                  </Badge>
                                </td>
                                <td className="py-1.5 text-muted-foreground">
                                  {CALC_LABELS[c.calculation_type] ?? c.calculation_type}
                                </td>
                                <td className="py-1.5 text-right tabular-nums">
                                  {c.calculation_type === 'fixed'
                                    ? `₹${c.default_value.toLocaleString('en-IN')}`
                                    : `${c.default_value}%`}
                                </td>
                                <td className="py-1.5 pl-3">
                                  <Badge
                                    variant={c.is_active ? 'success' : 'secondary'}
                                    className="text-[10px] rounded-full px-1.5"
                                  >
                                    {c.is_active ? 'On' : 'Off'}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Create / Edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Structure' : 'New Salary Structure'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Standard Monthly"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Code *</label>
              <Input
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. STD-MON"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Standard salary structure for full-time employees"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ss-active"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5"
              />
              <label htmlFor="ss-active" className="text-xs text-muted-foreground">Active</label>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !form.name.trim() || !form.code.trim()}
              onClick={() => saveMut.mutate(form)}
            >
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
