import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      '/api': {
        target: 'http://localhost:2001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
