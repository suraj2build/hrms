/**
 * OnboardingHero — the welcome banner + at-a-glance progress for /ess/onboarding.
 *
 * Purely presentational. Renders the engine-computed readiness score as a ring,
 * a friendly greeting, a joining-day countdown, and quick stat chips. The parent
 * derives every number from existing services and passes them in.
 */

import { PartyPopper, CalendarClock, ClipboardCheck, FileCheck2 } from 'lucide-react'
import { brandConfig } from '@/lib/brand-config'
import { cn } from '@/lib/utils'
import type { ReadinessStatus } from './onboarding-data'

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ready:   'On track',
  at_risk: 'A few things left',
  blocked: 'Needs your attention',
}

function HeroRing({ value, label }: { value: number; label: string }) {
  const radius = 34
  const circ   = 2 * Math.PI * radius
  const offset = circ * (1 - Math.max(0, Math.min(100, value)) / 100)
  return (
    <div className="relative inline-flex items-center justify-center shrink-0">
      <svg width="92" height="92" className="-rotate-90">
        <circle cx="46" cy="46" r={radius} strokeWidth="7" className="fill-none stroke-white/25" />
        <circle
          cx="46" cy="46" r={radius} strokeWidth="7" fill="none" strokeLinecap="round"
          className="fill-none stroke-white transition-all duration-700"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span className="text-2xl font-bold text-white">{value}</span>
        <span className="text-[9px] font-medium uppercase tracking-wide text-white/70">{label}</span>
      </div>
    </div>
  )
}

function StatChip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  )
}

interface OnboardingHeroProps {
  firstName:      string | null
  readinessScore: number | null
  readinessLabel: ReadinessStatus | null
  tasksPct:       number
  tasksDone:      number
  tasksTotal:     number
  docsVerified:   number
  docsTotal:      number
  joiningInDays:  number | null
  complete:       boolean
}

export function OnboardingHero({
  firstName, readinessScore, readinessLabel,
  tasksPct, tasksDone, tasksTotal, docsVerified, docsTotal,
  joiningInDays, complete,
}: OnboardingHeroProps) {
  const { primary, navy, teal } = brandConfig.colors
  // Ring shows the readiness score when available, else falls back to task progress.
  const ringValue = readinessScore ?? tasksPct
  const ringLabel = readinessScore != null ? 'ready' : 'tasks'

  const headline = complete
    ? `You're all set, ${firstName ?? 'welcome'}! 🎉`
    : firstName ? `Welcome aboard, ${firstName}` : 'Welcome aboard'

  const subline = complete
    ? 'Your onboarding is complete. Everything below is here for your reference.'
    : readinessLabel ? STATUS_LABEL[readinessLabel]
    : 'Let’s get you set up for your first days.'

  const countdown =
    joiningInDays == null ? null
    : joiningInDays > 1  ? `${joiningInDays} days to your joining date`
    : joiningInDays === 1 ? 'Joining tomorrow'
    : joiningInDays === 0 ? 'Joining today'
    : 'You’ve joined'

  return (
    <div
      className="relative overflow-hidden rounded-2xl px-5 py-6 sm:px-7 sm:py-7 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${primary} 0%, ${navy} 60%, ${teal} 140%)` }}
    >
      {/* soft decorative orb */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {complete && <PartyPopper className="h-5 w-5 shrink-0" />}
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{headline}</h1>
          </div>
          <p className="mt-1 text-sm text-white/80 max-w-md">{subline}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {countdown && (
              <div className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-sm',
                joiningInDays != null && joiningInDays <= 1 ? 'bg-white text-[#1A4D8F]' : 'bg-white/15 text-white',
              )}>
                <CalendarClock className="h-3.5 w-3.5" />
                {countdown}
              </div>
            )}
            <StatChip icon={ClipboardCheck} label={`${tasksDone}/${tasksTotal} tasks`} />
            {docsTotal > 0 && <StatChip icon={FileCheck2} label={`${docsVerified}/${docsTotal} docs verified`} />}
          </div>
        </div>

        <HeroRing value={ringValue} label={ringLabel} />
      </div>
    </div>
  )
}

export default OnboardingHero
