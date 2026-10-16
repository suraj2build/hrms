// Minimal local stand-in for the pieces of the Supabase platform this repo's
// app code actually talks to over HTTP: a Kong-style gateway implementing
// just the /auth/v1/* endpoints the web app calls (signInWithPassword /
// getUser / logout / signup / refresh / admin createUser+getUserById), plus
// a purpose-built PostgREST-compatible /rest/v1/* engine (the real
// `postgrest` binary is unreachable from this sandbox — no Docker, and
// outbound HTTPS to github.com release assets is blocked by this session's
// egress policy).
//
// SYSTEM_AUDIT_2026-10-14 checkpoint 13 — now committed (previously lived
// only at /tmp/supabase-gateway.mjs, recreated from scratch each session,
// with no history). Committing it gives the fix below a durable, versioned
// home instead of a file that evaporates when the sandbox does — run it
// with `node scripts/db/local-test-gateway.mjs` to stand up the same local
// stack any of this audit's scripts/db/verify-*.mjs real-HTTP scripts talk
// to. Still not part of the product: nothing under apps/ imports or starts
// this file; it is test-only infrastructure, kept in-repo purely for
// reproducibility across sessions.
//
// The REST engine supports the subset of PostgREST's HTTP API this codebase
// actually generates via @supabase/postgrest-js: eq/neq/gt/gte/lt/lte/like/
// ilike/is/in/not.*, or=(...)/and=(...) groups, order, limit/offset,
// select= with embedded-resource joins (both directions, resolved via a FK
// graph introspected from the DB at startup), insert/upsert/update/delete
// with Prefer: return=representation, count=exact via Content-Range, and
// POST /rpc/:fn. Built iteratively against real usage, not audited against
// the full PostgREST spec — see docs/UAT_LIVE_AUDIT.md's "Environment/
// methodology note" pattern for how gaps get closed as they're found.
//
// Fix history (kept here, not just in commit messages, so a diff of this
// file explains itself without archaeology):
// - checkpoint 13: JSONB_NULL_COLUMNS — the generic insert/update handler
//   had no column-type awareness and forwarded any JS `null` as a bare SQL
//   NULL, which broke every real claimIdempotency() call against a
//   NOT-NULL jsonb column (idempotency_keys.response) with a silent
//   fail-safe on the caller's side, not a visible gateway error. See
//   docs/production-readiness/SYSTEM_AUDIT_2026-10-14-MODULE-COVERAGE.md's
//   checkpoint 13 entry for the full writeup, root-cause repro, and the
//   confirmation that no earlier round's evidence relied on the broken path.

import http from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const PORT = 9000
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const MAX_ROWS = 1000

// Real PostgREST serializes `date` columns (OID 1082) as plain "YYYY-MM-DD"
// strings, not JS Date/ISO-timestamp. node-postgres' default type parser
// returns a Date object instead, which JSON.stringify then renders as a full
// ISO timestamp ("...T00:00:00.000Z") — breaking any frontend code that
// expects a bare date string (e.g. date-only arithmetic/concatenation).
// Override it here so this test gateway matches real PostgREST wire format.
pg.types.setTypeParser(1082, (val) => val)

const pool = new pg.Pool({ connectionString: DB_URL, max: 20 })

// SYSTEM_AUDIT_2026-10-14 checkpoint 13 — found while real-HTTP-testing the
// encashment-request route's idempotency-key handling: real PostgREST
// distinguishes an explicit JSON `null` sent for a jsonb column (stored as
// the jsonb null literal, 'null'::jsonb) from a SQL NULL — this matters for
// NOT NULL jsonb columns like idempotency_keys.response, which
// claimIdempotency() deliberately sets to the JS value `null` while a claim
// is in-flight (lib/idempotency.ts). This generic insert/update handler had
// no column-type awareness and forwarded any JS `null` as a bare SQL NULL
// parameter, so every real claimIdempotency() call through this gateway hit
// a NOT NULL violation and silently fell back to "couldn't claim" — a test-
// infra gap, not a product bug (this gateway's own header comment already
// disclaims full PostgREST-spec coverage). Listed explicitly rather than
// inferred from a schema cache this shim doesn't have.
const JSONB_NULL_COLUMNS = { idempotency_keys: new Set(['response']) }
function jsonbNullParam(table, column, value) {
  if (value === null && JSONB_NULL_COLUMNS[table]?.has(column)) return 'null'
  return value && typeof value === 'object' ? JSON.stringify(value) : value
}

// ── JWT ──────────────────────────────────────────────────────────────────────

function b64url(buf) { return Buffer.from(buf).toString('base64url') }

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url')
  return `${headerB64}.${payloadB64}.${sig}`
}

function verifyJwt(token) {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.')
    const expected = createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url')
    const expectedBuf = Buffer.from(expected)
    const sigBuf = Buffer.from(sigB64)
    if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) return null
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    return null
  }
}

// ── Auth (GoTrue-shim) ───────────────────────────────────────────────────────

const CREDENTIALS = {
  'demo@cognixhr.app':          'CognixDemo!1',
  'checker@cognixhr.app':       'CognixDemo!1',
  'checker2@cognixhr.app':      'CognixDemo!1',
  'rahul.manager@cognixhr.app': 'CognixDemo!1',
}

async function findOrCreateUser(email) {
  const { rows } = await pool.query('SELECT id, email FROM auth.users WHERE email = $1', [email])
  if (rows[0]) return rows[0]
  const id = randomUUID()
  await pool.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, email])
  await pool.query(
    `INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider)
     VALUES ($1, $2, $3, $4, 'email')`,
    [randomUUID(), id, id, JSON.stringify({ sub: id, email })],
  )
  return { id, email }
}

