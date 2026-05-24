import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BarChart2 } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Short label shown in the fallback, e.g. "Reliability Trends" */
  label?: string
}

interface State {
  crashed: boolean
}

/**
 * Lightweight error boundary for individual chart / KPI widgets.
 * Shows a muted placeholder instead of a blank space when Recharts or a
 * data-mapping helper throws during render.
 *
 * @example
 *   <ChartErrorBoundary label="Reliability Trends">
 *     <ReliabilityTrends data={data} />
 *   </ChartErrorBoundary>
 */
export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
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
