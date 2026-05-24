import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/theme-provider'

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      variant="glass"
      size="icon"
      aria-label="Toggle theme"
      className={className}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <Sun  className={`h-4 w-4 transition-all absolute ${isDark  ? 'scale-0 -rotate-90' : 'scale-100 rotate-0'}`} />
      <Moon className={`h-4 w-4 transition-all         ${!isDark ? 'scale-0  rotate-90'  : 'scale-100 rotate-0'}`} />
    </Button>
  )
}
