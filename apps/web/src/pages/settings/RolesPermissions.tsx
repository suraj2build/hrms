/**
 * RolesPermissions — Enterprise RBAC governance workspace.
 * Route: /admin/settings/roles
 *
 * Features:
 *   · Structured permission matrix grouped by module
 *   · Expandable permission sections with bulk-select
 *   · Role comparison view
 *   · Permission explainability (why a user has access)
 *   · High-risk permission badges
 *   · Effective permission viewer per role
 *
 * Design rules: design-system tokens only — no raw hex / bg-gray-*.
 */
import { useState, useMemo } from 'react'
import {
  Shield, ChevronDown, ChevronRight, AlertTriangle,
  Check, X, Search, Copy, Info,
  Clock, Users, CalendarCheck, DollarSign,
  Settings, FileSearch, GitBranch, Target,
} from 'lucide-react'
import { cn }             from '@/lib/utils'
import { SubTabs }        from '@/components/ui/SubTabs'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { useAuthStore }   from '@/stores/authStore'

// ── Permission model ───────────────────────────────────────────────────────────

type PermissionAction =
  | 'view' | 'create' | 'edit' | 'delete'
  | 'approve' | 'reject' | 'export'
  | 'lock' | 'unlock' | 'override'
  | 'configure' | 'audit_access' | 'process'

interface PermissionDef {
  id:        string       // e.g. 'attendance:approve'
  module:    string
  action:    PermissionAction
  label:     string
  highRisk?: boolean      // warn on assignment
  description?: string
}

interface PermissionModule {
  id:          string
  label:       string
  icon:        React.ComponentType<{ className?: string }>
  permissions: PermissionDef[]
}

// ── Role definitions ───────────────────────────────────────────────────────────

type RoleId =
  | 'super_admin'
  | 'hr_admin'
  | 'hr_operations'
  | 'payroll_admin'
  | 'manager'
  | 'team_lead'
  | 'employee'
  | 'auditor'

interface RoleDef {
  id:          RoleId
  label:       string
  description: string
  color:       string  // token class
  permissions: Set<string>
}

// ── Permission catalog ─────────────────────────────────────────────────────────

