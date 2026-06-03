/**
 * Guidance drawers — thin wrappers over the existing ExplainabilityDrawer.
 * No new drawer primitive is introduced. Guidance bodies map 1:1 onto the
 * Explainability prop (summary / contributing_factors / recommended_actions).
 * confidence_score is intentionally omitted so no confidence badge renders.
 */
import { ExplainabilityDrawer } from '@/components/ui/intelligence'
import type { GuidanceEntry } from './guidance-config'

interface GuidanceDrawerProps {
  open: boolean
  onClose: () => void
  entry: GuidanceEntry | null
}

export function HelpDrawer({ open, onClose, entry }: GuidanceDrawerProps) {
  return (
    <ExplainabilityDrawer
      open={open}
      onClose={onClose}
      title={entry?.title ?? 'Help'}
      explainability={entry ? {
        summary: entry.body.summary,
        contributing_factors: entry.body.contributing_factors,
        recommended_actions: entry.body.recommended_actions,
      } : undefined}
    />
  )
}

export function ProcessGuideDrawer({ open, onClose, entry }: GuidanceDrawerProps) {
  return (
    <ExplainabilityDrawer
      open={open}
      onClose={onClose}
      title={entry?.title ?? 'Process guide'}
      explainability={entry ? { summary: entry.body.summary } : undefined}
    >
      {entry?.body.steps?.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Steps</p>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            {entry.body.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      ) : null}
    </ExplainabilityDrawer>
  )
}

export function WhyExplanationDrawer({ open, onClose, entry }: GuidanceDrawerProps) {
  return (
    <ExplainabilityDrawer
      open={open}
      onClose={onClose}
      title={entry?.title ?? 'Why this matters'}
      explainability={entry ? {
        summary: entry.body.summary,
        contributing_factors: entry.body.contributing_factors,
      } : undefined}
    />
  )
}
