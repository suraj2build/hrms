/* eslint-disable react-refresh/only-export-components -- co-locates the useTheme hook with its provider, standard context pattern */
import * as React from 'react'

type Theme = 'light' | 'petrol' | 'bordeaux' | 'slate' | 'pastel' | 'dark'

type ThemeContextValue = {
  theme:     Theme
  setTheme:  (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'aurora-theme'

const NON_DEFAULT: readonly Theme[] = ['petrol', 'bordeaux', 'slate', 'pastel', 'dark']

function parseTheme(raw: string | null): Theme {
  return NON_DEFAULT.includes(raw as Theme) ? (raw as Theme) : 'light'
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('dark')                                  // legacy dark-mode class never used
  root.dataset.theme     = theme === 'light' ? '' : theme
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'   // native controls / scrollbars
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

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export type { Theme }
