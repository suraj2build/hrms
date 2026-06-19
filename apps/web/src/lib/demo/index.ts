/**
 * Demo mode flag + resolver entry point.
 *
 * Demo mode replaces the entire backend / auth stack with built-in fixtures so
 * a visitor can click through the portal with no server. It activates when:
 *   - the app is built with `VITE_DEMO_MODE=true`, OR
 *   - the page is opened at `/demo` (or with `?demo`) — this lets the normal
 *     production deployment serve the demo at <app-url>/demo without a separate
 *     build. The flag is remembered per browser-tab (sessionStorage) so it
 *     survives client-side navigation and reloads within that tab.
 *
 * Normal usage (no /demo path, no ?demo, no build flag) is completely
 * unaffected — DEMO_MODE is false and the real network path is used unchanged.
 */

function detectDemoMode(): boolean {
  if (import.meta.env.VITE_DEMO_MODE === 'true') return true
  if (typeof window === 'undefined') return false
  try {
    const { pathname, search } = window.location
    if (pathname === '/demo' || pathname.startsWith('/demo/') || new URLSearchParams(search).has('demo')) {
      sessionStorage.setItem('cognix-demo', '1')
      return true
    }
    return sessionStorage.getItem('cognix-demo') === '1'
  } catch {
    return false
  }
}

export const DEMO_MODE = detectDemoMode()

export { resolveDemo } from './resolver'
