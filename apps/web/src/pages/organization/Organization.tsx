import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, GitBranch, ChevronRight, ChevronDown, Loader2, Pencil, Briefcase,
  Layers, Trash2, Users, FileText,
} from 'lucide-react'
import { OrgGovernancePanel }  from '@/components/org/OrgGovernancePanel'
import { ReadinessGuidance }   from '@/components/readiness/ReadinessGuidance'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { MergeDeleteDialog } from '@/components/ui/merge-delete-dialog'
import type { Department, Designation, Grade } from '@/types'

// ── Schemas ──────────────────────────────────────────────────────────────────
const deptSchema = z.object({
  name: z.string().min(1, 'Required'),
  parent_id: z.string().optional(),
})

const desigSchema = z.object({
  name: z.string().min(1, 'Required'),
})

const gradeSchema = z.object({
  name: z.string().min(1, 'Required'),
  min_salary: z.coerce.number().optional(),
  max_salary: z.coerce.number().optional(),
})

type DeptForm = z.infer<typeof deptSchema>
type DesigForm = z.infer<typeof desigSchema>
type GradeForm = z.infer<typeof gradeSchema>

// ── Employment Type definitions ──────────────────────────────────────────────
const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Permanent', color: 'text-success border-success/30 bg-success/10',           desc: 'Full-time, indefinite employment with all statutory benefits.' },
  { value: 'contract',  label: 'Contract',  color: 'text-info border-info/30 bg-info/10',                    desc: 'Fixed-term contract engagement. Renewed or closed at term end.' },
  { value: 'probation', label: 'Probation', color: 'text-warning border-warning/30 bg-warning/10',           desc: 'Trial period before confirmation into permanent role.' },
  { value: 'intern',    label: 'Intern',    color: 'text-primary border-primary/30 bg-primary/10',           desc: 'Short-term internship / apprenticeship engagement.' },
]

// ── Document Type definitions ────────────────────────────────────────────────
const DOCUMENT_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card', desc: 'Government-issued biometric ID (12-digit UID). Mandatory for PF/ESI.' },
  { value: 'pan', label: 'PAN Card', desc: 'Permanent Account Number issued by Income Tax Dept. Required for TDS.' },
  { value: 'offer_letter', label: 'Offer Letter', desc: 'Formal offer of employment sent to candidate before joining.' },
  { value: 'contract', label: 'Employment Contract', desc: 'Signed employment agreement covering terms, compensation, and clauses.' },
  { value: 'certificate', label: 'Certificate / Degree', desc: 'Educational qualification or professional certification documents.' },
  { value: 'relieving_letter', label: 'Relieving Letter', desc: 'Issued by previous employer confirming last working day.' },
  { value: 'experience_letter', label: 'Experience Letter', desc: 'Letter confirming duration and role of previous employment.' },
  { value: 'other', label: 'Other', desc: 'Any other document that does not fit the above categories.' },
]

