#!/usr/bin/env node
/**
 * Frontend↔API route-existence checker.
 *
 * Flags apps/web `api.get/post/put/patch/del(...)` calls whose path matches NO
 * registered backend route — the 404 class (e.g. the frontend calling
 * GET /attendance/periods when only /attendance/period-locks exists).
 *
 * Resolves Fastify's route table statically by walking the register() tree from
 * index.ts (prefixes compound through nested registration). Does NOT validate
 * query-param values (the 400/enum class) and skips fully-dynamic paths.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = path.join(ROOT, 'apps/api/src'), WEB = path.join(ROOT, 'apps/web/src')

const norm = p => '/' + p.split('/').filter(Boolean).join('/')
const pat  = p => norm(p).replace(/:[A-Za-z0-9_]+/g, '*')
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.tsx?$/.test(e.name)) out.push(p) } return out }

// resolve a relative import spec from a file to an on-disk .ts(x)
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  let base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''))
  for (const c of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')])
    if (fs.existsSync(c)) return c
  return null
}
function parseFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const imports = new Map()
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)'/g)) imports.set(m[1], m[2])
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g))
    for (const name of m[1].split(',')) { const n = name.trim().split(/\s+as\s+/).pop().trim(); if (n) imports.set(n, m[2]) }
  const registers = []   // {ident?|spec?, prefix}
  for (const m of src.matchAll(/\bregister\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?\s*\)/g)) {
    const pm = m[2] && m[2].match(/prefix:\s*'([^']*)'/); registers.push({ ident: m[1], prefix: pm ? pm[1] : '' })
  }
  // dynamic: register(import('./path'), { prefix })
  for (const m of src.matchAll(/\bregister\(\s*import\(\s*'([^']+)'\s*\)\s*(?:,\s*\{([^}]*)\})?\s*\)/g)) {
    const pm = m[2] && m[2].match(/prefix:\s*'([^']*)'/); registers.push({ spec: m[1], prefix: pm ? pm[1] : '' })
  }
  const localRoutes = []  // {method, path}
  // matches `fastify.get('/x')` and `(fastify as any).get('/x')`
  for (const m of src.matchAll(/fastify(?:\s+as\s+any\))?\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) localRoutes.push({ method: m[1].toUpperCase(), path: m[2] })
  return { file, imports, registers, localRoutes }
}

// walk the registration tree from index.ts, compounding prefixes
const routes = new Set()
const cache = new Map()
const getParsed = f => { if (!cache.has(f)) cache.set(f, parseFile(f)); return cache.get(f) }
function walkRouter(file, prefix, stack) {
  if (stack.includes(file)) return
  const p = getParsed(file)
  for (const r of p.localRoutes) {
    const full = (r.path === '/' || r.path === '') ? (prefix || '/') : norm(prefix + r.path)
    routes.add(r.method + ' ' + pat(full))
  }
  for (const reg of p.registers) {
    const spec = reg.spec || p.imports.get(reg.ident); if (!spec) continue
    const child = resolveImport(file, spec); if (!child) continue
    const next = norm(prefix + (reg.prefix || ''))
    walkRouter(child, next === '/' ? '' : next, [...stack, file])
  }
}
walkRouter(path.join(API, 'index.ts'), '', [])
const routeList = [...routes].map(r => { const i = r.indexOf(' '); return { meth: r.slice(0, i), segs: r.slice(i + 1).split('/').filter(Boolean) } })
const segMatch = (c, r) => c.length === r.length && r.every((s, i) => s === '*' || c[i] === '*' || s === c[i])

// frontend calls
const METH = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE', delete: 'DELETE' }
const issues = []
for (const file of walk(WEB)) {
  const src = fs.readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\bapi\.(get|post|put|patch|del|delete)\b(?:<[^>(]*>)?\(\s*([`'"])([^`'"]*)\2/g)) {
    const method = METH[m[1]]; let raw = m[3]
    if (!raw.startsWith('/')) continue
    raw = raw.split('?')[0].split('#')[0]
    // a segment that is exactly ${...} → wildcard; a literal with a trailing
    // ${...} (query string built inline, incl. nested templates) → keep the literal
    const segs = raw.split('/').filter(Boolean).map(s => s.includes('${') ? (s.replace(/\$\{.*$/, '') || '*') : s)
    if (!segs.length || segs.some(s => s === '')) continue
    if (routeList.some(r => r.meth === method && segMatch(segs, r.segs))) continue
    issues.push({ file: file.replace(ROOT + '/', ''), line: src.slice(0, m.index).split('\n').length, method, path: raw })
  }
}
const seen = new Set(), out = []
for (const i of issues) { const k = `${i.method} ${i.path}`; if (!seen.has(k)) { seen.add(k); out.push(i) } }
console.log(`Backend routes resolved: ${routes.size} · Unmatched frontend calls: ${out.length}\n`)
for (const i of out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
  console.log(`  ${(i.method + ' ' + i.path).padEnd(58)} ${i.file}:${i.line}`)
process.exit(out.length ? 1 : 0)
