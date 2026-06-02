/**
 * OnboardingModule — Admin Page
 *
 * Tabs:
 *  1. Checklist Templates — manage reusable onboarding checklist templates + items
 *  2. Employee Onboarding — track onboarding status per employee, assign checklists
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, ChevronDown, ChevronRight, Trash2, Eye,
  ClipboardList, Users, CheckCircle2, Circle, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChecklistTemplate {
  id: string
  name: string
  description: string | null
  is_default: boolean
  item_count: number
  created_at: string
}

interface ChecklistItem {
  id: string
  template_id: string
  title: string
  description: string | null
  category: string
  assigned_to_role: string | null
  due_day_offset: number
  is_mandatory: boolean
}

interface EmployeeBasic {
  id: string
  full_name: string
  employee_code: string
  departments?: { name: string } | null
  joining_date?: string | null
}

interface EmployeeChecklist {
  id: string
  employee_id: string
  template_id: string
  assigned_at: string
  employee: {
    id: string
    full_name: string
    employee_code: string
    joining_date: string | null
    departments?: { name: string } | null
  }
  template: {
    id: string
    name: string
  }
  total_tasks: number
  completed_tasks: number
  status: 'not_started' | 'in_progress' | 'completed' | 'overdue'
}

interface EmployeeTask {
  id: string
  checklist_id: string
  title: string
  description: string | null
  category: string
  assigned_to_role: string | null
  due_date: string | null
  is_mandatory: boolean
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  completed_at: string | null
  notes: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ITEM_CATEGORIES = [
  { value: 'documentation', label: 'Documentation' },
  { value: 'it_setup', label: 'IT Setup' },
  { value: 'training', label: 'Training' },
  { value: 'hr_formalities', label: 'HR Formalities' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other', label: 'Other' },
]

const ROLE_OPTIONS = [
  { value: 'hr', label: 'HR' },
  { value: 'manager', label: 'Manager' },
  { value: 'it', label: 'IT' },
  { value: 'employee', label: 'Employee' },
  { value: 'finance', label: 'Finance' },
  { value: 'admin', label: 'Admin' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function categoryLabel(cat: string): string {
  return ITEM_CATEGORIES.find(c => c.value === cat)?.label ?? cat
}

function categoryColor(cat: string): string {
  const map: Record<string, string> = {
    documentation: 'bg-blue-100 text-blue-700',
    it_setup: 'bg-purple-100 text-purple-700',
    training: 'bg-amber-100 text-amber-700',
    hr_formalities: 'bg-rose-100 text-rose-700',
    compliance: 'bg-red-100 text-red-700',
    orientation: 'bg-teal-100 text-teal-700',
    equipment: 'bg-orange-100 text-orange-700',
    other: 'bg-gray-100 text-gray-600',
  }
  return map[cat] ?? 'bg-gray-100 text-gray-600'
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    not_started: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-600',
    skipped: 'bg-yellow-100 text-yellow-700',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
    overdue: 'Overdue',
    pending: 'Pending',
    skipped: 'Skipped',
  }
  return map[status] ?? status
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// ---- TemplateRow -------------------------------------------------------

interface TemplateRowProps {
  template: ChecklistTemplate
  onAddItem: (templateId: string) => void
  onDeleteItem: (itemId: string) => void
}

function TemplateRow({ template, onAddItem, onDeleteItem }: TemplateRowProps) {
  const [expanded, setExpanded] = useState(false)

  const { data: itemsResp, isLoading } = useQuery<{ data: ChecklistItem[] }>({
    queryKey: ['onboarding-template-items', template.id],
    queryFn: () => api.get(`/onboarding/templates/${template.id}/items`),
    enabled: expanded,
  })
  const items = itemsResp?.data ?? []

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/40 transition-colors text-left"
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="flex-1 font-medium text-sm text-foreground">{template.name}</span>
        {template.is_default && (
          <Badge className="bg-primary/10 text-primary border-0 text-xs">Default</Badge>
        )}
        <Badge variant="secondary" className="text-xs">
          {template.item_count} item{template.item_count !== 1 ? 's' : ''}
        </Badge>
        {template.description && (
          <span className="text-xs text-muted-foreground truncate max-w-xs hidden md:block">
            {template.description}
          </span>
        )}
      </button>

      {/* Expanded items */}
      {expanded && (
        <div className="border-t border-border bg-muted/20">
          {isLoading ? (
            <div className="px-6 py-4 text-sm text-muted-foreground">Loading items…</div>
          ) : !items?.length ? (
            <div className="px-6 py-4 text-sm text-muted-foreground">No items yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Assigned To</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Due Day</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Mandatory</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium text-foreground">{item.title}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', categoryColor(item.category))}>
                        {categoryLabel(item.category)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground capitalize">
                      {item.assigned_to_role ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      Day {item.due_day_offset}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.is_mandatory ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onDeleteItem(item.id)}
                        className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                        title="Delete item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="px-4 py-2 border-t border-border">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAddItem(template.id)}
              className="text-xs h-7 gap-1.5 text-primary hover:text-primary hover:bg-primary/10"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Item
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab 1: Checklist Templates ─────────────────────────────────────────────────

function ChecklistTemplatesTab() {
  const qc = useQueryClient()

  // New template dialog
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')

  // New item dialog
  const [addItemTemplateId, setAddItemTemplateId] = useState<string | null>(null)
  const [itemTitle, setItemTitle] = useState('')
  const [itemDesc, setItemDesc] = useState('')
  const [itemCategory, setItemCategory] = useState('documentation')
  const [itemRole, setItemRole] = useState('hr')
  const [itemDueDay, setItemDueDay] = useState(1)
  const [itemMandatory, setItemMandatory] = useState(true)

  const { data: templatesResp, isLoading } = useQuery<{ data: ChecklistTemplate[] }>({
    queryKey: ['onboarding-templates'],
    queryFn: () => api.get('/onboarding/templates'),
  })
  const templates = templatesResp?.data ?? []

  const seedTemplates = useMutation({
    mutationFn: () => api.post('/onboarding/seed-default-templates', {}),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['onboarding-templates'] })
      toast.success(res?.message ?? 'Default templates seeded')
    },
    onError: () => toast.error('Failed to seed templates'),
  })

  const createTemplate = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.post('/onboarding/templates', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-templates'] })
      toast.success('Template created')
      setShowNewTemplate(false)
      setTemplateName('')
      setTemplateDesc('')
    },
    onError: () => toast.error('Failed to create template'),
  })

  const createItem = useMutation({
    mutationFn: (body: {
      template_id: string
      title: string
      description: string
      category: string
      assigned_to_role: string
      due_day_offset: number
      is_mandatory: boolean
    }) => api.post(`/onboarding/templates/${body.template_id}/items`, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['onboarding-template-items', vars.template_id] })
      qc.invalidateQueries({ queryKey: ['onboarding-templates'] })
      toast.success('Item added')
      setAddItemTemplateId(null)
      resetItemForm()
    },
    onError: () => toast.error('Failed to add item'),
  })

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/onboarding/template-items/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-templates'] })
      // invalidate all template item lists
      qc.invalidateQueries({ queryKey: ['onboarding-template-items'] })
      toast.success('Item deleted')
    },
    onError: () => toast.error('Failed to delete item'),
  })

  function resetItemForm() {
    setItemTitle('')
    setItemDesc('')
    setItemCategory('documentation')
    setItemRole('hr')
    setItemDueDay(1)
    setItemMandatory(true)
  }

  function handleAddItem(templateId: string) {
    setAddItemTemplateId(templateId)
    resetItemForm()
  }

  function handleCreateItem() {
    if (!addItemTemplateId || !itemTitle.trim()) return
    createItem.mutate({
      template_id: addItemTemplateId,
      title: itemTitle.trim(),
      description: itemDesc.trim(),
      category: itemCategory,
      assigned_to_role: itemRole,
      due_day_offset: itemDueDay,
      is_mandatory: itemMandatory,
    })
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {templates?.length ?? 0} template{(templates?.length ?? 0) !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={() => setShowNewTemplate(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      {/* Template list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading templates…
        </div>
      ) : !templates?.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
          <ClipboardList className="w-10 h-10 opacity-30" />
          <p className="text-sm">No checklist templates yet.</p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={seedTemplates.isPending}
            onClick={() => seedTemplates.mutate()}
          >
            <Plus className="w-4 h-4" />
            {seedTemplates.isPending ? 'Seeding…' : 'Load Default Templates (3)'}
          </Button>
          <p className="text-xs text-muted-foreground/60">Loads Standard, IT Staff, and Field Staff templates</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <TemplateRow
              key={t.id}
              template={t}
              onAddItem={handleAddItem}
              onDeleteItem={id => deleteItem.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* New Template Dialog */}
      <Dialog open={showNewTemplate} onOpenChange={setShowNewTemplate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Checklist Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="tpl-name"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="e.g. Standard Engineer Onboarding"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input
                id="tpl-desc"
                value={templateDesc}
                onChange={e => setTemplateDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTemplate(false)}>Cancel</Button>
            <Button
              onClick={() => createTemplate.mutate({ name: templateName.trim(), description: templateDesc.trim() })}
              disabled={!templateName.trim() || createTemplate.isPending}
            >
              {createTemplate.isPending ? 'Creating…' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog */}
      <Dialog open={!!addItemTemplateId} onOpenChange={open => !open && setAddItemTemplateId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Checklist Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                value={itemTitle}
                onChange={e => setItemTitle(e.target.value)}
                placeholder="e.g. Sign NDA"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={itemDesc}
                onChange={e => setItemDesc(e.target.value)}
                placeholder="Optional details"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={itemCategory} onValueChange={setItemCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assigned To Role</Label>
                <Select value={itemRole} onValueChange={setItemRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Due Day Offset</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemDueDay}
                  onChange={e => setItemDueDay(Number(e.target.value))}
                  placeholder="Days after joining"
                />
              </div>
              <div className="flex items-end pb-1 gap-2">
                <input
                  id="item-mandatory"
                  type="checkbox"
                  checked={itemMandatory}
                  onChange={e => setItemMandatory(e.target.checked)}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                <Label htmlFor="item-mandatory" className="cursor-pointer">Mandatory</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemTemplateId(null)}>Cancel</Button>
            <Button
              onClick={handleCreateItem}
              disabled={!itemTitle.trim() || createItem.isPending}
            >
              {createItem.isPending ? 'Adding…' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Employee Tasks Drawer ──────────────────────────────────────────────────────

interface EmployeeTasksDrawerProps {
  checklist: EmployeeChecklist | null
  open: boolean
  onClose: () => void
}

function EmployeeTasksDrawer({ checklist, open, onClose }: EmployeeTasksDrawerProps) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState<Record<string, string>>({})

  const { data: tasksResp, isLoading } = useQuery<{ data: EmployeeTask[] }>({
    queryKey: ['employee-checklist-tasks', checklist?.id],
    queryFn: () => api.get(`/onboarding/checklists/${checklist!.id}/tasks`),
    enabled: !!checklist && open,
  })
  const tasks = tasksResp?.data ?? []

  const updateTask = useMutation({
    mutationFn: ({ taskId, status, note }: { taskId: string; status: string; note?: string }) =>
      api.patch(`/onboarding/tasks/${taskId}`, { status, notes: note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-checklist-tasks', checklist?.id] })
      qc.invalidateQueries({ queryKey: ['employee-checklists'] })
      toast.success('Task updated')
    },
    onError: () => toast.error('Failed to update task'),
  })

  if (!open || !checklist) return null

  // Group tasks by category
  const grouped: Record<string, EmployeeTask[]> = {}
  for (const task of tasks ?? []) {
    if (!grouped[task.category]) grouped[task.category] = []
    grouped[task.category].push(task)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Drawer */}
      <div
        className="relative z-10 w-full max-w-xl bg-background shadow-xl flex flex-col h-full overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border bg-card">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {checklist.employee.full_name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {checklist.template.name} · {checklist.completed_tasks}/{checklist.total_tasks} completed
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          >
            ✕
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-10 text-muted-foreground text-sm">
              Loading tasks…
            </div>
          ) : !tasks?.length ? (
            <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
              <AlertCircle className="w-8 h-8 opacity-30" />
              <p className="text-sm">No tasks found.</p>
            </div>
          ) : (
            Object.entries(grouped).map(([cat, catTasks]) => (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {categoryLabel(cat)}
                </h3>
                <div className="space-y-3">
                  {catTasks.map(task => (
                    <div
                      key={task.id}
                      className="border border-border rounded-lg px-4 py-3 bg-card"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const newStatus = task.status === 'completed' ? 'pending' : 'completed'
                            updateTask.mutate({
                              taskId: task.id,
                              status: newStatus,
                              note: notes[task.id],
                            })
                          }}
                          className="mt-0.5 flex-shrink-0"
                          title={task.status === 'completed' ? 'Mark incomplete' : 'Mark complete'}
                        >
                          {task.status === 'completed' ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn(
                              'text-sm font-medium',
                              task.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'
                            )}>
                              {task.title}
                            </span>
                            {task.is_mandatory && (
                              <span className="text-xs text-destructive font-medium">Required</span>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusColor(task.status))}>
                              {statusLabel(task.status)}
                            </span>
                            {task.assigned_to_role && (
                              <span className="text-xs text-muted-foreground capitalize">
                                Assigned: {task.assigned_to_role}
                              </span>
                            )}
                            {task.due_date && (
                              <span className="text-xs text-muted-foreground">
                                Due: {formatDate(task.due_date)}
                              </span>
                            )}
                          </div>
                          {/* Notes */}
                          <div className="mt-2">
                            <Input
                              value={notes[task.id] ?? task.notes ?? ''}
                              onChange={e => setNotes(n => ({ ...n, [task.id]: e.target.value }))}
                              placeholder="Add a note…"
                              className="text-xs h-7"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Employee Onboarding ─────────────────────────────────────────────────

function EmployeeOnboardingTab() {
  const qc = useQueryClient()
  const [showAssign, setShowAssign] = useState(false)
  const [assignEmpId, setAssignEmpId] = useState('')
  const [assignTemplateId, setAssignTemplateId] = useState('')
  const [viewChecklist, setViewChecklist] = useState<EmployeeChecklist | null>(null)

  const { data: checklistsResp, isLoading } = useQuery<{ data: EmployeeChecklist[] }>({
    queryKey: ['employee-checklists'],
    queryFn: () => api.get('/onboarding/checklists'),
  })
  const checklists = checklistsResp?.data ?? []

  const { data: employeesResp } = useQuery<{ data: EmployeeBasic[] }>({
    queryKey: ['employees-basic'],
    queryFn: () => api.get('/employees'),
  })
  const employees = employeesResp?.data ?? []

  const { data: templatesResp2 } = useQuery<{ data: ChecklistTemplate[] }>({
    queryKey: ['onboarding-templates'],
    queryFn: () => api.get('/onboarding/templates'),
  })
  const templates = templatesResp2?.data ?? []

  const assignChecklist = useMutation({
    mutationFn: (body: { employee_id: string; template_id: string }) =>
      api.post('/onboarding/checklists', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-checklists'] })
      toast.success('Checklist assigned')
      setShowAssign(false)
      setAssignEmpId('')
      setAssignTemplateId('')
    },
    onError: () => toast.error('Failed to assign checklist'),
  })

  function progressPercent(cl: EmployeeChecklist): number {
    if (!cl.total_tasks) return 0
    return Math.round((cl.completed_tasks / cl.total_tasks) * 100)
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {checklists?.length ?? 0} employee{(checklists?.length ?? 0) !== 1 ? 's' : ''} assigned
        </p>
        <Button size="sm" onClick={() => setShowAssign(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          Assign Checklist
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading…
        </div>
      ) : !checklists?.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Users className="w-10 h-10 opacity-30" />
          <p className="text-sm">No employee onboarding checklists yet.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Employee</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden md:table-cell">Dept</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden lg:table-cell">Join Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden lg:table-cell">Template</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Progress</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {checklists.map(cl => (
                <tr key={cl.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{cl.employee.full_name}</div>
                    <div className="text-xs text-muted-foreground">{cl.employee.employee_code}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {cl.employee.departments?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {formatDate(cl.employee.joining_date)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {cl.template.name}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            cl.status === 'completed' ? 'bg-green-500' :
                            cl.status === 'overdue' ? 'bg-red-500' :
                            'bg-primary'
                          )}
                          style={{ width: `${progressPercent(cl)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {cl.completed_tasks}/{cl.total_tasks}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusColor(cl.status))}>
                      {statusLabel(cl.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewChecklist(cl)}
                      className="gap-1.5 h-7 text-xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign Checklist Dialog */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Checklist to Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Employee <span className="text-destructive">*</span></Label>
              <Select value={assignEmpId} onValueChange={setAssignEmpId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {(employees ?? []).map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.full_name} ({e.employee_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Checklist Template <span className="text-destructive">*</span></Label>
              <Select value={assignTemplateId} onValueChange={setAssignTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{t.is_default ? ' (Default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssign(false)}>Cancel</Button>
            <Button
              onClick={() => assignChecklist.mutate({
                employee_id: assignEmpId,
                template_id: assignTemplateId,
              })}
              disabled={!assignEmpId || !assignTemplateId || assignChecklist.isPending}
            >
              {assignChecklist.isPending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Employee Tasks Drawer */}
      <EmployeeTasksDrawer
        checklist={viewChecklist}
        open={!!viewChecklist}
        onClose={() => setViewChecklist(null)}
      />
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function OnboardingModule() {
  return (
    <PageContainer>
      <PageHeader
        title="Onboarding"
        subtitle="Manage onboarding checklist templates and track employee onboarding progress."
      />

      <Tabs defaultValue="templates" className="mt-6">
        <TabsList className="mb-6">
          <TabsTrigger value="templates" className="gap-2">
            <ClipboardList className="w-4 h-4" />
            Checklist Templates
          </TabsTrigger>
          <TabsTrigger value="employees" className="gap-2">
            <Users className="w-4 h-4" />
            Employee Onboarding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          <SectionCard title="Checklist Templates" description="Define reusable onboarding checklists with task items.">
            <ChecklistTemplatesTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="employees">
          <SectionCard title="Employee Onboarding" description="Assign checklists to employees and track completion.">
            <EmployeeOnboardingTab />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
