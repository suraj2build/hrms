#!/usr/bin/env node
/**
 * scripts/local-server.mjs
 *
 * Minimal Supabase-compatible local development server.
 * Implements PostgREST + GoTrue endpoints so the Fastify API and web app
 * can run fully offline without Docker.
 *
 * Handles:
 *   GET/HEAD/POST/PATCH/DELETE  /rest/v1/{table}   — PostgREST CRUD
 *   POST                        /rest/v1/rpc/{fn}  — PostgREST RPC
 *   POST                        /auth/v1/token     — GoTrue login
 *   GET                         /auth/v1/user      — GoTrue get user
 *   POST                        /auth/v1/logout    — GoTrue sign out
 *   GET                         /health            — Health check
 *
 * Usage:
 *   JWT_SECRET=<secret> DATABASE_URL=postgresql://postgres@localhost/hrms \
 *     node scripts/local-server.mjs
 */

import http from 'node:http'
import crypto from 'node:crypto'

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PGRST_PORT      ?? '54321')
const JWT_SECRET  = process.env.JWT_SECRET               ?? process.env.SUPABASE_JWT_SECRET ?? 'local-dev-jwt-secret-hrms-cognixhr-2024-min32chars'
const DB_URL      = process.env.DATABASE_URL             ?? 'postgresql://postgres@localhost:5432/hrms'
const LOG_SQL     = process.env.LOG_SQL === 'true'

// ─── PostgreSQL pool ──────────────────────────────────────────────────────────

const pg = await import('pg').then(m => m.default ?? m)
const pool = new pg.Pool({ connectionString: DB_URL, max: 20 })
pool.on('error', err => console.error('[pg]', err.message))

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function jwtSign(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url')
  return `${h}.${b}.${s}`
}

function jwtVerify(token) {
  try {
    const [h, b, s] = token.split('.')
    if (!h || !b || !s) return null
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url')
    if (expected !== s) return null
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'))
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null
    return p
  } catch { return null }
}

function makeUserJwt(userId, email) {
  const now = Math.floor(Date.now() / 1000)
  return jwtSign({ aud: 'authenticated', exp: now + 604800, iat: now, iss: 'local-supabase', sub: userId, email, role: 'authenticated' })
}

// ─── SQL helpers ─────────────────────────────────────────────────────────────

function qi(name) {
  // Quote a table/column identifier; handle optional type casts (col::type)
  const cast = name.indexOf('::')
  if (cast > 0) return `"${name.slice(0, cast).replace(/"/g, '""')}"${name.slice(cast)}`
  return `"${name.replace(/"/g, '""')}"`
}

const PG_OPS = {
  eq:'=', neq:'!=', lt:'<', lte:'<=', gt:'>', gte:'>=',
  like:'LIKE', ilike:'ILIKE', in:'IN', cs:'@>', cd:'<@',
  ov:'&&', fts:'@@', plfts:'@@', phfts:'@@', wfts:'@@',
}

function parseFilter(col, spec, vals) {
  let negate = false, s = spec
  if (s.startsWith('not.')) { negate = true; s = s.slice(4) }

  const dot = s.indexOf('.')
  if (dot < 0) {
    vals.push(s); return maybeNot(`${qi(col)} = $${vals.length}`, negate)
  }
  const op = s.slice(0, dot), val = s.slice(dot + 1)

  if (op === 'is') {
    const clause = val === 'null' ? `${qi(col)} IS NULL`
      : val === 'true'            ? `${qi(col)} IS TRUE`
      : val === 'false'           ? `${qi(col)} IS FALSE`
      : (vals.push(val), `${qi(col)} IS $${vals.length}`)
    return maybeNot(clause, negate)
  }
  if (op === 'in') {
    const items = val.startsWith('(') && val.endsWith(')')
      ? val.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, ''))
      : [val]
    if (!items.length || (items.length === 1 && !items[0])) return negate ? '1=1' : '1=0'
    const phs = items.map(v => { vals.push(v); return `$${vals.length}` })
    return maybeNot(`${qi(col)} IN (${phs.join(', ')})`, negate)
  }

  const sqlOp = PG_OPS[op] ?? '='
  // PostgREST uses * as wildcard in like/ilike; translate to SQL %
  const sqlVal = (op === 'like' || op === 'ilike') ? val.replace(/\*/g, '%') : val
  vals.push(sqlVal)
  return maybeNot(`${qi(col)} ${sqlOp} $${vals.length}`, negate)
}

