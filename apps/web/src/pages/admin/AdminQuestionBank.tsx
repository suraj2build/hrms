/**
 * AdminQuestionBank — /admin/recruitment/question-bank  (INT-03, INT-04a, INT-05b)
 *
 * Two-panel layout:
 *   Left  — Category list with create / edit / delete
 *   Right — Questions for the selected category with difficulty filter + search
 *
 * Interviewers (any HR user) can browse questions when preparing for a round.
 * HR admins can create / edit / delete both categories and questions.
 *
 * Access: all authenticated admins (read); hr_admin / super_admin (write).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HelpCircle, Plus, RefreshCw, Search, Trash2, Pencil,
  ChevronRight, BookOpen, Tag, AlertCircle, Eye, EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Label }         from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Department { id: string; name: string }

interface QBCategory {
  id:            string
  name:          string
  category_type: string
  department_id: string | null
  departments:   { id: string; name: string } | null
}

interface QBItem {
  id:           string
  category_id:  string
  question:     string
  model_answer: string | null
  difficulty:   'easy' | 'medium' | 'hard'
  tags:         string[] | null
  is_active:    boolean
  created_at:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; color: string }> = {
  technical:    { label: 'Technical',    color: 'text-info   bg-info/10   border-info/30'   },
  behavioural:  { label: 'Behavioural',  color: 'text-primary bg-primary/10 border-primary/30' },
  domain:       { label: 'Domain',       color: 'text-accent-teal   bg-accent-teal/10   border-accent-teal/30'   },
  situational:  { label: 'Situational',  color: 'text-warning  bg-warning/10  border-warning/30'  },
  general:      { label: 'General',      color: 'text-muted-foreground   bg-muted   border-border'   },
}

const DIFF_META: Record<string, { label: string; color: string }> = {
  easy:   { label: 'Easy',   color: 'text-success bg-success/10 border-success/30' },
  medium: { label: 'Medium', color: 'text-warning   bg-warning/10   border-warning/30'  },
  hard:   { label: 'Hard',   color: 'text-destructive     bg-destructive/10     border-destructive/30'    },
}

function errMsg(e: unknown, fallback: string): string {
  const apiErr = e as { response?: { data?: { message?: string } } }
  return apiErr?.response?.data?.message ?? fallback
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminQuestionBank() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)
  const [diffFilter,    setDiffFilter]    = useState('all')
  const [search,        setSearch]        = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

  // Category dialog
  const [catDialog,    setCatDialog]    = useState(false)
  const [catEdit,      setCatEdit]      = useState<QBCategory | null>(null)
  const [catName,      setCatName]      = useState('')
  const [catType,      setCatType]      = useState('technical')
  const [catDeptId,    setCatDeptId]    = useState('')
  const [catSaving,    setCatSaving]    = useState(false)

  // Question dialog
  const [qDialog,      setQDialog]      = useState(false)
  const [qEdit,        setQEdit]        = useState<QBItem | null>(null)
  const [qText,        setQText]        = useState('')
  const [qAnswer,      setQAnswer]      = useState('')
  const [qDiff,        setQDiff]        = useState('medium')
  const [qTags,        setQTags]        = useState('')
  const [qSaving,      setQSaving]      = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: deptData } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
    staleTime: 10 * 60 * 1000,
  })
  const departments = deptData?.data ?? []

  const { data: catsData, isLoading: catsLoading, refetch: refetchCats } = useQuery<{ data: QBCategory[] }>({
    queryKey: ['recruitment', 'qb-categories'],
    queryFn:  () => api.get('/recruitment/question-bank/categories'),
  })
  const categories = catsData?.data ?? []

  const qParams = new URLSearchParams({ limit: '200' })
  if (selectedCatId)       qParams.set('category_id', selectedCatId)
  if (diffFilter !== 'all') qParams.set('difficulty',  diffFilter)
  if (search)               qParams.set('search',      search)

  const { data: itemsData, isLoading: itemsLoading, refetch: refetchItems } = useQuery<{ data: QBItem[]; total: number }>({
    queryKey: ['recruitment', 'qb-items', selectedCatId, diffFilter, search],
    queryFn:  () => api.get(`/recruitment/question-bank/items?${qParams}`),
    enabled:  true,
  })
  const items = itemsData?.data ?? []
  const total = itemsData?.total ?? 0

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deleteCatMut = useMutation({
    mutationFn: (id: string) => api.delete(`/recruitment/question-bank/categories/${id}`),
    onSuccess:  () => { toast.success('Category deleted'); qc.invalidateQueries({ queryKey: ['recruitment', 'qb-categories'] }) },
    onError:    (e: unknown) => toast.error(errMsg(e, 'Delete failed')),
  })

  const deleteQMut = useMutation({
    mutationFn: (id: string) => api.delete(`/recruitment/question-bank/items/${id}`),
    onSuccess:  () => { toast.success('Question deleted'); qc.invalidateQueries({ queryKey: ['recruitment', 'qb-items'] }) },
    onError:    (e: unknown) => toast.error(errMsg(e, 'Delete failed')),
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/recruitment/question-bank/items/${id}`, { is_active }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['recruitment', 'qb-items'] }),
    onError:    (e: unknown) => toast.error(errMsg(e, 'Update failed')),
  })

  // ── Category dialog handlers ───────────────────────────────────────────────

  function openCatCreate() {
    setCatEdit(null); setCatName(''); setCatType('technical'); setCatDeptId(''); setCatDialog(true)
  }

  function openCatEdit(c: QBCategory) {
    setCatEdit(c); setCatName(c.name); setCatType(c.category_type); setCatDeptId(c.department_id ?? ''); setCatDialog(true)
  }

  async function saveCat() {
    if (!catName.trim()) { toast.error('Name is required'); return }
    setCatSaving(true)
    try {
      const payload = { name: catName.trim(), category_type: catType, department_id: catDeptId || null }
      if (catEdit) {
        await api.put(`/recruitment/question-bank/categories/${catEdit.id}`, payload)
        toast.success('Category updated')
      } else {
        await api.post('/recruitment/question-bank/categories', payload)
        toast.success('Category created')
      }
      setCatDialog(false)
      qc.invalidateQueries({ queryKey: ['recruitment', 'qb-categories'] })
    } catch (e: unknown) {
      toast.error(errMsg(e, 'Save failed'))
    } finally { setCatSaving(false) }
  }

  // ── Question dialog handlers ───────────────────────────────────────────────

  function openQCreate() {
    if (!selectedCatId) { toast.error('Select a category first'); return }
    setQEdit(null); setQText(''); setQAnswer(''); setQDiff('medium'); setQTags(''); setQDialog(true)
  }

  function openQEdit(q: QBItem) {
    setQEdit(q); setQText(q.question); setQAnswer(q.model_answer ?? ''); setQDiff(q.difficulty); setQTags((q.tags ?? []).join(', ')); setQDialog(true)
  }

  async function saveQuestion() {
    if (!qText.trim()) { toast.error('Question text is required'); return }
    setQSaving(true)
    try {
      const payload: {
        question: string
        model_answer: string | null
        difficulty: string
        tags: string[] | null
      } = {
        question:     qText.trim(),
        model_answer: qAnswer.trim() || null,
        difficulty:   qDiff,
        tags:         qTags ? qTags.split(',').map(t => t.trim()).filter(Boolean) : null,
      }
      if (qEdit) {
        await api.put(`/recruitment/question-bank/items/${qEdit.id}`, payload)
        toast.success('Question updated')
      } else {
        await api.post('/recruitment/question-bank/items', { ...payload, category_id: selectedCatId })
        toast.success('Question added')
      }
      setQDialog(false)
      qc.invalidateQueries({ queryKey: ['recruitment', 'qb-items'] })
    } catch (e: unknown) {
      toast.error(errMsg(e, 'Save failed'))
    } finally { setQSaving(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedCat = categories.find(c => c.id === selectedCatId)

  return (
    <PageContainer>
      <PageHeader
        title="Question Bank"
        subtitle="Organised interview questions by category and difficulty — browse, add, and manage"
        actions={
          <Button variant="outline" size="sm" onClick={() => { refetchCats(); refetchItems() }}>
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* ── Left: Categories ────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Categories</h3>
            {isAdmin && (
              <Button variant="outline" size="sm" className="h-7 px-2" onClick={openCatCreate}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {catsLoading ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : categories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground rounded-lg border border-dashed border-border">
              <BookOpen className="h-6 w-6" />
              <p className="text-xs text-center">No categories yet.</p>
              {isAdmin && <Button size="sm" variant="outline" onClick={openCatCreate}><Plus className="h-3 w-3 mr-1" />Add category</Button>}
            </div>
          ) : (
            <>
              <button
                onClick={() => setSelectedCatId(null)}
                className={cn(
                  'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                  selectedCatId === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50 border border-border',
                )}
              >
                All categories
                <span className="ml-1 text-[11px] opacity-70">({total})</span>
              </button>
              {categories.map(cat => {
                const typeMeta = TYPE_META[cat.category_type] ?? TYPE_META.general
                const isSelected = selectedCatId === cat.id
                return (
                  <div
                    key={cat.id}
                    className={cn(
                      'rounded-lg border transition-colors',
                      isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30',
                    )}
                  >
                    <button
                      className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2"
                      onClick={() => setSelectedCatId(isSelected ? null : cat.id)}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{cat.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <Badge variant="outline" className={cn('text-[9px] px-1.5', typeMeta.color)}>
                            {typeMeta.label}
                          </Badge>
                          {cat.departments && (
                            <span className="text-[10px] text-muted-foreground truncate">{cat.departments.name}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className={cn('h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0 transition-transform', isSelected && 'rotate-90')} />
                    </button>
                    {isSelected && isAdmin && (
                      <div className="flex items-center gap-1 px-3 pb-2">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => openCatEdit(cat)}>
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => deleteCatMut.mutate(cat.id)}
                          disabled={deleteCatMut.isPending}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />Delete
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* ── Right: Questions ────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search questions…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <Select value={diffFilter} onValueChange={setDiffFilter}>
                <SelectTrigger className="h-8 text-sm w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={openQCreate} disabled={!selectedCatId}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add Question
              </Button>
            )}
          </div>

          {!selectedCatId && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 mb-3">
              <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">Select a category on the left to add questions, or browse all below.</p>
            </div>
          )}

          {itemsLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground rounded-lg border border-dashed border-border">
              <HelpCircle className="h-8 w-8" />
              <p className="text-sm">{selectedCatId ? 'No questions in this category.' : 'No questions found.'}</p>
              {isAdmin && selectedCatId && (
                <Button size="sm" variant="outline" onClick={openQCreate}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Add first question
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-1">
                {selectedCat ? `${selectedCat.name} · ` : ''}{total} question{total !== 1 ? 's' : ''}
              </p>
              {items.map(q => {
                const diffMeta = DIFF_META[q.difficulty] ?? DIFF_META.medium
                const isExpanded = expandedId === q.id

                return (
                  <div
                    key={q.id}
                    className={cn(
                      'rounded-lg border border-border bg-card transition-colors',
                      !q.is_active && 'opacity-50',
                    )}
                  >
                    <div
                      className="px-4 py-3 cursor-pointer flex items-start gap-3"
                      onClick={() => setExpandedId(isExpanded ? null : q.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">{q.question}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <Badge variant="outline" className={cn('text-[9px] px-1.5', diffMeta.color)}>
                            {diffMeta.label}
                          </Badge>
                          {(q.tags ?? []).map(tag => (
                            <span key={tag} className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Tag className="h-2.5 w-2.5" />{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <ChevronRight className={cn('h-4 w-4 text-muted-foreground shrink-0 mt-0.5 transition-transform', isExpanded && 'rotate-90')} />
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-3 border-t border-border/50 pt-2.5">
                        {q.model_answer ? (
                          <div className="rounded-md bg-muted/40 p-3 mb-3">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Model Answer</p>
                            <p className="text-sm whitespace-pre-wrap">{q.model_answer}</p>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic mb-3">No model answer provided.</p>
                        )}

                        {isAdmin && (
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openQEdit(q)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => toggleActiveMut.mutate({ id: q.id, is_active: !q.is_active })}
                            >
                              {q.is_active ? <><EyeOff className="h-3 w-3 mr-1" />Deactivate</> : <><Eye className="h-3 w-3 mr-1" />Activate</>}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive ml-auto"
                              onClick={() => deleteQMut.mutate(q.id)}
                              disabled={deleteQMut.isPending}
                            >
                              <Trash2 className="h-3 w-3 mr-1" />Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Category Dialog */}
      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catEdit ? 'Edit Category' : 'New Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="cat-name">Name <span className="text-destructive">*</span></Label>
              <Input id="cat-name" value={catName} onChange={e => setCatName(e.target.value)} placeholder="e.g. React & Frontend" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={catType} onValueChange={setCatType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="behavioural">Behavioural</SelectItem>
                    <SelectItem value="domain">Domain</SelectItem>
                    <SelectItem value="situational">Situational</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Select value={catDeptId || 'none'} onValueChange={v => setCatDeptId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All depts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— All departments —</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(false)} disabled={catSaving}>Cancel</Button>
            <Button onClick={saveCat} disabled={catSaving}>
              {catSaving && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              {catEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Question Dialog */}
      <Dialog open={qDialog} onOpenChange={setQDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{qEdit ? 'Edit Question' : 'Add Question'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="q-text">Question <span className="text-destructive">*</span></Label>
              <textarea
                id="q-text"
                value={qText}
                onChange={e => setQText(e.target.value)}
                placeholder="Type the interview question…"
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
            <div>
              <Label htmlFor="q-ans">Model Answer <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <textarea
                id="q-ans"
                value={qAnswer}
                onChange={e => setQAnswer(e.target.value)}
                placeholder="Suggested answer or key points to look for…"
                rows={4}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Difficulty</Label>
                <Select value={qDiff} onValueChange={setQDiff}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="q-tags">Tags <span className="text-xs text-muted-foreground">(comma-sep)</span></Label>
                <Input id="q-tags" value={qTags} onChange={e => setQTags(e.target.value)} placeholder="hooks, state, async" className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQDialog(false)} disabled={qSaving}>Cancel</Button>
            <Button onClick={saveQuestion} disabled={qSaving}>
              {qSaving && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              {qEdit ? 'Save' : 'Add Question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
