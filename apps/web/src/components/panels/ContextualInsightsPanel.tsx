import React, { useMemo } from 'react'
import { useLocation, Link } from 'react-router-dom'
import {
  Clock,
  Users,
  CalendarDays,
  DollarSign,
  LayoutDashboard,
  FileText,
  SearchIcon,
} from 'lucide-react'
import { AttendanceContextPanel } from './AttendanceContextPanel'
import { RosterContextPanel } from './RosterContextPanel'
import { PayrollContextPanel } from './PayrollContextPanel'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecentPage {
  path: string
  label: string
  timestamp: number
}

// ── Quick links ────────────────────────────────────────────────────────────────

interface QuickLink {
  label: string
  to: string
  icon: React.ReactNode
}

const QUICK_LINKS: QuickLink[] = [
  { label: 'Attendance', to: '/admin/attendance', icon: <Clock className="w-3.5 h-3.5" /> },
  { label: 'Roster Policies', to: '/admin/masters/rosters', icon: <CalendarDays className="w-3.5 h-3.5" /> },
  { label: 'Payroll', to: '/admin/payroll', icon: <DollarSign className="w-3.5 h-3.5" /> },
  { label: 'Employees', to: '/admin/employees', icon: <Users className="w-3.5 h-3.5" /> },
]

// ── Recent pages helper ────────────────────────────────────────────────────────

function loadRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem('ux2_recent_pages')
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as unknown[])
      .filter(
        (item): item is RecentPage =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).path === 'string' &&
          typeof (item as Record<string, unknown>).label === 'string' &&
          typeof (item as Record<string, unknown>).timestamp === 'number',
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3)
  } catch {
    return []
  }
}

// ── Default panel ──────────────────────────────────────────────────────────────

function DefaultInsightsPanel() {
  const recentPages = useMemo(() => loadRecentPages(), [])

  return (
    <div className="text-sm">
      {/* Quick Links */}
      <div className="px-3 py-2.5 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">Quick Links</span>
          <LayoutDashboard className="w-3.5 h-3.5 text-muted-foreground" aria-label="Quick links" />
        </div>
        <div className="grid grid-cols-2 gap-1">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-1.5 text-xs text-foreground hover:text-primary py-1 px-1.5 rounded hover:bg-primary/10 transition-colors"
            >
              <span className="text-muted-foreground">{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-3 py-2.5 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">Recent Activity</span>
          <FileText className="w-3.5 h-3.5 text-muted-foreground" aria-label="Recent pages" />
        </div>
        {recentPages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent pages yet.</p>
        ) : (
          <div className="space-y-1">
            {recentPages.map((page) => (
              <Link
                key={`${page.path}-${page.timestamp}`}
                to={page.path}
                className="flex items-center gap-1.5 text-xs text-foreground hover:text-primary py-0.5 hover:underline truncate block"
              >
                {page.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Keyboard shortcut reminder */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SearchIcon className="w-3.5 h-3.5 shrink-0" aria-label="Search" />
          <span>
            <kbd className="px-1 py-0.5 rounded border border-border text-foreground font-mono text-xs">
              ⌘K
            </kbd>{' '}
            to search
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Orchestrator ───────────────────────────────────────────────────────────────

export function ContextualInsightsPanel() {
  const { pathname } = useLocation()

  const panel = useMemo<'payroll' | 'roster' | 'attendance' | null>(() => {
    if (pathname.includes('/payroll')) return 'payroll'
    if (
      pathname.includes('/roster') ||
      pathname.includes('/masters/rosters') ||
      pathname.includes('/masters/rotation-policies') ||
      pathname.includes('/employee-shifts')
    )
      return 'roster'
    if (pathname.includes('/attendance') || pathname.includes('/shift'))
      return 'attendance'
    return null
  }, [pathname])

  if (!panel) return <DefaultInsightsPanel />
  if (panel === 'payroll') return <PayrollContextPanel />
  if (panel === 'roster') return <RosterContextPanel />
  return <AttendanceContextPanel />
}
