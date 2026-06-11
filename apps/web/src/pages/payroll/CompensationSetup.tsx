/**
 * CompensationSetup — /admin/payroll/setup
 *
 * SINGLE front-door hub for salary / compensation configuration.
 *
 *   Tab 1 — Salary Components   (component library)     → SalaryComponents
 *   Tab 2 — Salary Structures   (structure builder)     → CompensationMaster
 *   Tab 3 — Statutory Policy    (NLC · PF switch · TDS) → StatutoryPolicy
 *
 * Statutory Groups (per-state PF/ESI/PT/LWF applicability) is a geographic
 * master — it lives under Statutory Compliance in the sidebar, not here.
 *
 * Access: hr_admin / super_admin (each embedded page enforces its own guard).
 */

import { useSearchParams } from 'react-router-dom'
import { Layers, GitMerge, ShieldCheck } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { cn }            from '@/lib/utils'

import { SalaryComponents }   from '@/pages/payroll/SalaryComponents'
import { CompensationMaster } from '@/pages/payroll/CompensationMaster'
import { StatutoryPolicy }    from '@/pages/payroll/StatutoryPolicy'

// ── Tab registry ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'components', label: 'Salary Components', icon: Layers,      hint: 'Pay component library', Component: SalaryComponents   },
  { id: 'structures', label: 'Salary Structures', icon: GitMerge,    hint: 'CTC structure builder', Component: CompensationMaster },
  { id: 'policy',     label: 'Statutory Policy',  icon: ShieldCheck, hint: 'NLC · PF · TDS policy', Component: StatutoryPolicy    },
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
