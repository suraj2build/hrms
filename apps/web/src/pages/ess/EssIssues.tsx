/**
 * EssIssues — placeholder for the "My Issues" / ticketing module.
 * Will be replaced with a real issue-tracking UI in a future sprint.
 */

import { HelpCircle } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'

export function EssIssues() {
  return (
    <PageContainer>
      <PageHeader
        title="My Issues"
        subtitle="Raise and track HR support requests"
      />

      <SectionCard>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <HelpCircle className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Issue tracking coming soon</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Raise IT, HR, or facilities requests directly from your portal.
              This module will be available in a future release.
            </p>
          </div>
        </div>
      </SectionCard>
    </PageContainer>
  )
}
