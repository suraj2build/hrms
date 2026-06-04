/**
 * CompensationSetup — /admin/payroll/setup
 *
 * SINGLE front-door hub for all salary / compensation configuration.
 *
 * Consolidates the previously-scattered config surfaces into one tabbed
 * workspace. Each tab embeds the EXISTING config page component unchanged —
 * no business logic, API, or data-flow changes. Only the active tab mounts
 * (Radix Tabs unmounts inactive content), so embedded pages keep their own
 * data fetching with zero duplicate work.
 *
 *   Tab 1 — Salary Components   (component library)        → SalaryComponents
 *   Tab 2 — Salary Structures   (structure builder)        → CompensationMaster
 *   Tab 3 — Statutory Mappings  (per-state PF/ESI/PT/LWF)  → StatutoryGroups
 *   Tab 4 — Statutory Policy    (tenant PF rates / NLC)    → StatutoryPolicy
 *
 * The active tab is synced to the URL (?tab=) so links / refresh / back-button
 * land on the right section.
 *
 * Access: hr_admin / super_admin (each embedded page enforces its own guard).
 */

import { useSearchParams } from 'react-router-dom'
import { Layers, GitMerge, Landmark, ShieldCheck } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { cn }            from '@/lib/utils'

import { SalaryComponents }   from '@/pages/payroll/SalaryComponents'
import { CompensationMaster } from '@/pages/payroll/CompensationMaster'
import { StatutoryGroups }    from '@/pages/masters/StatutoryGroups'
import { StatutoryPolicy }    from '@/pages/payroll/StatutoryPolicy'

// ── Tab registry ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'components', label: 'Salary Components',  icon: Layers,      hint: 'Pay component library', Component: SalaryComponents   },
  { id: 'structures', label: 'Salary Structures',  icon: GitMerge,    hint: 'CTC structure builder', Component: CompensationMaster },
  { id: 'statutory',  label: 'Statutory Mappings', icon: Landmark,    hint: 'Per-state PF/ESI/PT/LWF', Component: StatutoryGroups   },
  { id: 'policy',     label: 'Statutory Policy',   icon: ShieldCheck, hint: 'PF rates · NLC',         Component: StatutoryPolicy    },
] as const

type TabId = (typeof TABS)[number]['id']

export function CompensationSetup() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as TabId | null
  const active: TabId = TABS.some(t => t.id === requested) ? (requested as TabId) : 'components'

  const ActiveComponent = TABS.find(t => t.id === active)!.Component

  return (
    <div className="flex flex-col">
      {/* Hub header + tab bar — embedded pages bring their own PageContainer below */}
      <PageContainer className="pb-0">
        <PageHeader
          title="Compensation Setup"
          subtitle="Configure salary components, structures, and statutory rules — all in one place."
        />

        <nav
          role="tablist"
          aria-label="Compensation setup sections"
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {TABS.map(t => {
            const Icon = t.icon
            const isActive = t.id === active
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => setParams(prev => {
                  const next = new URLSearchParams(prev)
                  next.set('tab', t.id)
                  return next
                }, { replace: true })}
                className={cn(
                  'group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium -mb-px',
                  'border-b-2 transition-colors focus-visible:outline-none',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
                title={t.hint}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            )
          })}
        </nav>
      </PageContainer>

      {/* Active config surface — renders its own PageContainer / data fetching */}
      <ActiveComponent />
    </div>
  )
}
