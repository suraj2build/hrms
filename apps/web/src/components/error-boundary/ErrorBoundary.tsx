import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Send, Check, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/observability/report'
import { PromptDialog } from '@/components/ui/ConfirmDialog'

interface Props {
  children: ReactNode
  /** Optional fallback rendered instead of the default error card. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Page-level title shown in the default error card. */
  title?: string
  /**
   * When this value changes, the boundary clears any captured error and
   * re-renders its children. Pass the current route (e.g. location.pathname)
   * so navigating away from a broken page automatically recovers — otherwise a
   * single page crash leaves the boundary stuck, blanking every later page.
   */
  resetKey?: string | number
}

interface State {
  error: Error | null
  isChunk: boolean
  prevResetKey?: string | number
  componentStack?: string
  reportState: 'idle' | 'sending' | 'sent' | 'failed'
  copied: boolean
  promptOpen: boolean
}

const CHUNK_RELOAD_KEY = 'eb-chunk-reload-ts'
const CHUNK_RELOAD_GUARD_MS = 10_000

/**
 * A failed lazy-route `import()` after a deploy (old chunk hash 404s) is the most
 * common "red screen that flashes then disappears". Detect it so we can reload
 * to the fresh build instead of showing a scary error card.
 */
function isChunkLoadError(error: Error | null): boolean {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`
  return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module/i.test(text)
}

/** A reload is allowed unless we already reloaded for a chunk error very recently
 *  (prevents an infinite loop when a chunk is genuinely gone). */
function chunkReloadAllowed(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
    return Date.now() - last > CHUNK_RELOAD_GUARD_MS
  } catch { return true }
}

/** Persist the last few crashes so they can be retrieved even if the UI clears
 *  (the boundary auto-resets on navigation). Inspect via
 *  `JSON.parse(localStorage.getItem('cognixhr:errors'))`. */
function persistError(error: Error, componentStack?: string) {
  try {
    const entry = {
      t: new Date().toISOString(),
      msg: error.message || String(error),
      stack: [error.stack, componentStack].filter(Boolean).join('\n\n'),
      url: window.location.href,
    }
    const KEY = 'cognixhr:errors'
    const prev = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown[]
    localStorage.setItem(KEY, JSON.stringify([entry, ...prev].slice(0, 5)))
  } catch { /* storage may be unavailable; ignore */ }
}

/**
 * Page-level React Error Boundary.
 * Catches render-phase errors (including failed lazy-route loads) and shows a
 * recovery UI. Chunk-load errors auto-reload once to the fresh build.
 *
 * @example
 *   <ErrorBoundary title="Analytics">
 *     <ExecutiveIntelligence />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, isChunk: false, reportState: 'idle', copied: false, promptOpen: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, isChunk: isChunkLoadError(error) }
  }

  // Clear the captured error whenever the reset key (route) changes, so a crash
  // on one page never persists across navigation to a healthy page.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.prevResetKey) {
      return { error: null, isChunk: false, prevResetKey: props.resetKey, reportState: 'idle', copied: false, promptOpen: false }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack)
    persistError(error, info.componentStack ?? undefined)
    this.setState({ componentStack: info.componentStack ?? undefined })

    // Stale chunk after a deploy → reload once to pull the fresh build.
    if (isChunkLoadError(error) && chunkReloadAllowed()) {
      try { sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now())) } catch { /* ignore */ }
      window.location.reload()
    }
  }

  reset = () => this.setState({ error: null, isChunk: false, reportState: 'idle', copied: false, promptOpen: false })

  handleCopy = async () => {
    const { error, componentStack } = this.state
    if (!error) return
    const details = [
      `Message: ${error.message || 'Unhandled render error'}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      '',
      error.stack ?? '',
      componentStack ?? '',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(details)
      this.setState({ copied: true })
    } catch { /* clipboard blocked; the error is still in localStorage */ }
  }

  handleReport = () => {
    if (!this.state.error) return
    this.setState({ promptOpen: true })
  }

  submitReport = async (note: string) => {
    const { error, componentStack } = this.state
    this.setState({ promptOpen: false, reportState: 'sending' })
    const ok = await reportError({
      message: error?.message || 'Unhandled render error',
      stack: [error?.stack, componentStack].filter(Boolean).join('\n\n'),
      userNote: note || undefined,
      severity: 'crash',
    })
    this.setState({ reportState: ok ? 'sent' : 'failed' })
  }

  render() {
    const { error, isChunk } = this.state
    if (!error) return this.props.children

    // Chunk-load error we're about to reload from: show a calm "updating" state,
    // never the red error card.
    if (isChunk && chunkReloadAllowed()) {
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">Updating to the latest version…</p>
        </div>
      )
    }

    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <>
        <div className="flex flex-col items-center justify-center min-h-[320px] rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center gap-4">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="text-base font-semibold text-foreground">
              {this.props.title ? `${this.props.title} failed to load` : 'Something went wrong'}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md break-words">
              {error.message || 'An unexpected error occurred while rendering this page.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={this.reset} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={this.handleCopy} className="gap-2">
              {this.state.copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {this.state.copied ? 'Copied' : 'Copy details'}
            </Button>
            {this.state.reportState === 'sent' ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-success">
                <Check className="h-4 w-4" /> Reported — thank you
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={this.handleReport}
                disabled={this.state.reportState === 'sending'}
                className="gap-2"
              >
                <Send className="h-3.5 w-3.5" />
                {this.state.reportState === 'sending' ? 'Sending…'
                  : this.state.reportState === 'failed' ? 'Retry report'
                  : 'Report this problem'}
              </Button>
            )}
          </div>
        </div>
        <PromptDialog
          open={this.state.promptOpen}
          title="Report this problem"
          placeholder="Optional: what were you doing when this happened? (helps us fix it faster)"
          onConfirm={this.submitReport}
          onCancel={() => this.setState({ promptOpen: false })}
        />
      </>
    )
  }
}

export default ErrorBoundary
