/**
 * ManpowerIntelligenceCenter — the workforce intelligence hub under Insight Hub.
 *
 * Brings the two people-intelligence views under one roof:
 *   • Headcount Analytics — distribution, reliability and movement patterns
 *   • Workforce Signals    — live prioritised observations about your people
 *
 * Each tab embeds an existing page in headerless ("embedded") mode so the
 * shared PageHero band reads as the single title for the center.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Activity } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHero } from '@/components/layout/PageHero'
import { SubTabs } from '@/components/ui/SubTabs'
import { Button } from '@/components/ui/button'
import { WorkforceAnalytics } from '@/pages/attendance/WorkforceAnalytics'
import { WorkforceCommand } from '@/pages/intelligence/WorkforceCommand'

type TabKey = 'headcount' | 'signals'

const TABS: { id: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'headcount', label: 'Headcount Analytics', icon: Users },
  { id: 'signals',   label: 'Workforce Signals',   icon: Activity },
]

export function ManpowerIntelligenceCenter() {
  const [tab, setTab] = useState<TabKey>('headcount')
  const navigate = useNavigate()

  return (
    <PageContainer>
      <PageHero
        eyebrow="Insight Hub · Workforce Intelligence"
        title="Manpower Intelligence Center"
        subtitle="The single window into your people data — headcount analytics and live workforce signals, side by side."
        actions={
          <Button size="sm" variant="outline"
            className="h-8 gap-1.5 border-white/20 bg-white/10 text-white hover:bg-white/20"
            onClick={() => navigate('/admin/insights')}>
            All Insights
          </Button>
        }
      />

      <SubTabs<TabKey>
        tabs={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'headcount' && <WorkforceAnalytics embedded />}
        {tab === 'signals'   && <WorkforceCommand embedded />}
      </div>
    </PageContainer>
  )
}

export default ManpowerIntelligenceCenter
