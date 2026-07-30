import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { ChevronDown, ChevronUp } from 'lucide-react'

type ReadinessScore = 'ready' | 'nearly_ready' | 'needs_attention' | 'blocked'

interface ReadinessData {
  session_id: string
  candidate_name: string | null
  readiness_score: ReadinessScore
  readiness_text: string
  documents: {
    total: number
    extracted: number
    failed: number
    rejected: number
    pending: number
  }
  missing_fields: string[]
  validation_errors: string[]
  suggested_actions: string[]
  sources: string[]
  generated_at: string
}

const BADGE_STYLES: Record<ReadinessScore, { bg: string; text: string; label: string }> = {
  ready:            { bg: 'bg-success/15',  text: 'text-success',  label: 'Ready'           },
  nearly_ready:     { bg: 'bg-info/15',   text: 'text-info',   label: 'Nearly Ready'    },
  needs_attention:  { bg: 'bg-accent-coral/15', text: 'text-accent-coral', label: 'Needs Attention' },
  blocked:          { bg: 'bg-destructive/15',    text: 'text-destructive',    label: 'Blocked'         },
}

export function OnboardingReadiness({ sessionId }: { sessionId: string }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const { data, isLoading, isError } = useQuery<ReadinessData>({
    queryKey: ['onboarding-readiness', sessionId],
    // GET /intelligence/onboarding/:sessionId/readiness sends a bare
    // ReadinessData object, not { data: ReadinessData }.
    queryFn: () => api.get<ReadinessData>(`/intelligence/onboarding/${sessionId}/readiness`),
    enabled: !!sessionId,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-white p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Unable to load readiness summary.
      </div>
    )
  }

  const badge = BADGE_STYLES[data.readiness_score] ?? BADGE_STYLES.needs_attention

  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted-foreground">Onboarding Readiness</span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Readiness text */}
      <p className="text-sm text-muted-foreground">{data.readiness_text}</p>

      {/* Document stats */}
      {data.documents.total > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Total: <strong className="text-muted-foreground">{data.documents.total}</strong></span>
          <span className="text-success">Extracted: <strong>{data.documents.extracted}</strong></span>
          {data.documents.pending > 0 && (
            <span className="text-warning">Pending: <strong>{data.documents.pending}</strong></span>
          )}
          {data.documents.failed > 0 && (
            <span className="text-warning">Failed: <strong>{data.documents.failed}</strong></span>
          )}
          {data.documents.rejected > 0 && (
            <span className="text-destructive">Rejected: <strong>{data.documents.rejected}</strong></span>
          )}
        </div>
      )}

      {/* Suggested actions */}
      {data.suggested_actions.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Suggested Actions</p>
          <ul className="space-y-1">
            {data.suggested_actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground" />
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Why this score — expandable */}
      {data.sources.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setSourcesOpen(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Why this score?
          </button>
          {sourcesOpen && (
            <div className="mt-2 rounded-md bg-muted p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Data sources consulted</p>
              <ul className="space-y-0.5">
                {data.sources.map(src => (
                  <li key={src} className="text-xs text-muted-foreground font-mono">{src}</li>
                ))}
              </ul>
              {(data.missing_fields.length > 0 || data.validation_errors.length > 0) && (
                <div className="pt-1 border-t border-border space-y-1">
                  {data.missing_fields.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Missing fields:</span>{' '}
                      {data.missing_fields.join(', ')}
                    </p>
                  )}
                  {data.validation_errors.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Validation errors:</span>{' '}
                      {data.validation_errors.join('; ')}
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Generated {new Date(data.generated_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
