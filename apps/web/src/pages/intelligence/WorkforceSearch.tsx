/**
 * WorkforceSearch — Natural Language Workforce Search
 * /admin/intelligence/search
 *
 * Rule-based NL search. No LLM. Calls POST /intelligence/search.
 */
import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api/client'
import { fmtDate as fmtDateCanonical } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Search, Loader2, AlertCircle, Users } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchEmployee {
  id:            string
  first_name:    string
  last_name:     string
  employee_code: string
  status:        string
  joining_date:  string | null
  department:    string | null
}

interface SearchResult {
  query:          string
  interpreted_as: string
  employees:      SearchEmployee[]
  count:          number
  truncated:      boolean
  sources:        string[]
}

interface SearchError {
  error:       string
  suggestions: string[]
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; data: SearchResult }
  | { kind: 'unrecognised'; suggestions: string[] }
  | { kind: 'error'; message: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  'employees joining this month',
  'employees joining this week',
  'employees without PAN',
  'employees on notice',
  'employees on probation',
  'separated employees',
  'employees without onboarding',
  'employees with assets',
  'engineering department',
  'sales department',
]

const STATUS_COLORS: Record<string, string> = {
  active:     'bg-success/15 text-success',
  on_notice:  'bg-accent-coral/15 text-accent-coral',
  separated:  'bg-destructive/15 text-destructive',
  inactive:   'bg-muted text-muted-foreground',
}

function statusBadgeClass(status: string) {
  return STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground'
}

function formatDate(d: string | null) {
  return fmtDateCanonical(d)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkforceSearch() {
  const [inputValue, setInputValue] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setState({ kind: 'idle' })
      return
    }
    setState({ kind: 'loading' })
    try {
      const data = await api.post<SearchResult | SearchError>('/intelligence/search', { query: trimmed })
      if ('error' in data && data.error === 'Could not interpret query') {
        setState({ kind: 'unrecognised', suggestions: (data as SearchError).suggestions ?? EXAMPLE_QUERIES })
      } else {
        setState({ kind: 'result', data: data as SearchResult })
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { message?: string } }; message?: string }
      const msg = apiErr?.response?.data?.message ?? apiErr?.message ?? 'Search failed'
      setState({ kind: 'error', message: msg })
    }
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setInputValue(val)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!val.trim()) {
      setState({ kind: 'idle' })
      return
    }
    const t = setTimeout(() => runSearch(val), 600)
    setDebounceTimer(t)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (debounceTimer) clearTimeout(debounceTimer)
    runSearch(inputValue)
  }

  function handleExampleClick(q: string) {
    setInputValue(q)
    if (debounceTimer) clearTimeout(debounceTimer)
    runSearch(q)
  }

  return (
    <PageContainer>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          Workforce Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search your workforce using plain language. Results are derived from live data.
        </p>
      </div>

      {/* Search box */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-5 h-5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={inputValue}
            onChange={handleChange}
            placeholder="e.g. employees joining this month"
            className="w-full pl-10 pr-4 py-3 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary bg-white shadow-sm"
            autoFocus
          />
          {state.kind === 'loading' && (
            <Loader2 className="absolute right-3 w-5 h-5 text-primary animate-spin" />
          )}
        </div>
      </form>

      {/* Interpreted-as badge */}
      {state.kind === 'result' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Interpreted as:</span>
          <Badge variant="secondary" className="font-mono text-xs">
            {state.data.interpreted_as}
          </Badge>
          {state.data.sources.map(s => (
            <Badge key={s} variant="outline" className="text-xs text-muted-foreground">
              {s}
            </Badge>
          ))}
        </div>
      )}

      {/* Results table */}
      {state.kind === 'result' && (
        <>
          <p className="text-sm text-muted-foreground">
            {state.data.truncated ? `${state.data.count}+` : state.data.count} result{state.data.count !== 1 ? 's' : ''} found
            {state.data.truncated && ' — refine your search to see more'}
          </p>
          {state.data.count === 0 ? (
            <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No employees matched this query.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Code</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Joining Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Department</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {state.data.employees.map(emp => (
                    <tr key={emp.id} className="hover:bg-muted transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        <Link
                          to={`/admin/employees/${emp.id}`}
                          className="text-primary hover:underline"
                        >
                          {emp.first_name} {emp.last_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{emp.employee_code ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(emp.status)}`}>
                          {emp.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(emp.joining_date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{emp.department ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Unrecognised query */}
      {state.kind === 'unrecognised' && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-warning font-medium text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Could not interpret your query. Try one of these:
          </div>
          <div className="flex flex-wrap gap-2">
            {state.suggestions.map(s => (
              <button
                key={s}
                onClick={() => handleExampleClick(s)}
                className="px-3 py-1.5 text-xs rounded-full border border-warning/40 bg-card text-warning hover:bg-warning/10 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* API error */}
      {state.kind === 'error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}

      {/* Idle state — show example queries */}
      {state.kind === 'idle' && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Example queries</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map(q => (
              <button
                key={q}
                onClick={() => handleExampleClick(q)}
                className="px-3 py-1.5 text-xs rounded-full border border-border bg-white text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors shadow-sm"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
