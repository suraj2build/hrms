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
import { createClient } from '@supabase/supabase-js'

// Re-use the same Supabase URL/key the auth flow uses.
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const storageClient = createClient(supabaseUrl, supabaseKey)

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
