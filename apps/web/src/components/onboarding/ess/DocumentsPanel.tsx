/**
 * DocumentsPanel — read-only view of the new hire's onboarding documents and
 * their verification status. Sourced from the onboarding-status service; uploads
 * and re-shares are handled by HR / the token-based pre-join flow, not here.
 */

import { FileText, FileCheck2, FileClock, FileX2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { docLabel, isDocVerified, type OnboardingStatusDoc } from './onboarding-data'

function DocStatusBadge({ status }: { status: string }) {
  if (isDocVerified(status)) {
    return <Badge variant="success" className="gap-1 py-0 text-[10px]"><FileCheck2 className="h-3 w-3" />Verified</Badge>
  }
  if (status === 'failed' || status === 'rejected') {
    return <Badge variant="destructive" className="gap-1 py-0 text-[10px]"><FileX2 className="h-3 w-3" />Action needed</Badge>
  }
  return <Badge variant="secondary" className="gap-1 py-0 text-[10px]"><FileClock className="h-3 w-3" />Processing</Badge>
}

export function DocumentsPanel({ docs }: { docs: OnboardingStatusDoc[] }) {
  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No documents on file yet.</p>
      </div>
    )
  }

  const sorted = docs.slice().sort((a, b) => docLabel(a.document_type).localeCompare(docLabel(b.document_type)))

  return (
    <div className="space-y-2">
      {sorted.map(d => (
        <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{docLabel(d.document_type)}</span>
          <DocStatusBadge status={d.extraction_status} />
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted-foreground">
        Documents are reviewed by HR. If something needs attention, your HR team will reach out.
      </p>
    </div>
  )
}

export default DocumentsPanel
