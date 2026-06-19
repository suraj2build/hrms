/**
 * IconRail — 68px primary navigation rail (Operational OS).
 *
 * Layout: dark slate bg-[#0F172A], icon buttons for 5 workspaces,
 * active state = left indigo accent bar + bg-[#1E293B],
 * tooltip on hover, LIVE beacon at bottom.
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { DOMAINS, getDomainForPath } from './nav-config'

// Domain → workspace label (short form for micro-labels)
const DOMAIN_MICRO: Record<string, string> = {
  'daily-ops':    'Ops',
  'payroll':      'Pay',
  'compliance':   'Legal',
  'reports':      'Data',
  'advanced-ops': 'Adv',
  'setup':        'Admin',
}

export function IconRail() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const activeDomain = getDomainForPath(location.pathname)

  return (
    <div className="w-[68px] h-full bg-[#0F172A] flex flex-col items-center py-4 border-r border-border justify-between shrink-0 z-30">

      {/* Top: brand + workspace buttons */}
      <div className="w-full flex flex-col items-center gap-1">

        {/* Brand mark */}
        <div className="mb-4 flex flex-col items-center">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center font-black text-white text-base shadow-lg shadow-primary/30 select-none">
            W
          </div>
          <div className="text-[7px] text-center text-muted-foreground font-bold uppercase mt-1 tracking-widest select-none">
            OP OS
          </div>
        </div>

        {/* Workspace buttons */}
        <div className="w-full flex flex-col items-center gap-2 px-1">
          {DOMAINS.map(domain => {
            const isActive = activeDomain?.id === domain.id
            const Icon = domain.icon
            const microLabel = DOMAIN_MICRO[domain.id] ?? domain.shortLabel ?? domain.label.slice(0, 5)
            return (
              <button
                key={domain.id}
                type="button"
                onClick={() => navigate(domain.defaultRoute)}
                title={domain.label}
                className={cn(
                  'w-12 h-12 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer relative group',
                  isActive
                    ? 'bg-[#1E293B] text-white'
                    : 'text-muted-foreground hover:text-muted-foreground hover:bg-muted/50',
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[7px] mt-0.5 uppercase tracking-tight whitespace-nowrap opacity-80 font-semibold select-none">
                  {microLabel}
                </span>

                {/* Active left accent bar */}
                {isActive && (
                  <span className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r-md" />
                )}

                {/* Hover tooltip */}
                <div className="absolute left-[60px] bg-[#0F172A] text-white text-[10px] py-1 px-2 rounded-md shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 whitespace-nowrap z-50 font-bold border border-border">
                  {domain.label}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom: LIVE beacon */}
      <div className="flex flex-col items-center gap-1.5 opacity-90 mb-1">
        <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
        <span className="text-[8px] text-success font-bold font-mono select-none">LIVE</span>
      </div>

    </div>
  )
}
