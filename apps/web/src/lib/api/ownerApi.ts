/**
 * Owner API client
 *
 * Same shape as the tenant `api` client but reads the Bearer token from
 * useOwnerStore instead of useAuthStore.
 */
import { ownerSupabase } from '@/lib/supabase/ownerClient'
import { useOwnerStore }  from '@/stores/ownerStore'
import { ApiError }       from '@/lib/api/client'

const API_URL = import.meta.env.VITE_API_URL || ''

async function getOwnerHeaders(hasBody: boolean): Promise<HeadersInit> {
  // Pull the token LIVE from the isolated owner session (auto-refreshed by
  // supabase-js). Fall back to the store snapshot only if the session call
  // hasn't resolved yet.
  let token: string | null = null
  try {
    const { data } = await ownerSupabase.auth.getSession()
    token = data.session?.access_token ?? null
  } catch { /* ignore — fall through to store */ }
  if (!token) token = useOwnerStore.getState().accessToken

  return {
    // Only send Content-Type when there is a body — Fastify returns 400
    // for Content-Type: application/json with an empty body.
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function ownerRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined
  const headers  = await getOwnerHeaders(hasBody)
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    throw new ApiError(
      response.status,
      (body.error   as string | undefined) ?? `HTTP_${response.status}`,
      (body.message as string | undefined) ?? `HTTP ${response.status}`,
      body,
    )
  }

  return response.json() as Promise<T>
}

export const ownerApi = {
  get:    <T>(url: string)                 => ownerRequest<T>(url),
  post:   <T>(url: string, body?: unknown) => ownerRequest<T>(url, { method: 'POST',  body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch:  <T>(url: string, body: unknown)  => ownerRequest<T>(url, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: <T>(url: string)                 => ownerRequest<T>(url, { method: 'DELETE' }),
}
