/**
 * ComplianceCalendar — /admin/payroll/compliance-calendar  (P2.1)
 *
 * Single view of statutory filing deadlines (EPF/ESI/PT/TDS/LWF/24Q), grouped
 * by status. All data comes from GET /compliance/calendar — the one
 * ComplianceCalendarService source; no deadline logic lives in the UI.
 */

import { useQuery } from '@tanstack/react-query'
import {
  CalendarClock, AlertTriangle, Clock, CheckCircle2, Loader2, AlertCircle, Landmark,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { api } from '@/lib/api/client'
import { cn }  from '@/lib/utils'

type Status = 'upcoming' | 'due_soon' | 'overdue' | 'completed'

interface Deadline {
  id: string
  compliance_type: string
  label: string
  jurisdiction: string
  period: string
  period_label: string
  due_date: string
  status: Status
  days_to_due: number
  filed_at: string | null
  reference: string | null
}
interface CalendarResp {
  data: Deadline[]
  counts: Record<Status, number>
}

const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

const STATUS_META: Record<Status, { label: string; icon: any; cls: string; chip: string }> = {
  overdue:   { label: 'Overdue',   icon: AlertTriangle, cls: 'text-red-600',     chip: 'bg-red-50 text-red-700 border-red-200' },
  due_soon:  { label: 'Due Soon',  icon: Clock,         cls: 'text-amber-600',   chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  upcoming:  { label: 'Upcoming',  icon: CalendarClock, cls: 'text-blue-600',    chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'Completed', icon: CheckCircle2,  cls: 'text-emerald-600', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}
const ORDER: Status[] = ['overdue', 'due_soon', 'upcoming', 'completed']

export function ComplianceCalendar() {
  const { data: res, isLoading, isError } = useQuery<CalendarResp>({
    queryKey: ['compliance-calendar'],
    queryFn:  () => api.get('/compliance/calendar'),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Compliance Calendar" subtitle="Statutory filing deadlines" />
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Computing deadlines…
        </div>
      </PageContainer>
    )
  }
  if (isError || !res) {
    return (
      <PageContainer>
        <PageHeader title="Compliance Calendar" subtitle="Statutory filing deadlines" />
        <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
          <AlertCircle className="h-7 w-7" /><p className="text-sm">Couldn't load the compliance calendar.</p>
        </div>
      </PageContainer>
    )
  }

  const deadlines = res.data ?? []
  const counts = res.counts

  return (
    <PageContainer>
      <PageHeader title="Compliance Calendar" subtitle="EPF · ESI · PT · TDS · LWF · Form 24Q — filing deadlines" />

      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {ORDER.map(st => {
          const M = STATUS_META[st]
          return (
            <div key={st} className={cn('rounded-lg border p-3', M.chip)}>
              <div className="flex items-center gap-1.5 text-xs font-medium"><M.icon className="h-3.5 w-3.5" /> {M.label}</div>
              <p className="text-2xl font-semibold mt-1">{counts[st] ?? 0}</p>
            </div>
          )
        })}
      </div>

      {deadlines.length === 0 ? (
        <SectionCard title="Deadlines">
          <p className="py-8 text-center text-sm text-muted-foreground">
            No statutory deadlines in range. Enable PF/ESI/PT/TDS in statutory settings (and LWF states) to populate the calendar.
          </p>
        </SectionCard>
      ) : (
        ORDER.filter(st => deadlines.some(d => d.status === st)).map(st => {
          const M = STATUS_META[st]
          const rows = deadlines.filter(d => d.status === st)
          return (
            <SectionCard key={st} title={`${M.label} (${rows.length})`} icon={<M.icon className={cn('h-4 w-4', M.cls)} />}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                      <th className="text-left py-2 px-3 text-xs font-medium">Filing</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Jurisdiction</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Period</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Due</th>
                      <th className="text-right py-2 px-3 text-xs font-medium">{st === 'completed' ? 'Filed' : 'Days'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(d => (
                      <tr key={d.id} className="border-b border-border/50">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">{d.label}</span>
                            <Badge variant="outline" className="text-[10px]">{d.compliance_type}</Badge>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-xs">{d.jurisdiction}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">{d.period_label}</td>
                        <td className="py-2 px-3 text-xs">{fmtDate(d.due_date)}</td>
                        <td className={cn('py-2 px-3 text-xs text-right font-medium', M.cls)}>
                          {st === 'completed'
                            ? (d.filed_at ? fmtDate(d.filed_at.slice(0, 10)) : '—')
                            : st === 'overdue'
                              ? `${Math.abs(d.days_to_due)}d late`
                              : `${d.days_to_due}d`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )
        })
      )}
    </PageContainer>
  )
}