const PERMISSION_MODULES: PermissionModule[] = [
  {
    id: 'employees', label: 'People & Employees', icon: Users,
    permissions: [
      { id: 'employees:view',   module: 'employees', action: 'view',   label: 'View employee records' },
      { id: 'employees:create', module: 'employees', action: 'create', label: 'Create new employees' },
      { id: 'employees:edit',   module: 'employees', action: 'edit',   label: 'Edit employee details' },
      { id: 'employees:delete', module: 'employees', action: 'delete', label: 'Delete employees', highRisk: true },
      { id: 'employees:export', module: 'employees', action: 'export', label: 'Export employee data', highRisk: true },
    ],
  },
  {
    id: 'attendance', label: 'Attendance Operations', icon: Clock,
    permissions: [
      { id: 'attendance:view',       module: 'attendance', action: 'view',       label: 'View attendance records' },
      { id: 'attendance:view_team',  module: 'attendance', action: 'view',       label: 'View team attendance' },
      { id: 'attendance:edit',       module: 'attendance', action: 'edit',       label: 'Edit attendance records', highRisk: true },
      { id: 'attendance:process',    module: 'attendance', action: 'process',    label: 'Run attendance processing', highRisk: true },
      { id: 'attendance:export',     module: 'attendance', action: 'export',     label: 'Export attendance data' },
      { id: 'attendance:audit',      module: 'attendance', action: 'audit_access', label: 'Access audit log' },
      { id: 'attendance:override',   module: 'attendance', action: 'override',   label: 'Override attendance status', highRisk: true },
    ],
  },
  {
    id: 'corrections', label: 'Corrections & Regularisation', icon: Target,
    permissions: [
      { id: 'corrections:view',    module: 'corrections', action: 'view',    label: 'View correction requests' },
      { id: 'corrections:submit',  module: 'corrections', action: 'create',  label: 'Submit correction requests' },
      { id: 'corrections:approve', module: 'corrections', action: 'approve', label: 'Approve correction requests' },
      { id: 'corrections:reject',  module: 'corrections', action: 'reject',  label: 'Reject correction requests' },
    ],
  },
  {
    id: 'leave', label: 'Leave Operations', icon: CalendarCheck,
    permissions: [
      { id: 'leave:view',      module: 'leave', action: 'view',      label: 'View leave records' },
      { id: 'leave:apply',     module: 'leave', action: 'create',    label: 'Apply for leave' },
      { id: 'leave:approve',   module: 'leave', action: 'approve',   label: 'Approve leave requests' },
      { id: 'leave:reject',    module: 'leave', action: 'reject',    label: 'Reject leave requests' },
      { id: 'leave:configure', module: 'leave', action: 'configure', label: 'Configure leave types and policies' },
      { id: 'leave:override',  module: 'leave', action: 'override',  label: 'Override leave balances', highRisk: true },
    ],
  },
  {
    id: 'roster', label: 'Roster & Shifts', icon: Clock,
    permissions: [
      { id: 'roster:view',       module: 'roster', action: 'view',       label: 'View roster assignments' },
      { id: 'roster:edit',       module: 'roster', action: 'edit',       label: 'Edit roster assignments' },
      { id: 'roster:override',   module: 'roster', action: 'override',   label: 'Override roster for any employee', highRisk: true },
      { id: 'shifts:configure',  module: 'roster', action: 'configure',  label: 'Create and configure shifts' },
    ],
  },
  {
    id: 'anomalies', label: 'Anomalies & Forensics', icon: AlertTriangle,
    permissions: [
      { id: 'anomalies:view',    module: 'anomalies', action: 'view',    label: 'View anomaly flags' },
      { id: 'anomalies:resolve', module: 'anomalies', action: 'approve', label: 'Resolve anomalies' },
    ],
  },
  {
    id: 'payroll', label: 'Payroll Operations', icon: DollarSign,
    permissions: [
      { id: 'payroll:view',      module: 'payroll', action: 'view',   label: 'View payroll data' },
      { id: 'payroll:run',       module: 'payroll', action: 'process', label: 'Run payroll cycles', highRisk: true },
      { id: 'payroll:export',    module: 'payroll', action: 'export', label: 'Export payroll data', highRisk: true },
      { id: 'payroll:override',  module: 'payroll', action: 'override', label: 'Override payroll entries', highRisk: true },
    ],
  },
  {
    id: 'reports', label: 'Reports & Analytics', icon: FileSearch,
    permissions: [
      { id: 'reports:view',   module: 'reports', action: 'view',   label: 'View reports' },
      { id: 'reports:export', module: 'reports', action: 'export', label: 'Export report data' },
    ],
  },
  {
    id: 'workflows', label: 'Approval Workflows', icon: GitBranch,
    permissions: [
      { id: 'workflows:view',      module: 'workflows', action: 'view',      label: 'View workflow configurations' },
      { id: 'workflows:configure', module: 'workflows', action: 'configure', label: 'Configure approval workflows' },
      { id: 'workflows:approve',   module: 'workflows', action: 'approve',   label: 'Act as workflow approver' },
    ],
  },
  {
    id: 'settings', label: 'System Settings', icon: Settings,
    permissions: [
      { id: 'settings:view',     module: 'settings', action: 'view',     label: 'View system settings' },
      { id: 'settings:edit',     module: 'settings', action: 'edit',     label: 'Edit system settings', highRisk: true },
      { id: 'masters:view',      module: 'settings', action: 'view',     label: 'View master data' },
      { id: 'masters:edit',      module: 'settings', action: 'edit',     label: 'Edit master data', highRisk: true },
    ],
  },
]

// ── Role catalog ───────────────────────────────────────────────────────────────

