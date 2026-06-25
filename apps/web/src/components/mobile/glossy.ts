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

/** The navy header gradient used across mobile screens — unified with the
 *  desktop ESS primary (`--primary: #1A4D8F`) so both surfaces read as one
 *  product. Teal stays the accent; royal-blue is no longer the header colour. */
export const HEADER_GRADIENT = 'linear-gradient(160deg,#2B62B0,#1A4D8F 55%,#0F3163)'

/** Soft white card. */
export const CARD = 'rounded-2xl bg-white shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]'
