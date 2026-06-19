import { useAuthStore } from '@/stores/authStore'
import { DEMO_MODE, resolveDemo } from '@/lib/demo'

// ── Structured API error ───────────────────────────────────────────────────────
//
// Thrown by the request() helper whenever the server returns a non-2xx status.
// Carries the full structured body so callers can branch on `error` codes
// (e.g. 'MISSING_ATTENDANCE_DATA') rather than parsing free-text messages.
//
// Usage:
//   import { ApiError } from '@/lib/api/client'
//   try { await api.post(...) } catch (e) {
//     if (e instanceof ApiError && e.error === 'MISSING_ATTENDANCE_DATA') { ... }
//   }

export class ApiError extends Error {
  readonly statusCode: number
  /** Machine-readable error code returned by the backend (e.g. 'NOT_FOUND'). */
  readonly error:      string
  /** Full response body — use to access backend-specific extra fields. */
  readonly data:       Record<string, unknown>

  constructor(
    statusCode: number,
    error:      string,
    message:    string,
    data:       Record<string, unknown> = {},
  ) {
    super(message)
    this.name       = 'ApiError'
    this.statusCode = statusCode
    this.error      = error
    this.data       = data
  }
}

/**
 * Base URL for all API calls.
 *
 * Development (default): '' — empty string so every call becomes a relative
 * path (e.g. fetch('/me'), fetch('/departments')).  The Vite dev server's
 * proxy table in vite.config.ts has an entry for every top-level API route
 * prefix (/me, /employees, /attendance, /payroll, …) that forwards them to
 * http://localhost:2001, so no CORS configuration is needed in dev.
 *
 * Production: set VITE_API_URL to the absolute API origin, e.g.
 *   VITE_API_URL=https://api.hrms.in
 *
 * Use `||` (not `??`) so an explicitly-empty env var also falls through to
 * the empty-string default ('' is falsy; undefined/null is also handled, and
 * an empty .env line produces '' which `??` would NOT catch).
 *
 * WARNING: Never set VITE_API_URL to http://localhost:2001 in development.
 * That bypasses the Vite proxy, makes direct cross-origin requests, and causes
 * "TypeError: Failed to fetch" whenever the API server is temporarily unavailable.
 * The proxy approach (empty VITE_API_URL) is the only safe dev setup.
 */
const API_URL = import.meta.env.VITE_API_URL || ''

if (
  import.meta.env.DEV &&
  API_URL &&
  (API_URL.includes('localhost') || API_URL.includes('127.0.0.1'))
) {
  console.warn(
    '[api/client] VITE_API_URL is set to an absolute localhost URL in development:',
    API_URL,
    '\nThis bypasses the Vite proxy and may cause "Failed to fetch" errors.',
    '\nUnset VITE_API_URL in your .env files to use the proxy correctly.',
  )
}

/**
 * DEMO MODE helper — request bodies are JSON-stringified before they reach the
 * request() helper. The demo resolver wants the parsed object, so undo that.
 * Non-string / non-JSON bodies (FormData, blobs) are passed through untouched.
 */
function safeParse(body: BodyInit): unknown {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function getAuthHeaders(): HeadersInit {
  const token = useAuthStore.getState().accessToken
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // ── DEMO MODE — short-circuit to fixtures, no network/auth ─────────────────
  if (DEMO_MODE) {
    await new Promise(r => setTimeout(r, 120))
    const parsedBody = options.body != null ? safeParse(options.body) : undefined
    return resolveDemo(endpoint, options.method ?? 'GET', parsedBody) as T
  }

  const token = useAuthStore.getState().accessToken
  const hasBody = options.body != null

  // Only set Content-Type when there is an actual body.
  // Sending Content-Type: application/json with an empty body causes Fastify
  // to throw FST_ERR_CTP_EMPTY_JSON_BODY (400) on DELETE / other bodyless requests.
  const headers: HeadersInit = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
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

  // 204 No Content (and any other empty response) — return undefined rather than
  // trying to JSON-parse an empty body, which throws "Unexpected end of JSON input".
  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0') {
    return undefined as unknown as T
  }
  return response.json() as Promise<T>
}

/**
 * GET that returns the raw Response for file/blob downloads.
 * The caller is responsible for reading response.blob() or response.text().
 */
async function requestRaw(endpoint: string): Promise<Response> {
  // ── DEMO MODE — wrap the resolved JSON in a Response so callers can .blob() ─
  if (DEMO_MODE) {
    await new Promise(r => setTimeout(r, 120))
    const resolved = resolveDemo(endpoint, 'GET')
    return new Response(JSON.stringify(resolved), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = useAuthStore.getState().accessToken
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
  return response
}

/**
 * Like request<T> but also returns the response Headers object.
 * Used when the caller needs to inspect response headers (e.g. X-Profile-Mode,
 * X-Request-Id) before deciding whether to fetch additional data.
 */
async function requestWithMeta<T>(
  endpoint: string,
): Promise<{ data: T; headers: Headers }> {
  // ── DEMO MODE — resolve fixtures + synthetic headers ───────────────────────
  if (DEMO_MODE) {
    await new Promise(r => setTimeout(r, 120))
    const resolved = resolveDemo(endpoint, 'GET') as T
    return { data: resolved, headers: new Headers({ 'Content-Type': 'application/json' }) }
  }

  const authHeaders = getAuthHeaders()
  const response = await fetch(`${API_URL}${endpoint}`, { headers: authHeaders })

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    throw new ApiError(
      response.status,
      (body.error   as string | undefined) ?? `HTTP_${response.status}`,
      (body.message as string | undefined) ?? `HTTP ${response.status}`,
      body,
    )
  }

  const data = (await response.json()) as T
  return { data, headers: response.headers }
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  /** GET that also returns response Headers. Use to inspect X-Profile-Mode etc. */
  getWithMeta: <T>(url: string) => requestWithMeta<T>(url),
  /** GET that returns the raw Response (for file/blob downloads). */
  getRaw: (url: string) => requestRaw(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
}