function maybeNot(clause, negate) {
  return negate ? `NOT (${clause})` : clause
}

// Split a,b(c,d),e on top-level commas only
function splitTop(str) {
  const out = []; let depth = 0, start = 0
  for (let i = 0; i <= str.length; i++) {
    const ch = i < str.length ? str[i] : ','
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { out.push(str.slice(start, i).trim()); start = i + 1 }
  }
  return out.filter(Boolean)
}

const RESERVED = new Set(['select','order','limit','offset','or','and','count'])

function buildWhere(searchParams, vals) {
  const clauses = []
  for (const [k, v] of searchParams.entries()) {
    if (RESERVED.has(k)) continue
    if (k === 'or') {
      const inner = v.startsWith('(') && v.endsWith(')') ? v.slice(1, -1) : v
      const parts = splitTop(inner).map(p => {
        const m = p.match(/^([^.]+)\.(.+)$/)
        return m ? parseFilter(m[1], m[2], vals) : '1=1'
      })
      if (parts.length) clauses.push(`(${parts.join(' OR ')})`)
      continue
    }
    clauses.push(parseFilter(k, v, vals))
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

function parseSelectCols(sel) {
  if (!sel || sel === '*') return '*'
  const cols = splitTop(sel).filter(c => !c.includes('('))
    .map(c => { const colon = c.indexOf(':'); return qi(colon > 0 ? c.slice(colon + 1) : c) })
  return cols.length ? cols.join(', ') : '*'
}

function parseOrder(order) {
  if (!order) return ''
  return 'ORDER BY ' + order.split(',').map(part => {
    const [col, dir, nulls] = part.trim().split('.')
    let s = qi(col) + (dir === 'desc' ? ' DESC' : ' ASC')
    if (nulls === 'nullsfirst') s += ' NULLS FIRST'
    if (nulls === 'nullslast')  s += ' NULLS LAST'
    return s
  }).join(', ')
}

async function runSQL(sql, vals) {
  if (LOG_SQL) console.log('[sql]', sql, vals)
  return pool.query(sql, vals)
}

// ─── Body reader ─────────────────────────────────────────────────────────────

async function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')) } catch { resolve(null) } })
    req.on('error', reject)
  })
}

// ─── Response helper ─────────────────────────────────────────────────────────

function send(res, status, data, extra = {}) {
  const body = data === null || data === undefined ? ''
    : typeof data === 'string' ? data
    : JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra })
  res.end(body)
}

// ─── REST handler ─────────────────────────────────────────────────────────────

