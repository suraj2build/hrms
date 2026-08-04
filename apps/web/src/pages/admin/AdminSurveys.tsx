import { useState } from'react'
import { useQuery, useMutation, useQueryClient } from'@tanstack/react-query'
import { useNavigate } from'react-router-dom'
import {
 Plus, ClipboardList, ChevronRight, Users2,
 FileText, LayoutTemplate, PieChart, Target,
} from'lucide-react'
import { toast } from'sonner'
import {
 BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from'recharts'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from'@/components/ui/dialog'
import { Button } from'@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from'@/components/ui/tabs'
import {
 Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody,
} from'@/components/ui/sheet'
import { api } from'@/lib/api/client'
import { fmtDate } from'@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type SurveyType =
 |'general'|'onboarding_d30'|'onboarding_d60'|'onboarding_d90'
 |'manager_effectiveness'|'feedback_360'|'annual_engagement'
 |'exit_intent'|'post_transfer'|'post_appraisal'

interface Survey {
 id: string
 title: string
 description: string | null
 status:'draft'|'active'|'closed'
 due_date: string | null
 created_at: string
 total_assigned: number
 total_completed: number
 survey_type: SurveyType
 is_anonymous: boolean
}

interface SurveyTemplate {
 id: string
 survey_type: SurveyType
 name: string
 description: string | null
 questions: unknown[]
 is_system: boolean
}

interface EngagementDimension {
 dimension: string
 avg_score: number | null
 response_count: number
}

interface EngagementReport {
 survey: { title: string; survey_type: string; status: string }
 dimensions: EngagementDimension[]
 engagement_index: number
 total_responses: number
}

type QType ='text'|'rating'|'single'|'multi'

interface DraftQuestion {
 question_text: string
 question_type: QType
 options: string
 required: boolean
 order_idx: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
 const cls: Record<string, string> = {
 draft:'bg-muted text-muted-foreground',
 active:'bg-success/20 text-success',
 closed:'bg-destructive/10 text-destructive',
 }
 return (
 <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls[status] ?? cls.draft}`}>
 {status}
 </span>
 )
}

const SURVEY_TYPE_LABELS: Record<SurveyType, string> = {
 general:'General',
 onboarding_d30:'Onboarding D30',
 onboarding_d60:'Onboarding D60',
 onboarding_d90:'Onboarding D90',
 manager_effectiveness:'Manager Effectiveness',
 feedback_360:'360° Feedback',
 annual_engagement:'Annual Engagement',
 exit_intent:'Exit Intent',
 post_transfer:'Post-Transfer',
 post_appraisal:'Post-Appraisal',
}

const SURVEY_TYPE_COLORS: Record<SurveyType, string> = {
 general:'bg-muted text-muted-foreground',
 onboarding_d30:'bg-info/20 text-info',
 onboarding_d60:'bg-info/20 text-info',
 onboarding_d90:'bg-info/20 text-info',
 manager_effectiveness:'bg-accent-violet/20 text-accent-violet',
 feedback_360:'bg-accent-magenta/20 text-accent-magenta',
 annual_engagement:'bg-accent-teal/20 text-accent-teal',
 exit_intent:'bg-destructive/10 text-destructive',
 post_transfer:'bg-accent-coral/20 text-accent-coral',
 post_appraisal:'bg-warning/10 text-warning',
}

const LIFECYCLE_TYPES: SurveyType[] = [
'onboarding_d30','onboarding_d60','onboarding_d90',
'exit_intent','post_transfer','post_appraisal',
]

function SurveyTypeBadge({ type }: { type: SurveyType }) {
 const label = SURVEY_TYPE_LABELS[type] ?? type
 const cls = SURVEY_TYPE_COLORS[type] ?? SURVEY_TYPE_COLORS.general
 return (
 <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
 {label}
 </span>
 )
}

const BLANK_Q: DraftQuestion = {
 question_text:'',
 question_type:'text',
 options:'',
 required: true,
 order_idx: 0,
}

const DIMENSION_LABELS: Record<string, string> = {
 pride:'Pride & Belonging',
 advocacy:'Advocacy & Leadership',
 commitment:'Commitment',
 manager:'Manager Quality',
 growth:'Growth & Development',
 compensation:'Compensation & Benefits',
 work_conditions:'Work Conditions',
 recognition:'Recognition',
 general:'General',
}

// ── Engagement Report Modal ───────────────────────────────────────────────────

function EngagementReportModal({
 surveyId,
 open,
 onClose,
}: {
 surveyId: string
 open: boolean
 onClose: () => void
}) {
 const { data, isLoading } = useQuery<EngagementReport>({
 queryKey: ['engagement-report', surveyId],
 queryFn: () =>
 api.get<{ data: EngagementReport }>(`/surveys/admin/engagement-report/${surveyId}`)
 .then(r => r.data),
 enabled: open && !!surveyId,
 staleTime: 60_000,
 })

 const chartData = (data?.dimensions ?? []).map(d => ({
 name: DIMENSION_LABELS[d.dimension] ?? d.dimension,
 score: d.avg_score ?? 0,
 count: d.response_count,
 }))

 return (
 <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
 <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <PieChart className="h-5 w-5 text-[#15B8A6]" />
 Engagement Report
 </DialogTitle>
 </DialogHeader>

 {isLoading ? (
 <div className="space-y-3 py-4">
 {[1, 2, 3].map(i => <div key={i} className="h-8 animate-pulse rounded bg-muted/40" />)}
 </div>
 ) : !data ? (
 <p className="py-8 text-center text-sm text-muted-foreground">No report data available.</p>
 ) : (
 <div className="space-y-6 py-2">
 {/* KPI row */}
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-xl border border-border/60 bg-card p-4 text-center">
 <p className="text-3xl font-bold text-[#15B8A6]">{data.engagement_index}</p>
 <p className="mt-1 text-xs text-muted-foreground">Engagement Index (out of 50)</p>
 </div>
 <div className="rounded-xl border border-border/60 bg-card p-4 text-center">
 <p className="text-3xl font-bold text-foreground">{data.total_responses}</p>
 <p className="mt-1 text-xs text-muted-foreground">Total Responses</p>
 </div>
 </div>

 {/* Bar chart */}
 {chartData.length > 0 && (
 <div>
 <p className="mb-3 text-sm font-medium text-foreground">Dimension Scores (avg / 5)</p>
 <ResponsiveContainer width="100%" height={chartData.length * 44 + 20}>
 <BarChart
 data={chartData}
 layout="vertical"
 margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
 >
 <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
 <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
 <YAxis
 type="category"
 dataKey="name"
 width={160}
 tick={{ fontSize: 11 }}
 tickLine={false}
 axisLine={false}
 />
 <Tooltip
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 formatter={(v: number, _name: string, props: any) =>
 [`${v} (${props.payload.count} responses)`,'Avg Score']}
 contentStyle={{ fontSize: 12, borderRadius: 8 }}
 />
 <Bar dataKey="score" fill="#15B8A6" radius={[0, 4, 4, 0]} barSize={18} />
 </BarChart>
 </ResponsiveContainer>
 </div>
 )}

 {chartData.length === 0 && (
 <p className="py-6 text-center text-sm text-muted-foreground">
 No rating responses yet. Responses will appear here once employees complete the survey.
 </p>
 )}
 </div>
 )}

 <DialogFooter>
 <Button variant="outline" onClick={onClose}>Close</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 )
}

// ── Use Template Dialog ───────────────────────────────────────────────────────

function UseTemplateDialog({
 template,
 open,
 onClose,
 onCreated,
}: {
 template: SurveyTemplate | null
 open: boolean
 onClose: () => void
 onCreated: () => void
}) {
 const [title, setTitle] = useState('')
 const [dueDate, setDueDate] = useState('')
 const [isAnonymous, setAnonymous] = useState(false)

 const createMut = useMutation({
 mutationFn: () =>
 api.post('/surveys/admin/from-template', {
 template_id: template?.id,
 title: title.trim() || undefined,
 due_date: dueDate || undefined,
 is_anonymous: isAnonymous,
 }),
 onSuccess: () => {
 toast.success('Survey created from template (draft)')
 setTitle('')
 setDueDate('')
 setAnonymous(false)
 onCreated()
 onClose()
 },
 onError: () => toast.error('Could not create survey from template'),
 })

 if (!template) return null

 return (
 <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
 <DialogContent className="max-w-md">
 <DialogHeader>
 <DialogTitle>Create from Template</DialogTitle>
 </DialogHeader>

 <div className="space-y-4 py-2">
 <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
 <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Template</p>
 <p className="text-sm font-medium text-foreground">{template.name}</p>
 {template.description && (
 <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
 )}
 <p className="mt-1.5 text-xs text-muted-foreground">{template.questions.length} questions pre-loaded</p>
 </div>

 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">
 Survey Title <span className="text-muted-foreground">(optional — defaults to template name)</span>
 </label>
 <input
 type="text"
 value={title}
 onChange={e => setTitle(e.target.value)}
 placeholder={template.name}
 className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>

 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">
 Due Date <span className="text-muted-foreground">(optional)</span>
 </label>
 <input
 type="date"
 value={dueDate}
 onChange={e => setDueDate(e.target.value)}
 className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>

 <label className="flex items-center gap-2.5 cursor-pointer">
 <input
 type="checkbox"
 checked={isAnonymous}
 onChange={e => setAnonymous(e.target.checked)}
 className="h-4 w-4 accent-primary rounded"
 />
 <span className="text-sm text-foreground">Anonymous responses</span>
 </label>
 </div>

 <DialogFooter>
 <Button variant="outline" onClick={onClose}>Cancel</Button>
 <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
 {createMut.isPending ?'Creating…':'Create Survey (Draft)'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 )
}

// ── Templates Sheet ───────────────────────────────────────────────────────────

function TemplatesSheet({
 open,
 onClose,
 onCreated,
}: {
 open: boolean
 onClose: () => void
 onCreated: () => void
}) {
 const [selectedTemplate, setSelectedTemplate] = useState<SurveyTemplate | null>(null)
 const [useDialogOpen, setUseDialogOpen] = useState(false)

 const { data: templates = [], isLoading } = useQuery<SurveyTemplate[]>({
 queryKey: ['survey-templates'],
 queryFn: () => api.get<{ data: SurveyTemplate[] }>('/surveys/admin/templates').then(r => r.data),
 enabled: open,
 staleTime: 300_000,
 })

 return (
 <>
 <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
 <SheetContent size="lg">
 <SheetHeader>
 <SheetTitle className="flex items-center gap-2">
 <LayoutTemplate className="h-5 w-5 text-[#15B8A6]" />
 Survey Templates
 </SheetTitle>
 </SheetHeader>
 <SheetBody>
 <p className="text-sm text-muted-foreground mb-5">
 Pre-built templates for common survey types. Click "Use Template" to create a new survey with all questions pre-loaded.
 </p>

 {isLoading ? (
 <div className="space-y-3">
 {[1, 2, 3, 4].map(i => (
 <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/40" />
 ))}
 </div>
 ) : templates.length === 0 ? (
 <p className="py-8 text-center text-sm text-muted-foreground">No templates found.</p>
 ) : (
 <div className="space-y-3">
 {templates.map(t => (
 <div
 key={t.id}
 className="rounded-xl border border-border/60 bg-card p-4"
 >
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-sm font-medium text-foreground">{t.name}</p>
 <SurveyTypeBadge type={t.survey_type as SurveyType} />
 </div>
 {t.description && (
 <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
 )}
 <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
 <FileText className="h-3 w-3" />
 {t.questions.length} questions
 </div>
 </div>
 <Button
 size="sm"
 variant="outline"
 className="shrink-0"
 onClick={() => {
 setSelectedTemplate(t)
 setUseDialogOpen(true)
 }}
 >
 Use Template
 </Button>
 </div>
 </div>
 ))}
 </div>
 )}
 </SheetBody>
 </SheetContent>
 </Sheet>

 <UseTemplateDialog
 template={selectedTemplate}
 open={useDialogOpen}
 onClose={() => setUseDialogOpen(false)}
 onCreated={onCreated}
 />
 </>
 )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminSurveys() {
 const qc = useQueryClient()
 const navigate = useNavigate()

 // Create survey dialog state
 const [open, setOpen] = useState(false)
 const [title, setTitle] = useState('')
 const [desc, setDesc] = useState('')
 const [dueDate, setDueDate] = useState('')
 const [qs, setQs] = useState<DraftQuestion[]>([{ ...BLANK_Q }])

 // Templates sheet state
 const [templatesOpen, setTemplatesOpen] = useState(false)

 // Engagement report modal state
 const [reportSurveyId, setReportSurveyId] = useState<string | null>(null)

 // Filter tab state
 const [filterTab, setFilterTab] = useState('all')

 const { data, isLoading } = useQuery<Survey[]>({
 queryKey: ['admin-surveys'],
 queryFn: () => api.get<{ data: Survey[] }>('/surveys/admin').then(r => r.data),
 staleTime: 60_000,
 })

 const createMut = useMutation({
 mutationFn: () => {
 const questions = qs
 .filter(q => q.question_text.trim())
 .map((q, i) => ({
 question_text: q.question_text.trim(),
 question_type: q.question_type,
 options: (q.question_type ==='single'|| q.question_type ==='multi')
 ? q.options.split('\n').map(s => s.trim()).filter(Boolean)
 : null,
 required: q.required,
 order_idx: i,
 }))
 return api.post('/surveys/admin', {
 title: title.trim(),
 description: desc.trim() || null,
 due_date: dueDate || null,
 questions,
 })
 },
 onSuccess: () => {
 qc.invalidateQueries({ queryKey: ['admin-surveys'] })
 setOpen(false)
 resetForm()
 toast.success('Survey created (draft)')
 },
 onError: () => toast.error('Could not create survey'),
 })

 function resetForm() {
 setTitle('')
 setDesc('')
 setDueDate('')
 setQs([{ ...BLANK_Q }])
 }

 function addQ() {
 setQs(prev => [...prev, { ...BLANK_Q, order_idx: prev.length }])
 }

 function removeQ(i: number) {
 setQs(prev => prev.filter((_, idx) => idx !== i))
 }

 function updateQ(i: number, patch: Partial<DraftQuestion>) {
 setQs(prev => prev.map((q, idx) => idx === i ? { ...q, ...patch } : q))
 }

 const surveys = data ?? []

 // ── Filter logic ────────────────────────────────────────────────────────────
 const filteredSurveys = surveys.filter(s => {
 if (filterTab ==='all') return true
 if (filterTab ==='lifecycle') return LIFECYCLE_TYPES.includes(s.survey_type)
 if (filterTab ==='engagement') return s.survey_type ==='annual_engagement'|| s.survey_type ==='manager_effectiveness'
 if (filterTab ==='custom') return s.survey_type ==='general'|| s.survey_type ==='feedback_360'
 return true
 })

 return (
 <div className="p-6 space-y-6 max-w-4xl">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-semibold text-foreground">Surveys</h1>
 <p className="mt-1 text-sm text-muted-foreground">Create and manage employee surveys</p>
 </div>
 <div className="flex items-center gap-2">
 <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
 <LayoutTemplate className="mr-2 h-4 w-4" />
 Templates
 </Button>
 <Button size="sm" onClick={() => setOpen(true)}>
 <Plus className="mr-2 h-4 w-4" />
 New Survey
 </Button>
 </div>
 </div>

 {/* Filter tabs */}
 <Tabs value={filterTab} onValueChange={setFilterTab}>
 <TabsList>
 <TabsTrigger value="all">All</TabsTrigger>
 <TabsTrigger value="lifecycle">
 <Target className="mr-1.5 h-3.5 w-3.5" />
 Lifecycle
 </TabsTrigger>
 <TabsTrigger value="engagement">
 <PieChart className="mr-1.5 h-3.5 w-3.5" />
 Engagement
 </TabsTrigger>
 <TabsTrigger value="custom">
 <FileText className="mr-1.5 h-3.5 w-3.5" />
 Custom
 </TabsTrigger>
 </TabsList>

 {/* Survey list — shared across all tabs via filteredSurveys */}
 <TabsContent value={filterTab} className="mt-4">
 {isLoading ? (
 <div className="space-y-3">
 {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted/40" />)}
 </div>
 ) : filteredSurveys.length === 0 ? (
 <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-card py-16 text-center">
 <ClipboardList className="h-10 w-10 text-muted-foreground/40 mb-3" />
 <p className="text-sm text-muted-foreground">
 {surveys.length === 0
 ?'No surveys yet. Create your first one or use a template.'
 :'No surveys in this category.'}
 </p>
 </div>
 ) : (
 <div className="space-y-2">
 {filteredSurveys.map(s => {
 const pct = s.total_assigned
 ? Math.round(s.total_completed / s.total_assigned * 100)
 : 0
 const isEngagement = s.survey_type ==='annual_engagement'
 return (
 <div
 key={s.id}
 className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card px-5 py-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
 >
 {/* Clickable main area */}
 <div
 role="button"
 tabIndex={0}
 onClick={() => navigate(`/admin/surveys/${s.id}`)}
 onKeyDown={e => e.key ==='Enter'&& navigate(`/admin/surveys/${s.id}`)}
 className="min-w-0 flex-1 cursor-pointer"
 >
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-sm font-medium text-foreground">{s.title}</p>
 <StatusBadge status={s.status} />
 <SurveyTypeBadge type={s.survey_type} />
 {s.is_anonymous && (
 <span className="rounded-full bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground px-2 py-0.5 text-[10px] font-medium">
 Anonymous
 </span>
 )}
 </div>
 {s.description && (
 <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{s.description}</p>
 )}
 <div className="mt-1.5 flex items-center gap-3">
 <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
 <Users2 className="h-3 w-3" />
 {s.total_assigned} assigned · {s.total_completed} completed
 </span>
 {s.total_assigned > 0 && (
 <span className="text-[11px] text-muted-foreground">{pct}% response rate</span>
 )}
 {s.due_date && (
 <span className="text-[11px] text-muted-foreground">
 Due {fmtDate(s.due_date)}
 </span>
 )}
 </div>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-2 shrink-0">
 {isEngagement && (
 <Button
 size="sm"
 variant="outline"
 className="h-7 px-2.5 text-xs"
 onClick={e => {
 e.stopPropagation()
 setReportSurveyId(s.id)
 }}
 >
 <PieChart className="mr-1.5 h-3.5 w-3.5 text-[#15B8A6]" />
 Engagement Report
 </Button>
 )}
 <ChevronRight
 className="h-4 w-4 text-muted-foreground cursor-pointer"
 onClick={() => navigate(`/admin/surveys/${s.id}`)}
 />
 </div>
 </div>
 )
 })}
 </div>
 )}
 </TabsContent>
 </Tabs>

 {/* Create Survey Dialog */}
 <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm() }}>
 <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>New Survey</DialogTitle>
 </DialogHeader>

 <div className="space-y-4 py-2">
 {/* Title */}
 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">Title *</label>
 <input
 type="text"
 value={title}
 onChange={e => setTitle(e.target.value)}
 placeholder="e.g. Q3 Employee Engagement Survey"
 className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>

 {/* Description */}
 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">
 Description <span className="text-muted-foreground">(optional)</span>
 </label>
 <textarea
 value={desc}
 onChange={e => setDesc(e.target.value)}
 rows={2}
 placeholder="Brief context for employees…"
 className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>

 {/* Due date */}
 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">
 Due date <span className="text-muted-foreground">(optional)</span>
 </label>
 <input
 type="date"
 value={dueDate}
 onChange={e => setDueDate(e.target.value)}
 className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>

 {/* Questions */}
 <div>
 <div className="mb-2 flex items-center justify-between">
 <label className="text-sm font-medium text-foreground">Questions</label>
 <button onClick={addQ} className="text-xs text-primary hover:underline">+ Add question</button>
 </div>

 <div className="space-y-4">
 {qs.map((q, i) => (
 <div key={i} className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-3">
 <div className="flex items-center justify-between gap-2">
 <span className="text-xs font-medium text-muted-foreground">Q{i + 1}</span>
 {qs.length > 1 && (
 <button onClick={() => removeQ(i)} className="text-xs text-destructive hover:underline">Remove</button>
 )}
 </div>

 <input
 type="text"
 value={q.question_text}
 onChange={e => updateQ(i, { question_text: e.target.value })}
 placeholder="Question text…"
 className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />

 <div className="flex flex-wrap gap-2">
 {(['text','rating','single','multi'] as QType[]).map(t => (
 <button
 key={t}
 type="button"
 onClick={() => updateQ(i, { question_type: t })}
 className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
 q.question_type === t
 ?'border-primary bg-primary text-primary-foreground'
 :'border-border/60 text-foreground hover:bg-muted'
 }`}
 >
 {t ==='text'?'Free text': t ==='rating'?'Rating (1-5)': t ==='single'?'Single choice':'Multi choice'}
 </button>
 ))}
 </div>

 {(q.question_type ==='single'|| q.question_type ==='multi') && (
 <div>
 <label className="mb-1 block text-xs text-muted-foreground">Options (one per line)</label>
 <textarea
 value={q.options}
 onChange={e => updateQ(i, { options: e.target.value })}
 rows={3}
 placeholder={"Option A\nOption B\nOption C"}
 className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>
 )}

 <label className="flex items-center gap-2 text-xs text-foreground">
 <input
 type="checkbox"
 checked={q.required}
 onChange={e => updateQ(i, { required: e.target.checked })}
 className="h-3.5 w-3.5 accent-primary"
 />
 Required
 </label>
 </div>
 ))}
 </div>
 </div>
 </div>

 <DialogFooter>
 <Button variant="outline" onClick={() => { setOpen(false); resetForm() }}>Cancel</Button>
 <Button
 onClick={() => createMut.mutate()}
 disabled={!title.trim() || qs.every(q => !q.question_text.trim()) || createMut.isPending}
 >
 Create Survey (Draft)
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Templates Sheet */}
 <TemplatesSheet
 open={templatesOpen}
 onClose={() => setTemplatesOpen(false)}
 onCreated={() => qc.invalidateQueries({ queryKey: ['admin-surveys'] })}
 />

 {/* Engagement Report Modal */}
 {reportSurveyId && (
 <EngagementReportModal
 surveyId={reportSurveyId}
 open={!!reportSurveyId}
 onClose={() => setReportSurveyId(null)}
 />
 )}
 </div>
 )
}
