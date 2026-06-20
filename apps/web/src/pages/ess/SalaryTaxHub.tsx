/**
 * SalaryTaxHub — layout wrapper that consolidates the income-tax & declaration
 * pages under a single tabbed hub.
 *
 * Renders a horizontal sub-nav (Tax Planner · IT Statement · YTD Statement ·
 * TDS Recovery · HRA Declaration · Previous Employer) above an <Outlet/>. The
 * tabs use RELATIVE links so the same component serves both mount points:
 *   /ess/salary/*           (Employee Self Service)
 *   /manager/self/salary/*  (Manager Console — self view)
 *
 * Previously each of these was a separate top-level sidebar item (6 entries);
 * they are now one "Tax & Declarations" entry, with this hub handling the
 * sub-navigation.
 */

import { NavLink, Outlet } from 'react-router-dom'
import {
  Calculator, ScrollText, TrendingUp, Receipt, FileCheck, FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { to: 'tax-planner',       label: 'Tax Planner',       icon: Calculator },
  { to: 'it-statement',      label: 'IT Statement',      icon: ScrollText },
  { to: 'ytd',               label: 'YTD Statement',     icon: TrendingUp },
  { to: 'tds-recovery',      label: 'TDS Recovery',      icon: Receipt    },
  { to: 'hra',               label: 'HRA Declaration',   icon: FileCheck  },
  { to: 'previous-employer', label: 'Previous Employer', icon: FileText   },
]

export function SalaryTaxHub() {
  // Each child page renders its own PageContainer + PageHeader, so this wrapper
  // only contributes the sub-nav tab strip above the active page.
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 overflow-x-auto border-b border-border">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => cn(
                'flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors -mb-px border-b-2',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{t.label}</span>
            </NavLink>
          )
        })}
      </div>

      <Outlet />
    </div>
  )
}

export default SalaryTaxHub
