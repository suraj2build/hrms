/**
 * Holidays — /holidays
 *
 * Matrix view: rows = holidays, columns = holiday groups.
 * Check a cell to assign that holiday to that group.
 * Add holidays inline. Create groups as columns.
 * Groups are tagged to employees (via employee master → Bank/Statutory).
 */

import { useState, useMemo }   from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }               from 'sonner'
import {
  CalendarDays, Plus, Trash2, Loader2, RefreshCw, ShieldAlert, Pencil, Check, X,
} from 'lucide-react'

import { PageContainer }      from '@/components/layout/PageContainer'
import { PageHeader }         from '@/components/layout/PageHeader'
import { SectionCard }        from '@/components/layout/SectionCard'
import { Button }             from '@/components/ui/button'
import { Input }              from '@/components/ui/input'
import { DateInput }          from '@/components/ui/date-input'
import { Badge }              from '@/components/ui/badge'
import { api }                from '@/lib/api/client'
import { useAuthStore }       from '@/stores/authStore'
import { cn }                 from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Holiday {
  id:               string
  date:             string
  name:             string
  is_optional:      boolean
  holiday_group_id: string | null
}

interface HolidayGroup {
  id:         string
  name:       string
  code:       string | null
  state_code: string | null
  is_active:  boolean
}

