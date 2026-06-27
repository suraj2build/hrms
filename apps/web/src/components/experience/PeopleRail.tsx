/**
 * PeopleRail — the People pattern (§3.4) as a relationship rail: who I work with,
 * shown as faces grouped by role (reports to · alongside · guides). People before
 * fields — a reporting line is a set of humans, not an org-chart of ids. Extracted
 * as the shared People primitive (Patterns §5 housekeeping); reused wherever a set
 * of related people should be seen.
 */

import * as React from 'react'
import { PersonAvatar } from './PersonAvatar'

interface Party { id: string; name: string; subtitle?: string }

export function PeopleRail({
  sections, className,
}: { sections: { label: string; people: Party[] }[]; className?: string }) {
  const visible = sections.filter(s => s.people.length > 0)
  if (!visible.length) return null
  return (
    <div className={className}>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Who I work with</p>
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {visible.map(s => (
          <div key={s.label}>
            <p className="mb-2 text-[11px] text-muted-foreground">{s.label}</p>
            <div className="flex flex-wrap items-center gap-3">
              {s.people.map(p => (
                <span key={p.id} className="flex items-center gap-2">
                  <PersonAvatar name={p.name} size="sm" decorative />
                  <span className="text-xs font-medium text-foreground">{p.name}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
