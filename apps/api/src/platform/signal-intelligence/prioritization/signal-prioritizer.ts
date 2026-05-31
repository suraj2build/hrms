import type { PlatformSignal } from '../types/signal-types.js'

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 100,
  high:     75,
  warning:  40,
  info:     10,
}

const ENTITY_WEIGHTS: Record<string, number> = {
  employee:    1.0,
  branch:      0.9,
  payroll_run: 1.1,
  system:      0.7,
}

export class SignalPrioritizer {
  prioritize(signal: PlatformSignal): number {
    const severityScore  = SEVERITY_WEIGHTS[signal.severity] ?? 10
    const entityWeight   = ENTITY_WEIGHTS[signal.entity_type] ?? 1.0

    const now       = Date.now()
    const signalTs  = new Date(signal.timestamp).getTime()
    const ageMs     = now - signalTs

    let recencyBoost = 0
    if (ageMs <= 5 * 60 * 1000) {
      recencyBoost = 20
    } else if (ageMs <= 30 * 60 * 1000) {
      recencyBoost = 10
    }

    return Math.min(100, severityScore * entityWeight + recencyBoost)
  }

  prioritizeBatch(signals: PlatformSignal[]): PlatformSignal[] {
    return signals
      .map(s => ({ ...s, priority: this.prioritize(s) }))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }
}

export const signalPrioritizer = new SignalPrioritizer()
