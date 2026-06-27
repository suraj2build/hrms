/**
 * JourneyRail — the Growth spine: a subtle, forward-reading narrative of the
 * employee's career milestones ("how have I grown?"), distinct from the backward-
 * reading memory of Timeline ("what happened?").
 *
 * Not a page, not a second timeline — a calm horizontal rail of real milestones on
 * a connecting line: Joined → First payslip → First recognition → service
 * anniversaries, with promotion / confirmation / role-change / learning slotting in
 * automatically the day those event sources exist (never fabricated). Faces appear
 * where a person is part of the milestone. This is the reusable seed of the Growth
 * lens that the Identity surface will later own.
 */

import * as React from 'react'
import {
  Flag, Receipt, Award, Milestone, TrendingUp, BadgeCheck, Briefcase, Users, GraduationCap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PersonAvatar } from './PersonAvatar'

export type JourneyKind =
  | 'joined' | 'first_payslip' | 'first_recognition' | 'confirmation'
  | 'promotion' | 'role_change' | 'team_change' | 'learning' | 'anniversary'

export interface JourneyStep {
  id: string
  kind: JourneyKind
  label: string
  at: string
  detail?: string
  person?: string
}

const ICON: Record<JourneyKind, React.ComponentType<{ className?: string }>> = {
  joined: Flag, first_payslip: Receipt, first_recognition: Award, confirmation: BadgeCheck,
  promotion: TrendingUp, role_change: Briefcase, team_change: Users, learning: GraduationCap,
  anniversary: Milestone,
}

function yr(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : String(d.getUTCFullYear())
}

/**
 * JourneyEcho — Timeline's compact echo of the Growth spine after the spine's
 * canonical home moved to My Growth (Experience Map migration). Memory links to the
 * growth surface rather than re-rendering the rail, so the two never duplicate.
 */
export function JourneyEcho({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count < 2) return null
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl bg-[#15B8A6]/[0.06] px-4 py-3 text-left transition-colors hover:bg-[#15B8A6]/[0.10]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#15B8A6]/12 text-[#15B8A6]">
        <Milestone className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-foreground">Your growth journey</span>
        <span className="block text-[11px] text-muted-foreground">{count} milestones so far — see how you’ve grown</span>
      </span>
      <span className="text-[13px] text-muted-foreground">→</span>
    </button>
  )
}

export function JourneyRail({ steps, className }: { steps: JourneyStep[]; className?: string }) {
  if (!steps || steps.length < 2) return null
  return (
    <section className={cn('motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500', className)}>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">How you’ve grown</p>
      <div className="relative overflow-x-auto pb-1">
        {/* the spine */}
        <div className="absolute left-0 right-0 top-[18px] h-px bg-gradient-to-r from-primary/30 via-[#15B8A6]/30 to-transparent" />
        <ol className="relative flex min-w-max gap-7">
          {steps.map((s) => {
            const Icon = ICON[s.kind] ?? Milestone
            return (
              <li key={s.id} className="flex w-[112px] shrink-0 flex-col items-center text-center">
                {s.person ? (
                  <PersonAvatar name={s.person} size="md" className="ring-2 ring-background" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#15B8A6]/12 text-[#15B8A6] ring-2 ring-background">
                    <Icon className="h-4 w-4" />
                  </span>
                )}
                <span className="mt-2 text-[12px] font-semibold leading-tight text-foreground">{s.label}</span>
                <span className="mt-0.5 text-[10px] text-muted-foreground">{s.detail ?? yr(s.at)}</span>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