function mintSession(user) {
  const now = Math.floor(Date.now() / 1000)
  const access_token = signJwt({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated',
    iat: now, exp: now + 60 * 60 * 24,
  })
  return {
    access_token, token_type: 'bearer', expires_in: 60 * 60 * 24,
    refresh_token: `refresh-${user.id}`,
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
  }
}

// ── FK graph (for embedded-resource selects) ───────────────────────────────

let fkGraph = { to: new Map(), from: new Map() } // to: table -> col -> {refTable, refCol}; from: table -> [{table, col, refCol}]

async function loadFkGraph() {
  // Uses pg_constraint directly rather than the information_schema views —
  // joining table_constraints/key_column_usage/constraint_column_usage on
  // constraint_name + table_schema alone (the "standard" recipe) fans out
  // badly whenever a constraint_name string is reused across different
  // tables (only unique per-table in Postgres, not per-schema): on this
  // 478-table schema it produced 22,356 "FK" rows instead of ~1,100, and
  // took long enough to look like a hang. pg_constraint has no such issue.
  const { rows } = await pool.query(`
    SELECT
      rel.relname   AS table_name,
      att.attname   AS column_name,
      frel.relname  AS ref_table,
      fatt.attname  AS ref_column,
      c.conname     AS constraint_name
    FROM pg_constraint c
    JOIN pg_class rel  ON rel.oid  = c.conrelid
    JOIN pg_class frel ON frel.oid = c.confrelid
    JOIN unnest(c.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
    JOIN pg_attribute att  ON att.attrelid  = c.conrelid  AND att.attnum  = ck.attnum
    JOIN pg_attribute fatt ON fatt.attrelid = c.confrelid AND fatt.attnum = fk.attnum
    WHERE c.contype = 'f' AND rel.relnamespace = 'public'::regnamespace
  `)
  const to = new Map()
  const from = new Map()
  for (const r of rows) {
    if (!to.has(r.table_name)) to.set(r.table_name, new Map())
    to.get(r.table_name).set(r.column_name, { refTable: r.ref_table, refColumn: r.ref_column, constraintName: r.constraint_name })
    if (!from.has(r.ref_table)) from.set(r.ref_table, [])
    from.get(r.ref_table).push({ table: r.table_name, column: r.column_name, refColumn: r.ref_column, constraintName: r.constraint_name })
  }
  fkGraph = { to, from }
  console.log(`[rest-engine] FK graph loaded: ${rows.length} foreign keys`)
}

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
function qIdent(name) {
  if (!IDENT_RE.test(name)) throw new HttpError(400, `Invalid identifier: ${name}`)
  return `"${name}"`
}

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details }
}

// ── select= parser (columns + embeds) ───────────────────────────────────────
// Parses "col1,col2,alias:fk_table(colA,colB),other(*)" into a tree.
function parseSelect(selectStr) {
  const spec = selectStr ?? '*'
  let i = 0
  function parseList() {
    const items = []
    while (i < spec.length) {
      items.push(parseItem())
      if (spec[i] === ',') { i++; continue }
      break
    }
    return items
  }
  function parseItem() {
    let start = i
    while (i < spec.length && !',:()'.includes(spec[i])) i++
    let token = spec.slice(start, i)
    let alias = null
    if (spec[i] === ':') {
      alias = token
      i++
      start = i
      while (i < spec.length && !',:()'.includes(spec[i])) i++
      token = spec.slice(start, i)
    }
    // strip !inner / !hint suffixes (col!inner, col!fk_name)
    let hint = null
    let inner = false
    const bangIdx = token.indexOf('!')
    if (bangIdx !== -1) {
      const suffix = token.slice(bangIdx + 1)
      token = token.slice(0, bangIdx)
      if (suffix === 'inner') inner = true
      else hint = suffix
    }
    if (spec[i] === '(') {
      i++
      const children = parseList()
      if (spec[i] === ')') i++
      return { name: token, alias, embed: true, children, hint, inner }
    }
    return { name: token, alias, embed: false }
  }
  return parseList()
}

// ── filter value parsing (col=op.value) ─────────────────────────────────────

function buildFilterSql(column, opValue, params) {
  // opValue examples: eq.5, gte.2026-01-01, in.(1,2,3), is.null, not.eq.5, like.*foo*
  let negate = false
  let rest = opValue
  if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4) }
  const dotIdx = rest.indexOf('.')
  const op = dotIdx === -1 ? rest : rest.slice(0, dotIdx)
  const val = dotIdx === -1 ? '' : rest.slice(dotIdx + 1)
  const col = column.includes('.') ? column.split('.').map(qIdent).join('.') : qIdent(column)

  let sql
  switch (op) {
    case 'eq':  params.push(val); sql = `${col} = $${params.length}`; break
    case 'neq': params.push(val); sql = `${col} != $${params.length}`; break
    case 'gt':  params.push(val); sql = `${col} > $${params.length}`; break
    case 'gte': params.push(val); sql = `${col} >= $${params.length}`; break
    case 'lt':  params.push(val); sql = `${col} < $${params.length}`; break
    case 'lte': params.push(val); sql = `${col} <= $${params.length}`; break
    case 'like': params.push(val.replace(/\*/g, '%')); sql = `${col} LIKE $${params.length}`; break
    case 'ilike': params.push(val.replace(/\*/g, '%')); sql = `${col} ILIKE $${params.length}`; break
    case 'is': {
      if (val === 'null') sql = `${col} IS NULL`
      else if (val === 'true') sql = `${col} IS TRUE`
      else if (val === 'false') sql = `${col} IS FALSE`
      else { params.push(val); sql = `${col} = $${params.length}` }
      break
    }
    case 'in': {
      const inner = val.replace(/^\(/, '').replace(/\)$/, '')
      const items = inner.length ? inner.split(',').map((s) => s.replace(/^"|"$/g, '')) : []
      if (items.length === 0) { sql = negate ? 'true' : 'false'; return sql }
      const placeholders = items.map((it) => { params.push(it); return `$${params.length}` })
      sql = `${col} IN (${placeholders.join(',')})`
      break
    }
    case 'cs': params.push(val); sql = `${col} @> $${params.length}`; break
    case 'cd': params.push(val); sql = `${col} <@ $${params.length}`; break
    default:
      params.push(val); sql = `${col} = $${params.length}`
  }
  return negate ? `NOT (${sql})` : sql
}

