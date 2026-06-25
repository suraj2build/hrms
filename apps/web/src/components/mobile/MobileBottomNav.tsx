import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Clock3, CalendarDays, Wallet, LayoutGrid, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { glossy } from './glossy'

export interface MobileTab {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  path: string
}

/** Employee bottom-nav tabs. `base` is /ess or /manager/self. */
// eslint-disable-next-line react-refresh/only-export-components -- tab config colocated with the nav by design
export function employeeTabs(base: string): MobileTab[] {
  return [
    { key: 'home',       label: 'Home',       icon: Home,         path: `${base}/dashboard` },
    { key: 'attendance', label: 'Attendance', icon: Clock3,       path: `${base}/attendance` },
    { key: 'leave',      label: 'Leave',      icon: CalendarDays, path: `${base}/leave/balance` },
    { key: 'payslip',    label: 'Payslip',    icon: Wallet,       path: `${base}/compensation` },
    { key: 'more',       label: 'More',       icon: LayoutGrid,   path: `${base}/more` },
  ]
}

export function MobileBottomNav({
  tabs, onFab,
}: { tabs: MobileTab[]; onFab?: () => void }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const isActive = (t: MobileTab) =>
    pathname === t.path || pathname.startsWith(t.path + '/') ||
    (t.key === 'leave' && pathname.includes('/leave')) ||
    (t.key === 'payslip' && pathname.includes('/compensation'))

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="relative mx-auto flex max-w-md items-end justify-between px-5 pb-2 pt-2.5">
        {tabs.slice(0, 2).map((t) => <NavBtn key={t.key} tab={t} active={isActive(t)} onClick={() => navigate(t.path)} />)}
        <div className="w-12" />
        {tabs.slice(2, 4).map((t) => <NavBtn key={t.key} tab={t} active={isActive(t)} onClick={() => navigate(t.path)} />)}
        {tabs[4] && <NavBtn tab={tabs[4]} active={isActive(tabs[4])} onClick={() => navigate(tabs[4].path)} />}

        {/* centre FAB */}
        <button
          aria-label="Quick punch"
          onClick={onFab}
          className="absolute left-1/2 top-0 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl text-white"
          style={glossy('#1A4D8F', '#15B8A6')}
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>
    </nav>
  )
}

function NavBtn({ tab, active, onClick }: { tab: MobileTab; active: boolean; onClick: () => void }) {
  const Icon = tab.icon
  return (
    <button onClick={onClick} className={cn('flex flex-col items-center gap-0.5', active ? 'text-[#1A4D8F]' : 'text-muted-foreground')}>
      <Icon className="h-[18px] w-[18px]" />
      <span className="text-[9px] font-medium">{tab.label}</span>
    </button>
  )
}
