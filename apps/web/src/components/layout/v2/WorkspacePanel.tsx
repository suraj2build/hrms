/**
 * WorkspacePanel — 216px contextual workspace sub-navigation panel (Operational OS).
 *
 * Shows the nav items for the currently active domain.
 * Active item: bg-indigo-50 text-indigo-700 border-l-2 border-indigo-600
 * Footer: density engine switcher (Lux/Comp/Dense) — persisted to localStorage.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { getDomainForPath } from './nav-config'

// ── Density persistence ────────────────────────────────────────────────────────

const DENSITY_KEY = 'op_os_density'
export type DensityMode = 'comfortable' | 'compact' | 'dense'

function loadDensity(): DensityMode {
  try {
    const v = localStorage.getItem(DENSITY_KEY)
    if (v === 'comfortable' || v === 'compact' || v === 'dense') return v
  } catch { /* ignore */ }
  return 'comfortable'
}

function saveDensity(mode: DensityMode) {
  try { localStorage.setItem(DENSITY_KEY, mode) } catch { /* ignore */ }
}

// Sub-item padding varies by density
function subItemPadding(mode: DensityMode) {
  if (mode === 'dense')     return 'py-1 px-2.5 text-[11px] gap-1.5'
  if (mode === 'compact')   return 'py-1.5 px-3 text-xs gap-2'
  return 'py-2 px-3.5 text-xs gap-3'
}

// ── WorkspacePanel ─────────────────────────────────────────────────────────────

export function WorkspacePanel() {
  const location = useLocation()
  const domain   = getDomainForPath(location.pathname)
  const [density, setDensityState] = useState<DensityMode>(loadDensity)

  const setDensity = (mode: DensityMode) => {
    setDensityState(mode)
    saveDensity(mode)
    // Propagate to document root for global density-aware utilities
    document.documentElement.dataset.density = mode
  }

  // Sync document density attribute on mount
  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [])

  // Flatten all items across groups for the current domain
  const items = useMemo(
    () => domain?.groups?.flatMap(g => g.items) ?? [],
    [domain],
  )

  const workspaceTitle = domain?.label ?? 'Workspace'

  return (
    <div className="w-[216px] h-full flex flex-col border-r border-indigo-100/50 bg-white/70 backdrop-blur-sm shrink-0">

      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-[#E8E6F5] shrink-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="h-3 w-0.5 bg-indigo-500 rounded-full shrink-0" />
          <h2 className="text-[10px] font-black text-[#1C1B2E] uppercase tracking-[0.1em] truncate">
            {workspaceTitle}
          </h2>
        </div>
        <p className="text-[9px] text-[#A8A4C8] font-mono font-medium pl-2">
          MISSION CONTROL
        </p>
      </div>

      {/* Nav items */}
      <div className="flex-1 py-2 px-2 overflow-y-auto space-y-0.5">
        {items.map(item => {
          // Compute active state (supports query-param routes)
          const qi = item.route.indexOf('?')
          const isActive = (() => {
            if (qi !== -1) {
              return (
                location.pathname === item.route.slice(0, qi) &&
                location.search === item.route.slice(qi)
              )
            }
            return item.exact
              ? location.pathname === item.route
              : location.pathname === item.route ||
                location.pathname.startsWith(item.route + '/')
          })()

          return (
            <Link
              key={item.id}
              to={item.route}
              className={cn(
                'w-full flex items-center justify-between rounded-lg cursor-pointer transition-all text-left',
                subItemPadding(density),
                isActive
                  ? 'bg-[#EAE8F8] text-[#3730A3] font-semibold border-l-2 border-[#6C63D8]'
                  : 'text-[#5C5A7C] hover:bg-[#F0EFF8] hover:text-[#3730A3]',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <item.icon
                  className={cn(
                    'w-3.5 h-3.5 shrink-0 transition-colors',
                    isActive ? 'text-[#6C63D8]' : 'text-[#A8A4C8]',
                  )}
                />
                <span className="truncate">{item.label}</span>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Density Engine footer */}
      <div className="p-3 border-t border-[#E8E6F5] bg-[#F8F7FF] space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold text-[#A8A4C8] uppercase tracking-wider font-mono">
            DENSITY
          </span>
          <span className="text-[8px] bg-violet-100 text-violet-700 font-extrabold rounded px-1 uppercase font-mono">
            {density}
          </span>
        </div>
        <div className="grid grid-cols-3 bg-white p-0.5 border border-[#E5E7EB] rounded-lg shadow-sm">
          {(['comfortable', 'compact', 'dense'] as DensityMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setDensity(mode)}
              className={cn(
                'py-1 text-[9px] font-bold text-center rounded-md cursor-pointer transition-all',
                density === mode
                  ? 'bg-[#6C63D8] text-white shadow-sm'
                  : 'text-[#A8A4C8] hover:text-[#3730A3] hover:bg-[#EEEDF7]',
              )}
              title={`${mode} view scaling`}
            >
              {mode === 'comfortable' ? 'Lux' : mode === 'compact' ? 'Comp' : 'Dense'}
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
