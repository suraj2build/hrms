import { createRequire } from 'module'

// pdf-parse is CommonJS — must use createRequire in an ESM project
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse') as (
  buffer: Buffer,
) => Promise<{ text: string; numpages: number }>

export interface ParseResult {
  text: string
  pageCount: number
  method: 'pdf-parse' | 'text-direct' | 'empty'
  error?: string
}

export async function parseDocumentToText(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  const mime = mimeType.toLowerCase().trim()

  // PDF — use pdf-parse to extract embedded text.
  // Scanned/image-based PDFs may return empty text here; the extraction engine
  // will send the PDF as a native document block to Claude in that case.
  if (mime === 'application/pdf') {
    try {
      const result = await pdfParse(fileBuffer)
      return {
        text: result.text ?? '',
        pageCount: result.numpages ?? 0,
        method: 'pdf-parse',
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        text: '',
        pageCount: 0,
        method: 'pdf-parse',
        error: `pdf-parse failed: ${message}`,
      }
    }
  }

  // Plain text — decode buffer directly
  if (mime === 'text/plain') {
    const text = fileBuffer.toString('utf-8')
    return {
      text,
      pageCount: 1,
      method: 'text-direct',
    }
  }

  // Images and everything else — return empty text;
  // extraction engine handles these via Claude vision / document blocks
  return {
    text: '',
    pageCount: 1,
    method: 'empty',
  }
}
