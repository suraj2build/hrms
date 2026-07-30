import { useQuery } from '@tanstack/react-query'
import { PartyPopper } from 'lucide-react'
import { api } from '@/lib/api/client'
import { glossy } from '../glossy'

// GET /leave/holidays only ever returns is_optional=false rows and doesn't
// even send the field — no is_optional here to match.
interface HolidayRow { id: string; date: string; name: string }

const fmtDay = (d: string) => {
  const dt = new Date(d + 'T12:00:00Z')
  return isNaN(dt.getTime()) ? d : { day: String(dt.getUTCDate()).padStart(2, '0'), mon: dt.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) }
}

/** Upcoming company holidays — shared across Home & Leave. */
export function UpcomingHolidays({ limit = 3 }: { limit?: number }) {
  const year = new Date().getFullYear()
  const today = new Date().toLocaleDateString('en-CA')

  const { data } = useQuery<{ data: HolidayRow[] }>({
    queryKey: ['mobile-holidays', year],
    queryFn: () => api.get(`/leave/holidays?year=${year}`),
  })

  const upcoming = (data?.data ?? []).filter((h) => h.date >= today).slice(0, limit)
  if (upcoming.length === 0) return null

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold text-[#0F172A]">
        <PartyPopper className="h-3.5 w-3.5 text-[#7C3AED]" /> Upcoming holidays
      </p>
      <div className="space-y-2">
        {upcoming.map((h) => {
          const f = fmtDay(h.date)
          return (
            <div key={h.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-sm">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={glossy('#7C3AED', '#A78BFA')}>
                <span className="text-center leading-none">
                  <span className="block text-sm font-extrabold">{typeof f === 'object' ? f.day : ''}</span>
                  <span className="block text-[8px] uppercase opacity-90">{typeof f === 'object' ? f.mon : ''}</span>
                </span>
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{h.name}</p>
                <p className="text-[10px] text-muted-foreground">Company holiday</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Section heading. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-xs font-bold text-[#0F172A]">{children}</p>
}
