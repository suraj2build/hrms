import { useState }                             from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star,
  Plus, Trophy, TrendingUp, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { toast }   from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button }  from '@/components/ui/button'
import { api }     from '@/lib/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Analytics {
  total_30d:            number
  total_7d:             number
  unique_givers_30d:    number
  unique_receivers_30d: number
  monthly_budget:       number
  trend:                { date: string; count: number }[]
  top_givers:           { employee_id: string; name: string; points: number; count: number }[]
  top_receivers:        { employee_id: string; name: string; points: number; count: number }[]
}

interface AdminBadge {
  code:        string
  label:       string
  icon:        string | null
  description: string | null
  points:      number
  is_active:   boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star,
}
const ICON_OPTIONS = Object.keys(ICONS)

function BadgeIcon({ name, className }: { name: string | null; className?: string }) {
  const Cmp = (name && ICONS[name]) || Award
  return <Cmp className={className} />
}

function shortDate(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(day)}/${parseInt(m)}`
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'analytics' | 'badges' | 'budget'

export function AdminRecognition() {
  const qc  = useQueryClient()
  const [tab, setTab] = useState<Tab>('analytics')

  // Badge create state
  const [createOpen, setCreateOpen]         = useState(false)
  const [newCode, setNewCode]               = useState('')
  const [newLabel, setNewLabel]             = useState('')
  const [newDesc, setNewDesc]               = useState('')
  const [newIcon, setNewIcon]               = useState('Award')
  const [newPoints, setNewPoints]           = useState(10)

  // Budget edit state
  const [budgetEdit, setBudgetEdit]         = useState<number | null>(null)

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: analytics, isLoading: aLoading } = useQuery<Analytics>({
    queryKey:  ['admin-r-analytics'],
    queryFn:   () => api.get<{ data: Analytics }>('/recognition/admin/analytics').then(r => r.data),
    staleTime: 2 * 60_000,
  })

  const { data: badgesRaw } = useQuery<AdminBadge[]>({
    queryKey:  ['admin-r-badges'],
    queryFn:   () => api.get<{ data: AdminBadge[] }>('/recognition/admin/badges').then(r => r.data),
    staleTime: 60_000,
  })

  const { data: budgetData } = useQuery<{ monthly_points: number }>({
    queryKey:  ['admin-r-budget'],
    queryFn:   () => api.get<{ data: { monthly_points: number } }>('/recognition/admin/budget').then(r => r.data),
    staleTime: 60_000,
  })

  const badges = badgesRaw ?? []

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createBadgeMut = useMutation({
    mutationFn: () => api.post('/recognition/admin/badges', {
      code: newCode.trim().toLowerCase().replace(/\s+/g, '_'),
      label: newLabel.trim(),
      description: newDesc.trim() || undefined,
      icon: newIcon,
      points: newPoints,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-r-badges'] })
      qc.invalidateQueries({ queryKey: ['recognition-badges'] })
      setCreateOpen(false)
      setNewCode(''); setNewLabel(''); setNewDesc(''); setNewIcon('Award'); setNewPoints(10)
      toast.success('Badge created')
    },
    onError: () => toast.error('Could not create badge'),
  })

  const toggleBadgeMut = useMutation({
    mutationFn: ({ code, is_active }: { code: string; is_active: boolean }) =>
      api.patch(`/recognition/admin/badges/${code}`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-r-badges'] })
      qc.invalidateQueries({ queryKey: ['recognition-badges'] })
    },
    onError: () => toast.error('Could not update badge'),
  })

  const saveBudgetMut = useMutation({
    mutationFn: (monthly_points: number) =>
      api.patch('/recognition/admin/budget', { monthly_points }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-r-budget'] })
      qc.invalidateQueries({ queryKey: ['recognition-me'] })
      setBudgetEdit(null)
      toast.success('Budget updated')
    },
    onError: () => toast.error('Could not update budget'),
  })

  // ── Render ────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: 'analytics', label: 'Analytics' },
    { key: 'badges',    label: 'Badge Library' },
    { key: 'budget',    label: 'Budget Settings' },
  ]

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Recognition & Rewards</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage badges, budgets and recognition analytics</p>
        </div>
        {tab === 'badges' && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Badge
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/40">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Analytics tab ───────────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          {/* Stats strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {aLoading ? (
              Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/40" />
              ))
            ) : ([
              { label: 'Given (30d)',         value: analytics?.total_30d ?? 0,            icon: Gift },
              { label: 'Given (7d)',           value: analytics?.total_7d ?? 0,             icon: TrendingUp },
              { label: 'Unique givers (30d)', value: analytics?.unique_givers_30d ?? 0,    icon: Users },
              { label: 'Unique receivers (30d)', value: analytics?.unique_receivers_30d ?? 0, icon: Heart },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <s.icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{s.label}</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
              </div>
            )))}
          </div>

          {/* 30-day trend */}
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              30-Day Recognition Trend
            </p>
            {aLoading ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={analytics?.trend ?? []} barSize={8} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={4}
                  />
                  <Tooltip
                    formatter={(v: number) => [v, 'Recognitions']}
                    labelFormatter={shortDate}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {(analytics?.trend ?? []).map((_, i) => (
                      <Cell key={i} fill="#15B8A6" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top givers + receivers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Top givers */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Top Givers (30d)
              </p>
              {aLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />)}
                </div>
              ) : !analytics?.top_givers?.length ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-1">
                  {analytics.top_givers.map((g, i) => (
                    <div key={g.employee_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        i === 0 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-muted text-muted-foreground'
                      }`}>
                        {i === 0 ? <Trophy className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{g.name}</span>
                      <span className="text-xs text-muted-foreground">{g.count}×</span>
                      <span className="w-12 text-right text-sm font-bold text-primary tabular-nums">{g.points} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top receivers */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Top Receivers (30d)
              </p>
              {aLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />)}
                </div>
              ) : !analytics?.top_receivers?.length ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-1">
                  {analytics.top_receivers.map((r, i) => (
                    <div key={r.employee_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        i === 0 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-muted text-muted-foreground'
                      }`}>
                        {i === 0 ? <Trophy className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.count} kudos</span>
                      <span className="w-12 text-right text-sm font-bold text-primary tabular-nums">{r.points} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Badges tab ──────────────────────────────────────────────────────── */}
      {tab === 'badges' && (
        <div className="space-y-3">
          {badges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No badges yet.</p>
          ) : badges.map(b => (
            <div
              key={b.code}
              className={`flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 transition-opacity ${
                b.is_active ? 'border-border/60' : 'border-border/30 opacity-60'
              }`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                b.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                <BadgeIcon name={b.icon} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{b.label}</p>
                  {!b.is_active && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Inactive</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {b.description ?? b.code} · {b.points} pts
                </p>
              </div>
              <button
                onClick={() => toggleBadgeMut.mutate({ code: b.code, is_active: !b.is_active })}
                disabled={toggleBadgeMut.isPending}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                title={b.is_active ? 'Deactivate badge' : 'Activate badge'}
              >
                {b.is_active
                  ? <ToggleRight className="h-6 w-6 text-primary" />
                  : <ToggleLeft className="h-6 w-6" />
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Budget tab ──────────────────────────────────────────────────────── */}
      {tab === 'budget' && (
        <div className="max-w-sm space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-1">
                Monthly Recognition Budget
              </p>
              <p className="text-xs text-muted-foreground">
                Points each employee can give per calendar month. Resets on the 1st of each month.
              </p>
            </div>

            {budgetEdit !== null ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Points per month</label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={budgetEdit}
                    onChange={e => setBudgetEdit(parseInt(e.target.value) || 0)}
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveBudgetMut.mutate(budgetEdit)}
                    disabled={saveBudgetMut.isPending}
                  >
                    {saveBudgetMut.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBudgetEdit(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-foreground">
                    {budgetData?.monthly_points ?? 100}
                    <span className="ml-1.5 text-base font-normal text-muted-foreground">pts / month</span>
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setBudgetEdit(budgetData?.monthly_points ?? 100)}>
                  Edit
                </Button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Message-only kudos (no badge) are always allowed regardless of budget. Only points-bearing badges consume budget.
          </p>
        </div>
      )}

      {/* Create badge dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Badge</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Label *</label>
              <input
                type="text"
                value={newLabel}
                onChange={e => {
                  setNewLabel(e.target.value)
                  if (!newCode) setNewCode(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
                }}
                placeholder="e.g. Rising Star"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Code *</label>
              <input
                type="text"
                value={newCode}
                onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="e.g. rising_star"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Lowercase letters, numbers, underscores only.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="When to give this badge…"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map(name => {
                  const Ic = ICONS[name]!
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setNewIcon(name)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                        newIcon === name
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 text-muted-foreground hover:bg-muted'
                      }`}
                      title={name}
                    >
                      <Ic className="h-4 w-4" />
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Points</label>
              <input
                type="number"
                min={0}
                max={500}
                value={newPoints}
                onChange={e => setNewPoints(parseInt(e.target.value) || 0)}
                className="w-28 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createBadgeMut.mutate()}
              disabled={!newLabel.trim() || !newCode.trim() || createBadgeMut.isPending}
            >
              Create Badge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
