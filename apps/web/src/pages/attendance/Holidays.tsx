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
import { CalendarDays, Plus, Trash2, Loader2, WifiOff, RefreshCw, ShieldAlert, Pencil, Check, X } from 'lucide-react'

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
  holiday_group_id: string | null
  created_at:  string
}

interface HolidayGroup {
  id:         string
  name:       string
  code:       string | null
  state_code: string | null
  is_active:  boolean
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
  const [newGroupId,    setNewGroupId]    = useState('')   // '' = All-India
  const [formError,     setFormError]     = useState<string | null>(null)
  const [newGroupName,  setNewGroupName]  = useState('')

  // ── Two-step delete confirmation ───────────────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // ── Inline edit state (holiday row) ──────────────────────────────────────────
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [editDate,     setEditDate]     = useState('')
  const [editName,     setEditName]     = useState('')
  const [editOptional, setEditOptional] = useState(false)
  const [editGroupId,  setEditGroupId]  = useState('')

  // ── Inline edit state (holiday group) ────────────────────────────────────────
  const [editGroupRowId, setEditGroupRowId] = useState<string | null>(null)
  const [editGroupNameVal,  setEditGroupNameVal]  = useState('')
  const [editGroupStateVal, setEditGroupStateVal] = useState('')
  const [newGroupState,     setNewGroupState]     = useState('')

  function startEdit(h: Holiday) {
    setEditingId(h.id)
    setEditDate(h.date.slice(0, 10))
    setEditName(h.name)
    setEditOptional(h.is_optional)
    setEditGroupId(h.holiday_group_id ?? '')
    setPendingDelete(null)
  }
  function cancelEdit() { setEditingId(null) }

  // ── Query ──────────────────────────────────────────────────────────────────
  const queryKey = ['holidays', year]

  const { data, isLoading, isError, error, refetch } = useQuery<{ data: Holiday[] }>({
    queryKey,
    queryFn:  () => api.get<{ data: Holiday[] }>(`/masters/holidays?year=${year}`),
    staleTime: 30_000,
  })

  const holidays = data?.data ?? []

  // ── Holiday groups ───────────────────────────────────────────────────────────
  const { data: groupData } = useQuery<{ data: HolidayGroup[] }>({
    queryKey: ['holiday-groups'],
    queryFn:  () => api.get('/masters/holiday-groups'),
    staleTime: 120_000,
  })
  const groups = groupData?.data ?? []
  const groupName = (id: string | null) => id ? (groups.find(g => g.id === id)?.name ?? 'Group') : 'All-India'

