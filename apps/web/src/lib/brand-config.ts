/**
 * brand-config.ts — Central branding configuration.
 *
 * Single source of truth for the platform brand. Every value reads from a
 * VITE_BRAND_* environment variable first, falling back to the CognixHR
 * defaults. A white-label deployment overrides whichever values it needs by
 * setting env vars at build time — no code changes required.
 *
 * Usage:
 *   import { brandConfig } from '@/lib/brand-config'
 *   <button style={{ background: brandConfig.colors.primary }}>…</button>
 *   <p>{brandConfig.tagline}</p>
 */

const e = (key: string, fallback: string): string =>
  (import.meta.env[key] as string | undefined) ?? fallback

export const brandConfig = {
  // ── Identity ────────────────────────────────────────────────────────────────
  /** Displayed product name, e.g. "CognixHR". */
  productName:   e('VITE_BRAND_NAME',         'CognixHR'),
  /** Short marketing tagline. */
  tagline:       e('VITE_BRAND_TAGLINE',       'Smarter Workforce. Stronger Future.'),
  /** Vendor/company name building the product. */
  vendorName:    e('VITE_BRAND_VENDOR',        'Saar'),
  /** Descriptor shown in meta tags and footers. */
  descriptor:    e('VITE_BRAND_DESCRIPTOR',    'Saar HRMS application'),

  // ── Support ──────────────────────────────────────────────────────────────────
  supportEmail:  e('VITE_BRAND_SUPPORT_EMAIL', 'support@cognixhr.com'),
  supportPhone:  e('VITE_BRAND_SUPPORT_PHONE', ''),
  helpUrl:       e('VITE_BRAND_HELP_URL',      'https://help.cognixhr.com'),
  /** Text shown at the bottom of public portals (e.g. pre-join form). */
  portalHelpText: e('VITE_BRAND_PORTAL_HELP',  'Having trouble? Contact your HR team for assistance.'),

  // ── Colours ──────────────────────────────────────────────────────────────────
  // Used for inline styles in surfaces that live outside the app's CSS-variable
  // design-token system (e.g. the public pre-join portal).
  colors: {
    /** Royal blue — primary CTA colour. */
    primary:      e('VITE_BRAND_COLOR_PRIMARY',       '#2E6FE6'),
    /** Deep navy — dark brand accent, header/nav backgrounds. */
    navy:         e('VITE_BRAND_COLOR_NAVY',          '#1A4D8F'),
    /** Teal — secondary accent, "HR" wordmark colour. */
    teal:         e('VITE_BRAND_COLOR_TEAL',          '#15B8A6'),
    /** Very light primary tint for page backgrounds. */
    primaryLight: e('VITE_BRAND_COLOR_PRIMARY_LIGHT', '#EEF3FB'),
    /** Very light teal tint for page backgrounds. */
    tealLight:    e('VITE_BRAND_COLOR_TEAL_LIGHT',    '#EDF9F7'),
  },

  // ── Assets ───────────────────────────────────────────────────────────────────
  // All default to the CognixHR canonical artwork under /public/brand/*.
  assets: {
    favicon:       e('VITE_BRAND_FAVICON',          '/brand/cognixhr-favicon.png'),
    icon:          e('VITE_BRAND_ICON',             '/brand/cognixhr-icon.png'),
    wordmark:      e('VITE_BRAND_WORDMARK',         '/brand/cognixhr-wordmark.png'),
    wordmarkLight: e('VITE_BRAND_WORDMARK_LIGHT',   '/brand/cognixhr-wordmark-light.png'),
    lockup:        e('VITE_BRAND_LOCKUP',           '/brand/cognixhr-lockup.png'),
  },
} as const

export type BrandConfig = typeof brandConfig
