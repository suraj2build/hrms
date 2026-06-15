/**
 * Supabase Storage helpers for the employee-files private bucket.
 *
 * Upload pattern:
 *   1. Client calls uploadEmployeeFile() → binary goes directly to storage
 *   2. Returns storage path (e.g. "<tenantId>/<empId>/photos/1234567890.jpg")
 *   3. Store the path in the DB (NOT the full URL)
 *   4. Call getSignedUrl(path) when you need to display or download the file
 *
 * This keeps URLs short-lived and prevents public exposure of private files.
 */
// Re-use the single shared Supabase client so we don't spin up a second
// GoTrueClient that fights over the auth-refresh Web Lock — the cause of
// "Lock sb-…-auth-token was released because another request stole it".
// Storage calls run with the same authenticated session as the rest of the app.
import { supabase as storageClient } from './supabase/client'

const BUCKET = 'employee-files'

export type StorageFolder =
  | 'photos'
  | 'documents'
  | 'contracts'
  | 'identity'
  | 'passport-visa'

/**
 * Upload a file to the employee-files bucket.
 * Returns the storage path — store this in the database.
 */
export async function uploadEmployeeFile(
  tenantId:   string,
  employeeId: string,
  folder:     StorageFolder,
  file:       File,
): Promise<string> {
  const ext  = file.name.split('.').pop() ?? 'bin'
  const path = `${tenantId}/${employeeId}/${folder}/${Date.now()}.${ext}`

  const { error } = await storageClient.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return path
}

/**
 * Upload a company logo to the employee-files bucket.
 * Path: {tenantId}/company/logo.{ext}
 * Uses upsert so re-uploading replaces the previous logo.
 * Returns the storage path — call getSignedUrl(path) to display it.
 */
export async function uploadCompanyLogo(
  tenantId: string,
  file:     File,
): Promise<string> {
  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const path = `${tenantId}/company/logo.${ext}`

  const { error } = await storageClient.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true })

  if (error) throw new Error(`Logo upload failed: ${error.message}`)
  return path
}

/**
 * Upload a file to a pre-issued signed upload URL (public / unauthenticated flows).
 *
 * Used by the public pre-onboarding portal: the API issues a signed upload token
 * (server-side, service role) and the browser uploads the binary directly to
 * storage via the official supabase-js helper. This avoids the fragile raw-PUT
 * approach (Content-Type / CORS / relative-URL pitfalls) and works without any
 * authenticated session.
 *
 * @param path   storage path returned by the API (createSignedUploadUrl)
 * @param token  upload token returned by the API
 * @param file   the file to upload
 */
export async function uploadToSignedUrl(
  path:  string,
  token: string,
  file:  File,
): Promise<void> {
  const { error } = await storageClient.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, token, file, {
      contentType: file.type || 'application/octet-stream',
    })

  if (error) throw new Error(`Upload failed: ${error.message}`)
}

/**
 * Generate a short-lived signed URL for a stored file.
 * Default expiry: 1 hour (3600 s).
 */
export async function getSignedUrl(
  path:      string,
  expiresIn: number = 3600,
): Promise<string> {
  const { data, error } = await storageClient.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn)

  if (error || !data?.signedUrl)
    throw new Error(`Failed to create signed URL: ${error?.message ?? 'unknown'}`)

  return data.signedUrl
}
