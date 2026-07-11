// ── Certification: Configurable in-memory Supabase mock ──────────────────────
//
// Simulates the Supabase fluent query builder (from / select / insert / upsert /
// update / eq / in / order / single / maybeSingle) with in-memory state tables.
//
// Designed for the import-engine certification suite:
//   • Maintains table state across multiple executeInChunks calls (crash-recovery)
//   • Records every operation for assertion (calls[])
//   • Per-table per-operation failure injection (failOn)
//   • ignoreDuplicates upsert semantics matching Supabase's behavior

export type Row = Record<string, unknown>
export type Op  = 'select' | 'insert' | 'upsert' | 'update'

export interface CallRecord {
  table: string
  op:    Op
  data?: unknown
}

/** table → operation → error message to inject */
export type FailMap = Partial<Record<string, Partial<Record<Op, string>>>>

export class MockSupabase {
  private tables = new Map<string, Row[]>()
  readonly calls: CallRecord[] = []
  failOn: FailMap = {}

  getTable(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, [])
    return this.tables.get(name)!
  }

  /** Seed a table with rows (deep-copied so mutations don't bleed into the source). */
  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows.map(r => ({ ...r })))
  }

  clearCalls() { this.calls.length = 0 }

  from(table: string): Builder {
    return new Builder(this, table)
  }
}

class Builder {
  private op?:      Op
  private opData?:  unknown
  private opOpts?:  Record<string, unknown>
  private filters:   [string, unknown][]   = []
  private inFilters: [string, unknown[]][] = []
  private orderCol?: string
  private orderAsc   = true
  private isSingle   = false
  private isMaybe    = false
  private withCount  = false

  constructor(private db: MockSupabase, private table: string) {}

  select(_cols?: string, opts?: { count?: string }) {
    this.op = 'select'
    if (opts?.count) this.withCount = true
    return this
  }
  insert(data: unknown)  { this.op = 'insert'; this.opData = data; return this }
  upsert(data: unknown, opts?: Record<string, unknown>) {
    this.op = 'upsert'; this.opData = data; this.opOpts = opts; return this
  }
  update(data: unknown)  { this.op = 'update'; this.opData = data; return this }

  eq(col: string, val: unknown)    { this.filters.push([col, val]);  return this }
  in(col: string, vals: unknown[]) { this.inFilters.push([col, vals]); return this }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this
  }

  single()      { this.isSingle = true; this.isMaybe = false; return this._exec() }
  maybeSingle() { this.isSingle = true; this.isMaybe = true;  return this._exec() }

  // Makes the builder thenable — used for fire-and-forget .then(() => {}) calls
  then<T>(
    res: (v: Awaited<ReturnType<typeof this._exec>>) => T,
    rej?: (r: unknown) => T,
  ) {
    return this._exec().then(res, rej)
  }

  private _match(store: Row[]) {
    return store.filter(row => {
      for (const [c, v] of this.filters)    if (row[c] !== v)             return false
      for (const [c, vs] of this.inFilters) if (!vs.includes(row[c] as never)) return false
      return true
    })
  }

  private async _exec() {
    const { db, table } = this
    const op = this.op ?? 'select'

    const failMsg = db.failOn[table]?.[op]
    if (failMsg) {
      db.calls.push({ table, op, data: this.opData })
      return { data: null as unknown, error: { message: failMsg }, count: undefined as number | undefined }
    }

    const store = db.getTable(table)
    let result: { data: unknown; error: unknown; count?: number }

    switch (op) {
      case 'select': {
        let rows = this._match(store)
        if (this.orderCol) {
          const col = this.orderCol, asc = this.orderAsc
          rows = [...rows].sort((a, b) => {
            const d = (a[col] as number) - (b[col] as number)
            return asc ? d : -d
          })
        }
        if (this.isSingle) {
          result = rows.length === 0 && !this.isMaybe
            ? { data: null, error: { message: 'No rows found' } }
            : { data: rows[0] ?? null, error: null }
        } else {
          result = { data: rows, error: null, ...(this.withCount ? { count: rows.length } : {}) }
        }
        break
      }

      case 'insert': {
        const rows = (Array.isArray(this.opData) ? this.opData : [this.opData]) as Row[]
        for (const r of rows) { if (!r.id) r.id = crypto.randomUUID(); store.push(r) }
        result = { data: rows, error: null }
        break
      }

      case 'upsert': {
        const rows      = (Array.isArray(this.opData) ? this.opData : [this.opData]) as Row[]
        const conflicts = ((this.opOpts?.onConflict as string) ?? '')
          .split(',').map(s => s.trim()).filter(Boolean)
        const ignDup    = this.opOpts?.ignoreDuplicates === true

        for (const row of rows) {
          const idx = conflicts.length
            ? store.findIndex(s => conflicts.every(c => s[c] === row[c]))
            : -1
          if (idx >= 0) {
            if (!ignDup) Object.assign(store[idx], row)
          } else {
            if (!row.id) row.id = crypto.randomUUID()
            store.push(row)
          }
        }
        result = { data: rows, error: null }
        break
      }

      case 'update': {
        this._match(store).forEach(r => Object.assign(r, this.opData))
        result = { data: null, error: null }
        break
      }

      default:
        result = { data: null, error: null }
    }

    db.calls.push({ table, op, data: this.opData })
    return result
  }
}
