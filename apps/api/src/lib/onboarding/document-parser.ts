import { PDFParse } from 'pdf-parse'

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

  // PDF — use pdf-parse to extract full text
  if (mime === 'application/pdf') {
    try {
      const parser = new PDFParse({ data: fileBuffer })
      const result = await parser.getText()
      return {
        text: result.text,
        pageCount: result.total,
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

  // Images — return empty text; extraction engine handles these via Claude vision
  if (
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/png' ||
    mime === 'image/webp'
  ) {
    return {
      text: '',
      pageCount: 1,
      method: 'empty',
    }
  }

  // DOCX and other unsupported types — Claude vision fallback
  return {
    text: '',
    pageCount: 0,
    method: 'empty',
  }
}
