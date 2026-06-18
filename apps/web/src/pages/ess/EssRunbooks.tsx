/**
 * EssRunbooks — /ess/runbooks
 *
 * Employee-facing how-to guides. A two-pane hub (category tree + steps) sourced
 * from the ESS runbook registry, with deep-links straight into each screen —
 * some of which auto-open the relevant create dialog on arrival.
 */
import { useMemo, useState } from 'react'
import {
  BookOpen, ChevronRight, Lightbulb, Sparkles, Search,
  CalendarDays, CalendarClock, Wallet, Receipt, UserCircle,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Input }         from '@/components/ui/input'
import { cn }            from '@/lib/utils'
import { RunbookLink }   from '@/components/runbooks/RunbookLink'
import { ESS_RUNBOOKS, ESS_CATEGORY_ORDER, type EssRunbook } from '@/lib/runbooks/ess-runbooks'

const CATEGORY_ICON: Record<string, typeof BookOpen> = {
  'Leave & Time Off':    CalendarDays,
  'Attendance':          CalendarClock,
  'Pay & Tax':           Wallet,
  'Claims & Requests':   Receipt,
  'Profile & Documents': UserCircle,
}

interface EssCategory { label: string; runbooks: EssRunbook[] }

/** Group the flat runbook list into ordered categories. */
function groupByCategory(runbooks: EssRunbook[]): EssCategory[] {
  const byCat = new Map<string, EssRunbook[]>()
  for (const rb of runbooks) {
    const arr = byCat.get(rb.category) ?? []
    arr.push(rb)
    byCat.set(rb.category, arr)
  }
  const ordered: EssCategory[] = []
  const emit = (label: string) => {
    const list = byCat.get(label)
    if (list?.length) { ordered.push({ label, runbooks: list }); byCat.delete(label) }
  }
  ESS_CATEGORY_ORDER.forEach(emit)
  for (const label of [...byCat.keys()]) emit(label)  // anything not in the fixed order
  return ordered
}

/** Render text with **bold** segments highlighted in brand color. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <span key={i} className="font-semibold text-primary">{p.slice(2, -2)}</span>
          : <span key={i}>{p}</span>,
      )}
    </>
  )
}

export function EssRunbooks() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(ESS_RUNBOOKS[0]?.id ?? '')

  // Filter the flat list by search, then group the survivors into categories.
  const categories = useMemo(() => {
    const t = query.trim().toLowerCase()
    const matched = !t ? ESS_RUNBOOKS : ESS_RUNBOOKS.filter(r =>
      r.title.toLowerCase().includes(t) ||
      r.summary.toLowerCase().includes(t) ||
      r.steps.some(s => s.title.toLowerCase().includes(t) || s.detail.toLowerCase().includes(t)),
    )
    return groupByCategory(matched)
  }, [query])

  const selected: EssRunbook | undefined = useMemo(() => {
    const all = categories.flatMap(c => c.runbooks)
    return ESS_RUNBOOKS.find(r => r.id === selectedId && all.some(a => a.id === r.id))
      ?? categories[0]?.runbooks[0]
  }, [categories, selectedId])

  return (
    <PageContainer>
      <PageHeader title="How-To Guides" subtitle="Step-by-step help for everyday self-service tasks" />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* ── Left: searchable category → guide tree ──────────────────────── */}
        <aside className="rounded-lg border border-border bg-card overflow-hidden self-start">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search guides…"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {categories.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No guides match “{query}”.</p>
            ) : categories.map(cat => {
              const Icon = CATEGORY_ICON[cat.label] ?? BookOpen
              return (
                <div key={cat.label} className="mb-2">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {cat.label}
                  </div>
                  <div className="space-y-0.5">
                    {cat.runbooks.map(rb => (
                      <button
                        key={rb.id}
                        onClick={() => setSelectedId(rb.id)}
                        className={cn(
                          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                          rb.id === selected?.id
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-foreground/80 hover:bg-muted',
                        )}
                      >
                        <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-50" />
                        <span className="truncate">{rb.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── Right: selected guide ───────────────────────────────────────── */}
        <article className="rounded-lg border border-border bg-card p-5 min-h-[60vh]">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center text-muted-foreground">
              <BookOpen className="h-10 w-10 opacity-30" />
              <p className="text-sm">Pick a guide to get started.</p>
            </div>
          ) : (
            <div className="max-w-2xl">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3 w-3" /> {selected.category}
              </div>
              <h2 className="mt-1 text-xl font-bold text-foreground">{selected.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{selected.summary}</p>

              <div className="mt-4">
                <RunbookLink to={selected.to} action={selected.action} label="Take me there" variant="default" />
              </div>

              {/* Why it matters */}
              {selected.why && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                  <p className="text-[13px] leading-relaxed text-foreground">
                    <span className="font-semibold text-primary">Why it matters: </span>{selected.why}
                  </p>
                </div>
              )}

              <div className="mt-6">
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Step by step</h3>
                <ol className="space-y-4">
                  {selected.steps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 pt-0.5 space-y-1.5">
                        <p className="text-sm font-semibold text-foreground">{s.title}</p>
                        <p className="text-[13px] leading-relaxed text-muted-foreground"><Rich text={s.detail} /></p>
                        {s.to && <RunbookLink to={s.to} action={s.action} label={s.cta ?? 'Take me there'} variant="ghost" />}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {selected.tips && selected.tips.length > 0 && (
                <div className="mt-6 rounded-xl border border-warning/30 bg-warning/5 p-3.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-warning">
                    <Lightbulb className="h-3.5 w-3.5" /> Good to know
                  </div>
                  <ul className="space-y-1.5">
                    {selected.tips.map((t, i) => (
                      <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-foreground/80">
                        <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-warning" />
                        <span><Rich text={t} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 flex items-center gap-1.5 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                Still stuck? Raise a ticket from the Helpdesk and HR will help.
              </div>
            </div>
          )}
        </article>
      </div>
    </PageContainer>
  )
}

export default EssRunbooks
