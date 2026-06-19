/**
 * DemoBanner — small fixed badge shown only in DEMO MODE.
 *
 * Renders bottom-left, non-intrusive, links back to the marketing site ("/").
 * Communicates that the data is sample data and nothing is persisted.
 *
 * Only mounted when `DEMO_MODE` is true (see App.tsx), so it never appears in
 * the real product build.
 */

import { useState } from 'react'
import { X } from 'lucide-react'

export function DemoBanner() {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null

  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex items-center gap-2 rounded-full border border-success/30 bg-card/95 px-3 py-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" aria-hidden />
      <span className="text-[11px] font-medium text-foreground/80">
        Live Demo — sample data, nothing is saved
      </span>
      <a
        href="/"
        className="text-[11px] font-semibold text-primary hover:underline"
      >
        Visit site
      </a>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="ml-0.5 text-muted-foreground/60 hover:text-foreground"
        aria-label="Dismiss demo banner"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
