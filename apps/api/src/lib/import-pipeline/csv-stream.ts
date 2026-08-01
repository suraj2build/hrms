/**
 * csv-stream.ts — Streaming CSV parser for high-volume imports.
 *
 * Designed for 1M-row CSV files. Never holds the full file in memory.
 * Streams the file from Supabase Storage via a signed URL and yields
 * parsed rows one at a time through an async generator.
 *
 * RFC 4180 compliance:
 *   - Quoted fields (double-quotes)
 *   - Escaped quotes ("")
 *   - CRLF and LF line endings
 *   - Fields may contain commas AND embedded newlines when quoted — the
 *     record parser below (parseCsvRecords) is a true character-level state
 *     machine that tracks open-quote state across chunk boundaries, not a
 *     split-into-physical-lines-then-parse approach. A line-splitting
 *     approach (e.g. `readline`) breaks a quoted field's embedded newline
 *     into a truncated real row plus a phantom garbage row; this doesn't,
 *     because it never treats `\n`/`\r\n` as a record boundary while inside
 *     an open quote.
 */

import { StringDecoder }      from 'node:string_decoder'
import { Readable }           from 'node:stream'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ParsedRow {
  /** 1-indexed physical line number the record starts on in the original file (1 = header). */
  lineNumber: number
  /** Raw values aligned to the header columns. Length always equals headers.length. */
  values:     string[]
}

export interface CsvStreamResult {
  headers:  string[]
  rows:     AsyncGenerator<ParsedRow>
}

// ── Single-line field parser (kept for callers that already have one physical
//    line in hand and know it has no embedded newlines, e.g. header parsing) ──

export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let   i     = 0

  while (i <= line.length) {
    if (i === line.length) {
      fields.push('')
      break
    }

    if (line[i] === '"') {
      // Quoted field
      let value = ''
      i++ // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"'
            i += 2
          } else {
            i++ // skip closing quote
            break
          }
        } else {
          value += line[i]
          i++
        }
      }
      fields.push(value)
      if (line[i] === ',') i++
    } else {
      // Unquoted field
      const end = line.indexOf(',', i)
      if (end === -1) {
        fields.push(line.slice(i).trimEnd())
        break
      } else {
        fields.push(line.slice(i, end))
        i = end + 1
      }
    }
  }

  return fields
}

// ── RFC 4180 record-level state machine ─────────────────────────────────────────
//
// Consumes an async iterable of string chunks of ANY size/boundary (a whole
// file, one read()'s worth, a single character) and yields complete records
// (arrays of raw field strings) plus the 1-indexed physical line each record
// STARTS on. Open-quote state, and a 1-character lookahead for ambiguous
// boundary cases (a `"` or `\r` as the very last character of a chunk),
// persist across chunk reads via the loop's outer-scope variables — so a
// chunk boundary landing inside a quoted field's embedded newline never
// splits or drops a record.

export interface CsvRecord {
  startLine: number
  fields:    string[]
}

export async function* parseCsvRecords(
  chunks: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<CsvRecord> {
  let field           = ''
  let fields: string[] = []
  let inQuotes        = false
  let atFieldStart     = true
  let line            = 1
  let recordStartLine = 1
  let carry           = '' // deferred ambiguous '"' or '\r' from the end of the previous chunk
  let sawContent      = false

  const endField = () => { fields.push(field); field = ''; atFieldStart = true }
  const endRecord = (): CsvRecord => {
    endField()
    const rec = { startLine: recordStartLine, fields }
    fields = []
    return rec
  }

  for await (const rawChunk of chunks) {
    if (!rawChunk) continue
    const chunk = carry + rawChunk
    carry = ''
    sawContent = true

    let i = 0
    const len = chunk.length
    while (i < len) {
      const c = chunk[i]

      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < len) {
            if (chunk[i + 1] === '"') { field += '"'; i += 2; continue }
            inQuotes = false; atFieldStart = false; i++; continue
          }
          // Quote is the last char available — ambiguous (closing quote vs.
          // first half of an escaped "" split across chunks). Defer.
          carry = '"'; i++
          break
        }
        if (c === '\n') line++
        field += c; i++
        continue
      }

      if (c === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; i++; continue }
      if (c === ',') { endField(); i++; continue }
      if (c === '\r') {
        if (i + 1 < len) {
          i += chunk[i + 1] === '\n' ? 2 : 1
          line++
          const rec = endRecord()
          recordStartLine = line
          yield rec
          continue
        }
        carry = '\r'; i++
        break
      }
      if (c === '\n') {
        i++; line++
        const rec = endRecord()
        recordStartLine = line
        yield rec
        continue
      }

      field += c; atFieldStart = false; i++
    }
  }

  // Resolve any carried ambiguous character now that the stream has ended.
  if (carry === '"') {
    inQuotes = false // nothing follows to disambiguate — treat as closing
  } else if (carry === '\r') {
    line++
    yield endRecord()
    recordStartLine = line
  }

  // Trailing record with no terminating newline (very common — most CSV
  // exporters omit the final newline).
  if (sawContent && (fields.length > 0 || field !== '' || !atFieldStart)) {
    yield endRecord()
  }
}