const ROLE_DEFS: RoleDef[] = [
  {
    id: 'super_admin', label: 'Super Admin', color: 'text-destructive',
    description: 'Full platform access. Use with extreme caution.',
    permissions: new Set([
      'employees:view', 'employees:create', 'employees:edit', 'employees:delete', 'employees:export',
      'attendance:view', 'attendance:view_team', 'attendance:edit', 'attendance:process', 'attendance:export', 'attendance:audit', 'attendance:override',
      'corrections:view', 'corrections:submit', 'corrections:approve', 'corrections:reject',
      'leave:view', 'leave:apply', 'leave:approve', 'leave:reject', 'leave:configure', 'leave:override',
      'roster:view', 'roster:edit', 'roster:override', 'shifts:configure',
      'anomalies:view', 'anomalies:resolve',
      'payroll:view', 'payroll:run', 'payroll:export', 'payroll:override',
      'reports:view', 'reports:export',
      'workflows:view', 'workflows:configure', 'workflows:approve',
      'settings:view', 'settings:edit', 'masters:view', 'masters:edit',
    ]),
  },
  {
    id: 'hr_admin', label: 'HR Admin', color: 'text-primary',
    description: 'Full HR operations access. Cannot run payroll.',
    permissions: new Set([
      'employees:view', 'employees:create', 'employees:edit', 'employees:export',
      'attendance:view', 'attendance:view_team', 'attendance:edit', 'attendance:process', 'attendance:export', 'attendance:audit', 'attendance:override',
      'corrections:view', 'corrections:submit', 'corrections:approve', 'corrections:reject',
      'leave:view', 'leave:apply', 'leave:approve', 'leave:reject', 'leave:configure', 'leave:override',
      'roster:view', 'roster:edit', 'shifts:configure',
      'anomalies:view', 'anomalies:resolve',
      'payroll:view',
      'reports:view', 'reports:export',
      'workflows:view', 'workflows:configure', 'workflows:approve',
      'settings:view', 'masters:view', 'masters:edit',
    ]),
  },
  {
    id: 'hr_operations', label: 'HR Operations', color: 'text-info',
    description: 'Day-to-day HR operations: corrections, leave, roster.',
    permissions: new Set([
      'employees:view', 'employees:edit',
      'attendance:view', 'attendance:view_team', 'attendance:export', 'attendance:audit',
      'corrections:view', 'corrections:approve', 'corrections:reject',
      'leave:view', 'leave:approve', 'leave:reject',
      'roster:view', 'roster:edit',
      'anomalies:view', 'anomalies:resolve',
      'payroll:view',
      'reports:view',
      'workflows:view', 'workflows:approve',
      'masters:view',
    ]),
  },
  {
    id: 'payroll_admin', label: 'Payroll Admin', color: 'text-warning',
    description: 'Payroll-focused role. Limited HR write access.',
    permissions: new Set([
      'employees:view',
      'attendance:view', 'attendance:view_team', 'attendance:export', 'attendance:audit',
      'leave:view',
      'payroll:view', 'payroll:run', 'payroll:export', 'payroll:override',
      'reports:view', 'reports:export',
      'masters:view',
    ]),
  },
  {
    id: 'manager', label: 'Manager', color: 'text-foreground',
    description: 'Team-scoped view and approval for direct reports.',
    permissions: new Set([
      'employees:view',
      'attendance:view', 'attendance:view_team',
      'corrections:view', 'corrections:approve', 'corrections:reject',
      'leave:view', 'leave:approve', 'leave:reject',
      'roster:view',
      'anomalies:view',
      'payroll:view',
      'reports:view',
      'workflows:approve',
    ]),
  },
  {
    id: 'team_lead', label: 'Team Lead', color: 'text-foreground',
    description: 'Team-scoped view. Can submit corrections on behalf of team.',
    permissions: new Set([
      'employees:view',
      'attendance:view', 'attendance:view_team',
      'corrections:view', 'corrections:submit',
      'leave:view', 'leave:approve',
      'roster:view',
      'anomalies:view',
    ]),
  },
  {
    id: 'employee', label: 'Employee', color: 'text-muted-foreground',
    description: 'Self-service access only.',
    permissions: new Set([
      'employees:view',
      'attendance:view',
      'corrections:submit',
      'leave:view', 'leave:apply',
      'payroll:view',
    ]),
  },
  {
    id: 'auditor', label: 'Read-only Auditor', color: 'text-muted-foreground',
    description: 'Read-only access for compliance audits.',
    permissions: new Set([
      'employees:view',
      'attendance:view', 'attendance:audit',
      'corrections:view',
      'leave:view',
      'payroll:view',
      'reports:view',
      'masters:view',
    ]),
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function HighRiskBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-destructive/10 text-destructive rounded px-1 py-0.5 flex-shrink-0">
      <AlertTriangle className="h-2.5 w-2.5" />
      High Risk
    </span>
  )
}

