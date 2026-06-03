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
  ready:            { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Ready'           },
  nearly_ready:     { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'Nearly Ready'    },
  needs_attention:  { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Needs Attention' },
  blocked:          { bg: 'bg-red-100',    text: 'text-red-800',    label: 'Blocked'         },
}

export function OnboardingReadiness({ sessionId }: { sessionId: string }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const { data, isLoading, isError } = useQuery<ReadinessData>({
    queryKey: ['onboarding-readiness', sessionId],
    queryFn: async () => {
      const res = await api.get<{ data: ReadinessData }>(`/intelligence/onboarding/${sessionId}/readiness`)
      return res.data
    },
    enabled: !!sessionId,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-gray-100" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Unable to load readiness summary.
      </div>
    )
  }

  const badge = BADGE_STYLES[data.readiness_score] ?? BADGE_STYLES.needs_attention

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-700">Onboarding Readiness</span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Readiness text */}
      <p className="text-sm text-gray-600">{data.readiness_text}</p>

      {/* Document stats */}
      {data.documents.total > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span>Total: <strong className="text-gray-700">{data.documents.total}</strong></span>
          <span className="text-green-700">Extracted: <strong>{data.documents.extracted}</strong></span>
          {data.documents.pending > 0 && (
            <span className="text-yellow-700">Pending: <strong>{data.documents.pending}</strong></span>
          )}
          {data.documents.failed > 0 && (
            <span className="text-orange-700">Failed: <strong>{data.documents.failed}</strong></span>
          )}
          {data.documents.rejected > 0 && (
            <span className="text-red-700">Rejected: <strong>{data.documents.rejected}</strong></span>
          )}
        </div>
      )}

      {/* Suggested actions */}
      {data.suggested_actions.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">Suggested Actions</p>
          <ul className="space-y-1">
            {data.suggested_actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
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
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {sourcesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Why this score?
          </button>
          {sourcesOpen && (
            <div className="mt-2 rounded-md bg-gray-50 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-500">Data sources consulted</p>
              <ul className="space-y-0.5">
                {data.sources.map(src => (
                  <li key={src} className="text-xs text-gray-600 font-mono">{src}</li>
                ))}
              </ul>
              {(data.missing_fields.length > 0 || data.validation_errors.length > 0) && (
                <div className="pt-1 border-t border-gray-200 space-y-1">
                  {data.missing_fields.length > 0 && (
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">Missing fields:</span>{' '}
                      {data.missing_fields.join(', ')}
                    </p>
                  )}
                  {data.validation_errors.length > 0 && (
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">Validation errors:</span>{' '}
                      {data.validation_errors.join('; ')}
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400">
                Generated {new Date(data.generated_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
