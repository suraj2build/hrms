/**
 * OnboardingHub — unified Onboarding workspace.
 *
 * One hub, two stages of the same lifecycle:
 *   • Invites      → Pre-Onboarding: invite candidates, collect form + documents
 *   • AI Review    → AI document onboarding: extract, validate, approve → employee
 *
 * Tab is reflected in the URL (?tab=invites|review) so links/back-button work.
 */
import { useSearchParams } from 'react-router-dom'
import { UserPlus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageContainer } from '@/components/layout/PageContainer'
import { PreOnboarding } from './PreOnboarding'
import { OnboardingDashboard } from './OnboardingDashboard'

type TabKey = 'invites' | 'review'

const TABS: { key: TabKey; label: string; sub: string; icon: React.ElementType }[] = [
  { key: 'invites', label: 'Invites',   sub: 'Collect details + documents', icon: UserPlus },
  { key: 'review',  label: 'AI Review',  sub: 'Extract · validate · approve', icon: Sparkles },
]

export function OnboardingHub() {
  const [params, setParams] = useSearchParams()
  const active = (params.get('tab') as TabKey) ?? 'invites'

  function setTab(key: TabKey) {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', key)
      return next
    }, { replace: true })
  }

  return (
    <PageContainer>
      {/* Hub header */}
      <div className="mb-1">
        <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          From candidate invite to employee — collection, AI review, and approval in one place.
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-border mt-4 mb-6">
        {TABS.map(t => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'group relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground/60')} />
              <span className="flex flex-col items-start leading-tight">
                <span>{t.label}</span>
                <span className="text-[10px] font-normal text-muted-foreground/60">{t.sub}</span>
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-gradient-to-r from-[#047857] via-[#0F766E] to-[#1E40AF]" />
              )}
            </button>
          )
        })}
      </div>

      {/* Panel — mount the existing stage components (they bring their own toolbars) */}
      <div className="-mx-1">
        {active === 'invites' ? <PreOnboarding embedded /> : <OnboardingDashboard embedded />}
      </div>
    </PageContainer>
  )
}

export default OnboardingHub
