import { Sun, Waves, Wine, CloudDrizzle } from 'lucide-react'
import { Button }     from '@/components/ui/button'
import { useTheme }   from '@/components/theme-provider'

const META = {
  light:    { Icon: Sun,          label: 'Blue',     next: 'Petrol'   },
  petrol:   { Icon: Waves,        label: 'Petrol',   next: 'Bordeaux' },
  bordeaux: { Icon: Wine,         label: 'Bordeaux', next: 'Slate'    },
  slate:    { Icon: CloudDrizzle, label: 'Slate',    next: 'Blue'     },
} as const

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycleTheme } = useTheme()
  const { Icon, label, next } = META[theme]

  return (
    <Button
      variant="glass"
      size="icon"
      aria-label={`Theme: ${label}. Switch to ${next}`}
      title={`Theme: ${label} · click for ${next}`}
      className={className}
      onClick={cycleTheme}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
