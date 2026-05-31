/**
 * UsersManagement — /admin/settings/users
 *
 * Standalone user management page. Accessible from Setup › System sidebar.
 * Super admins can change roles and activate / deactivate accounts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, RefreshCw, UserCheck, UserX, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge }        from '@/components/ui/badge'
import { Button }       from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { api }          from '@/lib/api/client'
import { toast }        from 'sonner'
import { cn }           from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type UserRole = 'super_admin' | 'hr_admin' | 'manager' | 'employee'

interface UserProfile {
  id:          string
  full_name:   string | null
  role:        UserRole
  is_active:   boolean
  created_at:  string
  employee_id: string | null
  avatar_url:  string | null
}

// ── Role display config ───────────────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  hr_admin:    'HR Admin',
  manager:     'Manager',
  employee:    'Employee',
}

const ROLE_VARIANT: Record<UserRole, 'destructive' | 'info' | 'success' | 'warning'> = {
  super_admin: 'destructive',
  hr_admin:    'info',
  manager:     'success',
  employee:    'warning',
}

const ROLE_OPTIONS: UserRole[] = ['super_admin', 'hr_admin', 'manager', 'employee']

// ── User row ─────────────────────────────────────────────────────────────────

function UserRow({
  user, currentUserId, isSuperAdmin, onRoleChange, onStatusToggle, isPending,
}: {
  user:           UserProfile
  currentUserId:  string
  isSuperAdmin:   boolean
  onRoleChange:   (id: string, role: UserRole) => void
  onStatusToggle: (id: string, active: boolean) => void
  isPending:      boolean
}) {
  const isSelf   = user.id === currentUserId
  const initials = user.full_name
    ? user.full_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-lg border border-border',
      !user.is_active && 'opacity-60',
    )}>
      <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {user.full_name ?? '(no name)'}
          {isSelf && <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">(you)</span>}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Joined {(() => { const d=new Date(user.created_at.length===10?user.created_at+'T12:00:00Z':user.created_at); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()}
          {!user.is_active && <span className="ml-2 text-destructive">• Inactive</span>}
        </p>
      </div>

      {isSuperAdmin && !isSelf ? (
        <div className="relative">
          <select
            value={user.role}
            disabled={isPending}
            onChange={e => onRoleChange(user.id, e.target.value as UserRole)}
            className="h-7 text-xs rounded-md border border-input bg-background pl-2 pr-6 text-foreground outline-none focus:ring-1 ring-primary/50 appearance-none cursor-pointer"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        </div>
      ) : (
        <Badge variant={ROLE_VARIANT[user.role]} className="rounded-full text-[10px]">
          {ROLE_LABEL[user.role]}
        </Badge>
      )}

      {isSuperAdmin && !isSelf && (
        <Button
          size="icon" variant="ghost"
          className="h-7 w-7 flex-shrink-0"
          disabled={isPending}
          title={user.is_active ? 'Deactivate user' : 'Activate user'}
          onClick={() => onStatusToggle(user.id, !user.is_active)}
        >
          {user.is_active
            ? <UserX className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            : <UserCheck className="h-3.5 w-3.5 text-muted-foreground hover:text-success" />
          }
        </Button>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function UsersManagement() {
  const { profile: me } = useAuthStore()
  const qc = useQueryClient()

  const isSuperAdmin = me?.role === 'super_admin'
  const isAdmin      = isSuperAdmin || me?.role === 'hr_admin'

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: UserProfile[] }>({
    queryKey:  ['tenant-users'],
    queryFn:   () => api.get('/users'),
    enabled:   isAdmin,
    staleTime: 60_000,
  })
  const users   = data?.data ?? []
  const active   = users.filter(u => u.is_active)
  const inactive = users.filter(u => !u.is_active)

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api.put(`/users/${id}/role`, { role }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tenant-users'] })
      toast.success('Role updated', { description: `User is now ${ROLE_LABEL[vars.role]}` })
    },
    onError: (e: Error) => toast.error('Role update failed', { description: e.message }),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/users/${id}/status`, { is_active }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tenant-users'] })
      toast.success(vars.is_active ? 'User activated' : 'User deactivated')
    },
    onError: (e: Error) => toast.error('Status update failed', { description: e.message }),
  })

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Manage user accounts and role assignments</p>
      </div>

      {!isAdmin ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center py-8">
              Only HR admins can manage users.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Users ({users.length})
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} className="h-7 gap-1.5">
                <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-14 bg-muted rounded-lg" />)}
              </div>
            )}

            {!isLoading && users.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>
            )}

            {active.length > 0 && (
              <div className="space-y-2">
                {active.map(u => (
                  <UserRow
                    key={u.id} user={u}
                    currentUserId={me?.id ?? ''}
                    isSuperAdmin={isSuperAdmin}
                    onRoleChange={(id, role) => roleMutation.mutate({ id, role })}
                    onStatusToggle={(id, is_active) => statusMutation.mutate({ id, is_active })}
                    isPending={roleMutation.isPending || statusMutation.isPending}
                  />
                ))}
              </div>
            )}

            {inactive.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-2 mt-4">Inactive</p>
                <div className="space-y-2">
                  {inactive.map(u => (
                    <UserRow
                      key={u.id} user={u}
                      currentUserId={me?.id ?? ''}
                      isSuperAdmin={isSuperAdmin}
                      onRoleChange={(id, role) => roleMutation.mutate({ id, role })}
                      onStatusToggle={(id, is_active) => statusMutation.mutate({ id, is_active })}
                      isPending={roleMutation.isPending || statusMutation.isPending}
                    />
                  ))}
                </div>
              </div>
            )}

            {isSuperAdmin && (
              <p className="text-[10px] text-muted-foreground pt-2 border-t border-border">
                Role changes take effect on the user's next login. Only super admins can change roles or deactivate accounts.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
