import type { CSSProperties } from 'react'

/**
 * Shared glossy soft-UI helpers for the mobile ESS surface — matches the
 * marketing-site mockups: gradient fills with an inset top highlight and a
 * soft coloured drop shadow.
 */

export const BRAND = {
  blue: '#2E6FE6',
  blueLight: '#5C9AFF',
  navy: '#1A4D8F',
  teal: '#15B8A6',
  tealBright: '#2DD4BF',
  violet: '#7C3AED',
  violetLight: '#A78BFA',
  amber: '#B07B18',
  green: '#1A8050',
} as const

/** Glossy gradient tile (icon chips, primary buttons). */
export function glossy(from: string, to: string): CSSProperties {
  return {
    background: `linear-gradient(145deg, ${from}, ${to})`,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), 0 8px 16px -6px ${from}80`,
  }
}

/** The brand blue→teal header gradient used across mobile screens. */
export const HEADER_GRADIENT = 'linear-gradient(160deg,#5C9AFF,#2E6FE6 55%,#1A4D8F)'

/** Soft white card. */
export const CARD = 'rounded-2xl bg-white shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]'
