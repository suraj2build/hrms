import { useState } from'react'
import { useQuery, useMutation, useQueryClient } from'@tanstack/react-query'
import {
 BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
 PieChart, Pie, Legend,
} from'recharts'
import {
 SmilePlus, MessageSquare, BarChart2,
 Plus, Check, X, ChevronDown, ChevronUp,
 MapPin, TrendingDown, TrendingUp, Smile, Meh, Frown,
} from'lucide-react'
import { toast } from'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from'@/components/ui/dialog'
import { ConfirmDialog } from'@/components/ui/ConfirmDialog'
import { Button } from'@/components/ui/button'
import { api } from'@/lib/api/client'
import { fmtDate } from'@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

const MOOD_CONFIG = [
 { score: 1, emoji:'😔', label:'Rough', color:'#ef4444'},
 { score: 2, emoji:'😕', label:'Not great', color:'#f97316'},
 { score: 3, emoji:'😐', label:'Okay', color:'#eab308'},
 { score: 4, emoji:'😊', label:'Good', color:'#22c55e'},
 { score: 5, emoji:'😄', label:'Great', color:'#15B8A6'},
]

const POLL_CATEGORIES = [
 { value:'weekly_pulse', label:'Weekly Pulse'},
 { value:'manager_quality', label:'Manager Quality'},
 { value:'post_appraisal', label:'Post-Appraisal'},
 { value:'onboarding', label:'Onboarding'},
 { value:'post_transfer', label:'Post-Transfer'},
 { value:'festival', label:'Festival'},
 { value:'custom', label:'Custom'},
]

interface SentimentSummary {
 positive: number
 neutral: number
 negative: number
 total_with_notes: number
}

interface TrendPoint {
 date: string
 avg: number | null
 count: number
}

interface DashboardData {
 trend: TrendPoint[]
 distribution: Record<string, number>
 total_checkins_7d: number
 participation_rate_7d?: number
 total_employees?: number
 active_pulse: { id: string; question: string; options: string[] | null; status: string; response_count: number; created_at: string }[]
 sentiment_summary: SentimentSummary
}

interface PulseQuestion {
 id: string
 question: string
 options: string[] | null
 status:'draft'|'active'|'closed'
 poll_category: string
 created_at: string
}

interface StoreBreakdownRow {
 work_location_id: string
 score_month: string
 avg_score_100: number
 response_count: number
 location_name: string
}

