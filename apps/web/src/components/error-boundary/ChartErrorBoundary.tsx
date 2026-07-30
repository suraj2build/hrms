import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BarChart2 } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Short label shown in the fallback, e.g. "Reliability Trends" */
  label?: string
  /**
   * When this value changes, the boundary clears the crashed state and
   * re-renders its children — e.g. pass the data/date-range driving the
   * chart so a new query result gets a fresh render attempt instead of
   * staying stuck on the placeholder forever (mirrors ErrorBoundary.tsx's
   * resetKey pattern).
   */
  resetKey?: string | number
}

interface State {
  crashed: boolean
  prevResetKey?: string | number
}

/**
 * Lightweight error boundary for individual chart / KPI widgets.
 * Shows a muted placeholder instead of a blank space when Recharts or a
 * data-mapping helper throws during render.
 *
 * @example
 *   <ChartErrorBoundary label="Reliability Trends" resetKey={data}>
 *     <ReliabilityTrends data={data} />
 *   </ChartErrorBoundary>
 */
export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): Partial<State> {
    return { crashed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.prevResetKey) {
      return { crashed: false, prevResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChartErrorBoundary] Chart render error:', error, info.componentStack)
  }

  render() {
    if (!this.state.crashed) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[120px] rounded-md bg-muted/30 text-muted-foreground">
        <BarChart2 className="h-6 w-6 opacity-40" />
        <p className="text-xs">{this.props.label ?? 'Chart'} unavailable</p>
      </div>
    )
  }
}

export default ChartErrorBoundary