function PermissionCell({
  hasPermission,
  highRisk,
}: {
  hasPermission: boolean
  highRisk?:     boolean
}) {
  return (
    <div className={cn(
      'flex items-center justify-center h-8 w-8 rounded',
      hasPermission ? 'bg-success/10' : 'bg-muted/20',
    )}>
      {hasPermission
        ? <Check className={cn('h-3.5 w-3.5', highRisk ? 'text-warning' : 'text-success')} />
        : <X className="h-3 w-3 text-muted-foreground/25" />
      }
    </div>
  )
}

// ── Role detail panel ──────────────────────────────────────────────────────────

function RoleDetailPanel({
  role,
  onClose,
}: {
  role:    RoleDef
  onClose: () => void
}) {
  const allPerms = PERMISSION_MODULES.flatMap(m => m.permissions)
  const rolePerms = allPerms.filter(p => role.permissions.has(p.id))
  const highRiskCount = rolePerms.filter(p => p.highRisk).length

  return (
    <div className="space-y-4">
      {/* Role header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shield className={cn('h-5 w-5', role.color)} />
            <h3 className="text-base font-semibold text-foreground">{role.label}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{role.description}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-2 text-xs">
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs bg-muted/40 rounded-md px-2.5 py-1.5">
          <Check className="h-3 w-3 text-success" />
          <span className="font-medium">{rolePerms.length}</span>
          <span className="text-muted-foreground">permissions</span>
        </div>
        {highRiskCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs bg-destructive/10 text-destructive rounded-md px-2.5 py-1.5">
            <AlertTriangle className="h-3 w-3" />
            <span className="font-medium">{highRiskCount}</span>
            <span>high-risk</span>
          </div>
        )}
      </div>

      {/* Permission explainability trace */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-2">
          Permission Trace
        </p>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {PERMISSION_MODULES.map(mod => {
            const granted = mod.permissions.filter(p => role.permissions.has(p.id))
            if (granted.length === 0) return null
            return (
              <div key={mod.id} className="rounded-md bg-muted/20 p-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <mod.icon className="h-3 w-3 text-muted-foreground/60" />
                  <span className="text-[11px] font-semibold text-foreground">{mod.label}</span>
                </div>
                <div className="flex flex-wrap gap-1 pl-4">
                  {granted.map(p => (
                    <span
                      key={p.id}
                      className={cn(
                        'text-[10px] rounded px-1.5 py-0.5 font-mono',
                        p.highRisk
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-primary/10 text-primary',
                      )}
                    >
                      {p.id.split(':')[1]}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Access trace — how this role grants access */}
      <div className="rounded-md border border-border/50 p-3 bg-muted/10">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 text-info" />
          <span className="text-[11px] font-semibold text-foreground">Access Granted Via</span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-primary font-medium">{role.label}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
            <span>Role assignment</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
            <span>{rolePerms.length} direct permissions</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 italic">
            Scope: Organization-wide (all employees in tenant)
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RolesPermissions() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [search,         setSearch]         = useState('')
  const [expandedMods,   setExpandedMods]   = useState<Set<string>>(new Set(['employees', 'attendance']))
  const [selectedRole,   setSelectedRole]   = useState<RoleId>('hr_admin')
  const [compareRole,    setCompareRole]    = useState<RoleId | null>(null)
  const [detailRole,     setDetailRole]     = useState<RoleDef | null>(null)
  const [activeTab,      setActiveTab]      = useState<'matrix' | 'roles'>('matrix')

  const activeRoleDef    = ROLE_DEFS.find(r => r.id === selectedRole)!
  const compareRoleDef   = compareRole ? ROLE_DEFS.find(r => r.id === compareRole) : null

  // Filter permissions by search
  const filteredModules = useMemo(() => {
    if (!search) return PERMISSION_MODULES
    const lower = search.toLowerCase()
    return PERMISSION_MODULES.map(mod => ({
      ...mod,
      permissions: mod.permissions.filter(
        p => p.label.toLowerCase().includes(lower) || p.id.toLowerCase().includes(lower)
      ),
    })).filter(mod => mod.permissions.length > 0)
  }, [search])

  function toggleModule(id: string) {
    setExpandedMods(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Roles & Permissions" subtitle="Access control governance" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Shield className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm font-medium text-foreground">Access Restricted</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Only Super Admins and HR Admins can manage roles and permissions.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Enterprise RBAC governance — manage module access, permission scopes, and role assignments"
      />

      {/* Tab bar */}
      <SubTabs<typeof activeTab>
        tabs={[
          { id: 'matrix', label: 'Permission Matrix' },
          { id: 'roles',  label: 'Role Overview'     },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4"
      />

      {/* ── Permission Matrix Tab ──────────────────────────────── */}
      {activeTab === 'matrix' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left: module + permission list */}
          <div className="lg:col-span-2 space-y-3">
            {/* Search + controls */}
            <SectionCard>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                  <Input
                    placeholder="Search permissions…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setExpandedMods(new Set(PERMISSION_MODULES.map(m => m.id)))}
                >
                  Expand All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setExpandedMods(new Set())}
                >
                  Collapse All
                </Button>
              </div>
            </SectionCard>

            {/* Permission modules */}
            {filteredModules.map(mod => (
              <SectionCard key={mod.id} className="p-0">
                {/* Module header */}
                <button
                  type="button"
                  onClick={() => toggleModule(mod.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 rounded-t-lg transition-colors text-left"
                >
                  <mod.icon className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                  <span className="flex-1 text-sm font-semibold text-foreground">{mod.label}</span>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">{mod.permissions.length} permissions</span>
                  {expandedMods.has(mod.id)
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                  }
                </button>

                {/* Permissions table */}
                {expandedMods.has(mod.id) && (
                  <div className="border-t border-border/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/30 bg-muted/10">
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground/60">Permission</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground/60 font-mono">Key</th>
                          {/* Role columns — show primary + compare */}
                          <th className="text-center px-2 py-2 min-w-16">
                            <span className={cn('text-[10px] font-semibold', activeRoleDef?.color)}>
                              {activeRoleDef?.label}
                            </span>
                          </th>
                          {compareRoleDef && (
                            <th className="text-center px-2 py-2 min-w-16">
                              <span className={cn('text-[10px] font-semibold', compareRoleDef.color)}>
                                {compareRoleDef.label}
                              </span>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {mod.permissions.map(perm => (
                          <tr key={perm.id} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-foreground">{perm.label}</span>
                                {perm.highRisk && <HighRiskBadge />}
                              </div>
                            </td>
                            <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground/60">{perm.id}</td>
                            <td className="px-2 py-2 text-center">
                              <PermissionCell
                                hasPermission={activeRoleDef?.permissions.has(perm.id) ?? false}
                                highRisk={perm.highRisk}
                              />
                            </td>
                            {compareRoleDef && (
                              <td className="px-2 py-2 text-center">
                                <PermissionCell
                                  hasPermission={compareRoleDef.permissions.has(perm.id)}
                                  highRisk={perm.highRisk}
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            ))}
          </div>

          {/* Right: role selector + detail */}
          <div className="space-y-3">
            {/* Primary role selector */}
            <SectionCard title="View Role" icon={<Shield className="h-4 w-4 text-muted-foreground" />}>
              <div className="space-y-1">
                {ROLE_DEFS.map(role => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRole(role.id)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      selectedRole === role.id
                        ? 'bg-primary/10 ring-1 ring-primary/20'
                        : 'hover:bg-muted/40',
                    )}
                  >
                    <Shield className={cn('h-3.5 w-3.5 flex-shrink-0', role.color)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{role.label}</div>
                      <div className="text-[10px] text-muted-foreground/60 truncate">{role.permissions.size} permissions</div>
                    </div>
                    {selectedRole === role.id && (
                      <Check className="h-3 w-3 text-primary flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Compare role selector */}
            <SectionCard title="Compare With" icon={<Copy className="h-4 w-4 text-muted-foreground" />}>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setCompareRole(null)}
                  className={cn(
                    'w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors',
                    !compareRole ? 'bg-muted/40' : 'hover:bg-muted/20 text-muted-foreground',
                  )}
                >
                  None
                </button>
                {ROLE_DEFS.filter(r => r.id !== selectedRole).map(role => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setCompareRole(role.id)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors text-xs',
                      compareRole === role.id ? 'bg-warning/10' : 'hover:bg-muted/20',
                    )}
                  >
                    <Shield className={cn('h-3 w-3 flex-shrink-0', role.color)} />
                    <span className="flex-1 text-foreground">{role.label}</span>
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Detail / explainability */}
            {detailRole && (
              <SectionCard>
                <RoleDetailPanel role={detailRole} onClose={() => setDetailRole(null)} />
              </SectionCard>
            )}
          </div>
        </div>
      )}

      {/* ── Role Overview Tab ──────────────────────────────────── */}
      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {ROLE_DEFS.map(role => {
            const highRiskCount = [...role.permissions].filter(
              pid => PERMISSION_MODULES.flatMap(m => m.permissions).find(p => p.id === pid)?.highRisk
            ).length

            return (
              <SectionCard
                key={role.id}
                className="cursor-pointer hover:ring-1 hover:ring-primary/20 transition-all"
              >
                <button
                  type="button"
                  onClick={() => setDetailRole(role)}
                  className="w-full text-left space-y-3"
                >
                  {/* Role header */}
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-muted/40 flex items-center justify-center flex-shrink-0">
                      <Shield className={cn('h-5 w-5', role.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground">{role.label}</div>
                      <div className="text-[11px] text-muted-foreground/70 leading-snug mt-0.5 line-clamp-2">{role.description}</div>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="h-3 w-3 text-success" />
                      <span className="font-semibold text-foreground">{role.permissions.size}</span>
                      <span>perms</span>
                    </div>
                    {highRiskCount > 0 && (
                      <div className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        <span className="font-semibold">{highRiskCount}</span>
                        <span>high-risk</span>
                      </div>
                    )}
                    <Badge
                      variant="outline"
                      className="rounded-full text-[9px] px-2 py-0 h-4 ml-auto font-mono"
                    >
                      {role.id}
                    </Badge>
                  </div>

                  {/* Module coverage dots */}
                  <div className="flex flex-wrap gap-1">
                    {PERMISSION_MODULES.map(mod => {
                      const covered = mod.permissions.some(p => role.permissions.has(p.id))
                      return (
                        <div
                          key={mod.id}
                          title={`${mod.label}: ${covered ? 'has access' : 'no access'}`}
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            covered ? 'bg-success/60' : 'bg-muted-foreground/15',
                          )}
                        />
                      )
                    })}
                  </div>
                </button>
              </SectionCard>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
