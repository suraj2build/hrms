/**
 * AdminComingSoon — placeholder for admin domains that are planned but
 * intentionally deferred (e.g. Recruitment/ATS). No data, no API — UI only.
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

const FEATURE_LABELS: Record<string, string> = {
  'recruitment': 'Recruitment & ATS',
}

const FEATURE_BLURBS: Record<string, string> = {
  'recruitment':
    'End-to-end hiring — requisitions, approvals, candidate pipeline, interviews, ' +
    'offers and seamless join-to-employee handoff. This module is on the roadmap ' +
    'and will arrive in a future release.',
}

export function AdminComingSoon() {
  const location = useLocation()
  const navigate = useNavigate()

  const segments = location.pathname.split('/').filter(Boolean)
  const lastSeg  = segments[segments.length - 1] ?? ''
  const label    = FEATURE_LABELS[lastSeg] ?? lastSeg
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
  const blurb = FEATURE_BLURBS[lastSeg] ??
    'This module is on the roadmap and will be available in a future release.'

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] flex items-center justify-center">
        <Sparkles className="h-8 w-8 text-white" />
      </div>

      <div className="space-y-3 max-w-md">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-xl font-semibold text-foreground">{label}</h2>
          <span className="text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            Coming Soon
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{blurb}</p>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate('/admin/employees')}
        className="gap-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Workforce
      </Button>
    </div>
  )
}

export default AdminComingSoon