// ── Byte → text chunk decoding ───────────────────────────────────────────────
//
// Uses Node's StringDecoder so a multi-byte UTF-8 character split across two
// Buffer chunks is reassembled correctly instead of being corrupted at the
// boundary.

async function* decodeToText(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  for await (const chunk of stream) {
    yield decoder.write(chunk as Buffer)
  }
  const tail = decoder.end()
  if (tail) yield tail
}

// ── Storage streaming ──────────────────────────────────────────────────────────

/**
 * Stream a CSV from Supabase Storage via a short-lived signed URL.
 * Truly streaming — does not buffer the full file into memory.
 */
async function openStorageStream(
  supabase: SupabaseClient,
  bucket:   string,
  path:     string,
): Promise<NodeJS.ReadableStream> {
  const { data: urlData, error: urlErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 600) // 10-minute TTL

  if (urlErr || !urlData?.signedUrl) {
    throw new Error(`csv-stream: failed to get signed URL — ${urlErr?.message ?? 'no URL returned'}`)
  }

  const res = await fetch(urlData.signedUrl)
  if (!res.ok) {
    throw new Error(`csv-stream: storage fetch failed — HTTP ${res.status}`)
  }
  if (!res.body) {
    throw new Error('csv-stream: response body is null')
  }

  return Readable.fromWeb(res.body as import('stream/web').ReadableStream)
}

function isBlankRecord(rec: { fields: string[] }): boolean {
  return rec.fields.length === 1 && rec.fields[0].trim() === ''
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Open a streaming CSV from Supabase Storage.
 *
 * Returns the header row synchronously after parsing the first record,
 * then an async generator that yields one ParsedRow per data row.
 * Rows shorter than the header are padded with empty strings.
 * Rows longer than the header have extra fields silently dropped.
 *
 * Usage:
 *   const { headers, rows } = await streamCsvFromStorage(supabase, bucket, path)
 *   for await (const row of rows) {
 *     // process row.values[0], row.values[1], ...
 *   }
 */
export async function streamCsvFromStorage(
  supabase: SupabaseClient,
  bucket:   string,
  path:     string,
): Promise<CsvStreamResult> {
  const stream = await openStorageStream(supabase, bucket, path)
  const recordIter = parseCsvRecords(decodeToText(stream))

  const first = await recordIter.next()
  if (first.done || isBlankRecord(first.value)) {
    throw new Error('csv-stream: file is empty or has no header row')
  }

  const headers = first.value.fields.map(h => h.trim().toLowerCase())

  async function* rowGenerator(): AsyncGenerator<ParsedRow> {
    // Early consumer termination (e.g. a `break` in the caller's for-await
    // loop) propagates through this delegation chain automatically: calling
    // .return() on this generator calls it on recordIter, which calls it on
    // decodeToText's generator, which calls it on the underlying Node stream
    // — releasing the HTTP response without any manual try/finally.
    for await (const rec of recordIter) {
      if (isBlankRecord(rec)) continue // skip fully blank lines
      const values = Array.from({ length: headers.length }, (_, i) => rec.fields[i] ?? '')
      yield { lineNumber: rec.startLine, values }
    }
  }

  return { headers, rows: rowGenerator() }
}

// ── In-memory variant (for small files / tests) ───────────────────────────────

export async function* streamCsvFromString(
  csv: string,
): AsyncGenerator<ParsedRow | { type: 'headers'; headers: string[] }> {
  if (!csv) return

  const recordIter = parseCsvRecords([csv])

  const first = await recordIter.next()
  if (first.done || isBlankRecord(first.value)) return

  const headers = first.value.fields.map(h => h.trim().toLowerCase())
  yield { type: 'headers', headers }

  for await (const rec of recordIter) {
    if (isBlankRecord(rec)) continue
    const values = Array.from({ length: headers.length }, (_, i) => rec.fields[i] ?? '')
    yield { lineNumber: rec.startLine, values }
  }
}

// ── Chunk boundary calculator ─────────────────────────────────────────────────

export interface ChunkBoundary {
  chunk_no:  number
  start_row: number
  end_row:   number
}

/**
 * Given a total number of data rows and a chunk size, return the chunk
 * boundaries (1-indexed row numbers, excluding the header row).
 */
export function computeChunkBoundaries(totalRows: number, chunkSize: number): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = []
  let   chunkNo    = 1
  let   start      = 1

  while (start <= totalRows) {
    const end = Math.min(start + chunkSize - 1, totalRows)
    boundaries.push({ chunk_no: chunkNo, start_row: start, end_row: end })
    chunkNo++
    start = end + 1
  }

  return boundaries
}