// Parses a PostgREST "or"/"and" group string like "a.eq.1,b.eq.2,and(c.eq.3,d.eq.4)"
function buildLogicGroupSql(groupStr, joiner, params) {
  const parts = splitTopLevelCommas(groupStr)
  const clauses = parts.map((part) => {
    const m = part.match(/^(and|or)\((.*)\)$/)
    if (m) return `(${buildLogicGroupSql(m[2], m[1] === 'and' ? ' AND ' : ' OR ', params)})`
    const dotIdx = part.indexOf('.')
    const col = part.slice(0, dotIdx)
    const opVal = part.slice(dotIdx + 1)
    return buildFilterSql(col, opVal, params)
  })
  return clauses.join(joiner)
}

function splitTopLevelCommas(s) {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1 }
  }
  out.push(s.slice(start))
  return out.filter((x) => x.length)
}

// ── Embedded-resource resolution (N+1, correctness over performance) ───────

function resolveRelation(parentTable, item) {
  const { name, hint } = item
  const toMap = fkGraph.to.get(parentTable)
  const fromList = fkGraph.from.get(parentTable) ?? []

  // to-one: parentTable has an FK column referencing `name` (a table)
  if (toMap) {
    const candidates = [...toMap.entries()].filter(([, fk]) => fk.refTable === name)
    if (candidates.length) {
      const chosen = hint
        ? candidates.find(([col, fk]) => col === hint || fk.constraintName === hint) ?? candidates[0]
        : candidates[0]
      const [col, fk] = chosen
      return { kind: 'to-one', childCol: col, refTable: fk.refTable, refCol: fk.refColumn }
    }
  }
  // to-many: some table has an FK column referencing parentTable, and that table is `name`
  const revCandidates = fromList.filter((f) => f.table === name)
  if (revCandidates.length) {
    const chosen = hint
      ? revCandidates.find((f) => f.column === hint || f.constraintName === hint) ?? revCandidates[0]
      : revCandidates[0]
    return { kind: 'to-many', table: chosen.table, fkCol: chosen.column, parentCol: chosen.refColumn }
  }
  return null
}

// Builds the column list for a table, plus hidden "__jk_<col>" aliases for
// any FK/PK columns its embeds need to stitch results back together but the
// caller didn't explicitly request. Without this, a select like
// "id,name,employees(...)" never puts employee_id in the outer query's
// result set at all, so fetchEmbeds() has nothing to join on and every
// embed silently comes back null — real PostgREST includes these
// automatically since the join is server-side, and callers only see the
// columns they actually asked for.
function columnsSqlForItems(parentTable, items, tableAlias) {
  const flat = items.filter((it) => !it.embed)
  const hasStar = flat.some((it) => it.name === '*')
  if (hasStar || flat.length === 0) return `${qIdent(tableAlias)}.*`

  const flatNames = new Set(flat.map((it) => it.name))
  const hiddenCols = new Set()
  for (const embed of items.filter((it) => it.embed)) {
    const rel = embed._rel ?? resolveRelation(parentTable, embed)
    embed._rel = rel
    if (!rel) continue
    const joinCol = rel.kind === 'to-one' ? rel.childCol : rel.parentCol
    if (!flatNames.has(joinCol)) hiddenCols.add(joinCol)
  }

  const flatSql = flat.map((it) => {
    const col = `${qIdent(tableAlias)}.${qIdent(it.name)}`
    return it.alias ? `${col} AS ${qIdent(it.alias)}` : col
  })
  const hiddenSql = [...hiddenCols].map((c) => `${qIdent(tableAlias)}.${qIdent(c)} AS ${qIdent('__jk_' + c)}`)
  return [...flatSql, ...hiddenSql].join(', ')
}

