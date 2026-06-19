/* eslint-disable react-refresh/only-export-components -- co-locates the THEME_OPTIONS list with the toggle components that consume it */
import { Sun, Waves, Wine, CloudDrizzle, Sparkles, Zap, Check } from 'lucide-react'
import { Button }     from '@/components/ui/button'
import { cn }         from '@/lib/utils'
import { useTheme, type Theme } from '@/components/theme-provider'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

type Option = { value: Theme; label: string; Icon: typeof Sun; hint: string }

export const THEME_OPTIONS: Option[] = [
  { value: 'light',    label: 'Blue',     Icon: Sun,          hint: 'Default royal blue' },
  { value: 'petrol',   label: 'Petrol',   Icon: Waves,        hint: 'Deep teal'          },
  { value: 'bordeaux', label: 'Bordeaux', Icon: Wine,         hint: 'Wine red'           },
  { value: 'slate',    label: 'Slate',    Icon: CloudDrizzle, hint: 'Storm grey'         },
  { value: 'pastel',   label: 'Pastel',   Icon: Sparkles,     hint: 'Soft violet'        },
  { value: 'dark',     label: 'Synthwave', Icon: Zap,         hint: 'Electric indigo + cyan' },
]

/**
 * Theme switcher dropdown. `navStyle` renders a white-on-dark trigger for the
 * navy top bar (TopNavV2); the default is a glass icon button for light shells.
 */
export function ThemeMenu({ navStyle, className }: { navStyle?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme()
  const current = THEME_OPTIONS.find(o => o.value === theme) ?? THEME_OPTIONS[0]
  const CurrentIcon = current.Icon

  const trigger = navStyle ? (
    <button
      type="button"
      aria-label={`Theme: ${current.label}. Change theme`}
      title={`Theme: ${current.label}`}
      className={cn(
        'p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/90 hover:text-white',
        className,
      )}
    >
      <CurrentIcon className="h-4 w-4" />
    </button>
  ) : (
    <Button
      variant="glass"
      size="icon"
      aria-label={`Theme: ${current.label}. Change theme`}
      title={`Theme: ${current.label}`}
      className={className}
    >
      <CurrentIcon className="h-4 w-4" />
    </Button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map(({ value, label, Icon, hint }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="gap-2.5 cursor-pointer"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col leading-tight flex-1">
              <span className="text-sm">{label}</span>
              <span className="text-[10.5px] text-muted-foreground">{hint}</span>
            </span>
            {theme === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Back-compat wrapper used by the light-shell Topbar. */
export function ThemeToggle({ className }: { className?: string }) {
  return <ThemeMenu className={className} />
}
