/**
 * EssComingSoon — shown for ESS routes that are planned but not yet implemented.
 * Uses the current URL path to derive the feature name.
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { Construction, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Map known path segments → human-readable feature names
const FEATURE_LABELS: Record<string, string> = {
  'balance':          'Leave Balance',
  'calendar':         'Attendance Calendar',
  'loans':            'Loans & Advances',
  'documents':        'My Documents',
  'proofs':           'Uploaded Proofs',
  'approvals':        'Approvals',
  'team':             'My Team',
  'org-chart':        'Organisation Chart',
  'policies':         'Policies',
  'hr-support':       'HR Support',
  'helpdesk':         'Helpdesk',
  'schedule':         'My Schedule',
  'comp-off':         'Compensatory Off',
  'operational-center': 'Operational Hub',
}

export function EssComingSoon() {
  const location = useLocation()
  const navigate = useNavigate()

  // Derive feature name from last segment of the path
  const segments = location.pathname.split('/').filter(Boolean)
  const lastSeg  = segments[segments.length - 1] ?? ''
  const label    = FEATURE_LABELS[lastSeg] ?? lastSeg
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
        <Construction className="h-8 w-8 text-muted-foreground" />
      </div>

      <div className="space-y-2 max-w-sm">
        <h2 className="text-lg font-semibold text-foreground">{label}</h2>
        <p className="text-sm text-muted-foreground">
          This feature is being built and will be available soon.
          Check back in a future update.
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate('/ess/dashboard')}
        className="gap-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Dashboard
      </Button>
    </div>
  )
}
