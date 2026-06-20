/**
 * TeamPay — /manager/team/pay
 *
 * Consolidates the two team-money views under one workspace so the distinction
 * is explicit rather than two look-alike nav items:
 *
 *   • Compensation  — annual CTC & increment recommendations (forward-looking)
 *   • Monthly Cost  — actual gross/net/OT/LOP from a payroll run (backward-looking)
 *
 * Each tab embeds its existing page component (embedded mode strips the inner
 * page chrome), so the underlying screens stay independently routable/testable.
 */
import { useState } from 'react'
import { IndianRupee, Coins } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { cn }            from '@/lib/utils'
import { ManagerCompensation }   from './ManagerCompensation'
import { ManagerTeamPayrollCost } from './ManagerTeamPayrollCost'

type Tab = 'compensation' | 'cost'

const TABS: { key: Tab; label: string; icon: typeof IndianRupee; hint: string }[] = [
  { key: 'compensation', label: 'Compensation', icon: IndianRupee, hint: 'CTC & increments' },
  { key: 'cost',         label: 'Monthly Cost',  icon: Coins,       hint: 'Gross / net / OT / LOP' },
]

export function TeamPay() {
  const [tab, setTab] = useState<Tab>('compensation')

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Manager' }, { label: 'Team Pay' }]}
        title="Team Pay"
        subtitle="Your team's compensation and monthly payroll cost"
      />

      {/* Tab bar */}
      <div className="mb-4 flex items-center gap-1 p-1 bg-muted/40 rounded-lg w-fit">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              <span className="hidden sm:inline text-[10px] text-muted-foreground/70 font-normal">· {t.hint}</span>
            </button>
          )
        })}
      </div>

      {tab === 'compensation' ? <ManagerCompensation embedded /> : <ManagerTeamPayrollCost embedded />}
    </PageContainer>
  )
}
