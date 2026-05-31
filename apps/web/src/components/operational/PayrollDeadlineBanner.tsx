/**
 * PayrollDeadlineBanner — dismissible banner shown at the top of the shell
 * during payroll deadline mode.
 *
 * Returns null when deadline mode is inactive.
 * Provides a quick-link to the Payroll Control Center and a dismiss button.
 *
 * Usage:
 *   // In AppShell, above <main>:
 *   <PayrollDeadlineBanner />
 */

import { useNavigate } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { usePayrollDeadline } from '@/contexts/PayrollDeadlineContext'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PayrollDeadlineBannerProps {
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PayrollDeadlineBanner({ className }: PayrollDeadlineBannerProps): JSX.Element | null {
  const { isDeadlineMode, hoursUntilDeadline, deactivateDeadline } = usePayrollDeadline()
  const navigate = useNavigate()

  if (!isDeadlineMode) return null

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2 bg-amber-500/10 border-b border-amber-500/30',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-700">
          Payroll Deadline Mode Active
        </span>
        {hoursUntilDeadline !== undefined && (
          <span className="text-xs text-amber-600">
            · {hoursUntilDeadline > 0 ? `${hoursUntilDeadline}h remaining` : 'Due now'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-500/20"
          onClick={() => navigate('/admin/payroll/center')}
        >
          Go to Payroll Control →
        </Button>
        <button
          className="text-amber-600/60 hover:text-amber-600 p-0.5"
          onClick={deactivateDeadline}
          aria-label="Dismiss deadline mode banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
