/**
 * PilotEnvironmentBanner — persistent "Test environment" disclosure for an
 * invite-only friends pilot (tenants.is_pilot). Renders nothing for a
 * normal tenant. Visible to every role (employee/manager/HR/admin) on
 * every page — unlike OperationalBanner, this is a standing disclosure,
 * not a dismissible operational signal, so there's no dismiss control.
 *
 * Pairs with the server-side gate (lib/pilot-guard.ts): real payroll
 * finalize, statutory filing/export, and payout-obligation actions already
 * return 403 PILOT_TENANT_RESTRICTED for this tenant — this banner is what
 * tells a human why, before they hit that wall.
 */
import { useState } from 'react'
import { ChevronDown, FlaskConical, MessageSquarePlus } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PilotFeedbackDialog } from './PilotFeedbackDialog'

const KNOWN_LIMITATIONS = [
  'Payroll finalize, statutory filing (PF/ESI/PT/LWF/TDS), and accounting exports are disabled — this data is never real money or a real filing.',
  'Some same-half-day leave + attendance conflicts are flagged for review rather than auto-resolved while that logic is being revised.',
  'Professional Tax does not yet vary by month (e.g. Karnataka’s February rate) — treated as a known, disclosed gap.',
  'Correcting a leave request after time has passed may need HR to step in manually — this path is still being hardened.',
]

export function PilotEnvironmentBanner() {
  const { tenant } = useAuthStore()
  const [expanded, setExpanded] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  if (!tenant?.is_pilot) return null

  return (
    <>
      <div className="flex-shrink-0 border-b border-warning/30 bg-warning/10 text-sm text-foreground">
        <div className="flex items-center gap-2 px-4 py-2">
          <FlaskConical className="h-4 w-4 flex-shrink-0 text-warning" />
          <span className="flex-1 font-medium">
            Test environment — nothing here is a real salary, deduction, or statutory filing.
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            Known limitations
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
          <Button
            variant="ghost" size="sm"
            className="h-7 gap-1 text-xs text-warning hover:bg-warning/20 hover:text-warning"
            onClick={() => setFeedbackOpen(true)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Report an issue
          </Button>
        </div>
        {expanded && (
          <ul className="list-disc space-y-1 border-t border-warning/20 px-4 py-2 pl-10 text-xs text-foreground/80">
            {KNOWN_LIMITATIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      <PilotFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}
