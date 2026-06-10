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
import { useQuery } from '@tanstack/react-query'
import { HelpCircle, X, Lightbulb, Sparkles, Search as SearchIcon } from 'lucide-react'
import { getHelpForPath } from '@/lib/help/help-content'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

interface GuidanceCfg {
  features: Record<string, boolean>
  roles:    Record<string, boolean>
  modules:  Record<string, boolean>
}

// Map the current route to a guidance "module" key (for per-module visibility).
function moduleForPath(path: string): string | null {
  if (path.startsWith('/admin/employees'))   return 'employee_master'
  if (path.startsWith('/admin/onboarding'))  return 'onboarding'
  if (path.startsWith('/admin/attendance'))  return 'attendance'
  if (path.startsWith('/admin/leave'))       return 'leave'
  if (path.startsWith('/admin/payroll'))     return 'payroll'
  if (path.startsWith('/admin/separation'))  return 'separation'
  if (path.startsWith('/admin/assets'))      return 'assets'
  if (path.startsWith('/admin/executive') || path.startsWith('/admin/intelligence')) return 'executive_intelligence'
  return null
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

export function HelpDrawer() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const help = getHelpForPath(location.pathname)
  const role = useAuthStore(s => s.profile?.role)

  // Respect the tenant's Help & Guidance settings (Company Settings → Help & Guidance).
  const { data: cfgRes } = useQuery<{ data: GuidanceCfg } | GuidanceCfg>({
    queryKey: ['guidance-config'],
    queryFn:  () => api.get('/workspace/guidance/config'),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const g = (cfgRes as any)?.data ?? (cfgRes as any) ?? null
  const f = (g?.features ?? {}) as Record<string, boolean>
  const r = (g?.roles    ?? {}) as Record<string, boolean>
  const m = (g?.modules  ?? {}) as Record<string, boolean>

  const roleKey =
    role === 'super_admin' ? 'admin_help_enabled' :
    role === 'hr_admin'    ? 'hr_help_enabled' :
    role === 'manager'     ? 'manager_help_enabled' :
                             'employee_help_enabled'
  const moduleKey = moduleForPath(location.pathname)

  // Default-on: only hide when a setting is explicitly false.
  const masterOn = f.enable_help_framework !== false
  const roleOn   = r[roleKey] !== false
  const moduleOn = !moduleKey || m[moduleKey] !== false
  const enabled  = masterOn && roleOn && moduleOn

  const showProcess = f.enable_process_guides   !== false
  const showWhy     = f.enable_why_explanations !== false

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Hidden entirely when the tenant has disabled help for this role/module.
  if (!enabled) return null

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

      {/* ── Floating help popover (compact, bottom-right — does not cover the page) ── */}
      <aside
        className={cn(
          'fixed bottom-5 right-5 z-[70] flex max-h-[78vh] w-[360px] flex-col overflow-hidden rounded-2xl',
          'border border-border bg-card shadow-[0_24px_70px_-15px_rgba(16,24,40,0.45)] origin-bottom-right',
          'transition-all duration-200 ease-out',
          open ? 'scale-100 opacity-100' : 'pointer-events-none translate-y-3 scale-95 opacity-0',
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

          {help.why && showWhy && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <p className="text-[12px] leading-relaxed text-foreground"><span className="font-semibold text-primary">Why it matters: </span>{help.why}</p>
            </div>
          )}

          {/* Steps */}
          {showProcess && (
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
          )}

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
