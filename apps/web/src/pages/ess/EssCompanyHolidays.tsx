/**
 * EssCompanyHolidays — /ess/company-holidays
 *
 * Employee self-service: view the company holiday calendar applicable to YOU.
 * Shows the mandatory (gazetted/company) holidays for the selected year,
 * resolved against your site / location / holiday-group. Optional holidays
 * are chosen separately on the Optional Holidays page.
 *
 * Design: design-system tokens only.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Loader2, PartyPopper } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

interface HolidayItem {
  id:           string
  date:         string
  name:         string
  holiday_type: string | null
}

interface HolidaysResponse {
  data: HolidayItem[]
  year: number
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function parts(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (isNaN(d.getTime())) return { day: '—', mon: '', wd: '', monthIdx: -1 }
  return {
    day:      String(d.getUTCDate()).padStart(2, '0'),
    mon:      MONTHS[d.getUTCMonth()],
    wd:       WEEKDAYS[d.getUTCDay()],
    monthIdx: d.getUTCMonth(),
  }
}

export function EssCompanyHolidays() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)

  const { data, isLoading, isError, refetch } = useQuery<HolidaysResponse>({
    queryKey: ['ess-company-holidays', year],
    queryFn:  () => api.get(`/leave/holidays?year=${year}`),
    staleTime: 5 * 60_000,
  })

  const holidays = data?.data ?? []
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = holidays.filter(h => h.date >= today).length

  return (
    <PageContainer>
      <PageHeader
        title="Company Holidays"
        subtitle="The holiday calendar that applies to you for the selected year"
        actions={
          <div className="flex items-center gap-1.5">
            {[thisYear, thisYear + 1].map(y => (
              <Button
                key={y}
                size="sm"
                variant={y === year ? 'default' : 'outline'}
                onClick={() => setYear(y)}
              >
                {y}
              </Button>
            ))}
          </div>
        }
      />

      <SectionCard
        title={`Holidays ${year}${holidays.length ? ` (${holidays.length})` : ''}`}
        icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
        noPadding
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 p-10">
            <p className="text-sm text-destructive">Failed to load holidays</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : holidays.length === 0 ? (
          <div className="p-10 text-center space-y-1">
            <PartyPopper className="h-8 w-8 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No company holidays published for {year}.</p>
            <p className="text-xs text-muted-foreground">Check with HR if you expect holidays here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {holidays.map(h => {
              const p = parts(h.date)
              const isPast = h.date < today
              return (
                <li
                  key={h.id}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/20',
                    isPast && 'opacity-50',
                  )}
                >
                  <div className="flex flex-col items-center justify-center w-12 shrink-0 rounded-lg bg-muted/40 py-1.5">
                    <span className="text-base font-semibold text-foreground leading-none">{p.day}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{p.mon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{p.wd}</p>
                  </div>
                  {!isPast && h.date === today && (
                    <Badge variant="secondary" className="text-[10px]">Today</Badge>
                  )}
                  {h.holiday_type && (
                    <Badge variant="outline" className="text-[10px] capitalize">{h.holiday_type}</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {!isLoading && !isError && holidays.length > 0 && (
        <p className="text-xs text-muted-foreground px-1">
          {upcoming} upcoming holiday{upcoming === 1 ? '' : 's'} this year. Optional / restricted
          holidays are chosen separately on the Optional Holidays page.
        </p>
      )}
    </PageContainer>
  )
}

export default EssCompanyHolidays
