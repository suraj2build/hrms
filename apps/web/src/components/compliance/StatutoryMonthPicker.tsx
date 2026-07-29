/* eslint-disable react-refresh/only-export-components -- co-locates the useStatutoryMonth hook with its picker component */
/**
 * StatutoryMonthPicker — shared month selector for all Compliance/statutory pages.
 *
 * Backed by uiStore.statutoryMonth so EPF / ESI / PT / TDS / Reconciliation all
 * stay on the same period. Defaults to the current month when nothing is selected.
 */
import { CalendarDays } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Resolved statutory month (selected, or current month if unset). */
export function useStatutoryMonth(): [string, (m: string) => void] {
  const month    = useUIStore(s => s.statutoryMonth)
  const setMonth = useUIStore(s => s.setStatutoryMonth)
  return [month ?? currentYM(), setMonth]
}

export function StatutoryMonthPicker({ className }: { className?: string }) {
  const [month, setMonth] = useStatutoryMonth()
  return (
    <label
      className={`inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-2 text-xs ${className ?? ''}`}
      title="Statutory period — shared across all Compliance tabs"
    >
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="month"
        value={month}
        onChange={(e) => { if (e.target.value) setMonth(e.target.value) }}
        className="bg-transparent outline-none text-foreground"
      />
    </label>
  )
}
