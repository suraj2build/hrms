/**
 * Holidays — /holidays
 *
 * Admin-only page for managing the holiday_calendar table.
 *
 * Features:
 *   · Year navigation (prev / next)
 *   · Inline "Add Holiday" form — date, name, optional flag
 *   · Holiday list table — date | name | type | delete
 *   · Two-step delete confirmation (click Trash → confirm row turns red → click Confirm)
 *
 * API: GET / POST / DELETE /masters/holidays
 * Role gate: non-admins see a 403-style empty state.
 * Design rules: design system tokens only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, Plus, Trash2, Loader2, WifiOff, RefreshCw, ShieldAlert } from 'lucide-react'

import { PageContainer }      from '@/components/layout/PageContainer'
import { PageHeader }         from '@/components/layout/PageHeader'
import { SectionCard }        from '@/components/layout/SectionCard'
import { FormField, FormRow } from '@/components/forms/FormField'
import { Badge }              from '@/components/ui/badge'
import { Button }             from '@/components/ui/button'
import { Input }              from '@/components/ui/input'
import { DateInput }          from '@/components/ui/date-input'
import { api }                from '@/lib/api/client'
import { useAuthStore }       from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Holiday {
  id:          string
  date:        string
  name:        string
  is_optional: boolean
  created_at:  string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  if (isNaN(d.getTime())) return '—'
  return `${WD[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

// ── Shared micro-components ───────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14">
      <WifiOff className="h-7 w-7 text-destructive opacity-70" />
      <p className="text-sm font-medium text-foreground">Something went wrong</p>
      {message && <p className="text-xs text-muted-foreground text-center max-w-xs">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function Holidays() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const queryClient = useQueryClient()

  // ── Year navigation ────────────────────────────────────────────────────────
  const [year, setYear] = useState(() => new Date().getFullYear())

  // ── Add-form state ─────────────────────────────────────────────────────────
  const [newDate,       setNewDate]       = useState(todayStr())
  const [newName,       setNewName]       = useState('')
  const [newOptional,   setNewOptional]   = useState(false)
  const [formError,     setFormError]     = useState<string | null>(null)

  // ── Two-step delete confirmation ───────────────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // ── Query ──────────────────────────────────────────────────────────────────
  const queryKey = ['holidays', year]

  const { data, isLoading, isError, error, refetch } = useQuery<{ data: Holiday[] }>({
    queryKey,
    queryFn:  () => api.get<{ data: Holiday[] }>(`/masters/holidays?year=${year}`),
    staleTime: 30_000,
  })

  const holidays = data?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────
  const addMutation = useMutation<Holiday, Error, { date: string; name: string; is_optional: boolean }>({
    mutationFn: (body) => api.post<Holiday>('/masters/holidays', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setNewName('')
      setNewDate(todayStr())
      setNewOptional(false)
      setFormError(null)
      toast.success('Holiday added')
    },
    onError: (err) => { setFormError(err.message ?? 'Failed to add holiday'); toast.error('Failed to add holiday', { description: err.message }) },
  })

  const seedMutation = useMutation<{ data: { created: number; skipped: number; years: number[] } }, Error>({
    mutationFn: () => api.post('/masters/holidays/seed-standard', {}),
    onSuccess: (res) => {
      const { created, skipped, years } = res.data
      queryClient.invalidateQueries({ queryKey })
      toast.success('Government holidays loaded', {
        description: created > 0
          ? `${created} central holiday(s) added for ${years.join(' & ')}${skipped > 0 ? `, ${skipped} already existed` : ''}. Verify festival dates vs the official gazette.`
          : 'Central holidays already loaded for these years.',
      })
    },
    onError: (e: Error) => toast.error('Failed to load government holidays', { description: e.message }),
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/masters/holidays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setPendingDelete(null)
      toast.success('Holiday removed')
    },
    onError: (e) => { setPendingDelete(null); toast.error('Failed to remove holiday', { description: (e as Error).message }) },
  })

  // ── Form submit ────────────────────────────────────────────────────────────
  function handleAdd() {
    setFormError(null)
    const trimmed = newName.trim()
    if (!trimmed) { setFormError('Name is required'); return }
    if (!newDate) { setFormError('Date is required'); return }
    addMutation.mutate({ date: newDate, name: trimmed, is_optional: newOptional })
  }

  // ── Non-admin guard ────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Holiday Calendar" subtitle="Manage public and optional holidays" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs text-center max-w-xs">
              Only HR admins and super admins can manage holidays.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Holiday Calendar"
        subtitle="Public and optional holidays affect attendance status during processing"
        actions={
          <Button size="sm" variant="outline" onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            title="Load Government of India central gazetted holidays (2026 & 2027)">
            {seedMutation.isPending
              ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              : <CalendarDays className="h-4 w-4 mr-1.5" />}
            Load Govt Holidays
          </Button>
        }
      />

      <div className="space-y-6">

        {/* ── Add Holiday form ───────────────────────────────────────────── */}
        <SectionCard
          title="Add Holiday"
          icon={<Plus className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-4">
            <FormRow cols={3}>
              <FormField label="Date" htmlFor="holiday-date" required>
                <DateInput
                  id="holiday-date"
                  value={newDate}
                  onChange={setNewDate}
                  disabled={addMutation.isPending}
                />
              </FormField>

              <FormField label="Holiday Name" htmlFor="holiday-name" required>
                <Input
                  id="holiday-name"
                  placeholder="e.g. Republic Day"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setFormError(null) }}
                  disabled={addMutation.isPending}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                />
              </FormField>

              {/* Spacer column — optional flag lives below as a checkbox */}
              <div className="flex items-end pb-0.5">
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-border accent-primary"
                    checked={newOptional}
                    onChange={(e) => setNewOptional(e.target.checked)}
                    disabled={addMutation.isPending}
                  />
                  Optional holiday
                </label>
              </div>
            </FormRow>

            {/* Error */}
            {formError && (
              <p className="text-xs text-destructive">{formError}</p>
            )}

            <Button
              onClick={handleAdd}
              disabled={addMutation.isPending}
              className="w-full sm:w-auto"
            >
              {addMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding…</>
                : <><Plus className="h-4 w-4 mr-2" />Add Holiday</>
              }
            </Button>
          </div>
        </SectionCard>

        {/* ── Holiday list ───────────────────────────────────────────────── */}
        <SectionCard
          title={`Holidays — ${year}`}
          icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
          action={
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => { setYear((y) => y - 1); setPendingDelete(null) }}
              >
                <span className="text-sm font-medium">‹</span>
              </Button>
              <span className="text-sm font-semibold text-foreground w-10 text-center tabular-nums">
                {year}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => { setYear((y) => y + 1); setPendingDelete(null) }}
              >
                <span className="text-sm font-medium">›</span>
              </Button>
            </div>
          }
          noPadding
        >
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-14 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">Loading holidays…</span>
            </div>
          )}

          {isError && !isLoading && (
            <ErrorState
              message={(error as Error)?.message}
              onRetry={() => refetch()}
            />
          )}

          {!isLoading && !isError && holidays.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
              <CalendarDays className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium text-foreground">No holidays for {year}</p>
              <p className="text-xs">Use the form above to add the first holiday.</p>
            </div>
          )}

          {!isLoading && !isError && holidays.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Name', 'Type', ''].map((h, i) => (
                      <th
                        key={h || `col-${i}`}
                        className={`px-4 py-3 text-xs font-semibold text-muted-foreground text-left last:text-right`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((h) => {
                    const isConfirming = pendingDelete === h.id
                    const isDeleting   = deleteMutation.isPending && pendingDelete === h.id
                    return (
                      <tr
                        key={h.id}
                        className={`border-b border-border last:border-0 transition-colors ${
                          isConfirming ? 'bg-destructive/5' : 'hover:bg-muted/40'
                        }`}
                      >
                        {/* Date */}
                        <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                          {fmtDate(h.date)}
                        </td>

                        {/* Name */}
                        <td className="px-4 py-3 text-foreground">
                          {h.name}
                        </td>

                        {/* Type badge */}
                        <td className="px-4 py-3">
                          <Badge
                            variant={h.is_optional ? 'secondary' : 'outline'}
                            className="rounded-full text-xs"
                          >
                            {h.is_optional ? 'Optional' : 'Public'}
                          </Badge>
                        </td>

                        {/* Delete / Confirm */}
                        <td className="px-4 py-3 text-right">
                          {!isConfirming && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingDelete(h.id)}
                              title="Delete holiday"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {isConfirming && (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-destructive font-medium">Delete?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                disabled={isDeleting}
                                onClick={() => deleteMutation.mutate(h.id)}
                              >
                                {isDeleting
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : 'Confirm'
                                }
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={isDeleting}
                                onClick={() => setPendingDelete(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Footer: total count */}
              <div className="px-4 py-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  {holidays.length} holiday{holidays.length !== 1 ? 's' : ''} in {year}
                  {' · '}
                  {holidays.filter((h) => !h.is_optional).length} public,{' '}
                  {holidays.filter((h) => h.is_optional).length} optional
                </p>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  )
}
