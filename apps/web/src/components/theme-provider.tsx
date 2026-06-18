import * as React from 'react'

type Theme = 'light' | 'dark' | 'system' | 'petrol'

type ThemeContextValue = {
  theme:         Theme
  resolvedTheme: 'light' | 'dark'
  setTheme:      (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'aurora-theme'

function applyTheme(theme: Theme): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const root       = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark     = theme === 'dark' || (theme === 'system' && systemDark)
  root.classList.toggle('dark', isDark)
  root.dataset.theme         = theme === 'petrol' ? 'petrol' : ''
  root.style.colorScheme     = isDark ? 'dark' : 'light'
  return isDark ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState]       = React.useState<Theme>('light')
  const [resolvedTheme, setResolvedTheme] = React.useState<'light' | 'dark'>('light')

  // Read persisted preference on mount; default to light if nothing stored.
  React.useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'light'
    setThemeState(stored)
    setResolvedTheme(applyTheme(stored))
  }, [])

  // Follow system preference changes when theme === 'system'.
  React.useEffect(() => {
    if (theme !== 'system') return
    const mq       = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolvedTheme(applyTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
    setResolvedTheme(applyTheme(next))
  }, [])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
