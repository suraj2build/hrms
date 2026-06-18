import { useEffect, useReducer } from 'react'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

/**
 * EmployeeLabel — resolve an employee UUID to a human label ("Name · CODE").
 *
 * Many list/detail screens only have an employee_id (UUID) on the row and were
 * rendering `employee_id.slice(0, 8)…` — an identifier nobody can read. Rather
 * than enrich every endpoint, this component resolves ids to name + code on the
 * client via a shared, batched, session-lived cache:
 *
 *   - requests within a 50ms window are coalesced into ONE /employees/options?ids=
 *   - results are cached for the session (employees rarely rename)
 *   - /employees/options is tenant-scoped + open to any authenticated role
 *
 * Until resolved (or if the id can't be resolved) it falls back to a short id so
 * the UI never breaks.
 */

type Label = { full_name: string; employee_code: string | null }

const cache    = new Map<string, Label>()
const pending  = new Set<string>()
const listeners = new Set<() => void>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

async function flush() {
  flushTimer = null
  const ids = [...pending].filter((id) => !cache.has(id))
  pending.clear()
  if (ids.length === 0) return
  try {
    // Chunk to stay within the endpoint's 200-id cap.
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const res = await api.get<{
        data: Array<{ id: string; first_name: string; last_name: string; employee_code?: string }>
      }>(`/employees/options?ids=${encodeURIComponent(chunk.join(','))}`)
      for (const e of res.data ?? []) {
        cache.set(e.id, {
          full_name:     `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
          employee_code: e.employee_code ?? null,
        })
      }
    }
  } catch { /* leave unresolved — components fall back to the short id */ }
  for (const l of listeners) l()
}

function requestLabel(id: string) {
  if (!id || cache.has(id)) return
  pending.add(id)
  if (!flushTimer) flushTimer = setTimeout(flush, 50)
}

/** Resolve a single id synchronously from cache (for non-component callers). */
export function getCachedEmployeeLabel(id: string): string | null {
  const hit = cache.get(id)
  if (!hit) return null
  return hit.employee_code ? `${hit.full_name} · ${hit.employee_code}` : hit.full_name
}

export interface EmployeeLabelProps {
  /** Employee UUID to resolve. */
  id: string | null | undefined
  /** Append the employee code ("· SK0001"). Default true. */
  showCode?: boolean
  /** Text shown when id is null/empty. Default '—'. */
  empty?: string
  className?: string
  /** Class applied to the code segment. */
  codeClassName?: string
}

export function EmployeeLabel({
  id,
  showCode = true,
  empty = '—',
  className,
  codeClassName,
}: EmployeeLabelProps) {
  const [, force] = useReducer((x) => x + 1, 0)

  useEffect(() => {
    if (!id || cache.has(id)) return
    const l = () => force()
    listeners.add(l)
    requestLabel(id)
    return () => { listeners.delete(l) }
  }, [id])

  if (!id) return <span className={className}>{empty}</span>

  const hit = cache.get(id)
  if (!hit) {
    // Unresolved (in flight or not found) — short, monospace fallback.
    return <span className={cn('font-mono', className)}>{id.slice(0, 8)}…</span>
  }

  return (
    <span className={className}>
      {hit.full_name || empty}
      {showCode && hit.employee_code && (
        <span className={cn('text-muted-foreground font-mono', codeClassName)}> · {hit.employee_code}</span>
      )}
    </span>
  )
}
