/**
 * HelpDrawer — page-aware Help & Guidance.
 *
 * Renders a floating "?" trigger (grouped with the search FAB, bottom-right) and
 * a non-blocking right-hand slide-out drawer with step-by-step guidance for the
 * current page. The main page stays fully interactive — there is no blocking
 * backdrop. Content comes from lib/help/help-content.ts (route-keyed).
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { HelpCircle, X, Lightbulb, Sparkles, Search as SearchIcon } from 'lucide-react'
import { getHelpForPath } from '@/lib/help/help-content'
import { cn } from '@/lib/utils'

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

export function HelpDrawer() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const help = getHelpForPath(location.pathname)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* ── Trigger — grouped just above the Search FAB ─────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Page guide & help"
        aria-label="Open page guide"
        className={cn(
          'group fixed bottom-[4.75rem] right-5 z-50 flex items-center gap-2 h-10 rounded-full pl-2.5 pr-3.5',
          'border border-primary/20 bg-card text-primary shadow-elev-2 ring-1 ring-black/5',
          'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elev-3',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          open && 'ring-2 ring-primary/40',
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
          <HelpCircle className="h-4 w-4" />
        </span>
        <span className="hidden text-[13px] font-semibold sm:inline">Guide</span>
      </button>

      {/* ── Drawer (non-blocking, pinned right) ─────────────────────────────── */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-[60] flex w-full max-w-[400px] flex-col',
          'border-l border-border bg-card shadow-[0_0_60px_-10px_rgba(16,24,40,0.35)]',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        {/* Header — brand gradient */}
        <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0E2A4E 0%, #1A4D8F 60%, #11335E 100%)' }}>
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/60">
                <Sparkles className="h-3 w-3" /> Page Guide
              </div>
              <h2 className="text-lg font-bold leading-tight text-white">{help.title}</h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close guide"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">{help.summary}</p>

          {help.why && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <p className="text-[12px] leading-relaxed text-foreground"><span className="font-semibold text-primary">Why it matters: </span>{help.why}</p>
            </div>
          )}

          {/* Steps */}
          <div className="mt-5">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Step by step</h3>
            <ol className="space-y-3">
              {help.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="gloss-sheen flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                    style={{ background: 'linear-gradient(145deg, #2260A8, #1A4D8F)' }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[13px] font-semibold text-foreground">{s.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground"><Rich text={s.detail} /></p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Tips */}
          {help.tips && help.tips.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-300/30 bg-amber-50/60 p-3.5 dark:bg-amber-500/5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-amber-700 dark:text-amber-400">
                <Lightbulb className="h-3.5 w-3.5" /> Good to know
              </div>
              <ul className="space-y-1.5">
                {help.tips.map((t, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-foreground/80">
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-500" />
                    <span><Rich text={t} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <SearchIcon className="h-3.5 w-3.5" />
            Tip: press <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd> to search for any page or person.
          </p>
        </div>
      </aside>
    </>
  )
}

export default HelpDrawer
