import { useEffect, useState } from 'react'

/**
 * useIsMobile — true when the viewport is below the `lg` breakpoint (1024px).
 *
 * Used to render the dedicated mobile ESS experience while leaving the desktop
 * layout completely untouched. SSR-safe (defaults to false until mounted).
 */
const MOBILE_QUERY = '(max-width: 1023px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
