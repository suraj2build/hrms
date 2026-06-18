import * as React from 'react'

type Theme = 'light' | 'petrol'

type ThemeContextValue = {
  theme:     Theme
  setTheme:  (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'aurora-theme'

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('dark')
  root.dataset.theme     = theme === 'petrol' ? 'petrol' : ''
  root.style.colorScheme = 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light')

  React.useEffect(() => {
    const raw    = localStorage.getItem(STORAGE_KEY)
    const stored = (raw === 'petrol' ? 'petrol' : 'light') as Theme
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

// Kept for any remaining callers that destructure resolvedTheme
export type { Theme }