async function fetchEmbeds(parentTable, parentRows, items, client) {
  if (!parentRows.length) return
  const embeds = items.filter((it) => it.embed)
  for (const embed of embeds) {
    const rel = embed._rel ?? resolveRelation(parentTable, embed)
    embed._rel = rel
    const outKey = embed.alias ?? embed.name
    if (!rel) {
      for (const row of parentRows) row[outKey] = null
      continue
    }
    const joinCol = rel.kind === 'to-one' ? rel.childCol : rel.parentCol
    const readJoinKey = (row) => (row[joinCol] !== undefined ? row[joinCol] : row['__jk_' + joinCol])

    if (rel.kind === 'to-one') {
      const ids = [...new Set(parentRows.map(readJoinKey).filter((v) => v != null))]
      if (!ids.length) { for (const row of parentRows) row[outKey] = null; continue }
      const cols = columnsSqlForItems(rel.refTable, embed.children, embed.name)
      // columnsSqlForItems only includes the columns the caller explicitly
      // asked for (plus hidden join-key columns for the embed's OWN
      // grandchild embeds) — it has no idea THIS fetch also needs rel.refCol
      // (the referenced table's PK) to key results back to parentRows below.
      // Without forcing it into the SELECT here, a caller requesting specific
      // columns (e.g. "leave_types(is_paid)", not "leave_types(*)") never
      // gets refCol back, so `byId` keys every row under the literal string
      // "undefined" and the embed silently resolves to null for every parent
      // row — confirmed via PR #30 UAT 2026-10-13: leave_requests's
      // "leave_types(is_paid)" embed always returned null, so attendance-
      // engine.ts's half-day leave/attendance merge treated every leave as
      // isPaid:false (`lt?.is_paid ?? false`) regardless of the real value,
      // which silently prevented EVERY half-day-leave + half-day-attendance
      // day from ever merging to a full payable day. Same bug class, and the
      // same fix, as the to-many branch's existing fkColSql below.
      const refColSql = embed.children.some((c) => !c.embed && c.name === rel.refCol)
        ? '' : `, ${qIdent(embed.name)}.${qIdent(rel.refCol)} AS ${qIdent('__jk_' + rel.refCol)}`
      const { rows } = await client.query(
        `SELECT ${cols}${refColSql} FROM ${qIdent(rel.refTable)} AS ${qIdent(embed.name)} WHERE ${qIdent(embed.name)}.${qIdent(rel.refCol)} = ANY($1)`,
        [ids],
      )
      const rowKeys = rows.map((r) => String(r[rel.refCol] ?? r['__jk_' + rel.refCol]))
      await fetchEmbeds(rel.refTable, rows, embed.children, client)
      const byId = new Map(rows.map((r, i) => [rowKeys[i], r]))
      for (const row of parentRows) {
        const key = readJoinKey(row)
        row[outKey] = key == null ? null : (byId.get(String(key)) ?? null)
      }
    } else if (embed.children.length === 1 && embed.children[0].name === 'count' && !embed.children[0].embed) {
      // PostgREST's embedded-resource count aggregate (e.g. select=
      // "*,child_table(count)") — special syntax, not a literal "count"
      // column on the child table. Real PostgREST returns this as a
      // single-element array [{ count: N }], which matches the Supabase JS
      // client's expectation for `.select('*, child(count)')`. Without this
      // special case, `embed.children` was parsed as a normal column list
      // containing a column literally named "count" and the generated SQL
      // (`SELECT count FROM child_table ...`) failed with a genuine Postgres
      // "column count does not exist" error for any table with no such
      // column — observed via GET /payroll/compensation/structures'
      // `salary_structure_components(count)` embed during PR #30 UAT
      // compensation-setup testing, 2026-10-12.
      const ids = [...new Set(parentRows.map(readJoinKey).filter((v) => v != null))]
      if (!ids.length) { for (const row of parentRows) row[outKey] = [{ count: 0 }]; continue }
      const { rows: countRows } = await client.query(
        `SELECT ${qIdent(rel.fkCol)} AS fk, COUNT(*)::int AS count FROM ${qIdent(rel.table)} WHERE ${qIdent(rel.fkCol)} = ANY($1) GROUP BY ${qIdent(rel.fkCol)}`,
        [ids],
      )
      const countByFk = new Map(countRows.map((r) => [String(r.fk), r.count]))
      for (const row of parentRows) {
        const key = readJoinKey(row)
        row[outKey] = [{ count: key == null ? 0 : (countByFk.get(String(key)) ?? 0) }]
      }
      continue
    } else {
      const ids = [...new Set(parentRows.map(readJoinKey).filter((v) => v != null))]
      if (!ids.length) { for (const row of parentRows) row[outKey] = []; continue }
      const cols = columnsSqlForItems(rel.table, embed.children, rel.table)
      // columnsSqlForItems only injects hidden "__jk_*" columns for THIS
      // table's OWN embeds (grandchildren) — it has no idea the CALLER also
      // needs rel.fkCol (the edge back to the parent) to group these rows.
      // Without forcing it into the SELECT here, grouping below reads
      // r[rel.fkCol] as undefined for every row whenever the caller didn't
      // also explicitly request that column, so every group lands under the
      // single literal key "undefined" and never matches a real parent id —
      // the embed silently comes back [] for every parent row.
      const fkColSql = `, ${qIdent(rel.table)}.${qIdent(rel.fkCol)} AS ${qIdent('__jk_' + rel.fkCol)}`
      const { rows } = await client.query(
        `SELECT ${cols}${fkColSql} FROM ${qIdent(rel.table)} AS ${qIdent(rel.table)} WHERE ${qIdent(rel.table)}.${qIdent(rel.fkCol)} = ANY($1)`,
        [ids],
      )
      // Capture the grouping key BEFORE the nested fetchEmbeds call below —
      // its own cleanup step strips every "__jk_*" key off these same row
      // objects once IT'S done (intended for grandchild embeds' hidden
      // columns), which would wipe ours out too if read afterward.
      const rowGroupKeys = rows.map((r) => String(r['__jk_' + rel.fkCol] ?? r[rel.fkCol]))
      await fetchEmbeds(rel.table, rows, embed.children, client)
      const grouped = new Map()
      rows.forEach((r, i) => {
        const key = rowGroupKeys[i]
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(r)
      })
      for (const row of parentRows) {
        const key = readJoinKey(row)
        row[outKey] = key == null ? [] : (grouped.get(String(key)) ?? [])
      }
    }
  }
  // Strip hidden join-key helper columns now that embeds are attached under
  // their own keys — the caller never asked for these.
  for (const row of parentRows) {
    for (const k of Object.keys(row)) {
      if (k.startsWith('__jk_')) delete row[k]
    }
  }
}

// ── REST engine: GET/POST/PATCH/DELETE /:table, POST /rpc/:fn ──────────────

