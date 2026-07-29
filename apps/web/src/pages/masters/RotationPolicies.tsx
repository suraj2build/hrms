import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import {
  Plus,
  MoreHorizontal,
  Edit2,
  Copy,
  Archive,
  RefreshCw,
  CalendarClock,
  Users,
  Building2,
  ChevronRight,
} from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Badge }    from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RotationPolicy {
  id:             string
  name:           string
  description:    string | null
  is_active:      boolean
  rule_count:     number
  employee_count: number
  site_count:     number
  created_at:     string
  updated_at:     string | null
}

interface PoliciesResponse {
  data: RotationPolicy[]
}

// ── Condition label map ───────────────────────────────────────────────────────

const CONDITION_LABELS: Record<string, string> = {
  weekday_working:  'Mon–Fri',
  saturday_working: 'Saturday',
  sunday_working:   'Sunday',
  half_day:         'Half Day',
  holiday_working:  'Holiday',
}

// ── Policy card ───────────────────────────────────────────────────────────────

interface PolicyCardProps {
  policy:      RotationPolicy
  onEdit:      (id: string) => void
  onDuplicate: (id: string) => void
  onToggle:    (id: string, active: boolean, name: string, siteCount: number, employeeCount: number) => void
}

function PolicyCard({ policy, onEdit, onDuplicate, onToggle }: PolicyCardProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border bg-card p-4',
        'hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer',
        !policy.is_active && 'opacity-60',
      )}
      onClick={() => onEdit(policy.id)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarClock className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium text-sm truncate">{policy.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant={policy.is_active ? 'default' : 'secondary'}
            className="text-[10px] px-1.5 py-0"
          >
            {policy.is_active ? 'Active' : 'Inactive'}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
                aria-label="Actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onEdit(policy.id) }}
              >
                <Edit2 className="mr-2 h-3.5 w-3.5" />
                Edit Policy
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDuplicate(policy.id) }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onToggle(policy.id, !policy.is_active, policy.name, policy.site_count, policy.employee_count) }}
                className={policy.is_active ? 'text-destructive' : 'text-success'}
              >
                {policy.is_active ? (
                  <>
                    <Archive className="mr-2 h-3.5 w-3.5" />
                    Archive
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Restore
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Description */}
      {policy.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{policy.description}</p>
      )}

      {/* Rule chips */}
      <div className="flex flex-wrap gap-1">
        {policy.rule_count === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">No shift mappings configured</span>
        ) : (
          Object.keys(CONDITION_LABELS).slice(0, 3).map((cond) => (
            <span
              key={cond}
              className="inline-flex items-center rounded-full bg-primary/8 px-2 py-0.5 text-[11px] text-primary font-medium"
            >
              {CONDITION_LABELS[cond]}
            </span>
          ))
        )}
        {policy.rule_count > 3 && (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            +{policy.rule_count - 3} more
          </span>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1 border-t border-border">
        <span className="flex items-center gap-1">
          <Building2 className="h-3 w-3" />
          {policy.site_count} {policy.site_count === 1 ? 'site' : 'sites'}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {policy.employee_count} {policy.employee_count === 1 ? 'employee' : 'employees'}
        </span>
        <span className="ml-auto flex items-center gap-0.5 text-primary/70">
          Configure <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <CalendarClock className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-base font-semibold mb-1">No rotation policies yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Rotation policies map working conditions (weekday, Saturday, Sunday) to specific
        shifts — the bridge between Roster Policies and Shift Masters.
      </p>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create First Policy
      </Button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RotationPolicies() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const [showInactive, setShowInactive] = useState(false)

  const { data, isLoading } = useQuery<PoliciesResponse, Error>({
    queryKey: ['rotation-policies', showInactive],
    queryFn: () =>
      api.get<PoliciesResponse>(
        `/masters/rotation-policies${showInactive ? '?show_inactive=true' : ''}`,
      ),
  })

  const policies = data?.data ?? []

  const duplicateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/masters/rotation-policies/${id}/duplicate`, {}),
    onSuccess: () => {
      toast.success('Policy duplicated — it starts as inactive')
      queryClient.invalidateQueries({ queryKey: ['rotation-policies'] })
      // EmployeeProfile.tsx reads the same list under this separate key.
      queryClient.invalidateQueries({ queryKey: ['rotation-policies-list'] })
    },
    onError: (err: Error) =>
      toast.error(err.message ?? 'Failed to duplicate policy'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/masters/rotation-policies/${id}`, { is_active }),
    onSuccess: (_, vars) => {
      toast.success(vars.is_active ? 'Policy restored' : 'Policy archived')
      queryClient.invalidateQueries({ queryKey: ['rotation-policies'] })
      queryClient.invalidateQueries({ queryKey: ['rotation-policies-list'] })
    },
    onError: () => toast.error('Failed to update policy'),
  })

  const handleEdit = useCallback(
    (id: string) => navigate(`/admin/masters/rotation-policies/${id}`),
    [navigate],
  )

  const handleDuplicate = useCallback(
    (id: string) => duplicateMutation.mutate(id),
    [duplicateMutation],
  )

  const handleToggle = useCallback(
    (id: string, active: boolean, name: string, siteCount: number, employeeCount: number) => {
      if (!active && !confirm(`Archive "${name}"? It is assigned to ${siteCount} site(s) and ${employeeCount} employee(s).`)) return
      toggleMutation.mutate({ id, is_active: active })
    },
    [toggleMutation],
  )

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <PageHeader
        title="Rotation Policies"
        subtitle="Map working conditions to shifts — applied after Roster Policy resolves the day type."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button size="sm" onClick={() => navigate('/admin/masters/rotation-policies/new')}>
              <Plus className="mr-1.5 h-4 w-4" />
              New Policy
            </Button>
          </>
        }
      />

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-44 rounded-xl border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : policies.length === 0 ? (
        <EmptyState onCreate={() => navigate('/admin/masters/rotation-policies/new')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map((p) => (
            <PolicyCard
              key={p.id}
              policy={p}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}