interface SentimentReport {
 positive_pct: number
 neutral_pct: number
 negative_pct: number
 total_with_notes: number
 positive: number
 neutral: number
 negative: number
 recent_negatives: { note: string; checkin_date: string }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function shortDate(d: string) {
 const [, month, day] = d.split('-')
 return `${parseInt(day)}/${parseInt(month)}`
}

function storeScoreColor(score: number): string {
 if (score < 40) return'#ef4444'
 if (score < 60) return'#f97316'
 if (score < 80) return'#eab308'
 return'#22c55e'
}

function currentYearMonth(): string {
 const d = new Date()
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
}

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab ='overview'|'store-breakdown'|'sentiment'

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminMoodDashboard() {
 const qc = useQueryClient()

 const [activeTab, setActiveTab] = useState<Tab>('overview')
 const [createOpen, setCreateOpen] = useState(false)
 const [newQuestion, setNewQuestion] = useState('')
 const [newOptions, setNewOptions] = useState('')
 const [optionType, setOptionType] = useState<'choices'|'freetext'>('choices')
 const [pollCategory, setPollCategory] = useState('weekly_pulse')
 const [expandedQ, setExpandedQ] = useState<string | null>(null)
 const [closeTarget, setCloseTarget] = useState<{ id: string; question: string } | null>(null)
 const [storeMonth, setStoreMonth] = useState(currentYearMonth())

 const { data: dashData, isLoading } = useQuery<DashboardData>({
 queryKey: ['mood-admin-dashboard'],
 queryFn: () => api.get<{ data: DashboardData }>('/mood/admin/dashboard').then(r => r.data),
 staleTime: 2 * 60_000,
 })

 const { data: allQuestions } = useQuery<PulseQuestion[]>({
 queryKey: ['mood-admin-pulse'],
 queryFn: () => api.get<{ data: PulseQuestion[] }>('/mood/admin/pulse').then(r => r.data),
 staleTime: 60_000,
 })

 const { data: responsesResp, isLoading: responsesLoading } = useQuery<{ data: { response: string; created_at: string }[]; total: number }>({
 queryKey: ['mood-pulse-responses', expandedQ],
 queryFn: () => api.get<{ data: { response: string; created_at: string }[]; total: number }>(`/mood/admin/pulse/${expandedQ}/responses`),
 enabled: !!expandedQ,
 staleTime: 30_000,
 })
 const responsesData = responsesResp?.data
 const responsesTotal = responsesResp?.total ?? 0

 const { data: storeBreakdown, isLoading: storeLoading } = useQuery<StoreBreakdownRow[]>({
 queryKey: ['mood-store-breakdown', storeMonth],
 queryFn: () => api.get<{ data: StoreBreakdownRow[] }>(`/mood/admin/store-breakdown?month=${storeMonth}`).then(r => r.data),
 enabled: activeTab ==='store-breakdown',
 staleTime: 5 * 60_000,
 })

 const { data: sentimentReport, isLoading: sentimentLoading } = useQuery<SentimentReport>({
 queryKey: ['mood-sentiment-report'],
 queryFn: () => api.get<{ data: SentimentReport }>('/mood/admin/sentiment-report').then(r => r.data),
 enabled: activeTab ==='sentiment',
 staleTime: 5 * 60_000,
 })

 const createMut = useMutation({
 mutationFn: (body: { question: string; options: string[] | null; poll_category: string }) =>
 api.post('/mood/admin/pulse', body),
 onSuccess: () => {
 qc.invalidateQueries({ queryKey: ['mood-admin-pulse'] })
 qc.invalidateQueries({ queryKey: ['mood-admin-dashboard'] })
 setCreateOpen(false)
 setNewQuestion('')
 setNewOptions('')
 setPollCategory('weekly_pulse')
 toast.success('Pulse question created (draft)')
 },
 onError: () => toast.error('Could not create question'),
 })

 const patchMut = useMutation({
 mutationFn: ({ id, status }: { id: string; status: string }) =>
 api.patch(`/mood/admin/pulse/${id}`, { status }),
 onSuccess: () => {
 setCloseTarget(null)
 qc.invalidateQueries({ queryKey: ['mood-admin-pulse'] })
 qc.invalidateQueries({ queryKey: ['mood-admin-dashboard'] })
 },
 onError: () => { setCloseTarget(null); toast.error('Could not update question') },
 })

 const dash = dashData
 const questions = allQuestions ?? []

 const avg7d = (() => {
 if (!dash?.trend) return null
 const valid = dash.trend.filter(t => t.avg !== null)
 if (!valid.length) return null
 return Math.round(valid.reduce((s, t) => s + (t.avg ?? 0), 0) / valid.length * 10) / 10
 })()

 function handleCreate() {
 if (!newQuestion.trim()) return
 const opts = optionType ==='choices'
 ? newOptions.split('\n').map(s => s.trim()).filter(Boolean)
 : null
 createMut.mutate({
 question: newQuestion.trim(),
 options: opts?.length ? opts : null,
 poll_category: pollCategory,
 })
 }

 const maxDist = Math.max(...MOOD_CONFIG.map(m => Number(dash?.distribution[m.score] ?? 0)), 1)

 // Sentiment summary from dashboard
 const sent = dash?.sentiment_summary
 const sentTotal = (sent?.total_with_notes ?? 0)
 const sentPositivePct = sentTotal > 0 ? Math.round(((sent?.positive ?? 0) / sentTotal) * 100) : 0
 const sentNeutralPct = sentTotal > 0 ? Math.round(((sent?.neutral ?? 0) / sentTotal) * 100) : 0
 const sentNegativePct = sentTotal > 0 ? Math.round(((sent?.negative ?? 0) / sentTotal) * 100) : 0

 const tabs: { id: Tab; label: string }[] = [
 { id:'overview', label:'Overview'},
 { id:'store-breakdown', label:'Store Breakdown'},
 { id:'sentiment', label:'Sentiment Analysis'},
 ]

 return (
 <div className="p-6 space-y-6 max-w-5xl">

 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-semibold text-foreground">Mood & Pulse</h1>
 <p className="mt-1 text-sm text-muted-foreground">Employee sentiment, check-ins and pulse questions</p>
 </div>
 <Button size="sm" onClick={() => setCreateOpen(true)}>
 <Plus className="mr-2 h-4 w-4" />
 New Pulse Question
 </Button>
 </div>

 {/* Stats strip */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 {[
 { label:'Check-ins (7d)', value: dash?.total_checkins_7d ??'—', icon: SmilePlus },
 { label:'Avg Mood (7d)', value: avg7d !== null ? `${avg7d} / 5` :'—', icon: BarChart2 },
 { label:'Active Pulse Questions', value: dash?.active_pulse?.length ?? 0, icon: MessageSquare },
 ].map(s => (
 <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-5">
 <div className="mb-2 flex items-center gap-2 text-muted-foreground">
 <s.icon className="h-4 w-4" />
 <span className="text-xs font-medium">{s.label}</span>
 </div>
 <p className="text-2xl font-bold text-foreground">{s.value}</p>
 </div>
 ))}
 {/* Participation gauge */}
 <div className="rounded-2xl border border-border/60 bg-card p-5">
 <div className="mb-2 flex items-center gap-2 text-muted-foreground">
 <SmilePlus className="h-4 w-4" />
 <span className="text-xs font-medium">Participation (7d)</span>
 </div>
 {dash?.participation_rate_7d != null ? (
 <>
 <p className={`text-2xl font-bold ${dash.participation_rate_7d >= 70 ?'text-success':'text-warning'}`}>
 {dash.participation_rate_7d}%
 </p>
 <div className="mt-2 relative h-2 rounded-full bg-muted overflow-visible">
 <div
 className={`h-full rounded-full transition-all ${dash.participation_rate_7d >= 70 ?'bg-success':'bg-warning'}`}
 style={{ width: `${Math.min(dash.participation_rate_7d, 100)}%` }}
 />
 {/* 70% target marker */}
 <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-muted-foreground/50 rounded-full" style={{ left:'70%'}} />
 </div>
 <p className="text-[10px] text-muted-foreground mt-1">Target: 70%</p>
 </>
 ) : (
 <p className="text-2xl font-bold text-foreground">—</p>
 )}
 </div>
 </div>

 {/* Sentiment distribution strip */}
 {sentTotal > 0 && (
 <div className="rounded-2xl border border-border/60 bg-card px-5 py-3 flex items-center gap-6 text-sm">
 <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sentiment (7d)</span>
 <span className="flex items-center gap-1.5 text-[#22c55e] font-medium">
 <Smile className="h-4 w-4" /> {sentPositivePct}% Positive
 </span>
 <span className="flex items-center gap-1.5 text-[#94a3b8] font-medium">
 <Meh className="h-4 w-4" /> {sentNeutralPct}% Neutral
 </span>
 <span className="flex items-center gap-1.5 text-[#ef4444] font-medium">
 <Frown className="h-4 w-4" /> {sentNegativePct}% Negative
 </span>
 </div>
 )}

 {/* Tabs */}
 <div className="flex gap-1 rounded-xl border border-border/60 bg-muted/30 p-1 w-fit">
 {tabs.map(tab => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
 activeTab === tab.id
 ?'bg-card text-foreground shadow-sm'
 :'text-muted-foreground hover:text-foreground'
 }`}
 >
 {tab.label}
 </button>
 ))}
 </div>

 {/* ── Tab: Overview ───────────────────────────────────────────────────── */}
 {activeTab ==='overview'&& (
 <>
 {/* 7-day trend */}
 <div className="rounded-2xl border border-border/60 bg-card p-6">
 <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
 7-Day Mood Trend
 </p>
 {!isLoading && dash?.trend ? (
 <ResponsiveContainer width="100%" height={160}>
 <BarChart data={dash.trend} barSize={30} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
 <XAxis
 dataKey="date"
 tickFormatter={shortDate}
 tick={{ fontSize: 11 }}
 axisLine={false}
 tickLine={false}
 />
 <YAxis domain={[0, 5]} hide />
 <Tooltip
 formatter={(v: number) => [v !== null ? `${v}` :'—','Avg Mood']}
 labelFormatter={shortDate}
 contentStyle={{ fontSize: 12, borderRadius: 8 }}
 />
 <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
 {dash.trend.map((entry, i) => (
 <Cell key={i} fill={entry.avg === null ?'#e5e7eb':'#15B8A6'} />
 ))}
 </Bar>
 </BarChart>
 </ResponsiveContainer>
 ) : (
 <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
 )}
 </div>

 {/* Mood distribution */}
 <div className="rounded-2xl border border-border/60 bg-card p-6">
 <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
 Mood Distribution — Last 7 Days
 </p>
 <div className="flex items-end gap-4">
 {MOOD_CONFIG.map(m => {
 const count = Number(dash?.distribution[m.score] ?? 0)
 const pct = Math.round((count / maxDist) * 100)
 return (
 <div key={m.score} className="flex flex-1 flex-col items-center gap-1">
 <span className="text-xs font-medium text-foreground">{count}</span>
 <div className="flex w-full flex-col justify-end" style={{ height: 80 }}>
 <div
 className="w-full rounded-t-md transition-all duration-500"
 style={{
 height: `${pct}%`,
 minHeight: count > 0 ? 4 : 0,
 background: m.color,
 }}
 />
 </div>
 <span className="text-xl">{m.emoji}</span>
 <span className="text-center text-[10px] text-muted-foreground">{m.label}</span>
 </div>
 )
 })}
 </div>
 </div>

 {/* Pulse questions */}
 <div className="rounded-2xl border border-border/60 bg-card p-6">
 <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
 Pulse Questions
 </p>

 {questions.length === 0 ? (
 <p className="text-sm text-muted-foreground">
 No pulse questions yet. Create one to start collecting feedback.
 </p>
 ) : (
 <div className="space-y-2">
 {questions.map(q => (
 <div key={q.id} className="rounded-xl border border-border/40 bg-muted/30">
 {/* Question row */}
 <div className="flex items-center gap-3 px-4 py-3">
 <div className="min-w-0 flex-1">
 <p className="text-sm font-medium text-foreground">{q.question}</p>
 <p className="mt-0.5 text-[11px] text-muted-foreground">
 {q.options
 ? `Choices: ${(q.options as string[]).join('·')}`
 :'Free text'}
 {q.poll_category && (
 <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] capitalize">
 {POLL_CATEGORIES.find(c => c.value === q.poll_category)?.label ?? q.poll_category}
 </span>
 )}
 </p>
 </div>

 <StatusBadge status={q.status} />

 <div className="flex items-center gap-1.5">
 {q.status ==='draft'&& (
 <button
 onClick={() => patchMut.mutate({ id: q.id, status:'active'})}
 disabled={patchMut.isPending}
 className="flex items-center gap-1 rounded-lg bg-success/20 px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/30 dark:bg-success/10 dark:text-success disabled:opacity-50"
 >
 <Check className="h-3 w-3" /> Activate
 </button>
 )}
 {q.status ==='active'&& (
 <button
 onClick={() => setCloseTarget({ id: q.id, question: q.question })}
 disabled={patchMut.isPending}
 className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
 >
 <X className="h-3 w-3" /> Close
 </button>
 )}
 <button
 onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
 className="rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors"
 title="View responses"
 >
 {expandedQ === q.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
 </button>
 </div>
 </div>

 {/* Responses panel */}
 {expandedQ === q.id && (
 <div className="border-t border-border/40 px-4 pb-4 pt-3">
 {responsesLoading ? (
 <p className="text-xs text-muted-foreground">Loading responses…</p>
 ) : !responsesData?.length ? (
 <p className="text-xs text-muted-foreground">No responses yet.</p>
 ) : (
 <>
 {responsesTotal > responsesData.length && (
 <p className="mb-2 text-[10px] text-muted-foreground">
 Showing first {responsesData.length} of {responsesTotal} responses
 </p>
 )}
 <div className="space-y-2 max-h-48 overflow-y-auto">
 {responsesData.map((r, i) => (
 <div key={i} className="rounded-lg bg-background px-3 py-2">
 <p className="text-sm text-foreground">"{r.response}"</p>
 <p className="mt-0.5 text-[10px] text-muted-foreground">
 {fmtDate(r.created_at)}
 </p>
 </div>
 ))}
 </div>
 </>
 )}
 </div>
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 </>
 )}

 {/* ── Tab: Store Breakdown ────────────────────────────────────────────── */}
 {activeTab ==='store-breakdown'&& (
 <div className="space-y-4">
 {/* Month picker */}
 <div className="flex items-center gap-3">
 <MapPin className="h-4 w-4 text-muted-foreground" />
 <label className="text-sm font-medium text-foreground">Month</label>
 <input
 type="month"
 value={storeMonth}
 onChange={e => setStoreMonth(e.target.value)}
 className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
 />
 </div>

 <div className="rounded-2xl border border-border/60 bg-card p-6">
 <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
 Store Mood Score — {storeMonth}
 </p>
 <p className="mb-4 text-xs text-muted-foreground">Sorted by score (lowest first — needs most attention)</p>

 {storeLoading ? (
 <div className="h-48 animate-pulse rounded-xl bg-muted/40" />
 ) : !storeBreakdown?.length ? (
 <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
 <MapPin className="h-8 w-8 mb-2 opacity-40" />
 <p className="text-sm">No store data available for this month.</p>
 <p className="text-xs mt-1">Ensure employees have a work location assigned.</p>
 </div>
 ) : (
 <ResponsiveContainer width="100%" height={Math.max(storeBreakdown.length * 52, 120)}>
 <BarChart
 data={storeBreakdown}
 layout="vertical"
 margin={{ top: 0, right: 60, left: 10, bottom: 0 }}
 barSize={24}
 >
 <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
 <YAxis
 type="category"
 dataKey="location_name"
 width={140}
 tick={{ fontSize: 12 }}
 axisLine={false}
 tickLine={false}
 />
 <Tooltip
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 formatter={(v: number, _name: string, props: any) => [
 `${v}/100 (${props.payload.response_count} responses)`,
'Avg Score',
 ]}
 contentStyle={{ fontSize: 12, borderRadius: 8 }}
 />
 <Bar dataKey="avg_score_100" radius={[0, 4, 4, 0]}
 label={{ position:'right', fontSize: 11, formatter: (v: number) => `${v}` }}
 >
 {storeBreakdown.map((entry, i) => (
 <Cell key={i} fill={storeScoreColor(entry.avg_score_100)} />
 ))}
 </Bar>
 </BarChart>
 </ResponsiveContainer>
 )}

 {/* Legend */}
 <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
 <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#ef4444]" /> Below 40 — Critical</span>
 <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f97316]" /> 40–60 — Needs attention</span>
 <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#eab308]" /> 60–80 — Moderate</span>
 <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#22c55e]" /> Above 80 — Healthy</span>
 </div>
 </div>

 {/* Score table */}
 {(storeBreakdown?.length ?? 0) > 0 && (
 <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-border/60 bg-muted/30">
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Store</th>
 <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Score</th>
 <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responses</th>
 <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
 </tr>
 </thead>
 <tbody>
 {storeBreakdown?.map((row, i) => (
 <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
 <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
 <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
 {row.location_name}
 </td>
 <td className="px-4 py-3 text-right font-bold" style={{ color: storeScoreColor(row.avg_score_100) }}>
 {row.avg_score_100}
 </td>
 <td className="px-4 py-3 text-right text-muted-foreground">{row.response_count}</td>
 <td className="px-4 py-3 text-right">
 {row.avg_score_100 < 40 ? (
 <span className="flex items-center justify-end gap-1 text-[#ef4444]"><TrendingDown className="h-3.5 w-3.5" /> Critical</span>
 ) : row.avg_score_100 < 60 ? (
 <span className="flex items-center justify-end gap-1 text-[#f97316]"><TrendingDown className="h-3.5 w-3.5" /> Needs attention</span>
 ) : row.avg_score_100 < 80 ? (
 <span className="text-[#eab308]">Moderate</span>
 ) : (
 <span className="flex items-center justify-end gap-1 text-[#22c55e]"><TrendingUp className="h-3.5 w-3.5" /> Healthy</span>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* ── Tab: Sentiment Analysis ─────────────────────────────────────────── */}
 {activeTab ==='sentiment'&& (
 <div className="space-y-4">
 {sentimentLoading ? (
 <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
 ) : !sentimentReport ? (
 <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
 <Smile className="h-8 w-8 mx-auto mb-2 opacity-40" />
 <p className="text-sm">No sentiment data yet.</p>
 </div>
 ) : (
 <>
 {/* High negative alert */}
 {sentimentReport.negative_pct > 30 && (
 <div className="rounded-2xl border border-[#ef4444]/40 bg-[#ef4444]/5 px-5 py-4 flex items-start gap-3">
 <Frown className="h-5 w-5 text-[#ef4444] mt-0.5 shrink-0" />
 <div>
 <p className="text-sm font-semibold text-[#ef4444]">High negative sentiment detected</p>
 <p className="text-xs text-muted-foreground mt-0.5">
 {sentimentReport.negative_pct}% of check-ins with notes show negative sentiment over the last 30 days.
 Consider scheduling a team check-in or one-on-one conversations.
 </p>
 </div>
 </div>
 )}

 {/* Stat cards */}
 <div className="grid grid-cols-3 gap-4">
 {[
 { label:'Positive', pct: sentimentReport.positive_pct, count: sentimentReport.positive, color:'#22c55e', icon: Smile },
 { label:'Neutral', pct: sentimentReport.neutral_pct, count: sentimentReport.neutral, color:'#94a3b8', icon: Meh },
 { label:'Negative', pct: sentimentReport.negative_pct, count: sentimentReport.negative, color:'#ef4444', icon: Frown },
 ].map(s => (
 <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-5">
 <div className="mb-3 flex items-center gap-2" style={{ color: s.color }}>
 <s.icon className="h-5 w-5" />
 <span className="text-sm font-semibold">{s.label}</span>
 </div>
 <p className="text-3xl font-bold" style={{ color: s.color }}>{s.pct}%</p>
 <p className="mt-1 text-xs text-muted-foreground">{s.count} check-ins (last 30 days)</p>
 </div>
 ))}
 </div>

 {/* Pie chart */}
 {sentimentReport.total_with_notes > 0 && (
 <div className="rounded-2xl border border-border/60 bg-card p-6">
 <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
 Sentiment Distribution — Last 30 Days
 </p>
 <div className="flex items-center justify-center">
 <ResponsiveContainer width="100%" height={220}>
 <PieChart>
 <Pie
 data={[
 { name:'Positive', value: sentimentReport.positive, fill:'#22c55e'},
 { name:'Neutral', value: sentimentReport.neutral, fill:'#94a3b8'},
 { name:'Negative', value: sentimentReport.negative, fill:'#ef4444'},
 ].filter(d => d.value > 0)}
 cx="50%"
 cy="50%"
 innerRadius={60}
 outerRadius={90}
 paddingAngle={3}
 dataKey="value"
 label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
 labelLine={false}
 />
 <Tooltip formatter={(v: number) => [`${v} check-ins`]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
 <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
 </PieChart>
 </ResponsiveContainer>
 </div>
 </div>
 )}

 {/* Recent negative feedback */}
 {sentimentReport.recent_negatives.length > 0 && (
 <div className="rounded-2xl border border-border/60 bg-card p-6">
 <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
 Recent Negative Feedback
 </p>
 <p className="mb-4 text-xs text-muted-foreground">Anonymized — last 10 negative-sentiment check-in notes</p>
 <div className="space-y-2 max-h-80 overflow-y-auto">
 {sentimentReport.recent_negatives.map((item, i) => (
 <div key={i} className="rounded-xl border border-[#ef4444]/20 bg-[#ef4444]/5 px-4 py-3">
 <p className="text-sm text-foreground">"{item.note}"</p>
 <p className="mt-1 text-[10px] text-muted-foreground">
 {fmtDate(item.checkin_date)}
 </p>
 </div>
 ))}
 </div>
 </div>
 )}

 {sentimentReport.total_with_notes === 0 && (
 <div className="rounded-2xl border border-border/60 bg-card p-12 text-center text-muted-foreground">
 <Meh className="h-8 w-8 mx-auto mb-2 opacity-40" />
 <p className="text-sm">No check-ins with notes in the last 30 days.</p>
 <p className="text-xs mt-1">Sentiment analysis runs on check-in notes.</p>
 </div>
 )}
 </>
 )}
 </div>
 )}

 {/* Create dialog */}
 <Dialog open={createOpen} onOpenChange={setCreateOpen}>
 <DialogContent className="max-w-lg">
 <DialogHeader>
 <DialogTitle>New Pulse Question</DialogTitle>
 </DialogHeader>

 <div className="space-y-4 py-2">
 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">Question</label>
 <textarea
 value={newQuestion}
 onChange={e => setNewQuestion(e.target.value)}
 placeholder="e.g. How would you rate team collaboration this week?"
 rows={2}
 className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>

 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">Poll Category</label>
 <select
 value={pollCategory}
 onChange={e => setPollCategory(e.target.value)}
 className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 >
 {POLL_CATEGORIES.map(c => (
 <option key={c.value} value={c.value}>{c.label}</option>
 ))}
 </select>
 </div>

 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">Answer type</label>
 <div className="flex gap-2">
 {(['choices','freetext'] as const).map(t => (
 <button
 key={t}
 onClick={() => setOptionType(t)}
 className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
 optionType === t
 ?'border-primary bg-primary text-primary-foreground'
 :'border-border/60 text-foreground hover:bg-muted'
 }`}
 >
 {t ==='choices'?'Multiple choice':'Free text'}
 </button>
 ))}
 </div>
 </div>

 {optionType ==='choices'&& (
 <div>
 <label className="mb-1.5 block text-sm font-medium text-foreground">
 Options <span className="text-muted-foreground">(one per line)</span>
 </label>
 <textarea
 value={newOptions}
 onChange={e => setNewOptions(e.target.value)}
 placeholder={"Strongly agree\nAgree\nNeutral\nDisagree"}
 rows={4}
 className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
 />
 </div>
 )}
 </div>

 <DialogFooter>
 <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
 <Button
 onClick={handleCreate}
 disabled={!newQuestion.trim() || createMut.isPending}
 >
 Create (Draft)
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 <ConfirmDialog
 open={!!closeTarget}
 title="Close pulse question?"
 message={closeTarget ? `Close "${closeTarget.question}"? It will stop accepting responses.` : ''}
 confirmLabel="Close"
 destructive
 onConfirm={() => closeTarget && patchMut.mutate({ id: closeTarget.id, status: 'closed' })}
 onCancel={() => setCloseTarget(null)}
 />
 </div>
 )
}
