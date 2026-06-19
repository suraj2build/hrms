import * as React from 'react'

type Theme = 'light' | 'petrol' | 'bordeaux' | 'slate'

type ThemeContextValue = {
  theme:     Theme
  setTheme:  (theme: Theme) => void
  /** Advance to the next theme in the cycle: light → petrol → bordeaux → slate → light */
  cycleTheme: () => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'aurora-theme'

/** Order of the cycle-on-click toggle. */
export const THEME_ORDER: Theme[] = ['light', 'petrol', 'bordeaux', 'slate']

function parseTheme(raw: string | null): Theme {
  return raw === 'petrol' || raw === 'bordeaux' || raw === 'slate' ? raw : 'light'
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('dark')
  root.dataset.theme     = theme === 'light' ? '' : theme
  root.style.colorScheme = 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light')

  React.useEffect(() => {
    const stored = parseTheme(localStorage.getItem(STORAGE_KEY))
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  const setTheme = React.useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
    applyTheme(next)
  }, [])

  const cycleTheme = React.useCallback(() => {
    setThemeState(prev => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(prev) + 1) % THEME_ORDER.length]
      localStorage.setItem(STORAGE_KEY, next)
      applyTheme(next)
      return next
    })
  }, [])

  const value = React.useMemo(
    () => ({ theme, setTheme, cycleTheme }),
    [theme, setTheme, cycleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export type { Theme }
