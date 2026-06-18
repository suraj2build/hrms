import { Moon, Sun, Waves } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="glass" size="icon" aria-label="Change theme" className={className}>
          {theme === 'petrol'
            ? <Waves className="h-4 w-4" />
            : dark
              ? <Moon className="h-4 w-4" />
              : <Sun  className="h-4 w-4" />
          }
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide">Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme('light')} className={cn('gap-2', theme === 'light' && 'bg-accent')}>
          <Sun   className="h-3.5 w-3.5" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className={cn('gap-2', theme === 'dark' && 'bg-accent')}>
          <Moon  className="h-3.5 w-3.5" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('petrol')} className={cn('gap-2', theme === 'petrol' && 'bg-accent')}>
          <Waves className="h-3.5 w-3.5" /> Petrol
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
