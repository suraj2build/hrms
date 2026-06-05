/**
 * zod-form.ts — shared zod helpers for HTML-form payloads.
 *
 * Browser <select>/<input> elements submit '' for "unselected" and forms often
 * send null for cleared fields. Plain z.string().uuid().optional() /
 * z.enum().optional() REJECT '' and null (they only accept undefined), which
 * 400s the whole save. These helpers coerce '' and null → undefined first so
 * optional fields validate as intended.
 */
import { z } from 'zod'

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v)

/** Optional UUID that tolerates '' / null (→ undefined). */
export const optUuid = z.preprocess(emptyToUndef, z.string().uuid().optional())

/** Optional free-text string that tolerates null (→ undefined). */
export const optStr = z.preprocess(emptyToUndef, z.string().optional())

/** Optional date/any string that tolerates '' / null (→ undefined). */
export const optDate = z.preprocess(emptyToUndef, z.string().optional())

/** Optional enum that tolerates '' / null (→ undefined). */
export function optEnum<T extends [string, ...string[]]>(values: T) {
  return z.preprocess(emptyToUndef, z.enum(values).optional())
}