// Cache of fnName -> Map(paramName -> udt_name), populated lazily from
// information_schema.parameters. See the RPC handler below for why this is
// needed: Array.isArray() alone can't tell a native Postgres array
// parameter apart from a jsonb parameter that happens to hold a JS array.
const fnArgTypesCache = new Map()
async function getFnArgTypes(client, fnName) {
  if (fnArgTypesCache.has(fnName)) return fnArgTypesCache.get(fnName)
  const { rows } = await client.query(
    `SELECT p.parameter_name, p.udt_name
     FROM information_schema.parameters p
     JOIN information_schema.routines r
       ON r.specific_name = p.specific_name AND r.specific_schema = p.specific_schema
     WHERE r.routine_schema = 'public' AND r.routine_name = $1 AND p.parameter_name IS NOT NULL`,
    [fnName],
  )
  const map = new Map(rows.map((r) => [r.parameter_name, r.udt_name]))
  fnArgTypesCache.set(fnName, map)
  return map
}

// Cache of fnName -> boolean (pg_proc.proretset): whether the function
// RETURNS SETOF/TABLE (a genuine row set — real PostgREST wraps these in a
// JSON array) vs a plain single-row type like `RETURNS leave_policy_masters`
// (a named composite, singular — real PostgREST returns that as ONE JSON
// object, same as a scalar JSON/JSONB-returning function, with no `.single()`
// needed client-side). Found via create_leave_policy_master_atomic /
// update_leave_policy_master_atomic (SYSTEM_AUDIT_2026-10-14 checkpoint 27):
// before this, the RPC handler always returned `result.rows` (an array) for
// any non-scalar result, so a client expecting the real-PostgREST singular
// shape for a `RETURNS <composite>` function saw an array instead and its
// field reads came back undefined.
const fnReturnsSetCache = new Map()
async function getFnReturnsSet(client, fnName) {
  if (fnReturnsSetCache.has(fnName)) return fnReturnsSetCache.get(fnName)
  const { rows } = await client.query(
    `SELECT proretset FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace LIMIT 1`,
    [fnName],
  )
  const returnsSet = rows[0]?.proretset ?? true // unknown function: default to the old (array) behavior
  fnReturnsSetCache.set(fnName, returnsSet)
  return returnsSet
}

