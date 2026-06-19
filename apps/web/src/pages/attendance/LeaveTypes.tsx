/**
 * LeaveTypes — /leave-types
 *
 * HR admin page for managing leave type definitions.
 *
 * Layout:
 *   Left  (lg:col-span-2) — table of all leave types with edit / deactivate actions
 *   Right (lg:col-span-1) — create / edit form
 *
 * Access: hr_admin and super_admin can create/edit/delete.
 *         All authenticated users can view.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Plus, Pencil, Trash2, ShieldAlert,
  CheckCircle2, AlertCircle, Loader2, X, Download,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { FormField, FormActions } from '@/components/forms/FormField'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { Badge }         from '@/components/ui/badge'
import { toast }         from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveType {
  id:                string
  name:              string
  is_paid:           boolean
  allow_sandwich:    boolean
  allow_half_day:    boolean
  allow_hourly:      boolean
  max_hours_per_day: number | null
  is_active:         boolean
  created_at:        string
}

interface LeaveTypeForm {
  name:              string
  is_paid:           boolean
  allow_sandwich:    boolean
  allow_half_day:    boolean
  allow_hourly:      boolean
  max_hours_per_day: number | null
  is_active:         boolean
}

interface BalanceRow {
  id:            string
  leave_type_id: string
  balance:       number
  year:          number
  leave_types:   { id: string; name: string; is_paid: boolean }
}

const EMPTY_FORM: LeaveTypeForm = {
  name:              '',
  is_paid:           true,
  allow_sandwich:    false,
  allow_half_day:    false,
  allow_hourly:      false,
  max_hours_per_day: null,
  is_active:         true,
}

// ── Toggle helper ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary/50 ring-offset-background',
        checked ? 'bg-primary' : 'bg-muted',
      )}
      aria-label={label}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeaveTypes() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()

  const [editId,   setEditId]   = useState<string | null>(null)
  const [form,     setForm]     = useState<LeaveTypeForm>(EMPTY_FORM)
  const [errors,   setErrors]   = useState<{ name?: string }>({})
  const [showForm, setShowForm] = useState(false)
  const [success,  setSuccess]  = useState('')

  // ── Leave Balance state ────────────────────────────────────────────────────
  const [balanceEmpId,  setBalanceEmpId]  = useState('')
  const [appliedEmpId,  setAppliedEmpId]  = useState('')
  const [balanceEdits,  setBalanceEdits]  = useState<Record<string, string>>({})

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    staleTime: 60_000,
  })
  const leaveTypes = data?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: LeaveTypeForm) =>
      editId
        ? api.put(`/masters/leave-types/${editId}`, body)
        : api.post('/masters/leave-types', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-types'] })
      setSuccess(editId ? 'Leave type updated.' : 'Leave type created.')
      setTimeout(() => {
        setSuccess('')
        resetForm()
      }, 2000)
      toast.success('Leave type saved')
    },
    onError: (e: Error) => toast.error('Failed to save leave type', { description: e.message }),
  })

  const seedMutation = useMutation<{ data: { created: number; skipped: number } }, Error>({
    mutationFn: () => api.post('/masters/leave-types/seed-standard', {}),
    onSuccess: (res) => {
      const { created, skipped } = res.data
      toast.success('Standard leave types loaded', {
        description: created > 0
          ? `${created} added${skipped > 0 ? `, ${skipped} already existed` : ''}. Set quotas in Leave Policies.`
          : 'All standard leave types already exist.',
      })
      qc.invalidateQueries({ queryKey: ['leave-types'] })
    },
    onError: (e: Error) => toast.error('Failed to load standard leave types', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/leave-types/${id}`),
    onSuccess: (resp: { deactivated?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['leave-types'] })
      if (resp?.deactivated) {
        setSuccess('Leave type deactivated (existing applications reference it).')
        setTimeout(() => setSuccess(''), 3000)
      } else {
        toast.success('Leave type deleted')
      }
    },
    onError: (e: unknown) => toast.error('Delete failed', { description: (e as Error)?.message }),
  })

  // ── Balance query + mutation ───────────────────────────────────────────────
  const { data: balanceData, isLoading: balanceLoading, refetch: refetchBalance } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave-balance', appliedEmpId],
    queryFn:  () => api.get(`/attendance/leave/balance/${appliedEmpId}`),
    enabled:  !!appliedEmpId,
    staleTime: 30_000,
  })

  const setBalanceMutation = useMutation({
    mutationFn: (body: { employee_id: string; leave_type_id: string; balance: number }) =>
      api.put('/attendance/leave/balance', body),
    onSuccess: () => {
      refetchBalance()
      qc.invalidateQueries({ queryKey: ['leave-balance'] })
      toast.success('Balance updated')
    },
    onError: (e: unknown) => toast.error('Failed to update balance', { description: (e as Error)?.message }),
  })

  // ── Helpers ───────────────────────────────────────────────────────────────
  function resetForm() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setShowForm(false)
    saveMutation.reset()
  }

  function startEdit(lt: LeaveType) {
    setEditId(lt.id)
    setForm({
      name:              lt.name,
      is_paid:           lt.is_paid,
      allow_sandwich:    lt.allow_sandwich,
      allow_half_day:    lt.allow_half_day,
      allow_hourly:      lt.allow_hourly,
      max_hours_per_day: lt.max_hours_per_day,
      is_active:         lt.is_active,
    })
    setErrors({})
    setSuccess('')
    saveMutation.reset()
    setShowForm(true)
    document.getElementById('lt-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  function validate(): boolean {
    const e: { name?: string } = {}
    if (!form.name.trim()) e.name = 'Name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSave() {
    if (!validate()) return
    saveMutation.mutate({ ...form, name: form.name.trim() })
  }

  function handleDelete(lt: LeaveType) {
    const msg = lt.is_active
      ? `Delete "${lt.name}"? If it has existing applications it will be deactivated instead.`
      : `Permanently delete the inactive type "${lt.name}"?`
    if (!window.confirm(msg)) return
    deleteMutation.mutate(lt.id)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Leave Types"
        subtitle="Configure the leave categories available for your employees"
        actions={isAdmin ? (
          <Button size="sm" variant="outline" onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            title="Load the best-practice standard leave types (idempotent — won't duplicate)">
            {seedMutation.isPending
              ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              : <Download className="h-4 w-4 mr-1.5" />}
            Load Standard Library
          </Button>
        ) : undefined}
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can manage leave types.</p>
          </div>
        </SectionCard>
      )}

      {success && (
        <div className="flex items-center gap-2 text-sm text-success p-3 rounded-lg bg-success/10 border border-success/20">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: Leave types table ──────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <SectionCard
            title={`Leave Types${leaveTypes.length ? ` (${leaveTypes.length})` : ''}`}
            icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
            noPadding
            action={
              isAdmin ? (
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => { resetForm(); setShowForm(true) }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Type
                </Button>
              ) : undefined
            }
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center gap-2 p-10">
                <p className="text-sm text-destructive">Failed to load leave types</p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
              </div>
            ) : leaveTypes.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No leave types yet.</p>
                {isAdmin && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Load the best-practice standard library in one click, or create your own with "New Type".
                    </p>
                    <Button
                      size="sm"
                      onClick={() => seedMutation.mutate()}
                      disabled={seedMutation.isPending}
                      className="gap-1.5"
                    >
                      {seedMutation.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                      Load Standard Library
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {['Name', 'Type', 'Sandwich', 'Status', ''].map(h => (
                        <th
                          key={h}
                          className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaveTypes.map(lt => (
                      <tr
                        key={lt.id}
                        className={cn(
                          'border-b border-border/50 transition-colors hover:bg-muted/20',
                          !lt.is_active && 'opacity-50',
                        )}
                      >
                        {/* Name */}
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">{lt.name}</span>
                        </td>

                        {/* Paid / Unpaid */}
                        <td className="px-4 py-3">
                          <Badge variant={lt.is_paid ? 'success' : 'secondary'} className="rounded-full text-[10px]">
                            {lt.is_paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </td>

                        {/* Sandwich */}
                        <td className="px-4 py-3">
                          {lt.allow_sandwich ? (
                            <Badge variant="outline" className="rounded-full text-[10px]">Sandwich</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <Badge
                            variant={lt.is_active ? 'default' : 'secondary'}
                            className="rounded-full text-[10px]"
                          >
                            {lt.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Edit"
                                onClick={() => startEdit(lt)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title={lt.is_active ? 'Delete / Deactivate' : 'Delete'}
                                disabled={deleteMutation.isPending}
                                onClick={() => handleDelete(lt)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Right: Create / edit form ────────────────────────────────────── */}
        {isAdmin && (showForm || editId) && (
          <div id="lt-form">
            <SectionCard
              title={editId ? 'Edit Leave Type' : 'New Leave Type'}
              icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
              action={
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              }
            >
              <div className="space-y-4">
                {/* Name */}
                <FormField label="Name" htmlFor="lt-name" required error={errors.name}>
                  <Input
                    id="lt-name"
                    placeholder="e.g. Casual Leave, Sick Leave"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    maxLength={50}
                  />
                </FormField>

                {/* Is Paid */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-foreground">Paid Leave</p>
                    <p className="text-xs text-muted-foreground">Employee is paid on leave days</p>
                  </div>
                  <Toggle
                    checked={form.is_paid}
                    onChange={v => setForm(f => ({ ...f, is_paid: v }))}
                    label="Is Paid"
                  />
                </div>

                {/* Allow Sandwich */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-foreground">Sandwich Rule</p>
                    <p className="text-xs text-muted-foreground">
                      Weekends / holidays between leave days are counted as leave
                    </p>
                  </div>
                  <Toggle
                    checked={form.allow_sandwich}
                    onChange={v => setForm(f => ({ ...f, allow_sandwich: v }))}
                    label="Allow Sandwich"
                  />
                </div>

                {/* Is Active */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-foreground">Active</p>
                    <p className="text-xs text-muted-foreground">Employees can apply for this leave type</p>
                  </div>
                  <Toggle
                    checked={form.is_active}
                    onChange={v => setForm(f => ({ ...f, is_active: v }))}
                    label="Is Active"
                  />
                </div>

                {/* API error */}
                {saveMutation.isError && (
                  <div className="flex items-center gap-2 text-xs text-destructive p-2 rounded-md bg-destructive/10">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {(saveMutation.error as Error)?.message ?? 'Save failed'}
                  </div>
                )}

                <FormActions>
                  <Button variant="outline" onClick={resetForm} disabled={saveMutation.isPending}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{editId ? 'Saving…' : 'Creating…'}</>
                      : editId ? 'Save Changes' : 'Create'
                    }
                  </Button>
                </FormActions>
              </div>
            </SectionCard>
          </div>
        )}

        {/* Placeholder when form hidden */}
        {isAdmin && !showForm && !editId && (
          <div id="lt-form">
            <SectionCard
              title="Leave Type"
              icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="py-8 text-center space-y-2">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Click a row to edit or "New Type" to create.</p>
              </div>
            </SectionCard>
          </div>
        )}

      </div>

      {/* ── Leave Balances ──────────────────────────────────────────────────── */}
      {isAdmin && (
        <SectionCard
          title="Leave Balances"
          icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="flex gap-2 mb-4">
            <EmployeeSelector
              placeholder="Search employee by name or code…"
              value={balanceEmpId}
              onChange={v => { const val = typeof v === 'string' ? v : (v[0] ?? ''); setBalanceEmpId(val); setAppliedEmpId(val) }}
              className="flex-1"
            />
            <Button className="h-8 text-xs" onClick={() => setAppliedEmpId(balanceEmpId)}>
              Load
            </Button>
          </div>

          {appliedEmpId && (
            balanceLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 animate-pulse">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading balances…
              </div>
            ) : (balanceData?.data ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground py-4">
                No leave balances set for this employee this year.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {['Leave Type', 'Paid', 'Balance (days)', ''].map(h => (
                        <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(balanceData?.data ?? []).map(row => (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-medium text-foreground">{row.leave_types.name}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={row.leave_types.is_paid ? 'success' : 'secondary'}
                            className="rounded-full text-[10px]"
                          >
                            {row.leave_types.is_paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={365}
                            step={0.5}
                            value={balanceEdits[row.leave_type_id] ?? String(row.balance)}
                            onChange={e =>
                              setBalanceEdits(p => ({ ...p, [row.leave_type_id]: e.target.value }))
                            }
                            className="h-7 w-24 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={setBalanceMutation.isPending}
                            onClick={() =>
                              setBalanceMutation.mutate({
                                employee_id:   appliedEmpId,
                                leave_type_id: row.leave_type_id,
                                balance:       parseFloat(
                                  balanceEdits[row.leave_type_id] ?? String(row.balance)
                                ),
                              })
                            }
                          >
                            Save
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </SectionCard>
      )}
    </PageContainer>
  )
}
