/**
 * EssRunbooks — /ess/runbooks
 *
 * Employee-facing how-to guides. A simple two-pane hub (list + steps) sourced
 * from the ESS runbook registry, with deep-links straight into each screen.
 */
import { useMemo, useState } from 'react'
import { BookOpen, ChevronRight, Lightbulb, Sparkles, Search } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { Input }         from '@/components/ui/input'
import { cn }            from '@/lib/utils'
import { RunbookLink }   from '@/components/runbooks/RunbookLink'
import { ESS_RUNBOOKS, type EssRunbook } from '@/lib/runbooks/ess-runbooks'

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

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase()
    if (!t) return ESS_RUNBOOKS
    return ESS_RUNBOOKS.filter(r =>
      r.title.toLowerCase().includes(t) ||
      r.summary.toLowerCase().includes(t) ||
      r.steps.some(s => s.title.toLowerCase().includes(t) || s.detail.toLowerCase().includes(t)),
    )
  }, [query])

  const selected: EssRunbook | undefined = useMemo(
    () => ESS_RUNBOOKS.find(r => r.id === selectedId) ?? filtered[0],
    [filtered, selectedId],
  )

  return (
    <PageContainer>
      <PageHeader title="How-To Guides" subtitle="Step-by-step help for everyday self-service tasks" />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* List */}
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
          <div className="max-h-[70vh] overflow-y-auto p-2 space-y-0.5">
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No guides match “{query}”.</p>
            ) : filtered.map(rb => (
              <button
                key={rb.id}
                onClick={() => setSelectedId(rb.id)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-[13px] transition-colors',
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
        </aside>

        {/* Detail */}
        <article className="rounded-lg border border-border bg-card p-5 min-h-[60vh]">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center text-muted-foreground">
              <BookOpen className="h-10 w-10 opacity-30" />
              <p className="text-sm">Pick a guide to get started.</p>
            </div>
          ) : (
            <div className="max-w-2xl">
              <h2 className="text-xl font-bold text-foreground">{selected.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{selected.summary}</p>

              <div className="mt-4">
                <RunbookLink to={selected.to} label="Take me there" variant="default" />
              </div>

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
                        {s.to && <RunbookLink to={s.to} label={s.cta ?? 'Take me there'} variant="ghost" />}
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
