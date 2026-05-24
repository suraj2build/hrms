// Tailwind v4 is handled entirely by @tailwindcss/vite (vite.config.ts).
// PostCSS plugins are intentionally empty — adding postcss-import or autoprefixer
// here causes PostCSS to parse Vite-internal JS files as CSS and fail.
export default {
  plugins: {},
}
