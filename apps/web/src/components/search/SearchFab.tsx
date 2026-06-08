import { Search } from 'lucide-react'

/**
 * SearchFab — floating, chat-bot-style search launcher pinned to the bottom-right.
 *
 * Replaces the top-bar search pill so the header stays uncluttered. Presentational
 * only: pass an `onClick` that opens whichever search surface the shell uses
 * (CommandPalette for ESS/Manager, UniversalSearch for Admin). ⌘K still works.
 */
export function SearchFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Search (⌘K)"
      aria-label="Open search"
      className={[
        'group fixed bottom-5 right-5 z-50 flex items-center gap-2',
        'h-12 rounded-full pl-3.5 pr-4',
        'bg-primary text-primary-foreground',
        'shadow-elev-3 hover:shadow-elev-3',
        'ring-1 ring-primary/20',
        'transition-all duration-200 hover:-translate-y-0.5 hover:pr-5',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2',
      ].join(' ')}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-foreground/15">
        <Search className="h-4 w-4" />
      </span>
      {/* Label collapses on small screens to keep it compact */}
      <span className="hidden sm:inline text-[13px] font-semibold">Search</span>
      <kbd className="hidden md:inline-flex items-center text-[10px] font-mono bg-primary-foreground/15 rounded px-1.5 py-0.5 leading-none">
        ⌘K
      </kbd>
    </button>
  )
}

export default SearchFab
