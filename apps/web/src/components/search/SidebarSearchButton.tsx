import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * SidebarSearchButton — pinned search trigger that lives in the sidebar footer.
 *
 * Replaces the old floating bottom-right SearchFab (which collided with the AI
 * assistant bubble). Presentational only: pass an `onClick` that opens whichever
 * search surface the shell uses (CommandPalette for ESS/Manager/App,
 * UniversalSearch for Admin). ⌘K still works globally.
 *
 *   - Expanded: full-width pill with label + ⌘K hint
 *   - Collapsed: centered icon button with tooltip
 */
export function SidebarSearchButton({
  onClick,
  collapsed = false,
}: {
  onClick: () => void
  collapsed?: boolean
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Search (⌘K)"
        aria-label="Open search"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-sidebar-accent/60 hover:text-foreground transition-colors mx-auto"
      >
        <Search className="h-4 w-4" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open search"
      className={cn(
        'group flex w-full items-center gap-2 rounded-lg border border-border bg-background/50',
        'px-2.5 py-1.5 text-muted-foreground/70 transition-colors',
        'hover:border-primary/40 hover:bg-background hover:text-foreground',
      )}
    >
      <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 group-hover:text-primary" />
      <span className="flex-1 text-left text-[12px] leading-none">Search…</span>
      <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted/40 px-1 py-0.5 text-[9px] font-mono leading-none text-muted-foreground/60 sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  )
}

export default SidebarSearchButton
