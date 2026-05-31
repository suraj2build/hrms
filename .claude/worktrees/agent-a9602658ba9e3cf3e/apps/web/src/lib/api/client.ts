import { useAuthStore } from '@/stores/authStore'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:2001'

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
  const headers = getAuthHeaders()
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

/**
 * GET that returns the raw Response for file/blob downloads.
 * The caller is responsible for reading response.blob() or response.text().
 */
async function requestRaw(endpoint: string): Promise<Response> {
  const token = useAuthStore.getState().accessToken
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message ?? `HTTP ${response.status}`)
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
  const authHeaders = getAuthHeaders()
  const response = await fetch(`${API_URL}${endpoint}`, { headers: authHeaders })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message ?? `HTTP ${response.status}`)
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
