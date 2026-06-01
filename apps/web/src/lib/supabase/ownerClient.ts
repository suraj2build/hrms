/**
 * Owner Supabase client — ISOLATED from the tenant app client.
 *
 * Uses a separate `storageKey` so the platform-owner session and a tenant
 * user session can coexist in the same browser without overwriting each
 * other. Without this, logging into the tenant app would clobber the owner
 * session (and vice-versa), causing the owner portal to send the wrong
 * user's token → backend 403 "Not a platform admin".
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const ownerSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,           // owner portal never uses magic-link redirects
    storageKey:         'emvora-owner-auth',  // ← isolated from tenant 'sb-*-auth-token'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({ lockAcquireTimeout: 10_000 }) as any),
  },
})
