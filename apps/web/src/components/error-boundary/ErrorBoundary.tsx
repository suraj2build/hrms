import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  prevResetKey?: string | number
}

/**
 * Page-level React Error Boundary.
 * Catches render-phase errors in the entire subtree and shows a recovery UI.
 * Place at the route level to prevent a single page crash from killing the whole app.
 *
 * @example
 *   <ErrorBoundary title="Analytics">
 *     <ExecutiveIntelligence />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  // Clear the captured error whenever the reset key (route) changes, so a crash
  // on one page never persists across navigation to a healthy page.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.prevResetKey) {
      return { error: null, prevResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console so existing monitoring picks it up
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center gap-4">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <div>
          <p className="text-base font-semibold text-foreground">
            {this.props.title ? `${this.props.title} failed to load` : 'Something went wrong'}
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            {error.message || 'An unexpected error occurred while rendering this page.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={this.reset} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    )
  }
}

export default ErrorBoundary