interface Assignment {
  holiday_id: string
  group_id:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtDate(ds: string) {
  const d = new Date(ds + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const W = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  if (isNaN(d.getTime())) return '—'
  return `${W[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

// ── Main component ─────────────────────────────────────────────────────────────

export function Holidays() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [year, setYear]     = useState(() => new Date().getFullYear())

  // Add holiday form
  const [addDate,     setAddDate]     = useState(todayStr())
  const [addName,     setAddName]     = useState('')
  const [addOptional, setAddOptional] = useState(false)
  const [addErr,      setAddErr]      = useState('')

  // Add group form
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupState, setNewGroupState] = useState('')

  // Edit holiday inline
  const [editId,      setEditId]      = useState<string | null>(null)
  const [editName,    setEditName]    = useState('')
  const [editDate,    setEditDate]    = useState('')
  const [editOptional, setEditOptional] = useState(false)

  // Delete confirm
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // ── Matrix data query ──────────────────────────────────────────────────────
  const { data: matrix, isLoading, refetch } = useQuery<{
    holidays: Holiday[]; groups: HolidayGroup[]; assignments: Assignment[]
  }>({
    queryKey: ['holiday-matrix', year],
    queryFn:  () => api.get(`/masters/holidays/group-matrix?year=${year}`),
    staleTime: 30_000,
  })

  const holidays    = matrix?.holidays    ?? []
  const groups      = matrix?.groups      ?? []
  const assignments = matrix?.assignments ?? []

  // Set of "holiday_id|group_id" for O(1) lookup
  const assignSet = useMemo(
    () => new Set(assignments.map(a => `${a.holiday_id}|${a.group_id}`)),
    [assignments],
  )

  // ── Toggle assignment ──────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: ({ holidayId, groupId, assigned }: { holidayId: string; groupId: string; assigned: boolean }) => {
      const currentGroups = assignments
        .filter(a => a.holiday_id === holidayId)
        .map(a => a.group_id)
      const newGroups = assigned
        ? currentGroups.filter(g => g !== groupId)
        : [...currentGroups, groupId]
      return api.post('/masters/holidays/group-assignments', {
        holiday_id: holidayId,
        group_ids:  newGroups,
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holiday-matrix', year] }) },
    onError: (e: any) => toast.error('Failed to update assignment', { description: e?.message }),
  })

  // ── Add holiday ────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: () => api.post('/masters/holidays', {
      date: addDate, name: addName.trim(), is_optional: addOptional, holiday_group_id: null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holiday-matrix', year] })
      setAddName(''); setAddDate(todayStr()); setAddOptional(false); setAddErr('')
      toast.success('Holiday added')
    },
    onError: (e: any) => { setAddErr(e?.message ?? 'Failed'); toast.error('Failed to add holiday') },
  })

  // ── Edit holiday ───────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: ({ id, name, date, is_optional }: { id: string; name: string; date: string; is_optional: boolean }) =>
      api.patch(`/masters/holidays/${id}`, { name, date, is_optional }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holiday-matrix', year] })
      setEditId(null)
      toast.success('Holiday updated')
    },
    onError: (e: any) => toast.error('Failed to update', { description: e?.message }),
  })

  // ── Delete holiday ─────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/holidays/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holiday-matrix', year] })
      setPendingDelete(null)
      toast.success('Holiday removed')
    },
    onError: (e: any) => { setPendingDelete(null); toast.error('Failed', { description: e?.message }) },
  })

  // ── Add group ──────────────────────────────────────────────────────────────
  const addGroupMutation = useMutation({
    mutationFn: () => api.post('/masters/holiday-groups', {
      name: newGroupName.trim(),
      state_code: newGroupState.trim().toUpperCase() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holiday-matrix', year] })
      setNewGroupName(''); setNewGroupState(''); setShowAddGroup(false)
      toast.success('Holiday group created')
    },
    onError: (e: any) => toast.error('Failed to create group', { description: e?.message }),
  })

  // ── Seed govt holidays ─────────────────────────────────────────────────────
  const seedMutation = useMutation({
    mutationFn: () => api.post('/masters/holidays/seed-standard', {}),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['holiday-matrix', year] })
      const { created, skipped } = res?.data ?? {}
      toast.success('Government holidays loaded', {
        description: created > 0 ? `${created} added, ${skipped} already existed` : 'All already loaded',
      })
    },
    onError: (e: any) => toast.error('Failed', { description: e?.message }),
  })

  // ── Non-admin guard ────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Holiday Calendar" subtitle="Manage public and optional holidays" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs text-center max-w-xs">Only HR admins can manage holidays.</p>
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
        subtitle="Matrix view — assign holidays to groups. Employees inherit their group via the employee master."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              {seedMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5 mr-1.5" />}
              Load Govt Holidays
            </Button>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isLoading && 'animate-spin')} />Refresh
            </Button>
          </div>
        }
      />

      {/* ── Matrix ─────────────────────────────────────────────────────── */}
      <SectionCard
        noPadding
        action={
          <div className="flex items-center gap-2">
            {/* Year nav */}
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setYear(y => y - 1)}>‹</Button>
              <span className="text-sm font-semibold w-10 text-center tabular-nums">{year}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setYear(y => y + 1)}>›</Button>
            </div>
          </div>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-muted-foreground font-semibold whitespace-nowrap w-32">Date</th>
                  <th className="px-4 py-3 text-left text-muted-foreground font-semibold">Holiday Name</th>
                  <th className="px-4 py-3 text-left text-muted-foreground font-semibold w-24">Type</th>
                  {/* Group columns */}
                  {groups.map(g => (
                    <th key={g.id} className="px-3 py-3 text-center text-muted-foreground font-semibold whitespace-nowrap min-w-[90px]">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-foreground font-semibold text-[11px]">{g.name}</span>
                        {g.state_code && <span className="text-[9px] text-muted-foreground">{g.state_code}</span>}
                      </div>
                    </th>
                  ))}
                  {/* Add group column */}
                  <th className="px-3 py-3 text-center min-w-[90px]">
                    {showAddGroup ? (
                      <div className="flex flex-col gap-1 items-center">
                        <Input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                          placeholder="Group name" className="h-6 text-[10px] w-24" />
                        <Input value={newGroupState} onChange={e => setNewGroupState(e.target.value.toUpperCase().slice(0,10))}
                          placeholder="State" className="h-6 text-[10px] w-20" />
                        <div className="flex gap-1">
                          <button className="text-success hover:text-success/80"
                            onClick={() => { if (newGroupName.trim()) addGroupMutation.mutate() }}>
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button className="text-muted-foreground hover:text-foreground"
                            onClick={() => { setShowAddGroup(false); setNewGroupName(''); setNewGroupState('') }}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 mx-auto"
                        onClick={() => setShowAddGroup(true)}>
                        <Plus className="h-3 w-3" />Group
                      </button>
                    )}
                  </th>
                  <th className="px-3 py-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {/* Holiday rows */}
                {holidays.map(h => {
                  const isEditing    = editId === h.id
                  const isConfirming = pendingDelete === h.id
                  return (
                    <tr key={h.id}
                      className={cn(
                        'border-b border-border/60 transition-colors',
                        isEditing ? 'bg-primary/5' : isConfirming ? 'bg-destructive/5' : 'hover:bg-muted/30',
                      )}>
                      {/* Date */}
                      <td className="px-4 py-2.5 whitespace-nowrap font-medium text-foreground">
                        {isEditing
                          ? <DateInput value={editDate} onChange={setEditDate} />
                          : fmtDate(h.date)}
                      </td>
                      {/* Name */}
                      <td className="px-4 py-2.5">
                        {isEditing
                          ? <Input value={editName} onChange={e => setEditName(e.target.value)}
                              className="h-7 text-xs" />
                          : h.name}
                      </td>
                      {/* Type */}
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
                            <input type="checkbox" checked={editOptional}
                              onChange={e => setEditOptional(e.target.checked)}
                              className="rounded border-border accent-primary" />
                            Optional
                          </label>
                        ) : (
                          <Badge variant={h.is_optional ? 'secondary' : 'outline'} className="rounded-full text-[10px]">
                            {h.is_optional ? 'Optional' : 'Public'}
                          </Badge>
                        )}
                      </td>
                      {/* Group checkboxes */}
                      {groups.map(g => {
                        const key      = `${h.id}|${g.id}`
                        const assigned = assignSet.has(key)
                        return (
                          <td key={g.id} className="px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={assigned}
                              disabled={toggleMutation.isPending}
                              onChange={() => toggleMutation.mutate({ holidayId: h.id, groupId: g.id, assigned })}
                              className="w-4 h-4 rounded accent-primary cursor-pointer"
                            />
                          </td>
                        )
                      })}
                      {/* Add group placeholder cell */}
                      <td />
                      {/* Actions */}
                      <td className="px-3 py-2.5 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" className="h-6 text-[10px]"
                              disabled={editMutation.isPending}
                              onClick={() => editMutation.mutate({ id: h.id, name: editName, date: editDate, is_optional: editOptional })}>
                              {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-0.5" />Save</>}
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 text-[10px]"
                              onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        ) : isConfirming ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[10px] text-destructive font-medium">Delete?</span>
                            <Button size="sm" variant="destructive" className="h-6 text-[10px]"
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(h.id)}>
                              {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 text-[10px]"
                              onClick={() => setPendingDelete(null)}>No</Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-0.5">
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-primary"
                              onClick={() => { setEditId(h.id); setEditName(h.name); setEditDate(h.date.slice(0,10)); setEditOptional(h.is_optional) }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingDelete(h.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}

                {/* Add holiday row */}
                <tr className="border-b border-border/60 bg-muted/10">
                  <td className="px-4 py-2.5">
                    <DateInput value={addDate} onChange={setAddDate} disabled={addMutation.isPending} />
                  </td>
                  <td className="px-4 py-2.5" colSpan={2}>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Holiday name…"
                        value={addName}
                        onChange={e => { setAddName(e.target.value); setAddErr('') }}
                        disabled={addMutation.isPending}
                        className="h-7 text-xs"
                        onKeyDown={e => { if (e.key === 'Enter' && addName.trim()) { if (!addName.trim()) { setAddErr('Name required'); return }; addMutation.mutate() } }}
                      />
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                        <input type="checkbox" checked={addOptional} onChange={e => setAddOptional(e.target.checked)}
                          className="rounded border-border accent-primary" />
                        Optional
                      </label>
                      <Button size="sm" className="h-7 text-[11px] shrink-0"
                        disabled={addMutation.isPending || !addName.trim()}
                        onClick={() => { if (!addName.trim()) { setAddErr('Name required'); return }; addMutation.mutate() }}>
                        {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="h-3 w-3 mr-1" />Add</>}
                      </Button>
                      {addErr && <span className="text-[10px] text-destructive">{addErr}</span>}
                    </div>
                  </td>
                  {groups.map(g => <td key={g.id} />)}
                  <td /><td />
                </tr>
              </tbody>
            </table>

            {holidays.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <CalendarDays className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium text-foreground">No holidays for {year}</p>
                <p className="text-xs">Use the Add row above or load Government holidays.</p>
              </div>
            )}

            <div className="px-4 py-2 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {holidays.length} holiday{holidays.length !== 1 ? 's' : ''} · {holidays.filter(h => !h.is_optional).length} public, {holidays.filter(h => h.is_optional).length} optional
              </p>
              <p className="text-xs text-muted-foreground">
                {groups.length} group{groups.length !== 1 ? 's' : ''} — assign groups to employees via Employee master → Bank/Statutory
              </p>
            </div>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
