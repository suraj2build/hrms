import { Lock } from 'lucide-react'
import { cn }   from '@/lib/utils'

type PeriodState = 'OPEN' | 'LOCKED' | 'PAYROLL_PROCESSING' | 'PAYROLL_FINALIZED'

export interface PeriodLockBannerProps {
  state:      PeriodState
  month:      string      // 'YYYY-MM' — used in display
  className?: string
}

const STATE_MESSAGE: Record<Exclude<PeriodState, 'OPEN'>, { text: string; classes: string }> = {
  LOCKED:             { text: 'This period is locked. Attendance modifications are disabled.',                            classes: 'bg-warning/10 border-warning/30 text-warning' },
  PAYROLL_PROCESSING: { text: 'Payroll processing is in progress. No changes can be made to this period.',               classes: 'bg-info/10 border-info/30 text-info' },
  PAYROLL_FINALIZED:  { text: 'This period has been finalized. All attendance data is frozen.',                          classes: 'bg-muted border-border text-muted-foreground' },
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

export function PeriodLockBanner({ state, month, className }: PeriodLockBannerProps) {
  if (state === 'OPEN') return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-xs border rounded-md',
        STATE_MESSAGE[state].classes,
        className,
      )}
    >
      <Lock className="h-3.5 w-3.5 flex-shrink-0" />
      <span>{STATE_MESSAGE[state].text}</span>
      <span className="ml-auto font-medium opacity-70">{fmtMonth(month)}</span>
    </div>
  )
}
