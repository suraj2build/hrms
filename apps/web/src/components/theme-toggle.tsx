import { Sun, Waves } from 'lucide-react'
import { Button }     from '@/components/ui/button'
import { useTheme }   from '@/components/theme-provider'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const isPetrol = theme === 'petrol'

  return (
    <Button
      variant="glass"
      size="icon"
      aria-label={isPetrol ? 'Switch to Blue theme' : 'Switch to Petrol theme'}
      title={isPetrol ? 'Blue theme' : 'Petrol theme'}
      className={className}
      onClick={() => setTheme(isPetrol ? 'light' : 'petrol')}
    >
      {isPetrol
        ? <Sun   className="h-4 w-4" />
        : <Waves className="h-4 w-4" />
      }
    </Button>
  )
}
