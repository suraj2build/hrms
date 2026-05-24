#!/usr/bin/env node
/**
 * check-raw-colors.mjs
 *
 * Scans all TypeScript/TSX source files for raw Tailwind palette color classes
 * that must be replaced with Aurora Navy design tokens.
 *
 * Usage:
 *   node scripts/check-raw-colors.mjs          # scan src/
 *   node scripts/check-raw-colors.mjs --fix    # show fix hints only (no auto-fix)
 *   node scripts/check-raw-colors.mjs --quiet  # exit code only (no output)
 *
 * Exit codes:
 *   0  – No violations found
 *   1  – One or more violations found
 *
 * Add to CI: npm run lint:colors
 * Add to pre-commit: husky + "npm run lint:colors"
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', 'src')
const ARGS = process.argv.slice(2)
const QUIET = ARGS.includes('--quiet')

/**
 * Tailwind palette color names that are banned in className strings.
 * semantic tokens (primary, success, muted, etc.) are NOT in this list.
 */
const BANNED_PALETTE_COLORS = [
  'red', 'rose', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink',
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'white', 'black',
]

/**
 * Properties/attributes that may carry className-like strings.
 * We scan ALL lines, not just JSX — this catches cn(), clsx(), cv() calls too.
 */
const COLOR_PATTERN = new RegExp(
  '(?:^|[\\s\'"({[,`])' +
  '(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|divide|placeholder|accent|caret|outline)' +
  '-(' + BANNED_PALETTE_COLORS.join('|') + ')' +
  '-[0-9]' +
  '(?:[0-9]*(?:\\/[0-9]+)?)?' +
  '(?=[\\s\'")\\]}`,]|$)',
  'g',
)

/**
 * Files and directories to skip.
 */
const SKIP_PATTERNS = [
  /node_modules/,
  /\.d\.ts$/,
  /\.(test|spec)\.(ts|tsx)$/,
  // Skip the design-system docs (they intentionally show banned class names as examples)
  /src\/theme\//,
]

// ── File walker ───────────────────────────────────────────────────────────────

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (!SKIP_PATTERNS.some((p) => p.test(full))) walk(full, files)
    } else if (['.ts', '.tsx'].includes(extname(full))) {
      if (!SKIP_PATTERNS.some((p) => p.test(full))) files.push(full)
    }
  }
  return files
}

// ── Token suggestion map ──────────────────────────────────────────────────────

const SUGGESTIONS = {
  // Background
  'bg-emerald':  'bg-success',
  'bg-red':      'bg-destructive',
  'bg-rose':     'bg-destructive',
  'bg-amber':    'bg-warning',
  'bg-yellow':   'bg-warning',
  'bg-blue':     'bg-info',
  'bg-sky':      'bg-info',
  'bg-cyan':     'bg-accent-teal',
  'bg-teal':     'bg-accent-teal',
  'bg-violet':   'bg-accent-violet',
  'bg-purple':   'bg-primary   (or bg-accent-violet)',
  'bg-indigo':   'bg-primary',
  'bg-pink':     'bg-accent-magenta',
  'bg-fuchsia':  'bg-accent-magenta',
  'bg-orange':   'bg-accent-coral',
  'bg-slate':    'bg-muted',
  'bg-gray':     'bg-muted',
  'bg-zinc':     'bg-muted',
  'bg-stone':    'bg-muted',
  'bg-neutral':  'bg-muted',
  'bg-white':    'bg-background (or bg-card)',
  'bg-black':    'bg-foreground',
  'bg-lime':     'bg-success',
  'bg-green':    'bg-success',
  // Text
  'text-emerald': 'text-success',
  'text-red':     'text-destructive',
  'text-rose':    'text-destructive',
  'text-amber':   'text-warning',
  'text-yellow':  'text-warning',
  'text-blue':    'text-info',
  'text-sky':     'text-info',
  'text-cyan':    'text-accent-teal',
  'text-teal':    'text-accent-teal',
  'text-violet':  'text-accent-violet',
  'text-purple':  'text-primary   (or text-accent-violet)',
  'text-indigo':  'text-primary',
  'text-pink':    'text-accent-magenta',
  'text-fuchsia': 'text-accent-magenta',
  'text-orange':  'text-accent-coral',
  'text-slate':   'text-muted-foreground',
  'text-gray':    'text-muted-foreground',
  'text-zinc':    'text-muted-foreground',
  'text-stone':   'text-muted-foreground',
  'text-neutral': 'text-muted-foreground',
  'text-white':   'text-foreground (or text-primary-foreground)',
  'text-black':   'text-foreground',
  'text-lime':    'text-success',
  'text-green':   'text-success',
  // Border
  'border-emerald': 'border-success',
  'border-red':     'border-destructive',
  'border-rose':    'border-destructive',
  'border-amber':   'border-warning',
  'border-yellow':  'border-warning',
  'border-blue':    'border-info',
  'border-sky':     'border-info',
  'border-slate':   'border-border (or border-muted)',
  'border-gray':    'border-border',
  'border-zinc':    'border-border',
}

function getSuggestion(match) {
  const parts = match.trim().replace(/^['"`]/, '')
  // Extract the base class (e.g. bg-emerald from bg-emerald-500)
  const base = parts.replace(/-\d+.*$/, '')
  return SUGGESTIONS[base] ?? '→ use a design token from src/theme/usage.md'
}

// ── Scanner ───────────────────────────────────────────────────────────────────

let totalViolations = 0
const violations = []

for (const file of walk(ROOT)) {
  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  lines.forEach((line, idx) => {
    // Skip pure comment lines
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return

    const matches = [...line.matchAll(COLOR_PATTERN)]
    for (const match of matches) {
      const col = match.index + 1
      const raw = match[0].trim()
      violations.push({
        file: relative(ROOT, file),
        line: idx + 1,
        col,
        raw,
        suggestion: getSuggestion(raw),
      })
      totalViolations++
    }
  })
}

// ── Report ────────────────────────────────────────────────────────────────────

if (!QUIET) {
  if (totalViolations === 0) {
    console.log('✅  No raw Tailwind palette colors found. Token system is clean.\n')
  } else {
    console.error(`\n🚫  Aurora Navy Color Audit — ${totalViolations} violation${totalViolations === 1 ? '' : 's'} found\n`)
    console.error('    Raw Tailwind palette classes must be replaced with design tokens.')
    console.error('    See src/theme/usage.md for the full token reference.\n')
    console.error('─'.repeat(80))

    let lastFile = null
    for (const v of violations) {
      if (v.file !== lastFile) {
        console.error(`\n  📄  ${v.file}`)
        lastFile = v.file
      }
      console.error(`       ${String(v.line).padStart(4)}:${String(v.col).padEnd(4)}  ${v.raw.padEnd(40)}  → ${v.suggestion}`)
    }

    console.error('\n' + '─'.repeat(80))
    console.error(`\n  ${totalViolations} violation${totalViolations === 1 ? '' : 's'} must be fixed before merging.\n`)
  }
}

process.exit(totalViolations > 0 ? 1 : 0)