async function handleRest(req, res, pathname, searchParams, role, claims) {
  const client = await pool.connect()
  try {
    if (role === 'service_role') {
      // bypass RLS entirely, matching Supabase's service_role semantics
    } else {
      const jwtClaims = claims ? JSON.stringify(claims) : JSON.stringify({ role })
      await client.query(`SET LOCAL request.jwt.claims = '${jwtClaims.replace(/'/g, "''")}'`)
      await client.query(`SET LOCAL ROLE ${role === 'authenticated' ? 'authenticated' : 'anon'}`)
    }

    const rpcMatch = pathname.match(/^\/rpc\/([a-zA-Z_][a-zA-Z0-9_]*)$/)
    if (rpcMatch) {
      const fnName = rpcMatch[1]
      const body = await readJsonBody(req)
      const argNames = Object.keys(body)
      // pg's default array serialization produces a Postgres array literal
      // ({...}), not JSON — a jsonb-typed function parameter needs the value
      // as a JSON string instead, same as the POST/PATCH handlers below.
      //
      // SYSTEM_AUDIT_2026-10-14 checkpoint 14 — found via
      // auto_lop_reject_regularisations_atomic's UUID[] parameter: a JS
      // array is also `typeof === 'object'`, so it was being JSON.stringify
      // 'd into a JSON-array STRING ("[\"...\"]"), which Postgres then
      // rejected trying to parse as a native UUID[] literal ("malformed
      // array literal"). A genuine Postgres ARRAY parameter needs to stay a
      // real JS array — node-postgres serializes that to the correct `{...}`
      // array-literal wire format itself. Only a non-array object (an
      // actual jsonb parameter) needs the JSON.stringify treatment.
      //
      // That fix itself over-corrected: credit_monthly_accrual_batch's
      // p_employee_days is JSONB holding a JS array of {employee_id, days}
      // objects, not a native Postgres array type — Array.isArray() alone
      // can't tell these two cases apart (both are JS arrays at the call
      // site), and passing a JSONB-destined array as a raw pg array
      // serializes it to `{...}` array-literal syntax, which Postgres then
      // rejects trying to parse as jsonb ("invalid input syntax for type
      // json"), found while investigating the leave-accrual.ts batch in
      // this same checkpoint. The only reliable disambiguator is the
      // function's OWN declared parameter type, introspected from
      // information_schema.parameters: a real array type's udt_name is
      // prefixed with '_' (e.g. '_uuid' for uuid[]); jsonb/json need
      // JSON.stringify regardless of whether the JS value is an array or a
      // plain object.
      const argTypes = await getFnArgTypes(client, fnName)
      const params = argNames.map((k) => {
        const v = body[k]
        const udtName = argTypes.get(k)
        if (udtName && udtName.startsWith('_')) return v // native Postgres array type
        if (udtName === 'jsonb' || udtName === 'json') {
          return v === null ? null : JSON.stringify(v)
        }
        if (Array.isArray(v)) return v
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
      })
      const argsSql = argNames.map((k, idx) => `${qIdent(k)} := $${idx + 1}`).join(', ')
      const sql = `SELECT * FROM ${qIdent(fnName)}(${argsSql})`
      const result = await client.query(sql, params)
      // Real PostgREST returns a scalar-returning function's value directly
      // (not wrapped in [{fnName: value}]) — e.g. RETURNS JSON/JSONB/TEXT/etc,
      // as opposed to RETURNS SETOF/TABLE. `SELECT * FROM fn(...)` names that
      // single column after the function itself, which is how this is told
      // apart from a genuine one-column TABLE-returning function (whose
      // column is named after its own declared OUT parameter, not the
      // function). Found via get_active_employees_for_payroll (RETURNS JSON):
      // without this, callers see [{get_active_employees_for_payroll: [...]}]
      // instead of the real array, and any code reading row fields off it
      // (e.g. emp.id) silently gets undefined.
      if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1 && Object.keys(result.rows[0])[0] === fnName) {
        return sendJson(res, 200, result.rows[0][fnName])
      }
      // A plain `RETURNS <composite>` function (not SETOF/TABLE) is singular
      // in real PostgREST — one JSON object, never array-wrapped, same as a
      // scalar JSON-returning function above. Only a genuine SETOF/TABLE
      // function returns the JSON-array shape.
      const returnsSet = await getFnReturnsSet(client, fnName)
      if (!returnsSet) {
        return sendJson(res, 200, result.rows[0] ?? null)
      }
      return sendJson(res, 200, result.rows)
    }

    const tableMatch = pathname.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)$/)
    if (!tableMatch) return sendJson(res, 404, { error: 'not_found', path: pathname })
    const table = tableMatch[1]

    if (req.method === 'GET' || req.method === 'HEAD') {
      const selectStr = searchParams.get('select') ?? '*'
      const items = parseSelect(selectStr)
      const params = []
      const whereParts = []
      let orderSql = ''
      let limit = MAX_ROWS
      let offset = 0

      for (const [key, value] of searchParams.entries()) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue
        if (key === 'or') { whereParts.push(`(${buildLogicGroupSql(value.replace(/^\(/, '').replace(/\)$/, ''), ' OR ', params)})`); continue }
        if (key === 'and') { whereParts.push(`(${buildLogicGroupSql(value.replace(/^\(/, '').replace(/\)$/, ''), ' AND ', params)})`); continue }
        if (key.includes('.')) continue // referenced-table filters — not supported, ignored
        whereParts.push(buildFilterSql(key, value, params))
      }
      if (searchParams.has('order')) {
        orderSql = 'ORDER BY ' + searchParams.get('order').split(',').map((spec) => {
          const [col, ...mods] = spec.split('.')
          const dir = mods.includes('desc') ? 'DESC' : 'ASC'
          const nulls = mods.includes('nullsfirst') ? 'NULLS FIRST' : mods.includes('nullslast') ? 'NULLS LAST' : ''
          return `${qIdent(col)} ${dir} ${nulls}`.trim()
        }).join(', ')
      }
      if (searchParams.has('limit')) limit = Math.min(parseInt(searchParams.get('limit'), 10) || MAX_ROWS, MAX_ROWS)
      if (searchParams.has('offset')) offset = parseInt(searchParams.get('offset'), 10) || 0

      const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''
      const cols = columnsSqlForItems(table, items, table)
      const dataSql = `SELECT ${cols} FROM ${qIdent(table)} AS ${qIdent(table)} ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`
      const result = await client.query(dataSql, params)
      await fetchEmbeds(table, result.rows, items, client)

      const prefer = req.headers['prefer'] ?? ''
      let totalCount = null
      if (prefer.includes('count=')) {
        const countResult = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${qIdent(table)} ${whereSql}`, params)
        totalCount = countResult.rows[0].n
      }

      const accept = req.headers['accept'] ?? ''
      const headers = {}
      if (totalCount != null) headers['content-range'] = `${offset}-${offset + result.rows.length - 1}/${totalCount}`
      if (accept.includes('vnd.pgrst.object+json')) {
        if (result.rows.length !== 1) {
          return sendJson(res, 406, { code: 'PGRST116', message: `${result.rows.length === 0 ? 'no' : 'multiple'} rows returned`, details: null, hint: null }, headers)
        }
        return sendJson(res, 200, result.rows[0], headers)
      }
      return sendJson(res, req.method === 'HEAD' ? 200 : 200, req.method === 'HEAD' ? '' : result.rows, headers)
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const rowsIn = Array.isArray(body) ? body : [body]
      if (!rowsIn.length) return sendJson(res, 400, { error: 'empty body' })
      const columns = [...new Set(rowsIn.flatMap((r) => Object.keys(r)))]
      const params = []
      const valueRows = rowsIn.map((r) => {
        const placeholders = columns.map((c) => {
          const v = r[c] === undefined ? null : r[c]
          params.push(jsonbNullParam(table, c, v))
          return `$${params.length}`
        })
        return `(${placeholders.join(',')})`
      })

      const prefer = req.headers['prefer'] ?? ''
      let conflictSql = ''
      const onConflict = searchParams.get('on_conflict')
      if (prefer.includes('resolution=')) {
        const conflictCols = onConflict ? onConflict.split(',').map(qIdent).join(',') : `${qIdent(pkColumnGuess(table))}`
        if (prefer.includes('ignore-duplicates')) conflictSql = `ON CONFLICT (${conflictCols}) DO NOTHING`
        else {
          const updateSet = columns.filter((c) => !(onConflict ?? '').split(',').includes(c))
            .map((c) => `${qIdent(c)} = EXCLUDED.${qIdent(c)}`).join(', ')
          conflictSql = updateSet ? `ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}` : `ON CONFLICT (${conflictCols}) DO NOTHING`
        }
      }

      const sql = `INSERT INTO ${qIdent(table)} (${columns.map(qIdent).join(',')}) VALUES ${valueRows.join(',')} ${conflictSql} RETURNING *`
      const result = await client.query(sql, params)
      const status = prefer.includes('return=representation') ? 201 : 201
      if (!prefer.includes('return=representation')) return sendJson(res, status, '')
      // A singular response is driven by the client's Accept header
      // (vnd.pgrst.object+json, sent by .single()/.maybeSingle()), same as
      // real PostgREST — NOT by whether the request body happened to be an
      // array. supabase-js's .upsert() always sends an array body even for a
      // single row, so keying off Array.isArray(body) here always returned
      // the bare array and broke `.upsert([row]).select('id').single()`:
      // callers destructuring `.id off the result got undefined, which then
      // propagated as a null FK into whatever referenced that id (found via
      // POST /payroll/runs/:id/ledger inserting payroll_ledger_entries rows
      // with a null ledger_id — the ledger header's own `id` was silently
      // undefined after the upsert).
      const accept = req.headers['accept'] ?? ''
      if (accept.includes('vnd.pgrst.object+json')) {
        if (result.rows.length !== 1) return sendJson(res, 406, { code: 'PGRST116', message: `${result.rows.length === 0 ? 'no' : 'multiple'} rows returned`, details: null, hint: null })
        return sendJson(res, status, result.rows[0])
      }
      // Found via DEFECT-12 (PR #30 Attendance/Leave UAT, 2026-10-12): this
      // branch used to unwrap to a bare object whenever the REQUEST body
      // was a single (non-array) object, regardless of the Accept header —
      // directly contradicting the comment above it and real PostgREST,
      // which returns an array from a plain `.select()` no matter whether
      // the caller passed `.upsert({...})` or `.upsert([{...}])` (confirmed
      // against @supabase/postgrest-js's PostgrestQueryBuilder.upsert()
      // source: `body: values` is sent through unwrapped — a single-object
      // call really does send a bare JSON object on the wire — so only the
      // Accept header may legitimately select a singular response).
      // apps/api/src/routes/attendance/comp-off.ts's
      // `.upsert(singleRow, {...}).select('id')` call hit exactly this:
      // the gateway returned a bare `{id: ...}` instead of `[{id: ...}]`,
      // so the route's `(inserted?.length ?? 0) > 0` guard (correct against
      // real PostgREST) always read `undefined > 0` and silently skipped
      // mirroring the credit into the balance cache — the application code
      // was correct; this gateway's response shape was not.
      return sendJson(res, status, result.rows)
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req)
      const columns = Object.keys(body)
      if (!columns.length) return sendJson(res, 400, { error: 'empty body' })
      const params = []
      const setSql = columns.map((c) => {
        const v = body[c]
        params.push(jsonbNullParam(table, c, v))
        return `${qIdent(c)} = $${params.length}`
      }).join(', ')
      const whereParts = []
      for (const [key, value] of searchParams.entries()) {
        if (key === 'select') continue
        if (key === 'or') { whereParts.push(`(${buildLogicGroupSql(value.replace(/^\(/, '').replace(/\)$/, ''), ' OR ', params)})`); continue }
        whereParts.push(buildFilterSql(key, value, params))
      }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''
      const prefer = req.headers['prefer'] ?? ''
      const sql = `UPDATE ${qIdent(table)} SET ${setSql} ${whereSql} RETURNING *`
      const result = await client.query(sql, params)
      if (!prefer.includes('return=representation')) return sendJson(res, 204, '')
      const accept = req.headers['accept'] ?? ''
      if (accept.includes('vnd.pgrst.object+json')) {
        if (result.rows.length !== 1) return sendJson(res, 406, { code: 'PGRST116', message: 'not exactly one row' })
        return sendJson(res, 200, result.rows[0])
      }
      return sendJson(res, 200, result.rows)
    }

    if (req.method === 'DELETE') {
      const params = []
      const whereParts = []
      for (const [key, value] of searchParams.entries()) {
        if (key === 'select') continue
        if (key === 'or') { whereParts.push(`(${buildLogicGroupSql(value.replace(/^\(/, '').replace(/\)$/, ''), ' OR ', params)})`); continue }
        whereParts.push(buildFilterSql(key, value, params))
      }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''
      const prefer = req.headers['prefer'] ?? ''
      const sql = `DELETE FROM ${qIdent(table)} ${whereSql} RETURNING *`
      const result = await client.query(sql, params)
      if (!prefer.includes('return=representation')) return sendJson(res, 204, '')
      return sendJson(res, 200, result.rows)
    }

    return sendJson(res, 405, { error: 'method_not_allowed' })
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { message: err.message })
    console.error('[rest-engine] error:', err.message, '| method:', req.method, '| path:', pathname, '| query:', [...searchParams.entries()])
    return sendJson(res, 500, { code: err.code ?? 'XX000', message: err.message, details: err.detail ?? null, hint: err.hint ?? null })
  } finally {
    client.release()
  }
}

