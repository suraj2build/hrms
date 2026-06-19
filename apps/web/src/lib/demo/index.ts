/**
 * Demo mode flag + resolver entry point.
 *
 * When the app is built with `VITE_DEMO_MODE=true`, the entire backend / auth
 * stack is replaced by built-in fixtures so a visitor can click through the
 * portal with no server. When the flag is unset, this module is inert and the
 * real network path is used unchanged.
 *
 * Everything here is guarded by `DEMO_MODE`; importing this file has no side
 * effects when the flag is off.
 */

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

export { resolveDemo } from './resolver'
