import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Users, Shield, RefreshCw, UserCheck, UserX, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge }  from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

// ── User row component ────────────────────────────────────────────────────────

function UserRow({
  user,
  currentUserId,
  isSuperAdmin,
  onRoleChange,
  onStatusToggle,
  isPending,
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
      {/* Avatar */}
      <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {initials}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {user.full_name ?? '(no name)'}
          {isSelf && <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">(you)</span>}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Joined {new Date(user.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}
          {!user.is_active && <span className="ml-2 text-destructive">• Inactive</span>}
        </p>
      </div>

      {/* Role selector (super_admin only, can't change self) */}
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

      {/* Active / Deactivate toggle (admin only, can't touch self) */}
      {isSuperAdmin && !isSelf && (
        <Button
          size="icon"
          variant="ghost"
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

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const { profile: me } = useAuthStore()
  const qc = useQueryClient()

  const isSuperAdmin = me?.role === 'super_admin'
  const isAdmin      = isSuperAdmin || me?.role === 'hr_admin'

  const { data, isLoading, isFetching, refetch } = useQuery<{ data: UserProfile[] }>({
    queryKey: ['tenant-users'],
    queryFn:  () => api.get('/users'),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const users = data?.data ?? []

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

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center py-8">
            Only HR admins can manage users.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Split into active / inactive
  const active   = users.filter(u => u.is_active)
  const inactive = users.filter(u => !u.is_active)

  return (
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
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 bg-muted rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && users.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>
        )}

        {active.length > 0 && (
          <div className="space-y-2">
            {active.map(u => (
              <UserRow
                key={u.id}
                user={u}
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
                  key={u.id}
                  user={u}
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
  )
}

// ── Main Settings page ────────────────────────────────────────────────────────

export function Settings() {
  const { tenant } = useAuthStore()

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage company settings and access control</p>
      </div>

      <Tabs defaultValue="company">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; Permissions</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Company Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Company Name</p><p className="font-medium mt-0.5">{tenant?.name ?? '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Slug</p><p className="font-medium mt-0.5">{tenant?.slug ?? '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Industry</p><p className="font-medium mt-0.5">{tenant?.industry ?? '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Company Size</p><p className="font-medium mt-0.5">{tenant?.size_range ?? '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Country</p><p className="font-medium mt-0.5">{tenant?.country ?? 'IN'}</p></div>
                <div><p className="text-xs text-muted-foreground">Plan</p>
                  <Badge variant="info" className="mt-0.5 text-[10px]">{tenant?.plan?.toUpperCase() ?? 'STARTER'}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                RBAC — Role Permissions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {[
                  { role: 'Super Admin', perms: ['All permissions'],                                                                    color: 'text-destructive' },
                  { role: 'HR Admin',   perms: ['employees:read/write', 'documents:read/write', 'settings:read/write', 'analytics:read'], color: 'text-info' },
                  { role: 'Manager',    perms: ['employees:read (own team)', 'documents:read', 'analytics:read'],                         color: 'text-success' },
                  { role: 'Employee',   perms: ['profile:read/write', 'documents:read (own)'],                                            color: 'text-warning' },
                ].map((r) => (
                  <div key={r.role} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <span className={`text-sm font-semibold w-28 flex-shrink-0 ${r.color}`}>{r.role}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {r.perms.map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
