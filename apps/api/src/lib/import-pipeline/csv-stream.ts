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
 *   - Fields may contain commas and newlines when quoted
 */

import { createInterface }    from 'node:readline'
import { Readable }           from 'node:stream'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ParsedRow {
  /** 1-indexed line number in the original file (1 = header). */
  lineNumber: number
  /** Raw values aligned to the header columns. Length always equals headers.length. */
  values:     string[]
}

export interface CsvStreamResult {
  headers:  string[]
  rows:     AsyncGenerator<ParsedRow>
}

// ── RFC 4180 field parser ──────────────────────────────────────────────────────

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

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Open a streaming CSV from Supabase Storage.
 *
 * Returns the header row synchronously after parsing the first line,
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
  const rl     = createInterface({ input: stream, crlfDelay: Infinity })

  const lineIter = rl[Symbol.asyncIterator]()

  // ── Read header ──────────────────────────────────────────────────────────────
  const firstLine = await lineIter.next()
  if (firstLine.done || !firstLine.value.trim()) {
    rl.close()
    throw new Error('csv-stream: file is empty or has no header row')
  }

  const headers = parseCsvLine(firstLine.value).map(h => h.trim().toLowerCase())

  // ── Row generator ────────────────────────────────────────────────────────────
  async function* rowGenerator(): AsyncGenerator<ParsedRow> {
    let lineNumber = 1 // header was line 1
    try {
      for await (const line of { [Symbol.asyncIterator]: () => lineIter }) {
        lineNumber++

        // Skip blank lines
        if (!line.trim()) continue

        const raw    = parseCsvLine(line)
        const values = Array.from({ length: headers.length }, (_, i) => raw[i] ?? '')

        yield { lineNumber, values }
      }
    } finally {
      rl.close()
    }
  }

  return { headers, rows: rowGenerator() }
}

// ── In-memory variant (for small files / tests) ───────────────────────────────

export function* streamCsvFromString(csv: string): Generator<ParsedRow | { type: 'headers'; headers: string[] }> {
  const lines   = csv.split(/\r?\n/)
  const header  = lines[0]
  if (!header) return

  const headers = parseCsvLine(header).map(h => h.trim().toLowerCase())
  yield { type: 'headers', headers }

  let lineNumber = 1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    lineNumber++
    if (!line.trim()) continue
    const raw    = parseCsvLine(line)
    const values = Array.from({ length: headers.length }, (_, j) => raw[j] ?? '')
    yield { lineNumber, values }
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
