/**
 * brand-config.ts (API) — Server-side branding configuration.
 *
 * Mirrors the web brandConfig but reads from Node.js process.env instead of
 * Vite import.meta.env. Used in email templates and any server-rendered
 * branded output. Override via BRAND_* environment variables.
 */

const e = (key: string, fallback: string): string =>
  process.env[key] ?? fallback

export const brandConfig = {
  // ── Identity ────────────────────────────────────────────────────────────────
  productName:  e('BRAND_NAME',         'CognixHR'),
  tagline:      e('BRAND_TAGLINE',       'Smarter Workforce. Stronger Future.'),
  vendorName:   e('BRAND_VENDOR',        'Saar'),
  descriptor:   e('BRAND_DESCRIPTOR',   'Saar HRMS application'),

  // ── Support ──────────────────────────────────────────────────────────────────
  supportEmail: e('BRAND_SUPPORT_EMAIL', 'support@cognixhr.com'),
  helpUrl:      e('BRAND_HELP_URL',      'https://help.cognixhr.com'),

  // ── Colours ──────────────────────────────────────────────────────────────────
  colors: {
    primary:  e('BRAND_COLOR_PRIMARY', '#2E6FE6'),
    navy:     e('BRAND_COLOR_NAVY',    '#1A4D8F'),
    teal:     e('BRAND_COLOR_TEAL',    '#15B8A6'),
  },

  // ── Assets ───────────────────────────────────────────────────────────────────
  assets: {
    /**
     * Fully-qualified public URL to the brand icon — used in email <img> tags.
     * Must be a public URL (not a relative path). Leave blank to use the
     * CSS-rendered wordmark fallback in emails.
     */
    logoUrl: e('BRAND_LOGO_URL', ''),
  },
} as const

export type BrandConfig = typeof brandConfig