const PK_GUESS_CACHE = new Map()
function pkColumnGuess(table) {
  return PK_GUESS_CACHE.get(table) ?? 'id'
}
async function loadPkGuesses() {
  const { rows } = await pool.query(`
    SELECT rel.relname AS table_name, att.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ck.attnum
    WHERE c.contype = 'p' AND rel.relnamespace = 'public'::regnamespace AND ck.ord = 1
  `)
  for (const r of rows) if (!PK_GUESS_CACHE.has(r.table_name)) PK_GUESS_CACHE.set(r.table_name, r.column_name)
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = body === '' ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extraHeaders })
  res.end(payload)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
      'Access-Control-Allow-Headers': '*',
    })
    return res.end()
  }

  try {
    // ── /auth/v1/token — password grant + refresh ────────────────────────────
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const grantType = url.searchParams.get('grant_type')
      const body = await readJsonBody(req)

      if (grantType === 'refresh_token') {
        const rt = body.refresh_token ?? ''
        const userId = rt.startsWith('refresh-') ? rt.slice('refresh-'.length) : null
        if (!userId) return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid refresh token' })
        const { rows } = await pool.query('SELECT id, email FROM auth.users WHERE id = $1', [userId])
        if (!rows[0]) return sendJson(res, 400, { error: 'invalid_grant', error_description: 'User not found' })
        return sendJson(res, 200, mintSession(rows[0]))
      }

      const { email, password } = body
      if (!email || !password) return sendJson(res, 400, { error: 'invalid_request', error_description: 'email and password required' })
      if (CREDENTIALS[email] !== password) {
        return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      }
      const user = await findOrCreateUser(email)
      return sendJson(res, 200, mintSession(user))
    }

    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const { email, password } = body
      if (!email || !password) return sendJson(res, 400, { error: 'invalid_request', error_description: 'email and password required' })
      CREDENTIALS[email] = password
      const user = await findOrCreateUser(email)
      return sendJson(res, 200, mintSession(user))
    }

    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
      return res.end()
    }

    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const auth = req.headers['authorization'] ?? ''
      const token = auth.replace(/^Bearer\s+/i, '')
      const claims = verifyJwt(token)
      if (!claims) return sendJson(res, 401, { error: 'unauthorized' })
      return sendJson(res, 200, { id: claims.sub, email: claims.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} })
    }

    if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const email = body.email
      if (!email) return sendJson(res, 400, { error: 'invalid_request', error_description: 'email required' })
      if (body.password) CREDENTIALS[email] = body.password
      const user = await findOrCreateUser(email)
      // Persist caller-supplied user_metadata (e.g. full_name) — setup.ts's
      // ownership-guard metadata-match path and seed-pilot-tenant.mjs's
      // signup both rely on this actually being stored, not discarded.
      if (body.user_metadata) {
        await pool.query('UPDATE auth.users SET raw_user_meta_data = $2::jsonb WHERE id = $1', [user.id, JSON.stringify(body.user_metadata)])
      }
      return sendJson(res, 200, { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', user_metadata: body.user_metadata ?? {} })
    }
    const adminUserMatch = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/i)
    if (adminUserMatch && req.method === 'GET') {
      const { rows } = await pool.query('SELECT id, email, created_at, raw_user_meta_data FROM auth.users WHERE id = $1', [adminUserMatch[1]])
      if (!rows[0]) return sendJson(res, 404, { error: 'user_not_found' })
      return sendJson(res, 200, { id: rows[0].id, email: rows[0].email, aud: 'authenticated', role: 'authenticated', created_at: rows[0].created_at, user_metadata: rows[0].raw_user_meta_data ?? {} })
    }

    // ── /rest/v1/* — custom REST engine ───────────────────────────────────────
    if (url.pathname.startsWith('/rest/v1/')) {
      const restPath = url.pathname.replace('/rest/v1', '')
      const authHeader = req.headers['authorization'] ?? ''
      const token = authHeader.replace(/^Bearer\s+/i, '')
      const claims = token ? verifyJwt(token) : null
      const role = claims?.role ?? 'anon'
      return handleRest(req, res, restPath, url.searchParams, role, claims)
    }

    // ── /storage/v1/object/* — minimal filesystem-backed Storage shim ─────────
    // Just enough of the Supabase Storage API (upload/download/remove) for the
    // app's direct-to-storage upload flows (e.g. attendance CSV import) to work
    // against this hand-rolled gateway. Files live under /tmp/gateway-storage.
    const storageMatch = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/)
    if (storageMatch) {
      const [, bucket, objectPath] = storageMatch
      const safePath = path.posix.normalize(objectPath).replace(/^(\.\.(\/|$))+/, '')
      const diskPath = path.join('/tmp/gateway-storage', bucket, safePath)

      if (req.method === 'POST' || req.method === 'PUT') {
        await fs.mkdir(path.dirname(diskPath), { recursive: true })
        const raw = await readRawBody(req)
        const contentType = req.headers['content-type'] ?? ''
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
        let fileBuf = raw
        if (boundaryMatch) {
          // supabase-js's storage.upload() POSTs multipart/form-data with the
          // blob under a "file" part (plus cacheControl/metadata parts) —
          // extract just that part's bytes rather than writing the whole
          // multipart envelope as the object.
          const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`)
          const parts = []
          let start = raw.indexOf(boundary)
          while (start !== -1) {
            const next = raw.indexOf(boundary, start + boundary.length)
            if (next === -1) break
            parts.push(raw.subarray(start + boundary.length, next))
            start = next
          }
          for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n')
            if (headerEnd === -1) continue
            const headerText = part.subarray(0, headerEnd).toString('utf8')
            // The file part's field name varies ("file", or "" for a bare Blob
            // upload) — key off `filename=` instead, which only the file part has.
            if (/filename=/i.test(headerText)) {
              let content = part.subarray(headerEnd + 4)
              if (content.subarray(-2).toString() === '\r\n') content = content.subarray(0, -2)
              fileBuf = content
              break
            }
          }
        }
        await fs.writeFile(diskPath, fileBuf)
        return sendJson(res, 200, { Key: `${bucket}/${safePath}` })
      }
      if (req.method === 'GET') {
        try {
          const buf = await fs.readFile(diskPath)
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' })
          return res.end(buf)
        } catch {
          return sendJson(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
        }
      }
      if (req.method === 'DELETE') {
        try { await fs.unlink(diskPath) } catch { /* best effort */ }
        return sendJson(res, 200, [{ name: safePath }])
      }
    }
    const storageRemoveMatch = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/)
    if (storageRemoveMatch && req.method === 'DELETE') {
      const [, bucket] = storageRemoveMatch
      const body = await readJsonBody(req)
      for (const p of body.prefixes ?? []) {
        try { await fs.unlink(path.join('/tmp/gateway-storage', bucket, p)) } catch { /* best effort */ }
      }
      return sendJson(res, 200, (body.prefixes ?? []).map((p) => ({ name: p })))
    }

    return sendJson(res, 404, { error: 'not_found', path: url.pathname })
  } catch (err) {
    console.error('[gateway] unhandled error:', err)
    return sendJson(res, 500, { error: 'internal_error', message: err.message })
  }
})

async function main() {
  await loadFkGraph()
  await loadPkGuesses()
  server.listen(PORT, () => {
    console.log(`[gateway] listening on :${PORT}`)
  })
}

main()
