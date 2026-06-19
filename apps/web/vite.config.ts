import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import type { ServerOptions } from 'vite'

// ── Shared proxy options ───────────────────────────────────────────────────────
//
// All API routes proxy to the Fastify server at :2001.
// The `configure` callback registers an `error` handler on the underlying
// http-proxy instance so that when port 2001 is unreachable (ECONNREFUSED)
// the browser receives a proper 502 JSON response instead of the browser
// throwing a `TypeError: Failed to fetch` (which is indistinguishable from a
// genuine network outage and prevents the frontend from showing a useful error).
//
// IMPORTANT: Do NOT set VITE_API_URL in any .env file in development.
// Doing so bypasses this proxy entirely, sending absolute requests directly
// to port 2001 — which triggers CORS pre-flights and "Failed to fetch" errors
// whenever the API restarts. Relative URLs + this proxy is the only correct
// dev setup. See apps/web/.env for the authoritative dev configuration.

function apiProxy(extra?: object): NonNullable<NonNullable<ServerOptions['proxy']>[string]> {
  return {
    target: 'http://localhost:2001',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (_err, _req, res) => {
        // If headers haven't been flushed yet, send a machine-readable 502
        // so the API client can throw a proper Error instead of "Failed to fetch".
        if (typeof (res as any).writeHead === 'function' && !(res as any).headersSent) {
          ;(res as any).writeHead(502, { 'Content-Type': 'application/json' })
          ;(res as any).end(
            JSON.stringify({ error: 'API_UNREACHABLE', message: 'API server is not reachable. Ensure `npm run dev` started the API on port 2001.' })
          )
        }
      })
    },
    ...extra,
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // Strip noisy console.log/debug/info from production bundles (keep error/warn
  // so real failures still surface — and so Sentry can capture them later).
  esbuild: mode === 'production'
    ? { pure: ['console.log', 'console.debug', 'console.info'] }
    : undefined,

  build: {
    // Split the few very heavy vendor libraries out of the main bundle so the
    // initial load only pulls what every page needs. Pages already lazy-load;
    // this addresses the shared vendor chunk (~1.4 MB before splitting).
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('xlsx'))                            return 'vendor-xlsx'
          if (id.includes('@supabase'))                       return 'vendor-supabase'
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'vendor-react'
          if (id.includes('@tanstack'))                       return 'vendor-query'
          if (id.includes('lucide-react'))                    return 'vendor-icons'
          return undefined // everything else stays in the shared chunk
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // tw-animate-css lives in the monorepo root node_modules; alias the bare
      // specifier to its compiled CSS file so Vite can resolve it from index.css
      'tw-animate-css': path.resolve(
        __dirname,
        '../../node_modules/tw-animate-css/dist/tw-animate.css',
      ),
    },
  },
  server: {
    port: 2000,
    proxy: {
      // Legacy explicit prefix kept for backward-compat (any link using /api/...).
      '/api': apiProxy({ rewrite: (p: string) => p.replace(/^\/api/, '') }),

      // ── API routes forwarded to Fastify at :2001 ──────────────────────────
      // Explicit path prefixes covering every route registered in
      // apps/api/src/index.ts. Using explicit prefixes (instead of a catch-all
      // '/') avoids accidentally proxying Vite's HMR websocket and asset requests.
      '/me':              apiProxy(),
      '/setup':           apiProxy(),
      '/employees':       apiProxy(),
      '/departments':     apiProxy(),
      '/designations':    apiProxy(),
      '/grades':          apiProxy(),
      '/documents':       apiProxy(),
      '/analytics':       apiProxy(),
      '/reports':         apiProxy(),
      '/masters':         apiProxy(),
      '/import':          apiProxy(),
      '/onboarding':      apiProxy(),
      '/attendance':      apiProxy(),
      '/leave':           apiProxy(),
      '/leave-requests':  apiProxy(),
      '/approvals':       apiProxy(),
      // /manager has both API routes (e.g. GET /manager/dashboard JSON) and
      // frontend page routes (/manager/dashboard, /manager/team/*, etc.).
      // The bypass returns index.html for browser navigation requests (Accept: text/html)
      // so React Router handles the route client-side; fetch/XHR calls are proxied normally.
      '/manager':         apiProxy({
        bypass(req: { headers: Record<string, string | string[] | undefined> }) {
          const accept = req.headers['accept'] ?? ''
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return '/index.html'
          }
        },
      }),
      '/recruitment':     apiProxy(),
      '/payroll':         apiProxy(),
      '/compensation':    apiProxy(),
      '/overtime':        apiProxy(),
      '/letters':         apiProxy(),
      '/notifications':   apiProxy(),
      '/users':           apiProxy(),
      // ESS-specific API endpoints (avoid proxying the /ess/* frontend page routes)
      '/ess/workforce-notifications': apiProxy(),
      '/ess/operational-summary':     apiProxy(),
      '/ess/workload-balance':        apiProxy(),
      '/ess/schedule-fairness':       apiProxy(),
      '/ess/upcoming-payroll-impact': apiProxy(),
      '/executive':       apiProxy(),   // Executive Intelligence Center
      '/system':          apiProxy(),
      '/workspace':       apiProxy(),
      '/governance':      apiProxy(),
      '/trust':           apiProxy(),
      '/operations':      apiProxy(),
      '/fabric':          apiProxy(),
      '/health':          apiProxy(),
      '/ready':           apiProxy(),
      '/status':          apiProxy(),  // alias → GET /status on Fastify
      // Owner panel API routes — /owner/* frontend routes are handled by React Router
      // Bypass proxy for HTML navigation requests so React Router handles the route
      '/owner':           apiProxy({
        bypass(req: { headers: Record<string, string | string[] | undefined> }) {
          const accept = req.headers['accept'] ?? ''
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return '/index.html'
          }
        },
      }),
    },
  },
}))
