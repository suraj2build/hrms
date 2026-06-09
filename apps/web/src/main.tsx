import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import './index.css'

// ── Stale-chunk recovery ────────────────────────────────────────────────────
// When a new build deploys, lazy chunk filenames change (content hashes). A tab
// loaded before the deploy still references the OLD hashes, so navigating to a
// lazy route 404s: "Failed to fetch dynamically imported module". This is why it
// appears on random pages — whichever lazy route you open first after a deploy.
// Vite fires `vite:preloadError` for exactly this — reload once to pull the
// fresh build. A 10s guard prevents an infinite loop if a chunk is truly gone.
window.addEventListener('vite:preloadError', () => {
  const KEY = 'vite-preload-reload-ts'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last < 10_000) return
  sessionStorage.setItem(KEY, String(Date.now()))
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
