/**
 * ProgressBand — the motivational Progress pattern (§3.5).
 *
 * A deliberately LIGHT band (not a panel): one warm heading, one ambient
 * encouragement line, and ≤3 word-hints. Motivates, never reports — no charts,
 * no grades, no percentages-as-judgement, never a peer ranking. Extracted from
 * Home's Movement 7. Renders nothing when there's nothing genuine to celebrate.
 */

import * as React from 'react'
import { AmbientLine } from './AmbientLine'

export interface ProgressBandData {
  heading: string
  ambient: string
  hints:   { label: string; value: string }[]
}

export function ProgressBand({ data, className }: { data: ProgressBandData | null | undefined; className?: string }) {
  if (!data) return null
  return (
    <div className={className}>
      <h2 className="mb-2 text-base font-semibold text-foreground">{data.heading || 'You’re doing well'}</h2>
      <AmbientLine>{data.ambient}</AmbientLine>
      {data.hints.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 pl-5 text-xs text-muted-foreground">
          {data.hints.map((h) => (
            <span key={h.label}>
              {h.label} · <span className="font-medium text-foreground">{h.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