  const addGroupMutation = useMutation<unknown, Error, { name: string; state_code: string | null }>({
    mutationFn: (body) => api.post('/masters/holiday-groups', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holiday-groups'] }); setNewGroupName(''); setNewGroupState(''); toast.success('Holiday group added') },
    onError: (e) => toast.error('Failed to add group', { description: e.message }),
  })
  const deleteGroupMutation = useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/masters/holiday-groups/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holiday-groups'] }); queryClient.invalidateQueries({ queryKey }); toast.success('Holiday group removed') },
    onError: (e) => toast.error('Failed to remove group', { description: e.message }),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────
  const addMutation = useMutation<Holiday, Error, { date: string; name: string; is_optional: boolean; holiday_group_id: string | null }>({
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

  const editMutation = useMutation<Holiday, Error, { id: string; body: { date: string; name: string; is_optional: boolean; holiday_group_id: string | null } }>({
    mutationFn: ({ id, body }) => api.patch<Holiday>(`/masters/holidays/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setEditingId(null)
      toast.success('Holiday updated')
    },
    onError: (e) => toast.error('Failed to update holiday', { description: e.message }),
  })

  const editGroupMutation = useMutation<unknown, Error, { id: string; body: { name: string; state_code: string | null } }>({
    mutationFn: ({ id, body }) => api.put(`/masters/holiday-groups/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holiday-groups'] })
      queryClient.invalidateQueries({ queryKey })
      setEditGroupRowId(null)
      toast.success('Holiday group updated')
    },
    onError: (e) => toast.error('Failed to update group', { description: e.message }),
  })

  function saveEdit() {
    const trimmed = editName.trim()
    if (!trimmed || !editDate) { toast.error('Date and name are required'); return }
    editMutation.mutate({ id: editingId!, body: { date: editDate, name: trimmed, is_optional: editOptional, holiday_group_id: editGroupId || null } })
  }

  // ── Form submit ────────────────────────────────────────────────────────────
  function handleAdd() {
    setFormError(null)
    const trimmed = newName.trim()
    if (!trimmed) { setFormError('Name is required'); return }
    if (!newDate) { setFormError('Date is required'); return }
    addMutation.mutate({ date: newDate, name: trimmed, is_optional: newOptional, holiday_group_id: newGroupId || null })
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

            <FormField label="Applies to" htmlFor="holiday-group">
              <select
                id="holiday-group"
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                disabled={addMutation.isPending}
                className="flex h-9 w-full sm:w-72 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">All-India (everyone)</option>
                {groups.filter(g => g.is_active).map(g => (
                  <option key={g.id} value={g.id}>{g.name}{g.state_code ? ` (${g.state_code})` : ''}</option>
                ))}
              </select>
            </FormField>

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

        {/* ── Holiday Groups (regional applicability) ────────────────────── */}
        {isAdmin && (
          <SectionCard
            title="Holiday Groups"
            icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
          >
            <p className="text-xs text-muted-foreground mb-3">
              Regional calendars (e.g. a state or branch). Assign a group to a Site (Setup → Sites);
              holidays tagged to that group then apply only to employees at those sites. Holidays left
              as “All-India” apply to everyone.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <Input
                placeholder="New group (e.g. Maharashtra)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="h-8 text-sm w-56"
                onKeyDown={(e) => { if (e.key === 'Enter' && newGroupName.trim()) addGroupMutation.mutate({ name: newGroupName.trim(), state_code: newGroupState.trim() || null }) }}
              />
              <Input
                placeholder="State code (e.g. MH)"
                value={newGroupState}
                onChange={(e) => setNewGroupState(e.target.value.toUpperCase().slice(0, 10))}
                className="h-8 text-sm w-32"
              />
              <Button size="sm" disabled={!newGroupName.trim() || addGroupMutation.isPending}
                onClick={() => addGroupMutation.mutate({ name: newGroupName.trim(), state_code: newGroupState.trim() || null })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Group
              </Button>
            </div>
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No holiday groups yet — all holidays are All-India.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {groups.map(g => editGroupRowId === g.id ? (
                  <span key={g.id} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-muted/30 px-2 py-1 text-xs">
                    <Input value={editGroupNameVal} onChange={(e) => setEditGroupNameVal(e.target.value)}
                      className="h-6 text-xs w-36" placeholder="Name" />
                    <Input value={editGroupStateVal} onChange={(e) => setEditGroupStateVal(e.target.value.toUpperCase().slice(0, 10))}
                      className="h-6 text-xs w-20" placeholder="State" />
                    <button className="text-success hover:text-success/80" title="Save"
                      onClick={() => { if (editGroupNameVal.trim()) editGroupMutation.mutate({ id: g.id, body: { name: editGroupNameVal.trim(), state_code: editGroupStateVal.trim() || null } }) }}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button className="text-muted-foreground hover:text-foreground" title="Cancel"
                      onClick={() => setEditGroupRowId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : (
                  <span key={g.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs">
                    {g.name}{g.state_code ? ` · ${g.state_code}` : ''}
                    <button className="text-muted-foreground hover:text-primary"
                      title="Edit group" onClick={() => { setEditGroupRowId(g.id); setEditGroupNameVal(g.name); setEditGroupStateVal(g.state_code ?? '') }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button className="text-muted-foreground hover:text-destructive"
                      title="Delete group" onClick={() => deleteGroupMutation.mutate(g.id)}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </SectionCard>
        )}

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
                    {['Date', 'Name', 'Type', 'Applies to', ''].map((h, i) => (
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
                    const isEditing    = editingId === h.id

                    if (isEditing) {
                      return (
                        <tr key={h.id} className="border-b border-border last:border-0 bg-primary/5">
                          <td className="px-4 py-3">
                            <DateInput value={editDate} onChange={setEditDate} disabled={editMutation.isPending} />
                          </td>
                          <td className="px-4 py-3">
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                              className="h-8 text-sm" disabled={editMutation.isPending}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }} />
                          </td>
                          <td className="px-4 py-3">
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                              <input type="checkbox" className="rounded border-border accent-primary"
                                checked={editOptional} onChange={(e) => setEditOptional(e.target.checked)}
                                disabled={editMutation.isPending} />
                              Optional
                            </label>
                          </td>
                          <td className="px-4 py-3">
                            <select value={editGroupId} onChange={(e) => setEditGroupId(e.target.value)}
                              disabled={editMutation.isPending}
                              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50">
                              <option value="">All-India (everyone)</option>
                              {groups.filter(g => g.is_active).map(g => (
                                <option key={g.id} value={g.id}>{g.name}{g.state_code ? ` (${g.state_code})` : ''}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" className="h-7 text-xs" disabled={editMutation.isPending} onClick={saveEdit}>
                                {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" />Save</>}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={editMutation.isPending} onClick={cancelEdit}>
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

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

                        {/* Applies to (holiday group) */}
                        <td className="px-4 py-3">
                          <Badge
                            variant={h.holiday_group_id ? 'outline' : 'secondary'}
                            className="rounded-full text-xs"
                          >
                            {groupName(h.holiday_group_id)}
                          </Badge>
                        </td>

                        {/* Edit / Delete / Confirm */}
                        <td className="px-4 py-3 text-right">
                          {!isConfirming && (
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-primary"
                                onClick={() => startEdit(h)}
                                title="Edit holiday"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setPendingDelete(h.id)}
                                title="Delete holiday"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
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
