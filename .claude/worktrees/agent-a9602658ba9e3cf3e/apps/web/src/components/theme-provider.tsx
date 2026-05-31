import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  theme:         Theme
  resolvedTheme: 'light' | 'dark'
  setTheme:      (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'aurora-theme'

function applyTheme(theme: Theme): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  const root       = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved   = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  return resolved
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState]       = React.useState<Theme>('dark')
  const [resolvedTheme, setResolvedTheme] = React.useState<'light' | 'dark'>('dark')

  // Read persisted preference on mount; default to dark if nothing stored.
  React.useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'dark'
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