// ── Department tree node ─────────────────────────────────────────────────────
function DeptNode({
  dept, level = 0, onEdit, onDelete,
}: {
  dept: Department
  level?: number
  onEdit: (dept: Department) => void
  onDelete: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = dept.children && dept.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/30 cursor-pointer group transition-colors"
        style={{ paddingLeft: `${12 + level * 20}px` }}
        onClick={() => setOpen(!open)}
      >
        {hasChildren ? (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <div className="w-3.5" />
        )}
        <GitBranch className="h-4 w-4 text-info flex-shrink-0" />
        <span className="text-sm font-medium">{dept.name}</span>
        {dept.code && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1">{dept.code}</Badge>
        )}
        <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={(e) => { e.stopPropagation(); onEdit(dept) }}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={(e) => { e.stopPropagation(); onDelete(dept.id, dept.name) }}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </div>
      </div>
      {open && hasChildren && (
        <div>
          {dept.children!.map((child) => (
            <DeptNode key={child.id} dept={child} level={level + 1} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export function Organization() {
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()

  if (!['super_admin', 'hr_admin'].includes(profile?.role ?? '')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-sm text-muted-foreground font-medium">Access restricted to HR administrators.</p>
      </div>
    )
  }

  // Dialog states
  const [deptAddOpen, setDeptAddOpen] = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [desigAddOpen, setDesigAddOpen] = useState(false)
  const [editingDesig, setEditingDesig] = useState<Designation | null>(null)
  const [gradeAddOpen, setGradeAddOpen] = useState(false)
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null)

  // Delete / merge-delete state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'dept' | 'desig' | 'grade'; id: string; name: string } | null>(null)

  // Queries
  const { data: deptData, isLoading: deptLoading } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments'),
  })
  const { data: desigData } = useQuery<{ data: Designation[] }>({
    queryKey: ['designations'],
    queryFn: () => api.get('/designations'),
  })
  const { data: gradeData } = useQuery<{ data: Grade[] }>({
    queryKey: ['grades'],
    queryFn: () => api.get('/grades'),
  })

  // Forms
  const deptAddForm = useForm<DeptForm>({ resolver: zodResolver(deptSchema) })
  const deptEditForm = useForm<DeptForm>({ resolver: zodResolver(deptSchema) })
  const desigAddForm = useForm<DesigForm>({ resolver: zodResolver(desigSchema) })
  const desigEditForm = useForm<DesigForm>({ resolver: zodResolver(desigSchema) })
  const gradeAddForm = useForm<GradeForm>({ resolver: zodResolver(gradeSchema) })
  const gradeEditForm = useForm<GradeForm>({ resolver: zodResolver(gradeSchema) })

  // Watched value for controlled select in edit dept form
  const deptEditW = deptEditForm.watch()

  function openEditDept(d: Department) {
    deptEditForm.reset({ name: d.name, parent_id: d.parent_id ?? '' })
    setEditingDept(d)
  }
  function openEditDesig(d: Designation) {
    desigEditForm.reset({ name: d.name })
    setEditingDesig(d)
  }
  function openEditGrade(g: Grade) {
    gradeEditForm.reset({ name: g.name, min_salary: g.min_salary, max_salary: g.max_salary })
    setEditingGrade(g)
  }

  // Strip empty-string optional fields before sending — empty string fails UUID validation on parent_id
  function cleanDept(data: DeptForm) {
    return {
      name:       data.name,
      ...(data.parent_id ? { parent_id: data.parent_id } : {}),
    }
  }

  // ── Dept mutations ──
  const createDept = useMutation({
    mutationFn: (data: DeptForm) => api.post('/departments', cleanDept(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department created')
      setDeptAddOpen(false)
      deptAddForm.reset()
    },
    onError: (e: Error) => toast.error('Failed to create department', { description: e.message }),
  })
  const updateDept = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DeptForm }) => api.put(`/departments/${id}`, cleanDept(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); toast.success('Department updated'); setEditingDept(null) },
    onError: (e: Error) => toast.error('Failed to update department', { description: e.message }),
  })
  const deleteDept = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/departments/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Department deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Cannot delete department', { description: e.message }),
  })

  // ── Desig mutations ──
  function cleanDesig(data: DesigForm) {
    return { name: data.name }
  }

  const createDesig = useMutation({
    mutationFn: (data: DesigForm) => api.post('/designations', cleanDesig(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['designations'] }); toast.success('Designation created'); setDesigAddOpen(false); desigAddForm.reset() },
    onError: (e: Error) => toast.error('Failed to create designation', { description: e.message }),
  })
  const updateDesig = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DesigForm }) => api.put(`/designations/${id}`, cleanDesig(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['designations'] }); toast.success('Designation updated'); setEditingDesig(null) },
    onError: (e: Error) => toast.error('Failed to update designation', { description: e.message }),
  })
  const deleteDesig = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/designations/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['designations'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Designation deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Cannot delete designation', { description: e.message }),
  })

  // ── Grade mutations ──
  const createGrade = useMutation({
    mutationFn: (data: GradeForm) => api.post('/grades', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      toast.success('Grade created')
      setGradeAddOpen(false)
      gradeAddForm.reset()
    },
    onError: (e: Error) => toast.error('Failed to create grade', { description: e.message }),
  })
  const updateGrade = useMutation({
    mutationFn: ({ id, data }: { id: string; data: GradeForm }) => api.put(`/grades/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['grades'] }); toast.success('Grade updated'); setEditingGrade(null) },
    onError: (e: Error) => toast.error('Failed to update grade', { description: e.message }),
  })
  const deleteGrade = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/grades/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      queryClient.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Grade deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Cannot delete grade', { description: e.message }),
  })

  // Build tree from flat list
  function buildTree(depts: Department[]): Department[] {
    const map = new Map<string, Department>()
    const roots: Department[] = []
    depts.forEach((d) => map.set(d.id, { ...d, children: [] }))
    map.forEach((d) => {
      if (d.parent_id && map.has(d.parent_id)) {
        map.get(d.parent_id)!.children!.push(d)
      } else {
        roots.push(d)
      }
    })
    return roots
  }

  const tree = buildTree(deptData?.data ?? [])

  // ── Shared form fields ──
  // For Add dialogs (no pre-fill needed, use defaultValue="")
  function DeptAddFields() {
    return (
      <>
        <div className="space-y-1.5">
          <Label>Department Name *</Label>
          <Input placeholder="e.g. Engineering" {...deptAddForm.register('name')} />
          {deptAddForm.formState.errors.name && <p className="text-xs text-destructive">{deptAddForm.formState.errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Parent Department</Label>
          <Select onValueChange={(v) => deptAddForm.setValue('parent_id', v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Root level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Root level</SelectItem>
              {deptData?.data?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </>
    )
  }

  function DesigAddFields() {
    return (
      <>
        <div className="space-y-1.5">
          <Label>Designation Name *</Label>
          <Input placeholder="e.g. Senior Engineer" {...desigAddForm.register('name')} />
          {desigAddForm.formState.errors.name && <p className="text-xs text-destructive">{desigAddForm.formState.errors.name.message}</p>}
        </div>
      </>
    )
  }

  function GradeAddFields() {
    return (
      <>
        <div className="space-y-1.5">
          <Label>Grade Name *</Label>
          <Input placeholder="e.g. L5" {...gradeAddForm.register('name')} />
          {gradeAddForm.formState.errors.name && <p className="text-xs text-destructive">{gradeAddForm.formState.errors.name.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Min CTC (₹)</Label>
            <Input type="number" placeholder="500000" {...gradeAddForm.register('min_salary')} />
          </div>
          <div className="space-y-1.5">
            <Label>Max CTC (₹)</Label>
            <Input type="number" placeholder="1000000" {...gradeAddForm.register('max_salary')} />
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Organization</h1>
          <p className="text-sm text-muted-foreground">Manage departments, designations, grades, and master data</p>
        </div>
        {/* Org hierarchy summary — links to Sites / Work Locations / Cost Centers */}
        <OrgGovernancePanel className="shrink-0 w-56" />
      </div>

      {/* Org readiness — only shown when there are issues */}
      <ReadinessGuidance domain="organization" issueOnly />

      <Tabs defaultValue="departments">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="designations">Designations</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="employment-types">Employment Types</TabsTrigger>
          <TabsTrigger value="document-types">Document Types</TabsTrigger>
        </TabsList>

        {/* ── DEPARTMENTS ── */}
        <TabsContent value="departments" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                Department Hierarchy ({deptData?.data?.length ?? 0})
              </CardTitle>
              <Button size="sm" onClick={() => setDeptAddOpen(true)} className="h-8">
                <Plus className="h-4 w-4 mr-1" /> Add Department
              </Button>
            </CardHeader>
            <CardContent className="p-2">
              {deptLoading ? (
                <div className="space-y-2 p-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-9 bg-muted rounded animate-pulse" />)}
                </div>
              ) : tree.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  No departments yet.{' '}
                  <button onClick={() => setDeptAddOpen(true)} className="text-primary hover:underline">
                    Add your first department
                  </button>
                </div>
              ) : (
                tree.map((d) => (
                  <DeptNode
                    key={d.id} dept={d}
                    onEdit={(dept) => openEditDept(dept)}
                    onDelete={(id, name) => setDeleteTarget({ type: 'dept', id, name })}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DESIGNATIONS ── */}
        <TabsContent value="designations" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                Designations ({desigData?.data?.length ?? 0})
              </CardTitle>
              <Button size="sm" onClick={() => setDesigAddOpen(true)} className="h-8">
                <Plus className="h-4 w-4 mr-1" /> Add Designation
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(desigData?.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No designations yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Name</th>
                      <th className="px-4 py-2.5 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {desigData?.data?.map((d) => (
                      <tr key={d.id} className="border-b border-border hover:bg-muted/30 group">
                        <td className="px-4 py-2.5 font-medium">{d.name}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDesig(d)}>
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setDeleteTarget({ type: 'desig', id: d.id, name: d.name })}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── GRADES ── */}
        <TabsContent value="grades" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                Pay Grades ({gradeData?.data?.length ?? 0})
              </CardTitle>
              <Button size="sm" onClick={() => setGradeAddOpen(true)} className="h-8">
                <Plus className="h-4 w-4 mr-1" /> Add Grade
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(gradeData?.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No grades yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Grade</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Code</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Min CTC</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Max CTC</th>
                      <th className="px-4 py-2.5 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {gradeData?.data?.map((g) => (
                      <tr key={g.id} className="border-b border-border hover:bg-muted/30 group">
                        <td className="px-4 py-2.5 font-medium">{g.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{g.code ?? '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {g.min_salary ? `₹${g.min_salary.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {g.max_salary ? `₹${g.max_salary.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditGrade(g)}>
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setDeleteTarget({ type: 'grade', id: g.id, name: g.name })}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── EMPLOYMENT TYPES ── */}
        <TabsContent value="employment-types" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Employment Types
                <span className="text-xs font-normal text-muted-foreground ml-1">(System-defined)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Type</th>
                    <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <tr key={t.value} className="border-b border-border hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Badge className={`text-xs border ${t.color}`}>{t.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DOCUMENT TYPES ── */}
        <TabsContent value="document-types" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Document Types
                <span className="text-xs font-normal text-muted-foreground ml-1">(System-defined)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Type</th>
                    <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-semibold uppercase">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {DOCUMENT_TYPES.map((t) => (
                    <tr key={t.value} className="border-b border-border hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">{t.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Add Department Dialog ── */}
      <Dialog open={deptAddOpen} onOpenChange={setDeptAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Department</DialogTitle></DialogHeader>
          <form onSubmit={deptAddForm.handleSubmit((d) => createDept.mutate(d))} className="space-y-4">
            <DeptAddFields />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeptAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createDept.isPending}>
                {createDept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Department Dialog ── */}
      <Dialog open={!!editingDept} onOpenChange={(o) => !o && setEditingDept(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Department</DialogTitle></DialogHeader>
          <form onSubmit={deptEditForm.handleSubmit((d) => updateDept.mutate({ id: editingDept!.id, data: d }))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Department Name *</Label>
              <Input placeholder="e.g. Engineering" {...deptEditForm.register('name')} />
              {deptEditForm.formState.errors.name && <p className="text-xs text-destructive">{deptEditForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Parent Department</Label>
              <Select
                value={deptEditW.parent_id || 'none'}
                onValueChange={(v) => deptEditForm.setValue('parent_id', v === 'none' ? '' : v)}
              >
                <SelectTrigger><SelectValue placeholder="Root level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Root level</SelectItem>
                  {deptData?.data?.filter(d => d.id !== editingDept?.id).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingDept(null)}>Cancel</Button>
              <Button type="submit" disabled={updateDept.isPending}>
                {updateDept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add Designation Dialog ── */}
      <Dialog open={desigAddOpen} onOpenChange={setDesigAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Designation</DialogTitle></DialogHeader>
          <form onSubmit={desigAddForm.handleSubmit((d) => createDesig.mutate(d))} className="space-y-4">
            <DesigAddFields />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDesigAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createDesig.isPending}>
                {createDesig.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Designation Dialog ── */}
      <Dialog open={!!editingDesig} onOpenChange={(o) => !o && setEditingDesig(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Designation</DialogTitle></DialogHeader>
          <form onSubmit={desigEditForm.handleSubmit((d) => updateDesig.mutate({ id: editingDesig!.id, data: d }))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Designation Name *</Label>
              <Input placeholder="e.g. Senior Engineer" {...desigEditForm.register('name')} />
              {desigEditForm.formState.errors.name && <p className="text-xs text-destructive">{desigEditForm.formState.errors.name.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingDesig(null)}>Cancel</Button>
              <Button type="submit" disabled={updateDesig.isPending}>
                {updateDesig.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add Grade Dialog ── */}
      <Dialog open={gradeAddOpen} onOpenChange={setGradeAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Pay Grade</DialogTitle></DialogHeader>
          <form onSubmit={gradeAddForm.handleSubmit((d) => createGrade.mutate(d))} className="space-y-4">
            <GradeAddFields />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGradeAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createGrade.isPending}>
                {createGrade.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Grade Dialog ── */}
      <Dialog open={!!editingGrade} onOpenChange={(o) => !o && setEditingGrade(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Pay Grade</DialogTitle></DialogHeader>
          <form onSubmit={gradeEditForm.handleSubmit((d) => updateGrade.mutate({ id: editingGrade!.id, data: d }))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Grade Name *</Label>
              <Input placeholder="e.g. L5" {...gradeEditForm.register('name')} />
              {gradeEditForm.formState.errors.name && <p className="text-xs text-destructive">{gradeEditForm.formState.errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Min CTC (₹)</Label>
                <Input type="number" placeholder="500000" {...gradeEditForm.register('min_salary')} />
              </div>
              <div className="space-y-1.5">
                <Label>Max CTC (₹)</Label>
                <Input type="number" placeholder="1000000" {...gradeEditForm.register('max_salary')} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingGrade(null)}>Cancel</Button>
              <Button type="submit" disabled={updateGrade.isPending}>
                {updateGrade.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Merge-Delete Dialog ── */}
      {deleteTarget && (
        <MergeDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          entityType={
            deleteTarget.type === 'dept' ? 'Department'
            : deleteTarget.type === 'desig' ? 'Designation'
            : 'Grade'
          }
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={
            deleteTarget.type === 'dept'  ? `/departments/${deleteTarget.id}/usage`
            : deleteTarget.type === 'desig' ? `/designations/${deleteTarget.id}/usage`
            : `/grades/${deleteTarget.id}/usage`
          }
          usageLabel={
            deleteTarget.type === 'dept'
              ? 'employees / child departments'
              : 'employee records'
          }
          mergeOptions={
            deleteTarget.type === 'dept'
              ? (deptData?.data ?? []).filter(d => d.id !== deleteTarget.id).map(d => ({ id: d.id, name: d.name }))
              : deleteTarget.type === 'desig'
                ? (desigData?.data ?? []).filter(d => d.id !== deleteTarget.id).map(d => ({ id: d.id, name: d.name }))
                : (gradeData?.data ?? []).filter(g => g.id !== deleteTarget.id).map(g => ({ id: g.id, name: g.name }))
          }
          onConfirm={(mergeTo) => {
            if (deleteTarget.type === 'dept')  deleteDept.mutate({ id: deleteTarget.id, mergeTo })
            if (deleteTarget.type === 'desig') deleteDesig.mutate({ id: deleteTarget.id, mergeTo })
            if (deleteTarget.type === 'grade') deleteGrade.mutate({ id: deleteTarget.id, mergeTo })
          }}
          isPending={deleteDept.isPending || deleteDesig.isPending || deleteGrade.isPending}
        />
      )}
    </div>
  )
}