async function handleRest(req, res, url) {
  const segs    = url.pathname.replace(/^\/rest\/v1\/?/, '').split('/').filter(Boolean)
  const table   = segs[0]

  if (!table) { send(res, 200, {}); return }

  // RPC
  if (table === 'rpc') {
    const fn = segs[1]
    if (!fn) { send(res, 400, { error: 'RPC function name required' }); return }
    await handleRPC(req, res, url, fn)
    return
  }

  const prefer     = req.headers.prefer ?? ''
  const wantCount  = prefer.includes('count=exact')
  const wantReturn = prefer.includes('return=representation') || prefer.includes('return=minimal') === false
  const rangeHdr   = req.headers['range'] ?? ''

  const sp     = url.searchParams

  // Read limit/offset from URL query params first, then Range header overrides
  let offset = parseInt(sp.get('offset') ?? '0') || 0
  let limit  = parseInt(sp.get('limit')  ?? '1000') || 1000
  const rm = rangeHdr.match(/^(\d+)-(\d+)$/)
  if (rm) { offset = parseInt(rm[1]); limit = parseInt(rm[2]) - parseInt(rm[1]) + 1 }

  const selStr = parseSelectCols(sp.get('select') ?? '*')
  const ordStr = parseOrder(sp.get('order') ?? '')

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const wantSingle = (req.headers.accept ?? '').includes('application/vnd.pgrst.object+json')
    const vals = []
    const where = buildWhere(sp, vals)
    const selectSQL = `SELECT ${selStr} FROM ${qi(table)} ${where} ${ordStr} LIMIT ${limit} OFFSET ${offset}`

    const [rowsR, countR] = await Promise.all([
      runSQL(selectSQL, [...vals]),
      wantCount ? runSQL(`SELECT COUNT(*) FROM ${qi(table)} ${where}`, [...vals]) : Promise.resolve(null),
    ])
    const rows  = rowsR.rows
    const total = countR ? parseInt(countR.rows[0].count) : '*'
    const last  = offset + rows.length - 1
    const range = rows.length > 0 ? `${offset}-${last}/${total}` : `*/${total === '*' ? 0 : total}`

    if (wantSingle) {
      if (rows.length === 0) {
        send(res, 406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
        return
      }
      if (rows.length > 1) {
        send(res, 406, { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
        return
      }
      send(res, 200, rows[0], { 'Content-Range': range })
      return
    }

    send(res, 200, rows, { 'Content-Range': range })
    return
  }

  // ── HEAD ───────────────────────────────────────────────────────────────────
  if (req.method === 'HEAD') {
    const vals = []
    const where = buildWhere(sp, vals)
    const { rows: cr } = await runSQL(`SELECT COUNT(*) FROM ${qi(table)} ${where}`, vals)
    res.setHeader('Content-Range', `*/${cr[0].count}`)
    res.writeHead(200)
    res.end()
    return
  }

  // ── POST (insert) ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const payload = await body(req)
    if (!payload) { send(res, 201, []); return }
    const rows = Array.isArray(payload) ? payload : [payload]
    if (!rows.length) { send(res, 201, []); return }

    const cols = Object.keys(rows[0])
    const colSQL = cols.map(qi).join(', ')
    const allVals = []
    const valSets = rows.map(row =>
      '(' + cols.map(c => { allVals.push(row[c] ?? null); return `$${allVals.length}` }).join(', ') + ')'
    )
    const onConflict = (prefer.includes('merge-duplicates') || prefer.includes('ignore-duplicates')) ? 'ON CONFLICT DO NOTHING' : ''
    const returning = prefer.includes('return=minimal') ? '' : 'RETURNING *'
    const ins = `INSERT INTO ${qi(table)} (${colSQL}) VALUES ${valSets.join(',')} ${onConflict} ${returning}`
    const { rows: inserted } = await runSQL(ins, allVals)
    if (prefer.includes('return=minimal')) {
      send(res, 201, null)
    } else {
      send(res, 201, inserted)
    }
    return
  }

  // ── PATCH (update) ────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const payload = await body(req)
    if (!payload) { send(res, 200, []); return }
    const updates = Object.entries(payload)
    if (!updates.length) { send(res, 200, []); return }

    const setVals = []
    const setClauses = updates.map(([c, v]) => { setVals.push(v ?? null); return `${qi(c)} = $${setVals.length}` })

    const filterVals = []
    const where = buildWhere(sp, filterVals)
    // Shift filter param indices
    const shiftedWhere = where.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + setVals.length}`)

    const sql = `UPDATE ${qi(table)} SET ${setClauses.join(', ')} ${shiftedWhere} RETURNING *`
    const { rows: updated } = await runSQL(sql, [...setVals, ...filterVals])
    send(res, 200, updated)
    return
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const vals = []
    const where = buildWhere(sp, vals)
    const sql = `DELETE FROM ${qi(table)} ${where} RETURNING *`
    const { rows: deleted } = await runSQL(sql, vals)
    send(res, 200, deleted)
    return
  }

  send(res, 405, { error: 'Method not allowed' })
}

// ─── RPC handler ──────────────────────────────────────────────────────────────

async function handleRPC(req, res, url, fn) {
  const params = req.method === 'POST' ? (await body(req) ?? {}) : {}
  const keys = Object.keys(params)
  const vals = Object.values(params)
  const paramList = keys.map((k, i) => `"${k}" := $${i + 1}`).join(', ')
  try {
    const { rows } = await runSQL(`SELECT * FROM ${fn}(${paramList})`, vals)
    send(res, 200, rows.length === 1 && rows[0] && !Array.isArray(rows[0]) ? rows[0] : rows)
  } catch (err) {
    send(res, 400, { message: err.message, code: err.code })
  }
}

// ─── Auth handler (minimal GoTrue) ───────────────────────────────────────────

async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '') || '/'

  // CORS preflight already handled above

  if (req.method === 'POST' && path === '/token') {
    const grant = url.searchParams.get('grant_type')

    if (grant === 'password') {
      const { email, password } = (await body(req)) ?? {}
      if (!email || !password) { send(res, 400, { error: 'invalid_request', error_description: 'email and password required' }); return }

      const { rows } = await pool.query('SELECT id, email, encrypted_password FROM auth.users WHERE email = $1', [email])
      if (!rows.length) { send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); return }

      const user = rows[0]
      const ok = await verifyPw(password, user.encrypted_password)
      if (!ok) { send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); return }

      await pool.query('UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1', [user.id])
      const token = makeUserJwt(user.id, user.email)
      send(res, 200, {
        access_token: token, token_type: 'bearer', expires_in: 604800,
        refresh_token: crypto.randomBytes(24).toString('hex'),
        user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' },
      })
      return
    }

    if (grant === 'refresh_token') {
      // For local dev: refresh tokens not stored; ask client to re-login
      send(res, 400, { error: 'invalid_grant', error_description: 'Refresh tokens not supported in local dev; please sign in again' })
      return
    }

    send(res, 400, { error: 'unsupported_grant_type' })
    return
  }

  if (req.method === 'GET' && path === '/user') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const payload = token ? jwtVerify(token) : null
    if (!payload) { send(res, 401, { code: 401, error_code: 'no_session', message: 'Not authenticated' }); return }

    const { rows } = await pool.query('SELECT id, email FROM auth.users WHERE id = $1', [payload.sub])
    if (!rows.length) { send(res, 404, { message: 'user not found' }); return }
    send(res, 200, { id: rows[0].id, email: rows[0].email, aud: 'authenticated', role: 'authenticated' })
    return
  }

  if (req.method === 'POST' && path === '/logout') {
    send(res, 204, null)
    return
  }

  if (req.method === 'GET' && path === '/settings') {
    send(res, 200, { external: {}, disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: true })
    return
  }

  // Sign up
  if (req.method === 'POST' && path === '/signup') {
    const { email, password } = (await body(req)) ?? {}
    if (!email || !password) { send(res, 400, { error: 'email and password required' }); return }
    const bcryptjs = await import('bcryptjs').then(m => m.default ?? m)
    const hash = await bcryptjs.hash(password, 10)
    try {
      const { rows } = await pool.query(
        'INSERT INTO auth.users (email, encrypted_password) VALUES ($1, $2) RETURNING id, email',
        [email, hash]
      )
      const token = makeUserJwt(rows[0].id, rows[0].email)
      send(res, 200, {
        access_token: token, token_type: 'bearer', expires_in: 604800,
        user: { id: rows[0].id, email, aud: 'authenticated', role: 'authenticated' },
      })
    } catch (e) {
      if (e.code === '23505') send(res, 400, { error: 'email already registered' })
      else throw e
    }
    return
  }

  send(res, 404, { error: 'Auth endpoint not found: ' + path })
}

// ─── Password verification ────────────────────────────────────────────────────

async function verifyPw(plain, hash) {
  if (!hash) return false
  if (hash.startsWith('$2')) {
    const bcryptjs = await import('bcryptjs').then(m => m.default ?? m)
    return bcryptjs.compare(plain, hash)
  }
  // Plain text fallback (for seeded test accounts)
  return plain === hash
}

// ─── Main server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers',
    'Authorization,apikey,Content-Type,Prefer,Range,X-Client-Info,X-Supabase-Api-Version,X-Upsert')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range,X-Total-Count')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  try {
    if (url.pathname === '/health' || url.pathname === '/') {
      send(res, 200, { status: 'ok', version: 'local-dev' }); return
    }
    if (url.pathname.startsWith('/auth/v1')) {
      await handleAuth(req, res, url); return
    }
    if (url.pathname.startsWith('/rest/v1')) {
      await handleRest(req, res, url); return
    }
    if (url.pathname.startsWith('/storage/v1')) {
      // Stub: return 200 for most storage calls to avoid hard failures
      send(res, 200, { message: 'Storage not available in local-dev server' }); return
    }
    send(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[error]', req.method, url.pathname, err.message)
    send(res, 500, { message: err.message, code: err.code })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ local-server running at http://localhost:${PORT}`)
  console.log('  PostgREST : /rest/v1/')
  console.log('  Auth (GoTrue): /auth/v1/')
  console.log('  DB:', DB_URL, '\n')
})

process.on('SIGTERM', async () => { await pool.end(); server.close() })
process.on('SIGINT',  async () => { await pool.end(); server.close() })
